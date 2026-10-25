/**
 * js/account.js —— 账户资料（profiles 表）读写与校验（Issue #44，父任务 #22）
 *
 * 职责（与 js/auth.js 分工）：
 *   - auth.js 只负责「身份」：注册 / 登录 / 登出 / refresh_token 续期 / 会话恢复；
 *     本文件负责「资料」：昵称（1–16 字）、固定头像集、音效/操作偏好，读写 Supabase
 *     PostgREST 的 `profiles` 表。
 *   - 头像白名单是前端数据 `js/data.js` 的 `GAME.avatarPresets`；数据库只校验 id 格式
 *     `^[a-z0-9][a-z0-9-]{0,31}$`（见 supabase/migrations/0001_init.sql），
 *     因此后续新增头像只需改 data.js，无需数据库迁移；未知 id 在渲染时回退默认头像。
 *   - 偏好只保存 `sound`（boolean）与 `touch`（'auto' | 'on' | 'off'）；未知字段一律丢弃
 *     （最小化收集，见 docs/PRIVACY.md）。
 *   - **校验先于请求**：昵称超长/为空、头像不在白名单时直接抛中文 AccountError，
 *     不发起网络请求。
 *   - 错误统一映射中文：网络/超时/5xx →「云端暂不可用」；401/403 →「登录已过期 /
 *     没有权限」；400（数据库 CHECK 拒绝）→ 对应字段的中文提示。
 *
 * 约定（docs/ACCOUNT_SYSTEM.md §8/#44）：
 *   - `profiles.nickname` 允许 NULL（注册触发器默认 'NSWER'）；读取时空值回退默认昵称。
 *   - `profiles.avatar` 只校验格式；前端白名单外的值视为默认头像。
 *   - `profiles.prefs` 是 jsonb；本文件只读写已知字段，不透传未知键。
 *   - `profile.avatarRaw` 保留云端原始 id；未知/未来版本头像渲染回退默认，但保存时
 *     可由调用方省略 avatar 字段（PATCH 是部分更新），避免把云端原值覆盖成默认。
 *   - 写资料用 `PATCH /rest/v1/profiles?id=eq.<uid>` + `Prefer: return=representation`，
 *     返回数组长度 1 才认为成功；0 行视为资料行缺失/无权限。
 *
 * 测试约定（tools/test-account.js）：config / auth / fetch 均可注入，全部走 fetch 桩；
 * 不连真实后端。auth 只要求实现 `ensureFresh()` → Promise<session{user{id},accessToken}>，
 * 以及可选的 `refresh()`（401 后重试一次）。
 */
'use strict';

