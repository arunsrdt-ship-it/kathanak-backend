const { Redis } = require('@upstash/redis');
const mongoose = require('mongoose');

let redisClient = null;

const initRedis = () => {
  if (redisClient) return redisClient;
  
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      redisClient = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      console.log('⚡ Redis Caching Enabled');
    } catch (err) {
      console.error('❌ Failed to initialize Redis:', err);
    }
  } else {
    console.warn('⚠️ UPSTASH_REDIS credentials missing. Caching is disabled.');
  }
  return redisClient;
};

const getRedis = () => {
  if (redisClient === null) return initRedis();
  return redisClient;
};

// Isolate cached values by the connected MongoDB host and database. This
// prevents a database switch from serving records cached for the old database.
const getCacheKey = (key) => {
  const host = mongoose.connection.host || 'disconnected';
  const database = mongoose.connection.name || 'default';
  return `db:${host}:${database}:${key}`;
};

// Redis is only an optimization. Cache outages must never prevent MongoDB
// reads or writes from serving the API.
const getCached = async (key) => {
  try {
    const redis = getRedis();
    return redis ? await redis.get(key) : null;
  } catch (err) {
    console.warn('Redis cache read failed; falling back to MongoDB:', err.message);
    return null;
  }
};

const setCached = async (key, value, ttlSeconds) => {
  try {
    const redis = getRedis();
    if (!redis) return;
    if (ttlSeconds) await redis.setex(key, ttlSeconds, value);
    else await redis.set(key, value);
  } catch (err) {
    console.warn('Redis cache write failed:', err.message);
  }
};

const deleteCached = async (...keys) => {
  try {
    const redis = getRedis();
    if (redis && keys.length) await redis.del(...keys);
  } catch (err) {
    console.warn('Redis cache invalidation failed:', err.message);
  }
};

const deleteCachedPattern = async (pattern) => {
  try {
    const redis = getRedis();
    if (!redis) return;
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  } catch (err) {
    console.warn('Redis cache invalidation failed:', err.message);
  }
};

module.exports = {
  getRedis,
  getCacheKey,
  getCached,
  setCached,
  deleteCached,
  deleteCachedPattern,
};
