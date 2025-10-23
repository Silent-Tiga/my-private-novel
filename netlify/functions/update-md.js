// Netlify Function: Update Markdown Front Matter or Create New Content via GitHub API
// Usage: POST /.netlify/functions/update-md with JSON body:
// { repo: "Silent-Tiga/my-private-novel", path: "content/novels/chapter1.md", action: "toggle_comments"|"set_cards"|"create_entry", payload: { enabled: true }|{ cards: [...] }|{ content: "..." }, message: "Update front matter" }

const githubApi = 'https://api.github.com';

/**
 * Minimal front matter parser/updater for YAML-like blocks.
 * Only supports flat key: value pairs and an appended cards array block.
 */
function parseFrontMatter(md) {
  const start = md.indexOf('---');
  if (start !== 0) return { fm: {}, body: md, raw: '' };
  const end = md.indexOf('\n---', 3);
  if (end === -1) return { fm: {}, body: md, raw: '' };
  const raw = md.slice(3, end).trim();
  const body = md.slice(end + 4); // skip "\n---"
  const fm = {};
  raw.split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (m) {
      const key = m[1];
      let val = m[2];
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (/^\d+$/.test(val)) val = parseInt(val, 10);
      else if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
      fm[key] = val;
    }
  });
  return { fm, body, raw };
}

function buildFrontMatter(fm, cardsBlock) {
  const lines = Object.keys(fm).map(k => `${k}: ${typeof fm[k] === 'string' ? JSON.stringify(fm[k]) : fm[k]}`);
  if (cardsBlock) lines.push(cardsBlock.trim());
  return `---\n${lines.join('\n')}\n---`;
}

function buildCardsYaml(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return 'cards: []';
  const items = cards.map(c => {
    const t = c.title ? `\n    title: ${JSON.stringify(c.title)}` : '';
    const u = c.url ? `\n    url: ${JSON.stringify(c.url)}` : '';
    const i = c.image ? `\n    image: ${JSON.stringify(c.image)}` : '';
    return `  -${t}${u}${i}`;
  }).join('\n');
  return `cards:\n${items}`;
}

async function getFile({ owner, repo, path, token }) {
  const url = `${githubApi}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const json = await res.json();
  const content = Buffer.from(json.content, 'base64').toString('utf-8');
  return { sha: json.sha, content };
}

async function putFile({ owner, repo, path, token, content, sha, message }) {
  const url = `${githubApi}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message: message || `Update ${path}`,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    sha,
    // branch: 'main' // optional; default branch
  };
  const res = await fetch(url, { method: 'PUT', headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status}`);
  return res.json();
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Missing GITHUB_TOKEN env' }) };
    }
    // 简易 JWT 校验（与前端同算法）
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Missing JWT_SECRET env' }) };
    }
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing bearer token' }) };
    }
    const t = authHeader.slice('Bearer '.length);
    try {
      const parts = t.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
        const expectedSig = Buffer.from(`${parts[0]}.${parts[1]}.${jwtSecret}`).toString('base64');
        if (expectedSig !== parts[2]) throw new Error('Invalid signature');
        if (payload.exp && payload.exp < Date.now()) throw new Error('Token expired');
        // 需要写权限
        const perms = payload.permissions || [];
        const hasWrite = Array.isArray(perms) && perms.includes('write');
        if (!hasWrite) return { statusCode: 403, body: JSON.stringify({ error: 'Insufficient permissions' }) };
      } else {
        throw new Error('Malformed token');
      }
    } catch(e) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: ' + e.message }) };
    }
    const payload = JSON.parse(event.body || '{}');
    const repoFull = payload.repo || process.env.REPO_FULL_NAME || 'Silent-Tiga/my-private-novel';
    const [owner, repo] = repoFull.split('/');
    const path = payload.path;
    const action = payload.action;
    const message = payload.message || `Apply action ${action} via Netlify Function`;
    if (!path || !action) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing path or action' }) };
    }

    // Create or ensure entry
    let file = await getFile({ owner, repo, path, token });
    if (action === 'create_entry') {
      if (!file) {
        const fm = Object.assign({ title: payload.title || '新条目', date: new Date().toISOString(), draft: !!payload.draft }, payload.frontmatter || {});
        const front = buildFrontMatter(fm);
        const body = (payload.content || '').trim();
        const newContent = `${front}\n\n${body}\n`;
        await putFile({ owner, repo, path, token, content: newContent, sha: undefined, message: payload.message || `Create ${path}` });
        return { statusCode: 200, body: JSON.stringify({ ok: true, created: true }) };
      } else {
        // already exists, treat as ensured
        return { statusCode: 200, body: JSON.stringify({ ok: true, created: false, exists: true }) };
      }
    }

    if (!file) {
      return { statusCode: 404, body: JSON.stringify({ error: 'File not found', path }) };
    }

    const { fm, body } = parseFrontMatter(file.content);

    if (action === 'toggle_comments') {
      const enabled = !!(payload && payload.enabled);
      fm.comments_enabled = enabled;
      const newFront = buildFrontMatter(fm);
      const newContent = `${newFront}\n\n${body.trim()}\n`;
      await putFile({ owner, repo, path, token, content: newContent, sha: file.sha, message });
      return { statusCode: 200, body: JSON.stringify({ ok: true, comments_enabled: enabled }) };
    }

    if (action === 'set_cards') {
      const cardsYaml = buildCardsYaml(payload && payload.cards ? payload.cards : []);
      const newFront = buildFrontMatter(fm, cardsYaml);
      const newContent = `${newFront}\n\n${body.trim()}\n`;
      await putFile({ owner, repo, path, token, content: newContent, sha: file.sha, message });
      return { statusCode: 200, body: JSON.stringify({ ok: true, cards_count: (payload.cards || []).length }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unsupported action' }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};