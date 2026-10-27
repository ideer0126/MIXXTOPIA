#!/usr/bin/env node
'use strict';
const assert = require('assert');
require('../js/cloud.js'); require('../js/stats.js');
const { StatsTracker, StatsClient, collectionRates, localCollections } = global.MIXX.stats;
const copy = x => JSON.parse(JSON.stringify(x));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function storage() {
  const map = new Map();
  return { get length() { return map.size; }, key: i => [...map.keys()][i] || null,
    getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
}
function deferred() {
  let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve };
}
function server() {
  const rows = new Map(), calls = [];
  let offline = false, loseReply = false;
  const client = { merge: async (uid, r) => {
    calls.push({ uid, r: copy(r) });
    if (offline) throw Error('offline');
    const row = rows.get(uid) || { user_id: uid, play_seconds: 0, remainder_ms: 0, achievements: [], device_millis: {}, collections: {} };
    const n = Math.round(r.seconds * 1000), before = row.device_millis[r.writer] || 0;
    const ms = row.play_seconds * 1000 + row.remainder_ms + Math.max(0, n - before);
    row.play_seconds = Math.floor(ms / 1000); row.remainder_ms = ms % 1000;
    row.device_millis[r.writer] = Math.max(before, n);
    row.achievements = [...new Set(row.achievements.concat(r.achievements))];
    rows.set(uid, row);
    if (loseReply) { loseReply = false; throw Error('reply lost'); }
    return copy(row);
  } };
  return { client, rows, calls, offline: v => { offline = v; }, loseReply: () => { loseReply = true; } };
}
function tracker(s, memory = storage(), key) { return new StatsTracker({ client: s.client, storage: memory, key }); }
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
function transport(handler, extra) {
  const auth = { session: { user: { id: 'A' }, accessToken: 'old' },
    ensureFresh: async () => auth.session, refresh: async () => { auth.session.accessToken = 'new'; return auth.session; } };
  const calls = [];
  const c = new StatsClient({ auth, config: { enabled: true, timeoutMs: 10,
    restUrl: p => 'https://test.invalid/rest/v1' + p, headers: t => ({ Authorization: 'Bearer ' + t, apikey: 'public' }) },
    fetch: async (url, init) => { calls.push({ url, ...init }); return handler(init, calls.length); }, ...extra });
  return { c, auth, calls };
}
const record = { writer: 'a'.repeat(32), seconds: 7.9, achievements: ['first_star'] };
const row = () => ({ user_id: 'A', play_seconds: 7, remainder_ms: 900, achievements: ['first_star'], device_millis: { [record.writer]: 7900 }, collections: { 1: ['s1'] } });

