require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { createSessionToken, hashPassword, verifyPassword, verifySessionToken } = require('./auth');

const app = express();
const PORT = Number(process.env.PORT || 8000);
const AUTH_SECRET = process.env.AUTH_SECRET;
const SESSION_COOKIE = 'hrms_session';
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@hrms.local').trim().toLowerCase();
const DEFAULT_ADMIN_NAME = process.env.ADMIN_NAME || 'HRMS Administrator';

if (!AUTH_SECRET || Buffer.byteLength(AUTH_SECRET) < 32) {
  throw new Error('AUTH_SECRET must contain at least 32 bytes');
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'hrms_admin',
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || 'hrms_dev'
});

const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '10kb' }));

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}

function getSessionToken(req) {
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));

  if (!cookie) return null;

  try {
    return decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1));
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const token = getSessionToken(req);
  const session = token && verifySessionToken(token, AUTH_SECRET);

  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const result = await pool.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       COALESCE(
         ARRAY_AGG(DISTINCT p.permission_key) FILTER (WHERE p.permission_key IS NOT NULL),
         '{}'
       ) AS permissions,
       COALESCE(
         ARRAY_AGG(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL),
         '{}'
       ) AS groups
     FROM users u
     LEFT JOIN user_groups ug ON ug.user_id = u.id
     LEFT JOIN groups g ON g.id = ug.group_id
     LEFT JOIN group_permissions gp ON gp.group_id = g.id
     LEFT JOIN permissions p ON p.id = gp.permission_id
     WHERE u.id = $1
     GROUP BY u.id`,
    [session.sub]
  );

  if (result.rowCount === 0) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Authentication required' });
  }

  req.user = result.rows[0];
  req.permissions = result.rows[0].permissions;
  next();
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.permissions?.includes(permissionKey)) {
      return res.status(403).json({ error: 'You do not have permission to access this resource' });
    }

    next();
  };
}

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', service: 'HRMS Backend API' });
});

app.post('/api/v1/auth/register', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!name || name.length > 100) {
    return res.status(400).json({ error: 'Name must be between 1 and 100 characters' });
  }

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 128) {
    return res.status(400).json({ error: 'Password must be at least 12 characters and no more than 128 bytes' });
  }

  const passwordHash = await hashPassword(password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, passwordHash]
    );
    const user = result.rows[0];
    await client.query(
      `INSERT INTO user_groups (user_id, group_id)
       SELECT $1, id FROM groups WHERE name = 'employee'
       ON CONFLICT DO NOTHING`,
      [user.id]
    );
    await client.query('COMMIT');
    setSessionCookie(res, createSessionToken(user.id, AUTH_SECRET));
    res.status(201).json({ user });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/v1/auth/login', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (Buffer.byteLength(password, 'utf8') > 128) {
    return res.status(400).json({ error: 'Password must be no more than 128 bytes' });
  }

  const result = await pool.query(
    'SELECT id, name, email, password_hash FROM users WHERE email = $1',
    [email]
  );
  const user = result.rows[0];

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  setSessionCookie(res, createSessionToken(user.id, AUTH_SECRET));
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/v1/auth/me', requireAuth, (req, res) => {
  const { permissions, groups, ...user } = req.user;
  res.json({ user, permissions, groups });
});

app.post('/api/v1/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

app.get('/api/v1/pages/:pageKey/access', requireAuth, (req, res, next) => {
  const permissionKey = `page.${req.params.pageKey}`;
  if (!/^page\.[a-z0-9_-]+$/.test(permissionKey)) {
    return res.status(404).json({ error: 'Page not found' });
  }
  req.requiredPermission = permissionKey;
  next();
}, (req, res, next) => requirePermission(req.requiredPermission)(req, res, () => {
  res.json({ allowed: true });
}));

app.get('/api/v1/admin/permissions', requireAuth, requirePermission('admin.manage'), async (req, res) => {
  const result = await pool.query(
    'SELECT permission_key, description FROM permissions ORDER BY permission_key'
  );
  res.json({ permissions: result.rows });
});

app.get('/api/v1/admin/groups', requireAuth, requirePermission('admin.manage'), async (req, res) => {
  const result = await pool.query(
    `SELECT
       g.id,
       g.name,
       g.created_at,
       COALESCE(
         JSON_AGG(JSON_BUILD_OBJECT(
           'key', p.permission_key,
           'description', p.description
         )) FILTER (WHERE p.id IS NOT NULL),
         '[]'
       ) AS permissions
     FROM groups g
     LEFT JOIN group_permissions gp ON gp.group_id = g.id
     LEFT JOIN permissions p ON p.id = gp.permission_id
     GROUP BY g.id
     ORDER BY g.name`
  );
  res.json({ groups: result.rows });
});

app.get('/api/v1/admin/users', requireAuth, requirePermission('admin.manage'), async (req, res) => {
  const result = await pool.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       COALESCE(
         JSON_AGG(JSON_BUILD_OBJECT('id', g.id, 'name', g.name))
           FILTER (WHERE g.id IS NOT NULL),
         '[]'
       ) AS groups
     FROM users u
     LEFT JOIN user_groups ug ON ug.user_id = u.id
     LEFT JOIN groups g ON g.id = ug.group_id
     GROUP BY u.id
     ORDER BY u.email`
  );
  res.json({ users: result.rows });
});

