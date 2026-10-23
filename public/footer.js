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
    ['Help', [['Contact us', '#contact'], ['Report a problem', '#report'], ['Security', app + 'security.html'], ['Privacy policy', app + 'privacy.html'], ['Terms of service', app + 'terms.html']]],
    ['For teams', [['Student societies', app + 'guide.html#tools'], ['Research groups', app + 'guide.html#tools'], ['Roles & permissions', app + 'guide.html#roles'], ['Free for students', app + 'guide.html#plans']]],
  ];
  function h(tag, attrs, kids) {
    var n = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); }); return n;
  }
  function render(el) {
    el.classList.add('site-footer');
    var brand = h('div', { class: 'ftr-brand' }, [
      h('a', { class: 'ftr-logo', href: app || './' }, [h('img', { src: app + 'icons/logo-96.png', alt: '', width: '28', height: '28' }), h('b', { text: 'Trawpie' })]),
      h('p', { text: 'Plan, track and review your team’s week: tasks, people, parts and budgets in one place.' }),
      h('p', { class: 'ftr-small', text: 'Technical Research And Welfare for People In Education.' }),
      h('p', { class: 'ftr-small', text: 'Made in Bristol for student, research and engineering teams.' })]);
    var grid = h('div', { class: 'ftr-cols' }, cols.map(function (c) {
      return h('nav', { 'aria-label': c[0] }, [h('h4', { text: c[0] })].concat(c[1].map(function (l) { return h('a', { href: l[1] }, [document.createTextNode(l[0])]); })));
    }));
    var sel = h('select', { 'aria-label': 'Language', id: 'ftr-lang' }, LANGS.map(function (l) { var o = h('option', { value: l[0], text: l[1] }); if (l[0] === cur) o.selected = true; return o; }));
    sel.addEventListener('change', function () { try { localStorage.setItem('tt_lang', sel.value); } catch (e) { /* */ } location.reload(); });
    var bottom = h('div', { class: 'ftr-bottom' }, [
      h('label', { class: 'ftr-lang' }, [h('span', { 'aria-hidden': 'true', text: '🌐' }), sel]),
      h('span', { class: 'ftr-small', text: '© ' + new Date().getFullYear() + ' Trawpie, part of Penteint · Data stored in London (Google Cloud europe-west2) · UK GDPR' })]);
    el.replaceChildren(h('div', { class: 'ftr-wrap' }, [h('div', { class: 'ftr-top' }, [brand, grid]), bottom]));
  }
  var EMAIL = 'rushivibhandik.college@gmail.com';
  // "Contact us" / "Report a problem": the feedback form when signed in to the app, otherwise a small
  // panel with the address (a mailto: link does nothing on a computer with no email app set up).
  function contact(kind, panelOnly) {
    // In the app, the feedback form (it calls back here with panelOnly when nobody is signed in).
    if (!panelOnly && window.TT && TT.openFeedback) { TT.openFeedback(kind === 'report' ? 'bug' : 'question'); return; }
    var old = document.getElementById('ftr-contact'); if (old) old.remove();
    var subject = kind === 'report' ? 'Trawpie: a problem' : 'Trawpie';
    var body = kind === 'report' ? 'What did you do, what did you expect, and what happened instead?\n\nPage: ' + location.href + '\nBrowser: ' + navigator.userAgent + '\n' : '';
    var back = h('div', { id: 'ftr-contact', class: 'ftr-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ftr-contact-title' });
    var addr = h('code', { class: 'ftr-addr', text: EMAIL });
    var copy = h('button', { type: 'button', class: 'ftr-btn', text: 'Copy address' });
    copy.addEventListener('click', function () { try { navigator.clipboard.writeText(EMAIL); copy.textContent = 'Copied'; } catch (e) { copy.textContent = 'Select and copy it'; } });
    var mail = h('a', { class: 'ftr-btn ftr-primary', href: 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body), text: 'Open email app' });
    var close = h('button', { type: 'button', class: 'ftr-x', 'aria-label': 'Close', text: '✕' });
    var box = h('div', { class: 'ftr-box' }, [close,
      h('h3', { id: 'ftr-contact-title', text: kind === 'report' ? 'Report a problem' : 'Contact us' }),
      h('p', { text: kind === 'report' ? 'Email us what you did, what you expected and what happened instead. A screenshot helps. Signed in to Trawpie? The Feedback button in the app sends it straight from there.' : 'Questions, ideas or a team that wants to start: email us and we’ll reply.' }),
      addr, h('div', { class: 'ftr-row' }, [copy, mail])]);
    back.appendChild(box); document.body.appendChild(back);
    var done = function () { back.remove(); document.removeEventListener('keydown', esc); };
    var esc = function (e) { if (e.key === 'Escape') done(); };
    close.addEventListener('click', done); back.addEventListener('click', function (e) { if (e.target === back) done(); }); document.addEventListener('keydown', esc);
    copy.focus();
  }
  window.TTFooterContact = contact;
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.site-footer a[href="#report"], .site-footer a[href="#contact"]'); if (!a) return;
    e.preventDefault(); contact(a.getAttribute('href') === '#report' ? 'report' : 'contact');
  });
  var css = '.site-footer{border-top:1px solid var(--ftr-line,var(--line,var(--border-color,#2d3748)));margin-top:48px;padding:36px 16px 28px;color:var(--ftr-muted,var(--muted,var(--text-muted,#8a94a6)));font-size:14px;background:var(--ftr-bg,transparent)}'
    + '.site-footer .ftr-wrap{max-width:1120px;margin:0 auto}.site-footer .ftr-top{display:grid;grid-template-columns:minmax(220px,1.2fr) 3fr;gap:32px}'
    + '.site-footer .ftr-cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.site-footer h4{margin:0 0 10px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ftr-ink,var(--ink,var(--text-main,inherit)))}'
    + '.site-footer nav a{display:block;padding:4px 0;color:inherit;text-decoration:none}.site-footer nav a:hover{color:var(--ftr-ink,var(--ink,var(--text-main,inherit)));text-decoration:underline}'
    + '.site-footer .ftr-logo{display:inline-flex;align-items:center;gap:8px;color:var(--ftr-ink,var(--ink,var(--text-main,inherit)));text-decoration:none;font-size:17px}.site-footer .ftr-logo img{border-radius:7px}'
    + '.site-footer .ftr-brand{display:block;max-width:340px}.site-footer .ftr-brand>*{display:block}.site-footer .ftr-brand .ftr-logo{display:inline-flex}.site-footer p{margin:10px 0 0;line-height:1.5}.site-footer .ftr-small{font-size:12.5px}'
    + '.site-footer .ftr-bottom{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;justify-content:space-between;margin-top:28px;padding-top:18px;border-top:1px solid var(--ftr-line,var(--line,var(--border-color,#2d3748)))}'
    + '.site-footer .ftr-lang{display:inline-flex;align-items:center;gap:6px}.site-footer select{font:inherit;font-size:13px;padding:5px 8px;border-radius:8px;border:1px solid var(--ftr-line,var(--line,var(--border-color,#2d3748)));background:transparent;color:inherit}'
    + '.ftr-modal{position:fixed;inset:0;z-index:2000;background:rgba(10,15,25,.45);display:grid;place-items:center;padding:16px}'
    + '.ftr-box{position:relative;width:min(420px,100%);background:#fff;color:#0f1729;border-radius:14px;padding:24px;box-shadow:0 30px 70px rgba(0,0,0,.35);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}'
    + '.ftr-box h3{margin:0 0 8px;font-size:19px}.ftr-box p{margin:0 0 14px;color:#56607a}.ftr-addr{display:block;padding:10px 12px;border:1px solid #e3e7ef;border-radius:8px;background:#f7f8fb;font-size:14px;word-break:break-all;user-select:all}'
    + '.ftr-row{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}.ftr-btn{flex:1;display:inline-flex;justify-content:center;align-items:center;min-height:40px;padding:0 14px;border-radius:8px;border:1px solid #d9dde6;background:#fff;color:#0f1729;font:600 14px/1 inherit;cursor:pointer;text-decoration:none}'
    + '.ftr-primary{background:#0f1729;border-color:#0f1729;color:#fff}.ftr-x{position:absolute;right:12px;top:10px;border:0;background:none;font-size:16px;color:#56607a;cursor:pointer;padding:6px}'
    + '@media (max-width:760px){.site-footer .ftr-top{grid-template-columns:1fr}.site-footer .ftr-cols{grid-template-columns:repeat(2,minmax(0,1fr))}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  function mount() { document.querySelectorAll('footer#site-footer, footer[data-site-footer]').forEach(render); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.TTFooterMount = mount;
})();
