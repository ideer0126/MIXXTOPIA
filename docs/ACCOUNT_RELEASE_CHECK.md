# 账户与云存档上线验收（#47）

2026-10-27，分支 `feat/47-account-release-integration`，隔离工作区 `account-release-47`，基于 `6d91a27`（已含第一关与 0.4.0）。此前 `feat/47-account-release-check` 的准备工作由用户提交为 `c3245dd`；本分支将其中五个验收相关文件整合到最新 main，保留新第一关及版本改动，未创建提交。

**结论：本地验收、真实 beta 注册 / 同步 / 统计 / RLS 及人工删号级联验收通过；稳定版根入口复验尚未具备条件，#47 / #22 不能标为完成。**

2026-10-28 继续于 `feat/47-account-release-check-v2`（起始 HEAD `5fb500a`）：此前整合改动已由用户提交。新增发布检查回归，修正仅测试 / 文档提交导致的部署落后误报；00:26 的只读核查未再复现缺列错误。随后用户明确确认测试项目及创建 A/B 账号、写入测试资料 / 存档 / 统计的授权，已完成下述真实 beta 验收；00:57 在用户进一步明确授权后，已删除指定的两个测试账号并验证级联。验收阶段未提交、推送、操作 GitHub 或执行迁移；验收后用户已单独授权本地提交。

## 本地结果

| 检查 | 结果 |
|---|---|
| 全部 `js/*.js`、`tools/*.js` 语法；`git diff --check` | 通过 |
| Node 单测 | 313 项：engine 51、main 125、auth 39、account 21、cloud 38、stats 19、channels 9、level1 11 |
| PostgreSQL 迁移 / RPC / RLS / 删除级联 | PGlite 本地引擎 6 组通过 |
| 桌面 / 触屏主流程冒烟 | 各 102 项通过，已接入 `stats.js`、统计 UI / RPC 桩、注册与隐私入口 |
| 桌面 / 触屏输入冒烟 | 各 22 项通过 |
| 真实 `index.html` 浏览器流程 | 注册 → 资料保存与重载 → 会话恢复 / 过期续期 → 保存并授权上传 → 新浏览器登录 → 确认下载 → 继续游玩，通过 |
| 统计与降级 | PLAYING 计时、收集率 / 成就跨浏览器一致、离线保存与重开补传、幂等同步、切号隔离、游客零请求，通过 |
| 隐私与删除入口 | 登录页隐私链接可见；设置页删除申请 URL 不包含测试邮箱；未发送申请或执行真实删号 |
| 本地 beta 发布产物 | 桌面 / 触屏：序章 → 真实第一关 → 步行收星 → 保存退出，通过；仅写 beta 存档 / 统计键，未写 stable 存档键；账户脚本及加载顺序、隐私 / 删除链接、通道元数据与运行时白名单通过 |
| 地图校验 | `--level 1`：0 错误；全量：既有 48 错误 / 0 警告（关 2–6、总关数 / 星数与后续关卡引用未完成）；不视为本次回归 |

浏览器使用拦截的 Auth / REST 请求和本地 PostgreSQL 引擎；外网请求被阻断（字体以空样式桩替代）。这验证了前端接线、SQL 与本机浏览器行为，**不能替代真实 GoTrue / PostgREST / Pages 验收**。`smoke-main.html` 的注册 / RPC 是内存桩，不验证数据库；`smoke-stats.js` 使用真实本地 SQL，但 Auth 仍是桩。

复现命令（可选工具安装在仓库外，不新增游戏依赖）：

```bash
for file in js/*.js tools/*.js; do node --check "$file" || exit 1; done
for suite in engine main auth account cloud stats channels level1; do
  node "tools/test-$suite.js" || exit 1
done
node tools/test-account-release.js
MIXX_PGLITE_MODULE=/home/xche/.cache/mixxtopia-47/node_modules/@electric-sql/pglite \
  node tools/test-stats-db.js
MIXX_PGLITE_MODULE=/home/xche/.cache/mixxtopia-47/node_modules/@electric-sql/pglite \
MIXX_PLAYWRIGHT_MODULE=/home/xche/.cache/mixxtopia-47/node_modules/playwright \
MIXX_CHROME=/opt/google/chrome/chrome \
  node tools/smoke-stats.js
node tools/validate.js --level 1
node tools/validate.js # 全量仍为上述 48 项已知错误
node tools/build-channels.js --out /tmp/mixxtopia-47-site \
  --beta-ref HEAD --beta-label account-release-check --worktree
git diff --check
```

