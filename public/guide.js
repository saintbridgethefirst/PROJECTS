// The guide's reading progress, quick-start checklist, board anatomy and right-click playground.
(function () {
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  // Reading progress + active section in the top bar
  var bar = document.getElementById('progress'), links = [].slice.call(document.querySelectorAll('.toc a'));
  var secs = links.map(function (a) { return document.querySelector(a.getAttribute('href')); });
  function onScroll() {
    var h = document.documentElement, max = h.scrollHeight - h.clientHeight;
    bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
    var cur = -1; secs.forEach(function (s, i) { if (s && s.getBoundingClientRect().top < 140) cur = i; });
    links.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
  }
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Quick start checklist
  var steps = [].slice.call(document.querySelectorAll('.step')), KEY = 'tt_guide_steps';
  var done = (store.get(KEY) || '').split(',').filter(Boolean);
  var emoji = ['🌱', '🌿', '🪴', '🌳', '🌳', '🎉'];
  function paint() {
    steps.forEach(function (s) { var on = done.indexOf(s.dataset.step) > -1; s.classList.toggle('done', on); s.setAttribute('aria-pressed', on); });
    document.getElementById('qs-text').textContent = done.length === 5 ? 'All done, nice work!' : done.length + ' of 5 done';
    document.getElementById('qs-fill').style.width = (done.length / 5 * 100) + '%';
    document.getElementById('qs-emoji').textContent = emoji[done.length];
  }
  steps.forEach(function (s) { s.addEventListener('click', function () { var i = done.indexOf(s.dataset.step); if (i > -1) done.splice(i, 1); else done.push(s.dataset.step); store.set(KEY, done.join(',')); paint(); }); });
  paint();

  // Board anatomy: hotspots <-> list
  document.querySelectorAll('.anat [data-hs]').forEach(function (t) { var b = document.createElement('button'); b.type = 'button'; b.className = 'hs'; b.dataset.a = t.dataset.hs; b.textContent = t.dataset.hs; b.setAttribute('aria-label', 'Explain part ' + t.dataset.hs); t.appendChild(b); });
  function pick(n) {
    document.querySelectorAll('.hs, .anat-item').forEach(function (x) { x.classList.toggle('on', x.dataset.a === n); });
  }
  document.querySelectorAll('.hs, .anat-item').forEach(function (x) { x.addEventListener('click', function () { pick(x.dataset.a); }); x.addEventListener('mouseenter', function () { pick(x.dataset.a); }); });
  pick('4');

  // Right-click playground
  var play = document.getElementById('play'), style = store.get('tt_guide_menu') || 'list', open = null, toastT = null;
  var segBtns = [].slice.call(document.querySelectorAll('#menu-style button'));
  function setStyle(s) { style = s; store.set('tt_guide_menu', s); segBtns.forEach(function (b) { b.classList.toggle('on', b.dataset.s === s); }); close(); }
  segBtns.forEach(function (b) { b.addEventListener('click', function () { setStyle(b.dataset.s); }); });
  setStyle(style);
  var items = [['✏️', 'Edit task'], ['✅', 'Mark complete'], ['🧭', 'Set phase'], ['📋', 'Save as template'], ['📅', 'Add to calendar'], ['🗑️', 'Delete']];
  function close() { if (open) { open.remove(); open = null; } play.classList.remove('has-menu'); }
  function say(t) { var old = play.querySelector('.toast'); if (old) old.remove(); var d = document.createElement('div'); d.className = 'toast'; d.textContent = t; play.appendChild(d); clearTimeout(toastT); toastT = setTimeout(function () { d.remove(); }, 1800); }
  function show(x, y) {
    close(); var r = play.getBoundingClientRect(); x -= r.left; y -= r.top;
    var m = document.createElement('div');
    if (style === 'list') {
      m.className = 'menu';
      items.forEach(function (it, i) { if (i === 5) m.appendChild(document.createElement('hr')); var b = document.createElement('button'); b.type = 'button'; b.innerHTML = '<span>' + it[0] + '</span>' + it[1]; b.onclick = function (e) { e.stopPropagation(); close(); say(it[0] + ' ' + it[1] + ': in the real app, that’s done!'); }; m.appendChild(b); });
      play.appendChild(m);
      m.style.left = Math.max(6, Math.min(x, r.width - m.offsetWidth - 6)) + 'px';
      m.style.top = Math.max(6, Math.min(y, r.height - m.offsetHeight - 6)) + 'px';
    } else {
      m.className = 'radial'; m.innerHTML = '<div class="ring"></div><div class="mid"></div>';
      var cx = Math.max(120, Math.min(x, r.width - 120)), cy = Math.max(120, Math.min(y, r.height - 120));
      m.style.left = cx + 'px'; m.style.top = cy + 'px';
      items.forEach(function (it, i) { var a = -Math.PI / 2 + i * (2 * Math.PI / items.length), b = document.createElement('button'); b.type = 'button'; b.style.left = (120 + Math.cos(a) * 84) + 'px'; b.style.top = (120 + Math.sin(a) * 84) + 'px'; b.innerHTML = '<span>' + it[0] + '</span>' + it[1].split(' ')[0]; b.onclick = function (e) { e.stopPropagation(); close(); say(it[0] + ' ' + it[1] + ': in the real app, that’s done!'); }; m.appendChild(b); });
      play.appendChild(m);
    }
    open = m; play.classList.add('has-menu');
  }
  play.addEventListener('contextmenu', function (e) { e.preventDefault(); show(e.clientX, e.clientY); });
  var hold = null;
  play.addEventListener('touchstart', function (e) { var t = e.touches[0]; hold = setTimeout(function () { show(t.clientX, t.clientY); }, 450); }, { passive: true });
  ['touchend', 'touchmove'].forEach(function (ev) { play.addEventListener(ev, function () { clearTimeout(hold); }, { passive: true }); });
  play.addEventListener('click', function (e) { if (open && !open.contains(e.target)) close(); });
  play.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu') { e.preventDefault(); var r = play.getBoundingClientRect(); show(r.left + r.width / 2, r.top + r.height / 2); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });


  // Weeks playground: one start date drives every week; numbering mode; editable metric badges
  var wkStart = document.getElementById('wk-start'), wkStrip = document.getElementById('wk-strip'), wkMode = 'sequence';
  var metrics = ['Hours: 32', 'Budget: £420', 'Flights: 3', 'Words: 2k'];
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addD(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; }
  function isoWeek(d) { var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); var day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 864e5 + 1) / 7); }
  function fmt(d) { return d.getDate() + ' ' + MON[d.getMonth()]; }
  var today = new Date(); today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  var monday = addD(today, -((today.getDay() + 6) % 7) - 7);
  wkStart.value = iso(monday);
  function drawWeeks(animate) {
    var p = wkStart.value.split('-').map(Number); if (p.length !== 3 || !p[0]) return;
    var s0 = new Date(p[0], p[1] - 1, p[2]);
    wkStrip.innerHTML = '';
    for (var i = 0; i < 4; i++) {
      var st = addD(s0, i * 7), en = addD(st, 6), now = today >= st && today <= en;
      var d = document.createElement('div'); d.className = 'wk' + (now ? ' now' : '') + (animate ? ' flip' : '');
      d.innerHTML = '<b>WEEK ' + (wkMode === 'calendar' ? isoWeek(st) : i + 1) + '</b><span class="d">' + fmt(st) + ' – ' + fmt(en) + '</span>' + (now ? '<span class="nowtag">● THIS WEEK</span>' : '');
      var m = document.createElement('span'); m.className = 'metric'; m.contentEditable = 'true'; m.spellcheck = false; m.textContent = metrics[i]; m.setAttribute('aria-label', 'Week ' + (i + 1) + ' metric');
      (function (k) { m.addEventListener('input', function () { metrics[k] = m.textContent.slice(0, 24); }); m.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); m.blur(); } }); })(i);
      d.appendChild(m); wkStrip.appendChild(d);
    }
  }
  wkStart.addEventListener('change', function () { drawWeeks(true); });
  wkStart.addEventListener('input', function () { drawWeeks(true); });
  var wkBtns = [].slice.call(document.querySelectorAll('#wk-mode button'));
  wkBtns.forEach(function (b) { b.addEventListener('click', function () { wkMode = b.dataset.m; wkBtns.forEach(function (x) { x.classList.toggle('on', x === b); }); drawWeeks(true); }); });
  drawWeeks(false);

  // Views tabs
  var tabs = [].slice.call(document.querySelectorAll('#view-tabs button'));
  tabs.forEach(function (t) { t.addEventListener('click', function () {
    tabs.forEach(function (x) { x.classList.toggle('on', x === t); x.setAttribute('aria-selected', x === t); });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('on', v.dataset.v === t.dataset.v); });
  }); });

  // The example editor's tabs
  var edDemo = document.getElementById('ed-demo');
  if (edDemo) [].slice.call(edDemo.querySelectorAll('.etabs button')).forEach(function (b, i, all) {
    b.addEventListener('click', function () {
      all.forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      [].slice.call(edDemo.querySelectorAll('.epane')).forEach(function (p) { p.hidden = p.dataset.p !== b.dataset.p; });
    });
  });

  // Feature search + groups
  var q = document.getElementById('feat-q'), group = 'all', cards = [].slice.call(document.querySelectorAll('.fc'));
  var gBtns = [].slice.call(document.querySelectorAll('#feat-group button'));
  var syn = { money: 'finance budget spending', budget: 'finance', papers: 'literature', people: 'capacity workload', email: 'notifications', meeting: 'meetings', order: 'parts', cost: 'finance parts', hours: 'time capacity' };
  function filter() {
    var words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean), shown = 0;
    cards.forEach(function (c) {
      var text = c.textContent.toLowerCase();
      var hit = words.every(function (w) { return text.indexOf(w) > -1 || (syn[w] && syn[w].split(' ').some(function (s) { return text.indexOf(s) > -1; })); });
      var ok = hit && (group === 'all' || c.dataset.g === group); c.hidden = !ok; if (ok) shown++;
    });
    document.getElementById('feat-empty').style.display = shown ? 'none' : 'block';
  }
  q.addEventListener('input', filter);
  gBtns.forEach(function (b) { b.addEventListener('click', function () { group = b.dataset.g; gBtns.forEach(function (x) { x.classList.toggle('on', x === b); }); filter(); }); });

  // Theme swatches recolour this page
  var sws = [].slice.call(document.querySelectorAll('.sw')), root = document.documentElement;
  sws.forEach(function (s) { s.addEventListener('click', function () {
    sws.forEach(function (x) { x.classList.toggle('on', x === s); });
    root.style.setProperty('--accent', s.dataset.acc); root.style.setProperty('--teal', s.dataset.acc);
    if (s.dataset.mode) root.setAttribute('data-theme', s.dataset.mode); else root.removeAttribute('data-theme');
  }); });
})();
