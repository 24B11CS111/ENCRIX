import '@testing-library/jest-dom/vitest';
import { randomBytes } from 'node:crypto';

process.env.OTP_SERVER_SECRET = randomBytes(32).toString('hex');
process.env.SESSION_SERVER_SECRET = randomBytes(32).toString('hex');
