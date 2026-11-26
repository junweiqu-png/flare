# Flare 导航

网页：[https://junweiqu-png.github.io/flare/](https://junweiqu-png.github.io/flare/)

从原 Flare 恢复的个人导航。第二版支持搜索、常用置顶、分类、别名和标签、可视化编辑、双地址、回收站及 JSON / 浏览器书签导入导出，手机和电脑均可使用。

原数据为 **10 个应用、50 个书签、10 个分类**。按新的隐私设置拆分为 **52 个公开入口、8 个私密入口**，总数仍为 60。公开页面只包含公开条目和私密条目的总数。

## 页面与同步

- GitHub Pages 提供公开导航，打开网页不依赖家里的 NAS 或电脑。
- “GitHub 登录”打开独立来源的个人导航。只有配置的 GitHub 用户 ID 可以读取私密数据和编辑；身份验证只需要 GitHub 公开身份，不申请仓库读写权限。
- 个人导航使用 Cloudflare Worker + D1。登录会话使用 HttpOnly、Secure、SameSite=Lax Cookie，浏览器脚本和公开导航均拿不到会话令牌；GitHub 提供商令牌仅用于确认身份，不落库。
- 所有导航记录保存在 D1。浏览器只保存主题、首选访问地址、退出偏好和**公开**导航快照。私密条目不进入 GitHub Pages、公开 API、本地持久导航缓存或未勾选“包含私密入口”的导出。
- 同步每次写入均检查版本。其他设备已更新时拒绝旧版本，避免静默覆盖。页面可见且没有打开编辑窗口时，每 30 秒刷新一次。
- 删除是移入回收站，可恢复；导入按条目 ID 和完整地址去重，保留已有条目。
- 内网与外网地址手动切换，每台设备记住自己的偏好。导航页面可访问不代表对应的内网设备在线。

旧版曾公开的内网条目可能仍存在于仓库历史中；第二版隐私过滤不等同于清除 Git 历史。含私密访问标识的原地址未提交到公开仓库。

## 部署状态

`data/client-config.json` 的 `apiBase` 是独立同步服务的 HTTPS 来源。为空时，页面明确显示快照状态，登录和编辑不会伪装成已接通。Worker 部署、数据库初始化和 GitHub 登录均完成后，再填写该地址并发布 Pages。

同步服务部署见 [worker/README.md](worker/README.md)。源码、构建产物和迁移文件均不包含 GitHub Client Secret；当前实现使用 GitHub Device Flow，不需要 Client Secret。

## 开发与检查

需要 Node.js 24 和 Python 3；应用和构建没有第三方运行依赖。

```sh
npm test
npm run build
```

`data/nav.json` 只能保存公开记录。构建前校验内网、本机、URL 凭据和已知敏感参数；私密数据混入时立即停止构建。迁移时的完整原始数据只导入受保护的个人导航，不放进源码。

- `src/model.mjs`：前端、服务端和构建共用的数据校验与公开过滤。
- `src/app.js`、`src/style.css`、`src/index.html`：导航交互与页面。
- `worker/index.mjs`、`worker/migrations/`：同步接口、所有者权限及数据库结构。
- `dist/index.html`：Pages 构建产物；根目录 `index.html` 是同样的单文件页面。
- `dist-worker/worker.mjs`：可直接部署的自包含 Worker，构建时生成。
- `tests/`：真实 SQLite 上的接口检查，以及只使用示例数据的内部交互预览。

GitHub Actions 在 PR 中运行检查，在 main 发布 Pages。`env.env`、数据库凭据、完整迁移备份和原 ARM 可执行程序不进入仓库。旧版 YAML 导入脚本已停用，避免把私密原数据重新写入公开配置；日常迁移使用网页导入功能。

原 Flare 项目：[soulteary/docker-flare](https://github.com/soulteary/docker-flare)。沿用 AGPL-3.0，见 [LICENSE](LICENSE)。
