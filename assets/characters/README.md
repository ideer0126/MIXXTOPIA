# assets/characters · 角色绘画素材

> 存放**我们自己画的**角色绘画素材（原创，非官方图源）。
> 两种用途：① `art/` 原画 → 用于聊天框（对话框）**右上方**的角色头像；
> ② `pixel/` 由原画衍生的**像素游戏角色**（供 `js/sprites.js` 接入，对应 Issue #13）。

## 目录结构

```
assets/characters/
├── README.md          # 本文件：命名与规格规范
├── nswer/             # NSWER（玩家，全程）
│   ├── art/           # 原画 + 聊天框头像成品
│   └── pixel/         # 像素角色衍生
├── lily/              # Lily
├── haewon/            # Haewon
├── sullyoon/          # Sullyoon
├── bae/               # Bae
├── jiwoo/             # Jiwoo
├── kyujin/            # Kyujin
├── byeori/            # Byeori（별이，星星引导精灵）
├── dj/                # 街头DJ（关 3 捷径守门人，实体 NPC）
└── sheep/             # 黑羊（검은 양，彩蛋 NPC）
```

每个角色目录内固定两个子目录：`art/` 与 `pixel/`（已放置 `.gitkeep`，图未画好也能把结构提交进仓库）。

## 角色对照表

| 目录 | 角色 | speaker id | 姓名框色（GAME_DESIGN §3） | 素材状态 |
|---|---|---|---|---|
| `nswer/` | NSWER（玩家） | —（旁白用 `nar`） | `#FFFFFF` | ⬜ 未开始 |
| `lily/` | Lily | `lily` | `#7FB8E6` | ⬜ 未开始 |
| `haewon/` | Haewon | `haewon` | `#FFB14E` | ⬜ 未开始 |
| `sullyoon/` | Sullyoon | `sullyoon` | `#B49BFF` | ⬜ 未开始 |
| `bae/` | Bae | `bae` | `#FF7BA9` | ⬜ 未开始 |
| `jiwoo/` | Jiwoo | `jiwoo` | `#FFE066` | ⬜ 未开始 |
| `kyujin/` | Kyujin | `kyujin` | `#5EE6B8` | ⬜ 未开始 |
| `byeori/` | Byeori | `byeori` | `#FFD700` | ⬜ 未开始 |
| `dj/` | 街头DJ | `dj` | `#FF5D8F` | ⬜ 未开始 |
| `sheep/` | 黑羊 | `sheep` | `#B8A8E0` | ⬜ 未开始 |

> 另有两位对话专用伪说话人「旁白 `nar`」「全员合唱 `all`」不单独建目录（无立绘需求）。

## art/ —— 聊天框头像原画

- **用途**：`index.html` 对话框 `#dialog` 右上方框外的说话人头像位（**UI 已由 Issue #28 接线**：按 speaker 自动加载 `<speaker>-portrait.png`，`nar`/`all` 无立绘、缺图自动隐藏）。
- **格式**：PNG、透明背景、**3:4 竖版**（宽:高 = 3:4），角色**半身照**构图。
- **尺寸建议**：原画/源文件（PSD、AI、大图）随意放；**交付头像成品建议 768×1024**（头像位显示宽 = 对话框宽 × 2/6，高 = 宽 × 4/3，4x 缩放时约 420×560px，768×1024 可覆盖 2x 高 DPI）。
- **命名**：`<speaker>-portrait.png`，如 `lily-portrait.png`；过程稿自由命名，如 `lily-sketch.png`。
- **要求**：同一角色的头像与原画保持同一配色，方便像素化时取色。

## pixel/ —— 像素游戏角色衍生

- **依据**：GAME_DESIGN §14 美术需求清单（Issue #13 的输入）。
- **规格**：16×16px 基准瓦片、整数倍放大、`image-rendering: pixelated`。
- **帧需求**：
  - NSWER：4 向 × 步行 2 帧（共 8 帧）+ 待机；
  - 6 位缪斯：待机 2 帧 + 对话表情；
  - Byeori：漂浮 2 帧；黑羊：待机 + 表情。
- **命名**：单帧 `<speaker>-<方向>-<帧号>.png`（如 `nswer-down-1.png`）；也欢迎直接出精灵表 `<speaker>-sheet.png`。
- **交付**：最终像素数据接入 `js/sprites.js`；每关调色板主题色参考 GAME_DESIGN §14，角色主体色建议保持全关一致（识别度优先）。

## 工作流（原画 → 头像 → 像素）

1. 在 `<角色>/art/` 放入自己画的原画；
2. 由原画裁切/处理出 3:4 竖版半身照透明 PNG 头像（建议 768×1024），存同目录（供聊天框右上方框外头像位使用）；
3. 以头像配色为基准，绘制 16px 像素角色，存 `<角色>/pixel/`；
4. Issue #13 开工时，把 `pixel/` 素材转录进 `js/sprites.js`，并把本表「素材状态」改为 ✅。
