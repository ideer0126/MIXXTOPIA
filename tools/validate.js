#!/usr/bin/env node
/**
 * tools/validate.js —— 地图/数据校验（PLAN.md §4 质量门禁第 2 项）
 *
 * 校验规则来源：docs/GAME_DESIGN.md §11 规则 1–10（1:1 覆盖）。
 * 零依赖：Node 内置 fs/path/vm，无需 npm install。
 *
 * 运行：
 *   node tools/validate.js                 # 常规校验（GAME 未落地时跳过规则 1–9）
 *   node tools/validate.js --require-data  # GAME 缺失按失败处理（CI 严格模式）
 *   node tools/validate.js --self-test     # 内置用例自测规则引擎（开发用）
 *
 * 数据源约定：js/data.js 可声明 `const GAME = {...}` 或 `window.GAME = {...}`，
 * 两种写法本脚本都支持；data.js 落地前（Issue #11/#12 未完成）本脚本对
 * 规则 1–9 输出「跳过」提示，规则 10（占位文案扫描）始终执行。
 *
 * 规则 9 说明：完整状态图搜索（推箱/灯油/水位切换等状态转换）为 §11 标注的
 * 「预留自动校验」，当前实现静态近似（地形 + 门开/关 + 水位高/低并集 +
 * 单向门方向的并集可达性），能拦截「任何合法状态下都收不到星/到不了终点」
 * 的数据错误；状态转换级校验待 #11 数据落地后补全。
 *
 * 退出码：0 = 通过（或按约定跳过）；1 = 存在错误。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'js', 'data.js');

const RULE_NAMES = {
  '数据源': '数据加载',
  '基础': 'GAME 结构与 id',
  '规则 1': '地图尺寸（≥40×28，行列一致）',
  '规则 2': '瓦片字符与实体摆放',
  '规则 3': '星星数量与 id',
  '规则 4': 'spawn / portal / cake',
  '规则 5': '开关目标与 trigger 范围',
  '规则 6': '方向与关 4 水面',
  '规则 7': '对话引用与触发',
  '规则 8': 'NPC 出场',
  '规则 9': '可达性（静态近似）',
  '规则 10': '占位文案与存档键',
  '机制': '机制使用范围',
};
const RULE_ORDER = [
  '数据源', '基础', '规则 1', '规则 2', '规则 3', '规则 4', '规则 5',
  '规则 6', '规则 7', '规则 8', '规则 9', '规则 10', '机制',
];

/* ════════════════════════ 报告收集 ════════════════════════ */

function makeReport() {
  return {
    errors: [],   // { rule, msg }
    warnings: [], // string
    notes: [],    // string
    err(rule, msg) {
      this.errors.push({ rule, msg });
    },
    warn(msg) {
      this.warnings.push(msg);
    },
    note(msg) {
      this.notes.push(msg);
    },
  };
}

/* ════════════════════════ 数据加载 ════════════════════════ */

/**
 * 在 vm 沙箱中加载 js/data.js 并提取 GAME。
 * 兼容 `const GAME = {...}`（顶层词法绑定）与 `window.GAME = {...}`。
 * @returns {{ game: object|undefined, loadError: Error|null }}
 */
function loadGame() {
  if (!fs.existsSync(DATA_FILE)) {
    return { game: undefined, loadError: new Error('js/data.js 不存在') };
  }
  const src = fs.readFileSync(DATA_FILE, 'utf8');
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(src, sandbox, { filename: 'js/data.js' });
  } catch (e) {
    return { game: undefined, loadError: e };
  }
  let game;
  try {
    game = vm.runInContext('typeof GAME !== "undefined" ? GAME : undefined', sandbox);
  } catch (e) {
    game = undefined;
  }
  if (game === undefined) game = sandbox.GAME;
  return { game, loadError: null };
}

/* ════════════════════════ 通用小工具 ════════════════════════ */

function entitiesOf(level, type) {
  return (level && Array.isArray(level.entities) ? level.entities : [])
    .filter(e => e && e.type === type);
}

function tileAt(level, x, y) {
  if (!level || !level.map || !Array.isArray(level.map.rows)) return undefined;
  const row = level.map.rows[y];
  return row ? row[x] : undefined;
}

function legendName(level, ch) {
  return level && level.map && level.map.legend ? level.map.legend[ch] : undefined;
}

/** 永久不可通行瓦片：字符 '#' 或 legend 值为 'wall' */
function isWall(level, x, y) {
  const ch = tileAt(level, x, y);
  return ch === '#' || legendName(level, ch) === 'wall';
}

function isWater(level, x, y) {
  return legendName(level, tileAt(level, x, y)) === 'water';
}

function label(e) {
  return e.type + (e.id != null ? ' "' + e.id + '"' : '');
}

/** 节点 id → 所属关卡/场景；无法判定返回 null */
function scopeOfNodeId(game, nodeId) {
  const m = /^l(\d+)(?:\.|$)/.exec(nodeId);
  if (m) {
    const id = Number(m[1]);
    const exists = (game.levels || []).some(l => l && l.id === id);
    return { kind: 'level', key: id, missing: !exists };
  }
  for (const key of Object.keys(game.scenes || {})) {
    if (nodeId === key || nodeId.startsWith(key + '.')) return { kind: 'scene', key };
  }
  return null;
}

const DIRV = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const DIR_BY_DELTA = { '0,-1': 'N', '1,0': 'E', '0,1': 'S', '-1,0': 'W' };

/* ════════════════════════ 基础结构 ════════════════════════ */

function checkBase(game, R) {
  if (!game || typeof game !== 'object') {
    R.err('基础', 'GAME 不是对象');
    return;
  }
  if (!Array.isArray(game.levels)) {
    R.err('基础', '缺少 levels 数组');
    return;
  }
  if (game.levels.length !== 6) {
    R.err('基础', 'levels 数量 ' + game.levels.length + ' ≠ 6（§4 共 6 关）');
  }
  const ids = [];
  for (const lv of game.levels) {
    if (!lv || typeof lv !== 'object') {
      R.err('基础', 'levels 含非对象条目');
      continue;
    }
    if (typeof lv.id !== 'number' || !Number.isInteger(lv.id)) {
      R.err('基础', '关卡缺少整数 id（当前 ' + JSON.stringify(lv.id) + '）');
    } else {
      ids.push(lv.id);
    }
  }
  for (const d of new Set(ids.filter((v, i) => ids.indexOf(v) !== i))) {
    R.err('基础', '关卡 id ' + d + ' 重复');
  }
  for (const id of ids) {
    if (id < 1 || id > 6) R.err('基础', '关卡 id ' + id + ' 超出 1–6');
  }
  if (!game.dialogue || typeof game.dialogue !== 'object') {
    R.err('基础', '缺少 dialogue 对象');
  }
  if (!game.characters || typeof game.characters !== 'object') {
    R.err('基础', '缺少 characters 字典');
  }
  if (!game.scenes || typeof game.scenes !== 'object') {
    R.warn('缺少 scenes 对象（序章 p0 的 load:p0 作用域需要）');
  }
  const sceneKeys = new Set(Object.keys(game.scenes || {}));
  for (const id of ids) {
    if (sceneKeys.has(String(id))) {
      R.err('基础', '场景 key "' + id + '" 与关卡 id 重名（§7 要求无歧义）');
    }
  }
  if (game.meta) {
    if (game.meta.tile != null && game.meta.tile !== 16) {
      R.warn('meta.tile=' + game.meta.tile + ' ≠ 16（PLAN.md §3 渲染规格）');
    }
    const vp = game.meta.viewport;
    if (vp && (vp.w !== 20 || vp.h !== 14)) {
      R.warn('meta.viewport 应为 {w:20, h:14}（当前 ' + JSON.stringify(vp) + '）');
    }
  }
}

