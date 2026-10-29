/** Birthday Wish 场景：可走动的人物、前后遮挡与套圈小游戏。 */
'use strict';
(function(root){
  const T=16;
  class Birthday {
    constructor(game){
      this.g=game;this.time=0;this.rings=null;
      this.playerMotion={walking:false,time:0};this.frameCache=new Map();
    }
    inHall(){ return this.g._currentArea().id==='hall'; }
    direction(dx,dy){if(!dx&&!dy)return 0;return Math.abs(dx)>Math.abs(dy)?(dx>0?1:3):(dy>0?0:2);}
    footprint(x,y,actor){
      const f=actor&&actor.age==='child'?{x:5,y:10,w:6,h:4}:this.g.level.party.footprint;
      return{x:x+f.x,y:y+f.y+(actor&&actor.spriteOffsetY||0)*T,w:f.w,h:f.h};
    }
    blockedAt(x,y,actor){
      const g=this.g,f=this.footprint(x,y,actor);
      if(g.mechanics.blockedAt(f.x,f.y,f.w,{height:f.h}))return true;
      const room=actor?(actor.room||'hall'):g._currentArea().id;
      const occupied=g.level.entities.filter(e=>e!==actor&&(e.type==='npc'||e.type==='guest')&&(e.room||'hall')===room)
        .map(e=>this.footprint(e.x*T,e.y*T,e));
      // 巡游者忽略自身，也把玩家视为占位；互动视线仍只检查地形。
      if(actor&&g._currentArea().id===room)occupied.push(this.footprint(g.player.x,g.player.y));
      return occupied.some(r=>f.x<r.x+r.w&&f.x+f.w>r.x&&f.y<r.y+r.h&&f.y+f.h>r.y);
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
        if(!this.blockedAt(nx*T,ny*T,e)){
          e.x=nx;e.y=ny;e._walking=true;e._walkDistance=(e._walkDistance||0)+step*T;
        }else{e._waypoint=((e._waypoint||0)+1)%e.path.length;e._rest=.28;}
      }
    }
    interact(e){
      const g=this.g;
      if(e.type==='npc'||e.type==='guest')e._dir=this.direction(g.player.x-e.x*T,g.player.y-e.y*T);
      if(e.type==='guest'){
        g._playNode('guest:'+e.id,{node:{lines:e.lines.map(t=>({s:'nar',t}))}});return true;
      }
      if(e.type!=='minigame')return false;
      if(g._playedNodes.has(e.dialogue)){
        g._playNode('ring.done',{node:{lines:[{s:'bae',t:'三个靶已经全部套中了。愿望之星就在摊位前，接下来去杂物间看看吧。'}]}});
      }else{
        g._playNode('ring.rules',{node:{lines:[{s:'bae',t:'欢迎来套圈！依次瞄准鲸鱼、月亮、星星，光标进入金色区域时按 E / 空格 / 手机 A 投圈。没有套中也没关系，可以一直重试。按 Esc 或暂停键可以休息。'}]},onEnd:()=>{this.rings={hits:0,time:0,message:'先套小鲸鱼',feedback:0};}});
      }
      return true;
    }
    marker(){return 0.5-0.5*Math.cos(this.rings.time*2.3);}
    updateRings(dt){
      const r=this.rings,g=this.g;if(!r)return;
      this.playerMotion.walking=false;this.playerMotion.time=0;
      r.time+=dt;r.feedback=Math.max(0,r.feedback-dt);
      if(!g.input.wasPressed('confirm'))return;
      const center=[0.2,0.5,0.8][r.hits];
      if(Math.abs(this.marker()-center)<=0.12){
        r.hits++;r.message='套中了！';r.feedback=0.65;g._sfx('switch');
        if(r.hits===3){
          this.rings=null;
          g._playNode('l1.rings.complete',{onEnd:()=>{g._refreshHud();g._emit('minigame',{id:'ring-toss',complete:true});}});
        }
      }else{r.message='差一点，再试一次';r.feedback=0.65;}
    }
    drawRings(){
      if(!this.rings||this.g.state!=='playing')return;
      const r=this.rings,ctx=this.g.renderer.ctx;
      ctx.fillStyle='rgba(20,25,45,.96)';ctx.fillRect(12,45,296,140);
      ctx.fillStyle='#d7b575';ctx.fillRect(12,45,296,2);
      ctx.fillStyle='#fff0d0';ctx.font='12px sans-serif';ctx.fillText('套圈集星',32,68);
      ctx.font='9px sans-serif';ctx.fillText('光标进入金色区域时按 E / 空格 / A',32,87);
      const names=['鲸鱼','月亮','星星'];
      for(let i=0;i<3;i++){
        ctx.fillStyle=i<r.hits?'#b8dcc5':i===r.hits?'#ffe1a1':'#8c91a7';
        ctx.fillText((i<r.hits?'✓ ':'')+names[i],46+i*88,108);
      }
      ctx.fillStyle='#596078';ctx.fillRect(32,122,256,12);
      const center=[.2,.5,.8][r.hits];ctx.fillStyle='#e9c57c';ctx.fillRect(32+(center-.12)*256,122,.24*256,12);
      ctx.fillStyle='#f8f1e3';ctx.fillRect(31+this.marker()*256,119,3,18);
      ctx.fillStyle='#d8dfeb';ctx.fillText(r.feedback>0?r.message:'跟着光标的节奏投圈 · 已中 '+r.hits+'/3',32,155);
      ctx.fillText('Esc / 暂停：休息',32,172);
    }
    drawBackground(){
      if(!this.inHall())return false;
      const g=this.g;
      if(g._drawSceneryAsset(g.level.party.background))return true;
      // 图片加载中保留可读的瓦片画面，场景碰撞不依赖图片状态。
      return false;
    }
    drawCurtains(){
      if(!this.inHall())return;
      const g=this.g,img=g._sceneryImages.get(g.level.sceneryAssets.birthdayHall);
      if(!img||!img.complete||!img.naturalWidth)return;
      for(const d of [{x:30.2,y:0,w:2.1,h:6},{x:34.4,y:0,w:.8,h:5.6}])ctxDraw(g,img,d);
    }
    pose(e,player){
      const party=this.g.level.party;
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
      if(style.alternateFeet)this.alternateFeet(rows);
      this.frameCache.set(pose.key,rows);return rows;
    }
    alternateFeet(rows){
      // 保留原始 PNG；在原生像素渲染缓存中固定脚底并交替接触腿，避免重复迈同一只脚。
      for(const dir of [0,2]){
        const neutral=rows[dir][0],c0=neutral.getContext('2d');
        if(typeof c0.getImageData!=='function')continue;
        const data=c0.getImageData(0,39,neutral.width,1).data,occupied=[];
        for(let x=0;x<neutral.width;x++)if(data[x*4+3]>128)occupied.push(x);
        if(!occupied.length)continue;
        const lo=occupied[0],hi=occupied[occupied.length-1]+1,mid=Math.floor((lo+hi)/2);
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
      const px=player?g.player.x:e.x*T,py=(player?g.player.y:e.y*T)+(e.spriteOffsetY||0)*T;
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
    drawPerformers(actor){
      if(!this.inHall())return;
      const g=this.g,c=g.renderer.ctx;
      for(const e of g._entitiesOf('npc')){
        if(e!==actor||!e.performance||e.room!=='hall'||e._dir)continue;
        const x=Math.round(e.x*T+8-g.camera.x),y=Math.round(e.y*T+14+(e.spriteOffsetY||0)*T-g.camera.y);
        if(e.performance==='drums'){
          const beat=Math.floor(this.time*5)%2;
          c.fillStyle='#d7bb83';
          for(let i=0;i<7;i++){c.fillRect(x-10+i,y-18+(beat?Math.floor(i/2):-Math.floor(i/2)),1,1);c.fillRect(x+4+i,y-18+(beat?-Math.floor(i/2):Math.floor(i/2)),1,1);}
        }else{
          // 静态抱琴：琴颈、双弧琴身与白色护板，不再移动拨弦像素。
          for(let i=0;i<12;i++){
            c.fillStyle='#493441';c.fillRect(x-1+i,y-20-i,3,3);
            c.fillStyle='#cfb584';c.fillRect(x+i,y-19-i,1,1);
          }
          const body=['....dddddd...','...drrrrrrd..','...drrwwsrd..','....drwsrd...','...drrwsrrd..','..drrrwsrrrd.','..drrrwsrrrd.','..drrrwwrrrd.','...drrrrrrd..','....dddddd...'];
          const colors={d:'#493441',r:'#b73f4f',w:'#eee5d0',s:'#57434a'};
          body.forEach((row,iy)=>{for(let ix=0;ix<row.length;ix++)if(colors[row[ix]]){
            c.fillStyle=colors[row[ix]];c.fillRect(x-8+ix,y-19+iy,1,1);
          }});
          c.fillStyle='#eed6bd';c.fillRect(x-5,y-12,3,2);
        }
      }
    }
    drawDrummerUpperBody(actor){
      if(!actor)return;
      const g=this.g,c=g.renderer.ctx;
      if(typeof c.clip!=='function')return;
      // 鼓手腿部仍在鼓组后方，上半身和手臂在鼓沿上方完整显示。
      const x=Math.round(actor.x*T+8-20-g.camera.x);
      const y=Math.round((actor.y+(actor.spriteOffsetY||0))*T+14-40-g.camera.y);
      c.save();c.beginPath();c.rect(x,y,40,30);c.clip();
      this.drawSprite(actor,false);c.restore();this.drawPerformers(actor);
    }
    drawActors(){
      const g=this.g,area=g._currentArea().id;
      const actors=g.level.entities.filter(e=>['npc','guest'].includes(e.type)&&(!e.room||e.room===area));
      const player={type:'player',sprite:2,age:'adult',x:g.player.x/T,y:g.player.y/T,_walking:this.playerMotion.walking};
      const items=actors.concat(player).map(e=>({foot:e.y+14/T+(e.spriteOffsetY||0),actor:e}));
      if(this.inHall()){
        for(const d of g.level.decorations){
          if(d.room==='hall'&&d.collision)items.push({foot:d.depth===undefined?d.collision.y+d.collision.h:d.depth,object:d});
        }
      }
      const record=this.inHall()&&g._entitiesOf('record')[0];
      if(record&&!record.taken){const cabinet=g.level.decorations.find(d=>d.room==='hall'&&d.kind==='recordCabinet');
        items.push({foot:cabinet.depth,record:true});}
      items.sort((a,b)=>a.foot-b.foot);
      const img=g._sceneryImages.get(g.level.sceneryAssets.birthdayHall);
      for(const item of items){
        if(item.record){const r=g.level.party.recordVisual;g._drawRecord(r.x,r.y,r.size);continue;}
        if(item.actor){this.drawSprite(item.actor,item.actor===player);if(item.actor.performance!=='drums')this.drawPerformers(item.actor);continue;}
        if(!img||!img.complete||!img.naturalWidth)continue;
        const d=item.object;
        // 原图同位置取样，只重画家具占地，按脚下深度遮挡人物。
        ctxDraw(g,img,d);
        if(d.kind==='drums')this.drawDrummerUpperBody(actors.find(e=>e.performance==='drums'));
      }
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
