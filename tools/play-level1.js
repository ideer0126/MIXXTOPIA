/** 第一关确定性通关冒烟：Node/浏览器共用，不传送、不修改机关或收集状态。 */
'use strict';
(function (root) {
  function check(ok, message) { if (!ok) throw new Error(message); }

  function finishDialogue(game) {
    let guard = 0;
    while (game.state === 'dialogue' && guard++ < 200) game._tapDialog();
    check(game.state !== 'dialogue', '对话无法结束');
  }

  function pathTo(game, tx, ty) {
    const x = Math.round(game.player.x / 16), y = Math.round(game.player.y / 16);
    const start = x + ',' + y;
    const queue = [[x, y]], prev = new Map([[start, null]]);
    for (let i = 0; i < queue.length; i++) {
      const [cx, cy] = queue[i];
      if (cx === tx && cy === ty) {
        const path = [];
        let key = tx + ',' + ty;
        while (prev.get(key) !== null) { path.push(key.split(',').map(Number)); key = prev.get(key); }
        return path.reverse();
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, key = nx + ',' + ny;
        if (prev.has(key) || game.mechanics.blockedAt(nx * 16, ny * 16, 16)) continue;
        prev.set(key, cx + ',' + cy); queue.push([nx, ny]);
      }
    }
    return null;
  }

  function stepTo(game, tx, ty) {
    let guard = 0;
    while ((game.player.x !== tx * 16 || game.player.y !== ty * 16) && guard++ < 12) {
      const dx = Math.sign(tx * 16 - game.player.x), dy = Math.sign(ty * 16 - game.player.y);
      check(!dx || !dy, '路线必须逐格正交移动');
      game._moveAxis(dx * 4, dy * 4); // 与 80px/s、50ms 一帧的生产移动步长相同
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
    walkTo(game, npc.x, npc.y);
    check(game._interact(), '无法互动：' + id);
    finishDialogue(game);
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
    talkTo(game, 'party-plan');
    talkTo(game, 'lily'); talkTo(game, 'lily');
    walkTo(game, 10, 24);
    check(game.collected.includes('s1'), '气球星未收集');
    check(pathTo(game, 4, 4) === null, '关门时不能进入杂物间');
    walkTo(game, 5, 8); check(game._interact(), '不能按 E 开门');
    check(game._entitiesOf('door')[0].open, '杂物间门未打开');
    walkTo(game, 4, 4);
    check(game.collected.includes('s2'), '杂物间星未收集');
    talkTo(game, record.id);
    check(!record.taken, '对话未完成不能提前取走唱片');
    walkTo(game, music.x, music.y); check(game._interact(), '唱片机应有前置提示'); finishDialogue(game);
    check(!gate.open && !game._playedNodes.has(music.dialogue), '尚未准备好不能播放或开后台');
    for (const id of ['haewon', 'sullyoon', 'bae', 'jiwoo', 'kyujin']) talkTo(game, id);
    game._syncProgressLocks(); game._checkTriggers(); finishDialogue(game);
    talkTo(game, 'sheep1');
    walkTo(game, 25, 9);
    check(game._playedNodes.has('l1.music.ready'), '六人 + 两星后靠近唱片机缺少寻找唱片提示');
    check(!gate.open && pathTo(game, 28, 5) === null, '没播放唱片不能进入后台');
    talkTo(game, record.id);
    check(record.taken && game._playedNodes.has(record.dialogue), '唱片没有取走');
    if (options.onRecord) options.onRecord(game);
    talkTo(game, music.id);
    check(gate.open && game._playedNodes.has(music.dialogue), '播放唱片没有开启后台入口');
    walkTo(game, 19, 9);
    check(game._currentArea().id === 'hall', '尚未进入幕后');
    walkTo(game, 28, 5);
    check(game._currentArea().id === 'backstage', '上台右转未进入化妆间');
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

  const api = { playLevel1, finishDialogue, walkTo, talkTo, pathTo, stepTo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.level1Playthrough = api;
})(typeof window !== 'undefined' ? window : globalThis);
