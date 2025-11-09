const logger = require('../utils/logger');

/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
  logger.error('Error:', err.message);
  logger.error('Stack:', err.stack);

  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    error: {
      message,
      status,
      timestamp: new Date().toISOString()
    }
  });
}

module.exports = errorHandler;
