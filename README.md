# 私人论坛 / 小说站点开发与部署指南

本项目基于 Hugo + Netlify Functions + Cloudflare R2（可选）构建，包含论坛讨论、内容管理与私有媒体访问能力。本文档提供本地开发与环境变量配置说明，并总结近期的安全性与体验改进。

## 本地开发
- 运行 Hugo 开发服务器（已在另一个终端中运行也可）：
  - `hugo server -D`
- 运行 Netlify Functions（用于登录、评论、上传等）：
  - 在项目根目录执行：`netlify dev`
  - 本地函数默认暴露在 `http://localhost:8888/.netlify/functions/*`
- 前端登录逻辑会优先请求 `/.netlify/functions/auth-login`，若不可用会自动回退到 `http://localhost:8888/.netlify/functions/auth-login`

## 必需环境变量（Netlify）
请在 Netlify UI 或 CLI 中设置以下环境变量（不要提交到仓库）：
- `JWT_SECRET`：后端签发与校验 JWT 的密钥（前端不持有）。
- `USERS_JSON`：可选，JSON 形如：`{"admin":{"passwordHash":"<sha256>","role":"admin","permissions":["read","write","delete","admin"]}}`
- `PASS_SALT`：对密码进行加盐的 Salt。
- `ACCESS_SALT`：对默认访问密钥进行加盐的 Salt（不设置则沿用 `PASS_SALT`）。
- `DEFAULT_ACCESS_KEY_HASH`：默认访问密钥的哈希（Hex），算法：`sha256(ACCESS_SALT + <your-access-key>)`。
- `DEFAULT_ROLE`：默认访问密钥登录后的角色（如 `reader`）。
- `JWT_EXP_MS`：JWT 过期毫秒数（默认 `86400000`）。

CLI 示例（建议使用 Netlify CLI 在项目目录执行）：
```
netlify env:set JWT_SECRET <your-strong-secret>
netlify env:set PASS_SALT <your-pass-salt>
netlify env:set ACCESS_SALT <your-access-salt>
netlify env:set DEFAULT_ACCESS_KEY_HASH <sha256_hex_of_ACCESS_SALT+access_key>
netlify env:set DEFAULT_ROLE reader
netlify env:set JWT_EXP_MS 86400000
```

在 Windows PowerShell 临时本地测试（`netlify dev` 会读取已设置的环境或 `.env`）：
```
$env:JWT_SECRET="<your-strong-secret>"
$env:PASS_SALT="<your-pass-salt>"
$env:ACCESS_SALT="<your-access-salt>"
$env:DEFAULT_ACCESS_KEY_HASH="<sha256_hex>"
```

## 功能要点与近期改动
- 登录与权限：
  - 新增 `netlify/functions/auth-login.js`，由后端签发 JWT；前端不再生成或验证签名，仅解码 payload 用于 UI。
  - 前端 `setAccess` 改为异步请求后端，自动回退到本地 `netlify dev`；令牌保存于 `localStorage`。
  - 后端函数（`update-md.js`、`save-comment.js`、`upload-image.js`）移除了不安全的密钥默认值，统一依赖 `process.env.JWT_SECRET`。
- 错误处理：
  - 前端对操作状态进行了分类提示（401/403 权限不足、409 内容冲突、5xx 服务器错误、网络失败等）。
- slug 处理：
  - 替换为 Unicode 感知的 `slugify`，保留中/英文与数字，自动清理多余连字符，空值回退为 `untitled-<timestamp>`。
- 视觉优化：
  - 讨论区分隔线统一为 1px 单线，减少视觉噪音；相关页面已在 Hugo 热更新中确认。

## Cloudflare R2 媒体访问（可选）
- 使用 `workers/cloudflare-r2-media.js` 通过 Worker + R2 代理私有访问。
- 在 `workers/README.md` 中补充了配置说明：
  - Worker 的 `JWT_SECRET` 需与 Netlify Functions 的 `JWT_SECRET` 保持一致。
  - 前端通过后端签发的 JWT 访问媒体（不在前端存储密钥）。

## 目录结构
- `layouts/_default/baseof.html`：前端逻辑与页面骨架。
- `netlify/functions/`：后端函数（登录、更新、评论、上传）。
- `workers/`：Cloudflare Worker 与说明。

## 提示
- 当仅运行 Hugo 而未运行 `netlify dev` 时，登录与需要后端的操作将不可用；前端会给出明确提示。
- 建议使用 Netlify 环境变量而非在 `netlify.toml` 中写死密钥；`netlify.toml` 适合声明函数目录与构建配置。