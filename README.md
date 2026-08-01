# Prket Alandlos - Backend REST API Documentation

A full-featured, robust Node.js & Express RESTful API for **Prket Alandlos**, supporting product management, category filtering, search, pagination, dynamic sorting, image upload processing via Multer, and remote image proxying.

---

## 🛠️ Requirements & Tech Stack

- **Runtime**: Node.js (v14+ recommended)
- **Framework**: Express.js
- **File Uploads**: Multer (`multipart/form-data`)
- **CORS**: Enabled for cross-origin requests
- **Data Store**: Local JSON storage (`src/data/products.json`) & static upload directory (`uploads/`)

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment & Configuration
By default, the server runs on port **`5000`** (or respects the `PORT` environment variable).

### 3. Start the Server
- **Development Mode** (with Nodemon):
  ```bash
  npm run dev
  ```
- **Production / Standard Mode**:
  ```bash
  npm start
  ```

Default Base URL: `http://localhost:5000`

---

## 📋 API Overview Table

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status and timestamp |
| `GET` | `/api/products` | Retrieve products (supports search, category, sort, pagination) |
| `GET` | `/api/products/:id` | Retrieve single product by unique ID |
| `POST` | `/api/products` | Create a new product (JSON or file upload via `image` field) |
| `PUT` | `/api/products/:id` | Update an existing product by ID |
| `DELETE` | `/api/products/:id` | Delete product and remove associated uploaded image file |
| `GET` | `/api/products/photo` | Proxy remote image stream or stream local uploaded image file |

---

## 📖 Detailed Endpoint Documentation

### 1. Health Check
Checks if the backend API is up and running.

- **Method**: `GET`
- **URL**: `/api/health`
- **Headers**: None

#### Success Response (`200 OK`)
```json
{
  "status": "ok",
  "service": "Prket Alandlos Backend API (Node.js)",
  "timestamp": "2026-08-01T14:10:00.000Z"
}
```

---

### 2. Get All Products
Retrieves products stored in the database. Supports searching, category filtering, custom sorting, and pagination.

- **Method**: `GET`
- **URL**: `/api/products`
- **Query Parameters**:

| Parameter | Type | Required | Description | Example |
|---|---|---|---|---|
| `search` | `string` | No | Search query matching product title, description, or category (case-insensitive) | `?search=oak` |
| `category` | `string` | No | Filter products by exact category (case-insensitive) | `?category=Parquet` |
| `sort` | `string` | No | Sort order. Options: `newest` *(default)*, `oldest`, `price_asc`, `price_desc` | `?sort=price_asc` |
| `page` | `integer` | No | Page number for pagination (must be paired with `limit`) | `?page=1` |
| `limit` | `integer` | No | Number of items per page | `?limit=10` |

#### Standard Response (`200 OK` without pagination)
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "prod_1",
      "title": "Oak Parquet Classic",
      "price": 45.00,
      "category": "Parquet",
      "description": "High quality natural oak parquet flooring",
      "imageUrl": "/uploads/1722510000000-oak.jpg",
      "dateOfUpload": "2026-08-01T10:00:00.000Z"
    }
  ]
}
```

#### Paginated Response (`200 OK` when `page` and `limit` are passed)
```json
{
  "success": true,
  "count": 10,
  "total": 25,
  "page": 1,
  "totalPages": 3,
  "data": [ ... ]
}
```

---

### 3. Get Product by ID
Retrieves details of a single product using its unique identifier.

- **Method**: `GET`
- **URL**: `/api/products/:id`
- **Path Parameters**:
  - `id` (`string`, required): Unique product identifier (e.g. `prod_123456`).

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": "prod_123456",
    "title": "Luxury Marble Tile",
    "price": 89.99,
    "category": "Tiles",
    "description": "Italian polished marble tile",
    "imageUrl": "https://example.com/marble.jpg",
    "dateOfUpload": "2026-08-01T12:00:00.000Z"
  }
}
```

#### Error Response (`404 Not Found`)
```json
{
  "success": false,
  "error": "Product with ID 'prod_999' not found"
}
```

---

### 4. Create Product
Creates a new product record. Supports both JSON payload (with `imageUrl`) and `multipart/form-data` payload for uploading an image file directly.

- **Method**: `POST`
- **URL**: `/api/products`
- **Headers**:
  - For JSON: `Content-Type: application/json`
  - For File Upload: `Content-Type: multipart/form-data`

#### Request Body Fields