/* ════════════════════════ 规则 1：地图尺寸 ════════════════════════ */

function rule1(game, R) {
  for (const lv of game.levels || []) {
    const tag = '关 ' + (lv && lv.id != null ? lv.id : '?');
    if (!lv || !lv.map) {
      R.err('规则 1', tag + ' 缺少 map 字段');
      continue;
    }
    const m = lv.map;
    if (typeof m.w !== 'number' || typeof m.h !== 'number') {
      R.err('规则 1', tag + ' 缺少数字 w/h');
      continue;
    }
    if (m.w < 40 || m.h < 28) {
      R.err('规则 1', tag + ' 地图尺寸 ' + m.w + '×' + m.h + ' 小于 40×28');
    }
    if (!Array.isArray(m.rows)) {
      R.err('规则 1', tag + ' 缺少 rows 数组');
      continue;
    }
    if (m.rows.length !== m.h) {
      R.err('规则 1', tag + ' 行数 ' + m.rows.length + ' ≠ h=' + m.h);
    }
    m.rows.forEach((row, y) => {
      if (typeof row !== 'string' || row.length !== m.w) {
        R.err('规则 1', tag + ' 第 ' + y + ' 行长度 '
          + (typeof row === 'string' ? row.length : '非字符串') + ' ≠ w=' + m.w);
      }
    });
  }
}

/* ════════════════════════ 规则 2：瓦片字符与实体摆放 ════════════════════════ */

function rule2(game, R) {
  for (const lv of game.levels || []) {
    if (!lv || !lv.map || !Array.isArray(lv.map.rows) || !lv.map.legend) continue; // 规则 1 报
    const tag = '关 ' + lv.id;
    const badChars = new Set();
    lv.map.rows.forEach((row, y) => {
      if (typeof row !== 'string') return;
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (!(ch in lv.map.legend) && !badChars.has(ch)) {
          badChars.add(ch);
          R.err('规则 2', tag + ' 瓦片字符 "' + ch + '"（' + x + ',' + y + '）不在 legend 中');
        }
      }
    });
    if (!Array.isArray(lv.entities)) {
      R.err('规则 2', tag + ' 缺少 entities 数组');
      continue;
    }
    for (const e of lv.entities) {
      if (!e) continue;
      if (e.x == null || e.y == null || typeof e.x !== 'number' || typeof e.y !== 'number') {
        R.err('规则 2', tag + ' 实体 ' + label(e) + ' 缺少数字 x/y');
        continue;
      }
      if (e.x < 0 || e.y < 0 || e.x >= lv.map.w || e.y >= lv.map.h) {
        R.err('规则 2', tag + ' ' + label(e) + ' 坐标 (' + e.x + ',' + e.y + ') 越界');
        continue;
      }
      if (isWall(lv, e.x, e.y)) {
        R.err('规则 2', tag + ' ' + label(e) + ' 落在墙体 (' + e.x + ',' + e.y + ') 上');
        continue;
      }
      if (isWater(lv, e.x, e.y)) {
        if (e.type === 'water' || e.type === 'stepstone') continue;
        if (e.type === 'star') {
          const w = entitiesOf(lv, 'water').find(w => w.x === e.x && w.y === e.y);
          if (!w || w.shallow !== true) {
            R.err('规则 2', tag + ' 星 "' + e.id + '" 叠放水域但该格非浅滩'
              + '（需同坐标 WATER 且 shallow:true）');
          }
          continue;
        }
        R.err('规则 2', tag + ' ' + label(e) + ' 叠放在水域上，仅允许 WATER/STEPSTONE/浅滩星');
      }
    }
  }
}

/* ════════════════════════ 规则 3：星星数量与 id ════════════════════════ */

function rule3(game, R) {
  const seen = new Map();
  let total = 0;
  for (const lv of game.levels || []) {
    if (!lv || !Array.isArray(lv.entities)) {
      if (lv) R.err('规则 3', '关 ' + lv.id + ' 缺少 entities 数组');
      continue;
    }
    const tag = '关 ' + lv.id;
    const stars = entitiesOf(lv, 'star');
    total += stars.length;
    if (lv.starCount !== stars.length) {
      R.err('规则 3', tag + ' starCount=' + lv.starCount + ' 与实际星数 ' + stars.length + ' 不符');
    }
    if (typeof lv.starCount !== 'number' || lv.starCount < 3 || lv.starCount > 5) {
      R.err('规则 3', tag + ' starCount=' + lv.starCount + ' 不在 3–5 区间');
    }
    for (const s of stars) {
      if (!s.id || typeof s.id !== 'string') {
        R.err('规则 3', tag + ' 星实体缺少字符串 id');
        continue;
      }
      if (seen.has(s.id)) {
        R.err('规则 3', '星 id "' + s.id + '" 与 ' + seen.get(s.id) + ' 重复（须全局唯一）');
      } else {
        seen.set(s.id, tag);
      }
    }
  }
  if (total !== 25) {
    R.err('规则 3', '总星数 ' + total + ' ≠ 25（§4 总计 25 颗）');
  }
}

/* ════════════════════════ 规则 4：spawn / portal / cake ════════════════════════ */

function rule4(game, R) {
  const ids = new Set((game.levels || []).filter(l => l && l.id != null).map(l => l.id));
  for (const lv of game.levels || []) {
    if (!lv || !Array.isArray(lv.entities)) continue;
    const tag = '关 ' + lv.id;
    const spawns = entitiesOf(lv, 'spawn');
    const portals = entitiesOf(lv, 'portal');
    const cakes = entitiesOf(lv, 'cake');
    if (spawns.length !== 1) {
      R.err('规则 4', tag + ' spawn 数量 ' + spawns.length + ' ≠ 1');
    }
    if (lv.id >= 1 && lv.id <= 5) {
      if (portals.length !== 1) {
        R.err('规则 4', tag + ' portal 数量 ' + portals.length + ' ≠ 1');
      }
      if (cakes.length > 0) {
        R.err('规则 4', tag + ' 关 1–5 不得出现 cake');
      }
      for (const p of portals) {
        if (!ids.has(p.to)) {
          R.err('规则 4', tag + ' portal.to=' + p.to + ' 引用不存在的关卡');
        } else if (p.to !== lv.id + 1) {
          R.err('规则 4', tag + ' portal.to=' + p.to + ' 应等于本关 id+1=' + (lv.id + 1));
        }
      }
    } else if (lv.id === 6) {
      if (cakes.length !== 1) {
        R.err('规则 4', '关 6 cake 数量 ' + cakes.length + ' ≠ 1');
      }
      if (portals.length > 0) {
        R.err('规则 4', '关 6 不得出现 portal（结局由蛋糕触发）');
      }
    }
  }
}

/* ════════════════════════ 规则 5：开关目标与 trigger 范围 ════════════════════════ */

function rule5(game, R) {
  for (const lv of game.levels || []) {
    if (!lv || !lv.map || !Array.isArray(lv.entities)) continue;
    const tag = '关 ' + lv.id;
    const gateIds = new Set();
    for (const e of lv.entities) {
      if (!e || e.type !== 'gate') continue;
      if (!e.id || typeof e.id !== 'string') {
        R.err('规则 5', tag + ' gate 缺少字符串 id（开关/灯柱 target 依赖）');
      } else {
        gateIds.add(e.id);
      }
    }
    for (const e of lv.entities) {
      if (!e) continue;
      if (e.type === 'switch' || e.type === 'lamp') {
        if (typeof e.target !== 'string' || !gateIds.has(e.target)) {
          R.err('规则 5', tag + ' ' + label(e) + ' 的 target="' + e.target + '" 未引用本关存在的 gate');
        }
      }
      if (e.type === 'trigger') {
        const r = e.rect;
        if (!r || [r.x, r.y, r.w, r.h].some(v => typeof v !== 'number')) {
          R.err('规则 5', tag + ' trigger "' + e.id + '" 缺少完整数字 rect');
        } else if (r.x < 0 || r.y < 0 || r.x + r.w > lv.map.w || r.y + r.h > lv.map.h) {
          R.err('规则 5', tag + ' trigger "' + e.id + '" rect 越出地图范围');
        }
      }
    }
    if (lv.id === 2) {
      const lamps = entitiesOf(lv, 'lamp').length;
      const oils = entitiesOf(lv, 'oil').length;
      const gates = entitiesOf(lv, 'gate').length;
      if (lamps !== 3 || oils !== 3 || gates !== 3) {
        R.err('规则 5', '关 2 灯柱=' + lamps + ' / 灯油=' + oils + ' / 门=' + gates + '，应均为 3');
      }
    }
  }
}

