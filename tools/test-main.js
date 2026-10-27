#!/usr/bin/env node
/**
 * tools/test-main.js —— 游戏状态机与 UI 接线验证（Issue #6）+ 对话系统（Issue #7）
 *
 * 零依赖：Node 内置 assert + vm + tools/stub-canvas.js 的 Canvas 2D 桩。
 * 运行：node tools/test-main.js
 *
 * 完成标志验收（全状态往返切换无状态泄漏）：
 *   1. 六态常量与公开 API
 *   2. 标题 → 游玩 → 对话 → 游玩 → 暂停 → 游玩 → 结算 → 下一关 → 结算 → 结局 → 标题
 *      全链路往返，逐状态断言 UI 显隐 / 输入开关 / 虚拟按键显隐
 *   3. HUD：关名、星数「★ x/y」、HP「♥ 10/10」与被动能量条随战斗/换关刷新
 *   4. 无泄漏：单输入实例、单游戏循环、离开状态清空 DOM、重开新局零残留、
 *      关卡数据只读（重玩不残留收集标记）
 *   5. 状态守卫：错误状态下的按钮/按键不生效；destroy 后全部解绑
 *   6. index.html 存量文案更正（无「玻璃碎片」）与存档界面元素齐全
 *   7. 对话系统（Issue #7）：打字机 25ms/字、按住加速、点按快进、E/空格/Enter/点击
 *      翻页、旁白姓名框隐藏、对话期间玩家锁定与计时暂停、提示文案切换
 *   8. 存档系统（Issue #8）：3 存档位、继续/新游戏/选择存档、手动保存并退出、
 *      回到标题不写盘、通关自动存档、读档恢复星数/once/黑羊、损坏存档容错、
 *      存储不可用提示、声音设置独立持久化
 *   9. 收集与解谜机制（Issue #9）：门阻挡/开关开门、推箱压开关、星星粒子与音效、
 *      传送门激活、单关完整闭环（开门 → 取星 → 传送门 → 下一关）
 *  10. 账户（#43/#44）：登录/登出/会话恢复、登录后拉取 profile、账户设置界面
 *      （昵称/固定头像/声音/触屏偏好/删除申请）、昵称校验与云端偏好采用规则
 *  11. 战斗（Issue #18）：F 轻击 / G 重击、正面 180° 锁敌与墙体视线遮挡、能量炮 2.2 倍射程、
 *      HP/无敌帧/倒下复位、对话期间冻结、触屏 B/C 键与帮助文案
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { FakeCanvas } = require('./stub-canvas.js');

/* ─────────────────── DOM 桩 ─────────────────── */

/** main.js _cacheUI 需要的全部 id（与 index.html 一致） */
const UI_IDS = [
  'hud', 'hud-level', 'hud-shards', 'hud-hp',
  'hud-energy', 'hud-energy-fill', 'hud-energy-label',
  'title-screen', 'btn-start', 'btn-continue', 'btn-saves', 'btn-help', 'btn-sound',
  'save-screen', 'save-note', 'cloud-status', 'title-cloud-status', 'cloud-merge',
  'btn-cloud-merge', 'btn-cloud-skip', 'btn-cloud-retry', 'btn-login-cloud',
  'cloud-meta-1', 'cloud-meta-2', 'cloud-meta-3',
  'btn-cloud-upload-1', 'btn-cloud-upload-2', 'btn-cloud-upload-3',
  'btn-cloud-download-1', 'btn-cloud-download-2', 'btn-cloud-download-3',
  'btn-slot-1', 'btn-slot-2', 'btn-slot-3',
  'btn-slot-del-1', 'btn-slot-del-2', 'btn-slot-del-3',
  'slot-meta-1', 'slot-meta-2', 'slot-meta-3', 'btn-save-back',
  'help-screen', 'btn-help-back',
  'dialog', 'dialog-backdrop', 'dialog-portrait', 'dialog-name', 'dialog-text', 'dialog-hint', 'dialog-options',
  'pause-screen', 'btn-resume', 'btn-restart', 'btn-quit', 'btn-save-quit', 'pause-note',
  'clear-screen', 'clear-text', 'btn-next',
  'ending-screen', 'ending-body', 'btn-ending',
  'btn-account', 'btn-title-settings', 'account-note',
  'login-screen', 'login-title', 'login-form', 'login-email', 'login-password',
  'login-msg', 'login-account', 'login-email-label', 'login-nickname-label', 'login-account-note',
  'btn-login', 'btn-register', 'btn-logout', 'btn-login-back', 'btn-settings',
  'settings-screen', 'settings-account', 'settings-nickname', 'settings-nickname-count',
  'avatar-preview', 'avatar-preview-name', 'avatar-options',
  'btn-pref-sound', 'btn-pref-touch', 'settings-cloud-note', 'settings-msg',
  'btn-settings-retry', 'btn-settings-save', 'link-delete-account', 'btn-settings-back',
  'stats-time', 'stats-collection', 'stats-achievements', 'stats-status', 'btn-stats-sync',
  'touch-controls',
];

class FakeClassList {
  constructor() {
    this._set = new Set();
  }
  add(c) { this._set.add(c); }
  remove(c) { this._set.delete(c); }
  contains(c) { return this._set.has(c); }
  toggle(c, v) {
    const on = v === undefined ? !this._set.has(c) : !!v;
    if (on) this._set.add(c); else this._set.delete(c);
    return on;
  }
  toString() { return Array.from(this._set).join(' '); }
}

class FakeElement {
  constructor(tag, id) {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.classList = new FakeClassList();
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.disabled = false;
    this.children = [];
    this.attrs = {};
    this._listeners = {};
  }
  addEventListener(type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  appendChild(c) { this.children.push(c); return c; }
  click() { this._fire('click', {}); }
  _fire(type, ev) {
    for (const fn of (this._listeners[type] || []).slice()) fn(ev || {});
  }
}

const registry = new Map();
function el(tag, id) {
  const e = new FakeElement(tag, id);
  registry.set(id, e);
  return e;
}
// 初始化元素注册表（canvas 单独注册，FakeCanvas 实现 getContext）
for (const id of UI_IDS) el('div', id);
registry.set('game', new FakeCanvas());

// 复刻 index.html 初始状态：屏幕层/对话框/HUD/暂未开放按钮默认隐藏，按钮默认文案
for (const id of [
  'help-screen', 'save-screen', 'pause-screen', 'clear-screen', 'ending-screen',
  'dialog', 'dialog-backdrop', 'hud', 'btn-continue',
  'btn-slot-del-1', 'btn-slot-del-2', 'btn-slot-del-3',
  'login-screen', 'login-account', 'account-note',
  'settings-screen', 'btn-settings', 'btn-settings-retry',
]) {
  registry.get(id).classList.add('hidden');
}
registry.get('btn-sound').textContent = '♪ 声音：开';
registry.get('btn-pref-sound').textContent = '♪ 声音：开';
registry.get('btn-account').textContent = '☁ 登录 / 注册';
registry.get('login-title').textContent = '登录 / 注册';
registry.get('login-nickname-label').textContent = 'NSWER';
registry.get('login-account-note').textContent = '';
registry.get('settings-nickname-count').textContent = '0/16';
registry.get('btn-pref-touch').textContent = '📱 触屏按键：自动';
registry.get('settings-msg').textContent = '';
registry.get('btn-next').textContent = '▶ 下一关';
registry.get('dialog-hint').textContent = '▼ E / 空格';
for (let i = 1; i <= 3; i++) registry.get('slot-meta-' + i).textContent = '空档';

const documentStub = {
  readyState: 'complete',
  hidden: false,
  getElementById: (id) => registry.get(id) || null,
  querySelectorAll: () => [],
  createElement: (tag) => (tag === 'canvas' ? new FakeCanvas() : new FakeElement(tag, '')),
  addEventListener: () => {},
  removeEventListener: () => {},
};

const windowListeners = {};
const addEventListener = (type, fn) => {
  (windowListeners[type] || (windowListeners[type] = [])).push(fn);
};
const removeEventListener = (type, fn) => {
  const list = windowListeners[type];
  if (!list) return;
  const i = list.indexOf(fn);
  if (i >= 0) list.splice(i, 1);
};
function fireWindow(type, ev) {
  for (const fn of (windowListeners[type] || []).slice()) fn(ev);
}

/* ─────────────────── 沙箱与加载 ─────────────────── */

/** localStorage 桩（隔离每次 Node 进程；测试间可 clear） */
function createLocalStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(String(key)) ? map.get(String(key)) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(String(key)); },
    clear() { map.clear(); },
    key(i) { return Array.from(map.keys())[i] || null; },
    get length() { return map.size; },
  };
}
const localStorageStub = createLocalStorage();

let rafCount = 0;
let rafSeq = 0;
const sandbox = {
  console, setTimeout, clearTimeout, AbortController, URL,
  document: documentStub,
  localStorage: localStorageStub,
  MIXX_NO_DEMO: true, // 停用引擎演示
  MIXX_NO_BOOT: true, // 阻止 main.js 自启动，测试手动建实例
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener,
  removeEventListener,
  matchMedia: () => ({ matches: false }),
  navigator: {},
  requestAnimationFrame: () => {
    rafCount++;
    return ++rafSeq;
  },
  cancelAnimationFrame: () => {},
};
vm.createContext(sandbox);

const repoRoot = path.join(__dirname, '..');
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/data.js'), 'utf8'), sandbox, { filename: 'js/data.js' });
// 默认状态机 / 战斗用例使用占位关；真实序章与关 1 由 withGAME 单独安装。
// 保留账户头像元数据，避免生产地图和自动对话改变既有用例的起始状态。
sandbox.GAME = { avatarPresets: sandbox.GAME.avatarPresets };
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/engine.js'), 'utf8'), sandbox, { filename: 'js/engine.js' });
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/sprites.js'), 'utf8'), sandbox, { filename: 'js/sprites.js' });
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/audio.js'), 'utf8'), sandbox, { filename: 'js/audio.js' });
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/cloud-config.js'), 'utf8'), sandbox, { filename: 'js/cloud-config.js' });
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/auth.js'), 'utf8'), sandbox, { filename: 'js/auth.js' });
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/account.js'), 'utf8'), sandbox, { filename: 'js/account.js' });
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/cloud.js'), 'utf8'), sandbox, { filename: 'js/cloud.js' });
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/stats.js'), 'utf8'), sandbox, { filename: 'js/stats.js' });
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8'), sandbox, { filename: 'js/main.js' });

const main = sandbox.MIXX.main;
const STATE = main.STATE;
const engine = sandbox.MIXX.engine;
const audio = sandbox.MIXX.audio;
const authModule = sandbox.MIXX.auth;
const accountModule = sandbox.MIXX.account;

/* ─────────────────── 断言工具 ─────────────────── */

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    failures.push({ name, e });
    console.error('  \u2717 ' + name + '\n      ' + e.message);
  }
}

/** 异步用例：在所有同步用例跑完后按注册顺序逐项 await（账户请求是 Promise） */
const asyncTests = [];
function testAsync(name, fn) {
  asyncTests.push({ name, fn });
}

/** 清空微任务队列（让注入的 fetch 桩真正被调用一次） */
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** 等待账户资料异步加载完成（#44）：资料请求链路是 Promise 串，测试统一 settle */
async function settle(game) {
  await flushMicrotasks();
  if (game && game._profileTask) {
    try { await game._profileTask; } catch (e) { /* 用例自行断言 profileError */ }
  }
  await flushMicrotasks();
}

const elt = (id) => registry.get(id);
const shown = (id) => !elt(id).classList.contains('hidden');
const hidden = (id) => elt(id).classList.contains('hidden');
const text = (id) => elt(id).textContent;

function keyEvent(key, extra) {
  return Object.assign({ key, preventDefault() {} }, extra || {});
}
function key(type, k, extra) {
  fireWindow(type, keyEvent(k, extra));
}
/** 点按一次（keydown + keyup）：与真实敲击一致，每次产生一个按下边沿 */
function press(k) {
  key('keydown', k);
  key('keyup', k);
}

/**
 * 新建游戏实例（不自动 start，测试手动驱动帧）。
 * 默认清空 localStorage，保证用例互不污染；跨实例验证存档时传 { keepStorage: true }。
 */
function makeGame(opts) {
  opts = opts || {};
  if (!opts.keepStorage) localStorageStub.clear();
  // 既有用例不关心账户：默认关闭，避免异步 restore 干扰共享 DOM；
  // 账户用例显式传 auth。
  if (!Object.prototype.hasOwnProperty.call(opts, 'auth')) {
    opts = Object.assign({}, opts, { auth: null });
  }
  if (!opts.enableCloud && !Object.prototype.hasOwnProperty.call(opts, 'cloud')) opts = Object.assign({}, opts, { cloud: null });
  if (!opts.enableStats && !Object.prototype.hasOwnProperty.call(opts, 'stats')) opts = Object.assign({}, opts, { stats: null });
  return new main.Game(registry.get('game'), opts);
}

/* ── 账户（#43）测试工具 ── */

function authResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json() { return Promise.resolve(body); },
  };
}

/** fetch 桩：记录 URL/init/body；handler 可返回响应或抛错（模拟断网） */
function authFetch(handler) {
  const calls = [];
  function stub(url, init) {
    let body = null;
    if (init && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch (e) { body = init.body; }
    }
    const call = { url, init: init || {}, body };
    calls.push(call);
    return Promise.resolve().then(() => handler(call));
  }
  stub.calls = calls;
  return stub;
}

function makeAuth(fetchStub) {
  if (!authModule || typeof authModule.createClient !== 'function') {
    throw new Error('MIXX.auth 未加载');
  }
  return authModule.createClient({ fetch: fetchStub, storage: localStorageStub });
}

const ACCOUNT_USER = { id: 'u-test', email: 'nswer@example.com' };

function accountPayload(extra) {
  return Object.assign({
    access_token: 'access-1',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'refresh-1',
    user: { id: ACCOUNT_USER.id, email: ACCOUNT_USER.email },
  }, extra || {});
}

function seedAccount(extra) {
  const session = Object.assign({
    v: 1,
    accessToken: 'stored-access',
    refreshToken: 'stored-refresh',
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: ACCOUNT_USER.id, email: ACCOUNT_USER.email },
  }, extra || {});
  localStorageStub.setItem(main.ACCOUNT_KEY, JSON.stringify(session));
  return session;
}

/* ── 账户资料（#44）测试工具 ── */

function isProfilesCall(call) {
  return String(call.url).indexOf('/rest/v1/profiles') >= 0;
}

/** 服务端 profiles 行（默认值：昵称 NSWER / 头像 muse-1 / 声音开 / 触屏自动） */
function profileRow(extra) {
  return Object.assign({
    nickname: 'NSWER',
    avatar: 'muse-1',
    prefs: { sound: true, touch: 'auto' },
  }, extra || {});
}

/** profiles 请求响应：GET 返回资料行；PATCH 返回合并后的行（模拟 PostgREST representation） */
function profileResponse(call, stored) {
  const row = Object.assign(profileRow(), stored || {});
  if (call && call.init && call.init.method === 'PATCH') {
    return authResponse(200, [Object.assign(row, call.body)]);
  }
  return authResponse(200, [row]);
}

/**
 * 账户资料用例的游戏实例：真实 auth + account 客户端，全部走同一 fetch 桩。
 * 桩 handler 只处理 auth/profiles 两类请求，意外请求直接抛错便于发现回归。
 */
function makeAccountGame(fetchStub, opts) {
  return makeGame(Object.assign({
    auth: makeAuth(fetchStub),
    fetch: fetchStub,
  }, opts || {}));
}

/** 驱动一帧（递增时间戳，避免 dt 为 0） */
let clock = 0;
function tick(game, ms = 16) {
  clock += ms;
  game.frame(clock);
}

/** 传送玩家到指定瓦片 */
function teleport(game, tx, ty) {
  game.player.x = tx * engine.TILE;
  game.player.y = ty * engine.TILE;
}

/** 收集本关全部星星（按实体坐标逐一传送） */
function collectAll(game) {
  for (const e of game.level.entities.filter((n) => n.type === 'star')) {
    if (e.collected) continue;
    teleport(game, e.x, e.y);
    tick(game);
  }
}

/* ─────────────────── 1. 常量与 API ─────────────────── */

test('公开 API：STATE 六态齐全、Game/boot/formatTime 暴露', () => {
  assert.ok(main, 'MIXX.main 未暴露');
  assert.deepStrictEqual(
    Object.keys(STATE).sort(),
    ['CLEAR', 'DIALOGUE', 'ENDING', 'PAUSED', 'PLAYING', 'TITLE']
  );
  assert.strictEqual(STATE.TITLE, 'title');
  assert.strictEqual(STATE.PLAYING, 'playing');
  assert.strictEqual(STATE.DIALOGUE, 'dialogue');
  assert.strictEqual(STATE.PAUSED, 'paused');
  assert.strictEqual(STATE.CLEAR, 'clear');
  assert.strictEqual(STATE.ENDING, 'ending');
  assert.strictEqual(typeof main.Game, 'function');
  assert.strictEqual(typeof main.boot, 'function');
  assert.strictEqual(main.formatTime(65), '1:05');
  assert.strictEqual(main.formatTime(0), '0:00');
  assert.strictEqual(main.formatTime(605), '10:05');
});

test('占位关卡：2 关、实体齐全（spawn/star/npc/portal）+ 关 1 机制闭环', () => {
  const levels = main.buildBootLevels();
  assert.strictEqual(levels.length, 2);
  for (const lv of levels) {
    assert.ok(lv.map && lv.map.rows.length > 0);
    assert.strictEqual(lv.entities.filter((e) => e.type === 'spawn').length, 1);
    assert.strictEqual(lv.entities.filter((e) => e.type === 'portal').length, 1);
    assert.ok(lv.entities.filter((e) => e.type === 'star').length >= 1);
    assert.ok(lv.entities.filter((e) => e.type === 'npc').length >= 1);
    assert.ok(lv.entities.filter((e) => e.type === 'enemy').length >= 1, '占位关带战斗敌人（#18）');
  }
  const l1 = levels[0];
  assert.strictEqual(l1.entities.filter((e) => e.type === 'box').length, 1, '关 1 礼物盒');
  assert.strictEqual(l1.entities.filter((e) => e.type === 'switch').length, 1, '关 1 压力开关');
  assert.strictEqual(l1.entities.filter((e) => e.type === 'gate').length, 1, '关 1 门');
  const gate = l1.entities.find((e) => e.type === 'gate');
  const sw = l1.entities.find((e) => e.type === 'switch');
  assert.strictEqual(sw.target, gate.id, '开关 target 指向门');
  assert.strictEqual(gate.open, false, '门默认关闭');
});

/* ─────────────────── 2. 初始标题态 ─────────────────── */

test('初始进入标题：屏幕显隐正确、输入禁用、虚拟按键隐藏', () => {
  const game = makeGame();
  assert.strictEqual(game.state, STATE.TITLE);
  assert.ok(shown('title-screen'));
  assert.ok(hidden('help-screen') && hidden('save-screen') && hidden('pause-screen') && hidden('clear-screen') && hidden('ending-screen'));
  assert.ok(hidden('dialog'));
  assert.ok(hidden('hud'));
  assert.ok(hidden('btn-continue'), '无存档时「继续冒险」隐藏');
  assert.strictEqual(game.input.enabled, false);
  assert.ok(elt('touch-controls').classList.contains('touch-off'), '虚拟按键应隐藏');
  game.destroy();
});

/* ─────────────────── 3. 标题 → 游玩 ─────────────────── */

test('开始游戏 → 游玩：HUD 显示关名与星数、输入与虚拟按键启用', () => {
  const game = makeGame();
  elt('btn-start').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.ok(hidden('title-screen'));
  assert.ok(shown('hud'));
  assert.strictEqual(text('hud-level'), '占位关卡 · 烛光梦境');
  assert.strictEqual(text('hud-shards'), '★ 0/3');
  assert.strictEqual(game.input.enabled, true);
  assert.ok(!elt('touch-controls').classList.contains('touch-off'), '游玩态虚拟按键应显示');
  assert.deepStrictEqual([game.player.x, game.player.y], [2 * 16, 26 * 16], '出生点');
  game.destroy();
});

test('游玩：方向键移动生效、撞墙分轴滑动', () => {
  const game = makeGame();
  elt('btn-start').click();
  const x0 = game.player.x;
  key('keydown', 'd');
  tick(game, 100);
  assert.ok(game.player.x > x0, '向右移动');
  key('keyup', 'd');
  tick(game);
  // 底部墙（第 27 行）：向下被挡，y 不变
  const y0 = game.player.y;
  key('keydown', 's');
  tick(game, 100);
  assert.strictEqual(game.player.y, y0, '向下撞墙不动');
  key('keyup', 's');
  tick(game);
  game.destroy();
});

/* ─────────────────── 4. 游玩 ⇄ 对话 ─────────────────── */

