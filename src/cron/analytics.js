const logger = require('../utils/logger');
const { db } = require('../config/firebase');

/**
 * analytics cron job
 * Runs weekly on Sunday at 12:00 AM UTC
 * Collects and analyzes post performance data
 * Generates weekly reports
 */
async function run() {
  try {
    logger.info('=== Running Weekly Analytics ===');

    const startTime = Date.now();

    // Calculate date range (last 7 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    logger.info(`Analyzing posts from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    // Get all posted content from last week
    const postsSnapshot = await db.collection('posts')
      .where('status', '==', 'posted')
      .where('postedAt', '>=', startDate.toISOString())
      .where('postedAt', '<=', endDate.toISOString())
      .get();

    if (postsSnapshot.empty) {
      logger.warn('No posted content found for this period');
      return {
        success: true,
        message: 'No posts to analyze'
      };
    }

    const posts = [];
    postsSnapshot.forEach(doc => {
      posts.push({
        id: doc.id,
        ...doc.data()
      });
    });

    logger.info(`Analyzing ${posts.length} posts...`);

    // Aggregate statistics
    const stats = {
      totalPosts: posts.length,
      byType: {
        image: 0,
        video: 0
      },
      byPlatform: {
        instagram: 0,
        facebook: 0
      },
      topHashtags: {},
      averageGenerationTime: 0
    };

    posts.forEach(post => {
      // Count by type
      stats.byType[post.type] = (stats.byType[post.type] || 0) + 1;

      // Count by platform
      if (post.platforms?.instagram) stats.byPlatform.instagram++;
      if (post.platforms?.facebook) stats.byPlatform.facebook++;

      // Aggregate hashtags
      if (post.hashtags) {
        post.hashtags.forEach(tag => {
          stats.topHashtags[tag] = (stats.topHashtags[tag] || 0) + 1;
        });
      }
    });

    // Sort hashtags by frequency
    const sortedHashtags = Object.entries(stats.topHashtags)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([tag, count]) => ({ tag, count }));

    // Create analytics report
    const analyticsReport = {
      period: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
      },
      summary: {
        totalPosts: stats.totalPosts,
        imagesPosts: stats.byType.image || 0,
        videoPosts: stats.byType.video || 0,
        instagramPosts: stats.byPlatform.instagram || 0,
        facebookPosts: stats.byPlatform.facebook || 0
      },
      topHashtags: sortedHashtags,
      posts: posts.map(p => ({
        id: p.postId,
        type: p.type,
        postedAt: p.postedAt,
        caption: p.caption?.substring(0, 100)
      })),
      insights: {
        mostUsedType: stats.byType.image > stats.byType.video ? 'image' : 'video',
        contentMixActual: {
          images: Math.round((stats.byType.image / stats.totalPosts) * 100),
          videos: Math.round((stats.byType.video / stats.totalPosts) * 100)
        }
      },
      generatedAt: new Date().toISOString()
    };

    // Store analytics report
    const analyticsCollection = db.collection('analytics');
    const docRef = await analyticsCollection.add(analyticsReport);

    logger.info(`Analytics report created: ${docRef.id}`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`=== Weekly Analytics Completed (${duration}s) ===`);
    logger.info(`Total posts: ${stats.totalPosts}`);
    logger.info(`Images: ${stats.byType.image}, Videos: ${stats.byType.video}`);
    logger.info(`Top hashtags: ${sortedHashtags.slice(0, 5).map(h => h.tag).join(', ')}`);

    return analyticsReport;
  } catch (error) {
    logger.error('analytics failed:', error.message);
    throw error;
  }
}

module.exports = { run };
