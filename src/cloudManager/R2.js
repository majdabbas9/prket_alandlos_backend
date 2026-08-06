const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Cloudflare R2 configurations
const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'prket-andlos';
const ENDPOINT = process.env.R2_ENDPOINT || 'https://bdea2f34b203a609c98be2413d4f8aaa.r2.cloudflarestorage.com';

const accessKeyId = process.env.ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

const clientConfig = {
  endpoint: ENDPOINT,
  region: 'auto',
};

if (accessKeyId && secretAccessKey) {
  clientConfig.credentials = {
    accessKeyId,
    secretAccessKey,
  };
}

const s3Client = new S3Client(clientConfig);

/**
 * Retrieves an image object from R2.
 * @param {string} key
 * @returns {Promise<any>}
 */
async function getImage(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  return await s3Client.send(command);
}

/**
 * Uploads an image buffer or stream to R2.
 * @param {string} key
 * @param {Buffer|ReadableStream} body
 * @param {string} contentType
 * @returns {Promise<any>}
 */
async function uploadImage(key, body, contentType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  return await s3Client.send(command);
}

/**
 * Deletes an image from R2.
 * @param {string} key
 * @returns {Promise<any>}
 */
async function deleteImage(key) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  return await s3Client.send(command);
}

module.exports = {
  getImage,
  uploadImage,
  deleteImage,
};
