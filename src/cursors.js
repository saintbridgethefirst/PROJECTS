// ─────────────────────────────────────────────────────────────────────────────
//  Live cursors: see where teammates are pointing on the board, with their name,
//  like a shared design file.
//
//  Each person writes one small document, teams/{t}/cursors/{uid}. Positions are
//  stored against what the pointer is over (a task card, a person's row, a week
//  cell…) rather than screen pixels, so they land in the right place on screens
//  of any size, and the same card even lines up between the board and Kanban.
//
//  It's off by default: each person turns it on in the Who's here panel.
//  To keep it cheap we only send while someone else is online, at most a few
//  times a second, and stop as soon as the pointer leaves the board.
// ─────────────────────────────────────────────────────────────────────────────

const SEND_MS = 250;          // at most four updates a second while moving
const STALE_MS = 12000;       // hide a cursor that hasn't moved for this long
const PREF = 'tt_live_cursors';
const COLORS = ['#e8590c', '#2f9e44', '#1c7ed6', '#ae3ec9', '#d6336c', '#0c8599', '#f08c00', '#5f3dc4'];

let st = { getCtx: null, unsub: null, teamId: '', others: new Map(), layer: null, raf: 0, last: 0, pending: null, timer: 0, shown: false, bound: false, sim: 0 };

// Off until each person turns it on (Who's here panel).
export function cursorsOn() { try { return localStorage.getItem(PREF) === 'on'; } catch (e) { return false; } }
export function setCursorsOn(on) {
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch (e) { /* private window: just for this visit */ }
  if (!on) { hideMine(); st.others.clear(); clearInterval(st.sim); st.sim = 0; paint(); return; }
  const ctx = st.getCtx && st.getCtx();
  if (ctx && ctx.TT && ctx.TT.isDemo && !navigator.webdriver && !st.sim) simulate();
}
export const colorFor = (uid) => { let h = 0; for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };

/** Begin for the open team. getCtx() returns the app context. */
export function startCursors(getCtx) {
  stopCursors();
  st.getCtx = getCtx;
  const ctx = getCtx(); if (!ctx || !ctx.session) return;
  st.teamId = ctx.session.teamId;
  const data = ctx.backend && ctx.backend.data;
  if (data && data.watchCursors) {
    try { st.unsub = data.watchCursors(st.teamId, (list) => { receive(list); }, (e) => console.warn('Live cursors', e)); }
    catch (e) { console.warn('Live cursors', e); }
  }
  if (!st.bound) {
    st.bound = true;
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', hideMine);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') hideMine(); });
  }
  // The demo has nobody else in it, so a sample teammate shows what this looks like.
  if (ctx.TT && ctx.TT.isDemo && !navigator.webdriver && cursorsOn()) simulate();
}
export function stopCursors() {
  hideMine();
  if (st.unsub) { try { st.unsub(); } catch (e) { /* already gone */ } }
  st.unsub = null; st.others.clear(); clearInterval(st.sim); st.sim = 0; paint();
}

// ── Sending my pointer ──────────────────────────────────────────────────────
function othersOnline(ctx) {
  const s = ctx.session; if (!s) return false;
  const now = Date.now(), me = ctx.user && ctx.user.uid;
  return (s.presence || []).some(p => p.id !== me && p.at && now - p.at < 5 * 60e3);
}
function region() { return document.getElementById('main-view'); }
function boardShowing() {
  const b = document.getElementById('board-screen');
  return !!b && !b.hidden && !document.querySelector('.modal-overlay');
}

