#!/usr/bin/env node
'use strict';
// All network I/O is stubbed. No accounts or saves are created on a real backend.
const assert = require('assert');
require('../js/cloud.js');
const { CloudClient, SaveSync, CloudError } = global.MIXX.cloud;
const clone = x => JSON.parse(JSON.stringify(x));
const slot = (time = 10) => ({ v: 1, slot: 1, current: 1, unlocked: 1,
  cleared: [], stars: { '1': ['s1'] }, sheep: 0, played: ['intro'], updatedAt: time });
const row = (n = 1, version = 1, time = 20, data = slot()) => ({ slot: n, version,
  updated_at: new Date(time).toISOString(), data });
const meta = (n = 1, version = 1, time = 20) => ({ slot: n, version, updatedAt: time });
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => clone(data) });
/** Create a controllable promise for account-switch and in-flight request regressions. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
/** Provide shared in-memory storage, usable by multiple simulated tabs. */
function storage() {
  const map = new Map();
  return { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v) };
}
/** Build the real transport around injectable auth and a recording fetch stub. */
function client(handler, extra) {
  const calls = [];
  const auth = { session: { user: { id: 'A' }, accessToken: 'old' },
    ensureFresh: async () => auth.session,
    refresh: async () => { auth.refreshCalls++; auth.session.accessToken = 'new'; return auth.session; }, refreshCalls: 0 };
  const config = { enabled: true, timeoutMs: 500,
    restUrl: p => 'https://test.invalid/rest/v1' + p,
    headers: token => ({ apikey: 'public-test', Authorization: 'Bearer ' + token }) };
  const c = new CloudClient({ auth, config, fetch: async (url, init) => {
    const call = { url, ...init, body: init.body && JSON.parse(init.body) };
    calls.push(call);
    return handler(call, calls.length);
  }, ...extra });
  return { c, auth, calls };
}
/** Build a sync coordinator with isolated local slots and a controllable cloud service. */
function sync(opts = {}) {
  const local = [slot(), null, null];
  const store = { readSlot: i => clone(local[i]), readAll: () => clone(local),
    writeSlot: (i, s) => { local[i] = clone(s); return true; } };
  const calls = [];
  const remote = opts.remote || [null, null, null];
  const stub = { list: async uid => { calls.push(['list', uid]); return clone(remote); },
    upload: async (uid, n, data, version) => { calls.push(['upload', uid, n, clone(data), version]);
      const m = meta(n, (version || 0) + 1, 20); remote[n - 1] = m; return m; },
    download: async (uid, n) => { calls.push(['download', uid, n]);
      return { meta: clone(remote[n - 1]), data: { ...slot(remote[n - 1].updatedAt), slot: n } }; },
    ...opts.client };
  const memory = opts.storage || storage();
  let changes = 0;
  const manager = new SaveSync({ store, storage: memory, client: stub,
    onChange: () => changes++, key: opts.key });
  return { manager, local, remote, stub, calls, store, memory, changes: () => changes };
}
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const code = c => err => err instanceof CloudError && err.code === c;

