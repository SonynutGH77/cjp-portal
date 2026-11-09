/* Property Portal - Macquarie reports v1.1 (add-on, works with app.js v6.5.x)
   Imports the three Macquarie "report" PDFs that bank-statement import does not accept:
     - Proof of Balance Report          -> loan balance, redraw available and offset balance on each loan
     - Financial Year's Interest Report -> interest charged per loan for each financial year (Tax > Loans), interest earned noted for the accountant
     - Tax Transaction Report           -> the tax-tagged transactions (BPAY to the ATO, purchases) as transactions
   v1.1 changes (accuracy for the accountant):
     - Every report is reconciled to its own Total row (or per-account totals for the tax report). A mismatch is shown and needs a second confirmation.
     - Accounts are shown with the SAME nickname and masked number as the Money section (from accountpreset.js). Full account numbers and holder names are not displayed.
     - The Collins Wharf equity split (9124) is matched to its loan automatically. SMSF accounts match the SMSF property even if its entity flag is not set.
     - Tax Office payments are no longer assumed to be "PAYG instalments" and are no longer attached to a property. They are left Unclassified for you to choose.
     - "Unclassified" / "Private / not deductible" always exist in the ATO category list, so a row can never silently pick the first category.
     - Interest review warns that the current financial year is part-year.
   Balances and interest are set (not added), and transactions get a fixed id, so importing the same report twice never duplicates.
   Nothing in app.js is edited. This file adds its own card and review screen and only wraps renderImport. */
