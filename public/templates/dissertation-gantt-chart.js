// The dissertation Gantt chart template: draws the plan for the chosen level and dates.
(function () {
  var PLANS = {"ug":[["Topic and proposal",0,0.1215],["Proposal submitted",0.1215],["Ethics approval",0.0888,0.2009],["Ethics approved",0.2009],["Literature review",0.0514,0.3505],["Methodology",0.2009,0.3505],["Data collection",0.2991,0.5981],["Analysis",0.5514,0.7196],["Writing",0.3505,0.7991],["Full draft to supervisor",0.7991],["Revisions and proofreading",0.7991,0.9486],["Formatting and hand-in",0.9486,1],["Hand in your dissertation",1]],"masters":[["Topic and proposal",0,0.1193],["Proposal submitted",0.1193],["Ethics approval",0.055,0.2018],["Ethics approved",0.2018],["Literature review",0.0459,0.3486],["Methodology",0.2018,0.3486],["Data collection",0.3028,0.5963],["Analysis",0.5505,0.7156],["Writing",0.3486,0.7982],["Full draft to supervisor",0.7982],["Revisions and proofreading",0.7982,0.9541],["Formatting and hand-in",0.9541,1],["Hand in your dissertation",1]],"phd":[["Literature review and research questions",0,0.2502],["Research plan and training",0,0.1498],["Ethics approval",0.08,0.1804],["Ethics approved",0.1804],["Pilot study",0.1498,0.2894],["Upgrade / confirmation review",0.2675,0.3004],["Upgrade / confirmation review",0.3004],["Main studies",0.3004,0.7004],["Annual progress review (year 2)",0.5725],["Annual progress review (year 3)",0.8588],["Papers and conferences",0.4502,0.8502],["Writing up",0.6204,0.88],["Full thesis draft to supervisors",0.88],["Revisions",0.88,0.9945],["Submission",0.9945,1],["Submit your thesis",1],["Viva and corrections",1,1.1365],["Viva",1.0659]]};
  var MONTHS = { ug: 7, masters: 4, phd: 42 };
  var level = 'ug';
  var $ = function (id) { return document.getElementById(id); };
  var DAY = 864e5;
  var iso = function (d) { return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  var parse = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : null; };
  var fmt = function (d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  var addMonths = function (d, n) { var x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
  var monday = function () { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
  function defaults() { var s = monday(); $('g-start').value = iso(s); $('g-end').value = iso(addMonths(s, MONTHS[level])); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function draw() {
    var s = parse($('g-start').value), h = parse($('g-end').value), chart = $('g-chart');
    chart.textContent = '';
    $('g-end-l').textContent = level === 'phd' ? 'Thesis submission' : 'Hand-in date';
    if (!s || !h || h <= s) { $('g-sum').innerHTML = '<span class="warn">Choose a hand-in date after your start date.</span>'; return; }
    var span = (h - s) / DAY, rows = PLANS[level];
    var max = Math.max.apply(null, rows.map(function (r) { return r.length === 3 ? r[2] : r[1]; }));
    var at = function (f) { return new Date(s.getTime() + Math.round(f * span) * DAY); };
    var pct = function (f) { return (100 * f / max).toFixed(2) + '%'; };
    var weeks = Math.round(span / 7);
    $('g-sum').textContent = (level === 'phd' ? Math.round(span / 30.4) + ' months' : weeks + ' weeks') + ' from ' + fmt(s) + ' to ' + fmt(h) + '.' + (level !== 'phd' && weeks < 6 ? ' That’s tight: check your dates.' : '');
    var unit = level === 'phd' ? 30.4 : 7, now = (Date.now() - s) / DAY / span;
    chart.style.setProperty('--wk', (100 * unit / (span * max)).toFixed(3) + '%');
    rows.forEach(function (r) {
      var ms = r.length === 2, nm = el('div', 'nm' + (ms ? ' ms' : ''), (ms ? '◆ ' : '') + r[0]);
      var a = at(r[1]), b = ms ? a : at(r[2]);
      nm.appendChild(el('small', null, ms ? fmt(a) : a.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' – ' + b.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })));
      nm.title = r[0];
      var tr = el('div', 'tr');
      if (ms) { var d = el('span', 'dia'); d.style.left = pct(r[1]); tr.appendChild(d); }
      else { var bar = el('span', 'bar'); bar.style.left = pct(r[1]); bar.style.width = 'calc(' + pct(r[2] - r[1]) + ')'; tr.appendChild(bar); }
      if (now > 0 && now < max) { var n = el('span', 'now'); n.style.left = pct(now); n.title = 'Today'; tr.appendChild(n); }
      chart.appendChild(nm); chart.appendChild(tr);
    });
    var ax = el('div', 'gaxis'); ax.appendChild(el('span', null, fmt(s))); ax.appendChild(el('span', null, fmt(at(max))));
    chart.appendChild(el('div')); chart.appendChild(ax);
    $('g-make').href = '/demo?plan=dissertation&level=' + level + '&start=' + iso(s) + '&handin=' + iso(h);
  }
  document.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      level = b.getAttribute('data-level');
      document.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      var s = parse($('g-start').value) || monday(); $('g-end').value = iso(addMonths(s, MONTHS[level])); draw();
    });
  });
  $('g-start').addEventListener('change', draw); $('g-end').addEventListener('change', draw);
  defaults(); draw();
})();
