# MIXXTOPIA 💙

像素剧情冒险网页游戏，灵感来自 **NMIXX《Strange Muse》**（第六张迷你专辑，主打《긴 소원 (Birthday Wish)》）。

> 生日夜许下的愿望化作星星散落梦境 —— 与六位缪斯一起把它们找回来。

- 🕹️ **玩法**：俯视角探索 + NPC 对话 + 解谜收集，6 关对应 6 首曲目
- ⚔️ **轻战斗**：F 轻击 / G 重击（手机 B / C），只锁定正面 180° 扇形内、视线可达的敌人；被动能量条攒满后按 F 或 G 释放能量炮，射程为普攻 2.2 倍
- 🧱 **技术**：纯 HTML/CSS/JavaScript（Canvas），零运行时依赖；esbuild 构建、WebP 图片
- 🚀 **当前测试版**：<https://ideer0126.github.io/MIXXTOPIA/beta/>（稳定版尚未发布）

## 版本通道

| 通道 | 地址 | 当前阶段 |
|---|---|---|
| 稳定版 | <https://ideer0126.github.io/MIXXTOPIA/> | 尚未发布；首个 `vX.Y.Z` tag 后启用 |
| 测试版 | <https://ideer0126.github.io/MIXXTOPIA/beta/> | 仅测试期可用；首个稳定版发布后停用 |
| 预览版 | <https://ideer0126.github.io/MIXXTOPIA/preview/> | 首个稳定版发布后开放；来源 `main` |

> 测试期 `/` 与 `/preview/` 只显示占位页，游戏入口是 `/beta/`。
>
> 首个 `vX.Y.Z` 发布后：`/` 切到稳定 tag，`/preview/` 开放 `main` 最新提交，**`/beta/` 停用并显示“测试版已停用”**；之后 beta/rc tag 会被发布流程直接拒绝。
>
> beta / preview 使用独立的 localStorage 键（`.beta` / `.preview`），不会覆盖稳定版存档；beta/preview 及占位页都带 `noindex`，用于请求搜索引擎不要收录这些页面。测试期 beta 进度不会自动并入稳定版。

## 开发状态

| 里程碑 | 状态 |
|---|---|
| M0 项目基建 | ✅ 已完成 |
| M1 引擎框架 | ✅ 已完成（#1–#7 全部合并） |
| M2 核心玩法 | 🔵 进行中（#8 存档、#9 收集与解谜机制、#18 轻战斗 v1、#43 账户登录、#44 账户设置已实现；#11 地图数据待做；#10 选关已取消，改为 3 存档位） |
| M3 内容制作 | ⚪ 未开始 |
| M4 表现打磨 | ⚪ 未开始 |
| M5 发布验收 | ⚪ 未开始 |

📋 开发计划与任务分配见 **[PLAN.md](PLAN.md)**，详细设计见 `docs/GAME_DESIGN.md`。

## 本地运行

源码仍可用静态服务器直接运行，保留分文件 JS 便于调试。发布 / 离线产物使用一个游戏 JS 和独立的一个找回密码 JS：

```bash
npm ci
npm run build
python3 -m http.server 8000 --directory dist
# 打开 http://localhost:8000
```

`npm run build` 可重复执行，仅替换已有构建目录；自定义输出使用 `node tools/build-site.js --out <目录>`。
产物是普通静态文件，无需 Node 服务、CDN 或运行时第三方依赖。离线包解压后用任意静态服务器打开。

本地预览测试通道（`/` 和 `/preview/` 为占位页）：

```bash
npm run build:channels -- --worktree --out _site --beta-ref worktree --beta-label local
python3 -m http.server 8000 --directory _site
# 打开 http://localhost:8000/beta/
```

图片统一为 WebP；像素图、透明立绘与现有封面均无损转换，保持原尺寸与 RGBA 像素。
新增图片请导出无损 WebP（保留透明通道），随后执行 `npm run test:build` 检查引用及产物。
构建读取 HTML 中的脚本顺序，esbuild 合并压缩并生成内容哈希文件名；`build.json` 记录各入口文件和来源模块。
三通道在打包前注入通道信息，旧 tag 保持自身的脚本与图片格式，不混入新版本资源。
验收与体积对比见 [BUILD_OPTIMIZATION.md](docs/BUILD_OPTIMIZATION.md)。

## 声明

粉丝自制同人作品，非官方、非商用；不使用原曲音频（全部为原创 8-bit 音效）。
