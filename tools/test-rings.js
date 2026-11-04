#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
require('../js/birthday.js');
let passed=0;
function test(name,fn){fn();passed++;console.log('✓ '+name);}
function setup(stage=0,failures=0){
  const g={held:false,pressed:false,completed:0,input:{isDown:()=>g.held,wasPressed:()=>g.pressed},
    _loadSceneryAssets(){},_sfx(){},_refreshHud(){},_emit(){},_playNode(id,options){assert.equal(id,'l1.rings.complete');g.completed++;options.onEnd();}};
  const b=new MIXX.Birthday(g);b.startRings(stage,failures);return {b,g};
}
function fire(b,g){g.pressed=true;b.updateRings(0);g.pressed=false;}
function fly(b,step=.025){for(let n=0;n<200&&b.rings.phase==='flight';n++)b.updateRings(step);}
function openLanes(r){for(const o of r.obstacles){o.x=50;o.vx=0;}}
function hit(b,g){const r=b.rings;openLanes(r);r.target.x=160;r.target.vx=0;fire(b,g);fly(b);assert.equal(r.result,'hit');}
function miss(b,g){const r=b.rings;openLanes(r);r.target.x=50;r.target.vx=0;fire(b,g);fly(b);assert.equal(r.result,'miss');}

test('三阶段：单目标、双障碍与严格递增速度；真实时机均可成功',()=>{
  let prior=[0,0,0];
  for(let stage=0;stage<3;stage++){
    const {b,g}=setup(stage),r=b.rings;
    assert.equal(r.obstacles.length,2);assert.ok(r.obstacles.every(o=>o.y>r.target.y&&o.y<174));
    const speeds=[r.target.vx,...r.obstacles.map(o=>Math.abs(o.vx))];
    speeds.forEach((v,i)=>assert.ok(v>prior[i]));prior=speeds;
    b.updateRings([.85,.45,.2][stage]);fire(b,g);
    const start=JSON.stringify(r);b.updateRings(.1);
    assert.equal(r.phase,'flight');assert.notEqual(JSON.stringify(r),start);
    fly(b);assert.equal(r.result,'hit');assert.equal(g.completed,0);
  }
});
test('按下时对齐，到达时游走会投空；初始未对齐，游入会命中',()=>{
  for(const [x,result] of [[160,'miss'],[120,'hit']]){
    const {b,g}=setup();openLanes(b.rings);b.rings.target.x=x;
    fire(b,g);assert.equal(b.rings.result,null);assert.equal(b.rings.shot.y,174);
    fly(b);assert.equal(b.rings.result,result);
  }
});
test('任一障碍船先碰即失败；大步长 / 移动物体扫掠不漏判，不穿透命中',()=>{
  for(const obstacle of [0,1])for(const dt of [.025,.5,1.5]){
    const {b,g}=setup(2),r=b.rings;openLanes(r);
    r.target.x=160;r.target.vx=0;
    r.obstacles[obstacle].x=160;
    fire(b,g);fly(b,dt);
    assert.equal(r.result,'obstacle');assert.equal(r.hits,2);assert.equal(r.failures,1);
    assert.ok(r.shot.y>r.target.y);assert.equal(g.completed,0);
  }
  const {b,g}=setup(2),r=b.rings;openLanes(r);
  r.obstacles[0].x=80;r.obstacles[0].vx=350;
  fire(b,g);fly(b,.7);assert.equal(r.result,'obstacle');
});
test('跨阶段共享失败：鲸鱼一次、月亮一次、星星一次后整轮归零',()=>{
  const {b,g}=setup();
  for(let stage=0;stage<2;stage++){
    miss(b,g);assert.equal(b.rings.failures,stage+1);b.updateRings(1);
    assert.equal(b.rings.stage,stage);assert.equal(b.rings.failures,stage+1);
    hit(b,g);b.updateRings(1);assert.equal(b.rings.stage,stage+1);assert.equal(b.rings.failures,stage+1);
  }
  miss(b,g);assert.equal(b.rings.failures,3);assert.match(b.rings.message,/从鲸鱼重新开始/);
  b.updateRings(2);assert.equal(b.rings.stage,0);assert.equal(b.rings.hits,0);assert.equal(b.rings.failures,0);
  assert.equal(b.rings.shot,null);assert.equal(b.rings.time,0);assert.equal(g.completed,0);
  for(let i=0;i<3;i++){hit(b,g);b.updateRings(1);}
  assert.equal(b.rings,null);assert.equal(g.completed,1);
});
test('同阶段第三次失败仍可重开，单次飞行只记一次结果',()=>{
  const {b,g}=setup();
  for(let i=1;i<=3;i++){
    miss(b,g);const r=b.rings;
    for(let n=0;n<8;n++)b.updateRings(.01);
    assert.equal(r.failures,i);assert.equal(r.hits,0);
    b.updateRings(2);
  }
  assert.equal(b.rings.failures,0);hit(b,g);assert.equal(b.rings.hits,1);
});
test('对话末尾长按、在途连按、反馈期间按键均不多投或跳关',()=>{
  const {b,g}=setup();g.held=true;fire(b,g);assert.equal(b.rings.shot,null);
  g.held=false;b.updateRings(0);g.held=true;fire(b,g);
  const shot=b.rings.shot;b.updateRings(.1);fire(b,g);
  assert.equal(b.rings.shot,shot);assert.ok(shot.y<174);
  fly(b);const result=JSON.stringify(b.rings);fire(b,g);assert.equal(JSON.stringify(b.rings),result);
  b.updateRings(2);fire(b,g);assert.equal(b.rings.shot,null);
});
test('循环换边不跨屏碰撞；障碍船到边界折返，低帧率运动一致',()=>{
  const {b,g}=setup(2);openLanes(b.rings);b.rings.target.x=311;
  fire(b,g);b.rings.shot.y=92;b.updateRings(.1);assert.equal(b.rings.result,null);
  assert.ok(b.rings.target.x<20);
  const a=setup(2).b,c=setup(2).b;
  a.rings.target.x=c.rings.target.x=311;
  a.rings.obstacles[0].x=c.rings.obstacles[0].x=45;
  a.updateRings(2.3);for(let i=0;i<230;i++)c.updateRings(.01);
  assert.ok(Math.abs(a.rings.target.x-c.rings.target.x)<1e-7);
  for(let i=0;i<2;i++){
    const o=a.rings.obstacles[i],p=c.rings.obstacles[i];
    assert.ok(o.x>=o.min&&o.x<=o.max);assert.ok(Math.abs(o.x-p.x)<1e-7);assert.equal(o.vx,p.vx);
  }
});
console.log('\n'+passed+' ring-toss checks passed.');
