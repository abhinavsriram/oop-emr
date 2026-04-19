const EventEmitter = require('events');

const USE_UPSTASH = !!(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

if (!USE_UPSTASH && process.env.NODE_ENV === 'production') {
  console.warn(
    '[redis] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — ' +
    'using in-memory store. State will NOT survive across serverless invocations.'
  );
}

// In-memory backend (local dev / fallback)
const memStore = new Map();
const memSets = new Map();
const memBus = new EventEmitter();
memBus.setMaxListeners(0);

const memoryBackend = {
  async get(key) {
    return memStore.has(key) ? memStore.get(key) : null;
  },
  async set(key, value) {
    memStore.set(key, value);
    return 'OK';
  },
  async del(...keys) {
    let n = 0;
    for (const k of keys) if (memStore.delete(k)) n++;
    return n;
  },
  async sadd(key, member) {
    if (!memSets.has(key)) memSets.set(key, new Set());
    memSets.get(key).add(member);
    return 1;
  },
  async smembers(key) {
    return Array.from(memSets.get(key) || []);
  },
  async publish(channel, message) {
    memBus.emit(channel, message);
    return 1;
  },
  subscribe(channels, onMessage) {
    const handlers = channels.map((ch) => {
      const h = (msg) => onMessage(ch, msg);
      memBus.on(ch, h);
      return [ch, h];
    });
    return async () => {
      for (const [ch, h] of handlers) memBus.off(ch, h);
    };
  },
};

// Upstash REST backend (production)
let restClient = null;
function getRest() {
  if (!restClient) {
    const { Redis } = require('@upstash/redis');
    restClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
      automaticDeserialization: false,
    });
  }
  return restClient;
}

const upstashBackend = {
  async get(key) {
    const v = await getRest().get(key);
    return v == null ? null : v;
  },
  async set(key, value) {
    return getRest().set(key, value);
  },
  async del(...keys) {
    if (!keys.length) return 0;
    return getRest().del(...keys);
  },
  async sadd(key, member) {
    return getRest().sadd(key, member);
  },
  async smembers(key) {
    return getRest().smembers(key);
  },
  async publish(channel, message) {
    return getRest().publish(channel, message);
  },
  subscribe(channels, onMessage) {
    const IORedis = require('ioredis');
    const url = process.env.UPSTASH_REDIS_URL;
    if (!url) {
      throw new Error(
        'UPSTASH_REDIS_URL (TCP connection string) is required for SSE subscriptions'
      );
    }
    const sub = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: null });
    sub.subscribe(...channels).catch((err) => {
      console.error('[redis] subscribe error:', err);
    });
    sub.on('message', onMessage);
    sub.on('error', (err) => console.error('[redis] subscriber error:', err));
    return async () => {
      try { await sub.quit(); } catch (_) {}
    };
  },
};

module.exports = {
  store: USE_UPSTASH ? upstashBackend : memoryBackend,
  isUpstash: USE_UPSTASH,
};
