#!/usr/bin/env node
/**
 * tools/validate.js —— 游戏数据校验（PLAN.md §4 质量门禁第 2 项）
 *
 * 零依赖，Node 运行：node tools/validate.js
 * 覆盖范围（按 docs/GAME_DESIGN.md §11 校验规则）：
 *   - Issue #12（已落地）：对话数据校验（规则 7 子集 + 数据形状）；
 *   - Issue #11（未落地）：地图/实体校验规则暂挂起（levels 为空时提示）。
 *
 * 退出码：0 = 全部通过；1 = 存在错误。
 */
'use strict';

const path = require('path');
const fs = require('fs');

const repoRoot = path.join(__dirname, '..');
const errors = [];
const warnings = [];

function err(msg) {
  errors.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}

/* ── 加载 data.js（IIFE 挂载到 globalThis.GAME） ── */
const GAME = (() => {
  const script = fs.readFileSync(path.join(repoRoot, 'js', 'data.js'), 'utf8');
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', script);
  fn(mod, mod.exports, require);
  return globalThis.GAME;
})();

const NODE_TYPES = ['intro', 'hint', 'npc', 'check', 'star', 'clear', 'sheep', 'cutscene'];

/* ── 1. GAME 形状 ── */
if (!GAME || typeof GAME !== 'object') {
  err('data.js 未导出 GAME 全局对象');
} else {
  if (!GAME.meta || typeof GAME.meta !== 'object') err('GAME.meta 缺失');
  if (!GAME.characters || typeof GAME.characters !== 'object') err('GAME.characters 缺失');
  if (!GAME.dialogue || typeof GAME.dialogue !== 'object') err('GAME.dialogue 缺失');
  if (!Array.isArray(GAME.levels)) err('GAME.levels 必须是数组');
  if (typeof GAME.saveKey !== 'string' || !GAME.saveKey) err('GAME.saveKey 缺失');
  if (!GAME.scenes || typeof GAME.scenes !== 'object') err('GAME.scenes 缺失');

  /* ── 2. 说话人字典 ── */
  if (GAME.characters) {
    for (const id of ['nar', 'all', 'byeori', 'lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin', 'dj', 'sheep']) {
      if (!GAME.characters[id]) err('characters 缺少说话人：' + id);
    }
    for (const id in GAME.characters) {
      const c = GAME.characters[id];
      if (typeof c.name !== 'string') err('characters.' + id + ' 缺少 name');
      if (typeof c.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(c.color)) {
        err('characters.' + id + ' 的 color 必须是 #RRGGBB：' + c.color);
      }
    }
  }

  /* ── 3. 对话节点（§11 规则 7 子集） ── */
  const charIds = GAME.characters ? Object.keys(GAME.characters) : [];
  const nodeIds = Object.keys(GAME.dialogue || {});
  const entryCount = {}; // trigger → entry:true 节点数

  if (GAME.dialogue) {
    for (const id of nodeIds) {
      const n = GAME.dialogue[id];
      const at = 'dialogue[' + id + '] ';

      if (!n || typeof n !== 'object') { err(at + '不是对象'); continue; }

      // type / trigger / lines
      if (!NODE_TYPES.includes(n.type)) err(at + 'type 非法：' + n.type);
      if (typeof n.trigger !== 'string' || !n.trigger) err(at + 'trigger 缺失');
      if (!Array.isArray(n.lines) || n.lines.length === 0) err(at + 'lines 缺失或为空');

      if (Array.isArray(n.lines)) {
        n.lines.forEach((line, i) => {
          if (!line || typeof line.s !== 'string' || typeof line.t !== 'string' || !line.t) {
            err(at + 'lines[' + i + '] 必须是 {s, t} 且 t 非空');
            return;
          }
          if (!charIds.includes(line.s)) err(at + 'lines[' + i + '].s 不在 characters 中：' + line.s);
        });
      }

      // once / entry / scopeId 类型
      if (n.once !== undefined && typeof n.once !== 'boolean') err(at + 'once 必须是布尔值');
      if (n.entry !== undefined && typeof n.entry !== 'boolean') err(at + 'entry 必须是布尔值');

      // trigger 取值约定（§7）
      const m = /^(npc|star|clear|load|sheep):(.+)$/.exec(n.trigger || '') || (n.trigger === 'cake' ? ['', 'cake'] : null);
      if (!m) {
        err(at + 'trigger 不符合取值约定：' + n.trigger);
      } else if (m[1] !== 'cake') {
        const kind = m[1];
        const expect = {
          intro: 'npc', hint: 'npc', npc: 'npc', check: 'npc',
          star: 'star', clear: 'clear', sheep: 'sheep', cutscene: 'load',
        };
        // cutscene 允许 cake（关 6 结局）
        if (expect[n.type] === 'npc' && kind !== 'npc') err(at + 'type ' + n.type + ' 的 trigger 必须是 npc:*');
        if (expect[n.type] === 'star' && kind !== 'star') err(at + 'type star 的 trigger 必须是 star:*');
        if (expect[n.type] === 'clear' && kind !== 'clear') err(at + 'type clear 的 trigger 必须是 clear:*');
        if (expect[n.type] === 'sheep' && kind !== 'sheep') err(at + 'type sheep 的 trigger 必须是 sheep:*');
        if (n.type === 'cutscene' && kind !== 'load' && n.trigger !== 'cake') err(at + 'type cutscene 的 trigger 必须是 load:* 或 cake');
      }

      // scopeId 与 trigger 后缀一致（clear/load 自动节点）
      if (n.scopeId !== undefined) {
        if (n.trigger === 'cake') {
          // 蛋糕结局：scopeId 为所属关卡（6）
          if (n.scopeId !== 6) err(at + 'cake 节点 scopeId 应为 6');
        } else if (m && m[1]) {
          const suffix = m[2];
          if (String(n.scopeId) !== String(suffix)) {
            err(at + 'scopeId(' + n.scopeId + ') 与 trigger 后缀(' + suffix + ')不一致');
          }
        }
      }

      // 入口唯一性（§7：同一 trigger 恰有一个 entry:true）
      if (n.entry === true) {
        const key = n.trigger;
        if (entryCount[key] === undefined) entryCount[key] = 1;
        else entryCount[key]++;
      }

      // next / options.goto 指向存在
      if (n.next !== undefined) {
        if (typeof n.next !== 'string' || !GAME.dialogue[n.next]) err(at + 'next 指向不存在的节点：' + n.next);
      }
      if (Array.isArray(n.options)) {
        if (n.options.length === 0) err(at + 'options 为空数组');
        n.options.forEach((opt, i) => {
          if (!opt || typeof opt.label !== 'string' || typeof opt.goto !== 'string') {
            err(at + 'options[' + i + '] 必须是 {label, goto}');
            return;
          }
          if (!GAME.dialogue[opt.goto]) err(at + 'options[' + i + '].goto 指向不存在的节点：' + opt.goto);
        });
      }

      // 类型专属约束
      if (n.type === 'sheep' && n.once !== true) err(at + 'sheep 节点必须 once:true');
      if (n.type === 'star' && n.once !== true) err(at + 'star 节点必须 once:true');
      if ((n.type === 'hint' || n.type === 'check') && n.once === true) err(at + 'hint/check 节点不应 once:true');
      if ((n.type === 'clear' || n.type === 'cutscene') && n.once !== true) err(at + 'clear/cutscene 节点应 once:true');
    }

    for (const key in entryCount) {
      if (entryCount[key] > 1) err('trigger ' + key + ' 存在 ' + entryCount[key] + ' 个 entry:true 入口（应恰有一个）');
    }
  }

  /* ── 4. 场景与 load 触发键对应 ── */
  if (GAME.scenes && GAME.dialogue) {
    for (const sceneId in GAME.scenes) {
      const key = 'load:' + sceneId;
      const found = nodeIds.some((id) => GAME.dialogue[id].trigger === key);
      if (!found) warn('场景 ' + sceneId + ' 没有对应的 load:' + sceneId + ' 对话节点');
    }
  }

  /* ── 5. 关卡（Issue #11 未落地时挂起） ── */
  if (Array.isArray(GAME.levels) && GAME.levels.length === 0) {
    warn('GAME.levels 为空：地图/实体校验规则（§11 规则 1–6、8–10）待 Issue #11 地图落地后启用');
  } else if (Array.isArray(GAME.levels)) {
    warn('GAME.levels 已有数据但地图校验规则尚未实现（Issue #11/#16）');
  }
}

/* ── 汇总 ── */
console.log('MIXXTOPIA 数据校验：' + nodeCount() + ' 个对话节点，' + errors.length + ' 个错误，' + warnings.length + ' 条提示');
for (const w of warnings) console.log('  ⚠ ' + w);
if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error('校验失败');
  process.exit(1);
} else {
  console.log('校验通过');
  process.exit(0);
}

function nodeCount() {
  return GAME && GAME.dialogue ? Object.keys(GAME.dialogue).length : 0;
}