/* ════════════════════════ 规则 6：方向与关 4 水面 ════════════════════════ */

function rule6(game, R) {
  const DIRS = new Set(['N', 'E', 'S', 'W']);
  for (const lv of game.levels || []) {
    if (!lv || !Array.isArray(lv.entities)) continue;
    const tag = '关 ' + lv.id;
    for (const e of lv.entities) {
      if (!e) continue;
      if ((e.type === 'oneway' || e.type === 'wind') && !DIRS.has(e.dir)) {
        R.err('规则 6', tag + ' ' + label(e) + ' 的 dir="' + e.dir + '" 不在 {N,E,S,W}');
      }
      if (e.type === 'water') {
        if (typeof e.shallow !== 'boolean') {
          R.err('规则 6', tag + ' water (' + e.x + ',' + e.y + ') 的 shallow 必须是布尔值');
        }
        if (e.waterLevel !== 'high') {
          R.err('规则 6', tag + ' water (' + e.x + ',' + e.y + ') 初始 waterLevel 必须为 "high"'
            + '（当前 ' + JSON.stringify(e.waterLevel) + '）');
        }
      }
    }
    if (lv.id !== 4 || !lv.map || !Array.isArray(lv.map.rows)) continue;
    const waterByCell = new Map();
    for (const w of entitiesOf(lv, 'water')) {
      const cell = w.x + ',' + w.y;
      if (waterByCell.has(cell)) {
        R.err('规则 6', '关 4 单元格 (' + w.x + ',' + w.y + ') 有多个 WATER（每个 "~" 格恰一个）');
      }
      waterByCell.set(cell, w);
      if (tileAt(lv, w.x, w.y) !== '~') {
        R.err('规则 6', '关 4 water (' + w.x + ',' + w.y + ') 不在 "~" 水砖上');
      }
    }
    lv.map.rows.forEach((row, y) => {
      if (typeof row !== 'string') return;
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '~' && !waterByCell.has(x + ',' + y)) {
          R.err('规则 6', '关 4 水砖 (' + x + ',' + y + ') 缺少同坐标 WATER');
        }
      }
    });
    for (const s of entitiesOf(lv, 'stepstone')) {
      if (!waterByCell.has(s.x + ',' + s.y)) {
        R.err('规则 6', '关 4 stepstone (' + s.x + ',' + s.y + ') 无同格 WATER');
      }
    }
  }
}

/* ════════════════════════ 规则 7：对话引用与触发 ════════════════════════ */

const NODE_TYPES = new Set(['intro', 'hint', 'npc', 'check', 'star', 'clear', 'sheep', 'cutscene']);
const NPC_INTERACT_TYPES = new Set(['intro', 'hint', 'npc', 'check']);
/** 节点类型 → trigger 前缀（cutscene 允许 load:/trigger:/cake 三种） */
const TYPE_TRIGGER = {
  intro: ['npc:'], hint: ['npc:'], npc: ['npc:'], check: ['npc:'],
  star: ['star:'], clear: ['clear:'], sheep: ['sheep:'],
  cutscene: ['load:', 'trigger:', 'cake'],
};
const CANON_SPEAKERS = ['lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin', 'byeori', 'dj', 'sheep', 'nar', 'all'];

