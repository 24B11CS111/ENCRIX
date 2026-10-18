import React, { useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import {
  Settings,
  Building,
  PhoneCall,
  Shield,
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

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Organization Settings</h1>
        <p className="text-xs text-[#64748B] mt-1">
          Configure calling gateway, statutory recording policies, and organization profile.
        </p>
      </div>

      {savedNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-[10px] text-xs text-[#16845B] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Configuration saved successfully.</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Organization Info */}
        <div className="p-5 rounded-[16px] bg-white border border-[#DCE4EE] shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-[#0B1F3A] font-semibold text-sm">
            <Building className="w-4 h-4 text-[#1E4D8F]" />
            <span>Organization Profile</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="text-[#64748B] block mb-1">Company Name</label>
              <input
                type="text"
                disabled
                value={organization?.name || 'Vertex Consultancy'}
                className="w-full px-3 py-2 bg-[#F6F8FB] border border-[#DCE4EE] rounded-[10px] text-[#64748B] cursor-not-allowed"
              />
            </div>

            <div>
              <label className="text-[#64748B] block mb-1">Industry</label>
              <input
                type="text"
                disabled
                value={organization?.industry || 'Education Consultancy'}
                className="w-full px-3 py-2 bg-[#F6F8FB] border border-[#DCE4EE] rounded-[10px] text-[#64748B] cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {/* Telephony Gateway Settings (Section 20 & 21) */}
        <div className="p-5 rounded-[16px] bg-white border border-[#DCE4EE] shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-[#0B1F3A] font-semibold text-sm">
            <PhoneCall className="w-4 h-4 text-[#1E4D8F]" />
            <span>Telephony Infrastructure Provider</span>
          </div>

          <div className="space-y-2 text-xs">
            <label className="text-[#64748B] block">Active Provider Gateway</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#0B1F3A]"
            >
              <option value="MOCK">Mock Telephony Gateway (Development & Evaluation)</option>
              <option value="TWILIO">Twilio Voice SIP Trunking</option>
              <option value="EXOTEL">Exotel Cloud Telephony API</option>
              <option value="KNOWLARITY">Knowlarity Smart Voice Gateway</option>
            </select>
          </div>

          <div className="pt-2 flex items-center justify-between text-xs">
            <div>
              <span className="text-[#172B4D] font-medium block">Automatic Call Consent Notice</span>
              <span className="text-[#64748B] text-[11px]">
                Plays statutory recording advisory to customer before agent connects
              </span>
            </div>
            <input
              type="checkbox"
              checked={consentPolicy}
              onChange={(e) => setConsentPolicy(e.target.checked)}
              className="w-4 h-4 rounded text-[#0B1F3A] bg-white border-[#DCE4EE]"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end pt-2">
          <button
            type="submit"
            className="px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-sm transition-all cursor-pointer"
          >
            Save Settings
          </button>
        </div>
      </form>
    </div>
  );
};
