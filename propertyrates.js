/* CJP Portal - propertyrates.js v1.1 (add-on, load AFTER ratechange.js and dashboardloans.js)
   "Interest rates & repayments" card on EACH property's main screen, built only from that property's own loans and lender letters.
   v1.1 (fixes from your screenshot of The Canopy):
     - Readable: solid dark card instead of a see-through one over the building photo, full width under Upcoming bills / Loans (v1.0 sat beside Upcoming bills and stretched it).
     - Correct figures: the rate and repayment shown are the ones IN FORCE TODAY from the lender's rate-change letters. v1.0 showed the saved loan figures
       (7.34% and a $395 "repayment" that was really the annual fee) even though the letters said 7.84%.
     - A saved figure that disagrees with the letters is flagged, with the same one-click "Fix loans from lender letters" as the Dashboard (you see every change first and confirm).
     - A repayment lower than a month's interest cannot be right and is flagged.
     - Shows the next scheduled repayment, and the loan balance printed on each lender notice (where recorded).
     - Properties with no loan (e.g. a purchase not yet settled) show no card instead of an empty one.
   Display only. Nothing is estimated except the line marked "indicative". Safe to remove. */
(() => {
  'use strict';
  const warn = (what, e) => { try { console.warn('propertyrates.js: ' + what, e); } catch (x) { } };
  const g = () => (typeof window !== 'undefined' ? window : globalThis);
  const pc = n => (n == null || isNaN(n) ? '\u2014' : (Math.round(n * 1000) / 1000) + '%');
  const addMonths = (isoDate, n) => { const d = new Date(isoDate + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
  const eq = (a, b, t) => a != null && b != null && Math.abs(a - b) <= (t || 0.0001);
  const byDesc = f => (a, b) => String(b[f]).localeCompare(String(a[f]));

  /* ---------- pure logic (tested separately) ---------- */
  function loanRates(l, todayISO) {
    const evs = (l.rateChanges || []).filter(e => e.rate != null && e.rateDate).slice().sort(byDesc('rateDate'));
    const inForce = evs.filter(e => e.rateDate <= todayISO), scheduled = evs.filter(e => e.rateDate > todayISO).reverse();
    const last = inForce[0] || null;
    const rp = (l.rateChanges || []).filter(e => e.repay != null && e.repayDate && e.repayDate <= todayISO).sort(byDesc('repayDate'))[0] || null;
    const nextRp = (l.rateChanges || []).filter(e => e.repay != null && e.repayDate && e.repayDate > todayISO).sort((a, b) => String(a.repayDate).localeCompare(String(b.repayDate)))[0] || null;
    const current = last ? last.rate : (l.rate != null ? +l.rate : null);
    const repay = rp ? rp.repay : (l.repay != null ? +l.repay : null);
    const bal = l.balance != null ? +l.balance : null;
    const interestM = (bal != null && bal > 0 && current != null) ? Math.round(bal * current / 1200) : null;
    // 12-month movement: only if each change in the window has a known previous rate
    const from = addMonths(todayISO, -12), win = inForce.filter(e => e.rateDate >= from);
    let change = null, complete = true;
    if (win.length) { change = 0; win.forEach(e => { if (e.oldRate == null) complete = false; else change += e.rate - e.oldRate; }); change = Math.round(change * 1000) / 1000; }
    else { change = 0; complete = inForce.length > 0; }
    const monthly = (complete && change && bal != null && bal > 0) ? Math.round(bal * change / 1200) : null;
    return {
      current, last, repay, nextRepay: nextRp ? { repay: nextRp.repay, date: nextRp.repayDate } : null, history: evs, scheduled,
      change: evs.length ? change : null, complete: evs.length ? complete : false, monthly, windowCount: win.length, interestM,
      rateMismatch: !!(last && !eq(l.rate, last.rate)), rateStored: l.rate != null ? +l.rate : null,
      repayMismatch: !!(rp && !eq(l.repay, rp.repay, 0.005)), repayStored: l.repay != null ? +l.repay : null,
      repayBad: repay != null && interestM != null && repay < interestM * 0.8
    };
  }

  /* ---------- the card ---------- */
  function loanBlock(l, p, now) {
    const r = loanRates(l, now), name = esc(l.name || 'Loan');
    const lender = l.lender ? ` \u00b7 ${esc(l.lender)}` : '';
    const head = `<div class="row sp" style="align-items:flex-end;gap:12px"><div><b style="font-size:16px">${name}</b><div class="muted sm">${l.acct ? '\u2022\u2022\u2022\u2022' + esc(String(l.acct).slice(-4)) : 'no account number'}${lender}</div></div>` +
      `<div style="text-align:right"><div style="font-size:30px;font-weight:700;line-height:1.05">${r.current != null ? pc(r.current) : '\u2014'}</div><div class="muted sm">${r.current != null ? (r.last ? 'current rate \u00b7 from ' + esc(fdate(r.last.rateDate)) : 'current rate (as saved)') : 'no rate recorded'}</div></div></div>`;
    const repayCell = r.repay != null
      ? (r.repayBad ? `<span class="amber"><b>${money(r.repay)}</b></span><div class="amber sm">too low \u2013 a month's interest is about ${m0(r.interestM)}</div>` : `<b>${money(r.repay)}</b>`)
      : '\u2014';
    const facts = [
      ['Repayment / month', repayCell + (r.nextRepay ? `<div class="muted sm">${money(r.nextRepay.repay)} from ${esc(fdate(r.nextRepay.date))}</div>` : '') + (r.repayMismatch && !r.repayBad ? `<div class="amber sm">saved loan: ${money(r.repayStored)}</div>` : '')],
      ['Loan balance', l.balance != null ? m0(l.balance) : '\u2014'],
      ['Last rate change', r.last ? `${r.last.oldRate != null ? pc(r.last.oldRate) + ' \u2192 ' : ''}<b>${pc(r.last.rate)}</b> from ${esc(fdate(r.last.rateDate))}` : '\u2014'],
      ['Change in last 12 months', r.change == null ? '\u2014' : r.complete ? `${r.change > 0 ? '+' : ''}${r.change}%${r.windowCount ? '' : ' (none)'}` : '<span class="amber">History incomplete</span>'],
      ['Indicative added monthly interest', r.monthly != null ? `${money(r.monthly)}<div class="muted sm">estimate: balance \u00d7 change \u00f7 12</div>` : '\u2014']
    ].map(([k, v]) => `<div class="row sp" style="padding:8px 0;border-top:1px solid rgba(255,255,255,.12);align-items:flex-start"><span class="muted">${k}</span><span style="text-align:right">${v}</span></div>`).join('');
    const mism = r.rateMismatch ? `<div class="amber sm" style="margin-top:6px">The saved loan says ${pc(r.rateStored)}; the lender letters say ${pc(r.current)}.</div>` : '';
    const hist = r.history.length
      ? `<div class="muted sm" style="margin-top:12px">Lender letters</div><table class="stack"><tbody>${r.history.map(e => `<tr><td class="nowrap">${esc(fdate(e.rateDate))}</td><td>${e.oldRate != null ? pc(e.oldRate) + ' \u2192 ' : ''}<b>${pc(e.rate)}</b>${e.repay != null ? ` \u00b7 repay ${money(e.repay)} from ${esc(fdate(e.repayDate))}` : ''}${e.balance != null ? `<div class="muted sm">balance on notice ${m0(e.balance)}</div>` : ''}${e.rateDate > now ? ' <span class="amber">(scheduled)</span>' : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="muted sm" style="margin-top:12px">No rate-change letters saved for this loan. Import the lender's notice (Statements &amp; imports, Type = Rate change) and the history will appear here.</div>`;
    return `<div style="min-width:0">${head}<div style="margin-top:8px">${facts}</div>${mism}${hist}</div>`;
  }
  function card(p) {
    const now = iso(today()), loans = (p.loans || []).filter(l => l.balance != null || l.rate != null || l.repay != null || (l.rateChanges || []).length);
    if (!loans.length) return '';
    const DL = g().PortalDashLoans;
    let fix = '';
    try {
      const mine = new Set(loans);
      const n = DL && DL.plan ? DL.plan(S, now).filter(i => mine.has(i.loan)).length : 0;
      if (n) fix = `<div class="note warn" style="margin-top:12px"><b>${n} loan detail${n > 1 ? 's do' : ' does'} not match the lender letters.</b> <button class="btn sm primary" style="margin-left:8px" onclick="dlFix()">Fix loans from lender letters</button><div class="muted sm" style="margin-top:4px">You will see every change and confirm it before anything is saved.</div></div>`;
    } catch (e) { warn('fix', e); }
    const cols = loans.length > 1 ? 'repeat(auto-fit,minmax(300px,1fr))' : '1fr';
    return `<div class="card" id="prCard" style="margin-top:16px;background:rgba(9,13,28,.94);border:1px solid rgba(255,255,255,.14);color:#e8ecf7">` +
      `<div class="row sp"><h2 style="margin-top:0">Interest rates &amp; repayments</h2><button class="btn sm" onclick="go('mortgage');$('mgProp').value='${esc(p.id)}';renderMortgage()">Loan analytics \u2192</button></div><div class="muted sm" style="margin-bottom:10px">${esc(p.name)} \u00b7 from this property's loans and the lender's rate-change letters</div>` +
      `<div style="display:grid;grid-template-columns:${cols};gap:22px">${loans.map(l => loanBlock(l, p, now)).join('')}</div>${fix}</div>`;
  }
  function paint() {
    const page = document.getElementById('propPage'); if (!page) return;
    const p = typeof prop === 'function' ? prop(curProp) : null; if (!p) return;
    const old = document.getElementById('prCard'); if (old) old.remove();
    // remove ratechange.js's short list (this card shows the full history)
    [...page.querySelectorAll('h3')].filter(h => h.textContent.trim() === 'Rate changes').forEach(h => {
      let n = h.nextElementSibling; while (n && n.matches && n.matches('div.muted.sm')) { const x = n; n = n.nextElementSibling; x.remove(); } h.remove();
    });
    const html = card(p); if (!html) return;
    const h = [...page.querySelectorAll('h2')].find(x => x.textContent.trim() === 'Loans');
    const loansCard = h && h.closest ? h.closest('.card') : null;
    const row = loansCard && loansCard.parentElement;          // the two-column row holding Upcoming bills and Loans
    if (row && row.parentElement) row.insertAdjacentHTML('afterend', html);
    else page.insertAdjacentHTML('beforeend', html);
  }
  try { const o = renderPropPage; renderPropPage = function () { o.apply(this, arguments); try { paint(); } catch (e) { warn('card', e); } }; } catch (e) { warn('renderPropPage', e); }
  g().PortalPropertyRates = { version: '1.1', loanRates };
})();
