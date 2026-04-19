const { store } = require('../../lib/redis');

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  const id = (req.query && req.query.id) || (req.params && req.params.id);
  if (!id) return res.status(400).json({ error: 'id is required' });

  const raw = await store.get(`encounter:${id}`);
  if (!raw) return res.status(404).json({ error: 'not found' });

  return res.status(200).json(JSON.parse(raw));
}

module.exports = handler;
