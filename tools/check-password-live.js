#!/usr/bin/env node
'use strict';
// Manual, bounded integration check of the current Auth client against a named TEST
// project. Creates ONE disposable account and changes only its generated password.
// Never use existing credentials; no password-write retries, polling, migrations or deletion.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');
const repo = path.resolve(__dirname, '..');
const usage = 'Usage: node tools/check-password-live.js --allow-test-writes --project hlnubesywvcxdghfyoux --out /tmp/password-live.json';
const args = process.argv.slice(2);
if (args.length !== 5 || args[0] !== '--allow-test-writes' || args[1] !== '--project'
  || args[2] !== 'hlnubesywvcxdghfyoux' || args[3] !== '--out' || !args[4] || args[4].startsWith('--')) {
  console.error(usage); process.exit(2);
}
const out = path.resolve(args[4]);
const copy = value => JSON.parse(JSON.stringify(value));
const report = { observedAt: new Date().toISOString(), project: args[2],
  testMode: 'Current local clients with real REST; no browser or deployed-page assertion',
  checks: [], requests: [], account: null, passed: false };
function persist() { fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
function memory() {
  const map = new Map();
  return { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k), keys: () => [...map.keys()] };
}
async function check(name, fn) {
  report.activeCheck = name;
  await fn(); report.checks.push({ name, passed: true }); delete report.activeCheck; persist(); console.log('✓ ' + name);
}
async function rejectCode(task, code) {
  let caught;
  try { await task; } catch (err) { caught = err; }
  assert.ok(caught, 'Expected request rejection'); assert.equal(caught.code, code);
}
(async () => {
  // Establish a writable output path before any cloud writes; secrets stay in memory.
  persist();
  const sandbox = { setTimeout, clearTimeout, AbortController,
    fetch: async (url, init = {}) => {
      const target = new URL(url);
      assert.equal(target.origin, 'https://' + args[2] + '.supabase.co', 'Unexpected target project');
      const response = await fetch(url, { ...init, redirect: 'error', signal: init.signal || AbortSignal.timeout(10000) });
      report.requests.push({ method: init.method || 'GET', path: target.pathname,
        grant: target.searchParams.get('grant_type') || undefined, status: response.status });
      return response;
    } };
  vm.createContext(sandbox);
  for (const file of ['cloud-config', 'auth', 'cloud', 'stats']) {
    vm.runInContext(fs.readFileSync(path.join(repo, 'js', file + '.js'), 'utf8'), sandbox, { filename: 'js/' + file + '.js' });
  }
  const mixx = sandbox.MIXX, config = mixx.cloudConfig;
  assert.equal(config.url, 'https://' + args[2] + '.supabase.co');
  const settings = await sandbox.fetch(config.authUrl('/settings'), { headers: config.headers() });
  assert.equal(settings.status, 200);
  const flags = await settings.json();
  assert.equal(flags.disable_signup, false, 'Signup must be enabled; do not modify project settings');
  assert.equal(flags.mailer_autoconfirm, true, 'Requires auto-confirmed test accounts; do not send email or alter settings');
  const run = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
  const email = 'mixxtopia-password-' + run + '@example.com';
  const oldPassword = crypto.randomBytes(24).toString('base64url') + 'aA1!';
  const newPassword = crypto.randomBytes(24).toString('base64url') + 'bB2!';
  const storage = memory(), key = mixx.auth.sessionKeyFor('beta');
  const auth = mixx.auth.createClient({ storage, key });
  let uid;
  const read = async (client, resource) => {
    const session = await client.ensureFresh();
    const response = await sandbox.fetch(config.restUrl(resource), { headers: config.headers(session.accessToken) });
    assert.equal(response.status, 200, 'Owned resource must remain accessible');
    return response.json();
  };
  const profilePath = () => '/profiles?id=eq.' + uid + '&select=id,nickname,avatar,prefs';
  const statsPath = () => '/stats?user_id=eq.' + uid + '&select=user_id,play_seconds,remainder_ms,device_millis,achievements,collections';
  await check('register exactly one new test account with automatic profile creation', async () => {
    const result = await auth.signUp(email, oldPassword);
    uid = result.user.id;
    if (uid) { report.account = { id: uid, email, cleanup: 'Retained; deletion requires separate authorization' }; persist(); }
    assert.ok(result.session && uid, 'Registration must return a usable session');
    assert.equal((await read(auth, profilePath())).length, 1);
  });
  const cloud = mixx.cloud.createClient({ auth, root: sandbox });
  const stats = new mixx.stats.StatsClient({ auth, root: sandbox });
  const localSaveKey = 'mixxtopia.save.beta.v1', settingsKey = 'mixxtopia.settings.beta.v1';
  let profileBefore, statsBefore, saveBefore;
  await check('seed own cloud save-stat fixtures and local persistence baseline', async () => {
    const save = { v: 1, slot: 1, current: 1, unlocked: 1, cleared: [], stars: { 1: ['s1'] },
      sheep: 0, played: ['l1.intro'], updatedAt: Date.now() };
    await cloud.upload(uid, 1, save, null);
    await stats.merge(uid, { writer: crypto.randomBytes(16).toString('hex'), seconds: 2.5, achievements: ['first_star'] });
    saveBefore = copy(await cloud.download(uid, 1));
    storage.setItem(localSaveKey, JSON.stringify({ v: 1, slots: [saveBefore.data, null, null] }));
    storage.setItem(settingsKey, JSON.stringify({ v: 1, sound: false, touch: 'auto' }));
    profileBefore = await read(auth, profilePath()); statsBefore = await read(auth, statsPath());
    assert.equal(statsBefore[0].play_seconds * 1000 + statsBefore[0].remainder_ms, 2500);
    assert.deepEqual(statsBefore[0].collections, { 1: ['s1'] });
  });
  const localBefore = [storage.getItem(localSaveKey), storage.getItem(settingsKey)];
  await check('same-short passwords fail locally; wrong current password never reaches PUT', async () => {
    const count = report.requests.length;
    await rejectCode(auth.changePassword(oldPassword, oldPassword), 'same_password');
    await rejectCode(auth.changePassword(oldPassword, 'x'), 'short_password');
    assert.equal(report.requests.length, count);
    const writes = report.requests.filter(r => r.method === 'PUT').length;
    await rejectCode(auth.changePassword('incorrect-current-password', newPassword), 'wrong_current_password');
    assert.equal(report.requests.filter(r => r.method === 'PUT').length, writes);
  });
  await check('current local changePassword client succeeds against real GoTrue', async () => {
    assert.equal((await auth.changePassword(oldPassword, newPassword)).id, uid);
    assert.equal(report.requests.filter(r => r.method === 'PUT' && r.path === '/auth/v1/user').length, 1);
    assert.deepEqual([storage.getItem(localSaveKey), storage.getItem(settingsKey)], localBefore);
    const stored = storage.getItem(key);
    assert.ok(!stored.includes(oldPassword) && !stored.includes(newPassword), 'Passwords must never be persisted');
  });
  await check('current session retains cloud data and refreshes after the password change', async () => {
    assert.deepEqual(copy(await cloud.download(uid, 1)), saveBefore);
    assert.deepEqual(await read(auth, profilePath()), profileBefore);
    assert.deepEqual(await read(auth, statsPath()), statsBefore);
    assert.equal((await auth.refresh()).user.id, uid);
  });
  const second = mixx.auth.createClient({ storage: memory(), key });
  await check('old password rejected; new password logs into a separate client', async () => {
    await rejectCode(second.signIn(email, oldPassword), 'invalid_credentials');
    assert.equal((await second.signIn(email, newPassword)).user.id, uid);
    const nextCloud = mixx.cloud.createClient({ auth: second, root: sandbox });
    assert.deepEqual(copy(await nextCloud.download(uid, 1)), saveBefore);
    assert.deepEqual(await read(second, profilePath()), profileBefore);
    assert.deepEqual(await read(second, statsPath()), statsBefore);
  });
  await check('sign out only the new test account sessions; retain local save-settings', async () => {
    await auth.signOut(); await second.signOut();
    assert.deepEqual([storage.getItem(localSaveKey), storage.getItem(settingsKey)], localBefore);
    assert.equal(storage.getItem(key), null);
  });
  report.passed = true; report.finishedAt = new Date().toISOString(); persist();
  console.log('Real REST checks passed; sanitized report: ' + out);
  console.log('New test account remains for separately authorized cleanup. No passwords/tokens saved.');
})().catch(err => {
  // Do not print response objects, request bodies, password strings or token-bearing sessions.
  report.error = err.code || 'check_failed'; persist();
  console.error('Check stopped: ' + report.error + '; see sanitized report: ' + out);
  process.exitCode = 1;
});
