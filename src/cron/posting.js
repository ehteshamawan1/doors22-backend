const logger = require('../utils/logger');
const approvalService = require('../services/approval.service');
const { db } = require('../config/firebase');

/**
 * posting cron job
 * Runs daily at 5:00 PM UTC (12:00 PM EST - optimal posting time)
 *
 * CURRENT STATUS: STUB IMPLEMENTATION
 * Meta API integration is pending (Facebook/Instagram credentials not ready)
 *
 * This job checks for approved posts and prepares them for posting.
 * Once Meta API is configured, it will automatically post to Instagram/Facebook.
 */
async function run() {
  try {
    logger.info('=== Running Auto-Posting Cron Job ===');

    const startTime = Date.now();

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
      skipped: 0
    };

    for (const post of approvedPosts) {
      try {
        logger.info(`Processing post: ${post.id} (${post.type})`);

        // ===== META API INTEGRATION GOES HERE =====
        // TODO: Uncomment and implement when Meta API credentials are ready

        /*
        // Post to Instagram
        if (post.type === 'image') {
          const igResult = await metaService.postToInstagram({
            imageUrl: post.mediaUrl,
            caption: post.fullPost
          });
          logger.info(`Posted to Instagram: ${igResult.postId}`);
        } else if (post.type === 'video') {
          const igResult = await metaService.postReelToInstagram({
            videoUrl: post.mediaUrl,
            caption: post.fullPost
          });
          logger.info(`Posted reel to Instagram: ${igResult.postId}`);
        }

        // Post to Facebook
        const fbResult = await metaService.postToFacebook({
          mediaUrl: post.mediaUrl,
          caption: post.fullPost,
          mediaType: post.type
        });
        logger.info(`Posted to Facebook: ${fbResult.postId}`);

        // Update post status to "posted"
        await db.collection('posts').doc(post.id).update({
          status: 'posted',
          postedAt: new Date().toISOString(),
          platforms: {
            instagram: igResult,
            facebook: fbResult
          }
        });

        results.success++;
        logger.info(`✓ Post ${post.id} published successfully`);
        */

        // ===== STUB IMPLEMENTATION (CURRENT) =====
        logger.warn('⚠️  META API NOT CONFIGURED - SKIPPING ACTUAL POST');
        logger.info(`Post ${post.id} would be posted with:`);
        logger.info(`  - Type: ${post.type}`);
        logger.info(`  - Media: ${post.mediaUrl}`);
        logger.info(`  - Caption: ${post.caption?.substring(0, 60)}...`);
        logger.info(`  - Hashtags: ${post.hashtags?.slice(0, 3).join(', ')}...`);

        results.skipped++;

        // Log to logs collection
        await db.collection('logs').add({
          type: 'posting_skipped',
          postId: post.id,
          reason: 'Meta API not configured',
          timestamp: new Date().toISOString()
        });

      } catch (postError) {
        logger.error(`Failed to process post ${post.id}:`, postError.message);
        results.failed++;

        // Log error
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
    logger.info(`Success: ${results.success}, Failed: ${results.failed}, Skipped: ${results.skipped}`);

    if (results.skipped > 0) {
      logger.warn('⚠️  META API INTEGRATION REQUIRED');
      logger.warn('Configure Facebook/Instagram credentials to enable auto-posting');
    }

    return {
      success: true,
      results: results,
      message: results.skipped > 0
        ? 'Meta API not configured - posts skipped'
        : `Posted ${results.success} post(s) successfully`
    };
  } catch (error) {
    logger.error('posting cron job failed:', error.message);
    throw error;
  }
}

module.exports = { run };
