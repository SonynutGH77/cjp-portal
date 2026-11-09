/* CJP Portal - propertyrates.js v1.0 (add-on, load AFTER ratechange.js)
   Puts an "Interest rates" card on EACH property's main screen, built only from that property's own loans:
     - current rate, repayment, balance for every loan on the property
     - the dated rate history saved from rate-change letters (ratechange.js), newest first, with scheduled changes marked
     - the total recorded change over the last 12 months, only when every change in that window has a known previous rate
   Nothing is estimated or copied from another property. A loan with no recorded rate says so, and tells you which letter to import.
   It replaces the short "Rate changes" list that ratechange.js adds under Loans (this card shows the full history instead).
   Display only: no data is changed. Safe to remove. */
(() => {
  'use strict';
  const warn = (what, e) => { try { console.warn('propertyrates.js: ' + what, e); } catch (x) { } };
  const g = () => (typeof window !== 'undefined' ? window : globalThis);
  const pc = n => (n == null || isNaN(n) ? '\u2014' : (Math.round(n * 1000) / 1000) + '%');
  const addMonths = (isoDate, n) => { const d = new Date(isoDate + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

  /* ---------- pure logic (tested separately) ---------- */
  function loanRates(l, todayISO) {
    const evs = (l.rateChanges || []).filter(e => e.rate != null && e.rateDate).slice().sort((a, b) => String(b.rateDate).localeCompare(String(a.rateDate)));
    const inForce = evs.filter(e => e.rateDate <= todayISO), scheduled = evs.filter(e => e.rateDate > todayISO).reverse();
    const last = inForce[0] || null;
    // 12-month movement: only if each change in the window has a known previous rate
    const from = addMonths(todayISO, -12), win = inForce.filter(e => e.rateDate >= from);
    let change = null, complete = true;
    if (win.length) {
      change = 0;
      win.forEach(e => { if (e.oldRate == null) complete = false; else change += e.rate - e.oldRate; });
      change = Math.round(change * 1000) / 1000;
    } else { change = 0; complete = inForce.length > 0; }   // changes exist but none in the last 12 months
    const monthly = (complete && change != null && l.balance != null && l.balance > 0) ? Math.round(l.balance * change / 100 / 12) : null;
    return { current: l.rate != null ? l.rate : (last ? last.rate : null), last, history: evs, scheduled, change: evs.length ? change : null, complete: evs.length ? complete : false, monthly, windowCount: win.length };
  }

  /* ---------- the card ---------- */
  function card(p) {
    const now = iso(today()), loans = p.loans || [];
    if (!loans.length) return `<div class="card" id="prCard"><h2>Interest rates</h2><div class="muted sm">No loan is recorded on this property.</div></div>`;
    const blocks = loans.map(l => {
      const r = loanRates(l, now), name = esc(l.name || 'Loan');
      const head = `<div class="row sp" style="align-items:flex-end"><div><b>${name}</b>${l.acct ? `<div class="muted sm">\u2022\u2022\u2022\u2022${esc(String(l.acct).slice(-4))}</div>` : ''}</div><div style="text-align:right"><div style="font-size:26px;font-weight:700;line-height:1.1">${r.current != null ? pc(r.current) : '\u2014'}</div><div class="muted sm">${r.current != null ? 'current rate' : 'no rate recorded'}</div></div></div>`;
      const facts = [
        ['Repayment / month', l.repay != null ? money(l.repay) : '\u2014'],
        ['Loan balance', l.balance != null ? m0(l.balance) : '\u2014'],
        ['Last rate change', r.last ? `${pc(r.last.oldRate)} \u2192 <b>${pc(r.last.rate)}</b> from ${fdate(r.last.rateDate)}` : '\u2014'],
        ['Change in last 12 months', r.change == null ? '\u2014' : r.complete ? `${r.change > 0 ? '+' : ''}${r.change}%${r.windowCount ? '' : ' (none)'}` : '<span class="amber">History incomplete</span>'],
        ['Indicative added monthly interest', r.monthly != null ? money(r.monthly) : '\u2014']
      ].map(([k, v]) => `<div class="row sp" style="padding:7px 0;border-top:1px solid rgba(255,255,255,.08)"><span class="muted">${k}</span><span>${v}</span></div>`).join('');
      const hist = r.history.length
        ? `<div class="muted sm" style="margin-top:10px">Rate history</div><table class="stack"><tbody>${r.history.map(e => `<tr><td class="nowrap">${fdate(e.rateDate)}</td><td>${e.oldRate != null ? pc(e.oldRate) + ' \u2192 ' : ''}<b>${pc(e.rate)}</b>${e.repay != null ? ` \u00b7 repay ${money(e.repay)} from ${fdate(e.repayDate)}` : ''}${e.rateDate > now ? ' <span class="amber">(scheduled)</span>' : ''}</td></tr>`).join('')}</tbody></table>`
        : `<div class="note warn" style="margin-top:10px">No rate changes saved for this loan. Save the lender's rate-change letter under this property's folder and import it (Statements &amp; imports, then Type = Rate change). Rates from other properties are not used here.</div>`;
      return `<div style="padding:12px 0">${head}${facts}${hist}</div>`;
    }).join('<hr style="border:0;border-top:1px solid rgba(255,255,255,.1)">');
    return `<div class="card" id="prCard"><h2>Interest rates</h2><div class="muted sm" style="margin-bottom:4px">${esc(p.name)} \u00b7 from the loans and rate-change letters saved for this property only</div>${blocks}</div>`;
  }
  function paint() {
    const page = document.getElementById('propPage'); if (!page) return;
    const p = typeof prop === 'function' ? prop(curProp) : null; if (!p) return;
    const old = document.getElementById('prCard'); if (old) old.remove();
    // remove ratechange.js's short list (this card shows the full history)
    [...page.querySelectorAll('h3')].filter(h => h.textContent.trim() === 'Rate changes').forEach(h => {
      let n = h.nextElementSibling; while (n && n.matches && n.matches('div.muted.sm')) { const x = n; n = n.nextElementSibling; x.remove(); } h.remove();
    });
    const h = [...page.querySelectorAll('h2')].find(x => x.textContent.trim() === 'Loans');
    const anchor = h && h.closest ? h.closest('.card') : null;
    const html = card(p);
    if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else page.insertAdjacentHTML('beforeend', html);
  }
  try { const o = renderPropPage; renderPropPage = function () { o.apply(this, arguments); try { paint(); } catch (e) { warn('card', e); } }; } catch (e) { warn('renderPropPage', e); }
  g().PortalPropertyRates = { version: '1.0', loanRates };
})();
