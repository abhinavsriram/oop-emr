const { z } = require('zod');
const { verifyApiKey } = require('../lib/auth');

const triggerCallSchema = z.object({
  phone_number: z.string().min(1),
});

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyApiKey(req)) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  const parsed = triggerCallSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid payload',
      issues: parsed.error.issues,
    });
  }
  const { phone_number } = parsed.data;

  // TODO: wire up the outbound call pipeline (Twilio / Vapi / Retell / custom).
  // This endpoint currently acknowledges the request and logs it — no call is actually placed yet.
  console.log(`[${new Date().toISOString()}] trigger-call → ${phone_number}`);

  return res.status(202).json({
    ok: true,
    phone_number,
    status: 'queued',
    note: 'call pipeline not yet wired up',
  });
}

module.exports = handler;
