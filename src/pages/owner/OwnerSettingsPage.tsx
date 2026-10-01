import React, { useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import {
  Settings,
  Building,
  PhoneCall,
  Shield,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';

export const OwnerSettingsPage: React.FC = () => {
  const { profile, organization } = useAuth();
  const [provider, setProvider] = useState('MOCK');
  const [consentPolicy, setConsentPolicy] = useState(true);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  const handleResetSandbox = () => {
    if (window.confirm('Reset local demo sandbox database to original state?')) {
      db.resetSandbox();
      window.location.reload();
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-bold text-white tracking-tight">Organization Settings</h1>
        <p className="text-xs text-slate-400 mt-1">
          Configure calling gateway, statutory recording policies, and organization profile.
        </p>
      </div>

      {savedNotice && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-xs text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Configuration saved successfully.</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Organization Info */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Building className="w-4 h-4 text-emerald-400" />
            <span>Organization Profile</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="text-slate-400 block mb-1">Company Name</label>
              <input
                type="text"
                disabled
                value={organization?.name || 'Vertex Consultancy'}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Industry</label>
              <input
                type="text"
                disabled
                value={organization?.industry || 'Education Consultancy'}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {/* Telephony Gateway Settings (Section 20 & 21) */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <PhoneCall className="w-4 h-4 text-emerald-400" />
            <span>Telephony Infrastructure Provider</span>
          </div>

          <div className="space-y-2 text-xs">
            <label className="text-slate-400 block">Active Provider Gateway</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="MOCK">Mock Telephony Gateway (Development & Evaluation)</option>
              <option value="TWILIO">Twilio Voice SIP Trunking</option>
              <option value="EXOTEL">Exotel Cloud Telephony API</option>
              <option value="KNOWLARITY">Knowlarity Smart Voice Gateway</option>
            </select>
          </div>

          <div className="pt-2 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-200 font-medium block">Automatic Call Consent Notice</span>
              <span className="text-slate-500 text-[11px]">
                Plays statutory recording advisory to customer before agent connects
              </span>
            </div>
            <input
              type="checkbox"
              checked={consentPolicy}
              onChange={(e) => setConsentPolicy(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600 bg-slate-950 border-slate-700"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={handleResetSandbox}
            className="flex items-center gap-1.5 px-3 py-2 text-rose-400 hover:bg-rose-950/40 rounded-lg text-xs font-medium border border-rose-500/20 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Demo Sandbox</span>
          </button>

          <button
            type="submit"
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
          >
            Save Settings
          </button>
        </div>
      </form>
    </div>
  );
};