(() => {
  'use strict';
  const VER = '1.2';
  const ROOT = 'Portal/Bank Statements';
  const NAME_RE = /interest[-_ ]?report|proof[-_ ]?of[-_ ]?balance|tax[-_ ]?transaction/i;
  const MON = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const AMT = s => +String(s).replace(/,/g, '');
  const r2 = n => Math.round(n * 100) / 100;
  const g = () => (typeof window !== 'undefined' ? window : globalThis);
  const digits = v => String(v || '').replace(/\D/g, '');
  const stripZ = v => digits(v).replace(/^0+/, '');
  const sgn = (v, cd) => (cd === 'DR' ? -v : v);
  const f2 = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ---------- same names as the Money section ---------- */
  const NICK = { '9207': 'Neale Home Loan', '8993': 'Salary & Bills', '9132': 'Food/Fun/Fuel', '2048': 'Online Purchases', '9124': 'Collins Wharf Equity Split', '3269': 'SMSF Cash Management', '3997': 'SMSF Accelerator' };
  function presetFor(acct) {
    const d = stripZ(acct), list = (g().CJPAccountPreset && g().CJPAccountPreset.presets) || [];
    return list.find(p => stripZ(p.accountNumber) === d) || null;
  }
  // name + masked sub-line. The full account number and the holder name are never shown.
  function shown(acct, rawName) {
    const p = presetFor(acct), l4 = digits(acct).slice(-4);
    if (p) return { name: NICK[p.last4] || String(p.name || '').replace(/^Macquarie\s+/i, '').replace(/\s*\u2022+\d{4}\s*$/, '').trim(), sub: 'Macquarie \u00b7 \u2022\u2022\u2022\u2022' + p.last4, known: true };
    return { name: rawName || 'Account', sub: 'Macquarie \u00b7 \u2022\u2022\u2022\u2022' + l4, known: false };
  }

  /* ---------- reading the PDF (text + positions) ---------- */
  async function mqRead(blob) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = []; let text = '';
    for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      const items = c.items.filter(x => x.str && x.str.trim()).map(x => ({ s: x.str.trim(), x: x.transform[4], y: x.transform[5], w: x.width }));
      pages.push(items); text += c.items.map(x => x.str).join(' ') + '\n';
    }
    return { pages, text: text.replace(/[ \t]+/g, ' ') };
  }
  const kindOf = t => /proof of balance report/i.test(t) ? 'balance' : /financial year.{0,3}s? interest report/i.test(t) ? 'interest' : /tax transaction report/i.test(t) ? 'taxtx' : null;
  const KIND_LABEL = { balance: 'Proof of balance', interest: 'Financial year interest', taxtx: 'Tax transactions' };
  const asAtOf = t => { const m = t.match(/as at\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i); return m ? (toISO(m[1]) || '') : ''; };

  /* account rows: "<name> <holder> <BSB> | <account> <numbers...>" */
  function acctRows(text) {
    const re = /(\d{6})\s*\|\s*(\d{6,12})((?:\s+-?[\d,]+\.\d{2}(?:\s+(?:CR|DR))?)+)/g, out = []; let m, last = 0;
    while ((m = re.exec(text))) {
      let name = text.slice(last, m.index).replace(/\s+/g, ' ').trim();
      name = name.replace(/^[\s\S]*(?:Interest earned|Available Balance|Total credits)\s+(?=[A-Za-z])/, '');   // drop the page heading / column titles before the first row
      const hm = name.match(/(Christopher James Poore|CJP INVESTMENTS PTY\.? LTD\.? ATF CJP SUPER FUND)\s*$/);
      const holder = hm ? hm[1].trim() : ''; if (hm) name = name.slice(0, hm.index).trim();
      const nums = [...m[3].matchAll(/(-?[\d,]+\.\d{2})(?:\s+(CR|DR))?/g)].map(x => ({ v: AMT(x[1]), cd: x[2] || '' }));
      out.push({ acct: m[2], bsb: m[1], name: name || 'Account', holder, nums }); last = m.index + m[0].length;
    }
    return out;
  }
  /* the report's own "Total" row (the last one in the text) */
  function totalRow(text) {
    const re = /\bTotal\s+((?:-?[\d,]+\.\d{2}(?:\s+(?:CR|DR))?\s*)+)/g; let m, last = null;
    while ((m = re.exec(text))) last = m[1];
    if (!last) return null;
    return [...last.matchAll(/(-?[\d,]+\.\d{2})(?:\s+(CR|DR))?/g)].map(x => ({ v: AMT(x[1]), cd: x[2] || '' }));
  }
  const checkNote = c => c.ok === true
    ? '<div class="note info">\u2713 The accounts add up to the Total row printed on the report.</div>'
    : c.ok === false
      ? `<div class="note warn">\u26A0 These figures do NOT add up to the report's Total row: ${c.problems.map(esc).join('; ')}. Do not import until this is resolved.</div>`
      : '<div class="note warn">\u26A0 The report\'s Total row could not be found, so these figures could not be checked.</div>';

  /* ---------- the three report types ---------- */
  function parseBalance(rd) {
    const rows = acctRows(rd.text).filter(r => r.nums.length >= 2).map(r => ({ acct: r.acct, name: r.name, holder: r.holder, available: sgn(r.nums[0].v, r.nums[0].cd), balance: r.nums[1].v, cd: r.nums[1].cd }));
    const tot = totalRow(rd.text), check = { ok: null, problems: [] };
    if (tot && tot.length >= 2 && rows.length) {
      const av = r2(rows.reduce((a, r) => a + r.available, 0)), bl = r2(rows.reduce((a, r) => a + sgn(r.balance, r.cd), 0));
      const tA = sgn(tot[0].v, tot[0].cd), tB = sgn(tot[1].v, tot[1].cd);
      if (Math.abs(av - tA) > 0.005) check.problems.push(`Available: accounts add to ${f2(av)}, report total ${f2(tA)}`);
      if (Math.abs(bl - tB) > 0.005) check.problems.push(`Balance: accounts add to ${f2(bl)}, report total ${f2(tB)}`);
      check.ok = !check.problems.length;
    }
    return { kind: 'balance', asAt: asAtOf(rd.text), rows, check };
  }
  function parseInterest(rd) {
    const T = rd.text, asAt = asAtOf(T);
    const fyl = y => `${y}-${String(y + 1).slice(2)}`;
    let a = T.match(/1 July (\d{4})\s*-\s*to date/i), b = T.match(/1 July (\d{4})\s*-\s*30 June (\d{4})/i);
    const cur = a ? fyl(+a[1]) : (asAt ? fyOf(asAt) : ''), prev = b ? fyl(+b[1]) : (cur ? fyl(+cur.slice(0, 4) - 1) : '');
    const rows = acctRows(T).filter(r => r.nums.length >= 4).map(r => ({ acct: r.acct, name: r.name, holder: r.holder, charged: { [cur]: r.nums[0].v, [prev]: r.nums[2].v }, earned: { [cur]: r.nums[1].v, [prev]: r.nums[3].v } }));
    const tot = totalRow(T), check = { ok: null, problems: [] };
    if (tot && tot.length >= 4 && rows.length) {
      const sum = f => r2(rows.reduce((s, r) => s + f(r), 0));
      const cmp = (label, got, want) => { if (Math.abs(got - want) > 0.005) check.problems.push(`${label}: accounts add to ${f2(got)}, report total ${f2(want)}`); };
      cmp('Charged ' + cur, sum(r => r.charged[cur]), tot[0].v); cmp('Earned ' + cur, sum(r => r.earned[cur]), tot[1].v);
      cmp('Charged ' + prev, sum(r => r.charged[prev]), tot[2].v); cmp('Earned ' + prev, sum(r => r.earned[prev]), tot[3].v);
      check.ok = !check.problems.length;
    }
    return { kind: 'interest', asAt, cur, prev, rows, check };
  }
  function parseTaxTx(rd) {
    const sum = {}; acctRows(rd.text).filter(r => r.nums.length === 2).forEach(r => { sum[r.acct] = { name: r.name, holder: r.holder, debits: r.nums[0].v, credits: r.nums[1].v }; });
    const range = (rd.text.match(/from (\d{1,2} [A-Za-z]+ \d{4}) to (\d{1,2} [A-Za-z]+ \d{4})/i) || []).slice(1).map(x => toISO(x));
    const tx = []; let monthYear = null;
    rd.pages.forEach(items => {
      const list = items.slice().sort((p, q) => q.y - p.y || p.x - q.x);
      const hdr = { d: items.find(i => i.s === 'Debits'), c: items.find(i => i.s === 'Credits') };
      const mid = hdr.d && hdr.c ? ((hdr.d.x + hdr.d.w) + (hdr.c.x + hdr.c.w)) / 2 : 518;   // halfway between the right edges of "Debits" and "Credits"
      let cur = null;
      const close = () => { if (cur && cur.amount != null) tx.push(cur); cur = null; };
      list.forEach(it => {
        const mm = it.x < 60 && it.s.match(/^([A-Za-z]+) (\d{4})$/);
        if (mm && MON.includes(mm[1].toLowerCase())) { close(); monthYear = { m: MON.indexOf(mm[1].toLowerCase()) + 1, y: +mm[2] }; return; }
        const dm = it.x < 60 && it.s.match(/^([A-Z][a-z]{2}) (\d{1,2})$/);
        if (dm && monthYear) { close(); const mo = MON.findIndex(n => n.startsWith(dm[1].toLowerCase())) + 1; if (mo) cur = { date: `${monthYear.y}-${String(mo).padStart(2, '0')}-${dm[2].padStart(2, '0')}`, desc: '', acct: '', acctName: '', amount: null, dir: '' }; return; }
        if (!cur) return;
        if (it.x >= 100 && it.x < 400) { const am = it.s.match(/^(.+?)\s+-\s+(\d{6,12})$/); if (am) { cur.acctName = am[1]; cur.acct = am[2]; } else cur.desc = (cur.desc ? cur.desc + ' ' : '') + it.s; }
        else if (it.x >= 400 && /^[\d,]+\.\d{2}$/.test(it.s)) { cur.amount = AMT(it.s); cur.dir = (it.x + it.w) < mid ? 'debit' : 'credit'; }
      });
      close();
    });
    // acct numbers in the summary have more leading digits than the detail lines on some reports: match by trailing digits
    const keyFor = a => Object.keys(sum).find(k => k === a || k.endsWith(a) || a.endsWith(k)) || a;
    tx.forEach(t => { t.acct = keyFor(t.acct); });
    const check = {}; Object.keys(sum).forEach(k => { check[k] = { name: sum[k].name, debits: sum[k].debits, credits: sum[k].credits, gotD: 0, gotC: 0 }; });
    tx.forEach(t => { const c = check[t.acct]; if (c) { if (t.dir === 'debit') c.gotD = r2(c.gotD + t.amount); else c.gotC = r2(c.gotC + t.amount); } });
    const mismatch = Object.keys(check).map(k => ({ acct: k, ...check[k] })).filter(c => Math.abs(c.debits - c.gotD) > 0.005 || Math.abs(c.credits - c.gotC) > 0.005);
    // a transaction on an account that is not in the summary can never be reconciled - treat as a mismatch too
    const orphan = tx.filter(t => !check[t.acct]);
    return { kind: 'taxtx', from: range[0] || '', to: range[1] || '', tx, summary: sum, check, mismatch, orphan };
  }
  function parseReport(rd) {
    const k = kindOf(rd.text); if (!k) return null;
    return k === 'balance' ? parseBalance(rd) : k === 'interest' ? parseInterest(rd) : parseTaxTx(rd);
  }

  /* ---------- matching Macquarie accounts to loans / offsets / properties ---------- */
  // Evidence: the Jan-Jun 2026 statement for 018939207 lists 018939132 and 018938993 as its linked offset accounts.
  const HINTS = { '018939207': { loan: true }, '018939132': { offsetOf: '018939207' }, '018938993': { offsetOf: '018939207' }, '018939124': { loanLike: /equity|collins/i } };
  const loansAll = () => S.properties.flatMap(p => (p.loans || []).map(l => ({ p, l })));
  const findLoan = id => loansAll().find(x => x.l.id === id) || null;
  function pporLoan() {
    const ps = S.properties.filter(p => p.type === 'PPOR' && !p.sold); if (ps.length !== 1) return null;
    const ls = ps[0].loans || []; if (ls.length === 1) return ls[0];
    return ls.find(l => /macquarie|offset|home/i.test(l.name || '') && !/equity/i.test(l.name || '')) || null;
  }
  function smsfProp() {
    return S.properties.find(p => !p.sold && entityOf(p) === 'smsf')
      || S.properties.find(p => !p.sold && (p.loans || []).some(l => /smsf/i.test(l.name || ''))) || null;
  }
  function suggest(acct, name, holder) {
    const saved = (S.settings.macAccounts || {})[acct]; if (saved) return saved;
    const own = loansAll().find(x => x.l.acct === acct); if (own) return 'loan:' + own.l.id;
    const h = HINTS[acct];
    if (h && h.loan) { const l = pporLoan(); if (l) return 'loan:' + l.id; }
    if (h && h.loanLike) { const x = loansAll().find(x => h.loanLike.test(x.l.name || '')); if (x) return 'loan:' + x.l.id; }
    if (h && h.offsetOf) { const base = loansAll().find(x => x.l.acct === h.offsetOf) || (pporLoan() ? { l: pporLoan() } : null); if (base) return 'off:' + base.l.id; }
    if (/super fund/i.test(holder || '')) { const p = smsfProp(); return p ? 'prop:' + p.id : 'none'; }
    if (/platinum transaction/i.test(name || '')) return 'none';
    return '';
  }
  function mapSelect(acct, sel) {
    let o = `<option value="" ${sel === '' ? 'selected' : ''}>\u2014 choose \u2014</option><option value="none" ${sel === 'none' ? 'selected' : ''}>Not tracked (personal / other)</option>`;
    loansAll().forEach(({ p, l }) => { o += `<option value="loan:${esc(l.id)}" ${sel === 'loan:' + l.id ? 'selected' : ''}>Loan \u00b7 ${esc(p.name)} \u00b7 ${esc(l.name || 'Loan')}</option>`; });
    loansAll().forEach(({ p, l }) => { o += `<option value="off:${esc(l.id)}" ${sel === 'off:' + l.id ? 'selected' : ''}>Offset of \u00b7 ${esc(p.name)} \u00b7 ${esc(l.name || 'Loan')}</option>`; });
    S.properties.forEach(p => { o += `<option value="prop:${esc(p.id)}" ${sel === 'prop:' + p.id ? 'selected' : ''}>Account of \u00b7 ${esc(p.name)}${entityOf(p) === 'smsf' ? ' (SMSF)' : ''}</option>`; });
    return `<select data-mqacct="${esc(acct)}" class="mini2" style="max-width:260px">${o}</select>`;
  }
  function propOfMapping(v) {
    if (!v) return ''; const [k, id] = v.split(':');
    if (k === 'prop') return id; if (k === 'loan' || k === 'off') { const x = findLoan(id); return x ? x.p.id : ''; } return '';
  }

  /* ---------- applying ---------- */
  function applyBalance(rep, maps) {
    const done = [], offs = {}; let n = 0;
    // v1.2: keep the Macquarie figure for EVERY account in the report (even ones not mapped to a loan), so the Dashboard can show it and check the loan against it
    S.macBalances = S.macBalances || {};
    rep.rows.forEach(r => { const k = stripZ(r.acct), o = S.macBalances[k]; if (!o || String(o.asAt || '') <= String(rep.asAt || '9999')) S.macBalances[k] = { asAt: rep.asAt || '', balance: r.balance, cd: r.cd, available: r.available }; });
    rep.rows.forEach(r => {
      const v = maps[r.acct] || ''; if (!v.startsWith('loan:') && !v.startsWith('off:')) return;
      const x = findLoan(v.slice(v.indexOf(':') + 1)); if (!x) return;
      if (v.startsWith('loan:')) {
        x.l.acct = r.acct; x.l.balance = r.cd === 'DR' ? r.balance : 0; x.l.available = r.available > 0 ? r.available : null;
        done.push(`${x.l.name}: balance ${m0(x.l.balance)}${x.l.available ? ', available ' + m0(x.l.available) : ''}`); n++;
      } else { offs[x.l.id] = (offs[x.l.id] || 0) + (r.cd === 'DR' ? -r.balance : r.balance); offs[x.l.id + '#n'] = (offs[x.l.id + '#n'] || 0) + 1; }
    });
    Object.keys(offs).filter(k => !k.endsWith('#n')).forEach(id => { const x = findLoan(id); if (!x) return; x.l.offset = r2(offs[id]); done.push(`${x.l.name}: offset ${m0(x.l.offset)} (${offs[id + '#n']} account${offs[id + '#n'] > 1 ? 's' : ''})`); n++; });
    return { n, text: done.join(' \u00b7 ') || 'Nothing matched to a loan' };
  }
  function applyInterest(rep, maps) {
    const done = []; let n = 0;
    rep.rows.forEach(r => {
      const v = maps[r.acct] || '';
      if (v.startsWith('loan:')) {
        const x = findLoan(v.slice(5)); if (!x) return; x.l.acct = r.acct;
        [rep.prev, rep.cur].filter(Boolean).forEach(fy => { const Y = ty(fy); Y.loans[x.l.id] = { ...(Y.loans[x.l.id] || {}), interest: r.charged[fy] }; });
        done.push(`${x.l.name}: FY${rep.prev} ${m0(r.charged[rep.prev])}${rep.cur ? `, FY${rep.cur} to date ${m0(r.charged[rep.cur])}` : ''}`); n++;
      }
      [rep.prev, rep.cur].filter(Boolean).forEach(fy => { if (r.earned[fy] > 0) { const Y = ty(fy); Y.bankInterest = Y.bankInterest || {}; Y.bankInterest[r.acct] = { name: r.name, holder: r.holder, earned: r.earned[fy], asAt: rep.asAt }; } });
    });
    return { n, text: done.join(' \u00b7 ') || 'No loan accounts matched' };
  }
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const txId = t => 'mq' + hash([t.date, t.acct, t.desc, t.dir, t.amount].join('|'));   // unchanged from v1.0 so earlier imports are still recognised
  function applyTx(rows) {
    let n = 0, skipped = 0;
    rows.forEach(r => {
      if (!r.on) return; const id = txId(r.t);
      if (S.transactions.some(x => x.id === id)) { skipped++; return; }
      const o = { id, date: r.t.date, desc: r.desc, amount: r.t.dir === 'debit' ? -r.t.amount : r.t.amount, category: r.category, propertyId: r.propertyId, source: 'Macquarie tax transaction report' };
      if (r.taxCat && ATO_ALL.includes(r.taxCat)) o.taxCat = r.taxCat;
      S.transactions.push(o); n++;
    });
    return { n, skipped, text: `${n} transaction(s) added${skipped ? `, ${skipped} already there` : ''}` };
  }

  /* ---------- review screens ---------- */
  function acctTable(rep, extraHead, rowCells) {
    return `<table class="stack"><thead><tr><th>Macquarie account</th>${extraHead}<th>Treat as</th></tr></thead><tbody>${rep.rows.map(r => { const s = shown(r.acct, r.name); return `<tr><td><b>${esc(s.name)}</b><div class="muted sm">${esc(s.sub)}</div></td>${rowCells(r)}<td>${mapSelect(r.acct, suggest(r.acct, r.name, r.holder))}</td></tr>`; }).join('')}</tbody></table>`;
  }
  // "Unclassified" and "Private / not deductible" must exist, otherwise the browser silently selects the first real category
  const catList = () => ['Unclassified', 'Private / not deductible'].filter(c => !ATO_ALL.includes(c)).concat(ATO_ALL);
  const catOpt = sel => catList().map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
  function taxRows(rep) {
    const maps = {}; [...new Set(rep.tx.map(t => t.acct))].forEach(a => { const s = rep.summary[a] || {}; maps[a] = suggest(a, s.name, s.holder); });
    return rep.tx.map((t, i) => {
      const dup = S.transactions.find(x => x.id !== txId(t) && x.date === t.date && Math.abs(Math.abs(x.amount) - t.amount) < 0.005);
      const same = S.transactions.some(x => x.id === txId(t));
      const taxOffice = /tax office/i.test(t.desc), interest = t.dir === 'credit' && /^payment$/i.test(t.desc);
      const nick = shown(t.acct, t.acctName).name;
      const notes = [];
      if (same) notes.push('already imported'); else if (dup) notes.push(`looks like "${dup.desc}" already recorded`);
      if (interest) notes.push('bank interest \u2013 not part of the rental schedule');
      if (taxOffice) notes.push('Tax Office payment \u2013 choose the ATO category once you know what it was for');
      return { i, t, desc: t.desc + ' (' + nick + ')', propertyId: '', category: taxOffice ? 'Tax & Accounting' : 'Other', taxCat: interest ? 'Private / not deductible' : 'Unclassified',
        on: !dup && !same && !interest, note: notes.join(' \u00b7 ') };
    });
  }
  function review(file) {
    modal(`<h2>Reading\u2026</h2><div class="muted">${esc(file.name)}</div>`);
    (async () => {
      let rd, rep; try { rd = await mqRead(await Store.getBlob(file.path)); rep = parseReport(rd); } catch (e) { modal(`<h2>Couldn't read PDF</h2><p class="muted">${esc(e.message)}</p><div class="row end"><button class="btn" onclick="closeModal()">Close</button></div>`); return; }
      if (!rep) { modal(`<h2>Not a Macquarie report</h2><p class="muted">${esc(file.name)} isn't a Proof of Balance, Financial Year Interest or Tax Transaction report.</p><div class="row end"><button class="btn" onclick="closeModal()">Close</button></div>`); return; }
      const when = rep.asAt ? ` \u00b7 as at ${fdate(rep.asAt)}` : rep.from ? ` \u00b7 ${fdate(rep.from)} to ${fdate(rep.to)}` : '';
      let body = '', rowsT = null;
      if (rep.kind === 'balance') {
        body = checkNote(rep.check) + acctTable(rep, '<th class="num">Available</th><th class="num">Balance</th>', r => `<td class="num">${money(r.available)}</td><td class="num"><b>${money(r.balance)}</b> ${r.cd}</td>`) +
          `<div class="muted sm" style="margin-top:8px">Loan accounts update the loan's balance and redraw available. Offset accounts are added together and set as that loan's offset. Everything else is skipped.</div>`;
      } else if (rep.kind === 'interest') {
        body = checkNote(rep.check) + acctTable(rep, `<th class="num">Charged FY${esc(rep.prev)}</th><th class="num">Charged FY${esc(rep.cur)} to date</th><th class="num">Earned FY${esc(rep.prev)}</th>`, r => `<td class="num">${money(r.charged[rep.prev])}</td><td class="num">${money(r.charged[rep.cur])}</td><td class="num">${money(r.earned[rep.prev])}</td>`) +
          `<div class="note warn" style="margin-top:8px">FY${esc(rep.cur)} is a part-year figure${rep.asAt ? ' (to ' + esc(fdate(rep.asAt)) + ')' : ''}. Import this report again after 30 June so the full year is recorded before it goes to your accountant.</div>` +
          `<div class="muted sm" style="margin-top:8px">Interest charged on a loan account is saved under Tax &amp; accountant &gt; Loans for each year. Interest earned is noted for your accountant; it is not rental income, so it is not in the rental schedule. Whether interest on a given loan is deductible depends on what the money was used for \u2013 confirm that with your accountant.</div>`;
      } else {
        rowsT = taxRows(rep);
        const accts = [...new Set(rep.tx.map(t => t.acct))];
        const bad = rep.mismatch.length || rep.orphan.length;
        body = (!bad ? `<div class="note info">\u2713 Transactions add up to the totals on the report's summary page for every account.</div>` : `<div class="note warn">\u26A0 These do not add up to the report's totals: ${rep.mismatch.map(c => `${esc(shown(c.acct, c.name).name)} (report ${money(c.debits)} / ${money(c.credits)}, read ${money(c.gotD)} / ${money(c.gotC)})`).concat(rep.orphan.length ? [`${rep.orphan.length} transaction(s) on an account that is not in the summary`] : []).join('; ')}. Check the rows before importing.</div>`) +
          `<h3 style="margin-top:12px">Accounts</h3><table class="stack"><tbody>${accts.map(a => { const s = shown(a, (rep.summary[a] || {}).name); return `<tr><td><b>${esc(s.name)}</b><div class="muted sm">${esc(s.sub)}</div></td><td>${mapSelect(a, suggest(a, (rep.summary[a] || {}).name, (rep.summary[a] || {}).holder))}</td></tr>`; }).join('')}</tbody></table>` +
          `<h3 style="margin-top:14px">Transactions (${rowsT.length})</h3><div style="overflow:auto;max-height:44vh"><table class="stack"><thead><tr><th></th><th>Date</th><th>Description</th><th class="num">Amount</th><th>Property</th><th>ATO category</th></tr></thead><tbody>${rowsT.map(r => `<tr><td><input type="checkbox" data-mqon="${r.i}" ${r.on ? 'checked' : ''}></td><td class="nowrap">${fdate(r.t.date)}</td><td>${esc(r.desc)}${r.note ? `<div class="amber sm">${esc(r.note)}</div>` : ''}</td><td class="num ${r.t.dir === 'credit' ? 'green' : ''}">${r.t.dir === 'debit' ? '-' : ''}${money(r.t.amount)}</td><td><select data-mqprop="${r.i}" class="mini2" style="max-width:190px">${propOpts(r.propertyId)}</select></td><td><select data-mqcat="${r.i}" class="mini2" style="max-width:200px">${catOpt(r.taxCat)}</select></td></tr>`).join('')}</tbody></table></div>` +
          `<div class="muted sm" style="margin-top:8px">Nothing is assigned to a property or an ATO category automatically. Pick the property and category for each row that is a rental or fund expense, and leave the rest Unclassified for your accountant. Payments to the Tax Office from the fund are not assumed to be instalments.</div>`;
      }
      modal(`<h2>\uD83C\uDFE6 ${KIND_LABEL[rep.kind]}</h2><div class="muted sm">${esc(file.name)}${when}</div><div id="mqBody" style="margin-top:10px">${body}</div><div class="row end" style="margin-top:16px"><button class="btn" onclick="closeModal()">Later</button><button class="btn primary" id="mqGo">Import</button></div>`);
      $('mqGo').onclick = () => {
        const reconciled = rep.kind === 'taxtx' ? !(rep.mismatch.length || rep.orphan.length) : rep.check.ok === true;
        if (!reconciled && !confirm('This report does not reconcile to its own totals (see the warning at the top). Import anyway?')) return;
        const maps = {}; document.querySelectorAll('#mqBody select[data-mqacct]').forEach(s => { maps[s.dataset.mqacct] = s.value; });
        let res;
        try {
          if (rep.kind === 'balance') res = applyBalance(rep, maps);
          else if (rep.kind === 'interest') res = applyInterest(rep, maps);
          else {
            rowsT.forEach(r => { const on = document.querySelector(`[data-mqon="${r.i}"]`), p = document.querySelector(`[data-mqprop="${r.i}"]`), c = document.querySelector(`[data-mqcat="${r.i}"]`); r.on = !!(on && on.checked); r.propertyId = p ? p.value : ''; r.taxCat = c ? c.value : r.taxCat; });
            res = applyTx(rowsT);
          }
        } catch (e) { toast('Import failed: ' + e.message); return; }
        // remember the account choices (blank = not decided yet, so it is asked again next time)
        S.settings.macAccounts = S.settings.macAccounts || {}; Object.keys(maps).forEach(a => { if (maps[a]) S.settings.macAccounts[a] = maps[a]; });
        const unmapped = Object.keys(maps).filter(a => !maps[a]).length;
        S.macReports = S.macReports || {}; S.macReports[file.path] = { kind: rep.kind, at: iso(today()), asAt: rep.asAt || rep.to || '', summary: res.text, reconciled };
        log('Macquarie report imported', `${file.name}: ${res.text}${reconciled ? '' : ' (did not reconcile to report totals)'}`, { ref: '' });
        closeModal(); save(); toast('Imported' + (unmapped ? ` \u2013 ${unmapped} account(s) left unmatched` : ''));
      };
    })();
  }
  window.mqReview = k => { k = decodeURIComponent(k); const f = ((window._mq || {}).files || []).find(x => x.path === k); if (f) review(f); };
  window.mqReviewPath = (path, name) => review({ path, name: name || String(path).split('/').pop() });   // used by importroutes.js

  /* ---------- the card on Statements & imports ---------- */
  async function mqScan(force) {
    if (!force && window._mq && (window._mq.files || window._mq.loading)) return;
    window._mq = { loading: true, files: [] };
    try {
      const all = await walk(ROOT, 5);
      window._mq = { files: all.filter(f => /\.pdf$/i.test(f.name) && NAME_RE.test(f.name)).sort((a, b) => a.name.localeCompare(b.name)), at: new Date() };
    } catch (e) { window._mq = { files: [], error: e.message, at: new Date() }; }
    mqPaint();
  }
  window.mqRescan = () => { mqScan(true); };
  function mqPaint() {
    const host = document.getElementById('scanOut'); if (!host || !host.closest) return;
    const anchor = host.closest('.card'); if (!anchor) return;
    const old = document.getElementById('mqCard'); if (old) old.remove();
    const m = window._mq || {}, done = (S && S.macReports) || {};
    const rows = (m.files || []).map(f => { const d = done[f.path], kl = KIND_LABEL[(/proof/i.test(f.name) ? 'balance' : /interest/i.test(f.name) ? 'interest' : 'taxtx')];
      return `<tr><td>\uD83D\uDCC4 ${esc(f.name)}<div class="muted sm">${esc(kl)}${d ? ` \u00b7 imported ${fdate(d.at)}${d.asAt ? ' (data to ' + fdate(d.asAt) + ')' : ''}` : ''}</div></td><td class="nowrap" style="text-align:right">${d ? '<span class="pill p-paid">imported</span> ' : '<span class="pill p-verify">new</span> '}<button class="btn sm ${d ? '' : 'primary'}" onclick="mqReview('${encodeURIComponent(f.path)}')">${d ? 'Re-import' : 'Review &amp; import'}</button></td></tr>`; }).join('');
    anchor.insertAdjacentHTML('afterend', `<div class="card" id="mqCard" style="margin-top:16px"><div class="row sp"><h2 style="margin:0">\uD83C\uDFE6 Macquarie reports</h2><button class="btn sm" onclick="mqRescan()">\u21BB Look again</button></div><div class="muted sm" style="margin:6px 0 10px">Proof of balance, financial year interest and tax transaction reports saved under ${esc(ROOT)}. Bank statements are imported separately.</div>${m.loading ? '<div class="empty">Looking\u2026</div>' : m.error ? `<div class="note warn">Couldn't look in ${esc(ROOT)}: ${esc(m.error)}</div>` : rows ? `<table class="stack">${rows}</table>` : `<div class="empty">No report PDFs found under ${esc(ROOT)}. Save them there with names like proof-of-balance-report.pdf.</div>`}</div>`);
  }

  /* ---------- hook into app.js ---------- */
  const warn = (what, e) => { try { console.warn('macquariereports.js: could not hook ' + what, e); } catch (x) { } };
  try { const o = renderImport; renderImport = function () { o.apply(this, arguments); try { mqPaint(); mqScan(false); } catch (e) { warn('card', e); } }; } catch (e) { warn('renderImport', e); }
  g().PortalMacquarie = { version: VER, parseReport, parseBalance, parseInterest, parseTaxTx, acctRows, totalRow, suggest, applyBalance, read: mqRead, kindOf };
})();
