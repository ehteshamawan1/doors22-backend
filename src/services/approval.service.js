/**
 * Approval Service
 * Handles post approval workflow
 * - Approve posts for auto-posting
 * - Reject posts (archive, never post)
 * - Edit posts (with auto-approval)
 * - Track approval history
 */

const { db } = require('../config/firebase');
const logger = require('../utils/logger');

// Lazy load to avoid circular dependency
let postingModule = null;
function getPostingModule() {
  if (!postingModule) {
    postingModule = require('../cron/posting');
  }
  return postingModule;
}

class ApprovalService {
  constructor() {
    this.postsCollection = db.collection('posts');
  }

  /**
   * Get all pending posts awaiting approval
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results
   * @returns {Promise<Array>} Pending posts
   */
  async getPendingPosts(options = {}) {
    try {
      logger.info('Fetching pending posts...');

      const { limit = 50 } = options;

      const snapshot = await this.postsCollection
        .where('status', '==', 'pending')
        .orderBy('generatedAt', 'desc')
        .limit(limit)
        .get();

      if (snapshot.empty) {
        logger.info('No pending posts found');
        return [];
      }

      const posts = [];
      snapshot.forEach(doc => {
        posts.push({
          id: doc.id,
          ...doc.data()
        });
      });

      logger.info(`Found ${posts.length} pending posts`);
      return posts;
    } catch (error) {
      logger.error('Error fetching pending posts:', error.message);
      throw new Error(`Failed to fetch pending posts: ${error.message}`);
    }
  }

