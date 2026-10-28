import '@testing-library/jest-dom/vitest';
import { randomBytes } from 'node:crypto';

process.env.OTP_SERVER_SECRET = randomBytes(32).toString('hex');
process.env.SESSION_SERVER_SECRET = randomBytes(32).toString('hex');

// Ensure client-side import.meta.env does not leak server-only secrets in Vitest
delete (import.meta.env as any).SUPABASE_SERVICE_ROLE_KEY;
delete (import.meta.env as any).TWILIO_AUTH_TOKEN;
delete (import.meta.env as any).TWILIO_ACCOUNT_SID;
delete (import.meta.env as any).SUPABASE_SERVICE_KEY;

// Prevent background WebSocket connections during tests in Node 22+ / jsdom environments
if (typeof globalThis.WebSocket !== 'undefined') {
  class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readyState = 3;
    url: string;
    onopen: any = null;
    onclose: any = null;
    onerror: any = null;
    onmessage: any = null;
    constructor(url: string) {
      this.url = url;
    }
    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return true;
    }
  }
  (globalThis as any).WebSocket = MockWebSocket;
}
