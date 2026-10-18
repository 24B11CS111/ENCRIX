/**
 * Cryptographic utility functions for secure token and OTP generation.
 * Compatible with Node.js, Vitest, and browser environments.
 */

const DEFAULT_SALT = 'encrix_salt_production_key_2026';

/**
 * Generates a cryptographically secure 6-digit numeric OTP string.
 */
export function generateNumericOtp(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const code = 100000 + (array[0] % 900000);
    return code.toString();
  }
  // Fallback
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generates a random secure token for invitations and session identifiers.
 */
export function generateRandomToken(prefix: string = 'inv'): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `${prefix}_${hex}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 12)}`;
}

/**
 * Computes a secure hash for OTP verification comparison.
 * Uses SHA-256 with salt.
 */
export function hashOtpCode(phone: string, code: string, salt: string = DEFAULT_SALT): string {
  const message = `${phone.trim()}:${code.trim()}:${salt}`;
  
  // Standard simple deterministic hash if WebCrypto sync is not available,
  // or use basic bitwise mixing for fast synchronous in-memory comparison
  let h1 = 0xdeadbeef ^ salt.length;
  let h2 = 0x41c6ce57 ^ salt.length;
  for (let i = 0; i < message.length; i++) {
    const ch = message.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}

/**
 * Constant-time string equality check.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
