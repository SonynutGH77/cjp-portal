/* CJP Portal - dashboardloans.js v1.0 (add-on, works with app.js v6.5.x)
   Adds a "Loans & interest" card to the Dashboard so the current position is always on screen - no report to run.
   One row per loan on every property you still hold:
     balance, offset, net debt, current rate, repayment, interest charged this financial year to date, and last financial year.
   Where each figure comes from (nothing is estimated or calculated from guesses):
     - balance / offset / rate / repayment ... the loan record on each property (updated by the Macquarie proof of balance, statements and rate letters)
     - interest charged ........................ Tax & accountant > Loans, as set by the Macquarie Financial Year's Interest Report
   A figure that has not been imported shows a dash, never a zero. The card says how old the data is.
   Display only: it changes no data. Safe to remove. */
(() => {
  'use strict';
  const warn = (what, e) => { try { console.warn('dashboardloans.js: ' + what, e); } catch (x) { } };
  const pc = n => (n == null || isNaN(n) ? '\u2014' : (Math.round(n * 1000) / 1000) + '%');
  const prevFY = fy => { const y = +fy.slice(0, 4) - 1; return `${y}-${String(y + 1).slice(2)}`; };
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  /* ---------- pure model (tested separately) ---------- */
  function model(St, nowISO, fyOfFn) {
    const fy = fyOfFn(nowISO), pf = prevFY(fy), TY = St.taxYears || {};
    const reps = Object.values(St.macReports || {});
    const latest = k => reps.filter(r => r.kind === k && r.asAt).sort((a, b) => String(b.asAt).localeCompare(String(a.asAt)))[0] || null;
    const rows = [];
    (St.properties || []).filter(p => !p.sold).forEach(p => (p.loans || []).forEach(l => {
      if (l.balance == null && l.rate == null && l.repay == null) return;
      const evs = (l.rateChanges || []).filter(e => e.rate != null && e.rateDate && e.rateDate <= nowISO).sort((a, b) => String(b.rateDate).localeCompare(String(a.rateDate)));
      const rec = id => (TY[id] && TY[id].loans && TY[id].loans[l.id]) ? TY[id].loans[l.id].interest : null;
      const bal = l.balance != null ? +l.balance : null, off = l.offset != null ? +l.offset : null;
      rows.push({
        p, l, last4: l.acct ? String(l.acct).slice(-4) : '',
        bal, off, net: bal != null ? Math.round((bal - (off || 0)) * 100) / 100 : null,
        rate: l.rate != null ? +l.rate : (evs[0] ? evs[0].rate : null), rateFrom: evs[0] ? evs[0].rateDate : null,
        rateLetter: (evs[0] && l.rate != null && Math.abs(+l.rate - evs[0].rate) > 0.0001) ? evs[0] : null,
        repay: l.repay != null ? +l.repay : null,
        intCur: rec(fy) != null ? +rec(fy) : null, intPrev: rec(pf) != null ? +rec(pf) : null
      });
    }));
    const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0), have = k => rows.filter(r => r[k] != null).length;
    const withDebt = rows.filter(r => (r.bal || 0) > 0).length;
    const repayN = have('repay');
    const intCurN = rows.filter(r => (r.bal || 0) > 0 && r.intCur != null).length;
    const intPrevN = rows.filter(r => (r.bal || 0) > 0 && r.intPrev != null).length;
    const bRep = latest('balance'), iRep = latest('interest');
    return {
      fy, pf, rows,
      totals: { bal: sum('bal'), off: sum('off'), net: sum('net'), repay: sum('repay'), intCur: sum('intCur'), intPrev: sum('intPrev') },
      partial: { repay: repayN > 0 && repayN < rows.length, repayN, rows: rows.length, intCur: withDebt > 0 && intCurN < withDebt, intPrev: withDebt > 0 && intPrevN < withDebt, intCurN, intPrevN, withDebt },
      balAsAt: bRep ? bRep.asAt : '', balRecon: bRep ? bRep.reconciled !== false : null,
      intAsAt: iRep ? iRep.asAt : '', intRecon: iRep ? iRep.reconciled !== false : null,
      balAge: bRep ? dayDiff(bRep.asAt, nowISO) : null
    };
  }

  /* ---------- the card ---------- */
  function html(M) {
    const dash = '<span class="muted">\u2014</span>', amt = v => v == null ? dash : m0(v);
    if (!M.rows.length) return `<div class="card" id="dlCard" style="margin-top:16px"><div class="row sp"><h2>Loans &amp; interest</h2><button class="btn sm" onclick="go('mortgage')">Analytics \u2192</button></div><div class="empty">No loans recorded yet. Add them under each property (Edit) or import a Macquarie proof of balance.</div></div>`;
    const body = M.rows.map(r => `<tr onclick="go('prop:${esc(r.p.id)}')" style="cursor:pointer"><td><b>${esc(r.l.name || 'Loan')}</b><div class="muted sm">${esc(r.p.name)}${r.last4 ? ' \u00b7 \u2022\u2022\u2022\u2022' + esc(r.last4) : ''}${entityOf(r.p) === 'smsf' ? ' \u00b7 SMSF' : ''}</div></td>` +
      `<td class="num">${amt(r.bal)}</td><td class="num">${amt(r.off)}</td><td class="num"><b>${amt(r.net)}</b></td>` +
      `<td class="num">${r.rate != null ? '<b>' + pc(r.rate) + '</b>' : dash}${r.rateFrom && !r.rateLetter ? `<div class="muted sm">from ${esc(fdate(r.rateFrom))}</div>` : ''}${r.rateLetter ? `<div class="amber sm">letter: ${pc(r.rateLetter.rate)} from ${esc(fdate(r.rateLetter.rateDate))}</div>` : ''}</td>` +
      `<td class="num">${amt(r.repay)}</td><td class="num">${amt(r.intCur)}</td><td class="num">${amt(r.intPrev)}</td></tr>`).join('');
    const T = M.totals, many = M.rows.length > 1;
    const part = (flag, n, of) => flag ? `<div class="amber sm">${n} of ${of} loans</div>` : '';
    const total = many ? `<tr class="total"><td>Total</td><td class="num">${m0(T.bal)}</td><td class="num">${m0(T.off)}</td><td class="num">${m0(T.net)}</td><td></td><td class="num">${M.partial.repayN ? m0(T.repay) : dash}${part(M.partial.repay, M.partial.repayN, M.partial.rows)}</td><td class="num">${M.partial.intCurN ? m0(T.intCur) : dash}${part(M.partial.intCur && M.partial.intCurN, M.partial.intCurN, M.partial.withDebt)}</td><td class="num">${M.partial.intPrevN ? m0(T.intPrev) : dash}${part(M.partial.intPrev && M.partial.intPrevN, M.partial.intPrevN, M.partial.withDebt)}</td></tr>` : '';
    const notes = [];
    notes.push(M.balAsAt ? `Balances and offsets as at ${fdate(M.balAsAt)} (Macquarie proof of balance${M.balRecon === false ? ', did not reconcile' : ''}).` : 'Balances are as last saved on each loan. No dated Macquarie proof of balance has been imported.');
    if (M.balAge != null && M.balAge > 35) notes.push(`<span class="amber">These balances are ${M.balAge} days old. Import a newer proof of balance.</span>`);
    notes.push(M.intAsAt ? `Interest charged from the Macquarie Financial Year Interest Report to ${fdate(M.intAsAt)}${M.intRecon === false ? ' (did not reconcile)' : ''}; FY${esc(M.fy)} is part-year.` : `Interest is blank until the Macquarie Financial Year Interest Report is imported (Statements \u203a Macquarie reports).`);
    const uns = active().filter(p => p.unsettled).map(p => `${esc(p.name)} (${m0(stats(p).owing)} still to fund at settlement)`);
    if (uns.length) notes.push(`Not yet settled, so not in the loans above: ${uns.join(', ')}.`);
    if (M.rows.some(r => r.rateLetter)) notes.push('<span class="amber">A rate shown differs from the newest rate letter in force. Re-import that letter, or correct the loan under Edit.</span>');
    notes.push('The portal has no live bank feed. Figures are as of the last import.');
    return `<div class="card" id="dlCard" style="margin-top:16px"><div class="row sp"><h2>Loans &amp; interest</h2><button class="btn sm" onclick="go('mortgage')">Analytics \u2192</button></div>` +
      `<div style="overflow:auto"><table class="stack"><thead><tr><th>Loan</th><th class="num">Balance</th><th class="num">Offset</th><th class="num">Net debt</th><th class="num">Rate</th><th class="num">Repay / mth</th><th class="num">Interest FY${esc(M.fy)} to date</th><th class="num">Interest FY${esc(M.pf)}</th></tr></thead><tbody>${body}${total}</tbody></table></div>` +
      `<div class="muted sm" style="margin-top:8px">${notes.join('<br>')}</div></div>`;
  }
  function paint() {
    const k = document.getElementById('kpis'); if (!k || typeof S === 'undefined' || !S) return;
    const old = document.getElementById('dlCard'); if (old) old.remove();
    k.insertAdjacentHTML('afterend', html(model(S, iso(today()), fyOf)));
  }
  try { const o = renderDashboard; renderDashboard = function () { o.apply(this, arguments); try { paint(); } catch (e) { warn('card', e); } }; } catch (e) { warn('renderDashboard', e); }
  (typeof window !== 'undefined' ? window : globalThis).PortalDashLoans = { version: '1.0', model };
})();
