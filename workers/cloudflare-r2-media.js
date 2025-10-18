// Cloudflare Workers: R2 媒体私有访问代理
// 路由：GET /api/media/get?key=<objectKey>&t=<jwt>
// 说明：
// - 通过 R2 绑定读取对象并以流式响应返回图片/视频等文件；
// - 使用简化版 JWT（与前端一致的 HS256 简化实现）验证访问令牌；
// - 仅验证角色存在即可访问（reader/editor/admin），后续可扩展权限与签名过期更严谨校验；
// - 请在 wrangler.toml 中绑定 R2 bucket 和设置 JWT_SECRET。

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/api/media/get') {
      return handleGet(request, env, url);
    }

    return new Response('Not Found', { status: 404 });
  }
}

async function handleGet(request, env, url) {
  const key = url.searchParams.get('key');
  const token = url.searchParams.get('t') || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!key) return new Response(JSON.stringify({ error: 'missing key' }), { status: 400, headers: jsonHeaders() });

  // 验证JWT（与前端一致的简化版）
  const payload = verifyJWT(token, env.JWT_SECRET);
  if (!payload || !payload.role) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: jsonHeaders() });
  }

  try {
    const obj = await env.MY_BUCKET.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });

    const headers = new Headers();
    const ct = obj.httpMetadata && obj.httpMetadata.contentType ? obj.httpMetadata.contentType : guessContentType(key);
    if (ct) headers.set('Content-Type', ct);

    // 可选缓存策略（私有，短期缓存）
    headers.set('Cache-Control', 'private, max-age=60');

    // Range 支持（视频分段播放更友好）
    const range = request.headers.get('Range');
    if (range) {
      const size = obj.size;
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : size - 1;
        const chunk = obj.body.slice(start, end + 1);
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
        headers.set('Accept-Ranges', 'bytes');
        return new Response(chunk, { status: 206, headers });
      }
    }

    headers.set('Accept-Ranges', 'bytes');
    return new Response(obj.body, { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'internal', detail: String(e) }), { status: 500, headers: jsonHeaders() });
  }
}

function jsonHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function guessContentType(key) {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.ogg')) return 'video/ogg';
  return 'application/octet-stream';
}

// 简化版 JWT 验证（与前端保持一致）
function verifyJWT(token, secret) {
  try {
    if (!token || !secret) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(atob(parts[0]));
    const payload = JSON.parse(atob(parts[1]));
    const expected = btoa(`${parts[0]}.${parts[1]}.${secret}`);
    if (parts[2] !== expected) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}