test('对话往返：打字机进入/快进/翻页/旁白样式/退出清空无残留', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 10, 15); // NPC 旁
  tick(game);
  press('e');
  tick(game);
  assert.strictEqual(game.state, STATE.DIALOGUE);
  assert.ok(shown('dialog'));
  assert.ok(shown('dialog-backdrop'), '对话中背景虚化层显示');
  assert.ok(shown('hud'), '对话中 HUD 保持可见');
  assert.strictEqual(text('dialog-name'), 'Byeori');
  assert.strictEqual(text('dialog-text'), '', '打字机从空文本开始（首帧不足 25ms）');
  // 点按快进 → 本行全文
  press('e');
  tick(game);
  assert.strictEqual(text('dialog-text'), 'NSWER！欢迎来到 MIXXTOPIA！我是星星精灵 Byeori。');
  // 翻页 → 第 2 行（重新打字）
  press('e');
  tick(game);
  assert.strictEqual(text('dialog-text'), '', '翻页后新行从空文本开始');
  press('e');
  tick(game);
  assert.ok(text('dialog-text').indexOf('占位演示') >= 0);
  // 翻页 → 旁白行：姓名标签隐藏、文字灰色
  press('e');
  tick(game);
  assert.ok(hidden('dialog-name'), '旁白不显示姓名标签');
  assert.strictEqual(elt('dialog-text').style.color, '#C0C0C0');
  press('e');
  tick(game);
  // 最后一行翻页退出
  press('e');
  tick(game);
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.ok(hidden('dialog'));
  assert.ok(hidden('dialog-backdrop'), '退出对话后虚化层隐藏');
  assert.strictEqual(text('dialog-name'), '', '对话框内容清空');
  assert.strictEqual(text('dialog-text'), '');
  assert.strictEqual(game._dialog, null);
  game.destroy();
});

test('对话头像位（#28）：按说话人加载立绘、nar 隐藏、退出清空', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 10, 15);
  tick(game);
  press('e');
  tick(game);
  assert.strictEqual(game.state, STATE.DIALOGUE);
  // Byeori 有立绘：src 指向素材目录、头像显示、对话框挂 has-portrait
  assert.strictEqual(
    elt('dialog-portrait').src,
    'assets/characters/byeori/art/byeori-portrait.png'
  );
  assert.ok(shown('dialog-portrait'));
  assert.ok(elt('dialog').classList.contains('has-portrait'));
  // 同一说话人连续两行：src 缓存不重复赋值（防闪动）
  const firstSrc = elt('dialog-portrait').src;
  press('e'); tick(game); // 快进第 1 行
  press('e'); tick(game);
  assert.strictEqual(elt('dialog-portrait').src, firstSrc);
  assert.ok(shown('dialog-portrait'), 'Byeori 第二行头像保持显示');
  // 旁白行（nar）：无立绘 → 头像位隐藏、移除 has-portrait
  press('e'); tick(game); // 快进第 2 行
  press('e'); tick(game);
  assert.ok(hidden('dialog-portrait'));
  assert.ok(!elt('dialog').classList.contains('has-portrait'));
  // 退出对话：src 清空、运行态复位
  press('e'); tick(game); // 快进旁白行
  press('e'); tick(game);
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.ok(hidden('dialog-portrait'));
  assert.strictEqual(elt('dialog-portrait').src, '');
  assert.strictEqual(game._portraitSrc, null);
  game.destroy();
});

test('对话头像加载失败：同路径换行保持隐藏、切换其他路径正常显示', () => {
  const game = makeGame();
  game.dialogue = {
    'test.portrait-error': {
      lines: ['byeori', 'byeori', 'nar', 'byeori', 'lily', 'byeori'].map(
        (s) => ({ s, t: '头像加载失败测试' })
      ),
    },
  };
  elt('btn-start').click();
  game._enterDialogue('test.portrait-error');
  const img = elt('dialog-portrait');
  const failedSrc = img.src;
  assert.ok(shown('dialog-portrait'));
  assert.strictEqual(typeof img.onerror, 'function');
  img.onerror(); // 模拟首次加载失败
  assert.ok(hidden('dialog-portrait'));
  assert.ok(!elt('dialog').classList.contains('has-portrait'));

  for (let i = 1; i <= 5; i++) {
    press('e'); tick(game); // 快进当前行，再翻页
    press('e'); tick(game);
    assert.strictEqual(game._dialog.idx, i, '翻页进入预期行');
    if (i === 4) {
      assert.strictEqual(img.src, 'assets/characters/lily/art/lily-portrait.png');
      assert.ok(shown('dialog-portrait'), '其他头像路径仍正常显示');
      assert.ok(elt('dialog').classList.contains('has-portrait'));
    } else {
      assert.ok(hidden('dialog-portrait'), '失败路径与旁白保持隐藏，行 ' + i);
      assert.ok(!elt('dialog').classList.contains('has-portrait'));
      if (i === 1) assert.strictEqual(img.src, failedSrc);
    }
  }
  press('e'); tick(game); // 快进末行
  press('e'); tick(game);
  assert.strictEqual(game.state, STATE.PLAYING, '加载失败不影响对话结束');
  game.destroy();
});

test('对话中 Esc 不切换暂停（输入被对话占用）', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 10, 15);
  tick(game);
  press('e');
  tick(game);
  assert.strictEqual(game.state, STATE.DIALOGUE);
  press('Escape');
  tick(game);
  assert.strictEqual(game.state, STATE.DIALOGUE, '对话态 Esc 不生效');
  press('Escape');
  tick(game);
  assert.strictEqual(game.state, STATE.DIALOGUE);
  game.destroy();
});

test('无 NPC 附近按确认：不进入对话', () => {
  const game = makeGame();
  elt('btn-start').click();
  press('e');
  tick(game);
  assert.strictEqual(game.state, STATE.PLAYING);
  game.destroy();
});

/* ─────────────────── 4.5 对话系统（Issue #7） ─────────────────── */

test('打字机：25ms/字逐字显示、始终为全文前缀、提示文案切换', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 10, 15);
  tick(game);
  press('e');
  tick(game);
  const full = 'NSWER！欢迎来到 MIXXTOPIA！我是星星精灵 Byeori。';
  assert.strictEqual(game.state, STATE.DIALOGUE);
  assert.strictEqual(text('dialog-text'), '', '首帧 16ms 不足一个字');
  assert.strictEqual(text('dialog-hint'), '▸▸ 快进', '打字中提示快进');
  tick(game, 25); // 第 1 字
  assert.strictEqual(text('dialog-text'), full.slice(0, 1));
  tick(game, 50); // 第 2–3 字
  assert.strictEqual(text('dialog-text'), full.slice(0, 3));
  for (let i = 0; i < 40 && text('dialog-text') !== full; i++) {
    tick(game, 25);
    assert.strictEqual(full.indexOf(text('dialog-text')), 0, '任意时刻均为全文前缀');
  }
  assert.strictEqual(text('dialog-text'), full, '自然显示到全文');
  assert.strictEqual(text('dialog-hint'), '▼ E / 空格', '显示完切换翻页提示');
  game.destroy();
});

test('点按快进：打字中点按 E 立即显示本行全文，不跳行', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 10, 15);
  tick(game);
  press('e');
  tick(game);
  tick(game, 25);
  const partial = text('dialog-text');
  assert.ok(partial.length > 0 && partial.length < 21, '处于打字中途');
  press('e');
  tick(game);
  assert.strictEqual(text('dialog-text'), 'NSWER！欢迎来到 MIXXTOPIA！我是星星精灵 Byeori。');
  assert.strictEqual(game.state, STATE.DIALOGUE, '点按只快进本行，不翻页');
  game.destroy();
});

test('按住加速：按住 E 打字显著加快，长按松开不跳行，点按才跳行', () => {
  const saved = sandbox.GAME;
  const long = '一二三四五六七八九十'.repeat(12); // 120 字，保证 300ms 按住不足以打完
  sandbox.GAME = {
    levels: [{
      id: 1,
      title: 'T',
      palette: { bg: '#1A1033', cream: '#F7E8C8', gold: '#FFC857', pink: '#FF8FA3' },
      map: engine.demoLevel.map,
      entities: [
        { type: 'spawn', x: 2, y: 26 },
        { type: 'npc', id: 'byeori', x: 10, y: 15, dialogue: 'boot.hi' },
      ],
    }],
    characters: {},
    dialogue: { 'boot.hi': { lines: [{ s: 'byeori', t: long }] } },
  };
  try {
    const game = makeGame();
    elt('btn-start').click();
    teleport(game, 10, 15);
    tick(game);
    press('e');
    tick(game);
    // 按住 300ms（帧内 dt 上限 50ms → 6 帧）：6ms/字 → 约 50 字；正常速度 25ms/字仅 12 字
    key('keydown', 'e');
    for (let i = 0; i < 6; i++) tick(game, 100);
    const fastShown = text('dialog-text').length;
    assert.ok(fastShown >= 40, '按住期间打字显著加速（显示 ' + fastShown + ' 字）');
    key('keyup', 'e');
    tick(game);
    assert.ok(text('dialog-text').length < long.length, '长按（≥250ms）松开不跳行');
    // 释放后恢复常速：50ms 只加约 2 字
    const before = text('dialog-text').length;
    tick(game, 100);
    assert.ok(text('dialog-text').length - before <= 2, '释放后恢复常速');
    // 点按完成本行
    press('e');
    tick(game);
    assert.strictEqual(text('dialog-text'), long);
    game.destroy();
  } finally {
    if (saved === undefined) delete sandbox.GAME; else sandbox.GAME = saved;
  }
});

test('翻页键等价：E / 空格 / Enter 均可快进与翻页', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 10, 15);
  tick(game);
  press('e'); tick(game);          // 进入（E 触发）
  press(' '); tick(game);          // 空格快进本行
  assert.ok(text('dialog-text').indexOf('欢迎来到') >= 0);
  press(' '); tick(game);          // 空格翻页 → 第 2 行
  press('Enter'); tick(game);      // Enter 快进
  assert.ok(text('dialog-text').indexOf('占位演示') >= 0);
  press('Enter'); tick(game);      // Enter 翻页 → 第 3 行（旁白）
  assert.ok(hidden('dialog-name'));
  press('e'); tick(game);          // E 快进
  press(' '); tick(game);          // 空格翻页 → 退出
  assert.strictEqual(game.state, STATE.PLAYING);
  game.destroy();
});

test('点击对话框：打字中点击=快进本行，显示完点击=翻页', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 10, 15);
  tick(game);
  press('e');
  tick(game);
  assert.strictEqual(game.state, STATE.DIALOGUE);
  elt('dialog').click(); // 打字中 → 显示全文
  assert.strictEqual(text('dialog-text'), 'NSWER！欢迎来到 MIXXTOPIA！我是星星精灵 Byeori。');
  elt('dialog').click(); // 显示完 → 翻页，新行从空开始
  assert.strictEqual(text('dialog-text'), '');
  elt('dialog').click(); // 打字中 → 快进
  assert.ok(text('dialog-text').indexOf('占位演示') >= 0);
  assert.strictEqual(game.state, STATE.DIALOGUE);
  game.destroy();
});

test('对话期间玩家锁定：方向键不移动、计时暂停', () => {
  const game = makeGame();
  elt('btn-start').click();
  tick(game, 1000); // 先积累 1s 用时
  teleport(game, 10, 15);
  tick(game);
  press('e');
  tick(game);
  assert.strictEqual(game.state, STATE.DIALOGUE);
  const p0 = [game.player.x, game.player.y];
  const rt0 = game.runTime;
  key('keydown', 'a');
  key('keydown', 'w');
  for (let i = 0; i < 10; i++) tick(game, 100);
  key('keyup', 'a');
  key('keyup', 'w');
  tick(game);
  assert.deepStrictEqual([game.player.x, game.player.y], p0, '对话中方向键不移动');
  assert.strictEqual(game.runTime, rt0, '对话中计时暂停');
  game.destroy();
});

test('重复进入对话：打字/按住标记不残留，第二次从空文本开始', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 10, 15);
  tick(game);
  press('e');
  tick(game);
  for (let i = 0; i < 6; i++) { press('e'); tick(game); } // 快进+翻页 3 行 → 退出
  assert.strictEqual(game.state, STATE.PLAYING);
  press('e');
  tick(game);
  assert.strictEqual(game.state, STATE.DIALOGUE);
  assert.strictEqual(text('dialog-text'), '', '第二次进入从空文本开始');
  press('e');
  tick(game);
  assert.strictEqual(text('dialog-text'), 'NSWER！欢迎来到 MIXXTOPIA！我是星星精灵 Byeori。');
  game.destroy();
});

/* ─────────────────── 5. 游玩 ⇄ 暂停 ─────────────────── */

test('暂停往返：Esc 进入/退出，暂停时 HUD 隐藏、虚拟按键隐藏', () => {
  const game = makeGame();
  elt('btn-start').click();
  press('Escape');
  tick(game);
  assert.strictEqual(game.state, STATE.PAUSED);
  assert.ok(shown('pause-screen'));
  assert.ok(hidden('hud'));
  assert.ok(elt('touch-controls').classList.contains('touch-off'));
  press('Escape');
  tick(game);
  assert.strictEqual(game.state, STATE.PLAYING, '再次 Esc 继续');
  assert.ok(hidden('pause-screen'));
  assert.ok(shown('hud'));
  game.destroy();
});

test('暂停菜单：继续 / 重玩（星数清零回出生点）/ 回标题', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 8, 20);
  tick(game); // 收集 ★1
  assert.strictEqual(text('hud-shards'), '★ 1/3');
  press('Escape');
  tick(game);
  elt('btn-resume').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  // 重玩：收集标记不残留（关卡数据只读，运行时克隆）
  press('Escape');
  tick(game);
  elt('btn-restart').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.strictEqual(game.stars, 0);
  assert.ok(Array.isArray(game.collected), 'collected 为数组');
  assert.strictEqual(game.collected.length, 0, '重玩清空收集记录（vm 跨 realm 数组不做深度比较）');
  assert.strictEqual(text('hud-shards'), '★ 0/3');
  assert.deepStrictEqual([game.player.x, game.player.y], [2 * 16, 26 * 16]);
  // 回标题
  press('Escape');
  tick(game);
  elt('btn-quit').click();
  assert.strictEqual(game.state, STATE.TITLE);
  assert.ok(shown('title-screen'));
  assert.strictEqual(game.level, null);
  assert.strictEqual(game.player, null);
  assert.strictEqual(game.input.enabled, false);
  game.destroy();
});

/* ─────────────────── 6. 游玩 → 结算 → 下一关 → 结局 ─────────────────── */

test('收集星星：HUD 星数逐次递增', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 8, 20);
  tick(game);
  assert.strictEqual(game.stars, 1);
  assert.strictEqual(text('hud-shards'), '★ 1/3');
  teleport(game, 25, 14);
  tick(game);
  teleport(game, 33, 7);
  tick(game);
  assert.strictEqual(game.stars, 3);
  assert.strictEqual(text('hud-shards'), '★ 3/3');
  game.destroy();
});

test('星未集齐：传送门不触发结算', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 38, 10); // 传送门
  tick(game);
  assert.strictEqual(game.state, STATE.PLAYING, '星不足不结算');
  game.destroy();
});

test('结算：集齐后接触传送门 → 星星/用时文案、输入禁用', () => {
  const game = makeGame();
  elt('btn-start').click();
  collectAll(game);
  teleport(game, 38, 10);
  tick(game);
  assert.strictEqual(game.state, STATE.CLEAR);
  assert.ok(shown('clear-screen'));
  assert.ok(hidden('hud'));
  assert.ok(/星星 3\/3/.test(text('clear-text')), text('clear-text'));
  assert.ok(/用时 0:\d\d/.test(text('clear-text')), text('clear-text'));
  assert.strictEqual(text('btn-next'), '▶ 下一关');
  assert.strictEqual(game.input.enabled, false);
  game.destroy();
});

test('下一关：结算按钮 → 第二关游玩，星数与用时清零', () => {
  const game = makeGame();
  elt('btn-start').click();
  collectAll(game);
  teleport(game, 38, 10);
  tick(game);
  elt('btn-next').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.strictEqual(game.levelIndex, 1);
  assert.strictEqual(text('hud-level'), '占位关卡 · 疾风终章');
  assert.strictEqual(text('hud-shards'), '★ 0/2');
  assert.strictEqual(game.stars, 0);
  assert.strictEqual(game.runTime, 0);
  assert.ok(hidden('clear-screen'));
  assert.strictEqual(text('clear-text'), '', '结算文案清空');
  game.destroy();
});

/* ─────────────────── 6.5 收集与解谜机制（Issue #9） ─────────────────── */

/** 临时替换 MIXX.audio.play 记录音效名，结束后恢复 */
function withSfx(fn) {
  assert.ok(audio && typeof audio.play === 'function', 'audio.js 已加载');
  const calls = [];
  const origin = audio.play;
  audio.play = (name) => { calls.push(name); return true; };
  try {
    fn(calls);
  } finally {
    audio.play = origin;
  }
}

test('#9 门与压力开关：关门阻挡，踩上开门，离开关门', () => {
  const game = makeGame();
  elt('btn-start').click();
  const gate = game.level.entities.find((e) => e.type === 'gate');
  const sw = game.level.entities.find((e) => e.type === 'switch');
  assert.ok(gate && sw, '占位关 1 带门与开关');
  assert.strictEqual(gate.open, false);

  // 关门时朝门里走：y 不变
  teleport(game, 33, 11);
  tick(game);
  const y0 = game.player.y;
  key('keydown', 'w');
  tick(game, 100);
  key('keyup', 'w');
  tick(game);
  assert.strictEqual(game.player.y, y0, '关门阻挡玩家');

  // 玩家踩上开关：门开；离开：门关
  teleport(game, 33, 12);
  tick(game);
  assert.strictEqual(sw.pressed, true);
  assert.strictEqual(gate.open, true);
  teleport(game, 30, 12);
  tick(game);
  assert.strictEqual(sw.pressed, false);
  assert.strictEqual(gate.open, false);
  game.destroy();
});

test('#9 推箱压开关：礼物盒滑一格保持开门，可穿门取星', () => {
  const game = makeGame();
  elt('btn-start').click();
  const box = game.level.entities.find((e) => e.type === 'box');
  const gate = game.level.entities.find((e) => e.type === 'gate');

  teleport(game, 31, 12); // 站在礼物盒左侧
  tick(game);
  key('keydown', 'd');
  tick(game);
  key('keyup', 'd');
  tick(game);
  assert.deepStrictEqual([box.x, box.y], [33, 12], '箱子向右推动一格压上开关');
  assert.strictEqual(gate.open, true, '箱子压住开关时门开');

  teleport(game, 30, 12); // 玩家离开开关，箱子继续压着
  tick(game);
  assert.strictEqual(gate.open, true, '箱子压住时门保持打开');

  teleport(game, 33, 11);
  tick(game);
  const y0 = game.player.y;
  key('keydown', 'w');
  tick(game, 100);
  key('keyup', 'w');
  tick(game);
  assert.ok(game.player.y < y0, '门开后可以走进门格');
  game.destroy();
});

test('#9 机制事件：推箱 / 开关 / 门按序上报 onEvent', () => {
  const events = [];
  const game = makeGame({ onEvent: (name, data) => events.push([name, data]) });
  elt('btn-start').click();
  teleport(game, 31, 12);
  tick(game);
  key('keydown', 'd');
  tick(game);
  key('keyup', 'd');
  tick(game);

  const names = events.map((e) => e[0]);
  assert.ok(names.indexOf('push') >= 0, 'push 事件');
  assert.ok(names.indexOf('switch') >= 0, 'switch 事件');
  assert.ok(names.indexOf('gate') >= 0, 'gate 事件');
  const gateEvent = events.filter((e) => e[0] === 'gate').pop();
  assert.strictEqual(gateEvent[1].open, true);
  game.destroy();
});

test('#9 星星拾取：粒子 + 音效；集齐三星传送门激活并踩入结算', () => {
  withSfx((calls) => {
    const game = makeGame();
    elt('btn-start').click();
    teleport(game, 8, 20);
    tick(game);
    assert.strictEqual(game.stars, 1);
    assert.ok(game.particles.count > 0, '拾取星星产生粒子');
    assert.ok(calls.indexOf('star') >= 0, '拾取星星播放音效');
    assert.strictEqual(game._portalActive(), false, '未集齐时传送门未激活');

    teleport(game, 25, 14);
    tick(game);
    teleport(game, 33, 7);
    tick(game);
    assert.strictEqual(game.stars, 3);
    assert.strictEqual(game._portalActive(), true, '集齐后传送门激活');
    assert.ok(calls.indexOf('portal') >= 0, '激活传送门播放音效');
    assert.strictEqual(game.state, STATE.PLAYING, '激活本身不切状态');

    teleport(game, 38, 10);
    tick(game);
    assert.strictEqual(game.state, STATE.CLEAR, '踩上传送门进入结算');
    assert.ok(calls.indexOf('portal-enter') >= 0, '进入传送门播放音效');
    game.destroy();
  });
});

test('#9 声音关闭：机制音效不播放（粒子照常）', () => {
  withSfx((calls) => {
    const game = makeGame();
    elt('btn-start').click();
    game.soundOn = false;
    teleport(game, 8, 20);
    tick(game);
    assert.strictEqual(game.stars, 1);
    assert.ok(game.particles.count > 0, '粒子不受声音开关影响');
    assert.deepStrictEqual(calls, [], '关闭声音后不调用 play');
    game.destroy();
  });
});

test('#9 单关完整闭环：推箱开门 → 三星 → 传送门 → 下一关', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 8, 20); // ★1
  tick(game);
  teleport(game, 31, 12);
  tick(game);
  key('keydown', 'd');
  tick(game);
  key('keyup', 'd');
  tick(game);
  const gate = game.level.entities.find((e) => e.type === 'gate');
  assert.strictEqual(gate.open, true, '礼物盒压开关开门');
  teleport(game, 25, 14); // ★2（岛内）
  tick(game);
  teleport(game, 33, 7); // ★3（门后小屋）
  tick(game);
  assert.strictEqual(game._portalActive(), true);
  teleport(game, 38, 10);
  tick(game);
  assert.strictEqual(game.state, STATE.CLEAR);
  assert.strictEqual(game.level.id, 1);
  elt('btn-next').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.strictEqual(game.level.id, 2);
  assert.strictEqual(game.stars, 0);
  game.destroy();
});

