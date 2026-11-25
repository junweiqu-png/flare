# Flare 导航

从原 Flare 的 `apps.yml`、`bookmarks.yml`、`config.yml` 恢复的 GitHub Pages 静态导航。

网页：[https://junweiqu-png.github.io/flare/](https://junweiqu-png.github.io/flare/)

原文件共有 **10 个应用、50 个书签、10 个分类**。保留应用顺序、各分类内的书签顺序和全部名称；分类按原定义排列。
页面包含原配置的蓝色主题、时间问候、北京时间和新窗口打开设置，支持应用/书签搜索、分类筛选、手机布局和深浅主题。

有 1 个代理入口包含私密访问标识。公开源码仅保留名称和本机入口标识，原地址不上传。
点击该入口可在自己的浏览器填写完整地址，仅保存在本机；其他设备需分别设置。
内网和本机链接保留原地址，并标注使用范围；目标服务仍需在线，且设备需要能访问相应网络。

## 更新导航

编辑 `data/nav.json`，提交到 `main` 后自动构建并发布。公开页面不依赖 NAS 或 870 在线。

从原 YAML 再导入时，在装有 PyYAML 的开发环境运行：

```sh
python3 scripts/import_yaml.py /path/to/original-flare-directory
python3 scripts/build.py
```

构建和线上运行无需第三方依赖。GitHub Pages 托管生成的 HTML，不运行 Flare 服务端、数据库或原后台编辑器。
`env.env`、数据库凭据和 ARM 可执行程序不进入仓库。

原 Flare 项目：[soulteary/docker-flare](https://github.com/soulteary/docker-flare)。本仓库使用随原文件提供的 AGPL-3.0 许可证，见 `LICENSE`。
