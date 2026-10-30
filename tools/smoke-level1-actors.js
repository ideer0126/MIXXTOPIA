#!/usr/bin/env node
'use strict';
// 本地页面、真实键盘输入与 Canvas；不连接账户服务。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.MIXX_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..');
const output = process.env.MIXX_ACTORS_OUTPUT || '/tmp/mixxtopia-71';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const errors = [], results = [];
  const server = http.createServer((req, res) => {
    const file = path.resolve(repo, '.' + new URL(req.url, 'http://local').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(repo + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.MIXX_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
    for (const touch of [false, true]) {
      const name = touch ? 'touch' : 'desktop';
      const context = await browser.newContext(touch
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 900 } });
      await context.addInitScript(() => { window.MIXX_NO_BOOT = true; });
      await context.route('**/*', route => route.request().url().startsWith(base + '/')
        ? route.continue() : route.fulfill({ status: 200, body: '' }));
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.goto(base);
      await page.addScriptTag({ url: base + '/tools/play-level1.js' });
      await page.evaluate(async () => {
        window.game = MIXX.main.boot(); game.stop();
        game._startNewGame(); level1Playthrough.finishDialogue(game);
        await Promise.all(Array.from(game._sceneryImages.values(), img => img.decode()));
      });
      const clipping = await page.evaluate(() => {
        const result = [];
        for (const [name,x,y,dx,dy] of [['plant',3,22,-4,0],['piano',16,5.5,-4,0],['stage',32,7,-4,0],['curtain',33,8,0,-4],['corner',37.5,5.7,-4,0],['eastWall',38,14,0,4]]) {
          game.player = {x:x*16,y:y*16};
          if (game.birthday.blockedAt(game.player.x,game.player.y)) throw new Error('起点被挡：'+name);
          for (let i=0;i<40;i++) game._moveAxis(dx,dy);
          if (game.birthday.blockedAt(game.player.x,game.player.y)) throw new Error('实体内部停步：'+name);
          if (game.player.x===x*16+dx*40&&game.player.y===y*16+dy*40) throw new Error('穿过实体：'+name);
          game._entryFade=0; game._followCamera(); game._render();
          result.push({name,x:game.player.x,y:game.player.y,image:game.renderer.ctx.canvas.toDataURL('image/png')});
        }
        game._startNewGame(); level1Playthrough.finishDialogue(game);
        return result;
      });
      for (const item of clipping) {
        fs.writeFileSync(path.join(output, name+'-clipping-'+item.name+'.png'), Buffer.from(item.image.split(',')[1], 'base64'));
        delete item.image;
      }
      const performance = await page.evaluate(() => {
        level1Playthrough.walkTo(game, 20, 9);
        game._entryFade = 0; game.camera.x = 190; game.camera.y = 0;
        // Fixed source-image rim pixels remain stable when the drum's outer crop changes.
        const points = [[685.79925,205.8118],[685.79925,215.8024],[666.8394,212.8052],[646.29956,210.8071]].map(([x,y]) => [x/1500*640,y/1049*448]);
        const ctx = game.renderer.ctx, detail = ctx.canvas.width / 320;
        const sample = () => points.map(([x,y]) => Array.from(ctx.getImageData(
          Math.round((x-game.camera.x)*detail), Math.round((y-game.camera.y)*detail), 1, 1).data));
        const guitarPoints = [[23.4,5.6],[23.2,6.4],[24.6,6.8]];
        const sampleGuitars = () => guitarPoints.map(([x,y]) => Array.from(ctx.getImageData(
          Math.round((x*16-game.camera.x)*detail), Math.round((y*16-game.camera.y)*detail), 1, 1).data));
        const draw = game.birthday.drawSprite;
        game.birthday.drawSprite = function(e, player) { if (e.id !== 'haewon') draw.call(this, e, player); };
        game._render(); const expectedRims = sample();
        game.birthday.drawSprite = function(e, player) { if (e.id !== 'kyujin') draw.call(this, e, player); };
        game._render(); const expectedGuitars = sampleGuitars();
        game.birthday.drawSprite = draw;
        const frames = [], rims = [], guitars = [];
        for (let phase = 0; phase < 4; phase++) {
          game.birthday.time = (phase+.1)/6; game._render();
          frames.push(ctx.canvas.toDataURL('image/png')); rims.push(sample()); guitars.push(sampleGuitars());
        }
        return { frames, rims, expectedRims, guitars, expectedGuitars };
      });
      assert.equal(new Set(performance.frames).size, 4, '四个演奏阶段须实际绘制不同画面');
      performance.rims.forEach(rims => assert.deepEqual(rims, performance.expectedRims, '人物补画不能盖掉前排鼓沿与鼓身'));
      performance.guitars.forEach(guitars => assert.deepEqual(guitars, performance.expectedGuitars, 'Kyujin 不能挡住后面的吉他架和音箱'));
      performance.frames.forEach((frame, i) => fs.writeFileSync(path.join(output, name + '-performance-' + i + '.png'), Buffer.from(frame.split(',')[1], 'base64')));
      for (const id of ['haewon', 'kyujin']) {
        await page.evaluate(id => {
          const e = game.level.entities.find(e => e.id === id && e.room === 'hall');
          const target = [[e.x,e.y],[e.x,e.y+1],[e.x,e.y-1],[e.x+1,e.y],[e.x-1,e.y]]
            .find(([x,y]) => level1Playthrough.pathTo(game,x,y) !== null);
          level1Playthrough.walkTo(game, target[0], target[1]);
        }, id);
        if (touch) await page.locator('#tbtn-a').tap();
        else await page.keyboard.press('e');
        const resting = await page.evaluate(id => {
          game._update(.05); game.input.endFrame();
          const e = game.level.entities.find(e => e.id === id && e.room === 'hall');
          const pose = game.birthday.pose(e, false);
          return { state: game.state, art: pose.style.art, frame: pose.frame, rest: pose.style.restFrame, dir: pose.dir };
        }, id);
        assert.equal(resting.state, 'dialogue');
        assert.equal(resting.art, id === 'haewon' ? 'haewonDrums' : 'kyujinGuitar');
        assert.equal(resting.frame, resting.rest); assert.equal(resting.dir, 0);
        await page.evaluate(() => { game._render(); level1Playthrough.finishDialogue(game); });
      }
      const approaches = [];
      for (const [key, dx, dy] of [['ArrowUp', 0, -1], ['ArrowDown', 0, 1], ['ArrowLeft', -1, 0], ['ArrowRight', 1, 0]]) {
        await page.evaluate(([dx, dy]) => {
          const e = game.level.entities.find(e => e.id === 'parent-mustard');
          game.player = { x: e.x * 16 - dx * 12, y: e.y * 16 - dy * 12 };
        }, [dx, dy]);
        await page.keyboard.down(key);
        await page.evaluate(() => {
          for (let i = 0; i < 20; i++) { game._update(.05); game.input.endFrame(); }
          game._entryFade = 0; game._followCamera(); game._render();
        });
        await page.keyboard.up(key);
        const approach = await page.evaluate(() => {
          const e = game.level.entities.find(e => e.id === 'parent-mustard');
          return { player: { ...game.player }, guest: { x: e.x * 16, y: e.y * 16 }, target: game._nearInteractable().id };
        });
        assert.equal(approach.target, 'parent-mustard');
        assert.ok(dx ? Math.abs(approach.player.x - approach.guest.x) >= 8 : Math.abs(approach.player.y - approach.guest.y) >= 5);
        approaches.push({ key, ...approach });
        await page.locator('#game').screenshot({ path: path.join(output, name + '-' + key + '.png') });
        if (key === 'ArrowUp') await page.locator('#game').screenshot({ path: path.join(output, name + '-after.png') });
      }
      if (touch) await page.locator('#tbtn-a').tap();
      else { await page.keyboard.press('e'); }
      await page.evaluate(() => { game._update(.05); game.input.endFrame(); });
      assert.equal(await page.evaluate(() => game.state), 'dialogue');
      await page.evaluate(() => level1Playthrough.finishDialogue(game));

      const patrol = await page.evaluate(() => {
        const e = game.level.entities.find(e => e.id === 'child-blue');
        game.player = { x: e.x * 16 - 16, y: e.y * 16 };
        for (let i = 0; i < 20; i++) { game._moveAxis(4, 0); game.birthday.update(.05); }
        const separation = e.x * 16 - game.player.x;
        game._entryFade = 0; game._followCamera(); game._render();
        return { separation, walking: e._walking };
      });
      assert.ok(patrol.separation >= 7);
      assert.equal(patrol.walking, false);
      await page.locator('#game').screenshot({ path: path.join(output, name + '-child.png') });
      await page.evaluate(() => {
        game.player = { x: 20 * 16, y: 15 * 16 };
        const actors = game.level.entities.filter(e => e.type === 'guest' && e.path);
        const ends = new Map(actors.map(e => [e.id, new Set()]));
        for (let i = 0; i < 1000; i++) {
          game.birthday.update(.05);
          for (const e of actors) {
            if (game.birthday.blockedAt(e.x * 16, e.y * 16, e)) throw new Error('巡游人物重叠：' + e.id);
            e.path.forEach(([x, y], j) => { if (Math.hypot(e.x - x, e.y - y) < .02) ends.get(e.id).add(j); });
          }
        }
        for (const e of actors) if (ends.get(e.id).size !== e.path.length) throw new Error('巡游未恢复：' + e.id);
        game._startNewGame(); level1Playthrough.finishDialogue(game);
        for (const [x, y] of [[13, 18], [16, 18], [6, 8], [6, 7], [7, 21]]) level1Playthrough.walkTo(game, x, y);
      });
      const complete = await page.evaluate(() => level1Playthrough.playLevel1(game, {
        onMusic(g) { g._entryFade = 0; g._followCamera(); g._render(); },
        beforePortal(g) {
          for (const id of ['haewon', 'bae', 'jiwoo', 'kyujin']) level1Playthrough.talkTo(g, id);
          g._entryFade = 0; g._followCamera(); g._render();
          window.backstageImage = document.getElementById('game').toDataURL('image/png');
        },
      }));
      assert.deepEqual(complete, { stars: 3, sheep: 1, gateOpen: true, state: 'clear' });
      fs.writeFileSync(path.join(output, name + '-backstage.png'), Buffer.from((await page.evaluate(() => window.backstageImage)).split(',')[1], 'base64'));
      await page.screenshot({ path: path.join(output, name + '-clear.png') });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      results.push({ name, clipping, performance: { frames: performance.frames.length, rims: performance.rims }, approaches, patrol, complete });
      await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
    console.log('全部通过：演奏四帧/鼓沿遮挡/持乐器对话、四向接近、巡游恢复、通道、六位 Muse、三星/唱片/后台/结算；desktop + touch');
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
