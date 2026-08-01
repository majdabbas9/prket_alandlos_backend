const app = require('./app');

const PORT = process.env.PORT || 8080;

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Prket Alandlos Node.js Backend running at http://localhost:${PORT}`);
  console.log(`- GET    /api/health         : Health check`);
  console.log(`- GET    /api/products       : Fetch all products (supports ?search=, ?category=, ?sort=)`);
  console.log(`- GET    /api/products/:id   : Fetch product by ID`);
  console.log(`- POST   /api/products       : Add product (JSON imageUrl or file upload)`);
  console.log(`- PUT    /api/products/:id   : Update product by ID`);
  console.log(`- DELETE /api/products/:id   : Delete product by ID`);
  console.log(`- GET    /api/products/photo : Proxy/serve photo by URL (?url=...)`);
});
