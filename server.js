/*
 * Athena EMR — local dev server
 *
 * Mounts the same handlers that Vercel executes as serverless functions,
 * so `node server.js` behaves identically to a Vercel deployment.
 *
 * Start:
 *   npm run dev
 *
 * Replay the bundled fixtures in another tab:
 *   npm run demo
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const encounterHandler = require('./api/encounter');
const encounterByIdHandler = require('./api/encounter/[id]');
const eventsHandler = require('./api/events');
const demoResetHandler = require('./api/demo-reset');
const healthHandler = require('./api/health');
const triggerCallHandler = require('./api/trigger-call');
const { isUpstash } = require('./lib/redis');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.all('/api/health', healthHandler);
app.all('/api/encounter', encounterHandler);
app.all('/api/encounter/:id', (req, res) => {
  req.query = req.query || {};
  req.query.id = req.params.id;
  return encounterByIdHandler(req, res);
});
app.all('/api/events', eventsHandler);
app.all('/api/demo-reset', demoResetHandler);
app.all('/api/trigger-call', triggerCallHandler);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log(`  Athena EMR  →  http://localhost:${PORT}`);
  console.log(`  storage     →  ${isUpstash ? 'Upstash Redis' : 'in-memory (local dev)'}`);
  console.log(`  write auth  →  ${process.env.API_KEY ? 'required (x-api-key)' : 'disabled (dev)'}`);
  console.log('');
});
