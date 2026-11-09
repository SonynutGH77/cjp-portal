/* CJP Portal - billsplus.js v1.0 (add-on, works with app.js v6.5.x)
   Three additions to the Bills page:
   1. PAID TAB THAT WORKS. In app.js, paying a recurring bill only moves its due date forward and records a transaction; nothing is marked paid, so the Paid tab only
      ever listed one-off bills. The Paid tab (and the bottom of the All tab) now lists: one-off bills marked Paid, every recurring payment you make from now on (recorded
      with the due date it was for), bills marked paid in bulk, and earlier payments already recorded as "Bill payment" transactions.
   2. MARK OLD BILLS PAID (button on the Bills page). Pick a cut-off date (default: the 1st of last month) and the portal lists every bill due before it. Recurring bills are
      recorded as paid for each missed due date and their next due date moves to the first one on or after the cut-off; one-off bills are closed. It does NOT create bank
      transactions or change spending, budgets or cash flow. Bills marked "Needs checking" are listed but start unticked. One-click undo for the last bulk change.
   3. PAY PERIOD VIEW (card at the top of the Bills page). Set your pay day (default the 15th) and see what your bills come to in each pay period (15th to the 14th),
      with paid / still to pay / needs checking, a category breakdown, the bills in date order, and previous / next period buttons. Past periods use what has been recorded
      as paid; later payments are projected from each bill's due date and repeat setting and are labelled "projected". Bills with no amount are counted but not added up.
   New data saved with your portal: S.billHistory, S.billBatches, S.settings.payDay. Nothing else in app.js is edited. Safe to remove. */
