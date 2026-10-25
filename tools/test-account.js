#!/usr/bin/env node
/**
 * tools/test-account.js —— 账户资料（profiles 表）读写与校验验证（Issue #44）
 *
 * 零依赖：Node 内置 assert + vm；不连真实后端，全部走 `fetch` 桩。
 * 运行：node tools/test-account.js
 *
 * 覆盖验收项：
 *   1. 头像固定集合来自 GAME.avatarPresets，未知 id 回退默认头像（muse-1）
 *   2. 昵称 1–16 字（按 Unicode 码点，emoji 算 1 字）、空白/超长/控制字符被拒
 *   3. 偏好只保留 sound / touch，未知字段丢弃（最小化收集）
 *   4. load：GET /profiles?id=eq.<uid>&select=… + apikey/Bearer 请求头，返回值容错归一化
 *   5. save：客户端校验先于网络；PATCH + Prefer: return=representation + 正确 body
 *   6. 错误映射：400 字段约束 → 中文提示；401 续期重试一次；网络/超时/5xx → 云端暂不可用
 *   7. 未登录 / 配置缺失 / 资料行缺失 → 可编程错误码；全部不抛英文原文
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const CLOUD_CONFIG_SRC = fs.readFileSync(path.join(repoRoot, 'js/cloud-config.js'), 'utf8');
const ACCOUNT_SRC = fs.readFileSync(path.join(repoRoot, 'js/account.js'), 'utf8');

const USER = Object.freeze({ id: 'u-1', email: 'nswer@example.com' });
const PRESETS = Object.freeze([
  { id: 'muse-1', name: 'Lily', color: '#7FB8E6' },
  { id: 'muse-2', name: 'Haewon', color: '#FFB14E' },
  { id: 'muse-3', name: 'Sullyoon', color: '#B49BFF' },
  { id: 'muse-4', name: 'Bae', color: '#FF7BA9' },
  { id: 'muse-5', name: 'Jiwoo', color: '#FFE066' },
  { id: 'muse-6', name: 'Kyujin', color: '#5EE6B8' },
]);

/* ─────────────────── 桩 ─────────────────── */

function setup(overrides) {
  const quietConsole = {
    log: console.log.bind(console),
    warn() {},
    info() {},
    debug() {},
    error: console.error.bind(console),
  };
  const sandbox = {
    console: quietConsole,
    AbortController,
    setTimeout,
    clearTimeout,
    GAME: { avatarPresets: PRESETS.map((p) => Object.assign({}, p)) },
    MIXX_CLOUD_CONFIG: {
      url: 'https://test.supabase.co',
      anonKey: 'sb_publishable_test',
      timeoutMs: 1000,
    },
  };
  if (overrides) Object.assign(sandbox, overrides);
  vm.createContext(sandbox);
  vm.runInContext(CLOUD_CONFIG_SRC, sandbox, { filename: 'js/cloud-config.js' });
  vm.runInContext(ACCOUNT_SRC, sandbox, { filename: 'js/account.js' });
  return { sandbox, account: sandbox.MIXX.account, config: sandbox.MIXX.cloudConfig };
}

/** auth 桩：记录 ensureFresh / refresh 次数，返回可更换的会话 */
function fakeAuth(opts) {
  opts = opts || {};
  const auth = {
    ensureFreshCalls: 0,
    refreshCalls: 0,
    session: { user: { id: USER.id, email: USER.email }, accessToken: 'access-1' },
    async ensureFresh() {
      auth.ensureFreshCalls++;
      if (opts.ensureFreshError) throw opts.ensureFreshError;
      return auth.session;
    },
    async refresh() {
      auth.refreshCalls++;
      if (opts.refreshError) throw opts.refreshError;
      auth.session = Object.assign({}, auth.session, { accessToken: 'access-2' });
      return auth.session;
    },
  };
  return auth;
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json() { return Promise.resolve(body); },
  };
}

/** fetch 桩：记录 url/init/body；handler 返回响应或抛错 */
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

