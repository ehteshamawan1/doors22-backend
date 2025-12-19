/**
 * Content Controller
 * Handles content generation API endpoints
 * Uses Midjourney with reference images for image-to-image generation
 */

const { db } = require('../config/firebase');
const aiEngine = require('../services/aiEngine');
const midjourneyService = require('../services/midjourney.service');
const cloudinaryService = require('../services/cloudinary.service');
const referenceImagesService = require('../services/referenceImages.service');
const logger = require('../utils/logger');
const { generatePostId } = require('../utils/helpers');

// Valid categories for content generation
const VALID_CATEGORIES = ['room_dividers', 'closet_doors', 'home_offices'];

/**
 * GET /api/content
 * Get all generated content
 */
exports.getContent = async (req, res) => {
  try {
    const { limit = 10, offset = 0, type } = req.query;

    let query = db.collection('content').orderBy('generatedAt', 'desc');

    if (type) {
      query = query.where('type', '==', type);
    }

    const snapshot = await query
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();

    const content = [];
    snapshot.forEach(doc => {
      content.push({
        id: doc.id,
        ...doc.data()
      });
    });

    logger.info(`Retrieved ${content.length} content items`);

    res.json({
      success: true,
      count: content.length,
      content
    });
  } catch (error) {
    logger.error('Error fetching content:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch content',
      message: error.message
    });
  }
};

/**
 * GET /api/content/:id
 * Get a specific content item by ID
 */
