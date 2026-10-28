import crypto from 'crypto';

export interface StoredServerInvitation {
  id: string;
  organization_id: string;
  organization_name?: string;
  phone_number?: string | null;
  full_name: string;
  email: string;
  invited_by: string;
  role: 'TELECALLER';
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  token: string;
  expires_at: string;
  created_at: string;
}

// In-memory server fallback store for local development and test resilience
export const serverInvitationStore = new Map<string, StoredServerInvitation>();

/**
 * Returns the canonical application base URL configured in environment variables
 * or derived from request headers. Trailing slashes are stripped.
 */
export function getCanonicalBaseUrl(req?: any): string {
  const envUrl =
    process.env.APP_URL ||
    process.env.VITE_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL;

  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  if (req?.headers) {
    const proto =
      req.headers['x-forwarded-proto'] ||
      (req.connection?.encrypted ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (host && typeof host === 'string') {
      return `${proto}://${host}`.replace(/\/+$/, '');
    }
  }

  return 'http://localhost:5173';
}

/**
 * Persists an invitation to the server in-memory fallback store.
 */
export function storeServerInvitation(invitation: StoredServerInvitation): void {
  if (!invitation?.token) return;
  serverInvitationStore.set(invitation.token, { ...invitation });
}

/**
 * Retrieves an invitation from the server in-memory fallback store.
 * Automatically marks pending invitations as EXPIRED if their expiry time has passed.
 */
export function getServerInvitation(token: string): StoredServerInvitation | null {
  if (!token) return null;
  const inv = serverInvitationStore.get(token);
  if (!inv) return null;

  if (inv.status === 'PENDING' && new Date(inv.expires_at).getTime() <= Date.now()) {
    inv.status = 'EXPIRED';
  }
  return inv;
}

/**
 * Updates the status of an in-memory invitation record.
 */
export function updateServerInvitationStatus(
  token: string,
  newStatus: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED'
): boolean {
  const inv = serverInvitationStore.get(token);
  if (!inv) return false;
  inv.status = newStatus;
  return true;
}

/**
 * Clears the server in-memory invitation store (primarily for unit tests).
 */
export function clearServerInvitations(): void {
  serverInvitationStore.clear();
}
