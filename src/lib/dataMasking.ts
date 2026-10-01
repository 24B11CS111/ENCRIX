import { Lead, UserRole } from '@/types';

/**
 * Mask customer phone number according to enterprise security specs:
 * Example: +91 9876543210 -> +91 ******3210
 * Example: 9876543210 -> ******3210
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone) return '—';
  const clean = phone.trim();
  
  // If formatted like +91 9876543210 or +919876543210
  if (clean.startsWith('+')) {
    const parts = clean.split(' ');
    if (parts.length >= 2) {
      const countryCode = parts[0];
      const rest = parts.slice(1).join('');
      if (rest.length > 4) {
        return `${countryCode} ${'*'.repeat(rest.length - 4)}${rest.slice(-4)}`;
      }
      return `${countryCode} ******${rest.slice(-2)}`;
    } else {
      // "+919876543210"
      const countryCode = clean.slice(0, 3);
      const rest = clean.slice(3);
      if (rest.length > 4) {
        return `${countryCode} ${'*'.repeat(Math.max(rest.length - 4, 4))}${rest.slice(-4)}`;
      }
      return `${countryCode} ******${rest.slice(-2)}`;
    }
  }

  // Without country code (e.g. 9876543210)
  if (clean.length > 4) {
    return `${'*'.repeat(Math.min(clean.length - 4, 6))}${clean.slice(-4)}`;
  }
  return '******';
}

/**
 * Mask customer name to first name + initial:
 * Example: Rahul Kumar -> Rahul K.
 * Example: Priya Sharma Patel -> Priya S.
 */
export function maskName(fullName: string): string {
  if (!fullName) return '—';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) {
    return parts[0];
  }
  const firstName = parts[0];
  const secondInitial = parts[1].charAt(0).toUpperCase();
  return `${firstName} ${secondInitial}.`;
}

/**
 * Mask customer email:
 * Example: rahul.kumar@example.com -> r***r@example.com
 */
export function maskEmail(email?: string): string {
  if (!email) return '—';
  const [user, domain] = email.split('@');
  if (!domain || user.length <= 2) return '***@' + (domain || '***');
  return `${user.charAt(0)}***${user.charAt(user.length - 1)}@${domain}`;
}

/**
 * Enforces data masking at data access boundary:
 * If role is TELECALLER, sensitive fields (raw phone, full surname, raw email)
 * are permanently replaced before reaching UI components.
 * Only OWNER and ADMIN receive unmasked data.
 */
export function sanitizeLeadForRole(lead: Lead, role: UserRole): Lead {
  if (role === 'OWNER' || role === 'ADMIN') {
    return { ...lead };
  }

  return {
    ...lead,
    name: maskName(lead.name),
    phone: maskPhoneNumber(lead.phone),
    email: lead.email ? maskEmail(lead.email) : undefined,
  };
}

export function sanitizeLeadsForRole(leads: Lead[], role: UserRole): Lead[] {
  return leads.map((lead) => sanitizeLeadForRole(lead, role));
}
