require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');

// Import configurations
const { initializeFirebase } = require('./config/firebase');
const logger = require('./utils/logger');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const rateLimiter = require('./middleware/rateLimiter');

// Import routes
const routes = require('./routes');

// Import cron jobs
const dailyTrends = require('./cron/dailyTrends');
const contentGeneration = require('./cron/contentGeneration');
const posting = require('./cron/posting');
const analytics = require('./cron/analytics');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (required for Vercel/serverless environments)
app.set('trust proxy', 1);

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS Configuration - Allow dashboard deployments
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'http://localhost:3000',
      'https://doors22-dashboard.vercel.app'
    ];

    // Allow all Vercel preview deployments
    if (origin.match(/https:\/\/doors22-dashboard-.*\.vercel\.app$/)) {
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }

    callback(null, true); // Allow all for testing
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400 // 24 hours
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));
app.use(rateLimiter);

// Initialize Firebase
initializeFirebase();

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Doors22 AI Automation Backend',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      health: '/health',
      api: '/api/*'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '1.0.0'
  });
});

// API Routes
app.use('/api', routes);

// Error Handler (must be last)
app.use(errorHandler);

// Schedule Cron Jobs
if (process.env.NODE_ENV !== 'test') {
  // Daily trend analysis at 3:00 AM UTC
  cron.schedule(process.env.CRON_TREND_ANALYSIS || '0 3 * * *', () => {
    logger.info('Starting daily trend analysis...');
    dailyTrends.run().catch(err => logger.error('Trend analysis failed:', err));
  });

  // Content generation at 3:15 AM UTC
  cron.schedule(process.env.CRON_CONTENT_GENERATION || '15 3 * * *', () => {
    logger.info('Starting content generation...');
    contentGeneration.run().catch(err => logger.error('Content generation failed:', err));
  });

  // Auto-posting at 5:00 PM UTC (12 PM EST)
  cron.schedule(process.env.CRON_POSTING || '0 17 * * *', () => {
    logger.info('Starting auto-posting...');
    posting.run().catch(err => logger.error('Auto-posting failed:', err));
  });

  // Weekly analytics at Sunday midnight UTC
  cron.schedule(process.env.CRON_WEEKLY_ANALYTICS || '0 0 * * 0', () => {
    logger.info('Starting weekly analytics...');
    analytics.run().catch(err => logger.error('Weekly analytics failed:', err));
  });

  logger.info('All cron jobs scheduled successfully');
}

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Doors22 Backend running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`Firebase Project: ${process.env.FIREBASE_PROJECT_ID}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  process.exit(0);
});

module.exports = app;
