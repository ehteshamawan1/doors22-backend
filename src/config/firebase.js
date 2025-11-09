const admin = require('firebase-admin');
const path = require('path');
const logger = require('../utils/logger');

let db = null;

/**
 * Initialize Firebase Admin SDK
 */
function initializeFirebase() {
  try {
    // Check if already initialized
    if (admin.apps.length > 0) {
      logger.info('Firebase already initialized');
      db = admin.firestore();
      return { admin, db };
    }

    // Path to service account key
    const serviceAccountPath = path.join(__dirname, '../../../firebase-service-account.json');

    // Initialize with service account
    admin.initializeApp({
      credential: admin.credential.cert(require(serviceAccountPath)),
      projectId: process.env.FIREBASE_PROJECT_ID
    });

    db = admin.firestore();

    logger.info('✅ Firebase Admin SDK initialized successfully');
    logger.info(`Project ID: ${process.env.FIREBASE_PROJECT_ID}`);

    return { admin, db };
  } catch (error) {
    logger.error('❌ Failed to initialize Firebase:', error.message);
    throw error;
  }
}

/**
 * Get Firestore database instance
 */
function getDb() {
  if (!db) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return db;
}

module.exports = {
  initializeFirebase,
  getDb,
  admin
};
