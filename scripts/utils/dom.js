(function () {
  const byId = (id) => document.getElementById(id);
  const qs = (selector, scope = document) => scope.querySelector(selector);
  const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));

  window.PedeAquiDom = { byId, qs, qsa, escapeHtml };
})();
