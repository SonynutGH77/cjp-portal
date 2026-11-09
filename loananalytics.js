/* CJP Portal - loananalytics.js v1.0 (add-on, load AFTER rateanalytics.js, dashboardloans.js and propertyrates.js)
   Changes to the Mortgage analytics page:
   1. REMOVES the "Interest-rate trends by property" section. Rates now live on each property's own screen (Interest rates & repayments card).
   2. SHOWS analytics for a property that has loans but no monthly statement history - e.g. The Canopy (Arthurmac SMSF loan), which previously only said
      "No verified loan history for this property".
      Built only from what the lender has actually sent (rate-change notices): balance printed on each notice, rate and repayment history, and what is in force today.
      Anything calculated is labelled "indicative". Properties that already have monthly history (e.g. 8 Neale Street) are left exactly as the portal draws them.
   Display only: it changes no data. Safe to remove. */
(() => {
  'use strict';
  const warn = (what, e) => { try { console.warn('loananalytics.js: ' + what, e); } catch (x) { } };
  const g = () => (typeof window !== 'undefined' ? window : globalThis);
  const pc = n => (n == null || isNaN(n) ? '\u2014' : (Math.round(n * 1000) / 1000) + '%');
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

  /* ---------- pure model (tested separately) ---------- */
  function model(p, now, rates) {
    const loans = (p.loans || []).filter(l => l.balance != null || l.rate != null || l.repay != null || (l.rateChanges || []).length);
    return loans.map(l => {
      const r = rates(l, now);
      const bals = (l.rateChanges || []).filter(e => e.balance != null && (e.balanceDate || e.rateDate)).map(e => ({ date: e.balanceDate || e.rateDate, balance: +e.balance })).sort((a, b) => a.date.localeCompare(b.date));
      const first = bals[0] || null, last = bals[bals.length - 1] || null;
      const paid = bals.length >= 2 ? { amount: Math.round((first.balance - last.balance) * 100) / 100, days: dayDiff(first.date, last.date), from: first.date, to: last.date } : null;
      const evs = (l.rateChanges || []).filter(e => e.rate != null && e.rateDate).slice().sort((a, b) => a.rateDate.localeCompare(b.rateDate));
      const steps = [];
      if (evs.length) {
        if (evs[0].oldRate != null) steps.push({ d: addDays(evs[0].rateDate, -30), rate: evs[0].oldRate, pad: true });
        evs.filter(e => e.rateDate <= now).forEach(e => steps.push({ d: e.rateDate, rate: e.rate }));
      }
      const bal = l.balance != null ? +l.balance : null;
      const principalM = (r.repay != null && r.interestM != null && !r.repayBad) ? Math.round((r.repay - r.interestM) * 100) / 100 : null;
      const startRate = evs[0] && evs[0].oldRate != null ? evs[0].oldRate : null;
      const extraM = (startRate != null && r.current != null && bal != null && bal > 0) ? Math.round(bal * (r.current - startRate) / 1200) : null;
      return { l, r, bals, paid, steps, evs: evs.slice().reverse(), principalM, startRate, extraM, bal };
    });
  }

  /* ---------- rate chart (stepped line) ---------- */
  function rateSvg(steps, now, fm) {
    if (steps.length < 2) return '';
    const W = 760, H = 240, P = { l: 56, r: 16, t: 18, b: 34 };
    const t0 = Date.parse(steps[0].d), t1 = Date.parse(now), span = Math.max(1, t1 - t0);
    const X = d => P.l + (Date.parse(d) - t0) / span * (W - P.l - P.r);
    const rs = steps.map(s => s.rate), lo = Math.floor(Math.min(...rs) * 4) / 4 - 0.25, hi = Math.ceil(Math.max(...rs) * 4) / 4 + 0.25;
    const Y = r => P.t + (1 - (r - lo) / (hi - lo)) * (H - P.t - P.b);
    let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" role="img" aria-label="Interest rate history">`;
    for (let v = lo; v <= hi + 1e-9; v += 0.25) { const y = Y(v); g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" class="grid"/><text x="${P.l - 6}" y="${y + 4}" text-anchor="end">${(Math.round(v * 100) / 100)}%</text>`; }
    let d = `M${X(steps[0].d)},${Y(steps[0].rate)}`;
    for (let i = 1; i < steps.length; i++) d += ` H${X(steps[i].d)} V${Y(steps[i].rate)}`;
    d += ` H${W - P.r}`;
    g += `<path d="${d}" fill="none" stroke="#5b9dff" stroke-width="2.5"/>`;
    steps.forEach((s, i) => { if (s.pad) return; g += `<circle cx="${X(s.d)}" cy="${Y(s.rate)}" r="4" fill="#5b9dff" stroke="#fff" stroke-width="1.2"><title>${fm(s.d)}: ${pc(s.rate)}</title></circle><text x="${X(s.d)}" y="${Y(s.rate) - 10}" text-anchor="middle" style="fill:var(--text)">${pc(s.rate)}</text><text x="${X(s.d)}" y="${H - 10}" text-anchor="middle">${fm(s.d)}</text>`; });
    return g + '</svg>';
  }

  /* ---------- the page ---------- */
  function loanCard(M, p, now) {
    const { l, r } = M, name = esc(l.name || 'Loan'), dash = '\u2014';
    const latestBal = M.bals[M.bals.length - 1];
    const kpis = [
      ['Loan balance', M.bal != null ? m0(M.bal) : dash, latestBal && eqn(latestBal.balance, M.bal) ? `As printed on the ${fdate(latestBal.date)} lender notice` : 'As saved on the loan', ''],
      ['Current rate', r.current != null ? pc(r.current) : dash, r.last ? `From ${fdate(r.last.rateDate)} (lender notice)` : 'As saved on the loan', ''],
      ['Repayment / month', r.repay != null ? money(r.repay) : dash, r.nextRepay ? `${money(r.nextRepay.repay)} from ${fdate(r.nextRepay.date)}` : (r.repayBad ? 'Looks wrong \u2013 see below' : 'In force today'), r.repayBad ? 'amber' : ''],
      ['Interest / month', r.interestM != null ? m0(r.interestM) : dash, 'Indicative: balance \u00d7 rate \u00f7 12', ''],
      ['Principal / month', M.principalM != null ? m0(M.principalM) : dash, 'Indicative: repayment \u2212 interest', M.principalM != null && M.principalM > 0 ? 'green' : '']
    ];
    const k = `<div class="grid k5">${kpis.map(x => `<div class="card glass kpi"><div class="lbl">${x[0]}</div><div class="val ${x[3]}" style="font-size:22px">${x[1]}</div><div class="hint">${x[2]}</div></div>`).join('')}</div>`;
    const chart = rateSvg(M.steps, now, fmonth);
    const rows = M.evs.map(e => `<tr><td class="nowrap">${esc(fdate(e.rateDate))}</td><td>${e.oldRate != null ? pc(e.oldRate) + ' \u2192 ' : ''}<b>${pc(e.rate)}</b></td><td class="num">${e.repay != null ? money(e.repay) : dash}${e.repay != null && e.repayDate ? `<div class="muted sm">from ${esc(fdate(e.repayDate))}</div>` : ''}</td><td class="num">${e.balance != null ? m0(e.balance) : dash}${e.balance != null ? `<div class="muted sm">${esc(fdate(e.balanceDate || e.rateDate))}</div>` : ''}</td></tr>`).join('');
    const facts = [];
    if (M.paid) facts.push(`Principal reduced by <b>${m0(M.paid.amount)}</b> between the notices of ${esc(fdate(M.paid.from))} and ${esc(fdate(M.paid.to))} (${M.paid.days} days), taken from the balances printed on them.`);
    if (M.extraM != null && M.extraM !== 0) facts.push(`The rate has gone from ${pc(M.startRate)} to ${pc(r.current)}. On today's balance that is about <b>${m0(M.extraM)}</b> more interest a month <span class="muted">(indicative)</span>.`);
    return `<div class="card" style="margin-top:16px"><h2 style="margin-top:0">${name}${l.lender ? ` <span class="muted sm">\u00b7 ${esc(l.lender)}</span>` : ''}</h2><div class="muted sm" style="margin-bottom:10px">${esc(p.name)}${l.acct ? ' \u00b7 \u2022\u2022\u2022\u2022' + esc(String(l.acct).slice(-4)) : ''}</div>${k}` +
      (chart ? `<div style="margin-top:16px"><h3 style="margin:0 0 6px">Interest rate history</h3>${chart}</div>` : '') +
      (facts.length ? `<div style="margin-top:12px;line-height:1.6">${facts.join('<br>')}</div>` : '') +
      (rows ? `<h3 style="margin:16px 0 6px">Lender notices</h3><table class="stack"><thead><tr><th>Date</th><th>Rate</th><th class="num">Repayment</th><th class="num">Balance on notice</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="note" style="margin-top:12px">No lender notices are saved for this loan yet. Import the rate-change notice (Statements &amp; imports, Type = Rate change).</div>`) + `</div>`;
  }
  const eqn = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;

  function html(p) {
    const now = iso(today()), RL = g().PortalPropertyRates && g().PortalPropertyRates.loanRates;
    if (!RL) return '';
    const ms = model(p, now, RL); if (!ms.length) return '';
    let fix = '';
    try {
      const DL = g().PortalDashLoans, mine = new Set(ms.map(m => m.l)), n = DL && DL.plan ? DL.plan(S, now).filter(i => mine.has(i.loan)).length : 0;
      if (n) fix = `<div class="note warn" style="margin-top:16px"><b>${n} loan detail${n > 1 ? 's do' : ' does'} not match the lender notices.</b> <button class="btn sm primary" style="margin-left:8px" onclick="dlFix()">Fix loans from lender letters</button><div class="muted sm" style="margin-top:4px">You will see every change and confirm it before anything is saved.</div></div>`;
    } catch (e) { warn('fix', e); }
    return `<div class="note info"><b>${esc(p.name)}: analytics from lender notices.</b> No monthly loan statements have been imported for this property, so these figures come only from what the lender has sent (rate-change notices). Lines marked <i>indicative</i> are calculated, not statement figures. To build the month-by-month history and interest charged, add months from the lender's statements with <b>+ Month</b> or import them under Statements. For tax, use the lender's own statement for interest charged.</div>` + fix + ms.map(m => loanCard(m, p, now)).join('');
  }
  function paint() {
    const sel = document.getElementById('mgProp'), body = document.getElementById('mgBody'); if (!sel || !body || typeof S === 'undefined' || !S) return;
    const p = prop(sel.value); if (!p) return;
    const h = mortgageSeries(p.id), hasHist = h.some(r => r.net != null) && h.some(r => r.loan != null);
    if (!hasHist) { const out = html(p); if (out) body.innerHTML = out; }
    removeRateTrends(document.getElementById('v-mortgage'));
  }

  /* ---------- remove the "Interest-rate trends by property" section ---------- */
  const RATES_RE = /(interest-rate trends by property|12-month lender-rate trend|current recorded rate|Blue uses property-specific rates|RBA cash)/i;
  function removeRateTrends(root) {
    if (!root || !root.querySelectorAll) return false;
    let H = null;
    for (const el of root.querySelectorAll('*')) { if ((el.children || []).length === 0 && /interest-rate trends by property/i.test(el.textContent || '')) { H = el; break; } }
    if (!H) return false;
    let top = H;
    while (top.parentElement && top.parentElement !== root && top.parentElement.id !== 'mgBody') top = top.parentElement;
    let n = top, removed = 0;
    while (n) { const nx = n.nextElementSibling; if (RATES_RE.test(n.textContent || '')) { n.remove(); removed++; n = nx; } else break; }
    return removed > 0;
  }

  let t = null, obs = null;
  const later = () => { clearTimeout(t); t = setTimeout(() => { try { removeRateTrends(document.getElementById('v-mortgage')); } catch (e) { warn('trim', e); } }, 150); };
  function start() { const root = document.getElementById('v-mortgage'); if (root && !obs && typeof MutationObserver !== 'undefined') { obs = new MutationObserver(later); obs.observe(root, { childList: true, subtree: true }); } }
  try { const o = renderMortgage; renderMortgage = function () { o.apply(this, arguments); try { paint(); start(); } catch (e) { warn('paint', e); } }; } catch (e) { warn('renderMortgage', e); }
  g().PortalLoanAnalytics = { version: '1.0', model, rateSvg, removeRateTrends };
})();
