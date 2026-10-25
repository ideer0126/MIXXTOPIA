#!/usr/bin/env node
/**
 * tools/build-channels.js —— 组装 stable / beta / preview 三通道静态站（Issue #17）
 *
 * 用法：
 *   node tools/build-channels.js --out _site \
 *     [--stable-ref v1.0.0] [--stable-label v1.0.0] \
 *     [--beta-ref v1.1.0-beta.1] [--beta-label v1.1.0-beta.1] \
 *     [--preview-ref origin/main] [--preview-label main@abc1234]
 *
 *   省略某个 --*-ref 时生成对应占位页：
 *   - stable 缺省：稳定版尚未发布（测试期）
 *   - preview 缺省：预览版将在首个稳定版发布后开放
 *   - beta 缺省：测试期为「测试版暂未开放」；首个稳定版后为「测试版已停用」
 *
 *   --worktree  从当前工作区复制（本地预览/测试），否则用 git archive <ref>
 *
 * 产物：
 *   _site/           stable（或占位页）
 *   _site/beta/      beta（或占位页）
 *   _site/preview/   preview（或占位页）
 *
 * 每个通道根目录带 channel.json；js/channel.js 注入 window.MIXXTOPIA_CHANNEL，
 * main.js 据此派生存档/设置键，避免同一 Pages 域名下三个通道互相覆盖存档。
 *
 * 零依赖：Node 内置 fs/path/child_process + git + tar。
 * 退出码：0 = 成功；1 = 参数/ref/产物校验失败。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
// 站点运行时文件白名单；新增根目录资源时同步加到这里。
// index.html 若引用了未列入的文件，verifyLocalRefs 会直接报错，避免静默漏发。
const RUNTIME_PATHS = ['index.html', 'styles.css', 'js', 'assets'];
// 可选根文件：存在才复制，避免自定义域名 / 爬虫配置被三通道构建漏掉。
const OPTIONAL_RUNTIME_PATHS = ['CNAME', 'robots.txt', 'favicon.ico', 'manifest.webmanifest'];
const CHANNELS = ['stable', 'beta', 'preview'];

function fail(message) {
  console.error('[channels] ' + message);
  process.exit(1);
}

function usage() {
  console.log(`用法：
  node tools/build-channels.js --out _site \\
    [--stable-ref <ref>] [--stable-label <label>] \\
    [--beta-ref <ref>] [--beta-label <label>] \\
    [--preview-ref <ref>] [--preview-label <label>] [--worktree]

  --worktree  从当前工作区复制（本地预览/测试），否则用 git archive <ref>
  省略某个 --*-ref 时，该通道生成占位页：stable/preview 在首个稳定版前后有不同文案；
  beta 在首个稳定版后停用，且不能再与 --stable-ref 同时提供。

示例：
  # 测试期：只有 beta 游戏
  node tools/build-channels.js --worktree --out _site \\
    --beta-ref worktree --beta-label main

  # 首个稳定版之后：stable + preview，beta 停用
  node tools/build-channels.js --worktree --out _site \\
    --stable-ref v1.0.0 --stable-label v1.0.0 \\
    --preview-ref worktree --preview-label main`);
}

function parseArgs(argv) {
  const opts = { out: '_site', worktree: false };
  const allowed = new Set([
    'out', 'stable-ref', 'stable-label', 'beta-ref', 'beta-label',
    'preview-ref', 'preview-label',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--worktree') {
      opts.worktree = true;
      continue;
    }
    if (!arg.startsWith('--')) fail('未知参数：' + arg);
    const key = arg.slice(2);
    if (!allowed.has(key)) fail('未知参数：' + arg);
    const value = argv[++i];
    if (value === undefined) fail(arg + ' 缺少值');
    opts[key] = value;
  }
  return opts;
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}

function resolveCommit(ref) {
  if (!ref) fail('缺少 git ref');
  try {
    return git(['rev-parse', '--short', ref + '^{commit}']).trim();
  } catch (e) {
    fail('git ref 不存在：' + ref);
  }
}

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, visit);
    else visit(file, entry.name);
  }
}

/** 清掉仓库里用于占位的 .gitkeep / 本地 .DS_Store；它们不属于站点产物。 */
function removeJunk(dest) {
  walk(dest, (file, name) => {
    if (name === '.gitkeep' || name === '.DS_Store') fs.unlinkSync(file);
  });
}

