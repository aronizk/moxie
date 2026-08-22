const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Files live under backend/uploads/<keyPrefix>/<random>.<ext> — entirely on this server's
// own disk, no third-party account or credentials required.
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/**
 * Saves a buffer to local disk and returns a data: URL representing it.
 * Returning a data URL (rather than a real network path) means the calling route can hand
 * this straight to the browser after its own authorization check, with no separate public
 * file server needed — the download link only ever comes from an already-authorized request.
 */
async function uploadBuffer({ buffer, contentType, keyPrefix }) {
  const dir = path.join(UPLOADS_ROOT, keyPrefix);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${EXT_BY_MIME[contentType] || 'bin'}`;
  fs.writeFileSync(path.join(dir, filename), buffer);

  const key = `${keyPrefix}/${filename}`;
  const url = `data:${contentType};base64,${buffer.toString('base64')}`;
  return { key, url };
}

/** Re-reads the file from disk and returns it as a data: URL. */
async function getSignedDownloadUrl(key) {
  const filePath = path.join(UPLOADS_ROOT, key);
  if (!fs.existsSync(filePath)) {
    const err = new Error('File not found on disk');
    err.status = 404;
    throw err;
  }
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

async function deleteObject(key) {
  if (!key) return;
  const filePath = path.join(UPLOADS_ROOT, key);
  await fs.promises.unlink(filePath).catch(() => { /* already gone — fine */ });
}

module.exports = { uploadBuffer, getSignedDownloadUrl, deleteObject };
