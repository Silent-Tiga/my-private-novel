// Netlify Function: Generate Invite Code
// Method: POST
// Auth: Authorization: Bearer <jwt> (requires 'write' or 'admin' permission)
// Body: { role?: string, permissions?: string[], expMs?: number, sub?: string, codeLength?: number }
// Returns: { code, hashedKey, inviteEntry }

const crypto = require('crypto');

function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function randomCode(len = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function verifyJWT(event, { requireAnyOf = ['write', 'admin'] } = {}) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw Object.assign(new Error('Missing JWT_SECRET env'), { code: 500 });
  const auth = (event.headers && (event.headers.Authorization || event.headers.authorization)) || '';
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('Unauthorized'), { code: 401 });
  const token = auth.slice('Bearer '.length);
  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Malformed token'), { code: 401 });
  const expectedSig = Buffer.from(`${parts[0]}.${parts[1]}.${jwtSecret}`).toString('base64');
  if (expectedSig !== parts[2]) throw Object.assign(new Error('Invalid signature'), { code: 401 });
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  const now = Date.now();
  if (!payload.exp || payload.exp < now) throw Object.assign(new Error('Token expired'), { code: 401 });
  const perms = payload.permissions || [];
  const role = payload.role || '';
  const ok = (Array.isArray(perms) && requireAnyOf.some(p => perms.includes(p))) || (requireAnyOf.includes('admin') && role === 'admin');
  if (!ok) throw Object.assign(new Error('Insufficient permissions'), { code: 403 });
  return payload;
}

function safeParseJSON(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
    const caller = verifyJWT(event);

    const INVITE_SALT = process.env.INVITE_SALT || process.env.ACCESS_SALT || process.env.PASS_SALT || '';
    const INVITE_DEFAULT_ROLE = process.env.INVITE_DEFAULT_ROLE || 'reader';
    const INVITE_DEFAULT_PERMS = process.env.INVITE_DEFAULT_PERMS || '';

    const body = safeParseJSON(event.body || '{}', {});
    const codeLength = Math.max(6, Math.min(32, Number(body.codeLength || 12)));
    const code = randomCode(codeLength);
    const hashedKey = sha256Hex(INVITE_SALT + code);

    const role = body.role || INVITE_DEFAULT_ROLE;
    const permissions = Array.isArray(body.permissions) ? body.permissions : (INVITE_DEFAULT_PERMS ? safeParseJSON(INVITE_DEFAULT_PERMS, ['read']) : ['read']);
    const expMs = Number(body.expMs || (30 * 24 * 60 * 60 * 1000)); // default 30 days
    const expTs = Date.now() + expMs;
    const sub = body.sub || 'invite-user';

    const inviteEntry = { [hashedKey]: { role, permissions, expTs, sub } };

    return json(200, {
      code,
      hashedKey,
      inviteEntry,
      note: 'Add inviteEntry to INVITES_JSON env. Keep codes private; hashedKey is recommended for storage.'
    });
  } catch (e) {
    return json(e.code || 500, { error: e.message || 'Internal Error' });
  }
};