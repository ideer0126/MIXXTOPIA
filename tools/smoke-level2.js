#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.MIXX_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..');
const output = process.env.MIXX_LEVEL2_OUTPUT || path.join(repo, '.ds/level2-smoke');

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const errors = [], results = [];
  const server = http.createServer((req, res) => {
    const file = path.resolve(repo, '.' + new URL(req.url, 'http://local').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(repo + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' })[path.extname(file)] || 'application/octet-stream' }).end(body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.MIXX_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  try {
    for (const [name, width, height, touch] of [['desktop', 1280, 900, false], ['portrait', 390, 844, true], ['landscape', 844, 390, true]]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
      await context.addInitScript(() => {
        window.MIXX_NO_BOOT = true;
        window.testAudioContexts = [];
        const NativeAudioContext = window.AudioContext;
        window.AudioContext = class extends NativeAudioContext {
          constructor(...args) { super(...args); window.testAudioContexts.push(this); }
        };
      });
      await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.fulfill({ status: 200, body: '' }));
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(name + ': ' + e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(name + ': ' + msg.text()); });
      await page.goto(base);
      await page.addScriptTag({ url: base + '/tools/play-level1.js' });
      await page.addScriptTag({ url: base + '/tools/play-level2.js' });
      await page.evaluate(async () => {
        window.game = MIXX.main.boot({ auth: null, cloud: null, stats: null }); game.stop();
        game._startNewGame(); level1Playthrough.finishDialogue(game);
        level1Playthrough.playLevel1(game);
        if (game.store.readSlot(0).current !== 2) throw Error('第一关自动存档没有指向第二关');
        game._nextFromClear();
        if (game.level.id !== 2) throw Error('第一关没有衔接第二关');
        game.input.setTouchMode('on'); game.input.endFrame(); game._render();
      });
      await page.screenshot({ path: path.join(output, name + '-entry.png') });
      const beforeDash = await page.evaluate(() => ({ ...game.player }));
      if (touch) await page.locator('#tbtn-d').dispatchEvent('pointerdown', { pointerId: 5, pointerType: 'touch', bubbles: true });
      else await page.keyboard.down('Shift');
      await page.evaluate(() => { game._update(0); game.input.endFrame(); });
      if (touch) await page.locator('#tbtn-d').dispatchEvent('pointerup', { pointerId: 5, pointerType: 'touch', bubbles: true });
      else await page.keyboard.up('Shift');
      const afterDash = await page.evaluate(() => ({ ...game.player }));
      assert.ok(Math.abs(Math.hypot(afterDash.x - beforeDash.x, afterDash.y - beforeDash.y) - 48) < .001, name + ' 的闪步输入应移动三格');
      // Drive real keyboard / PointerEvent listeners while manually advancing the stopped loop.
      async function walkTo(id) {
        // 遭遇时先松开方向键迎击，再从实际位置重新规划；击退不应被当成移动卡死。
        for (let encounter = 0; encounter < 24; encounter++) {
          await page.evaluate(() => level2Playthrough.fightNearby(game));
          const route = await page.evaluate(id => {
            const e = typeof id === 'string' ? game.level.entities.find(e => e.id === id) : id;
            const route = level1Playthrough.pathTo(game, e.x, e.y);
            if (!route) throw Error('不可达：' + id);
            const points = [[game.player.x / 16, game.player.y / 16], ...route];
            return points.filter((p, i) => i === 0 || i === points.length - 1
              || Math.sign(p[0] - points[i - 1][0]) !== Math.sign(points[i + 1][0] - p[0])
              || Math.sign(p[1] - points[i - 1][1]) !== Math.sign(points[i + 1][1] - p[1]));
          }, id);
          let interrupted = false;
          for (let i = 1; i < route.length; i++) {
            const [x, y] = route[i], [px, py] = route[i - 1];
            const dir = x > px ? 'right' : x < px ? 'left' : y > py ? 'down' : 'up';
            const key = 'Arrow' + dir[0].toUpperCase() + dir.slice(1);
            const button = page.locator('[data-key="' + dir + '"]');
            if (touch) await button.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', bubbles: true });
            else await page.keyboard.down(key);
            interrupted = await page.evaluate(([x, y]) => {
              const tx = x * 16, ty = y * 16;
              for (let guard = 0; guard < 2000 && Math.hypot(tx - game.player.x, ty - game.player.y) > .001; guard++) {
                if (game.combat.enemies.some(e => !e.dead && Math.hypot(e.x + e.size / 2 - game.player.x - 8, e.y + e.size / 2 - game.player.y - 8) <= e.aggro
                  && game.combat.hasLineOfSight(game.mechanics, game.player.x + 8, game.player.y + 8, e.x + e.size / 2, e.y + e.size / 2))) return true;
                const distance = Math.abs(tx - game.player.x) + Math.abs(ty - game.player.y);
                const before = { ...game.player };
                const hp = game.combat.hp;
                game._update(Math.min(1 / 60, distance / 80)); game.input.endFrame();
                if (game.state === 'dialogue') {
                  level1Playthrough.finishDialogue(game);
                  if (game.state === 'clear') return; // 接触传送门即结算，不必再走到格子中心
                }
                if (game.combat.hp !== hp) return true; // 喷口击退或复活后，从实际站位重新寻路。
                if (game.player.x === before.x && game.player.y === before.y) throw Error('输入移动被阻挡：' + JSON.stringify({ before, target: [tx, ty], state: game.state, axis: game.input.getAxis() }));
                if (game.mechanics.blockedAt(game.player.x, game.player.y, 16)) throw Error('移动进入墙或关闭的门');
              }
              if (Math.hypot(tx - game.player.x, ty - game.player.y) > .001) throw Error('输入未抵达目的地');
            }, [x, y]);
            if (touch) await button.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', bubbles: true });
            else await page.keyboard.up(key);
            await page.evaluate(() => { game._update(0); game.input.endFrame(); });
            if (await page.evaluate(() => game.state === 'clear')) return;
            if (interrupted) break;
          }
          if (!interrupted) return;
        }
        throw Error('遭遇战后无法抵达：' + id);
      }
      async function interact() {
        if (touch) await page.locator('#tbtn-a').tap(); else await page.keyboard.press('e');
        await page.evaluate(() => { game._update(0); game.input.endFrame(); level1Playthrough.finishDialogue(game); });
      }
      await walkTo('lamp1'); await interact(); // no-oil interaction must not open a gate
      assert.equal(await page.evaluate(() => game._entitiesOf('gate')[0].open), false);
      await walkTo('jiwoo'); await interact();
      const music = await page.evaluate(() => {
        const a = MIXX.audio;
        if (!a.musicState().playing || testAudioContexts[0].state !== 'running') throw Error('手势后音乐未实际启动');
        game._setState(MIXX.main.STATE.PAUSED);
        if (a.musicState().playing) throw Error('暂停未停止 BGM');
        game._setState(MIXX.main.STATE.PLAYING);
        if (!a.musicState().playing) throw Error('继续未恢复 BGM');
        game._playNode('l2.intro');
        if (!a.musicState().playing) throw Error('对话中 BGM 应继续');
        level1Playthrough.finishDialogue(game);
        game._toggleSound(); if (a.musicState().playing) throw Error('静音未停止 BGM');
        game._toggleSound(); if (!a.musicState().playing) throw Error('开声音未恢复 BGM');
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        if (a.musicState().playing) throw Error('隐藏页面未停止 BGM');
        delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
        if (!a.musicState().playing) throw Error('页面恢复未继续 BGM');
        const cached = game.kerosene.background;
        game._render(); game._render();
        if (game.kerosene.background !== cached) throw Error('静态背景未复用');
        return a.musicState();
      });
      for (let n = 1; n <= 3; n++) {
        await walkTo('oil' + n);
        assert.equal(await page.evaluate(() => game.carriedOil?.id), 'oil' + n);
        if (n === 1) {
          await page.evaluate(() => { game._setState(MIXX.main.STATE.PAUSED); game._saveAndQuit(); game._continueGame(); });
          assert.equal(await page.evaluate(() => game.carriedOil?.id), 'oil1');
        }
        await walkTo('lamp' + n); await interact();
        assert.equal(await page.evaluate(() => game.state), 'puzzle');
        await page.evaluate(() => game._render());
        await page.locator('#game').screenshot({ path: path.join(output, name + '-puzzle' + n + '.png') });
        await page.evaluate(n => level2Playthrough.solveLantern(game, 'lamp' + n), n);
        await walkTo('lamp' + n); await interact();
        assert.equal(await page.evaluate(n => game._entitiesOf('lamp').find(e => e.id === 'lamp' + n).lit, n), true);
        assert.equal(await page.evaluate(() => game.carriedOil), null);
        if (n === 2) {
          await page.evaluate(() => { game._setState(MIXX.main.STATE.PAUSED); game._saveAndQuit(); game._continueGame(); });
          assert.equal(await page.evaluate(() => game._entitiesOf('gate').filter(e => e.open).length), 2);
        }
        await walkTo('s2_' + n);
        await page.evaluate(() => game._render());
        await page.screenshot({ path: path.join(output, name + '-lamp' + n + '.png') });
      }
      await walkTo('corner-help'); await interact();
      await walkTo('s2_4');
      assert.equal(await page.evaluate(() => game.collected.includes('s2_4')), false, '未解水机关不能隔着石罩拿星');
      await walkTo('ruins-valve'); await interact();
      await page.evaluate(() => { for (let i=0;i<120;i++) { game._update(1/60); game.input.endFrame(); } });
      assert.equal(await page.evaluate(() => game.ruins.solved), false, '只放水不能解机关');
      await walkTo('ruins-reset'); await interact();
      await page.evaluate(() => game._render());
      const observe = await page.evaluate(() => { const r=game.canvas.getBoundingClientRect();return {x:r.x+290*r.width/320,y:r.y+185*r.height/224}; });
      if (touch) await page.touchscreen.tap(observe.x,observe.y); else await page.keyboard.press('h');
      await page.evaluate(() => { game._update(0); game.input.endFrame(); });
      assert.ok(await page.evaluate(() => game.ruins.message.includes('卡槽')), '观察提示应可通过键盘或触屏打开');
      await walkTo({x:213,y:8});
      await page.evaluate(() => game._render());
      await page.locator('#game').screenshot({path:path.join(output,name+'-ruins-empty.png')});
      for (let step=0;step<3;step++) {
        await walkTo({x:213+step,y:8});
        if (touch) await page.locator('[data-key="right"]').dispatchEvent('pointerdown',{pointerId:7,pointerType:'touch',bubbles:true});
        else await page.keyboard.down('ArrowRight');
        await page.evaluate(() => { game._update(1/60); game.input.endFrame(); });
        if (touch) await page.locator('[data-key="right"]').dispatchEvent('pointerup',{pointerId:7,pointerType:'touch',bubbles:true});
        else await page.keyboard.up('ArrowRight');
        assert.equal(await page.evaluate(() => game._entitiesOf('box').find(e=>e.id==='ruins-raft').x),215+step);
      }
      await walkTo('ruins-rope'); await interact();
      assert.equal(await page.evaluate(() => game.ruins.tied),true);
      await page.evaluate(() => game._render());
      await page.locator('#game').screenshot({path:path.join(output,name+'-ruins-tied.png')});
      await walkTo('ruins-valve'); await interact();
      await page.evaluate(() => { for(let i=0;i<120;i++){ game._update(1/60);game.input.endFrame(); } game._render(); });
      assert.equal(await page.evaluate(() => game.ruins.solved),true);
      await page.locator('#game').screenshot({path:path.join(output,name+'-ruins-filled.png')});
      await walkTo('s2_4');
      await walkTo('byeori'); await interact();
      await page.evaluate(() => game._render());
      await page.screenshot({ path: path.join(output, name + '-exit.png') });
      assert.ok(await page.evaluate(() => game.camera.x > 3200), '终点镜头应滚动到长廊远端');
      if (name === 'desktop') {
        const png = await page.evaluate(() => {
          const image = document.createElement('canvas'); image.width = game.level.map.w * 16; image.height = game.level.map.h * 16;
          const c = image.getContext('2d'); c.imageSmoothingEnabled = false;
          const camera = { ...game.camera };
          game._setState(MIXX.main.STATE.PAUSED); // 拼接整图时隐藏与单个视口绑定的互动提示
          for (let y = 0; y < image.height; y += 224) for (let x = 0; x < image.width; x += 320) {
            game.camera.x = Math.min(x, image.width - 320); game.camera.y = Math.min(y, image.height - 224); game._render();
            c.drawImage(game.renderer.ctx.canvas, game.camera.x, game.camera.y, 320, 224);
          }
          Object.assign(game.camera, camera); game._setState(MIXX.main.STATE.PLAYING); game._render();
          return image.toDataURL('image/png').split(',')[1];
        });
        fs.writeFileSync(path.join(output, 'overview.png'), Buffer.from(png, 'base64'));
      }
      await walkTo('exit');
      await page.evaluate(() => { level1Playthrough.finishDialogue(game); game._render(); });
      assert.equal(await page.evaluate(() => game.state), 'clear');
      assert.equal(await page.evaluate(() => MIXX.audio.musicState().playing), false);
      const result = await page.evaluate(() => ({ stars: game.stars, lit: game._entitiesOf('lamp').filter(e => e.lit).length, current: game.store.readSlot(0).current, cleared: game.store.readSlot(0).cleared }));
      assert.equal(result.stars, 4); assert.equal(result.lit, 3); assert.equal(result.current, 2); assert.deepEqual(result.cleared, [1, 2]);
      await page.evaluate(() => {
        game._nextFromClear(); if (game.state !== 'title') throw Error('未制作第三关时应返回标题');
        game._continueGame(); if (game.stars !== 4 || !game._portalActive()) throw Error('完整通关存档未恢复');
        game._setState(MIXX.main.STATE.PAUSED); game._restartLevel();
        const result = level2Playthrough.playLevel2(game);
        if (result.stars !== 4 || result.lamps !== 3) throw Error('重玩无法通关');
        game._setState(MIXX.main.STATE.PLAYING);
        if (!MIXX.audio.musicState().playing) throw Error('重玩后音乐未恢复');
        game.destroy(); if (MIXX.audio.musicState().playing) throw Error('销毁后残留 BGM');
      });
      results.push({ name, ...result, music }); await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ results, errors }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(err => { console.error(err); process.exitCode = 1; });
