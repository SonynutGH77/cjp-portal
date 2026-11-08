/* Property Portal v6.5.2 - public login privacy cleanup */
(() => {
  'use strict';
  const clean = () => {
    const body = document.getElementById('gateBody');
    const gate = document.getElementById('gate');
    if (!gate || !body || gate.style.display === 'none') return;
    [...body.querySelectorAll('details,summary,p,div,span,a,button')].forEach(el => {
      const text = (el.textContent || '').trim();
      if (/synced folder on this PC|local folder|select synced folder/i.test(text)) {
        (el.closest('details') || el).remove();
      }
    });
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (/CJPInvestments\s+SharePoint|data stays in|sharepoint site/i.test(node.nodeValue || '')) {
        const parent = node.parentElement;
        if (parent) parent.textContent = 'Sign in with your Microsoft account to continue.';
      }
    });
  };
  const start = () => {
    clean();
    const body = document.getElementById('gateBody');
    if (body) new MutationObserver(clean).observe(body, {childList:true, subtree:true, characterData:true});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
