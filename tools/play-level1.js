/** 第一关确定性通关冒烟：Node/浏览器共用，不传送、不修改机关或收集状态。 */
'use strict';
(function (root) {
  const C=typeof module!=='undefined'&&module.exports?require('../js/collision.js'):root.MIXX.collision;
  function check(ok, message) { if (!ok) throw new Error(message); }

  function finishDialogue(game) {
    let guard = 0;
    while (game.state === 'dialogue' && guard++ < 200) game._tapDialog();
    check(game.state !== 'dialogue', '对话无法结束');
  }

  function pathTo(game, tx, ty, spacing = 16) {
    const blocked=(x,y)=>game.birthday?game.birthday.blockedAt(x,y):game.mechanics.blockedAt(x,y,16);
    const gx=tx*16,gy=ty*16,x=game.player.x,y=game.player.y;
    if(blocked(gx,gy))return null;
    if(spacing===16&&((gx-x)%16||(gy-y)%16))spacing=2;
    const start=x+','+y,queue=[[x,y]],prev=new Map([[start,null]]);
    for(let i=0;i<queue.length;i++){
      const [cx,cy]=queue[i];
      if(cx===gx&&cy===gy){
        const path=[];let key=gx+','+gy;
        while(prev.get(key)!==null){path.push(key.split(',').map(v=>Number(v)/16));key=prev.get(key);}
        return path.reverse();
      }
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const stepX=(gx-cx)*dx>0?Math.min(spacing,Math.abs(gx-cx)):spacing;
        const stepY=(gy-cy)*dy>0?Math.min(spacing,Math.abs(gy-cy)):spacing;
        const nx=cx+dx*stepX,ny=cy+dy*stepY;
        const key=nx+','+ny;
        if(prev.has(key)||C.trace(cx,cy,nx-cx,ny-cy,blocked).blocked)continue;
        prev.set(key,cx+','+cy);queue.push([nx,ny]);
      }
    }
    return spacing===16&&game.birthday?pathTo(game,tx,ty,2):null;
  }

  function stepTo(game, tx, ty) {
    let guard = 0;
    while ((game.player.x !== tx * 16 || game.player.y !== ty * 16) && guard++ < 12) {
      const dx = Math.sign(tx * 16 - game.player.x), dy = Math.sign(ty * 16 - game.player.y);
      check(!dx || !dy, '路线必须逐格正交移动');
      game._moveAxis(dx * Math.min(4,Math.abs(tx*16-game.player.x)), dy * Math.min(4,Math.abs(ty*16-game.player.y)));
      game._syncSwitches();
      game._checkPickups();
      finishDialogue(game);
      game._syncProgressLocks();
      game._checkTriggers();
      finishDialogue(game);
    }
    check(game.player.x === tx * 16 && game.player.y === ty * 16, '移动被阻挡：' + tx + ',' + ty);
    game._checkRoomDoors();
    game._checkPortal();
    finishDialogue(game);
  }

  function walkTo(game, x, y) {
    const path = pathTo(game, x, y);
    check(path !== null, '目标不可达：' + x + ',' + y);
    for (const [tx, ty] of path) stepTo(game, tx, ty);
  }

  function talkTo(game, id) {
    const area = game._currentArea();
    const npc = game.level.entities.find(e => e.id === id && (!e.room || e.room === (area ? area.id : 'hall')));
    check(npc, '当前房间没有目标：' + id);
    const targets=[[npc.x,npc.y],[npc.x,npc.y+1],[npc.x,npc.y-1],[npc.x+1,npc.y],[npc.x-1,npc.y]];
    const target=targets.find(([x,y])=>pathTo(game,x,y)!==null);
    check(target,'没有可接近的互动位置：'+id);
    walkTo(game, target[0], target[1]);
    check(game._interact(), '无法互动：' + id);
    finishDialogue(game);
  }

  function winRings(game) {
    const station=game.level.entities.find(e=>e.type==='minigame');
    walkTo(game,station.x,station.y);check(game._interact(),'不能开始套圈');finishDialogue(game);
    if(!game.birthday||!game.birthday.rings)throw new Error('套圈界面没有打开');
    let guard=0;
    while(game.birthday.rings&&guard++<400){
      const r=game.birthday.rings, center=[.2,.5,.8][r.hits];
      if(Math.abs(game.birthday.marker()-center)<.08){
        const original=game.input.wasPressed;
        try{game.input.wasPressed=action=>action==='confirm';game._update(0);}
        finally{game.input.wasPressed=original;}
      }else game._update(.05);
    }
    check(!game.birthday.rings,'套圈无法完成');finishDialogue(game);
    check(game._playedNodes.has(station.dialogue),'套圈成功没有发放奖励资格');
  }

  function playLevel1(game, options) {
    options = options || {};
    finishDialogue(game);
    check(game.level.id === 1, '序章没有进入第一关');
    const source = JSON.stringify(game.levels[0]);
    const star3 = game.level.entities.find(e => e.id === 's3');
    const record = game.level.entities.find(e => e.type === 'record');
    const music = game.level.entities.find(e => e.type === 'gramophone');
    const gate = game.level.entities.find(e => e.type === 'gate');
    check(!game._starAvailable(star3) && !record.taken && !gate.open, '开局后台入口须关闭，唱片未取走、第三星隐藏');
    talkTo(game, 'lily'); talkTo(game, 'lily');
    talkTo(game, 'bae');
    winRings(game);
    walkTo(game, 7, 21);
    check(game.collected.includes('s1'), '套圈奖励星未收集');
    check(!game._entitiesOf('door').length, '杂物间不应出现门');
    check(pathTo(game, 4, 6) !== null, '杂物间应可从开口直接进入');
    walkTo(game, 4, 6);
    check(game.collected.includes('s2'), '杂物间星未收集');
    talkTo(game, record.id);
    check(!record.taken, '对话未完成不能提前取走唱片');
    walkTo(game, music.x+1, music.y); check(game._interact(), '唱片机应有前置提示'); finishDialogue(game);
    check(!gate.open && !game._playedNodes.has(music.dialogue), '尚未准备好不能播放或开后台');
    for (const id of ['haewon', 'sullyoon', 'jiwoo', 'kyujin']) talkTo(game, id);
    game._syncProgressLocks(); game._checkTriggers(); finishDialogue(game);
    talkTo(game, 'sheep1');
    walkTo(game, 29, 7);
    check(game._playedNodes.has('l1.music.ready'), '六人 + 两星后靠近唱片机缺少寻找唱片提示');
    check(!gate.open && pathTo(game, 34, 5) === null, '没播放唱片不能进入后台');
    talkTo(game, record.id);
    check(record.taken && game._playedNodes.has(record.dialogue), '唱片没有取走');
    if (options.onRecord) options.onRecord(game);
    talkTo(game, music.id);
    check(gate.open && game._playedNodes.has(music.dialogue), '播放唱片没有开启后台入口');
    if (options.onMusic) options.onMusic(game);
    walkTo(game, 19, 8);
    check(game._currentArea().id === 'hall', '尚未进入幕后');
    walkTo(game, 33, 5); stepTo(game, 34, 5);
    check(game._currentArea().id === 'backstage', '上台右转未进入化妆间');
    check(game._entryFade === game.level.entryFade, '进入后台应使用与关卡入场一致的渐亮');
    check(game.stars === 2 && !game._starAvailable(star3), '后台对话未完成不能提前出星');
    check(game._entitiesOf('npc').filter(e => e.room === 'backstage').length === 7, '化妆间须有六位 Muse 与精灵');
    if (options.onBackstage) options.onBackstage(game);
    talkTo(game, 'lily'); talkTo(game, 'sullyoon');
    check(!game._starAvailable(star3), '漏掉精灵时不能出星');
    talkTo(game, 'byeori');
    check(game._starAvailable(star3), '三位后台对话没有解锁最后一星');
    walkTo(game, star3.x, star3.y);
    check(game.stars === 3 && game._portalActive(), '第三颗星没有激活左侧星光门');
    if (options.beforePortal) options.beforePortal(game);
    const portal = game._entitiesOf('portal')[0];
    walkTo(game, portal.x, portal.y);
    check(game.state === 'clear', '左侧星光门未触发结算');
    check(!game._pendingNextIsEnding && game._pendingNextUnavailable, '第二关未制作不能误播终章');
    check(JSON.stringify(game.levels[0]) === source, '流程改写了共享关卡数据');
    return { stars: game.stars, sheep: game.sheepCount, gateOpen: gate.open, state: game.state };
  }

  const api = { playLevel1, finishDialogue, walkTo, talkTo, pathTo, stepTo, winRings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.level1Playthrough = api;
})(typeof window !== 'undefined' ? window : globalThis);
