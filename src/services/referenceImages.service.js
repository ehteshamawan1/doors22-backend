/**
 * Reference Images Service
 * Manages selection of pre-uploaded product images from Cloudinary
 * for use in content generation instead of Midjourney
 */

const cloudinaryService = require('./cloudinary.service');
const logger = require('../utils/logger');

// Product catalog structure with keywords and Cloudinary folders
// Each category has multiple keyword variations for SEO diversity
const PRODUCT_CATALOG = {
  room_dividers: {
    keywords: [
      'sliding glass room dividers',
      'glass room divider',
      'glass room separator',
      'sliding glass walls for interior',
      'sliding glass room divider',
      'custom sliding glass room divider'
    ],
    keyword: 'sliding glass room divider', // Default/fallback
    cloudinaryFolder: 'doors22/reference/room_dividers',
    displayName: 'Room Dividers',
    description: 'Sliding glass room dividers for residential and commercial spaces'
  },
  closet_doors: {
    keywords: [
      'sliding glass closet doors',
      'glass closet doors',
      'custom glass closet doors',
      'interior glass sliding closet'
    ],
    keyword: 'sliding glass closet door', // Default/fallback
    cloudinaryFolder: 'doors22/reference/closet_doors',
    displayName: 'Closet Doors',
    description: 'Sliding glass closet doors with modern aluminum frames'
  },
  home_offices: {
    keywords: [
      'glass office partitions',
      'glass office walls',
      'sliding glass office partitions',
      'sliding glass office walls',
      'glass office system',
      'glass partition walls',
      'glass cubicles',
      'sliding glass cubicles',
      'glass office dividers',
      'glass wall system'
    ],
    keyword: 'glass office partitions', // Default/fallback
    cloudinaryFolder: 'doors22/reference/home_offices',
    displayName: 'Home Offices',
    description: 'Glass partitions and doors for HOME office spaces (residential)'
  }
};

class ReferenceImagesService {
  constructor() {
    this.imageCache = {};
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes cache
    this.lastCacheTime = {};
  }

  /**
   * Get all available categories
   * @returns {string[]} Array of category keys
   */
  getCategories() {
    return Object.keys(PRODUCT_CATALOG);
  }

  /**
   * Get category info
   * @param {string} category - Category key
   * @returns {Object} Category info including keyword and display name
   */
  getCategoryInfo(category) {
    return PRODUCT_CATALOG[category] || null;
  }

  /**
   * Get default keyword for a category
   * @param {string} category - Category key
   * @returns {string} SEO keyword for the category
   */
  getKeyword(category) {
    return PRODUCT_CATALOG[category]?.keyword || 'sliding glass door';
  }

  /**
   * Get a random keyword from the category's keyword variations
   * Used for SEO diversity in captions
   * @param {string} category - Category key
   * @returns {string} Random SEO keyword for the category
   */
  getRandomKeyword(category) {
    const catalog = PRODUCT_CATALOG[category];
    if (!catalog) return 'sliding glass door';

    // If keywords array exists and has items, pick a random one
    if (catalog.keywords && catalog.keywords.length > 0) {
      const randomIndex = Math.floor(Math.random() * catalog.keywords.length);
      const selectedKeyword = catalog.keywords[randomIndex];
      logger.info(`Selected random keyword for ${category}: "${selectedKeyword}"`);
      return selectedKeyword;
    }

    // Fallback to default keyword
    return catalog.keyword || 'sliding glass door';
  }

  /**
   * Get display name for a category
   * @param {string} category - Category key
   * @returns {string} Human-readable category name
   */
  getDisplayName(category) {
    return PRODUCT_CATALOG[category]?.displayName || category;
  }

