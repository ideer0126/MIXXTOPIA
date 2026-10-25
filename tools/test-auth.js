#!/usr/bin/env node
/**
 * tools/test-auth.js —— Supabase GoTrue 封装验证（Issue #43）
 *
 * 零依赖：Node 内置 assert + vm；不连真实后端，全部走 `fetch` 桩。
 * 运行：node tools/test-auth.js
 *
 * 覆盖验收项：
 *   1. 注册成功（写会话 / localStorage 键 / 请求头与 body）
 *   2. 密码错、邮箱已注册、邮箱未验证、弱密码等错误码 → 中文提示
 *   3. 登录成功 / 登出（离线也能登出，且不碰本地存档）
 *   4. 会话恢复：未过期直接恢复；过期自动 refresh_token 续期；续期失败清会话
 *   5. 网络失败 / 5xx / 配置缺失 → 「云端暂不可用」，不抛英文原文
 *   6. 损坏 localStorage、注册待邮箱验证、onChange 事件、并发续期去重
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const CLOUD_CONFIG_SRC = fs.readFileSync(path.join(repoRoot, 'js/cloud-config.js'), 'utf8');
const AUTH_SRC = fs.readFileSync(path.join(repoRoot, 'js/auth.js'), 'utf8');

const NOW = 1700000000000; // 固定时钟：2023-11-14T22:13:20Z
const USER = Object.freeze({ id: 'u-1', email: 'nswer@example.com' });

/* ─────────────────── 桩 ─────────────────── */

function createStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(String(key)) ? map.get(String(key)) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(String(key)); },
    clear() { map.clear(); },
    key(i) { return Array.from(map.keys())[i] || null; },
    get length() { return map.size; },
  };
}

/** 每个用例独立沙箱，避免账户模块单例/模块缓存互相污染 */
function setup(overrides) {
  const storage = createStorage();
  const sandbox = {
    console,
    localStorage: storage,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: undefined,
    MIXX_CLOUD_CONFIG: { url: 'https://test.supabase.co', anonKey: 'sb_publishable_test', timeoutMs: 1000 },
  };
  if (overrides) Object.assign(sandbox, overrides);
  vm.createContext(sandbox);
  vm.runInContext(CLOUD_CONFIG_SRC, sandbox, { filename: 'js/cloud-config.js' });
  vm.runInContext(AUTH_SRC, sandbox, { filename: 'js/auth.js' });
  return { sandbox, storage, auth: sandbox.MIXX.auth };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json() { return Promise.resolve(body); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** fetch 桩：记录每次调用的 URL/init/JSON body，由 handler 决定响应或抛错 */
function fetchRecorder(handler) {
  const calls = [];
  function stub(url, init) {
    let body = null;
    if (init && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch (e) { body = init.body; }
    }
    const call = { url, init: init || {}, body };
    calls.push(call);
    return Promise.resolve().then(() => handler(call));
  }
  stub.calls = calls;
  return stub;
}

function sessionPayload(extra) {
  return Object.assign({
    access_token: 'access-1',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'refresh-1',
    user: { id: USER.id, email: USER.email },
  }, extra || {});
}

function seedSession(storage, extra) {
  const session = Object.assign({
    v: 1,
    accessToken: 'stored-access',
    refreshToken: 'stored-refresh',
    expiresAt: NOW + 10 * 60 * 1000,
    user: { id: USER.id, email: USER.email },
  }, extra || {});
  storage.setItem('mixxtopia.account.v1', JSON.stringify(session));
  return session;
}

async function rejects(promise, code) {
  let error = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  assert.ok(error, '应当抛出 AuthError（' + code + '）');
  assert.strictEqual(error.name, 'AuthError', '异常类型');
  assert.strictEqual(error.code, code, '错误码');
  return error;
}

/* ─────────────────── 用例 ─────────────────── */

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    failures.push({ name, e });
    console.error('  \u2717 ' + name + '\n      ' + (e && e.message));
  }
}

