# 邮件找回密码（#22）

本地实现：登录页「忘记密码？通过邮件找回」→ 独立 `reset-password.html` → 申请邮件 → 邮件链接返回同一通道 → 服务端验证身份 → 输入两次新密码 → 返回游戏登录。

此页面不启动游戏，也不恢复原有登录态。恢复凭据只留在内存；本机当前账户（即使是另一账号）、存档、设置、云同步基线和统计不被读写。服务器验证成功后展示待重置账户的邮箱，让玩家确认目标。刷新或离开页面会结束本次恢复，需重新申请邮件。重置成功不会自动登录或合并游戏进度。

## 接口与失败处理

- 沿用 Supabase + 手写 REST，不引 SDK：`POST /auth/v1/recover?redirect_to=…` 申请邮件，默认邮件的 `ConfirmationURL` 经 GoTrue 验证后返回 `#type=recovery&access_token=…`。
- 页面在任何认证请求之前清除 URL 的 fragment / query；只接受 `type=recovery`，重复或缺失参数、其他类型链接直接拒绝，不把 URL 中的原始错误文案展示给玩家。页面没有第三方字体、统计或其他外部资源，设置 `Referrer-Policy` 对应的 `no-referrer` meta。
- 用临时令牌 `GET /auth/v1/user` 验证身份，再 `PUT /auth/v1/user` 写入新密码。不会用游戏账户的令牌代替，不自动刷新、持久化或发出游戏登录事件，也不触发 profiles / saves / stats 请求。
- 邮箱格式在客户端检查；申请成功统一显示「如果该邮箱已注册，你将收到重置邮件」，不借此透露账号是否存在。限流、发信失败和网络错误有中文提示。
- 新密码沿用现有至少 6 位规则；两次不一致不发请求，提交后清空密码输入框。服务端拒绝弱密码 / 同密码时允许重新输入；链接失效则重新申请。
- 重置写入遇网络错误、超时、5xx 或回包无法确认时，可能已在服务端完成。清除临时凭据、关闭重复提交入口，提示先用新密码登录验证；不自动重试 PUT。
- 离开页面 / 从浏览器往返缓存恢复时清除表单和恢复凭据，旧回包不能重新激活恢复状态。

## 上线前配置与真实验收

以下属于部署配置和真实后端操作。URL 配置已获用户明确授权并保存，SMTP 凭据由用户亲自填写并保存，具体核对记录见下文；发布与真实邮件验收尚未执行。按 `AGENTS.md` 分别获得授权后再操作；不要从旧验收记录推定已授权本轮发信或修改账号。

1. 核对当前通道的 `js/cloud-config.js` 指向正确的隔离项目。找回页随活动游戏通道一起构建：beta 使用 `/MIXXTOPIA/beta/reset-password.html`，stable 使用 `/MIXXTOPIA/reset-password.html`，preview 使用 `/MIXXTOPIA/preview/reset-password.html`；占位通道不发布找回页。
2. 在对应 Supabase 项目的 Auth URL Configuration 中添加该通道**准确的 HTTPS 回调 URL**。本次 beta 为 `https://ideer0126.github.io/MIXXTOPIA/beta/reset-password.html`。如回调未列入 allowlist，GoTrue 可能回落到 Site URL；当前根入口为占位页，不能完成密码找回。
3. 核对可用的发信服务；面向普通玩家发送邮件需配置自定义 SMTP 或既有 Send Email Hook。SMTP 密码只存 Supabase 服务端配置，不能放入仓库或前端。保留默认 Reset Password 邮件中的 `{{ .ConfirmationURL }}` 链接；本实现使用 implicit 恢复流程，不接受 PKCE `code` 或自定义 `token_hash` 链接。
4. 部署包含本次改动的活动通道产物。现有工作流优先选择 beta tag，合并 main 本身不证明 beta 已更新。无需修改 `.github/`。
5. 使用获授权的专用测试账号收信，走通「申请 → 收信 → 点击 → 确认邮箱 → 重置 → 旧密码拒绝 / 新密码登录」。同时检查失效链接、重复申请限流、已有其他账号会话时不被替换、游戏数据保留及桌面 / 触屏。确认需要删除测试账号时再单独授权清理。

