// ─────────────────────────────────────────────────────────────────────────────
//  Glass sidebar (Your account ▸ Appearance ▸ Navigation ▸ Glass).
//
//  The sidebar as a floating pane of liquid glass: the team you're in at the
//  top as the workspace, search, the team's tools, your projects (every team
//  you're in, to switch between them), night mode and you at the bottom. A lens
//  of glass slides to whatever the pointer is over and settles on the open
//  view. Folded down to icons, each icon shows its name in a glass label.
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
const ITEMS = '.top-btn, .team-switch, .glass-proj, .glass-group-head';

let lens = null, tip = null, wired = false, raf = 0;

/** Where an element sits inside the bar (the lens is placed in the bar's own coordinates). */
function rectIn(bar, node) {
  const b = bar.getBoundingClientRect(), r = node.getBoundingClientRect();
  return { x: r.left - b.left - bar.clientLeft, y: r.top - b.top - bar.clientTop, w: r.width, h: r.height };
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

function moveLens(node) {
  const bar = document.getElementById('top-bar'); if (!bar || !lens) return;
  if (!on() || !visible(node) || !inView(node)) { lens.classList.remove('shown'); return; }
  const r = rectIn(bar, node);
  // A row gets a pill a little wider than itself; a cell of the views row gets its own shape
  const cell = !!node.closest('.view-toggle') && !rail(), pad = cell ? 0 : rail() ? 4 : 6;
  lens.style.borderRadius = cell ? getComputedStyle(node).borderRadius : '';
  const was = lens.dataset.y ? +lens.dataset.y : r.y;
  lens.style.width = (r.w + pad * 2) + 'px'; lens.style.height = r.h + 'px';
  lens.style.transform = 'translate(' + (r.x - pad) + 'px,' + r.y + 'px)';
  lens.dataset.y = String(r.y);
  // A short stretch while it travels, like a drop of liquid
  if (Math.abs(was - r.y) > 4) { lens.classList.remove('moving'); void lens.offsetWidth; lens.classList.add('moving'); }
  lens.classList.add('shown');
}
function showTip(node) {
  if (!tip) return;
  if (!on() || !rail() || !visible(node)) { tip.classList.remove('shown'); return; }
  const label = (node.getAttribute('aria-label') || node.dataset.label || node.textContent || '').trim();
  if (!label) { tip.classList.remove('shown'); return; }
  const bar = document.getElementById('top-bar').getBoundingClientRect(), r = node.getBoundingClientRect();
  tip.textContent = label;
  tip.style.transform = 'translate(' + Math.round(bar.right + 12) + 'px,' + Math.round(r.top + r.height / 2) + 'px) translateY(-50%)';
  tip.classList.add('shown');
}
const settle = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { moveLens(restingItem()); }); };

