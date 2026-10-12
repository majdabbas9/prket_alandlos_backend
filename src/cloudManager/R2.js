const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const logger = require('../utils/logger').getLogger(__filename);

// Cloudflare R2 configurations
const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'prket-andlos';
const ENDPOINT =
  process.env.R2_ENDPOINT || 'https://bdea2f34b203a609c98be2413d4f8aaa.r2.cloudflarestorage.com';

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
    logger.info(
      { bucket: bucketName, key, contentType: result.ContentType },
      'Successfully fetched R2 object',
    );
    return result;
  } catch (error) {
    logger.error({ err: error, bucket: bucketName, key }, 'Error fetching object from R2');
    throw error;
  }
}

async function putObject(key, body, contentType, bucketName = BUCKET_NAME, cacheControl) {
  const bodySize = Buffer.isBuffer(body) ? body.length : body ? body.length : null;
  logger.info(
    { bucket: bucketName, key, contentType, sizeBytes: bodySize },
    'Uploading object to R2',
  );
  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(cacheControl && { CacheControl: cacheControl }),
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

// True when an R2/S3 error means the object does not exist
function isNotFound(error) {
  return (
    error?.name === 'NotFound' ||
    error?.name === 'NoSuchKey' ||
    error?.$metadata?.httpStatusCode === 404
  );
}

async function headObject(key, bucketName = BUCKET_NAME) {
  logger.info({ bucket: bucketName, key }, 'Fetching R2 object metadata');
  try {
    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    return await s3Client.send(command);
  } catch (error) {
    if (!isNotFound(error)) {
      logger.error({ err: error, bucket: bucketName, key }, 'Error fetching R2 object metadata');
    }
    throw error;
  }
}

/**
 * Uploads an object only if no object exists under `key` yet (conditional PUT with
 * If-None-Match: *), so it can never overwrite existing data.
 * @returns {Promise<boolean>} true if created, false if the key already existed
 */
async function putObjectIfAbsent(key, body, contentType, bucketName = BUCKET_NAME) {
  logger.info({ bucket: bucketName, key, contentType }, 'Creating R2 object if absent');
  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      IfNoneMatch: '*',
    });
    await s3Client.send(command);
    logger.info({ bucket: bucketName, key }, 'Created R2 object');
    return true;
  } catch (error) {
    if (error.name === 'PreconditionFailed' || error.$metadata?.httpStatusCode === 412) {
      logger.info({ bucket: bucketName, key }, 'R2 object already exists, left unchanged');
      return false;
    }
    logger.error({ err: error, bucket: bucketName, key }, 'Error creating R2 object');
    throw error;
  }
}

module.exports = {
  getObject,
  putObject,
  deleteObject,
  headObject,
  putObjectIfAbsent,
  isNotFound,
};
