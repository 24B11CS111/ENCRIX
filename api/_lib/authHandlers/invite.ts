import { randomBytes } from 'node:crypto';
import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../supabaseServer.js';
import {
  getCanonicalBaseUrl,
  getServerInvitation,
  storeServerInvitation,
  updateServerInvitationStatus,
} from '../invitationServer.js';
import { normalizePhoneNumber } from '../../../src/lib/phoneNormalization.js';
import { normalizeEmail } from '../../../src/lib/emailNormalization.js';
import { requirePaidEntitlement } from '../paidEntitlement.js';
import { sendInvitationEmail } from '../emailDelivery.js';

export default async function handler(req: any, res: any) {
  // -------------------------------------------------------------
  // GET: Public invitation token lookup and validation
  // -------------------------------------------------------------
  if (req.method === 'GET') {
    try {
      const rawToken = req.query?.token;
      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        return res.status(400).json({ error: 'Invitation token is required.' });
      }

      const token = rawToken.trim();
      if (!/^[a-zA-Z0-9_-]{10,128}$/.test(token)) {
        return res.status(400).json({ error: 'Malformed invitation token.' });
      }

      let invitation: any = null;
      let organizationName = 'ENCRIX Workspace';

      if (isRealSupabaseServerConfigured()) {
        try {
          const supabase = getSupabaseServerClient();
          const { data, error: invErr } = await supabase
            .from('organization_invitations')
            .select('id, organization_id, phone_number, full_name, email, invited_by, role, status, token, expires_at, created_at')
            .eq('token', token)
            .maybeSingle();

          if (invErr) {
            console.error('[invite] Supabase error looking up invitation:', {
              code: invErr.code,
              message: invErr.message,
            });
          } else if (data) {
            invitation = data;
            try {
              const { data: orgData } = await supabase
                .from('organizations')
                .select('name')
                .eq('id', data.organization_id)
                .single();
              if (orgData?.name) {
                organizationName = orgData.name;
              }
            } catch {
              // Org name fallback
            }
          }
        } catch {
          // Supabase query error handled by in-memory fallback
        }
      }

      if (!invitation && !isRealSupabaseServerConfigured()) {
        const memInv = getServerInvitation(token);
        if (memInv) {
          invitation = memInv;
          if (memInv.organization_name) {
            organizationName = memInv.organization_name;
          }
        }
      }

      if (!invitation) {
        return res.status(404).json({
          error: 'Invitation link is invalid or could not be found.',
        });
      }

      const now = new Date();
      const isExpired =
        invitation.status === 'EXPIRED' ||
        new Date(invitation.expires_at).getTime() < now.getTime();

      if (isExpired) {
        if (invitation.status === 'PENDING') {
          invitation.status = 'EXPIRED';
          updateServerInvitationStatus(token, 'EXPIRED');
          if (isRealSupabaseServerConfigured()) {
            try {
              const supabase = getSupabaseServerClient();
              await supabase
                .from('organization_invitations')
                .update({ status: 'EXPIRED' })
                .eq('id', invitation.id);
            } catch {
              // Update fallback
            }
          }
        }
        return res.status(410).json({
          code: 'EXPIRED',
          error: 'This invitation has expired. Please contact your organization owner for a new invitation.',
        });
      }

      if (invitation.status === 'ACCEPTED') {
        return res.status(409).json({
          code: 'ACCEPTED',
          error: 'This invitation has already been accepted. Please sign in directly.',
        });
      }

      if (invitation.status === 'REVOKED') {
        return res.status(403).json({
          code: 'REVOKED',
          error: 'This invitation has been revoked by the organization owner.',
        });
      }

      if (invitation.status !== 'PENDING') {
        return res.status(400).json({
          code: 'INVALID',
          error: 'This invitation is no longer valid.',
        });
      }

      const normEmail = invitation.email ? normalizeEmail(invitation.email) : null;

      return res.status(200).json({
        success: true,
        invitation: {
          id: invitation.id,
          token: invitation.token,
          fullName: invitation.full_name,
          email: invitation.email,
          maskedEmail: normEmail?.masked || '',
          organizationName,
          organizationId: invitation.organization_id,
          role: 'TELECALLER',
          status: invitation.status,
          expiresAt: invitation.expires_at,
          createdAt: invitation.created_at,
        },
      });
    } catch (err: any) {
      console.error('invite GET error:', err);
      return res.status(500).json({ error: 'Failed to validate invitation.' });
    }
  }

  // -------------------------------------------------------------
  // POST: Create invitation (Owner or Admin authenticated)
  // -------------------------------------------------------------
  if (req.method === 'POST') {
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

      if (!profile.organization_id) {
        return res.status(403).json({ error: 'Your account is not assigned to an organization.' });
      }

      if (!isRealSupabaseServerConfigured() && process.env.NODE_ENV === 'production') {
        return res.status(503).json({
          error: 'Invitation creation requires a configured database.',
        });
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
      if (!await requirePaidEntitlement(res, profile)) return;

      let orgName = 'ENCRIX Workspace';
      const supabase = isRealSupabaseServerConfigured() ? getSupabaseServerClient() : null;
      const organizationId = profile.organization_id;

      // 2. Check if email is already a member of this organization
      if (supabase) {
        try {
          const { data: existingMember, error: memberError } = await supabase
            .from('profiles')
            .select('id, full_name, role, organization_id, email')
            .ilike('email', normalizedEmail)
            .eq('organization_id', profile.organization_id)
            .maybeSingle();

          if (memberError) {
            console.error('[invite] Member lookup failed', { code: memberError.code || 'unknown' });
            return res.status(503).json({ error: 'Unable to verify invitation eligibility. Please retry.' });
          }

          if (existingMember) {
            return res.status(400).json({
              error: `User with email ${normEmail.masked} is already a member of this organization (${existingMember.role}).`,
            });
          }

          const { data: orgData, error: orgError } = await supabase
            .from('organizations')
            .select('name')
            .eq('id', profile.organization_id)
            .single();
          if (orgError || !orgData) {
            console.error('[invite] Organization lookup failed', { code: orgError?.code || 'unknown' });
            return res.status(503).json({ error: 'Unable to verify organization details. Please retry.' });
          }
          if (orgData?.name) {
            orgName = orgData.name;
          }

          // The database's partial unique index treats every PENDING row as
          // active. Transition expired rows before checking for a resend or
          // inserting a replacement so an expired link cannot reserve an
          // email indefinitely. This mutation is scoped to the authenticated
          // inviter's organization and fails closed if persistence is unclear.
          const expiryCutoff = new Date().toISOString();
          const { error: expiryError } = await supabase
            .from('organization_invitations')
            .update({ status: 'EXPIRED' })
            .eq('organization_id', organizationId)
            .eq('status', 'PENDING')
            .lte('expires_at', expiryCutoff);
          if (expiryError) {
            console.error('[invite] Expired invitation transition failed', { code: expiryError.code || 'unknown' });
            return res.status(503).json({ error: 'Unable to refresh expired invitations. Please retry.' });
          }

          const { data: existingInvitation, error: pendingError } = await supabase
            .from('organization_invitations')
            .select('id, organization_id, phone_number, full_name, email, invited_by, role, status, token, expires_at, created_at')
            .eq('organization_id', organizationId)
            .ilike('email', normalizedEmail)
            .eq('status', 'PENDING')
            .gt('expires_at', new Date().toISOString())
            .maybeSingle();
          if (pendingError) {
            console.error('[invite] Pending invitation lookup failed', { code: pendingError.code || 'unknown' });
            return res.status(503).json({ error: 'Unable to verify existing invitations. Please retry.' });
          }
          if (existingInvitation) {
            const baseUrl = getInvitationBaseUrl(req);
            if (!baseUrl) return res.status(503).json({ error: 'Invitation delivery URL is not configured.' });
            const existingUrl = `${baseUrl}/accept-invitation?token=${existingInvitation.token}`;
            try {
              await sendInvitationEmail({
                recipient: normalizedEmail,
                recipientName: existingInvitation.full_name,
                organizationName: orgName,
                inviteUrl: existingUrl,
                expiresAt: existingInvitation.expires_at,
              });
            } catch (mailError: any) {
              console.error('[invite] Email delivery failed', { code: mailError?.code || 'EMAIL_DELIVERY_FAILED' });
              return res.status(502).json({ code: 'INVITATION_EMAIL_FAILED', error: 'Invitation email could not be delivered. You can retry safely.' });
            }
            return res.status(200).json({ success: true, emailSent: true, invitation: {
              id: existingInvitation.id,
              organization_id: organizationId,
              organizationId,
              organization_name: orgName,
              organizationName: orgName,
              full_name: existingInvitation.full_name,
              fullName: existingInvitation.full_name,
              email: normalizedEmail,
              maskedEmail: normEmail.masked,
              phone: existingInvitation.phone_number,
              role: 'TELECALLER',
              status: existingInvitation.status,
              expires_at: existingInvitation.expires_at,
              expiresAt: existingInvitation.expires_at,
              created_at: existingInvitation.created_at,
              inviteUrl: existingUrl,
            } });
          }
        } catch {
          return res.status(503).json({ error: 'Unable to verify invitation eligibility. Please retry.' });
        }
      }

      // 3. Generate Cryptographically Secure Invitation Token
      const token = `inv_${randomBytes(24).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days validity
      const canonicalBaseUrl = getInvitationBaseUrl(req);
      if (!canonicalBaseUrl) {
        return res.status(503).json({ error: 'Invitation delivery URL is not configured.' });
      }
      const inviteUrl = `${canonicalBaseUrl}/accept-invitation?token=${token}`;

      // 4. Create Invitation Record
      let invitation: any = null;
      if (supabase) {
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

          if (invErr) {
            console.error('[invite] Failed to insert organization_invitations row into Supabase:', {
              code: invErr.code,
              message: invErr.message,
            });
            if (invErr.code === '23505') {
              return res.status(409).json({ error: 'A pending invitation already exists for this email in the organization. Retry the existing invitation to resend it.' });
            }
            return res.status(500).json({ error: 'Database failed to persist invitation. Please verify database connectivity.' });
          } else if (data) {
            invitation = data;
          }
        } catch (dbErr: any) {
          console.error('[invite] Exception inserting organization_invitations row into Supabase:', {
            message: dbErr?.message,
          });
          return res.status(500).json({
            error: 'Database failed to persist invitation. Please verify database connectivity.',
          });
        }
      }

      if (!invitation) {
        if (process.env.NODE_ENV === 'production') {
          return res.status(503).json({
            error: 'Database failed to persist invitation. Please verify database connectivity.',
          });
        }
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
          created_at: new Date().toISOString(),
        };
      }

      try {
        await sendInvitationEmail({
          recipient: normalizedEmail,
          recipientName: fullName.trim(),
          organizationName: orgName,
          inviteUrl,
          expiresAt,
        });
      } catch (mailError: any) {
        console.error('[invite] Email delivery failed', { code: mailError?.code || 'EMAIL_DELIVERY_FAILED' });
        return res.status(502).json({
          code: 'INVITATION_EMAIL_FAILED',
          error: 'Invitation was saved but email delivery failed. Retry the same invitation request to resend safely.',
        });
      }

      // Store in server in-memory fallback store
      storeServerInvitation({
        id: invitation.id,
        organization_id: profile.organization_id,
        organization_name: orgName,
        phone_number: normalizedPhone,
        email: normalizedEmail,
        full_name: fullName.trim(),
        invited_by: profile.id,
        role: 'TELECALLER',
        status: 'PENDING',
        token,
        expires_at: expiresAt,
        created_at: invitation.created_at || new Date().toISOString(),
      });

      // 5. Audit Logging
      if (supabase) {
        try {
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
        } catch {
          // Audit logging fallback
        }
      }

      return res.status(200).json({
        success: true,
        emailSent: true,
        invitation: {
          id: invitation.id,
          organization_id: invitation.organization_id,
          organizationId: invitation.organization_id,
          organization_name: orgName,
          organizationName: orgName,
          full_name: invitation.full_name,
          fullName: invitation.full_name,
          email: normalizedEmail,
          maskedEmail: normEmail.masked,
          phone: normalizedPhone,
          maskedPhone,
          role: 'TELECALLER',
          status: invitation.status,
          token: invitation.token,
          expires_at: invitation.expires_at,
          expiresAt: invitation.expires_at,
          created_at: invitation.created_at,
          inviteUrl,
        },
      });
    } catch (err: any) {
      console.error('invite POST error:', err);
      return res.status(500).json({ error: err.message || 'Failed to send invitation.' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed. Use GET or POST.' });
}

function getInvitationBaseUrl(req: any): string | null {
  const configured = process.env.APP_URL;
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production') return null;
      if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
      return parsed.origin;
    } catch {
      return null;
    }
  }
  if (process.env.NODE_ENV === 'production') return null;
  try {
    return new URL(getCanonicalBaseUrl(req)).origin;
  } catch {
    return null;
  }
}