function rule7(game, R) {
  const levels = game.levels || [];
  const dialogue = game.dialogue || {};
  const characters = game.characters || {};
  if (!game.dialogue) return; // 基础已报
  const nodeIds = new Set(Object.keys(dialogue));

  /* 实体索引（id → {entity, level}） */
  const npcById = new Map();
  const sheepById = new Map();
  const starById = new Map();
  const triggerById = new Map();
  for (const lv of levels) {
    if (!lv || !Array.isArray(lv.entities)) continue;
    for (const e of lv.entities) {
      if (!e || typeof e.id !== 'string') continue;
      if (e.type === 'npc') npcById.set(e.id, { entity: e, level: lv });
      else if (e.type === 'sheep') sheepById.set(e.id, { entity: e, level: lv });
      else if (e.type === 'star') starById.set(e.id, { entity: e, level: lv });
      else if (e.type === 'trigger') triggerById.set(e.id, { entity: e, level: lv });
    }
  }

  /* 7a：实体 → 对话节点引用 */
  for (const lv of levels) {
    if (!lv || !Array.isArray(lv.entities)) continue;
    const tag = '关 ' + lv.id;
    for (const e of lv.entities) {
      if (!e) continue;
      if (e.type === 'npc') {
        if (typeof e.dialogue !== 'string') {
          R.err('规则 7', tag + ' npc "' + e.id + '" 缺少 dialogue');
          continue;
        }
        const node = dialogue[e.dialogue];
        if (!node) {
          R.err('规则 7', tag + ' npc "' + e.id + '" 引用不存在的对话节点 "' + e.dialogue + '"');
          continue;
        }
        if (!NPC_INTERACT_TYPES.has(node.type)) {
          R.err('规则 7', tag + ' npc "' + e.id + '" 的节点 "' + e.dialogue + '" 类型为 '
            + node.type + '，NPC 互动节点应为 intro/hint/npc/check');
        }
        if (node.trigger !== 'npc:' + e.id) {
          R.err('规则 7', tag + ' npc "' + e.id + '" 的节点 "' + e.dialogue + '" trigger 应为 '
            + '"npc:' + e.id + '"（当前 "' + node.trigger + '"）');
        }
      } else if (e.type === 'trigger') {
        if (typeof e.dialogue !== 'string') {
          R.err('规则 7', tag + ' trigger "' + e.id + '" 缺少 dialogue');
          continue;
        }
        const node = dialogue[e.dialogue];
        if (!node) {
          R.err('规则 7', tag + ' trigger "' + e.id + '" 引用不存在的对话节点 "' + e.dialogue + '"');
          continue;
        }
        if (node.type !== 'cutscene') {
          R.err('规则 7', tag + ' trigger "' + e.id + '" 的节点 "' + e.dialogue + '" 类型应为 cutscene');
        }
        if (node.trigger !== 'trigger:' + e.id) {
          R.err('规则 7', tag + ' trigger "' + e.id + '" 的节点 trigger 应为 "trigger:' + e.id + '"'
            + '（当前 "' + node.trigger + '"）');
        }
      } else if (e.type === 'sheep') {
        if (typeof e.dialogue !== 'string') {
          R.err('规则 7', tag + ' 黑羊缺少 dialogue');
          continue;
        }
        const node = dialogue[e.dialogue];
        if (!node) {
          R.err('规则 7', tag + ' 黑羊引用不存在的对话节点 "' + e.dialogue + '"');
          continue;
        }
        if (node.type !== 'sheep') {
          R.err('规则 7', tag + ' 黑羊节点 "' + e.dialogue + '" 类型应为 sheep');
        }
        if (node.once !== true) {
          R.err('规则 7', tag + ' 黑羊节点 "' + e.dialogue + '" 的 once 必须为 true');
        }
        if (node.trigger !== 'sheep:' + e.id) {
          R.err('规则 7', tag + ' 黑羊节点 "' + e.dialogue + '" trigger 应为 "sheep:' + e.id + '"'
            + '（当前 "' + node.trigger + '"）');
        }
      }
    }
  }

  /* 节点级遍历 */
  const groups = new Map(); // 'evt|scope' → {nodes, entry, trigger, scopeId}
  for (const [nodeId, node] of Object.entries(dialogue)) {
    if (!node || typeof node !== 'object') {
      R.err('规则 7', '对话节点 "' + nodeId + '" 不是对象');
      continue;
    }
    /* 所属作用域 */
    const scope = scopeOfNodeId(game, nodeId);
    if (!scope) {
      R.err('规则 7', '节点 "' + nodeId + '" 的 id 无法判定所属关卡/场景（应为 lN.* 或场景 key 前缀）');
    } else if (scope.missing) {
      R.err('规则 7', '节点 "' + nodeId + '" 属于不存在的关 ' + scope.key);
    }
    /* type / trigger */
    if (!NODE_TYPES.has(node.type)) {
      R.err('规则 7', '节点 "' + nodeId + '" 的 type="' + node.type + '" 不在 8 种节点类型内');
      continue;
    }
    if (typeof node.trigger !== 'string' || !node.trigger) {
      R.err('规则 7', '节点 "' + nodeId + '" 缺少 trigger');
      continue;
    }
    const allow = TYPE_TRIGGER[node.type];
    const prefixOk = node.type === 'cutscene'
      ? allow.some(p => p === 'cake' ? node.trigger === 'cake' : node.trigger.startsWith(p))
      : allow.some(p => node.trigger.startsWith(p));
    if (!prefixOk) {
      R.err('规则 7', '节点 "' + nodeId + '" 类型 ' + node.type + ' 与 trigger "'
        + node.trigger + '" 矛盾（§7 取值约定）');
    }
    if (typeof node.once !== 'undefined' && typeof node.once !== 'boolean') {
      R.warn('节点 "' + nodeId + '" 的 once 非布尔值');
    }
    /* lines / speaker */
    if (!Array.isArray(node.lines) || node.lines.length === 0) {
      R.err('规则 7', '节点 "' + nodeId + '" 缺少非空 lines 数组');
    } else {
      node.lines.forEach((line, i) => {
        if (!line || typeof line.s !== 'string' || typeof line.t !== 'string') {
          R.err('规则 7', '节点 "' + nodeId + '" lines[' + i + '] 缺少 s/t');
          return;
        }
        if (!(line.s in characters)) {
          R.err('规则 7', '节点 "' + nodeId + '" lines[' + i + '] 的 speaker "'
            + line.s + '" 不在 characters 字典');
        }
      });
    }
    /* next / options */
    if (node.next != null && !nodeIds.has(node.next)) {
      R.err('规则 7', '节点 "' + nodeId + '" 的 next="' + node.next + '" 引用不存在的节点');
    }
    if (node.options != null) {
      if (!Array.isArray(node.options) || node.options.length === 0) {
        R.err('规则 7', '节点 "' + nodeId + '" options 应为非空数组');
      } else {
        node.options.forEach((opt, i) => {
          if (!opt || typeof opt.label !== 'string' || !opt.label) {
            R.err('规则 7', '节点 "' + nodeId + '" options[' + i + '] 缺少 label');
          }
          if (!opt || typeof opt.goto !== 'string' || !nodeIds.has(opt.goto)) {
            R.err('规则 7', '节点 "' + nodeId + '" options[' + i + '] 的 goto="'
              + (opt && opt.goto) + '" 引用不存在的节点');
          }
        });
      }
    }
    /* trigger 引用实体存在 */
    if (node.trigger.startsWith('npc:')) {
      const sp = node.trigger.slice(4);
      const hit = npcById.get(sp);
      if (!hit) {
        R.err('规则 7', '节点 "' + nodeId + '" 的 trigger 引用不存在的 NPC "' + sp + '"');
      } else if (scope && scope.kind === 'level' && !scope.missing && hit.level.id !== scope.key) {
        R.warn('节点 "' + nodeId + '" 属于关 ' + scope.key + '，但其 NPC "' + sp + '" 在关 ' + hit.level.id);
      }
    } else if (node.trigger.startsWith('star:')) {
      const sid = node.trigger.slice(5);
      const hit = starById.get(sid);
      if (!hit) {
        R.err('规则 7', '节点 "' + nodeId + '" 的 trigger 引用不存在的星 "' + sid + '"');
      } else if (scope && scope.kind === 'level' && !scope.missing && hit.level.id !== scope.key) {
        R.warn('节点 "' + nodeId + '" 属于关 ' + scope.key + '，但其星 "' + sid + '" 在关 ' + hit.level.id);
      }
    } else if (node.trigger.startsWith('trigger:')) {
      const tid = node.trigger.slice(8);
      const hit = triggerById.get(tid);
      if (!hit) {
        R.err('规则 7', '节点 "' + nodeId + '" 的 trigger 引用不存在的 trigger 实体 "' + tid + '"');
      } else if (hit.entity.dialogue !== nodeId) {
        R.err('规则 7', 'trigger 实体 "' + tid + '" 的 dialogue 未指回节点 "' + nodeId + '"');
      }
    } else if (node.trigger === 'cake') {
      /* 蛋糕自动触发，无反向引用要求 */
    } else if (node.trigger.startsWith('sheep:')) {
      /* 黑羊绑定在下方反向检查（sheep:<id> → 实体存在且指回）统一处理 */
    } else if (node.trigger.startsWith('clear:') || node.trigger.startsWith('load:')) {
      const m = /^(clear|load):(.+)$/.exec(node.trigger);
      const evt = m[1];
      const scopeStr = m[2];
      if (node.scopeId == null) {
        R.err('规则 7', '节点 "' + nodeId + '" 缺少 scopeId（trigger 为 ' + node.trigger + '）');
        continue;
      }
      if (String(node.scopeId) !== scopeStr) {
        R.err('规则 7', '节点 "' + nodeId + '" scopeId=' + JSON.stringify(node.scopeId)
          + ' 与 trigger 后缀 "' + scopeStr + '" 不一致');
      }
      const levelHit = levels.filter(l => l && String(l.id) === scopeStr).length;
      const sceneHit = Object.prototype.hasOwnProperty.call(game.scenes || {}, scopeStr);
      if (evt === 'clear') {
        if (levelHit !== 1 || sceneHit) {
          R.err('规则 7', '节点 "' + nodeId + '" clear 作用域 "' + scopeStr + '" 须唯一对应一个关卡 ID');
        }
      } else {
        if (levelHit + (sceneHit ? 1 : 0) !== 1) {
          R.err('规则 7', '节点 "' + nodeId + '" load 作用域 "' + scopeStr
            + '" 须唯一对应一个关卡 ID 或场景 key');
        }
      }
      if (scope && !scope.missing) {
        const own = scope.kind === 'level' ? String(scope.key) : scope.key;
        if (own !== scopeStr) {
          R.err('规则 7', '节点 "' + nodeId + '" 属于' + (scope.kind === 'level' ? '关 ' + scope.key : '场景 ' + scope.key)
            + '，与 scopeId "' + scopeStr + '" 不一致');
        }
      }
      const key = evt + '|' + scopeStr;
      if (!groups.has(key)) {
        groups.set(key, { nodes: [], entry: 0, trigger: node.trigger, scopeId: String(node.scopeId) });
      }
      const g = groups.get(key);
      g.nodes.push(nodeId);
      if (node.entry === true) g.entry++;
    } else {
      R.err('规则 7', '节点 "' + nodeId + '" 的 trigger "' + node.trigger + '" 不满足取值约定');
    }
    if (node.entry === true && !node.trigger.startsWith('clear:') && !node.trigger.startsWith('load:')) {
      R.warn('节点 "' + nodeId + '" entry:true 但 trigger 非 clear:/load:（entry 仅对自动作用域入口生效）');
    }
  }

  /* 分组：作用域 + 事件类型的入口与链 */
  for (const [key, g] of groups) {
    const [evt, scopeStr] = key.split('|');
    if (g.entry !== 1) {
      R.err('规则 7', '作用域 ' + evt + ':' + scopeStr + ' 应有恰 1 个 entry:true 入口（当前 '
        + g.entry + ' 个；节点：' + g.nodes.join(', ') + '）');
    }
    const entryNode = g.nodes.find(id => dialogue[id] && dialogue[id].entry === true);
    if (!entryNode) continue;
    const visited = new Set([entryNode]);
    const queue = [entryNode];
    while (queue.length) {
      const cur = queue.shift();
      const n = dialogue[cur];
      if (n && typeof n.next === 'string' && nodeIds.has(n.next) && !visited.has(n.next)) {
        visited.add(n.next);
        queue.push(n.next);
      }
    }
    for (const id of g.nodes) {
      if (id === entryNode) continue;
      const n = dialogue[id];
      if (!visited.has(id)) {
        R.err('规则 7', '节点 "' + id + '" 未由入口 "' + entryNode + '" 经 next 链可达');
      }
      if (n && (n.trigger !== g.trigger || String(n.scopeId) !== g.scopeId)) {
        R.err('规则 7', '节点 "' + id + '" 的 trigger/scopeId 与链入口 "' + entryNode + '" 不一致');
      }
    }
  }

  /* 反向：sheep:<id> 触发节点 → 实体存在且指回 */
  for (const [nodeId, node] of Object.entries(dialogue)) {
    if (!node || typeof node.trigger !== 'string' || !node.trigger.startsWith('sheep:')) continue;
    const sid = node.trigger.slice(6);
    const hit = sheepById.get(sid);
    if (!hit) {
      R.err('规则 7', '节点 "' + nodeId + '" 的 trigger 引用不存在的黑羊 "' + sid + '"');
      continue;
    }
    if (hit.entity.dialogue !== nodeId) {
      R.err('规则 7', '黑羊 "' + sid + '" 的 dialogue 未指回节点 "' + nodeId + '"');
    }
    const scope = scopeOfNodeId(game, nodeId);
    if (scope && scope.kind === 'level' && !scope.missing && hit.level.id !== scope.key) {
      R.err('规则 7', '节点 "' + nodeId + '" 属于关 ' + scope.key + '，但黑羊 "' + sid + '" 在关 ' + hit.level.id);
    }
  }

  /* 黑羊绑定约定（§7）：关 N 的黑羊 id='sheepN'、dialogue='lN.sheep' */
  for (const lv of levels) {
    if (!lv || !Array.isArray(lv.entities)) continue;
    const tag = '关 ' + lv.id;
    for (const e of entitiesOf(lv, 'sheep')) {
      if (e.id !== 'sheep' + lv.id) {
        R.err('规则 7', tag + ' 黑羊 id 应为 "sheep' + lv.id + '"（当前 "' + e.id + '"）');
      }
      if (e.dialogue !== 'l' + lv.id + '.sheep') {
        R.err('规则 7', tag + ' 黑羊 dialogue 应为 "l' + lv.id + '.sheep"（当前 "' + e.dialogue + '"）');
      }
    }
  }

  /* 无实体引用的 npc 触发节点（疑似死节点） */
  for (const [nodeId, node] of Object.entries(dialogue)) {
    if (!node || !NPC_INTERACT_TYPES.has(node.type)) continue;
    const sp = String(node.trigger).slice(4);
    const hit = npcById.get(sp);
    if (hit && hit.entity.dialogue !== nodeId) {
      R.warn('节点 "' + nodeId + '"（trigger npc:' + sp + '）未被 NPC "' + sp + '" 引用（其 dialogue 为 "'
        + hit.entity.dialogue + '"）');
    }
  }

  for (const id of CANON_SPEAKERS) {
    if (!(id in characters)) {
      R.warn('characters 缺少 §3 规定条目 "' + id + '"');
    }
  }
}

