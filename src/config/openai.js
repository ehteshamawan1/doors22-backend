const OpenAI = require('openai');
const logger = require('../utils/logger');

/**
 * Initialize OpenAI client with extended timeout for serverless
 */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000, // 60 seconds timeout
  maxRetries: 2 // Retry twice on failure
});

logger.info('✅ OpenAI configured with 60s timeout');

module.exports = openai;
