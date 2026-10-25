# MIXXTOPIA · 账户系统立项稿（选型已定：Supabase + 手写 REST）

> 状态：需求已立项；**技术选型已定（2026-10-24）：A2 —— Supabase + 手写 REST 封装，不引 SDK**。
> 对应 PLAN.md §2.5、Issue #22；云存档要点已并入 `docs/GAME_DESIGN.md` §10，实现子任务见 #42–#47。
> §7 的三个遗留假设为默认值，实现中可推翻（推翻时同步本节与 §10）。

## 1. 背景

用户新增需求：为 MIXXTOPIA 加入**账户系统**。目前游戏进度仅存于浏览器 localStorage（`mixxtopia.save.v1`，见 #8），换设备或清缓存即丢失。现需要账户设置，并引入数据库存放用户数据，支持跨设备同步。技术路线倾向 **Supabase/Firebase BaaS**（免费额度起步），保持 GitHub Pages 静态部署，与 PLAN.md 中「未来排行榜」的设想一致。

## 2. 需求要点

- **账户**：注册 / 登录（邮箱 + 密码，后续可扩展 OAuth）；未登录可继续以游客身份游玩，登录后提示合并本地与云端存档
- **账户设置**：昵称、头像（**固定选项集**，不支持上传自定义图片；集合由前端白名单维护，可随美术扩展）、音效 / 操作等偏好设置
- **云存档 / 跨设备同步**：进度（当前关、已收集、已解锁关卡）上传与下载；冲突处理（版本号 / 更新时间，以新覆盖或手动选择）
- **用户资料 / 统计**：游戏时长、成就、收集率
- **隐私与合规**：最小化收集，仅存游戏所需数据；隐私说明文案随登录流程提供

## 3. 现状与约束（评审依据）

| 约束 | 现状 | 对选型的影响 |
|---|---|---|
| 零依赖、无构建 | 无 `package.json`，`index.html` 用 5 个 `<script>` 直接加载 `js/*.js`，全局命名空间 `MIXX.*` | SDK 要么 CDN 直引，要么干脆不引（见 §4 变体 A2） |
| 部署形态 | GitHub Pages 静态托管（`.github/workflows/pages.yml`），无服务端进程 | 只能前端直连 BaaS，安全边界必须由 RLS / 安全规则承担 |
| 测试形态 | `node tools/test-*.js` 手写用例、`vm` 沙箱注入假 DOM/存储；`tools/smoke-main.html` 无头浏览器冒烟 | 云同步必须能被 `fetch` 桩替换，不能绑死 SDK 内部行为 |
| 已有存档层 | `mixxtopia.save.v1`（3 档）+ `mixxtopia.settings.v1`，结构见 GAME_DESIGN.md §10 | 云端只做「同步层」，本地层保留、离线可玩 |
| 无密钥管理 | 无构建、无 CI 注入 | BaaS 的 anon key 必须可公开（安全靠规则），不能放服务端密钥 |

## 4. 候选方案

### A. Supabase（Postgres + GoTrue Auth + PostgREST）

- 数据：Postgres 表 + `jsonb` 列存存档位；schema 以 SQL 迁移文件入库（`supabase/migrations/`），可 review、可回放
- 安全：RLS 策略写在 SQL 里，一行一条，能直接进仓库做 code review
- 认证：GoTrue（邮箱密码 / magic link / OAuth），返回 JWT + refresh token
- 费用：免费计划含数据库/存储/带宽与 MAU 额度（量级：500 MB 库、5 GB 出站、5 万 MAU），**免费项目闲置约 1 周会被自动 pause**
- 后期排行榜：直接 SQL 聚合，最省事

### A2. Supabase 变体：不引 SDK，直接 `fetch` 调 REST

- 登录：`POST /auth/v1/token?grant_type=password`；刷新：`grant_type=refresh_token`
- 读写：`GET/PATCH /rest/v1/saves?user_id=eq.<uid>`，头带 `apikey` 与 `Authorization: Bearer <access_token>`
- 体量：约 150–250 行手写封装即可覆盖 登录 / 刷新 / 读写 / 错误码，**不引入 50–90 KB 级 SDK**
- 代价：token 刷新、错误码映射、重试要自己写；但换来符合仓库「零依赖」约定，且测试里塞个 `fetch` 桩就能全量覆盖