function makeClient(handler, opts) {
  opts = opts || {};
  const env = setup(opts.sandboxOverrides);
  const fetchStub = fetchRecorder(handler);
  const auth = opts.auth || fakeAuth(opts.authOptions);
  const client = env.account.createClient({
    config: opts.config !== undefined ? opts.config : env.config,
    auth: opts.auth === null ? null : auth,
    fetch: fetchStub,
  });
  return { client, auth, fetchStub, account: env.account, config: env.config };
}

function row(extra) {
  return Object.assign({
    nickname: '小星',
    avatar: 'muse-2',
    prefs: { sound: false, touch: 'on' },
  }, extra || {});
}

async function rejectsCode(promise, code) {
  try {
    await promise;
  } catch (err) {
    assert.strictEqual(err && err.code, code,
      '预期错误码 ' + code + '，实际 ' + (err && err.code) + '（' + (err && err.message) + '）');
    assert.ok(typeof (err && err.message) === 'string' && err.message.length > 0, '错误必须带中文提示');
    assert.strictEqual(/[a-z]{6,}/i.test(err.message) && /error|invalid|row|relation/i.test(err.message), false,
      '不得把英文原文甩给玩家：' + err.message);
    return err;
  }
  throw new Error('预期 reject（' + code + '），但 Promise 成功');
}

/* ─────────────────── 用例 ─────────────────── */

let passed = 0;
const failures = [];
const asyncTests = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    failures.push({ name, e });
    console.error('  \u2717 ' + name + '\n      ' + (e && e.message));
  }
}

function testAsync(name, fn) {
  asyncTests.push({ name, fn });
}

/* 1. 常量 / 白名单 */

test('公开 API：默认头像/昵称上限/偏好取值齐全', () => {
  const { account } = setup();
  assert.strictEqual(account.DEFAULT_AVATAR, 'muse-1');
  assert.strictEqual(account.DEFAULT_NICKNAME, 'NSWER');
  assert.strictEqual(account.NICKNAME_MIN, 1);
  assert.strictEqual(account.NICKNAME_MAX, 16);
  assert.deepStrictEqual(Array.from(account.TOUCH_VALUES), ['auto', 'on', 'off']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(account.DEFAULT_PREFS)), { sound: true, touch: 'auto' });
  assert.strictEqual(typeof account.createClient, 'function');
  assert.strictEqual(typeof account.AccountError, 'function');
});

test('头像白名单：来自 GAME.avatarPresets；非法条目过滤、未知 id 回退 muse-1', () => {
  const { sandbox, account } = setup();
  assert.deepStrictEqual(Array.from(account.avatarPresets(sandbox), (p) => p.id),
    ['muse-1', 'muse-2', 'muse-3', 'muse-4', 'muse-5', 'muse-6']);
  assert.strictEqual(account.isAvatarAllowed('muse-6', sandbox), true);
  assert.strictEqual(account.isAvatarAllowed('muse-99', sandbox), false);
  assert.strictEqual(account.isAvatarAllowed('Bad Avatar', sandbox), false);
  assert.strictEqual(account.normalizeAvatar('muse-3', sandbox), 'muse-3');
  assert.strictEqual(account.normalizeAvatar('unknown', sandbox), 'muse-1');
  // data.js 未加载（或结构异常）时仍保留默认头像，避免写非法 id
  sandbox.GAME = undefined;
  assert.deepStrictEqual(Array.from(account.avatarPresets(sandbox), (p) => p.id), ['muse-1']);
});

