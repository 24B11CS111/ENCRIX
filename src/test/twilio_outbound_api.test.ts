import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  profile: null as any,
  caller: null as any,
  lead: null as any,
  prepared: null as any,
  rpc: vi.fn(),
  config: null as any,
  configLookup: vi.fn(),
  createCall: vi.fn(),
  attachResult: true,
  prepareError: null as any,
}));

vi.mock('../../api/_lib/supabaseServer.js', () => ({
  authenticateServerRequest: async () => ({ user: state.profile ? { id: state.profile.user_id } : null, profile: state.profile, error: null }),
  isRealSupabaseServerConfigured: () => true,
  getSupabaseServerClient: () => ({
    from(table: string) {
      let selected = '';
      const filters: Record<string, unknown> = {};
      const query: any = {
        select(value: string) { selected = value; return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        maybeSingle: async () => {
          if (table === 'profiles') return { data: filters.id === state.caller?.id ? state.caller : null, error: null };
          if (table === 'leads') {
            const lead = state.lead;
            return { data: lead && Object.entries(filters).every(([key, value]) => (lead as any)[key] === value) ? lead : null, error: null };
          }
          return { data: null, error: null };
        },
        update: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
      };
      void selected;
      return query;
    },
    rpc: state.rpc,
  }),
}));

vi.mock('../../api/_lib/twilioOrganizationConfig.js', () => ({
  getOrganizationTwilioConfig: (...args: any[]) => state.configLookup(...args),
}));

vi.mock('../../api/_lib/twilioRest.js', () => ({
  createOrganizationTwilioCall: (...args: any[]) => state.createCall(...args),
  endOrganizationTwilioCall: vi.fn(),
  isTwilioCallingEnabled: () => true,
  telephonyWebhookUrl: (path: string, params: Record<string, string>) => `https://encrix.example/api/telephony/${path}?${new URLSearchParams(params)}`,
}));

import handler from '../../api/telephony/call';

const organizationId = '10000000-0000-4000-8000-000000000001';
const otherOrganizationId = '10000000-0000-4000-8000-000000000002';
const profileId = '11000000-0000-4000-8000-000000000001';
const leadId = '12000000-0000-4000-8000-000000000001';
const callId = '13000000-0000-4000-8000-000000000001';
const idempotencyKey = '14000000-0000-4000-8000-000000000001';
const accountSid = `AC${'a'.repeat(32)}`;
const authToken = 'synthetic-tenant-auth-token-0123456789';
const fromPhone = '+14155552671';
const callerPhone = '+14155550199';
const customerPhone = '+14155550111';

function request(body: Record<string, unknown> = { leadId, idempotencyKey }) {
  const req = { method: 'POST', headers: { authorization: 'Bearer synthetic-session' }, body, query: {} };
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  vi.stubEnv('TWILIO_PUBLIC_WEBHOOK_BASE_URL', 'https://encrix.example');
  state.profile = { id: profileId, user_id: '15000000-0000-4000-8000-000000000001', organization_id: organizationId, role: 'TELECALLER', status: 'ACTIVE' };
  state.caller = { ...state.profile, phone: callerPhone, phone_verified: true };
  state.lead = { id: leadId, organization_id: organizationId, assigned_to: profileId, phone: customerPhone, status: 'ASSIGNED' };
  state.prepared = { call_id: callId, call_status: 'INITIATED', reused: false };
  state.prepareError = null;
  state.config = { record: { organization_id: organizationId, updated_at: '2026-10-31T00:00:00.000Z' }, credentials: { accountSid, authToken, phoneNumber: fromPhone } };
  state.configLookup.mockReset().mockImplementation(async (_client: unknown, org: string) => org === organizationId ? state.config : null);
  state.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === 'organization_has_active_paid_entitlement') return { data: true, error: null };
    if (name === 'prepare_twilio_outbound_call') return { data: state.prepared, error: state.prepareError };
    if (name === 'attach_twilio_leg_sid') return { data: state.attachResult, error: null };
    return { data: null, error: { code: '42883' } };
  });
  state.createCall.mockReset().mockResolvedValue({ ok: true, status: 201, callSid: `CA${'b'.repeat(32)}`, providerStatus: 'queued' });
});

afterEach(() => vi.unstubAllEnvs());

describe('organization-scoped outbound Twilio API', () => {
  it('authorizes the assigned lead and starts the caller leg using only that organization account', async () => {
    const call = request();
    await handler(call.req, call.res);
    expect(call.res.statusCode).toBe(202);
    expect(state.configLookup).toHaveBeenCalledWith(expect.anything(), organizationId);
    expect(state.rpc).toHaveBeenCalledWith('prepare_twilio_outbound_call', {
      p_organization_id: organizationId, p_telecaller_id: profileId, p_lead_id: leadId, p_idempotency_key: idempotencyKey,
      p_twilio_config_updated_at: '2026-10-31T00:00:00.000Z',
    });
    expect(state.createCall).toHaveBeenCalledWith(state.config.credentials, expect.objectContaining({ to: callerPhone, from: fromPhone }));
    expect(JSON.stringify(call.res.body)).not.toContain(customerPhone);
    expect(JSON.stringify(call.res.body)).not.toContain(authToken);
    expect(JSON.stringify(call.res.body)).not.toContain(`CA${'b'.repeat(32)}`);
  });

  it('rejects cross-organization and unassigned leads before contacting the provider', async () => {
    state.lead = { ...state.lead, organization_id: otherOrganizationId };
    let call = request();
    await handler(call.req, call.res);
    expect(call.res.statusCode).toBe(404);
    expect(state.createCall).not.toHaveBeenCalled();

    state.lead = { ...state.lead, organization_id: organizationId, assigned_to: '16000000-0000-4000-8000-000000000001' };
    call = request();
    await handler(call.req, call.res);
    expect(call.res.statusCode).toBe(404);
    expect(state.rpc).not.toHaveBeenCalledWith('prepare_twilio_outbound_call', expect.anything());
  });

  it('does not create another provider call for a repeated idempotency request', async () => {
    state.prepared = { call_id: callId, call_status: 'INITIATED', reused: true };
    const call = request();
    await handler(call.req, call.res);
    expect(call.res.statusCode).toBe(202);
    expect(call.res.body).toMatchObject({ callId, accepted: false });
    expect(state.createCall).not.toHaveBeenCalled();
  });

  it('marks an uncertain provider result for recovery and never retries blindly', async () => {
    state.createCall.mockResolvedValue({ ok: false, status: 0, retryable: true });
    const call = request();
    await handler(call.req, call.res);
    expect(call.res.statusCode).toBe(503);
    expect(call.res.body.error).toMatch(/uncertain/i);
    expect(state.createCall).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(state.rpc).toHaveBeenNthCalledWith(1, 'organization_has_active_paid_entitlement', {
      p_organization_id: organizationId,
    });
    expect(state.rpc).toHaveBeenNthCalledWith(2, 'prepare_twilio_outbound_call', expect.any(Object));
  });

  it('rejects a credential version changed between lookup and transactional call preparation', async () => {
    state.prepareError = { code: '40001' };
    const call = request();
    await handler(call.req, call.res);
    expect(call.res.statusCode).toBe(409);
    expect(call.res.body.error).toMatch(/configuration changed/i);
    expect(state.createCall).not.toHaveBeenCalled();
  });
});
