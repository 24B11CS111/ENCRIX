/**
 * ENCRIX Email Normalization & Enterprise Masking
 * Standardizes email addresses to RFC 5322 lowercase canonical form
 * and masks them for zero-leakage display in verification screens.
 */

export interface NormalizedEmailResult {
  isValid: boolean;
  normalized: string;
  masked: string;
  error?: string;
}

export function normalizeEmail(email: string | null | undefined): NormalizedEmailResult {
  return normalizeEmailAddress(email);
}

export function normalizeEmailAddress(email: string | null | undefined): NormalizedEmailResult {
  const raw = typeof email === 'string' ? email.trim() : '';

  if (!raw) {
    return { isValid: false, normalized: '', masked: '—', error: 'Email address is required.' };
  }

  const normalized = raw.toLowerCase();
  if (normalized.length > 254) {
    return { isValid: false, normalized: '', masked: '—', error: 'Email address is too long (maximum 254 characters).' };
  }

  // RFC 5322 compliant regex for standard email addresses
  const emailRegex = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
  if (!emailRegex.test(normalized)) {
    return { isValid: false, normalized: '', masked: '—', error: 'Please enter a valid email address (e.g. name@company.com).' };
  }

  return {
    isValid: true,
    normalized,
    masked: formatMaskedEmail(normalized),
  };
}

export function formatMaskedEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return '—';
  const normalized = email.trim().toLowerCase();
  const at = normalized.indexOf('@');
  if (at === -1) return '••••';

  const localPart = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const visible = localPart.length > 0 ? localPart.charAt(0) : 'a';
  return `${visible}••••@${domain}`;
}

export const maskEmailForOtp = formatMaskedEmail;
