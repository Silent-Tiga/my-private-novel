// Netlify Function: User Profile (get/set nickname)
// Methods:
//  - GET  : returns { sub, nickname? }
//  - POST : { nickname } to set/update nickname
// Auth: Authorization: Bearer <jwt> (any authenticated user)



function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function verifyJWT(event) {
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
  const json = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    throw new Error((json && json.error) || `LeanCloud ${res.status}`);
  }
  return json;
}

exports.handler = async (event) => {
  try {
    const caller = verifyJWT(event);
    const sub = caller.sub;
    if (!sub) return json(400, { error: 'Missing sub in token' });

    if (event.httpMethod === 'GET') {
      try {
        const where = encodeURIComponent(JSON.stringify({ sub }));
        const found = await lcRequest('GET', `/1.1/classes/UserProfile?where=${where}`, null, { useMaster: false });
        const obj = Array.isArray(found && found.results) && found.results[0];
        return json(200, { sub, nickname: obj && obj.nickname ? obj.nickname : null });
      } catch (e) {
        // 如果 LeanCloud 不可用，返回空昵称
        return json(200, { sub, nickname: null });
      }
    } else if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const nickname = body.nickname;
      if (!nickname || typeof nickname !== 'string' || nickname.length > 64) {
        return json(400, { error: 'Invalid nickname' });
      }
      // upsert: try update existing, else create
      try {
        const where = encodeURIComponent(JSON.stringify({ sub }));
        const found = await lcRequest('GET', `/1.1/classes/UserProfile?where=${where}`, null, { useMaster: true });
        const obj = Array.isArray(found && found.results) && found.results[0];
        if (obj && obj.objectId) {
          await lcRequest('PUT', `/1.1/classes/UserProfile/${obj.objectId}`, { nickname }, { useMaster: true });
        } else {
          await lcRequest('POST', '/1.1/classes/UserProfile', { sub, nickname }, { useMaster: true });
        }
        return json(200, { ok: true, sub, nickname });
      } catch (e) {
        return json(500, { error: e.message || 'LeanCloud error' });
      }
    } else {
      return json(405, { error: 'Method Not Allowed' });
    }
  } catch (e) {
    return json(e.code || 500, { error: e.message || 'Internal Error' });
  }
};