/* CJP Portal - dashboardloans.js v1.1 (add-on, works with app.js v6.5.x)
   A "Loans & interest" card on the Dashboard so the current position is always on screen. One row per loan on every property you still hold.
   Where each figure comes from (nothing is estimated):
     - balance / offset ........ the loan record (updated by the Macquarie proof of balance and statements)
     - interest charged ........ Tax & accountant > Loans, set by the Macquarie Financial Year Interest Report
     - rate / repayment ........ the lender's rate-change LETTERS (dated, newest in force), otherwise as saved on the loan
   v1.1:
     - The rate and repayment shown are the ones in force TODAY from the lender letters (so a stale saved rate can't show). A mismatch with the saved loan is flagged.
     - A repayment lower than a month's interest on the loan cannot be right (e.g. an annual fee typed in as the repayment). It is flagged and left out of the total.
     - Next scheduled repayment from a letter is shown ("$2,950.31 from 30 Nov").
     - "Fix loans from lender letters" button: adds the 1 Oct 2026 Arthurmac notice that was missing from the history, corrects the 7 Nov notice's previous rate,
       and sets each loan's saved rate / repayment to what the letters say is in force. It asks you to confirm and lists every change first.
     - Notes say which loans are not linked to a Macquarie account and which are not Macquarie loans (so their interest must come from the lender).
   Display only, except the confirmed fix button. Safe to remove. */
