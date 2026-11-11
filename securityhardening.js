/* Property Portal v6.5.2 - browser security boundary hardening */
(() => {
  'use strict';
  const ALLOWED = [
    location.origin,
    'https://login.microsoftonline.com',
    'https://graph.microsoft.com',
    // v8 Azure unlock: the vault-key Function. Exact origin only (no wildcard).
    'https://investmentportal-api-h0c9debmaaepc7gp.australiaeast-01.azurewebsites.net'
  ];
  const allowedUrl = value => {
    try {
      const u = new URL(value instanceof Request ? value.url : value, location.href);
      return ALLOWED.includes(u.origin) || u.hostname.endsWith('.sharepoint.com');
    } catch { return false; }
  };
  // Block accidental or injected outbound requests to unapproved origins.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (!allowedUrl(input)) return Promise.reject(new TypeError('Blocked outbound request'));
    return nativeFetch(input, init);
  };
  if (navigator.sendBeacon) {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => allowedUrl(url) ? nativeBeacon(url, data) : false;
  }
  const NativeXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = class SecureXHR extends NativeXHR {
    open(method, url, ...rest) {
      if (!allowedUrl(url)) throw new DOMException('Blocked outbound request', 'SecurityError');
      return super.open(method, url, ...rest);
    }
  };
  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket) window.WebSocket = function(url, protocols) {
    if (!allowedUrl(url)) throw new DOMException('Blocked WebSocket', 'SecurityError');
    return new NativeWebSocket(url, protocols);
  };
  // Refuse embedding even where the static host cannot set frame-ancestors headers.
  if (top !== self) {
    document.documentElement.style.display = 'none';
    try { top.location = self.location.href; } catch {}
  }
  // Prevent reverse-tabnabbing for dynamically generated external links.
  const secureLinks = root => (root || document).querySelectorAll?.('a[target="_blank"]')?.forEach(a => {
    a.rel = 'noopener noreferrer';
  });
  const start = () => {
    secureLinks(document);
    new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => {
      if (n.nodeType === 1) { if (n.matches?.('a[target="_blank"]')) n.rel = 'noopener noreferrer'; secureLinks(n); }
    }))).observe(document.documentElement, {childList:true, subtree:true});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
  Object.defineProperty(window, 'CJP_SECURITY_BUILD', { value:'6.5.2', writable:false, configurable:false });
})();
