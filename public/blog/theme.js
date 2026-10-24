// Blog theme control: System → Light → Dark, remembered on this device.
// The initial value is applied by a tiny inline script in each page's <head> (no flash);
// this file only handles the toggle button.
(function () {
  var KEY = 'tt_blog_theme';
  var order = ['system', 'light', 'dark'];
  var label = { system: 'Theme: follow device', light: 'Theme: light', dark: 'Theme: dark' };
  function get() { try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; } }
  function apply(mode) {
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    var btn = document.querySelector('.theme-btn');
    if (btn) btn.setAttribute('aria-label', label[mode] || 'Theme');
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.theme-btn'); if (!btn) return;
    var next = order[(order.indexOf(get()) + 1) % order.length];
    try { localStorage.setItem(KEY, next); } catch (e2) { /* private window */ }
    apply(next);
  });
  apply(get());
})();
