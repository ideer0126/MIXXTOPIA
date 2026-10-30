# assets/characters · 角色绘画素材

> 存放**我们自己画的**角色绘画素材（原创，非官方图源）。
> 两种用途：① `art/` 原画 → 用于聊天框（对话框）**右上方**的角色立绘；
> ② `pixel/` 由原画衍生的**像素游戏角色**（供 `js/sprites.js` 接入，对应 Issue #13）。

## 目录结构

```
assets/characters/
├── README.md          # 本文件：命名与规格规范
├── nswer/             # NSWER（玩家，全程）
│   ├── art/           # 原画（直接用作对话立绘）
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
| `haewon/` | Haewon | `haewon` | `#FFB14E` | 已接入 `art/haewon-1.webp` |
| `sullyoon/` | Sullyoon | `sullyoon` | `#B49BFF` | ⬜ 未开始 |
| `bae/` | Bae | `bae` | `#FF7BA9` | ⬜ 未开始 |
| `jiwoo/` | Jiwoo | `jiwoo` | `#FFE066` | ⬜ 未开始 |
| `kyujin/` | Kyujin | `kyujin` | `#5EE6B8` | ⬜ 未开始 |
| `byeori/` | Byeori | `byeori` | `#FFD700` | 已接入 `art/byeori.webp` |
| `dj/` | 街头DJ | `dj` | `#FF5D8F` | ⬜ 未开始 |
| `sheep/` | 黑羊 | `sheep` | `#B8A8E0` | ⬜ 未开始 |

> 另有两位对话专用伪说话人「旁白 `nar`」「全员合唱 `all`」不单独建目录（无立绘需求）。

## art/ —— 对话立绘原图

- **用途**：对话框 `#dialog` 右上方框外的说话人立绘，底边贴框顶、向上延伸。背景游戏场景压暗虚化（含序章），透明区域直接透出场景；不加画框、底板或装饰边缘。
- **接入**：在 `js/data.js` 的 `characters[speaker].portrait` 配置原图路径。当前使用 `haewon/art/haewon-1.webp` 和 `byeori/art/byeori.webp`，无需重命名、复制或另做头像成品。
- **底边对齐**：`portraitBottom` 记录原图底部透明留白占整图高度的比例（Haewon 修订版为 55/1448，Byeori 为 212/1448）；显示时裁去底部留白与零散残线，再按比例下移，使人物主体底边贴住对话框顶边，不修改原图文件。
- **格式**：使用带透明背景的无损 WebP 原图，保持原比例与完整内容，不强制 3:4、不裁切；使用平滑缩放，不作像素化处理。
- **显示尺寸**：默认宽度为对话框宽的 2/6，高度最多 45vh；手机矮横屏进一步缩小，避免超出画面。
- **缺图**：未配置素材的角色、`nar` / `all` 隐藏立绘；图片加载失败也隐藏，不影响台词和选项。
- **配色**：同一角色的原图与后续像素角色保持一致，方便取色。

## pixel/ —— 像素游戏角色衍生

- **依据**：GAME_DESIGN §14 美术需求清单（Issue #13 的输入）。
- **规格**：16×16px 基准瓦片、整数倍放大、`image-rendering: pixelated`。
- **帧需求**：
  - NSWER：4 向 × 步行 2 帧（共 8 帧）+ 待机；
  - 6 位缪斯：待机 2 帧 + 对话表情；
  - Byeori：漂浮 2 帧；黑羊：待机 + 表情。
- **命名**：单帧 `<speaker>-<方向>-<帧号>.webp`（如 `nswer-down-1.webp`）；也欢迎直接出精灵表 `<speaker>-sheet.webp`。
- **交付**：最终像素数据接入 `js/sprites.js`；每关调色板主题色参考 GAME_DESIGN §14，角色主体色建议保持全关一致（识别度优先）。

## 工作流（原画 → 对话立绘 / 像素角色）

1. 在 `<角色>/art/` 放入自己画的原画；
2. 在 `characters[speaker].portrait` 配置原图路径，直接用于对话框右上方立绘；
3. 以原图配色为基准，绘制 16px 像素角色，存 `<角色>/pixel/`；
4. Issue #13 开工时，把 `pixel/` 素材转录进 `js/sprites.js`，并把本表「素材状态」改为 ✅。
