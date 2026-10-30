#!/usr/bin/env node
'use strict';
// Local bundled beta artifact, desktop/touch layouts and deterministic Level 1 playthrough.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require(process.env.MIXX_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mixxtopia-bundle-smoke-'));
const output = process.env.MIXX_BUILD_OUTPUT || path.join(repo, '.ds/build-smoke');
(async () => {
  let server, browser;
  const errors = [], checks = [];
  try {
    fs.mkdirSync(output, { recursive: true });
    execFileSync(process.execPath, [path.join(repo, 'tools/build-channels.js'), '--worktree', '--out', temp,
      '--beta-ref', 'worktree', '--beta-label', 'bundle-smoke'], { stdio: 'pipe' });
    server = http.createServer((req, res) => {
      const filename = path.resolve(temp, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
      if (!filename.startsWith(temp + path.sep)) { res.writeHead(403).end(); return; }
      fs.readFile(filename, (err, body) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp' })[path.extname(filename)] || 'application/octet-stream' }).end(body);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ executablePath: process.env.MIXX_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
    for (const [name, viewport, touch] of [['desktop', {width: 1280, height: 900}, false], ['portrait', {width: 390, height: 844}, true], ['landscape', {width: 844, height: 390}, true]]) {
      const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch });
      await context.addInitScript(() => { window.MIXX_CLOUD_CONFIG = { url: '', anonKey: '' }; });
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(base + '/')) return route.continue();
        // Existing optional Google font is stubbed so this smoke stays local.
        if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({status: 200, contentType: 'text/css', body: ''});
        errors.push('Unexpected external request: ' + url); return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(name + ': ' + e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(name + ': ' + msg.text()); });
      page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
      await page.goto(base + '/beta/');
      assert.equal(await page.getAttribute('body', 'data-game-booted'), 'ok');
      await page.locator('#btn-start').waitFor({ state: 'visible' });
      const scripts = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script').map(r => r.name));
      assert.equal(scripts.length, 1);
      assert.match(scripts[0], /\/js\/game-[a-f0-9]{12}\.js$/);
      await page.addInitScript(() => { window.MIXX_NO_BOOT = true; });
      await page.reload();
      await page.addScriptTag({ content: fs.readFileSync(path.join(repo, 'tools/play-level1.js'), 'utf8') });
      await page.evaluate(async () => {
        window.game = MIXX.main.boot(); game.stop();
        if (MIXX.main.SAVE_KEY !== 'mixxtopia.save.beta.v1') throw Error('channel not set before main');
        game._startNewGame(); level1Playthrough.finishDialogue(game);
        await Promise.all(Array.from(game._sceneryImages.values(), image => image.decode()));
        for (const src of [GAME.avatarPresets[0].art, GAME.characters.haewon.portrait, GAME.characters.byeori.portrait]) {
          const image = new Image(); image.src = src; await image.decode();
          if (!image.naturalWidth || !image.naturalHeight) throw Error('Image failed: ' + src);
        }
        game._entryFade = 0; game._render();
      });
      await page.screenshot({ path: path.join(output, name + '-hall.png') });
      const result = await page.evaluate(() => level1Playthrough.playLevel1(game, {
        onBackstage(g) { g._entryFade = 0; g._render(); window.backstage = g.renderer.ctx.canvas.toDataURL('image/png'); }
      }));
      assert.equal(result.stars, 3); assert.equal(result.state, 'clear');
      fs.writeFileSync(path.join(output, name + '-backstage.png'), Buffer.from((await page.evaluate(() => window.backstage)).split(',')[1], 'base64'));
      assert.ok(await page.evaluate(() => !!localStorage.getItem('mixxtopia.save.beta.v1') && !localStorage.getItem('mixxtopia.save.v1')));
      await page.goto(base + '/beta/reset-password.html');
      await page.locator('#recovery-email').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => !!MIXX.main), false);
      assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script').length), 1);
      await page.screenshot({ path: path.join(output, name + '-recovery.png') });
      checks.push(name + ': one JS / boot / WebP / Level 1 clear / beta save isolation / recovery isolation');
      await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, errors }, null, 2) + '\n');
    for (const check of checks) console.log('  ✓ ' + check);
    console.log('Screenshots: ' + output);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, {recursive: true, force: true});
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
