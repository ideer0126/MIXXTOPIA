/**
 * Cloud saves (#45): PostgREST CAS writes + durable, account-bound sync baselines.
 * No SDK, polling or automatic conflict resolution. Local saves remain authoritative
 * until the player explicitly chooses a cloud download. All dependencies injectable.
 */
'use strict';
(function (root) {
  'use strict';
  const MESSAGES = {
    unavailable: '云端暂不可用，本机存档不受影响',
    unauthorized: '登录已过期或账号已切换，请重新登录',
    network: '未同步：网络不可用，本机存档已保留',
    timeout: '未同步：请求超时，本机存档已保留',
    conflict: '云端进度已变化，请重新逐档选择',
    invalid_response: '云端存档格式无法识别，未覆盖本机进度',
    local_changed: '本机进度已变化，请重新选择',
    storage: '浏览器存储不可用，未同步；本机进度已保留',
    busy: '该存档正在同步，请稍后再试',
  };
  class CloudError extends Error {
    constructor(code) {
      super(MESSAGES[code] || MESSAGES.unavailable);
      this.name = 'CloudError';
      this.code = code;
    }
  }
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const validSlot = (n) => Number.isInteger(n) && n >= 1 && n <= 3;
  function metadata(row) {
    if (!row || !validSlot(row.slot) || !Number.isInteger(row.version) || row.version < 1
      || !Number.isFinite(Date.parse(row.updated_at))) throw new CloudError('invalid_response');
    return { slot: row.slot, version: row.version, updatedAt: Date.parse(row.updated_at) };
  }

  class CloudClient {
    constructor(opts) {
      opts = opts || {};
      this.root = opts.root || root;
      this.config = opts.config || (this.root.MIXX && this.root.MIXX.cloudConfig);
      this.auth = opts.auth;
      this.fetch = opts.fetch || null;
    }
    get available() { return !!(this.config && this.config.enabled && this.auth); }
    _assert(uid, session) {
      const current = this.auth && this.auth.session;
      if (!uid || !session || !session.user || session.user.id !== uid
        || !current || !current.user || current.user.id !== uid) throw new CloudError('unauthorized');
    }
    async _request(uid, path, method, body) {
      if (!this.available) throw new CloudError('unavailable');
      let session;
      try { session = await this.auth.ensureFresh(); }
      catch (err) { throw new CloudError(err && ['network', 'timeout', 'server'].includes(err.code) ? err.code : 'unauthorized'); }
      this._assert(uid, session);
      for (let attempt = 0; attempt < 2; attempt++) {
        this._assert(uid, session);
        const fetchFn = this.fetch || (this.root.fetch && this.root.fetch.bind(this.root));
        if (!fetchFn) throw new CloudError('network');
        const headers = Object.assign({}, this.config.headers(session.accessToken), {
          'Content-Type': 'application/json', Prefer: 'return=representation',
        });
        const init = { method, headers };
        if (body !== undefined) init.body = JSON.stringify(body);
        const Abort = this.root.AbortController;
        const controller = typeof Abort === 'function' ? new Abort() : null;
        let timer = null;
        let timedOut = false;
        if (controller) {
          init.signal = controller.signal;
          timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.timeoutMs || 8000);
        }
        let response, data;
        try {
          response = await fetchFn(this.config.restUrl('/saves') + path, init);
          data = await response.json(); // Keep timeout active through body consumption.
        } catch (err) {
          if (timedOut) throw new CloudError('timeout');
          throw new CloudError(response ? 'invalid_response' : 'network');
        } finally {
          if (timer !== null) clearTimeout(timer);
        }
        this._assert(uid, session);
        if (response.status === 401 && attempt === 0 && typeof this.auth.refresh === 'function') {
          try { session = await this.auth.refresh(); }
          catch (err) { throw new CloudError(err && ['network', 'timeout'].includes(err.code) ? err.code : 'unauthorized'); }
          continue;
        }
        if (response.status === 409) throw new CloudError('conflict');
        if (response.status === 401 || response.status === 403) throw new CloudError('unauthorized');
        if (!response.ok) throw new CloudError('unavailable');
        if (!Array.isArray(data)) throw new CloudError('invalid_response');
        return data;
      }
      throw new CloudError('unauthorized');
    }
    _filter(uid, slot) {
      return '?user_id=eq.' + encodeURIComponent(uid) + (slot ? '&slot=eq.' + slot : '');
    }
    async list(uid) {
      const rows = await this._request(uid, this._filter(uid) + '&select=slot,version,updated_at', 'GET');
      const result = [null, null, null];
      for (const row of rows) {
        const meta = metadata(row);
        if (result[meta.slot - 1]) throw new CloudError('invalid_response');
        result[meta.slot - 1] = meta;
      }
      return result;
    }
    async download(uid, slot) {
      if (!validSlot(slot)) throw new CloudError('invalid_response');
      const rows = await this._request(uid, this._filter(uid, slot) + '&select=slot,version,updated_at,data', 'GET');
      if (rows.length !== 1) throw new CloudError('conflict');
      const meta = metadata(rows[0]);
      if (meta.slot !== slot) throw new CloudError('invalid_response');
      const raw = rows[0].data;
      if (!raw || raw.v !== 1 || !Number.isInteger(raw.current) || raw.current < 1
        || !Number.isInteger(raw.unlocked) || raw.unlocked < raw.current
        || !Array.isArray(raw.cleared) || !raw.cleared.every(n => Number.isInteger(n) && n > 0)
        || !raw.stars || typeof raw.stars !== 'object' || Array.isArray(raw.stars)
        || !Object.keys(raw.stars).every(k => Array.isArray(raw.stars[k]) && raw.stars[k].every(id => typeof id === 'string'))
        || !Number.isInteger(raw.sheep) || raw.sheep < 0
        || !Array.isArray(raw.played) || !raw.played.every(id => typeof id === 'string')) {
        throw new CloudError('invalid_response');
      }
      return { meta, data: Object.assign(copy(raw), { slot, updatedAt: meta.updatedAt }) };
    }
    async upload(uid, slot, data, expectedVersion) {
      if (!validSlot(slot) || (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1))) {
        throw new CloudError('invalid_response');
      }
      const payload = copy(data);
      delete payload.slot;
      delete payload.updatedAt;
      delete payload.version;
      const insert = expectedVersion === null;
      const body = { version: insert ? 1 : expectedVersion + 1, data: payload };
      if (insert) Object.assign(body, { user_id: uid, slot });
      const path = insert ? '' : this._filter(uid, slot) + '&version=eq.' + expectedVersion;
      const rows = await this._request(uid, path, insert ? 'POST' : 'PATCH', body);
      if (!rows.length) throw new CloudError('conflict'); // CAS miss is often HTTP 200 [].
      if (rows.length !== 1) throw new CloudError('invalid_response');
      const meta = metadata(rows[0]);
      if (meta.slot !== slot || meta.version !== body.version) throw new CloudError('invalid_response');
      return meta;
    }
  }

  /** Sync records carry their owner; unknown/old records never authorize uploads.
   * Pending entries persist only after consent (or a previous successful sync).
   * Epoch and per-slot revision guards discard replies after logout, delete or edits.
   */
  class SaveSync {
    constructor(opts) {
      this.client = opts.client;
      this.store = opts.store;
      this.storage = opts.storage;
      this.key = opts.key || 'mixxtopia.cloud.v1';
      this.onChange = opts.onChange || (() => {});
      this.uid = '';
      this.epoch = 0;
      this.remote = [null, null, null];
      this.loaded = false;
      this.loading = false;
      this.error = null;
      this.busy = [false, false, false];
      this.revisions = [0, 0, 0];
      this.record = this._blank('');
    }
    _blank(uid) { return { v: 1, userId: uid, decision: '', slots: [null, null, null], pending: [false, false, false] }; }
    _read(uid) {
      try {
        const r = JSON.parse(this.storage.getItem(this.key));
        if (!r || r.v !== 1 || r.userId !== uid || !Array.isArray(r.slots) || r.slots.length !== 3) return this._blank(uid);
        const result = this._blank(uid);
        result.decision = ['merge', 'cloud'].includes(r.decision) ? r.decision : '';
        result.slots = r.slots.map(b => b && Number.isInteger(b.version) && b.version > 0
          && Number.isFinite(b.localUpdatedAt) && Number.isFinite(b.cloudUpdatedAt) ? b : null);
        result.pending = result.pending.map((_, i) => !!(r.pending && r.pending[i] === true));
        return result;
      } catch (err) { return this._blank(uid); }
    }
    _persist() {
      try {
        if (!this.storage) throw new Error();
        this.storage.setItem(this.key, JSON.stringify(this.record));
        return true;
      } catch (err) { this.error = new CloudError('storage'); return false; }
    }
    _active(uid, epoch) { return !!uid && this.uid === uid && this.epoch === epoch; }
    notify() { this.onChange(); }
    get needsMerge() { return !!this.uid && !this.record.decision && this.store.readAll().some((slot, i) => slot && !this.record.slots[i]); }
    state(i) {
      const local = this.store.readSlot(i), remote = this.remote[i], base = this.record.slots[i];
      if (!this.uid || !this.loaded || this.error) return 'unsynced';
      if (!local && !remote) return 'empty';
      if (!local) return 'download';
      if (!remote) return 'upload';
      if (!base) return 'conflict';
      const localChanged = local.updatedAt !== base.localUpdatedAt;
      const remoteChanged = remote.version !== base.version || remote.updatedAt !== base.cloudUpdatedAt;
      return remoteChanged ? (localChanged ? 'conflict' : 'newer') : (localChanged ? 'upload' : 'synced');
    }
    async connect(uid) {
      if (this.uid === uid) return;
      this.uid = uid || '';
      this.epoch++;
      this.record = this._read(this.uid);
      // Persist ownership immediately, even when the player declines merging.
      // Switching A → B → A must not reuse A's consent for B's local progress.
      if (this.uid) this._persist();
      this.remote = [null, null, null];
      this.loaded = false;
      this.loading = false;
      this.error = null;
      this.busy = [false, false, false];
      this.notify();
      if (this.uid) await this.refresh(true);
    }
    async refresh(retryPending) {
      const uid = this.uid, epoch = this.epoch;
      if (!uid || this.loading) return;
      this.loading = true;
      this.error = null;
      this.notify();
      try {
        const rows = await this.client.list(uid);
        if (!this._active(uid, epoch)) return;
        this.remote = rows;
        this.loaded = true;
      } catch (err) {
        if (this._active(uid, epoch)) { this.error = err; this.loaded = false; }
      } finally {
        if (this._active(uid, epoch)) { this.loading = false; this.notify(); }
      }
      if (this._active(uid, epoch) && this.loaded && retryPending) {
        for (let i = 0; i < 3; i++) {
          if (!this._active(uid, epoch)) break;
          if (this.record.pending[i]) await this.save(i);
        }
      }
    }
    async decide(mode) {
      if (this.loading || this.busy.some(Boolean)) return;
      if (!this.uid || !['merge', 'cloud'].includes(mode)) return;
      this.record.decision = mode;
      if (!this._persist()) { this.record.decision = ''; this.notify(); return; }
      this.notify();
      if (!this.loaded || mode !== 'merge') return;
      const uid = this.uid, epoch = this.epoch;
      for (let i = 0; i < 3; i++) {
        if (!this._active(uid, epoch)) break;
        const local = this.store.readSlot(i), remote = this.remote[i];
        // Both sides occupied always require a per-slot decision.
        if (local && !remote) await this.transfer(i, 'upload');
        else if (!local && remote) await this.transfer(i, 'download');
      }
    }
    forget(i) {
      this.revisions[i]++;
      this.record.slots[i] = null;
      this.record.pending[i] = false;
      if (this.uid) this._persist();
      else {
        // Logout keeps the previous account's record for offline retry. A guest
        // deleting that local slot must invalidate the stored baseline as well.
        try {
          const previous = JSON.parse(this.storage.getItem(this.key));
          if (previous && previous.v === 1 && Array.isArray(previous.slots)) {
            previous.slots[i] = null;
            if (Array.isArray(previous.pending)) previous.pending[i] = false;
            this.storage.setItem(this.key, JSON.stringify(previous));
          }
        } catch (err) { /* Local deletion already succeeded; no cloud write. */ }
      }
      this.notify(); // Local delete does not delete a cloud backup.
    }
    async save(i) {
      if (!this.uid || !this.store.readSlot(i)) { this.notify(); return; }
      const base = this.record.slots[i];
      // Never bind a guest/other account's save implicitly.
      if (!base && !this.record.pending[i] && this.record.decision !== 'merge') { this.notify(); return; }
      this.record.pending[i] = true;
      if (!this._persist()) { this.notify(); return; }
      if (!this.loaded || this.busy[i]) { this.notify(); return; }
      const remote = this.remote[i];
      if ((base && (!remote || base.version !== remote.version || base.cloudUpdatedAt !== remote.updatedAt))
        || (!base && remote)) { this.notify(); return; }
      await this.transfer(i, 'upload');
    }
    async transfer(i, direction) {
      const uid = this.uid, epoch = this.epoch, revision = this.revisions[i];
      if (!uid || !this.loaded || this.busy[i] || !['upload', 'download'].includes(direction)) return false;
      const local = this.store.readSlot(i), remote = this.remote[i];
      if (direction === 'upload' ? !local : !remote) return false;
      const active = () => this._active(uid, epoch) && this.revisions[i] === revision;
      this.busy[i] = true;
      this.error = null;
      if (direction === 'upload') {
        this.record.pending[i] = true;
        if (!this._persist()) { this.busy[i] = false; this.notify(); return false; }
      }
      this.notify();
      try {
        let meta;
        let saved = local;
        if (direction === 'upload') {
          meta = await this.client.upload(uid, i + 1, local, remote ? remote.version : null);
        } else {
          const result = await this.client.download(uid, i + 1);
          if (!active()) return false;
          if (result.meta.version !== remote.version || result.meta.updatedAt !== remote.updatedAt) throw new CloudError('conflict');
          if (!same(local, this.store.readSlot(i))) throw new CloudError('local_changed');
          saved = result.data;
          if (!this.store.writeSlot(i, saved)) throw new CloudError('storage');
          saved = this.store.readSlot(i);
        }
        if (!active()) return false;
        if (direction === 'download') meta = { slot: i + 1, version: remote.version, updatedAt: remote.updatedAt };
        this.remote[i] = meta;
        this.record.slots[i] = { version: meta.version, localUpdatedAt: saved.updatedAt, cloudUpdatedAt: meta.updatedAt };
        this.record.pending[i] = !same(saved, this.store.readSlot(i));
        this._persist();
        return true;
      } catch (err) {
        if (active()) {
          if (err.code === 'conflict') await this.refresh(false);
          if (active()) this.error = err;
        }
        return false;
      } finally {
        if (this._active(uid, epoch)) { this.busy[i] = false; this.notify(); }
      }
    }
    destroy() { this.uid = ''; this.epoch++; this.onChange = () => {}; }
  }
  root.MIXX = root.MIXX || {};
  root.MIXX.cloud = Object.freeze({ CloudError, CloudClient, SaveSync, createClient: opts => new CloudClient(opts) });
})(typeof window !== 'undefined' ? window : globalThis);
