/**
 * js/main.js —— 游戏状态机与 UI 接线（Issue #6）+ 对话系统（Issue #7）
 *   + 收集解谜（#9）+ 战斗接线（#18）
 *
 * 六态状态机：
 *   TITLE(标题) ⇄ PLAYING(游玩) ⇄ DIALOGUE(对话) ⇄ PLAYING
 *   PLAYING ⇄ PAUSED(暂停) → PLAYING / TITLE
 *   PLAYING → CLEAR(结算) → 下一关 PLAYING / ENDING(结局) → TITLE
 *
 * 对话系统（Issue #7，规范见 GAME_DESIGN.md §7）：
 *   - 面向 NPC 按 E 触发；对话期间玩家定身、计时暂停（状态机隔离，PLAYING 才移动）；
 *   - 打字机 25ms/字逐字显示（DIALOG_MS），姓名框随行切换（nar 旁白隐藏姓名标签）；
 *   - 打字中按住互动键加速打字（DIALOG_FAST_MS），按住 <250ms 内短松开的「点按」
 *     立即显示本行全文（快进）；本行显示完后 E/空格/Enter/点击对话框翻页；
 *   - 末行翻页退出对话，_leaveState 清空对话框与进行态（无状态泄漏）。
 *
 * 收集与解谜机制（Issue #9，规范见 GAME_DESIGN.md §6）：
 *   - 碰撞：engine.Mechanics 判定瓦片（墙/水）、关闭的门与箱子；玩家移动分轴滑动；
 *   - 推箱：朝箱子移动且箱后一格可站立时，礼物盒滑动一格；
 *   - 压力开关：玩家或箱子压住开关期间 target 门开启，离开即关闭；
 *   - 星星：接触收集 + 金色粒子 + 音效，触发 star:<星id> 台词（#12）；
 *   - 传送门：集齐本关星星后激活（粒子/音效/onEvent），踩上触发过关台词 → 结算；
 *   - 所有反馈走 engine.Particles 与 MIXX.audio，音频不可用时安静降级。
 *
 * 战斗（Issue #18，规格 GAME_DESIGN.md §12）：
 *   - engine.Combat 负责 HP / 被动能量 / 朝向 / 攻击判定 / 敌人 AI；
 *   - F 轻击、G 重击（手机 B/C），轻击与重击射程同为 24px；
 *     攻击只锁定正面 180° 内、视线可达的最近敌人，无敌人时沿移动方向；
 *   - 能量满时 F/G 释放能量炮（52.8px = 24 × 2.2），消耗 100 并清空；
 *   - 接触受伤 → 0.9s 无敌帧 + 击退；倒下满血回出生点、敌人复位，不扣星星；
 *   - HUD 显示 HP 与能量条；对话/暂停期间战斗与充能冻结。
 *
 * 对话节点语义（Issue #12，规格 GAME_DESIGN.md §7）：
 *   - 节点字段 type / trigger / once / entry / scopeId / lines / options / next；
 *   - NPC 互动解析：首次 intro（once）→ 同 trigger 的 npc 自我介绍（once）→
 *     intro.next 指向的 hint（repeat）→ check（repeat）；
 *   - 选项列表（check 节点）：↑↓ 移动、E 确认 → goto 分支节点；
 *   - 自动事件分发：收集星 → star:<星id>；过关 → clear:<关卡id>（播完才进结算）；
 *     关卡加载 → load:<关卡id>；黑羊互动 → sheep 计数 +1（随存档持久化）；
 *   - once 标记（this._playedNodes）随存档持久化（slot.played），重进不再重播。
 *
 * 存档系统（Issue #8，规范见 GAME_DESIGN.md §10）：
 *   - 3 个存档位（localStorage `mixxtopia.save.v1`；beta/preview 通道追加 `.<channel>`）；
 *     标题「继续冒险」= updatedAt 最新的存档位，「选择存档」列出 3 档，不做选关；
 *   - 手动存档制：仅「ESC → 保存并退出」与通关结算自动存档会写盘；
 *     「回到标题（不保存）」/刷新页面丢弃上次存档之后的进度；
 *   - 存档内容：当前关、每关已收集星 id、cleared/unlocked、黑羊计数、once 已播节点；
 *   - 声音设置独立存 `mixxtopia.settings.v1`（同样按通道加后缀），开关立即生效。
 *   - 发布通道（#17）：stable 保持历史键；beta/preview 使用独立键，避免同源覆盖正式存档。
 *
 * 账户 / 登录（Issue #43，规范见 docs/ACCOUNT_SYSTEM.md §6/§10）：
 *   - js/auth.js 手写 GoTrue 封装；本文件只做 UI 接线，账户会话存
 *     `mixxtopia.account.v1`（beta/preview 加通道后缀，与存档键隔离一致）；
 *   - 标题「登录 / 注册」打开登录 screen（沿用 _show/_hide，不新增游戏状态）；
 *   - 未登录 = 游客态：不发起任何网络请求，游戏逻辑与 #8 完全一致；
 *   - 登录/注册/登出异步进行，按钮在请求期间置灰；后端错误码由 auth.js 映射成中文；
 *   - 网络失败提示「云端暂不可用」并留在登录界面，返回标题即可继续本地游玩；
 *   - 启动时恢复会话（过期自动 refresh），标题账户按钮随登录态更新文案。
 *
 * 账户设置（Issue #44，规范见 docs/ACCOUNT_SYSTEM.md §8/§11）：
 *   - `js/account.js` 负责 profiles 表读写与校验（昵称 1–16 字、固定头像白名单、
 *     音效/操作偏好）；本文件负责「账户设置」screen 的 UI 接线（仍不新增游戏状态）；
 *   - 标题设置入口对游客可见；游客仅可调整本机偏好，昵称与头像不可编辑；
 *   - 登录/恢复会话后自动拉取 profile：标题按钮优先显示昵称，失败不阻塞游玩；
 *   - 昵称/头像保存到云端（PATCH profiles，失败提示中文且本机设置不丢）；
 *   - 音效/触屏按键偏好立即生效并写 `mixxtopia.settings.v1`（本地是唯一运行时来源）；
 *     换新设备（本机无设置记录）时采用云端偏好；本机已有记录则本地优先，保存时再上传；
 *   - 删除账户按 docs/PRIVACY.md §5 走 GitHub issue 人工处理，前端不调 auth.users。
 *
 * 状态机约定（「无状态泄漏」的实现要点，测试 tools/test-main.js 逐项验收）：
 *   - 每次切换必经 _setState → _leaveState(旧态清理) → _enterState(新态初始化)，
 *     每个状态进入/离开时负责自己的 UI 显隐与输入开关，不允许跨状态残留；
 *   - 输入（engine.Input）在标题/结算/结局禁用（顺带清空按住键），
 *     游玩/对话/暂停启用；虚拟按键仅在游玩/对话显示；
 *   - 对话、暂停、结算、结局的 DOM 内容在离开状态时一律清空；
 *   - 关卡数据（data.js 的 GAME.levels）只读：加载关卡时浅克隆实体层，
 *     收集标记写在运行时副本上，重玩/重进不残留；
 *   - 单游戏循环：start() 防重复启动，destroy() 解绑全部 UI 监听、输入与渲染器。
 *
 * 数据来源：window.GAME（js/data.js，Issue #11/#12）就位后自动采用；
 * data.js 已接入序章与关 1；仅在 levels 缺失/为空时使用内置占位关卡兜底，
 * 便于无数据的引擎/UI 测试。指向未制作关卡的显式出口结算后回标题，不提前播放终章。
 * 后续接入：#11 关 2–6 地图、#13 正式人物美术、#15 演出。
 *
 * 启用方式：index.html 在 engine.js 之后加载本文件；本文件立即设置
 * MIXX_NO_DEMO = true 停用引擎演示模式，并在 DOMContentLoaded 后自启动。
 * 测试/冒烟页面可设 MIXX_NO_BOOT = true 阻止自启动，手动 new Game()。
 */
'use strict';

