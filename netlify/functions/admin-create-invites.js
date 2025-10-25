// Netlify Function: admin-create-invites
// Purpose: Admin pre-generation of invite codes and saving to LeanCloud InviteCodes
// Method: POST
// Auth: Authorization: Bearer <jwt> (requires 'write' or 'admin')
// Body JSON:
//   {
//     count?: number,              // number of codes to generate (default 10, max 500)
//     role?: string,               // default role for invites (default from env or 'reader')
//     permissions?: string[]|null, // permissions array, default from env or ['read']
//     expDays?: number,            // expiration in days from now (default 30)
//     assignedId?: string|null,    // optional: bind each invite to a specific id
//     codeLength?: number          // length of invite code (default 12, 6..32)
//   }
// Returns: { ok: true, count, expTs, items: [{ code, role, permissions, assignedId? }] }

const crypto = require('crypto');


function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function sha256Hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function randomCode(len = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function safeParseJSON(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

function verifyJWT(event, { requireAnyOf = ['write', 'admin'] } = {}) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw Object.assign(new Error('Missing JWT_SECRET env'), { code: 500 });
  const authHeader = event.headers.Authorization || event.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) throw Object.assign(new Error('Missing bearer token'), { code: 401 });
  const t = authHeader.slice('Bearer '.length);
  const parts = t.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Malformed token'), { code: 401 });
  const expectedSig = Buffer.from(`${parts[0]}.${parts[1]}.${jwtSecret}`).toString('base64');
  if (expectedSig !== parts[2]) throw Object.assign(new Error('Invalid signature'), { code: 401 });
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  if (payload.exp && payload.exp < Date.now()) throw Object.assign(new Error('Token expired'), { code: 401 });
  const perms = payload.permissions || [];
  const role = payload.role || '';
  const ok = (Array.isArray(perms) && requireAnyOf.some(p => perms.includes(p))) || (requireAnyOf.includes('admin') && role === 'admin');
  if (!ok) throw Object.assign(new Error('Insufficient permissions'), { code: 403 });
  return payload;
}

function lcConfig() {
  return {
    APP_ID: process.env.LEANCLOUD_APP_ID || process.env.LEANCLOUD_APPID || '',
    APP_KEY: process.env.LEANCLOUD_APP_KEY || process.env.LEANCLOUD_APPKEY || '',
    MASTER_KEY: process.env.LEANCLOUD_MASTER_KEY || '',
    SERVER_URL: process.env.LEANCLOUD_SERVER_URL || process.env.LEANCLOUD_SERVER || '',
  };
}

async function lcRequest(method, path, body, { useMaster = false } = {}) {
  const cfg = lcConfig();
  if (!cfg.APP_ID || !cfg.SERVER_URL || (!cfg.APP_KEY && !cfg.MASTER_KEY)) {
    throw new Error('LeanCloud config missing');
  }
  const headers = {
    'X-LC-Id': cfg.APP_ID,
    'Content-Type': 'application/json',
    ...(useMaster ? { 'X-LC-Key': cfg.MASTER_KEY + ',master' } : { 'X-LC-Key': cfg.APP_KEY })
  };
  const url = cfg.SERVER_URL.replace(/\/$/, '') + path;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof data === 'string' ? data : (data && data.error) || `LeanCloud ${res.status}`);
  return data;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
    verifyJWT(event, { requireAnyOf: ['admin'] });

    const body = safeParseJSON(event.body || '{}', {});
    const count = Math.max(1, Math.min(500, Number(body.count || 10)));
    const codeLength = Math.max(6, Math.min(32, Number(body.codeLength || 12)));
    const INVITE_SALT = process.env.INVITE_SALT || process.env.ACCESS_SALT || process.env.PASS_SALT || '';
    if (!INVITE_SALT) return json(500, { error: 'Missing INVITE_SALT (or ACCESS_SALT/PASS_SALT) env' });

    const defaultRole = process.env.INVITE_DEFAULT_ROLE || 'reader';
    const defaultPerms = process.env.INVITE_DEFAULT_PERMS ? safeParseJSON(process.env.INVITE_DEFAULT_PERMS, ['read']) : ['read'];
    const role = typeof body.role === 'string' && body.role.trim() ? body.role.trim() : defaultRole;
    const permissions = Array.isArray(body.permissions) ? body.permissions : defaultPerms;

    const expDays = Math.max(1, Math.min(3650, Number(body.expDays || 30))); // 1..3650 days (10 years max)
    const expTs = Date.now() + expDays * 24 * 60 * 60 * 1000;

    const assignedId = (typeof body.assignedId === 'string' && body.assignedId.trim()) ? body.assignedId.trim() : null;

    // Prepare payloads
    const items = Array.from({ length: count }).map(() => {
      const code = randomCode(codeLength);
      const codeHash = sha256Hex(INVITE_SALT + code);
      return { code, codeHash, role, permissions, expTs, assignedId };
    });

    // Write to LeanCloud InviteCodes via batch API (50 per batch)
    const batches = chunk(items, 50);
    for (const batch of batches) {
      const requests = batch.map(it => ({
        method: 'POST',
        path: '/1.1/classes/InviteCodes',
        body: {
          codeHash: it.codeHash,
          role: it.role,
          permissions: it.permissions,
          expTs: it.expTs,
          ...(it.assignedId ? { assignedId: it.assignedId } : {})
        }
      }));
      await lcRequest('POST', '/1.1/batch', { requests }, { useMaster: true });
    }

    // Return plain codes for distribution (do NOT store plaintext codes in LeanCloud)
    const respItems = items.map(it => ({ code: it.code, role: it.role, permissions: it.permissions, ...(it.assignedId ? { assignedId: it.assignedId } : {}) }));
    return json(200, { ok: true, count: respItems.length, expTs, items: respItems });
  } catch (e) {
    const status = e.code && typeof e.code === 'number' ? e.code : 500;
    return json(status, { error: e.message || 'Internal Error' });
  }
};