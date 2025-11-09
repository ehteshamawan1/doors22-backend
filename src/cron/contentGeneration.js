const logger = require('../utils/logger');
const aiEngine = require('../services/aiEngine');
const midjourneyService = require('../services/midjourney.service');
const cloudinaryService = require('../services/cloudinary.service');
const { db } = require('../config/firebase');
const { generatePostId } = require('../utils/helpers');

/**
 * contentGeneration cron job
 * Runs daily at 3:15 AM UTC (after trends analysis)
 * Generates content (70% images, 30% videos)
 * Creates Midjourney prompts, generates media, uploads to Cloudinary
 * Generates captions and stores in Firebase with "pending" status
 */
async function run() {
  try {
    logger.info('=== Running Content Generation ===');

    const startTime = Date.now();

    // Get latest trends
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

    // Generate content concept (AI determines image vs video)
    logger.info('Generating content concept...');
    const contentConcept = await aiEngine.generateContentConcept(trendData);
    logger.info(`Concept: ${contentConcept.type} - ${contentConcept.concept}`);

    // Generate Midjourney prompt
    logger.info('Generating Midjourney prompt...');
    const promptData = await aiEngine.generateMidjourneyPrompt({
      type: contentConcept.type,
      trendData: trendData,
      concept: contentConcept.concept
    });
    logger.info(`Prompt: ${promptData.prompt}`);

    // Generate media with Midjourney
    logger.info(`Generating ${contentConcept.type} with Midjourney...`);
    const generationResult = await midjourneyService.generate({
      prompt: promptData.prompt,
      type: contentConcept.type,
      parameters: promptData.parameters
    });
    logger.info(`${contentConcept.type} generated successfully (${(generationResult.fileSize / 1024 / 1024).toFixed(2)} MB)`);

    // Upload to Cloudinary
    const postId = generatePostId();
    logger.info(`Uploading to Cloudinary (postId: ${postId})...`);
    const uploadResult = await cloudinaryService.uploadMedia(generationResult.mediaBuffer, {
      type: contentConcept.type,
      postId: postId,
      filename: postId
    });
    logger.info(`Uploaded to: ${uploadResult.url}`);

    // Generate caption and hashtags
    logger.info('Generating caption and hashtags...');
    const captionData = await aiEngine.generateCaption({
      type: contentConcept.type,
      description: contentConcept.concept,
      trendData: trendData
    });
    logger.info(`Caption: ${captionData.caption.substring(0, 60)}...`);

    // Store in Firebase with PENDING status (awaits admin approval)
    logger.info('Storing post in Firebase with pending status...');
    const postData = {
      postId: postId,
      date: new Date().toISOString().split('T')[0],
      type: contentConcept.type,
      mediaUrl: uploadResult.url,
      thumbnailUrl: uploadResult.thumbnailUrl || uploadResult.url,
      cloudinaryPublicId: uploadResult.publicId,
      midjourneyPrompt: promptData.prompt,
      concept: contentConcept.concept,
      caption: captionData.caption,
      hashtags: captionData.hashtags,
      fullPost: captionData.fullPost,
      cta: captionData.cta,
      generatedAt: new Date().toISOString(),
      status: 'pending', // Requires admin approval
      duration: uploadResult.duration || null,
      format: uploadResult.format,
      aspectRatio: promptData.parameters.ar,
      fileSize: uploadResult.fileSize,
      width: uploadResult.width,
      height: uploadResult.height,
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
      contentType: contentConcept.type,
      status: 'success',
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`=== Content Generation Completed (${duration}s) ===`);
    logger.info(`Post ID: ${docRef.id}`);
    logger.info(`Type: ${contentConcept.type}`);
    logger.info(`Status: PENDING (awaiting admin approval)`);

    return {
      success: true,
      postId: docRef.id,
      type: contentConcept.type,
      status: 'pending'
    };
  } catch (error) {
    logger.error('contentGeneration failed:', error.message);

    // Log error
    try {
      await db.collection('logs').add({
        type: 'content_generation',
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

module.exports = { run };
