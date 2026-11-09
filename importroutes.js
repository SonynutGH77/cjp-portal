/* CJP Portal - importroutes.js v1.1 (add-on, load AFTER bankimport.js, rapidrepay.js and macquariereports.js)
   Fixes how the "Waiting in SharePoint" list on Statements & imports behaves. Nothing in app.js, bankimport.js or rapidrepay.js is edited.
   1. The list is split into separate groups: Bank statements / Macquarie reports / Infinity Rapid Repay reports / TimelyBills.
   2. Import on a Macquarie report (proof of balance, financial year interest, tax transactions) opens the Macquarie report reader,
      NOT the bank-statement parser - so it no longer says "No transactions found in this PDF layout".
   3. Reports that have already been imported through the Macquarie report reader no longer sit in the waiting list.
   4. After a Rapid Repay import, the file in Portal/Infinity Rapid Repay Reports is marked as imported (it was being copied to the property
      folder but the original stayed "waiting"), so the count stops growing.
   Safe to remove: the old behaviour simply comes back. */
(() => {
  'use strict';
  const REPORT_RE = /interest[-_ ]?report|proof[-_ ]?of[-_ ]?balance|tax[-_ ]?transaction/i;
  const RR_DIR = /Infinity Rapid Repay Reports/i, TB_DIR = /Timely Bills/i;
  const kindOfPath = p => { const n = String(p).split('/').pop(); if (RR_DIR.test(p)) return 'rr'; if (TB_DIR.test(p)) return 'tb'; if (REPORT_RE.test(n)) return 'mq'; return 'bank'; };
  const GROUPS = [
    ['bank', '\uD83C\uDFE6 Bank statements'],
    ['mq', '\uD83D\uDCCA Macquarie reports (proof of balance, interest, tax transactions)'],
    ['rr', '\uD83C\uDFE6 Infinity Rapid Repay reports'],
    ['tb', '\uD83E\uDDFE TimelyBills']
  ];
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const warn = (what, e) => { try { console.warn('importroutes.js: ' + what, e); } catch (x) { } };

  /* ---- 1+2: route Import ---- */
  function hookBI() {
    if (!window.BI || window.BI.__routed) return !!(window.BI && window.BI.__routed);
    const orig = window.BI.wImport;
    window.BI.wImport = function (enc) {
      try {
        const p = decodeURIComponent(enc), name = p.split('/').pop();
        if (kindOfPath(p) === 'mq') {
          if (typeof window.mqReviewPath !== 'function') return toast('The Macquarie report reader is not loaded - upload macquariereports.js v1.1');
          return window.mqReviewPath(p, name);
        }
      } catch (e) { warn('route', e); }
      return orig.apply(this, arguments);
    };
    window.BI.__routed = true; return true;
  }

  /* ---- 4: mark Rapid Repay source files as imported ---- */
  function hookRR() {
    if (!window.RR || window.RR.__wrapped) return !!(window.RR && window.RR.__wrapped);
    const orig = window.RR.commit;
    window.RR.commit = async function () {
      const pidEl = document.getElementById('rrProp'), pid = pidEl ? pidEl.value : '';
      const cand = (window.RR.rows || []).filter(r => r.on && !r.skip && r.file && r.file.__path && /^\d{4}-\d{2}$/.test(r.month || ''))
        .map(r => ({ path: r.file.__path, name: r.file.name, month: r.month }));
      const res = await orig.apply(this, arguments);
      try {
        let n = 0;
        cand.forEach(c => {
          // only mark it once the month really is in Mortgage analytics from this file
          const ok = (S.mortgage || []).some(x => x.propertyId === pid && x.month === c.month && String(x.source || '').includes(c.name));
          if (ok && !S.documents[c.path]) { S.documents[c.path] = { status: 'imported', kind: 'loan', propertyId: pid, summary: 'Rapid Repay ' + c.month, at: iso(today()), by: 'you' }; n++; }
        });
        if (n) { save(); if (typeof renderAll === 'function') renderAll(); }
      } catch (e) { warn('mark imported', e); }
      return res;
    };
    window.RR.__wrapped = true; return true;
  }

  /* ---- 1+3: regroup the waiting list ----
     v1.1: builds the grouped list from bankimport.js's own pending-file data (BI.pendingFiles) instead of re-reading the page,
     and only runs once per redraw (a hidden marker is removed whenever bankimport.js redraws the list). v1.0 re-read its own output and repeated the headings. */
  function build(P, done) {
    const buckets = { bank: [], mq: [], rr: [], tb: [] };
    P.forEach(x => {
      const path = String(x.path || '');
      let k = x.kind === 'rr' ? 'rr' : x.kind === 'tb' ? 'tb' : kindOfPath(path);
      if (k === 'mq' && done[path]) return;                  // already imported through the Macquarie report reader
      buckets[k].push(x);
    });
    const total = GROUPS.reduce((n, [k]) => n + buckets[k].length, 0);
    const row = x => '<tr><td>\uD83D\uDCC4 ' + esc(String(x.path).replace(/^Portal\//, '')) + '<div class="muted sm">' + esc(x.label || '') + (x.modified ? ' \u00b7 ' + new Date(x.modified).toLocaleDateString('en-AU') : '') + '</div></td><td class="nowrap" style="text-align:right"><button class="btn sm primary" onclick="BI.wImport(\'' + encodeURIComponent(x.path) + '\')">Import</button> <button class="btn sm" onclick="BI.wIgnore(\'' + encodeURIComponent(x.path) + '\')">Ignore</button></td></tr>';
    let html = '<span id="wfGrouped" hidden></span><div class="row sp" style="margin-top:12px"><b>\uD83D\uDCC1 Waiting in SharePoint (' + total + ')</b><button class="btn sm" onclick="BI.scan()">\u21BB Check folders</button></div>';
    if (!total) return html + '<div class="muted sm">Nothing new waiting. Macquarie reports already imported are listed in the Macquarie reports card below.</div>';
    GROUPS.forEach(([k, title]) => {
      if (!buckets[k].length) return;
      html += '<div style="margin-top:14px"><b>' + title + ' (' + buckets[k].length + ')</b></div><table class="stack">' + buckets[k].map(row).join('') + '</table>';
    });
    return html;
  }
  function regroup() {
    const el = document.getElementById('wfList'); if (!el) return;
    if (el.querySelector('#wfGrouped')) return;             // already grouped since the last redraw
    if (!window.BI || !Array.isArray(window.BI.pendingFiles)) return;
    if (!el.querySelector('table.stack')) return;           // bankimport.js shows its own "nothing new" message
    el.innerHTML = build(window.BI.pendingFiles, (typeof S !== 'undefined' && S && S.macReports) || {});
  }

  let t = null;
  const later = () => { clearTimeout(t); t = setTimeout(() => { try { hookBI(); hookRR(); regroup(); } catch (e) { warn('regroup', e); } }, 120); };
  function start() {
    later();
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.CJPImportRoutes = { version: '1.1', kindOfPath, regroup, build };
})();