test('游客零请求；本机时长与成就跨重开保留，小数结转', async () => {
  const s = server(), memory = storage(), t = tracker(s, memory); await t.connect('');
  t.tick(1.75); t.unlock('first_star'); t.destroy();
  const t2 = tracker(s, memory); await t2.connect(''); t2.tick(0.5);
  // Fractional remainders from different sessions add up before formatting whole seconds.
  assert.equal(t2.view().seconds, 2); t2.tick(0.5); assert.equal(t2.view().seconds, 2);
  assert.deepEqual(t2.view().achievements, ['first_star']); assert.equal(s.calls.length, 0);
});
test('游客统计不自动并入账户，A/B/游客分别累计', async () => {
  const s = server(), t = tracker(s); await t.connect(''); t.tick(8);
  await t.connect('A'); t.tick(3); await t.sync();
  await t.connect('B'); t.tick(2); await t.sync();
  assert.equal(s.rows.get('A').play_seconds, 3); assert.equal(s.rows.get('B').play_seconds, 2);
  await t.connect(''); assert.equal(t.view().seconds, 8);
});
test('离线累计持久化，下次同账号登录补传', async () => {
  const s = server(), memory = storage(), t = tracker(s, memory); await t.connect('A');
  s.offline(true); t.tick(12.5); t.unlock('first_clear'); assert.equal(await t.sync(), false);
  assert.equal(t.view().seconds, 12); t.destroy();
  s.offline(false); const t2 = tracker(s, memory); await t2.connect('A');
  assert.equal(s.rows.get('A').play_seconds, 12); assert.ok(t2.view().achievements.includes('first_clear'));
  assert.equal(t2.view().pending, false);
});
test('服务端已提交但响应丢失，重试不重复累计', async () => {
  const s = server(), t = tracker(s); await t.connect('A'); t.tick(9);
  s.loseReply(); assert.equal(await t.sync(), false); assert.equal(s.rows.get('A').play_seconds, 9);
  await t.sync(); await t.sync(); assert.equal(t.view().seconds, 9); assert.equal(s.rows.get('A').play_seconds, 9);
});
test('共享本机存储的双标签页分别写入，不互相覆盖或重复统计', async () => {
  const s = server(), memory = storage(), a = tracker(s, memory), b = tracker(s, memory);
  await a.connect('A'); await b.connect('A'); assert.notEqual(a.record.writer, b.record.writer);
  a.tick(5); b.tick(7); await Promise.all([a.sync(), b.sync()]);
  await a.sync(); await b.sync(); assert.equal(s.rows.get('A').play_seconds, 12);
  assert.equal(a.view().seconds, 12); assert.equal(b.view().seconds, 12);
});
test('独立设备累计相加，成就取并集，云收集率一致', async () => {
  const s = server(), a = tracker(s), b = tracker(s); await a.connect('A'); await b.connect('A');
  a.tick(5); a.unlock('first_star'); await a.sync();
  b.tick(7); b.unlock('first_clear'); await b.sync();
  s.rows.get('A').collections = { 1: ['s1'] }; await a.sync(); await b.sync();
  assert.equal(a.view().seconds, 12); assert.deepEqual(a.view(), b.view());
});
test('请求期间新增长时，在下一次保存同步中上传', async () => {
  const s = server(), t = tracker(s); await t.connect('A'); t.tick(2);
  const d = deferred(), base = s.client.merge;
  s.client.merge = async (uid, r) => { await d.promise; return base(uid, r); };
  const first = t.sync(); await Promise.resolve(); t.tick(4); const second = t.sync(); d.resolve();
  await first; await second; assert.equal(s.rows.get('A').play_seconds, 6);
});
test('切号与 destroy 丢弃旧回包，不污染新账号缓存', async () => {
  const s = server(), t = tracker(s); await t.connect('A'); t.tick(2);
  const d = deferred(), base = s.client.merge;
  s.client.merge = async (uid, r) => { if (uid === 'A') await d.promise; return base(uid, r); };
  const old = t.sync(); await Promise.resolve(); await t.connect('B'); t.tick(3); await t.sync();
  d.resolve(); await old; assert.equal(t.uid, 'B'); assert.equal(t.view().seconds, 3);
  const cache = copy(t.remote); t.destroy(); assert.deepEqual(t.remote, cache);
});
test('跨标签页切号撤销统计上传与计时，保留原账号离线记录', async () => {
  const s = server(), t = tracker(s); await t.connect('A'); t.tick(4); t.suspend();
  const calls = s.calls.length; t.tick(10); t.unlock('first_star'); await t.sync();
  assert.equal(s.calls.length, calls); assert.equal(t.view().seconds, 4);
  assert.deepEqual(t.view().achievements, []);
});
test('本地存储失败保留内存数据，恢复后可补传', async () => {
  const s = server(), memory = storage(), t = tracker(s, memory); await t.connect('A');
  const write = memory.setItem; memory.setItem = () => { throw Error('quota'); };
  t.tick(3); assert.equal(await t.sync(), false); assert.equal(t.view().seconds, 3); assert.ok(t.error);
  memory.setItem = write; await t.sync(); assert.equal(s.rows.get('A').play_seconds, 3);
});
test('通道键隔离；损坏和伪造归属的 journal 不上传', async () => {
  const s = server(), memory = storage(), a = tracker(s, memory, 'stable'), b = tracker(s, memory, 'beta');
  await a.connect('A'); a.tick(10); a.flush();
  await b.connect('A'); assert.equal(b.view().seconds, 0);
  memory.setItem('beta.journal.A.' + 'c'.repeat(32), JSON.stringify({ v: 1, uid: 'B', writer: 'c'.repeat(32), seconds: 999, achievements: [] }));
  await b.sync(); assert.equal(s.rows.get('A').play_seconds, 0);
});
test('同关跨档去重，未知星 ID 不计入；空关卡无 NaN', () => {
  const levels = [{ id: 0 }, { id: 1, title: '关一', entities: [{ type: 'star', id: 's1' }, { type: 'star', id: 's2' }] }, { id: 2 }];
  const collected = localCollections([{ stars: { 1: ['s1', 's1', 'bad'] } }, { stars: { 1: ['s1'] } }]);
  assert.deepEqual(collectionRates(levels, collected).map(l => [l.got, l.total, l.percent]), [[1, 2, 50], [0, 0, 0]]);
});
test('RPC 绑定本人 Bearer，发送单调毫秒与成就', async () => {
  const { c, calls } = transport(() => response(200, [row()])); await c.merge('A', record);
  assert.match(calls[0].url, /\/rpc\/merge_stats$/); assert.equal(calls[0].headers.Authorization, 'Bearer old');
  assert.deepEqual(JSON.parse(calls[0].body), { p_writer: record.writer, p_millis: 7900, p_achievements: ['first_star'] });
});
test('401 只续期一次；非 JSON 401 也保留身份错误语义', async () => {
  const { c, calls } = transport((init, n) => n === 1 ? { status: 401, json: async () => { throw Error(); } } : response(200, [row()]));
  await c.merge('A', record); assert.equal(calls.length, 2); assert.equal(calls[1].headers.Authorization, 'Bearer new');
});
test('续期/请求期间切号或撤销：拒绝旧账号上传与回包', async () => {
  const d = deferred(), { c, auth, calls } = transport(() => response(200, [row()]));
  auth.ensureFresh = () => d.promise; const task = c.merge('A', record);
  auth.session = { user: { id: 'B' }, accessToken: 'B' }; d.resolve(auth.session);
  await assert.rejects(task); assert.equal(calls.length, 0);
  let allowed = true; const r = deferred();
  const f = transport(() => r.promise, { isCurrent: () => allowed });
  const request = f.c.merge('A', record); await Promise.resolve(); allowed = false; r.resolve(response(200, [row()]));
  await assert.rejects(request, e => e.code === 'account_changed');
});
test('storage 事件尚未到达时，共享会话切号也不能发送旧账号请求', async () => {
  const { c, auth, calls } = transport(() => response(200, [row()]));
  auth.storage = storage(); auth.key = 'session';
  auth.storage.setItem('session', JSON.stringify({ user: { id: 'B' } }));
  await assert.rejects(c.merge('A', record), e => e.code === 'account_changed');
  assert.equal(calls.length, 0);
});
test('单条损坏 journal 不妨碍后续有效离线记录补传', async () => {
  const s = server(), memory = storage(), t = tracker(s, memory);
  memory.setItem('mixxtopia.stats.v1.journal.A.bad', '{');
  await t.connect('A'); t.tick(4); t.flush(); t.destroy();
  const t2 = tracker(s, memory); await t2.connect('A');
  assert.equal(s.rows.get('A').play_seconds, 4);
});
test('错误 owner、异常字段、空回包、5xx 拒绝标为成功', async () => {
  for (const data of [[], [{ ...row(), user_id: 'B' }], [{ ...row(), play_seconds: -1 }], [{ ...row(), collections: [] }]]) {
    const { c } = transport(() => response(200, data)); await assert.rejects(c.merge('A', record));
  }
  const { c } = transport(() => response(500, {})); await assert.rejects(c.merge('A', record));
});
test('请求超时不会丢本地 journal', async () => {
  const { c } = transport(init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error()))));
  await assert.rejects(c.merge('A', record), e => e.code === 'timeout');
});
(async () => {
  let failures = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('  ✓ ' + t.name); }
    catch (err) { failures++; console.error('  ✗ ' + t.name + '\n' + err.stack); }
  }
  console.log((failures ? '失败：' + failures : '全部通过：' + tests.length) + ' 项');
  process.exitCode = failures ? 1 : 0;
})();
