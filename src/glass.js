// ─────────────────────────────────────────────────────────────────────────────
//  Glass sidebar (Your account ▸ Appearance ▸ Navigation ▸ Glass).
//
//  The sidebar as a floating pane of liquid glass over a wallpaper, with the
//  board sliding underneath it: the team you're in at the top as the workspace,
//  search, the views, your projects (every team you're in, to switch between
//  them), the team's tools, night mode and you at the bottom. A clear glass lens
//  follows the pointer on a spring and settles on the open view. Folded down to
//  icons, each icon shows its name in a glass label.
//  It reuses the sidebar's markup (#top-bar); src/glass.css draws it.
// ─────────────────────────────────────────────────────────────────────────────
import { el, teamLogo } from './ui.js';

const DOTS = ['#38bdf8', '#f97316', '#a78bfa', '#34d399', '#f472b6', '#facc15', '#60a5fa', '#fb7185'];
/** A steady colour for each project (team), from its id. */
export function projectColour(id) {
  let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DOTS[h % DOTS.length];
}
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const on = () => document.body.classList.contains('nav-glass') && matchMedia('(min-width: 761px)').matches;
const rail = () => document.body.classList.contains('nav-rail');
const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const ITEMS = '.top-btn, .team-switch, .glass-proj, .glass-group-head';

// ── The lens: a drop of clear glass on a spring ──────────────────────────────
// It chases its target (the item under the pointer, or the open view) with a slightly bouncy
// spring, stretching a little along the way it moves, like a drop of liquid. Transform and size
// only, in one animation-frame loop that stops as soon as it has settled.
let lens = null, tip = null, wired = false, raf = 0, hovered = null, inside = false;
const S = { x: 0, y: 0, w: 0, h: 0, vx: 0, vy: 0, vw: 0, vh: 0, tx: 0, ty: 0, tw: 0, th: 0, shown: false, last: 0 };

function bar() { return document.getElementById('top-bar'); }
/** Where an element sits inside the bar (the lens is placed in the bar's own coordinates). */
function rectIn(b, node) {
  const br = b.getBoundingClientRect(), r = node.getBoundingClientRect();
  return { x: r.left - br.left - b.clientLeft, y: r.top - br.top - b.clientTop, w: r.width, h: r.height };
}
function visible(node) { return !!node && node.isConnected && node.offsetParent !== null && node.getClientRects().length > 0; }
/** Not scrolled out of the list (the lens would float over the header or the bottom). */
function inView(node) {
  const list = document.getElementById('top-actions'); if (!list || !list.contains(node)) return true;
  const a = list.getBoundingClientRect(), r = node.getBoundingClientRect();
  return r.top >= a.top - 2 && r.bottom <= a.bottom + 2;
}
/** The open view (Board, Kanban…): where the lens rests. */
function restingItem() { return document.querySelector('#top-bar .view-toggle .top-btn.on'); }

