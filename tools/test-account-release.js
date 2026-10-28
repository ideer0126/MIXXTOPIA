#!/usr/bin/env node
'use strict';
// Local fixtures only: no deployed-site requests, accounts or Git mutations.
const assert = require('assert');
const { checkRelease, compareDeployment } = require('./check-account-release');
const base = 'https://ideer0126.github.io/MIXXTOPIA/';
const backend = 'https://fixture.supabase.co';
let passed = 0;
async function test(name, fn) {
  await fn(); passed++; console.log('  ✓ ' + name);
}
async function snapshot({ comparison = 'same-runtime', statsCode = '42501', missing = [], games = true,
  previewCommit = null, authStatus = 200, authSettings = { disable_signup: false, mailer_autoconfirm: true } } = {}) {
  const calls = [];
  const read = async url => {
    calls.push(url);
    if (url.startsWith(base)) {
      const route = url.slice(base.length), game = games && route.startsWith('beta/');
      if (route.endsWith('channel.json')) return { status: 200, text: JSON.stringify({
        commit: game ? '6d91a27' : route.startsWith('preview/') ? previewCommit : null }) };
      if (route.endsWith('cloud-config.js')) return { status: 200, text: "url: '" + backend + "', anonKey: 'sb_publishable_fixture'" };
      return { status: 200, text: game ? ['main', 'auth', 'account', 'cloud', 'stats'].filter(n => !missing.includes(n))
        .map(n => '<script src="js/' + n + '.js"></script>').join('') : 'placeholder' };
    }
    if (url === backend + '/auth/v1/settings') return { status: authStatus, text: JSON.stringify(authSettings) };
    assert.equal(url, backend + '/rest/v1/stats?select=device_millis,remainder_ms,collections&limit=0');
    return { status: statsCode === '42703' ? 400 : 401, text: JSON.stringify({ code: statsCode,
      message: statsCode === '42703' ? 'column stats.device_millis does not exist' : 'permission denied for table stats' }) };
  };
  const report = await checkRelease({ read, expectedCommit: '5fb500a', compare: () => comparison });
  assert.equal(calls.length, games && !missing.includes('main') ? 9 : 6, 'each fixed GET target is requested once');
  return report;
}
(async () => {
  await test('同一提交与仅测试/文档差异不阻塞部署；运行时差异仍阻塞', () => {
    for (const [same, changes, expected] of [[true, '', 'same-commit'], [false, '', 'same-runtime'], [false, 'js/main.js', 'different-runtime']]) {
      const calls = [];
      const runGit = args => {
        calls.push(args);
        if (args[0] === 'rev-parse') return args[2].startsWith('6d91a27') && !same ? 'b'.repeat(40) : 'a'.repeat(40);
        assert.ok(args.includes('--')); assert.ok(args.includes('assets')); assert.ok(args.includes('manifest.webmanifest'));
        assert.ok(!args.includes('tools')); assert.ok(!args.includes('docs'));
        return changes;
      };
      assert.equal(compareDeployment('6d91a27', '5fb500a', runGit), expected);
      assert.equal(calls.length, same ? 2 : 3);
    }
  });
  await test('未知/恶意提交元数据不能作为 Git 参数表达式执行', () => {
    let calls = 0;
    for (const commit of [null, '--help', 'HEAD', '6d91a27:js', '$(id)']) {
      assert.equal(compareDeployment(commit, '5fb500a', () => { calls++; throw Error('must not call git'); }), 'unknown-commit');
    }
    assert.equal(calls, 0);
    assert.equal(compareDeployment('abcdef0', '5fb500a', () => { throw Error('unknown ref'); }), 'unknown-commit');
  });
  await test('认证设置与匿名权限检查不误报，仍保留真实迁移/RPC/RLS待验项', async () => {
    const report = await snapshot();
    assert.deepEqual(report.blockers, []); assert.equal(report.ready, false);
    assert.equal(report.channels[1].sourceComparison, 'same-runtime');
    assert.ok(report.pending.some(p => p.includes('merge_stats')));
    for (const mailer_autoconfirm of [true, false]) {
      const disabled = await snapshot({ authSettings: { disable_signup: true, mailer_autoconfirm } });
      assert.deepEqual(disabled.blockers, ['Auth signup is disabled']);
      assert.equal(disabled.backends[0].signupEnabled, false);
    }
    for (const disable_signup of [undefined, null, false, 0, 1, 'true', 'false']) {
      const allowed = await snapshot({ authSettings: { disable_signup, mailer_autoconfirm: false } });
      assert.deepEqual(allowed.blockers, []);
      assert.equal(allowed.backends[0].emailAutoConfirm, false);
    }
    assert.deepEqual((await snapshot({ authSettings: null })).blockers, []);
    const unavailable = await snapshot({ authStatus: 503, authSettings: { disable_signup: true } });
    assert.deepEqual(unavailable.blockers, ['Auth settings unavailable']);
  });
  await test('邮箱提供方明确关闭时阻塞注册，缺省配置保持原有行为', async () => {
    for (const disable_signup of [false, true]) {
      for (const external of [{ email: false }, { email: true }, {}, null, undefined]) {
        const report = await snapshot({ authSettings: { disable_signup, external } });
        const disabled = disable_signup || external?.email === false;
        assert.deepEqual(report.blockers, disabled ? ['Auth signup is disabled'] : []);
        assert.equal(report.backends[0].signupEnabled, !disabled);
      }
    }
  });
  await test('已确认的缺列仍报告迁移阻塞', async () => {
    const report = await snapshot({ statsCode: '42703' });
    assert.ok(report.blockers.some(b => b.includes('Stats migration incomplete')));
  });
  await test('运行时不同报告阻塞，未知提交保留待核对项', async () => {
    const changed = await snapshot({ comparison: 'different-runtime' });
    assert.ok(changed.blockers.some(b => b.includes('runtime sources differ')));
    const unknown = await snapshot({ comparison: 'unknown-commit' });
    assert.ok(unknown.pending.some(p => p.includes('cannot be compared locally')));
    assert.equal(unknown.ready, false);
  });
  await test('缺少游戏/账户脚本或全部为占位页仍阻塞', async () => {
    assert.ok((await snapshot({ missing: ['stats'] })).blockers.some(b => b.includes('missing scripts stats')));
    assert.ok((await snapshot({ missing: ['main'] })).blockers.includes(base + 'beta/: missing scripts main'));
    assert.deepEqual((await snapshot({ previewCommit: '6d91a27' })).blockers, [base + 'preview/: missing scripts main']);
    assert.deepEqual((await snapshot({ previewCommit: '' })).blockers, []);
    assert.ok((await snapshot({ games: false })).blockers.includes('No game channel is deployed'));
  });
  console.log('全部通过：' + passed + ' 组发布检查回归');
})().catch(err => { console.error(err); process.exitCode = 1; });
