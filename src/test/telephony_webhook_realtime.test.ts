import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const webhookState = vi.hoisted(() => ({
  call: null as any,
  event: null as any,
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
      if (table === 'security_events') return { insert: async () => ({ error: null }) };

      let updateValue: any = null;
      const query: any = {
        select: () => query,
        eq: () => query,
        in: () => query,
        maybeSingle: async () => {
          if (updateValue) Object.assign(webhookState.call, updateValue);
          return { data: { ...webhookState.call }, error: null };
        },
        update: (value: unknown) => { updateValue = value; return query; },
      };
      return query;
    },
    channel: webhookState.channel.mockImplementation(() => ({
      send: async (message: unknown) => { webhookState.broadcast = message; },
    })),
  }),
}));

vi.mock('../../api/_lib/recordingPipeline.js', () => ({
  validateTwilioRecordingUrl: () => ({ valid: true }),
  downloadAndStoreRecording: async (options: unknown) => {
    webhookState.pipelineCalls.push(options);
    return webhookState.pipelineResult;
  },
}));

import webhookHandler from '../../api/telephony/webhook';

const callbackUrl = 'https://calls.example.test/api/telephony/webhook';
const authToken = 'synthetic-webhook-signature-test-key';
const callSid = `CA${'f'.repeat(32)}`;

function sign(url: string, params: Record<string, string>): string {
  let signed = url;
  for (const key of Object.keys(params).sort()) signed += key + params[key];
  return crypto.createHmac('sha1', authToken).update(signed).digest('base64');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  webhookState.call = null;
  webhookState.event = null;
  webhookState.broadcast = null;
  webhookState.receiptExists = false;
  webhookState.pipelineResult = { success: true, storagePath: null };
  webhookState.pipelineCalls = [];
  webhookState.channel.mockClear();
});

describe('Twilio webhook privacy boundary', () => {
  it('stores only allowlisted call status fields and does not broadcast without private-channel authorization', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', authToken);
    vi.stubEnv('TWILIO_STATUS_CALLBACK_URL', callbackUrl);
    webhookState.call = {
      id: 'call-20000000-0000-4000-8000-000000000001',
      organization_id: 'org-10000000-0000-4000-8000-000000000001',
      lead_id: 'lead-10000000-0000-4000-8000-000000000001',
      telecaller_id: 'profile-10000000-0000-4000-8000-000000000001',
      provider: 'TWILIO',
      provider_call_id: callSid,
      status: 'IN_PROGRESS',
      duration_seconds: 0,
      recording_url: null,
    };

    const params = {
      CallSid: callSid,
      CallStatus: 'completed',
      CallDuration: '12',
      SequenceNumber: '3',
      From: '+15550009999',
    };
    const signature = sign(callbackUrl, params);
    const req: any = {
      method: 'POST',
      headers: { 'x-twilio-signature': signature, host: 'untrusted.example.test' },
      body: params,
      url: '/api/telephony/webhook',
    };
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.body = body; return this; },
    };

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

  it('retries a failed recording pipeline for a duplicate webhook receipt without duplicating stored recordings', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', authToken);
    vi.stubEnv('TWILIO_STATUS_CALLBACK_URL', callbackUrl);
    webhookState.call = {
      id: 'call-20000000-0000-4000-8000-000000000002',
      organization_id: 'org-10000000-0000-4000-8000-000000000002',
      lead_id: 'lead-10000000-0000-4000-8000-000000000002',
      telecaller_id: 'profile-10000000-0000-4000-8000-000000000002',
      provider: 'TWILIO',
      provider_call_id: callSid,
      status: 'IN_PROGRESS',
      duration_seconds: 0,
      recording_url: null,
    };
    const params = {
      CallSid: callSid,
      CallStatus: 'completed',
      CallDuration: '12',
      SequenceNumber: '7',
      RecordingUrl: `https://api.twilio.com/2010-04-01/Accounts/AC${'a'.repeat(32)}/Recordings/RE${'b'.repeat(32)}`,
    };
    const req: any = {
      method: 'POST',
      headers: { 'x-twilio-signature': sign(callbackUrl, params) },
      body: params,
      url: '/api/telephony/webhook',
    };
    const response = (): any => ({
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.body = body; return this; },
    });

    webhookState.pipelineResult = { success: false, storagePath: null, error: 'temporary failure' };
    const firstRes: any = response();
    await webhookHandler(req, firstRes);
    expect(firstRes.statusCode).toBe(503);
    expect(webhookState.call.status).toBe('IN_PROGRESS');
    expect(webhookState.pipelineCalls).toHaveLength(1);

    webhookState.pipelineResult = {
      success: true,
      storagePath: `${webhookState.call.organization_id}/${webhookState.call.id}.mp3`,
    };
    const retryRes: any = response();
    await webhookHandler(req, retryRes);
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.body.duplicate).toBe(true);
    expect(webhookState.pipelineCalls).toHaveLength(2);
    expect(webhookState.call.status).toBe('COMPLETED');
    expect(webhookState.call.recording_url).toBe(webhookState.pipelineResult.storagePath);

    const duplicateAfterSuccessRes: any = response();
    await webhookHandler(req, duplicateAfterSuccessRes);
    expect(duplicateAfterSuccessRes.statusCode).toBe(200);
    expect(webhookState.pipelineCalls).toHaveLength(2);
  });
});
