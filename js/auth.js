/**
 * js/auth.js —— Supabase GoTrue 手写 fetch 封装（Issue #43，父任务 #22）
 *
 * 为什么手写而不是引 SDK：详见 docs/ACCOUNT_SYSTEM.md §6（A2 选型）。
 * 本文件只负责「账户身份」：注册 / 登录 / 登出 / refresh_token 续期 / 会话恢复。
 * 云存档（#45）、账户设置（#44）、统计（#46）都复用这里拿到的 access token。
 *
 * 关键行为：
 *   - 会话存 localStorage，默认键 `mixxtopia.account.v1`（beta/preview 由 main.js
 *     传入带通道后缀的键，避免同源测试通道覆盖正式登录态）；
 *   - 只存 access_token / refresh_token / expiresAt / user{id,email}，不复制邮箱到业务表；
 *   - access_token 过期前 60s 视为过期：restore() / ensureFresh() 自动用 refresh_token 续期；
 *   - **不抛英文错误**：GoTrue 的 error_code / msg 统一映射成中文提示（ERROR_MESSAGES），
 *     网络失败、超时、服务端 5xx 一律提示「云端暂不可用」，调用方只管展示 err.message；
 *   - 未配置 js/cloud-config.js（或显式关闭）时 available === false：不发起任何请求，
 *     游戏照常本地运行（游客态零上传）。
 *
 * 测试约定（tools/test-auth.js）：构造函数可注入 `fetch` / `storage` / `now` / `config`，
 * 所有网络请求都经过 `_request()`，塞一个 fetch 桩即可覆盖全部成功与失败分支。
 */
'use strict';

