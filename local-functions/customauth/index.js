// 本地开发版 customauth 云函数（Express），端口默认 3000
// 支持 OPTIONS 预检与 POST /auth，返回必要的 CORS 头
// 开发用途：与 whistle 代理结合，将云端请求重写到本地

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// 环境配置
try { require('dotenv').config(); } catch(_) {}
const ENV_ID = process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || 'my-private-forum-7fq5eue4c2a67da';
const SECRET_ID = process.env.CLOUDBASE_SECRET_ID || process.env.TCB_SECRET_ID || '';
const SECRET_KEY = process.env.CLOUDBASE_SECRET_KEY || process.env.TCB_SECRET_KEY || '';
const COLLS = {
  users: process.env.CB_USERS_COLLECTION || process.env.TCB_DB_USERS || 'users',
  posts: process.env.CB_POSTS_COLLECTION || process.env.TCB_DB_POSTS || 'posts',
  novels: process.env.CB_NOVELS_COLLECTION || process.env.TCB_DB_NOVELS || 'novels'
};

// CloudBase Node SDK（用于服务端访问数据库与生成自定义票据）
let tcb = null, tcbApp = null, tcbDb = null, tcbAuth = null;
try {
  tcb = require('@cloudbase/node-sdk');
  // 使用 envId + secretId/secretKey 初始化，兼容当前 SDK
  tcbApp = tcb.init({ envId: ENV_ID, secretId: SECRET_ID, secretKey: SECRET_KEY });
  tcbDb = tcbApp.database();
  tcbAuth = tcbApp.auth();
  console.log('[customauth] CloudBase SDK initialized for env:', ENV_ID);
} catch (e) {
  console.warn('[customauth] CloudBase SDK init failed:', e.message);
}

app.use(express.json({ limit: '1mb' }));

// CORS 中间件（动态允许来源）
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type');
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

// 预检
app.options('/auth', (req, res) => { res.status(204).end(); });

// 简易用户存储（开发用）
const USERS = {
  admin: { passwordHash: 'admin2024', role: 'admin', permissions: ['read','write','delete','admin'] },
  editor: { passwordHash: 'editor2024', role: 'editor', permissions: ['read','write'] },
  reader: { passwordHash: 'reader2024', role: 'reader', permissions: ['read'] }
};

// 登录接口：返回自定义票据（用于前端 auth.signInWithCustomTicket）
app.post('/auth', async (req, res) => {
  try {
    const { action, data } = req.body || {};
    if (!action) return res.status(400).json({ success:false, error:'missing action' });

    if (action === 'login') {
      const { username, password } = data || {};
      const u = USERS[username];
      if (!u) return res.status(401).json({ success:false, error:'user not found' });
      if (String(password) !== String(u.passwordHash)) {
        return res.status(401).json({ success:false, error:'invalid password' });
      }
      let token = '';
      try {
        if (tcbAuth && SECRET_ID && SECRET_KEY) {
          token = await tcbAuth.createTicket(username, { expiresIn: 3600 * 24 }); // 24h
        }
      } catch (e) {
        console.warn('[customauth] createTicket failed:', e.message);
      }
      return res.json({ success:true, token, user:{ uid: username, role: u.role, permissions: u.permissions } });
    }

    if (action === 'changePassword') {
      const { username, oldPassword, newPassword } = data || {};
      const u = USERS[username];
      if (!u) return res.status(401).json({ success:false, error:'user not found' });
      if (String(oldPassword) !== String(u.passwordHash)) {
        return res.status(401).json({ success:false, error:'invalid old password' });
      }
      USERS[username].passwordHash = String(newPassword);
      return res.json({ success:true });
    }

    return res.status(400).json({ success:false, error:'unsupported action' });
  } catch (e) {
    res.status(500).json({ success:false, error: e.message || 'server error' });
  }
});

// 只读代理：获取小说列表（默认仅公开文档）
app.get('/db/novels', async (req, res) => {
  try {
    if (!tcbDb) return res.status(500).json({ success:false, error:'CloudBase not configured' });
    const visibility = req.query.visibility || 'public';
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const r = await tcbDb.collection(COLLS.novels).where({ visibility }).limit(limit).get();
    return res.json({ success:true, data: r.data || [] });
  } catch (e) {
    return res.status(500).json({ success:false, error: e.message || 'db error' });
  }
});

// 健康检查
app.get('/healthz', (req, res) => res.json({ ok:true, env: ENV_ID }));

app.listen(PORT, () => {
  console.log(`Local customauth listening on http://127.0.0.1:${PORT}`);
});

// 保底：避免未捕获异常导致服务退出
process.on('unhandledRejection', (err) => {
  console.warn('[customauth] unhandledRejection:', err && err.message || String(err));
});
process.on('uncaughtException', (err) => {
  console.error('[customauth] uncaughtException:', err && err.message || String(err));
});