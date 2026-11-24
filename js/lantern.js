/** 灯芯机关：独立光路棋盘。逻辑同时供运行时、地图校验与通关工具使用。 */
'use strict';
(function (root) {
  class LanternPuzzle {
    /** 配置在此边界校验；内部坐标与镜面方向均为确定的整数。 */
    constructor(config, flipped = []) {
      const error = LanternPuzzle.validate(config);
      if (error) throw new Error('灯芯机关：' + error);
      this.config = config;
      this.angles = config.mirrors.map((m, i) => m.angle ^ Number(flipped.includes(i)));
      this.selected = 0;
      this.moves = 0;
      this.history = [];
      this.hintLevel = 0;
      this.hint = null;
      this.time = 0;
      this.result = this.trace();
    }

    static validate(c) {
      if (!c || !Number.isInteger(c.cols) || !Number.isInteger(c.rows) || c.cols < 3 || c.cols > 7 || c.rows < 3 || c.rows > 5) return '棋盘须为 3–7 列、3–5 行';
      const inside = p => p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < c.cols && p.y >= 0 && p.y < c.rows;
      if (!c.source || c.source.x !== -1 || !Number.isInteger(c.source.y) || c.source.y < 0 || c.source.y >= c.rows) return '火种须在棋盘左侧';
      if (!Number.isInteger(c.version) || c.version < 1) return '机关版本须为正整数';
      if (!inside(c.goal) || !Array.isArray(c.receivers) || c.receivers.length < 1 || c.receivers.length > 5 || !c.receivers.every(inside)) return '出口或灯芯坐标无效';
      if (!Array.isArray(c.blocks) || !c.blocks.every(inside)) return '挡板坐标无效';
      if (!Array.isArray(c.mirrors) || c.mirrors.length < 2 || c.mirrors.length > 10 || !c.mirrors.every(m => inside(m) && (m.angle === 0 || m.angle === 1))) return '反射镜须为 2–10 枚，方向为 0 或 1';
      if (!c.mirrors.every((m, i) => Array.isArray(m.links) && m.links.every(j => Number.isInteger(j) && j >= 0 && j < c.mirrors.length && j !== i) && new Set(m.links).size === m.links.length)) return '联动镜编号必须有效、不重复且不含自身';
      if (c.paired !== undefined && typeof c.paired !== 'boolean') return '配对模式必须为布尔值';
      if (c.assist !== undefined && typeof c.assist !== 'boolean') return '帮走开关必须为布尔值';
      if (c.paired && !c.mirrors.every((m, i) => m.links.length === 1 && c.mirrors[m.links[0]].links.length === 1 && c.mirrors[m.links[0]].links[0] === i)) return '配对模式下每枚镜面只能双向关联另一枚镜面';
      if (c.groups !== undefined) {
        if (c.paired || !Array.isArray(c.groups) || c.groups.length < 2 || c.groups.length > 4
          || !c.groups.every(g => g && typeof g.label === 'string' && g.label.length === 1 && Array.isArray(g.members) && g.members.length >= 2 && g.members.every(i => Number.isInteger(i) && i >= 0 && i < c.mirrors.length))) return '分组须为 2–4 组，每组包含有效标签和至少两枚镜面';
        const members = c.groups.flatMap(g => g.members);
        if (members.length !== c.mirrors.length || new Set(members).size !== c.mirrors.length || new Set(c.groups.map(g => g.label)).size !== c.groups.length) return '每枚镜面必须且只能属于一个组，组号不能重复';
        if (c.mirrors.some(m => m.links.length)) return '分组镜面不能再配置额外关联';
      }
      const points = [c.goal, ...c.receivers, ...c.mirrors, ...c.blocks].map(p => p.x + ',' + p.y);
      if (new Set(points).size !== points.length) return '出口、灯芯、镜面与挡板不能重叠';
      return '';
    }

    /** BFS 同时验证光路与联动可达性；返回从指定旋镜状态出发的最短操作序列。 */
    static solution(config, flipped = []) {
      const board = new LanternPuzzle(config, flipped), n = config.mirrors.length;
      const start = board.angles.reduce((mask, a, i) => mask | (a << i), 0);
      const changes = config.mirrors.map((m, i) => board.affected(i).reduce((mask, j) => mask | (1 << j), 0));
      const queue = [start], previous = new Map([[start, null]]);
      for (let head = 0; head < queue.length; head++) {
        const mask = queue[head];
        board.angles = config.mirrors.map((m, i) => (mask >> i) & 1);
        if (board.trace().solved) {
          const actions = [];
          for (let at = mask; previous.get(at); at = previous.get(at).from) actions.push(previous.get(at).action);
          return actions.reverse();
        }
        for (let i = 0; i < n; i++) {
          const next = mask ^ changes[i];
          if (!previous.has(next)) { previous.set(next, { from: mask, action: i }); queue.push(next); }
        }
      }
      return null;
    }

    trace() {
      const c = this.config, path = [{ ...c.source }], visited = new Set(), lit = [];
      let x = c.source.x, y = c.source.y, dx = 1, dy = 0, reached = false, loop = false, orderFault = false, blocked = false;
      while (true) {
        x += dx; y += dy;
        path.push({ x, y });
        if (x < 0 || y < 0 || x >= c.cols || y >= c.rows) break;
        const key = [x, y, dx, dy].join(',');
        if (visited.has(key)) { loop = true; break; }
        visited.add(key);
        if (c.blocks.some(b => b.x === x && b.y === y)) { blocked = true; break; }
        const receiver = c.receivers.findIndex(r => r.x === x && r.y === y);
        if (receiver >= 0) {
          if (!orderFault && receiver === lit.length) lit.push(receiver);
          else orderFault = true;
        }
        if (x === c.goal.x && y === c.goal.y) { reached = true; break; }
        const i = c.mirrors.findIndex(m => m.x === x && m.y === y);
        if (i >= 0) [dx, dy] = this.angles[i] === 0 ? [-dy, -dx] : [dy, dx];
      }
      return { path, lit, reached, loop, orderFault, blocked, solved: reached && !orderFault && lit.length === c.receivers.length };
    }

    rotate(index) {
      if (this.result.solved) return;
      this.selected = index;
      this.history.push(index);
      for (const i of this.affected(index)) this.angles[i] ^= 1;
      this.moves++;
      this.hintLevel = 0; this.hint = null;
      this.result = this.trace();
    }

    undo() {
      if (!this.history.length || this.result.solved) return;
      const index = this.history.pop();
      for (const i of this.affected(index)) this.angles[i] ^= 1;
      this.selected = index; this.moves--; this.result = this.trace();
      this.hintLevel = 0; this.hint = null;
    }

    reset() {
      if (this.result.solved) return;
      this.angles = this.config.mirrors.map(m => m.angle);
      this.moves = 0; this.history = []; this.result = this.trace();
      this.hintLevel = 0; this.hint = null;
    }

    /** 运行、求解与预览共用同一影响范围，分组成员在配置边界保证唯一。 */
    affected(index) {
      return this.config.groups ? this.config.groups.find(g => g.members.includes(index)).members : [index, ...this.config.mirrors[index].links];
    }

    /** 第三灯可主动查看下一步；建议与玩家当前选中镜面保持独立。 */
    requestHint() {
      if (!this.config.assist || this.result.solved) return;
      this.hintLevel = 3;
      const flipped = this.angles.map((a, i) => a !== this.config.mirrors[i].angle ? i : -1).filter(i => i >= 0);
      const plan = LanternPuzzle.solution(this.config, flipped);
      if (!plan || !plan.length) {
        this.hint = { action: -1, lines: ['当前无法接通，按 F 重置试试。', '也可以按 Esc 返回长廊。'] };
        return;
      }
      const action = plan[0], letter = String.fromCharCode(65 + action);
      this.hint = { action, lines: ['建议：点镜面 ' + letter + '（绿框）。',
        'J 执行建议；E 只转当前选中。'] };
    }

    /** 逻辑画布 320×224；点击与绘制共用同一格位几何。 */
    geometry() { return { x: 28, y: 52, cell: 25 }; }

    hit(x, y) {
      const g = this.geometry();
      return this.config.mirrors.findIndex(m => Math.abs(x - (g.x + (m.x + .5) * g.cell)) < g.cell / 2 && Math.abs(y - (g.y + (m.y + .5) * g.cell)) < g.cell / 2);
    }

    draw(ctx, number) {
      const c = this.config, g = this.geometry(), cell = g.cell;
      const px = x => Math.max(g.x - 10, Math.min(g.x + c.cols * cell + 8, g.x + (x + .5) * cell));
      const py = y => Math.max(g.y - 6, Math.min(g.y + c.rows * cell + 6, g.y + (y + .5) * cell));
      ctx.save();
      ctx.fillStyle = '#0b1520'; ctx.fillRect(0, 0, 320, 224);
      ctx.fillStyle = '#8d6743'; ctx.fillRect(7, 7, 306, 2); ctx.fillRect(7, 215, 306, 2);
      for (const x of [10, 307]) for (const y of [13, 207]) { ctx.fillStyle = '#c19a60'; ctx.fillRect(x, y, 3, 3); }
      ctx.textAlign = 'left'; ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#ffdc9c';
      ctx.fillText('联动镜阵 / ' + ['入门', '逆流', '交织'][number - 1], 17, 27);
      if (c.assist && !this.result.solved) {
        ctx.fillStyle = '#294d57'; ctx.fillRect(213, 12, 41, 23); ctx.fillRect(258, 12, 45, 23);
        ctx.fillStyle = '#c8f5eb'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('H 提示', 233, 27); ctx.fillText('J 帮一步', 280, 27); ctx.textAlign = 'left';
      }
      ctx.font = '8px sans-serif'; ctx.fillStyle = '#b9cbd0';
      ctx.fillText((c.groups ? '同色同号为一组，点击转动整组；' : c.paired ? '每次只转动一对镜面；' : '金框镜面同时转动；') + '按 1→' + c.receivers.length + ' 经过灯芯。', 17, 41);
      ctx.fillStyle = '#4b3e31'; ctx.fillRect(g.x - 3, g.y - 3, c.cols * cell + 6, c.rows * cell + 6);
      for (let y = 0; y < c.rows; y++) for (let x = 0; x < c.cols; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#192c37' : '#1d323d';
        ctx.fillRect(g.x + x * cell, g.y + y * cell, cell - 1, cell - 1);
      }
      for (const b of c.blocks) {
        const x = px(b.x), y = py(b.y);
        ctx.fillStyle = '#48535a'; ctx.fillRect(x - 11, y - 11, 22, 22);
        ctx.fillStyle = '#26343c'; ctx.fillRect(x - 7, y - 7, 14, 14);
        ctx.strokeStyle = '#7b6e5c'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke();
      }
      const groupColors = ['#eab36b', '#70d6d0', '#c3a3e8', '#e391ac'];
      const selected = c.mirrors[this.selected], affected = this.affected(this.selected);
      const selectedGroup = c.groups ? c.groups.findIndex(g => g.members.includes(this.selected)) : -1;
      ctx.setLineDash([2, 2]); ctx.strokeStyle = '#a48450'; ctx.lineWidth = 1;
      if (selectedGroup >= 0) ctx.strokeStyle = groupColors[selectedGroup];
      for (const i of affected) {
        if (i === this.selected) continue;
        ctx.beginPath(); ctx.moveTo(px(selected.x), py(selected.y)); ctx.lineTo(px(c.mirrors[i].x), py(c.mirrors[i].y)); ctx.stroke();
      }
      ctx.setLineDash([]);
      // 实时光束，亮芯沿当前通路移动；镜面变化立即改变光路。
      ctx.beginPath(); ctx.moveTo(px(c.source.x) + 8, py(c.source.y));
      for (const p of this.result.path.slice(1)) ctx.lineTo(px(p.x), py(p.y));
      ctx.strokeStyle = '#8c5431'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = '#ffd486'; ctx.lineWidth = 2; ctx.stroke();
      const path = this.result.path, progress = (this.time * 5) % (path.length - 1), segment = Math.floor(progress), t = progress - segment;
      const a = path[segment], b = path[segment + 1];
      ctx.fillStyle = '#fff4cd'; ctx.fillRect(px(a.x + (b.x - a.x) * t) - 2, py(a.y + (b.y - a.y) * t) - 2, 4, 4);
      ctx.fillStyle = '#ffbb5e'; ctx.fillRect(10, py(c.source.y) - 6, 9, 12);
      ctx.fillStyle = '#ffefb3'; ctx.fillRect(13, py(c.source.y) - 3, 4, 6);
      for (let i = 0; i < c.receivers.length; i++) {
        const r = c.receivers[i], lit = this.result.lit.includes(i), x = px(r.x), y = py(r.y);
        ctx.fillStyle = '#11212a'; ctx.fillRect(x - 8, y - 8, 16, 16);
        ctx.strokeStyle = lit ? '#a6edce' : '#617d83'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = lit ? '#c3ffe1' : '#a1bbc1'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), x, y + 3); ctx.textAlign = 'left';

      }
      for (let i = 0; i < c.mirrors.length; i++) {
        const m = c.mirrors[i], x = px(m.x), y = py(m.y), selected = i === this.selected;
        const group = c.groups ? c.groups.findIndex(g => g.members.includes(i)) : -1;
        ctx.fillStyle = this.hint && this.hint.action === i ? '#2d615a' : '#172531'; ctx.fillRect(x - 10, y - 10, 20, 20);
        ctx.strokeStyle = selected ? '#fff0bd' : affected.includes(i) ? '#e0aa55' : '#658392'; ctx.lineWidth = selected ? 2 : 1;
        ctx.strokeRect(x - 10, y - 10, 20, 20);
        ctx.beginPath(); ctx.moveTo(x - 7, y + (this.angles[i] === 0 ? 7 : -7)); ctx.lineTo(x + 7, y + (this.angles[i] === 0 ? -7 : 7));
        ctx.strokeStyle = '#bce5e8'; ctx.lineWidth = 3; ctx.stroke();
        if (group >= 0) { ctx.fillStyle = groupColors[group]; ctx.fillRect(x - 10, y - 10, 2, 20); }
        ctx.fillStyle = '#172531'; ctx.fillRect(x - 9, y - 9, group >= 0 ? 11 : 6, 7);
        ctx.fillStyle = group >= 0 ? groupColors[group] : affected.includes(i) ? '#ffdf95' : '#b7c6cb'; ctx.font = '6px sans-serif';
        ctx.fillText((group >= 0 ? c.groups[group].label : '') + String.fromCharCode(65 + i), x - 8, y - 3);
        if (this.hint && this.hint.action === i) {
          ctx.strokeStyle = '#94f4c6'; ctx.lineWidth = 3; ctx.strokeRect(x - 12, y - 12, 24, 24);
        }
      }
      const gx = px(c.goal.x), gy = py(c.goal.y);
      ctx.fillStyle = this.result.solved ? '#baf7d6' : '#a8824b';
      ctx.fillRect(gx - 7, gy - 9, 14, 18); ctx.fillStyle = '#11212a'; ctx.fillRect(gx - 4, gy - 6, 8, 12);
      if (this.result.reached) { ctx.fillStyle = '#ffdc8b'; ctx.fillRect(gx - 2, gy - 4, 4, 8); }
      const sx = 224;
      ctx.font = '8px sans-serif';
      if (c.groups) c.groups.forEach((group, i) => {
        ctx.fillStyle = groupColors[i]; ctx.fillRect(sx + i * 20, 55, 16, 13);
        ctx.fillStyle = '#172531'; ctx.fillText(group.label, sx + i * 20 + 5, 65);
      });
      else { ctx.fillStyle = '#d7b77b'; ctx.fillText('LANTERN ' + String(number).padStart(2, '0'), sx, 64); }
      ctx.fillStyle = '#c5d4d2'; ctx.fillText('顺序 ' + this.result.lit.length + ' / ' + c.receivers.length, sx, 82);
      c.receivers.forEach((r, i) => {
        ctx.fillStyle = this.result.lit.includes(i) ? '#a6edce' : '#455d66'; ctx.fillRect(sx + i * 15, 90, 12, 12);
        ctx.fillStyle = this.result.lit.includes(i) ? '#11212a' : '#bed0d4'; ctx.font = '7px sans-serif'; ctx.fillText(String(i + 1), sx + i * 15 + 4, 99);
      });
      ctx.font = '8px sans-serif'; ctx.fillStyle = selectedGroup >= 0 ? groupColors[selectedGroup] : '#e0b66f';
      ctx.fillText((selectedGroup >= 0 ? '组' + c.groups[selectedGroup].label + ' ' : '联动 ') + affected.map(i => String.fromCharCode(65 + i)).join('+'), sx, 115);
      ctx.fillStyle = this.result.solved ? '#baf7d6' : '#9baeb6';
      ctx.fillText(this.result.solved ? '光路接通' : this.result.orderFault ? '灯芯顺序错误' : this.result.blocked ? '光路被阻挡' : this.result.reached ? '还有灯芯未亮' : '等待光路接通', sx, 128);
      ctx.fillStyle = '#a7c6cc'; ctx.fillText('选中 ' + String.fromCharCode(65 + this.selected) + ' · 转镜 ' + this.moves, sx, 140);
      for (const [x, text] of [[220, 'G 撤销'], [263, 'F 重置']]) {
        ctx.fillStyle = '#29404a'; ctx.fillRect(x, 148, 40, 16); ctx.fillStyle = '#c6d8db'; ctx.fillText(text, x + 5, 159);
      }
      ctx.fillStyle = '#ffdc9c'; ctx.fillRect(218, 170, 85, 27);
      ctx.fillStyle = '#172531'; ctx.textAlign = 'center'; ctx.font = '9px sans-serif';
      ctx.fillText(this.result.solved ? '点灯返回  E' : '返回长廊  Esc', 260, 187);
      ctx.textAlign = 'left'; ctx.font = '8px sans-serif'; ctx.fillStyle = '#c6d8db';
      if (this.hint) {
        ctx.fillStyle = '#bbf0d7'; ctx.fillRect(13, 181, 194, 31);
        ctx.fillStyle = '#102d2e'; ctx.font = '9px sans-serif'; ctx.fillText(this.hint.lines[0], 17, 193); ctx.fillText(this.hint.lines[1], 17, 207);
      } else if (this.result.solved) ctx.fillText('灯芯已回应。按 E 点燃灯柱，打开前路。', 17, 208);
      else {
        ctx.fillStyle = '#203c48'; ctx.fillRect(13, 181, 194, 31);
        ctx.fillStyle = '#d2e5e5'; ctx.font = '9px sans-serif';
        ctx.fillText(c.groups ? '方向键选镜，E 转动所在整组。' : '方向键选镜，E 旋转当前镜面。', 17, 193);
        ctx.fillText(c.assist ? '卡住按 H 看提示，或 J 帮走一步。' : '观察金框联动；G 撤销，F 重置。', 17, 207);
      }
      ctx.restore();
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = LanternPuzzle;
  root.MIXX = root.MIXX || {};
  root.MIXX.LanternPuzzle = LanternPuzzle;
})(typeof window !== 'undefined' ? window : globalThis);
