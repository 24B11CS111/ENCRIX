import React, { createContext, useContext, useState, useEffect } from 'react';
import { Profile, Organization, UserRole } from '@/types';
import { db } from '@/services/supabase/db';
import { DEMO_PROFILES, DEMO_ORGS } from '@/services/supabase/demoData';
import { IS_DEMO_MODE } from '@/lib/config';
import { rateLimiter } from '@/lib/rateLimiter';
import { supabase, isRealSupabaseConfigured } from '@/services/supabase/client';

interface AuthContextType {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  organization: Organization | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isDemoMode: boolean;
  login: (email: string, password?: string) => Promise<{ success: boolean; role?: UserRole; error?: string }>;
  register: (data: {
    companyName: string;
    ownerName: string;
    email: string;
    phone: string;
    industry: string;
    companySize: string;
  }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  switchRole: (role: UserRole) => void;
  quickLogin: (type: 'admin' | 'owner' | 'telecaller' | 'prime_owner') => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadSupabaseProfile = async (
    userId: string
  ): Promise<{ success: boolean; role?: UserRole; error?: string }> => {
    try {
      const { data: userProfile, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (profErr || !userProfile) {
        await supabase.auth.signOut();
        setProfile(null);
        setOrganization(null);
        return { success: false, error: 'User profile not found in organization.' };
      }

      if (userProfile.status === 'DISABLED') {
        await supabase.auth.signOut();
        setProfile(null);
        setOrganization(null);
        return { success: false, error: 'Your account has been suspended. Please contact your organization owner.' };
      }

      const { data: orgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', userProfile.organization_id)
        .single();

      setProfile(userProfile);
      setOrganization(orgData || null);
      return { success: true, role: userProfile.role };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to resolve user identity.' };
    } finally {
      setIsLoading(false);
    }
  };

  // Initialize from Supabase Auth session or saved session
  useEffect(() => {
    if (isRealSupabaseConfigured()) {
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        if (session?.user) {
          await loadSupabaseProfile(session.user.id);
        } else {
          setIsLoading(false);
        }
      });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          await loadSupabaseProfile(session.user.id);
        } else {
          setProfile(null);
          setOrganization(null);
          setIsLoading(false);
        }
      });

      return () => subscription.unsubscribe();
    }

    try {
      const savedUser = localStorage.getItem('leadvault_session');
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        const allProfiles = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile);
        const found = allProfiles.find((p) => p.id === parsed.profileId);

