#!/usr/bin/env node
/**
 * GAME_DESIGN.md §11 数据校验。零依赖，运行：node tools/validate.js
 * --allow-incomplete：允许地图尚未接入 / 机制搜索预留，但始终报告待完成项。
 * 默认命令在有错误或待完成项时退出 1，不能把空关卡当作完整验收通过。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MUSES = ['lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin'];
const NPCS = [null, [...MUSES, 'byeori'], ['jiwoo', 'byeori'],
  ['kyujin', 'dj', 'byeori'], [...MUSES, 'byeori'], [...MUSES, 'byeori'], [...MUSES, 'byeori']];
const TRIGGERS = {
  intro: ['npc'], hint: ['npc'], npc: ['npc'], check: ['npc'], star: ['star'],
  clear: ['clear'], sheep: ['sheep'], cutscene: ['load', 'trigger', 'cake'],
};
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const scopeOf = (id) => /^l(\d+)\./.exec(id)?.[1] || id.split('.')[0];
const entityName = (entity, index) => entity.id || `${entity.type}[${index}]`;

function formatIssue(issue) {
  return `[§11.${issue.rule}][关卡/场景 ${issue.levelId}][实体/节点 ${issue.entityId}] ${issue.message}`;
}

function validateGame(game, copySources = {}) {
  const errors = [];
  const pending = [];
  const issue = (rule, levelId, entityId, message) => ({ rule, levelId, entityId, message });
  const fail = (rule, levelId, entityId, message) => errors.push(issue(rule, levelId, entityId, message));
  const defer = (rule, levelId, entityId, message) => pending.push(issue(rule, levelId, entityId, message));
  if (!game || typeof game !== 'object') {
    fail(1, '全局', 'GAME', 'GAME 必须是对象');
    return { errors, pending };
  }
  const levels = Array.isArray(game.levels) ? game.levels : [];
  const dialogue = game.dialogue || {};
  const characters = game.characters || {};
  const scenes = game.scenes || {};
  const levelIds = new Set(levels.map((level) => String(level.id)));
  const stars = new Set();
  const sheepIds = new Set();
  const empty = Array.isArray(game.levels) && levels.length === 0;

  if (!Array.isArray(game.levels)) fail(1, '全局', 'levels', 'levels 必须是数组');
  if (empty) {
    for (const rule of [1, 2, 3, 4, 5, 6, 8]) defer(rule, '1–6', 'levels', '地图与实体尚未接入（Issue #11）');
    defer(7, '1–6', 'levels', '对话的实体引用与关卡作用域待地图接入后校验');
  } else {
    if (levels.length !== 6 || levelIds.size !== 6 ||
        levels.some((level) => !Number.isInteger(level.id) || level.id < 1 || level.id > 6)) {
      fail(4, '全局', 'levels', '必须包含 ID 1–6 各一次的六个关卡');
    }
  }
  for (const id of Object.keys(scenes)) {
    if (levelIds.has(id)) fail(7, id, 'scenes', '场景与关卡 ID 的字符串形式不得重名');
  }

  let totalStars = 0;
  for (const level of levels) {
    const id = level.id;
    const map = level.map || {};
    const rows = Array.isArray(map.rows) ? map.rows : [];
    const legend = map.legend || {};
    const entities = Array.isArray(level.entities) ? level.entities : [];
    const ofType = (type) => entities.filter((entity) => entity.type === type);
    const inside = (x, y) => Number.isInteger(x) && Number.isInteger(y) &&
      x >= 0 && y >= 0 && x < map.w && y < map.h;
    const hasAt = (type, x, y) => ofType(type).filter((entity) => entity.x === x && entity.y === y);
    if (!Array.isArray(level.entities)) fail(2, id, 'entities', 'entities 必须是数组');
    if (!Number.isInteger(map.w) || !Number.isInteger(map.h) || map.w < 40 || map.h < 28 || rows.length !== map.h) {
      fail(1, id, 'map', '地图尺寸必须 ≥ 40×28，行数必须等于 h');
    }
    rows.forEach((row, y) => {
      if (typeof row !== 'string' || row.length !== map.w) fail(1, id, `map.rows[${y}]`, '行宽必须等于 w');
      if (typeof row !== 'string') return;
      for (let x = 0; x < row.length; x++) {
        if (!own(legend, row[x])) fail(2, id, `tile(${x},${y})`, `字符 ${row[x]} 未在 legend 定义`);
        if (id === 4 && row[x] === '~' && hasAt('water', x, y).length !== 1) {
          fail(6, id, `water@${x},${y}`, '每个 ~ 格必须恰有一个 WATER');
        }
      }
    });

    const levelStars = ofType('star');
    totalStars += levelStars.length;
    if (level.starCount !== levelStars.length || level.starCount < 3 || level.starCount > 5) {
      fail(3, id, 'starCount', 'starCount 必须等于 star 实体数且在 3–5 之间');
    }
    for (const type of ['spawn', id === 6 ? 'cake' : 'portal']) {
      if (ofType(type).length !== 1) fail(4, id, type, `${type} 必须恰有一个`);
    }
    if (id === 6 && ofType('portal').length) fail(4, id, 'portal', '关 6 不得有传送门');
    if (id === 2) {
      for (const type of ['lamp', 'oil', 'gate']) {
        if (ofType(type).length !== 3) fail(5, id, type, '关 2 灯柱、灯油、门必须各有 3 个');
      }
    }
    const seenIds = new Set();
    entities.forEach((entity, index) => {
      const name = entityName(entity, index);
      if (entity.id) {
        if (seenIds.has(entity.id)) fail(2, id, name, '同关实体 ID 重复');
        seenIds.add(entity.id);
      }
      if (entity.type !== 'trigger') {
        if (!inside(entity.x, entity.y)) fail(2, id, name, '实体坐标必须是地图范围内的整数');
        else {
          const tile = rows[entity.y]?.[entity.x];
          if (tile === '#' || legend[tile] === 'wall') fail(2, id, name, '实体位于永久不可通行的墙上');
        }
      }
      if (entity.type === 'star') {
        if (typeof entity.id !== 'string' || !entity.id || stars.has(entity.id)) fail(3, id, name, 'star ID 必须非空且全局唯一');
        stars.add(entity.id);
      }
      if (entity.type === 'portal' && (!levelIds.has(String(entity.to)) || entity.to !== id + 1)) {
        fail(4, id, name, `portal.to=${entity.to} 必须引用关卡 ${id + 1}`);
      }
      if (['switch', 'lamp'].includes(entity.type) &&
          !ofType('gate').some((gate) => gate.id && gate.id === entity.target)) {
        fail(5, id, name, `target=${entity.target} 没有对应的 gate`);
      }
      if (entity.type === 'trigger') {
        const rect = entity.rect || {};
        if (![rect.x, rect.y, rect.w, rect.h].every(Number.isInteger) ||
            rect.x < 0 || rect.y < 0 || rect.w <= 0 || rect.h <= 0 ||
            rect.x + rect.w > map.w || rect.y + rect.h > map.h) {
          fail(5, id, name, 'trigger.rect 必须完整落在地图范围内');
        }
      }
      if (['oneway', 'wind'].includes(entity.type) && !['N', 'E', 'S', 'W'].includes(entity.dir)) {
        fail(6, id, name, `dir=${entity.dir} 必须是 N/E/S/W`);
      }
      if (entity.type === 'water' && (rows[entity.y]?.[entity.x] !== '~' ||
          typeof entity.shallow !== 'boolean' || entity.waterLevel !== 'high')) {
        fail(6, id, name, 'WATER 必须位于 ~ 格，shallow 为布尔值，初始 waterLevel 为 high');
      }
      if (entity.type === 'stepstone' && hasAt('water', entity.x, entity.y).length !== 1) {
        fail(6, id, name, 'STEPSTONE 必须与一个 WATER 同格');
      }
      if (['npc', 'sheep', 'trigger'].includes(entity.type) && !own(dialogue, entity.dialogue)) {
        fail(7, id, name, `dialogue=${entity.dialogue} 不存在`);
      }
      if (entity.type === 'sheep') {
        const node = dialogue[entity.dialogue];
        if (!entity.id || sheepIds.has(entity.id)) fail(7, id, name, '黑羊 ID 必须非空且全局唯一');
        sheepIds.add(entity.id);
        if (entity.id !== `sheep${id}` || entity.dialogue !== `l${id}.sheep` ||
            !node || node.type !== 'sheep' || node.once !== true || node.trigger !== `sheep:${entity.id}`) {
          fail(7, id, name, '黑羊必须绑定本关 lN.sheep、once:true 与 sheep:<实体id>');
        }
      }
    });
    const actualNpcs = ofType('npc').map((entity) => entity.id).sort();
    if (JSON.stringify(actualNpcs) !== JSON.stringify([...(NPCS[id] || [])].sort())) {
      fail(8, id, 'npc', `NPC 出场必须为 ${(NPCS[id] || []).join(', ')}`);
    }
    if (ofType('sheep').length !== 1) fail(8, id, 'sheep', '每关必须恰有一只黑羊');
  }
  if (!empty && totalStars !== 25) fail(3, '全局', 'starCount', `总星数必须为 25，实际 ${totalStars}`);

  const groups = new Map();
  for (const [nodeId, node] of Object.entries(dialogue)) {
    const scope = scopeOf(nodeId);
    const error = (message) => fail(7, scope, nodeId, message);
    if (!node || typeof node !== 'object') {
      error('对话节点必须是对象');
      continue;
    }
    const match = /^(npc|star|sheep|trigger|clear|load):(.+)$/.exec(node.trigger);
    const event = node.trigger === 'cake' ? 'cake' : match?.[1];
    const target = match?.[2];
    if (!own(TRIGGERS, node.type) || !TRIGGERS[node.type].includes(event)) error(`type=${node.type} 与 trigger=${node.trigger} 不符合 §7`);
    if (own(TRIGGERS, node.type) && node.once !== !['hint', 'check'].includes(node.type)) error('once 与 §7 节点类型约定不符');
    if (node.next !== undefined && !own(dialogue, node.next)) error(`对话引用 ${node.next} 不存在`);
    if (node.options !== undefined && !Array.isArray(node.options)) error('options 必须是数组');
    for (const [index, option] of (Array.isArray(node.options) ? node.options : []).entries()) {
      if (!option || !own(dialogue, option.goto)) error(`options[${index}].goto=${option?.goto} 不存在`);
    }
    if (!Array.isArray(node.lines) || node.lines.length === 0) error('lines 必须是非空数组');
    for (const [index, line] of (Array.isArray(node.lines) ? node.lines : []).entries()) {
      if (!line || !own(characters, line.s)) error(`lines[${index}].s=${line?.s} 不在 characters 字典`);
    }
    const level = levels.find((item) => String(item.id) === scope);
    if (!level && !own(scenes, scope) && !(empty && /^[1-6]$/.test(scope))) error('节点 ID 没有对应关卡/场景');
    if (['clear', 'load'].includes(event)) {
      const exists = levelIds.has(target) || (event === 'load' && own(scenes, target));
      if (String(node.scopeId) !== target || scope !== target ||
          (!exists && !(empty && /^[1-6]$/.test(target)))) error('自动触发的 scopeId、后缀、节点 ID 与所属作用域必须一致');
      if (!groups.has(node.trigger)) groups.set(node.trigger, []);
      groups.get(node.trigger).push(nodeId);
    } else if (node.entry !== undefined) error('entry 仅适用于 clear:/load:');
    if (['npc', 'star', 'sheep', 'trigger', 'cake'].includes(event) && level) {
      const entities = level.entities || [];
      const entity = entities.find((item) => item.type === event && (event === 'cake' || item.id === target));
      if (!entity) error(`trigger=${node.trigger} 没有对应的本关实体`);
      if (event === 'sheep' && entity && entity.dialogue !== nodeId) error(`黑羊 ${target} 的 dialogue 未指回此节点`);
    }
    if (event === 'sheep' && (nodeId !== `l${scope}.sheep` || target !== `sheep${scope}`)) error('黑羊触发与节点所属关卡不一致');
  }
  for (const [trigger, ids] of groups) {
    const entries = ids.filter((id) => dialogue[id].entry === true);
    if (entries.length !== 1) fail(7, scopeOf(ids[0]), ids.join(','), `${trigger} 必须恰有一个 entry:true 入口`);
    const reached = new Set();
    let id = entries[0];
    while (id && own(dialogue, id) && !reached.has(id)) {
      const node = dialogue[id];
      if (!node || typeof node !== 'object') break;
      if (node.trigger !== trigger || String(node.scopeId) !== trigger.split(':')[1]) {
        fail(7, scopeOf(id), id, '自动对话 next 链必须保持相同 trigger 与 scopeId');
        break;
      }
      reached.add(id);
      id = node.next;
    }
    for (const member of ids) {
      if (!reached.has(member)) fail(7, scopeOf(member), member, `${trigger} 的节点无法从入口经 next 到达`);
    }
  }

  // 规则 9 明确要求正式机制状态图；地图 / #9 引擎机制未落地前不以 flood fill 冒充。
  defer(9, '1–6', 'levels', '机制状态搜索尚未实现（§11 预留）；开门、推箱、单向门、水位/落水、风向与剧情条件的同次通关路径待验证');

  function checkCopy(value, location) {
    if (typeof value === 'string' && /玻璃碎片/.test(value)) fail(10, '全局', location, '仍含旧文案「玻璃碎片」');
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) checkCopy(item, `${location}.${key}`);
    }
  }
  checkCopy(game, 'GAME');
  for (const [file, source] of Object.entries(copySources)) checkCopy(source, file);
  return { errors, pending };
}

function validateProject() {
  const root = path.join(__dirname, '..');
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), sandbox, { filename: 'js/data.js', timeout: 1000 });
  const copySources = Object.fromEntries(['index.html', 'js/main.js'].map((file) =>
    [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  return validateGame(sandbox.GAME, copySources);
}

module.exports = { validateGame, validateProject, formatIssue };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--allow-incomplete')) {
    console.error('用法：node tools/validate.js [--allow-incomplete]');
    process.exitCode = 1;
  } else {
    const result = validateProject();
    for (const error of result.errors) console.error('错误 ' + formatIssue(error));
    for (const item of result.pending) console.warn('待完成 ' + formatIssue(item));
    console.log(`数据校验：${result.errors.length} 个错误，${result.pending.length} 个待完成项`);
    process.exitCode = result.errors.length || (result.pending.length && !args.includes('--allow-incomplete')) ? 1 : 0;
  }
}