### B. Firebase（Auth + Firestore）

- 数据：`users/{uid}/saves/{slot}` 文档（每档一文档，天然贴存档位模型）
- 安全：Firestore 安全规则（声明式、可入仓库），比 SQL RLS 表达力弱一些
- 认证：Firebase Auth（邮箱密码 / OAuth），SDK 负责 token 刷新
- 费用：Spark（免费）计划含 Firestore 每日读/写额度（量级：5 万读 / 2 万写每天、1 GiB 存储），**不 pause**；但 **Cloud Functions 需要 Blaze（付费）计划**
- 体量：无「REST 手写就够」的等价路径，需 CDN 引入 `firebase/auth` + `firebase/firestore`（ESM，动态 `import()` 才不拖首屏）

## 5. 对比

| 维度 | A. Supabase（含 A2） | B. Firebase |
|---|---|---|
| 存档数据模型贴合度 | 高（`jsonb` 存整个存档位） | 高（一档一文档） |
| 安全边界可读性 | **高**：SQL RLS，能 review、能本地跑 | 中：安全规则，嵌套集合写法更绕 |
| 零依赖/无构建契合度 | **高**（A2 完全不需要 SDK） | 低（必须引 SDK） |
| 前端体积 | A2 ≈ 0，A ≈ 50–90 KB | ≈ 100 KB+（auth+firestore） |
| 本地/CI 可测性 | **高**：`fetch` 桩即可；CLI 起来才需要 Docker | 中：有 emulator suite，但要在无构建项目里额外维护一套 |
| 免费额度长期可用性 | 中：**闲置会 pause**（粉丝向低活跃项目要留意） | **高**：不 pause，每日配额对我们足够 |
| 后期排行榜/统计 | **高**：SQL 聚合、视图 | 中：需聚合查询或 Blaze Functions |
| 数据可迁移/可导出 | **高**：`pg_dump` | 中：JSON 导出 |
| 运维心智负担 | 中（要懂一点 SQL/RLS） | 低（全托管，规则写错更隐蔽） |
| 大陆网络可达性 | 都不稳（`*.supabase.co`） | 都不稳（`*.googleapis.com`） |

> 额度与 pause 策略属官方定价页口径，本次评审环境无法联网核对，**落地前需按官网复核并写进本稿**。

## 6. 选定方案（2026-10-24：A2）

**已定：A2 —— Supabase + 手写 `fetch` 封装**（不引 `@supabase/supabase-js`）。理由按权重排：

1. RLS 把「仅本人可读写」写成可 review 的 SQL，能进仓库、进 PR、进测试
2. 存档是"整块 JSON"，`jsonb` 一行一档，比拆字段省事；冲突检测用 `version` 列做乐观锁很直接
3. 不引 SDK 就能保持零依赖 + 无构建，测试用 `fetch` 桩全量覆盖，和现有 `tools/test-*.js` 风格一致
4. 后期排行榜就是一条 SQL，不用为了它再上 Blaze

**放弃 B（Firebase）**：必须引 SDK（~100 KB+），与零依赖约定冲突；排行榜后期要 Blaze。其「免费项目不 pause」的优点，改用「登录时按需唤醒 + 失败可降级」来化解。

**不做「导出/导入码」折中**：解决不了账户设置与统计，后续仍要迁到真账户，属于重复投入。

## 7. 遗留假设（默认值，实现中可推翻）

1. **选型**：已定 A2（§6）。
2. **免费项目 pause 接受**。Supabase 免费项目闲置约 1 周会 pause，表现为登录/同步的首个请求失败。处理：界面提示「云端暂不可用，已用本地存档继续」，不阻塞游玩，下次进游戏重试。若体验不可接受，再评估保活方案或升级。
3. **大陆网络可达性不作为硬要求**。与 Pages 现状一致（Pages 本身在大陆访问也不稳），文档与隐私说明**不承诺**「无需代理」。
4. **暂不开邮箱验证**。注册即生效，避开免费额度的发信限制；若出现刷号再开。

## 8. 数据模型（已落地：#42）

**可执行脚本是唯一事实源**：`supabase/migrations/0001_init.sql`（幂等，可在 Supabase SQL Editor 重复执行）。下面只摘录结构要点，与脚本冲突时**以脚本为准**。

关键设计：