  /**
   * Approve a post for auto-posting
   * @param {string} postId - Post ID
   * @param {Object} approvalData - Approval information
   * @param {string} approvalData.approvedBy - Admin user ID
   * @param {string} approvalData.scheduledPostTime - When to post (optional)
   * @returns {Promise<Object>} Updated post
   */
  async approvePost(postId, approvalData) {
    try {
      logger.info(`Approving post: ${postId}`);

      const { approvedBy = 'admin', scheduledPostTime } = approvalData;

      const postRef = this.postsCollection.doc(postId);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        throw new Error(`Post not found: ${postId}`);
      }

      const postData = postDoc.data();

      if (postData.status !== 'pending' && postData.status !== 'rejected') {
        throw new Error(`Post cannot be approved (current status: ${postData.status})`);
      }

      // Update post
      const updateData = {
        status: 'approved',
        approvedBy: approvedBy,
        approvedAt: new Date().toISOString(),
        approvalHistory: [
          ...(postData.approvalHistory || []),
          {
            action: 'approved',
            by: approvedBy,
            at: new Date().toISOString(),
            previousStatus: postData.status
          }
        ]
      };

      // Set scheduled post time if provided
      if (scheduledPostTime) {
        updateData.scheduledPostTime = scheduledPostTime;
      } else if (!postData.scheduledPostTime) {
        // Default: schedule for 5:00 PM UTC same day
        const now = new Date();
        const scheduled = new Date(now);
        scheduled.setUTCHours(17, 0, 0, 0);

        // If it's already past 5 PM UTC, schedule for tomorrow
        if (now.getUTCHours() >= 17) {
          scheduled.setDate(scheduled.getDate() + 1);
        }

        updateData.scheduledPostTime = scheduled.toISOString();
      }

      await postRef.update(updateData);

      logger.info(`Post approved successfully: ${postId}`);

      // Return updated post
      const updatedDoc = await postRef.get();
      const updatedPost = {
        id: updatedDoc.id,
        ...updatedDoc.data()
      };

      // Try to post immediately
      try {
        logger.info(`Attempting immediate posting for: ${postId}`);
        const posting = getPostingModule();
        const postResult = await posting.postImmediately(updatedPost);

        if (postResult.success) {
          logger.info(`Post ${postId} published immediately after approval`);
          // Refresh the post data after posting
          const finalDoc = await postRef.get();
          return {
            success: true,
            id: finalDoc.id,
            ...finalDoc.data(),
            immediatePost: true
          };
        } else {
          logger.warn(`Immediate posting failed for ${postId}, will retry via cron`);
          return {
            success: true,
            ...updatedPost,
            immediatePost: false,
            postingError: postResult.error || postResult.errors
          };
        }
      } catch (postError) {
        logger.warn(`Immediate posting error for ${postId}:`, postError.message);
        // Return the approved post - cron will pick it up later
        return {
          success: true,
          ...updatedPost,
          immediatePost: false,
          postingError: postError.message
        };
      }
    } catch (error) {
      logger.error('Error approving post:', error.message);
      throw new Error(`Failed to approve post: ${error.message}`);
    }
  }

  /**
   * Reject a post (will never be posted)
   * @param {string} postId - Post ID
   * @param {Object} rejectionData - Rejection information
   * @param {string} rejectionData.rejectedBy - Admin user ID
   * @param {string} rejectionData.reason - Rejection reason
   * @returns {Promise<Object>} Updated post
   */
  async rejectPost(postId, rejectionData) {
    try {
      logger.info(`Rejecting post: ${postId}`);

      const { rejectedBy = 'admin', reason = 'No reason provided' } = rejectionData;

      const postRef = this.postsCollection.doc(postId);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        throw new Error(`Post not found: ${postId}`);
      }

      const postData = postDoc.data();

      if (postData.status === 'posted') {
        throw new Error('Cannot reject a post that has already been posted');
      }

      // Update post
      const updateData = {
        status: 'rejected',
        rejectedBy: rejectedBy,
        rejectedAt: new Date().toISOString(),
        rejectionReason: reason,
        approvalHistory: [
          ...(postData.approvalHistory || []),
          {
            action: 'rejected',
            by: rejectedBy,
            at: new Date().toISOString(),
            reason: reason,
            previousStatus: postData.status
          }
        ]
      };

      await postRef.update(updateData);

      logger.info(`Post rejected successfully: ${postId}`);

      // Return updated post with success flag
      const updatedDoc = await postRef.get();
      return {
        success: true,
        id: updatedDoc.id,
        ...updatedDoc.data()
      };
    } catch (error) {
      logger.error('Error rejecting post:', error.message);
      throw new Error(`Failed to reject post: ${error.message}`);
    }
  }

  /**
   * Edit a post and auto-approve it
   * @param {string} postId - Post ID
   * @param {Object} editData - Edit information
   * @param {string} editData.editedBy - Admin user ID
   * @param {Object} editData.updates - Fields to update (caption, hashtags, etc.)
   * @returns {Promise<Object>} Updated post
   */
  async editPost(postId, editData) {
    try {
      logger.info(`Editing post: ${postId}`);

      const { editedBy = 'admin', updates } = editData;

      if (!updates || Object.keys(updates).length === 0) {
        throw new Error('No updates provided');
      }

      const postRef = this.postsCollection.doc(postId);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        throw new Error(`Post not found: ${postId}`);
      }

      const postData = postDoc.data();

      if (postData.status === 'posted') {
        throw new Error('Cannot edit a post that has already been posted');
      }

      // Track changes in edit history
      const editHistory = postData.editHistory || [];
      const timestamp = new Date().toISOString();

      Object.keys(updates).forEach(field => {
        if (postData[field] !== undefined && postData[field] !== updates[field]) {
          editHistory.push({
            field: field,
            oldValue: postData[field],
            newValue: updates[field],
            editedBy: editedBy,
            editedAt: timestamp
          });
        }
      });

      // Update post with edits and auto-approve
      const updateData = {
        ...updates,
        status: 'approved',
        editHistory: editHistory,
        approvedBy: editedBy,
        approvedAt: timestamp,
        approvalHistory: [
          ...(postData.approvalHistory || []),
          {
            action: 'edited_and_approved',
            by: editedBy,
            at: timestamp,
            editedFields: Object.keys(updates),
            previousStatus: postData.status
          }
        ]
      };

      // Set scheduled post time if not already set
      if (!postData.scheduledPostTime) {
        const now = new Date();
        const scheduled = new Date(now);
        scheduled.setUTCHours(17, 0, 0, 0);

        if (now.getUTCHours() >= 17) {
          scheduled.setDate(scheduled.getDate() + 1);
        }

        updateData.scheduledPostTime = scheduled.toISOString();
      }

      await postRef.update(updateData);

      logger.info(`Post edited and approved successfully: ${postId}`);

      // Return updated post
      const updatedDoc = await postRef.get();
      const updatedPost = {
        id: updatedDoc.id,
        ...updatedDoc.data()
      };

      // Try to post immediately
      try {
        logger.info(`Attempting immediate posting for edited post: ${postId}`);
        const posting = getPostingModule();
        const postResult = await posting.postImmediately(updatedPost);

        if (postResult.success) {
          logger.info(`Post ${postId} published immediately after edit`);
          const finalDoc = await postRef.get();
          return {
            success: true,
            id: finalDoc.id,
            ...finalDoc.data(),
            immediatePost: true
          };
        } else {
          logger.warn(`Immediate posting failed for ${postId}, will retry via cron`);
          return {
            success: true,
            ...updatedPost,
            immediatePost: false,
            postingError: postResult.error || postResult.errors
          };
        }
      } catch (postError) {
        logger.warn(`Immediate posting error for ${postId}:`, postError.message);
        return {
          success: true,
          ...updatedPost,
          immediatePost: false,
          postingError: postError.message
        };
      }
    } catch (error) {
      logger.error('Error editing post:', error.message);
      throw new Error(`Failed to edit post: ${error.message}`);
    }
  }

  /**
   * Get approval history for a post
   * @param {string} postId - Post ID
   * @returns {Promise<Array>} Approval history
   */
  async getApprovalHistory(postId) {
    try {
      const postDoc = await this.postsCollection.doc(postId).get();

      if (!postDoc.exists) {
        throw new Error(`Post not found: ${postId}`);
      }

      const postData = postDoc.data();
      return postData.approvalHistory || [];
    } catch (error) {
      logger.error('Error getting approval history:', error.message);
      throw new Error(`Failed to get approval history: ${error.message}`);
    }
  }

  /**
   * Get approved posts ready for posting
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Approved posts ready to post
   */
  async getApprovedPosts(options = {}) {
    try {
      logger.info('Fetching approved posts...');

      const { limit = 50, beforeTime } = options;
      const now = beforeTime || new Date().toISOString();

      const snapshot = await this.postsCollection
        .where('status', '==', 'approved')
        .where('scheduledPostTime', '<=', now)
        .orderBy('scheduledPostTime', 'asc')
        .limit(limit)
        .get();

      if (snapshot.empty) {
        logger.info('No approved posts ready for posting');
        return [];
      }

      const posts = [];
      snapshot.forEach(doc => {
        posts.push({
          id: doc.id,
          ...doc.data()
        });
      });

      logger.info(`Found ${posts.length} approved posts ready for posting`);
      return posts;
    } catch (error) {
      logger.error('Error fetching approved posts:', error.message);
      throw new Error(`Failed to fetch approved posts: ${error.message}`);
    }
  }

  /**
   * Get post statistics by status
   * @returns {Promise<Object>} Status counts
   */
  async getPostStatistics() {
    try {
      logger.info('Fetching post statistics...');

      const statuses = ['pending', 'approved', 'rejected', 'posted'];
      const stats = {
        total: 0,
        byStatus: {}
      };

      for (const status of statuses) {
        const snapshot = await this.postsCollection
          .where('status', '==', status)
          .count()
          .get();

        const count = snapshot.data().count;
        stats.byStatus[status] = count;
        stats.total += count;
      }

      logger.info('Statistics fetched successfully');
      return stats;
    } catch (error) {
      logger.error('Error fetching statistics:', error.message);
      throw new Error(`Failed to fetch statistics: ${error.message}`);
    }
  }
}

module.exports = new ApprovalService();