/* ════════════════════════ 规则 8：NPC 出场 ════════════════════════ */

/** §5 各关 NPC 出场表（黑羊另行按每关 1 只校验） */
const NPC_ROSTER = {
  1: ['lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin', 'byeori'],
  2: ['jiwoo', 'byeori'],
  3: ['kyujin', 'dj', 'byeori'],
  4: ['lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin', 'byeori'],
  5: ['lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin', 'byeori'],
  6: ['lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin', 'byeori'],
};

function rule8(game, R) {
  for (const lv of game.levels || []) {
    if (!lv || !Array.isArray(lv.entities) || lv.id == null) continue;
    if (!NPC_ROSTER[lv.id]) continue;
    const tag = '关 ' + lv.id;
    const npcs = entitiesOf(lv, 'npc').map(e => e.id).sort();
    const want = NPC_ROSTER[lv.id].slice().sort();
    if (JSON.stringify(npcs) !== JSON.stringify(want)) {
      R.err('规则 8', tag + ' NPC 出场 [' + npcs.join(',') + '] 与 §5 出场表 ['
        + want.join(',') + '] 不一致');
    }
    const sheep = entitiesOf(lv, 'sheep').length;
    if (sheep !== 1) {
      R.err('规则 8', tag + ' 黑羊数量 ' + sheep + ' ≠ 1（每关 1 只）');
    }
  }
}

/* ════════════════════════ 规则 9：可达性（静态近似） ════════════════════════ */

/**
 * 静态近似（§11 标注的完整状态图搜索为预留校验）：
 *   - 地形：墙不可通行；水面按水位状态判定；
 *   - initial：门关、水位 high（仅浮桥石可站立）；
 *   - union：门开、水位取 high/low 并集（浮桥石 或 shallow 均可站立）——
 *     即「存在某一合法状态可通行」的并集，用于拦截任何状态下都收不到星/到不了终点的错误；
 *   - 单向门：进入与离开移动方向均须等于其 dir（反向与侧向不可穿过）；
 *   - 箱子/风带/NPC 等动态实体不参与静态判定（注释见函数内）。
 */