- `profiles` 由 `handle_new_user()` 触发器在注册时自动建档，客户端**没有 insert 权限**——否则会出现「注册成功但资料写不进去」的隐性失败（0 行受影响，不报错）；
- 三表全开 RLS，策略只授 `authenticated` 且限定 `auth.uid()` 本人；`anon` 的表权限已 `revoke`，等于 RLS 之外再加一道锁；
- `updated_at` 由 `touch_updated_at()` 触发器维护，客户端不用传；
- `saves.version` 乐观锁：`PATCH ...?version=eq.<旧值>` 且 body 带 `version: 旧值 + 1`，影响 0 行即冲突；
- **头像不锁集合**：`profiles.avatar` 只校验格式 `^[a-z0-9][a-z0-9-]{0,31}$`，白名单放前端（`js/data.js` 的 `AVATAR_PRESETS`，见 #44）。否则以后每加一个头像（六位缪斯 × 各关妆造、玩家形象、黑羊彩蛋…）都得写迁移；未知 id 在渲染时回退默认头像。

### A / A2：Postgres

```sql
-- 账户资料（auth.users 由 GoTrue 维护，这里只放游戏侧字段）
create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  nickname   text check (char_length(nickname) between 1 and 16),
  avatar     text not null default 'muse-1',   -- 集合由前端白名单维护，DB 只校验格式
  prefs      jsonb not null default '{"sound":true}'::jsonb,   -- 音效/操作偏好
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 云存档：一账号 3 档，一档一行；data 沿用 GAME_DESIGN.md §10 的存档位结构
create table public.saves (
  user_id    uuid not null references auth.users on delete cascade,
  slot       smallint not null check (slot between 1 and 3),
  version    integer not null default 1,      -- 每次写盘 +1（乐观锁）
  updated_at timestamptz not null default now(),
  data       jsonb not null,
  primary key (user_id, slot)
);

-- 统计（#46，可后置）
create table public.stats (
  user_id      uuid primary key references auth.users on delete cascade,
  play_seconds bigint not null default 0,
  achievements jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.saves    enable row level security;
alter table public.stats    enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy saves_own on public.saves
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy stats_own on public.stats
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- RLS 之外的第二道锁：anon 连表权限都没有
revoke all on public.profiles from anon, public;
revoke all on public.saves    from anon, public;
revoke all on public.stats    from anon, public;
```

存档行 `data` 与本地档同构（去掉 `slot`，把 `updatedAt` 交给服务端列），便于双向直传、不做字段映射。

### B：Firestore

```
users/{uid}                     { nickname, avatar, prefs, createdAt }
users/{uid}/saves/{slot}        { version, updatedAt, data }   // data 同 §10 存档位结构
users/{uid}/stats/current       { playSeconds, achievements, updatedAt }
```

```
match /users/{uid} {
  allow read, update: if request.auth != null && request.auth.uid == uid;
  allow create: if request.auth != null && request.auth.uid == uid;
  match /{document=**} {
    allow read, write: if request.auth != null && request.auth.uid == uid;
  }
}
```

## 9. 云同步与冲突策略

- **写时机**：沿用 #8 手动存档制——仅「保存并退出」与通关自动存档触发；本地先写，再标 `dirty`，随后尝试云端 upsert。云端失败不阻塞回标题。
- **版本号**：`version` 单调递增，上传时带 `expectedVersion`；服务端不匹配则返回冲突（Postgres 可用 `update ... where version = $expected` 判断 0 行）。
- **登录时**：拉云端 3 档的 `{ version, updatedAt }` 元数据，与本地逐档比较 →
  - 仅云端有：提示「载入云端存档」
  - 仅本地有：提示「上传本机进度」
  - 两边都有且 `version`/`updatedAt` 不同：在 #8 的选择存档界面加「☁ 云端较新」标记，做**逐档手动选择**（默认不自动覆盖）
- **游客 → 账户**：登录成功后弹一次「把本机进度并入账户？」，默认「并入」（同档位取较新），也可「仅保留云端」。
- **降级**：离线 / 未登录 / 请求失败 → 一切照本地跑，`dirty` 标记留待下次登录或下次保存重试；界面只在账户区显示「未同步」小字。
- **不做的**：不做实时多端推送、不做后台轮询、不做自动覆盖式合并（避免吞档）。

