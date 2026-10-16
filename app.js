const express = require('express');
const cors = require('cors');
const path = require('path');
const logger = require('./src/utils/logger').getLogger(__filename);
const productRoutes = require('./src/routes/productRoutes');
const homepageRoutes = require('./src/routes/homepageRoutes');
const logoRoutes = require('./src/routes/logoRoutes');
const infoRoutes = require('./src/routes/infoRoutes');

const app = express();

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(
      { method: req.method, url: req.originalUrl, status: res.statusCode, durationMs: duration },
      `HTTP ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`,
    );
  });
  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the committed default logo. Only uploads/logo: the rest of uploads/ holds multer temp
// files, which must never be reachable over HTTP
app.use(
  '/uploads/logo',
  express.static(path.join(__dirname, 'uploads/logo'), {
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }),
);

// Healthcheck route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Prket Alandlos Backend API (Node.js)',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/products', productRoutes);
app.use('/api/homepage-image', homepageRoutes);
app.use('/api/logo', logoRoutes);
app.use('/api/logo-image', logoRoutes);
app.use('/api/info', infoRoutes);

// Catch-all 404 handler
app.use((req, res) => {
  logger.warn(
    { method: req.method, url: req.originalUrl },
    `Route not found: ${req.method} ${req.originalUrl}`,
  );
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Global Error Handler
app.use((err, req, res, _next) => {
  if (err && (err.name === 'MulterError' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
    logger.warn(
      { err, method: req.method, url: req.originalUrl, field: err.field },
      `Multer upload error on ${req.method} ${req.originalUrl}: ${err.message}`,
    );
    return res.status(400).json({
      success: false,
      error: `File upload error: ${err.message}${err.field ? ` (field: '${err.field}')` : ''}`,
    });
  }

  logger.error(
    { err, method: req.method, url: req.originalUrl, status: err.status || 500 },
    `Unhandled Server Error on ${req.method} ${req.originalUrl}: ${err.message}`,
  );
  // 4xx errors carry a client-facing message; anything else may hold internals (R2, sharp, SDK)
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).json({
    success: false,
    error: status < 500 && err.message ? err.message : 'Internal Server Error',
  });
});

module.exports = app;
