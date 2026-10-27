# MIXXTOPIA · 账户系统立项稿（选型已定：Supabase + 手写 REST）

> 状态：需求已立项；**技术选型已定（2026-10-24）：A2 —— Supabase + 手写 REST 封装，不引 SDK**。
> 对应 PLAN.md §2.5、Issue #22；云存档要点已并入 `docs/GAME_DESIGN.md` §10，实现子任务见 #42–#47。
> §7 的三个遗留假设为默认值，实现中可推翻（推翻时同步本节与 §10）。

## 1. 背景

用户新增需求：为 MIXXTOPIA 加入**账户系统**。目前游戏进度仅存于浏览器 localStorage（`mixxtopia.save.v1`，见 #8），换设备或清缓存即丢失。现需要账户设置，并引入数据库存放用户数据，支持跨设备同步。技术路线倾向 **Supabase/Firebase BaaS**（免费额度起步），保持 GitHub Pages 静态部署，与 PLAN.md 中「未来排行榜」的设想一致。

## 2. 需求要点

- **账户**：注册 / 登录（邮箱 + 密码，后续可扩展 OAuth）；未登录可继续以游客身份游玩，登录后提示合并本地与云端存档
- **账户设置**：昵称、头像（**固定选项集**，不支持上传自定义图片；集合由前端白名单维护，可随美术扩展）、音效 / 操作等偏好设置
- **云存档 / 跨设备同步**：进度（当前关、已收集、已解锁关卡）上传与下载；冲突处理（版本号 / 更新时间，逐档手动选择，默认不自动覆盖）
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

**可执行脚本是唯一事实源**：`supabase/migrations/0001_init.sql` + `0002_stats.sql`（幂等，可在 Supabase SQL Editor 重复执行）。下面只摘录结构要点，与脚本冲突时**以脚本为准**。

关键设计：

- `profiles` 由 `handle_new_user()` 触发器在注册时自动建档，客户端**没有 insert 权限**——否则会出现「注册成功但资料写不进去」的隐性失败（0 行受影响，不报错）；
- 三表全开 RLS，策略只授 `authenticated` 且限定 `auth.uid()` 本人；`anon` 的表权限已 `revoke`，等于 RLS 之外再加一道锁；
- `updated_at` 由 `touch_updated_at()` 触发器维护，客户端不用传；
- `saves.version` 乐观锁：`PATCH ...?version=eq.<期望值>` 且 body 带 `version: 期望值 + 1`，请求带 `Prefer: return=representation`；返回数组长度 1 = 成功、0 = 冲突（HTTP 仍可能是 200），不能只看状态码。期望值来自 `mixxtopia.cloud.v1` 的逐档基线（见 §9），本地存档位不保存 `version`；
- **头像不锁集合**：`profiles.avatar` 只校验格式 `^[a-z0-9][a-z0-9-]{0,31}$`，白名单放前端（`js/data.js` 的 `GAME.avatarPresets`，见 #44；6 条 `muse-1…muse-6`）。否则以后每加一个头像（六位缪斯 × 各关妆造、玩家形象、黑羊彩蛋…）都得写迁移；未知 id 在渲染时回退默认头像 `muse-1`。
- **昵称 / 偏好校验（#44）**：客户端 `js/account.js` 先校验（昵称 trim 后 1–16 个 Unicode 码点、无控制字符；偏好只保留 `sound` / `touch`），不合法不发起请求；`PATCH /rest/v1/profiles?id=eq.<uid>` 带 `Prefer: return=representation`，返回数组长度 1 = 成功、0 = 资料行缺失；400 按 `profiles_nickname_check` / `profiles_avatar_check` 映射中文提示。
- **防默认值覆盖（#44）**：profile 未成功加载前设置页禁用保存（失败时显示重试），避免 `NSWER` / `muse-1` 等表单默认值覆盖云端；读取时保留 `avatarRaw`，未知/未来版本头像在只改昵称/偏好时通过 PATCH 省略 `avatar` 字段保留原值（PostgREST 部分更新），玩家主动选择新头像才回写。
- **保存账号绑定（#55 评审修复）**：发起保存时记录账号 id，等待 `ensureFresh()` 完成及 401 续期重试前校验返回会话与当前会话仍属于该账号；账号改变则拒绝请求，防止旧表单写入新账号。相同账号续期可使用新令牌重试。
- **设置版本兼容（#55 评审修复）**：`mixxtopia.settings.v1` 缺少 `v` 的历史记录继续有效；显式 `v` 与当前版本不一致时按默认值处理，不标记为本机已有有效设置，允许后续采用云端偏好。
- **偏好与本地设置（#44）**：`mixxtopia.settings.v1`（`{ v, sound, touch }`，`touch` ∈ `auto|on|off`）是运行时唯一来源；未登录 / 离线只写本机；登录后点击「保存设置」把 `sound` / `touch` 同步到 `profiles.prefs`（标题声音开关、设置页即时切换只写本机）。采用规则：本机**无**设置记录（新设备 / 清缓存）时采用一次云端偏好；本机已有记录则本地优先、不自动覆盖，设置页提示差异，保存时以本机为准上传云端。
  - **设备级取舍（#44 明确）**：声音/触屏偏好视为**设备级**设置——同一设备换账号不自动切换偏好，新设备首次登录采用一次云端值后，后续云端变化也不再自动覆盖；这是为避免登录/切号导致设备体验突变，若未来要按账号同步需记录 `prefsOwner/source/dirty` 并单独评审。

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

