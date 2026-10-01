import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { UserRole } from '@/types';
import { ShieldAlert } from 'lucide-react';

interface RoleGateProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
}

export const RoleGate: React.FC<RoleGateProps> = ({ children, allowedRoles }) => {
  const { profile, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium tracking-wide text-slate-400">Verifying secure session...</p>
      </div>
    );
  }

  if (!isAuthenticated || !profile) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!allowedRoles.includes(profile.role)) {
    // Redirect user to their own role's home or show restricted notice
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl mb-4 text-rose-400">
          <ShieldAlert className="w-12 h-12" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Access Restricted</h1>
        <p className="text-slate-400 max-w-md mb-6 text-sm">
          Your role (<span className="text-emerald-400 font-semibold">{profile.role}</span>) does not have authorization
          to access this administrative area. LeadVault policies prevent unauthorized lateral data discovery.
        </p>
        <div className="flex gap-3">
          <a
            href={profile.role === 'OWNER' ? '/owner' : profile.role === 'ADMIN' ? '/admin' : '/telecaller'}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Go to Your Dashboard
          </a>
          <a
            href="/login"
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg transition-colors"
          >
            Switch Account
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
