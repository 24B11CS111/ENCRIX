import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, Lock, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/services/supabase/client';

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError('This recovery link is invalid or expired. Request a new reset link and try again.');
        return;
      }

      const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
      setSuccess(true);
      if (signOutError) {
        setError('Your password was updated. Sign in again; other sessions may take a short time to expire.');
      }
      setTimeout(() => navigate('/login'), 2500);
    } catch {
      setError('Password reset is temporarily unavailable. Request a new reset link and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F8FB] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link to="/" className="inline-flex items-center gap-2.5 mb-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-[#0B1F3A] text-white shadow-subtle">
            <Shield className="h-6 w-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-[#0B1F3A]">ENCRIX</span>
        </Link>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-[#DCE4EE] py-8 px-6 shadow-card rounded-[12px] sm:px-10 space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-bold text-[#0B1F3A]">Set new password</h2>
            <p className="text-xs text-[#64748B] mt-1">
              Ensure your new password contains at least 8 characters.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-[#FEECEB] border border-[#F8C8C6] rounded-[8px] text-xs text-[#C53030]">
              {error}
            </div>
          )}

          {success ? (
            <div className="p-4 rounded-[10px] bg-[#EAF7EE] border border-[#C3EBD0] text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-[#16845B] mx-auto" />
              <div className="text-sm font-bold text-[#0B1F3A]">Password updated!</div>
              <p className="text-xs text-[#172B4D]">Your password has been updated. Redirecting you to login...</p>
              {error && <p role="status" className="text-xs text-amber-700">{error}</p>}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="text-xs font-semibold text-[#172B4D] block mb-1">New Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                  <input
                    id="new-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] placeholder-[#94A3B8] shadow-subtle focus:outline-none focus:border-[#1E4D8F]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="confirm-new-password" className="text-xs font-semibold text-[#172B4D] block mb-1">Confirm New Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                  <input
                    id="confirm-new-password"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] placeholder-[#94A3B8] shadow-subtle focus:outline-none focus:border-[#1E4D8F]"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white font-semibold text-xs rounded-[10px] shadow-subtle transition-all"
              >
                {submitting ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
