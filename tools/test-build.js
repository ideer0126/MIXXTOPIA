#!/usr/bin/env node
'use strict';
// Local build regression: browser globals, entry isolation, assets, old tags and release inspection.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { checkRelease } = require('./check-account-release');
const repo = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mixxtopia-build-'));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }
(async () => {
  const site = path.join(tmp, 'offline');
  execFileSync(process.execPath, [path.join(repo, 'tools/build-site.js'), '--out', site], { stdio: 'pipe' });
  const manifest = JSON.parse(fs.readFileSync(path.join(site, 'build.json'), 'utf8'));
  await test('offline entries load one content-hashed bundle each and retain defer', () => {
    for (const [name, entry] of Object.entries(manifest.entries)) {
      const html = fs.readFileSync(path.join(site, entry.page), 'utf8');
      const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)];
      assert.equal(scripts.length, 1);
      assert.equal(scripts[0][1], entry.file);
      assert.match(entry.file, new RegExp('^js/' + name + '-[a-f0-9]{12}\\.js$'));
      assert.equal(/\bdefer\b/.test(scripts[0][0]), name === 'recovery');
      assert.equal(fs.statSync(path.join(site, entry.file)).size, entry.bytes);
    }
    assert.deepEqual(fs.readdirSync(path.join(site, 'js')).sort(), Object.values(manifest.entries).map(e => path.basename(e.file)).sort());
    for (const name of ['package.json', 'package-lock.json', 'node_modules', 'tools', 'docs', '.github']) assert.ok(!fs.existsSync(path.join(site, name)));
    assert.ok(fs.existsSync(path.join(site, 'README.md')));
    assert.ok(fs.existsSync(path.join(site, 'LICENSE')));
  });
  await test('bundling preserves game data and global APIs; recovery never boots the game', () => {
    const original = vm.createContext({});
    for (const [, src] of fs.readFileSync(path.join(repo, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)) {
      vm.runInContext(fs.readFileSync(path.join(repo, src), 'utf8'), original);
    }
    const game = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(site, manifest.entries.game.file), 'utf8'), game);
    assert.equal(JSON.stringify(game.GAME), JSON.stringify(original.GAME));
    for (const name of ['engine', 'main', 'auth', 'account', 'cloud', 'stats', 'audio', 'Birthday']) assert.ok(game.MIXX[name], name);
    vm.runInContext("MIXX.engine.registerTileset('build-test', { floor: ['1'] });", game);
    assert.equal(game.MIXX.engine._tilesets['build-test'].floor[0], '1');
    const recovery = vm.createContext({ URLSearchParams });
    vm.runInContext(fs.readFileSync(path.join(site, manifest.entries.recovery.file), 'utf8'), recovery);
    assert.ok(recovery.MIXX.auth && recovery.MIXX.recovery);
    assert.ok(!recovery.MIXX.main && !recovery.GAME);
    assert.equal(recovery.MIXX.recovery.parseFragment('#type=recovery&access_token=test'), 'test');
  });
  await test('all game image references exist and all asset images use WebP', () => {
    const sandbox = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(repo, 'js/data.js'), 'utf8'), sandbox);
    const refs = JSON.stringify(sandbox.GAME).match(/assets\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpg|jpeg|gif)/g);
    assert.ok(refs.length);
    const runtimeImages = JSON.parse(fs.readFileSync(path.join(site, 'assets/runtime/manifest.json'), 'utf8'));
    for (const src of refs) {
      assert.ok(src.endsWith('.webp'), src);
      assert.ok(fs.existsSync(path.join(site, runtimeImages[src].src)), src);
      assert.ok(!fs.existsSync(path.join(site, src)), 'Original must not ship: ' + src);
    }
    for (const entry of fs.readdirSync(path.join(site, 'assets'), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      assert.ok(!/\.(?:png|jpg|jpeg|gif|bmp|svg)$/i.test(entry.name), entry.name);
      assert.ok(!/\.md$|^\.gitkeep$/.test(entry.name), entry.name);
    }
  });
  await test('rebuilding the same source is deterministic and replaces old output', () => {
    execFileSync(process.execPath, [path.join(repo, 'tools/build-site.js'), '--out', site], { stdio: 'pipe' });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(site, 'build.json'), 'utf8')), manifest);
  });
  await test('old beta tag keeps its own scripts and PNG assets', () => {
    const old = path.join(tmp, 'legacy');
    execFileSync(process.execPath, [path.join(repo, 'tools/build-channels.js'), '--out', old, '--beta-ref', 'v0.5.0-beta.3'], { stdio: 'pipe' });
    const html = fs.readFileSync(path.join(old, 'beta/index.html'), 'utf8');
    assert.ok(html.includes('src="js/main.js"'));
    assert.ok(html.includes('src="js/channel.js"'));
    assert.ok(!fs.existsSync(path.join(old, 'beta/build.json')));
    assert.ok(fs.existsSync(path.join(old, 'beta/assets/scenes/p0-bedroom.png')));
  });
  await test('release inspector reads bundle metadata and minified public config without network', async () => {
    const base = 'https://ideer0126.github.io/MIXXTOPIA/';
    for (const missing of [false, true]) {
      const report = await checkRelease({ compare: () => 'same-runtime', read: async url => {
        if (url.endsWith('/channel.json')) return {status: 200, text: JSON.stringify({commit: '55acfab'})};
        if (url.endsWith('/build.json')) {
          const copy = JSON.parse(JSON.stringify(manifest));
          if (missing) copy.entries.game.sources = copy.entries.game.sources.filter(p => p !== 'js/stats.js');
          return { status: 200, text: JSON.stringify(copy) };
        }
        if (url.startsWith(base)) {
          const relative = url.slice(base.length).replace(/^(beta|preview)\//, '') || 'index.html';
          return {status: 200, text: fs.readFileSync(path.join(site, relative), 'utf8')};
        }
        if (url.endsWith('/auth/v1/settings')) return {status: 200, text: '{"disable_signup":false}'};
        assert.ok(url.includes('/rest/v1/stats?'));
        return {status: 401, text: '{"code":"42501"}'};
      }});
      assert.equal(report.channels.filter(c => c.game).length, 3);
      assert.equal(report.backends.length, 1);
      assert.deepEqual(report.blockers, missing ? ['', 'beta/', 'preview/'].map(p => base + p + ': missing scripts stats') : []);
    }
  });
  console.log('\n全部通过：' + passed + ' 项');
})().finally(() => fs.rmSync(tmp, {recursive: true, force: true})).catch(err => { console.error(err); process.exitCode = 1; });
