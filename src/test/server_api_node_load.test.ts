import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const loaderPath = resolve(projectRoot, 'src/test/support/node_ts_loader.mjs');

describe('server API module loading in native Node.js', () => {
  it('loads API modules that depend on db without Vite import.meta.env or browser Supabase initialization', () => {
    const routes = [
      './api/auth/invite.ts',
      './api/auth/phone-enrollment.ts',
      './api/auth/send-otp.ts',
      './api/auth/session.ts',
      './api/auth/verify-otp.ts',
      './api/cron/follow-up-reminders.ts',
      './api/leads.ts',
      './api/billing.ts',
      './api/telephony/call.ts',
      './api/telephony/recording.ts',
      './api/telephony/voice.ts',
      './api/telephony/webhook.ts',
    ];
    const source = `await Promise.all(${JSON.stringify(routes)}.map((route) => import(route)));`;
    const childEnv = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_'))
    );
    const result = spawnSync(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', '--experimental-loader', pathToFileURL(loaderPath).href, '--input-type=module', '-e', source],
      { cwd: projectRoot, env: childEnv, encoding: 'utf8' }
    );

    expect(result.status, result.stderr).toBe(0);
  });
});