按实际安装位置调整模块路径；本次浏览器结果与截图在 `/tmp/mixxtopia-stats-smoke/`，本地 beta 产物在 `/tmp/mixxtopia-47-site/`，产物浏览器检查结果在 `/tmp/mixxtopia-47-artifact.json`。脚本自动关闭自身服务器和浏览器，无后台监视。主流程冒烟使用明确的占位关夹具；真实序章 / 第一关的账户存档检查直接使用 `index.html` 与 `play-level1.js` 的步行 / 对话助手，不改写地图或星星状态。

## 线上只读快照

以下为 2026-10-27 17:42（Asia/Shanghai）的初次 GET 快照；当时未登录、未注册、未执行 RPC / 迁移、未修改远端。后续快照与用户授权后的真实验收见下文，历史缺列错误已不再复现。

| 对象 | 实测 |
|---|---|
| [stable 根入口](https://ideer0126.github.io/MIXXTOPIA/) | HTTP 200，稳定版尚未发布，占位页；符合测试期策略 |
| [beta](https://ideer0126.github.io/MIXXTOPIA/beta/) | HTTP 200，`v0.3.0-beta.1` / commit `8581fe1`；页面缺少 `account.js` / `cloud.js` / `stats.js` |
| [preview](https://ideer0126.github.io/MIXXTOPIA/preview/) | HTTP 200，预览版尚未开放，占位页；符合测试期策略 |
| beta 公开后端 | `https://hlnubesywvcxdghfyoux.supabase.co`；只有这一活动通道，无法据此确认测试 / 正式后端隔离 |
| Auth `/auth/v1/settings` | HTTP 200；邮箱注册开启，自动确认开启 |
| `GET /rest/v1/stats?select=device_millis,remainder_ms,collections&limit=0` | HTTP 400，`42703`：`column stats.device_millis does not exist`；统计迁移未完整落地 |

19:21 再次执行一次只读核查（继续任务后核对已更新部署），得到：

- beta 已是 `v0.4.0-beta.1` / commit `6d91a27`，`auth.js` / `account.js` / `cloud.js` / `stats.js` 齐全，与本分支基线一致。该发布由外部操作完成，本任务未发布 tag 或修改远端。
- stable / preview 仍是测试期占位页；公开后端仍为上述项目，Auth 设置正常。
- 当时统计列检查仍为 HTTP 400 / `42703`，缺少 `stats.device_millis`；测试 / 正式后端隔离与真实账号验收待确认。
- 当时报告 `ready: false`；下述 2026-10-28 快照已更新同名原始报告。

2026-10-28 00:26（Asia/Shanghai）继续任务后的只读核查：

- beta 仍为 `v0.4.0-beta.1` / `6d91a27`，账户脚本齐全；stable / preview 仍是占位页。对比本地 Git 提交中的站点源文件（构建白名单，包含可选根资源），与 HEAD `5fb500a` 相同，报告 `sourceComparison: same-runtime`。这只证明两个提交的运行时源码一致，不代表已逐文件验证线上字节。
- 统计匿名 GET 现在返回 HTTP 401 / `42501`（`permission denied for table stats`），**不再复现缺列错误**。权限拒绝不足以确认 `0002_stats.sql`、`merge_stats` RPC 或登录态 RLS 完整正确；不据此宣告迁移已完成，也不直接重复应用线上迁移。
- 报告 `blockers: []`、`ready: false`；仍有后端隔离、真实跨账号 RLS / 跨浏览器同步、统计迁移 / RPC、人工删除及级联验收待完成。原始报告：`/tmp/mixxtopia-47-online-current.json`。
- 重新验证：全部 JS 语法、原有 313 项 Node 单测、新增 6 组发布检查回归、6 组本地 SQL 检查通过；真实 `index.html` 的桩账户流程通过；桌面 / 触屏主流程各 102 项、输入各 22 项通过。关 1 为 0 错误，全量仍为既有 48 错误 / 0 警告。浏览器结果：`/tmp/mixxtopia-47-smoke-20261028/`。

公开匿名查询不能验证登录态 RLS 或完整 RPC 权限。即使该查询日后不再报缺列，也仍须用测试账号执行真实验收。

复查（显式运行一次，无重试 / 轮询，只发 GET；存在阻塞或待验项时退出码为 1）：

```bash
node tools/check-account-release.js --out /tmp/mixxtopia-47-online.json
```

脚本只解析已部署 JS 中的公开配置常量，不执行远端 JavaScript；报告不保存凭据或账户数据。不同提交会比较其站点运行时源码，纯测试 / 文档差异不阻塞部署；线上提交不在本地或元数据无效时保留待核对项，不自动 fetch。`ready: false` 同时包含已发现阻塞和脚本无法自行确认的人工项目。此只读脚本不读取验收记录或人工证据；其固定 pending 不会因下述已完成的真实验收自动消失，实际完成状态以本记录为准。

## 真实 beta 验收（2026-10-28，已获授权）

用户在本聊天确认 `hlnubesywvcxdghfyoux` 为隔离测试项目，并授权创建 A/B 测试账号、写入测试资料 / 存档 / 统计及执行跨浏览器 / RLS 验证。00:30 注册两个账号；00:34–00:36 的最终验收运行通过 11 组检查、90 次真实 Auth / REST 响应，浏览器脚本错误为 0。使用实际部署的 beta 页面及真实 GoTrue / PostgREST；未替换账户或 REST 响应，仅以空样式替代外部字体。两个浏览器使用隔离存储的桌面 / 触屏上下文；确定性游玩仍使用 `play-level1.js` 的真实步行 / 对话助手，未改写地图、星星或机关状态。

| 检查 | 真实结果 |
|---|---|
| 注册与资料建档 | A/B 均通过页面注册，HTTP 200，自动登录，profiles 自动创建 |
| 迁移运行时接口 | 登录态 `stats` 的 `device_millis` / `remainder_ms` / `collections` 查询及 `merge_stats` RPC 均为 HTTP 200；此前缺列阻塞解除，本任务未应用线上迁移 |
| 资料与会话 | A 保存昵称 / 头像 / 声音偏好并重载成功；会话恢复及标记本地 token 过期后真实续期成功 |
| 第一关保存上传 | 真实序章 → 第一关步行收星 → 保存退出 → 明确授权上传；云端为 `s1`，收集率 1/3、初见星光成就及 2500ms 新增时长一致；暂停 / 对话不计时 |
| 新浏览器继续 | 触屏上下文重新登录；第一次下载点击不写本机，第二次确认后恢复 1 星存档并继续；两端资料及统计一致 |
| 真实版本冲突 | 触屏继续收集 `s2` 并上传；桌面用旧版本保存，CAS 返回 0 行，页面提示「云端进度已变化，请重新逐档选择」，本机仍为 1 星；两次确认下载后恢复云端 2 星，无静默覆盖 |
| 离线与重开 | 阻断后端请求时仍能保存回标题；离线刷新保留 pending；恢复网络后重开，同账号补传成功，两端统计收敛。最终运行较起点新增 9750ms，包含前面两端的游玩时长 |
| 统计幂等 | 对已上传 writer 重复提交相同 / 更小毫秒计数，云端秒数与毫秒余数均不增加 |
| A/B 读写隔离 | B 有独立资料、云档及统计作为非空夹具；A 查询 B 的三表均为 HTTP 200 / `[]`，更新均为 0 行；B 自己重读的数据未变。A 的无归属过滤查询也只返回 A 的行 |
| RLS WITH CHECK / 匿名权限 | A 向 B 插入存档、把本人存档归属改为 B，均为 HTTP 403 / `42501`；匿名三表查询及 RPC 均为 HTTP 401，未泄露数据 |
| 隐私、删除入口与登出 | 登录页隐私链接 HTTP 200；删除申请入口可见、URL 不带测试邮箱，未提交申请；真实登出后本地存档 / 设置保留，beta 会话清除，stable 键未被写入 |

最终脱敏报告与截图在 `/tmp/mixxtopia-47-live/results.json`、`desktop.png`、`touch.png`；注册预检报告在 `/tmp/mixxtopia-47-live-preflight.json`。报告只记录合成测试邮箱、账号 UUID、路径 / 方法 / 状态码及断言结果，无密码或令牌。验收脚本位于 `/tmp/mixxtopia-47-live-browser.cjs`，当时复用了已创建的两账号，不属于默认本地质量门禁；这两账号现已删除，临时凭据文件也已移除，不能直接复跑或自动重新注册。以后真实后端写入仍须另行授权。初次导航路径与冲突状态断言假设修正后重跑，保留了前两次报告；最终运行按起点云端累计量计算新增时长。未新建后台任务或轮询。

这两账号已在用户明确授权后永久删除；以下 UUID 保留用于审计与精确核对：

| 账号 | UUID |
|---|---|
| A | `65600336-bfc1-4b6e-ba34-7d10346fbdad` |
| B | `5bbf250c-1f14-45f6-b61b-4e734968b35c` |

只读核对脚本 `/tmp/mixxtopia-47-cleanup-audit.sql` 限定上述精确 UUID，使用 Supabase 管理后台 SQL Editor 的项目所有者上下文核对四张表，不以 REST 的 RLS 空结果代替级联证据。

00:46 继续 #47：通过用户已登录的 Supabase 管理后台，以精确 UUID 限定的纯 SELECT 查询核对删除前基线，A/B 在 `auth.users` / `profiles` / `saves` / `stats` **各为 1/1/1/1**。当时管理界面仅选中上述两账号，等待不可恢复删除的明确确认。基线报告 `/tmp/mixxtopia-47-live/cleanup-before.json`，范围截图 `/tmp/mixxtopia-47-live/cleanup-confirmation.png`。根路径 `channel.json` 仍为 `stable` 占位（`label/ref/commit` 均为 null），本次没有发布或替换根入口。

00:57 用户答复「确认，仅删除上述 A/B 两个测试账号」后，通过 Auth 管理界面的两用户确认框执行删除。重新执行同一条纯 SELECT，**A/B 四表计数均为 0/0/0/0**，真实级联清理通过，未直接删除业务表或改动迁移。删除后用原凭据分别尝试真实 GoTrue 登录，均返回 HTTP 400 / `invalid_credentials`；同时通过当前 `js/auth.js` 验证预置的 beta 存档 / 设置存储夹具保持不变，无有效会话。此项为 Auth 客户端加真实网络验证，**没有重新运行同一浏览器跨删号前后的完整存储流程**；此前真实浏览器登出保留存档 / 设置的证据仍见上表。

删除后脱敏报告 `/tmp/mixxtopia-47-live/cleanup-after.json`，实际 SQL 结果截图 `/tmp/mixxtopia-47-live/cleanup-after.png`；本轮临时测试凭据文件已移除，不保留密码或令牌到报告。

## 后续操作与完成条件

按仓库 `AGENTS.md` §1.1 / §1.3，提交、发布与额外真实后端写入须分别获得授权。此前账号创建与资料 / 存档 / 统计授权，以及此次指定 A/B 两账号删除授权均已执行；不含迁移、提交、发布或 GitHub 写操作。

1. 用户已确认当前隔离测试项目；统计列 / RPC 的真实调用已通过，无须为此前缺列报告重复应用迁移。未来正式后端仍须配置并独立验收。
2. 本地验收改动已获用户单独授权提交；推送、创建 PR 尚未获授权或执行。当前 beta 已含待验功能，无须为这些测试 / 文档单独发布新 beta。以后如功能再有变更，需核对实际发布 tag；工作流优先选择 beta tag，单纯合并 main 不保证 beta 更新。不修改 `.github/`。
3. 已获授权并完成真实 beta 注册、登录、设置、保存、第二浏览器登录 / 下载 / 继续、冲突逐档确认、离线重开补传、时长 / 成就 / 收集率一致性验收，详见上表。
4. 真实 A/B RLS 与匿名拒绝已完成，脱敏状态码与结果见上表及报告；未记录密码或令牌到报告。
5. 隐私链接可读、删除申请入口已验证；删除账户采用已定的**提交申请后人工删除**流程，不承诺即时自助删除。指定 A/B 测试账号已获明确授权并经后台删除，所有者上下文 SQL 确认四表归零；真实旧凭据被拒，Auth 客户端的本地存档 / 设置夹具保留。测试未提交 GitHub issue。
6. 将真实验收结果补入本记录及 `PLAN.md` §8；确认 #45 的真实同步验收也已覆盖后，再由人类决定关闭 #45 / #47 / #22。

#47 原文要求根路径全流程；当前发布策略规定测试期只开放 beta，因此本阶段在 beta 验证。首个稳定版本发布后，仍须在根入口的正式环境重新验收，不能把占位页返回 200 记作游戏验收通过。