  /**
   * Get all images for a category from Cloudinary
   * @param {string} category - Category key
   * @returns {Promise<Array>} Array of image objects
   */
  async getImagesForCategory(category) {
    const catalog = PRODUCT_CATALOG[category];
    if (!catalog) {
      throw new Error(`Unknown category: ${category}`);
    }

    // Check cache
    const now = Date.now();
    if (this.imageCache[category] &&
        this.lastCacheTime[category] &&
        (now - this.lastCacheTime[category]) < this.cacheExpiry) {
      logger.info(`Using cached images for ${category}`);
      return this.imageCache[category];
    }

    try {
      logger.info(`Fetching images from Cloudinary for ${category}...`);
      const images = await cloudinaryService.listMedia(catalog.cloudinaryFolder, 'image', 50);

      if (images.length === 0) {
        logger.warn(`No images found in ${catalog.cloudinaryFolder}`);
        return [];
      }

      // Cache the results
      this.imageCache[category] = images;
      this.lastCacheTime[category] = now;

      logger.info(`Found ${images.length} images for ${category}`);
      return images;
    } catch (error) {
      logger.error(`Error fetching images for ${category}:`, error.message);
      throw error;
    }
  }

  /**
   * Get a random image for a specific category
   * @param {string} category - Category key (room_dividers, closet_doors, home_offices)
   * @returns {Promise<Object>} Image URL and metadata
   */
  async getRandomImage(category) {
    const catalog = PRODUCT_CATALOG[category];
    if (!catalog) {
      throw new Error(`Unknown category: ${category}. Valid categories: ${this.getCategories().join(', ')}`);
    }

    const images = await this.getImagesForCategory(category);

    if (images.length === 0) {
      throw new Error(`No images found for category: ${category}. Please run the upload script first.`);
    }

    // Select random image
    const randomIndex = Math.floor(Math.random() * images.length);
    const selectedImage = images[randomIndex];

    // Parse metadata from publicId if available
    const metadata = this.parseImageMetadata(selectedImage.publicId);

    // Get a random keyword for SEO diversity
    const randomKeyword = this.getRandomKeyword(category);

    logger.info(`Selected random image for ${category}: ${selectedImage.publicId}`);

    return {
      url: selectedImage.url,
      publicId: selectedImage.publicId,
      category: category,
      keyword: randomKeyword, // Use random keyword instead of static
      displayName: catalog.displayName,
      ...metadata
    };
  }

  /**
   * Parse product details from Cloudinary public ID
   * @param {string} publicId - Cloudinary public ID
   * @returns {Object} Extracted metadata
   */
  parseImageMetadata(publicId) {
    const filename = publicId.split('/').pop().toLowerCase();

    // Try to extract frame color
    let frame = 'black'; // default
    if (filename.includes('white')) frame = 'white';
    else if (filename.includes('silver')) frame = 'silver';
    else if (filename.includes('black')) frame = 'black';

    // Try to extract glass type
    let glassType = 'clear'; // default
    if (filename.includes('frosted')) glassType = 'frosted';
    else if (filename.includes('milky')) glassType = 'milky';
    else if (filename.includes('smoked_frosted') || filename.includes('smokedfrosted')) glassType = 'smoked frosted';
    else if (filename.includes('lite_smoked') || filename.includes('litesmoked')) glassType = 'lite smoked';
    else if (filename.includes('smoked')) glassType = 'smoked';
    else if (filename.includes('clear')) glassType = 'clear';

    // Try to extract panel count
    let panels = null;
    if (filename.includes('2panel')) panels = 2;
    else if (filename.includes('3panel')) panels = 3;
    else if (filename.includes('4panel')) panels = 4;

    return { frame, glassType, panels };
  }

  /**
   * Validate a category name
   * @param {string} category - Category to validate
   * @returns {boolean} True if valid
   */
  isValidCategory(category) {
    return Object.keys(PRODUCT_CATALOG).includes(category);
  }

  /**
   * Get all catalog info
   * @returns {Object} Full product catalog
   */
  getCatalog() {
    return PRODUCT_CATALOG;
  }

  /**
   * Clear the image cache
   */
  clearCache() {
    this.imageCache = {};
    this.lastCacheTime = {};
    logger.info('Reference images cache cleared');
  }
}

module.exports = new ReferenceImagesService();
