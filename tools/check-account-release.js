#!/usr/bin/env node
'use strict';
// One bounded, read-only snapshot of the deployed #47 prerequisites. No login or RPC calls.
// Usage: node tools/check-account-release.js [--out /tmp/account-release.json]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const repo = path.resolve(__dirname, '..');
const base = 'https://ideer0126.github.io/MIXXTOPIA/';
// Match build-channels.js's source allowlist. Generated channel metadata is excluded.
const runtimePaths = ['index.html', 'styles.css', 'js', 'assets',
  'CNAME', 'robots.txt', 'favicon.ico', 'manifest.webmanifest'];
function git(args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function compareDeployment(commit, expectedCommit, runGit = git) {
  // Metadata is untrusted; accept only commit hashes, never revision expressions/options.
  if (typeof commit !== 'string' || !/^[a-f0-9]{7,40}$/.test(commit)) return 'unknown-commit';
  try {
    const deployed = runGit(['rev-parse', '--verify', commit + '^{commit}']);
    const expected = runGit(['rev-parse', '--verify', expectedCommit + '^{commit}']);
    if (deployed === expected) return 'same-commit';
    return runGit(['diff', '--name-only', expected, deployed, '--', ...runtimePaths])
      ? 'different-runtime' : 'same-runtime';
  } catch (err) { return 'unknown-commit'; }
}
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
async function checkRelease({ read: get = read, expectedCommit = git(['rev-parse', '--short', 'HEAD']),
  compare = compareDeployment } = {}) {
  const report = { observedAt: new Date().toISOString(), expectedCommit, channels: [], backends: [],
    blockers: [], pending: ['Authenticated cross-account RLS and cross-device verification',
      'Separate test and production backends', 'Manual account deletion and cascade verification'] };
  const snapshots = await Promise.all(['', 'beta/', 'preview/'].map(async prefix => {
    const [meta, html] = await Promise.all([get(base + prefix + 'channel.json'), get(base + prefix)]);
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
    if (game && info) {
      item.sourceComparison = compare(info.commit, expectedCommit);
      if (item.sourceComparison === 'different-runtime') report.blockers.push(item.url + ': deployed runtime sources differ from local HEAD');
      if (item.sourceComparison === 'unknown-commit') report.pending.push(item.url + ': deployed commit cannot be compared locally; verify runtime sources');
    }
    if (!game) {
      if (info && info.commit) report.blockers.push(item.url + ': missing scripts main');
      continue;
    }
    const config = await get(item.url + 'js/cloud-config.js');
    // Parse public constants only; never execute downloaded JavaScript.
    const host = config.text && config.text.match(/url:\s*'(https:\/\/[a-z0-9-]+\.supabase\.co)'/);
    const key = config.text && config.text.match(/anonKey:\s*'(sb_publishable_[A-Za-z0-9_-]+)'/);
    if (!host || !key) { report.blockers.push(item.url + ': cannot inspect public backend configuration'); continue; }
    item.backendUrl = host[1];
    if (report.backends.some(backend => backend.url === host[1])) continue;
    const headers = { apikey: key[1], Accept: 'application/json' };
    const [auth, stats] = await Promise.all([
      get(host[1] + '/auth/v1/settings', headers),
      get(host[1] + '/rest/v1/stats?select=device_millis,remainder_ms,collections&limit=0', headers)
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
    else if (authData && authData.disable_signup === true) report.blockers.push('Auth signup is disabled');
  }
  if (!report.channels.some(c => c.game)) report.blockers.push('No game channel is deployed');
  report.ready = report.blockers.length === 0 && report.pending.length === 0;
  return report;
}
module.exports = { checkRelease, compareDeployment };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) {
    console.error('Usage: node tools/check-account-release.js [--out /tmp/account-release.json]');
    process.exit(2);
  }
  checkRelease().then(report => {
    const output = JSON.stringify(report, null, 2) + '\n';
    if (args.length) fs.writeFileSync(path.resolve(args[1]), output);
    process.stdout.write(output);
    process.exitCode = report.ready ? 0 : 1;
  }).catch(err => { console.error(err.message); process.exitCode = 1; });
}
