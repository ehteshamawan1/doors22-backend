/**
 * Post Controller
 * Handles post management and approval workflow API endpoints
 */

const { db } = require('../config/firebase');
const approvalService = require('../services/approval.service');
const logger = require('../utils/logger');

/**
 * GET /api/posts
 * Get all posts with optional filters
 */
exports.getPosts = async (req, res) => {
  try {
    const { limit = 20, offset = 0, status, type } = req.query;

    let query = db.collection('posts').orderBy('createdAt', 'desc');

    if (status) {
      query = query.where('status', '==', status);
    }

    if (type) {
      query = query.where('type', '==', type);
    }

    const snapshot = await query
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();

    const posts = [];
    snapshot.forEach(doc => {
      posts.push({
        id: doc.id,
        ...doc.data()
      });
    });

    logger.info(`Retrieved ${posts.length} posts`);

    res.json({
      success: true,
      count: posts.length,
      posts
    });
  } catch (error) {
    logger.error('Error fetching posts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch posts',
      message: error.message
    });
  }
};

/**
 * GET /api/posts/pending
 * Get all pending posts awaiting approval
 */
exports.getPendingPosts = async (req, res) => {
  try {
    const snapshot = await db.collection('posts')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .get();

    const posts = [];
    snapshot.forEach(doc => {
      posts.push({
        id: doc.id,
        ...doc.data()
      });
    });

    logger.info(`Retrieved ${posts.length} pending posts`);

    res.json({
      success: true,
      count: posts.length,
      posts
    });
  } catch (error) {
    logger.error('Error fetching pending posts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pending posts',
      message: error.message
    });
  }
};

/**
 * GET /api/posts/statistics
 * Get post statistics by status
 */
exports.getStatistics = async (req, res) => {
  try {
    const statuses = ['pending', 'approved', 'rejected', 'posted'];
    const statistics = {
      total: 0,
      byStatus: {}
    };

    // Get count for each status
    for (const status of statuses) {
      const snapshot = await db.collection('posts')
        .where('status', '==', status)
        .get();

      const count = snapshot.size;
      statistics.byStatus[status] = count;
      statistics.total += count;
    }

    logger.info('Retrieved post statistics:', statistics);

    res.json({
      success: true,
      statistics
    });
  } catch (error) {
    logger.error('Error fetching statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      message: error.message
    });
  }
};

/**
 * GET /api/posts/:id
 * Get a specific post by ID
 */
exports.getPostById = async (req, res) => {
  try {
    const { id } = req.params;

    const postDoc = await db.collection('posts').doc(id).get();

    if (!postDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    const post = {
      id: postDoc.id,
      ...postDoc.data()
    };

    logger.info(`Retrieved post: ${id}`);

    res.json({
      success: true,
      post
    });
  } catch (error) {
    logger.error(`Error fetching post ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch post',
      message: error.message
    });
  }
};

/**
 * GET /api/posts/:id/history
 * Get approval history for a post
 */
exports.getApprovalHistory = async (req, res) => {
  try {
    const { id } = req.params;

    const postDoc = await db.collection('posts').doc(id).get();

    if (!postDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    const postData = postDoc.data();
    const history = {
      approvalHistory: postData.approvalHistory || [],
      editHistory: postData.editHistory || [],
      rejectionReason: postData.rejectionReason || null
    };

    logger.info(`Retrieved approval history for post: ${id}`);

    res.json({
      success: true,
      history
    });
  } catch (error) {
    logger.error(`Error fetching approval history for ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch approval history',
      message: error.message
    });
  }
};

/**
 * PUT /api/posts/:id/approve
 * Approve a post
 */
exports.approvePost = async (req, res) => {
  try {
    const { id } = req.params;
    const { approvedBy = 'admin', scheduledTime } = req.body;

    const result = await approvalService.approvePost(id, {
      approvedBy,
      scheduledTime
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    logger.info(`Post approved: ${id} by ${approvedBy}`);

    res.json(result);
  } catch (error) {
    logger.error(`Error approving post ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve post',
      message: error.message
    });
  }
};

/**
 * PUT /api/posts/:id/reject
 * Reject a post
 */
exports.rejectPost = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectedBy = 'admin', reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Rejection reason is required'
      });
    }

    const result = await approvalService.rejectPost(id, {
      rejectedBy,
      reason
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    logger.info(`Post rejected: ${id} by ${rejectedBy}. Reason: ${reason}`);

    res.json(result);
  } catch (error) {
    logger.error(`Error rejecting post ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject post',
      message: error.message
    });
  }
};

/**
 * PUT /api/posts/:id/edit
 * Edit a post (auto-approves after edit)
 */
exports.editPost = async (req, res) => {
  try {
    const { id } = req.params;
    const { caption, hashtags, editedBy = 'admin', updates: updatesFromBody } = req.body;

    // Support both formats: { caption, hashtags } or { updates: { caption, hashtags } }
    const updates = updatesFromBody || {};
    if (caption) updates.caption = caption;
    if (hashtags) updates.hashtags = hashtags;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No updates provided'
      });
    }

    const result = await approvalService.editPost(id, { editedBy, updates });

    if (!result.success) {
      return res.status(400).json(result);
    }

    logger.info(`Post edited: ${id} by ${editedBy}`);

    res.json(result);
  } catch (error) {
    logger.error(`Error editing post ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to edit post',
      message: error.message
    });
  }
};

/**
 * DELETE /api/posts/:id
 * Delete a post
 */
exports.deletePost = async (req, res) => {
  try {
    const { id } = req.params;

    await db.collection('posts').doc(id).delete();

    logger.info(`Post deleted: ${id}`);

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting post ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete post',
      message: error.message
    });
  }
};
