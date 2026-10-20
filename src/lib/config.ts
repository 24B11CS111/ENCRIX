/**
 * LEADVAULT CRM - System Configuration & Environment Flags
 */

const processEnvironment = (
  globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
).process?.env;
const runtimeEnvironment = import.meta.env ?? processEnvironment ?? {};

// If true, enables offline enterprise demo sandbox with pre-loaded profiles and persona switcher.
// In production, this flag MUST be false (VITE_ENABLE_DEMO_SANDBOX=false).
export const IS_DEMO_MODE: boolean = runtimeEnvironment.VITE_ENABLE_DEMO_SANDBOX === 'true';

// Telephony Gateway Configuration
export const TELEPHONY_PROVIDER: string = runtimeEnvironment.VITE_TELEPHONY_PROVIDER || 'mock';

// Enforce maximum batch size for imports to prevent DoS / memory exhaustion
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
