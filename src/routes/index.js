const express = require('express');
const router = express.Router();

// Import controllers
const trendController = require('../controllers/trendController');
const contentController = require('../controllers/contentController');
const postController = require('../controllers/postController');
const interactionController = require('../controllers/interactionController');

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

// ===== TRENDS ROUTES =====
router.get('/api/trends', trendController.getTrends);
router.get('/api/trends/latest', trendController.getLatestTrend);
router.get('/api/trends/:id', trendController.getTrendById);
router.post('/api/trends/analyze', trendController.analyzeTrends);
router.delete('/api/trends/:id', trendController.deleteTrend);

// ===== CONTENT ROUTES =====
router.get('/api/content', contentController.getContent);
router.get('/api/content/:id', contentController.getContentById);
router.post('/api/content/generate', contentController.generateContent);

// ===== POSTS ROUTES (WITH APPROVAL WORKFLOW) =====
// Get posts
router.get('/api/posts', postController.getPosts);
router.get('/api/posts/pending', postController.getPendingPosts);
router.get('/api/posts/statistics', postController.getStatistics);
router.get('/api/posts/:id', postController.getPostById);
router.get('/api/posts/:id/history', postController.getApprovalHistory);

// Approval actions
router.put('/api/posts/:id/approve', postController.approvePost);
router.put('/api/posts/:id/reject', postController.rejectPost);
router.put('/api/posts/:id/edit', postController.editPost);

// Delete
router.delete('/api/posts/:id', postController.deletePost);

// ===== INTERACTIONS ROUTES (COMMENTS & DMS) =====
router.get('/api/interactions', interactionController.getInteractions);
router.get('/api/interactions/statistics', interactionController.getStatistics);
router.get('/api/interactions/:id', interactionController.getInteractionById);
router.post('/api/interactions/webhook', interactionController.handleWebhook);
router.delete('/api/interactions/:id', interactionController.deleteInteraction);

module.exports = router;
