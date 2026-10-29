#!/usr/bin/env node
'use strict';
// Storage silhouettes, actual approach movement, and the complete Level 1 route.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.MIXX_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..');
const output = process.env.MIXX_STORAGE_OUTPUT || '/tmp/mixxtopia-storage';
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const filename = path.resolve(repo, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!filename.startsWith(repo + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (err, body) => {
      if (err) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
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
        game._entryFade = 0; game._drawInteractionPrompt = () => {};
        window.storageDecorations = game.level.decorations;
      });
      const approaches = {};
      for (const phase of ['before', 'after']) {
        await page.evaluate(phase => {
          game.level.decorations = phase === 'after' ? storageDecorations : storageDecorations
            .filter(d => !['cleaningBucket', 'cleaningRack'].includes(d.kind))
            .map(d => d.kind !== 'spareChairs' ? d : { ...d, w: 3.2, h: 2.48, depth: 6.32,
              occlusionShapes: undefined, collision: { x: 2.2667, y: 5.4133, w: 3.0133, h: .9067 } });
          game.mechanics.staticCollision = MIXX.collision.compile(game.level);
        }, phase);
        approaches[phase] = {};
        for (const [name, x, y, dx, dy] of [['bucket', 3.25, 5.8, -.5, 0], ['mops', 5.5, 6.7, 0, -.5], ['chairs', 4.7, 6.1, 0, -.5]]) {
          approaches[phase][name] = await page.evaluate(({ x, y, dx, dy }) => {
            game.player = { x: x * 16, y: y * 16 }; game.facing = { x: dx, y: dy };
            if (game.birthday.blockedAt(game.player.x, game.player.y)) throw new Error('Approach starts inside obstacle');
            for (let i = 0; i < 32; i++) game._moveAxis(dx, dy);
            const at = { ...game.player };
            game.birthday.playerMotion = { walking: false, time: 0 }; game._followCamera(); game._render();
            return { ...at, blocked: game.birthday.blockedAt(at.x, at.y) };
          }, { x, y, dx, dy });
          assert.equal(approaches[phase][name].blocked, false);
          await page.locator('#game').screenshot({ path: path.join(output, device + '-' + phase + '-' + name + '.png') });
          assert.ok(await page.evaluate(({ dx, dy }) => {
            const at = { ...game.player }; game._moveAxis(-dx, -dy);
            return game.player.x !== at.x || game.player.y !== at.y;
          }, { dx, dy }), 'Can retreat from the object');
        }
      }
      assert.ok(approaches.after.bucket.x > approaches.before.bucket.x, 'Bucket stops the former overlap');
      assert.ok(approaches.after.mops.y > approaches.before.mops.y, 'Crate stops the former overlap');
      const westWall = {};
      for (const phase of ['before', 'after']) {
        westWall[phase] = await page.evaluate(phase => {
          game.level.decorations = phase === 'after' ? storageDecorations
            : storageDecorations.filter(d => d.kind !== 'storageWestWall');
          game.mechanics.staticCollision = MIXX.collision.compile(game.level);
          game.player = { x: 3.25 * 16, y: 4.5 * 16 }; game.facing = { x: -1, y: 0 };
          for (let i = 0; i < 29; i++) game._moveAxis(-1, 0);
          for (let i = 0; i < 21; i++) game._moveAxis(0, 1);
          game._followCamera(); game._render();
          return { ...game.player, footLeft: game.player.x + game.level.party.footprint.x,
            blocked: game.birthday.blockedAt(game.player.x, game.player.y) };
        }, phase);
        await page.locator('#game').screenshot({ path: path.join(output, device + '-wall-' + phase + '.png') });
      }
      // Visible wall foot at source-image x=80, mapped from 1500px to the 640px hall.
      const wallEdge = 80 / 1500 * 640;
      assert.ok(westWall.before.footLeft < wallEdge, 'The former approach enters the visible wall');
      assert.ok(westWall.after.footLeft >= wallEdge, 'The corrected approach stays inside the room');
      assert.equal(westWall.after.blocked, false);
      assert.ok(await page.evaluate(() => {
        if (!game.birthday.blockedAt(1.45 * 16, 5.8 * 16)) return false;
        const x = game.player.x; game._moveAxis(1, 0);
        const canLeave = game.player.x > x;
        game._loadLevel(0); level1Playthrough.finishDialogue(game); game._entryFade = 0;
        if (level1Playthrough.pathTo(game, 2.25, 5.75) !== null) return false;
        level1Playthrough.walkTo(game, 3.25, 5.75);
        level1Playthrough.walkTo(game, 4, 6); level1Playthrough.walkTo(game, 6, 8);
        return canLeave;
      }), 'The former bucket-left point is blocked, and the valid route still enters and leaves storage');
      const visual = await page.evaluate(() => {
        const ctx = game.renderer.ctx, original = game.birthday.drawSprite;
        game.player = { x: 5.5 * 16, y: 4.5 * 16 }; game._followCamera();
        const detail = ctx.canvas.width / 320;
        const sample = (x, y) => {
          const probe = document.createElement('canvas'); probe.width = 1; probe.height = 1;
          const pixel = probe.getContext('2d');
          pixel.drawImage(ctx.canvas, Math.round((x / 1500 * 640 - game.camera.x) * detail),
            Math.round((y / 1049 * 448 - game.camera.y) * detail), 1, 1, 0, 0, 1, 1);
          return Array.from(pixel.getImageData(0, 0, 1, 1).data);
        };
        game.birthday.drawSprite = function (e, player) { if (!player) original.call(this, e, false); };
        game._render(); const wood = sample(225, 172);
        game.birthday.drawSprite = function (e, player) {
          if (!player) { original.call(this, e, false); return; }
          ctx.fillStyle = '#ff00ff';
          ctx.fillRect(game.player.x + 8 - 20 - game.camera.x, game.player.y + 14 - 40 - game.camera.y, 40, 40);
        };
        game.level.decorations = storageDecorations.filter(d => d.kind !== 'cleaningRack');
        game._render(); const unmaskedGap = sample(217, 175), unmaskedWood = sample(225, 172);
        game.level.decorations = storageDecorations;
        game._render(); const coveredWood = sample(225, 172), gap = sample(217, 175);
        const drawProbe = game.birthday.drawSprite;
        game.player = { x: 2 * 16, y: 4.5 * 16 }; game._followCamera();
        game.birthday.drawSprite = function (e, player) { if (!player) original.call(this, e, false); };
        game._render(); const wall = sample(70, 180);
        game.birthday.drawSprite = drawProbe;
        game.level.decorations = storageDecorations.filter(d => d.kind !== 'storageWestWall');
        game._render(); const unmaskedWall = sample(70, 180), unmaskedFloor = sample(83, 177);
        game.level.decorations = storageDecorations;
        game._render(); const coveredWall = sample(70, 180), floor = sample(83, 177);
        game.birthday.drawSprite = original;
        return { wood, unmaskedWood, coveredWood, gap, unmaskedGap, wall, unmaskedWall, coveredWall, floor, unmaskedFloor };
      });
      assert.deepEqual(visual.coveredWood, visual.wood, 'Mop shaft must cover actors behind it');
      assert.notDeepEqual(visual.coveredWood, visual.unmaskedWood);
      assert.deepEqual(visual.gap, visual.unmaskedGap, 'Space between the poles must preserve the actor');
      assert.deepEqual(visual.coveredWall, visual.wall, 'The wall must cover the part of the sprite projecting over it');
      assert.notDeepEqual(visual.coveredWall, visual.unmaskedWall);
      assert.deepEqual(visual.floor, visual.unmaskedFloor, 'The wall silhouette must not erase the actor on the room floor');
      await page.evaluate(() => { game._loadLevel(0); level1Playthrough.finishDialogue(game); game._entryFade = 0; });
      for (const [side, x, y] of [['storage-floor', 4, 6], ['bucket-right', 3.25, 5.75], ['rack-front', 5.5, 6.25]]) {
        assert.ok(await page.evaluate(({ x, y }) => level1Playthrough.pathTo(game, x, y) !== null, { x, y }),
          'Screenshot position must be reachable on the normal storage route');
        for (const [dir, dx, dy] of [['down', 0, 1], ['left', -1, 0], ['right', 1, 0], ['up', 0, -1]]) {
          for (const walking of [false, true]) {
            assert.equal(await page.evaluate(({ x, y, dx, dy, walking }) => {
              game.player = { x: x * 16, y: y * 16 }; game.facing = { x: dx, y: dy };
              game.birthday.playerMotion = { walking, time: .15 }; game._followCamera(); game._render();
              return game.birthday.blockedAt(game.player.x, game.player.y);
            }, { x, y, dx, dy, walking }), false);
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
      results.push({ device, approaches, westWall, visual, poses: 24, playthrough });
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