(function (root) {
  'use strict';

  /** localStorage 会话键；beta/preview 用 sessionKeyFor(channel) 派生 */
  const AUTH_KEY = 'mixxtopia.account.v1';
  const SESSION_VERSION = 1;
  /** access_token 到期前多久就提前续期，避免边界上拿刚过期的 token 发请求 */
  const EXPIRY_SKEW_MS = 60 * 1000;
  const MIN_PASSWORD = 6;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** 所有面向玩家的提示文案（中文；不把 GoTrue 英文原文直接甩给玩家） */
  const ERROR_MESSAGES = Object.freeze({
    // 客户端校验
    missing_email: '请填写邮箱',
    invalid_email: '邮箱格式不正确',
    missing_password: '请填写密码',
    short_password: '密码至少 6 位',
    // GoTrue 错误码映射
    invalid_credentials: '邮箱或密码不正确',
    user_already_exists: '该邮箱已注册，请直接登录',
    email_not_confirmed: '邮箱尚未验证，请先到邮箱完成验证',
    weak_password: '密码强度不足，至少 6 位',
    rate_limit: '操作太频繁，请稍后再试',
    signup_disabled: '注册暂未开放',
    invalid_refresh_token: '登录已过期，请重新登录',
    not_signed_in: '尚未登录',
    user_not_found: '账户不存在，请先注册',
    same_password: '新密码不能与旧密码相同',
    validation_failed: '邮箱或密码格式不正确',
    forbidden: '没有权限执行此操作',
    // 网络 / 配置 / 服务端
    unavailable: '云端暂不可用：尚未配置云端服务；仍可继续本地游玩。',
    network: '云端暂不可用，请检查网络后重试；仍可继续本地游玩。',
    timeout: '云端暂不可用（请求超时），请稍后再试；仍可继续本地游玩。',
    server: '云端暂不可用（服务器错误），请稍后再试；仍可继续本地游玩。',
    invalid_response: '云端返回了无法识别的数据，请稍后再试',
    unknown: '操作失败，请稍后再试',
  });

  /** 带中文文案与可编程错误码的异常（调用方：`catch (err) { show(err.message); }`） */
  class AuthError extends Error {
    constructor(code, status) {
      const key = code || 'unknown';
      super(ERROR_MESSAGES[key] || ERROR_MESSAGES.unknown);
      this.name = 'AuthError';
      this.code = key;
      this.status = Number(status) || 0;
    }
  }

  function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  }

  function validateEmail(email) {
    if (!email) return 'missing_email';
    return EMAIL_RE.test(email) ? '' : 'invalid_email';
  }

  function validatePassword(password) {
    if (typeof password !== 'string' || !password) return 'missing_password';
    return password.length >= MIN_PASSWORD ? '' : 'short_password';
  }

  /** 通道会话键：stable 保持历史键，beta/preview 追加 `.<channel>`（与 #17 存档键一致） */
  function sessionKeyFor(channel) {
    const name = typeof channel === 'string' ? channel.trim().replace(/[^a-z0-9-]/gi, '') : '';
    if (!name || name === 'stable') return AUTH_KEY;
    return 'mixxtopia.account.' + name + '.v1';
  }

  function resolveStorage(host) {
    try {
      const s = host && host.localStorage;
      if (s && typeof s.getItem === 'function' && typeof s.setItem === 'function') return s;
    } catch (e) { /* 隐私模式 / 被禁用：按不可用处理 */ }
    return null;
  }

  function payloadCode(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const raw = payload.error_code || payload.error || payload.code;
    return typeof raw === 'string' ? raw.toLowerCase() : '';
  }

  function payloadText(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const raw = payload.msg || payload.message || payload.error_description || payload.error || '';
    return typeof raw === 'string' ? raw.toLowerCase() : '';
  }

  function hasAny(text, needles) {
    for (let i = 0; i < needles.length; i++) {
      if (text.indexOf(needles[i]) >= 0) return true;
    }
    return false;
  }

  /**
   * 把 GoTrue / PostgREST 的错误响应映射成中文 AuthError。
   * 优先看 error_code，其次看 msg 文案；最后按 HTTP 状态兜底。
   * @param {number} status HTTP 状态码
   * @param {object|null} payload 响应 JSON
   * @returns {AuthError}
   */
  function mapError(status, payload) {
    const code = payloadCode(payload);
    const text = payloadText(payload);
    const statusCode = Number(status) || 0;

    if (code === 'user_already_exists' || code === 'email_exists' ||
        hasAny(text, ['already registered', 'already been registered', 'user already exists'])) {
      return new AuthError('user_already_exists', statusCode);
    }
    if (code === 'email_not_confirmed' || hasAny(text, ['email not confirmed'])) {
      return new AuthError('email_not_confirmed', statusCode);
    }
    if (code === 'weak_password' || hasAny(text, ['password should be at least', 'password is too short', 'weak password'])) {
      return new AuthError('weak_password', statusCode);
    }
    if (code === 'invalid_email' || (text.indexOf('email') >= 0 && text.indexOf('invalid') >= 0) ||
        hasAny(text, ['unable to validate email', 'invalid email'])) {
      return new AuthError('invalid_email', statusCode);
    }
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' ||
        hasAny(text, ['rate limit', 'too many requests'])) {
      return new AuthError('rate_limit', statusCode);
    }
    if (code === 'signup_disabled' || hasAny(text, ['signups not allowed', 'signup disabled'])) {
      return new AuthError('signup_disabled', statusCode);
    }
    if (code === 'refresh_token_not_found' || code === 'invalid_refresh_token' ||
        code === 'session_not_found' ||
        hasAny(text, ['invalid refresh token', 'refresh token not found', 'refresh token has expired', 'session from session_id claim'])) {
      return new AuthError('invalid_refresh_token', statusCode);
    }
    if (code === 'invalid_credentials' || code === 'invalid_grant' ||
        hasAny(text, ['invalid login credentials', 'invalid credentials'])) {
      return new AuthError('invalid_credentials', statusCode);
    }
    if (code === 'user_not_found' || hasAny(text, ['user not found'])) {
      return new AuthError('user_not_found', statusCode);
    }
    if (code === 'same_password' || hasAny(text, ['same password'])) {
      return new AuthError('same_password', statusCode);
    }
    if (code === 'validation_failed' || hasAny(text, ['validation failed'])) {
      return new AuthError('validation_failed', statusCode);
    }
    if (statusCode === 429) return new AuthError('rate_limit', statusCode);
    if (statusCode === 401 || statusCode === 403) {
      return new AuthError(statusCode === 403 ? 'forbidden' : 'invalid_credentials', statusCode);
    }
    if (statusCode >= 500) return new AuthError('server', statusCode);
    return new AuthError('unknown', statusCode);
  }

  /** 从 GoTrue 响应里取出用户（只保留 id / email，业务字段在 profiles 表） */
  function normalizeUser(raw) {
    if (!raw || typeof raw !== 'object') return { id: '', email: '' };
    return {
      id: typeof raw.id === 'string' ? raw.id : '',
      email: typeof raw.email === 'string' ? raw.email : '',
    };
  }

  /**
   * GoTrue 会话客户端。
   *
   * @param {object} [opts]
   *   config   默认取 root.MIXX.cloudConfig（js/cloud-config.js）
   *   storage  默认 root.localStorage；传 null 表示不可持久化（当前页面仍可登录）
   *   key      默认 `mixxtopia.account.v1`
   *   fetch    默认在每次请求时读取 root.fetch（便于测试运行中替换桩）
   *   now      默认 Date.now（测试可注入时钟验证 token 过期）
   *   root     默认全局对象
   */
  class AuthClient {
    constructor(opts) {
      opts = opts || {};
      this.root = opts.root || root;
      this.config = Object.prototype.hasOwnProperty.call(opts, 'config')
        ? opts.config
        : ((this.root.MIXX && this.root.MIXX.cloudConfig) || null);
      this.key = typeof opts.key === 'string' && opts.key ? opts.key : AUTH_KEY;
      this.storage = Object.prototype.hasOwnProperty.call(opts, 'storage')
        ? opts.storage
        : resolveStorage(this.root);
      this._fetch = typeof opts.fetch === 'function' ? opts.fetch : null;
      this._now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };

      this.session = null;
      this.lastError = null;   // 最近一次 restore 失败（网络/服务端），供标题页提示
      this._listeners = [];
      this._refreshing = null; // 并发续期去重
    }

    /** 云端配置是否可用（未配置时所有请求直接失败，不发起网络） */
    get available() {
      return !!(this.config && this.config.enabled);
    }

    getSession() { return this.session; }

    isSignedIn() { return !!this.session; }

    getUser() { return this.session ? this.session.user : null; }

    getAccessToken() { return this.session ? this.session.accessToken : ''; }

    /** PostgREST / GoTrue 请求头（apikey + 可选 Bearer），供 #45/#46 复用 */
    authHeaders() {
      if (!this.config || typeof this.config.headers !== 'function') return {};
      return this.config.headers(this.getAccessToken() || undefined);
    }

    /**
     * 订阅会话变化（登录 / 登出 / 续期 / 恢复）。
     * @param {(event: {type: string, session: object|null}) => void} fn
     * @returns {() => void} 取消订阅
     */
    onChange(fn) {
      if (typeof fn !== 'function') return function () {};
      const list = this._listeners;
      list.push(fn);
      return function () {
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      };
    }

    _emit(type) {
      const event = { type: type, session: this.session };
      for (let i = 0; i < this._listeners.length; i++) {
        try { this._listeners[i](event); } catch (e) { /* 监听器异常不影响账户流程 */ }
      }
    }

    /* ── 本地会话读写 ── */

    _storageGet() {
      if (!this.storage || typeof this.storage.getItem !== 'function') return null;
      try { return this.storage.getItem(this.key); } catch (e) { return null; }
    }

    _readSession() {
      const raw = this._storageGet();
      if (!raw) return null;
      let data = null;
      try { data = JSON.parse(raw); } catch (e) { return null; }
      if (!data || data.v !== SESSION_VERSION || typeof data.accessToken !== 'string' || !data.accessToken) {
        return null;
      }
      const user = normalizeUser(data.user);
      return {
        v: SESSION_VERSION,
        accessToken: data.accessToken,
        refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : '',
        expiresAt: Number(data.expiresAt) || 0,
        user: user,
      };
    }

    _writeSession(session) {
      if (!this.storage || typeof this.storage.setItem !== 'function') return false;
      try {
        this.storage.setItem(this.key, JSON.stringify(session));
        return true;
      } catch (e) {
        return false; // 配额/隐私模式：内存会话仍可用，只是刷新后需要重新登录
      }
    }

    _clearStoredSession() {
      if (!this.storage) return;
      try {
        if (typeof this.storage.removeItem === 'function') this.storage.removeItem(this.key);
        else this.storage.setItem(this.key, '');
      } catch (e) { /* 忽略存储异常 */ }
    }

    _applySession(session, type) {
      this.session = session;
      this.writeFailed = !this._writeSession(session);
      this._emit(type);
    }

    _expired(session) {
      if (!session || !session.expiresAt) return true;
      return session.expiresAt - EXPIRY_SKEW_MS <= this._now();
    }

    /* ── 网络请求 ── */

    _fetchImpl() {
      if (this._fetch) return this._fetch;
      const f = this.root && this.root.fetch;
      return typeof f === 'function' ? f.bind(this.root) : null;
    }

    /**
     * 统一请求：超时、JSON、错误映射都收在这里。
     * @param {string} path    GoTrue 路径（由 cloudConfig.authUrl 拼项目地址）
     * @param {object} [opts]  { method, body, token }
     * @returns {Promise<object|null>} 解析后的 JSON（204 时为 null）
     */
    async _request(path, opts) {
      opts = opts || {};
      const config = this.config;
      if (!config || !config.enabled) throw new AuthError('unavailable');
      const fetchFn = this._fetchImpl();
      if (!fetchFn) throw new AuthError('network');
      const url = typeof config.authUrl === 'function' ? config.authUrl(path) : '';
      if (!url) throw new AuthError('unavailable');

      const headers = config.headers(opts.token);
      headers['Content-Type'] = 'application/json';
      const init = { method: opts.method || 'POST', headers: headers };
      if (opts.body) init.body = JSON.stringify(opts.body);

      // 超时：浏览器有 AbortController；Node 测试桩不注入时退化为「不主动超时」
      const Abort = this.root && this.root.AbortController;
      const timeout = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 0;
      let controller = null;
      let timer = null;
      let timedOut = false;
      if (typeof Abort === 'function' && timeout > 0) {
        controller = new Abort();
        init.signal = controller.signal;
        if (typeof setTimeout === 'function') {
          timer = setTimeout(function () {
            timedOut = true;
            try { controller.abort(); } catch (e) { /* 已结束 */ }
          }, timeout);
        }
      }

      let res;
      try {
        res = await fetchFn(url, init);
      } catch (err) {
        if (timedOut) throw new AuthError('timeout');
        if (err instanceof AuthError) throw err;
        throw new AuthError('network');
      } finally {
        if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
      }

      let data = null;
      if (res && typeof res.json === 'function') {
        try { data = await res.json(); } catch (e) { data = null; }
      }
      const ok = res && typeof res.ok === 'boolean'
        ? res.ok
        : !!res && Number(res.status) >= 200 && Number(res.status) < 300;
      if (!ok) throw mapError(res && res.status, data);
      return data;
    }

    /** GoTrue 会话响应 → 本地会话对象 */
    _sessionFromResponse(data, previousUser) {
      if (!data || typeof data.access_token !== 'string' || !data.access_token) return null;
      const now = this._now();
      let expiresAt = Number(data.expires_at) * 1000;
      if (!isFinite(expiresAt) || expiresAt <= 0) {
        const expiresIn = Number(data.expires_in);
        expiresAt = now + (isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000;
      }
      let user = normalizeUser(data.user);
      if (!user.email && previousUser) user = previousUser;
      return {
        v: SESSION_VERSION,
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : '',
        expiresAt: expiresAt,
        user: user,
      };
    }

    /* ── 公开流程 ── */

    /**
     * 会话恢复：读取本地会话；token 未过期直接返回，已过期则自动 refresh。
     * 失败不抛错（返回 null），把原因记在 lastError，调用方照常进游客态。
     * @returns {Promise<object|null>}
     */
    async restore() {
      this.lastError = null;
      const stored = this._readSession();
      if (!stored) {
        this.session = null;
        this._emit('restore');
        return null;
      }
      if (!this._expired(stored)) {
        this.session = stored;
        this._emit('restore');
        return stored;
      }
      if (!stored.refreshToken) {
        this.session = null;
        this._clearStoredSession();
        this._emit('restore');
        return null;
      }
      this.session = stored;
      try {
        const fresh = await this.refresh();
        this._emit('restore');
        return fresh;
      } catch (err) {
        this.lastError = err;
        this.session = null;
        if (err && err.code === 'invalid_refresh_token') this._clearStoredSession();
        this._emit('restore');
        return null;
      }
    }

    /**
     * 注册（邮箱 + 密码）。GoTrue 关闭邮箱验证时会直接带回会话，等价于自动登录；
     * 若开启了邮箱验证，返回 { needsConfirmation: true }，由界面提示查收邮件。
     * @returns {Promise<{session: object|null, user: object, needsConfirmation: boolean}>}
     */
    async signUp(email, password) {
      const cleanEmail = normalizeEmail(email);
      const problem = validateEmail(cleanEmail) || validatePassword(password);
      if (problem) throw new AuthError(problem);

      const data = await this._request('/signup', {
        body: { email: cleanEmail, password: String(password) },
      });
      const session = this._sessionFromResponse(data, null);
      if (session) {
        this._applySession(session, 'signin');
        return { session: session, user: session.user, needsConfirmation: false };
      }
      // 需要邮箱验证：GoTrue 返回用户对象而非会话
      const rawUser = data && data.user && typeof data.user === 'object' ? data.user : data;
      const user = normalizeUser(rawUser);
      if (!user.email) throw new AuthError('invalid_response');
      return { session: null, user: user, needsConfirmation: true };
    }

    /**
     * 登录（邮箱 + 密码）。
     * @returns {Promise<object>} 本地会话对象（同时写入 localStorage）
     */
    async signIn(email, password) {
      const cleanEmail = normalizeEmail(email);
      const problem = validateEmail(cleanEmail) || validatePassword(password);
      if (problem) throw new AuthError(problem);

      const data = await this._request('/token?grant_type=password', {
        body: { email: cleanEmail, password: String(password) },
      });
      const session = this._sessionFromResponse(data, null);
      if (!session) throw new AuthError('invalid_response');
      this._applySession(session, 'signin');
      return session;
    }

    /**
     * 用 refresh_token 续期。并发调用共享同一请求；refresh token 失效时清空本地会话。
     * @returns {Promise<object>}
     */
    refresh() {
      if (this._refreshing) return this._refreshing;
      const stored = this.session || this._readSession();
      if (!stored || !stored.refreshToken) return Promise.reject(new AuthError('not_signed_in'));

      const self = this;
      this._refreshing = (async function () {
        const data = await self._request('/token?grant_type=refresh_token', {
          body: { refresh_token: stored.refreshToken },
        });
        const next = self._sessionFromResponse(data, stored.user);
        if (!next) throw new AuthError('invalid_response');
        self._applySession(next, 'refresh');
        return next;
      })();

      return this._refreshing.then(
        function (session) {
          self._refreshing = null;
          return session;
        },
        function (err) {
          self._refreshing = null;
          if (err && (err.code === 'invalid_refresh_token' || err.code === 'not_signed_in')) {
            self.session = null;
            self._clearStoredSession();
            self._emit('signout');
          }
          throw err;
        }
      );
    }

    /**
     * 取一个可用的 access token：未过期直接返回；快过期/已过期自动续期。
     * 云存档、统计在发请求前调用。
     * @returns {Promise<object>} 会话
     */
    async ensureFresh() {
      const stored = this.session || this._readSession();
      if (!stored) throw new AuthError('not_signed_in');
      this.session = stored;
      if (!this._expired(stored)) return stored;
      if (!stored.refreshToken) {
        this.session = null;
        this._clearStoredSession();
        this._emit('signout');
        throw new AuthError('invalid_refresh_token');
      }
      return this.refresh();
    }

    /**
     * 登出：先清本地会话、立刻回到游客态，再尽力通知服务端（离线也能登出）。
     * 只动 `mixxtopia.account.v1`，不碰 `mixxtopia.save.v1` / 设置。
     * @returns {Promise<boolean>}
     */
    async signOut() {
      const stored = this.session || this._readSession();
      this.session = null;
      this._clearStoredSession();
      this._emit('signout');
      if (!stored || !stored.accessToken) return true;
      try {
        await this._request('/logout', { method: 'POST', token: stored.accessToken });
      } catch (e) { /* 服务端失败不影响本地登出 */ }
      return true;
    }
  }

  function createClient(opts) {
    return new AuthClient(opts);
  }

  root.MIXX = root.MIXX || {};
  root.MIXX.auth = Object.freeze({
    AUTH_KEY: AUTH_KEY,
    SESSION_VERSION: SESSION_VERSION,
    EXPIRY_SKEW_MS: EXPIRY_SKEW_MS,
    MIN_PASSWORD: MIN_PASSWORD,
    ERROR_MESSAGES: ERROR_MESSAGES,
    AuthError: AuthError,
    AuthClient: AuthClient,
    createClient: createClient,
    mapError: mapError,
    normalizeEmail: normalizeEmail,
    validateEmail: validateEmail,
    validatePassword: validatePassword,
    sessionKeyFor: sessionKeyFor,
  });
})(typeof window !== 'undefined' ? window : globalThis);
