const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const logger = require('../utils/logger').getLogger(__filename);

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

async function getObject(key, bucketName = BUCKET_NAME) {
  logger.info({ bucket: bucketName, key }, 'Fetching R2 object');
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    const result = await s3Client.send(command);
    logger.info({ bucket: bucketName, key, contentType: result.ContentType }, 'Successfully fetched R2 object');
    return result;
  } catch (error) {
    logger.error({ err: error, bucket: bucketName, key }, 'Error fetching object from R2');
    throw error;
  }
}

async function putObject(key, body, contentType, bucketName = BUCKET_NAME) {
  const bodySize = Buffer.isBuffer(body) ? body.length : (body ? body.length : null);
  logger.info({ bucket: bucketName, key, contentType, sizeBytes: bodySize }, 'Uploading object to R2');
  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    const result = await s3Client.send(command);
    logger.info({ bucket: bucketName, key }, 'Successfully uploaded object to R2');
    return result;
  } catch (error) {
    logger.error({ err: error, bucket: bucketName, key }, 'Error uploading object to R2');
    throw error;
  }
}

async function deleteObject(key, bucketName = BUCKET_NAME) {
  logger.info({ bucket: bucketName, key }, 'Deleting object from R2');
  try {
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    const result = await s3Client.send(command);
    logger.info({ bucket: bucketName, key }, 'Successfully deleted object from R2');
    return result;
  } catch (error) {
    logger.error({ err: error, bucket: bucketName, key }, 'Error deleting object from R2');
    throw error;
  }
}

async function ObjectExists(key, bucketName = BUCKET_NAME) {
  logger.info({ bucket: bucketName, key }, 'Checking R2 object existence');
  try {
    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    await s3Client.send(command);
    logger.info({ bucket: bucketName, key, exists: true }, 'R2 object exists');
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      logger.info({ bucket: bucketName, key, exists: false }, 'R2 object does not exist');
      return false;
    }
    logger.error({ err: error, bucket: bucketName, key }, 'Error checking R2 object existence');
    throw error;
  }
}

module.exports = {
  getObject,
  putObject,
  deleteObject,
  ObjectExists
};


