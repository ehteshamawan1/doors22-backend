/**
 * One-Time Script: Upload Reference Images to Cloudinary
 *
 * This script uploads the selected reference images to Cloudinary
 * organized by category for use in content generation.
 *
 * Run with: node scripts/uploadReferenceImages.js
 *
 * Categories:
 * - room_dividers: 7 images from pictures/DIVIDER/
 * - closet_doors: 7 images from pictures/CLOSET/
 * - home_offices: 7 images from pictures/HOME OFFICE/
 */

require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

// Configure Cloudinary
if (process.env.CLOUDINARY_URL) {
  cloudinary.config(process.env.CLOUDINARY_URL);
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// Base path to pictures folder (relative to backend root)
const PICTURES_ROOT = path.join(__dirname, '..', '..', 'pictures');
const CLOUDINARY_BASE = 'doors22/reference';

// Selected images for each category
const SELECTED_IMAGES = {
  room_dividers: [
    { path: 'DIVIDER/SCENE 1 - 4 panels/BLACK', pattern: 'clear', name: '4panel_black_clear' },
    { path: 'DIVIDER/SCENE 1 - 4 panels/SILVER', pattern: 'frosted', name: '4panel_silver_frosted' },
    { path: 'DIVIDER/SCENE 1 - 4 panels/WHITE', pattern: 'milky', name: '4panel_white_milky' },
    { path: 'DIVIDER/SCENE 2 - 3 panels/BLACK', pattern: 'smoked', name: '3panel_black_smoked' },
    { path: 'DIVIDER/SCENE 2 - 3 panels/SILVER', pattern: 'clear', name: '3panel_silver_clear' },
    { path: 'DIVIDER/SCENE 3 - 2 panels/Black frames', pattern: 'frosted', name: '2panel_black_frosted' },
    { path: 'DIVIDER/SCENE 3 - 2 panels/White frames', pattern: 'clear', name: '2panel_white_clear' }
  ],
  closet_doors: [
    { path: 'CLOSET/SCENE 1 - 4 panels/black frames', pattern: 'clear', name: '4panel_black_clear' },
    { path: 'CLOSET/SCENE 1 - 4 panels/silver frames', pattern: 'frosted', name: '4panel_silver_frosted' },
    { path: 'CLOSET/SCENE 1 - 4 panels/white frames', pattern: 'milky', name: '4panel_white_milky' },
    { path: 'CLOSET/SCENE 2 - 3 panels/black frames', pattern: 'frosted', name: '3panel_black_frosted' },
    { path: 'CLOSET/SCENE 2 - 3 panels/silver frames', pattern: 'smoked', name: '3panel_silver_smoked' },
    { path: 'CLOSET/SCENE 3 - 2 panels/black frames', pattern: 'clear', name: '2panel_black_clear' },
    { path: 'CLOSET/SCENE 3 - 2 panels/white frames', pattern: 'clear', name: '2panel_white_clear' }
  ],
  home_offices: [
    { file: 'HOME OFFICE/Office1_render(1).jpg', name: 'office1_render' },
    { file: 'HOME OFFICE/office 1.jpg', name: 'office1' },
    { file: 'HOME OFFICE/office 2.jpg', name: 'office2' },
    { file: 'HOME OFFICE/office 3.jpg', name: 'office3' },
    { file: 'HOME OFFICE/Office 4.jpg', name: 'office4' },
    { file: 'HOME OFFICE/OFFICE 1_1_final.jpg', name: 'office1_final' },
    { file: 'HOME OFFICE/Glass-Office-Partitions-Doors22.jpg', name: 'glass_partitions' }
  ]
};

/**
 * Find first matching image file in a directory
 */
function findImageByPattern(dirPath, pattern) {
  try {
    const files = fs.readdirSync(dirPath);
    const match = files.find(file => {
      const lower = file.toLowerCase();
      return (lower.includes(pattern.toLowerCase()) || lower.includes('glass')) &&
             (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png'));
    });
    return match ? path.join(dirPath, match) : null;
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error.message);
    return null;
  }
}

/**
 * Upload a single image to Cloudinary
 */
async function uploadImage(localPath, category, publicIdName) {
  try {
    const cloudinaryFolder = `${CLOUDINARY_BASE}/${category}`;

    console.log(`Uploading: ${path.basename(localPath)} -> ${cloudinaryFolder}/${publicIdName}`);

    const result = await cloudinary.uploader.upload(localPath, {
      folder: cloudinaryFolder,
      public_id: publicIdName,
      resource_type: 'image',
      overwrite: true,
      tags: ['doors22', 'reference', category]
    });

    console.log(`  ✓ Uploaded: ${result.secure_url}`);
    return result;
  } catch (error) {
    console.error(`  ✗ Failed: ${error.message}`);
    return null;
  }
}

/**
 * Upload all images for a category
 */
async function uploadCategory(category, images) {
  console.log(`\n=== Uploading ${category.toUpperCase()} ===`);

  const results = [];

  for (const image of images) {
    let localPath;

    if (image.file) {
      // Direct file path
      localPath = path.join(PICTURES_ROOT, image.file);
    } else if (image.path && image.pattern) {
      // Search directory for pattern
      const dirPath = path.join(PICTURES_ROOT, image.path);
      localPath = findImageByPattern(dirPath, image.pattern);
    }

    if (localPath && fs.existsSync(localPath)) {
      const result = await uploadImage(localPath, category, image.name);
      if (result) {
        results.push({
          name: image.name,
          publicId: result.public_id,
          url: result.secure_url
        });
      }
    } else {
      console.log(`  ⚠ Not found: ${image.file || image.path}`);
    }
  }

  return results;
}

/**
 * Main function
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     Doors22 Reference Images Upload Script             ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Pictures folder: ${PICTURES_ROOT}`);
  console.log(`Cloudinary folder: ${CLOUDINARY_BASE}`);
  console.log('');

  // Check if pictures folder exists
  if (!fs.existsSync(PICTURES_ROOT)) {
    console.error(`ERROR: Pictures folder not found: ${PICTURES_ROOT}`);
    process.exit(1);
  }

  const allResults = {};

  // Upload each category
  for (const [category, images] of Object.entries(SELECTED_IMAGES)) {
    allResults[category] = await uploadCategory(category, images);
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║                      SUMMARY                           ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  let totalUploaded = 0;
  for (const [category, results] of Object.entries(allResults)) {
    console.log(`\n${category}: ${results.length} images uploaded`);
    results.forEach(r => console.log(`  - ${r.name}: ${r.url}`));
    totalUploaded += results.length;
  }

  console.log(`\n✓ Total: ${totalUploaded} images uploaded to Cloudinary`);
  console.log('\nDone!');
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
