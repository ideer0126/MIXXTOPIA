#!/usr/bin/env node
'use strict';
// Level 1 hall + backstage audit: reachable furniture approaches, silhouette gaps,
// and the real story route. External requests are stubbed; no account writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.MIXX_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),output=process.env.MIXX_MAP_OUTPUT||'/tmp/mixxtopia-map';
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const server=http.createServer((req,res)=>{
    const file=path.resolve(repo,'.'+new URL(req.url,'http://local').pathname.replace(/\/$/,'/index.html'));
    if(!file.startsWith(repo+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(err,body)=>{if(err){res.writeHead(404).end();return;}
      res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'text/plain'}).end(body);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.MIXX_CHROME||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
  const results=[],errors=[];
  try{
    for(const [name,options] of [['desktop',{viewport:{width:1280,height:900}}],['touch',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}],['landscape',{viewport:{width:844,height:390},isMobile:true,hasTouch:true}]]){
      const context=await browser.newContext(options);
      await context.addInitScript(()=>window.MIXX_NO_BOOT=true);
      await context.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.fulfill({body:''}));
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      await page.goto(base);await page.addScriptTag({url:base+'/tools/play-level1.js'});
      await page.evaluate(async()=>{
        window.game=MIXX.main.boot();game.stop();game._startNewGame();level1Playthrough.finishDialogue(game);
        await Promise.all([...game._sceneryImages.values()].map(i=>i.decode()));game._entryFade=0;game._drawInteractionPrompt=()=>{};
        window.auditRoom=()=>{
          const g=game,area=g._currentArea(),seed={...g.player},C=MIXX.collision,blocked=(x,y)=>g.birthday.blockedAt(x,y),nodes=[[seed.x,seed.y]],previous=new Map([[seed.x+','+seed.y,null]]);
          for(let j=0;j<nodes.length;j++){
            const[x,y]=nodes[j];
            for(const[dx,dy]of[[4,0],[-4,0],[0,4],[0,-4]]){
              const nx=x+dx,ny=y+dy,k=nx+','+ny;
              if(previous.has(k)||nx<area.rect.x*16||nx>=(area.rect.x+area.rect.w)*16||ny<area.rect.y*16||ny>=(area.rect.y+area.rect.h)*16||C.trace(x,y,dx,dy,blocked).blocked)continue;
              previous.set(k,x+','+y);nodes.push([nx,ny]);
            }
          }
          const objects=g.level.decorations.filter(d=>d.room===area.id&&(d.collision||d.collisionRects||d.occlusionShape||d.occlusionShapes)),checks=[],sheets=[],kinds=new Set();
          let sheet,c,card=0;
          for(const[index,d]of objects.entries()){
            const solids=g.mechanics.staticCollision.rects.filter(r=>r.source===d);
            const r=solids.length?{x:Math.min(...solids.map(r=>r.x)),y:Math.min(...solids.map(r=>r.y)),right:Math.max(...solids.map(r=>r.x+r.w)),bottom:Math.max(...solids.map(r=>r.y+r.h))}:d.collision?{x:d.collision.x*16,y:d.collision.y*16,right:(d.collision.x+d.collision.w)*16,bottom:(d.collision.y+d.collision.h)*16}:{x:(d.x+d.w/2)*16-2,y:(d.depth??d.y+d.h)*16-2,right:(d.x+d.w/2)*16+2,bottom:(d.depth??d.y+d.h)*16+2};
            const cx=(r.x+r.right)/2,cy=(r.y+r.bottom)/2,approaches=[];
            for(const[side,tx,ty,dx,dy]of[['north',cx-8,r.y-15,0,1],['south',cx-8,r.bottom-8,0,-1],['west',r.x-13,cy-11.5,1,0],['east',r.right-3,cy-11.5,-1,0]]){
              // Start with room to step back; a seed flush against another wall is not a directional approach.
              const candidates=nodes.filter(([x,y])=>(side==='north'?y+14<=r.y:side==='south'?y+9>=r.bottom:side==='west'?x+12<=r.x:x+4>=r.right)&&!C.trace(x,y,-dx,-dy,blocked).blocked);
              const target=candidates.reduce((best,n)=>!best||Math.hypot(n[0]-tx,n[1]-ty)<Math.hypot(best[0]-tx,best[1]-ty)?n:best,null);
              if(!target||Math.hypot(target[0]-tx,target[1]-ty)>48)continue;
              const route=[];let k=target.join(',');while(previous.get(k)!==null){route.push(k.split(',').map(Number));k=previous.get(k);}
              g.player={...seed};
              for(const[x,y]of route.reverse()){g._moveAxis(x-g.player.x,y-g.player.y);if(g.player.x!==x||g.player.y!==y)throw Error('Reachable route failed: '+d.kind);}
              let moved=0;for(let j=0;j<8;j++){const before={...g.player};g._moveAxis(dx,dy);moved+=Math.hypot(g.player.x-before.x,g.player.y-before.y);if(blocked(g.player.x,g.player.y))throw Error('Entered solid: '+d.kind);}
              const at={...g.player};g._moveAxis(-dx,-dy);const retreat=g.player.x!==at.x||g.player.y!==at.y;
              if(!retreat)throw Error('Cannot retreat: '+d.kind+' #'+index+' from '+side);
              g.birthday.updatePlayer(0,0,0);g._entryFade=0;g._followCamera();g._render();
              approaches.push({side,steps:route.length,moved,retreat,x:g.player.x,y:g.player.y});
              if(side===approaches[0].side&&!kinds.has(d.kind)){
                if(card%8===0){sheet=document.createElement('canvas');sheet.width=1440;sheet.height=1080;c=sheet.getContext('2d');c.fillStyle='#171b29';c.fillRect(0,0,1440,1080);sheets.push(sheet);}
                const col=card%4,row=Math.floor(card%8/4),px=col*360,py=row*540;
                c.fillStyle='white';c.font='16px sans-serif';c.fillText(d.kind+' #'+index,px+8,py+22);c.fillText(side+' / '+route.length+' steps',px+8,py+44);
                const scale=g.renderer.ctx.canvas.width/320,w=Math.min(320,Math.max(100,d.w*16+48)),h=Math.min(224,Math.max(85,d.h*16+48)),sx=Math.max(0,Math.min(320-w,(d.x+d.w/2)*16-g.camera.x-w/2)),sy=Math.max(0,Math.min(224-h,(d.y+d.h/2)*16-g.camera.y-h/2));
                const size=Math.min(344/w,440/h);c.drawImage(g.renderer.ctx.canvas,sx*scale,sy*scale,w*scale,h*scale,px+8,py+60,w*size,h*size);card++;kinds.add(d.kind);
              }
            }
            if(!approaches.length)throw Error('No reachable approach: '+d.kind+' #'+index);
            checks.push({kind:d.kind,index,approaches});
          }
          g.player=seed;return{area:area.id,nodes:nodes.length,objects:checks,images:sheets.map(c=>c.toDataURL('image/png'))};
        };
      });
      const hallPixels=await page.evaluate(()=>{
        const g=game,c=g.renderer.ctx,scale=c.canvas.width/320,draw=g.birthday.drawSprite,result=[];
        for(const probe of [
          {name:'drum-stand-gap',x:16.1,y:5.6,solid:[618,189],gap:[620,204]},
          {name:'cake-balloons',x:7.6,y:11.2,solid:[285,429],gap:[327,406]},
          {name:'cake-anchor',x:8.3,y:12.7,solid:[303,485],gap:[309,501]},
          {name:'fishing-seat',x:33.05,y:20.4,solid:[1257,762],gap:[1257,794]},
          {name:'stage-plant',x:31.6,y:8.8,solid:[1168,312],gap:[1188,359]}
        ]){
          g.player={x:probe.x*16,y:probe.y*16};g._followCamera();g._entryFade=0;
          const sample=()=>[probe.solid,probe.gap].map(([x,y])=>Array.from(c.getImageData(Math.round((x/1500*640-g.camera.x)*scale),Math.round((y/1049*448-g.camera.y)*scale),1,1).data));
          g.birthday.drawSprite=function(e,p){if(!p)draw.call(this,e,p);};g._render();const background=sample();
          g.birthday.drawSprite=function(e,p){if(!p){draw.call(this,e,p);return;}c.fillStyle='#ff00ff';c.fillRect(g.player.x+8-20-g.camera.x,g.player.y+14-40-g.camera.y,40,40);};g._render();const actual=sample();
          const actors=g.birthday.drawActors;g.birthday.drawActors=function(){this.drawSprite(g.player,true);};g._render();const uncovered=sample();g.birthday.drawActors=actors;
          result.push({name:probe.name,background,actual,uncovered});
        }
        g.birthday.drawSprite=draw;g.player={x:19*16,y:25*16};return result;
      });
      for(const probe of hallPixels){
        assert.deepEqual(probe.actual[0],probe.background[0],probe.name+' foreground covers actors');
        assert.notDeepEqual(probe.actual[0],probe.uncovered[0],probe.name+' probe overlaps the silhouette');
        assert.deepEqual(probe.actual[1],probe.uncovered[1],probe.name+' gap preserves actors');
        assert.notDeepEqual(probe.actual[1],probe.background[1],probe.name+' probe overlaps the gap');
      }
      const hall=await page.evaluate(()=>auditRoom());
      await page.evaluate(async()=>{game._loadSceneryAssets('backstage');await Promise.all([...game._sceneryImages.values()].map(i=>i.decode()));});
      const {run,backstage,backstagePixels}=await page.evaluate(()=>{
        let backstage,backstagePixels;
        const run=level1Playthrough.playLevel1(game,{
          onBackstage(g){
            backstage=auditRoom();
            const c=g.renderer.ctx,scale=c.canvas.width/320,draw=g.birthday.drawSprite,seed={...g.player};backstagePixels=[];
            for(const probe of [
              {name:'back-mirror-gap',cx:558,foot:530,solid:[550,500],gap:[595,500]},
              {name:'south-mirror-gap',cx:558,foot:1035,solid:[550,990],gap:[595,990]},
              {name:'stool-leg-gap',cx:509,foot:320,solid:[490,318],gap:[509,318]},
              {name:'table-leg-gap',cx:480,foot:750,solid:[475,747],gap:[489,747]}
            ]){
              g.player={x:40*16+probe.cx/1327*448-8,y:3*16+probe.foot/1185*400-14};g._followCamera();g._entryFade=0;
              const sample=()=>[probe.solid,probe.gap].map(([x,y])=>Array.from(c.getImageData(Math.round((40*16+x/1327*448-g.camera.x)*scale),Math.round((3*16+y/1185*400-g.camera.y)*scale),1,1).data));
              g.birthday.drawSprite=function(e,p){if(!p)draw.call(this,e,p);};g._render();const background=sample();
              g.birthday.drawSprite=function(e,p){if(!p){draw.call(this,e,p);return;}c.fillStyle='#ff00ff';c.fillRect(g.player.x+8-20-g.camera.x,g.player.y+14-40-g.camera.y,40,40);};g._render();const actual=sample();
              const actors=g.birthday.drawActors;g.birthday.drawActors=function(){this.drawSprite(g.player,true);};g._render();const uncovered=sample();g.birthday.drawActors=actors;
              backstagePixels.push({name:probe.name,background,actual,uncovered});
            }
            g.birthday.drawSprite=draw;g.player=seed;
            for(const id of ['haewon','bae','jiwoo','kyujin'])level1Playthrough.talkTo(g,id);
            g._setState('paused');g._saveAndQuit();window.entrySave=localStorage.getItem(MIXX.main.SAVE_KEY);g._continueGame();
            if(g._currentArea().id!=='backstage'||g.birthday.blockedAt(g.player.x,g.player.y))throw Error('Backstage resume landing');
          },
          onBackstageBlessing(g){
            g._setState('paused');g._saveAndQuit();g._continueGame();
            if(!g._playedNodes.has('l1.backstage.lily')||g._starAvailable(g.level.entities.find(e=>e.id==='s3')))throw Error('Partial blessing save');
          },
          beforePortal(g){
            g._setState('paused');g._saveAndQuit();g._continueGame();
            if(g.stars!==3||!g._portalActive())throw Error('Collected s3 save');
          }
        });return{run,backstage,backstagePixels};
      });
      assert.deepEqual(run,{stars:3,sheep:1,gateOpen:true,state:'clear'});
      await page.evaluate(()=>{localStorage.setItem(MIXX.main.SAVE_KEY,entrySave);game._setState('title');game._continueGame();game._entryFade=0;});
      for(const fps of [15,30,60,144])for(const [key,x,y] of [['ArrowRight',65,20],['ArrowLeft',50,20],['ArrowDown',50,20],['ArrowUp',50,13.25]]){
        await page.evaluate(([x,y])=>{game.player={x:x*16,y:y*16};},[x,y]);
        await page.keyboard.down(key);
        const moved=await page.evaluate(fps=>{
          const start={...game.player};for(let i=0;i<fps*2;i++){game._update(1/fps);if(game.birthday.blockedAt(game.player.x,game.player.y))throw Error('Backstage keyboard entered solid');}
          return Math.hypot(game.player.x-start.x,game.player.y-start.y);
        },fps);
        await page.keyboard.up(key);assert.ok(moved>1,key+' backstage input moves');
      }
      await page.evaluate(()=>{game.player={x:50*16,y:13.25*16};});
      await page.keyboard.down('ArrowRight');await page.keyboard.down('ArrowDown');
      await page.evaluate(()=>{for(let i=0;i<120;i++){game._update(1/60);if(game.birthday.blockedAt(game.player.x,game.player.y))throw Error('Backstage diagonal entered solid');}});
      await page.keyboard.up('ArrowRight');await page.keyboard.up('ArrowDown');
      if(name!=='desktop'){
        await page.evaluate(()=>{game.player={x:65*16,y:20*16};});
        await page.locator('[data-key=left]').dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true});
        const x=await page.evaluate(()=>{for(let i=0;i<60;i++){game._update(1/60);if(game.birthday.blockedAt(game.player.x,game.player.y))throw Error('Backstage touch entered solid');}return game.player.x;});
        await page.locator('[data-key=left]').dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',isPrimary:true});
        assert.ok(x<65*16-40,'backstage touch pad moves left');
      }
      await page.evaluate(()=>{game._setState('paused');game._restartLevel();if(game._currentArea().id!=='hall'||game._playedNodes.has('l1.backstage.arrived'))throw Error('Replay must return to hall');});
      for(const probe of backstagePixels){
        assert.deepEqual(probe.actual[0],probe.background[0],probe.name+' foreground covers actors');
        assert.notDeepEqual(probe.actual[0],probe.uncovered[0],probe.name+' probe overlaps the silhouette');
        assert.deepEqual(probe.actual[1],probe.uncovered[1],probe.name+' gap preserves actors');
        assert.notDeepEqual(probe.actual[1],probe.background[1],probe.name+' probe overlaps the gap');
      }
      hall.images.forEach((data,i)=>fs.writeFileSync(path.join(output,name+'-hall-'+i+'.png'),Buffer.from(data.split(',')[1],'base64')));delete hall.images;
      backstage.images.forEach((data,i)=>fs.writeFileSync(path.join(output,name+'-backstage-'+i+'.png'),Buffer.from(data.split(',')[1],'base64')));delete backstage.images;
      results.push({name,hall,backstage,hallPixels,backstagePixels,run});await context.close();
    }
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors},null,2));
    console.log(results.map(r=>r.name+': '+r.hall.objects.length+' hall + '+r.backstage.objects.length+' backstage objects; '+r.backstage.objects.reduce((n,o)=>n+o.approaches.length,0)+' backstage approaches; silhouette pixels, real inputs, saves, replay and full route passed').join('\n'));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
