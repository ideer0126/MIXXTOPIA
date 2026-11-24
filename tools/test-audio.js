#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/audio.js'), 'utf8');
const contexts = [];
class Context {
  constructor() { this.currentTime = 0; this.state = 'running'; this.sources = []; this.buffers = []; contexts.push(this); }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  createBuffer(channels, length, sampleRate) {
    const samples = new Float32Array(length);
    const buffer = { duration: length / sampleRate, sampleRate, length, getChannelData: () => samples };
    this.buffers.push(buffer); return buffer;
  }
  createBufferSource() {
    const node = { loop: false, connect() {}, disconnect() { this.disconnected = true; },
      start(when, offset) { this.offset = offset; }, stop() { this.stopped = true; } };
    this.sources.push(node); return node;
  }
}
const sandbox = { AudioContext: Context }; vm.runInNewContext(source, sandbox);
const audio = sandbox.MIXX.audio;
audio.setMusic('l2_kerosene');
assert.equal(contexts.length, 0, '指定音乐不能绕过首次手势创建音频上下文');
audio.unlock();
const context = contexts[0], buffer = context.buffers[0], samples = buffer.getChannelData(0);
assert.equal(audio.musicState().playing, true); assert.equal(buffer.duration, 20);
assert.equal(context.sources[0].loop, true);
let peak = 0, sum = 0;
for (const value of samples) { assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); sum += value * value; }
assert.ok(peak > .05 && peak < .5, '音乐有信号且合成峰值留有余量');
assert.ok(Math.sqrt(sum / samples.length) > .01);
assert.ok(Math.abs(samples[0] - samples.at(-1)) < .02, '跨循环音符尾音连续');
audio.setMusic('l2_kerosene'); assert.equal(context.sources.length, 1, '重复状态同步不叠加播放器');
context.currentTime = 3.5; audio.setMusic('l2_kerosene', false);
assert.equal(audio.musicState().playing, false); assert.equal(audio.musicState().offset, 3.5);
assert.ok(context.sources[0].stopped && context.sources[0].disconnected);
context.currentTime = 12; audio.setMusic('l2_kerosene');
assert.equal(context.sources[1].offset, 3.5, '暂停期间不推进音乐');
audio.setEnabled(false); assert.equal(audio.musicState().playing, false);
audio.setEnabled(true); assert.equal(audio.musicState().playing, true);
assert.equal(context.buffers.length, 1, '重进/重玩复用合成缓冲');
audio.setMusic('l1_candle'); assert.equal(audio.musicState().playing, false); assert.equal(audio.musicState().offset, 0);
audio.setMusic('l2_kerosene'); assert.equal(context.sources.at(-1).offset, 0);
const unsupported = {}; vm.runInNewContext(source, unsupported);
unsupported.MIXX.audio.setMusic('l2_kerosene');
assert.equal(unsupported.MIXX.audio.unlock(), false); assert.equal(unsupported.MIXX.audio.musicState().playing, false);
if (process.argv.includes('--export')) {
  const output = path.join(__dirname, '../docs/previews/level2/kerosene-bgm.wav');
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(buffer.sampleRate, 24); wav.writeUInt32LE(buffer.sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => wav.writeInt16LE(Math.round(value * 32767), 44 + i * 2));
  fs.writeFileSync(output, wav);
}
console.log('音乐手势解锁、20 秒循环、缓冲复用、暂停续播、静音、换关与无音频降级通过。');
