#!/usr/bin/env node
/**
 * tools/test-engine.js —— js/engine.js 渲染管线验证（Issue #4/#5 验收辅助）
 *
 * 零依赖：Node 内置 assert + 极简 Canvas 2D 桩。
 * 运行：node tools/test-engine.js
 *
 * 覆盖：
 *   1. 常量与公开 API
 *   2. 瓦片图集缓存（同 key 复用 / 异 key 重建 / 索引正确）
 *   3. 调色板换色（模板槽色 → 关卡调色板，透明与固定色保留）
 *   4. 摄像机边界钳制与小地图居中
 *   5. 静态地图渲染像素级断言（背景 / 墙 / 地 / 水）
 *   6. 整数倍放大计算与 imageSmoothingEnabled 关闭
 *   7. 未知地形符号不崩溃
 *   8. 输入系统（Issue #5）：键盘绑定/边沿/轴向量、触屏虚拟按键、粗指针检测、开关与销毁
 *   9. §11 数据校验（空地图和预留机制搜索单独报告待完成，不视为完整验收通过）
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { validateProject, formatIssue } = require('./validate.js');

/* ─────────────────── Canvas 2D 极简桩 ─────────────────── */

const RGB_RE = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/;

class FakeCanvas {
  constructor(width = 300, height = 150) {
    this._w = width;
    this._h = height;
    this.style = {};
    this.ctx = new FakeContext(this);
  }
  // 引擎会改写 canvas.width/height（320×224），像素缓冲随之重分配
  get width() {
    return this._w;
  }
  set width(v) {
    this._w = v;
    this.ctx._realloc();
  }
  get height() {
    return this._h;
  }
  set height(v) {
    this._h = v;
    this.ctx._realloc();
  }
  getContext(type) {
    if (type !== '2d') throw new Error('FakeCanvas 仅支持 2d 上下文');
    return this.ctx;
  }
}

class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.imageSmoothingEnabled = true;
    this.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    this.fillStyle = '#000000';
    this._tx = 0;
    this._ty = 0;
    this._stack = [];
  }
  _realloc() {
    this.pixels = new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4);
  }
  save() {
    this._stack.push([this._tx, this._ty, this.fillStyle]);
  }
  restore() {
    if (this._stack.length) [this._tx, this._ty, this.fillStyle] = this._stack.pop();
  }
  translate(x, y) {
    this._tx += x;
    this._ty += y;
  }
  createImageData(w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  getImageData(x, y, w, h) {
    const out = this.createImageData(w, h);
    const cw = this.canvas.width;
    for (let row = 0; row < h; row++) {
      const src = (y + row) * cw + x;
      out.data.set(this.pixels.subarray(src * 4, (src + w) * 4), row * w * 4);
    }
    return out;
  }
  putImageData(img, x = 0, y = 0) {
    const cw = this.canvas.width;
    for (let row = 0; row < img.height; row++) {
      const dst = ((y + row) * cw + x) * 4;
      this.pixels.set(img.data.subarray(row * img.width * 4, (row + 1) * img.width * 4), dst);
    }
  }
  fillRect(x, y, w, h) {
    const m = RGB_RE.exec(String(this.fillStyle));
    if (!m) return; // 非 rgb() 格式桩内忽略（演示 HUD 的 rgba 等仅浏览器使用）
    const c = [Number(m[1]), Number(m[2]), Number(m[3])];
    const x0 = Math.max(0, Math.floor(x + this._tx));
    const y0 = Math.max(0, Math.floor(y + this._ty));
    const x1 = Math.min(this.canvas.width, Math.ceil(x0 + w));
    const y1 = Math.min(this.canvas.height, Math.ceil(y0 + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = (py * this.canvas.width + px) * 4;
        this.pixels[i] = c[0];
        this.pixels[i + 1] = c[1];
        this.pixels[i + 2] = c[2];
        this.pixels[i + 3] = 255;
      }
    }
  }
  // 支持 (img, dx, dy) 与 (img, sx, sy, sw, sh, dx, dy, dw, dh)
  drawImage(src, ...args) {
    let sx = 0, sy = 0, sw = src.width, sh = src.height, dx, dy, dw = sw, dh = sh;
    if (args.length === 2) {
      [dx, dy] = args;
    } else if (args.length === 8) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    } else {
      throw new Error('drawImage 参数形式不支持：' + args.length);
    }
    const s = src.ctx.pixels;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    for (let py = 0; py < dh; py++) {
      for (let px = 0; px < dw; px++) {
        const sx2 = sx + Math.min(sw - 1, Math.floor((px * sw) / dw));
        const sy2 = sy + Math.min(sh - 1, Math.floor((py * sh) / dh));
        const si = (sy2 * src.width + sx2) * 4;
        const tx = dx + px + this._tx;
        const ty = dy + py + this._ty;
        if (tx < 0 || ty < 0 || tx >= cw || ty >= ch) continue;
        const di = (ty * cw + tx) * 4;
        this.pixels[di] = s[si];
        this.pixels[di + 1] = s[si + 1];
        this.pixels[di + 2] = s[si + 2];
        this.pixels[di + 3] = s[si + 3];
      }
    }
  }
}

