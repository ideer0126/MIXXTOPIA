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
 *   3. HUD：关名与星数「★ x/y」随收集与换关刷新
 *   4. 无泄漏：单输入实例、单游戏循环、离开状态清空 DOM、重开新局零残留、
 *      关卡数据只读（重玩不残留收集标记）
 *   5. 状态守卫：错误状态下的按钮/按键不生效；destroy 后全部解绑
 *   6. index.html 存量文案更正（无「玻璃碎片」）与选关按钮暂隐
 *   7. 对话系统（Issue #7）：打字机 25ms/字、按住加速、点按快进、E/空格/Enter/点击
 *      翻页、旁白姓名框隐藏、对话期间玩家锁定与计时暂停、提示文案切换
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
  'hud', 'hud-level', 'hud-shards',
  'title-screen', 'btn-start', 'btn-continue', 'btn-levels', 'btn-help', 'btn-sound',
  'level-screen', 'level-grid', 'btn-back',
  'help-screen', 'btn-help-back',
  'dialog', 'dialog-backdrop', 'dialog-portrait', 'dialog-name', 'dialog-text', 'dialog-hint', 'dialog-options',
  'pause-screen', 'btn-resume', 'btn-restart', 'btn-quit',
  'clear-screen', 'clear-text', 'btn-next',
  'ending-screen', 'ending-body', 'btn-ending',
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
  'help-screen', 'level-screen', 'pause-screen', 'clear-screen', 'ending-screen',
  'dialog', 'dialog-backdrop', 'hud', 'btn-continue', 'btn-levels',
]) {
  registry.get(id).classList.add('hidden');
}
registry.get('btn-sound').textContent = '♪ 声音：开';
registry.get('btn-next').textContent = '▶ 下一关';
registry.get('dialog-hint').textContent = '▼ E / 空格';

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

let rafCount = 0;
let rafSeq = 0;
const sandbox = {
  console,
  document: documentStub,
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
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/engine.js'), 'utf8'), sandbox, { filename: 'js/engine.js' });
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8'), sandbox, { filename: 'js/main.js' });

const main = sandbox.MIXX.main;
const STATE = main.STATE;
const engine = sandbox.MIXX.engine;

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

/** 新建游戏实例（不自动 start，测试手动驱动帧） */
function makeGame(opts) {
  return new main.Game(registry.get('game'), opts || {});
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

test('占位关卡：2 关、实体齐全（spawn/star/npc/portal）', () => {
  const levels = main.buildBootLevels();
  assert.strictEqual(levels.length, 2);
  for (const lv of levels) {
    assert.ok(lv.map && lv.map.rows.length > 0);
    assert.strictEqual(lv.entities.filter((e) => e.type === 'spawn').length, 1);
    assert.strictEqual(lv.entities.filter((e) => e.type === 'portal').length, 1);
    assert.ok(lv.entities.filter((e) => e.type === 'star').length >= 1);
    assert.ok(lv.entities.filter((e) => e.type === 'npc').length >= 1);
  }
});

/* ─────────────────── 2. 初始标题态 ─────────────────── */

test('初始进入标题：屏幕显隐正确、输入禁用、虚拟按键隐藏', () => {
  const game = makeGame();
  assert.strictEqual(game.state, STATE.TITLE);
  assert.ok(shown('title-screen'));
  assert.ok(hidden('help-screen') && hidden('pause-screen') && hidden('clear-screen') && hidden('ending-screen'));
  assert.ok(hidden('dialog'));
  assert.ok(hidden('hud'));
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

test('index.html：无「玻璃碎片」遗留文案、选关按钮暂隐（#10 开放）', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  assert.ok(!/玻璃碎片/.test(html), '帮助界面不得再出现「玻璃碎片」');
  assert.ok(/愿望之星/.test(html));
  assert.ok(/id="btn-levels" class="menu-btn hidden"/.test(html), '选关按钮在 #10 前隐藏');
  assert.ok(/id="hud-level"/.test(html) && /id="hud-shards"/.test(html), 'HUD 元素齐全');
});

/* ─────────────────── 汇总 ─────────────────── */

console.log('');
if (failures.length) {
  console.error('失败 ' + failures.length + ' 项 / 共 ' + (passed + failures.length) + ' 项');
  process.exit(1);
}
console.log('全部通过：' + passed + ' 项');