function rule9(game, R) {
  for (const lv of game.levels || []) {
    if (!lv || !lv.map || !Array.isArray(lv.map.rows) || !Array.isArray(lv.entities)) continue;
    const tag = '关 ' + lv.id;
    const spawn = entitiesOf(lv, 'spawn')[0];
    if (!spawn) continue; // 规则 4 已报

    const waters = entitiesOf(lv, 'water');
    const stones = entitiesOf(lv, 'stepstone');
    const gates = new Map();   // 'x,y' → gate 实体
    const oneways = new Map(); // 'x,y' → dir
    for (const e of lv.entities) {
      if (!e) continue;
      if (e.type === 'gate') gates.set(e.x + ',' + e.y, e);
      else if (e.type === 'oneway') oneways.set(e.x + ',' + e.y, e.dir);
    }

    const passable = (x, y, mode) => {
      if (x < 0 || y < 0 || x >= lv.map.w || y >= lv.map.h) return false;
      if (isWall(lv, x, y)) return false;
      if (isWater(lv, x, y)) {
        const w = waters.find(w => w.x === x && w.y === y);
        const stone = stones.some(s => s.x === x && s.y === y);
        if (mode === 'initial') return stone; // 高水位：仅浮桥石可站立
        return stone || !!(w && w.shallow === true); // high/low 并集
      }
      return true; // 其余地形可通行；箱子/风带等动态机制不参与静态判定
    };

    const canStep = (x, y, dx, dy, mode) => {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny, mode)) return false;
      const dir = DIR_BY_DELTA[dx + ',' + dy];
      const o1 = oneways.get(x + ',' + y);
      if (o1 && dir !== o1) return false; // 离开单向门须沿 dir
      const o2 = oneways.get(nx + ',' + ny);
      if (o2 && dir !== o2) return false; // 进入单向门须沿 dir
      if (mode === 'initial' && gates.has(nx + ',' + ny)) return false; // 门关
      return true;
    };

    const bfs = (mode) => {
      if (!passable(spawn.x, spawn.y, mode)) return new Set();
      const seen = new Set([spawn.x + ',' + spawn.y]);
      const queue = [{ x: spawn.x, y: spawn.y }];
      while (queue.length) {
        const c = queue.shift();
        for (const dirName of Object.keys(DIRV)) {
          const [dx, dy] = DIRV[dirName];
          if (!canStep(c.x, c.y, dx, dy, mode)) continue;
          const k = (c.x + dx) + ',' + (c.y + dy);
          if (!seen.has(k)) {
            seen.add(k);
            queue.push({ x: c.x + dx, y: c.y + dy });
          }
        }
      }
      return seen;
    };

    const init = bfs('initial');
    if (init.size === 0) {
      R.err('规则 9', tag + ' spawn 在初始状态下不可站立或无出口');
    }
    const union = bfs('union');
    for (const s of entitiesOf(lv, 'star')) {
      if (!union.has(s.x + ',' + s.y)) {
        R.err('规则 9', tag + ' 星 "' + s.id + '" (' + s.x + ',' + s.y + ') 在任一合法状态均不可达（静态近似）');
      }
    }
    const goal = lv.entities.find(e => e && (e.type === 'portal' || e.type === 'cake'));
    if (goal && !union.has(goal.x + ',' + goal.y)) {
      R.err('规则 9', tag + ' ' + label(goal) + ' (' + goal.x + ',' + goal.y + ') 在任一合法状态均不可达（静态近似）');
    }
  }
  R.note('规则 9 当前为静态近似（地形 + 门开/关 + 水位高/低并集 + 单向门方向）；推箱/灯油/水位切换等'
    + '完整状态图搜索为 §11 标注的预留自动校验，待 #11 数据落地后补全');
}

/* ════════════════════════ 规则 10：占位文案与存档键 ════════════════════════ */

const RULE10_FILES = ['index.html', 'js/main.js', 'js/data.js'];
const BANNED_TEXT = ['玻璃碎片'];
const STALE_MARKS = ['TODO', 'FIXME', 'XXX', 'Lorem ipsum'];

/** 扫描单份文件文本（独立函数便于自测） */
function scanText(text, rel, R) {
  for (const b of BANNED_TEXT) {
    let idx = text.indexOf(b);
    while (idx !== -1) {
      const lineNo = text.slice(0, idx).split('\n').length;
      R.err('规则 10', rel + ':' + lineNo + ' 存在遗留占位文案「' + b + '」');
      idx = text.indexOf(b, idx + 1);
    }
  }
  for (const s of STALE_MARKS) {
    if (text.indexOf(s) !== -1) {
      R.warn(rel + ' 疑似遗留标记 "' + s + '"');
    }
  }
}

function rule10(game, R) {
  for (const rel of RULE10_FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) {
      R.err('规则 10', '文件缺失：' + rel);
      continue;
    }
    scanText(fs.readFileSync(p, 'utf8'), rel, R);
  }
  if (game && game.saveKey != null) {
    if (typeof game.saveKey !== 'string' || !/^mixxtopia\.save\.v\d+$/.test(game.saveKey)) {
      R.warn('saveKey="' + game.saveKey + '" 与 §10 约定 mixxtopia.save.v1 不符');
    }
  }
}

/* ════════════════════════ 机制使用范围（辅助提醒） ════════════════════════ */

function mechanismScope(game, R) {
  const scope = {
    lamp: [2], oil: [2], oasis: [5], wind: [6], windswitch: [6],
    moonswitch: [4], water: [4], stepstone: [4],
  };
  for (const lv of game.levels || []) {
    if (!lv || !Array.isArray(lv.entities)) continue;
    for (const e of lv.entities) {
      if (!e || !(e.type in scope)) continue;
      const ok = scope[e.type];
      if (!ok.includes(lv.id)) {
        R.warn('关 ' + lv.id + ' 出现 §6 标注仅用于关 ' + ok.join('/') + ' 的实体 ' + label(e));
      }
    }
    if (lv.heat != null && lv.id !== 5) {
      R.warn('关 ' + lv.id + ' 定义了 heat（§5.5 仅关 5 使用）');
    }
    if (lv.id === 5 && lv.heat == null) {
      R.warn('关 5 缺少 heat 初始值（§5.5 heat:100）');
    }
  }
}

/* ════════════════════════ 报告输出 ════════════════════════ */

function printReport(R, skipped) {
  for (const rule of RULE_ORDER) {
    const es = R.errors.filter(e => e.rule === rule);
    const name = RULE_NAMES[rule] || rule;
    if (skipped && skipped.has(rule) && es.length === 0) {
      console.log('  \u2013 ' + rule + ' ' + name + '（跳过）');
    } else if (es.length === 0) {
      console.log('  \u2713 ' + rule + ' ' + name);
    } else {
      console.log('  \u2717 ' + rule + ' ' + name + ' —— ' + es.length + ' 处错误');
      for (const e of es) console.log('      · ' + e.msg);
    }
  }
  if (R.warnings.length) {
    console.log('\n⚠ 警告（不阻断门禁）：');
    for (const w of R.warnings) console.log('    - ' + w);
  }
  if (R.notes.length) {
    console.log('\nℹ 说明：');
    for (const n of R.notes) console.log('    - ' + n);
  }
}

/* ════════════════════════ 自测模式 ════════════════════════ */

function buildValidGame() {
  const W = 40;
  const H = 28;
  const rows = Array.from({ length: H }, (_, y) =>
    y === 0 || y === H - 1 ? '#'.repeat(W) : '#' + '\u00b7'.repeat(W - 2) + '#');
  const ROSTER = {
    1: ['lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin', 'byeori'],
    2: ['jiwoo', 'byeori'],
    3: ['kyujin', 'dj', 'byeori'],
    4: ['lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin', 'byeori'],
    5: ['lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin', 'byeori'],
    6: ['lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin', 'byeori'],
  };
  const STARS = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 5 }; // 合计 25
  const levels = [];
  const dialogue = {};
  for (let id = 1; id <= 6; id++) {
    const entities = [{ type: 'spawn', x: 2, y: 2 }];
    for (let k = 0; k < STARS[id]; k++) {
      entities.push({ type: 'star', id: 's' + id + '_' + (k + 1), x: 3 + k * 2, y: 2 });
    }
    ROSTER[id].forEach((nid, i) => {
      entities.push({ type: 'npc', id: nid, x: 5, y: 4 + i, dialogue: 'l' + id + '.intro.' + nid });
    });
    entities.push({ type: 'sheep', id: 'sheep' + id, x: 8, y: 5, dialogue: 'l' + id + '.sheep' });
    if (id <= 5) entities.push({ type: 'portal', x: W - 3, y: H - 3, to: id + 1 });
    else entities.push({ type: 'cake', x: W - 3, y: H - 3 });
    if (id === 2) {
      for (let k = 0; k < 3; k++) {
        entities.push({ type: 'lamp', id: 'lamp' + (k + 1), x: 10 + k * 3, y: 6, target: 'gate' + (k + 1), lit: false });
        entities.push({ type: 'oil', x: 10 + k * 3, y: 7 });
        entities.push({ type: 'gate', id: 'gate' + (k + 1), x: 12 + k * 3, y: 8, open: false });
      }
    }
    ROSTER[id].forEach(nid => {
      dialogue['l' + id + '.intro.' + nid] = {
        type: 'intro', trigger: 'npc:' + nid, once: true,
        lines: [{ s: 'lily', t: '自测台词' }],
      };
    });
    dialogue['l' + id + '.sheep'] = {
      type: 'sheep', trigger: 'sheep:sheep' + id, once: true,
      lines: [{ s: 'sheep', t: '自测谜语' }],
    };
    levels.push({
      id, title: '自测关 ' + id, region: '自测',
      palette: { bg: '#000000', cream: '#ffffff', gold: '#ffff00', pink: '#ff00ff' },
      bgm: 'test',
      map: { w: W, h: H, rows: rows.map(r => r), legend: { '#': 'wall', '\u00b7': 'floor' } },
      entities,
      starCount: STARS[id],
    });
  }
  return {
    meta: { version: '1.0', tile: 16, viewport: { w: 20, h: 14 } },
    scenes: { p0: { title: '自测序章' } },
    characters: {
      lily: { name: 'Lily', color: '#7FB8E6' },
      haewon: { name: 'Haewon', color: '#FFB14E' },
      sullyoon: { name: 'Sullyoon', color: '#B49BFF' },
      bae: { name: 'Bae', color: '#FF7BA9' },
      jiwoo: { name: 'Jiwoo', color: '#FFE066' },
      kyujin: { name: 'Kyujin', color: '#5EE6B8' },
      byeori: { name: 'Byeori', color: '#FFD700' },
      dj: { name: '街头DJ', color: '#FF5D8F' },
      sheep: { name: '黑羊', color: '#B8A8E0' },
      nar: { name: '', color: '#C0C0C0' },
      all: { name: '全员', color: '#FFFFFF' },
    },
    levels,
    dialogue,
    saveKey: 'mixxtopia.save.v1',
  };
}

