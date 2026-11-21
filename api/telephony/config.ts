import { authenticateServerRequest, getSupabaseServerClient } from '../_lib/supabaseServer.js';
import {
  encryptOrganizationTwilioCredentials,
  maskTwilioPhoneNumber,
  validateOrganizationTwilioCredentials,
} from '../_lib/twilioCredentials.js';
import { validateOrganizationTwilioAccount } from '../_lib/twilioRest.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, profile, error } = await authenticateServerRequest(req);
  if (error || !user || !profile) return res.status(401).json({ error: 'Authentication required' });
  if (profile.status !== 'ACTIVE' || profile.role !== 'OWNER' || !UUID_PATTERN.test(profile.organization_id || '')) {
    return res.status(403).json({ error: 'Only an active organization owner can manage Twilio configuration' });
  }

  try {
    const supabase = getSupabaseServerClient();
    if (req.method === 'GET') {
      const { data, error: lookupError } = await supabase
        .from('organization_twilio_credentials')
        .select('twilio_phone_number, status, updated_at')
        .eq('organization_id', profile.organization_id)
        .eq('status', 'ACTIVE')
        .maybeSingle();
      if (lookupError) return res.status(503).json({ error: 'Twilio configuration is temporarily unavailable' });
      return res.status(200).json({
        configured: Boolean(data),
        phoneNumberMasked: data?.twilio_phone_number ? maskTwilioPhoneNumber(data.twilio_phone_number) : null,
        updatedAt: data?.updated_at || null,
      });
    }

    if (req.method === 'DELETE') {
      const { data: revoked, error: revokeError } = await supabase.rpc('revoke_organization_twilio_credentials', {
        p_organization_id: profile.organization_id,
        p_updated_by: profile.id,
      });
      if (revokeError) return res.status(503).json({ error: 'Twilio configuration could not be disabled' });
      if (revoked !== true) return res.status(409).json({ error: 'Finish active calls before disabling Twilio configuration' });
      return res.status(200).json({ configured: false });
    }

    const credentials = {
      accountSid: req.body?.accountSid,
      authToken: req.body?.authToken,
      phoneNumber: req.body?.phoneNumber,
    };
    if (!validateOrganizationTwilioCredentials(credentials)) {
      return res.status(400).json({ error: 'Enter a valid Twilio Account SID, Auth Token and E.164 phone number' });
    }

    const accountValidation = await validateOrganizationTwilioAccount(credentials);
    if (accountValidation === 'INVALID') {
      return res.status(422).json({ error: 'The Twilio credentials or voice-enabled number could not be verified' });
    }
    if (accountValidation !== 'VALID') {
      return res.status(503).json({ error: 'Twilio could not verify the account right now. Try again later.' });
    }

    let encrypted;
    try {
      encrypted = encryptOrganizationTwilioCredentials(profile.organization_id, credentials);
    } catch (encryptionError: any) {
      if (encryptionError?.message === 'invalid_twilio_credentials') {
        return res.status(400).json({ error: 'Enter valid Twilio credentials' });
      }
      return res.status(503).json({ error: 'Secure Twilio credential storage is not configured' });
    }

    const { data: saved, error: saveError } = await supabase.rpc('save_organization_twilio_credentials', {
      p_organization_id: profile.organization_id,
      p_twilio_phone_number: credentials.phoneNumber.trim(),
      p_key_id: encrypted.key_id,
      p_nonce: encrypted.nonce,
      p_ciphertext: encrypted.ciphertext,
      p_auth_tag: encrypted.auth_tag,
      p_updated_by: profile.id,
    });
    if (saveError) {
      if (saveError.code === '23505') {
        return res.status(409).json({ error: 'This Twilio phone number is already configured for another organization' });
      }
      if (saveError.code === '42501') return res.status(403).json({ error: 'Only an active organization owner can update Twilio configuration' });
      return res.status(503).json({ error: 'Twilio configuration could not be saved' });
    }
    if (saved !== true) return res.status(409).json({ error: 'Finish active calls before replacing Twilio credentials' });

    return res.status(200).json({ configured: true, phoneNumberMasked: maskTwilioPhoneNumber(credentials.phoneNumber) });
  } catch {
    console.error('Organization Twilio configuration operation failed');
    return res.status(503).json({ error: 'Twilio configuration is temporarily unavailable' });
  }
}
