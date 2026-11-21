import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  enabled: true,
  config: null as any,
  rpcData: [{ outcome: 'ROUTED', call_id: '20000000-0000-4000-8000-000000000001', telecaller_phone: '+14155550199' }] as any,
  rpc: vi.fn(),
  getByNumber: vi.fn(),
  bridge: null as any,
  getConfig: vi.fn(),
}));

vi.mock('../../api/_lib/supabaseServer', () => ({
  isRealSupabaseServerConfigured: () => true,
  getSupabaseServerClient: () => ({
    rpc: state.rpc,
    from: () => {
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: state.bridge, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock('../../api/_lib/twilioOrganizationConfig', () => ({
  getOrganizationForTwilioNumber: (...args: any[]) => state.getByNumber(...args),
  getOrganizationTwilioConfig: (...args: any[]) => state.getConfig(...args),
}));
vi.mock('../../api/_lib/twilioRest', () => ({
  getPublicTelephonyWebhookBase: () => 'https://encrix.example',
  isTwilioCallingEnabled: () => state.enabled,
  telephonyWebhookUrl: (path: string, params: Record<string, string>) => {
    const url = new URL(`/api/telephony/${path}`, 'https://encrix.example');
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  },
}));

import voiceHandler from '../../api/telephony/voice';

const token = 'tenant-account-auth-token-for-test';
const orgId = '5ed8c7cb-63ab-4c78-848a-cd754f5716e3';
const callSid = `CA${'a'.repeat(32)}`;
const inboundNumber = '+14155552671';
const leadPhone = '+14155550111';

function signature(params: Record<string, string>, url = 'https://encrix.example/api/telephony/voice') {
  const data = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  return createHmac('sha1', token).update(data).digest('base64');
}

function request(options: { params?: Record<string, string>; signature?: string; query?: Record<string, string>; url?: string } = {}) {
  const params = options.params || { CallSid: callSid, From: leadPhone, To: inboundNumber };
  const req = {
    method: 'POST', url: options.url || '/api/telephony/voice', query: options.query || {},
    headers: { 'x-twilio-signature': options.signature || signature(params) },
    body: params,
  };
  const res: any = {
    statusCode: 200, body: '', headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.statusCode = code; return this; },
    send(body: string) { this.body = body; return this; },
  };
  return { req, res };
}

describe('organization-specific Twilio inbound routing', () => {
  beforeEach(() => {
    state.enabled = true;
    state.config = {
      record: { organization_id: orgId, twilio_phone_number: inboundNumber, updated_at: '2026-10-31T00:00:00.000Z' },
      credentials: { accountSid: `AC${'a'.repeat(32)}`, authToken: token, phoneNumber: inboundNumber },
    };
    state.rpcData = [{ outcome: 'ROUTED', call_id: '20000000-0000-4000-8000-000000000001', telecaller_phone: '+14155550199' }];
    state.rpc.mockReset().mockImplementation(async (name: string) => name === 'organization_has_active_paid_entitlement'
      ? { data: true, error: null }
      : { data: state.rpcData, error: null });
    state.getConfig.mockReset().mockResolvedValue(state.config);
    state.getByNumber.mockReset().mockImplementation(async (_supabase: unknown, phone: string) =>
      phone === inboundNumber ? state.config : null);
    state.getConfig.mockReset().mockResolvedValue(state.config);
    vi.stubEnv('TWILIO_PUBLIC_WEBHOOK_BASE_URL', 'https://encrix.example');
  });

  it('routes only to the verified assigned number returned by the tenant resolver', async () => {
    const call = request({ params: { CallSid: callSid, From: leadPhone, To: inboundNumber } });
    await voiceHandler(call.req, call.res);
    expect(call.res.statusCode).toBe(200);
    expect(call.res.headers['Content-Type']).toContain('text/xml');
    expect(call.res.body).toContain('<Dial');
    expect(call.res.body).toContain('+14155550199');
    expect(call.res.body).not.toContain('+14155552671');
    expect(state.getByNumber).toHaveBeenCalledWith(expect.anything(), inboundNumber);
    expect(state.rpc).toHaveBeenCalledWith('prepare_twilio_inbound_call', {
      p_organization_id: orgId, p_call_sid: callSid, p_from_phone: leadPhone,
      p_twilio_phone_number: inboundNumber, p_twilio_config_updated_at: '2026-10-31T00:00:00.000Z',
    });
  });

  it('rejects invalid signatures before asking the database to route a number', async () => {
    const call = request({ signature: 'invalid' });
    await voiceHandler(call.req, call.res);
    expect(call.res.statusCode).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(call.res.body).not.toContain(leadPhone);
  });

  it('fails closed for no exact lead or unavailable caller without dialing a submitted destination', async () => {
    state.rpcData = [{ outcome: 'NO_MATCHING_LEAD', call_id: null, telecaller_phone: null }];
    const call = request({ params: { CallSid: callSid, From: leadPhone, To: inboundNumber, Destination: '+14155550999' } });
    // The signature must cover every Twilio-provided parameter.
    call.req.headers['x-twilio-signature'] = signature(call.req.body);
    await voiceHandler(call.req, call.res);
    expect(call.res.statusCode).toBe(200);
    expect(call.res.body).toContain('<Hangup/>');
    expect(call.res.body).not.toContain('+14155550999');
    expect(state.rpc).toHaveBeenCalledWith('prepare_twilio_inbound_call', expect.objectContaining({ p_from_phone: leadPhone }));
  });

  it('records signed inbound attempts and refuses to route while the server gate is off', async () => {
    state.enabled = false;
    const call = request();
    await voiceHandler(call.req, call.res);
    expect(call.res.statusCode).toBe(200);
    expect(call.res.body).toContain('<Hangup/>');
    expect(state.rpc).toHaveBeenCalledWith('record_twilio_inbound_attempt', {
      p_organization_id: orgId, p_call_sid: callSid, p_outcome: 'PROVIDER_ERROR',
    });
    expect(state.rpc).not.toHaveBeenCalledWith('prepare_twilio_inbound_call', expect.anything());
  });

  it('rejects unmatched or multiply matched Twilio numbers without guessing a tenant', async () => {
    state.getByNumber.mockResolvedValueOnce(null);
    const call = request();
    await voiceHandler(call.req, call.res);
    expect(call.res.statusCode).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('uses the persisted outbound conference ID after validating the tenant signature', async () => {
    const bridgeId = '20000000-0000-4000-8000-000000000002';
    const conferenceId = '30000000-0000-4000-8000-000000000003';
    state.bridge = {
      call_id: bridgeId,
      organization_id: orgId,
      conference_id: conferenceId,
      caller_provider_call_id: callSid,
      customer_provider_call_id: null,
      flow: 'OUTBOUND',
      status: 'WAITING_FOR_CALLER',
    };
    const path = `/api/telephony/voice?bridge_id=${bridgeId}&leg=caller`;
    const call = request({
      url: path,
      query: { bridge_id: bridgeId, leg: 'caller' },
      params: { CallSid: callSid },
      signature: signature({ CallSid: callSid }, `https://encrix.example${path}`),
    });
    await voiceHandler(call.req, call.res);
    expect(call.res.statusCode).toBe(200);
    expect(call.res.body).toContain(`encrix-${conferenceId}`);
    expect(call.res.body).not.toContain(bridgeId);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
