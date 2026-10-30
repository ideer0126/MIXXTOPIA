#!/usr/bin/env node
'use strict';
// Build existing classic scripts in HTML order; their window.MIXX/GAME API stays intact.
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { buildSync } = require('esbuild');

// Shared by the standalone/offline build and each extracted channel snapshot.
function bundleRuntime(dest) {
  const manifest = { version: 1, entries: {} };
  const inputs = new Set();
  for (const [page, entry] of [['index.html', 'game'], ['reset-password.html', 'recovery']]) {
    const file = path.join(dest, page);
    if (!fs.existsSync(file)) continue;
    let html = fs.readFileSync(file, 'utf8');
    const tags = [...html.matchAll(/<script\b[^>]*\bsrc="(js\/[^"?]+\.js)"[^>]*><\/script>/g)];
    if (!tags.length) throw new Error(page + ': no local scripts to bundle');
    const sources = tags.map(tag => tag[1]);
    const contents = sources.map(src => {
      inputs.add(src);
      return fs.readFileSync(path.join(dest, src), 'utf8');
    }).join('\n;\n');
    const result = buildSync({
      stdin: { contents, sourcefile: entry + '.js', resolveDir: dest },
      bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
      minify: true, legalComments: 'eof', write: false, logLevel: 'silent',
    });
    const code = result.outputFiles[0].contents;
    const hash = createHash('sha256').update(code).digest('hex').slice(0, 12);
    const output = 'js/' + entry + '-' + hash + '.js';
    fs.writeFileSync(path.join(dest, output), code);
    const last = tags[tags.length - 1];
    // Recovery scripts remain deferred in <head>; game scripts stay at the body end.
    html = html.replace(last[0], '<script src="' + output + '"' +
      (/\bdefer\b/.test(last[0]) ? ' defer' : '') + '></script>');
    for (const tag of tags.slice(0, -1)) html = html.replace(tag[0], '');
    fs.writeFileSync(file, html);
    manifest.entries[entry] = { page, file: output, sources, bytes: code.length };
    console.log('[bundle] ' + page + ': ' + sources.length + ' scripts -> ' + output + ' (' + code.length + ' bytes)');
  }
  for (const src of inputs) fs.unlinkSync(path.join(dest, src));
  fs.writeFileSync(path.join(dest, 'build.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

module.exports = { bundleRuntime };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out') {
    console.error('Usage: node tools/build-site.js --out <directory>');
    process.exit(2);
  }
  const repo = path.resolve(__dirname, '..');
  const out = path.resolve(args[1]);
  // Only create disposable output outside the source trees.
  const relative = path.relative(repo, out);
  if (!relative || ['js', 'assets', 'tools', 'docs', '.git', '.github', 'node_modules'].includes(relative.split(path.sep)[0])) {
    throw new Error('Output must be a separate build directory');
  }
  if (fs.existsSync(out) && fs.readdirSync(out).length) {
    if (!fs.existsSync(path.join(out, 'build.json'))) throw new Error('Output directory must be empty or a previous build: ' + out);
    fs.rmSync(out, { recursive: true });
  }
  fs.mkdirSync(out, { recursive: true });
  for (const name of ['index.html', 'reset-password.html', 'styles.css', 'js', 'assets', 'README.md', 'LICENSE',
    'CNAME', 'robots.txt', 'favicon.ico', 'manifest.webmanifest']) {
    if (fs.existsSync(path.join(repo, name))) fs.cpSync(path.join(repo, name), path.join(out, name), { recursive: true });
  }
  // Development notes and placeholders are not part of a downloadable game.
  for (const entry of fs.readdirSync(path.join(out, 'assets'), { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith('.md') || entry.name === '.gitkeep' || entry.name === '.DS_Store')) {
      fs.unlinkSync(path.join(entry.parentPath, entry.name));
    }
  }
  bundleRuntime(out);
}
