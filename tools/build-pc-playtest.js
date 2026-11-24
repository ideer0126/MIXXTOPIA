#!/usr/bin/env node
/** 本地 PC 试玩包：复用正式构建，额外提供独立存档的第二关快捷入口。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const repo = path.resolve(__dirname, '..');
const output = path.join(repo, '.ds/pc-playtest');
const folder = 'MIXXTOPIA-PC-Playtest';
const site = path.join(output, folder);
fs.mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [path.join(__dirname, 'build-site.js'), '--out', site], { stdio: 'pipe' });
const built = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
for (const [file, mode, part] of [['index.html', 'full'], ['kerosene.html', 'level2'], ['kerosene-guided.html', 'level2'], ['ruins.html', 'ruins'],
  ['traps-darts.html','traps','darts'],['traps-spikes.html','traps','spikes'],['traps-blade.html','traps','blade']]) {
  const html = built
    .replace('<head>', '<head><meta name="robots" content="noindex"><script>window.MIXX_NO_BOOT=true;</script>')
    .replace(/\s*<link[^>]+href="https:\/\/fonts\.[^"]+"[^>]*>/g, '')
    .replace('<body>', '<body data-playtest="' + mode + '" data-trap-part="' + (part || '') + '">')
    .replace('</head>', '<style>#btn-account,#btn-title-settings{display:none}</style></head>')
    .replace('</body>', '<script src="js/pc-playtest.js"></script></body>');
  fs.writeFileSync(path.join(site, file), html);
}
fs.writeFileSync(path.join(site, 'js/pc-playtest.js'), `
'use strict';
(() => {
  const mode = document.body.dataset.playtest;
  const part = document.body.dataset.trapPart;
  const prefix = 'mixxtopia.pc-playtest.' + mode + (part ? '-' + part : '') + '.';
  const storage = {
    getItem: key => localStorage.getItem(prefix + key),
    setItem: (key, value) => localStorage.setItem(prefix + key, value),
    removeItem: key => localStorage.removeItem(prefix + key),
  };
  const game = MIXX.main.boot({ storage, auth: null, cloud: null, stats: null });
  if (mode !== 'full') {
    game.levels = game.levels.filter(level => level.id === 2);
    game.scenes = {};
  }
  if (mode === 'ruins' || mode === 'traps') {
    // 仅评审入口预置三灯 / 三星，直接到机关旁；正式数据和存档不变。
    game.levels = game.levels.map(level => ({ ...level,
      corridor: mode === 'traps' ? { ...level.corridor, vents: [] } : level.corridor,
      entities: level.entities.filter(e => e.type !== 'enemy') }));
    const loadLevel = game._loadLevel.bind(game);
    game._loadLevel = (index, opts) => {
      loadLevel(index, opts);
      if (!opts || !opts.restore) {
        for (const lamp of game._entitiesOf('lamp')) {
          lamp.lit = true; lamp.puzzleSolved = true;
          game._playedNodes.add('puzzle:2:lamp:' + lamp.id);
        }
        for (const oil of game._entitiesOf('oil')) {
          oil.taken = true; oil.used = true;
          game._playedNodes.add('puzzle:2:oil:' + oil.id); game._playedNodes.add('puzzle:2:used:' + oil.id);
        }
        for (const star of game._entitiesOf('star').filter(s => !s.requiresRuins)) { star.collected = true; game.collected.push(star.id); }
        game.stars = game.collected.length;
      }
      const start = mode === 'ruins' ? [210,10] : part === 'spikes' ? [90,10] : part === 'blade' ? [161,10] : [26,10];
      game.player = { x: start[0] * 16, y: start[1] * 16 };
      game._syncSwitches(true); game._followCamera(); game._refreshHud();
    };
  }

  document.title = mode === 'level2' ? 'MIXXTOPIA · 长廊机关重做版' : 'MIXXTOPIA · 完整流程 PC 试玩';
  document.querySelector('.title-sub').textContent = mode === 'level2' ? 'Kerosene · 暗器重做版 · 长廊机关' : '序章 → 第一关 → 第二关';
  if (mode === 'ruins') { document.title = 'MIXXTOPIA · 水渠机关试玩'; document.querySelector('.title-sub').textContent = '水渠遗迹 · 机关直达试玩'; }
  if (mode === 'traps') { document.title = 'MIXXTOPIA · 暗器重做版';document.querySelector('.title-sub').textContent = '暗器重做版 · '+({darts:'四排自动箭阵',spikes:'双段地刺与歇脚台',blade:'轨道闸刃与出口制动杆'}[part]); }
  document.querySelector('.title-flavor').textContent = '本地试玩 · 独立存档 · WASD 移动，Shift 闪步，F 轻击 / G 打断，E 互动，Esc 暂停';
  game._refreshTitle();
  window.pcPlaytestGame = game;
})();
`);
fs.writeFileSync(path.join(site, 'START_HERE.txt'), `MIXXTOPIA · PC 本地试玩

推荐引导版：打开 kerosene-guided.html，点击「新游戏」。kerosene.html 同样更新，两个入口共用试玩进度。
完整体验序章、第一关和第二关：打开 index.html。
只试水渠机关：打开 ruins.html，点击「新游戏」；三灯预先完成，从机关旁开始，无敌人干扰，使用独立试玩存档。
只试暗器：分别打开 traps-darts.html / traps-spikes.html / traps-blade.html；每个入口独立存档、预先完成三灯 / 三星，无敌人或蒸汽干扰。

WASD / 方向键移动；E / 空格 / Enter 互动；Esc 暂停。
F 轻击 / G 重击；能量满后再攻击发射能量炮。携带灯油也可攻击。
十处敌人采用近身蓄力 / 落点火圈；Shift 闪步，G 重击打断。蒸汽喷口先黄闪再喷发，也会伤害敌人；点亮新灯柱补满生命并补充 35 能量。倒下回入口满血复起，保留灯油 / 星星 / 点灯进度。
收集三罐灯油，靠近三根灯柱互动开门，找齐四星后进入星光门。
携油靠近灯柱按 E，进入独立光路小游戏：第二根灯柱分成 3 个颜色组，每面只属一组，点击任意成员转动整组；其他灯柱按金框显示的联动范围转动，火光必须按 1→2→… 的编号经过灯芯，再抵达出口。
也可方向键 / WASD 选镜，E / 空格旋转，G 撤销，F 重置；接通后按 E 或点击「点灯返回」。
方向键选择镜面，E 只旋转当前选中，不会自动跳到答案。三个灯柱均可主动按 H / 点「提示」，或 J /「帮一步」执行建议一步；默认只显示操作规则，G 可撤销。仅第二灯改为互不重叠的分组；第一与第三灯恢复原样，初始最短解为 3 / 3 / 8 次。
Esc 或点击「返回长廊」退出，不消耗灯油。退出后可通过暂停菜单保存未完成的旋镜进度。
终段第四颗星由水渠机关锁住：方向键推浮台，E / A 操作水闸和绳柱，H 或点击「观察」查看提示；南侧机关复位。进度随手动存档保存。
保存：Esc → 保存并退出；下次用同一个入口的「继续冒险」。
刷新会放弃尚未保存的进度。两个入口各用自己的三个试玩档位，
与正式版 / 测试版存档分开；本试玩包不连接账户或云端。
音乐在第一次鼠标或键盘操作后解锁；暂停、切到后台、关闭声音时停止。

解压整个文件夹后再打开页面，保留 js/ 与 assets/ 的相对位置。
这是未发布的本地评审包；PC Chrome 自动检查结果见仓库验收记录。
第三关尚未制作，第二关结算会返回标题。
`);
const files = fs.readdirSync(site, { recursive: true }).filter(file => fs.statSync(path.join(site, file)).isFile()).sort();
const hashes = Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(site, file))).digest('hex')]));
fs.writeFileSync(path.join(output, 'files.sha256.json'), JSON.stringify(hashes, null, 2) + '\n');
const archive = path.join(output, folder + '.zip');
execFileSync('python3', ['-c', `
import pathlib, sys, zipfile
site, archive = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for file in sorted(site.rglob('*')):
        if file.is_file(): z.write(file, file.relative_to(site.parent))
with zipfile.ZipFile(archive) as z: assert z.testzip() is None
`, site, archive]);
const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(archive + '.sha256', digest + '  ' + path.basename(archive) + '\n');
console.log(JSON.stringify({ site, archive, files: files.length, bytes: fs.statSync(archive).size, sha256: digest }, null, 2));