/* ─────────────────── 环境桩 ─────────────────── */

global.document = {
  createElement(tag) {
    return tag === 'canvas' ? new FakeCanvas() : null;
  },
  getElementById: () => null,
  querySelectorAll: () => [],
  readyState: 'complete',
  addEventListener: () => {},
};
global.innerWidth = 1280;
global.innerHeight = 720;
// 事件注册表：供输入系统测试派发 window 事件（渲染器等仅注册不触发，行为不变）
const windowListeners = {};
global.addEventListener = (type, fn) => {
  (windowListeners[type] || (windowListeners[type] = [])).push(fn);
};
global.removeEventListener = (type, fn) => {
  const list = windowListeners[type];
  if (!list) return;
  const i = list.indexOf(fn);
  if (i >= 0) list.splice(i, 1);
};
/** 派发 window 事件（keydown/keyup/blur 等）给全部已注册监听器 */
function fireWindow(type, ev) {
  for (const fn of (windowListeners[type] || []).slice()) fn(ev);
}
// pointer 媒体查询桩：测试通过 matchMediaStates 控制匹配结果
const matchMediaStates = new Map();
global.matchMedia = (query) => ({ matches: !!matchMediaStates.get(query), media: query });
const _warn = console.warn;
console.warn = () => {}; // 测试期间静音引擎告警

/* ─────────────────── 加载引擎 ─────────────────── */

require('../js/engine.js');
const engine = globalThis.MIXX.engine;

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
function px(canvas, x, y) {
  return Array.from(canvas.ctx.getImageData(x, y, 1, 1).data);
}

/* ─────────────────── 1. 常量与 API ─────────────────── */

test('常量与公开 API：320×224 逻辑分辨率 / 16px 瓦片 / 20×14 视口', () => {
  assert.ok(engine, 'MIXX.engine 未暴露');
  assert.strictEqual(engine.TILE, 16);
  assert.strictEqual(engine.VIEW_W, 320);
  assert.strictEqual(engine.VIEW_H, 224);
  assert.strictEqual(engine.VIEW_COLS, 20);
  assert.strictEqual(engine.VIEW_ROWS, 14);
  assert.strictEqual(typeof engine.createRenderer, 'function');
  assert.strictEqual(typeof engine.createCamera, 'function');
  assert.strictEqual(typeof engine.registerTileset, 'function');
  assert.strictEqual(typeof engine.resolvePalette, 'function');
  assert.strictEqual(typeof engine.gridToCanvas, 'function');
  assert.strictEqual(typeof engine.remapCanvas, 'function');
});

test('内置瓦片网格格式：16×16、字符 ∈ {. 0 1 2 3}', () => {
  const tiles = engine._tilesets.builtin;
  assert.deepStrictEqual(Object.keys(tiles), ['wall', 'floor', 'water']);
  for (const type of Object.keys(tiles)) {
    const grid = tiles[type];
    assert.strictEqual(grid.length, 16, type + ' 行数');
    for (const row of grid) {
      assert.strictEqual(row.length, 16, type + ' 行宽');
      assert.ok(/^[.0123]{16}$/.test(row), type + ' 非法字符: ' + row);
    }
  }
});

test('页面脚本顺序：sprites.js 执行时引擎已可注册瓦片', () => {
  const repoRoot = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const sandbox = vm.createContext({});
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, src), 'utf8'), sandbox, { filename: src });
    if (src === 'js/sprites.js') {
      vm.runInContext("MIXX.engine.registerTileset('sprites-test', { floor: ['1'] })", sandbox);
    }
  }
  assert.strictEqual(sandbox.MIXX.engine._tilesets['sprites-test'].floor[0], '1');
});

/* ─────────────────── 2. 瓦片图集缓存 ─────────────────── */

