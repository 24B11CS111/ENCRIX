/**
 * ENCRIX Phone Number Normalization & Masking
 * Standardizes numbers to E.164 format and provides enterprise masking.
 */

export interface PhoneNormalizationResult {
  raw: string;
  normalized: string;
  isValid: boolean;
  countryCode: string;
  nationalNumber: string;
  masked: string;
  error?: string;
}

/**
 * Normalizes phone numbers to canonical E.164 format.
 * Specifically handles Indian mobile numbers (+91), stripping leading 0s, 91, or spaces.
 */
export function normalizePhoneNumber(input: string): PhoneNormalizationResult {
  if (!input || typeof input !== 'string') {
    return {
      raw: '',
      normalized: '',
      isValid: false,
      countryCode: '',
      nationalNumber: '',
      masked: '—',
      error: 'Phone number is required',
    };
  }

  const raw = input.trim();
  // Strip spaces, dashes, parentheses, dots
  let cleaned = raw.replace(/[\s\-\(\)\.]/g, '');

  // Check if international format starting with '+'
  let hasPlus = cleaned.startsWith('+');
  if (hasPlus) {
    cleaned = cleaned.substring(1);
  }

  // Digits only check
  if (!/^\d+$/.test(cleaned)) {
    return {
      raw,
      normalized: '',
      isValid: false,
      countryCode: '',
      nationalNumber: '',
      masked: '—',
      error: 'Phone number contains invalid characters',
    };
  }

  // Handle Indian mobile numbers (standard 10-digit mobile starting with 6, 7, 8, 9)
  // Case 1: 10 digits (e.g., 9876543210)
  if (cleaned.length === 10 && /^[6-9]\d{9}$/.test(cleaned)) {
    const normalized = `+91${cleaned}`;
    return {
      raw,
      normalized,
      isValid: true,
      countryCode: '+91',
      nationalNumber: cleaned,
      masked: formatMaskedPhone(normalized),
    };
  }

  // Case 2: 11 digits with leading 0 (e.g., 09876543210)
  if (cleaned.length === 11 && cleaned.startsWith('0') && /^[6-9]\d{9}$/.test(cleaned.substring(1))) {
    const nationalNumber = cleaned.substring(1);
    const normalized = `+91${nationalNumber}`;
    return {
      raw,
      normalized,
      isValid: true,
      countryCode: '+91',
      nationalNumber,
      masked: formatMaskedPhone(normalized),
    };
  }

  // Case 3: Indian number starting with 91 or +91
  if (cleaned.startsWith('91')) {
    if (cleaned.length === 12 && /^[6-9]\d{9}$/.test(cleaned.substring(2))) {
      const nationalNumber = cleaned.substring(2);
      const normalized = `+91${nationalNumber}`;
      return {
        raw,
        normalized,
        isValid: true,
        countryCode: '+91',
        nationalNumber,
        masked: formatMaskedPhone(normalized),
      };
    }
    return {
      raw,
      normalized: '',
      isValid: false,
      countryCode: '+91',
      nationalNumber: cleaned.substring(2),
      masked: '—',
      error: 'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9',
    };
  }

  // Case 4: Other International E.164 (e.g. +14155552671, min 8 digits, max 15 digits)
  if (hasPlus && cleaned.length >= 8 && cleaned.length <= 15) {
    const normalized = `+${cleaned}`;
    return {
      raw,
      normalized,
      isValid: true,
      countryCode: `+${cleaned.substring(0, Math.min(3, cleaned.length - 7))}`,
      nationalNumber: cleaned.substring(Math.min(3, cleaned.length - 7)),
      masked: formatMaskedPhone(normalized),
    };
  }

  // If input was 10 digits not starting with 6-9
  if (cleaned.length === 10) {
    return {
      raw,
      normalized: '',
      isValid: false,
      countryCode: '',
      nationalNumber: cleaned,
      masked: '—',
      error: 'Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9',
    };
  }

  return {
    raw,
    normalized: '',
    isValid: false,
    countryCode: '',
    nationalNumber: cleaned,
    masked: '—',
    error: 'Please enter a valid phone number (e.g. +91 98765 43210 or 9876543210)',
  };
}

/**
 * Enterprise Phone Masking
 * Formats:
 * +919876543210 -> +91 ******3210
 * +14155552671 -> +1 ******2671
 */
export function formatMaskedPhone(phone: string): string {
  if (!phone) return '—';
  const clean = phone.trim();

  if (clean.startsWith('+')) {
    const withoutPlus = clean.substring(1);
    if (withoutPlus.startsWith('91') && withoutPlus.length === 12) {
      const last4 = withoutPlus.slice(-4);
      return `+91 ******${last4}`;
    }
    if (withoutPlus.startsWith('1') && withoutPlus.length === 11) {
      const last4 = withoutPlus.slice(-4);
      return `+1 ******${last4}`;
    }
    // Generic international
    const last4 = withoutPlus.slice(-4);
    const prefix = clean.substring(0, 3);
    return `${prefix} ******${last4}`;
  }

  if (clean.length >= 10) {
    const last4 = clean.slice(-4);
    return `+91 ******${last4}`;
  }

  return '******';
}
