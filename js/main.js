/**
 * js/main.js —— 游戏状态机与 UI 接线（Issue #6）+ 对话系统（Issue #7）
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
 * 对话节点语义（Issue #12，规格 GAME_DESIGN.md §7）：
 *   - 节点字段 type / trigger / once / entry / scopeId / lines / options / next；
 *   - NPC 互动解析：首次 intro（once）→ 同 trigger 的 npc 自我介绍（once）→
 *     intro.next 指向的 hint（repeat）→ check（repeat）；
 *   - 选项列表（check 节点）：↑↓ 移动、E 确认 → goto 分支节点；
 *   - 自动事件分发：收集星 → star:<星id>；过关 → clear:<关卡id>（播完才进结算）；
 *     关卡加载 → load:<关卡id>；黑羊互动 → sheep 计数 +1（会话内，存档见 #8）；
 *   - once 标记会话内记忆（this._playedNodes），Issue #8 存档落地后持久化。
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
 * 当前 data.js 为空，内置「占位关卡 ×2」兜底（复用引擎演示地形），
 * 保证六态全部可达、可往返验证。占位实现（碰撞/收集/传送门/角色绘制）
 * 由后续 Issue 接管：#9 机制、#13 美术、#15 演出（#7 对话已实现）。
 *
 * 启用方式：index.html 在 engine.js 之后加载本文件；本文件立即设置
 * MIXX_NO_DEMO = true 停用引擎演示模式，并在 DOMContentLoaded 后自启动。
 * 测试/冒烟页面可设 MIXX_NO_BOOT = true 阻止自启动，手动 new Game()。
 */
'use strict';

