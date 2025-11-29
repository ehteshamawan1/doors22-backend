const express = require('express');
const router = express.Router();

// Import controllers
const trendController = require('../controllers/trendController');
const contentController = require('../controllers/contentController');
const postController = require('../controllers/postController');
const interactionController = require('../controllers/interactionController');
const settingsController = require('../controllers/settingsController');

// Import test routes
const testRoutes = require('./test');

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      firebase: 'connected',
      openai: 'configured',
      cloudinary: 'configured',
      midjourney: 'configured'
    }
  });
});

// Test routes
router.use('/test', testRoutes);

// ===== TRENDS ROUTES =====
router.get('/trends', trendController.getTrends);
router.get('/trends/latest', trendController.getLatestTrend);
router.get('/trends/:id', trendController.getTrendById);
router.post('/trends/analyze', trendController.analyzeTrends);
router.delete('/trends/:id', trendController.deleteTrend);

// ===== CONTENT ROUTES =====
router.get('/content', contentController.getContent);
router.get('/content/:id', contentController.getContentById);
router.post('/content/generate', contentController.generateContent);

// ===== POSTS ROUTES (WITH APPROVAL WORKFLOW) =====
// Get posts
router.get('/posts', postController.getPosts);
router.get('/posts/pending', postController.getPendingPosts);
router.get('/posts/statistics', postController.getStatistics);
router.get('/posts/:id', postController.getPostById);
router.get('/posts/:id/history', postController.getApprovalHistory);

// Approval actions
router.put('/posts/:id/approve', postController.approvePost);
router.put('/posts/:id/reject', postController.rejectPost);
router.put('/posts/:id/edit', postController.editPost);

// Delete
router.delete('/posts/:id', postController.deletePost);

// ===== INTERACTIONS ROUTES (COMMENTS & DMS) =====
router.get('/interactions', interactionController.getInteractions);
router.get('/interactions/statistics', interactionController.getStatistics);
router.get('/interactions/:id', interactionController.getInteractionById);
router.post('/interactions/webhook', interactionController.handleWebhook);
router.delete('/interactions/:id', interactionController.deleteInteraction);

// ===== SETTINGS ROUTES =====
router.get('/settings', settingsController.getSettings);
router.put('/settings', settingsController.updateSettings);

// ===== LOGS ROUTES (FOR DEBUGGING) =====
const { db } = require('../config/firebase');
router.get('/logs', async (req, res) => {
  try {
    const { limit = 50, type } = req.query;
    let query = db.collection('logs').orderBy('timestamp', 'desc').limit(parseInt(limit));

    if (type) {
      query = db.collection('logs').where('type', '==', type).orderBy('timestamp', 'desc').limit(parseInt(limit));
    }

    const snapshot = await query.get();
    const logs = [];
    snapshot.forEach(doc => {
      logs.push({ id: doc.id, ...doc.data() });
    });

    res.json({ success: true, count: logs.length, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
