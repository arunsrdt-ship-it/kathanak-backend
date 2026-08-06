const { Redis } = require('@upstash/redis');

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

module.exports = { getRedis };
