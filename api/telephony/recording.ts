import { authenticateServerRequest, getSupabaseServerClient } from '../_lib/supabaseServer';

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
    const { data: call, error: callError } = await supabase
      .from('calls')
      .select('id, organization_id, lead_id, telecaller_id, recording_url')
      .eq('id', callId)
      .single();

    if (callError || !call) {
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

    // 4. Role Authorization: If TELECALLER, verify assignment or initiator
    if (profile.role === 'TELECALLER') {
      const isInitiator = call.telecaller_id === profile.id;
      let isAssigned = false;

      if (!isInitiator && call.lead_id) {
        const { data: lead } = await supabase
          .from('leads')
          .select('assigned_to')
          .eq('id', call.lead_id)
          .single();
        if (lead && lead.assigned_to === profile.id) {
          isAssigned = true;
        }
      }

      if (!isInitiator && !isAssigned) {
        await supabase.from('security_events').insert({
          organization_id: profile.organization_id,
          user_id: profile.id,
          user_name: profile.full_name,
          event_type: 'UNAUTHORIZED_RECORDING_ACCESS_ATTEMPT',
          severity: 'HIGH',
          description: `Telecaller ${profile.full_name} attempted to access recording for unassigned call ${call.id}`,
          metadata: { callId: call.id, telecallerId: profile.id },
        });
        return res.status(403).json({ error: 'Forbidden: You can only access recordings of calls assigned to you' });
      }
    }

    // 5. Generate Signed URL from private storage bucket with short expiration
    const filePath = `${call.organization_id}/${call.id}.mp3`;
    const { data: signedData, error: signError } = await supabase.storage
      .from('call-recordings')
      .createSignedUrl(filePath, 60); // 60 seconds TTL

    if (signError || !signedData?.signedUrl) {
      // If storage file does not exist yet, return the recording URL stored on the call (e.g. from provider)
      if (call.recording_url) {
        return res.status(200).json({
          callId: call.id,
          recordingUrl: call.recording_url,
          expiresIn: 60,
        });
      }
      return res.status(404).json({ error: 'Call recording file not found in storage' });
    }

    return res.status(200).json({
      callId: call.id,
      recordingUrl: signedData.signedUrl,
      expiresIn: 60,
    });
  } catch (err: any) {
    console.error('Recording access error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