test('昵称归一化：trim、1–16 字（码点计）、空白与超长被拒', () => {
  const { account } = setup();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(account.normalizeNickname('  小星  '))),
    { ok: true, value: '小星' });
  const sixteen = '一二三四五六七八九十一二三四五六';
  assert.strictEqual(account.charLength(sixteen), 16);
  assert.strictEqual(account.normalizeNickname(sixteen).ok, true);
  assert.strictEqual(account.normalizeNickname('').code, 'empty_nickname');
  assert.strictEqual(account.normalizeNickname(' \t ').code, 'empty_nickname');
  assert.strictEqual(account.normalizeNickname(null).code, 'empty_nickname');
  assert.strictEqual(account.normalizeNickname('😀'.repeat(16)).ok, true, 'emoji 按 1 字计');
  const long = account.normalizeNickname('😀'.repeat(17));
  assert.strictEqual(long.code, 'long_nickname');
  assert.match(long.message, /16 字/);
  assert.strictEqual(account.normalizeNickname('a\nb').code, 'bad_nickname_chars');
});

test('偏好归一化：只保留 sound/touch；未知字段丢弃；非法值回默认', () => {
  const { account } = setup();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(account.normalizePrefs({ sound: false, touch: 'off' }))),
    { sound: false, touch: 'off' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(account.normalizePrefs({ sound: 'no', touch: 'x' }))),
    { sound: true, touch: 'auto' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(
    account.normalizePrefs({ sound: true, extraSecret: 'x' }))),
    { sound: true, touch: 'auto' });
  assert.strictEqual(account.isPrefsEqual({ sound: true, touch: 'auto' }, { sound: true }), true);
  assert.strictEqual(account.isPrefsEqual({ sound: false, touch: 'auto' }, { sound: true, touch: 'auto' }), false);
});

test('服务端行归一化：昵称 NULL/超长 → NSWER，未知头像 → muse-1，prefs 缺省补齐', () => {
  const { sandbox, account } = setup();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(account.normalizeProfileRow({}, sandbox))),
    { nickname: 'NSWER', avatar: 'muse-1', avatarRaw: '', prefs: { sound: true, touch: 'auto' } });
  const normalized = account.normalizeProfileRow({
    nickname: '  小星 ', avatar: 'muse-9', prefs: { sound: false, touch: 'on', junk: 1 },
  }, sandbox);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(normalized)), {
    nickname: '小星', avatar: 'muse-1', avatarRaw: 'muse-9', prefs: { sound: false, touch: 'on' },
  }, '未知头像渲染回退 muse-1，但 avatarRaw 保留云端原值');
  assert.strictEqual(account.normalizeProfileRow({ nickname: 'x'.repeat(17) }).nickname, 'NSWER');
});

/* 2. load */

testAsync('load：GET profiles?id=eq.<uid>&select=…，带 apikey + Bearer，返回归一化资料', async () => {
  const { client, auth, fetchStub, account } = makeClient(() => response(200, [row()]));
  const profile = await client.load();
  assert.strictEqual(auth.ensureFreshCalls, 1, '请求前取可用 token');
  assert.strictEqual(fetchStub.calls.length, 1);
  const call = fetchStub.calls[0];
  assert.strictEqual(call.init.method, 'GET');
  assert.ok(call.url.indexOf('https://test.supabase.co/rest/v1/profiles?') === 0, call.url);
  assert.ok(call.url.indexOf('id=eq.' + encodeURIComponent(USER.id)) >= 0, call.url);
  assert.ok(call.url.indexOf('select=nickname,avatar,prefs') >= 0, call.url);
  assert.strictEqual(call.init.headers.apikey, 'sb_publishable_test');
  assert.strictEqual(call.init.headers.Authorization, 'Bearer access-1');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(profile)), {
    nickname: '小星', avatar: 'muse-2', avatarRaw: 'muse-2',
    prefs: { sound: false, touch: 'on' },
  });
});

testAsync('load：资料行缺失 → profile_missing；响应非数组 → invalid_response', async () => {
  const missing = makeClient(() => response(200, []));
  await rejectsCode(missing.client.load(), 'profile_missing');
  const bad = makeClient(() => response(200, { nickname: 'x' }));
  await rejectsCode(bad.client.load(), 'invalid_response');
});

