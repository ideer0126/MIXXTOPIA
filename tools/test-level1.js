#!/usr/bin/env node
/** 第一关校验回归：单关模式、严格全量门禁、剧情条件与不可达反例。 */
'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const v = require('./validate.js');
const { game } = v.loadGame();
const clone = value => JSON.parse(JSON.stringify(value));
let count = 0;
function test(name, fn) { fn(); count++; console.log('  ✓ ' + name); }
function report(g, scoped) {
  const R = v.makeReport();
  if (scoped) R.scopeLevel = 1;
  for (const name of ['checkBase', 'rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6', 'rule7', 'rule8', 'rule9']) v[name](g, R);
  return R;
}

test('真实第一关通过尺寸/实体/星数/引用/剧情状态图校验，无警告', () => {
  const R = report(v.selectLevel(game, 1), true);
  assert.deepEqual(R.errors, []);
  assert.deepEqual(R.warnings, []);
});
test('场景图集路径有效、透明 alpha 保留、所有取样框均在原图内', () => {
  const level = game.levels[0];
  const dims = {};
  for (const [key, src] of Object.entries(level.sceneryAssets)) {
    const png = fs.readFileSync(path.join(__dirname, '..', src));
    if (key === 'cover') { assert.equal(png.readUInt16BE(0), 0xffd8); continue; }
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    dims[key] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    if (!['mural','birthdayHall'].includes(key)) assert.equal(png[25], 6, '透明图集必须保留 RGBA');
  }
  for (const d of level.decorations) {
    for (const [key, frame] of [[d.art, d.frame], [d.litArt, d.litFrame]]) {
      if (!key || !frame) continue;
      const [x, y, w, h] = frame;
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= dims[key][0] && y + h <= dims[key][1], d.kind);
    }
  }
  for (const pair of level.party.sprites) for (const [x,y,w,h] of pair) {
    assert.ok(x>=0 && y>=0 && w>0 && h>0 && x+w<=dims.guests[0] && y+h<=dims.guests[1], '人物帧不能越过图集边界');
  }
  for (const style of Object.values(level.party.animations).concat(Object.values(level.party.muses), Object.values(level.party.performances))) {
    for (const row of style.frames) for (const [x,y,w,h,anchor] of row) {
      assert.ok(x>=0 && y>=0 && w>0 && h>0 && x+w<=dims[style.art][0] && y+h<=dims[style.art][1], '新人物帧不能越过图集边界');
      assert.ok(anchor>=0 && anchor<=w, '脚下锚点须落在人物帧内');
    }
  }
  for (const e of level.entities.filter(e => e.performance)) {
    const style = level.party.performances[e.performance];
    assert.ok(style && e.room === 'hall');
    assert.ok(style.fps > 0 && Number.isInteger(style.restFrame));
    assert.ok(style.restFrame >= 0 && style.restFrame < style.frames[0].length);
  }
  const muses=level.entities.filter(e=>e.museStyle);
  assert.equal(muses.length,12);
  assert.ok(muses.every(e=>e.fixed && !e.path && e.age==='adult'));
  assert.deepEqual([...new Set(level.entities.filter(e=>e.type==='guest'&&!e.path).map(e=>e.sprite))].sort(),[0,1,2,3,5,7]);
});
test('单关不豁免出口顺序，缺失/跳关的 portal.to 仍失败', () => {
  for (const to of [undefined, 1, 3]) {
    const g = clone(v.selectLevel(game, 1));
    g.levels[0].entities.find(e => e.type === 'portal').to = to;
    const R = v.makeReport(); R.scopeLevel = 1; v.rule4(g, R);
    assert.ok(R.errors.length > 0);
  }
});
test('剧情条件拒绝空列表/重复项/不存在节点/其他关节点/非 NPC 节点', () => {
  for (const req of [[], ['l1.npc.lily', 'l1.npc.lily'], ['absent'], ['l4.npc.bae'], ['l1.clear']]) {
    const g = clone(v.selectLevel(game, 1));
    g.levels[0].entities.find(e => e.id === 's3').requiresDialogue = req;
    const R = v.makeReport(); v.rule7(g, R);
    assert.ok(R.errors.some(e => e.msg.includes('requiresDialogue') || e.msg.includes('条件')));
  }
});
test('状态搜索要求在可互动位置完成自我介绍，隔墙且无法接近的 NPC 不能解锁星', () => {
  const rows = Array.from({ length: 28 }, () => '#'.repeat(40));
  rows[1] = '#········' + '#'.repeat(31);
  rows[2] = '######·' + '#'.repeat(33);
  rows[3] = '######·' + '#'.repeat(33);
  const level = {
    id: 1, map: { w: 40, h: 28, rows, legend: { '#': 'wall', '·': 'floor' } },
    entities: [
      { type: 'spawn', x: 1, y: 1 },
      { type: 'star', id: 'a', x: 3, y: 1 },
      { type: 'star', id: 'b', x: 5, y: 1 },
      { type: 'star', id: 'c', x: 7, y: 1, requiresDialogue: ['l1.npc.lily'] },
      { type: 'npc', id: 'lily', x: 6, y: 3 },
      { type: 'portal', x: 8, y: 1 },
    ],
  };
  const dialogue = { 'l1.npc.lily': { type: 'npc', trigger: 'npc:lily', once: true } };
  assert.equal(v.stateSearch(level, dialogue).status, 'ok');
  level.map.rows[2] = '#'.repeat(40); // 与 NPC 相隔一格墙，不能隔空对话
  assert.equal(v.stateSearch(level, dialogue).status, 'fail');
});
test('全量模式仍拒绝缺少其余五关和 22 星，不把单关通过当成项目完工', () => {
  const R = report(game, false);
  assert.ok(R.errors.some(e => e.msg.includes('levels 数量 1')));
  assert.ok(R.errors.some(e => e.msg.includes('总星数 3')));
  assert.ok(R.errors.some(e => e.msg.includes('portal.to=2')));
});
test('CLI：--level 1 通过；未制作关卡、非法编号与全量模式返回失败', () => {
  const file = path.join(__dirname, 'validate.js');
  for (const [args, status] of [[['--level', '1'], 0], [['--level', '2'], 1], [['--level', 'x'], 1], [[], 1]]) {
    const result = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' });
    assert.equal(result.status, status, result.stdout + result.stderr);
  }
});
test('礼堂 / 后台对话与角色齐全；出口落点不能指向墙体或自身', () => {
  const g = clone(v.selectLevel(game, 1));
  g.levels[0].entities = g.levels[0].entities.filter(e => !(e.type === 'npc' && e.room === 'backstage' && e.id === 'byeori'));
  const R = v.makeReport(); v.rule8(g, R); assert.ok(R.errors.length);
  for (const target of [{ x: 0, y: 0 }, { x: 13, y: 6 }, { x: 99, y: 4 }]) {
    const bad = clone(v.selectLevel(game, 1));
    bad.levels[0].entities.find(e => e.id === 'to-backstage').to = target;
    const r = v.makeReport(); v.rule5(bad, r); assert.ok(r.errors.length);
  }
});
test('后台修整：20 个等比例单人梳妆位与椅子、右向传送门、成组舞台道具', () => {
  const l = game.levels[0];
  const chairs = l.decorations.filter(d => d.kind === 'chair');
  assert.equal(chairs.length, 24);
  assert.ok(chairs.every(d => d.facing === 'north' && d.baked && d.y > l.stageRect.y + l.stageRect.h));
  assert.equal(l.entities.some(e => ['box','switch'].includes(e.type)), false);
  const music = l.entities.find(e => e.type === 'gramophone');
  assert.ok(music.x >= l.stageRect.x && music.x < l.stageRect.x + l.stageRect.w && music.y >= l.stageRect.y && music.y < l.stageRect.y + l.stageRect.h);
  assert.ok(['piano','drums','guitars','stageCurtains'].every(kind=>l.decorations.some(d=>d.kind===kind)));
  assert.equal(l.decorations.filter(d=>d.kind==='vanityStool').length, 20);
  const stations=l.decorations.filter(d=>d.kind==='vanity');
  assert.equal(stations.length,20);
  assert.equal(stations.filter(d=>d.facing==='south').length,10);
  assert.equal(stations.filter(d=>d.facing==='north').length,10);
  assert.ok(stations.every(d=>d.stations===1 && d.w/d.h===d.frame[2]/d.frame[3]));
  assert.equal(l.entities.find(e=>e.type==='portal').facing,'east');
  assert.ok(l.sceneryAssets.portalEast);
  assert.ok(l.decorations.filter(d=>d.room==='backstage' && ['stageProps','storageTrunk','instrumentBench','makeupTrolley','costumeRail','guitars'].includes(d.kind)).length>=6);
  const room = l.areas.find(a => a.id === 'backstage').rect;
  for (const e of l.entities.filter(e => e.id === 's3' || e.type === 'portal')) {
    assert.ok(e.x > room.x && e.x < room.x + room.w && e.y > room.y && e.y < room.y + room.h);
  }
  assert.ok(l.entities.find(e=>e.type==='portal').x < l.decorations.find(d=>d.kind==='vanity').x);
});
test('家具碰撞覆盖整个桌镜；删掉背面镜子的碰撞瓦片会失败',()=>{
  const g=clone(v.selectLevel(game,1)), l=g.levels[0];
  const mirror=l.decorations.find(d=>d.kind==='vanity'&&d.facing==='north');
  const r=mirror.collision;
  assert.equal(r.w,3);assert.equal(r.h,3);
  const rows=l.map.rows.map(row=>row.split(''));rows[r.y][r.x]='·';l.map.rows=rows.map(row=>row.join(''));
  const R=v.makeReport();v.rule2(g,R);assert.ok(R.errors.some(e=>e.msg.includes('碰撞范围')));
});
test('唱片机状态图：唱片被封死时不能直接播放开后台，道具引用缺失会报错', () => {
  const rows=Array.from({length:28},()=>Array(40).fill('#'));
  for(let x=1;x<=10;x++)rows[1][x]='·';rows[3][35]='·';
  const l={id:1,map:{w:40,h:28,rows:rows.map(r=>r.join('')),legend:{'#':'wall','·':'floor'}},entities:[
    {type:'spawn',x:1,y:1},{type:'star',id:'a',x:2,y:1},
    {type:'star',id:'b',x:7,y:1},{type:'star',id:'c',x:8,y:1},{type:'portal',x:9,y:1},
    {type:'record',id:'record',x:35,y:3,dialogue:'l1.take'},
    {type:'gramophone',id:'music',x:4,y:1,dialogue:'l1.play',recordNode:'l1.take'},
    {type:'gate',id:'g',x:6,y:1,requiresDialogue:['l1.play']}
  ]};
  const dialogue={'l1.take':{type:'cutscene',trigger:'interact:record',once:true},'l1.play':{type:'cutscene',trigger:'interact:music',once:true}};
  assert.equal(v.stateSearch(l,dialogue).status,'fail');
  l.entities.find(e=>e.type==='record').x=3;l.entities.find(e=>e.type==='record').y=1;
  assert.equal(v.stateSearch(l,dialogue).status,'ok');
  const bad=clone(v.selectLevel(game,1));
  bad.levels[0].entities.find(e=>e.type==='gramophone').recordNode='absent';
  const R=v.makeReport();v.rule7(bad,R);assert.ok(R.errors.length);
});
test('精确家具搜索复用静态列表；同一关卡修改后重新搜索仍读取最新碰撞', () => {
  const rows = Array.from({ length: 28 }, () => Array(40).fill('#'));
  for (let x = 1; x <= 6; x++) rows[1][x] = '·';
  const decorations = [];
  let reads = 0;
  const level = {
    id: 1, map: { w: 40, h: 28, rows: rows.map(r => r.join('')), legend: { '#': 'wall', '·': 'floor' } },
    party: { preciseCollision: true, footprint: { x: 0, y: 0, w: 8, h: 8 }, colliders: [] },
    get decorations() { reads++; return decorations; },
    entities: [{ type: 'spawn', x: 1, y: 1 }, { type: 'portal', x: 5, y: 1 },
      ...[2, 3, 4].map(x => ({ type: 'star', id: 's' + x, x, y: 1 }))],
  };
  for (const search of [v.stateSearch, v.staticReachability]) {
    decorations.length = 0;
    reads = 0;
    const reachable = result => result.status ? result.status === 'ok' : result.stars.length === 0 && result.goal === null && !result.spawnBlocked;
    assert.ok(reachable(search(level)));
    assert.equal(reads, 1, '一次搜索只构建一次家具列表');
    decorations.push({ room: 'hall', collision: { x: 3, y: 1, w: 1, h: 1 } });
    assert.ok(!reachable(search(level)), '新增家具阻断通路');
    decorations[0].room = 'backstage';
    assert.ok(reachable(search(level)), '后台家具不加入礼堂碰撞');
    level.party.colliders = [{ x: 3, y: 1, w: 1, h: 1 }];
    assert.ok(!reachable(search(level)), '替换静态碰撞列表后重新搜索不能使用旧缓存');
    level.party.colliders = [];
  }
});
test('精确脚底搜索可通过非整格窄道；缝隙窄于脚底时仍拒绝穿过',()=>{
  const rows=Array.from({length:28},()=>Array(40).fill('#'));
  for(let y=1;y<=3;y++)for(let x=1;x<=6;x++)rows[y][x]='·';
  const level={id:1,map:{w:40,h:28,rows:rows.map(r=>r.join('')),legend:{'#':'wall','·':'floor'}},
    party:{preciseCollision:true,footprint:{x:4,y:9,w:8,h:5},colliders:[
      {x:3,y:1,w:1,h:1.8},{x:3,y:3.4,w:1,h:.6},
    ]},entities:[{type:'spawn',x:1,y:2},{type:'portal',x:6,y:2},
      ...[2,4,5].map(x=>({type:'star',id:'s'+x,x,y:2}))]};
  assert.equal(v.stateSearch(level).status,'ok');
  assert.deepEqual(v.staticReachability(level).stars,[]);
  level.party.colliders[1].y=3.1;level.party.colliders[1].h=.9;
  assert.equal(v.stateSearch(level).status,'fail');
  assert.ok(v.staticReachability(level).stars.length>0);
});
console.log('\n全部通过：' + count + ' 项');
