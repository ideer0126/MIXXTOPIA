#!/usr/bin/env node
'use strict';
// Local beta artifact + intercepted Auth requests only. Never sends real email.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require(process.env.MIXX_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..');
const output = process.env.MIXX_RECOVERY_OUTPUT || '/tmp/mixxtopia-password-recovery';
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'mixxtopia-recovery-site-'));
const user = { id: '11111111-1111-1111-1111-111111111111', email: 'recovery@example.com' };
(async () => {
  let server, browser;
  const errors = [], checks = [];
  try {
    fs.mkdirSync(output, { recursive: true });
    execFileSync(process.execPath, [path.join(repo, 'tools/build-channels.js'), '--worktree', '--out', build,
      '--beta-ref', 'worktree', '--beta-label', 'password-recovery'], { stdio: 'pipe' });
    server = http.createServer((req, res) => {
      const filename = path.resolve(build, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
      if (!filename.startsWith(build + path.sep)) { res.writeHead(403).end(); return; }
      fs.readFile(filename, (err, body) => {
        if (err) { res.writeHead(404).end(); return; }
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
        res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' }).end(body);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ executablePath: process.env.MIXX_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
    for (const device of ['desktop', 'touch']) {
      const context = await browser.newContext(device === 'touch'
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 900 } });
      let mode = 'success', currentPassword = 'old-password', calls = [], failVerify = false;
      await context.addInitScript(() => {
        window.MIXX_CLOUD_CONFIG = { url: 'https://recovery.supabase.co', anonKey: 'sb_publishable_test', timeoutMs: 1000 };
      });
      await context.route('**/*', route => {
        if (route.request().url().startsWith(base + '/')) return route.continue();
        errors.push('Unexpected external request'); return route.abort();
      });
      await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', err => errors.push(err.message));
      await context.route('https://recovery.supabase.co/**', async route => {
        const request = route.request(), url = new URL(request.url());
        calls.push({ method: request.method(), path: url.pathname });
        if (url.pathname === '/auth/v1/recover') {
          assert.deepEqual(request.postDataJSON(), { email: user.email });
          assert.equal(url.searchParams.get('redirect_to'), base + '/beta/reset-password.html');
          assert.ok(!request.headers().authorization);
          await route.fulfill({ status: mode === 'rate-limit' ? 429 : 200, contentType: 'application/json', body: '{}' });
        } else if (url.pathname === '/auth/v1/user') {
          assert.equal(new URL(page.url()).hash, '', 'Remove credentials before GET / PUT');
          assert.equal(request.headers().authorization, 'Bearer email-token');
          if (request.method() === 'GET') {
            await route.fulfill({ status: failVerify ? 401 : 200, contentType: 'application/json', body: JSON.stringify(user) });
          } else {
            assert.equal(request.method(), 'PUT');
            const body = request.postDataJSON();
            assert.deepEqual(Object.keys(body), ['password']);
            currentPassword = body.password;
            if (mode === 'lost-response') { await route.abort(); return; }
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
          }
        } else if (url.pathname === '/auth/v1/token') {
          const body = request.postDataJSON();
          const valid = body.email === user.email && body.password === currentPassword;
          await route.fulfill({ status: valid ? 200 : 400, contentType: 'application/json', body: JSON.stringify(valid ? {
            access_token: 'new-login', refresh_token: 'new-refresh', expires_in: 3600, user,
          } : { error_code: 'invalid_credentials' }) });
        } else if (url.pathname.startsWith('/rest/v1/')) {
          // Only the explicit post-recovery game login below may load account data.
          assert.ok(page.url().endsWith('/beta/index.html'), 'Recovery must not request game data');
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.pathname.endsWith('/profiles')
            ? [{ nickname: 'NSWER', avatar: 'muse-1', prefs: { sound: true, touch: 'auto' } }] : []) });
        } else { errors.push('Unexpected Auth endpoint'); await route.abort(); }
      });
      await page.goto(base + '/beta/index.html');
      await page.locator('#btn-account').click();
      await page.getByRole('link', { name: '忘记密码？通过邮件找回' }).click();
      assert.equal(page.url(), base + '/beta/reset-password.html');
      assert.equal(calls.length, 0, 'Opening recovery sends nothing');
      // Existing game data, including a different account, is opaque to recovery.
      const saved = await page.evaluate(() => {
        for (const channel of ['', '.beta', '.preview']) {
          for (const type of ['save', 'settings', 'account', 'cloud', 'stats']) {
            localStorage.setItem('mixxtopia.' + type + channel + '.v1', JSON.stringify({ user: { id: 'other-user' }, marker: type }));
          }
        }
        return Object.fromEntries(Object.entries(localStorage));
      });
      const unchanged = async () => assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))), saved);
      mode = 'rate-limit';
      await page.locator('#recovery-email').fill(user.email);
      await page.locator('#recovery-send').click();
      await page.waitForFunction(() => document.querySelector('#recovery-msg').textContent.includes('操作太频繁'));
      mode = 'success';
      await page.locator('#recovery-send').click();
      await page.waitForFunction(() => document.querySelector('#recovery-msg').textContent.includes('如果该邮箱已注册'));
      await unchanged();
      checks.push(device + ': opening zero requests / email request / channel callback / rate limit');

      const callback = base + '/beta/reset-password.html#type=recovery&access_token=email-token&refresh_token=discarded';
      // Email navigation returns from GoTrue's different origin, creating a new document.
      // A direct goto differing only by a fragment would be a same-document navigation.
      const openEmail = async url => { await page.goto('about:blank'); await page.goto(url); };
      await openEmail(callback);
      await page.locator('#recovery-password').waitFor({ state: 'visible' });
      assert.equal(page.url(), base + '/beta/reset-password.html');
      assert.equal(await page.locator('#recovery-account').innerText(), user.email);
      assert.equal(await page.evaluate(() => !!window.MIXX.main), false);
      await unchanged();
      await page.screenshot({ path: path.join(output, device + '-reset.png'), fullPage: true });
      if (device === 'touch') {
        await page.setViewportSize({ width: 320, height: 568 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.locator('#recovery-save').scrollIntoViewIfNeeded();
        await page.setViewportSize({ width: 390, height: 844 });
      }
      const before = calls.filter(call => call.method === 'PUT').length;
      await page.locator('#recovery-password').fill('new-password');
      await page.locator('#recovery-confirm').fill('mismatched');
      await page.locator('#recovery-save').click();
      assert.match(await page.locator('#recovery-msg').innerText(), /不一致/);
      assert.equal(await page.locator('#recovery-password').inputValue(), '');
      assert.equal(await page.locator('#recovery-confirm').inputValue(), '');
      assert.equal(calls.filter(call => call.method === 'PUT').length, before);
      await page.locator('#recovery-password').fill('new-password');
      await page.locator('#recovery-confirm').fill('new-password');
      await page.locator('#recovery-save').click();
      await page.waitForFunction(() => document.querySelector('#recovery-title').textContent === '密码已重置');
      await unchanged();
      assert.equal(calls.filter(call => call.method === 'PUT').length, before + 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, device + '-complete.png'), fullPage: true });
      checks.push(device + ': scrubbed callback / mismatch zero write / successful reset / all storage unchanged');

      await openEmail(callback);
      await page.locator('#recovery-password').fill('not-submitted');
      await page.evaluate(() => {
        dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
      assert.equal(await page.locator('#recovery-password').inputValue(), '');
      assert.equal(await page.locator('#recovery-reset').isVisible(), false);
      assert.equal(await page.locator('#recovery-request').isVisible(), true);
      await unchanged();
      checks.push(device + ': page lifecycle clears credentials and returns to fresh request form');

      mode = 'lost-response';
      await openEmail(callback);
      await page.locator('#recovery-password').fill('later-password');
      await page.locator('#recovery-confirm').fill('later-password');
      const lostBefore = calls.filter(call => call.method === 'PUT').length;
      await page.locator('#recovery-save').click();
      await page.waitForFunction(() => document.querySelector('#recovery-msg').textContent.includes('未能确认修改结果'));
      assert.equal(await page.locator('#recovery-reset').isVisible(), false);
      assert.equal(await page.locator('#recovery-again').isVisible(), true);
      assert.equal(calls.filter(call => call.method === 'PUT').length, lostBefore + 1);
      await unchanged();
      checks.push(device + ': lost response blocks repeat reset and preserves local data');

      failVerify = true;
      await openEmail(callback);
      await page.waitForFunction(() => document.querySelector('#recovery-msg').textContent.includes('链接已失效'));
      assert.equal(await page.locator('#recovery-reset').isVisible(), false);
      assert.equal(await page.locator('#recovery-again').isVisible(), true);
      failVerify = false;
      const verifyBefore = calls.length;
      await openEmail(base + '/beta/reset-password.html#type=signup&access_token=email-token');
      await page.waitForFunction(() => document.querySelector('#recovery-msg').textContent.includes('链接不完整'));
      assert.equal(calls.length, verifyBefore, 'Invalid callback must not reach Auth');
      assert.equal(new URL(page.url()).hash, '');
      await page.locator('#recovery-again').click();
      assert.equal(await page.locator('#recovery-request').isVisible(), true);
      await unchanged();
      await page.screenshot({ path: path.join(output, device + '-request.png'), fullPage: true });
      checks.push(device + ': expired / malformed links and explicit restart');

      // Return through the real game page: old password fails, reset password works.
      // The preservation assertion above includes another account; explicitly clear
      // this synthetic session to exercise the logged-out game's login form.
      await page.evaluate(() => localStorage.removeItem('mixxtopia.account.beta.v1'));
      await page.getByRole('link', { name: '← 返回游戏' }).click();
      await page.locator('#btn-account').click();
      await page.locator('#login-email').fill(user.email);
      await page.locator('#login-password').fill('old-password');
      await page.locator('#btn-login').click();
      await page.waitForFunction(() => document.querySelector('#login-msg').textContent.includes('邮箱或密码不正确'));
      await page.locator('#login-password').fill(currentPassword);
      await page.locator('#btn-login').click();
      await page.locator('#login-account').waitFor({ state: 'visible' });
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mixxtopia.account.beta.v1')));
      assert.equal(stored.user.id, user.id);
      assert.equal(await page.evaluate(() => localStorage.getItem('mixxtopia.account.v1')), saved['mixxtopia.account.v1']);
      checks.push(device + ': return stays beta / old password rejected / new password login / stable session unchanged');
      await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, errors }, null, 2));
    for (const check of checks) console.log('  ✓ ' + check);
    console.log('全部通过：' + checks.length + ' 组浏览器检查；产物：' + output);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(build, { recursive: true, force: true });
  }
})().catch(err => { console.error(err.stack); process.exitCode = 1; });
