const pino = require('pino');
const path = require('path');

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname'
    }
  } : undefined
});

/**
 * Creates a child logger pre-configured with a 'file' context attribute.
 * @param {string} [filename] - Absolute file path (e.g. __filename) or relative path string.
 * @returns {import('pino').Logger}
 */
const getLogger = (filename) => {
  if (!filename) return baseLogger;

  let relativePath = filename;
  if (path.isAbsolute(filename)) {
    relativePath = path.relative(process.cwd(), filename).replace(/\\/g, '/');
  }

  return baseLogger.child({ file: relativePath });
};

baseLogger.getLogger = getLogger;
baseLogger.createLogger = getLogger;

module.exports = baseLogger;
module.exports.getLogger = getLogger;
module.exports.createLogger = getLogger;

