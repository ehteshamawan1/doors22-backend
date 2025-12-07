/**
 * Midjourney Service
 * Handles interaction with Midjourney via Discord bot
 * - Send image/video generation prompts
 * - Monitor generation completion
 * - Download generated media
 * - Handle rate limiting and errors
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { sleep } = require('../utils/helpers');
const { db } = require('../config/firebase');

class MidjourneyService {
  constructor() {
    this.discordBotUrl = process.env.DISCORD_BOT_URL || 'http://localhost:3002';
    this.midjourneyBotId = process.env.MIDJOURNEY_BOT_ID || '936929561302675456';
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
  }

  /**
   * Send imagine command to Midjourney via Discord bot
   * @param {Object} promptData - Prompt information
   * @param {string} promptData.prompt - Midjourney prompt
   * @param {string} promptData.type - 'image' or 'video'
   * @param {Object} promptData.parameters - Prompt parameters
   * @param {string} promptData.referenceUrl - Optional reference image URL
   * @returns {Promise<Object>} Generation request info
   */
  async sendPrompt(promptData) {
    try {
      logger.info(`Sending ${promptData.type} prompt to Midjourney...`);

      const { prompt, type, parameters, referenceUrl } = promptData;

      // Build full Midjourney command (with optional reference image)
      const fullPrompt = this.buildMidjourneyCommand(prompt, parameters, type, referenceUrl);

      if (referenceUrl) {
        logger.info(`Using reference image: ${referenceUrl}`);
      }

      logger.info(`Full Midjourney command: ${fullPrompt}`);

      // Send to Discord bot
      const response = await axios.post(`${this.discordBotUrl}/api/midjourney/imagine`, {
        prompt: fullPrompt,
        type: type,
        channelId: process.env.DISCORD_CHANNEL_ID
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to send prompt');
      }

      logger.info('Prompt sent successfully, awaiting generation...');

      return {
        requestId: response.data.requestId,
        prompt: fullPrompt,
        type: type,
        status: 'pending',
        sentAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error sending prompt to Midjourney:', {
        message: error.message,
        code: error.code,
        url: this.discordBotUrl
      });

      // If Discord bot is not running, throw clear error
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Discord bot is not reachable at ${this.discordBotUrl}. Please set DISCORD_BOT_URL environment variable to your Railway deployment URL.`);
      }

      throw new Error(`Failed to send Midjourney prompt: ${error.message}`);
    }
  }

  /**
   * Build complete Midjourney command with parameters
   * Supports reference images for image-to-image generation
   * @param {string} basePrompt - Base prompt text
   * @param {Object} parameters - Parameters object
   * @param {string} type - 'image' or 'video'
   * @param {string} referenceUrl - Optional reference image URL (for image-to-image)
   * @returns {string} Complete Midjourney command
   */
  buildMidjourneyCommand(basePrompt, parameters = {}, type = 'image', referenceUrl = null) {
    let command = '';

    // Reference image URL goes at the START of the prompt
    // Format: "{referenceUrl} {prompt} --iw 2 --ar 4:5 --v 6"
    if (referenceUrl) {
      command = `${referenceUrl} ${basePrompt}`;
    } else {
      command = basePrompt;
    }

    // Add image weight (for reference image adherence)
    // --iw ranges from 0.5 to 2, higher = more similar to reference
    if (parameters.iw) {
      command += ` --iw ${parameters.iw}`;
    }

    // Add aspect ratio
    const ar = parameters.ar || (type === 'video' ? '9:16' : '4:5');
    command += ` --ar ${ar}`;

    // Add video flag if needed
    if (type === 'video') {
      command += ' --video';
    }

    // Add style
    if (parameters.style) {
      command += ` --style ${parameters.style}`;
    }

    // Add version
    const version = parameters.version || '6';
    command += ` --v ${version}`;

    // Add quality if specified
    if (parameters.quality) {
      command += ` --q ${parameters.quality}`;
    }

    return command;
  }

  /**
   * Monitor generation progress and wait for completion
   * @param {string} requestId - Generation request ID
   * @param {string} type - 'image' or 'video'
   * @param {number} timeoutMs - Max wait time in milliseconds
   * @returns {Promise<Object>} Generation result
   */
  async waitForCompletion(requestId, type, timeoutMs = 300000) {
    try {
      logger.info(`Monitoring generation progress for ${requestId}...`);

      const startTime = Date.now();
      const pollInterval = type === 'video' ? 10000 : 5000; // Poll every 10s for video, 5s for image

      while (Date.now() - startTime < timeoutMs) {
        try {
          // Check status from Discord bot
          const response = await axios.get(`${this.discordBotUrl}/api/midjourney/status/${requestId}`);

          if (response.data.status === 'completed') {
            logger.info('Generation completed successfully');
            return {
              status: 'completed',
              mediaUrl: response.data.mediaUrl,
              type: type,
              completedAt: new Date().toISOString()
            };
          } else if (response.data.status === 'failed') {
            throw new Error(response.data.error || 'Generation failed');
          }

          // Still pending, wait and check again
          logger.info(`Generation still in progress... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
          await sleep(pollInterval);

        } catch (error) {
          if (error.code === 'ECONNREFUSED') {
            logger.warn('Discord bot not reachable during polling');
            // For development: simulate completion after 10 seconds
            if (Date.now() - startTime > 10000) {
              logger.warn('Returning mock completion data');
              return {
                status: 'completed',
                mediaUrl: `https://via.placeholder.com/${type === 'video' ? '1080x1920' : '1080x1350'}.${type === 'video' ? 'mp4' : 'png'}`,
                type: type,
                completedAt: new Date().toISOString(),
                mock: true
              };
            }
            await sleep(pollInterval);
            continue;
          }
          throw error;
        }
      }

      throw new Error(`Generation timeout after ${timeoutMs / 1000} seconds`);

    } catch (error) {
      logger.error('Error monitoring generation:', error.message);
      throw new Error(`Failed to monitor generation: ${error.message}`);
    }
  }

  /**
   * Download generated media from Midjourney
   * @param {string} mediaUrl - URL of generated media
   * @param {string} type - 'image' or 'video'
   * @returns {Promise<Buffer>} Media file buffer
   */
  async downloadMedia(mediaUrl, type) {
    try {
      logger.info(`Downloading ${type} from Midjourney...`);

      const response = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        timeout: 60000, // 60 second timeout
        maxContentLength: type === 'video' ? 50 * 1024 * 1024 : 10 * 1024 * 1024 // 50MB for video, 10MB for image
      });

      const buffer = Buffer.from(response.data);
      logger.info(`Downloaded ${buffer.length} bytes`);

      return buffer;
    } catch (error) {
      logger.error('Error downloading media:', error.message);
      throw new Error(`Failed to download media: ${error.message}`);
    }
  }

  /**
   * Generate image or video with Midjourney (full workflow)
   * @param {Object} promptData - Prompt information
   * @returns {Promise<Object>} Complete generation result with media buffer
   */
  async generate(promptData) {
    let attempt = 0;

    while (attempt < this.maxRetries) {
      try {
        attempt++;
        logger.info(`Generation attempt ${attempt}/${this.maxRetries}`);

        // Step 1: Send prompt
        const request = await this.sendPrompt(promptData);

        // Step 2: Wait for completion
        const result = await this.waitForCompletion(request.requestId, promptData.type);

        // Step 3: Download media
        const mediaBuffer = await this.downloadMedia(result.mediaUrl, promptData.type);

        // Step 4: Return complete result
        return {
          success: true,
          type: promptData.type,
          prompt: request.prompt,
          mediaUrl: result.mediaUrl,
          mediaBuffer: mediaBuffer,
          requestId: request.requestId,
          generatedAt: result.completedAt,
          fileSize: mediaBuffer.length,
          mock: request.mock || result.mock || false
        };

      } catch (error) {
        logger.error(`Generation attempt ${attempt} failed:`, error.message);

        if (attempt >= this.maxRetries) {
          throw new Error(`Generation failed after ${this.maxRetries} attempts: ${error.message}`);
        }

        logger.info(`Retrying in ${this.retryDelay / 1000} seconds...`);
        await sleep(this.retryDelay);
      }
    }
  }

  /**
   * Get generation status
   * @param {string} requestId - Generation request ID
   * @returns {Promise<Object>} Status information
   */
  async getStatus(requestId) {
    try {
      const response = await axios.get(`${this.discordBotUrl}/api/midjourney/status/${requestId}`);
      return response.data;
    } catch (error) {
      logger.error('Error getting generation status:', error.message);

      if (error.code === 'ECONNREFUSED') {
        return {
          status: 'unknown',
          message: 'Discord bot not reachable'
        };
      }

      throw new Error(`Failed to get status: ${error.message}`);
    }
  }

  /**
   * Cancel generation
   * @param {string} requestId - Generation request ID
   * @returns {Promise<boolean>} Success status
   */
  async cancelGeneration(requestId) {
    try {
      logger.info(`Cancelling generation ${requestId}...`);

      const response = await axios.post(`${this.discordBotUrl}/api/midjourney/cancel`, {
        requestId: requestId
      });

      return response.data.success;
    } catch (error) {
      logger.error('Error cancelling generation:', error.message);
      return false;
    }
  }
}

module.exports = new MidjourneyService();