test('图集缓存：同「瓦片集+调色板」复用同一图集，异调色板重建', () => {
  const renderer = engine.createRenderer(new FakeCanvas());
  const pA = engine.resolvePalette({ bg: '#1A1033', cream: '#F7E8C8', gold: '#FFC857', pink: '#FF8FA3' });
  const pB = engine.resolvePalette({ bg: '#0E1420', cream: '#F7E8C8', gold: '#FF7A00', pink: '#FFD166' });
  const a1 = renderer.getTileAtlas('builtin', pA);
  const a2 = renderer.getTileAtlas('builtin', pA);
  assert.strictEqual(a1, a2, '相同 key 应命中缓存');
  const a3 = renderer.getTileAtlas('builtin', pB);
  assert.notStrictEqual(a1, a3, '不同调色板应重建图集');
  assert.deepStrictEqual(a1.index, { wall: 0, floor: 1, water: 2 });
  assert.strictEqual(a1.sheet.width, 16 * 3);
  assert.strictEqual(a1.sheet.height, 16);
});

test('合并瓦片后刷新所有渲染器和调色板的缓存，保留未覆盖瓦片', () => {
  const renderers = [engine.createRenderer(new FakeCanvas()), engine.createRenderer(new FakeCanvas())];
  const palettes = [engine.resolvePalette(), engine.resolvePalette({ gold: '#123456' })];
  engine.registerTileset('cache-test', { floor: ['1'], wall: ['0'] });
  const originals = renderers.map(renderer => palettes.map(palette => renderer.getTileAtlas('cache-test', palette)));
  const builtin = renderers[0].getTileAtlas('builtin', palettes[0]);

  engine.registerTileset('cache-test', { floor: ['2'], water: ['3'] });
  renderers.forEach((renderer, r) => palettes.forEach((palette, p) => {
    const atlas = renderer.getTileAtlas('cache-test', palette);
    assert.notStrictEqual(atlas, originals[r][p]);
    assert.deepStrictEqual(atlas.index, { floor: 0, wall: 1, water: 2 });
    assert.deepStrictEqual(px(atlas.sheet, 0, 0), [...palette.slots[2], 255]);
    assert.deepStrictEqual(px(atlas.sheet, 16, 0), [...palette.slots[0], 255]);
    assert.deepStrictEqual(px(atlas.sheet, 32, 0), [...palette.slots[3], 255]);
    assert.strictEqual(renderer.getTileAtlas('cache-test', palette), atlas);
  }));
  assert.strictEqual(renderers[0].getTileAtlas('builtin', palettes[0]), builtin);
});

test('缺失瓦片集复用 builtin；随后注册时不得复用兜底图集或模板', () => {
  const renderer = engine.createRenderer(new FakeCanvas());
  const palette = engine.resolvePalette();
  const fallback = renderer.getTileAtlas('late-test', palette);
  assert.strictEqual(fallback, renderer.getTileAtlas('builtin', palette));
  engine.registerTileset('late-test', { wall: ['2'] });
  const atlas = renderer.getTileAtlas('late-test', palette);
  assert.notStrictEqual(atlas, fallback);
  assert.deepStrictEqual(atlas.index, { wall: 0 });
  assert.deepStrictEqual(px(atlas.sheet, 0, 0), [...palette.slots[2], 255]);
});

/* ─────────────────── 3. 调色板换色 ─────────────────── */

test('调色板换色：模板槽色逐像素替换、透明像素保留、固定色穿透', () => {
  const slots = [[10, 10, 10], [20, 20, 20], [30, 30, 30], [40, 40, 40]];
  const src = engine.gridToCanvas(
    ['.1', '0.'],
    [[255, 0, 255], [0, 255, 255], [255, 255, 0], [255, 128, 0]]
  );
  // 透明像素在换色后仍为透明
  assert.deepStrictEqual(px(src, 0, 0), [0, 0, 0, 0]);
  const out = engine.remapCanvas(src, slots);
  assert.deepStrictEqual(px(out, 1, 0), [20, 20, 20, 255], '槽 1 换色');
  assert.deepStrictEqual(px(out, 0, 1), [10, 10, 10, 255], '槽 0 换色');
  assert.deepStrictEqual(px(out, 0, 0), [0, 0, 0, 0], '透明保留');
});

