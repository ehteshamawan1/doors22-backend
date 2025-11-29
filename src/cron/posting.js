const logger = require('../utils/logger');
const approvalService = require('../services/approval.service');
const metaService = require('../services/meta.service');
const { db } = require('../config/firebase');

/**
 * posting cron job
 * Runs daily at 5:00 PM UTC (12:00 PM EST - optimal posting time)
 * Also runs every 5 minutes to check for approved posts ready to publish
 *
 * This job checks for approved posts and posts them to Instagram/Facebook.
 */
async function run() {
  try {
    logger.info('=== Running Auto-Posting Cron Job ===');

    const startTime = Date.now();

    // Check if Meta API is configured
    if (!metaService.isConfigured()) {
      logger.warn('META API NOT CONFIGURED - Check environment variables:');
      logger.warn('  - META_PAGE_ACCESS_TOKEN');
      logger.warn('  - META_PAGE_ID');
      logger.warn('  - META_IG_USER_ID');
      return {
        success: false,
        message: 'Meta API not configured',
        posted: 0
      };
    }

    // Get approved posts ready for posting
    logger.info('Fetching approved posts...');
    const approvedPosts = await approvalService.getApprovedPosts();

    if (approvedPosts.length === 0) {
      logger.info('No approved posts ready for posting');
      return {
        success: true,
        message: 'No posts to publish',
        posted: 0
      };
    }

    logger.info(`Found ${approvedPosts.length} approved post(s) ready for posting`);

    const results = {
      success: 0,
      failed: 0,
      partial: 0
    };

    for (const post of approvedPosts) {
      try {
        logger.info(`Processing post: ${post.id} (${post.type})`);

        // Post to both platforms
        const postResult = await metaService.postToBothPlatforms({
          mediaUrl: post.mediaUrl,
          caption: post.fullPost || `${post.caption}\n\n${post.hashtags?.join(' ') || ''}`,
          mediaType: post.type
        });

        if (postResult.success) {
          // Update post status to "posted"
          await db.collection('posts').doc(post.id).update({
            status: 'posted',
            postedAt: new Date().toISOString(),
            platforms: {
              instagram: postResult.instagram,
              facebook: postResult.facebook
            },
            postingErrors: postResult.errors.length > 0 ? postResult.errors : null
          });

          if (postResult.partialSuccess) {
            results.partial++;
            logger.warn(`Post ${post.id} partially published (some platforms failed)`);
          } else {
            results.success++;
            logger.info(`Post ${post.id} published successfully to all platforms`);
          }

          // Log success
          await db.collection('logs').add({
            type: 'posting_success',
            postId: post.id,
            platforms: {
              instagram: !!postResult.instagram,
              facebook: !!postResult.facebook
            },
            errors: postResult.errors,
            timestamp: new Date().toISOString()
          });
        } else {
          // Both platforms failed - keep as approved for retry
          logger.error(`Post ${post.id} failed on all platforms`);
          results.failed++;

          // Log the failure but keep status as 'approved' for retry
          await db.collection('logs').add({
            type: 'posting_error',
            postId: post.id,
            errors: postResult.errors,
            timestamp: new Date().toISOString()
          });
        }
      } catch (postError) {
        logger.error(`Failed to process post ${post.id}:`, postError.message);
        results.failed++;

        // Log error - post stays as 'approved' for retry
        await db.collection('logs').add({
          type: 'posting_error',
          postId: post.id,
          error: postError.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`=== Auto-Posting Completed (${duration}s) ===`);
    logger.info(`Success: ${results.success}, Partial: ${results.partial}, Failed: ${results.failed}`);

    return {
      success: true,
      results: results,
      message: `Posted ${results.success} post(s) successfully, ${results.partial} partial, ${results.failed} failed`
    };
  } catch (error) {
    logger.error('posting cron job failed:', error.message);
    throw error;
  }
}

/**
 * Post a single approved post immediately (called from approval service)
 * @param {Object} post - Post data
 * @returns {Promise<Object>} Posting result
 */
async function postImmediately(post) {
  try {
    logger.info(`Posting immediately: ${post.id}`);

    if (!metaService.isConfigured()) {
      throw new Error('Meta API not configured');
    }

    const postResult = await metaService.postToBothPlatforms({
      mediaUrl: post.mediaUrl,
      caption: post.fullPost || `${post.caption}\n\n${post.hashtags?.join(' ') || ''}`,
      mediaType: post.type
    });

    if (postResult.success) {
      await db.collection('posts').doc(post.id).update({
        status: 'posted',
        postedAt: new Date().toISOString(),
        platforms: {
          instagram: postResult.instagram,
          facebook: postResult.facebook
        },
        postingErrors: postResult.errors.length > 0 ? postResult.errors : null
      });

      logger.info(`Post ${post.id} published immediately`);

      await db.collection('logs').add({
        type: 'immediate_posting_success',
        postId: post.id,
        platforms: {
          instagram: !!postResult.instagram,
          facebook: !!postResult.facebook
        },
        timestamp: new Date().toISOString()
      });

      return { success: true, result: postResult };
    } else {
      // Keep as approved for retry via cron
      await db.collection('logs').add({
        type: 'immediate_posting_failed',
        postId: post.id,
        errors: postResult.errors,
        timestamp: new Date().toISOString()
      });

      return { success: false, errors: postResult.errors };
    }
  } catch (error) {
    logger.error(`Immediate posting failed for ${post.id}:`, error.message);

    await db.collection('logs').add({
      type: 'immediate_posting_error',
      postId: post.id,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    return { success: false, error: error.message };
  }
}

module.exports = { run, postImmediately };
