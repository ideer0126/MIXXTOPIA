/**
 * js/audio.js —— WebAudio 芯片音效
 *
 * Issue #9：先落地收集/机关所需的最小音效接口（星、开关、门、推箱、传送门），
 * 由 main.js 在机制事件处调用 `MIXX.audio.play(name)`。
 * Issue #14 在此基础上扩展完整音效表与每关 BGM 循环，本文件的
 * `play(name)` / `setEnabled(v)` / `unlock()` 接口保持不变。
 *
 * 设计约束：
 *   - 零素材：全部用 OscillatorNode 现场合成短音，不引入音频文件；
 *   - 安静失败：测试/无 WebAudio 环境（Node、旧浏览器）下 play 返回 false，不抛错；
 *   - 遵守声音开关：main.js 调用 setEnabled(false) 后不再出声；
 *   - 自动播放策略：首次 pointerdown / keydown 时 unlock() 创建并恢复 AudioContext，
 *     把创建动作放在用户手势里，避免 Chrome/Safari 的自动播放拦截。
 */
'use strict';

(function (root) {
  'use strict';

  /* 音效表：at = 相对起播延迟（秒），d = 时长（秒），f = 频率（Hz），v = 音量，type = 波形 */
  const SFX = {
    // 唱片机启动的原创音乐盒提示音；专辑原声尚未接入。
    'record-start': [
      { f: 523, d: 0.28, at: 0, v: 0.08, type: 'triangle' },
      { f: 659, d: 0.28, at: 0.18, v: 0.08, type: 'triangle' },
      { f: 784, d: 0.36, at: 0.36, v: 0.08, type: 'triangle' },
      { f: 988, d: 0.30, at: 0.62, v: 0.07, type: 'triangle' },
      { f: 880, d: 0.30, at: 0.84, v: 0.07, type: 'triangle' },
      { f: 784, d: 0.50, at: 1.08, v: 0.07, type: 'triangle' },
      { f: 659, d: 0.40, at: 1.36, v: 0.06, type: 'triangle' },
      { f: 523, d: 0.65, at: 1.60, v: 0.06, type: 'triangle' },
    ],
    star: [
      { f: 988, d: 0.06, at: 0, v: 0.10, type: 'square' },
      { f: 1319, d: 0.10, at: 0.05, v: 0.09, type: 'square' },
    ],
    oil: [
      { f: 440, d: .07, at: 0, v: .07, type: 'triangle' },
      { f: 660, d: .10, at: .06, v: .06, type: 'triangle' },
    ],
    lamp: [
      { f: 196, d: .12, at: 0, v: .06, type: 'sawtooth' },
      { f: 392, d: .16, at: .08, v: .06, type: 'triangle' },
      { f: 784, d: .18, at: .16, v: .05, type: 'triangle' },
    ],
    box: [
      { f: 147, d: 0.05, at: 0, v: 0.08, type: 'triangle' },
      { f: 110, d: 0.06, at: 0.03, v: 0.06, type: 'triangle' },
    ],
    switch: [
      { f: 330, d: 0.05, at: 0, v: 0.08, type: 'square' },
      { f: 247, d: 0.08, at: 0.03, v: 0.07, type: 'square' },
    ],
    'gate-open': [
      { f: 196, d: 0.10, at: 0, v: 0.07, type: 'sawtooth' },
      { f: 294, d: 0.12, at: 0.06, v: 0.06, type: 'sawtooth' },
    ],
    'gate-close': [
      { f: 196, d: 0.08, at: 0, v: 0.06, type: 'sawtooth' },
      { f: 147, d: 0.10, at: 0.05, v: 0.06, type: 'sawtooth' },
    ],
    portal: [
      { f: 523, d: 0.10, at: 0, v: 0.07, type: 'square' },
      { f: 659, d: 0.10, at: 0.06, v: 0.07, type: 'square' },
      { f: 784, d: 0.10, at: 0.12, v: 0.07, type: 'square' },
      { f: 1047, d: 0.18, at: 0.18, v: 0.08, type: 'square' },
    ],
    'portal-enter': [
      { f: 659, d: 0.08, at: 0, v: 0.07, type: 'square' },
      { f: 880, d: 0.08, at: 0.05, v: 0.07, type: 'square' },
      { f: 1319, d: 0.20, at: 0.10, v: 0.08, type: 'square' },
    ],
    /* 战斗（Issue #18）：轻击 / 重击 / 能量炮 / 命中 / 敌人倒下 / 受伤 / 倒下 / 充满 */
    light: [
      { f: 880, d: 0.05, at: 0, v: 0.06, type: 'square' },
      { f: 660, d: 0.06, at: 0.03, v: 0.05, type: 'square' },
    ],
    heavy: [
      { f: 330, d: 0.08, at: 0, v: 0.08, type: 'sawtooth' },
      { f: 196, d: 0.12, at: 0.04, v: 0.07, type: 'sawtooth' },
    ],
    cannon: [
      { f: 262, d: 0.10, at: 0, v: 0.07, type: 'sawtooth' },
      { f: 392, d: 0.10, at: 0.05, v: 0.07, type: 'sawtooth' },
      { f: 523, d: 0.14, at: 0.10, v: 0.08, type: 'square' },
      { f: 131, d: 0.16, at: 0.12, v: 0.08, type: 'triangle' },
    ],
    hit: [
      { f: 156, d: 0.05, at: 0, v: 0.06, type: 'triangle' },
    ],
    'enemy-down': [
      { f: 659, d: 0.06, at: 0, v: 0.06, type: 'square' },
      { f: 392, d: 0.08, at: 0.05, v: 0.06, type: 'square' },
      { f: 262, d: 0.14, at: 0.10, v: 0.06, type: 'square' },
    ],
    hurt: [
      { f: 131, d: 0.10, at: 0, v: 0.07, type: 'sawtooth' },
      { f: 87, d: 0.12, at: 0.05, v: 0.06, type: 'sawtooth' },
    ],
    'player-down': [
      { f: 392, d: 0.12, at: 0, v: 0.07, type: 'triangle' },
      { f: 262, d: 0.14, at: 0.10, v: 0.07, type: 'triangle' },
      { f: 165, d: 0.24, at: 0.22, v: 0.07, type: 'triangle' },
    ],
    'energy-full': [
      { f: 1047, d: 0.08, at: 0, v: 0.06, type: 'square' },
      { f: 1319, d: 0.14, at: 0.07, v: 0.06, type: 'square' },
    ],
  };

  let ctx = null;
  let master = null;
  let enabled = true;
  let musicTrack = null;
  let musicActive = false;
  let musicSource = null;
  let musicOffset = 0;
  let musicStartedAt = 0;
  let musicBuffer = null;

  /** 原创 8 小节灯笼爵士：96 BPM，Dm9 → G13 → Cmaj7 → A7，摇摆八分音符。 */
  function createLanternLoop(c) {
    const rate = 22050, beat = 60 / 96;
    const buffer = c.createBuffer(1, Math.round(32 * beat * rate), rate);
    const samples = buffer.getChannelData(0);
    const chords = [[50, 57, 60, 64, 69], [43, 53, 59, 64, 69], [48, 55, 59, 62, 67], [45, 55, 61, 64, 67]];
    const melody = [
      [69, 72, 76, 74, 72, 69, 67, 65], [67, 71, 74, 76, 74, 71, 69, 67],
      [67, 71, 74, 72, 71, 67, 64, 62], [64, 67, 73, 76, 73, 70, 67, 64],
      [65, 69, 72, 76, 74, 72, 69, 65], [67, 69, 71, 74, 76, 74, 71, 67],
      [64, 67, 71, 74, 72, 71, 67, 64], [67, 64, 61, 64, 69, 67, 64, 61],
    ];
    // 全部音符离线混成一个内存缓冲，循环不需要定时器，也不加载音频文件。
    function note(midi, at, duration, volume, instrument) {
      const start = Math.round(at * beat * rate), length = Math.round(duration * beat * rate);
      const frequency = 440 * Math.pow(2, (midi - 69) / 12);
      for (let i = 0; i < length; i++) {
        const t = i / rate, phase = 2 * Math.PI * frequency * t;
        const envelope = Math.min(1, t / .008) * Math.pow(1 - i / length, 2);
        const wave = instrument === 'bass' ? Math.sin(phase) + .22 * Math.sin(phase * 2)
          : instrument === 'brush' ? Math.sin(i * 2.37) * Math.sin(i * .137) + .3 * Math.sin(i * .913)
          : Math.sin(phase) + .3 * Math.sin(phase * 2) * Math.exp(-t * 8) + .12 * Math.sin(phase * 3);
        samples[(start + i) % samples.length] += wave * volume * envelope;
      }
    }
    for (let bar = 0; bar < 8; bar++) {
      const chord = chords[bar % 4];
      for (const at of [.5, 2 + 2 / 3]) for (const pitch of chord.slice(1)) note(pitch + 12, bar * 4 + at, .55, .018, 'keys');
      for (let b = 0; b < 4; b++) {
        note(chord[0] + (b % 2 ? 7 : 0), bar * 4 + b, .62, .09, 'bass');
        note(30, bar * 4 + b + (b % 2 ? 0 : 2 / 3), .16, .018, 'brush');
      }
      for (let n = 0; n < 8; n++) note(melody[bar][n], bar * 4 + n / 2 + (n % 2 ? 1 / 6 : 0), .42, .046, 'keys');
    }
    return buffer;
  }

  /** 启停共用入口：暂停/静音/隐藏时保存位置，恢复时从该处继续。 */
  function syncMusic() {
    const shouldPlay = musicTrack === 'l2_kerosene' && musicActive && enabled && !!ctx;
    if (musicSource && !shouldPlay) {
      musicOffset = (musicOffset + ctx.currentTime - musicStartedAt) % musicBuffer.duration;
      musicSource.stop(); musicSource.disconnect(); musicSource = null;
    }
    if (!shouldPlay || musicSource) return;
    if (!musicBuffer) musicBuffer = createLanternLoop(ctx);
    musicSource = ctx.createBufferSource();
    musicSource.buffer = musicBuffer; musicSource.loop = true;
    musicSource.connect(master); musicStartedAt = ctx.currentTime;
    musicSource.start(0, musicOffset);
  }

  function AudioCtor() {
    return root.AudioContext || root.webkitAudioContext || null;
  }

  /** 惰性创建 AudioContext / 主音量；无 WebAudio 或创建失败返回 null */
  function ensureContext() {
    if (ctx) return ctx;
    const Ctor = AudioCtor();
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = enabled ? 0.5 : 0;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
      master = null;
      return null;
    }
    return ctx;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* 忽略：未获得手势授权时保持静音 */ }
    }
  }

  /** 单音：短促起音 + 指数衰减，芯片音色 */
  function tone(note) {
    const c = ensureContext();
    if (!c || !master) return;
    const t0 = c.currentTime + note.at;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = note.type || 'square';
    osc.frequency.setValueAtTime(note.f, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, note.v), t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.d);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + note.d + 0.02);
  }

  const audio = {
    /** 首次用户手势时调用：创建并恢复 AudioContext（自动播放策略） */
    unlock() {
      const c = ensureContext();
      if (c) { resume(); syncMusic(); }
      return !!c;
    },

    /** 声音开关：关闭后静音且 play() 直接返回 false */
    setEnabled(v) {
      enabled = !!v;
      if (master) master.gain.value = enabled ? 0.5 : 0;
      syncMusic();
    },

    isEnabled() {
      return enabled;
    },

    /** 仅已制作的主题播放 BGM；无音频能力时保留游玩，首次手势解锁后再启动。 */
    setMusic(name, active = true) {
      const next = name === 'l2_kerosene' ? name : null;
      if (next !== musicTrack) {
        musicActive = false; syncMusic(); musicOffset = 0; musicTrack = next;
      }
      musicActive = !!active;
      syncMusic();
    },

    musicState() {
      return { track: musicTrack, playing: !!musicSource, offset: musicOffset, duration: musicBuffer ? musicBuffer.duration : 0 };
    },

    /**
     * 播放具名音效；未知音效/关闭/无 WebAudio 时安静返回 false。
     * @param {string} name star | box | switch | gate-open | gate-close | portal | portal-enter
     *   | light | heavy | cannon | hit | enemy-down | hurt | player-down | energy-full（#18）
     */
    play(name) {
      if (!enabled) return false;
      const notes = SFX[name];
      if (!notes) return false;
      if (!ensureContext()) return false;
      resume();
      for (let i = 0; i < notes.length; i++) tone(notes[i]);
      return true;
    },

    /** 供测试/调试读取的音效名列表 */
    SFX_NAMES: Object.keys(SFX),
  };

  root.MIXX = root.MIXX || {};
  root.MIXX.audio = audio;

  // 首次交互解锁音频（listener 只绑定一次；测试桩环境的 addEventListener 为 no-op）
  if (typeof root.addEventListener === 'function') {
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      audio.unlock();
      if (typeof root.removeEventListener === 'function') {
        root.removeEventListener('pointerdown', unlock);
        root.removeEventListener('keydown', unlock);
      }
    };
    root.addEventListener('pointerdown', unlock);
    root.addEventListener('keydown', unlock);
  }
})(typeof window !== 'undefined' ? window : globalThis);
