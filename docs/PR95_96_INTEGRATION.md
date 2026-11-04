# #95 / PR #108 与 PR #96 本地整合记录

日期：2026-11-04（Asia/Shanghai）。本记录说明本地整合及验收；最终提交和远端状态以 GitHub PR 为准。

## 输入与处理

- `main`：`4fb1a0a976c0c78b5c0dfd37e513cd341760f66e`。
- [PR #108](https://github.com/ideer0126/MIXXTOPIA/pull/108)：`56dca9a63888a8c08736566d02c7337d3b1b5e34`，完成 [#95](https://github.com/ideer0126/MIXXTOPIA/issues/95) 的按场景加载、运行小图、发布构建、文档和回归。
- [PR #96](https://github.com/ideer0126/MIXXTOPIA/pull/96)：`c15550fbbcfa96709632c8dd9a1082f477e60bd2`，包含相同图片加载基础和礼堂碰撞 / 遮挡修正；只读核对时 5 条行内评审线程均已解决。
- 两条分支各自可合并到上述 main，但直接整合仍在 `js/birthday.js`、`js/data.js`、`tools/test-main.js` 发生冲突。

初始本地分支 `feat/95-96-integration` 从 #96 创建，合入 #108（`--no-commit --no-ff`），完成下述验证。

用户批准提交、推送及合并后，执行前重新核对发现 #96 已于 2026-11-04 20:02:21 合并为 `cb53abf768d8e1ffeccbce8f8ba8b1dce853d16b`；该 main 的文件树与上述 #96 完全一致，#108 因此转为冲突。最终本地分支 `feat/95-image-loading-finalize` 从 #108 创建，合入该 main，冲突解决恢复为已经完成全部验证的同一文件树，仅更新本段与 PLAN 的状态记录。未新建 worktree，也未改动原两条功能分支。

冲突处理保留 #96 的实际碰撞 / 遮挡数据、可见泳圈降级和后台完整图片组；合并 #108 的分阶段请求与裁切映射检查，并保留 #96 的失败重试检查。最终 `js/birthday.js`、`js/data.js`、`js/main.js` 与 #96 相同。发布图片与运行尺寸映射在两分支间相同。

额外增强 `tools/smoke-build.js`：在全部 WebP 解码失败后恢复正常响应，验证再次进入套圈可只重试三张小游戏贴图并成功解码，无需重载页面。后台图片组的 7 张新增资源为 3,800,556 B；原 #108 文档的 5 张 / 2,617,822 B 未计入 #96 补齐的道具 / 通用门图集，现已修正。发布总图片仍为 32 张、15,562,122 B。

## 本轮验证

`npm ci` 完成；锁定版本 esbuild 的实际构建通过。48 份 JavaScript 语法检查和 `git diff --check` 通过。

| Node 套件 | 通过数 |
|---|---:|
| test-main | 156 |
| test-engine | 52 |
| test-level1 | 15 |
| test-collision | 11 |
| test-rings | 7 |
| test-auth | 49 |
| test-account | 22 |
| test-cloud | 38 |
| test-stats | 19 |
| test-channels | 10 |
| test-build | 6 |
| test-password-recovery | 11 |
| test-account-release | 7 |
| test-password-live（仅本地桩） | 2 |
| 合计 | 405 |

- `node tools/validate.js --level 1`：0 错误。默认全量校验仍为 48 错误，均是未制作关 2–6、总关数 / 总星数和关 1 到关 2 的出口引用；不代表全量发布验收通过。
- 发布产物 `smoke-build`：桌面、模拟触屏竖屏 / 横屏，标题零图片、序章独立加载、完整第一关、后台存档直接继续、重玩缓存、找回页隔离、损坏图片降级和恢复后重试均通过。
- `smoke-level1-collision`：四向、斜向、15 / 30 / 60 / 144 fps、触屏方向键及完整路线通过。
- `smoke-level1-map`：桌面 / 模拟触屏各 64 个礼堂物件、236 条可达接近路线通过，包含接触后可退离断言。
- `smoke-level1-actors`、`smoke-level1-visual`、`smoke-cake`、`smoke-storage`、`smoke-stage-balloons`、`smoke-rings`、`smoke-local-file` 全部通过；覆盖人物 / 前景、套圈成功与失败、保存及真实 `file://` 页面。
- `smoke-password-recovery`：12 组桌面 / 模拟触屏浏览器桩检查通过，无真实邮件或后端写入。
- 本轮浏览器检查均无未处理页面错误；已查看发布产物礼堂与竖屏后台截图。模拟触屏不等于真实手机验收。

可重跑命令采用 PLAN §4 及上述各 `node tools/<脚本>.js`；浏览器需设置 `MIXX_PLAYWRIGHT_MODULE` 和 `MIXX_CHROME`。本轮日志和截图位于忽略目录 `.ds/95-96-integration/`。

## 整合后新增评审修复

执行已批准的推送和 PR #108 标题 / 说明更新后，核对到两条 2026-11-04 20:02 的评审意见，虽已标为旧差异，问题在当前 main 中仍存在：

- 序章图片失败后 `_sceneImages` 缓存没有清除，重复新游戏无法重试。现按场景图片相同方式注册 `onerror` 并移除失败项；加载中和成功图片继续复用，不更改剧情 / 存档。
- 源 WebP 删除或改名后，导出工具仍保留旧运行图，发布包复制资源时会携带它。现按本次导出清单清理失效 WebP，保留当前输出和非图片文件。

两条新增定向回归在修复前均失败，修复后通过：`test-main` 新增序章失败 / 重开 / 成功复用检查；`python3 tools/test-runtime-images.py` 在临时目录检查源图删除 / 改名及旧运行图清理、清单、透明像素和非图片文件保留。

修复后重跑全部 48 份 JS 语法、14 套 Node 检查（上表共 405 项 / 组）、Python 定向导出检查、第一关及全量地图校验；全量仍为相同 48 项既有错误。发布产物重新覆盖桌面 / 触屏横竖屏完整流程，以及网络恢复后在同页重新开局成功加载序章；`file://` 冒烟另行复验。碰撞等其余专门浏览器验收沿用上节已完成结果。

## 远端处理顺序

#96 已合并，不再向其分支推送或重复执行合并。当前 main 已含图片运行时代码；#108 的剩余内容是加载 / 裁切 / 恢复验证、文档和上述两项定向修复，因此标题与说明应按最终差异更新。

1. 提交本地冲突解决及验收记录（用户已批准）。
2. 将结果快进推送至 `origin/feat/95-scene-image-loading`，更新 PR #108，无需强推。
3. 更新 PR #108 标题和说明，准确描述当前 main 之上的验收与文档增量。
4. 核对 PR #108 的差异和必要 CI，通过后合并（用户已批准合并）。

用户已补充批准 #108 的首次推送与说明更新，整合提交 `eb9d382` 已快进推送。上述新增评审修复在本地完成后，按 AGENTS 的逐项授权规则另行确认提交、再次推送及说明更新。PR #108 保留 `Closes #95`，合并后由 GitHub 关闭该 issue；不重复关闭 #96，不自动监控 CI，不发布新版本。
