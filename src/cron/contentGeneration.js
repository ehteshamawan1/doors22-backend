/**
 * Content Generation Cron Job
 *
 * Runs daily at 3:15 AM UTC (10:15 PM EST)
 * Generates 4 posts - one for each product category:
 * - Room Dividers
 * - Closet Doors
 * - Home Offices (residential)
 * - Office Partitions (commercial)
 *
 * Uses reference images as INPUT to Midjourney for product accuracy.
 * Midjourney generates NEW images that look similar to the reference.
 * Uses --iw 2 (high image weight) for maximum product similarity.
 */

const logger = require('../utils/logger');
const aiEngine = require('../services/aiEngine');
const midjourneyService = require('../services/midjourney.service');
const cloudinaryService = require('../services/cloudinary.service');
const referenceImagesService = require('../services/referenceImages.service');
const { db } = require('../config/firebase');
const { generatePostId } = require('../utils/helpers');

// Define the 4 categories for daily generation
const DAILY_CATEGORIES = [
  'room_dividers',      // 1x Room Dividers
  'closet_doors',       // 1x Closet Doors
  'home_offices',       // 1x Home Offices (residential)
  'office_partitions'   // 1x Office Partitions (commercial)
];

/**
 * Main content generation runner
 * Generates one post for each category using Midjourney with reference images
 */
async function run() {
  try {
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('  Content Generation Started - 4 Categories (Midjourney)');
    logger.info('═══════════════════════════════════════════════════════════');

    const startTime = Date.now();
    const results = [];

    // Get latest trends for content generation
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
 * Generate content for a specific category using Midjourney
 * @param {string} category - Category key
 * @param {Object} trendData - Latest trend analysis data
 * @returns {Promise<Object>} Generation result
 */
async function generateForCategory(category, trendData) {
  // Step 1: Get random reference image for this category
  logger.info(`Step 1: Selecting reference image for ${category}...`);
  const imageData = await referenceImagesService.getRandomImage(category);
  logger.info(`Selected: ${imageData.publicId}`);
  logger.info(`Reference URL: ${imageData.url}`);

  // Build description for prompt generation
  const description = buildDescription(imageData);
  logger.info(`Description: ${description}`);

  // Step 2: Determine content type based on trends mix (70% images, 30% videos)
  const contentMix = trendData?.contentMix || { images: 70, videos: 30 };
  const random = Math.random() * 100;
  const contentType = random < contentMix.images ? 'image' : 'video';
  logger.info(`Step 2: Content type selected: ${contentType} (random: ${random.toFixed(1)}, threshold: ${contentMix.images})`);

  // Step 3: Generate Midjourney prompt with reference image
  logger.info('Step 3: Generating Midjourney prompt...');
  const promptData = await aiEngine.generateMidjourneyPrompt({
    type: contentType,
    category: category,
    keyword: imageData.keyword,
    referenceUrl: imageData.url,
    description: description,
    trendData: trendData
  });
  logger.info(`Prompt: ${promptData.prompt}`);

  // Step 4: Generate with Midjourney (includes upscaling)
  // Format: "{referenceUrl} {prompt} --iw 2 --ar 4:5 --v 6"
  logger.info(`Step 4: Generating ${contentType} with Midjourney...`);

  let generationResult;

  if (contentType === 'video') {
    // Video generation workflow: imagine → upscale → animate → select
    // This is a 4-step process that creates a 5-10 second animated video
    logger.info('Using video generation workflow (imagine → upscale → animate → select)...');
    generationResult = await midjourneyService.generateVideo({
      prompt: promptData.prompt,
      referenceUrl: imageData.url,
      parameters: {
        ...promptData.parameters,
        iw: 2  // High image weight for product accuracy
      }
    });
  } else {
    // Image generation workflow: imagine → upscale
    generationResult = await midjourneyService.generate({
      prompt: promptData.prompt,
      type: 'image',
      referenceUrl: imageData.url,
      parameters: {
        ...promptData.parameters,
        iw: 2  // High image weight for product accuracy
      }
    });
  }

  const fileSizeMB = generationResult.fileSize ? (generationResult.fileSize / 1024 / 1024).toFixed(2) : 'unknown';
  logger.info(`${contentType} generated successfully (${fileSizeMB} MB)`);

  // Step 5: Upload to Cloudinary
  const postId = generatePostId();
  logger.info(`Step 5: Uploading to Cloudinary (postId: ${postId})...`);
  const uploadResult = await cloudinaryService.uploadMedia(generationResult.mediaBuffer, {
    type: contentType,
    postId: postId,
    filename: postId
  });
  logger.info(`Uploaded to: ${uploadResult.url}`);

  // Step 6: Generate caption with category-specific keyword
  logger.info('Step 6: Generating caption...');
  const captionData = await aiEngine.generateCaption({
    type: contentType,
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

  // Step 7: Store in Firebase with PENDING status
  logger.info('Step 7: Storing post in Firebase...');
  const postData = {
    postId: postId,
    date: new Date().toISOString().split('T')[0],
    type: contentType,
    category: category,
    keyword: imageData.keyword,
    displayName: imageData.displayName,
    mediaUrl: uploadResult.url,
    thumbnailUrl: uploadResult.thumbnailUrl || uploadResult.url,
    cloudinaryPublicId: uploadResult.publicId,
    referenceImage: {
      url: imageData.url,
      publicId: imageData.publicId,
      frame: imageData.frame || null,
      glassType: imageData.glassType || null,
      panels: imageData.panels || null
    },
    midjourneyPrompt: generationResult.prompt,
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
    createdAt: new Date().toISOString(),
    status: 'pending',
    aspectRatio: contentType === 'video' ? '9:16' : '4:5',
    format: uploadResult.format,
    fileSize: uploadResult.fileSize,
    width: uploadResult.width,
    height: uploadResult.height,
    duration: uploadResult.duration || null,
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
    contentType: contentType,
    referenceImage: imageData.publicId,
    status: 'success',
    timestamp: new Date().toISOString()
  });

  return {
    success: true,
    postId: docRef.id,
    category: category,
    keyword: imageData.keyword,
    type: contentType,
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
