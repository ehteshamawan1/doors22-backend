const logger = require('../utils/logger');
const aiEngine = require('../services/aiEngine');
const { db } = require('../config/firebase');
const { formatDate } = require('../utils/helpers');

/**
 * dailyTrends cron job
 * Runs daily at 3:00 AM UTC
 * Analyzes market trends for glass doors/partitions industry
 * Identifies trending topics, hashtags, content styles for images and videos
 */
async function run() {
  try {
    logger.info('=== Running Daily Trends Analysis ===');

    const startTime = Date.now();

    // Analyze trends (includes images + videos)
    logger.info('Analyzing trends with AI...');
    const trendData = await aiEngine.analyzeTrends({ includeVideos: true });

    // Add metadata
    const date = formatDate(new Date());
    trendData.date = date;
    trendData.analyzedAt = new Date().toISOString();
    trendData.source = 'automated';

    // Store in Firebase
    logger.info('Storing trend data in Firebase...');
    const trendsCollection = db.collection('trends');

    // Check if trend for today already exists
    const existingSnapshot = await trendsCollection
      .where('date', '==', date)
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      // Update existing trend
      const docId = existingSnapshot.docs[0].id;
      await trendsCollection.doc(docId).update(trendData);
      logger.info(`Updated existing trend: ${docId}`);
    } else {
      // Create new trend
      const docRef = await trendsCollection.add(trendData);
      logger.info(`Created new trend: ${docRef.id}`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`=== Daily Trends Analysis Completed (${duration}s) ===`);
    logger.info(`Top hashtags: ${trendData.topHashtags?.slice(0, 5).join(', ')}`);
    logger.info(`Content mix: ${trendData.contentMix?.images}% images, ${trendData.contentMix?.videos}% videos`);

    return trendData;
  } catch (error) {
    logger.error('dailyTrends failed:', error.message);
    throw error;
  }
}

module.exports = { run };
