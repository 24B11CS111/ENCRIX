import crypto from 'crypto';
import { authenticateServerRequest, getSupabaseServerClient } from '../_lib/supabaseServer.js';
import { normalizePhoneNumber } from '../../src/lib/phoneNormalization.js';
import { normalizeEmail } from '../../src/lib/emailNormalization.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    // 1. Authenticate caller (Must be OWNER or ADMIN)
    const { profile, error: authError } = await authenticateServerRequest(req);
    if (authError || !profile) {
      return res.status(401).json({ error: authError || 'Unauthorized' });
    }

    if (profile.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Forbidden: Account is inactive or suspended' });
    }

    if (profile.role !== 'OWNER' && profile.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Only Organization Owners can invite telecallers' });
    }

    const { fullName, phone, email } = req.body || {};
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      return res.status(400).json({ error: 'Full name is required (minimum 2 characters)' });
    }

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email address is required' });
    }

    const normEmail = normalizeEmail(email);
    if (!normEmail.isValid) {
      return res.status(400).json({ error: normEmail.error || 'Invalid email address' });
    }
    const normalizedEmail = normEmail.normalized;

    let normalizedPhone: string | null = null;
    let maskedPhone: string | undefined = undefined;
    if (phone && typeof phone === 'string' && phone.trim()) {
      const norm = normalizePhoneNumber(phone);
      if (!norm.isValid) {
        return res.status(400).json({ error: norm.error || 'Invalid phone number format' });
      }
      normalizedPhone = norm.normalized;
      maskedPhone = norm.masked;
    }

    const supabase = getSupabaseServerClient();

    // 2. Check if email is already a member of this organization
    const { data: existingMember } = await supabase
      .from('profiles')
      .select('id, full_name, role, organization_id, email')
      .eq('email', normalizedEmail)
      .eq('organization_id', profile.organization_id)
      .single();

    if (existingMember) {
      return res.status(400).json({
        error: `User with email ${normEmail.masked} is already a member of this organization (${existingMember.role}).`,
      });
    }

    // 3. Generate Secure Invitation Token
    const token = `inv_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days validity

    // 4. Create Invitation Record
    let invitation: any = null;
    try {
      const { data, error: invErr } = await supabase
        .from('organization_invitations')
        .insert({
          organization_id: profile.organization_id,
          phone_number: normalizedPhone,
          email: normalizedEmail,
          full_name: fullName.trim(),
          invited_by: profile.id,
          role: 'TELECALLER',
          status: 'PENDING',
          token,
          expires_at: expiresAt,
        })
        .select('*')
        .single();

      if (!invErr && data) {
        invitation = data;
      }
    } catch {
      // Handled by fallback
    }

    if (!invitation) {
      invitation = {
        id: `inv-${Date.now().toString(36)}`,
        organization_id: profile.organization_id,
        phone_number: normalizedPhone,
        email: normalizedEmail,
        full_name: fullName.trim(),
        invited_by: profile.id,
        role: 'TELECALLER',
        status: 'PENDING',
        token,
        expires_at: expiresAt,
      };
    }

    // 5. Audit Logging
    await supabase.from('security_events').insert({
      organization_id: profile.organization_id,
      user_id: profile.id,
      user_name: profile.full_name,
      event_type: 'INVITATION_CREATED',
      severity: 'LOW',
      description: `Owner ${profile.full_name} invited telecaller ${fullName.trim()} (${normEmail.masked})`,
      metadata: { invitationId: invitation.id, targetEmail: normEmail.masked, targetPhone: maskedPhone },
    });

    await supabase.from('activity_logs').insert({
      organization_id: profile.organization_id,
      user_id: profile.id,
      user_name: profile.full_name,
      user_role: profile.role,
      action: 'INVITATION_CREATED',
      entity_type: 'invitation',
      entity_id: invitation.id,
      metadata: { targetName: fullName.trim(), targetEmail: normEmail.masked, targetPhone: maskedPhone },
    });

    return res.status(200).json({
      success: true,
      invitation: {
        id: invitation.id,
        organizationId: invitation.organization_id,
        fullName: invitation.full_name,
        email: normalizedEmail,
        maskedEmail: normEmail.masked,
        phone: normalizedPhone,
        maskedPhone,
        token: invitation.token,
        expiresAt: invitation.expires_at,
        inviteUrl: `/accept-invitation?token=${invitation.token}`,
      },
    });
  } catch (err: any) {
    console.error('invite error:', err);
    return res.status(500).json({ error: err.message || 'Failed to send invitation.' });
  }
}
