import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  authStateHandler: undefined as undefined | ((event: string, session: any) => void),
  channel: vi.fn(),
  removeChannel: vi.fn(),
  changeHandler: undefined as undefined | ((payload: unknown) => void),
  statusHandler: undefined as undefined | ((state: string) => void),
  channels: [] as any[],
}));

vi.mock('@/services/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: vi.fn((callback: (event: string, session: any) => void) => {
        mocks.authStateHandler = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  },
  isRealSupabaseConfigured: () => true,
}));

import { RealtimeConnectionManager } from '@/services/realtime/realtimeManager';
import { authService } from '@/services/auth/authService';
import { db } from '@/services/supabase/db';
import { Profile } from '@/types';

const owner: Profile = {
  id: 'profile-owner-a', user_id: 'user-owner-a', organization_id: 'org-a',
  full_name: 'Owner A', role: 'OWNER', status: 'ACTIVE',
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
};
const admin: Profile = { ...owner, id: 'profile-admin-a', user_id: 'user-admin-a', role: 'ADMIN' };
const telecaller: Profile = {
  ...owner, id: 'profile-caller-a', user_id: 'user-caller-a', role: 'TELECALLER',
};
const otherTelecaller: Profile = {
  ...owner, id: 'profile-caller-b', user_id: 'user-caller-b', organization_id: 'org-b', role: 'TELECALLER',
};

function makeChannel() {
  const channel = {
    on: vi.fn((_type: string, _config: unknown, callback: (payload: unknown) => void) => {
      mocks.changeHandler = callback;
      return channel;
    }),
    subscribe: vi.fn((callback?: (state: string) => void) => {
      mocks.statusHandler = callback;
      callback?.('SUBSCRIBED');
      return channel;
    }),
  };
  mocks.channels.push(channel);
  return channel;
}

