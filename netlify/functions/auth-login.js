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
  const json = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    throw new Error((json && json.error) || `LeanCloud ${res.status}`);
  }
  return json;
}

// --- Rate limit helpers ---
function getClientIp(event) {
  const h = event.headers || {};
  const xf = h['x-forwarded-for'] || h['X-Forwarded-For'];
  const ip = (xf && xf.split(',')[0].trim()) || h['x-real-ip'] || h['X-Real-IP'] || event.ip || 'unknown';
  return ip;
}

async function rateLimitCheck(ip, action) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10分钟窗口
  const lockMs = 10 * 60 * 1000;   // 触发后锁定10分钟
  try {
    const where = encodeURIComponent(JSON.stringify({ ip, action }));
    const found = await lcRequest('GET', `/1.1/classes/RateLimit?where=${where}`, null, { useMaster: true });
    const rec = Array.isArray(found && found.results) && found.results[0];
    const lockedUntil = rec && rec.lockedUntil ? new Date(rec.lockedUntil).getTime() : 0;
    if (lockedUntil > now) {
      return { blocked: true, retryAfterMs: lockedUntil - now, rec, windowMs, lockMs };
    }
    return { blocked: false, rec, windowMs, lockMs };
  } catch (_) {
    // LeanCloud不可用时不阻断
    return { blocked: false, rec: null, windowMs, lockMs };
  }
}

async function rateLimitOnFailure(ip, action, rec, windowMs, lockMs) {
  try {
    const now = Date.now();
    let failures = (rec && rec.failures) || 0;
    const lastFailedAtTs = rec && rec.lastFailedAt ? new Date(rec.lastFailedAt).getTime() : 0;
    if (!lastFailedAtTs || (now - lastFailedAtTs) > windowMs) {
      failures = 0; // 窗口外重置
    }
    failures += 1;
    const payload = { ip, action, failures, lastFailedAt: new Date(now).toISOString() };
    if (failures >= 5) {
      payload.lockedUntil = new Date(now + lockMs).toISOString();
    } else {
      payload.lockedUntil = null;
    }
    if (rec && rec.objectId) {
      await lcRequest('PUT', `/1.1/classes/RateLimit/${rec.objectId}`, payload, { useMaster: true });
    } else {
      await lcRequest('POST', '/1.1/classes/RateLimit', payload, { useMaster: true });
    }
  } catch (_) {
    // 忽略限流写入错误
  }
}

async function rateLimitReset(ip, action, rec) {
  try {
    if (rec && rec.objectId) {
      await lcRequest('PUT', `/1.1/classes/RateLimit/${rec.objectId}`, { failures: 0, lastFailedAt: null, lockedUntil: null }, { useMaster: true });
    }
  } catch (_) { /* ignore */ }
}
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) return json(500, { error: 'Missing JWT_SECRET env' });

  // IP限流预检
  const ip = getClientIp(event);
  const rl = await rateLimitCheck(ip, 'login');
  if (rl.blocked) {
    const retrySec = Math.ceil((rl.retryAfterMs || 0) / 1000);
    return { statusCode: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(retrySec) }, body: JSON.stringify({ error: '尝试过多，请稍后再试', retryAfterSec: retrySec }) };
  }
    const body = JSON.parse(event.body || '{}');
    const { username = '', password = '', accessKey = '', inviteCode = '' } = body;

    const USERS_JSON = process.env.USERS_JSON || '{}'; // optional: {"admin":{"passwordHash":"<sha256>","role":"admin","permissions":["read","write","delete","admin"]}}
    const users = safeParseJSON(USERS_JSON, {});

    const PASS_SALT = process.env.PASS_SALT || '';
    const ACCESS_SALT = process.env.ACCESS_SALT || PASS_SALT;
    const DEFAULT_ACCESS_KEY_HASH = process.env.DEFAULT_ACCESS_KEY_HASH || '';
    const INVITE_SALT = process.env.INVITE_SALT || ACCESS_SALT;
    const INVITES_JSON = process.env.INVITES_JSON || '{}';
    const invites = safeParseJSON(INVITES_JSON, {});

    const EXP_MS = Number(process.env.JWT_EXP_MS || 86400000);
    const now = Date.now();

    let userOut = null;

    // Username/password flow
    if (username && password) {
      // Try LeanCloud UserAccount first
      try {
        const where = encodeURIComponent(JSON.stringify({ username }));
        const found = await lcRequest('GET', `/1.1/classes/UserAccount?where=${where}`, null, { useMaster: true });
        const obj = Array.isArray(found && found.results) && found.results[0];
        if (obj && obj.passwordHash) {
          const submitted = sha256Hex(PASS_SALT + password);
          const expected = obj.passwordHash;
          if (timingSafeEqualHex(submitted, expected)) {
            const role = obj.role || 'reader';
            const perms = Array.isArray(obj.permissions) ? obj.permissions : ['read'];
            const sub = obj.sub || username;
            userOut = { name: sub, role, permissions: perms };
          }
        }
      } catch (_) {
        // Fallback to USERS_JSON
        const u = users[username];
        if (u) {
          const submitted = sha256Hex(PASS_SALT + password);
          const expected = u.passwordHash || sha256Hex(PASS_SALT + (u.password || ''));
          if (timingSafeEqualHex(submitted, expected)) {
            userOut = { name: username, role: u.role || 'reader', permissions: Array.isArray(u.permissions) ? u.permissions : ['read'] };
          }
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

    // 邀请码登录（管理员指定）：根据 INVITES_JSON 中的元数据签发令牌
    if (!userOut && inviteCode) {
      // 严格一次性：不支持使用邀请码进行登录，请使用注册流程
      await rateLimitOnFailure(ip, 'login', rl.rec, rl.windowMs, rl.lockMs);
      return json(403, { error: 'Use registration with inviteCode' });
    }

    if (!userOut) {
      await rateLimitOnFailure(ip, 'login', rl.rec, rl.windowMs, rl.lockMs);
      return json(401, { error: 'Invalid credentials' });
    }

    const payload = {
      sub: userOut.name,
      role: userOut.role,
      permissions: userOut.permissions,
      iat: now,
      exp: now + EXP_MS,
    };
    const token = signJWT(payload, JWT_SECRET);

    await rateLimitReset(ip, 'login', rl.rec);
    return json(200, { token, user: userOut });
  } catch (e) {
    return json(500, { error: e.message || 'Internal Error' });
  }
};

function safeParseJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}