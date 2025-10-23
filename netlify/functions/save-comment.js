// Netlify Function: Save and List comments under data/comments/<postId>.json
// Methods:
//  - GET  : /.netlify/functions/save-comment?post_id=<id> (public read)
//  - POST : { action?, post_id, comment:{author, content, parentId?, id?}, message? } (requires 'comment' or 'write')

const githubApi = 'https://api.github.com';

function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
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

async function getFile({ owner, repo, path, token, branch }) {
  const url = `${githubApi}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const json = await res.json();
  const content = Buffer.from(json.content, 'base64').toString('utf-8');
  return { sha: json.sha, content };
}

async function putFile({ owner, repo, path, token, content, sha, message, branch }) {
  const url = `${githubApi}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message: message || `Update ${path}`,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    sha,
    branch: branch || undefined
  };
  const res = await fetch(url, { method: 'PUT', headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status}`);
  return res.json();
}

exports.handler = async function(event) {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return json(500, { error: 'Missing GITHUB_TOKEN env' });
    const branch = process.env.GITHUB_BRANCH || 'main';

    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      const postId = safePostId(qs.post_id || '');
      const repoFull = process.env.REPO_FULL_NAME || 'Silent-Tiga/my-private-novel';
      const [owner, repo] = repoFull.split('/');
      const path = `data/comments/${postId}.json`;
      const file = await getFile({ owner, repo, path, token, branch });
      if (!file) return json(200, { postId, items: [] });
      let obj;
      try { obj = JSON.parse(file.content); } catch(e) { obj = { postId, items: [] }; }
      if (!Array.isArray(obj.items)) obj.items = [];
      return json(200, { postId, items: obj.items });
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
    const repoFull = payload.repo || process.env.REPO_FULL_NAME || 'Silent-Tiga/my-private-novel';
    const [owner, repo] = repoFull.split('/');
    const path = `data/comments/${postId}.json`;

    const file = await getFile({ owner, repo, path, token, branch });
    let obj = file ? (() => { try { return JSON.parse(file.content); } catch(e) { return null; } })() : null;
    if (!obj || typeof obj !== 'object') obj = { postId, items: [] };
    if (!Array.isArray(obj.items)) obj.items = [];

    if (action === 'add') {
      const comment = payload.comment || {};
      const author = (comment.author || '').trim();
      const content = escapeContent((comment.content || '').trim());
      const parentId = (comment.parentId || '') || null;
      if (!author || !content) return json(400, { error: 'author and content required' });

      // basic anti-spam: refuse duplicate author+content in 60s
      const last = obj.items.length ? obj.items[obj.items.length - 1] : null;
      if (last && last.author === author && last.content === content) {
        const lastTs = Date.parse(last.createdAt || 0) || 0;
        if (Date.now() - lastTs < 60 * 1000) return json(429, { error: 'Duplicate comment in 60s window' });
      }

      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
      const createdAt = new Date().toISOString();
      obj.items.push({ id, parentId, author, content, createdAt, upvotes: 0 });
      const pretty = JSON.stringify(obj, null, 2);
      await putFile({ owner, repo, path, token, content: pretty, sha: file ? file.sha : undefined, message: payload.message || `add comment to ${postId}`, branch });
      return json(200, { ok: true, action, count: obj.items.length, items: obj.items });
    }

    if (action === 'upvote') {
      const commentId = (payload.comment && payload.comment.id) || payload.commentId || '';
      if (!commentId) return json(400, { error: 'comment id required' });
      const target = obj.items.find(it => it.id === commentId);
      if (!target) return json(404, { error: 'comment not found' });
      target.upvotes = (target.upvotes || 0) + 1;
      const pretty = JSON.stringify(obj, null, 2);
      await putFile({ owner, repo, path, token, content: pretty, sha: file ? file.sha : undefined, message: payload.message || `upvote comment ${commentId} on ${postId}`, branch });
      return json(200, { ok: true, action, items: obj.items });
    }

    if (action === 'delete') {
      const commentId = (payload.comment && payload.comment.id) || payload.commentId || '';
      if (!commentId) return json(400, { error: 'comment id required' });
      const before = obj.items.length;
      obj.items = obj.items.filter(it => it.id !== commentId);
      if (obj.items.length === before) return json(404, { error: 'comment not found' });
      const pretty = JSON.stringify(obj, null, 2);
      await putFile({ owner, repo, path, token, content: pretty, sha: file ? file.sha : undefined, message: payload.message || `delete comment ${commentId} on ${postId}`, branch });
      return json(200, { ok: true, action, items: obj.items });
    }

    return json(400, { error: `Unsupported action: ${action}` });
  } catch (e) {
    return json(500, { error: e.message });
  }
};