test('结局：末关结算按钮为「见证结局」→ 结局界面 → 再来一次回标题', () => {
  const game = makeGame();
  elt('btn-start').click();
  collectAll(game);
  teleport(game, 38, 10);
  tick(game);
  elt('btn-next').click();
  collectAll(game);
  teleport(game, 38, 10);
  tick(game);
  assert.strictEqual(game.state, STATE.CLEAR);
  assert.strictEqual(text('btn-next'), '▶ 见证结局');
  elt('btn-next').click();
  assert.strictEqual(game.state, STATE.ENDING);
  assert.ok(shown('ending-screen'));
  assert.ok(/25 颗愿望之星/.test(elt('ending-body').innerHTML));
  assert.strictEqual(game.input.enabled, false);
  elt('btn-ending').click();
  assert.strictEqual(game.state, STATE.TITLE);
  assert.ok(hidden('ending-screen'));
  assert.strictEqual(elt('ending-body').innerHTML, '', '结局内容清空');
  assert.ok(shown('title-screen'));
  game.destroy();
});

/* ─────────────────── 7. 全状态往返无泄漏 ─────────────────── */

test('全状态往返无泄漏：完整循环两遍，实例/监听/HUD/对话零残留', () => {
  const game = makeGame();
  const inputInstance = game.input;
  const handlerCount = game._uiHandlers.length;
  rafCount = 0;

  const roundTrip = () => {
    elt('btn-start').click();                       // TITLE → PLAYING
    assert.strictEqual(game.state, STATE.PLAYING);
    assert.strictEqual(game.stars, 0, '新局星数清零');
    assert.strictEqual(text('hud-shards'), '★ 0/3');
    teleport(game, 10, 15);
    tick(game);
    press('e'); tick(game);                         // → DIALOGUE
    assert.strictEqual(game.state, STATE.DIALOGUE);
    for (let i = 0; i < 6; i++) { press('e'); tick(game); } // 快进+翻页 3 行 → PLAYING
    assert.strictEqual(game.state, STATE.PLAYING);
    press('Escape'); tick(game);                    // → PAUSED
    assert.strictEqual(game.state, STATE.PAUSED);
    press('Escape'); tick(game);                    // → PLAYING
    assert.strictEqual(game.state, STATE.PLAYING);
    collectAll(game);
    teleport(game, 38, 10); tick(game);             // → CLEAR
    assert.strictEqual(game.state, STATE.CLEAR);
    elt('btn-next').click();                        // → PLAYING（第二关）
    assert.strictEqual(game.state, STATE.PLAYING);
    collectAll(game);
    teleport(game, 38, 10); tick(game);             // → CLEAR（末关）
    elt('btn-next').click();                        // → ENDING
    assert.strictEqual(game.state, STATE.ENDING);
    elt('btn-ending').click();                      // → TITLE
    assert.strictEqual(game.state, STATE.TITLE);
  };

  roundTrip();
  roundTrip();

  // 无泄漏断言
  assert.strictEqual(game.input, inputInstance, '全程同一输入实例');
  assert.strictEqual(game._uiHandlers.length, handlerCount, 'UI 监听数量不变');
  assert.strictEqual(game.state, STATE.TITLE);
  assert.ok(shown('title-screen'));
  assert.ok(hidden('hud') && hidden('dialog') && hidden('dialog-backdrop') && hidden('pause-screen')
    && hidden('clear-screen') && hidden('ending-screen'), '仅标题屏幕可见');
  assert.strictEqual(text('dialog-name'), '');
  assert.strictEqual(text('dialog-text'), '');
  assert.strictEqual(text('clear-text'), '');
  assert.strictEqual(elt('ending-body').innerHTML, '');
  assert.strictEqual(game.input.enabled, false);
  assert.ok(elt('touch-controls').classList.contains('touch-off'));
  assert.strictEqual(game.level, null);
  assert.strictEqual(game.player, null);
  // 单游戏循环：start() 幂等，stop() 后不产生新帧
  game.start();
  assert.strictEqual(rafCount, 1, 'start 只登记一个 rAF');
  game.start();
  assert.strictEqual(rafCount, 1, '重复 start 不叠加循环');
  game.stop();
  game.destroy();
});

/* ─────────────────── 8. 状态守卫 ─────────────────── */

test('状态守卫：错误状态的按钮与按键不生效', () => {
  const game = makeGame();
  // 标题态：Esc 无效（输入禁用）、结算/继续按钮无效
  press('Escape');
  tick(game);
  assert.strictEqual(game.state, STATE.TITLE);
  elt('btn-resume').click();
  elt('btn-next').click();
  elt('btn-ending').click();
  assert.strictEqual(game.state, STATE.TITLE);
  // 游玩态：开始/继续按钮无效
  elt('btn-start').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  elt('btn-start').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  elt('btn-next').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  // 结算态：开始/重玩无效
  collectAll(game);
  teleport(game, 38, 10);
  tick(game);
  assert.strictEqual(game.state, STATE.CLEAR);
  elt('btn-start').click();
  elt('btn-restart').click();
  assert.strictEqual(game.state, STATE.CLEAR);
  game.destroy();
});

test('帮助界面：仅标题态可开，返回按钮关闭，不影响状态机', () => {
  const game = makeGame();
  elt('btn-help').click();
  assert.ok(shown('help-screen'));
  assert.strictEqual(game.state, STATE.TITLE);
  elt('btn-help-back').click();
  assert.ok(hidden('help-screen'));
  // 游玩态帮助按钮无效
  elt('btn-start').click();
  elt('btn-help').click();
  assert.ok(hidden('help-screen'));
  assert.strictEqual(game.state, STATE.PLAYING);
  game.destroy();
});

test('声音按钮与 M 键切换文案（#14 音频落地前）', () => {
  const game = makeGame();
  assert.strictEqual(text('btn-sound'), '♪ 声音：开');
  elt('btn-sound').click();
  assert.strictEqual(text('btn-sound'), '♪ 声音：关');
  elt('btn-start').click();
  press('m');
  tick(game);
  assert.strictEqual(text('btn-sound'), '♪ 声音：开');
  game.destroy();
});

/* ─────────────────── 9. 数据接入与钩子 ─────────────────── */

test('data.js 就位后采用 GAME 数据（levels/characters/dialogue）', () => {
  const saved = sandbox.GAME;
  sandbox.GAME = {
    levels: [{
      id: 1,
      title: 'Birthday Wish',
      palette: { bg: '#1A1033', cream: '#F7E8C8', gold: '#FFC857', pink: '#FF8FA3' },
      map: engine.demoLevel.map,
      entities: [
        { type: 'spawn', x: 2, y: 26 },
        { type: 'star', id: 's1', x: 8, y: 20 },
      ],
    }],
    characters: { lily: { name: 'Lily', color: '#7FB8E6' } },
    dialogue: { 'boot.hi': { lines: [{ s: 'lily', t: '来自 data.js 的台词。' }] } },
  };
  const game = makeGame();
  assert.strictEqual(game.dataSource, 'data');
  elt('btn-start').click();
  assert.strictEqual(text('hud-level'), 'Birthday Wish');
  teleport(game, 10, 15); // 无 NPC（GAME 关卡未配置）→ 确认键无效
  tick(game);
  press('e');
  tick(game);
  assert.strictEqual(game.state, STATE.PLAYING);
  game.destroy();
  if (saved === undefined) delete sandbox.GAME; else sandbox.GAME = saved;
});

test('onEvent 钩子：状态/收集/结算事件按序上报', () => {
  const events = [];
  const game = makeGame({ onEvent: (name, data) => events.push([name, data]) });
  elt('btn-start').click();
  collectAll(game);
  teleport(game, 38, 10);
  tick(game);
  const states = events.filter((e) => e[0] === 'state').map((e) => e[1]);
  // 首条为构造期进入标题态的事件，其后为测试驱动的迁移
  assert.deepStrictEqual(states.map((s) => s.to), ['title', 'playing', 'clear']);
  assert.deepStrictEqual(states[0].from, null);
  assert.strictEqual(events.filter((e) => e[0] === 'collect').length, 3);
  assert.strictEqual(events.filter((e) => e[0] === 'clear').length, 1);
  game.destroy();
});

/* ─────────────────── 9.5 对话节点语义（Issue #12） ─────────────────── */

/** 安装测试用 GAME 并执行 fn，结束后恢复原 sandbox.GAME */
function withGAME(g, fn) {
  const saved = sandbox.GAME;
  sandbox.GAME = g;
  try {
    fn();
  } finally {
    if (saved === undefined) delete sandbox.GAME;
    else sandbox.GAME = saved;
  }
}

/** 构造最小测试关卡（复用引擎演示地形） */
function dataLevel(entities) {
  return {
    id: 1,
    title: 'Birthday Wish',
    palette: { bg: '#1A1033', cream: '#F7E8C8', gold: '#FFC857', pink: '#FF8FA3' },
    map: engine.demoLevel.map,
    entities: entities,
  };
}

/** 快进一行 + 翻页（与既有对话测试同节奏：点按完本行 → 翻页） */
function advanceDialog(game) {
  press('e'); tick(game);
  press('e'); tick(game);
}

test('#12 NPC 互动解析：intro once → npc 自我介绍 → hint 可重复（npc:lily）', () => {
  withGAME({
    levels: [dataLevel([
      { type: 'spawn', x: 2, y: 26 },
      { type: 'npc', id: 'lily', x: 10, y: 15 }, // 无 dialogue 字段 → 按 trigger 解析
    ])],
    characters: { lily: { name: 'Lily', color: '#7FB8E6' } },
    dialogue: {
      'l1.intro': {
        type: 'intro', trigger: 'npc:lily', once: true,
        lines: [{ s: 'lily', t: '开场台词。' }],
        next: 'l1.lily.hint',
      },
      'l1.npc.lily': {
        type: 'npc', trigger: 'npc:lily', once: true,
        lines: [{ s: 'lily', t: '自我介绍台词。' }],
      },
      'l1.lily.hint': {
        type: 'hint', trigger: 'npc:lily', once: false,
        lines: [{ s: 'lily', t: '提示台词。' }],
      },
    },
  }, () => {
    const game = makeGame();
    assert.strictEqual(game.dataSource, 'data');
    elt('btn-start').click();
    teleport(game, 10, 15);
    tick(game);
    // 第 1 次互动 → intro（once）
    press('e'); tick(game);
    assert.strictEqual(game.state, STATE.DIALOGUE);
    assert.strictEqual(game._dialog.nodeId, 'l1.intro');
    advanceDialog(game);
    assert.strictEqual(game.state, STATE.PLAYING);
    assert.ok(game._playedNodes.has('l1.intro'));
    // 第 2 次互动 → 同 trigger 的 npc 自我介绍（once，intro.next 目标保持）
    press('e'); tick(game);
    assert.strictEqual(game._dialog.nodeId, 'l1.npc.lily');
    advanceDialog(game);
    // 第 3 次互动 → hint（repeat）
    press('e'); tick(game);
    assert.strictEqual(game._dialog.nodeId, 'l1.lily.hint');
    advanceDialog(game);
    // 第 4 次互动 → hint 仍可重复
    press('e'); tick(game);
    assert.strictEqual(game._dialog.nodeId, 'l1.lily.hint');
    advanceDialog(game);
    assert.strictEqual(game.state, STATE.PLAYING);
    game.destroy();
  });
});

test('#12 共享 NPC trigger：仅播放当前关卡台词，切关与返回时各自保留 hint', () => {
  const data = {};
  vm.runInNewContext(fs.readFileSync(path.join(repoRoot, 'js/data.js'), 'utf8'), data);
  withGAME({
    levels: [4, 1, 6, 14].map((id) => Object.assign(dataLevel([
      { type: 'spawn', x: 2, y: 26 },
      { type: 'npc', id: 'lily', x: 10, y: 15 },
    ]), { id: id })),
    characters: data.GAME.characters,
    dialogue: data.GAME.dialogue,
  }, () => {
    const game = makeGame();
    elt('btn-start').click();
    const visits = [
      [0, ['l4.intro', 'l4.lily.hint', 'l4.lily.hint']],
      [1, ['l1.intro', 'l1.npc.lily', 'l1.lily.hint']],
      [2, ['l6.intro', 'l6.hint', 'l6.hint']],
      [0, ['l4.lily.hint']],
    ];
    for (const [index, nodes] of visits) {
      game._loadLevel(index);
      teleport(game, 10, 15);
      tick(game);
      for (const nodeId of nodes) {
        press('e'); tick(game);
        assert.strictEqual(game._dialog && game._dialog.nodeId, nodeId);
        while (game.state === STATE.DIALOGUE) advanceDialog(game);
      }
    }
    game._loadLevel(3);
    teleport(game, 10, 15);
    tick(game);
    press('e'); tick(game);
    assert.strictEqual(game.state, STATE.PLAYING, '无当前关卡节点时不播放其他关卡台词');
    game.destroy();
  });
});

test('#12 选项列表：↑↓ 移动 · E 确认 → goto 分支；check 节点可重复', () => {
  withGAME({
    levels: [Object.assign(dataLevel([
      { type: 'spawn', x: 2, y: 26 },
      { type: 'npc', id: 'dj', x: 10, y: 15, dialogue: 'l3.dj.check' },
    ]), { id: 3 })],
    characters: { dj: { name: '街头DJ', color: '#FF5D8F' } },
    dialogue: {
      'l3.dj.check': {
        type: 'check', trigger: 'npc:dj', once: false,
        lines: [{ s: 'dj', t: '这条街最酷的人是谁？' }],
        options: [
          { label: '「Kyujin。」', goto: 'l3.dj.right' },
          { label: '「我自己。」', goto: 'l3.dj.wrong' },
        ],
      },
      'l3.dj.right': {
        type: 'check', trigger: 'npc:dj', once: false,
        lines: [{ s: 'dj', t: '会说话。过吧。' }],
      },
      'l3.dj.wrong': {
        type: 'check', trigger: 'npc:dj', once: false,
        lines: [{ s: 'dj', t: '哈！有胆量，但没门。' }],
      },
    },
  }, () => {
    const game = makeGame();
    elt('btn-start').click();
    teleport(game, 10, 15);
    tick(game);
    press('e'); tick(game);
    assert.strictEqual(game.state, STATE.DIALOGUE);
    assert.strictEqual(game._dialog.nodeId, 'l3.dj.check');
    let ended = 0;
    const onEnd = () => { ended++; };
    game._dialog.onEnd = onEnd;
    advanceDialog(game); // 台词播完 → 进入选项模式
    assert.strictEqual(game.state, STATE.DIALOGUE, '选项模式仍停留在对话态');
    assert.ok(game._dialog.optionsShown);
    const box = elt('dialog-options');
    assert.strictEqual(box.children.length, 2);
    assert.ok(box.children[0].className.indexOf('selected') >= 0, '默认选中第 1 项');
    assert.strictEqual(text('dialog-hint'), '↑↓ 选择 · E 确认');
    // 按 ↑ 越界不移动；↓ 移到第 2 项
    press('ArrowUp'); tick(game);
    assert.ok(box.children[0].className.indexOf('selected') >= 0, '顶部越界保持');
    press('ArrowDown'); tick(game);
    assert.ok(box.children[1].className.indexOf('selected') >= 0, '第 2 项选中');
    // 确认 → goto wrong 分支
    press('e'); tick(game);
    assert.strictEqual(game._dialog.nodeId, 'l3.dj.wrong');
    assert.strictEqual(box.children.length, 0, '分支台词播放期间清空旧选项及高亮');
    assert.strictEqual(box.textContent, '');
    assert.strictEqual(game._dialog.onEnd, onEnd, 'goto 分支保留完成回调');
    assert.strictEqual(ended, 0, '分支播完前不调用完成回调');
    advanceDialog(game);
    assert.strictEqual(game.state, STATE.PLAYING);
    assert.strictEqual(ended, 1, '分支结束后调用完成回调一次');
    // check 节点 once:false → 再次互动可重来
    press('e'); tick(game);
    assert.strictEqual(game._dialog.nodeId, 'l3.dj.check');
    game.destroy();
  });
});

test('#12 星星台词：收集触发 star:<星id>（once），播完回游玩态', () => {
  withGAME({
    levels: [dataLevel([
      { type: 'spawn', x: 2, y: 26 },
      { type: 'star', id: 's1', x: 8, y: 20 },
    ])],
    characters: { lily: { name: 'Lily', color: '#7FB8E6' } },
    dialogue: {
      'l1.star1': {
        type: 'star', trigger: 'star:s1', entry: true, once: true,
        lines: [{ s: 'lily', t: '딩동댕！收集成功。' }],
      },
    },
  }, () => {
    const game = makeGame();
    elt('btn-start').click();
    teleport(game, 8, 20);
    tick(game);
    assert.strictEqual(game.stars, 1, '星星已收集');
    assert.strictEqual(game.state, STATE.DIALOGUE, '收集后进入反馈台词');
    assert.strictEqual(game._dialog.nodeId, 'l1.star1');
    assert.strictEqual(text('dialog-name'), 'Lily');
    advanceDialog(game);
    assert.strictEqual(game.state, STATE.PLAYING);
    assert.ok(game._playedNodes.has('l1.star1'), 'once 标记已记录');
    game.destroy();
  });
});

test('#12 过关台词：clear:<关卡id> 播完才进入结算', () => {
  withGAME({
    levels: [dataLevel([
      { type: 'spawn', x: 2, y: 26 },
      { type: 'star', id: 's1', x: 8, y: 20 },
      { type: 'star', id: 's2', x: 25, y: 14 },
      { type: 'portal', x: 38, y: 10 },
    ])],
    characters: {
      lily: { name: 'Lily', color: '#7FB8E6' },
      byeori: { name: 'Byeori', color: '#FFD700' },
    },
    dialogue: {
      'l1.clear': {
        type: 'clear', trigger: 'clear:1', scopeId: 1, entry: true, once: true,
        lines: [
          { s: 'lily', t: '三颗愿望之星全部归位。' },
          { s: 'byeori', t: '目标达成！' },
        ],
      },
    },
  }, () => {
    const game = makeGame();
    elt('btn-start').click();
    collectAll(game);
    assert.strictEqual(game.state, STATE.PLAYING);
    teleport(game, 38, 10);
    tick(game);
    assert.strictEqual(game.state, STATE.DIALOGUE, '先播过关台词');
    assert.ok(hidden('clear-screen'), '台词未播完不进结算');
    assert.strictEqual(game._dialog.nodeId, 'l1.clear');
    advanceDialog(game);
    assert.strictEqual(game.state, STATE.DIALOGUE, '第 2 行仍在台词');
    advanceDialog(game);
    assert.strictEqual(game.state, STATE.CLEAR, '台词播完进入结算');
    assert.ok(shown('clear-screen'));
    game.destroy();
  });
});

test('#12 黑羊彩蛋：首次互动播谜语并计数 sheep+1，之后不再触发', () => {
  withGAME({
    levels: [dataLevel([
      { type: 'spawn', x: 2, y: 26 },
      { type: 'sheep', id: 'sheep1', x: 10, y: 15, dialogue: 'l1.sheep' },
    ])],
    characters: { sheep: { name: '黑羊', color: '#B8A8E0' } },
    dialogue: {
      'l1.sheep': {
        type: 'sheep', trigger: 'sheep:sheep1', entry: true, once: true,
        lines: [{ s: 'sheep', t: '第一个愿望，是让蜡烛永远为过生日的人点亮。' }],
      },
    },
  }, () => {
    const game = makeGame();
    elt('btn-start').click();
    teleport(game, 10, 15);
    tick(game);
    press('e'); tick(game);
    assert.strictEqual(game.state, STATE.DIALOGUE);
    assert.strictEqual(game._dialog.nodeId, 'l1.sheep');
    assert.strictEqual(game.sheepCount, 1, '黑羊计数 +1');
    advanceDialog(game);
    assert.strictEqual(game.state, STATE.PLAYING);
    // 再次互动：once 已播 → 不进入对话、不重复计数
    press('e'); tick(game);
    assert.strictEqual(game.state, STATE.PLAYING);
    assert.strictEqual(game.sheepCount, 1);
    game.destroy();
  });
});

/* ─────────────────── 10. 销毁与页面文案 ─────────────────── */

test('销毁：解绑后按键/按钮全部失效，渲染器与输入释放', () => {
  const game = makeGame();
  elt('btn-start').click();
  game.destroy();
  elt('btn-start').click();
  assert.strictEqual(game.state, STATE.PLAYING, '销毁后按钮不再生效');
  press('Escape');
  tick(game);
  assert.strictEqual(game.state, STATE.PLAYING, '销毁后按键不再生效');
});

test('销毁：对话中销毁一并清掉对话框与背景虚化层（复用 DOM 不残留遮罩）', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 10, 15); // Byeori 旁
  tick(game);
  press('e');
  tick(game);
  assert.strictEqual(game.state, STATE.DIALOGUE);
  assert.ok(shown('dialog') && shown('dialog-backdrop'));
  game.destroy();
  assert.ok(hidden('dialog'), '销毁后对话框隐藏');
  assert.ok(hidden('dialog-backdrop'), '销毁后背景虚化层隐藏');
});

