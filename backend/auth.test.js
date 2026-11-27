const assert = require('node:assert/strict');
const test = require('node:test');
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-with-more-than-32-bytes';

const { createSessionToken, hashPassword, verifyPassword, verifySessionToken } = require('./auth');
const { app, pool } = require('./index');

test('password hashes verify only the original password', async () => {
  const hash = await hashPassword('correct horse battery staple');

  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('incorrect password', hash), false);
});

test('session tokens verify and expire', () => {
  const secret = 'a'.repeat(32);
  const issuedAt = 1_000_000;
  const token = createSessionToken(42, secret, issuedAt);

  assert.equal(verifySessionToken(token, secret, issuedAt).sub, '42');
  assert.equal(verifySessionToken(token, 'b'.repeat(32), issuedAt), null);
  assert.equal(verifySessionToken(token, secret, issuedAt + 7 * 24 * 60 * 60 * 1000), null);
});

test('registration, login, session lookup, and logout use the account store', async () => {
  const users = [];
  let userPermissions = [];
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const query = async (sql, values = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('INSERT INTO users')) {
      if (users.some((user) => user.email === values[1])) {
        const error = new Error('duplicate account');
        error.code = '23505';
        throw error;
      }

      const user = { id: String(users.length + 1), name: values[0], email: values[1], password_hash: values[2] };
      users.push(user);
      return { rows: [{ id: user.id, name: user.name, email: user.email }], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO user_groups')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('FROM users u')) {
      const user = users.find((item) => item.id === values[0]);
      return {
        rows: user ? [{
          id: user.id,
          name: user.name,
          email: user.email,
          permissions: [...userPermissions],
          groups: []
        }] : [],
        rowCount: user ? 1 : 0
      };
    }

    if (sql.includes('WHERE id = $1')) {
      const user = users.find((item) => item.id === values[0]);
      return { rows: user ? [{ id: user.id, name: user.name, email: user.email }] : [], rowCount: user ? 1 : 0 };
    }

    if (sql.includes('WHERE email = $1')) {
      const user = users.find((item) => item.email === values[0]);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    throw new Error(`Unexpected SQL in test: ${sql}`);
  };
  pool.query = query;
  pool.connect = async () => ({
    query,
    release() {}
  });

  const server = app.listen(0);

  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
    const registration = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test User',
        email: 'TEST@example.com',
        password: 'a secure password'
      })
    });

    assert.equal(registration.status, 201);
    const registrationBody = await registration.json();
    assert.deepEqual(registrationBody.user, { id: '1', name: 'Test User', email: 'test@example.com' });
    const cookie = registration.headers.get('set-cookie').split(';')[0];

    const duplicateRegistration = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Another User',
        email: 'test@example.com',
        password: 'a secure password'
      })
    });
    assert.equal(duplicateRegistration.status, 409);

    const currentUser = await fetch(`${baseUrl}/me`, { headers: { Cookie: cookie } });
    assert.equal(currentUser.status, 200);
    assert.equal((await currentUser.json()).user.email, 'test@example.com');

    const regularUserAdminAccess = await fetch(`${baseUrl.replace('/auth', '/admin')}/groups`, {
      headers: { Cookie: cookie }
    });
    assert.equal(regularUserAdminAccess.status, 403);

    const deniedDashboardAccess = await fetch(`${baseUrl.replace('/auth', '/pages')}/payroll/access`, {
      headers: { Cookie: cookie }
    });
    assert.equal(deniedDashboardAccess.status, 403);
    userPermissions = ['page.dashboard'];
    const allowedDashboardAccess = await fetch(`${baseUrl.replace('/auth', '/pages')}/dashboard/access`, {
      headers: { Cookie: cookie }
    });
    assert.equal(allowedDashboardAccess.status, 200);

    const successfulLogin = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'TEST@example.com', password: 'a secure password' })
    });
    assert.equal(successfulLogin.status, 200);

    const rejectedLogin = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'wrong password' })
    });
    assert.equal(rejectedLogin.status, 401);

    const logout = await fetch(`${baseUrl}/logout`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);

    const afterLogout = await fetch(`${baseUrl}/me`);
    assert.equal(afterLogout.status, 401);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