exports.getContentById = async (req, res) => {
  try {
    const { id } = req.params;

    const contentDoc = await db.collection('content').doc(id).get();

    if (!contentDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Content not found'
      });
    }

    const content = {
      id: contentDoc.id,
      ...contentDoc.data()
    };

    logger.info(`Retrieved content: ${id}`);

    res.json({
      success: true,
      content
    });
  } catch (error) {
    logger.error(`Error fetching content ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch content',
      message: error.message
    });
  }
};

/**
 * GET /api/content/categories
 * Get available content categories
 */
exports.getCategories = async (req, res) => {
  try {
    const categories = VALID_CATEGORIES.map(category => ({
      key: category,
      displayName: referenceImagesService.getDisplayName(category),
      keyword: referenceImagesService.getKeyword(category)
    }));

    res.json({
      success: true,
      categories
    });
  } catch (error) {
    logger.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories',
      message: error.message
    });
  }
};

/**
 * POST /api/content/generate
 * Manually trigger content generation for a specific category
 * Uses Midjourney with reference images for image-to-image generation
 */
exports.generateContent = async (req, res) => {
  try {
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('  Manual Content Generation (Midjourney)');
    logger.info('═══════════════════════════════════════════════════════════');

    const { category, trendId, type: requestedType } = req.body;

    // Validate category - if not provided or invalid, pick random
    let selectedCategory = category;
    if (!VALID_CATEGORIES.includes(category)) {
      selectedCategory = VALID_CATEGORIES[Math.floor(Math.random() * VALID_CATEGORIES.length)];
      logger.info(`Category not specified or invalid, using: ${selectedCategory}`);
    } else {
      logger.info(`Generating content for category: ${selectedCategory}`);
    }

    // Get trend data
    let trendData;
    if (trendId) {
      const trendDoc = await db.collection('trends').doc(trendId).get();
      if (trendDoc.exists) {
        trendData = trendDoc.data();
      }
    } else {
      // Get latest trend
      const trendsSnapshot = await db.collection('trends')
        .orderBy('date', 'desc')
        .limit(1)
        .get();

      if (!trendsSnapshot.empty) {
        trendData = trendsSnapshot.docs[0].data();
      }
    }

    // Step 1: Get random reference image for this category
    logger.info(`Step 1: Selecting reference image for ${selectedCategory}...`);
    const imageData = await referenceImagesService.getRandomImage(selectedCategory);
    logger.info(`Selected: ${imageData.publicId}`);
    logger.info(`Reference URL: ${imageData.url}`);

    // Build description for prompt generation
    const description = buildDescription(imageData);
    logger.info(`Description: ${description}`);

    // Step 2: Determine content type (use requested or default to image)
    const contentType = requestedType === 'video' ? 'video' : 'image';
    logger.info(`Step 2: Content type: ${contentType}`);

    // Step 3: Generate Midjourney prompt with reference image
    logger.info('Step 3: Generating Midjourney prompt...');
    const promptData = await aiEngine.generateMidjourneyPrompt({
      type: contentType,
      category: selectedCategory,
      keyword: imageData.keyword,
      referenceUrl: imageData.url,
      description: description,
      trendData: trendData
    });
    logger.info(`Prompt: ${promptData.prompt}`);

    // Step 4: Generate with Midjourney (includes upscaling)
    logger.info(`Step 4: Generating ${contentType} with Midjourney...`);
    const generationResult = contentType === 'video'
      ? await midjourneyService.generateVideo({
          prompt: promptData.prompt,
          type: contentType,
          referenceUrl: imageData.url,
          parameters: {
            ...promptData.parameters,
            iw: 2
          }
        })
      : await midjourneyService.generate({
          prompt: promptData.prompt,
          type: contentType,
          referenceUrl: imageData.url,
          parameters: {
            ...promptData.parameters,
            iw: 2  // High image weight for product accuracy
          }
        });
    logger.info(`${contentType} generated successfully (${(generationResult.fileSize / 1024 / 1024).toFixed(2)} MB)`);

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
    let captionData;
    try {
      captionData = await aiEngine.generateCaption({
        type: contentType,
        category: selectedCategory,
        keyword: imageData.keyword,
        description: description,
        trendData: trendData
      });
    } catch (error) {
      logger.error('Error generating caption:', error.message);
      captionData = {
        caption: `Transform your space with our ${imageData.keyword}. Modern design meets functionality.`,
        hashtags: ['#Doors22', '#GlassDoors', '#ModernDesign', '#InteriorDesign'],
        cta: 'Get a free quote at doors22.com/price or call (305) 394-9922'
      };
    }

    // Ensure caption includes keyword
    let finalCaption = captionData.caption || captionData.text;
    if (!finalCaption.toLowerCase().includes(imageData.keyword.toLowerCase())) {
      finalCaption = `${imageData.keyword.charAt(0).toUpperCase() + imageData.keyword.slice(1)} - ${finalCaption}`;
    }
    logger.info(`Caption: ${finalCaption.substring(0, 60)}...`);

    // Step 7: Store in Firebase with PENDING status
    logger.info('Step 7: Storing post in Firebase...');
    const postData = {
      postId: postId,
      date: new Date().toISOString().split('T')[0],
      type: contentType,
      category: selectedCategory,
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
      source: 'manual',
      trendId: trendId || null
    };

    const contentDoc = await db.collection('posts').add(postData);

    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`  Content Generated Successfully: ${contentDoc.id}`);
    logger.info(`  Type: ${contentType} | Category: ${selectedCategory}`);
    logger.info('═══════════════════════════════════════════════════════════');

    // Log to logs collection
    await db.collection('logs').add({
      type: 'content_generation',
      postId: contentDoc.id,
      category: selectedCategory,
      contentType: contentType,
      referenceImage: imageData.publicId,
      source: 'manual',
      status: 'success',
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Content generated successfully via Midjourney',
      contentId: contentDoc.id,
      data: {
        ...postData,
        id: contentDoc.id
      }
    });
  } catch (error) {
    logger.error('Error generating content:', {
      message: error.message,
      code: error.code,
      stack: error.stack?.split('\n').slice(0, 3)
    });

    // Log error
    try {
      await db.collection('logs').add({
        type: 'content_generation_error',
        source: 'manual',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    } catch (logError) {
      logger.error('Failed to log error:', logError.message);
    }

    res.status(500).json({
      success: false,
      error: 'Failed to generate content',
      message: error.message,
      details: error.code ? `Error code: ${error.code}` : undefined
    });
  }
};

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
