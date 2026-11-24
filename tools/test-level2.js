#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const v = require('./validate.js');
const full = v.loadGame().game;
const fullReport = v.makeReport(); v.rule7(full, fullReport);
assert.deepEqual(fullReport.warnings, [], '同名成员在两关出现时，必须按节点关卡匹配 NPC');
const game = v.selectLevel(full, 2);
const level = game.levels[0], enemies = level.entities.filter(e => e.type === 'enemy');
assert.equal(level.combat, true); assert.equal(enemies.length, 10);
assert.equal(new Set(enemies.map(e => e.id)).size, 10);
const spawn = level.entities.find(e => e.type === 'spawn');
assert.ok(enemies.every(e => Math.hypot(e.x - spawn.x, e.y - spawn.y) * 16 > e.aggro), '入口不能立即受到追击');
assert.equal(level.map.w, 240); assert.equal(level.map.h, 28);
for (const mutate of [c => c.centerY = 27, c => c.top = 0, c => c.bottom = 27, c => c.top = 11]) {
  const bad = JSON.parse(JSON.stringify(game)); mutate(bad.levels[0].corridor);
  const r = v.makeReport(); v.rule1(bad, r); assert.ok(r.errors.length > 0, '长廊与墙面参数必须在数据边界校验');
}
const exit = level.entities.find(e => e.type === 'portal');
assert.equal(level.ruins.id, 'aqueduct');
assert.equal(level.entities.find(e=>e.id==='s2_4').requiresRuins, 'aqueduct');
for (const mutate of [c=>c.dockX=219,c=>c.reward='missing',c=>c.basin.w=1,c=>c.raft='missing']) {
  const bad=JSON.parse(JSON.stringify(game));mutate(bad.levels[0].ruins);
  const r=v.makeReport();v.rule1(bad,r);assert.ok(r.errors.length>0,'水机关配置必须在边界拒绝');
}
const jammed=JSON.parse(JSON.stringify(level));
jammed.map.rows[8]=jammed.map.rows[8].slice(0,216)+'#'+jammed.map.rows[8].slice(217);
assert.notEqual(v.stateSearch(jammed,game.dialogue).status,'ok','滑轨被堵时不能假定机关可解');
assert.equal(level.corridor.vents.length, 4);
assert.deepEqual(Array.from(level.corridor.traps,t=>t.kind),['darts','spikes','spikes','darts','blade','darts']);
const arrowArrays=level.corridor.traps.filter(t=>t.kind==='darts');
assert.equal(arrowArrays.length,3,'整关恰好三个箭阵');
assert.ok(arrowArrays.every(t=>t.w===4),'每个箭阵四排');
for(const mutate of [t=>t.kind='unknown',t=>t.x=-1,t=>t.h=10,t=>t.offset=5,t=>t.dir=0]) {
  const bad=JSON.parse(JSON.stringify(game));mutate(bad.levels[0].corridor.traps[0]);
  const r=v.makeReport();v.rule1(bad,r);assert.ok(r.errors.length>0,'暗器配置必须在边界拒绝');
}
const spikes=level.corridor.traps.find(t=>t.kind==='spikes');
assert.equal(spikes.h,11,'两道刺带横贯主路，不能从旁边永久绕开');
assert.equal(spikes.w,2);
const secondSpikes=level.corridor.traps.filter(t=>t.kind==='spikes')[1];
assert.equal(secondSpikes.x-spikes.x-spikes.w,3,'两道间有三格完整的安全停留地面');
assert.ok(level.entities.find(e=>e.id==='blade-brake').x>level.corridor.traps.find(t=>t.kind==='blade').x+2,'制动杆在闸刃之后');
for(const trap of level.corridor.traps) {
  assert.ok(enemies.every(e=>e.x<trap.x-6 || e.x>=trap.x+trap.w+6),'暗器观察区不放进入警戒距离的敌人');
  assert.ok(level.corridor.vents.every(v=>v.x+v.w<=trap.x-5 || v.x>=trap.x+trap.w+5),'暗器两侧有不受蒸汽干扰的等待地面');
}
assert.ok(enemies.every(e=>e.x<spikes.x||e.x>=spikes.x+spikes.w||e.y<spikes.y||e.y>=spikes.y+spikes.h),'敌人初始位置不可自行触发刺带');
for (const vent of level.corridor.vents) {
  for (const entity of level.entities.filter(e => ['spawn', 'enemy', 'oil', 'lamp', 'star', 'portal'].includes(e.type))) {
    assert.ok(entity.x < vent.x || entity.x >= vent.x + vent.w || entity.y < vent.y || entity.y >= vent.y + vent.h,
      entity.id + ' 的初始站位不可被喷口覆盖，避免离屏自动清怪或强制受伤');
  }
}
for (const mutate of [v => v.h = 11, v => v.x = 60, v => v.offset = 5, v => v.id = '']) {
  const bad = JSON.parse(JSON.stringify(game)); mutate(bad.levels[0].corridor.vents[0]);
  const r = v.makeReport(); v.rule1(bad, r); assert.ok(r.errors.length > 0, '喷口不可堵满通道、压墙或缺失有效参数');
}
assert.ok(exit.x - spawn.x >= 220, '长廊从入口到出口至少跨越十一屏');
assert.equal(level.corridor.bottom - level.corridor.top + 1, 11, '主通道从七格加宽到十一格');
for (let x = 2; x <= 237; x++) {
  if ([60, 130, 200].includes(x)) continue; // 机关门仍以原单格控制通行。
  for (let y = 0; y < level.map.h; y++) {
    assert.equal(level.map.rows[y][x], y >= 5 && y <= 15 ? '·' : '#', '全长等宽，无路边凹位或局部加宽');
  }
}
assert.ok(enemies.every(e => e.y === 6 || e.y === 14), '敌人在通道内靠两侧墙分布');
assert.ok(enemies.some(e => e.y === 6) && enemies.some(e => e.y === 14));
// 逐段打开门，验证长廊不能绕门，灯油始终在自己的门前。
const gates = level.entities.filter(e => e.type === 'gate');
for (let opened = 0; opened <= 3; opened++) {
  const blocked = new Set(gates.slice(opened).map(g => g.x + ',' + g.y));
  const queue = [[spawn.x, spawn.y]], seen = new Set([spawn.x + ',' + spawn.y]);
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = nx + ',' + ny;
      if (seen.has(key) || blocked.has(key) || level.map.rows[ny]?.[nx] !== '·') continue;
      seen.add(key); queue.push([nx, ny]);
    }
  }
  for (let n = 1; n <= 3; n++) {
    const star = level.entities.find(e => e.id === 's2_' + n);
    assert.equal(seen.has(star.x + ',' + star.y), n <= opened, '门后星不能绕门提前拿');
    if (n === opened + 1) {
      for (const id of ['oil' + n, 'lamp' + n]) {
        const entity = level.entities.find(e => e.id === id);
        assert.ok(seen.has(entity.x + ',' + entity.y), id + ' 应在对应门前可达');
      }
    }
  }
  assert.equal(seen.has(exit.x + ',' + exit.y), opened === 3);
}
const R = v.makeReport(); R.scopeLevel = 2;
for (const name of ['checkBase', 'rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6', 'rule7', 'rule8', 'rule9', 'mechanismScope']) v[name](game, R);
assert.deepEqual(R.errors, []); assert.deepEqual(R.warnings, []);
assert.equal(v.stateSearch(game.levels[0], game.dialogue).status, 'ok');
const lamps = level.entities.filter(e => e.type === 'lamp');
const LanternPuzzle = require('../js/lantern.js');
assert.equal(level.entities.filter(e => e.type === 'rune' || e.id?.startsWith('rune-clue')).length, 0, '不再通过地面符文或谜语牌解题');
assert.deepEqual(Array.from(lamps, l => l.puzzle.mirrors.length), [4, 8, 10]);
assert.deepEqual(Array.from(lamps, l => l.puzzle.receivers.length), [2, 4, 5]);
assert.deepEqual(Array.from(lamps, l => l.puzzle.paired === true), [false, false, false], '第二灯使用互斥分组而非独立镜对');
assert.deepEqual(Array.from(lamps, l => l.puzzle.assist), [true, true, true], '三个灯柱均提供主动提示和帮走');
for (const [stage, lamp] of lamps.entries()) {
  assert.equal(LanternPuzzle.validate(lamp.puzzle), '');
  if (stage === 1) {
    assert.deepEqual(Array.from(lamp.puzzle.groups, g => Array.from(g.members)), [[0, 2, 4], [1, 3, 6], [5, 7]]);
    for (const [i, mirror] of lamp.puzzle.mirrors.entries()) {
      const groups = lamp.puzzle.groups.filter(g => g.members.includes(i));
      assert.equal(groups.length, 1, '每面镜子只能属于一个组'); assert.equal(mirror.links.length, 0);
      const probe = new LanternPuzzle(lamp.puzzle), before = probe.angles.slice(); probe.rotate(i);
      assert.deepEqual(Array.from(probe.angles, (a, j) => a !== before[j] ? j : -1).filter(j => j >= 0), Array.from(groups[0].members).sort((a, b) => a - b), '点击任意成员必须只转动整组');
      probe.undo(); assert.deepEqual(Array.from(probe.angles), Array.from(before));
    }
  }
  const board = new LanternPuzzle(lamp.puzzle), original = JSON.stringify(lamp.puzzle);
  assert.equal(board.result.solved, false, '初始棋盘不能已解开');
  const once = new LanternPuzzle(lamp.puzzle);
  for (let i = 0; i < lamp.puzzle.mirrors.length; i++) once.rotate(i);
  if (stage === 2) assert.equal(once.result.solved, false, '进阶棋盘各点一次不能直接通关');
  const solution = LanternPuzzle.solution(lamp.puzzle);
  assert.ok(solution, lamp.id + ' 应有光路解');
  assert.equal(solution.length, [3, 3, 8][stage], '仅第二灯简化，第一和第三灯保持原难度');
  const repeat = new LanternPuzzle(lamp.puzzle), repeatInitial = Array.from(repeat.angles);
  for (let i = 0; i < 20; i++) repeat.rotate(repeat.selected);
  assert.equal(repeat.selected, 0); assert.equal(repeat.result.solved, false, '连续 E 只反复旋转同一组，不能自动通关');
  assert.deepEqual(Array.from(repeat.angles), repeatInitial);
  board.selected = lamp.puzzle.mirrors.length - 1;
  const unchanged = JSON.stringify({ angles: board.angles, moves: board.moves, history: board.history, result: board.result });
  const selected = board.selected; board.requestHint(); assert.equal(board.selected, selected, '提示不能自动改选镜面');
  assert.equal(JSON.stringify({ angles: board.angles, moves: board.moves, history: board.history, result: board.result }), unchanged);
  {
    assert.equal(board.hint.action, solution[0]);
    board.rotate(board.hint.action); assert.equal(board.hint, null);
    const hintedFlips = board.angles.map((a, i) => a !== lamp.puzzle.mirrors[i].angle ? i : -1).filter(i => i >= 0);
    assert.equal(LanternPuzzle.solution(lamp.puzzle, hintedFlips).length, solution.length - 1);
    board.requestHint(); assert.equal(board.hint.action, LanternPuzzle.solution(lamp.puzzle, hintedFlips)[0]);
  }
  board.reset(); assert.equal(board.hint, null);
  const before = board.angles.slice(); board.rotate(0);
  assert.equal(board.angles.filter((a, i) => a !== before[i]).length, stage === 0 ? 2 : 3, '第二灯转整组，第一和第三灯保持原联动数量');
  board.undo(); assert.deepEqual(board.angles, before);
  for (const i of solution) board.rotate(i);
  assert.equal(board.result.solved, true); assert.equal(board.result.lit.length, lamp.puzzle.receivers.length);
  assert.equal(JSON.stringify(lamp.puzzle), original, '旋镜不能污染关卡配置');
}
const noPath = JSON.parse(JSON.stringify(level));
noPath.entities.find(e => e.id === 'lamp1').puzzle.goal = { x: 2, y: 4 };
assert.equal(v.stateSearch(noPath, game.dialogue).status, 'fail', '无解棋盘不能被状态搜索当作可开门');
const solved = new LanternPuzzle(lamps[0].puzzle);
for (const i of LanternPuzzle.solution(lamps[0].puzzle)) solved.rotate(i);
const outOfOrder = JSON.parse(JSON.stringify(lamps[0].puzzle));
[outOfOrder.receivers[0], outOfOrder.receivers[1]] = [outOfOrder.receivers[1], outOfOrder.receivers[0]];
const wrongOrder = new LanternPuzzle(outOfOrder); wrongOrder.angles = solved.angles.slice();
assert.equal(wrongOrder.trace().reached, true); assert.equal(wrongOrder.trace().orderFault, true);
assert.equal(wrongOrder.trace().solved, false, '到出口但灯芯顺序错误不能完成');
const blocked = JSON.parse(JSON.stringify(lamps[0].puzzle)); blocked.blocks.push({ x: 3, y: 1 });
const stopped = new LanternPuzzle(blocked); stopped.angles = solved.angles.slice();
assert.equal(stopped.trace().blocked, true); assert.equal(stopped.trace().solved, false);
const unreachable = JSON.parse(JSON.stringify(lamps[0].puzzle));
unreachable.mirrors[0].angle ^= 1; // 单独翻一面，破坏该对的相对镜向，配对转动无法修复。
assert.equal(LanternPuzzle.solution(unreachable), null, '光路有解但联动操作不可达也必须拒绝');
for (const mutate of [c => c.mirrors[0].angle = 7, c => c.receivers[0].x = 99, c => c.goal = c.mirrors[0], c => c.mirrors[0].links = [99], c => c.assist = 'yes']) {
  const bad = JSON.parse(JSON.stringify(game)); mutate(bad.levels[0].entities.find(e => e.id === 'lamp1').puzzle);
  const r = v.makeReport(); v.rule5(bad, r); assert.ok(r.errors.length > 0);
}
for (const links of [[1, 2], [2]]) {
  const bad = JSON.parse(JSON.stringify(game)); bad.levels[0].entities.find(e => e.id === 'lamp2').puzzle.mirrors[0].links = links;
  const r = v.makeReport(); v.rule5(bad, r); assert.ok(r.errors.length > 0, '分组镜面不能叠加额外关联');
}
for (const mutate of [c => c.groups[1].members.push(0), c => c.groups[0].members.pop(), c => c.groups[0].members[0] = 99]) {
  const bad = JSON.parse(JSON.stringify(game)); mutate(bad.levels[0].entities.find(e => e.id === 'lamp2').puzzle);
  const r = v.makeReport(); v.rule5(bad, r); assert.ok(r.errors.length > 0, '拒绝重复分组、漏分组和无效成员');
}
assert.deepEqual(Array.from(lamps, l => l.puzzle.version), [3, 5, 2]);
assert.deepEqual(Array.from(lamps[0].puzzle.mirrors, m => m.angle), [1, 0, 1, 1], '第一灯镜向恢复');
assert.deepEqual(Array.from(lamps[0].puzzle.mirrors, m => Array.from(m.links)), [[1], [2], [3], [2]], '第一灯原联动恢复');
assert.deepEqual(Array.from(lamps[2].puzzle.mirrors, m => Array.from(m.links)), [[5, 6], [0, 8], [0, 8], [2, 8], [5, 6], [7, 8], [0, 2], [2, 3], [1, 5], [1, 7]], '第三灯原联动恢复');
for (const type of ['oil', 'lamp']) {
  for (const duplicate of [false, true]) {
    const bad = JSON.parse(JSON.stringify(game));
    const entities = bad.levels[0].entities.filter(e => e.type === type);
    entities[0].id = duplicate ? entities[1].id : '';
    const r = v.makeReport(); v.rule5(bad, r);
    assert.ok(r.errors.some(e => e.msg.includes('字符串 id')));
  }
}
// 油被锁在对应门后时不能通过；防止日后改图把供应链误接成死锁。
for (let n = 1; n <= 3; n++) {
  const level = JSON.parse(JSON.stringify(game.levels[0]));
  const oil = level.entities.find(e => e.id === 'oil' + n);
  const star = level.entities.find(e => e.id === 's2_' + n);
  oil.x = star.x; oil.y = star.y;
  assert.equal(v.stateSearch(level, game.dialogue).status, 'fail', '门 ' + n + ' 后的油不能用于开自己');
}
console.log('第二关数据、三组独立光路棋盘与完整状态搜索通过；无解棋盘、无效配置和锁油反例均被拒绝。');
