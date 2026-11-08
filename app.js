/* Property Portal v6.5.3 - Microsoft Entra SPA
   OAuth 2.0 Authorization Code + PKCE. No client secret or private key.
   Access/refresh tokens are session-only. Private storage is resolved after authentication. */
'use strict';
const APP_VER = '6.5.4';
const C = Object.freeze({
  clientId: 'f0aadf0f-e8d9-4698-ae0b-c9cb3ba23bfb',
  tenant: 'fca9cce9-dd25-4940-bcde-820d1ec34cfe'
});
const P_DATA = 'Portal/data/portal-data.json', P_BACKUP = 'Portal/data/backups', P_INBOX = 'Portal/data/inbox', P_LOG = 'Portal/data/agent-log', P_TB = 'Portal/data/inbox/timelybills', P_EXPORTS = 'Portal/exports', P_IMAGES = 'Portal/images', P_PROPS = 'Properties';
const ACTIVITY_MAX = 1500;

/* ---------------- Sign-in (OAuth 2.0 auth code + PKCE for SPAs) ---------------- */
const Auth = {
  key: 'cjp.auth',
  base() { return `https://login.microsoftonline.com/${C.tenant}/oauth2/v2.0` },
  redirect() { return location.origin + location.pathname.replace(/index\.html$/, '') },
  scope: 'openid profile offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Sites.Selected',
  get tok() { try { return JSON.parse(sessionStorage.getItem(this.key)) } catch (e) { return null } },
  set tok(v) { v ? sessionStorage.setItem(this.key, JSON.stringify(v)) : sessionStorage.removeItem(this.key) },
  b64u(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') },
  async login() {
    const v = this.b64u(crypto.getRandomValues(new Uint8Array(32))), st = this.b64u(crypto.getRandomValues(new Uint8Array(16)));
    const ch = this.b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
    sessionStorage.setItem('cjp.pkce', JSON.stringify({ v, st }));
    const q = new URLSearchParams({ client_id: C.clientId, response_type: 'code', redirect_uri: this.redirect(), response_mode: 'query', scope: this.scope, state: st, code_challenge: ch, code_challenge_method: 'S256' });
    location.assign(this.base() + '/authorize?' + q);
  },
  async handleRedirect() {
    const u = new URL(location.href), code = u.searchParams.get('code'), err = u.searchParams.get('error');
    if (!code && !err) return false;
    history.replaceState(null, '', location.pathname);
    if (err) throw new Error(u.searchParams.get('error_description') || err);
    const p = JSON.parse(sessionStorage.getItem('cjp.pkce') || '{}'); sessionStorage.removeItem('cjp.pkce');
    if (!p.st || p.st !== u.searchParams.get('state')) throw new Error('Sign-in check failed – please try again.');
    await this.token({ grant_type: 'authorization_code', code, redirect_uri: this.redirect(), code_verifier: p.v });
    return true;
  },
  async token(body) {
    const r = await fetch(this.base() + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: C.clientId, scope: this.scope, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.error || 'Sign-in failed');
    const old = this.tok || {};
    this.tok = { at: j.access_token, rt: j.refresh_token || old.rt, exp: Date.now() + ((j.expires_in || 3600) - 120) * 1000, user: this.claim(j.id_token) || old.user };
    return this.tok.at;
  },
  claim(id) { try { const p = JSON.parse(atob(id.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.preferred_username || p.name } catch (e) { return null } },
  async access() {
    const t = this.tok; if (!t) throw Object.assign(new Error('Not signed in'), { auth: true });
    if (Date.now() < t.exp) return t.at;
    if (t.rt) { try { return await this.token({ grant_type: 'refresh_token', refresh_token: t.rt }) } catch (e) { } }
    this.tok = null; throw Object.assign(new Error('Your session has expired – please sign in again.'), { auth: true });
  },
  logout() { this.tok = null; location.assign(this.base() + '/logout?post_logout_redirect_uri=' + encodeURIComponent(this.redirect())) }
};
async function gErr(r, what) { let m = ''; try { const j = await r.json(); m = j.error?.message || '' } catch (e) { } return `${what} (${r.status}${m ? ': ' + m : ''})` }

/* ---------------- Storage: SharePoint via Graph ---------------- */
const Cloud = {
  kind: 'cloud', label: 'Private storage', drive: null, libUrl: '',
  async g(path, o = {}) {
    const at = await Auth.access();
    const r = await fetch(path.startsWith('http') ? path : 'https://graph.microsoft.com/v1.0' + path, { ...o, headers: { Authorization: 'Bearer ' + at, ...(o.headers || {}) } });
    if (r.status === 401 && !o._retry) { const t = Auth.tok; if (t) Auth.tok = { ...t, exp: 0 }; return this.g(path, { ...o, _retry: 1 }) }
    return r;
  },
  async init() {
    const siteId = localStorage.getItem('cjp.storage.siteId');
    if (!siteId) throw Object.assign(new Error('Private storage connection required.'), { setup: true });
    const d = await this.g(`/sites/${encodeURIComponent(siteId)}/drive?$select=id,webUrl`);
    if (d.status === 403 || d.status === 404) { localStorage.removeItem('cjp.storage.siteId'); throw Object.assign(new Error('Private storage connection needs to be renewed.'), { setup: true }); }
    if (!d.ok) throw new Error('Private storage is temporarily unavailable.');
    const dj = await d.json(); this.drive = `/drives/${dj.id}`; this.libUrl = dj.webUrl;
  },
  async configure(url) {
    let u; try { u = new URL(String(url || '').trim()); } catch { throw new Error('Enter the full private storage URL.'); }
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.sharepoint.com') || !u.pathname.startsWith('/sites/')) throw new Error('Enter a valid HTTPS Microsoft 365 site URL.');
    const r = await this.g(`/sites/${u.hostname}:${u.pathname.replace(/\/$/, '')}?$select=id`);
    if (!r.ok) throw new Error('That private storage location is not available to this account.');
    const j = await r.json();
    localStorage.setItem('cjp.storage.siteId', j.id);
    await this.init();
  },
  ip(p) { return this.drive + '/root:/' + p.split('/').filter(Boolean).map(encodeURIComponent).join('/') + ':' },
  async meta(p) { const r = await this.g(this.ip(p)); if (r.status === 404) return null; if (!r.ok) throw new Error(await gErr(r, 'Read failed')); return r.json() },
  async fetchContent(p, m) {
    // Prefer the pre-authenticated download URL; Graph often omits it (e.g. with Sites.Selected), so fall back to /content with the token.
    const u = m && m['@microsoft.graph.downloadUrl'];
    if (u) { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) return r }
    if (m && m.id) { const r2 = await this.g(`${this.drive}/items/${m.id}?$select=id,@microsoft.graph.downloadUrl`); if (r2.ok) { const u2 = (await r2.json())['@microsoft.graph.downloadUrl']; if (u2) { const r = await fetch(u2, { cache: 'no-store' }); if (r.ok) return r } } }
    const r = await this.g(this.ip(p) + '/content', { cache: 'no-store' });
    if (!r.ok) throw new Error(await gErr(r, 'Download failed'));
    return r;
  },
  async read(p) { const m = await this.meta(p); if (!m) return null; const r = await this.fetchContent(p, m); return { text: await r.text(), etag: m.eTag } },
  async readText(p) { return (await this.read(p))?.text ?? null },
  async etagOf(p) { return (await this.meta(p))?.eTag ?? null },
  async getBlob(p) { const m = await this.meta(p); if (!m) throw new Error('Not found: ' + p); return (await this.fetchContent(p, m)).blob() },
  async writeText(p, t, etag) { return this.put(p, new Blob([t], { type: 'application/json' }), etag) },
  async writeBlob(p, b) { return this.put(p, b) },
  async put(p, b, etag) {
    if (b.size > 3.5e6) return this.bigPut(p, b);
    const h = { 'Content-Type': b.type || 'application/octet-stream' }; if (etag) h['If-Match'] = etag;
    const r = await this.g(this.ip(p) + '/content', { method: 'PUT', headers: h, body: b });
    if (r.status === 412) throw Object.assign(new Error('conflict'), { conflict: true });
    if (!r.ok) throw new Error(await gErr(r, 'Save failed'));
    return (await r.json()).eTag;
  },
  async bigPut(p, b) {
    const r = await this.g(this.ip(p) + '/createUploadSession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) });
    if (!r.ok) throw new Error(await gErr(r, 'Upload failed'));
    const { uploadUrl } = await r.json(), CH = 327680 * 10; let res;
    for (let i = 0; i < b.size; i += CH) { const e = Math.min(i + CH, b.size); res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${i}-${e - 1}/${b.size}` }, body: b.slice(i, e) }); if (!res.ok) throw new Error('Upload failed (' + res.status + ')') }
    return (await res.json()).eTag;
  },
  async list(p) {
    const out = []; let u = this.ip(p) + '/children?$select=name,size,file,folder,lastModifiedDateTime,webUrl&$top=999';
    while (u) { const r = await this.g(u); if (r.status === 404) return out; if (!r.ok) throw new Error(await gErr(r, 'List failed')); const j = await r.json(); j.value.forEach(i => out.push({ name: i.name, dir: !!i.folder, size: i.size, modified: Date.parse(i.lastModifiedDateTime), url: i.webUrl })); u = j['@odata.nextLink'] }
    return out;
  },
  async remove(p) { const r = await this.g(this.ip(p), { method: 'DELETE' }); return r.ok || r.status === 404 },
  linkFor(p) { return this.libUrl ? this.libUrl + '/' + p.split('/').map(encodeURIComponent).join('/') : '' }
};

/* ---------------- Active storage ---------------- */
let Store = null;
async function walk(p, depth = 6) { const out = []; for (const i of await Store.list(p)) { const q = p + '/' + i.name; if (i.dir) { if (depth > 0) out.push(...await walk(q, depth - 1)) } else out.push({ ...i, path: q }) } return out }
async function moveFile(p, toDir) { const b = await Store.getBlob(p); await Store.writeBlob(toDir + '/' + p.split('/').at(-1), b); await Store.remove(p) }

/* ---------------- Data model ---------------- */
const DEFAULT_CATS = ['Mortgage & Loans', 'Council & Rates', 'Utilities', 'Insurance', 'Strata', 'Property Costs', 'Repairs & Maintenance', 'Rent', 'Storage', 'Tax & Accounting', 'Groceries', 'Transport & Fuel', 'Health', 'Pets', 'Shopping', 'Subscriptions', 'Dining & Entertainment', 'Spending money (FFF)', 'Other'];
function uid() { return Math.random().toString(36).slice(2, 10) }
function emptyData() { return { ver: APP_VER, updated: null, settings: { income: 0, alertDays: 14, agentStaleDays: 8 }, properties: [], mortgage: [], bills: [], transactions: [], categories: [...DEFAULT_CATS], budgets: {}, documents: {}, inboxSeen: {}, runsSeen: {}, runs: [], activity: [], taxYears: {}, borrowing: [] } }
function migrate() {
  const e = emptyData(); for (const k in e) if (S[k] == null) S[k] = e[k];
  S.settings = { ...e.settings, ...S.settings };
  DEFAULT_CATS.forEach(c => { if (!S.categories.includes(c)) S.categories.splice(S.categories.length - 1, 0, c) });
  S.properties.forEach(p => { p.loans ||= []; p.loans.forEach(l => { l.id ||= uid() }); p.ownPct ??= 100 });
  if (S.ver !== APP_VER) { log('Portal upgraded', `Data updated from v${S.ver || '?'} to v${APP_VER}`, { actor: 'portal' }); S.ver = APP_VER }
}

/* ---------------- State, saving, activity ---------------- */
let S = null, etag = null, lastText = null, saving = false, saveT = null;
function log(action, detail = '', o = {}) { if (!S) return; S.activity.unshift({ id: uid(), at: o.at || new Date().toISOString(), actor: o.actor || 'you', action, detail, status: o.status || 'ok', ref: o.ref || '' }); if (S.activity.length > ACTIVITY_MAX) S.activity.length = ACTIVITY_MAX }
async function loadData() { const r = await Store.read(P_DATA); if (!r) return false; S = JSON.parse(r.text); etag = r.etag; lastText = r.text; migrate(); return true }
async function saveData() {
  if (!S || !Store) return; clearTimeout(saveT); saveT = null; saving = true; setSync('Saving…'); S.updated = new Date().toISOString();
  try {
    const day = iso(today()); if (lastText && S._backupDay !== day) { await Store.writeText(`${P_BACKUP}/portal-data.${day}.json`, lastText); S._backupDay = day }
    const txt = JSON.stringify(S, null, 1); etag = await Store.writeText(P_DATA, txt, etag); lastText = txt;
    setSync('Saved ' + new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    if (e.conflict) await onConflict(); else if (e.auth) needSignIn(e.message); else { setSync('⚠ Save failed'); toast('Save failed: ' + e.message) }
  }
  saving = false;
}
function save() { clearTimeout(saveT); saveT = setTimeout(saveData, 500); renderAll() }
async function onConflict() {
  await loadData(); setSync('Reloaded'); renderAll();
  modal(`<h2>Updated on another device</h2><p class="muted">The data was changed on another device since you last loaded it. The latest version is now showing. Your most recent change wasn't saved – please make it again.</p><div class="row end"><button class="btn primary" onclick="closeModal()">OK</button></div>`);
}
async function refreshIfChanged() {
  if (!Store || !S || saving) return;
  try { const e = await Store.etagOf(P_DATA); if (e && etag && e !== etag) { await loadData(); renderAll(); toast('Updated from another device') } } catch (e) { if (e.auth) needSignIn(e.message) }
}

/* ---------------- Helpers ---------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, d = 2) => n == null || isNaN(n) ? '—' : (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const m0 = n => money(n, 0);
const pd = s => { if (!s) return null; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d || 1) };
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d };
const days = s => s ? Math.round((pd(s) - today()) / 864e5) : null;
const fdate = s => s ? pd(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date';
const fdt = s => s ? new Date(s).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const fmonth = s => pd(s).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
const ago = s => { if (!s) return 'never'; const m = Math.round((Date.now() - new Date(s)) / 6e4); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago' };
const curYM = () => iso(today()).slice(0, 7);
const FREQ = { once: 'One-off', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };
function addPeriod(s, f) { const d = pd(s); if (f === 'weekly') d.setDate(d.getDate() + 7); else if (f === 'fortnightly') d.setDate(d.getDate() + 14); else if (f === 'monthly') d.setMonth(d.getMonth() + 1); else if (f === 'quarterly') d.setMonth(d.getMonth() + 3); else if (f === 'annual') d.setFullYear(d.getFullYear() + 1); return iso(d) }
const prop = id => S.properties.find(p => p.id === id);
const pname = id => prop(id)?.name || '';
const active = () => S.properties.filter(p => !p.sold);
const soldList = () => S.properties.filter(p => p.sold);
function toast(m) { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', 3500) }
function setSync(m) { $('syncState').textContent = m; $('mSync').textContent = m }
function modal(h) { $('modalBody').innerHTML = h; $('modal').classList.add('show') }
function closeModal() { $('modal').classList.remove('show') }
const catOpts = sel => [...new Set([...S.categories, sel].filter(Boolean))].map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
const propOpts = (sel, req) => (req ? '' : '<option value="">— none —</option>') + S.properties.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}${p.sold ? ' (sold)' : ''}</option>`).join('');
function billState(b) {
  if (b.status === 'paid') return { k: 'paid', t: 'Paid', c: 'p-paid' };
  if (b.status === 'verify') return { k: 'verify', t: 'Check', c: 'p-verify' };
  const d = days(b.dueDate); if (d == null) return { k: 'ok', t: 'No date', c: 'p-ok' };
  if (d < 0) return { k: 'over', t: `Overdue ${-d}d`, c: 'p-over' };
  if (d <= S.settings.alertDays) return { k: 'soon', t: d === 0 ? 'Due today' : `Due in ${d}d`, c: 'p-soon' };
  return { k: 'ok', t: `In ${d}d`, c: 'p-ok' };
}
const monthlyEq = b => { const a = b.amount || 0; return { weekly: a * 52 / 12, fortnightly: a * 26 / 12, monthly: a, quarterly: a / 3, annual: a / 12, once: 0 }[b.freq] || 0 };
function stats(p) {
  const owing = p.unsettled ? Math.max(0, (p.purchase || 0) - (p.deposit || 0)) : 0;
  const debt = p.loans.reduce((a, l) => a + (+l.balance || 0), 0) + owing, off = p.loans.reduce((a, l) => a + (+l.offset || 0), 0);
  const billsM = S.bills.filter(b => b.propertyId === p.id && b.status === 'due' && b.category !== 'Mortgage & Loans').reduce((a, b) => a + monthlyEq(b), 0);
  const repayM = p.loans.reduce((a, l) => a + (+l.repay || 0), 0), rent = p.countRent ? p.rentMonthly : 0;
  const yr = String(today().getFullYear()); const tx = S.transactions.filter(t => t.propertyId === p.id && t.date.startsWith(yr));
  return { debt, owing, off, net: debt - off, lvr: p.value ? debt / p.value : null, equity: (p.value || 0) - debt, usable: p.value ? Math.max(0, p.value * .8 - debt) : 0, rent, billsM, repayM, cash: rent - billsM - repayM, incYTD: tx.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0), expYTD: -tx.filter(t => t.amount < 0).reduce((a, t) => a + t.amount, 0), grossYield: p.value && p.rentMonthly ? p.rentMonthly * 12 / p.value : null };
}
const covers = {};
const photo = p => covers[p.id] || (['p1', 'p2', 'p3'].includes(p.id) ? `images/${p.id}.jpg` : '');
async function loadCovers() { for (const p of S.properties) { try { covers[p.id] = URL.createObjectURL(await Store.getBlob(`${P_IMAGES}/${p.id}.jpg`)) } catch (e) { } } }
async function setCover(id, inp) { const f = inp.files[0]; if (!f) return; try { await Store.writeBlob(`${P_IMAGES}/${id}.jpg`, f); covers[id] = URL.createObjectURL(f); log('Cover photo changed', pname(id), { ref: id }); save(); toast('Photo saved to Portal/images') } catch (e) { toast('Could not save photo: ' + e.message) } }
function resolveProperty(hint) {
  if (!hint) return ''; const h = String(hint).toLowerCase().trim();
  const p = S.properties.find(p => p.id === hint) || S.properties.find(p => (p.folder || '').toLowerCase() === h) || S.properties.find(p => p.name.toLowerCase() === h)
    || S.properties.find(p => p.folder && h.includes(p.folder.toLowerCase())) || S.properties.find(p => (p.address || '').toLowerCase().includes(h) || h.includes(p.name.toLowerCase()))
    || S.properties.find(p => { const t = (p.name + ' ' + (p.folder || '')).toLowerCase().match(/[a-z0-9]{4,}/g) || []; return t.some(x => h.includes(x) && !['street', 'road', 'melbourne'].includes(x)) });
  return p ? p.id : '';
}
/* ---------------- Charts (SVG) ---------------- */
function lineChart(series, o = {}) {
  const W = o.w || 760, H = o.h || 260, P = { l: 64, r: 16, t: 16, b: 34 };
  const xs = [...new Set(series.flatMap(s => s.pts.map(p => p.x)))].sort(); if (!xs.length) return '<div class="empty">No data</div>';
  const vals = series.flatMap(s => s.pts.map(p => p.y)).filter(v => v != null);
  let mn = o.min ?? Math.min(...vals), mx = Math.max(...vals); const pad = (mx - mn) * .08 || 1; mn = o.min ?? mn - pad; mx += pad;
  const X = x => P.l + (xs.indexOf(x) / Math.max(1, xs.length - 1)) * (W - P.l - P.r), Y = y => P.t + (1 - (y - mn) / (mx - mn)) * (H - P.t - P.b);
  let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart">`;
  for (let i = 0; i <= 4; i++) { const v = mn + (mx - mn) * i / 4, y = Y(v); g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" class="grid"/><text x="${P.l - 6}" y="${y + 4}" text-anchor="end">${m0(v / 1000)}k</text>` }
  const step = Math.ceil(xs.length / 9); xs.forEach((x, i) => { if (i % step === 0 || i === xs.length - 1) g += `<text x="${X(x)}" y="${H - 10}" text-anchor="middle">${fmonth(x)}</text>` });
  series.forEach(s => { const pts = s.pts.filter(p => p.y != null).sort((a, b) => a.x.localeCompare(b.x)); if (!pts.length) return;
    if (s.area) g += `<path d="M${X(pts[0].x)},${Y(mn)} ${pts.map(p => `L${X(p.x)},${Y(p.y)}`).join(' ')} L${X(pts.at(-1).x)},${Y(mn)} Z" fill="${s.color}" opacity=".12"/>`;
    g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" points="${pts.map(p => X(p.x) + ',' + Y(p.y)).join(' ')}"/>`;
    pts.forEach(p => g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3.2" fill="${p.hollow ? '#0b1020' : s.color}" stroke="${s.color}" stroke-width="1.5"><title>${s.name} ${fmonth(p.x)}: ${m0(p.y)}</title></circle>`) });
  return g + '</svg>' + `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`;
}
function barChart(items) {
  if (!items.length) return '<div class="empty">No properties</div>';
  const W = 520, rowH = 34, H = items.length * rowH + 10, max = Math.max(...items.map(i => Math.max(i.a, i.b || 0)), 1);
  let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart">`;
  items.forEach((it, i) => { const y = i * rowH + 6, L = 150, w = W - L - 90; g += `<text x="${L - 8}" y="${y + 16}" text-anchor="end" style="fill:var(--text)">${esc(it.label)}</text><rect x="${L}" y="${y + 3}" width="${Math.max(2, it.a / max * w)}" height="18" rx="5" fill="${it.color || '#5b9dff'}"/>${it.b != null ? `<rect x="${L}" y="${y + 3}" width="${Math.max(0, it.b / max * w)}" height="18" rx="5" fill="none" stroke="#f5b942" stroke-dasharray="4 3"/>` : ''}<text x="${L + Math.max(it.a, it.b || 0) / max * w + 6}" y="${y + 16}">${m0(it.a)}</text>` });
  return g + '</svg>';
}

/* ---------------- Navigation ---------------- */
let view = 'dashboard', curProp = null;
function go(v) { if (v.startsWith('prop:')) { curProp = v.slice(5); v = 'prop' } view = v; document.body.classList.remove('drawer-open'); document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === 'v-' + v)); renderAll(); window.scrollTo(0, 0) }
function renderNav() {
  const ib = Inbox.items.length + (window._tbPending || []).length, nd = window._scan?.pending.length || 0, over = S.bills.filter(b => ['over', 'soon'].includes(billState(b).k)).length, err = agentHealth().problems;
  const cur = view === 'prop' ? 'prop:' + curProp : view;
  const btn = (v, label, badge, cls = '') => `<button data-view="${v}" class="${cur === v ? 'active' : ''} ${cls}" onclick="go('${v}')">${label}${badge ? `<span class="badge ${badge[1] || ''}">${badge[0]}</span>` : ''}</button>`;
  $('navList').innerHTML = btn('dashboard', '📊 Dashboard') + btn('portfolio', '🏘️ Portfolio') + btn('mortgage', '📈 Mortgage analytics') + btn('bills', '🧾 Bills', over ? [over] : null) + btn('spending', '💳 Spending &amp; budget') +
    '<div class="navsec">Properties</div>' + active().map(p => btn('prop:' + p.id, `${p.type === 'PPOR' ? '🏡' : '🏢'} ${esc(p.name)}`, null, 'sub')).join('') + (S.properties.length ? '' : btn('props', '➕ Add a property', null, 'sub')) +
    (soldList().length ? '<div class="navsec">Sold</div>' + soldList().map(p => btn('prop:' + p.id, `🏷️ ${esc(p.name)}`, null, 'sub dim')).join('') : '') +
    '<div class="navsec">Data &amp; agents</div>' + btn('tax', '🧮 Tax &amp; accountant') + btn('inbox', '📬 Agent inbox', ib ? [ib, 'amb'] : null) + btn('activity', '🧭 Activity log', err ? ['!', ''] : null) + btn('import', '📥 Statements', nd ? [nd, 'amb'] : null);
  renderBnav();
}

/* ---------------- Dashboard ---------------- */
function renderDashboard() {
  $('todayLbl').textContent = today().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const open = S.bills.filter(b => b.status !== 'paid');
  const over = open.filter(b => billState(b).k === 'over'), next30 = open.filter(b => b.dueDate && days(b.dueDate) >= 0 && days(b.dueDate) <= 30);
  let val = 0, debt = 0; active().forEach(p => { val += p.value || 0; debt += stats(p).debt });
  const spent = S.transactions.filter(t => t.amount < 0 && t.date.startsWith(curYM()) && t.category !== 'Mortgage & Loans').reduce((a, t) => a - t.amount, 0);
  const budget = Object.values(S.budgets).reduce((a, b) => a + (+b || 0), 0);
  const ib = Inbox.items.length + (window._tbPending || []).length, nd = window._scan?.pending.length || 0;
  $('kpis').innerHTML = [
    ['Due next 30 days', m0(next30.reduce((a, b) => a + (b.amount || 0), 0)), `${next30.length} bill(s)`, ''],
    ['Overdue', over.length, over.length ? 'Action needed' : 'All clear', over.length ? 'red' : 'green'],
    ['Spent this month', m0(spent), budget ? `${Math.round(spent / budget * 100)}% of ${m0(budget)} budget` : 'Excl. loan repayments', budget && spent > budget ? 'red' : ''],
    ['Portfolio equity', m0(val - debt), `Value ${m0(val)} · debt ${m0(debt)}`, 'green'],
    ['To review', ib + nd, `${ib} in inbox · ${nd} new PDFs`, ib + nd ? 'amber' : 'green']
  ].map(k => `<div class="card kpi"><div class="lbl">${k[0]}</div><div class="val ${k[3]}">${k[1]}</div><div class="hint">${k[2]}</div></div>`).join('');
  const up = open.slice().sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')).slice(0, 7);
  $('dashBills').innerHTML = up.length ? up.map(billLine).join('') : '<div class="empty">No open bills. Import a TimelyBills report or add one.</div>';
  const mp = [...new Set(S.mortgage.map(r => r.propertyId))][0], h = mp ? mortgageSeries(mp).filter(r => r.net != null) : [], last = h.at(-1);
  $('dashMgTitle').textContent = mp ? pname(mp) + ' – net debt' : 'Mortgage';
  $('dashMortgage').innerHTML = last ? `<div class="row" style="gap:28px;margin-bottom:6px"><div><div class="lbl2">Net debt (${fmonth(last.month)})</div><b style="font-size:22px">${m0(last.net)}</b></div><div><div class="lbl2">Reduced since ${fmonth(h[0].month)}</div><b class="green" style="font-size:22px">${m0(h[0].net - last.net)}</b></div></div>` + lineChart([{ name: 'Net debt', color: '#2ecc8f', area: true, pts: h.map(r => ({ x: r.month, y: r.net })) }], { h: 170, w: 560 }) : '<div class="empty">No verified loan history yet.<br><span class="sm">Import Rapid Repay or loan statements.</span></div>';
  $('dashAgents').innerHTML = agentHealthHtml(true);
  $('dashProps').innerHTML = active().map(propCard).join('') || '<div class="card empty">No properties yet – <a href="#" onclick="openProp();return false">add one</a> or load your starter file.</div>';
}
function propCard(p) { const s = stats(p); return `<div class="card prop-mini" style="background-image:linear-gradient(rgba(11,16,32,.4),rgba(11,16,32,.93)),url('${photo(p)}')" onclick="go('prop:${p.id}')"><div class="row sp"><h3>${esc(p.name)}</h3><span class="pill ${p.sold ? 'p-paid' : p.type === 'PPOR' ? 'p-ok' : 'p-verify'}">${p.sold ? 'Sold' : esc(p.type)}</span></div><div class="muted sm">${esc(p.status)}</div>${p.sold ? '' : `<div class="meta"><div><small>Value</small><b>${m0(p.value)}</b></div><div><small>Equity</small><b class="green">${m0(s.equity)}</b></div><div><small>LVR</small><b>${s.lvr ? Math.round(s.lvr * 100) + '%' : '—'}</b></div><div><small>Cash flow/mth</small><b class="${s.cash < 0 ? 'red' : 'green'}">${m0(s.cash)}</b></div></div>`}</div>` }
function billLine(b) { const s = billState(b), d = b.dueDate ? pd(b.dueDate) : null; return `<div class="list-item"><div class="date-chip">${d ? `<b>${d.getDate()}</b><small>${d.toLocaleDateString('en-AU', { month: 'short' })}</small>` : '<b>?</b><small>date</small>'}</div><div class="grow"><b>${esc(b.name)}</b>${b.agent ? ' <span class="pill p-agent">🤖</span>' : ''}<div class="muted sm">${esc(b.biller || '')}${b.propertyId ? ' · ' + esc(pname(b.propertyId)) : ''}${b.notes ? ' · ' + esc(b.notes) : ''}</div></div><div style="text-align:right"><b>${b.amount == null ? '<span class="amber">TBC</span>' : money(b.amount)}</b><div><span class="pill ${s.c}">${s.t}</span></div></div>${b.status !== 'paid' ? `<button class="btn sm ok" onclick="event.stopPropagation();payBill('${b.id}')">Paid</button>` : ''}</div>` }

/* ---------------- Bills ---------------- */
let billFilter = 'open';
function billList() { return S.bills.filter(b => { const k = billState(b).k; return billFilter === 'all' || (billFilter === 'open' && k !== 'paid') || k === billFilter }).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')) }
function renderBills() {
  $('billTabs').innerHTML = [['open', 'Open'], ['over', 'Overdue'], ['soon', 'Due soon'], ['verify', 'Needs checking'], ['paid', 'Paid'], ['all', 'All']].map(([k, t]) => `<button class="${billFilter === k ? 'active' : ''}" onclick="billFilter='${k}';renderBills()">${t}</button>`).join('');
  const list = billList();
  $('billRows').innerHTML = list.length ? list.map(b => { const s = billState(b); return `<tr><td><b>${esc(b.name)}</b>${b.agent ? ` <span class="pill p-agent">🤖 ${esc(b.agent)}</span>` : ''}<div class="muted sm">${esc(b.biller || '')}${b.doc ? ` · 📄 ${esc(b.doc.split('/').at(-1))}` : ''}</div>${b.notes ? `<div class="muted sm">📝 ${esc(b.notes)}</div>` : ''}</td><td>${esc(b.category)}</td><td>${esc(pname(b.propertyId)) || '—'}</td><td>${fdate(b.dueDate)}</td><td>${FREQ[b.freq] || ''}</td><td class="num"><b>${b.amount == null ? '<span class="amber">TBC</span>' : money(b.amount)}</b></td><td><span class="pill ${s.c}">${s.t}</span></td><td class="nowrap">${b.status !== 'paid' ? `<button class="btn sm ok" onclick="payBill('${b.id}')">Paid</button> ` : ''}<button class="btn sm" onclick="openBill('${b.id}')">Edit</button></td></tr>` }).join('') : '<tr><td colspan="8" class="empty">Nothing here</td></tr>';
  $('billCards').innerHTML = list.length ? list.map(b => `<div onclick="openBill('${b.id}')">${billLine(b)}</div>`).join('') : '<div class="empty">Nothing here</div>';
}
function payBill(id) {
  const b = S.bills.find(x => x.id === id);
  modal(`<h2>Mark paid – ${esc(b.name)}</h2><div class="form2"><div><label>Amount paid</label><input id="pAmt" type="number" step="0.01" value="${b.amount ?? ''}"></div><div><label>Date paid</label><input id="pDate" type="date" value="${iso(today())}"></div></div><p class="muted">${b.freq !== 'once' ? `Next due date rolls to <b>${fdate(addPeriod(b.dueDate || iso(today()), b.freq))}</b>.` : 'One-off bill will be closed.'}</p><div class="row end"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="pGo">Confirm</button></div>`);
  $('pGo').onclick = () => { const a = +$('pAmt').value || 0, d = $('pDate').value; S.transactions.push({ id: uid(), date: d, desc: b.name + (b.biller && b.biller !== b.name ? ' – ' + b.biller : ''), amount: -a, category: b.category, propertyId: b.propertyId, source: 'Bill payment' }); if (b.freq === 'once') b.status = 'paid'; else { b.dueDate = addPeriod(b.dueDate || d, b.freq); b.status = 'due' } log('Bill paid', `${b.name} ${money(a)}`, { ref: b.propertyId }); closeModal(); save(); toast('Payment recorded') };
}
function openBill(id, preset = {}) {
  const b = id ? S.bills.find(x => x.id === id) : { name: '', biller: '', category: 'Utilities', propertyId: '', amount: null, dueDate: iso(today()), freq: 'monthly', status: 'due', notes: '', ...preset };
  modal(`<h2>${id ? 'Edit' : 'Add'} bill</h2><div class="form2"><div><label>Bill</label><input id="bName" value="${esc(b.name)}"></div><div><label>Biller</label><input id="bBiller" value="${esc(b.biller)}"></div><div><label>Amount</label><input id="bAmt" type="number" step="0.01" value="${b.amount ?? ''}"></div><div><label>Due date</label><input id="bDue" type="date" value="${b.dueDate || ''}"></div><div><label>Repeats</label><select id="bFreq">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${b.freq === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div><label>Category</label><select id="bCat">${catOpts(b.category)}</select></div><div><label>Property</label><select id="bProp">${propOpts(b.propertyId)}</select></div><div><label>Status</label><select id="bStatus">${[['due', 'Due'], ['verify', 'Needs checking'], ['paid', 'Paid']].map(([k, v]) => `<option value="${k}" ${b.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div><label>Notes</label><input id="bNotes" value="${esc(b.notes)}"><div class="row sp" style="margin-top:16px">${id ? `<button class="btn danger" onclick="delBill('${id}')">Delete</button>` : '<span></span>'}<div class="row"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="bSave">Save</button></div></div>`);
  $('bSave').onclick = () => { const o = id ? b : { id: uid() }; Object.assign(o, { name: $('bName').value || 'Bill', biller: $('bBiller').value, amount: $('bAmt').value === '' ? null : +$('bAmt').value, dueDate: $('bDue').value || null, freq: $('bFreq').value, category: $('bCat').value, propertyId: $('bProp').value, status: $('bStatus').value, notes: $('bNotes').value }); if (!id) S.bills.push(o); log(id ? 'Bill edited' : 'Bill added', o.name, { ref: o.propertyId }); closeModal(); save(); toast('Bill saved') };
}
function delBill(id) { const b = S.bills.find(x => x.id === id); S.bills = S.bills.filter(x => x.id !== id); log('Bill deleted', b?.name || ''); closeModal(); save() }

/* ---------------- Spending & budget ---------------- */
function renderSpending() {
  const months = [...new Set([curYM(), ...S.transactions.map(t => t.date.slice(0, 7))])].sort().reverse();
  const sel = $('spMonth'), cur = sel.value || curYM(); sel.innerHTML = months.map(m => `<option value="${m}" ${m === cur ? 'selected' : ''}>${pd(m).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</option>`).join('');
  const list = S.transactions.filter(t => t.date.startsWith(sel.value)).sort((a, b) => b.date.localeCompare(a.date));
  const cats = {}; list.filter(t => t.amount < 0).forEach(t => cats[t.category] = (cats[t.category] || 0) - t.amount);
  $('spBudget').innerHTML = S.categories.filter(c => cats[c] || S.budgets[c]).map(c => { const v = cats[c] || 0, lim = +S.budgets[c] || 0, pct = lim ? Math.min(100, v / lim * 100) : (v ? 100 : 0), col = lim && v > lim ? 'var(--red)' : lim && v > lim * .8 ? 'var(--amber)' : 'var(--green)'; return `<div style="margin-bottom:12px"><div class="row sp"><span>${esc(c)}</span><span><b>${m0(v)}</b> / <input type="number" value="${lim}" class="mini" onchange="setBudget(this.dataset.c,this.value)" data-c="${esc(c)}"></span></div><div class="bar"><i style="width:${pct}%;background:${col}"></i></div></div>` }).join('') || '<div class="empty">No spending this month</div>';
  $('txnRows').innerHTML = list.length ? list.map(t => `<tr><td class="nowrap">${fdate(t.date)}</td><td>${esc(t.desc)}${t.agent ? ' <span class="pill p-agent">🤖</span>' : ''}<div class="muted sm">${esc(t.source || '')}${t.note ? ' · ' + esc(t.note) : ''}</div></td><td><select class="mini2" onchange="tx('${t.id}').category=this.value;save()">${catOpts(t.category)}</select></td><td><select class="mini2" onchange="tx('${t.id}').propertyId=this.value;save()">${propOpts(t.propertyId)}</select></td><td class="num ${t.amount > 0 ? 'green' : ''}"><b>${money(t.amount)}</b></td><td><button class="btn sm danger" onclick="delTx('${t.id}')">✕</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No transactions this month</td></tr>';
}
function setBudget(c, v) { S.budgets[c] = +v || 0; save() }
const tx = id => S.transactions.find(t => t.id === id);
function delTx(id) { const t = tx(id); S.transactions = S.transactions.filter(x => x.id !== id); log('Transaction deleted', `${t.desc} ${money(t.amount)}`); save() }
function openTxn() {
  modal(`<h2>Add transaction</h2><div class="form2"><div><label>Date</label><input id="tDate" type="date" value="${iso(today())}"></div><div><label>Amount</label><input id="tAmt" type="number" step="0.01"></div><div><label>Description</label><input id="tDesc"></div><div><label>Type</label><select id="tType"><option value="out">Expense</option><option value="in">Income</option></select></div><div><label>Category</label><select id="tCat">${catOpts('Other')}</select></div><div><label>Property</label><select id="tProp">${propOpts('')}</select></div></div><div class="row end" style="margin-top:16px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="tSave">Save</button></div>`);
  $('tSave').onclick = () => { const a = Math.abs(+$('tAmt').value || 0); const t = { id: uid(), date: $('tDate').value, desc: $('tDesc').value || 'Manual entry', amount: $('tType').value === 'out' ? -a : a, category: $('tCat').value, propertyId: $('tProp').value, source: 'Manual' }; S.transactions.push(t); log('Transaction added', `${t.desc} ${money(t.amount)}`, { ref: t.propertyId }); closeModal(); save() };
}

/* ---------------- Mortgage analytics ---------------- */
function mortgageSeries(pid) { return S.mortgage.filter(r => r.propertyId === pid).sort((a, b) => a.month.localeCompare(b.month)) }
function monthsBetween(a, b) { const A = pd(a), B = pd(b); return (B.getFullYear() - A.getFullYear()) * 12 + B.getMonth() - A.getMonth() }
function renderMortgage() {
  const sel = $('mgProp'), withData = [...new Set(S.mortgage.map(r => r.propertyId))], cur = sel.value || withData[0] || active()[0]?.id || '';
  sel.innerHTML = S.properties.map(p => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const h = mortgageSeries(cur), loanPts = h.filter(r => r.loan != null), netPts = h.filter(r => r.net != null), offPts = h.filter(r => r.offset != null);
  if (!netPts.length || !loanPts.length) { $('mgBody').innerHTML = `<div class="card empty">No verified loan history for this property.<br><br>Save Rapid Repay or loan statements in its Properties folder and import them from <b>Statements</b>, approve agent items, or add a month from a statement with <b>+ Month</b>.</div>`; return }
  const lf = loanPts[0], ll = loanPts.at(-1), nf = netPts[0], nl = netPts.at(-1);
  const loanRed = (lf.loan - ll.loan) / (monthsBetween(lf.month, ll.month) || 1), netRed = (nf.net - nl.net) / (monthsBetween(nf.month, nl.month) || 1);
  const payoffM = netRed > 0 && netPts.length >= 3 ? Math.ceil(nl.net / netRed) : null; const payoff = payoffM ? (() => { const d = pd(nl.month); d.setMonth(d.getMonth() + payoffM); return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) })() : '—';
  const l12 = loanPts.filter(r => monthsBetween(r.month, ll.month) <= 12); const red12 = l12.length > 1 ? l12[0].loan - ll.loan : null;
  const gaps = []; for (let i = 1; i < h.length; i++) { const g = monthsBetween(h[i - 1].month, h[i].month); if (g > 1) { const a = pd(h[i - 1].month); a.setMonth(a.getMonth() + 1); const b = pd(h[i].month); b.setMonth(b.getMonth() - 1); gaps.push(`${fmonth(iso(a))}${g > 2 ? ' – ' + fmonth(iso(b)) : ''}`) } }
  $('mgBody').innerHTML = `<div class="grid k5">${[['Current net debt', m0(nl.net), `${fmonth(nl.month)} · loan ${m0(nl.loan ?? ll.loan)}`, ''], ['Total reduction', m0(nf.net - nl.net), `Since ${fmonth(nf.month)}`, 'green'], ['Avg net reduction', m0(netRed) + '/mth', `Loan principal ${m0(loanRed)}/mth`, 'green'], ['Loan paid down (12m)', red12 != null ? m0(red12) : '—', l12[0] ? `Since ${fmonth(l12[0].month)}` : '', 'green'], ['Debt-free at this pace', payoff, payoffM ? `${Math.floor(payoffM / 12)}y ${payoffM % 12}m` : 'Needs 3+ months', '']].map(k => `<div class="card kpi"><div class="lbl">${k[0]}</div><div class="val ${k[3]}" style="font-size:22px">${k[1]}</div><div class="hint">${k[2]}</div></div>`).join('')}</div>
  <div class="card" style="margin-top:16px"><h2>Loan, offset &amp; net debt</h2>${lineChart([{ name: 'Loan balance', color: '#5b9dff', pts: loanPts.map(r => ({ x: r.month, y: r.loan })) }, { name: 'Net debt (loan − offset)', color: '#2ecc8f', area: true, pts: netPts.map(r => ({ x: r.month, y: r.net })) }])}</div>
  <div class="grid c2" style="margin-top:16px"><div class="card"><h2>Offset balance</h2>${offPts.length ? lineChart([{ name: 'Offset', color: '#a78bfa', area: true, pts: offPts.map(r => ({ x: r.month, y: r.offset })) }], { min: 0, h: 200, w: 560 }) : '<div class="empty">No offset data</div>'}</div>
   <div class="card"><h2>Coverage</h2><div>${h.length} month(s) from ${fmonth(h[0].month)} to ${fmonth(h.at(-1).month)}</div>${gaps.length ? `<div class="note warn"><b>Missing months:</b> ${gaps.join(', ')}</div>` : '<div class="note info">No gaps.</div>'}</div></div>
  <div class="card" style="margin-top:16px"><h2>Monthly history</h2><table class="stack"><thead><tr><th>Month</th><th class="num">Loan</th><th class="num">Offset</th><th class="num">Net debt</th><th class="num">Change</th><th>Source</th><th></th></tr></thead><tbody>${h.slice().reverse().map((r, i, a) => { const prev = a[i + 1]; const ch = prev && r.net != null && prev.net != null ? r.net - prev.net : null; return `<tr><td>${fmonth(r.month)}</td><td class="num">${m0(r.loan)}</td><td class="num">${m0(r.offset)}</td><td class="num"><b>${m0(r.net)}</b></td><td class="num ${ch < 0 ? 'green' : ch > 0 ? 'red' : ''}">${ch != null ? m0(ch) : ''}</td><td class="muted sm">${r.agent ? '🤖 ' : ''}${esc(r.source || '')}</td><td><button class="btn sm" onclick="openMonth('${r.id}')">Edit</button></td></tr>` }).join('')}</tbody></table></div>`;
}
function openMonth(id) {
  const r = id ? S.mortgage.find(x => x.id === id) : { propertyId: $('mgProp').value || active()[0]?.id, month: curYM(), loan: null, offset: null, source: 'Manual (from statement)' };
  modal(`<h2>${id ? 'Edit' : 'Add'} month</h2><div class="form2"><div><label>Month</label><input id="mMonth" type="month" value="${r.month}"></div><div><label>Property</label><select id="mProp">${propOpts(r.propertyId, true)}</select></div><div><label>Loan balance (month end)</label><input id="mLoan" type="number" step="0.01" value="${r.loan ?? ''}"></div><div><label>Offset balance</label><input id="mOff" type="number" step="0.01" value="${r.offset ?? ''}"></div></div><label>Source</label><input id="mSrc" value="${esc(r.source || '')}"><div class="row sp" style="margin-top:16px">${id ? `<button class="btn danger" onclick="S.mortgage=S.mortgage.filter(x=>x.id!=='${id}');log('Mortgage month deleted','');closeModal();save()">Delete</button>` : '<span></span>'}<div class="row"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="mSave">Save</button></div></div>`);
  $('mSave').onclick = () => { const o = { propertyId: $('mProp').value, month: $('mMonth').value, loan: $('mLoan').value === '' ? null : +$('mLoan').value, offset: $('mOff').value === '' ? null : +$('mOff').value, source: $('mSrc').value }; upsertMonth(o, id); log('Mortgage month saved', `${pname(o.propertyId)} ${o.month}`, { ref: o.propertyId }); closeModal(); save() };
}
function upsertMonth(o, id) {
  let r = id ? S.mortgage.find(x => x.id === id) : S.mortgage.find(x => x.propertyId === o.propertyId && x.month === o.month);
  if (!r) { r = { id: uid(), net: null }; S.mortgage.push(r) }
  const loan = o.loan ?? r.loan ?? null, offset = o.offset ?? r.offset ?? null;
  Object.assign(r, o, { loan, offset }); r.net = loan != null ? loan - (offset || 0) : null; return r;
}

/* ---------------- Portfolio ---------------- */
function renderPortfolio() {
  const rows = active().map(p => ({ p, s: stats(p) })), T = k => rows.reduce((a, r) => a + (r.s[k] || 0), 0);
  const val = rows.reduce((a, r) => a + (r.p.value || 0), 0), pur = rows.reduce((a, r) => a + (r.p.purchase || 0), 0), rentA = rows.reduce((a, r) => a + (r.p.countRent ? r.p.rentMonthly * 12 : 0), 0);
  $('pfKpis').innerHTML = [['Portfolio value', m0(val), `${active().length} held${soldList().length ? ' · ' + soldList().length + ' sold' : ''}`, ''], ['Total debt', m0(T('debt')), `Offsets ${m0(T('off'))}`, ''], ['Equity', m0(val - T('debt')), `LVR ${val ? Math.round(T('debt') / val * 100) : 0}%`, 'green'], ['Usable equity @80%', m0(T('usable')), 'Before lender buffers', 'green'], ['Rent (annual)', m0(rentA), `Cash flow ${m0(T('cash'))}/mth`, T('cash') < 0 ? 'red' : 'green']].map(k => `<div class="card kpi"><div class="lbl">${k[0]}</div><div class="val ${k[3]}">${k[1]}</div><div class="hint">${k[2]}</div></div>`).join('');
  $('pfValue').innerHTML = barChart(rows.map(r => ({ label: r.p.name, a: r.p.value || 0, b: r.s.debt, color: r.p.type === 'PPOR' ? '#5b9dff' : '#a78bfa' }))) + '<div class="legend"><span><i style="background:#5b9dff"></i>PPOR</span><span><i style="background:#a78bfa"></i>Investment</span><span><i style="border:1px dashed #f5b942"></i>Debt</span></div>';
  $('pfEquity').innerHTML = barChart(rows.map(r => ({ label: r.p.name, a: Math.max(0, r.s.equity), color: '#2ecc8f' })));
  $('pfRows').innerHTML = rows.map(({ p, s }) => `<tr onclick="go('prop:${p.id}')" style="cursor:pointer"><td><b>${esc(p.name)}</b><div class="muted sm">${esc(p.type)} · ${esc(p.owner)}</div></td><td>${esc(p.status)}</td><td class="num">${m0(p.purchase)}</td><td class="num">${m0(p.value)}</td><td class="num ${p.value >= p.purchase ? 'green' : 'red'}">${p.value && p.purchase ? m0(p.value - p.purchase) : '—'}</td><td class="num">${m0(s.debt)}</td><td class="num">${s.lvr ? Math.round(s.lvr * 100) + '%' : '—'}</td><td class="num green">${m0(s.equity)}</td><td class="num">${p.countRent ? m0(p.rentMonthly) : '—'}</td><td class="num">${s.grossYield && p.countRent ? (s.grossYield * 100).toFixed(1) + '%' : '—'}</td><td class="num ${s.cash < 0 ? 'red' : 'green'}">${m0(s.cash)}</td></tr>`).join('') + (rows.length > 1 ? `<tr class="total"><td>Total</td><td></td><td class="num">${m0(pur)}</td><td class="num">${m0(val)}</td><td class="num">${m0(val - pur)}</td><td class="num">${m0(T('debt'))}</td><td class="num">${val ? Math.round(T('debt') / val * 100) + '%' : ''}</td><td class="num">${m0(val - T('debt'))}</td><td class="num">${m0(rentA / 12)}</td><td></td><td class="num">${m0(T('cash'))}</td></tr>` : '');
  const missing = []; active().forEach(p => p.loans.forEach(l => { if (!l.repay) missing.push(`${p.name} – ${l.name}`) }));
  const uns = active().filter(p => p.unsettled).map(p => `${esc(p.name)} (${m0(stats(p).owing)} to fund)`);
  $('pfNotes').innerHTML = (uns.length ? `<div class="note">Unsettled: ${uns.join(', ')} is counted as debt so equity isn't overstated.</div>` : '') + (missing.length ? `<div class="note">Cash flow excludes loan repayments not yet entered: ${missing.map(esc).join('; ')}.</div>` : '');
  const sl = soldList();
  $('pfSold').innerHTML = sl.length ? `<h2 style="margin-top:22px">Sold properties</h2><table><thead><tr><th>Property</th><th>Sold</th><th class="num">Purchase</th><th class="num">Sale price</th><th class="num">Gross gain</th></tr></thead><tbody>${sl.map(p => `<tr onclick="go('prop:${p.id}')" style="cursor:pointer"><td><b>${esc(p.name)}</b></td><td>${p.saleDate ? fdate(p.saleDate) : '<span class="amber">add</span>'}</td><td class="num">${p.purchase ? m0(p.purchase) : '<span class="amber">add</span>'}</td><td class="num">${p.salePrice ? m0(p.salePrice) : '<span class="amber">add</span>'}</td><td class="num">${p.salePrice && p.purchase ? m0(p.salePrice - p.purchase) : '—'}</td></tr>`).join('')}</tbody></table>` : '';
}

/* ---------------- Properties ---------------- */
function renderProps() {
  let val = 0, debt = 0; active().forEach(p => { val += p.value || 0; debt += stats(p).debt });
  $('propsSum').innerHTML = `<div class="card kpi"><div class="lbl">Portfolio value</div><div class="val">${m0(val)}</div><div class="hint">Equity <b class="green">${m0(val - debt)}</b> · LVR ${val ? Math.round(debt / val * 100) : 0}%</div></div>`;
  $('propsList').innerHTML = active().map(propCard).join('') + (soldList().length ? '<div class="navsec" style="grid-column:1/-1;margin:8px 4px 0">Sold</div>' + soldList().map(propCard).join('') : '') || '<div class="card empty">No properties yet.</div>';
}
function renderPropPage() {
  const p = prop(curProp); if (!p) return go('props'); const s = stats(p);
  $('v-prop').style.backgroundImage = photo(p) ? `url('${photo(p)}')` : 'none';
  const bills = S.bills.filter(b => b.propertyId === p.id && b.status !== 'paid').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const txs = S.transactions.filter(t => t.propertyId === p.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const docs = (window._scan?.files || []).filter(f => f.propertyId === p.id && /\.pdf$/i.test(f.name)), acts = S.activity.filter(a => a.ref === p.id).slice(0, 6);
  const allInc = S.transactions.filter(t => t.propertyId === p.id && t.amount > 0).reduce((a, t) => a + t.amount, 0), allExp = -S.transactions.filter(t => t.propertyId === p.id && t.amount < 0).reduce((a, t) => a + t.amount, 0);
  const K = p.sold ? [['Sale price', p.salePrice ? m0(p.salePrice) : '—', p.saleDate ? 'Sold ' + fdate(p.saleDate) : 'Add sale date', ''], ['Purchase', p.purchase ? m0(p.purchase) : '—', '', ''], ['Gross gain', p.salePrice && p.purchase ? m0(p.salePrice - p.purchase) : '—', 'Before costs & CGT', 'green'], ['Income (all time)', m0(allInc), '', 'green'], ['Expenses (all time)', m0(allExp), '', 'red'], ['Status', 'Sold', 'Excluded from totals', '']]
    : [['Value', m0(p.value), p.valLow ? `${m0(p.valLow)}–${m0(p.valHigh)}` : '', ''], ['Purchase', m0(p.purchase), p.value && p.purchase ? `${p.value >= p.purchase ? '+' : ''}${m0(p.value - p.purchase)}` : '', p.value >= p.purchase ? 'green' : 'red'], ['Equity', m0(s.equity), s.lvr ? 'LVR ' + Math.round(s.lvr * 100) + '%' : '', 'green'], ['Net debt', m0(s.net), s.owing ? 'Incl. ' + m0(s.owing) + ' at settlement' : 'Offset ' + m0(s.off), ''], ['Rent / month', p.rentMonthly ? m0(p.rentMonthly) : '—', p.countRent ? (s.grossYield ? 'Yield ' + (s.grossYield * 100).toFixed(1) + '%' : '') : (p.rentMonthly ? 'Planned' : ''), ''], ['Cash flow / mth', m0(s.cash), 'Rent − bills − repayments', s.cash < 0 ? 'red' : 'green']];
  $('propPage').innerHTML = `
  <div class="row sp"><button class="btn sm glass" onclick="go('props')">← Properties</button><div class="row"><label class="btn sm glass" style="margin:0;text-transform:none;letter-spacing:0">📷 Cover photo<input type="file" accept="image/*" hidden onchange="setCover('${p.id}',this)"></label><button class="btn sm glass" onclick="openProp('${p.id}')">✏️ Edit</button></div></div>
  <div class="hero"><div class="row"><span class="pill p-ok">${esc(p.type)}</span><span class="pill p-verify">${esc(p.owner)}</span><span class="pill p-paid">${esc(p.status)}</span></div><h1>${esc(p.name)}</h1><div class="addr">📍 ${esc(p.address)} · 📁 ${p.folder ? 'Properties/' + esc(p.folder) : '<span class="amber">no folder linked</span>'}</div></div>
  <div class="grid k6">${K.map(k => `<div class="card glass kpi"><div class="lbl">${k[0]}</div><div class="val ${k[3]}" style="font-size:22px">${k[1]}</div><div class="hint">${k[2]}</div></div>`).join('')}</div>
  <div class="grid c2" style="margin-top:16px"><div class="card glass"><div class="row sp"><h2>Upcoming bills</h2><button class="btn sm" onclick="openBill(null,{propertyId:'${p.id}'})">+ Bill</button></div>${bills.length ? bills.map(billLine).join('') : '<div class="empty">No open bills</div>'}</div>
   <div class="card glass"><h2>Loans</h2>${p.loans.length ? `<table><tr><th>Loan</th><th class="num">Balance</th><th class="num">Offset</th><th class="num">Rate</th><th class="num">Repay/mth</th></tr>${p.loans.map(l => `<tr><td>${esc(l.name)}${l.available ? `<div class="muted sm">Available ${m0(l.available)}</div>` : ''}</td><td class="num">${m0(l.balance)}</td><td class="num">${l.offset ? m0(l.offset) : '—'}</td><td class="num">${l.rate ? l.rate + '%' : '<span class="amber">add</span>'}</td><td class="num">${l.repay ? m0(l.repay) : '<span class="amber">add</span>'}</td></tr>`).join('')}</table>` : '<div class="empty">No loans</div>'}
    ${s.debt && !p.sold ? `<div class="note info">Usable equity to 80% LVR: <b>${m0(s.usable)}</b></div>` : ''}${p.valBasis ? `<div class="muted sm" style="margin-top:10px">Valuation ${fdate(p.valDate)}: ${esc(p.valBasis)}</div>` : ''}${p.notes ? `<div class="note">${esc(p.notes)}</div>` : ''}
    ${S.mortgage.some(r => r.propertyId === p.id) ? `<button class="btn sm" style="margin-top:10px" onclick="go('mortgage');$('mgProp').value='${p.id}';renderMortgage()">📈 Mortgage analytics</button>` : ''}</div></div>
  <div class="grid c3" style="margin-top:16px"><div class="card glass"><h2>Transactions</h2><div class="row" style="gap:20px;margin-bottom:8px"><span>Income YTD <b class="green">${m0(s.incYTD)}</b></span><span>Expenses YTD <b class="red">${m0(s.expYTD)}</b></span></div><table>${txs.length ? txs.map(t => `<tr><td class="nowrap">${fdate(t.date)}</td><td>${esc(t.desc)}</td><td class="num ${t.amount > 0 ? 'green' : ''}"><b>${money(t.amount)}</b></td></tr>`).join('') : '<tr><td class="empty">None yet</td></tr>'}</table></div>
   <div class="card glass"><div class="row sp"><h2>Documents</h2><button class="btn sm" onclick="runScan(true)">↻ Scan</button></div>${!p.folder ? '<div class="empty">Link a Properties folder via Edit</div>' : window._scan ? (docs.length ? `<table>${docs.slice(0, 40).map(f => { const d = S.documents[f.path]; return `<tr><td>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">📄 ${esc(f.rel)}</a>` : '📄 ' + esc(f.rel)}</td><td class="nowrap">${d ? `<span class="pill ${d.status === 'imported' ? 'p-paid' : 'p-ok'}">${d.by && d.by !== 'you' ? '🤖 ' : ''}${d.status}</span>` : f.offline ? '<span class="pill p-soon">cloud only</span>' : '<span class="pill p-verify">new</span>'}</td></tr>` }).join('')}</table>` : '<div class="empty">No PDFs in this folder</div>') : '<div class="empty">Scanning…</div>'}</div>
   <div class="card glass"><div class="row sp"><h2>Recent activity</h2><button class="btn sm" onclick="actFilter.q=prop('${p.id}').name;go('activity')">All →</button></div>${acts.length ? acts.map(actLine).join('') : '<div class="empty">No activity yet</div>'}</div></div>`;
}
function openProp(id) {
  const p = id ? prop(id) : { name: '', folder: '', address: '', type: 'Investment', owner: 'Personal', status: '', purchase: null, value: null, loans: [], rentMonthly: 0, countRent: true, notes: '', entity: 'personal', ownPct: 100 };
  const loanRow = l => `<div class="form3" data-loan data-id="${l.id || ''}"><div><label>Loan</label><input data-f="name" value="${esc(l.name || '')}"></div><div><label>Balance</label><input data-f="balance" type="number" value="${l.balance ?? ''}"></div><div><label>Offset</label><input data-f="offset" type="number" value="${l.offset ?? ''}"></div><div><label>Rate %</label><input data-f="rate" type="number" step="0.01" value="${l.rate ?? ''}"></div><div><label>Repay/mth</label><input data-f="repay" type="number" value="${l.repay ?? ''}"></div><div><label>Available</label><input data-f="available" type="number" value="${l.available ?? ''}"></div></div>`;
  const folders = [...new Set([...(window._folders || []), p.folder].filter(Boolean))];
  const I = (id, lab, v, t = 'text', st = '') => `<div><label>${lab}</label><input id="${id}" type="${t}" ${st} value="${esc(v ?? '')}"></div>`;
  const Sel = (id, lab, opts, v) => `<div><label>${lab}</label><select id="${id}">${opts.map(([k, t]) => `<option value="${k}" ${String(v) === String(k) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  modal(`<h2>${id ? 'Edit' : 'Add'} property</h2><div class="form2">${I('prName', 'Name', p.name)}<div><label>Linked folder (Properties/…)</label><select id="prFolder"><option value="">— none —</option>${folders.map(f => `<option ${f === p.folder ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></div></div>${I('prAddr', 'Address', p.address)}
  <div class="form2">${Sel('prType', 'Type', [['PPOR', 'PPOR'], ['Investment', 'Investment']], p.type)}${I('prOwner', 'Ownership', p.owner)}${Sel('prEnt', 'Entity', [['personal', 'Personal'], ['smsf', 'SMSF']], p.entity || 'personal')}${I('prOwn', 'Ownership %', p.ownPct ?? 100, 'number')}${I('prStatus', 'Status', p.status)}${I('prPurD', 'Purchase / settlement date', p.purchaseDate, 'date')}${I('prPur', 'Purchase price', p.purchase, 'number')}${I('prDuty', 'Stamp duty', p.stampDuty, 'number')}${I('prPC', 'Other acquisition costs', p.purchaseCosts, 'number')}${I('prVal', 'Current value', p.value, 'number')}${I('prRent', 'Rent / month', p.rentMonthly || '', 'number', 'step="0.01"')}${Sel('prCount', 'Rent in cash flow?', [[1, 'Yes'], [0, 'No']], p.countRent ? 1 : 0)}${I('prRentFrom', 'Rented from', p.rentedFrom, 'date')}${Sel('prUns', 'Settled?', [[0, 'Yes'], [1, 'No – off the plan']], p.unsettled ? 1 : 0)}${I('prDep', 'Deposit paid (if unsettled)', p.deposit, 'number')}${Sel('prSold', 'Sold?', [[0, 'No – held'], [1, 'Yes – sold']], p.sold ? 1 : 0)}${I('prSaleD', 'Sale date', p.saleDate, 'date')}${I('prSaleP', 'Sale price', p.salePrice, 'number')}${I('prSaleC', 'Selling costs', p.saleCosts, 'number')}</div>
  ${I('prNotes', 'Notes', p.notes)}<h3 style="margin-top:16px">Loans</h3><div id="loanWrap">${p.loans.map(loanRow).join('')}</div><button class="btn sm" id="addLoan" style="margin-top:8px">+ Loan</button>
  <div class="row sp" style="margin-top:16px">${id ? `<button class="btn danger" onclick="delProp('${id}')">Delete</button>` : '<span></span>'}<div class="row"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="prSave">Save</button></div></div>`);
  $('addLoan').onclick = () => $('loanWrap').insertAdjacentHTML('beforeend', loanRow({}));
  $('prSave').onclick = () => {
    const n = v => v === '' || v == null ? null : +v, v = id => $(id).value, o = id ? p : { id: 'p' + uid() };
    o.loans = [...document.querySelectorAll('[data-loan]')].map(r => { const l = { ...(p.loans.find(x => x.id === r.dataset.id) || {}), id: r.dataset.id || uid() }; r.querySelectorAll('[data-f]').forEach(i => l[i.dataset.f] = i.dataset.f === 'name' ? i.value : n(i.value)); return l }).filter(l => l.name || l.balance);
    Object.assign(o, { name: v('prName') || 'Property', folder: v('prFolder'), address: v('prAddr'), type: v('prType'), owner: v('prOwner'), entity: v('prEnt'), ownPct: n(v('prOwn')) ?? 100, status: v('prStatus'), purchaseDate: v('prPurD') || null, purchase: n(v('prPur')), stampDuty: n(v('prDuty')), purchaseCosts: n(v('prPC')), value: n(v('prVal')), rentMonthly: +v('prRent') || 0, countRent: v('prCount') === '1', rentedFrom: v('prRentFrom') || null, unsettled: v('prUns') === '1', deposit: n(v('prDep')), sold: v('prSold') === '1', saleDate: v('prSaleD') || null, salePrice: n(v('prSaleP')), saleCosts: n(v('prSaleC')), notes: v('prNotes') });
    if (o.sold) { o.status = 'Sold'; o.countRent = false } if (!id) S.properties.push(o); log(id ? 'Property edited' : 'Property added', o.name, { ref: o.id }); closeModal(); save();
  };
}
function delProp(id) { const p = prop(id); if (!confirm(`Delete ${p.name}? Its bills and transactions are kept but unlinked.`)) return; S.properties = S.properties.filter(x => x.id !== id); S.bills.forEach(b => { if (b.propertyId === id) b.propertyId = '' }); S.transactions.forEach(t => { if (t.propertyId === id) t.propertyId = '' }); log('Property deleted', p.name); closeModal(); go('props'); save() }

/* ---------------- Mobile ---------------- */
const ICON = { home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>', bills: '<svg viewBox="0 0 24 24"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4"/></svg>', props: '<svg viewBox="0 0 24 24"><path d="M3 21V9l6-4 6 4v12M15 21V12l6 3v6M7 12h4M7 16h4M2 21h20"/></svg>', inbox: '<svg viewBox="0 0 24 24"><path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 13h5l1 3h6l1-3h5"/></svg>', more: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>' };
const TITLES = { dashboard: 'Dashboard', portfolio: 'Portfolio', mortgage: 'Mortgage', bills: 'Bills', spending: 'Spending', props: 'Properties', tax: 'Tax & accountant', inbox: 'Agent inbox', activity: 'Activity', import: 'Statements' };
function toggleMore(o) { document.body.classList.toggle('drawer-open', o) }
function renderBnav() {
  const ib = Inbox.items.length + (window._tbPending || []).length, over = S.bills.filter(b => ['over', 'soon'].includes(billState(b).k)).length;
  const tab = (v, ic, label, badge, on) => `<button class="${on ? 'on' : ''}" onclick="${v === 'more' ? 'toggleMore(true)' : `go('${v}')`}">${ICON[ic]}<span>${label}</span>${badge ? `<i class="bd">${badge}</i>` : ''}</button>`;
  $('bnav').innerHTML = tab('dashboard', 'home', 'Home', 0, view === 'dashboard') + tab('bills', 'bills', 'Bills', over, view === 'bills') + tab('props', 'props', 'Properties', 0, view === 'props' || view === 'prop') + tab('inbox', 'inbox', 'Inbox', ib, view === 'inbox') + tab('more', 'more', 'More', 0, !['dashboard', 'bills', 'props', 'prop', 'inbox'].includes(view));
  $('mTitle').textContent = view === 'prop' ? (prop(curProp)?.name || '') : TITLES[view] || '';
}
function quickAdd() { modal(`<h2>Quick add</h2><div class="qa"><button class="btn" onclick="closeModal();openBill()">🧾<span>Add bill</span></button><button class="btn" onclick="closeModal();openTxn()">💳<span>Add expense</span></button><button class="btn" onclick="closeModal();checkAgents(true)">📬<span>Check inbox</span></button><button class="btn" onclick="closeModal();runScan()">📥<span>Scan statements</span></button></div><button class="btn" style="width:100%;margin-top:12px" onclick="closeModal()">Cancel</button>`) }
/* ---------------- PDF reading (bundled pdf.js, same origin) ---------------- */
let pdfjs = null;
async function loadPdfJs() { if (pdfjs) return pdfjs; pdfjs = await import(new URL('lib/pdf.min.mjs', location.href).href); pdfjs.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.mjs', location.href).href; return pdfjs }
async function pdfText(blob) { const lib = await loadPdfJs(); const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise; let t = ''; for (let i = 1; i <= Math.min(doc.numPages, 15); i++) { const c = await (await doc.getPage(i)).getTextContent(); t += c.items.map(x => x.str).join(' ') + '\n' } return t.replace(/[ \t]+/g, ' ') }

/* ---------------- Statement classification ---------------- */
const num = s => s == null || s === '' ? NaN : typeof s === 'number' ? s : +String(s).replace(/A\$|\$|,|\s/g, '').replace(/CR$/i, '');
function toISO(s) { s = (s || '').trim(); let m; const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  if (m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if (m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/)) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/)) { const mo = MON[m[2].slice(0, 3).toLowerCase()]; if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  if (m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/)) { const mo = MON[m[1].slice(0, 3).toLowerCase()]; if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}` }
  return null }
const DATE_RE = '(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4}|\\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3,9}\\.? \\d{4}|[A-Za-z]{3,9} \\d{1,2},? \\d{4})';
const AMT = '\\$?\\s?(-?[\\d,]+\\.\\d{2})';
function find(t, labels, pat = AMT) { const gap = pat === AMT ? '.{0,45}?' : '[^$\\d]{0,40}'; for (const l of labels) { const m = t.match(new RegExp(l.replace(/\((?!\?)/g, '(?:') + gap + pat, 'i')); if (m) return m[1] } return null }
function classify(t, name) {
  const r = { fields: {} }, T = t.slice(0, 20000), F = r.fields;
  if (/rapid repay/i.test(T + name) && /(calculator|could be mortgage-free|estimates only|plan comparison)/i.test(T)) { r.kind = 'info'; r.note = 'Rapid Repay calculator projection – not a statement, ignored'; return r }
  if (/rental statement|owner statement|statement of account.*(rent|owner)|you received|money in.*money out|rent received/i.test(T)) {
    r.kind = 'rental'; Object.assign(F, { rent: num(find(T, ['rent received', 'rent', 'income', 'money in', 'total income'])), expenses: num(find(T, ['total expenses', 'expenses', 'money out', 'total disbursements'])), net: num(find(T, ['you received', 'amount paid to you', 'net amount', 'payment to owner', 'eft to owner', 'total paid'])), date: toISO(find(T, ['statement date', 'period ending', 'to', 'date'], DATE_RE) || '') });
  } else if (/settlement statement|statement of adjustments|balance (due|payable) (at|on) settlement|transferee/i.test(T + name)) {
    r.kind = 'settlement'; Object.assign(F, { price: num(find(T, ['purchase price', 'contract price', 'price'])), balance: num(find(T, ['balance (due|payable) (at|on) settlement', 'balance to settle', 'amount required to settle', 'funds required'])), date: toISO(find(T, ['settlement date', 'date of settlement', 'adjustment date'], DATE_RE) || '') });
  } else if (/(rapid repay|home loan|investment loan|loan account|closing balance|balance owing|offset)/i.test(T + name) && /(interest|principal|repayment|offset|net debt)/i.test(T)) {
    r.kind = 'loan'; Object.assign(F, { loan: num(find(T, ['closing loan balance', 'loan closing balance', 'closing balance', 'balance owing', 'loan balance', 'balance as at', 'current balance'])), offset: num(find(T, ['offset (account )?(closing )?balance', 'offset'])), rate: num(find(T, ['interest rate', 'variable rate', 'rate'], '(\\d{1,2}\\.\\d{1,3})\\s?%')), repay: num(find(T, ['repayment amount', 'minimum repayment', 'monthly repayment', 'repayment'])), interest: num(find(T, ['interest charged', 'total interest', 'interest'])), date: toISO(find(T, ['closing balance (as )?(at|on)', 'statement period.{0,30}to', 'period ending', 'to', 'as at'], DATE_RE) || '') });
  } else if (/amount due|total due|due date|pay by|rates notice|levy notice|tax invoice|invoice|water|electricity|gas/i.test(T)) {
    r.kind = 'bill'; Object.assign(F, { amount: num(find(T, ['amount due', 'total due', 'amount payable', 'total amount due', 'balance due', 'amount owing', 'total \\(inc', 'total'])), due: toISO(find(T, ['due date', 'pay by', 'payment due', 'due by', 'due on', 'due'], DATE_RE) || '') });
    const B = [[/onkaparinga|council rates|rates notice/i, 'City of Onkaparinga', 'Council & Rates', 'quarterly'], [/port phillip/i, 'City of Port Phillip', 'Council & Rates', 'quarterly'], [/melbourne city council|city of melbourne/i, 'City of Melbourne', 'Council & Rates', 'quarterly'], [/sa water/i, 'SA Water', 'Utilities', 'quarterly'], [/south east water|city west water|greater western water/i, 'Water', 'Utilities', 'quarterly'], [/origin|agl|energyaustralia|electricity/i, 'Energy', 'Utilities', 'quarterly'], [/owners corporation|strata|levy/i, 'Owners corporation', 'Strata', 'quarterly'], [/land tax|revenuesa|state revenue/i, 'Land tax', 'Property Costs', 'annual'], [/insurance|policy/i, 'Insurer', 'Insurance', 'annual']];
    const b = B.find(x => x[0].test(T + name)); Object.assign(F, { biller: b?.[1] || '', category: b?.[2] || 'Other', freq: b?.[3] || 'once' });
  } else r.kind = 'info';
  for (const k in F) if (typeof F[k] === 'number' && isNaN(F[k])) F[k] = null;
  return r;
}

/* ---------------- Review form + apply ---------------- */
const KINDS = ['rental', 'loan', 'bill', 'settlement', 'transaction', 'info'];
function reviewForm(kind, F) {
  const I = (id, lab, v, t = 'number') => `<div><label>${lab}</label><input id="${id}" type="${t}" ${t === 'number' ? 'step="0.01"' : ''} value="${esc(v ?? '')}"></div>`;
  return { rental: `<div class="form2">${I('fDate', 'Statement date', F.date, 'date')}${I('fRent', 'Rent received', F.rent)}${I('fExp', 'Agent expenses', F.expenses)}${I('fNet', 'Paid to you', F.net)}</div>`,
    loan: `<div class="form2">${I('fDate', 'Balance date', F.date, 'date')}${I('fLoan', 'Loan closing balance', F.loan)}${I('fOff', 'Offset balance', F.offset)}${I('fRate', 'Interest rate %', F.rate)}${I('fRepay', 'Repayment', F.repay)}${I('fInt', 'Interest charged (this statement)', F.interest)}</div><label class="chk"><input type="checkbox" id="fUpd" checked> Also update the property's current loan balance</label>`,
    bill: `<div class="form2">${I('fBiller', 'Biller', F.biller, 'text')}${I('fAmt', 'Amount', F.amount)}${I('fDue', 'Due date', F.due, 'date')}<div><label>Category</label><select id="fCat">${catOpts(F.category || 'Other')}</select></div><div><label>Repeats</label><select id="fFreq">${Object.entries(FREQ).map(([a, b]) => `<option value="${a}" ${(F.freq || 'once') === a ? 'selected' : ''}>${b}</option>`).join('')}</select></div>${I('fRef', 'Reference', F.reference, 'text')}</div>`,
    settlement: `<div class="form2">${I('fDate', 'Settlement date', F.date, 'date')}${I('fPrice', 'Purchase price', F.price)}${I('fBal', 'Balance at settlement', F.balance)}</div><label class="chk"><input type="checkbox" id="fUpd" checked> Update the property's purchase price and date</label>`,
    transaction: `<div class="form2">${I('fDate', 'Date', F.date, 'date')}${I('fAmt', 'Amount (negative = expense)', F.amount)}${I('fDesc', 'Description', F.desc, 'text')}<div><label>Category</label><select id="fCat">${catOpts(F.category || 'Other')}</select></div></div>`,
    info: `<p class="muted">Reference document – nothing to import. It will be marked as filed.</p>` }[kind];
}
function readForm() { const v = id => $(id)?.value, n = id => v(id) === '' || v(id) == null ? null : +v(id); return { date: v('fDate'), rent: n('fRent'), expenses: n('fExp'), net: n('fNet'), loan: n('fLoan'), offset: n('fOff'), rate: n('fRate'), repay: n('fRepay'), interest: n('fInt'), biller: v('fBiller'), amount: n('fAmt'), due: v('fDue'), category: v('fCat'), freq: v('fFreq'), reference: v('fRef'), price: n('fPrice'), balance: n('fBal'), desc: v('fDesc'), taxCategory: (window._rvFields || {}).taxCategory, update: $('fUpd') ? $('fUpd').checked : true } }
function validate(kind, F, pid) {
  const w = [];
  if (!pid && ['rental', 'loan', 'settlement'].includes(kind)) w.push('No property matched');
  if (kind === 'rental' && F.rent == null) w.push('Rent amount missing');
  if (kind === 'loan' && F.loan == null && F.offset == null) w.push('No loan or offset balance');
  if (kind === 'loan' && !F.date) w.push('Balance date missing');
  if (kind === 'bill' && F.amount == null) w.push('Amount missing');
  if (kind === 'bill' && !F.due) w.push('Due date missing');
  if (kind === 'transaction' && (F.amount == null || !F.date)) w.push('Date or amount missing');
  if (kind === 'loan' && F.loan != null && pid) { const cur = prop(pid)?.loans?.[0]?.balance; if (cur && Math.abs(F.loan - cur) / cur > .25) w.push(`Loan balance differs from current by >25% (${m0(cur)})`) }
  if (F.date && days(F.date) > 60) w.push('Date is in the future');
  return w;
}
function applyImport(kind, pid, F, meta = {}) {
  const src = meta.source || 'Import', tag = meta.agent ? { agent: meta.agent } : {}; let summary = '';
  if (kind === 'rental') { const d = F.date || iso(today()); if (F.rent) S.transactions.push({ id: uid(), date: d, desc: 'Rent', amount: F.rent, category: 'Rent', propertyId: pid, source: src, ...tag }); if (F.expenses) S.transactions.push({ id: uid(), date: d, desc: 'Agent expenses', amount: -Math.abs(F.expenses), category: 'Property Costs', propertyId: pid, source: src, ...tag }); summary = `Rent ${m0(F.rent)}, expenses ${m0(F.expenses)}` }
  if (kind === 'loan') { const d = F.date || iso(today()); const r = upsertMonth({ propertyId: pid, month: d.slice(0, 7), loan: F.loan, offset: F.offset, interest: F.interest, source: src }); if (meta.agent) r.agent = meta.agent; const p = prop(pid); if (F.update && p && p.loans[0]) { if (F.loan != null) p.loans[0].balance = F.loan; if (F.offset != null) p.loans[0].offset = F.offset; if (F.rate) p.loans[0].rate = F.rate; if (F.repay) p.loans[0].repay = F.repay } summary = `Loan ${m0(F.loan)} / offset ${m0(F.offset)} (${d.slice(0, 7)})` }
  if (kind === 'bill') { const name = (F.biller || 'Bill') + (F.reference ? ' – ' + F.reference : ''); if (S.bills.some(b => b.biller === F.biller && b.dueDate === F.due && b.amount === F.amount)) summary = 'Bill already exists – skipped'; else { S.bills.push({ id: uid(), name, biller: F.biller || '', amount: F.amount, dueDate: F.due || null, category: F.category || 'Other', freq: F.freq || 'once', propertyId: pid, status: F.amount != null && F.due ? 'due' : 'verify', notes: '', doc: meta.docKey || '', ...tag }); summary = `${name} ${m0(F.amount)} due ${fdate(F.due)}` } }
  if (kind === 'settlement') { const p = prop(pid); if (F.update && p) { if (F.price) p.purchase = F.price; if (F.date && !p.purchaseDate) p.purchaseDate = F.date } summary = `Price ${m0(F.price)}` }
  if (kind === 'transaction') { S.transactions.push({ id: uid(), date: F.date || iso(today()), desc: F.desc || 'Transaction', amount: F.amount || 0, category: F.category || 'Other', propertyId: pid, source: src, ...(F.taxCategory && typeof ATO_ALL !== 'undefined' && ATO_ALL.includes(F.taxCategory) ? { taxCat: F.taxCategory } : {}), ...tag }); summary = `${F.desc || 'Transaction'} ${money(F.amount)}` }
  if (kind === 'info') summary = 'Filed as reference';
  if (meta.docKey) S.documents[meta.docKey] = { status: kind === 'info' ? 'info' : 'imported', kind, propertyId: pid, summary, at: iso(today()), by: meta.agent || 'you' };
  return summary;
}
function openReview({ title, sub, kind, propertyId, fields, text, warn = [], buttons }) {
  window._rvFields = fields;
  modal(`<h2>${title}</h2><div class="muted sm">${sub}</div>${warn.length ? `<div class="note warn">⚠ ${warn.map(esc).join(' · ')}</div>` : ''}<div class="form2"><div><label>Type</label><select id="rKind">${KINDS.map(x => `<option ${x === kind ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div><label>Property</label><select id="rProp">${propOpts(propertyId)}</select></div></div><div id="rForm">${reviewForm(kind, fields)}</div>${text ? `<details style="margin-top:12px"><summary class="muted sm">Show extracted text</summary><pre class="pre">${esc(text.slice(0, 4000))}</pre></details>` : ''}<div class="row end" style="margin-top:16px">${buttons}</div>`);
  $('rKind').onchange = e => { $('rForm').innerHTML = reviewForm(e.target.value, fields) };
}

/* ---------------- Statement scanning (Properties) ---------------- */
async function runScan(quiet) {
  try {
    const folders = (await Store.list(P_PROPS)).filter(i => i.dir).map(i => i.name).sort(); window._folders = folders; const files = [];
    for (const f of folders) { const pid = S.properties.find(p => p.folder === f)?.id || ''; (await walk(`${P_PROPS}/${f}`)).forEach(x => files.push({ ...x, rel: x.path.split('/').slice(2).join('/'), folder: f, propertyId: pid })) }
    const pending = files.filter(f => /\.pdf$/i.test(f.name) && !S.documents[f.path] && !Inbox.items.some(i => i.data.sourceFile === f.path));
    window._scan = { at: new Date(), files, pending, folders };
    if (!quiet) { log('Folder scan', `${files.length} files · ${pending.length} new PDFs`, { actor: 'portal' }); save(); toast(`${files.length} files · ${pending.length} new PDFs`) } else renderAll();
  } catch (e) { if (e.auth) return needSignIn(e.message); toast('Scan failed: ' + e.message) }
}
function renderImport() {
  $('connState').innerHTML = `<span class="pill p-paid">Connected</span> ${esc(Store.label)}${Auth.tok?.user && Store === Cloud ? ' as <b>' + esc(Auth.tok.user) + '</b>' : ''} · authenticated private data`;
  const sc = window._scan; if (!sc) { $('scanOut').innerHTML = '<div class="empty">Scanning…</div>'; return }
  const byFolder = {}; sc.pending.forEach(f => (byFolder[f.folder] ||= []).push(f));
  $('scanOut').innerHTML = `<div class="row" style="gap:16px;margin-bottom:12px"><span>Scanned ${sc.at.toLocaleTimeString('en-AU')}</span><span>${sc.files.length} files</span><span class="amber">${sc.pending.length} new PDFs</span></div>` +
    (sc.pending.length ? Object.entries(byFolder).map(([f, list]) => `<h3 style="margin-top:14px">📁 ${esc(f)}${list[0].propertyId ? ' → ' + esc(pname(list[0].propertyId)) : ' <span class="amber">(not linked to a property)</span>'}</h3><table class="stack">${list.map(x => `<tr><td>📄 ${esc(x.rel)}<div class="muted sm">${x.modified ? new Date(x.modified).toLocaleDateString('en-AU') : ''} · ${Math.round((x.size || 0) / 1024)} KB</div></td><td class="nowrap" style="text-align:right">${x.offline ? '<span class="pill p-soon">cloud only</span>' : `<button class="btn sm primary" onclick="reviewDoc('${encodeURIComponent(x.path)}')">Read &amp; review</button>`} <button class="btn sm" onclick="ignoreDoc('${encodeURIComponent(x.path)}')">Ignore</button></td></tr>`).join('')}</table>`).join('') : '<div class="empty">No new statements 🎉</div>');
}
function ignoreDoc(k) { k = decodeURIComponent(k); S.documents[k] = { status: 'ignored', at: iso(today()), by: 'you' }; if (window._scan) window._scan.pending = window._scan.pending.filter(f => f.path !== k); log('Document ignored', k.split('/').at(-1)); save() }
async function reviewDoc(k) {
  k = decodeURIComponent(k); const f = window._scan.files.find(x => x.path === k);
  modal(`<h2>Reading…</h2><div class="muted">${esc(f.rel)}</div>`);
  let text = ''; try { text = await pdfText(await Store.getBlob(f.path)) } catch (e) { modal(`<h2>Couldn't read PDF</h2><p class="muted">${esc(e.message)}</p><div class="row end"><button class="btn" onclick="closeModal()">Close</button></div>`); return }
  const r = classify(text, f.name), scanned = text.trim().length < 40;
  openReview({ title: '📄 ' + esc(f.name), sub: `${esc(f.folder)} · detected <b>${r.kind}</b>${r.note ? ' · ' + esc(r.note) : ''}${scanned ? ' · <span class="red">no text – scanned image?</span>' : ''}`, kind: r.kind, propertyId: f.propertyId, fields: r.fields, text, warn: validate(r.kind, r.fields, f.propertyId),
    buttons: `<button class="btn" onclick="closeModal()">Later</button><button class="btn" onclick="ignoreDoc('${encodeURIComponent(k)}');closeModal()">Ignore</button><button class="btn primary" id="rGo">Import</button>` });
  $('rGo').onclick = () => { const kind = $('rKind').value, pid = $('rProp').value, s = applyImport(kind, pid, readForm(), { source: f.rel, docKey: k }); window._scan.pending = window._scan.pending.filter(x => x.path !== k); log('Statement imported', `${f.name}: ${s}`, { ref: pid }); closeModal(); save(); toast('Imported') };
}

/* ---------------- Agent inbox (Portal/data/inbox/*.json, schema cjp-inbox/1) ---------------- */
const Inbox = {
  items: [], invalid: [], dupes: [], checkedAt: null,
  async load() {
    this.items = []; this.invalid = []; this.dupes = []; let fresh = 0;
    for (const it of (await Store.list(P_INBOX)).filter(i => !i.dir && /\.json$/i.test(i.name))) {
      const file = it.name; let d; try { d = JSON.parse(await Store.readText(`${P_INBOX}/${file}`)) } catch (e) { this.invalid.push({ file, error: 'Not valid JSON' }); continue }
      const err = this.check(d); if (err) { this.invalid.push({ file, error: err, data: d }); continue }
      d.id = String(d.id); d.fields = this.normalise(d.kind, d.fields || {});
      const pid = resolveProperty(d.property) || resolveProperty((d.sourceFile || '').split('/')[1]), item = { file, data: d, pid, warn: validate(d.kind, d.fields, pid) };
      const seen = S.inboxSeen[d.id];
      if (seen === 'approved' || seen === 'rejected' || (d.sourceFile && ['imported', 'info'].includes(S.documents[d.sourceFile]?.status))) { item.reason = seen ? `Item ${seen} before` : 'Source file already imported'; this.dupes.push(item); continue }
      if (!seen) { S.inboxSeen[d.id] = 'pending'; fresh++; log('Inbox item received', `${d.kind}: ${this.label(d)}`, { actor: this.actor(d), at: d.created, ref: pid, status: item.warn.length ? 'warn' : 'ok' }) }
      this.items.push(item);
    }
    this.items.sort((a, b) => (a.data.created || '').localeCompare(b.data.created || '')); this.checkedAt = new Date(); return fresh;
  },
  check(d) { if (d.schema !== 'cjp-inbox/1') return 'schema must be "cjp-inbox/1"'; if (!d.id) return 'missing id'; if (!KINDS.includes(d.kind)) return `kind must be one of ${KINDS.join(', ')}`; if (d.fields != null && typeof d.fields !== 'object') return 'fields must be an object'; return null },
  normalise(kind, f) { const o = { ...f }; ['rent', 'expenses', 'net', 'loan', 'offset', 'rate', 'repay', 'interest', 'amount', 'price', 'balance'].forEach(k => { if (k in o) { const v = num(o[k]); o[k] = isNaN(v) ? null : v } }); ['date', 'due'].forEach(k => { if (o[k]) o[k] = toISO(String(o[k])) || null }); if (kind === 'bill' && o.dueDate && !o.due) o.due = toISO(o.dueDate); return o },
  actor: d => 'agent:' + (d.agent || 'Copilot agent'),
  label(d, file) { d = d || {}; const f = d.fields || {}; return (d.sourceFile ? d.sourceFile.split('/').at(-1) : '') || f.biller || f.desc || d.kind || file || 'item' },
  async archive(item, outcome) { try { await moveFile(`${P_INBOX}/${item.file}`, `${P_INBOX}/${outcome === 'approved' ? 'processed' : 'rejected'}`) } catch (e) { console.warn(e) } },
  async approve(item, kind, pid, F) {
    const d = item.data, s = applyImport(kind, pid, F, { source: (d.sourceFile ? d.sourceFile.split('/').slice(2).join('/') : 'Agent') + ' · ' + (d.agent || 'agent'), agent: d.agent || 'Copilot agent', docKey: d.sourceFile || '' });
    S.inboxSeen[d.id] = 'approved'; await this.archive(item, 'approved'); this.items = this.items.filter(i => i !== item);
    if (window._scan) window._scan.pending = window._scan.pending.filter(x => x.path !== d.sourceFile);
    log('Agent item approved', `${s} — from ${d.agent || 'agent'}${d.confidence != null ? ` (${Math.round(d.confidence * 100)}%)` : ''}`, { ref: pid }); return s;
  },
  async reject(item, why) { const d = item.data || {}; if (d.id && S.inboxSeen[d.id] !== 'approved') S.inboxSeen[d.id] = 'rejected'; await this.archive(item, 'rejected'); ['items', 'invalid', 'dupes'].forEach(k => this[k] = this[k].filter(i => i !== item)); log(item.reason ? 'Duplicate dismissed' : 'Agent item rejected', `${this.label(d, item.file)}${why ? ' – ' + why : ''}`, { ref: item.pid || '', status: 'warn' }) }
};
async function loadAgentRuns() {
  let fresh = 0;
  for (const it of (await Store.list(P_LOG)).filter(i => !i.dir && /\.json$/i.test(i.name))) {
    let d; try { d = JSON.parse(await Store.readText(`${P_LOG}/${it.name}`)) } catch (e) { continue }
    for (const r of Array.isArray(d) ? d : [d]) {
      if (r.schema !== 'cjp-agentrun/1' || !r.runId || S.runsSeen[r.runId]) continue; S.runsSeen[r.runId] = true; fresh++;
      const st = r.status === 'failed' ? 'error' : r.status === 'partial' || (r.errors || []).length ? 'warn' : 'ok';
      S.runs.unshift({ runId: r.runId, agent: r.agent || 'Copilot agent', trigger: r.trigger || '', finished: r.finished || r.started, status: r.status || 'success', created: r.created ?? null, errors: r.errors || [], message: r.message || '' });
      log('Agent run', [r.trigger, r.checked != null ? r.checked + ' checked' : '', r.created != null ? r.created + ' sent to inbox' : '', r.message, (r.errors || []).length ? r.errors.length + ' error(s): ' + r.errors.slice(0, 2).join('; ') : ''].filter(Boolean).join(' · '), { actor: 'agent:' + (r.agent || 'Copilot agent'), at: r.finished || r.started, status: st });
    }
  }
  S.runs.sort((a, b) => (b.finished || '').localeCompare(a.finished || '')); if (S.runs.length > 300) S.runs.length = 300; return fresh;
}
function agentHealth() {
  const by = {}; S.runs.forEach(r => (by[r.agent] ||= []).push(r));
  const agents = Object.entries(by).map(([name, runs]) => { const last = runs[0], stale = (Date.now() - new Date(last.finished)) / 864e5 > S.settings.agentStaleDays; return { name, last, runs: runs.length, fails: runs.filter(r => r.status === 'failed').length, state: last.status === 'failed' ? 'error' : stale ? 'stale' : last.status === 'partial' || last.errors.length ? 'warn' : 'ok' } });
  return { agents, problems: agents.filter(a => a.state === 'error' || a.state === 'stale').length };
}
function agentHealthHtml(compact) {
  const h = agentHealth(), ib = Inbox.items.length + (window._tbPending || []).length;
  const pill = { ok: ['p-paid', 'Healthy'], warn: ['p-soon', 'Warnings'], error: ['p-over', 'Last run failed'], stale: ['p-over', `No run in ${S.settings.agentStaleDays}+ days`] };
  return (h.agents.length ? h.agents.map(a => `<div class="list-item"><div class="date-chip">🤖</div><div class="grow"><b>${esc(a.name)}</b> <span class="pill ${pill[a.state][0]}">${pill[a.state][1]}</span><div class="muted sm">Last run ${ago(a.last.finished)}${a.last.trigger ? ' · ' + esc(a.last.trigger) : ''}${compact ? '' : ` · ${a.runs} runs, ${a.fails} failed`}</div>${a.last.errors.length && !compact ? `<div class="red sm">${a.last.errors.slice(0, 3).map(esc).join('<br>')}</div>` : ''}</div></div>`).join('') : `<div class="empty sm">No agent runs recorded yet. Agents report by writing to <code>the private agent activity store</code>.</div>`) + (ib ? `<div class="note">${ib} item(s) waiting in the inbox. <a href="#" onclick="go('inbox');return false">Review →</a></div>` : '');
}
const quickOk = it => (it.data.confidence ?? 0) >= .9 && !it.warn.length && (it.pid || ['transaction', 'bill', 'info'].includes(it.data.kind));
function renderInbox() {
  const I = Inbox, hi = I.items.filter(quickOk), tbn = (window._tbPending || []).length;
  $('ibSummary').innerHTML = `<div class="row" style="gap:16px"><span><b>${I.items.length}</b> waiting</span><span class="green">${hi.length} high-confidence</span>${I.dupes.length ? `<span class="muted">${I.dupes.length} duplicate(s)</span>` : ''}${I.invalid.length ? `<span class="red">${I.invalid.length} invalid file(s)</span>` : ''}<span class="muted sm">Checked ${I.checkedAt ? I.checkedAt.toLocaleTimeString('en-AU') : '—'}</span></div>` + (tbn ? `<div class="note" style="border-left-color:var(--teal)">📅 ${tbn} TimelyBills export(s) waiting <button class="btn sm primary" onclick="importTimelyInbox()">Import</button></div>` : '');
  $('ibApproveAll').style.display = hi.length > 1 ? 'inline-block' : 'none'; $('ibApproveAll').textContent = `✓ Approve ${hi.length} high-confidence`;
  const conf = c => c == null ? '' : `<span class="pill ${c >= .9 ? 'p-paid' : c >= .7 ? 'p-soon' : 'p-over'}">${Math.round(c * 100)}%</span>`, icon = { rental: '🏠', loan: '🏦', bill: '🧾', settlement: '📑', transaction: '💳', info: '📄' };
  const sumF = (k, f) => ({ rental: `Rent ${m0(f.rent)} · expenses ${m0(f.expenses)}`, loan: `Loan ${m0(f.loan)} · offset ${m0(f.offset)}${f.rate ? ' · ' + f.rate + '%' : ''}`, bill: `${esc(f.biller || '')} ${m0(f.amount)} · due ${fdate(f.due)}`, settlement: `Price ${m0(f.price)}`, transaction: `${esc(f.desc || '')} ${money(f.amount)}`, info: 'Reference document' })[k];
  $('ibRows').innerHTML = I.items.length ? I.items.map((it, n) => { const d = it.data; return `<tr><td style="font-size:20px">${icon[d.kind]}</td><td><b>${esc(I.label(d))}</b><div class="muted sm">${sumF(d.kind, d.fields)}${d.fields.date ? ' · ' + fdate(d.fields.date) : ''}</div>${it.warn.length ? `<div class="amber sm">⚠ ${it.warn.map(esc).join(' · ')}</div>` : ''}${d.notes ? `<div class="muted sm">💬 ${esc(d.notes)}</div>` : ''}</td><td>${it.pid ? esc(pname(it.pid)) : '<span class="amber">unmatched</span>'}</td><td>${esc(d.agent || '')}<div class="muted sm">${fdt(d.created)}</div></td><td>${conf(d.confidence)}</td><td class="nowrap"><button class="btn sm primary" onclick="reviewInbox(${n})">Review</button> <button class="btn sm danger" onclick="rejectInbox(${n})">Reject</button></td></tr>` }).join('') : '<tr><td colspan="6" class="empty">Inbox is empty 🎉</td></tr>';
  $('ibOther').innerHTML = (I.invalid.length ? `<h3 class="red" style="margin-top:18px">Invalid files</h3><table>${I.invalid.map((x, n) => `<tr><td>⚠ ${esc(x.file)}</td><td class="red sm">${esc(x.error)}</td><td><button class="btn sm danger" onclick="Inbox.reject(Inbox.invalid[${n}],'invalid').then(save)">Move to rejected</button></td></tr>`).join('')}</table>` : '') + (I.dupes.length ? `<h3 style="margin-top:18px">Duplicates</h3><table>${I.dupes.map((x, n) => `<tr><td>${esc(I.label(x.data))}</td><td class="muted sm">${esc(x.reason)}</td><td><button class="btn sm" onclick="Inbox.reject(Inbox.dupes[${n}],'duplicate').then(save)">Dismiss</button></td></tr>`).join('')}</table>` : '');
}
function reviewInbox(n) {
  const it = Inbox.items[n], d = it.data;
  openReview({ title: `🤖 ${esc(Inbox.label(d))}`, sub: `From <b>${esc(d.agent || 'agent')}</b> · ${fdt(d.created)}${d.confidence != null ? ` · confidence ${Math.round(d.confidence * 100)}%` : ''}${d.sourceFile ? `<br>📄 ${esc(d.sourceFile)}` : ''}${d.notes ? `<br>💬 ${esc(d.notes)}` : ''}`, kind: d.kind, propertyId: it.pid, fields: d.fields, text: d.text || '', warn: it.warn, buttons: `<button class="btn" onclick="closeModal()">Later</button><button class="btn danger" id="rRej">Reject</button><button class="btn primary" id="rGo">Approve &amp; import</button>` });
  $('rGo').onclick = async () => { const s = await Inbox.approve(it, $('rKind').value, $('rProp').value, readForm()); closeModal(); save(); toast('Imported: ' + s) };
  $('rRej').onclick = async () => { const why = prompt('Reason (optional)') || ''; await Inbox.reject(it, why); closeModal(); save() };
}
async function rejectInbox(n) { const why = prompt('Reject this item? Reason (optional)'); if (why === null) return; await Inbox.reject(Inbox.items[n], why); save() }
async function approveAllHigh() { const list = Inbox.items.filter(quickOk); if (!list.length || !confirm(`Approve and import ${list.length} item(s) with ≥90% confidence and no warnings?`)) return; for (const it of list) await Inbox.approve(it, it.data.kind, it.pid, { ...it.data.fields, update: true }); log('Bulk approve', `${list.length} high-confidence item(s) imported`); save(); toast(`${list.length} imported`) }
async function checkAgents(manual) {
  try { const a = await Inbox.load(), b = await loadAgentRuns(); await checkTimelyInbox(); if (manual) { log('Inbox checked', `${Inbox.items.length} waiting · ${a} new · ${b} new run(s)`, { actor: 'portal' }); toast(`${a} new inbox item(s) · ${b} new agent run(s)`) } if (a || b || manual) save(); else renderAll() }
  catch (e) { if (e.auth) needSignIn(e.message); else if (manual) toast('Inbox check failed: ' + e.message) }
}

/* ---------------- Activity log ---------------- */
const actFilter = { who: 'all', status: 'all', q: '' };
const actorLabel = a => a === 'you' ? '👤 You' : a === 'portal' ? '⚙️ Portal' : '🤖 ' + esc(a.replace(/^agent:/, ''));
function actLine(a) { return `<div class="list-item"><div class="grow"><b>${esc(a.action)}</b> <span class="muted sm">· ${actorLabel(a.actor)} · ${fdt(a.at)}</span><div class="muted sm">${esc(a.detail)}</div></div></div>` }
function renderActivity() {
  $('actHealth').innerHTML = agentHealthHtml(false);
  const agents = [...new Set(S.activity.filter(a => a.actor.startsWith('agent:')).map(a => a.actor))];
  $('actWho').innerHTML = [['all', 'Everyone'], ['you', '👤 You'], ['agents', '🤖 All agents'], ['portal', '⚙️ Portal'], ...agents.map(a => [a, '🤖 ' + a.slice(6)])].map(([v, l]) => `<option value="${esc(v)}" ${actFilter.who === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  $('actStatus').value = actFilter.status; $('actQ').value = actFilter.q; const q = actFilter.q.toLowerCase();
  const list = S.activity.filter(a => (actFilter.who === 'all' || (actFilter.who === 'agents' ? a.actor.startsWith('agent:') : a.actor === actFilter.who)) && (actFilter.status === 'all' || a.status === actFilter.status) && (!q || (a.action + ' ' + a.detail + ' ' + a.actor + ' ' + pname(a.ref)).toLowerCase().includes(q))).sort((a, b) => b.at.localeCompare(a.at));
  const st = { ok: '<span class="pill p-paid">OK</span>', warn: '<span class="pill p-soon">Warning</span>', error: '<span class="pill p-over">Error</span>' };
  $('actCount').textContent = `${list.length} of ${S.activity.length} entries`;
  $('actRows').innerHTML = list.length ? list.slice(0, 400).map(a => `<tr><td class="nowrap">${fdt(a.at)}</td><td class="nowrap">${actorLabel(a.actor)}</td><td><b>${esc(a.action)}</b><div class="muted sm">${esc(a.detail)}</div></td><td>${a.ref && prop(a.ref) ? `<a href="#" onclick="go('prop:${a.ref}');return false">${esc(pname(a.ref))}</a>` : ''}</td><td>${st[a.status] || ''}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No matching activity</td></tr>';
}
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000) }
function exportActivity() { const rows = [['When', 'Who', 'Action', 'Detail', 'Property', 'Status'], ...S.activity.map(a => [a.at, a.actor, a.action, a.detail, pname(a.ref), a.status])]; download(`activity-log-${iso(today())}.csv`, new Blob([rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')], { type: 'text/csv' })) }
function exportBackup() { download('portal-data-' + iso(today()) + '.json', new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' })) }
/* =====================================================================
   TAX & ACCOUNTANT PACK – Australian FY (1 Jul – 30 Jun), ATO rental schedule labels.
   Record-keeping aid only – the accountant decides what is claimable.
   ===================================================================== */
const ATO_INCOME = ['Gross rent', 'Other rental income'];
const ATO_DED = ['Advertising for tenants', 'Body corporate fees', 'Borrowing expenses', 'Cleaning', 'Council rates', 'Capital allowances (depreciation on plant)', 'Gardening/lawn mowing', 'Insurance', 'Interest on loans', 'Land tax', 'Legal fees', 'Pest control', 'Property agent fees/commission', 'Repairs and maintenance', 'Capital works deductions', 'Stationery, telephone and postage', 'Water charges', 'Sundry rental expenses'];
const ATO_OTHER = ['Loan repayment (not a deduction)', 'Capital improvement (cost base)', 'Fund/entity expense (not rental)', 'Cost of managing tax affairs', 'PAYG instalments paid', 'Private / not deductible', 'Unclassified'];
const ATO_ALL = [...ATO_INCOME, ...ATO_DED, ...ATO_OTHER];
const ENT_ITEMS = ['PAYG instalments paid', 'Fund/entity expense (not rental)', 'Cost of managing tax affairs'];
const fyOf = s => { const y = +s.slice(0, 4), m = +s.slice(5, 7), st = m >= 7 ? y : y - 1; return `${st}-${String(st + 1).slice(2)}` };
const fyRange = fy => { const st = +fy.slice(0, 4); return [`${st}-07-01`, `${st + 1}-06-30`] };
const inFY = (s, fy) => { if (!s) return false; const [a, b] = fyRange(fy); return s.slice(0, 10) >= a && s.slice(0, 10) <= b };
const dayN = s => Math.round(pd(s) / 864e5);
const overlapDays = (a1, a2, b1, b2) => { const s = Math.max(dayN(a1), dayN(b1)), e = Math.min(dayN(a2), dayN(b2)); return e >= s ? e - s + 1 : 0 };
const entityOf = p => p ? (p.entity || (/smsf|super/i.test(p.owner || '') ? 'smsf' : 'personal')) : 'personal';
const ENTITY = { all: 'All entities', personal: 'Personal (individual return)', smsf: 'SMSF' };
const isRental = p => !!p && p.type !== 'PPOR';
function fyList() { const cur = fyOf(iso(today())), st = +cur.slice(0, 4), set = new Set([cur, `${st - 1}-${String(st).slice(2)}`]); S.transactions.forEach(t => t.date && set.add(fyOf(t.date))); return [...set].sort().reverse() }
function defaultFY() { const cur = fyOf(iso(today())), st = +cur.slice(0, 4), prev = `${st - 1}-${String(st).slice(2)}`; return S.transactions.some(t => inFY(t.date, prev) && isRental(prop(t.propertyId))) ? prev : cur }
function defaultTaxCat(t) {
  const p = prop(t.propertyId), d = (t.desc + ' ' + (t.category || '')).toLowerCase(), c = t.category || '';
  if (!p) return /payg|tax payment/.test(d) ? 'PAYG instalments paid' : null;
  if (!isRental(p)) return 'Private / not deductible';
  if (t.amount > 0) return c === 'Rent' || /rent/.test(d) ? 'Gross rent' : 'Other rental income';
  if (c === 'Mortgage & Loans') return 'Loan repayment (not a deduction)';
  if (c === 'Tax & Accounting') return /payg/.test(d) ? 'PAYG instalments paid' : entityOf(p) === 'smsf' ? 'Fund/entity expense (not rental)' : 'Cost of managing tax affairs';
  if (c === 'Council & Rates') return /land tax/.test(d) ? 'Land tax' : 'Council rates';
  if (c === 'Strata') return 'Body corporate fees';
  if (c === 'Insurance') return 'Insurance';
  if (c === 'Repairs & Maintenance') return 'Repairs and maintenance';
  if (c === 'Utilities') return /water/.test(d) ? 'Water charges' : 'Sundry rental expenses';
  if (/land tax/.test(d)) return 'Land tax';
  if (/agent|management|letting|commission|\barg\b|leasing/.test(d)) return 'Property agent fees/commission';
  if (/repair|plumb|electric|maint|fix|smoke alarm|safety check/.test(d)) return 'Repairs and maintenance';
  if (/clean/.test(d)) return 'Cleaning'; if (/pest/.test(d)) return 'Pest control'; if (/garden|lawn/.test(d)) return 'Gardening/lawn mowing';
  if (/advert|marketing|listing/.test(d)) return 'Advertising for tenants'; if (/legal|solicitor|conveyanc/.test(d)) return 'Legal fees';
  if (/postage|phone|stationery/.test(d)) return 'Stationery, telephone and postage';
  if (c === 'Property Costs') return 'Sundry rental expenses';
  return 'Unclassified';
}
const taxCat = t => t.taxCat || defaultTaxCat(t);
function ty(fy) { return S.taxYears[fy] ||= { props: {}, loans: {} } }
const allLoans = () => S.properties.flatMap(p => p.loans.map(l => ({ l, p })));
function weeksSuggest(p, fy) { if (!p.rentedFrom) return null; const [a, b] = fyRange(fy), end = p.sold && p.saleDate && p.saleDate < b ? p.saleDate : b; return Math.round(overlapDays(a, end, p.rentedFrom, end) / 7 * 10) / 10 }
function borrowShare(b, fy) {
  if (!b.amount || !b.date) return 0; if (b.amount <= 100) return inFY(b.date, fy) ? b.amount : 0;
  const yrs = Math.min(5, b.termYears || 5), st = pd(b.date), en = new Date(st); en.setFullYear(en.getFullYear() + yrs); en.setDate(en.getDate() - 1);
  const tot = Math.round((en - st) / 864e5) + 1, [a, z] = fyRange(fy); return Math.round(b.amount * overlapDays(a, z, b.date, iso(en)) / tot * 100) / 100;
}
function buildTax(fy, entity = 'all') {
  const [fyStart, fyEnd] = fyRange(fy), Y = ty(fy), inProgress = iso(today()) < fyEnd, okEnt = p => entity === 'all' || entityOf(p) === entity;
  const tx = S.transactions.filter(t => inFY(t.date, fy)).map(t => ({ ...t, ato: taxCat(t), p: prop(t.propertyId) }));
  const rentalTx = tx.filter(t => isRental(t.p) && okEnt(t.p) && !ENT_ITEMS.includes(t.ato));
  const loans = allLoans().map(({ l, p }) => { const rec = Y.loans[l.id] || {}, cp = prop(l.claimFor || p.id), pct = l.investPct; return { id: l.id, name: l.name, secured: p.name, claimFor: cp?.id || '', claimName: cp?.name || '', interest: rec.interest ?? null, pct, deductible: rec.interest != null && pct != null ? Math.round(rec.interest * pct) / 100 : null, balance: l.balance, rate: l.rate, notes: l.purposeNote || '', entity: entityOf(cp || p) } }).filter(L => entity === 'all' || L.entity === entity);
  const borrow = S.borrowing.map(b => ({ ...b, share: borrowShare(b, fy), pname: pname(b.propertyId) })).filter(b => okEnt(prop(b.propertyId)));
  const props = S.properties.filter(p => okEnt(p) && isRental(p) && (rentalTx.some(t => t.propertyId === p.id) || loans.some(L => L.claimFor === p.id && (L.deductible || L.interest)) || borrow.some(b => b.propertyId === p.id && b.share) || Y.props[p.id]?.div40 || Y.props[p.id]?.div43 || (p.rentedFrom && p.rentedFrom <= fyEnd && !(p.sold && p.saleDate && p.saleDate < fyStart)) || (p.sold && inFY(p.saleDate, fy))));
  const sched = {}; props.forEach(p => { sched[p.id] = Object.fromEntries([...ATO_INCOME, ...ATO_DED].map(k => [k, 0])) });
  rentalTx.forEach(t => { const s = sched[t.propertyId]; if (s && t.ato in s) s[t.ato] += ATO_INCOME.includes(t.ato) ? t.amount : -t.amount });
  loans.forEach(L => { if (L.deductible && sched[L.claimFor]) sched[L.claimFor]['Interest on loans'] += L.deductible });
  borrow.forEach(b => { if (b.share && sched[b.propertyId]) sched[b.propertyId]['Borrowing expenses'] += b.share });
  props.forEach(p => { const r = Y.props[p.id] || {}; sched[p.id]['Capital allowances (depreciation on plant)'] += +r.div40 || 0; sched[p.id]['Capital works deductions'] += +r.div43 || 0 });
  const tot = id => { const s = sched[id], inc = ATO_INCOME.reduce((a, k) => a + s[k], 0), ded = ATO_DED.reduce((a, k) => a + s[k], 0); return { inc, ded, net: inc - ded } };
  const otherTx = tx.filter(t => ENT_ITEMS.includes(t.ato) && (entity === 'all' || entityOf(t.p) === entity || (!t.p && entity === 'personal')));
  const cgt = S.properties.filter(p => okEnt(p) && isRental(p)).map(p => ({ p, improvements: S.transactions.filter(t => t.propertyId === p.id && taxCat(t) === 'Capital improvement (cost base)').reduce((a, t) => a - t.amount, 0), soldInFY: p.sold && inFY(p.saleDate, fy) }));
  const docs = (window._scan?.files || []).filter(f => okEnt(prop(f.propertyId)) && /\.pdf$/i.test(f.name)).map(f => { const d = S.documents[f.path] || {}, why = docWhy(f, d, fy); return { ...f, status: d.status || 'not reviewed', summary: d.summary || '', include: !!why, why, link: f.url || Store.linkFor(f.path) } });
  const checks = readiness(fy, entity, { props, rentalTx, loans, Y, inProgress, docs });
  return { fy, entity, fyStart, fyEnd, inProgress, props, sched, tot, rentalTx, loans, borrow, otherTx, cgt, docs, checks };
}
function docWhy(f, d, fy) {
  if (/depreciation|quantity surveyor|settlement|statement of adjustments|eofy|end of (financial )?year|annual (summary|statement)|interest (summary|certificate)/i.test(f.name)) return 'Key tax document';
  if (d.status === 'imported' && d.at && inFY(d.at, fy)) return 'Imported this FY';
  const [a, b] = fyRange(fy), m = f.modified ? iso(new Date(f.modified)) : '', late = (+b.slice(0, 4)) + '-10-31';
  return m && m >= a && m <= late ? 'Saved during FY / EOFY period' : '';
}
function readiness(fy, entity, X) {
  const out = [], add = (level, text, fix = '', ref = '') => out.push({ level, text, fix, ref });
  if (X.inProgress) add('info', `FY${fy} is still in progress – figures are year-to-date to ${fdate(iso(today()))}.`);
  X.props.forEach(p => {
    const r = X.Y.props[p.id] || {};
    if (p.rentedFrom) {
      const miss = [], [a, b] = fyRange(fy), lim = [b, iso(today()), p.sold && p.saleDate ? p.saleDate : b].sort()[0];
      for (let d = pd(a); iso(d) <= lim; d.setMonth(d.getMonth() + 1)) { const ym = iso(d).slice(0, 7), mEnd = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); if (mEnd < p.rentedFrom || mEnd > lim) continue; if (!X.rentalTx.some(t => t.propertyId === p.id && t.ato === 'Gross rent' && t.date.startsWith(ym))) miss.push(fmonth(ym)) }
      if (miss.length) add('missing', `${p.name}: no rent recorded for ${miss.join(', ')}. Import the agent statements for these months.`, 'import', p.id); else add('ok', `${p.name}: rent recorded for every tenanted month.`, '', p.id);
    } else if (X.rentalTx.some(t => t.propertyId === p.id && t.ato === 'Gross rent')) add('warn', `${p.name}: "rented from" date not set (needed for weeks rented).`, 'prop', p.id);
    if (r.weeksRented == null) add('warn', `${p.name}: confirm weeks rented this FY${weeksSuggest(p, fy) != null ? ` (suggested ${weeksSuggest(p, fy)})` : ''}.`, 'setup', p.id);
    if (r.div40 == null || r.div43 == null) add('warn', `${p.name}: enter Div 40 / Div 43 figures for FY${fy} from the depreciation schedule (or 0 if none).`, 'setup', p.id);
    if (X.rentalTx.some(t => t.propertyId === p.id && /agent expenses/i.test(t.desc))) add('warn', `${p.name}: agent costs recorded as a lump sum – include the agent's end-of-year statement so the accountant can split letting, management and repairs.`, '', p.id);
  });
  X.loans.forEach(L => { if (L.pct == null) add('warn', `${L.name} (${L.secured}): set what % of this loan was used for investment and which property – interest is deductible by use of funds, not by security.`, 'loans'); else if (L.pct > 0 && L.interest == null) add('missing', `${L.name}: enter total interest charged in FY${fy} (from the lender's interest summary).`, 'loans') });
  const unc = X.rentalTx.filter(t => t.ato === 'Unclassified'); if (unc.length) add('missing', `${unc.length} rental transaction(s) need an ATO category.`, 'tx');
  const ver = S.bills.filter(b => b.status === 'verify' && isRental(prop(b.propertyId)) && (entity === 'all' || entityOf(prop(b.propertyId)) === entity)); if (ver.length) add('warn', `${ver.length} rental bill(s) still marked "Check": ${ver.map(b => b.name).join('; ')}.`, 'bills');
  if (Inbox.items.length) add('warn', `${Inbox.items.length} agent inbox item(s) not yet approved.`, 'inbox');
  const nd = (window._scan?.pending || []).filter(f => entity === 'all' || !f.propertyId || entityOf(prop(f.propertyId)) === entity).length; if (nd) add('warn', `${nd} PDF(s) in Properties folders not reviewed.`, 'import');
  S.properties.filter(p => p.sold && (entity === 'all' || entityOf(p) === entity) && (!p.saleDate || inFY(p.saleDate, fy))).forEach(p => { if (!p.saleDate || !p.salePrice || !p.purchase) add('warn', `${p.name} (sold): add purchase price, sale date and sale price for the CGT schedule.`, 'prop', p.id) });
  if (!window._scan) add('warn', 'Properties folder not scanned yet – supporting documents won\'t be included.', 'import');
  return out;
}
const taxSel = { fy: null, entity: 'all', onlyUnc: false };
function renderTax() {
  taxSel.fy ||= defaultFY(); const X = buildTax(taxSel.fy, taxSel.entity), Y = ty(taxSel.fy), P = X.props;
  $('taxFY').innerHTML = fyList().map(f => `<option value="${f}" ${f === taxSel.fy ? 'selected' : ''}>FY${f}</option>`).join('');
  $('taxEnt').innerHTML = Object.entries(ENTITY).map(([k, v]) => `<option value="${k}" ${k === taxSel.entity ? 'selected' : ''}>${v}</option>`).join('');
  const n = { ok: 0, warn: 0, missing: 0 }; X.checks.forEach(c => n[c.level] = (n[c.level] || 0) + 1);
  const ic = { ok: '✅', warn: '⚠️', missing: '❌', info: 'ℹ️' };
  $('taxReady').innerHTML = `<div class="row" style="gap:12px;margin-bottom:8px"><span class="pill p-paid">${n.ok} ready</span><span class="pill p-soon">${n.warn} to check</span><span class="pill p-over">${n.missing} missing</span></div>` + X.checks.map(c => `<div class="list-item"><div style="width:26px">${ic[c.level]}</div><div class="grow ${c.level === 'missing' ? 'red' : ''}">${esc(c.text)}</div>${c.fix ? `<button class="btn sm" onclick="taxFix('${c.fix}','${c.ref}')">Fix</button>` : ''}</div>`).join('');
  const cell = v => v ? m0(v) : '<span class="muted">–</span>';
  $('taxSched').innerHTML = P.length ? `<table><thead><tr><th>ATO label</th>${P.map(p => `<th class="num">${esc(p.name)}<div class="muted sm">${entityOf(p) === 'smsf' ? 'SMSF' : 'Personal'}</div></th>`).join('')}</tr></thead><tbody><tr><td colspan="${P.length + 1}" class="lbl2">Income</td></tr>${ATO_INCOME.map(k => `<tr><td>${k}</td>${P.map(p => `<td class="num">${cell(X.sched[p.id][k])}</td>`).join('')}</tr>`).join('')}<tr><td colspan="${P.length + 1}" class="lbl2">Deductions</td></tr>${ATO_DED.filter(k => P.some(p => X.sched[p.id][k])).map(k => `<tr><td>${k}</td>${P.map(p => `<td class="num">${cell(X.sched[p.id][k])}</td>`).join('')}</tr>`).join('')}<tr class="total"><td>Total income</td>${P.map(p => `<td class="num green">${m0(X.tot(p.id).inc)}</td>`).join('')}</tr><tr class="total"><td>Total deductions</td>${P.map(p => `<td class="num red">${m0(X.tot(p.id).ded)}</td>`).join('')}</tr><tr class="total"><td>Net rent</td>${P.map(p => { const v = X.tot(p.id).net; return `<td class="num ${v < 0 ? 'red' : 'green'}">${m0(v)}</td>` }).join('')}</tr></tbody></table>` : '<div class="empty">No rental activity in this FY for the selected entity.</div>';
  $('taxSetup').innerHTML = P.length ? `<table><thead><tr><th>Property</th><th>Rented from</th><th class="num">Weeks rented</th><th class="num">Div 40 plant</th><th class="num">Div 43 building</th><th>Notes for accountant</th></tr></thead><tbody>${P.map(p => { const r = Y.props[p.id] || {}, sg = weeksSuggest(p, taxSel.fy); return `<tr><td><b>${esc(p.name)}</b></td><td><input type="date" value="${p.rentedFrom || ''}" onchange="prop('${p.id}').rentedFrom=this.value||null;save()"></td><td><input class="mini" type="number" step="0.1" value="${r.weeksRented ?? ''}" placeholder="${sg ?? ''}" onchange="setTY('${p.id}','weeksRented',this.value)"></td><td><input class="mini" type="number" step="0.01" value="${r.div40 ?? ''}" onchange="setTY('${p.id}','div40',this.value)"></td><td><input class="mini" type="number" step="0.01" value="${r.div43 ?? ''}" onchange="setTY('${p.id}','div43',this.value)"></td><td><input value="${esc(r.notes || '')}" onchange="setTY('${p.id}','notes',this.value,true)"></td></tr>` }).join('')}</tbody></table>` : '<div class="empty">—</div>';
  $('taxLoans').innerHTML = allLoans().length ? `<table><thead><tr><th>Loan</th><th>Secured on</th><th class="num">Interest FY${taxSel.fy}</th><th class="num">Investment %</th><th>Used for</th><th class="num">Deductible</th><th>Purpose note</th></tr></thead><tbody>${allLoans().filter(({ l, p }) => taxSel.entity === 'all' || entityOf(prop(l.claimFor) || p) === taxSel.entity).map(({ l, p }) => { const L = X.loans.find(x => x.id === l.id) || {}; return `<tr><td><b>${esc(l.name)}</b><div class="muted sm">Bal ${m0(l.balance)}${l.rate ? ' · ' + l.rate + '%' : ''}</div></td><td>${esc(p.name)}</td><td><input class="mini" style="width:110px" type="number" step="0.01" value="${(Y.loans[l.id] || {}).interest ?? ''}" onchange="setLoanInt('${l.id}',this.value)"></td><td><input class="mini" type="number" min="0" max="100" value="${l.investPct ?? ''}" placeholder="?" onchange="setLoan('${l.id}','investPct',this.value===''?null:Math.max(0,Math.min(100,+this.value)))"></td><td><select class="mini2" onchange="setLoan('${l.id}','claimFor',this.value)">${S.properties.map(q => `<option value="${q.id}" ${q.id === (l.claimFor || p.id) ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</select></td><td class="num">${L.deductible != null ? m0(L.deductible) : '—'}</td><td><input value="${esc(l.purposeNote || '')}" onchange="setLoan('${l.id}','purposeNote',this.value)"></td></tr>` }).join('')}</tbody></table>` : '<div class="empty">No loans – add them under each property\'s Edit.</div>';
  $('taxBorrow').innerHTML = (S.borrowing.length ? `<table><thead><tr><th>Date</th><th>Property</th><th>Item</th><th class="num">Amount</th><th class="num">Years</th><th class="num">FY${taxSel.fy} share</th><th></th></tr></thead><tbody>${S.borrowing.map(b => `<tr><td>${fdate(b.date)}</td><td>${esc(pname(b.propertyId))}</td><td>${esc(b.desc)}</td><td class="num">${money(b.amount)}</td><td class="num">${Math.min(5, b.termYears || 5)}</td><td class="num"><b>${money(borrowShare(b, taxSel.fy))}</b></td><td><button class="btn sm danger" onclick="delBorrow('${b.id}')">✕</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No borrowing costs recorded</div>') + `<div class="muted sm" style="margin-top:6px">Loan establishment fees, lender's mortgage insurance, broker and valuation fees, mortgage stamp duty – spread over 5 years (or the loan term if shorter); $100 or less is claimed in full.</div>`;
  const list = X.rentalTx.filter(t => !taxSel.onlyUnc || t.ato === 'Unclassified').sort((a, b) => a.date.localeCompare(b.date));
  $('taxTx').innerHTML = list.length ? `<table class="stack"><thead><tr><th>Date</th><th>Property</th><th>Description</th><th>ATO label</th><th class="num">Amount</th></tr></thead><tbody>${list.map(t => `<tr><td class="nowrap">${fdate(t.date)}</td><td>${esc(t.p?.name || '')}</td><td>${esc(t.desc)}${t.agent ? ' <span class="pill p-agent">🤖</span>' : ''}<div class="muted sm">${esc(t.category)} · ${esc(t.source || '')}</div></td><td><select class="mini2" onchange="setTaxCat('${t.id}',this.value)">${ATO_ALL.map(k => `<option ${k === t.ato ? 'selected' : ''}>${k}</option>`).join('')}</select>${t.taxCat ? '' : ' <span class="muted sm">auto</span>'}</td><td class="num ${t.amount > 0 ? 'green' : ''}"><b>${money(t.amount)}</b></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No rental transactions</div>';
  $('taxDocs').innerHTML = window._scan ? `${X.docs.filter(d => d.include).length} of ${X.docs.length} PDFs will be attached.` : 'Scan the Properties folder to attach documents.';
}
function taxFix(f, ref) { if (f === 'prop') return go('prop:' + ref); if (['import', 'inbox', 'bills'].includes(f)) return go(f); if (f === 'tx') { taxSel.onlyUnc = true; renderTax() } $({ setup: 'taxSetupCard', loans: 'taxLoansCard', tx: 'taxTxCard' }[f])?.scrollIntoView({ behavior: 'smooth' }) }
function setTY(pid, k, v, text) { (ty(taxSel.fy).props[pid] ||= {})[k] = text ? v : (v === '' ? null : +v); log('Tax setup', `FY${taxSel.fy} ${pname(pid)}: ${k} = ${v || '(blank)'}`, { ref: pid }); save() }
function setLoanInt(id, v) { (ty(taxSel.fy).loans[id] ||= {}).interest = v === '' ? null : +v; log('Loan interest entered', `FY${taxSel.fy}: ${allLoans().find(x => x.l.id === id)?.l.name} ${v ? money(+v) : '(blank)'}`); save() }
function setLoan(id, k, v) { const x = allLoans().find(x => x.l.id === id); if (!x) return; x.l[k] = v; log('Loan updated', `${x.l.name}: ${k} = ${v ?? '(blank)'}`, { ref: x.p.id }); save() }
function setTaxCat(id, v) { const t = tx(id); t.taxCat = v; log('ATO label set', `${t.desc} → ${v}`, { ref: t.propertyId }); save() }
function delBorrow(id) { S.borrowing = S.borrowing.filter(b => b.id !== id); log('Borrowing cost deleted', ''); save() }
function openBorrow() {
  modal(`<h2>Add borrowing cost</h2><div class="form2"><div><label>Date incurred</label><input id="boDate" type="date" value="${iso(today())}"></div><div><label>Property (loan purpose)</label><select id="boProp">${propOpts(active()[0]?.id, true)}</select></div><div><label>Item</label><input id="boDesc" placeholder="Loan establishment fee"></div><div><label>Amount</label><input id="boAmt" type="number" step="0.01"></div><div><label>Loan term (years)</label><input id="boTerm" type="number" value="30"></div></div><div class="row end" style="margin-top:16px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="boGo">Save</button></div>`);
  $('boGo').onclick = () => { const b = { id: uid(), date: $('boDate').value, propertyId: $('boProp').value, desc: $('boDesc').value || 'Borrowing cost', amount: +$('boAmt').value || 0, termYears: +$('boTerm').value || 30 }; S.borrowing.push(b); log('Borrowing cost added', `${b.desc} ${money(b.amount)}`, { ref: b.propertyId }); closeModal(); save() };
}

/* ---------------- Minimal XLSX writer (JSZip) ---------------- */
const XL = {
  si: { n: 0, h: 1, m: 2, mb: 3, d: 4, b: 5, p: 6, t: 7, l: 8, w: 9 },
  col(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s },
  x: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''),
  serial(d) { const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return (Date.UTC(y, m - 1, dd) - Date.UTC(1899, 11, 30)) / 864e5 },
  sheet(sh) {
    const links = []; let rows = '';
    sh.rows.forEach((r, ri) => { let cells = ''; (r || []).forEach((c, ci) => { if (c == null || c === '') return; const o = typeof c === 'object' ? c : { v: c }, ref = this.col(ci) + (ri + 1); let st = this.si[o.s || (typeof o.v === 'number' ? 'm' : 'n')] ?? 0;
      if (o.s === 'd' && o.v) { cells += `<c r="${ref}" s="${st}"><v>${this.serial(o.v)}</v></c>`; return }
      if (typeof o.v === 'number' && isFinite(o.v)) cells += `<c r="${ref}" s="${st}"><v>${Math.round(o.v * 100) / 100}</v></c>`;
      else { if (o.link) { links.push({ ref, url: o.link }); st = this.si.l } cells += `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${this.x(o.v)}</t></is></c>` } }); rows += `<row r="${ri + 1}">${cells}</row>` });
    const cols = sh.widths ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const fz = sh.freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
    const hl = links.length ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>` : '';
    return { xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${fz}${cols}<sheetData>${rows}</sheetData>${hl}</worksheet>`, rels: links.length ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((l, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${this.x(l.url)}" TargetMode="External"/>`).join('')}</Relationships>` : null };
  },
  async build(sheets) {
    const z = new JSZip(), n = sheets.length;
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
    z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${this.x(s.name.replace(/[\[\]:*?\/\\]/g, '').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
    z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    const xf = [[0, 0, 0, 0, ''], [0, 1, 2, 0, ' applyFont="1" applyFill="1"'], [164, 0, 0, 0, ' applyNumberFormat="1"'], [164, 2, 0, 1, ' applyNumberFormat="1" applyFont="1" applyBorder="1"'], [165, 0, 0, 0, ' applyNumberFormat="1"'], [0, 2, 0, 0, ' applyFont="1"'], [9, 0, 0, 0, ' applyNumberFormat="1"'], [0, 3, 0, 0, ' applyFont="1"'], [0, 4, 0, 0, ' applyFont="1"']].map(([nf, f, fi, b, a]) => `<xf numFmtId="${nf}" fontId="${f}" fillId="${fi}" borderId="${b}" xfId="0"${a}/>`).join('') + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>';
    z.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;[Red]-&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FF1F3864"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10">${xf}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    sheets.forEach((s, i) => { const o = this.sheet(s); z.file(`xl/worksheets/sheet${i + 1}.xml`, o.xml); if (o.rels) z.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, o.rels) });
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
};
function workbookSheets(X) {
  const H = a => a.map(v => ({ v, s: 'h' })), B = v => ({ v, s: 'b' }), M = v => ({ v: v ?? '', s: v == null ? 'n' : 'm' }), MB = v => ({ v, s: 'mb' }), D = v => v ? { v, s: 'd' } : '', W = v => ({ v, s: 'w' });
  const P = X.props, en = p => entityOf(p) === 'smsf' ? 'SMSF' : 'Personal', lvl = { ok: 'Ready', warn: 'Check', missing: 'MISSING', info: 'Info' }, multi = P.length > 1, sum = f => P.reduce((a, p) => a + f(p), 0);
  return [
    { name: 'Summary', widths: [26, 40, 30, 12, 22, 13, 14, 15, 15, 15], rows: [[{ v: `CJP Investments – Accountant pack FY${X.fy}`, s: 't' }], [`Financial year 1 July ${X.fyStart.slice(0, 4)} – 30 June ${X.fyEnd.slice(0, 4)}${X.inProgress ? '  (YEAR IN PROGRESS – year-to-date figures)' : ''}`], [`Entity: ${ENTITY[X.entity]}`], [`Prepared ${new Date().toLocaleString('en-AU')} from the CJP Investments Portal – record-keeping summary, not tax advice`], [],
      H(['Property', 'Address', 'Entity / owner', 'Ownership %', 'Status', 'Rented from', 'Weeks rented', 'Gross income', 'Deductions', 'Net rent']),
      ...P.map(p => { const t = X.tot(p.id), r = ty(X.fy).props[p.id] || {}; return [B(p.name), p.address, `${en(p)} – ${p.owner}`, { v: (p.ownPct ?? 100) / 100, s: 'p' }, p.status, D(p.rentedFrom), r.weeksRented ?? (weeksSuggest(p, X.fy) != null ? `~${weeksSuggest(p, X.fy)} (est.)` : ''), M(t.inc), M(t.ded), M(t.net)] }),
      ...(multi ? [[B('Total'), '', '', '', '', '', '', MB(sum(p => X.tot(p.id).inc)), MB(sum(p => X.tot(p.id).ded)), MB(sum(p => X.tot(p.id).net))]] : []), [],
      [B('Open items for the accountant')], H(['Status', 'Item']), ...X.checks.filter(c => c.level !== 'ok').map(c => [lvl[c.level], W(c.text)])] },
    { name: 'Rental schedule', widths: [42, ...P.map(() => 20), 18], freeze: 1, rows: [H(['ATO rental schedule label', ...P.map(p => p.name), ...(multi ? ['Total'] : [])]), [B('INCOME')], ...ATO_INCOME.map(k => [k, ...P.map(p => M(X.sched[p.id][k])), ...(multi ? [M(sum(p => X.sched[p.id][k]))] : [])]), [B('DEDUCTIONS')], ...ATO_DED.map(k => [k, ...P.map(p => M(X.sched[p.id][k])), ...(multi ? [M(sum(p => X.sched[p.id][k]))] : [])]), [],
      [B('Total income'), ...P.map(p => MB(X.tot(p.id).inc)), ...(multi ? [MB(sum(p => X.tot(p.id).inc))] : [])], [B('Total deductions'), ...P.map(p => MB(X.tot(p.id).ded)), ...(multi ? [MB(sum(p => X.tot(p.id).ded))] : [])], [B('Net rent'), ...P.map(p => MB(X.tot(p.id).net)), ...(multi ? [MB(sum(p => X.tot(p.id).net))] : [])], [],
      [B('Entity'), ...P.map(en)], [B('Weeks rented'), ...P.map(p => (ty(X.fy).props[p.id] || {}).weeksRented ?? '')], [B('Notes'), ...P.map(p => W((ty(X.fy).props[p.id] || {}).notes || ''))], [], ['Interest, borrowing expenses, Div 40 and Div 43 come from the portal setup; all other lines total the Transactions sheet. Loan repayments are excluded.']] },
    { name: 'Transactions', widths: [12, 22, 12, 44, 20, 34, 14, 40, 22], freeze: 1, rows: [H(['Date', 'Property', 'Entity', 'Description', 'Portal category', 'ATO label', 'Amount', 'Source', 'Added by']), ...X.rentalTx.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => [D(t.date), t.p?.name || '', en(t.p), t.desc, t.category, t.ato + (t.taxCat ? '' : ' (auto)'), M(t.amount), t.source || '', t.agent ? t.agent : 'Manual/import'])] },
    { name: 'Loans & interest', widths: [34, 20, 20, 10, 15, 8, 15, 12, 16, 50], freeze: 1, rows: [H(['Loan', 'Secured on', 'Used for', 'Entity', 'Current balance', 'Rate %', `Interest FY${X.fy}`, 'Investment %', 'Deductible interest', 'Purpose note']), ...X.loans.map(L => [B(L.name), L.secured, L.claimName, L.entity === 'smsf' ? 'SMSF' : 'Personal', M(L.balance), L.rate ?? '', M(L.interest), L.pct == null ? 'TO CONFIRM' : { v: L.pct / 100, s: 'p' }, M(L.deductible), W(L.notes)]), [], [W('Interest is deductible according to what the borrowed money was used for, not which property secures the loan. Investment % is the owner\'s estimate – please confirm.')]] },
    { name: 'Depreciation & borrowing', widths: [24, 22, 22, 44, 30, 18], rows: [H(['Property', 'Div 40 plant & equipment', 'Div 43 capital works', 'Source document', 'Notes']), ...P.map(p => { const r = ty(X.fy).props[p.id] || {}, src = X.docs.find(d => d.propertyId === p.id && /depreciation/i.test(d.name)); return [B(p.name), M(r.div40), M(r.div43), src ? { v: src.name, link: src.link } : '', r.div40 == null || r.div43 == null ? 'Not entered' : ''] }), [], [B('Borrowing costs')], H(['Date incurred', 'Property', 'Item', 'Amount', 'Years spread', `FY${X.fy} deduction`]), ...X.borrow.map(b => [D(b.date), b.pname, b.desc, M(b.amount), Math.min(5, b.termYears || 5), M(b.share)])] },
    { name: 'CGT cost base', widths: [24, 12, 13, 15, 13, 15, 15, 16, 14, 12, 15, 13, 18], freeze: 1, rows: [H(['Property', 'Entity', 'Purchase date', 'Purchase price', 'Stamp duty', 'Other acquisition costs', 'Capital improvements', 'Cost base (indicative)', 'Sold', 'Sale date', 'Sale price', 'Selling costs', 'Gross gain (indicative)']), ...X.cgt.map(({ p, improvements, soldInFY }) => { const cb = (p.purchase || 0) + (p.stampDuty || 0) + (p.purchaseCosts || 0) + improvements; return [B(p.name), en(p), D(p.purchaseDate), M(p.purchase), M(p.stampDuty), M(p.purchaseCosts), M(improvements), M(p.purchase ? cb : null), p.sold ? (soldInFY ? 'Yes – this FY' : 'Yes') : 'No', D(p.saleDate), M(p.salePrice), M(p.saleCosts), M(p.sold && p.salePrice && p.purchase ? p.salePrice - (p.saleCosts || 0) - cb : null)] }), [], [W('Indicative only – excludes capital works deductions claimed (which reduce the cost base), discounts and exemptions.')]] },
    { name: 'Entity items', widths: [12, 14, 44, 30, 14, 40], freeze: 1, rows: [H(['Date', 'Entity', 'Description', 'ATO label', 'Amount', 'Source']), ...X.otherTx.map(t => [D(t.date), t.p ? en(t.p) : 'Personal', t.desc, t.ato, M(t.amount), t.source || '']), [], ['General household spending is not included in this pack.']] },
    { name: 'Documents', widths: [22, 60, 14, 40, 14, 26, 10], freeze: 1, rows: [H(['Property', 'Document', 'Status', 'Recorded as', 'In pack', 'Why', 'Link']), ...X.docs.map(d => [pname(d.propertyId), d.rel, d.status, d.summary, d.include ? 'Yes' : 'No', d.why, { v: 'Open', link: d.link }])] }
  ];
}
function summaryHtml(X) {
  const P = X.props, e = esc, mm = v => v ? m0(v) : '–', tbl = (h, rows) => `<table><thead><tr>${h.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CJP Accountant pack FY${X.fy}</title><style>body{font:13px/1.45 Segoe UI,Arial,sans-serif;color:#1b2333;margin:28px;max-width:1100px}h1{color:#1f3864;font-size:22px;margin:0}h2{color:#1f3864;font-size:16px;border-bottom:2px solid #1f3864;padding-bottom:3px;margin-top:26px}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #cfd6e4;padding:5px 7px;text-align:left}th{background:#1f3864;color:#fff}td.n{text-align:right}tr.t td{font-weight:700;background:#eef2f9}.muted{color:#667}.miss{color:#b3261e;font-weight:600}.warn{color:#8a5a00}</style></head><body>
<h1>CJP Investments – Accountant pack FY${X.fy}</h1><div class="muted">1 July ${X.fyStart.slice(0, 4)} – 30 June ${X.fyEnd.slice(0, 4)} · ${e(ENTITY[X.entity])} · prepared ${new Date().toLocaleDateString('en-AU')}${X.inProgress ? ' · <b class="warn">year in progress</b>' : ''}</div><p class="muted">Record-keeping summary – detail is in the Excel workbook and supporting documents. Please confirm treatment of all items.</p>
<h2>Properties</h2>${tbl(['Property', 'Address', 'Owner', 'Rented from', 'Weeks rented', 'Status'], P.map(p => `<tr><td><b>${e(p.name)}</b></td><td>${e(p.address)}</td><td>${e(p.owner)}</td><td>${p.rentedFrom ? fdate(p.rentedFrom) : '–'}</td><td class="n">${(ty(X.fy).props[p.id] || {}).weeksRented ?? '–'}</td><td>${e(p.status)}</td></tr>`))}
<h2>Rental schedule</h2>${P.length ? tbl(['ATO label', ...P.map(p => e(p.name))], [...ATO_INCOME.map(k => `<tr><td>${k}</td>${P.map(p => `<td class="n">${mm(X.sched[p.id][k])}</td>`).join('')}</tr>`), ...ATO_DED.filter(k => P.some(p => X.sched[p.id][k])).map(k => `<tr><td>${k}</td>${P.map(p => `<td class="n">${mm(X.sched[p.id][k])}</td>`).join('')}</tr>`), ...['inc', 'ded', 'net'].map((k, i) => `<tr class="t"><td>${['Total income', 'Total deductions', 'Net rent'][i]}</td>${P.map(p => `<td class="n">${m0(X.tot(p.id)[k])}</td>`).join('')}</tr>`)]) : '<p>No rental activity.</p>'}
<h2>Loans &amp; interest</h2>${tbl(['Loan', 'Secured on', 'Used for', 'Interest', 'Investment %', 'Deductible', 'Note'], X.loans.map(L => `<tr><td>${e(L.name)}</td><td>${e(L.secured)}</td><td>${e(L.claimName)}</td><td class="n">${L.interest != null ? money(L.interest) : '<span class="miss">not entered</span>'}</td><td class="n">${L.pct == null ? '<span class="warn">to confirm</span>' : L.pct + '%'}</td><td class="n">${L.deductible != null ? money(L.deductible) : '–'}</td><td>${e(L.notes)}</td></tr>`))}
${X.otherTx.length ? `<h2>Entity items</h2>${tbl(['Date', 'Description', 'Label', 'Amount'], X.otherTx.map(t => `<tr><td>${fdate(t.date)}</td><td>${e(t.desc)}</td><td>${e(t.ato)}</td><td class="n">${money(t.amount)}</td></tr>`))}` : ''}
<h2>Open items</h2>${X.checks.filter(c => c.level !== 'ok').map(c => `<div class="${c.level === 'missing' ? 'miss' : c.level === 'warn' ? 'warn' : 'muted'}">• ${e(c.text)}</div>`).join('') || '<p>None.</p>'}
<h2>Supporting documents</h2>${tbl(['Property', 'Document', 'Recorded as'], X.docs.filter(d => d.include).map(d => `<tr><td>${e(pname(d.propertyId))}</td><td><a href="${e(d.link)}">${e(d.rel)}</a></td><td>${e(d.summary)}</td></tr>`))}</body></html>`;
}
async function exportAccountantPack() {
  if (!window._scan) await runScan(true);
  const X = buildTax(taxSel.fy || defaultFY(), taxSel.entity), miss = X.checks.filter(c => c.level === 'missing').length;
  if (miss && !confirm(`${miss} item(s) are marked MISSING. They'll be listed in the pack as open items.\n\nExport anyway?`)) return;
  modal(`<h2>Building accountant pack…</h2><div class="muted" id="expProg">Workbook</div>`);
  try {
    const base = `CJP Accountant Pack FY${X.fy}${X.entity === 'all' ? '' : ' - ' + (X.entity === 'smsf' ? 'SMSF' : 'Personal')}`;
    const wb = await XL.build(workbookSheets(X)), html = summaryHtml(X), z = new JSZip(), root = z.folder(base);
    root.file(`${base}.xlsx`, wb); root.file(`Summary FY${X.fy}.html`, html);
    root.file('README.txt', `CJP Investments – accountant pack FY${X.fy} (${ENTITY[X.entity]})\r\nPrepared ${new Date().toLocaleString('en-AU')}\r\n\r\n- ${base}.xlsx : workbook (8 sheets)\r\n- Summary FY${X.fy}.html : printable summary (open, then Print > Save as PDF)\r\n- Supporting documents\\ : PDFs from the SharePoint Properties folders\r\n\r\nRecord-keeping summary, not tax advice. Open items are on the Summary sheet.\r\n`);
    let n = 0, skipped = 0;
    if ($('taxIncDocs')?.checked !== false) for (const d of X.docs.filter(d => d.include)) { try { $('expProg').textContent = 'Adding ' + d.name; root.file(`Supporting documents/${d.folder}/${d.rel}`, await Store.getBlob(d.path)); n++ } catch (e) { skipped++ } }
    $('expProg').textContent = 'Compressing…'; const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const saveCopy = $('taxSaveCopy')?.checked !== false; if (saveCopy) { $('expProg').textContent = 'Saving private copy…'; await Store.writeBlob(`${P_EXPORTS}/FY${X.fy}/${base}.xlsx`, wb); await Store.writeText(`${P_EXPORTS}/FY${X.fy}/Summary FY${X.fy}.html`, html); await Store.writeBlob(`${P_EXPORTS}/FY${X.fy}/${base}.zip`, blob) }
    download(base + '.zip', blob);
    log('Accountant pack exported', `FY${X.fy} · ${ENTITY[X.entity]} · ${X.props.length} properties · ${n} document(s)${skipped ? ` (${skipped} skipped)` : ''} · ${miss} missing item(s)`); save();
    modal(`<h2>✅ Accountant pack ready</h2><p><b>${esc(base)}.zip</b> has been downloaded (${n} supporting PDF(s)${skipped ? `, ${skipped} skipped` : ''}).</p>${saveCopy ? `<div class="note info">A private copy is available for FY${X.fy}</b>.</div>` : ''}${miss ? `<div class="note warn">${miss} item(s) were missing – they're listed in the pack.</div>` : ''}<div class="row end" style="margin-top:14px"><button class="btn primary" onclick="closeModal()">Done</button></div>`);
  } catch (e) { if (e.auth) return needSignIn(e.message); modal(`<h2>Export failed</h2><p class="muted">${esc(e.message)}</p><div class="row end"><button class="btn" onclick="closeModal()">Close</button></div>`) }
}
/* =====================================================================
   TIMELYBILLS – "Bill Report" .xlsx (DUE DATE | TITLE | AMOUNT | PAID AMOUNT | PAID DATE | NOTES)
   ===================================================================== */
// Generic category rules: [pattern on title, category, 'ppor' = assign to your PPOR, ATO label, note]
// Property-specific rules (e.g. which loan belongs to which property) live in your data file:
// S.settings.tbPropertyRules = [[regex source, propertyId, ATO label|null, note], ...]
const TB_RULES = [
  [/hl-ppor|rapid repay|home loan/i, 'Mortgage & Loans', 'ppor', null, ''],
  [/infinit/i, 'Mortgage & Loans', 'ppor', null, 'Infinity Group (Rapid Repay) fee'],
  [/council rates/i, 'Council & Rates', 'ppor', null, ''],
  [/^sa\s*$|sa water/i, 'Utilities', 'ppor', null, 'SA Water'],
  [/origin|superloop|electricity|\bgas\b|agl/i, 'Utilities', 'ppor', null, ''],
  [/home & contents|home and contents/i, 'Insurance', 'ppor', null, ''],
  [/aami auto|rego|service|car /i, 'Transport & Fuel', '', null, ''],
  [/astron|ambulance|revo|pharm|chemist|medibank|bupa/i, 'Health', '', null, ''],
  [/vet|petstock/i, 'Pets', '', null, ''],
  [/asic|tax payment|\bato\b|revenue sa|accountant/i, 'Tax & Accounting', '', null, ''],
  [/m365|microsoft|netflix|spotify|isc2|disney|stan\b|youtube/i, 'Subscriptions', '', null, ''],
  [/afterpay|mobile purchase|paypal|zip pay/i, 'Shopping', '', null, ''],
  [/^fff$/i, 'Spending money (FFF)', '', null, 'Transfer to Food/Fun/Fuel account'],
  [/storage|kennards/i, 'Storage', '', null, '']
];
function tbRule(title, notes) {
  const t = title.trim(), r = TB_RULES.find(r => r[0].test(t)); let [, cat, hint, tc, note] = r || [null, 'Other', '', null, ''];
  let pid = hint === 'ppor' ? (active().find(p => p.type === 'PPOR')?.id || '') : '';
  for (const [src, id, label, n] of S.settings.tbPropertyRules || []) { try { if (new RegExp(src, 'i').test(t)) { pid = id; if (/loan|hl-/i.test(t)) cat = 'Mortgage & Loans'; if (label) tc = label; if (n) note = n; break } } catch (e) { } }
  if (/asic/i.test(t) && /custodian/i.test(notes || '')) { pid = S.properties.find(p => entityOf(p) === 'smsf')?.id || ''; tc = 'Fund/entity expense (not rental)'; note = 'SMSF custodian company fee' }
  return { cat, pid, tc, note };
}
const tbMoney = s => { if (s == null || s === '') return null; const v = typeof s === 'number' ? s : +String(s).replace(/A\$|\$|,|\s/g, ''); return isNaN(v) ? null : v };
function tbDate(s) { if (s == null || s === '') return null; if (typeof s === 'number') return new Date(Date.UTC(1899, 11, 30) + s * 864e5).toISOString().slice(0, 10); return toISO(String(s).trim()) }
async function readXlsxRows(buf) {
  const z = await JSZip.loadAsync(buf), ss = [], sst = z.file('xl/sharedStrings.xml');
  if (sst) new DOMParser().parseFromString(await sst.async('string'), 'application/xml').querySelectorAll('si').forEach(si => ss.push([...si.getElementsByTagName('t')].map(t => t.textContent).join('')));
  const path = z.file('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : Object.keys(z.files).find(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)), rows = [];
  new DOMParser().parseFromString(await z.file(path).async('string'), 'application/xml').querySelectorAll('row').forEach(r => { const row = []; r.querySelectorAll('c').forEach(c => { const ref = c.getAttribute('r') || '', col = ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, t = c.getAttribute('t'); let v = null; if (t === 's') v = ss[+c.getElementsByTagName('v')[0]?.textContent]; else if (t === 'inlineStr') v = [...c.getElementsByTagName('t')].map(x => x.textContent).join(''); else { const x = c.getElementsByTagName('v')[0]?.textContent; v = x == null ? null : (t === 'str' || t === 'b' ? x : +x) } row[col < 0 ? row.length : col] = v }); rows.push(row) });
  return rows;
}
function parseTimely(rows) {
  const hi = rows.findIndex(r => r && r.some(v => /due date/i.test(String(v || ''))) && r.some(v => /title/i.test(String(v || ''))));
  if (hi < 0) throw new Error('This isn\'t a TimelyBills Bill Report (no DUE DATE / TITLE header).');
  const H = rows[hi].map(v => String(v || '').toLowerCase().trim()), ix = k => H.findIndex(h => h === k), c = { due: ix('due date'), title: ix('title'), amt: ix('amount'), paid: ix('paid amount'), pdate: ix('paid date'), notes: ix('notes') };
  return rows.slice(hi + 1).filter(r => r && r[c.title] && !/^total$/i.test(String(r[c.due] || ''))).map(r => ({ due: tbDate(r[c.due]), title: String(r[c.title]).trim(), amount: tbMoney(r[c.amt]), paid: tbMoney(r[c.paid]), paidDate: tbDate(r[c.pdate]), notes: c.notes >= 0 && r[c.notes] ? String(r[c.notes]).trim() : '' })).filter(r => r.due);
}
const FREQ_DAYS = [['weekly', 7], ['fortnightly', 14], ['monthly', 30.4], ['quarterly', 91], ['annual', 365]];
function inferFreq(dates) { if (dates.length < 2) return 'once'; const g = []; for (let i = 1; i < dates.length; i++) g.push((pd(dates[i]) - pd(dates[i - 1])) / 864e5); g.sort((a, b) => a - b); const m = g[Math.floor(g.length / 2)], f = FREQ_DAYS.reduce((b, x) => Math.abs(x[1] - m) < Math.abs(b[1] - m) ? x : b); return Math.abs(f[1] - m) / f[1] < .35 ? f[0] : 'once' }
const tbKey = r => r.title.toLowerCase().replace(/\s+/g, ' ').trim() + (/asic/i.test(r.title) ? '|' + (/custodian/i.test(r.notes) ? 'custodian' : 'company') : '');
function planTimely(items, fname) {
  const seen = new Set(S.transactions.filter(t => t.tbKey).map(t => t.tbKey)), tx = [], dup = [], unpaid = [];
  items.forEach(r => { const R = tbRule(r.title, r.notes); if (r.paid == null || !r.paidDate) { unpaid.push(r); return } const k = `tb|${r.due}|${tbKey(r)}|${r.paid}`; if (seen.has(k)) { dup.push(r); return } seen.add(k);
    tx.push({ id: uid(), date: r.paidDate, desc: r.title + (r.paid < (r.amount || 0) ? ` (part: ${money(r.paid)} of ${money(r.amount)})` : ''), amount: -r.paid, category: R.cat, propertyId: R.pid, source: 'TimelyBills · ' + fname, agent: 'TimelyBills', tbKey: k, ...(R.tc ? { taxCat: R.tc } : {}), ...(r.notes || R.note ? { note: [r.notes, R.note].filter(Boolean).join(' · ') } : {}) }) });
  const groups = {}; items.forEach(r => (groups[tbKey(r)] ||= []).push(r));
  const bills = Object.values(groups).map(g => { g.sort((a, b) => a.due.localeCompare(b.due)); const last = g.at(-1), R = tbRule(last.title, last.notes), freq = inferFreq(g.map(x => x.due)); let next = last.due; if (freq !== 'once') while (next < iso(today())) next = addPeriod(next, freq); return { title: /^sa$/i.test(last.title.trim()) ? 'SA Water' : last.title.trim(), key: tbKey(last), freq, next: freq === 'once' ? null : next, amount: last.amount, R, active: freq !== 'once' && days(last.due) > -400 } });
  return { tx, dup, unpaid, bills };
}
async function importTimelyFile(file, opts = {}) {
  const items = parseTimely(await readXlsxRows(await file.arrayBuffer())), P = planTimely(items, file.name);
  if (opts.preview === false) return P;
  const sum = c => P.tx.filter(t => t.category === c).reduce((a, t) => a - t.amount, 0), rec = P.bills.filter(b => b.freq !== 'once');
  modal(`<h2>📅 TimelyBills import</h2><div class="muted sm">${esc(file.name)} · ${items.length} rows · ${fdate(items[0]?.due)} – ${fdate(items.at(-1)?.due)}</div>
   <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-top:12px">${[['New payments', P.tx.length, m0(-P.tx.reduce((a, t) => a + t.amount, 0))], ['Already imported', P.dup.length, 'skipped'], ['Unpaid', P.unpaid.length, P.unpaid.slice(0, 3).map(u => u.title).join(', ') || '—']].map(k => `<div class="card kpi"><div class="lbl">${k[0]}</div><div class="val" style="font-size:22px">${k[1]}</div><div class="hint">${esc(k[2])}</div></div>`).join('')}</div>
   <h3 style="margin-top:14px">By category</h3><table>${[...new Set(P.tx.map(t => t.category))].sort((a, b) => sum(b) - sum(a)).map(c => `<tr><td>${esc(c)}</td><td class="num">${money(sum(c))}</td></tr>`).join('') || '<tr><td class="muted">Nothing new</td></tr>'}</table>
   <h3 style="margin-top:14px">Recurring bills found</h3><table class="stack">${rec.map(b => `<tr><td><input type="checkbox" class="tbB" data-i="${P.bills.indexOf(b)}" ${b.active ? 'checked' : ''}></td><td>${esc(b.title)}${b.R.note ? `<div class="muted sm">${esc(b.R.note)}</div>` : ''}</td><td>${FREQ[b.freq]}</td><td>${fdate(b.next)}</td><td class="num">${money(b.amount)}</td><td>${esc(pname(b.R.pid)) || '—'}</td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table>
   <label class="chk" style="margin-top:10px"><input type="checkbox" id="tbTx" checked> Add ${P.tx.length} payments to Spending</label>
   <div class="note">Loan rows are repayments (principal + interest), not deductions. The tax pack uses the interest figure from the lender (Tax › Loans &amp; interest).</div>
   <div class="row end" style="margin-top:14px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="tbGo">Import</button></div>`);
  return new Promise(res => { $('tbGo').onclick = async () => {
    let nb = 0, ub = 0; const addTx = $('tbTx').checked; if (addTx) S.transactions.push(...P.tx);
    document.querySelectorAll('.tbB').forEach(cb => { if (!cb.checked) return; const b = P.bills[+cb.dataset.i], ex = S.bills.find(x => x.tbKey === b.key); if (ex) { Object.assign(ex, { amount: b.amount, dueDate: b.next, freq: b.freq }); ub++ } else { S.bills.push({ id: uid(), name: b.title, biller: b.title, category: b.R.cat, propertyId: b.R.pid, amount: b.amount, dueDate: b.next, freq: b.freq, status: 'due', notes: b.R.note || '', agent: 'TimelyBills', tbKey: b.key }); nb++ } });
    if (opts.inboxPath) { try { await moveFile(opts.inboxPath, `${P_TB}/processed`) } catch (e) { console.warn(e) } }
    log('TimelyBills imported', `${file.name}: ${addTx ? P.tx.length : 0} payments, ${nb} new / ${ub} updated bills, ${P.dup.length} duplicates skipped`, { actor: 'agent:TimelyBills' });
    closeModal(); await checkTimelyInbox(); save(); toast('TimelyBills imported'); res(P);
  } });
}
function pickTimely() { const i = document.createElement('input'); i.type = 'file'; i.accept = '.xlsx'; i.onchange = () => i.files[0] && importTimelyFile(i.files[0]).catch(e => toast(e.message)); i.click() }
async function checkTimelyInbox() { window._tbPending = (await Store.list(P_TB)).filter(i => !i.dir && /\.xlsx$/i.test(i.name)).map(i => i.name); return window._tbPending.length }
async function importTimelyInbox() { const n = (window._tbPending || [])[0]; if (!n) return toast('No TimelyBills files waiting'); const f = new File([await Store.getBlob(`${P_TB}/${n}`)], n); await importTimelyFile(f, { inboxPath: `${P_TB}/${n}` }).catch(e => toast(e.message)) }

/* =====================================================================
   START-UP, SIGN-IN GATE, FIRST-RUN SETUP
   ===================================================================== */
function renderAll() {
  if (!S) return; renderNav();
  ({ dashboard: renderDashboard, bills: renderBills, spending: renderSpending, mortgage: renderMortgage, portfolio: renderPortfolio, props: renderProps, prop: renderPropPage, import: renderImport, inbox: renderInbox, activity: renderActivity, tax: renderTax })[view]?.();
  if (view !== 'dashboard') renderDashboard();
}
const msBtn = (label, fn) => `<button class="btn primary big ms" onclick="${fn}"><i><b style="background:#f25022"></b><b style="background:#7fba00"></b><b style="background:#00a4ef"></b><b style="background:#ffb900"></b></i>${label}</button>`;
function gate(html) { $('gateBody').innerHTML = html; $('gate').style.display = 'flex' }
function showSignIn(msg) {
  gate(`${msg ? `<div class="note warn" style="margin:0 0 14px">${esc(msg)}</div>` : ''}
  <p class="muted" style="margin:0 0 14px">Sign in with Microsoft to access your private property and financial dashboard.</p>
  <div class="row">${msBtn('Sign in with Microsoft', 'Auth.login()')}</div>
  <div class="muted sm" style="margin-top:18px">🔒 Authentication required. Financial information remains unavailable until sign-in completes.</div>`);
}
function showStorageSetup(msg) {
  gate(`<h2 style="margin-top:0">Connect private data</h2>${msg ? `<div class="note warn" style="margin:0 0 14px">${esc(msg)}</div>` : ''}
  <p class="muted">Microsoft authentication is complete. This one-time step links this browser to your private data store; the location is never published with the website.</p>
  <label>Private Microsoft 365 site URL</label><input id="privateSiteUrl" type="url" autocomplete="off" placeholder="https://tenant.sharepoint.com/sites/private-site">
  <div class="row end" style="margin-top:14px"><button class="btn" onclick="Auth.logout()">Sign out</button><button class="btn primary" id="privateSiteGo">Connect private storage</button></div>`);
  $('privateSiteGo').onclick = async () => {
    const b=$('privateSiteGo'); b.disabled=true; b.textContent='Connecting…';
    try { Store=Cloud; await Cloud.configure($('privateSiteUrl').value); await afterConnect(); }
    catch(e){ showStorageSetup(e.message); }
  };
}
function needSignIn() { Store = null; showSignIn('Your session has expired or access could not be verified. Please sign in again.') }
function signOut() { Auth.logout() }
async function afterConnect() {
  gate('<div class="muted">Loading your data…</div>');
  try { if (!(await loadData())) return firstRun() } catch (e) { if (e.auth) return needSignIn(); return gate(`<div class="note warn" style="margin:0">Private data could not be loaded.</div><p class="muted sm">Try again. If the problem continues, use the Microsoft 365 document version history from an authenticated session.</p><button class="btn" onclick="location.reload()">Retry</button>`) }
  $('gate').style.display = 'none'; $('whoAmI').textContent = Auth.tok?.user || '';
  setSync('Loaded ' + (S.updated ? fdt(S.updated) : '')); await loadCovers(); renderAll();
  await checkAgents(false); await runScan(true);
  log('Portal opened', `${Inbox.items.length} inbox item(s)`, { actor: 'portal' }); saveData();
  if (!window._timers) { window._timers = 1; setInterval(() => { if (!document.hidden && Store) checkAgents(false) }, 5 * 60 * 1000); document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfChanged() }) }
}
function firstRun() {
  gate(`<h2 style="margin-top:0">Welcome – first-time setup</h2><p class="muted">The private data store is connected, but no portal data file exists yet.</p>
  <div class="card" style="margin:12px 0"><b>Load a starter file</b><div class="muted sm" style="margin:6px 0 10px">Choose a local starter-data.json backup. It is written directly to the authenticated private data store and is not uploaded to the public website.</div><label class="btn primary" style="margin:0;text-transform:none;letter-spacing:0;font-size:14px;color:#fff">Choose starter-data.json<input type="file" accept=".json,application/json" hidden onchange="loadStarter(this)"></label></div>
  <div class="card"><b>Or start empty</b><div class="muted sm" style="margin:6px 0 10px">Add properties and bills manually or import your existing records.</div><button class="btn" onclick="startEmpty()">Start empty</button></div>`);
}
async function loadStarter(inp) {
  const f = inp.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!Array.isArray(d.properties)) throw new Error('Not a portal data file'); S = d; migrate(); log('Portal data created', `Loaded ${f.name} (${S.properties.length} properties)`, { actor: 'portal' }); etag = null; lastText = null; await saveData(); await afterConnect() }
  catch (e) { toast('Could not load file: ' + e.message) }
}
async function startEmpty() { S = emptyData(); log('Portal data created', 'Started empty', { actor: 'portal' }); etag = null; lastText = null; await saveData(); await afterConnect() }
async function boot() {
  try {
    const redirected = await Auth.handleRedirect();
    if (redirected || Auth.tok) { Store = Cloud; try { await Cloud.init(); return afterConnect() } catch(e) { if (e.setup) return showStorageSetup(e.message); throw e; } }
  } catch (e) { return showSignIn('We could not complete sign-in. Please try again.') }
  showSignIn();
}
window.addEventListener('beforeunload', e => { if (saving || saveT) { saveData(); e.preventDefault(); e.returnValue = '' } });
document.addEventListener('DOMContentLoaded', () => { $('modal').onclick = e => { if (e.target.id === 'modal') closeModal() }; boot() });