test('index.html：无「玻璃碎片」遗留文案、存档界面元素齐全（不做选关）', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  assert.ok(!/玻璃碎片/.test(html), '帮助界面不得再出现「玻璃碎片」');
  assert.ok(/愿望之星/.test(html));
  assert.ok(/id="btn-saves"/.test(html), '标题提供「选择存档」');
  assert.ok(/id="btn-save-quit"/.test(html), '暂停菜单提供「保存并退出」');
  assert.ok(/id="save-screen"/.test(html) && /id="btn-slot-1"/.test(html), '3 存档位界面存在');
  assert.ok(/id="btn-slot-del-1"/.test(html), '存档位带删除按钮');
  assert.ok(!/id="level-grid"/.test(html), '不做选关界面');
  assert.ok(/id="hud-level"/.test(html) && /id="hud-shards"/.test(html), 'HUD 元素齐全');
});

/* ─────────────────── 7. 存档系统（Issue #8） ─────────────────── */

/** 直接写入 3 档存档（用于构造全满/指定进度场景） */
function seedSaves(slots) {
  localStorageStub.setItem(main.SAVE_KEY, JSON.stringify({ v: main.SAVE_VERSION, slots: slots }));
}
function slotData(index, current, updatedAt) {
  return {
    v: main.SAVE_VERSION, slot: index, current: current, unlocked: current,
    cleared: [], stars: {}, sheep: 0, played: [], updatedAt: updatedAt,
  };
}

test('存档：初始 3 档全空、继续隐藏；选择存档可打开/返回', () => {
  const game = makeGame();
  assert.strictEqual(main.SLOT_COUNT, 3);
  assert.strictEqual(main.SAVE_KEY, 'mixxtopia.save.v1');
  assert.ok(hidden('btn-continue'), '无存档时不显示继续');
  elt('btn-saves').click();
  assert.ok(shown('save-screen') && hidden('title-screen'));
  for (let i = 1; i <= 3; i++) assert.ok(/空档/.test(text('slot-meta-' + i)), '空档 ' + i);
  elt('btn-save-back').click();
  assert.ok(shown('title-screen') && hidden('save-screen'));
  game.destroy();
});

test('发布通道：stable 保持旧键，beta/preview 独立键（#17）', () => {
  assert.strictEqual(main.CHANNEL, 'stable');
  assert.strictEqual(main.SAVE_KEY, 'mixxtopia.save.v1');
  assert.strictEqual(main.SETTINGS_KEY, 'mixxtopia.settings.v1');
  assert.strictEqual(main.ACCOUNT_KEY, 'mixxtopia.account.v1', 'stable 账户会话键与文档一致');
  assert.strictEqual(main.resolveChannel({ MIXXTOPIA_CHANNEL: 'beta' }), 'beta');
  assert.strictEqual(main.resolveChannel({ MIXXTOPIA_CHANNEL: 'preview' }), 'preview');
  assert.strictEqual(main.resolveChannel({ MIXXTOPIA_CHANNEL: 'nope' }), 'stable');
  assert.strictEqual(main.resolveChannel(null), 'stable');
  assert.strictEqual(main.resolveChannel({
    document: { querySelector: () => ({ getAttribute: () => 'preview' }) },
  }), 'preview');
  assert.strictEqual(main.resolveChannel({
    document: { querySelector: () => null },
  }), 'stable');
  const beta = main.channelKeys('beta');
  assert.strictEqual(beta.saveKey, 'mixxtopia.save.beta.v1');
  assert.strictEqual(beta.settingsKey, 'mixxtopia.settings.beta.v1');
  assert.strictEqual(beta.accountKey, 'mixxtopia.account.beta.v1');
  assert.strictEqual(beta.cloudKey, 'mixxtopia.cloud.beta.v1');
  const preview = main.channelKeys('preview');
  assert.strictEqual(preview.saveKey, 'mixxtopia.save.preview.v1');
  assert.strictEqual(preview.settingsKey, 'mixxtopia.settings.preview.v1');
  assert.strictEqual(preview.accountKey, 'mixxtopia.account.preview.v1');
  const fallback = main.channelKeys('nope');
  assert.strictEqual(fallback.saveKey, 'mixxtopia.save.v1');
  assert.strictEqual(fallback.settingsKey, 'mixxtopia.settings.v1');
  assert.strictEqual(fallback.accountKey, 'mixxtopia.account.v1');
});

test('新游戏：占用第一个空档位但不立即写盘（手动存档制）', () => {
  const game = makeGame();
  elt('btn-start').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.strictEqual(game.saveSlotIndex, 0);
  assert.strictEqual(game.saveData.current, 1);
  assert.strictEqual(localStorageStub.getItem(main.SAVE_KEY), null, '开局不写盘');
  assert.ok(hidden('btn-continue'));
  game.destroy();
});

test('保存并退出：写盘回标题，继续冒险恢复关卡与已收集星', () => {
  let game = makeGame();
  elt('btn-start').click();
  teleport(game, 8, 20);
  tick(game);
  assert.strictEqual(game.stars, 1);
  press('Escape');
  tick(game);
  assert.strictEqual(game.state, STATE.PAUSED);
  elt('btn-save-quit').click();
  assert.strictEqual(game.state, STATE.TITLE);
  assert.ok(shown('btn-continue'), '保存后标题出现继续');

  const raw = JSON.parse(localStorageStub.getItem(main.SAVE_KEY));
  assert.strictEqual(raw.slots.length, 3);
  assert.strictEqual(raw.slots[0].current, 1);
  assert.deepStrictEqual(raw.slots[0].stars['1'], ['s1']);
  assert.ok(raw.slots[0].updatedAt > 0);
  game.destroy();

  game = makeGame({ keepStorage: true });
  assert.ok(shown('btn-continue'), '有存档时继续按钮显示');
  elt('btn-continue').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.strictEqual(game.saveSlotIndex, 0);
  assert.strictEqual(game.level.id, 1);
  assert.strictEqual(game.stars, 1);
  assert.strictEqual(text('hud-shards'), '★ 1/3');
  const star = game.level.entities.find((e) => e.id === 's1');
  assert.ok(star && star.collected, '读档后已收集星标记为 collected');
  game.destroy();
});

test('回到标题（不保存）：不写盘，继续按钮保持隐藏', () => {
  const game = makeGame();
  elt('btn-start').click();
  game._npcTarget['1:lily'] = 'l1.hint';
  game._playedNodes.add('l1.intro');
  game.sheepCount = 1;
  teleport(game, 8, 20);
  tick(game);
  press('Escape');
  tick(game);
  elt('btn-quit').click();
  assert.strictEqual(game.state, STATE.TITLE);
  assert.strictEqual(Object.keys(game._npcTarget).length, 0);
  assert.strictEqual(game._playedNodes.size, 0);
  assert.strictEqual(game.sheepCount, 0);
  assert.ok(hidden('btn-continue'));
  assert.strictEqual(localStorageStub.getItem(main.SAVE_KEY), null);
  game.destroy();
});

test('回到标题（不保存）不覆盖旧档：继续后回到上次保存的进度', () => {
  let game = makeGame();
  elt('btn-start').click();
  teleport(game, 8, 20);
  tick(game); // ★1
  press('Escape'); tick(game);
  elt('btn-save-quit').click();
  game.destroy();

  game = makeGame({ keepStorage: true });
  elt('btn-continue').click();
  teleport(game, 25, 14);
  tick(game); // ★2（未保存）
  assert.strictEqual(game.stars, 2);
  press('Escape'); tick(game);
  elt('btn-quit').click();
  assert.strictEqual(game.state, STATE.TITLE);
  game.destroy();

  game = makeGame({ keepStorage: true });
  elt('btn-continue').click();
  assert.strictEqual(game.stars, 1, '未保存的 ★2 不写入，回到上次存档');
  game.destroy();
});

test('通关自动存档：记录 cleared/unlocked，current 指向下一关', () => {
  let game = makeGame();
  elt('btn-start').click();
  collectAll(game);
  teleport(game, 38, 10);
  tick(game);
  assert.strictEqual(game.state, STATE.CLEAR);
  assert.match(text('clear-text'), /^星星 3\/3 · 用时 \d+:\d{2}$/);

  const raw = JSON.parse(localStorageStub.getItem(main.SAVE_KEY));
  const slot = raw.slots[0];
  assert.deepStrictEqual(slot.cleared, [1]);
  assert.strictEqual(slot.unlocked, 2);
  assert.strictEqual(slot.current, 2);
  assert.deepStrictEqual(slot.stars['1'].slice().sort(), ['s1', 's2', 's3']);
  game.destroy();

  game = makeGame({ keepStorage: true });
  elt('btn-continue').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.strictEqual(game.level.id, 2, '继续直接进入下一关');
  assert.strictEqual(game.stars, 0);
  game.destroy();
});

test('三档位：继续=最新档；三档全满时新游戏需二次点击确认覆盖', () => {
  seedSaves([slotData(1, 2, 100), slotData(2, 1, 200), slotData(3, 2, 300)]);
  let game = makeGame({ keepStorage: true });
  assert.ok(shown('btn-continue'));
  elt('btn-continue').click();
  assert.strictEqual(game.saveSlotIndex, 2, '继续载入 updatedAt 最新的档 3');
  game.destroy();

  game = makeGame({ keepStorage: true });
  elt('btn-start').click();
  assert.strictEqual(game.state, STATE.TITLE);
  assert.ok(shown('save-screen'), '三档全满 → 打开选择存档要求覆盖');
  elt('btn-slot-1').click();
  assert.strictEqual(game.state, STATE.TITLE, '第一次点击只进入确认态');
  assert.ok(/再点一次/.test(text('save-note')));
  assert.ok(elt('btn-slot-1').classList.contains('slot-confirm'));
  elt('btn-slot-1').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.strictEqual(game.saveSlotIndex, 0);
  assert.strictEqual(game.level.id, 1, '新游戏从第 1 关开始');
  game.destroy();
});

test('选择存档：已有档载入对应进度、空档直接开新游戏', () => {
  seedSaves([null, slotData(2, 2, 500), null]);
  let game = makeGame({ keepStorage: true });
  elt('btn-saves').click();
  assert.ok(/疾风/.test(text('slot-meta-2')), '存档 2 显示第 2 关信息');
  elt('btn-slot-2').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.strictEqual(game.saveSlotIndex, 1);
  assert.strictEqual(game.level.id, 2);
  game.destroy();

  game = makeGame({ keepStorage: true });
  elt('btn-saves').click();
  elt('btn-slot-1').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.strictEqual(game.saveSlotIndex, 0);
  assert.strictEqual(game.level.id, 1);
  game.destroy();
});

test('删除存档：需二次点击确认；删除后变空档、删除按钮隐藏、继续按钮消失', () => {
  seedSaves([slotData(1, 1, 100), null, null]);
  const game = makeGame({ keepStorage: true });
  elt('btn-saves').click();
  assert.ok(!elt('btn-slot-del-1').classList.contains('hidden'), '有档位时显示删除按钮');
  assert.ok(elt('btn-slot-del-2').classList.contains('hidden'), '空档不显示删除按钮');
  elt('btn-slot-del-1').click();
  assert.strictEqual(game.state, STATE.TITLE, '第一次点击只进入确认态');
  assert.ok(/再点一次/.test(text('save-note')));
  assert.ok(elt('btn-slot-del-1').classList.contains('slot-del-confirm'));
  elt('btn-slot-del-1').click();
  const raw = JSON.parse(localStorageStub.getItem(main.SAVE_KEY));
  assert.strictEqual(raw.slots[0], null, '二次点击后清空存档位');
  assert.ok(/空档/.test(text('slot-meta-1')));
  assert.ok(elt('btn-slot-del-1').classList.contains('hidden'));
  assert.ok(hidden('btn-continue'), '删光后继续按钮隐藏');
  game.destroy();
});

test('损坏存档：非法 JSON / 结构异常不抛错，按空档处理并提示', () => {  localStorageStub.setItem(main.SAVE_KEY, '{oops');
  let game = makeGame({ keepStorage: true });
  assert.ok(hidden('btn-continue'));
  elt('btn-saves').click();
  assert.ok(/损坏/.test(text('save-note')), '损坏提示');
  assert.ok(/空档/.test(text('slot-meta-1')));
  game.destroy();

  localStorageStub.setItem(main.SAVE_KEY, JSON.stringify({ v: main.SAVE_VERSION, slots: 'nope' }));
  game = makeGame({ keepStorage: true });
  assert.ok(hidden('btn-continue'));
  game.destroy();
});

test('存储不可用：保存失败提示并停留在暂停界面', () => {
  const game = makeGame({ storage: null });
  elt('btn-start').click();
  press('Escape');
  tick(game);
  assert.strictEqual(game.state, STATE.PAUSED);
  elt('btn-save-quit').click();
  assert.strictEqual(game.state, STATE.PAUSED, '保存失败不退出，避免丢进度');
  assert.ok(/保存失败/.test(text('pause-note')));
  game.destroy();
});

test('通关自动存档失败：结算追加提示，仍可进入下一关', () => {
  const game = makeGame({ storage: null });
  elt('btn-start').click();
  collectAll(game);
  teleport(game, 38, 10);
  tick(game);
  assert.strictEqual(game.state, STATE.CLEAR);
  assert.match(text('clear-text'), /^星星 3\/3 · 用时 \d+:\d{2} · 自动存档失败/);
  elt('btn-next').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  assert.strictEqual(game.level.id, 2);
  game.destroy();
});

test('声音设置：独立持久化（不占存档位），重建游戏后沿用', () => {
  let game = makeGame();
  assert.strictEqual(game.soundOn, true);
  elt('btn-sound').click();
  assert.strictEqual(game.soundOn, false);
  assert.strictEqual(text('btn-sound'), '♪ 声音：关');
  game.destroy();

  game = makeGame({ keepStorage: true });
  assert.strictEqual(game.soundOn, false);
  assert.strictEqual(text('btn-sound'), '♪ 声音：关');
  game.destroy();
});

test('读档恢复 once 已播节点与黑羊计数', () => {
  let game = makeGame();
  elt('btn-start').click();
  game._playedNodes.add('l1.intro');
  game.sheepCount = 2;
  press('Escape');
  tick(game);
  elt('btn-save-quit').click();
  game.destroy();

  game = makeGame({ keepStorage: true });
  elt('btn-continue').click();
  assert.ok(game._playedNodes.has('l1.intro'));
  assert.strictEqual(game.sheepCount, 2);
  game.destroy();
});

test('构建注入 beta 时 main 使用 beta 存档键（#17）', () => {
  const originalMain = sandbox.MIXX.main;
  sandbox.MIXXTOPIA_CHANNEL = 'beta';
  vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/cloud.js'), 'utf8'), sandbox, { filename: 'js/cloud.js' });
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/stats.js'), 'utf8'), sandbox, { filename: 'js/stats.js' });
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8'), sandbox, {
    filename: 'js/main.js?beta',
  });
  assert.strictEqual(sandbox.MIXX.main.CHANNEL, 'beta');
  assert.strictEqual(sandbox.MIXX.main.SAVE_KEY, 'mixxtopia.save.beta.v1');
  assert.strictEqual(sandbox.MIXX.main.SETTINGS_KEY, 'mixxtopia.settings.beta.v1');
  assert.strictEqual(sandbox.MIXX.main.ACCOUNT_KEY, 'mixxtopia.account.beta.v1');
  sandbox.MIXX.main = originalMain;
  delete sandbox.MIXXTOPIA_CHANNEL;
});

/* ─────────────────── 账户 / 登录（Issue #43） ─────────────────── */

test('账户关闭（opts.auth=null）：标题隐藏登录入口', () => {
  const game = makeGame();
  assert.ok(hidden('btn-account'), '无 auth 时不显示账户入口');
  game.destroy();
});

testAsync('默认账户客户端（#43）：未注入 auth 时使用 js/auth.js 与 ACCOUNT_KEY', async () => {
  localStorageStub.clear();
  const game = new main.Game(registry.get('game'), { storage: localStorageStub });
  assert.ok(game.auth && typeof game.auth.restore === 'function', '应自动创建 auth 客户端');
  assert.strictEqual(game.auth.key, main.ACCOUNT_KEY);
  await game._authReady;
  assert.ok(shown('btn-account'), '默认显示登录入口');
  assert.strictEqual(text('btn-account'), '☁ 登录 / 注册');
  game.destroy();
});

testAsync('账户入口（#43）：游客打开/返回登录界面，零网络请求，销毁不残留', async () => {
  const fetchStub = authFetch(() => { throw new Error('游客态不应发请求'); });
  const game = makeGame({ auth: makeAuth(fetchStub) });
  await game._authReady;
  assert.strictEqual(text('btn-account'), '☁ 登录 / 注册');
  assert.ok(!elt('btn-account').classList.contains('signed-in'));
  elt('btn-account').click();
  assert.ok(shown('login-screen') && hidden('title-screen'));
  assert.ok(shown('login-form') && hidden('login-account'));
  assert.strictEqual(text('login-title'), '登录 / 注册');
  assert.strictEqual(game.state, STATE.TITLE, '登录复用 screen 显隐，不新增游戏状态');
  assert.strictEqual(fetchStub.calls.length, 0, '游客态零上传');
  elt('btn-login-back').click();
  assert.ok(shown('title-screen') && hidden('login-screen'));
  elt('btn-account').click();
  game.destroy();
  assert.ok(hidden('login-screen'), '销毁时登录界面不残留');
});

testAsync('登录成功 / 登出（#43/#44）：昵称显示、切已登录面板、登出回游客且本地存档不变', async () => {
  localStorageStub.clear();
  seedSaves([slotData(1, 1, 100), null, null]);
  const saveBefore = localStorageStub.getItem(main.SAVE_KEY);
  const profile = { nickname: '小星', avatar: 'muse-3', prefs: { sound: true, touch: 'auto' } };
  const fetchStub = authFetch((call) => {
    if (call.url.indexOf('grant_type=password') >= 0) return authResponse(200, accountPayload());
    if (call.url.indexOf('/logout') >= 0) return authResponse(204, null);
    if (isProfilesCall(call)) return profileResponse(call, profile);
    throw new Error('意外请求：' + call.url);
  });
  const game = makeAccountGame(fetchStub, { keepStorage: true });
  await game._authReady;

  elt('btn-account').click();
  elt('login-email').value = 'NSWER@example.com';
  elt('login-password').value = 'secret123';
  elt('btn-login').click();
  await game._authPromise;
  await settle(game);

  assert.strictEqual(fetchStub.calls.length, 2, '登录 + 拉取 profile 各一次');
  assert.deepStrictEqual(fetchStub.calls[0].body, { email: ACCOUNT_USER.email, password: 'secret123' });
  assert.ok(isProfilesCall(fetchStub.calls[1]), '登录后自动 GET profiles');
  assert.strictEqual(text('btn-account'), '☁ 账户 · 小星', '标题优先显示昵称');
  assert.ok(elt('btn-account').classList.contains('signed-in'));
  assert.ok(shown('login-account') && hidden('login-form'));
  assert.strictEqual(text('login-email-label'), ACCOUNT_USER.email);
  assert.strictEqual(text('login-nickname-label'), '小星');
  assert.strictEqual(elt('login-password').value, '', '登录成功后清空密码');
  assert.strictEqual(text('login-msg'), '登录成功。');
  const stored = JSON.parse(localStorageStub.getItem(main.ACCOUNT_KEY));
  assert.strictEqual(stored.accessToken, 'access-1', '会话写入 mixxtopia.account.v1');

  elt('btn-logout').click();
  await game._authPromise;
  await settle(game);
  assert.strictEqual(localStorageStub.getItem(main.ACCOUNT_KEY), null, '登出清会话');
  assert.strictEqual(text('btn-account'), '☁ 登录 / 注册');
  assert.strictEqual(game.profile, null, '登出清空 profile');
  assert.ok(shown('login-form') && hidden('login-account'));
  assert.match(text('login-msg'), /游客模式/);
  assert.strictEqual(localStorageStub.getItem(main.SAVE_KEY), saveBefore, '登出不得动本地存档');

  elt('btn-login-back').click();
  assert.ok(shown('title-screen') && hidden('login-screen'));
  assert.ok(shown('btn-continue'), '本地存档仍在，继续冒险可见');
  elt('btn-continue').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  game.destroy();
});

testAsync('注册需邮箱验证（#43）：提示查收邮件，保持游客态', async () => {
  localStorageStub.clear();
  const fetchStub = authFetch((call) => {
    assert.ok(call.url.indexOf('/signup') >= 0, call.url);
    return authResponse(200, { id: 'u-2', email: 'new@example.com' });
  });
  const game = makeGame({ auth: makeAuth(fetchStub) });
  await game._authReady;
  elt('btn-account').click();
  elt('login-email').value = 'new@example.com';
  elt('login-password').value = 'secret123';
  elt('btn-register').click();
  await game._authPromise;
  assert.match(text('login-msg'), /邮箱完成验证/);
  assert.ok(shown('login-form') && hidden('login-account'));
  assert.strictEqual(localStorageStub.getItem(main.ACCOUNT_KEY), null);
  assert.strictEqual(text('btn-account'), '☁ 登录 / 注册');
  game.destroy();
});

