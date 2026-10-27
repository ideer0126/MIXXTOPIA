#!/usr/bin/env node
'use strict';
// Bounded browser smoke against a local PostgreSQL engine. No real cloud I/O.
// Optional tools: MIXX_PLAYWRIGHT_MODULE / MIXX_PGLITE_MODULE (absolute module paths).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require(process.env.MIXX_PLAYWRIGHT_MODULE || 'playwright');
const { PGlite } = require(process.env.MIXX_PGLITE_MODULE || '@electric-sql/pglite');
const repo = path.resolve(__dirname, '..');
const output = process.env.MIXX_STATS_OUTPUT || '/tmp/mixxtopia-stats-smoke';
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const db = new PGlite(), errors = [], requests = [];
  let browser, server, queue = Promise.resolve(), offline = false;
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;`);
    for (const file of ['0001_init.sql', '0002_stats.sql']) await db.exec(fs.readFileSync(path.join(repo, 'supabase/migrations', file), 'utf8'));
    await db.query('insert into auth.users values ($1),($2)', [A, B]);
    server = http.createServer((req, res) => {
      const name = path.resolve(repo, '.' + new URL(req.url, 'http://local').pathname.replace(/\/$/, '/index.html'));
      if (!name.startsWith(repo + path.sep)) { res.writeHead(403).end(); return; }
      fs.readFile(name, (err, body) => {
        if (err) { res.writeHead(404).end(); return; }
        const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' };
        res.writeHead(200, { 'Content-Type': mime[path.extname(name)] || 'application/octet-stream' }); res.end(body);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ executablePath: process.env.MIXX_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
    async function context(uid, mobile) {
      const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
      await ctx.addInitScript(({ uid }) => {
        window.MIXX_NO_BOOT = true;
        window.MIXX_CLOUD_CONFIG = { url: 'https://stats.supabase.co', anonKey: 'sb_publishable_test', timeoutMs: 3000 };
        if (uid) localStorage.setItem('mixxtopia.account.v1', JSON.stringify({ v: 1, accessToken: uid,
          refreshToken: 'unused', expiresAt: Date.now() + 3600000, user: { id: uid, email: 'test@example.com' } }));
      }, { uid });
      await ctx.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      await ctx.route('https://stats.supabase.co/**', async route => {
        if (offline) { await route.abort(); return; }
        const req = route.request(), u = new URL(req.url()), body = req.postDataJSON();
        const owner = req.headers().authorization && req.headers().authorization.replace('Bearer ', '');
        assert.ok([A, B].includes(owner), 'unexpected unauthenticated network request');
        requests.push({ path: u.pathname, method: req.method(), owner });
        const task = queue.then(async () => {
          await db.exec('set role authenticated');
          await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
          try {
            if (u.pathname.endsWith('/rpc/merge_stats')) return (await db.query('select * from public.merge_stats($1,$2,$3)',
              [body.p_writer, body.p_millis, JSON.stringify(body.p_achievements)])).rows;
            if (u.pathname.endsWith('/profiles')) return (await db.query('select nickname,avatar,prefs from public.profiles where id=$1', [owner])).rows;
            if (u.pathname.endsWith('/saves')) {
              if (req.method() === 'GET') {
                const slot = u.searchParams.get('slot');
                return (await db.query('select slot,version,updated_at,data from public.saves where user_id=$1' + (slot ? ' and slot=$2' : ''), slot ? [owner, +slot.slice(3)] : [owner])).rows;
              }
              if (req.method() === 'POST') return (await db.query('insert into public.saves(user_id,slot,version,data) values($1,$2,$3,$4) returning *',
                [owner, body.slot, body.version, JSON.stringify(body.data)])).rows;
              if (req.method() === 'PATCH') return (await db.query('update public.saves set version=$1,data=$2 where user_id=$3 and slot=$4 and version=$5 returning *',
                [body.version, JSON.stringify(body.data), owner, +u.searchParams.get('slot').slice(3), +u.searchParams.get('version').slice(3)])).rows;
            }
            throw Error('unexpected route: ' + u.pathname);
          } finally { await db.exec('reset role'); }
        });
        queue = task.catch(() => {});
        try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await task) }); }
        catch (err) { errors.push(err.message); await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); }
      });
      return ctx;
    }
    async function open(ctx) {
      const page = await ctx.newPage(); page.on('pageerror', err => errors.push(err.message));
      await page.goto(url); await page.evaluate(() => { window.game = MIXX.main.boot(); game.stop(); });
      await settle(page); return page;
    }
    async function settle(page) {
      await page.evaluate(async () => {
        for (let i = 0; i < 3; i++) {
          await Promise.all([game._authReady, game._profileTask, game._cloudTask, game._statsTask, game.stats.task]);
          await Promise.resolve();
        }
      });
    }
    const desktop = await context(A), page = await open(desktop);
    await page.locator('#btn-start').click();
    const measured = await page.evaluate(() => {
      while (game.state === 'dialogue') game._tapDialog();
      game._update(1.25); game._update(1.25);
      const time = game.stats.record.seconds;
      game._setState('paused'); game._update(3);
      game._setState('dialogue'); game._update(3);
      game._setState('playing');
      const star = game.level.entities.find(e => e.type === 'star');
      game.player.x = star.x * 16; game.player.y = star.y * 16; game._checkPickups();
      game._setState('paused'); return { time, after: game.stats.record.seconds };
    });
    assert.equal(measured.time, 2.5); assert.equal(measured.after, 2.5);
    await page.locator('#btn-save-quit').click(); await settle(page);
    await page.locator('#btn-saves').click(); await page.locator('#btn-cloud-merge').click(); await settle(page);
    await page.locator('#btn-save-back').click(); await page.locator('#btn-title-settings').click(); await settle(page);
    assert.match(await page.locator('#stats-collection').innerText(), /1\/3（33%）/);
    assert.match(await page.locator('#stats-time').innerText(), /2 秒/);
    assert.match(await page.locator('#stats-achievements').innerText(), /★ 初见星光/);
    assert.match(await page.locator('#stats-status').innerText(), /已同步/);
    await page.locator('.stats-panel').screenshot({ path: path.join(output, 'desktop.png') });
    console.log('  ✓ desktop: PLAYING-only time / save consent / 33% collection / achievement / UI sync');

    const mobile = await context(A, true), phone = await open(mobile);
    await phone.locator('#btn-title-settings').click(); await settle(phone);
    assert.equal(await phone.locator('#stats-time').innerText(), await page.locator('#stats-time').innerText());
    assert.equal(await phone.locator('#stats-collection').innerText(), await page.locator('#stats-collection').innerText());
    await phone.locator('#btn-settings-back').scrollIntoViewIfNeeded();
    const back = await phone.locator('#btn-settings-back').boundingBox();
    assert.ok(back && back.y >= 0 && back.y + back.height <= 844);
    await phone.locator('.stats-panel').screenshot({ path: path.join(output, 'mobile.png') });
    console.log('  ✓ touch device: cross-device time / collection consistency / scrollable settings');

    offline = true;
    await page.evaluate(() => {
      game._closeSettingsScreen(); game._startNewGame();
      while (game.state === 'dialogue') game._tapDialog();
      game._update(4.75); game._setState('paused'); game._saveAndQuit();
    });
    await settle(page);
    assert.equal(await page.evaluate(() => game.state), 'title');
    assert.ok(await page.evaluate(() => game.stats.view().pending));
    await page.reload(); await page.evaluate(() => { window.game = MIXX.main.boot(); game.stop(); }); await settle(page);
    assert.ok(await page.evaluate(() => game.stats.view().pending));
    offline = false;
    await page.reload(); await page.evaluate(() => { window.game = MIXX.main.boot(); game.stop(); }); await settle(page);
    await page.locator('#btn-title-settings').click(); await settle(page);
    assert.match(await page.locator('#stats-time').innerText(), /7 秒/);
    assert.equal(await page.evaluate(() => game.stats.view().pending), false);
    await phone.locator('#btn-stats-sync').scrollIntoViewIfNeeded(); await phone.locator('#btn-stats-sync').click(); await settle(phone);
    assert.equal(await phone.locator('#stats-time').innerText(), await page.locator('#stats-time').innerText());
    console.log('  ✓ offline save / reload / next-login retry / idempotent cross-device update');

    const other = await context(B), second = await open(other);
    await second.locator('#btn-title-settings').click(); await settle(second);
    assert.match(await second.locator('#stats-time').innerText(), /0 秒/);
    assert.match(await second.locator('#stats-collection').innerText(), /0\/3（0%）/);
    const stale = await open(desktop);
    await page.evaluate(({ B }) => localStorage.setItem('mixxtopia.account.v1', JSON.stringify({ user: { id: B } })), { B });
    await stale.waitForFunction(() => game.stats.suspended);
    assert.equal(await stale.evaluate(() => game.stats.suspended), true);
    console.log('  ✓ separate-account isolation / shared-tab account-switch revocation');

    const guest = await context(''), guestPage = await open(guest), before = requests.length;
    await guestPage.locator('#btn-start').click();
    await guestPage.evaluate(() => {
      while (game.state === 'dialogue') game._tapDialog();
      game._update(1); game._setState('paused'); game._saveAndQuit();
    });
    await settle(guestPage); assert.equal(requests.length, before);
    console.log('  ✓ guest: zero cloud requests');

    // Existing browser smoke suites remain independent of the new stats fixture.
    for (const name of ['smoke-main.html', 'smoke-input.html']) {
      const smoke = await desktop.newPage(); await smoke.goto(url + '/tools/' + name);
      await smoke.waitForFunction(() => document.body.getAttribute('data-smoke'));
      const result = await smoke.evaluate(() => ({ state: document.body.getAttribute('data-smoke'), text: document.body.innerText }));
      assert.equal(result.state, 'ok', result.text);
      console.log('  ✓ existing ' + name + ': ' + (result.text.match(/PASS /g) || []).length + ' PASS');
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, errors, requests: requests.length, measured, screenshots: ['desktop.png', 'mobile.png'] }, null, 2));
    console.log('全部浏览器检查通过；产物：' + output);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await db.close();
  }
})().catch(err => { console.error(err.stack); process.exitCode = 1; });
