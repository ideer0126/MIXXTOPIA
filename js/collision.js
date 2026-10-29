/** Shared static footprints and <=1px movement sampling (browser + Node). */
'use strict';
(function(root){
  const TILE=16;

  // This is the boundary for authored geometry. Consumers use pixel rectangles.
  function compile(level){
    const rects=[],errors=[];
    if(!level.party||!level.party.preciseCollision)return{rects,errors};
    const f=level.party.footprint;
    if(!f||![f.x,f.y,f.w,f.h].every(Number.isFinite)||f.x<0||f.y<0||f.w<=0||f.h<=0||f.x+f.w>TILE||f.y+f.h>TILE)
      errors.push('脚底范围必须是人物瓦片内的有效矩形');
    let walls=level.party.colliders||[];
    if(!Array.isArray(walls)){errors.push('墙脚 colliders 必须是数组');walls=[];}
    const entries=walls.map((r,i)=>({r,x:0,y:0,source:null,label:'墙脚 '+i}));
    for(const d of level.decorations||[]){
      if(d.room!=='hall')continue; // Backstage keeps its authored blocking tiles.
      if(d.collisionRects!==undefined){
        if(d.collision||!Array.isArray(d.collisionRects)||!d.collisionRects.length){
          errors.push('家具 '+d.kind+' collisionRects 必须是非空数组且不能与 collision 并用');continue;
        }
        d.collisionRects.forEach((r,i)=>entries.push({r,x:d.x,y:d.y,source:d,label:d.kind+' 块 '+i}));
      }else if(d.collision)entries.push({r:d.collision,x:0,y:0,source:d,label:d.kind});
    }
    for(const {r,x,y,source,label} of entries){
      if(!r||![x,y,r.x,r.y,r.w,r.h].every(Number.isFinite)||r.w<=0||r.h<=0||x+r.x<0||y+r.y<0
        ||x+r.x+r.w>level.map.w||y+r.y+r.h>level.map.h){
        errors.push(label+' 碰撞必须是地图内的有限数值矩形');continue;
      }
      rects.push({x:(x+r.x)*TILE,y:(y+r.y)*TILE,w:r.w*TILE,h:r.h*TILE,source});
    }
    return{rects,errors};
  }

  function overlaps(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
  function blockedAt(rects,x,y,w,h){const body={x,y,w,h};return rects.some(r=>overlaps(body,r));}

  // Both navigation edges and live movement must check their entire segment.
  // Return the last free point, allowing the other axis to slide along an edge.
  function trace(x,y,dx,dy,blocked){
    const steps=Math.ceil(Math.max(Math.abs(dx),Math.abs(dy)));
    let nx=x,ny=y;
    for(let i=1;i<=steps;i++){
      const px=x+dx*i/steps,py=y+dy*i/steps;
      if(blocked(px,py))return{x:nx,y:ny,blocked:true};
      nx=px;ny=py;
    }
    return{x:nx,y:ny,blocked:false};
  }

  const api={compile,overlaps,blockedAt,trace};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.MIXX=root.MIXX||{};root.MIXX.collision=api;
})(typeof window!=='undefined'?window:globalThis);
