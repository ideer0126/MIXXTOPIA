# 用户草图版场景素材（2026-10-26）

根据用户提供的礼堂 / 后台两张草图布置。人物仍为占位标记。

内置 `image_gen` 生成的 PNG 均保持原始 RGBA，没有移除 alpha，也没有覆盖旧版素材。

| 文件 | 用途 | 完整提示词 |
|---|---|---|
| stage-curtains-v1.png | 蓝色舞台帷幕、台口，鲸鱼画布另绘在后方 | [prompt](stage-curtains-v1.prompt.md) |
| party-games-v1.png | 窗户、套圈、钓鱼、鲸鱼气球、沙包、杂物箱 | [prompt](party-games-v1.prompt.md) |
| dressing-music-v1.png | 正 / 反面化妆台、海报、唱片机、椅子 | [prompt](dressing-music-v1.prompt.md) |
| stage-instruments-v1.png | 钢琴、鼓组、吉他 / 贝斯、服装与舞台道具 | [prompt](stage-instruments-v1.prompt.md) |
| vanity-modules-v1.png | 单人正 / 背面圆镜梳妆台、椅子、推车、成组布景与服装（后台修正版） | [prompt](vanity-modules-v1.prompt.md) |
| star-portal-east-v1.png | 面朝画面右侧入口的星光门，由原传送门编辑 | [prompt](star-portal-east-v1.prompt.md) |

图集为 1536×1024、3×2 单元格，各 512×512；帷幕使用整张 1536×1024。
取样坐标由 `js/data.js` 定义，原始 PNG 保留不改写。

后台修正版使用 20 个独立单人梳妆台，512×512 单元以 3×3 瓦片等比例绘制，不再横向拉宽三镜连排图。
化妆凳在绘制时取样实际主体范围（233×280），按原比例落在对应座位格内，避免透明留白让凳子缩成小点。
新传送门为 1024×1536，绘制比例 3×4.5 瓦片，门面和落地光圈朝右。
家具的 `collision` 矩形完整映射到 F 瓦片，校验器拒绝碰撞区域内出现可通行格。

## 《Strange Muse》官方专辑封面

- 文件：`strange-muse-cover.jpg`（3000×3000 原始 JPEG）。
- 来源：[NMIXX 官方专辑页](https://nmixx.jype.com/discography/vmgvjirm)，2026-10-26 获取。
- [官网封面原图](https://d1meds70430yck.cloudfront.net/images/2026/10/19/gAAAAABq1bhBHhHk0tuO6Aec8oxpLjg113YUPOcugt_HZvHDW9CIO1GiyT10KmGzMD_3fjHojIDLpKmgZkaHaXuw-7VFyrAmavKBstvn_p8Q_ldYr6N6p38NA5URQRr1TliDes0OqUhhnDUWYuKMCuw1a9U0gycAXg%3D%3D/05f1125b0b2c25f6e0440245ad7a46c09e597226.jpg)。
- 直接用于唱片封套，未使用生成图替代，也没有修改原始封面。权利归 JYP Entertainment 等原权利方；与项目原创 / 生成场景素材分开标明来源。
- 黑胶盘片在 Canvas 中单独绘制，生成图集中原有的鲸鱼唱片套不用于实际唱片道具。
- 唱片机当前有原创合成启动提示音；未随项目提供专辑原声录音。
