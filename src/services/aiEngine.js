/**
 * AI Engine Service
 * Handles all AI-powered operations using OpenAI GPT-4o-mini
 * - Trend analysis (images + videos/reels)
 * - Caption generation (format-specific)
 * - Hashtag generation
 * - Midjourney prompt creation
 * - Comment/DM response generation
 */

const openai = require('../config/openai');
const logger = require('../utils/logger');
const { db } = require('../config/firebase');

class AIEngineService {
  /**
   * Analyze market trends for glass doors/partitions industry
   * Identifies trending topics, hashtags, content styles for both images and videos
   * @param {Object} options - Analysis options
   * @param {boolean} options.includeVideos - Whether to analyze video trends (default: true)
   * @returns {Promise<Object>} Trend analysis results
   */
  async analyzeTrends(options = { includeVideos: true }) {
    try {
      logger.info('Starting trend analysis...');

      const prompt = `You are a social media expert analyzing trends for a glass doors and partitions company (Doors22).

Analyze current trends for ${options.includeVideos ? 'both images AND reels/videos' : 'images only'} in the following areas:
1. Top performing hashtags for glass doors, office partitions, and interior design
2. Popular post styles (before/after, product showcase, installation videos, etc.)
3. Caption tone and style (professional, inspirational, educational)
4. ${options.includeVideos ? 'Video trends: reel styles, transitions, effects, popular video concepts' : ''}
5. Trending topics in commercial interior design
6. Competitor content patterns

Return a JSON object with this structure:
{
  "date": "YYYY-MM-DD",
  "topHashtags": ["#GlassPartitions", "#ModernOffice", ...],
  "imagePostStyles": ["BeforeAfter", "ProductShowcase", ...],
  ${options.includeVideos ? '"videoPostStyles": ["TimelapseInstall", "SlidingTransition", "360View", ...],\n  "reelTrends": ["Short transitions", "Text overlays", "Before/after reveals", ...],' : ''}
  "captionTone": "professional-inspirational",
  "trendingTopics": ["Sustainable office design", "Glass partitions for home offices", ...],
  "contentMix": {
    "images": 70,
    "videos": 30
  },
  "competitorInsights": {
    "commonThemes": ["Installation process", "Design versatility", ...],
    "avgEngagement": "3-5%"
  }
}

Provide actionable insights for creating engaging content.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a social media marketing expert specializing in B2B commercial design and construction industries.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1500,
        response_format: { type: 'json_object' }
      });

      const trends = JSON.parse(response.choices[0].message.content);
      logger.info('Trend analysis completed successfully');

      return trends;
    } catch (error) {
      logger.error('Error analyzing trends:', {
        message: error.message,
        code: error.code,
        type: error.type,
        status: error.status,
        stack: error.stack
      });
      throw new Error(`Trend analysis failed: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Generate caption and hashtags for a post
   * @param {Object} contentData - Content information
   * @param {string} contentData.type - 'image' or 'video'
   * @param {string} contentData.description - Content description
   * @param {string} contentData.category - Product category (room_dividers, closet_doors, home_offices)
   * @param {string} contentData.keyword - Required SEO keyword to include
   * @param {Object} contentData.trendData - Trend analysis data
   * @returns {Promise<Object>} Generated caption and hashtags
   */
  async generateCaption(contentData) {
    try {
      logger.info(`Generating caption for ${contentData.type}...`);

      const { type, description, trendData, concept, category, keyword } = contentData;
      const contentDescription = description || concept || 'Glass doors and partitions installation';

      // Determine required keyword based on category
      const requiredKeyword = keyword || this.getCategoryKeyword(category);

      if (requiredKeyword) {
        logger.info(`Required keyword: "${requiredKeyword}"`);
      }

      const keywordInstruction = requiredKeyword
        ? `\n\n**CRITICAL REQUIREMENT:**
The caption MUST naturally include the exact phrase: "${requiredKeyword}"
This is a required SEO keyword that must appear in the caption text.`
        : '';

      const prompt = `Create an engaging ${type === 'video' ? 'reel/video' : 'image'} caption for Instagram and Facebook for Doors22, a glass doors and partitions company.

Content: ${contentDescription}${keywordInstruction}

Requirements:
- ${type === 'video' ? '40-60 characters' : '120-150 characters'} main caption (engaging hook)
- Professional yet approachable tone
${requiredKeyword ? `- MUST include the exact phrase: "${requiredKeyword}"` : ''}
- Include a clear call-to-action
- Mention key benefits (elegance, functionality, modern design)
- ${type === 'video' ? 'Video-specific language (watch, see, discover)' : ''}

Business Info:
- Website: https://doors22.com
- Quote Form: https://doors22.com/price/
- Phone: (305) 394-9922
- Service Area: South Florida

Trending context:
- Top hashtags: ${trendData?.topHashtags?.slice(0, 5).join(', ') || '#GlassPartitions, #ModernOffice'}
- Tone: ${trendData?.captionTone || 'professional-inspirational'}

Return JSON:
{
  "caption": "Main engaging caption text that INCLUDES '${requiredKeyword || 'glass doors'}'",
  "hashtags": ["#GlassPartitions", "#OfficeDesign", ...], (8-12 diverse hashtags, vary each time)
  "cta": "Call-to-action text like 'Get your free quote at doors22.com/price or call (305) 394-9922'",
  "fullPost": "Complete post with caption + hashtags + CTA combined"
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a professional social media copywriter specializing in B2B commercial design content. ALWAYS include the required keyword phrase exactly as specified in the caption.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      });

      const captionData = JSON.parse(response.choices[0].message.content);

      // Verify keyword is included (fallback if AI missed it)
      const caption = captionData.caption || captionData.text;
      if (requiredKeyword && caption && !caption.toLowerCase().includes(requiredKeyword.toLowerCase())) {
        logger.warn('AI did not include required keyword, prepending...');
        captionData.caption = `${requiredKeyword.charAt(0).toUpperCase() + requiredKeyword.slice(1)} - ${caption}`;
      }

      logger.info('Caption generated successfully');

      return captionData;
    } catch (error) {
      logger.error('Error generating caption:', error.message);
      throw new Error(`Caption generation failed: ${error.message}`);
    }
  }

  /**
   * Get the required keyword for a category
   * @param {string} category - Category key
   * @returns {string|null} Required keyword
   */
  getCategoryKeyword(category) {
    const keywords = {
      'room_dividers': 'sliding glass room divider',
      'closet_doors': 'sliding glass closet door',
      'home_offices': 'sliding glass home office',
      'office_partitions': 'corporate glass partitions'
    };
    return keywords[category] || null;
  }

  /**
   * Generate Midjourney prompt for image or video
   * Supports reference images for image-to-image generation
   * @param {Object} options - Generation options
   * @param {string} options.type - 'image' or 'video'
   * @param {Object} options.trendData - Trend analysis data
   * @param {string} options.concept - Specific concept (optional)
   * @param {string} options.category - Product category (room_dividers, closet_doors, home_offices)
   * @param {string} options.keyword - SEO keyword for the category
   * @param {string} options.referenceUrl - Reference image URL for image-to-image
   * @param {string} options.description - Description of the reference image
   * @returns {Promise<Object>} Midjourney prompt and metadata
   */
  async generateMidjourneyPrompt(options) {
    try {
      logger.info(`Generating Midjourney prompt for ${options.type}...`);

      const { type, trendData, concept, category, keyword, referenceUrl, description } = options;

      // Build context about what we're generating
      const productContext = description || concept || 'Glass doors and partitions';
      const categoryName = category ? this.getCategoryDisplayName(category) : 'glass doors';

      // Category-specific setting context
      let settingContext = 'Modern commercial office or residential space';
      let additionalContext = '';

      if (category === 'home_offices') {
        settingContext = 'Cozy residential HOME OFFICE space';
        additionalContext = `
CRITICAL HOME OFFICE REQUIREMENTS:
- Setting: Inside a HOUSE or APARTMENT, NOT a commercial building
- Space: Small personal workspace area, NOT an open floor plan or cubicle farm
- Furniture: Residential home furniture (desk in corner of room, near window)
- Environment: Cozy, warm, personal - include plants, books, personal items, home decor
- Background: Visible home elements (living room, bedroom area, residential windows with natural light)
- Scale: Single person workspace, intimate and personal setting
- Style: Warm residential interior design, NOT sterile corporate aesthetic
- DO NOT show: Large office buildings, multiple workstations, corporate environments, fluorescent lighting, cubicle farms`;
      } else if (category === 'office_partitions') {
        settingContext = 'Professional corporate office or commercial workspace';
        additionalContext = `
CRITICAL OFFICE PARTITIONS REQUIREMENTS:
- Setting: Inside a CORPORATE OFFICE or COMMERCIAL BUILDING
- Space: Open floor plan, modern office environment, cubicle areas, conference rooms
- Furniture: Commercial office furniture (workstations, meeting tables, office chairs)
- Environment: Professional, clean, corporate aesthetic - modern office design
- Background: Corporate office elements (multiple workstations, office lighting, commercial flooring)
- Scale: Multi-person workspace, professional commercial setting
- Style: Contemporary corporate interior design, professional atmosphere
- Include: Glass partitions creating private workspaces, meeting rooms, or collaborative areas
- DO NOT show: Residential elements, home furniture, cozy personal spaces`;
      }

      // Bottom track rail is CRITICAL for all categories
      const bottomTrackInstruction = `
CRITICAL PRODUCT REQUIREMENT - APPLIES TO ALL CATEGORIES:
- The sliding glass doors/partitions MUST be mounted on a BOTTOM TRACK RAIL system
- The floor-mounted track rail must be CLEARLY VISIBLE in the image
- This is how the product actually works - it slides on a track on the floor
- DO NOT show ceiling-hung or frameless systems
- The bottom track is a key feature that must be shown`;

      const prompt = `Create a detailed Midjourney prompt for a high-quality professional photograph showcasing ${categoryName} for Doors22.

${referenceUrl ? `IMPORTANT: This prompt will be used with a REFERENCE IMAGE for image-to-image generation.
The reference image shows: ${productContext}
The generated image should maintain the same product style, frame colors, and glass type while creating a fresh, professional setting.` : ''}

${concept ? `Specific concept: ${concept}` : ''}

Product Details: ${productContext}
${keyword ? `Key product: ${keyword}` : ''}
${bottomTrackInstruction}
${additionalContext}

Trending styles: ${trendData?.imagePostStyles?.join(', ') || 'Professional photography, before/after, modern office spaces'}

IMPORTANT: This prompt is for generating a STATIC IMAGE (professional photograph).
${type === 'video' ? 'Note: This image will later be used as a base frame for video generation, but the prompt itself should describe a static photograph, NOT a video or motion.' : ''}

Requirements:
- High-quality professional photography style
- ${settingContext}
- Natural lighting emphasis
- Clean, minimalist aesthetic
- Professional composition with the ${keyword || 'glass doors/partitions'} as the focal point
- Maintain product authenticity (same frame style, glass type as reference)
- **CRITICAL: Product MUST show bottom track rail system** (sliding doors on floor-mounted track)
- Bottom track clearly visible on the floor
- NO motion, animation, or video-related descriptions
- Aspect ratio: ${type === 'video' ? '9:16 (vertical for video)' : '4:5 (Instagram feed optimized)'}

Return JSON:
{
  "prompt": "Complete Midjourney prompt describing the scene and product (DO NOT include the reference URL - that will be added separately)",
  "concept": "Brief description of the concept",
  "style": "modern-professional|elegant-minimalist|industrial-chic",
  "parameters": {
    "ar": "${type === 'video' ? '9:16' : '4:5'}",
    "version": "6",
    "style": "raw"
  },
  "tags": ["keyword1", "keyword2", ...]
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert in creating Midjourney prompts for professional commercial design photography. When a reference image is provided, create prompts that complement the reference while generating fresh, professional settings.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.9,
        max_tokens: 600,
        response_format: { type: 'json_object' }
      });

      const promptData = JSON.parse(response.choices[0].message.content);

      // Add reference URL to the returned data (will be used by midjourney.service.js)
      if (referenceUrl) {
        promptData.referenceUrl = referenceUrl;
      }

      // Add category and keyword
      if (category) promptData.category = category;
      if (keyword) promptData.keyword = keyword;

      logger.info('Midjourney prompt generated successfully');

      return promptData;
    } catch (error) {
      logger.error('Error generating Midjourney prompt:', error.message);
      throw new Error(`Midjourney prompt generation failed: ${error.message}`);
    }
  }

  /**
   * Get display name for a category
   * @param {string} category - Category key
   * @returns {string} Display name
   */
  getCategoryDisplayName(category) {
    const names = {
      'room_dividers': 'Room Dividers',
      'closet_doors': 'Closet Doors',
      'home_offices': 'Home Offices',
      'office_partitions': 'Office Partitions'
    };
    return names[category] || 'Glass Doors';
  }

  /**
   * Generate response to a comment or DM
   * ALL responses MUST include phone (305) 394-9922 and quote link https://doors22.com/price/
   * @param {Object} messageData - Message information
   * @param {string} messageData.message - User's message
   * @param {string} messageData.platform - 'instagram' or 'facebook'
   * @param {string} messageData.type - 'comment' or 'dm'
   * @returns {Promise<Object>} Response and classification
   */
  async generateResponse(messageData) {
    try {
      logger.info(`Generating response for ${messageData.type} on ${messageData.platform}...`);

      const { message, platform, type } = messageData;

      const prompt = `You are a customer service representative for Doors22, a glass doors and partitions company.

User ${type}: "${message}"

Classify the message and provide an appropriate response:

Categories:
- price_inquiry: Asking about costs/pricing
- technical_question: Installation, materials, specifications
- service_area: Location/service availability
- compliment: Positive feedback
- complaint: Negative feedback/issues
- general_inquiry: General questions

**CRITICAL REQUIREMENT:**
EVERY response MUST include BOTH:
1. Free quote link: https://doors22.com/price/
2. Phone number: (305) 394-9922

This is mandatory for ALL responses, regardless of category.

Requirements:
- Professional but friendly tone
- Keep responses under 300 characters
- ALWAYS include the quote link and phone number
- Mention "We ship nationwide across the US!"

Example format:
"Thank you for reaching out! [Your relevant response]. Get a free quote: https://doors22.com/price/ or call (305) 394-9922. We ship nationwide across the US!"

Return JSON:
{
  "category": "category_name",
  "response": "Your response text (MUST include https://doors22.com/price/ AND (305) 394-9922)",
  "shouldRedirect": true,
  "redirectUrl": "https://doors22.com/price/",
  "priority": "high|medium|low",
  "requiresHumanFollowup": false
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful, professional customer service AI for Doors22. ALWAYS include the quote link https://doors22.com/price/ and phone (305) 394-9922 in every response.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      });

      const responseData = JSON.parse(response.choices[0].message.content);

      // Verify response includes required contact info, add if missing
      if (responseData.response) {
        const hasQuoteLink = responseData.response.includes('doors22.com/price');
        const hasPhone = responseData.response.includes('(305) 394-9922') || responseData.response.includes('305-394-9922');

        if (!hasQuoteLink || !hasPhone) {
          logger.warn('AI response missing required contact info, appending...');
          const suffix = '\n\nGet a free quote: https://doors22.com/price/ or call (305) 394-9922';
          responseData.response = responseData.response.trim() + suffix;
        }
      }

      logger.info('Response generated successfully');

      return responseData;
    } catch (error) {
      logger.error('Error generating response:', error.message);
      throw new Error(`Response generation failed: ${error.message}`);
    }
  }

  /**
   * Generate content concept (determines what to create)
   * @param {Object} trendData - Current trend data
   * @returns {Promise<Object>} Content concept with type (image/video)
   */
  async generateContentConcept(trendData) {
    try {
      logger.info('Generating content concept...');

      // Determine content type based on mix (70% images, 30% videos)
      const contentMix = trendData?.contentMix || { images: 70, videos: 30 };
      const random = Math.random() * 100;
      const contentType = random < contentMix.images ? 'image' : 'video';

      const prompt = `Based on current trends, generate a specific content concept for Doors22's ${contentType} post.

Trending topics: ${trendData?.trendingTopics?.join(', ') || 'Modern office design, glass partitions'}
Popular ${contentType} styles: ${contentType === 'video'
  ? trendData?.videoPostStyles?.join(', ') || 'Installation timelapses, smooth transitions'
  : trendData?.imagePostStyles?.join(', ') || 'Before/after, product showcase'
}

Generate a specific, creative concept that:
- Showcases glass doors or partitions
- Aligns with trending styles
- Is suitable for ${contentType} format
- Appeals to commercial clients

Return JSON:
{
  "type": "${contentType}",
  "concept": "Detailed concept description",
  "setting": "office|residential|commercial|mixed",
  "mood": "professional|inspirational|luxurious|modern",
  "keyElements": ["element1", "element2", ...],
  "estimatedEngagement": "high|medium|low"
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a creative director specializing in commercial design content.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.9,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      });

      const conceptData = JSON.parse(response.choices[0].message.content);
      logger.info(`Content concept generated: ${conceptData.type}`);

      return conceptData;
    } catch (error) {
      logger.error('Error generating content concept:', error.message);
      throw new Error(`Content concept generation failed: ${error.message}`);
    }
  }

  /**
   * Generate AI response for interaction (alias for generateResponse)
   * @param {Object} params - Parameters
   * @returns {Promise<Object>} Response data
   */
  async generateInteractionResponse(params) {
    try {
      const result = await this.generateResponse({
        message: params.message,
        platform: params.platform,
        type: params.type
      });

      return {
        response: result.response,
        category: result.category,
        redirected: result.shouldRedirect
      };
    } catch (error) {
      logger.error('Error generating interaction response:', error.message);
      throw error;
    }
  }
}

module.exports = new AIEngineService();
