#!/usr/bin/env node
'use strict';
// One bounded, read-only snapshot of the deployed #47 prerequisites. No login or RPC calls.
// Usage: node tools/check-account-release.js [--out /tmp/account-release.json]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const repo = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) {
  console.error('Usage: node tools/check-account-release.js [--out /tmp/account-release.json]');
  process.exit(2);
}
const base = 'https://ideer0126.github.io/MIXXTOPIA/';
const expectedCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
async function read(url, headers) {
  try {
    const res = await fetch(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    // The same deadline covers response headers and body. Never retry or poll.
    return { status: res.status, text: await res.text() };
  } catch (err) { return { status: null, error: err.message }; }
}
function json(response) {
  try { return JSON.parse(response.text); } catch (err) { return null; }
}
(async () => {
  const report = { observedAt: new Date().toISOString(), expectedCommit, channels: [], backends: [],
    blockers: [], pending: ['Authenticated cross-account RLS and cross-device verification',
      'Separate test and production backends', 'Manual account deletion and cascade verification'] };
  const snapshots = await Promise.all(['', 'beta/', 'preview/'].map(async prefix => {
    const [meta, html] = await Promise.all([read(base + prefix + 'channel.json'), read(base + prefix)]);
    return { prefix, meta, html };
  }));
  for (const { prefix, meta, html } of snapshots) {
    const info = json(meta), game = !!html.text && html.text.includes('js/main.js');
    const required = ['auth', 'account', 'cloud', 'stats'];
    const missing = game ? required.filter(name => !html.text.includes('src="js/' + name + '.js"')) : [];
    const item = { url: base + prefix, status: html.status, metadata: info, game, missingScripts: missing };
    report.channels.push(item);
    if (meta.status !== 200 || html.status !== 200 || !info) report.blockers.push(item.url + ': unreadable deployment');
    if (game && missing.length) report.blockers.push(item.url + ': missing scripts ' + missing.join(', '));
    if (game && info && info.commit !== expectedCommit) report.blockers.push(item.url + ': deployed commit differs from local HEAD');
    if (!game) continue;
    const config = await read(item.url + 'js/cloud-config.js');
    // Parse public constants only; never execute downloaded JavaScript.
    const host = config.text && config.text.match(/url:\s*'(https:\/\/[a-z0-9-]+\.supabase\.co)'/);
    const key = config.text && config.text.match(/anonKey:\s*'(sb_publishable_[A-Za-z0-9_-]+)'/);
    if (!host || !key) { report.blockers.push(item.url + ': cannot inspect public backend configuration'); continue; }
    item.backendUrl = host[1];
    if (report.backends.some(backend => backend.url === host[1])) continue;
    const headers = { apikey: key[1], Accept: 'application/json' };
    const [auth, stats] = await Promise.all([
      read(host[1] + '/auth/v1/settings', headers),
      read(host[1] + '/rest/v1/stats?select=device_millis,remainder_ms,collections&limit=0', headers)
    ]);
    const authData = json(auth), statsData = json(stats);
    report.backends.push({ url: host[1], authStatus: auth.status,
      signupEnabled: authData ? authData.disable_signup === false : null,
      emailAutoConfirm: authData ? authData.mailer_autoconfirm === true : null,
      statsStatus: stats.status, statsCode: statsData && statsData.code || null,
      statsMessage: statsData && statsData.message || stats.error || null });
    if (statsData && statsData.code === '42703') report.blockers.push('Stats migration incomplete: ' + statsData.message);
    else report.pending.push('Verify 0002 columns and merge_stats RPC with an authorized test account; anonymous GET cannot confirm full migration');
    if (auth.status !== 200) report.blockers.push('Auth settings unavailable');
  }
  if (!report.channels.some(c => c.game)) report.blockers.push('No game channel is deployed');
  report.ready = report.blockers.length === 0 && report.pending.length === 0;
  const output = JSON.stringify(report, null, 2) + '\n';
  if (args.length) fs.writeFileSync(path.resolve(args[1]), output);
  process.stdout.write(output);
  process.exitCode = report.ready ? 0 : 1;
})().catch(err => { console.error(err.message); process.exitCode = 1; });