function paint() {
  // A little stretch along the way it travels, and a little narrower while it does
  const sp = Math.min(Math.abs(S.vy) / 2600, 0.22), sx = Math.min(Math.abs(S.vx) / 2600, 0.18);
  const w = Math.max(0, S.w * (1 + sx - sp * 0.35)), h = Math.max(0, S.h * (1 + sp - sx * 0.35));
  lens.style.width = w.toFixed(1) + 'px'; lens.style.height = h.toFixed(1) + 'px';
  lens.style.transform = 'translate3d(' + (S.x - (w - S.w) / 2).toFixed(1) + 'px,' + (S.y - (h - S.h) / 2).toFixed(1) + 'px,0)';
}
function step(now) {
  // Real time, in small fixed steps, so it moves the same at 60 or 120 frames a second (or a slow 20)
  let left = Math.min(0.1, Math.max(0, (now - (S.last || now - 16)) / 1000)); S.last = now;
  const k = 430, c = 31, h = 1 / 240;   // stiffness and damping: quick, with a small overshoot
  while (left > 0) {
    const dt = Math.min(h, left); left -= dt;
    for (const [p, v, t] of [['x', 'vx', 'tx'], ['y', 'vy', 'ty'], ['w', 'vw', 'tw'], ['h', 'vh', 'th']]) {
      const a = k * (S[t] - S[p]) - c * S[v]; S[v] += a * dt; S[p] += S[v] * dt;
    }
  }
  paint();
  const still = ['x', 'y', 'w', 'h'].every(p => Math.abs(S['t' + p] - S[p]) < 0.3) && ['vx', 'vy', 'vw', 'vh'].every(v => Math.abs(S[v]) < 4);
  if (still) { S.x = S.tx; S.y = S.ty; S.w = S.tw; S.h = S.th; S.vx = S.vy = S.vw = S.vh = 0; paint(); raf = 0; S.last = 0; return; }
  raf = requestAnimationFrame(step);
}
/** Send the lens to a node: glide there, or jump when it isn't showing yet (or motion is calmed). */
function moveLens(node, jump) {
  const b = bar(); if (!b || !lens) return;
  if (!on() || !visible(node) || !inView(node)) { hide(); return; }
  const r = rectIn(b, node);
  const cell = !!node.closest('.view-toggle') && !rail(), pad = cell ? 0 : rail() ? 4 : 6;
  S.tx = r.x - pad; S.ty = r.y; S.tw = r.w + pad * 2; S.th = r.h;
  lens.classList.toggle('cell', cell);
  if (!S.shown || jump || calm()) {
    cancelAnimationFrame(raf); raf = 0; S.last = 0;
    S.x = S.tx; S.y = S.ty; S.w = S.tw; S.h = S.th; S.vx = S.vy = S.vw = S.vh = 0; paint();
  } else if (!raf) raf = requestAnimationFrame(step);
  if (!S.shown) { S.shown = true; lens.classList.add('shown'); }
}
function hide() { if (lens) lens.classList.remove('shown'); S.shown = false; cancelAnimationFrame(raf); raf = 0; }
function showTip(node) {
  if (!tip) return;
  if (!on() || !rail() || !visible(node)) { tip.classList.remove('shown'); return; }
  const label = (node.getAttribute('aria-label') || node.dataset.label || node.textContent || '').trim();
  if (!label) { tip.classList.remove('shown'); return; }
  const br = bar().getBoundingClientRect(), r = node.getBoundingClientRect();
  tip.textContent = label;
  tip.style.transform = 'translate(' + Math.round(br.right + 12) + 'px,' + Math.round(r.top + r.height / 2) + 'px) translateY(-50%)';
  tip.classList.add('shown');
}
/** Back to the open view, unless the pointer is over the bar (then it stays with the pointer). */
function settle(jump) {
  if (inside && hovered && hovered.isConnected) { moveLens(hovered, jump); return; }
  moveLens(restingItem(), jump);
}

function wire() {
  if (wired) return;
  const b = bar(); if (!b) return; wired = true;
  lens = el('div.glass-lens', { 'aria-hidden': 'true' }); b.prepend(lens);
  tip = el('div.glass-tip', { role: 'tooltip', 'aria-hidden': 'true' }); document.body.append(tip);
  const pick = (e) => e.target && e.target.closest && e.target.closest(ITEMS);
  b.addEventListener('pointerenter', () => { inside = true; });
  b.addEventListener('pointerover', (e) => {
    inside = true;
    const n = pick(e); if (!n || !b.contains(n) || n === hovered) return;
    hovered = n; moveLens(n); showTip(n);
  });
  b.addEventListener('pointerleave', () => { inside = false; hovered = null; settle(); if (tip) tip.classList.remove('shown'); });
  b.addEventListener('focusin', (e) => { const n = pick(e); if (n && n.matches(':focus-visible')) { moveLens(n); showTip(n); } });
  b.addEventListener('focusout', () => { setTimeout(() => { if (!b.contains(document.activeElement) && !inside) { settle(); if (tip) tip.classList.remove('shown'); } }, 0); });
  // The list scrolls: keep the lens on its item (no glide, it moves with the list)
  document.getElementById('top-actions').addEventListener('scroll', () => { settle(true); if (tip) tip.classList.remove('shown'); }, { passive: true });
  let rz = 0; window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => settle(true)); });
  // The open view changes (Board ▸ Kanban…): the lens follows when the pointer isn't on the bar
  const views = document.querySelector('#top-bar .view-toggle');
  if (views) new MutationObserver(() => { if (!inside) settle(); }).observe(views, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed'] });
}

