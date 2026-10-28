/* The loading screen (index.html #loading): a fun fact or tip after a moment, a new one every few seconds,
   and a Reload button if loading takes much longer than it should. The app reports what it's doing with
   window.ttLoading.stage('Opening your teams…'). An external file, not inline script, for the site's
   security policy. */
(function () {
  var FACTS = [
    ['Did you know?', 'The Gantt chart is named after Henry Gantt, who made it popular in the 1910s.'],
    ['Did you know?', 'Kanban means “signboard” in Japanese. Toyota used cards like these to run its factory lines.'],
    ['Did you know?', 'The first computer “bug” was a real moth, found inside a Harvard computer in 1947.'],
    ['Did you know?', 'NASA lost the Mars Climate Orbiter in 1999 because one team worked in pounds and the other in newtons.'],
    ['Did you know?', 'Parkinson’s law: work expands to fill the time available for it.'],
    ['Did you know?', 'Hofstadter’s law: it always takes longer than you expect, even when you allow for Hofstadter’s law.'],
    ['Did you know?', 'The Pomodoro Technique is named after a tomato-shaped kitchen timer.'],
    ['Did you know?', 'We remember unfinished tasks better than finished ones (the Zeigarnik effect). Writing them down lets your head let go.'],
    ['Did you know?', 'The Apollo guidance computer had about 4 KB of working memory.'],
    ['Did you know?', 'The Eiffel Tower grows up to 15 cm taller on a hot summer day.'],
    ['Did you know?', 'People plan as if everything will go right. Psychologists call it the planning fallacy.'],
    ['Did you know?', 'PERT charts were invented in 1958 for the US Navy’s Polaris missile programme.'],
    ['Did you know?', '“Plans are worthless, but planning is everything.” Dwight D. Eisenhower'],
    ['Tip', 'Press Ctrl+K (⌘K on a Mac) anywhere on a board to search everything.'],
    ['Tip', 'Right-click a task (or long-press it on a phone) for quick actions.'],
    ['Tip', 'Turn on automatic carry-over and unfinished work moves into the new week by itself.']
  ];
  var box = document.getElementById('loading'); if (!box) return;
  var fact = document.getElementById('ld-fact'), kind = document.getElementById('ld-fact-kind'), text = document.getElementById('ld-fact-text');
  var stageEl = document.getElementById('ld-stage'), slow = document.getElementById('ld-slow');
  var i = Math.floor(Math.random() * FACTS.length), t0 = Date.now(), next = t0 + 700;
  function show() { kind.textContent = FACTS[i][0]; text.textContent = FACTS[i][1]; fact.hidden = false; fact.classList.remove('ld-in'); void fact.offsetWidth; fact.classList.add('ld-in'); }
  var timer = setInterval(function () {
    if (box.hidden) { clearInterval(timer); return; }
    var now = Date.now();
    if (now >= next) { if (!fact.hidden) i = (i + 1) % FACTS.length; show(); next = now + 6000; }
    if (now - t0 > 15000 && slow.hidden) slow.hidden = false;
  }, 500);
  // A fresh start: forget the offline copy (service worker and its cache) and load the newest version. Used
  // when the app's own script fails to load (an old page asking for a file a newer release replaced), and
  // by the Reload button. At most once every 30 seconds, so it can never loop.
  function freshStart() {
    try { var last = +sessionStorage.getItem('tt_fresh_at') || 0; if (Date.now() - last < 30000) { slow.hidden = false; return false; } sessionStorage.setItem('tt_fresh_at', String(Date.now())); } catch (e) { /* private window */ }
    stageEl.textContent = 'Getting the newest version…';
    var jobs = [];
    try { if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (e) { /* */ }
    try { if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('tt-') === 0; }).map(function (k) { return caches.delete(k); })); })); } catch (e) { /* */ }
    Promise.all(jobs).then(function () { location.reload(); }, function () { location.reload(); });
    return true;
  }
  addEventListener('error', function (e) {
    var t = e.target; if (box.hidden || !t || t.tagName !== 'SCRIPT') return;
    if (/\/assets\//.test(t.src || '')) freshStart();
  }, true);
  document.getElementById('ld-reload').addEventListener('click', function () { if (!freshStart()) location.reload(); });
  window.ttLoading = { stage: function (t) { if (stageEl && t) stageEl.textContent = t; }, freshStart: freshStart };
})();
