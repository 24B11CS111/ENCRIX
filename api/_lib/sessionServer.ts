import crypto from 'crypto';
import { getRequiredServerSecret } from './serverSecret';

export interface SessionPayload {
  userId: string;
  profileId: string;
  organizationId: string;
  role: 'ADMIN' | 'OWNER' | 'TELECALLER';
  email: string;
  fullName: string;
  status?: 'ACTIVE' | 'DISABLED' | 'PENDING' | 'PENDING_VERIFICATION' | 'SUSPENDED';
  iat: number;
  exp: number;
  sessionId?: string;
}

// In-memory revocation cache for revoked sessions
const revokedSessions = new Set<string>();

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

/**
 * Generates a cryptographically signed HMAC-SHA256 session token for an authenticated user.
 * Token cannot be forged or altered without the server secret.
 */
export function createSignedSessionToken(
  data: Omit<SessionPayload, 'iat' | 'exp'>,
  expiresInSeconds: number = 7 * 24 * 3600 // 7 days default TTL
): string {
  const secret = getRequiredServerSecret('SESSION_SERVER_SECRET');
  const now = Math.floor(Date.now() / 1000);
  const sessionId = data.sessionId || `sess_${crypto.randomBytes(16).toString('hex')}`;

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: SessionPayload = {
    ...data,
    sessionId,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const message = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('base64url');

  return `${message}.${signature}`;
}

/**
 * Cryptographically verifies an HMAC-SHA256 signed session token.
 * Returns decoded SessionPayload if valid and active, or null if forged, tampered, expired, or revoked.
 */
export function verifySignedSessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const secret = getRequiredServerSecret('SESSION_SERVER_SECRET');

  // Verify HMAC-SHA256 signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  if (signature.length !== expectedSignature.length) {
    return null;
  }

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  try {
    if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payloadStr = base64UrlDecode(encodedPayload);
    const payload = JSON.parse(payloadStr) as SessionPayload;

    if (!payload.userId || !payload.profileId || !payload.role) {
      return null;
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    // Check revocation
    if (payload.sessionId && revokedSessions.has(payload.sessionId)) {
      return null;
    }
    if (revokedSessions.has(token)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Revokes a session token so it cannot be reused.
 */
export function revokeSession(tokenOrSessionId: string): void {
  if (!tokenOrSessionId) return;
  revokedSessions.add(tokenOrSessionId);

  // If passed a full token, also extract and revoke the sessionId
  const payload = verifySignedSessionToken(tokenOrSessionId);
  if (payload?.sessionId) {
    revokedSessions.add(payload.sessionId);
  }
}

/**
 * Checks whether a session has been explicitly revoked.
 */
export function isSessionRevoked(tokenOrSessionId: string): boolean {
  return revokedSessions.has(tokenOrSessionId);
}
