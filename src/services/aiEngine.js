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
   * @param {Object} contentData.trendData - Trend analysis data
   * @returns {Promise<Object>} Generated caption and hashtags
   */
  async generateCaption(contentData) {
    try {
      logger.info(`Generating caption for ${contentData.type}...`);

      const { type, description, trendData, concept } = contentData;
      const contentDescription = description || concept || 'Glass doors and partitions installation';

      const prompt = `Create an engaging ${type === 'video' ? 'reel/video' : 'image'} caption for Instagram and Facebook for Doors22, a glass doors and partitions company.

Content: ${contentDescription}

Requirements:
- ${type === 'video' ? '40-60 characters' : '120-150 characters'} main caption (engaging hook)
- Professional yet approachable tone
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
  "text": "Main engaging caption text (the actual caption to post)",
  "hashtags": ["#GlassPartitions", "#OfficeDesign", ...], (8-12 diverse hashtags, vary each time)
  "cta": "Call-to-action text like 'Get your free quote at doors22.com/price or call (305) 394-9922'"
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a professional social media copywriter specializing in B2B commercial design content.'
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
      logger.info('Caption generated successfully');

      return captionData;
    } catch (error) {
      logger.error('Error generating caption:', error.message);
      throw new Error(`Caption generation failed: ${error.message}`);
    }
  }

  /**
   * Generate Midjourney prompt for image or video
   * @param {Object} options - Generation options
   * @param {string} options.type - 'image' or 'video'
   * @param {Object} options.trendData - Trend analysis data
   * @param {string} options.concept - Specific concept (optional)
   * @returns {Promise<Object>} Midjourney prompt and metadata
   */
  async generateMidjourneyPrompt(options) {
    try {
      logger.info(`Generating Midjourney prompt for ${options.type}...`);

      const { type, trendData, concept } = options;

      const prompt = `Create a detailed Midjourney prompt for a high-quality professional photograph showcasing glass doors or partitions for Doors22.

${concept ? `Specific concept: ${concept}` : ''}

Trending styles: ${trendData?.imagePostStyles?.join(', ') || 'Professional photography, before/after, modern office spaces'}

IMPORTANT: This prompt is for generating a STATIC IMAGE (professional photograph).
${type === 'video' ? 'Note: This image will later be used as a base frame for video generation, but the prompt itself should describe a static photograph, NOT a video or motion.' : ''}

Requirements:
- High-quality professional photography style
- Modern commercial office or residential space
- Natural lighting emphasis
- Clean, minimalist aesthetic
- Professional composition with glass doors/partitions as the focal point
- NO motion, animation, or video-related descriptions
- Aspect ratio: 4:5 (${type === 'video' ? 'will be adjusted for video later' : 'Instagram feed optimized'})

Return JSON:
{
  "prompt": "Complete Midjourney prompt with all parameters (for a STATIC photograph, no video/motion language)",
  "concept": "Brief description of the concept",
  "style": "modern-professional|elegant-minimalist|industrial-chic",
  "parameters": {
    "ar": "4:5",
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
            content: 'You are an expert in creating Midjourney prompts for professional commercial design photography and videography.'
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
      logger.info('Midjourney prompt generated successfully');

      return promptData;
    } catch (error) {
      logger.error('Error generating Midjourney prompt:', error.message);
      throw new Error(`Midjourney prompt generation failed: ${error.message}`);
    }
  }

  /**
   * Generate response to a comment or DM
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

Requirements:
- Professional but friendly tone
- Keep responses under 280 characters
- Include CTA when appropriate
- For price inquiries: Direct to https://doors22.com/price/ or call (305) 394-9922
- For service area: Mention "South Florida" coverage

Return JSON:
{
  "category": "category_name",
  "response": "Your response text here",
  "shouldRedirect": true/false,
  "redirectUrl": "URL if applicable",
  "priority": "high|medium|low",
  "requiresHumanFollowup": true/false
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful, professional customer service AI for a commercial glass doors company.'
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
}

module.exports = new AIEngineService();