testAsync('密码错（#43）：请求期间按钮置灰，错误码映射成中文提示', async () => {
  localStorageStub.clear();
  let release = null;
  const fetchStub = authFetch(() => new Promise((resolve) => { release = resolve; }));
  const game = makeGame({ auth: makeAuth(fetchStub) });
  await game._authReady;
  elt('btn-account').click();
  elt('login-email').value = ACCOUNT_USER.email;
  elt('login-password').value = 'wrong-pass';
  elt('btn-login').click();
  assert.strictEqual(elt('btn-login').disabled, true, '请求中按钮置灰');
  assert.match(text('login-msg'), /正在登录/);
  await flushMicrotasks();
  assert.strictEqual(typeof release, 'function', 'fetch 桩应已被调用');
  release(authResponse(400, { code: 400, error: 'invalid_grant', error_description: 'Invalid login credentials' }));
  await game._authPromise;
  assert.strictEqual(elt('btn-login').disabled, false);
  assert.strictEqual(text('login-msg'), '邮箱或密码不正确');
  assert.ok(elt('login-msg').classList.contains('login-msg-error'));
  assert.strictEqual(localStorageStub.getItem(main.ACCOUNT_KEY), null);
  assert.strictEqual(text('btn-account'), '☁ 登录 / 注册');
  game.destroy();
});

testAsync('网络失败（#43）：提示「云端暂不可用」，返回标题仍可本地游玩', async () => {
  localStorageStub.clear();
  const fetchStub = authFetch(() => { throw new TypeError('离线'); });
  const game = makeGame({ auth: makeAuth(fetchStub) });
  await game._authReady;
  elt('btn-account').click();
  elt('login-email').value = ACCOUNT_USER.email;
  elt('login-password').value = 'secret123';
  elt('btn-login').click();
  await game._authPromise;
  assert.match(text('login-msg'), /云端暂不可用/);
  assert.ok(elt('login-msg').classList.contains('login-msg-error'));
  assert.ok(shown('account-note'), '标题页保留云端不可用提示');
  assert.match(text('account-note'), /云端暂不可用/);
  assert.strictEqual(game.state, STATE.TITLE, '失败不改变游戏状态');
  elt('btn-login-back').click();
  assert.ok(shown('title-screen') && shown('account-note'));
  elt('btn-start').click();
  assert.strictEqual(game.state, STATE.PLAYING, '网络失败不阻塞本地游玩');
  game.destroy();
});

testAsync('会话恢复（#43/#44）：刷新页面后仍是登录态，仅补拉一次 profile', async () => {
  localStorageStub.clear();
  seedAccount();
  const fetchStub = authFetch((call) => {
    assert.ok(isProfilesCall(call), '有效会话不应请求 auth，只拉 profile：' + call.url);
    return profileResponse(call, { nickname: '星语', avatar: 'muse-2' });
  });
  const game = makeAccountGame(fetchStub, { keepStorage: true });
  await game._authReady;
  await settle(game);
  assert.strictEqual(text('btn-account'), '☁ 账户 · 星语');
  assert.ok(elt('btn-account').classList.contains('signed-in'));
  assert.strictEqual(fetchStub.calls.length, 1, '只发一次 profile GET');
  elt('btn-account').click();
  assert.ok(shown('login-account') && hidden('login-form'));
  assert.strictEqual(text('login-email-label'), ACCOUNT_USER.email);
  assert.strictEqual(text('login-nickname-label'), '星语');
  game.destroy();
});

testAsync('token 过期（#43/#44）：进入标题自动续期，登录态保持并拉取 profile', async () => {
  localStorageStub.clear();
  seedAccount({ expiresAt: Date.now() - 1000 });
  const fetchStub = authFetch((call) => {
    if (call.url.indexOf('grant_type=refresh_token') >= 0) {
      return authResponse(200, {
        access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600,
      });
    }
    if (isProfilesCall(call)) return profileResponse(call);
    throw new Error('意外请求：' + call.url);
  });
  const game = makeAccountGame(fetchStub, { keepStorage: true });
  await game._authReady;
  await settle(game);
  assert.strictEqual(fetchStub.calls.length, 2, '续期 + profile 各一次');
  assert.ok(fetchStub.calls[0].url.indexOf('grant_type=refresh_token') >= 0);
  assert.strictEqual(text('btn-account'), '☁ 账户 · NSWER');
  const stored = JSON.parse(localStorageStub.getItem(main.ACCOUNT_KEY));
  assert.strictEqual(stored.accessToken, 'access-2');
  game.destroy();
});

/* ─────────────────── 序章（#11 分步接入） ─────────────────── */

function prologueData() {
  const data = {};
  vm.runInNewContext(fs.readFileSync(path.join(repoRoot, 'js/data.js'), 'utf8'), data);
  return data.GAME;
}

function finishPrologue(game) {
  let pages = 0;
  while (game.scene && pages++ < 30) {
    game._tapDialog(); // 打字快进
    game._tapDialog(); // 翻页
  }
  assert.strictEqual(game.scene, null, '序章必须结束并交接关卡');
}

test('序章：levels 为空仍采用真实 p0 台词、姓名与场景；输入/计时不进入关卡', () => {
  const data = prologueData();
  data.levels = []; // 明确保留地图尚未就位时的序章回退测试
  assert.ok(fs.existsSync(path.join(repoRoot, data.scenes.p0.background)));
  withGAME(data, () => {
    const game = makeGame();
    try {
      elt('btn-start').click();
      assert.strictEqual(game.state, STATE.DIALOGUE);
      assert.strictEqual(game.scene.id, 'p0');
      assert.strictEqual(game.level, null);
      assert.strictEqual(game.player, null);
      assert.strictEqual(game._dialog.nodeId, 'p0');
      assert.strictEqual(game._dialog.lines.length, 9);
      assert.strictEqual(game.characters.byeori.name, 'Byeori');
      assert.strictEqual(text('hud-level'), '序章 · 生日夜的房间');
      assert.strictEqual(text('hud-shards'), '');
      assert.ok(hidden('title-screen') && shown('dialog'));
      assert.ok(elt('dialog-backdrop').classList.contains('scene-art'));
      assert.strictEqual(localStorageStub.getItem(main.SAVE_KEY), null, '新游戏不写盘');
      key('keydown', 'd'); tick(game, 5); key('keyup', 'd');
      press('Escape'); tick(game);
      assert.strictEqual(game.state, STATE.DIALOGUE);
      assert.strictEqual(game.runTime, 0);
      assert.strictEqual(game.stars, 0);
      finishPrologue(game);
      assert.strictEqual(game.state, STATE.PLAYING);
      assert.strictEqual(game.level.id, 1);
      assert.ok(game._playedNodes.has('p0'));
      assert.ok(hidden('dialog') && hidden('dialog-backdrop'));
      assert.ok(!elt('dialog-backdrop').classList.contains('scene-art'));
      assert.strictEqual(data.levels.length, 0, '序章不伪装为正式关卡');
    } finally { game.destroy(); }
  });
});

test('序章：E/空格/Enter 翻页与完整台词顺序，播完后才触发第一关 load 演出', () => {
  const data = prologueData();
  data.levels = [dataLevel([{ type: 'spawn', x: 2, y: 26 }])];
  data.dialogue['l1.load'] = {
    type: 'cutscene', trigger: 'load:1', scopeId: 1, entry: true, once: true,
    lines: [{ s: 'nar', t: '进入第一关。' }],
  };
  withGAME(data, () => {
    const game = makeGame();
    try {
      elt('btn-start').click();
      const keys = ['e', ' ', 'Enter'];
      for (let i = 0; i < 9; i++) {
        assert.strictEqual(game._dialog.idx, i);
        assert.ok(!game._playedNodes.has('l1.load'));
        assert.strictEqual(hidden('dialog-name'), i < 3);
        if (i >= 3) assert.strictEqual(text('dialog-name'), 'Byeori');
        press(keys[i % keys.length]); tick(game);
        assert.strictEqual(text('dialog-text'), data.dialogue.p0.lines[i].t);
        press(keys[i % keys.length]); tick(game);
      }
      assert.strictEqual(game.scene, null);
      assert.strictEqual(game.level.id, 1);
      assert.strictEqual(game._dialog.nodeId, 'l1.load');
    } finally { game.destroy(); }
  });
});

test('序章：保存/读档与重玩跳过 p0，新游戏重播；旧档无 p0 标记也直接继续', () => {
  withGAME(prologueData(), () => {
    const game = makeGame();
    try {
      elt('btn-start').click();
      finishPrologue(game);
      press('Escape'); tick(game);
      elt('btn-save-quit').click();
      const slot = JSON.parse(localStorageStub.getItem(main.SAVE_KEY)).slots[0];
      assert.strictEqual(slot.current, 1);
      assert.ok(slot.played.includes('p0'));
      elt('btn-continue').click();
      assert.strictEqual(game.state, STATE.PLAYING);
      assert.strictEqual(game.scene, null);
      press('Escape'); tick(game);
      elt('btn-restart').click();
      assert.strictEqual(game.state, STATE.PLAYING);
      assert.strictEqual(game.scene, null);
      press('Escape'); tick(game);
      elt('btn-quit').click();
      const raw = JSON.parse(localStorageStub.getItem(main.SAVE_KEY));
      raw.slots[0].played = [];
      localStorageStub.setItem(main.SAVE_KEY, JSON.stringify(raw));
      elt('btn-continue').click();
      assert.strictEqual(game.state, STATE.PLAYING);
      assert.strictEqual(game.scene, null);
      press('Escape'); tick(game);
      elt('btn-quit').click();
      elt('btn-start').click();
      assert.strictEqual(game.scene.id, 'p0');
      assert.strictEqual(game._dialog.idx, 0);
    } finally { game.destroy(); }
    assert.ok(!elt('dialog-backdrop').classList.contains('scene-art'));
  });
});

test('序章：背景加载完成才绘制；慢加载/损坏图片仍可读完，不依赖图片回调', () => {
  const prevImage = sandbox.Image;
  sandbox.Image = class { constructor() { this.complete = false; this.naturalWidth = 0; } };
  try {
    withGAME(prologueData(), () => {
      const game = makeGame();
      const ctx = game.renderer.ctx;
      const drawImage = ctx.drawImage;
      const draws = [];
      ctx.drawImage = (...args) => draws.push(args);
      try {
        elt('btn-start').click();
        game._render();
        assert.strictEqual(draws.length, 0);
        const image = game._sceneImages.get('p0');
        image.complete = true; // 加载失败：complete=true 但 naturalWidth=0
        game._render();
        assert.strictEqual(draws.length, 0);
        image.naturalWidth = 1499;
        game._render();
        assert.strictEqual(draws.length, 1);
        assert.deepStrictEqual(draws[0].slice(1), [0, 0, 320, 224]);
        image.naturalWidth = 0;
        finishPrologue(game);
        assert.strictEqual(game.state, STATE.PLAYING);
      } finally { ctx.drawImage = drawImage; game.destroy(); }
    });
  } finally {
    if (prevImage === undefined) delete sandbox.Image;
    else sandbox.Image = prevImage;
  }
});

test('序章：缺少场景或入口台词时直接进入第一关', () => {
  for (const missing of ['scene', 'dialogue']) {
    const data = prologueData();
    if (missing === 'scene') delete data.scenes.p0;
    else delete data.dialogue.p0;
    withGAME(data, () => {
      const game = makeGame();
      try {
        elt('btn-start').click();
        assert.strictEqual(game.state, STATE.PLAYING);
        assert.strictEqual(game.scene, null);
        assert.strictEqual(game.level.id, 1);
      } finally { game.destroy(); }
    });
  }
});

/* ─────────────────── 第一关正式地图 ─────────────────── */

const level1Run = require('./play-level1.js');

test('第一关：序章 → 开门/找唱片/舞台播放/后台对话/三星/黑羊 → 过关保存 → 返回标题（真实地图）', () => {
  withGAME(prologueData(), () => {
    const game = makeGame();
    try {
      elt('btn-start').click();
      const result = level1Run.playLevel1(game);
      assert.deepStrictEqual(result, { stars: 3, sheep: 1, gateOpen: true, state: STATE.CLEAR });
      const slot = JSON.parse(localStorageStub.getItem(main.SAVE_KEY)).slots[0];
      assert.deepStrictEqual(slot.stars['1'].slice().sort(), ['s1', 's2', 's3']);
      assert.deepStrictEqual(slot.cleared, [1]);
      assert.strictEqual(slot.current, 1, '后续地图未制作时存档仍指向已存在关卡');
      assert.strictEqual(text('btn-next'), '↩ 回到标题（后续关卡制作中）');
      elt('btn-next').click();
      assert.strictEqual(game.state, STATE.TITLE);
      elt('btn-continue').click();
      assert.strictEqual(game.level.id, 1);
      assert.strictEqual(game.stars, 3);
      assert.strictEqual(game.sheepCount, 1);
      assert.strictEqual(game.scene, null);
    } finally { game.destroy(); }
  });
});

test('第一关：后台对话/三星保存恢复；重玩重新收前两星即可解锁，不要求重播 once 对话', () => {
  withGAME(prologueData(), () => {
    const game = makeGame();
    try {
      elt('btn-start').click();
      level1Run.playLevel1(game);
      elt('btn-next').click(); elt('btn-continue').click();
      let star = game._entitiesOf('star').find(e => e.id === 's3');
      assert.ok(star.collected && game._starAvailable(star));
      assert.ok(game._entitiesOf('record')[0].taken);
      assert.ok(game._entitiesOf('gate')[0].open);
      game._setState(STATE.PAUSED); elt('btn-restart').click();
      star = game._entitiesOf('star').find(e => e.id === 's3');
      assert.strictEqual(star.collected, undefined);
      assert.ok(game._starAvailable(star));
      assert.strictEqual(game.stars, 0);
      assert.ok(game._entitiesOf('record')[0].taken);
      assert.ok(!game._entitiesOf('gate')[0].open);
      level1Run.walkTo(game, 10, 24);
      level1Run.walkTo(game, 5, 8); game._interact();
      level1Run.walkTo(game, 4, 4);
      game._syncProgressLocks();
      assert.ok(game._entitiesOf('gate')[0].open);
    } finally { game.destroy(); }
  });
});

test('第一关：阅读告示牌不修改共享对话字典或 played，靠近提示不被更远 NPC 抢走', () => {
  const data = prologueData();
  withGAME(data, () => {
    const game = makeGame();
    try {
      elt('btn-start').click();
      level1Run.finishDialogue(game);
      const before = Object.keys(game.dialogue).length;
      level1Run.walkTo(game, 3, 23);
      assert.strictEqual(game._nearInteractable().type, 'sign');
      assert.ok(game._interact());
      assert.strictEqual(game._dialog.lines[0].t, game.level.entities.find(e => e.id === 'party-plan').text);
      level1Run.finishDialogue(game);
      assert.strictEqual(Object.keys(game.dialogue).length, before);
      assert.ok(!game._playedNodes.has('sign:party-plan'));
    } finally { game.destroy(); }
  });
});

test('附近互动：无节点或已播完的 NPC 不遮挡告示牌，可重复提示仍可播放', () => {
  const data = prologueData();
  withGAME({
    levels: [dataLevel([
      { type: 'spawn', x: 2, y: 26 },
      { type: 'npc', id: 'lily', x: 10, y: 15, room: 'backstage', dialogue: 'l1.backstage.lily' },
      { type: 'npc', id: 'haewon', x: 10, y: 15, room: 'missing' },
      { type: 'sign', id: 'hint', x: 11, y: 15, text: '附近的告示牌' },
    ])],
    characters: data.characters,
    dialogue: data.dialogue,
  }, () => {
    const game = makeGame();
    try {
      elt('btn-start').click();
      teleport(game, 10, 15);
      assert.strictEqual(game._nearInteractable().id, 'lily');
      assert.ok(game._interact());
      assert.strictEqual(game._dialog.nodeId, 'l1.backstage.lily');
      level1Run.finishDialogue(game);
      assert.strictEqual(game._nearInteractable().id, 'hint');
      assert.ok(game._interact());
      assert.strictEqual(game._dialog.lines[0].t, '附近的告示牌');
      level1Run.finishDialogue(game);

      game.level.entities.push({ type: 'npc', id: 'byeori', x: 10, y: 15, room: 'backstage' });
      for (const nodeId of ['l1.backstage.byeori', 'l1.byeori.hint', 'l1.byeori.hint']) {
        assert.strictEqual(game._nearInteractable().id, 'byeori');
        assert.ok(game._interact());
        assert.strictEqual(game._dialog.nodeId, nodeId);
        level1Run.finishDialogue(game);
      }
    } finally { game.destroy(); }
  });
});

test('场景素材：按源路径缓存、加载失败降级，礼物盒和星光门使用独立素材', () => {
  const prevImage = sandbox.Image;
  sandbox.Image = class { constructor() { this.complete = false; this.naturalWidth = 0; } };
  try {
    withGAME(prologueData(), () => {
      const game = makeGame();
      const ctx = game.renderer.ctx, drawImage = ctx.drawImage, draws = [];
      ctx.drawImage = (...args) => draws.push(args);
      try {
        elt('btn-start').click(); level1Run.finishDialogue(game);
        assert.strictEqual(game._sceneryImages.size, Object.keys(game.level.sceneryAssets).length);
        assert.strictEqual(game._drawGift(5, 4), false);
        const props = game._sceneryImages.get(game.level.sceneryAssets.backstage);
        props.complete = true; props.naturalWidth = 1536;
        assert.strictEqual(game._drawGift(5, 4), true);
        assert.strictEqual(draws[0][0], props);
        props.naturalWidth = 0;
        assert.strictEqual(game._drawGift(5, 4), false);
        const portal = game._sceneryImages.get(game.level.sceneryAssets.portal);
        portal.complete = true; portal.naturalWidth = 1024; portal.naturalHeight = 1536;
        assert.strictEqual(game._drawSceneryAsset({ art: 'portal', x: 48, y: 10, w: 3, h: 4 }), true);
        assert.strictEqual(draws[1][0], portal);
      } finally { ctx.drawImage = drawImage; game.destroy(); }
    });
  } finally { if (prevImage === undefined) delete sandbox.Image; else sandbox.Image = prevImage; }
});

test('唱片播放后上台右转往返化妆间：普通门往返不丢星星与剧情进度', () => {
  withGAME(prologueData(), () => {
    const game = makeGame();
    try {
      elt('btn-start').click();
      level1Run.playLevel1(game, {
        onBackstage(g) {
          assert.strictEqual(g._resolveNpcNode(g._entitiesOf('npc').find(e => e.id === 'lily' && e.room === 'backstage')), 'l1.backstage.lily');
          const bounds=g._currentArea().rect;
          assert.ok(g.camera.x>=bounds.x*16 && g.camera.x+320<=(bounds.x+bounds.w)*16);
          assert.ok(g.camera.y>=bounds.y*16 && g.camera.y+224<=(bounds.y+bounds.h)*16);
          level1Run.walkTo(g,65,11);level1Run.walkTo(g,48,11); // 北侧过道完整可走。
          level1Run.walkTo(g,49,12);
          const before={...g.player};
          assert.strictEqual(g._moveAxis(0,4),false,'不能从过道走到背面的镜子上');
          assert.deepStrictEqual([g.player.x,g.player.y],[before.x,before.y]);
          level1Run.walkTo(g,48,20);level1Run.walkTo(g,65,20); // 南侧过道完整可走。
          level1Run.walkTo(g,41,15);
          assert.strictEqual(g._currentArea().id,'backstage','后台西侧不能被礼堂的摄像机留白抢走');
          const stars=g.stars, door=g._entitiesOf('roomdoor').find(e=>e.id==='to-hall');
          level1Run.walkTo(g, door.x, door.y);
          assert.strictEqual(g._currentArea().id,'hall'); assert.strictEqual(g.stars,stars);
          assert.ok(g._entitiesOf('gate')[0].open);
          level1Run.walkTo(g,28,5);assert.strictEqual(g._currentArea().id,'backstage');
        },
      });
    } finally { game.destroy(); }
  });
});

test('唱片机前置：缺一位 Muse / 缺一颗星不能取唱片，没取唱片不能播放', () => {
  withGAME(prologueData(), () => {
    const game=makeGame();
    try {
      elt('btn-start').click();level1Run.finishDialogue(game);
      const record=game._entitiesOf('record')[0], music=game._entitiesOf('gramophone')[0], req=music.requiresDialogue;
      for(let i=0;i<req.length;i++) {
        game._playedNodes=new Set(req.filter((_,n)=>n!==i));game.collected=['s1','s2'];game._syncProgressLocks();
        assert.ok(!game._requirementsMet(record) && !game._requirementsMet(music));
        assert.ok(!game._entitiesOf('gate')[0].open);
      }
      game._playedNodes=new Set(req);game.collected=['s1'];assert.ok(!game._requirementsMet(record));
      game.collected.push('s2');game._syncProgressLocks();assert.ok(game._requirementsMet(record));
      game.player={x:music.x*16,y:music.y*16};game._interact();level1Run.finishDialogue(game);
      assert.ok(!game._playedNodes.has('l1.music.play') && !game._entitiesOf('gate')[0].open);
      withSfx(calls=>{
        game._playedNodes.add('l1.record.take');game._interact();
        assert.ok(!game._entitiesOf('gate')[0].open, '播放台词没完成不能开后台');
        level1Run.finishDialogue(game);assert.ok(game._entitiesOf('gate')[0].open);
        assert.strictEqual(calls.filter(n=>n==='record-start').length,1);
        game._interact();level1Run.finishDialogue(game);assert.ok(game._entitiesOf('gate')[0].open);
        assert.strictEqual(calls.filter(n=>n==='record-start').length,1,'重复提示不重播启动音');
      });
    } finally {game.destroy();}
  });
});

