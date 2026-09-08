
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const outputsDir = path.join(__dirname, '..', '..', 'outputs');

const cloudConfigured = !!(
  process.env.STORAGE_BUCKET &&
  process.env.STORAGE_ENDPOINT &&
  process.env.STORAGE_ACCESS_KEY_ID &&
  process.env.STORAGE_SECRET_ACCESS_KEY &&
  process.env.STORAGE_PUBLIC_BASE_URL
);

let client = null;
if (cloudConfigured) {
  client = new S3Client({
    region: process.env.STORAGE_REGION || 'auto',
    endpoint: process.env.STORAGE_ENDPOINT,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY
    },
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true'
  });
}

function cleanBase(base) {
  return String(base || '').replace(/\/+$/, '');
}

function makeKey(prefix, ext) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${prefix}/${stamp}/${crypto.randomUUID()}.${ext}`;
}

async function saveBuffer({ buffer, prefix = 'images', extension = 'jpg', contentType = 'image/jpeg' }) {
  const key = makeKey(prefix, extension);

  if (cloudConfigured) {
    await client.send(new PutObjectCommand({
      Bucket: process.env.STORAGE_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable'
    }));
    return {
      key,
      url: `${cleanBase(process.env.STORAGE_PUBLIC_BASE_URL)}/${key}`,
      mode: 'cloud'
    };
  }

  const filePath = path.join(outputsDir, key);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, buffer);
  return {
    key,
    url: `/outputs/${key.replace(/\\/g, '/')}`,
    mode: 'local'
  };
}

function storageMode() {
  return cloudConfigured ? 'cloud-s3-compatible' : 'local-files';
}

module.exports = { saveBuffer, storageMode, cloudConfigured };
