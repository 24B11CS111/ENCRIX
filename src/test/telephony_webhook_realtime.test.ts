import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const webhookState = vi.hoisted(() => ({
  call: null as any,
  bridge: null as any,
  event: null as any,
  securityEvents: [] as any[],
  broadcast: null as any,
  receiptExists: false,
  pipelineResult: { success: true, storagePath: null as string | null } as any,
  pipelineCalls: [] as any[],
  channel: vi.fn(),
}));

vi.mock('../../api/_lib/supabaseServer.js', () => ({
  isRealSupabaseServerConfigured: () => true,
  getSupabaseServerClient: () => ({
    from(table: string) {
      if (table === 'webhook_events') {
        return {
          insert: async (value: unknown) => {
            webhookState.event = value;
            if (webhookState.receiptExists) return { error: { code: '23505' } };
            webhookState.receiptExists = true;
            return { error: null };
          },
        };
      }
      if (table === 'security_events') return { insert: async (value: unknown) => { webhookState.securityEvents.push(value); return { error: null }; } };

      let updateValue: any = null;
      const filters: Record<string, unknown> = {};
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        in: (key: string, values: unknown[]) => { filters[`in:${key}`] = values; return query; },
        maybeSingle: async () => ({
          data: (() => {
            const row = table === 'call_bridges' ? webhookState.bridge : webhookState.call;
            if (!row) return null;
            if (updateValue) {
              const filterColumn = Object.keys(filters).find((key) => key.startsWith('in:'))?.slice(3);
              const allowed = filterColumn ? filters[`in:${filterColumn}`] as unknown[] : null;
              if (filterColumn && allowed && !allowed.includes(row[filterColumn])) return null;
              Object.assign(row, updateValue);
              return { call_id: row.call_id || row.id };
            }
            return { ...row };
          })(),
          error: null,
        }),
        update: (value: unknown) => { updateValue = value; return query; },
        then: (resolve: (value: unknown) => unknown) => {
          const target = table === 'call_bridges' ? webhookState.bridge : webhookState.call;
          if (target && updateValue) Object.assign(target, updateValue);
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return query;
    },
    channel: webhookState.channel.mockImplementation(() => ({
      send: async (message: unknown) => { webhookState.broadcast = message; },
    })),
  }),
}));

vi.mock('../../api/_lib/twilioOrganizationConfig.js', () => ({
  getOrganizationTwilioConfig: async () => ({
    record: { organization_id: webhookState.call?.organization_id },
    credentials: {
      accountSid: `AC${'a'.repeat(32)}`,
      authToken: 'synthetic-webhook-signature-test-key',
      phoneNumber: '+14155552671',
    },
  }),
}));

vi.mock('../../api/_lib/recordingPipeline.js', () => ({
  validateTwilioRecordingUrl: (url: string) => ({ valid: url.startsWith('https://api.twilio.com/') }),
  downloadAndStoreRecording: async (options: unknown) => {
    webhookState.pipelineCalls.push(options);
    return webhookState.pipelineResult;
  },
}));

import webhookHandler from '../../api/telephony/webhook';

const callbackUrl = 'https://calls.example.test/api/telephony/webhook';
const authToken = 'synthetic-webhook-signature-test-key';
const callSid = `CA${'f'.repeat(32)}`;
const bridgeId = '20000000-0000-4000-8000-000000000001';
const orgId = '10000000-0000-4000-8000-000000000001';

function sign(url: string, params: Record<string, string>): string {
  let signed = url;
  for (const key of Object.keys(params).sort()) signed += key + params[key];
  return crypto.createHmac('sha1', authToken).update(signed).digest('base64');
}

function setFixtures() {
  webhookState.call = {
    id: bridgeId,
    organization_id: orgId,
    lead_id: '11000000-0000-4000-8000-000000000001',
    telecaller_id: '12000000-0000-4000-8000-000000000001',
    provider: 'TWILIO',
    provider_call_id: callSid,
    status: 'IN_PROGRESS',
    duration_seconds: 0,
    recording_url: null,
  };
  webhookState.bridge = {
    call_id: bridgeId,
    organization_id: orgId,
    flow: 'OUTBOUND',
    caller_provider_call_id: callSid,
    customer_provider_call_id: null,
    caller_leg_state: 'IN_PROGRESS',
    customer_leg_state: 'PENDING',
    status: 'CALLER_CONNECTED',
  };
}

function makeRequest(params: Record<string, string>) {
  const eventUrl = `${callbackUrl}?bridge_id=${bridgeId}&leg=caller`;
  return {
    method: 'POST',
    headers: { 'x-twilio-signature': sign(eventUrl, params), host: 'untrusted.example.test' },
    body: params,
    url: `/api/telephony/webhook?bridge_id=${bridgeId}&leg=caller`,
    query: { bridge_id: bridgeId, leg: 'caller' },
  };
}

function response(): any {
  return {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  webhookState.call = null;
  webhookState.bridge = null;
  webhookState.event = null;
  webhookState.securityEvents = [];
  webhookState.broadcast = null;
  webhookState.receiptExists = false;
  webhookState.pipelineResult = { success: true, storagePath: null };
  webhookState.pipelineCalls = [];
  webhookState.channel.mockClear();
});

describe('Twilio webhook privacy boundary', () => {
  it('rejects invalid tenant-account signatures before changing call state', async () => {
    vi.stubEnv('TWILIO_PUBLIC_WEBHOOK_BASE_URL', 'https://calls.example.test');
    setFixtures();
    const req: any = makeRequest({ CallSid: callSid, CallStatus: 'completed' });
    req.headers['x-twilio-signature'] = 'invalid';
    const res = response();
    await webhookHandler(req, res);
    expect(res.statusCode).toBe(401);
    expect(webhookState.call.status).toBe('IN_PROGRESS');
    expect(webhookState.bridge.caller_leg_state).toBe('IN_PROGRESS');
  });

  it('rejects malformed provider duration fields before changing state', async () => {
    vi.stubEnv('TWILIO_PUBLIC_WEBHOOK_BASE_URL', 'https://calls.example.test');
    setFixtures();
    const req: any = makeRequest({ CallSid: callSid, CallStatus: 'completed', CallDuration: 'not-a-duration' });
    const res = response();
    await webhookHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(webhookState.call.status).toBe('IN_PROGRESS');
  });

  it('records an untrusted recording URL as a security event without returning or storing it', async () => {
    vi.stubEnv('TWILIO_PUBLIC_WEBHOOK_BASE_URL', 'https://calls.example.test');
    setFixtures();
    const maliciousUrl = 'https://attacker.example/recording.mp3';
    const res = response();
    await webhookHandler(makeRequest({
      CallSid: callSid, CallStatus: 'completed', RecordingUrl: maliciousUrl, SequenceNumber: '8',
    }) as any, res);
    expect(res.statusCode).toBe(200);
    expect(webhookState.securityEvents).toHaveLength(1);
    expect(webhookState.pipelineCalls).toHaveLength(0);
    expect(JSON.stringify({ body: res.body, event: webhookState.event, call: webhookState.call })).not.toContain(maliciousUrl);
  });

  it('stores only allowlisted call status fields and does not broadcast without private-channel authorization', async () => {
    vi.stubEnv('TWILIO_PUBLIC_WEBHOOK_BASE_URL', 'https://calls.example.test');
    setFixtures();
    const params = {
      CallSid: callSid,
      CallStatus: 'completed',
      CallDuration: '12',
      SequenceNumber: '3',
      From: '+15550009999',
    };
    const req: any = makeRequest(params);
    const res = response();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(webhookState.call.status).toBe('COMPLETED');
    expect(webhookState.event.payload).toEqual({
      CallStatus: 'completed',
      CallDuration: '12',
      SequenceNumber: '3',
      RecordingDuration: undefined,
    });
    expect(webhookState.channel).not.toHaveBeenCalled();

    const realtimeAndResponse = JSON.stringify({ broadcast: webhookState.broadcast, response: res.body });
    expect(realtimeAndResponse).not.toContain(callSid);
    expect(realtimeAndResponse).not.toContain('+15550009999');
    expect(realtimeAndResponse).not.toContain('RecordingUrl');
    expect(JSON.stringify(webhookState.event.payload)).not.toContain('+15550009999');
    expect(JSON.stringify(webhookState.event.payload)).not.toContain('RecordingUrl');
  });

  it('retries a transient recording failure without marking the event processed and deduplicates after success', async () => {
    vi.stubEnv('TWILIO_PUBLIC_WEBHOOK_BASE_URL', 'https://calls.example.test');
    setFixtures();
    const params = {
      CallSid: callSid,
      CallStatus: 'completed',
      CallDuration: '12',
      SequenceNumber: '7',
      RecordingUrl: `https://api.twilio.com/2010-04-01/Accounts/AC${'a'.repeat(32)}/Recordings/RE${'b'.repeat(32)}`,
    };
    const req: any = makeRequest(params);

    webhookState.pipelineResult = { success: false, storagePath: null, error: 'temporary failure' };
    const firstRes = response();
    await webhookHandler(req, firstRes);
    expect(firstRes.statusCode).toBe(503);
    expect(webhookState.call.status).toBe('IN_PROGRESS');
    expect(webhookState.pipelineCalls).toHaveLength(1);

    webhookState.pipelineResult = {
      success: true,
      storagePath: `${webhookState.call.organization_id}/${webhookState.call.id}.mp3`,
    };
    const retryRes = response();
    await webhookHandler(req, retryRes);
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.body.duplicate).toBe(false);
    expect(webhookState.pipelineCalls).toHaveLength(2);
    expect(webhookState.call.status).toBe('COMPLETED');
    expect(webhookState.call.recording_url).toBe(webhookState.pipelineResult.storagePath);

    const duplicateRes = response();
    await webhookHandler(req, duplicateRes);
    expect(duplicateRes.statusCode).toBe(200);
    expect(duplicateRes.body.duplicate).toBe(true);
    expect(webhookState.pipelineCalls).toHaveLength(2);
  });

  it('does not let an out-of-order ringing event reopen a terminal provider leg or call', async () => {
    vi.stubEnv('TWILIO_PUBLIC_WEBHOOK_BASE_URL', 'https://calls.example.test');
    setFixtures();
    const completed = response();
    await webhookHandler(makeRequest({ CallSid: callSid, CallStatus: 'completed', SequenceNumber: '9' }) as any, completed);
    expect(completed.statusCode).toBe(200);
    expect(webhookState.call.status).toBe('COMPLETED');
    expect(webhookState.bridge.caller_leg_state).toBe('COMPLETED');

    const stale = response();
    await webhookHandler(makeRequest({ CallSid: callSid, CallStatus: 'ringing', SequenceNumber: '2' }) as any, stale);
    expect(stale.statusCode).toBe(200);
    expect(webhookState.call.status).toBe('COMPLETED');
    expect(webhookState.bridge.caller_leg_state).toBe('COMPLETED');
  });
});
