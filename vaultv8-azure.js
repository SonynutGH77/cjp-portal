/* Property Portal v8.0 Beta 1 - "Unlock with Azure" (Key Vault) with automatic passphrase fallback

   WHAT IT DOES
   - Load AFTER vaultv7-beta2.js. Nothing else is changed: app.js, authfix.js and vaultv7-beta2.js stay exactly as they are.
   - When the portal needs to unlock your encrypted data, it first asks your Azure Function for the key. The Function checks your
     Microsoft sign-in (tenant, audience, scope and your account) and reads the key from Key Vault with its managed identity.
   - If anything goes wrong (Function down, consent or MFA needed, wrong key, slow network) the normal passphrase prompt appears
     with a short reason, so the v7 behaviour is always the safety net. The Bitwarden passphrase keeps working.
   - A device remembered with "Remember on this device" still unlocks first without calling Azure.
   - The key is held in memory only. It is never written to storage, and the vault data format is unchanged.

   TURN IT OFF OR ON (works on a phone)
   - Open  https://portal.sonynut.com/?azure=off  to switch Azure unlock off on this device, and  ?azure=on  to switch it back on.
   - Stopping or deleting the Function App also just falls back to the passphrase prompt.
   - Console helpers: PortalVaultV8.status(), PortalVaultV8.test() (checks the Azure path without revealing the key). */
