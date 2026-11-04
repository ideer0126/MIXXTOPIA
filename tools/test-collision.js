#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const C=require('../js/collision.js');
require('../js/engine.js');
const engine=globalThis.MIXX.engine;
const v=require('./validate.js');
const {pathTo}=require('./play-level1.js');
const clone=value=>JSON.parse(JSON.stringify(value));
let count=0;
function test(name,fn){fn();count++;console.log('  ✓ '+name);}
function corridor(){
  const rows=Array.from({length:28},()=>Array(40).fill('#'));
  for(let x=1;x<=6;x++)rows[1][x]='.';
  return{id:1,map:{w:40,h:28,rows:rows.map(r=>r.join('')),legend:{'#':'wall','.':'floor'}},
    party:{preciseCollision:true,footprint:{x:0,y:0,w:8,h:5},colliders:[]},decorations:[],entities:[
      {type:'spawn',x:1,y:1},{type:'star',id:'a',x:2,y:1},{type:'star',id:'b',x:4,y:1},
      {type:'star',id:'c',x:5,y:1},{type:'portal',x:6,y:1}]};
}

test('局部复合矩形与旧世界矩形共存，凹口不被包围盒封死',()=>{
  const level=corridor();
  const d={kind:'corner',room:'hall',x:2,y:1,collisionRects:[{x:0,y:0,w:1,h:.25},{x:0,y:.25,w:.25,h:.75}]};
  level.decorations=[d,{kind:'legacy',room:'hall',collision:{x:5,y:1,w:1,h:.25}}];
  const compiled=C.compile(level);
  assert.deepEqual(compiled.errors,[]);
  assert.equal(C.blockedAt(compiled.rects,40,24,4,4),false,'L 形内凹角可站立');
  assert.equal(C.blockedAt(compiled.rects,33,24,4,4),true,'侧边实心');
  assert.equal(C.blockedAt(compiled.rects,82,16,4,4),true,'旧世界矩形仍生效');
  assert.equal(compiled.rects[0].source,d);
});

test('几何边界拒绝并用、空数组、坏数值、越界与无效脚底，校验器报告错误',()=>{
  const base=corridor();
  for(const shape of [[],null,[null],[{x:0,y:0,w:NaN,h:1}],[{x:0,y:0,w:-1,h:1}],[{x:40,y:0,w:1,h:1}]]){
    const level=clone(base);level.decorations=[{kind:'bad',room:'hall',x:1,y:1,collisionRects:shape}];
    assert.ok(C.compile(level).errors.length);
    const R=v.makeReport();v.rule2({levels:[level]},R);assert.ok(R.errors.length);
  }
  const level=clone(base);
  level.decorations=[{kind:'both',room:'hall',x:1,y:1,collision:{x:1,y:1,w:1,h:1},collisionRects:[{x:0,y:0,w:1,h:1}]}];
  assert.ok(C.compile(level).errors[0].includes('并用'));
  level.decorations=[];level.party.footprint.h=0;
  assert.throws(()=>engine.createMechanics(level),/脚底范围/);
  level.party.footprint.h=5;level.party.colliders={};
  assert.ok(C.compile(level).errors[0].includes('数组'));
});

test('持续位移与斜向移动在 15/30/60/144fps 下不能跨过亚像素薄块',()=>{
  const rects=[{x:32,y:0,w:.125,h:128}];
  const blocked=(x,y)=>C.blockedAt(rects,x,y,8,5);
  for(const fps of [15,30,60,144])for(const diagonal of [false,true]){
    let x=0,y=16;
    for(let i=0;i<fps;i++){
      const end=C.trace(x,y,80/fps,diagonal?40/fps:0,blocked);
      x=end.x;y=end.y;assert.equal(blocked(x,y),false);
    }
    assert.ok(x<=24&&x>23,'停在薄块前最后一个像素内');
  }
  assert.equal(C.trace(0,16,64,0,blocked).blocked,true,'大步长也检查中段');
});

test('相邻块接缝不漏，沿外边缘滑行不误挡',()=>{
  const rects=[{x:32,y:0,w:4,h:16},{x:32,y:16,w:4,h:16}];
  assert.equal(C.trace(16,13.5,32,0,(x,y)=>C.blockedAt(rects,x,y,8,5)).blocked,true);
  assert.equal(C.trace(24,0,0,32,(x,y)=>C.blockedAt(rects,x,y,8,5)).blocked,false);
});

