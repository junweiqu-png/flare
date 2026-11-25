# Flare 导航

用于 GitHub Pages 的个人导航。手机和电脑均可访问，页面不依赖 NAS、870 或 Docker 在线。
导航指向的 NAS、密码管理器和其他服务仍需各自在线。

## 当前恢复状态

当前为部分恢复版本。根据已有记录找回 6 个旧入口，完整原始备份尚未读取。
已有记录曾报告原导航为 46 个 URL、10 个分类、10 个顶部应用；该数量尚未用原文件重新核对。
当前 `data/nav.json` 的分类为恢复期间临时分组，不代表原分类。

## 更新数据

修改 `data/nav.json` 后提交到 `main`，GitHub Actions 自动生成并发布网页。
所有导航数据直接写入生成的 HTML，打开网页时无需额外请求数据文件或第三方脚本。

如果拿到原备份 `data-original.json`，先检查内容和结构，然后运行：

```sh
python3 scripts/import_flare.py /path/to/data-original.json
python3 scripts/build.py
```

核对导入数量、每个分类以及顶部应用后，再将 `recovery.complete` 改为 `true`。
导入程序支持常见的 apps/bookmarks/categories JSON 结构；未知结构会报错，需要按实际原文件调整。
它不会凭条目数量自动声称完整恢复。

## 首次部署

1. 使用 `junweiqu-png/flare` 独立仓库。
2. 上传本目录的源文件到 `main`。
3. 在仓库 Settings → Pages 的 Source 中选择 GitHub Actions。
4. 检查 Publish navigation 运行成功，并实际打开 Pages 返回的网址。

公开页面和仓库不要包含密码、API 密钥、登录 Cookie、完整原服务器配置或带登录凭据的 URL。
构建程序会拒绝明显含用户名密码或密钥参数的链接。
