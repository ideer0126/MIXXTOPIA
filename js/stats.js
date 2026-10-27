/** #46: local, owner-bound journals + idempotent cloud statistics; no timers or polling. */
'use strict';
(function (root) {
  const ACHIEVEMENTS = Object.freeze({
    first_star: '初见星光：收集第一颗愿望之星',
    first_clear: '梦境启程：首次通关',
    wish_keeper: '愿望守护者：一关星星全收集',
    journey_complete: '梦境终章：完成全部关卡',
  });
  const copy = x => JSON.parse(JSON.stringify(x));
  const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const secondsOK = n => Number.isSafeInteger(n) && n >= 0 && n <= 3153600000;
  const millisOK = n => Number.isSafeInteger(n) && n >= 0 && n <= 3153600000000;
  const knownAchievement = id => Object.prototype.hasOwnProperty.call(ACHIEVEMENTS, id);
  const millis = r => Math.round(r.seconds * 1000);
  const writerOK = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
  function empty(uid) {
    return { user_id: uid, play_seconds: 0, remainder_ms: 0, achievements: [], device_millis: {}, collections: {} };
  }
  function validate(row, uid) {
    if (!object(row) || row.user_id !== uid || !secondsOK(row.play_seconds)
      || !Number.isInteger(row.remainder_ms) || row.remainder_ms < 0 || row.remainder_ms > 999
      || !Array.isArray(row.achievements) || !row.achievements.every(x => typeof x === 'string')
      || !object(row.device_millis) || !Object.keys(row.device_millis).every(k => writerOK(k) && millisOK(row.device_millis[k]))
      || !object(row.collections) || !Object.keys(row.collections).every(k => /^\d+$/.test(k)
        && Array.isArray(row.collections[k]) && row.collections[k].every(id => typeof id === 'string'))) {
      throw new Error('统计数据格式无法识别');
    }
    return copy(row);
  }
  /** Percentages always use the current map's IDs, excluding duplicates and unknown IDs. */
  function collectionRates(levels, collections) {
    return levels.filter(l => l.id > 0).map(l => {
      const ids = new Set((l.entities || []).filter(e => e.type === 'star').map(e => e.id));
      const total = ids.size;
      const got = new Set((collections[String(l.id)] || []).filter(id => ids.has(id))).size;
      return { id: l.id, title: l.title || ('关卡 ' + l.id), got, total,
        percent: total ? Math.floor(got * 100 / total) : 0 };
    });
  }
  function localCollections(slots) {
    const out = {};
    for (const slot of slots) {
      if (!slot || !object(slot.stars)) continue;
      for (const k of Object.keys(slot.stars)) {
        if (/^\d+$/.test(k) && Array.isArray(slot.stars[k])) {
          out[k] = Array.from(new Set((out[k] || []).concat(slot.stars[k].filter(id => typeof id === 'string'))));
        }
      }
    }
    return out;
  }
  class StatsClient extends root.MIXX.cloud.CloudClient {
    constructor(opts) { super(Object.assign({}, opts, { resource: '/rpc/merge_stats' })); this.isCurrent = opts.isCurrent; }
    _assert(uid, session) {
      super._assert(uid, session);
      // Storage events are asynchronous. Check the persisted owner as well before I/O.
      if (this.auth.storage && this.auth.key) {
        let stored;
        try { stored = JSON.parse(this.auth.storage.getItem(this.auth.key)); } catch (err) { /* Reject below. */ }
        if (!stored || !stored.user || stored.user.id !== uid) throw new root.MIXX.cloud.CloudError('account_changed');
      }
      if (this.isCurrent && !this.isCurrent(uid)) throw new root.MIXX.cloud.CloudError('account_changed');
    }
    async merge(uid, record) {
      const rows = await this._request(uid, '', 'POST', {
        p_writer: record.writer, p_millis: millis(record), p_achievements: record.achievements,
      });
      if (rows.length !== 1) throw new Error('统计数据格式无法识别');
      return validate(rows[0], uid);
    }
  }
  class StatsTracker {
    constructor(opts) {
      this.storage = opts.storage;
      this.client = opts.client;
      this.key = opts.key || 'mixxtopia.stats.v1';
      this.onChange = opts.onChange || (() => {});
      this.uid = null;
      this.epoch = 0;
      this.suspended = false;
      this.error = null;
      this.remote = empty('');
      this.task = null;
      this.record = null;
      this.dirty = false;
    }
    _prefix() { return this.key + '.journal.' + encodeURIComponent(this.uid || 'guest') + '.'; }
    _recordKey(record) { return this._prefix() + record.writer; }
    _cacheKey() { return this.key + '.cache.' + encodeURIComponent(this.uid || 'guest'); }
    connect(uid) {
      uid = uid || '';
      if (this.uid === uid) return this.task || Promise.resolve(false);
      this.flush();
      this.uid = uid;
      this.epoch++;
      this.task = null;
      this.suspended = false;
      this.error = null;
      this.remote = empty(uid);
      try { this.remote = validate(JSON.parse(this.storage.getItem(this._cacheKey())), uid); }
      catch (err) { /* No valid cache: start with zero until the first successful sync. */ }
      const bytes = new Uint8Array(16);
      if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
      else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      const writer = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      this.record = { v: 1, uid, writer, seconds: 0, achievements: [] };
      this.dirty = false;
      this.onChange();
      return this.sync();
    }
    /** Every live instance owns a separate journal: tabs never overwrite each other's time. */
    tick(dt) {
      if (!this.record || this.suspended || !Number.isFinite(dt) || dt <= 0) return;
      const before = Math.floor(this.record.seconds);
      this.record.seconds += dt;
      this.dirty = true;
      if (Math.floor(this.record.seconds) !== before) this.flush();
    }
    unlock(id) {
      if (!this.record || this.suspended || !knownAchievement(id) || this.record.achievements.includes(id)) return;
      this.record.achievements.push(id);
      this.dirty = true;
      this.flush();
    }
    /** Whole seconds are checkpointed during play; state changes/pagehide retain fractions. */
    flush() {
      if (!this.record || !this.dirty) return true;
      try {
        this.storage.setItem(this._recordKey(this.record), JSON.stringify(this.record));
        this.dirty = false;
        return true;
      } catch (err) {
        this.error = new Error('浏览器无法保存统计，请保持页面开启后重试');
        return false;
      }
    }
    _journals() {
      const records = new Map();
      try {
        for (let i = 0; i < this.storage.length; i++) {
          const k = this.storage.key(i);
          if (!k || !k.startsWith(this._prefix())) continue;
          let r;
          try { r = JSON.parse(this.storage.getItem(k)); } catch (err) { continue; }
          if (r && r.v === 1 && r.uid === this.uid && writerOK(r.writer) && k === this._recordKey(r)
            && Number.isFinite(r.seconds) && r.seconds >= 0 && millisOK(millis(r))
            && Array.isArray(r.achievements) && r.achievements.every(knownAchievement)) {
            records.set(r.writer, r);
          }
        }
      } catch (err) { /* Current journal remains usable if storage is unavailable. */ }
      if (this.record) records.set(this.record.writer, copy(this.record));
      return Array.from(records.values());
    }
    view() {
      const records = this._journals();
      const achievements = new Set(this.remote.achievements);
      let totalMs = this.remote.play_seconds * 1000 + this.remote.remainder_ms;
      for (const r of records) {
        totalMs += Math.max(0, millis(r) - (this.remote.device_millis[r.writer] || 0));
        r.achievements.forEach(id => achievements.add(id));
      }
      return { seconds: Math.floor(totalMs / 1000), achievements: Array.from(achievements), collections: copy(this.remote.collections),
        pending: records.some(r => millis(r) > (this.remote.device_millis[r.writer] || 0)
          || r.achievements.some(id => !this.remote.achievements.includes(id))) };
    }
    /** Only login, save, exit and explicit UI actions invoke sync. Failed journals stay durable. */
    sync() {
      if (this.task) {
        const uid = this.uid, epoch = this.epoch;
        return this.task.then(() => this.uid === uid && this.epoch === epoch ? this.sync() : false);
      }
      if (!this.uid || this.suspended || !this.client) return Promise.resolve(false);
      if (!this.flush()) { this.onChange(); return Promise.resolve(false); }
      const uid = this.uid, epoch = this.epoch;
      const active = () => this.uid === uid && this.epoch === epoch && !this.suspended;
      const records = this._journals();
      // Even with no pending seconds, refresh canonical collection data and remote totals once.
      const pending = records.filter(r => millis(r) > (this.remote.device_millis[r.writer] || 0)
        || r.achievements.some(id => !this.remote.achievements.includes(id)));
      if (!pending.length) pending.push({ writer: '0'.repeat(32), seconds: 0, achievements: [] });
      this.error = null;
      const task = Promise.resolve().then(async () => {
        for (const record of pending) {
          if (!active()) return false;
          const row = validate(await this.client.merge(uid, record), uid);
          if (!active()) return false;
          this.remote = row;
          this.storage.setItem(this._cacheKey(), JSON.stringify(row));
        }
        return true;
      }).catch(err => {
        if (active()) this.error = err;
        return false;
      }).finally(() => {
        if (this.task === task) this.task = null;
        if (active()) this.onChange();
      });
      this.task = task;
      this.onChange();
      return task;
    }
    suspend() {
      this.flush();
      this.suspended = true;
      this.epoch++;
      this.error = new Error('账户已在另一页面变化，请刷新后继续同步统计');
      this.onChange();
    }
    destroy() { this.flush(); this.suspended = true; this.epoch++; this.onChange = () => {}; }
  }
  root.MIXX.stats = Object.freeze({ StatsClient, StatsTracker, ACHIEVEMENTS, collectionRates, localCollections });
})(typeof window !== 'undefined' ? window : globalThis);
