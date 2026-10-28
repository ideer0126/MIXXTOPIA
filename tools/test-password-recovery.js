#!/usr/bin/env node
'use strict';
// Recovery API + callback contract, using fetch fixtures only. Never sends mail.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.resolve(__dirname, '..');
const user = { id: 'recovery-user', email: 'nswer@example.com' };
const redirect = 'https://example.com/MIXXTOPIA/beta/reset-password.html';
let passed = 0;
function setup(handler, config = {}) {
  const calls = [], writes = [];
  const host = { console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    MIXX_NO_RECOVERY_BOOT: true,
    MIXX_CLOUD_CONFIG: Object.assign({ url: 'https://test.supabase.co', anonKey: 'sb_publishable_test', timeoutMs: 1000 }, config),
    localStorage: { getItem() { throw Error('Recovery must not read a game session'); },
      setItem(...args) { writes.push(args); }, removeItem(...args) { writes.push(args); } },
    fetch: async (url, init) => {
      const call = { url, init, body: init.body ? JSON.parse(init.body) : null };
      calls.push(call);
      const result = await handler(call);
      return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
    } };
  vm.createContext(host);
  for (const name of ['cloud-config', 'auth', 'password-recovery']) vm.runInContext(fs.readFileSync(path.join(repo, 'js', name + '.js'), 'utf8'), host);
  return { host, calls, writes, client: host.MIXX.auth.createRecoveryClient({ root: host }) };
}
const ok = body => ({ status: 200, body });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function rejects(promise, code) { await assert.rejects(promise, err => err.name === 'AuthError' && err.code === code); }
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }
(async () => {
  await test('申请使用 /recover 与当前通道回调，无密码或 Bearer；未知邮箱同样成功', async () => {
    const s = setup(() => ok({}));
    assert.equal(await s.client.requestPasswordReset(' NSWER@example.com ', redirect + '?secret=bad#token'), true);
    assert.equal(s.calls[0].url, 'https://test.supabase.co/auth/v1/recover?redirect_to=' + encodeURIComponent(redirect));
    assert.deepEqual(s.calls[0].body, { email: user.email });
    assert.ok(!s.calls[0].init.headers.Authorization);
    assert.equal(s.calls[0].init.redirect, 'error');
    assert.deepEqual(s.writes, []);
    const unknown = setup(() => ({ status: 400, body: { error_code: 'user_not_found' } }));
    assert.equal(await unknown.client.requestPasswordReset(user.email, redirect), true);
  });
  await test('无效邮箱、非 HTTPS / 非本机 HTTP 回调：零请求；允许本地测试', async () => {
    const s = setup(() => ok({}));
    await rejects(s.client.requestPasswordReset('', redirect), 'missing_email');
    await rejects(s.client.requestPasswordReset('bad', redirect), 'invalid_email');
    for (const target of ['javascript:alert(1)', 'http://example.com/reset', '//evil.example/reset', 'invalid']) {
      await rejects(s.client.requestPasswordReset(user.email, target), 'invalid_recovery_link');
    }
    assert.equal(s.calls.length, 0);
    await s.client.requestPasswordReset(user.email, 'http://127.0.0.1:8000/beta/reset-password.html');
  });
  await test('发信错误映射中文，限流 / SMTP 不可用 / 非法回包不报成功', async () => {
    for (const [status, body, code] of [
      [429, {}, 'rate_limit'], [400, { error_code: 'email_address_not_authorized' }, 'email_delivery_unavailable'],
      [500, {}, 'server'], [200, null, 'invalid_response'], [200, [], 'invalid_response'],
    ]) {
      const s = setup(() => ({ status, body }));
      await rejects(s.client.requestPasswordReset(user.email, redirect), code);
    }
    const s = setup(() => { throw Error('offline'); });
    await rejects(s.client.requestPasswordReset(user.email, redirect), 'network');
    const disabled = setup(() => ok({}), { url: '', anonKey: '' });
    await rejects(disabled.client.requestPasswordReset(user.email, redirect), 'unavailable');
    assert.equal(disabled.calls.length, 0);
  });
  await test('只接受 recovery fragment；拒绝缺项、重复参数、其他流程及错误链接', async () => {
    const { host } = setup(() => ok(user));
    const parse = host.MIXX.recovery.parseFragment;
    assert.equal(parse(''), null);
    assert.equal(parse('#access_token=recovery-token&type=recovery&refresh_token=discarded'), 'recovery-token');
    for (const hash of ['#type=recovery', '#access_token=x&type=signup', '#access_token=x',
      '#access_token=x&access_token=y&type=recovery', '#access_token=x&type=recovery&type=signup']) {
      assert.throws(() => parse(hash), err => err.code === 'invalid_recovery_link');
    }
    assert.throws(() => parse('#error=access_denied&error_description=untrusted'), err => err.code === 'recovery_expired');
  });
  await test('服务端 GET /user 验证身份，恢复会话永不落盘或发游戏登录事件', async () => {
    const s = setup(() => ok(user));
    let events = 0; s.client.onChange(() => { events++; });
    assert.equal((await s.client.verifyRecovery('email-token')).id, user.id);
    assert.equal(s.calls[0].init.method, 'GET');
    assert.equal(s.calls[0].init.headers.Authorization, 'Bearer email-token');
    assert.equal(s.client.getRecoveryUser().email, user.email);
    assert.equal(s.client.getSession(), null);
    assert.deepEqual(s.writes, []); assert.equal(events, 0);
  });
  await test('失效 token、空身份或验证失败不能重置；不刷新游戏会话', async () => {
    for (const [status, body, code] of [[401, {}, 'recovery_expired'],
      [403, {}, 'recovery_expired'], [400, { error_code: 'otp_expired' }, 'recovery_expired'], [200, {}, 'invalid_response']]) {
      const s = setup(() => ({ status, body }));
      await rejects(s.client.verifyRecovery('expired'), code);
      await rejects(s.client.resetPassword('new-password'), 'recovery_expired');
      assert.equal(s.calls.length, 1); assert.equal(s.client.getRecoveryUser(), null);
    }
  });
  await test('重置只用邮件验证令牌 PUT /user，不要求旧密码、不修改存档 / 原会话', async () => {
    const s = setup(() => ok(user));
    await s.client.verifyRecovery('recovery-token');
    await rejects(s.client.resetPassword('short'), 'short_password');
    assert.equal(s.calls.length, 1);
    await s.client.resetPassword('new-password');
    assert.deepEqual(s.calls[1].body, { password: 'new-password' });
    assert.equal(s.calls[1].init.method, 'PUT');
    assert.equal(s.calls[1].init.headers.Authorization, 'Bearer recovery-token');
    assert.equal(s.client.getRecoveryUser(), null); assert.deepEqual(s.writes, []);
    await rejects(s.client.resetPassword('another-password'), 'recovery_expired');
    assert.equal(s.calls.length, 2);
  });
  await test('同密码 / 弱密码拒绝后保留验证，可重新输入；失效会话清除', async () => {
    const s = setup(call => call.init.method === 'GET' ? ok(user) : { status: 422, body: { error_code: 'same_password' } });
    await s.client.verifyRecovery('token');
    await rejects(s.client.resetPassword('new-password'), 'same_password');
    assert.equal(s.client.getRecoveryUser().id, user.id);
    const expired = setup(call => call.init.method === 'GET' ? ok(user) : { status: 401, body: {} });
    await expired.client.verifyRecovery('token');
    await rejects(expired.client.resetPassword('new-password'), 'recovery_expired');
    assert.equal(expired.client.getRecoveryUser(), null);
  });
  await test('网络 / 5xx / 无法确认回包：不自动重试写入，要求用新密码验证登录', async () => {
    for (const kind of ['network', 'server', 'malformed', 'wrong-owner']) {
      const s = setup(call => {
        if (call.init.method === 'GET') return ok(user);
        if (kind === 'network') throw Error('response lost');
        if (kind === 'server') return { status: 503, body: null };
        return ok(kind === 'wrong-owner' ? { id: 'other-user' } : null);
      });
      await s.client.verifyRecovery('token');
      await rejects(s.client.resetPassword('new-password'), 'password_update_uncertain');
      assert.equal(s.calls.length, 2); assert.equal(s.client.getRecoveryUser(), null);
      await rejects(s.client.resetPassword('new-password'), 'recovery_expired');
      assert.equal(s.calls.length, 2);
    }
  });
  await test('并发申请 / 验证 / 写入均去重；离开页面后旧回包不能恢复凭据', async () => {
    for (const action of ['request', 'verify', 'reset']) {
      const pending = deferred();
      let ready = action !== 'reset';
      const s = setup(() => ready ? pending.promise : (ready = true, ok(user)));
      if (action === 'reset') await s.client.verifyRecovery('token');
      const invoke = () => action === 'request' ? s.client.requestPasswordReset(user.email, redirect)
        : action === 'verify' ? s.client.verifyRecovery('token') : s.client.resetPassword('new-password');
      const first = invoke();
      await rejects(invoke(), 'recovery_busy');
      s.client.cancelRecovery(); pending.resolve(ok(action === 'request' ? {} : user));
      await rejects(first, 'recovery_cancelled');
      assert.equal(s.client.getRecoveryUser(), null); assert.deepEqual(s.writes, []);
    }
  });
  await test('请求超时结束，不重试密码写入', async () => {
    const s = setup(call => call.init.method === 'GET' ? ok(user) : new Promise((resolve, reject) => {
      call.init.signal.addEventListener('abort', () => reject(Error('aborted')));
    }), { timeoutMs: 10 });
    await s.client.verifyRecovery('token');
    await rejects(s.client.resetPassword('new-password'), 'password_update_uncertain');
    assert.equal(s.calls.length, 2);
  });
  console.log('全部通过：' + passed + ' 项');
})().catch(err => { console.error(err); process.exitCode = 1; });