| Field Name | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | No (default: `"Untitled Product"`) | Product title |
| `price` | `number` | No (default: `0`) | Price per unit |
| `category` | `string` | No (default: `"General"`) | Category name |
| `description` | `string` | No (default: `""`) | Product description |
| `imageUrl` | `string` | **Required if no file uploaded** | Valid image URL string |
| `image` | `file` | **Required if no `imageUrl` provided** | Image file attachment (`.jpg`, `.png`, `.webp`, `.svg`, etc.) |

#### Example A: JSON Payload
```json
{
  "title": "Solid Walnut Flooring",
  "price": 64.50,
  "category": "Parquet",
  "description": "Durable dark walnut wood planks",
  "imageUrl": "https://images.unsplash.com/photo-1513694203232-719a280e022f"
}
```

#### Example B: Multipart Form-Data (Postman / cURL)
- Key `image` (File): `[ Select image file ]`
- Key `title` (Text): `Solid Walnut Flooring`
- Key `price` (Text): `64.50`
- Key `category` (Text): `Parquet`
- Key `description` (Text): `Durable dark walnut wood planks`

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "message": "Product added successfully",
  "data": {
    "id": "prod_a1b2c3d4-e5f6-7890",
    "title": "Solid Walnut Flooring",
    "price": 64.50,
    "category": "Parquet",
    "description": "Durable dark walnut wood planks",
    "imageUrl": "/uploads/1722510500000-walnut.jpg",
    "dateOfUpload": "2026-08-01T14:05:00.000Z"
  }
}
```

#### Error Response (`400 Bad Request`)
```json
{
  "success": false,
  "error": "Image is required. Provide an \"imageUrl\" string or upload a file using field name \"image\"."
}
```

---

### 5. Update Product
Updates fields of an existing product by ID. Supports JSON body or file upload (`multipart/form-data`).

- **Method**: `PUT`
- **URL**: `/api/products/:id`
- **Path Parameters**:
  - `id` (`string`, required): Unique product identifier.
- **Headers**: `Content-Type: application/json` OR `Content-Type: multipart/form-data`

#### Request Body (JSON Example)
```json
{
  "title": "Updated Walnut Flooring",
  "price": 59.99
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Product updated successfully",
  "data": {
    "id": "prod_a1b2c3d4-e5f6-7890",
    "title": "Updated Walnut Flooring",
    "price": 59.99,
    "category": "Parquet",
    "description": "Durable dark walnut wood planks",
    "imageUrl": "/uploads/1722510500000-walnut.jpg",
    "dateOfUpload": "2026-08-01T14:05:00.000Z",
    "updatedAt": "2026-08-01T14:10:00.000Z"
  }
}
```

---

### 6. Delete Product
Deletes a product by ID. If the product references a locally uploaded file in `/uploads/`, the physical file is also automatically deleted from the server filesystem.

- **Method**: `DELETE`
- **URL**: `/api/products/:id`
- **Path Parameters**:
  - `id` (`string`, required): Unique product identifier.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Product 'prod_a1b2c3d4-e5f6-7890' deleted successfully",
  "data": {
    "id": "prod_a1b2c3d4-e5f6-7890",
    "title": "Updated Walnut Flooring",
    "price": 59.99,
    "category": "Parquet",
    "description": "Durable dark walnut wood planks",
    "imageUrl": "/uploads/1722510500000-walnut.jpg",
    "dateOfUpload": "2026-08-01T14:05:00.000Z"
  }
}
```

---

### 7. Proxy Photo Stream
Streams a local uploaded image file or proxies a remote external image via HTTP buffer stream to prevent CORS issues on client applications.

- **Method**: `GET`
- **URL**: `/api/products/photo`
- **Query Parameters**:

| Parameter | Type | Required | Description | Example |
|---|---|---|---|---|
| `url` | `string` | **Yes** | Target local image path (`/uploads/...`) or external HTTP image URL | `/api/products/photo?url=/uploads/photo.jpg` |

#### Success Response (`200 OK`)
- **Headers**:
  - `Content-Type`: `image/jpeg` (or appropriate MIME type)
  - `Cache-Control`: `public, max-age=86400`
- **Body**: Binary image buffer stream.

---

## 📁 Directory Structure

```
backend/
├── app.js                 # Express application setup & middleware
├── server.js              # HTTP server entrypoint
├── package.json           # Project dependencies & scripts
├── README.md              # Project & API Documentation
├── uploads/               # Stored uploaded images
└── src/
    ├── controllers/
    │   └── productController.js   # Request handlers & logic
    ├── data/
    │   └── products.json         # JSON data store
    ├── middleware/
    │   └── upload.js             # Multer upload middleware setup
    └── routes/
        └── productRoutes.js      # Endpoint route definitions
```

---

## 🧪 Testing

Run test suite:
```bash
npm test
```
