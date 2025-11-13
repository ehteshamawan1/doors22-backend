/**
 * Content Controller
 * Handles content generation API endpoints
 */

const { db } = require('../config/firebase');
const aiEngine = require('../services/aiEngine');
const midjourneyService = require('../services/midjourney.service');
const cloudinaryService = require('../services/cloudinary.service');
const logger = require('../utils/logger');

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
 * POST /api/content/generate
 * Manually trigger content generation
 */
exports.generateContent = async (req, res) => {
  try {
    logger.info('Manual content generation triggered');

    const { type, concept, trendId } = req.body;

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

    // Generate content concept if not provided
    const contentConcept = concept || await aiEngine.generateContentConcept(trendData);

    // Determine content type (image or video)
    const contentType = type || contentConcept.type || 'image';

    // Generate Midjourney prompt
    const midjourneyPromptData = await aiEngine.generateMidjourneyPrompt({
      type: contentType,
      trendData,
      concept: contentConcept
    });

    logger.info(`Generated ${contentType} prompt:`, midjourneyPromptData);

    // Generate media with Midjourney
    logger.info(`Generating ${contentType} with Midjourney...`);
    const mediaResult = await midjourneyService.generate({
      prompt: midjourneyPromptData.prompt,
      type: contentType,
      parameters: midjourneyPromptData.parameters || { ar: contentType === 'video' ? '9:16' : '4:5' }
    });

    if (!mediaResult.success) {
      throw new Error('Midjourney generation failed: ' + mediaResult.error);
    }

    // Upload to Cloudinary
    logger.info('Uploading to Cloudinary...');
    const uploadResult = await cloudinaryService.uploadMedia(
      mediaResult.mediaBuffer,
      {
        type: contentType,
        folder: `doors22/${new Date().toISOString().split('T')[0]}/${contentType}s`
      }
    );

    // Generate caption
    logger.info('Generating caption...');
    let caption;
    try {
      caption = await aiEngine.generateCaption({
        type: contentType,
        trendData,
        concept: contentConcept,
        description: midjourneyPromptData.prompt // Use the Midjourney prompt as context
      });
    } catch (error) {
      logger.error('Error generating caption:', error.message);
      caption = {
        text: 'Professional glass door installation showcasing modern design.',
        hashtags: ['#Doors22', '#GlassDoors', '#ModernDesign'],
        cta: 'Contact us for your glass door needs!'
      };
    }

    // Store in Firebase
    const contentData = {
      type: contentType,
      mediaUrl: uploadResult.url,
      thumbnailUrl: uploadResult.thumbnailUrl || uploadResult.url,
      midjourneyPrompt: midjourneyPromptData.prompt,
      midjourneyPromptFull: midjourneyPromptData,
      caption: caption?.text || 'Professional glass door installation.',
      hashtags: caption?.hashtags || ['#Doors22', '#GlassDoors'],
      cta: caption?.cta || 'Contact us today!',
      createdAt: new Date().toISOString(),
      status: 'pending',
      cloudinaryPublicId: uploadResult.publicId,
      format: uploadResult.format,
      fileSize: uploadResult.fileSize,
      duration: uploadResult.duration || null,
      aspectRatio: contentType === 'video' ? '9:16' : '4:5',
      trendId: trendId || null
    };

    const contentDoc = await db.collection('posts').add(contentData);

    logger.info(`Content generated successfully: ${contentDoc.id}`);

    res.json({
      success: true,
      message: 'Content generated successfully',
      contentId: contentDoc.id,
      data: {
        ...contentData,
        id: contentDoc.id
      }
    });
  } catch (error) {
    logger.error('Error generating content:', {
      message: error.message,
      code: error.code,
      stack: error.stack?.split('\n').slice(0, 3)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to generate content',
      message: error.message,
      details: error.code ? `Error code: ${error.code}` : undefined
    });
  }
};
