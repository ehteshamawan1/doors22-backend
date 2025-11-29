const logger = require('../utils/logger');
const metaService = require('../services/meta.service');
const aiEngine = require('../services/aiEngine');
const { db } = require('../config/firebase');

/**
 * autoReply cron job
 * Runs every 5 minutes to check for pending interactions (comments/DMs)
 * and automatically responds to them using AI-generated responses
 */
async function run() {
  try {
    logger.info('=== Running Auto-Reply Cron Job ===');

    const startTime = Date.now();

    // Check if Meta API is configured
    if (!metaService.isConfigured()) {
      logger.warn('META API NOT CONFIGURED - Skipping auto-reply');
      return {
        success: false,
        message: 'Meta API not configured',
        replied: 0
      };
    }

    // Get pending interactions
    logger.info('Fetching pending interactions...');
    const snapshot = await db.collection('interactions')
      .where('status', '==', 'pending')
      .orderBy('timestamp', 'asc')
      .limit(20)
      .get();

    if (snapshot.empty) {
      logger.info('No pending interactions to reply to');
      return {
        success: true,
        message: 'No pending interactions',
        replied: 0
      };
    }

    const interactions = [];
    snapshot.forEach(doc => {
      interactions.push({
        id: doc.id,
        ...doc.data()
      });
    });

    logger.info(`Found ${interactions.length} pending interaction(s)`);

    const results = {
      replied: 0,
      failed: 0,
      skipped: 0
    };

    for (const interaction of interactions) {
      try {
        logger.info(`Processing ${interaction.type} from ${interaction.platform}: ${interaction.id}`);

        // Generate AI response if not already generated
        let response = interaction.botResponse;
        if (!response) {
          try {
            const aiResponse = await aiEngine.generateInteractionResponse({
              message: interaction.userMessage,
              type: interaction.type,
              platform: interaction.platform,
              category: interaction.category
            });
            response = aiResponse.response;
          } catch (aiError) {
            logger.error('AI response generation failed:', aiError.message);
            // Use fallback response
            response = getFallbackResponse(interaction.category);
          }
        }

        // Send the reply based on type and platform
        let replyResult;

        if (interaction.type === 'comment') {
          if (interaction.platform === 'instagram') {
            replyResult = await metaService.replyToInstagramComment(
              interaction.interactionId,
              response
            );
          } else if (interaction.platform === 'facebook') {
            replyResult = await metaService.replyToFacebookComment(
              interaction.interactionId,
              response
            );
          }
        } else if (interaction.type === 'dm') {
          if (interaction.platform === 'instagram') {
            replyResult = await metaService.sendInstagramDM(
              interaction.user?.id,
              response
            );
          } else if (interaction.platform === 'facebook') {
            replyResult = await metaService.sendFacebookMessage(
              interaction.user?.id,
              response
            );
          }
        }

        if (replyResult?.success) {
          // Update interaction status
          await db.collection('interactions').doc(interaction.id).update({
            status: 'responded',
            botResponse: response,
            respondedAt: new Date().toISOString(),
            replyId: replyResult.replyId || replyResult.messageId
          });

          results.replied++;
          logger.info(`Replied to ${interaction.id} successfully`);
        } else {
          results.failed++;
          logger.error(`Reply failed for ${interaction.id}`);

          // Mark as failed for manual review
          await db.collection('interactions').doc(interaction.id).update({
            status: 'failed',
            lastError: 'Reply API call failed',
            lastAttempt: new Date().toISOString()
          });
        }
      } catch (interactionError) {
        logger.error(`Error processing interaction ${interaction.id}:`, interactionError.message);
        results.failed++;

        // Mark as failed
        await db.collection('interactions').doc(interaction.id).update({
          status: 'failed',
          lastError: interactionError.message,
          lastAttempt: new Date().toISOString()
        });
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`=== Auto-Reply Completed (${duration}s) ===`);
    logger.info(`Replied: ${results.replied}, Failed: ${results.failed}, Skipped: ${results.skipped}`);

    // Log to logs collection
    await db.collection('logs').add({
      type: 'auto_reply',
      results: results,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime
    });

    return {
      success: true,
      results: results,
      message: `Replied to ${results.replied} interaction(s)`
    };
  } catch (error) {
    logger.error('autoReply cron job failed:', error.message);

    // Log error
    try {
      await db.collection('logs').add({
        type: 'auto_reply',
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    } catch (logError) {
      logger.error('Failed to log error:', logError.message);
    }

    throw error;
  }
}

/**
 * Get fallback response based on category
 */
function getFallbackResponse(category) {
  const responses = {
    price_inquiry: 'Hi! Our pricing varies based on size and customization. Get an instant quote here: https://doors22.com/price/ or call us at (305) 394-9922',
    technical_question: 'Great question! For detailed information, visit https://doors22.com/price/ or call us at (305) 394-9922. Our team is happy to help!',
    compliment: 'Thank you so much! We appreciate your kind words. Check out more of our work at https://doors22.com/',
    faq: 'Thanks for reaching out! For more information, visit https://doors22.com/price/ or call us at (305) 394-9922. We\'re here to help!'
  };

  return responses[category] || responses.faq;
}

module.exports = { run };
