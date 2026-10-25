# MIXXTOPIA · 开发计划

> 像素剧情冒险网页游戏 · 灵感来自 NMIXX《Strange Muse》
> 本文档定义开发工作流程与任务分配，是仓库内所有工作的唯一入口。

---

## 1. 项目定位

| 项 | 内容 |
|---|---|
| 名称 | MIXXTOPIA |
| 类型 | 俯视角像素剧情冒险 RPG（网页版） |
| 主题 | NMIXX 第六张迷你专辑《Strange Muse》（2026/10/19 发行，主打《긴 소원 (Birthday Wish)》） |
| 技术栈 | 纯 HTML / CSS / JavaScript（Canvas 渲染），零依赖、零构建 |
| 部署 | GitHub Pages，静态托管，移动端可玩 |
| 定位 | 粉丝同人作品，非官方、非商用 |

**概念关键词**：生日许愿 · 梦幻 · 三部曲终章（Blue Valentine → Heavy Serenade → Strange Muse）· 首次小分队曲 · 互为彼此的专属缪斯 · "긴 소원을 부릅니다, 응답하라 NSWER"

---

## 2. 世界观与玩法

### 2.1 剧情线

NSWER 在生日夜被一道星光带入梦境世界 **MIXXTOPIA**。六位缪斯（Lily、Haewon、Sullyoon、Bae、Jiwoo、Kyujin）许下的六个愿望化作星星，散落在六个梦幻区域。玩家要走过每一片区域、与缪斯对话、解开谜题、收集全部愿望之星，点亮许愿蛋糕，完成《Birthday Wish》的三部曲终章。

### 2.2 关卡结构（6 关 = 6 首曲目）

| 关 | 曲目 | 区域主题 | 出场成员 | 机制重点 |
|---|---|---|---|---|
| 1 | Birthday Wish (긴 소원) | 梦核幼儿园生日派对 | 全员登场 | 教学：移动/对话/收集/推箱/开关 |
| 2 | Kerosene | 灯油与火焰 | Jiwoo | 开关解谜（点燃灯柱） |
| 3 | RudE TaLK | 霓虹态度街头 | Kyujin | 单向门 + 路径推理 |
| 4 | Sing to the Moon (너는 달) | 月夜湖畔 | 小分队：Lily + Haewon | 水面/浮桥解谜 |
| 5 | Hot 'n Unbothered | 炎热沙漠绿洲 | 小分队：Sullyoon + Bae | 迷宫 + 限时收集 |
| 6 | WHIP (휙) | 疾风终章 | 小分队：Jiwoo + Kyujin + 全员 | 综合谜题 + 结局演出 |

> 三首小分队曲人员构成已于 2026-10-23 查证确认（《Strange Muse》收录 NMIXX 出道以来首次小分队曲；来源与风格细节见 GAME_DESIGN.md §13）。

### 2.3 核心循环

```
探索区域 → 与缪斯对话（推进剧情） → 解谜（开关/门/路径）
→ 收集愿望之星 → 点亮传送门 → 过关结算 → 下一关
```

- 每关 3–5 颗愿望之星；集齐后传送门开启。
- 对话为线性文本 + 打字机效果；部分节点有选项。
- 进度通过 localStorage 存档（3 个存档位；ESC「保存并退出」手动存档 + 通关自动存档；见 GAME_DESIGN.md §10）；账户与云存档已立项（见 §2.5）。

### 2.4 战斗系统（已立项，设计后置）

