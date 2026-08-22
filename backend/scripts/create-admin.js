require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/db');

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD in your .env first.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rows.length) {
    await pool.query(
      'UPDATE users SET password_hash = $1, is_admin = TRUE WHERE username = $2',
      [passwordHash, username]
    );
    console.log(`Updated existing user "${username}" to admin.`);
  } else {
    await pool.query(
      'INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, TRUE)',
      [username, passwordHash]
    );
    console.log(`Created admin user "${username}".`);
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