function extractGame(src) {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'data-self-test.js' });
  let game;
  try {
    game = vm.runInContext('typeof GAME !== "undefined" ? GAME : undefined', sandbox);
  } catch (e) {
    game = undefined;
  }
  if (game === undefined) game = sandbox.GAME;
  return game;
}

function selfTest() {
  const assert = require('assert');
  let passed = 0;
  const failures = [];
  const t = (name, fn) => {
    try {
      fn();
      passed++;
      console.log('  \u2713 ' + name);
    } catch (e) {
      failures.push({ name, e });
      console.error('  \u2717 ' + name + '\n      ' + e.message);
    }
  };
  const runRules = (game) => {
    const R = makeReport();
    if (game) {
      checkBase(game, R);
      rule1(game, R);
      rule2(game, R);
      rule3(game, R);
      rule4(game, R);
      rule5(game, R);
      rule6(game, R);
      rule7(game, R);
      rule8(game, R);
      rule9(game, R);
      mechanismScope(game, R);
    }
    return R;
  };
  const hasErr = (R, rule, re) =>
    R.errors.some(e => e.rule === rule && re.test(e.msg));
  const clone = g => JSON.parse(JSON.stringify(g));

  console.log('自测：加载器');
  t('顶层 const GAME 可提取', () => {
    assert.strictEqual(extractGame("'use strict'; const GAME = { hello: 1 };").hello, 1);
  });
  t('window.GAME 可提取', () => {
    assert.strictEqual(extractGame("window.GAME = { hello: 2 };").hello, 2);
  });
  t('无 GAME 声明返回 undefined', () => {
    assert.strictEqual(extractGame("'use strict';"), undefined);
  });

  console.log('自测：合法数据全量通过');
  const valid = buildValidGame();
  t('合法 GAME 无错误（仅允许提示性警告）', () => {
    const R = runRules(valid);
    assert.strictEqual(R.errors.length, 0, R.errors.map(e => e.rule + ': ' + e.msg).join(' | '));
  });

  console.log('自测：规则 1–6');
  t('规则 1：宽度 < 40 报错', () => {
    const g = clone(valid);
    g.levels[0].map.w = 39;
    assert.ok(hasErr(runRules(g), '规则 1', /小于 40×28/));
  });
  t('规则 1：行长度 ≠ w 报错', () => {
    const g = clone(valid);
    g.levels[0].map.rows[3] = g.levels[0].map.rows[3].slice(0, -1);
    assert.ok(hasErr(runRules(g), '规则 1', /长度/));
  });
  t('规则 2：未收录瓦片字符报错', () => {
    const g = clone(valid);
    g.levels[0].map.rows[3] = g.levels[0].map.rows[3].slice(0, 3) + '?' + g.levels[0].map.rows[3].slice(4);
    assert.ok(hasErr(runRules(g), '规则 2', /不在 legend/));
  });
  t('规则 2：实体落在墙体报错', () => {
    const g = clone(valid);
    g.levels[0].entities[0].x = 0;
    g.levels[0].entities[0].y = 0;
    assert.ok(hasErr(runRules(g), '规则 2', /落在墙体/));
  });
  t('规则 3：starCount 与实存星数不符报错', () => {
    const g = clone(valid);
    g.levels[0].starCount = 5;
    assert.ok(hasErr(runRules(g), '规则 3', /不符/));
  });
  t('规则 3：星 id 全局重复报错', () => {
    const g = clone(valid);
    g.levels[1].entities.find(e => e.type === 'star').id = 's1_1';
    assert.ok(hasErr(runRules(g), '规则 3', /重复/));
  });
  t('规则 3：总星数 ≠ 25 报错', () => {
    const g = clone(valid);
    g.levels[0].starCount = 3;
    g.levels[0].entities = g.levels[0].entities.filter(e => e.type !== 'star' || e.id !== 's1_4');
    assert.ok(hasErr(runRules(g), '规则 3', /总星数/));
  });
  t('规则 4：portal.to 不等于 id+1 报错', () => {
    const g = clone(valid);
    g.levels[0].entities.find(e => e.type === 'portal').to = 3;
    assert.ok(hasErr(runRules(g), '规则 4', /id\+1/));
  });
  t('规则 4：spawn 数量 ≠ 1 报错', () => {
    const g = clone(valid);
    g.levels[0].entities.push({ type: 'spawn', x: 3, y: 3 });
    assert.ok(hasErr(runRules(g), '规则 4', /spawn 数量 2/));
  });
  t('规则 5：switch.target 未引用存在的 gate 报错', () => {
    const g = clone(valid);
    g.levels[0].entities.push({ type: 'switch', id: 'sw1', x: 20, y: 20, target: 'nope' });
    assert.ok(hasErr(runRules(g), '规则 5', /未引用本关存在的 gate/));
  });
  t('规则 5：trigger rect 越界报错', () => {
    const g = clone(valid);
    g.levels[0].entities.push({ type: 'trigger', id: 't1', x: 1, y: 1, rect: { x: 0, y: 0, w: 99, h: 2 }, dialogue: 'x' });
    assert.ok(hasErr(runRules(g), '规则 5', /rect 越出/));
  });
  t('规则 5：关 2 灯柱数 ≠ 3 报错', () => {
    const g = clone(valid);
    g.levels[1].entities = g.levels[1].entities.filter(e => e.type !== 'lamp' || e.id !== 'lamp3');
    assert.ok(hasErr(runRules(g), '规则 5', /应均为 3/));
  });
  t('规则 6：oneway.dir 非法报错', () => {
    const g = clone(valid);
    g.levels[2].entities.push({ type: 'oneway', dir: 'X', x: 10, y: 10 });
    assert.ok(hasErr(runRules(g), '规则 6', /dir/));
  });
  t('规则 6：关 4 "~" 水砖缺 WATER 报错', () => {
    const g = clone(valid);
    g.levels[3].map.rows[10] = g.levels[3].map.rows[10].slice(0, 5) + '~' + g.levels[3].map.rows[10].slice(6);
    g.levels[3].map.legend['~'] = 'water';
    assert.ok(hasErr(runRules(g), '规则 6', /缺少同坐标 WATER/));
  });
  t('规则 6：waterLevel 初始非 high 报错', () => {
    const g = clone(valid);
    g.levels[3].map.rows[10] = g.levels[3].map.rows[10].slice(0, 5) + '~' + g.levels[3].map.rows[10].slice(6);
    g.levels[3].map.legend['~'] = 'water';
    g.levels[3].entities.push({ type: 'water', x: 5, y: 10, waterLevel: 'low', shallow: false });
    assert.ok(hasErr(runRules(g), '规则 6', /初始 waterLevel 必须为 "high"/));
  });
  t('规则 6：stepstone 无同格 WATER 报错', () => {
    const g = clone(valid);
    g.levels[3].entities.push({ type: 'stepstone', x: 5, y: 10 });
    assert.ok(hasErr(runRules(g), '规则 6', /无同格 WATER/));
  });

  console.log('自测：规则 7–9');
  t('规则 7：next 引用不存在的节点报错', () => {
    const g = clone(valid);
    g.dialogue['l1.intro.lily'].next = 'l1.none';
    assert.ok(hasErr(runRules(g), '规则 7', /next=.*引用不存在的节点/));
  });
  t('规则 7：type 与 trigger 矛盾报错', () => {
    const g = clone(valid);
    g.dialogue['l1.intro.lily'].trigger = 'star:s1_1';
    assert.ok(hasErr(runRules(g), '规则 7', /矛盾/));
  });
  t('规则 7：黑羊节点 once 必须 true', () => {
    const g = clone(valid);
    g.dialogue['l1.sheep'].once = false;
    assert.ok(hasErr(runRules(g), '规则 7', /once 必须为 true/));
  });
  t('规则 7：scopeId 与 trigger 后缀不一致报错', () => {
    const g = clone(valid);
    g.dialogue['l1.clear'] = {
      type: 'clear', scopeId: 2, trigger: 'clear:1', entry: true, once: true,
      lines: [{ s: 'lily', t: 'x' }],
    };
    assert.ok(hasErr(runRules(g), '规则 7', /scopeId=.*不一致/));
  });
  t('规则 7：同作用域两个 entry 报错', () => {
    const g = clone(valid);
    g.dialogue['l1.clear'] = {
      type: 'clear', scopeId: 1, trigger: 'clear:1', entry: true, once: true,
      lines: [{ s: 'lily', t: 'x' }],
    };
    g.dialogue['l1.clear.2'] = {
      type: 'clear', scopeId: 1, trigger: 'clear:1', entry: true, once: true,
      lines: [{ s: 'lily', t: 'y' }],
    };
    assert.ok(hasErr(runRules(g), '规则 7', /恰 1 个 entry/));
  });
  t('规则 7：链内非入口节点不可达报错', () => {
    const g = clone(valid);
    g.dialogue['l1.clear'] = {
      type: 'clear', scopeId: 1, trigger: 'clear:1', entry: true, once: true,
      lines: [{ s: 'lily', t: 'x' }],
    };
    g.dialogue['l1.clear.2'] = {
      type: 'clear', scopeId: 1, trigger: 'clear:1', once: true,
      lines: [{ s: 'lily', t: 'y' }],
    };
    assert.ok(hasErr(runRules(g), '规则 7', /未由入口.*可达/));
  });
  t('规则 7：speaker 不在 characters 报错', () => {
    const g = clone(valid);
    g.dialogue['l1.intro.lily'].lines[0].s = 'batman';
    assert.ok(hasErr(runRules(g), '规则 7', /不在 characters/));
  });
  t('规则 8：NPC 出场不符报错', () => {
    const g = clone(valid);
    g.levels[0].entities = g.levels[0].entities.filter(e => !(e.type === 'npc' && e.id === 'lily'));
    assert.ok(hasErr(runRules(g), '规则 8', /不一致/));
  });
  t('规则 9：任何状态都不可达的星报错', () => {
    const g = clone(valid);
    const lv = g.levels[0];
    lv.map.rows[6] = '#'.repeat(40); // 第 6 行整行墙，隔断下方区域
    lv.entities.push({ type: 'star', id: 's1_sealed', x: 10, y: 10 });
    lv.starCount = 5;
    assert.ok(hasErr(runRules(g), '规则 9', /任一合法状态均不可达/));
  });
  t('规则 9：单向门逆向不可通行', () => {
    const g = clone(valid);
    const lv = g.levels[0];
    // 封死 (36..38, 25) 区域：北(24 行)/南(26 行) x=36..38 为墙，东侧 x=39 是边界墙，
    // 唯一入口是朝 W 的单向门 (36,25)——自西向东进入被禁止，星 s1_4 不可达
    for (const y of [24, 26]) {
      lv.map.rows[y] = lv.map.rows[y].slice(0, 36) + '###' + lv.map.rows[y].slice(39);
    }
    lv.entities.push({ type: 'oneway', dir: 'W', x: 36, y: 25 });
    const s = lv.entities.find(e => e.type === 'star' && e.id === 's1_4');
    s.x = 38;
    s.y = 25;
    assert.ok(hasErr(runRules(g), '规则 9', /s1_4/));
  });

  console.log('自测：规则 10');
  t('规则 10：玻璃碎片文案报错', () => {
    const R = makeReport();
    scanText('收集全部玻璃碎片！', 'x.html', R);
    assert.ok(hasErr(R, '规则 10', /玻璃碎片/));
  });
  t('规则 10：正常文案无错误', () => {
    const R = makeReport();
    scanText('收集本关全部愿望之星！', 'x.html', R);
    assert.strictEqual(R.errors.length, 0);
  });

  console.log('\n自测结果：' + passed + ' 通过' + (failures.length ? '，' + failures.length + ' 失败' : ''));
  process.exitCode = failures.length ? 1 : 0;
}

