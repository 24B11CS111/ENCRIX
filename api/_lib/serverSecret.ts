type ServerSecretName = 'OTP_SERVER_SECRET' | 'SESSION_SERVER_SECRET';

const MINIMUM_SECRET_BYTES = 32;
const PLACEHOLDER_PATTERN =
  /(?:placeholder|your[-_ ]|change[-_ ]?me|replace[-_ ]?me|example|sample|dummy|default|(?:^|[-_ ])(?:test|mock|demo)(?:$|[-_ ]))/i;

export function getRequiredServerSecret(name: ServerSecretName): string {
  const value = process.env[name];

  if (
    !value ||
    value.trim() !== value ||
    Buffer.byteLength(value, 'utf8') < MINIMUM_SECRET_BYTES ||
    PLACEHOLDER_PATTERN.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }

  return value;
}
