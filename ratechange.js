/* Property Portal - Rate change letters (add-on, works with app.js v6.5.x)
   WHAT IT DOES
   - Recognises a lender's "Notice of Interest Rate Change" PDF during Statements & imports > Scan folders > Read & review.
   - Fills in the new rate, new repayment, effective dates, loan balance and account number from the letter,
     and picks the matching loan on the property (by account number, lender name or balance).
   - One click on Import updates that loan's Rate % and Repay/mth, and keeps a dated rate history on the loan.
   - If a change takes effect in the future it is saved as scheduled and switches over by itself on that day.
   - Adds "Re-review a filed document" on the Statements page, so a letter that was already filed as info/imported can be read again.
   - Shows the rate history under Loans on the property page.
   Nothing in app.js is edited. This file only wraps classify, reviewForm, readForm, validate, applyImport, openReview, migrate,
   renderPropPage and renderImport, and adds a "Rate change" type to the review form. Letters from other lenders are matched by wording,
   so if one is not recognised, choose Type = Rate change on the review form and the fields are read from the PDF text. */
(() => {
  'use strict';
  const VER = '1.0';
  const KIND = 'ratechange';

  /* ---------- reading the letter ---------- */
  const DT = '(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4}|\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Za-z]{3,9}\\.?,?\\s+\\d{4})';
  const PCT = '(\\d{1,2}(?:\\.\\d{1,4})?)\\s?%';
  const NUM = s => s == null ? null : +String(s).replace(/,/g, '');
  const first = (t, list) => { for (const re of list) { const m = t.match(re); if (m) return m; } return null; };
  const dateOf = s => { if (!s) return null; try { return toISO(String(s)) || null; } catch (e) { return null; } };

  function rcExtract(text) {
    const T = String(text || '').slice(0, 20000).replace(/\s+/g, ' ');
    const F = {}; let m;
    m = first(T, [
      new RegExp('new\\s+(?:variable\\s+|fixed\\s+|home\\s+loan\\s+)?(?:interest\\s+)?rate[^\\d]{0,40}' + PCT, 'i'),
      new RegExp('from\\s+\\d{1,2}(?:\\.\\d{1,4})?\\s?%\\s*(?:p\\.?\\s?a\\.?)?\\s*to\\s+' + PCT, 'i'),
      new RegExp('(?:interest\\s+)?rate\\s+(?:will\\s+(?:be|change\\s+to)|is|to\\s+be|of|to)\\s+' + PCT, 'i')]);
    F.rate = m ? NUM(m[1]) : null;
    m = first(T, [
      new RegExp('from\\s+' + PCT + '\\s*(?:p\\.?\\s?a\\.?)?\\s*to\\s+\\d', 'i'),
      new RegExp('(?:current|previous|old|existing)\\s+(?:variable\\s+)?(?:interest\\s+)?rate(?:\\s+(?:is|was|of))?[^\\d]{0,30}' + PCT, 'i')]);
    F.oldRate = m ? NUM(m[1]) : null;
    m = first(T, [
      new RegExp('new\\s+(?:(?:minimum|monthly|total)\\s+)*(?:(?:principal\\s*(?:&|and)\\s*interest|P\\s*&\\s*I|interest[\\s-]*only)\\s+)?(?:loan\\s+)?repayments?[^$\\d]{0,40}\\$?\\s?([\\d,]+\\.\\d{2})', 'i'),
      new RegExp('(?:minimum|monthly)\\s+repayments?\\s+(?:of|will\\s+be|is|to)\\s*\\$?\\s?([\\d,]+\\.\\d{2})', 'i')]);
    F.repay = m ? NUM(m[1]) : null;
    m = T.match(new RegExp('effective\\s+(?:from\\s+|on\\s+|date[:\\s]+)?' + DT, 'i'));
    F.date = m ? dateOf(m[1]) : null;
    if (!F.date) { m = T.match(new RegExp(DT)); F.date = m ? dateOf(m[1]) : null; }
    m = first(T, [
      new RegExp('repayments?\\b[^.]{0,80}?(?:take\\s+effect|commence|start)s?\\s+(?:from|on)[^\\d]{0,80}?' + DT, 'i'),
      new RegExp('due\\s+(?:from|on)\\s+' + DT, 'i')]);
    F.repayDate = m ? dateOf(m[1]) : F.date;
    m = T.match(/(?:loan|outstanding|current|closing)\s+balance[^$\d]{0,20}\$?\s?([\d,]+\.\d{2})/i);
    F.loan = m ? NUM(m[1]) : null;
    m = T.match(/account\s*(?:number|no\.?|#)?\s*[:\-]?\s*(\d[\d\s-]{4,18}\d)/i);
    F.account = m ? m[1].replace(/\D/g, '') : '';
    m = T.match(/yours\s+(?:sincerely|faithfully)\W*([A-Z][^.]{2,60}?(?:Pty\.?\s*Ltd\.?|Limited|Ltd\.?|Bank|Credit Union|Group))/i);
    F.lender = m ? m[1].trim() : '';
    return F;
  }
  function rcDetect(text, name) {
    const T = String(text || '').slice(0, 20000);
    if (/(opening balance|closing balance|transaction details|statement period|statement of account)/i.test(T)) return null;   // a statement, not a letter
    if (/(calculator|could be mortgage-free|estimates only|plan comparison)/i.test(T)) return null;
    const looksLike = /interest\s+rate\s+(?:change|adjustment|variation|increase|decrease|reduction)|rate\s+(?:change|adjustment|variation)\s+(?:confirmation|notice|advice)|change\s+(?:to|in)\s+(?:your\s+)?(?:interest\s+)?rate|your\s+(?:variable\s+)?(?:interest\s+)?rate\s+(?:will|has|is\s+going\s+to)\s+(?:change|increase|decrease|be\s+(?:increased|reduced|decreased))|rate\s+(?:increase|decrease|reduction)/i;
    if (!looksLike.test(T + ' ' + String(name || ''))) return null;
    const F = rcExtract(T);
    if (F.rate == null) return null;
    return { kind: KIND, fields: F, note: 'Interest rate change notice \u2013 the loan is updated when you press Import' };
  }

  /* ---------- which loan ---------- */
  function rcPickLoan(p, F) {
    if (!p || !p.loans || !p.loans.length) return null;
    const acct = String(F.account || '').replace(/\D/g, '');
    if (acct) { const a = p.loans.find(l => String(l.acct || '') === acct); if (a) return a; }
    if (p.loans.length === 1) { const l = p.loans[0]; return (l.acct && acct && String(l.acct) !== acct) ? null : l; }
    const skip = ['pty', 'ltd', 'limited', 'group', 'bank', 'union', 'credit'];
    const words = String(F.lender || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !skip.includes(w));
    let best = null, bs = 0, tie = false;
    p.loans.forEach(l => {
      let s = 0; const nm = String(l.name || '').toLowerCase();
      if (words.some(w => nm.includes(w))) s += 3;
      if (F.loan && l.balance) { const d = Math.abs(F.loan - l.balance) / l.balance; if (d < .03) s += 3; else if (d < .1) s += 1; }
      if (s > bs) { best = l; bs = s; tie = false; } else if (s === bs && s > 0) tie = true;
    });
    return (tie || bs === 0) ? null : best;
  }

  /* ---------- applying it ---------- */
  const byDateDesc = f => (a, b) => String(b[f]).localeCompare(String(a[f]));
  // Sets the loan's current rate / repayment from its dated changes. Safe to run any number of times.
  function rcDue(l) {
    const t = iso(today()), evs = l.rateChanges || []; let ch = false;
    const lr = evs.filter(e => e.rate != null && e.rateDate && e.rateDate <= t).sort(byDateDesc('rateDate'))[0];
    if (lr && !lr.rateDone) { l.rate = lr.rate; ch = true; }
    evs.forEach(e => { if (e.rate != null && e.rateDate && e.rateDate <= t && !e.rateDone) { e.rateDone = true; ch = true; } });
    const lp = evs.filter(e => e.repay != null && e.repayDate && e.repayDate <= t).sort(byDateDesc('repayDate'))[0];
    if (lp && !lp.repayDone) { l.repay = lp.repay; ch = true; }
    evs.forEach(e => { if (e.repay != null && e.repayDate && e.repayDate <= t && !e.repayDone) { e.repayDone = true; ch = true; } });
    return ch;
  }
  function rcApply(pid, F, meta) {
    const fail = msg => { try { toast(msg); } catch (e) { } throw new Error(msg); };
    const p = prop(pid); if (!p) fail('Choose the property this letter is for.');
    if (F.rate == null || isNaN(F.rate)) fail('The new interest rate is missing.');
    let l = null;
    if (F.rcLoan === '__new') l = null;
    else if (F.rcLoan) l = p.loans.find(x => x.id === F.rcLoan) || null;
    else l = rcPickLoan(p, F);
    if (!l && F.rcLoan !== '__new' && p.loans.length > 1) fail('Choose which loan this applies to.');
    if (!l) { l = { id: uid(), name: 'Loan' + (F.account ? ' ' + F.account : ''), balance: F.loan ?? null, offset: null, rate: null, repay: null }; p.loans.push(l); }
    if (F.account) l.acct = String(F.account).replace(/\D/g, '');
    const now = iso(today()), useRepay = F.repay != null && F.rcUpdRepay !== false;
    const ev = { id: uid(), rateDate: F.date || now, rate: F.rate, repayDate: useRepay ? (F.rcRepayDate || F.date || now) : null, repay: useRepay ? F.repay : null,
      oldRate: l.rate ?? F.rcOld ?? null, oldRepay: l.repay ?? null, source: meta.source || 'Import', doc: meta.docKey || '', at: now, by: meta.agent || 'you' };
    l.rateChanges ||= [];
    const dup = l.rateChanges.findIndex(x => (ev.doc && x.doc === ev.doc) || (x.rateDate === ev.rateDate && x.rate === ev.rate && x.repay === ev.repay));
    if (dup >= 0) { const o = l.rateChanges[dup]; ev.oldRate = o.oldRate ?? ev.oldRate; ev.oldRepay = o.oldRepay ?? ev.oldRepay; l.rateChanges.splice(dup, 1); }   // same letter again: replace, never duplicate
    l.rateChanges.push(ev); l.rateChanges.sort((a, b) => String(a.rateDate).localeCompare(String(b.rateDate)));
    if (F.loan != null && F.rcUpdBal !== false) l.balance = F.loan;
    rcDue(l);
    const parts = [`${l.name}: rate ${ev.oldRate != null ? ev.oldRate + '% \u2192 ' : ''}${ev.rate}% from ${fdate(ev.rateDate)}${ev.rateDate > now ? ' (scheduled)' : ''}`];
    if (ev.repay != null) parts.push(`repayment ${money(ev.repay)} from ${fdate(ev.repayDate)}${ev.repayDate > now ? ' (scheduled)' : ''}`);
    if (F.loan != null && F.rcUpdBal !== false) parts.push(`balance ${m0(F.loan)}`);
    return parts.join(' \u00b7 ');
  }

  /* ---------- review form ---------- */
  function rcLoanOptions(pid, F, selected) {
    const p = prop(pid), loans = p ? p.loans : [];
    const pick = selected !== undefined ? selected : (rcPickLoan(p, F) || {}).id || '';
    let o = '';
    if (loans.length > 1 && !pick) o += '<option value="" selected>\u2014 choose the loan \u2014</option>';
    loans.forEach(l => { o += `<option value="${esc(l.id)}" ${l.id === pick ? 'selected' : ''}>${esc(l.name || 'Loan')} \u00b7 ${l.rate != null ? esc(l.rate) + '%' : 'no rate'} \u00b7 ${m0(l.balance)}</option>`; });
    o += `<option value="__new" ${(!loans.length || pick === '__new') ? 'selected' : ''}>\u2795 Add as a new loan</option>`;
    return o;
  }
  function rcForm(F) {
    window._rcF = F;
    const I = (id, lab, v, t = 'number', st = 'step="0.01"') => `<div><label>${lab}</label><input id="${id}" type="${t}" ${t === 'number' ? st : ''} value="${esc(v ?? '')}"></div>`;
    return `<div class="form2">${I('fDate', 'Rate effective from', F.date, 'date')}${I('fRate', 'New interest rate %', F.rate, 'number', 'step="0.001"')}${I('fRepay', 'New minimum repayment ($)', F.repay)}${I('fRcRepayDate', 'Repayment effective from', F.repayDate || F.date, 'date')}${I('fLoan', 'Loan balance on the letter ($)', F.loan)}${I('fRcOld', 'Previous rate % (optional)', F.oldRate, 'number', 'step="0.001"')}${I('fRcAcct', 'Loan account number', F.account, 'text')}<div><label>Apply to loan</label><select id="fRcLoan">${rcLoanOptions(window._rcPid, F)}</select></div></div>` +
      `<label class="chk"><input type="checkbox" id="fRcUpdRepay" checked> Update the loan's repayment</label><label class="chk"><input type="checkbox" id="fRcUpdBal" checked> Update the loan's balance to the figure on the letter</label><div class="note info" id="rcPreview" style="margin-top:8px"></div>` +
      `<div class="muted sm" style="margin-top:6px">A change dated in the future is saved as scheduled and switches over by itself on that day. To use a new repayment straight away, set its date to today.</div>`;
  }
  function rcPreview() {
    const box = $('rcPreview'); if (!box || !$('rKind') || $('rKind').value !== KIND) return;
    const v = id => $(id) ? $(id).value : '', n = id => (v(id) === '' ? null : +v(id));
    const p = prop($('rProp') ? $('rProp').value : ''), sel = v('fRcLoan'), l = p ? p.loans.find(x => x.id === sel) : null;
    const now = iso(today()), rate = n('fRate'), repay = n('fRepay'), d = v('fDate') || now, rd = v('fRcRepayDate') || d, bal = n('fLoan'), L = [];
    if (!p) L.push('Choose the property above.');
    else if (!l) L.push(sel === '__new' ? `A new loan will be added to ${esc(p.name)}.` : 'Choose which loan this applies to.');
    if (rate != null) L.push(`<b>Rate</b> ${l && l.rate != null ? l.rate + '%' : '\u2014'} \u2192 <b>${rate}%</b> from ${fdate(d)}${d > now ? ' <span class="amber">(applies automatically on that day)</span>' : ''}`);
    if (repay != null && $('fRcUpdRepay') && $('fRcUpdRepay').checked) L.push(`<b>Repayment</b> ${l && l.repay ? money(l.repay) : '\u2014'} \u2192 <b>${money(repay)}</b> from ${fdate(rd)}${rd > now ? ' <span class="amber">(applies automatically on that day)</span>' : ''}`);
    if (bal != null && $('fRcUpdBal') && $('fRcUpdBal').checked) L.push(`<b>Balance</b> ${l ? m0(l.balance) : '\u2014'} \u2192 <b>${m0(bal)}</b>`);
    box.innerHTML = L.join('<br>');
  }
  function rcWire(o) {
    const k = $('rKind'); if (!k) return;
    const opt = [...k.options].find(x => x.textContent === KIND); if (opt) { opt.value = KIND; opt.textContent = 'Rate change'; }
    const text = o.text || '', fields = o.fields || {};
    // Switching Type to "Rate change" re-reads the PDF text (the standard form does not).
    k.onchange = e => { const kind = e.target.value; const f = kind === KIND ? { ...rcExtract(text), ...(fields.rate != null && o.kind === KIND ? fields : {}) } : fields; $('rForm').innerHTML = reviewForm(kind, f); rcPreview(); };
    const form = $('rForm'); if (form) { form.addEventListener('input', rcPreview); form.addEventListener('change', rcPreview); }
    const pr = $('rProp');
    if (pr) pr.addEventListener('change', () => { if (k.value !== KIND || !$('fRcLoan')) return; const F = { ...(window._rcF || {}), account: $('fRcAcct') ? $('fRcAcct').value : '', loan: $('fLoan') && $('fLoan').value !== '' ? +$('fLoan').value : null }; $('fRcLoan').innerHTML = rcLoanOptions(pr.value, F); rcPreview(); });
    if (k.value === KIND) rcPreview();
  }

  /* ---------- history on the property page, re-review card on Statements ---------- */
  function rcHistoryUI() {
    const p = typeof prop === 'function' ? prop(curProp) : null; if (!p || !document.getElementById('propPage')) return;
    const h = [...document.querySelectorAll('#propPage h2')].find(x => x.textContent.trim() === 'Loans'); if (!h || !h.parentElement) return;
    const rows = []; p.loans.forEach(l => (l.rateChanges || []).forEach(e => rows.push({ l, e })));
    if (!rows.length) return;
    rows.sort((a, b) => String(b.e.rateDate).localeCompare(String(a.e.rateDate)));
    const now = iso(today());
    h.parentElement.insertAdjacentHTML('beforeend', '<h3 style="margin-top:14px">Rate changes</h3>' + rows.slice(0, 8).map(({ l, e }) => `<div class="muted sm">${fdate(e.rateDate)}: ${e.oldRate != null ? esc(e.oldRate) + '% \u2192 ' : ''}<b>${esc(e.rate)}%</b>${e.repay != null ? ` \u00b7 repay ${money(e.repay)} from ${fdate(e.repayDate)}` : ''}${(e.rateDate > now || (e.repay != null && e.repayDate > now)) ? ' <span class="amber">(scheduled)</span>' : ''} \u00b7 ${esc(l.name)}</div>`).join(''));
  }
  function rcRefileUI() {
    const host = $('scanOut'); if (!host) return; const card = host.closest ? host.closest('.card') : null; if (!card) return;
    const old = $('rcRefile'); if (old) old.remove();
    const sc = window._scan; if (!sc || !S) return;
    const list = (sc.files || []).filter(f => /\.pdf$/i.test(f.name) && S.documents[f.path] && (S.documents[f.path].status === 'info' || (['imported', 'ignored'].includes(S.documents[f.path].status) && /rate|interest|notice|variation|confirmation|loan|mortgage/i.test(f.name))))
      .sort((a, b) => (b.modified || 0) - (a.modified || 0)).slice(0, 25);
    if (!list.length) return;
    card.insertAdjacentHTML('afterend', `<div class="card" id="rcRefile" style="margin-top:16px"><h2>\uD83D\uDD01 Re-review a filed document</h2><div class="muted sm" style="margin-bottom:8px">For a rate-change letter (or anything else) that was filed as "info" or imported without the right details. The PDF is read again and nothing changes until you press Import.</div><table class="stack">${list.map(f => `<tr><td>\uD83D\uDCC4 ${esc(f.rel)}<div class="muted sm">${esc(pname(f.propertyId) || f.folder)} \u00b7 filed as ${esc(S.documents[f.path].status)}</div></td><td class="nowrap" style="text-align:right"><button class="btn sm primary" onclick="rcRereview('${encodeURIComponent(f.path)}')">Re-review</button></td></tr>`).join('')}</table></div>`);
  }
  window.rcRereview = k => { k = decodeURIComponent(k); const sc = window._scan; if (!sc || !sc.files.some(x => x.path === k)) { toast('Scan the folders first'); return; } reviewDoc(encodeURIComponent(k)); };

  /* ---------- hook into app.js ---------- */
  const warn = (what, e) => { try { console.warn('ratechange.js: could not hook ' + what, e); } catch (x) { } };
  try { if (!KINDS.includes(KIND)) { const i = KINDS.indexOf('info'); KINDS.splice(i < 0 ? KINDS.length : i, 0, KIND); } } catch (e) { warn('KINDS', e); }
  try { const o = classify; classify = function (t, name) { let r = null; try { r = rcDetect(t, name); } catch (e) { warn('detect', e); } return r || o.apply(this, arguments); }; } catch (e) { warn('classify', e); }
  try { const o = reviewForm; reviewForm = function (kind, F) { return kind === KIND ? rcForm(F || {}) : o.apply(this, arguments); }; } catch (e) { warn('reviewForm', e); }
  try { const o = readForm; readForm = function () {
      const F = o.apply(this, arguments);
      if ($('rKind') && $('rKind').value === KIND) { const v = id => $(id) ? $(id).value : '', n = id => (v(id) === '' ? null : +v(id));
        Object.assign(F, { rcLoan: v('fRcLoan'), rcRepayDate: v('fRcRepayDate') || null, rcOld: n('fRcOld'), account: v('fRcAcct').replace(/\D/g, ''), lender: (window._rcF || {}).lender || '', rcUpdRepay: !!($('fRcUpdRepay') && $('fRcUpdRepay').checked), rcUpdBal: !!($('fRcUpdBal') && $('fRcUpdBal').checked) }); }
      return F; }; } catch (e) { warn('readForm', e); }
  try { const o = validate; validate = function (kind, F, pid) {
      if (kind !== KIND) return o.apply(this, arguments);
      const w = [], p = pid ? prop(pid) : null;
      if (!pid) w.push('No property matched');
      if (F.rate == null) w.push('New interest rate not found'); else if (F.rate < 0.5 || F.rate > 25) w.push(`Rate looks wrong (${F.rate}%)`);
      if (!F.date) w.push('Effective date not found \u2013 it will apply from today');
      if (F.repay == null) w.push('New repayment not found \u2013 only the rate will be updated');
      if (p && !p.loans.length) w.push('This property has no loan yet \u2013 a new loan will be added');
      else if (p && p.loans.length > 1 && !rcPickLoan(p, F)) w.push('Choose which loan this applies to');
      return w; }; } catch (e) { warn('validate', e); }
  try { const o = applyImport; applyImport = function (kind, pid, F, meta = {}) {
      if (kind !== KIND) return o.apply(this, arguments);
      const summary = rcApply(pid, F, meta);
      if (meta.docKey) S.documents[meta.docKey] = { status: 'imported', kind: KIND, propertyId: pid, summary, at: iso(today()), by: meta.agent || 'you' };
      return summary; }; } catch (e) { warn('applyImport', e); }
  try { const o = openReview; openReview = function (opts) { window._rcPid = opts && opts.propertyId; o.apply(this, arguments); try { rcWire(opts || {}); } catch (e) { warn('review form', e); } }; } catch (e) { warn('openReview', e); }
  try { const o = migrate; migrate = function () { o.apply(this, arguments); try { S.properties.forEach(p => (p.loans || []).forEach(rcDue)); } catch (e) { warn('scheduled changes', e); } }; } catch (e) { warn('migrate', e); }
  try { const o = renderPropPage; renderPropPage = function () { o.apply(this, arguments); try { rcHistoryUI(); } catch (e) { warn('history', e); } }; } catch (e) { warn('renderPropPage', e); }
  try { const o = renderImport; renderImport = function () { o.apply(this, arguments); try { rcRefileUI(); } catch (e) { warn('re-review card', e); } }; } catch (e) { warn('renderImport', e); }
  window.PortalRateChange = { version: VER, extract: rcExtract, detect: rcDetect, pickLoan: rcPickLoan, due: rcDue };
})();