(() => {
  'use strict';
  const warn = (what, e) => { try { console.warn('dashboardloans.js: ' + what, e); } catch (x) { } };
  const pc = n => (n == null || isNaN(n) ? '\u2014' : (Math.round(n * 1000) / 1000) + '%');
  const prevFY = fy => { const y = +fy.slice(0, 4) - 1; return `${y}-${String(y + 1).slice(2)}`; };
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const stripZ = v => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
  const desc = f => (a, b) => String(b[f]).localeCompare(String(a[f]));
  const asc = f => (a, b) => String(a[f]).localeCompare(String(b[f]));
  const eq = (a, b, t) => a != null && b != null && Math.abs(a - b) <= (t || 0.0001);

  /* The Arthurmac notice dated 1 October 2026 (received by email 2 Oct 2026) is not in the portal's history. Taken from the notice itself. */
  const KNOWN = [{ acct: '500046385', rateDate: '2026-10-02', rate: 7.59, repayDate: '2026-10-23', repay: 2880.33, oldRate: 7.34, oldRepay: 2808.23,
    balance: 407735.23, balanceDate: '2026-10-01', source: 'Arthurmac notice dated 1 Oct 2026 (added from email)' }];
  /* Loan balances printed on the notices themselves (the 7 Nov 2026 notice shows $407,411.95). Recorded on the matching rate change. */
  const KNOWN_BAL = [{ acct: '500046385', rateDate: '2026-11-07', balance: 407411.95, balanceDate: '2026-11-07' }];
  const balFor = () => KNOWN.map(k => ({ acct: k.acct, rateDate: k.rateDate, rate: k.rate, balance: k.balance, balanceDate: k.balanceDate })).concat(KNOWN_BAL);
  const near = (e, k) => e.rateDate && Math.abs(dayDiff(e.rateDate, k.rateDate)) <= 3 && (k.rate == null || eq(e.rate, k.rate));

  /* ---------- letters in force ---------- */
  function inForce(l, now) {
    const evs = l.rateChanges || [];
    return {
      rate: evs.filter(e => e.rate != null && e.rateDate && e.rateDate <= now).sort(desc('rateDate'))[0] || null,
      repay: evs.filter(e => e.repay != null && e.repayDate && e.repayDate <= now).sort(desc('repayDate'))[0] || null,
      nextRepay: evs.filter(e => e.repay != null && e.repayDate && e.repayDate > now).sort(asc('repayDate'))[0] || null
    };
  }
  const isMacLoan = acct => !!acct && ((typeof window !== 'undefined' && window.CJPAccountPreset && window.CJPAccountPreset.presets) || []).some(p => stripZ(p.accountNumber) === stripZ(acct));

  /* ---------- pure model (tested separately) ---------- */
  function model(St, nowISO, fyOfFn, presets) {
    const fy = fyOfFn(nowISO), pf = prevFY(fy), TY = St.taxYears || {};
    const reps = Object.values(St.macReports || {});
    const latest = k => reps.filter(r => r.kind === k && r.asAt).sort((a, b) => String(b.asAt).localeCompare(String(a.asAt)))[0] || null;
    const macAcct = a => !!a && (presets || []).some(p => stripZ(p.accountNumber) === stripZ(a));
    const rows = [];
    (St.properties || []).filter(p => !p.sold).forEach(p => (p.loans || []).forEach(l => {
      if (l.balance == null && l.rate == null && l.repay == null && !(l.rateChanges || []).length) return;
      const F = inForce(l, nowISO);
      const rec = id => (TY[id] && TY[id].loans && TY[id].loans[l.id]) ? TY[id].loans[l.id].interest : null;
      const bal = l.balance != null ? +l.balance : null, off = l.offset != null ? +l.offset : null;
      const rate = F.rate ? F.rate.rate : (l.rate != null ? +l.rate : null);
      const repay = F.repay ? F.repay.repay : (l.repay != null ? +l.repay : null);
      const interestM = (bal != null && rate != null && bal > 0) ? Math.round(bal * rate / 1200) : null;
      rows.push({
        p, l, last4: l.acct ? String(l.acct).slice(-4) : '', linked: !!l.acct, mac: macAcct(l.acct),
        bal, off, net: bal != null ? Math.round((bal - (off || 0)) * 100) / 100 : null,
        rate, rateFrom: F.rate ? F.rate.rateDate : null,
        rateMismatch: !!(F.rate && !eq(l.rate, F.rate.rate)), rateStored: l.rate != null ? +l.rate : null,
        repay, repayMismatch: !!(F.repay && !eq(l.repay, F.repay.repay, 0.005)), repayStored: l.repay != null ? +l.repay : null,
        nextRepay: F.nextRepay ? { repay: F.nextRepay.repay, date: F.nextRepay.repayDate } : null,
        interestM, repayBad: repay != null && interestM != null && repay < interestM * 0.8,
        intCur: rec(fy) != null ? +rec(fy) : null, intPrev: rec(pf) != null ? +rec(pf) : null
      });
    }));
    const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const goodRepay = rows.filter(r => r.repay != null && !r.repayBad);
    const withDebt = rows.filter(r => (r.bal || 0) > 0).length;
    const intCurN = rows.filter(r => (r.bal || 0) > 0 && r.intCur != null).length;
    const intPrevN = rows.filter(r => (r.bal || 0) > 0 && r.intPrev != null).length;
    const bRep = latest('balance'), iRep = latest('interest');
    return {
      fy, pf, rows,
      totals: { bal: sum('bal'), off: sum('off'), net: sum('net'), repay: goodRepay.reduce((a, r) => a + r.repay, 0), intCur: sum('intCur'), intPrev: sum('intPrev') },
      partial: { repay: goodRepay.length > 0 && goodRepay.length < rows.length, repayN: goodRepay.length, rows: rows.length, intCur: withDebt > 0 && intCurN < withDebt, intPrev: withDebt > 0 && intPrevN < withDebt, intCurN, intPrevN, withDebt },
      balAsAt: bRep ? bRep.asAt : '', balRecon: bRep ? bRep.reconciled !== false : null,
      intAsAt: iRep ? iRep.asAt : '', intRecon: iRep ? iRep.reconciled !== false : null,
      balAge: bRep ? dayDiff(bRep.asAt, nowISO) : null
    };
  }

  /* ---------- the fix (pure: works on a state object; the button asks you to confirm the list first) ---------- */
  function plan(St, now) {
    const items = [];
    (St.properties || []).forEach(p => (p.loans || []).forEach(l => {
      const nm = `${p.name} \u00b7 ${l.name || 'Loan'}`;
      KNOWN.filter(k => stripZ(l.acct) === stripZ(k.acct)).forEach(k => {
        if (!(l.rateChanges || []).some(e => near(e, k)))
          items.push({ loan: l, kind: 'add', text: `${nm}: add the ${k.source.split(' - ')[0]}: rate ${k.oldRate}% \u2192 ${k.rate}% from ${k.rateDate}, repayment $${k.repay.toFixed(2)} from ${k.repayDate}` });
        const nxt = (l.rateChanges || []).filter(e => e.rateDate > k.rateDate && !near(e, k)).sort(asc('rateDate'))[0];
        if (nxt && !eq(nxt.oldRate, k.rate)) items.push({ loan: l, kind: 'old', text: `${nm}: correct the previous rate on the ${nxt.rateDate} notice from ${nxt.oldRate == null ? 'blank' : nxt.oldRate + '%'} to ${k.rate}%` });
      });
      balFor().filter(b => stripZ(l.acct) === stripZ(b.acct)).forEach(b => {
        const e = (l.rateChanges || []).find(x => near(x, b));
        if (e && e.balance == null) items.push({ loan: l, kind: 'bal', text: `${nm}: record the loan balance printed on the ${b.rateDate} notice (${m0(b.balance)})` });
      });
    }));
    // after those, what does each loan's saved rate / repayment become?
    const sim = JSON.parse(JSON.stringify(St)); applyPlan(sim, now, true);
    (St.properties || []).forEach((p, i) => (p.loans || []).forEach((l, j) => {
      const n = sim.properties[i].loans[j], nm = `${p.name} \u00b7 ${l.name || 'Loan'}`;
      if (n.rate != null && !eq(l.rate, n.rate)) items.push({ loan: l, kind: 'rate', text: `${nm}: saved rate ${l.rate == null ? 'blank' : l.rate + '%'} \u2192 ${n.rate}% (the rate in force from the lender letters)` });
      if (n.repay != null && !eq(l.repay, n.repay, 0.005)) items.push({ loan: l, kind: 'repay', text: `${nm}: saved repayment ${l.repay == null ? 'blank' : '$' + l.repay} \u2192 $${(+n.repay).toFixed(2)} (the repayment in force from the lender letters)` });
    }));
    return items;
  }
  function applyPlan(St, now, silent) {
    (St.properties || []).forEach(p => (p.loans || []).forEach(l => {
      KNOWN.filter(k => stripZ(l.acct) === stripZ(k.acct)).forEach(k => {
        l.rateChanges = l.rateChanges || [];
        if (!l.rateChanges.some(e => near(e, k)))
          l.rateChanges.push({ id: (typeof uid === 'function' && !silent) ? uid() : 'rc' + k.rateDate, rateDate: k.rateDate, rate: k.rate, repayDate: k.repayDate, repay: k.repay, oldRate: k.oldRate, oldRepay: k.oldRepay, balance: k.balance, balanceDate: k.balanceDate, source: k.source, doc: '', at: now, by: 'you' });
        l.rateChanges.sort(asc('rateDate'));
        const nxt = l.rateChanges.filter(e => e.rateDate > k.rateDate && !near(e, k))[0];
        if (nxt && !eq(nxt.oldRate, k.rate)) { nxt.oldRate = k.rate; nxt.oldRepay = k.repay; }
      });
      balFor().filter(b => stripZ(l.acct) === stripZ(b.acct)).forEach(b => { const e = (l.rateChanges || []).find(x => near(x, b)); if (e && e.balance == null) { e.balance = b.balance; e.balanceDate = b.balanceDate; } });
      const F = inForce(l, now);
      if (F.rate) { l.rate = F.rate.rate; (l.rateChanges || []).forEach(e => { if (e.rate != null && e.rateDate && e.rateDate <= now) e.rateDone = true; }); }
      if (F.repay) { l.repay = F.repay.repay; (l.rateChanges || []).forEach(e => { if (e.repay != null && e.repayDate && e.repayDate <= now) e.repayDone = true; }); }
    }));
  }
  window.dlFix = () => {
    const items = plan(S, iso(today()));
    if (!items.length) return toast('Nothing to fix - the loans already match the lender letters');
    if (!confirm('This will make these changes:\n\n\u2022 ' + items.map(i => i.text).join('\n\u2022 ') + '\n\nContinue?')) return;
    try { applyPlan(S, iso(today())); log('Loans updated from lender letters', items.map(i => i.text).join(' | ')); save(); if (typeof renderAll === 'function') renderAll(); toast('Loans updated from the lender letters'); }
    catch (e) { toast('Could not update: ' + e.message); }
  };

  /* ---------- the card ---------- */
  function html(M, P) {
    const dash = '<span class="muted">\u2014</span>', amt = v => v == null ? dash : m0(v);
    if (!M.rows.length) return `<div class="card" id="dlCard" style="margin-top:16px"><div class="row sp"><h2>Loans &amp; interest</h2><button class="btn sm" onclick="go('mortgage')">Analytics \u2192</button></div><div class="empty">No loans recorded yet. Add them under each property (Edit) or import a Macquarie proof of balance.</div></div>`;
    const body = M.rows.map(r => `<tr onclick="go('prop:${esc(r.p.id)}')" style="cursor:pointer"><td><b>${esc(r.l.name || 'Loan')}</b><div class="muted sm">${esc(r.p.name)}${r.last4 ? ' \u00b7 \u2022\u2022\u2022\u2022' + esc(r.last4) : ''}${entityOf(r.p) === 'smsf' ? ' \u00b7 SMSF' : ''}</div></td>` +
      `<td class="num">${amt(r.bal)}</td><td class="num">${amt(r.off)}</td><td class="num"><b>${amt(r.net)}</b></td>` +
      `<td class="num">${r.rate != null ? '<b>' + pc(r.rate) + '</b>' : dash}${r.rateFrom ? `<div class="muted sm">from ${esc(fdate(r.rateFrom))}</div>` : ''}${r.rateMismatch ? `<div class="amber sm">saved loan: ${pc(r.rateStored)}</div>` : ''}</td>` +
      `<td class="num">${r.repay != null ? (r.repayBad ? `<span class="amber">${money(r.repay)}</span>` : money(r.repay)) : dash}${r.repayBad ? `<div class="amber sm">too low: a month's interest is about ${m0(r.interestM)}</div>` : ''}${r.nextRepay ? `<div class="muted sm">${money(r.nextRepay.repay)} from ${esc(fdate(r.nextRepay.date))}</div>` : ''}${r.repayMismatch && !r.repayBad ? `<div class="amber sm">saved loan: ${money(r.repayStored)}</div>` : ''}</td>` +
      `<td class="num">${amt(r.intCur)}</td><td class="num">${amt(r.intPrev)}</td></tr>`).join('');
    const T = M.totals, many = M.rows.length > 1;
    const part = (flag, n, of) => flag ? `<div class="amber sm">${n} of ${of} loans</div>` : '';
    const total = many ? `<tr class="total"><td>Total</td><td class="num">${m0(T.bal)}</td><td class="num">${m0(T.off)}</td><td class="num">${m0(T.net)}</td><td></td><td class="num">${M.partial.repayN ? money(T.repay) : dash}${part(M.partial.repay, M.partial.repayN, M.partial.rows)}</td><td class="num">${M.partial.intCurN ? m0(T.intCur) : dash}${part(M.partial.intCur && M.partial.intCurN, M.partial.intCurN, M.partial.withDebt)}</td><td class="num">${M.partial.intPrevN ? m0(T.intPrev) : dash}${part(M.partial.intPrev && M.partial.intPrevN, M.partial.intPrevN, M.partial.withDebt)}</td></tr>` : '';
    const notes = [];
    notes.push(M.balAsAt ? `Balances and offsets as at ${fdate(M.balAsAt)} (Macquarie proof of balance${M.balRecon === false ? ', did not reconcile' : ''}).` : 'Balances are as last saved on each loan. No dated Macquarie proof of balance has been imported.');
    if (M.balAge != null && M.balAge > 35) notes.push(`<span class="amber">These balances are ${M.balAge} days old. Import a newer proof of balance.</span>`);
    notes.push(M.intAsAt ? `Interest charged from the Macquarie Financial Year Interest Report to ${fdate(M.intAsAt)}${M.intRecon === false ? ' (did not reconcile)' : ''}; FY${esc(M.fy)} is part-year.` : `Interest is blank until the Macquarie Financial Year Interest Report is imported (Statements \u203a Macquarie reports).`);
    notes.push('Rate and repayment are the ones in force today from the lender\u2019s rate-change letters, otherwise as saved on the loan.');
    M.rows.filter(r => !r.linked).forEach(r => { const eqp = (P || []).find(p => p.role === 'investment-equity-split'); notes.push(`<span class="amber">${esc(r.l.name || 'Loan')} is not linked to a Macquarie account, so its balance and interest are not from Macquarie${eqp && /equity/i.test(r.l.name || '') ? `. Re-import the Macquarie proof of balance and interest report and make sure the \u2022\u2022\u2022\u2022${esc(eqp.last4)} row is set to this loan` : ''}.</span>`); });
    M.rows.filter(r => r.linked && !r.mac && (r.bal || 0) > 0 && r.intCur == null).forEach(r => notes.push(`${esc(r.l.name || 'Loan')} is not a Macquarie loan, so its interest is not in the Macquarie report. Use the lender\u2019s statement or annual summary (Tax \u203a Loans).`));
    const uns = active().filter(p => p.unsettled).map(p => `${esc(p.name)} (${m0(stats(p).owing)} still to fund at settlement)`);
    if (uns.length) notes.push(`Not yet settled, so not in the loans above: ${uns.join(', ')}.`);
    notes.push('The portal has no live bank feed. Figures are as of the last import.');
    const fixN = plan(S, iso(today())).length;
    const fix = fixN ? `<div class="note warn" style="margin-top:10px"><b>${fixN} loan detail${fixN > 1 ? 's do' : ' does'} not match the lender letters.</b> <button class="btn sm primary" onclick="dlFix()" style="margin-left:8px">Fix loans from lender letters</button><div class="muted sm" style="margin-top:4px">You will see every change and confirm it before anything is saved.</div></div>` : '';
    return `<div class="card" id="dlCard" style="margin-top:16px"><div class="row sp"><h2>Loans &amp; interest</h2><button class="btn sm" onclick="go('mortgage')">Analytics \u2192</button></div>` +
      `<div style="overflow:auto"><table class="stack"><thead><tr><th>Loan</th><th class="num">Balance</th><th class="num">Offset</th><th class="num">Net debt</th><th class="num">Rate</th><th class="num">Repay / mth</th><th class="num">Interest FY${esc(M.fy)} to date</th><th class="num">Interest FY${esc(M.pf)}</th></tr></thead><tbody>${body}${total}</tbody></table></div>` +
      fix + `<div class="muted sm" style="margin-top:8px">${notes.join('<br>')}</div></div>`;
  }
  function paint() {
    const k = document.getElementById('kpis'); if (!k || typeof S === 'undefined' || !S) return;
    const old = document.getElementById('dlCard'); if (old) old.remove();
    const P = (window.CJPAccountPreset && window.CJPAccountPreset.presets) || [];
    k.insertAdjacentHTML('afterend', html(model(S, iso(today()), fyOf, P), P));
  }
  try { const o = renderDashboard; renderDashboard = function () { o.apply(this, arguments); try { paint(); } catch (e) { warn('card', e); } }; } catch (e) { warn('renderDashboard', e); }
  (typeof window !== 'undefined' ? window : globalThis).PortalDashLoans = { version: '1.2', model, plan, applyPlan, inForce, KNOWN, balFor };
})();
