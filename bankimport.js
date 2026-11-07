/* =====================================================================
   CJP Portal add-on v5.3 – Bank statement import (+ PDF, + SharePoint folder pick-up)
   Loaded after app.js. Adds a "Bank statements" card to Statements.
   Formats: CSV (any bank – columns auto-detected, with or without header),
            XLSX, OFX/QFX, QIF.
   - Each file is imported into a saved bank account (everyday / offset /
     loan / SMSF), optionally linked to a property and loan.
   - Transactions are categorised by your saved rules + built-in merchants,
     reviewed before import, and never imported twice.
   - Offset / loan accounts also record month-end balances in Mortgage
     analytics; loan interest can be totalled into Tax › Loans by FY.
   ===================================================================== */
'use strict';
(function () {
  const ACC_TYPES = { everyday: 'Everyday / transaction', offset: 'Offset', loan: 'Home / investment loan', savings: 'Savings', smsf: 'SMSF bank account', credit: 'Credit card' };
  const BUILTIN = [
    [/woolworths|coles|aldi|\biga\b|foodland|drakes|costco|harris farm/i, 'Groceries'],
    [/ampol|\bbp\b|shell|caltex|7-eleven|united petrol|on the run|\botr\b|metro petroleum/i, 'Transport & Fuel'],
    [/mcdonald|kfc|hungry jack|uber \*?eats|menulog|doordash|cafe|restaurant|pizza|subway|grill'd|guzman/i, 'Dining & Entertainment'],
    [/netflix|spotify|disney|\bstan\b|youtube|apple\.com|microsoft|google (one|storage)|binge|kayo|real-debrid|openai/i, 'Subscriptions'],
    [/origin|\bagl\b|sa water|energyaustralia|telstra|optus|vodafone|superloop|aussie broadband|simply energy|lumo/i, 'Utilities'],
    [/aami|nrma|racv|\bracq\b|allianz|budget direct|infinite insurance|youi|insurance/i, 'Insurance'],
    [/chemist|pharmacy|priceline|medibank|\bbupa\b|\bhcf\b|ambulance|doctor|medical|dental|pathology|astron/i, 'Health'],
    [/\bvet\b|petstock|petbarn|vetpay/i, 'Pets'],
    [/council|onkaparinga|port phillip|city of melbourne/i, 'Council & Rates'],
    [/owners corp|strata|body corp/i, 'Strata'],
    [/\bato\b|australian taxation|\basic\b|revenuesa|state revenue/i, 'Tax & Accounting'],
    [/kmart|target|big w|bunnings|officeworks|jb hi-?fi|amazon|ebay|harvey norman|afterpay|zip pay|myer|david jones/i, 'Shopping'],
    [/kennards|storage king|self storage/i, 'Storage'],
    [/loan repayment|home loan|rapid repay|infinity group|mortgage/i, 'Mortgage & Loans']
  ];
  const r2 = v => Math.round(v * 100) / 100;
  const n0 = v => { if (v == null || v === '') return null; let s = String(v).trim(), neg = /^\(.*\)$/.test(s) || /\bDR\b|-$/.test(s); s = s.replace(/[()$,A\s]|DR|CR/gi, '').replace(/-$/, ''); const n = typeof v === 'number' ? v : +s; return isNaN(n) ? null : (neg && n > 0 ? -n : n) };
  const dt = v => { if (v == null || v === '') return null; if (typeof v === 'number') return v > 20000 && v < 80000 ? tbDate(v) : null; const s = String(v).trim(); return toISO(s) || (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null) };
  const merchant = d => String(d || '').toLowerCase().replace(/\d{4,}|card\s*\w*|value date.*|\b(visa|eftpos|pos|purchase|debit|credit|aud|au|ns?w|vic|sa|qld|wa|tas|act|nt)\b|[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
  const cfg = () => { S.settings.bankAccounts ||= []; S.settings.bankRules ||= []; return S.settings };

  /* ---------------- Parsers ---------------- */
  function parseCsv(t) { const out = []; let row = [], cur = '', q = false; t = t.replace(/^\uFEFF/, ''); for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = '' } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = '' } else cur += c } if (cur || row.length) { row.push(cur); out.push(row) } return out.filter(r => r.some(c => String(c).trim() !== '')) }
  function fromTable(rows) {
    const hi = rows.findIndex(r => r && r.some(v => /date/i.test(String(v ?? ''))) && r.some(v => /amount|debit|credit|withdraw|deposit/i.test(String(v ?? ''))));
    let out = [], acctCol = -1;
    if (hi >= 0) {
      const H = rows[hi].map(v => String(v ?? '').toLowerCase().trim()), col = (re, not) => H.findIndex(h => re.test(h) && !(not && not.test(h)));
      const c = { d: col(/transaction date|^date|posted|effective/), desc: col(/original description|narrative|description|details|transaction details|memo|payee/), amt: col(/^amount|amount \(|^value$/), dr: col(/debit|withdraw|money out|paid out/), cr: col(/credit|deposit|money in|paid in/), bal: col(/balance/, /available/), cat: col(/^category/), acct: col(/^account( name| number)?$/) };
      if (c.d < 0) c.d = col(/date/);
      if (c.desc < 0) { const lens = H.map((_, i) => rows.slice(hi + 1, hi + 20).reduce((a, r) => a + String(r?.[i] ?? '').length, 0)); c.desc = lens.indexOf(Math.max(...lens.map((l, i) => [c.d, c.amt, c.dr, c.cr, c.bal].includes(i) ? -1 : l))) }
      acctCol = c.acct;
      rows.slice(hi + 1).forEach((r, i) => {
        const d = dt(r[c.d]); if (!d) return;
        let a = c.amt >= 0 ? n0(r[c.amt]) : null;
        if (a == null && (c.dr >= 0 || c.cr >= 0)) { const dr = Math.abs(n0(r[c.dr]) || 0), cr = Math.abs(n0(r[c.cr]) || 0); if (!dr && !cr) return; a = cr - dr }
        if (a == null) return;
        out.push({ date: d, desc: String(r[c.desc] ?? '').replace(/\s+/g, ' ').trim(), amount: r2(a), balance: c.bal >= 0 ? n0(r[c.bal]) : null, bankCat: c.cat >= 0 ? String(r[c.cat] ?? '') : '', acct: acctCol >= 0 ? String(r[acctCol] ?? '').trim() : '', idx: i });
      });
    } else {
      // headerless (e.g. CommBank: date, amount, description, balance)
      const sample = rows.find(r => dt(r[0]) || dt(r[1])); if (!sample) throw new Error('No transactions found – unrecognised layout');
      const dc = dt(sample[0]) ? 0 : 1, nums = sample.map((v, i) => i !== dc && n0(v) != null && /\d/.test(String(v)) ? i : -1).filter(i => i >= 0);
      const texts = sample.map((v, i) => i !== dc && !nums.includes(i) ? String(v).length : -1), dc2 = texts.indexOf(Math.max(...texts));
      rows.forEach((r, i) => { const d = dt(r[dc]); if (!d) return; const a = n0(r[nums[0]]); if (a == null) return; out.push({ date: d, desc: String(r[dc2] ?? '').trim(), amount: r2(a), balance: nums.length > 1 ? n0(r[nums.at(-1)]) : null, idx: i }) });
    }
    return out;
  }
  function fromOfx(t) {
    const g = (b, tag) => { const m = b.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : '' };
    const out = [], bal = g(t, 'BALAMT'), balDate = g(t.slice(t.search(/<LEDGERBAL>/i)), 'DTASOF');
    (t.match(/<STMTTRN>[\s\S]*?(<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi) || []).forEach((b, i) => { const d = g(b, 'DTPOSTED').slice(0, 8); const a = n0(g(b, 'TRNAMT')); if (!/^\d{8}$/.test(d) || a == null) return; out.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, desc: [g(b, 'NAME'), g(b, 'MEMO')].filter(Boolean).join(' ').replace(/\s+/g, ' '), amount: r2(a), balance: null, fitid: g(b, 'FITID'), idx: i }) });
    out.ledger = n0(bal) != null && /^\d{8}/.test(balDate) ? { date: `${balDate.slice(0, 4)}-${balDate.slice(4, 6)}-${balDate.slice(6, 8)}`, balance: n0(bal) } : null;
    out.acct = g(t, 'ACCTID'); return out;
  }
  function fromQif(t) { const out = []; let cur = {}, i = 0; t.split(/\r?\n/).forEach(l => { const k = l[0], v = l.slice(1).trim(); if (k === 'D') cur.date = toISO(v.replace(/'/g, '/')) || dt(v); else if (k === 'T' || k === 'U') cur.amount = n0(v); else if (k === 'P') cur.desc = v; else if (k === 'M') cur.memo = v; else if (k === '^') { if (cur.date && cur.amount != null) out.push({ date: cur.date, desc: [cur.desc, cur.memo].filter(Boolean).join(' '), amount: r2(cur.amount), balance: null, idx: i++ }); cur = {} } }); return out }
  const MONI = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parsePdfText(T) {
    T = String(T).replace(/\s+/g, ' ');
    const rng = T.match(/From (\d{1,2} [A-Za-z]+ \d{4}) to (\d{1,2} [A-Za-z]+ \d{4})/i), from = rng ? toISO(rng[1]) : null, to = rng ? toISO(rng[2]) : null;
    const sb = (v, cd) => num(v) * (/DR/i.test(cd || '') ? -1 : 1);
    let ob = T.match(/Opening balance\s+\$?([\d,]+\.\d{2})\s*(CR|DR)?/i) || T.match(/Opening balance.{0,120}?\$([\d,]+\.\d{2})\s*(CR|DR)?/i);
    let prev = ob ? sb(ob[1], ob[2]) : null, year = from ? +from.slice(0, 4) : null, i = 0;
    const M = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
    const re = new RegExp(`\\b${M} (20\\d\\d)\\b|\\b${M} (\\d{1,2})(?!\\d)\\s+(.+?)\\s+\\$?([\\d,]+\\.\\d{2})\\s+\\$?([\\d,]+\\.\\d{2})\\s*(CR|DR)\\b`, 'g');
    const out = []; let m;
    while ((m = re.exec(T))) {
      if (m[1]) { year = +m[2]; continue }
      let y = year ?? (to ? +to.slice(0, 4) : today().getFullYear()), d = iso(new Date(y, MONI[m[3].toLowerCase()], +m[4]));
      if (from && d < from) d = iso(new Date(y + 1, MONI[m[3].toLowerCase()], +m[4])); else if (to && d > to) d = iso(new Date(y - 1, MONI[m[3].toLowerCase()], +m[4]));
      const amt = num(m[6]), bal = sb(m[7], m[8]); let a;
      if (prev != null) { const diff = r2(bal - prev); a = Math.abs(Math.abs(diff) - amt) < 0.015 ? diff : (diff < 0 ? -amt : amt) }
      else a = /interest paid|^from |deposit|credit|salary|rent/i.test(m[5]) ? amt : -amt;
      prev = bal;
      out.push({ date: d, desc: m[5].replace(/\s+-$/, '').replace(/\s+/g, ' ').trim(), amount: r2(a), balance: bal, idx: i++ });
    }
    if (!out.length) throw new Error('No transactions found in this PDF layout. Send Copilot a sample so it can be added, or download the CSV/OFX export instead.');
    out.acct = ((T.match(/Account (?:No\.?|Number)\s*([\d ]{6,20})/i) || [])[1] || (T.match(/Account (?:No\.?|Number).{0,60}?\b(\d{8,12})\b/i) || [])[1] || '').replace(/\s/g, '');
    out.bank = /macquarie/i.test(T) ? 'Macquarie' : /commonwealth|commbank/i.test(T) ? 'CommBank' : /westpac/i.test(T) ? 'Westpac' : /\banz\b/i.test(T) ? 'ANZ' : /\bnab\b|national australia/i.test(T) ? 'NAB' : '';
    out.accName = ((T.match(/Account Name\s+(?:\d[\d ]*\s+)*(.+?)\s+(?:Christopher|Cash Management|Transaction Listing|BSB|Statement|Opening)/i) || [])[1] || (/super fund/i.test(T) ? 'SUPER FUND' : '')).trim();
    out.product = (T.match(/(Cash Management(?: Accelerator)? Account|Offset Account|Home Loan|Investment Loan|Transaction Account|Savings Account)/i) || [])[1] || '';
    return out;
  }
  async function parseFile(f) {
    if (/\.(ofx|qfx)$/i.test(f.name)) return fromOfx(await f.text());
    if (/\.qif$/i.test(f.name)) return fromQif(await f.text());
    if (/\.xlsx$/i.test(f.name)) return fromTable(await readXlsxRows(await f.arrayBuffer()));
    if (/\.pdf$/i.test(f.name)) return parsePdfText(await pdfText(f));
    return fromTable(parseCsv(await f.text()));
  }

  /* ---------------- Categorise & de-duplicate ---------------- */
  function defProp(acc) { const p = prop(acc.propertyId); return p && (['smsf', 'loan'].includes(acc.type) || p.type !== 'PPOR') ? p.id : '' }
  const PROP_CATS = ['Council & Rates', 'Strata', 'Insurance', 'Repairs & Maintenance', 'Property Costs', 'Mortgage & Loans', 'Utilities'];
  function categorise(t, acc) {
    const d = t.desc || '', m = merchant(d);
    for (const r of cfg().bankRules) { try { if (new RegExp(r.pattern, 'i').test(d)) return { category: r.category, propertyId: r.propertyId ?? defProp(acc), rule: true, merchant: m } } catch (e) { } }
    let category = 'Other';
    if (/\binterest\b/i.test(d)) category = t.amount > 0 ? 'Interest income' : 'Mortgage & Loans';
    else if (/transfer|\btfr\b|to acc|from acc|internal|osko.*(self|own)|payid.*own|^(from|to)\s/i.test(d)) category = 'Transfers';
    else if (t.amount > 0 && /\brent\b|\barg\b|property management/i.test(d)) category = 'Rent';
    else if (t.amount > 0 && /salary|payroll|wages|pay\s/i.test(d)) category = 'Income';
    else { const b = BUILTIN.find(x => x[0].test(d)); if (b) category = b[1]; else if (t.bankCat && S.categories.includes(t.bankCat)) category = t.bankCat }
    const pid = ['Transfers', 'Interest income', 'Income'].includes(category) ? '' : defProp(acc) || (PROP_CATS.includes(category) && acc.propertyId ? acc.propertyId : '');
    return { category, propertyId: pid, merchant: m };
  }
  function dupInfo(t, acc) {
    const key = `bank|${acc.id}|${t.fitid || ''}|${t.date}|${t.amount.toFixed(2)}|${(t.desc || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 60)}`;
    if (S.transactions.some(x => x.bankKey === key) || (acc.seen || []).includes(key)) return { key, dup: 'Already imported' };
    if (t.amount < 0) { const near = S.transactions.find(x => !x.bankKey && x.amount === t.amount && Math.abs((pd(x.date) - pd(t.date)) / 864e5) <= 4); if (near) return { key, dup: `Matches "${near.desc}" (${near.agent || near.source || 'existing'}) ${fdate(near.date)}` } }
    return { key };
  }

  /* ---------------- Account picker ---------------- */
  function accOptions(sel) { return cfg().bankAccounts.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)} – ${ACC_TYPES[a.type]}${a.propertyId ? ' · ' + esc(pname(a.propertyId)) : ''}</option>`).join('') + '<option value="__new">+ New account…</option>' }
  function loanOpts(pid, sel) { const p = prop(pid); return '<option value="">— none —</option>' + (p?.loans || []).map(l => `<option value="${l.id}" ${l.id === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('') }
  function guessAccount(name, hint) { const s = (name + ' ' + (hint || '')).toLowerCase(); return cfg().bankAccounts.find(a => (a.match || []).some(m => m && s.includes(m.toLowerCase())) || s.includes(a.name.toLowerCase()))?.id || cfg().bankAccounts[0]?.id || '__new' }
  function newAccountForm() {
    return `<div class="card" id="baNew" style="margin-top:10px"><b>New bank account</b><div class="form2"><div><label>Name</label><input id="baName" placeholder="e.g. Macquarie Offset – Neale St"></div><div><label>Type</label><select id="baType">${Object.entries(ACC_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div><label>Property</label><select id="baProp" onchange="$('baLoan').innerHTML=BI.loanOpts(this.value)">${propOpts('')}</select></div><div><label>Loan (offset / loan accounts)</label><select id="baLoan"><option value="">— none —</option></select></div><div><label>Recognise by (account no. or file name text)</label><input id="baMatch" placeholder="e.g. 1234 or Offset"></div></div></div>`;
  }

  /* ---------------- Review ---------------- */
  let rows = [], file = null, parsed = null, acc = null;
  function draw() {
    const show = $('biFilter')?.value || 'new';
    const list = rows.map((r, i) => [r, i]).filter(([r]) => show === 'all' || (show === 'new' ? !r.dup : show === 'dup' ? r.dup : r.on));
    $('biRows').innerHTML = list.length ? list.map(([r, i]) => `<tr><td><input type="checkbox" ${r.on ? 'checked' : ''} onchange="BI.rows[${i}].on=this.checked;BI.count()"></td><td class="nowrap">${fdate(r.date)}</td><td>${esc(r.desc)}${r.dup ? `<div class="amber sm">⚠ ${esc(r.dup)}</div>` : ''}</td><td class="num ${r.amount > 0 ? 'green' : ''}"><b>${money(r.amount)}</b></td><td><select class="mini2" onchange="BI.setCat(${i},this.value)">${catOpts(r.category)}</select></td><td><select class="mini2" onchange="BI.rows[${i}].propertyId=this.value">${propOpts(r.propertyId)}</select></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Nothing to show</td></tr>';
    count();
  }
  function count() { const s = rows.filter(r => r.on); $('biCount').textContent = `${s.length} of ${rows.length} selected · out ${money(-s.filter(r => r.amount < 0).reduce((a, r) => a + r.amount, 0))} · in ${money(s.filter(r => r.amount > 0).reduce((a, r) => a + r.amount, 0))}` }
  function setCat(i, c) {
    const r = rows[i]; r.category = c; r.on = !['Transfers'].includes(c) && !r.dup;
    if ($('biLearn').checked && r.merchant && r.merchant.length > 2) { rows.forEach(x => { if (x !== r && x.merchant === r.merchant) { x.category = c; x.on = !['Transfers'].includes(c) && !x.dup } }); r._learn = true }
    draw();
  }
  function balancesByMonth(list) {
    const withBal = list.filter(t => t.balance != null); if (!withBal.length) return {};
    const desc = withBal.length > 1 && withBal[0].date > withBal.at(-1).date, out = {};
    withBal.forEach(t => { const m = t.date.slice(0, 7), cur = out[m]; if (!cur || t.date > cur.date || (t.date === cur.date && (desc ? t.idx < cur.idx : t.idx > cur.idx))) out[m] = t });
    return Object.fromEntries(Object.entries(out).map(([m, t]) => [m, t.balance]));
  }
  function summary() {
    const isLoan = acc.type === 'loan', isOff = acc.type === 'offset';
    const bal = balancesByMonth(parsed); if (parsed.ledger) bal[parsed.ledger.date.slice(0, 7)] ??= parsed.ledger.balance;
    const months = Object.keys(bal).sort(), first = parsed.map(t => t.date).sort()[0], last = parsed.map(t => t.date).sort().at(-1);
    const intByFY = {}; if (isLoan) parsed.filter(t => /\binterest\b/i.test(t.desc) && t.amount < 0).forEach(t => { const f = fyOf(t.date); intByFY[f] = r2((intByFY[f] || 0) - t.amount) });
    const fullFY = f => { const [a, b] = fyRange(f); return first <= addDays(a, 31) && last >= addDays(b, -10) };
    return { bal, months, first, last, isLoan, isOff, intByFY, fullFY };
  }
  const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d) };
  async function start(f) {
    file = f;
    try { parsed = await parseFile(f) } catch (e) { return toast(e.message) }
    if (!parsed.length) return toast('No transactions found in ' + f.name);
    const hint = parsed.acct || parsed.find(t => t.acct)?.acct || '';
    modal(`<h2>🏦 Import bank statement</h2><div class="muted sm">${esc(f.name)} · ${parsed.length} transactions · ${fdate(parsed.map(t => t.date).sort()[0])} – ${fdate(parsed.map(t => t.date).sort().at(-1))}${hint ? ' · account ' + esc(hint) : ''}</div>
      <label>Which account is this?</label><select id="biAcc" onchange="$('biNewWrap').innerHTML=this.value==='__new'?BI.newForm():''">${accOptions(guessAccount(f.name, hint))}</select><div id="biNewWrap"></div>
      <div class="row end" style="margin-top:14px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="BI.next()">Next</button></div>`);
    if ($('biAcc').value === '__new') {
      $('biNewWrap').innerHTML = newAccountForm(); if (hint) $('baMatch').value = hint.slice(-4);
      const an = parsed.accName || '', pr = parsed.product || '';
      if (pr || an) $('baName').value = [parsed.bank || '', pr.replace(/ Account$/i, ''), /super fund/i.test(an) ? '– SMSF' : ''].filter(Boolean).join(' ') + (hint ? ' ' + hint.slice(-4) : '');
      if (/super fund|smsf/i.test(an)) { $('baType').value = 'smsf'; const sp = S.properties.find(p => entityOf(p) === 'smsf'); if (sp) { $('baProp').value = sp.id; $('baLoan').innerHTML = loanOpts(sp.id) } }
      else if (/offset/i.test(pr)) $('baType').value = 'offset'; else if (/loan/i.test(pr)) $('baType').value = 'loan';
    }
  }
  function next() {
    let id = $('biAcc').value;
    if (id === '__new') {
      const name = $('baName').value.trim(); if (!name) return toast('Give the account a name');
      const a = { id: 'ba' + uid(), name, type: $('baType').value, propertyId: $('baProp').value, loanId: $('baLoan').value, match: [$('baMatch').value.trim()].filter(Boolean), seen: [] };
      cfg().bankAccounts.push(a); id = a.id; log('Bank account added', `${a.name} (${ACC_TYPES[a.type]})`, { ref: a.propertyId });
    }
    acc = cfg().bankAccounts.find(a => a.id === id);
    const isLoan = acc.type === 'loan';
    rows = parsed.map(t => { const c = categorise(t, acc), d = dupInfo(t, acc); return { ...t, ...c, key: d.key, dup: d.dup || '', on: !d.dup && !isLoan && c.category !== 'Transfers' } });
    const sm = summary();
    ['Transfers', 'Interest income', 'Income'].forEach(c => { if (!S.categories.includes(c)) S.categories.splice(S.categories.length - 1, 0, c) });
    modal(`<h2>🏦 ${esc(acc.name)}</h2><div class="muted sm">${esc(file.name)} · ${ACC_TYPES[acc.type]}${acc.propertyId ? ' · ' + esc(pname(acc.propertyId)) : ''}</div>
      ${isLoan ? `<div class="note info">Loan account: repayments and interest aren't added to Spending by default (they'd double-count). Its month-end balances and interest are used for Mortgage analytics and Tax instead. Tick rows below only if you want them as transactions.</div>` : ''}
      <div class="row" style="margin:10px 0;gap:10px"><select id="biFilter" style="width:auto" onchange="BI.draw()"><option value="new">New only</option><option value="sel">Selected</option><option value="dup">Possible duplicates</option><option value="all">All</option></select><button class="btn sm" onclick="BI.all(true)">Select all new</button><button class="btn sm" onclick="BI.all(false)">Select none</button><label class="chk" style="margin:0"><input type="checkbox" id="biLearn" checked> Remember categories I change</label><span class="muted sm" id="biCount"></span></div>
      <div style="max-height:46vh;overflow:auto"><table class="stack"><thead><tr><th></th><th>Date</th><th>Description</th><th class="num">Amount</th><th>Category</th><th>Property</th></tr></thead><tbody id="biRows"></tbody></table></div>
      ${(sm.isLoan || sm.isOff) && sm.months.length && acc.propertyId ? `<label class="chk" style="margin-top:12px"><input type="checkbox" id="biBal" checked> Record ${sm.months.length} month-end ${sm.isLoan ? 'loan' : 'offset'} balance(s) in Mortgage analytics for ${esc(pname(acc.propertyId))} (${fmonth(sm.months[0])} – ${fmonth(sm.months.at(-1))})</label>` : ''}
      ${sm.isLoan && Object.keys(sm.intByFY).length && acc.loanId ? Object.entries(sm.intByFY).map(([f, v]) => `<label class="chk"><input type="checkbox" class="biInt" data-fy="${f}" ${sm.fullFY(f) ? 'checked' : ''}> Set FY${f} interest for this loan in Tax › Loans to <b>${money(v)}</b>${sm.fullFY(f) ? '' : ' <span class="amber">(file doesn\'t cover the full year)</span>'}</label>`).join('') : ''}
      ${file.__path ? `<div class="muted sm" style="margin-top:8px">📁 ${esc(file.__path)} – will be marked as imported</div>` : `<label class="chk"><input type="checkbox" id="biSave" checked> Save the file to <code>Portal/Bank Statements/${esc(acc.name.replace(/[\\/:*?"<>|]/g, '-'))}/</code> in SharePoint</label>`}
      <div class="row end" style="margin-top:14px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="BI.commit()">Import</button></div>`);
    window._biSum = sm; draw();
  }
  async function commit() {
    const sel = rows.filter(r => r.on), sm = window._biSum;
    sel.forEach(r => S.transactions.push({ id: uid(), date: r.date, desc: r.desc, amount: r.amount, category: r.category, propertyId: r.propertyId || '', source: `Bank · ${acc.name}`, bankKey: r.key, bankAcc: acc.id }));
    acc.seen = [...new Set([...(acc.seen || []), ...rows.filter(r => !r.dup).map(r => r.key)])].slice(-20000);
    // learn rules
    const learned = new Map(); rows.filter(r => r._learn && r.merchant).forEach(r => learned.set(r.merchant, r));
    learned.forEach((r, m) => { const pattern = m.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.{0,6}'); cfg().bankRules = cfg().bankRules.filter(x => x.pattern !== pattern); cfg().bankRules.unshift({ pattern, category: r.category, propertyId: r.propertyId || null }) });
    let nb = 0; if ($('biBal')?.checked) { sm.months.forEach(m => { let v = sm.bal[m]; if (sm.isLoan) v = Math.abs(v); upsertMonth({ propertyId: acc.propertyId, month: m, ...(sm.isLoan ? { loan: v } : { offset: v }), source: `Bank · ${acc.name}` }); nb++ });
      const p = prop(acc.propertyId), l = p?.loans.find(x => x.id === acc.loanId) || p?.loans[0], lastM = sm.months.at(-1);
      if (l && !mortgageSeries(acc.propertyId).some(h => h.month > lastM)) { if (sm.isLoan) l.balance = Math.abs(sm.bal[lastM]); else l.offset = sm.bal[lastM] } }
    let ni = 0; document.querySelectorAll('.biInt').forEach(cb => { if (!cb.checked) return; const f = cb.dataset.fy; S.taxYears[f] ||= { props: {}, loans: {} }; (S.taxYears[f].loans[acc.loanId] ||= {}).interest = sm.intByFY[f]; ni++ });
    let savedNote = '', dk = file.__path || `Portal/Bank Statements/${acc.name.replace(/[\\/:*?"<>|]/g, '-')}/${file.name}`;
    if (file.__path || $('biSave')?.checked) S.documents[dk] = { status: 'imported', kind: 'bank', summary: `${acc.name}: ${sel.length} transaction(s)`, at: iso(today()), by: 'you' };
    if (!file.__path && $('biSave')?.checked) { try { await Store.writeBlob(dk, file); savedNote = ' · file saved' } catch (e) { if (e.auth) return needSignIn(e.message); savedNote = ' · file not saved (' + e.message + ')' } }
    acc.lastImport = new Date().toISOString(); acc.lastTxDate = sm.last;
    log('Bank statement imported', `${acc.name}: ${sel.length} transaction(s)${nb ? `, ${nb} month-end balance(s)` : ''}${ni ? `, interest for ${ni} FY` : ''}${learned.size ? `, ${learned.size} rule(s) learned` : ''} · ${rows.filter(r => r.dup).length} duplicate(s) skipped${savedNote}`, { ref: acc.propertyId || '' });
    closeModal(); save(); toast(`${sel.length} transaction(s) imported`); renderCard();
  }

  /* ---------------- Accounts & rules management ---------------- */
  function manage() {
    const A = cfg().bankAccounts, R = cfg().bankRules;
    modal(`<h2>Bank accounts &amp; rules</h2><h3>Accounts</h3>${A.length ? `<table class="stack">${A.map(a => `<tr><td><b>${esc(a.name)}</b><div class="muted sm">${ACC_TYPES[a.type]}${a.propertyId ? ' · ' + esc(pname(a.propertyId)) : ''}${a.lastTxDate ? ' · data to ' + fdate(a.lastTxDate) : ''}</div></td><td><select class="mini2" onchange="BI.accSet('${a.id}','propertyId',this.value)">${propOpts(a.propertyId)}</select></td><td><select class="mini2" onchange="BI.accSet('${a.id}','loanId',this.value)">${loanOpts(a.propertyId, a.loanId)}</select></td><td><button class="btn sm danger" onclick="BI.accDel('${a.id}')">✕</button></td></tr>`).join('')}</table>` : '<div class="empty">No accounts yet – they\'re created on first import.</div>'}
      <h3 style="margin-top:16px">Category rules <span class="muted sm">(first match wins)</span></h3>${R.length ? `<table class="stack">${R.map((r, i) => `<tr><td><code>${esc(r.pattern)}</code></td><td>${esc(r.category)}</td><td>${esc(pname(r.propertyId)) || ''}</td><td><button class="btn sm danger" onclick="BI.ruleDel(${i})">✕</button></td></tr>`).join('')}</table>` : '<div class="empty">No rules yet – change a category during import with "Remember" ticked.</div>'}
      <div class="form3" style="margin-top:10px"><div><label>Text contains</label><input id="brPat" placeholder="e.g. woolworths"></div><div><label>Category</label><select id="brCat">${catOpts('Groceries')}</select></div><div><label>Property</label><select id="brProp">${propOpts('')}</select></div></div><button class="btn sm" style="margin-top:8px" onclick="BI.ruleAdd()">+ Add rule</button>
      <div class="row end" style="margin-top:14px"><button class="btn primary" onclick="closeModal();save()">Done</button></div>`);
  }
  function renderCard() {
    const el = $('biAccList'); if (!el || !S) return;
    const A = cfg().bankAccounts; el.innerHTML = A.length ? A.map(a => `<span class="pill p-ok" style="margin:2px">${esc(a.name)}${a.lastTxDate ? ' · to ' + fdate(a.lastTxDate) : ''}</span>`).join('') : '';
  }

  window.BI = {
    get rows() { return rows }, draw, count, setCat, next, commit, manage, loanOpts, newForm: newAccountForm,
    all(v) { rows.forEach(r => { r.on = v && !r.dup }); draw() },
    files: fs => { const list = [...(fs || [])]; const go = () => { const f = list.shift(); if (f) start(f).then(() => { const iv = setInterval(() => { if (!$('modal').classList.contains('show')) { clearInterval(iv); go() } }, 400) }) }; go() },
    accSet(id, k, v) { const a = cfg().bankAccounts.find(x => x.id === id); a[k] = v; if (k === 'propertyId') a.loanId = ''; save(); manage() },
    accDel(id) { if (!confirm('Remove this account? Imported transactions are kept.')) return; S.settings.bankAccounts = cfg().bankAccounts.filter(a => a.id !== id); save(); manage(); renderCard() },
    ruleDel(i) { cfg().bankRules.splice(i, 1); save(); manage() },
    ruleAdd() { const p = $('brPat').value.trim(); if (!p) return; cfg().bankRules.unshift({ pattern: p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), category: $('brCat').value, propertyId: $('brProp').value || null }); save(); manage() },
    parse: parseFile, parseText: parsePdfText, categorise, scan: () => scanWatch(true), wImport, wIgnore, get pendingFiles() { return pending() }
  };

  /* ---------------- SharePoint folder pick-up ---------------- */
  const WATCH = [['Portal/Bank Statements', 'bank', /\.(pdf|csv|xlsx|ofx|qfx|qif)$/i, 'Bank statement'], ['Portal/Infinity Rapid Repay Reports', 'rr', /\.(pdf|csv|xlsx)$/i, 'Rapid Repay'], ['Portal/Timely Bills', 'tb', /\.xlsx$/i, 'TimelyBills']];
  let wf = [], wfAt = 0, wfBusy = false;
  async function scanWatch(force) {
    if (!S || !Store || wfBusy || (!force && Date.now() - wfAt < 60000)) return renderWatch();
    wfBusy = true; wfAt = Date.now(); const out = [];
    try { for (const [dir, kind, re, label] of WATCH) (await walk(dir)).forEach(x => { if (re.test(x.name) && !/\/processed\//i.test(x.path)) out.push({ ...x, kind, label }) }) }
    catch (e) { if (e.auth) { wfBusy = false; return needSignIn(e.message) } }
    wf = out.sort((a, b) => (a.modified || 0) - (b.modified || 0)); wfBusy = false; renderWatch();
  }
  const pending = () => wf.filter(x => !S.documents[x.path]);
  function renderWatch() {
    const el = $('wfList'); if (!el || !S) return; const P = pending();
    el.innerHTML = `<div class="row sp" style="margin-top:12px"><b>📁 Waiting in SharePoint (${P.length})</b><button class="btn sm" onclick="BI.scan()">↻ Check folders</button></div>` + (P.length ? `<table class="stack">${P.map(x => `<tr><td>📄 ${esc(x.path.replace(/^Portal\//, ''))}<div class="muted sm">${x.label}${x.modified ? ' · ' + new Date(x.modified).toLocaleDateString('en-AU') : ''}</div></td><td class="nowrap" style="text-align:right"><button class="btn sm primary" onclick="BI.wImport('${encodeURIComponent(x.path)}')">Import</button> <button class="btn sm" onclick="BI.wIgnore('${encodeURIComponent(x.path)}')">Ignore</button></td></tr>`).join('')}</table>` : `<div class="muted sm">Nothing new in <code>Portal/Bank Statements</code>, <code>Portal/Infinity Rapid Repay Reports</code> or <code>Portal/Timely Bills</code>.</div>`);
  }
  async function wImport(p) {
    p = decodeURIComponent(p); const x = wf.find(w => w.path === p); if (!x) return;
    let f; try { f = new File([await Store.getBlob(p)], x.name, { type: /\.pdf$/i.test(x.name) ? 'application/pdf' : '' }) } catch (e) { return e.auth ? needSignIn(e.message) : toast('Could not open file: ' + e.message) }
    f.__path = p;
    if (x.kind === 'bank') return start(f);
    if (x.kind === 'rr') return /\.pdf$/i.test(x.name) ? RR.pdf([f]) : RR.table([f]);
    if (x.kind === 'tb') importTimelyFile(f).then(() => { S.documents[p] = { status: 'imported', kind: 'timelybills', summary: 'TimelyBills Bill Report', at: iso(today()), by: 'you' }; save() }).catch(e => toast(e.message));
  }
  function wIgnore(p) { p = decodeURIComponent(p); S.documents[p] = { status: 'ignored', at: iso(today()), by: 'you' }; log('Document ignored', p.split('/').at(-1)); save() }

  /* ---------------- UI ---------------- */
  function inject() {
    const host = $('scanOut')?.closest('.card');
    if (host && !$('biCard')) host.insertAdjacentHTML('beforebegin', `<div class="card" id="biCard" style="margin-bottom:16px"><div class="row sp"><h2 style="margin:0">🏦 Bank statements</h2><div class="row"><label class="btn primary" style="margin:0;text-transform:none;letter-spacing:0;font-size:14px;color:#fff">Import statement<input type="file" id="biFile" accept=".csv,.xlsx,.ofx,.qfx,.qif,text/csv" multiple hidden onchange="BI.files(this.files);this.value=''"></label><button class="btn" onclick="BI.manage()">Accounts &amp; rules</button></div></div><div class="muted sm" style="margin-top:8px">Choose a statement (Macquarie <b>PDF</b> transaction listing, or CSV / OFX / QIF from any bank), or save it in <code>Portal/Bank Statements</code> and import it from the list below. You review every transaction before import, duplicates and bills already imported from TimelyBills are flagged, and nothing is imported twice. Offset and loan accounts also update Mortgage analytics; loan interest can be totalled into Tax › Loans.</div><div id="biAccList" style="margin-top:8px"></div><div id="wfList"></div></div>`);
    renderCard();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject); else inject();
  const _ra = window.renderAll; if (typeof _ra === 'function') renderAll = function () { _ra(); renderCard(); renderWatch(); if (typeof view !== 'undefined' && (view === 'import' || !wfAt)) scanWatch(false) };
})();
