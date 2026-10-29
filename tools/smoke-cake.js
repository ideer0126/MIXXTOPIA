#!/usr/bin/env node
'use strict';
// Cake display: balloons, whale, gifts, ground occupancy, and the full Level 1 route.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.MIXX_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..');
const output = process.env.MIXX_CAKE_OUTPUT || '/tmp/mixxtopia-cake';
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
        window.cakeDecorations = game.level.decorations;
      });
      const approaches = {};
      for (const phase of ['before', 'after']) {
        await page.evaluate(phase => {
          game.level.decorations = phase === 'after' ? cakeDecorations : cakeDecorations
            .filter(d => !['cakeWhale', 'cakeBalloons', 'cakeBalloonBase'].includes(d.kind))
            .map(d => d.kind !== 'cakeTable' ? d : { ...d, w: 4.8, occlusionShapes: undefined,
              occlusionShape: [[.18,.04],[.68,.04],[.8,.3],[.99,.35],[1,1],[0,1],[0,.35],[.16,.3]] });
        }, phase);
        approaches[phase] = {};
        for (const [name, x, y, dx, dy] of [['whale', 6.7, 14.1, 0, -.5], ['anchor', 8.5, 12.9, -.5, 0]]) {
          approaches[phase][name] = await page.evaluate(({ x, y, dx, dy }) => {
            game.player = { x: x * 16, y: y * 16 }; game.facing = { x: dx, y: dy };
            if (game.birthday.blockedAt(game.player.x, game.player.y)) throw new Error('Approach starts inside obstacle');
            for (let i = 0; i < 40; i++) game._moveAxis(dx, dy);
            const at = { ...game.player };
            game.birthday.playerMotion = { walking: false, time: 0 }; game._followCamera(); game._render();
            return { ...at, blocked: game.birthday.blockedAt(at.x, at.y) };
          }, { x, y, dx, dy });
          assert.equal(approaches[phase][name].blocked, false);
          await page.locator('#game').screenshot({ path: path.join(output, device + '-' + phase + '-' + name + '.png') });
          assert.ok(await page.evaluate(({ dx, dy }) => {
            const at = { ...game.player }; game._moveAxis(-dx, -dy);
            return game.player.x !== at.x || game.player.y !== at.y;
          }, { dx, dy }), 'Can retreat from the display');
        }
        for (const [name, x, y] of [['balloons', 7.1, 11.3], ['whale-rear', 6.7, 12.2], ['gifts', 5.4, 11.5]]) {
          assert.equal(await page.evaluate(({ x, y }) => {
            game.player = { x: x * 16, y: y * 16 }; game.facing = { x: 0, y: 1 };
            game._followCamera(); game._render(); return game.birthday.blockedAt(game.player.x, game.player.y);
          }, { x, y }), false);
          await page.locator('#game').screenshot({ path: path.join(output, device + '-' + phase + '-' + name + '.png') });
        }
      }
      assert.ok(approaches.after.whale.y > approaches.before.whale.y, 'Whale ground occupancy stops the former overlap');
      assert.ok(approaches.after.anchor.x > approaches.before.anchor.x, 'Balloon anchor stops the former overlap');
      const visual = [];
      for (const [kind, x, y, solid, hole] of [
        ['cakeTable', 5.2, 11.3, [212,413], [236,401]],
        ['cakeWhale', 6.7, 12.2, [263,484], [301,475]],
        ['cakeBalloons', 7.1, 11.3, [285,429], [246,390]],
      ]) {
        const result = await page.evaluate(({ kind, x, y, solid, hole }) => {
          const ctx = game.renderer.ctx, original = game.birthday.drawSprite;
          game.player = { x: x * 16, y: y * 16 }; game._followCamera();
          const detail = ctx.canvas.width / 320;
          const sample = ([sx, sy]) => {
            const probe = document.createElement('canvas'); probe.width = 1; probe.height = 1;
            const pixel = probe.getContext('2d');
            pixel.drawImage(ctx.canvas, Math.round((sx / 1500 * 640 - game.camera.x) * detail),
              Math.round((sy / 1049 * 448 - game.camera.y) * detail), 1, 1, 0, 0, 1, 1);
            return Array.from(pixel.getImageData(0, 0, 1, 1).data);
          };
          game.birthday.drawSprite = function (e, player) { if (!player) original.call(this, e, false); };
          game._render(); const background = sample(solid);
          game.birthday.drawSprite = function (e, player) {
            if (!player) { original.call(this, e, false); return; }
            ctx.fillStyle = '#ff00ff';
            ctx.fillRect(game.player.x + 8 - 20 - game.camera.x, game.player.y + 14 - 40 - game.camera.y, 40, 40);
          };
          game.level.decorations = cakeDecorations.filter(d => d.kind !== kind);
          game._render(); const unmasked = sample(solid), unmaskedHole = sample(hole);
          game.level.decorations = cakeDecorations;
          game._render(); const covered = sample(solid), gap = sample(hole);
          game.birthday.drawSprite = original;
          return { kind, background, covered, unmasked, gap, unmaskedHole };
        }, { kind, x, y, solid, hole });
        assert.deepEqual(result.covered, result.background, kind + ' must cover the actor');
        assert.notDeepEqual(result.covered, result.unmasked, kind + ' probe overlaps the silhouette');
        assert.deepEqual(result.gap, result.unmaskedHole, kind + ' preserves the actor outside its silhouette');
        visual.push(result);
      }
      for (const [side, x, y] of [['cake-rear', 3.8, 11], ['gifts-rear', 5.4, 11.5], ['whale-rear', 6.7, 12.2],
        ['balloons-rear', 7.1, 11.3], ['right', 8.5, 12.5], ['front', 7, 14]]) {
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
      results.push({ device, approaches, visual, poses: 48, playthrough });
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