test('图集换色落盘：整幅图集无残留模板色，槽色与调色板一致', () => {
  const renderer = engine.createRenderer(new FakeCanvas());
  const pal = engine.resolvePalette({ bg: '#1A1033', cream: '#F7E8C8', gold: '#FFC857', pink: '#FF8FA3' });
  const atlas = renderer.getTileAtlas('builtin', pal);
  const img = atlas.sheet.ctx.getImageData(0, 0, atlas.sheet.width, atlas.sheet.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
    for (const tpl of [[255, 0, 255], [0, 255, 255], [255, 255, 0], [255, 128, 0]]) {
      assert.notStrictEqual(key, tpl.join(','), '图集不应残留模板色 ' + tpl.join(','));
    }
  }
  // 墙(0,0)=槽0 压暗 bg；地(16+3,0)=槽1 cream；水(32,0)=槽3 pink
  assert.deepStrictEqual(px(atlas.sheet, 0, 0), [...engine.color.shade('#1A1033', 0.55), 255]);
  assert.deepStrictEqual(px(atlas.sheet, 19, 0), [247, 232, 200, 255]);
  assert.deepStrictEqual(px(atlas.sheet, 32, 0), [255, 143, 163, 255]);
});

/* ─────────────────── 4. 摄像机 ─────────────────── */

test('摄像机：跟随 + 地图边界钳制', () => {
  const cam = engine.createCamera();
  cam.follow(8, 8, 640, 448); // 左上角
  assert.deepStrictEqual([cam.x, cam.y], [0, 0]);
  cam.follow(600, 400, 640, 448); // 右下角 → 钳制在 (320, 224)
  assert.deepStrictEqual([cam.x, cam.y], [320, 224]);
  cam.follow(320, 200, 640, 448); // 地图内目标 → 视口对准目标中心
  assert.deepStrictEqual([cam.x, cam.y], [160, 88]);
});

test('摄像机：地图等于/小于视口时居中', () => {
  const cam = engine.createCamera();
  cam.follow(8, 8, 320, 224); // 等大 → (0,0)
  assert.deepStrictEqual([cam.x, cam.y], [0, 0]);
  cam.follow(8, 8, 256, 192); // 16×12 瓦片 → 负偏移居中
  assert.deepStrictEqual([cam.x, cam.y], [-32, -16]);
});

/* ─────────────────── 5. 静态地图渲染 ─────────────────── */

function smallLevel() {
  const w = 16;
  const h = 12;
  const rows = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      row += (x === 0 || x === w - 1 || y === 0 || y === h - 1) ? '#'
        : (x === 3 && y === 3) ? '~' : '·';
    }
    rows.push(row);
  }
  return {
    map: { w, h, rows, legend: { '#': 'wall', '·': 'floor', '~': 'water' } },
    palette: { bg: '#1A1033', cream: '#F7E8C8', gold: '#FFC857', pink: '#FF8FA3' },
  };
}

test('静态地图渲染：背景 / 墙 / 地 / 水像素级正确，视口外区域为背景色', () => {
  const canvas = new FakeCanvas();
  const renderer = engine.createRenderer(canvas);
  const cam = engine.createCamera();
  cam.follow(8, 8, 256, 192); // 小地图居中 → 相机 (-32,-16)，地图左上角画在 (32,16)
  renderer.renderLevel(smallLevel(), cam);
  const bg = engine.color.hexToRgb('#1A1033');
  const dark = engine.color.shade('#1A1033', 0.55);
  assert.deepStrictEqual(px(canvas, 0, 0), [...bg, 255], '地图外为背景色');
  assert.deepStrictEqual(px(canvas, 32, 16), [...dark, 255], '墙 = 槽0 压暗 bg');
  assert.deepStrictEqual(px(canvas, 32 + 16 + 1, 16 + 16 + 1), [247, 232, 200, 255], '地 = cream');
  assert.deepStrictEqual(px(canvas, 32 + 3 * 16, 16 + 3 * 16), [255, 143, 163, 255], '水 = pink');
});

test('大图渲染：摄像机平移后瓦片取源正确（图集索引 → 屏幕坐标）', () => {
  const canvas = new FakeCanvas();
  const renderer = engine.createRenderer(canvas);
  const cam = engine.createCamera();
  cam.follow(600, 400, 640, 448); // 相机 (320,224)：只画地图右下角
  renderer.renderLevel({
    map: { w: 40, h: 28, rows: engine.demoLevel.map.rows, legend: { '#': 'wall', '·': 'floor', '~': 'water' } },
    palette: engine.demoLevel.palette,
  }, cam);
  // 世界 (39,27) 是右下角墙 → 屏幕 (39*16-320, 27*16-224) = (304,208)
  assert.deepStrictEqual(px(canvas, 304, 208), [...engine.color.shade('#1A1033', 0.55), 255]);
  // 世界 (38,26) 是地板（湖与岛之外）→ 屏幕 (288,192)，取瓦片内 (1,1) 纯色点
  const ch = engine.demoLevel.map.rows[26][38];
  assert.strictEqual(ch, '·');
  assert.deepStrictEqual(px(canvas, 289, 193), [247, 232, 200, 255]);
});

