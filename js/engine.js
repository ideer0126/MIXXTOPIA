/**
 * js/engine.js —— MIXXTOPIA 引擎
 *
 * Issue #4：Canvas 渲染引擎（瓦片图集、调色板、摄像机、缩放）
 * Issue #5：输入系统（键盘 + 触屏虚拟按键）
 *
 * 渲染规格（PLAN.md §3 / GAME_DESIGN.md §11）：
 *   - 逻辑分辨率 320×224（20×14 瓦片 × 16px）
 *   - 整数倍放大 + `image-rendering: pixelated`，像素风格缩放无模糊
 *   - 16px 瓦片图集缓存：同一「瓦片集版本 + 调色板」只构建一次，整屏 drawImage 直取
 *   - 调色板换色：素材以 4 槽模板色绘制，按关卡调色板逐像素重映射
 *   - 摄像机：目标跟随 + 地图边界钳制 + 小地图居中
 *
 * 输入规格（Issue #5）：
 *   - 键盘：方向键/WASD 移动、E/空格确认、F 轻击、G 重击、Esc 暂停、M 静音
 *   - 触屏：pointer:coarse 设备显示虚拟十字键与 A/B/C 键，与键盘输入等价
 *   - Input 管理器（engine.createInput）统一两路输入，供演示与 main.js 使用
 *
 * Issue #9：收集与解谜机制（瓦片/实体碰撞、推箱、压力开关门、传送门所需的
 *   AABB 判定）与本 Issue 专用的星星拾取粒子（Particles）。#15 在此之上扩展
 *   过场/结算等表现粒子。
 *
 * Issue #18：战斗系统（Combat / COMBAT_TUNING）。F 轻击 / G 重击射程相同 24px，
 *   攻击只锁定正面 180° 内、视线可达的最近敌人，无敌人时沿移动方向；被动能量条自动充能，
 *   满能量时 F/G 释放 2.2 倍射程（52.8px）能量炮；
 *   敌人 AI、接触伤害、无敌帧与倒下复位均在本文件，main.js 负责反馈与 HUD。
 *
 * 后续 Issue 在本文件内追加（勿新建渲染文件）：
 *   #9 碰撞与机制（已实现）  ·  #15 表现粒子扩展  ·  #18 战斗（已实现）
 *
 * 演示模式说明：
 *   js/data.js 与 js/main.js 就位前，本文件内置演示（默认地图 + 输入系统驱动小人移动）
 *   用于验收静态地图渲染、摄像机跟随/钳制与输入系统；data/main 落地后由 main.js 接管
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

  const DEFAULT_LEGEND = { '#': 'wall', '·': 'floor', '~': 'water' };

  /* ════════════════════════ 瓦片集注册表 ════════════════════════ */

  const tilesets = { builtin: BUILTIN_TILES };
  const tilesetVersions = new Map([['builtin', 0]]);

  /** 注册/合并瓦片集（Issue #13 美术落地后按关注册主题瓦片） */
  function registerTileset(id, sources) {
    tilesets[id] = Object.assign({}, tilesets[id] || {}, sources);
    tilesetVersions.set(id, (tilesetVersions.get(id) || 0) + 1);
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
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {object} [opts] { hudReserve: 画布上方为 HUD 预留的 CSS 高度（px），
     *   缩放计算时从可用高度中扣除，保证 HUD 带 + 画布整体不超出窗口 }
     */
    constructor(canvas, opts) {
      this.canvas = canvas;
      // 保持 320×224 逻辑坐标，细节缓冲区允许人物使用更细的像素。
      const detail = opts && Number.isInteger(opts.detailScale) ? Math.max(1, Math.min(3, opts.detailScale)) : 1;
      canvas.width = VIEW_W * detail;
      canvas.height = VIEW_H * detail;
      this.ctx = canvas.getContext('2d');
      if (detail !== 1) this.ctx.scale(detail, detail);
      if ('imageSmoothingEnabled' in this.ctx) this.ctx.imageSmoothingEnabled = false;
      this.atlasCache = new Map();    // 瓦片图集缓存：key = [tilesetId, version, paletteKey]
      this.templateCache = new Map(); // 模板色素材缓存：key = [tilesetId, version, type]
      this.scale = 1;
      this.hudReserve = (opts && Number(opts.hudReserve) > 0) ? Number(opts.hudReserve) : 0;
      this._onResize = () => this.resize();
      if (typeof root.addEventListener === 'function') {
        root.addEventListener('resize', this._onResize);
      }
      this.resize();
    }

    /** 设备像素整数倍放大：取恰好装入窗口的最大整数 k（≥1），配合 CSS pixelated 无模糊 */
    resize() {
      const dpr = Number.isFinite(root.devicePixelRatio) && root.devicePixelRatio > 0
        ? root.devicePixelRatio : 1;
      const availW = ((root.innerWidth || 0) - 24) * dpr;
      const availH = ((root.innerHeight || 0) - 24 - this.hudReserve) * dpr;
      const k = Math.max(
        1,
        Math.min(Math.floor(availW / VIEW_W), Math.floor(availH / VIEW_H))
      );
      this.scale = k;
      const st = this.canvas.style;
      st.width = VIEW_W * k / dpr + 'px';
      st.height = VIEW_H * k / dpr + 'px';
      st.imageRendering = 'pixelated';
      const stage = this.canvas.parentElement;
      // 对话框以舞台为锚，宽度须跟随画布，不能被 HUD 文本撑大。
      if (stage && stage.id === 'stage') stage.style.width = st.width;
      return k;
    }

    destroy() {
      if (typeof root.removeEventListener === 'function') {
        root.removeEventListener('resize', this._onResize);
      }
    }

    /** 取瓦片图集：同一「瓦片集版本 + 调色板」只构建一次（缓存命中直接复用） */
    getTileAtlas(tilesetId, palette) {
      tilesetId = tilesetVersions.has(tilesetId) ? tilesetId : 'builtin';
      const version = tilesetVersions.get(tilesetId);
      const key = JSON.stringify([tilesetId, version, palette.key]);
      const hit = this.atlasCache.get(key);
      if (hit) return hit;
      const set = tilesets[tilesetId];
      const types = Object.keys(set);
      const sheet = makeCanvas(TILE * types.length, TILE);
      const sctx = sheet.getContext('2d');
      const index = {};
      types.forEach((type, i) => {
        const tpl = this._templateCanvas(tilesetId, version, type, set[type]);
        const colored = remapCanvas(tpl, palette.slots); // 调色板换色
        sctx.drawImage(colored, i * TILE, 0);
        index[type] = i;
      });
      const atlas = { sheet, index, key };
      this.atlasCache.set(key, atlas);
      return atlas;
    }

    _templateCanvas(tilesetId, version, type, grid) {
      const k = JSON.stringify([tilesetId, version, type]);
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
      if (!level) throw new TypeError('renderLevel: level 不能为空');
      const palette = resolvePalette(level.palette);
      const atlas = this.getTileAtlas(level.tileset || 'builtin', palette);
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
          // 家具底部仍为 wall 碰撞，绘制地板供透明场景素材叠放。
          const visualType = (map.styles && map.styles[ch]) || type;
          const idx = atlas.index[visualType];
          if (idx === undefined) { warnOnce('未注册的瓦片类型 "' + type + '"'); continue; }
          ctx.drawImage(atlas.sheet, idx * TILE, 0, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE);
        }
      }
      ctx.restore();
    }
  }

  /* ════════════════════════ 粒子（Issue #9 星星拾取反馈） ════════════════════════ */

  /** 星星爆散配色：金 → 粉 → 奶油白（世界坐标，draw 时只画 rgb 方块） */
  const STAR_BURST_COLORS = [
    [255, 200, 87],
    [255, 143, 163],
    [240, 230, 210],
  ];

  /**
   * 轻量粒子系统（Issue #9）：星星拾取/传送门激活的即时反馈。
   * 坐标使用世界像素；update 受主循环 dt 驱动，draw 由 renderer 平移摄像机。
   * #15 可在此基础上扩展更丰富的演出粒子，避免另起一套对象池。
   */
  class Particles {
    constructor(opts) {
      this.items = [];
      this.max = (opts && Number(opts.max) > 0) ? Math.floor(Number(opts.max)) : 240;
    }

    get count() { return this.items.length; }

    /**
     * 在 (x,y) 世界坐标爆发一簇粒子。
     * @param {object} [opts] { count, colors:[[r,g,b]...], speed, life, gravity, size }
     * @returns {number} 本次生成的粒子数
     */
    burst(x, y, opts) {
      opts = opts || {};
      const count = Math.max(0, Math.floor(opts.count == null ? 12 : Number(opts.count) || 0));
      const colors = Array.isArray(opts.colors) && opts.colors.length
        ? opts.colors : STAR_BURST_COLORS;
      const speed = opts.speed == null ? 56 : Number(opts.speed) || 0;
      const life = opts.life == null ? 0.55 : Number(opts.life) || 0;
      const gravity = opts.gravity == null ? 140 : Number(opts.gravity) || 0;
      const size = opts.size == null ? 2 : Number(opts.size) || 1;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const v = speed * (0.35 + Math.random() * 0.65);
        this.items.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * v,
          vy: Math.sin(angle) * v,
          gravity: gravity,
          life: life,
          ttl: life,
          size: size,
          color: colors[i % colors.length],
        });
      }
      if (this.items.length > this.max) {
        this.items.splice(0, this.items.length - this.max); // 超出上限丢弃最旧粒子
      }
      return count;
    }

    /** 推进 dt 秒，寿命耗尽的粒子移除；返回剩余数量 */
    update(dt) {
      const d = Math.max(0, Number(dt) || 0);
      if (!this.items.length || d === 0) return this.items.length;
      const alive = [];
      for (let i = 0; i < this.items.length; i++) {
        const p = this.items[i];
        p.life -= d;
        if (p.life <= 0) continue;
        p.vy += p.gravity * d;
        p.x += p.vx * d;
        p.y += p.vy * d;
        alive.push(p);
      }
      this.items = alive;
      return this.items.length;
    }

    /** 以摄像机为基准绘制（尺寸随寿命缩小，末段最小 1px） */
    draw(ctx, camera) {
      const camX = camera ? camera.x : 0;
      const camY = camera ? camera.y : 0;
      for (let i = 0; i < this.items.length; i++) {
        const p = this.items[i];
        const k = Math.max(0.25, p.ttl > 0 ? p.life / p.ttl : 0);
        const s = Math.max(1, Math.round(p.size * (0.5 + 0.5 * k)));
        ctx.fillStyle = rgbStr(p.color);
        ctx.fillRect(
          Math.round(p.x - camX - s / 2),
          Math.round(p.y - camY - s / 2),
          s, s
        );
      }
    }

    clear() { this.items.length = 0; }
  }

  /* ════════════════════════ 机制（Issue #9） ════════════════════════ */

  /** 永久阻挡通行的地形类型（WATER 在 #9 仍按不可通行占位，水面机制留给关 4） */
  const BLOCKING_TILES = { wall: true, water: true };

  /**
   * 关卡机制辅助（Issue #9）：地形/实体碰撞、推箱、压力开关 → 门。
   *
   * 约定（与 GAME_DESIGN.md §6、tools/validate.js 规则 9 一致）：
   *   - 永久可通行性：legend 解析为 wall / water 的瓦片阻挡；超界按墙处理；
   *   - 实体阻挡：关闭的 gate、box；portar/star/switch/npc 等可从上方经过；
   *   - 推箱：玩家朝箱子移动且箱后一格可站立时，箱子沿该方向滑动一格；
   *   - 压力开关：玩家或箱子压住开关期间 target 门开启，离开即关闭；
   *     门初始 open:true 视为常开，玩家正踩在门上时暂不关门（避免夹住）。
   *
   * 实体状态写在关卡运行时副本上（main.js 每关浅克隆实体），不改 data.js。
   */
  class Mechanics {
    constructor(level) {
      if (!level || !level.map) throw new TypeError('createMechanics: level.map 不能为空');
      this.level = level;
      this.map = level.map;
      this.staticCollision = root.MIXX.collision.compile(level);
      if (this.staticCollision.errors.length) throw new TypeError(this.staticCollision.errors.join('; '));
      this.legend = this.map.legend || DEFAULT_LEGEND;
      this._initialGateOpen = new Map();
      const gates = this.entitiesOf('gate');
      for (let i = 0; i < gates.length; i++) {
        this._initialGateOpen.set(gates[i], gates[i].open === true); // 数据初始态
        gates[i].open = gates[i].open === true;
      }
      const switches = this.entitiesOf('switch');
      for (let i = 0; i < switches.length; i++) switches[i].pressed = switches[i].pressed === true;
    }

    /** 按类型取运行时实体（不复制） */
    entitiesOf(type) {
      const out = [];
      const list = (this.level && this.level.entities) || [];
      for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].type === type) out.push(list[i]);
      }
      return out;
    }

    /** 指定瓦片上的某类实体（无则 null） */
    entityAtTile(tx, ty, type) {
      const list = (this.level && this.level.entities) || [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e && e.type === type && e.x === tx && e.y === ty) return e;
      }
      return null;
    }

    /** 瓦片地形类型：'wall' / 'floor' / 'water' …；超界与未知字符按墙处理 */
    tileType(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return 'wall';
      const row = this.map.rows[ty];
      const ch = row && row[tx];
      const type = this.legend[ch];
      return type === undefined ? 'wall' : type;
    }

    isSolidTile(tx, ty) {
      return BLOCKING_TILES[this.tileType(tx, ty)] === true;
    }

    /** AABB 是否与某瓦片重叠（px/py 为 AABB 左上角，size 为边长） */
    overlapsTile(px, py, size, tx, ty) {
      return px < (tx + 1) * TILE && px + size > tx * TILE
        && py < (ty + 1) * TILE && py + size > ty * TILE;
    }

    /**
     * 玩家/AABB 在 (px,py) 是否被阻挡：地形 + 关闭的门 + 箱子。
     * @param {object} [opts] { ignoreBox } 允许忽略某个箱子（推箱落点检查用）
     */
    blockedAt(px, py, size, opts) {
      const ignore = opts && opts.ignoreBox;
      if (this.level.party && this.level.party.preciseCollision) {
        const height = opts && opts.height > 0 ? opts.height : size;
        if (root.MIXX.collision.blockedAt(this.staticCollision.rects, px, py, size, height)) return true;
      }
      const height = opts && opts.height > 0 ? opts.height : size;
      const inset = this.level.party && this.level.party.preciseCollision ? .001 : 1;
      const x0 = Math.floor(px / TILE);
      const x1 = Math.floor((px + size - inset) / TILE);
      const y0 = Math.floor(py / TILE);
      const y1 = Math.floor((py + height - inset) / TILE);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (this.isSolidTile(tx, ty)) return true;
          const gate = this.entityAtTile(tx, ty, 'gate');
          if (gate && !gate.open) return true;
          const door = this.entityAtTile(tx, ty, 'door');
          if (door && !door.open) return true;
          const box = this.entityAtTile(tx, ty, 'box');
          if (box && !box.carried && box !== ignore) return true;
        }
      }
      return false;
    }

    /** 箱子能否落到目标瓦片：地形、关闭的门、其他箱子均阻挡 */
    _canPlaceBox(tx, ty, box) {
      if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return false;
      if (this.isSolidTile(tx, ty)) return false;
      const gate = this.entityAtTile(tx, ty, 'gate');
      if (gate) return false; // 门格不接受箱子，避免箱子在门闭合后阻挡通路
      if (this.entityAtTile(tx, ty, 'door') || this.entityAtTile(tx, ty, 'roomdoor')
        || this.entityAtTile(tx, ty, 'portal')) return false;
      const other = this.entityAtTile(tx, ty, 'box');
      if (other && !other.carried && other !== box) return false;
      if (box.preventDeadlocks && !this.entityAtTile(tx, ty, 'switch')) {
        const solid = (x, y) => this.isSolidTile(x, y);
        if ((solid(tx - 1, ty) || solid(tx + 1, ty))
          && (solid(tx, ty - 1) || solid(tx, ty + 1))) return false;
      }
      return true;
    }

    /**
     * 推箱：AABB 朝 (dx,dy)（取符号）贴住箱子且箱后一格可站立时，箱子滑动一格。
     * @returns {object|null} 被推动的箱子；未推动返回 null
     */
    pushBox(px, py, size, dx, dy) {
      if (!dx && !dy) return null;
      const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      const probeX = px + sx; // 向移动方向探 1px，贴边也能命中
      const probeY = py + sy;
      const boxes = this.entitiesOf('box');
      let hit = null;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (this.overlapsTile(probeX, probeY, size, box.x, box.y)) { hit = box; break; }
      }
      if (!hit) return null;
      if (hit.carried || hit.carryable || hit.locked) return null;
      const nx = hit.x + sx;
      const ny = hit.y + sy;
      if (!this._canPlaceBox(nx, ny, hit)) return null;
      hit.x = nx;
      hit.y = ny;
      return hit;
    }

    /**
     * 同步压力开关与门（玩家或箱子压住 → 开门；离开 → 关门）。
     * 门还支持 lamp.lit 控制器（关 2 灯柱复用同一扇门），#9 先留好判定。
     * @returns {{switches:Array, gates:Array<{gate:object,open:boolean}>}}
     */
    syncSwitches(px, py, size) {
      const boxes = this.entitiesOf('box').filter(b => !b.carried);
      const switches = this.entitiesOf('switch');
      const changedSwitches = [];
      for (let i = 0; i < switches.length; i++) {
        const sw = switches[i];
        let pressed = !sw.hidden && this.overlapsTile(px, py, size, sw.x, sw.y);
        if (!pressed && !sw.hidden) {
          for (let j = 0; j < boxes.length; j++) {
            const b = boxes[j];
            if (b.x === sw.x && b.y === sw.y) { pressed = true; break; }
          }
        }
        if (pressed !== sw.pressed) {
          sw.pressed = pressed;
          changedSwitches.push(sw);
        }
      }

      const lamps = this.entitiesOf('lamp');
      const gates = this.entitiesOf('gate');
      const changedGates = [];
      for (let i = 0; i < gates.length; i++) {
        const gate = gates[i];
        const ctlSwitches = switches.filter((s) => s.target === gate.id);
        const ctlLamps = lamps.filter((l) => l.target === gate.id && l.lit === true);
        if (ctlSwitches.length + ctlLamps.length === 0) continue; // 无控制器的门保持数据初始态
        let next = this._initialGateOpen.get(gate) === true
          || ctlSwitches.some((s) => s.pressed === true && (!gate.boxOnly
            || boxes.some(b => b.x === s.x && b.y === s.y)))
          || ctlLamps.length > 0;
        // 玩家正踩在门上：暂不关闭，避免门在脚下闭合把玩家夹死
        if (!next && gate.open && this.overlapsTile(px, py, size, gate.x, gate.y)) next = true;
        if (next !== gate.open) {
          gate.open = next;
          changedGates.push({ gate: gate, open: next });
        }
      }
      return { switches: changedSwitches, gates: changedGates };
    }
  }

  /* ════════════════════════ 战斗（Issue #18） ════════════════════════ */

  /**
   * 战斗数值（单一真源：main.js / tools/test-* / GAME_DESIGN.md §12 均以此为准）。
   *
   * 武器 = NMIXX 二代应援棒：F 轻击 / G 重击；轻击与重击射程相同（24px）。
   * 攻击方向只锁定正面 180° 内、视线可达的最近敌人；无敌人时沿最近移动方向（八向）。
   * 被动能量条自动充能，命中额外充能；攒满 100 后按 F 或 G 释放能量炮，
   * 射程 = 普攻 24px × 2.2 = 52.8px，穿透光束、消耗全部能量。
   */
  const COMBAT_TUNING = {
    maxHp: 10,
    maxEnergy: 100,
    energyRegen: 7,            // 被动充能：每秒 +7（约 14.3s 充满）
    invuln: 0.9,               // 受击无敌帧（秒）
    respawnInvuln: 1.2,        // 倒下复位后的无敌帧
    attackRange: 24,           // 普攻射程（px，轻击 = 重击）
    cannonMultiplier: 2.2,     // 能量炮射程倍率
    playerKnockback: 14,
    light: {
      damage: 1, cooldown: 0.26, active: 0.14, width: 24,
      energyOnHit: 5, knockback: 10,
    },
    heavy: {
      damage: 2, cooldown: 0.55, active: 0.22, width: 24,
      energyOnHit: 10, knockback: 18,
    },
    cannon: {
      damage: 6, cooldown: 0.8, active: 0.32, width: 32,
      energyOnHit: 0, knockback: 26, energyCost: 100,
    },
    enemy: {
      size: 12, hp: 3, speed: 36, aggro: 96, damage: 1, energyOnKill: 5,
    },
    enemyKinds: {
      dreamling: { hp: 3, speed: 36, aggro: 96, damage: 1 },
      wisp: { hp: 2, speed: 52, aggro: 128, damage: 1 },
    },
  };
  COMBAT_TUNING.cannon.range = Math.round(COMBAT_TUNING.attackRange * COMBAT_TUNING.cannonMultiplier * 1000) / 1000;

  /**
   * 玩家战斗状态机（Issue #18）：生命 / 被动能量 / 朝向 / 攻击冷却 / 敌人 AI。
   *
   * 纯逻辑类，不依赖 DOM 与渲染：main.js 负责按键、粒子、音效、HUD 与绘制；
   * tools/test-engine.js 可直接驱动本类做确定性单测。
   *
   * 与关卡数据的关系：敌人来自 `entities` 中 `type:'enemy'` 的实体；本类只把
   * 实体坐标作为出生点，运行时位置保存在 `combat.enemies[i]`，不改 data.js。
   */
  class Combat {
    constructor(level, opts) {
      opts = opts || {};
      this.level = level || { entities: [] };
      this.maxHp = Number(opts.maxHp) > 0 ? Math.floor(Number(opts.maxHp)) : COMBAT_TUNING.maxHp;
      this.hp = this.maxHp;
      this.maxEnergy = Number(opts.maxEnergy) > 0 ? Number(opts.maxEnergy) : COMBAT_TUNING.maxEnergy;
      this.energy = clamp(Number(opts.energy) || 0, 0, this.maxEnergy);
      this.facing = { x: 0, y: 1 };   // 默认朝下（与出生点面向一致）
      this.cooldown = 0;
      this.swing = null;              // 当前挥击/光束演出 {kind,dir,origin,range,width,t,duration}
      this.invuln = 0;
      this.hurtFlash = 0;
      this.time = 0;
      this.down = false;
      this.attackRange = COMBAT_TUNING.attackRange;
      this.cannonRange = COMBAT_TUNING.cannon.range;
      this.enemies = [];
      this._spawnEnemies();
    }

    /** 从关卡实体层生成敌人运行时状态（出生点 / 覆盖数值） */
    _spawnEnemies() {
      const list = (this.level && this.level.entities) || [];
      const base = COMBAT_TUNING.enemy;
      let seq = 0;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e || e.type !== 'enemy') continue;
        if (!isFinite(e.x) || !isFinite(e.y)) continue;
        const kind = e.kind || 'dreamling';
        const preset = COMBAT_TUNING.enemyKinds[kind] || COMBAT_TUNING.enemyKinds.dreamling;
        const size = clamp(Number(e.size) || base.size, 8, TILE);
        const x = e.x * TILE + (TILE - size) / 2;
        const y = e.y * TILE + (TILE - size) / 2;
        const hp = Number(e.hp) > 0 ? Math.floor(Number(e.hp)) : preset.hp;
        this.enemies.push({
          id: e.id || ('enemy-' + (++seq)),
          kind: kind,
          ref: e,                       // 关卡实体（出生点来源，不随 AI 移动）
          x: x, y: y,
          spawnX: x, spawnY: y,
          size: size,
          hp: hp, maxHp: hp,
          speed: Number(e.speed) > 0 ? Number(e.speed) : preset.speed,
          aggro: Number(e.aggro) > 0 ? Number(e.aggro) : preset.aggro,
          damage: Number(e.damage) > 0 ? Math.floor(Number(e.damage)) : preset.damage,
          dead: false,
          hurt: 0,
          moving: false,
        });
      }
    }

    /**
     * 攻击方向的轴对齐包围盒（调试/测试用）：沿 facing 从玩家中心延伸 range，
     * 宽度 width。实际命中判定走 _hitsEnemy() 的旋转矩形，支持斜向锁定。
     */
    hitArea(player, facing, range, width) {
      const cx = player.x + 8;
      const cy = player.y + 8;
      const dx = (facing && facing.x) || 0;
      const dy = (facing && facing.y) || 0;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (!len) return { x: cx - width / 2, y: cy, w: width, h: range };
      const ux = dx / len;
      const uy = dy / len;
      const ex = cx + ux * range;
      const ey = cy + uy * range;
      const px = -uy * (width / 2);
      const py = ux * (width / 2);
      const xs = [cx + px, cx - px, ex + px, ex - px];
      const ys = [cy + py, cy - py, ey + py, ey - py];
      const minX = Math.min.apply(null, xs);
      const minY = Math.min.apply(null, ys);
      return { x: minX, y: minY, w: Math.max.apply(null, xs) - minX, h: Math.max.apply(null, ys) - minY };
    }

    /** 更新朝向：支持八向；无移动输入时保持上次朝向 */
    face(dx, dy) {
      const sx = Number(dx) > 0 ? 1 : Number(dx) < 0 ? -1 : 0;
      const sy = Number(dy) > 0 ? 1 : Number(dy) < 0 ? -1 : 0;
      if (!sx && !sy) return this.facing;
      this.facing = { x: sx, y: sy };
      return this.facing;
    }

    /**
     * 自动锁敌：只锁定「正面 180° 扇形」内、攻击范围内、视线未被遮挡的
     * 最近存活敌人（按敌人中心距离）。
     * - 正面 = 最近一次移动方向 this.facing（八向），含 90° 边界；
     * - 射程以敌人身体边缘计算：中心距离 - 敌人半身 <= range；
     * - 视线检测覆盖墙体、关闭的门、箱子（水面不挡视线，GAME_DESIGN §12）。
     * @param {{x:number,y:number}} player
     * @param {number} range
     * @param {object} [mechanics] engine.Mechanics；缺省时不做遮挡检测（单测/演示）
     */
    findTarget(player, range, mechanics) {
      if (!player) return null;
      const pcx = player.x + 8;
      const pcy = player.y + 8;
      const fx = this.facing.x;
      const fy = this.facing.y;
      const flen = Math.sqrt(fx * fx + fy * fy) || 1;
      const ux = fx / flen;
      const uy = fy / flen;
      let best = null;
      let bestDist = Infinity;
      for (let i = 0; i < this.enemies.length; i++) {
        const enemy = this.enemies[i];
        if (enemy.dead) continue;
        const dx = (enemy.x + enemy.size / 2) - pcx;
        const dy = (enemy.y + enemy.size / 2) - pcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist - enemy.size / 2 > range) continue;
        // 正面 180°（中心线两侧各 90°）：用敌人身体最近点判定，
        // 避免「同一行但敌人中心比玩家中心高 2px」这类贴边目标被判到背面
        const nx = Math.max(enemy.x, Math.min(pcx, enemy.x + enemy.size));
        const ny = Math.max(enemy.y, Math.min(pcy, enemy.y + enemy.size));
        if ((nx - pcx) * ux + (ny - pcy) * uy < 0) continue;
        if (!this.hasLineOfSight(mechanics, pcx, pcy, pcx + dx, pcy + dy)) continue;
        if (dist < bestDist) { best = enemy; bestDist = dist; }
      }
      return best;
    }

    /**
     * 单点视线遮挡：墙体 / 关闭的门 / 箱子会挡视线；水面与地面不挡。
     * 有 tileType/entityAtTile 的 Mechanics 走精确判定，否则回退 blockedAt。
     */
    _sightBlockedAt(mechanics, px, py) {
      if (typeof mechanics.tileType === 'function') {
        const tx = Math.floor(px / TILE);
        const ty = Math.floor(py / TILE);
        if (mechanics.tileType(tx, ty) === 'wall') return true;
        if (typeof mechanics.entityAtTile === 'function') {
          const gate = mechanics.entityAtTile(tx, ty, 'gate');
          if (gate && gate.open !== true) return true;
          if (mechanics.entityAtTile(tx, ty, 'box')) return true;
        }
        return false;
      }
      return typeof mechanics.blockedAt === 'function'
        ? mechanics.blockedAt(px, py, 1)
        : false;
    }

    /**
     * 视线判定：从 (x1,y1) 到 (x2,y2) 以约 3px 步长采样，
     * 任一采样点落在墙体/关闭的门/箱子上即视为遮挡。
     * mechanics 缺省时返回 true（保持纯数值单测可直接使用）。
     */
    hasLineOfSight(mechanics, x1, y1, x2, y2) {
      if (!mechanics) return true;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= 0) return true;
      const steps = Math.max(1, Math.ceil(dist / 3));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (this._sightBlockedAt(mechanics, x1 + dx * t, y1 + dy * t)) return false;
      }
      return true;
    }

    /**
     * 攻击方向：优先指向锁定目标中心（八向/任意角度）；
     * 正面无可用目标时沿最近一次移动方向（this.facing，支持八向）。
     */
    aimDir(player, target) {
      const pcx = player.x + 8;
      const pcy = player.y + 8;
      if (target) {
        const dx = (target.x + target.size / 2) - pcx;
        const dy = (target.y + target.size / 2) - pcy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) return { x: dx / len, y: dy / len };
      }
      const fx = this.facing.x;
      const fy = this.facing.y;
      const len = Math.sqrt(fx * fx + fy * fy);
      if (!len) return { x: 0, y: 1 };
      return { x: fx / len, y: fy / len };
    }

    /**
     * 旋转矩形命中：沿 dir 的前向距离 + 侧向距离，敌人身体按半径扩展；
     * 墙体/关闭的门/箱子遮挡视线时不造成伤害。
     */
    _hitsEnemy(player, dir, range, width, enemy, mechanics) {
      const pcx = player.x + 8;
      const pcy = player.y + 8;
      const ecx = enemy.x + enemy.size / 2;
      const ecy = enemy.y + enemy.size / 2;
      const dx = ecx - pcx;
      const dy = ecy - pcy;
      if (!this.hasLineOfSight(mechanics, pcx, pcy, ecx, ecy)) return false;
      const forward = dx * dir.x + dy * dir.y;
      const lateral = Math.abs(-dx * dir.y + dy * dir.x);
      const radius = enemy.size / 2;
      return forward >= -radius
        && forward <= range + radius
        && lateral <= width / 2 + radius;
    }

    /**
     * 执行一次攻击。能量满时无视传入的 kind，统一释放能量炮（F/G 均可）。
     * @param {'light'|'heavy'} kind
     * @param {{x:number,y:number}} player 玩家 AABB 左上角
     * @param {object} [mechanics] engine.Mechanics（用于击退碰撞）
     * @returns {object|null} { kind, cannon, damage, range, dir, hits:[enemy], target, energy, energyFull }
     */
    attack(kind, player, mechanics) {
      if (this.down || !player || this.cooldown > 0) return null;
      const cannon = this.energy >= this.maxEnergy;
      const spec = cannon
        ? COMBAT_TUNING.cannon
        : (kind === 'heavy' ? COMBAT_TUNING.heavy : COMBAT_TUNING.light);
      const range = cannon ? this.cannonRange : this.attackRange;
      const width = spec.width;
      const target = this.findTarget(player, range, mechanics);
      const dir = this.aimDir(player, target); // 优先锁敌，无目标时沿移动朝向
      const origin = { x: player.x + 8, y: player.y + 8 };

      this.cooldown = spec.cooldown;
      this.swing = {
        kind: cannon ? 'cannon' : (kind === 'heavy' ? 'heavy' : 'light'),
        dir: dir, origin: origin, range: range, width: width,
        t: 0, duration: spec.active,
      };
      if (cannon) this.energy = Math.max(0, this.energy - COMBAT_TUNING.cannon.energyCost);

      const hits = [];
      let energyFull = false;
      for (let i = 0; i < this.enemies.length; i++) {
        const enemy = this.enemies[i];
        if (enemy.dead) continue;
        if (!this._hitsEnemy(player, dir, range, width, enemy, mechanics)) continue;
        enemy.hp -= spec.damage;
        enemy.hurt = 0.2;
        this._knockEnemy(enemy, dir, spec.knockback, mechanics);
        const dead = enemy.hp <= 0;
        if (dead) {
          enemy.hp = 0;
          enemy.dead = true;
        }
        const before = this.energy;
        // 能量炮消耗全部能量后不再从击杀回能（保证「释放后清空」可预期）
        if (!cannon) this.energy += dead ? COMBAT_TUNING.enemy.energyOnKill : spec.energyOnHit;
        this.energy = Math.min(this.maxEnergy, this.energy);
        if (before < this.maxEnergy && this.energy >= this.maxEnergy) energyFull = true;
        hits.push({ enemy: enemy, damage: spec.damage, dead: dead });
      }
      return {
        kind: this.swing.kind,
        cannon: cannon,
        damage: spec.damage,
        range: range,
        dir: dir,
        hits: hits,
        target: target ? target.id : null,
        energy: this.energy,
        energyFull: energyFull,
      };
    }

    /** 击退敌人：逐轴检查地形/门/箱子，避免被推出地图或穿墙 */
    _knockEnemy(enemy, dir, distance, mechanics) {
      if (!distance) return;
      const dx = dir.x * distance;
      const dy = dir.y * distance;
      if (!mechanics || !mechanics.blockedAt(enemy.x + dx, enemy.y, enemy.size)) enemy.x += dx;
      if (!mechanics || !mechanics.blockedAt(enemy.x, enemy.y + dy, enemy.size)) enemy.y += dy;
    }

    /** 敌人朝玩家移动（轴分离 + 地形碰撞），进入接触距离后停下 */
    _moveEnemy(enemy, dt, player, mechanics) {
      const pcx = player.x + 8;
      const pcy = player.y + 8;
      const ecx = enemy.x + enemy.size / 2;
      const ecy = enemy.y + enemy.size / 2;
      const dx = pcx - ecx;
      const dy = pcy - ecy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      enemy.moving = false;
      if (dist === 0 || dist > enemy.aggro) return;
      const stop = 11; // 玩家半宽 8 + 敌人半宽 6 - 3px 重叠，保证能接触
      const step = Math.min(enemy.speed * dt, Math.max(0, dist - stop));
      if (step <= 0) return;
      const vx = (dx / dist) * step;
      const vy = (dy / dist) * step;
      if (!mechanics || !mechanics.blockedAt(enemy.x + vx, enemy.y, enemy.size)) {
        enemy.x += vx;
        enemy.moving = true;
      }
      if (!mechanics || !mechanics.blockedAt(enemy.x, enemy.y + vy, enemy.size)) {
        enemy.y += vy;
        enemy.moving = true;
      }
    }

    _enemyTouchesPlayer(enemy, player) {
      return enemy.x < player.x + 16 && enemy.x + enemy.size > player.x
        && enemy.y < player.y + 16 && enemy.y + enemy.size > player.y;
    }

    /**
     * 每帧推进：冷却/无敌帧/被动充能/敌人 AI/接触伤害。
     * @returns {Array<object>} 事件：energy-full / player-hit / player-down
     */
    update(dt, player, mechanics) {
      const d = clamp(Number(dt) || 0, 0, 0.05);
      const events = [];
      this.time += d;
      if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - d);
      if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - d);
      if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - d);
      if (this.swing) {
        this.swing.t += d;
        if (this.swing.t >= this.swing.duration) this.swing = null;
      }

      // 能量炮演出期间暂停回能：保证「释放后清空」在当帧与 HUD 上都成立
      const charging = !this.swing || this.swing.kind !== 'cannon';
      if (!this.down && charging && this.energy < this.maxEnergy) {
        const before = this.energy;
        this.energy = Math.min(this.maxEnergy, this.energy + COMBAT_TUNING.energyRegen * d);
        if (before < this.maxEnergy && this.energy >= this.maxEnergy) events.push({ type: 'energy-full' });
      }
      if (this.down || !player) return events;

      for (let i = 0; i < this.enemies.length; i++) {
        const enemy = this.enemies[i];
        if (enemy.dead) continue;
        if (enemy.hurt > 0) enemy.hurt = Math.max(0, enemy.hurt - d);
        this._moveEnemy(enemy, d, player, mechanics);
        if (this.invuln <= 0 && this._enemyTouchesPlayer(enemy, player)) {
          const dx = (player.x + 8) - (enemy.x + enemy.size / 2);
          const dy = (player.y + 8) - (enemy.y + enemy.size / 2);
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          this.hp = Math.max(0, this.hp - enemy.damage);
          this.invuln = COMBAT_TUNING.invuln;
          this.hurtFlash = 0.25;
          events.push({
            type: 'player-hit',
            damage: enemy.damage,
            hp: this.hp,
            enemy: enemy,
            dir: { x: dx / len, y: dy / len },
            knockback: COMBAT_TUNING.playerKnockback,
          });
          if (this.hp <= 0) {
            this.down = true;
            events.push({ type: 'player-down' });
            break;
          }
        }
      }
      return events;
    }

    /** 倒下后复位：满血 + 无敌帧 + 敌人回到出生点（星星等进度不变） */
    revive() {
      this.hp = this.maxHp;
      this.down = false;
      this.cooldown = 0;
      this.swing = null;
      this.invuln = COMBAT_TUNING.respawnInvuln;
      this.hurtFlash = 0;
      this.resetEnemies();
      return this.hp;
    }

    /** 敌人复位（重开关卡 / 玩家倒下共用；能量与星星进度保留） */
    resetEnemies() {
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        e.x = e.spawnX;
        e.y = e.spawnY;
        e.hp = e.maxHp;
        e.dead = false;
        e.hurt = 0;
        e.moving = false;
      }
    }

    /** 存活敌人数量（测试/调试） */
    aliveCount() {
      let n = 0;
      for (let i = 0; i < this.enemies.length; i++) if (!this.enemies[i].dead) n++;
      return n;
    }
  }

  /* ════════════════════════ 输入系统（Issue #5） ════════════════════════ */

  /**
   * 键盘绑定：动作名 → 按键（e.key 小写）。
   * 方向键/WASD 移动、E/空格确认、Esc 暂停、M 静音；
   * Issue #18：F 轻击、G 重击（能量满时两者均释放能量炮）。
   */
  const KEY_BINDINGS = {
    up: ['arrowup', 'w'],
    down: ['arrowdown', 's'],
    left: ['arrowleft', 'a'],
    right: ['arrowright', 'd'],
    confirm: ['e', ' ', 'enter'],
    light: ['f'],
    heavy: ['g'],
    pause: ['escape'],
    mute: ['m'],
  };

  const ACTION_LIST = Object.keys(KEY_BINDINGS);

  /** 触屏按钮 data-key → 动作名（A 确认；B 轻击；C 重击；#18） */
  const TOUCH_ACTIONS = {
    up: 'up', down: 'down', left: 'left', right: 'right',
    action: 'confirm', light: 'light', heavy: 'heavy',
  };

  /** 粗指针（触屏）设备检测：pointer 媒体查询优先，触摸能力兜底 */
  function detectCoarsePointer() {
    if (typeof root.matchMedia === 'function') {
      try {
        if (root.matchMedia('(pointer: coarse)').matches) return true;
        if (root.matchMedia('(any-pointer: coarse)').matches) return true;
      } catch (e) { /* 媒体查询异常时走触摸能力兜底 */ }
    }
    if ('ontouchstart' in root) return true;
    const nav = root.navigator;
    return !!(nav && typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 0);
  }

  /**
   * 输入管理器：统一键盘与触屏虚拟按键，键盘/触屏双输入等价。
   *
   * 动作名（isDown / wasPressed / wasReleased / getAxis 使用）：
   *   up / down / left / right —— 移动（WASD 或方向键，或虚拟十字键）
   *   confirm —— E / 空格 / Enter / 触屏 A 键
   *   pause   —— Esc
   *   mute    —— M
   *
   * 用法（游戏循环内轮询，每帧结束调用 endFrame 清空边沿缓冲）：
   *   const input = engine.createInput();
   *   const axis = input.getAxis();
   *   if (input.wasPressed('confirm')) { … }
   *   input.endFrame();
   * 也可订阅边沿事件：input.on('press', action => …) / input.on('release', …)。
   * main.js（#6）可用 setEnabled(false) 在对话/暂停时冻结输入，
   * setTouchVisible(false) 在菜单界面隐藏虚拟按键。
   */
  class Input {
    constructor(opts) {
      opts = opts || {};
      this.target = opts.target || root;
      this.enabled = true;
      this.coarse = detectCoarsePointer();       // 当前设备是否为触屏（粗指针）
      this.touchMode = 'auto';                   // 虚拟按键显示偏好（#44）：'auto'|'on'|'off'
      this._keys = new Set();                    // 当前按住的物理键（小写 e.key）
      this._touchPtr = new Map();                // 动作 → 按住的 pointerId 集合
      this._pressed = new Set();                 // 自上次 endFrame 以来的按下边沿
      this._released = new Set();                // 自上次 endFrame 以来的松开边沿
      this._subs = { press: [], release: [] };
      this._touchHandlers = [];                  // [element, type, fn] 三元组，供解绑
      this._touchButtons = [];                   // 已绑定虚拟按键元素，供 _clearAll/destroy 清除 pressed 样式
      this._bound = {
        keydown: (e) => this._onKey(e, true),
        keyup: (e) => this._onKey(e, false),
        blur: () => this._clearAll(),
        visibility: () => {
          if (typeof document !== 'undefined' && document.hidden) this._clearAll();
        },
      };
      if (typeof this.target.addEventListener === 'function') {
        this.target.addEventListener('keydown', this._bound.keydown);
        this.target.addEventListener('keyup', this._bound.keyup);
        this.target.addEventListener('blur', this._bound.blur);
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', this._bound.visibility);
        }
      }
      if (opts.autoTouch !== false) this._setupTouch();
      this._applyTouchMode(); // #44：恢复「触屏按键」显示偏好（auto/on/off）
    }

    /* ── 状态查询 ── */

    /** 动作当前是否被按住（键盘或触屏任一来源） */
    isDown(action) {
      if (!this.enabled) return false;
      const keys = KEY_BINDINGS[action];
      if (keys) {
        for (let i = 0; i < keys.length; i++) {
          if (this._keys.has(keys[i])) return true;
        }
      }
      const ptr = this._touchPtr.get(action);
      return !!ptr && ptr.size > 0;
    }

    /** 自上次 endFrame 以来是否发生按下边沿 */
    wasPressed(action) {
      return this.enabled && this._pressed.has(action);
    }

    /** 自上次 endFrame 以来是否发生松开边沿 */
    wasReleased(action) {
      return this.enabled && this._released.has(action);
    }

    /** 移动轴向量 { x, y } ∈ {-1,0,1}（右/下为正，不做对角归一化） */
    getAxis() {
      if (!this.enabled) return { x: 0, y: 0 };
      return {
        x: (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0),
        y: (this.isDown('down') ? 1 : 0) - (this.isDown('up') ? 1 : 0),
      };
    }

    /** 帧尾调用：清空按下/松开边沿缓冲 */
    endFrame() {
      this._pressed.clear();
      this._released.clear();
    }

    /* ── 事件订阅 ── */

    /** 订阅边沿事件：'press' | 'release'，回调收到动作名 */
    on(event, fn) {
      if (this._subs[event] && typeof fn === 'function') this._subs[event].push(fn);
      return this;
    }

    /** 退订边沿事件 */
    off(event, fn) {
      const list = this._subs[event];
      if (list) {
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      }
      return this;
    }

    /* ── 控制 ── */

    /** 全局输入开关：禁用时清空已按住的键/触屏并忽略新输入（对话/暂停期间使用） */
    setEnabled(v) {
      this.enabled = !!v;
      if (!this.enabled) {
        this._pressed.clear();
        this._released.clear();
        this._clearAll();
      }
    }

    /**
     * 显示/隐藏虚拟按键（main.js 在菜单/对话界面控制）。
     * 隐藏通过给 #touch-controls 加 .touch-off 实现，不改变设备检测结果。
     */
    setTouchVisible(v) {
      const el = this._touchEl();
      if (el && el.classList) el.classList.toggle('touch-off', !v);
    }

    /**
     * 设置虚拟按键显示偏好（Issue #44）：'auto' 跟随设备粗指针检测；'on' 始终显示；
     * 'off' 始终隐藏。与 setTouchVisible 正交——菜单界面仍可用 setTouchVisible(false)
     * 临时隐藏，不会覆盖玩家偏好；非法值回退 'auto'。
     * @param {'auto'|'on'|'off'} mode
     * @returns {string} 实际生效的模式
     */
    setTouchMode(mode) {
      this.touchMode = mode === 'on' || mode === 'off' ? mode : 'auto';
      this._applyTouchMode();
      return this.touchMode;
    }

    /** 当前虚拟按键显示偏好（'auto'|'on'|'off'） */
    getTouchMode() {
      return this.touchMode;
    }

    /** 把偏好落到 #touch-controls 的 .touch-pref-on / .touch-pref-off 类 */
    _applyTouchMode() {
      const el = this._touchEl();
      if (!el || !el.classList) return;
      el.classList.toggle('touch-pref-on', this.touchMode === 'on');
      el.classList.toggle('touch-pref-off', this.touchMode === 'off');
    }

    /** 解绑全部监听，释放后不再产生任何输入 */
    destroy() {
      const t = this.target;
      if (typeof t.removeEventListener === 'function') {
        t.removeEventListener('keydown', this._bound.keydown);
        t.removeEventListener('keyup', this._bound.keyup);
        t.removeEventListener('blur', this._bound.blur);
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', this._bound.visibility);
      }
      for (let i = 0; i < this._touchHandlers.length; i++) {
        const el = this._touchHandlers[i][0];
        const type = this._touchHandlers[i][1];
        const fn = this._touchHandlers[i][2];
        if (typeof el.removeEventListener === 'function') el.removeEventListener(type, fn);
      }
      this._touchHandlers = [];
      for (let i = 0; i < this._touchButtons.length; i++) {
        const btn = this._touchButtons[i];
        if (btn && btn.classList) btn.classList.remove('pressed');
      }
      this._touchButtons = [];
      // #44：销毁时清掉虚拟按键的偏好类（复用同一 DOM 时不残留）
      const touchEl = this._touchEl();
      if (touchEl && touchEl.classList) {
        touchEl.classList.remove('touch-pref-on');
        touchEl.classList.remove('touch-pref-off');
        touchEl.classList.remove('touch-on');
      }
      this._keys.clear();
      this._touchPtr.clear();
      this._pressed.clear();
      this._released.clear();
      this._subs.press = [];
      this._subs.release = [];
    }

    /* ── 内部：键盘 ── */

    /** 键盘事件入口：keydown 记录按键并产生按下边沿，keyup 释放并产生松开边沿 */
    _onKey(e, down) {
      if (!this.enabled) return;
      // 带修饰键的组合（Ctrl/⌘/Alt+键，如 Ctrl+W 关标签页）仅在按下时过滤：
      // keyup 不过滤，保证按住期间再按修饰键也能正常释放，避免按键卡死
      if (down && (e.ctrlKey || e.metaKey || e.altKey)) return;
      const key = String(e.key == null ? '' : e.key).toLowerCase();
      const action = this._actionForKey(key);
      if (!action) return;
      if (down) {
        // 先于 repeat 判断调用：长按自动重复事件同样要阻止方向键/空格滚动页面
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (e.repeat) return; // 长按自动重复不产生按下边沿
        const held = this.isDown(action);
        this._keys.add(key);
        if (!held) this._pressEdge(action);
      } else {
        if (!this._keys.delete(key)) return; // 从未按住的键不产生虚假 release
        if (!this.isDown(action)) this._releaseEdge(action);
      }
    }

    /** 物理键（小写 e.key）→ 动作名；未绑定返回 null */
    _actionForKey(key) {
      for (let i = 0; i < ACTION_LIST.length; i++) {
        const action = ACTION_LIST[i];
        if (KEY_BINDINGS[action].indexOf(key) >= 0) return action;
      }
      return null;
    }

    /* ── 内部：触屏虚拟按键 ── */

    /** 绑定虚拟按键的指针事件（pointerdown/up/cancel/lostpointercapture/contextmenu） */
    _setupTouch() {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
      const buttons = Array.prototype.slice.call(document.querySelectorAll('[data-key]'));
      if (this.coarse) this._syncTouchClass(true);
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        const action = TOUCH_ACTIONS[btn.getAttribute('data-key')];
        if (!action) continue;
        this._touchButtons.push(btn); // 供 _clearAll/destroy 清理 pressed 样式
        const pointerIdOf = (e) => (typeof e.pointerId === 'number' ? e.pointerId : -1);
        const down = (e) => {
          if (typeof e.preventDefault === 'function') e.preventDefault(); // 防聚焦/合成点击
          if (typeof btn.setPointerCapture === 'function' && typeof e.pointerId === 'number') {
            try { btn.setPointerCapture(e.pointerId); } catch (err) { /* 桩环境忽略 */ }
          }
          this._touchDown(action, pointerIdOf(e), btn);
        };
        const up = (e) => this._touchUp(action, pointerIdOf(e), btn);
        const menu = (e) => {
          if (typeof e.preventDefault === 'function') e.preventDefault(); // 禁长按菜单
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('lostpointercapture', up);
        btn.addEventListener('contextmenu', menu);
        this._touchHandlers.push(
          [btn, 'pointerdown', down],
          [btn, 'pointerup', up],
          [btn, 'pointercancel', up],
          [btn, 'lostpointercapture', up],
          [btn, 'contextmenu', menu]
        );
      }
    }

    /** 虚拟按键按下：记录 pointerId、产生按下边沿并添加 pressed 样式 */
    _touchDown(action, pointerId, btn) {
      if (!this.enabled) return;
      const held = this.isDown(action);
      let ids = this._touchPtr.get(action);
      if (!ids) this._touchPtr.set(action, ids = new Set());
      ids.add(pointerId);
      if (btn && btn.classList) btn.classList.add('pressed');
      if (!held) this._pressEdge(action);
    }

    /** 虚拟按键松开：移除该 pointerId，全部抬起后产生松开边沿并移除 pressed 样式 */
    _touchUp(action, pointerId, btn) {
      const ids = this._touchPtr.get(action);
      if (!ids || !ids.delete(pointerId)) return;
      if (ids.size === 0) {
        this._touchPtr.delete(action);
        if (btn && btn.classList) btn.classList.remove('pressed');
      }
      if (!this.isDown(action)) this._releaseEdge(action);
    }

    /** 按粗指针检测结果切换 #touch-controls 的 .touch-on 类 */
    _syncTouchClass(on) {
      const el = this._touchEl();
      if (el && el.classList) el.classList.toggle('touch-on', on);
    }

    /** 返回 #touch-controls 元素；非浏览器/桩环境返回 null */
    _touchEl() {
      return (typeof document !== 'undefined' && typeof document.getElementById === 'function')
        ? document.getElementById('touch-controls') : null;
    }

    /* ── 内部：边沿与清理 ── */

    /** 记录按下边沿并通知 press 订阅者 */
    _pressEdge(action) {
      this._pressed.add(action);
      this._emit('press', action);
    }

    /** 记录松开边沿并通知 release 订阅者 */
    _releaseEdge(action) {
      this._released.add(action);
      this._emit('release', action);
    }

    /** 向订阅者分发边沿事件；单个回调异常不阻断其余分发 */
    _emit(event, action) {
      const subs = this._subs[event];
      for (let i = 0; i < subs.length; i++) {
        try { subs[i](action); } catch (err) { warnOnce('input ' + event + ' 订阅回调异常: ' + err.message); }
      }
    }

    /** 失焦/切后台时清空全部按住状态，避免按键卡死 */
    _clearAll() {
      const held = [];
      for (let i = 0; i < ACTION_LIST.length; i++) {
        if (this.isDown(ACTION_LIST[i])) held.push(ACTION_LIST[i]);
      }
      this._keys.clear();
      this._touchPtr.clear();
      // 同步移除虚拟按键的 pressed 样式，避免视觉状态卡住
      for (let i = 0; i < this._touchButtons.length; i++) {
        const btn = this._touchButtons[i];
        if (btn && btn.classList) btn.classList.remove('pressed');
      }
      for (let i = 0; i < held.length; i++) this._releaseEdge(held[i]);
    }
  }

  /* ════════════════════════ 演示模式（data.js / main.js 就位前） ════════════════════════ */

  const DEMO_LEVEL = buildDemoLevel();

  /** 构建演示关卡：边界墙 + 梦幻湖等静态地形（data.js 就位前的占位内容） */
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

  /**
   * 演示驱动：统一走输入系统（Issue #5）——方向键/WASD 移动、E/空格/A 确认、
   * Esc 暂停、M 静音，触屏设备显示虚拟十字键与 A 键。
   * 验证摄像机跟随与边界钳制（碰撞为演示简化版，#9 接手）。
   */
  function bootDemo(canvas) {
    const renderer = new Renderer(canvas);
    const camera = new Camera();
    const level = DEMO_LEVEL;
    const solid = { '#': true, '~': true };
    const player = { x: 2 * TILE + 2, y: 2 * TILE + 2 };
    const input = engine.createInput(); // 输入系统（键盘 + 触屏虚拟按键）
    const SPEED = 80; // px/s
    let paused = false; // Esc 暂停（正式暂停菜单由 #6 接管）
    let muted = false;  // M 静音（音频落地 #14 后由 audio.js 接管）
    let flash = 0;      // 确认键演示闪光（剩余秒数）

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

      if (input.wasPressed('pause')) paused = !paused;
      if (input.wasPressed('mute')) muted = !muted;
      if (input.wasPressed('confirm')) flash = 0.6;

      if (!paused) {
        // 分轴移动：撞墙该轴回退，另一轴可滑动
        const axis = input.getAxis();
        if (axis.x) {
          const nx = player.x + axis.x * SPEED * dt;
          if (!blockedAt(nx, player.y)) player.x = nx;
        }
        if (axis.y) {
          const ny = player.y + axis.y * SPEED * dt;
          if (!blockedAt(player.x, ny)) player.y = ny;
        }
        camera.follow(player.x + 8, player.y + 8, level.map.w * TILE, level.map.h * TILE);
      }
      if (flash > 0) flash -= dt;
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

      // HUD 提示条：第一行标题，第二行绑定说明 + 当前状态
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, VIEW_W, 24);
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.font = '8px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText('ENGINE DEMO · ' + level.title, 4, 3);
      ctx.fillStyle = 'rgb(255,200,87)';
      ctx.fillText(
        'WASD/方向键移动 · E/空格确认 · M静音 ' + (muted ? '♪关' : '♪开') + ' · Esc暂停'
        + (input.coarse ? ' · 触屏十字键+A' : ''),
        4, 14
      );

      // 暂停遮罩
      if (paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.fillStyle = 'rgb(255,255,255)';
        ctx.font = '16px monospace';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText('已暂停', VIEW_W / 2, VIEW_H / 2 - 8);
        ctx.font = '8px monospace';
        ctx.fillText('Esc 继续', VIEW_W / 2, VIEW_H / 2 + 8);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'top';
      }

      // 确认键闪光
      if (flash > 0) {
        ctx.fillStyle = 'rgb(255,255,255)';
        ctx.font = '8px monospace';
        ctx.fillText('确认 ✓', 4, VIEW_H - 14);
      }

      input.endFrame();

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

  /* ════════════════════════ 公开 API ════════════════════════ */

  const engine = {
    VERSION: '0.5.0',
    TILE: TILE,
    VIEW_W: VIEW_W,
    VIEW_H: VIEW_H,
    VIEW_COLS: VIEW_COLS,
    VIEW_ROWS: VIEW_ROWS,
    TEMPLATE_HEX: TEMPLATE_HEX,
    Camera: Camera,
    Renderer: Renderer,
    Input: Input,
    Particles: Particles,
    Mechanics: Mechanics,
    Combat: Combat,
    COMBAT_TUNING: COMBAT_TUNING,
    createRenderer: (canvas, opts) => new Renderer(canvas, opts),
    createCamera: () => new Camera(),
    createInput: (opts) => new Input(opts),
    createParticles: (opts) => new Particles(opts),
    createMechanics: (level) => new Mechanics(level),
    createCombat: (level, opts) => new Combat(level, opts),
    KEY_BINDINGS: KEY_BINDINGS,
    detectCoarsePointer: detectCoarsePointer,
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

  // 自动演示：仅在浏览器环境、且 data.js/main.js 未接管时运行。
  // 置于公开 API 之后，保证 bootDemo 引用的 engine 已初始化。
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
})(typeof window !== 'undefined' ? window : globalThis);
