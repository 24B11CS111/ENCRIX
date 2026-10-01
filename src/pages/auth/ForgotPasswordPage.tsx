import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link to="/" className="inline-flex items-center gap-2.5 mb-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Shield className="h-6 w-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-white">LEADVAULT</span>
        </Link>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 border border-slate-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10 space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-bold text-white">Reset password</h2>
            <p className="text-xs text-slate-400 mt-1">
              Enter your work email address to receive password recovery instructions.
            </p>
          </div>

          {submitted ? (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <div className="text-sm font-bold text-white">Recovery email sent</div>
              <p className="text-xs text-slate-300">
                If an account exists for <span className="font-semibold text-emerald-300">{email}</span>, a secure password reset link has been dispatched.
              </p>
              <Link to="/login" className="inline-block mt-3 text-xs text-emerald-400 font-semibold hover:underline">
                Return to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-slate-300 block mb-1">Work Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-lg shadow-sm transition-all"
              >
                Send Reset Link
              </button>

              <div className="text-center pt-2">
                <Link to="/login" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In</span>
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
