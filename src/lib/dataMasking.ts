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
 * Sanitize student name for telecaller display:
 * Strips all numeric digits and telephone delimiters (+, -, /, _, ., parentheses).
 * Preserves alphabet characters and legitimate spaces.
 * Falls back to 'Student' if the name was purely numeric/punctuation.
 */
export function sanitizeStudentName(name?: string | null): string {
  if (!name) return 'Student';
  const cleaned = name.replace(/\d/g, '').replace(/[\-_./,()+]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'Student';
}

/**
 * Mask customer name to first name + initial:
 * Example: Rahul Kumar -> Rahul K.
 * Example: Priya Sharma Patel -> Priya S.
 * Example: Rahul 9876543210 -> Rahul
 * Example: 9876543210 -> Student
 */
export function maskName(fullName: string): string {
  if (!fullName) return '—';
  // Strip any digits or phone punctuation to ensure zero phone exposure in names
  const clean = sanitizeStudentName(fullName);
  const parts = clean.split(/\s+/);
  if (parts.length <= 1) {
    return parts[0] || 'Student';
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
 * Scrub any raw or formatted phone numbers from free-text notes, messages, or metadata.
 * Robustly detects standard 10-digit mobile numbers, E.164 formats, numbers with spaces,
 * slashes, underscores, dashes, dots, parentheses, and 5-5 digit splits.
 * Replaces any detected phone sequence with '[PHONE PROTECTED]'.
 */
const PHONE_PATTERN = /(?:(?:\+?\b|\+?\(?)\d[\d\s\-_./,()]{4,}\d|\b\d{7,15}\b)/g;

export function scrubPhoneFromText(text?: string | null): string | undefined {
  if (!text) return text ?? undefined;
  return text.replace(PHONE_PATTERN, (match) => {
    const digitCount = (match.match(/\d/g) || []).length;
    // Standard telephone sequences: 7 to 15 digits
    if (digitCount >= 7 && digitCount <= 15) {
      return '[PHONE PROTECTED]';
    }
    return match;
  });
}

/**
 * Strip all digits from person/place name fields (e.g. father_name, mother_name, city, state)
 * to prevent smuggling phone numbers in text attributes.
 */
export function stripDigitsFromText(text?: string | null): string | null | undefined {
  if (text === null) return null;
  if (text === undefined) return undefined;
  return text.replace(/\d/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Redact sequences of 5 or more consecutive digits or phone numbers from educational text fields
 * (e.g. school_or_college, course_interest), preserving academic years (e.g. 2024).
 * Redacts both unformatted and chunked/spaced/hyphenated phone numbers.
 */
export function redactLongDigitsFromText(text?: string | null): string | null | undefined {
  if (text === null) return null;
  if (text === undefined) return undefined;
  let scrubbed = scrubPhoneFromText(text);
  if (!scrubbed) return scrubbed;
  // Redact chunked digit sequences where total digits >= 5 (e.g. 9876-5432, 98 76 54)
  scrubbed = scrubbed.replace(/(?:(?:\+?\b|\+?\(?)\d[\d\s\-_./,()]{3,}\d)/g, (match) => {
    const digits = (match.match(/\d/g) || []).length;
    if (digits >= 5) {
      return '[REDACTED]';
    }
    return match;
  });
  return scrubbed.replace(/\b\d{5,}\b/g, '[REDACTED]');
}

/**
 * Enforces Zero-Phone-Exposure Invariant at data access boundary:
 * If role is TELECALLER, customer phone numbers are COMPLETELY STRIPPED (zero digits).
 * Surnames are masked to initials, emails masked, free-text notes scrubbed, and text fields sanitized.
 * Only OWNER and ADMIN receive unmasked data.
 */
export function sanitizeLeadForRole(lead: Lead, role: UserRole): Lead {
  if (role === 'OWNER' || role === 'ADMIN') {
    return { ...lead };
  }

  // Zero-Phone Invariant: Exclude phone completely from the telecaller object
  const { phone: _p, ...rest } = lead;

  // Sanitize metadata to prevent indirect phone leakage
  let sanitizedMetadata = rest.metadata ? { ...rest.metadata } : undefined;
  if (sanitizedMetadata) {
    for (const key of Object.keys(sanitizedMetadata)) {
      if (/phone|mobile|contact|alt_num|whatsapp|tel/i.test(key)) {
        delete sanitizedMetadata[key];
      } else if (typeof sanitizedMetadata[key] === 'string') {
        sanitizedMetadata[key] = scrubPhoneFromText(sanitizedMetadata[key] as string);
      }
    }
  }

  return {
    ...rest,
    name: maskName(lead.name),
    email: lead.email ? maskEmail(lead.email) : undefined,
    notes: rest.notes ? scrubPhoneFromText(rest.notes) : rest.notes,
    metadata: sanitizedMetadata,
    father_name: stripDigitsFromText(lead.father_name) as string | undefined,
    mother_name: stripDigitsFromText(lead.mother_name) as string | undefined,
    city: stripDigitsFromText(lead.city) as string | undefined,
    state: stripDigitsFromText(lead.state) as string | undefined,
    school_or_college: redactLongDigitsFromText(lead.school_or_college) as string | undefined,
    course_interest: redactLongDigitsFromText(lead.course_interest) as string | undefined,
  };
}

export function sanitizeLeadsForRole(leads: Lead[], role: UserRole): Lead[] {
  return leads.map((lead) => sanitizeLeadForRole(lead, role));
}


