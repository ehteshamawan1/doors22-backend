const OpenAI = require('openai');
const logger = require('../utils/logger');

/**
 * Initialize OpenAI client
 */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

logger.info('✅ OpenAI configured');

module.exports = openai;
