const { store } = require('../lib/redis');

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  res.write('retry: 2000\n\n');
  res.write(': connected\n\n');

  const unsubscribe = store.subscribe(
    ['encounter:events', 'demo:reset'],
    (channel, message) => {
      const eventName = channel === 'demo:reset' ? 'demo_reset' : 'encounter_event';
      try {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${message}\n\n`);
      } catch (err) {
        console.error('[events] write error:', err);
      }
    }
  );

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 20000);

  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try { await unsubscribe(); } catch (_) {}
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

module.exports = handler;
module.exports.config = { maxDuration: 300 };