function wire() {
  if (wired) return; wired = true;
  const bar = document.getElementById('top-bar'); if (!bar) return;
  lens = el('div.glass-lens', { 'aria-hidden': 'true' }); bar.prepend(lens);
  tip = el('div.glass-tip', { role: 'tooltip', 'aria-hidden': 'true' }); document.body.append(tip);
  const pick = (e) => e.target && e.target.closest && e.target.closest(ITEMS);
  bar.addEventListener('pointerover', (e) => { const n = pick(e); if (n && bar.contains(n)) { moveLens(n); showTip(n); } });
  bar.addEventListener('focusin', (e) => { const n = pick(e); if (n) { moveLens(n); showTip(n); } });
  bar.addEventListener('pointerleave', () => { settle(); if (tip) tip.classList.remove('shown'); });
  bar.addEventListener('focusout', () => { setTimeout(() => { if (!bar.contains(document.activeElement)) { settle(); if (tip) tip.classList.remove('shown'); } }, 0); });
  bar.addEventListener('click', () => setTimeout(settle, 60));
  document.getElementById('top-actions').addEventListener('scroll', () => { settle(); if (tip) tip.classList.remove('shown'); }, { passive: true });
  window.addEventListener('resize', settle);
  // The open view changes (Board ▸ Kanban…): the lens follows
  new MutationObserver(settle).observe(document.querySelector('#top-bar .view-toggle') || bar, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed'] });
}

/**
 * Draw the parts only the glass sidebar has, and keep them current.
 * ctx = { team: { id, name, logo }, members, teams: [{ id, name, logo }], user: { name, email }, dark,
 *         openTeam(id), newProject(), toggleNight() }
 */
export function renderGlass(ctx) {
  const actions = document.getElementById('top-actions'); if (!actions) return;
  wire();
  // The workspace line under the team's name
  const sub = document.querySelector('#team-switch .ws-sub');
  if (sub && ctx.team) sub.textContent = 'Workspace · ' + ctx.members + (ctx.members === 1 ? ' member' : ' members');
  // Search shows its keyboard shortcut
  const kbd = document.querySelector('#search-btn .glass-kbd'); if (kbd) kbd.textContent = isMac() ? '⌘K' : 'Ctrl K';
  // Your projects: every team you're in
  let box = document.getElementById('glass-projects');
  if (!box) { box = el('div.glass-projects', { id: 'glass-projects' }); actions.append(box); }
  let open = true; try { open = localStorage.getItem('tt_glass_projects') !== '0'; } catch { /* */ }
  const teams = (ctx.teams || []).slice().sort((a, b) => (a.id === ctx.team.id ? -1 : b.id === ctx.team.id ? 1 : a.name.localeCompare(b.name)));
  const head = el('button.glass-group-head', { type: 'button', 'aria-expanded': String(open), 'aria-controls': 'glass-proj-list', 'aria-label': 'Projects', onclick: () => {
    try { localStorage.setItem('tt_glass_projects', open ? '0' : '1'); } catch { /* */ }
    renderGlass(ctx); setTimeout(settle, 30);
  } }, el('span.glass-ic', { 'aria-hidden': 'true' }, '📁'), el('span.nav-lbl', {}, 'Projects'), el('span.glass-count', {}, String(teams.length)), el('span.glass-chev', { 'aria-hidden': 'true' }));
  const list = el('div.glass-proj-list' + (open ? '' : '.closed'), { id: 'glass-proj-list', role: 'list' },
    ...teams.map(t => el('button.glass-proj' + (t.id === ctx.team.id ? '.current' : ''), { type: 'button', role: 'listitem', dataset: { team: t.id, label: t.name }, 'aria-current': t.id === ctx.team.id ? 'page' : null,
      title: t.id === ctx.team.id ? t.name + ' (open)' : 'Open ' + t.name, onclick: () => { if (t.id !== ctx.team.id) ctx.openTeam(t.id); } },
    el('span.glass-dot', { style: { background: projectColour(t.id) }, 'aria-hidden': 'true' }), teamLogo(t), el('span.nav-lbl', {}, t.name))),
    el('button.glass-proj.new', { type: 'button', dataset: { label: 'New project' }, onclick: () => ctx.newProject() }, el('span.glass-plus', { 'aria-hidden': 'true' }, '+'), el('span.nav-lbl', {}, 'New project')));
  box.replaceChildren(head, list);
  // Night mode and you, at the bottom
  const night = document.getElementById('glass-night');
  if (night) {
    night.setAttribute('aria-checked', String(!!ctx.dark));
    if (!night.dataset.wired) { night.dataset.wired = '1'; night.addEventListener('click', () => ctx.toggleNight()); }
  }
  const mail = document.querySelector('#floating-toggles .user-mail'); if (mail && ctx.user) mail.textContent = ctx.user.email || '';
  settle();
}
/** Put the lens back where it rests (after the bar changes size or mode). */
export function settleGlass() { if (lens) settle(); if (tip) tip.classList.remove('shown'); }
