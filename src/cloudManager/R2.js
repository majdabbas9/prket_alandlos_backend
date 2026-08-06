const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

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
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });
  return await s3Client.send(command);
}

async function putObject(key, body, contentType, bucketName = BUCKET_NAME) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  return await s3Client.send(command);
}

async function deleteObject(key, bucketName = BUCKET_NAME) {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });
  return await s3Client.send(command);
}

async function ObjectExists(key, bucketName = BUCKET_NAME) {
  try {
    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

module.exports = {
  getObject,
  putObject,
  deleteObject,
  ObjectExists
};

