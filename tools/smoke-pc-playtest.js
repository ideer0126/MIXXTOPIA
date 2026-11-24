#!/usr/bin/env node
/** 对解压后的 PC 包验收：真实动画循环/键盘、缩放、整页读档和 file:// 离线。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.MIXX_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..'), output = path.join(repo, '.ds/pc-playtest');

(async () => {
  execFileSync(process.execPath, [path.join(__dirname, 'build-pc-playtest.js')], { stdio: 'pipe' });
  const extracted = path.join(output, 'extracted');
  fs.rmSync(extracted, { recursive: true, force: true });
  execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])', path.join(output, 'MIXXTOPIA-PC-Playtest.zip'), extracted]);
  const site = path.join(extracted, 'MIXXTOPIA-PC-Playtest');
  const hashes = JSON.parse(fs.readFileSync(path.join(output, 'files.sha256.json')));
  const files = fs.readdirSync(site, { recursive: true }).filter(file => fs.statSync(path.join(site, file)).isFile()).sort();
  assert.deepEqual(files, Object.keys(hashes).sort());
  for (const [file, digest] of Object.entries(hashes)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(site, file))).digest('hex'), digest, file);
  const server = http.createServer((req, res) => {
    const file = path.resolve(site, '.' + new URL(req.url, 'http://local').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(site + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' })[path.extname(file)] || 'application/octet-stream' }).end(body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.MIXX_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  const errors = [], results = [];
  try {
    for (const [name, width, height, dpr, offline] of [['laptop', 1280, 720, 1, false], ['hidpi', 1920, 1080, 1.5, false], ['small-window', 960, 540, 2, false], ['offline-file', 1280, 720, 1, true]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, offline });
      await context.addInitScript(() => { localStorage.setItem('mixxtopia.save.v1', 'original-save-sentinel'); });
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(base + '/') || url.startsWith('file:')) return route.continue();
        errors.push(name + ': external request ' + url); return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(name + ': ' + e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(name + ': ' + msg.text()); });
      const url = offline ? pathToFileURL(path.join(site, 'kerosene-guided.html')).href : base + '/kerosene-guided.html';
      await page.goto(url);
      assert.match(await page.locator('.title-sub').textContent(), /暗器重做版/);
      assert.equal(await page.evaluate(() => MIXX.audio.musicState().playing), false);
      await page.locator('#btn-start').click();
      await page.waitForFunction(() => pcPlaytestGame.state === 'playing' && MIXX.audio.musicState().playing);
      assert.equal(await page.evaluate(() => pcPlaytestGame.level.id), 2);
      const before = await page.evaluate(() => ({ ...pcPlaytestGame.player }));
      await page.keyboard.down('w');
      await page.waitForFunction(y => pcPlaytestGame.player.y < y - 4, before.y);
      await page.keyboard.up('w');
      await page.keyboard.down('ArrowRight');
      await page.waitForFunction(x => pcPlaytestGame.player.x > x + 4, before.x);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.deepEqual(await page.evaluate(() => pcPlaytestGame.input.getAxis()), { x: 0, y: 0 });
      await page.keyboard.up('ArrowRight');
      await page.keyboard.press('Escape'); await page.waitForFunction(() => pcPlaytestGame.state === 'paused');
      assert.equal(await page.evaluate(() => MIXX.audio.musicState().playing), false);
      await page.locator('#btn-restart').click();
      await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'play-level1.js'), 'utf8') });
      await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'play-level2.js'), 'utf8') });
      if (name === 'laptop') {
        await page.evaluate(() => {
          window.game = pcPlaytestGame; game.stop(); window.combatAttacks = [];
          game.onEvent = (name, payload) => { if (name === 'attack') combatAttacks.push(payload); };
          const e = game.level.entities.find(e => e.id === 'l2-ember-entry');
          level1Playthrough.walkTo(game, e.x, e.y + 2); game.start();
        });
        await page.keyboard.down('ArrowUp'); await page.waitForFunction(() => game.combat.facing.y === -1); await page.keyboard.up('ArrowUp');
        await page.waitForFunction(() => !!game.combat.findTarget(game.player, game.combat.attackRange, game.mechanics));
        await page.evaluate(() => { game.stop(); game._render(); });
        await page.screenshot({ path: path.join(output, 'combat-encounter.png') });
        await page.evaluate(() => game.start());
        await page.keyboard.press('f'); await page.waitForFunction(() => game.combat.enemies[0].hp === 2);
        await page.waitForFunction(() => game.combat.cooldown <= 0 && !!game.combat.findTarget(game.player, game.combat.attackRange, game.mechanics));
        await page.keyboard.press('g'); await page.waitForFunction(() => game.combat.enemies[0].dead);
        await page.evaluate(() => { game.stop(); game._render(); });
        await page.locator('#game').screenshot({ path: path.join(output, 'combat-heavy.png') });
        await page.evaluate(() => {
          level2Playthrough.walkToEntity(game, 'oil1'); level2Playthrough.solveLantern(game, 'lamp1'); level2Playthrough.walkToEntity(game, 'lamp1'); game._interact();
          const e = game.level.entities.find(e => e.id === 'l2-ember-oil');
          level1Playthrough.walkTo(game, e.x - 2, e.y);
          game.combat.energy = game.combat.maxEnergy; game.combat.cooldown = 0; game.start(); // 满能量测试夹具
        });
        await page.keyboard.down('ArrowRight'); await page.waitForFunction(() => game.combat.facing.x === 1); await page.keyboard.up('ArrowRight');
        await page.keyboard.press('f'); await page.waitForFunction(() => game.combat.enemies[1].dead);
        assert.equal(await page.evaluate(() => game.combat.energy), 0);
        await page.evaluate(() => { game.stop(); game._render(); });
        await page.locator('#game').screenshot({ path: path.join(output, 'combat-cannon.png') });
        await page.evaluate(() => {
          level2Playthrough.walkToEntity(game, 's2_1'); level2Playthrough.walkToEntity(game, 'oil2');
          game.combat.resetEnemies();
          const attacker = game.level.entities.find(e => e.id === 'l2-wisp-gallery');
          level1Playthrough.walkTo(game, attacker.x, attacker.y + 2);
          game.combat.hp = 1; game.combat.invuln = 0; game.start(); // 在敌人警戒区内等待实际攻击伤害
        });
        await page.waitForFunction(() => game.combat.hp === 10 && game.combat.invuln > 0);
        const respawn = await page.evaluate(() => ({ oil: game.carriedOil.id, star: game.collected.includes('s2_1'), lit: game._entitiesOf('lamp')[0].lit, x: game.player.x, y: game.player.y }));
        const spawn = await page.evaluate(() => game._entitiesOf('spawn')[0]);
        assert.deepEqual(respawn, { oil: 'oil2', star: true, lit: true, x: spawn.x * 16, y: spawn.y * 16 });
        assert.deepEqual(await page.evaluate(() => combatAttacks.map(a => a.kind)), ['light', 'heavy', 'cannon']);
        await page.keyboard.press('Escape'); await page.waitForFunction(() => game.state === 'paused');
        await page.locator('#btn-restart').click();
        results.push({ name: 'native-combat', attacks: ['F light', 'G heavy', 'charged F cannon'], respawn });
      }
      await page.evaluate(() => {
        window.game = pcPlaytestGame; game.stop(); level2Playthrough.walkToEntity(game, 'lamp1'); game.start();
      });
      await page.keyboard.press('e'); await page.waitForFunction(() => pcPlaytestGame.state === 'dialogue');
      await page.keyboard.press(' '); await page.waitForFunction(() => !pcPlaytestGame._dialog.typing);
      const layout = await page.evaluate(() => {
        const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
        return { canvas: rect('game'), dialog: rect('dialog'), hud: rect('hud'), width: innerWidth, height: innerHeight, touchVisible: getComputedStyle(document.getElementById('touch-controls')).display !== 'none' };
      });
      for (const r of [layout.canvas, layout.dialog, layout.hud]) assert.ok(r.x >= -1 && r.y >= -1 && r.right <= width + 1 && r.bottom <= height + 1, JSON.stringify(layout));
      assert.equal(layout.touchVisible, false);
      await page.screenshot({ path: path.join(output, name + '-dialog.png') });
      await page.keyboard.press('Enter'); await page.waitForFunction(() => pcPlaytestGame.state === 'playing');
      await page.evaluate(() => { game.stop(); level2Playthrough.walkToEntity(game, 'oil1'); });
      assert.equal(await page.evaluate(() => game.carriedOil.id), 'oil1');
      await page.evaluate(() => { level2Playthrough.walkToEntity(game, 'lamp1'); game.start(); });
      await page.keyboard.press('e'); await page.waitForFunction(() => game.state === 'puzzle');
      const frozen = await page.evaluate(() => ({ hp: game.combat.hp, energy: game.combat.energy, enemies: JSON.stringify(game.combat.enemies), player: JSON.stringify(game.player) }));
      const initialAngles = await page.evaluate(() => game.lantern.angles.slice());
      assert.equal(await page.evaluate(() => game.lantern.hint), null);
      await page.keyboard.press('h'); await page.waitForFunction(() => !!game.lantern.hint);
      assert.equal(await page.evaluate(() => game.lantern.selected), 0);
      await page.keyboard.press('j'); await page.waitForFunction(() => game.lantern.moves === 1);
      await page.keyboard.press('g'); await page.waitForFunction(() => game.lantern.moves === 0);
      for (let press = 1; press <= 10; press++) {
        await page.keyboard.press('e'); await page.waitForFunction(count => game.lantern.moves === count, press);
        assert.equal(await page.evaluate(() => game.lantern.selected), 0);
        assert.equal(await page.evaluate(() => game.lantern.result.solved), false);
      }
      assert.deepEqual(await page.evaluate(() => game.lantern.angles.slice()), initialAngles);
      await page.keyboard.press('f'); await page.waitForFunction(() => game.lantern.moves === 0);
      await page.screenshot({ path: path.join(output, name + '-light-manual.png') });
      const mirror = await page.evaluate(() => {
        const r = game.canvas.getBoundingClientRect(), b = game.lantern, g = b.geometry(), m = b.config.mirrors[0];
        return { x: r.x + (g.x + (m.x + .5) * g.cell) * r.width / 320, y: r.y + (g.y + (m.y + .5) * g.cell - 4) * r.height / 224 };
      });
      await page.mouse.click(mirror.x, mirror.y);
      await page.waitForFunction(() => game.lantern.moves === 1);
      const undoPoint = await page.evaluate(() => {
        const r = game.canvas.getBoundingClientRect(); return { x: r.x + 240 * r.width / 320, y: r.y + 156 * r.height / 224 };
      });
      await page.mouse.click(undoPoint.x, undoPoint.y); await page.waitForFunction(() => game.lantern.moves === 0);
      assert.deepEqual(await page.evaluate(() => game.lantern.angles.slice()), initialAngles);
      await page.mouse.click(mirror.x, mirror.y); await page.waitForFunction(() => game.lantern.moves === 1);
      const partialAngles = await page.evaluate(() => game.lantern.angles.slice());
      assert.equal(await page.evaluate(() => game.lantern.result.solved), false);
      assert.deepEqual(await page.evaluate(() => ({ hp: game.combat.hp, energy: game.combat.energy, enemies: JSON.stringify(game.combat.enemies), player: JSON.stringify(game.player) })), frozen);
      assert.equal(await page.locator('#hud').isVisible(), false);
      await page.screenshot({ path: path.join(output, name + '-light-puzzle.png') });
      await page.keyboard.press('Escape'); await page.waitForFunction(() => game.state === 'playing');
      assert.equal(await page.evaluate(() => game.carriedOil.id), 'oil1');
      assert.equal(await page.evaluate(() => game._entitiesOf('lamp')[0].lit), false);
      await page.setViewportSize({ width: 820, height: 500 });
      await page.setViewportSize({ width, height });
      await page.keyboard.press('Escape'); await page.waitForFunction(() => game.state === 'paused');
      await page.locator('#btn-save-quit').click();
      await page.reload(); await page.locator('#btn-continue').click();
      await page.waitForFunction(() => pcPlaytestGame.state === 'playing');
      assert.equal(await page.evaluate(() => pcPlaytestGame.carriedOil.id), 'oil1');
      await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'play-level1.js'), 'utf8') });
      await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'play-level2.js'), 'utf8') });
      await page.evaluate(() => { window.game = pcPlaytestGame; game.stop(); level2Playthrough.walkToEntity(game, 'lamp1'); game.start(); });
      await page.keyboard.press('e'); await page.waitForFunction(() => game.state === 'puzzle');
      assert.deepEqual(await page.evaluate(() => game.lantern.angles.slice()), partialAngles, '整页刷新恢复全部联动镜面');
      await page.keyboard.press('ArrowUp'); await page.waitForFunction(() => game.lantern.selected === 1);
      await page.keyboard.press('e'); await page.waitForFunction(() => game.lantern.moves === 1);
      assert.equal(await page.evaluate(() => game.lantern.result.solved), false);
      const plan = await page.evaluate(() => {
        const b = game.lantern, flipped = b.angles.map((a, i) => a !== b.config.mirrors[i].angle ? i : -1).filter(i => i >= 0);
        return MIXX.LanternPuzzle.solution(b.config, flipped);
      });
      for (const index of plan) {
        const point = await page.evaluate(index => {
          const b = game.lantern, m = b.config.mirrors[index], g = b.geometry(), r = game.canvas.getBoundingClientRect();
          return { x: r.x + (g.x + (m.x + .5) * g.cell) * r.width / 320, y: r.y + (g.y + (m.y + .5) * g.cell) * r.height / 224, moves: b.moves };
        }, index);
        await page.mouse.click(point.x, point.y);
        await page.waitForFunction(moves => game.lantern.moves === moves + 1, point.moves);
      }
      assert.equal(await page.evaluate(() => game.lantern.result.solved), true);
      await page.screenshot({ path: path.join(output, name + '-light-solved.png') });
      await page.keyboard.press('e'); await page.waitForFunction(() => game.state === 'playing' && game._entitiesOf('lamp')[0].lit);
      assert.equal(await page.evaluate(() => game.carriedOil), null);
      await page.keyboard.press('Escape'); await page.waitForFunction(() => game.state === 'paused');
      await page.locator('#btn-save-quit').click();
      await page.reload(); await page.locator('#btn-continue').click();
      await page.waitForFunction(() => pcPlaytestGame.state === 'playing');
      assert.deepEqual(await page.evaluate(() => ({ oil: pcPlaytestGame.carriedOil, lit: pcPlaytestGame._entitiesOf('lamp')[0].lit, open: pcPlaytestGame._entitiesOf('gate')[0].open })), { oil: null, lit: true, open: true });
      await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'play-level1.js'), 'utf8') });
      await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'play-level2.js'), 'utf8') });
      if (name === 'laptop') {
        await page.evaluate(() => {
          window.game = pcPlaytestGame; game.stop(); level2Playthrough.walkToEntity(game, 'oil2'); level2Playthrough.walkToEntity(game, 'lamp2');
          level2Playthrough.fightNearby(game); game._interact(); game.start();
        });
        await page.waitForFunction(() => game.state === 'puzzle');
        await page.keyboard.press('j'); await page.waitForFunction(() => game.lantern.moves === 1);
        await page.keyboard.press('g'); await page.waitForFunction(() => game.lantern.moves === 0);
        const secondInitial = await page.evaluate(() => game.lantern.angles.slice());
        await page.screenshot({ path: path.join(output, 'second-lamp-groups.png') });
        const secondMirror = await page.evaluate(() => {
          const b = game.lantern, m = b.config.mirrors[0], g = b.geometry(), r = game.canvas.getBoundingClientRect();
          return { x: r.x + (g.x + (m.x + .5) * g.cell) * r.width / 320, y: r.y + (g.y + (m.y + .5) * g.cell) * r.height / 224 };
        });
        await page.mouse.click(secondMirror.x, secondMirror.y); await page.waitForFunction(() => game.lantern.moves === 1);
        assert.deepEqual(await page.evaluate(before => game.lantern.angles.map((a, i) => a !== before[i] ? i : -1).filter(i => i >= 0), secondInitial), [0, 2, 4]);
        await page.keyboard.press('g'); await page.waitForFunction(() => game.lantern.moves === 0);
        assert.deepEqual(await page.evaluate(() => game.lantern.angles.slice()), secondInitial);

        for (let press = 1; press <= 8; press++) {
          await page.keyboard.press('e'); await page.waitForFunction(count => game.lantern.moves === count, press);
          assert.equal(await page.evaluate(() => game.lantern.selected), 0); assert.equal(await page.evaluate(() => game.lantern.result.solved), false);
        }
        assert.deepEqual(await page.evaluate(() => game.lantern.angles.slice()), secondInitial);
        await page.evaluate(() => {
          game.stop(); level2Playthrough.solveLantern(game, 'lamp2'); game._interact();
          level2Playthrough.walkToEntity(game, 'oil3'); level2Playthrough.walkToEntity(game, 'lamp3');
          level2Playthrough.fightNearby(game); game._interact(); game.start();
        });
        await page.waitForFunction(() => game.state === 'puzzle' && game._lanternLamp.id === 'lamp3');
        assert.equal(await page.evaluate(() => game.lantern.hint), null);
        await page.keyboard.press('e'); await page.waitForFunction(() => game.lantern.moves === 1);
        await page.keyboard.press('e'); await page.waitForFunction(() => game.lantern.moves === 2);
        assert.equal(await page.evaluate(() => game.lantern.selected), 0); assert.equal(await page.evaluate(() => game.lantern.result.solved), false);
        const hintPoint = await page.evaluate(() => { const r = game.canvas.getBoundingClientRect(); return { x: r.x + 233 * r.width / 320, y: r.y + 23 * r.height / 224 }; });
        await page.mouse.click(hintPoint.x, hintPoint.y); await page.waitForFunction(() => !!game.lantern.hint);
        assert.equal(await page.evaluate(() => game.lantern.selected), 0, '第三灯提示不会替玩家改选');
        await page.screenshot({ path: path.join(output, 'third-lamp-optional-hint.png') });
        await page.keyboard.press('j'); await page.waitForFunction(() => game.lantern.moves === 3);
        assert.equal(await page.evaluate(() => game.lantern.selected), 1, 'J 明确执行求解器建议');
        await page.keyboard.press('e'); await page.waitForFunction(() => game.lantern.moves === 4);
        assert.equal(await page.evaluate(() => game.lantern.selected), 1, 'J 后 E 仍只转当前组选中');
        assert.equal(await page.evaluate(() => game.lantern.result.solved), false);
        await page.keyboard.press('g'); await page.waitForFunction(() => game.lantern.moves === 3);
        await page.keyboard.press('g'); await page.waitForFunction(() => game.lantern.moves === 2);
        const helpPoint = await page.evaluate(() => { const r = game.canvas.getBoundingClientRect(); return { x: r.x + 280 * r.width / 320, y: r.y + 23 * r.height / 224 }; });
        await page.mouse.click(helpPoint.x, helpPoint.y); await page.waitForFunction(() => game.lantern.moves === 3);
      }
      const clear = await page.evaluate(() => {
        window.game = pcPlaytestGame; game.stop(); game._setState(MIXX.main.STATE.PAUSED); game._restartLevel();
        return level2Playthrough.playLevel2(game);
      });
      assert.equal(clear.stars, 4); assert.equal(clear.lamps, 3); assert.equal(clear.state, 'clear');
      assert.equal(await page.evaluate(() => localStorage.getItem('mixxtopia.save.v1')), 'original-save-sentinel');
      assert.equal(await page.evaluate(() => MIXX.audio.musicState().playing), false);
      results.push({ name, width, height, dpr, offline, layout, clear });
      // 同一解压包的完整入口：旧版第一关通关档仍可再次进门衔接第二关。
      if (name === 'laptop') {
        await page.goto(base + '/index.html'); await page.locator('#btn-start').click();
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'play-level1.js'), 'utf8') });
        await page.evaluate(() => {
          window.game = pcPlaytestGame; game.stop(); level1Playthrough.playLevel1(game);
          const legacy = game.store.readSlot(0); legacy.current = 1; legacy.unlocked = 1;
          game.store.writeSlot(0, legacy);
        });
        await page.reload(); await page.locator('#btn-continue').click();
        await page.waitForFunction(() => pcPlaytestGame.level?.id === 1);
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'play-level1.js'), 'utf8') });
        await page.evaluate(() => {
          window.game = pcPlaytestGame; game.stop();
          const portal = game._entitiesOf('portal')[0]; level1Playthrough.walkTo(game, portal.x, portal.y);
          if (game.store.readSlot(0).current !== 2) throw Error('旧通关档没有解锁第二关');
          game._nextFromClear(); if (game.level.id !== 2) throw Error('第一关衔接失败');
        });
        assert.equal(await page.evaluate(() => localStorage.getItem('mixxtopia.save.v1')), 'original-save-sentinel');
      }
      await context.close();
    }
    const ruinsContext = await browser.newContext({ viewport:{width:1280,height:900}, offline:true });
    const ruinsPage = await ruinsContext.newPage();
    ruinsPage.on('pageerror', e => errors.push('ruins-preview: '+e.message));
    await ruinsPage.goto(pathToFileURL(path.join(site,'ruins.html')).href);
    await ruinsPage.locator('#btn-start').click();
    await ruinsPage.waitForFunction(() => pcPlaytestGame.ruins && pcPlaytestGame.stars===3);
    for (const file of ['play-level1.js','play-level2.js']) await ruinsPage.addScriptTag({content:fs.readFileSync(path.join(__dirname,file),'utf8')});
    assert.equal(await ruinsPage.evaluate(() => pcPlaytestGame.combat.aliveCount()),0);
    assert.equal(await ruinsPage.evaluate(() => pcPlaytestGame.player.x),210*16);
    assert.equal(await ruinsPage.evaluate(() => pcPlaytestGame.ruins.solved),false);
    await ruinsPage.evaluate(() => { const g=pcPlaytestGame;g.stop();level2Playthrough.solveRuins(g);g._setState('paused');g._saveAndQuit(); });
    await ruinsPage.reload();await ruinsPage.locator('#btn-continue').click();
    await ruinsPage.waitForFunction(() => pcPlaytestGame.ruins?.solved);
    assert.equal(await ruinsPage.evaluate(() => pcPlaytestGame.combat.aliveCount()),0);
    assert.equal(await ruinsPage.evaluate(() => pcPlaytestGame.player.x),210*16);
    await ruinsContext.close();
    results.push({name:'ruins-preview',offline:true,solved:true,restored:true});
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({ browser: browser.version(), filesVerified: Object.keys(hashes).length, results, errors }, null, 2));
    console.log('Passed: PC keyboard/live RAF, DPR 1/1.5/2, resize, full-page save reload, legacy Level 1 transition, isolated saves, linked light puzzle mouse/keyboard/undo/reset/frozen combat and offline file://; verified ' + Object.keys(hashes).length + ' extracted files.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(err => { console.error(err); process.exitCode = 1; });