test('未知地形符号与缺失行不崩溃', () => {
  const canvas = new FakeCanvas();
  const renderer = engine.createRenderer(canvas);
  const cam = engine.createCamera();
  const rows = ['#X', '·#']; // X 未注册；rows 比 h 短
  renderer.renderLevel(
    { map: { w: 2, h: 4, rows, legend: { '#': 'wall', '·': 'floor' } }, palette: null },
    cam
  );
  // 不抛异常即通过
  assert.ok(true);
});

/* ─────────────────── 6. 整数倍放大 ─────────────────── */

test('整数倍放大：1280×720 窗口 → k=3；640 宽 → k=1；无拉伸模糊', () => {
  const renderer = engine.createRenderer(new FakeCanvas());
  assert.strictEqual(renderer.ctx.imageSmoothingEnabled, false, '图像平滑必须关闭');
  assert.strictEqual(renderer.scale, 3);
  assert.strictEqual(renderer.canvas.style.width, '960px');
  assert.strictEqual(renderer.canvas.style.height, '672px');
  global.innerWidth = 640;
  renderer.resize();
  assert.strictEqual(renderer.scale, 1);
  assert.strictEqual(renderer.canvas.style.width, '320px');
  assert.strictEqual(renderer.canvas.style.imageRendering, 'pixelated');
  global.innerWidth = 1280;
});

test('设备像素整数缩放：高密度、分数 DPR、非法 DPR 与小窗口兜底', () => {
  const saved = { width: global.innerWidth, height: global.innerHeight, dpr: global.devicePixelRatio };
  try {
    const canvas = new FakeCanvas();
    const stage = { id: 'stage', style: {} };
    canvas.parentElement = stage;
    const renderer = engine.createRenderer(canvas);
    assert.strictEqual(stage.style.width, canvas.style.width, '初始舞台宽度跟随画布');
    for (const [dpr, scale] of [[1, 3], [1.25, 3], [1.5, 4], [2, 6], [0.75, 2]]) {
      global.devicePixelRatio = dpr;
      assert.strictEqual(renderer.resize(), scale);
      assert.strictEqual(renderer.scale, scale);
      assert.strictEqual(canvas.style.width, 320 * scale / dpr + 'px');
      assert.strictEqual(canvas.style.height, 224 * scale / dpr + 'px');
      assert.strictEqual(stage.style.width, canvas.style.width, 'DPR 改变后舞台宽度跟随画布');
      assert.strictEqual(canvas.width, 320);
      assert.strictEqual(canvas.height, 224);
      assert.strictEqual(canvas.style.imageRendering, 'pixelated');
      assert.strictEqual(renderer.ctx.imageSmoothingEnabled, false);
    }
    for (const dpr of [undefined, 0, -1, NaN, Infinity]) {
      global.devicePixelRatio = dpr;
      assert.strictEqual(renderer.resize(), 3);
      assert.strictEqual(canvas.style.width, '960px');
      assert.strictEqual(canvas.style.height, '672px');
      assert.strictEqual(stage.style.width, canvas.style.width);
    }
    global.devicePixelRatio = 2;
    for (const size of [10, undefined]) {
      global.innerWidth = global.innerHeight = size;
      assert.strictEqual(renderer.resize(), 1);
      assert.strictEqual(canvas.style.width, '160px');
      assert.strictEqual(canvas.style.height, '112px');
      assert.strictEqual(stage.style.width, canvas.style.width);
    }
    renderer.destroy();
  } finally {
    global.innerWidth = saved.width;
    global.innerHeight = saved.height;
    if (saved.dpr === undefined) delete global.devicePixelRatio;
    else global.devicePixelRatio = saved.dpr;
  }
});

/* ─────────────────── §11 数据校验 ─────────────────── */

test('§11 数据：现有数据无错误，未落地检查明确报告待完成', () => {
  const result = validateProject();
  assert.strictEqual(result.errors.length, 0, result.errors.map(formatIssue).join('\n'));
  for (const item of result.pending) console.log('    待完成 ' + formatIssue(item));
});

/* ─────────────────── 7. 输入系统（Issue #5） ─────────────────── */

