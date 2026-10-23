// ─────────────────────────────────────────────────────────────────────────────
//  Resizable people column. Drag the right edge of a person's name on the board
//  to make the column narrower or wider; double-click the edge to reset it.
//  Narrower than NARROW, the names hide and only the faces stay (the name shows
//  on hover), so the tasks get the room. Remembered on this device.
// ─────────────────────────────────────────────────────────────────────────────
const KEY = 'tt_w_person';
const MIN = 64, MAX = 340, NARROW = 112, EDGE = 7;
const wide = () => window.matchMedia('(min-width: 761px)').matches;

function apply(px) {
  const root = document.documentElement;
  if (!px || !wide()) { root.style.removeProperty('--w-person'); document.body.classList.remove('people-narrow'); return; }
  root.style.setProperty('--w-person', px + 'px');
  document.body.classList.toggle('people-narrow', px < NARROW);
}
const saved = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch (e) { return 0; } };
const save = (px) => { try { if (px) localStorage.setItem(KEY, String(px)); else localStorage.removeItem(KEY); } catch (e) { /* private window */ } };
const redraw = () => { if (window.drawLines) window.drawLines(); if (window.boardClipLines) window.boardClipLines(); };

export function initColumnResize() {
  apply(saved());
  window.matchMedia('(min-width: 761px)').addEventListener('change', () => apply(saved()));
  const onEdge = (e) => { const n = e.target.closest && e.target.closest('.node-person'); if (!n || !wide()) return null; const r = n.getBoundingClientRect(); return e.clientX >= r.right - EDGE && e.clientX <= r.right + 2 ? n : null; };
  let justDragged = false;
  document.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const n = e.target.closest && e.target.closest('.node-person');
    if (n) n.classList.toggle('edge-hover', !!onEdge(e));
  }, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    const n = onEdge(e); if (!n || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = n.getBoundingClientRect().width; let moved = false;
    document.body.classList.add('col-resizing');
    const mv = (ev) => { const w = Math.round(Math.max(MIN, Math.min(MAX, w0 + ev.clientX - x0))); if (Math.abs(ev.clientX - x0) > 2) moved = true; apply(w); };
    const up = () => {
      document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
      document.body.classList.remove('col-resizing');
      if (moved) { save(Math.round(n.getBoundingClientRect().width)); justDragged = true; setTimeout(() => { justDragged = false; }, 50); }
      redraw();
    };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  }, true);
  // A drag shouldn't also open the person's menu.
  document.addEventListener('click', (e) => { if (justDragged && e.target.closest && e.target.closest('.node-person')) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('dblclick', (e) => { if (onEdge(e)) { e.stopPropagation(); e.preventDefault(); save(0); apply(0); redraw(); } }, true);
}
