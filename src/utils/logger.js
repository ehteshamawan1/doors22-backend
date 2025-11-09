/**
 * Simple logger utility
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.info;

function log(level, ...args) {
  if (LOG_LEVELS[level] <= currentLevel) {
    const timestamp = new Date().toISOString();
    console[level === 'error' ? 'error' : 'log'](`[${timestamp}] [${level.toUpperCase()}]`, ...args);
  }
}

module.exports = {
  error: (...args) => log('error', ...args),
  warn: (...args) => log('warn', ...args),
  info: (...args) => log('info', ...args),
  debug: (...args) => log('debug', ...args)
};
