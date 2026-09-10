const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');

const outputsDir = path.join(__dirname, '..', '..', 'outputs');

const cloudConfigured = !!(
  process.env.STORAGE_BUCKET &&
  process.env.STORAGE_ENDPOINT &&
  process.env.STORAGE_ACCESS_KEY_ID &&
  process.env.STORAGE_SECRET_ACCESS_KEY
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

function makeKey(prefix, ext) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${prefix}/${stamp}/${crypto.randomUUID()}.${ext}`;
}

function normalizeKey(key) {
  const value = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!value || value.includes('..') || value.includes('\0')) {
    throw new Error('Invalid storage key.');
  }
  return value;
}

function keyFromStoredValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('/')) {
    try { return normalizeKey(raw); } catch { return ''; }
  }

  if (raw.startsWith('/outputs/')) {
    try { return normalizeKey(raw.slice('/outputs/'.length)); } catch { return ''; }
  }

  const base = String(process.env.STORAGE_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (base && raw.startsWith(`${base}/`)) {
    try { return normalizeKey(decodeURIComponent(raw.slice(base.length + 1))); } catch { return ''; }
  }

  try {
    const pathname = decodeURIComponent(new URL(raw).pathname).replace(/^\/+/, '');
    const markers = ['users/', 'before/', 'after/'];
    for (const marker of markers) {
      const idx = pathname.indexOf(marker);
      if (idx >= 0) return normalizeKey(pathname.slice(idx));
    }
  } catch {}

  return '';
}

async function saveBuffer({ buffer, prefix = 'images', extension = 'jpg', contentType = 'image/jpeg' }) {
  const key = makeKey(prefix, extension);

  if (cloudConfigured) {
    await client.send(new PutObjectCommand({
      Bucket: process.env.STORAGE_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'private, max-age=300'
    }));
    return { key, mode: 'cloud' };
  }

  const safeKey = normalizeKey(key);
  const filePath = path.join(outputsDir, safeKey);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, buffer);
  return { key: safeKey, mode: 'local' };
}

async function readObject(key) {
  const safeKey = normalizeKey(key);

  if (cloudConfigured) {
    const result = await client.send(new GetObjectCommand({
      Bucket: process.env.STORAGE_BUCKET,
      Key: safeKey
    }));
    if (!result.Body) throw new Error('Stored image body is missing.');
    const bytes = await result.Body.transformToByteArray();
    return {
      buffer: Buffer.from(bytes),
      contentType: result.ContentType || 'application/octet-stream'
    };
  }

  const filePath = path.join(outputsDir, safeKey);
  const resolved = path.resolve(filePath);
  const root = path.resolve(outputsDir) + path.sep;
  if (!resolved.startsWith(root)) throw new Error('Invalid storage key.');
  return {
    buffer: await fsp.readFile(resolved),
    contentType:
      safeKey.endsWith('.png') ? 'image/png' :
      safeKey.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  };
}

async function deleteObject(key) {
  const safeKey = normalizeKey(key);

  if (cloudConfigured) {
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.STORAGE_BUCKET,
      Key: safeKey
    }));
    return;
  }

  const filePath = path.join(outputsDir, safeKey);
  const resolved = path.resolve(filePath);
  const root = path.resolve(outputsDir) + path.sep;
  if (!resolved.startsWith(root)) throw new Error('Invalid storage key.');
  await fsp.unlink(resolved).catch(err => {
    if (err?.code !== 'ENOENT') throw err;
  });
}

function storageMode() {
  return cloudConfigured ? 'private-cloud-s3-compatible' : 'private-local-files';
}

module.exports = {
  saveBuffer,
  readObject,
  deleteObject,
  keyFromStoredValue,
  storageMode,
  cloudConfigured
};