        // Ensure account is active and not disabled
        if (found && found.status !== 'DISABLED') {
          setProfile(found);
          const orgs = db.getOrganizations(found);
          setOrganization(orgs.find((o) => o.id === found.organization_id) || null);
          setIsLoading(false);
          return;
        } else if (found && found.status === 'DISABLED') {
          // Immediately revoke session for disabled account
          localStorage.removeItem('leadvault_session');
          setProfile(null);
          setOrganization(null);
          setIsLoading(false);
          return;
        }
      }

      // In Demo mode only: default initial state to Vikram Malhotra (Owner of Vertex Consultancy)
      if (IS_DEMO_MODE) {
        const defaultOwner = DEMO_PROFILES.find((p) => p.role === 'OWNER' && p.organization_id === 'org-vertex-001');
        if (defaultOwner) {
          setProfile(defaultOwner);
          setOrganization(DEMO_ORGS[0]);
        }
      } else {
        // Production: clean unauthenticated state
        setProfile(null);
        setOrganization(null);
      }
    } catch {
      setProfile(null);
      setOrganization(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = async (email: string, password?: string) => {
    // Rate limit login attempts: 5 attempts per 60 seconds
    const limitCheck = rateLimiter.check(`login:${email.toLowerCase().trim()}`, 5, 60000);
    if (!limitCheck.allowed) {
      return {
        success: false,
        error: `Too many login attempts. Please wait ${Math.ceil(limitCheck.resetMs / 1000)} seconds before trying again.`,
      };
    }

    setIsLoading(true);
    try {
      if (isRealSupabaseConfigured()) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password || '',
        });
        if (error) {
          return { success: false, error: error.message };
        }
        const loaded = await loadSupabaseProfile(data.user.id);
        if (!loaded.success) {
          return { success: false, error: loaded.error };
        }
        rateLimiter.reset(`login:${email.toLowerCase().trim()}`);
        return { success: true, role: loaded.role };
      }

      const allProfiles = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile);
      let matchedProfile: Profile | undefined;

      if (IS_DEMO_MODE) {
        // Demo sandbox: convenience email / role matching
        matchedProfile = allProfiles.find(
          (p) =>
            p.phone === email ||
            p.full_name.toLowerCase().includes(email.toLowerCase().split('@')[0])
        );

        if (email.includes('admin')) {
          matchedProfile = allProfiles.find((p) => p.role === 'ADMIN');
        } else if (email.includes('owner') || email.includes('vikram')) {
          matchedProfile = allProfiles.find((p) => p.id === 'prof-owner-001');
        } else if (email.includes('prime')) {
          matchedProfile = allProfiles.find((p) => p.id === 'prof-owner-002');
        } else if (email.includes('arjun') || email.includes('telecaller')) {
          matchedProfile = allProfiles.find((p) => p.id === 'tc-arjun-01');
        } else if (email.includes('rahul')) {
          matchedProfile = allProfiles.find((p) => p.id === 'tc-rahul-02');
        } else if (email.includes('priya')) {
          matchedProfile = allProfiles.find((p) => p.id === 'tc-priya-03');
        }
      } else {
        // PRODUCTION: Strict email/phone lookup, password required
        if (!password || password.length < 6) {
          return { success: false, error: 'Password is required and must be at least 6 characters.' };
        }
        matchedProfile = allProfiles.find(
          (p) =>
            p.phone === email ||
            p.full_name.toLowerCase() === email.toLowerCase().split('@')[0] ||
            `${p.full_name.toLowerCase().replace(/\s+/g, '.')}@leadvault.io` === email.toLowerCase() ||
            `${p.full_name.toLowerCase().replace(/\s+/g, '.')}@encrix.com` === email.toLowerCase()
        );
      }

      if (!matchedProfile) {
        return { success: false, error: 'Invalid credentials. User profile not found.' };
      }

      // Check account status: revoked/disabled account must be denied access
      if (matchedProfile.status === 'DISABLED') {
        db.recordSecurityEvent(
          {
            event_type: 'DISABLED_ACCOUNT_LOGIN_ATTEMPT',
            severity: 'HIGH',
            description: `Suspended user ${matchedProfile.full_name} (${matchedProfile.id}) attempted to log in.`,
            metadata: { email, userId: matchedProfile.id },
          },
          matchedProfile
        );
        return { success: false, error: 'Your account has been suspended. Please contact your organization owner.' };
      }

      rateLimiter.reset(`login:${email.toLowerCase().trim()}`);
      setProfile(matchedProfile);
      const orgs = db.getOrganizations(matchedProfile);
      const org = orgs.find((o) => o.id === matchedProfile!.organization_id) || null;
      setOrganization(org);

      localStorage.setItem('leadvault_session', JSON.stringify({ profileId: matchedProfile.id }));

      db.logActivity({
        organization_id: matchedProfile.organization_id,
        user_id: matchedProfile.id,
        user_name: matchedProfile.full_name,
        user_role: matchedProfile.role,
        action: 'LOGIN',
        entity_type: 'auth',
        metadata: { role: matchedProfile.role, email },
      });

      return { success: true, role: matchedProfile.role };
    } catch {
      return { success: false, error: 'Authentication failed. Please verify credentials.' };
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (data: {
    companyName: string;
    ownerName: string;
    email: string;
    phone: string;
    industry: string;
    companySize: string;
  }) => {
    setIsLoading(true);
    try {
      if (isRealSupabaseConfigured()) {
        const generatedPass = `Encrix_${Date.now()}_Pass!`;
        const { data: authData, error: authErr } = await supabase.auth.signUp({
          email: data.email,
          password: generatedPass,
        });
        if (authErr || !authData.user) {
          return { success: false, error: authErr?.message || 'Failed to create authentication user.' };
        }

        const { data: orgData, error: orgErr } = await supabase
          .from('organizations')
          .insert({
            name: data.companyName,
            industry: data.industry,
            company_size: data.companySize,
            slug: data.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            owner_id: authData.user.id,
            status: 'ACTIVE',
          })
          .select('*')
          .single();

        if (orgErr || !orgData) {
          return { success: false, error: orgErr?.message || 'Failed to create organization record.' };
        }

        const { data: profData, error: profErr } = await supabase
          .from('profiles')
          .insert({
            user_id: authData.user.id,
            organization_id: orgData.id,
            full_name: data.ownerName,
            phone: data.phone,
            role: 'OWNER',
            status: 'ACTIVE',
          })
          .select('*')
          .single();

        if (profErr || !profData) {
          return { success: false, error: profErr?.message || 'Failed to create owner profile.' };
        }

        setProfile(profData);
        setOrganization(orgData);
        return { success: true };
      }

      // 1. Create Organization in Database
      const newOrg = db.createOrganization({
        name: data.companyName,
        industry: data.industry,
        company_size: data.companySize,
        owner_id: `user-${Date.now().toString(36)}`,
      });

      // 2. Create Owner Profile via db.createProfile
      const newOwner = db.createProfile({
        user_id: newOrg.owner_id,
        organization_id: newOrg.id,
        full_name: data.ownerName,
        phone: data.phone,
        role: 'OWNER',
        status: 'ACTIVE',
      });

      setProfile(newOwner);
      setOrganization(newOrg);
      localStorage.setItem('leadvault_session', JSON.stringify({ profileId: newOwner.id }));

      db.logActivity({
        organization_id: newOrg.id,
        user_id: newOwner.id,
        user_name: newOwner.full_name,
        user_role: 'OWNER',
        action: 'LOGIN',
        entity_type: 'organization',
        entity_id: newOrg.id,
        metadata: { companyName: newOrg.name, owner: newOwner.full_name },
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    if (isRealSupabaseConfigured()) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Fallback
      }
    }
    if (profile) {
      db.logActivity({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_name: profile.full_name,
        user_role: profile.role,
        action: 'LOGOUT',
        entity_type: 'auth',
      });
    }
    localStorage.removeItem('leadvault_session');
    setProfile(null);
    setOrganization(null);
  };

  const switchRole = (role: UserRole) => {
    if (!IS_DEMO_MODE) {
      throw new Error('Role escalation forbidden: Persona switching is strictly disabled in production.');
    }
    const allProfiles = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile);
    const target = allProfiles.find((p) => p.role === role && p.organization_id === 'org-vertex-001');
    if (target) {
      setProfile(target);
      const orgs = db.getOrganizations(target);
      setOrganization(orgs.find((o) => o.id === target.organization_id) || DEMO_ORGS[0]);
      localStorage.setItem('leadvault_session', JSON.stringify({ profileId: target.id }));
    }
  };

  const quickLogin = (type: 'admin' | 'owner' | 'telecaller' | 'prime_owner') => {
    if (!IS_DEMO_MODE) {
      throw new Error('Quick login forbidden: Demo authentication is strictly disabled in production.');
    }
    const allProfiles = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile);
    let target: Profile | undefined;

    if (type === 'admin') {
      target = allProfiles.find((p) => p.role === 'ADMIN');
    } else if (type === 'owner') {
      target = allProfiles.find((p) => p.id === 'prof-owner-001');
    } else if (type === 'prime_owner') {
      target = allProfiles.find((p) => p.id === 'prof-owner-002');
    } else {
      target = allProfiles.find((p) => p.id === 'tc-arjun-01');
    }

    if (target) {
      setProfile(target);
      const orgs = db.getOrganizations(target);
      setOrganization(orgs.find((o) => o.id === target.organization_id) || null);
      localStorage.setItem('leadvault_session', JSON.stringify({ profileId: target.id }));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user: profile ? { id: profile.user_id, email: `${profile.full_name.toLowerCase().replace(/\s+/g, '.')}@leadvault.io` } : null,
        profile,
        organization,
        isAuthenticated: Boolean(profile),
        isLoading,
        isDemoMode: IS_DEMO_MODE,
        login,
        register,
        logout,
        switchRole,
        quickLogin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
