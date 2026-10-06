import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { UserRole } from '@/types';
import { ShieldAlert, UserX } from 'lucide-react';

interface RoleGateProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
}

export const RoleGate: React.FC<RoleGateProps> = ({ children, allowedRoles }) => {
  const { profile, isAuthenticated, isLoading, logout } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F6F8FB] flex flex-col items-center justify-center text-[#172B4D]">
        <div className="w-10 h-10 border-4 border-[#0B1F3A] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium tracking-wide text-[#64748B]">Verifying secure session...</p>
      </div>
    );
  }

  if (!isAuthenticated || !profile) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Session Security: Block and display notification for disabled accounts
  if (profile.status === 'DISABLED') {
    return (
      <div className="min-h-screen bg-[#F6F8FB] flex flex-col items-center justify-center p-6 text-center">
        <div className="p-4 bg-[#FEECEB] border border-[#F8C8C6] rounded-[12px] mb-4 text-[#C53030]">
          <UserX className="w-12 h-12" />
        </div>
        <h1 className="text-2xl font-bold text-[#0B1F3A] mb-2">Account Suspended</h1>
        <p className="text-[#64748B] max-w-md mb-6 text-sm">
          Your account has been deactivated by your organization administrator. All workspace access, calling privileges, and lead queues have been revoked.
        </p>
        <button
          onClick={() => logout()}
          className="px-4 py-2 bg-[#C53030] hover:bg-[#A82828] text-white text-sm font-medium rounded-[10px] shadow-subtle transition-colors"
        >
          Sign Out
        </button>
      </div>
    );
  }

  if (!allowedRoles.includes(profile.role)) {
    // Redirect user to their own role's home or show restricted notice
    return (
      <div className="min-h-screen bg-[#F6F8FB] flex flex-col items-center justify-center p-6 text-center">
        <div className="p-4 bg-[#FEF6E7] border border-[#FBDFA8] rounded-[12px] mb-4 text-[#B7791F]">
          <ShieldAlert className="w-12 h-12" />
        </div>
        <h1 className="text-2xl font-bold text-[#0B1F3A] mb-2">Access Restricted</h1>
        <p className="text-[#64748B] max-w-md mb-6 text-sm">
          Your role (<span className="text-[#1E4D8F] font-semibold">{profile.role}</span>) does not have authorization
          to access this administrative area. ENCRIX policies prevent unauthorized lateral data discovery.
        </p>
        <div className="flex gap-3">
          <a
            href={profile.role === 'OWNER' ? '/owner' : profile.role === 'ADMIN' ? '/admin' : '/telecaller'}
            className="px-4 py-2 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-sm font-medium rounded-[10px] shadow-subtle transition-colors"
          >
            Go to Your Dashboard
          </a>
          <a
            href="/login"
            className="px-4 py-2 bg-white hover:bg-[#F6F8FB] text-[#172B4D] border border-[#DCE4EE] text-sm font-medium rounded-[10px] shadow-subtle transition-colors"
          >
            Switch Account
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
