// Netlify Function: auth-register (invite-based one-time registration)
// Method: POST
// Body: { inviteCode, username, password, nickname? }
// Returns: { token, user } on success

const crypto = require('crypto');
const fetch = require('node-fetch');

function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function sha256Hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = Buffer.from(`${encodedHeader}.${encodedPayload}.${secret}`).toString('base64');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function safeParseJSON(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

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

    // IP限流预检（注册防刷）
    const ip = getClientIp(event);
    const rl = await rateLimitCheck(ip, 'register');
    if (rl.blocked) {
      const retrySec = Math.ceil((rl.retryAfterMs || 0) / 1000);
      return { statusCode: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(retrySec) }, body: JSON.stringify({ error: '尝试过多，请稍后再试', retryAfterSec: retrySec }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { inviteCode = '', username = '', password = '', nickname = '' } = body;

    const PASS_SALT = process.env.PASS_SALT || '';
    const INVITE_SALT = process.env.INVITE_SALT || PASS_SALT;

    if (!inviteCode || !username || !password) {
      await rateLimitOnFailure(ip, 'register', rl.rec, rl.windowMs, rl.lockMs);
      return json(400, { error: 'Missing inviteCode/username/password' });
    }

    // 校验邀请码（LeanCloud InviteCodes）
    let inviteRec = null;
    try {
      const where = encodeURIComponent(JSON.stringify({ codeHash: sha256Hex(INVITE_SALT + inviteCode) }));
      const found = await lcRequest('GET', `/1.1/classes/InviteCodes?where=${where}`, null, { useMaster: true });
      inviteRec = Array.isArray(found && found.results) && found.results[0];
    } catch (e) {
      await rateLimitOnFailure(ip, 'register', rl.rec, rl.windowMs, rl.lockMs);
      return json(500, { error: 'Invite lookup failed' });
    }

    if (!inviteRec) {
      await rateLimitOnFailure(ip, 'register', rl.rec, rl.windowMs, rl.lockMs);
      return json(401, { error: 'Invalid invite' });
    }

    const now = Date.now();
    const expTs = Number(inviteRec.expTs || 0);
    if (expTs && expTs <= now) {
      await rateLimitOnFailure(ip, 'register', rl.rec, rl.windowMs, rl.lockMs);
      return json(401, { error: 'Invite expired' });
    }

    if (inviteRec.usedBy) {
      await rateLimitOnFailure(ip, 'register', rl.rec, rl.windowMs, rl.lockMs);
      return json(409, { error: 'Invite already used' });
    }

    // 检查用户名是否已存在
    try {
      const whereUser = encodeURIComponent(JSON.stringify({ username }));
      const foundUser = await lcRequest('GET', `/1.1/classes/UserAccount?where=${whereUser}`, null, { useMaster: true });
      const exists = Array.isArray(foundUser && foundUser.results) && foundUser.results[0];
      if (exists) {
        await rateLimitOnFailure(ip, 'register', rl.rec, rl.windowMs, rl.lockMs);
        return json(409, { error: 'Username taken' });
      }
    } catch (e) {
      await rateLimitOnFailure(ip, 'register', rl.rec, rl.windowMs, rl.lockMs);
      return json(500, { error: 'User lookup failed' });
    }

    // 创建用户
    const passwordHash = sha256Hex(PASS_SALT + password);
    const role = inviteRec.role || 'reader';
    const permissions = Array.isArray(inviteRec.permissions) ? inviteRec.permissions : ['read'];
    const sub = username;
    try {
      await lcRequest('POST', '/1.1/classes/UserAccount', { username, passwordHash, role, permissions, sub, nickname: nickname || '' }, { useMaster: true });
    } catch (e) {
      await rateLimitOnFailure(ip, 'register', rl.rec, rl.windowMs, rl.lockMs);
      return json(500, { error: 'Create user failed' });
    }

    // 标记邀请码为已使用
    try {
      await lcRequest('PUT', `/1.1/classes/InviteCodes/${inviteRec.objectId}`, { usedBy: username, usedAt: new Date(now).toISOString() }, { useMaster: true });
    } catch (e) {
      // 不阻断，记录失败
    }

    // 签发令牌
    const JWT_SECRET = process.env.JWT_SECRET;
    const EXP_MS = Number(process.env.JWT_EXP_MS || 86400000);
    const payload = { sub, role, permissions, iat: now, exp: now + EXP_MS };
    const token = signJWT(payload, JWT_SECRET);

    await rateLimitReset(ip, 'register', rl.rec);
    return json(200, { token, user: { name: sub, role, permissions, nickname: nickname || '' } });
  } catch (e) {
    return json(500, { error: e.message || 'Internal Error' });
  }
};