function copyRuntimeFromWorktree(dest, paths) {
  for (const rel of paths) {
    const src = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(src)) fail('工作区缺少 ' + rel);
    fs.cpSync(src, path.join(dest, rel), { recursive: true });
  }
}

function pathExistsInRef(ref, rel) {
  try {
    execFileSync('git', ['cat-file', '-e', ref + ':' + rel], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch (e) {
    return false;
  }
}

function runtimePathsFor(ref, worktree) {
  const paths = RUNTIME_PATHS.slice();
  for (const rel of OPTIONAL_RUNTIME_PATHS) {
    const exists = worktree
      ? fs.existsSync(path.join(REPO_ROOT, rel))
      : pathExistsInRef(ref, rel);
    if (exists) paths.push(rel);
  }
  return paths;
}

function extractRuntimeFromRef(dest, ref, paths) {
  try {
    git(['rev-parse', '--verify', ref + '^{commit}']);
  } catch (e) {
    fail('git ref 不存在：' + ref);
  }
  let archive;
  try {
    archive = execFileSync('git', ['archive', '--format=tar', ref, ...paths], {
      cwd: REPO_ROOT,
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch (e) {
    fail('git archive 失败：' + ref + '（' + (e.message || e) + '）');
  }
  try {
    execFileSync('tar', ['-x', '-f', '-', '-C', dest], { input: archive });
  } catch (e) {
    fail('解包 git archive 失败：' + (e.message || e));
  }
}

function injectChannelIntoIndex(dest, channel) {
  const file = path.join(dest, 'index.html');
  if (!fs.existsSync(file)) fail('缺少 index.html：' + dest);
  let html = fs.readFileSync(file, 'utf8');
  const mainTag = '<script src="js/main.js"></script>';
  if (html.split(mainTag).length - 1 !== 1) {
    fail('index.html 中 main.js script 标签数量异常：' + dest);
  }
  if (html.split('</head>').length - 1 !== 1) fail('index.html 中 </head> 数量异常：' + dest);
  const robots = channel === 'stable'
    ? ''
    : '  <meta name="robots" content="noindex, nofollow" />\n';
  html = html.replace(
    '</head>',
    '  <meta name="mixxtopia-channel" content="' + channel + '" />\n' + robots + '</head>'
  );
  html = html.replace(mainTag, '<script src="js/channel.js"></script>\n  ' + mainTag);
  fs.writeFileSync(file, html);
}

function writeChannelJson(dest, info) {
  fs.writeFileSync(path.join(dest, 'channel.json'), JSON.stringify(info, null, 2) + '\n');
}

function writeChannelJs(dest, info) {
  const jsDir = path.join(dest, 'js');
  fs.mkdirSync(jsDir, { recursive: true });
  const json = JSON.stringify(info).replace(/</g, '\\u003c');
  const accent = info.channel === 'beta' ? '#ffd166' : '#8ef0ff';
  const source = `/* 由 tools/build-channels.js 生成，请勿手改 */
(function () {
  'use strict';
  var info = ${json};
  if (typeof window === 'undefined') return;
  window.MIXXTOPIA_CHANNEL = info.channel;
  window.MIXXTOPIA_CHANNEL_INFO = info;
  if (info.channel === 'stable' || typeof document === 'undefined') return;
  var showBadge = function () {
    if (!document.body || document.getElementById('channel-badge')) return;
    var el = document.createElement('div');
    el.id = 'channel-badge';
    el.textContent = (info.channel === 'beta' ? 'BETA 测试版' : 'PREVIEW 预览版') + ' · ' + info.label;
    el.title = 'ref ' + info.ref + ' · commit ' + info.commit;
    el.style.cssText = 'position:fixed;top:8px;right:8px;z-index:9999;padding:4px 8px;' +
      'background:rgba(12,10,24,.88);color:${accent};border:2px solid ${accent};border-radius:3px;' +
      'font-family:"Press Start 2P",monospace;font-size:8px;line-height:1.5;letter-spacing:.5px;' +
      'pointer-events:none;user-select:none;text-transform:uppercase;';
    document.body.appendChild(el);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBadge);
  else showBadge();
})();
`;
  fs.writeFileSync(path.join(jsDir, 'channel.js'), source);
  writeChannelJson(dest, info);
}

function htmlRefs(html) {
  const refs = [];
  const re = /(?:src|href)="([^"]+)"/g;
  let match;
  while ((match = re.exec(html))) refs.push(match[1]);
  return refs.filter((ref) => (
    !/^(?:https?:)?\/\//i.test(ref) &&
    !/^(?:data|mailto|javascript):/i.test(ref) &&
    !ref.startsWith('#')
  ));
}

function verifyLocalRefs(dest, expectGame) {
  const html = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
  for (const ref of htmlRefs(html)) {
    const clean = ref.split('?')[0].split('#')[0];
    if (!clean || clean.endsWith('/')) continue;
    if (!fs.existsSync(path.resolve(dest, clean))) {
      fail('index.html 引用了不存在的资源：' + ref + '（' + dest + '）');
    }
  }
  if (expectGame) {
    const channelAt = html.indexOf('js/channel.js');
    const mainAt = html.indexOf('js/main.js');
    if (channelAt < 0 || mainAt < 0 || channelAt > mainAt) {
      fail('channel.js 必须存在且早于 main.js：' + dest);
    }
  }
}

function buildGame(dest, ref, label, channel, worktree) {
  if (!CHANNELS.includes(channel)) fail('未知发布通道：' + channel);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const paths = runtimePathsFor(ref, worktree);
  if (worktree) copyRuntimeFromWorktree(dest, paths);
  else extractRuntimeFromRef(dest, ref, paths);
  removeJunk(dest);

  // beta/preview 必须带通道存档隔离；旧构建会写 stable 键，宁可失败也不要静默覆盖正式存档。
  if (channel !== 'stable') {
    const mainFile = path.join(dest, 'js', 'main.js');
    if (!fs.existsSync(mainFile)) fail(channel + ' 构建缺少 js/main.js');
    const mainSrc = fs.readFileSync(mainFile, 'utf8');
    if (mainSrc.indexOf('MIXXTOPIA_CHANNEL') < 0 || mainSrc.indexOf('channelKeys') < 0) {
      fail(channel + ' 构建的 js/main.js 未包含通道存档隔离代码');
    }
  }

  const commit = worktree ? git(['rev-parse', '--short', 'HEAD']).trim() : resolveCommit(ref);
  const info = {
    channel: channel,
    label: label || ref,
    ref: worktree ? 'worktree' : ref,
    commit: commit,
  };
  injectChannelIntoIndex(dest, channel);
  writeChannelJs(dest, info);
  verifyLocalRefs(dest, true);

  const rel = path.relative(REPO_ROOT, dest) || '.';
  console.log('[channels] ' + channel.padEnd(7) + ' ' + info.label + ' -> ' + rel + ' (' + commit + ')');
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function writePlaceholder(dest, opts) {
  if (!CHANNELS.includes(opts.channel)) fail('未知发布通道：' + opts.channel);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  writeChannelJson(dest, { channel: opts.channel, label: null, ref: null, commit: null });

  const title = escapeHtml(opts.title);
  const message = escapeHtml(opts.message);
  const note = opts.note
    ? '    <p class="note">' + escapeHtml(opts.note) + '</p>\n'
    : '';
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="mixxtopia-channel" content="${opts.channel}" />
  <meta name="robots" content="noindex, nofollow" />
  <title>MIXXTOPIA · ${title}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #0c0a18; color: #f4f1ff;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    main { width: min(88vw, 560px); padding: 32px; border: 3px solid #ff8fb3; border-radius: 6px; }
    .tag { margin: 0 0 12px; color: #ffd166; letter-spacing: .2em; font-size: 12px; }
    h1 { margin: 0 0 16px; font-size: 24px; line-height: 1.4; }
    p { color: #bdb6d8; line-height: 1.8; font-size: 14px; }
    .note { color: #8b84a8; font-size: 13px; }
    code { color: #8ef0ff; }
    a { display: inline-block; margin-top: 20px; color: #8ef0ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <main>
    <p class="tag">${opts.channel.toUpperCase()}</p>
    <h1>${title}</h1>
    <p>${message}</p>
${note}    <a href="${escapeHtml(opts.href)}">${escapeHtml(opts.link)}</a>
  </main>
</body>
</html>
`;
  fs.writeFileSync(path.join(dest, 'index.html'), html);
  console.log('[channels] ' + opts.channel.padEnd(7) + ' 占位页 -> ' + (path.relative(REPO_ROOT, dest) || '.'));
}

function readChannelInfo(file) {
  if (!fs.existsSync(file)) fail('缺少 channel.json：' + file);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail('channel.json 不是合法 JSON：' + file);
  }
}

// 取页面里所有 robots meta 的 content 值。
// 只认标签名不够：`content="index, follow"` 也是 name="robots"，
// 所以 noindex 必须校验 content；属性顺序、单双引号、大小写都不敏感。
function robotsContents(html) {
  return (html.match(/<meta\b[^>]*>/gi) || [])
    .filter((tag) => /name\s*=\s*["']robots["']/i.test(tag))
    .map((tag) => {
      const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
      return content ? content[1] : '';
    });
}

function hasNoindex(html) {
  return robotsContents(html).some((content) => /\bnoindex\b/i.test(content));
}

function verifySite(outDir, expected) {
  const infos = {
    stable: readChannelInfo(path.join(outDir, 'channel.json')),
    beta: readChannelInfo(path.join(outDir, 'beta', 'channel.json')),
    preview: readChannelInfo(path.join(outDir, 'preview', 'channel.json')),
  };
  const pages = {
    stable: {
      html: fs.readFileSync(path.join(outDir, 'index.html'), 'utf8'),
      placeholder: '稳定版尚未发布',
    },
    beta: {
      html: fs.readFileSync(path.join(outDir, 'beta', 'index.html'), 'utf8'),
      placeholder: expected.stable ? '测试版已停用' : '测试版暂未开放',
    },
    preview: {
      html: fs.readFileSync(path.join(outDir, 'preview', 'index.html'), 'utf8'),
      placeholder: '预览版尚未开放',
    },
  };

  for (const channel of CHANNELS) {
    const info = infos[channel];
    const page = pages[channel];
    if (info.channel !== channel) {
      fail('channel.json 标识不符：期望 ' + channel + '，实际 ' + info.channel);
    }
    if (page.html.indexOf('name="mixxtopia-channel" content="' + channel + '"') < 0) {
      fail(channel + ' 缺少通道 meta 标签');
    }

    const isGame = page.html.indexOf('js/main.js') >= 0;
    if (isGame !== !!expected[channel]) {
      fail(channel + ' 产物类型不符：期望 ' + (expected[channel] ? '游戏' : '占位页'));
    }

    if (!isGame) {
      if (info.label !== null || info.ref !== null) fail(channel + ' 占位页不应带 label/ref');
      if (!hasNoindex(page.html)) fail(channel + ' 占位页缺少 noindex');
      if (page.html.indexOf(page.placeholder) < 0) {
        fail(channel + ' 占位页缺少文案：' + page.placeholder);
      }
      continue;
    }

    if (info.label === null || info.ref === null) fail(channel + ' 游戏构建 channel.json 缺少 label/ref');
    const channelAt = page.html.indexOf('js/channel.js');
    const mainAt = page.html.indexOf('js/main.js');
    if (channelAt < 0 || channelAt > mainAt) {
      fail(channel + ' 的 channel.js/main.js 注入顺序错误');
    }
    if (channel === 'stable') {
      if (robotsContents(page.html).length) fail('stable 游戏不应带 robots meta');
    } else if (!hasNoindex(page.html)) {
      fail(channel + ' 游戏缺少 noindex');
    }
  }

  for (const name of ['docs', 'tools', 'supabase', '.github', '.git', '.coderabbit.yaml']) {
    if (fs.existsSync(path.join(outDir, name))) fail('站点产物混入开发文件：' + name);
  }
  walk(outDir, (file, name) => {
    if (name === '.gitkeep' || name === '.coderabbit.yaml') {
      fail('站点产物混入开发文件：' + path.relative(outDir, file));
    }
  });

  const summary = CHANNELS.map((channel) => (
    channel + ': ' + (expected[channel] ? 'game' : 'placeholder')
  )).join('，');
  console.log('[channels] verify OK（' + summary + '）');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(REPO_ROOT, opts.out);
  if (outDir === path.parse(outDir).root || outDir === REPO_ROOT) {
    fail('--out 不能是仓库根或文件系统根');
  }
  const gitDir = path.join(REPO_ROOT, '.git');
  if (outDir === gitDir || outDir.startsWith(gitDir + path.sep)) {
    fail('--out 不能指向 .git');
  }
  if (opts.worktree) resolveCommit('HEAD');

  const stableRef = opts['stable-ref'];
  const previewRef = opts['preview-ref'];
  const betaRef = opts['beta-ref'];
  if (stableRef && betaRef) {
    fail('第一个稳定版发布后 beta 通道已停用，不能再同时提供 --beta-ref');
  }
  if (previewRef && !stableRef) fail('--preview-ref 需要同时提供 --stable-ref');

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  if (stableRef) {
    buildGame(outDir, stableRef, opts['stable-label'] || stableRef, 'stable', opts.worktree);
  } else {
    writePlaceholder(outDir, {
      channel: 'stable',
      title: '稳定版尚未发布',
      message: 'MIXXTOPIA 目前处于测试阶段。',
      note: '预览版将在首个稳定版发布后开放。',
      href: 'beta/',
      link: '进入测试版 →',
    });
  }

  if (previewRef) {
    buildGame(
      path.join(outDir, 'preview'),
      previewRef,
      opts['preview-label'] || previewRef,
      'preview',
      opts.worktree
    );
  } else {
    writePlaceholder(path.join(outDir, 'preview'), {
      channel: 'preview',
      title: '预览版尚未开放',
      message: stableRef ? '预览版暂未开放。' : '预览版将在首个稳定版发布后开放。',
      note: stableRef ? '' : '当前测试请使用测试版。',
      href: '../beta/',
      link: '进入测试版 →',
    });
  }

  if (betaRef) {
    buildGame(path.join(outDir, 'beta'), betaRef, opts['beta-label'] || betaRef, 'beta', opts.worktree);
  } else if (stableRef) {
    writePlaceholder(path.join(outDir, 'beta'), {
      channel: 'beta',
      title: '测试版已停用',
      message: '首个稳定版发布后，测试版通道已停用。',
      note: '后续测试请使用预览版。',
      href: '../preview/',
      link: '前往预览版 →',
    });
  } else {
    writePlaceholder(path.join(outDir, 'beta'), {
      channel: 'beta',
      title: '测试版暂未开放',
      message: '等待测试版构建。',
      href: '../',
      link: '← 返回首页',
    });
  }

  verifySite(outDir, {
    stable: !!stableRef,
    beta: !!betaRef,
    preview: !!previewRef,
  });
}

main();