(function (root) {
  'use strict';

  /** 默认头像 id：与数据库 `profiles.avatar` 的 default 保持一致 */
  const DEFAULT_AVATAR = 'muse-1';
  /** 数据库注册触发器写入的默认昵称（读取到 NULL 时回退到它） */
  const DEFAULT_NICKNAME = 'NSWER';
  const NICKNAME_MIN = 1;
  const NICKNAME_MAX = 16;
  /** 操作偏好：触屏虚拟按键显示模式（auto = 跟随设备检测） */
  const TOUCH_VALUES = Object.freeze(['auto', 'on', 'off']);
  const DEFAULT_PREFS = Object.freeze({ sound: true, touch: 'auto' });
  /** 与 supabase/migrations/0001_init.sql 的 profiles_avatar_check 一致 */
  const AVATAR_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
  /** 昵称中的换行/控制字符：数据库 char_length 不拦，但会破坏 UI 与后续同步 */
  const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

  /** 所有面向玩家的提示文案（中文；不把 PostgREST 英文原文直接甩给玩家） */
  const ERROR_MESSAGES = Object.freeze({
    // 客户端校验
    empty_nickname: '昵称不能为空',
    long_nickname: '昵称最多 16 字',
    bad_nickname_chars: '昵称不能包含换行或控制字符',
    bad_avatar: '头像不在可选列表中，请重新选择',
    // 服务端字段校验（400）
    nickname_invalid: '昵称格式不符合要求（1–16 字）',
    avatar_invalid: '头像不合法，服务端已拒绝',
    prefs_invalid: '偏好字段不合法，服务端已拒绝',
    bad_request: '提交的资料格式不正确，请检查后重试',
    // 身份
    not_signed_in: '尚未登录，请先登录再修改账户设置',
    unauthorized: '登录已过期，请重新登录',
    forbidden: '没有权限执行此操作',
    // 云端
    profile_missing: '账户资料尚未就绪，请重新登录后再试',
    conflict: '账户资料更新失败，请刷新后重试',
    rate_limit: '操作太频繁，请稍后再试',
    unavailable: '云端暂不可用：尚未配置云端服务；仍可继续本地游玩。',
    network: '云端暂不可用，请检查网络后重试；本机设置不受影响。',
    timeout: '云端暂不可用（请求超时），请稍后再试；本机设置不受影响。',
    server: '云端暂不可用（服务器错误），请稍后再试；本机设置不受影响。',
    invalid_response: '云端返回了无法识别的数据，请稍后再试',
    unknown: '操作失败，请稍后再试',
  });

  /** 带中文文案与可编程错误码的异常（调用方：`catch (err) { show(err.message); }`） */
  class AccountError extends Error {
    constructor(code, status) {
      const key = code || 'unknown';
      super(ERROR_MESSAGES[key] || ERROR_MESSAGES.unknown);
      this.name = 'AccountError';
      this.code = key;
      this.status = Number(status) || 0;
    }
  }

  /** 检查自有属性，避免把原型字段当作显式配置。 */
  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  /** 按 Unicode 码点计字（与 Postgres char_length 一致；emoji 算 1 字，避免 JS UTF-16 双计） */
  function charLength(value) {
    const text = typeof value === 'string' ? value : '';
    let n = 0;
    for (const ch of text) n += 1; // eslint-disable-line no-unused-vars
    return n;
  }

  /**
   * 校验并规范化昵称（trim 后 1–16 字，不含控制字符）。
   * @param {*} raw
   * @returns {{ok: true, value: string} | {ok: false, code: string, message: string}}
   */
  function normalizeNickname(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return { ok: false, code: 'empty_nickname', message: ERROR_MESSAGES.empty_nickname };
    if (CONTROL_CHARS_RE.test(value)) {
      return { ok: false, code: 'bad_nickname_chars', message: ERROR_MESSAGES.bad_nickname_chars };
    }
    const length = charLength(value);
    if (length < NICKNAME_MIN) return { ok: false, code: 'empty_nickname', message: ERROR_MESSAGES.empty_nickname };
    if (length > NICKNAME_MAX) {
      return {
        ok: false,
        code: 'long_nickname',
        message: '昵称最多 16 字（当前 ' + length + ' 字）',
      };
    }
    return { ok: true, value };
  }

  /**
   * 头像白名单（唯一事实源：`GAME.avatarPresets`，见 js/data.js）。
   * data.js 未加载/结构异常时只保留默认头像，避免把非法 id 写进云端。
   * @param {object} [host] 全局对象（测试可注入）
   * @returns {{id: string, name: string, color: string}[]}
   */
  function avatarPresets(host) {
    const h = host || root;
    const list = h && h.GAME && Array.isArray(h.GAME.avatarPresets) ? h.GAME.avatarPresets : null;
    const out = [];
    const seen = {};
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (!item || typeof item !== 'object') continue;
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        if (!AVATAR_ID_RE.test(id) || seen[id]) continue;
        seen[id] = true;
        out.push({
          id,
          name: typeof item.name === 'string' && item.name ? item.name : id,
          color: typeof item.color === 'string' && item.color ? item.color : '#FFC857',
        });
      }
    }
    // 默认头像必须始终在集合里：数据库 default 与历史资料都可能是 muse-1。
    if (!seen[DEFAULT_AVATAR]) {
      out.unshift({ id: DEFAULT_AVATAR, name: 'Lily', color: '#7FB8E6' });
    }
    return out;
  }

  /** 默认头像 id（总在 avatarPresets 中） */
  function defaultAvatar() {
    return DEFAULT_AVATAR;
  }

  /** 头像 id 是否在固定集合中（服务端仍会用 CHECK 兜底格式） */
  function isAvatarAllowed(id, host) {
    const list = avatarPresets(host);
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return true;
    }
    return false;
  }

  /** 查找头像条目；未知 id 返回 null */
  function presetFor(id, host) {
    const list = avatarPresets(host);
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /** 归一化头像：非法/未知 id 一律回退默认头像（渲染用，不用于写盘） */
  function normalizeAvatar(raw, host) {
    return isAvatarAllowed(raw, host) ? raw : DEFAULT_AVATAR;
  }

  /**
   * 归一化偏好：只保留已知字段并补默认值；未知键丢弃（最小化云端数据）。
   * @param {*} raw
   * @returns {{sound: boolean, touch: string}}
   */
  function normalizePrefs(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      sound: src.sound !== false,
      touch: TOUCH_VALUES.indexOf(src.touch) >= 0 ? src.touch : 'auto',
    };
  }

  function isPrefsEqual(a, b) {
    const x = normalizePrefs(a);
    const y = normalizePrefs(b);
    return x.sound === y.sound && x.touch === y.touch;
  }

  /**
   * 服务端 profiles 行 → 前端资料对象（容错：NULL/非法值回退默认）。
   * `avatarRaw` 保留云端原始 id：若它不在当前前端白名单（未知 / 未来版本头像），
   * UI 展示回退默认头像，但保存时不得把原始值覆盖成默认（见 main.js 保存逻辑）。
   * @param {object} row
   * @param {object} [host]
   * @returns {{nickname: string, avatar: string, avatarRaw: string, prefs: {sound: boolean, touch: string}}}
   */
  function normalizeProfileRow(row, host) {
    const src = row && typeof row === 'object' ? row : {};
    let nickname = typeof src.nickname === 'string' ? src.nickname.trim() : '';
    if (nickname && (charLength(nickname) > NICKNAME_MAX || CONTROL_CHARS_RE.test(nickname))) {
      nickname = '';
    }
    const rawAvatar = typeof src.avatar === 'string' && AVATAR_ID_RE.test(src.avatar)
      ? src.avatar
      : '';
    return {
      nickname: nickname || DEFAULT_NICKNAME,
      avatar: normalizeAvatar(rawAvatar, host),
      avatarRaw: rawAvatar,
      prefs: normalizePrefs(src.prefs),
    };
  }

  /**
   * 校验待保存资料；不合法直接抛 AccountError（调用方无需再判空）。
   * avatar 可省略（undefined）：PATCH 只更新昵称/偏好，保留云端已有头像——
   * 用于「云端头像不在当前版本白名单」时避免把未来/未知 id 覆盖成默认值。
   * @param {object} input { nickname, avatar?, prefs }
   * @param {object} [host]
   * @returns {{nickname: string, avatar: string|undefined, prefs: {sound: boolean, touch: string}}}
   */
  function validateProfileInput(input, host) {
    const src = input && typeof input === 'object' ? input : {};
    const nick = normalizeNickname(src.nickname);
    if (!nick.ok) throw new AccountError(nick.code);
    if (src.avatar !== undefined && !isAvatarAllowed(src.avatar, host)) {
      throw new AccountError('bad_avatar');
    }
    return {
      nickname: nick.value,
      avatar: src.avatar,
      prefs: normalizePrefs(src.prefs),
    };
  }

  /** PostgREST 错误响应 → 中文 AccountError（400 按字段名给更具体的提示） */
  function mapRestError(status, payload) {
    const statusCode = Number(status) || 0;
    const parts = [];
    if (payload && typeof payload === 'object') {
      for (const key of ['message', 'details', 'hint', 'code']) {
        if (typeof payload[key] === 'string') parts.push(payload[key].toLowerCase());
      }
    }
    const text = parts.join(' ');

    if (statusCode === 400) {
      if (text.indexOf('nickname') >= 0) return new AccountError('nickname_invalid', 400);
      if (text.indexOf('avatar') >= 0) return new AccountError('avatar_invalid', 400);
      if (text.indexOf('prefs') >= 0) return new AccountError('prefs_invalid', 400);
      return new AccountError('bad_request', 400);
    }
    if (statusCode === 401) return new AccountError('unauthorized', 401);
    if (statusCode === 403) return new AccountError('forbidden', 403);
    if (statusCode === 404) return new AccountError('profile_missing', 404);
    if (statusCode === 409) return new AccountError('conflict', 409);
    if (statusCode === 429) return new AccountError('rate_limit', 429);
    if (statusCode >= 500) return new AccountError('server', statusCode);
    return new AccountError('unknown', statusCode);
  }

  /** js/auth.js 的 AuthError → AccountError（码相同，文案由本文件统一） */
  function mapAuthError(err) {
    if (err instanceof AccountError) return err;
    const code = err && err.code;
    if (code === 'not_signed_in') return new AccountError('not_signed_in');
    if (code === 'invalid_refresh_token') return new AccountError('unauthorized');
    const known = ['network', 'timeout', 'server', 'unavailable', 'invalid_response'];
    if (known.indexOf(code) >= 0) return new AccountError(code);
    return new AccountError('unknown', err && err.status);
  }

  /**
   * profiles 客户端（PostgREST，手写 fetch，不引 SDK）。
   *
   * @param {object} [opts]
   *   config  默认 root.MIXX.cloudConfig（js/cloud-config.js）
   *   auth    必填：js/auth.js 的 AuthClient（提供 ensureFresh / refresh）
   *   fetch   默认在请求时读取 root.fetch（便于测试替换桩）
   *   root    默认全局对象
   */
  class ProfileClient {
    /** 注入配置和认证客户端；未提供 fetch 时在请求时从 root 读取。 */
    constructor(opts) {
      opts = opts || {};
      this.root = opts.root || root;
      this.config = hasOwn(opts, 'config')
        ? opts.config
        : ((this.root.MIXX && this.root.MIXX.cloudConfig) || null);
      this.auth = hasOwn(opts, 'auth') ? opts.auth : null;
      this._fetch = typeof opts.fetch === 'function' ? opts.fetch : null;
    }

    /** 云端配置与登录客户端是否就绪（未配置时所有请求直接失败，不发起网络） */
    get available() {
      return !!(this.config && this.config.enabled) && !!this.auth;
    }

    /** 取得注入的 fetch 或当前运行环境的 fetch。 */
    _fetchImpl() {
      if (this._fetch) return this._fetch;
      const f = this.root && this.root.fetch;
      return typeof f === 'function' ? f.bind(this.root) : null;
    }

    /** 合并公开配置请求头与当前会话的访问令牌。 */
    _headers(token) {
      const base = this.config && typeof this.config.headers === 'function'
        ? this.config.headers(token)
        : {};
      return Object.assign({ Accept: 'application/json' }, base);
    }

    /** 取可用会话：token 快过期时由 auth.ensureFresh() 自动续期 */
    async _session() {
      if (!this.auth || typeof this.auth.ensureFresh !== 'function') {
        throw new AccountError('not_signed_in');
      }
      let session = null;
      try {
        session = await this.auth.ensureFresh();
      } catch (err) {
        throw mapAuthError(err);
      }
      if (!session || !session.user || typeof session.user.id !== 'string' || !session.user.id) {
        throw new AccountError('not_signed_in');
      }
      return session;
    }

    /** profiles 端点：`/rest/v1/profiles?id=eq.<uid>&select=nickname,avatar,prefs` */
    _profileUrl(userId) {
      const base = this.config && typeof this.config.restUrl === 'function'
        ? this.config.restUrl('/profiles')
        : '';
      if (!base) throw new AccountError('unavailable');
      return base + '?id=eq.' + encodeURIComponent(userId) + '&select=nickname,avatar,prefs';
    }

    /**
     * 统一请求：超时、JSON、错误映射都收在这里。
     * @returns {Promise<{status: number, data: any}>}
     */
    async _request(url, init) {
      const options = init || {};
      const fetchFn = this._fetchImpl();
      if (!fetchFn) throw new AccountError('network');

      const timeout = Number(this.config && this.config.timeoutMs) > 0
        ? Number(this.config.timeoutMs)
        : 0;
      const Abort = this.root && this.root.AbortController;
      let controller = null;
      let timer = null;
      let timedOut = false;
      const fetchInit = { method: options.method || 'GET', headers: options.headers || {} };
      if (options.body !== undefined) fetchInit.body = JSON.stringify(options.body);
      if (typeof Abort === 'function' && timeout > 0) {
        controller = new Abort();
        fetchInit.signal = controller.signal;
        if (typeof setTimeout === 'function') {
          timer = setTimeout(function () {
            timedOut = true;
            try { controller.abort(); } catch (e) { /* 已结束 */ }
          }, timeout);
        }
      }

      let res;
      try {
        res = await fetchFn(url, fetchInit);
      } catch (err) {
        if (timedOut) throw new AccountError('timeout');
        if (err instanceof AccountError) throw err;
        throw new AccountError('network');
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
      if (!ok) throw mapRestError(res && res.status, data);
      return { status: res && res.status, data };
    }

    /** 返回的数组 → 资料对象；空数组 = 资料行缺失/无权限 */
    _rowsToProfile(data) {
      if (!Array.isArray(data)) throw new AccountError('invalid_response');
      if (!data.length) throw new AccountError('profile_missing');
      return normalizeProfileRow(data[0], this.root);
    }

    /**
     * 带会话执行请求；401 时用 refresh_token 续期后重试一次
     * （ensureFresh 已提前续期，这里只是兜底时钟偏差）。
     * 保存时绑定发起账号，在初次请求和重试前检查，防止旧表单写入新账号。
     */
    async _withSession(build, userId) {
      const session = await this._session();
      this._assertUser(session, userId);
      try {
        return await build(session);
      } catch (err) {
        if (err && err.code === 'unauthorized' && this.auth && typeof this.auth.refresh === 'function') {
          this._assertUser(this.auth.session, userId);
          let fresh = null;
          try {
            fresh = await this.auth.refresh();
          } catch (refreshErr) {
            throw mapAuthError(refreshErr);
          }
          this._assertUser(fresh, userId);
          if (fresh && fresh.user && fresh.user.id) return build(fresh);
        }
        throw err;
      }
    }

    /** 绑定账号的写请求仅接受同一账号的有效会话；读取请求不传 userId。 */
    _assertUser(session, userId) {
      if (userId === undefined) return;
      const current = this.auth.session;
      if (!session || !session.user || session.user.id !== userId
        || !current || !current.user || current.user.id !== userId) {
        throw new AccountError('unauthorized');
      }
    }

    /**
     * 读取本人资料。
     * @returns {Promise<{nickname: string, avatar: string, prefs: object}>}
     */
    async load() {
      if (!this.available) {
        throw new AccountError(this.config && this.config.enabled ? 'not_signed_in' : 'unavailable');
      }
      return this._withSession(async (session) => {
        const res = await this._request(this._profileUrl(session.user.id), {
          method: 'GET',
          headers: this._headers(session.accessToken),
        });
        return this._rowsToProfile(res.data);
      });
    }

    /**
     * 保存本人资料（昵称 / 偏好，头像可选）。校验失败不发起请求。
     * avatar 省略时 PATCH 只更新 nickname/prefs，保留云端已有头像——
     * 调用方在「云端头像未知/未来版本、玩家未主动改头像」时应省略该字段。
     * @param {{nickname: string, avatar?: string, prefs: object}} input
     * @returns {Promise<{nickname: string, avatar: string, avatarRaw: string, prefs: object}>}
     */
    async save(input) {
      const profile = validateProfileInput(input, this.root); // 客户端校验先于网络
      if (!this.available) {
        throw new AccountError(this.config && this.config.enabled ? 'not_signed_in' : 'unavailable');
      }
      const initiatingSession = this.auth.session;
      const userId = initiatingSession && initiatingSession.user && initiatingSession.user.id;
      if (!userId) throw new AccountError('not_signed_in');
      return this._withSession(async (session) => {
        const headers = this._headers(session.accessToken);
        headers['Content-Type'] = 'application/json';
        headers.Prefer = 'return=representation';
        const body = { nickname: profile.nickname, prefs: profile.prefs };
        if (profile.avatar !== undefined) body.avatar = profile.avatar;
        const res = await this._request(this._profileUrl(session.user.id), {
          method: 'PATCH',
          headers,
          body: body,
        });
        return this._rowsToProfile(res.data);
      }, userId);
    }
  }

  /** 创建资料客户端；配置、认证客户端和 fetch 均可注入。 */
  function createClient(opts) {
    return new ProfileClient(opts);
  }

  root.MIXX = root.MIXX || {};
  root.MIXX.account = Object.freeze({
    DEFAULT_AVATAR: DEFAULT_AVATAR,
    DEFAULT_NICKNAME: DEFAULT_NICKNAME,
    NICKNAME_MIN: NICKNAME_MIN,
    NICKNAME_MAX: NICKNAME_MAX,
    TOUCH_VALUES: TOUCH_VALUES,
    DEFAULT_PREFS: DEFAULT_PREFS,
    ERROR_MESSAGES: ERROR_MESSAGES,
    AccountError: AccountError,
    ProfileClient: ProfileClient,
    createClient: createClient,
    avatarPresets: avatarPresets,
    defaultAvatar: defaultAvatar,
    isAvatarAllowed: isAvatarAllowed,
    presetFor: presetFor,
    normalizeAvatar: normalizeAvatar,
    normalizeNickname: normalizeNickname,
    normalizePrefs: normalizePrefs,
    normalizeProfileRow: normalizeProfileRow,
    validateProfileInput: validateProfileInput,
    isPrefsEqual: isPrefsEqual,
    charLength: charLength,
    mapRestError: mapRestError,
  });
})(typeof window !== 'undefined' ? window : globalThis);
