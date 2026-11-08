#!/usr/bin/env node
'use strict';
// Real keyboard/touch choices, cancellation, save restoration and the final star.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.MIXX_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..');
const output = process.env.MIXX_CONFIRM_OUTPUT || '/tmp/mixxtopia112-confirmation';
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(repo, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(repo + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end(); return; }
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
      res.writeHead(200, { 'Content-Type': type[path.extname(file)] || 'application/octet-stream' }).end(body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  const errors = [], results = [];
  try {
    browser = await chromium.launch({ executablePath: process.env.MIXX_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
    for (const [name, width, height, touch] of [['desktop', 1280, 900, false], ['portrait', 390, 844, true], ['landscape', 844, 390, true]]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
      await context.addInitScript(() => { window.MIXX_NO_BOOT = true; window.MIXX_CLOUD_CONFIG = { url: '', anonKey: '' }; });
      await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.fulfill({ body: '' }));
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(name + ': ' + e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(name + ': ' + msg.text()); });
      await page.goto(base);
      await page.addScriptTag({ url: base + '/tools/play-level1.js' });
      await page.evaluate(async () => {
        window.game = MIXX.main.boot(); game.stop(); game._startNewGame();
        level1Playthrough.playLevel1(game, { onBackstageConfirm: () => false });
        window.progress = JSON.stringify({ played: [...game._playedNodes], stars: game.collected, save: game.saveData });
        await Promise.all([...game._sceneryImages.values()].map(img => img.decode()));
        game._entryFade = 0; game._render();
      });
      assert.match(await page.locator('#dialog-text').textContent(), /暂时无法回到礼堂/);
      for (const button of await page.locator('#dialog-options button').all()) {
        const box = await button.boundingBox();
        assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, name + ': option visible inside viewport');
        assert.ok(box.height >= 44, 'Touch target at least 44px');
      }
      await page.screenshot({ path: path.join(output, name + '-confirmation.png') });
      if (touch) await page.getByRole('button', { name: '再逛一会儿' }).tap();
      else {
        await page.keyboard.press('ArrowDown'); await page.evaluate(() => game.frame(100));
        await page.keyboard.press('e'); await page.evaluate(() => game.frame(150));
      }
      assert.equal(await page.evaluate(() => game.state), 'playing');
      assert.equal(await page.evaluate(() => game._currentArea().id), 'hall');
      assert.equal(await page.evaluate(() => JSON.stringify({ played: [...game._playedNodes], stars: game.collected, save: game.saveData }) === progress), true);
      // Holding the original approach direction after cancelling must not reopen it.
      await page.keyboard.down('ArrowUp');
      await page.evaluate(() => { for (let t = 200; t <= 400; t += 50) game.frame(t); });
      await page.keyboard.up('ArrowUp');
      assert.equal(await page.evaluate(() => game.state), 'playing');
      await page.evaluate(() => {
        const door = game._entitiesOf('roomdoor')[0];
        level1Playthrough.walkTo(game, door.x, door.y + 1);
        level1Playthrough.stepTo(game, door.x, door.y);
      });
      // Exercise actual A-button paging on touch and keyboard paging on desktop.
      for (let i = 0; i < 3 && !await page.evaluate(() => game._dialog.optionsShown); i++) {
        if (touch) await page.locator('#tbtn-a').tap(); else await page.keyboard.press('e');
        await page.evaluate(i => game.frame(500 + i * 50), i);
      }
      assert.equal(await page.evaluate(() => game._dialog.optionsShown), true);
      if (touch) await page.getByRole('button', { name: '进入后台' }).tap();
      else { await page.keyboard.press('e'); await page.evaluate(() => game.frame(700)); }
      assert.deepEqual(await page.evaluate(() => ({ area: game._currentArea().id, arrived: game._playedNodes.has('l1.backstage.arrived'), fade: game._entryFade })),
        { area: 'backstage', arrived: true, fade: 1.4 });
      const result = await page.evaluate(() => {
        game._setState('paused'); game._saveAndQuit(); game._continueGame();
        if (game.state !== 'playing' || game._currentArea().id !== 'backstage') throw Error('Backstage save must restore directly');
        level1Playthrough.talkTo(game, 'lily'); level1Playthrough.talkTo(game, 'sullyoon'); level1Playthrough.talkTo(game, 'byeori');
        const star = game._entitiesOf('star').find(e => e.id === 's3');
        level1Playthrough.walkTo(game, star.x, star.y);
        const portal = game._entitiesOf('portal')[0]; level1Playthrough.walkTo(game, portal.x, portal.y);
        return { stars: game.stars, state: game.state };
      });
      assert.deepEqual(result, { stars: 3, state: 'clear' });
      results.push({ name, ...result }); await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ errors, results }, null, 2));
    console.log(JSON.stringify({ errors, results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
