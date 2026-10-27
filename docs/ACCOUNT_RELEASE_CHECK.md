# 账户与云存档上线验收（#47）

2026-10-27，分支 `feat/47-account-release-integration`，隔离工作区 `account-release-47`，基于 `6d91a27`（已含第一关与 0.4.0）。此前 `feat/47-account-release-check` 的准备工作由用户提交为 `c3245dd`；本分支将其中五个验收相关文件整合到最新 main，保留新第一关及版本改动，未创建提交。

**结论：本地验收通过；线上验收未完成，#47 / #22 不能标为完成。**

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

以下为 2026-10-27 17:42（Asia/Shanghai）的初次 GET 快照；未登录、未注册、未执行 RPC / 迁移、未修改远端。**19:21 的最新快照见表后，部署阻塞已由外部发布解决，数据库缺列仍在。**

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
- 统计列检查仍为 HTTP 400 / `42703`，缺少 `stats.device_millis`。目前明确的阻塞是迁移未完整落地；测试 / 正式后端隔离与真实账号验收仍待确认。
- 最新原始报告位于 `/tmp/mixxtopia-47-online-current.json`；报告 `ready: false`。

公开匿名查询不能验证登录态 RLS 或完整 RPC 权限。即使该查询日后不再报缺列，也仍须用测试账号执行真实验收。

复查（显式运行一次，无重试 / 轮询，只发 GET；存在阻塞或待验项时退出码为 1）：

```bash
node tools/check-account-release.js --out /tmp/mixxtopia-47-online.json
```

脚本只解析已部署 JS 中的公开配置常量，不执行远端 JavaScript；报告不保存凭据或账户数据。`ready: false` 同时包含已发现阻塞和仍需人工验收的项目。

## 后续操作与完成条件

按仓库 `AGENTS.md` §1.1 / §1.3，以下提交、发布与真实后端写入须分别获得授权；本分支未执行这些操作。

1. 确定测试 Supabase 项目，核对与未来正式环境隔离；在目标项目核对 `0001_init.sql`，应用并检查 `0002_stats.sql`。现有公开项目缺列，不应把本地 SQL 通过当作线上迁移成功。
2. 本地验收改动经确认后提交；推送、创建 PR 各自授权。当前 beta 已含待验功能，无须为这些测试 / 文档单独发布新 beta。以后如功能再有变更，需核对实际发布 tag；工作流优先选择 beta tag，单纯合并 main 不保证 beta 更新。不修改 `.github/`。
3. 批准在隔离测试项目创建 A / B 验收账号及测试存档：在实际部署的 beta 完成注册、登录、设置、保存、第二个浏览器登录 / 下载 / 继续、冲突逐档确认、离线重开补传、时长 / 成就 / 收集率一致性。
4. 使用 A 的令牌读取 / 更新 B 的资料、云档与统计，确认无数据泄漏且无越权写入；游客匿名访问被拒。保存脱敏后的状态码与结果，不记录密码或令牌。
5. 点击隐私链接验证目标可读；删除账户采用已定的**提交申请后人工删除**流程，不承诺即时自助删除。获准后由维护者删除测试账号，核对 `profiles` / `saves` / `stats` 级联删除；验证本地存档仍按既有约定保留。测试不自动提交 GitHub issue。
6. 将真实验收结果补入本记录及 `PLAN.md` §8；确认 #45 的真实同步验收也已覆盖后，再由人类决定关闭 #45 / #47 / #22。

#47 原文要求根路径全流程；当前发布策略规定测试期只开放 beta，因此本阶段在 beta 验证。首个稳定版本发布后，仍须在根入口的正式环境重新验收，不能把占位页返回 200 记作游戏验收通过。
