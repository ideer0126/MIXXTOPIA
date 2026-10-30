/** Birthday Wish 场景：可走动的人物、前后遮挡与套圈小游戏。 */
'use strict';
(function(root){
  const T=16;
  // Logical canvas coordinates are shared by drawing and swept collision checks.
  const RINGS={x:160,launchY:174,speed:84,radius:4,left:8,right:312,
    stages:[{name:'鲸鱼',scale:1},{name:'月亮',scale:1.25},{name:'星星',scale:1.5}],
    obstacleFrames:[[251,54,790,624],[1175,88,754,590]],
    frames:[[38,179,425,359],[503,163,350,373],[898,171,367,355],[1299,283,444,159],[1774,172,370,368]]};

  // Earliest contact between the flying ring and a horizontally moving rectangle.
  function ringImpact(shot,body,dt,padding){
    let enter=0,leave=dt;
    for(const [distance,velocity,half] of [[body.x-RINGS.x,body.vx,body.w/2+padding],
      [body.y-shot.y,RINGS.speed,body.h/2+padding]]){
      if(!velocity){if(Math.abs(distance)>half)return Infinity;continue;}
      const a=(-half-distance)/velocity,b=(half-distance)/velocity;
      enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));
    }
    return enter<=leave?enter:Infinity;
  }
  class Birthday {
    constructor(game){
      this.g=game;this.time=0;this.rings=null;
      this.playerMotion={walking:false,time:0};this.frameCache=new Map();
    }
    inHall(){ return this.g._currentArea().id==='hall'; }
    direction(dx,dy){if(!dx&&!dy)return 0;return Math.abs(dx)>Math.abs(dy)?(dx>0?1:3):(dy>0?0:2);}
    footprint(x,y,actor){
      const f=actor&&actor.age==='child'?{x:5,y:10,w:6,h:4}:this.g.level.party.footprint;
      return{x:x+f.x+(actor&&actor.spriteOffsetX||0)*T,y:y+f.y+(actor&&actor.spriteOffsetY||0)*T,w:f.w,h:f.h};
    }
    blockedAt(x,y,actor){
      const g=this.g,f=this.footprint(x,y,actor);
      if(g.mechanics.blockedAt(f.x,f.y,f.w,{height:f.h}))return true;
      const room=actor?(actor.room||'hall'):g._currentArea().id;
      const occupied=g.level.entities.filter(e=>e!==actor&&(e.type==='npc'||e.type==='guest')&&(e.room||'hall')===room)
        .map(e=>this.footprint(e.x*T,e.y*T,e));
      // 巡游者忽略自身，也把玩家视为占位；互动视线仍只检查地形。
      if(actor&&g._currentArea().id===room)occupied.push(this.footprint(g.player.x,g.player.y));
      return occupied.some(r=>root.MIXX.collision.overlaps(f,r));
    }
    updatePlayer(dx,dy,dt){
      this.playerMotion.walking=!!(dx||dy);
      this.playerMotion.time=this.playerMotion.walking?this.playerMotion.time+dt:0;
    }
    update(dt){
      this.time+=dt;
      // 六位 Muse 只转身与原地演出，从不进入巡游逻辑。
      for(const e of this.g._entitiesOf('npc'))if(e.museStyle){
        const dx=this.g.player.x-e.x*T,dy=this.g.player.y-e.y*T;
        e._dir=!e.performance&&Math.hypot(dx,dy)<36?this.direction(dx,dy):0;
      }
      if(!this.inHall())return;
      for(const e of this.g._entitiesOf('guest')){
        e._walking=false;
        if(!e.path)continue;
        if(e._rest>0){e._rest=Math.max(0,e._rest-dt);continue;}
        const target=e.path[e._waypoint||0],dx=target[0]-e.x,dy=target[1]-e.y;
        const distance=Math.hypot(dx,dy);
        if(distance<0.01){
          e._waypoint=((e._waypoint||0)+1)%e.path.length;e._rest=.28;e._walkDistance=0;continue;
        }
        if(Math.hypot(e.x*T-this.g.player.x,e.y*T-this.g.player.y)<24)continue;
        const step=Math.min(distance,dt*0.9),nx=e.x+dx/distance*step,ny=e.y+dy/distance*step;
        e._dir=this.direction(dx,dy);
        const end=root.MIXX.collision.trace(e.x*T,e.y*T,(nx-e.x)*T,(ny-e.y)*T,(x,y)=>this.blockedAt(x,y,e));
        const moved=Math.hypot(end.x-e.x*T,end.y-e.y*T);
        e.x=end.x/T;e.y=end.y/T;e._walking=moved>0;e._walkDistance=(e._walkDistance||0)+moved;
        if(end.blocked){e._waypoint=((e._waypoint||0)+1)%e.path.length;e._rest=.28;}
      }
    }
    interact(e){
      const g=this.g;
      if(e.type==='npc'||e.type==='guest')e._dir=this.direction(g.player.x-e.x*T,g.player.y-e.y*T);
      if(e.type==='guest'){
        g._playNode('guest:'+e.id,{node:{lines:e.lines.map(t=>({s:'nar',t}))}});return true;
      }
      if(e.type!=='minigame')return false;
      if(g._playedNodes.has(e.dialogue)||g.collected.includes('s1')){
        g._playNode('ring.done',{node:{lines:[{s:'bae',t:'三个靶已经全部套中了。愿望之星就在摊位前，接下来去杂物间看看吧。'}]}});
      }else{
        g._playNode('ring.rules',{node:{lines:[
          {s:'bae',t:'欢迎来套圈！鲸鱼、月亮、星星依次横向游过，每个阶段都有礼物船和蛋糕船来回漂过，后面的阶段会更快。'},
          {s:'bae',t:'按 E / 空格 / 手机 A，从下方沿直线投圈。圈飞过去需要时间，记得预判目标和两艘小船！撞船或投空都算失败。'},
          {s:'bae',t:'三个目标共享三次失败机会，命中不会补回机会。累计失败三次就从鲸鱼重新挑战；同一轮全部套中，才有愿望之星。Esc / 暂停可以休息。'}
        ]},onEnd:()=>this.startRings()});
      }
      return true;
    }
    startRings(stage=0,failures=0){
      const scale=RINGS.stages[stage].scale;
      this.rings={stage,hits:stage,failures,time:0,visualTime:0,phase:'ready',armed:false,shot:null,
        message:'预判移动，避开两艘小船',feedback:0,result:null,
        target:{x:64,y:92,w:24,h:14,vx:48*scale},
        obstacles:[{x:112,y:148,w:26,h:8,vx:-60*scale,min:44,max:276},
          {x:244,y:120,w:26,h:8,vx:72*scale,min:44,max:276}]};
    }
    updateRings(dt){
      const r=this.rings,g=this.g;if(!r)return;
      this.playerMotion.walking=false;this.playerMotion.time=0;
      r.visualTime+=dt;
      if(r.phase==='feedback'){
        r.feedback=Math.max(0,r.feedback-dt);
        if(r.feedback>0)return;
        if(r.hits===3){
          this.rings=null;
          g._playNode('l1.rings.complete',{onEnd:()=>{g._refreshHud();g._emit('minigame',{id:'ring-toss',complete:true});}});
        }else this.startRings(r.failures===3?0:r.hits,r.failures===3?0:r.failures);
        return;
      }
      // The dialogue's final key and held keys must be released before throwing.
      if(!g.input.isDown('confirm'))r.armed=true;
      if(g.input.wasPressed('confirm')){
        if(r.phase==='ready'&&r.armed){r.shot={y:RINGS.launchY};r.phase='flight';}
        r.armed=false;
      }
      let remaining=dt;
      while(remaining>1e-9){
        if(r.target.x>=RINGS.right-1e-9)r.target.x=RINGS.left;
        for(const o of r.obstacles){
          if(o.x<=o.min+1e-9)o.vx=Math.abs(o.vx);
          if(o.x>=o.max-1e-9)o.vx=-Math.abs(o.vx);
        }
        // Split at wraps and bounces as well as at 120 Hz. A wrap is a teleport,
        // never a sweep across the middle of the field.
        let step=Math.min(remaining,1/120);
        if(r.target.vx)step=Math.min(step,(RINGS.right-r.target.x)/r.target.vx);
        for(const o of r.obstacles)if(o.vx)step=Math.min(step,((o.vx>0?o.max:o.min)-o.x)/o.vx);
        let contact=null,impact=Infinity;
        if(r.shot){
          for(const body of [...r.obstacles,r.target]){
            // Target capture requires the ring centre to enter its marked area;
            // a boat hull blocks as soon as the outside rim touches it.
            const t=ringImpact(r.shot,body,step,body===r.target?0:RINGS.radius);
            if(t<impact){impact=t;contact=body;}
          }
          if(contact)step=impact;
        }
        r.target.x+=r.target.vx*step;
        for(const o of r.obstacles)o.x+=o.vx*step;
        if(r.shot)r.shot.y-=RINGS.speed*step;
        r.time+=step;remaining-=step;
        if(contact||r.shot&&r.shot.y<=76){
          r.result=contact===r.target?'hit':contact?'obstacle':'miss';
          r.phase='feedback';r.feedback=.95;
          if(r.result==='hit'){
            r.hits++;r.message=RINGS.stages[r.stage].name+'套中了！';g._sfx('switch');
          }else{
            r.failures++;g._sfx('box');
            r.message=r.result==='obstacle'?(contact===r.obstacles[0]?'撞到礼物船了':'撞到蛋糕船了'):'投空了，目标已经游走';
            if(r.failures===3){r.message='累计失败 3 次，从鲸鱼重新开始';r.feedback=1.65;}
            else r.message+=' · 剩余 '+(3-r.failures)+' 次';
          }
          return;
        }
      }
    }
    drawRings(){
      if(!this.rings||this.g.state!=='playing')return;
      const g=this.g,r=this.rings,c=g.renderer.ctx;
      const booth=g._sceneryImages.get(g.level.sceneryAssets.ringsBooth);
      const toys=g._sceneryImages.get(g.level.sceneryAssets.ringsToys);
      const hasToys=toys&&toys.complete&&toys.naturalWidth;
      const boats=g._sceneryImages.get(g.level.sceneryAssets.ringsObstacles);
      const hasBoats=boats&&boats.complete&&boats.naturalWidth;
      const feedback=r.phase==='feedback',hit=feedback&&r.result==='hit';
      const effect=feedback?Math.min(1,(r.failures===3?1.65:.95)-r.feedback):0;
      c.save();
      c.fillStyle='#193e57';c.fillRect(0,0,320,224);
      if(booth&&booth.complete&&booth.naturalWidth){
        // Fit the image's three bands around the unchanged playable coordinates.
        c.drawImage(booth,0,0,1499,356,0,0,320,76);
        c.drawImage(booth,0,356,1499,404,0,76,320,105);
        c.drawImage(booth,0,760,1499,289,0,181,320,43);
      }else{
        c.fillStyle='#f5deb0';c.fillRect(38,32,244,35);
        c.fillStyle='#235c78';c.fillRect(24,76,272,105);
        c.fillStyle='#855133';c.fillRect(0,181,320,43);
      }
      // Quiet type on the cream sign, with small collectible stamps below it.
      c.textAlign='center';c.fillStyle='#66432f';c.font='bold 11px sans-serif';
      c.fillText('生日许愿摊',160,44);
      c.font='8px sans-serif';c.fillStyle='#8c6847';c.fillText((r.stage+1)+' / 3',256,44);
      for(let i=0;i<3;i++){
        const x=82+i*67,done=i<r.hits,active=i===r.stage;
        c.globalAlpha=done||active?1:.42;
        if(active&&!done){c.fillStyle='#fff2ce';c.fillRect(x-22,48,58,16);}
        if(hasToys){const f=RINGS.frames[i];c.drawImage(toys,...f,x-19,49,14,13);}
        c.fillStyle=done?'#376652':active?'#68432d':'#8c7558';
        c.font=active?'bold 9px sans-serif':'9px sans-serif';
        c.fillText(RINGS.stages[i].name,x+9,60);
        if(done){c.fillStyle='#376652';c.font='bold 9px sans-serif';c.fillText('✓',x+28,60);}
      }
      c.globalAlpha=1;
      c.save();c.beginPath();c.moveTo(39,76);c.lineTo(281,76);c.lineTo(302,181);c.lineTo(18,181);c.closePath();c.clip();
      c.fillStyle='rgba(14,65,83,.12)';c.fillRect(18,76,284,105);
      // Moving glints and wakes give the pool depth without hiding the boats.
      for(let i=0;i<14;i++){
        const x=32+(i*47)%254,y=82+(i*29)%92;
        c.globalAlpha=.15+.15*Math.sin(r.visualTime*1.7+i);
        c.fillStyle='#d6ffed';c.fillRect(x+Math.sin(r.visualTime+i)*2,y,4+i%3,1);
      }
      c.globalAlpha=1;
      // A subtle, short guide begins at the fixed throwing point.
      for(let y=152;y<173;y+=6){c.fillStyle='rgba(255,243,201,.45)';c.fillRect(159.5,y,1,2);}
      const tx=Math.round(r.target.x),ty=r.target.y;
      c.fillStyle='rgba(7,43,63,.3)';c.beginPath();c.ellipse(tx,ty+8,15,3,0,0,Math.PI*2);c.fill();
      c.strokeStyle='#b9e6d4';c.lineWidth=.65;
      c.beginPath();c.ellipse(tx,ty+7,13,2.5,0,0,Math.PI);c.stroke();
      if(hit){
        c.strokeStyle='rgba(255,241,165,'+(1-effect)+')';c.lineWidth=1;
        c.beginPath();c.ellipse(tx,ty+5,14+effect*23,4+effect*7,0,0,Math.PI*2);c.stroke();
      }
      if(hasToys){
        const f=RINGS.frames[r.stage],w=r.stage===0?29:23,h=r.stage===0?25:24;
        c.drawImage(toys,...f,tx-w/2,ty+7-h,w,h);
      }else{c.fillStyle='#ffe2a0';c.fillRect(tx-12,ty-7,24,14);}
      for(const [i,o] of r.obstacles.entries()){
        const x=Math.round(o.x),y=o.y;
        c.fillStyle='rgba(5,43,58,.3)';c.beginPath();c.ellipse(x,y+5,15,2.5,0,0,Math.PI*2);c.fill();
        c.strokeStyle='rgba(185,235,226,.65)';c.lineWidth=.6;
        c.beginPath();c.ellipse(x,y+4,15+Math.sin(r.visualTime*3+y),3,0,0,Math.PI);c.stroke();
        // Decorative tops sit above the 26×8px collision hull at the waterline.
        if(hasBoats)c.drawImage(boats,...RINGS.obstacleFrames[i],x-14,y-18,28,22);
        else{c.fillStyle='#f3a18f';c.fillRect(x-13,y-4,26,8);}
      }
      if(r.phase==='flight'){
        const travelled=(RINGS.launchY-r.shot.y)/(RINGS.launchY-76);
        c.fillStyle='rgba(8,45,63,.22)';c.beginPath();c.ellipse(160,r.shot.y+4,5,2,0,0,Math.PI*2);c.fill();
        c.strokeStyle='rgba(229,251,227,.55)';c.lineWidth=.7;
        for(let i=1;i<=2;i++){
          c.beginPath();c.ellipse(160,r.shot.y+7*i,3+i,1,0,0,Math.PI);c.stroke();
        }
        c.save();c.translate(160,r.shot.y);c.rotate(travelled*4);
        const size=12-travelled*2;
        if(hasToys)c.drawImage(toys,...RINGS.frames[4],-size/2,-size/2,size,size);
        c.restore();
      }else if(feedback&&r.shot){
        if(hit){
          if(hasToys)c.drawImage(toys,...RINGS.frames[4],tx-14,ty+1,28,10);
          for(let i=0;i<9;i++){
            const angle=i*Math.PI*2/9,d=10+effect*25;
            const x=tx+Math.cos(angle)*d,y=ty-5+Math.sin(angle)*d*.65-effect*5;
            c.globalAlpha=Math.max(0,1-effect);c.fillStyle=i%2?'#fff5b7':'#d9fbe6';
            c.fillRect(x-1,y-2,2,5);c.fillRect(x-2.5,y-.5,5,2);
          }
        }else{
          c.globalAlpha=Math.max(0,1-effect*1.3);c.strokeStyle='#e0ffef';c.lineWidth=.8;
          c.beginPath();c.ellipse(160,r.shot.y+3,5+effect*19,2+effect*6,0,0,Math.PI*2);c.stroke();
          for(let i=0;i<7;i++){
            const spread=(i-3)*effect*11;
            c.fillStyle='#dbfff0';c.fillRect(160+spread,r.shot.y-Math.sin(effect*Math.PI)*10+(i%2)*3,1.5,2.5);
          }
          if(hasToys)c.drawImage(toys,...RINGS.frames[4],155,r.shot.y+effect*10-5,10,10*(1-effect*.65));
        }
      }
      c.restore();c.globalAlpha=1;
      // The remaining rings live on the counter, rather than in a dashboard.
      for(let i=0;i<3;i++){
        const x=43+i*14;c.globalAlpha=i<3-r.failures?1:.2;
        if(hasToys)c.drawImage(toys,...RINGS.frames[4],x-5,203,10,10);
      }
      c.globalAlpha=1;c.textAlign='left';c.font='8px sans-serif';
      c.fillStyle='#fff0ce';c.shadowColor='#573d32';c.shadowBlur=2;
      c.fillText('剩 '+Math.max(0,3-r.failures)+' · 失误 '+r.failures+'/3',89,211);
      c.textAlign='right';c.fillText('E / A 投圈 · Esc 暂停',283,211);
      if(r.phase==='ready'){
        c.fillStyle='rgba(40,69,74,.25)';c.beginPath();c.ellipse(160,175,10,2,0,0,Math.PI*2);c.fill();
        if(hasToys)c.drawImage(toys,...RINGS.frames[4],153,167,14,14);
      }
      c.textAlign='center';c.font='bold 9px sans-serif';
      c.fillStyle=feedback?(hit?'#ebffd7':'#ffe1bd'):'#fff2cf';
      c.fillText(feedback?r.message:r.phase==='flight'?'咻——愿望出发！':'看准时机，让愿望落进圈里',160,194);
      c.restore();
    }
    drawBackground(){
      if(!this.inHall())return false;
      const g=this.g;
      if(g._drawSceneryAsset(g.level.party.background))return true;
      // 图片加载中保留可读的瓦片画面，场景碰撞不依赖图片状态。
      return false;
    }
    pose(e,player){
      const party=this.g.level.party;
      if(e.performance&&e.room==='hall'){
        const style=party.performances[e.performance];
        const frame=this.g.state==='dialogue'?style.restFrame:Math.floor(this.time*style.fps)%style.frames[0].length;
        return{style,key:'performance:'+e.performance,dir:0,frame};
      }
      if(e.museStyle)return{style:party.muses[e.museStyle],key:'muse:'+e.museStyle,dir:e._dir||0,frame:0};
      const key=player?party.playerMotion:e.motionStyle,style=party.animations&&party.animations[key];
      if(!style)return null;
      const face=this.g.facing;
      const dir=player?(face.x||face.y?this.direction(face.x,face.y):0):(e._dir||0);
      const moving=player?this.playerMotion.walking:e._walking;
      const phase=player?Math.floor(this.playerMotion.time/.15):Math.floor((e._walkDistance||0)/3);
      const idle=this.g.state==='dialogue'||!!this.rings;
      return{style,key,dir,frame:!idle&&moving?phase%4:0};
    }
    cachedFrames(pose){
      if(this.frameCache.has(pose.key))return this.frameCache.get(pose.key);
      const g=this.g,style=pose.style,img=g._sceneryImages.get(g.level.sceneryAssets[style.art]);
      if(!img||!img.complete||!img.naturalWidth||!g.doc||!g.doc.createElement)return null;
      const detail=style.detailScale||1,cacheW=40*detail,cacheH=40*detail;
      const rows=[];
      for(const row of style.frames){
        const maxW=Math.max(...row.map(f=>f[2])),maxH=Math.max(...row.map(f=>f[3]));
        const sx=(style.width||Math.min(style.maxWidth||22,style.height*maxW/maxH))/maxW,sy=style.height/maxH;
        const frames=[];
        for(const f of row){
          const cell=g.doc.createElement('canvas');
          if(typeof cell.getContext!=='function')return null;
          cell.width=cacheW;cell.height=cacheH;const c=cell.getContext('2d');if(!c)return null;
          c.imageSmoothingEnabled=false;
          c.drawImage(img,f[0],f[1],f[2],f[3],Math.round(cacheW/2-f[4]*sx*detail),Math.round(cacheH-f[3]*sy*detail),Math.round(f[2]*sx*detail),Math.round(f[3]*sy*detail));
          frames.push(cell);
        }
        rows.push(frames);
      }
      if(style.motionRegion){
        const [x,y,w,h]=style.motionRegion.map(value=>Math.round(value*detail));
        for(const row of rows){
          const neutral=row[style.restFrame];
          for(let i=0;i<row.length;i++){
            if(i===style.restFrame)continue;
            // 只合成拨弦区域，避免 file:// 图片污染画布后读取像素。
            const cell=g.doc.createElement('canvas');cell.width=cacheW;cell.height=cacheH;
            const c=cell.getContext('2d');c.imageSmoothingEnabled=false;
            c.drawImage(neutral,0,0);c.clearRect(x,y,w,h);
            c.drawImage(row[i],x,y,w,h,x,y,w,h);row[i]=cell;
          }
        }
      }
      if(style.alternateFeet)this.alternateFeet(rows,style.footBounds);
      this.frameCache.set(pose.key,rows);return rows;
    }
    alternateFeet(rows,bounds){
      // 脚底边界取自图集配置，避免 file:// 图片污染画布后读取像素导致绘制报错。
      for(const [i,dir] of [0,2].entries()){
        const neutral=rows[dir][0],[lo,hi]=bounds[i],mid=Math.floor((lo+hi)/2);
        for(const frame of [1,3]){
          const c=rows[dir][frame].getContext('2d'),leftForward=frame===1;
          c.clearRect(0,34,neutral.width,6);
          c.drawImage(neutral,lo,34,mid-lo,6,lo,34,mid-lo,leftForward?6:4);
          c.drawImage(neutral,mid,34,hi-mid,6,mid,34,hi-mid,leftForward?4:6);
        }
      }
    }
    drawSprite(e,player){
      const g=this.g,ctx=g.renderer.ctx,pose=this.pose(e,player);
      const h=e.age==='child'?25:40;
      const px=(player?g.player.x:e.x*T)+(e.spriteOffsetX||0)*T,py=(player?g.player.y:e.y*T)+(e.spriteOffsetY||0)*T;
      let drawn=false;
      if(pose){
        const cached=this.cachedFrames(pose);
        if(cached){ctx.drawImage(cached[pose.dir][pose.frame],Math.round(px+8-20-g.camera.x),Math.round(py+14-40-g.camera.y),40,40);drawn=true;}
        else{
          const frame=pose.style.frames[pose.dir][pose.frame],w=h*frame[2]/frame[3];
          drawn=g._drawSceneryAsset({art:pose.style.art,frame,x:(px+8-w/2)/T,y:(py+14-h)/T,w:w/T,h:h/T});
        }
      }
      if(!drawn){
        const frame=g.level.party.sprites[e.sprite||0][0],w=h*frame[2]/frame[3];
        if(!g._drawSceneryAsset({art:'guests',frame,x:(px+8-w/2)/T,y:(py+14-h)/T,w:w/T,h:h/T})){
          ctx.fillStyle=e.age==='child'?'#eab9ca':'#92b6d2';ctx.fillRect(px-g.camera.x+3,py-g.camera.y+14-h,10,h);
        }
      }
      if(!player&&e.type==='npc'&&g._npcNeedsTalk(e)){
        g._drawTalkBubble(px+8-g.camera.x,py+14-h-g.camera.y);
      }
    }
    drawDrummerUpperBody(actor){
      if(!actor)return;
      const g=this.g,c=g.renderer.ctx;
      if(typeof c.clip!=='function')return;
      // 鼓手腿部仍在鼓组后方，上半身和手臂在鼓沿上方完整显示。
      const x=Math.round((actor.x+(actor.spriteOffsetX||0))*T+8-20-g.camera.x);
      const y=Math.round((actor.y+(actor.spriteOffsetY||0))*T+14-40-g.camera.y);
      c.save();c.beginPath();c.rect(x,y,40,30);c.clip();
      this.drawSprite(actor,false);c.restore();
    }
    drawActors(){
      const g=this.g,area=g._currentArea().id;
      const actors=g.level.entities.filter(e=>['npc','guest'].includes(e.type)&&(!e.room||e.room===area));
      const player={type:'player',sprite:2,age:'adult',x:g.player.x/T,y:g.player.y/T,_walking:this.playerMotion.walking};
      const items=actors.concat(player).map(e=>({foot:e.y+14/T+(e.spriteOffsetY||0),actor:e}));
      if(this.inHall()){
        for(const d of g.level.decorations){
          if(d.room==='hall'&&(d.collision||d.collisionRects||d.occlusionShape||d.occlusionShapes)){
            const bottom=d.collision?d.collision.y+d.collision.h:d.collisionRects?d.y+Math.max(...d.collisionRects.map(r=>r.y+r.h)):d.y+d.h;
            items.push({foot:d.depth===undefined?bottom:d.depth,object:d});
          }
        }
      }
      const record=this.inHall()&&g._entitiesOf('record')[0];
      if(record&&!record.taken){const cabinet=g.level.decorations.find(d=>d.room==='hall'&&d.kind==='recordCabinet');
        items.push({foot:cabinet.depth,record:true});}
      items.sort((a,b)=>a.foot-b.foot);
      const img=g._sceneryImages.get(g.level.sceneryAssets.birthdayHall);
      for(const item of items){
        if(item.record){const r=g.level.party.recordVisual;g._drawRecord(r.x,r.y,r.size);continue;}
        if(item.actor){this.drawSprite(item.actor,item.actor===player);continue;}
        if(!img||!img.complete||!img.naturalWidth)continue;
        const d=item.object;
        // 原图同位置取样，沿物体轮廓重画；悬空装饰也按地面锚点遮挡人物。
        ctxDraw(g,img,d);
        if(d.kind==='drums'){
          this.drawDrummerUpperBody(actors.find(e=>e.performance==='drums'));
          // 前排通鼓和鼓沿在人物前方，不能被上半身补画抹去。
          ctxDraw(g,img,{...d,occlusionShapes:d.foregroundShapes});
        }
      }
    }
    // Explicit console switch: game.birthday.debugCollision = true (or 'occlusion').
    drawCollision(){
      if(!this.debugCollision)return;
      const g=this.g,c=g.renderer.ctx,area=g._currentArea();
      c.save();c.lineWidth=.5;
      const draw=(r,color)=>{c.fillStyle=color;c.fillRect(r.x-g.camera.x,r.y-g.camera.y,r.w,r.h);};
      for(const r of g.mechanics.staticCollision.rects)draw(r,'rgba(255,65,85,.35)');
      const a=area.rect;
      for(let y=a.y;y<a.y+a.h;y++)for(let x=a.x;x<a.x+a.w;x++)
        if(g.mechanics.isSolidTile(x,y))draw({x:x*T,y:y*T,w:T,h:T},'rgba(255,65,85,.20)');
      for(const e of g.level.entities){
        if((e.room||'hall')!==area.id)continue;
        if(e.type==='npc'||e.type==='guest')draw(this.footprint(e.x*T,e.y*T,e),'rgba(255,205,50,.65)');
        if((e.type==='gate'||e.type==='door')&&!e.open||e.type==='box'&&!e.carried)
          draw({x:e.x*T,y:e.y*T,w:T,h:T},'rgba(255,125,40,.5)');
      }
      draw(this.footprint(g.player.x,g.player.y),'rgba(30,255,150,.8)');
      for(const d of g.level.decorations){
        if(d.room!==area.id)continue;
        draw({x:d.x*T-1,y:d.y*T-1,w:2,h:2},'#49dcff');
        if(this.debugCollision!=='occlusion')continue;
        c.strokeStyle='#76ddff';
        for(const shape of d.occlusionShapes||(d.occlusionShape?[d.occlusionShape]:[])){
          c.beginPath();shape.forEach((p,i)=>{const x=(d.x+p[0]*d.w)*T-g.camera.x,y=(d.y+p[1]*d.h)*T-g.camera.y;
            if(i)c.lineTo(x,y);else c.moveTo(x,y);});c.closePath();c.stroke();
        }
      }
      c.restore();
    }
  }
  function ctxDraw(g,img,d){
    const ctx=g.renderer.ctx,shapes=d.occlusionShapes||(d.occlusionShape?[d.occlusionShape]:null);
    if(shapes && typeof ctx.clip==='function'){
      ctx.save();ctx.beginPath();
      for(const shape of shapes){
        shape.forEach((p,i)=>{const x=(d.x+p[0]*d.w)*T-g.camera.x,y=(d.y+p[1]*d.h)*T-g.camera.y;
          if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.closePath();
      }
      ctx.clip();
    }
    g.renderer.ctx.drawImage(img,d.x/40*img.naturalWidth,d.y/28*img.naturalHeight,d.w/40*img.naturalWidth,d.h/28*img.naturalHeight,
      Math.round(d.x*T-g.camera.x),Math.round(d.y*T-g.camera.y),d.w*T,d.h*T);
    if(shapes && typeof ctx.clip==='function')ctx.restore();
  }
  root.MIXX=root.MIXX||{};root.MIXX.Birthday=Birthday;
})(typeof window!=='undefined'?window:globalThis);
