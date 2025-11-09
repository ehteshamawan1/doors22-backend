const admin = require('firebase-admin');
const logger = require('../utils/logger');

/**
 * Initialize Firebase Admin SDK
 */
function initializeFirebase() {
  try {
    // Check if already initialized
    if (admin.apps.length > 0) {
      logger.info('Firebase already initialized');
      return { admin, db: admin.firestore() };
    }

    // Initialize with environment variables (for serverless environments like Vercel)
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim()
      })
    });

    const db = admin.firestore();

    logger.info('✅ Firebase Admin SDK initialized successfully');
    logger.info(`Project ID: ${process.env.FIREBASE_PROJECT_ID}`);

    return { admin, db };
  } catch (error) {
    logger.error('❌ Failed to initialize Firebase:', error.message);
    throw error;
  }
}

// Auto-initialize for serverless environments
initializeFirebase();

/**
 * Get Firestore database instance
 */
function getDb() {
  if (admin.apps.length === 0) {
    initializeFirebase();
  }
  return admin.firestore();
}

// Export db getter that always returns the current Firestore instance
module.exports = {
  initializeFirebase,
  getDb,
  get db() {
    return getDb();
  },
  admin
};
