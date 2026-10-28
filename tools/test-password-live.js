#!/usr/bin/env node
'use strict';
// Exercise the opt-in live checker with an in-memory Auth/REST server. No network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(__dirname, 'check-password-live.js'), 'utf8');
async function run(args) {
  const files = new Map(), calls = [];
  let email, password, save, stats, sequence = 0;
  const user = { id: 'live-fixture-user', email: '' };
  const session = () => ({ user, access_token: 'fixture-access-' + (++sequence),
    refresh_token: 'fixture-refresh-' + sequence, expires_in: 3600 });
  const profile = { id: user.id, nickname: 'NSWER', avatar: 'muse-1', prefs: { sound: true } };
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', body = init.body && JSON.parse(init.body);
    calls.push({ path: u.pathname, method });
    const response = (status, value) => new Response(status === 204 ? null : JSON.stringify(value), { status });
    if (u.pathname === '/auth/v1/settings') return response(200, { disable_signup: false, mailer_autoconfirm: true });
    if (u.pathname === '/auth/v1/signup') {
      assert.equal(email, undefined, 'checker may create only one account');
      email = body.email; password = body.password; user.email = email; return response(200, session());
    }
    if (u.pathname === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'refresh_token' || body.email === email && body.password === password) return response(200, session());
      return response(400, { error_code: 'invalid_credentials' });
    }
    if (u.pathname === '/auth/v1/user') {
      assert.equal(method, 'PUT'); assert.equal(body.current_password, password);
      assert.ok(body.password !== password); password = body.password; return response(200, user);
    }
    if (u.pathname === '/auth/v1/logout') return response(204);
    assert.ok(init.headers.Authorization.startsWith('Bearer fixture-access-'));
    if (u.pathname === '/rest/v1/profiles') return response(200, [profile]);
    if (u.pathname === '/rest/v1/saves') {
      if (method === 'POST') save = { ...body, updated_at: '2026-10-28T00:00:00Z' };
      else assert.equal(method, 'GET');
      return response(200, [save]);
    }
    if (u.pathname === '/rest/v1/rpc/merge_stats') {
      stats = { user_id: user.id, play_seconds: 2, remainder_ms: 500,
        device_millis: { [body.p_writer]: body.p_millis }, achievements: body.p_achievements, collections: { 1: ['s1'] } };
      return response(200, [stats]);
    }
    if (u.pathname === '/rest/v1/stats') return response(200, [stats]);
    throw Error('Unexpected request: ' + u.pathname);
  };
  const proc = { argv: ['node', 'check-password-live.js', ...args], exitCode: 0,
    exit(code) { const error = new Error('CLI exit'); error.exitCode = code; throw error; } };
  const context = { __dirname, URL, AbortSignal, AbortController, setTimeout, clearTimeout, process: proc, fetch,
    console: { log() {}, error() {} }, require(name) {
      if (name === 'fs') return { readFileSync: fs.readFileSync, writeFileSync(file, data) { files.set(file, data); } };
      return require(name);
    } };
  try { await vm.runInNewContext(script, context, { filename: 'check-password-live.js' }); }
  catch (err) { if (err.exitCode === undefined) throw err; proc.exitCode = err.exitCode; }
  return { files, calls, status: proc.exitCode };
}
(async () => {
  const invalid = await run([]);
  assert.equal(invalid.status, 2); assert.equal(invalid.calls.length, 0);
  const wrongProject = await run(['--allow-test-writes', '--project', 'production', '--out', '/tmp/live-check.json']);
  assert.equal(wrongProject.status, 2); assert.equal(wrongProject.calls.length, 0);
  console.log('  ✓ missing consent flag or wrong project: zero requests');
  const valid = await run(['--allow-test-writes', '--project', 'hlnubesywvcxdghfyoux', '--out', '/tmp/live-check.json']);
  assert.equal(valid.status, 0);
  const report = JSON.parse(valid.files.get('/tmp/live-check.json'));
  assert.equal(report.passed, true); assert.equal(report.checks.length, 7);
  assert.equal(valid.calls.filter(c => c.path.endsWith('/signup')).length, 1);
  assert.equal(valid.calls.filter(c => c.method === 'PUT').length, 1);
  assert.ok(!valid.calls.some(c => c.method === 'DELETE'));
  assert.ok(!JSON.stringify(report).includes('fixture-access-'));
  assert.ok(!JSON.stringify(report).includes('fixture-refresh-'));
  console.log('  ✓ one new account / one password change / seven checks / no deletion or token disclosure');
  console.log('全部通过：2 组真实验收脚本本地检查');
})().catch(err => { console.error(err.message); process.exitCode = 1; });
