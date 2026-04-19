const { verifyApiKey } = require('../../../lib/auth');
const { store } = require('../../../lib/redis');

// Vercel's default body limit on Hobby is 4.5 MB — reject slightly under that
// so the caller gets a clean JSON error instead of a platform-level 413.
const MAX_BYTES = 4 * 1024 * 1024;

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body && req.body.type === 'Buffer' && Array.isArray(req.body.data)) {
    return Buffer.from(req.body.data);
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyApiKey(req)) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  const id = (req.query && req.query.id) || (req.params && req.params.id);
  if (!id) return res.status(400).json({ error: 'id is required' });

  const mime = (req.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
  if (!mime.startsWith('image/')) {
    return res.status(415).json({
      error: 'Content-Type must be image/* (e.g. image/png, image/jpeg)',
    });
  }

  const buf = await readBody(req);
  if (!buf || buf.length === 0) {
    return res.status(400).json({ error: 'Empty body' });
  }
  if (buf.length > MAX_BYTES) {
    return res.status(413).json({
      error: 'Image too large',
      size_bytes: buf.length,
      max_bytes: MAX_BYTES,
    });
  }

  const dataUri = `data:${mime};base64,${buf.toString('base64')}`;

  const key = `encounter:${id}`;
  const raw = await store.get(key);
  if (!raw) return res.status(404).json({ error: 'encounter not found' });
  const existing = JSON.parse(raw);
  const merged = {
    ...existing,
    images: [...(Array.isArray(existing.images) ? existing.images : []), dataUri],
  };
  await store.set(key, JSON.stringify(merged));

  const receivedAt = new Date().toISOString();
  await store.publish(
    'encounter:events',
    JSON.stringify({
      payload: {
        encounter_id: id,
        timestamp: receivedAt,
        event_type: 'update',
        patient: existing.patient,
        images: [dataUri],
      },
      receivedAt,
    })
  );

  console.log(`[${receivedAt}] +1 image (${mime}, ${buf.length}B) for ${id}`);
  return res.status(200).json({
    ok: true,
    encounter_id: id,
    added: 1,
    total_images: merged.images.length,
    size_bytes: buf.length,
    mime,
  });
}

module.exports = handler;