test('第一关开场：由暗渐亮，淡入结束不改变玩家位置或收集进度', () => {
  withGAME(prologueData(), () => {
    const game = makeGame();
    try {
      elt('btn-start').click(); level1Run.finishDialogue(game);
      assert.ok(game._entryFade > 0);
      const pos = { ...game.player };
      for (let i = 0; i < 40; i++) game._update(0.05);
      assert.strictEqual(game._entryFade, 0);
      assert.deepStrictEqual([game.player.x, game.player.y], [pos.x, pos.y]); assert.strictEqual(game.stars, 0);
    } finally { game.destroy(); }
  });
});

test('唱片拾取后保存继续：携带记录保留，回舞台可播放，播放后读档后台仍开放', () => {
  withGAME(prologueData(), () => {
    const game=makeGame(), stop=new Error('saved-with-record');
    try {
      elt('btn-start').click();
      assert.throws(()=>level1Run.playLevel1(game,{onRecord(g){
        g._setState(STATE.PAUSED);elt('btn-save-quit').click();elt('btn-continue').click();
        assert.strictEqual(g.stars,2);assert.ok(g._entitiesOf('record')[0].taken);
        assert.ok(!g._entitiesOf('gate')[0].open);
        level1Run.talkTo(g,'stage-music');assert.ok(g._entitiesOf('gate')[0].open);
        g._setState(STATE.PAUSED);elt('btn-save-quit').click();elt('btn-continue').click();
        assert.ok(g._entitiesOf('gate')[0].open && g._entitiesOf('record')[0].taken);
        throw stop;
      }}),err=>err===stop);
    }finally{game.destroy();}
  });
});

test('第一关合并接线：序章不计时、后台战斗更新保留房间摄像机、通关统计后返回标题', () => {
  withGAME(prologueData(), () => {
    const game = makeGame({ enableStats: true });
    try {
      game._startNewGame();
      game._update(0.05);
      assert.strictEqual(game.stats.record.seconds, 0, '序章对话不累计游玩时长');
      assert.strictEqual(game.combat, null, '序章尚未创建关卡战斗');
      level1Run.playLevel1(game, {
        onBackstage(g) {
          const before = g.combat.time;
          const elapsed = g.runTime;
          g._update(0.05);
          assert.ok(g.combat.time > before, '后台游玩继续推进战斗');
          assert.ok(Math.abs(g.runTime - elapsed - 0.05) < 1e-8);
          assert.ok(Math.abs(g.stats.record.seconds - g.runTime) < 1e-8);
          const r = g._currentArea().rect;
          assert.ok(g.camera.x >= r.x * 16 && g.camera.x + 320 <= (r.x + r.w) * 16);
          assert.ok(g.camera.y >= r.y * 16 && g.camera.y + 224 <= (r.y + r.h) * 16);
          documentStub.hidden = true;
          try { g._update(1); } finally { documentStub.hidden = false; }
          assert.ok(Math.abs(g.runTime - elapsed - 0.05) < 1e-8, '隐藏页面冻结关卡和统计');
          g._render();
        },
      });
      const achievements = game.stats.view().achievements;
      assert.ok(achievements.includes('first_star'));
      assert.ok(achievements.includes('first_clear'));
      assert.ok(!achievements.includes('journey_complete'), '关 2 未制作时不解锁终章成就');
      elt('btn-next').click();
      assert.strictEqual(game.state, STATE.TITLE);
      assert.strictEqual(game.combat, null);
      assert.strictEqual(game.stats.dirty, false, '通关返回标题保留统计落盘');
    } finally { game.destroy(); }
  });
});

/* ─────────────────── 账户设置（Issue #44） ─────────────────── */

test('#44 数据：GAME.avatarPresets 六个固定头像，id 合法且默认 muse-1', () => {
  assert.ok(accountModule, 'MIXX.account 未加载');
  const presets = accountModule.avatarPresets(sandbox);
  assert.strictEqual(presets.length, 6);
  assert.deepStrictEqual(Array.from(presets, (p) => p.id),
    ['muse-1', 'muse-2', 'muse-3', 'muse-4', 'muse-5', 'muse-6']);
  for (const p of presets) {
    assert.ok(/^[a-z0-9][a-z0-9-]{0,31}$/.test(p.id), '头像 id 必须符合数据库 CHECK 格式');
    assert.ok(/^#[0-9a-f]{6}$/i.test(p.color), '头像占位色必须是 #RRGGBB');
    assert.ok(p.name.length > 0);
  }
  assert.strictEqual(accountModule.DEFAULT_AVATAR, 'muse-1');
  assert.strictEqual(accountModule.isAvatarAllowed('muse-6', sandbox), true);
  assert.strictEqual(accountModule.isAvatarAllowed('muse-99', sandbox), false);
  assert.strictEqual(accountModule.normalizeAvatar('不存在的头像', sandbox), 'muse-1');
});

test('#44 校验：昵称 1–16 字（按码点计）、空白/超长/控制字符被拒', () => {
  const acc = accountModule;
  assert.strictEqual(acc.normalizeNickname('  NSWER  ').value, 'NSWER');
  assert.strictEqual(acc.normalizeNickname('').code, 'empty_nickname');
  assert.strictEqual(acc.normalizeNickname('   ').code, 'empty_nickname');
  assert.strictEqual(acc.normalizeNickname('一二三四五六七八九十一二三四五六').ok, true); // 16 字
  const long = acc.normalizeNickname('一二三四五六七八九十一二三四五六七'); // 17 字
  assert.strictEqual(long.ok, false);
  assert.strictEqual(long.code, 'long_nickname');
  assert.match(long.message, /16 字/);
  assert.match(long.message, /17 字/);
  assert.strictEqual(acc.normalizeNickname('😀'.repeat(16)).ok, true, 'emoji 按 1 字计');
  assert.strictEqual(acc.normalizeNickname('😀'.repeat(17)).ok, false);
  assert.strictEqual(acc.normalizeNickname('a\nb').code, 'bad_nickname_chars');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(acc.normalizePrefs({ sound: false, touch: 'off', extra: 1 }))),
    { sound: false, touch: 'off' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(acc.normalizePrefs({ touch: '别乱写' }))),
    { sound: true, touch: 'auto' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(acc.normalizePrefs(null))),
    { sound: true, touch: 'auto' });
});

test('#44 index.html：设置界面元素齐全、脚本顺序正确、无自定义头像上传', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  for (const id of ['settings-screen', 'settings-nickname', 'settings-nickname-count',
    'avatar-options', 'avatar-preview', 'btn-pref-sound', 'btn-pref-touch',
    'settings-msg', 'btn-settings-retry', 'btn-settings-save', 'btn-settings-back',
    'btn-settings', 'login-account-note', 'link-delete-account']) {
    assert.ok(html.indexOf('id="' + id + '"') >= 0, 'index.html 缺少 #' + id);
  }
  assert.match(html, /id="settings-nickname"[^>]*aria-describedby="settings-nickname-count"/,
    '昵称输入需关联字数提示（可访问性）');
  assert.match(html, /id="settings-nickname-count"[^>]*aria-live="polite"/,
    '字数提示应为 live region');
  const css = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');
  assert.match(css, /\.avatar-btn:focus-visible\s*\{[^}]*outline:\s*2px solid/,
    '头像按钮键盘焦点需有可见 outline（可访问性）');
  const dataAt = html.indexOf('js/data.js');
  const accountAt = html.indexOf('js/account.js');
  const mainAt = html.indexOf('js/main.js');
  assert.ok(dataAt >= 0 && accountAt > dataAt && mainAt > accountAt,
    '脚本顺序必须 data.js → account.js → main.js');
  assert.ok(html.indexOf('type="file"') < 0, '不支持自定义头像上传');
  // 删除账户走 GitHub issue 申请（前端不直接删除 auth.users）
  const deleteAt = html.indexOf('id="link-delete-account"');
  assert.ok(deleteAt >= 0);
  const tag = html.slice(deleteAt, html.indexOf('>', deleteAt) + 1);
  assert.match(tag, /github\.com\/ideer0126\/MIXXTOPIA\/issues\/new/);
  assert.match(tag, /title=%E7%94%B3%E8%AF%B7%E5%88%A0%E9%99%A4%E8%B4%A6%E6%88%B7/); // 申请删除账户
  assert.match(tag, /target="_blank"/);
  assert.match(tag, /rel="noopener"/);
});

test('#44 本地设置向后兼容：旧 {v,sound} 记录读取后 touch 默认 auto', () => {
  localStorageStub.clear();
  localStorageStub.setItem(main.SETTINGS_KEY, JSON.stringify({ v: 1, sound: false }));
  const game = makeGame({ keepStorage: true });
  assert.strictEqual(game.soundOn, false, '旧设置的声音开关仍生效');
  assert.strictEqual(game._settings.touch, 'auto', '缺失的触屏偏好按 auto');
  assert.strictEqual(game.input.getTouchMode(), 'auto');
  assert.strictEqual(text('btn-pref-touch'), '📱 触屏按键：自动');
  assert.strictEqual(game._settingsStored, true, '旧记录也算「本机已有设置」');
  game.destroy();
});

test('#44 设置版本：拒绝显式不兼容版本，保留无版本旧记录兼容', () => {
  for (const v of [2, 0, null, '1']) {
    localStorageStub.clear();
    localStorageStub.setItem(main.SETTINGS_KEY, JSON.stringify({ v, sound: false, touch: 'off' }));
    const game = makeGame({ keepStorage: true });
    assert.strictEqual(game.soundOn, true);
    assert.strictEqual(game._settings.touch, 'auto');
    assert.strictEqual(game._settingsStored, false, '不兼容记录不能阻止采用云端偏好');
    game._applyCloudPrefs({ sound: false, touch: 'on' });
    assert.strictEqual(game.soundOn, false);
    assert.strictEqual(game.input.getTouchMode(), 'on');
    game.destroy();
  }
  localStorageStub.clear();
  localStorageStub.setItem(main.SETTINGS_KEY, JSON.stringify({ sound: false, touch: 'off' }));
  const legacy = makeGame({ keepStorage: true });
  assert.strictEqual(legacy.soundOn, false);
  assert.strictEqual(legacy._settings.touch, 'off');
  assert.strictEqual(legacy._settingsStored, true, '缺少版本的旧记录仍有效');
  legacy._applyCloudPrefs({ sound: true, touch: 'on' });
  assert.strictEqual(legacy.soundOn, false, '旧记录依旧遵循本机优先');
  assert.strictEqual(legacy._settings.touch, 'off');
  legacy.destroy();
});

test('#44 损坏设置容错：JSON 非法按默认值，且不阻塞游戏', () => {
  localStorageStub.clear();
  localStorageStub.setItem(main.SETTINGS_KEY, '{oops');
  const game = makeGame({ keepStorage: true });
  assert.strictEqual(game.soundOn, true);
  assert.strictEqual(game._settings.touch, 'auto');
  assert.strictEqual(game._settingsStored, false, '损坏视为没有设置记录');
  elt('btn-start').click();
  assert.strictEqual(game.state, STATE.PLAYING);
  game.destroy();
});

testAsync('#44 游客：标题设置可调整并持久化本机偏好，账户资料禁用且零网络', async () => {
  for (const opts of [{}, { profile: null }]) {
    localStorageStub.clear();
    const fetchStub = authFetch(() => { throw new Error('游客态不应发请求'); });
    const game = makeAccountGame(fetchStub, opts);
    await game._authReady;
    await settle(game);
    assert.ok(shown('btn-title-settings'), '游客可见标题设置入口');
    elt('btn-title-settings').click();
    assert.ok(shown('settings-screen') && hidden('title-screen') && hidden('login-screen'));
    assert.match(text('settings-account'), /未登录：仅可调整本机偏好/);
    assert.strictEqual(elt('settings-nickname').disabled, true);
    for (const btn of Object.values(game._ui.avatarBtns)) assert.strictEqual(btn.disabled, true);
    assert.strictEqual(elt('btn-settings-save').disabled, true);
    const nextTouch = { auto: 'on', on: 'off', off: 'auto' };
    for (let i = 0; i < 3; i++) {
      const expected = nextTouch[game._settings.touch];
      elt('btn-pref-touch').click();
      assert.strictEqual(game.input.touchMode, expected);
      assert.strictEqual(JSON.parse(localStorageStub.getItem(main.SETTINGS_KEY)).touch, expected);
    }
    const soundBefore = game.soundOn;
    elt('btn-pref-sound').click();
    assert.strictEqual(game.soundOn, !soundBefore);
    assert.strictEqual(JSON.parse(localStorageStub.getItem(main.SETTINGS_KEY)).sound, !soundBefore);
    await settle(game);
    assert.strictEqual(game.profileError, null, '游客不尝试读取云端资料');
    assert.strictEqual(fetchStub.calls.length, 0, '游客态零上传');
    elt('btn-settings-back').click();
    assert.ok(shown('title-screen') && hidden('settings-screen'));
    assert.strictEqual(game._openSettingsScreen(), true);
    game.destroy();
    assert.ok(hidden('settings-screen'), '销毁时设置界面不残留');
  }
});

testAsync('#44 设置界面：昵称/头像/云端偏好回填，六个固定头像可选', async () => {
  localStorageStub.clear();
  seedAccount();
  const fetchStub = authFetch((call) => {
    assert.ok(isProfilesCall(call), '只应拉取 profile：' + call.url);
    return profileResponse(call, {
      nickname: '小星', avatar: 'muse-3', prefs: { sound: false, touch: 'on' },
    });
  });
  const game = makeAccountGame(fetchStub, { keepStorage: true });
  await game._authReady;
  await settle(game);

  elt('btn-account').click();
  assert.ok(shown('btn-settings'), '已登录后显示设置入口');
  elt('btn-settings').click();
  assert.ok(shown('settings-screen') && hidden('login-screen') && hidden('title-screen'));
  assert.strictEqual(game.state, STATE.TITLE, '账户设置不新增游戏状态');
  assert.strictEqual(elt('settings-nickname').value, '小星');
  assert.strictEqual(text('settings-nickname-count'), '2/16');
  assert.strictEqual(Object.keys(game._ui.avatarBtns).length, 6, '按 GAME.avatarPresets 渲染 6 个头像');
  assert.ok(game._ui.avatarBtns['muse-3'].classList.contains('is-selected'));
  assert.ok(!game._ui.avatarBtns['muse-1'].classList.contains('is-selected'));
  assert.strictEqual(text('avatar-preview-name'), 'Sullyoon');
  assert.strictEqual(text('btn-pref-touch'), '📱 触屏按键：常开');
  assert.strictEqual(text('btn-pref-sound'), '♪ 声音：关', '新设备采用云端声音偏好');
  assert.strictEqual(game.soundOn, false);
  assert.strictEqual(game.input.getTouchMode(), 'on');
  assert.match(text('settings-cloud-note'), /云端/);

  elt('btn-settings-back').click();
  assert.ok(shown('login-screen') && hidden('settings-screen'));
  assert.ok(shown('login-account'));
  game.destroy();
});

testAsync('#44 保存设置：PATCH profiles 带昵称/头像/偏好，标题与本地设置同步更新', async () => {
  localStorageStub.clear();
  seedAccount();
  const fetchStub = authFetch((call) => {
    if (!isProfilesCall(call)) throw new Error('意外请求：' + call.url);
    return profileResponse(call);
  });
  const game = makeAccountGame(fetchStub, { keepStorage: true });
  await game._authReady;
  await settle(game);
  elt('btn-account').click();
  elt('btn-settings').click();

  elt('settings-nickname').value = 'Muse小星';
  game._onNicknameInput();
  assert.strictEqual(text('settings-nickname-count'), '6/16');
  game._ui.avatarBtns['muse-5'].click();
  assert.ok(game._ui.avatarBtns['muse-5'].classList.contains('is-selected'));
  elt('btn-pref-touch').click(); // auto → on
  assert.strictEqual(game.input.getTouchMode(), 'on');
  assert.ok(elt('touch-controls').classList.contains('touch-pref-on'));
  elt('btn-pref-sound').click(); // true → false
  assert.strictEqual(text('btn-sound'), '♪ 声音：关', '设置界面切换声音与标题快捷开关同步');

  const profileCallsBefore = fetchStub.calls.filter(isProfilesCall).length;
  elt('btn-settings-save').click();
  await game._accountPromise;
  await settle(game);
  const profileCalls = fetchStub.calls.filter(isProfilesCall);
  assert.strictEqual(profileCalls.length, profileCallsBefore + 1, '保存只发一次 PATCH');
  const patch = profileCalls[profileCalls.length - 1];
  assert.strictEqual(patch.init.method, 'PATCH');
  assert.strictEqual(patch.init.headers.Prefer, 'return=representation');
  assert.match(patch.init.headers.Authorization, /^Bearer /);
  assert.deepStrictEqual(patch.body, {
    nickname: 'Muse小星',
    avatar: 'muse-5',
    prefs: { sound: false, touch: 'on' },
  });
  assert.strictEqual(text('settings-msg'), '设置已保存。');
  assert.strictEqual(text('btn-account'), '☁ 账户 · Muse小星');
  assert.strictEqual(text('login-nickname-label'), 'Muse小星');
  const storedSettings = JSON.parse(localStorageStub.getItem(main.SETTINGS_KEY));
  assert.deepStrictEqual(storedSettings, { v: 1, sound: false, touch: 'on' });
  game.destroy();
});

testAsync('#44 昵称超长/为空：客户端拒绝并给出提示，不发起 PATCH 请求', async () => {
  localStorageStub.clear();
  seedAccount();
  const fetchStub = authFetch((call) => {
    if (!isProfilesCall(call)) throw new Error('意外请求：' + call.url);
    return profileResponse(call);
  });
  const game = makeAccountGame(fetchStub, { keepStorage: true });
  await game._authReady;
  await settle(game);
  elt('btn-account').click();
  elt('btn-settings').click();
  const patchesBefore = fetchStub.calls.filter(
    (c) => isProfilesCall(c) && c.init.method === 'PATCH').length;

  elt('settings-nickname').value = '一二三四五六七八九十一二三四五六七'; // 17 字
  elt('btn-settings-save').click();
  await flushMicrotasks();
  assert.match(text('settings-msg'), /昵称最多 16 字/);
  assert.match(text('settings-msg'), /17 字/);
  assert.ok(elt('settings-msg').classList.contains('settings-msg-error'));
  assert.strictEqual(elt('settings-nickname').getAttribute('aria-invalid'), 'true');
  assert.strictEqual(fetchStub.calls.filter(
    (c) => isProfilesCall(c) && c.init.method === 'PATCH').length, patchesBefore,
    '超长昵称不得发请求');

  elt('settings-nickname').value = '   ';
  elt('btn-settings-save').click();
  await flushMicrotasks();
  assert.match(text('settings-msg'), /昵称不能为空/);
  assert.strictEqual(fetchStub.calls.filter(
    (c) => isProfilesCall(c) && c.init.method === 'PATCH').length, patchesBefore);
  game.destroy();
});

testAsync('#44 保存失败：网络类错误提示云端暂不可用，本机偏好仍落盘', async () => {
  localStorageStub.clear();
  seedAccount();
  const fetchStub = authFetch((call) => {
    if (!isProfilesCall(call)) throw new Error('意外请求：' + call.url);
    if (call.init.method === 'PATCH') throw new TypeError('断网');
    return profileResponse(call);
  });
  const game = makeAccountGame(fetchStub, { keepStorage: true });
  await game._authReady;
  await settle(game);
  elt('btn-account').click();
  elt('btn-settings').click();
  elt('settings-nickname').value = '离线小星';
  elt('btn-pref-touch').click(); // auto → on
  const getsBefore = fetchStub.calls.filter(
    (c) => isProfilesCall(c) && c.init.method === 'GET').length;

  elt('btn-settings-save').click();
  await game._accountPromise;
  await settle(game);
  assert.match(text('settings-msg'), /云端暂不可用/);
  assert.ok(elt('settings-msg').classList.contains('settings-msg-error'));
  const storedSettings = JSON.parse(localStorageStub.getItem(main.SETTINGS_KEY));
  assert.strictEqual(storedSettings.sound, true);
  assert.strictEqual(storedSettings.touch, 'on', '云端失败不丢本机偏好');
  assert.strictEqual(game.input.getTouchMode(), 'on');
  assert.strictEqual(
    fetchStub.calls.filter((c) => isProfilesCall(c) && c.init.method === 'GET').length,
    getsBefore,
    '保存失败不应触发后台重新 GET（避免迟到结果覆盖正在编辑的内容）'
  );
  assert.strictEqual(elt('btn-settings-save').disabled, false, '资料仍有效，可再次尝试保存');
  game.destroy();
});

testAsync('#44 偏好为设备级：新设备采用一次云端；本机已有设置时（换号/云端变化）不自动覆盖', async () => {
  // A) 本机无设置记录（新设备/清缓存）→ 采用云端声音/操作偏好
  localStorageStub.clear();
  seedAccount();
  const fetchA = authFetch((call) => profileResponse(call, {
    prefs: { sound: false, touch: 'off' },
  }));
  const gameA = makeAccountGame(fetchA, { keepStorage: true });
  await gameA._authReady;
  await settle(gameA);
  assert.strictEqual(gameA.soundOn, false);
  assert.strictEqual(gameA._settings.touch, 'off');
  assert.strictEqual(gameA.input.getTouchMode(), 'off');
  assert.ok(elt('touch-controls').classList.contains('touch-pref-off'));
  assert.deepStrictEqual(JSON.parse(localStorageStub.getItem(main.SETTINGS_KEY)),
    { v: 1, sound: false, touch: 'off' });
  gameA.destroy();

  // B) 本机已有设置记录 → 本地优先，不自动覆盖；设置页提示差异
  localStorageStub.clear();
  localStorageStub.setItem(main.SETTINGS_KEY, JSON.stringify({ v: 1, sound: false, touch: 'off' }));
  seedAccount();
  const fetchB = authFetch((call) => profileResponse(call, {
    prefs: { sound: true, touch: 'on' },
  }));
  const gameB = makeAccountGame(fetchB, { keepStorage: true });
  await gameB._authReady;
  await settle(gameB);
  assert.strictEqual(gameB.soundOn, false, '本地已有设置：不被云端覆盖');
  assert.strictEqual(gameB._settings.touch, 'off');
  assert.strictEqual(gameB._cloudPrefsDiffer, true);
  elt('btn-account').click();
  elt('btn-settings').click();
  assert.match(text('settings-cloud-note'), /云端偏好与本机不同/);
  gameB.destroy();
});

