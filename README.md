# MIXXTOPIA 💙

像素剧情冒险网页游戏，灵感来自 **NMIXX《Strange Muse》**（第六张迷你专辑，主打《긴 소원 (Birthday Wish)》）。

> 生日夜许下的愿望化作星星散落梦境 —— 与六位缪斯一起把它们找回来。

- 🕹️ **玩法**：俯视角探索 + NPC 对话 + 解谜收集，6 关对应 6 首曲目
- 🧱 **技术**：纯 HTML/CSS/JavaScript（Canvas），零依赖
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
| M2 核心玩法 | 🔵 进行中（#8 存档、#9 收集与解谜机制、#43 账户登录、#44 账户设置已实现；#11 地图数据待做；#10 选关已取消，改为 3 存档位） |
| M3 内容制作 | ⚪ 未开始 |
| M4 表现打磨 | ⚪ 未开始 |
| M5 发布验收 | ⚪ 未开始 |

📋 开发计划与任务分配见 **[PLAN.md](PLAN.md)**，详细设计见 `docs/GAME_DESIGN.md`。

## 本地运行

```bash
# 任意静态服务器即可，例如：
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 声明

粉丝自制同人作品，非官方、非商用；不使用原曲音频（全部为原创 8-bit 音效）。
