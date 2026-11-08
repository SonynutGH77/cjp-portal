/* Property Portal v6.5.1 - public login privacy overlay */
(() => {
  'use strict';
  const clean = () => {
    const gate = document.getElementById('gate');
    const body = document.getElementById('gateBody');
    if (!gate || !body || gate.style.display === 'none') return;

    // Remove the legacy local/synced-folder fallback and storage disclosure while
    // leaving app.js's Microsoft sign-in button and handlers intact.
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const t = (n.nodeValue || '').trim();
      if (/CJPInvestments\s+SharePoint|data stays in/i.test(t)) {
        const p = n.parentElement;
        if (p) p.textContent = 'Sign in with your Microsoft account to continue.';
      }
    }

    [...body.querySelectorAll('details,summary,p,div,span,a,button')].forEach(el => {
      const t = (el.textContent || '').trim();
      if (/synced folder on this PC|local folder|select synced folder/i.test(t)) {
        const details = el.closest('details');
        (details || el).remove();
      }
    });

    // Sanitize auth errors so implementation/storage details are never exposed.
    [...body.querySelectorAll('*')].forEach(el => {
      if (el.children.length) return;
      const t = (el.textContent || '').trim();
      if (/sign-in check failed|sharepoint|site access|folder access/i.test(t) && !/sign in with microsoft/i.test(t)) {
        el.textContent = "We couldn't sign you in. Your account may not have access to this portal. Try signing in again.";
      }
    });
  };

  const observe = () => {
    clean();
    const body = document.getElementById('gateBody');
    if (!body) return;
    new MutationObserver(clean).observe(body, { childList: true, subtree: true, characterData: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once:true });
  else observe();
})();