/* ════════════════════════ 主流程 ════════════════════════ */

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    selfTest();
    return;
  }
  const requireData = args.includes('--require-data');

  const { game, loadError } = loadGame();
  const R = makeReport();

  console.log('MIXXTOPIA 数据校验（规则来源 docs/GAME_DESIGN.md §11）');
  console.log('数据源：js/data.js\n');
  if (loadError) {
    R.err('数据源', 'js/data.js 加载失败：' + loadError.message);
  }

  const skipped = new Set();
  if (!game) {
    console.log('⚠ js/data.js 尚未定义 GAME（Issue #11/#12 未落地）→ 跳过规则 1–9 地图/对话校验。\n');
    for (const r of ['基础', '规则 1', '规则 2', '规则 3', '规则 4', '规则 5', '规则 6', '规则 7', '规则 8', '规则 9', '机制']) {
      skipped.add(r);
    }
    if (requireData) {
      R.err('数据源', '--require-data：GAME 缺失按失败处理');
    }
  } else {
    checkBase(game, R);
    rule1(game, R);
    rule2(game, R);
    rule3(game, R);
    rule4(game, R);
    rule5(game, R);
    rule6(game, R);
    rule7(game, R);
    rule8(game, R);
    rule9(game, R);
    mechanismScope(game, R);
  }
  rule10(game, R);

  printReport(R, skipped);
  console.log('\n结论：' + (R.errors.length
    ? '校验失败（' + R.errors.length + ' 错误 / ' + R.warnings.length + ' 警告）'
    : '校验通过（0 错误' + (R.warnings.length ? ' / ' + R.warnings.length + ' 警告' : '') + '）'));
  process.exitCode = R.errors.length ? 1 : 0;
}

if (require.main === module) main();

module.exports = {
  loadGame, makeReport, checkBase, rule1, rule2, rule3, rule4, rule5, rule6,
  rule7, rule8, rule9, rule10, scanText, mechanismScope, buildValidGame,
};
