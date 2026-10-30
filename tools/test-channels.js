#!/usr/bin/env node
/**
 * tools/test-channels.js —— 三通道构建产物验证（Issue #17）
 *
 * 零依赖：Node 内置 assert + fs/os/path/child_process。
 * 运行：node tools/test-channels.js
 *
 * 覆盖：
 *   1. 测试期：stable/preview 占位，beta 用 main 可玩
 *   2. 首个稳定版后：stable/preview 游戏，beta 显示“已停用”
 *   3. stable 游戏可索引；beta/preview/占位页带 noindex
 *   4. channel.js 注入顺序、channel.json 标识与通道名
 *   5. 稳定版后禁止同时构建 beta
 *   6. 产物不含 docs/tools/supabase/.github/.coderabbit.yaml/.gitkeep
 *   7. 新增的 js/cloud-config.js / js/account.js / js/data.js 会进入每个游戏构建
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const BUILD = path.join(__dirname, 'build-channels.js');
let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

function runRaw(out, args = []) {
  return execFileSync(process.execPath, [
    BUILD, '--worktree', '--out', out, ...args,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function runTesting(out) {
  return runRaw(out, ['--beta-ref', 'worktree', '--beta-label', 'main@test']);
}

function runStable(out) {
  return runRaw(out, [
    '--stable-ref', 'worktree', '--stable-label', 'v1.0.0-test',
    '--preview-ref', 'worktree', '--preview-label', 'main@test',
  ]);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else out.push(file);
  }
  return out;
}

function assertGameIndex(html, label) {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)];
  assert.strictEqual(scripts.length, 1, label + ' must load one bundle');
  assert.match(scripts[0][1], /^js\/game-[a-f0-9]{12}\.js$/);
}

function assertMeta(html, channel) {
  assert.ok(
    html.indexOf('name="mixxtopia-channel" content="' + channel + '"') >= 0,
    channel + ' 缺少通道 meta'
  );
}

// 与 build-channels.js 的 verifySite 对齐：noindex 必须校验 content，
// 只看到 name="robots" 就放行的话，`content="index, follow"` 也能混过去。
// 注释里的 meta 不算、`data-content` 不算、`not-noindex` 也不算。
function stripHtmlComments(html) {
  let prev;
  let current = html;
  do {
    prev = current;
    current = current.replace(/<!--[\s\S]*?-->/g, '');
  } while (current !== prev);
  return current;
}

function robotsContents(html) {
  const visible = stripHtmlComments(html);
  return (visible.match(/<meta\b[^>]*>/gi) || [])
    .filter((tag) => /\sname\s*=\s*["']robots["']/i.test(tag))
    .map((tag) => {
      const content = /\scontent\s*=\s*["']([^"']*)["']/i.exec(tag);
      return content ? content[1] : '';
    });
}

function hasNoindex(html) {
  return robotsContents(html).some((content) => content
    .split(',')
    .some((directive) => directive.trim().toLowerCase() === 'noindex'));
}

function assertNoJunk(site) {
  for (const name of ['docs', 'tools', 'supabase', '.github', '.coderabbit.yaml']) {
    assert.ok(!fs.existsSync(path.join(site, name)), site + ' 混入 ' + name);
  }
  const junk = walk(site).filter((file) => (
    /(?:^|[\\/])\.gitkeep$/.test(file) || /(?:^|[\\/])\.coderabbit\.yaml$/.test(file)
  ));
  assert.deepStrictEqual(junk, []);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mixxtopia-channels-'));
try {
  /* ─────────────── 测试期 ─────────────── */
  const testing = path.join(tmp, 'testing');
  const testingLog = runTesting(testing);

  test('测试期：stable/preview 占位，beta 可玩', () => {
    const stable = read(path.join(testing, 'index.html'));
    const preview = read(path.join(testing, 'preview/index.html'));
    const beta = read(path.join(testing, 'beta/index.html'));

    assert.ok(/稳定版尚未发布/.test(stable));
    assert.ok(stable.indexOf('js/main.js') < 0, '测试期 stable 不应加载游戏');
    assert.ok(hasNoindex(stable), '测试期 stable 占位页应带 noindex');

    assert.ok(/预览版尚未开放/.test(preview));
    assert.ok(preview.indexOf('js/main.js') < 0, '首个稳定版前 preview 不应加载游戏');
    assert.ok(hasNoindex(preview), '测试期 preview 占位页应带 noindex');

    assertGameIndex(beta, 'beta');
    assert.ok(hasNoindex(beta), 'beta 游戏应带 noindex');
    assertMeta(stable, 'stable');
    assertMeta(beta, 'beta');
    assertMeta(preview, 'preview');

    assert.ok(/stable: placeholder/.test(testingLog));
    assert.ok(/beta: game/.test(testingLog));
    assert.ok(/preview: placeholder/.test(testingLog));
  });

  test('测试期 channel.json：stable/preview 无标签，beta 指向 main', () => {
    assert.strictEqual(readJson(path.join(testing, 'channel.json')).channel, 'stable');
    assert.strictEqual(readJson(path.join(testing, 'channel.json')).label, null);
    assert.strictEqual(readJson(path.join(testing, 'preview/channel.json')).channel, 'preview');
    assert.strictEqual(readJson(path.join(testing, 'preview/channel.json')).label, null);
    assert.strictEqual(readJson(path.join(testing, 'beta/channel.json')).channel, 'beta');
    assert.strictEqual(readJson(path.join(testing, 'beta/channel.json')).label, 'main@test');
  });

  /* ─────────────── 首个稳定版之后 ─────────────── */
  const stable = path.join(tmp, 'stable');
  const stableLog = runStable(stable);

  test('稳定后：stable/preview 游戏，beta 已停用', () => {
    const stableHtml = read(path.join(stable, 'index.html'));
    const previewHtml = read(path.join(stable, 'preview/index.html'));
    const betaHtml = read(path.join(stable, 'beta/index.html'));

    assertGameIndex(stableHtml, 'stable');
    assert.strictEqual(robotsContents(stableHtml).length, 0, 'stable 游戏应可索引');
    assertGameIndex(previewHtml, 'preview');
    assert.ok(hasNoindex(previewHtml), 'preview 应带 noindex');

    assert.ok(/测试版已停用/.test(betaHtml));
    assert.ok(betaHtml.indexOf('js/main.js') < 0, 'beta 停用后不应加载游戏');
    assert.ok(hasNoindex(betaHtml), 'beta 停用页应带 noindex');
    assert.ok(betaHtml.indexOf('../preview/') >= 0, 'beta 停用页应指向 preview');

    assertMeta(stableHtml, 'stable');
    assertMeta(betaHtml, 'beta');
    assertMeta(previewHtml, 'preview');

    assert.ok(/stable: game/.test(stableLog));
    assert.ok(/beta: placeholder/.test(stableLog));
    assert.ok(/preview: game/.test(stableLog));
  });

  test('稳定后 channel.json：stable/preview 有标签，beta 为空', () => {
    assert.strictEqual(readJson(path.join(stable, 'channel.json')).channel, 'stable');
    assert.strictEqual(readJson(path.join(stable, 'channel.json')).label, 'v1.0.0-test');
    assert.strictEqual(readJson(path.join(stable, 'preview/channel.json')).channel, 'preview');
    assert.strictEqual(readJson(path.join(stable, 'preview/channel.json')).label, 'main@test');
    assert.strictEqual(readJson(path.join(stable, 'beta/channel.json')).channel, 'beta');
    assert.strictEqual(readJson(path.join(stable, 'beta/channel.json')).label, null);
  });

  /* ─────────────── 共用产物检查 ─────────────── */
  test('bundle preserves channel injection before main and runtime APIs', () => {
    for (const [channel, dir] of [['beta', path.join(testing, 'beta')], ['stable', stable], ['preview', path.join(stable, 'preview')]]) {
      const manifest = readJson(path.join(dir, 'build.json'));
      const { file, sources } = manifest.entries.game;
      assert.ok(sources.indexOf('js/channel.js') < sources.indexOf('js/main.js'));
      const sandbox = vm.createContext({});
      vm.runInContext('window = globalThis; MIXX_NO_BOOT = true;', sandbox);
      vm.runInContext(read(path.join(dir, file)), sandbox);
      assert.strictEqual(sandbox.MIXXTOPIA_CHANNEL, channel);
      assert.strictEqual(sandbox.MIXXTOPIA_CHANNEL_INFO.channel, channel);
      for (const mod of ['engine', 'main', 'auth', 'account', 'cloud', 'stats', 'cloudConfig']) assert.ok(sandbox.MIXX[mod], mod);
      assert.ok(sandbox.GAME.levels.length);
    }
  });

  test('产物不含开发文件或 .gitkeep', () => {
    assertNoJunk(testing);
    assertNoJunk(stable);
  });

  test('bundles include all source modules without shipping duplicate scripts', () => {
    for (const dir of [path.join(testing, 'beta'), stable, path.join(stable, 'preview')]) {
      const { entries } = readJson(path.join(dir, 'build.json'));
      for (const name of ['cloud-config', 'account', 'cloud', 'data']) assert.ok(entries.game.sources.includes('js/' + name + '.js'));
      assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'js')).sort(), [entries.game.file, entries.recovery.file].map(p => path.basename(p)).sort());
    }
  });

  test('密码找回页随活动通道发布，返回 / 回调链接保留通道，无游戏启动脚本', () => {
    for (const dir of [path.join(testing, 'beta'), stable, path.join(stable, 'preview')]) {
      const html = read(path.join(dir, 'reset-password.html'));
      assert.ok(html.includes('href="index.html"'));
      assert.ok(read(path.join(dir, 'index.html')).includes('href="reset-password.html"'));
      assert.ok(html.includes('content="no-referrer"'));
      assert.ok(hasNoindex(html));
      assert.ok(!html.includes('js/main.js'));
      const { file, sources } = readJson(path.join(dir, 'build.json')).entries.recovery;
      assert.deepStrictEqual(sources, ['js/cloud-config.js', 'js/auth.js', 'js/password-recovery.js']);
      assert.ok(html.includes('src="' + file + '" defer'));
      assert.ok(fs.existsSync(path.join(dir, file)));
    }
    for (const dir of [testing, path.join(testing, 'preview'), path.join(stable, 'beta')]) {
      assert.ok(!fs.existsSync(path.join(dir, 'reset-password.html')), '占位通道不应开放找回页');
    }
  });

  test('稳定版后禁止同时构建 beta', () => {
    let error = null;
    const forbidden = path.join(tmp, 'forbidden');
    try {
      runRaw(forbidden, [
        '--stable-ref', 'worktree', '--stable-label', 'v1.0.0-test',
        '--preview-ref', 'worktree', '--preview-label', 'main@test',
        '--beta-ref', 'worktree', '--beta-label', 'v1.1.0-beta.1',
      ]);
    } catch (e) {
      error = e;
    }
    assert.ok(error, '同时提供 stable 与 beta 应失败');
    const message = String(error.stderr || '') + String(error.message || '');
    assert.ok(/beta 通道已停用/.test(message));
    assert.ok(!fs.existsSync(forbidden), '失败时不应留下产物目录');
  });

  test('全占位构建：beta 显示暂未开放', () => {
    const empty = path.join(tmp, 'empty');
    const log = runRaw(empty, []);
    assert.ok(/稳定版尚未发布/.test(read(path.join(empty, 'index.html'))));
    assert.ok(/预览版尚未开放/.test(read(path.join(empty, 'preview/index.html'))));
    assert.ok(/测试版暂未开放/.test(read(path.join(empty, 'beta/index.html'))));
    assert.ok(/stable: placeholder/.test(log));
    assert.ok(/beta: placeholder/.test(log));
    assert.ok(/preview: placeholder/.test(log));
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n全部通过：' + passed + ' 项');