(() => {
  'use strict';
  const warn = (what, e) => { try { console.warn('billsplus.js: ' + what, e); } catch (x) { } };
  const g = () => (typeof window !== 'undefined' ? window : globalThis);
  const FREQS = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'annual'];
  const MAXK = 1200;
  const r2 = n => Math.round(n * 100) / 100;
  const el = id => document.getElementById(id);

  /* ================= pure logic (tested separately) ================= */
  // k-th occurrence after an anchor date. Month-based repeats keep the original day of the month (clamped to short months) instead of drifting.
  function nth(anchor, freq, k) {
    if (!k || !FREQS.includes(freq)) return anchor;
    const d = pd(anchor);
    if (freq === 'weekly') d.setDate(d.getDate() + 7 * k);
    else if (freq === 'fortnightly') d.setDate(d.getDate() + 14 * k);
    else {
      const day = d.getDate(), months = freq === 'monthly' ? k : freq === 'quarterly' ? 3 * k : 12 * k;
      d.setDate(1); d.setMonth(d.getMonth() + months);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    }
    return iso(d);
  }
  // pay period containing today (off = 0), or n periods before / after. payDay is 1-28.
  function period(payDay, off, todayISO) {
    const t = pd(todayISO); let m = t.getMonth() - (t.getDate() < payDay ? 1 : 0) + (off || 0);
    const y = t.getFullYear();
    return { start: iso(new Date(y, m, payDay)), end: iso(new Date(y, m + 1, payDay - 1)), next: iso(new Date(y, m + 1, payDay)) };
  }
  function occ(b, start, end) {
    const a = b.dueDate; if (!a) return [];
    if (!FREQS.includes(b.freq)) return a >= start && a <= end ? [a] : [];
    const out = [];
    for (let k = 0; k < MAXK; k++) { const d = nth(a, b.freq, k); if (d > end) break; if (d >= start) out.push(d); }
    return out;
  }
  // every bill that is recorded as paid, from every source, without double counting
  function paidRecords(St) {
    const out = [], bills = St.bills || [], hist = St.billHistory || [];
    bills.filter(b => b.status === 'paid').forEach(b => out.push({ src: 'bill', id: b.id, name: b.name, biller: b.biller || '', category: b.category, propertyId: b.propertyId || '', amount: b.amount, dueDate: b.dueDate || '', paidDate: '', freq: b.freq, how: 'status' }));
    const histTx = new Set();
    hist.forEach(h => { if (h.txId) histTx.add(h.txId); out.push({ src: 'hist', id: h.id, name: h.name, biller: h.biller || '', category: h.category, propertyId: h.propertyId || '', amount: h.amount, dueDate: h.dueDate || '', paidDate: h.paidDate || '', freq: h.freq, how: h.source }); });
    const onceDone = bills.filter(b => b.status === 'paid' && b.freq === 'once');
    (St.transactions || []).filter(t => t.source === 'Bill payment' && !histTx.has(t.id)).forEach(t => {
      const amt = Math.abs(+t.amount || 0);
      if (onceDone.some(b => String(t.desc || '').startsWith(b.name || '\u0000') && Math.abs(amt - (+b.amount || 0)) < 0.01)) return;   // already shown as a paid one-off bill
      out.push({ src: 'tx', id: t.id, name: t.desc || 'Bill payment', biller: '', category: t.category, propertyId: t.propertyId || '', amount: amt, dueDate: t.date, paidDate: t.date, freq: '', how: 'payment' });
    });
    return out;
  }
  // everything falling inside one pay period
  function periodItems(St, P, o, nowISO) {
    o = o || {};
    const keep = x => (o.prop === 'none' ? !x.propertyId : (!o.prop || o.prop === 'all') ? true : x.propertyId === o.prop) && (o.loans !== false || x.category !== 'Mortgage & Loans');
    const items = [], seen = new Set();
    (St.billHistory || []).forEach(h => seen.add(h.billId + '|' + h.dueDate));
    paidRecords(St).forEach(r => { if (r.dueDate && r.dueDate >= P.start && r.dueDate <= P.end && keep(r)) items.push({ date: r.dueDate, name: r.name, category: r.category, propertyId: r.propertyId, amount: r.amount, state: 'paid', src: r.src, freq: r.freq }); });
    (St.bills || []).forEach(b => {
      if (!b.dueDate || !keep(b)) return;
      occ(b, P.start, P.end).forEach(d => {
        if (seen.has(b.id + '|' + d)) return;
        const first = d === b.dueDate;
        if (b.status === 'paid' && first) return;                      // counted above as a paid record
        const state = b.status === 'verify' ? 'check' : 'due';
        items.push({ date: d, name: b.name, category: b.category, propertyId: b.propertyId, amount: b.amount, state, overdue: state === 'due' && d < nowISO, projected: !first && b.freq !== 'once' && d >= nowISO, src: 'bill', freq: b.freq, billId: b.id });
      });
    });
    return items.sort((a, b) => a.date.localeCompare(b.date) || String(a.name).localeCompare(String(b.name)));
  }
  function totals(items) {
    let paid = 0, due = 0, check = 0, tbc = 0;
    items.forEach(i => { if (i.amount == null) { tbc++; return; } if (i.state === 'paid') paid += i.amount; else if (i.state === 'check') check += i.amount; else due += i.amount; });
    return { paid: r2(paid), due: r2(due), check: r2(check), tbc, total: r2(paid + due + check), count: items.length };
  }
  /* ---- bulk mark paid ---- */
  function planBulk(St, cutoff) {
    return (St.bills || []).filter(b => b.dueDate && b.dueDate < cutoff && (b.status === 'due' || b.status === 'verify')).map(b => {
      let n = 1;
      if (FREQS.includes(b.freq)) { n = 0; for (let k = 0; k < MAXK; k++) { if (nth(b.dueDate, b.freq, k) < cutoff) n++; else break; } }
      return { bill: b, n, total: b.amount == null ? null : r2(b.amount * n), on: b.status === 'due' };
    }).sort((a, b) => a.bill.dueDate.localeCompare(b.bill.dueDate) || String(a.bill.name).localeCompare(String(b.bill.name)));
  }
  function applyBulk(St, ids, cutoff, nowISO, newId) {
    const batch = { id: newId(), at: nowISO, cutoff, bills: [], payments: 0 };
    St.billHistory = St.billHistory || [];
    planBulk(St, cutoff).filter(x => ids.includes(x.bill.id)).forEach(x => {
      const b = x.bill, prev = { dueDate: b.dueDate, status: b.status };
      if (!FREQS.includes(b.freq)) { b.status = 'paid'; batch.payments++; }
      else {
        const a = b.dueDate; let k = 0;
        for (; k < MAXK; k++) {
          const d = nth(a, b.freq, k); if (d >= cutoff) break;
          if (!St.billHistory.some(h => h.billId === b.id && h.dueDate === d)) St.billHistory.push({ id: newId(), billId: b.id, name: b.name, biller: b.biller || '', category: b.category, propertyId: b.propertyId || '', amount: b.amount, dueDate: d, paidDate: d, freq: b.freq, source: 'bulk', batch: batch.id });
          batch.payments++;
        }
        b.dueDate = nth(a, b.freq, k);
      }
      batch.bills.push({ id: b.id, prev, after: { dueDate: b.dueDate, status: b.status } });
    });
    St.billBatches = (St.billBatches || []).concat(batch).slice(-5);
    return batch;
  }
  function undoBulk(St) {
    const batch = (St.billBatches || []).slice(-1)[0]; if (!batch) return null;
    let restored = 0, skipped = 0; const okIds = new Set();
    batch.bills.forEach(r => {
      const b = (St.bills || []).find(x => x.id === r.id);
      if (!b || b.dueDate !== r.after.dueDate || b.status !== r.after.status) { skipped++; return; }   // changed since: leave it alone
      b.dueDate = r.prev.dueDate; b.status = r.prev.status; okIds.add(r.id); restored++;
    });
    St.billHistory = (St.billHistory || []).filter(h => !(h.batch === batch.id && okIds.has(h.billId)));
    St.billBatches = St.billBatches.slice(0, -1);
    return { restored, skipped, payments: batch.payments };
  }

  /* ================= screen ================= */
  const bp = { off: 0, prop: 'all', loans: true };
  const payDay = () => { const n = Math.round(+((S.settings || {}).payDay)); return n >= 1 && n <= 28 ? n : 15; };
  const pill = i => i.state === 'paid' ? '<span class="pill p-paid">Paid</span>' : i.state === 'check' ? '<span class="pill p-verify">Check</span>' : i.overdue ? '<span class="pill p-over">Overdue</span>' : '<span class="pill p-ok">Due</span>';
  const amt = v => v == null ? '<span class="amber">TBC</span>' : money(v);
  const tile = (label, val, hint, cls) => `<div style="border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px 14px;background:rgba(255,255,255,.04)"><div class="muted sm">${label}</div><div class="${cls || ''}" style="font-size:22px;font-weight:700;margin-top:2px">${val}</div><div class="muted sm" style="margin-top:2px">${hint || '&nbsp;'}</div></div>`;

  function periodCard() {
    const now = iso(today()), D = payDay(), P = period(D, bp.off, now);
    const items = periodItems(S, P, { prop: bp.prop, loans: bp.loans }, now), T = totals(items);
    const cats = {}; items.forEach(i => { if (i.amount != null) { const c = i.category || 'Other'; cats[c] = (cats[c] || 0) + i.amount; } });
    const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const label = bp.off === 0 ? 'This pay period' : bp.off === -1 ? 'Last pay period' : bp.off === 1 ? 'Next pay period' : bp.off < 0 ? `${-bp.off} periods ago` : `${bp.off} periods ahead`;
    const paidDates = paidRecords(S).map(r => r.dueDate).filter(Boolean).sort(), firstPaid = paidDates[0] || '';
    const notes = [];
    if (T.tbc) notes.push(`${T.tbc} bill${T.tbc > 1 ? 's have' : ' has'} no amount yet (TBC), so ${T.tbc > 1 ? 'they are' : 'it is'} listed but not added into the totals.`);
    if (items.some(i => i.projected)) notes.push('Bills marked "projected" are worked out from each bill\u2019s due date and repeat setting; they are not yet due.');
    if (P.end < now && (!firstPaid || P.start < firstPaid)) notes.push(`Paid bills are only recorded from ${firstPaid ? fdate(firstPaid) : 'now'} onwards, so this earlier period can be incomplete.`);
    const propSel = `<select onchange="bpProp(this.value)" style="width:auto"><option value="all" ${bp.prop === 'all' ? 'selected' : ''}>All bills</option><option value="none" ${bp.prop === 'none' ? 'selected' : ''}>Personal (no property)</option>${S.properties.map(p => `<option value="${esc(p.id)}" ${bp.prop === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
    const rows = items.map(i => `<tr><td class="nowrap">${fdate(i.date)}</td><td><b>${esc(i.name)}</b>${i.projected ? '<div class="muted sm">projected</div>' : ''}</td><td>${esc(i.category || '')}</td><td>${esc(pname(i.propertyId)) || '\u2014'}</td><td class="num"><b>${amt(i.amount)}</b></td><td>${pill(i)}</td></tr>`).join('');
    return `<div class="card" id="bpCard" style="margin-bottom:16px">` +
      `<div class="row sp" style="flex-wrap:wrap;gap:8px"><div><h2 style="margin:0">Bills by pay period</h2><div class="muted sm">Pay day: the ${D}${[, 'st', 'nd', 'rd'][D % 10 > 3 || (D > 10 && D < 14) ? 0 : D % 10] || 'th'} \u00b7 each period runs from pay day to the day before the next one</div></div>` +
      `<div class="row" style="gap:6px;flex-wrap:wrap"><label class="muted sm" style="display:flex;align-items:center;gap:6px">Pay day <input type="number" min="1" max="28" value="${D}" style="width:64px" onchange="bpPay(this.value)"></label>${propSel}</div></div>` +
      `<div class="row sp" style="margin:12px 0;gap:8px"><button class="btn sm" onclick="bpGo(-1)">\u2039 Previous</button><div style="text-align:center"><b style="font-size:17px">${fdate(P.start)} \u2013 ${fdate(P.end)}</b><div class="muted sm">${label}</div></div><div class="row" style="gap:6px">${bp.off !== 0 ? '<button class="btn sm" onclick="bpGo(0)">This period</button>' : ''}<button class="btn sm" onclick="bpGo(1)">Next \u203a</button></div></div>` +
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">${tile('Bills this period', money(T.total), `${T.count} bill${T.count === 1 ? '' : 's'}`)}${tile('Paid', money(T.paid), '', 'green')}${tile('Still to pay', money(T.due), '', T.due > 0 ? 'amber' : '')}${tile('Needs checking', money(T.check), 'not confirmed')}</div>` +
      `<label class="chk" style="margin-top:10px"><input type="checkbox" ${bp.loans ? 'checked' : ''} onchange="bpLoans(this.checked)"> Include loan &amp; mortgage bills</label>` +
      (catRows.length ? `<div style="margin-top:10px">${catRows.map(([c, v]) => `<div class="row sp" style="padding:5px 0;border-top:1px solid rgba(255,255,255,.1)"><span class="muted">${esc(c)}</span><span>${money(v)}</span></div>`).join('')}</div>` : '') +
      (items.length ? `<div style="overflow:auto;margin-top:12px"><table class="stack"><thead><tr><th>Date</th><th>Bill</th><th>Category</th><th>Property</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty" style="margin-top:12px">No bills fall in this pay period.</div>') +
      (notes.length ? `<div class="muted sm" style="margin-top:8px">${notes.join('<br>')}</div>` : '') + `</div>`;
  }

  /* ---- Paid tab ---- */
  const when = r => r.src === 'hist' ? (r.how === 'bulk' ? 'marked paid in bulk' : 'paid ' + fdate(r.paidDate)) : r.src === 'tx' ? 'payment on ' + fdate(r.paidDate) : '';
  function paidRow(r) {
    const btn = r.src === 'bill' ? `<button class="btn sm" onclick="openBill('${esc(r.id)}')">Edit</button>` : r.src === 'hist' ? `<button class="btn sm" onclick="bpRemove('${esc(r.id)}')">Remove</button>` : '';
    return `<tr><td><b>${esc(r.name)}</b><div class="muted sm">${esc(r.biller || '')}${r.biller && when(r) ? ' \u00b7 ' : ''}${when(r)}</div></td><td>${esc(r.category || '')}</td><td>${esc(pname(r.propertyId)) || '\u2014'}</td><td>${fdate(r.dueDate)}</td><td>${(typeof FREQ !== 'undefined' && FREQ[r.freq]) || ''}</td><td class="num"><b>${amt(r.amount)}</b></td><td><span class="pill p-paid">Paid</span></td><td class="nowrap">${btn}</td></tr>`;
  }
  function paidCard(r) {
    const d = r.dueDate ? pd(r.dueDate) : null;
    return `<div class="list-item"><div class="date-chip">${d ? `<b>${d.getDate()}</b><small>${d.toLocaleDateString('en-AU', { month: 'short' })}</small>` : '<b>?</b><small>date</small>'}</div><div class="grow"><b>${esc(r.name)}</b><div class="muted sm">${esc(r.category || '')}${pname(r.propertyId) ? ' \u00b7 ' + esc(pname(r.propertyId)) : ''}${when(r) ? ' \u00b7 ' + when(r) : ''}</div></div><div style="text-align:right"><b>${amt(r.amount)}</b><div><span class="pill p-paid">Paid</span></div></div></div>`;
  }
  function paintPaid(all) {
    const recs = paidRecords(S).sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate)));
    const rows = el('billRows'), cards = el('billCards'); if (!rows || !cards) return;
    if (all) {
      const extra = recs.filter(r => r.src !== 'bill').slice(0, 300);
      if (!extra.length) return;
      rows.insertAdjacentHTML('beforeend', `<tr><td colspan="8" style="padding-top:14px"><b>Paid recurring bills (${extra.length}${recs.filter(r => r.src !== 'bill').length > 300 ? ', latest 300' : ''})</b></td></tr>` + extra.map(paidRow).join(''));
      cards.insertAdjacentHTML('beforeend', `<div class="muted sm" style="margin:12px 0 4px"><b>Paid recurring bills (${extra.length})</b></div>` + extra.map(paidCard).join(''));
      return;
    }
    const empty = '<tr><td colspan="8" class="empty">Nothing here yet. Bills you pay from now on, and bills marked paid in bulk, are listed here.</td></tr>';
    rows.innerHTML = recs.length ? recs.slice(0, 500).map(paidRow).join('') : empty;
    cards.innerHTML = recs.length ? recs.slice(0, 500).map(paidCard).join('') : '<div class="empty">Nothing here yet.</div>';
  }
  g().bpRemove = id => { if (!confirm('Remove this paid record? The bill\u2019s next due date is not changed.')) return; S.billHistory = (S.billHistory || []).filter(h => h.id !== id); save(); };

  /* ---- toolbar buttons + pay period controls ---- */
  function toolbar() {
    const row = document.querySelector('#v-bills header.top .row'); if (!row) return;
    if (!el('bpBulkBtn')) row.insertAdjacentHTML('afterbegin', '<button class="btn" id="bpBulkBtn" onclick="bpBulk()">\u2713 Mark old bills paid</button>');
    const u = el('bpUndoBtn'), has = (S.billBatches || []).length;
    if (has && !u) row.insertAdjacentHTML('afterbegin', `<button class="btn" id="bpUndoBtn" onclick="bpUndo()">\u21A9 Undo last bulk</button>`);
    if (!has && u) u.remove();
  }
  g().bpGo = d => { bp.off = d === 0 ? 0 : bp.off + d; renderBills(); };
  g().bpProp = v => { bp.prop = v; renderBills(); };
  g().bpLoans = c => { bp.loans = !!c; renderBills(); };
  g().bpPay = v => { const n = Math.max(1, Math.min(28, Math.round(+v) || 15)); S.settings.payDay = n; bp.off = 0; log('Pay day set', 'Day ' + n); save(); };

  /* ---- bulk mark paid ---- */
  const firstOfLastMonth = () => { const t = today(); return iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)); };
  function bulkDraw() {
    const cut = (el('bpCut') || {}).value || firstOfLastMonth(), plan = planBulk(S, cut), box = el('bpBulkList'); if (!box) return;
    box.innerHTML = plan.length
      ? `<div style="overflow:auto;max-height:46vh"><table class="stack"><thead><tr><th></th><th>Bill</th><th>Category</th><th>Due</th><th>Repeats</th><th class="num">Payments</th><th class="num">Total</th></tr></thead><tbody>${plan.map(x => { const b = x.bill; return `<tr><td><input type="checkbox" data-bp="${esc(b.id)}" data-n="${x.n}" data-t="${x.total == null ? '' : x.total}" ${x.on ? 'checked' : ''} onchange="bpBulkSum()"></td><td><b>${esc(b.name)}</b>${b.status === 'verify' ? '<div class="amber sm">Needs checking \u2013 tick to include</div>' : ''}<div class="muted sm">${esc(pname(b.propertyId))}</div></td><td>${esc(b.category || '')}</td><td class="nowrap">${fdate(b.dueDate)}</td><td>${(typeof FREQ !== 'undefined' && FREQ[b.freq]) || ''}</td><td class="num">${x.n}</td><td class="num">${x.total == null ? '<span class="amber">TBC</span>' : money(x.total)}</td></tr>`; }).join('')}</tbody></table></div>`
      : '<div class="empty">No unpaid bills are due before that date.</div>';
    bulkSum();
  }
  function bulkSum() {
    const on = [...document.querySelectorAll('#bpBulkList input[data-bp]:checked')], n = on.reduce((a, c) => a + (+c.dataset.n || 0), 0), t = on.reduce((a, c) => a + (+c.dataset.t || 0), 0);
    const s = el('bpSum'), go = el('bpGo'); if (s) s.textContent = on.length ? `${on.length} bill${on.length > 1 ? 's' : ''} selected \u00b7 ${n} payment${n === 1 ? '' : 's'} recorded as paid \u00b7 ${money(t)} in total (bills with no amount are not added up)` : 'Nothing selected';
    if (go) go.disabled = !on.length;
  }
  g().bpBulkSum = bulkSum; g().bpBulkDraw = bulkDraw;
  g().bpBulk = () => {
    modal(`<h2>Mark old bills as paid</h2><p class="muted">Every unpaid bill due <b>before</b> the date below is listed. Recurring bills are recorded as paid for each missed due date and their next due date moves to the first one on or after that date; one-off bills are closed. This does <b>not</b> add bank transactions or change your spending, budgets or cash flow. You can undo it straight afterwards.</p>` +
      `<label>Mark bills due before</label><input type="date" id="bpCut" value="${firstOfLastMonth()}" onchange="bpBulkDraw()"><div id="bpBulkList" style="margin-top:12px"></div><div class="muted sm" id="bpSum" style="margin-top:8px"></div>` +
      `<div class="row end" style="margin-top:16px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="bpGo">Mark as paid</button></div>`);
    bulkDraw();
    el('bpGo').onclick = () => {
      const cut = el('bpCut').value, ids = [...document.querySelectorAll('#bpBulkList input[data-bp]:checked')].map(c => c.dataset.bp);
      if (!cut || !ids.length) return;
      try { const b = applyBulk(S, ids, cut, iso(today()), uid); log('Bills marked paid in bulk', `${ids.length} bill(s), ${b.payments} payment(s) before ${cut}`); closeModal(); save(); toast(`${ids.length} bills marked paid (${b.payments} payments). Use "Undo last bulk" if that was a mistake.`); }
      catch (e) { toast('Could not mark bills paid: ' + e.message); }
    };
  };
  g().bpUndo = () => {
    const b = (S.billBatches || []).slice(-1)[0]; if (!b) return;
    if (!confirm(`Undo the bulk change from ${fdate(String(b.at).slice(0, 10))}? ${b.bills.length} bill${b.bills.length > 1 ? 's' : ''} go back to their earlier due date and status. Bills you have edited or paid since are left as they are.`)) return;
    const r = undoBulk(S); if (!r) return;
    log('Bulk mark-paid undone', `${r.restored} restored${r.skipped ? `, ${r.skipped} left as they were (changed since)` : ''}`); save(); toast(`${r.restored} bill${r.restored === 1 ? '' : 's'} restored${r.skipped ? `, ${r.skipped} left alone because they changed since` : ''}`);
  };

  /* ---- hooks into app.js ---- */
  function paint() {
    if (typeof S === 'undefined' || !S || !el('billTabs')) return;
    toolbar();
    if (billFilter === 'paid') paintPaid(false); else if (billFilter === 'all') paintPaid(true);
    const old = el('bpCard'); if (old) old.remove();
    el('billTabs').insertAdjacentHTML('beforebegin', periodCard());
  }
  try { const o = renderBills; renderBills = function () { o.apply(this, arguments); try { paint(); } catch (e) { warn('paint', e); } }; } catch (e) { warn('renderBills', e); }
  // remember WHICH due date a recurring payment was for
  try {
    const op = payBill;
    payBill = function (id) {
      op.apply(this, arguments);
      try {
        const b = S.bills.find(x => x.id === id), go = el('pGo'); if (!b || !go || !FREQS.includes(b.freq)) return;
        const orig = go.onclick; if (!orig) return;
        go.onclick = function () {
          const due = b.dueDate || null, a = +el('pAmt').value || 0, paid = el('pDate').value || iso(today()), n0 = S.transactions.length, r = orig.apply(this, arguments);
          try {
            const t = S.transactions.slice(n0).find(x => x.source === 'Bill payment');
            (S.billHistory = S.billHistory || []).push({ id: uid(), billId: b.id, name: b.name, biller: b.biller || '', category: b.category, propertyId: b.propertyId || '', amount: a, dueDate: due || paid, paidDate: paid, freq: b.freq, source: 'paid', txId: t ? t.id : '' });
            if (typeof renderAll === 'function') renderAll();
          } catch (e) { warn('history', e); }
          return r;
        };
      } catch (e) { warn('payBill hook', e); }
    };
  } catch (e) { warn('payBill', e); }
  g().PortalBills = { version: '1.0', nth, period, occ, paidRecords, periodItems, totals, planBulk, applyBulk, undoBulk };
})();
