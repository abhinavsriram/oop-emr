function verifyApiKey(req) {
  const expected = process.env.API_KEY;
  if (!expected) return true;
  const provided = req.headers['x-api-key'];
  return provided === expected;
}

module.exports = { verifyApiKey };
