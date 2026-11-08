# Issue #86 — 后台化妆间确认版与本地验收

2026-11-08；分支 `feat/86-backstage-redesign`。用户确认 v5 后已接入游戏；尚未发布。

## 实际游戏截图

- [后台整图（运行时四个镜头拼接）](runtime/overview.png)
- [碰撞叠加整图](runtime/collision.png)
- [镜背前后遮挡](runtime/mirror-occlusion.png)
- [逐项可达性与像素检查数据](runtime/audit-results.json)
- [桌面入口](runtime/desktop-entry.png)、[左侧角色](runtime/desktop-left.png)
- [竖屏模拟触屏入口](runtime/portrait-entry.png)、[左侧角色](runtime/portrait-left.png)
- [横屏模拟触屏入口](runtime/landscape-entry.png)、[左侧角色](runtime/landscape-left.png)

图片均来自实际 Chromium Canvas / 页面。整图展示进入后台、尚未完成必要祝福时的状态，因此没有第三星，星光门未亮。运行时主角沿用原 parent 动作图集，Muse 高 40px；没有重做角色。

## 美术与构图

采用 [backstage-room-v5.webp](../../../assets/scenes/level1/backstage-room-v5.webp)，从确认 PNG 无损转换，逐像素核对 RGBA 相同。底图对应同关卡世界 (40,3)、28×25 格（448×400 逻辑像素），原图 1327×1185，运行图保留同尺寸以匹配三倍细节缓冲。

保留 20 个矩形镜台与 20 个圆凳，中央背靠背。左侧 Taylor Swift 海报保留，中间 / 右侧取用旧版鲸鱼 / 海浪图案；十个镜背后沿的用品已清空，正面台面用品保留。人物、聊天提示、第三星与星光门全部独立绘制。

- [确认时的礼堂 / 人物同尺度对照](comparison-v5.png)
- [确认时的路线标注](annotated-v5.png)
- [确认时的无标注人物叠放](actors-v5.png)
- [入口修订对照](entrance-v1-v2.png)
- [完整 PNG 稿与编辑局部](sources/)
- [首版提示词](../../../assets/scenes/level1/backstage-room-v1.prompt.md)、[入口编辑](../../../assets/scenes/level1/backstage-room-v2.prompt.md)、[矩形镜编辑](../../../assets/scenes/level1/backstage-room-v3.prompt.md)、[海报还原记录](../../../assets/scenes/level1/backstage-room-v4.prompt.md)、[镜背用品编辑](../../../assets/scenes/level1/backstage-room-v5.prompt.md)

PNG 草稿与生成局部放在本目录的 sources/ 下保留，不进入站点 / 下载包。预览页 `tools/preview-backstage86.html` 仍可切换人物、路线、网格及导出；它保留构图评审时的示意站位，正式实体坐标以下表为准。

## 接线与关卡契约

| 对象 | 正式世界坐标 / 行为 |
|---|---|
| 礼堂蓝幕 | (33,6)，仍从南侧向北走入；两星及播放唱片前置保留 |
| 后台入口 / 读档落点 | (65,20)，1.4 秒渐亮；没有返回礼堂的门实体 |
| Lily / Haewon / Sullyoon | (43,11)、(45,11)、(47,11) |
| Bae / Jiwoo / Kyujin | (43,22)、(45,22)、(47,22) |
| Byeori | (45,17) |
| 第三星 s3 | (47,17)，Lily / Sullyoon / Byeori 三段对话全部结束后出现，接触收集 |
| 朝右星光门 | (42,17)，三颗星与三段必要对话齐全后才过关 |

保留原到达、唱片、对话和收星标记及存档格式。旧后台存档没有持久化角色位置，继续使用当前入口 (65,20)；实测该落点不在家具、墙或 NPC 中。显式重玩清除到达标记、回礼堂重新收星。第一关仍无战斗；第二关未接入时结算后返回标题。

礼堂底图、实体、音乐与前置流程未更改。

## 碰撞与遮挡

后台与礼堂共用 `collision.compile` 和 1px 段采样。后台旧 F 家具阻挡已移除，外围墙体瓦片保留；20 个镜台、20 个圆凳及收纳 / 墙边物件共 46 项独立几何。家具数据用逻辑像素网格，运行时、校验器、路线工具读取同一份矩形。

两条横向主过道的落地阻挡净距均为 41px；扣除成人脚底高 5px，玩家位置可连续移动的净宽为 36px。Node 检查逐像素覆盖两条 262px 长的完整通道带。桌身与中央岛实心，镜背上部只做视觉遮挡；凳腿 / 桌腿空隙及相邻镜背外侧不回绘地板。上方吊挂盆栽没有虚构地面矩形。

`Birthday.drawActors` 按当前房间选择底图，使用脚底排序和各物件轮廓重画；礼堂仍使用原取样与演奏前景逻辑。设计参考沿用已查阅的 [Solarus 接地锚点与纵向排序](https://docs.solarus-games.org/lua-api/map-entities/)，没有引入新引擎或运行库。

## 验证结果

- `npm ci` 完成；58 份 JS 语法通过。
- `node tools/validate.js --level 1`：0 错误 / 警告。
- 默认全量校验：48 项既有错误，来自未制作的关 2–6、总关数 / 星数与下一关出口引用。
- engine、main、level1、collision、auth、account、cloud、stats、channels、rings、password-recovery、build 共 12 套 Node 测试，397 项 / 组通过。
- `tools/test-runtime-images.py`：源图删除 / 改名清理、alpha 与整张后台保持细节尺寸通过；源 / 运行清单均记录 1327×1185。
- 7 个浏览器脚本通过：level1-map、level1-collision、level1-actors、level1-visual、local-file、rings、build。
- map 巡检在桌面、竖屏 / 横屏模拟触屏分别覆盖礼堂 64 项及后台 46 项、后台 167 条可达接近路线。各方向持续接触后均可退开，没有进入实体。
- 后台实际键盘四向 15/30/60/144fps、斜向、触屏方向键通过；镜背、南侧镜背、凳腿、桌腿四类像素探针均验证“实心处盖住人物、真实空隙保留人物”。
- 从正常礼堂流程通关，六位 Muse 与 Byeori 均可接近互动；刚到后台、部分祝福、收完 s3 三种存档恢复及显式重玩通过，未提前发星或奖励。
- 打包页面桌面 / 横竖屏通关、后台读档、重玩缓存与缺图降级 / 恢复通过；直接 file:// 桌面与模拟触屏人物、对话、移动 / 暂停通过。
- 所有上述浏览器运行无控制台 / 页面异常。模拟触屏不等同于真实设备，真实手机尚未验收。
- `git diff --check` 通过。

## 改动范围

- `js/data.js`：确认版底图 / 后台加载组、世界实体坐标、46 项物件的落地矩形与独立轮廓。
- `js/birthday.js`、`js/collision.js`：复用两个房间的背景取样、脚底排序与共享碰撞。
- `tools/validate.js`、level1 / main / collision 测试、play-level1 路线与整图冒烟：迁移旧整格假设，补后台实际输入、像素探针、存档 / 重玩和通行净宽检查。
- `tools/build-runtime-images.py`、导出测试、运行图 / 清单：后台整图保留细节尺寸；按场景加载时从礼堂新增 2 张 / 2,042,494 B，冷启动后台存档加载 5 张，均复用缓存。
- PLAN、GAME_DESIGN、IMAGE_LOADING 与素材说明同步。未修改 .github 或其他治理配置。