/** 极简按钮桩：模拟 #touch-controls 里带 data-key 的虚拟按键 */
function fakeButton(key) {
  const listeners = {};
  const classes = new Set();
  return {
    dataset: { key },
    getAttribute: (name) => (name === 'data-key' ? key : null),
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, v) => (v ? classes.add(c) : classes.delete(c)),
    },
    addEventListener: (type, fn) => { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener: (type, fn) => {
      const l = listeners[type];
      if (!l) return;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    setPointerCapture: () => {},
    _fire: (type, ev) => { for (const fn of (listeners[type] || []).slice()) fn(ev || {}); },
  };
}

/** 构造带 preventDefault 的键盘事件桩，extra 可补充 repeat/ctrlKey 等属性 */
function keyEvent(key, extra) {
  return Object.assign({ key, preventDefault() {} }, extra || {});
}

test('输入 API：createInput 暴露、初始状态、动作常量', () => {
  assert.strictEqual(typeof engine.createInput, 'function');
  assert.strictEqual(typeof engine.detectCoarsePointer, 'function');
  const input = engine.createInput();
  assert.strictEqual(input.enabled, true);
  assert.strictEqual(input.coarse, false);
  assert.deepStrictEqual(input.getAxis(), { x: 0, y: 0 });
  assert.strictEqual(input.isDown('up'), false);
  assert.strictEqual(input.wasPressed('confirm'), false);
  assert.strictEqual(input.wasReleased('mute'), false);
  assert.deepStrictEqual(Object.keys(engine.KEY_BINDINGS),
    ['up', 'down', 'left', 'right', 'confirm', 'pause', 'mute']);
  input.destroy();
});

test('键盘：WASD/方向键移动、轴向量、同动作双键分源释放', () => {
  const input = engine.createInput();
  fireWindow('keydown', keyEvent('w'));
  assert.strictEqual(input.isDown('up'), true);
  assert.deepStrictEqual(input.getAxis(), { x: 0, y: -1 });
  fireWindow('keydown', keyEvent('ArrowLeft'));
  assert.deepStrictEqual(input.getAxis(), { x: -1, y: -1 });
  fireWindow('keyup', keyEvent('w'));
  assert.deepStrictEqual(input.getAxis(), { x: -1, y: 0 });
  // 同动作双键：W 与 ArrowUp 同按，松开其一仍按住
  fireWindow('keydown', keyEvent('w'));
  fireWindow('keydown', keyEvent('ArrowUp'));
  fireWindow('keyup', keyEvent('ArrowUp'));
  assert.strictEqual(input.isDown('up'), true);
  fireWindow('keyup', keyEvent('w'));
  assert.strictEqual(input.isDown('up'), false);
  fireWindow('keyup', keyEvent('ArrowLeft'));
  assert.deepStrictEqual(input.getAxis(), { x: 0, y: 0 });
  input.destroy();
});

test('键盘：E/空格确认、Esc 暂停、M 静音绑定与大小写归一', () => {
  const input = engine.createInput();
  fireWindow('keydown', keyEvent('E'));
  assert.strictEqual(input.wasPressed('confirm'), true);
  fireWindow('keyup', keyEvent('E'));
  input.endFrame();
  fireWindow('keydown', keyEvent(' '));
  assert.strictEqual(input.wasPressed('confirm'), true);
  fireWindow('keyup', keyEvent(' '));
  input.endFrame();
  fireWindow('keydown', keyEvent('Escape'));
  assert.strictEqual(input.wasPressed('pause'), true);
  fireWindow('keyup', keyEvent('Escape'));
  input.endFrame();
  fireWindow('keydown', keyEvent('m'));
  assert.strictEqual(input.wasPressed('mute'), true);
  fireWindow('keyup', keyEvent('m'));
  input.destroy();
});

test('键盘：按下边沿一次有效、endFrame 清空、自动重复与同动作第二键不产生边沿、游戏键 preventDefault', () => {
  const input = engine.createInput();
  fireWindow('keydown', keyEvent('e'));
  assert.strictEqual(input.wasPressed('confirm'), true);
  assert.strictEqual(input.wasPressed('confirm'), true, '未 endFrame 前边沿保持');
  input.endFrame();
  assert.strictEqual(input.wasPressed('confirm'), false);
  fireWindow('keydown', keyEvent('e', { repeat: true }));
  assert.strictEqual(input.wasPressed('confirm'), false, '长按自动重复忽略');
  // E 仍按住时按空格：同动作已按住，不重复产生边沿
  fireWindow('keydown', keyEvent(' '));
  assert.strictEqual(input.wasPressed('confirm'), false, '同动作第二键无新边沿');
  fireWindow('keyup', keyEvent('e'));
  fireWindow('keyup', keyEvent(' '));
  input.endFrame();
  let prevented = 0;
  fireWindow('keydown', { key: ' ', preventDefault() { prevented++; } });
  assert.strictEqual(prevented, 1, '游戏键应阻止页面默认行为');
  fireWindow('keydown', { key: ' ', repeat: true, preventDefault() { prevented++; } });
  assert.strictEqual(prevented, 2, '长按自动重复事件同样应阻止页面默认行为');
  assert.strictEqual(input.wasPressed('confirm'), true, '重复事件不产生新按下边沿');
  input.destroy();
});

