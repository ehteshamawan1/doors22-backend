/**
 * Cloudinary Service
 * Handles media uploads and management
 * - Upload images and videos
 * - Generate CDN URLs
 * - Create thumbnails for videos
 * - Manage media metadata
 * - Delete media when needed
 */

const cloudinary = require('../config/cloudinary');
const logger = require('../utils/logger');
const { formatDate } = require('../utils/helpers');
const stream = require('stream');

class CloudinaryService {
  constructor() {
    this.cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    this.folder = 'doors22'; // Base folder for all uploads
  }

  /**
   * Upload image to Cloudinary
   * @param {Buffer} imageBuffer - Image file buffer
   * @param {Object} options - Upload options
   * @param {string} options.postId - Post ID for folder organization
   * @param {string} options.filename - Desired filename
   * @returns {Promise<Object>} Upload result with URL and metadata
   */
  async uploadImage(imageBuffer, options = {}) {
    try {
      logger.info('Uploading image to Cloudinary...');

      const { postId, filename } = options;
      const date = formatDate(new Date());
      const folder = `${this.folder}/${date}/images`;

      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: folder,
            public_id: filename || postId || `image_${Date.now()}`,
            resource_type: 'image',
            format: 'jpg',
            transformation: [
              { width: 1080, height: 1350, crop: 'fill', gravity: 'center', quality: 'auto:best' }
            ],
            tags: ['doors22', 'social-media', 'image', date]
          },
          (error, result) => {
            if (error) {
              logger.error('Error uploading image:', error.message);
              reject(new Error(`Image upload failed: ${error.message}`));
            } else {
              logger.info(`Image uploaded successfully: ${result.secure_url}`);
              resolve({
                success: true,
                type: 'image',
                url: result.secure_url,
                publicId: result.public_id,
                format: result.format,
                width: result.width,
                height: result.height,
                fileSize: result.bytes,
                createdAt: result.created_at
              });
            }
          }
        );

