import { afterEach, describe, expect, it } from 'vitest';
import { getRequiredServerSecret } from '../../api/_lib/serverSecret';

describe('server secret configuration', () => {
  const originalOtpSecret = process.env.OTP_SERVER_SECRET;
  const originalSessionSecret = process.env.SESSION_SERVER_SECRET;

  afterEach(() => {
    if (originalOtpSecret === undefined) {
      delete process.env.OTP_SERVER_SECRET;
    } else {
      process.env.OTP_SERVER_SECRET = originalOtpSecret;
    }

    if (originalSessionSecret === undefined) {
      delete process.env.SESSION_SERVER_SECRET;
    } else {
      process.env.SESSION_SERVER_SECRET = originalSessionSecret;
    }
  });

  it.each(['OTP_SERVER_SECRET', 'SESSION_SERVER_SECRET'] as const)(
    'rejects missing, short, and placeholder values for %s without exposing them',
    (name) => {
      for (const invalidValue of [
        undefined,
        'too-short',
        'your-cryptographic-server-secret-placeholder',
      ]) {
        if (invalidValue === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = invalidValue;
        }

        expect(() => getRequiredServerSecret(name)).toThrowError(
          `${name} is missing or invalid`
        );
      }
    }
  );

  it.each(['OTP_SERVER_SECRET', 'SESSION_SERVER_SECRET'] as const)(
    'accepts a configured high-entropy value for %s',
    (name) => {
      const configuredSecret = 'a'.repeat(64);
      process.env[name] = configuredSecret;

      expect(getRequiredServerSecret(name)).toBe(configuredSecret);
    }
  );
});
