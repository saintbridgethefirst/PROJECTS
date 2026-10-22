/* The site footer, the same on every page (the app's sign-in and home screens, the guide, privacy
   and terms). Plain script, no build step: <footer id="site-footer"></footer> + <script src="footer.js">.
   Its own colours come from the page via CSS variables, with fallbacks. */
(function () {
  var here = location.pathname.replace(/[^/]*$/, '');
  var app = here;
  var LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['zh', '中文（简体）']];
  var cur = 'en'; try { cur = localStorage.getItem('tt_lang') || (navigator.language || 'en').slice(0, 2); } catch (e) { /* private window */ }
  if (!LANGS.some(function (l) { return l[0] === cur; })) cur = 'en';
  var cols = [
    ['Product', [['Live demo', 'https://uni-teamtrack.web.app/demo'], ['How it works', app + 'guide.html'], ['Plans & features', app + 'guide.html#compare'], ['Shortcuts', app + 'guide.html#keys']]],
    ['Help', [['Contact us', 'mailto:rushivibhandik.college@gmail.com?subject=TeamTrack'], ['Report a problem', 'mailto:rushivibhandik.college@gmail.com?subject=TeamTrack%20problem'], ['Privacy policy', app + 'privacy.html'], ['Terms of service', app + 'terms.html']]],
    ['For teams', [['Student societies', app + 'guide.html#tools'], ['Research groups', app + 'guide.html#tools'], ['Roles & permissions', app + 'guide.html#roles'], ['Free for students', app + 'guide.html#plans']]],
  ];
  function h(tag, attrs, kids) {
    var n = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); }); return n;
  }
  function render(el) {
    el.classList.add('site-footer');
    var brand = h('div', { class: 'ftr-brand' }, [
      h('a', { class: 'ftr-logo', href: app || './' }, [h('img', { src: app + 'icons/logo-96.png', alt: '', width: '28', height: '28' }), h('b', { text: 'TeamTrack' })]),
      h('p', { text: 'Plan, track and review your team’s week: tasks, people, parts and budgets in one place.' }),
      h('p', { class: 'ftr-small', text: 'Made in Bristol for student, research and engineering teams.' })]);
    var grid = h('div', { class: 'ftr-cols' }, cols.map(function (c) {
      return h('nav', { 'aria-label': c[0] }, [h('h4', { text: c[0] })].concat(c[1].map(function (l) { return h('a', { href: l[1] }, [document.createTextNode(l[0])]); })));
    }));
    var sel = h('select', { 'aria-label': 'Language', id: 'ftr-lang' }, LANGS.map(function (l) { var o = h('option', { value: l[0], text: l[1] }); if (l[0] === cur) o.selected = true; return o; }));
    sel.addEventListener('change', function () { try { localStorage.setItem('tt_lang', sel.value); } catch (e) { /* */ } location.reload(); });
    var bottom = h('div', { class: 'ftr-bottom' }, [
      h('label', { class: 'ftr-lang' }, [h('span', { 'aria-hidden': 'true', text: '🌐' }), sel]),
      h('span', { class: 'ftr-small', text: '© ' + new Date().getFullYear() + ' TeamTrack · Data stored in London (Google Cloud europe-west2) · UK GDPR' })]);
    el.replaceChildren(h('div', { class: 'ftr-wrap' }, [h('div', { class: 'ftr-top' }, [brand, grid]), bottom]));
  }
  var css = '.site-footer{border-top:1px solid var(--ftr-line,var(--line,var(--border-color,#2d3748)));margin-top:48px;padding:36px 16px 28px;color:var(--ftr-muted,var(--muted,var(--text-muted,#8a94a6)));font-size:14px;background:var(--ftr-bg,transparent)}'
    + '.site-footer .ftr-wrap{max-width:1120px;margin:0 auto}.site-footer .ftr-top{display:grid;grid-template-columns:minmax(220px,1.2fr) 3fr;gap:32px}'
    + '.site-footer .ftr-cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.site-footer h4{margin:0 0 10px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ftr-ink,var(--ink,var(--text-main,inherit)))}'
    + '.site-footer nav a{display:block;padding:4px 0;color:inherit;text-decoration:none}.site-footer nav a:hover{color:var(--ftr-ink,var(--ink,var(--text-main,inherit)));text-decoration:underline}'
    + '.site-footer .ftr-logo{display:inline-flex;align-items:center;gap:8px;color:var(--ftr-ink,var(--ink,var(--text-main,inherit)));text-decoration:none;font-size:17px}.site-footer .ftr-logo img{border-radius:7px}'
    + '.site-footer .ftr-brand{display:block;max-width:340px}.site-footer .ftr-brand>*{display:block}.site-footer .ftr-brand .ftr-logo{display:inline-flex}.site-footer p{margin:10px 0 0;line-height:1.5}.site-footer .ftr-small{font-size:12.5px}'
    + '.site-footer .ftr-bottom{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;justify-content:space-between;margin-top:28px;padding-top:18px;border-top:1px solid var(--ftr-line,var(--line,var(--border-color,#2d3748)))}'
    + '.site-footer .ftr-lang{display:inline-flex;align-items:center;gap:6px}.site-footer select{font:inherit;font-size:13px;padding:5px 8px;border-radius:8px;border:1px solid var(--ftr-line,var(--line,var(--border-color,#2d3748)));background:transparent;color:inherit}'
    + '@media (max-width:760px){.site-footer .ftr-top{grid-template-columns:1fr}.site-footer .ftr-cols{grid-template-columns:repeat(2,minmax(0,1fr))}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  function mount() { document.querySelectorAll('footer#site-footer, footer[data-site-footer]').forEach(render); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.TTFooterMount = mount;
})();
