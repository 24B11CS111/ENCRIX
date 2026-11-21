import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptOrganizationTwilioCredentials,
  encryptOrganizationTwilioCredentials,
  validateOrganizationTwilioCredentials,
} from '../../api/_lib/twilioCredentials';

const organizationId = '5ed8c7cb-63ab-4c78-848a-cd754f5716e3';
const otherOrganizationId = '75d7d7d0-baf7-448a-bfd9-e601ca072df9';
const credentials = {
  accountSid: `AC${'a'.repeat(32)}`,
  authToken: 'b'.repeat(32),
  phoneNumber: '+14155552671',
};
const keyOne = Buffer.alloc(32, 1).toString('base64');
const keyTwo = Buffer.alloc(32, 2).toString('base64');

describe('organization Twilio credential encryption', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('validates Account SID, Auth Token and E.164 account number formats', () => {
    expect(validateOrganizationTwilioCredentials(credentials)).toBe(true);
    expect(validateOrganizationTwilioCredentials({ ...credentials, accountSid: 'ACbad' })).toBe(false);
    expect(validateOrganizationTwilioCredentials({ ...credentials, authToken: 'short' })).toBe(false);
    expect(validateOrganizationTwilioCredentials({ ...credentials, phoneNumber: '4155552671' })).toBe(false);
  });

  it('encrypts at rest and decrypts only with the matching organization binding', () => {
    vi.stubEnv('TWILIO_CREDENTIAL_ENCRYPTION_KEYS', JSON.stringify({ v1: keyOne }));
    vi.stubEnv('TWILIO_CREDENTIALS_ACTIVE_KEY_ID', 'v1');
    const encrypted = encryptOrganizationTwilioCredentials(organizationId, credentials);

    expect(JSON.stringify(encrypted)).not.toContain(credentials.accountSid);
    expect(JSON.stringify(encrypted)).not.toContain(credentials.authToken);
    expect(decryptOrganizationTwilioCredentials(organizationId, encrypted)).toEqual(credentials);
    expect(() => decryptOrganizationTwilioCredentials(otherOrganizationId, encrypted)).toThrow('twilio_credential_decryption_failed');
  });

  it('supports encryption-key rotation while retaining old keys for decryption', () => {
    vi.stubEnv('TWILIO_CREDENTIAL_ENCRYPTION_KEYS', JSON.stringify({ v1: keyOne }));
    vi.stubEnv('TWILIO_CREDENTIALS_ACTIVE_KEY_ID', 'v1');
    const oldCiphertext = encryptOrganizationTwilioCredentials(organizationId, credentials);

    vi.stubEnv('TWILIO_CREDENTIAL_ENCRYPTION_KEYS', JSON.stringify({ v1: keyOne, v2: keyTwo }));
    vi.stubEnv('TWILIO_CREDENTIALS_ACTIVE_KEY_ID', 'v2');
    expect(decryptOrganizationTwilioCredentials(organizationId, oldCiphertext)).toEqual(credentials);
    const rotated = encryptOrganizationTwilioCredentials(organizationId, credentials);
    expect(rotated.key_id).toBe('v2');
    expect(decryptOrganizationTwilioCredentials(organizationId, rotated)).toEqual(credentials);
  });

  it('fails closed when the active key is unavailable or the ciphertext is tampered', () => {
    vi.stubEnv('TWILIO_CREDENTIAL_ENCRYPTION_KEYS', JSON.stringify({ v1: keyOne }));
    vi.stubEnv('TWILIO_CREDENTIALS_ACTIVE_KEY_ID', 'v1');
    const encrypted = encryptOrganizationTwilioCredentials(organizationId, credentials);
    vi.stubEnv('TWILIO_CREDENTIALS_ACTIVE_KEY_ID', 'unknown');
    expect(() => encryptOrganizationTwilioCredentials(organizationId, credentials)).toThrow('twilio_credential_encryption_unavailable');

    vi.stubEnv('TWILIO_CREDENTIALS_ACTIVE_KEY_ID', 'v1');
    expect(() => decryptOrganizationTwilioCredentials(organizationId, {
      ...encrypted,
      ciphertext: Buffer.from('tampered').toString('base64'),
    })).toThrow('twilio_credential_decryption_failed');
  });
});
