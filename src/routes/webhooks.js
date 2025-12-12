const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../config/firebase');
const logger = require('../utils/logger');

// Verify tokens for Meta webhook verification
// Instagram uses the existing token, Facebook can use a separate token
const INSTAGRAM_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN || '1H94NdfjrEcAYG895j$v';
const FACEBOOK_VERIFY_TOKEN = process.env.META_FB_WEBHOOK_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || 'doors22_fb_webhook_2024';

/**
 * GET /webhooks/instagram
 * Handles Meta webhook verification for Instagram
 */
router.get('/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  logger.info('Instagram webhook verification attempt', { mode, token: token ? '***' : 'none' });

  if (mode === 'subscribe' && token === INSTAGRAM_VERIFY_TOKEN) {
    logger.info('Instagram webhook verified successfully');
    return res.status(200).send(challenge);
  }

  logger.error('Instagram webhook verification failed');
  return res.sendStatus(403);
});

/**
 * GET /webhooks/facebook
 * Handles Meta webhook verification for Facebook Page
 */
router.get('/facebook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  logger.info('Facebook webhook verification attempt', { mode, token: token ? '***' : 'none' });

  if (mode === 'subscribe' && token === FACEBOOK_VERIFY_TOKEN) {
    logger.info('Facebook webhook verified successfully');
    return res.status(200).send(challenge);
  }

  logger.error('Facebook webhook verification failed');
  return res.sendStatus(403);
});

/**
 * GET /webhooks/meta
 * Unified Meta webhook verification (handles both Instagram and Facebook)
 */
router.get('/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  logger.info('Meta webhook verification attempt', { mode, token: token ? '***' : 'none' });

  // Accept either Instagram or Facebook verify token for unified endpoint
  if (mode === 'subscribe' && (token === INSTAGRAM_VERIFY_TOKEN || token === FACEBOOK_VERIFY_TOKEN)) {
    logger.info('Meta webhook verified successfully');
    return res.status(200).send(challenge);
  }

  logger.error('Meta webhook verification failed');
  return res.sendStatus(403);
});

/**
 * Verify webhook signature from Meta
 */
function verifySignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    logger.warn('META_APP_SECRET not configured, skipping signature verification');
    return true;
  }

  const expectedSignature = 'sha256=' +
    crypto.createHmac('sha256', appSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

  return crypto.timingSafeEquals(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * POST /webhooks/instagram
 * Handles Instagram webhook events (comments, DMs, mentions)
 */
router.post('/instagram', async (req, res) => {
  try {
    const body = req.body;

    logger.info('Instagram webhook event received', { object: body.object });

    if (body.object !== 'instagram') {
      return res.sendStatus(404);
    }

    // Process each entry
    for (const entry of body.entry || []) {
      // Handle changes (comments, mentions)
      if (entry.changes) {
        for (const change of entry.changes) {
          await handleInstagramChange(change);
        }
      }

      // Handle messaging (DMs)
      if (entry.messaging) {
        for (const messaging of entry.messaging) {
          await handleInstagramMessage(messaging);
        }
      }
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    logger.error('Error processing Instagram webhook:', error);
    res.status(200).send('EVENT_RECEIVED'); // Always return 200 to prevent retries
  }
});

/**
 * POST /webhooks/facebook
 * Handles Facebook Page webhook events (comments, messages)
 */
router.post('/facebook', async (req, res) => {
  try {
    const body = req.body;

    logger.info('Facebook webhook event received', { object: body.object });

    if (body.object !== 'page') {
      return res.sendStatus(404);
    }

    // Process each entry
    for (const entry of body.entry || []) {
      // Handle changes (feed, comments)
      if (entry.changes) {
        for (const change of entry.changes) {
          await handleFacebookChange(change);
        }
      }

      // Handle messaging (Messenger)
      if (entry.messaging) {
        for (const messaging of entry.messaging) {
          await handleFacebookMessage(messaging);
        }
      }
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    logger.error('Error processing Facebook webhook:', error);
    res.status(200).send('EVENT_RECEIVED');
  }
});

/**
 * POST /webhooks/meta
 * Unified Meta webhook handler (handles both Instagram and Facebook)
 */
router.post('/meta', async (req, res) => {
  try {
    const body = req.body;

    logger.info('Meta webhook event received', { object: body.object });

    if (body.object === 'instagram') {
      for (const entry of body.entry || []) {
        if (entry.changes) {
          for (const change of entry.changes) {
            await handleInstagramChange(change);
          }
        }
        if (entry.messaging) {
          for (const messaging of entry.messaging) {
            await handleInstagramMessage(messaging);
          }
        }
      }
    } else if (body.object === 'page') {
      for (const entry of body.entry || []) {
        if (entry.changes) {
          for (const change of entry.changes) {
            await handleFacebookChange(change);
          }
        }
        if (entry.messaging) {
          for (const messaging of entry.messaging) {
            await handleFacebookMessage(messaging);
          }
        }
      }
    } else {
      return res.sendStatus(404);
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    logger.error('Error processing Meta webhook:', error);
    res.status(200).send('EVENT_RECEIVED');
  }
});

// Instagram username for the page (to filter out self-comments)
const PAGE_INSTAGRAM_USERNAME = process.env.PAGE_INSTAGRAM_USERNAME || 'doors22_';

/**
 * Handle Instagram changes (comments, mentions)
 */
async function handleInstagramChange(change) {
  try {
    logger.info('Processing Instagram change', { field: change.field });

    if (change.field === 'comments') {
      const { id, text, from, media } = change.value;

      // Skip comments from our own page (don't reply to ourselves)
      const username = from?.username?.toLowerCase() || '';
      if (username === PAGE_INSTAGRAM_USERNAME.toLowerCase() ||
          username === 'doors22_' ||
          username === 'doors22') {
        logger.info(`Skipping self-comment from @${from?.username}`, { id });
        return;
      }

      const { category, response, redirected } = classifyAndRespond(text);

      await db.collection('interactions').doc(id).set({
        interactionId: id,
        platform: 'instagram',
        type: 'comment',
        postId: media?.id || null,
        user: {
          id: from?.id,
          username: from?.username || 'unknown',
          name: from?.username
        },
        userMessage: text,
        botResponse: response,
        category,
        redirected,
        timestamp: new Date().toISOString(),
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      logger.info('Instagram comment stored', { id });
    } else if (change.field === 'mentions') {
      logger.info('Instagram mention received', change.value);
    }
  } catch (error) {
    logger.error('Error handling Instagram change:', error);
  }
}

/**
 * Handle Instagram messages (DMs)
 */
async function handleInstagramMessage(messaging) {
  try {
    const { sender, message } = messaging;

    if (!message?.text) return;

    logger.info('Processing Instagram DM', { from: sender?.id });

    const { category, response, redirected } = classifyAndRespond(message.text);

    const interactionId = `ig_dm_${sender.id}_${Date.now()}`;
    await db.collection('interactions').doc(interactionId).set({
      interactionId,
      platform: 'instagram',
      type: 'dm',
      postId: null,
      user: {
        id: sender.id,
        username: 'instagram_user'
      },
      userMessage: message.text,
      botResponse: response,
      category,
      redirected,
      timestamp: new Date().toISOString(),
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    logger.info('Instagram DM stored', { interactionId });
  } catch (error) {
    logger.error('Error handling Instagram message:', error);
  }
}

/**
 * Handle Facebook changes (comments, feed)
 */
async function handleFacebookChange(change) {
  try {
    logger.info('Processing Facebook change', { field: change.field });

    if (change.field === 'feed' && change.value?.item === 'comment') {
      const { comment_id, message, from, post_id } = change.value;

      // Skip comments from our own page (don't reply to ourselves)
      // Check by page ID or page name
      const pageId = process.env.META_PAGE_ID;
      const fromId = from?.id;
      const fromName = from?.name?.toLowerCase() || '';

      if (fromId === pageId ||
          fromName.includes('doors22') ||
          fromName.includes('doors 22')) {
        logger.info(`Skipping self-comment from ${from?.name}`, { comment_id });
        return;
      }

      const { category, response, redirected } = classifyAndRespond(message);

      await db.collection('interactions').doc(comment_id).set({
        interactionId: comment_id,
        platform: 'facebook',
        type: 'comment',
        postId: post_id,
        user: {
          id: from?.id,
          username: from?.name || 'unknown',
          name: from?.name
        },
        userMessage: message,
        botResponse: response,
        category,
        redirected,
        timestamp: new Date().toISOString(),
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      logger.info('Facebook comment stored', { comment_id });
    }
  } catch (error) {
    logger.error('Error handling Facebook change:', error);
  }
}

/**
 * Handle Facebook messages (Messenger)
 */
async function handleFacebookMessage(messaging) {
  try {
    const { sender, message } = messaging;

    if (!message?.text) return;

    logger.info('Processing Facebook Messenger message', { from: sender?.id });

    const { category, response, redirected } = classifyAndRespond(message.text);

    const interactionId = `fb_dm_${sender.id}_${Date.now()}`;
    await db.collection('interactions').doc(interactionId).set({
      interactionId,
      platform: 'facebook',
      type: 'dm',
      postId: null,
      user: {
        id: sender.id,
        username: 'facebook_user'
      },
      userMessage: message.text,
      botResponse: response,
      category,
      redirected,
      timestamp: new Date().toISOString(),
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    logger.info('Facebook Messenger message stored', { interactionId });
  } catch (error) {
    logger.error('Error handling Facebook message:', error);
  }
}

/**
 * Classify message and generate response
 */
function classifyAndRespond(message) {
  if (!message) {
    return {
      category: 'unknown',
      response: 'Thanks for reaching out! Visit https://doors22.com/price/ or call (305) 394-9922.',
      redirected: true
    };
  }

  const messageLower = message.toLowerCase();

  if (messageLower.includes('price') || messageLower.includes('cost') || messageLower.includes('how much') || messageLower.includes('quote')) {
    return {
      category: 'price_inquiry',
      response: 'Hi! Our pricing varies based on size and customization. Get an instant quote here: https://doors22.com/price/ or call us at (305) 394-9922',
      redirected: true
    };
  } else if (messageLower.includes('install') || messageLower.includes('service') || messageLower.includes('area') || messageLower.includes('location')) {
    return {
      category: 'technical_question',
      response: 'Yes, we serve all of South Florida! Request your free consultation: https://doors22.com/price/ or call (305) 394-9922',
      redirected: true
    };
  } else if (messageLower.includes('beautiful') || messageLower.includes('love') || messageLower.includes('great') || messageLower.includes('amazing') || messageLower.includes('gorgeous')) {
    return {
      category: 'compliment',
      response: 'Thank you so much! We\'d love to help with your next project. Check out more: https://doors22.com/',
      redirected: false
    };
  } else if (messageLower.includes('glass') || messageLower.includes('type') || messageLower.includes('options') || messageLower.includes('material')) {
    return {
      category: 'technical_question',
      response: 'We offer various glass types: clear, frosted, tinted, and decorative options. Each can be customized for your needs. Get detailed info: https://doors22.com/price/ or call (305) 394-9922',
      redirected: true
    };
  } else {
    return {
      category: 'faq',
      response: 'Thanks for reaching out! For specific information, visit https://doors22.com/price/ or call us at (305) 394-9922. We\'re here to help!',
      redirected: true
    };
  }
}

module.exports = router;
