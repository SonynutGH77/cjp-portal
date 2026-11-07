/* =====================================================================
   CJP Portal add-on v5.1 – Infinity Rapid Repay import
   Loaded after app.js. Adds a "Infinity Rapid Repay" card to Statements
   and an import button to Mortgage analytics.
   - PDF reports downloaded from the Infinity portal (one or many at once)
   - CSV / XLSX month tables (e.g. a tracker export)
   Calculator projections ("could be mortgage-free…", "Estimates only") are rejected.
   ===================================================================== */
'use strict';
(function () {
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const r2 = v => v == null ? null : Math.round(v * 100) / 100;
  const n0 = v => { const n = num(v); return isNaN(n) ? null : n };

  function isCalculator(T) { return /(could be mortgage-free|estimates only|plan comparison|rapid repay(™)? calculator|interest saved|life-of-loan savings)/i.test(T) && !/(closing (loan )?balance|month ending|statement period)/i.test(T) }
  function monthFromName(n) {
    let m = n.match(/(20\d{2})[-_ .](\d{1,2})(?!\d)/); if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2].padStart(2, '0')}`;
    m = n.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s_\-.]*'?(20\d{2}|\d{2})\b/i); if (m) { const y = m[2].length === 2 ? '20' + m[2] : m[2]; return `${y}-${String(MON[m[1].toLowerCase()]).padStart(2, '0')}` }
    return '';
  }
  function parseRapidRepay(text, name) {
    const T = String(text || '').replace(/\s+/g, ' ');
    if (isCalculator(T)) return { skip: 'Calculator projection – not a statement' };
    const f = labels => n0(find(T, labels));
    let loan = f(['closing loan balance', 'loan closing balance', 'home loan balance', 'loan balance', 'closing balance', 'balance owing']);
    let offset = f(['offset (account )?(closing )?balance', 'closing offset', 'offset account', 'offset']);
    let net = f(['net debt', 'net loan position', 'net position', 'net balance']);
    const interest = f(['interest charged', 'total interest charged', 'interest debited', 'interest']);
    if (loan == null && net != null && offset != null) loan = r2(net + offset);
    if (offset == null && loan != null && net != null && loan >= net) offset = r2(loan - net);
    if (net == null && loan != null) net = r2(loan - (offset || 0));
    const d = toISO(find(T, ['month ending', 'period ending', 'statement period.{0,40}?to', 'closing balance (as )?(at|on)', 'balance as at', 'as at'], DATE_RE) || '');
    return { month: d ? d.slice(0, 7) : monthFromName(name || ''), loan, offset, net, interest };
  }

  /* --- PDF statements in Properties folders: treat Rapid Repay statements as loan statements --- */
  const _classify = classify;
  classify = function (t, name) {
    const T = String(t || ''), N = name || '';
    if (/rapid repay|infinity/i.test(T + ' ' + N)) {
      const p = parseRapidRepay(T, N);
      if (p.skip) return { kind: 'info', note: p.skip, fields: {} };
      return { kind: 'loan', note: 'Infinity Rapid Repay statement', fields: { date: p.month ? p.month + '-28' : null, loan: p.loan, offset: p.offset, interest: p.interest, rate: null, repay: null } };
    }
    return _classify(t, name);
  };

  /* --- month upsert that keeps a supplied net debt and interest --- */
  upsertMonth = function (o, id) {
    let r = id ? S.mortgage.find(x => x.id === id) : S.mortgage.find(x => x.propertyId === o.propertyId && x.month === o.month);
    if (!r) { r = { id: uid(), net: null }; S.mortgage.push(r) }
    const loan = o.loan ?? r.loan ?? null, offset = o.offset ?? r.offset ?? null;
    Object.assign(r, o, { loan, offset });
    r.net = loan != null ? r2(loan - (offset || 0)) : (o.net ?? r.net ?? null);
    if (o.interest == null && r.interest == null) delete r.interest;
    return r;
  };

  /* --- import UI --- */
  let rows = [], mode = 'pdf';
  const defaultProp = () => active().find(p => p.type === 'PPOR')?.id || active()[0]?.id || '';
  function rowWarn(r, pid) {
    const w = [];
    if (r.skip) return [r.skip];
    if (!/^\d{4}-\d{2}$/.test(r.month || '')) w.push('Month missing');
    if (r.loan == null && r.net == null) w.push('No loan or net debt found');
    if (r.month && r.month > iso(today()).slice(0, 7)) w.push('Future month');
    const hist = mortgageSeries(pid);
    if (r.month && hist.some(h => h.month === r.month)) w.push('Replaces existing month');
    const prev = hist.filter(h => h.month < r.month && h.net != null).at(-1);
    const n = r.net ?? (r.loan != null ? r.loan - (r.offset || 0) : null);
    if (prev && n != null && Math.abs(n - prev.net) / prev.net > .15) w.push(`Net debt changed >15% from ${fmonth(prev.month)} (${m0(prev.net)})`);
    return w;
  }
  function drawReview() {
    const pid = $('rrProp')?.value || defaultProp();
    $('rrRows').innerHTML = rows.map((r, i) => {
      const w = rowWarn(r, pid), bad = r.skip;
      const inp = (k, step = '0.01') => `<input class="mini" style="width:110px" type="number" step="${step}" value="${r[k] ?? ''}" ${bad ? 'disabled' : ''} onchange="RR.set(${i},'${k}',this.value)">`;
      return `<tr><td><input type="checkbox" ${r.on && !bad ? 'checked' : ''} ${bad ? 'disabled' : ''} onchange="RR.rows[${i}].on=this.checked"></td><td class="sm">${esc(r.src)}${w.length ? `<div class="${bad ? 'red' : 'amber'} sm">⚠ ${w.map(esc).join(' · ')}</div>` : ''}</td><td><input type="month" value="${r.month || ''}" ${bad ? 'disabled' : ''} onchange="RR.set(${i},'month',this.value)" style="width:140px"></td><td>${inp('loan')}</td><td>${inp('offset')}</td><td class="num">${bad ? '' : m0(r.loan != null ? r.loan - (r.offset || 0) : r.net)}</td><td>${inp('interest')}</td></tr>`;
    }).join('');
    $('rrCount').textContent = `${rows.filter(r => r.on && !r.skip).length} of ${rows.length} selected`;
  }
  function openReview(title, note) {
    const p = prop(defaultProp());
    modal(`<h2>🏦 ${esc(title)}</h2>${note ? `<div class="note">${note}</div>` : ''}
      <div class="form2"><div><label>Loan / property</label><select id="rrProp" onchange="RR.draw()">${propOpts(defaultProp(), true)}</select></div><div><label>&nbsp;</label><span class="muted sm" id="rrCount"></span></div></div>
      <div style="overflow-x:auto;margin-top:10px"><table class="stack"><thead><tr><th></th><th>Source</th><th>Month</th><th>Loan balance</th><th>Offset</th><th class="num">Net debt</th><th>Interest</th></tr></thead><tbody id="rrRows"></tbody></table></div>
      ${mode === 'pdf' ? `<label class="chk" style="margin-top:12px"><input type="checkbox" id="rrSave" checked> Save the PDFs to <code id="rrDest"></code> in SharePoint</label>` : ''}
      <label class="chk"><input type="checkbox" id="rrUpd" checked> Update the property's current loan &amp; offset from the latest month</label>
      <div class="row end" style="margin-top:14px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="RR.commit()">Import selected</button></div>`);
    const dest = () => { const q = prop($('rrProp').value); if ($('rrDest')) $('rrDest').textContent = `Properties/${q?.folder || q?.name || ''}/Rapid Repay/` };
    $('rrProp').addEventListener('change', dest); dest(); drawReview();
  }
  async function fromPdfs(files) {
    mode = 'pdf'; rows = [];
    modal(`<h2>Reading Rapid Repay reports…</h2><div class="muted" id="rrProg"></div>`);
    for (const f of files) {
      $('rrProg').textContent = f.name;
      let p; try { p = parseRapidRepay(await pdfText(f), f.name) } catch (e) { p = { skip: 'Could not read PDF: ' + e.message } }
      if (!p.skip && (p.loan == null && p.net == null)) p.skip = p.skip || null;
      rows.push({ ...p, src: f.name, file: f, on: !p.skip && (p.loan != null || p.net != null) && !!p.month });
    }
    rows.sort((a, b) => (a.month || '').localeCompare(b.month || ''));
    openReview('Import Infinity Rapid Repay reports', 'Check each month against the report before importing. Rows with no figures usually mean the PDF is a scan or a different layout – enter the numbers by hand, or send the extracted text to Copilot to tune the reader.');
  }
  function parseCsv(t) { const out = []; let row = [], cur = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = '' } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = '' } else cur += c } if (cur || row.length) { row.push(cur); out.push(row) } return out }
  async function fromTable(file) {
    mode = 'table';
    const data = /\.xlsx$/i.test(file.name) ? await readXlsxRows(await file.arrayBuffer()) : parseCsv(await file.text());
    const hi = data.findIndex(r => r && r.some(v => /month|date/i.test(String(v ?? ''))) && r.some(v => /loan|net debt/i.test(String(v ?? ''))));
    if (hi < 0) return toast('No Month / Loan / Net debt columns found');
    const H = data[hi].map(v => String(v ?? '').toLowerCase()), col = re => H.findIndex(h => re.test(h) && !/movement|variance|target/.test(h));
    const c = { m: col(/month|date/), loan: col(/loan balance|^loan/), off: col(/offset/), net: col(/net debt|net position/), int: col(/interest/), q: col(/quality|status|source/) };
    rows = data.slice(hi + 1).map(r => {
      if (!r || r[c.m] == null || r[c.m] === '') return null;
      const d = tbDate(r[c.m]) || toISO(String(r[c.m])); if (!d) return null;
      const g = k => c[k] >= 0 ? n0(r[c[k]]) : null, loan = g('loan'), off = g('off'), net = g('net'), q = c.q >= 0 ? String(r[c.q] ?? '') : '';
      if (loan == null && net == null) return null;
      return { month: d.slice(0, 7), loan, offset: off, net: loan != null ? null : net, interest: g('int'), src: `${file.name}${q ? ' · ' + q : ''}`, on: !/missing|partial|estimate/i.test(q) };
    }).filter(Boolean);
    if (!rows.length) return toast('No usable rows found');
    openReview('Import Rapid Repay months from a table', 'Only tick months you\'ve checked against an actual Rapid Repay or bank statement. Rows marked Missing / Partial are unticked.');
  }
  async function commit() {
    const pid = $('rrProp').value, p = prop(pid), sel = rows.filter(r => r.on && !r.skip && /^\d{4}-\d{2}$/.test(r.month || ''));
    if (!sel.length) return toast('Nothing selected');
    const saveFiles = mode === 'pdf' && $('rrSave')?.checked, folder = p.folder || p.name, dir = `${P_PROPS}/${folder}/Rapid Repay`;
    let saved = 0, skippedFiles = 0;
    for (const r of sel) {
      let docKey = '';
      if (saveFiles && r.file) {
        docKey = `${dir}/${r.file.name}`;
        try { if (await Store.etagOf(docKey)) skippedFiles++; else { await Store.writeBlob(docKey, r.file); saved++ } } catch (e) { if (e.auth) return needSignIn(e.message); toast('Could not save ' + r.file.name + ': ' + e.message) }
        S.documents[docKey] = { status: 'imported', kind: 'loan', propertyId: pid, summary: `Rapid Repay ${r.month}: loan ${m0(r.loan)} / offset ${m0(r.offset)}`, at: iso(today()), by: 'you' };
      }
      upsertMonth({ propertyId: pid, month: r.month, loan: r.loan, offset: r.offset, net: r.net, interest: r.interest, source: 'Infinity Rapid Repay · ' + (r.file ? r.file.name : r.src) });
    }
    if (saveFiles && !p.folder) { p.folder = folder; log('Property folder linked', `${p.name} → Properties/${folder}`, { ref: pid }) }
    const last = sel.slice().sort((a, b) => a.month.localeCompare(b.month)).at(-1);
    if ($('rrUpd').checked && p.loans[0] && (!mortgageSeries(pid).some(h => h.month > last.month))) { if (last.loan != null) p.loans[0].balance = last.loan; if (last.offset != null) p.loans[0].offset = last.offset }
    log('Rapid Repay imported', `${p.name}: ${sel.length} month(s) ${sel[0].month} – ${last.month}${saveFiles ? ` · ${saved} PDF(s) saved${skippedFiles ? `, ${skippedFiles} already there` : ''}` : ''}`, { ref: pid });
    closeModal(); save(); toast(`${sel.length} month(s) imported`);
    if (window._scan) runScan(true);
  }
  window.RR = { get rows() { return rows }, draw: drawReview, commit, set(i, k, v) { rows[i][k] = k === 'month' ? v : (v === '' ? null : +v); if (k === 'loan' || k === 'offset') rows[i].net = null; drawReview() }, pdf: fs => fs && fs.length && fromPdfs([...fs]), table: fs => fs && fs[0] && fromTable(fs[0]).catch(e => toast(e.message)) };

  /* --- add the UI --- */
  function inject() {
    const host = $('scanOut')?.closest('.card');
    if (host && !$('rrCard')) host.insertAdjacentHTML('beforebegin', `<div class="card" id="rrCard" style="margin-bottom:16px"><div class="row sp"><h2 style="margin:0">🏦 Infinity Rapid Repay</h2><div class="row"><label class="btn primary" style="margin:0;text-transform:none;letter-spacing:0;font-size:14px;color:#fff">Import reports (PDF)<input type="file" id="rrPdf" accept=".pdf,application/pdf" multiple hidden onchange="RR.pdf(this.files);this.value=''"></label><label class="btn" style="margin:0;text-transform:none;letter-spacing:0;font-size:14px;color:var(--text)">Import table (CSV/XLSX)<input type="file" id="rrTable" accept=".csv,.xlsx" hidden onchange="RR.table(this.files);this.value=''"></label></div></div><div class="muted sm" style="margin-top:8px">Download the monthly Rapid Repay reports from the Infinity portal and select them here (several at once is fine). Each month's loan balance, offset and net debt goes into <b>Mortgage analytics</b>, and the PDFs are filed in the property's <code>Rapid Repay</code> folder. Calculator projections are ignored. Re-importing a month replaces it.</div></div>`);
    const mh = document.querySelector('#v-mortgage header.top .row');
    if (mh && !$('rrMgBtn')) mh.insertAdjacentHTML('beforeend', `<label class="btn" id="rrMgBtn" style="margin:0;text-transform:none;letter-spacing:0;font-size:14px;color:var(--text)">🏦 Import Rapid Repay<input type="file" accept=".pdf,application/pdf" multiple hidden onchange="RR.pdf(this.files);this.value=''"></label>`);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject); else inject();
  window.parseRapidRepay = parseRapidRepay;
})();
