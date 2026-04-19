const fs = require('fs');
const path = require('path');
const initial = require('../fixtures/initial.json');
const update = require('../fixtures/update.json');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.API_KEY;
const GAP_MS = Number(process.env.GAP_MS || 5000);
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

async function postJson(body) {
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

async function postImage(encounterId, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return { status: 415, body: { error: `unsupported ext: ${ext}` } };
  const bytes = fs.readFileSync(filePath);
  const headers = { 'Content-Type': mime };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  const r = await fetch(`${BASE_URL}/api/encounter/${encodeURIComponent(encounterId)}/image`, {
    method: 'POST',
    headers,
    body: bytes,
  });
  let parsed = null;
  try { parsed = await r.json(); } catch (_) {}
  return { status: r.status, body: parsed, bytes: bytes.length, mime };
}

function listSamples() {
  if (!fs.existsSync(SAMPLES_DIR)) return [];
  return fs.readdirSync(SAMPLES_DIR)
    .filter((f) => MIME_BY_EXT[path.extname(f).toLowerCase()])
    .map((f) => path.join(SAMPLES_DIR, f));
}

(async () => {
  console.log(`target: ${BASE_URL}`);
  console.log(`auth:   ${API_KEY ? 'x-api-key set' : 'no auth header'}`);
  console.log(`gap:    ${GAP_MS}ms\n`);

  console.log('→ POST /api/encounter  (initial)');
  const r1 = await postJson(initial);
  console.log(`  ${r1.status}`, r1.body);

  console.log(`\n… waiting ${GAP_MS}ms`);
  await new Promise((r) => setTimeout(r, GAP_MS));

  console.log('\n→ POST /api/encounter  (update)');
  const r2 = await postJson(update);
  console.log(`  ${r2.status}`, r2.body);
  if (r1.status !== 200 || r2.status !== 200) process.exit(1);

  const samples = listSamples();
  if (samples.length === 0) {
    console.log('\n(no files in samples/ — skipping image upload)');
    return;
  }
  console.log(`\nuploading ${samples.length} image(s) from samples/ as raw bytes:`);
  for (const file of samples) {
    process.stdout.write(`  ${path.basename(file)}  →  `);
    const r = await postImage(update.encounter_id, file);
    console.log(`${r.status}`, r.body || '');
    if (r.status !== 200) process.exitCode = 1;
  }
})().catch((err) => {
  console.error('demo failed:', err.message || err);
  process.exit(1);
});
