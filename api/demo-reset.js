const { verifyApiKey } = require('../lib/auth');
const { store } = require('../lib/redis');

async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).end();
  }
  if (!verifyApiKey(req)) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  const ids = await store.smembers('encounters:active');
  if (ids.length) {
    const keys = ids.map((id) => `encounter:${id}`);
    await store.del(...keys);
  }
  await store.del('encounters:active');
  await store.publish('demo:reset', '{}');

  console.log(`[${new Date().toISOString()}] Demo reset — cleared ${ids.length} encounter(s)`);
  return res.status(200).json({ ok: true, cleared: ids.length });
}

module.exports = handler;