(function (root) {
  'use strict';

  root.MIXX_NO_DEMO = true; // 停用引擎演示模式，本文件接管游戏循环

  const engine = root.MIXX && root.MIXX.engine;
  if (!engine) {
    throw new Error('MIXX.main: 未找到 MIXX.engine，请确认 js/engine.js 先于本文件加载');
  }

  const TILE = engine.TILE;
  const VIEW_W = engine.VIEW_W;
  const VIEW_H = engine.VIEW_H;
  const PLAYER_SIZE = 16;      // 玩家碰撞盒边长（px，#9 前与引擎演示一致的占位碰撞）
  const MOVE_SPEED = 80;       // px/s
  const INTERACT_RANGE = 24;   // 互动距离（px，#9 接管后细化）
  const SOLID_TILES = { '#': true, '~': true }; // 占位碰撞：墙与水不可通行（#9 接管）

  /* 说话人头像位（Issue #28）：素材规范见 assets/characters/README.md */
  const PORTRAIT_BASE = 'assets/characters/';
  const PORTRAIT_NO_ART = { nar: true, all: true }; // 伪说话人无立绘（GAME_DESIGN §3）

  /* HUD 带：位于游戏画面上方（styles.css #stage 竖排），渲染器缩放时
     预留这 24px 高度，保证 HUD 与画布整体不超出窗口、HUD 不压进游戏画面 */
  const HUD_RESERVE = 24;

  // ── 对话系统（Issue #7，规格 GAME_DESIGN.md §7）──
  const DIALOG_MS = 25;           // 打字机逐字间隔（25ms/字）
  const DIALOG_FAST_MS = 6;       // 按住互动键加速打字间隔（快进）
  const DIALOG_TAP_MS = 250;      // 按住时长阈值：短于此的「点按」→ 立即显示本行全文
  const DIALOG_HINT_TYPING = '▸▸ 快进';   // 打字中的提示
  const DIALOG_HINT_PAGE = '▼ E / 空格'; // 本行显示完、等待翻页的提示

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
   * 以最小组件（出生点/星星/NPC/传送门）驱动六态状态机往返验收。
   * Issue #11 地图数据落地后由 window.GAME 取代，本函数整体移除。
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
          { type: 'portal', x: 38, y: 10 },
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
          { type: 'portal', x: 38, y: 10 },
        ],
      },
    ];
  }

  /** 读 data.js 的 GAME（已就位则采用），否则回退占位数据 */
  function loadData(root) {
    const g = root.GAME;
    if (g && Array.isArray(g.levels) && g.levels.length > 0) {
      return {
        levels: g.levels,
        characters: Object.assign({}, BOOT_CHARACTERS, g.characters || {}),
        dialogue: Object.assign({}, BOOT_DIALOGUE, g.dialogue || {}),
        source: 'data',
      };
    }
    return {
      levels: buildBootLevels(),
      characters: BOOT_CHARACTERS,
      dialogue: BOOT_DIALOGUE,
      source: 'boot',
    };
  }

  /** 秒 → 'm:ss'（结算用时展示） */
  function formatTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  /* ════════════════════════ 游戏主类 ════════════════════════ */

  class Game {
    /**
     * @param {HTMLCanvasElement} canvas  #game
     * @param {object} [opts]  { doc, root, onEvent }
     *   onEvent(name, data)：测试/冒烟钩子，'state' | 'collect' | 'clear' | 'restart'
     */
    constructor(canvas, opts) {
      opts = opts || {};
      this.doc = opts.doc || (typeof document !== 'undefined' ? document : null);
      this.root = opts.root || root;
      this.onEvent = opts.onEvent || null;

      this.canvas = canvas;
      this.renderer = engine.createRenderer(canvas, { hudReserve: HUD_RESERVE });
      this.camera = engine.createCamera();
      this.input = engine.createInput();

      const data = loadData(this.root);
      this.levels = data.levels;
      this.characters = data.characters;
      this.dialogue = data.dialogue;
      this.dataSource = data.source;

      // 运行态（可在测试中直接读取）
      this.state = null;
      this.levelIndex = 0;
      this.level = null;       // 当前关数据（实体层为运行时克隆）
      this.player = null;      // { x, y } 世界坐标（px，左上角）
      this.stars = 0;          // 本关已收集星数
      this.collected = [];     // 本关已收集星 id（运行时记录）
      this.runTime = 0;        // 本关用时（秒，仅 PLAYING 累计）
      this.soundOn = true;     // #14 音频落地前仅驱动按钮文案
      this._dialog = null;     // 对话进行态 { lines, idx, shown, t, typing, holdTyping, holdTime }，离开对话态即清空
      this._playedNodes = new Set(); // 已播放过的 once 节点（会话内记忆；Issue #8 存档落地后持久化）
      this._npcTarget = {};   // npc:<实体id> → 开场 intro 结束后指向的后续节点（hint）
      this.sheepCount = 0;    // 黑羊彩蛋计数 0–6（会话内；存档见 #8）
      this._pendingNextIsEnding = false; // 结算按钮指向结局（最后一关）
      this._portraitSrc = null;          // 头像当前 src 缓存（避免重复赋值导致闪动）
      this._failedPortraits = new Set(); // 加载失败的路径，后续渲染保持隐藏

      this._last = 0;          // 上一帧时间戳（ms）
      this._raf = null;        // rAF 句柄，防重复启动
      this._running = false;   // start() 后为 true，stop()/destroy() 停
      this._ui = {};           // id → DOM 元素缓存
      this._uiHandlers = [];   // [el, type, fn] 三元组，供 destroy 解绑

      this._cacheUI();
      this._bindUI();
      this._setState(STATE.TITLE);
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
      const prev = this.state;
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
          break;
        case STATE.PAUSED:
          this._show(this._ui.pauseScreen);
          this._hide(this._ui.hud);
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
          this._clearDialog();
          this._dialog = null;
          break;
        case STATE.PAUSED:
          this._hide(this._ui.pauseScreen);
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
      if (this.input.wasPressed('mute')) this._toggleSound();
    }

    _updatePlaying(dt) {
      if (this.input.wasPressed('pause')) { this._setState(STATE.PAUSED); return; }
      if (this.input.wasPressed('confirm') && this._interact()) return; // 进入对话
      const axis = this.input.getAxis();
      if (axis.x) {
        const nx = this.player.x + axis.x * MOVE_SPEED * dt;
        if (!this._blockedAt(nx, this.player.y)) this.player.x = nx;
      }
      if (axis.y) {
        const ny = this.player.y + axis.y * MOVE_SPEED * dt;
        if (!this._blockedAt(this.player.x, ny)) this.player.y = ny;
      }
      this.camera.follow(
        this.player.x + PLAYER_SIZE / 2,
        this.player.y + PLAYER_SIZE / 2,
        this.level.map.w * TILE,
        this.level.map.h * TILE
      );
      this._checkPickups();
      if (this.state !== STATE.PLAYING) return; // 收集触发台词进入对话，本帧不再推进
      this._checkPortal();
      if (this.state !== STATE.PLAYING) return; // 过关台词进入对话，本帧不再计时
      this.runTime += dt;
    }

    /* ── 占位机制（#9 接管前的最小实现） ── */

    /** 玩家 AABB 四角所在瓦片是否实心（占位碰撞，#9 提供正式碰撞与实体阻挡） */
    _blockedAt(px, py) {
      const map = this.level.map;
      const x0 = Math.floor(px / TILE);
      const x1 = Math.floor((px + PLAYER_SIZE - 1) / TILE);
      const y0 = Math.floor(py / TILE);
      const y1 = Math.floor((py + PLAYER_SIZE - 1) / TILE);
      for (let ty = y0; ty <= y1; ty++) {
        const row = map.rows[ty];
        for (let tx = x0; tx <= x1; tx++) {
          if (SOLID_TILES[row && row[tx]]) return true;
        }
      }
      return false;
    }

    /** 附近是否有可互动实体（NPC / 黑羊；#9 扩展开关/门/传送门等） */
    _nearInteractable() {
      const cx = this.player.x + PLAYER_SIZE / 2;
      const cy = this.player.y + PLAYER_SIZE / 2;
      for (const type of ['npc', 'sheep']) {
        for (const e of this._entitiesOf(type)) {
          const ex = e.x * TILE + TILE / 2;
          const ey = e.y * TILE + TILE / 2;
          if (Math.abs(cx - ex) <= INTERACT_RANGE && Math.abs(cy - ey) <= INTERACT_RANGE) return e;
        }
      }
      return null;
    }

    /** 确认键互动：NPC → 对话；黑羊 → 彩蛋谜语（首次计数 sheep +1）。返回是否触发了状态切换 */
    _interact() {
      if (!this.player) return false;
      const ent = this._nearInteractable();
      if (!ent) return false;
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

    /** 收集星星（#9 接入正式收集与反馈演出；star:<星id> 台词由 #12 分发） */
    _checkPickups() {
      const px = this.player.x;
      const py = this.player.y;
      for (const e of this._entitiesOf('star')) {
        if (e.collected) continue;
        const rx = e.x * TILE;
        const ry = e.y * TILE;
        if (px < rx + TILE && px + PLAYER_SIZE > rx && py < ry + TILE && py + PLAYER_SIZE > ry) {
          e.collected = true;
          this.collected.push(e.id);
          this.stars++;
          this._refreshHud();
          if (this.onEvent) {
            try { this.onEvent('collect', { id: e.id, stars: this.stars }); } catch (err) { /* 忽略钩子异常 */ }
          }
          // 收集反馈台词（once）：进入对话则本帧停止继续收集，避免连吞台词
          if (this._dispatchAuto('star:' + e.id)) return;
        }
      }
    }

    /** 集齐星星后接触传送门 → 先播过关台词（clear:<关卡id>，once），播完进入结算 */
    _checkPortal() {
      if (this.stars < this._starCount()) return;
      const px = this.player.x;
      const py = this.player.y;
      for (const e of this._entitiesOf('portal')) {
        const rx = e.x * TILE;
        const ry = e.y * TILE;
        if (px < rx + TILE && px + PLAYER_SIZE > rx && py < ry + TILE && py + PLAYER_SIZE > ry) {
          this._dispatchAuto('clear:' + this.level.id, () => this._onLevelClear());
          return;
        }
      }
    }

    /* ── 关卡生命周期 ── */

    _startNewGame() {
      if (this.state !== STATE.TITLE) return; // 仅标题界面可开始新游戏
      this.levelIndex = 0;
      this._loadLevel(0);
    }

    /**
     * 加载关卡：浅克隆关卡与实体层（data.js 数据只读，运行时标记不落回共享数据），
     * 重置玩家/星数/计时/相机后进入 PLAYING。重玩与过关共用此入口。
     */
    _loadLevel(i) {
      const lv = this.levels[i];
      if (!lv) return;
      this.levelIndex = i;
      this.level = Object.assign({}, lv, {
        entities: (lv.entities || []).map((e) => Object.assign({}, e)),
      });
      const spawn = this._entitiesOf('spawn')[0] || { x: 2, y: 2 };
      this.player = { x: spawn.x * TILE, y: spawn.y * TILE };
      this.stars = 0;
      this.collected = [];
      this.runTime = 0;
      this._dialog = null;
      this.camera.x = 0;
      this.camera.y = 0;
      this.camera.follow(
        this.player.x + PLAYER_SIZE / 2,
        this.player.y + PLAYER_SIZE / 2,
        this.level.map.w * TILE,
        this.level.map.h * TILE
      );
      this._refreshHud();
      this._setState(STATE.PLAYING);
      if (this.onEvent) {
        try { this.onEvent('restart', { level: this.levelIndex }); } catch (e) { /* 忽略钩子异常 */ }
      }
      // 关卡加载自动演出（load:<关卡id>；序章 p0 等场景在 #11 场景系统落地后同机制接入）
      this._dispatchAuto('load:' + this.level.id);
    }

    _restartLevel() {
      if (this.state !== STATE.PAUSED) return;
      this._loadLevel(this.levelIndex);
    }

    _quitToTitle() {
      if (this.state !== STATE.PAUSED && this.state !== STATE.ENDING) return;
      this.level = null;
      this.player = null;
      this.stars = 0;
      this.collected = [];
      this.runTime = 0;
      this._dialog = null;
      this.levelIndex = 0;
      this._setState(STATE.TITLE);
    }

    /* ── 结算与结局 ── */

    _onLevelClear() {
      const lv = this.level;
      const starCount = this._starCount();
      this._text(
        this._ui.clearText,
        '星星 ' + this.stars + '/' + starCount + ' · 用时 ' + formatTime(this.runTime)
      );
      const isLast = this.levelIndex >= this.levels.length - 1;
      this._pendingNextIsEnding = isLast;
      this._text(this._ui.btnNext, isLast ? '▶ 见证结局' : '▶ 下一关');
      this._setState(STATE.CLEAR);
      if (this.onEvent) {
        try {
          this.onEvent('clear', { level: lv.id, stars: this.stars, starCount: starCount });
        } catch (e) { /* 忽略钩子异常 */ }
      }
    }

    _nextFromClear() {
      if (this.state !== STATE.CLEAR) return;
      if (this._pendingNextIsEnding) {
        this._enterEnding();
      } else {
        this._loadLevel(this.levelIndex + 1);
      }
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
      const node = this.dialogue[nodeId];
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
    _resolveNpcNode(ent) {
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
      const cands = [];
      for (const id in this.dialogue) {
        const n = this.dialogue[id];
        if (n.trigger === key && !n.entry) cands.push({ id: id, node: n });
      }
      const unplayed = (type) => {
        for (const c of cands) {
          if (c.node.type === type && c.node.once && !this._playedNodes.has(c.id)) return c;
        }
        return null;
      };
      const target = this._npcTarget[ent.id];
      if (target && this.dialogue[target]) {
        // intro 已播：先补播未播的同 trigger npc 自我介绍（once），再回到 hint
        const npcOnce = unplayed('npc');
        if (npcOnce) return npcOnce.id;
        return target;
      }
      const intro = unplayed('intro');
      if (intro) {
        if (intro.node.next) this._npcTarget[ent.id] = intro.node.next;
        return intro.id;
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
      this._setPortrait(line.s); // 说话人头像位（Issue #28）
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

    _refreshHud() {
      if (!this.level) return;
      this._text(this._ui.hudLevel, this.level.title);
      this._text(this._ui.hudShards, '★ ' + this.stars + '/' + this._starCount());
      // 注：关 6 总进度「★ x/25」等 HUD 扩展随 #9/#11 接入
    }

    /* ── 工具 ── */

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
      this._text(this._ui.btnSound, this.soundOn ? '♪ 声音：开' : '♪ 声音：关');
      // #14 音频落地后接入 MIXX.audio
    }

    _show(el) { if (el && el.classList) el.classList.remove('hidden'); }
    _hide(el) { if (el && el.classList) el.classList.add('hidden'); }
    _text(el, v) { if (el) el.textContent = v; }

    _hideAllScreens() {
      this._hide(this._ui.titleScreen);
      this._hide(this._ui.helpScreen);
      this._hide(this._ui.levelScreen);
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
        'title-screen': 'titleScreen',
        'btn-start': 'btnStart',
        'btn-continue': 'btnContinue',
        'btn-levels': 'btnLevels',
        'btn-help': 'btnHelp',
        'btn-sound': 'btnSound',
        'level-screen': 'levelScreen',
        'level-grid': 'levelGrid',
        'btn-back': 'btnBack',
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
        'clear-screen': 'clearScreen',
        'clear-text': 'clearText',
        'btn-next': 'btnNext',
        'ending-screen': 'endingScreen',
        'ending-body': 'endingBody',
        'btn-ending': 'btnEnding',
      };
      const doc = this.doc;
      const get = doc && typeof doc.getElementById === 'function'
        ? doc.getElementById.bind(doc) : null;
      for (const id of Object.keys(aliases)) {
        this._ui[aliases[id]] = get ? get(id) : null;
      }
    }

    _bindUI() {
      const ui = this._ui;
      this._on(ui.btnStart, 'click', () => this._startNewGame());
      // btn-continue：存档系统（#8）落地后接线，当前恒隐藏
      // btn-levels / level-screen：选关界面（#10）落地后接线
      this._on(ui.btnHelp, 'click', () => {
        if (this.state === STATE.TITLE) this._show(ui.helpScreen);
      });
      this._on(ui.btnHelpBack, 'click', () => {
        if (this.state === STATE.TITLE) this._hide(ui.helpScreen);
      });
      this._on(ui.btnSound, 'click', () => this._toggleSound());
      this._on(ui.btnResume, 'click', () => {
        if (this.state === STATE.PAUSED) this._setState(STATE.PLAYING);
      });
      this._on(ui.btnRestart, 'click', () => this._restartLevel());
      this._on(ui.btnQuit, 'click', () => this._quitToTitle());
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
      if (!this.level || this.state === STATE.TITLE || this.state === STATE.ENDING) {
        ctx.fillStyle = 'rgb(11,11,30)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        return;
      }
      this.renderer.renderLevel(this.level, this.camera);
      this._drawEntities();
      this._drawPlayer();
    }

    /** 占位实体绘制：仅用 fillRect（兼容测试桩与后续替换） */
    _drawEntities() {
      const ctx = this.renderer.ctx;
      const camX = this.camera.x;
      const camY = this.camera.y;
      for (const e of this.level.entities || []) {
        const sx = Math.round(e.x * TILE - camX);
        const sy = Math.round(e.y * TILE - camY);
        if (sx < -TILE || sy < -TILE || sx > VIEW_W || sy > VIEW_H) continue;
        switch (e.type) {
          case 'star': {
            if (e.collected) continue;
            ctx.fillStyle = 'rgb(255,200,87)';
            ctx.fillRect(sx + 8, sy + 4, 1, 1);
            ctx.fillRect(sx + 7, sy + 5, 3, 1);
            ctx.fillRect(sx + 6, sy + 6, 5, 1);
            ctx.fillRect(sx + 7, sy + 7, 3, 1);
            ctx.fillRect(sx + 8, sy + 8, 1, 1);
            break;
          }
          case 'npc': {
            ctx.fillStyle = 'rgb(255,143,163)';
            ctx.fillRect(sx + 2, sy + 2, 12, 12);
            ctx.fillStyle = 'rgb(255,255,255)';
            ctx.fillRect(sx + 5, sy + 6, 2, 2);
            ctx.fillRect(sx + 9, sy + 6, 2, 2);
            break;
          }
          case 'portal': {
            const active = this.stars >= this._starCount();
            ctx.fillStyle = active ? 'rgb(255,200,87)' : 'rgb(110,100,140)';
            ctx.fillRect(sx, sy, 16, 2);
            ctx.fillRect(sx, sy + 14, 16, 2);
            ctx.fillRect(sx, sy, 2, 16);
            ctx.fillRect(sx + 14, sy, 2, 16);
            ctx.fillStyle = active ? 'rgb(255,143,163)' : 'rgb(60,55,90)';
            ctx.fillRect(sx + 4, sy + 4, 8, 8);
            break;
          }
          default:
            break; // 其余实体由 #9/#13 渲染
        }
      }
    }

    _drawPlayer() {
      if (!this.player) return;
      const ctx = this.renderer.ctx;
      const px = Math.round(this.player.x - this.camera.x);
      const py = Math.round(this.player.y - this.camera.y);
      ctx.fillStyle = 'rgb(0,0,0)';
      ctx.fillRect(px - 1, py - 1, 18, 18);
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.fillRect(px, py, 16, 16);
      ctx.fillStyle = 'rgb(26,16,51)';
      ctx.fillRect(px + 3, py + 3, 10, 10);
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.fillRect(px + 5, py + 5, 3, 3);
      ctx.fillRect(px + 10, py + 5, 3, 3);
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
    VERSION: '0.1.0',
    STATE: STATE,
    Game: Game,
    boot: boot,
    buildBootLevels: buildBootLevels,
    formatTime: formatTime,
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
