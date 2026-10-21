/**
 * js/engine.js —— MIXXTOPIA 引擎
 *
 * Issue #4：Canvas 渲染引擎（瓦片图集、调色板、摄像机、缩放）
 *
 * 渲染规格（PLAN.md §3 / GAME_DESIGN.md §11）：
 *   - 逻辑分辨率 320×224（20×14 瓦片 × 16px）
 *   - 整数倍放大 + `image-rendering: pixelated`，像素风格缩放无模糊
 *   - 16px 瓦片图集缓存：同一「瓦片集 + 调色板」只构建一次，整屏 drawImage 直取
 *   - 调色板换色：素材以 4 槽模板色绘制，按关卡调色板逐像素重映射
 *   - 摄像机：目标跟随 + 地图边界钳制 + 小地图居中
 *
 * 后续 Issue 在本文件内追加（勿新建渲染文件）：
 *   #5 输入系统  ·  #9 碰撞与机制  ·  #15 粒子
 *
 * 演示模式说明：
 *   js/data.js 与 js/main.js 就位前，本文件内置演示（默认地图 + 方向键移动）
 *   用于验收静态地图渲染与摄像机跟随/钳制；二者落地后由 main.js 设置
 *   `window.MIXX_NO_DEMO = true` 停用演示，无需改动本文件。
 */
'use strict';

