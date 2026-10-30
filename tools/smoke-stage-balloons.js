#!/usr/bin/env node
'use strict';
// Local browser QA for #72. External requests are stubbed; no account writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.MIXX_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..');
const output = process.env.MIXX_BALLOON_OUTPUT || '/tmp/mixxtopia-72';
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const filename = path.resolve(repo, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!filename.startsWith(repo + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (err, body) => {
      if (err) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' }).end(body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  const errors = [], results = [];
  try {
    browser = await chromium.launch({
      ...(process.env.MIXX_CHROME ? { executablePath: process.env.MIXX_CHROME } : {}),
      headless: true, args: ['--no-sandbox'],
    });
    for (const device of ['desktop', 'touch']) {
      const context = await browser.newContext(device === 'touch'
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 900 } });
      await context.addInitScript(() => window.MIXX_NO_BOOT = true);
      await context.route('**/*', route => route.request().url().startsWith(base + '/')
        ? route.continue() : route.fulfill({ status: 200, body: '' }));
      const page = await context.newPage();
      page.on('pageerror', err => errors.push(err.message));
      page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text()); });
      await page.goto(base);
      await page.addScriptTag({ url: base + '/tools/play-level1.js' });
      await page.evaluate(async () => {
        window.game = MIXX.main.boot(); game.stop(); game._startNewGame(); level1Playthrough.finishDialogue(game);
        await Promise.all(Array.from(game._sceneryImages.values(), img => img.decode()));
        game._entryFade = 0;
        // Reach and leave the stage using production movement and the existing route runner.
        level1Playthrough.walkTo(game, 19, 8);
        level1Playthrough.walkTo(game, 11, 7);
        level1Playthrough.walkTo(game, 19, 8);
        level1Playthrough.walkTo(game, 4, 6);
      });
      const visual = await page.evaluate(() => {
        const ctx = game.renderer.ctx, original = game.birthday.drawSprite;
        // A solid probe reveals both missed balloon pixels and rectangular background cutouts.
        game.player = { x: 10.05 * 16, y: 7.2 * 16 }; game._followCamera();
        const detail = ctx.canvas.width / 320;
        const sample = (x, y) => {
          const probe = document.createElement('canvas'); probe.width = 1; probe.height = 1;
          const pixel = probe.getContext('2d');
          pixel.drawImage(ctx.canvas, Math.round((x / 1500 * 640 - game.camera.x) * detail),
            Math.round((y / 1049 * 448 - game.camera.y) * detail), 1, 1, 0, 0, 1, 1);
          return Array.from(pixel.getImageData(0, 0, 1, 1).data);
        };
        game.birthday.drawSprite = function (e, player) { if (!player) original.call(this, e, false); };
        game._render(); const balloon = sample(397, 240);
        game.birthday.drawSprite = function (e, player) {
          if (!player) { original.call(this, e, false); return; }
          ctx.fillStyle = '#ff00ff';
          ctx.fillRect(game.player.x + 8 - 20 - game.camera.x, game.player.y + 14 - 40 - game.camera.y, 40, 40);
        };
        game._render(); const rear = sample(397, 240), gap = sample(377, 293);
        game.player.y = 7.8 * 16; game._render(); const front = sample(397, 268);
        game.birthday.drawSprite = original;
        return { balloon, rear, gap, front };
      });
      assert.deepEqual(visual.rear, visual.balloon, 'The floating balloon must cover actors behind its anchor');
      assert.deepEqual(visual.gap, [255, 0, 255, 255], 'The empty space beside the strings must preserve the actor');
      assert.deepEqual(visual.front, [255, 0, 255, 255], 'Actors in front of the anchor must cover the balloon');
      const approaches = await page.evaluate(() => {
        const base = game.level.decorations.find(d => d.kind === 'stageBalloonBase').collision;
        const cx = (base.x + base.w / 2) * 16 - 8, cy = (base.y + base.h / 2) * 16 - 11.5;
        // The front side is the stage ledge; approach the base from reachable stage floor.
        return [[0, -24, 0, 1], [24, 0, -1, 0]].map(([ox, oy, dx, dy]) => {
          game.player = { x: cx + ox, y: cy + oy };
          if (game.birthday.blockedAt(game.player.x, game.player.y)) throw new Error('Approach starts inside an obstacle');
          let steps = 0;
          for (; steps < 40; steps++) {
            const before = { ...game.player }; game._moveAxis(dx, dy);
            if (game.player.x === before.x && game.player.y === before.y) break;
            if (game.birthday.blockedAt(game.player.x, game.player.y)) throw new Error('Entered balloon base');
          }
          const blocked = steps < 40, at = { ...game.player };
          game._moveAxis(-dx, -dy);
          return { blocked, canLeave: game.player.x !== at.x || game.player.y !== at.y };
        });
      });
      assert.ok(approaches.every(a => a.blocked && a.canLeave), 'The fixed base must stop movement and allow retreat');
      for (const [side, x, y] of [['rear', 10.05, 5.65], ['front', 10.05, 10.6], ['left', 9.8, 6.4], ['right', 10.95, 6.4]]) {
        for (const [dir, dx, dy] of [['down', 0, 1], ['left', -1, 0], ['right', 1, 0], ['up', 0, -1]]) {
          for (const walking of [false, true]) {
            const blocked = await page.evaluate(({ x, y, dx, dy, walking }) => {
              game.player = { x: x * 16, y: y * 16 }; game.facing = { x: dx, y: dy };
              game.birthday.playerMotion = { walking, time: .15 };
              game._followCamera(); game._render();
              return game.birthday.blockedAt(game.player.x, game.player.y);
            }, { x, y, dx, dy, walking });
            assert.equal(blocked, false, side + ' remains walkable');
            if (device === 'desktop' || dir === 'down') await page.locator('#game').screenshot({
              path: path.join(output, device + '-' + side + '-' + dir + (walking ? '-walk' : '-idle') + '.png'),
            });
          }
        }
      }
      const playthrough = await page.evaluate(() => {
        game._setState('paused'); game._quitToTitle(); game._startNewGame();
        return level1Playthrough.playLevel1(game);
      });
      assert.equal(playthrough.stars, 3); assert.equal(playthrough.state, 'clear');
      await page.locator('#game').screenshot({ path: path.join(output, device + '-clear.png') });
      results.push({ device, visual, approaches, poses: 32, playthrough });
      await context.close();
    }
    assert.deepEqual(errors, [], 'Browser errors and warnings');
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ errors, results }, null, 2));
    console.log(JSON.stringify({ errors, results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
