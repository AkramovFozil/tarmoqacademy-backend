const fs = require('fs');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const requiredEnv = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
];

const getR2Config = () => {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Cloudflare R2 sozlamalari yetishmayapti: ${missing.join(', ')}`);
  }

  return {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    publicUrl: String(process.env.R2_PUBLIC_URL || '').replace(/\/+$/, ''),
  };
};

const createR2Client = () => {
  const config = getR2Config();

  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
};

const contentTypes = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const getContentType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  return contentTypes[ext] || 'application/octet-stream';
};

const normalizeKey = (key) => String(key || '')
  .replace(/\\/g, '/')
  .replace(/^\/+/, '')
  .replace(/\/{2,}/g, '/');

let r2Client;

const getClient = () => {
  if (!r2Client) {
    r2Client = createR2Client();
  }

  return r2Client;
};

const uploadFile = async ({ filePath, key, cacheControl }) => {
  const config = getR2Config();
  const normalizedKey = normalizeKey(key);

  await getClient().send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: normalizedKey,
    Body: fs.createReadStream(filePath),
    ContentType: getContentType(filePath),
    CacheControl: cacheControl || (normalizedKey.endsWith('.m3u8')
      ? 'private, max-age=30'
      : 'public, max-age=31536000, immutable'),
  }));

  return normalizedKey;
};

const walkFiles = async (dir) => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
};

const uploadDirectory = async ({ directory, keyPrefix }) => {
  const files = await walkFiles(directory);
  const uploaded = [];

  for (const filePath of files) {
    const relativePath = path.relative(directory, filePath).replace(/\\/g, '/');
    const key = normalizeKey(`${keyPrefix}/${relativePath}`);
    await uploadFile({ filePath, key });
    uploaded.push(key);
  }

  return uploaded;
};

const getObjectText = async (key) => {
  const config = getR2Config();
  const response = await getClient().send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: normalizeKey(key),
  }));

  return response.Body.transformToString('utf8');
};

const ensureObjectExists = async (key) => {
  const config = getR2Config();
  await getClient().send(new HeadObjectCommand({
    Bucket: config.bucket,
    Key: normalizeKey(key),
  }));
};

const createPresignedGetUrl = async ({ key, expiresIn = 3600 }) => {
  const config = getR2Config();
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: normalizeKey(key),
    }),
    { expiresIn }
  );
};

const getPublicUrl = (key) => {
  const config = getR2Config();
  return config.publicUrl ? `${config.publicUrl}/${normalizeKey(key)}` : '';
};

module.exports = {
  normalizeKey,
  uploadFile,
  uploadDirectory,
  getObjectText,
  ensureObjectExists,
  createPresignedGetUrl,
  getPublicUrl,
};