app.post('/api/v1/admin/groups', requireAuth, requirePermission('admin.manage'), async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9 _-]{1,59}$/.test(name)) {
    return res.status(400).json({ error: 'Group name must be 2–60 characters using letters, numbers, spaces, _ or -' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO groups (name) VALUES ($1) RETURNING id, name',
      [name]
    );
    res.status(201).json({ group: { ...result.rows[0], permissions: [] } });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A group with this name already exists' });
    }
    throw error;
  }
});

app.put('/api/v1/admin/groups/:groupId/permissions', requireAuth, requirePermission('admin.manage'), async (req, res) => {
  const { groupId } = req.params;
  const permissionKeys = req.body?.permissionKeys;
  if (!/^\d+$/.test(groupId) || !Array.isArray(permissionKeys) ||
      permissionKeys.some((key) => typeof key !== 'string') ||
      new Set(permissionKeys).size !== permissionKeys.length) {
    return res.status(400).json({ error: 'A group id and a unique list of permission keys are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(743198221)');
    const group = await client.query('SELECT id FROM groups WHERE id = $1 FOR UPDATE', [groupId]);
    if (group.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Group not found' });
    }

    const permissions = await client.query(
      'SELECT id, permission_key FROM permissions WHERE permission_key = ANY($1::text[])',
      [permissionKeys]
    );
    if (permissions.rowCount !== permissionKeys.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'One or more permission keys are invalid' });
    }

    const adminPermissionIncluded = permissionKeys.includes('admin.manage');
    if (!adminPermissionIncluded) {
      const remainingAdmins = await client.query(
        `SELECT COUNT(DISTINCT ug.user_id) AS count
         FROM user_groups ug
         JOIN group_permissions gp ON gp.group_id = ug.group_id
         JOIN permissions p ON p.id = gp.permission_id
         WHERE p.permission_key = 'admin.manage' AND ug.group_id <> $1`,
        [groupId]
      );
      if (Number(remainingAdmins.rows[0].count) === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'At least one user must retain admin management access' });
      }
    }

    await client.query('DELETE FROM group_permissions WHERE group_id = $1', [groupId]);
    if (permissions.rows.length > 0) {
      await client.query(
        `INSERT INTO group_permissions (group_id, permission_id)
         SELECT $1, permission_id FROM UNNEST($2::bigint[]) AS permission_ids(permission_id)`,
        [groupId, permissions.rows.map((permission) => permission.id)]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.put('/api/v1/admin/users/:userId/groups', requireAuth, requirePermission('admin.manage'), async (req, res) => {
  const { userId } = req.params;
  const groupIds = req.body?.groupIds;
  if (!/^\d+$/.test(userId) || !Array.isArray(groupIds) ||
      groupIds.some((id) => typeof id !== 'string' || !/^\d+$/.test(id)) ||
      new Set(groupIds).size !== groupIds.length) {
    return res.status(400).json({ error: 'A user id and a unique list of group ids are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(743198221)');
    const targetUser = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (targetUser.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const groups = await client.query(
      'SELECT id FROM groups WHERE id = ANY($1::bigint[])',
      [groupIds]
    );
    if (groups.rowCount !== groupIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'One or more group ids are invalid' });
    }

    const currentAdmins = await client.query(
      `SELECT COUNT(DISTINCT ug.user_id) AS count
       FROM user_groups ug
       JOIN group_permissions gp ON gp.group_id = ug.group_id
       JOIN permissions p ON p.id = gp.permission_id
       WHERE p.permission_key = 'admin.manage' AND ug.user_id <> $1`,
      [userId]
    );
    const targetGroups = await client.query(
      `SELECT COUNT(*) AS count
       FROM group_permissions gp
       JOIN permissions p ON p.id = gp.permission_id
       WHERE p.permission_key = 'admin.manage' AND gp.group_id = ANY($1::bigint[])`,
      [groupIds]
    );
    if (Number(currentAdmins.rows[0].count) === 0 && Number(targetGroups.rows[0].count) === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'At least one user must retain admin management access' });
    }

    await client.query('DELETE FROM user_groups WHERE user_id = $1', [userId]);
    if (groupIds.length > 0) {
      await client.query(
        `INSERT INTO user_groups (user_id, group_id)
         SELECT $1, group_id FROM UNNEST($2::bigint[]) AS group_ids(group_id)`,
        [userId, groupIds]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.use((error, req, res, next) => {
  console.error('Unhandled API error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  if (typeof process.env.ADMIN_PASSWORD !== 'string' ||
      process.env.ADMIN_PASSWORD.length < 12 ||
      Buffer.byteLength(process.env.ADMIN_PASSWORD, 'utf8') > 128) {
    throw new Error('ADMIN_PASSWORD must be set to a value of 12–128 bytes');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(DEFAULT_ADMIN_EMAIL) ||
      Buffer.byteLength(DEFAULT_ADMIN_EMAIL) > 254) {
    throw new Error('ADMIN_EMAIL must be a valid email address');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(60) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id BIGSERIAL PRIMARY KEY,
      permission_key VARCHAR(100) NOT NULL UNIQUE,
      description VARCHAR(200) NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_groups (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, group_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_permissions (
      group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, permission_id)
    )
  `);

  const pages = [
    ['page.dashboard', 'Access the dashboard'],
    ['page.profile', 'Access the profile page'],
    ['page.attendance', 'Access time and attendance'],
    ['page.payroll', 'Access payroll and benefits'],
    ['admin.manage', 'Manage users, groups, and permissions']
  ];
  for (const [permissionKey, description] of pages) {
    await pool.query(
      `INSERT INTO permissions (permission_key, description) VALUES ($1, $2)
       ON CONFLICT (permission_key) DO UPDATE SET description = EXCLUDED.description`,
      [permissionKey, description]
    );
  }

  await pool.query(
    `INSERT INTO groups (name) VALUES ('employee'), ('admin')
     ON CONFLICT (name) DO NOTHING`
  );
  const permissionAssignments = await pool.query(
    'SELECT COUNT(*) AS count FROM group_permissions'
  );
  if (Number(permissionAssignments.rows[0].count) === 0) {
    await pool.query(
      `INSERT INTO group_permissions (group_id, permission_id)
       SELECT g.id, p.id
       FROM groups g
       CROSS JOIN permissions p
       WHERE (g.name = 'employee' AND p.permission_key LIKE 'page.%')
          OR g.name = 'admin'
       ON CONFLICT DO NOTHING`
    );
  }

  await pool.query(
    `INSERT INTO user_groups (user_id, group_id)
     SELECT u.id, g.id
     FROM users u
     CROSS JOIN groups g
     WHERE g.name = 'employee'
       AND NOT EXISTS (SELECT 1 FROM user_groups ug WHERE ug.user_id = u.id)
     ON CONFLICT DO NOTHING`
  );

  let adminUser = (await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [DEFAULT_ADMIN_EMAIL]
  )).rows[0];
  if (!adminUser) {
    const adminPasswordHash = await hashPassword(process.env.ADMIN_PASSWORD);
    const admin = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_EMAIL, adminPasswordHash]
    );
    adminUser = admin.rows[0] || (await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [DEFAULT_ADMIN_EMAIL]
    )).rows[0];
  }
  if (!adminUser) {
    throw new Error('Unable to provision the default admin account');
  }
  await pool.query(
    `INSERT INTO user_groups (user_id, group_id)
     SELECT $1, id FROM groups WHERE name = 'admin'
     ON CONFLICT DO NOTHING`,
    [adminUser.id]
  );

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend API running on port ${PORT}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Unable to start backend:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, pool, startServer };
