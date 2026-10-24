import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Profile, TelephonySession } from '@/types';
import type { ITelephonyProvider } from '@/services/telephony/provider';

vi.mock('@/services/auth/authService', () => ({
  isLiveApiMode: () => true,
  authService: { getSessionToken: () => 'synthetic-session-token' },
}));

import { CallService } from '@/services/telephony/callService';

const profile: Profile = {
  id: 'caller-test-id',
  user_id: 'user-test-id',
  organization_id: 'organization-test-id',
  full_name: 'Synthetic Caller',
  role: 'TELECALLER',
  status: 'ACTIVE',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function createProvider(): ITelephonyProvider {
  return {
    name: 'test provider',
    initiateCall: vi.fn(async () => ({ callId: 'must-not-be-used' } as TelephonySession)),
    getCallStatus: vi.fn(async () => 'CONNECTED' as const),
    endCall: vi.fn(async () => ({ durationSeconds: 1, recordingUrl: 'must-not-be-used' })),
    toggleMute: vi.fn(async () => true),
    verifyWebhookSignature: vi.fn(() => false),
    getConsentNotice: vi.fn(() => 'synthetic notice'),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('telephony browser/server boundary', () => {
  it('keeps server Twilio modules out of browser service imports and exports', () => {
    const callServiceSource = readFileSync(resolve(process.cwd(), 'src/services/telephony/callService.ts'), 'utf8');
    const barrelSource = readFileSync(resolve(process.cwd(), 'src/services/telephony/index.ts'), 'utf8');

    expect(callServiceSource).not.toMatch(/from\s+['"]\.\/twilioProvider['"]/);
    expect(barrelSource).not.toMatch(/twilioProvider|webhookHandler/);
  });

  it('dispatches live calls only to the authenticated server endpoint with a lead ID', async () => {
    const provider = createProvider();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ callId: 'call-record-id', status: 'INITIATED' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new CallService(provider);
    const result = await service.dispatchCall({ leadId: 'lead-test-id', callerProfile: profile });

    expect(fetchMock).toHaveBeenCalledWith('/api/telephony/call', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-session-token' }),
      body: JSON.stringify({ leadId: 'lead-test-id' }),
    }));
    expect(result.session.callId).toBe('call-record-id');
    expect(provider.initiateCall).not.toHaveBeenCalled();
  });

  it('uses authenticated server APIs for live status and end, and leaves unsupported mute disabled', async () => {
    const provider = createProvider();
    const service = new CallService(provider);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => init?.method === 'POST'
        ? { callId: 'call-record-id', accepted: true, status: 'IN_PROGRESS' }
        : { callId: 'call-record-id', status: 'IN_PROGRESS', durationSeconds: 8 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.toggleMute('call-record-id', true)).rejects.toThrow(/not available/i);
    await expect(service.getCallStatus('call-record-id')).resolves.toMatchObject({
      status: 'IN_PROGRESS', durationSeconds: 8,
    });
    await expect(service.endCall('call-record-id', profile)).resolves.toMatchObject({
      mode: 'live', accepted: true, status: 'IN_PROGRESS',
    });

    expect(provider.toggleMute).not.toHaveBeenCalled();
    expect(provider.getCallStatus).not.toHaveBeenCalled();
    expect(provider.endCall).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/telephony/call?callId=call-record-id', expect.objectContaining({
      headers: { Authorization: 'Bearer synthetic-session-token' },
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/telephony/call', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'end', callId: 'call-record-id' }),
    }));
  });
});
