/**
 * js/sprites.js —— 像素素材：瓦片 / 角色 / 道具（调色板换色）
 * 关 1 底材随 Issue #11 接入；Issue #13 继续制作正式人物与动画素材。
 *
 * 实现方式（与 js/engine.js 约定）：
 *   - 素材以 16×16 模板槽色像素网格定义：'.' 透明，'0'–'3' 对应槽位
 *     （0 品红 #ff00ff 暗面 · 1 青 #00ffff 主色 · 2 黄 #ffff00 强调一 · 3 橙 #ff8000 强调二）；
 *   - index.html 在 engine.js 之后加载本文件，确保 MIXX.engine 已就绪；
 *     瓦片集通过 MIXX.engine.registerTileset(id, { type: grid, ... }) 注册，
 *     运行时由引擎按关卡调色板自动换色并缓存图集；
 *   - 角色精灵后续由实体渲染（Issue #6/#9）接入。
 */
'use strict';

/* 关 1 地图底材：奶油地砖与粉色墙裙；人物/待机动画仍由 #13 制作。 */
(function (root) {
  root.MIXX.engine.registerTileset('birthday', {
    // 横向木地板：板缝、木纹与细小反光，不铺满重复的符号点。
    floor: [
      '3333333333333333',
      '1111111111111111',
      '1111111111111111',
      '1113111111111111',
      '1111111111111111',
      '1111111111111111',
      '1111111111111111',
      '1111111111111111',
      '1111111111111111',
      '1111111111111111',
      '1111113111111111',
      '1111111111111111',
      '1111111111111111',
      '1111111111311111',
      '1111111111111111',
      '1111111111111111',
    ],
    // 连续海军蓝墙板与暖木踢脚线；避免每格重复的星形墙砖。
    wall: Array(16).fill('0000000000000000'),
    panel: Array(16).fill('0000000000000000'),
  });
  // 暗石长廊：只用底色与石色铺地，橙金留给灯火、机关和星星。
  root.MIXX.engine.registerTileset('kerosene', {
    floor: [
      '0000000000000000',
      ...Array(6).fill('0111111101111111'),
      '0111111101111111',
      '0000000000000000',
      ...Array(7).fill('1111011111110111'),
    ],
    wall: [
      ...Array(3).fill('0000000000000000'),
      '1111111111111111',
      ...Array(4).fill('0001000000010000'),
      '1111111111111111',
      ...Array(7).fill('0000000100000001'),
    ],
  });

  /** 第二关静态石廊一次绘制；机关和角色按运行态单独绘制。 */
  class Kerosene {
    constructor(game) {
      this.game = game;
      const map = game.level.map;
      this.background = game.doc.createElement('canvas');
      this.background.width = map.w * 16; this.background.height = map.h * 16;
      const c = this.background.getContext('2d');
      const floor = (x, y) => map.rows[y]?.[x] === '·';
      c.fillStyle = 'rgb(8,14,24)'; c.fillRect(0, 0, map.w * 16, map.h * 16);
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        const px = x * 16, py = y * 16, seed = (x * 17 + y * 31) % 7;
        if (floor(x, y)) {
          const region = x < 60 ? 0 : x < 130 ? 1 : x < 200 ? 2 : 3;
          const shades = [
            ['rgb(30,46,60)', 'rgb(32,48,63)', 'rgb(35,50,63)', 'rgb(28,43,58)'],
            ['rgb(58,42,36)', 'rgb(62,47,39)', 'rgb(55,42,38)', 'rgb(64,49,41)'],
            ['rgb(26,53,55)', 'rgb(29,57,58)', 'rgb(31,58,61)', 'rgb(25,49,53)'],
            ['rgb(40,38,64)', 'rgb(44,42,70)', 'rgb(37,37,60)', 'rgb(46,42,67)'],
          ][game.level.corridor ? region : 0];
          c.fillStyle = shades[seed % 4]; c.fillRect(px, py, 16, 16);
          c.fillStyle = 'rgb(44,59,71)'; c.fillRect(px, py, 16, 1);
          c.fillStyle = 'rgb(20,33,46)'; c.fillRect(px, py + 15, 16, 1);
          if ((x + y) % 2 === 0) c.fillRect(px + 15, py, 1, 16);
          if (seed < 3) { c.fillStyle = 'rgb(48,62,73)'; c.fillRect(px + 3 + seed, py + 5 + seed, 4, 1); }
          if (!floor(x, y - 1)) { c.fillStyle = 'rgb(15,25,37)'; c.fillRect(px, py, 16, 3); }
          if (!floor(x - 1, y)) { c.fillStyle = 'rgb(13,24,35)'; c.fillRect(px, py, 2, 16); }
          continue;
        }
        if (game.level.corridor) {
          c.fillStyle = y % 2 ? 'rgb(17,28,40)' : 'rgb(20,32,44)'; c.fillRect(px, py, 16, 16);
          c.fillStyle = 'rgb(29,42,54)'; c.fillRect(px, py, 16, 1);
          c.fillStyle = 'rgb(11,20,30)'; c.fillRect(px + (y % 2 ? 7 : 15), py + 1, 1, 15);
          // 北墙嵌窗与南墙检修板均落在实墙，补足贴墙行走时的视野。
          if ((y === 2 || y === 3) && x % 16 >= 4 && x % 16 <= 8) {
            c.fillStyle = 'rgb(28,54,73)'; c.fillRect(px + 1, py + 2, 14, 12);
            c.fillStyle = 'rgb(56,92,112)'; c.fillRect(px + 6, py + 2, 2, 12); c.fillRect(px + 1, py + 7, 14, 1);
          }
          if ((y === 18 || y === 19) && x % 12 >= 3 && x % 12 <= 5) {
            c.fillStyle = 'rgb(67,59,49)'; c.fillRect(px + 1, py + 2, 14, 12);
            c.fillStyle = 'rgb(24,35,44)'; for (let k = 3; k < 15; k += 4) c.fillRect(px + 3, py + k, 10, 2);
          }
        }
        if (floor(x, y + 1)) {
          c.fillStyle = 'rgb(26,38,52)'; c.fillRect(px, py + 1, 16, 15);
          c.fillStyle = 'rgb(49,64,77)'; c.fillRect(px, py + 2, 16, 2);
          c.fillStyle = 'rgb(36,50,65)'; c.fillRect(px + 1, py + 5, 14, 8);
          c.fillStyle = 'rgb(80,72,60)'; c.fillRect(px, py + 14, 16, 1);
          c.fillStyle = 'rgb(17,27,40)'; c.fillRect(px + 15, py + 4, 1, 10);
        }
        if (floor(x + 1, y)) { c.fillStyle = 'rgb(49,59,67)'; c.fillRect(px + 13, py, 2, 16); c.fillStyle = 'rgb(95,79,56)'; c.fillRect(px + 15, py, 1, 16); }
        if (floor(x - 1, y)) { c.fillStyle = 'rgb(38,49,61)'; c.fillRect(px, py, 2, 16); }
        if (floor(x, y - 1)) { c.fillStyle = 'rgb(57,65,70)'; c.fillRect(px, py, 16, 2); c.fillStyle = 'rgb(17,28,39)'; c.fillRect(px, py + 2, 16, 4); }
      }
      if (game.level.corridor) {
        const hall = game.level.corridor;
        // 材质、墙面设备与地纹区分四段；装饰不占净通道，不制造侧室。
        for (let x = 3; x < map.w - 3; x++) {
          if (!floor(x, hall.top)) continue;
          c.fillStyle = x < 60 ? 'rgb(88,119,143)' : x < 130 ? 'rgb(154,98,55)' : x < 200 ? 'rgb(71,143,143)' : 'rgb(136,111,170)';
          for (const y of [hall.top, hall.bottom]) c.fillRect(x * 16, y * 16 + 7, 16, 2);
          if (x % 16 === 8) {
            const px = x * 16, py = (hall.top - 1) * 16;
            c.fillRect(px, py + 2, 40, 11);
            c.fillStyle = 'rgb(20,31,43)';
            for (let k = 0; k < 4; k++) c.fillRect(px + k * 9 + 4, py + 4, 4, 7);
            if (x >= 60 && x < 130) for (let y = hall.top + 1; y < hall.bottom; y += 2) {
              c.fillStyle = 'rgb(103,76,48)'; c.fillRect(px + 4, y * 16, 2, 16);
            }
            if (x >= 130 && x < 200) for (let k = 0; k < 9; k++) {
              c.fillStyle = 'rgb(48,88,91)'; c.fillRect(px + k * 3, (hall.bottom - 1) * 16 + k % 3 * 2, 5, 1);
            }
            if (x >= 200) for (let k = 0; k < 8; k++) {
              c.fillStyle = 'rgb(136,123,159)'; c.fillRect(px + k * 5, (hall.top + 2 + k % 5) * 16 + 7, 2, 2);
            }
          }
        }
        for (const vent of hall.vents || []) {
          for (let y = vent.y; y < vent.y + vent.h; y++) for (let x = vent.x; x < vent.x + vent.w; x++) {
            c.fillStyle = 'rgb(18,29,36)'; c.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
            c.fillStyle = 'rgb(76,96,101)';
            for (let k = 3; k < 15; k += 4) c.fillRect(x * 16 + k, y * 16 + 2, 1, 12);
            c.fillStyle = 'rgb(203,158,70)'; c.fillRect(x * 16 + 1, y * 16 + 1, 4, 2);
          }
        }
        // 等宽长廊两侧铜管与壁灯只绘在真实墙格。
        for (let x = 2; x < map.w - 2; x++) for (const y of [hall.top - 1, hall.bottom + 1]) {
          if (floor(x, y)) continue;
          const px = x * 16, py = y * 16;
          c.fillStyle = 'rgb(94,71,48)'; c.fillRect(px, py + 6, 16, 3);
          c.fillStyle = 'rgb(164,124,71)'; c.fillRect(px, py + 6, 16, 1);
          if (x % 6 === 0) { c.fillStyle = 'rgb(61,78,88)'; c.fillRect(px + 6, py + 4, 4, 7); }
          if (x % 12 === 6) {
            c.fillStyle = 'rgb(53,44,34)'; c.fillRect(px + 4, py + 1, 8, 13);
            c.fillStyle = 'rgb(176,124,57)'; c.fillRect(px + 5, py + 3, 6, 7);
            c.fillStyle = 'rgb(255,216,135)'; c.fillRect(px + 7, py + 4, 2, 4);
          }
        }
        // 中央铜嵌线只是路面导向；主路保持十一格净宽。
        for (let x = 3; x < map.w - 3; x++) {
          const y = hall.centerY * 16 + 8;
          c.fillStyle = 'rgb(89,78,59)'; c.fillRect(x * 16 + 2, y - 16, 12, 1); c.fillRect(x * 16 + 2, y + 16, 12, 1);
          if (x % 8 === 0) { c.fillStyle = 'rgb(133,111,72)'; c.fillRect(x * 16 + 7, y - 1, 3, 3); }
        }
        const lamps = game.level.entities.filter(e => e.type === 'lamp');
        for (const [x, width, label] of [[3, 6, 'KEROSENE'], ...lamps.map((e, i) => [e.x - 2, 5, 'LANTERN ' + (i + 1)]), [228, 8, 'KEEP THE LIGHT']]) {
          const px = x * 16, py = (hall.top - 1) * 16;
          c.fillStyle = 'rgb(26,34,44)'; c.fillRect(px, py + 1, width * 16, 14);
          c.fillStyle = 'rgb(163,128,73)'; c.fillRect(px, py + 1, width * 16, 1); c.fillRect(px, py + 14, width * 16, 1);
          if (typeof c.fillText === 'function') {
            c.font = '7px monospace'; c.textAlign = 'center'; c.fillStyle = 'rgb(221,194,143)'; c.fillText(label, px + width * 8, py + 10);
          }
        }
        for (const e of [...lamps, game.level.entities.find(e => e.type === 'portal')]) {
          for (let i = 0; i < 64; i++) {
            const a = i * Math.PI / 32, px = Math.round((e.x + .5) * 16 + Math.cos(a) * 24), py = Math.round((e.y + .5) * 16 + Math.sin(a) * 13);
            if (!floor(Math.floor(px / 16), Math.floor(py / 16))) continue;
            c.fillStyle = i % 4 ? 'rgb(82,77,62)' : 'rgb(142,116,71)'; c.fillRect(px, py, 2, 1);
          }
        }
        return;
      }
      // 墙上的铜管与铆钉；不在可行走地面摆放看起来实心的家具。
      for (const [x, y, length] of [[1, 10, 15], [12, 18, 3], [25, 10, 7], [38, 5, 12]]) {
        c.fillStyle = 'rgb(47,39,33)'; c.fillRect(x * 16 + 8, y * 16, 6, length * 16);
        c.fillStyle = 'rgb(135,94,54)'; c.fillRect(x * 16 + 9, y * 16, 3, length * 16);
        c.fillStyle = 'rgb(190,142,79)'; c.fillRect(x * 16 + 9, y * 16, 1, length * 16);
        for (let k = 0; k < length; k += 3) { c.fillStyle = 'rgb(70,80,85)'; c.fillRect(x * 16 + 7, (y + k) * 16 + 4, 7, 3); }
      }
      // 以可重用的墙牌区分庭室，坐标全部落在现有墙格上。
      for (const [x, y, w, label] of [[2, 17, 9, 'KEROSENE'], [2, 4, 8, 'OLD LIGHT'], [14, 17, 9, 'OIL STORE'], [14, 4, 9, 'MESSENGER'], [27, 4, 10, 'KEEP THE LIGHT']]) {
        const px = x * 16, py = y * 16;
        c.fillStyle = 'rgb(26,34,44)'; c.fillRect(px, py + 1, w * 16, 14);
        c.fillStyle = 'rgb(135,107,66)'; c.fillRect(px, py + 1, w * 16, 1); c.fillRect(px, py + 14, w * 16, 1);
        for (const dx of [3, w * 16 - 4]) { c.fillStyle = 'rgb(216,177,108)'; c.fillRect(px + dx, py + 6, 1, 3); }
        if (typeof c.fillText === 'function') {
          c.font = '7px monospace'; c.textAlign = 'center'; c.fillStyle = 'rgb(207,181,134)'; c.fillText(label, px + w * 8, py + 10);
        }
      }
      // 储油架嵌进东侧墙面，油罐只是墙画；实际可拾取罐由实体层绘制。
      for (const [x, y] of [[25, 20], [25, 23], [12, 7]]) {
        if (floor(x, y)) continue;
        c.fillStyle = 'rgb(58,45,37)'; c.fillRect(x * 16 + 2, y * 16, 12, 28);
        for (const dy of [1, 14, 27]) { c.fillStyle = 'rgb(131,99,65)'; c.fillRect(x * 16 + 1, y * 16 + dy, 14, 2); }
        for (const dx of [3, 8]) for (const dy of [5, 18]) {
          c.fillStyle = 'rgb(85,100,104)'; c.fillRect(x * 16 + dx, y * 16 + dy, 4, 7);
          c.fillStyle = 'rgb(166,134,79)'; c.fillRect(x * 16 + dx + 1, y * 16 + dy - 1, 2, 2);
        }
      }
      // 旧灯室壁上的信使翼纹。
      for (const sign of [-1, 1]) for (let i = 0; i < 5; i++) {
        c.fillStyle = i % 2 ? 'rgb(110,102,81)' : 'rgb(155,132,88)';
        c.fillRect(104 + sign * (i * 4 + 5) - (sign < 0 ? 9 : 0), 42 + i * 2, 9, 3);
      }
      // 铜嵌纹是地面图案，不参与碰撞，也不盖住油罐、星星或人物。
      for (const [cx, cy, radius] of [[7, 21, 22], [19, 21, 25], [19, 9, 28], [31, 10, 28], [36, 22, 18]]) {
        for (let i = 0; i < 64; i++) {
          const a = i * Math.PI / 32, px = Math.round((cx + .5) * 16 + Math.cos(a) * radius), py = Math.round((cy + .5) * 16 + Math.sin(a) * radius * .55);
          if (!floor(Math.floor(px / 16), Math.floor(py / 16))) continue;
          c.fillStyle = i % 4 ? 'rgb(82,77,62)' : 'rgb(142,116,71)'; c.fillRect(px, py, 2, 1);
        }
      }
    }

    drawBackground() {
      const g = this.game;
      const w = root.MIXX.engine.VIEW_W, h = root.MIXX.engine.VIEW_H;
      g.renderer.ctx.drawImage(this.background, Math.round(g.camera.x), Math.round(g.camera.y), w, h, 0, 0, w, h);
    }

    drawActor(id, worldX, worldY) {
      const g = this.game, c = g.renderer.ctx;
      const x = Math.round(worldX - g.camera.x), y = Math.round(worldY - g.camera.y);
      if (id === 'byeori') {
        const bob = Math.floor(Math.sin(g.runTime * 3) * 1.5);
        c.fillStyle = 'rgb(255,209,102)'; c.fillRect(x + 6, y + bob, 4, 12); c.fillRect(x + 3, y + 4 + bob, 10, 5);
        c.fillStyle = 'rgb(255,241,184)'; c.fillRect(x + 6, y + 3 + bob, 4, 5);
        c.fillStyle = 'rgb(75,57,46)'; c.fillRect(x + 5, y + 5 + bob, 1, 1); c.fillRect(x + 9, y + 5 + bob, 1, 1);
        return;
      }
      const jiwoo = id === 'jiwoo';
      const combat = id === 'player' && g.combat;
      if (combat && combat.invuln > 0 && !combat.hurtFlash && Math.floor(combat.time * 20) % 2 === 0) return;
      c.fillStyle = 'rgb(15,24,35)'; c.fillRect(x + 3, y + 13, 11, 3);
      c.fillStyle = 'rgb(36,30,39)'; c.fillRect(x + 4, y - 14, 8, 11); c.fillRect(x + 3, y - 11, 10, 6);
      c.fillStyle = 'rgb(236,192,155)'; c.fillRect(x + 5, y - 10, 6, 5);
      c.fillStyle = 'rgb(48,36,41)'; c.fillRect(x + 6, y - 8, 1, 1); c.fillRect(x + 9, y - 8, 1, 1);
      c.fillStyle = combat && combat.hurtFlash ? 'rgb(255,240,230)' : jiwoo ? 'rgb(180,120,47)' : 'rgb(64,107,135)'; c.fillRect(x + 4, y - 4, 8, 12); c.fillRect(x + 2, y - 2, 2, 8); c.fillRect(x + 12, y - 2, 2, 8);
      c.fillStyle = jiwoo ? 'rgb(249,214,135)' : 'rgb(201,217,210)'; c.fillRect(x + 4, y - 4, 8, 2); c.fillRect(x + 9, y - 2, 2, 6);
      c.fillStyle = 'rgb(41,47,59)'; c.fillRect(x + 5, y + 7, 2, 7); c.fillRect(x + 9, y + 7, 2, 7);
      const step = id === 'player' && (g.input.getAxis().x || g.input.getAxis().y) ? Math.floor(g.runTime * 7) % 2 : 0;
      c.fillStyle = 'rgb(70,52,46)'; c.fillRect(x + 5, y + 12 + step, 2, 3); c.fillRect(x + 9, y + 13 - step, 2, 3);
      c.fillStyle = 'rgb(236,192,155)'; c.fillRect(x + 2, y + 5, 2, 2); c.fillRect(x + 12, y + 5, 2, 2);
      if (jiwoo) { c.fillStyle = 'rgb(231,214,163)'; c.fillRect(x + 1, y + 11, 4, 2); c.fillRect(x + 12, y + 11, 3, 2); }
      if (combat) {
        const left = combat.facing.x < 0, sx = x + (left ? 0 : 14);
        c.fillStyle = 'rgb(226,218,233)'; c.fillRect(sx, y + 1, 2, 8);
        c.fillStyle = 'rgb(255,195,224)'; c.fillRect(sx - 1, y - 3, 4, 5);
        c.fillStyle = 'rgb(255,247,205)'; c.fillRect(sx, y - 2, 2, 3);
        if (combat.energy >= combat.maxEnergy) { c.fillRect(x + 7, y - 20, 2, 5); c.fillRect(x + 5, y - 18, 6, 1); }
      }
    }

    drawEnemy(e, x, y) {
      const c = this.game.renderer.ctx, wisp = e.kind === 'wisp', flash = e.hurt > 0;
      c.fillStyle = flash ? 'rgb(255,255,255)' : wisp ? 'rgb(94,184,192)' : 'rgb(49,40,53)';
      c.fillRect(x + 2, y, e.size - 4, e.size); c.fillRect(x, y + 3, e.size, e.size - 5);
      c.fillStyle = flash ? 'rgb(255,209,102)' : wisp ? 'rgb(215,242,210)' : 'rgb(221,99,48)';
      c.fillRect(x + 3, y + 4, 2, 3); c.fillRect(x + 7, y + 4, 2, 3);
      if (wisp) { c.fillRect(x + 4, y - 3, 3, 4); c.fillRect(x + 1, y + e.size - 1, 2, 3); }
      else {
        c.fillStyle = 'rgb(121,73,57)'; c.fillRect(x + 2, y + 9, 3, 1); c.fillRect(x + 7, y + 8, 3, 2);
        c.fillStyle = 'rgb(255,179,77)'; c.fillRect(x + 3 + Math.floor(this.game.runTime * 5) % 3, y - 2, 1, 2);
      }
    }

    /** 自动箭孔预警发亮；地刺底座、等待台和闸刃轨道常驻可见。 */
    drawTraps() {
      const g=this.game,c=g.renderer.ctx,combat=g.combat;
      for(const t of combat.traps) {
        const x=t.x*16-g.camera.x,y=t.y*16-g.camera.y;
        if(x<-150 || x>470)continue;
        const warning=t.phase==='warning',active=t.phase==='active';
        if(t.kind==='blade') {
          const px=(t.x+.5)*16-g.camera.x,top=g.level.corridor.top*16-g.camera.y,bottom=(g.level.corridor.bottom+1)*16-g.camera.y;
          c.fillStyle='rgb(21,31,35)';c.fillRect(px-10,top,20,bottom-top);
          c.fillStyle='rgb(133,121,92)';c.fillRect(px-8,top,2,bottom-top);c.fillRect(px+6,top,2,bottom-top);
          for(let yy=top;yy<bottom;yy+=8){c.fillStyle='rgb(68,78,77)';c.fillRect(px-5,yy,10,2);}
          // 制动杆设在出口侧，铜线通向驱动箱。
          c.fillStyle='rgb(154,123,70)';c.fillRect(px,top-8,64,2);c.fillRect(px+63,top-8,2,32);
          c.fillStyle='rgb(81,101,106)';c.fillRect(px-12,top-14,24,13);c.fillRect(px-12,bottom+1,24,12);
          const bx=px,by=t.disabled?top-8:(t.by??(g.level.corridor.top+1.5)*16)-g.camera.y;
          c.fillStyle='rgb(14,20,24)';c.fillRect(bx-14,by+7,28,5);
          for(let iy=-10;iy<=10;iy++) {
            const half=14-Math.floor(Math.abs(iy)*.5);
            c.fillStyle=Math.abs(iy)>7?'rgb(236,242,235)':'rgb(149,178,187)';
            c.fillRect(Math.round(bx-half),Math.round(by+iy),half*2,1);
          }
          c.fillStyle=t.disabled?'rgb(94,230,184)':'rgb(236,161,91)';c.fillRect(bx-3,Math.round(by)-3,6,6);
        } else {
          if(t.kind==='darts') {
            const top=g.level.corridor.top*16-g.camera.y,bottom=(g.level.corridor.bottom+1)*16-g.camera.y;
            const edge=t.dir>0?top-14:bottom;
            c.fillStyle='rgb(151,123,75)';c.fillRect(x-2,edge,t.w*16+4,12);
            c.fillStyle=warning?'rgb(255,143,95)':'rgb(8,20,31)';
            for(let col=0;col<t.w;col++)c.fillRect(x+col*16+4,edge+2,8,8);
            // 地面旧箭痕提示危险列，箭孔按自身周期工作。
            for(let col=0;col<t.w;col++)for(let yy=top+4;yy<bottom;yy+=12) {
              c.fillStyle=warning?'rgb(213,140,71)':'rgb(72,81,81)';c.fillRect(x+col*16+7,yy,2,4);
            }
          } else {
            for(let col=0;col<t.w;col++)for(let tile=0;tile<t.h;tile++) {
              const xx=x+col*16,yy=y+tile*16;
              c.fillStyle='rgb(39,44,43)';c.fillRect(xx+1,yy+1,14,14);
              c.fillStyle=warning?'rgb(234,175,77)':active?'rgb(189,92,67)':'rgb(92,165,143)';
              c.fillRect(xx+1,yy+1,14,1);c.fillRect(xx+1,yy+14,14,1);
              c.fillStyle='rgb(12,19,21)';c.fillRect(xx+4,yy+5,3,3);c.fillRect(xx+10,yy+10,3,3);
              if(active) for(let sy=5;sy<16;sy+=8)for(let sx=5;sx<16;sx+=8) {
                c.fillStyle='rgb(220,229,227)';
                for(let row=0;row<7;row++)c.fillRect(xx+sx-Math.floor(row/2),yy+sy-5+row,1+2*Math.floor(row/2),1);
              }
            }
          }
        }
      }
      const spikes=combat.traps.filter(t=>t.kind==='spikes');
      for(let i=1;i<spikes.length;i++) {
        const left=(spikes[i-1].x+spikes[i-1].w)*16-g.camera.x,right=spikes[i].x*16-g.camera.x;
        if(right<0 || left>320)continue;
        const yy=g.level.corridor.centerY*16-g.camera.y;
        c.fillStyle='rgb(117,160,149)';c.fillRect(left+4,yy+2,right-left-8,1);c.fillRect(left+4,yy+29,right-left-8,1);
        c.fillStyle='rgb(188,219,200)';c.font='8px sans-serif';c.textAlign='center';c.fillText('歇脚', (left+right)/2, yy+19);c.textAlign='left';
      }
      for(const dart of combat.darts) {
        const x=Math.round(dart.x-g.camera.x),y=Math.round(dart.y-g.camera.y);
        c.fillStyle='rgb(173,139,91)';c.fillRect(x,y-7*dart.dir,1,8*dart.dir);
        c.fillStyle='rgb(226,237,230)';c.fillRect(x-2,y,5,1);c.fillRect(x-1,y+dart.dir,3,1);c.fillRect(x,y+2*dart.dir,1,1);
      }
    }

    /** 水渠遗迹：浅水槽、滑轨、金色卡槽、真实连到石罩的配重绳。 */
    drawRuins() {
      const g = this.game, r = g.ruins, cfg = g.level.ruins;
      if (!r) return;
      const c = g.renderer.ctx, b = cfg.basin;
      const x = b.x * 16 - g.camera.x, y = b.y * 16 - g.camera.y;
      if (x > 320 || x + b.w * 16 < 0) return;
      c.fillStyle = 'rgb(27,40,49)'; c.fillRect(x - 2, y - 2, b.w * 16 + 4, b.h * 16 + 4);
      c.fillStyle = r.water > 0 ? 'rgb(32,91,110)' : 'rgb(67,66,57)'; c.fillRect(x, y, b.w * 16, b.h * 16);
      c.fillStyle = 'rgb(171,142,87)';
      c.fillRect(x, y, b.w * 16, 2); c.fillRect(x, y + b.h * 16 - 2, b.w * 16, 2);
      c.fillStyle = 'rgb(116,103,75)';
      for (const dy of [17,29]) c.fillRect(x + 16, y + dy, (b.w - 2) * 16, 2);
      if (r.water > 0) {
        c.fillStyle = 'rgb(105,193,210)';
        for (let k = 0; k < 20; k++) {
          c.fillRect(x + (k * 17 + Math.floor(g.runTime * 12)) % (b.w * 16 - 6), y + 5 + (k * 7) % (b.h * 16 - 10), 5, 1);
        }
      }
      const dockX = cfg.dockX * 16 - g.camera.x;
      c.fillStyle = 'rgb(255,209,102)';
      c.fillRect(dockX - 1, y + 13, 2, 22); c.fillRect(dockX + 15, y + 13, 2, 22);
      c.fillRect(dockX + 4, y + 34, 8, 2);
      const star = g.level.entities.find(e => e.id === cfg.reward);
      const sx = star.x * 16 - g.camera.x, sy = star.y * 16 - g.camera.y;
      const lift = r.solved ? 24 : r.tied ? Math.round(r.water * 20) : 0;
      c.fillStyle = 'rgb(135,111,74)';
      // 横梁沿实际连接方向绘制，转角用滑轮标明力的传递。
      c.fillRect(dockX + 6, sy - 30, sx - dockX + 4, 2);
      c.fillRect(sx + 6, sy - 30, 2, 38 - lift);
      if (r.tied) c.fillRect(dockX + 6, sy - 30, 2, b.y * 16 - g.camera.y + 41 - sy - Math.round(r.water * 12));
      c.fillStyle = 'rgb(218,184,112)'; c.fillRect(dockX + 4, sy - 32, 6, 6); c.fillRect(sx + 4, sy - 32, 6, 6);
      c.fillStyle = 'rgb(76,89,99)'; c.fillRect(sx - 3, sy - lift - 3, 22, 21);
      c.fillStyle = 'rgb(152,143,119)'; c.fillRect(sx - 3, sy - lift - 3, 22, 3);
      c.fillStyle = 'rgb(27,40,49)';
      for (let k = 1; k < 18; k += 5) c.fillRect(sx + k - 3, sy - lift + 1, 2, 14);
      if (!r.solved) { c.fillStyle = 'rgb(255,209,102)'; c.fillRect(sx + 6, sy + 4, 4, 5); }
      // 左下方阀门到浅水槽的管路，水位计随放 / 排水变化。
      const valve = g.level.entities.find(e => e.type === 'ruincontrol' && e.action === 'valve');
      const vx = valve.x * 16 - g.camera.x, vy = valve.y * 16 - g.camera.y;
      c.fillStyle = 'rgb(128,106,70)'; c.fillRect(vx + 6, y + 6, x - vx - 4, 3); c.fillRect(vx + 6, y + 6, 3, vy - y);
      c.fillStyle = 'rgb(16,32,43)'; c.fillRect(x - 10, y, 5, b.h * 16);
      c.fillStyle = 'rgb(105,193,210)'; c.fillRect(x - 9, y + (1 - r.water) * b.h * 16, 3, r.water * b.h * 16);

    }

    drawEntity(e) {
      const g = this.game, c = g.renderer.ctx;
      const x = Math.round(e.x * 16 - g.camera.x), y = Math.round(e.y * 16 - g.camera.y);
      if(e.type==='trapcontrol') {
        const disabled=g.combat.traps.find(t=>t.id===e.target).disabled;
        c.fillStyle='rgb(93,106,108)';c.fillRect(x+2,y+5,12,11);
        c.fillStyle=disabled?'rgb(94,230,184)':'rgb(235,160,96)';c.fillRect(x+4,y+1,3,10);c.fillRect(x+3,y,10,3);
        return true;
      }
      if (e.visual === 'raft') {
        const lift = Math.round(g.ruins.water * 12);
        c.fillStyle = 'rgb(28,43,51)'; c.fillRect(x - 1, y + 11, 18, 5);
        c.fillStyle = 'rgb(171,127,73)'; c.fillRect(x, y + 2 - lift, 16, 12);
        c.fillStyle = 'rgb(86,63,41)'; for (let k = 3; k < 16; k += 4) c.fillRect(x + k, y + 2 - lift, 1, 12);
        c.fillStyle = 'rgb(223,195,132)'; c.fillRect(x + 1, y + 5 - lift, 14, 2); c.fillRect(x + 1, y + 11 - lift, 14, 2);
        return true;
      }
      if (e.type === 'ruincontrol') {
        c.fillStyle = 'rgb(86,99,105)'; c.fillRect(x + 3, y + 3, 10, 13);
        c.fillStyle = 'rgb(191,151,89)'; c.fillRect(x + 1, y + 4, 14, 3);
        c.fillStyle = e.action === 'valve' ? g.ruins.valve ? 'rgb(105,193,210)' : 'rgb(168,120,77)' : e.action === 'rope' ? g.ruins.tied ? 'rgb(94,230,184)' : 'rgb(223,195,132)' : 'rgb(202,137,126)';
        c.fillRect(x + 6, y, 4, 10); c.fillRect(x + 3, y + 1, 10, 2);
        return true;
      }
      if (e.type === 'npc') { this.drawActor(e.id, e.x * 16, e.y * 16); return true; }
      if (e.type === 'gate') {
        const sideways = g.mechanics.tileType(e.x - 1, e.y) === 'floor';
        c.fillStyle = 'rgb(102,88,65)';
        for (const k of [0, 14]) c.fillRect(x + (sideways ? 0 : k), y + (sideways ? k : 0), sideways ? 16 : 2, sideways ? 2 : 16);
        c.fillStyle = 'rgb(225,181,101)';
        for (const k of [0, 14]) c.fillRect(x + (sideways ? 1 : k), y + (sideways ? k : 1), sideways ? 14 : 1, sideways ? 1 : 14);
        if (!e.open) {
          c.fillStyle = 'rgb(79,94,106)';
          for (let k = 3; k < 14; k += 4) c.fillRect(x + (sideways ? 3 : k), y + (sideways ? k : 3), sideways ? 10 : 2, sideways ? 2 : 10);
          c.fillStyle = 'rgb(189,132,59)'; c.fillRect(x + 6, y + 6, 4, 4);
        }
        return true;
      }
      if (e.type === 'portal') {
        const active = g._portalActive();
        c.fillStyle = 'rgb(55,60,64)'; c.fillRect(x - 3, y - 10, 22, 25);
        c.fillStyle = 'rgb(157,123,75)'; c.fillRect(x - 2, y - 10, 20, 3); c.fillRect(x - 2, y - 7, 3, 21); c.fillRect(x + 15, y - 7, 3, 21);
        c.fillStyle = 'rgb(13,23,36)'; c.fillRect(x + 1, y - 7, 14, 21);
        c.fillStyle = active ? 'rgb(245,202,114)' : 'rgb(67,83,98)';
        for (let k = 0; k < 4; k++) c.fillRect(x + 2 + k * 3, y - 9, 2, 1);
        if (active) {
          c.fillStyle = 'rgb(63,111,132)'; c.fillRect(x + 3, y - 5, 10, 18);
          c.fillStyle = 'rgb(197,231,222)';
          for (let k = 0; k < 6; k++) c.fillRect(x + 4 + (k * 7 % 9), y - 3 + (k * 5 + Math.floor(g.runTime * 4)) % 14, 1, 2);
        }
        return true;
      }
      return false;
    }
  }
  root.MIXX.Kerosene = Kerosene;
})(typeof window !== 'undefined' ? window : globalThis);