## 10. 安全与隐私

- **anon key 是公开的**（新控制台叫 **publishable key**，`sb_publishable_...`；旧的 JWT 版 anon key 在 Legacy 页签，两者等价），安全边界只在 RLS；测试必须包含「A 用户 token 读 B 用户存档 → 失败」用例
- 只存游戏所需：昵称、固定头像 id、偏好、存档、统计；邮箱由 Auth 托管，不复制进业务表
- **删除账户**：提供入口，`auth.users` 级联删除 `profiles/saves/stats`；文案明示不可恢复
- **隐私说明**：已建 `docs/PRIVACY.md`，登录界面一屏摘要 + 链接；不接入任何第三方分析
- 玩家未登录时**零数据上传**，保持现状

## 11. 子 issue 拆分（已建：#42–#47，挂在 #22 下）

| 编号 | 子任务 | 范围 | 涉及文件 | 验收 |
|---|---|---|---|---|
| #42 | 选型落地与后端初始化 | 建项目、跑迁移、RLS、公开配置注入 | 已建 `js/cloud-config.js`、`supabase/migrations/0001_init.sql`、`docs/PRIVACY.md`；迁移已在项目 `hlnubesywvcxdghfyoux` 执行成功（2026-10-24）；文档已并入 §8/§10 | ✅ 真实项目端到端验证通过：匿名访问 42501、跨用户读写隔离、注册自动建档、非法头像被 CHECK 拒绝、`version` 乐观锁、`updated_at` 触发器、迁移幂等 |
| #43 | Auth | 注册/登录/登出/会话恢复/游客态、标题入口 | 新增 `js/auth.js`；改 `js/main.js`、`index.html`、`styles.css` | `fetch` 桩单测 + 冒烟：注册→登录→刷新仍登录 |
| #44 | 账户设置 UI | 昵称、固定头像集（前端白名单）、音效/操作偏好 | 同上 + `js/settings.js` | 保存后重登一致；非法格式被拒；未知 id 回退默认头像 |
| #45 | 云存档同步 | 上传/下载/冲突三选一/离线降级 | 新增 `js/cloud.js`；改 `js/main.js` 存档段 | 三档同步、冲突不自动覆盖、离线可玩 |
| #46 | 统计 | 时长、成就、收集率 | 新增 `js/stats.js` | 云端累计与本地一致 |
| #47 | 上线验证 | #17 扩展：线上注册/登录/同步冒烟 | `tools/smoke-main.html`（人工跑，不改 CI 配置） | 正式域名走通一遍 |

依赖顺序：#42 → #43 → #44 / #45 → #46 → #47。**#43 起才动 `js/main.js`**，#42 只加新文件与文档，冲突面最小。

## 12. 验收与门禁

单测/冒烟都走仓库既有方式，不新增 npm 依赖：

```
node --check js/*.js
node tools/test-engine.js
node tools/test-main.js
# 无头浏览器跑 tools/smoke-main.html，断言 data-smoke="ok"
node tools/validate.js   # 已知红：levels 为空导致 91 条基线错误，不计回归
```

云端相关测试一律用 `fetch` 桩（与现有 `storage` 桩同风格），**CI 不连真实后端**。

## 13. 影响下游

- #8 存档系统（保留 localStorage 本地层，新增云端同步层）
- #6 游戏状态机与 UI 接线（标题界面登录入口、账户设置界面）
- #17 Pages 上线验证（注册 / 登录 / 云存档冒烟）
- `PLAN.md` 与 `docs/GAME_DESIGN.md` §10 存档规范更新

## 14. 完成标志

- ✅ 技术方案评审通过（**A2：Supabase + 手写 `fetch`**，2026-10-24）并写入 `GAME_DESIGN.md` §10；
- 账户注册登录、账户设置界面、云存档同步可用并通过上线验证；
- 按需拆分实现子 issue（Auth、设置 UI、云存档同步、统计）。

## 15. 评审记录

| 日期 | 结论 | 备注 |
|---|---|---|
| 2026-10-24 | 选定 **A2：Supabase + 手写 `fetch` 封装**（不引 SDK） | 放弃 B（Firebase 需引 SDK）；不做「导出/导入码」折中；三条遗留假设见 §7。已建子 issue #42–#47 并挂到 #22 下 |
