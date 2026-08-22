// Swappable storage backend. Defaults to local disk (no third-party account needed).
// Set STORAGE_DRIVER=s3 in .env (plus the S3_* variables) to switch to real S3-compatible
// object storage later — e.g. when deploying somewhere the local disk won't persist,
// or when you outgrow storing files on a single server. No other code needs to change.
const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();

module.exports = driver === 's3' ? require('./s3') : require('./localStorage');
