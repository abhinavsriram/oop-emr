const { z } = require('zod');
const { verifyApiKey } = require('../../../lib/auth');
const { store } = require('../../../lib/redis');

const batchSchema = z.object({
  images: z.array(z.string().min(1)).min(1),
});

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

  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid payload',
      issues: parsed.error.issues,
    });
  }
  const { images: newImages } = parsed.data;

  const key = `encounter:${id}`;
  const raw = await store.get(key);
  if (!raw) return res.status(404).json({ error: 'encounter not found' });

  const existing = JSON.parse(raw);
  const merged = {
    ...existing,
    images: [...(Array.isArray(existing.images) ? existing.images : []), ...newImages],
  };
  await store.set(key, JSON.stringify(merged));

  const receivedAt = new Date().toISOString();
  const syntheticDelta = {
    encounter_id: id,
    timestamp: receivedAt,
    event_type: 'update',
    patient: existing.patient,
    images: newImages,
  };
  await store.publish(
    'encounter:events',
    JSON.stringify({ payload: syntheticDelta, receivedAt })
  );

  console.log(`[${receivedAt}] +${newImages.length} image(s) for ${id}`);
  return res.status(200).json({
    ok: true,
    encounter_id: id,
    added: newImages.length,
    total_images: merged.images.length,
  });
}

module.exports = handler;
