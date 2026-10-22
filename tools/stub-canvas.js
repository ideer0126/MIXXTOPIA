/**
 * tools/stub-canvas.js —— Node 测试用极简 Canvas 2D 桩
 *
 * 供 tools/test-engine.js 同规格复用（tools/test-main.js 使用）：
 * 覆盖引擎/主状态机渲染用到的 fillRect / drawImage / getImageData /
 * putImageData / save / restore / translate / createImageData；
 * fillRect 仅认 rgb() 颜色字符串（代码内渲染请避免 rgba 等桩不支持的格式）。
 */
'use strict';

const RGB_RE = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/;

class FakeCanvas {
  constructor(width = 300, height = 150) {
    this._w = width;
    this._h = height;
    this.style = {};
    this.ctx = new FakeContext(this);
  }
  // 引擎会改写 canvas.width/height（320×224），像素缓冲随之重分配
  get width() {
    return this._w;
  }
  set width(v) {
    this._w = v;
    this.ctx._realloc();
  }
  get height() {
    return this._h;
  }
  set height(v) {
    this._h = v;
    this.ctx._realloc();
  }
  getContext(type) {
    if (type !== '2d') throw new Error('FakeCanvas 仅支持 2d 上下文');
    return this.ctx;
  }
}

class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.imageSmoothingEnabled = true;
    this.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    this.fillStyle = '#000000';
    this._tx = 0;
    this._ty = 0;
    this._stack = [];
  }
  _realloc() {
    this.pixels = new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4);
  }
  save() {
    this._stack.push([this._tx, this._ty, this.fillStyle]);
  }
  restore() {
    if (this._stack.length) [this._tx, this._ty, this.fillStyle] = this._stack.pop();
  }
  translate(x, y) {
    this._tx += x;
    this._ty += y;
  }
  createImageData(w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  getImageData(x, y, w, h) {
    const out = this.createImageData(w, h);
    const cw = this.canvas.width;
    for (let row = 0; row < h; row++) {
      const src = (y + row) * cw + x;
      out.data.set(this.pixels.subarray(src * 4, (src + w) * 4), row * w * 4);
    }
    return out;
  }
  putImageData(img, x = 0, y = 0) {
    const cw = this.canvas.width;
    for (let row = 0; row < img.height; row++) {
      const dst = ((y + row) * cw + x) * 4;
      this.pixels.set(img.data.subarray(row * img.width * 4, (row + 1) * img.width * 4), dst);
    }
  }
  fillRect(x, y, w, h) {
    const m = RGB_RE.exec(String(this.fillStyle));
    if (!m) return; // 非 rgb() 格式桩内忽略
    const c = [Number(m[1]), Number(m[2]), Number(m[3])];
    const x0 = Math.max(0, Math.floor(x + this._tx));
    const y0 = Math.max(0, Math.floor(y + this._ty));
    const x1 = Math.min(this.canvas.width, Math.ceil(x + this._tx + w));
    const y1 = Math.min(this.canvas.height, Math.ceil(y + this._ty + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = (py * this.canvas.width + px) * 4;
        this.pixels[i] = c[0];
        this.pixels[i + 1] = c[1];
        this.pixels[i + 2] = c[2];
        this.pixels[i + 3] = 255;
      }
    }
  }
  // 支持 (img, dx, dy) 与 (img, sx, sy, sw, sh, dx, dy, dw, dh)
  drawImage(src, ...args) {
    let sx = 0, sy = 0, sw = src.width, sh = src.height, dx, dy, dw = sw, dh = sh;
    if (args.length === 2) {
      [dx, dy] = args;
    } else if (args.length === 8) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    } else {
      throw new Error('drawImage 参数形式不支持：' + args.length);
    }
    const s = src.ctx.pixels;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    for (let py = 0; py < dh; py++) {
      for (let px = 0; px < dw; px++) {
        const sx2 = sx + Math.min(sw - 1, Math.floor((px * sw) / dw));
        const sy2 = sy + Math.min(sh - 1, Math.floor((py * sh) / dh));
        const si = (sy2 * src.width + sx2) * 4;
        const tx = dx + px + this._tx;
        const ty = dy + py + this._ty;
        if (tx < 0 || ty < 0 || tx >= cw || ty >= ch) continue;
        const di = (ty * cw + tx) * 4;
        this.pixels[di] = s[si];
        this.pixels[di + 1] = s[si + 1];
        this.pixels[di + 2] = s[si + 2];
        this.pixels[di + 3] = s[si + 3];
      }
    }
  }
}

module.exports = { FakeCanvas, FakeContext, RGB_RE };
