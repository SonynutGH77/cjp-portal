/* CJP Portal - cashflowexplain.js v1.0 (add-on, works with app.js v6.5.x)
   1. Tap the "Cash flow / mth" tile on any property page to see exactly how it is worked out: the rent counted, each loan repayment, and each
      recurring bill with its monthly equivalent, plus what is left out and why. The lines add up to the tile (it warns if they ever don't).
      The rules are the ones in app.js stats(): cash flow = rent (only if "Rent in cash flow?" is Yes) - recurring bills marked Due (monthly equivalent,
      excluding the Mortgage & Loans category) - loan repayments saved on the property's loans.
   2. If the rent is set but not counted, the breakdown offers a button to count it (the same as Edit > "Rent in cash flow?" = Yes).
   3. Adds an open item to the Tax & accountant readiness list and to the accountant pack when a main residence (PPOR) has rent recorded:
      that rent is NOT in the rental schedule (a PPOR is never treated as a rental), so the accountant needs to be told about it. Wording is neutral:
      it does not say who pays or what the tax treatment is.
   Display only, apart from the confirmed "count rent" button. Safe to remove. */
(() => {
  'use strict';
  const warn = (what, e) => { try { console.warn('cashflowexplain.js: ' + what, e); } catch (x) { } };
  const g = () => (typeof window !== 'undefined' ? window : globalThis);

  /* ---------- pure: every line behind stats(p).cash ---------- */
  function parts(p, bills, meq) {
    const rentSet = +p.rentMonthly || 0, rentCounted = !!p.countRent, rentUsed = rentCounted ? rentSet : 0;
    const loans = (p.loans || []).map(l => {
      const repay = +l.repay || 0, bal = l.balance != null ? +l.balance : null, rate = l.rate != null ? +l.rate : null;
      const interestM = (bal != null && bal > 0 && rate != null) ? Math.round(bal * rate / 1200) : null;
      return { name: l.name || 'Loan', repay, saved: repay > 0, interestM, tooLow: repay > 0 && interestM != null && repay < interestM * 0.8 };
    });
    const repayM = loans.reduce((a, l) => a + l.repay, 0);
    const mine = (bills || []).filter(b => b.propertyId === p.id);
    const isCounted = b => b.status === 'due' && b.category !== 'Mortgage & Loans';
    const counted = mine.filter(isCounted).map(b => ({ name: b.name, freq: b.freq, amount: b.amount || 0, monthly: meq(b) }));
    const left = mine.filter(b => !isCounted(b)).map(b => ({ name: b.name, amount: b.amount, why: b.category === 'Mortgage & Loans' ? 'loan' : b.status === 'verify' ? 'check' : b.status === 'paid' ? 'paid' : 'other' }));
    const billsM = counted.reduce((a, b) => a + b.monthly, 0);
    return { rent: { set: rentSet, counted: rentCounted, used: rentUsed }, loans, repayM, bills: counted, billsM, left, total: rentUsed - billsM - repayM, ppor: p.type === 'PPOR' };
  }

  /* ---------- the breakdown ---------- */
  function html(p, P, tile) {
    const fq = (typeof FREQ !== 'undefined' && FREQ) || {};
    const head = t => `<tr><td colspan="2" class="lbl2" style="padding-top:12px">${t}</td></tr>`;
    const row = (label, sub, val, cls) => `<tr><td>${label}${sub ? `<div class="muted sm">${sub}</div>` : ''}</td><td class="num ${cls || ''}" style="white-space:nowrap">${val}</td></tr>`;
    let t = '';
    // rent
    t += head('Rent');
    if (P.rent.counted && P.rent.set) t += row('Rent per month', 'Counted: "Rent in cash flow?" is Yes', '+' + money(P.rent.used), 'green');
    else if (P.rent.set) t += row('Rent per month', `${money(P.rent.set)} is set on the property, but "Rent in cash flow?" is No, so <b>$0 is counted</b>. The Rent tile shows this as "Planned".`, money(0), 'amber');
    else t += row('Rent per month', 'No rent is set on this property', money(0));
    // loans
    t += head('Loan repayments (saved on each loan)');
    if (!P.loans.length) t += row('No loans on this property', '', money(0));
    P.loans.forEach(l => {
      const sub = !l.saved ? '<span class="amber">No repayment is saved on this loan, so $0 is counted</span>'
        : l.tooLow ? `<span class="amber">Lower than a month's interest (about ${m0(l.interestM)}). Check this figure under Edit, or fix the loan from its lender letters.</span>` : '';
      t += row(esc(l.name), sub, money(-l.repay), l.tooLow ? 'amber' : '');
    });
    // bills
    t += head('Recurring bills marked Due (monthly equivalent)');
    if (!P.bills.length) t += row('No bills marked Due for this property', '', money(0));
    P.bills.forEach(b => t += row(esc(b.name), b.freq === 'once' ? 'One-off bill: not counted as a monthly cost' : `${esc(fq[b.freq] || b.freq || '')} ${money(b.amount)}${b.freq === 'monthly' ? '' : ', converted to a monthly amount'}`, money(-b.monthly)));
    t += `<tr class="total"><td><b>Cash flow / month</b></td><td class="num ${P.total < 0 ? 'red' : 'green'}" style="white-space:nowrap"><b>${money(P.total)}</b></td></tr>`;
    // what is left out
    const why = { check: 'marked Check: left out until you set it to Due', paid: 'paid one-off', loan: 'loan category: the loan repayment above is used instead', other: 'not marked Due' };
    const left = P.left.length ? `<div class="muted sm" style="margin-top:10px"><b>Left out:</b> ${P.left.map(b => `${esc(b.name)}${b.amount != null ? ' (' + money(b.amount) + ')' : ''} \u2013 ${why[b.why]}`).join('; ')}.</div>` : '';
    const mism = Math.abs(P.total - tile) > 0.5 ? `<div class="note warn" style="margin-top:10px">These lines add to ${money(P.total)} but the tile shows ${money(tile)}. Please tell me, because they should match.</div>` : '';
    const ppor = P.ppor && P.rent.set ? '<div class="muted sm" style="margin-top:8px">This is a cash figure only. It does not decide how any rent is treated for tax; that is for you and your accountant (see Tax &amp; accountant).</div>' : '';
    const btn = P.rent.set && !P.rent.counted
      ? `<div class="note info" style="margin-top:12px">Counting the ${money(P.rent.set)} rent would make cash flow <b>${money(P.total + P.rent.set)}</b> a month. It would also include the rent in the Portfolio rent total and show a rental yield for this property.</div>` : '';
    return `<h2>How cash flow / month is worked out</h2><div class="muted sm">${esc(p.name)} \u00b7 rent \u2212 recurring bills \u2212 loan repayments</div>` +
      `<table class="stack" style="margin-top:6px"><tbody>${t}</tbody></table>${left}${mism}${ppor}${btn}` +
      `<div class="row end" style="margin-top:16px"><button class="btn" onclick="closeModal()">Close</button>${P.rent.set && !P.rent.counted ? '<button class="btn primary" id="cfCount">Count the rent in cash flow</button>' : ''}</div>`;
  }
  g().cfExplain = id => {
    const p = prop(id); if (!p) return;
    const P = parts(p, S.bills, monthlyEq);
    modal(html(p, P, stats(p).cash));
    const b = document.getElementById('cfCount');
    if (b) b.onclick = () => { p.countRent = true; log('Rent counted in cash flow', `${p.name}: ${money(p.rentMonthly)} a month`, { ref: p.id }); closeModal(); save(); toast('Rent is now counted in cash flow'); };
  };

  /* ---------- make the tile tappable ---------- */
  function hook() {
    const page = document.getElementById('propPage'); if (!page) return;
    const p = prop(curProp); if (!p || p.sold) return;
    [...page.querySelectorAll('.kpi')].forEach(k => {
      const l = k.querySelector('.lbl'); if (!l || !/^cash flow/i.test(l.textContent.trim())) return;
      k.style.cursor = 'pointer'; k.setAttribute('title', 'How is this worked out?'); k.setAttribute('onclick', `cfExplain('${esc(p.id)}')`);
      const h = k.querySelector('.hint'); if (h && !/tap for the breakdown/.test(h.textContent)) h.textContent = h.textContent + ' \u00b7 tap for the breakdown';
    });
  }
  try { const o = renderPropPage; renderPropPage = function () { o.apply(this, arguments); try { hook(); } catch (e) { warn('tile', e); } }; } catch (e) { warn('renderPropPage', e); }

  /* ---------- tax: a main residence with rent recorded ---------- */
  function taxChecks(St, entity, entityFn, fmt) {
    return (St.properties || []).filter(p => !p.sold && p.type === 'PPOR' && (+p.rentMonthly || 0) > 0 && (!entity || entity === 'all' || entityFn(p) === entity)).map(p => ({
      level: 'warn', fix: 'prop', ref: p.id,
      text: `${p.name} (main residence): ${fmt(p.rentMonthly)} a month of rent is recorded against this property. It is not in the rental schedule because the property is your home. Tell your accountant who pays it and what it covers (room only, or board and bills as well), whether it is a family arrangement or a rental, and that part of the home is let (this can affect the CGT main residence exemption).`
    }));
  }
  try {
    const ob = buildTax;
    buildTax = function (fy, entity) { const X = ob.apply(this, arguments); try { X.checks.push(...taxChecks(S, entity, entityOf, m0)); } catch (e) { warn('tax check', e); } return X; };
  } catch (e) { warn('buildTax', e); }

  g().PortalCashFlow = { version: '1.0', parts, html, taxChecks };
})();
