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
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

console.log('--- Realtime Cross-Client Delivery Verification on Staging ---');
console.log('Target URL:', stagingUrl);

if (!stagingUrl.includes('vhqqczgomrznisvbhpvf')) {
  console.error('SAFETY STOP: Not targeting staging project!');
  process.exit(1);
}

const listenerClient = createClient(stagingUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const senderClient = createClient(stagingUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const testOrgId = '33333333-3333-4333-8333-333333333333';
const testOwnerId = '33333333-3333-4333-8333-333333333331';
const testLeadId = '33333333-3333-4333-8333-333333333332';

async function verifyRealtimeCrossClient() {
  // Ensure test org exists
  await senderClient.from('organizations').upsert([
    { id: testOrgId, name: 'Realtime Smoke Org', slug: 'realtime-smoke-org', owner_id: testOwnerId }
  ]);
  await senderClient.from('profiles').upsert([
    { id: testOwnerId, user_id: testOwnerId, organization_id: testOrgId, full_name: 'Realtime Owner', role: 'OWNER', status: 'ACTIVE' }
  ]);

  const receivedEvents = [];

  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for Realtime events. Received: ${receivedEvents.length}`));
    }, 15000);

    const channel = listenerClient.channel('staging_realtime_lead_verify');

    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
        const id = payload.new?.id || payload.old?.id;
        console.log(`  [Realtime Event Received] Type=${payload.eventType}, ID=${id}`);
        if (id === testLeadId) {
          receivedEvents.push(payload);
          if (receivedEvents.length >= 2) {
            clearTimeout(timeout);
            channel.unsubscribe();
            resolve(receivedEvents);
          }
        }
      })
      .subscribe(async (status, err) => {
        console.log('  Subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('  Channel is SUBSCRIBED. Waiting 1.5s for subscription sync...');

          await new Promise(r => setTimeout(r, 1500));
          console.log('  Triggering cross-client mutations...');

          // Trigger 1: INSERT
          const { error: insErr } = await senderClient.from('leads').insert({
            id: testLeadId,
            organization_id: testOrgId,
            lead_code: 'RT-001',
            name: 'Realtime Test Prospect',
            phone: '+919888877777',
            source: 'Website',
            status: 'NEW',
            priority: 'HIGH'
          });
          if (insErr) console.error('  Insert error:', insErr.message);
          else console.log('  Client 2 inserted test lead into leads table.');

          // Delay then Trigger 2: UPDATE
          setTimeout(async () => {
            const { error: upErr } = await senderClient.from('leads').update({
              status: 'CONTACTED',
              updated_at: new Date().toISOString()
            }).eq('id', testLeadId);
            if (upErr) console.error('  Update error:', upErr.message);
            else console.log('  Client 2 updated test lead status.');
          }, 2000);
        } else if (status === 'CHANNEL_ERROR') {
          clearTimeout(timeout);
          reject(new Error(`Channel subscription error: ${err?.message || 'unknown'}`));
        }
      });
  });

  try {
    const events = await promise;
    console.log(`\nSUCCESS: Received ${events.length} cross-client Realtime events over the wire!`);
    console.log('  Event 1:', events[0].eventType, 'status:', events[0].new?.status);
    console.log('  Event 2:', events[1].eventType, 'status:', events[1].new?.status);
  } finally {
    // Cleanup
    console.log('\nCleaning up Realtime test records...');
    await senderClient.from('leads').delete().eq('id', testLeadId);
    await senderClient.from('profiles').delete().eq('id', testOwnerId);
    await senderClient.from('organizations').delete().eq('id', testOrgId);
    console.log('Cleanup finished.');
  }
}

verifyRealtimeCrossClient().catch(err => {
  console.error('Realtime cross-client verification failed:', err.message);
  process.exit(1);
});
