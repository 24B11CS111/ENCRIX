/**
 * LEADVAULT CRM - System Configuration & Environment Flags
 */

// If true, enables offline enterprise demo sandbox with pre-loaded profiles and persona switcher.
// In production, this flag MUST be false (VITE_ENABLE_DEMO_SANDBOX=false).
export const IS_DEMO_MODE: boolean = import.meta.env.VITE_ENABLE_DEMO_SANDBOX === 'true';

// Telephony Gateway Configuration
export const TELEPHONY_PROVIDER: string = import.meta.env.VITE_TELEPHONY_PROVIDER || 'mock';

// Enforce maximum batch size for imports to prevent DoS / memory exhaustion
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
