#!/usr/bin/env node
'use strict';
// Regression for directly opening index.html: file images may taint canvases,
// but character rendering, dialogue and the live animation loop must still work.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.MIXX_PLAYWRIGHT_MODULE||'playwright');
const output=process.env.MIXX_LOCAL_OUTPUT||'/tmp/mixxtopia-local-file';
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.MIXX_CHROME||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
  const results=[];
  try{
    for(const touch of [false,true]){
      const name=touch?'touch':'desktop',errors=[],context=await browser.newContext(touch?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}});
      await context.addInitScript(()=>window.MIXX_NO_BOOT=true);
      await context.route('https://**/*',route=>route.fulfill({body:''}));
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
      await page.evaluate(async()=>{
        window.localRenders=0;window.game=MIXX.main.boot();
        const render=game._render;game._render=function(){render.call(this);localRenders++;};
        await Promise.all([...game._sceneryImages.values()].map(img=>img.decode()));
      });
      await page.locator('#btn-start').click();
      for(let i=0;i<100&&await page.evaluate(()=>game.state==='dialogue');i++){
        if(touch)await page.locator('#tbtn-a').tap();else await page.keyboard.press('e');
        await page.waitForTimeout(35);
      }
      assert.equal(await page.evaluate(()=>game.state),'playing','Intro and opening dialogue must finish');
      const before=await page.evaluate(()=>({x:game.player.x,y:game.player.y,renders:localRenders}));
      if(touch){const box=await page.locator('[data-key="up"]').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();}
      else await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(180);
      if(touch)await page.mouse.up();else await page.keyboard.up('ArrowUp');
      const moved=await page.evaluate(()=>({x:game.player.x,y:game.player.y,renders:localRenders,cache:game.birthday.frameCache.size}));
      assert.ok(moved.y<before.y,'Movement must continue after dialogue');assert.ok(moved.renders>before.renders+2,'The real animation loop must keep rendering');assert.ok(moved.cache>=11,'All actor families must render');
      await page.keyboard.press('Escape');await page.waitForFunction(()=>game.state==='paused');
      await page.keyboard.press('Escape');await page.waitForFunction(()=>game.state==='playing');
      const renders=await page.evaluate(()=>localRenders);await page.waitForFunction(n=>localRenders>n+3,renders);
      await page.waitForFunction(()=>game._entryFade===0);
      assert.deepEqual(errors,[],'No file-origin canvas exceptions');
      await page.locator('#game').screenshot({path:path.join(output,name+'.png')});
      results.push({name,before,moved,errors});await context.close();
    }
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
    console.log('Passed: direct file:// launch, visible character caches, dialogue completion, movement, pause/resume and live rendering; desktop + simulated touch.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
