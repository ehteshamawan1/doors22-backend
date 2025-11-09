/**
 * Interaction Controller
 * Handles Instagram/Facebook comments and DMs
 */

const { db } = require('../config/firebase');
const logger = require('../utils/logger');

/**
 * GET /api/interactions
 * Get all interactions (comments & DMs) with optional filters
 */
exports.getInteractions = async (req, res) => {
  try {
    const { limit = 20, offset = 0, platform, type, category } = req.query;

    let query = db.collection('interactions').orderBy('timestamp', 'desc');

    if (platform) {
      query = query.where('platform', '==', platform);
    }

    if (type) {
      query = query.where('type', '==', type);
    }

    if (category) {
      query = query.where('category', '==', category);
    }

    const snapshot = await query
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();

    const interactions = [];
    snapshot.forEach(doc => {
      interactions.push({
        id: doc.id,
        ...doc.data()
      });
    });

    logger.info(`Retrieved ${interactions.length} interactions`);

    res.json({
      success: true,
      count: interactions.length,
      interactions
    });
  } catch (error) {
    logger.error('Error fetching interactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch interactions',
      message: error.message
    });
  }
};

/**
 * GET /api/interactions/statistics
 * Get interaction statistics by category and platform
 */
exports.getStatistics = async (req, res) => {
  try {
    const categories = ['price_inquiry', 'technical_question', 'compliment', 'faq'];
    const platforms = ['instagram', 'facebook'];

    const statistics = {
      total: 0,
      byCategory: {},
      byPlatform: {},
      redirectedCount: 0
    };

    // Get count by category
    for (const category of categories) {
      const snapshot = await db.collection('interactions')
        .where('category', '==', category)
        .get();
      statistics.byCategory[category] = snapshot.size;
      statistics.total += snapshot.size;
    }

    // Get count by platform
    for (const platform of platforms) {
      const snapshot = await db.collection('interactions')
        .where('platform', '==', platform)
        .get();
      statistics.byPlatform[platform] = snapshot.size;
    }

    // Get redirected count
    const redirectedSnapshot = await db.collection('interactions')
      .where('redirected', '==', true)
      .get();
    statistics.redirectedCount = redirectedSnapshot.size;

    logger.info('Retrieved interaction statistics:', statistics);

    res.json({
      success: true,
      statistics
    });
  } catch (error) {
    logger.error('Error fetching interaction statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      message: error.message
    });
  }
};

/**
 * GET /api/interactions/:id
 * Get a specific interaction by ID
 */