testAsync('#44 删除账户入口：只做 GitHub issue 申请链接，不调用 auth 删除接口', async () => {
  localStorageStub.clear();
  seedAccount();
  let deletes = 0;
  const fetchStub = authFetch((call) => {
    if (/\/auth\/v1\/(logout|user|delete)/.test(call.url)) deletes++;
    if (!isProfilesCall(call)) throw new Error('意外请求：' + call.url);
    return profileResponse(call);
  });
  const game = makeAccountGame(fetchStub, { keepStorage: true });
  await game._authReady;
  await settle(game);
  elt('btn-account').click();
  elt('btn-settings').click();
  const link = elt('link-delete-account');
  assert.ok(link, '设置界面必须有删除账户申请入口');
  // index.html 的链接文案与 URL 由上面的静态用例校验；这里点击只验证不发删除请求
  link.click();
  await flushMicrotasks();
  assert.strictEqual(deletes, 0, '前端不得直接调用 auth 删除接口');
  game.destroy();
});

testAsync('#44 切号竞态：旧账号资料请求在途时切到新账号，仍会加载新资料', async () => {
  localStorageStub.clear();
  const deferred = [];
  const fakeProfile = {
    load() {
      return new Promise((resolve) => { deferred.push(resolve); });
    },
    save() { return Promise.resolve(null); },
  };
  const authState = {
    session: { user: { id: 'u-a', email: 'a@example.com' } },
    listener: null,
  };
  const fakeAuth = {
    available: true,
    lastError: null,
    onChange(fn) { authState.listener = fn; return function () {}; },
    getSession() { return authState.session; },
    ensureFresh() { return Promise.resolve(authState.session); },
    refresh() { return Promise.resolve(authState.session); },
    restore() { return Promise.resolve(authState.session); },
  };
  const game = new main.Game(registry.get('game'), {
    storage: localStorageStub,
    auth: fakeAuth,
    profile: fakeProfile,
  });
  await game._authReady;
  await flushMicrotasks();
  assert.strictEqual(deferred.length, 1, '登录后开始加载账号 A 的资料');

  // A 的资料还没回来就切换到账号 B
  authState.session = { user: { id: 'u-b', email: 'b@example.com' } };
  game._syncProfile();
  await flushMicrotasks();
  assert.strictEqual(deferred.length, 2, '切号后不能被旧请求去重，必须加载 B');

  // A 的旧结果最后返回：丢弃，不得覆盖 B
  deferred[0]({ nickname: '账号A', avatar: 'muse-1', prefs: { sound: true, touch: 'auto' } });
  await flushMicrotasks();
  assert.strictEqual(game.profile, null, '旧账号结果必须丢弃');

  deferred[1]({ nickname: '账号B', avatar: 'muse-2', prefs: { sound: true, touch: 'auto' } });
  await flushMicrotasks();
  assert.strictEqual(game.profile.nickname, '账号B');
  assert.strictEqual(text('btn-account'), '☁ 账户 · 账号B');
  game.destroy();
});

testAsync('#44 资料未就绪：设置页禁用保存，不会用默认值覆盖云端', async () => {
  localStorageStub.clear();
  const deferred = [];
  const saveCalls = [];
  const fakeProfile = {
    load() { return new Promise((resolve) => { deferred.push(resolve); }); },
    save(input) { saveCalls.push(input); return Promise.resolve(null); },
  };
  const authState = { session: { user: { id: 'u-a', email: 'a@example.com' } } };
  const fakeAuth = {
    available: true,
    lastError: null,
    onChange() { return function () {}; },
    getSession() { return authState.session; },
    ensureFresh() { return Promise.resolve(authState.session); },
    refresh() { return Promise.resolve(authState.session); },
    restore() { return Promise.resolve(authState.session); },
  };
  const game = new main.Game(registry.get('game'), {
    storage: localStorageStub,
    auth: fakeAuth,
    profile: fakeProfile,
  });
  await game._authReady;
  await flushMicrotasks();
  assert.strictEqual(deferred.length, 1, '资料请求已发出但未返回');

  game._openLoginScreen();
  elt('btn-settings').click();
  assert.ok(shown('settings-screen'));
  assert.strictEqual(elt('btn-settings-save').disabled, true, '资料未就绪时保存按钮禁用');
  assert.strictEqual(elt('settings-nickname').disabled, true, '资料未就绪时昵称输入禁用');
  assert.strictEqual(elt('settings-nickname').value, 'NSWER', '表单暂为默认占位，不能当玩家输入保存');
  assert.strictEqual(elt('btn-pref-touch').disabled, false, '本机偏好仍可调整');
  assert.strictEqual(elt('btn-settings-retry').classList.contains('hidden'), true, '加载中不显示重试');

  // 即使绕过 disabled 直接触发保存，也必须被双保险拦住、不得 PATCH 默认值
  game._onSettingsSave();
  await flushMicrotasks();
  assert.strictEqual(saveCalls.length, 0, '资料未就绪不得保存');
  assert.match(text('settings-msg'), /正在读取云端资料/);

  deferred[0]({ nickname: '云端小星', avatar: 'muse-3', avatarRaw: 'muse-3', prefs: { sound: true, touch: 'auto' } });
  await flushMicrotasks();
  assert.strictEqual(elt('btn-settings-save').disabled, false, '资料就绪后恢复保存');
  assert.strictEqual(elt('settings-nickname').value, '云端小星');
  assert.strictEqual(text('avatar-preview-name'), 'Sullyoon');
  game.destroy();
});

testAsync('#44 资料加载失败：显示重试，重试成功后恢复表单', async () => {
  localStorageStub.clear();
  seedAccount();
  let profileGets = 0;
  const fetchStub = authFetch((call) => {
    if (!isProfilesCall(call)) throw new Error('意外请求：' + call.url);
    profileGets++;
    if (profileGets <= 3) throw new TypeError('断网');
    return profileResponse(call, { nickname: '重试成功', avatar: 'muse-2' });
  });
  const game = makeAccountGame(fetchStub, { keepStorage: true });
  await game._authReady;
  await settle(game);
  game._openLoginScreen();
  await settle(game);
  elt('btn-settings').click();
  await settle(game);

  assert.strictEqual(game.profile, null);
  assert.ok(game.profileError, '资料加载失败应记录错误');
  assert.match(text('settings-cloud-note'), /云端资料暂不可用/);
  assert.strictEqual(elt('btn-settings-save').disabled, true, '失败时禁止保存');
  assert.strictEqual(elt('btn-settings-retry').classList.contains('hidden'), false, '失败时显示重试按钮');

  elt('btn-settings-retry').click();
  await settle(game);
  assert.ok(game.profile, '重试后应加载到资料');
  assert.strictEqual(elt('settings-nickname').value, '重试成功');
  assert.strictEqual(elt('btn-settings-save').disabled, false);
  assert.strictEqual(elt('btn-settings-retry').classList.contains('hidden'), true, '成功后隐藏重试');
  game.destroy();
});

testAsync('#44 未知/未来版本头像：只改昵称不会把云端头像覆盖成默认', async () => {
  localStorageStub.clear();
  seedAccount();
  const storedRow = { nickname: '小星', avatar: 'muse-9', prefs: { sound: true, touch: 'auto' } };
  const fetchStub = authFetch((call) => {
    if (!isProfilesCall(call)) throw new Error('意外请求：' + call.url);
    return profileResponse(call, storedRow);
  });
  const game = makeAccountGame(fetchStub, { keepStorage: true });
  await game._authReady;
  await settle(game);
  assert.strictEqual(game.profile.avatar, 'muse-1', '未知头像渲染回退默认');
  assert.strictEqual(game.profile.avatarRaw, 'muse-9', '保留云端原始头像 id');

  game._openLoginScreen();
  elt('btn-settings').click();
  assert.match(text('settings-cloud-note'), /muse-9/, '提示云端头像不在可选集');
  assert.strictEqual(text('avatar-preview-name'), 'Lily', '预览回退默认头像');

  elt('settings-nickname').value = '只改昵称';
  elt('btn-settings-save').click();
  await game._accountPromise;
  await settle(game);
  const patches = fetchStub.calls.filter(
    (c) => isProfilesCall(c) && c.init.method === 'PATCH');
  assert.strictEqual(patches.length, 1);
  assert.strictEqual(patches[0].body.nickname, '只改昵称');
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(patches[0].body, 'avatar'),
    false,
    '未改头像时必须省略 avatar 字段，避免覆盖已知未知 id'
  );
  assert.strictEqual(game.profile.avatarRaw, 'muse-9', '保存后仍保留云端原始头像');

  // 主动选新头像后：未知头像提示消失，保存会回写所选头像
  elt('settings-nickname').value = '再改一次';
  game._ui.avatarBtns['muse-6'].click();
  assert.strictEqual(/muse-9/.test(text('settings-cloud-note')), false,
    '玩家主动选头像后不再提示「不改动云端头像」');
  elt('btn-settings-save').click();
  await game._accountPromise;
  await settle(game);
  const patches2 = fetchStub.calls.filter(
    (c) => isProfilesCall(c) && c.init.method === 'PATCH');
  assert.strictEqual(patches2.length, 2);
  assert.strictEqual(patches2[1].body.avatar, 'muse-6', '主动选头像时回写所选值');
  game.destroy();
});

testAsync('#44 登出时设置页自动关闭，不残留旧资料', async () => {
  localStorageStub.clear();
  seedAccount();
  const fetchStub = authFetch((call) => {
    if (call.url.indexOf('/logout') >= 0) return authResponse(204, null);
    if (isProfilesCall(call)) return profileResponse(call, { nickname: '残留检查' });
    throw new Error('意外请求：' + call.url);
  });
  const game = makeAccountGame(fetchStub, { keepStorage: true });
  await game._authReady;
  await settle(game);
  game._openLoginScreen();
  elt('btn-settings').click();
  assert.ok(shown('settings-screen'));
  await game.auth.signOut();
  await settle(game);
  assert.ok(hidden('settings-screen'), '登出后设置页必须关闭');
  assert.ok(shown('title-screen') && shown('login-form'));
  assert.strictEqual(game.profile, null);
  assert.strictEqual(text('btn-account'), '☁ 登录 / 注册');
  game.destroy();
});

testAsync('#44 切号：已加载 A 后切 B，立即清空旧资料且旧保存回包不落到 B', async () => {
  localStorageStub.clear();
  const loads = [];
  const saves = [];
  const fakeProfile = {
    load() { return new Promise((resolve) => { loads.push(resolve); }); },
    save(input) {
      return new Promise((resolve) => { saves.push({ input: input, resolve: resolve }); });
    },
  };
  const authState = { session: { user: { id: 'u-a', email: 'a@example.com' } } };
  const fakeAuth = {
    available: true,
    lastError: null,
    onChange() { return function () {}; },
    getSession() { return authState.session; },
    ensureFresh() { return Promise.resolve(authState.session); },
    refresh() { return Promise.resolve(authState.session); },
    restore() { return Promise.resolve(authState.session); },
  };
  const game = new main.Game(registry.get('game'), {
    storage: localStorageStub,
    auth: fakeAuth,
    profile: fakeProfile,
  });
  await game._authReady;
  await flushMicrotasks();
  loads[0]({ nickname: '账号A', avatar: 'muse-1', avatarRaw: 'muse-1', prefs: { sound: true, touch: 'auto' } });
  await flushMicrotasks();
  assert.strictEqual(game.profile.nickname, '账号A');
  assert.strictEqual(text('btn-account'), '☁ 账户 · 账号A');

  // A 的保存请求在途
  game._openLoginScreen();
  elt('btn-settings').click();
  elt('settings-nickname').value = 'A新名';
  elt('btn-settings-save').click();
  await flushMicrotasks();
  assert.strictEqual(saves.length, 1, 'A 的保存请求已发出');
  assert.strictEqual(game._accountBusy, true);

  // 直接切到 B（B 资料挂起）
  authState.session = { user: { id: 'u-b', email: 'b@example.com' } };
  game._syncProfile();
  await flushMicrotasks();
  assert.strictEqual(game.profile, null, '切号后立即清空 A 的资料');
  assert.strictEqual(text('btn-account'), '☁ 账户 · b@example.com', '标题不得残留 A 的昵称');
  assert.strictEqual(elt('btn-settings-save').disabled, true, 'B 资料就绪前禁止保存');
  assert.strictEqual(loads.length, 2, 'B 的资料加载已开始');

  // A 的保存回包迟到：必须丢弃，不能写到 B
  saves[0].resolve({ nickname: 'A新名', avatar: 'muse-1', avatarRaw: 'muse-1', prefs: { sound: true, touch: 'auto' } });
  await flushMicrotasks();
  assert.strictEqual(game.profile, null, '旧账号保存回包必须丢弃');
  assert.strictEqual(text('btn-account'), '☁ 账户 · b@example.com');

  loads[1]({ nickname: '账号B', avatar: 'muse-2', avatarRaw: 'muse-2', prefs: { sound: true, touch: 'auto' } });
  await flushMicrotasks();
  assert.strictEqual(game.profile.nickname, '账号B');
  assert.strictEqual(text('btn-account'), '☁ 账户 · 账号B');
  assert.strictEqual(elt('btn-settings-save').disabled, false);
  game.destroy();
});

testAsync('#44 本机写盘失败：保存/切换偏好提示「已生效但刷新后会丢失」', async () => {
  localStorageStub.clear();
  const base = createLocalStorage();
  const brokenStorage = {
    getItem(key) { return base.getItem(key); },
    setItem() { throw new Error('quota exceeded'); },
    removeItem(key) { base.removeItem(key); },
    clear() { base.clear(); },
  };
  const fakeProfile = {
    load() { return Promise.resolve({ nickname: '云端小星', avatar: 'muse-2', avatarRaw: 'muse-2', prefs: { sound: true, touch: 'auto' } }); },
    save(input) {
      return Promise.resolve({
        nickname: input.nickname,
        avatar: input.avatar || 'muse-2',
        avatarRaw: input.avatar || 'muse-2',
        prefs: input.prefs,
      });
    },
  };
  const fakeAuth = {
    available: true,
    lastError: null,
    onChange() { return function () {}; },
    getSession() { return { user: { id: 'u-a', email: 'a@example.com' } }; },
    ensureFresh() { return Promise.resolve(this.getSession()); },
    refresh() { return Promise.resolve(this.getSession()); },
    restore() { return Promise.resolve(this.getSession()); },
  };
  const game = new main.Game(registry.get('game'), {
    storage: brokenStorage,
    auth: fakeAuth,
    profile: fakeProfile,
  });
  await game._authReady;
  await flushMicrotasks();
  game._openLoginScreen();
  elt('btn-settings').click();

  elt('btn-pref-touch').click(); // 偏好即时切换，本地写盘失败
  assert.match(text('settings-msg'), /本机存储不可用/);
  assert.ok(elt('settings-msg').classList.contains('settings-msg-error'));

  elt('settings-nickname').value = '写盘失败';
  elt('btn-settings-save').click();
  await game._accountPromise;
  await flushMicrotasks();
  assert.match(text('settings-msg'), /本机存储不可用/);
  assert.ok(elt('settings-msg').classList.contains('settings-msg-error'));
  assert.strictEqual(game.profile.nickname, '写盘失败', '云端保存仍成功');
  game.destroy();
});

testAsync('#44 保存期间冻结声音/触屏偏好按钮', async () => {
  localStorageStub.clear();
  const saves = [];
  const fakeProfile = {
    load() { return Promise.resolve({ nickname: '小星', avatar: 'muse-2', avatarRaw: 'muse-2', prefs: { sound: true, touch: 'auto' } }); },
    save(input) {
      return new Promise((resolve) => { saves.push({ input: input, resolve: resolve }); });
    },
  };
  const fakeAuth = {
    available: true,
    lastError: null,
    onChange() { return function () {}; },
    getSession() { return { user: { id: 'u-a', email: 'a@example.com' } }; },
    ensureFresh() { return Promise.resolve(this.getSession()); },
    refresh() { return Promise.resolve(this.getSession()); },
    restore() { return Promise.resolve(this.getSession()); },
  };
  const game = new main.Game(registry.get('game'), {
    storage: localStorageStub,
    auth: fakeAuth,
    profile: fakeProfile,
  });
  await game._authReady;
  await flushMicrotasks();
  game._openLoginScreen();
  elt('btn-settings').click();
  elt('settings-nickname').value = '保存中';
  elt('btn-settings-save').click();
  await flushMicrotasks();
  assert.strictEqual(elt('btn-pref-sound').disabled, true, '保存期间冻结声音按钮');
  assert.strictEqual(elt('btn-pref-touch').disabled, true, '保存期间冻结触屏偏好按钮');
  saves[0].resolve({ nickname: '保存中', avatar: 'muse-2', avatarRaw: 'muse-2', prefs: { sound: true, touch: 'auto' } });
  await flushMicrotasks();
  assert.strictEqual(elt('btn-pref-sound').disabled, false);
  assert.strictEqual(elt('btn-pref-touch').disabled, false);
  assert.strictEqual(text('settings-msg'), '设置已保存。');
  game.destroy();
});

testAsync('#44 已登录但资料模块缺失：设置可调整本机偏好，账户资料与云端保存禁用', async () => {
  localStorageStub.clear();
  const fetchStub = authFetch(() => { throw new Error('资料模块缺失时不应发请求'); });
  const fakeAuth = {
    available: true,
    lastError: null,
    onChange() { return function () {}; },
    getSession() { return { user: { id: 'u-a', email: 'a@example.com' } }; },
    ensureFresh() { return Promise.resolve(this.getSession()); },
    refresh() { return Promise.resolve(this.getSession()); },
    restore() { return Promise.resolve(this.getSession()); },
  };
  const game = new main.Game(registry.get('game'), {
    storage: localStorageStub,
    auth: fakeAuth,
    profile: null,
    fetch: fetchStub,
  });
  await game._authReady;
  await flushMicrotasks();
  elt('btn-account').click();
  assert.ok(shown('login-account'));
  assert.strictEqual(text('login-nickname-label'), '资料功能未启用');
  assert.match(text('login-account-note'), /资料功能未启用/);
  assert.ok(shown('btn-settings'), '已登录时仍可从账户面板打开设置');
  elt('btn-settings').click();
  assert.ok(shown('settings-screen') && hidden('login-screen') && hidden('title-screen'));
  assert.strictEqual(elt('settings-nickname').disabled, true);
  for (const btn of Object.values(game._ui.avatarBtns)) assert.strictEqual(btn.disabled, true);
  assert.strictEqual(elt('btn-settings-save').disabled, true);
  assert.ok(hidden('btn-settings-retry'), '无资料客户端时不显示重试');
  assert.match(text('settings-cloud-note'), /云端资料功能未启用/);
  assert.match(text('settings-cloud-note'), /只保存在本机并立即生效/);
  assert.strictEqual(elt('btn-pref-sound').disabled, false);
  assert.strictEqual(elt('btn-pref-touch').disabled, false);
  const soundBefore = game.soundOn;
  elt('btn-pref-sound').click();
  assert.strictEqual(game.soundOn, !soundBefore);
  assert.strictEqual(audio.isEnabled(), !soundBefore, '声音偏好立即应用到音频系统');
  elt('btn-pref-touch').click();
  assert.strictEqual(game.input.touchMode, 'on', '触屏偏好立即应用到输入系统');
  assert.deepStrictEqual(JSON.parse(localStorageStub.getItem(main.SETTINGS_KEY)), {
    v: 1, sound: !soundBefore, touch: 'on',
  });
  elt('btn-settings-back').click();
  assert.ok(shown('login-screen') && hidden('settings-screen'));
  elt('btn-login-back').click();
  assert.ok(shown('btn-title-settings'), '已登录但无资料客户端时标题设置入口仍可见');
  elt('btn-title-settings').click();
  assert.ok(shown('settings-screen') && hidden('title-screen') && hidden('login-screen'));
  assert.strictEqual(game.input.touchMode, 'on');
  assert.strictEqual(game.soundOn, !soundBefore);
  await flushMicrotasks();
  assert.strictEqual(game._profilePromise, null, '不尝试加载云端资料');
  assert.strictEqual(fetchStub.calls.length, 0, '本机偏好更改不发网络请求');
  game.destroy();
});

