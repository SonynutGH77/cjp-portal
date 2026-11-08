/* Property Portal v7.0 Alpha 4 - Security Vault self-test, save diagnostics and data locator
   - Does NOT read or change your portal data. It writes only small test files in the vault-v7-alpha folder.
   - Reads portal state through the app's own globals (S, Store, Cloud, Auth, etag, P_DATA).
     Those are let/const bindings, so they are NOT properties of window - they are used as bare identifiers.
   - Observes storage writes (it re-throws every error unchanged) so a "Save failed" can be explained. */
(() => {
  'use strict';
  const VER = '7.0-alpha4', DIR = 'Portal/vault-v7-alpha', TEST = DIR + '/selftest.enc', BIG = DIR + '/selftest-large.bin';
  const ITER = 600000, AAD = 'portal-vault-selftest-v1', MAX_ATTEMPTS = 30;
  const te = new TextEncoder(), td = new TextDecoder();

  /* ---------- helpers (chunked, so large buffers cannot overflow the call stack) ---------- */
  const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rand = n => { const a = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(a.subarray(i, Math.min(n, i + 65536))); return a; };
  const errText = e => (e && e.conflict) ? '412 conflict (file changed on the server)' : String((e && e.message) || e).slice(0, 300);
  const kb = n => n == null ? '-' : n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
  const short = s => String(s || '').replace(/[^A-Za-z0-9,]/g, '').slice(-10);

  /* ---------- access to the app's globals (never throws) ---------- */
  const g = {
    store: () => { try { return typeof Store !== 'undefined' ? Store : null; } catch (e) { return null; } },
    data: () => { try { return typeof S !== 'undefined' ? S : null; } catch (e) { return null; } },
    etag: () => { try { return typeof etag !== 'undefined' ? etag : null; } catch (e) { return null; } },
    path: () => { try { return typeof P_DATA !== 'undefined' ? P_DATA : 'Portal/data/portal-data.json'; } catch (e) { return 'Portal/data/portal-data.json'; } },
    tokenMinutes: () => { try { return typeof Auth !== 'undefined' && Auth.tok ? Math.round((Auth.tok.exp - Date.now()) / 60000) : null; } catch (e) { return null; } }
  };

  /* ---------- crypto: PBKDF2-HMAC-SHA-256 -> AES-256-GCM ---------- */
  async function deriveKey(pass, salt, iter) {
    const m = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, m, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(pass, obj) {
    const salt = rand(16), iv = rand(12), key = await deriveKey(pass, salt, ITER);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(AAD), tagLength: 128 }, key, te.encode(JSON.stringify(obj)));
    return { format: 'portal-vault-selftest', v: 1, alg: 'AES-256-GCM', kdf: { name: 'PBKDF2-HMAC-SHA-256', iterations: ITER, salt: b64(salt) }, iv: b64(iv), ct: b64(ct) };
  }
  async function open(pass, box) {
    const it = box && box.kdf && box.kdf.iterations;
    if (!(it >= 100000 && it <= 2000000)) throw new Error('Unsupported key-derivation setting');
    const key = await deriveKey(pass, unb64(box.kdf.salt), it);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: te.encode(AAD), tagLength: 128 }, key, unb64(box.ct));
    return JSON.parse(td.decode(pt));
  }

  /* ---------- passive write observer (rethrows every error unchanged) ---------- */
  const attempts = []; let lastSaveToast = null;
  const note = rec => { attempts.push(rec); if (attempts.length > MAX_ATTEMPTS) attempts.shift(); };
  function instrument() {
    try {
      if (typeof Cloud !== 'undefined' && Cloud && typeof Cloud.put === 'function' && !Cloud.put.__diag) {
        const orig = Cloud.put;
        const wrapped = async function (p, b, tag) {
          const rec = { at: new Date().toISOString(), path: String(p), size: b && b.size, ifMatch: !!tag };
          try { const r = await orig.call(this, p, b, tag); rec.ok = true; note(rec); return r; }
          catch (e) { rec.ok = false; rec.error = errText(e); note(rec); throw e; }
        };
        wrapped.__diag = true; Cloud.put = wrapped;
      }
      if (typeof window !== 'undefined' && typeof window.toast === 'function' && !window.toast.__diag) {
        const orig = window.toast;
        const w = function (m) { try { if (/^save failed/i.test(String(m))) lastSaveToast = { at: new Date().toISOString(), msg: String(m).slice(0, 300) }; } catch (e) { } return orig.apply(this, arguments); };
        w.__diag = true; window.toast = w;
      }
    } catch (e) { console.warn('diagnostics hook skipped', e); }
  }

  /* ---------- plain-English meaning of an error ---------- */
  function explain(err) {
    const e = String(err || '');
    if (/Blocked outbound request/i.test(e)) return 'The portal\'s own outbound-request filter blocked this request (securityhardening.js).';
    if (/\(423/.test(e)) return '423 = the file is locked (open in another app, or being synced).';
    if (/\(429|\(503|\(504|\(509/.test(e)) return 'The service is throttling or temporarily unavailable. Retrying later usually works.';
    if (/\(403/.test(e)) return '403 = permission. The signed-in account or the app lacks write access to this location.';
    if (/\(401/.test(e)) return '401 = the sign-in token was rejected. Sign out and in again.';
    if (/\(404/.test(e)) return '404 = the folder or file path was not found.';
    if (/\(409/.test(e)) return '409 = name or version conflict on the server.';
    if (/\(413|\(507/.test(e)) return 'The file is too large, or storage is full.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(e)) return 'The request never reached the server: offline, a browser extension, or a blocked request.';
    if (/circular structure/i.test(e)) return 'Portal data contains a circular reference, so it cannot be saved as JSON.';
    return '';
  }

  /* ---------- encrypted storage self-test ---------- */
  async function selfTest(pass, onStep) {
    const R = [];
    const add = (name, status, detail, ms) => { const r = { name, status, detail: detail || '', ms: ms == null ? null : Math.round(ms) }; R.push(r); if (onStep) onStep(r); return r; };
    const run = async (name, fn) => {
      const t = performance.now();
      try { const v = (await fn()) || {}; add(name, v.warn ? 'warn' : 'ok', v.warn || v.note, performance.now() - t); return { ok: true, v }; }
      catch (e) { add(name, 'fail', errText(e), performance.now() - t); return { ok: false }; }
    };
    const skip = (name, why) => add(name, 'skip', why);
    const st = g.store();
    let box = null, text1 = null, tag1 = null, back = null;
    const payload = { test: true, nonce: b64(rand(12)), at: new Date().toISOString() };

    if (!(await run('Browser crypto available', async () => { if (!(globalThis.crypto && crypto.subtle)) throw new Error('Web Crypto is unavailable (needs HTTPS)'); return { note: 'AES-GCM and PBKDF2 supported' }; })).ok) return R;
    if (!(await run('Private storage connected', async () => { if (!st) throw new Error('Not connected. Sign in first.'); return { note: st.label || 'connected' }; })).ok) return R;
    if (String(pass || '').length < 12) { add('Test passphrase', 'fail', 'Use at least 12 characters (a throwaway phrase, not your real vault passphrase).'); return R; }

    const enc = await run('Derive key and encrypt (PBKDF2, 600,000 iterations)', async () => { box = await seal(pass, payload); text1 = JSON.stringify(box); return { note: text1.length + ' bytes of ciphertext JSON' }; });
    const wr = enc.ok ? await run('Write encrypted test file', async () => { tag1 = await st.writeText(TEST, text1); return { note: 'saved, version ' + short(tag1) }; }) : { ok: false };
    if (!wr.ok) { ['Read it back', 'Decrypt with the right passphrase', 'Wrong passphrase is rejected', 'Overwrite using the version check (as a portal save does)', 'Stale version is refused (two-device protection)'].forEach(n => skip(n, 'needs the write to succeed')); return R; }

    const rd = await run('Read it back', async () => { back = await st.readText(TEST); if (back !== text1) throw new Error('Read-back differs from what was written'); return { note: 'identical to what was written' }; });
    if (rd.ok) {
      await run('Decrypt with the right passphrase', async () => { const p = await open(pass, JSON.parse(back)); if (p.nonce !== payload.nonce) throw new Error('Decrypted content does not match'); return { note: 'content matched' }; });
      await run('Wrong passphrase is rejected', async () => { let rejected = false; try { await open(pass + 'x', JSON.parse(back)); } catch (e) { rejected = true; } if (!rejected) throw new Error('A wrong passphrase was accepted'); return { note: 'authentication failed, as it should' }; });
    } else { skip('Decrypt with the right passphrase', 'needs the read to succeed'); skip('Wrong passphrase is rejected', 'needs the read to succeed'); }

    let tag2 = null;
    const ow = await run('Overwrite using the version check (as a portal save does)', async () => { const b2 = await seal(pass, { ...payload, rev: 2 }); tag2 = await st.writeText(TEST, JSON.stringify(b2), tag1); return { note: 'accepted, new version ' + short(tag2) }; });
    if (ow.ok) {
      await run('Stale version is refused (two-device protection)', async () => {
        try { await st.writeText(TEST, text1, tag1); } catch (e) { if (e && e.conflict) return { note: 'refused with a conflict, as it should' }; throw e; }
        return { warn: 'The server accepted a stale version, so overwrite protection between two devices is weaker than expected.' };
      });
    } else skip('Stale version is refused (two-device protection)', 'needs the overwrite to succeed');
    return R;
  }

  async function deleteTestFiles() {
    const st = g.store(); if (!st) throw new Error('Not connected');
    const a = await st.remove(TEST), b = await st.remove(BIG);
    return { test: a, large: b };
  }

  /* ---------- large-upload path check (files over 3.5 MB use a different upload route) ---------- */
  async function largeTest() {
    const st = g.store(); if (!st) throw new Error('Not connected');
    const t = performance.now(), blob = new Blob([rand(3600000)], { type: 'application/octet-stream' });
    await st.writeBlob(BIG, blob);
    const ms = Math.round(performance.now() - t);
    let removed = false; try { removed = await st.remove(BIG); } catch (e) { }
    return { ms, removed };
  }

  /* ---------- save diagnostics ---------- */
  async function diagnostics() {
    const d = { at: new Date().toISOString(), version: VER, online: typeof navigator !== 'undefined' ? navigator.onLine : null, tokenMinutes: g.tokenMinutes(), hints: [] };
    const data = g.data(), st = g.store();
    if (!data) d.hints.push('Portal data is not loaded yet.');
    else {
      try { const txt = JSON.stringify(data, null, 1); d.dataBytes = new Blob([txt]).size; d.serialises = true; }
      catch (e) { d.serialises = false; d.serialiseError = errText(e); d.hints.push('Portal data cannot be converted to JSON (' + d.serialiseError + '). That alone makes every save fail. Use "3. Find the cause" below to see which part of the data it is.'); }
      if (d.dataBytes > 3500000) d.hints.push('Portal data is ' + kb(d.dataBytes) + '. Files over 3.5 MB are saved with a different (chunked) upload that skips the version check. Use "Test large upload" below.');
    }
    if (st && typeof st.meta === 'function') {
      try {
        const m = await st.meta(g.path());
        if (!m) d.server = { missing: true };
        else { d.server = { size: m.size, modified: m.lastModifiedDateTime, matchesLoaded: g.etag() ? m.eTag === g.etag() : null }; if (d.server.matchesLoaded === false) d.hints.push('The saved file on the server is newer than the copy this page loaded (another device, a sync, or an add-on wrote it). The next save will reload instead of overwriting.'); }
      } catch (e) { d.serverError = errText(e); d.hints.push('Could not read the saved file\'s details: ' + d.serverError); }
    }
    d.attempts = attempts.slice(-12);
    d.lastSaveToast = lastSaveToast;
    const failed = attempts.filter(a => a.ok === false && !String(a.path).startsWith(DIR)).slice(-1)[0];
    if (failed) { const x = explain(failed.error); d.hints.push('Most recent failed write: ' + failed.path + ' - ' + failed.error + (x ? '. ' + x : '')); }
    else if (lastSaveToast) { const x = explain(lastSaveToast.msg); d.hints.push('Save failed message seen: ' + lastSaveToast.msg + (x ? '. ' + x : '')); }
    if (!attempts.length) d.hints.push('No writes recorded since this page loaded. Make a small change (for example edit a bill note), then press Refresh.');
    return d;
  }

  let lastLoc = null;
  function reportText(self, diag) {
    const L = ['Property Portal ' + VER + ' report ' + new Date().toISOString(), ''];
    if (self) { L.push('SELF-TEST'); self.forEach(r => L.push(' [' + r.status.toUpperCase() + '] ' + r.name + (r.detail ? ' - ' + r.detail : '') + (r.ms != null ? ' (' + r.ms + ' ms)' : ''))); L.push(''); }
    if (diag) {
      L.push('SAVE DIAGNOSTICS');
      L.push(' online: ' + diag.online + ' | sign-in minutes left: ' + diag.tokenMinutes);
      L.push(' data size: ' + kb(diag.dataBytes) + ' | serialises: ' + diag.serialises + (diag.serialiseError ? ' (' + diag.serialiseError + ')' : ''));
      if (diag.server) L.push(' server file: ' + (diag.server.missing ? 'missing' : kb(diag.server.size) + ', modified ' + diag.server.modified + ', matches loaded copy: ' + diag.server.matchesLoaded));
      if (diag.lastSaveToast) L.push(' last "Save failed" message: ' + diag.lastSaveToast.msg + ' @ ' + diag.lastSaveToast.at);
      L.push(' recent writes:'); (diag.attempts || []).forEach(a => L.push('  ' + a.at + ' ' + (a.ok ? 'OK  ' : 'FAIL') + ' ' + a.path + ' ' + kb(a.size) + (a.ifMatch ? ' if-match' : '') + (a.error ? ' -> ' + a.error : '')));
      L.push(' hints:'); diag.hints.forEach(x => L.push('  - ' + x));
    }
    if (lastLoc) {
      L.push(''); L.push('DATA LOCATOR');
      L.push(' whole converts: ' + lastLoc.whole.ok + (lastLoc.whole.ok ? ' (' + kb(lastLoc.whole.bytes) + ')' : ' - ' + lastLoc.whole.error));
      L.push(' JSON.stringify native: ' + lastLoc.env.stringifyNative + ' | prototype toJSON added: ' + (lastLoc.env.protoToJSON.join(',') || 'none'));
      L.push(' top-level: ' + lastLoc.top.map(x => x.key + (x.ok ? '=' + kb(x.bytes) : '=FAILS')).join(', '));
      if (lastLoc.drill) { L.push(' failing path: ' + lastLoc.drill.path + ' (' + lastLoc.drill.levels + ' levels shown)'); L.push(' why: ' + lastLoc.drill.kind); if (lastLoc.drill.keys) L.push(' keys: ' + lastLoc.drill.keys.join(', ')); if (lastLoc.drill.keysAtEnd) L.push(' keys at end: ' + lastLoc.drill.keysAtEnd.join(', ')); }
      if (lastLoc.measure) L.push(' depth: ' + (lastLoc.measure.capped ? '>' : '') + lastLoc.measure.maxDepth + ', nodes: ' + lastLoc.measure.nodes + ', repeated refs: ' + lastLoc.measure.repeats);
      lastLoc.hints.forEach(x => L.push(' - ' + x));
    }
    return L.join('\n');
  }


  /* ---------- data locator: finds WHICH part of the live data cannot be saved (read-only, no recursion) ---------- */
  // Must be the SAME call app.js saveData() makes: indenting uses more stack per level than plain JSON.stringify(v), so a plain test can pass when the real save fails.
  const tryJson = v => { try { const t = JSON.stringify(v, null, 1); return { ok: true, bytes: t === undefined ? 0 : t.length }; } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 140) }; } };
  const rle = segs => { const out = []; for (let i = 0; i < segs.length;) { let j = i; while (j + 1 < segs.length && segs[j + 1] === segs[i]) j++; out.push(j > i ? segs[i] + ' \u00d7' + (j - i + 1) : segs[i]); i = j + 1; } return out.join(''); };
  function measure(root, cap) {   // iterative: depth, object count, repeated references
    const seen = new WeakSet(); let maxDepth = 0, nodes = 0, repeats = 0; const stack = [[root, 0]];
    while (stack.length && nodes < cap) {
      const [n, d] = stack.pop(); if (d > maxDepth) maxDepth = d; nodes++;
      let keys; try { keys = Object.keys(n); } catch (e) { continue; }
      for (const k of keys) { let v; try { v = n[k]; } catch (e) { continue; } if (v && typeof v === 'object') { if (seen.has(v)) { repeats++; continue; } seen.add(v); stack.push([v, d + 1]); } }
    }
    return { maxDepth, nodes, repeats, capped: nodes >= cap };
  }
  function inspectData() {
    const data = g.data(), out = { at: new Date().toISOString(), top: [], failing: [], hints: [] };
    if (!data) { out.error = 'Portal data is not loaded yet.'; return out; }
    const nat = f => /\[native code\]/.test(Function.prototype.toString.call(f));
    out.env = { stringifyNative: nat(JSON.stringify), parseNative: nat(JSON.parse), protoToJSON: ['Object', 'Array', 'String', 'Number', 'Boolean'].filter(n => typeof globalThis[n].prototype.toJSON === 'function'), dateToJSONNative: nat(Date.prototype.toJSON) };
    out.whole = tryJson(data);
    for (const k of Object.keys(data)) {
      let v; try { v = data[k]; } catch (e) { out.top.push({ key: k, ok: false, type: 'getter', error: 'reading it threw: ' + e.message }); continue; }
      const r = tryJson(v); out.top.push({ key: k, type: Array.isArray(v) ? 'array[' + v.length + ']' : v === null ? 'null' : typeof v, ...r });
    }
    out.failing = out.top.filter(x => !x.ok).map(x => x.key);
    if (out.failing.length) {
      const k = out.failing[0], segs = ['S.' + k]; let node = data[k], drill = null;
      for (let step = 0; step < 80 && !drill; step++) {
        if (!node || typeof node !== 'object') break;
        let keys; try { keys = Object.keys(node); } catch (e) { drill = { kind: 'keys() threw: ' + e.message }; break; }
        let next = null;
        for (const key of keys) {
          let v; try { v = node[key]; } catch (e) { drill = { kind: 'reading "' + key + '" threw: ' + e.message }; break; }
          if (v && typeof v === 'object' && !tryJson(v).ok) { next = [key, v]; break; }
        }
        if (drill) break;
        if (!next) {
          const kinds = keys.slice(0, 14).map(key => { const dsc = Object.getOwnPropertyDescriptor(node, key) || {}; return key + (dsc.get ? ' (getter)' : typeof node[key] === 'function' ? ' (function)' : ''); });
          drill = { kind: typeof node.toJSON === 'function' ? 'this object has its own toJSON() that never finishes' : 'this object fails by itself (a getter or toJSON)', keys: kinds };
          break;
        }
        segs.push(Array.isArray(node) ? '[' + next[0] + ']' : '.' + next[0]); node = next[1];
      }
      drill = drill || { kind: 'nesting continues deeper than 80 levels at this point' };
      drill.path = rle(segs); drill.levels = segs.length;
      if (node && typeof node === 'object') { try { drill.keysAtEnd = Object.keys(node).slice(0, 14); } catch (e) { } }
      out.drill = drill; out.measure = measure(data[k], 200000);
    }
    const H = out.hints;
    if (!out.env.stringifyNative) H.push('JSON.stringify has been replaced by a script. Saving goes through that replacement.');
    if (out.env.protoToJSON.length) H.push('A script added toJSON to ' + out.env.protoToJSON.join(', ') + '.prototype, which runs on every value of that type.');
    if (!out.whole.ok && !out.failing.length) H.push('Every top-level part converts on its own but the whole does not. The problem is on the data root itself (a getter or toJSON on it).');
    if (out.failing.length) H.push('The part that cannot be saved is: ' + out.failing.map(k => 'S.' + k).join(', ') + '.');
    if (out.measure && out.measure.maxDepth > 200) H.push('It is nested ' + (out.measure.capped ? 'more than ' : '') + out.measure.maxDepth + ' levels deep. Real data here is under 10 levels, so this is a loop in code that keeps wrapping a value inside itself, not your records.');
    if (out.whole.ok) H.push('Right now the data converts to JSON without a problem (' + kb(out.whole.bytes) + '). If a save still fails, press Refresh in section 2 and send that report.');
    return out;
  }
  // Depth-limited clone. Iterative, drops functions/getters, breaks loops. Used only on the part that cannot be saved.
  function safeClone(root, maxDepth) {
    let cut = 0; const out = Array.isArray(root) ? [] : {}; const stack = [{ src: root, dst: out, d: 0, up: null }];
    while (stack.length) {
      const f = stack.pop(); let keys; try { keys = Object.keys(f.src); } catch (e) { cut++; continue; }
      for (const k of keys) {
        let v; try { v = f.src[k]; } catch (e) { cut++; continue; }
        const t = typeof v; if (t === 'function' || t === 'symbol' || t === 'undefined') continue;
        if (v === null || t !== 'object') { f.dst[k] = v; continue; }
        if (v instanceof Date) { f.dst[k] = isNaN(v) ? null : v.toISOString(); continue; }
        let loop = false; for (let a = f, i = 0; a && i < maxDepth + 2; a = a.up, i++) if (a.src === v) { loop = true; break; }
        if (loop || f.d + 1 > maxDepth) { cut++; f.dst[k] = null; continue; }
        const child = Array.isArray(v) ? [] : {}; f.dst[k] = child; stack.push({ src: v, dst: child, d: f.d + 1, up: f });
      }
    }
    return { value: out, cut };
  }
  function repairData(maxDepth = 40) {
    const data = g.data(); if (!data) throw new Error('Portal data is not loaded');
    const info = inspectData(); if (!info.failing.length) return { changed: [], note: 'Nothing needed repair.' };
    const changed = [];
    for (const k of info.failing) {
      const r = safeClone(data[k], maxDepth); const chk = tryJson(r.value); if (!chk.ok) throw new Error('Could not repair S.' + k + ': ' + chk.error);
      Object.defineProperty(data, k, { value: r.value, writable: true, enumerable: true, configurable: true }); changed.push({ key: k, cut: r.cut });
    }
    const all = tryJson(data); if (!all.ok) throw new Error('Data still cannot be saved after repair: ' + all.error);
    return { changed, bytes: all.bytes };
  }

  /* ---------- UI (DOM APIs + textContent only) ---------- */
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    if (props) for (const k in props) { if (k === 'style') e.style.cssText = props[k]; else if (k === 'class') e.className = props[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]); else e.setAttribute(k, props[k]); }
    kids.flat().forEach(c => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  };
  const COL = { ok: '#2ecc8f', warn: '#f5b942', fail: '#ff6b6b', skip: '#7d8aa8' }, ICO = { ok: '\u2713', warn: '!', fail: '\u2717', skip: '\u2013' };
  let modal = null, els = {}, lastSelf = null, lastDiag = null;

  const row = r => h('div', { style: 'display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #243049;font-size:13px' },
    h('span', { style: 'width:18px;font-weight:700;color:' + COL[r.status] }, ICO[r.status]),
    h('div', { style: 'flex:1' }, h('div', null, r.name), r.detail ? h('div', { style: 'color:' + (r.status === 'ok' ? '#9eb0d0' : COL[r.status]) + ';font-size:12px' }, r.detail) : null),
    r.ms != null ? h('span', { style: 'color:#7d8aa8;font-size:12px' }, r.ms + ' ms') : null);

  function card(title, ...kids) { return h('div', { style: 'background:#0f1626;border:1px solid #293854;border-radius:14px;padding:16px;margin-top:14px' }, h('h3', { style: 'margin:0 0 8px;font-size:15px' }, title), kids); }

  function renderDiag(d) {
    lastDiag = d; const box = els.dg; box.replaceChildren();
    const kv = (k, v) => h('div', { style: 'display:flex;justify-content:space-between;gap:12px;padding:4px 0;font-size:13px' }, h('span', { style: 'color:#9eb0d0' }, k), h('span', null, v));
    box.append(
      kv('Portal data size', d.dataBytes != null ? kb(d.dataBytes) : '-'),
      kv('Converts to JSON', d.serialises === false ? 'NO: ' + d.serialiseError : d.serialises ? 'Yes' : '-'),
      kv('Saved file on server', d.server ? (d.server.missing ? 'Missing' : kb(d.server.size) + (d.server.matchesLoaded === false ? ' (newer than loaded copy)' : d.server.matchesLoaded ? ' (matches loaded copy)' : '')) : (d.serverError || '-')),
      kv('Sign-in time left', d.tokenMinutes != null ? d.tokenMinutes + ' min' : '-'),
      kv('Browser online', String(d.online)),
      kv('Last "Save failed" message', d.lastSaveToast ? d.lastSaveToast.msg : 'none seen'));
    if (d.hints.length) box.append(h('div', { style: 'margin-top:8px;padding:10px;border-radius:10px;background:#1b2338;border-left:3px solid #f5b942;font-size:13px' }, d.hints.map(x => h('div', { style: 'margin:3px 0' }, x))));
    box.append(h('div', { style: 'margin-top:10px;font-size:12px;color:#9eb0d0' }, 'Recent writes since this page loaded:'));
    if (!d.attempts.length) box.append(h('div', { style: 'font-size:12px;color:#7d8aa8' }, 'None yet'));
    d.attempts.slice().reverse().forEach(a => box.append(h('div', { style: 'font-size:12px;padding:3px 0;border-bottom:1px solid #1d2840;color:' + (a.ok ? '#9eb0d0' : '#ff6b6b') }, (a.ok ? '\u2713 ' : '\u2717 ') + new Date(a.at).toLocaleTimeString() + '  ' + a.path + '  ' + kb(a.size) + (a.ifMatch ? '  if-match' : '') + (a.error ? '  \u2192 ' + a.error : ''))));
  }

  async function refreshDiag() { els.dg.replaceChildren(h('div', { style: 'color:#7d8aa8;font-size:13px' }, 'Checking\u2026')); try { renderDiag(await diagnostics()); } catch (e) { els.dg.replaceChildren(h('div', { style: 'color:#ff6b6b' }, errText(e))); } }

  async function onRunSelf() {
    const btn = els.run; btn.disabled = true; btn.textContent = 'Running\u2026'; els.st.replaceChildren(); els.del.style.display = 'none';
    const rows = []; try { await selfTest(els.pass.value, r => { rows.push(r); els.st.append(row(r)); }); lastSelf = rows; }
    catch (e) { els.st.append(row({ name: 'Unexpected error', status: 'fail', detail: errText(e) })); }
    els.pass.value = ''; btn.disabled = false; btn.textContent = 'Run self-test'; els.del.style.display = 'inline-block'; refreshDiag();
  }


  function renderLoc(d) {
    lastLoc = d; const box = els.loc; box.replaceChildren();
    if (d.error) { box.append(h('div', { style: 'color:#ff6b6b' }, d.error)); return; }
    const pill = ok => h('span', { style: 'font-weight:700;color:' + (ok ? '#2ecc8f' : '#ff6b6b') }, ok ? '\u2713' : '\u2717');
    box.append(h('div', { style: 'font-size:13px;margin-bottom:6px' }, pill(d.whole.ok), ' Whole portal data ', d.whole.ok ? 'converts fine (' + kb(d.whole.bytes) + ')' : 'FAILS: ' + d.whole.error));
    d.top.forEach(x => box.append(h('div', { style: 'display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3px 0;border-bottom:1px solid #1d2840;color:' + (x.ok ? '#9eb0d0' : '#ff6b6b') }, h('span', null, (x.ok ? '\u2713 ' : '\u2717 ') + 'S.' + x.key + '  (' + x.type + ')'), h('span', null, x.ok ? kb(x.bytes) : x.error))));
    if (d.drill) {
      box.append(h('div', { style: 'margin-top:10px;padding:10px;border-radius:10px;background:#1b2338;border-left:3px solid #ff6b6b;font-size:13px' },
        h('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Where it fails'),
        h('div', { style: 'font-family:Consolas,monospace;word-break:break-all;color:#ffb3b3' }, d.drill.path),
        h('div', { style: 'margin-top:4px' }, d.drill.kind),
        d.drill.keysAtEnd ? h('div', { style: 'margin-top:4px;color:#9eb0d0;font-size:12px' }, 'Fields at that point: ' + d.drill.keysAtEnd.join(', ')) : null,
        d.drill.keys ? h('div', { style: 'margin-top:4px;color:#9eb0d0;font-size:12px' }, 'Fields: ' + d.drill.keys.join(', ')) : null,
        d.measure ? h('div', { style: 'margin-top:4px;color:#9eb0d0;font-size:12px' }, 'Depth ' + (d.measure.capped ? 'over ' : '') + d.measure.maxDepth + ' levels, ' + d.measure.nodes + ' objects' + (d.measure.repeats ? ', ' + d.measure.repeats + ' repeated references' : '')) : null));
    }
    if (d.hints.length) box.append(h('div', { style: 'margin-top:8px;padding:10px;border-radius:10px;background:#1b2338;border-left:3px solid #f5b942;font-size:13px' }, d.hints.map(x => h('div', { style: 'margin:3px 0' }, x))));
    box.append(h('div', { style: 'margin-top:8px;font-size:12px;color:#9eb0d0' }, 'Press "Copy report" to include this in the report.'));
  }
  async function onRepair() {
    let info; try { info = inspectData(); renderLoc(info); } catch (e) { els.loc.replaceChildren(h('div', { style: 'color:#ff6b6b' }, errText(e))); return; }
    if (!info.failing.length) { els.loc.append(h('div', { style: 'margin-top:8px;color:#2ecc8f;font-size:13px' }, 'Nothing to trim: all of your data converts to JSON right now.')); return; }
    if (!confirm('Replace ' + info.failing.map(k => 'S.' + k).join(', ') + ' with a copy cut off at 40 levels deep, then save?\n\nYour last good saved file and today\'s backup are not changed. Cancel to leave everything as it is.')) return;
    try {
      const r = repairData(40); els.loc.append(h('div', { style: 'margin-top:8px;font-size:13px;color:#2ecc8f' }, 'Trimmed: ' + r.changed.map(c => 'S.' + c.key + ' (' + c.cut + ' deep or looping value(s) removed)').join(', ') + '. Saving\u2026'));
      if (typeof saveData !== 'function') throw new Error('Save function not found');
      await saveData();
      const state = (document.getElementById('syncState') || {}).textContent || '';
      els.loc.append(h('div', { style: 'margin-top:6px;font-size:13px;color:' + (/failed/i.test(state) ? '#ff6b6b' : '#2ecc8f') }, 'Save result: ' + state));
      refreshDiag();
    } catch (e) { els.loc.append(h('div', { style: 'margin-top:8px;font-size:13px;color:#ff6b6b' }, 'Repair stopped: ' + errText(e))); }
  }

  function build() {
    els.pass = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Throwaway test passphrase, 12+ characters', style: 'width:100%;margin:8px 0' });
    els.run = h('button', { class: 'btn primary', onclick: onRunSelf }, 'Run self-test');
    els.st = h('div', { style: 'margin-top:10px' });
    els.del = h('button', { class: 'btn', style: 'display:none;margin-top:10px', onclick: async () => { try { const r = await deleteTestFiles(); els.st.append(row({ name: 'Test files removed', status: 'ok', detail: 'selftest.enc: ' + r.test + ', large test file: ' + r.large })); } catch (e) { els.st.append(row({ name: 'Could not remove test files', status: 'fail', detail: errText(e) })); } } }, 'Delete test files');
    els.dg = h('div');
    els.lg = h('div', { style: 'margin-top:8px;font-size:13px' });
    const largeBtn = h('button', { class: 'btn', onclick: async () => { largeBtn.disabled = true; els.lg.textContent = 'Uploading 3.6 MB test file\u2026'; try { const r = await largeTest(); els.lg.textContent = 'Large upload OK in ' + r.ms + ' ms' + (r.removed ? ' (test file removed).' : '.'); els.lg.style.color = '#2ecc8f'; } catch (e) { els.lg.textContent = 'Large upload FAILED: ' + errText(e) + (explain(e.message) ? '. ' + explain(e.message) : ''); els.lg.style.color = '#ff6b6b'; } largeBtn.disabled = false; refreshDiag(); } }, 'Test large upload');
    const copyBtn = h('button', { class: 'btn', onclick: async () => { const t = reportText(lastSelf, lastDiag); try { await navigator.clipboard.writeText(t); copyBtn.textContent = 'Copied'; } catch (e) { els.rep.value = t; els.rep.style.display = 'block'; els.rep.select(); copyBtn.textContent = 'Select and copy below'; } setTimeout(() => copyBtn.textContent = 'Copy report', 2500); } }, 'Copy report');
    els.loc = h('div', { style: 'margin-top:10px' });
    const locBtn = h('button', { class: 'btn primary', onclick: () => { try { renderLoc(inspectData()); } catch (e) { els.loc.replaceChildren(h('div', { style: 'color:#ff6b6b' }, errText(e))); } } }, 'Find the cause');
    const fixBtn = h('button', { class: 'btn', onclick: onRepair }, 'Trim runaway data and save');
    els.rep = h('textarea', { readonly: 'readonly', style: 'display:none;width:100%;height:150px;margin-top:8px;font-size:12px' });

    return h('section', { style: 'width:min(760px,100%);margin:5vh auto;background:#151c2e;color:#eef3ff;border:1px solid #33415f;border-radius:20px;padding:24px;box-shadow:0 32px 80px #0008' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:flex-start' },
        h('div', null, h('h2', { style: 'margin:0 0 6px' }, 'Security Vault'), h('div', { style: 'color:#aab7d1;font-size:13px' }, 'Alpha 4 \u00b7 self-test, save diagnostics and data locator. Your portal data is not read or changed by anything on this page.')),
        h('button', { class: 'btn', onclick: () => modal.style.display = 'none' }, 'Close')),
      card('1. Encrypted storage self-test',
        h('div', { style: 'color:#9eb0d0;font-size:13px' }, 'Writes one tiny encrypted test file, reads it back, decrypts it, checks that a wrong passphrase fails, and checks the version protection used when saving. Use a throwaway passphrase; nothing about it is stored.'),
        els.pass, els.run, els.st, els.del),
      card('2. Save diagnostics',
        h('div', { style: 'color:#9eb0d0;font-size:13px;margin-bottom:8px' }, 'Explains a "Save failed". Make a small change in the portal first (for example edit a bill note), then press Refresh.'),
        els.dg, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' }, h('button', { class: 'btn primary', onclick: refreshDiag }, 'Refresh'), largeBtn, copyBtn), els.lg, els.rep),
      card('3. Find the cause of "Maximum call stack size exceeded"',
        h('div', { style: 'color:#9eb0d0;font-size:13px' }, 'Read-only. Tests each part of your data on its own to find the one that cannot be saved, and shows exactly where it is. Nothing is changed by "Find the cause".'),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, locBtn, fixBtn), els.loc,
        h('div', { style: 'margin-top:8px;font-size:12px;color:#7d8aa8' }, '"Trim runaway data and save" replaces only the failing part with a copy cut off at 40 levels deep, then saves. Your last good saved file and today\'s backup are not touched. Use it only after "Find the cause" names a part that fails.')),
      h('div', { style: 'margin-top:14px;font-size:12px;color:#f4c46e' }, 'Do not delete portal-data.json or its backups. Vault migration is not part of Alpha 4.'));
  }

  function openPanel() {
    if (!modal) { modal = h('div', { style: 'position:fixed;inset:0;z-index:100000;background:rgba(3,7,18,.88);overflow:auto;padding:16px;display:none' }); modal.append(build()); document.body.append(modal); modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; }); document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.style.display = 'none'; }); }
    modal.style.display = 'block'; refreshDiag();
  }

  function install() {
    instrument();
    if (document.getElementById('v7open')) return true;
    const host = document.querySelector('nav .nav, nav, aside, .sidebar, .side'); if (!host) return false;
    const b = h('button', { id: 'v7open', type: 'button', class: 'sub', style: 'width:100%;text-align:left;margin-top:8px;color:#bfcaf0', onclick: openPanel }, '\uD83D\uDD10 Security Vault');
    const sync = host.querySelector('.sync'); if (sync) host.insertBefore(b, sync); else host.append(b);
    return true;
  }

  const api = { version: VER, open: () => openPanel(), selfTest, diagnostics, largeTest, deleteTestFiles, seal, open_: open, reportText, inspectData, repairData, safeClone };
  if (typeof window !== 'undefined') window.PortalVaultV7 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { ...api, instrument, _setLoc: x => { lastLoc = x; }, _attempts: attempts, b64, unb64, rand, explain };
  if (typeof document !== 'undefined') {
    let tries = 0; const t = setInterval(() => { if (install() || ++tries > 40) clearInterval(t); }, 500);
    if (document.readyState !== 'loading') install(); else document.addEventListener('DOMContentLoaded', install, { once: true });
  }
})();