test('游客/未配置：零请求', async () => {
  const { c, calls } = client(() => { throw Error('unexpected'); }, { config: { enabled: false } });
  await assert.rejects(c.list('A'), code('unavailable'));
  assert.equal(calls.length, 0);
  const s = sync(); await s.manager.connect(''); await s.manager.save(0);
  assert.equal(s.calls.length, 0);
});
test('列表仅拉元数据，限定本人，Bearer/apikey 齐全', async () => {
  const { c, calls } = client(() => response(200, [row()]));
  assert.deepEqual(await c.list('A'), [meta(), null, null]);
  assert.match(calls[0].url, /user_id=eq.A&select=slot,version,updated_at$/);
  assert.equal(calls[0].headers.Authorization, 'Bearer old');
  assert.equal(calls[0].headers.apikey, 'public-test');
});
test('POST 首档：无无条件 upsert，移除本地 slot/updatedAt/version', async () => {
  const { c, calls } = client(() => response(201, [row()]));
  await c.upload('A', 1, { ...slot(), version: 99 }, null);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.user_id, 'A');
  assert.equal(calls[0].body.version, 1);
  assert.equal(calls[0].body.data.slot, undefined);
  assert.equal(calls[0].body.data.updatedAt, undefined);
  assert.equal(calls[0].body.data.version, undefined);
  assert.equal(calls[0].headers.Prefer, 'return=representation');
});
test('PATCH 乐观锁：期望版本过滤且只加一', async () => {
  const { c, calls } = client(() => response(200, [row(1, 4)]));
  await c.upload('A', 1, slot(), 3);
  assert.match(calls[0].url, /slot=eq.1&version=eq.3$/);
  assert.equal(calls[0].method, 'PATCH'); assert.equal(calls[0].body.version, 4);
});
test('409 和 HTTP 200 空数组均为冲突，不自动覆盖重试', async () => {
  for (const [status, rows] of [[409, {}], [200, []]]) {
    const { c, calls } = client(() => response(status, rows));
    await assert.rejects(c.upload('A', 1, slot(), 1), code('conflict'));
    assert.equal(calls.length, 1);
  }
});
test('401 续期一次，保持账号和请求内容', async () => {
  const { c, calls, auth } = client((_, n) => response(n === 1 ? 401 : 200, n === 1 ? {} : [row(1, 2)]));
  await c.upload('A', 1, slot(), 1);
  assert.equal(auth.refreshCalls, 1); assert.equal(calls.length, 2);
  assert.equal(calls[1].headers.Authorization, 'Bearer new');
  assert.deepEqual(calls[0].body, calls[1].body);
});
test('连续 401 不无限重试；403 不尝试续期', async () => {
  for (const status of [401, 403]) {
    const { c, calls, auth } = client(() => response(status, {}));
    await assert.rejects(c.list('A'), code('unauthorized'));
    assert.equal(calls.length, status === 401 ? 2 : 1);
    assert.equal(auth.refreshCalls, status === 401 ? 1 : 0);
  }
});
test('ensureFresh 等待期间切号：不发旧账号请求', async () => {
  const d = deferred(), { c, auth, calls } = client(() => response(200, []));
  auth.ensureFresh = () => d.promise;
  const task = c.upload('A', 1, slot(), null);
  auth.session = { user: { id: 'B' }, accessToken: 'B' };
  d.resolve(auth.session);
  await assert.rejects(task, code('unauthorized')); assert.equal(calls.length, 0);
});
test('401 回包前登出：不续期、不发送第二次请求', async () => {
  const d = deferred(), { c, auth, calls } = client(() => d.promise);
  const task = c.list('A'); await Promise.resolve();
  auth.session = null; d.resolve(response(401, {}));
  await assert.rejects(task, code('unauthorized'));
  assert.equal(auth.refreshCalls, 0); assert.equal(calls.length, 1);
});
test('续期等待期间切号：不用 B 的令牌重试 A 的存档', async () => {
  const d = deferred(), { c, auth, calls } = client(() => response(401, {}));
  const begun = deferred(); auth.refresh = () => { begun.resolve(); return d.promise; };
  const task = c.upload('A', 1, slot(), 1); await begun.promise;
  auth.session = { user: { id: 'B' }, accessToken: 'B' }; d.resolve(auth.session);
  await assert.rejects(task, code('unauthorized')); assert.equal(calls.length, 1);
});
test('网络失败 / 超时 / 非 JSON / 5xx 可编程错误', async () => {
  const { c } = client(() => { throw Error('offline'); });
  await assert.rejects(c.list('A'), code('network'));
  const slow = client(call => new Promise((_, reject) => {
    call.signal.addEventListener('abort', () => reject(Error('aborted')));
  })); slow.c.config.timeoutMs = 5;
  await assert.rejects(slow.c.list('A'), code('timeout'));
  const bad = client(() => ({ ok: true, status: 200, json: async () => { throw Error('bad json'); } }));
  await assert.rejects(bad.c.list('A'), code('invalid_response'));
  const down = client(() => response(503, {}));
  await assert.rejects(down.c.list('A'), code('unavailable'));
});
test('无效元数据、重复档位和未来版存档拒绝载入', async () => {
  for (const rows of [[row(4)], [row(1, 0)], [row(), row()], [{ ...row(), updated_at: 'oops' }]]) {
    const { c } = client(() => response(200, rows));
    await assert.rejects(c.list('A'), code('invalid_response'));
  }
  const { c } = client(() => response(200, [row(1, 1, 20, { ...slot(), v: 2 })]));
  await assert.rejects(c.download('A', 1), code('invalid_response'));
});
test('下载转换服务端 ISO 时间；只请求本人指定档', async () => {
  const { c, calls } = client(() => response(200, [row(2, 3, 12345)]));
  const result = await c.download('A', 2);
  assert.equal(result.data.updatedAt, 12345); assert.equal(result.data.slot, 2);
  assert.match(calls[0].url, /user_id=eq.A&slot=eq.2/);
});
test('登录只比较，不自动覆盖；无基线双方有档即冲突', async () => {
  const s = sync({ remote: [meta(), null, null] }); await s.manager.connect('A');
  assert.equal(s.manager.state(0), 'conflict'); assert.equal(s.manager.needsMerge, true);
  assert.equal(s.calls.length, 1); assert.equal(s.local[0].updatedAt, 10);
});
test('明确并入仅合并单边档，双方有档仍保留手动选择', async () => {
  const s = sync({ remote: [meta(), meta(2), null] }); await s.manager.connect('A');
  await s.manager.decide('merge');
  assert.equal(s.calls.filter(x => x[0] === 'upload').length, 0);
  assert.equal(s.calls.filter(x => x[0] === 'download').length, 1);
  assert.equal(s.manager.state(0), 'conflict'); assert.equal(s.manager.state(1), 'synced');
});
test('并入空云档：写入基线并持久化；重开后已同步', async () => {
  const s = sync(); await s.manager.connect('A'); await s.manager.decide('merge');
  assert.equal(s.manager.state(0), 'synced');
  const again = new SaveSync({ store: s.store, storage: s.memory, client: s.stub });
  await again.connect('A'); assert.equal(again.state(0), 'synced'); assert.equal(again.needsMerge, false);
});
test('云端变化只标较新；双方变化标冲突，不按时间自动覆盖', async () => {
  const s = sync(); await s.manager.connect('A'); await s.manager.decide('merge');
  s.remote[0] = meta(1, 2, 5); await s.manager.refresh();
  assert.equal(s.manager.state(0), 'newer'); assert.equal(s.local[0].updatedAt, 10);
  s.local[0].updatedAt = 100; assert.equal(s.manager.state(0), 'conflict');
});
test('已同步档离线保存：本地不丢，重开登录补传 pending', async () => {
  const s = sync(); await s.manager.connect('A'); await s.manager.decide('merge');
  const upload = s.stub.upload;
  s.stub.upload = async () => { throw new CloudError('network'); };
  s.local[0].updatedAt = 30; await s.manager.save(0, s.store.readSlot(0));
  assert.equal(s.manager.error.code, 'network'); assert.equal(s.local[0].updatedAt, 30);
  s.stub.upload = upload;
  const again = new SaveSync({ store: s.store, storage: s.memory, client: s.stub });
  await again.connect('A'); assert.equal(again.state(0), 'synced'); assert.equal(again.record.pending[0], false);
});
test('首次手动上传失败也可重开补传，未获同意的游客档不自动上传', async () => {
  const s = sync(); await s.manager.connect('A'); await s.manager.save(0);
  assert.equal(s.calls.filter(x => x[0] === 'upload').length, 0);
  const upload = s.stub.upload; s.stub.upload = async () => { throw new CloudError('network'); };
  await s.manager.transfer(0, 'upload'); s.stub.upload = upload;
  const again = new SaveSync({ store: s.store, storage: s.memory, client: s.stub });
  await again.connect('A'); assert.equal(again.state(0), 'synced');
});
test('冲突刷新元数据后停下，不自动重试或吞本机档', async () => {
  const s = sync({ client: { upload: async () => { throw new CloudError('conflict'); } } });
  await s.manager.connect('A'); await s.manager.transfer(0, 'upload');
  assert.equal(s.manager.error.code, 'conflict'); assert.equal(s.calls.length, 2);
  assert.equal(s.local[0].updatedAt, 10);
});
test('下载期间本机更新：拒绝覆盖', async () => {
  const d = deferred(); const s = sync({ remote: [meta(), null, null], client: { download: () => d.promise } });
  await s.manager.connect('A'); const task = s.manager.transfer(0, 'download');
  s.local[0].updatedAt = 99; d.resolve({ meta: meta(), data: slot(20) }); await task;
  assert.equal(s.manager.error.code, 'local_changed'); assert.equal(s.local[0].updatedAt, 99);
});
test('下载期间云端更新：拒绝使用未确认的新版本', async () => {
  const s = sync({ remote: [meta(), null, null], client: {
    download: async () => ({ meta: meta(1, 2, 40), data: slot(40) }) } });
  await s.manager.connect('A'); await s.manager.transfer(0, 'download');
  assert.equal(s.manager.error.code, 'conflict'); assert.equal(s.local[0].updatedAt, 10);
});
test('切号/登出/destroy 后在途下载不写入本地或基线', async () => {
  for (const mode of ['switch', 'logout', 'destroy']) {
    const d = deferred(); const s = sync({ remote: [meta(), null, null], client: { download: () => d.promise } });
    await s.manager.connect('A'); const task = s.manager.transfer(0, 'download');
    if (mode === 'destroy') s.manager.destroy(); else await s.manager.connect(mode === 'switch' ? 'B' : '');
    d.resolve({ meta: meta(), data: slot(20) }); await task;
    assert.equal(s.local[0].updatedAt, 10); assert.equal(s.manager.record.slots[0], null);
  }
});
test('A→B→A 不重用 A 的旧授权；B 不会补传 A 的 pending', async () => {
  const s = sync(); await s.manager.connect('A'); await s.manager.decide('merge');
  s.manager.record.pending[0] = true; s.manager._persist();
  const count = s.calls.length;
  await s.manager.connect('B'); assert.equal(s.manager.needsMerge, true);
  assert.equal(s.calls.length, count + 1); assert.equal(s.manager.record.slots[0], null);
  await s.manager.connect('A'); assert.equal(s.manager.needsMerge, true);
  assert.equal(s.manager.record.slots[0], null);
});
test('本地删除清基线，保留云备份；在途上传回包不复活基线', async () => {
  const d = deferred(); const s = sync({ client: { upload: () => d.promise } });
  await s.manager.connect('A'); const task = s.manager.transfer(0, 'upload');
  s.local[0] = null; s.manager.forget(0); d.resolve(meta()); await task;
  assert.equal(s.manager.record.slots[0], null); assert.equal(s.manager.record.pending[0], false);
});
test('登出后删除本机档也清持久化基线，下次登录不复用', async () => {
  const s = sync(); await s.manager.connect('A'); await s.manager.decide('merge');
  await s.manager.connect(''); s.local[0] = null; s.manager.forget(0);
  await s.manager.connect('A');
  assert.equal(s.manager.record.slots[0], null);
  assert.equal(s.manager.state(0), 'download');
});
test('上传期间再次本地保存：基线只绑定已上传的快照，pending 保留', async () => {
  const d = deferred(); const s = sync({ client: { upload: () => d.promise } });
  await s.manager.connect('A'); const task = s.manager.transfer(0, 'upload');
  s.local[0].updatedAt = 99; d.resolve(meta()); await task;
  assert.equal(s.manager.record.slots[0].localUpdatedAt, 10);
  assert.equal(s.manager.record.pending[0], true); assert.equal(s.manager.state(0), 'upload');
});
test('损坏/旧版基线和失败写盘均不授权自动覆盖', async () => {
  for (const raw of ['broken', JSON.stringify({ v: 2, userId: 'A', slots: [] })]) {
    const memory = storage(); memory.setItem('mixxtopia.cloud.v1', raw);
    const s = sync({ storage: memory, remote: [meta(), null, null] }); await s.manager.connect('A');
    assert.equal(s.manager.state(0), 'conflict'); assert.equal(s.manager.record.slots[0], null);
  }
  const s = sync({ storage: { getItem: () => null, setItem: () => { throw Error('quota'); } } });
  await s.manager.connect('A'); await s.manager.transfer(0, 'upload');
  assert.equal(s.manager.error.code, 'storage'); assert.equal(s.calls.filter(c => c[0] === 'upload').length, 0);
});
test('本地存储拒绝云档：不写成功基线', async () => {
  const s = sync({ remote: [meta(), null, null] }); s.store.writeSlot = () => false;
  await s.manager.connect('A'); await s.manager.transfer(0, 'download');
  assert.equal(s.manager.error.code, 'storage'); assert.equal(s.manager.record.slots[0], null);
});
test('通道使用独立基线键', async () => {
  const memory = storage(), a = sync({ storage: memory }), b = sync({ storage: memory, key: 'mixxtopia.cloud.beta.v1' });
  await a.manager.connect('A'); await a.manager.decide('merge');
  await b.manager.connect('A'); assert.equal(b.manager.record.slots[0], null);
});

