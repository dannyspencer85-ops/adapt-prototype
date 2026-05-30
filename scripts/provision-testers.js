#!/usr/bin/env node
// Provisions tester accounts in Supabase via the Auth Admin API.
// Run once: SUPABASE_SERVICE_KEY=<key> node scripts/provision-testers.js

const SUPABASE_URL = 'https://lykorfkapbxufkjcqtnl.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_KEY env var.');
  console.error('Usage: SUPABASE_SERVICE_KEY=<your-service-role-key> node scripts/provision-testers.js');
  process.exit(1);
}

const TESTERS = [
  { name: 'Bridget', email: 'bridget@adapt-test.app' },
  { name: 'Jane',    email: 'jane@adapt-test.app'    },
  { name: 'Connor',  email: 'connor@adapt-test.app'  },
  { name: 'Luke',    email: 'luke@adapt-test.app'    },
  { name: 'Gabe',    email: 'gabe@adapt-test.app'    },
];

const SHARED_PASSWORD = 'AdaptBeta2026!';

async function createUser(tester) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey':        SERVICE_KEY,
    },
    body: JSON.stringify({
      email:             tester.email,
      password:          SHARED_PASSWORD,
      email_confirm:     true,          // skip confirmation email
      user_metadata:     { name: tester.name },
    }),
  });

  const body = await res.json();

  if (!res.ok) {
    // 422 = user already exists — treat as success
    if (res.status === 422 && body.msg && body.msg.toLowerCase().includes('already')) {
      console.log(`  ✓ ${tester.name} (${tester.email}) — already exists, skipped`);
      return;
    }
    console.error(`  ✗ ${tester.name} (${tester.email}) — ${res.status}: ${JSON.stringify(body)}`);
    return;
  }

  console.log(`  ✓ ${tester.name} (${tester.email}) — created (id: ${body.id})`);
}

(async () => {
  console.log(`Provisioning ${TESTERS.length} tester accounts on ${SUPABASE_URL}...\n`);
  for (const t of TESTERS) await createUser(t);
  console.log('\nDone. Credentials for TESTING.md:');
  console.log(`  Password (shared): ${SHARED_PASSWORD}`);
  TESTERS.forEach(t => console.log(`  ${t.name.padEnd(10)} ${t.email}`));
})();
