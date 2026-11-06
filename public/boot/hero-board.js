/* The landing page's sample board: drag a card (mouse, pen or touch) to another column, or focus it and
   press ← / →. Each move adds an entry to the audit-trail strip, sealed to the entry before it with
   SHA-256 the way the real audit trail is. Example data only: nothing is saved or sent. */
(function () {
  var board = document.getElementById('px-board');
  var list = document.getElementById('px-trail');
  if (!board || !list) return;
  var cols = Array.prototype.slice.call(board.querySelectorAll('.px-col'));
  var seq = Number(board.getAttribute('data-next-seq')) || 1;
  var prevHash = '4be09c1e';
  var KEEP = 4;

  function counts() { cols.forEach(function (c) { var n = c.querySelectorAll('.px-card').length; c.querySelector('.px-count').textContent = n; }); }
  counts();

  // ── audit-trail entries ──
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function fnv(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  function seal(text, done) {
    var input = prevHash + '\n' + text;
    try {
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)).then(function (b) { done(hex(b)); }, function () { done(fnv(input) + fnv(input + '1')); });
    } catch (e) { done(fnv(input) + fnv(input + '1')); }
  }
  function log(card, from, to) {
    var name = card.getAttribute('data-name');
    var signed = to === 'Signed off';
    var n = seq++;
    var li = document.createElement('li');
    li.className = 'px-new';
    var what = document.createElement('span'); what.className = 'px-what';
    var b = document.createElement('b'); b.textContent = name;
    what.append(signed ? 'signed off ' : 'moved ', b, signed ? ' (' + card.querySelector('.px-pn').textContent.split('· ').pop() + ')' : ': ' + from + ' → ' + to);
    var s1 = document.createElement('span'); s1.className = 'px-seq'; s1.textContent = '#' + n;
    var s2 = document.createElement('span'); s2.className = 'px-who'; s2.textContent = 'You';
    var s3 = document.createElement('span'); s3.className = 'px-hash'; s3.textContent = '…';
    li.append(s1, s2, what, s3);
    list.insertBefore(li, list.firstChild);
    while (list.children.length > KEEP) list.removeChild(list.lastChild);
    seal(n + '|' + name + '|' + from + '|' + to, function (h) { prevHash = h; s3.textContent = h.slice(0, 4) + '…' + h.slice(-4); });
    setTimeout(function () { li.classList.remove('px-new'); }, 1200);
  }
  function place(card, col, before) {
    var from = card.closest('.px-col'); if (!from) return;
    if (before) col.insertBefore(card, before); else col.appendChild(card);
    card.classList.toggle('px-signed', col.getAttribute('data-col') === 'Signed off');
    var meta = card.querySelector('.px-meta');
    if (meta) meta.lastChild.textContent = ' ' + (col.getAttribute('data-col') === 'Signed off' ? 'Signed' : meta.getAttribute('data-hours'));
    counts();
    if (from !== col) log(card, from.getAttribute('data-col'), col.getAttribute('data-col'));
  }
  // keep each card's hours, so a card moved out of Signed off gets them back
  board.querySelectorAll('.px-meta').forEach(function (m) { var i = m.querySelector('i'); var t = m.textContent.replace(i ? i.textContent : '', '').trim(); if (t !== 'Signed') m.setAttribute('data-hours', t); else m.setAttribute('data-hours', '2 h'); });

  // ── keyboard: ← / → move the focused card one column ──
  board.addEventListener('keydown', function (e) {
    var card = e.target.closest && e.target.closest('.px-card');
    if (!card || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    var i = cols.indexOf(card.closest('.px-col')) + (e.key === 'ArrowRight' ? 1 : -1);
    if (i < 0 || i >= cols.length) return;
    e.preventDefault(); place(card, cols[i], null); card.focus();
  });

  // ── pointer drag ──
  var drag = null;
  function colAt(x, y) { var el = document.elementFromPoint(x, y); return el && el.closest ? el.closest('.px-col') : null; }
  function beforeAt(col, y) {
    var cards = Array.prototype.slice.call(col.querySelectorAll('.px-card:not(.px-lift)'));
    for (var i = 0; i < cards.length; i++) { var r = cards[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return cards[i]; }
    return null;
  }
  board.addEventListener('pointerdown', function (e) {
    var card = e.target.closest && e.target.closest('.px-card');
    if (!card || e.button !== 0) return;
    var r = card.getBoundingClientRect();
    drag = { card: card, id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, ghost: null, over: null };
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.ghost) {
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 5) return;
      var g = drag.card.cloneNode(true); g.className += ' px-ghost-card'; g.removeAttribute('tabindex'); g.style.width = drag.w + 'px';
      document.body.appendChild(g); drag.ghost = g; drag.card.classList.add('px-lift'); board.classList.add('px-dragging');
    }
    e.preventDefault();
    drag.ghost.style.transform = 'translate(' + (e.clientX - drag.dx) + 'px,' + (e.clientY - drag.dy) + 'px) rotate(-1.5deg)';
    var col = colAt(e.clientX, e.clientY);
    if (col !== drag.over) { if (drag.over) drag.over.classList.remove('px-over'); if (col) col.classList.add('px-over'); drag.over = col; }
  }, { passive: false });
  function end(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag; drag = null;
    if (!d.ghost) return;
    var col = e && e.type === 'pointerup' ? colAt(e.clientX, e.clientY) : null;
    if (d.over) d.over.classList.remove('px-over');
    d.ghost.remove(); d.card.classList.remove('px-lift'); board.classList.remove('px-dragging');
    if (col) place(d.card, col, beforeAt(col, e.clientY));
  }
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
})();