testAsync('#44 往返：保存设置后重新登录，昵称/头像/偏好与云端一致', async () => {
  localStorageStub.clear();
  const server = {
    row: { nickname: '原始昵称', avatar: 'muse-1', prefs: { sound: true, touch: 'auto' } },
  };
  const fetchStub = authFetch((call) => {
    if (call.url.indexOf('grant_type=password') >= 0) return authResponse(200, accountPayload());
    if (call.url.indexOf('/logout') >= 0) return authResponse(204, null);
    if (isProfilesCall(call)) {
      if (call.init.method === 'PATCH') {
        server.row = Object.assign({}, server.row, call.body);
        return authResponse(200, [server.row]);
      }
      return authResponse(200, [server.row]);
    }
    throw new Error('意外请求：' + call.url);
  });

  // 第一次：游客登录 → 改昵称/头像/偏好 → 保存
  const game1 = makeAccountGame(fetchStub);
  await game1._authReady;
  elt('btn-account').click();
  elt('login-email').value = ACCOUNT_USER.email;
  elt('login-password').value = 'secret123';
  elt('btn-login').click();
  await game1._authPromise;
  await settle(game1);
  elt('btn-settings').click();
  assert.strictEqual(elt('settings-nickname').value, '原始昵称');
  elt('settings-nickname').value = '存档昵称';
  game1._ui.avatarBtns['muse-4'].click();
  elt('btn-pref-touch').click(); // auto → on
  elt('btn-settings-save').click();
  await game1._accountPromise;
  await settle(game1);
  assert.strictEqual(server.row.nickname, '存档昵称');
  assert.strictEqual(server.row.avatar, 'muse-4');
  assert.deepStrictEqual(server.row.prefs, { sound: true, touch: 'on' });
  game1.destroy();

  // 第二次：重新载入页面（保留会话）→ 自动 GET，资料与云端一致
  const game2 = makeAccountGame(fetchStub, { keepStorage: true });
  await game2._authReady;
  await settle(game2);
  assert.strictEqual(game2.profile.nickname, '存档昵称', '重登后昵称一致');
  assert.strictEqual(game2.profile.avatar, 'muse-4', '重登后头像一致');
  assert.strictEqual(text('btn-account'), '☁ 账户 · 存档昵称');
  game2._openLoginScreen();
  elt('btn-settings').click();
  assert.strictEqual(elt('settings-nickname').value, '存档昵称');
  assert.ok(game2._ui.avatarBtns['muse-4'].classList.contains('is-selected'));
  assert.strictEqual(text('btn-pref-touch'), '📱 触屏按键：常开');
  game2.destroy();
});

/* ─────────────────── 10.5 战斗（Issue #18） ─────────────────── */

test('#18 战斗：占位关带敌人、HUD 显示 HP 与能量条、F 轻击命中', () => {
  withSfx((calls) => {
    const game = makeGame();
    elt('btn-start').click();
    assert.ok(game.combat, '进入关卡后创建 Combat');
    assert.strictEqual(game.combat.enemies.length, 3, '占位关 1 配置 3 只敌人');
    assert.strictEqual(text('hud-hp'), '♥ 10/10');
    assert.strictEqual(text('hud-energy-label'), '0%');
    assert.strictEqual(elt('hud-energy-fill').style.width, '0%');

    const enemy = game.combat.enemies[0];
    game.player.x = enemy.x - 16;
    game.player.y = enemy.y;
    game.combat.facing = { x: 0, y: 1 }; // 朝下，但敌人在右侧：应自动锁定
    press('f');
    tick(game);
    assert.strictEqual(enemy.hp, 2, '轻击造成 1 点伤害');
    assert.ok(game.combat.swing && game.combat.swing.dir.x > 0.9, '攻击方向锁定右侧敌人');
    assert.ok(Math.abs(game.combat.energy - 5) < 0.2, '命中 +5 能量（同帧含少量被动回复）');
    assert.strictEqual(text('hud-energy-label'), '5%');
    assert.strictEqual(elt('hud-energy-fill').style.width, '5%');
    assert.ok(calls.indexOf('light') >= 0, '轻击音效');
    assert.ok(calls.indexOf('hit') >= 0, '命中音效');
    assert.strictEqual(text('hud-hp'), '♥ 10/10');
    game.destroy();
  });
});

test('#18 能量炮：能量满 F/G 均可释放、射程 2.2 倍、清空能量并刷新 HUD', () => {
  withSfx((calls) => {
    const game = makeGame();
    elt('btn-start').click();
    const enemy = game.combat.enemies[0];
    game.player.x = enemy.x - 2 * engine.TILE; // 32px 外：普攻够不到，能量炮够得到
    game.player.y = enemy.y;
    game.combat.facing = { x: 0, y: 1 }; // 朝下，能量炮应锁定右侧敌人
    game.combat.energy = 100;
    game._refreshCombatHud(true);
    assert.strictEqual(text('hud-energy-label'), 'F/G');
    assert.ok(elt('hud-energy').classList.contains('ready'));
    assert.strictEqual(elt('hud-energy-fill').style.width, '100%');

    press('g');
    tick(game);
    assert.strictEqual(game.combat.swing ? game.combat.swing.kind : '', 'cannon', '按 G 释放能量炮');
    assert.ok(game.combat.swing && game.combat.swing.dir.x > 0.9, '能量炮方向锁定右侧敌人');
    assert.strictEqual(enemy.dead, true, '能量炮伤害可击败梦蚀团');
    assert.strictEqual(game.combat.energy, 0, '释放后能量清空');
    assert.strictEqual(text('hud-energy-label'), '0%');
    assert.ok(!elt('hud-energy').classList.contains('ready'));
    assert.ok(calls.indexOf('cannon') >= 0, '能量炮音效');
    assert.ok(calls.indexOf('enemy-down') >= 0, '击败音效');
    game.destroy();
  });
});

test('#18 受击与倒下：HP 扣减、无敌帧、倒下无惩罚复位、敌人重置', () => {
  const events = [];
  withSfx((calls) => {
    const game = makeGame({ onEvent: (name, data) => events.push([name, data]) });
    elt('btn-start').click();
    const enemy = game.combat.enemies[0];
    game.player.x = enemy.x;
    game.player.y = enemy.y;
    game.combat.invuln = 0;
    tick(game);
    assert.strictEqual(game.combat.hp, 9, '接触伤害 1 点');
    assert.strictEqual(text('hud-hp'), '♥ 9/10');
    assert.ok(game.combat.invuln > 0, '进入无敌帧');
    assert.ok(calls.indexOf('hurt') >= 0, '受击音效');
    const xAfterHit = game.player.x;

    game.combat.hp = 1;
    game.combat.invuln = 0;
    game.player.x = enemy.x;
    game.player.y = enemy.y;
    tick(game);
    assert.strictEqual(game.state, STATE.PLAYING, '倒下不进入结算/结局');
    assert.strictEqual(game.combat.hp, 10, '满血复活');
    assert.deepStrictEqual([game.player.x, game.player.y], [2 * 16, 26 * 16], '回到出生点');
    assert.strictEqual(game.combat.invuln, 1.2, '复活无敌帧');
    assert.strictEqual(enemy.x, enemy.spawnX, '敌人回出生点');
    assert.ok(calls.indexOf('player-down') >= 0, '倒下音效');
    const names = events.map((e) => e[0]);
    assert.ok(names.indexOf('player-hit') >= 0);
    assert.ok(names.indexOf('player-down') >= 0);
    assert.notStrictEqual(xAfterHit, game.player.x);
    game.destroy();
  });
});

test('#18 对话期间战斗冻结：能量不回复、敌人不追击、攻击键无效', () => {
  const game = makeGame();
  elt('btn-start').click();
  teleport(game, 10, 15); // NPC 旁
  tick(game);
  press('e');
  tick(game);
  assert.strictEqual(game.state, STATE.DIALOGUE);
  game.combat.energy = 40;
  const enemy = game.combat.enemies[0];
  const ex = enemy.x;
  press('f');
  for (let i = 0; i < 10; i++) tick(game, 50);
  assert.strictEqual(game.combat.energy, 40, '对话中能量不回复');
  assert.strictEqual(enemy.x, ex, '对话中敌人不移动');
  assert.strictEqual(game.combat.swing, null, '对话中 F 不触发攻击');
  game.destroy();
});

test('#18 index.html：HUD/能量条/触屏 B·C 与操作说明齐全', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  assert.ok(/id="hud-hp"/.test(html) && /id="hud-energy"/.test(html)
    && /id="hud-energy-fill"/.test(html) && /id="hud-energy-label"/.test(html), '战斗 HUD');
  assert.ok(/data-key="light"/.test(html) && /data-key="heavy"/.test(html), '触屏 B/C 键');
  assert.ok(/F 轻击/.test(html) && /G 重击/.test(html), '帮助说明 F/G');
  assert.ok(/2\.2 倍/.test(html), '帮助说明能量炮 2.2 倍射程');
});


/* #45 integration: real Auth/Cloud/SaveStore and UI, fetch stubs only. */
/** Create a game with isolated local storage and a stubbed save service. */
function cloudFixture() {
  localStorageStub.clear();
  seedAccount();
  const rows = [null, null, null];
  let offline = false;
  const fetch = authFetch(call => {
    if (isProfilesCall(call)) return profileResponse(call);
    if (call.url.includes('/auth/v1/logout')) return authResponse(204, null);
    if (!call.url.includes('/rest/v1/saves')) throw Error('Unexpected: ' + call.url);
    if (offline) throw Error('offline');
    const url = new URL(call.url);
    const n = Number((url.searchParams.get('slot') || 'eq.1').slice(3));
    if (call.init.method === 'GET') {
      return authResponse(200, url.searchParams.get('select').includes('data') ? (rows[n - 1] ? [rows[n - 1]] : []) : rows.filter(Boolean));
    }
    const previous = rows[n - 1];
    if (call.init.method === 'POST' && rows[(call.body.slot || 1) - 1]) return authResponse(409, {});
    if (call.init.method === 'PATCH' && (!previous || url.searchParams.get('version') !== 'eq.' + previous.version)) return authResponse(200, []);
    const index = call.init.method === 'POST' ? call.body.slot - 1 : n - 1;
    rows[index] = { slot: index + 1, version: call.body.version,
      updated_at: new Date(Date.now() + call.body.version).toISOString(), data: call.body.data };
    return authResponse(200, [rows[index]]);
  });
  const game = makeAccountGame(fetch, { enableCloud: true, keepStorage: true });
  return { game, rows, fetch, setOffline: value => { offline = value; } };
}
/** Wait for authentication, profile loading and initial cloud reconciliation. */
async function cloudReady(game) {
  await game._authReady; await settle(game);
  if (game._cloudTask) await game._cloudTask;
}
/** Start a game, finish its intro through real input handling and save locally. */
function saveOne(game) {
  game._startNewGame();
  while (game.state === STATE.DIALOGUE) advanceDialog(game);
  game._setState(STATE.PAUSED);
  assert.equal(game._saveAndQuit(), true);
}

testAsync('#45 游客零网络，登录后本机先保存；并入后成功上传', async () => {
  const f = cloudFixture(), game = f.game;
  await cloudReady(game);
  saveOne(game);
  await game._cloudTask;
  assert.ok(game.store.readSlot(0)); assert.equal(f.rows[0], null);
  assert.match(text('title-cloud-status'), /并入账户/);
  game._openSaveScreen('load');
  assert.ok(shown('cloud-merge'));
  elt('btn-cloud-merge').click(); await game._cloudTask;
  assert.ok(f.rows[0]); assert.equal(f.rows[0].data.updatedAt, undefined);
  assert.match(text('cloud-meta-1'), /已同步/);
  game.destroy();
});
testAsync('#45 云档不自动覆盖，逐档二次确认下载后可继续', async () => {
  const f = cloudFixture(), game = f.game;
  await cloudReady(game); saveOne(game); await game._cloudTask;
  const local = game.store.readSlot(0);
  f.rows[0] = { slot: 1, version: 4, updated_at: new Date(local.updatedAt + 1000).toISOString(),
    data: { ...local, sheep: 5 } };
  await game.cloud.refresh(); game._openSaveScreen('load');
  assert.equal(game.store.readSlot(0).sheep, 0);
  elt('btn-cloud-download-1').click();
  assert.match(text('btn-cloud-download-1'), /确认/);
  assert.equal(game.store.readSlot(0).sheep, 0);
  elt('btn-cloud-download-1').click(); await game._cloudTask;
  assert.equal(game.store.readSlot(0).sheep, 5);
  assert.equal(game.store.readSlot(0).updatedAt, Date.parse(f.rows[0].updated_at));
  elt('btn-slot-1').click(); assert.equal(game.sheepCount, 5);
  game.destroy();
});
testAsync('#45 保存并退出在断网时立即成功；下次登录补传', async () => {
  const f = cloudFixture(), game = f.game;
  await cloudReady(game); saveOne(game); await game._cloudTask;
  await game.cloud.decide('merge');
  f.setOffline(true);
  game._continueGame(); game.sheepCount = 3; game._setState(STATE.PAUSED);
  assert.equal(game._saveAndQuit(), true);
  assert.equal(game.state, STATE.TITLE);
  assert.equal(game.store.readSlot(0).sheep, 3);
  await game._cloudTask;
  assert.match(text('title-cloud-status'), /未同步/);
  game.destroy(); f.setOffline(false);
  const again = makeAccountGame(f.fetch, { enableCloud: true, keepStorage: true });
  await cloudReady(again);
  assert.equal(f.rows[0].data.sheep, 3);
  assert.equal(again.cloud.state(0), 'synced'); again.destroy();
});
testAsync('#45 显式上传也用版本锁：远端变更后冲突刷新、不覆盖', async () => {
  const f = cloudFixture(), game = f.game;
  await cloudReady(game); saveOne(game); await game._cloudTask;
  await game.cloud.decide('merge'); game._openSaveScreen('load');
  elt('btn-cloud-upload-1').click();
  f.rows[0].version = 8; // changed on another device after metadata was displayed
  elt('btn-cloud-upload-1').click(); await game._cloudTask;
  assert.equal(f.rows[0].version, 8);
  assert.match(text('cloud-status'), /云端进度已变化/);
  assert.equal(game.cloud.remote[0].version, 8);
  game.destroy();
});
testAsync('#45 上传确认绑定本机快照，刷新及退出取消确认', async () => {
  const f = cloudFixture(), game = f.game;
  await cloudReady(game); saveOne(game); await game._cloudTask;
  game._openSaveScreen('load');
  elt('btn-slot-del-1').click();
  assert.equal(game._pendingDelete, 0);
  elt('btn-cloud-upload-1').click();
  assert.equal(game._pendingDelete, -1, '云同步操作取消之前的删除确认');
  const local = game.store.readSlot(0); local.updatedAt++;
  game.store.writeSlot(0, local);
  elt('btn-cloud-upload-1').click();
  assert.equal(f.rows[0], null); // changed snapshot needs a new confirmation
  game._closeSaveScreen(); game._openSaveScreen('load');
  assert.equal(game._cloudConfirm, null);
  game.destroy();
});
testAsync('#45 删除仅清本地和基线，云备份仍可手动恢复', async () => {
  const f = cloudFixture(), game = f.game;
  await cloudReady(game); saveOne(game); await game._cloudTask;
  await game.cloud.decide('merge'); game._openSaveScreen('load');
  elt('btn-slot-del-1').click(); elt('btn-slot-del-1').click();
  assert.equal(game.store.readSlot(0), null); assert.ok(f.rows[0]);
  assert.equal(game.cloud.record.slots[0], null);
  elt('btn-cloud-download-1').click(); elt('btn-cloud-download-1').click(); await game._cloudTask;
  assert.ok(game.store.readSlot(0)); game.destroy();
});


testAsync('#45 读取云档失败时禁止并入/跳过，重试仍可用且本地游玩不阻塞', async () => {
  const f = cloudFixture(), game = f.game;
  await cloudReady(game); saveOne(game); await game._cloudTask;
  f.setOffline(true); await game.cloud.refresh(); game._openSaveScreen('load');
  assert.equal(game.cloud.loaded, false);
  assert.ok(shown('cloud-merge'));
  assert.equal(elt('btn-cloud-merge').disabled, true);
  assert.equal(elt('btn-cloud-skip').disabled, true);
  assert.equal(elt('btn-cloud-retry').disabled, false);
  assert.equal(elt('btn-start').disabled, false);
  assert.equal(game.cloud.record.decision, '');
  f.setOffline(false); elt('btn-cloud-retry').click(); await game._cloudTask;
  assert.equal(elt('btn-cloud-merge').disabled, false);
  elt('btn-cloud-merge').click(); await game._cloudTask;
  assert.ok(f.rows[0]); game.destroy();
});
testAsync('#45 保存助手处理开场对话，直到打字机和翻页结束', async () => {
  const f = cloudFixture(), game = f.game;
  await cloudReady(game);
  game.dialogue['test.cloud-intro'] = { type: 'cutscene', trigger: 'load:1', scopeId: 1,
    entry: true, once: true, lines: [{ s: 'nar', t: '进入梦境。' }, { s: 'byeori', t: '开始冒险。' }] };
  saveOne(game);
  await game._cloudTask;
  assert.equal(game.state, STATE.TITLE); assert.ok(game.store.readSlot(0));
  assert.ok(game.store.readSlot(0).played.includes('test.cloud-intro'));
  delete game.dialogue['test.cloud-intro']; game.destroy();
});


/* ─────────────────── #46 统计接线 ─────────────────── */
test('#46 时长只随 runTime 累计，标题/暂停/对话/隐藏页面不计时', () => {
  const game = makeGame({ enableStats: true });
  game._update(1); assert.equal(game.stats.record.seconds, 0);
  game._startNewGame();
  while (game.state === STATE.DIALOGUE) advanceDialog(game);
  for (let i = 0; i < 25; i++) game._update(0.04);
  assert.ok(Math.abs(game.stats.record.seconds - game.runTime) < 1e-8);
  const time = game.stats.record.seconds;
  game._setState(STATE.PAUSED); game._update(5);
  game._setState(STATE.DIALOGUE); game._update(5);
  game._setState(STATE.PLAYING); documentStub.hidden = true; game._update(5);
  documentStub.hidden = false;
  assert.equal(game.stats.record.seconds, time);
  game.destroy();
});
test('#46 拾星/全收集/通关成就接线；退出不保存也保留统计', () => {
  const game = makeGame({ enableStats: true }); game._startNewGame();
  while (game.state === STATE.DIALOGUE) advanceDialog(game);
  collectAll(game);
  assert.ok(game.stats.view().achievements.includes('first_star'));
  assert.ok(game.stats.view().achievements.includes('wish_keeper'));
  game._onLevelClear();
  assert.ok(game.stats.view().achievements.includes('first_clear'));
  assert.ok(!game.stats.view().achievements.includes('journey_complete'), '占位地图不解锁终章');
  game._setState(STATE.PLAYING); game._update(1.25); game._setState(STATE.PAUSED);
  game._quitToTitle(); game._openSettingsScreen();
  assert.match(text('stats-time'), /1 秒/); assert.match(text('stats-status'), /游客/);
  assert.match(text('stats-collection'), /3\/3（100%）/);
  assert.match(text('stats-achievements'), /★ 初见星光/);
  game.destroy();
});
test('#46 pagehide 保存小数；跨标签页切号撤销统计，destroy 解绑监听', () => {
  const game = makeGame({ enableStats: true, auth: { session: { user: { id: 'A' } } }, profile: null });
  game.stats.tick(0.375); fireWindow('pagehide', {});
  assert.equal(game.stats.dirty, false);
  const before = (windowListeners.storage || []).length;
  fireWindow('storage', { key: main.ACCOUNT_KEY, newValue: JSON.stringify({ user: { id: 'B' } }) });
  assert.equal(game.stats.suspended, true);
  game.destroy(); assert.equal((windowListeners.storage || []).length, before - 1);
});
testAsync('#46 保存先完成云存档同步，再刷新账户收集率；离线不阻塞回标题', async () => {
  const order = [];
  const auth = { session: { user: { id: 'A' } } };
  const cloud = { uid: 'A', busy: [false, false, false], loaded: false, loading: false,
    remote: [null, null, null], record: { pending: [], decision: '' },
    state: () => 'unsynced', save: async () => { await Promise.resolve(); order.push('save'); }, destroy() {} };
  const stats = new sandbox.MIXX.stats.StatsTracker({ storage: localStorageStub,
    client: { merge: async (uid, record) => { order.push('stats'); return {
      user_id: uid, play_seconds: 0, remainder_ms: 0, device_millis: {}, achievements: [], collections: {},
    }; } } });
  const game = makeGame({ auth, cloud, profile: null, stats });
  await stats.connect('A'); order.length = 0;
  saveOne(game); await game._statsTask; await stats.task;
  assert.equal(game.state, STATE.TITLE); assert.ok(game.store.readSlot(0));
  assert.ok(order.lastIndexOf('stats') > order.indexOf('save'));
  stats.client.merge = async () => { throw Error('offline'); };
  saveOne(game); await game._statsTask; await stats.task;
  assert.equal(game.state, STATE.TITLE); assert.ok(stats.error);
  game.destroy();
});

/* ─────────────────── 汇总 ─────────────────── */

function report() {
  console.log('');
  if (failures.length) {
    console.error('失败 ' + failures.length + ' 项 / 共 ' + (passed + failures.length) + ' 项');
    process.exit(1);
  }
  console.log('全部通过：' + passed + ' 项');
}

if (asyncTests.length) {
  (async function runAsyncTests() {
    for (const t of asyncTests) {
      try {
        await t.fn();
        passed++;
        console.log('  \u2713 ' + t.name);
      } catch (e) {
        failures.push({ name: t.name, e });
        console.error('  \u2717 ' + t.name + '\n      ' + (e && e.message));
      }
    }
    report();
  })().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
} else {
  report();
}
