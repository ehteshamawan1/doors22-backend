/**
 * Settings Controller
 * Handles system settings API endpoints
 */

const { db } = require('../config/firebase');
const logger = require('../utils/logger');

const SETTINGS_DOC_ID = 'system_settings';

/**
 * GET /api/settings
 * Get current system settings
 */
exports.getSettings = async (req, res) => {
  try {
    const settingsDoc = await db.collection('settings').doc(SETTINGS_DOC_ID).get();

    if (!settingsDoc.exists) {
      // Return default settings if none exist
      const defaultSettings = {
        postingTime: '17:00',
        contentMix: {
          images: 70,
          videos: 30
        },
        brandVoice: 'professional-inspirational',
        autoApproval: false,
        emailNotifications: true,
        modules: {
          trendAnalysisEnabled: true,
          contentGenerationEnabled: true,
          autoPostingEnabled: false
        },
        updatedAt: new Date().toISOString()
      };

      logger.info('Returning default settings');
      return res.json({
        success: true,
        settings: defaultSettings
      });
    }

    const settings = settingsDoc.data();
    logger.info('Retrieved settings from database');

    res.json({
      success: true,
      settings
    });
  } catch (error) {
    logger.error('Error fetching settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch settings',
      message: error.message
    });
  }
};

/**
 * PUT /api/settings
 * Update system settings
 */
exports.updateSettings = async (req, res) => {
  try {
    const {
      postingTime,
      contentMix,
      brandVoice,
      autoApproval,
      emailNotifications,
      modules
    } = req.body;

    const settings = {
      postingTime,
      contentMix,
      brandVoice,
      autoApproval,
      emailNotifications,
      modules,
      updatedAt: new Date().toISOString()
    };

    await db.collection('settings').doc(SETTINGS_DOC_ID).set(settings, { merge: true });

    logger.info('Settings updated successfully');

    res.json({
      success: true,
      message: 'Settings saved successfully',
      settings
    });
  } catch (error) {
    logger.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update settings',
      message: error.message
    });
  }
};