exports.getInteractionById = async (req, res) => {
  try {
    const { id } = req.params;

    const interactionDoc = await db.collection('interactions').doc(id).get();

    if (!interactionDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Interaction not found'
      });
    }

    const interaction = {
      id: interactionDoc.id,
      ...interactionDoc.data()
    };

    logger.info(`Retrieved interaction: ${id}`);

    res.json({
      success: true,
      interaction
    });
  } catch (error) {
    logger.error(`Error fetching interaction ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch interaction',
      message: error.message
    });
  }
};

/**
 * POST /api/interactions/webhook
 * Handle Meta Graph API webhooks for comments and DMs
 * This is called by Facebook/Instagram when there's a new comment or DM
 */
exports.handleWebhook = async (req, res) => {
  try {
    const body = req.body;

    // Verify webhook (first-time setup)
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token']) {
      const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'doors22_webhook_verify';

      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        logger.info('Webhook verified successfully');
        return res.status(200).send(req.query['hub.challenge']);
      } else {
        logger.error('Webhook verification failed: invalid token');
        return res.sendStatus(403);
      }
    }

    // Handle webhook event
    if (body.object === 'page' || body.object === 'instagram') {
      // Process each entry
      for (const entry of body.entry) {
        // Handle comments
        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.field === 'comments') {
              await handleComment(change.value);
            }
          }
        }

        // Handle messages (DMs)
        if (entry.messaging) {
          for (const messaging of entry.messaging) {
            if (messaging.message) {
              await handleDM(messaging);
            }
          }
        }
      }

      res.status(200).send('EVENT_RECEIVED');
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    logger.error('Error handling webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Webhook processing failed',
      message: error.message
    });
  }
};

/**
 * Helper: Handle incoming comment
 */
async function handleComment(commentData) {
  try {
    const { id, message, from, post_id } = commentData;

    logger.info(`Processing comment: ${id} from ${from.name}`);

    // Classify comment and generate response
    const { category, response, redirected } = await classifyAndRespond(message);

    // Store interaction in Firestore
    await db.collection('interactions').doc(id).set({
      interactionId: id,
      platform: 'instagram', // or 'facebook' based on webhook source
      type: 'comment',
      postId: post_id,
      user: {
        id: from.id,
        username: from.username || from.name,
        name: from.name
      },
      userMessage: message,
      botResponse: response,
      category,
      redirected,
      timestamp: new Date().toISOString(),
      status: 'responded',
      createdAt: new Date().toISOString()
    });

    // Send response via Meta API (when credentials ready)
    // await sendCommentReply(id, response);

    logger.info(`Comment processed: ${id}`);
  } catch (error) {
    logger.error('Error handling comment:', error);
  }
}

/**
 * Helper: Handle incoming DM
 */
async function handleDM(messaging) {
  try {
    const { sender, message } = messaging;

    logger.info(`Processing DM from ${sender.id}`);

    // Classify message and generate response
    const { category, response, redirected } = await classifyAndRespond(message.text);

    // Store interaction in Firestore
    const interactionId = `dm_${sender.id}_${Date.now()}`;
    await db.collection('interactions').doc(interactionId).set({
      interactionId,
      platform: 'instagram', // or 'facebook'
      type: 'dm',
      postId: null,
      user: {
        id: sender.id,
        username: sender.username || 'unknown'
      },
      userMessage: message.text,
      botResponse: response,
      category,
      redirected,
      timestamp: new Date().toISOString(),
      status: 'responded',
      createdAt: new Date().toISOString()
    });

    // Send response via Meta API (when credentials ready)
    // await sendDMReply(sender.id, response);

    logger.info(`DM processed from: ${sender.id}`);
  } catch (error) {
    logger.error('Error handling DM:', error);
  }
}

/**
 * Helper: Classify message and generate appropriate response
 * This would use OpenAI GPT in production
 */
async function classifyAndRespond(message) {
  // Simple keyword-based classification (replace with GPT in production)
  const messageLower = message.toLowerCase();

  if (messageLower.includes('price') || messageLower.includes('cost') || messageLower.includes('how much')) {
    return {
      category: 'price_inquiry',
      response: 'Hi! Our pricing varies based on size and customization. Get an instant quote here: https://doors22.com/price/ or call us at (305) 394-9922 😊',
      redirected: true
    };
  } else if (messageLower.includes('install') || messageLower.includes('service') || messageLower.includes('area')) {
    return {
      category: 'technical_question',
      response: 'Yes, we serve all of South Florida! Request your free consultation: https://doors22.com/price/ 📞 (305) 394-9922',
      redirected: true
    };
  } else if (messageLower.includes('beautiful') || messageLower.includes('love') || messageLower.includes('great')) {
    return {
      category: 'compliment',
      response: 'Thank you so much! 💙 We\'d love to help with your next project. Check out more: https://doors22.com/',
      redirected: false
    };
  } else if (messageLower.includes('glass') || messageLower.includes('type') || messageLower.includes('options')) {
    return {
      category: 'technical_question',
      response: 'We offer various glass types: clear, frosted, tinted, and decorative options. Each can be customized for your needs. Get detailed info: https://doors22.com/price/ 📞 (305) 394-9922',
      redirected: true
    };
  } else {
    return {
      category: 'faq',
      response: 'Thanks for reaching out! For specific information, visit https://doors22.com/price/ or call us at (305) 394-9922. We\'re here to help! 😊',
      redirected: true
    };
  }
}

/**
 * DELETE /api/interactions/:id
 * Delete an interaction
 */
exports.deleteInteraction = async (req, res) => {
  try {
    const { id } = req.params;

    await db.collection('interactions').doc(id).delete();

    logger.info(`Interaction deleted: ${id}`);

    res.json({
      success: true,
      message: 'Interaction deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting interaction ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete interaction',
      message: error.message
    });
  }
};
