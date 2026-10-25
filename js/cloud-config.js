/**
 * js/cloud-config.js —— Supabase 公开配置（Issue #42，父任务 #22）
 *
 * 为什么这张「密钥」可以提交进仓库：
 *   本项目走 A2（Supabase + 手写 fetch，不引 SDK），前端直连 GoTrue / PostgREST。
 *   `anonKey` 是设计上就发给浏览器的公开凭据（新控制台叫 publishable key，
 *   形如 `sb_publishable_...`），**权限完全由数据库 RLS 决定**，
 *   见 supabase/migrations/0001_init.sql。
 *   ⚠️ service_role / `sb_secret_...` 绝不可写进本文件——它绕过全部 RLS。
 *
 * 本文件只提供常量与 URL 拼装，不发起任何请求：
 *   - #43 Auth：`MIXX.cloudConfig.authUrl('/token?grant_type=password')`
 *   - #45 云存档：`MIXX.cloudConfig.restUrl('/saves')`
 *   - #46 统计：`MIXX.cloudConfig.restUrl('/stats')`
 *
 * 未配置 `url` / `anonKey` 时 `enabled === false`，调用方应静默跳过云功能，
 * 保持「未登录 / 离线也能正常玩」的既有行为。
 *
 * 测试覆盖：沙箱里设 `globalThis.MIXX_CLOUD_CONFIG = { url, anonKey }` 可覆盖默认值，
 * 便于 tools/test-*.js 用假地址跑（不需要真实后端）。
 */
'use strict';

(function (root) {
  'use strict';

  /** 默认值：Supabase 项目地址（只到域名，不含 /rest/v1）与 publishable key */
  const DEFAULTS = {
    url: 'https://hlnubesywvcxdghfyoux.supabase.co',
    anonKey: 'sb_publishable_ErtYrAUzaDlHDR_coQ9k-A_e033Ze15',
    timeoutMs: 8000,
  };

  /** 表名（与 migrations/0001_init.sql 保持一致） */
  const TABLES = Object.freeze({
    profiles: 'profiles',
    saves: 'saves',
    stats: 'stats',
  });

  /**
   * 归一化项目地址：去空格、去尾部斜杠，并容忍误粘贴的 `/rest/v1`。
   * @param {string} raw
   * @returns {string} 形如 `https://xxx.supabase.co`；非法则返回空串
   */
  function normalizeUrl(raw) {
    if (typeof raw !== 'string') return '';
    let url = raw.trim().replace(/\/+$/, '');
    url = url.replace(/\/rest\/v1$/i, '');
    if (!/^https?:\/\/[^/\s]+$/i.test(url)) return '';
    return url;
  }

  /**
   * 拼 URL：base + 固定路径 + 可选子路径（自动补前导斜杠）
   * @param {string} base
   * @param {string} prefix  例如 `/auth/v1`
   * @param {string} path    例如 `/token`
   */
  function joinUrl(base, prefix, path) {
    const tail = typeof path === 'string' && path.length ? path : '';
    return base + prefix + (tail && tail.charAt(0) !== '/' ? '/' + tail : tail);
  }

  const override = (root.MIXX_CLOUD_CONFIG && typeof root.MIXX_CLOUD_CONFIG === 'object')
    ? root.MIXX_CLOUD_CONFIG
    : {};

  const url = normalizeUrl(override.url || DEFAULTS.url);
  const anonKey = String(override.anonKey || DEFAULTS.anonKey || '').trim();
  const timeoutMs = Number(override.timeoutMs) > 0 ? Number(override.timeoutMs) : DEFAULTS.timeoutMs;
  const enabled = !!(url && anonKey);

  const config = {
    url,
    anonKey,
    timeoutMs,
    enabled,
    /** `publishable`（sb_ 前缀）或 `jwt-anon`（旧版 JWT）；仅用于日志/提示文案 */
    keyKind: anonKey.indexOf('sb_') === 0 ? 'publishable' : 'jwt-anon',
    tables: TABLES,

    /**
     * GoTrue 端点：authUrl('/token?grant_type=password')
     * @param {string} [path]
     * @returns {string} 未配置时返回空串
     */
    authUrl(path) {
      return enabled ? joinUrl(url, '/auth/v1', path) : '';
    },

    /**
     * PostgREST 端点：restUrl('/saves?user_id=eq.<uid>')
     * @param {string} [path]
     * @returns {string} 未配置时返回空串
     */
    restUrl(path) {
      return enabled ? joinUrl(url, '/rest/v1', path) : '';
    },

    /**
     * 请求头：`apikey` 恒定带项目公开密钥；登录后再加 `Authorization: Bearer <access_token>`。
     * 未登录时**不**把 anonKey 塞进 Authorization——让服务端按 anon 角色处理，
     * 与 RLS「只授 authenticated」的模型保持一致。
     * @param {string} [accessToken] 登录后拿到的用户 JWT
     * @returns {object} 可直接展开进 fetch init.headers 的普通对象
     */
    headers(accessToken) {
      const headers = { apikey: anonKey, Accept: 'application/json' };
      if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
      return headers;
    },
  };

  root.MIXX = root.MIXX || {};
  root.MIXX.cloudConfig = Object.freeze(config);

  // 配置缺失只提示一次，不抛错：云功能静默关闭，本地存档照常。
  if (!enabled && typeof console !== 'undefined' && console.warn) {
    console.warn('[MIXXTOPIA] 云端配置缺失（url / anonKey），云端功能已关闭，本地存档不受影响。');
  }
})(typeof window !== 'undefined' ? window : globalThis);
