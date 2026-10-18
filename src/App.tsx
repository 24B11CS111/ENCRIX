import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { RoleGate } from '@/features/auth/RoleGate';
import { AppLayout } from '@/components/layout/AppLayout';
import { AppSplashScreen } from '@/components/AppSplashScreen';

// Public Pages
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { AcceptInvitationPage } from '@/pages/auth/AcceptInvitationPage';

// Owner Pages
import { OwnerDashboard } from '@/pages/owner/OwnerDashboard';
import { OwnerLeadsPage } from '@/pages/owner/OwnerLeadsPage';
import { LeadImportWizard } from '@/features/leads/LeadImportWizard';
import { OwnerAssignmentsPage } from '@/pages/owner/OwnerAssignmentsPage';
import { OwnerTeamPage } from '@/pages/owner/OwnerTeamPage';
import { OwnerCallsPage } from '@/pages/owner/OwnerCallsPage';
import { OwnerFollowUpsPage } from '@/pages/owner/OwnerFollowUpsPage';
import { OwnerAnalyticsPage } from '@/pages/owner/OwnerAnalyticsPage';
import { OwnerActivityPage } from '@/pages/owner/OwnerActivityPage';
import { OwnerSecurityPage } from '@/pages/owner/OwnerSecurityPage';
import { OwnerSettingsPage } from '@/pages/owner/OwnerSettingsPage';

// Telecaller Pages
import { TelecallerDashboard } from '@/pages/telecaller/TelecallerDashboard';
import { TelecallerLeadsPage } from '@/pages/telecaller/TelecallerLeadsPage';
import { TelecallerCallsPage } from '@/pages/telecaller/TelecallerCallsPage';
import { TelecallerFollowUpsPage } from '@/pages/telecaller/TelecallerFollowUpsPage';
import { TelecallerPerformancePage } from '@/pages/telecaller/TelecallerPerformancePage';
import { TelecallerProfilePage } from '@/pages/telecaller/TelecallerProfilePage';

// Admin Pages
import { AdminDashboard } from '@/pages/admin/AdminDashboard';
import { AdminOrganizationsPage } from '@/pages/admin/AdminOrganizationsPage';
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage';
import { AdminActivityPage } from '@/pages/admin/AdminActivityPage';
import { AdminSecurityPage } from '@/pages/admin/AdminSecurityPage';
import { AdminSystemPage } from '@/pages/admin/AdminSystemPage';

const AppRoutes: React.FC = () => {
  const { profile, isAuthenticated } = useAuth();

  const getDashboardRedirect = () => {
    if (!isAuthenticated || !profile) return <Navigate to="/login" replace />;
    if (profile.role === 'ADMIN') return <Navigate to="/admin" replace />;
    if (profile.role === 'OWNER') return <Navigate to="/owner" replace />;
    return <Navigate to="/telecaller" replace />;
  };

  return (
    <Routes>
      {/* Public Pages */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/onboarding" element={<RegisterPage />} />
      <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
      <Route path="/invite" element={<AcceptInvitationPage />} />

      {/* Owner Protected Routes */}
      <Route
        path="/owner"
        element={
          <RoleGate allowedRoles={['OWNER', 'ADMIN']}>
            <AppLayout />
          </RoleGate>
        }
      >
        <Route index element={<OwnerDashboard />} />
        <Route path="leads" element={<OwnerLeadsPage />} />
        <Route path="import" element={<LeadImportWizard />} />
        <Route path="assignments" element={<OwnerAssignmentsPage />} />
        <Route path="team" element={<OwnerTeamPage />} />
        <Route path="calls" element={<OwnerCallsPage />} />
        <Route path="follow-ups" element={<OwnerFollowUpsPage />} />
        <Route path="analytics" element={<OwnerAnalyticsPage />} />
        <Route path="activity" element={<OwnerActivityPage />} />
        <Route path="security" element={<OwnerSecurityPage />} />
        <Route path="settings" element={<OwnerSettingsPage />} />
      </Route>

      {/* Telecaller Protected Routes */}
      <Route
        path="/telecaller"
        element={
          <RoleGate allowedRoles={['TELECALLER', 'ADMIN']}>
            <AppLayout />
          </RoleGate>
        }
      >
        <Route index element={<TelecallerDashboard />} />
        <Route path="leads" element={<TelecallerLeadsPage />} />
        <Route path="calls" element={<TelecallerCallsPage />} />
        <Route path="follow-ups" element={<TelecallerFollowUpsPage />} />
        <Route path="performance" element={<TelecallerPerformancePage />} />
        <Route path="profile" element={<TelecallerProfilePage />} />
      </Route>

      {/* Admin Protected Routes */}
      <Route
        path="/admin"
        element={
          <RoleGate allowedRoles={['ADMIN']}>
            <AppLayout />
          </RoleGate>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="organizations" element={<AdminOrganizationsPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="activity" element={<AdminActivityPage />} />
        <Route path="security" element={<AdminSecurityPage />} />
        <Route path="system" element={<AdminSystemPage />} />
      </Route>

      {/* Dynamic Fallback / Role Home */}
      <Route path="/dashboard" element={getDashboardRedirect()} />
      <Route path="*" element={getDashboardRedirect()} />
    </Routes>
  );
};

const AppContent: React.FC = () => {
  const { isLoading } = useAuth();
  const [showSplash, setShowSplash] = React.useState(() => {
    if (typeof window !== 'undefined') {
      return !sessionStorage.getItem('encrix_splash_completed');
    }
    return true;
  });

  const handleSplashComplete = () => {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('encrix_splash_completed', 'true');
      } catch {
        // Safe handling if storage quota or access blocked
      }
    }
    setShowSplash(false);
  };

  return (
    <>
      {showSplash && (
        <AppSplashScreen
          isLoading={isLoading}
          onComplete={handleSplashComplete}
        />
      )}
      <AppRoutes />
    </>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;

