const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const logger = require('../utils/logger');
const metaService = require('../services/meta.service');

// Test Meta API configuration
router.get('/test-meta', async (req, res) => {
  try {
    const configStatus = metaService.getConfigStatus();
    res.json({
      success: true,
      config: configStatus,
      envVars: {
        META_PAGE_ACCESS_TOKEN: process.env.META_PAGE_ACCESS_TOKEN ? `${process.env.META_PAGE_ACCESS_TOKEN.substring(0, 20)}...` : 'NOT SET',
        META_PAGE_ID: process.env.META_PAGE_ID || 'NOT SET',
        META_IG_USER_ID: process.env.META_IG_USER_ID || 'NOT SET'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/test-openai', async (req, res) => {
  try {
    logger.info('Testing OpenAI connection...');
    logger.info('API Key present:', !!process.env.OPENAI_API_KEY);
    logger.info('API Key starts with:', process.env.OPENAI_API_KEY?.substring(0, 10));
    logger.info('Node version:', process.version);
    logger.info('Vercel environment:', process.env.VERCEL);

    // Test basic fetch first
    try {
      const fetchTest = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        }
      });
      logger.info('Direct fetch status:', fetchTest.status);
    } catch (fetchError) {
      logger.error('Direct fetch failed:', fetchError);
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      dangerouslyAllowBrowser: false
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say "test successful"' }],
      max_tokens: 10
    });

    res.json({
      success: true,
      message: 'OpenAI connection works!',
      response: response.choices[0].message.content
    });
  } catch (error) {
    logger.error('Test OpenAI error:', {
      name: error.name,
      message: error.message,
      code: error.code,
      type: error.type,
      cause: error.cause,
      stack: error.stack?.split('\n').slice(0, 3)
    });

    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
      type: error.type,
      name: error.name,
      cause: error.cause?.message || error.cause
    });
  }
});

module.exports = router;
