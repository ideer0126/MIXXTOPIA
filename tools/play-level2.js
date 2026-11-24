/** 第二关确定性通关：复用移动/对话工具，通过实际拾油与互动推进机关。 */
'use strict';
(function (root) {
  const walk = typeof module !== 'undefined' && module.exports ? require('./play-level1.js') : root.level1Playthrough;
  /** 按稳定实体 id 寻路，地图改版时仍沿真实地面与门状态行走。 */
  function walkToEntity(game, id) {
    const entity = game.level.entities.find(e => e.id === id);
    if (!entity) throw Error('第二关缺少实体：' + id);
    walk.walkTo(game, entity.x, entity.y);
  }
  /** 站定迎击当前能看见且进入警戒范围的敌人；复用真实战斗更新和攻击冷却。 */
  function fightNearby(game) {
    if (!game.combat) return;
    for (let frame = 0; frame < 1200; frame++) {
      const c = game.combat, p = game.player;
      const enemy = c.enemies.filter(e => !e.dead && Math.hypot(e.x + e.size / 2 - p.x - 8, e.y + e.size / 2 - p.y - 8) <= e.aggro
        && c.hasLineOfSight(game.mechanics, p.x + 8, p.y + 8, e.x + e.size / 2, e.y + e.size / 2))
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (!enemy) return;
      const warning = c.enemies.find(e => !e.dead && e.tell && e.tell.left < 0.35
        && Math.hypot(p.x + 8 - e.tell.x, p.y + 8 - e.tell.y) <= e.tell.radius + 8);
      if (warning && c.dashCooldown <= 0) {
        const dx = enemy.x - p.x, dy = enemy.y - p.y;
        c.face(-dy || 1, dx); c.dash(p, game.mechanics);
      }
      c.face(enemy.x + enemy.size / 2 - p.x - 8, enemy.y + enemy.size / 2 - p.y - 8);
      if (c.findTarget(p, c.energy >= c.maxEnergy ? c.cannonRange : c.attackRange, game.mechanics)) game._playerAttack('heavy');
      else {
        const dx = enemy.x - p.x, dy = enemy.y - p.y, distance = Math.hypot(dx, dy) || 1;
        game._moveAxis(dx / distance * 80 / 60, 0); game._moveAxis(0, dy / distance * 80 / 60);
      }
      game._update(1 / 60); game.input.endFrame(); walk.finishDialogue(game);
      if (game.state !== 'playing') return;
    }
    throw new Error('战斗未能结束');
  }
  function playLevel2(game, options = {}) {
    if (game.level.id !== 2) throw new Error('必须先进入第二关');
    const source = JSON.stringify(game.levels[game.levelIndex]);
    walk.finishDialogue(game);
    walk.talkTo(game, 'jiwoo');
    if (!game._playedNodes.has('l2.sheep')) walk.talkTo(game, 'sheep2');
    for (let n = 1; n <= 3; n++) {
      const oil = game._entitiesOf('oil').find(e => e.id === 'oil' + n);
      walk.walkTo(game, oil.x, oil.y);
      if (!game.carriedOil || game.carriedOil.id !== oil.id) throw new Error('未携带灯油 ' + n);
      if (options.onOil) options.onOil(game, n);
      fightNearby(game);
      const lamp = game._entitiesOf('lamp').find(e => e.id === 'lamp' + n);
      solveLantern(game, lamp.id);
      walk.walkTo(game, lamp.x, lamp.y);
      fightNearby(game);
      if (!game._interact() || !lamp.lit || game.carriedOil) throw new Error('点灯失败 ' + n);
      if (!game._entitiesOf('gate').find(e => e.id === lamp.target).open) throw new Error('灯柱没有打开门 ' + n);
      if (options.onLamp) options.onLamp(game, n);
      const star = game._entitiesOf('star').find(e => e.id === 's2_' + n);
      walk.walkTo(game, star.x, star.y);
      fightNearby(game);
    }
    walk.talkTo(game, 'corner-help');
    solveRuins(game);
    const corner = game._entitiesOf('star').find(e => e.id === 's2_4');
    walk.walkTo(game, corner.x, corner.y);
    fightNearby(game);
    if (game.stars !== 4 || !game._portalActive()) throw new Error('四星没有激活星光门');
    walk.talkTo(game, 'byeori');
    if (options.beforePortal) options.beforePortal(game);
    const portal = game._entitiesOf('portal')[0];
    walk.walkTo(game, portal.x, portal.y);
    if (game.state !== 'clear' || game._pendingNextIsEnding || !game._pendingNextUnavailable) throw new Error('第二关结算应等待未制作的第三关');
    if (JSON.stringify(game.levels[game.levelIndex]) !== source) throw new Error('流程改写了共享第二关数据');
    return { stars: game.stars, lamps: game._entitiesOf('lamp').filter(e => e.lit).length, state: game.state };
  }
  /** 走到灯柱进入独立棋盘，通过同一旋镜入口解题；退出后交还点灯操作。 */
  function solveLantern(game, lampId) {
    const lamp = game._entitiesOf('lamp').find(l => l.id === lampId);
    if (!lamp.puzzle || lamp.lit || lamp.puzzleSolved) return;
    if (game.state !== 'puzzle') {
      walk.walkTo(game, lamp.x, lamp.y); fightNearby(game); game._interact();
    }
    if (game.state !== 'puzzle') throw Error('没有进入光路机关：' + lampId);
    const board = game.lantern;
    const flipped = board.angles.map((a, i) => a !== board.config.mirrors[i].angle ? i : -1).filter(i => i >= 0);
    const solution = board.constructor.solution(lamp.puzzle, flipped);
    if (!solution) throw Error('光路机关无解：' + lampId);
    for (const i of solution) game._rotateLantern(i);
    if (!board.result.solved) throw Error('光路未接通：' + lampId);
    game._setState('playing');
  }
  /** 水机关的真实空间操作：复位排水、从左侧逐格推筏、到绳柱系绳、再放水。 */
  function solveRuins(game) {
    if (!game.ruins || game.ruins.solved) return;
    fightNearby(game);
    walkToEntity(game, 'ruins-reset'); game._interact();
    const cfg = game.level.ruins, raft = game._entitiesOf('box').find(e => e.id === cfg.raft);
    while (raft.x < cfg.dockX) {
      walk.walkTo(game, raft.x - 1, raft.y);
      const x = raft.x; game._moveAxis(1, 0);
      if (raft.x !== x + 1) throw Error('浮台没有沿滑轨前进');
    }
    walkToEntity(game, 'ruins-rope'); game._interact();
    if (!game.ruins.tied) throw Error('浮台未系绳');
    walkToEntity(game, 'ruins-valve'); game._interact();
    for (let frame = 0; frame < 150 && !game.ruins.solved; frame++) { game._update(1 / 60); game.input.endFrame(); walk.finishDialogue(game); }
    if (!game.ruins.solved) throw Error('水位没有通过浮台拉开石罩');
  }
  const api = { playLevel2, fightNearby, solveLantern, walkToEntity, solveRuins };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.level2Playthrough = api;
})(typeof window !== 'undefined' ? window : globalThis);
