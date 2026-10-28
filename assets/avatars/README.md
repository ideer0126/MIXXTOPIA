# 账户头像素材

## 当前使用的文件

- **`muse-portraits-v1.png`**：六位 Muse 的透明头像图集，1536×1024，三列两行，每格 512×512。用于账户设置的头像按钮和选中预览。
- **`muse-portraits-v1.prompt.md`**：生成提示词与参考说明。
- 第一关角色四向图集位于 **`assets/scenes/level1/muse-costumes-v4.png`**；它是全身角色，不是账户头像。

| 名字 | 账户 ID | 图集位置（从 1 开始） |
|---|---|---|
| Lily | `muse-1` | 第 1 行第 1 列 |
| Haewon | `muse-2` | 第 1 行第 2 列 |
| Sullyoon | `muse-3` | 第 1 行第 3 列 |
| Bae | `muse-4` | 第 2 行第 1 列 |
| Jiwoo | `muse-5` | 第 2 行第 2 列 |
| Kyujin | `muse-6` | 第 2 行第 3 列 |

接入配置在 `js/data.js` 的 `GAME.avatarPresets`：`art` 指向此 PNG，`portraitCell` 使用从 0 开始的 `[列, 行]`。`js/account.js` 保留并校验本地素材元数据，`js/main.js` 和 `styles.css` 负责显示。账户仍保存原有头像 ID，不上传图片，也不改数据库约束。

原始 PNG 保留透明通道；界面通过 CSS 取图集格子，不重写原图。
