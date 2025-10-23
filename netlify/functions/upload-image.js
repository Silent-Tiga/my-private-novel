// Netlify Function: Upload Image to GitHub repo under static/images/
// Method: POST
// Body: { filename, folder?: "static/images" | "static/images/<subdir>", file_base64, message? }
// Auth: Authorization: Bearer <jwt> (requires 'write' permission)

const githubApi = 'https://api.github.com';

function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function verifyJWT(event) {
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
  const hasWrite = Array.isArray(perms) && perms.includes('write');
  if (!hasWrite) throw Object.assign(new Error('Insufficient permissions'), { code: 403 });
  return payload;
}

function normalizeFilename(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Invalid filename');
  const trimmed = name.trim();
  const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, '-');
  return safe.toLowerCase();
}

function safeFolder(folder) {
  const f = (folder || 'static/images').trim();
  if (!f.startsWith('static/images')) throw Object.assign(new Error('Folder must be under static/images'), { code: 400 });
  if (f.includes('..')) throw Object.assign(new Error('Invalid folder path'), { code: 400 });
  const safe = f.replace(/[^A-Za-z0-9_\/-]/g, '-');
  return safe;
}

async function getFile({ owner, repo, path, token, branch }) {
  const url = `${githubApi}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const json = await res.json();
  return { sha: json.sha };
}

async function putFile({ owner, repo, path, token, contentBase64, sha, message, branch }) {
  const url = `${githubApi}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message: message || `Upload ${path}`,
    content: contentBase64,
    sha,
    branch: branch || undefined
  };
  const res = await fetch(url, { method: 'PUT', headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status}`);
  return res.json();
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Method Not Allowed' });
    }
    const token = process.env.GITHUB_TOKEN;
    if (!token) return json(500, { error: 'Missing GITHUB_TOKEN env' });
    // auth
    try { verifyJWT(event); } catch (e) { return json(e.code || 401, { error: e.message }); }

    const branch = process.env.GITHUB_BRANCH || 'main';
    const payload = JSON.parse(event.body || '{}');
    const repoFull = payload.repo || process.env.REPO_FULL_NAME || 'Silent-Tiga/my-private-novel';
    const [owner, repo] = repoFull.split('/');

    const filename = normalizeFilename(payload.filename || 'image.png');
    const folder = safeFolder(payload.folder || 'static/images');
    const path = `${folder}/${filename}`;

    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    if (!allowed.includes(ext)) return json(415, { error: `Unsupported file type: ${ext}` });

    let b64 = payload.file_base64;
    if (typeof b64 !== 'string' || !b64.trim()) return json(400, { error: 'Missing file_base64' });
    // Accept data URLs or pure base64
    if (b64.startsWith('data:') && b64.includes(',')) b64 = b64.split(',')[1];
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch(e) { return json(400, { error: 'Invalid base64' }); }
    const size = buf.length;
    const MAX = 5 * 1024 * 1024; // 5MB
    if (size > MAX) return json(413, { error: 'File too large', size });

    // dedup by SHA-256 index
    const sha256 = (payload.sha256 || '').toLowerCase();
    let mediaIndex = {};
    const indexPath = 'data/media-index.json';
    try {
      const indexFile = await getFile({ owner, repo, path: indexPath, token, branch });
      if (indexFile) {
        const url = `${githubApi}/repos/${owner}/${repo}/contents/${encodeURIComponent(indexPath)}${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`;
        const res = await fetch(url, { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } });
        if (res.ok) {
          const jsonRes = await res.json();
          const content = Buffer.from(jsonRes.content || '', 'base64').toString('utf-8');
          try { mediaIndex = JSON.parse(content); } catch(_) { mediaIndex = {}; }
        }
      }
    } catch(_) {}
    if (sha256 && mediaIndex[sha256]) {
      const existingPath = mediaIndex[sha256];
      const url = existingPath.startsWith('static/') ? '/' + existingPath.replace(/^static\//,'') : existingPath;
      return json(200, { ok: true, path: existingPath, url, dedup: true });
    }

    // get existing sha if any
    const existing = await getFile({ owner, repo, path, token, branch });
    const sha = existing ? existing.sha : undefined;

    await putFile({ owner, repo, path, token, contentBase64: b64, sha, message: payload.message || `Upload ${filename}`, branch });

    // update index
    if (sha256) {
      mediaIndex[sha256] = path;
      const newContentB64 = Buffer.from(JSON.stringify(mediaIndex, null, 2), 'utf-8').toString('base64');
      const indexExisting = await getFile({ owner, repo, path: indexPath, token, branch });
      const indexSha = indexExisting ? indexExisting.sha : undefined;
      await putFile({ owner, repo, path: indexPath, token, contentBase64: newContentB64, sha: indexSha, message: 'Update media index', branch });
    }
    const url = path.startsWith('static/') ? '/' + path.replace(/^static\//,'') : path;
    return json(200, { ok: true, path, url, size });
  } catch (e) {
    return json(500, { error: e.message });
  }
};