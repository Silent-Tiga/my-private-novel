# 私人论坛 / 小说站点：CloudBase + GitHub Pages 架构指南

本项目将从 Netlify Functions 迁移至「静态前端（GitHub Pages）」+「数据与权限（CloudBase）」的架构。静态页面通过 Hugo 构建并托管到 GitHub Pages；帖子、站点设定、小说内容与用户权限统一由 CloudBase 提供并通过前端 Web SDK 读取与更新。

## 架构概览
- 前端：`Hugo` 生成静态站点，部署到 `GitHub Pages`。
- 后端服务：`CloudBase`（数据库、鉴权、云函数、存储）。
- 数据流：页面加载 → 初始化 CloudBase → 用户登录 → 根据角色拉取集合数据（posts/novels/site_settings）→ 前端渲染。
- 权限策略：CloudBase 鉴权 + 数据库权限规则（按角色/用户粒度读写）。

## CloudBase 初始化（前端）
在前端页面中引入 CloudBase Web SDK 并初始化（示例）：
```
<script src="https://imgcache.qq.com/qcloud/cloudbase-js-sdk/1.7.2/cloudbase.min.js"></script>
<script>
  const app = cloudbase.init({ env: '<your-env-id>' });
  const auth = app.auth({ persistence: 'local' });
  const db = app.database();
  // 登录示例（CloudBase 2.x 邮箱/密码；本项目默认使用用户名匿名会话）
  // const provider = auth.emailAuthProvider();
  // const res = await provider.signIn(email, password);
  // const user = res.user || res;
  // // 或使用匿名会话 + 用户名档案映射（见 layouts/_default/baseof.html）
  // const state = await auth.getLoginState();
</script>
```

## 建议的集合与字段
- `users`: `{ uid, username, role, nickname }`
- `roles`: `{ role, permissions: ['read','write','moderate','admin'] }`
- `posts`: `{ id, title, content, author_uid, created_at, updated_at, status }`
- `novels`: `{ id, title, chapters: [ ... ], tags, author_uid, visibility }`
- `site_settings`: `{ default_role, menus, feature_flags }`

> 通过 CloudBase 控制台配置数据库访问规则：
- 游客：仅可读公共文档（如 `visibility: public`）。
- `reader`：可读全部公开文档；不可写。
- `editor`：可写自己创建的帖子/小说；不可写他人文档。
- `admin`：可读写所有文档，并可管理角色。

## 前端改造要点
- 登录与权限：
  - 用 CloudBase `auth` 替换本地假登录；登录成功后在 `localStorage` 持久化登录态。
  - `hasPermission()` 改为读取用户的 `role/permissions` 并与页面 `data-permission` 匹配。
- 数据渲染：
  - 将原先静态内容或 Netlify 写入逻辑替换为：页面加载后通过 CloudBase `db` 拉取文档并渲染（列表、详情、评论等）。
  - 新增数据写入场景（发帖/评论/编辑）时，直接 `db.collection('posts').add/update`，由 CloudBase 规则决定是否允许。
- 评论与上传：
  - 评论保存由 `db` 直接写入或通过云函数校验后写入。
  - 媒体可使用 CloudBase 存储，或保留 Cloudflare R2（如需私有访问），通过云函数签名 URL。

## 部署到 GitHub Pages
- 仓库启用 Pages（`Settings -> Pages`），选择分支（如 `main`）与输出目录（默认 `root` 或 `docs/`）。
- Hugo 构建产物默认在 `public/`；可将构建结果推送到 `gh-pages` 分支，或配置 GitHub Actions 自动构建。

## 迁移与清理
- 已删除：`netlify.toml`。
- 可删除（或保留为空）：`netlify/` 目录（不再使用）。
- 代码中的 `/.netlify/functions/*` 引用应逐步替换为 CloudBase `db` 操作或云函数 HTTP 入口。
- 文档说明已切换到 CloudBase；后续不再使用 Netlify。

## 后续任务清单（建议）
1. 在 CloudBase 创建环境与基础集合，并配置数据库访问规则与鉴权方式（邮箱密码 / 自定义登录）。
2. 在 `layouts/_default/baseof.html` 引入并初始化 CloudBase SDK（新增 `partials/cloudbase-init.html` 亦可）。
3. 将登录表单事件改为调用 CloudBase `auth` 登录，并在登录成功后刷新权限与数据渲染。
4. 将评论、发帖、编辑等逻辑改为访问 CloudBase 集合或云函数入口。
5. 清理前端中所有 Netlify 相关文案与链接，替换为 CloudBase 描述。

## 备注
- GitHub Pages 仅托管静态文件；所有动态功能需依赖 CloudBase（或其他后端）。
- 若需要图片私有访问与鉴权，可通过 CloudBase 存储或继续使用 Worker/R2，但鉴权应统一在 CloudBase 端完成。