import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env.staging', 'utf8');
const env = {};
for (const line of envContent.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}

const stagingUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
const anonClient = createClient(stagingUrl, anonKey);

console.log('--- Checking RLS Protection on Staging Tables ---');
const tables = [
  'organizations',
  'profiles',
  'leads',
  'calls',
  'follow_ups',
  'notifications',
  'organization_invitations',
  'call_recordings',
  'email_otps',
  'caller_phone_enrollments'
];

for (const t of tables) {
  const { data, error } = await anonClient.from(t).select('*');
  if (error) {
    console.log(`  RLS BLOCKS anonymous access to ${t}: [ERROR: ${error.message}]`);
  } else if (!data || data.length === 0) {
    console.log(`  RLS BLOCKS anonymous access to ${t}: [0 rows returned]`);
  } else {
    console.error(`  RLS LEAK! Anonymous user read ${data.length} rows from ${t}!`);
  }
}
