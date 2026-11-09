/* CJP Portal - dashboardodc.js v1.0 (add-on, works with app.js v6.5.x)
   Adds an "ODC goal tracking" bar chart to the Dashboard: how much net debt (loan minus offset) fell in each month,
   against your monthly target (same target as the progress message; change it with "Edit target" there).
   - Each bar = net debt at the previous month-end minus net debt at this month-end, from the monthly history in Mortgage analytics.
     For June 2024 this equals Infinity's figure (-$288: net debt $272,442 to $272,730). It has NOT been shown to equal Infinity's ODC
     for every month - Infinity's monthly ODC figures add up to about $21,000 more than the fall in its own net-debt line - so bars
     can differ from the Infinity dashboard.
   - Green = target met, amber = reduced but under target, red = net debt went up.
   - A month is only drawn when the month before it is also on record. Missing months are left blank, never guessed.
   Display only: it changes no data. Safe to remove. */
(() => {
  'use strict';
  const DEFAULT_TARGET = 3391;
  const MAX_BARS = 24;
  const warn = (what, e) => { try { console.warn('dashboardodc.js: ' + what, e); } catch (x) { } };
  const mBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  const addM = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };

  /* ---------- pure model (tested separately) ----------
     series: [{month:'YYYY-MM', net:number}], T: monthly target.
     Returns every calendar month from the first to the last on record; odc is null where it cannot be worked out. */
  function bars(series, T) {
    const s = (series || []).filter(r => r && r.net != null && /^\d{4}-\d{2}$/.test(r.month || '')).slice().sort((a, b) => a.month.localeCompare(b.month));
    if (s.length < 2) return { bars: [], have: s.length };
    const by = {}; s.forEach(r => { by[r.month] = r.net; });
    const first = s[0].month, last = s[s.length - 1].month, all = [];
    for (let m = first, n = mBetween(first, last), i = 0; i <= n; i++, m = addM(first, i)) {
      const prev = by[addM(m, -1)], cur = by[m];
      const odc = (cur != null && prev != null) ? Math.round((prev - cur) * 100) / 100 : null;
      all.push({ month: m, odc, status: odc == null ? 'gap' : odc >= T ? 'hit' : odc > 0 ? 'short' : 'up' });
    }
    const shown = all.slice(-MAX_BARS), known = shown.filter(b => b.odc != null);
    return {
      bars: shown, have: s.length, T,
      hits: known.filter(b => b.status === 'hit').length, n: known.length, gaps: shown.length - known.length,
      avg: known.length ? Math.round(known.reduce((a, b) => a + b.odc, 0) / known.length) : null,
      truncated: all.length > shown.length
    };
  }

  /* ---------- chart ---------- */
  const COL = { hit: '#2ecc8f', short: '#f5b942', up: '#ff6b6b' };
  function svg(B, fm, mm) {
    const W = 760, H = 270, P = { l: 56, r: 14, t: 16, b: 38 }, T = B.T;
    const v = B.bars.map(b => b.odc).filter(x => x != null);
    // round axis: whole-number steps (1, 2, 2.5, 5 x 10^n) so labels never read "-$0k"
    const lo = Math.min(0, ...v), hi = Math.max(T, ...v), rough = (hi - lo) / 4 || 1, pw = Math.pow(10, Math.floor(Math.log10(rough)));
    const stp = [1, 2, 2.5, 5, 10].map(k => k * pw).find(k => k >= rough) || pw * 10;
    const mn = lo < 0 ? Math.floor(lo / stp) * stp : 0, mx = Math.ceil(hi / stp) * stp;
    const span = mx - mn || 1, Y = y => P.t + (1 - (y - mn) / span) * (H - P.t - P.b);
    const lab = val => val === 0 ? '$0' : Math.abs(val) >= 1000 ? (val < 0 ? '-' : '') + '$' + (Number.isInteger(Math.abs(val) / 1000) ? Math.abs(val) / 1000 : (Math.abs(val) / 1000).toFixed(1)) + 'k' : mm(val);
    const n = B.bars.length, cw = (W - P.l - P.r) / n, bw = Math.max(4, Math.min(26, cw * 0.66));
    let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" role="img" aria-label="Monthly net-debt reduction against target">`;
    for (let val = mn; val <= mx + stp / 1000; val += stp) { const y = Y(val); g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" class="grid"/><text x="${P.l - 6}" y="${y + 4}" text-anchor="end">${lab(val)}</text>`; }
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="rgba(255,255,255,.35)"/>`;
    const step = Math.ceil(n / 10);
    B.bars.forEach((b, i) => {
      const cx = P.l + cw * i + cw / 2;
      if (b.odc != null) {
        const y0 = Y(0), y1 = Y(b.odc), top = Math.min(y0, y1), h = Math.max(2, Math.abs(y1 - y0));
        const tip = `${fm(b.month)}: ${b.odc < 0 ? '-' : ''}${mm(Math.abs(b.odc))} net debt ${b.odc < 0 ? 'increase' : 'reduction'} (${b.status === 'hit' ? 'target met' : 'target missed'})`;
        g += `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${h}" rx="3" fill="${COL[b.status]}"><title>${tip}</title></rect>`;
      } else {
        g += `<rect x="${cx - bw / 2}" y="${Y(0) - 2}" width="${bw}" height="2" fill="rgba(255,255,255,.25)"><title>${fm(b.month)}: no month before it on record</title></rect>`;
      }
      if (i % step === 0 || i === n - 1) g += `<text x="${cx}" y="${H - 14}" text-anchor="middle">${fm(b.month)}</text>`;
    });
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(T)}" y2="${Y(T)}" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="6 4" opacity=".85"/>`;
    return g + '</svg>';
  }

  /* ---------- the card ---------- */
  function pickProperty() {
    const ids = [...new Set(S.mortgage.map(r => r.propertyId))].filter(id => prop(id) && !prop(id).sold);
    const ok = id => mortgageSeries(id).filter(r => r.net != null).length;
    return ids.filter(id => prop(id).type === 'PPOR' && ok(id)).concat(ids.filter(id => ok(id)))[0] || '';
  }
  function target() { const v = S.settings && S.settings.debtTarget; return v && +v.monthly > 0 ? +v.monthly : DEFAULT_TARGET; }
  function html() {
    const T = target(), pid = pickProperty(), B = bars(pid ? mortgageSeries(pid) : [], T);
    const head = `<div class="row sp"><h2>ODC goal tracking</h2><button class="btn sm" onclick="go('mortgage')">Analytics \u2192</button></div>`;
    if (!B.bars.length) return `<div class="card" id="odcCard" style="margin-top:16px">${head}<div class="empty">Needs at least two consecutive months of loan history. Import loan statements or Rapid Repay reports and the chart will fill in.</div></div>`;
    const sub = `Monthly net-debt reduction against your ${m0(T)} target \u00b7 ${esc(pname(pid))}`;
    const chips = [`<span class="pill p-paid">${B.hits} of ${B.n} months on target</span>`, B.avg != null ? `<span class="pill">average ${m0(B.avg)} a month</span>` : ''].join(' ');
    const notes = [];
    if (B.gaps) notes.push(`${B.gaps} month${B.gaps > 1 ? 's have' : ' has'} no bar because the month before ${B.gaps > 1 ? 'them is' : 'it is'} not on record.`);
    if (B.n < 6) notes.push('Only a few months are on record. Importing your older Rapid Repay reports or Macquarie loan statements would fill in the history.');
    if (B.truncated) notes.push(`Showing the latest ${MAX_BARS} months.`);
    return `<div class="card" id="odcCard" style="margin-top:16px">${head}<div class="muted sm" style="margin:2px 0 8px">${sub}</div><div style="margin-bottom:8px">${chips}</div>${svg(B, fmonth, m0)}` +
      `<div class="legend"><span><i style="background:${COL.hit}"></i>Target met</span><span><i style="background:${COL.short}"></i>Reduced, under target</span><span><i style="background:${COL.up}"></i>Net debt rose</span><span><i style="background:transparent;border-top:2px dashed #fff;height:0;border-radius:0"></i>Target ${m0(T)}</span></div>` +
      (notes.length ? `<div class="muted sm" style="margin-top:6px">${notes.join('<br>')}</div>` : '') + `</div>`;
  }
  function paint() {
    const k = document.getElementById('kpis'); if (!k || typeof S === 'undefined' || !S) return;
    const old = document.getElementById('odcCard'); if (old) old.remove();
    const anchor = document.getElementById('dlCard') || k;
    anchor.insertAdjacentHTML('afterend', html());
  }
  try { const o = renderDashboard; renderDashboard = function () { o.apply(this, arguments); try { paint(); } catch (e) { warn('card', e); } }; } catch (e) { warn('renderDashboard', e); }
  (typeof window !== 'undefined' ? window : globalThis).PortalDashODC = { version: '1.0', bars, svg, DEFAULT_TARGET };
})();
