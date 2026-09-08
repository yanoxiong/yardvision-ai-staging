
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { Pool } = require('pg');

const usePostgres = !!process.env.DATABASE_URL;
const dataDir = path.join(__dirname, '..', '..', 'data');
const usersFile = path.join(dataDir, 'users.json');
const projectsFile = path.join(dataDir, 'projects.json');
const usageFile = path.join(dataDir, 'usage.json');

let pool = null;
if (usePostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
}

async function readJson(file) {
  try {
    return JSON.parse((await fsp.readFile(file, 'utf8')) || '[]');
  } catch {
    return [];
  }
}
async function writeJson(file, data) {
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function ensureDatabaseReady() {
  if (!usePostgres) {
    await fsp.mkdir(dataDir, { recursive: true });
    for (const file of [usersFile, projectsFile, usageFile]) {
      if (!fs.existsSync(file)) await writeJson(file, []);
    }
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      email_verify_token_hash TEXT,
      email_verify_expires_at TIMESTAMPTZ,
      password_reset_token_hash TEXT,
      password_reset_expires_at TIMESTAMPTZ,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      style TEXT,
      budget TEXT,
      features JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes TEXT,
      before_image TEXT NOT NULL,
      after_image TEXT NOT NULL,
      estimate TEXT,
      variation INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'design',
      units INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stripe_events (
      id BIGSERIAL PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function makeStore() {
  if (!usePostgres) return undefined;
  const PgStore = connectPgSimple(session);
  return new PgStore({ pool, tableName: 'session', createTableIfMissing: true });
}

function getSessionCookieConfig() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 14
  };
}

function normalizeUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash ?? row.passwordHash,
    plan: row.plan || 'free',
    emailVerified: Boolean(row.email_verified ?? row.emailVerified),
    emailVerifyTokenHash: row.email_verify_token_hash ?? row.emailVerifyTokenHash ?? null,
    emailVerifyExpiresAt: row.email_verify_expires_at ?? row.emailVerifyExpiresAt ?? null,
    passwordResetTokenHash: row.password_reset_token_hash ?? row.passwordResetTokenHash ?? null,
    passwordResetExpiresAt: row.password_reset_expires_at ?? row.passwordResetExpiresAt ?? null,
    stripeCustomerId: row.stripe_customer_id ?? row.stripeCustomerId ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? row.stripeSubscriptionId ?? null,
    createdAt: row.created_at ?? row.createdAt
  };
}

function normalizeProject(row) {
  let features = row.features || [];
  if (typeof features === 'string') {
    try { features = JSON.parse(features || '[]'); } catch { features = []; }
  }
  return {
    id: Number(row.id),
    userId: Number(row.user_id ?? row.userId),
    name: row.name,
    style: row.style || '',
    budget: row.budget || '',
    features: Array.isArray(features) ? features : [],
    notes: row.notes || '',
    before: row.before_image ?? row.before,
    after: row.after_image ?? row.after,
    estimate: row.estimate || '',
    variation: Number(row.variation || 1),
    createdAt: row.created_at ?? row.createdAt
  };
}

