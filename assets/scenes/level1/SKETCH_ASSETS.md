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

## 已接入：Muse 成人 NPC 比例与账户头像（2026-10-28）

- [muse-costumes-v4.png](muse-costumes-v4.png)：加大头部、缩短躯干与腿部，按普通成人 NPC 比例重做六人四向站姿；[提示词与布局说明](muse-costumes-v4.prompt.md)。已替换游戏中的 v3 图集；旧 PNG 保留。
- [muse-portraits-v1.png](../../avatars/muse-portraits-v1.png)：独立六人头像，三列两行，与角色妆造对应；[提示词](../../avatars/muse-portraits-v1.prompt.md)。已用于账户选择按钮与选中预览，沿用现有 `muse-1` 至 `muse-6`，保留前端白名单与数据库 ID 格式校验。
- 账户头像文件及六人 / ID / 图集位置对应表见 [`assets/avatars/README.md`](../../avatars/README.md)。

## 用户确认版礼堂与人物（2026-10-28）

- [birthday-hall-v2.png](birthday-hall-v2.png)：最终确认预览派生的静态底图，长欢迎地毯、木门框、蓝鲸舞台、韩文横幅、彩带和游玩摊位；不含人物、可收集星和唱片。[完整提示词](birthday-hall-v2.prompt.md)。
- [party-guests-v2.png](party-guests-v2.png)：成人和儿童独立 RGBA 图集，待机与迈步两帧；运行时分别以 40px 和 25px 高度绘制。[完整提示词](party-guests-v2.prompt.md)。
- 两张图均由内置 image_gen 生成，保存原输出；底图为 RGB，不要求透明。物理碰撞不依赖底图的颜色，逐帧取样框在 data.js 的 party.sprites 中。
- 背景上展示的环形 / 星形靶是游玩道具，真正的奖励星为实体，完成套圈前不可收集。杂物间唱片使用原官方封面，缩到约一格显示，不烘焙进底图。

## 确认后的 Muse 妆造与动作（2026-10-28）

- [muse-costumes-v3.png](muse-costumes-v3.png)：旧版：按用户六人参考图制作的四向固定站立图集（已由 v4 替换，保留源文件），六人各自一行，礼堂 / 后台保持固定站位。[完整提示词](muse-costumes-v3.prompt.md)。
- [party-adult-walk-v3.png](party-adult-walk-v3.png)、[party-child-walk-v3.png](party-child-walk-v3.png)：确认的蓝裙成人 / 蓝衣儿童四向动作。
- [party-parent-walk-v3.png](party-parent-walk-v3.png)、[party-pink-walk-v3.png](party-pink-walk-v3.png)、[party-yellow-walk-v3.png](party-yellow-walk-v3.png)：沿用黄开衫成人、粉衣女孩和黄衣男孩的旧造型扩展四向动作。[动作提示词组](party-motion-v3.prompt.md)。
- 全部由内置 image_gen 生成并保留原始 RGBA；party-guests-v2.png 不覆盖，旧角色继续用于老师、家长、儿童和加载失败时的降级。
- 与背景共用原生像素网格：普通成人 / Muse 40px，儿童 25px。动作预览里的单独放大不带入游戏。普通角色四向缓存为 40×40，按源图实际主体框和脚下锚点绘制；帧表在 data.js 中，不假定生成图等分。
- 帧缓存只在内存中对齐与修正接触腿；头部不随外轮廓宽度左右漂移。人物位置、步行动作与对话进度互相独立，暂停、对话、隐藏页面均不推进动作时间。

Muse 当前显示高度仍为 40 逻辑像素，使用 60×60 细节缓存；普通成人 40×40 缓存、儿童高 25 像素。主画布使用三倍细节缓冲，逻辑分辨率与碰撞坐标不变。

## 脚底 / 碰撞 / 遮挡修正（2026-10-28）

继续使用原 `birthday-hall-v2.png`，不重绘或删除原图。杂物间的方块门来自运行时 `gift-door` 实体，已移除该实体及相关开门台词。家具采样框、脚底占地和遮挡轮廓在 `js/data.js` 中分开配置，避免重画家具时连同周围地板覆盖人物。入口儿童路线移到椅前横道。黑胶唱片在 `js/main.js` 里按细网格绘制沟槽、反光和标签，继续使用原专辑封面。

## 舞台演奏姿态（#74，2026-10-30）

使用内置 `image_gen`，以原 `muse-costumes-v4.png` 的身份、妆造和像素画风为参考制作专用图集。原图集与原背景均保留，新人物图保留生成输出的 RGBA，未修改源文件像素。

| 图集 | 布局与用途 | 完整提示词 |
|---|---|---|
| [haewon-drums-v1.png](haewon-drums-v1.png) | 1536×1024，横排四姿态；坐姿、弯肘、握棒。运行时按原图第 2 / 1 / 3 / 1 姿态交替击打，休止使用第 1 姿态 | [prompt](haewon-drums-v1.prompt.md) |
| [kyujin-guitar-v1.png](kyujin-guitar-v1.png) | 1254×1254，两列两行；背带、吉他、持琴双手和人物一体，按阅读顺序四帧拨弦 | [prompt](kyujin-guitar-v1.prompt.md) |

生成布局不假定等分裁切，`js/data.js` 的 `party.performances` 保存实际取样框与共同锚点。显示仍为 40 逻辑像素、60px 细节缓存；动作每秒六帧，交谈时保持握棒 / 持琴休止帧，后台继续使用原站姿。

试玩后修订：Kyujin 的缓存帧固定使用同一个休止底图，只从各姿态替换 `motionRegion:[12,21,9,9]` 的拨弦手区域。头发、脸、衣服、琴身、琴颈和鞋在区域外逐像素一致；不改写原 PNG。`tools/smoke-level1-visual.js` 在实际浏览器校验该不变量并导出四帧预览。

鼓组按原背景的 `foregroundShapes` 再绘前排通鼓与鼓沿，避免坐姿的腰腿盖掉鼓面轮廓。Haewon 水平偏移 -0.6 格，与鼓组中轴对齐；Kyujin 从 (23,7) 移至 (21,7)。

- [birthday-hall-v3.png](birthday-hall-v3.png)：内置 image_gen 编辑原背景中的备用乐器，换成更小的四弦贝斯。只合成原图 (843,180)、60×105 像素的局部区域；该区域外 RGB 像素与 v2 完全一致，音箱不变。原 v2 保留。[完整提示词与局部范围](birthday-hall-v3.prompt.md)。贝斯脚底碰撞与前景轮廓同步缩小。
