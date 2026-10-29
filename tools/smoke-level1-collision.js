#!/usr/bin/env node
'use strict';
// Local browser input, production Canvas and a complete playable route.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require(process.env.MIXX_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..');
const output=process.env.MIXX_COLLISION_OUTPUT||'/tmp/mixxtopia-73';

(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const errors=[],results=[];
  const server=http.createServer((req,res)=>{
    const file=path.resolve(repo,'.'+new URL(req.url,'http://local').pathname.replace(/\/$/,'/index.html'));
    if(!file.startsWith(repo+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(err,body)=>{
      if(err){res.writeHead(404).end();return;}
      const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'};
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(body);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.MIXX_CHROME||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
    for(const touch of [false,true]){
      const name=touch?'touch':'desktop';
      const context=await browser.newContext(touch?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}});
      await context.addInitScript(()=>{window.MIXX_NO_BOOT=true;});
      await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.fulfill({status:200,body:''}));
      const page=await context.newPage();
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
      await page.goto(base);await page.addScriptTag({url:base+'/tools/play-level1.js'});
      await page.evaluate(async()=>{
        window.game=MIXX.main.boot();game.stop();game._startNewGame();level1Playthrough.finishDialogue(game);
        await Promise.all(Array.from(game._sceneryImages.values(),img=>img.decode()));
      });
      const approaches=[];
      for(const fps of [15,30,60,144])for(const [key,dx,dy] of [['ArrowRight',1,0],['ArrowLeft',-1,0],['ArrowDown',0,1],['ArrowUp',0,-1]]){
        await page.evaluate(([dx,dy])=>{
          const d=game.level.decorations.filter(d=>d.room==='hall'&&d.kind==='chair')[1];
          const rs=game.mechanics.staticCollision.rects.filter(r=>r.source===d);
          const x=Math.min(...rs.map(r=>r.x)),y=Math.min(...rs.map(r=>r.y));
          const right=Math.max(...rs.map(r=>r.x+r.w)),bottom=Math.max(...rs.map(r=>r.y+r.h));
          const f=game.level.party.footprint;
          game.player={x:(x+right-f.w)/2-f.x,y:(y+bottom-f.h)/2-f.y};
          if(dx)game.player.x=(dx>0?x-f.w-6:right+6)-f.x;
          if(dy)game.player.y=(dy>0?y-f.h-6:bottom+6)-f.y;
          if(game.birthday.blockedAt(game.player.x,game.player.y))throw Error('接近起点阻挡');
        },[dx,dy]);
        await page.keyboard.down(key);
        const end=await page.evaluate(([fps,dx,dy])=>{
          for(let i=0;i<fps;i++){
            game._update(1/fps);game.input.endFrame();
            if(game.birthday.blockedAt(game.player.x,game.player.y))throw Error('移动后脚底重叠');
          }
          const f=game.birthday.footprint(game.player.x+dx,game.player.y+dy);
          const staticBlocked=MIXX.collision.blockedAt(game.mechanics.staticCollision.rects,f.x,f.y,f.w,f.h);
          return{player:{...game.player},staticBlocked};
        },[fps,dx,dy]);
        await page.keyboard.up(key);assert.equal(end.staticBlocked,true,'应停在实际家具前');
        approaches.push({fps,key,...end});
      }
      await page.evaluate(()=>{
        const d=game.level.decorations.filter(d=>d.room==='hall'&&d.kind==='chair')[1],r=game.mechanics.staticCollision.rects.find(r=>r.source===d);
        const f=game.level.party.footprint;
        game.player={x:r.x-f.x-f.w-6,y:r.y-f.y-f.h-6};
      });
      await page.keyboard.down('ArrowRight');await page.keyboard.down('ArrowDown');
      await page.evaluate(()=>{
        for(let i=0;i<60;i++){
          game._update(1/60);game.input.endFrame();
          if(game.birthday.blockedAt(game.player.x,game.player.y))throw Error('斜向绕角进入障碍');
        }
      });
      await page.keyboard.up('ArrowRight');await page.keyboard.up('ArrowDown');

      // Real pointer events on the virtual pad exercise the mobile input path.
      if(touch){
        await page.evaluate(()=>{game.player={x:20*16,y:15*16};});
        await page.locator('[data-key=right]').dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true});
        await page.evaluate(()=>{const x=game.player.x;game._update(.05);game.input.endFrame();if(game.player.x<=x)throw Error('触屏方向键未移动');});
        await page.locator('[data-key=right]').dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',isPrimary:true});
      }
      const views=[['chairs',13,18],['stage',19,8],['storage',6,7],['entry',19,25]];
      for(const [label,x,y] of views){
        await page.evaluate(([x,y])=>{game.player={x:x*16,y:y*16};game._entryFade=0;game._followCamera();game.birthday.debugCollision=false;game._render();},[x,y]);
        await page.locator('#game').screenshot({path:path.join(output,name+'-'+label+'.png')});
        await page.evaluate(()=>{game.birthday.debugCollision='occlusion';game._render();});
        await page.locator('#game').screenshot({path:path.join(output,name+'-'+label+'-debug.png')});
      }
      const complete=await page.evaluate(()=>{
        game.birthday.debugCollision=false;game._startNewGame();level1Playthrough.finishDialogue(game);
        return level1Playthrough.playLevel1(game,{
          onMusic(g){
            for(const [x,y] of [[13,18],[16,18],[6,8],[5,7],[19,10],[19,9],[19,8]])level1Playthrough.walkTo(g,x,y);
            g._entryFade=0;g._followCamera();g._render();
            window.stageImage=document.getElementById('game').toDataURL();
          },
          beforePortal(g){
            for(const id of ['haewon','bae','jiwoo','kyujin'])level1Playthrough.talkTo(g,id);
            g._entryFade=0;g._followCamera();g._render();
            window.backstageImage=document.getElementById('game').toDataURL();
          },
        });
      });
      assert.deepEqual(complete,{stars:3,sheep:1,gateOpen:true,state:'clear'});
      for(const label of ['stage','backstage']){
        const data=await page.evaluate(label=>window[label+'Image'],label);
        fs.writeFileSync(path.join(output,name+'-route-'+label+'.png'),Buffer.from(data.split(',')[1],'base64'));
      }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      results.push({name,approaches,complete});await context.close();
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors},null,2));
    console.log('全部通过：四向持续输入 × 15/30/60/144fps、斜向绕角、触屏方向键、调试叠加、完整三星/唱片/后台路线；desktop + touch');
  }finally{
    if(browser)await browser.close().finally(()=>new Promise(resolve=>server.close(resolve)));
    else await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