testAsync('load：401 时用 refresh_token 续期并重试一次（换新 token）', async () => {
  let n = 0;
  const { client, auth, fetchStub } = makeClient(() => {
    n++;
    if (n === 1) {
      assert.strictEqual(fetchStub.calls[0].init.headers.Authorization, 'Bearer access-1');
      return response(401, { message: 'JWT expired' });
    }
    assert.strictEqual(fetchStub.calls[1].init.headers.Authorization, 'Bearer access-2');
    return response(200, [row()]);
  });
  const profile = await client.load();
  assert.strictEqual(profile.nickname, '小星');
  assert.strictEqual(auth.refreshCalls, 1, '401 后刷新一次');
  assert.strictEqual(fetchStub.calls.length, 2, '刷新后重试一次');
});

testAsync('load：未登录 / 网络失败 / 配置缺失 → 可编程中文错误', async () => {
  const notSigned = makeClient(() => response(200, [row()]), { auth: null });
  await rejectsCode(notSigned.client.load(), 'not_signed_in');

  const offline = makeClient(() => { throw new TypeError('fetch failed'); });
  const err = await rejectsCode(offline.client.load(), 'network');
  assert.match(err.message, /云端暂不可用/);

  const disabled = makeClient(() => response(200, [row()]), {
    sandboxOverrides: { MIXX_CLOUD_CONFIG: { url: '', anonKey: '' } },
  });
  await rejectsCode(disabled.client.load(), 'unavailable');

  const authNetwork = makeClient(() => response(200, [row()]), {
    authOptions: { ensureFreshError: { code: 'network', message: '云端暂不可用' } },
  });
  await rejectsCode(authNetwork.client.load(), 'network');
});

/* 3. save */

testAsync('save：客户端校验先于网络（空/超长昵称、未知头像都不发请求）', async () => {
  const { client, fetchStub } = makeClient(() => response(200, [row()]));
  await rejectsCode(client.save({ nickname: '', avatar: 'muse-1', prefs: {} }), 'empty_nickname');
  await rejectsCode(client.save({ nickname: '一'.repeat(17), avatar: 'muse-1', prefs: {} }), 'long_nickname');
  await rejectsCode(client.save({ nickname: '小星', avatar: 'muse-9', prefs: {} }), 'bad_avatar');
  await rejectsCode(client.save({ nickname: '小星', avatar: 'avatar/../x', prefs: {} }), 'bad_avatar');
  assert.strictEqual(fetchStub.calls.length, 0, '校验失败不得发起网络请求');
});

testAsync('save：PATCH profiles?id=eq.<uid>，Prefer representation，body 只含昵称/头像/偏好', async () => {
  const { client, fetchStub } = makeClient((call) => response(200, [Object.assign(row(), call.body)]));
  const saved = await client.save({
    nickname: '  Muse小星  ',
    avatar: 'muse-5',
    prefs: { sound: false, touch: 'off', secret: 'x' },
  });
  assert.strictEqual(fetchStub.calls.length, 1);
  const call = fetchStub.calls[0];
  assert.strictEqual(call.init.method, 'PATCH');
  assert.ok(call.url.indexOf('/rest/v1/profiles?') > 0);
  assert.ok(call.url.indexOf('id=eq.' + encodeURIComponent(USER.id)) >= 0);
  assert.strictEqual(call.init.headers['Content-Type'], 'application/json');
  assert.strictEqual(call.init.headers.Prefer, 'return=representation');
  assert.strictEqual(call.init.headers.Authorization, 'Bearer access-1');
  assert.deepStrictEqual(call.body, {
    nickname: 'Muse小星',
    avatar: 'muse-5',
    prefs: { sound: false, touch: 'off' },
  }, '未知偏好键必须被丢弃');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(saved.prefs)), { sound: false, touch: 'off' });
});

testAsync('save：省略 avatar 时 PATCH 不含 avatar（保留云端未知/未来版本头像）', async () => {
  const { client, fetchStub } = makeClient(() => response(200, [row()]));
  await client.save({ nickname: '小星', prefs: { sound: true, touch: 'auto' } });
  assert.strictEqual(fetchStub.calls.length, 1);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(fetchStub.calls[0].body, 'avatar'),
    false,
    '省略 avatar 时必须从 PATCH body 中省略该字段'
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(fetchStub.calls[0].body)), {
    nickname: '小星', prefs: { sound: true, touch: 'auto' },
  });
});