test('键盘：带修饰键组合不触发、松开边沿事件、失焦清空按住状态', () => {
  const input = engine.createInput();
  const released = [];
  input.on('release', (a) => released.push(a));
  fireWindow('keydown', keyEvent('w', { ctrlKey: true }));
  assert.strictEqual(input.isDown('up'), false, 'Ctrl+W 不触发');
  fireWindow('keydown', keyEvent('d'));
  assert.strictEqual(input.isDown('right'), true);
  fireWindow('keyup', keyEvent('d'));
  assert.strictEqual(input.wasReleased('right'), true);
  assert.deepStrictEqual(released, ['right']);
  fireWindow('keydown', keyEvent('a'));
  fireWindow('blur', {});
  assert.strictEqual(input.isDown('left'), false, '失焦清空按住');
  assert.deepStrictEqual(released, ['right', 'left']);
  input.destroy();
});

test('键盘：keyup 带修饰键仍释放；被过滤按键不产生虚假 release', () => {
  const input = engine.createInput();
  const released = [];
  input.on('release', (a) => released.push(a));
  // 按住期间再按修饰键：keyup 不过滤修饰键，应正常释放
  fireWindow('keydown', keyEvent('w'));
  assert.strictEqual(input.isDown('up'), true);
  fireWindow('keyup', keyEvent('w', { ctrlKey: true }));
  assert.strictEqual(input.isDown('up'), false, 'keyup 带修饰键仍释放');
  assert.deepStrictEqual(released, ['up']);
  // keydown 被修饰键过滤（从未按住）：后续 keyup 不得产生虚假 release
  fireWindow('keydown', keyEvent('d', { ctrlKey: true }));
  fireWindow('keyup', keyEvent('d'));
  assert.strictEqual(input.wasReleased('right'), false, '被过滤按键无虚假 release');
  assert.deepStrictEqual(released, ['up']);
  input.destroy();
});

test('事件订阅：press/release 回调收到动作名，可退订', () => {
  const input = engine.createInput();
  const seen = [];
  const onPress = (a) => seen.push('press:' + a);
  input.on('press', onPress);
  fireWindow('keydown', keyEvent('m'));
  input.off('press', onPress);
  fireWindow('keyup', keyEvent('m'));
  fireWindow('keydown', keyEvent('p'));
  assert.deepStrictEqual(seen, ['press:mute']);
  input.destroy();
});

test('触屏虚拟按键：十字键移动 + A 键确认，与键盘等价，多指同键安全', () => {
  const savedQSA = document.querySelectorAll;
  const up = fakeButton('up');
  const action = fakeButton('action');
  document.querySelectorAll = (sel) => (sel === '[data-key]' ? [up, action] : []);
  const input = engine.createInput();
  up._fire('pointerdown', { pointerId: 1, preventDefault() {} });
  assert.strictEqual(input.isDown('up'), true);
  assert.deepStrictEqual(input.getAxis(), { x: 0, y: -1 });
  action._fire('pointerdown', { pointerId: 2, preventDefault() {} });
  assert.strictEqual(input.wasPressed('confirm'), true, 'A 键 = 确认');
  assert.strictEqual(action.classList.contains('pressed'), true);
  up._fire('pointerup', { pointerId: 1 });
  assert.strictEqual(input.isDown('up'), false);
  // 同一按钮双指按下，抬一指仍按住
  up._fire('pointerdown', { pointerId: 3, preventDefault() {} });
  up._fire('pointerdown', { pointerId: 4, preventDefault() {} });
  up._fire('pointerup', { pointerId: 3 });
  assert.strictEqual(input.isDown('up'), true);
  up._fire('pointerup', { pointerId: 4 });
  assert.strictEqual(input.isDown('up'), false);
  assert.strictEqual(up.classList.contains('pressed'), false);
  input.destroy();
  document.querySelectorAll = savedQSA;
});

