// Netlify Function: Save and List comments via LeanCloud
// Methods:
//  - GET  : /.netlify/functions/save-comment?post_id=<id> (public read)
//  - POST : { action?, post_id, comment:{author, content, parentId?, id?}, message? } (requires 'comment' or 'write')



function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function safePostId(id) {
  if (typeof id !== 'string' || !id.trim()) throw Object.assign(new Error('Missing post_id'), { code: 400 });
  const s = id.trim();
  if (s.includes('..')) throw Object.assign(new Error('Invalid post_id'), { code: 400 });
  const safe = s.replace(/[^A-Za-z0-9_\/-]/g, '-');
  return safe;
}

function escapeContent(s) {
  return String(s).replace(/[&<>"]+/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

function verifyJWT(event, { requireAnyOf = ['comment', 'write'] } = {}) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw Object.assign(new Error('Missing JWT_SECRET env'), { code: 500 });
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) throw Object.assign(new Error('Missing bearer token'), { code: 401 });
  const t = authHeader.slice('Bearer '.length);
  const parts = t.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Malformed token'), { code: 401 });
  const payloadStr = Buffer.from(parts[1], 'base64').toString('utf-8');
  const payload = JSON.parse(payloadStr);
  const expectedSig = Buffer.from(`${parts[0]}.${parts[1]}.${jwtSecret}`).toString('base64');
  if (expectedSig !== parts[2]) throw Object.assign(new Error('Invalid signature'), { code: 401 });
  if (payload.exp && payload.exp < Date.now()) throw Object.assign(new Error('Token expired'), { code: 401 });
  const perms = payload.permissions || [];
  const ok = Array.isArray(perms) && requireAnyOf.some(p => perms.includes(p));
  if (!ok) throw Object.assign(new Error('Insufficient permissions'), { code: 403 });
  return payload;
}

function lcConfig() {
  const APP_ID = process.env.LEANCLOUD_APP_ID;
  const APP_KEY = process.env.LEANCLOUD_APP_KEY;
  const MASTER_KEY = process.env.LEANCLOUD_MASTER_KEY || '';
  const SERVER_URL = process.env.LEANCLOUD_SERVER_URL; // e.g., https://<appId>.api.lncldglobal.com
  const USE_MASTER_FOR_WRITE = (process.env.LEANCLOUD_USE_MASTER_FOR_WRITE || 'false').toLowerCase() === 'true';
  if (!APP_ID || !SERVER_URL || (!APP_KEY && !MASTER_KEY)) throw Object.assign(new Error('Missing LeanCloud env: LEANCLOUD_APP_ID/APP_KEY(or MASTER)/SERVER_URL'), { code: 500 });
  return { APP_ID, APP_KEY, MASTER_KEY, SERVER_URL, USE_MASTER_FOR_WRITE };
}

async function lcRequest(path, { method = 'GET', body = null, query = null, useMaster = false } = {}) {
  const { APP_ID, APP_KEY, MASTER_KEY, SERVER_URL } = lcConfig();
  const url = new URL(`${SERVER_URL.replace(/\/$/, '')}${path}`);
  if (query) Object.entries(query).forEach(([k,v]) => url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v)));
  const headers = {
    'X-LC-Id': APP_ID,
    'X-LC-Key': useMaster && MASTER_KEY ? `${MASTER_KEY},master` : APP_KEY,
    'Content-Type': 'application/json'
  };
  const res = await fetch(url.toString(), { method, headers, body: body ? JSON.stringify(body) : null });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`LeanCloud ${method} ${path} failed: ${res.status} ${typeof data === 'string' ? data : (data.error || '')}`);
  return data;
}

async function listComments(postId) {
  const where = { postId };
  const data = await lcRequest('/1.1/classes/Comment', { method: 'GET', query: { where, order: '-createdAt', limit: 1000 } });
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map(obj => ({
    id: obj.objectId,
    parentId: obj.parentId || null,
    author: obj.author || '匿名',
    content: obj.content || '',
    createdAt: obj.createdAt || new Date().toISOString(),
    upvotes: obj.upvotes || 0
  }));
}

async function addComment({ postId, author, content, parentId }) {
  const body = {
    postId,
    author,
    content,
    parentId: parentId || null,
    upvotes: 0
  };
  const { USE_MASTER_FOR_WRITE } = lcConfig();
  const data = await lcRequest('/1.1/classes/Comment', { method: 'POST', body, useMaster: USE_MASTER_FOR_WRITE });
  return data; // includes objectId, createdAt
}

async function upvoteComment({ id }) {
  const body = { upvotes: { __op: 'Increment', amount: 1 } };
  const { USE_MASTER_FOR_WRITE } = lcConfig();
  const data = await lcRequest(`/1.1/classes/Comment/${encodeURIComponent(id)}`, { method: 'PUT', body, useMaster: USE_MASTER_FOR_WRITE });
  return data;
}

async function deleteCommentLC({ id }) {
  await lcRequest(`/1.1/classes/Comment/${encodeURIComponent(id)}`, { method: 'DELETE', useMaster: true });
  return { ok: true };
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      const postId = safePostId(qs.post_id || '');
      const items = await listComments(postId);
      // Normalize into expected shape for frontend partial (roots + replies derived client-side)
      return json(200, { postId, items });
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

    const payload = JSON.parse(event.body || '{}');
    const action = (payload.action || 'add').toLowerCase();

    // auth requirements differ by action
    try {
      if (action === 'delete') verifyJWT(event, { requireAnyOf: ['write'] });
      else verifyJWT(event, { requireAnyOf: ['comment', 'write'] });
    } catch(e) { return json(e.code || 401, { error: e.message }); }

    const postId = safePostId(payload.post_id || '');

    if (action === 'add') {
      const comment = payload.comment || {};
      const author = (comment.author || '').trim();
      const content = escapeContent((comment.content || '').trim());
      const parentId = (comment.parentId || '') || null;
      if (!author || !content) return json(400, { error: 'author and content required' });
      const created = await addComment({ postId, author, content, parentId });
      const items = await listComments(postId);
      return json(200, { ok: true, action, count: items.length, items });
    }

    if (action === 'upvote') {
      const commentId = (payload.comment && payload.comment.id) || payload.commentId || '';
      if (!commentId) return json(400, { error: 'comment id required' });
      await upvoteComment({ id: commentId });
      const items = await listComments(postId);
      return json(200, { ok: true, action, items });
    }

    if (action === 'delete') {
      const commentId = (payload.comment && payload.comment.id) || payload.commentId || '';
      if (!commentId) return json(400, { error: 'comment id required' });
      await deleteCommentLC({ id: commentId });
      const items = await listComments(postId);
      return json(200, { ok: true, action, items });
    }

    return json(400, { error: `Unsupported action: ${action}` });
  } catch (e) {
    return json(500, { error: e.message });
  }
};