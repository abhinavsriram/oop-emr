const initial = require('../fixtures/initial.json');
const update = require('../fixtures/update.json');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.API_KEY;
const GAP_MS = Number(process.env.GAP_MS || 5000);

async function post(body) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  const r = await fetch(`${BASE_URL}/api/encounter`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let parsed = null;
  try { parsed = await r.json(); } catch (_) {}
  return { status: r.status, body: parsed };
}

(async () => {
  console.log(`target: ${BASE_URL}`);
  console.log(`auth:   ${API_KEY ? 'x-api-key set' : 'no auth header'}`);
  console.log(`gap:    ${GAP_MS}ms\n`);

  console.log('→ POST /api/encounter  (initial)');
  const r1 = await post(initial);
  console.log(`  ${r1.status}`, r1.body);

  console.log(`\n… waiting ${GAP_MS}ms`);
  await new Promise((r) => setTimeout(r, GAP_MS));

  console.log('\n→ POST /api/encounter  (update)');
  const r2 = await post(update);
  console.log(`  ${r2.status}`, r2.body);

  if (r1.status !== 200 || r2.status !== 200) process.exit(1);
})().catch((err) => {
  console.error('demo failed:', err.message || err);
  process.exit(1);
});