-- 统计（0001 基础结构；0002 追加计数与收集集合）
create table public.stats (
  user_id      uuid primary key references auth.users on delete cascade,
  play_seconds bigint not null default 0,
  achievements jsonb not null default '[]'::jsonb,
  device_millis jsonb not null default '{}'::jsonb, -- #46 每页面计数最大值
  remainder_ms integer not null default 0,       -- #46 总时长不足一秒部分
  collections jsonb not null default '{}'::jsonb, -- #46 云存档星 ID 按关并集
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

存档行 `data` 与本地档同构（去掉 `slot` 与 `updatedAt`）：`updatedAt` 由 `saves.updated_at` 列承担。上传时不要把 `updatedAt` 写进 `data`；下载时必须在调用 `SaveStore.writeSlot()` 前把 `saves.updated_at`（ISO 字符串）转成本地毫秒时间戳写入 `updatedAt`——`normalizeSlot()` 不会从 `updated_at` 补齐该字段，缺失会按 `0` 处理。本地存档位没有 `version` 字段；逐档同步基线单独存 `mixxtopia.cloud.v1`（结构见 §9）。除时间字段外，双向直传、不做字段映射。

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
- **账户会话（#43）**：注册 / 登录 / 登出 / refresh_token 续期由 `js/auth.js` 手写 GoTrue 封装承担；会话单独存 `mixxtopia.account.v1`（beta/preview 追加 `.<channel>`，与存档键隔离一致），只含 `accessToken` / `refreshToken` / `expiresAt` / `user{id,email}`，不含密码与存档内容。启动时恢复登录态，access_token 到期前 60s 自动 refresh；refresh token 失效才清会话。登出只清该键，不碰 `mixxtopia.save.v1` 与设置；游客态零网络请求。网络失败 / 5xx 统一提示「云端暂不可用」，不阻塞本地游玩。
- **本地同步基线**：逐档记录单独存 `mixxtopia.cloud.v1`，不写进 `mixxtopia.save.v1` 的存档位（`normalizeSlot()` 只保留已知字段，额外字段会被丢弃）。结构为 `{ v: 1, userId, binding, decision: "" | "merge" | "cloud", slots: [ { version, localUpdatedAt, cloudUpdatedAt } | null, ... ], pending: [boolean, boolean, boolean], snapshots: [slot | null, slot | null, slot | null] }`，索引 0–2 对应 1–3 档；`version` / `cloudUpdatedAt` 取成功同步时云端行的 `version` / `updated_at`（转 ms），`localUpdatedAt` 取当时本地档的 `updatedAt`。只在成功上传 / 下载后更新；本地删档时清空该档；存储缺失、损坏或版本不符时视为「从未同步」，不自动覆盖。基线持久化在 localStorage，刷新 / 重开页面后仍可用，不依赖内存中的 `dirty` 标记。`userId` 必须匹配当前账号；旧记录无归属或切号时按从未同步处理，并立即写入新归属（A→B→A 也不复用 A 的旧授权）。`decision` 记录本机是否明确选择并入，`pending` 仅在已有同步基线或明确同意上传/并入后置位；同账号重新登录或点击重试时，仅在云端仍与基线一致（首次上传则云端仍为空）时补传，遇冲突停下。
- **跨标签页归属（#45 评审修复）**：`userId` 必须匹配当前账号，`binding` 标识共享存储中的本次归属；每次补传、写同步记录及接受异步回包前都检查共享记录中的账号与 binding，另一标签页切号（含 A→B→A）后旧页面停止同步，要求重新登录确认。旧版记录缺少 binding 时按未同步处理，重新确认，不沿用旧授权。
- **补传授权快照（#45 评审修复）**：`snapshots` 是玩家已授权上传或当前游戏刚写入的本地快照；重试只接受与其完全相同的存档，未知页面/旧版本改写本地档后清除补传授权，要求重新逐档选择；本地写盘时由 Game 将自身快照传给同步器，避免把共享槽位的新内容误认为自己的存档。
- **发布通道（Issue #17）**：beta/preview 的本地基线键追加 `.<channel>`（如 `mixxtopia.cloud.beta.v1`），并使用独立 Supabase 项目/schema；禁止测试环境写入正式库。测试期只有 beta 通道可用；首个稳定版发布后 beta 停用、preview 开放。
- **版本号（仅服务端）**：`version` 只存在于云端，用于上传乐观锁与云端变更检测；本地存档位不保存该字段。PATCH 以基线 `version` 为期望值（无基线时先 GET 当前值），带 `version=eq.<期望值>` 与 `Prefer: return=representation`；返回数组长度 1 = 成功、0 = 冲突，不能只看 HTTP 状态码。冲突后重新拉取云端元数据，让玩家逐档选择；玩家明确选「上传本机」后，用最新云端 `version` 重新 PATCH（云端行不存在则 POST），属于显式覆盖，不自动重试。
- **登录时**：拉云端 3 档的 `{ version, updated_at }`（转 ms），与基线逐档比较 →
  - 本机 `updatedAt` ≠ 基线 `localUpdatedAt`：本机改过；云端 `version` / `updated_at` ≠ 基线：云端改过
  - 两边都未改过：视为已同步，不提示
  - 仅本机改过：提示「上传本机进度」；仅云端改过：提示「载入云端存档」
  - 两边都改过，或没有基线且两边都有档：进入 #8 选择存档界面的逐档手动选择（标出本机 / 云端及各自时间，默认不自动覆盖、不以时间戳自动判定胜负）
  - 仅一边有档：提示载入 / 上传；两边都无档：无操作
- **游客 → 账户**：登录成功后弹一次「把本机进度并入账户？」，可选「并入本机进度」或「仅使用云端（逐档选择）」；选「并入」后，**同档位双方都有进度时不自动取较新**，而是进入 #8 选择存档界面的逐档选择（标注「本机」/「云端」及各自时间），玩家确认后才写入；仅一边有进度的档位可直接并入。选择仅使用云端时不批量删除本地档，仍需逐档确认载入覆盖本机；该选择不会授权自动上传无基线的本地档。合并成功的那一档按上传流程写回 `mixxtopia.cloud.v1` 基线。
- **降级**：离线 / 未登录 / 请求失败 → 一切照本地跑，`dirty` 标记留待下次登录或下次保存重试；界面只在账户区显示「未同步」小字。
- **评审修复（2026-10-26）**：HTTP 错误响应即使是 HTML 也按状态码处理（401 可续期，403/5xx 有对应提示）；仅成功响应的非法 JSON 才归为格式错误，响应体读取仍受超时约束。云档列表未成功读取前，UI 和同步器均拒绝并入/跳过选择，重试入口与本地游玩继续可用。
- **界面 / 异步保护（#45）**：标题与登录面板提供状态/管理入口；选择存档界面同时显示本机与云端时间，逐档「上传本机」/「载入云端」须再点确认，确认绑定当时本机快照与云端版本。请求进行中禁用档位操作，元数据加载不阻塞游客本地游玩；切号/登出/destroy 后旧回包不落盘，下载等待期间本机变化或云端版本变化也拒绝覆盖。
- **本地删除（#45）**：删除按钮只清本地档与该档同步基线/pending；云端备份保留，可明确选择下载恢复，不发送远端 DELETE。本机时间单调递增，避免同毫秒连续保存漏检。
- **不做的**：不做实时多端推送、不做后台轮询、不做自动覆盖式合并（避免吞档）。

## 10. 安全与隐私

- **anon key 是公开的**（新控制台叫 **publishable key**，`sb_publishable_...`；旧的 JWT 版 anon key 在 Legacy 页签，两者等价），安全边界只在 RLS；测试必须包含「A 用户 token 读 B 用户存档 → 失败」用例
- 只存游戏所需：昵称、固定头像 id、偏好、存档、统计；邮箱由 Auth 托管，不复制进业务表
- **删除账户**：前端只有 publishable key，**不能**直接删除 `auth.users`（需仅在服务端使用的特权密钥；删 `profiles` 等业务行也不等于删账号）。当前定为**人工处理流程**（#44 已实现入口）：账户设置页「删除账户（提交申请）」跳转预填标题/说明的 GitHub issue 模板，维护者核实后通过 Supabase 后台删除 `auth.users`，`profiles/saves/stats` 由外键级联删除，不可恢复。若后续要提供自助删除，须先增加受信任的服务端端点（持 `service_role` 的 Edge Function，或仅授 `authenticated` 的 `security definer` RPC），单独评审并补测试；在该端点落地前，文案不承诺即时自助删除
- **隐私说明**：已建 `docs/PRIVACY.md`，登录界面一屏摘要 + 链接；不接入任何第三方分析
- 玩家未登录时**零数据上传**，保持现状

## 11. 子 issue 拆分（已建：#42–#47，挂在 #22 下）

| 编号 | 子任务 | 范围 | 涉及文件 | 验收 |
|---|---|---|---|---|
| #42 | 选型落地与后端初始化 | 建项目、跑迁移、RLS、公开配置注入 | 已建 `js/cloud-config.js`、`supabase/migrations/0001_init.sql`、`docs/PRIVACY.md`；迁移已在项目 `hlnubesywvcxdghfyoux` 执行成功（2026-10-24）；文档已并入 §8/§10 | ✅ 真实项目端到端验证通过：匿名访问 42501、跨用户读写隔离、注册自动建档、非法头像被 CHECK 拒绝、`version` 乐观锁、`updated_at` 触发器、迁移幂等 |
| #43 | Auth | 注册/登录/登出/会话恢复/游客态、标题入口 | ✅ 已新增 `js/auth.js`（手写 GoTrue 封装）；改 `js/main.js`、`index.html`、`styles.css`、`tools/smoke-main.html`；新增 `tools/test-auth.js` | ✅ `fetch` 桩单测 19 项（注册 / 密码错 / 邮箱已注册 / token 过期自动续期 / 网络失败 / 登出不动存档）+ test-main 账户 UI 9 项 + 冒烟：打开/返回登录界面、游客零请求、刷新仍登录 |
| #44 | 账户设置 UI | 昵称、固定头像集（前端白名单）、音效/操作偏好、删除账户申请（提交后人工处理） | ✅ 新增 `js/account.js`（profiles 读写/校验/中文错误映射）；`js/data.js` 增 `GAME.avatarPresets`；`js/engine.js` 增触屏按键偏好 `Input.setTouchMode`；改 `js/main.js`、`index.html`、`styles.css`、`tools/smoke-main.html`、`tools/test-main.js`、`tools/test-engine.js`；新增 `tools/test-account.js` | ✅ `fetch` 桩单测 21 项 + test-main 98 项 + test-engine 48 项 + `smoke-main.html` 84 项 + `smoke-input.html` 22 项检查通过（合入 #18 战斗系统后的当前计数）：昵称保存→重载往返一致、超长被拒且有中文提示、头像只认白名单（未知 id 回退 muse-1 且保存时不覆盖云端原值）、资料未就绪/失败时禁止保存并提供重试、切号/登出清空旧资料、偏好立即生效且以 `mixxtopia.settings.v1` 为唯一运行时来源、删除申请只跳 GitHub issue（不调 `auth.users`） |
| #45 | 云存档同步 | 上传/下载/冲突三选一/离线降级、`mixxtopia.cloud.v1` 逐档同步基线 | ✅ 新增 `js/cloud.js`、`tools/test-cloud.js`；修改 `js/main.js`、`index.html`、`styles.css`、主流程测试与冒烟页 | 已实现（PR #56）；test-cloud 38 项 + test-main 106 项；桌面/触屏冒烟 96 项通过；两个隔离浏览器上下文上传/下载/继续通过（全为 fetch 桩）；真实后端验证留 #47 |
| #46 | 统计 | 时长、成就、收集率 | `js/stats.js`、`0002_stats.sql`；主流程/账户页接线；统计单测与浏览器脚本 | ✅ 本地实现；上线前须应用 0002 迁移，真实 Supabase 验收留 #47；口径见下文 |
| #47 | 上线验证 | #17 扩展：线上注册/登录/同步冒烟 | `tools/smoke-main.html`（人工跑，不改 CI 配置） | 正式域名走通一遍 |

依赖顺序：#42 → #43 → #44 / #45 → #46 → #47。**#43 起才动 `js/main.js`**，#42 只加新文件与文档，冲突面最小。

## 12. 验收与门禁

单测/冒烟都走仓库既有方式，不新增 npm 依赖：

```
for file in js/*.js; do
  node --check "$file" || exit 1
done
node tools/test-engine.js
node tools/test-main.js
node tools/test-auth.js   # 账户 Auth（#43）：全部走 fetch 桩
node tools/test-account.js # 账户资料 profiles（#44）：全部走 fetch 桩
node tools/test-cloud.js   # #45 云存档：fetch 桩 + 持久化/并发保护
node tools/test-stats.js   # #46 统计：计数、归属、补传与接口桩
node tools/test-channels.js
# 无头浏览器跑 tools/smoke-main.html / tools/smoke-input.html，断言 data-smoke="ok"
node tools/validate.js   # 已知红：levels 为空导致 91 条基线错误，不计回归
```

云端相关测试一律用 `fetch` 桩（与现有 `storage` 桩同风格），**CI 不连真实后端**。

### #45 本地验收边界

2026-10-26 的自动验证不访问真实 Supabase，也不创建真实账号或云存档。测试期 `/beta/` 与正式 `/`、预览 `/preview/` 的后端仍须按 §9 配置独立项目/schema；现有公开默认配置只有一个项目，**本地键隔离不等于云端隔离**。在 #17/#47 上线验收中核对通道后端隔离与真实 RLS（包括 A 不能读取 B），再进行正式跨设备验收。此次不修改数据库或 `.github/` 治理配置。

### #46 统计口径与同步（本地实现，2026-10-27）

- `js/stats.js` 与 `runTime` 在同一处接收 `dt`：仅 PLAYING 累计，标题、对话、暂停、结算与隐藏页面不计入。总时长独立于单关计时，不因重玩、倒下或「回到标题（不保存）」回退。
- 每个页面实例有随机计数标识（不取设备信息），记录本次累计秒数；本机按账号、通道、计数标识分别存 journal（`mixxtopia.stats[.<channel>].v1.journal.<uid>.<writer>`）。每过整秒落盘；离开 PLAYING、页面隐藏/关闭和销毁时补存小数。正常关闭保留小数；浏览器进程被强杀时最多损失最近未落盘的一秒。存储被禁用或写满时显示错误，并保留当前页面内存数据。
- 游客统计留本机，登录后单独累计该账号，**不自动并入游客时长或成就**；登出/换号不清除原账号待补传记录。收集率随已授权云存档同步，无须另行上传游客统计。跨标签页切号撤销旧页面的统计请求与计时；请求前后再次核对当前用户，旧回包不覆盖新用户缓存。
- 上传调用 `POST /rest/v1/rpc/merge_stats`（`p_writer` / `p_millis` / `p_achievements`）。`0002_stats.sql` 在 stats 增加 `device_millis`、`remainder_ms`、`collections`：同一标识取累计毫秒最大值，只把增量加到 `play_seconds`，不足一秒部分留在 `remainder_ms`；并发设备相加、成就取并集。重复请求、响应丢失后的重传不会重复计时，也保留旧版已有总秒数。
- 同步时机：登录恢复、成功本地存档后的云同步完成、确认并入/上传/载入云存档、回标题、打开账户设置、点击「同步统计」。没有定时器或后台轮询。失败不弹阻塞提示、不影响存档；journal 保留，下次同账号登录或手动同步补传。关闭页面仅落本地，避免依赖不可靠的卸载期请求。
- 收集率 = 同关已保存星星 ID 的并集 / 该关地图星星数。同关跨三个存档去重，未知 ID 不计入，不同关同名 ID 分开计算；零星关显示 0/0（0%），序章 id=0 不列入。RPC 从本人当前三份**云存档**生成 `stats.collections`（星 ID 集合），各设备据同一地图计算百分比；本机未上传/冲突未解决时，账户页仍显示云端收集率并提示保存同步后更新。游客页按本机已保存存档展示。
- 成就：`first_star` 首颗星、`first_clear` 首次通关、`wish_keeper` 一关全星、`journey_complete` 六关全部完成（占位地图不解锁终章）。时长与成就即时记录，即使随后放弃未保存的游戏进度也保留；不做排行榜或战斗统计。
- RPC 使用 `security invoker`，归属仅取 `auth.uid()`，保留三表 RLS，不接收目标用户参数；只授 authenticated 执行，anon/public 无权调用。

**迁移与验证**：先运行 `0001_init.sql`，再运行 `0002_stats.sql`（可重复执行）。本次只创建本地迁移文件，不连接或修改真实项目；未应用 0002 时前端仍保留本机统计并显示待补传。上线前按 #17/#47 分别在隔离的测试/正式后端应用迁移，并核对真实 PostgREST、RLS 与跨设备行为。

零依赖的 Node 门禁之外，可选安装 PostgreSQL WASM 引擎与浏览器工具到仓库外运行本地 SQL / 完整页面检查，**不增加游戏运行依赖**：

```bash
npm install --prefix /tmp/mixx-db --no-save @electric-sql/pglite playwright
MIXX_PGLITE_MODULE=/tmp/mixx-db/node_modules/@electric-sql/pglite node tools/test-stats-db.js
MIXX_PGLITE_MODULE=/tmp/mixx-db/node_modules/@electric-sql/pglite \
MIXX_PLAYWRIGHT_MODULE=/tmp/mixx-db/node_modules/playwright \
MIXX_CHROME=/opt/google/chrome/chrome node tools/smoke-stats.js
```

浏览器脚本启动并关闭自己的本地静态服务器，以本地 PostgreSQL 引擎响应拦截的 REST 请求，不访问真实 Supabase。检查桌面/触屏页面、离线刷新补传、跨设备一致、切号和游客零请求；截图与结构化结果默认保存在 `/tmp/mixxtopia-stats-smoke/`（可用 `MIXX_STATS_OUTPUT` 更改）。

## 13. 影响下游

- #8 存档系统（保留 localStorage 本地层，新增云端同步层）
- #6 游戏状态机与 UI 接线（标题界面登录入口、账户设置界面，**#44 已接线**）
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
| 2026-10-25 | #44 账户设置 UI 落地 | 新增 `js/account.js`（profiles 读写/校验/中文错误映射）+ `GAME.avatarPresets` 白名单 + 触屏按键偏好；昵称/头像写云端、偏好以 `mixxtopia.settings.v1` 为准并即时生效；删除账户仍走人工 issue 申请（前端不碰 `auth.users`）；测试见 #44 行 |
