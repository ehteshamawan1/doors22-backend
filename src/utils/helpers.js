/**
 * Helper utility functions
 */

/**
 * Generate post ID in format YYYY-MM-DD-XXX
 */
function generatePostId() {
  const date = new Date().toISOString().split('T')[0];
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${date}-${random}`;
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  generatePostId,
  formatDate,
  sleep
};
