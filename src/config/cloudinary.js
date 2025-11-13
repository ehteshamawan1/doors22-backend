const cloudinary = require('cloudinary').v2;
const logger = require('../utils/logger');

/**
 * Configure Cloudinary
 * Uses CLOUDINARY_URL environment variable (format: cloudinary://api_key:api_secret@cloud_name)
 * Or falls back to individual environment variables
 */
if (process.env.CLOUDINARY_URL) {
  cloudinary.config(process.env.CLOUDINARY_URL);
  logger.info('✅ Cloudinary configured via CLOUDINARY_URL');
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  logger.info('✅ Cloudinary configured via individual environment variables');
  logger.info(`Cloud Name: ${process.env.CLOUDINARY_CLOUD_NAME}`);
}

module.exports = cloudinary;
