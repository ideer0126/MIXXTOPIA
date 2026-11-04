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
      let imageRequests = [];
      page.on('request', request => { if (request.url().includes('/assets/')) imageRequests.push(request.url()); });
      page.on('pageerror', e => errors.push(name + ': ' + e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(name + ': ' + msg.text()); });
      page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
      await page.goto(base + '/beta/');
      assert.equal(await page.getAttribute('body', 'data-game-booted'), 'ok');
      await page.locator('#btn-start').waitFor({ state: 'visible' });
      assert.deepEqual(imageRequests, [], 'Title must not request any scene or avatar image');
      const scripts = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script').map(r => r.name));
      assert.equal(scripts.length, 1);
      assert.match(scripts[0], /\/js\/game-[a-f0-9]{12}\.js$/);
      await page.addInitScript(() => { window.MIXX_NO_BOOT = true; });
      await page.reload();
      await page.addScriptTag({ content: fs.readFileSync(path.join(repo, 'tools/play-level1.js'), 'utf8') });
      await page.evaluate(async () => {
        window.game = MIXX.main.boot(); game.stop();
        if (MIXX.main.SAVE_KEY !== 'mixxtopia.save.beta.v1') throw Error('channel not set before main');
        game._startNewGame();
        if (game._sceneryImages.size) throw Error('Prologue must not preload level textures');
        await game._sceneImages.get('p0').decode();
        game._render();
      });
      assert.ok(!imageRequests.some(url => url.includes('/scenes/level1/')));
      await page.screenshot({ path: path.join(output, name + '-prologue.png') });
      await page.evaluate(async () => {
        level1Playthrough.finishDialogue(game);
        if (game._sceneryImages.has(game.level.sceneryAssets.ringsBooth) || game._sceneryImages.has(game.level.sceneryAssets.vanityModules)) throw Error('Hall preloaded a later scene');
        await Promise.all(Array.from(game._sceneryImages.values(), image => image.decode()));
        for (const src of [GAME.avatarPresets[0].art, GAME.characters.haewon.portrait, GAME.characters.byeori.portrait]) {
          const image = new Image(); image.src = MIXX_RUNTIME_IMAGES?.[src]?.src || src; await image.decode();
          if (!image.naturalWidth || !image.naturalHeight) throw Error('Image failed: ' + src);
        }
        game._entryFade = 0; game._render();
      });
      await page.screenshot({ path: path.join(output, name + '-hall.png') });
      await page.evaluate(async () => {
        game.birthday.startRings();
        await Promise.all(Array.from(game._sceneryImages.values(), image => image.decode()));
        game._render();
      });
      await page.screenshot({ path: path.join(output, name + '-rings.png') });
      await page.evaluate(() => { game.birthday.rings = null; });
      const result = await page.evaluate(() => level1Playthrough.playLevel1(game, {
        onBackstage(g) { g._setState(MIXX.main.STATE.PAUSED); g._saveAndQuit(); window.backstageSave = localStorage.getItem(MIXX.main.SAVE_KEY); g._continueGame(); }
      }));
      assert.equal(result.stars, 3); assert.equal(result.state, 'clear');

      assert.ok(await page.evaluate(() => !!localStorage.getItem('mixxtopia.save.beta.v1') && !localStorage.getItem('mixxtopia.save.v1')));
      await page.evaluate(() => localStorage.setItem(MIXX.main.SAVE_KEY, window.backstageSave));
      imageRequests = [];
      await page.reload();
      await page.evaluate(async () => {
        window.game = MIXX.main.boot(); game.stop(); game._continueGame();
        if (game._currentArea().id !== 'backstage') throw Error('Save did not resume backstage');
        if (game._sceneryImages.has(game.level.sceneryAssets.birthdayHall) || game._sceneryImages.has(game.level.sceneryAssets.ringsBooth) || game._sceneImages.size) throw Error('Backstage save loaded another scene');
        await Promise.all(Array.from(game._sceneryImages.values(), image => image.decode()));
        game._entryFade = 0; game._render();
      });
      assert.ok(imageRequests.every(url => url.includes('/assets/runtime/')));
      assert.ok(!imageRequests.some(url => /birthday-hall|rings-|p0-bedroom/.test(url)));
      await page.screenshot({ path: path.join(output, name + '-backstage.png') });
      await page.evaluate(async () => {
        game._setState(MIXX.main.STATE.PAUSED); game._restartLevel();
        if (game._currentArea().id !== 'hall') throw Error('Replay did not return to hall');
        await Promise.all(Array.from(game._sceneryImages.values(), image => image.decode()));
      });
      const imageCounts = imageRequests.reduce((counts, url) => (counts[url] = (counts[url] || 0) + 1, counts), {});
      assert.ok(Object.values(imageCounts).every(count => count === 1), 'Replay must reuse shared textures');
      await page.goto(base + '/beta/reset-password.html');
      await page.locator('#recovery-email').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => !!MIXX.main), false);
      assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script').length), 1);
      await page.screenshot({ path: path.join(output, name + '-recovery.png') });
      checks.push(name + ': title zero images / staged WebP / Level 1 clear / backstage resume / replay cache / recovery isolation');
      await context.close();
    }
    const missing = await browser.newContext({viewport: {width: 1280, height: 900}});
    await missing.addInitScript(() => { window.MIXX_NO_BOOT = true; window.MIXX_CLOUD_CONFIG = {url: '', anonKey: ''}; });
    await missing.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(base + '/') && url.endsWith('.webp')) return route.fulfill({status: 200, contentType: 'image/webp', body: 'broken image'});
      if (url.startsWith(base + '/')) return route.continue();
      return route.fulfill({status: 200, contentType: 'text/css', body: ''});
    });
    const brokenPage = await missing.newPage();
    brokenPage.on('pageerror', error => errors.push('missing textures: ' + error.message));
    await brokenPage.goto(base + '/beta/');
    await brokenPage.addScriptTag({content: fs.readFileSync(path.join(repo, 'tools/play-level1.js'), 'utf8')});
    await brokenPage.evaluate(() => {
      window.game = MIXX.main.boot(); game.stop(); game._startNewGame();
      level1Playthrough.finishDialogue(game); game.birthday.startRings();
    });
    await brokenPage.waitForFunction(() => game._sceneryImages.size === 0);
    const fallback = await brokenPage.evaluate(() => {
      game._update(.05); game._render();
      const time = game.birthday.rings.time;
      game._setState(MIXX.main.STATE.PAUSED); game._setState(MIXX.main.STATE.PLAYING);
      game._update(.05); game._render();
      return {time, resumed: game.birthday.rings.time, state: game.state};
    });
    assert.ok(fallback.resumed > fallback.time);
    assert.equal(fallback.state, 'playing');
    await brokenPage.screenshot({path: path.join(output, 'missing-textures-rings.png')});
    checks.push('missing textures: prologue / hall / visible ring fallback / pause-resume');
    await missing.close();
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
