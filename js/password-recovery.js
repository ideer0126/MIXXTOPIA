/** Standalone email recovery UI. No game boot, storage access, timers or background sync. */
'use strict';

(function (root) {
  'use strict';

  function parseFragment(hash) {
    if (!hash || hash === '#') return null;
    const params = new root.URLSearchParams(hash.replace(/^#/, ''));
    const invalid = () => { throw new root.MIXX.auth.AuthError('invalid_recovery_link'); };
    for (const key of ['type', 'access_token', 'error', 'error_code']) {
      if (params.getAll(key).length > 1) invalid();
    }
    if (params.has('error') || params.has('error_code')) {
      // Never render error_description from a URL as trusted player-facing text.
      throw new root.MIXX.auth.AuthError('recovery_expired');
    }
    if (params.get('type') !== 'recovery' || !params.get('access_token')) invalid();
    return params.get('access_token'); // Refresh tokens are neither used nor retained.
  }

  function boot() {
    const doc = root.document;
    const el = id => doc.getElementById('recovery-' + id);
    const ui = {};
    for (const id of ['title', 'note', 'request', 'reset', 'email', 'password', 'confirm',
      'send', 'save', 'again', 'msg', 'account']) ui[id] = el(id);
    const client = root.MIXX.auth.createRecoveryClient({ root });
    let epoch = 0, busy = false;
    const hide = (node, value) => node.classList.toggle('hidden', value);
    function message(text, error) {
      ui.msg.textContent = text || '';
      ui.msg.classList.toggle('login-msg-error', !!error);
      ui.msg.classList.toggle('login-msg-ok', !!text && !error);
    }
    function clearPasswords() { ui.password.value = ''; ui.confirm.value = ''; }
    function setBusy(value) {
      busy = value;
      for (const key of ['email', 'password', 'confirm', 'send', 'save', 'again']) ui[key].disabled = value;
    }
    function requestForm() {
      epoch++;
      client.cancelRecovery();
      clearPasswords();
      hide(ui.request, false); hide(ui.reset, true); hide(ui.again, true);
      ui.account.textContent = '';
      ui.title.textContent = '找回密码';
      ui.note.textContent = '输入注册邮箱，我们会发送密码重置链接。';
      message('', false);
    }
    async function run(action, done) {
      if (busy) return;
      const current = epoch;
      setBusy(true);
      try {
        const result = await action();
        if (current === epoch) done(result);
      } catch (err) {
        if (current !== epoch) return;
        message(err && err.message || '操作失败，请稍后重试。', true);
        if (!client.getRecoveryUser() && ui.request.classList.contains('hidden')) {
          hide(ui.reset, true); hide(ui.again, false);
          ui.note.textContent = '请返回游戏验证登录，或重新申请重置邮件。';
          ui.account.textContent = '';
        }
      } finally { if (current === epoch) setBusy(false); }
    }
    ui.request.addEventListener('submit', event => {
      event.preventDefault();
      if (busy) return;
      const email = ui.email.value;
      const target = new root.URL('reset-password.html', root.location.href);
      message('正在申请重置邮件…', false);
      run(() => client.requestPasswordReset(email, target.href), () => {
        message('如果该邮箱已注册，你将收到重置邮件。请检查收件箱和垃圾邮件；重复申请请稍后再试。', false);
      });
    });
    ui.reset.addEventListener('submit', event => {
      event.preventDefault();
      if (busy) return;
      const password = ui.password.value, confirmation = ui.confirm.value;
      clearPasswords();
      if (password !== confirmation) { message('两次输入的新密码不一致', true); return; }
      message('正在重置密码…', false);
      run(() => client.resetPassword(password), () => {
        hide(ui.reset, true); hide(ui.again, true);
        ui.account.textContent = '';
        ui.title.textContent = '密码已重置';
        ui.note.textContent = '请返回游戏，使用新密码登录。';
        message('本机存档和设置已保留。', false);
      });
    });
    ui.again.addEventListener('click', requestForm);
    root.addEventListener('pagehide', () => {
      epoch++;
      client.cancelRecovery();
      clearPasswords();
      ui.email.value = '';
      token = null;
    });
    root.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      requestForm(); setBusy(false);
      message('本次恢复验证已结束，请重新申请邮件。', true);
    });

    let token = null, error = null;
    try { token = parseFragment(root.location.hash); } catch (err) { error = err; }
    // Remove credentials before verification or any auth request. Never store them in
    // sessionStorage/localStorage, DOM, logs, query strings, or the game AuthClient.
    try {
      root.history.replaceState(null, '', root.location.pathname);
    } catch (err) {
      token = null;
      error = new root.MIXX.auth.AuthError('invalid_recovery_link');
    }
    if (error) {
      hide(ui.request, true); hide(ui.again, false);
      message(error.message, true);
    } else if (token) {
      hide(ui.request, true);
      ui.note.textContent = '正在验证重置链接…';
      run(() => client.verifyRecovery(token), user => {
        token = null;
        ui.title.textContent = '设置新密码';
        ui.note.textContent = '邮箱已验证。请设置至少 6 位的新密码。';
        ui.account.textContent = user.email;
        hide(ui.reset, false);
        setBusy(false);
        ui.password.focus();
      }).finally(() => { token = null; });
    }
    return { client };
  }

  root.MIXX = root.MIXX || {};
  root.MIXX.recovery = Object.freeze({ parseFragment, boot });
  if (root.document && !root.MIXX_NO_RECOVERY_BOOT) boot();
})(typeof window !== 'undefined' ? window : globalThis);
