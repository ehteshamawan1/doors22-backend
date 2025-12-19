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

      const { prompt, type, parameters, referenceUrl, manualUpscale } = promptData;

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
        channelId: process.env.DISCORD_CHANNEL_ID,
        manualUpscale: Boolean(manualUpscale)
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
   * NOTE: For video generation, we first generate an image, then upscale, then animate
   *       The --video flag is NOT used - that's for recording the generation process
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
    // For video, we use 9:16 (vertical) but generate as image first
    const ar = parameters.ar || (type === 'video' ? '9:16' : '4:5');
    command += ` --ar ${ar}`;

    // NOTE: We don't add --video flag here anymore
    // Video generation uses a different workflow: image → upscale → animate → select

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
              messageId: response.data.messageId,
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

  /**
   * Generate video using the 4-step Midjourney workflow:
   * 1. Generate image grid
   * 2. Upscale one image (U1)
   * 3. Animate the upscaled image → returns 4 video options
   * 4. Select one video
   *
   * @param {Object} promptData - Prompt information
   * @returns {Promise<Object>} Complete video generation result with media buffer
   */
  async generateVideo(promptData) {
    let attempt = 0;

    while (attempt < this.maxRetries) {
      try {
        attempt++;
        logger.info(`Video generation attempt ${attempt}/${this.maxRetries}`);

        // Step 1: Generate image grid (same as image, no --video flag)
        logger.info('Step 1: Generating image grid...');
        const imagePromptData = {
          ...promptData,
          type: 'image',
          manualUpscale: true // Let backend handle upscale + animate workflow
        };
        const imageRequest = await this.sendPrompt(imagePromptData);

        // Step 2: Wait for image grid completion
        logger.info('Step 2: Waiting for image grid...');
        const gridResult = await this.waitForCompletion(imageRequest.requestId, 'image');

        // Step 3: Click upscale button (U1) to get single high-res image
        logger.info('Step 3: Upscaling image (U1)...');
        const upscaleResult = await this.clickButton(gridResult.messageId, 'U1', 'image');

        // Step 4: Wait for upscaled image
        logger.info('Step 4: Waiting for upscaled image...');
        const upscaledImage = await this.waitForUpscaleCompletion(upscaleResult.requestId);

        // Step 5: Trigger animate on upscaled image → returns 4 video options
        logger.info('Step 5: Animating image...');
        const animateResult = await this.clickAnimateButton(upscaledImage.messageId);

        // Step 6: Wait for animation to complete (returns 4 videos)
        logger.info('Step 6: Waiting for video options...');
        const videoGrid = await this.waitForAnimateCompletion(animateResult.requestId);

        // Step 7: Select one of the 4 videos (first one)
        logger.info('Step 7: Selecting video...');
        const selectResult = await this.clickButtonWithFallback(
          videoGrid.messageId,
          ['1', 'V1'],
          'video'
        );

        // Step 8: Wait for final video
        logger.info('Step 8: Waiting for final video...');
        const finalVideo = await this.waitForVideoCompletion(selectResult.requestId);

        // Step 9: Download the video
        logger.info('Step 9: Downloading video...');
        const mediaBuffer = await this.downloadMedia(finalVideo.mediaUrl, 'video');

        logger.info(`Video generation completed successfully (${(mediaBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

        return {
          success: true,
          type: 'video',
          prompt: imageRequest.prompt,
          mediaUrl: finalVideo.mediaUrl,
          mediaBuffer: mediaBuffer,
          requestId: imageRequest.requestId,
          generatedAt: new Date().toISOString(),
          fileSize: mediaBuffer.length,
          mock: false
        };

      } catch (error) {
        logger.error(`Video generation attempt ${attempt} failed:`, error.message);

        if (attempt >= this.maxRetries) {
          throw new Error(`Video generation failed after ${this.maxRetries} attempts: ${error.message}`);
        }

        logger.info(`Retrying in ${this.retryDelay / 1000} seconds...`);
        await sleep(this.retryDelay);
      }
    }
  }

  /**
   * Click a button on a Midjourney message (U1-U4, V1-V4, etc.)
   * @param {string} messageId - Discord message ID
   * @param {string} buttonId - Button identifier (U1, U2, U3, U4, V1, etc.)
   * @returns {Promise<Object>} Button click result
   */
  async clickButton(messageId, buttonId, expectedType) {
    try {
      logger.info(`Clicking button ${buttonId} on message ${messageId}...`);

      const response = await axios.post(`${this.discordBotUrl}/api/midjourney/button`, {
        messageId: messageId,
        buttonId: buttonId,
        channelId: process.env.DISCORD_CHANNEL_ID,
        expectedType: expectedType
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to click button');
      }

      logger.info(`Button ${buttonId} clicked successfully`);

      return {
        requestId: response.data.requestId,
        messageId: messageId,
        buttonId: buttonId,
        status: 'pending'
      };
    } catch (error) {
      const apiError = error.response?.data?.error;
      const message = apiError || error.message;
      logger.error(`Error clicking button ${buttonId}:`, message);
      throw new Error(`Failed to click button: ${message}`);
    }
  }

  /**
   * Try multiple button IDs until one succeeds
   * @param {string} messageId - Discord message ID
   * @param {string[]} buttonIds - Candidate button identifiers
   * @param {string} expectedType - Expected media type after click
   * @returns {Promise<Object>} Button click result
   */
  async clickButtonWithFallback(messageId, buttonIds, expectedType) {
    let lastError;

    for (const buttonId of buttonIds) {
      try {
        return await this.clickButton(messageId, buttonId, expectedType);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  /**
   * Click the animate button on an upscaled image
   * @param {string} messageId - Discord message ID of the upscaled image
   * @returns {Promise<Object>} Animation request result
   */
  async clickAnimateButton(messageId) {
    try {
      logger.info(`Triggering animate on message ${messageId}...`);

      const response = await axios.post(`${this.discordBotUrl}/api/midjourney/animate`, {
        messageId: messageId,
        channelId: process.env.DISCORD_CHANNEL_ID
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to trigger animate');
      }

      logger.info('Animate triggered successfully');

      return {
        requestId: response.data.requestId,
        messageId: messageId,
        status: 'pending'
      };
    } catch (error) {
      logger.error('Error triggering animate:', error.message);
      throw new Error(`Failed to trigger animate: ${error.message}`);
    }
  }

  /**
   * Wait for upscale operation to complete
   * @param {string} requestId - Upscale request ID
   * @param {number} timeoutMs - Max wait time
   * @returns {Promise<Object>} Upscaled image result
   */
  async waitForUpscaleCompletion(requestId, timeoutMs = 120000) {
    return this.waitForCompletion(requestId, 'image', timeoutMs);
  }

  /**
   * Wait for animate operation to complete (returns 4 video options)
   * @param {string} requestId - Animate request ID
   * @param {number} timeoutMs - Max wait time (longer for video)
   * @returns {Promise<Object>} Animation result with video options
   */
  async waitForAnimateCompletion(requestId, timeoutMs = 300000) {
    try {
      logger.info(`Monitoring animate progress for ${requestId}...`);

      const startTime = Date.now();
      const pollInterval = 10000; // Poll every 10 seconds for video

      while (Date.now() - startTime < timeoutMs) {
        try {
          const response = await axios.get(`${this.discordBotUrl}/api/midjourney/status/${requestId}`);

          if (response.data.status === 'completed') {
            logger.info('Animation completed successfully');
            return {
              status: 'completed',
              messageId: response.data.messageId,
              videoOptions: response.data.videoOptions || [],
              completedAt: new Date().toISOString()
            };
          } else if (response.data.status === 'failed') {
            throw new Error(response.data.error || 'Animation failed');
          }

          logger.info(`Animation still in progress... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
          await sleep(pollInterval);

        } catch (error) {
          if (error.code === 'ECONNREFUSED') {
            logger.warn('Discord bot not reachable during polling');
            await sleep(pollInterval);
            continue;
          }
          throw error;
        }
      }

      throw new Error(`Animation timeout after ${timeoutMs / 1000} seconds`);

    } catch (error) {
      logger.error('Error monitoring animation:', error.message);
      throw new Error(`Failed to monitor animation: ${error.message}`);
    }
  }

  /**
   * Wait for final video selection to complete
   * @param {string} requestId - Video selection request ID
   * @param {number} timeoutMs - Max wait time
   * @returns {Promise<Object>} Final video result
   */
  async waitForVideoCompletion(requestId, timeoutMs = 180000) {
    try {
      logger.info(`Monitoring video selection for ${requestId}...`);

      const startTime = Date.now();
      const pollInterval = 5000;

      while (Date.now() - startTime < timeoutMs) {
        try {
          const response = await axios.get(`${this.discordBotUrl}/api/midjourney/status/${requestId}`);

          if (response.data.status === 'completed') {
            logger.info('Video selection completed successfully');
            return {
              status: 'completed',
              mediaUrl: response.data.mediaUrl,
              messageId: response.data.messageId,
              completedAt: new Date().toISOString()
            };
          } else if (response.data.status === 'failed') {
            throw new Error(response.data.error || 'Video selection failed');
          }

          logger.info(`Video selection still in progress... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
          await sleep(pollInterval);

        } catch (error) {
          if (error.code === 'ECONNREFUSED') {
            logger.warn('Discord bot not reachable during polling');
            await sleep(pollInterval);
            continue;
          }
          throw error;
        }
      }

      throw new Error(`Video selection timeout after ${timeoutMs / 1000} seconds`);

    } catch (error) {
      logger.error('Error monitoring video selection:', error.message);
      throw new Error(`Failed to monitor video selection: ${error.message}`);
    }
  }
}

module.exports = new MidjourneyService();
