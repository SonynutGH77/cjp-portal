/* =====================================================================
   CJP Portal add-on v5.3.1 - Restore ignored documents
   - Shows every ignored SharePoint file on Statements & imports
   - Restore one or restore all
   - Adds confirmation before future ignores
   - Does not move, rename, upload or delete the underlying SharePoint file
   ===================================================================== */
'use strict';
(function () {
  const q = id => document.getElementById(id);
  const safe = s => typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ignored = () => S && S.documents ? Object.entries(S.documents)
    .filter(([, d]) => d && d.status === 'ignored')
    .map(([path, d]) => ({ path, d }))
    .sort((a, b) => a.path.localeCompare(b.path)) : [];

  function kind(path) {
    if (/^Portal\/Bank Statements\//i.test(path)) return ['Bank statement', 'Bank Statements'];
    if (/^Portal\/Infinity Rapid Repay Reports\//i.test(path)) return ['Rapid Repay', 'Infinity Rapid Repay'];
    if (/^Portal\/Timely Bills\//i.test(path)) return ['TimelyBills', 'TimelyBills'];
    if (/^Properties\//i.test(path)) return ['Property document', 'Read & review'];
    return ['Document', 'Statements'];
  }

  async function refreshQueues() {
    try { if (typeof runScan === 'function') await runScan(true) } catch (e) { console.warn('property rescan', e) }
    try { if (window.BI && typeof BI.scan === 'function') await BI.scan() } catch (e) { console.warn('watch-folder rescan', e) }
    render();
  }

  async function restore(path, all) {
    const list = all ? ignored() : ignored().filter(x => x.path === path);
    if (!list.length) return;
    const msg = all
      ? `Restore all ${list.length} ignored document(s)?\n\nThe files stay in SharePoint and will return to the appropriate import queue.`
      : `Restore this document?\n\n${list[0].path}\n\nThe file stays in SharePoint and will return to its import queue.`;
    if (!confirm(msg)) return;
    list.forEach(x => { delete S.documents[x.path] });
    if (typeof log === 'function') log('Ignored documents restored', all ? `${list.length} document(s)` : list[0].path, { actor: 'you' });
    if (typeof saveData === 'function') await saveData(); else if (typeof save === 'function') save();
    await refreshQueues();
    if (typeof toast === 'function') toast(all ? `${list.length} documents restored` : 'Document restored');
  }

  function render() {
    const host = q('ignoredDocs');
    if (!host || typeof S === 'undefined' || !S) return;
    const list = ignored();
    q('ignoredCount').textContent = String(list.length);
    q('restoreAllIgnored').style.display = list.length > 1 ? 'inline-block' : 'none';
    host.innerHTML = list.length ? `<table class="stack"><thead><tr><th>File</th><th>Type</th><th>Ignored</th><th></th></tr></thead><tbody>${list.map(x => {
      const [label, returns] = kind(x.path);
      return `<tr><td><b>${safe(x.path.split('/').at(-1))}</b><div class="muted sm">${safe(x.path)}</div></td><td>${safe(label)}<div class="muted sm">Returns to ${safe(returns)}</div></td><td class="muted sm">${x.d.at ? safe(typeof fdate === 'function' ? fdate(x.d.at) : x.d.at) : '—'}</td><td class="nowrap"><button class="btn sm primary" onclick="IgnoredDocs.restore(decodeURIComponent('${encodeURIComponent(x.path)}'))">Restore</button></td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">No ignored documents.</div>';
  }

  function inject() {
    if (q('ignoredCard')) { render(); return }
    const section = q('v-import');
    if (!section) return;
    const scan = q('scanOut')?.closest('.card');
    if (!scan) return;
    scan.insertAdjacentHTML('beforebegin', `<div class="card" id="ignoredCard" style="margin-bottom:16px">
      <div class="row sp"><h2 style="margin:0">↩ Ignored documents <span class="pill p-verify" id="ignoredCount">0</span></h2><div class="row"><button class="btn sm" id="restoreAllIgnored" onclick="IgnoredDocs.restoreAll()">Restore all</button></div></div>
      <div class="muted sm" style="margin:8px 0 10px">Restore only removes the portal's ignored flag. The original file is not moved, changed or deleted. Restored files return to Bank Statements, Infinity Rapid Repay, TimelyBills or Read & review according to their SharePoint folder.</div>
      <div id="ignoredDocs"></div>
    </div>`);
    render();
  }

  // Confirmation for Property/Read & review Ignore.
  function wrapPropertyIgnore() {
    if (typeof window.ignoreDoc !== 'function' || window.ignoreDoc._confirmed) return;
    const original = window.ignoreDoc;
    const wrapped = function (path) {
      const decoded = decodeURIComponent(path);
      if (!confirm(`Ignore this document?\n\n${decoded}\n\nThe file remains in SharePoint but will not be offered for import again. You can restore it later under Statements > Ignored documents.`)) return;
      return original(path);
    };
    wrapped._confirmed = true;
    window.ignoreDoc = wrapped;
  }

  // Confirmation for Portal watch folders (Bank / Rapid Repay / TimelyBills).
  function wrapWatchIgnore() {
    if (!window.BI || typeof BI.wIgnore !== 'function' || BI.wIgnore._confirmed) return;
    const original = BI.wIgnore;
    const wrapped = function (path) {
      const decoded = decodeURIComponent(path);
      if (!confirm(`Ignore this document?\n\n${decoded}\n\nThe file remains in SharePoint but will not be offered for import again. You can restore it later under Statements > Ignored documents.`)) return;
      const result = original(path);
      setTimeout(render, 0);
      return result;
    };
    wrapped._confirmed = true;
    BI.wIgnore = wrapped;
  }

  window.IgnoredDocs = {
    restore: path => restore(path, false),
    restoreAll: () => restore('', true),
    render,
    get items() { return ignored() }
  };

  function ready() {
    inject(); wrapPropertyIgnore(); wrapWatchIgnore();
    // Keep the card current after navigation or saves.
    if (typeof window.renderAll === 'function' && !window.renderAll._ignoredWrapped) {
      const original = window.renderAll;
      const wrapped = function () { const r = original.apply(this, arguments); inject(); wrapPropertyIgnore(); wrapWatchIgnore(); render(); return r };
      wrapped._ignoredWrapped = true;
      window.renderAll = wrapped;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
