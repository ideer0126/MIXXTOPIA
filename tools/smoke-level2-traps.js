#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.MIXX_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),site=path.join(repo,'.ds/pc-playtest/MIXXTOPIA-PC-Playtest');
const output=path.join(repo,'docs/previews/level2/runtime');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.MIXX_CHROME||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
  const errors=[],results=[];fs.mkdirSync(output,{recursive:true});
  try {
    for(const part of ['darts','spikes','blade']) {
      const context=await browser.newContext({viewport:{width:1280,height:900},offline:true});
      const page=await context.newPage();page.on('pageerror',e=>errors.push(part+': '+e.message));
      await page.goto(pathToFileURL(path.join(site,'traps-'+part+'.html')).href);
      await page.locator('#btn-start').click();
      await page.evaluate(()=>{window.game=pcPlaytestGame;game.stop();});
      assert.equal(await page.evaluate(()=>game.combat.aliveCount()),0);
      async function advance(frames) { await page.evaluate(n=>{for(let i=0;i<n;i++){game._update(1/60);game.input.endFrame();}game._render();},frames); }
      async function key(name,frames) {
        await page.keyboard.down(name);await advance(frames);await page.keyboard.up(name);
        await page.evaluate(()=>{game._update(0);game.input.endFrame();});
      }
      async function restart() { await page.evaluate(()=>{game._setState('paused');game._restartLevel();}); }
      async function waitFor(predicate) {
        for(let frames=0;frames<420;frames++) {
          if(await page.evaluate(predicate))return;
          await advance(1);
        }
        throw Error('未出现预期的安全窗口');
      }
      if(part==='darts') {
        const start=await page.evaluate(()=>({...game.player}));
        await waitFor(()=>game.combat.traps[0].phase==='warning');
        assert.equal(await page.evaluate(()=>game.combat.hp),10);
        await page.locator('#game').screenshot({path:path.join(output,'traps-darts-warning.png')});
        await waitFor(()=>game.combat.traps[0].phase==='active');
        await advance(12);
        assert.equal(await page.evaluate(()=>game.combat.darts.filter(d=>d.trap==='dart-west').length),4,'无输入也自动发出四排箭');
        assert.equal(await page.evaluate(()=>new Set(game.combat.darts.filter(d=>d.trap==='dart-west').map(d=>d.x)).size),4,'四排有独立的平行箭路');
        assert.equal(await page.evaluate(()=>game.combat.darts.filter(d=>d.trap==='dart-east').length),4,'南墙箭阵同样发出四排');
        assert.equal(await page.evaluate(()=>game.combat.darts.filter(d=>d.trap==='dart-final').length),4,'第三个箭阵同样自动发出四排');
        assert.deepEqual(await page.evaluate(()=>({...game.player})),start);
        await page.locator('#game').screenshot({path:path.join(output,'traps-darts-flight.png')});
        await waitFor(()=>game.combat.traps[0].phase==='cooldown');
        await key('ArrowRight',86);
        assert.ok(await page.evaluate(()=>game.player.x>=33*16));
        assert.equal(await page.evaluate(()=>game.combat.hp),10,'普通步行可利用间隙穿过自动箭路');
        const cycle=await page.evaluate(()=>game.combat.traps[0].cycle);
        await waitFor(()=>game.combat.traps[0].phase==='warning');
        await waitFor(()=>game.combat.traps[0].phase==='active');
        assert.equal(await page.evaluate(()=>game.combat.traps[0].cycle),cycle+1,'离开后仍按五秒周期继续发射');
        await restart();await key('ArrowRight',48);
        await waitFor(()=>game.combat.traps[0].phase==='active');await advance(45);
        assert.equal(await page.evaluate(()=>game.combat.hp),9,'站在弹道会受伤');
        await restart();
        await page.evaluate(()=>{game.player={x:173*16,y:10*16};game._followCamera();});
        await waitFor(()=>game.combat.traps.find(t=>t.id==='dart-final').phase==='active');
        await advance(12);
        await page.locator('#game').screenshot({path:path.join(output,'traps-darts-third.png')});
        await waitFor(()=>{const t=game.combat.traps.find(t=>t.id==='dart-final');return t.phase==='cooldown'&&t.timer>1.8;});
        await key('ArrowRight',86);
        assert.ok(await page.evaluate(()=>game.player.x>=180*16),'第三阵能正常步行越过全部四排');
        assert.equal(await page.evaluate(()=>game.combat.hp),10,'第三阵等待区和普通步行路线安全');
      } else if(part==='spikes') {
        await key('ArrowRight',30);
        await waitFor(()=>game.combat.traps.find(t=>t.id==='spike-gallery').phase==='warning');
        await page.locator('#game').screenshot({path:path.join(output,'traps-spikes-warning.png')});
        await waitFor(()=>game.combat.traps.find(t=>t.id==='spike-gallery').phase==='active');
        await page.locator('#game').screenshot({path:path.join(output,'traps-spikes-active.png')});
        await waitFor(()=>{const t=game.combat.traps.find(t=>t.id==='spike-gallery');return t.phase==='cooldown'&&t.timer>1.2;});
        await key('ArrowRight',60);
        assert.ok(await page.evaluate(()=>game.player.x>=96*16&&game.player.x+16<=99*16),'完整身体可停在三格等待台内');
        await advance(360);assert.equal(await page.evaluate(()=>game.combat.hp),10,'等待台跨多个周期也安全');
        await page.locator('#game').screenshot({path:path.join(output,'traps-spikes-rest.png')});
        await waitFor(()=>{const t=game.combat.traps.find(t=>t.id==='spike-gallery-east');return t.phase==='cooldown'&&t.timer>1.2;});
        await key('ArrowRight',60);
        assert.ok(await page.evaluate(()=>game.player.x>=101*16),'普通步行穿过第二道，无需闪步');
        assert.equal(await page.evaluate(()=>game.combat.hp),10);
        await restart();await key('ArrowRight',48);await advance(180);
        assert.equal(await page.evaluate(()=>game.combat.hp),9,'站在升起的地刺上会受伤');
      } else {
        await key('ArrowRight',60);await advance(100);
        assert.ok(await page.evaluate(()=>game.combat.hp<10),'闸刃扫中会受伤');
        await restart();await key('ArrowRight',36);
        await waitFor(()=>{const c=game.combat,t=c.traps.find(t=>t.kind==='blade');return (c.time+t.offset)%6<.4;});
        await page.locator('#game').screenshot({path:path.join(output,'traps-blade-swing.png')});
        await key('ArrowRight',72);
        assert.equal(await page.evaluate(()=>game.combat.hp),10,'看准窗口后正常步行通过闸刃');
        await key('ArrowUp',48);await key('e',1);
        assert.equal(await page.evaluate(()=>game.combat.traps.find(t=>t.kind==='blade').disabled),true);
        await page.evaluate(()=>game._render());await page.locator('#game').screenshot({path:path.join(output,'traps-blade-braked.png')});
        await page.evaluate(()=>{game._setState('paused');game._saveAndQuit();});
        await page.reload();await page.locator('#btn-continue').click();
        await page.evaluate(()=>{window.game=pcPlaytestGame;game.stop();});
        assert.equal(await page.evaluate(()=>game.combat.traps.find(t=>t.kind==='blade').disabled),true);
        await key('ArrowRight',110);assert.equal(await page.evaluate(()=>game.combat.hp),10,'制动读档后通路保持安全');
      }
      results.push({part,warningAndDamage:true,avoidance:true,offline:true});await context.close();
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({results,errors},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
