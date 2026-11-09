/* CJP Portal - dashboardmentor.js v1.0 (add-on, works with app.js v6.5.x)
   A short progress message at the top of the Dashboard: encouraging when the monthly net-debt target is met,
   plain and direct when it is missed, and honest when there is not enough data to say.
   - Target: monthly net-debt reduction. Default $3,933, the monthly goal in your June 2024 Infinity Rapid Repay report.
     Change it with "Edit target" on the card (saved with your portal data).
   - Net debt = loan balance minus offset, taken from the monthly history in Mortgage analytics for your main residence.
   - It never praises or criticises without data: if the latest month on record is old, or the month-to-month swing looks
     like a data problem, it says so instead of giving a verdict.
   Display only (apart from saving the target you type). Safe to remove. */
(() => {
  'use strict';
  const DEFAULT_TARGET = 3933;
  const warn = (what, e) => { try { console.warn('dashboardmentor.js: ' + what, e); } catch (x) { } };
  const mBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));

  /* ---------- pure logic (tested separately) ----------
     series: [{month:'YYYY-MM', net:number}] sorted oldest -> newest; T: monthly target; nowYM: 'YYYY-MM' */
  function assess(series, T, nowYM) {
    const s = (series || []).filter(r => r && r.net != null && /^\d{4}-\d{2}$/.test(r.month || '')).slice().sort((a, b) => a.month.localeCompare(b.month));
    if (s.length < 2) return { kind: s.length ? 'one' : 'none', last: s[s.length - 1] || null };
    const L = s[s.length - 1], P = s[s.length - 2], gap = mBetween(P.month, L.month);
    const change = P.net - L.net, perMonth = change / gap;
    const staleMonths = mBetween(L.month, nowYM);
    // a swing of more than 25% of net debt in one go is far more likely to be a data problem than real progress
    if (P.net > 0 && Math.abs(change) / P.net > 0.25) return { kind: 'swing', L, P, change, gap, staleMonths };
    // trend: average per month over up to the last 4 records (3 intervals)
    const win = s.slice(-4), span = mBetween(win[0].month, L.month), avg = span > 0 ? (win[0].net - L.net) / span : null;
    // since the first month on record, against what the target would have delivered over the same months
    const F = s[0], totalMonths = mBetween(F.month, L.month), total = F.net - L.net, planned = T * totalMonths;
    const diff = perMonth - T;
    const verdict = perMonth >= T ? 'hit' : perMonth > 0 ? 'short' : 'up';
    return { kind: 'ok', verdict, L, P, gap, change, perMonth, diff, avg, avgN: win.length - 1, total, totalMonths, F, planned, behind: planned - total, staleMonths };
  }

  /* ---------- wording ---------- */
  function words(A, T, name) {
    const mo = m => fmonth(m + '-01'), t = m0(T);
    if (A.kind === 'none') return { tone: 'info', head: 'Your mortgage progress will show here', body: `Import loan statements (Statements \u203a Bank statements, with "Record month-end balances" ticked) and this card will compare your monthly net-debt reduction with your ${t} target.`, basis: '' };
    if (A.kind === 'one') return { tone: 'info', head: 'One month on record so far', body: `${mo(A.last.month)} is the only month recorded. A second month is needed to see how net debt is moving against your ${t} target.`, basis: '' };
    if (A.kind === 'swing') return { tone: 'warn', head: 'Check the latest figures', body: `Net debt moved ${m0(Math.abs(A.change))} between ${mo(A.P.month)} and ${mo(A.L.month)}. That is too big a swing to treat as real progress, so I'm not judging it. It usually means one statement was read incorrectly or a month is missing. Review those months in Mortgage analytics.`, basis: '' };
    const stale = A.staleMonths >= 2 ? ` The latest month on record is ${mo(A.L.month)}, so import the newer statements to see recent progress.` : '';
    const per = A.gap > 1 ? ` (averaged over ${A.gap} months)` : '';
    let head, body;
    if (A.verdict === 'hit') {
      head = `\uD83C\uDF89 Great work${name ? ', ' + name : ''}! Target met`;
      body = `Net debt fell <b>${m0(A.perMonth)}</b> in ${mo(A.L.month)}${per}, <b>${m0(A.diff)}</b> ahead of your ${t} monthly target.`;
    } else if (A.verdict === 'short') {
      head = '\uD83D\uDCCD Target missed this month';
      body = `Net debt fell <b>${m0(A.perMonth)}</b> in ${mo(A.L.month)}${per} against your ${t} target, <b>${m0(-A.diff)}</b> short. It is still moving the right way.`;
    } else {
      head = '\u26A0\uFE0F Target missed this month';
      body = `Net debt <b>rose ${m0(-A.perMonth)}</b> in ${mo(A.L.month)}${per}, so the ${t} target was missed by <b>${m0(-A.diff)}</b>.`;
    }
    const trend = [];
    if (A.avg != null && A.avgN >= 2) trend.push(`Your ${A.avgN}-month average is ${m0(A.avg)} a month, ${A.avg >= T ? `<b>${m0(A.avg - T)} above</b> target` : `<b>${m0(T - A.avg)} below</b> target`}.`);
    if (A.totalMonths >= 2) trend.push(`Since ${mo(A.F.month)}, net debt is down ${m0(A.total)}, which is ${A.behind <= 0 ? `<b>${m0(-A.behind)} ahead of</b>` : `<b>${m0(A.behind)} behind</b>`} what the target would have delivered over those ${A.totalMonths} months.`);
    const tone = A.verdict === 'hit' ? 'good' : A.verdict === 'short' ? 'amber' : 'bad';
    // old data: no cheering or scolding about "now" - say which month this refers to
    if (A.staleMonths >= 2) head = `${mo(A.L.month)} was the latest month recorded: target ${A.verdict === 'hit' ? 'met' : 'missed'}`;
    return { tone, head, body: body + (trend.length ? ' ' + trend.join(' ') : '') + stale, basis: '' };
  }

  /* ---------- the card ---------- */
  function pickProperty() {
    const ids = [...new Set(S.mortgage.map(r => r.propertyId))].filter(id => prop(id) && !prop(id).sold);
    const ok = id => mortgageSeries(id).filter(r => r.net != null).length;
    return ids.filter(id => prop(id).type === 'PPOR' && ok(id)).concat(ids.filter(id => ok(id)))[0] || '';
  }
  function target() { const v = S.settings && S.settings.debtTarget; return v && +v.monthly > 0 ? { v: +v.monthly, own: true } : { v: DEFAULT_TARGET, own: false }; }
  function html() {
    const T = target(), pid = pickProperty(), series = pid ? mortgageSeries(pid) : [];
    const A = assess(series, T.v, iso(today()).slice(0, 7)), W = words(A, T.v, 'CJ');
    const col = { good: 'var(--green)', amber: 'var(--amber)', bad: 'var(--red)', warn: 'var(--amber)', info: 'var(--blue, #5b9dff)' }[W.tone];
    const basis = pid && A.L ? `Based on net debt (loan minus offset) for ${esc(pname(pid))}, last recorded ${esc(fmonth(A.L.month + '-01'))}${A.L && S.mortgage ? '' : ''}. Target ${m0(T.v)} a month${T.own ? '' : ' (from your June 2024 Rapid Repay report)'}.` : `Target ${m0(T.v)} a month${T.own ? '' : ' (from your June 2024 Rapid Repay report)'}.`;
    return `<div class="card" id="dmCard" style="margin-bottom:16px;border-left:4px solid ${col}"><div class="row sp"><b style="font-size:17px">${W.head}</b><button class="btn sm" onclick="dmEdit()">Edit target</button></div><div style="margin-top:6px;line-height:1.5">${W.body}</div><div class="muted sm" style="margin-top:8px">${basis}</div></div>`;
  }
  function paint() {
    const k = document.getElementById('kpis'); if (!k || typeof S === 'undefined' || !S) return;
    const old = document.getElementById('dmCard'); if (old) old.remove();
    k.insertAdjacentHTML('beforebegin', html());
  }
  window.dmEdit = () => {
    const T = target();
    modal(`<h2>Monthly net-debt target</h2><p class="muted">How much you want net debt (loan minus offset) to fall each month. The default of ${m0(DEFAULT_TARGET)} comes from your June 2024 Rapid Repay report; change it if your plan has changed.</p><label>Target per month ($)</label><input id="dmT" type="number" min="0" step="1" value="${T.v}"><div class="row end" style="margin-top:16px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="dmGo">Save</button></div>`);
    document.getElementById('dmGo').onclick = () => {
      const v = +document.getElementById('dmT').value;
      if (!(v > 0)) return toast('Enter a target above zero');
      S.settings.debtTarget = { monthly: v }; log('Net-debt target changed', `Monthly target ${money(v)}`); closeModal(); save();
    };
  };
  try { const o = renderDashboard; renderDashboard = function () { o.apply(this, arguments); try { paint(); } catch (e) { warn('card', e); } }; } catch (e) { warn('renderDashboard', e); }
  (typeof window !== 'undefined' ? window : globalThis).PortalDashMentor = { version: '1.0', assess, words, DEFAULT_TARGET };
})();
