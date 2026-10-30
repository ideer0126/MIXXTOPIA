# JS 打包与 WebP 验收（Issue #93）

Issue：https://github.com/ideer0126/MIXXTOPIA/issues/93

本次基于最新 `main` / `55acfab`。源码继续按 `js/*.js` 拆分维护，发布时用锁定版本的 esbuild 合并压缩，不增加浏览器运行时依赖。

## 构建与发布

- `npm ci`：安装锁定的构建依赖。
- `npm run build`：生成 `dist/`，可直接用静态服务器运行，也可作为 ZIP 内容。
- `npm run build:channels -- --worktree --out _site --beta-ref worktree --beta-label local`：本地三通道产物。
- `npm run test:build`：入口隔离、全局 API、图片路径、重复构建、旧 tag 和上线检查工具回归。
- `MIXX_PLAYWRIGHT_MODULE=<Playwright 模块路径> node tools/smoke-build.js`：本地打包产物桌面、触屏竖屏 / 横屏通关；可用 `MIXX_CHROME` 指定 Chrome 可执行文件。

`tools/build-site.js` 按 HTML 中现有顺序收集 classic scripts，交给 esbuild 合并压缩。游戏页和找回页分别生成一个带内容哈希的 JS；找回页保留 `defer`，不包含游戏引擎或游戏启动。`build.json` 记录入口文件、原模块及输出大小，供发布检查使用。已合并的源码脚本不重复进入产物。

`tools/build-channels.js` 先从每个 ref 提取该版本的静态资源，完成通道注入，再对支持新构建的版本打包；通道信息与游戏同包，先于 main 执行。旧 tag 由是否包含 `tools/build-site.js` 识别，继续使用其自身脚本与原图片，不混用当前工作区。回归覆盖 `v0.5.0-beta.3`。工作流仅增加构建依赖安装、产物打包与相关检查，保留现有发布触发与通道选择。

所有引用均为相对路径，兼容 Pages 子目录、beta/preview 子目录与离线静态服务器。`check-account-release.js` 同时识别旧的分文件页面和新的 bundle 清单；不执行下载的 JavaScript。

## 体积与画质

以下字节数未包含 HTTP gzip/Brotli，由同一源码树的原文件和新构建产物直接统计：

| 项目 | 改造前 | 改造后 |
|---|---:|---:|
| 游戏入口 JS 请求（普通离线入口） | 12 | 1 |
| 游戏入口 JS 请求（含通道注入） | 13 | 1 |
| 普通入口 JS 总字节 | 560,885 | 293,315（减少 47.7%） |
| 找回页 JS 请求 | 3 | 1 |
| 仓库全部 32 张图片总字节 | 60,418,364 | 47,020,578（减少 22.2%） |

图片统一用 Pillow / libwebp 的 `lossless=True, exact=True, method=6` 转换。每张图重新解码后与原图逐字节比较 RGBA，并核对尺寸；32 张全部一致。保留 ICC profile（原图存在时）。像素边缘、透明度、图集取样坐标、立绘裁切及头像 ID 均不变。

为保持完全相同的解码像素，JPEG 封面也采用无损 WebP，因此该图从 3,194,303 字节增至 5,513,710 字节；上表已经计入这一增量。全量 PNG/JPEG 由 WebP 替换，不在运行时继续保留双份图片。

## 本地启动测量

回环 HTTP、Chrome 无头浏览器、每次新建上下文（5 次取中位数），关闭云功能并用空 CSS 桩替代现有可选 Google 字体请求：

| 指标 | 原分文件 + 原图片 | 新打包 + WebP |
|---|---:|---:|
| DOMContentLoaded | 37.2 ms | 49.2 ms |
| 页面 load | 149.7 ms | 138.7 ms |

回环场景中 DOMContentLoaded 并未变快；这些小样本受本机调度、解析和解码影响，不能用来保证真实线上启动提升。

另以 Chrome DevTools Protocol 模拟 1.6 Mbps 下载、750 Kbps 上传、150 ms 延迟，3 次全新上下文取中位数。等待 DOMContentLoaded 与标题按钮可见，随后结束本次启动测量，不等后台图片全部下载完成：

| 模拟网络指标 | 原分文件 + 原图片 | 新打包 + WebP |
|---|---:|---:|
| 标题可操作 | 3,337.4 ms | 1,963.6 ms（减少约 41.2%） |
| DOMContentLoaded | 3,317.7 ms | 1,940.9 ms |

这些是本机静态服务器的未压缩传输结果，不等同于真实移动设备或 GitHub Pages 的 HTTP/2、gzip/Brotli 环境；尚未部署或进行线上测速。

## 验证记录

- `npm ci`、全部 JS 的 `node --check` 通过。
- `validate.js --level 1`、`test-level1.js`、`test-engine.js`、`test-main.js`、`test-auth.js`、`test-account.js`、`test-cloud.js`、`test-stats.js`、`test-password-recovery.js`、`test-channels.js`、`test-build.js`、`test-account-release.js` 全部通过。
- 新打包产物：桌面 1280×900、触屏 390×844 / 844×390，均验证单 JS、自启动、WebP 图集 / 头像 / 立绘解码、第一关完整通关、beta 存档隔离和独立找回页；无本地资源 404 或控制台错误。可选 Google 字体使用 CSS 桩，无真实后端请求。
- `smoke-password-recovery.js`：新打包产物的 12 组桌面 / 触屏回归通过，全部使用本地 Auth 桩，不发送真实邮件。
- 两个工作流的 14 个 shell 块通过 `bash -n`。实际执行 Pages 的 Verify site，覆盖测试期 beta 和稳定版 + preview 两种产物布局。
- 离线构建目录生成成功，ZIP 使用 Python 标准库生成并通过完整性、文件清单与 SHA-256 校验。本机缺少 `zip/unzip`，未在本机完整执行工作流中的这两条外部命令；Ubuntu CI 尚未运行。
- 默认全量 `node tools/validate.js` 仍为既有 **48 项错误**（关 2–6 尚未制作），不作为本次回归，也不表示全量发布验收通过。

## 实施参考

- [esbuild API](https://esbuild.github.io/api/)
- [Phaser 官方构建模板](https://github.com/phaserjs/template-vite)（参考网页游戏源码与发布产物分离的做法，本项目无需迁移引擎或引入 Vite）
- [WebP 无损与透明通道](https://developers.google.com/speed/webp)
