/* CJP Investments Portal - authfix.js
   PKCE redirect resilience for Microsoft Entra sign-in.
   Loads immediately after app.js.
   - Mirrors short-lived auth/PKCE sessionStorage entries to localStorage.
   - Restores them synchronously before DOMContentLoaded/boot handles redirect.
   - Expires mirrored values after 10 minutes.
   - Does NOT persist access or refresh tokens.
*/
(() => {
  'use strict';
  const PREFIX = 'cjp.authfix.';
  const MAX_AGE = 10 * 60 * 1000;
  const authKey = k => /(^|[._:-])(pkce|verifier|state|nonce|auth)([._:-]|$)/i.test(String(k || '')) && !/(access|refresh|id)[._:-]?token/i.test(String(k || ''));

  function safeParse(v) { try { return JSON.parse(v); } catch { return null; } }
  function mirrorKey(k, v) {
    if (!authKey(k) || v == null) return;
    try { localStorage.setItem(PREFIX + k, JSON.stringify({ at: Date.now(), value: String(v) })); } catch {}
  }
  function removeMirror(k) { try { localStorage.removeItem(PREFIX + k); } catch {} }
  function restore() {
    try {
      const now = Date.now();
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const lk = localStorage.key(i);
        if (!lk || !lk.startsWith(PREFIX)) continue;
        const k = lk.slice(PREFIX.length), r = safeParse(localStorage.getItem(lk));
        if (!r || !r.at || now - r.at > MAX_AGE) { localStorage.removeItem(lk); continue; }
        if (sessionStorage.getItem(k) == null) sessionStorage.setItem(k, r.value);
      }
    } catch {}
  }
  function cleanupAfterReturn() {
    try {
      const q = new URLSearchParams(location.search);
      if (!(q.has('code') || q.has('error'))) return;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
      }
    } catch {}
  }

  // Restore before app.js's DOMContentLoaded handler runs.
  restore();

  // Mirror future PKCE/state writes made by app.js before redirect.
  try {
    const originalSet = sessionStorage.setItem.bind(sessionStorage);
    const originalRemove = sessionStorage.removeItem.bind(sessionStorage);
    sessionStorage.setItem = (k, v) => { originalSet(k, v); mirrorKey(k, v); };
    sessionStorage.removeItem = k => { originalRemove(k); if (authKey(k)) removeMirror(k); };
  } catch {}

  // Leave mirrored state available during redirect handling, then remove it.
  window.addEventListener('load', () => setTimeout(cleanupAfterReturn, 5000), { once: true });
})();
