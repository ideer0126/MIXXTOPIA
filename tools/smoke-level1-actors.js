#!/usr/bin/env node
'use strict';
// 本地页面、真实键盘输入与 Canvas；不连接账户服务。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.MIXX_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..');
const output = process.env.MIXX_ACTORS_OUTPUT || '/tmp/mixxtopia-71';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const errors = [], results = [];
  const server = http.createServer((req, res) => {
    const file = path.resolve(repo, '.' + new URL(req.url, 'http://local').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(repo + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.MIXX_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  try {
    for (const touch of [false, true]) {
      const name = touch ? 'touch' : 'desktop';
      const context = await browser.newContext(touch
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 900 } });
      await context.addInitScript(() => { window.MIXX_NO_BOOT = true; });
      await context.route('**/*', route => route.request().url().startsWith(base + '/')
        ? route.continue() : route.fulfill({ status: 200, body: '' }));
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.goto(base);
      await page.addScriptTag({ url: base + '/tools/play-level1.js' });
      await page.evaluate(async () => {
        window.game = MIXX.main.boot(); game.stop();
        game._startNewGame(); level1Playthrough.finishDialogue(game);
        await Promise.all(Array.from(game._sceneryImages.values(), img => img.decode()));
      });
      const approaches = [];
      for (const [key, dx, dy] of [['ArrowUp', 0, -1], ['ArrowDown', 0, 1], ['ArrowLeft', -1, 0], ['ArrowRight', 1, 0]]) {
        await page.evaluate(([dx, dy]) => {
          const e = game.level.entities.find(e => e.id === 'parent-mustard');
          game.player = { x: e.x * 16 - dx * 16, y: e.y * 16 - dy * 16 };
        }, [dx, dy]);
        await page.keyboard.down(key);
        await page.evaluate(() => {
          for (let i = 0; i < 20; i++) { game._update(.05); game.input.endFrame(); }
          game._entryFade = 0; game._followCamera(); game._render();
        });
        await page.keyboard.up(key);
        const approach = await page.evaluate(() => {
          const e = game.level.entities.find(e => e.id === 'parent-mustard');
          return { player: { ...game.player }, guest: { x: e.x * 16, y: e.y * 16 }, target: game._nearInteractable().id };
        });
        assert.equal(approach.target, 'parent-mustard');
        assert.ok(dx ? Math.abs(approach.player.x - approach.guest.x) >= 8 : Math.abs(approach.player.y - approach.guest.y) >= 5);
        approaches.push({ key, ...approach });
        await page.locator('#game').screenshot({ path: path.join(output, name + '-' + key + '.png') });
        if (key === 'ArrowUp') await page.locator('#game').screenshot({ path: path.join(output, name + '-after.png') });
      }
      if (touch) await page.locator('#tbtn-a').tap();
      else { await page.keyboard.press('e'); }
      await page.evaluate(() => { game._update(.05); game.input.endFrame(); });
      assert.equal(await page.evaluate(() => game.state), 'dialogue');
      await page.evaluate(() => level1Playthrough.finishDialogue(game));

      const patrol = await page.evaluate(() => {
        const e = game.level.entities.find(e => e.id === 'child-blue');
        game.player = { x: e.x * 16 - 16, y: e.y * 16 };
        for (let i = 0; i < 20; i++) { game._moveAxis(4, 0); game.birthday.update(.05); }
        const separation = e.x * 16 - game.player.x;
        game._entryFade = 0; game._followCamera(); game._render();
        return { separation, walking: e._walking };
      });
      assert.ok(patrol.separation >= 7);
      assert.equal(patrol.walking, false);
      await page.locator('#game').screenshot({ path: path.join(output, name + '-child.png') });
      await page.evaluate(() => {
        game.player = { x: 20 * 16, y: 15 * 16 };
        const actors = game.level.entities.filter(e => e.type === 'guest' && e.path);
        const ends = new Map(actors.map(e => [e.id, new Set()]));
        for (let i = 0; i < 1000; i++) {
          game.birthday.update(.05);
          for (const e of actors) {
            if (game.birthday.blockedAt(e.x * 16, e.y * 16, e)) throw new Error('巡游人物重叠：' + e.id);
            e.path.forEach(([x, y], j) => { if (Math.hypot(e.x - x, e.y - y) < .02) ends.get(e.id).add(j); });
          }
        }
        for (const e of actors) if (ends.get(e.id).size !== e.path.length) throw new Error('巡游未恢复：' + e.id);
        game._startNewGame(); level1Playthrough.finishDialogue(game);
        for (const [x, y] of [[13, 18], [16, 18], [6, 8], [5, 7], [7, 21]]) level1Playthrough.walkTo(game, x, y);
      });
      const complete = await page.evaluate(() => level1Playthrough.playLevel1(game, {
        onMusic(g) { g._entryFade = 0; g._followCamera(); g._render(); },
        beforePortal(g) {
          for (const id of ['haewon', 'bae', 'jiwoo', 'kyujin']) level1Playthrough.talkTo(g, id);
          g._entryFade = 0; g._followCamera(); g._render();
          window.backstageImage = document.getElementById('game').toDataURL('image/png');
        },
      }));
      assert.deepEqual(complete, { stars: 3, sheep: 1, gateOpen: true, state: 'clear' });
      fs.writeFileSync(path.join(output, name + '-backstage.png'), Buffer.from((await page.evaluate(() => window.backstageImage)).split(',')[1], 'base64'));
      await page.screenshot({ path: path.join(output, name + '-clear.png') });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      results.push({ name, approaches, patrol, complete });
      await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
    console.log('全部通过：四向接近、实际互动、巡游恢复、通道、六位 Muse、三星/唱片/后台/结算；desktop + touch');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
