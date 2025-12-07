/**
 * Content Controller
 * Handles content generation API endpoints
 */

const { db } = require('../config/firebase');
const aiEngine = require('../services/aiEngine');
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
 */
exports.generateContent = async (req, res) => {
  try {
    logger.info('Manual content generation triggered');

    const { category, trendId } = req.body;

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

    // Get random reference image for this category
    logger.info(`Selecting reference image for ${selectedCategory}...`);
    const imageData = await referenceImagesService.getRandomImage(selectedCategory);
    logger.info(`Selected: ${imageData.publicId}`);

    // Build description for caption generation
    const description = buildDescription(imageData);

    // Generate caption with category-specific keyword
    logger.info('Generating caption...');
    let captionData;
    try {
      captionData = await aiEngine.generateCaption({
        type: 'image',
        category: selectedCategory,
        keyword: imageData.keyword,
        description: description,
        trendData: trendData
      });
    } catch (error) {
      logger.error('Error generating caption:', error.message);
      captionData = {
        caption: `Transform your space with our ${imageData.keyword}. Modern design meets functionality.`,
        hashtags: ['#Doors22', '#GlassDoors', '#ModernDesign', '#SouthFlorida'],
        cta: 'Get a free quote at doors22.com/price or call (305) 394-9922'
      };
    }

    // Ensure caption includes keyword
    let finalCaption = captionData.caption || captionData.text;
    if (!finalCaption.toLowerCase().includes(imageData.keyword.toLowerCase())) {
      finalCaption = `${imageData.keyword.charAt(0).toUpperCase() + imageData.keyword.slice(1)} - ${finalCaption}`;
    }

    // Store in Firebase with PENDING status
    const postId = generatePostId();
    const postData = {
      postId: postId,
      date: new Date().toISOString().split('T')[0],
      type: 'image',
      category: selectedCategory,
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
      source: 'manual',
      trendId: trendId || null
    };

    const contentDoc = await db.collection('posts').add(postData);

    logger.info(`Content generated successfully: ${contentDoc.id}`);

    // Log to logs collection
    await db.collection('logs').add({
      type: 'content_generation',
      postId: contentDoc.id,
      category: selectedCategory,
      source: 'manual',
      status: 'success',
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Content generated successfully',
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
    await db.collection('logs').add({
      type: 'content_generation_error',
      source: 'manual',
      error: error.message,
      timestamp: new Date().toISOString()
    });

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