describe('sanitized Realtime identity and refresh behavior', () => {
  let manager: RealtimeConnectionManager;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    mocks.getSession.mockReset();
    mocks.authStateHandler = undefined;
    mocks.channel.mockReset().mockImplementation(() => makeChannel());
    mocks.removeChannel.mockReset().mockResolvedValue('ok');
    mocks.channels = [];
    mocks.changeHandler = undefined;
    mocks.statusHandler = undefined;
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ revision: 0 }) });
    vi.stubGlobal('fetch', fetchMock);
    manager = new RealtimeConnectionManager();
  });

  afterEach(() => {
    manager.cleanup();
    db.unsubscribeAll();
    authService.clearSessionToken();
    vi.unstubAllGlobals();
  });

  it('uses authenticated polling for custom OTP sessions even when Supabase Auth is stale', async () => {
    authService.setSessionToken('signed-custom-session-token');
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'stale-supabase-token', user: { id: 'another-user' } } },
    });

    manager.setIdentity(owner);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    expect(fetchMock.mock.calls[0][0]).toBe('/api/realtime/refresh');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer signed-custom-session-token');
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.channel).not.toHaveBeenCalled();
  });

  it.each([owner, admin])('opens a sanitized signal channel for a matching %s identity', async (profile) => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'supabase-access-token', user: { id: profile.user_id } } },
    });
    const events: any[] = [];
    const unsubscribe = db.subscribe((event) => events.push(event), profile);

    manager.setIdentity(profile);
    await vi.waitFor(() => expect(mocks.channel).toHaveBeenCalledOnce());

    expect(mocks.channels[0].on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({
      schema: 'public', table: 'lead_refresh_signals', event: '*',
    }), expect.any(Function));
    expect(mocks.channels[0].on.mock.calls[0][1].filter).toBe(`organization_id=eq.${profile.organization_id}`);

    mocks.changeHandler?.({ new: { organization_id: profile.organization_id, recipient_profile_id: null, revision: 0 } });
    expect(events.filter((event) => event.type === 'LEAD_REFRESH_REQUIRED')).toEqual([]); // Initial cursor establishes the baseline.
    mocks.changeHandler?.({ new: { organization_id: profile.organization_id, recipient_profile_id: null, revision: 2 } });
    const refreshEvents = events.filter((event) => event.type === 'LEAD_REFRESH_REQUIRED');
    expect(refreshEvents).toHaveLength(1);
    expect(refreshEvents[0]).toMatchObject({ type: 'LEAD_REFRESH_REQUIRED', payload: { revision: 2 } });
    unsubscribe();
  });

  it('limits telecaller Realtime refreshes to its own assignment cursor', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'caller-token', user: { id: telecaller.user_id } } },
    });
    const events: any[] = [];
    const ownUnsubscribe = db.subscribe((event) => events.push(event), telecaller);
    const otherUnsubscribe = db.subscribe(vi.fn(), otherTelecaller);
    manager.setIdentity(telecaller);
    await vi.waitFor(() => expect(mocks.channel).toHaveBeenCalledOnce());

    expect(mocks.channels[0].on.mock.calls[0][1].filter).toBe(`recipient_profile_id=eq.${telecaller.id}`);
    mocks.changeHandler?.({ new: { organization_id: telecaller.organization_id, recipient_profile_id: otherTelecaller.id, revision: 1 } });
    expect(events.filter((event) => event.type === 'LEAD_REFRESH_REQUIRED')).toHaveLength(0);
    mocks.changeHandler?.({ new: { organization_id: telecaller.organization_id, recipient_profile_id: telecaller.id, revision: 0 } });
    mocks.changeHandler?.({ new: { organization_id: telecaller.organization_id, recipient_profile_id: telecaller.id, revision: 2 } });
    const refreshEvents = events.filter((event) => event.type === 'LEAD_REFRESH_REQUIRED');
    expect(refreshEvents).toHaveLength(1);
    expect(refreshEvents[0].target_user_id).toBe(telecaller.id);
    ownUnsubscribe();
    otherUnsubscribe();
  });

  it('rejects a mismatched or stale Supabase identity without opening a channel', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'other-token', user: { id: 'different-user-id' } } },
    });
    manager.setIdentity(owner);
    await vi.waitFor(() => expect(manager.getStatus()).toBe('OFFLINE'));
    expect(mocks.channel).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes an active channel immediately when Supabase Auth switches to another identity', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'owner-token', user: { id: owner.user_id } } },
    });
    manager.setIdentity(owner);
    await vi.waitFor(() => expect(mocks.channel).toHaveBeenCalledOnce());

    mocks.authStateHandler?.('SIGNED_IN', { access_token: 'other-token', user: { id: 'different-user' } });
    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channels[0]);
    expect(manager.getStatus()).toBe('OFFLINE');
  });

  it('removes the old identity channel on identity change and clears it on logout', async () => {
    mocks.getSession.mockImplementation(async () => ({
      data: { session: { access_token: 'access-token', user: { id: currentProfile.user_id } } },
    }));
    let currentProfile = owner;
    manager.setIdentity(currentProfile);
    await vi.waitFor(() => expect(mocks.channel).toHaveBeenCalledOnce());

    currentProfile = telecaller;
    manager.setIdentity(currentProfile);
    await vi.waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(2));
    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channels[0]);

    manager.cleanup();
    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channels[1]);
    expect(manager.getStatus()).toBe('LIVE');
  });

  it('does not cache or dispatch phone/email fields from a maliciously expanded signal payload', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'owner-token', user: { id: owner.user_id } } },
    });
    const events: any[] = [];
    const unsubscribe = db.subscribe((event) => events.push(event), owner);
    manager.setIdentity(owner);
    await vi.waitFor(() => expect(mocks.channel).toHaveBeenCalledOnce());
    mocks.changeHandler?.({ new: {
      organization_id: owner.organization_id,
      recipient_profile_id: null,
      revision: 0,
      phone: '+15550000000',
      email: 'secret@example.test',
    } });
    mocks.changeHandler?.({ new: {
      organization_id: owner.organization_id,
      recipient_profile_id: null,
      revision: 2,
      phone: '+15550000000',
      email: 'secret@example.test',
    } });
    expect(JSON.stringify(events)).not.toContain('+15550000000');
    expect(JSON.stringify(events)).not.toContain('secret@example.test');
    expect(events.filter((event) => event.type === 'LEAD_REFRESH_REQUIRED')).toEqual([
      { type: 'LEAD_REFRESH_REQUIRED', payload: { revision: 2 }, organization_id: 'org-a', target_user_id: undefined },
    ]);
    unsubscribe();
  });
});