/** Describe the point (x, y) by what it's over, so other screens can find the same spot. */
export function anchorAt(x, y) {
  const r = region(); if (!r) return null;
  const rr = r.getBoundingClientRect();
  if (x < rr.left || x > rr.right || y < rr.top || y > rr.bottom) return null;
  const hit = document.elementFromPoint(x, y); if (!hit || !r.contains(hit)) return null;
  const frac = (node) => { const b = node.getBoundingClientRect(); return { fx: round((x - b.left) / (b.width || 1)), fy: round((y - b.top) / (b.height || 1)) }; };
  const card = hit.closest('.task-card[id]:not([id^="ghost_"]), .kb-card[data-id]');
  if (card) return { a: 't:' + (card.dataset.id || card.id), ...frac(card) };
  const cell = hit.closest('.col-week[data-cat-id][data-week-key]');
  if (cell) return { a: 'c:' + cell.dataset.catId + '|' + cell.dataset.weekKey, ...frac(cell) };
  const person = hit.closest('.node-person[id]');
  if (person) return { a: 'p:' + person.id, ...frac(person) };
  const head = hit.closest('.header-week[data-week-key]');
  if (head) return { a: 'h:' + head.dataset.weekKey, ...frac(head) };
  return { a: 'v:', fx: round((x - rr.left) / rr.width), fy: round((y - rr.top) / rr.height) };
}
const round = (n) => Math.round(Math.max(-0.5, Math.min(1.5, n)) * 1000) / 1000;

function onMove(e) {
  if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
  const ctx = st.getCtx && st.getCtx(); if (!ctx || !ctx.session || !ctx.session.me || !cursorsOn()) return;
  if (!boardShowing() || !othersOnline(ctx)) { hideMine(); return; }
  const at = anchorAt(e.clientX, e.clientY);
  if (!at) { hideMine(); return; }
  st.pending = at;
  const wait = SEND_MS - (Date.now() - st.last);
  if (wait <= 0) flush(); else if (!st.timer) st.timer = setTimeout(flush, wait);
}
function flush() {
  clearTimeout(st.timer); st.timer = 0;
  const ctx = st.getCtx && st.getCtx(); const at = st.pending; st.pending = null;
  if (!ctx || !at || !ctx.backend.data.setCursor) return;
  st.last = Date.now(); st.shown = true;
  const view = (window.boardView && window.boardView()) || 'board';
  ctx.backend.data.setCursor(st.teamId, ctx.user.uid, { at: Date.now(), a: at.a.slice(0, 64), fx: at.fx, fy: at.fy, view, name: String(ctx.user.name || 'Teammate').slice(0, 60) }).catch(() => {});
}
function hideMine() {
  clearTimeout(st.timer); st.timer = 0; st.pending = null;
  if (!st.shown) return; st.shown = false;
  const ctx = st.getCtx && st.getCtx();
  if (ctx && ctx.backend && ctx.backend.data.setCursor && ctx.user) ctx.backend.data.setCursor(st.teamId, ctx.user.uid, { at: 0, a: '', fx: 0, fy: 0, view: '', name: String(ctx.user.name || '').slice(0, 60) }).catch(() => {});
}

// ── Drawing everyone else's ─────────────────────────────────────────────────
function receive(list) {
  const ctx = st.getCtx && st.getCtx(); const me = ctx && ctx.user && ctx.user.uid;
  const seen = new Set();
  (list || []).forEach(c => {
    if (!c || c.id === me) return; seen.add(c.id);
    const o = st.others.get(c.id) || {};
    st.others.set(c.id, { ...o, ...c, got: Date.now() });
  });
  [...st.others.keys()].forEach(k => { if (!seen.has(k) && !String(k).startsWith('sim:')) st.others.delete(k); });
  loop();
}

/** Where on my screen a stored anchor is, or null if that thing isn't showing. */
export function pointFor(c) {
  if (!c || !c.a) return null;
  const [kind, rest] = [c.a.slice(0, 1), c.a.slice(2)];
  let node = null;
  if (kind === 't') { const b = document.getElementById(rest); node = b && b.offsetParent ? b : document.getElementById('kb-' + rest); }
  else if (kind === 'c') { const [cat, wk] = rest.split('|'); node = document.querySelector(`.col-week[data-cat-id="${CSS.escape(cat || '')}"][data-week-key="${CSS.escape(wk || '')}"]`); }
  else if (kind === 'p') node = document.getElementById(rest);
  else if (kind === 'h') node = document.querySelector(`.header-week[data-week-key="${CSS.escape(rest)}"]`);
  else if (kind === 'v') node = region();
  if (!node || !node.offsetParent) return null;
  const b = node.getBoundingClientRect();
  const x = b.left + c.fx * b.width, y = b.top + c.fy * b.height;
  const r = region(); const rr = r && r.getBoundingClientRect();
  if (rr && (x < rr.left - 4 || x > rr.right + 4 || y < rr.top - 4 || y > rr.bottom + 4)) return null;   // scrolled out of view
  return { x, y };
}

