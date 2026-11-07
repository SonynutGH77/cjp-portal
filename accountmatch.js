/* =====================================================================
   CJP Portal add-on v5.4 – strict bank-account recognition
   Load AFTER bankimport.js.
   Purpose: exact account number > last 4 > bank/name > filename fallback,
   with ambiguity warnings and remembered corrections.
   ===================================================================== */
'use strict';
(function () {
  const norm = v => String(v || '').replace(/\D/g, '');
  const last4 = v => { const n = norm(v); return n.length >= 4 ? n.slice(-4) : n };
  const textNorm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const accounts = () => { S.settings.bankAccounts ||= []; return S.settings.bankAccounts };

  function migrateAccount(a) {
    a.identifiers ||= {};
    a.match ||= [];
    // Older importer stored last-4/full account identifiers in match[]. Promote them.
    for (const m of a.match) {
      const n = norm(m);
      if (n.length >= 6 && !a.identifiers.accountNumber) a.identifiers.accountNumber = n;
      else if (n.length === 4 && !a.identifiers.last4) a.identifiers.last4 = n;
    }
    if (a.identifiers.accountNumber) a.identifiers.last4 = last4(a.identifiers.accountNumber);
    return a;
  }
  const migrateAll = () => accounts().forEach(migrateAccount);

  function observed(parsed, file) {
    const full = norm(parsed?.acct || parsed?.accountNumber || parsed?.find?.(t => t.acct)?.acct || '');
    return {
      full,
      last4: last4(full),
      bank: textNorm(parsed?.bank || ''),
      accountName: textNorm(parsed?.accName || ''),
      product: textNorm(parsed?.product || ''),
      file: textNorm(file?.name || '')
    };
  }

  function candidates(obs) {
    migrateAll();
    const A = accounts(), exact = obs.full ? A.filter(a => norm(a.identifiers?.accountNumber) === obs.full) : [];
    if (exact.length) return { method: 'exact account number', score: 100, list: exact };
    const l4 = obs.last4 ? A.filter(a => last4(a.identifiers?.accountNumber || a.identifiers?.last4 || '') === obs.last4) : [];
    if (l4.length) return { method: 'last four digits', score: 80, list: l4 };
    const name = A.filter(a => {
      const hay = [obs.bank, obs.accountName, obs.product].filter(Boolean).join(' '), nm = textNorm(a.name);
      return nm && hay && (hay.includes(nm) || nm.split(' ').filter(x => x.length > 2).filter(x => hay.includes(x)).length >= 2);
    });
    if (name.length) return { method: 'bank / account name', score: 50, list: name };
    const file = A.filter(a => {
      const terms = [...(a.match || []), a.name].map(textNorm).filter(x => x.length > 2);
      return terms.some(x => obs.file.includes(x) || x.includes(obs.file));
    });
    return { method: file.length ? 'filename / saved match' : 'no match', score: file.length ? 25 : 0, list: file };
  }

  function match(parsed, file) {
    const obs = observed(parsed, file), c = candidates(obs);
    return { obs, method: c.method, score: c.score, list: c.list, account: c.list.length === 1 ? c.list[0] : null, ambiguous: c.list.length > 1 };
  }
  function masked(o) { return o.full ? `••••${o.last4}` : o.last4 ? `••••${o.last4}` : 'account number not supplied' }
  function propLoan(a) {
    const p = a?.propertyId && prop(a.propertyId), l = p?.loans?.find(x => x.id === a.loanId);
    return [p?.name, l?.name].filter(Boolean).join(' → ') || p?.name || 'Not linked to a property';
  }
  function banner(m) {
    if (m.account) return `<div class="note info" id="amBanner" style="border-left-color:var(--green)"><b>✓ Account recognised</b><br>${esc(m.account.name)} · ${esc(masked(m.obs))}<br><span class="muted sm">${esc(propLoan(m.account))} · Matched by ${esc(m.method)}</span></div>`;
    if (m.ambiguous) return `<div class="note warn" id="amBanner"><b>⚠ Account match is ambiguous</b><br>${esc(masked(m.obs))} matches ${m.list.length} saved accounts by ${esc(m.method)}. Choose the correct account below. The portal will remember the correction.</div>`;
    return `<div class="note" id="amBanner"><b>New / unrecognised account</b><br>${esc([m.obs.bank, m.obs.product, masked(m.obs)].filter(Boolean).join(' · '))}<br><span class="muted sm">Choose an existing account or create one. Its account identifier will be saved for future statements.</span></div>`;
  }

  function remember(a, m) {
    if (!a) return;
    migrateAccount(a);
    if (m.obs.full) { a.identifiers.accountNumber = m.obs.full; a.identifiers.last4 = m.obs.last4; }
    else if (m.obs.last4 && !a.identifiers.last4) a.identifiers.last4 = m.obs.last4;
    if (m.obs.bank) a.identifiers.bank = m.obs.bank;
    if (m.obs.accountName) a.identifiers.accountName = m.obs.accountName;
    if (m.obs.product) a.identifiers.product = m.obs.product;
    const f = m.obs.file; if (f && !a.match.some(x => textNorm(x) === f)) a.match.push(f);
  }

  // BI.parse is already exposed by bankimport.js. Wrap it to capture statement identity.
  const originalParse = BI.parse;
  BI.parse = async function (f) {
    const p = await originalParse(f); p.__accountMatch = match(p, f); return p;
  };

  // The bank importer keeps start() private, so intercept BI.files/wImport via parse metadata and modal after parse.
  let current = null;
  const originalFiles = BI.files;
  BI.files = function (fs) {
    // For manual files, pre-parse just for identity. Then let existing importer do its normal work.
    const list = [...(fs || [])];
    if (list[0]) originalParse(list[0]).then(p => { current = match(p, list[0]); }).catch(() => { current = null });
    const r = originalFiles(fs); setTimeout(enhancePicker, 250); return r;
  };
  const originalWImport = BI.wImport;
  BI.wImport = function (path) { current = null; const r = originalWImport(path); setTimeout(enhancePicker, 550); return r };

  function findPicker() { return document.getElementById('biAcc') }
  function accountOptions(sel) {
    return accounts().map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}${a.identifiers?.last4 ? ' · ••••' + esc(a.identifiers.last4) : ''}${a.propertyId ? ' · ' + esc(pname(a.propertyId)) : ''}</option>`).join('') + '<option value="__new">+ New account…</option>';
  }
  async function inferFromModal() {
    const picker = findPicker(); if (!picker) return;
    const modalText = document.getElementById('modalBody')?.innerText || '';
    const m = modalText.match(/· account\s+([\d ]{4,})/i), full = norm(m?.[1] || '');
    // If parse metadata was not available (SharePoint private start), account number shown in the modal is enough for strict matching.
    if (!current || (!current.obs.full && full)) current = match({ acct: full }, { name: '' });
    current ||= match({}, { name: '' });
  }
  function enhancePicker() {
    const picker = findPicker(); if (!picker || picker.dataset.accountMatch === '1') return;
    inferFromModal();
    const m = current || match({}, { name: '' });
    const selected = m.account?.id || (m.ambiguous ? '' : picker.value === '__new' ? '__new' : picker.value);
    picker.innerHTML = accountOptions(selected || '__new');
    if (m.account) picker.value = m.account.id; else if (m.ambiguous) picker.selectedIndex = -1;
    picker.dataset.accountMatch = '1';
    picker.insertAdjacentHTML('beforebegin', banner(m));
    if (m.ambiguous) { const next = [...document.querySelectorAll('#modalBody button')].find(b => b.textContent.trim() === 'Next'); if (next) next.disabled = true; }
    picker.addEventListener('change', () => {
      const next = [...document.querySelectorAll('#modalBody button')].find(b => b.textContent.trim() === 'Next'); if (next) next.disabled = !picker.value;
      const a = accounts().find(x => x.id === picker.value); if (a) {
        remember(a, m); current = { ...m, account: a, ambiguous: false, method: m.method === 'no match' ? 'your confirmed mapping' : m.method };
        document.getElementById('amBanner').outerHTML = banner(current);
      }
    });
  }

  // Observe modal changes so SharePoint imports are enhanced immediately after private start() renders.
  const obsr = new MutationObserver(() => { if (findPicker()) setTimeout(enhancePicker, 0) });
  if (document.getElementById('modalBody')) obsr.observe(document.getElementById('modalBody'), { childList: true, subtree: true });

  // When Next is clicked, persist identity to the chosen account after existing importer creates/selects it.
  document.addEventListener('click', e => {
    if (e.target?.textContent?.trim() !== 'Next' || !findPicker()) return;
    const chosen = findPicker().value;
    setTimeout(() => {
      const a = chosen === '__new' ? accounts().at(-1) : accounts().find(x => x.id === chosen);
      if (a && current) { remember(a, current); if (typeof save === 'function') save(); }
    }, 100);
  }, true);

  // Enhance Accounts & rules with identifier information after it renders.
  const originalManage = BI.manage;
  BI.manage = function () {
    migrateAll(); const r = originalManage();
    setTimeout(() => {
      const rows = document.querySelectorAll('#modalBody table:first-of-type tr');
      [...rows].forEach((tr, i) => {
        const a = accounts()[i]; if (!a) return;
        const first = tr.querySelector('td'); if (!first || first.querySelector('.am-id')) return;
        first.insertAdjacentHTML('beforeend', `<div class="muted sm am-id">${esc(a.identifiers?.bank || '')}${a.identifiers?.last4 ? ' · account ••••' + esc(a.identifiers.last4) : ''}</div>`);
      });
    }, 0); return r;
  };

  // Normalise old accounts now; saving happens next portal save/action.
  try { migrateAll(); } catch (e) { console.warn('account match migration', e) }
  window.BankAccountMatch = { match, observed, migrateAll };
})();
