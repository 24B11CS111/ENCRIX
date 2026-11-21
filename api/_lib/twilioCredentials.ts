import crypto from 'node:crypto';

export interface OrganizationTwilioCredentials {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

export interface EncryptedTwilioCredentials {
  key_id: string;
  nonce: string;
  ciphertext: string;
  auth_tag: string;
}

const ACCOUNT_SID_PATTERN = /^AC[0-9a-f]{32}$/i;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function validateOrganizationTwilioCredentials(
  value: unknown,
): value is OrganizationTwilioCredentials {
  if (!value || typeof value !== 'object') return false;
  const credentials = value as Record<string, unknown>;
  return typeof credentials.accountSid === 'string'
    && ACCOUNT_SID_PATTERN.test(credentials.accountSid.trim())
    && typeof credentials.authToken === 'string'
    && credentials.authToken.length >= 32
    && credentials.authToken.length <= 256
    && !/\s/.test(credentials.authToken)
    && typeof credentials.phoneNumber === 'string'
    && E164_PATTERN.test(credentials.phoneNumber.trim());
}

function getKeyring(): { activeKeyId: string; keys: Map<string, Buffer> } {
  const activeKeyId = process.env.TWILIO_CREDENTIALS_ACTIVE_KEY_ID || '';
  const rawKeyring = process.env.TWILIO_CREDENTIAL_ENCRYPTION_KEYS || '';
  if (!activeKeyId || !rawKeyring) throw new Error('twilio_credential_encryption_unavailable');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawKeyring);
  } catch {
    throw new Error('twilio_credential_encryption_unavailable');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('twilio_credential_encryption_unavailable');
  }

  const keys = new Map<string, Buffer>();
  for (const [keyId, encodedKey] of Object.entries(parsed)) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(keyId) || typeof encodedKey !== 'string') {
      throw new Error('twilio_credential_encryption_unavailable');
    }
    const decoded = Buffer.from(encodedKey, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== encodedKey) {
      throw new Error('twilio_credential_encryption_unavailable');
    }
    keys.set(keyId, decoded);
  }
  if (!keys.has(activeKeyId)) throw new Error('twilio_credential_encryption_unavailable');
  return { activeKeyId, keys };
}

function credentialAad(organizationId: string): Buffer {
  return Buffer.from(`encrix:organization-twilio-credentials:${organizationId}`, 'utf8');
}

export function encryptOrganizationTwilioCredentials(
  organizationId: string,
  credentials: OrganizationTwilioCredentials,
): EncryptedTwilioCredentials {
  if (!validateOrganizationTwilioCredentials(credentials)) {
    throw new Error('invalid_twilio_credentials');
  }
  const { activeKeyId, keys } = getKeyring();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keys.get(activeKeyId)!, nonce);
  cipher.setAAD(credentialAad(organizationId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({
      accountSid: credentials.accountSid.trim(),
      authToken: credentials.authToken,
      phoneNumber: credentials.phoneNumber.trim(),
    }), 'utf8'),
    cipher.final(),
  ]);
  return {
    key_id: activeKeyId,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptOrganizationTwilioCredentials(
  organizationId: string,
  encrypted: EncryptedTwilioCredentials,
): OrganizationTwilioCredentials {
  const { keys } = getKeyring();
  const key = keys.get(encrypted.key_id);
  const nonce = Buffer.from(encrypted.nonce || '', 'base64');
  const ciphertext = Buffer.from(encrypted.ciphertext || '', 'base64');
  const authTag = Buffer.from(encrypted.auth_tag || '', 'base64');
  if (!key || nonce.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error('twilio_credential_decryption_failed');
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(credentialAad(organizationId));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const credentials: unknown = JSON.parse(plaintext);
    if (!validateOrganizationTwilioCredentials(credentials)) {
      throw new Error('twilio_credential_decryption_failed');
    }
    return credentials;
  } catch {
    throw new Error('twilio_credential_decryption_failed');
  }
}

export function maskTwilioPhoneNumber(phoneNumber: string): string {
  const lastFour = phoneNumber.slice(-4);
  return `••••${lastFour}`;
}