test('触屏：pointercancel 与 lostpointercapture 等效松开；未知 data-key 忽略', () => {
  const savedQSA = document.querySelectorAll;
  const right = fakeButton('right');
  const ghost = fakeButton('ghost');
  document.querySelectorAll = () => [right, ghost];
  const input = engine.createInput();
  right._fire('pointerdown', { pointerId: 7, preventDefault() {} });
  assert.strictEqual(input.isDown('right'), true);
  right._fire('pointercancel', { pointerId: 7 });
  assert.strictEqual(input.isDown('right'), false);
  ghost._fire('pointerdown', { pointerId: 8, preventDefault() {} });
  assert.strictEqual(input.getAxis().x, 0, '未知 data-key 不产生输入');
  input.destroy();
  document.querySelectorAll = savedQSA;
});

test('触屏：失焦清空与销毁同步移除虚拟按键 pressed 样式', () => {
  const savedQSA = document.querySelectorAll;
  const up = fakeButton('up');
  const action = fakeButton('action');
  document.querySelectorAll = () => [up, action];
  const input = engine.createInput();
  up._fire('pointerdown', { pointerId: 1, preventDefault() {} });
  action._fire('pointerdown', { pointerId: 2, preventDefault() {} });
  assert.strictEqual(up.classList.contains('pressed'), true);
  assert.strictEqual(action.classList.contains('pressed'), true);
  fireWindow('blur', {});
  assert.strictEqual(input.isDown('up'), false);
  assert.strictEqual(input.isDown('confirm'), false);
  assert.strictEqual(up.classList.contains('pressed'), false, '失焦清空十字键 pressed 样式');
  assert.strictEqual(action.classList.contains('pressed'), false, '失焦清空 A 键 pressed 样式');
  const released = [];
  input.on('release', (a) => released.push(a));
  up._fire('pointerup', { pointerId: 1 });
  assert.deepStrictEqual(released, [], '清空后残余 pointerup 无虚假 release');
  // destroy 同样清理 pressed 样式
  up._fire('pointerdown', { pointerId: 5, preventDefault() {} });
  assert.strictEqual(up.classList.contains('pressed'), true);
  input.destroy();
  assert.strictEqual(up.classList.contains('pressed'), false, 'destroy 清空 pressed 样式');
  document.querySelectorAll = savedQSA;
});

test('粗指针检测：pointer/any-pointer 媒体查询与触摸能力兜底', () => {
  assert.strictEqual(engine.detectCoarsePointer(), false);
  matchMediaStates.set('(pointer: coarse)', true);
  assert.strictEqual(engine.detectCoarsePointer(), true);
  matchMediaStates.set('(pointer: coarse)', false);
  matchMediaStates.set('(any-pointer: coarse)', true);
  assert.strictEqual(engine.detectCoarsePointer(), true);
  matchMediaStates.clear();
  const savedMM = global.matchMedia;
  delete global.matchMedia;
  global.ontouchstart = function () {};
  assert.strictEqual(engine.detectCoarsePointer(), true, '无媒体查询时 ontouchstart 兜底');
  delete global.ontouchstart;
  global.matchMedia = savedMM;
});

test('输入开关：禁用冻结轴/按住并发出松开，恢复后可用', () => {
  const input = engine.createInput();
  fireWindow('keydown', keyEvent('s'));
  assert.strictEqual(input.isDown('down'), true);
  input.setEnabled(false);
  assert.strictEqual(input.isDown('down'), false, '禁用清空按住');
  assert.deepStrictEqual(input.getAxis(), { x: 0, y: 0 });
  fireWindow('keydown', keyEvent('w'));
  assert.strictEqual(input.isDown('up'), false, '禁用期间忽略新输入');
  input.setEnabled(true);
  fireWindow('keydown', keyEvent('w'));
  assert.strictEqual(input.isDown('up'), true);
  input.destroy();
});

test('销毁：解绑后键盘与触屏不再产生输入', () => {
  const savedQSA = document.querySelectorAll;
  const up = fakeButton('up');
  document.querySelectorAll = () => [up];
  const input = engine.createInput();
  input.destroy();
  fireWindow('keydown', keyEvent('w'));
  assert.strictEqual(input.isDown('up'), false);
  up._fire('pointerdown', { pointerId: 9, preventDefault() {} });
  assert.strictEqual(input.isDown('up'), false);
  document.querySelectorAll = savedQSA;
});

/* ─────────────────── 汇总 ─────────────────── */

console.log('');
if (failures.length) {
  console.error('失败 ' + failures.length + ' 项 / 共 ' + (passed + failures.length) + ' 项');
  console.warn = _warn;
  process.exit(1);
}
console.log('全部通过：' + passed + ' 项');
console.warn = _warn;
