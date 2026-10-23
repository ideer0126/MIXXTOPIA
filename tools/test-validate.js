#!/usr/bin/env node
/** §11 校验器的错误数据回归：node tools/test-validate.js */
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const { validateGame, validateProject, formatIssue } = require('./validate.js');

function fixture() {
  const muses = ['lily', 'haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin'];
  const npcs = [[], [...muses, 'byeori'], ['jiwoo', 'byeori'], ['kyujin', 'dj', 'byeori'],
    [...muses, 'byeori'], [...muses, 'byeori'], [...muses, 'byeori']];
  const game = { scenes: { p0: {} }, characters: { nar: {} }, levels: [], dialogue: {} };
  for (let id = 1; id <= 6; id++) {
    const starCount = [0, 3, 4, 4, 4, 5, 5][id];
    const entities = [
      { type: 'spawn', x: 1, y: 1 },
      { type: id === 6 ? 'cake' : 'portal', x: 38, y: 26, to: id + 1 },
      ...Array.from({ length: starCount }, (_, i) => ({ type: 'star', id: `l${id}s${i}`, x: i + 2, y: 2 })),
      ...npcs[id].map((name, i) => ({ type: 'npc', id: name, x: i + 1, y: 3, dialogue: `l${id}.npc.${name}` })),
      { type: 'sheep', id: `sheep${id}`, x: 1, y: 4, dialogue: `l${id}.sheep` },
    ];
    const level = { id, starCount, map: { w: 40, h: 28, rows: Array(28).fill('·'.repeat(40)),
      legend: { '#': 'wall', '·': 'floor', '~': 'water' } }, entities };
    if (id === 2) {
      for (let i = 0; i < 3; i++) entities.push(
        { type: 'gate', id: `gate${i}`, x: i + 1, y: 5, open: false },
        { type: 'lamp', id: `lamp${i}`, x: i + 1, y: 6, target: `gate${i}`, lit: false },
        { type: 'oil', x: i + 1, y: 7 });
    }
    for (const entity of entities.filter((item) => item.dialogue)) {
      game.dialogue[entity.dialogue] = { type: entity.type, trigger: `${entity.type}:${entity.id}`,
        once: true, lines: [{ s: 'nar', t: '愿望之星' }] };
    }
    game.levels.push(level);
  }
  game.dialogue.p0 = { type: 'cutscene', trigger: 'load:p0', scopeId: 'p0', entry: true,
    once: true, lines: [{ s: 'nar', t: '生日夜' }] };
  return game;
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}
function rejects(rule, levelId, entityId, mutate) {
  const game = fixture();
  mutate(game);
  const result = validateGame(game);
  const error = result.errors.find((item) => item.rule === rule &&
    String(item.levelId) === String(levelId) && item.entityId === entityId);
  assert.ok(error, `未拒绝 §11.${rule} ${levelId}/${entityId}: ${result.errors.map(formatIssue).join('\n')}`);
  assert.ok(formatIssue(error).includes(String(levelId)) && formatIssue(error).includes(entityId));
}
const entity = (game, level, name) => game.levels[level - 1].entities.find((item) => item.id === name || item.type === name);

test('结构合法的六关数据不产生错误，机制搜索仍明确待完成', () => {
  const game = fixture();
  const before = JSON.stringify(game);
  const result = validateGame(game);
  assert.deepStrictEqual(result.errors, []);
  assert.deepStrictEqual(result.pending.map((item) => item.rule), [9]);
  assert.strictEqual(JSON.stringify(game), before, '不得改写关卡数据');
});