test('两端可站立但中间有薄障碍时，运行时、路线搜索与两种地图搜索均拒绝跨越',()=>{
  const level=corridor();level.party.colliders=[{x:1.75,y:1,w:.0625,h:1}];
  const mechanics=engine.createMechanics(level),blocks=v.furnitureBlocker(level);
  assert.equal(mechanics.blockedAt(16,16,8,{height:5}),false);
  assert.equal(mechanics.blockedAt(32,16,8,{height:5}),false);
  assert.equal(blocks.canStep(1,1,2,1),false);
  assert.equal(v.stateSearch(level).status,'fail');
  assert.ok(v.staticReachability(level).stars.length);
  const game={player:{x:16,y:16},mechanics,birthday:{blockedAt:(x,y)=>mechanics.blockedAt(x,y,8,{height:5})}};
  assert.equal(pathTo(game,6,1),null);
});

test('路线工具可通过仅子格位置可走的通道；每一段都实际检查脚底',()=>{
  const level=corridor();
  level.party.colliders=[{x:3,y:1,w:.5,h:.375},{x:3,y:1.8125,w:.5,h:.1875}];
  const mechanics=engine.createMechanics(level);
  const game={player:{x:16,y:16},mechanics,birthday:{blockedAt:(x,y)=>mechanics.blockedAt(x,y,8,{height:5})}};
  const path=pathTo(game,6,1);
  assert.ok(path&&path.some(([x,y])=>y%1!==0),'2px 导航找到偏离整格的通路');
  let x=16,y=16;
  for(const [tx,ty] of path){
    const end=C.trace(x,y,tx*16-x,ty*16-y,(px,py)=>game.birthday.blockedAt(px,py));
    assert.equal(end.blocked,false);x=end.x;y=end.y;
  }
  assert.deepEqual([x,y],[96,16]);
});

test('真实第一关：静态位置与路径段判定和地图校验一致，椅脚凹口能容纳玩家脚底',()=>{
  const level=clone(v.loadGame().game.levels[0]),mechanics=engine.createMechanics(level),blocks=v.furnitureBlocker(level);
  const f=level.party.footprint;
  const chair=level.decorations.find(d=>d.room==='hall'&&d.kind==='chair');
  assert.equal(chair.collisionRects.length,3);assert.equal(chair.collision,undefined);
  const [seat,left]=chair.collisionRects;
  const x=(chair.x+left.x+left.w)*16+1-f.x,y=(chair.y+seat.y+seat.h)*16+.5-f.y;
  assert.equal(mechanics.blockedAt(x+f.x,y+f.y,f.w,{height:f.h}),false,'脚底可进入椅脚之间的真实凹口');
  let points=0;
  for(let py=8;py<24;py+=.5)for(let px=1;px<39;px+=.5){
    if(level.entities.some(e=>['gate','door','box'].includes(e.type)&&Math.abs(e.x-px)<1&&Math.abs(e.y-py)<1))continue;
    assert.equal(blocks(px,py),mechanics.blockedAt(px*16+f.x,py*16+f.y,f.w,{height:f.h}),px+','+py);points++;
  }
  assert.ok(points>2000);
  for(const [px,py,dx,dy] of [[13,18,0,1],[19,10,0,-1],[6,8,0,-1],[17,23,1,0]]){
    const runtime=C.trace(px*16,py*16,dx*16,dy*16,(x,y)=>mechanics.blockedAt(x+f.x,y+f.y,f.w,{height:f.h}));
    assert.equal(blocks.canStep(px,py,px+dx,py+dy),!runtime.blocked);
  }
});

test('真实第一关礼堂：碰撞块按 1/16 格合并，互不重叠且不可再并',()=>{
  const level=clone(v.loadGame().game.levels[0]);let blocks=0,collisionOnly=0;
  for(const d of level.decorations){
    if(d.room!=='hall')continue;
    assert.ok(!(d.collision&&d.collisionRects),d.kind+' 不能同时使用 collision 与 collisionRects');
    if(d.collision){collisionOnly++;continue;}
    if(!d.collisionRects)continue;
    for(const r of d.collisionRects){
      for(const key of ['x','y','w','h']){
        const scaled=r[key]*16;
        assert.ok(Math.abs(scaled-Math.round(scaled))<1e-6,d.kind+' 的 '+key+' 必须落在 1/16 瓦片格上');
      }
      assert.ok(r.w>0&&r.h>0,d.kind+' 碰撞块必须有正尺寸');
    }
    for(let i=0;i<d.collisionRects.length;i++)for(let j=i+1;j<d.collisionRects.length;j++){
      const a=d.collisionRects[i],b=d.collisionRects[j];
      assert.ok(!(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y),d.kind+' 碰撞块不能重叠');
      assert.ok(!(a.y===b.y&&a.h===b.h&&(a.x+a.w===b.x||b.x+b.w===a.x)),d.kind+' 同高相邻块应合并');
      assert.ok(!(a.x===b.x&&a.w===b.w&&(a.y+a.h===b.y||b.y+b.h===a.y)),d.kind+' 同宽相邻块应合并');
    }
    blocks+=d.collisionRects.length;
  }
  assert.ok(blocks>=90,'礼堂复合碰撞块应完整保留，实际 '+blocks);
  assert.ok(collisionOnly>0,'单块家具仍可使用世界矩形');
});

