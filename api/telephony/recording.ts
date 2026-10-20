import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../_lib/supabaseServer';
import { db } from '../../src/services/supabase/db';
import { Profile } from '../../src/types';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET.' });
  }

  try {
    // 1. Authenticate Request
    const { user, profile, error: authError } = await authenticateServerRequest(req);
    if (authError || !profile || !user) {
      return res.status(401).json({ error: authError || 'Unauthorized' });
    }

    if (profile.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Forbidden: Inactive account' });
    }

    const callId = req.query?.callId as string;
    if (!callId) {
      return res.status(400).json({ error: 'callId parameter is required' });
    }

    const supabase = getSupabaseServerClient();

    // 2. Fetch call record
    let call: any = null;
    if (isRealSupabaseServerConfigured()) {
      const { data, error: callError } = await supabase
        .from('calls')
        .select('id, organization_id, lead_id, telecaller_id, recording_url')
        .eq('id', callId)
        .single();

      if (!callError && data) {
        call = data;
      }
    } else {
      const allCalls = db.getCalls({ role: 'ADMIN', organization_id: '' } as Profile);
      const found = allCalls.find((c) => c.id === callId);
      if (found) {
        call = found;
      }
    }

    if (!call) {
      return res.status(404).json({ error: 'Call record not found' });
    }

    // 3. Organization Isolation: Cross-tenant access is strictly denied
    if (profile.role !== 'ADMIN' && call.organization_id !== profile.organization_id) {
      await supabase.from('security_events').insert({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_name: profile.full_name,
        event_type: 'CROSS_TENANT_RECORDING_ACCESS_ATTEMPT',
        severity: 'CRITICAL',
        description: `User ${profile.full_name} (${profile.id}) attempted to access cross-tenant recording for call ${call.id}`,
        metadata: { callId: call.id, targetOrg: call.organization_id, callerOrg: profile.organization_id },
      });
      return res.status(403).json({ error: 'Forbidden: Cannot access recordings belonging to another organization' });
    }

    // 4. Role Authorization: If TELECALLER, strictly verify they initiated this call
    if (profile.role === 'TELECALLER') {
      if (call.telecaller_id !== profile.id) {
        await supabase.from('security_events').insert({
          organization_id: profile.organization_id,
          user_id: profile.id,
          user_name: profile.full_name,
          event_type: 'UNAUTHORIZED_RECORDING_ACCESS_ATTEMPT',
          severity: 'HIGH',
          description: `Telecaller ${profile.full_name} (${profile.id}) attempted to access recording for call ${call.id} initiated by another caller (${call.telecaller_id})`,
          metadata: { callId: call.id, telecallerId: profile.id, callTelecallerId: call.telecaller_id },
        });
        return res.status(403).json({ error: 'Forbidden: You can only access recordings of calls initiated by you' });
      }
    }

    // Only sign the canonical private-storage object; never follow legacy stored URLs.
    const filePath = `${call.organization_id}/${call.id}.mp3`;
    if (!call.recording_url) {
      return res.status(404).json({ error: 'Call recording file not found in storage' });
    }
    if (call.recording_url !== filePath) {
      return res.status(502).json({ error: 'Recording must be synced to private storage before access' });
    }

    // Generate a short-lived signed URL only after the authorization checks above.
    let signedUrl: string | null = null;
    if (isRealSupabaseServerConfigured()) {
      const { data: signedData, error: signError } = await supabase.storage
        .from('call-recordings')
        .createSignedUrl(filePath, 60);

      if (signError || !signedData?.signedUrl) {
        return res.status(404).json({ error: 'Call recording file not found in storage or signing failed' });
      }
      signedUrl = signedData.signedUrl;
    } else {
      // Offline / test sandbox emits a mock signed URL for canonical paths only.
      signedUrl = `https://storage.encrix.internal/recordings/${filePath}?token=signed_mock_${Date.now()}`;
    }

    // Fail closed: Never return fallback to provider URL
    if (!signedUrl) {
      return res.status(404).json({ error: 'Call recording file not found in storage' });
    }

    // 6. Log authorized recording access for compliance audit (never log signed URLs or tokens)
    try {
      await supabase.from('security_events').insert({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_name: profile.full_name,
        event_type: 'RECORDING_ACCESSED',
        severity: 'LOW',
        description: `User ${profile.full_name} (${profile.role}) accessed recording for call ${call.id}`,
        metadata: { callId: call.id, role: profile.role },
      });
    } catch {
      // Audit log error handled
    }

    return res.status(200).json({
      callId: call.id,
      recordingUrl: signedUrl,
      expiresIn: 60,
    });
  } catch (err: any) {
    console.error('Recording access error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