async function createUser({ name, email, passwordHash }) {
  if (!usePostgres) {
    const users = await readJson(usersFile);
    if (users.some(u => u.email === email)) throw new Error('duplicate_email');
    const user = {
      id: Date.now(),
      name,
      email,
      passwordHash,
      plan: 'free',
      emailVerified: false,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    await writeJson(usersFile, users);
    return normalizeUser(user);
  }

  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash, plan, email_verified)
     VALUES ($1,$2,$3,'free',FALSE)
     RETURNING *`,
    [name, email, passwordHash]
  );
  return normalizeUser(result.rows[0]);
}

async function findUserByEmail(email) {
  if (!usePostgres) {
    const users = await readJson(usersFile);
    return normalizeUser(users.find(u => u.email === email) || null);
  }
  const result = await pool.query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [email]);
  return normalizeUser(result.rows[0]);
}

async function findUserById(id) {
  if (!usePostgres) {
    const users = await readJson(usersFile);
    return normalizeUser(users.find(u => Number(u.id) === Number(id)) || null);
  }
  const result = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [id]);
  return normalizeUser(result.rows[0]);
}

async function patchUser(userId, patch) {
  if (!usePostgres) {
    const users = await readJson(usersFile);
    const idx = users.findIndex(u => Number(u.id) === Number(userId));
    if (idx < 0) return null;
    users[idx] = { ...users[idx], ...patch };
    await writeJson(usersFile, users);
    return normalizeUser(users[idx]);
  }

  const map = {
    name: 'name',
    passwordHash: 'password_hash',
    plan: 'plan',
    emailVerified: 'email_verified',
    emailVerifyTokenHash: 'email_verify_token_hash',
    emailVerifyExpiresAt: 'email_verify_expires_at',
    passwordResetTokenHash: 'password_reset_token_hash',
    passwordResetExpiresAt: 'password_reset_expires_at',
    stripeCustomerId: 'stripe_customer_id',
    stripeSubscriptionId: 'stripe_subscription_id'
  };

  const sets = [];
  const values = [];
  let i = 1;
  for (const [key, value] of Object.entries(patch)) {
    if (!map[key]) continue;
    sets.push(`${map[key]} = $${i++}`);
    values.push(value);
  }
  if (!sets.length) return findUserById(userId);
  values.push(userId);

  const result = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return normalizeUser(result.rows[0]);
}

async function findUserByVerificationTokenHash(tokenHash) {
  if (!usePostgres) {
    const users = await readJson(usersFile);
    return normalizeUser(users.find(u => u.emailVerifyTokenHash === tokenHash) || null);
  }
  const result = await pool.query(
    `SELECT * FROM users WHERE email_verify_token_hash = $1 LIMIT 1`,
    [tokenHash]
  );
  return normalizeUser(result.rows[0]);
}

async function findUserByPasswordResetTokenHash(tokenHash) {
  if (!usePostgres) {
    const users = await readJson(usersFile);
    return normalizeUser(users.find(u => u.passwordResetTokenHash === tokenHash) || null);
  }
  const result = await pool.query(
    `SELECT * FROM users WHERE password_reset_token_hash = $1 LIMIT 1`,
    [tokenHash]
  );
  return normalizeUser(result.rows[0]);
}

async function saveProject(userId, payload) {
  if (!usePostgres) {
    const projects = await readJson(projectsFile);
    const project = {
      id: Date.now(),
      userId: Number(userId),
      name: payload.name,
      style: payload.style || '',
      budget: payload.budget || '',
      features: payload.features || [],
      notes: payload.notes || '',
      before: payload.before,
      after: payload.after,
      estimate: payload.estimate || '',
      variation: payload.variation || 1,
      createdAt: new Date().toISOString()
    };
    projects.unshift(project);
    await writeJson(projectsFile, projects);
    return normalizeProject(project);
  }

  const result = await pool.query(
    `INSERT INTO projects
     (user_id,name,style,budget,features,notes,before_image,after_image,estimate,variation)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      userId,
      payload.name,
      payload.style || '',
      payload.budget || '',
      JSON.stringify(payload.features || []),
      payload.notes || '',
      payload.before,
      payload.after,
      payload.estimate || '',
      payload.variation || 1
    ]
  );
  return normalizeProject(result.rows[0]);
}

async function getProjectsForUser(userId) {
  if (!usePostgres) {
    const projects = await readJson(projectsFile);
    return projects
      .filter(p => Number(p.userId) === Number(userId))
      .map(normalizeProject);
  }
  const result = await pool.query(
    `SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map(normalizeProject);
}

async function deleteProjectForUser(projectId, userId) {
  if (!usePostgres) {
    const projects = await readJson(projectsFile);
    const filtered = projects.filter(
      p => !(Number(p.id) === Number(projectId) && Number(p.userId) === Number(userId))
    );
    await writeJson(projectsFile, filtered);
    return;
  }
  await pool.query(`DELETE FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
}

function monthStartIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

async function countUsageThisMonth(userId) {
  const start = monthStartIso();

  if (!usePostgres) {
    const usage = await readJson(usageFile);
    return usage
      .filter(e => Number(e.userId) === Number(userId) && e.kind === 'design' && e.createdAt >= start)
      .reduce((sum, e) => sum + Number(e.units || 1), 0);
  }

  const result = await pool.query(
    `SELECT COALESCE(SUM(units),0)::int AS used
     FROM usage_events
     WHERE user_id = $1 AND kind = 'design'
       AND created_at >= date_trunc('month', NOW())`,
    [userId]
  );
  return Number(result.rows[0]?.used || 0);
}

async function recordUsage(userId, units = 1) {
  if (!usePostgres) {
    const usage = await readJson(usageFile);
    usage.push({
      id: Date.now(),
      userId: Number(userId),
      kind: 'design',
      units: Number(units || 1),
      createdAt: new Date().toISOString()
    });
    await writeJson(usageFile, usage);
    return;
  }

  await pool.query(
    `INSERT INTO usage_events (user_id, kind, units) VALUES ($1,'design',$2)`,
    [userId, units]
  );
}

async function updateUserStripeStatus(userId, patch) {
  return patchUser(userId, patch);
}

async function findUserByStripeCustomerId(customerId) {
  if (!usePostgres) {
    const users = await readJson(usersFile);
    return normalizeUser(users.find(u => u.stripeCustomerId === customerId) || null);
  }
  const result = await pool.query(
    `SELECT * FROM users WHERE stripe_customer_id = $1 LIMIT 1`,
    [customerId]
  );
  return normalizeUser(result.rows[0]);
}

async function recordStripeEvent(eventId, eventType) {
  if (!usePostgres) return;
  await pool.query(
    `INSERT INTO stripe_events (event_id,event_type)
     VALUES ($1,$2) ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType]
  );
}

module.exports = {
  ensureDatabaseReady,
  makeStore,
  getSessionCookieConfig,
  createUser,
  findUserByEmail,
  findUserById,
  patchUser,
  findUserByVerificationTokenHash,
  findUserByPasswordResetTokenHash,
  saveProject,
  getProjectsForUser,
  deleteProjectForUser,
  countUsageThisMonth,
  recordUsage,
  updateUserStripeStatus,
  findUserByStripeCustomerId,
  recordStripeEvent
};