const cases = [
  [1, 1, 'map', (game) => { game.levels[0].map.w = 39; }],
  [1, 1, 'map.rows[0]', (game) => { game.levels[0].map.rows[0] = '·'; }],
  [2, 1, 'tile(0,0)', (game) => { game.levels[0].map.rows[0] = '?' + '·'.repeat(39); }],
  [2, 1, 'l1s0', (game) => { game.levels[0].map.rows[2] = '··#' + '·'.repeat(37); }],
  [2, 1, 'l1s0', (game) => { entity(game, 1, 'l1s0').x = -1; }],
  [3, 1, 'starCount', (game) => { game.levels[0].starCount = 4; }],
  [3, 2, 'l1s0', (game) => { entity(game, 2, 'l2s0').id = 'l1s0'; }],
  [3, '全局', 'starCount', (game) => {
    game.levels[5].entities = game.levels[5].entities.filter((item) => item.id !== 'l6s4'); game.levels[5].starCount = 4; }],
  [4, 1, 'spawn', (game) => { game.levels[0].entities.push({ type: 'spawn', x: 2, y: 1 }); }],
  [4, 1, 'portal[1]', (game) => { entity(game, 1, 'portal').to = 3; }],
  [4, 6, 'cake', (game) => { game.levels[5].entities = game.levels[5].entities.filter((item) => item.type !== 'cake'); }],
  [5, 2, 'lamp0', (game) => { entity(game, 2, 'lamp0').target = 'missing'; }],
  [5, 1, 'sw', (game) => { game.levels[0].entities.push({ type: 'switch', id: 'sw', x: 1, y: 8, target: 'missing' }); }],
  [5, 1, 'region', (game) => { game.levels[0].entities.push({ type: 'trigger', id: 'region', rect: { x: 39, y: 0, w: 2, h: 1 } }); }],
  [5, 2, 'oil', (game) => { game.levels[1].entities = game.levels[1].entities.filter((item) => item.type !== 'oil'); }],
  [6, 3, 'oneway[10]', (game) => { game.levels[2].entities.push({ type: 'oneway', x: 1, y: 8, dir: 'NE' }); }],
  [6, 6, 'badWind', (game) => { game.levels[5].entities.push({ type: 'wind', id: 'badWind', x: 1, y: 8, dir: 'up' }); }],
  [6, 4, 'water@0,0', (game) => { game.levels[3].map.rows[0] = '~' + '·'.repeat(39); }],
  [6, 4, 'badWater', (game) => { game.levels[3].entities.push({ type: 'water', id: 'badWater', x: 0, y: 0, shallow: 'yes', waterLevel: 'low' }); }],
  [6, 4, 'stone', (game) => { game.levels[3].entities.push({ type: 'stepstone', id: 'stone', x: 0, y: 0 }); }],
  [7, 1, 'lily', (game) => { entity(game, 1, 'lily').dialogue = 'missing'; }],
  [7, 1, 'l1.npc.lily', (game) => { game.dialogue['l1.npc.lily'].next = 'missing'; }],
  [7, 1, 'l1.npc.lily', (game) => { game.dialogue['l1.npc.lily'].options = [{ label: '走', goto: 'missing' }]; }],
  [7, 1, 'l1.npc.lily', (game) => { game.dialogue['l1.npc.lily'].options = [{ label: '走' }]; }],
  [7, 1, 'l1.npc.lily', (game) => { game.dialogue['l1.npc.lily'].options = {}; }],
  [7, 1, 'l1.npc.lily', (game) => { game.dialogue['l1.npc.lily'].lines = {}; }],
  [7, 1, 'l1.npc.lily', (game) => { game.dialogue['l1.npc.lily'] = null; }],
  [7, 1, 'l1.npc.lily', (game) => { game.dialogue['l1.npc.lily'].lines[0].s = 'unknown'; }],
  [7, 1, 'l1.npc.lily', (game) => { game.dialogue['l1.npc.lily'].trigger = 'star:l1s0'; }],
  [7, 1, 'l1.npc.lily', (game) => { game.dialogue['l1.npc.lily'].trigger = 'npc:missing'; }],
  [7, 1, 'l1.sheep', (game) => { game.dialogue['l1.sheep'].trigger = 'sheep:sheep2'; }],
  [7, 1, 'sheep1', (game) => { entity(game, 1, 'sheep1').dialogue = 'l2.sheep'; }],
  [7, 1, 'l1.npc.lily', (game) => { game.dialogue['l1.npc.lily'].entry = true; }],
  [7, 'p0', 'p0', (game) => { game.dialogue.p0.scopeId = 1; }],
  [7, 'p0', 'p0', (game) => { game.dialogue.p0.entry = false; }],
  [7, 'p0', 'p0.tail', (game) => { game.dialogue['p0.tail'] = { ...game.dialogue.p0, entry: false }; }],
  [7, 1, 'l1.npc.lily', (game) => { game.dialogue.p0.next = 'l1.npc.lily'; }],
  [8, 1, 'npc', (game) => { game.levels[0].entities = game.levels[0].entities.filter((item) => item.id !== 'lily'); }],
  [8, 1, 'sheep', (game) => { game.levels[0].entities = game.levels[0].entities.filter((item) => item.type !== 'sheep'); }],
  [10, '全局', 'GAME.dialogue.p0.lines.0.t', (game) => { game.dialogue.p0.lines[0].t = '收集玻璃碎片'; }],
];
for (const [rule, levelId, entityId, mutate] of cases) {
  test(`规则 ${rule} 拒绝错误数据并定位 ${levelId}/${entityId}`, () => rejects(rule, levelId, entityId, mutate));
}

test('合法水域叠放、水面星星、自动对话 next 链与伪说话人被接受', () => {
  const game = fixture();
  const level = game.levels[3];
  level.map.rows[2] = '··~' + '·'.repeat(37);
  level.entities.push({ type: 'water', x: 2, y: 2, shallow: true, waterLevel: 'high' },
    { type: 'stepstone', x: 2, y: 2 });
  game.dialogue.p0.next = 'p0.tail';
  game.dialogue['p0.tail'] = { ...game.dialogue.p0, next: undefined, entry: false };
  assert.deepStrictEqual(validateGame(game).errors, []);
});

test('空关卡不会通过完整校验，现有 46 个对话节点可独立检查', () => {
  const result = validateProject();
  assert.deepStrictEqual(result.errors, []);
  assert.deepStrictEqual([...new Set(result.pending.map((item) => item.rule))].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('UI / 存档文案检查覆盖传入的源文件', () => {
  const result = validateGame(fixture(), { 'index.html': '<p>玻璃碎片</p>' });
  assert.ok(result.errors.some((item) => item.rule === 10 && item.entityId === 'index.html'));
});

test('CLI 默认因待完成项退出 1，显式开发模式退出 0，未知选项拒绝', () => {
  for (const [args, status] of [[[], 1], [['--allow-incomplete'], 0], [['--typo'], 1]]) {
    const result = spawnSync(process.execPath, [require.resolve('./validate.js'), ...args], { encoding: 'utf8' });
    assert.strictEqual(result.status, status, result.stderr);
    if (!args.length) assert.ok(result.stderr.includes('§11.9') && result.stdout.includes('待完成项'));
  }
});

console.log(`全部通过：${passed} 项`);
