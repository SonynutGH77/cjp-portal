/* Property Portal v7.0 Beta 2 - Encrypted load and save + "Remember on this device"
   WHAT IT DOES
   - Sits between the portal and private storage. app.js is NOT changed.
   - Once you have encrypted your data, portal-data.json and the daily backups in Portal/data/backups are stored as
     AES-256-GCM ciphertext (key from your passphrase via PBKDF2-HMAC-SHA-256, 600,000 iterations, per-file random salt, fresh IV every save).
   - Reads: an encrypted file is decrypted in the browser. Writes: while the vault is on, nothing readable can be written to
     portal-data.json or the backups folder (it is encrypted first).
   - Until you press "Encrypt my data" in Encryption vault, the portal behaves exactly as before.
   - The passphrase is never stored or sent anywhere.
   - NEW in Beta 2: optional "Remember on this device" (per device, off by default). If you choose it, the derived key (not the passphrase)
     is kept in this browser's IndexedDB as a NON-EXTRACTABLE CryptoKey for 1, 7 or 30 days, so reloads on this device unlock without typing.
     It is removed by Forget this device, Lock now, the Sign out button, expiry, or clearing the browser's site data.
   - Data format is unchanged from Beta 1, so data you already encrypted opens with the same passphrase.
   Reads portal state through the app's own globals (Cloud, P_DATA, P_BACKUP, etag, lastText, saveData) - bare identifiers, not window properties. */