        const bufferStream = new stream.PassThrough();
        bufferStream.end(imageBuffer);
        bufferStream.pipe(uploadStream);
      });
    } catch (error) {
      logger.error('Error in uploadImage:', error.message);
      throw new Error(`Failed to upload image: ${error.message}`);
    }
  }

  /**
   * Upload video to Cloudinary
   * @param {Buffer} videoBuffer - Video file buffer
   * @param {Object} options - Upload options
   * @param {string} options.postId - Post ID for folder organization
   * @param {string} options.filename - Desired filename
   * @returns {Promise<Object>} Upload result with URL, thumbnail, and metadata
   */
  async uploadVideo(videoBuffer, options = {}) {
    try {
      logger.info('Uploading video to Cloudinary...');

      const { postId, filename } = options;
      const date = formatDate(new Date());
      const folder = `${this.folder}/${date}/videos`;

      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: folder,
            public_id: filename || postId || `video_${Date.now()}`,
            resource_type: 'video',
            format: 'mp4',
            transformation: [
              {
                width: 1080,
                height: 1920,
                crop: 'fill',
                gravity: 'center',
                quality: 'auto:good',
                video_codec: 'h264',
                audio_codec: 'aac'
              }
            ],
            eager: [
              {
                width: 1080,
                height: 1920,
                crop: 'fill',
                format: 'jpg',
                start_offset: '1.0' // Thumbnail from 1 second
              }
            ],
            tags: ['doors22', 'social-media', 'video', 'reel', date]
          },
          async (error, result) => {
            if (error) {
              logger.error('Error uploading video:', error.message);
              reject(new Error(`Video upload failed: ${error.message}`));
            } else {
              logger.info(`Video uploaded successfully: ${result.secure_url}`);

              // Generate thumbnail URL
              const thumbnailUrl = result.eager && result.eager[0]
                ? result.eager[0].secure_url
                : this.getVideoThumbnail(result.public_id);

              resolve({
                success: true,
                type: 'video',
                url: result.secure_url,
                thumbnailUrl: thumbnailUrl,
                publicId: result.public_id,
                format: result.format,
                width: result.width,
                height: result.height,
                duration: result.duration,
                fileSize: result.bytes,
                createdAt: result.created_at
              });
            }
          }
        );

        const bufferStream = new stream.PassThrough();
        bufferStream.end(videoBuffer);
        bufferStream.pipe(uploadStream);
      });
    } catch (error) {
      logger.error('Error in uploadVideo:', error.message);
      throw new Error(`Failed to upload video: ${error.message}`);
    }
  }

  /**
   * Upload media (auto-detects type)
   * @param {Buffer} mediaBuffer - Media file buffer
   * @param {Object} options - Upload options
   * @param {string} options.type - 'image' or 'video'
   * @param {string} options.postId - Post ID
   * @param {string} options.filename - Filename
   * @returns {Promise<Object>} Upload result
   */
  async uploadMedia(mediaBuffer, options) {
    try {
      const { type } = options;

      if (type === 'video') {
        return await this.uploadVideo(mediaBuffer, options);
      } else {
        return await this.uploadImage(mediaBuffer, options);
      }
    } catch (error) {
      logger.error('Error uploading media:', error.message);
      throw error;
    }
  }

  /**
   * Get video thumbnail URL
   * @param {string} publicId - Cloudinary public ID
   * @param {Object} options - Thumbnail options
   * @returns {string} Thumbnail URL
   */
  getVideoThumbnail(publicId, options = {}) {
    const { width = 1080, height = 1920, startOffset = 1.0 } = options;

    return cloudinary.url(publicId, {
      resource_type: 'video',
      format: 'jpg',
      width: width,
      height: height,
      crop: 'fill',
      gravity: 'center',
      start_offset: startOffset,
      secure: true
    });
  }

  /**
   * Delete media from Cloudinary
   * @param {string} publicId - Cloudinary public ID
   * @param {string} resourceType - 'image' or 'video'
   * @returns {Promise<boolean>} Success status
   */
  async deleteMedia(publicId, resourceType = 'image') {
    try {
      logger.info(`Deleting ${resourceType} from Cloudinary: ${publicId}`);

      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType
      });

      if (result.result === 'ok') {
        logger.info('Media deleted successfully');
        return true;
      } else {
        logger.warn(`Delete result: ${result.result}`);
        return false;
      }
    } catch (error) {
      logger.error('Error deleting media:', error.message);
      return false;
    }
  }

  /**
   * Get media details from Cloudinary
   * @param {string} publicId - Cloudinary public ID
   * @param {string} resourceType - 'image' or 'video'
   * @returns {Promise<Object>} Media details
   */
  async getMediaDetails(publicId, resourceType = 'image') {
    try {
      const result = await cloudinary.api.resource(publicId, {
        resource_type: resourceType
      });

      return {
        publicId: result.public_id,
        url: result.secure_url,
        format: result.format,
        width: result.width,
        height: result.height,
        fileSize: result.bytes,
        duration: result.duration, // For videos
        createdAt: result.created_at
      };
    } catch (error) {
      logger.error('Error getting media details:', error.message);
      throw new Error(`Failed to get media details: ${error.message}`);
    }
  }

  /**
   * Generate transformation URL for existing media
   * @param {string} publicId - Cloudinary public ID
   * @param {Object} transformations - Cloudinary transformations
   * @param {string} resourceType - 'image' or 'video'
   * @returns {string} Transformed media URL
   */
  getTransformationUrl(publicId, transformations, resourceType = 'image') {
    return cloudinary.url(publicId, {
      resource_type: resourceType,
      ...transformations,
      secure: true
    });
  }

  /**
   * List media in a folder
   * @param {string} folder - Folder path
   * @param {string} resourceType - 'image' or 'video'
   * @param {number} maxResults - Maximum results to return
   * @returns {Promise<Array>} List of media
   */
  async listMedia(folder, resourceType = 'image', maxResults = 100) {
    try {
      logger.info(`Listing ${resourceType}s in folder: ${folder}`);

      const result = await cloudinary.api.resources({
        type: 'upload',
        resource_type: resourceType,
        prefix: folder,
        max_results: maxResults
      });

      return result.resources.map(resource => ({
        publicId: resource.public_id,
        url: resource.secure_url,
        format: resource.format,
        width: resource.width,
        height: resource.height,
        fileSize: resource.bytes,
        createdAt: resource.created_at
      }));
    } catch (error) {
      logger.error('Error listing media:', error.message);
      throw new Error(`Failed to list media: ${error.message}`);
    }
  }
}

module.exports = new CloudinaryService();
