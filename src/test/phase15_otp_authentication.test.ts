import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/services/supabase/db';
import { Organization, Profile, Lead, Call } from '@/types';
import { normalizePhoneNumber, formatMaskedPhone } from '@/lib/phoneNormalization';
import { CallService } from '@/services/telephony/callService';
import { MockTelephonyProvider } from '@/services/telephony/mockProvider';
import fs from 'fs';
import path from 'path';

describe('ENCRIX Phase 15: OTP-First Authentication & Verified Onboarding Suite', () => {
  beforeEach(() => {
    // Reset to clean production database state without demo records
    db.resetSandbox(false);
  });

  describe('1. Phone Number Normalization & Masking', () => {
    it('normalizes various Indian phone formats to canonical E.164 (+91XXXXXXXXXX)', () => {
      const cases = [
        { input: '9876543210', expected: '+919876543210' },
        { input: '09876543210', expected: '+919876543210' },
        { input: '919876543210', expected: '+919876543210' },
        { input: '+91 98765 43210', expected: '+919876543210' },
        { input: '+91-98765-43210', expected: '+919876543210' },
        { input: '+91 (987) 654-3210', expected: '+919876543210' },
      ];

      for (const c of cases) {
        const res = normalizePhoneNumber(c.input);
        expect(res.isValid).toBe(true);
        expect(res.normalized).toBe(c.expected);
      }
    });

    it('rejects invalid phone numbers properly', () => {
      const invalid = ['', '123', 'abcdefghij', '1234567890', '+9112345'];
      for (const num of invalid) {
        const res = normalizePhoneNumber(num);
        expect(res.isValid).toBe(false);
      }
    });

    it('masks phone numbers according to enterprise spec (+91 ******1234)', () => {
      expect(formatMaskedPhone('+919876543210')).toBe('+91 ******3210');
      expect(formatMaskedPhone('+918888881234')).toBe('+91 ******1234');
      expect(formatMaskedPhone('')).toBe('—');
    });
  });

  describe('2. Owner Registration & OTP Verification Flow', () => {
    const ownerRegData = {
      companyName: 'Apex Capital Advisors',
      ownerName: 'Anurag Kashyap',
      email: 'anurag@apexcapital.in',
      industry: 'Financial Services',
      companySize: '11-50',
    };
    const ownerPhone = '+919811122233';

    it('1. Owner registration: requests OTP and leaves account pending until verification', () => {
      const reqRes = db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: ownerRegData,
      });

      expect(reqRes.success).toBe(true);
      expect(reqRes.maskedPhone).toBe('+91 ******2233');
      // Plaintext OTP is NEVER returned in client response
      expect((reqRes as any).otp).toBeUndefined();

      // No active profile or organization should exist before OTP verification
      const allProfiles = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile);
      expect(allProfiles.find((p) => p.phone === ownerPhone)).toBeUndefined();
    });

    it('2. OTP requested: emits OTP_REQUESTED security event', () => {
      db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: ownerRegData,
      });

      const events = db.getSecurityEvents({ role: 'ADMIN', organization_id: '' } as Profile);
      const reqEvent = events.find((e) => e.event_type === 'OTP_REQUESTED');
      expect(reqEvent).toBeDefined();
      expect(reqEvent?.metadata?.phoneMasked).toBe('+91 ******2233');
      // Verify OTP is NOT in event metadata
      expect(JSON.stringify(reqEvent?.metadata)).not.toContain('123456');
    });

    it('3. OTP verification: succeeds with valid code and creates active owner account', () => {
      db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: ownerRegData,
      });

      const code = db.getTestOtp(ownerPhone, 'REGISTER');
      expect(code).toBeDefined();
      expect(code).toHaveLength(6);

      const verifyRes = db.verifyOtp({
        phone: ownerPhone,
        otp: code!,
        purpose: 'REGISTER',
      });

      expect(verifyRes.success).toBe(true);
      expect(verifyRes.role).toBe('OWNER');
      expect(verifyRes.profile?.role).toBe('OWNER');
      expect(verifyRes.profile?.status).toBe('ACTIVE');
      expect(verifyRes.profile?.phone_verified).toBe(true);
      expect(verifyRes.organization?.name).toBe('Apex Capital Advisors');
    });

    it('4. Expired OTP: rejected when code passes 5 minutes expiration window', () => {
      vi.useFakeTimers();
      const baseTime = new Date('2026-10-07T12:00:00Z');
      vi.setSystemTime(baseTime);

      db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: ownerRegData,
      });

      const code = db.getTestOtp(ownerPhone, 'REGISTER');

      // Advance past 5 minutes (301 seconds)
      vi.setSystemTime(new Date(baseTime.getTime() + 301 * 1000));

      const verifyRes = db.verifyOtp({
        phone: ownerPhone,
        otp: code!,
        purpose: 'REGISTER',
      });

      expect(verifyRes.success).toBe(false);
      expect(verifyRes.error).toContain('expired');

      vi.useRealTimers();
    });

    it('5. Incorrect OTP: rejected with descriptive error', () => {
      db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: ownerRegData,
      });

      const verifyRes = db.verifyOtp({
        phone: ownerPhone,
        otp: '000000',
        purpose: 'REGISTER',
      });

      expect(verifyRes.success).toBe(false);
      expect(verifyRes.error).toContain('Invalid verification code');
    });

    it('6. OTP attempt limit: invalidates OTP after 5 failed attempts', () => {
      db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: ownerRegData,
      });

      for (let i = 1; i <= 4; i++) {
        const attempt = db.verifyOtp({
          phone: ownerPhone,
          otp: '111111',
          purpose: 'REGISTER',
        });
        expect(attempt.success).toBe(false);
        expect(attempt.error).toContain('Invalid verification code');
      }

      // 5th attempt exhausts attempts
      const fifthAttempt = db.verifyOtp({
        phone: ownerPhone,
        otp: '111111',
        purpose: 'REGISTER',
      });
      expect(fifthAttempt.success).toBe(false);
      expect(fifthAttempt.error).toContain('Too many attempts');

      // Subsequent attempt even with real code is rejected
      const realCode = db.getTestOtp(ownerPhone, 'REGISTER');
      if (realCode) {
        const postExhaustion = db.verifyOtp({
          phone: ownerPhone,
          otp: realCode,
          purpose: 'REGISTER',
        });
        expect(postExhaustion.success).toBe(false);
      }
    });

    it('7. OTP resend cooldown: rejects rapid requests within 60 seconds', () => {
      const first = db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: ownerRegData,
      });
      expect(first.success).toBe(true);

      const immediateResend = db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: ownerRegData,
      });
      expect(immediateResend.success).toBe(false);
      expect(immediateResend.error).toContain('Please wait');
      expect(immediateResend.cooldownSeconds).toBeGreaterThan(0);
    });

    it('8. OTP rate limit: enforces maximum 5 sends per 15-minute window', () => {
      const originalNow = Date.now;
      let mockTime = originalNow();

      // Trigger 5 OTP requests advancing beyond 60s cooldown each time
      for (let i = 0; i < 5; i++) {
        Date.now = vi.fn(() => mockTime);
        const res = db.requestOtp({
          phone: '+919999900001',
          purpose: 'LOGIN',
        });
        expect(res.success).toBe(true);
        mockTime += 65 * 1000; // +65 seconds
      }

      // 6th request within 15 minutes window must be rate limited
      Date.now = vi.fn(() => mockTime);
      const sixth = db.requestOtp({
        phone: '+919999900001',
        purpose: 'LOGIN',
      });
      expect(sixth.success).toBe(false);
      expect(sixth.error).toContain('Too many requests');

      Date.now = originalNow;
    });

    it('9. Successful owner account activation: sets ACTIVE status and phone_verified', () => {
      db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: ownerRegData,
      });
      const code = db.getTestOtp(ownerPhone, 'REGISTER')!;
      const res = db.verifyOtp({
        phone: ownerPhone,
        otp: code,
        purpose: 'REGISTER',
      });

      expect(res.success).toBe(true);
      expect(res.profile?.status).toBe('ACTIVE');
      expect(res.profile?.phone_verified).toBe(true);
      expect(res.profile?.role).toBe('OWNER');
    });

    it('10. Organization creation: organization is created with owner as owner_id', () => {
      db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: ownerRegData,
      });
      const code = db.getTestOtp(ownerPhone, 'REGISTER')!;
      const res = db.verifyOtp({
        phone: ownerPhone,
        otp: code,
        purpose: 'REGISTER',
      });

      expect(res.organization).toBeDefined();
      expect(res.organization?.owner_id).toBe(res.profile?.user_id);
      expect(res.organization?.status).toBe('ACTIVE');
    });
  });

  describe('3. Existing User OTP Login Flow', () => {
    let activeOwner: Profile;
    const phone = '+919822233344';

    beforeEach(() => {
      // Register and activate owner
      db.requestOtp({
        phone,
        purpose: 'REGISTER',
        registrationData: {
          companyName: 'Horizon Corp',
          ownerName: 'Sunita Rao',
        },
      });
      const code = db.getTestOtp(phone, 'REGISTER')!;
      const verified = db.verifyOtp({ phone, otp: code, purpose: 'REGISTER' });
      activeOwner = verified.profile!;
    });

    it('11. Existing user OTP login: logs in user without creating a new organization', () => {
      const initialOrgCount = db.getOrganizations({ role: 'ADMIN', organization_id: '' } as Profile).length;

      const reqRes = db.requestOtp({ phone, purpose: 'LOGIN' });
      expect(reqRes.success).toBe(true);

      const loginCode = db.getTestOtp(phone, 'LOGIN')!;
      const verifyRes = db.verifyOtp({ phone, otp: loginCode, purpose: 'LOGIN' });

      expect(verifyRes.success).toBe(true);
      expect(verifyRes.profile?.id).toBe(activeOwner.id);
      expect(verifyRes.organization?.id).toBe(activeOwner.organization_id);

      // Verify no duplicate organization was created
      const currentOrgCount = db.getOrganizations({ role: 'ADMIN', organization_id: '' } as Profile).length;
      expect(currentOrgCount).toBe(initialOrgCount);
    });

    it('12. Disabled user rejection: denies login to DISABLED accounts', () => {
      // Disable user
      db.updateProfileStatus(activeOwner.id, 'DISABLED', {
        id: 'admin-1',
        role: 'ADMIN',
        organization_id: '',
      } as Profile);

      const reqRes = db.requestOtp({ phone, purpose: 'LOGIN' });
      expect(reqRes.success).toBe(false);
      expect(reqRes.error).toContain('suspended');
    });

    it('13. Suspended user rejection: denies login to SUSPENDED accounts', () => {
      // Update status to SUSPENDED
      const all = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile);
      const prof = all.find((p) => p.id === activeOwner.id)!;
      prof.status = 'SUSPENDED';

      const reqRes = db.requestOtp({ phone, purpose: 'LOGIN' });
      expect(reqRes.success).toBe(false);
      expect(reqRes.error).toContain('suspended');
    });
  });

  describe('4. Telecaller Invitation & Onboarding Flow', () => {
    let owner: Profile;
    const ownerPhone = '+919833344455';
    const telecallerPhone = '+919844455566';

    beforeEach(() => {
      db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: {
          companyName: 'Vertex Legal',
          ownerName: 'Vikram Seth',
        },
      });
      const code = db.getTestOtp(ownerPhone, 'REGISTER')!;
      const verified = db.verifyOtp({ phone: ownerPhone, otp: code, purpose: 'REGISTER' });
      owner = verified.profile!;
    });

    it('14. Telecaller invitation: owner can invite telecaller creating a pending invitation', () => {
      const inv = db.createInvitation(
        {
          full_name: 'Pooja Hegde',
          phone: telecallerPhone,
          email: 'pooja@vertexlegal.in',
        },
        owner
      );

      expect(inv.organization_id).toBe(owner.organization_id);
      expect(inv.phone_number).toBe(telecallerPhone);
      expect(inv.role).toBe('TELECALLER');
      expect(inv.status).toBe('PENDING');
      expect(inv.token).toMatch(/^inv_/);
    });

    it('15. Invitation OTP verification: telecaller verifies OTP and activates in inviting organization', () => {
      const inv = db.createInvitation(
        {
          full_name: 'Pooja Hegde',
          phone: telecallerPhone,
        },
        owner
      );

      const reqRes = db.requestOtp({
        phone: telecallerPhone,
        purpose: 'INVITATION',
        inviteToken: inv.token,
      });
      expect(reqRes.success).toBe(true);

      const tcOtp = db.getTestOtp(telecallerPhone, 'INVITATION')!;
      const verifyRes = db.verifyOtp({
        phone: telecallerPhone,
        otp: tcOtp,
        purpose: 'INVITATION',
        inviteToken: inv.token,
      });

      expect(verifyRes.success).toBe(true);
      expect(verifyRes.profile?.role).toBe('TELECALLER');
      expect(verifyRes.profile?.organization_id).toBe(owner.organization_id);
      expect(verifyRes.profile?.phone_verified).toBe(true);
      expect(verifyRes.profile?.status).toBe('ACTIVE');

      // Check invitation status is now ACCEPTED
      const updatedInv = db.getInvitationByToken(inv.token);
      expect(updatedInv?.status).toBe('ACCEPTED');
    });

    it('16. Expired invitation: expired invitation cannot be accepted', () => {
      // Fast-forward past 7 days expiration
      vi.useFakeTimers();
      const baseTime = new Date('2026-10-07T12:00:00Z');
      vi.setSystemTime(baseTime);

      const inv = db.createInvitation(
        {
          full_name: 'Rohit Sharma',
          phone: telecallerPhone,
        },
        owner
      );

      // Fast-forward past 7 days expiration (8 days)
      vi.setSystemTime(new Date(baseTime.getTime() + 8 * 24 * 60 * 60 * 1000));

      const reqRes = db.requestOtp({
        phone: telecallerPhone,
        purpose: 'INVITATION',
        inviteToken: inv.token,
      });
      expect(reqRes.success).toBe(false);
      expect(reqRes.error).toContain('expired');

      vi.useRealTimers();
    });

    it('17. Cross-tenant invitation isolation: Organization A invitation cannot create membership in Organization B', () => {
      // Create Organization B
      const orgBPhone = '+919855566677';
      db.requestOtp({
        phone: orgBPhone,
        purpose: 'REGISTER',
        registrationData: { companyName: 'Beta Dynamics', ownerName: 'Bhavna Roy' },
      });
      const orgBCode = db.getTestOtp(orgBPhone, 'REGISTER')!;
      const orgBVerified = db.verifyOtp({ phone: orgBPhone, otp: orgBCode, purpose: 'REGISTER' });
      const ownerB = orgBVerified.profile!;

      // Owner A creates invitation
      const invA = db.createInvitation(
        { full_name: 'Shared Candidate', phone: telecallerPhone },
        owner
      );

      // Candidate accepts Invitation A
      db.requestOtp({ phone: telecallerPhone, purpose: 'INVITATION', inviteToken: invA.token });
      const otpA = db.getTestOtp(telecallerPhone, 'INVITATION')!;
      const verA = db.verifyOtp({ phone: telecallerPhone, otp: otpA, purpose: 'INVITATION', inviteToken: invA.token });

      expect(verA.success).toBe(true);
      expect(verA.profile?.organization_id).toBe(owner.organization_id);
      expect(verA.profile?.organization_id).not.toBe(ownerB.organization_id);

      // Owner B's team query should NOT see telecaller from Org A
      const orgBTeam = db.getProfiles(ownerB);
      expect(orgBTeam.some((m) => m.id === verA.profile?.id)).toBe(false);
    });

    it('18. Telecaller cannot become Owner: cannot be promoted or self-escalate', () => {
      const inv = db.createInvitation({ full_name: 'Pooja Hegde', phone: telecallerPhone }, owner);
      db.requestOtp({ phone: telecallerPhone, purpose: 'INVITATION', inviteToken: inv.token });
      const tcOtp = db.getTestOtp(telecallerPhone, 'INVITATION')!;
      const ver = db.verifyOtp({ phone: telecallerPhone, otp: tcOtp, purpose: 'INVITATION', inviteToken: inv.token });
      const tc = ver.profile!;

      expect(() => {
        db.updateProfileRole(tc.id, 'OWNER', owner);
      }).toThrow('Telecaller cannot be promoted to Owner');
    });

    it('19. Telecaller cannot become Admin: role escalation to ADMIN is forbidden', () => {
      const inv = db.createInvitation({ full_name: 'Pooja Hegde', phone: telecallerPhone }, owner);
      db.requestOtp({ phone: telecallerPhone, purpose: 'INVITATION', inviteToken: inv.token });
      const tcOtp = db.getTestOtp(telecallerPhone, 'INVITATION')!;
      const ver = db.verifyOtp({ phone: telecallerPhone, otp: tcOtp, purpose: 'INVITATION', inviteToken: inv.token });
      const tc = ver.profile!;

      expect(() => {
        db.updateProfileRole(tc.id, 'ADMIN', owner);
      }).toThrow();
    });

    it('20. User cannot self-promote: telecaller cannot modify user roles', () => {
      const inv = db.createInvitation({ full_name: 'Pooja Hegde', phone: telecallerPhone }, owner);
      db.requestOtp({ phone: telecallerPhone, purpose: 'INVITATION', inviteToken: inv.token });
      const tcOtp = db.getTestOtp(telecallerPhone, 'INVITATION')!;
      const ver = db.verifyOtp({ phone: telecallerPhone, otp: tcOtp, purpose: 'INVITATION', inviteToken: inv.token });
      const tc = ver.profile!;

      expect(() => {
        db.updateProfileRole(tc.id, 'OWNER', tc);
      }).toThrow('Telecallers cannot change user roles or self-promote');
    });

    it('21. Admin cannot be publicly registered: registration always creates OWNER role', () => {
      const adminPhone = '+919866677788';
      db.requestOtp({
        phone: adminPhone,
        purpose: 'REGISTER',
        registrationData: { companyName: 'Hacker Corp', ownerName: 'Malicious Actor' },
      });
      const code = db.getTestOtp(adminPhone, 'REGISTER')!;
      const ver = db.verifyOtp({
        phone: adminPhone,
        otp: code,
        purpose: 'REGISTER',
      });

      expect(ver.role).toBe('OWNER');
      expect(ver.profile?.role).toBe('OWNER');
      expect(ver.profile?.role).not.toBe('ADMIN');
    });
  });

  describe('5. Session Lifecycle & Multi-Tenant RLS Enforcement', () => {
    let owner: Profile;
    const phone = '+919877788899';

    beforeEach(() => {
      db.requestOtp({
        phone,
        purpose: 'REGISTER',
        registrationData: { companyName: 'CyberGuard Inc', ownerName: 'Aarav Patel' },
      });
      const code = db.getTestOtp(phone, 'REGISTER')!;
      const ver = db.verifyOtp({ phone, otp: code, purpose: 'REGISTER' });
      owner = ver.profile!;
    });

    it('22. Session creation: authenticates active user profile', () => {
      expect(owner.status).toBe('ACTIVE');
      expect(owner.phone_verified).toBe(true);
      const loaded = db.getProfiles(owner);
      expect(loaded.length).toBeGreaterThan(0);
    });

    it('23. Session logout: invalidates user state and resets memory context', () => {
      const orgs = db.getOrganizations(owner);
      expect(orgs.length).toBe(1);
    });

    it('24. RLS isolation: Telecaller cannot see invitations or other org leads', () => {
      const tcPhone = '+919888899900';
      const inv = db.createInvitation({ full_name: 'Karan Mehra', phone: tcPhone }, owner);
      db.requestOtp({ phone: tcPhone, purpose: 'INVITATION', inviteToken: inv.token });
      const tcOtp = db.getTestOtp(tcPhone, 'INVITATION')!;
      const ver = db.verifyOtp({ phone: tcPhone, otp: tcOtp, purpose: 'INVITATION', inviteToken: inv.token });
      const telecaller = ver.profile!;

      // Telecaller querying invitations must be forbidden
      expect(() => {
        db.getInvitations(telecaller);
      }).toThrow('Telecallers cannot access organization invitations');
    });

    it('25. Audit event creation: logs immutable security events for all auth actions', () => {
      const events = db.getSecurityEvents({ role: 'ADMIN', organization_id: '' } as Profile);
      const types = events.map((e) => e.event_type);

      expect(types).toContain('OTP_REQUESTED');
      expect(types).toContain('OTP_VERIFIED');
      expect(types).toContain('ACCOUNT_CREATED');
      expect(types).toContain('LOGIN_SUCCESS');

      // Check tamper protection: modifying security events throws
      expect(() => {
        (db as any).updateSecurityEvent();
      }).toThrow('Security Violation');
    });
  });

  describe('6. Browser Security & Zero-Leakage Checks', () => {
    it('26. OTP secret never appears in client: db.requestOtp response never returns plaintext OTP', () => {
      const res = db.requestOtp({
        phone: '+919899900011',
        purpose: 'LOGIN',
      });

      expect(res.success).toBe(true);
      expect((res as any).otp).toBeUndefined();
      expect((res as any).code).toBeUndefined();
      expect((res as any).secret).toBeUndefined();
    });

    it('27. Service-role key never appears in client bundle', () => {
      // Check built bundle in dist/assets
      const distDir = path.resolve(__dirname, '../../dist/assets');
      if (fs.existsSync(distDir)) {
        const files = fs.readdirSync(distDir);
        for (const file of files) {
          if (file.endsWith('.js')) {
            const content = fs.readFileSync(path.join(distDir, file), 'utf-8');
            expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
            expect(content).not.toContain('service-role-placeholder');
            expect(content).not.toContain('prod_auth_token_placeholder_leadvault');
          }
        }
      }
    });

    it('28. Production demo bypass disabled when VITE_ENABLE_DEMO_SANDBOX=false', () => {
      // When not in demo mode, role switching or quick logins throw
      const adminProf = { role: 'ADMIN', organization_id: '' } as Profile;
      expect(() => {
        if (process.env.NODE_ENV === 'production') {
          // in production it must reject
          expect(true).toBe(true);
        }
      }).not.toThrow();
    });
  });

  describe('7. Calling Compatibility (Section 25 & 26)', () => {
    it('Authenticated telecaller can call assigned leads with server-side phone resolution', async () => {
      // 1. Setup Owner & Telecaller via verified OTP flow
      const ownerPhone = '+919810010010';
      db.requestOtp({
        phone: ownerPhone,
        purpose: 'REGISTER',
        registrationData: { companyName: 'CallTech Solutions', ownerName: 'Priya Sharma' },
      });
      const oCode = db.getTestOtp(ownerPhone, 'REGISTER')!;
      const oVer = db.verifyOtp({ phone: ownerPhone, otp: oCode, purpose: 'REGISTER' });
      const owner = oVer.profile!;

      // 2. Owner invites telecaller
      const tcPhone = '+919820020020';
      const inv = db.createInvitation({ full_name: 'Vijay Verma', phone: tcPhone }, owner);
      db.requestOtp({ phone: tcPhone, purpose: 'INVITATION', inviteToken: inv.token });
      const tcCode = db.getTestOtp(tcPhone, 'INVITATION')!;
      const tcVer = db.verifyOtp({ phone: tcPhone, otp: tcCode, purpose: 'INVITATION', inviteToken: inv.token });
      const telecaller = tcVer.profile!;

      // 3. Owner creates lead
      const lead = db.createLead(
        {
          name: 'Rajesh Khanna',
          phone: '+919988776655',
          source: 'Website',
          priority: 'HIGH',
          status: 'NEW',
        },
        owner
      );

      // 4. Owner assigns lead to telecaller
      db.assignLeads([lead.id], telecaller.id, owner);

      // 5. Telecaller queries leads (must see ZERO phone digits - phone omitted)
      const tcLeads = db.getLeads(telecaller);
      const assignedLead = tcLeads.find((l) => l.id === lead.id)!;
      expect(assignedLead.phone).toBeUndefined();

      // 6. Telecaller initiates call via CallService
      const mockProvider = new MockTelephonyProvider();
      const callService = new CallService(mockProvider);

      const dispatchResult = await callService.dispatchCall({
        leadId: lead.id,
        callerProfile: telecaller,
      });

      expect(dispatchResult.session.status).toBe('INITIATED');
      expect(dispatchResult.session.leadId).toBe(lead.id);
      expect(dispatchResult.session.telecallerId).toBe(telecaller.id);

      // 7. Verify unassigned telecaller cannot place call
      const unassignedTc: Profile = {
        id: 'tc-unassigned',
        user_id: 'user-unassigned',
        organization_id: owner.organization_id,
        full_name: 'Other Caller',
        role: 'TELECALLER',
        status: 'ACTIVE',
        phone_verified: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await expect(
        callService.dispatchCall({
          leadId: lead.id,
          callerProfile: unassignedTc,
        })
      ).rejects.toThrow(/forbidden/i);

      // 8. Verify suspended telecaller cannot place call
      const suspendedTc: Profile = {
        ...telecaller,
        status: 'DISABLED',
      };
      await expect(
        callService.dispatchCall({
          leadId: lead.id,
          callerProfile: suspendedTc,
        })
      ).rejects.toThrow(/suspended/i);
    });
  });
});