(() => {
  'use strict';
  const VER = '8.0-beta1';
  const API_URL = 'https://investmentportal-api-h0c9debmaaepc7gp.australiaeast-01.azurewebsites.net/api/unlock';
  const SCOPE_NAME = 'vault.unlock';       // exposed on the portal's Entra app registration
  const TIMEOUT_MS = 20000;                // covers a cold start of the Function
  const RETRY_GAP_MS = 30000;              // do not hammer a failing Function
  const FLAG = 'cjp.azureUnlock';          // localStorage: 'off' disables
  const MIN_KEY = 12;                      // same minimum as the vault passphrase

  const S = { patched: false, method: null, azureKey: false, lastTry: 0, lastErr: '' };

  /* ---------- on/off switch via URL (?azure=off / ?azure=on), then tidy the address bar ---------- */
  try {
    const q = new URLSearchParams(location.search), a = q.get('azure');
    if (a === 'off' || a === 'on') {
      if (a === 'off') localStorage.setItem(FLAG, 'off'); else localStorage.removeItem(FLAG);
      q.delete('azure');
      const qs = q.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    }
  } catch (e) { }
  const enabled = () => { try { return localStorage.getItem(FLAG) !== 'off'; } catch (e) { return true; } };

  const fail = code => Object.assign(new Error(code), { code });

  /* ---------- 1. a token for the Function, using the sign-in the portal already has ----------
     Uses the existing refresh token to ask Entra for the vault.unlock scope of this same app. It does NOT touch Auth.tok,
     so the Graph token the portal uses for SharePoint is left exactly as it was. */
  async function vaultToken(signal) {
    let A = null, K = null;
    try { A = typeof Auth !== 'undefined' ? Auth : null; } catch (e) { }
    try { K = typeof C !== 'undefined' ? C : null; } catch (e) { }
    if (!A || !K || !K.clientId || !K.tenant) throw fail('no_app');
    const t = A.tok;
    if (!t || !t.rt) throw fail('no_session');
    const r = await fetch('https://login.microsoftonline.com/' + encodeURIComponent(K.tenant) + '/oauth2/v2.0/token', {
      method: 'POST', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: K.clientId, grant_type: 'refresh_token', refresh_token: t.rt, scope: 'api://' + K.clientId + '/' + SCOPE_NAME })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw fail('token_' + (j.error || r.status));
    return j.access_token;
  }

  /* ---------- 2. ask the Function for the vault key ---------- */
  async function azureKey() {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const at = await vaultToken(ctl.signal);
      let r;
      try { r = await fetch(API_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + at }, cache: 'no-store', credentials: 'omit', signal: ctl.signal }); }
      catch (e) { throw fail(e && e.name === 'AbortError' ? 'timeout' : 'network'); }
      let j = null; try { j = await r.json(); } catch (e) { }
      if (!r.ok) throw fail('http_' + r.status + (j && j.error ? '_' + j.error : ''));
      if (!j || typeof j.key !== 'string' || j.key.length < MIN_KEY) throw fail('bad_response');
      return j.key;
    } catch (e) {
      if (e && e.code) throw e;
      throw fail(e && e.name === 'AbortError' ? 'timeout' : 'error');
    } finally { clearTimeout(timer); }
  }

  // Short, plain reasons for the passphrase prompt. Codes only; no tokens or keys are ever included.
  function describe(e) {
    const c = String((e && e.code) || 'error');
    if (c === 'timeout') return 'timed out';
    if (c === 'network' || c === 'error') return 'could not reach it - network, CORS or CSP';
    if (c === 'no_session' || c === 'no_app') return 'no active sign-in';
    if (/^token_(interaction_required|login_required)/.test(c)) return 'Microsoft needs you to sign in again';
    if (/^token_consent_required|^token_invalid_scope|^token_invalid_grant/.test(c)) return 'consent or scope not set up (' + c.replace('token_', '') + ')';
    if (c.startsWith('token_')) return 'token request failed (' + c.replace('token_', '') + ')';
    if (c === 'http_403_origin_not_allowed') return 'origin not allowed';
    if (c.startsWith('http_403')) return 'this account is not permitted';
    if (c.startsWith('http_401')) return 'token rejected';
    if (c.startsWith('http_502')) return 'Key Vault not reachable';
    if (c.startsWith('http_500')) return 'Function not configured';
    return c;
  }

  /* ---------- 3. hook into the vault's unlock prompt ----------
     vaultv7-beta2 asks ui.askUnlock(msg) for the passphrase and then derives the key and decrypts. We answer that question with the
     key from Azure; if it fails or is wrong, the real prompt is shown (with a reason). Nothing else in the vault is touched. */
  const statusText = t => { try { const g = document.getElementById('gateBody'); if (g && g.firstElementChild && /loading|preparing/i.test(g.textContent)) g.firstElementChild.textContent = t; } catch (e) { } };

  function patch() {
    const api = typeof window !== 'undefined' ? window.PortalVaultBeta2 : null, ui = api && api._ui;
    if (!ui || typeof ui.askUnlock !== 'function') return false;
    if (S.patched) return true;
    const orig = ui.askUnlock.bind(ui);
    ui.askUnlock = async function (msg) {
      // First ask of this unlock (no error message yet): try Azure.
      if (!msg && enabled() && Date.now() - S.lastTry > RETRY_GAP_MS) {
        S.lastTry = Date.now();
        statusText('Unlocking with Azure\u2026');
        try {
          const k = await azureKey();
          ui.remDays = 0;                  // no need to remember a device when Azure unlocks silently
          S.azureKey = true; S.method = 'azure-pending'; S.lastErr = '';
          return k;
        } catch (e) { S.azureKey = false; S.lastErr = describe(e); try { console.warn('[vault v8] Azure unlock not used:', e && e.code); } catch (x) { } }
      }
      if (msg && S.azureKey) { S.azureKey = false; msg = 'The key from Azure did not open the data. Enter your passphrase instead.'; }
      else if (!msg && S.lastErr && enabled()) msg = 'Azure unlock unavailable (' + S.lastErr + '). Enter your passphrase.';
      S.method = 'passphrase';
      return orig(msg);
    };
    S.patched = true; return true;
  }

  /* ---------- 4. show which method unlocked the vault ---------- */
  const LABEL = { azure: 'Azure', passphrase: 'passphrase', device: 'this device' };
  const LONG = { azure: 'Azure Key Vault', passphrase: 'your passphrase', device: 'the key remembered on this device' };
  function mark(m) {
    try { if (typeof toast === 'function') toast('Vault unlocked with ' + LONG[m]); } catch (e) { }
    let n = 0; const t = setInterval(() => {
      const b = document.getElementById('v7vault');
      if (b) { b.textContent = '\uD83D\uDD12 Encryption vault \u00b7 ' + LABEL[m]; clearInterval(t); } else if (++n > 40) clearInterval(t);
    }, 500);
  }
  function watch() {
    let n = 0; const t = setInterval(() => {
      const V = window.PortalVaultBeta2 && window.PortalVaultBeta2._V;
      if (V && V.cache) { clearInterval(t); S.method = S.method === 'azure-pending' ? 'azure' : S.method === 'passphrase' ? 'passphrase' : 'device'; mark(S.method); return; }
      if (++n > 1200) clearInterval(t);   // give up after about 10 minutes
    }, 500);
  }

  /* ---------- public helpers ---------- */
  window.PortalVaultV8 = {
    version: VER,
    status: () => ({ version: VER, enabled: enabled(), patched: S.patched, method: S.method, lastError: S.lastErr }),
    enable: () => { try { localStorage.removeItem(FLAG); } catch (e) { } return enabled(); },
    disable: () => { try { localStorage.setItem(FLAG, 'off'); } catch (e) { } return !enabled(); },
    // Checks the whole Azure path (token, Function, Key Vault) and reports ok or the reason. The key itself is never returned.
    test: async () => { try { await azureKey(); return { ok: true }; } catch (e) { return { ok: false, code: e && e.code, reason: describe(e) }; } }
  };

  if (!patch()) { let n = 0; const t = setInterval(() => { if (patch() || ++n > 80) clearInterval(t); }, 100); }
  watch();
})();
