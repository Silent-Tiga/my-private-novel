# Cloudflare R2 + Workers 媒体私有访问部署指南

本目录包含 `cloudflare-r2-media.js`，用于在 Cloudflare Workers 上通过 R2 代理私有媒体访问。

## 前提
- 已创建 Cloudflare 账号与 R2 Bucket（如：`my-private-media`）
- 已安装 `wrangler` CLI（`npm i -g wrangler`）

## 项目结构与绑定
建议在你的 Workers 项目中使用以下文件：
- `cloudflare-r2-media.js`（本仓库提供）
- `wrangler.toml`（配置 R2 绑定与环境变量）

示例 `wrangler.toml`：

```toml
name = "r2-media-proxy"
main = "cloudflare-r2-media.js"
compatibility_date = "2024-08-01"

[vars]
JWT_SECRET = "<your-strong-secret>" # 与后端签发 JWT 的密钥保持一致（如 CloudBase 云函数；前端不持有密钥）

[[r2_buckets]]
bucket_name = "my-private-media"
binding = "MY_BUCKET"

[routes]
# 可选：绑定到你的域名
# "https://media.example.com/*"
```

> 注意：本示例使用了简化版 JWT 校验，需与前端保持一致，仅用于私域与低风险场景。生产环境请使用标准 JWT 或更严谨的权限方案。

## 部署

```bash
# 进入包含 wrangler.toml 与 cloudflare-r2-media.js 的目录
wrangler deploy
```

部署完成后，将得到一个 `*.workers.dev` 域名或你的自定义域名。

## 前端配置
在 Hugo 的 `layouts/_default/baseof.html` 已注入：
- `window.CF_MEDIA_BASE`：设置为你的 Worker 基地址（如 `https://r2-media-proxy.yourname.workers.dev`）
- `cfMediaUrl(key)`：拼接访问地址：`<CF_MEDIA_BASE>/api/media/get?key=<key>&t=<jwt>`

你需要修改：
- 将 `window.CF_MEDIA_BASE` 从默认值改为你的 Worker 域名
- 确保你的后端服务（如 CloudBase 云函数）使用与 `wrangler.toml` 中 `JWT_SECRET` 一致的密钥（Worker 使用该密钥校验后端签发的 JWT）

## 使用方法（在讨论区）
- 在帖子内容中写入 `cf://路径/文件名.ext`（例如 `cf://images/banner.jpg` 或 `cf://video/clip.mp4`）
- 前端会自动将该标记解析为私有访问链接并渲染为 `<img>` 或 `<video>`

## 权限与安全
- 当前实现：只要用户能登录并生成 JWT（reader/editor/admin），即可访问私有媒体。
- 可选增强：
  - 将 `role` 校验提升为仅 `editor/admin` 可访问；
  - 引入标准 JWT（HS256）与后端签名；
  - 在 Worker 中按照对象前缀进行访问控制（如 `images/` 所有人可读、`raw/` 仅管理员可读）。

## 常见问题
- 图片/视频无法显示：检查 `CF_MEDIA_BASE` 是否正确、`JWT_SECRET` 是否与前端一致、R2 对象 `key` 是否存在。
- MIME 类型不正确：在 R2 上传时设置 `Content-Type`，或依赖 Worker 的 `guessContentType`。
- 跨域问题：若需要从其它站点访问，考虑在 Worker 中设置 `Access-Control-Allow-Origin`，当前默认为站内使用。