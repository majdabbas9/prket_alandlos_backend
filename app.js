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
      `HTTP ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`
    );
  });
  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded image files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Healthcheck route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Prket Alandlos Backend API (Node.js)',
    timestamp: new Date().toISOString()
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
  logger.warn({ method: req.method, url: req.originalUrl }, `Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error(
    { err, method: req.method, url: req.originalUrl, status: err.status || 500 },
    `Unhandled Server Error on ${req.method} ${req.originalUrl}: ${err.message}`
  );
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

module.exports = app;

