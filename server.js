require('dotenv').config();
const app = require('./app');
const logger = require('./src/utils/logger').getLogger(__filename);

const PORT = process.env.PORT || 8080;

// Start Server
app.listen(PORT, () => {
  logger.info(`🚀 Prket Alandlos Node.js Backend running at http://localhost:${PORT}`);
  logger.info('Registered Routes:');
  logger.info('- GET    /api/health         : Health check');
  logger.info('- GET    /api/products       : Fetch all products (supports ?search=, ?category=, ?sort=)');
  logger.info('- GET    /api/products/:id   : Fetch product by ID');
  logger.info('- POST   /api/products       : Add product (JSON imageUrl or file upload)');
  logger.info('- PUT    /api/products/:id   : Update product by ID');
  logger.info('- DELETE /api/products/:id   : Delete product by ID');
  logger.info('- GET    /api/products/photo : Proxy/serve photo by URL (?url=...)');
  logger.info('- GET    /api/homepage-image : Fetch homepage image metadata');
  logger.info('- POST   /api/homepage-image : Update homepage image (file upload or JSON imageUrl)');
  logger.info('- GET    /api/logo           : Fetch logo image file (or ?info=true for metadata)');
  logger.info('- POST   /api/logo           : Update logo image (file upload or JSON logoUrl)');
  logger.info('- GET    /api/info           : Fetch store information');
  logger.info('- POST   /api/info           : Update store information');
});

