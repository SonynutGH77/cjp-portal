/* CJP Portal - dashboardnetdebt.js v1.0 (add-on, works with app.js v6.5.x)
   Adds a "Net debt" line chart to the Dashboard, next to the ODC goal tracking chart (the two sit side by side, stacked on a narrow screen).
   - Net debt = loan balance minus offset for each month on record in Mortgage analytics (same data, same chart style as Mortgage analytics).
   - A headline shows the latest net debt and the month it is as at, how far it has fallen since the first month on record, and since 12 months ago.
   - Uses the same property as the progress message (your main residence if it has history).
   - Months with no record are not filled in: the line simply joins the months that exist, and the card says how many months are missing.
   Display only: it changes no data. Safe to remove. */
(() => {
  'use strict';
  const warn = (what, e) => { try { console.warn('dashboardnetdebt.js: ' + what, e); } catch (x) { } };
  const mBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));

  /* ---------- pure model (tested separately) ---------- */
  function model(series) {
    const s = (series || []).filter(r => r && r.net != null && /^\d{4}-\d{2}$/.test(r.month || '')).slice().sort((a, b) => a.month.localeCompare(b.month));
    if (!s.length) return { n: 0 };
    const F = s[0], L = s[s.length - 1], span = mBetween(F.month, L.month) + 1;
    // 12 months ago = the record exactly 12 months before the latest; only used if that month really is on record
    const y = s.find(r => mBetween(r.month, L.month) === 12) || null;
    return {
      n: s.length, F, L, span, missing: span - s.length,
      sinceFirst: Math.round((F.net - L.net) * 100) / 100,
      since12: y ? Math.round((y.net - L.net) * 100) / 100 : null, y,
      pts: s.map(r => ({ x: r.month, y: r.net }))
    };
  }

  function pickProperty() {
    const ids = [...new Set(S.mortgage.map(r => r.propertyId))].filter(id => prop(id) && !prop(id).sold);
    const ok = id => mortgageSeries(id).filter(r => r.net != null).length;
    return ids.filter(id => prop(id).type === 'PPOR' && ok(id)).concat(ids.filter(id => ok(id)))[0] || '';
  }
  function html() {
    const pid = pickProperty(), M = model(pid ? mortgageSeries(pid) : []);
    const head = `<div class="row sp"><h2>Net debt</h2><button class="btn sm" onclick="go('mortgage')">Analytics \u2192</button></div>`;
    if (M.n < 2) return `<div class="card" id="ndCard">${head}<div class="empty">${M.n ? `Only ${fmonth(M.L.month)} is on record.` : 'No loan history yet.'} Import loan statements or Rapid Repay reports and the line will build up.</div></div>`;
    const chg = (v, label) => v == null ? '' : `<span class="pill ${v >= 0 ? 'p-paid' : ''}">${v >= 0 ? '\u2193 ' + m0(v) : '\u2191 ' + m0(-v)} ${label}</span>`;
    const notes = [];
    if (M.missing > 0) notes.push(`${M.missing} month${M.missing > 1 ? 's are' : ' is'} missing between ${fmonth(M.F.month)} and ${fmonth(M.L.month)}; the line joins the months that are on record.`);
    notes.push('Net debt is loan balance minus offset, as recorded for this property in Mortgage analytics. It changes only when you import a newer statement.');
    return `<div class="card" id="ndCard">${head}<div class="muted sm">${esc(pname(pid))}</div>` +
      `<div class="row sp" style="align-items:flex-end;margin:6px 0 8px"><div><div style="font-size:28px;font-weight:700;line-height:1.1">${m0(M.L.net)}</div><div class="muted sm">as of ${esc(fmonth(M.L.month))}</div></div><div style="text-align:right">${chg(M.sinceFirst, 'since ' + fmonth(M.F.month))}${M.since12 != null ? '<br>' + chg(M.since12, 'in 12 months') : ''}</div></div>` +
      lineChart([{ name: 'Net debt (loan \u2212 offset)', color: '#2ecc8f', area: true, pts: M.pts }], { h: 270 }) +
      `<div class="muted sm" style="margin-top:6px">${notes.join('<br>')}</div></div>`;
  }

  /* ---------- placement: side by side with the ODC chart ---------- */
  function paint() {
    const k = document.getElementById('kpis'); if (!k || typeof S === 'undefined' || !S) return;
    ['ndCard', 'ndRow'].forEach(id => { const o = document.getElementById(id); if (o) o.remove(); });
    const odc = document.getElementById('odcCard');
    if (odc) {
      // wrap the existing ODC card and the new net-debt card in one two-column grid (stacks on narrow screens)
      const wrap = document.createElement('div'); wrap.id = 'ndRow'; wrap.className = 'grid c2'; wrap.style.marginTop = '16px';
      odc.parentNode.insertBefore(wrap, odc); odc.style.marginTop = '0'; wrap.appendChild(odc);
      wrap.insertAdjacentHTML('beforeend', html());
      const nd = document.getElementById('ndCard'); if (nd) wrap.insertBefore(nd, odc);   // net debt on the left, ODC goal on the right
    } else {
      const anchor = document.getElementById('dlCard') || k;
      anchor.insertAdjacentHTML('afterend', `<div id="ndRow" style="margin-top:16px">${html()}</div>`);
    }
  }
  const hook = () => { try { const o = renderDashboard; renderDashboard = function () { o.apply(this, arguments); try { paint(); } catch (e) { warn('card', e); } }; } catch (e) { warn('renderDashboard', e); } };
  hook();
  (typeof window !== 'undefined' ? window : globalThis).PortalDashNetDebt = { version: '1.0', model };
})();
