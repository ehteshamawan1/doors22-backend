/**
 * Content Generation Cron Job
 *
 * Runs daily at 3:15 AM UTC (10:15 PM EST)
 * Generates 3 posts - one for each product category:
 * - Room Dividers
 * - Closet Doors
 * - Home Offices
 *
 * Uses pre-uploaded reference images from Cloudinary instead of Midjourney
 * for 100% product accuracy and reliability.
 */

const logger = require('../utils/logger');
const aiEngine = require('../services/aiEngine');
const referenceImagesService = require('../services/referenceImages.service');
const { db } = require('../config/firebase');
const { generatePostId } = require('../utils/helpers');

// Define the 3 categories for daily generation
const DAILY_CATEGORIES = [
  'room_dividers',   // 1x Room Dividers
  'closet_doors',    // 1x Closet Doors
  'home_offices'     // 1x Home Offices
];

/**
 * Main content generation runner
 * Generates one post for each category
 */
async function run() {
  try {
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('  Content Generation Started - 3 Categories');
    logger.info('═══════════════════════════════════════════════════════════');

    const startTime = Date.now();
    const results = [];

    // Get latest trends for caption generation
    logger.info('Fetching latest trends...');
    const trendsSnapshot = await db.collection('trends')
      .orderBy('date', 'desc')
      .limit(1)
      .get();

    let trendData = null;
    if (!trendsSnapshot.empty) {
      trendData = trendsSnapshot.docs[0].data();
      logger.info(`Using trends from: ${trendData.date}`);
    } else {
      logger.warn('No trends found, using default settings');
    }

    // Generate content for each category
    for (const category of DAILY_CATEGORIES) {
      logger.info('');
      logger.info(`───────────────────────────────────────────────────────────`);
      logger.info(`  Generating: ${referenceImagesService.getDisplayName(category)}`);
      logger.info(`───────────────────────────────────────────────────────────`);

      try {
        const result = await generateForCategory(category, trendData);
        results.push(result);
        logger.info(`✓ ${category}: Post created (${result.postId})`);
      } catch (error) {
        logger.error(`✗ ${category} failed:`, error.message);
        results.push({
          category,
          success: false,
          error: error.message
        });

        // Log the error to Firebase
        await db.collection('logs').add({
          type: 'content_generation_error',
          category: category,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const successCount = results.filter(r => r.success).length;

    logger.info('');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`  Content Generation Completed (${duration}s)`);
    logger.info(`  Generated: ${successCount}/${DAILY_CATEGORIES.length} posts`);
    logger.info('═══════════════════════════════════════════════════════════');

    // Log overall result
    await db.collection('logs').add({
      type: 'content_generation_batch',
      status: successCount === DAILY_CATEGORIES.length ? 'success' : 'partial',
      generated: successCount,
      total: DAILY_CATEGORIES.length,
      duration: parseFloat(duration),
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      results,
      generated: successCount,
      total: DAILY_CATEGORIES.length
    };
  } catch (error) {
    logger.error('Content generation batch failed:', error.message);

    await db.collection('logs').add({
      type: 'content_generation_batch',
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });

    throw error;
  }
}

/**
 * Generate content for a specific category
 * @param {string} category - Category key
 * @param {Object} trendData - Latest trend analysis data
 * @returns {Promise<Object>} Generation result
 */
async function generateForCategory(category, trendData) {
  // Step 1: Get random reference image for this category
  logger.info(`Selecting reference image for ${category}...`);
  const imageData = await referenceImagesService.getRandomImage(category);
  logger.info(`Selected: ${imageData.publicId}`);

  // Build description for caption generation
  const description = buildDescription(imageData);

  // Step 2: Generate caption with category-specific keyword
  logger.info('Generating caption...');
  const captionData = await aiEngine.generateCaption({
    type: 'image',
    category: category,
    keyword: imageData.keyword,
    description: description,
    trendData: trendData
  });

  // Ensure caption includes keyword
  let finalCaption = captionData.caption || captionData.text;
  if (!finalCaption.toLowerCase().includes(imageData.keyword.toLowerCase())) {
    logger.warn('Caption missing keyword, prepending...');
    finalCaption = `${imageData.keyword.charAt(0).toUpperCase() + imageData.keyword.slice(1)} - ${finalCaption}`;
  }

  logger.info(`Caption: ${finalCaption.substring(0, 60)}...`);

  // Step 3: Store in Firebase with PENDING status
  const postId = generatePostId();
  const postData = {
    postId: postId,
    date: new Date().toISOString().split('T')[0],
    type: 'image',
    category: category,
    keyword: imageData.keyword,
    displayName: imageData.displayName,
    mediaUrl: imageData.url,
    thumbnailUrl: imageData.url,
    cloudinaryPublicId: imageData.publicId,
    sourceType: 'reference',
    productDetails: {
      frame: imageData.frame || null,
      glassType: imageData.glassType || null,
      panels: imageData.panels || null
    },
    caption: finalCaption,
    hashtags: captionData.hashtags || [],
    fullPost: captionData.fullPost || `${finalCaption}\n\n${(captionData.hashtags || []).join(' ')}`,
    cta: captionData.cta || 'Get a free quote at doors22.com/price or call (305) 394-9922',
    generatedAt: new Date().toISOString(),
    status: 'pending',
    aspectRatio: '4:5',
    approvalHistory: [],
    editHistory: [],
    scheduledPostTime: null,
    source: 'automated'
  };

  const docRef = await db.collection('posts').add(postData);
  logger.info(`Post created: ${docRef.id} (status: pending)`);

  // Log to logs collection
  await db.collection('logs').add({
    type: 'content_generation',
    postId: docRef.id,
    category: category,
    status: 'success',
    timestamp: new Date().toISOString()
  });

  return {
    success: true,
    postId: docRef.id,
    category: category,
    keyword: imageData.keyword,
    status: 'pending'
  };
}

/**
 * Build a description string from image metadata
 * @param {Object} imageData - Image data from reference service
 * @returns {string} Description for AI
 */
function buildDescription(imageData) {
  const parts = [imageData.keyword];

  if (imageData.frame) {
    parts.push(`with ${imageData.frame} aluminum frame`);
  }

  if (imageData.glassType) {
    parts.push(`and ${imageData.glassType} glass`);
  }

  if (imageData.panels) {
    parts.push(`(${imageData.panels} panel configuration)`);
  }

  return parts.join(' ');
}

module.exports = { run };
