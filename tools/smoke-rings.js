#!/usr/bin/env node
'use strict';
// Local browser acceptance and an isolated, playable preview of #69.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const repo=path.resolve(__dirname,'..');
const preview=process.argv.includes('--preview');
const output=process.env.MIXX_RINGS_OUTPUT||'/tmp/mixxtopia-69';
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/__rings-preview'){
    const html=fs.readFileSync(path.join(repo,'index.html'),'utf8')
      .replace('<head>','<head><base href="/"><script>window.MIXX_NO_BOOT=true;</script>')
      .replace('</body>',`<script src="tools/play-level1.js"></script><script>
        window.game=MIXX.main.boot({storage:null,auth:null,cloud:null,stats:null});game.stop();
        game._startNewGame();level1Playthrough.finishDialogue(game);
        const station=game._entitiesOf('minigame')[0];level1Playthrough.walkTo(game,station.x,station.y);game._interact();level1Playthrough.finishDialogue(game);
        game.soundOn=false;game._entryFade=0;game.start();
      </script></body>`);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html);return;
  }
  const file=path.resolve(repo,'.'+decodeURIComponent(url.pathname).replace(/\/$/,'/index.html'));
  if(!file.startsWith(repo+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,body)=>{
    if(err){res.writeHead(404).end();return;}
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(body);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(preview?8769:0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  if(preview){console.log('Playable rings preview: '+base+'/__rings-preview');return;}
  const {chromium}=require(process.env.MIXX_PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox'],
    ...(process.env.MIXX_CHROME?{executablePath:process.env.MIXX_CHROME}:{})});
  fs.mkdirSync(output,{recursive:true});const errors=[],results=[];
  try{
    for(const touch of [false,true]){
      const device=touch?'touch':'desktop';
      const context=await browser.newContext(touch?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}
        :{viewport:{width:1280,height:900}});
      await context.addInitScript(()=>window.MIXX_NO_BOOT=true);
      await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.fulfill({body:''}));
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
      await page.goto(base);await page.addScriptTag({url:base+'/tools/play-level1.js'});
      await page.evaluate(async()=>{
        window.game=MIXX.main.boot({auth:null,cloud:null,stats:null});game.stop();game.soundOn=false;
        game._startNewGame();level1Playthrough.finishDialogue(game);
        await Promise.all(Array.from(game._sceneryImages.values(),img=>img.decode()));
        const station=game._entitiesOf('minigame')[0];level1Playthrough.walkTo(game,station.x,station.y);game.input.endFrame();game._entryFade=0;
      });
      // Enter via the actual E / mobile A input mapping. The last dialogue key is held.
      if(touch)await page.locator('#tbtn-a').tap();else await page.keyboard.down('e');
      assert.equal(await page.evaluate(()=>{game._update(0);game.input.endFrame();return game.state;}),'dialogue');
      await page.evaluate(()=>{level1Playthrough.finishDialogue(game);game._update(0);game.input.endFrame();});
      assert.equal(await page.evaluate(()=>game.birthday.rings.shot),null);
      if(!touch)await page.keyboard.up('e');
      await page.evaluate(()=>{game._update(0);game.input.endFrame();game._render();});
      await page.screenshot({path:path.join(output,device+'-ready.png')});
      const throwRing=async()=>{
        if(touch)await page.locator('#tbtn-a').tap();else await page.keyboard.press('e');
        return page.evaluate(()=>{game._update(0);game.input.endFrame();return game.birthday.rings.phase;});
      };
      // Three genuine misses at the initial phase restart the entire round.
      for(let fail=1;fail<=3;fail++){
        assert.equal(await throwRing(),'flight');
        if(fail===1){
          await page.evaluate(()=>{game._update(.12);game._render();});
          await page.screenshot({path:path.join(output,device+'-flight.png')});
          const frozen=await page.evaluate(()=>JSON.stringify(game.birthday.rings));
          await page.keyboard.press('Escape');
          await page.evaluate(()=>{game._update(0);game.input.endFrame();game._update(3);});
          assert.equal(await page.evaluate(()=>game.state),'paused');
          assert.equal(await page.evaluate(()=>JSON.stringify(game.birthday.rings)),frozen);
          await page.locator('#btn-resume').click();
          await throwRing(); // A new press during flight must not replace the shot.
        }
        const result=await page.evaluate(()=>{
          const r=game.birthday.rings;
          for(let i=0;i<80&&r.phase==='flight';i++)game._update(.025);
          game._render();return {failures:r.failures,hits:r.hits,result:r.result};
        });
        assert.equal(result.failures,fail);assert.equal(result.hits,0);assert.ok(['miss','obstacle'].includes(result.result));
        if(fail===3)await page.screenshot({path:path.join(output,device+'-reset.png')});
        await page.evaluate(()=>{for(let i=0;i<80&&game.birthday.rings.phase==='feedback';i++)game._update(.025);});
      }
      assert.deepEqual(await page.evaluate(()=>({hits:game.birthday.rings.hits,failures:game.birthday.rings.failures})),{hits:0,failures:0});
      // Successful full round, with actual keyboard/touch input and live motion.
      for(let stage=0;stage<3;stage++){
        await page.evaluate(wait=>{
          const r=game.birthday.rings;
          while(r.time<wait-1e-8)game._update(Math.min(.025,wait-r.time));
          game.input.endFrame();game._render();
        },[.85,.45,.2][stage]);
        assert.equal(await page.evaluate(()=>game._starAvailable(game._entitiesOf('star').find(e=>e.id==='s1'))),false);
        assert.equal(await throwRing(),'flight');
        await page.evaluate(()=>{const r=game.birthday.rings;for(let i=0;i<80&&r.phase==='flight';i++)game._update(.025);game._render();});
        assert.equal(await page.evaluate(()=>game.birthday.rings.result),'hit');
        await page.screenshot({path:path.join(output,device+'-hit-'+stage+'.png')});
        await page.evaluate(()=>{for(let i=0;i<80&&game.birthday.rings&&game.birthday.rings.phase==='feedback';i++)game._update(.025);});
      }
      const collected=await page.evaluate(()=>{
        level1Playthrough.finishDialogue(game);
        const star=game._entitiesOf('star').find(e=>e.id==='s1');
        if(!game._starAvailable(star))throw new Error('Completed round must unlock s1');
        level1Playthrough.walkTo(game,star.x,star.y);
        const station=game._entitiesOf('minigame')[0];level1Playthrough.walkTo(game,station.x,station.y);game._interact();level1Playthrough.finishDialogue(game);
        if(game.birthday.rings)throw new Error('Completed minigame must not restart');
        game._setState('paused');if(!game._saveAndQuit())throw new Error('Save failed');
        if(game.birthday!==null)throw new Error('Quit retained birthday runtime');
        document.getElementById('btn-continue').click();
        return {stars:game.stars,complete:game._playedNodes.has('l1.rings.complete'),rings:game.birthday.rings};
      });
      assert.deepEqual(collected,{stars:1,complete:true,rings:null});
      // Full unmodified collection → storage → record → backstage → portal route.
      const route=await page.evaluate(()=>{
        game._setState('paused');game._quitToTitle();game._startNewGame();
        return level1Playthrough.playLevel1(game);
      });
      assert.equal(route.state,'clear');assert.equal(route.stars,3);
      results.push({device,threeFailuresReset:true,threeStagesHit:true,savedReward:true,route});
      await context.close();
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({results,consoleErrors:errors,output},null,2));
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
