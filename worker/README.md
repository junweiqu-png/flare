# Flare 同步服务

这是公开导航对应的独立个人区，使用 Cloudflare Workers Free 与 D1。账户保持免费套餐；超出免费额度时服务可能暂不可用，不自动升级付费。

## 配置

1. 在导航所有者的 GitHub 账号中创建 OAuth App。主页与回调地址填公开导航主页，并启用 Device Flow。记录公开的 Client ID；不生成 Client Secret，不申请 repo、gist 或其他数据权限。
2. 在自己的 Cloudflare 账号创建 D1 数据库，执行 `migrations/0001_initial.sql` 的结构。该文件只有结构，没有私密导航或种子数据。
3. 创建 Worker，把构建得到的 `dist-worker/worker.mjs` 作为 ES Module 部署。绑定 D1 到 `DB`。
4. 配置非秘密变量 `GITHUB_CLIENT_ID`、`ALLOWED_GITHUB_ID`、`SITE_URL`。本项目所有者的公开数字 ID 为 `308556221`；`SITE_URL` 为 `https://junweiqu-png.github.io/flare/`。服务端必须核对数字 ID，不能只比较显示名称。
5. 可配置每天一次 `15 3 * * *` 的维护任务，清理过期会话、登录流程和速率计数；不会删除导航或回收站。
6. 打开服务 `/app`，使用所有者的 GitHub 账号验证。通过“备份与恢复”导入完整导航文件。初始化和后续写入同样检查身份及版本。
7. 验证匿名访问 `/api/state` 被拒绝、`/api/public` 没有私密名称或地址，再把 Worker HTTPS 来源写到 `data/client-config.json` 并重新构建发布 Pages。

也可以使用官方 Wrangler，替换 `wrangler.jsonc` 中的公开 Client ID 和数据库 ID，先执行迁移后部署。数据库 ID 和 Client ID 不是访问凭据。不要把任何 Cloudflare API Token、Cookie、GitHub 访问令牌或原私密导航放进仓库。

## 接口

- `GET /app`：个人导航页面；未登录只显示公开入口。
- `GET /health`：配置就绪状态。
- `GET /api/public`：经过同一隐私规则二次过滤的公开导航。
- `POST /auth/device/start`、`POST /auth/device/poll`：仅公开身份的 GitHub 登录。
- `GET /api/me`、`GET /api/state`：仅所有者可读取。
- `PUT /api/state`：携带 `expectedVersion` 和 `state`；版本冲突返回 409。
- `POST /auth/logout`：撤销当前会话并清除 Cookie。

个人区 API 不接受公开 GitHub Pages 来源的跨站访问。Cookie 会话默认 30 天；退出会撤销服务端会话，页面同时清除内存中的私密内容。当前版本不缓存私密页面数据用于离线阅读。
