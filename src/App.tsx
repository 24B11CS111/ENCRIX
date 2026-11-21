import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { RoleGate } from '@/features/auth/RoleGate';
import { AppLayout } from '@/components/layout/AppLayout';
import { AppSplashScreen } from '@/components/AppSplashScreen';

const LandingPage = React.lazy(() => import('@/pages/LandingPage').then((module) => ({ default: module.LandingPage })));
const LoginPage = React.lazy(() => import('@/pages/auth/LoginPage').then((module) => ({ default: module.LoginPage })));
const RegisterPage = React.lazy(() => import('@/pages/auth/RegisterPage').then((module) => ({ default: module.RegisterPage })));
const ForgotPasswordPage = React.lazy(() => import('@/pages/auth/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = React.lazy(() => import('@/pages/auth/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })));
const AcceptInvitationPage = React.lazy(() => import('@/pages/auth/AcceptInvitationPage').then((module) => ({ default: module.AcceptInvitationPage })));
const OwnerDashboard = React.lazy(() => import('@/pages/owner/OwnerDashboard').then((module) => ({ default: module.OwnerDashboard })));
const OwnerLeadsPage = React.lazy(() => import('@/pages/owner/OwnerLeadsPage').then((module) => ({ default: module.OwnerLeadsPage })));
const LeadImportWizard = React.lazy(() => import('@/features/leads/LeadImportWizard').then((module) => ({ default: module.LeadImportWizard })));
const OwnerAssignmentsPage = React.lazy(() => import('@/pages/owner/OwnerAssignmentsPage').then((module) => ({ default: module.OwnerAssignmentsPage })));
const OwnerTeamPage = React.lazy(() => import('@/pages/owner/OwnerTeamPage').then((module) => ({ default: module.OwnerTeamPage })));
const OwnerCallsPage = React.lazy(() => import('@/pages/owner/OwnerCallsPage').then((module) => ({ default: module.OwnerCallsPage })));
const OwnerFollowUpsPage = React.lazy(() => import('@/pages/owner/OwnerFollowUpsPage').then((module) => ({ default: module.OwnerFollowUpsPage })));
const OwnerAnalyticsPage = React.lazy(() => import('@/pages/owner/OwnerAnalyticsPage').then((module) => ({ default: module.OwnerAnalyticsPage })));
const OwnerActivityPage = React.lazy(() => import('@/pages/owner/OwnerActivityPage').then((module) => ({ default: module.OwnerActivityPage })));
const OwnerSecurityPage = React.lazy(() => import('@/pages/owner/OwnerSecurityPage').then((module) => ({ default: module.OwnerSecurityPage })));
const OwnerSettingsPage = React.lazy(() => import('@/pages/owner/OwnerSettingsPage').then((module) => ({ default: module.OwnerSettingsPage })));
const OwnerPricingPage = React.lazy(() => import('@/pages/owner/OwnerPricingPage').then((module) => ({ default: module.OwnerPricingPage })));
const OwnerCheckoutPage = React.lazy(() => import('@/pages/owner/OwnerCheckoutPage').then((module) => ({ default: module.OwnerCheckoutPage })));
const PricingPage = React.lazy(() => import('@/pages/PricingPage').then((module) => ({ default: module.PricingPage })));
const DemoWorkspace = React.lazy(() => import('@/pages/DemoWorkspace').then((module) => ({ default: module.DemoWorkspace })));
const TelecallerDashboard = React.lazy(() => import('@/pages/telecaller/TelecallerDashboard').then((module) => ({ default: module.TelecallerDashboard })));
const TelecallerLeadsPage = React.lazy(() => import('@/pages/telecaller/TelecallerLeadsPage').then((module) => ({ default: module.TelecallerLeadsPage })));
const TelecallerCallsPage = React.lazy(() => import('@/pages/telecaller/TelecallerCallsPage').then((module) => ({ default: module.TelecallerCallsPage })));
const TelecallerFollowUpsPage = React.lazy(() => import('@/pages/telecaller/TelecallerFollowUpsPage').then((module) => ({ default: module.TelecallerFollowUpsPage })));
const TelecallerPerformancePage = React.lazy(() => import('@/pages/telecaller/TelecallerPerformancePage').then((module) => ({ default: module.TelecallerPerformancePage })));
const TelecallerProfilePage = React.lazy(() => import('@/pages/telecaller/TelecallerProfilePage').then((module) => ({ default: module.TelecallerProfilePage })));
const AdminDashboard = React.lazy(() => import('@/pages/admin/AdminDashboard').then((module) => ({ default: module.AdminDashboard })));
const AdminOrganizationsPage = React.lazy(() => import('@/pages/admin/AdminOrganizationsPage').then((module) => ({ default: module.AdminOrganizationsPage })));
const AdminUsersPage = React.lazy(() => import('@/pages/admin/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })));
const AdminActivityPage = React.lazy(() => import('@/pages/admin/AdminActivityPage').then((module) => ({ default: module.AdminActivityPage })));
const AdminSecurityPage = React.lazy(() => import('@/pages/admin/AdminSecurityPage').then((module) => ({ default: module.AdminSecurityPage })));
const AdminSystemPage = React.lazy(() => import('@/pages/admin/AdminSystemPage').then((module) => ({ default: module.AdminSystemPage })));
const AdminRefundsPage = React.lazy(() => import('@/pages/admin/AdminRefundsPage').then((module) => ({ default: module.AdminRefundsPage })));

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
      <Route path="/pricing" element={<PricingPage />} />
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
        <Route path="pricing" element={<OwnerPricingPage />} />
        <Route path="pricing/checkout" element={<OwnerCheckoutPage />} />
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
        <Route path="refunds" element={<AdminRefundsPage />} />
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
    <Suspense fallback={<div className="p-6 text-center text-sm text-slate-500" role="status">Loading page...</div>}>
      <BrowserRouter>
        <Routes>
          {/* Keep the synthetic sandbox outside AuthProvider so it never restores or reads a live session. */}
          <Route path="/demo" element={<DemoWorkspace />} />
          <Route path="*" element={<AuthProvider><AppContent /></AuthProvider>} />
        </Routes>
      </BrowserRouter>
    </Suspense>
  );
};

export default App;
