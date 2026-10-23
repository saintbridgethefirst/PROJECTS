// ─────────────────────────────────────────────────────────────────────────────
//  The team's look: 'friendly' (emoji, the default) or 'professional' (clean line icons, no emoji),
//  chosen in Settings ▸ General. In the Professional look:
//   • the menu buttons get line icons in place of their emoji;
//   • the app's own emoji are taken out of labels, tabs and badges as they are drawn, and a
//     few common badge emoji become small icons (calendar, timer, comments…);
//   • task emoji icons are hidden (kept, so switching back restores them).
//  What people typed is never touched (the same list the translator skips: i18n-skip.js).
// ─────────────────────────────────────────────────────────────────────────────
import { icon } from './icons.js';
import { SKIP_SELECTOR } from './i18n-skip.js';

// Menu buttons → icon. Matched in order; the first emoji in the button is swapped for the icon.
const BUTTONS = [
  ['[data-view="board"]', 'layout-grid'], ['[data-view="kanban"]', 'square-kanban'], ['[data-view="gantt"]', 'chart-gantt'],
  ['#search-btn', 'search'], ['[onclick*="openSettings(\'members\')"]', 'user-plus'], ['[onclick*="openAnalytics(\'overview\')"]', 'chart-column'],
  ['[onclick*="openAnalytics(\'timeline\')"]', 'calendar-range'], ['#research-btn', 'wrench'], ['#online-btn', 'users'], ['#activity-btn', 'bell'],
  ['#wb-btn', 'presentation'], ['#approvals-btn', 'check-check'], ['#share-btn', 'share-2'], ['[onclick*="TT.openAI"]', 'sparkles'],
  ['[onclick*="scrollToToday"]', 'crosshair'], ['[onclick="TT.openSettings()"]', 'settings'], ['#nav-collapse', 'panel-left-close'],
  ['[onclick="toggleSidebar()"]', 'panel-right'], ['#theme-toggle-outer', 'palette'], ['#crossteam-btn', 'layers'], ['#home-search', 'search'],
];
// Badge emoji that carry meaning → an icon instead of nothing.
const BADGE = { '⏱': 'timer', '🕒': 'timer', '📅': 'calendar', '📆': 'calendar', '☑': 'square-check', '✅': 'square-check', '💬': 'message-square', '⚠': 'triangle-alert',
  '🔒': 'lock', '⏳': 'hourglass', '⏰': 'clock', '🎯': 'target', '📎': 'paperclip', '🔗': 'link', '📌': 'pin', '🔁': 'repeat', '⛓': 'link', '🔼': 'chevron-up', '🔽': 'chevron-down', '⏫': 'chevrons-up', '⛔': 'octagon-alert' };
const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[▦⇤⇥☰⌂])(?:️|‍(?:\p{Extended_Pictographic})|\p{Emoji_Modifier}|⃣)*/gu;
const HAS = new RegExp(EMOJI.source, 'u');
const LEAD = new RegExp('^(\\s*)(' + EMOJI.source + ')\\s*', 'u');

let on = false; let observer = null;
const textDone = new WeakMap();   // text node → its original text
const iconsAdded = new Set();     // icon spans we put in, removed when switching back

export function currentLook() { return on ? 'professional' : 'friendly'; }

export function setLook(look) {
  const want = look === 'professional';
  if (want === on) return;
  on = want;
  document.body.classList.toggle('look-pro', on);
  if (on) {
    paintButtons(); clean(document.body);
    observer = new MutationObserver(list => { list.forEach(m => m.addedNodes.forEach(n => clean(n))); list.filter(m => m.type === 'characterData').forEach(m => clean(m.target)); paintButtons(); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  } else {
    if (observer) observer.disconnect(); observer = null;
    iconsAdded.forEach(s => s.remove()); iconsAdded.clear();
    // Put the emoji back where we took them out.
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const o = textDone.get(n); if (o !== undefined) { n.nodeValue = o; textDone.delete(n); } }
    document.querySelectorAll('[placeholder], [title]').forEach(el => { const rec = attrDone.get(el); if (rec) { Object.entries(rec).forEach(([a, v]) => el.setAttribute(a, v)); attrDone.delete(el); } });
    document.querySelectorAll('[data-look-btn]').forEach(b => b.removeAttribute('data-look-btn'));
  }
}

function paintButtons() {
  BUTTONS.forEach(([sel, name]) => document.querySelectorAll(sel).forEach(b => {
    if (b.dataset.lookBtn) return;
    const ic = icon(name, 'ico look-ico'); if (!ic) return;
    b.dataset.lookBtn = '1'; b.prepend(ic); iconsAdded.add(ic);
  }));
}

const skip = (el) => !el || el.closest(SKIP_SELECTOR + ', script, style, textarea, input, select, option, .look-ico, svg, .task-icon');
function clean(root) {
  if (!on || !root) return;
  if (root.nodeType === 3) { fixText(root); return; }
  if (root.nodeType !== 1 || skip(root)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (skip(n.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const list = []; let n; while ((n = w.nextNode())) list.push(n);
  list.forEach(fixText);
  [root, ...root.querySelectorAll('[placeholder], [title]')].forEach(fixAttrs);
}
const attrDone = new WeakMap();
function fixAttrs(el) {
  if (!el.getAttribute || el.closest('.look-ico')) return;
  ['placeholder', 'title'].forEach(a => {
    const v = el.getAttribute(a); if (!v || !HAS.test(v)) return;
    const rec = attrDone.get(el) || {}; if (rec[a] === undefined) rec[a] = v; attrDone.set(el, rec);
    el.setAttribute(a, v.replace(EMOJI, '').replace(/^\s+/, '').replace(/ {2,}/g, ' '));
  });
}
function fixText(n) {
  const v = n.nodeValue; if (!v || !HAS.test(v)) return;
  const p = n.parentElement; if (skip(p)) return;
  if (!textDone.has(n)) textDone.set(n, v);
  const lead = v.match(LEAD);
  if (lead) {
    const base = lead[2].replace(/️/g, '');
    const name = BADGE[base];
    const chip = p.closest('.task-card .card-meta, .task-card [class*="chip"], .task-card [class*="badge"], .kb-card [class*="chip"], .kb-card [class*="meta"], [class*="chip"], .pill, .rs-chip, .so-meta, .dep-meta, .mt-meta');
    if (name && chip && !(n.previousSibling && n.previousSibling.classList && n.previousSibling.classList.contains('look-ico'))) { const ic = icon(name, 'ico look-ico look-badge'); if (ic) { p.insertBefore(ic, n); iconsAdded.add(ic); } }
  }
  const stripped = v.replace(EMOJI, '');
  const out = (lead ? stripped.replace(/^\s+/, '') : stripped).replace(/ {2,}/g, ' ');
  if (out !== v) n.nodeValue = out;
}