testAsync('save：400 字段约束 → 中文提示（昵称/头像/偏好）', async () => {
  const nick = makeClient(() => response(400, {
    code: '23514',
    message: 'new row for relation "profiles" violates check constraint "profiles_nickname_check"',
  }));
  const nickErr = await rejectsCode(nick.client.save({ nickname: '小星', avatar: 'muse-1' }), 'nickname_invalid');
  assert.match(nickErr.message, /昵称/);

  const avatar = makeClient(() => response(400, {
    message: 'violates check constraint "profiles_avatar_check"',
  }));
  const avatarErr = await rejectsCode(avatar.client.save({ nickname: '小星', avatar: 'muse-2' }), 'avatar_invalid');
  assert.match(avatarErr.message, /头像/);

  const generic = makeClient(() => response(400, { message: 'JSON parse error' }));
  await rejectsCode(generic.client.save({ nickname: '小星', avatar: 'muse-2' }), 'bad_request');
});

testAsync('save：更新 0 行（资料行缺失/无权限）→ profile_missing，不谎报成功', async () => {
  const { client } = makeClient(() => response(200, []));
  await rejectsCode(client.save({ nickname: '小星', avatar: 'muse-2' }), 'profile_missing');
});

testAsync('save：5xx / 429 / 网络异常 → 云端暂不可用（不抛英文原文）', async () => {
  const server = makeClient(() => response(503, { message: 'upstream unavailable' }));
  const serverErr = await rejectsCode(server.client.save({ nickname: '小星', avatar: 'muse-1' }), 'server');
  assert.match(serverErr.message, /云端暂不可用/);

  const limited = makeClient(() => response(429, {}));
  await rejectsCode(limited.client.save({ nickname: '小星', avatar: 'muse-1' }), 'rate_limit');

  const offline = makeClient(() => { throw new TypeError('Failed to fetch'); });
  const offlineErr = await rejectsCode(offline.client.save({ nickname: '小星', avatar: 'muse-1' }), 'network');
  assert.match(offlineErr.message, /云端暂不可用/);
});

testAsync('save：401 后无法续期 → unauthorized（登录已过期）', async () => {
  const { client } = makeClient(() => response(401, { message: 'JWT expired' }), {
    authOptions: { refreshError: { code: 'invalid_refresh_token' } },
  });
  const err = await rejectsCode(client.save({ nickname: '小星', avatar: 'muse-1' }), 'unauthorized');
  assert.match(err.message, /登录已过期/);
});

testAsync('超时：请求超过 cloudConfig.timeoutMs 后 abort → timeout 中文提示', async () => {
  const { client } = makeClient((call) => new Promise((resolve, reject) => {
    const signal = call.init.signal;
    if (!signal) { reject(new Error('缺少 AbortSignal')); return; }
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), { sandboxOverrides: { MIXX_CLOUD_CONFIG: {
    url: 'https://test.supabase.co', anonKey: 'sb_publishable_test', timeoutMs: 20,
  } } });
  const err = await rejectsCode(client.load(), 'timeout');
  assert.match(err.message, /超时/);
});

/* ─────────────────── 运行 ─────────────────── */

(async function run() {
  for (const t of asyncTests) {
    try {
      await t.fn();
      passed++;
      console.log('  \u2713 ' + t.name);
    } catch (e) {
      failures.push({ name: t.name, e });
      console.error('  \u2717 ' + t.name + '\n      ' + (e && (e.stack || e.message)));
    }
  }
  console.log('');
  if (failures.length) {
    console.error('失败 ' + failures.length + ' 项 / 共 ' + (passed + failures.length) + ' 项');
    process.exit(1);
  }
  console.log('全部通过：' + passed + ' 项');
})();
