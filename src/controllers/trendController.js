/**
 * Trend Controller
 * Handles trend analysis API endpoints
 */

const { db } = require('../config/firebase');
const aiEngine = require('../services/aiEngine');
const logger = require('../utils/logger');

/**
 * GET /api/trends
 * Get all trends with optional filters
 */
exports.getTrends = async (req, res) => {
  try {
    const { limit = 10, offset = 0 } = req.query;

    const trendsRef = db.collection('trends');
    const snapshot = await trendsRef
      .orderBy('date', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();

    const trends = [];
    snapshot.forEach(doc => {
      trends.push({
        id: doc.id,
        ...doc.data()
      });
    });

    logger.info(`Retrieved ${trends.length} trends`);

    res.json({
      success: true,
      count: trends.length,
      trends
    });
  } catch (error) {
    logger.error('Error fetching trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trends',
      message: error.message
    });
  }
};

/**
 * GET /api/trends/latest
 * Get the most recent trend analysis
 */
exports.getLatestTrend = async (req, res) => {
  try {
    const trendsRef = db.collection('trends');
    const snapshot = await trendsRef
      .orderBy('date', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.json({
        success: true,
        trend: null,
        message: 'No trends found'
      });
    }

    const doc = snapshot.docs[0];
    const trend = {
      id: doc.id,
      ...doc.data()
    };

    logger.info(`Retrieved latest trend: ${trend.id}`);

    res.json({
      success: true,
      trend
    });
  } catch (error) {
    logger.error('Error fetching latest trend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch latest trend',
      message: error.message
    });
  }
};

/**
 * GET /api/trends/:id
 * Get a specific trend by ID
 */
exports.getTrendById = async (req, res) => {
  try {
    const { id } = req.params;

    const trendDoc = await db.collection('trends').doc(id).get();

    if (!trendDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Trend not found'
      });
    }

    const trend = {
      id: trendDoc.id,
      ...trendDoc.data()
    };

    logger.info(`Retrieved trend: ${id}`);

    res.json({
      success: true,
      trend
    });
  } catch (error) {
    logger.error(`Error fetching trend ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trend',
      message: error.message
    });
  }
};

/**
 * POST /api/trends/analyze
 * Trigger a new trend analysis
 */
exports.analyzeTrends = async (req, res) => {
  try {
    logger.info('Manual trend analysis triggered');

    const options = {
      includeVideos: true,
      competitors: req.body.competitors || ['slidingdoorco', 'glasspartitionsolutions'],
      keywords: req.body.keywords || ['glass doors', 'glass partitions', 'office glass']
    };

    // Run trend analysis
    const trendData = await aiEngine.analyzeTrends(options);

    // Store in Firebase
    const trendDoc = await db.collection('trends').add({
      ...trendData,
      triggeredBy: 'manual',
      createdAt: new Date().toISOString()
    });

    logger.info(`Trend analysis completed: ${trendDoc.id}`);

    res.json({
      success: true,
      message: 'Trend analysis completed',
      trendId: trendDoc.id,
      data: trendData
    });
  } catch (error) {
    logger.error('Error analyzing trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze trends',
      message: error.message
    });
  }
};

/**
 * DELETE /api/trends/:id
 * Delete a trend analysis
 */
exports.deleteTrend = async (req, res) => {
  try {
    const { id } = req.params;

    await db.collection('trends').doc(id).delete();

    logger.info(`Trend deleted: ${id}`);

    res.json({
      success: true,
      message: 'Trend deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting trend ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete trend',
      message: error.message
    });
  }
};
