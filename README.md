# MIXXTOPIA 💙

像素剧情冒险网页游戏，灵感来自 **NMIXX《Strange Muse》**（第六张迷你专辑，主打《긴 소원 (Birthday Wish)》）。

> 生日夜许下的愿望化作星星散落梦境 —— 与六位缪斯一起把它们找回来。

- 🕹️ **玩法**：俯视角探索 + NPC 对话 + 解谜收集，6 关对应 6 首曲目
- 🧱 **技术**：纯 HTML/CSS/JavaScript（Canvas），零依赖
- 🚀 **在线试玩**：<https://ideer0126.github.io/MIXXTOPIA/>（开发中）

## 版本通道

| 通道 | 地址 | 来源 |
|---|---|---|
| 稳定版 | <https://ideer0126.github.io/MIXXTOPIA/> | 最新 `vX.Y.Z` tag（还没有正式 tag 时回退 `main`） |
| 测试版 | <https://ideer0126.github.io/MIXXTOPIA/beta/> | 最新 `vX.Y.Z-beta.N` / `-rc.N` tag |
| 预览版 | <https://ideer0126.github.io/MIXXTOPIA/preview/> | `main` 最新提交 |

> beta / preview 使用独立的 localStorage 键（`.beta` / `.preview`），不会覆盖稳定版存档；两个通道都带 `noindex`，请直接把链接发给测试者，不要放到公开入口。
>
> 如果最新 beta tag 的版本不高于当前 stable，`/beta/` 会显示“测试版暂未开放”占位页，避免测试者误以为在测新版本。

## 开发状态

| 里程碑 | 状态 |
|---|---|
| M0 项目基建 | ✅ 已完成 |
| M1 引擎框架 | ✅ 已完成（#1–#7 全部合并） |
| M2 核心玩法 | 🔵 进行中（#8 存档、#9 收集与解谜机制已实现；#11 地图数据待做；#10 选关已取消，改为 3 存档位） |
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