/**
 * Draw the parts only the glass sidebar has, and keep them current. Cheap to call often: the
 * projects list is only rebuilt when it has changed, so the board's live updates don't disturb it.
 * ctx = { team: { id, name, logo }, members, teams: [{ id, name, logo }], user: { name, email }, dark,
 *         openTeam(id), newProject(), toggleNight() }
 */
let lastSig = '', lastCtx = null;
export function renderGlass(ctx) {
  const actions = document.getElementById('top-actions'); if (!actions) return;
  wire(); lastCtx = ctx;
  const sub = document.querySelector('#team-switch .ws-sub');
  const subText = 'Workspace · ' + ctx.members + (ctx.members === 1 ? ' member' : ' members');
  if (sub && ctx.team && sub.textContent !== subText) sub.textContent = subText;
  const kbd = document.querySelector('#search-btn .glass-kbd'); const k = isMac() ? '⌘K' : 'Ctrl K'; if (kbd && kbd.textContent !== k) kbd.textContent = k;
  let open = true; try { open = localStorage.getItem('tt_glass_projects') !== '0'; } catch { /* */ }
  const teams = (ctx.teams || []).slice().sort((a, b) => (a.id === ctx.team.id ? -1 : b.id === ctx.team.id ? 1 : a.name.localeCompare(b.name)));
  const sig = JSON.stringify([ctx.team.id, open, teams.map(t => [t.id, t.name, t.logo || ''])]);
  let box = document.getElementById('glass-projects');
  if (!box) { box = el('div.glass-projects', { id: 'glass-projects' }); actions.append(box); lastSig = ''; }
  if (sig !== lastSig) {
    lastSig = sig;
    const head = el('button.glass-group-head', { type: 'button', 'aria-expanded': String(open), 'aria-controls': 'glass-proj-list', 'aria-label': 'Projects', onclick: () => {
      try { localStorage.setItem('tt_glass_projects', open ? '0' : '1'); } catch { /* */ }
      if (lastCtx) renderGlass(lastCtx);
      const h = document.querySelector('.glass-group-head'); if (h) { hovered = h; moveLens(h, true); }
    } }, el('span.glass-ic', { 'aria-hidden': 'true' }, '📁'), el('span.nav-lbl', {}, 'Projects'), el('span.glass-count', {}, String(teams.length)), el('span.glass-chev', { 'aria-hidden': 'true' }));
    const list = el('div.glass-proj-list' + (open ? '' : '.closed'), { id: 'glass-proj-list', role: 'list' },
      ...teams.map(t => el('button.glass-proj' + (t.id === ctx.team.id ? '.current' : ''), { type: 'button', role: 'listitem', dataset: { team: t.id, label: t.name }, 'aria-current': t.id === ctx.team.id ? 'page' : null,
        title: t.id === ctx.team.id ? t.name + ' (open)' : 'Open ' + t.name, onclick: () => { if (lastCtx && t.id !== lastCtx.team.id) lastCtx.openTeam(t.id); } },
      el('span.glass-dot', { style: { background: projectColour(t.id), color: projectColour(t.id) }, 'aria-hidden': 'true' }), teamLogo(t), el('span.nav-lbl', {}, t.name))),
      el('button.glass-proj.new', { type: 'button', dataset: { label: 'New project' }, onclick: () => lastCtx && lastCtx.newProject() }, el('span.glass-plus', { 'aria-hidden': 'true' }, '+'), el('span.nav-lbl', {}, 'New project')));
    const wasHover = hovered && box.contains(hovered);
    box.replaceChildren(head, list);
    if (wasHover) hovered = null;
    requestAnimationFrame(() => settle(true));
  }
  const night = document.getElementById('glass-night');
  if (night) {
    if (night.getAttribute('aria-checked') !== String(!!ctx.dark)) night.setAttribute('aria-checked', String(!!ctx.dark));
    if (!night.dataset.wired) { night.dataset.wired = '1'; night.addEventListener('click', () => lastCtx && lastCtx.toggleNight()); }
  }
  const mail = document.querySelector('#floating-toggles .user-mail'); if (mail && ctx.user && mail.textContent !== (ctx.user.email || '')) mail.textContent = ctx.user.email || '';
  if (!S.shown) requestAnimationFrame(() => settle(true));
}
/** Put the lens back where it rests (after the bar changes size or mode). */
export function settleGlass() { if (lens) { if (!on()) hide(); else settle(true); } if (tip) tip.classList.remove('shown'); }
