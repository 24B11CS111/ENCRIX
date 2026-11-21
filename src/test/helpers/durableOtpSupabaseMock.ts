import { getServerInvitation, updateServerInvitationStatus } from '../../../api/_lib/invitationServer';
import { createVerificationTicket, hashOtp, verifyVerificationTicket } from '../../../api/_lib/otpServer';

/** Durable-state Supabase test double for OTP route integration tests. */
export function createDurableOtpSupabaseMock() {
  const rows: any[] = [];
  const profiles: any[] = [];
  const orgs = new Map<string, any>();
  const invitationsById = new Map<string, any>();
  let nextId = 0;
  const client: any = {
    from(table: string) {
      const filters: Array<[string, any, string]> = [];
      let updateValue: any;
      let insertValue: any;
      let deleteRequested = false;
      const matching = () => {
        const source = table === 'email_otps' ? rows
          : table === 'profiles' ? profiles
            : table === 'organizations' ? [...orgs.values()]
              : table === 'organization_invitations' ? [] : [];
        return source.filter((row: any) => filters.every(([key, value, op]) => {
          if (op === 'gt') return row[key] > value;
          return row[key] === value;
        }));
      };
      const builder: any = {
        select(_columns?: string) { return builder; },
        eq(key: string, value: any) { filters.push([key, value, 'eq']); return builder; },
        gt(key: string, value: any) { filters.push([key, value, 'gt']); return builder; },
        order(key: string, options?: any) {
          const result = matching();
          result.sort((a: any, b: any) => options?.ascending ? String(a[key]).localeCompare(String(b[key])) : String(b[key]).localeCompare(String(a[key])));
          return builder;
        },
        limit(count: number) { return Promise.resolve({ data: matching().slice(0, count), error: null }); },
        maybeSingle() {
          if (table === 'organization_invitations') {
            const token = filters.find(([key]) => key === 'token')?.[1];
            const id = filters.find(([key]) => key === 'id')?.[1];
            const invitation = token ? getServerInvitation(token) : invitationsById.get(String(id)) || null;
            if (!invitation) return Promise.resolve({ data: null, error: null });
            invitationsById.set(invitation.id, invitation);
            if (updateValue && filters.some(([key, value]) => key === 'id' && value === invitation.id) &&
                filters.some(([key, value]) => key === 'status' && value === invitation.status)) {
              Object.assign(invitation, updateValue);
              updateServerInvitationStatus(token, updateValue.status);
              return Promise.resolve({ data: invitation, error: null });
            }
            orgs.set(invitation.organization_id, {
              id: invitation.organization_id,
              name: invitation.organization_name || 'ENCRIX Workspace',
              status: 'ACTIVE',
            });
            return Promise.resolve({ data: invitation, error: null });
          }
          return Promise.resolve({ data: matching()[0] || null, error: null });
        },
        single() {
          if (insertValue) {
            const row = { id: `fixture-${++nextId}`, ...insertValue };
            if (table === 'profiles') profiles.push(row);
            return Promise.resolve({ data: row, error: null });
          }
          const row = matching()[0] || null;
          return Promise.resolve(row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } });
        },
        insert(value: any) { insertValue = value; return builder; },
        update(value: any) { updateValue = value; return builder; },
        delete() { deleteRequested = true; return builder; },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          if (insertValue) {
            const values = Array.isArray(insertValue) ? insertValue : [insertValue];
            const inserted = values.map((value: any) => {
              const row = { id: `fixture-${++nextId}`, ...value };
              if (table === 'email_otps') rows.push(row);
              if (table === 'profiles') profiles.push(row);
              return row;
            });
            return Promise.resolve({ data: inserted, error: null }).then(resolve, reject);
          }
          if (updateValue) {
            const updated = matching();
            updated.forEach((row: any) => Object.assign(row, updateValue));
            return Promise.resolve({ data: updated, error: null }).then(resolve, reject);
          }
          if (deleteRequested) {
            const selected = new Set(matching());
            for (let i = rows.length - 1; i >= 0; i -= 1) if (selected.has(rows[i])) rows.splice(i, 1);
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name: string, args: any) {
      if (name === 'issue_email_otp_ticket') {
        if (rows.some((row) => row.email === args.p_email && row.purpose === args.p_purpose && !row.used &&
          new Date(row.resend_after).getTime() > Date.now())) {
          return { data: { issued: false, reason: 'cooldown', cooldown_seconds: 30 }, error: null };
        }
        const active = rows.filter((row) => row.email === args.p_email && row.purpose === args.p_purpose && !row.used);
        active.forEach((row) => { row.used = true; });
        rows.push({
          id: `fixture-${++nextId}`, ticket_id: args.p_ticket_id, email: args.p_email,
          purpose: args.p_purpose, otp_hash: args.p_otp_hash, attempts: 0,
          resend_after: args.p_resend_after, expires_at: args.p_expires_at,
          used: false, verified_at: null, created_at: new Date().toISOString(),
        });
        return { data: { issued: true }, error: null };
      }
      if (name === 'complete_email_otp_verification') {
        const row = rows.find((entry) => entry.ticket_id === args.p_ticket_id && entry.email === args.p_email && entry.purpose === args.p_purpose);
        if (!row || row.used) return { data: { verified: false, reason: row ? 'consumed' : 'unavailable' }, error: null };
        if (new Date(row.expires_at).getTime() <= Date.now()) { row.used = true; return { data: { verified: false, reason: 'expired' }, error: null }; }
        if (row.attempts >= 5) { row.used = true; return { data: { verified: false, reason: 'locked', attempts: row.attempts }, error: null }; }
        if (!args.p_is_valid) {
          row.attempts += 1;
          if (row.attempts >= 5) row.used = true;
          return { data: { verified: false, reason: row.used ? 'locked' : 'invalid', attempts: row.attempts }, error: null };
        }
        row.used = true;
        row.verified_at = new Date().toISOString();
        return { data: { verified: true, attempts: row.attempts }, error: null };
      }
      if (name === 'cancel_email_otp_ticket') {
        const row = rows.find((entry) => entry.ticket_id === args.p_ticket_id && entry.email === args.p_email && entry.purpose === args.p_purpose);
        if (!row) return { data: false, error: null };
        row.used = true;
        return { data: true, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { client, rows, profiles };
}

export function seedDurableOtp(rows: any[], email: string, otp: string, purpose: 'LOGIN' | 'INVITATION', inviteToken?: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const otpHash = hashOtp(normalizedEmail, otp);
  const ticket = createVerificationTicket({ email: normalizedEmail, purpose, otpHash, expiresAt, inviteToken });
  const payload = verifyVerificationTicket(ticket);
  if (!payload) throw new Error('Test OTP ticket could not be verified');
  rows.push({
    id: `fixture-seed-${rows.length + 1}`, ticket_id: payload.ticketId, email: normalizedEmail,
    purpose, otp_hash: otpHash, attempts: 0, expires_at: expiresAt,
    resend_after: new Date(Date.now() - 1_000).toISOString(), used: false, verified_at: null,
    created_at: new Date().toISOString(),
  });
  return ticket;
}
