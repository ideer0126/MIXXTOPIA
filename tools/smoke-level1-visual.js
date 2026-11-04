#!/usr/bin/env node
'use strict';
// Screenshot-feedback regression: native foreground pixels and a fixed guitarist body.
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.MIXX_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),output=process.env.MIXX_VISUAL_OUTPUT||'/tmp/mixxtopia-visual';
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const errors=[],results=[];
  const server=http.createServer((req,res)=>{
    const file=path.resolve(repo,'.'+new URL(req.url,'http://local').pathname.replace(/\/$/,'/index.html'));
    if(!file.startsWith(repo+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(err,body)=>{if(err){res.writeHead(404).end();return;}
      res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'text/plain'}).end(body);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:process.env.MIXX_CHROME||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
  try{
    for(const touch of [false,true]){
      const name=touch?'touch':'desktop',context=await browser.newContext(touch?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}});
      await context.addInitScript(()=>window.MIXX_NO_BOOT=true);
      await context.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.fulfill({body:''}));
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base);await page.addScriptTag({url:base+'/tools/play-level1.js'});
      await page.evaluate(async()=>{window.game=MIXX.main.boot();game.stop();game._startNewGame();level1Playthrough.finishDialogue(game);await Promise.all(Array.from(game._sceneryImages.values(),img=>img.decode()));game._entryFade=0;});
      const motion=await page.evaluate(()=>{
        const e=game.level.entities.find(e=>e.id==='kyujin'&&e.room==='hall'),pose=game.birthday.pose(e,false);
        const frames=game.birthday.cachedFrames(pose)[0],base=frames[0].getContext('2d').getImageData(0,0,60,60).data;
        const changes=[];
        for(const frame of frames){
          const data=frame.getContext('2d').getImageData(0,0,60,60).data;let inside=0,outside=0;
          for(let y=0;y<60;y++)for(let x=0;x<60;x++){
            const i=(y*60+x)*4;if([0,1,2,3].some(c=>data[i+c]!==base[i+c])){
              if(x>=18&&x<32&&y>=32&&y<46)inside++;else outside++;
            }
          }
          changes.push({inside,outside});
        }
        return changes;
      });
      assert.ok(motion.slice(1).every(c=>c.inside>0),'拨弦手须实际变化');
      assert.ok(motion.every(c=>c.outside===0),'头发、脸、身体、吉他和鞋的像素必须固定');
      const probes=await page.evaluate(()=>{
        const g=game,c=g.renderer.ctx,detail=c.canvas.width/320,draw=g.birthday.drawSprite;
        function probe(x,y,cameraX,cameraY,points){
          g.player={x:x*16,y:y*16};g.camera.x=cameraX;g.camera.y=cameraY;
          const sample=()=>points.map(([sx,sy])=>Array.from(c.getImageData(Math.round((sx/1500*640-g.camera.x)*detail),Math.round((sy/1049*448-g.camera.y)*detail),1,1).data));
          g.birthday.drawSprite=function(e,player){if(!player)draw.call(this,e,false);};g._render();const background=sample();
          g.birthday.drawSprite=function(e,player){if(!player){draw.call(this,e,false);return;}c.fillStyle='#ff00ff';c.fillRect(g.player.x+8-20-g.camera.x,g.player.y+14-40-g.camera.y,40,40);};
          g._render();const actual=sample();
          const actors=g.birthday.drawActors;
          g.birthday.drawActors=function(){this.drawSprite(g.player,true);};
          g._render();const uncovered=sample();
          g.birthday.drawActors=actors;g.birthday.drawSprite=draw;
          return{background,actual,uncovered};
        }
        return{
          piano:probe(14.31,4.76,190,0,[[550,164],[515,180]]),
          curtainLeft:probe(31.8,6.1,400,0,[[1190,220],[1190,230]]),
          curtainRight:probe(34.7,6.1,400,0,[[1318,227],[1314,216]]),
          giftWhale:probe(36,10.2,320,70,[[1370,340],[1410,360]]),
          giftStrings:probe(35.5,11.7,320,70,[[1336,420],[1351,422]]),
          giftFront:probe(35.5,14.5,320,70,[[1350,510]]),
          whale:probe(14.5,22.3,100,280,[[550,862]]),
          balloonsRight:probe(29.5,6.9,320,0,[[1105,200],[1094,238],[1114,269],[1118,285],[1113,287],[1123,286]])
        };
      });
      assert.deepEqual(probes.piano.actual[0],probes.piano.uncovered[0],'钢琴轮廓外不能用背景切掉人物');
      assert.deepEqual(probes.piano.actual[1],probes.piano.background[1],'钢琴实体轮廓仍应盖住后方人物');
      for(const key of ['curtainLeft','curtainRight']){
        assert.deepEqual(probes[key].actual,probes[key].uncovered,key+' 幕布不能盖住主角');
        assert.notDeepEqual(probes[key].actual,probes[key].background,key+' 探针必须覆盖实际幕布像素');
      }
      assert.deepEqual(probes.whale.actual,probes.whale.background,'入口鲸鱼气球须盖住后方人物');
      for(const i of [0,1,2,4,5]){
        assert.deepEqual(probes.balloonsRight.actual[i],probes.balloonsRight.background[i],'右侧气球、贝壳和绳线应遮住后方人物：'+i);
        assert.notDeepEqual(probes.balloonsRight.actual[i],probes.balloonsRight.uncovered[i],'气球遮挡探针必须覆盖人物：'+i);
      }
      assert.deepEqual(probes.balloonsRight.actual[3],probes.balloonsRight.uncovered[3],'贝壳下方绳线之间的木背景不能切掉人物');
      assert.notDeepEqual(probes.balloonsRight.actual[3],probes.balloonsRight.background[3],'绳线空隙须保留可见人物');
      assert.deepEqual(probes.giftWhale.actual[0],probes.giftWhale.background[0],'礼物台鲸鱼上半身须盖住后方主角');
      assert.notDeepEqual(probes.giftWhale.actual[0],probes.giftWhale.uncovered[0],'鲸鱼探针必须覆盖主角');
      for(const key of ['giftWhale','giftStrings']){
        assert.deepEqual(probes[key].actual[1],probes[key].uncovered[1],key+' 外轮廓与绳线空隙不能切掉主角');
        assert.notDeepEqual(probes[key].actual[1],probes[key].background[1],key+' 空隙须显示主角');
      }
      assert.deepEqual(probes.giftStrings.actual[0],probes.giftStrings.background[0],'礼物台气球细绳须盖住后方主角');
      assert.notDeepEqual(probes.giftStrings.actual[0],probes.giftStrings.uncovered[0],'细绳探针须覆盖主角');
      assert.deepEqual(probes.giftFront.actual,probes.giftFront.uncovered,'走到礼物台前方时，主角须盖住桌前沿');
      await page.evaluate(()=>{game.player={x:19*16,y:25*16};level1Playthrough.walkTo(game,33,11);level1Playthrough.walkTo(game,36,10);});
      const scenarios=[['piano',16.5,5,-1,0],['bench',14.7,7.65,0,-1],['stage-front',24,7,0,1],['storage-plant',7,9.1,-1,0],['storage-floor',3.4,6.3,1,0],['ring-post',5.8,14.7,0,0],['west-plant',3,22,-1,0],['entry-whale',14.5,22.3,0,0],['west-stool',32,21,1,0],['east-stool',35.8,22,1,0],['curtain-left',31.9,7.2,0,-1],['curtain-right',36.2,7.2,0,-1],['right-balloons',29.5,6.8,0,1],['cake-gifts',7.3,10.4,-1,0],['cake-whale',9,12.7,-1,0],['gift-whale',36,10,0,0],['gift-strings',35.5,11.7,0,0],['gift-front',35.5,14.5,0,0]];
      for(const [label,x,y,dx,dy] of scenarios){
        const end=await page.evaluate(([x,y,dx,dy])=>{
          game.player={x:x*16,y:y*16};
          if(game.birthday.blockedAt(game.player.x,game.player.y))throw Error('起点被挡 '+x+','+y);
          for(let i=0;i<32;i++)game._moveAxis(dx,dy);
          if(game.birthday.blockedAt(game.player.x,game.player.y))throw Error('移动进入实体');
          game._followCamera();game._render();return{...game.player};
        },[x,y,dx,dy]);
        if(label==='storage-floor')assert.equal(end.x,x*16+32,'圈出的地板须能实际走过，不能只在原地摆放人物');
        await page.locator('#game').screenshot({path:path.join(output,name+'-'+label+'.png')});
      }
      for(let phase=0;phase<4;phase++){
        await page.evaluate(phase=>{game.player={x:20*16,y:9*16};game.camera.x=190;game.camera.y=0;game.birthday.time=(phase+.1)/6;game._render();},phase);
        const data=await page.evaluate(()=>game.renderer.ctx.canvas.toDataURL('image/png'));
        fs.writeFileSync(path.join(output,name+'-performance-'+phase+'.png'),Buffer.from(data.split(',')[1],'base64'));
      }
      results.push({name,motion,probes,scenarios:scenarios.length});await context.close();
    }
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors},null,2));
    console.log('全部通过：手部之外逐像素固定、钢琴轮廓内外、两侧幕布不遮挡、右侧气球与绳线空隙、入口鲸鱼遮挡、礼物台鲸鱼与绳线空隙、18 处反馈截图；desktop + touch');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
