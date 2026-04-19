const { payloadSchema } = require('../lib/schema');
const { mergePayload } = require('../lib/merge');
const { verifyApiKey } = require('../lib/auth');
const { store } = require('../lib/redis');

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyApiKey(req)) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid payload',
      issues: parsed.error.issues,
    });
  }
  const p = parsed.data;
  const key = `encounter:${p.encounter_id}`;

  let merged;
  if (p.event_type === 'initial') {
    merged = p;
  } else {
    const raw = await store.get(key);
    const existing = raw ? JSON.parse(raw) : null;
    merged = existing ? mergePayload(existing, p) : p;
  }

  await store.set(key, JSON.stringify(merged));
  await store.sadd('encounters:active', p.encounter_id);

  const receivedAt = new Date().toISOString();
  await store.publish(
    'encounter:events',
    JSON.stringify({ payload: p, receivedAt })
  );

  console.log(`[${receivedAt}] ${p.event_type} for ${p.encounter_id}`);
  return res.status(200).json({
    ok: true,
    encounter_id: p.encounter_id,
    receivedAt,
  });
}

module.exports = handler;