test('非 JSON 401 仍续期重试；403/5xx 保留 HTTP 错误语义', async () => {
  const html = status => ({ status, ok: false, json: async () => { throw new SyntaxError('HTML'); } });
  const a = client((_, n) => n === 1 ? html(401) : response(200, []));
  await a.c.list('A'); assert.equal(a.auth.refreshCalls, 1); assert.equal(a.calls.length, 2);
  for (const [status, expected] of [[403, 'unauthorized'], [503, 'unavailable'], [409, 'conflict']]) {
    const b = client(() => html(status));
    await assert.rejects(b.c.list('A'), code(expected));
    assert.equal(b.auth.refreshCalls, 0);
  }
});
test('响应体读取超时仍为 timeout，不被 JSON 容错吞掉', async () => {
  const a = client(call => ({ status: 200, ok: true, json: () => new Promise((_, reject) => {
    call.signal.addEventListener('abort', () => reject(Error('body aborted')));
  }) }));
  a.c.config.timeoutMs = 5;
  await assert.rejects(a.c.list('A'), code('timeout'));
});
test('列表读取失败不能持久化并入选择；重试后可正常并入', async () => {
  const s = sync(), list = s.stub.list;
  s.stub.list = async () => { throw new CloudError('network'); };
  await s.manager.connect('A');
  for (const mode of ['merge', 'cloud']) {
    await s.manager.decide(mode);
    assert.equal(s.manager.record.decision, ''); assert.equal(s.manager.needsMerge, true);
  }
  s.stub.list = list; await s.manager.refresh(true); await s.manager.decide('merge');
  assert.equal(s.manager.state(0), 'synced');
});
test('共享存储中 B 覆盖本机档后，旧 A 标签页不能用 pending 补传 B 的进度', async () => {
  const a = sync(); await a.manager.connect('A'); await a.manager.decide('merge');
  const upload = a.stub.upload;
  a.stub.upload = async () => { throw new CloudError('network'); };
  a.local[0].updatedAt = 30; await a.manager.save(0, a.store.readSlot(0));
  const b = new SaveSync({ client: a.stub, store: a.store, storage: a.memory });
  await b.connect('B'); a.local[0].sheep = 6;
  const recordB = a.memory.getItem('mixxtopia.cloud.v1'), before = a.calls.length;
  a.stub.upload = upload;
  await a.manager.refresh(true);
  await a.manager.save(0, a.store.readSlot(0));
  await a.manager.transfer(0, 'upload');
  assert.equal(a.manager.error.code, 'account_changed');
  assert.equal(a.calls.length, before); assert.equal(a.memory.getItem('mixxtopia.cloud.v1'), recordB);
});
test('A→B→新 A 标签页：旧 A 不能在账号名相同后复用旧授权', async () => {
  const a = sync(); await a.manager.connect('A'); await a.manager.decide('merge');
  const b = new SaveSync({ client: a.stub, store: a.store, storage: a.memory }); await b.connect('B');
  const again = new SaveSync({ client: a.stub, store: a.store, storage: a.memory }); await again.connect('A');
  const before = a.calls.length;
  await a.manager.refresh(true);
  assert.equal(a.manager.invalidated, true); assert.equal(a.calls.length, before);
  assert.equal(again.needsMerge, true);
});
test('在途下载期间另一标签页切号：不落本机也不覆盖新账号记录', async () => {
  const d = deferred(); const a = sync({ remote: [meta(), null, null], client: { download: () => d.promise } });
  await a.manager.connect('A'); const task = a.manager.transfer(0, 'download');
  const b = new SaveSync({ client: a.stub, store: a.store, storage: a.memory }); await b.connect('B');
  const recordB = a.memory.getItem('mixxtopia.cloud.v1');
  d.resolve({ meta: meta(), data: slot(20) }); await task;
  assert.equal(a.local[0].updatedAt, 10); assert.equal(a.manager.error.code, 'account_changed');
  assert.equal(a.memory.getItem('mixxtopia.cloud.v1'), recordB);
});
test('pending 重试只接受已授权快照，其他页面修改后须重新确认', async () => {
  const a = sync(); await a.manager.connect('A'); await a.manager.decide('merge');
  const upload = a.stub.upload;
  a.stub.upload = async () => { throw new CloudError('network'); };
  a.local[0].updatedAt = 30; await a.manager.save(0, a.store.readSlot(0));
  a.stub.upload = upload;
  // Simulate a guest/older build changing data without touching the ownership record.
  a.local[0].sheep = 6;
  const before = a.calls.length;
  await a.manager.refresh(true);
  assert.equal(a.calls.length, before + 1); // metadata GET only
  assert.equal(a.manager.error.code, 'local_changed'); assert.equal(a.manager.needsMerge, true);
  assert.equal(a.manager.record.pending[0], false);
  assert.equal(a.manager.record.slots[0], null);
});
test('本地保存提供的快照与共享槽位不同：不授权自动上传', async () => {
  const a = sync(); await a.manager.connect('A'); await a.manager.decide('merge');
  const own = { ...a.store.readSlot(0), updatedAt: 50 };
  a.local[0] = { ...own, sheep: 6 };
  const before = a.calls.length;
  await a.manager.save(0, own);
  assert.equal(a.calls.length, before); assert.equal(a.manager.error.code, 'local_changed');
});
(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('  ✓ ' + t.name); }
    catch (err) { failed++; console.error('  ✗ ' + t.name + '\n' + err.stack); }
  }
  console.log((failed ? '失败 ' + failed + ' / ' : '全部通过：') + tests.length + ' 项');
  process.exitCode = failed ? 1 : 0;
})();