test('重建关卡会读取最新复合几何，动态门仍随开关状态更新',()=>{
  const level=corridor();level.entities.push({type:'gate',id:'gate',x:3,y:1});
  let mechanics=engine.createMechanics(level);
  assert.equal(mechanics.blockedAt(48,16,8,{height:5}),true);
  level.entities.at(-1).open=true;
  assert.equal(mechanics.blockedAt(48,16,8,{height:5}),false);
  level.decorations.push({kind:'new',room:'hall',x:3,y:1,collisionRects:[{x:0,y:0,w:1,h:1}]});
  mechanics=engine.createMechanics(level);
  assert.equal(mechanics.blockedAt(48,16,8,{height:5}),true);
});
test('#66/#76 真实地图：舞台右沿与幕布接缝、角落盆栽、右侧窄缝和钢琴实体均阻挡',()=>{
  const level=clone(v.loadGame().game.levels[0]),mechanics=engine.createMechanics(level),f=level.party.footprint;
  const blocked=(x,y)=>mechanics.blockedAt(x+f.x,y+f.y,f.w,{height:f.h});
  for(const [x,y] of [[1.1,22],[38.25,19],[13,5.5],[31,8],[33,6],[35.1,5.5]])
    assert.equal(blocked(x*16,y*16),true,'旧穿模位置应阻挡 '+x+','+y);
  for(const [x,y,dx,dy] of [[3,22,-48,0],[16,5.5,-96,0],[32,7,-64,0],[34.5,10.6,0,-80],[37.5,5.7,-64,0],[38,14,0,128]]){
    assert.equal(blocked(x*16,y*16),false,'测试起点应可站立 '+x+','+y);
    const end=C.trace(x*16,y*16,dx,dy,blocked);
    assert.equal(end.blocked,true,'不能跨越实体或墙脚');
    assert.equal(blocked(end.x,end.y),false,'停在最后一个可站立位置');
  }
  for(const [x,y] of [[19,9],[20,8],[29,7],[33,5],[4,22],[32,22]])
    assert.equal(blocked(x*16,y*16),false,'正常阶梯、幕布入口和摊位前通道保留 '+x+','+y);
  const probe={player:{x:19*16,y:25*16},mechanics,birthday:{blockedAt:blocked}};
  assert.ok(pathTo(probe,29,7),'中央阶梯可进入舞台');
  const left=level.decorations.find(d=>d.kind==='stageFrontLeft').collision;
  const right=level.decorations.find(d=>d.kind==='stageFrontRight').collision;
  level.party.colliders.push({x:left.x+left.w,y:left.y,w:right.x-left.x-left.w,h:left.h});
  const sealed=engine.createMechanics(level);
  probe.birthday.blockedAt=(x,y)=>sealed.blockedAt(x+f.x,y+f.y,f.w,{height:f.h});
  assert.equal(pathTo(probe,29,7),null,'封住中央阶梯后，不能再从舞台右沿或幕布接缝绕入');
});

test('试玩截图位置：凳面、琴身、柱脚、花盆和礼物不可站立，杂物间圈出的地板可通行',()=>{
  const level=clone(v.loadGame().game.levels[0]),m=engine.createMechanics(level),f=level.party.footprint;
  for(const [x,y] of [[24,7.8],[14.31,4.76],[15,6.16],[5.74,9.2],[6,21],[33,20],[37.5,20.4],[5.3,10.7]])
    assert.equal(m.blockedAt(x*16+f.x,y*16+f.y,f.w,{height:f.h}),true,'反馈位置应阻挡 '+x+','+y);
  for(const [x,y] of [[4,6.3],[3.4,6.3],[6,7],[6,22],[33,21.15],[37.5,22.6]])
    assert.equal(m.blockedAt(x*16+f.x,y*16+f.y,f.w,{height:f.h}),false,'真实地面与互动点应可达 '+x+','+y);
});

console.log('\n全部通过：'+count+' 项');