(function (root) {
  'use strict';

  /* ════════════════════════ 常量 ════════════════════════ */

  const TILE = 16;                       // 瓦片边长（px）
  const VIEW_W = 320;                    // 逻辑分辨率宽
  const VIEW_H = 224;                    // 逻辑分辨率高
  const VIEW_COLS = VIEW_W / TILE;       // 20 列
  const VIEW_ROWS = VIEW_H / TILE;       // 14 行

  /**
   * 模板色 4 槽（只存在于素材数据中，运行时必被调色板替换）：
   *   0 品红 #ff00ff —— 暗面 / 描边
   *   1 青   #00ffff —— 主色
   *   2 黄   #ffff00 —— 强调一
   *   3 橙   #ff8000 —— 强调二
   */
  const TEMPLATE_RGB = [
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 0],
    [255, 128, 0],
  ];
  const TEMPLATE_HEX = ['#ff00ff', '#00ffff', '#ffff00', '#ff8000'];
  const TEMPLATE_LOOKUP = new Map(TEMPLATE_RGB.map((c, i) => [c.join(','), i]));

  /* ════════════════════════ 颜色工具 ════════════════════════ */

  /** '#RRGGBB' → [r,g,b]；非法输入回退白色 */
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return [255, 255, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** 颜色乘系数（压暗/提亮） */
  function shade(hex, f) {
    const c = hexToRgb(hex);
    return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];
  }

  function rgbStr(c) {
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  /* ════════════════════════ Canvas 工厂（浏览器 / Node 测试桩兼容） ════════════════════════ */

  function makeCanvas(w, h) {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    throw new Error('MIXX.engine: 当前环境无 Canvas');
  }

  /* ════════════════════════ 调色板 ════════════════════════ */

  const DEFAULT_PALETTE = { bg: '#0B0B1E', cream: '#F0E6D2', gold: '#FFC857', pink: '#FF8FA3' };

  /**
   * 关卡调色板 → 4 槽颜色（数据格式见 GAME_DESIGN.md §11：{ bg, cream, gold, pink }）
   * 槽位语义：0 = bg 压暗（暗面/描边）· 1 = cream 主色 · 2 = gold 强调一 · 3 = pink 强调二
   * 返回 { bg:[r,g,b], slots:[[r,g,b]×4], key:'bg|cream|gold|pink' }，key 用作图集缓存键。
   */
  function resolvePalette(pal) {
    const p = pal || {};
    const bg = p.bg || DEFAULT_PALETTE.bg;
    const cream = p.cream || DEFAULT_PALETTE.cream;
    const gold = p.gold || DEFAULT_PALETTE.gold;
    const pink = p.pink || DEFAULT_PALETTE.pink;
    return {
      bg: hexToRgb(bg),
      slots: [shade(bg, 0.55), hexToRgb(cream), hexToRgb(gold), hexToRgb(pink)],
      key: [bg, cream, gold, pink].join('|'),
    };
  }

  /* ════════════════════════ 像素网格 → Canvas ════════════════════════ */

  /**
   * 像素网格 → Canvas。
   * grid：16 行 × 16 字符；'.' 或缺失为透明，'0'–'3' 对应槽位。
   * colors：4 个 [r,g,b]（模板色或调色板槽色）。
   * 素材（#13 正式美术）也以同样网格格式注册，天然支持换色。
   */
  function gridToCanvas(grid, colors) {
    const c = makeCanvas(TILE, TILE);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(TILE, TILE);
    const d = img.data;
    for (let y = 0; y < TILE; y++) {
      const row = grid[y] || '';
      for (let x = 0; x < TILE; x++) {
        const ch = row[x];
        if (!ch || ch === '.') continue;
        const s = ch.charCodeAt(0) - 48; // '0'..'3'
        const col = colors[s];
        if (!col) continue;
        const i = (y * TILE + x) * 4;
        d[i] = col[0];
        d[i + 1] = col[1];
        d[i + 2] = col[2];
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /**
   * 调色板换色：将 src 中模板槽色逐像素替换为 slots 颜色。
   * 非模板固定色与透明像素原样保留（素材可混用固定色，如纯白高光）。
   */
  function remapCanvas(src, slots) {
    const out = makeCanvas(src.width, src.height);
    const img = src.getContext('2d').getImageData(0, 0, src.width, src.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue; // 透明
      const slot = TEMPLATE_LOOKUP.get(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
      if (slot === undefined) continue; // 固定色
      const col = slots[slot];
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
    }
    out.getContext('2d').putImageData(img, 0, 0);
    return out;
  }

  /* ════════════════════════ 内置瓦片（占位，Issue #13 换正式美术） ════════════════════════ */

  const BUILTIN_TILES = {
    // 砖墙：0 灰缝 + 1 砖面错缝排布，点缀 2/3 色砖
    wall: [
      '0000000000000000',
      '0111011101110111',
      '0111011211011131',
      '0111011101110111',
      '0000000000000000',
      '1110111011101110',
      '1110111031101110',
      '1110111011101110',
      '0000000000000000',
      '0111011101110111',
      '0112011101110111',
      '0111011101110111',
      '0000000000000000',
      '1110111011101110',
      '1110111011131110',
      '1110111011101110',
    ],
    // 地面：主色底 + 每 4px 一格暗点
    floor: [
      '0001000100010001',
      '1111111111111111',
      '1111111111111111',
      '1111111111111111',
      '0001000100010001',
      '1111111111111111',
      '1111111111111111',
      '1111111111111111',
      '0001000100010001',
      '1111111111111111',
      '1111111111111111',
      '1111111111111111',
      '0001000100010001',
      '1111111111111111',
      '1111111111111111',
      '1111111111111111',
    ],
    // 水面：3 底色 + 2 波纹 + 1 波光
    water: [
      '3333333333333333',
      '3333333333333333',
      '3333333333333333',
      '2222222222222222',
      '3333333333333333',
      '3333313333331333',
      '3333333333333333',
      '3333333333333333',
      '2222222222222222',
      '3333333333333333',
      '3333333333333333',
      '3333333333313333',
      '3333333333333333',
      '2222222222222222',
      '3333333333333333',
      '3333333333333333',
    ],
  };

  // 未知瓦片：半透明棋盘格警示（数据校验 #16 应提前拦截，此处兜底防崩）
  const UNKNOWN_TILE = (function () {
    const g = [];
    for (let y = 0; y < TILE; y++) {
      let row = '';
      for (let x = 0; x < TILE; x++) row += (x + y) % 2 ? '2' : '.';
      g.push(row);
    }
    return g;
  })();

  const DEFAULT_LEGEND = { '#': 'wall', '·': 'floor', '~': 'water' };

  /* ════════════════════════ 瓦片集注册表 ════════════════════════ */

  const tilesets = { builtin: BUILTIN_TILES };

  /** 注册/合并瓦片集（Issue #13 美术落地后按关注册主题瓦片） */
  function registerTileset(id, sources) {
    tilesets[id] = Object.assign({}, tilesets[id] || {}, sources);
  }

  const _warned = new Set();
  function warnOnce(msg) {
    if (_warned.has(msg)) return;
    _warned.add(msg);
    if (typeof console !== 'undefined' && console.warn) console.warn('[MIXX.engine] ' + msg);
  }

  /* ════════════════════════ 摄像机 ════════════════════════ */

  class Camera {
    constructor() {
      this.x = 0; // 视口左上角世界坐标（px）
      this.y = 0;
      this.smoothing = 0; // 0 = 即时跟随；>0 = 每帧插值系数（0..1）
    }

    /**
     * 跟随目标中心（世界像素坐标）并钳制在地图边界内。
     * 地图小于视口时返回负偏移，使地图在视口中居中。
     */
    follow(tx, ty, mapWpx, mapHpx) {
      const cx = mapWpx <= VIEW_W
        ? (mapWpx - VIEW_W) / 2
        : clamp(tx - VIEW_W / 2, 0, mapWpx - VIEW_W);
      const cy = mapHpx <= VIEW_H
        ? (mapHpx - VIEW_H) / 2
        : clamp(ty - VIEW_H / 2, 0, mapHpx - VIEW_H);
      if (this.smoothing > 0) {
        this.x += (cx - this.x) * this.smoothing;
        this.y += (cy - this.y) * this.smoothing;
      } else {
        this.x = cx;
        this.y = cy;
      }
    }
  }

  /* ════════════════════════ 渲染器 ════════════════════════ */

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = VIEW_W;
      canvas.height = VIEW_H;
      this.ctx = canvas.getContext('2d');
      if ('imageSmoothingEnabled' in this.ctx) this.ctx.imageSmoothingEnabled = false;
      this.atlasCache = new Map();    // 瓦片图集缓存：key = tileset|paletteKey
      this.templateCache = new Map(); // 模板色素材缓存：key = tileset/type
      this.scale = 1;
      this._onResize = () => this.resize();
      if (typeof root.addEventListener === 'function') {
        root.addEventListener('resize', this._onResize);
      }
      this.resize();
    }

    /** 整数倍放大：取恰好装入窗口的最大整数 k（≥1），配合 CSS pixelated 无模糊 */
    resize() {
      const availW = (root.innerWidth || 0) - 24;
      const availH = (root.innerHeight || 0) - 24;
      const k = Math.max(
        1,
        Math.min(Math.floor(availW / VIEW_W), Math.floor(availH / VIEW_H))
      );
      this.scale = k;
      const st = this.canvas.style;
      st.width = VIEW_W * k + 'px';
      st.height = VIEW_H * k + 'px';
      st.imageRendering = 'pixelated';
      return k;
    }

    destroy() {
      if (typeof root.removeEventListener === 'function') {
        root.removeEventListener('resize', this._onResize);
      }
    }

    /** 取瓦片图集：同一「瓦片集 + 调色板」只构建一次（缓存命中直接复用） */
    getTileAtlas(tilesetId, palette) {
      const key = tilesetId + '|' + palette.key;
      const hit = this.atlasCache.get(key);
      if (hit) return hit;
      const set = tilesets[tilesetId] || tilesets.builtin;
      const types = Object.keys(set);
      const sheet = makeCanvas(TILE * types.length, TILE);
      const sctx = sheet.getContext('2d');
      const index = {};
      types.forEach((type, i) => {
        const tpl = this._templateCanvas(tilesetId, type, set[type]);
        const colored = remapCanvas(tpl, palette.slots); // 调色板换色
        sctx.drawImage(colored, i * TILE, 0);
        index[type] = i;
      });
      const atlas = { sheet, index, key };
      this.atlasCache.set(key, atlas);
      return atlas;
    }

    _templateCanvas(tilesetId, type, grid) {
      const k = tilesetId + '/' + type;
      if (!this.templateCache.has(k)) {
        this.templateCache.set(k, gridToCanvas(grid, TEMPLATE_RGB));
      }
      return this.templateCache.get(k);
    }

    /**
     * 渲染关卡静态地图（Issue #4 完成标志：静态地图正确渲染）。
     * level：{ map:{w,h,rows,legend}, palette:{bg,cream,gold,pink}, tileset? }
     * camera：Camera 实例（世界坐标平移）。
     */
    renderLevel(level, camera) {
      const palette = resolvePalette(level && level.palette);
      const atlas = this.getTileAtlas((level && level.tileset) || 'builtin', palette);
      const map = level.map;
      const ctx = this.ctx;

      // 背景色（视口外的地图空隙 / 小地图留白）
      ctx.fillStyle = rgbStr(palette.bg);
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      const camX = Math.round(camera.x);
      const camY = Math.round(camera.y);
      ctx.save();
      ctx.translate(-camX, -camY);

      const legend = map.legend || DEFAULT_LEGEND;
      const x0 = Math.max(0, Math.floor(camera.x / TILE));
      const y0 = Math.max(0, Math.floor(camera.y / TILE));
      const x1 = Math.min(map.w, Math.ceil((camera.x + VIEW_W) / TILE));
      const y1 = Math.min(map.h, Math.ceil((camera.y + VIEW_H) / TILE));

      for (let ty = y0; ty < y1; ty++) {
        const row = map.rows[ty];
        if (!row) continue;
        for (let tx = x0; tx < x1; tx++) {
          const ch = row[tx];
          if (ch === undefined || ch === ' ') continue;
          const type = legend[ch];
          if (type === undefined) { warnOnce('未注册的地形符号 "' + ch + '"'); continue; }
          const idx = atlas.index[type];
          if (idx === undefined) { warnOnce('未注册的瓦片类型 "' + type + '"'); continue; }
          ctx.drawImage(atlas.sheet, idx * TILE, 0, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE);
        }
      }
      ctx.restore();
    }
  }

  /* ════════════════════════ 演示模式（data.js / main.js 就位前） ════════════════════════ */

  const DEMO_LEVEL = buildDemoLevel();

  function buildDemoLevel() {
    const w = 40;
    const h = 28;
    const rows = [];
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let x = 0; x < w; x++) row += '·';
      rows.push(row);
    }
    const set = (x, y, ch) => {
      rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
    };
    // 边界墙
    for (let x = 0; x < w; x++) { set(x, 0, '#'); set(x, h - 1, '#'); }
    for (let y = 0; y < h; y++) { set(0, y, '#'); set(w - 1, y, '#'); }
    // 梦幻湖（8×6）
    for (let y = 5; y <= 10; y++) for (let x = 6; x <= 13; x++) set(x, y, '~');
    // 环形岛（南墙留门洞）
    for (let y = 8; y <= 16; y++) {
      for (let x = 20; x <= 27; x++) {
        if (x === 20 || x === 27 || y === 8 || y === 16) set(x, y, '#');
      }
    }
    set(23, 16, '·');
    set(24, 16, '·');
    // 右上小屋（下墙留门）
    for (let y = 3; y <= 10; y++) {
      for (let x = 30; x <= 36; x++) {
        if (x === 30 || x === 36 || y === 3 || y === 10) set(x, y, '#');
      }
    }
    set(33, 10, '·');
    // 散落石柱
    [[3, 20], [4, 20], [17, 4], [18, 4], [15, 21], [16, 21], [15, 22], [16, 22]]
      .forEach((p) => set(p[0], p[1], '#'));
    return {
      map: { w, h, rows, legend: DEFAULT_LEGEND },
      palette: { bg: '#1A1033', cream: '#F7E8C8', gold: '#FFC857', pink: '#FF8FA3' },
      title: 'Engine Demo · Issue #4',
    };
  }

  /** 演示驱动：方向键/WASD 移动小人，验证摄像机跟随与边界钳制（碰撞为演示简化版，#9 接手） */
  function bootDemo(canvas) {
    const renderer = new Renderer(canvas);
    const camera = new Camera();
    const level = DEMO_LEVEL;
    const solid = { '#': true, '~': true };
    const player = { x: 2 * TILE + 2, y: 2 * TILE + 2 };
    const keys = new Set();
    const SPEED = 80; // px/s

    const KEY_DIR = {
      arrowup: 'up', w: 'up',
      arrowdown: 'down', s: 'down',
      arrowleft: 'left', a: 'left',
      arrowright: 'right', d: 'right',
    };

    if (typeof root.addEventListener === 'function') {
      root.addEventListener('keydown', (e) => {
        const dir = KEY_DIR[(e.key || '').toLowerCase()];
        if (!dir) return;
        keys.add(dir);
        if (e.preventDefault) e.preventDefault();
      });
      root.addEventListener('keyup', (e) => {
        const dir = KEY_DIR[(e.key || '').toLowerCase()];
        if (dir) keys.delete(dir);
      });
    }

    // 目标 AABB 四角所在瓦片是否实心（演示碰撞，#9 提供正式碰撞与滑动）
    function blockedAt(px, py) {
      const x0 = Math.floor(px / TILE);
      const x1 = Math.floor((px + 15) / TILE);
      const y0 = Math.floor(py / TILE);
      const y1 = Math.floor((py + 15) / TILE);
      for (let ty = y0; ty <= y1; ty++) {
        const row = level.map.rows[ty];
        for (let tx = x0; tx <= x1; tx++) {
          if (solid[row && row[tx]]) return true;
        }
      }
      return false;
    }

    let last = 0;
    let booted = false;
    function frame(ts) {
      const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
      last = ts;

      // 分轴移动：撞墙该轴回退，另一轴可滑动
      const dx = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
      const dy = (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0);
      if (dx) {
        const nx = player.x + dx * SPEED * dt;
        if (!blockedAt(nx, player.y)) player.x = nx;
      }
      if (dy) {
        const ny = player.y + dy * SPEED * dt;
        if (!blockedAt(player.x, ny)) player.y = ny;
      }

      camera.follow(player.x + 8, player.y + 8, level.map.w * TILE, level.map.h * TILE);
      renderer.renderLevel(level, camera);

      // 演示小人
      const ctx = renderer.ctx;
      const px = Math.round(player.x - camera.x);
      const py = Math.round(player.y - camera.y);
      ctx.fillStyle = 'rgb(0,0,0)';
      ctx.fillRect(px - 1, py - 1, 18, 18);
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.fillRect(px, py, 16, 16);
      ctx.fillStyle = 'rgb(26,16,51)';
      ctx.fillRect(px + 3, py + 3, 10, 10);
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.fillRect(px + 5, py + 5, 3, 3);
      ctx.fillRect(px + 10, py + 5, 3, 3);

      // HUD 提示条
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, VIEW_W, 12);
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.font = '8px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText('ENGINE DEMO · 方向键/WASD 移动 · ' + level.title, 4, 3);

      // 冒烟标志：供无头浏览器验收
      if (!booted) {
        booted = true;
        const app = document.getElementById('app');
        if (app) app.setAttribute('data-engine-demo', 'ok');
      }
      root.requestAnimationFrame(frame);
    }
    root.requestAnimationFrame(frame);
  }

  // 自动演示：仅在浏览器环境、且 data.js/main.js 未接管时运行
  if (typeof document !== 'undefined') {
    const boot = () => {
      const canvas = document.getElementById('game');
      if (!canvas) return;
      if (root.MIXX_NO_DEMO || root.GAME) return;
      // 演示期间隐藏静态 UI 层，聚焦画布
      const screens = document.querySelectorAll('.screen');
      for (let i = 0; i < screens.length; i++) screens[i].classList.add('hidden');
      bootDemo(canvas);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  /* ════════════════════════ 公开 API ════════════════════════ */

  const engine = {
    VERSION: '0.1.0',
    TILE: TILE,
    VIEW_W: VIEW_W,
    VIEW_H: VIEW_H,
    VIEW_COLS: VIEW_COLS,
    VIEW_ROWS: VIEW_ROWS,
    TEMPLATE_HEX: TEMPLATE_HEX,
    Camera: Camera,
    Renderer: Renderer,
    createRenderer: (canvas) => new Renderer(canvas),
    createCamera: () => new Camera(),
    registerTileset: registerTileset,
    resolvePalette: resolvePalette,
    gridToCanvas: gridToCanvas,
    remapCanvas: remapCanvas,
    color: { hexToRgb: hexToRgb, shade: shade, rgbStr: rgbStr },
    demoLevel: DEMO_LEVEL,
    _tilesets: tilesets, // 供测试/调试读取内置瓦片网格
  };

  root.MIXX = root.MIXX || {};
  root.MIXX.engine = engine;
})(typeof window !== 'undefined' ? window : globalThis);
