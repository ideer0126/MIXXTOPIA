#!/usr/bin/env node
/**
 * tools/test-channels.js —— 三通道构建产物验证（Issue #17）
 *
 * 零依赖：Node 内置 assert + fs/os/path/child_process。
 * 运行：node tools/test-channels.js
 *
 * 覆盖：
 *   1. 一次完整构建产出 stable / beta / preview 三份可玩站点
 *   2. stable 游戏不带 noindex；beta/preview 游戏与所有占位页带 noindex
 *   3. channel.js 注入顺序、channel.json 标识与通道名
 *   4. 测试期：stable/preview 占位，beta 用 main 也可玩
 *   5. beta 无 tag 时生成占位页，不拿 stable 冒充
 *   6. 产物不含 docs/tools/supabase/.github/.coderabbit.yaml/.gitkeep
 *   7. 新增的 js/cloud-config.js 会进入每个游戏构建
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const BUILD = path.join(__dirname, 'build-channels.js');
let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

function runRaw(out, args) {
  return execFileSync(process.execPath, [
    BUILD, '--worktree', '--out', out, ...args,
  ], { encoding: 'utf8' });
}

function runBuild(out, extra = []) {
  return runRaw(out, [
    '--stable-ref', 'worktree', '--stable-label', 'v0.1.0-test',
    '--preview-ref', 'worktree', '--preview-label', 'main',
    ...extra,
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
  const channelAt = html.indexOf('js/channel.js');
  const mainAt = html.indexOf('js/main.js');
  assert.ok(channelAt >= 0, label + ' 缺少 channel.js');
  assert.ok(mainAt >= 0, label + ' 缺少 main.js');
  assert.ok(channelAt < mainAt, label + ' 必须先加载 channel.js 再加载 main.js');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mixxtopia-channels-'));
try {
  /* ─────────────── 完整三通道 ─────────────── */
  const withBeta = path.join(tmp, 'with-beta');
  const log = runBuild(withBeta, [
    '--beta-ref', 'worktree', '--beta-label', 'v0.1.1-beta.1',
  ]);

  test('三通道构建成功并输出日志', () => {
    assert.ok(/\[channels\] stable/.test(log));
    assert.ok(/\[channels\] beta/.test(log));
    assert.ok(/\[channels\] preview/.test(log));
    assert.ok(/verify OK/.test(log));
  });

  test('三个通道都有可玩入口', () => {
    for (const rel of ['index.html', 'beta/index.html', 'preview/index.html']) {
      assert.ok(fs.existsSync(path.join(withBeta, rel)), rel + ' 缺失');
    }
    for (const rel of ['js/main.js', 'js/channel.js', 'channel.json']) {
      assert.ok(fs.existsSync(path.join(withBeta, rel)), 'stable 缺少 ' + rel);
      assert.ok(fs.existsSync(path.join(withBeta, 'beta', rel)), 'beta 缺少 ' + rel);
      assert.ok(fs.existsSync(path.join(withBeta, 'preview', rel)), 'preview 缺少 ' + rel);
    }
  });

  test('stable 不带 noindex，beta/preview 带 noindex', () => {
    assert.ok(!/name="robots"/.test(read(path.join(withBeta, 'index.html'))));
    assert.ok(/name="robots" content="noindex, nofollow"/.test(read(path.join(withBeta, 'beta/index.html'))));
    assert.ok(/name="robots" content="noindex, nofollow"/.test(read(path.join(withBeta, 'preview/index.html'))));
  });

  test('每个游戏页面写入通道 meta 兜底', () => {
    assert.ok(read(path.join(withBeta, 'index.html')).indexOf('name="mixxtopia-channel" content="stable"') >= 0);
    assert.ok(read(path.join(withBeta, 'beta/index.html')).indexOf('name="mixxtopia-channel" content="beta"') >= 0);
    assert.ok(read(path.join(withBeta, 'preview/index.html')).indexOf('name="mixxtopia-channel" content="preview"') >= 0);
  });

  test('channel.js 均先于 main.js 加载', () => {
    assertGameIndex(read(path.join(withBeta, 'index.html')), 'stable');
    assertGameIndex(read(path.join(withBeta, 'beta/index.html')), 'beta');
    assertGameIndex(read(path.join(withBeta, 'preview/index.html')), 'preview');
  });

  test('channel.json 标识与标签正确', () => {
    assert.strictEqual(readJson(path.join(withBeta, 'channel.json')).channel, 'stable');
    assert.strictEqual(readJson(path.join(withBeta, 'channel.json')).label, 'v0.1.0-test');
    assert.strictEqual(readJson(path.join(withBeta, 'beta/channel.json')).channel, 'beta');
    assert.strictEqual(readJson(path.join(withBeta, 'beta/channel.json')).label, 'v0.1.1-beta.1');
    assert.strictEqual(readJson(path.join(withBeta, 'preview/channel.json')).channel, 'preview');
    assert.strictEqual(readJson(path.join(withBeta, 'preview/channel.json')).label, 'main');
    assert.ok(/^[0-9a-f]{7,}$/i.test(readJson(path.join(withBeta, 'channel.json')).commit));
  });

  test('channel.js 写入对应通道名', () => {
    const stableJs = read(path.join(withBeta, 'js/channel.js'));
    const betaJs = read(path.join(withBeta, 'beta/js/channel.js'));
    const previewJs = read(path.join(withBeta, 'preview/js/channel.js'));
    assert.ok(stableJs.indexOf('"channel":"stable"') >= 0);
    assert.ok(betaJs.indexOf('"channel":"beta"') >= 0);
    assert.ok(previewJs.indexOf('"channel":"preview"') >= 0);
    assert.ok(betaJs.indexOf('channel-badge') >= 0);
    assert.ok(previewJs.indexOf('channel-badge') >= 0);
    for (const [label, source] of [['stable', stableJs], ['beta', betaJs], ['preview', previewJs]]) {
      new vm.Script(source, { filename: label + '/js/channel.js' });
    }
  });

  test('产物不含开发文件或 .gitkeep', () => {
    for (const name of ['docs', 'tools', 'supabase', '.github', '.coderabbit.yaml']) {
      assert.ok(!fs.existsSync(path.join(withBeta, name)), '混入 ' + name);
    }
    const junk = walk(withBeta).filter((file) => (
      /(?:^|[\\/])\.gitkeep$/.test(file) || /(?:^|[\\/])\.coderabbit\.yaml$/.test(file)
    ));
    assert.deepStrictEqual(junk, []);
  });

  test('每个游戏构建都包含 cloud-config.js', () => {
    for (const rel of ['js/cloud-config.js', 'beta/js/cloud-config.js', 'preview/js/cloud-config.js']) {
      assert.ok(fs.existsSync(path.join(withBeta, rel)), '缺少 ' + rel);
    }
  });

  /* ─────────────── 测试期：无 stable/preview ─────────────── */
  const testing = path.join(tmp, 'testing');
  const testingLog = runRaw(testing, [
    '--beta-ref', 'worktree', '--beta-label', 'main@test',
  ]);

  test('测试期：stable/preview 占位，beta 可玩', () => {
    const stableHtml = read(path.join(testing, 'index.html'));
    const previewHtml = read(path.join(testing, 'preview/index.html'));
    const betaHtml = read(path.join(testing, 'beta/index.html'));

    assert.ok(/稳定版尚未发布/.test(stableHtml));
    assert.ok(stableHtml.indexOf('js/main.js') < 0, '测试期稳定版不应加载游戏');
    assert.ok(/name="robots"/.test(stableHtml));

    assert.ok(/预览版尚未开放/.test(previewHtml));
    assert.ok(previewHtml.indexOf('js/main.js') < 0, '首个稳定版前预览版不应加载游戏');
    assert.ok(/name="robots"/.test(previewHtml));

    assertGameIndex(betaHtml, 'beta');
    assert.ok(/name="robots"/.test(betaHtml));

    assert.strictEqual(readJson(path.join(testing, 'channel.json')).label, null);
    assert.strictEqual(readJson(path.join(testing, 'preview/channel.json')).label, null);
    assert.strictEqual(readJson(path.join(testing, 'beta/channel.json')).label, 'main@test');
    assert.ok(/stable: placeholder/.test(testingLog));
    assert.ok(/beta: game/.test(testingLog));
    assert.ok(/preview: placeholder/.test(testingLog));
  });

  /* ─────────────── 无 beta tag ─────────────── */
  const noBeta = path.join(tmp, 'no-beta');
  runBuild(noBeta);

  test('无 beta tag 时生成占位页', () => {
    const html = read(path.join(noBeta, 'beta/index.html'));
    assert.ok(/测试版暂未开放/.test(html));
    assert.ok(/name="robots" content="noindex, nofollow"/.test(html));
    assert.ok(html.indexOf('js/main.js') < 0, '占位页不应加载游戏');
  });

  test('占位页仍写 beta channel.json', () => {
    const info = readJson(path.join(noBeta, 'beta/channel.json'));
    assert.strictEqual(info.channel, 'beta');
    assert.strictEqual(info.label, null);
  });

  test('无 beta tag 不影响 stable/preview', () => {
    assertGameIndex(read(path.join(noBeta, 'index.html')), 'stable');
    assertGameIndex(read(path.join(noBeta, 'preview/index.html')), 'preview');
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n全部通过：' + passed + ' 项');