- 轻量战斗元素：玩家武器为 **NMIXX 二代应援棒**（挥击 / 蓄力 / 兼作光源），敌人为梦境侵蚀生物，终章一个 Boss。
- 需求已立项 [Issue #18](https://github.com/ideer0126/MIXXTOPIA/issues/18)；详细设计（机制 / 数值 / 敌人表 / 升级线）后续单独成文，评审后并入 GAME_DESIGN.md。
- 定位：剧情与解谜为主、战斗为点缀，粉丝向休闲难度。

### 2.5 账户与云存档（已立项，技术选型已定）

- **账户**：注册/登录（邮箱 + 密码，后续可扩展 OAuth）；未登录可游客游玩，登录后提示合并本地与云端存档。
- **账户设置**：昵称、头像（固定选项集、不支持上传自定义图片；集合由前端白名单维护，可随美术扩展）、音效/操作偏好。
- **云存档**：跨设备同步进度（沿用 GAME_DESIGN.md §10 数据结构，以云端 `version` 乐观锁 + 本地 `mixxtopia.cloud.v1` 逐档同步基线做冲突检测）。
- **资料统计**：游戏时长、成就、收集率；隐私最小化收集。
- **技术路线（2026-10-24 已定）**：后端 **Supabase**（Postgres + Auth），前端**手写 `fetch` 封装**直连 GoTrue / PostgREST、**不引 SDK**，保持零依赖与 Pages 静态部署；RLS 仅本人可读写，游客数据仅存本地。放弃 Firebase（须引 SDK，与零依赖约定冲突）。
- 规格已并入 `docs/GAME_DESIGN.md` §10；数据模型、同步时序与隐私要求见 `docs/ACCOUNT_SYSTEM.md`；实现子任务见 #42–#47。

---

## 3. 技术架构

```
MIXXTOPIA/
├── index.html            # 页面与 UI 容器（已建骨架）
├── styles.css            # 像素风样式、UI、移动端按键
├── js/
│   ├── sprites.js        # 像素素材：瓦片/角色/道具（调色板换色）
│   ├── audio.js          # WebAudio 芯片音效 + 每关 BGM 循环
│   ├── data.js           # 关卡数据：6 关地图 + 对话 + 谜题（数据驱动）
│   ├── engine.js         # 引擎：渲染、输入、碰撞、摄像机、粒子
│   └── main.js           # 状态机：标题/游玩/对话/暂停/结算/结局 + 存档
├── tools/validate.js     # 地图/数据校验脚本（node 运行）
├── tools/build-channels.js  # 三通道站点组装（stable/beta/preview）
├── tools/test-channels.js   # 三通道构建测试
├── docs/
│   └── GAME_DESIGN.md    # 详细设计：剧情文案、谜题表、对话稿（M1 前补）
├── .github/workflows/pages.yml  # GitHub Pages 三通道自动部署
├── README.md / LICENSE / .gitignore
```

**渲染规格**：逻辑分辨率 320×224（20×14 瓦片 × 16px），整数倍放大，`image-rendering: pixelated`。

---

## 4. Git 工作流与协作规范

- **分支模型**：`main` 为唯一长期分支；每个任务一条功能分支 `feat/<issue号>-<slug>`。
- **提交规范**（Conventional Commits）：`feat:` / `fix:` / `docs:` / `style:` / `refactor:` / `chore:` / `content:` / `art:` / `audio:` / `test:`。
- **任务跟踪**：一个任务 = 一个 GitHub Issue；分支与 PR 关联 Issue；合并后自动关闭。
- **质量门禁**（每次合并前）：
  1. `node --check` 全部 JS 通过；
  2. `node tools/validate.js` 地图/数据校验通过；
  3. 本地静态服务器冒烟测试（页面可加载、无控制台报错）。
- **已知红门禁（2026-10-24）**：`js/data.js` 的 `levels` 仍为空（#11 未开始），
  `node tools/validate.js` 必然报错（91 项，全部由空关卡/对话引用触发），**不视为回归**；
  期间以 `node --check` + `node tools/test-engine.js` + `node tools/test-main.js` + `node tools/test-channels.js` + 浏览器冒烟为准，
  #11 落地后恢复 validate 门禁。
- **发布**：测试期（无稳定 tag）`/` 与 `/preview/` 占位，`/beta/` 用 beta/rc tag 或 `main`；
  首个 `vX.Y.Z` 后 `/` 用 stable tag、`/preview/` 用 `main`、`/beta/` 用高于 stable 的 beta/rc tag。
  三份产物一次构建、一次 Pages 部署。

---

## 5. 里程碑

| 里程碑 | 目标 | 完成标志 |
|---|---|---|
| **M0 项目基建**（今天） | 计划、仓库、CI | 仓库可访问、PLAN.md 就绪、Issues 落地 |
| **M1 引擎框架** | 能跑起来 | 可进游戏、走动、碰撞、对话、暂停 |
| **M2 核心玩法** | 完整一关闭环 | 收集→开门→结算→选关 全流程可用 |
| **M3 内容制作** | 6 关全部可玩 | 6 关地图+剧情+角色全部就位 |
| **M4 表现打磨** | 有味道了 | 音效/BGM/粒子/过场/移动端按键齐全 |
| **M5 发布验收** | 上线 | Pages 可玩、README 图文、冒烟测试通过 |

---

## 6. 任务分配

角色由 AI 分饰，按依赖顺序排列；`#` 为 GitHub Issue 编号。

| # | 任务 | 角色 | 产出物 | 里程碑 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 项目基建：git init、仓库创建、CI 工作流、.gitignore/LICENSE | 发布 | 仓库 + pages.yml | M0 | — | ✅ 已合并 |
| 2 | 开发计划与工作流文档 | 策划 | PLAN.md（本文件） | M0 | — | ✅ 已合并 |
| 3 | 游戏设计文档：剧情文案、关卡谜题表、对话稿 | 策划 | docs/GAME_DESIGN.md | M1 | #2 | ✅ 已合并 |
| 4 | Canvas 渲染引擎：瓦片图集、调色板、摄像机、缩放 | 程序 | js/engine.js 渲染部分 | M1 | #1 | ✅ 已合并 |
| 5 | 输入系统：键盘 + 触屏虚拟按键 | 程序 | js/engine.js 输入部分 | M1 | #4 | ✅ 已合并 |
| 6 | 游戏状态机与 UI 接线：标题/游玩/对话/暂停/结算/结局 | 程序 | js/main.js | M1 | #4 | ✅ 已合并 |
| 7 | 对话系统：打字机效果、姓名框、翻页 | 程序 | js/main.js 对话部分 | M1 | #6 | ✅ 已实现（分支 feat/7-dialogue-system，PR #27） |
| 8 | 存档系统：3 存档位（继续冒险/新游戏/选择存档；ESC 保存并退出；通关自动存档；删除需二次确认；声音设置独立） | 程序 | js/main.js 存档部分 + index.html/styles.css | M2 | #6 | ✅ 已实现（分支 feat/8-save-system） |
| 9 | 收集与解谜机制：星星、开关、门、传送门 | 程序 | js/engine.js 机制部分 + js/main.js 接线 + js/audio.js 最小音效 | M2 | #4 | ✅ 已合并（PR #41） |
| 10 | ~~选关界面与解锁规则~~ → 选存档界面已并入 #8（不做选关；GitHub Issue #10 文案待人工同步/关闭） | 程序 | 已由 #8 覆盖 | M2 | #8 | ⛔ 已取消（由 #8 替代） |
| 11 | 6 关地图数据（含谜题布局） | 策划 | js/data.js 地图 | M3 | #3 #9 | ⚪ 未开始 |
| 12 | 6 成员剧情对话文案接入 | 策划 | js/data.js 对话 | M3 | #3 #7 | ✅ 已实现（data.js 46 节点 + main.js 节点语义/选项 + 测试；校验器用 #30 的 tools/validate.js） |
| 13 | 像素美术：NSWER + 6 成员精灵、瓦片、道具 | 美术 | js/sprites.js | M3 | #4 | ⚪ 未开始 |
| 14 | 音频：芯片音效 + 6 关 BGM 循环 | 音频 | js/audio.js | M4 | #4 | ⚪ 未开始 |
| 15 | 表现打磨：粒子、过场演出、结算动画 | 程序 | js/engine.js 粒子 | M4 | #9 #13 | ⚪ 未开始 |
| 16 | QA：地图校验、浏览器冒烟测试、移动端适配 | QA | 测试报告 | M5 | #11–15 | ⚪ 未开始 |
| 17 | 发布：Pages 上线验证、README 图文 | 发布 | 线上可玩 + README | M5 | #16 | ⚪ 未开始 |
| 18 | 战斗系统立项：二代应援棒武器（设计后置，详见 Issue #18） | 策划+程序 | 战斗设计文档（并入 GAME_DESIGN.md） | M2 | #3 #9 | 📋 已立项 |
| 19 | 账户与云存档：注册/登录、账户设置、云同步、统计（**选型已定 A2：Supabase + 手写 REST，2026-10-24**；立项稿 `docs/ACCOUNT_SYSTEM.md`，Issue #22，子任务 #42–#47） | 策划+程序 | 设计文档（已并入 GAME_DESIGN.md §10） | M2（立项） | #6 #8 | 📋 已评审，子任务已建 |

---

## 7. GitHub 落地映射

- **Milestones**：M0–M5 六项（与 §5 一一对应）。
- **Labels**：`chore` `docs` `feat` `content` `art` `audio` `test` `release`（按角色/领域）。
- **Issues**：§6 表格中 18 个任务，全部关联 Milestone、标注 Label、指派给 `ideer0126`。
- **看板**：使用 Milestone 进度页 + Issue 勾选清单作为轻量看板，不额外引入 Project 复杂度。

---

## 8. 当前进度与后续节奏

**已完成（截至 2026-10-24）**
- [x] M0 项目基建：仓库、CI（pages.yml）、README/LICENSE/.gitignore、Milestones/Labels/Issues 落地
- [x] #3 游戏设计文档 docs/GAME_DESIGN.md（PR #19）
- [x] #4 Canvas 渲染引擎：瓦片图集、调色板、摄像机、整数缩放（PR #20）
- [x] #5 输入系统：键盘 + 触屏虚拟按键（PR #21）
- [x] #6 游戏状态机与 UI 接线：标题/游玩/对话/暂停/结算/结局六态 + HUD（PR #26）
- [x] #7 对话系统：打字机 25ms/字、按住加速、点按快进、E/空格/Enter/点击翻页、对话期间玩家锁定与计时暂停（分支 feat/7-dialogue-system，PR #27）
- [x] 剧情扩展（2026-10-23）：GAME_DESIGN.md v0.3 —— 世界观加入官方概念「互为彼此的专属缪斯」与神话倒影层（Lily=珀耳塞福涅 / Haewon=哈迪斯 / Sullyoon=阿芙洛狄忒 / Bae=德墨忒尔 / Kyujin=宙斯 / Jiwoo=赫尔墨斯）；小分队名单确认并落地到对话稿（§13）；依据：用户提供的抖音图文截图 + 新 MV 公开报道
- [x] #12 对话文案接入（2026-10-23）：js/data.js 全量对话（46 节点，§7 格式）；main.js 对话引擎补节点语义（intro/npc/hint/check 解析、once/next、选项列表 ↑↓+E、star/clear/load/sheep 自动分发、黑羊计数）；index.html/styles.css 选项 UI；测试 37 项全过 + 无头 Chrome 冒烟通过；数据校验统一走 #30 的 tools/validate.js（entry 语义已对齐）
- [x] 关 1 剧情重制（2026-10-24，Issue #34）：GAME_DESIGN v0.4 —— 区域改为「梦核幼儿园生日派对」，18 岁 NSWER 梦回童年，六位缪斯幼儿园文艺汇演妆造（成人身体、仅换妆造）；`l1.*` 对话稿细化并同步 js/data.js；新增关 1 40×28 地图布局草案（供 #11；美术见 #13）
- [x] #8 存档系统（2026-10-24，Issue #8）：3 存档位 + 手动存档（ESC「保存并退出」）+ 通关自动存档；标题改为「继续冒险 / 新游戏 / 选择存档」（**不做选关**）；读档恢复关卡/已收集星/once/黑羊；选择存档支持二次确认删除；损坏存档容错与存储不可用提示；声音设置独立持久化；test-main 52 项 + 无头浏览器冒烟通过（分支 feat/8-save-system）
- [x] #9 收集与解谜机制（2026-10-24，Issue #9）：`engine.Mechanics`（墙/水/门/箱碰撞、推箱一格、压力开关→门、踩门防夹）+ `engine.Particles`（星星拾取/开门/传送门粒子）+ `js/audio.js` 最小芯片音效（星/箱/开关/门/传送门，无 WebAudio 安静降级）；`main.js` 接线碰撞、推箱、开关门事件、星星拾取、传送门激活与 `portal.to` 跳关；占位关 1 增加「礼物盒 → 地垫 → 屏风门」闭环；test-engine 36 项 + test-main 59 项 + 无头浏览器冒烟 50 项检查通过（分支 feat/9-collect-puzzle-mechanics）

**下一步**
- [ ] M2：#11 先拆出「关 1 地图」子任务落地，让 `validate.js` 转绿并跑通真正的一关闭环
- [ ] M2：#10 已取消（不做选关；选存档并入 #8；GitHub Issue #10 文案待人工同步/关闭）
- [ ] #18 战斗系统：已立项，设计评审后另立子任务
- [ ] #19 账户系统：**选型已定（A2：Supabase + 手写 REST）**，子任务 #42–#47 已建；先做 #42（建表 + RLS + 文档），只加新文件，再动 `js/main.js`

**节奏**：每个任务一条分支、一个 PR、一次冒烟测试；里程碑完成即向用户演示。

---

## 9. 风险与待确认项

| 项 | 状态 | 处理 |
|---|---|---|
| 三首小分队曲人员构成 | 已确认（2026-10-23） | Sing to the Moon = Lily+Haewon、Hot 'n Unbothered = Sullyoon+Bae、WHIP = Jiwoo+Kyujin（多来源交叉确认，见 GAME_DESIGN.md §13）；对话 speaker 已按名单落地（v0.3），地图、谜题、星数、机制不变 |
| 音乐版权 | 不使用原曲音频 | 全部为原创 8-bit 音效/BGM，避免侵权 |
| 移动端操作 | 待测试 | M4 虚拟按键 + M5 真机/仿真验证 |
| Google Fonts 离线 | 有风险 | 提供 monospace 回退字体，不影响可玩性 |
| Pages 域名 | 已上线 | 正式地址 `https://ideer0126.github.io/MIXXTOPIA/`，可绑定自定义域名（见 §10） |
| 账户系统技术选型 | 已决策（2026-10-24） | **A2：Supabase + 手写 `fetch` 封装**（不引 SDK，保持零依赖）；放弃 Firebase（须引 SDK）。云存档要点已并入 GAME_DESIGN.md §10，实现子任务 #42–#47 已建（详见 `docs/ACCOUNT_SYSTEM.md`） |
| 选关取消 / GitHub Issue #10 | 已决策（2026-10-24） | 不做选关，改为 3 存档位「选择存档」并并入 #8；仓库文档已同步，**GitHub Issue #10 文案与状态待人工同步**（智能体不自行改远端） |
| 存档策略 | 已定（2026-10-24） | 手动存档制：仅 ESC「保存并退出」与通关自动存档写盘；「回到标题（不保存）」/刷新丢弃未保存进度；3 档位，继续=最新档 |

---

## 10. 发布与部署策略

> 决策结论：**不买服务器、不强制买域名**，纯静态游戏用 GitHub Pages 免费托管即可公开发布。

### 10.1 总体原则

1. **免费优先**：纯 HTML/CSS/JS、零后端 → 静态托管免费方案完全够用（GitHub Pages 每月 100GB 流量）。
2. **版权合规**：同人、非商用、不使用原曲音频与官方素材；页面与 README 保留非官方声明。
3. **随时可升级**：域名、镜像、统计都是后期加配置的事，不阻塞开发。

### 10.2 部署架构

```
玩家 ──→ GitHub Pages（https://ideer0126.github.io/MIXXTOPIA/）
             ├── /           稳定版：首个 vX.Y.Z tag 后启用；测试期为占位页
             ├── /beta/      测试版：测试期用最新 beta/rc tag 或 main；稳定后只看高于 stable 的 tag
             └── /preview/   预览版：首个稳定版发布后开放，来源 main
             │  三份产物一次构建、一次原子部署；占位页带 noindex
             └── 可选：自定义域名 / Cloudflare 镜像（大陆加速）
```

- **生命周期**：无稳定 tag = 测试期，只开放 `/beta/`；首个 `vX.Y.Z` 之后 stable 与 preview 才出现。
- **通道来源**：tag 驱动，不新增长期分支；`main` 始终是开发主线，稳定入口只在打正式 tag 时更新。
- **一次部署**：`pages.yml` 同时构建三份产物，避免三个 workflow 各自部署同一 Pages 站点互相覆盖。
- **存档隔离**：三个通道同源，`localStorage` 共享；`js/main.js` 按构建注入的通道名派生
  `mixxtopia.save.<channel>.v1` / `mixxtopia.settings.<channel>.v1`，stable 保持旧键不变。
- **索引**：beta/preview 带 `noindex`；稳定版游戏页面可索引，stable/preview 占位页带 `noindex`。

### 10.3 自定义域名（可选，约 ¥50–80/年）

1. 在任意注册商购买域名（如 `mixxtopia.com`）。
2. 注册商处添加 DNS 记录：`www` → CNAME → `ideer0126.github.io`。
3. 仓库 Settings → Pages → Custom domain 填入域名。
4. 仓库根目录新增 `CNAME` 文件，内容为域名（防止每次部署被覆盖）。
5. 等待 DNS 生效（几分钟至 48 小时），GitHub 自动签发 HTTPS 证书。
6. 裸域（不带 www）需注册商支持 ALIAS/ANAME 记录，否则只发布 `www` 子域。

### 10.4 大陆访问加速（按需）

| 方案 | 成本 | 说明 |
|---|---|---|
| 默认 github.io | 免费 | 大陆访问可能慢/不稳定 |
| Cloudflare Pages 镜像 | 免费 | 域名 NS 托管到 Cloudflare，绑定域名后效果最佳 |
| Gitee Pages 镜像 | 免费 | 需实名认证、审核较严 |
| 自有域名 + Cloudflare CDN 回源 | 域名费 | 兼顾品牌与速度 |

决策时间点：**M5 发布后实测大陆可达性再选**，开发期不处理。

### 10.5 数据与统计（可选）

- 访问统计：Cloudflare Web Analytics（免费、无 Cookie）。
- 存档在玩家浏览器 localStorage，无服务器数据；stable 用原键，beta/preview 用独立通道键；
  未来若做排行榜：Supabase/Firebase 免费额度起步。

### 10.6 发布检查清单（M5 执行，对应 Issue #17）

- [ ] README 免责声明与玩法截图齐备
- [ ] 游戏内 footer 非官方声明（index.html 已具备）
- [ ] 桌面 + 移动端冒烟测试通过
- [ ] 三通道 URL 与存档隔离验证（stable / beta / preview）
- [ ] 大陆可达性抽测，决定是否加镜像
- [ ] 决定是否购买/绑定自定义域名
- [ ] 打 GitHub Release tag，随链接一起分享