function layer() {
  if (st.layer && st.layer.isConnected) return st.layer;
  st.layer = document.createElement('div'); st.layer.className = 'live-cursors'; st.layer.setAttribute('aria-hidden', 'true');
  document.body.append(st.layer); return st.layer;
}
function loop() { if (!st.raf) st.raf = requestAnimationFrame(() => { st.raf = 0; paint(); if (st.others.size) loop(); }); }

function paint() {
  const L = st.layer && st.layer.isConnected ? st.layer : (st.others.size ? layer() : null); if (!L) return;
  const now = Date.now(); const view = (window.boardView && window.boardView()) || 'board';
  const live = cursorsOn() && boardShowing();
  const keep = new Set();
  st.others.forEach((c, uid) => {
    const fresh = c.at && now - c.at < STALE_MS && (c.view === view || (c.a || '').startsWith('t:'));
    const pt = live && fresh ? pointFor(c) : null;
    let n = L.querySelector(`[data-uid="${CSS.escape(uid)}"]`);
    if (!pt) { if (n) n.classList.add('gone'); return; }
    keep.add(uid);
    if (!n) {
      const col = colorFor(uid.replace(/^sim:/, ''));
      n = document.createElement('div'); n.className = 'live-cursor gone'; n.dataset.uid = uid; n.style.setProperty('--c', col);
      n.innerHTML = '<svg viewBox="0 0 16 20" width="16" height="20"><path d="M1 1 L1 16 L5 12 L8 19 L11 17.6 L8 11 L14 11 Z" fill="var(--c)" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg><span class="live-cursor-name"></span>';
      L.append(n); requestAnimationFrame(() => n.classList.remove('gone'));
    } else n.classList.remove('gone');
    const name = n.querySelector('.live-cursor-name'); const label = (c.name || 'Teammate').split(' ')[0];
    if (name.textContent !== label) name.textContent = label;
    n.style.transform = `translate(${Math.round(pt.x)}px, ${Math.round(pt.y)}px)`;
    n.classList.toggle('idle', now - c.at > 4000);
  });
  L.querySelectorAll('.live-cursor.gone').forEach(n => { if (!keep.has(n.dataset.uid) && !st.others.has(n.dataset.uid)) n.remove(); });
}

// For tests: feed cursors in as if they came from the database.
window.TTLiveCursors = { receive, paint: () => paint(), count: () => document.querySelectorAll('.live-cursor:not(.gone)').length };

// ── Demo: a sample teammate drifting between cards ──────────────────────────
function simulate() {
  clearInterval(st.sim);
  const move = () => {
    if (!cursorsOn()) return;
    const cards = [...document.querySelectorAll('#main-view .task-card[id]:not([id^="ghost_"]), #main-view .kb-card[data-id]')].filter(c => c.offsetParent);
    if (!cards.length) return;
    const c = cards[Math.floor(Math.random() * Math.min(cards.length, 14))];
    st.others.set('sim:maya', { id: 'sim:maya', name: 'Maya', at: Date.now(), a: 't:' + (c.dataset.id || c.id), fx: 0.3 + Math.random() * 0.5, fy: 0.25 + Math.random() * 0.5, view: (window.boardView && window.boardView()) || 'board' });
    loop();
  };
  setTimeout(move, 2500);
  st.sim = setInterval(move, 2600);
}
