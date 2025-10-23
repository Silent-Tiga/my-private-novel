// Netlify Function: auth-login
// Issues backend-signed JWT. Validates username/password or default access key.

const crypto = require('crypto');

function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function timingSafeEqualHex(a, b) {
  try {
    const A = Buffer.from(a, 'hex');
    const B = Buffer.from(b, 'hex');
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
  } catch (e) { return false; }
}

function signJWT(payload, secret) {
  // Simplified JWT compatible with existing functions
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = Buffer.from(`${encodedHeader}.${encodedPayload}.${secret}`).toString('base64');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) return json(500, { error: 'Missing JWT_SECRET env' });

    const body = JSON.parse(event.body || '{}');
    const { username = '', password = '', accessKey = '' } = body;

    const USERS_JSON = process.env.USERS_JSON || '{}'; // optional: {"admin":{"passwordHash":"<sha256>","role":"admin","permissions":["read","write","delete","admin"]}}
    const users = safeParseJSON(USERS_JSON, {});

    const PASS_SALT = process.env.PASS_SALT || '';
    const ACCESS_SALT = process.env.ACCESS_SALT || PASS_SALT;
    const DEFAULT_ACCESS_KEY_HASH = process.env.DEFAULT_ACCESS_KEY_HASH || '';

    const EXP_MS = Number(process.env.JWT_EXP_MS || 86400000);
    const now = Date.now();

    let userOut = null;

    // Username/password flow
    if (username && password) {
      const u = users[username];
      if (u) {
        const submitted = sha256Hex(PASS_SALT + password);
        const expected = u.passwordHash || sha256Hex(PASS_SALT + (u.password || ''));
        if (timingSafeEqualHex(submitted, expected)) {
          userOut = { name: username, role: u.role || 'reader', permissions: Array.isArray(u.permissions) ? u.permissions : ['read'] };
        }
      }
    }

    // Default access key (read-only)
    if (!userOut && accessKey) {
      const submitted = sha256Hex(ACCESS_SALT + accessKey);
      if (DEFAULT_ACCESS_KEY_HASH && timingSafeEqualHex(submitted, DEFAULT_ACCESS_KEY_HASH)) {
        userOut = { name: 'access-key', role: process.env.DEFAULT_ROLE || 'reader', permissions: ['read'] };
      }
    }

    if (!userOut) return json(401, { error: 'Invalid credentials' });

    const payload = {
      sub: userOut.name,
      role: userOut.role,
      permissions: userOut.permissions,
      iat: now,
      exp: now + EXP_MS,
    };
    const token = signJWT(payload, JWT_SECRET);

    return json(200, { token, user: userOut });
  } catch (e) {
    return json(500, { error: e.message || 'Internal Error' });
  }
};

function safeParseJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}