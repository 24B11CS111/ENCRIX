import React, { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { authService } from '@/services/auth/authService';
import { Building, CheckCircle2, LoaderCircle, PhoneCall, ShieldCheck } from 'lucide-react';

type TwilioConfigView = {
  configured: boolean;
  phoneNumberMasked: string | null;
  updatedAt: string | null;
};

export const OwnerSettingsPage: React.FC = () => {
  const { profile, organization } = useAuth();
  const [config, setConfig] = useState<TwilioConfigView | null>(null);
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.role !== 'OWNER') return;
    let active = true;
    const loadConfig = async () => {
      setLoading(true);
      try {
        const token = authService.getSessionToken();
        const response = await fetch('/api/telephony/config', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Twilio settings could not be loaded');
        if (active) setConfig(data);
      } catch {
        if (active) setError('Twilio settings could not be loaded. Try again later.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadConfig();
    return () => { active = false; };
  }, [profile?.id, profile?.role]);

  const saveTwilioConfig = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const token = authService.getSessionToken();
      if (!token) throw new Error('Sign in again to update telephony settings.');
      const response = await fetch('/api/telephony/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accountSid, authToken, phoneNumber }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Twilio settings could not be saved');
      setConfig({ configured: true, phoneNumberMasked: data.phoneNumberMasked, updatedAt: new Date().toISOString() });
      setAccountSid('');
      setAuthToken('');
      setPhoneNumber('');
      setNotice('Twilio credentials encrypted and saved for this organization.');
    } catch (saveError: any) {
      setError(saveError?.message || 'Twilio settings could not be saved.');
    } finally {
        // Keep a failed submission from leaving an Auth Token in component state.
        setAuthToken('');
      setSaving(false);
    }
  };

  const disableTwilioConfig = async () => {
    if (!window.confirm('Disable this organization’s Twilio configuration? New calls will stop.')) return;
    setError(null);
    setNotice(null);
    setRevoking(true);
    try {
      const token = authService.getSessionToken();
      if (!token) throw new Error('Sign in again to update telephony settings.');
      const response = await fetch('/api/telephony/config', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Twilio configuration could not be disabled');
      setConfig({ configured: false, phoneNumberMasked: null, updatedAt: new Date().toISOString() });
      setNotice('Twilio configuration disabled.');
    } catch (revokeError: any) {
      setError(revokeError?.message || 'Twilio configuration could not be disabled.');
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <header className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-xl font-bold tracking-tight text-[#0B1F3A]">Organization Settings</h1>
        <p className="mt-1 text-xs text-[#64748B]">Manage organization profile and your organization-owned Twilio account.</p>
      </header>

      {(error || notice) && (
        <div role={error ? 'alert' : 'status'} className={`flex items-center gap-2 rounded-[10px] border p-3 text-xs ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {error ? <ShieldCheck className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          <span>{error || notice}</span>
        </div>
      )}

      <section className="space-y-4 rounded-[16px] border border-[#DCE4EE] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#0B1F3A]">
          <Building className="h-4 w-4 text-[#1E4D8F]" />
          <span>Organization Profile</span>
        </div>
        <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
          <label className="text-[#64748B]">Company Name
            <input type="text" disabled value={organization?.name || ''} className="mt-1 w-full cursor-not-allowed rounded-[10px] border border-[#DCE4EE] bg-[#F6F8FB] px-3 py-2 text-[#64748B]" />
          </label>
          <label className="text-[#64748B]">Industry
            <input type="text" disabled value={organization?.industry || ''} className="mt-1 w-full cursor-not-allowed rounded-[10px] border border-[#DCE4EE] bg-[#F6F8FB] px-3 py-2 text-[#64748B]" />
          </label>
        </div>
      </section>

      {profile?.role === 'OWNER' && (
        <section className="space-y-4 rounded-[16px] border border-[#DCE4EE] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0B1F3A]">
            <PhoneCall className="h-4 w-4 text-[#1E4D8F]" />
            <span>Organization Twilio Account</span>
          </div>
          <p className="text-xs leading-relaxed text-[#64748B]">
            Your organization owns its Twilio account, phone number and usage. The Auth Token is encrypted before storage and is never returned to this browser. Re-enter all three values to replace or rotate the stored account credentials.
          </p>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-[#64748B]"><LoaderCircle className="h-4 w-4 animate-spin" />Loading secure configuration…</div>
          ) : (
            <>
              <div className="rounded-[10px] bg-[#F6F8FB] p-3 text-xs text-[#475569]" aria-live="polite">
                {config?.configured
                  ? <>Connected number: <strong>{config.phoneNumberMasked}</strong></>
                  : 'No Twilio account is configured for this organization.'}
              </div>
              <form onSubmit={(event) => void saveTwilioConfig(event)} className="space-y-3">
                <label className="block text-xs font-medium text-[#475569]">Twilio Account SID
                  <input required autoComplete="off" value={accountSid} onChange={(event) => setAccountSid(event.target.value)} className="mt-1 w-full rounded-[10px] border border-[#DCE4EE] px-3 py-2" placeholder="AC…" />
                </label>
                <label className="block text-xs font-medium text-[#475569]">Twilio Auth Token
                  <input required type="password" autoComplete="new-password" value={authToken} onChange={(event) => setAuthToken(event.target.value)} className="mt-1 w-full rounded-[10px] border border-[#DCE4EE] px-3 py-2" />
                </label>
                <label className="block text-xs font-medium text-[#475569]">Twilio Phone Number (E.164)
                  <input required type="tel" autoComplete="off" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} className="mt-1 w-full rounded-[10px] border border-[#DCE4EE] px-3 py-2" placeholder="+14155550123" />
                </label>
                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  {config?.configured && <button type="button" disabled={revoking || saving} onClick={() => void disableTwilioConfig()} className="rounded-[10px] border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50">{revoking ? 'Disabling…' : 'Disable Twilio'}</button>}
                  <button type="submit" disabled={saving || revoking} className="rounded-[10px] bg-[#0B1F3A] px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Encrypting and saving…' : config?.configured ? 'Replace credentials' : 'Save Twilio configuration'}</button>
                </div>
              </form>
              <p className="text-[11px] leading-relaxed text-amber-800">
                Live calling stays unavailable until the database migrations and provider callback settings have been applied and verified for your deployment. Saving credentials does not place or enable calls by itself.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
};
