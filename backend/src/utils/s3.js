const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { randomUUID } = require('crypto');

const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT || undefined, // leave unset for real AWS S3
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET;

/**
 * Uploads a buffer (e.g. from multer memoryStorage) directly to the bucket.
 * Returns the object key and a URL to read it back.
 */
async function uploadBuffer({ buffer, contentType, keyPrefix }) {
  const key = `${keyPrefix}/${randomUUID()}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));

  const publicBase = process.env.S3_PUBLIC_URL_BASE;
  const url = publicBase
    ? `${publicBase.replace(/\/$/, '')}/${key}`
    : await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 });

  return { key, url };
}

/** Generates a fresh, time-limited download URL for a private object. */
async function getSignedDownloadUrl(key, expiresIn = 3600) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

async function deleteObject(key) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { uploadBuffer, getSignedDownloadUrl, deleteObject };
