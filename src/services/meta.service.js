/**
 * Meta Service
 * Handles posting to Instagram and Facebook via Graph API
 */

const axios = require('axios');
const logger = require('../utils/logger');

class MetaService {
  constructor() {
    this.apiVersion = 'v21.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  /**
   * Get fresh config values (in case env vars were updated)
   */
  getConfig() {
    return {
      accessToken: process.env.META_PAGE_ACCESS_TOKEN,
      pageId: process.env.META_PAGE_ID,
      igUserId: process.env.META_IG_USER_ID
    };
  }

  /**
   * Check if Meta API is configured
   */
  isConfigured() {
    const config = this.getConfig();
    const configured = !!(config.accessToken && config.pageId && config.igUserId);

    if (!configured) {
      logger.warn('Meta API not fully configured:', {
        hasAccessToken: !!config.accessToken,
        hasPageId: !!config.pageId,
        hasIgUserId: !!config.igUserId
      });
    }

    return configured;
  }

  /**
   * Get config status for debugging
   */
  getConfigStatus() {
    const config = this.getConfig();
    return {
      isConfigured: this.isConfigured(),
      hasAccessToken: !!config.accessToken,
      hasPageId: !!config.pageId,
      hasIgUserId: !!config.igUserId,
      pageId: config.pageId ? `${config.pageId.substring(0, 6)}...` : null,
      igUserId: config.igUserId ? `${config.igUserId.substring(0, 6)}...` : null
    };
  }

  /**
   * Post image to Instagram
   * @param {Object} params - Post parameters
   * @param {string} params.imageUrl - Public URL of the image
   * @param {string} params.caption - Post caption with hashtags
   * @returns {Promise<Object>} Post result with media ID
   */
  async postToInstagram(params) {
    const { imageUrl, caption } = params;
    const config = this.getConfig();

    if (!this.isConfigured()) {
      throw new Error('Meta API not configured. Check environment variables.');
    }

    try {
      logger.info('Creating Instagram media container...', {
        igUserId: config.igUserId ? `${config.igUserId.substring(0, 6)}...` : 'NOT SET',
        imageUrl: imageUrl?.substring(0, 50) + '...'
      });

      // Step 1: Create media container
      const containerResponse = await axios.post(
        `${this.baseUrl}/${config.igUserId}/media`,
        null,
        {
          params: {
            image_url: imageUrl,
            caption: caption,
            access_token: config.accessToken
          }
        }
      );

      logger.info('Instagram container response:', JSON.stringify(containerResponse.data));

      const creationId = containerResponse.data.id;
      if (!creationId) {
        throw new Error(`Media container creation failed: ${JSON.stringify(containerResponse.data)}`);
      }
      logger.info(`Media container created: ${creationId}`);

      // Step 2: Wait for container to be ready (check status)
      await this.waitForMediaReady(creationId);

      // Step 3: Publish the media
      logger.info('Publishing Instagram media...');
      const publishResponse = await axios.post(
        `${this.baseUrl}/${config.igUserId}/media_publish`,
        null,
        {
          params: {
            creation_id: creationId,
            access_token: config.accessToken
          }
        }
      );

      const mediaId = publishResponse.data.id;
      logger.info(`Instagram post published: ${mediaId}`);

      return {
        success: true,
        platform: 'instagram',
        mediaId: mediaId,
        creationId: creationId,
        postedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Instagram posting failed:', {
        error: error.response?.data || error.message,
        igUserId: config.igUserId ? `${config.igUserId.substring(0, 6)}...` : 'NOT SET'
      });
      throw new Error(`Instagram post failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Post video/reel to Instagram
   * @param {Object} params - Post parameters
   * @param {string} params.videoUrl - Public URL of the video
   * @param {string} params.caption - Post caption with hashtags
   * @param {string} params.coverUrl - Optional cover image URL
   * @returns {Promise<Object>} Post result with media ID
   */
  async postReelToInstagram(params) {
    const { videoUrl, caption, coverUrl } = params;
    const config = this.getConfig();

    if (!this.isConfigured()) {
      throw new Error('Meta API not configured. Check environment variables.');
    }

    try {
      logger.info('Creating Instagram reel container...', {
        igUserId: config.igUserId ? `${config.igUserId.substring(0, 6)}...` : 'NOT SET'
      });

      // Step 1: Create reel container
      const containerParams = {
        video_url: videoUrl,
        caption: caption,
        media_type: 'REELS',
        access_token: config.accessToken
      };

      if (coverUrl) {
        containerParams.cover_url = coverUrl;
      }

      const containerResponse = await axios.post(
        `${this.baseUrl}/${config.igUserId}/media`,
        null,
        { params: containerParams }
      );

      const creationId = containerResponse.data.id;
      logger.info(`Reel container created: ${creationId}`);

      // Step 2: Wait for video processing (can take longer)
      await this.waitForMediaReady(creationId, 60, 5000); // 60 attempts, 5 second intervals

      // Step 3: Publish the reel
      logger.info('Publishing Instagram reel...');
      const publishResponse = await axios.post(
        `${this.baseUrl}/${config.igUserId}/media_publish`,
        null,
        {
          params: {
            creation_id: creationId,
            access_token: config.accessToken
          }
        }
      );

      const mediaId = publishResponse.data.id;
      logger.info(`Instagram reel published: ${mediaId}`);

      return {
        success: true,
        platform: 'instagram',
        type: 'reel',
        mediaId: mediaId,
        creationId: creationId,
        postedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Instagram reel posting failed:', error.response?.data || error.message);
      throw new Error(`Instagram reel failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Wait for Instagram media container to be ready
   */
  async waitForMediaReady(creationId, maxAttempts = 30, intervalMs = 2000) {
    const config = this.getConfig();

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const statusResponse = await axios.get(
          `${this.baseUrl}/${creationId}`,
          {
            params: {
              fields: 'status_code',
              access_token: config.accessToken
            }
          }
        );

        const status = statusResponse.data.status_code;
        logger.info(`Media container status (attempt ${i + 1}/${maxAttempts}): ${status}`);

        if (status === 'FINISHED') {
          return true;
        }

        if (status === 'ERROR') {
          throw new Error('Media processing failed');
        }

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      } catch (error) {
        if (error.message === 'Media processing failed') {
          throw error;
        }
        logger.warn(`Status check error (attempt ${i + 1}):`, error.message);
        // Continue checking on other errors
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }

    throw new Error('Media processing timeout');
  }

  /**
   * Post to Facebook Page
   * @param {Object} params - Post parameters
   * @param {string} params.mediaUrl - Public URL of the media
   * @param {string} params.caption - Post caption
   * @param {string} params.mediaType - 'image' or 'video'
   * @returns {Promise<Object>} Post result with post ID
   */
  async postToFacebook(params) {
    const { mediaUrl, caption, mediaType = 'image' } = params;
    const config = this.getConfig();

    if (!this.isConfigured()) {
      throw new Error('Meta API not configured. Check environment variables.');
    }

    try {
      let response;

      if (mediaType === 'video') {
        // Post video
        logger.info('Posting video to Facebook...', {
          pageId: config.pageId ? `${config.pageId.substring(0, 6)}...` : 'NOT SET'
        });
        response = await axios.post(
          `${this.baseUrl}/${config.pageId}/videos`,
          null,
          {
            params: {
              file_url: mediaUrl,
              description: caption,
              access_token: config.accessToken
            }
          }
        );
      } else {
        // Post image
        logger.info('Posting image to Facebook...', {
          pageId: config.pageId ? `${config.pageId.substring(0, 6)}...` : 'NOT SET'
        });
        response = await axios.post(
          `${this.baseUrl}/${config.pageId}/photos`,
          null,
          {
            params: {
              url: mediaUrl,
              caption: caption,
              access_token: config.accessToken
            }
          }
        );
      }

      const postId = response.data.id || response.data.post_id;
      logger.info(`Facebook post published: ${postId}`);

      return {
        success: true,
        platform: 'facebook',
        postId: postId,
        postedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Facebook posting failed:', error.response?.data || error.message);
      throw new Error(`Facebook post failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Post to both Instagram and Facebook
   * @param {Object} params - Post parameters
   * @returns {Promise<Object>} Results from both platforms
   */
  async postToBothPlatforms(params) {
    const { mediaUrl, caption, mediaType = 'image' } = params;

    const results = {
      instagram: null,
      facebook: null,
      errors: []
    };

    // Post to Instagram
    try {
      if (mediaType === 'video') {
        results.instagram = await this.postReelToInstagram({
          videoUrl: mediaUrl,
          caption: caption
        });
      } else {
        results.instagram = await this.postToInstagram({
          imageUrl: mediaUrl,
          caption: caption
        });
      }
    } catch (error) {
      logger.error('Instagram post failed:', error.message);
      results.errors.push({ platform: 'instagram', error: error.message });
    }

    // Post to Facebook
    try {
      results.facebook = await this.postToFacebook({
        mediaUrl: mediaUrl,
        caption: caption,
        mediaType: mediaType
      });
    } catch (error) {
      logger.error('Facebook post failed:', error.message);
      results.errors.push({ platform: 'facebook', error: error.message });
    }

    // Determine overall success
    results.success = results.instagram !== null || results.facebook !== null;
    results.partialSuccess = results.errors.length > 0 && results.success;

    return results;
  }

  /**
   * Reply to a comment on Instagram
   * @param {string} commentId - Comment ID to reply to
   * @param {string} message - Reply message
   */
  async replyToInstagramComment(commentId, message) {
    const config = this.getConfig();

    if (!this.isConfigured()) {
      throw new Error('Meta API not configured');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/${commentId}/replies`,
        null,
        {
          params: {
            message: message,
            access_token: config.accessToken
          }
        }
      );

      logger.info(`Replied to Instagram comment: ${commentId}`);
      return {
        success: true,
        replyId: response.data.id
      };
    } catch (error) {
      logger.error('Instagram reply failed:', error.response?.data || error.message);
      throw new Error(`Reply failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Reply to a Facebook comment
   * @param {string} commentId - Comment ID to reply to
   * @param {string} message - Reply message
   */
  async replyToFacebookComment(commentId, message) {
    const config = this.getConfig();

    if (!this.isConfigured()) {
      throw new Error('Meta API not configured');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/${commentId}/comments`,
        null,
        {
          params: {
            message: message,
            access_token: config.accessToken
          }
        }
      );

      logger.info(`Replied to Facebook comment: ${commentId}`);
      return {
        success: true,
        replyId: response.data.id
      };
    } catch (error) {
      logger.error('Facebook reply failed:', error.response?.data || error.message);
      throw new Error(`Reply failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Send Instagram DM reply
   * @param {string} userId - User ID to send message to
   * @param {string} message - Message text
   */
  async sendInstagramDM(userId, message) {
    const config = this.getConfig();

    if (!this.isConfigured()) {
      throw new Error('Meta API not configured');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/${config.igUserId}/messages`,
        null,
        {
          params: {
            recipient: JSON.stringify({ id: userId }),
            message: JSON.stringify({ text: message }),
            access_token: config.accessToken
          }
        }
      );

      logger.info(`Sent Instagram DM to: ${userId}`);
      return {
        success: true,
        messageId: response.data.message_id
      };
    } catch (error) {
      logger.error('Instagram DM failed:', error.response?.data || error.message);
      throw new Error(`DM failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Send Facebook Messenger reply
   * @param {string} userId - User ID to send message to
   * @param {string} message - Message text
   */
  async sendFacebookMessage(userId, message) {
    const config = this.getConfig();

    if (!this.isConfigured()) {
      throw new Error('Meta API not configured');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/${config.pageId}/messages`,
        null,
        {
          params: {
            recipient: JSON.stringify({ id: userId }),
            message: JSON.stringify({ text: message }),
            access_token: config.accessToken
          }
        }
      );

      logger.info(`Sent Facebook message to: ${userId}`);
      return {
        success: true,
        messageId: response.data.message_id
      };
    } catch (error) {
      logger.error('Facebook message failed:', error.response?.data || error.message);
      throw new Error(`Message failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }
}

module.exports = new MetaService();
