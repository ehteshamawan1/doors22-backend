const rateLimit = require('express-rate-limit');

/**
 * Rate limiting middleware
 * Skip rate limiting for trusted origins (dashboard)
 */
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500, // 500 requests per 15 min
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for requests from the dashboard
    const origin = req.get('origin') || req.get('referer') || '';
    const trustedOrigins = [
      'https://dashboard.doors22.com',
      'http://localhost:3000',
      'http://localhost:3001'
    ];
    return trustedOrigins.some(trusted => origin.includes(trusted));
  }
});

module.exports = limiter;