(() => {
  'use strict';
  const VER = '7.0-beta2';
  const FORMAT = 'cjp-portal-vault', AAD = 'cjp-portal-vault/1';
  const ITER = 600000, ITER_MIN = 100000, ITER_MAX = 2000000, MIN_PASS = 12;
  const PLAIN_DIR = 'Portal/vault-v7/plain-backup';
  const DAY = 86400000, REMEMBER_DAYS = [1, 7, 30];
  const te = new TextEncoder(), td = new TextDecoder();

  /* ---------- helpers (chunked so large buffers cannot overflow the call stack) ---------- */
  const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
  const errText = e => (e && e.conflict) ? 'The file changed on the server while this was running (412 conflict)' : String((e && e.message) || e).slice(0, 300);
  const kb = n => n == null ? '-' : n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
  const tell = t => { try { if (typeof toast === 'function') toast(t); } catch (e) { } };

  /* ---------- access to the app's globals (never throws) ---------- */
  const G = {
    cloud: () => { try { return typeof Cloud !== 'undefined' ? Cloud : null; } catch (e) { return null; } },
    pData: () => { try { return typeof P_DATA !== 'undefined' ? P_DATA : 'Portal/data/portal-data.json'; } catch (e) { return 'Portal/data/portal-data.json'; } },
    pBackup: () => { try { return typeof P_BACKUP !== 'undefined' ? P_BACKUP : 'Portal/data/backups'; } catch (e) { return 'Portal/data/backups'; } },
    syncText: () => { try { return typeof document !== 'undefined' ? ((document.getElementById('syncState') || {}).textContent || '') : ''; } catch (e) { return ''; } }
  };
  // After we change the stored file, tell the app the new version so its next save is not treated as a conflict.
  function setApp(tag, text) {
    try { if (typeof etag !== 'undefined') etag = tag; } catch (e) { }
    try { if (typeof lastText !== 'undefined') lastText = text; } catch (e) { }
  }
  const isProtected = p => { p = String(p || ''); return p === G.pData() || p.startsWith(G.pBackup() + '/'); };
  const isEnvelope = t => typeof t === 'string' && t.slice(0, 64).trimStart().startsWith('{"format":"' + FORMAT + '"');

  /* ---------- state ---------- */
  const V = { enabled: false, cache: null, unlocking: null, orig: null, patched: false };

  /* ---------- crypto ---------- */
  async function pipe(stream, bytes) {
    const out = new Response(stream.readable).arrayBuffer();   // start reading first so a large write cannot stall
    const w = stream.writable.getWriter(); await w.write(bytes); await w.close();
    return new Uint8Array(await out);
  }
  async function deriveKey(pass, salt, iter) {
    const m = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, m, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);   // extractable:false
  }
  async function seal(key, saltB64, iter, text) {
    let bytes = te.encode(text), comp = 'none';
    if (typeof CompressionStream !== 'undefined') { try { bytes = await pipe(new CompressionStream('gzip'), bytes); comp = 'gzip'; } catch (e) { bytes = te.encode(text); comp = 'none'; } }
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(AAD), tagLength: 128 }, key, bytes);
    return JSON.stringify({ format: FORMAT, v: 1, alg: 'AES-256-GCM', kdf: { name: 'PBKDF2-HMAC-SHA-256', iterations: iter, salt: saltB64 }, comp, iv: b64(iv), ct: b64(ct) });
  }
  function parseBox(text) {
    let b; try { b = JSON.parse(text); } catch (e) { throw new Error('The encrypted file is damaged (not valid JSON).'); }
    const it = b && b.kdf && b.kdf.iterations;
    if (!b || b.format !== FORMAT || b.v !== 1 || b.alg !== 'AES-256-GCM' || !b.kdf || b.kdf.name !== 'PBKDF2-HMAC-SHA-256' || !Number.isInteger(it) || it < ITER_MIN || it > ITER_MAX ||
      typeof b.kdf.salt !== 'string' || typeof b.iv !== 'string' || typeof b.ct !== 'string' || !['gzip', 'none'].includes(b.comp)) throw new Error('This encrypted file uses a format this version does not understand.');
    return b;
  }
  async function openWith(key, box) {
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: te.encode(AAD), tagLength: 128 }, key, unb64(box.ct)));
    const bytes = box.comp === 'gzip' ? await pipe(new DecompressionStream('gzip'), pt) : pt;
    return td.decode(bytes);
  }

  /* ---------- remember on this device: non-extractable key in IndexedDB (never the passphrase) ---------- */
  const DB_NAME = 'cjp-portal-vault', DB_STORE = 'device-key', DB_KEY = 'unlock';
  const idb = {
    open() {
      return new Promise((res, rej) => {
        if (typeof indexedDB === 'undefined' || !indexedDB) return rej(new Error('This browser does not allow the key to be kept on the device (private browsing or storage blocked).'));
        let r; try { r = indexedDB.open(DB_NAME, 1); } catch (e) { return rej(e); }
        r.onupgradeneeded = () => { try { r.result.createObjectStore(DB_STORE); } catch (e) { } };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error || new Error('Could not open device storage.'));
        r.onblocked = () => rej(new Error('Device storage is busy. Close other portal tabs and try again.'));
      });
    },
    async run(mode, fn) {
      const db = await idb.open();
      try {
        return await new Promise((res, rej) => {
          const tx = db.transaction(DB_STORE, mode), rq = fn(tx.objectStore(DB_STORE));
          tx.oncomplete = () => res(rq && rq.result);
          tx.onerror = tx.onabort = () => rej(tx.error || new Error('Device storage failed.'));
        });
      } finally { try { db.close(); } catch (e) { } }
    },
    get: () => idb.run('readonly', s => s.get(DB_KEY)),
    put: v => idb.run('readwrite', s => s.put(v, DB_KEY)),
    del: () => idb.run('readwrite', s => s.delete(DB_KEY))
  };
  // The remembered record, or null if there is none, it has expired, or it is unusable (expired/invalid ones are removed).
  async function deviceRecord() {
    let r; try { r = await idb.get(); } catch (e) { return null; }
    if (!r) return null;
    if (r.v !== 1 || !r.key || typeof r.salt !== 'string' || !Number.isInteger(r.iter) || !(r.expires > Date.now())) { try { await idb.del(); } catch (e) { } return null; }
    return r;
  }
  async function rememberKey(days) {
    const c = V.cache; if (!c) throw new Error('Unlock the portal first, then choose Remember this device.');
    days = Number(days); if (!REMEMBER_DAYS.includes(days)) throw new Error('Choose 1, 7 or 30 days.');
    if (c.key.extractable) throw new Error('Refusing to store a key that is not locked down.');
    const rec = { v: 1, key: c.key, salt: c.salt, iter: c.iter, savedAt: Date.now(), expires: Date.now() + days * DAY, days };
    await idb.put(rec); return rec;
  }
  async function forgetDevice() { await idb.del(); }

  /* ---------- unlock (shared, so two simultaneous reads show one prompt) ---------- */
  const INTEGRITY = 'The encrypted file failed its integrity check. It was changed or damaged outside the portal. Nothing was overwritten.';
  async function decryptText(text) {
    const box = parseBox(text), c = V.cache;
    if (c && c.salt === box.kdf.salt && c.iter === box.kdf.iterations) {
      try { return await openWith(c.key, box); }
      catch (e) { throw new Error(INTEGRITY); }
    }
    if (V.unlocking) { try { await V.unlocking; } catch (e) { } return decryptText(text); }
    V.unlocking = (async () => {
      // 1. a key remembered on this device (only if it belongs to this file and has not expired)
      const rec = await deviceRecord();
      if (rec) {
        if (rec.salt === box.kdf.salt && rec.iter === box.kdf.iterations) {
          let plain; try { plain = await openWith(rec.key, box); } catch (e) { throw new Error(INTEGRITY); }
          V.cache = { key: rec.key, salt: rec.salt, iter: rec.iter }; return plain;
        }
        try { await idb.del(); } catch (e) { }   // belongs to a different encryption of the data: useless now
      }
      // 2. ask for the passphrase
      let msg = '';
      for (; ;) {
        const pass = await ui.askUnlock(msg);
        if (pass == null) throw new Error('Portal data is locked. Reload the page and enter your passphrase to continue.');
        ui.busy();
        let key, plain;
        try { key = await deriveKey(pass, unb64(box.kdf.salt), box.kdf.iterations); plain = await openWith(key, box); }
        catch (e) { msg = 'That passphrase did not unlock the data. Check it in your password manager and try again.'; continue; }
        V.cache = { key, salt: box.kdf.salt, iter: box.kdf.iterations };
        if (ui.remDays) { try { await rememberKey(ui.remDays); } catch (e) { tell('Unlocked, but this device could not be remembered: ' + errText(e)); } }
        return plain;
      }
    })();
    try { return await V.unlocking; } finally { V.unlocking = null; ui.done(); }
  }

  /* ---------- attach to private storage (every read and write goes through these) ---------- */
  function patch() {
    const C = G.cloud();
    if (V.patched) return true;
    if (!C || typeof C.put !== 'function' || typeof C.read !== 'function') return false;
    V.orig = { read: C.read, put: C.put, getBlob: C.getBlob };
    C.read = async function (p) {
      const r = await V.orig.read.call(this, p);
      if (r && isEnvelope(r.text)) { if (isProtected(p)) V.enabled = true; /* from here on nothing readable may be written, even if unlock is cancelled */ return { ...r, text: await decryptText(r.text) }; }
      return r;
    };
    // Single choke point for all writes (writeText and writeBlob both end here), so no other script can write readable data into a protected path.
    const wrappedPut = async function (p, b, tag) {
      if (V.enabled && isProtected(p) && b && typeof b.text === 'function') {
        const txt = await b.text();
        if (!isEnvelope(txt)) {
          const c = V.cache; if (!c) throw new Error('The vault is locked. Reload the portal and enter your passphrase before saving.');
          b = new Blob([await seal(c.key, c.salt, c.iter, txt)], { type: 'application/json' });
        }
      }
      return V.orig.put.call(this, p, b, tag);
    };
    wrappedPut.__diag = true;   // tells the Alpha 4 diagnostics hook not to wrap this a second time
    C.put = wrappedPut;
    if (typeof V.orig.getBlob === 'function') {
      C.getBlob = async function (p) {
        const b = await V.orig.getBlob.call(this, p);
        if (isProtected(p)) { const t = await b.text(); if (isEnvelope(t)) return new Blob([await decryptText(t)], { type: 'application/json' }); }
        return b;
      };
    }
    V.patched = true; return true;
  }

  /* ---------- migration: encrypt the real data (nothing is deleted) ---------- */
  async function encryptNow(pass, step) {
    const C = G.cloud(); if (!C || !V.patched) throw new Error('Not connected to private storage. Sign in first.');
    if (V.enabled) throw new Error('Your data is already encrypted.');
    if (String(pass || '').length < MIN_PASS) throw new Error('Use a passphrase of at least ' + MIN_PASS + ' characters.');
    const path = G.pData(), O = V.orig;

    step('Saving any change still waiting', 'run');
    if (typeof saveData === 'function') { await saveData(); if (/failed/i.test(G.syncText())) throw new Error('The portal could not save its current data. Fix that first (nothing was changed).'); }
    step('Saving any change still waiting', 'ok');

    step('Reading your current data file', 'run');
    const r = await O.read.call(C, path);
    if (!r) throw new Error('No portal data file found to encrypt.');
    if (isEnvelope(r.text)) { V.enabled = true; throw new Error('The saved file is already encrypted. Reload the portal to unlock it.'); }
    let parsed; try { parsed = JSON.parse(r.text); } catch (e) { throw new Error('The current data file is not valid JSON, so it was not touched.'); }
    step('Reading your current data file', 'ok', kb(r.text.length) + ' \u00b7 ' + ((parsed.properties || []).length) + ' properties, ' + ((parsed.transactions || []).length) + ' transactions');

    step('Writing a safety copy (unencrypted) and checking it', 'run');
    const safety = PLAIN_DIR + '/portal-data.before-encryption.' + stamp() + '.json';
    await O.put.call(C, safety, new Blob([r.text], { type: 'application/json' }));
    const sb = await O.read.call(C, safety);
    if (!sb || sb.text !== r.text) throw new Error('The safety copy did not read back identically, so nothing was encrypted.');
    step('Writing a safety copy (unencrypted) and checking it', 'ok', safety);

    step('Deriving the key (600,000 iterations) and encrypting', 'run');
    const salt = b64(rand(16)), key = await deriveKey(pass, unb64(salt), ITER), env = await seal(key, salt, ITER, r.text);
    step('Deriving the key (600,000 iterations) and encrypting', 'ok', kb(env.length) + ' of ciphertext' + (env.length > 3.5e6 ? ' (over 3.5 MB: SharePoint skips the two-device version check above this size)' : ''));

    step('Saving the encrypted file over portal-data.json', 'run');
    const tag = await O.put.call(C, path, new Blob([env], { type: 'application/json' }), r.etag);
    step('Saving the encrypted file over portal-data.json', 'ok');

    step('Reading it back and decrypting to confirm', 'run');
    let rb = null, same = false;
    try { rb = await O.read.call(C, path); same = !!rb && rb.text === env && (await openWith(key, parseBox(rb.text))) === r.text; } catch (e) { same = false; }
    if (!same) {
      try { await O.put.call(C, path, new Blob([r.text], { type: 'application/json' }), (rb && rb.etag) || tag); } catch (e) { }
      throw new Error('The encrypted file did not read back and decrypt to exactly your data, so your original file was put back. Nothing is lost.');
    }
    V.cache = { key, salt, iter: ITER }; V.enabled = true; setApp(rb.etag, r.text);
    step('Reading it back and decrypting to confirm', 'ok', 'identical to your original');

    try { if (typeof log === 'function') log('Data encryption turned on', 'Portal data is now stored encrypted (AES-256-GCM)', { actor: 'portal' }); if (typeof save === 'function') save(); } catch (e) { }
    return { safety, bytes: env.length };
  }

  /* ---------- encrypt existing backups in place ---------- */
  async function listBackups() {
    const C = G.cloud(); if (!C) throw new Error('Not connected');
    const dir = G.pBackup(), out = [];
    for (const f of await C.list(dir)) if (!f.dir && /\.json$/i.test(f.name)) out.push({ name: f.name, path: dir + '/' + f.name, size: f.size });
    return out;
  }
  async function checkBackups() {
    const C = G.cloud(), O = V.orig, list = await listBackups(); let plain = 0, enc = 0, bad = 0;
    for (const f of list) { try { const r = await O.read.call(C, f.path); if (!r) continue; if (isEnvelope(r.text)) enc++; else { JSON.parse(r.text); plain++; } } catch (e) { bad++; } }
    return { total: list.length, plain, enc, bad };
  }
  async function encryptBackups(step) {
    const C = G.cloud(), O = V.orig, c = V.cache;
    if (!V.enabled || !c) throw new Error('Turn on encryption first (and unlock).');
    let done = 0, skipped = 0, failed = 0;
    for (const f of await listBackups()) {
      try {
        const r = await O.read.call(C, f.path); if (!r) continue;
        if (isEnvelope(r.text)) { skipped++; continue; }
        JSON.parse(r.text);
        const env = await seal(c.key, c.salt, c.iter, r.text);
        await O.put.call(C, f.path, new Blob([env], { type: 'application/json' }), r.etag);
        const rb = await O.read.call(C, f.path);
        if (!rb || (await openWith(c.key, parseBox(rb.text))) !== r.text) { await O.put.call(C, f.path, new Blob([r.text], { type: 'application/json' }), rb && rb.etag); throw new Error('read-back mismatch'); }
        done++; if (step) step(f.name, 'ok', 'encrypted');
      } catch (e) { failed++; if (step) step(f.name, 'fail', errText(e)); }
    }
    return { done, skipped, failed };
  }

  /* ---------- check the saved file / delete the unencrypted safety copies ---------- */
  async function checkSaved() {
    const C = G.cloud(), O = V.orig, r = await O.read.call(C, G.pData());
    if (!r) return { missing: true };
    const out = { size: r.text.length, encrypted: isEnvelope(r.text), preview: r.text.slice(0, 150) };
    if (out.encrypted) {
      const box = parseBox(r.text); out.kdf = box.kdf.name + ', ' + box.kdf.iterations.toLocaleString('en-AU') + ' iterations'; out.comp = box.comp;
      if (V.cache && V.cache.salt === box.kdf.salt) { try { const d = JSON.parse(await openWith(V.cache.key, box)); out.counts = { properties: (d.properties || []).length, bills: (d.bills || []).length, transactions: (d.transactions || []).length, mortgage: (d.mortgage || []).length }; } catch (e) { out.decryptError = errText(e); } }
    }
    return out;
  }
  async function plainCopies() { const C = G.cloud(); if (!C) throw new Error('Not connected'); return (await C.list(PLAIN_DIR)).filter(f => !f.dir); }
  async function deletePlainCopies() {
    const C = G.cloud(); if (!V.enabled) throw new Error('Do not delete the safety copy until your data is encrypted and you have unlocked it on every device.');
    let n = 0; for (const f of await plainCopies()) { if (await C.remove(PLAIN_DIR + '/' + f.name)) n++; } return n;
  }

  /* ---------- UI (DOM APIs + textContent only) ---------- */
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    if (props) for (const k in props) { if (k === 'style') e.style.cssText = props[k]; else if (k === 'class') e.className = props[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]); else e.setAttribute(k, props[k]); }
    kids.flat().forEach(c => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  };
  const COL = { ok: '#2ecc8f', warn: '#f5b942', fail: '#ff6b6b', run: '#7aa7ff', skip: '#7d8aa8' }, ICO = { ok: '\u2713', warn: '!', fail: '\u2717', run: '\u2026', skip: '\u2013' };
  const INPUT = 'width:100%;margin:6px 0;padding:11px 12px;border-radius:10px;border:1px solid #33415f;background:#0b1020;color:#eef3ff;font-size:15px;box-sizing:border-box';
  const SELECT = 'padding:8px 10px;border-radius:10px;border:1px solid #33415f;background:#0b1020;color:#eef3ff;font-size:14px';
  const dayOpts = () => [h('option', { value: '1' }, '1 day'), h('option', { value: '7', selected: 'selected' }, '7 days'), h('option', { value: '30' }, '30 days')];

  /* unlock overlay (also used after every reload when the device is not remembered) */
  const ui = {
    ov: null, inp: null, err: null, go: null, resolve: null, rem: null, remSel: null, remDays: 0,
    build() {
      this.inp = h('input', { type: 'password', name: 'vault-passphrase', autocomplete: 'current-password', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'Passphrase', style: INPUT });
      this.err = h('div', { style: 'color:#ff8a8a;font-size:13px;min-height:18px;margin:4px 0' });
      const show = h('input', { type: 'checkbox', onchange: () => { this.inp.type = show.checked ? 'text' : 'password'; } });
      this.rem = h('input', { type: 'checkbox', onchange: () => { this.remSel.disabled = !this.rem.checked; } });
      this.remSel = h('select', { style: SELECT, disabled: 'disabled' }, dayOpts());
      this.go = h('button', { class: 'btn primary', type: 'submit', style: 'min-width:110px' }, 'Unlock');
      const cancel = h('button', { class: 'btn', type: 'button', onclick: () => this.finish(null) }, 'Cancel');
      const form = h('form', { onsubmit: ev => { ev.preventDefault(); this.finish(this.inp.value); } },
        h('div', { style: 'font-size:20px;font-weight:700;margin-bottom:6px' }, '\uD83D\uDD12 Unlock your portal data'),
        h('div', { style: 'color:#aab7d1;font-size:13px;margin-bottom:10px' }, 'Your data is encrypted. Enter the passphrase (paste it from your password manager). It is checked in this browser only and is never sent or stored.'),
        this.inp, h('label', { style: 'display:flex;gap:8px;align-items:center;font-size:13px;color:#9eb0d0;margin:4px 0' }, show, 'Show passphrase'),
        h('div', { style: 'margin:8px 0 2px;padding:10px;border-radius:10px;background:#1b2338;font-size:13px;color:#cdd8f2' },
          h('label', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, this.rem, 'Remember on this device for', this.remSel),
          h('div', { style: 'color:#9eb0d0;font-size:12px;margin-top:6px' }, 'Only on a phone or PC you trust that has a screen lock. Other devices are not affected.')),
        this.err,
        h('div', { style: 'display:flex;gap:10px;justify-content:flex-end;margin-top:8px' }, cancel, this.go));
      this.ov = h('div', { style: 'position:fixed;inset:0;z-index:2147483000;background:#060a16;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto' },
        h('div', { style: 'width:min(440px,100%);background:#151c2e;color:#eef3ff;border:1px solid #33415f;border-radius:20px;padding:24px;box-shadow:0 32px 80px #0008' }, form));
      document.body.append(this.ov);
    },
    askUnlock(msg) {
      if (typeof document === 'undefined') return Promise.resolve(null);
      if (!this.ov) this.build();
      this.remDays = 0;
      this.ov.style.display = 'flex'; this.err.textContent = msg || ''; this.go.disabled = false; this.go.textContent = 'Unlock'; this.inp.value = '';
      setTimeout(() => { try { this.inp.focus(); } catch (e) { } }, 50);
      return new Promise(res => { this.resolve = res; });
    },
    finish(v) {
      const r = this.resolve; this.resolve = null;
      if (v === '') { this.err.textContent = 'Enter your passphrase.'; this.resolve = r; return; }
      this.remDays = (v != null && this.rem && this.rem.checked) ? (Number(this.remSel.value) || 0) : 0;
      if (this.inp) this.inp.value = ''; if (r) r(v);
    },
    busy() { if (this.go) { this.go.disabled = true; this.go.textContent = 'Checking\u2026'; } },
    done() { if (this.ov) this.ov.style.display = 'none'; }
  };

  const row = r => h('div', { style: 'display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #243049;font-size:13px' },
    h('span', { style: 'width:18px;font-weight:700;color:' + COL[r.status] }, ICO[r.status]),
    h('div', { style: 'flex:1;word-break:break-word' }, h('div', null, r.name), r.detail ? h('div', { style: 'color:' + (r.status === 'ok' ? '#9eb0d0' : COL[r.status]) + ';font-size:12px' }, r.detail) : null));
  const card = (title, ...kids) => h('div', { style: 'background:#0f1626;border:1px solid #293854;border-radius:14px;padding:16px;margin-top:14px' }, h('h3', { style: 'margin:0 0 8px;font-size:15px' }, title), kids);
  const note = (t, c) => h('div', { style: 'margin-top:8px;padding:10px;border-radius:10px;background:#1b2338;border-left:3px solid ' + (c || '#f5b942') + ';font-size:13px' }, t);
  const muted = t => h('div', { style: 'color:#9eb0d0;font-size:13px;margin-bottom:8px' }, t);

  let modal = null, els = {};
  function status() {
    if (!V.patched) return { k: 'fail', t: 'The encryption layer could not attach to private storage. Reload the page.' };
    if (V.enabled && V.cache) return { k: 'ok', t: 'Encryption is ON and this tab is unlocked. The key is held in memory until you reload or close the tab, unless this device is remembered (below).' };
    if (V.enabled) return { k: 'warn', t: 'Encryption is ON but this tab is locked. Reload and enter the passphrase.' };
    return { k: 'warn', t: 'Encryption is OFF. Your data file in SharePoint is still readable text. Use section 1 to encrypt it.' };
  }
  function paintStatus() { const s = status(); els.status.replaceChildren(row({ name: s.t, status: s.k })); els.enc.style.display = V.enabled ? 'none' : 'block'; els.ver.style.display = V.enabled ? 'block' : 'none'; }
  const fdtime = ms => new Date(ms).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  async function paintDevice() {
    if (!els.devMsg) return;
    const rec = await deviceRecord();
    if (rec) els.devMsg.replaceChildren(row({ name: 'This device is remembered until ' + fdtime(rec.expires), status: 'ok', detail: 'The portal opens here without asking for the passphrase until then. Other devices are not affected.' }));
    else els.devMsg.replaceChildren(row({ name: V.enabled ? 'This device is not remembered. You are asked for the passphrase every time the portal loads.' : 'Encrypt your data first (section 1), then you can remember this device.', status: 'warn' }));
    els.devSel.style.display = els.devOn.style.display = rec ? 'none' : '';
    els.devOff.style.display = rec ? '' : 'none';
    els.devOn.disabled = !(V.enabled && V.cache);
  }
  async function onRemember() {
    els.devOn.disabled = true;
    try { await rememberKey(els.devSel.value); } catch (e) { els.devMsg.replaceChildren(row({ name: 'Could not remember this device', status: 'fail', detail: errText(e) })); els.devOn.disabled = false; return; }
    paintDevice();
  }
  async function onForget() {
    try { await forgetDevice(); } catch (e) { els.devMsg.replaceChildren(row({ name: 'Could not forget this device', status: 'fail', detail: errText(e) })); return; }
    paintDevice();
  }
  async function lockNow() { try { await forgetDevice(); } catch (e) { } location.reload(); }

  async function onEncrypt() {
    const a = els.p1.value, b = els.p2.value, msg = t => { els.encMsg.textContent = t; };
    msg('');
    if (a.length < MIN_PASS) return msg('Use at least ' + MIN_PASS + ' characters. Four or more random words works well.');
    if (a !== b) return msg('The two passphrases do not match.');
    if (!els.ack.checked) return msg('Tick the box to confirm the passphrase is saved in your password manager.');
    if (!confirm('Encrypt your portal data now?\n\nA readable safety copy is written first and your data is checked after, so nothing is lost. If you forget the passphrase the encrypted data cannot be recovered.')) return;
    els.go.disabled = true; els.steps.replaceChildren();
    const seen = {};   // a step shows "..." while running and is replaced by its result
    const step = (name, st, detail) => { const el = row({ name, status: st, detail }); if (seen[name]) { seen[name].replaceWith(el); } else els.steps.append(el); seen[name] = el; };
    try {
      await encryptNow(a, step);
      els.p1.value = ''; els.p2.value = ''; els.ack.checked = false;
      els.steps.append(note('Done. Your data is now encrypted. Next: reload this page and unlock it, check your phone, then use sections 2 and 3.', '#2ecc8f'));
    } catch (e) { els.steps.append(row({ name: 'Stopped', status: 'fail', detail: errText(e) })); }
    els.go.disabled = false; paintStatus(); paintDevice(); refreshBackups();
  }
  async function onCheckSaved() {
    els.chk.replaceChildren(h('div', { style: 'color:#7d8aa8;font-size:13px' }, 'Reading the saved file\u2026'));
    try {
      const r = await checkSaved(), L = [];
      if (r.missing) L.push(row({ name: 'No portal-data.json found', status: 'fail' }));
      else {
        L.push(row({ name: r.encrypted ? 'The saved file is encrypted' : 'The saved file is NOT encrypted', status: r.encrypted ? 'ok' : 'fail', detail: kb(r.size) + (r.kdf ? ' \u00b7 ' + r.kdf + ' \u00b7 compression ' + r.comp : '') }));
        if (r.counts) L.push(row({ name: 'Decrypts correctly with this tab\u2019s key', status: 'ok', detail: r.counts.properties + ' properties \u00b7 ' + r.counts.bills + ' bills \u00b7 ' + r.counts.transactions + ' transactions \u00b7 ' + r.counts.mortgage + ' mortgage months' }));
        if (r.decryptError) L.push(row({ name: 'Decrypt check failed', status: 'fail', detail: r.decryptError }));
        L.push(h('div', { style: 'margin-top:8px;font-size:12px;color:#7d8aa8' }, 'What SharePoint holds (first characters):'), h('div', { style: 'font-family:Consolas,monospace;font-size:12px;word-break:break-all;color:#9eb0d0;margin-top:4px' }, r.preview + '\u2026'));
      }
      els.chk.replaceChildren(...L);
    } catch (e) { els.chk.replaceChildren(row({ name: 'Check failed', status: 'fail', detail: errText(e) })); }
  }
  async function refreshBackups() {
    if (!V.patched || !G.cloud()) return;
    els.bk.replaceChildren(h('div', { style: 'color:#7d8aa8;font-size:13px' }, 'Checking backups\u2026'));
    try { const r = await checkBackups(); els.bk.replaceChildren(row({ name: r.total + ' backup file(s): ' + r.enc + ' encrypted, ' + r.plain + ' readable' + (r.bad ? ', ' + r.bad + ' unreadable' : ''), status: r.plain ? 'warn' : 'ok' })); els.bkGo.disabled = !V.enabled || !r.plain; }
    catch (e) { els.bk.replaceChildren(row({ name: 'Could not check backups', status: 'fail', detail: errText(e) })); }
  }
  async function onEncryptBackups() {
    els.bkGo.disabled = true; els.bkOut.replaceChildren(h('div', { style: 'color:#7d8aa8;font-size:13px' }, 'Encrypting\u2026'));
    try { const box = []; const r = await encryptBackups((n, s, d) => box.push(row({ name: n, status: s, detail: d }))); els.bkOut.replaceChildren(row({ name: r.done + ' encrypted, ' + r.skipped + ' already encrypted, ' + r.failed + ' failed', status: r.failed ? 'warn' : 'ok' }), ...box.slice(-12)); }
    catch (e) { els.bkOut.replaceChildren(row({ name: 'Stopped', status: 'fail', detail: errText(e) })); }
    refreshBackups();
  }
  async function refreshPlain() {
    if (!V.patched || !G.cloud()) return;
    try { const f = await plainCopies(); els.pl.replaceChildren(row({ name: f.length ? f.length + ' unencrypted safety copy file(s) in ' + PLAIN_DIR : 'No unencrypted safety copies', status: f.length ? 'warn' : 'ok', detail: f.map(x => x.name).join(', ') })); els.plGo.disabled = !f.length || !V.enabled; }
    catch (e) { els.pl.replaceChildren(row({ name: 'Could not list safety copies', status: 'fail', detail: errText(e) })); }
  }
  async function onDeletePlain() {
    if (!confirm('Delete the unencrypted safety copy?\n\nOnly do this after you have unlocked the portal on your PC AND your phone and checked your data is all there. This cannot be undone from the portal.')) return;
    try { const n = await deletePlainCopies(); els.pl.replaceChildren(row({ name: n + ' file(s) deleted', status: 'ok' })); } catch (e) { els.pl.replaceChildren(row({ name: 'Could not delete', status: 'fail', detail: errText(e) })); }
    refreshPlain();
  }
  function build() {
    els.status = h('div'); els.encMsg = h('div', { style: 'color:#ff8a8a;font-size:13px;min-height:18px' });
    els.p1 = h('input', { type: 'password', name: 'new-vault-passphrase', autocomplete: 'new-password', autocapitalize: 'off', placeholder: 'New passphrase (12+ characters)', style: INPUT });
    els.p2 = h('input', { type: 'password', name: 'new-vault-passphrase-2', autocomplete: 'new-password', autocapitalize: 'off', placeholder: 'Type it again', style: INPUT });
    els.ack = h('input', { type: 'checkbox' });
    els.go = h('button', { class: 'btn primary', onclick: onEncrypt }, 'Encrypt my data');
    els.steps = h('div', { style: 'margin-top:10px' });
    els.enc = card('1. Encrypt my data',
      muted('One passphrase protects everything, SMSF included. Paste it from your password manager. A readable safety copy is written first, your original is only replaced after the encrypted copy reads back and decrypts to exactly the same data, and a failed check puts your original back.'),
      els.p1, els.p2, h('label', { style: 'display:flex;gap:8px;align-items:flex-start;font-size:13px;color:#cdd8f2;margin:6px 0' }, els.ack, 'I have saved this passphrase in my password manager. If it is lost, the data cannot be recovered.'), els.encMsg, els.go, els.steps);
    els.chk = h('div', { style: 'margin-top:10px' });
    els.ver = card('2. Check the saved file',
      muted('Reads portal-data.json from SharePoint and shows that it is ciphertext, and that it decrypts to your data with this tab\u2019s key.'),
      h('button', { class: 'btn primary', onclick: onCheckSaved }, 'Check the saved file'), els.chk);
    els.bk = h('div'); els.bkOut = h('div', { style: 'margin-top:8px' });
    els.bkGo = h('button', { class: 'btn', onclick: onEncryptBackups, disabled: 'disabled' }, 'Encrypt old backups');
    els.pl = h('div');
    els.plGo = h('button', { class: 'btn', onclick: onDeletePlain, disabled: 'disabled', style: 'margin-top:8px' }, 'Delete the unencrypted safety copy');
    els.bkCard = card('3. Old backups', muted('The portal keeps a daily backup in Portal/data/backups. New ones are encrypted automatically; this encrypts the ones that already exist.'), els.bk, h('div', { style: 'margin-top:8px' }, els.bkGo), els.bkOut);
    els.plCard = card('4. Clean up',
      muted('Only after you have unlocked the portal on your PC and your phone and your data is all there:'), els.pl, els.plGo,
      note('SharePoint also keeps old versions of portal-data.json (including the readable ones from before encryption) and a recycle bin. To remove those too: open portal-data.json in SharePoint > Version history > delete the older versions, then empty the recycle bin on the site. Also note the Backup button on the Statements page downloads a readable copy to your device.'));
    els.devMsg = h('div');
    els.devSel = h('select', { style: SELECT }, dayOpts());
    els.devOn = h('button', { class: 'btn primary', onclick: onRemember, disabled: 'disabled' }, 'Remember this device');
    els.devOff = h('button', { class: 'btn', onclick: onForget, style: 'display:none' }, 'Forget this device');
    els.devCard = card('Remember on this device',
      muted('Skip typing the passphrase on this device for a set time. This device only: your other devices keep asking until you turn it on there too. Use it only on a phone or PC you trust that has a screen lock.'),
      els.devMsg, h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px' }, els.devSel, els.devOn, els.devOff),
      note('How it works: your passphrase is never stored. The browser keeps the unlock key in a locked-down form that page code cannot read out. It is cleared when it expires, when you use Forget this device, Lock now or Sign out, or when you clear this site\u2019s data. Anyone who can open the portal in your signed-in browser on this device can read your data while it is remembered.'));
    return h('section', { style: 'width:min(760px,100%);margin:5vh auto;background:#151c2e;color:#eef3ff;border:1px solid #33415f;border-radius:20px;padding:24px;box-shadow:0 32px 80px #0008' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:flex-start' },
        h('div', null, h('h2', { style: 'margin:0 0 6px' }, 'Encryption vault'), h('div', { style: 'color:#aab7d1;font-size:13px' }, 'Beta 2 \u00b7 encrypted load and save')),
        h('button', { class: 'btn', onclick: () => modal.style.display = 'none' }, 'Close')),
      card('Status', els.status), els.devCard, els.enc, els.ver, els.bkCard, els.plCard,
      h('div', { style: 'margin-top:14px;display:flex;gap:10px;flex-wrap:wrap' }, h('button', { class: 'btn', onclick: lockNow }, 'Lock now (forgets this device and reloads)')),
      h('div', { style: 'margin-top:12px;font-size:12px;color:#f4c46e' }, 'The passphrase cannot be reset or recovered. Keep it in your password manager.'));
  }
  function openPanel() {
    if (!modal) { modal = h('div', { style: 'position:fixed;inset:0;z-index:100000;background:rgba(3,7,18,.88);overflow:auto;padding:16px;display:none' }); modal.append(build()); document.body.append(modal); modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; }); document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.style.display = 'none'; }); }
    modal.style.display = 'block'; paintStatus(); paintDevice(); refreshBackups(); refreshPlain();
  }
  // Sign out must also forget this device, and the deletion has to finish before the page navigates away.
  function hookSignOut() {
    try {
      if (typeof document === 'undefined' || !document.querySelectorAll) return;
      document.querySelectorAll('button[onclick*="signOut"]').forEach(b => {
        if (b.__vault) return; b.__vault = true; b.removeAttribute('onclick');
        b.addEventListener('click', async () => {
          try { await Promise.race([forgetDevice(), new Promise(r => setTimeout(r, 1500))]); } catch (e) { }
          try { signOut(); } catch (e) { location.reload(); }
        });
      });
    } catch (e) { }
  }
  function install() {
    hookSignOut();
    if (document.getElementById('v7vault')) return true;
    const host = document.querySelector('nav .nav, nav, aside, .sidebar, .side'); if (!host) return false;
    const b = h('button', { id: 'v7vault', type: 'button', class: 'sub', style: 'width:100%;text-align:left;margin-top:8px;color:#bfcaf0', onclick: openPanel }, '\uD83D\uDD12 Encryption vault');
    const sync = host.querySelector('.sync'); if (sync) host.insertBefore(b, sync); else host.append(b);
    return true;
  }

  const api = { version: VER, open: () => openPanel(), encryptNow, encryptBackups, checkBackups, checkSaved, deletePlainCopies, status, isEnvelope, seal, deriveKey, openWith, parseBox, patch, rememberKey, forgetDevice, deviceRecord, _V: V, _ui: ui, _b64: b64, _unb64: unb64 };
  if (typeof window !== 'undefined') window.PortalVaultBeta2 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  // Attach immediately (before the app starts loading data at DOMContentLoaded).
  if (!patch()) { let n = 0; const t = setInterval(() => { if (patch() || ++n > 40) clearInterval(t); }, 250); }
  if (typeof document !== 'undefined') {
    let tries = 0; const t = setInterval(() => { if (install() || ++tries > 40) clearInterval(t); }, 500);
    if (document.readyState !== 'loading') install(); else document.addEventListener('DOMContentLoaded', install, { once: true });
  }
})();