(function (root) {
  'use strict';

  // 从脚本所在的应用根目录解析头像，兼容 /beta/ 和 tools/ 冒烟页面。
  const assetBase = root.document && root.document.currentScript && root.document.currentScript.src
    ? new URL('../', root.document.currentScript.src).href : null;

  root.MIXX_NO_DEMO = true; // 停用引擎演示模式，本文件接管游戏循环

  const engine = root.MIXX && root.MIXX.engine;
  if (!engine) {
    throw new Error('MIXX.main: 未找到 MIXX.engine，请确认 js/engine.js 先于本文件加载');
  }

  const TILE = engine.TILE;
  const VIEW_W = engine.VIEW_W;
  const VIEW_H = engine.VIEW_H;
  const PLAYER_SIZE = 16;      // 玩家碰撞盒边长（px）
  const MOVE_SPEED = 80;       // px/s
  const INTERACT_RANGE = 24;   // 互动距离（px）
  // 碰撞与机关判定统一走 engine.Mechanics（#9）：墙/水、关闭的门、箱子均阻挡。

  /* 说话人头像位（Issue #28）：素材规范见 assets/characters/README.md */
  const PORTRAIT_BASE = 'assets/characters/';
  const PORTRAIT_NO_ART = { nar: true, all: true }; // 伪说话人无立绘（GAME_DESIGN §3）

  /* HUD 带：位于游戏画面上方（styles.css #stage 竖排），渲染器缩放时
     预留状态与目标两行共 44px，保证 HUD 不压进游戏画面 */
  const HUD_RESERVE = 44;

  // ── 对话系统（Issue #7，规格 GAME_DESIGN.md §7）──
  const DIALOG_MS = 25;           // 打字机逐字间隔（25ms/字）
  const DIALOG_FAST_MS = 6;       // 按住互动键加速打字间隔（快进）
  const DIALOG_TAP_MS = 250;      // 按住时长阈值：短于此的「点按」→ 立即显示本行全文
  const DIALOG_HINT_TYPING = '▸▸ 快进';   // 打字中的提示
  const DIALOG_HINT_PAGE = '▼ E / 空格'; // 本行显示完、等待翻页的提示

  /* 实体绘制层次（#9）：地垫在最下、门其次、箱子/角色/星星等在最上，
     避免礼物盒压上开关时被开关贴图盖住（数据顺序不承担绘制层次） */
  const ENTITY_DRAW_LAYER = { switch: 1, gate: 2 };
  const ENTITY_DRAW_LAYER_DEFAULT = 3;

  /* ════════════════════════ 状态常量 ════════════════════════ */

  const STATE = {
    TITLE: 'title',
    PLAYING: 'playing',
    DIALOGUE: 'dialogue',
    PAUSED: 'paused',
    CLEAR: 'clear',
    ENDING: 'ending',
  };

  /* ════════════════════════ 占位数据（data.js 就位前兜底） ════════════════════════ */

  const BOOT_CHARACTERS = {
    byeori: { name: 'Byeori', color: '#FFD700' },
    nar: { name: '', color: '#C0C0C0' }, // 旁白：不显示姓名标签，文字灰色
  };

  const BOOT_DIALOGUE = {
    'boot.hi': {
      lines: [
        { s: 'byeori', t: 'NSWER！欢迎来到 MIXXTOPIA！我是星星精灵 Byeori。' },
        { s: 'byeori', t: '这是状态机占位演示：走过去碰到星星即可收集，集齐后传送门会亮起来。' },
        { s: 'nar', t: '（旁白样式示例：不显示姓名标签。正式文案由 Issue #12 接入。）' },
      ],
    },
  };

  const BOOT_ENDING = [
    '25 颗愿望之星全部归位，许愿蛋糕被逐层点亮。',
    '灵感之泉重新涌流，化作一条星光河……',
    '（结局演出占位：正式演出由 Issue #12/#15 接入）',
  ];

  /**
   * 占位关卡 ×2：复用引擎演示地形（js/engine.js demoLevel），
   * 关 1 带「礼物盒 → 压力开关 → 门」闭环与 ★3 门后星，用于 #9 验收；
   * 关 2 维持最小配置验证换关/结局。Issue #11 地图落地后本函数整体移除。
   */
  function buildBootLevels() {
    const map = engine.demoLevel.map;
    return [
      {
        id: 1,
        title: '占位关卡 · 烛光梦境',
        region: '占位',
        palette: { bg: '#1A1033', cream: '#F7E8C8', gold: '#FFC857', pink: '#FF8FA3' },
        map: map,
        entities: [
          { type: 'spawn', x: 2, y: 26 },
          { type: 'star', id: 's1', x: 8, y: 20 },
          { type: 'star', id: 's2', x: 25, y: 14 },
          { type: 'star', id: 's3', x: 33, y: 7 },
          { type: 'npc', id: 'byeori', x: 10, y: 15, dialogue: 'boot.hi' },
          // #18 战斗占位敌人：路径上 2 只梦蚀团 + 门后 1 只梦蚀灵（不影响原有星星/机关布局）
          { type: 'enemy', id: 'e1', kind: 'dreamling', x: 14, y: 19 },
          { type: 'enemy', id: 'e2', kind: 'dreamling', x: 23, y: 13 },
          { type: 'enemy', id: 'e3', kind: 'wisp', x: 34, y: 8 },
          // #9 机关闭环：把礼物盒推上彩色地垫 → 折叠屏风门打开 → 进入小屋取 ★3
          { type: 'box', id: 'box1', x: 32, y: 12 },
          { type: 'switch', id: 'sw1', x: 33, y: 12, target: 'gate1' },
          { type: 'gate', id: 'gate1', x: 33, y: 10, open: false },
          { type: 'portal', x: 38, y: 10, to: 2 },
        ],
      },
      {
        id: 2,
        title: '占位关卡 · 疾风终章',
        region: '占位',
        palette: { bg: '#0E1420', cream: '#F7E8C8', gold: '#FF7A00', pink: '#FFD166' },
        map: map,
        entities: [
          { type: 'spawn', x: 2, y: 26 },
          { type: 'star', id: 't1', x: 8, y: 20 },
          { type: 'star', id: 't2', x: 33, y: 7 },
          { type: 'npc', id: 'byeori', x: 21, y: 14, dialogue: 'boot.hi' },
          { type: 'enemy', id: 'e4', kind: 'dreamling', x: 14, y: 19 },
          { type: 'enemy', id: 'e5', kind: 'wisp', x: 24, y: 13 },
          { type: 'portal', x: 38, y: 10 },
        ],
      },
    ];
  }

  /** 内容逐步接入：地图为空时仅回退地图，保留已就位的场景与台词。 */
  function loadData(root) {
    const g = root.GAME || {};
    const hasLevels = Array.isArray(g.levels) && g.levels.length > 0;
    return {
      levels: hasLevels ? g.levels : buildBootLevels(),
      scenes: g.scenes || {},
      characters: Object.assign({}, BOOT_CHARACTERS, g.characters || {}),
      dialogue: Object.assign({}, BOOT_DIALOGUE, g.dialogue || {}),
      source: hasLevels ? 'data' : 'boot',
    };
  }

  /** 秒 → 'm:ss'（结算用时展示） */
  function formatTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  /* ════════════════════════ 存档（Issue #8，规范 GAME_DESIGN.md §10） ════════════════════════ */

  // 发布通道（#17）：构建时由 js/channel.js 注入 MIXXTOPIA_CHANNEL，
  // 并在 index.html 写 meta 兜底（脚本加载失败也能识别通道）。
  // stable / beta / preview 同源（同一个 Pages 域名），localStorage 共享；
  // beta/preview 必须用独立键，避免测试存档覆盖正式存档。stable 保持历史键不变。
  const CHANNELS = ['stable', 'beta', 'preview'];

  /** 解析构建注入的发布通道；缺失或未知值一律回退 stable。 */
  function resolveChannel(host) {
    try {
      const name = host && host.MIXXTOPIA_CHANNEL;
      if (CHANNELS.indexOf(name) >= 0) return name;
      // 兜底：构建时写入的 meta 标签，channel.js 加载失败也能识别通道。
      const doc = host && host.document;
      if (doc && typeof doc.querySelector === 'function') {
        const meta = doc.querySelector('meta[name="mixxtopia-channel"]');
        const content = meta && typeof meta.getAttribute === 'function'
          ? meta.getAttribute('content')
          : '';
        if (CHANNELS.indexOf(content) >= 0) return content;
      }
    } catch (e) { /* 回退 stable */ }
    return 'stable';
  }

  /** 通道存储键：stable 使用原键，beta/preview 追加 .<channel>。 */
  function channelKeys(channel) {
    const name = CHANNELS.indexOf(channel) >= 0 ? channel : 'stable';
    const suffix = name === 'stable' ? '' : '.' + name;
    return {
      saveKey: 'mixxtopia.save' + suffix + '.v1',
      settingsKey: 'mixxtopia.settings' + suffix + '.v1',
      accountKey: 'mixxtopia.account' + suffix + '.v1',
      cloudKey: 'mixxtopia.cloud' + suffix + '.v1',
      statsKey: 'mixxtopia.stats' + suffix + '.v1',
    };
  }

  const CHANNEL = resolveChannel(root);
  const CHANNEL_KEYS = channelKeys(CHANNEL);
  const SAVE_KEY = CHANNEL_KEYS.saveKey;        // { v, slots: [slot|null ×3] }
  const SETTINGS_KEY = CHANNEL_KEYS.settingsKey; // { v, sound, touch } 独立于存档位
  const ACCOUNT_KEY = CHANNEL_KEYS.accountKey;   // #43 会话键（stable 为 mixxtopia.account.v1）
  const SAVE_VERSION = 1;
  const SLOT_COUNT = 3;

  /* ── 账户资料（Issue #44）：js/account.js 未加载时账户设置降级关闭 ── */

  /** js/account.js 暴露的 MIXX.account（测试/构建缺失时为 null，标题/存档不受影响） */
  function accountModule() {
    return (root.MIXX && root.MIXX.account) || null;
  }

  /** 触屏按键显示偏好取值（与 js/account.js 的 TOUCH_VALUES 一致） */
  function touchModeList() {
    const mod = accountModule();
    return mod && Array.isArray(mod.TOUCH_VALUES) ? mod.TOUCH_VALUES : ['auto', 'on', 'off'];
  }

  /** 归一化触屏按键偏好；非法值按 auto（跟随设备检测） */
  function normalizeTouchMode(value) {
    const list = touchModeList();
    return list.indexOf(value) >= 0 ? value : 'auto';
  }

  /** 触屏按键偏好中文标签 */
  function touchModeLabel(mode) {
    if (mode === 'on') return '常开';
    if (mode === 'off') return '关闭';
    return '自动';
  }

  /** 头像固定选项集（唯一事实源：js/data.js 的 GAME.avatarPresets） */
  function avatarPresetsFor(host) {
    const mod = accountModule();
    if (mod && typeof mod.avatarPresets === 'function') return mod.avatarPresets(host || root);
    return [{ id: 'muse-1', name: 'Lily', color: '#7FB8E6' }];
  }

  /** 默认头像 id（js/account.js 的 DEFAULT_AVATAR，与数据库 default 一致） */
  function defaultAvatarId() {
    const mod = accountModule();
    return mod && typeof mod.DEFAULT_AVATAR === 'string' ? mod.DEFAULT_AVATAR : 'muse-1';
  }

  /** 头像 id 是否在固定白名单中（未加载 account.js 时只认默认头像） */
  function avatarAllowed(id) {
    const mod = accountModule();
    if (mod && typeof mod.isAvatarAllowed === 'function') return mod.isAvatarAllowed(id, root);
    return id === defaultAvatarId();
  }

  /** 昵称校验（1–16 字，trim；account.js 未加载时用等价兜底逻辑） */
  function normalizeNicknameForSave(raw) {
    const mod = accountModule();
    if (mod && typeof mod.normalizeNickname === 'function') return mod.normalizeNickname(raw);
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return { ok: false, code: 'empty_nickname', message: '昵称不能为空' };
    if (Array.from(value).length > 16) {
      return { ok: false, code: 'long_nickname', message: '昵称最多 16 字' };
    }
    return { ok: true, value };
  }

  /** 偏好归一化（只保留 sound/touch；account.js 未加载时用等价兜底逻辑） */
  function normalizePrefsForSave(raw) {
    const mod = accountModule();
    if (mod && typeof mod.normalizePrefs === 'function') return mod.normalizePrefs(raw);
    const src = raw && typeof raw === 'object' ? raw : {};
    return { sound: src.sound !== false, touch: normalizeTouchMode(src.touch) };
  }

  /** 昵称按 Unicode 码点计字（emoji 算 1 字；account.js 未加载时兜底） */
  function nicknameCharLength(value) {
    const mod = accountModule();
    if (mod && typeof mod.charLength === 'function') return mod.charLength(value);
    return Array.from(typeof value === 'string' ? value : '').length;
  }

  const AVATAR_DEFAULT = defaultAvatarId();

  /** 取 localStorage；隐私模式/被禁用等访问异常按不可用处理（返回 null） */
  function resolveStorage(host) {
    try {
      const s = host && host.localStorage;
      if (s && typeof s.getItem === 'function' && typeof s.setItem === 'function') return s;
    } catch (e) { /* 访问被拒绝：按不可用处理 */ }
    return null;
  }

  /** 空存档位（新游戏开局时内存中的初始态；首次保存前不写盘） */
  function emptySlot(index, levelId) {
    return {
      v: SAVE_VERSION,
      slot: index + 1,
      current: levelId,
      unlocked: levelId,
      cleared: [],
      stars: {},
      sheep: 0,
      played: [],
      updatedAt: 0,
    };
  }

  /** 深拷贝存档位（读档后运行时修改不污染 store 缓存/原始对象） */
  function cloneSlot(slot) {
    const stars = {};
    for (const key in slot.stars) {
      if (Object.prototype.hasOwnProperty.call(slot.stars, key)) stars[key] = slot.stars[key].slice();
    }
    return {
      v: SAVE_VERSION,
      slot: slot.slot,
      current: slot.current,
      unlocked: slot.unlocked,
      cleared: slot.cleared.slice(),
      stars: stars,
      sheep: slot.sheep,
      played: slot.played.slice(),
      updatedAt: slot.updatedAt,
    };
  }

  /** 校验并规范化存档位；结构不可识别返回 null（按空档处理，不覆盖原始数据） */
  function normalizeSlot(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const current = Math.floor(Number(raw.current));
    if (!isFinite(current) || current <= 0) return null;
    const stars = {};
    if (raw.stars && typeof raw.stars === 'object' && !Array.isArray(raw.stars)) {
      for (const key in raw.stars) {
        if (!Object.prototype.hasOwnProperty.call(raw.stars, key)) continue;
        if (Array.isArray(raw.stars[key])) {
          stars[key] = raw.stars[key].filter((id) => typeof id === 'string');
        }
      }
    }
    const cleared = Array.isArray(raw.cleared)
      ? raw.cleared.map(Number).filter((n) => isFinite(n) && n > 0)
      : [];
    const unlocked = Math.max(1, Math.floor(Number(raw.unlocked)) || 1);
    return {
      v: SAVE_VERSION,
      slot: index + 1,
      current: current,
      unlocked: Math.max(unlocked, current),
      cleared: cleared,
      stars: stars,
      sheep: Math.max(0, Math.floor(Number(raw.sheep)) || 0),
      played: Array.isArray(raw.played) ? raw.played.filter((id) => typeof id === 'string') : [],
      updatedAt: Number(raw.updatedAt) || 0,
    };
  }

  /**
   * 3 存档位的读写封装：所有解析/校验集中在此，损坏数据不抛错（按空档处理）。
   * 浏览器禁用 localStorage 时 storage 为 null，读返回空档、写返回 false。
   */
  class SaveStore {
    constructor(storage) {
      this.storage = storage || null;
      this.corrupt = false; // 最近一次读取是否遇到非法数据（供 UI 提示）
    }

    get available() { return !!this.storage; }

    _blankSlots() { return [null, null, null]; }

    /** 全部存档位（长度恒为 SLOT_COUNT，空档为 null） */
    readAll() {
      this.corrupt = false;
      if (!this.storage) return this._blankSlots();
      let raw = null;
      try { raw = this.storage.getItem(SAVE_KEY); } catch (e) { return this._blankSlots(); }
      if (!raw) return this._blankSlots();
      let data = null;
      try { data = JSON.parse(raw); } catch (e) {
        this.corrupt = true;
        return this._blankSlots();
      }
      if (!data || data.v !== SAVE_VERSION || !Array.isArray(data.slots)) {
        this.corrupt = true;
        return this._blankSlots();
      }
      const slots = [];
      for (let i = 0; i < SLOT_COUNT; i++) slots.push(normalizeSlot(data.slots[i], i));
      return slots;
    }

    readSlot(index) {
      if (index < 0 || index >= SLOT_COUNT) return null;
      return this.readAll()[index];
    }

    /** updatedAt 最新的存档位 { index, slot }；无存档返回 null */
    latest() {
      const slots = this.readAll();
      let best = null;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s) continue;
        if (!best || s.updatedAt >= best.slot.updatedAt) best = { index: i, slot: s };
      }
      return best;
    }

    hasAny() {
      return this.readAll().some(Boolean);
    }

    /** 写入单个存档位；失败（无存储/配额/序列化）返回 false */
    writeSlot(index, slot) {
      if (!this.storage || index < 0 || index >= SLOT_COUNT) return false;
      const normalized = normalizeSlot(slot, index);
      if (!normalized) return false;
      const slots = this.readAll();
      slots[index] = normalized;
      try {
        this.storage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, slots: slots }));
        return true;
      } catch (e) {
        return false;
      }
    }

    /** 清空单个存档位（标题「选择存档」删除）；已被清空视为成功 */
    clearSlot(index) {
      if (index < 0 || index >= SLOT_COUNT) return false;
      const slots = this.readAll();
      if (!slots[index]) return true;
      slots[index] = null;
      if (!this.storage) return false;
      try {
        this.storage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, slots: slots }));
        return true;
      } catch (e) {
        return false;
      }
    }
  }

  /* ════════════════════════ 游戏主类 ════════════════════════ */

  class Game {
    /**
     * @param {HTMLCanvasElement} canvas  #game
     * @param {object} [opts]  { doc, root, onEvent, storage, auth, profile, cloud, fetch }
     *   onEvent(name, data)：测试/冒烟钩子，'state' | 'collect' | 'clear' | 'restart' | 'save'
     *     | 'push' | 'switch' | 'gate' | 'portal' | 'portal-enter'（#9 机制事件）
     *     | 'profile'（#44 账户资料 load/save 成功与失败）
     *     | 'attack' | 'enemy-hit' | 'enemy-down' | 'player-hit' | 'player-down' | 'energy-full'（#18 战斗）
     *   storage：可注入的 localStorage 兼容对象（测试用）；传 null 模拟存储不可用
     *   auth：可注入的账户客户端（测试用）；传 null 关闭登录入口
     *   profile：可注入的 profiles 客户端（测试用）；传 null 关闭账户设置（登录入口仍在）
     *   cloud：可注入的 SaveSync；传 null 关闭云存档，不影响本地存档
   *   fetch：传给默认 auth/account/cloud 客户端的 fetch 桩（测试用）
     */
    constructor(canvas, opts) {
      opts = opts || {};
      this.doc = opts.doc || (typeof document !== 'undefined' ? document : null);
      this.root = opts.root || root;
      this.onEvent = opts.onEvent || null;

      this.canvas = canvas;
      this.renderer = engine.createRenderer(canvas, { hudReserve: HUD_RESERVE, detailScale: opts.renderDetailScale || 3 });
      this.camera = engine.createCamera();
      this.input = engine.createInput();

      const data = loadData(this.root);
      this.levels = data.levels;
      this.scenes = data.scenes;
      this.scene = null;       // 独立序章，不计入关卡、星数或关卡用时
      this._sceneImages = new Map();
      this._sceneryImages = new Map();
      for (const id of Object.keys(this.scenes)) {
        const scene = this.scenes[id];
        if (scene.background && typeof this.root.Image === 'function') {
          const img = new this.root.Image();
          img.src = scene.background;
          this._sceneImages.set(id, img); // 提前加载；失败时台词仍可完整播放
        }
      }
      if (typeof this.root.Image === 'function') {
        for (const level of this.levels) {
          for (const src of Object.values(level.sceneryAssets || {})) {
            if (this._sceneryImages.has(src)) continue;
            const img = new this.root.Image();
            img.src = src;
            this._sceneryImages.set(src, img);
          }
        }
      }
      this.characters = data.characters;
      this.dialogue = data.dialogue;
      this.dataSource = data.source;

      // 存档（Issue #8）：3 档位；opts.storage 显式传入时优先（含 null = 存储不可用）
      this.storage = Object.prototype.hasOwnProperty.call(opts, 'storage')
        ? opts.storage
        : resolveStorage(this.root);
      this.store = new SaveStore(this.storage);
      this.saveSlotIndex = -1;  // 当前存档位下标（0–2）；-1 = 未绑定
      this.saveData = null;     // 当前存档位的内存态（只在保存/自动存档时写盘）
      this._saveMode = 'load';  // 选择存档界面模式：'load' | 'overwrite'
      this._pendingOverwrite = -1; // 覆盖模式下的待确认档位
      this._pendingDelete = -1;    // 待确认删除的档位（二次点击生效）
      this._settings = this._readSettings();
      this.soundOn = this._settings.sound !== false;
      this._cloudPrefs = null;      // 最近一次从云端拿到的偏好（#44）
      this._cloudPrefsDiffer = false; // 云端偏好与本机不同（设置页提示「保存后以本机为准」）

      // 账户（Issue #43）：默认用 js/auth.js 创建客户端；opts.auth 注入用于测试/冒烟，
      // 显式传 null 表示关闭账户入口（游客态与 #8 完全一致）。
      this.auth = this._createAuth(opts);
      this._authReady = null;     // 启动时 restore() 的 Promise（测试可 await）
      this._authPromise = null;   // 最近一次登录/注册/登出 Promise（防重复提交）
      this._authBusy = false;
      this._authUnsubscribe = null;
      this._authOffline = false;  // restore 遇到网络/服务端失败：标题提示「云端暂不可用」
      this._passwordPromise = null;
      this._passwordBusy = false;
      this._passwordEpoch = 0;
      this._passwordUserId = '';
      this._destroyed = false;   // destroy() 后异步 auth 回调不再动 DOM

      // 账户资料 / 设置（Issue #44）：profiles 表读写由 js/account.js 负责；
      // opts.profile 注入用于测试/冒烟，显式传 null 关闭账户设置（登录/存档不受影响）。
      this.account = this._createAccount(opts);
      this.cloud = this._createCloud(opts);
      this._cloudTask = null;
      this._cloudConfirm = null;
      this.stats = this._createStats(opts);
      this._statsTask = null;
      this.profile = null;          // { nickname, avatar, prefs }（云端资料；游客为 null）
      this.profileError = null;     // 最近一次资料加载/保存失败（错误对象）
      this._profileUserId = '';     // profile 对应的 user id；会话切换时重新加载
      this._profilePromise = null;  // 资料加载 Promise（防重复请求）
      this._profileUid = '';        // 该 Promise 对应的 user id（切号时旧请求不阻塞新加载）
      this._profileTask = null;     // 最近一次资料加载 Promise（测试/冒烟等待用，不置空）
      this._accountPromise = null;  // 设置保存 Promise（防重复提交）
      this._accountBusy = false;
      this._selectedAvatar = '';    // 设置界面待保存头像（空 = 跟随 profile / 默认头像）
      this._avatarTouched = false;  // 玩家是否主动改过头像（决定保存时是否回写 avatar）

      // 运行态（可在测试中直接读取）
      this.state = null;
      this.levelIndex = 0;
      this.level = null;       // 当前关数据（实体层为运行时克隆）
      this.player = null;      // { x, y } 世界坐标（px，左上角）
      this.stars = 0;          // 本关已收集星数
      this.collected = [];     // 本关已收集星 id（运行时记录）
      this.runTime = 0;        // 本关用时（秒，仅 PLAYING 累计）
      this._dialog = null;     // 对话进行态 { lines, idx, shown, t, typing, holdTyping, holdTime }，离开对话态即清空
      this.particles = engine.createParticles(); // #9 拾取/传送门粒子
      this.mechanics = null;   // #9 每关机制辅助（碰撞/推箱/开关门）
      this.combat = null;      // #18 每关战斗辅助（HP/能量/敌人 AI/攻击判定）
      this._hudEnergyPct = -1; // HUD 缓存：避免每帧重复写 DOM
      this._hudHp = -1;
      this._hudEnergyReady = false;
      this._portalWasActive = false; // 传送门激活演出只在「从未激活 → 激活」时播一次
      this._playedNodes = new Set(); // 已播放过的 once 节点（随存档 slot.played 持久化）
      this._npcTarget = {};   // <关卡id>:<实体id> → 开场 intro 结束后指向的后续节点（hint）
      this.sheepCount = 0;    // 黑羊彩蛋计数 0–6（随存档持久化）
      this.carriedBox = null;
      this.facing = { x: 0, y: -1 };
      this._pendingNextIsEnding = false; // 结算按钮指向结局（最后一关）
      this._pendingNextUnavailable = false; // 显式出口指向尚未制作的关卡
      this._pendingNextIndex = -1;       // 结算后要进入的关卡下标（portal.to 或下一关）
      this._portraitSrc = null;          // 头像当前 src 缓存（避免重复赋值导致闪动）
      this._failedPortraits = new Set(); // 加载失败的路径，后续渲染保持隐藏

      this._last = 0;          // 上一帧时间戳（ms）
      this._raf = null;        // rAF 句柄，防重复启动
      this._running = false;   // start() 后为 true，stop()/destroy() 停
      this._ui = {};           // id → DOM 元素缓存
      this._uiHandlers = [];   // [el, type, fn] 三元组，供 destroy 解绑

      this._cacheUI();
      this._renderAvatarOptions(); // #44：按 GAME.avatarPresets 动态渲染头像按钮
      this._bindUI();
      this.input.setTouchMode(this._settings.touch); // #44：恢复触屏按键偏好
      this._applySoundState();
      this._setState(STATE.TITLE);
      if (this.stats) this._statsTask = this.stats.connect('');
      this._initAuth();
    }

    /* ── 游戏循环 ── */

    /** 启动 rAF 循环；重复调用不会叠加第二个循环 */
    start() {
      if (this._raf !== null) return;
      this._running = true;
      this._last = 0;
      const tick = (ts) => {
        if (!this._running) return;
        this._raf = this.root.requestAnimationFrame(tick);
        this.frame(ts);
      };
      this._raf = this.root.requestAnimationFrame(tick);
    }

    /** 停循环（保留当前状态，测试/冒烟手动驱动帧时使用） */
    stop() {
      this._running = false;
      if (this._raf !== null && typeof this.root.cancelAnimationFrame === 'function') {
        this.root.cancelAnimationFrame(this._raf);
      }
      this._raf = null;
    }

    /**
     * 单帧推进：更新 + 渲染 + 输入边沿清空。
     * 由 rAF 调用；测试可手动传递增时间戳调用。
     */
    frame(ts) {
      const t = Number(ts) || 0;
      const dt = this._last ? Math.min(0.05, Math.max(0, (t - this._last) / 1000)) : 0.016;
      this._last = t;
      this._update(dt);
      this._render();
      this.input.endFrame();
    }

    /** 解绑全部 UI 监听并释放输入与渲染器；此后不再产生任何效果 */
    destroy() {
      this.stop();
      this._destroyed = true;
      this._resetPasswordForm();
      // 对话态下销毁时，对话框与背景虚化层只在 _leaveState(DIALOGUE) 隐藏；
      // 这里显式清理，避免复用同一 DOM 时残留暗化/模糊遮罩（PR #33 评审）
      this._hide(this._ui.dialog);
      this._hide(this._ui.dialogBackdrop);
      if (this._ui.dialogBackdrop) this._ui.dialogBackdrop.classList.remove('scene-art');
      this._hide(this._ui.saveScreen); // 销毁时复用的 DOM 不残留选择存档界面
      this._hide(this._ui.loginScreen); // #43：登录界面同样不残留
      this._hide(this._ui.settingsScreen); // #44：账户设置界面同样不残留
      this._hide(this._ui.accountNote);
      if (typeof this._authUnsubscribe === 'function') {
        try { this._authUnsubscribe(); } catch (e) { /* 忽略取消订阅异常 */ }
      }
      this._authUnsubscribe = null;
      if (this.cloud) this.cloud.destroy();
      if (this.stats) this.stats.destroy();
      for (let i = 0; i < this._uiHandlers.length; i++) {
        const el = this._uiHandlers[i][0];
        const type = this._uiHandlers[i][1];
        const fn = this._uiHandlers[i][2];
        if (el && typeof el.removeEventListener === 'function') el.removeEventListener(type, fn);
      }
      this._uiHandlers = [];
      this.input.destroy();
      this.renderer.destroy();
    }

    /* ── 状态机 ── */

    /** 唯一状态切换入口：先清理旧态、再初始化新态 */
    _setState(next) {
      if (next === this.state) return;
      if (next !== STATE.TITLE) this._resetPasswordForm();
      const prev = this.state;
      if (this.stats && prev === STATE.PLAYING) this.stats.flush();
      this._leaveState(prev);
      this.state = next;
      this._enterState(next);
      if (this.onEvent) {
        try { this.onEvent('state', { from: prev, to: next }); } catch (e) { /* 钩子异常不阻断游戏 */ }
      }
    }

    _enterState(s) {
      switch (s) {
        case STATE.TITLE:
          this._show(this._ui.titleScreen);
          this._hide(this._ui.hud);
          this.input.setEnabled(false);
          this.input.setTouchVisible(false);
          this._refreshTitle(); // 继续按钮：取决于是否存在存档
          break;
        case STATE.PLAYING:
          this._hideAllScreens();
          this._show(this._ui.hud);
          this._refreshHud();
          this.input.setEnabled(true);
          this.input.setTouchVisible(true);
          break;
        case STATE.DIALOGUE:
          // HUD 保持可见（对话仍在关卡内）；输入保持启用（confirm 快进/翻页）
          this._show(this._ui.dialog);
          this._show(this._ui.dialogBackdrop); // 背景虚化：只突出对话框与头像
          if (this._ui.dialogBackdrop) this._ui.dialogBackdrop.classList.toggle('scene-art', !!this.scene);
          break;
        case STATE.PAUSED:
          this._show(this._ui.pauseScreen);
          this._hide(this._ui.hud);
          this._text(this._ui.pauseNote, ''); // 清掉上次的保存失败提示
          this.input.setEnabled(true);   // Esc 继续
          this.input.setTouchVisible(false);
          break;
        case STATE.CLEAR:
          this._show(this._ui.clearScreen);
          this._hide(this._ui.hud);
          this.input.setEnabled(false);
          this.input.setTouchVisible(false);
          break;
        case STATE.ENDING:
          this._show(this._ui.endingScreen);
          this._hide(this._ui.hud);
          this.input.setEnabled(false);
          this.input.setTouchVisible(false);
          break;
        default:
          break;
      }
    }

    _leaveState(s) {
      switch (s) {
        case STATE.TITLE:
          this._hide(this._ui.titleScreen);
          break;
        case STATE.PLAYING:
          break; // HUD 由目标状态决定显隐
        case STATE.DIALOGUE:
          this._hide(this._ui.dialog);
          this._hide(this._ui.dialogBackdrop);
          if (this._ui.dialogBackdrop) this._ui.dialogBackdrop.classList.remove('scene-art');
          this._clearDialog();
          this._dialog = null;
          break;
        case STATE.PAUSED:
          this._hide(this._ui.pauseScreen);
          this._text(this._ui.pauseNote, '');
          break;
        case STATE.CLEAR:
          this._hide(this._ui.clearScreen);
          this._text(this._ui.clearText, '');
          break;
        case STATE.ENDING:
          this._hide(this._ui.endingScreen);
          this._setEndingBody([]);
          break;
        default:
          break;
      }
    }

    /* ── 每帧更新 ── */

    _update(dt) {
      if (this.doc && this.doc.hidden) return;
      if (this.level && this._entryFade > 0) this._entryFade = Math.max(0, this._entryFade - dt);
      switch (this.state) {
        case STATE.PLAYING:
          this._updatePlaying(dt);
          break;
        case STATE.DIALOGUE:
          this._updateDialog(dt);
          break;
        case STATE.PAUSED:
          if (this.input.wasPressed('pause')) this._setState(STATE.PLAYING);
          break;
        default:
          break; // TITLE/CLEAR/ENDING：输入已禁用，由按钮驱动
      }
      // 粒子只在游玩/对话中推进（暂停、结算、标题冻结/清空，避免跨状态残留）
      if (this.state === STATE.PLAYING || this.state === STATE.DIALOGUE) {
        this.particles.update(dt);
      }
      if (this.input.wasPressed('mute')) this._toggleSound();
    }

    _updatePlaying(dt) {
      if (this.input.wasPressed('pause')) { this._setState(STATE.PAUSED); return; }
      if (this.birthday && this.birthday.rings) {
        this.birthday.updateRings(dt);
        if (this.state === STATE.PLAYING) {
          this.runTime += dt;
          if (this.stats) this.stats.tick(dt);
        }
        return;
      }
      if (this.birthday) this.birthday.update(dt);
      this._syncProgressLocks();
      if (this._checkTriggers()) return;
      const axis = this.input.getAxis();
      const beforeMove = { x: this.player.x, y: this.player.y };
      if (this.combat && (axis.x || axis.y)) this.combat.face(axis.x, axis.y);
      // #18 攻击：F 轻击 / G 重击；能量满时两者都由 Combat 升级为能量炮
      const light = this.input.wasPressed('light');
      const heavy = this.input.wasPressed('heavy');
      if (light || heavy) this._playerAttack(heavy ? 'heavy' : 'light');
      if (this.input.wasPressed('confirm') && this._interact()) return; // 进入对话
      if (axis.x) this._moveAxis(axis.x * MOVE_SPEED * dt, 0);
      if (axis.y) this._moveAxis(0, axis.y * MOVE_SPEED * dt);
      if (this.birthday) this.birthday.updatePlayer(this.player.x - beforeMove.x, this.player.y - beforeMove.y, dt);
      this._syncSwitches();
      // 战斗推进：能量回复 / 敌人追击 / 接触伤害（对话与暂停期间冻结）
      if (this.combat) {
        const events = this.combat.update(dt, this.player, this.mechanics);
        if (events.length) this._handleCombatEvents(events);
        this._refreshCombatHud();
      }
      this._followCamera();
      this._checkPickups();
      if (this.state !== STATE.PLAYING) return; // 收集触发台词进入对话，本帧不再推进
      this._syncProgressLocks();
      if (this._checkTriggers()) return;
      this._checkRoomDoors();
      this._checkPortal();
      if (this.state !== STATE.PLAYING) return; // 过关台词进入对话，本帧不再计时
      this.runTime += dt;
      if (this.stats) this.stats.tick(dt);
    }

    /* ── 战斗（Issue #18） ── */

    /**
     * 玩家攻击入口：Combat 统一判定轻击/重击/能量炮，main 只负责反馈与事件。
     * @param {'light'|'heavy'} kind
     */
    _playerAttack(kind) {
      if (!this.combat || !this.player) return null;
      const result = this.combat.attack(kind, this.player, this.mechanics);
      if (!result) return null;
      const sfx = result.cannon ? 'cannon' : (result.kind === 'heavy' ? 'heavy' : 'light');
      this._sfx(sfx);
      if (result.cannon || result.kind === 'heavy') {
        this.particles.burst(
          this.player.x + PLAYER_SIZE / 2 + result.dir.x * 10,
          this.player.y + PLAYER_SIZE / 2 + result.dir.y * 10,
          result.cannon
            ? { count: 14, colors: [[255, 200, 87], [255, 143, 163], [255, 255, 255]], speed: 80, life: 0.4, gravity: 0, size: 2 }
            : { count: 5, colors: [[255, 143, 163], [255, 200, 87]], speed: 44, life: 0.25, gravity: 30, size: 1 }
        );
      }
      for (let i = 0; i < result.hits.length; i++) {
        const hit = result.hits[i];
        const enemy = hit.enemy;
        const cx = enemy.x + enemy.size / 2;
        const cy = enemy.y + enemy.size / 2;
        if (hit.dead) {
          this.particles.burst(cx, cy, {
            count: 18,
            colors: [[180, 155, 255], [255, 143, 163], [94, 230, 184]],
            speed: 70, life: 0.65, gravity: 80, size: 2,
          });
          this._sfx('enemy-down');
          this._emit('enemy-down', {
            level: this.level.id, id: enemy.id, kind: enemy.kind,
            energy: result.energy,
          });
        } else {
          this.particles.burst(cx, cy, {
            count: 6,
            colors: [[255, 255, 255], [255, 200, 87]],
            speed: 46, life: 0.3, gravity: 40, size: 1,
          });
          this._sfx('hit');
          this._emit('enemy-hit', {
            level: this.level.id, id: enemy.id, kind: enemy.kind,
            hp: enemy.hp, damage: hit.damage,
          });
        }
      }
      if (result.energyFull) this._onEnergyFull();
      this._refreshCombatHud();
      this._emit('attack', {
        level: this.level.id,
        kind: result.kind,
        cannon: result.cannon,
        hits: result.hits.length,
        target: result.target,
        range: result.range,
        energy: result.energy,
      });
      return result;
    }

    /** 被动能量第一次攒满：音效 + 角色周围金色粒子 + HUD 脉冲 */
    _onEnergyFull() {
      if (!this.combat || !this.player) return;
      this._sfx('energy-full');
      this.particles.burst(
        this.player.x + PLAYER_SIZE / 2,
        this.player.y + PLAYER_SIZE / 2,
        { count: 12, colors: [[255, 200, 87], [255, 255, 255]], speed: 40, life: 0.5, gravity: 0, size: 2 }
      );
      this._emit('energy-full', { level: this.level.id });
    }

    /** 处理 Combat.update 返回的受击/倒下事件（击退、粒子、音效、复活） */
    _handleCombatEvents(events) {
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.type === 'energy-full') {
          this._onEnergyFull();
        } else if (ev.type === 'player-hit') {
          this._sfx('hurt');
          this.particles.burst(
            this.player.x + PLAYER_SIZE / 2,
            this.player.y + PLAYER_SIZE / 2,
            { count: 8, colors: [[255, 77, 109], [255, 143, 163]], speed: 52, life: 0.35, gravity: 70, size: 2 }
          );
          // 沿「敌人 → 玩家」方向击退；只做碰撞位移，不推箱/不改朝向
          const kb = ev.knockback || 0;
          if (kb) {
            this._knockPlayer(ev.dir.x * kb, 0);
            this._knockPlayer(0, ev.dir.y * kb);
          }
          this._refreshHud();
          this._refreshCombatHud();
          this._emit('player-hit', {
            level: this.level.id, hp: ev.hp, damage: ev.damage,
            enemy: ev.enemy && ev.enemy.id,
          });
          if (ev.hp <= 0) this._onPlayerDown(); // 同一帧的 player-down 事件不再重复处理
        }
      }
    }

    /** 受击击退：分轴检查地形，不触发推箱与朝向变化 */
    _knockPlayer(dx, dy) {
      if (!this.player || !this.mechanics) return;
      if (!dx && !dy) return;
      const p = this.player;
      if (!this.mechanics.blockedAt(p.x + dx, p.y, PLAYER_SIZE)) p.x += dx;
      if (!this.mechanics.blockedAt(p.x, p.y + dy, PLAYER_SIZE)) p.y += dy;
    }

    /**
     * 倒下：无惩罚复位到出生点，满血 + 无敌帧，敌人回出生点；
     * 已收集星星、用时与能量条保留（GAME_DESIGN §12「休闲难度、死亡无惩罚」）。
     */
    _onPlayerDown() {
      if (!this.combat || !this.player) return;
      const spawn = this._entitiesOf('spawn')[0] || { x: 2, y: 2 };
      this.player.x = spawn.x * TILE;
      this.player.y = spawn.y * TILE;
      this.combat.revive();
      this._sfx('player-down');
      this.particles.burst(
        this.player.x + PLAYER_SIZE / 2,
        this.player.y + PLAYER_SIZE / 2,
        { count: 16, colors: [[180, 155, 255], [255, 255, 255]], speed: 60, life: 0.6, gravity: 20, size: 2 }
      );
      this.camera.follow(
        this.player.x + PLAYER_SIZE / 2,
        this.player.y + PLAYER_SIZE / 2,
        this.level.map.w * TILE,
        this.level.map.h * TILE
      );
      this._refreshHud();
      this._emit('player-down', { level: this.level.id });
    }

    /* ── 碰撞、推箱与开关门（Issue #9） ── */

    /**
     * 分轴移动：撞墙本轴不动；撞到箱子时尝试推动一格。
     * 推箱成功时本帧玩家不前进，等箱子落位后再走，避免与箱子重叠。
     */
    _moveAxis(dx, dy) {
      if (!dx && !dy) return false;
      this.facing = { x: Math.sign(dx), y: Math.sign(dy) };
      const p = this.player;
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (!(this.birthday ? this.birthday.blockedAt(nx, ny) : this.mechanics.blockedAt(nx, ny, PLAYER_SIZE))) {
        p.x = nx;
        p.y = ny;
        return true;
      }
      const box = this.mechanics.pushBox(p.x, p.y, PLAYER_SIZE, dx, dy);
      if (!box) return false;
      // 推箱反馈：小尘屑 + 音效 + 立即同步开关（箱子可能正压上压力板）
      this.particles.burst(
        (box.x + 0.5) * TILE, (box.y + 0.5) * TILE,
        { count: 4, colors: [[240, 230, 210], [255, 143, 163]], speed: 22, life: 0.28, gravity: 60, size: 1 }
      );
      this._sfx('box');
      this._emit('push', { level: this.level.id, x: box.x, y: box.y });
      this._syncSwitches();
      return false;
    }

    /** 同步压力开关/门状态；silent 用于关卡载入时避免开场音效 */
    _syncSwitches(silent) {
      if (!this.mechanics || !this.player) return null;
      const result = this.mechanics.syncSwitches(this.player.x, this.player.y, PLAYER_SIZE);
      if (silent) return result;
      for (let i = 0; i < result.switches.length; i++) {
        const sw = result.switches[i];
        this._sfx('switch');
        this._emit('switch', { level: this.level.id, id: sw.id, pressed: sw.pressed });
      }
      for (let i = 0; i < result.gates.length; i++) {
        const g = result.gates[i];
        this._sfx(g.open ? 'gate-open' : 'gate-close');
        if (g.open) {
          // 门打开时在门框位置撒一点金光
          this.particles.burst(
            (g.gate.x + 0.5) * TILE, (g.gate.y + 0.5) * TILE,
            { count: 6, colors: [[255, 200, 87], [240, 230, 210]], speed: 30, life: 0.35, gravity: 40, size: 1 }
          );
        }
        this._emit('gate', { level: this.level.id, id: g.gate.id, open: g.open });
      }
      return result;
    }

    /** 本关星星是否已集齐且存在传送门（传送门激活条件） */
    _portalActive() {
      const total = this._starCount();
      return total > 0 && this.stars >= total && this._entitiesOf('portal').some(e => this._requirementsMet(e));
    }

    /** 从未激活到激活：粒子 + 音效 + 事件（每关只播一次） */
    _activatePortalIfReady() {
      if (this._portalWasActive || !this._portalActive()) return false;
      this._portalWasActive = true;
      const portal = this._entitiesOf('portal')[0];
      if (portal) {
        this.particles.burst(
          (portal.x + 0.5) * TILE, (portal.y + 0.5) * TILE,
          { count: 18, colors: [[255, 200, 87], [255, 143, 163], [240, 230, 210]], speed: 70, life: 0.8, gravity: 50, size: 2 }
        );
      }
      this._sfx('portal');
      this._emit('portal', { level: this.level.id, active: true });
      return true;
    }

    /* ── 互动 ── */

    /** 附近最近的可互动实体（NPC / 黑羊 / 告示牌）。 */
    _nearInteractable() {
      const cx = this.player.x + PLAYER_SIZE / 2;
      const cy = this.player.y + PLAYER_SIZE / 2;
      const area = this._currentArea();
      let nearest = null;
      let distance = Infinity;
      for (const type of ['door', 'record', 'gramophone', 'minigame', 'npc', 'guest', 'sheep', 'sign', 'box']) {
        for (const e of this._entitiesOf(type)) {
          if (area && e.room && e.room !== area.id) continue;
          if (e.carried || e.taken || (type === 'door' && e.open) || (type === 'box' && !e.carryable)) continue;
          if (type === 'npc' && this._resolveNpcNode(e, true) === null) continue;
          if (type === 'sheep' && (!this.dialogue[e.dialogue] || this._playedNodes.has(e.dialogue))) continue;
          const ex = e.x * TILE + TILE / 2;
          const ey = e.y * TILE + TILE / 2;
          const d = Math.abs(cx - ex) + Math.abs(cy - ey);
          if (d <= INTERACT_RANGE && d < distance && this._interactionVisible(e)) { nearest = e; distance = d; }
        }
      }
      return nearest;
    }

    /** 互动线不能穿过墙、家具或其他关闭的门；目标本身可以是门或箱子。 */
    _interactionVisible(entity) {
      const cx = this.player.x + PLAYER_SIZE / 2, cy = this.player.y + PLAYER_SIZE / 2;
      const dx = (entity.x + 0.5) * TILE - cx, dy = (entity.y + 0.5) * TILE - cy;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
      for (let i = 1; i < steps; i++) {
        const x = cx + dx * i / steps, y = cy + dy * i / steps;
        if (Math.floor(x / TILE) === Math.floor(entity.x) && Math.floor(y / TILE) === Math.floor(entity.y)) continue;
        if (this.mechanics.blockedAt(Math.floor(x), Math.floor(y), 1)) return false;
      }
      return true;
    }

    /** 确认键互动：NPC → 对话；黑羊 → 彩蛋谜语（首次计数 sheep +1）。返回是否触发了状态切换 */
    _interact() {
      if (!this.player) return false;
      if (this.carriedBox) return this._dropBox();
      const ent = this._nearInteractable();
      if (!ent) return false;
      if (this.birthday && this.birthday.interact(ent)) return true;
      if (ent.type === 'door') {
        if (!ent.open) { ent.open = true; this._sfx('gate-open'); this._emit('door', { id: ent.id }); }
        return true;
      }
      if (ent.type === 'record' || ent.type === 'gramophone') {
        this._syncProgressLocks();
        const say = text => this._playNode('music.hint', { node: { lines: [{ s: 'nar', t: text }] } });
        if (!this._requirementsMet(ent)) {
          say('先听完六位 Muse 的自我介绍，再找齐套圈摊位和杂物间的两颗星。唱片机还在等待大家的祝福。');
        } else if (ent.type === 'record') {
          this._playNode(ent.dialogue, { onEnd: () => { this._syncProgressLocks(); this._sfx('star'); this._emit('record', { id: ent.id }); } });
        } else if (this._playedNodes.has(ent.dialogue)) {
          say('《Strange Muse》唱片正在播放。向右走，穿过帷幕就到后台化妆间了。');
        } else if (!this._playedNodes.has(ent.recordNode)) {
          if (!this._playedNodes.has('l1.music.ready')) this._playNode('l1.music.ready');
          else say('去左上角的杂物间，按 E 取走《Strange Muse》唱片，再回来播放。');
        } else {
          this._playNode(ent.dialogue, { onEnd: () => {
            this._syncProgressLocks(); this._sfx('record-start'); this._sfx('gate-open'); this._emit('music', { id: ent.id, playing: true });
          } });
        }
        return true;
      }
      if (ent.type === 'box') {
        this._syncProgressLocks();
        if (ent.locked) { this._playNode('carry.locked', { node: { lines: [{ s: 'nar', t: '先完成这里的提示，才能搬动这个盒子。' }] } }); return true; }
        ent.carried = true;
        this.carriedBox = ent;
        this._syncSwitches();
        this._refreshHud();
        this._emit('carry', { id: ent.id, carried: true });
        return true;
      }
      if (ent.type === 'sign') {
        this._playNode('sign:' + ent.id, { node: { lines: [{ s: 'nar', t: ent.text }] } });
        return true;
      }
      if (ent.type === 'sheep') {
        // 黑羊：绑定节点为 once，首次互动播放并计数（集齐 6 句追加结局画面，演出接入 #15）
        const nodeId = ent.dialogue;
        const node = nodeId && this.dialogue[nodeId];
        if (!node || !node.lines || this._playedNodes.has(nodeId)) return false;
        this.sheepCount = (this.sheepCount || 0) + 1;
        this._playNode(nodeId);
        return true;
      }
      const nodeId = this._resolveNpcNode(ent);
      if (!nodeId) return false;
      this._playNode(nodeId);
      return true;
    }

    /** 收集星星：接触判定 + 金色粒子 + 音效 + star:<星id> 台词（#12） */
    _checkPickups() {
      const px = this.player.x;
      const py = this.player.y;
      for (const e of this._entitiesOf('star')) {
        if (e.collected || !this._starAvailable(e)) continue;
        const rx = e.x * TILE;
        const ry = e.y * TILE;
        if (px < rx + TILE && px + PLAYER_SIZE > rx && py < ry + TILE && py + PLAYER_SIZE > ry) {
          e.collected = true;
          this.collected.push(e.id);
          this.stars++;
          if (this.stats) {
            this.stats.unlock('first_star');
            if (this.stars >= this._starCount()) this.stats.unlock('wish_keeper');
          }
          // 拾取反馈（#9）：星星中心金色爆散 + 芯片音
          this.particles.burst(
            rx + TILE / 2, ry + TILE / 2,
            { count: 14, speed: 60, life: 0.6, gravity: 130, size: 2 }
          );
          this._sfx('star');
          this._refreshHud();
          this._emit('collect', { id: e.id, stars: this.stars });
          const activated = this._activatePortalIfReady();
          // 收集反馈台词（once）：进入对话则本帧停止继续收集，避免连吞台词
          if (this._dispatchAuto('star:' + e.id)) return;
          if (activated) return; // 同帧又激活传送门：仍按顺序，本帧到此为止
        }
      }
    }

    /** 条件星只在指定的自我介绍全部播完后出现；存档沿用 played，不添加新字段。 */
    _starAvailable(star) {
      return this._requirementsMet(star);
    }

    _requirementsMet(entity) {
      return (!entity.requiresStars || entity.requiresStars.every(id => this.collected.includes(id)))
        && (!entity.requiresDialogue || entity.requiresDialogue.every(id =>
          this._playedNodes.has(id) && (!this._dialog || this._dialog.nodeId !== id)));
    }

    _syncProgressLocks() {
      if (!this.level) return;
      for (const e of this.level.entities) {
        if (e.type === 'box') e.locked = !this._requirementsMet(e);
        if (e.type === 'switch') e.hidden = !this._requirementsMet(e);
        if (e.type === 'record') e.taken = this._playedNodes.has(e.dialogue)
          && (!this._dialog || this._dialog.nodeId !== e.dialogue);
        if (e.type === 'gate' && e.requiresDialogue) e.open = this._requirementsMet(e);
      }
    }

    _dropBox() {
      const p = this.player, b = this.carriedBox, d = this.facing;
      const tx = d.x > 0 ? Math.ceil((p.x + PLAYER_SIZE) / TILE)
        : d.x < 0 ? Math.floor((p.x - 1) / TILE) : Math.round(p.x / TILE);
      const ty = d.y > 0 ? Math.ceil((p.y + PLAYER_SIZE) / TILE)
        : d.y < 0 ? Math.floor((p.y - 1) / TILE) : Math.round(p.y / TILE);
      if (!this.mechanics._canPlaceBox(tx, ty, b)) {
        this._playNode('carry.blocked', { node: { lines: [{ s: 'nar', t: '这里会挡住通道、门口或落入死角。换一个空旷的位置，再按 E 放下。' }] } });
        return true;
      }
      b.x = tx; b.y = ty; b.carried = false;
      this.carriedBox = null;
      this._syncSwitches();
      this._refreshHud();
      this._emit('carry', { id: b.id, carried: false, x: tx, y: ty });
      return true;
    }

    _checkTriggers() {
      for (const e of this._entitiesOf('trigger')) {
        const node = this.dialogue[e.dialogue], r = e.rect;
        if (!node || !r || (node.once && this._playedNodes.has(e.dialogue)) || !this._requirementsMet(e)
          || (e.skipIfDialogue || []).some(id => this._playedNodes.has(id))) continue;
        if (this.player.x < (r.x + r.w) * TILE && this.player.x + PLAYER_SIZE > r.x * TILE
          && this.player.y < (r.y + r.h) * TILE && this.player.y + PLAYER_SIZE > r.y * TILE) {
          this._playNode(e.dialogue); return true;
        }
      }
      return false;
    }

    _currentArea() {
      const x = (this.player.x + 8) / TILE, y = (this.player.y + 8) / TILE;
      return (this.level.areas || []).find(a => {
        const r = a.bounds || a.rect; // 归属边界与允许看到草地的摄像机边界分开。
        return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
      });
    }

    _followCamera() {
      const area = this._currentArea(), r = area && area.rect;
      const ox = r ? r.x * TILE : 0, oy = r ? r.y * TILE : 0;
      this.camera.x -= ox; this.camera.y -= oy;
      this.camera.follow(this.player.x + 8 - ox, this.player.y + 8 - oy,
        (r ? r.w : this.level.map.w) * TILE, (r ? r.h : this.level.map.h) * TILE);
      this.camera.x += ox; this.camera.y += oy;
    }

    _checkRoomDoors() {
      for (const e of this._entitiesOf('roomdoor')) {
        const gate = this._entitiesOf('gate').find(g => g.x === e.x && g.y === e.y);
        if (gate && !gate.open) continue;
        if (this.mechanics.overlapsTile(this.player.x, this.player.y, PLAYER_SIZE, e.x, e.y)) {
          if (e.enterFrom === 'west' && this.facing.x <= 0) continue;
          this.player.x = e.to.x * TILE; this.player.y = e.to.y * TILE;
          if (e.arrivalNode) this._playedNodes.add(e.arrivalNode);
          if (e.fadeIn) this._entryFade = Number(this.level.entryFade) || 0;
          this._followCamera(); this._refreshHud();
          this._emit('room', { id: e.id }); return true;
        }
      }
      return false;
    }

    /** 集齐星星后传送门激活；接触传送门 → 先播过关台词（clear:<关卡id>，once），播完结算 */
    _checkPortal() {
      if (!this._portalActive()) return;
      const px = this.player.x;
      const py = this.player.y;
      for (const e of this._entitiesOf('portal')) {
        const rx = e.x * TILE;
        const ry = e.y * TILE;
        if (px < rx + TILE && px + PLAYER_SIZE > rx && py < ry + TILE && py + PLAYER_SIZE > ry) {
          this.particles.burst(
            rx + TILE / 2, ry + TILE / 2,
            { count: 20, colors: [[255, 200, 87], [255, 143, 163], [240, 230, 210]], speed: 78, life: 0.75, gravity: 30, size: 2 }
          );
          this._sfx('portal-enter');
          this._emit('portal-enter', { level: this.level.id });
          this._dispatchAuto('clear:' + this.level.id, () => this._onLevelClear());
          return;
        }
      }
    }

    /* ── 标题与存档（Issue #8） ── */

    /** 刷新标题按钮：有任一存档时才显示「继续冒险」，并同步账户入口文案 */
    _refreshTitle() {
      if (this.store.hasAny()) this._show(this._ui.btnContinue);
      else this._hide(this._ui.btnContinue);
      this._refreshAccountButton();
      this._refreshCloudUI();
      // 从游戏回到标题后，恢复「云端暂不可用」提示（文案还在时才重新显示）
      if (this._authOffline && this._ui.accountNote &&
          typeof this._ui.accountNote.textContent === 'string' && this._ui.accountNote.textContent) {
        this._show(this._ui.accountNote);
      }
    }

    /* ── 账户 / 登录（Issue #43） ── */

    /** 默认账户客户端：js/auth.js + js/cloud-config.js；opts.auth 显式注入优先 */
    _createAuth(opts) {
      if (opts && Object.prototype.hasOwnProperty.call(opts, 'auth')) return opts.auth || null;
      const authModule = this.root.MIXX && this.root.MIXX.auth;
      if (!authModule || typeof authModule.createClient !== 'function') return null;
      try {
        return authModule.createClient({
          config: this.root.MIXX && this.root.MIXX.cloudConfig,
          storage: this.storage,
          key: ACCOUNT_KEY,
          fetch: opts && typeof opts.fetch === 'function' ? opts.fetch : undefined,
        });
      } catch (e) {
        return null; // 账户模块异常不影响本地游玩
      }
    }

    /**
     * 默认资料客户端：js/account.js（复用本文件创建的 auth 客户端）；
     * opts.profile 显式注入优先，传 null 关闭云端资料功能（本机偏好仍可调整）。
     */
    _createAccount(opts) {
      if (opts && Object.prototype.hasOwnProperty.call(opts, 'profile')) return opts.profile || null;
      const mod = this.root.MIXX && this.root.MIXX.account;
      if (!this.auth || !mod || typeof mod.createClient !== 'function') return null;
      try {
        return mod.createClient({
          config: this.root.MIXX && this.root.MIXX.cloudConfig,
          auth: this.auth,
          fetch: opts && typeof opts.fetch === 'function' ? opts.fetch : undefined,
        });
      } catch (e) {
        return null; // 资料模块异常不影响登录与本地游玩
      }
    }

    /** Cloud module is optional; missing configuration never disables local saves. */
    _createCloud(opts) {
      if (Object.prototype.hasOwnProperty.call(opts, 'cloud')) return opts.cloud || null;
      const mod = this.root.MIXX && this.root.MIXX.cloud;
      if (!this.auth || !mod) return null;
      const client = mod.createClient({ auth: this.auth, fetch: opts.fetch,
        config: this.root.MIXX.cloudConfig, root: this.root });
      return new mod.SaveSync({ client, store: this.store, storage: this.storage,
        key: CHANNEL_KEYS.cloudKey, onChange: () => this._refreshCloudUI() });
    }

    /** 当前登录账号变化时重建云同步归属，令牌续期不重复连接。 */
    _syncCloud() {
      if (this.stats && !this._destroyed) this._statsTask = this.stats.connect(this._currentUserId());
      if (!this.cloud || this._destroyed) return;
      const uid = this._currentUserId();
      if (uid !== this.cloud.uid) {
        this._cloudConfirm = null;
        this._cloudTask = this.cloud.connect(uid).then(result => {
          if (!this._destroyed && this._currentUserId() === uid) this._syncStats();
          return result;
        });
      }
    }

    /** Statistics use their own account journals; guest time is never silently imported. */
    _createStats(opts) {
      if (Object.prototype.hasOwnProperty.call(opts, 'stats')) return opts.stats || null;
      const mod = this.root.MIXX && this.root.MIXX.stats;
      if (!mod) return null;
      const client = this.auth ? new mod.StatsClient({ auth: this.auth, fetch: opts.fetch,
        config: this.root.MIXX.cloudConfig, root: this.root,
        isCurrent: uid => !this._destroyed && this.stats && !this.stats.suspended && this._currentUserId() === uid }) : null;
      return new mod.StatsTracker({ client, storage: this.storage, key: CHANNEL_KEYS.statsKey,
        onChange: () => this._refreshStatsUI() });
    }

    _syncStats() {
      if (!this.stats || this._destroyed) return;
      this._statsTask = this.stats.sync();
    }

    _refreshStatsUI() {
      if (!this.stats || !this._ui || this._destroyed) return;
      const mod = this.root.MIXX.stats, view = this.stats.view();
      const minutes = Math.floor(view.seconds / 60);
      this._text(this._ui.statsTime, Math.floor(minutes / 60) + ' 小时 ' + (minutes % 60) + ' 分 ' + (view.seconds % 60) + ' 秒');
      const collections = this.stats.uid ? view.collections : mod.localCollections(this.store.readAll());
      this._text(this._ui.statsCollection, mod.collectionRates(this.levels, collections).map(l =>
        l.title + '：' + l.got + '/' + l.total + '（' + l.percent + '%）').join('\n'));
      this._text(this._ui.statsAchievements, Object.keys(mod.ACHIEVEMENTS).map(id =>
        (view.achievements.includes(id) ? '★ ' : '☆ ') + mod.ACHIEVEMENTS[id]).join('\n'));
      const status = this.stats.error ? this.stats.error.message + '；未同步记录会在下次登录时重试'
        : !this.stats.uid ? '游客统计仅保存在本机；登录后单独累计账户统计。'
        : this.stats.task ? '正在同步统计…'
        : view.pending ? '有统计待同步，本机记录已保留。'
        : '统计已同步。';
      this._text(this._ui.statsStatus, status);
      if (this._ui.btnStatsSync) this._ui.btnStatsSync.disabled = !this.stats.uid || !!this.stats.task || this.stats.suspended;
    }

    /** 将存档时间显示为本地中文时间；没有存档时显示「无」。 */
    _cloudTime(value) {
      return value ? new Date(value).toLocaleString('zh-CN') : '无';
    }

    /** 同步账号、元数据与传输状态到提示和按钮；加载失败仍保留重试入口。 */
    _refreshCloudUI() {
      if (this._destroyed || !this._ui) return;
      const cloud = this.cloud;
      const signedIn = !!(cloud && cloud.uid);
      const busy = !!(cloud && (cloud.loading || cloud.busy.some(Boolean)));
      const status = !signedIn ? '未同步 · 游客进度仅保存在本机'
        : cloud.error ? cloud.error.message
        : cloud.loading ? '正在读取云存档…'
        : cloud.needsMerge ? '把本机进度并入账户？请选择存档，确认同步方式'
        : cloud.record.pending.some(Boolean) ? '未同步 · 本机存档已保留，可逐档上传'
        : '云存档就绪 · 选择存档查看同步状态';
      this._text(this._ui.cloudStatus, status);
      this._text(this._ui.titleCloudStatus, status);
      if (signedIn) this._show(this._ui.btnLoginCloud);
      else this._hide(this._ui.btnLoginCloud);
      if (signedIn && cloud.needsMerge) this._show(this._ui.cloudMerge);
      else this._hide(this._ui.cloudMerge);
      for (const el of [this._ui.btnCloudMerge, this._ui.btnCloudSkip]) {
        if (el) el.disabled = busy || !signedIn || !cloud.loaded;
      }
      if (this._ui.btnCloudRetry) this._ui.btnCloudRetry.disabled = busy || !signedIn;
      const labels = { unsynced: '未同步', empty: '无云档', upload: '本机待上传',
        download: '☁ 云端可载入', newer: '☁ 云端较新', conflict: '本机 / 云端待选择', synced: '☁ 已同步' };
      for (let i = 0; i < SLOT_COUNT; i++) {
        const local = this.store.readSlot(i);
        const remote = signedIn ? cloud.remote[i] : null;
        const state = signedIn ? cloud.state(i) : 'unsynced';
        this._text(this._ui.cloudMetas[i], labels[state] +
          ' · 本机：' + this._cloudTime(local && local.updatedAt) +
          ' · 云端：' + this._cloudTime(remote && remote.updatedAt));
        const up = this._ui.cloudUploadBtns[i], down = this._ui.cloudDownloadBtns[i];
        for (const el of [up, down]) {
          if (signedIn) this._show(el); else this._hide(el);
          if (el) el.disabled = busy || !signedIn || !cloud.loaded;
        }
        if (up) up.disabled = up.disabled || !local;
        if (down) down.disabled = down.disabled || !remote;
        const confirming = this._cloudConfirm && this._cloudConfirm.index === i;
        this._text(up, confirming && this._cloudConfirm.direction === 'upload'
          ? '确认上传覆盖云端？' : '↑ 上传本机');
        this._text(down, confirming && this._cloudConfirm.direction === 'download'
          ? '确认载入覆盖本机？' : '↓ 载入云端');
        // Prevent a download from replacing the slot after a player starts a game.
        if (this._ui.slotBtns && this._ui.slotBtns[i]) this._ui.slotBtns[i].disabled = this._cloudBusy();
        if (this._ui.slotDelBtns && this._ui.slotDelBtns[i]) this._ui.slotDelBtns[i].disabled = this._cloudBusy();
      }
      for (const el of [this._ui.btnStart, this._ui.btnContinue]) {
        if (el) el.disabled = this._cloudBusy();
      }
    }

    /** 要求两次点击确认同一本机快照与云端版本，再执行指定档位的传输。 */
    _onCloudChoice(index, direction) {
      if (this.state !== STATE.TITLE || !this.cloud || !this.cloud.uid
        || !this._ui.saveScreen || this._ui.saveScreen.classList.contains('hidden')) return;
      const cloud = this.cloud;
      if (cloud.loading || cloud.busy.some(Boolean) || !cloud.loaded) return;
      const local = this.store.readSlot(index), remote = cloud.remote[index];
      if (direction === 'upload' ? !local : !remote) return;
      // Confirmation binds the exact progress/version displayed on the first click.
      this._pendingDelete = -1;
      this._pendingOverwrite = -1;
      const token = JSON.stringify({ local, remote });
      const previous = this._cloudConfirm;
      if (!previous || previous.index !== index || previous.direction !== direction || previous.token !== token) {
        this._cloudConfirm = { index, direction, token };
        this._refreshSaveScreen();
        return;
      }
      this._cloudConfirm = null;
      this._cloudTask = cloud.transfer(index, direction).then(result => {
        if (!this._destroyed) {
          this._refreshTitle(); this._refreshSaveScreen();
          if (result) this._syncStats();
        }
        return result;
      });
    }

    /**
     * 启动时恢复会话（异步，不阻塞标题）：token 未过期直接登录态，
     * 过期则 auth.js 自动 refresh；网络失败只提示，游戏照常本地运行。
     * 会话恢复/登录后自动拉取 profile（#44），标题按钮优先显示昵称。
     */
    _initAuth() {
      const auth = this.auth;
      this._refreshAccountButton();
      if (!auth) return;
      if (typeof auth.onChange === 'function') {
        this._authUnsubscribe = auth.onChange(() => {
          if (this._destroyed) return;
          this._refreshAccountButton();
          this._refreshAuthUI();
          this._syncProfile();
          this._syncCloud();
        });
      }
      if (typeof auth.restore !== 'function') return;
      this._authReady = Promise.resolve()
        .then(() => auth.restore())
        .then((session) => {
          if (this._destroyed) return session;
          if (auth.lastError) this._handleAuthOffline(auth.lastError);
          this._refreshAccountButton();
          this._refreshAuthUI();
          this._syncProfile();
          this._syncCloud();
          return session;
        })
        .catch((err) => {
          if (this._destroyed) return null;
          this._handleAuthOffline(err);
          this._refreshAccountButton();
          this._refreshAuthUI();
          this._syncProfile();
          this._syncCloud();
          return null;
        });
    }

    /** 当前会话（auth 缺失/异常一律按游客态处理） */
    _currentSession() {
      if (!this.auth) return null;
      if (typeof this.auth.getSession === 'function') {
        try { return this.auth.getSession(); } catch (e) { return null; }
      }
      return this.auth.session || null;
    }

    /**
     * 标题账户入口：游客「登录 / 注册」；登录后优先显示昵称（profile 未就绪时回退邮箱）。
     * CSS 省略号截断超长昵称/邮箱。
     */
    _refreshAccountButton() {
      const btn = this._ui.btnAccount;
      if (!btn) return;
      if (!this.auth) { this._hide(btn); return; }
      this._show(btn);
      const session = this._currentSession();
      const email = session && session.user && session.user.email ? session.user.email : '';
      const nickname = this.profile && this.profile.nickname ? this.profile.nickname : '';
      if (email) {
        this._text(btn, '☁ 账户 · ' + (nickname || email));
        btn.classList.add('signed-in');
        if (this._authOffline) { this._authOffline = false; this._hideAccountNote(); }
      } else {
        this._text(btn, '☁ 登录 / 注册');
        btn.classList.remove('signed-in');
      }
    }

    /** 打开登录 / 账户界面（仅标题态；沿用 _show/_hide，不新增游戏状态） */
    _openLoginScreen() {
      if (this.state !== STATE.TITLE) return;
      this._resetPasswordForm();
      this._hide(this._ui.titleScreen);
      this._hide(this._ui.helpScreen);
      this._hide(this._ui.settingsScreen);
      this._show(this._ui.loginScreen);
      this._refreshAuthUI();
      this._syncProfile(); // 会话已恢复但资料尚未加载时补拉一次
      if (this._authOffline && this.auth && this.auth.lastError) {
        this._setLoginMessage(this.auth.lastError.message || '云端暂不可用', 'error');
      } else if (this.auth && this.auth.available === false) {
        this._setLoginMessage('云端暂不可用：尚未配置云端服务；仍可继续本地游玩。', 'error');
      } else {
        this._setLoginMessage('', '');
      }
      const emailEl = this._ui.loginEmail;
      if (!this._currentSession() && emailEl && typeof emailEl.focus === 'function') {
        try { emailEl.focus(); } catch (e) { /* 测试桩无焦点能力 */ }
      }
    }

    /** 关闭登录界面回到标题（已登录态保留，游客态不变） */
    _closeLoginScreen() {
      if (this.state !== STATE.TITLE) return;
      // 退出界面时清掉密码，避免下次打开残留明文；邮箱保留方便再次登录
      if (this._ui.loginPassword) this._ui.loginPassword.value = '';
      this._setLoginMessage('', '');
      this._hide(this._ui.loginScreen);
      this._show(this._ui.titleScreen);
      this._refreshTitle();
    }

    /** 按登录态切换「表单 / 已登录面板」，并同步昵称与账户设置入口（#44） */
    _refreshAuthUI() {
      const session = this._currentSession();
      const signedIn = !!(session && session.user);
      const passwordUid = signedIn ? session.user.id : '';
      if (this._passwordUserId !== passwordUid) {
        this._passwordUserId = passwordUid;
        this._resetPasswordForm();
      }
      this._refreshPasswordUI();
      this._toggleHidden(this._ui.loginForm, signedIn);
      this._toggleHidden(this._ui.loginAccount, !signedIn);
      this._toggleHidden(this._ui.btnSettings, !signedIn);
      this._show(this._ui.btnTitleSettings);
      this._text(this._ui.loginTitle, signedIn ? '账户' : '登录 / 注册');
      this._text(this._ui.loginEmailLabel, signedIn ? (session.user.email || '') : '');
      let nickname = '';
      let accountNote = '';
      if (signedIn) {
        if (!this.account) {
          nickname = '资料功能未启用';
          accountNote = '账户资料功能未启用（js/account.js 未加载），登录与本地游玩不受影响。';
        } else {
          accountNote = '账户设置可修改昵称、头像与音效/操作偏好；云存档可在选择存档界面管理。';
          if (this.profile) nickname = this.profile.nickname;
          else if (this.profileError) nickname = '云端资料暂不可用';
          else nickname = '加载中…';
        }
      }
      this._text(this._ui.loginNicknameLabel, nickname);
      this._text(this._ui.loginAccountNote, accountNote);
      this._setLoginBusy(this._authBusy);
    }

    _toggleHidden(el, shouldHide) {
      if (!el || !el.classList) return;
      if (shouldHide) el.classList.add('hidden');
      else el.classList.remove('hidden');
    }

    _setLoginBusy(busy) {
      this._authBusy = !!busy;
      const buttons = [this._ui.btnLogin, this._ui.btnRegister, this._ui.btnLogout];
      for (let i = 0; i < buttons.length; i++) {
        if (buttons[i]) buttons[i].disabled = !!busy || this._passwordBusy;
      }
    }

    _refreshPasswordUI() {
      const enabled = !!this._currentUserId() && this.auth && typeof this.auth.changePassword === 'function';
      this._toggleHidden(this._ui.settingsPassword, !enabled);
      if (this._ui.btnSettingsBack) this._ui.btnSettingsBack.disabled = this._accountBusy || this._passwordBusy;
      for (const el of [this._ui.passwordCurrent, this._ui.passwordNew, this._ui.passwordConfirm,
        this._ui.btnPasswordSave, this._ui.btnPasswordClear]) {
        if (el) el.disabled = !enabled || this._passwordBusy;
      }
    }

    _clearPasswordFields() {
      for (const el of [this._ui.passwordCurrent, this._ui.passwordNew, this._ui.passwordConfirm]) {
        if (el) el.value = '';
      }
    }

    _setPasswordMessage(text, error) {
      const el = this._ui.passwordMsg;
      this._text(el, text || '');
      if (el && el.classList) {
        el.classList.toggle('settings-msg-error', !!text && !!error);
        el.classList.toggle('settings-msg-ok', !!text && !error);
      }
    }

    _resetPasswordForm() {
      this._passwordEpoch++;
      this._clearPasswordFields();
      this._setPasswordMessage('', false);
    }

    _onPasswordSubmit() {
      if (this.state !== STATE.TITLE || !this._settingsVisible() || !this._currentUserId()
        || !this.auth || typeof this.auth.changePassword !== 'function') return null;
      if (this._passwordBusy) return this._passwordPromise;
      const current = this._ui.passwordCurrent && this._ui.passwordCurrent.value || '';
      const password = this._ui.passwordNew && this._ui.passwordNew.value || '';
      const confirmation = this._ui.passwordConfirm && this._ui.passwordConfirm.value || '';
      this._clearPasswordFields();
      if (password !== confirmation) {
        this._setPasswordMessage('两次输入的新密码不一致', true);
        return null;
      }
      const uid = this._currentUserId(), epoch = this._passwordEpoch;
      const active = () => !this._destroyed && this._settingsVisible()
        && this._currentUserId() === uid && this._passwordEpoch === epoch;
      this._passwordBusy = true;
      this._refreshPasswordUI();
      this._setLoginBusy(this._authBusy);
      this._setPasswordMessage('正在验证身份并修改密码…', false);
      this._passwordPromise = Promise.resolve().then(() => {
        if (!active()) return;
        return this.auth.changePassword(current, password);
      }).then(result => {
        if (active() && result) this._setPasswordMessage('密码已修改，后续登录请使用新密码。', false);
        return result;
      }).catch(err => {
        if (active()) this._setPasswordMessage(err && err.message || '修改失败，请稍后重试', true);
        return null;
      }).finally(() => {
        this._passwordBusy = false;
        if (!this._destroyed) {
          this._refreshPasswordUI();
          this._setLoginBusy(this._authBusy);
        }
      });
      return this._passwordPromise;
    }

    /** 登录界面提示：kind = '' | 'ok' | 'error' */
    _setLoginMessage(text, kind) {
      this.loginMessage = text || '';
      const el = this._ui.loginMsg;
      if (!el) return;
      this._text(el, this.loginMessage);
      if (!el.classList) return;
      el.classList.remove('login-msg-error');
      el.classList.remove('login-msg-ok');
      if (kind === 'error') el.classList.add('login-msg-error');
      else if (kind === 'ok') el.classList.add('login-msg-ok');
    }

    _showAccountNote(text) {
      if (!this._ui.accountNote) return;
      this._text(this._ui.accountNote, text || '');
      this._show(this._ui.accountNote);
    }

    _hideAccountNote() {
      this._text(this._ui.accountNote, '');
      this._hide(this._ui.accountNote);
    }

    _readLoginForm() {
      const emailEl = this._ui.loginEmail;
      const passEl = this._ui.loginPassword;
      return {
        email: emailEl && typeof emailEl.value === 'string' ? emailEl.value : '',
        password: passEl && typeof passEl.value === 'string' ? passEl.value : '',
      };
    }

    _clearLoginInputs() {
      if (this._ui.loginEmail) this._ui.loginEmail.value = '';
      if (this._ui.loginPassword) this._ui.loginPassword.value = '';
    }

    /** restore 失败分类：网络类才在标题提示「云端暂不可用」；登录过期只提示重新登录 */
    _handleAuthOffline(err) {
      const code = err && err.code;
      const offline = code === 'network' || code === 'timeout' || code === 'server' ||
        code === 'unavailable' || code === 'invalid_response';
      if (offline) {
        this._authOffline = true;
        this._showAccountNote((err && err.message) || '云端暂不可用，已用本地存档继续。');
      } else if (code === 'invalid_refresh_token' || code === 'not_signed_in') {
        this._authOffline = false;
        this._hideAccountNote();
      }
    }

    _handleAuthError(err) {
      const message = (err && err.message) || '操作失败，请稍后再试';
      const code = err && err.code;
      const offline = code === 'network' || code === 'timeout' || code === 'server' ||
        code === 'unavailable' || code === 'invalid_response';
      if (offline) {
        this._authOffline = true;
        this._showAccountNote(message);
      } else {
        // 服务端已返回业务错误（如密码错），说明云端正可达：清掉旧的离线提示
        this._authOffline = false;
        this._hideAccountNote();
      }
      this._setLoginMessage(message, 'error');
    }

    /**
     * 登录 / 注册提交（异步，按钮置灰防重复）。
     * @param {'signin'|'signup'} mode
     * @returns {Promise<object|null>} 完成后 resolve 当前会话
     */
    _authSubmit(mode) {
      if (this.state !== STATE.TITLE) return null;
      if (this._authBusy && this._authPromise) return this._authPromise;
      const auth = this.auth;
      if (!auth) {
        this._setLoginMessage('云端暂不可用：账户功能未就绪；仍可继续本地游玩。', 'error');
        return null;
      }
      const isSignup = mode === 'signup';
      const method = isSignup ? 'signUp' : 'signIn';
      if (typeof auth[method] !== 'function') {
        this._setLoginMessage('云端暂不可用：账户功能未就绪；仍可继续本地游玩。', 'error');
        return null;
      }
      const form = this._readLoginForm();
      this._setLoginBusy(true);
      this._setLoginMessage(isSignup ? '正在注册…' : '正在登录…', '');
      this._authPromise = Promise.resolve()
        .then(() => auth[method](form.email, form.password))
        .then((result) => {
          if (isSignup && result && result.needsConfirmation) {
            this._setLoginMessage('注册成功，请到邮箱完成验证后再登录。', 'ok');
            return result;
          }
          this._clearLoginInputs();
          this._authOffline = false;
          this._hideAccountNote();
          this._setLoginMessage(isSignup ? '注册成功，已自动登录。' : '登录成功。', 'ok');
          return result;
        })
        .catch((err) => {
          this._handleAuthError(err);
          return null;
        })
        .then((result) => {
          if (this._destroyed) return null;
          this._setLoginBusy(false);
          this._refreshAccountButton();
          this._refreshAuthUI();
          return this._currentSession() || (result && result.session) || null;
        });
      return this._authPromise;
    }

    /** 登出：清会话回游客态；本地存档 / 设置 / 游戏进度不受影响 */
    _logout() {
      if (this.state !== STATE.TITLE) return null;
      if (this._authBusy && this._authPromise) return this._authPromise;
      if (!this.auth || typeof this.auth.signOut !== 'function') return null;
      this._setLoginBusy(true);
      this._setLoginMessage('正在登出…', '');
      this._authPromise = Promise.resolve()
        .then(() => this.auth.signOut())
        .catch(() => null)
        .then(() => {
          if (this._destroyed) return false;
          this._clearLoginInputs();
          this._authOffline = false;
          this._hideAccountNote();
          this._setLoginMessage('已登出，已回到游客模式；本机存档不受影响。', 'ok');
          this._setLoginBusy(false);
          this._refreshAccountButton();
          this._refreshAuthUI();
          return true;
        });
      return this._authPromise;
    }

    /** 登录输入框回车 = 登录（避免在无 form 的桩环境里依赖 submit 事件） */
    _onLoginKeydown(ev) {
      if (ev && ev.key === 'Enter') this._authSubmit('signin');
    }

    /* ── 账户资料 / 设置（Issue #44） ── */

    /** 当前会话的 user id；游客/异常返回空串 */
    _currentUserId() {
      const session = this._currentSession();
      return session && session.user && typeof session.user.id === 'string' ? session.user.id : '';
    }

    /**
     * 会话变化 → 同步资料：登录/恢复后自动拉取 profile；登出/切号清空设置界面状态。
     * 同一账号的重复事件（refresh）不会重复请求。
     */
    _syncProfile() {
      if (this._destroyed || !this.account) {
        this.profile = null;
        this._profileUserId = '';
        this._refreshAccountButton();
        this._refreshAuthUI();
        return;
      }
      const userId = this._currentUserId();
      if (!userId) {
        const had = !!this.profile || !!this._profileUserId;
        const wasSettingsOpen = this._settingsVisible();
        this.profile = null;
        this.profileError = null;
        this._profileUserId = '';
        this._selectedAvatar = '';
        this._avatarTouched = false;
        this._cloudPrefs = null;
        this._cloudPrefsDiffer = false;
        // 会话失效/登出时若正停在设置页：退回标题，避免残留旧昵称/邮箱与可保存状态
        if (wasSettingsOpen) this._closeSettingsScreen();
        if (had || wasSettingsOpen) {
          this._refreshAuthUI();
          this._refreshSettingsUI();
        }
        return;
      }
      const switched = userId !== this._profileUserId;
      if (switched) {
        // 切号（含页内直接换会话）：立即清空上一账号资料，避免新资料加载前
        // 标题/设置页沿用 A 的昵称头像、甚至把 A 的值保存到 B（评审 [重要] 1）。
        this.profile = null;
        this.profileError = null;
        this._selectedAvatar = '';
        this._avatarTouched = false;
        this._cloudPrefs = null;
        this._cloudPrefsDiffer = false;
        if (this._settingsVisible()) {
          this._fillSettingsForm(); // 占位 + 禁用（profile 未就绪）
          this._refreshSettingsUI();
        }
        this._refreshAccountButton();
        this._refreshAuthUI();
      } else if (this.profile || this._profilePromise) {
        this._refreshAccountButton();
        this._refreshAuthUI();
        return;
      }
      this._profileUserId = userId;
      this._loadProfile();
    }

    /**
     * 拉取云端资料：成功后更新昵称 / 云端偏好 / 设置界面；失败只记录 profileError
     * （登录界面显示「云端资料暂不可用」），不阻塞本地游玩。
     * 同一时刻只发一个请求。
     * @returns {Promise<object|null>}
     */
    _loadProfile() {
      const account = this.account;
      if (!account || this._destroyed) return Promise.resolve(null);
      const userId = this._profileUserId;
      // 同一账号的加载去重；切号时旧请求还在途，不能阻塞新账号的资料加载
      if (this._profilePromise && this._profileUid === userId) return this._profilePromise;
      this.profileError = null;
      this._refreshAuthUI();
      this._refreshSettingsUI();
      const self = this;
      const task = Promise.resolve()
        .then(function () { return account.load(); })
        .then(function (profile) {
          if (self._destroyed || self._profileUserId !== userId) return null;
          self.profile = profile;
          self.profileError = null;
          self._selectedAvatar = profile.avatar;
          self._applyCloudPrefs(profile.prefs);
          self._refreshAccountButton();
          self._refreshAuthUI();
          self._fillSettingsForm();
          self._emit('profile', { action: 'load', nickname: profile.nickname, avatar: profile.avatar });
          return profile;
        })
        .catch(function (err) {
          if (self._destroyed || self._profileUserId !== userId) return null;
          self.profileError = err;
          self._refreshAuthUI();
          self._refreshSettingsUI();
          self._emit('profile', { action: 'load-error', code: err && err.code });
          return null;
        })
        .then(function (result) {
          if (self._profilePromise === task) {
            self._profilePromise = null;
            self._profileUid = '';
          }
          if (!self._destroyed) {
            self._refreshSettingsUI();
            // 加载期间会话切到了另一个账号：旧结果已丢弃，补拉新账号资料
            if (!self.profile && self._profileUserId && self._profileUserId !== userId) {
              self._loadProfile();
            }
          }
          return result;
        });
      this._profilePromise = task;
      this._profileTask = task;
      this._profileUid = userId;
      return task;
    }

    /**
     * 采用云端偏好（#44 的「不冲突」规则）：
     *   - 本机**没有**设置记录（新设备/清缓存）→ 采用云端声音/操作偏好并写入本机；
     *   - 本机**已有**设置记录 → 本地优先，不自动覆盖（避免登录后声音突变），
     *     保存设置时以本机为准上传云端，并在设置页提示差异。
     * @param {object} prefs 云端 profiles.prefs
     * @returns {boolean} 是否应用到了本机
     */
    _applyCloudPrefs(prefs) {
      const normalized = normalizePrefsForSave(prefs);
      this._cloudPrefs = normalized;
      let applied = false;
      if (!this._settingsStored) {
        this.soundOn = normalized.sound;
        this._settings.sound = normalized.sound;
        this._settings.touch = normalizeTouchMode(normalized.touch);
        this._writeSettings();
        this.input.setTouchMode(this._settings.touch);
        this._applySoundState();
        applied = true;
      }
      const local = normalizePrefsForSave(this._settings);
      this._cloudPrefsDiffer = local.sound !== normalized.sound || local.touch !== normalized.touch;
      return applied;
    }

    /** 把触屏按键偏好应用到输入系统与设置界面按钮（立即生效） */
    _applyTouchPref() {
      const mode = normalizeTouchMode(this._settings.touch);
      if (this.input && typeof this.input.setTouchMode === 'function') this.input.setTouchMode(mode);
      const btn = this._ui.btnPrefTouch;
      if (btn) {
        this._text(btn, '📱 触屏按键：' + touchModeLabel(mode));
        if (btn.classList) btn.classList.toggle('pref-on', mode === 'on');
      }
      return mode;
    }

    /** 循环切换触屏按键偏好（自动 → 常开 → 关闭 → 自动），立即生效并写盘 */
    _cycleTouchPref() {
      const list = touchModeList();
      const current = normalizeTouchMode(this._settings.touch);
      const next = list[(list.indexOf(current) + 1) % list.length] || 'auto';
      this._settings.touch = next;
      const saved = this._writeSettings();
      this._applyTouchPref();
      this._setSettingsMessage(saved
        ? '触屏按键：' + touchModeLabel(next) + '（已保存到本机，立即生效）'
        : '触屏按键：' + touchModeLabel(next) + '（已生效，但本机存储不可用，刷新后会丢失）',
      saved ? '' : 'error');
      this._refreshCloudPrefsDiffer();
      return next;
    }

    /** 重新计算「云端偏好与本机是否不同」并刷新设置页说明（切偏好后调用） */
    _refreshCloudPrefsDiffer() {
      if (!this._cloudPrefs) return false;
      const local = normalizePrefsForSave(this._settings);
      this._cloudPrefsDiffer = local.sound !== this._cloudPrefs.sound
        || local.touch !== this._cloudPrefs.touch;
      if (this._settingsVisible()) this._refreshSettingsCloudNote();
      return this._cloudPrefsDiffer;
    }

    /** 账户设置 screen 当前是否可见 */
    _settingsVisible() {
      const el = this._ui.settingsScreen;
      return !!(el && el.classList && !el.classList.contains('hidden'));
    }

    /** 从标题或登录面板打开设置（游客或云端资料功能未就绪时仅可调整本机偏好） */
    _openSettingsScreen() {
      if (this.state !== STATE.TITLE) return false;
      this._resetPasswordForm();
      this._refreshPasswordUI();
      const signedIn = !!this._currentSession();
      this._hide(this._ui.loginScreen);
      this._hide(this._ui.titleScreen);
      this._show(this._ui.settingsScreen);
      this._selectedAvatar = avatarAllowed(this.profile && this.profile.avatar)
        ? this.profile.avatar
        : AVATAR_DEFAULT;
      this._fillSettingsForm();
      this._refreshSettingsUI();
      this._setSettingsMessage('', '');
      // 只有「还没拿到过资料」才自动重试；保存失败时资料本身有效，不重新拉取，
      // 避免后台 GET 迟到后覆盖玩家正在编辑的内容。
      if (signedIn && this.account && !this.profile) this._loadProfile();
      this._refreshStatsUI();
      this._syncStats();
      return true;
    }

    /** 关闭账户设置：回到登录面板（仍登录）或标题（已登出） */
    _closeSettingsScreen() {
      if (this.state !== STATE.TITLE || !this._settingsVisible()) return false;
      if (this._passwordBusy && this._currentUserId()) return false;
      this._resetPasswordForm();
      this._hide(this._ui.settingsScreen);
      this._selectedAvatar = '';
      this._setSettingsMessage('', '');
      if (this._currentSession()) {
        this._show(this._ui.loginScreen);
        this._refreshAuthUI();
      } else {
        this._show(this._ui.titleScreen);
        this._refreshTitle();
      }
      return true;
    }

    /** 把当前 profile / 本地偏好填入设置界面（打开界面、资料加载/保存成功后调用） */
    _fillSettingsForm() {
      this._avatarTouched = false;
      if (this._ui.settingsNickname) {
        this._ui.settingsNickname.value = this.profile && this.profile.nickname
          ? this.profile.nickname
          : 'NSWER';
      }
      this._refreshNicknameCount();
      const avatarId = avatarAllowed(this._selectedAvatar)
        ? this._selectedAvatar
        : (this.profile && avatarAllowed(this.profile.avatar) ? this.profile.avatar : AVATAR_DEFAULT);
      this._selectedAvatar = avatarId;
      this._syncAvatarSelection(avatarId);
      this._applyTouchPref();
      this._applySoundState();
      const session = this._currentSession();
      const email = session && session.user ? session.user.email : '';
      this._text(this._ui.settingsAccount, email ? '已登录：' + email : '未登录：仅可调整本机偏好');
      this._refreshSettingsCloudNote();
    }

    /** 昵称字数提示（按 Unicode 码点计，与数据库 char_length 一致） */
    _refreshNicknameCount() {
      const el = this._ui.settingsNicknameCount;
      if (!el) return;
      const input = this._ui.settingsNickname;
      const length = nicknameCharLength(input && typeof input.value === 'string' ? input.value : '');
      this._text(el, length + '/16');
      if (el.classList) el.classList.toggle('settings-hint-error', length > 16);
      if (input && typeof input.setAttribute === 'function') {
        input.setAttribute('aria-invalid', length > 16 ? 'true' : 'false');
      }
    }

    /** 同步头像选中态 / 预览色块与名字 */
    _syncAvatarSelection(avatarId) {
      const id = avatarAllowed(avatarId) ? avatarId : AVATAR_DEFAULT;
      const buttons = this._ui.avatarBtns || {};
      for (const key of Object.keys(buttons)) {
        const btn = buttons[key];
        if (btn && btn.classList) btn.classList.toggle('is-selected', key === id);
        if (btn && typeof btn.setAttribute === 'function') {
          btn.setAttribute('aria-pressed', key === id ? 'true' : 'false');
        }
      }
      const presets = avatarPresetsFor(this.root);
      let preset = presets[0];
      for (let i = 0; i < presets.length; i++) {
        if (presets[i].id === id) { preset = presets[i]; break; }
      }
      if (this._ui.avatarPreview && this._ui.avatarPreview.style) {
        this._ui.avatarPreview.style.background = preset ? preset.color : '#7FB8E6';
      }
      this._paintAvatar(this._ui.avatarPreviewFace, preset);
      this._text(this._ui.avatarPreviewName, preset ? preset.name : '');
    }

    /** 使用本地头像图集；缺少素材元数据时保留原来的色块头像。 */
    _paintAvatar(face, preset) {
      if (!face || !face.style || !face.classList) return;
      const art = preset && preset.art && preset.portraitCell;
      face.classList.toggle('has-portrait', !!art);
      face.style.backgroundImage = art ? 'url("' + (assetBase ? new URL(preset.art, assetBase).href : preset.art) + '")' : '';
      face.style.backgroundPosition = art ? (preset.portraitCell[0] * 50) + '% ' + (preset.portraitCell[1] * 100) + '%' : '';
    }

    /** 设置界面登录态 / 忙碌态 / 云端说明（不重填昵称输入框，避免打断输入） */
    _refreshSettingsUI() {
      const signedIn = !!this._currentSession();
      const busy = this._accountBusy;
      // 资料未加载成功前禁止保存：否则表单默认值（NSWER / muse-1）会覆盖云端
      // 现有昵称/头像（评审发现的阻塞级数据覆盖问题，Issue #44）。
      const profileReady = !!this.profile;
      const formDisabled = !signedIn || !this.account || busy || !profileReady;
      const saveBtn = this._ui.btnSettingsSave;
      if (saveBtn) {
        saveBtn.disabled = formDisabled;
        this._text(saveBtn, busy ? '正在保存…' : '💾 保存设置');
      }
      if (this._ui.btnSettingsBack) this._ui.btnSettingsBack.disabled = busy || this._passwordBusy;
      // 保存期间冻结偏好按钮，避免 PATCH 快照与界面显示不一致
      if (this._ui.btnPrefSound) this._ui.btnPrefSound.disabled = busy;
      if (this._ui.btnPrefTouch) this._ui.btnPrefTouch.disabled = busy;
      if (this._ui.settingsNickname) this._ui.settingsNickname.disabled = formDisabled;
      const buttons = this._ui.avatarBtns || {};
      for (const key of Object.keys(buttons)) {
        if (buttons[key]) buttons[key].disabled = formDisabled;
      }
      const retry = this._ui.btnSettingsRetry;
      if (retry) {
        const showRetry = signedIn && !!this.account && !profileReady && !busy
          && !this._profilePromise && !!this.profileError;
        this._toggleHidden(retry, !showRetry);
      }
      this._refreshSettingsCloudNote();
    }

    /** 云端资料说明行：未登录 / 读取中 / 云端不可用 / 偏好差异 */
    _refreshSettingsCloudNote() {
      const el = this._ui.settingsCloudNote;
      if (!el) return;
      if (!this._currentSession()) {
        this._text(el, '未登录：昵称与头像不可用；声音与操作偏好只保存在本机。');
        return;
      }
      if (!this.account) {
        this._text(el, '云端资料功能未启用：昵称、头像与云端保存不可用；声音与操作偏好只保存在本机并立即生效。');
        return;
      }
      if (this.profileError) {
        const canRetry = !this._profilePromise && !this._accountBusy;
        this._text(el, '云端资料暂不可用：'
          + (this.profileError.message || '请稍后再试')
          + (canRetry ? '（可点「重试读取云端资料」）' : ''));
        return;
      }
      if (!this.profile) {
        this._text(el, '正在读取云端资料…资料就绪前无法保存昵称与头像。');
        return;
      }
      const unknownAvatar = !this._avatarTouched
        && this.profile.avatarRaw && this.profile.avatarRaw !== this.profile.avatar;
      let text = this._cloudPrefsDiffer
        ? '昵称与头像保存到云端；云端偏好与本机不同，点击保存后以本机为准。'
        : '昵称与头像保存到云端；声音与操作偏好同时保存到本机并立即生效。';
      if (unknownAvatar) {
        text += ' 云端头像 ' + this.profile.avatarRaw + ' 不在当前可选集，已显示默认头像；'
          + '保存昵称/偏好不会改动云端头像。';
      }
      this._text(el, text);
    }

    /** 设置界面提示：kind = '' | 'ok' | 'error' */
    _setSettingsMessage(text, kind) {
      this.settingsMessage = text || '';
      const el = this._ui.settingsMsg;
      if (!el) return;
      this._text(el, this.settingsMessage);
      if (!el.classList) return;
      el.classList.remove('settings-msg-error');
      el.classList.remove('settings-msg-ok');
      if (kind === 'error') el.classList.add('settings-msg-error');
      else if (kind === 'ok') el.classList.add('settings-msg-ok');
    }

    /** 昵称输入：只刷新字数提示，保存时再统一校验 */
    _onNicknameInput() {
      this._refreshNicknameCount();
    }

    /** 选择固定头像：只更新待保存值，点击「保存设置」后才写云端 */
    _onAvatarPick(id) {
      if (!this._settingsVisible() || !avatarAllowed(id)) return false;
      this._selectedAvatar = id;
      this._avatarTouched = true;
      this._syncAvatarSelection(id);
      this._setSettingsMessage('已选择头像，点击「保存设置」后同步到云端。', '');
      this._refreshSettingsCloudNote(); // 主动选头像后「不改动云端头像」提示不再适用
      return true;
    }

    /**
     * 保存设置：昵称/头像写云端 profiles，声音/触屏偏好即时生效并写本机。
     * 昵称超长等客户端校验失败时不发请求，只给中文提示。
     * @returns {Promise<object|null>}
     */
    _onSettingsSave() {
      if (this.state !== STATE.TITLE || !this._settingsVisible()) return null;
      if (this._accountBusy && this._accountPromise) return this._accountPromise;
      const signedIn = !!this._currentSession();
      // 资料未加载成功前禁止保存（按钮已置灰，这里是双保险）：否则表单默认值
      // （NSWER / muse-1）会当作玩家输入 PATCH 覆盖云端现有昵称/头像。
      if (signedIn && this.account && !this.profile) {
        if (this.profileError) {
          this._setSettingsMessage('云端资料暂不可用，正在重试读取；资料就绪后再保存。', 'error');
        } else {
          this._setSettingsMessage('正在读取云端资料，请稍候再保存。', '');
        }
        this._loadProfile();
        this._refreshSettingsUI();
        return null;
      }
      const nickname = normalizeNicknameForSave(
        this._ui.settingsNickname && typeof this._ui.settingsNickname.value === 'string'
          ? this._ui.settingsNickname.value
          : ''
      );
      if (!nickname.ok) {
        this._setSettingsMessage(nickname.message, 'error');
        this._refreshNicknameCount();
        if (this._ui.settingsNickname && typeof this._ui.settingsNickname.setAttribute === 'function') {
          this._ui.settingsNickname.setAttribute('aria-invalid', 'true');
        }
        return null;
      }
      // 头像：玩家主动改过才写所选头像；未改动时只有云端原始 id 已知且与展示一致
      // 才回写，避免未知 / 未来版本头像在「只改昵称」时被覆盖成默认 muse-1。
      let avatarToSave;
      if (this._avatarTouched) {
        if (!avatarAllowed(this._selectedAvatar)) {
          this._setSettingsMessage('请选择列表中的固定头像。', 'error');
          return null;
        }
        avatarToSave = this._selectedAvatar;
      } else if (this.profile && this.profile.avatarRaw && this.profile.avatarRaw === this.profile.avatar) {
        avatarToSave = this.profile.avatar;
      }
      const prefs = normalizePrefsForSave({ sound: this.soundOn, touch: this._settings.touch });
      // 本地先落盘：云端失败也不丢本机偏好（声音/触屏已即时生效）
      this._settings.v = SAVE_VERSION;
      this._settings.sound = prefs.sound;
      this._settings.touch = prefs.touch;
      const localSaved = this._writeSettings();
      this._applySoundState();
      this._applyTouchPref();

      if (!signedIn || !this.account) {
        this._setSettingsMessage(localSaved
          ? '已保存到本机；登录后可同步昵称与头像。'
          : '设置已生效，但本机存储不可用（隐私模式或空间不足），刷新后会丢失。',
        localSaved ? 'ok' : 'error');
        this._refreshSettingsUI();
        return null;
      }
      const saveUserId = this._currentUserId();
      this._accountBusy = true;
      this._setSettingsMessage('正在保存到云端…', '');
      this._refreshSettingsUI();
      const self = this;
      const task = Promise.resolve()
        .then(function () {
          return self.account.save({ nickname: nickname.value, avatar: avatarToSave, prefs: prefs });
        })
        .then(function (profile) {
          if (self._destroyed) return null;
          // 保存期间切号/登出：丢弃旧账号的回包，避免把 A 的资料写到 B 的界面
          if (self._currentUserId() !== saveUserId || self._profileUserId !== saveUserId) {
            self._emit('profile', { action: 'save-stale', nickname: profile.nickname });
            return null;
          }
          self.profile = profile;
          self.profileError = null;
          self._selectedAvatar = profile.avatar;
          self._avatarTouched = false;
          self._applyCloudPrefs(profile.prefs);
          self._setSettingsMessage(localSaved
            ? '设置已保存。'
            : '设置已保存到云端；但本机存储不可用（隐私模式或空间不足），本机偏好刷新后可能丢失。',
          localSaved ? 'ok' : 'error');
          self._fillSettingsForm();
          self._refreshAccountButton();
          self._refreshAuthUI();
          self._refreshSettingsUI();
          self._emit('profile', { action: 'save', nickname: profile.nickname, avatar: profile.avatar });
          return profile;
        })
        .catch(function (err) {
          if (self._destroyed) return null;
          if (self._currentUserId() !== saveUserId || self._profileUserId !== saveUserId) {
            self._emit('profile', { action: 'save-stale-error', code: err && err.code });
            return null;
          }
          self._handleProfileError(err);
          return null;
        })
        .then(function (result) {
          if (!self._destroyed) {
            self._accountBusy = false;
            self._refreshSettingsUI();
          }
          return result;
        });
      this._accountPromise = task;
      return task;
    }

    /** 资料保存失败：中文提示；登录过期时同步回游客态（auth 已清会话） */
    _handleProfileError(err) {
      const message = (err && err.message) || '操作失败，请稍后再试';
      // 只有「从未加载成功」才记 profileError（用于禁用保存/显示重试）；
      // 已有资料时的保存失败只提示在 settings-msg，资料仍是有效的旧值。
      if (!this.profile) this.profileError = err;
      this._setSettingsMessage(message, 'error');
      this._refreshSettingsCloudNote();
      this._emit('profile', { action: 'save-error', code: err && err.code });
      if (err && (err.code === 'not_signed_in' || err.code === 'unauthorized')) {
        this._syncProfile();
        this._syncCloud();
      }
    }

    /**
     * 按 GAME.avatarPresets 动态渲染头像按钮（新增头像只改 data.js，无需改 HTML/JS）。
     * 未知 id 在 _syncAvatarSelection 中回退默认头像。
     */
    _renderAvatarOptions() {
      const box = this._ui.avatarOptions;
      this._ui.avatarBtns = {};
      if (!box || typeof box.appendChild !== 'function') return;
      const doc = this.doc;
      if (!doc || typeof doc.createElement !== 'function') return;
      const presets = avatarPresetsFor(this.root);
      // 清空容器：真实 DOM 用 innerHTML；测试桩的 children 是普通数组
      if (box.children && Array.isArray(box.children)) box.children.length = 0;
      else box.innerHTML = '';
      const self = this;
      for (let i = 0; i < presets.length; i++) {
        const preset = presets[i];
        const btn = doc.createElement('button');
        if (!btn || !btn.classList) continue;
        btn.type = 'button';
        btn.classList.add('avatar-btn');
        if (typeof btn.setAttribute === 'function') {
          btn.setAttribute('data-avatar', preset.id);
          btn.setAttribute('aria-label', '头像 ' + preset.name);
          btn.setAttribute('aria-pressed', 'false');
        }
        if (btn.style) btn.style.background = preset.color;
        const face = doc.createElement('span');
        if (face && face.classList) {
          face.classList.add('avatar-face');
          this._paintAvatar(face, preset);
          if (typeof face.setAttribute === 'function') face.setAttribute('aria-hidden', 'true');
          btn.appendChild(face);
        }
        const name = doc.createElement('span');
        if (name && name.classList) {
          name.classList.add('avatar-name');
          name.textContent = preset.name;
          btn.appendChild(name);
        }
        this._on(btn, 'click', function () { self._onAvatarPick(preset.id); });
        box.appendChild(btn);
        this._ui.avatarBtns[preset.id] = btn;
      }
      this._syncAvatarSelection(this._selectedAvatar || AVATAR_DEFAULT);
    }

    /** 标题「新游戏」：优先占用第一个空档；三档全满则打开选择存档界面要求覆盖 */
    _startNewGame() {
      if (this.state !== STATE.TITLE || this._cloudBusy()) return;
      const slots = this.store.readAll();
      let empty = -1;
      for (let i = 0; i < slots.length; i++) {
        if (!slots[i]) { empty = i; break; }
      }
      if (empty < 0) { this._openSaveScreen('overwrite'); return; }
      this._newGame(empty);
    }

    /**
     * 在指定存档位开新游戏：只初始化内存态，**不写盘**。
     * 首次「保存并退出」或通关自动存档时才真正生成存档文件（手动存档制）。
     */
    _newGame(index) {
      if (this.state !== STATE.TITLE || this._cloudBusy()) return false;
      const first = this.levels[0];
      if (!first || index < 0 || index >= SLOT_COUNT) return false;
      this.saveSlotIndex = index;
      this.saveData = emptySlot(index, first.id);
      this._playedNodes = new Set();
      this.sheepCount = 0;
      this._pendingOverwrite = -1;
      this._pendingDelete = -1;
      this.levelIndex = 0;
      this._startPrologue();
      return true;
    }

    /** 新游戏专用：独立场景的自动对话播完后才创建第一关。 */
    _startPrologue() {
      const scene = this.scenes.p0;
      if (!scene || !this._findAutoEntry('load:p0')) {
        this._loadLevel(0);
        return;
      }
      this.scene = Object.assign({ id: 'p0' }, scene);
      this.level = null;
      this.player = null;
      this.mechanics = null;
      this.stars = 0;
      this.collected = [];
      this.runTime = 0;
      this.particles.clear();
      this._hideAllScreens();
      this._show(this._ui.hud);
      this._refreshHud();
      this.input.setEnabled(true);
      this.input.setTouchVisible(true); // 手机 A 键仍可快进/翻页
      this._dispatchAuto('load:p0', () => this._loadLevel(0));
    }

    /** 标题「继续冒险」：载入 updatedAt 最新的存档位 */
    _continueGame() {
      if (this.state !== STATE.TITLE) return;
      const latest = this.store.latest();
      if (!latest) return;
      this._loadSlot(latest.index);
    }

    /** 读档：恢复关卡、已收集星、once 节点、黑羊计数后进入游玩 */
    _loadSlot(index) {
      if (this.state !== STATE.TITLE || this._cloudBusy()) return false;
      const slot = this.store.readSlot(index);
      if (!slot) return false;
      this.saveSlotIndex = index;
      this.saveData = cloneSlot(slot);
      this._playedNodes = new Set(this.saveData.played);
      this.sheepCount = this.saveData.sheep;
      this._pendingOverwrite = -1;
      this._pendingDelete = -1;
      let levelIndex = -1;
      for (let i = 0; i < this.levels.length; i++) {
        if (this.levels[i].id === this.saveData.current) { levelIndex = i; break; }
      }
      this.levelIndex = levelIndex >= 0 ? levelIndex : 0;
      this._loadLevel(this.levelIndex, { restore: true });
      return true;
    }

    /** 打开选择存档界面（mode='overwrite' 时已有档位需二次点击确认覆盖） */
    _openSaveScreen(mode) {
      if (this.state !== STATE.TITLE) return;
      this._hide(this._ui.loginScreen);
      this._hide(this._ui.settingsScreen);
      this._cloudConfirm = null;
      this._saveMode = mode === 'overwrite' ? 'overwrite' : 'load';
      this._pendingOverwrite = -1;
      this._pendingDelete = -1;
      this._refreshSaveScreen();
      this._hide(this._ui.titleScreen);
      this._show(this._ui.saveScreen);
    }

    _closeSaveScreen() {
      if (this.state !== STATE.TITLE) return;
      this._pendingOverwrite = -1;
      this._pendingDelete = -1;
      this._cloudConfirm = null;
      this._hide(this._ui.saveScreen);
      this._show(this._ui.titleScreen);
      this._refreshTitle();
    }

    /** 点击存档位：空档开新游戏；已有档默认载入；覆盖模式需连点两次 */
    _onSlotClick(index) {
      if (this.state !== STATE.TITLE || this._cloudBusy()) return;
      this._cloudConfirm = null;
      const screen = this._ui.saveScreen;
      if (!screen || (screen.classList && screen.classList.contains('hidden'))) return;
      this._pendingDelete = -1; // 选择档位时取消待删除
      const slot = this.store.readSlot(index);
      if (!slot) { this._newGame(index); return; }
      if (this._saveMode === 'overwrite') {
        if (this._pendingOverwrite === index) { this._newGame(index); return; }
        this._pendingOverwrite = index;
        this._refreshSaveScreen();
        return;
      }
      this._loadSlot(index);
    }

    /** 删除存档位：首次点击进入确认态，再次点击才真正清空（不可恢复） */
    _onSlotDelete(index) {
      if (this.state !== STATE.TITLE || this._cloudBusy()) return;
      this._cloudConfirm = null;
      const screen = this._ui.saveScreen;
      if (!screen || (screen.classList && screen.classList.contains('hidden'))) return;
      if (!this.store.readSlot(index)) return;
      if (this._pendingDelete !== index) {
        this._pendingDelete = index;
        this._pendingOverwrite = -1;
        this._refreshSaveScreen();
        return;
      }
      this._pendingDelete = -1;
      if (this.store.clearSlot(index)) {
        if (this.cloud) this.cloud.forget(index);
        this._refreshTitle();
        this._refreshSaveScreen();
      } else {
        this._text(this._ui.saveNote, '删除失败：浏览器本地存储不可用');
      }
    }

    /** 渲染 3 个存档位（关卡 / 星数 / 已通关数）与底部提示 */
    /** 实际上传/下载期间阻止档位切换；读取元数据不阻塞本地游玩。 */
    _cloudBusy() {
      return !!(this.cloud && this.cloud.busy.some(Boolean));
    }

    _refreshSaveScreen() {
      this._refreshCloudUI();
      const slots = this.store.readAll();
      for (let i = 0; i < SLOT_COUNT; i++) {
        const btn = this._ui.slotBtns[i];
        const meta = this._ui.slotMetas[i];
        const del = this._ui.slotDelBtns[i];
        const slot = slots[i];
        const confirming = !!slot && this._pendingOverwrite === i;
        const deleting = !!slot && this._pendingDelete === i;
        if (btn && btn.classList) {
          btn.classList.toggle('slot-empty', !slot);
          btn.classList.toggle('slot-confirm', confirming);
        }
        if (del && del.classList) {
          del.classList.toggle('hidden', !slot);
          del.classList.toggle('slot-del-confirm', deleting);
        }
        if (!meta) continue;
        if (!slot) { this._text(meta, '空档 · 点击开始新游戏'); continue; }
        const lv = this._levelById(slot.current);
        const total = lv ? this._starCountOf(lv) : 0;
        const got = (slot.stars[String(slot.current)] || []).length;
        const name = lv ? lv.title : '第 ' + slot.current + ' 关';
        const tail = deleting ? ' · 再点一次删除' : (confirming ? ' · 再点一次覆盖' : '');
        this._text(meta, name + ' · ★ ' + got + '/' + total + ' · 已通关 ' + slot.cleared.length + tail);
      }
      const note = this._ui.saveNote;
      if (!note) return;
      if (this.store.corrupt) {
        this._text(note, '存档数据损坏，已按空档处理；下次保存会覆盖损坏数据');
      } else if (this._pendingDelete >= 0) {
        this._text(note, '确认删除存档 ' + (this._pendingDelete + 1) + '？再点一次 ✕ 删除（不可恢复）');
      } else if (this._pendingOverwrite >= 0) {
        this._text(note, '存档 ' + (this._pendingOverwrite + 1) + ' 已有进度，再点一次覆盖为新游戏');
      } else if (!this.store.available) {
        this._text(note, '浏览器本地存储不可用，无法保存进度');
      } else {
        this._text(note, '存档保存在本机浏览器 · 仅「保存并退出」与通关自动存档会写入');
      }
    }

    /**
     * 写入当前存档位（手动保存 / 通关自动存档共用）。
     * patch 可覆盖 current / unlocked / cleared（通关时指向下一关）。
     * @returns {boolean} 是否写盘成功
     */
    _writeSave(patch) {
      if (!this.saveData || !this.level || this.saveSlotIndex < 0) return false;
      const s = this.saveData;
      s.v = SAVE_VERSION;
      s.slot = this.saveSlotIndex + 1;
      s.current = this.level.id;
      s.stars[String(this.level.id)] = this.collected.slice();
      s.sheep = Math.max(0, this.sheepCount || 0);
      s.played = Array.from(this._playedNodes);
      s.unlocked = Math.max(1, Number(s.unlocked) || 1, s.current);
      if (patch) Object.assign(s, patch);
      s.unlocked = Math.max(1, Number(s.unlocked) || 1, Number(s.current) || 1);
      s.updatedAt = Math.max(Date.now(), ((this.store.readSlot(this.saveSlotIndex) || {}).updatedAt || 0) + 1);
      const ok = this.store.writeSlot(this.saveSlotIndex, s);
      if (ok) {
        if (this.cloud) this._cloudTask = this.cloud.save(this.saveSlotIndex, cloneSlot(s));
        if (this.stats) {
          this.stats.flush();
          const uid = this._currentUserId();
          this._statsTask = Promise.resolve(this._cloudTask).then(() => {
            if (!this._destroyed && this._currentUserId() === uid) return this.stats.sync();
          });
        }
        if (this.onEvent) {
          try {
            this.onEvent('save', { slot: this.saveSlotIndex, level: s.current, cleared: s.cleared.length });
          } catch (e) { /* 钩子异常不阻断 */ }
        }
        this._refreshTitle();
      }
      return ok;
    }

    /** 暂停菜单「保存并退出」：写盘成功后回标题；失败则留在暂停界面提示 */
    _saveAndQuit() {
      if (this.state !== STATE.PAUSED) return false;
      if (!this._writeSave()) {
        this._text(this._ui.pauseNote, '保存失败：浏览器本地存储不可用或已写满');
        return false;
      }
      this._quitToTitle();
      return true;
    }

    /** 当前循环里可用关卡数据按 id 查找 */
    _levelById(id) {
      for (let i = 0; i < this.levels.length; i++) {
        if (this.levels[i].id === id) return this.levels[i];
      }
      return null;
    }

    /** 关卡星数（关卡数据优先；与实例态无关，供存档界面展示） */
    _starCountOf(lv) {
      if (!lv) return 0;
      if (typeof lv.starCount === 'number' && lv.starCount > 0) return lv.starCount;
      return (lv.entities || []).filter((e) => e.type === 'star').length;
    }

    /** 声音按钮文案与当前设置一致（标题快捷开关 + 设置界面按钮；#44） */
    _applySoundState() {
      this._text(this._ui.btnSound, this.soundOn ? '♪ 声音：开' : '♪ 声音：关');
      const prefBtn = this._ui.btnPrefSound;
      if (prefBtn) {
        this._text(prefBtn, this.soundOn ? '♪ 声音：开' : '♪ 声音：关');
        if (prefBtn.classList) prefBtn.classList.toggle('pref-on', !!this.soundOn);
      }
      const audio = this.root.MIXX && this.root.MIXX.audio;
      if (audio && typeof audio.setEnabled === 'function') {
        try { audio.setEnabled(this.soundOn); } catch (e) { /* 音频不可用不阻断游戏 */ }
      }
    }

    /**
     * 读独立设置（与存档位无关）：{ v, sound, touch }。
     * 缺失/损坏/显式版本不兼容时按默认值，兼容缺少 v 的旧记录；
     * `_settingsStored` 记录「本机是否已有有效设置记录」，
     * 供 #44 判断能否采用云端偏好（新设备才采用，老玩家本地优先）。
     */
    _readSettings() {
      const fallback = { v: SAVE_VERSION, sound: true, touch: 'auto' };
      this._settingsStored = false;
      if (!this.storage) return fallback;
      try {
        const raw = this.storage.getItem(SETTINGS_KEY);
        if (!raw) return fallback;
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || Array.isArray(data)
          || (Object.prototype.hasOwnProperty.call(data, 'v') && data.v !== SAVE_VERSION)) return fallback;
        this._settingsStored = true;
        return {
          v: SAVE_VERSION,
          sound: data.sound !== false,
          touch: normalizeTouchMode(data.touch),
        };
      } catch (e) {
        return fallback;
      }
    }

    /** 写本地设置（声音/触屏偏好立即生效；写入成功标记「本机已有设置记录」） */
    _writeSettings() {
      if (!this.storage) return false;
      try {
        this.storage.setItem(SETTINGS_KEY, JSON.stringify(this._settings));
        this._settingsStored = true;
        return true;
      } catch (e) {
        return false; // 配额/禁用：内存设置仍立即生效，只是刷新后丢失
      }
    }

    /* ── 关卡生命周期 ── */

    /**
     * 加载关卡：浅克隆关卡与实体层（data.js 数据只读，运行时标记不落回共享数据），
     * 重置玩家/星数/计时/相机后进入 PLAYING。重玩与过关共用此入口。
     * @param {number} i 关卡下标
     * @param {object} [opts] { restore:true } 读档时按 saveData.stars 恢复已收集星
     */
    _loadLevel(i, opts) {
      const lv = this.levels[i];
      if (!lv) return;
      this.scene = null;
      const restore = !!(opts && opts.restore) && !!this.saveData;
      this.levelIndex = i;
      this.level = Object.assign({}, lv, {
        entities: (lv.entities || []).map((e) => Object.assign({}, e)),
      });
      this.mechanics = engine.createMechanics(this.level); // #9 碰撞/推箱/开关门
      this.combat = this.level.combat === false ? null : engine.createCombat(this.level);
      this.birthday = this.level.party && root.MIXX.Birthday ? new root.MIXX.Birthday(this) : null;
      this._hudEnergyPct = -1;
      this._hudHp = -1;
      this._hudEnergyReady = false;
      this.particles.clear();
      this._pendingNextIndex = -1;
      const spawn = this._entitiesOf('spawn')[0] || { x: 2, y: 2 };
      this._pendingNextUnavailable = false;
      this.player = { x: spawn.x * TILE, y: spawn.y * TILE };
      this.carriedBox = null;
      this.facing = { x: 0, y: -1 };
      this.stars = 0;
      this.collected = [];
      if (restore) {
        const saved = this.saveData.stars[String(this.level.id)] || [];
        for (const e of this._entitiesOf('star')) {
          if (saved.indexOf(e.id) >= 0) {
            e.collected = true;
            this.collected.push(e.id);
          }
        }
        this.stars = this.collected.length;
        this.saveData.current = this.level.id;
      }
      this._portalWasActive = this._portalActive(); // 读档已集齐时不重播激活演出
      this.runTime = 0;
      this._dialog = null;
      this._entryFade = Number(lv.entryFade) || 0;
      this.camera.x = 0;
      this.camera.y = 0;
      this._followCamera();
      this._syncProgressLocks();
      if (restore) {
        const entrance = this._entitiesOf('roomdoor').find(e => e.arrivalNode && this._playedNodes.has(e.arrivalNode));
        const gate = entrance && this._entitiesOf('gate').find(g => g.x === entrance.x && g.y === entrance.y);
        if (entrance && (!gate || gate.open)) {
          this.player.x = entrance.to.x * TILE; this.player.y = entrance.to.y * TILE;
          this._followCamera();
        }
      }
      this._syncSwitches(true); // 初始化开关/门状态（spawn 压住开关等边界情况）
      this._refreshHud();
      this._setState(STATE.PLAYING);
      if (this.onEvent) {
        try { this.onEvent('restart', { level: this.levelIndex }); } catch (e) { /* 忽略钩子异常 */ }
      }
      // 关卡加载自动演出；序章仅由新游戏入口调度，读档/重玩不触发。
      this._dispatchAuto('load:' + this.level.id);
    }

    _restartLevel() {
      if (this.state !== STATE.PAUSED) return;
      for (const e of this._entitiesOf('roomdoor')) if (e.arrivalNode) this._playedNodes.delete(e.arrivalNode);
      this._loadLevel(this.levelIndex);
    }

    /** 回标题（不写盘）：放弃上次存档之后的进度；存档本身保持不动 */
    _quitToTitle(fromClear) {
      if (this.state !== STATE.PAUSED && this.state !== STATE.ENDING
        && !(fromClear === true && this.state === STATE.CLEAR)) return;
      this._syncStats();
      this.level = null;
      this.player = null;
      this.carriedBox = null;
      this.stars = 0;
      this.collected = [];
      this.runTime = 0;
      this._dialog = null;
      this.mechanics = null;
      this.combat = null;
      this.particles.clear();
      this._portalWasActive = false;
      this._pendingNextIndex = -1;
      this.levelIndex = 0;
      this.saveData = null;
      this.saveSlotIndex = -1;
      this._playedNodes = new Set();
      this._npcTarget = {};
      this.sheepCount = 0;
      this._pendingOverwrite = -1;
      this._pendingDelete = -1;
      this._setState(STATE.TITLE);
    }

    /* ── 结算与结局 ── */

    _onLevelClear() {
      const lv = this.level;
      const starCount = this._starCount();
      const clearText = '星星 ' + this.stars + '/' + starCount + ' · 用时 ' + formatTime(this.runTime);
      this._text(this._ui.clearText, clearText);
      const nextIndex = this._nextLevelIndex(); // 优先 portal.to，其次线性下一关
      const portal = this._entitiesOf('portal')[0];
      this._pendingNextUnavailable = !!portal && Number.isInteger(portal.to) && nextIndex < 0;
      const isLast = nextIndex < 0 && !this._pendingNextUnavailable;
      if (this.stats) {
        if (lv.id > 0) this.stats.unlock('first_clear');
        const completed = new Set((this.saveData && this.saveData.cleared || []).concat(lv.id));
        if (isLast && this.dataSource === 'data' && this.levels.some(l => l.id === 6)
          && this.levels.filter(l => l.id > 0).every(l => completed.has(l.id))) this.stats.unlock('journey_complete');
      }
      this._pendingNextIsEnding = isLast;
      this._pendingNextIndex = nextIndex;
      this._text(this._ui.btnNext, this._pendingNextUnavailable
        ? '↩ 回到标题（后续关卡制作中）' : isLast ? '▶ 见证结局' : '▶ 下一关');
      // 通关自动存档：记录已收集星、cleared、unlocked，current 指向下一关（末关停留在本关）
      if (this.saveData) {
        const cleared = this.saveData.cleared.slice();
        if (cleared.indexOf(lv.id) < 0) cleared.push(lv.id);
        const next = isLast ? null : this.levels[nextIndex];
        const nextId = next ? next.id : lv.id;
        if (!this._writeSave({
          current: nextId,
          unlocked: Math.max(Number(this.saveData.unlocked) || 1, nextId, lv.id),
          cleared: cleared,
        })) {
          this._text(this._ui.clearText, clearText + ' · 自动存档失败：浏览器本地存储不可用或已写满');
        }
      }
      this._setState(STATE.CLEAR);
      if (this.onEvent) {
        try {
          this.onEvent('clear', { level: lv.id, stars: this.stars, starCount: starCount });
        } catch (e) { /* 忽略钩子异常 */ }
      }
    }

    _nextFromClear() {
      if (this.state !== STATE.CLEAR) return;
      if (this._pendingNextUnavailable) {
        this._quitToTitle(true);
      } else if (this._pendingNextIsEnding) {
        this._enterEnding();
      } else if (this._pendingNextIndex >= 0) {
        this._loadLevel(this._pendingNextIndex);
      } else {
        this._loadLevel(this.levelIndex + 1); // 兜底（#11 数据未写 portal.to 时）
      }
    }

    /** 关卡 id → 下标；找不到返回 -1 */
    _levelIndexById(id) {
      for (let i = 0; i < this.levels.length; i++) {
        if (this.levels[i].id === id) return i;
      }
      return -1;
    }

    /** 下一关下标：portal.to 优先；无 portal.to 按数组下一关；末关返回 -1 */
    _nextLevelIndex() {
      const portal = this._entitiesOf('portal')[0];
      const to = portal && Number(portal.to);
      if (isFinite(to) && to > 0) {
        const byPortal = this._levelIndexById(to);
        return byPortal; // 未制作的显式出口不能回退到别关或提前播放终章
      }
      const next = this.levelIndex + 1;
      return next < this.levels.length ? next : -1;
    }

    /** 进入结局：占位文案（#12 接入 l6.end 台词、#15 接入演出） */
    _enterEnding() {
      this._setEndingBody(this._endingLines());
      this._setState(STATE.ENDING);
    }

    /** 填充/清空结局文案；离开结局态时以空数组调用即清空 */
    _setEndingBody(lines) {
      const el = this._ui.endingBody;
      if (!el) return;
      if (typeof el.innerHTML === 'string') {
        // 真实 DOM：innerHTML 一次写入即替换全部内容（不得再清 textContent，否则会抹掉段落）
        el.innerHTML = lines
          .map((t) => '<p>' + String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>')
          .join('');
      } else if (typeof el.textContent === 'string') {
        el.textContent = lines.join('\n');
      }
    }

    /** 结局文案：data.js 的 l6.end 就位后采用，否则占位 */
    _endingLines() {
      const node = this.dialogue['l6.end'];
      if (node && Array.isArray(node.lines) && node.lines.length) {
        return node.lines.map((l) => l.t);
      }
      return BOOT_ENDING;
    }

    /* ── 对话（Issue #7：打字机 + 姓名框 + 翻页；Issue #12：节点语义 + 选项列表） ── */

    /**
     * 播放对话节点：进入对话态，从第一行开始打字机显示。
     * @param {string} nodeId 对话节点 id
     * @param {object} [opts] { autoChain: 自动串联 next（自动事件用）, onEnd: 完成回调 }
     */
    _playNode(nodeId, opts) {
      opts = opts || {};
      const node = opts.node || this.dialogue[nodeId];
      const lines = node && Array.isArray(node.lines) ? node.lines : [];
      if (!lines.length) {
        // 无内容不进入对话态；自动事件直接走完成回调，不打断流程
        if (opts.onEnd) { try { opts.onEnd(); } catch (err) { /* 回调异常不阻断 */ } }
        return;
      }
      if (node.once) this._playedNodes.add(nodeId);
      this._dialog = {
        nodeId: nodeId,
        lines: lines,
        idx: 0,         // 当前行号
        shown: 0,       // 当前行已显示字数
        t: 0,           // 打字机累计时间（ms）
        typing: true,   // 当前行是否仍在逐字显示
        holdTyping: false, // 本行打字期间按住互动键的标记（点按快进/长按加速）
        holdTime: 0,    // 按住时长（ms）
        options: Array.isArray(node.options) && node.options.length ? node.options : null,
        optionsShown: false, // 台词播完后是否已进入选项模式
        optIdx: 0,      // 选项光标
        next: node.next || null,      // intro 的后续指向 / 自动事件的串联节点
        autoChain: !!opts.autoChain,  // 自动事件才在节点结束后自动播放 next
        onEnd: opts.onEnd || null,    // 完成回调（如 clear 播完 → 结算）
      };
      this._setState(STATE.DIALOGUE);
      this._startDialogLine();
    }

    /** 兼容旧调用：直接播放指定节点（占位关卡 boot.hi 等无 type/trigger 的线性节点） */
    _enterDialogue(nodeId) {
      this._playNode(nodeId);
    }

    /* ── 节点解析与自动事件分发（Issue #12，规格 GAME_DESIGN.md §7） ── */

    /**
     * 解析 NPC 互动应播放的节点：
     *   1. 显式绑定（dialogue 字段）且其 trigger 不匹配 npc:<该实体id> → 直接采用；
     *   2. 否则按 trigger 解析：首次 intro（once，记录 next 目标）→
     *      npc 自我介绍（once）→ intro.next 指向的 hint（repeat）→ check（repeat）。
     */
    _resolveNpcNode(ent, preview) {
      const explicit = ent.dialogue;
      if (explicit && this.dialogue[explicit]) {
        const node = this.dialogue[explicit];
        if (node.trigger !== 'npc:' + ent.id) {
          // 占位/特殊 NPC 的显式线性节点：未播过（或无 once）即播
          if (!node.once || !this._playedNodes.has(explicit)) return explicit;
          return null;
        }
      }
      const key = 'npc:' + ent.id;
      const levelPrefix = 'l' + this.level.id + '.';
      const targetKey = this.level.id + ':' + (ent.room || 'hall') + ':' + ent.id;
      const cands = [];
      for (const id in this.dialogue) {
        const n = this.dialogue[id];
        if (id.indexOf(levelPrefix) === 0 && n.trigger === key && !n.entry
          && (n.room || 'hall') === (ent.room || 'hall')) cands.push({ id: id, node: n });
      }
      const unplayed = (type) => {
        for (const c of cands) {
          if (c.node.type === type && c.node.once && !this._playedNodes.has(c.id)) return c;
        }
        return null;
      };
      // 候选筛选也会解析节点；缓存 next 不能跳过尚未播放的 intro。
      const intro = unplayed('intro');
      if (intro) {
        if (intro.node.next && !preview) this._npcTarget[targetKey] = intro.node.next;
        return intro.id;
      }
      const target = this._npcTarget[targetKey];
      if (target && this.dialogue[target]) {
        // intro 已播：先补播未播的同 trigger npc 自我介绍（once），再回到 hint
        const npcOnce = unplayed('npc');
        if (npcOnce) return npcOnce.id;
        return target;
      }
      const npcOnce = unplayed('npc');
      if (npcOnce) return npcOnce.id;
      for (const c of cands) {
        if (c.node.once === false && (c.node.type === 'check' || c.node.type === 'hint')) return c.id;
      }
      return null;
    }

    /**
     * 按 trigger 查找自动事件入口：
     * clear:/load: 自动作用域须 entry:true（§7 约定，与 tools/validate.js #30 一致）；
     * star:/sheep:/cake 节点按 trigger 直接调度（不设 entry）。
     */
    _findAutoEntry(key) {
      const needsEntry = key.indexOf('clear:') === 0 || key.indexOf('load:') === 0;
      for (const id in this.dialogue) {
        const n = this.dialogue[id];
        if (n.trigger !== key) continue;
        if (needsEntry && n.entry !== true) continue;
        if (!n.once || !this._playedNodes.has(id)) return id;
      }
      return null;
    }

    /**
     * 自动事件分发（star / clear / load / cake 等）：
     * 找到入口节点则播放（自动串联 next），播完执行 onEnd；无节点则立即 onEnd。
     * @returns {boolean} 是否进入对话
     */
    _dispatchAuto(key, onEnd) {
      const nodeId = this._findAutoEntry(key);
      if (!nodeId) {
        if (onEnd) { try { onEnd(); } catch (err) { /* 回调异常不阻断 */ } }
        return false;
      }
      this._playNode(nodeId, { autoChain: true, onEnd: onEnd });
      return true;
    }

    /** 进入新行：重置打字机进度，渲染姓名框（nar 旁白隐藏标签）与空文本 */
    _startDialogLine() {
      const d = this._dialog;
      if (!d) return;
      d.shown = 0;
      d.t = 0;
      d.typing = true;
      d.holdTyping = false;
      d.holdTime = 0;
      const line = d.lines[d.idx];
      const ch = this.characters[line.s] || { name: line.s, color: '#FFFFFF' };
      const nameEl = this._ui.dialogName;
      const textEl = this._ui.dialogText;
      this._text(nameEl, ch.name);
      if (ch.name) {
        this._show(nameEl);
        if (nameEl && nameEl.style) nameEl.style.color = ch.color;
      } else {
        this._hide(nameEl); // nar 旁白：隐藏姓名标签
      }
      if (textEl && textEl.style) {
        textEl.style.color = ch.name ? '' : ch.color; // 旁白文字用角色色
      }
      this._text(textEl, '');
      this._text(this._ui.dialogHint, DIALOG_HINT_TYPING);
      if ((this.scene && this.scene.portraits === false)
        || (this.level && this.level.portraits === false)) this._hidePortrait();
      else this._setPortrait(line.s); // 说话人头像位（Issue #28）
    }

    /**
     * 说话人头像位（Issue #28）：按 speaker 加载素材立绘（对话框右上方框外、
     * 探出框顶，3:4 半身照，规格见 assets/characters/README.md）。
     * nar/all 等伪说话人直接隐藏；图片缺失由 onerror 降级隐藏，不影响对话流程。
     */
    _setPortrait(speaker) {
      const img = this._ui.dialogPortrait;
      if (!img) return;
      if (!speaker || PORTRAIT_NO_ART[speaker]) {
        this._hidePortrait();
        return;
      }
      const src = PORTRAIT_BASE + speaker + '/art/' + speaker + '-portrait.png';
      if (this._failedPortraits.has(src)) {
        this._hidePortrait();
        return;
      }
      this._show(img);
      const dialog = this._ui.dialog;
      if (dialog && dialog.classList) dialog.classList.add('has-portrait');
      img.onerror = () => {
        this._failedPortraits.add(src);
        this._hidePortrait();
      };
      if (this._portraitSrc !== src) {
        this._portraitSrc = src;
        img.src = src;
      }
    }

    /** 隐藏头像位并撤销对话框的 has-portrait 布局态 */
    _hidePortrait() {
      const img = this._ui.dialogPortrait;
      if (img) this._hide(img);
      const dialog = this._ui.dialog;
      if (dialog && dialog.classList) dialog.classList.remove('has-portrait');
    }

    /**
     * 对话态逐帧更新：
     *   1. 本行显示完时按 confirm → 翻页（末行则退出对话）；
     *   2. 打字中按 confirm 记录按住起点：<250ms 内松开（点按）→ 立即显示本行全文；
     *   3. 打字中按住 confirm → 打字加速（DIALOG_FAST_MS），长按松开不跳行。
     */
    _updateDialog(dt) {
      const d = this._dialog;
      if (!d) { this._setState(STATE.PLAYING); return; } // 防御：无进行态不留在对话态
      const pressed = this.input.wasPressed('confirm');
      const released = this.input.wasReleased('confirm');

      // 选项模式：↑↓ 移动光标，confirm 选择，其余按键忽略
      if (d.optionsShown) {
        if (this.input.wasPressed('up') && d.optIdx > 0) {
          d.optIdx--;
          this._renderOptions();
        } else if (this.input.wasPressed('down') && d.optIdx < d.options.length - 1) {
          d.optIdx++;
          this._renderOptions();
        } else if (pressed) {
          const opt = d.options[d.optIdx];
          const onEnd = d.onEnd;
          this._clearOptionsBox();
          this._playNode(opt.goto, { onEnd: onEnd });
        }
        return;
      }

      // 本行已显示完：按下即翻页（同一按下不再作用于新行，保证一次按键翻一页）
      if (pressed && !d.typing) {
        this._advanceDialog();
        return;
      }
      if (pressed) { // 打字中的按下：记录按住起点
        d.holdTyping = true;
        d.holdTime = 0;
      }
      if (!d.typing) return;

      // 点按快进：按住未超阈值即松开 → 立即显示本行全文
      if (released && d.holdTyping) {
        if (d.holdTime < DIALOG_TAP_MS) {
          this._completeDialogLine();
          d.holdTyping = false;
          d.holdTime = 0;
          return;
        }
        d.holdTyping = false;
        d.holdTime = 0;
      }

      // 打字推进：按住互动键时加速（快进）
      const held = d.holdTyping && this.input.isDown('confirm');
      const rate = held ? DIALOG_FAST_MS : DIALOG_MS;
      if (held) d.holdTime += dt * 1000;
      d.t += dt * 1000;
      const full = String(d.lines[d.idx].t);
      while (d.t >= rate && d.shown < full.length) {
        d.t -= rate;
        d.shown++;
      }
      if (d.shown >= full.length) {
        this._completeDialogLine();
      } else {
        this._renderDialogText();
      }
    }

    /** 本行打字完成：显示全文并切换翻页提示 */
    _completeDialogLine() {
      const d = this._dialog;
      if (!d) return;
      d.shown = String(d.lines[d.idx].t).length; // 立即显示全文（点按快进/自然打完共用）
      d.typing = false;
      d.holdTyping = false;
      d.holdTime = 0;
      this._renderDialogText();
      this._text(this._ui.dialogHint, DIALOG_HINT_PAGE);
    }

    /** 渲染当前行已显示的字符切片 */
    _renderDialogText() {
      const d = this._dialog;
      if (!d) return;
      const textEl = this._ui.dialogText;
      if (!textEl) return;
      this._text(textEl, String(d.lines[d.idx].t).slice(0, d.shown));
    }

    /** 翻页：本行未显示完不可翻页；末行翻页 → 选项模式 / 串联 next / 结束对话 */
    _advanceDialog() {
      const d = this._dialog;
      if (!d || d.typing) return;
      d.idx++;
      if (d.idx >= d.lines.length) {
        this._endDialogLines();
      } else {
        this._startDialogLine();
      }
    }

    /** 台词播完的收尾：优先选项 → 自动串联 next → 退出对话并执行完成回调 */
    _endDialogLines() {
      const d = this._dialog;
      if (!d) return;
      if (d.options && !d.optionsShown) {
        d.optionsShown = true;
        d.optIdx = 0;
        this._renderOptions();
        return;
      }
      if (d.next && d.autoChain && this.dialogue[d.next]) {
        const onEnd = d.onEnd; // 链尾沿用同一完成回调
        this._playNode(d.next, { autoChain: true, onEnd: onEnd });
        return;
      }
      const cb = d.onEnd;
      this._setState(STATE.PLAYING); // 离开对话态时 _leaveState 清空对话框与 _dialog
      if (cb) { try { cb(); } catch (err) { /* 回调异常不阻断 */ } }
    }

    /** 渲染选项列表：清空容器后逐项重建，当前项高亮 */
    _renderOptions() {
      const d = this._dialog;
      const box = this._ui.dialogOptions;
      if (!d || !box) return;
      this._clearOptionsBox();
      if (!d.options) return;
      for (let i = 0; i < d.options.length; i++) {
        const el = this.doc.createElement('div');
        el.className = 'dialog-option' + (i === d.optIdx ? ' selected' : '');
        el.textContent = (i === d.optIdx ? '▸ ' : '　') + d.options[i].label;
        box.appendChild(el);
      }
      this._text(this._ui.dialogHint, '↑↓ 选择 · E 确认');
    }

    /** 清空选项容器（textContent 与 children 都清，兼容真 DOM 与测试桩） */
    _clearOptionsBox() {
      const box = this._ui.dialogOptions;
      if (!box) return;
      if (typeof box.textContent === 'string') box.textContent = '';
      if (Array.isArray(box.children)) box.children.length = 0;
    }

    /** 点击对话框 = 点按：打字中立即显示全文，显示完则翻页（GAME_DESIGN §7 点击翻页；选项模式仅键盘操作） */
    _tapDialog() {
      if (this.state !== STATE.DIALOGUE) return;
      const d = this._dialog;
      if (!d) return;
      if (d.optionsShown) return;
      if (d.typing) this._completeDialogLine();
      else this._advanceDialog();
    }

    _clearDialog() {
      this._text(this._ui.dialogName, '');
      this._text(this._ui.dialogText, '');
      this._text(this._ui.dialogHint, DIALOG_HINT_PAGE);
      this._clearOptionsBox();
      this._hidePortrait();
      const img = this._ui.dialogPortrait;
      if (img) {
        this._portraitSrc = null;
        if (typeof img.removeAttribute === 'function') img.removeAttribute('src');
        else img.src = '';
        img.onerror = null;
      }
    }

    /* ── HUD ── */

    _dialogueComplete(id) {
      return this._playedNodes.has(id) && (!this._dialog || this._dialog.nodeId !== id);
    }

    /** 关键对话标记直接读取机关/星星的前置条件，与实际通关条件保持一致。 */
    _npcNeedsTalk(npc) {
      return this.level.entities.some(e => (e.requiresDialogue || []).some(id => {
        const node = this.dialogue[id];
        return node && node.type === 'npc' && node.trigger === 'npc:' + npc.id
          && (node.room || 'hall') === (npc.room || 'hall') && !this._dialogueComplete(id);
      }));
    }

    _objectiveText() {
      if (this.scene || !this.level || this.level.id !== 1) return '';
      const record = this._entitiesOf('record')[0];
      const music = this._entitiesOf('gramophone')[0];
      const star = this._entitiesOf('star').find(e => (e.requiresDialogue || []).some(id =>
        this.dialogue[id] && this.dialogue[id].room === 'backstage'));
      if (!record || !music || !star) return '';
      const intros = record.requiresDialogue || [];
      const missing = intros.filter(id => !this._dialogueComplete(id));
      const stars = record.requiresStars || [];
      const found = stars.filter(id => this.collected.includes(id)).length;
      if (missing.length) {
        if (missing.length === 1) {
          const name = (this.characters[this.dialogue[missing[0]].trigger.slice(4)] || {}).name;
          return '再和 ' + name + ' 聊聊 · ' + (intros.length - 1) + '/' + intros.length;
        }
        return '认识 Muse · ' + (intros.length - missing.length) + '/' + intros.length
          + '　寻找星星 · ' + found + '/' + stars.length;
      }
      if (found < stars.length) return this.collected.includes('s1')
        ? '去左上杂物间找星星 · E / A 开门' : '到左侧套圈摊位赢得星星 · E / A';
      if (!this._dialogueComplete(record.dialogue)) return '到左上杂物间取唱片 · E / A';
      if (!this._dialogueComplete(music.dialogue)) return '回舞台播放唱片 · E / A';
      const area = this._currentArea();
      if (!area || area.id !== 'backstage') return '从舞台右侧帘幕进入化妆间';
      const blessings = star.requiresDialogue || [];
      const left = blessings.filter(id => !this._dialogueComplete(id));
      if (left.length === 1) {
        const name = (this.characters[this.dialogue[left[0]].trigger.slice(4)] || {}).name;
        return '听听 ' + name + ' 的祝福 · ' + (blessings.length - 1) + '/' + blessings.length;
      }
      if (left.length) return '听后台的祝福 · ' + (blessings.length - left.length) + '/' + blessings.length;
      return star.collected ? '走进左侧星光门，完成生日会' : '收下化妆台左侧的最后一颗星';
    }

    _refreshHud() {
      this._text(this._ui.hudObjective, this._objectiveText());
      this._refreshCombatHud(true);
      if (this.scene) {
        this._text(this._ui.hudLevel, '序章 · ' + this.scene.title);
        this._text(this._ui.hudShards, '');
        return;
      }
      if (!this.level) return;
      const area = this.player && this._currentArea();
      this._text(this._ui.hudLevel, area && area.id === 'backstage' ? area.title : this.level.title);
      this._text(this._ui.hudShards, '★ ' + this.stars + '/' + this._starCount());
      // 注：关 6 总进度「★ x/25」等 HUD 扩展随 #11 接入
    }

    /**
     * 战斗 HUD（#18）：HP「♥ x/10」+ 被动能量条。
     * 每帧调用时只在整数百分比/血量/就绪态变化时写 DOM。
     * @param {boolean} [force] 换关/读档时强制刷新
     */
    _refreshCombatHud(force) {
      const c = this.combat;
      if (force) {
        if (this._ui.hud && this._ui.hud.classList) this._ui.hud.classList.toggle('peaceful', !c);
        for (const el of [this._ui.hudHp, this._ui.hudEnergy, this._ui.touchLight, this._ui.touchHeavy]) {
          if (c) this._show(el); else this._hide(el);
        }
        if (this._ui.touchLight) this._ui.touchLight.disabled = !c;
        if (this._ui.touchHeavy) this._ui.touchHeavy.disabled = !c;
      }
      if (!c) return;
      const pct = Math.round((c.energy / c.maxEnergy) * 100);
      const ready = c.energy >= c.maxEnergy;
      if (force || pct !== this._hudEnergyPct) {
        this._hudEnergyPct = pct;
        if (this._ui.hudEnergyFill && this._ui.hudEnergyFill.style) {
          this._ui.hudEnergyFill.style.width = pct + '%';
        }
        this._text(this._ui.hudEnergyLabel, ready ? 'F/G' : pct + '%');
      }
      if (force || ready !== this._hudEnergyReady) {
        this._hudEnergyReady = ready;
        if (this._ui.hudEnergy && this._ui.hudEnergy.classList) {
          this._ui.hudEnergy.classList.toggle('ready', ready);
        }
        if (this._ui.hudEnergy && typeof this._ui.hudEnergy.setAttribute === 'function') {
          this._ui.hudEnergy.setAttribute('aria-label', ready ? '能量炮就绪，按 F 或 G 释放' : '能量炮能量 ' + pct + '%');
        }
      }
      if (force || c.hp !== this._hudHp) {
        this._hudHp = c.hp;
        this._text(this._ui.hudHp, '♥ ' + c.hp + '/' + c.maxHp);
        if (this._ui.hudHp && this._ui.hudHp.classList) {
          this._ui.hudHp.classList.toggle('low', c.hp <= Math.max(1, Math.ceil(c.maxHp * 0.3)));
        }
      }
    }

    /* ── 工具 ── */

    /** 播放具名音效（声音关闭/音频模块缺失时安静跳过） */
    _sfx(name) {
      if (!this.soundOn) return false;
      const audio = this.root.MIXX && this.root.MIXX.audio;
      if (!audio || typeof audio.play !== 'function') return false;
      try { return audio.play(name); } catch (e) { return false; }
    }

    /** onEvent 钩子（测试/冒烟用；钩子异常不阻断游戏） */
    _emit(name, data) {
      if (!this.onEvent) return;
      try { this.onEvent(name, data); } catch (e) { /* 忽略钩子异常 */ }
    }

    _entitiesOf(type) {
      if (!this.level || !this.level.entities) return [];
      const out = [];
      const list = this.level.entities;
      for (let i = 0; i < list.length; i++) {
        if (list[i].type === type) out.push(list[i]);
      }
      return out;
    }

    _starCount() {
      if (!this.level) return 0;
      if (typeof this.level.starCount === 'number' && this.level.starCount > 0) {
        return this.level.starCount;
      }
      return this._entitiesOf('star').length;
    }

    _toggleSound() {
      this.soundOn = !this.soundOn;
      this._settings.sound = this.soundOn;
      this._applySoundState();
      const saved = this._writeSettings(); // 设置独立于存档位，立即生效
      if (!saved && this._settingsVisible()) {
        this._setSettingsMessage('声音已生效，但本机存储不可用（隐私模式或空间不足），刷新后会丢失。', 'error');
      }
      this._refreshCloudPrefsDiffer(); // 设置页「云端偏好与本机不同」提示随切换更新
    }

    _show(el) { if (el && el.classList) el.classList.remove('hidden'); }
    _hide(el) { if (el && el.classList) el.classList.add('hidden'); }
    _text(el, v) { if (el) el.textContent = v; }

    /** 切换状态或销毁实例时隐藏全部界面，包含账户设置及存储提示。 */
    _hideAllScreens() {
      this._hide(this._ui.titleScreen);
      this._hide(this._ui.helpScreen);
      this._hide(this._ui.saveScreen);
      this._hide(this._ui.loginScreen);
      this._hide(this._ui.settingsScreen); // #44
      this._hide(this._ui.accountNote);
      this._hide(this._ui.pauseScreen);
      this._hide(this._ui.clearScreen);
      this._hide(this._ui.endingScreen);
    }

    /* ── UI 接线 ── */

    /** DOM id → 代码内键名映射（缓存时按 camelCase 存取，避免点号/连字符混淆） */
    _cacheUI() {
      const aliases = {
        'hud': 'hud',
        'hud-level': 'hudLevel',
        'hud-shards': 'hudShards',
        'hud-objective': 'hudObjective',
        'tbtn-b': 'touchLight',
        'tbtn-c': 'touchHeavy',
        'hud-hp': 'hudHp',
        'hud-energy': 'hudEnergy',
        'hud-energy-fill': 'hudEnergyFill',
        'hud-energy-label': 'hudEnergyLabel',
        'title-screen': 'titleScreen',
        'btn-start': 'btnStart',
        'btn-continue': 'btnContinue',
        'btn-saves': 'btnSaves',
        'btn-help': 'btnHelp',
        'btn-sound': 'btnSound',
        'save-screen': 'saveScreen',
        'save-note': 'saveNote',
        'cloud-status': 'cloudStatus',
        'title-cloud-status': 'titleCloudStatus',
        'cloud-merge': 'cloudMerge',
        'btn-cloud-merge': 'btnCloudMerge',
        'btn-cloud-skip': 'btnCloudSkip',
        'btn-cloud-retry': 'btnCloudRetry',
        'btn-login-cloud': 'btnLoginCloud',
        'btn-slot-1': 'btnSlot1',
        'btn-slot-2': 'btnSlot2',
        'btn-slot-3': 'btnSlot3',
        'btn-slot-del-1': 'btnSlotDel1',
        'btn-slot-del-2': 'btnSlotDel2',
        'btn-slot-del-3': 'btnSlotDel3',
        'slot-meta-1': 'slotMeta1',
        'slot-meta-2': 'slotMeta2',
        'slot-meta-3': 'slotMeta3',
        'btn-save-back': 'btnSaveBack',
        'help-screen': 'helpScreen',
        'btn-help-back': 'btnHelpBack',
        'dialog': 'dialog',
        'dialog-backdrop': 'dialogBackdrop',
        'dialog-portrait': 'dialogPortrait',
        'dialog-name': 'dialogName',
        'dialog-text': 'dialogText',
        'dialog-hint': 'dialogHint',
        'dialog-options': 'dialogOptions',
        'pause-screen': 'pauseScreen',
        'btn-resume': 'btnResume',
        'btn-restart': 'btnRestart',
        'btn-quit': 'btnQuit',
        'btn-save-quit': 'btnSaveQuit',
        'pause-note': 'pauseNote',
        'clear-screen': 'clearScreen',
        'clear-text': 'clearText',
        'btn-next': 'btnNext',
        'ending-screen': 'endingScreen',
        'ending-body': 'endingBody',
        'btn-ending': 'btnEnding',
        'btn-account': 'btnAccount',
        'account-note': 'accountNote',
        'login-screen': 'loginScreen',
        'login-title': 'loginTitle',
        'login-form': 'loginForm',
        'login-email': 'loginEmail',
        'login-password': 'loginPassword',
        'login-msg': 'loginMsg',
        'login-account': 'loginAccount',
        'login-email-label': 'loginEmailLabel',
        'btn-login': 'btnLogin',
        'btn-register': 'btnRegister',
        'btn-logout': 'btnLogout',
        'btn-login-back': 'btnLoginBack',
        // #44 账户设置
        'btn-settings': 'btnSettings',
        'btn-title-settings': 'btnTitleSettings',
        'login-nickname-label': 'loginNicknameLabel',
        'login-account-note': 'loginAccountNote',
        'settings-screen': 'settingsScreen',
        'settings-account': 'settingsAccount',
        'settings-nickname': 'settingsNickname',
        'settings-nickname-count': 'settingsNicknameCount',
        'avatar-preview': 'avatarPreview',
        'avatar-preview-name': 'avatarPreviewName',
        'avatar-preview-face': 'avatarPreviewFace',
        'avatar-options': 'avatarOptions',
        'btn-pref-sound': 'btnPrefSound',
        'btn-pref-touch': 'btnPrefTouch',
        'settings-cloud-note': 'settingsCloudNote',
        'settings-msg': 'settingsMsg',
        'settings-password': 'settingsPassword',
        'password-form': 'passwordForm',
        'password-current': 'passwordCurrent',
        'password-new': 'passwordNew',
        'password-confirm': 'passwordConfirm',
        'password-msg': 'passwordMsg',
        'btn-password-save': 'btnPasswordSave',
        'btn-password-clear': 'btnPasswordClear',
        'stats-time': 'statsTime',
        'stats-collection': 'statsCollection',
        'stats-achievements': 'statsAchievements',
        'stats-status': 'statsStatus',
        'btn-stats-sync': 'btnStatsSync',
        'btn-settings-save': 'btnSettingsSave',
        'btn-settings-retry': 'btnSettingsRetry',
        'link-delete-account': 'linkDeleteAccount',
        'btn-settings-back': 'btnSettingsBack',
      };
      const doc = this.doc;
      const get = doc && typeof doc.getElementById === 'function'
        ? doc.getElementById.bind(doc) : null;
      for (const id of Object.keys(aliases)) {
        this._ui[aliases[id]] = get ? get(id) : null;
      }
      this._ui.slotBtns = [this._ui.btnSlot1, this._ui.btnSlot2, this._ui.btnSlot3];
      this._ui.slotMetas = [this._ui.slotMeta1, this._ui.slotMeta2, this._ui.slotMeta3];
      this._ui.slotDelBtns = [this._ui.btnSlotDel1, this._ui.btnSlotDel2, this._ui.btnSlotDel3];
      this._ui.cloudMetas = [1, 2, 3].map(i => get ? get('cloud-meta-' + i) : null);
      this._ui.cloudUploadBtns = [1, 2, 3].map(i => get ? get('btn-cloud-upload-' + i) : null);
      this._ui.cloudDownloadBtns = [1, 2, 3].map(i => get ? get('btn-cloud-download-' + i) : null);
      this._ui.avatarBtns = {}; // #44：按 GAME.avatarPresets 在 _renderAvatarOptions 中填充
    }

    /** 统一绑定菜单、账户设置与对话事件；通过 _on 登记，供销毁时解绑。 */
    _bindUI() {
      const ui = this._ui;
      this._on(ui.btnStart, 'click', () => this._startNewGame());
      this._on(ui.btnContinue, 'click', () => this._continueGame());
      this._on(ui.btnSaves, 'click', () => this._openSaveScreen('load'));
      this._on(ui.btnSaveBack, 'click', () => this._closeSaveScreen());
      for (let i = 0; i < SLOT_COUNT; i++) {
        this._on(ui.slotBtns[i], 'click', () => this._onSlotClick(i));
        this._on(ui.slotDelBtns[i], 'click', () => this._onSlotDelete(i));
        this._on(ui.cloudUploadBtns[i], 'click', () => this._onCloudChoice(i, 'upload'));
        this._on(ui.cloudDownloadBtns[i], 'click', () => this._onCloudChoice(i, 'download'));
      }
      this._on(ui.btnLoginCloud, 'click', () => this._openSaveScreen('load'));
      this._on(ui.btnCloudMerge, 'click', () => {
        if (this.state === STATE.TITLE && this.cloud && !this._cloudBusy()) {
          this._cloudTask = this.cloud.decide('merge').then(result => { this._syncStats(); return result; });
        }
      });
      this._on(ui.btnCloudSkip, 'click', () => {
        if (this.state === STATE.TITLE && this.cloud && !this._cloudBusy()) this._cloudTask = this.cloud.decide('cloud');
      });
      this._on(ui.btnCloudRetry, 'click', () => {
        if (this.state === STATE.TITLE && this.cloud && !this._cloudBusy()) {
          this._cloudConfirm = null;
          this._cloudTask = this.cloud.refresh(true).then(result => { this._syncStats(); return result; });
        }
      });
      this._on(ui.btnHelp, 'click', () => {
        if (this.state === STATE.TITLE) this._show(ui.helpScreen);
      });
      this._on(ui.btnHelpBack, 'click', () => {
        if (this.state === STATE.TITLE) this._hide(ui.helpScreen);
      });
      this._on(ui.btnSound, 'click', () => this._toggleSound());
      this._on(ui.btnAccount, 'click', () => this._openLoginScreen());
      this._on(ui.btnLoginBack, 'click', () => this._closeLoginScreen());
      this._on(ui.btnLogin, 'click', () => { this._authSubmit('signin'); });
      this._on(ui.btnRegister, 'click', () => { this._authSubmit('signup'); });
      this._on(ui.btnLogout, 'click', () => { this._logout(); });
      this._on(ui.loginEmail, 'keydown', (ev) => this._onLoginKeydown(ev));
      this._on(ui.loginPassword, 'keydown', (ev) => this._onLoginKeydown(ev));
      // #44 账户设置
      this._on(ui.btnSettings, 'click', () => { this._openSettingsScreen(); });
      this._on(ui.btnTitleSettings, 'click', () => { this._openSettingsScreen(); });
      this._on(ui.btnSettingsBack, 'click', () => { this._closeSettingsScreen(); });
      this._on(ui.passwordForm, 'submit', ev => {
        if (ev && ev.preventDefault) ev.preventDefault();
        this._onPasswordSubmit();
      });
      this._on(ui.btnPasswordClear, 'click', () => { if (!this._passwordBusy) this._resetPasswordForm(); });
      this._on(ui.btnStatsSync, 'click', () => { if (this._settingsVisible()) this._syncStats(); });
      this._on(this.root, 'pagehide', () => { if (this.stats) this.stats.flush(); });
      this._on(this.root, 'pagehide', () => this._resetPasswordForm());
      this._on(this.doc, 'visibilitychange', () => {
        if (this.doc.hidden && this.stats) this.stats.flush();
      });
      this._on(this.root, 'storage', ev => {
        if (ev.key === ACCOUNT_KEY || ev.key === null) this._resetPasswordForm();
        if (this.stats && this.auth && (ev.key === ACCOUNT_KEY || ev.key === null)) {
          let uid = '';
          try { uid = JSON.parse(ev.newValue).user.id; } catch (err) { /* Logout or damaged session. */ }
          if (uid !== this._currentUserId()) this.stats.suspend();
        }
      });
      this._on(ui.btnSettingsSave, 'click', () => { this._onSettingsSave(); });
      this._on(ui.btnSettingsRetry, 'click', () => {
        if (this._settingsVisible()) this._loadProfile();
      });
      this._on(ui.btnPrefSound, 'click', () => this._toggleSound());
      this._on(ui.btnPrefTouch, 'click', () => this._cycleTouchPref());
      this._on(ui.settingsNickname, 'input', () => this._onNicknameInput());
      this._on(ui.btnResume, 'click', () => {
        if (this.state === STATE.PAUSED) this._setState(STATE.PLAYING);
      });
      this._on(ui.btnRestart, 'click', () => this._restartLevel());
      this._on(ui.btnQuit, 'click', () => this._quitToTitle());
      this._on(ui.btnSaveQuit, 'click', () => this._saveAndQuit());
      this._on(ui.btnNext, 'click', () => this._nextFromClear());
      this._on(ui.btnEnding, 'click', () => this._quitToTitle());
      // 点击对话框翻页（Issue #7；打字中点击=快进本行）
      this._on(ui.dialog, 'click', () => this._tapDialog());
    }

    _on(el, type, fn) {
      if (!el || typeof el.addEventListener !== 'function') return;
      el.addEventListener(type, fn);
      this._uiHandlers.push([el, type, fn]);
    }

    /* ── 渲染 ── */

    _render() {
      const ctx = this.renderer.ctx;
      if (this.scene && this.state === STATE.DIALOGUE) {
        ctx.fillStyle = 'rgb(43,33,64)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        const img = this._sceneImages.get(this.scene.id);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, 0, 0, VIEW_W, VIEW_H);
        }
        return;
      }
      if (!this.level || this.state === STATE.TITLE || this.state === STATE.ENDING) {
        ctx.fillStyle = 'rgb(11,11,30)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        return;
      }
      this.renderer.renderLevel(this.level, this.camera);
      this._drawDecorations();
      this._drawEntities();
      this._drawCombat();  // #18 敌人（在玩家/攻击特效之下）
      this._drawPlayer();
      this._drawForegroundDecorations();
      if (this.carriedBox) this._drawGift(this.player.x / TILE - 0.2, this.player.y / TILE - 1.1);
      if (this._playedNodes.has('l1.record.take') && !this._playedNodes.has('l1.music.play')) {
        this._drawRecord(this.camera.x / TILE + 0.4, this.camera.y / TILE + 0.5, 0.8);
      }
      this._drawAttack();  // #18 挥击/能量炮（覆盖在角色之上）
      this.particles.draw(ctx, this.camera); // #9 拾取/开门/传送门粒子（画在角色之上）
      this._drawExterior();
      this._drawInteractionPrompt();
      if (this.level.sceneryAssets && typeof ctx.createRadialGradient === 'function') {
        const shade = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 70, VIEW_W / 2, VIEW_H / 2, 210);
        shade.addColorStop(0, 'rgba(18,29,50,0)');
        shade.addColorStop(1, 'rgba(11,18,42,0.18)');
        ctx.save();
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.restore();
      }
      if (this._entryFade > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, this._entryFade / (Number(this.level.entryFade) || 1));
        ctx.fillStyle = 'rgb(6,9,20)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.restore();
      }
      if (this.birthday) this.birthday.drawRings();
    }

    /** 占位实体绘制：仅用 fillRect（兼容测试桩与后续替换） */
    _drawEntities() {
      const ctx = this.renderer.ctx;
      const camX = this.camera.x;
      const camY = this.camera.y;
      const list = (this.level.entities || []).slice().sort((a, b) =>
        (ENTITY_DRAW_LAYER[a.type] || ENTITY_DRAW_LAYER_DEFAULT)
        - (ENTITY_DRAW_LAYER[b.type] || ENTITY_DRAW_LAYER_DEFAULT));
      for (const e of list) {
        const area = this._currentArea();
        if (area && e.room && e.room !== area.id) continue;
        const sx = Math.round(e.x * TILE - camX);
        const sy = Math.round(e.y * TILE - camY);
        if (sx < -TILE || sy < -TILE || sx > VIEW_W || sy > VIEW_H) continue;
        switch (e.type) {
          case 'star': {
            if (e.collected || !this._starAvailable(e)) continue;
            ctx.fillStyle = 'rgb(255,200,87)';
            ctx.fillRect(sx + 8, sy + 4, 1, 1);
            ctx.fillRect(sx + 7, sy + 5, 3, 1);
            ctx.fillRect(sx + 6, sy + 6, 5, 1);
            ctx.fillRect(sx + 7, sy + 7, 3, 1);
            ctx.fillRect(sx + 8, sy + 8, 1, 1);
            break;
          }
          case 'npc': {
            if (this.birthday) break;
            ctx.fillStyle = (this.characters[e.id] || {}).color || 'rgb(255,143,163)';
            ctx.fillRect(sx + 2, sy + 2, 12, 12);
            ctx.fillStyle = 'rgb(255,255,255)';
            ctx.fillRect(sx + 5, sy + 6, 2, 2);
            ctx.fillRect(sx + 9, sy + 6, 2, 2);
            if (this._npcNeedsTalk(e)) {
              this._drawTalkBubble(sx + 8, sy + 2);
            }
            break;
          }
          case 'sheep': {
            ctx.fillStyle = 'rgb(43,33,64)';
            ctx.fillRect(sx + 2, sy + 4, 12, 8);
            ctx.fillRect(sx + 3, sy + 12, 2, 3);
            ctx.fillRect(sx + 11, sy + 12, 2, 3);
            ctx.fillStyle = 'rgb(184,168,224)';
            ctx.fillRect(sx + 10, sy + 5, 5, 5);
            break;
          }
          case 'sign': {
            if (this._drawSceneryAsset({ art: 'backstage', frame: [1035, 0, 501, 550], x: e.x - 0.5, y: e.y - 1.1, w: 2, h: 2.2 })) break;
            ctx.fillStyle = 'rgb(93,65,73)';
            ctx.fillRect(sx + 7, sy + 8, 2, 8);
            ctx.fillRect(sx + 1, sy + 1, 14, 10);
            ctx.fillStyle = 'rgb(255,209,102)';
            ctx.fillRect(sx + 3, sy + 3, 10, 2);
            ctx.fillRect(sx + 3, sy + 7, 7, 1);
            break;
          }
          case 'box': {
            if (e.carried) continue;
            if (e.carryable && this._drawGift(e.x - 0.2, e.y - 0.5)) break;
            // 生日礼物盒：粉盒 + 奶油缎带 + 金星结
            ctx.fillStyle = 'rgb(255,143,163)';
            ctx.fillRect(sx + 1, sy + 1, 14, 14);
            ctx.fillStyle = 'rgb(240,230,210)';
            ctx.fillRect(sx + 7, sy + 1, 2, 14);
            ctx.fillRect(sx + 1, sy + 7, 14, 2);
            ctx.fillStyle = 'rgb(255,200,87)';
            ctx.fillRect(sx + 6, sy + 6, 4, 4);
            break;
          }
          case 'record': {
            if (!e.taken && !this.birthday) this._drawRecord(e.x, e.y, 0.9);
            break;
          }
          case 'gramophone': {
            if (!(this.level.decorations || []).some(d => d.kind === 'gramophone')) {
              this._drawSceneryAsset({ art: 'fitting', frame: [0, 512, 512, 512], x: e.x - 1, y: e.y - 2.6, w: 3, h: 3.6 });
            }
            if (this._playedNodes.has(e.dialogue) && typeof ctx.fillText === 'function') {
              ctx.fillStyle = 'rgb(255,220,137)'; ctx.font = '10px serif'; ctx.fillText('♪ ♫', sx + 5, sy - 27);
            }
            break;
          }
          case 'switch': {
            if (e.hidden) continue;
            if (this._drawSceneryAsset({ art: 'backstage', frame: [1090, 590, 400, 380],
              x: e.x - 0.15, y: e.y - 0.1 + (e.pressed ? 0.1 : 0), w: 1.3, h: 1.25 })) break;
            // 彩色音乐地垫：按下时变成薄荷绿
            ctx.fillStyle = 'rgb(26,16,51)';
            ctx.fillRect(sx, sy, 16, 16);
            const on = !!e.pressed;
            ctx.fillStyle = on ? 'rgb(94,230,184)' : 'rgb(255,143,163)';
            ctx.fillRect(sx + 2, sy + 2, 5, 5);
            ctx.fillRect(sx + 9, sy + 2, 5, 5);
            ctx.fillStyle = on ? 'rgb(255,200,87)' : 'rgb(180,155,255)';
            ctx.fillRect(sx + 2, sy + 9, 5, 5);
            ctx.fillRect(sx + 9, sy + 9, 5, 5);
            break;
          }
          case 'gate': {
            if (e.visual === 'curtain') break; // 房间入口统一绘制普通门 / 帘幕。
            if (e.id === 'gate1' && this.level.stageRect) {
              ctx.fillStyle = 'rgb(98,63,47)'; ctx.fillRect(sx, sy, 16, 16);
              ctx.fillStyle = 'rgb(221,186,132)';
              for (let i = 0; i < 3; i++) ctx.fillRect(sx + 1, sy + 3 + i * 5, 14, 2);
              if (!e.open) {
                ctx.fillStyle = 'rgb(133,67,95)'; ctx.fillRect(sx, sy + 6, 16, 5);
                ctx.fillStyle = 'rgb(244,206,131)'; ctx.fillRect(sx, sy + 7, 16, 1);
              }
              break;
            }
            // 舞台折叠屏风：关闭时是金色竖条栅栏，打开时只留两侧门柱
            if (e.open) {
              ctx.fillStyle = 'rgb(255,200,87)';
              ctx.fillRect(sx, sy, 2, 16);
              ctx.fillRect(sx + 14, sy, 2, 16);
              ctx.fillStyle = 'rgb(255,143,163)';
              ctx.fillRect(sx + 2, sy, 1, 16);
              ctx.fillRect(sx + 13, sy, 1, 16);
            } else {
              ctx.fillStyle = 'rgb(26,16,51)';
              ctx.fillRect(sx, sy, 16, 16);
              ctx.fillStyle = 'rgb(255,200,87)';
              for (let i = 0; i < 4; i++) ctx.fillRect(sx + 2 + i * 4, sy + 1, 2, 14);
              ctx.fillStyle = 'rgb(255,143,163)';
              ctx.fillRect(sx, sy + 7, 16, 2);
            }
            break;
          }
          case 'door': {
            if (this.birthday && this.birthday.inHall()) {
              if (!e.open) {
                ctx.fillStyle='#a87d58';ctx.fillRect(sx,sy-7,16,23);
                ctx.fillStyle='#73583f';ctx.fillRect(sx+2,sy-5,12,1);ctx.fillRect(sx+2,sy+5,12,1);
                ctx.fillStyle='#e2c68d';ctx.fillRect(sx+12,sy+9,2,2);
              }
              break;
            }
            ctx.fillStyle = 'rgb(83,57,54)'; ctx.fillRect(sx - 1, sy - 15, 18, 31);
            ctx.fillStyle = e.open ? 'rgb(28,37,61)' : 'rgb(177,126,88)';
            ctx.fillRect(sx + 1, sy - 13, 14, 28);
            if (!e.open) {
              ctx.fillStyle = 'rgb(225,191,128)'; ctx.fillRect(sx + 11, sy + 3, 2, 3);
              ctx.fillRect(sx + 3, sy - 10, 8, 8);
            }
            break;
          }
          case 'roomdoor':
          case 'portal': {
            if (e.type === 'roomdoor') {
              if (e.visual === 'curtain') break; // 直接走入前景幕布后的入口，不绘制门框或门板。
              const gate = this._entitiesOf('gate').find(g => g.x === e.x && g.y === e.y);
              const locked = gate && !gate.open;
              ctx.fillStyle = 'rgb(101,77,56)'; ctx.fillRect(sx - 5, sy - 21, 26, 39);
              ctx.fillStyle = 'rgb(226,203,156)'; ctx.fillRect(sx - 3, sy - 19, 22, 36);
              ctx.fillStyle = locked ? 'rgb(40,88,126)' : 'rgb(34,33,51)'; ctx.fillRect(sx, sy - 16, 16, 31);
              if (locked) {
                ctx.fillStyle = 'rgb(93,153,181)';
                for (let i = 2; i < 16; i += 4) ctx.fillRect(sx + i, sy - 15, 1, 29);
                ctx.fillStyle = 'rgb(232,191,106)'; ctx.fillRect(sx, sy + 2, 16, 1);
              } else {
                ctx.fillStyle = 'rgb(171,124,81)'; ctx.fillRect(sx + 13, sy - 16, 3, 30);
                ctx.fillStyle = 'rgb(241,207,139)'; ctx.fillRect(sx + 12, sy, 2, 2);
              }
              if (typeof ctx.fillText === 'function') {
                ctx.font = '7px monospace'; ctx.fillStyle = 'rgb(230,207,161)';
                ctx.fillText(locked ? '播放唱片后进入' : e.label || '出入口', sx - 14, sy + 25);
              }
              break;
            }
            if (this.level.sceneryAssets && this.level.sceneryAssets.portal) {
              const active = this._portalActive();
              const art = e.facing === 'east' && this.level.sceneryAssets.portalEast ? 'portalEast' : 'portal';
              ctx.save(); ctx.globalAlpha = active ? 1 : 0.7;
              const drawn = this._drawSceneryAsset({ art, x: e.x - 1, y: e.y - 3, w: 3, h: 4.5 });
              ctx.restore();
              if (drawn) {
                if (typeof ctx.fillText === 'function') {
                  ctx.fillStyle = 'rgb(248,225,177)'; ctx.font = '7px monospace';
                  const label = active ? '前往灯油长廊' : '星光门 · 尚未点亮';
                  ctx.fillText(label, sx - 24, sy + 20);
                }
                break;
              }
              if (typeof ctx.ellipse === 'function') {
                ctx.beginPath(); ctx.ellipse(sx + 8, sy - 12, 14, 23, 0, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgb(220,189,117)'; ctx.lineWidth = 2; ctx.stroke();
                break;
              }
            }
            const active = this._portalActive();
            ctx.fillStyle = active ? 'rgb(255,200,87)' : 'rgb(110,100,140)';
            ctx.fillRect(sx, sy, 16, 2);
            ctx.fillRect(sx, sy + 14, 16, 2);
            ctx.fillRect(sx, sy, 2, 16);
            ctx.fillRect(sx + 14, sy, 2, 16);
            ctx.fillStyle = active ? 'rgb(255,143,163)' : 'rgb(60,55,90)';
            ctx.fillRect(sx + 4, sy + 4, 8, 8);
            if (active) {
              ctx.fillStyle = 'rgb(255,242,200)';
              ctx.fillRect(sx + 7, sy + 6, 2, 4);
            }
            break;
          }
          default:
            break; // 其余实体（NPC 精灵、告示牌等）由 #13 渲染
        }
      }
    }

    /** 提示最后绘制，避免被人物和前景幕布挡住。 */
    _drawInteractionPrompt() {
      if (this.state !== STATE.PLAYING) return;
      if (this.birthday && this.birthday.rings) return;
      const ctx = this.renderer.ctx, camX = this.camera.x, camY = this.camera.y;
      const nearby = this.player && this._nearInteractable();
      if ((nearby || this.carriedBox) && typeof ctx.fillText === 'function') {
        const actor = nearby || this.carriedBox;
        const label = this.carriedBox ? '放下礼物盒' : actor.type === 'npc' ? (this.characters[actor.id] || {}).name
          : actor.type === 'minigame' ? '套圈集星' : actor.type === 'guest' ? '聊聊'
          : actor.type === 'sheep' ? '黑羊' : actor.type === 'door' ? '打开杂物间'
          : actor.type === 'record' ? '取走唱片' : actor.type === 'gramophone' ? '唱片机'
          : actor.type === 'box' ? actor.locked ? '礼物盒尚未解锁' : '拿起礼物盒' : '告示牌';
        const text = (label || '') + ' · E / A';
        const px = this.carriedBox ? this.player.x : actor.x * TILE;
        let py = this.carriedBox ? this.player.y - 12 : actor.y * TILE;
        if (this.birthday && (actor.type === 'npc' || actor.type === 'guest')) {
          py += (actor.spriteOffsetY || 0) * TILE + 14 - (actor.age === 'child' ? 25 : 40);
        }
        const x = Math.max(4, Math.min(VIEW_W - 100, px - camX - 24));
        const y = Math.max(12, Math.min(VIEW_H - 4, py - camY - 4));
        ctx.fillStyle = 'rgb(43,33,64)';
        ctx.fillRect(x - 2, y - 10, 100, 13);
        ctx.fillStyle = 'rgb(255,243,196)';
        ctx.font = '8px monospace';
        ctx.fillText(text, x, y);
      }
    }

    _drawGift(x, y) {
      return this._drawSceneryAsset({ art: 'backstage', frame: [540, 30, 480, 510], x, y, w: 1.5, h: 1.6 });
    }

    /** 官方封套原图与黑胶分开绘制，保留封面，不让生成图改写专辑设计。 */
    _drawRecord(x, y, size) {
      const ctx = this.renderer.ctx;
      const px = x * TILE - this.camera.x, py = y * TILE - this.camera.y;
      // 原专辑封套与独立黑胶：在三倍细节缓冲中绘制唱片沟槽与反光。
      ctx.fillStyle = 'rgb(60,46,62)';
      ctx.fillRect(px + size * 5, py - .33, size * 10, size * 11);
      this._drawSceneryAsset({ art: 'cover', x: x + size * .35, y, w: size * .65, h: size * .65 });
      const diameter = size * 12, n = 30, step = diameter / n;
      for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
        const dx = (ix + .5 - n/2)/(n/2), dy = (iy + .5 - n/2)/(n/2), r = Math.hypot(dx,dy);
        if (r > 1) continue;
        const groove = Math.floor(r * 20) % 2;
        let color = r > .92 ? '#181a24' : groove ? '#353642' : '#252733';
        if (dx < -.15 && dy < -.1 && r > .35 && r < .86) color = groove ? '#686a76' : '#454854';
        if (r < .3) color = r < .09 ? '#e9d6ac' : r < .14 ? '#443345' : '#cc8b9e';
        ctx.fillStyle = color; ctx.fillRect(px + ix * step, py + size * 2 + iy * step, step + .01, step + .01);
      }
    }

    /** 场景图集只负责绘制；碰撞由关卡的瓦片或精确脚底矩形决定。 */
    _drawSceneryAsset(d) {
      const lit = d.kind === 'cake' && this.stars >= this._starCount() && d.litArt;
      const src = (this.level.sceneryAssets || {})[lit ? d.litArt : d.art];
      const img = this._sceneryImages.get(src);
      if (!img || !img.complete || img.naturalWidth <= 0) return false;
      const frame = (lit ? d.litFrame : d.frame) || [0, 0, img.naturalWidth, img.naturalHeight];
      this.renderer.ctx.drawImage(img, frame[0], frame[1], frame[2], frame[3],
        Math.round(d.x * TILE - this.camera.x), Math.round(d.y * TILE - this.camera.y),
        Math.round(d.w * TILE), Math.round(d.h * TILE));
      return true;
    }

    /** 前景帘幕在人物之后绘制，使人物走入幕后时自然被遮挡。 */
    _drawForegroundDecorations() {
      if (this.birthday) this.birthday.drawCurtains();
      for (const d of this.level.decorations || []) {
        if (d.foreground && !d.baked) this._drawSceneryAsset(d);
      }
    }

    /** 场景地面与家具；尚未加载的图片可降级，不阻塞移动或剧情。 */
    _drawDecorations() {
      if (this.birthday && this.birthday.drawBackground()) return;
      const ctx = this.renderer.ctx;
      if (this.level.stageRect) {
        const r = this.level.stageRect;
        const x = r.x * TILE - this.camera.x, y = r.y * TILE - this.camera.y;
        ctx.fillStyle = 'rgb(158,110,74)'; ctx.fillRect(x, y, r.w * TILE, r.h * TILE);
        ctx.fillStyle = 'rgb(205,158,101)';
        for (let i = 0; i < r.h; i++) ctx.fillRect(x, y + i * TILE, r.w * TILE, 1);
        ctx.fillStyle = 'rgb(86,56,50)'; ctx.fillRect(x, y + r.h * TILE - 3, r.w * TILE, 3);
      }
      if (this.level.sceneryAssets) {
        // 只在真正墙体与地板交界处收边，不给每块墙砖重复加踢脚线。
        const rows = this.level.map.rows;
        for (let ty = 0; ty < this.level.map.h; ty++) {
          for (let tx = 0; tx < this.level.map.w; tx++) {
            if (rows[ty][tx] !== '#') continue;
            const x = Math.round(tx * TILE - this.camera.x), y = Math.round(ty * TILE - this.camera.y);
            if (x < -TILE || y < -TILE || x > VIEW_W || y > VIEW_H) continue;
            ctx.fillStyle = 'rgb(221,210,186)'; ctx.fillRect(x, y, TILE, TILE);
            const floorBelow = this.mechanics.tileType(tx, ty + 1) === 'floor';
            if (floorBelow) {
              ctx.fillStyle = 'rgb(119,85,63)'; ctx.fillRect(x, y + 9, TILE, 7);
              ctx.fillStyle = 'rgb(177,134,91)'; ctx.fillRect(x + 2, y + 11, 12, 3);
            }
            ctx.fillStyle = 'rgb(177,134,91)';
            if (floorBelow) ctx.fillRect(x, y + 13, TILE, 2);
            ctx.fillStyle = 'rgb(63,73,92)';
            if (this.mechanics.tileType(tx + 1, ty) === 'floor') ctx.fillRect(x + 14, y, 2, TILE);
            if (this.mechanics.tileType(tx - 1, ty) === 'floor') ctx.fillRect(x, y, 2, TILE);
          }
        }
      }
      for (const rug of this.level.groundDecorations || []) {
        const x = Math.round(rug.x * TILE - this.camera.x), y = Math.round(rug.y * TILE - this.camera.y);
        ctx.fillStyle = rug.border;
        ctx.fillRect(x, y, rug.w * TILE, rug.h * TILE);
        ctx.fillStyle = rug.color;
        ctx.fillRect(x + 2, y + 2, rug.w * TILE - 4, rug.h * TILE - 4);
        ctx.fillStyle = rug.border;
        for (let i = 8; i < rug.w * TILE - 8; i += 12) {
          ctx.fillRect(x + i, y + 5, 3, 1);
          ctx.fillRect(x + i, y + rug.h * TILE - 6, 3, 1);
        }
      }
      const decorations = (this.level.decorations || []).slice().sort((a, b) =>
        (a.kind === 'rug' ? -1 : 0) - (b.kind === 'rug' ? -1 : 0));
      for (const d of decorations) {
        if (d.foreground || d.baked) continue;
        const x = Math.round(d.x * TILE - this.camera.x);
        const y = Math.round(d.y * TILE - this.camera.y);
        if (x + (d.w || 2) * TILE < 0 || y + (d.h || 2) * TILE < 0 || x > VIEW_W || y > VIEW_H) continue;
        if (d.art && this._drawSceneryAsset(d)) continue;
        if (d.kind === 'stageSteps') {
          const width = (d.w || 1) * TILE;
          ctx.fillStyle = 'rgb(92,64,49)'; ctx.fillRect(x, y, width, 16);
          ctx.fillStyle = 'rgb(224,185,126)';
          for (let i = 0; i < 3; i++) ctx.fillRect(x, y + 2 + i * 5, width, 2);
        } else if (d.kind === 'chair') {
          ctx.fillStyle = 'rgb(184,224,210)';
          ctx.fillRect(x + 3, y + 2, 10, 5);
          ctx.fillRect(x + 2, y + 8, 12, 3);
          ctx.fillStyle = 'rgb(111,151,148)';
          ctx.fillRect(x + 3, y + 11, 2, 4);
          ctx.fillRect(x + 11, y + 11, 2, 4);
        } else if (d.kind === 'cake') {
          ctx.fillStyle = 'rgb(93,65,73)';
          ctx.fillRect(x - 4, y + 11, 24, 3);
          ctx.fillRect(x - 2, y + 14, 2, 2);
          ctx.fillRect(x + 16, y + 14, 2, 2);
          ctx.fillStyle = 'rgb(255,182,201)';
          ctx.fillRect(x + 1, y + 4, 14, 7);
          ctx.fillStyle = 'rgb(246,231,216)';
          ctx.fillRect(x + 1, y + 4, 14, 2);
          ctx.fillRect(x + 7, y, 2, 4);
          if (this.stars >= this._starCount()) {
            ctx.fillStyle = 'rgb(255,209,102)';
            ctx.fillRect(x + 7, y - 3, 2, 3);
          }
        } else if (d.kind === 'arch') {
          for (let i = 0; i < 7; i++) {
            ctx.fillStyle = i % 2 ? 'rgb(255,182,201)' : 'rgb(184,224,210)';
            const bx = x - 23 + i * 7;
            const by = y - 10 + Math.abs(i - 3) * 5;
            ctx.fillRect(bx, by, 6, 7);
            ctx.fillStyle = 'rgb(255,209,102)';
            ctx.fillRect(bx + 2, by + 7, 1, 9);
          }
        } else if (d.kind === 'curtain') {
          ctx.fillStyle = 'rgb(151,72,109)';
          ctx.fillRect(x, y, 16, 32);
          ctx.fillStyle = 'rgb(255,182,201)';
          ctx.fillRect(x + 3, y, 2, 32);
          ctx.fillStyle = 'rgb(255,209,102)';
          ctx.fillRect(x, y + 20, 16, 2);
        } else if (d.kind === 'bunting') {
          ctx.fillStyle = 'rgb(255,182,201)';
          ctx.fillRect(x, y, 32, 1);
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = i % 2 ? 'rgb(184,224,210)' : 'rgb(255,209,102)';
            ctx.fillRect(x + i * 8 + 1, y + 1, 6, 3);
            ctx.fillRect(x + i * 8 + 2, y + 4, 4, 2);
            ctx.fillRect(x + i * 8 + 3, y + 6, 2, 1);
          }
        }
      }
    }

    _drawExterior() {
      if (!this.level.outdoor) return;
      const area = this._currentArea();
      const b = area && area.id === 'backstage' ? area.rect : { x: 0, y: 0, w: 40, h: 28 };
      const ctx = this.renderer.ctx;
      for (let y = Math.floor(this.camera.y / TILE); y <= Math.floor((this.camera.y + VIEW_H) / TILE); y++) {
        for (let x = Math.floor(this.camera.x / TILE); x <= Math.floor((this.camera.x + VIEW_W) / TILE); x++) {
          if (x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h) continue;
          const px = Math.round(x * TILE - this.camera.x), py = Math.round(y * TILE - this.camera.y);
          ctx.fillStyle = (x + y) % 2 ? 'rgb(77,104,73)' : 'rgb(81,109,76)';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = 'rgb(111,140,87)';
          ctx.fillRect(px + 3, py + 4, 1, 3); ctx.fillRect(px + 10, py + 11, 2, 1);
          if (Math.abs(x * 13 + y * 7) % 9 === 0) {
            ctx.fillStyle = 'rgb(231,204,153)'; ctx.fillRect(px + 7, py + 7, 2, 2);
          }
        }
      }
    }

    /**
     * 敌人绘制（#18）：梦蚀团=紫粉方块、梦蚀灵=薄荷绿漂浮方块；
     * 受击白闪、受伤后显示血条。运行时坐标来自 combat.enemies（非实体出生点）。
     */
    _drawCombat() {
      const c = this.combat;
      if (!c) return;
      const ctx = this.renderer.ctx;
      const camX = this.camera.x;
      const camY = this.camera.y;
      for (let i = 0; i < c.enemies.length; i++) {
        const e = c.enemies[i];
        if (e.dead) continue;
        const bob = e.kind === 'wisp' ? Math.round(Math.sin(c.time * 5 + e.spawnX * 0.1)) : 0;
        const sx = Math.round(e.x - camX);
        const sy = Math.round(e.y - camY) + bob;
        if (sx < -TILE || sy < -TILE || sx > VIEW_W || sy > VIEW_H) continue;
        // 影子
        ctx.fillStyle = 'rgb(26,16,51)';
        ctx.fillRect(sx + 1, sy + e.size - 2, e.size - 2, 2);
        // 身体 + 描边
        const flash = e.hurt > 0;
        ctx.fillStyle = flash ? 'rgb(255,255,255)' : (e.kind === 'wisp' ? 'rgb(94,230,184)' : 'rgb(180,155,255)');
        ctx.fillRect(sx, sy, e.size, e.size);
        ctx.fillStyle = 'rgb(40,24,70)';
        ctx.fillRect(sx, sy, e.size, 1);
        ctx.fillRect(sx, sy + e.size - 1, e.size, 1);
        ctx.fillRect(sx, sy, 1, e.size);
        ctx.fillRect(sx + e.size - 1, sy, 1, e.size);
        // 眼睛
        ctx.fillStyle = flash ? 'rgb(255,143,163)' : 'rgb(26,16,51)';
        ctx.fillRect(sx + 3, sy + 4, 2, 2);
        ctx.fillRect(sx + 7, sy + 4, 2, 2);
        // 血条（满血不显示，减少视觉噪音）
        if (e.hp < e.maxHp) {
          ctx.fillStyle = 'rgb(26,16,51)';
          ctx.fillRect(sx, sy - 4, e.size, 3);
          ctx.fillStyle = 'rgb(255,143,163)';
          ctx.fillRect(sx, sy - 4, Math.max(1, Math.round(e.size * (e.hp / e.maxHp))), 2);
        }
      }
    }

    /**
     * 攻击特效（#18）：轻/重击为前方短促棒击轨迹，能量炮为 2.2 倍射程的
     * 像素光束。只用 fillRect，保持零素材与测试桩兼容。
     */
    _drawAttack() {
      const c = this.combat;
      const s = c && c.swing;
      if (!s) return;
      const ctx = this.renderer.ctx;
      const camX = this.camera.x;
      const camY = this.camera.y;
      const ox = Math.round(s.origin.x - camX);
      const oy = Math.round(s.origin.y - camY);
      const t = s.duration > 0 ? Math.min(1, s.t / s.duration) : 0;
      const dir = s.dir || { x: 0, y: 1 };

      if (s.kind === 'cannon') {
        // 像素光束：沿锁定方向逐点铺方块，支持斜向；外层粉 → 金 → 白核心
        const steps = Math.max(1, Math.ceil(s.range / 2));
        const pass = (color, half) => {
          ctx.fillStyle = color;
          for (let i = 0; i <= steps; i++) {
            const d = (i / steps) * s.range;
            const x = Math.round(ox + dir.x * d);
            const y = Math.round(oy + dir.y * d);
            ctx.fillRect(x - half, y - half, half * 2, half * 2);
          }
        };
        const outerHalf = Math.max(1, Math.floor(s.width / 2));
        pass('rgb(255,143,163)', outerHalf);
        if (t < 0.72) pass('rgb(255,200,87)', Math.max(1, outerHalf - 3));
        if (t < 0.45) pass('rgb(255,255,255)', 1);
        // 炮口闪光
        ctx.fillStyle = 'rgb(255,255,255)';
        ctx.fillRect(ox - 3, oy - 3, 6, 6);
        ctx.fillStyle = 'rgb(255,200,87)';
        ctx.fillRect(ox - 2, oy - 2, 4, 4);
        return;
      }

      // 普攻棒击轨迹：轻击白、重击粉；沿当前朝向（可斜向）铺短条
      const heavy = s.kind === 'heavy';
      const half = heavy ? 7 : 4;
      const near = 8;
      const far = s.range;
      const steps = 8;
      const pass = (color, h) => {
        ctx.fillStyle = color;
        for (let i = 0; i <= steps; i++) {
          const d = near + (far - near) * (i / steps);
          const x = Math.round(ox + dir.x * d);
          const y = Math.round(oy + dir.y * d);
          ctx.fillRect(x - h, y - h, h * 2, h * 2);
        }
      };
      pass(heavy ? 'rgb(255,143,163)' : 'rgb(255,255,255)', half);
      pass('rgb(255,200,87)', heavy ? 4 : 2);
    }

    /** 白底三点聊天气泡，尾巴指向人物；与当前角色的像素网格一致。 */
    _drawTalkBubble(centerX, headY) {
      const ctx = this.renderer.ctx, x = Math.round(centerX + 2), y = Math.round(headY - 13);
      ctx.fillStyle = 'rgb(35,37,44)';
      ctx.fillRect(x + 1, y, 10, 1);
      ctx.fillRect(x, y + 1, 12, 7);
      ctx.fillRect(x + 1, y + 8, 10, 1);
      ctx.fillRect(x + 2, y + 9, 4, 1);
      ctx.fillRect(x + 2, y + 10, 2, 1);
      ctx.fillStyle = 'rgb(255,253,244)';
      ctx.fillRect(x + 1, y + 1, 10, 7);
      ctx.fillRect(x + 2, y + 8, 4, 1);
      ctx.fillRect(x + 3, y + 9, 1, 1);
      ctx.fillStyle = 'rgb(35,37,44)';
      for (const offset of [3, 6, 9]) ctx.fillRect(x + offset, y + 4, 1, 1);
    }

    _drawPlayer() {
      if (!this.player) return;
      if (this.birthday) { this.birthday.drawActors(); return; }
      const ctx = this.renderer.ctx;
      const px = Math.round(this.player.x - this.camera.x);
      const py = Math.round(this.player.y - this.camera.y);
      const c = this.combat;
      const flash = !!(c && c.hurtFlash > 0);
      const blink = !!(c && c.invuln > 0 && Math.floor(c.time * 20) % 2 === 0);
      ctx.fillStyle = flash ? 'rgb(255,255,255)' : 'rgb(0,0,0)';
      ctx.fillRect(px - 1, py - 1, 18, 18);
      ctx.fillStyle = flash ? 'rgb(255,143,163)' : (blink ? 'rgb(255,200,87)' : 'rgb(255,255,255)');
      ctx.fillRect(px, py, 16, 16);
      ctx.fillStyle = 'rgb(26,16,51)';
      ctx.fillRect(px + 3, py + 3, 10, 10);
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.fillRect(px + 5, py + 5, 3, 3);
      ctx.fillRect(px + 10, py + 5, 3, 3);
      // 能量满：头顶一颗闪烁金星，提示可放能量炮
      if (c && c.energy >= c.maxEnergy) {
        ctx.fillStyle = Math.floor(c.time * 6) % 2 === 0 ? 'rgb(255,200,87)' : 'rgb(255,255,255)';
        ctx.fillRect(px + 7, py - 4, 2, 3);
        ctx.fillRect(px + 6, py - 3, 4, 1);
      }
    }
  }

  /* ════════════════════════ 自启动与公开 API ════════════════════════ */

  function boot(opts) {
    const doc = (opts && opts.doc) || (typeof document !== 'undefined' ? document : null);
    const canvas = doc && typeof doc.getElementById === 'function' ? doc.getElementById('game') : null;
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const game = new Game(canvas, opts);
    game.start();
    // 冒烟标志：无头浏览器验收「页面自启动成功」
    if (doc && doc.body && typeof doc.body.setAttribute === 'function') {
      doc.body.setAttribute('data-game-booted', 'ok');
    }
    return game;
  }

  const main = {
    VERSION: '0.4.0',
    STATE: STATE,
    Game: Game,
    boot: boot,
    buildBootLevels: buildBootLevels,
    formatTime: formatTime,
    SaveStore: SaveStore,
    CHANNEL: CHANNEL,
    CHANNELS: CHANNELS,
    channelKeys: channelKeys,
    resolveChannel: resolveChannel,
    SAVE_KEY: SAVE_KEY,
    SETTINGS_KEY: SETTINGS_KEY,
    ACCOUNT_KEY: ACCOUNT_KEY,
    SAVE_VERSION: SAVE_VERSION,
    SLOT_COUNT: SLOT_COUNT,
  };

  root.MIXX = root.MIXX || {};
  root.MIXX.main = main;

  // 浏览器自动启动（测试/冒烟页面设 MIXX_NO_BOOT = true 阻止）
  if (typeof document !== 'undefined' && !root.MIXX_NO_BOOT) {
    const go = () => { boot(); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', go);
    } else {
      go();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
