const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PASSWORD_KEY_LENGTH = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyPassword(password, passwordHash) {
  if (typeof passwordHash !== 'string') return false;
  const [algorithm, saltText, keyText] = passwordHash.split('$');
  if (algorithm !== 'scrypt' || !saltText || !keyText) return false;

  const salt = Buffer.from(saltText, 'base64url');
  const expectedKey = Buffer.from(keyText, 'base64url');
  if (expectedKey.length !== PASSWORD_KEY_LENGTH) return false;

  const actualKey = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return crypto.timingSafeEqual(expectedKey, actualKey);
}

function createSessionToken(userId, secret, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: String(userId),
    iat: issuedAt,
    exp: issuedAt + 60 * 60 * 24 * 7
  })).toString('base64url');
  const body = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifySessionToken(token, secret, now = Date.now()) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return null;

  const [headerText, payloadText, signatureText] = parts;
  const body = `${headerText}.${payloadText}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(body).digest();
  const suppliedSignature = Buffer.from(signatureText, 'base64url');

  if (
    suppliedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const header = JSON.parse(Buffer.from(headerText, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8'));
    const nowInSeconds = Math.floor(now / 1000);

    if (
      header.alg !== 'HS256' ||
      typeof payload.sub !== 'string' ||
      !/^\d+$/.test(payload.sub) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= nowInSeconds
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

module.exports = { createSessionToken, hashPassword, verifyPassword, verifySessionToken };