官方依据：[密码认证与恢复](https://supabase.com/docs/guides/auth/passwords)、[邮件发送配置](https://supabase.com/docs/guides/auth/auth-smtp)、[回调 allowlist](https://supabase.com/docs/guides/auth/redirect-urls)。

## 本地验证

默认检查全走离线 fetch 桩；浏览器脚本拦截全部认证 / 外部请求，**不发送真实邮件，不修改真实密码**。

```sh
node tools/test-password-recovery.js
node tools/test-auth.js
node tools/test-channels.js
MIXX_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node tools/smoke-password-recovery.js
```

浏览器脚本构建本地 beta 产物，在桌面 / 触屏上检查真实页面入口、当前通道回调、URL 凭据清除、服务端身份验证、重复密码校验、重置成功 / 结果不确定 / 失效链接、原有各通道本机数据保留，以及回游戏后旧密码拒绝 / 新密码登录。报告与截图默认输出 `/tmp/mixxtopia-password-recovery/`，仅保存检查结果，不保存密码或令牌。

本地通过不等于真实邮件投递和已部署页面通过；真实发信与上线闭环仍待发布与授权验收。

## 2026-10-28 上线前只读核对

- 首次核对真实 beta：`v0.4.0-beta.1` / `6d91a27`，页面还没有找回入口；`/MIXXTOPIA/beta/reset-password.html` 为 HTTP 404。后续发布准备时只读核对 beta 已为 `v0.5.0-beta.1` / `c37147e`；仍需发布本次找回功能后才能进行已部署页面的完整恢复验收。
- 初次核对项目 `hlnubesywvcxdghfyoux`：Site URL 为 `http://localhost:3000`，Redirect URLs 列表为空。
- 初次核对时自定义 SMTP 未启用；Auth Hooks 列表为空，没有既有 Send Email Hook。未发送测试邮件来试探。
- 用户随后明确授权保存两项 URL 配置：现已保存 Site URL `https://ideer0126.github.io/MIXXTOPIA/beta/`，新增唯一回调 `https://ideer0126.github.io/MIXXTOPIA/beta/reset-password.html`，未增加通配符。控制台显示 Site URL 保存成功、回调添加成功及 `Total URLs: 1`；截图 `/tmp/mixxtopia-recovery-url-config-saved.jpg`。
- 用户确认没有现成 SMTP 服务，也没有可管理 DNS 的域名，随后选择 QQ 邮箱。SMTP 密码 / 授权码由用户在 Supabase 后台填写，未要求在聊天中提供；未在仓库记录邮箱地址或凭据。真实邮件验收、代码提交、推送 / PR 与 beta 发布仍需各自授权。
- 用户亲自填写授权码并保存后，只读核对确认自定义 SMTP 已启用、名称为 `MIXXTOPIA`、主机 `smtp.qq.com`、端口 `465`；Password 显示已存储密码隐藏，Save changes 禁用，无待保存改动。未读取凭据、未发送测试邮件，投递能力仍待真实验收。截图 `/tmp/mixxtopia-qq-smtp-saved.jpg`。

2026-10-28 发布准备：本地分支 `feat/22-password-recovery-release` 已整合最新 main `2a98247`（0.5.0、第一关与头像素材、Byeori / Haewon 原画）。修正 `smoke-stats.js` 的过期假设，按实际开放状态挑选可拾取的星并核对已收集，不绕过套圈解锁规则。

整合后的本地结果：9 组 Node 套件共 355 项、发布检查 7 组、本地 SQL 6 组通过，32 个 JS 文件语法与 diff 检查通过。邮件找回桌面 / 触屏产物冒烟共 12 组通过；现有主流程冒烟各 102 项、输入各 22 项通过。关 1 校验通过；全量地图仍为关 2–6 等未完成内容的既有 48 项错误，不表示完整发布门禁通过。

提交标题：`feat(auth): 增加邮件找回密码流程`。2026-10-28 用户明确授权提交并推送 `feat/22-password-recovery-release`；原 `feat/22-password-recovery` 仍指向 `7c015f7`，没有独有提交，找回功能改动已完整带入当前整合分支。创建 PR、评审 / 合并、发布 beta 与真实邮件验收尚待各自授权，本轮不执行这些操作。