(async function run() {
  await test('公开 API：会话键、通道派生、校验与中文错误映射', () => {
    const { auth } = setup();
    assert.strictEqual(auth.AUTH_KEY, 'mixxtopia.account.v1');
    assert.strictEqual(auth.SESSION_VERSION, 1);
    assert.strictEqual(auth.sessionKeyFor('stable'), 'mixxtopia.account.v1');
    assert.strictEqual(auth.sessionKeyFor('beta'), 'mixxtopia.account.beta.v1');
    assert.strictEqual(auth.sessionKeyFor('preview'), 'mixxtopia.account.preview.v1');
    assert.strictEqual(auth.sessionKeyFor('nope/../x'), 'mixxtopia.account.nopex.v1');
    assert.strictEqual(auth.normalizeEmail('  A@B.COM '), 'a@b.com');
    assert.strictEqual(auth.validateEmail('not-an-email'), 'invalid_email');
    assert.strictEqual(auth.validateEmail('a@b.co'), '');
    assert.strictEqual(auth.validatePassword('12345'), 'short_password');
    assert.strictEqual(auth.validatePassword('123456'), '');
    assert.strictEqual(auth.mapError(400, { error_code: 'invalid_credentials' }).message, '邮箱或密码不正确');
    assert.strictEqual(auth.mapError(422, { error_code: 'user_already_exists' }).code, 'user_already_exists');
    assert.strictEqual(auth.mapError(400, { error_code: 'email_exists' }).code, 'user_already_exists');
    assert.strictEqual(auth.mapError(400, { msg: 'Email address "bad" is invalid' }).code, 'invalid_email');
    assert.strictEqual(auth.mapError(400, { error_code: 'email_not_confirmed' }).code, 'email_not_confirmed');
    assert.strictEqual(auth.mapError(400, { error_code: 'weak_password' }).code, 'weak_password');
    assert.strictEqual(auth.mapError(429, {}).code, 'rate_limit');
    assert.strictEqual(auth.mapError(503, {}).code, 'server');
    assert.strictEqual(auth.mapError(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }).code, 'invalid_credentials');
    assert.strictEqual(auth.mapError(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' }).code, 'invalid_refresh_token');
  });

  await test('注册成功：POST /auth/v1/signup，写会话到 mixxtopia.account.v1', async () => {
    const { auth, storage } = setup();
    const fetch = fetchRecorder(() => response(200, sessionPayload()));
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const result = await client.signUp('  NSWER@Example.com ', 'secret123');
    assert.strictEqual(result.needsConfirmation, false);
    assert.strictEqual(result.user.email, USER.email);
    assert.strictEqual(result.session.accessToken, 'access-1');
    assert.strictEqual(fetch.calls.length, 1);

    const call = fetch.calls[0];
    assert.strictEqual(call.url, 'https://test.supabase.co/auth/v1/signup');
    assert.strictEqual(call.init.method, 'POST');
    assert.strictEqual(call.init.headers.apikey, 'sb_publishable_test');
    assert.strictEqual(call.init.headers['Content-Type'], 'application/json');
    assert.strictEqual(call.init.headers.Authorization, undefined, '未登录请求不带 Bearer');
    assert.deepStrictEqual(call.body, { email: USER.email, password: 'secret123' });

    const stored = JSON.parse(storage.getItem(auth.AUTH_KEY));
    assert.strictEqual(stored.v, 1);
    assert.strictEqual(stored.accessToken, 'access-1');
    assert.strictEqual(stored.refreshToken, 'refresh-1');
    assert.strictEqual(stored.expiresAt, NOW + 3600 * 1000);
    assert.deepStrictEqual(stored.user, { id: USER.id, email: USER.email });
    assert.strictEqual(client.isSignedIn(), true);
  });

  await test('注册成功但需邮箱验证：返回 needsConfirmation，不写会话', async () => {
    const { auth, storage } = setup();
    const fetch = fetchRecorder(() => response(200, { id: 'u-2', email: 'new@example.com' }));
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const result = await client.signUp('new@example.com', 'secret123');
    assert.strictEqual(result.needsConfirmation, true);
    assert.strictEqual(result.session, null);
    assert.strictEqual(result.user.email, 'new@example.com');
    assert.strictEqual(storage.getItem(auth.AUTH_KEY), null);
    assert.strictEqual(client.isSignedIn(), false);
  });

  await test('邮箱已注册：422 user_already_exists → 中文提示，不写会话', async () => {
    const { auth, storage } = setup();
    const fetch = fetchRecorder(() => response(422, {
      code: 422, error_code: 'user_already_exists', msg: 'User already registered',
    }));
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const err = await rejects(client.signUp(USER.email, 'secret123'), 'user_already_exists');
    assert.strictEqual(err.message, '该邮箱已注册，请直接登录');
    assert.strictEqual(storage.getItem(auth.AUTH_KEY), null);
    assert.strictEqual(client.isSignedIn(), false);
  });

  await test('密码错：400 invalid_grant / Invalid login credentials → 中文提示', async () => {
    const { auth, storage } = setup();
    const fetch = fetchRecorder(() => response(400, {
      code: 400, error: 'invalid_grant', error_description: 'Invalid login credentials',
    }));
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const err = await rejects(client.signIn(USER.email, 'wrong-pass'), 'invalid_credentials');
    assert.strictEqual(err.message, '邮箱或密码不正确');
    assert.strictEqual(storage.getItem(auth.AUTH_KEY), null);
  });

  await test('登录成功：POST /token?grant_type=password，返回并持久化会话', async () => {
    const { auth, storage } = setup();
    const fetch = fetchRecorder(() => response(200, sessionPayload()));
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const session = await client.signIn('NSWER@example.com', 'secret123');
    assert.strictEqual(session.user.email, USER.email);
    assert.strictEqual(client.getAccessToken(), 'access-1');
    assert.strictEqual(client.getUser().id, USER.id);
    assert.strictEqual(client.getUser().email, USER.email);
    assert.strictEqual(client.authHeaders().Authorization, 'Bearer access-1');
    assert.strictEqual(client.authHeaders().apikey, 'sb_publishable_test');

    const call = fetch.calls[0];
    assert.strictEqual(call.url, 'https://test.supabase.co/auth/v1/token?grant_type=password');
    assert.deepStrictEqual(call.body, { email: USER.email, password: 'secret123' });
  });

  await test('客户端校验：邮箱/密码不合规时不发请求', async () => {
    const { auth, storage } = setup();
    const fetch = fetchRecorder(() => response(200, sessionPayload()));
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    await rejects(client.signIn('', 'secret123'), 'missing_email');
    await rejects(client.signIn('bad-email', 'secret123'), 'invalid_email');
    await rejects(client.signIn('a@b.co', ''), 'missing_password');
    await rejects(client.signIn('a@b.co', '12345'), 'short_password');
    assert.strictEqual(fetch.calls.length, 0, '校验失败不应发网络请求');
  });

  await test('会话恢复：token 未过期时直接恢复，不发请求', async () => {
    const { auth, storage } = setup();
    seedSession(storage);
    const fetch = fetchRecorder(() => {
      throw new Error('不应发请求');
    });
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const session = await client.restore();
    assert.ok(session, '应恢复会话');
    assert.strictEqual(session.accessToken, 'stored-access');
    assert.strictEqual(session.user.email, USER.email);
    assert.strictEqual(client.isSignedIn(), true);
    assert.strictEqual(client.lastError, null);
    assert.strictEqual(fetch.calls.length, 0);
  });

  await test('token 过期：restore 自动 refresh_token 续期并更新本地会话', async () => {
    const { auth, storage } = setup();
    seedSession(storage, { expiresAt: NOW - 1000 });
    const fetch = fetchRecorder((call) => {
      assert.ok(call.url.indexOf('/auth/v1/token?grant_type=refresh_token') >= 0, call.url);
      return response(200, {
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        expires_in: 3600,
        // 刻意不带 user：续期响应应沿用本地缓存的用户
      });
    });
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const session = await client.restore();
    assert.ok(session);
    assert.strictEqual(session.accessToken, 'access-2');
    assert.strictEqual(session.refreshToken, 'refresh-2');
    assert.strictEqual(session.user.email, USER.email, '续期响应缺 user 时沿用本地用户');
    assert.strictEqual(fetch.calls.length, 1);
    assert.deepStrictEqual(fetch.calls[0].body, { refresh_token: 'stored-refresh' });
    assert.strictEqual(fetch.calls[0].init.headers.Authorization, undefined);

    const stored = JSON.parse(storage.getItem(auth.AUTH_KEY));
    assert.strictEqual(stored.accessToken, 'access-2');
    assert.strictEqual(stored.expiresAt, NOW + 3600 * 1000);
  });

  await test('refresh_token 失效：清空本地会话、restore 返回 null', async () => {
    const { auth, storage } = setup();
    seedSession(storage, { expiresAt: NOW - 1000 });
    const fetch = fetchRecorder(() => response(400, {
      code: 400, error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found',
    }));
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const session = await client.restore();
    assert.strictEqual(session, null);
    assert.strictEqual(client.isSignedIn(), false);
    assert.strictEqual(client.lastError.code, 'invalid_refresh_token');
    assert.strictEqual(storage.getItem(auth.AUTH_KEY), null, '失效 refresh token 应清掉');
  });

  await test('网络失败：登录提示「云端暂不可用」，不写会话', async () => {
    const { auth, storage } = setup();
    const fetch = fetchRecorder(() => { throw new TypeError('Failed to fetch'); });
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const err = await rejects(client.signIn(USER.email, 'secret123'), 'network');
    assert.ok(err.message.indexOf('云端暂不可用') >= 0, err.message);
    assert.strictEqual(storage.getItem(auth.AUTH_KEY), null);
  });

  await test('网络失败：restore 续期失败保留本地会话，lastError 提示', async () => {
    const { auth, storage } = setup();
    seedSession(storage, { expiresAt: NOW - 1000 });
    const fetch = fetchRecorder(() => { throw new TypeError('offline'); });
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const session = await client.restore();
    assert.strictEqual(session, null);
    assert.strictEqual(client.lastError.code, 'network');
    assert.ok(storage.getItem(auth.AUTH_KEY), '网络失败不能清掉 refresh_token，下次在线重试');
  });

  await test('服务端 5xx：映射为「云端暂不可用（服务器错误）」', async () => {
    const { auth, storage } = setup();
    const fetch = fetchRecorder(() => response(503, {}));
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const err = await rejects(client.signIn(USER.email, 'secret123'), 'server');
    assert.ok(err.message.indexOf('云端暂不可用') >= 0, err.message);
  });

  await test('配置缺失：不发请求，提示云端暂不可用', async () => {
    const { auth, storage } = setup();
    const fetch = fetchRecorder(() => response(200, sessionPayload()));
    const client = auth.createClient({
      fetch, storage, now: () => NOW,
      config: { enabled: false, timeoutMs: 0 },
    });

    assert.strictEqual(client.available, false);
    const err = await rejects(client.signIn(USER.email, 'secret123'), 'unavailable');
    assert.ok(err.message.indexOf('云端暂不可用') >= 0, err.message);
    assert.strictEqual(fetch.calls.length, 0);
  });

  await test('损坏 / 版本不符的会话：restore 安全返回 null', async () => {
    const { auth, storage } = setup();
    storage.setItem(auth.AUTH_KEY, '{oops');
    let client = auth.createClient({ storage, now: () => NOW });
    assert.strictEqual(await client.restore(), null);

    storage.setItem(auth.AUTH_KEY, JSON.stringify({ v: 99, accessToken: 'x' }));
    client = auth.createClient({ storage, now: () => NOW });
    assert.strictEqual(await client.restore(), null);
  });

  await test('登出：清会话回游客态，不动本地存档；离线也能登出', async () => {
    const { auth, storage } = setup();
    seedSession(storage);
    storage.setItem('mixxtopia.save.v1', JSON.stringify({ v: 1, slots: [{ current: 1 }] }));
    let fetch = fetchRecorder(() => response(204, null));
    let client = auth.createClient({ fetch, storage, now: () => NOW });
    await client.restore();

    assert.strictEqual(await client.signOut(), true);
    assert.strictEqual(client.isSignedIn(), false);
    assert.strictEqual(storage.getItem(auth.AUTH_KEY), null);
    assert.ok(storage.getItem('mixxtopia.save.v1'), '登出不得动本地存档');
    assert.strictEqual(fetch.calls[0].url, 'https://test.supabase.co/auth/v1/logout');
    assert.strictEqual(fetch.calls[0].init.method, 'POST');
    assert.strictEqual(fetch.calls[0].init.headers.Authorization, 'Bearer stored-access');

    // 离线登出：服务端请求失败，本地仍然登出
    seedSession(storage);
    fetch = fetchRecorder(() => { throw new TypeError('offline'); });
    client = auth.createClient({ fetch, storage, now: () => NOW });
    await client.restore();
    assert.strictEqual(await client.signOut(), true);
    assert.strictEqual(client.isSignedIn(), false);
    assert.strictEqual(storage.getItem(auth.AUTH_KEY), null);
  });

  await test('onChange：登录/登出事件可订阅，取消后不再触发', async () => {
    const { auth, storage } = setup();
    const fetch = fetchRecorder(() => response(200, sessionPayload()));
    const client = auth.createClient({ fetch, storage, now: () => NOW });
    const events = [];
    const off = client.onChange((ev) => events.push(ev.type));

    await client.signIn(USER.email, 'secret123');
    await client.signOut();
    assert.deepStrictEqual(events, ['signin', 'signout']);
    off();
    await client.signIn(USER.email, 'secret123');
    assert.deepStrictEqual(events, ['signin', 'signout'], '取消订阅后不再收到事件');
  });

  await test('并发续期去重：两个 restore 共享同一次 refresh 请求', async () => {
    const { auth, storage } = setup();
    seedSession(storage, { expiresAt: NOW - 1000 });
    const fetch = fetchRecorder(() => response(200, {
      access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600,
    }));
    const client = auth.createClient({ fetch, storage, now: () => NOW });

    const [a, b] = await Promise.all([client.restore(), client.restore()]);
    assert.ok(a && b);
    assert.strictEqual(fetch.calls.length, 1, '并发续期只发一次请求');
    assert.strictEqual(a.accessToken, 'access-2');
    assert.strictEqual(b.accessToken, 'access-2');
  });

  for (const flow of ['restore', 'refresh']) {
    for (const action of ['signOut', 'signIn', 'signUp']) {
      for (const result of ['success', 'invalid_refresh_token', 'network']) {
        await test(flow + ' 过期响应：' + action + ' 后忽略 ' + result, async () => {
          const { auth, storage } = setup();
          seedSession(storage, { expiresAt: NOW - 1000 });
          const pending = deferred();
          const fetch = fetchRecorder((call) => {
            if (call.url.includes('grant_type=refresh_token')) return pending.promise;
            return response(200, sessionPayload({
              user: { id: 'u-2', email: 'new@example.com' },
            }));
          });
          const client = auth.createClient({ fetch, storage, now: () => NOW });
          const events = [];
          client.onChange((event) => events.push(event.type));
          const first = client[flow]();
          const second = client[flow]();
          await client[action]('new@example.com', 'secret123');
          const current = client.getSession();
          const saved = storage.getItem(auth.AUTH_KEY);
          const expectedEvents = events.slice();

          if (result === 'network') pending.resolve(Promise.reject(new TypeError('offline')));
          else if (result === 'invalid_refresh_token') {
            pending.resolve(response(400, { error_code: 'invalid_refresh_token' }));
          } else pending.resolve(response(200, sessionPayload({ access_token: 'obsolete' })));

          assert.strictEqual(await first, current, '返回当前会话');
          assert.strictEqual(await second, current, '共享请求的调用方也返回当前会话');
          assert.strictEqual(client.getSession(), current, '不得覆盖或清空当前会话');
          assert.strictEqual(storage.getItem(auth.AUTH_KEY), saved, '不得改动当前持久化会话');
          assert.strictEqual(client.lastError, null, '不得记录过期错误');
          assert.deepStrictEqual(events, expectedEvents, '不得发送过期事件');
          assert.strictEqual(fetch.calls.filter((call) => call.url.includes('grant_type=refresh_token')).length, 1);
        });
      }
    }
  }

  for (const status of [200, 400]) {
    await test('新登录独立续期，旧请求结束不影响新请求去重（' + status + '）', async () => {
      const { auth, storage } = setup();
      seedSession(storage, { expiresAt: NOW - 1000 });
      const old = deferred();
      const fresh = deferred();
      const fetch = fetchRecorder((call) => {
        if (!call.url.includes('grant_type=refresh_token')) {
          return response(200, sessionPayload({ refresh_token: 'new-refresh' }));
        }
        return call.body.refresh_token === 'stored-refresh' ? old.promise : fresh.promise;
      });
      const client = auth.createClient({ fetch, storage, now: () => NOW });
      const obsolete = client.refresh();
      await client.signIn(USER.email, 'secret123');
      const current = client.getSession();
      const next = client.refresh();
      old.resolve(response(status, status === 200
        ? sessionPayload({ access_token: 'obsolete' })
        : { error_code: 'invalid_refresh_token' }));
      assert.strictEqual(await obsolete, current);
      const duplicate = client.refresh();
      fresh.resolve(response(200, sessionPayload({ access_token: 'fresh' })));
      assert.strictEqual((await next).accessToken, 'fresh');
      assert.strictEqual(await duplicate, client.getSession());
      assert.strictEqual(fetch.calls.length, 3, '两代各自续期，同代共享请求');
      assert.strictEqual(JSON.parse(storage.getItem(auth.AUTH_KEY)).accessToken, 'fresh');
    });
  }

  await test('ensureFresh：快过期时自动续期，未过期不发请求', async () => {
    const { auth, storage } = setup();
    seedSession(storage, { expiresAt: NOW + 30 * 1000 }); // 小于 60s 提前量
    const fetch = fetchRecorder(() => response(200, {
      access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600,
    }));
    const client = auth.createClient({ fetch, storage, now: () => NOW });
    await client.restore(); // 30s 余量 < 60s → 这里已经续期了
    assert.strictEqual(fetch.calls.length, 1);
    assert.strictEqual((await client.ensureFresh()).accessToken, 'access-2');
    assert.strictEqual(fetch.calls.length, 1, '续期后未过期不再请求');
  });

  /* ─────────────────── 汇总 ─────────────────── */

  console.log('');
  if (failures.length) {
    console.error('失败 ' + failures.length + ' 项 / 共 ' + (passed + failures.length) + ' 项');
    process.exit(1);
  }
  console.log('全部通过：' + passed + ' 项');
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
