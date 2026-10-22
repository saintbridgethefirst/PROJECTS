// ─────────────────────────────────────────────────────────────────────────────
//  Whiteboards: an endless canvas for planning together (like YouTrack's).
//  Sticky notes, text, headings, real task cards (live: name, owner, stage,
//  deadline) and arrows between them. Turn a note into a task in one click; its
//  "- bullet" lines become sub-tasks. Each item is its own document (wbItems), so
//  several people can work on the same board at once.
//  Pan: drag the background (or scroll). Zoom: Ctrl + scroll, or − / +.
// ─────────────────────────────────────────────────────────────────────────────
import './whiteboard.css';
import { el, modal, toast } from './ui.js';
import { newId, cleanWbItem, cleanWhiteboard, WB_COLORS, WB_INKS, WB_SHAPES, WB_MAX_ITEMS, noteToTask } from './model.js';

let W = null;   // the open whiteboard screen
const TOOLS = [['select', '↖', 'Select and move (V). Shift-drag to select several', 'v'], ['note', '▭', 'Sticky note (N)', 'n'], ['text', 'T', 'Text (T)', 't'], ['title', 'H', 'Heading (H)', 'h'],
  ['shape-rect', '▢', 'Rectangle (R)', 'r'], ['shape-ellipse', '◯', 'Ellipse (O)', 'o'], ['shape-diamond', '◇', 'Diamond: a decision (D)', 'd'], ['pen', '✎', 'Pen: draw freehand (P)', 'p'], ['frame', '⬚', 'Frame: a titled area to group things (F)', 'f'],
  ['task', '☑', 'Add a task card (K)', 'k'], ['link', '↗', 'Arrow: click one item, then another (A)', 'a']];
const PLACED = ['note', 'text', 'title', 'shape-rect', 'shape-ellipse', 'shape-diamond', 'frame'];
const SIZES = { note: [220, 140], text: [260, 44], title: [420, 56], task: [300, 104], shape: [180, 110], frame: [640, 420], pen: [120, 80] };
const SHAPE_LABEL = { rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond', triangle: 'Triangle', pill: 'Pill' };
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

const S = () => W && W.ctx.session;
const canEdit = () => { const T = W && W.ctx.TT; return !!T && (T.can('tasks.editOwn') || T.can('tasks.editAll')); };
const boards = () => (S() && S().whiteboards || []).slice().sort((a, b) => a.createdAt - b.createdAt);
const items = () => (S() && S().wbItems || []).filter(i => i.boardId === W.boardId);
const itemById = (id) => (S().wbItems || []).find(i => i.id === id);
const me = () => W.ctx.user;
const write = (ops) => W.ctx.writeOps(ops);
const put = (item) => { const { id, ...data } = cleanWbItem({ ...item, updatedAt: Date.now() }, item.id); return { type: 'set', path: 'wbItems/' + id, data }; };

/** Open the whiteboards (the last one you used, or the list). */
export function openWhiteboards(ctx, boardId) {
  closeWhiteboards();
  const s = ctx.session; if (!s) return;
  let last = ''; try { last = localStorage.getItem('tt_wb_' + s.teamId) || ''; } catch { /* */ }
  W = { ctx, teamId: s.teamId, boardId: boardId || last, view: { x: 80, y: 60, z: 1 }, tool: 'select', sel: new Set(), linkFrom: '', busy: false, editing: '' };
  const root = el('div.wb-screen', { id: 'wb-screen', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Whiteboards' });
  document.body.append(root); W.root = root;
  W.onKey = (e) => onKey(e); document.addEventListener('keydown', W.onKey, true);
  if (!boards().some(b => b.id === W.boardId)) W.boardId = (boards()[0] || {}).id || '';
  renderAll();
  window.__wbRefresh = refreshWhiteboards; window.__wbClose = closeWhiteboards;
}
export function closeWhiteboards() {
  if (!W) return;
  document.removeEventListener('keydown', W.onKey, true);
  W.root.remove(); W = null; window.__wbRefresh = null; window.__wbClose = null;
}
/** Data changed (someone else drew, or our own save landed). */
export function refreshWhiteboards() {
  if (!W) return;
  if (!boards().some(b => b.id === W.boardId)) { W.boardId = (boards()[0] || {}).id || ''; renderAll(); return; }
  if (W.busy || W.editing) { W.dirty = true; return; }
  if (!W.world) { renderAll(); return; }
  drawItems(); drawHead();
}

// ── Layout ──────────────────────────────────────────────────────────────────
function renderAll() {
  W.root.replaceChildren(); W.world = null;
  const head = el('header.wb-head', { id: 'wb-head' }); W.head = head;
  W.root.append(head);
  if (!W.boardId) { drawHead(); W.root.append(emptyState()); return; }
  try { localStorage.setItem('tt_wb_' + W.teamId, W.boardId); } catch { /* */ }
  const canvas = el('div.wb-canvas', { id: 'wb-canvas', tabIndex: -1 });
  const world = el('div.wb-world', { id: 'wb-world' });
  const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'wb-links'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<defs><marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="wb-arrowhead"/></marker></defs>';
  world.append(svg); canvas.append(world);
  W.canvas = canvas; W.world = world; W.svg = svg;
  const tools = el('div.wb-tools', { role: 'toolbar', 'aria-label': 'Whiteboard tools', id: 'wb-tools' });
  W.toolsEl = tools;
  const zoom = el('div.wb-zoom', { role: 'group', 'aria-label': 'Zoom' },
    el('button', { type: 'button', 'aria-label': 'Zoom out', id: 'wb-zoom-out', onclick: () => zoomBy(-1) }, '−'),
    el('button.wb-zoom-pct', { type: 'button', id: 'wb-zoom-pct', title: 'Fit everything on screen', onclick: () => fit() }, '100%'),
    el('button', { type: 'button', 'aria-label': 'Zoom in', id: 'wb-zoom-in', onclick: () => zoomBy(1) }, '+'));
  const float = el('div.wb-float', { id: 'wb-float', hidden: true }); W.float = float;
  W.root.append(canvas, tools, zoom, float);
  wireCanvas(canvas);
  drawHead(); drawTools(); drawItems();
  if (!W.fitted) { W.fitted = true; if (items().length) fit(); else applyView(); }
}
function drawHead() {
  const list = boards(); const b = list.find(x => x.id === W.boardId);
  const sel = el('select.wb-board-select', { id: 'wb-board', 'aria-label': 'Whiteboard', onchange: (e) => { W.boardId = e.target.value; W.sel.clear(); W.fitted = false; renderAll(); } },
    list.map(x => el('option', { value: x.id, selected: x.id === W.boardId }, x.name)));
  W.head.replaceChildren(
    el('span.wb-crumb', {}, '🧭 Whiteboards'), list.length ? el('span.wb-slash', { 'aria-hidden': 'true' }, '/') : '', list.length ? sel : '',
    b && canEdit() ? el('button.btn.small.ghost', { type: 'button', id: 'wb-rename', onclick: () => renameBoard(b) }, 'Rename') : '',
    canEdit() ? el('button.btn.small', { type: 'button', id: 'wb-new', onclick: newBoard }, '+ New board') : '',
    el('span.spacer'),
    b ? el('span.hint.wb-count', {}, items().filter(i => i.kind !== 'link').length + ' items') : '',
    b && canEdit() && (b.createdBy === me().uid || W.ctx.TT.can('team.settings')) ? el('button.btn.small.ghost', { type: 'button', id: 'wb-delete', onclick: () => deleteBoard(b) }, 'Delete board') : '',
    el('button.btn.small', { type: 'button', id: 'wb-close', onclick: closeWhiteboards, 'aria-label': 'Close whiteboards' }, '✕ Close'));
}
function emptyState() {
  return el('div.wb-empty', {}, el('div.wb-empty-card', {},
    el('h2', {}, 'Plan visually, together'),
    el('p.hint', {}, 'A whiteboard is an endless canvas: sticky notes, headings, real task cards and arrows between them. Everyone in the team sees changes as they happen. Turn any note into a task when you’re ready.'),
    canEdit() ? el('div.row', { style: { gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } },
      el('button.btn.primary', { type: 'button', id: 'wb-first', onclick: () => createBoard('Planning', true) }, 'Start with a planning board'),
      el('button.btn', { type: 'button', onclick: () => createBoard('Untitled board', false) }, 'Blank board')) : el('p.hint', {}, 'No whiteboards yet.')));
}
function drawTools() {
  if (!W.toolsEl) return;
  W.toolsEl.replaceChildren(...(canEdit() ? TOOLS : TOOLS.slice(0, 1)).map(([id, icon, label]) => el('button.wb-tool' + (W.tool === id ? '.on' : '') + (['shape-rect', 'pen', 'task'].includes(id) ? '.wb-tool-gap' : ''), { type: 'button', 'aria-label': label, title: label, 'aria-pressed': String(W.tool === id), dataset: { tool: id }, onclick: () => setTool(id) }, icon)));
  if (W.canvas) W.canvas.dataset.tool = W.tool;
}
function setTool(t) {
  closeMenu();
  if (t === 'task') { W.tool = 'select'; drawTools(); addTaskCard(); return; }
  W.tool = t; W.linkFrom = ''; drawTools(); drawItems();
  if (t === 'link') toast('Click the item the arrow starts from, then the one it points to.', 3500);
}

// ── Boards ──────────────────────────────────────────────────────────────────
async function createBoard(name, planning) {
  const id = newId('wb'); const now = Date.now();
  const { id: _i, ...data } = cleanWhiteboard({ name, createdBy: me().uid, createdByName: me().name || '', createdAt: now, updatedAt: now }, id);
  const ops = [{ type: 'set', path: 'whiteboards/' + id, data }];
  if (planning) {
    [['Ideas', 0], ['Design', 520], ['Build', 1040], ['Test', 1560]].forEach(([t, x], k) => ops.push(put({ id: newId('wi'), boardId: id, kind: 'title', x, y: 0, w: 420, h: 56, text: t, z: k, createdBy: me().uid })));
    ops.push(put({ id: newId('wi'), boardId: id, kind: 'note', x: 0, y: 90, text: 'Drop ideas here.\nDouble-click to edit; drag to move.', color: WB_COLORS[0], z: 10, createdBy: me().uid }));
  }
  W.boardId = id; W.fitted = false;
  if (await write(ops)) renderAll();
}
function newBoard() {
  const m = modal('New whiteboard', { narrow: true });
  const name = el('input', { type: 'text', id: 'wb-new-name', maxlength: 80, placeholder: 'e.g. Landing gear planning' });
  let planning = true;
  const seg = el('div.row', { style: { gap: '8px' } });
  const drawSeg = () => seg.replaceChildren(...[[true, 'Planning (Ideas · Design · Build · Test)'], [false, 'Blank']].map(([v, l]) => el('button.btn.small' + (planning === v ? '.primary' : ''), { type: 'button', onclick: () => { planning = v; drawSeg(); } }, l)));
  drawSeg();
  m.body.append(el('label.field', {}, el('span', {}, 'Name'), name), el('div.field', {}, el('span', {}, 'Start from'), seg));
  m.foot.append(el('span.spacer'), el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Cancel'),
    el('button.btn.primary', { type: 'button', id: 'wb-new-save', onclick: () => { createBoard(name.value.trim() || 'Untitled board', planning); m.close(); } }, 'Create'));
  setTimeout(() => name.focus(), 30);
}
function renameBoard(b) {
  const m = modal('Rename whiteboard', { narrow: true });
  const name = el('input', { type: 'text', id: 'wb-rename-input', maxlength: 80, value: b.name });
  m.body.append(el('label.field', {}, el('span', {}, 'Name'), name));
  m.foot.append(el('span.spacer'), el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Cancel'),
    el('button.btn.primary', { type: 'button', id: 'wb-rename-save', onclick: async () => { const { id, ...data } = cleanWhiteboard({ ...b, name: name.value.trim() || b.name, updatedAt: Date.now() }, b.id); m.close(); if (await write([{ type: 'set', path: 'whiteboards/' + id, data }])) drawHead(); } }, 'Save'));
  setTimeout(() => { name.focus(); name.select(); }, 30);
}
async function deleteBoard(b) {
  const n = items().length;
  if (!confirm('Delete the whiteboard “' + b.name + '”' + (n ? ' and its ' + n + ' items' : '') + '? Tasks on it are not deleted.')) return;
  const ops = items().map(i => ({ type: 'delete', path: 'wbItems/' + i.id })).concat({ type: 'delete', path: 'whiteboards/' + b.id });
  W.boardId = ''; W.sel.clear();
  if (await write(ops)) { W.boardId = (boards()[0] || {}).id || ''; W.fitted = false; renderAll(); toast('Whiteboard deleted.'); }
}

// ── View: pan and zoom ──────────────────────────────────────────────────────
function applyView() {
  const { x, y, z } = W.view;
  W.world.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + z + ')';
  const g = 24 * z; W.canvas.style.backgroundSize = g + 'px ' + g + 'px'; W.canvas.style.backgroundPosition = x + 'px ' + y + 'px';
  const pct = document.getElementById('wb-zoom-pct'); if (pct) pct.textContent = Math.round(z * 100) + '%';
}
function zoomAt(z, cx, cy) {
  z = Math.min(2, Math.max(0.2, z)); const v = W.view;
  const wx = (cx - v.x) / v.z, wy = (cy - v.y) / v.z;
  W.view = { z, x: cx - wx * z, y: cy - wy * z }; applyView();
}
function zoomBy(dir) {
  const r = W.canvas.getBoundingClientRect(); const z = W.view.z;
  const next = dir > 0 ? ZOOMS.find(s => s > z + 0.001) || 2 : [...ZOOMS].reverse().find(s => s < z - 0.001) || 0.25;
  zoomAt(next, r.width / 2, r.height / 2);
}
function fit() {
  const list = items().filter(i => i.kind !== 'link'); const r = W.canvas.getBoundingClientRect();
  if (!list.length) { W.view = { x: 80, y: 60, z: 1 }; applyView(); return; }
  const minX = Math.min(...list.map(i => i.x)), minY = Math.min(...list.map(i => i.y)), maxX = Math.max(...list.map(i => i.x + i.w)), maxY = Math.max(...list.map(i => i.y + i.h));
  const z = Math.min(1.25, Math.max(0.2, Math.min((r.width - 160) / Math.max(1, maxX - minX), (r.height - 160) / Math.max(1, maxY - minY))));
  W.view = { z, x: (r.width - (maxX - minX) * z) / 2 - minX * z, y: (r.height - (maxY - minY) * z) / 2 - minY * z }; applyView();
}
const toWorld = (cx, cy) => { const r = W.canvas.getBoundingClientRect(); return { x: (cx - r.left - W.view.x) / W.view.z, y: (cy - r.top - W.view.y) / W.view.z }; };

// ── Items ───────────────────────────────────────────────────────────────────
function taskInfo(id) {
  const s = S(); const live = window.boardLocate ? window.boardLocate(id) : null;
  const t = live ? live.task : (s.tasks || []).find(x => x.id === id); if (!t) return null;
  const T = W.ctx.TT; const owner = live ? { name: live.person.name } : (s.members || []).find(m => m.uid === t.ownerUid);
  const stage = (T.workflow || []).find(st => st.id === T.stageId(t));
  return { t, owner: owner ? owner.name : '', stage: stage ? stage.name : '', color: stage ? stage.color : '#a0aec0', done: t.flag === 'completed' };
}
function drawItems() {
  if (!W.world) return;
  const list = items(); const nodes = list.filter(i => i.kind !== 'link').sort((a, b) => a.z - b.z);
  [...W.world.querySelectorAll('.wb-item')].forEach(n => n.remove());
  nodes.forEach(i => W.world.append(itemEl(i)));
  drawLinks(list);
  drawFloat();
  const c = W.root.querySelector('.wb-count'); if (c) c.textContent = nodes.length + ' items';
}
function itemEl(i) {
  const sel = W.sel.has(i.id); const editable = canEdit();
  const n = el('div.wb-item.wb-' + i.kind + (i.kind === 'shape' ? '.wb-shape-' + (i.shape || 'rect') : '') + (sel ? '.sel' : '') + (W.linkFrom === i.id ? '.link-from' : ''), {
    tabIndex: 0, role: 'group', dataset: { id: i.id, kind: i.kind },
    style: { left: i.x + 'px', top: i.y + 'px', width: i.w + 'px', [['pen', 'shape', 'frame'].includes(i.kind) ? 'height' : 'minHeight']: i.h + 'px', zIndex: String(i.kind === 'frame' ? 1 : 10 + Math.max(0, (i.z || 0) - minZ())), ...(i.kind === 'note' ? { '--note': i.color } : {}) } });
  if (i.kind === 'task') {
    const info = taskInfo(i.taskId);
    n.setAttribute('aria-label', 'Task card: ' + (info ? info.t.name : 'removed task'));
    if (!info) n.append(el('div.wb-task-gone', {}, 'This task was deleted.'));
    else n.append(el('div.wb-task-top', {}, el('span.wb-stage', { style: { '--st': info.color } }, info.done ? '✓ Done' : info.stage || 'Task'), info.t.priority && info.t.priority !== 'Minor' ? el('span.wb-prio', {}, info.t.priority) : ''),
      el('div.wb-task-name' + (info.done ? '.done' : ''), {}, info.t.name || 'Untitled task'),
      el('div.wb-task-meta', {}, info.owner ? el('span', {}, '👤 ' + info.owner) : '', info.t.dueDate ? el('span', {}, '📅 ' + new Date(info.t.dueDate + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) : '',
        (info.t.subtasks || []).length ? el('span', {}, '☑ ' + info.t.subtasks.filter(x => x.completed).length + '/' + info.t.subtasks.length) : ''));
  } else if (i.kind === 'pen') {
    n.setAttribute('aria-label', 'Drawing');
    n.innerHTML = '<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" stroke-width="3" points="' + (i.path || '') + '"/></svg>';
    n.style.setProperty('--ink', i.color || 'var(--text-main)');
  } else if (i.kind === 'shape') {
    n.setAttribute('aria-label', (SHAPE_LABEL[i.shape] || 'Shape') + ': ' + (i.text || 'empty'));
    n.style.setProperty('--fill', i.color || WB_COLORS[2]);
    n.innerHTML = '<svg class="wb-shape-bg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + ({
      rect: '<rect x="1" y="1" width="98" height="98" rx="6"/>', ellipse: '<ellipse cx="50" cy="50" rx="49" ry="49"/>', diamond: '<polygon points="50,1 99,50 50,99 1,50"/>',
      triangle: '<polygon points="50,2 98,98 2,98"/>', pill: '<rect x="1" y="1" width="98" height="98" rx="49" ry="49"/>' })[i.shape || 'rect'] + '</svg>';
    n.append(el('div.wb-text', {}, i.text || ''));
  } else if (i.kind === 'frame') {
    n.setAttribute('aria-label', 'Frame: ' + (i.text || 'untitled'));
    if (i.color) n.style.setProperty('--frame', i.color);
    n.append(el('div.wb-text.wb-frame-title', {}, i.text || 'Frame'));
  } else {
    n.setAttribute('aria-label', ({ note: 'Note', text: 'Text', title: 'Heading' })[i.kind] + ': ' + (i.text || 'empty'));
    n.append(el('div.wb-text', {}, i.text || (i.kind === 'note' ? '' : '…')));
  }
  if (editable && sel && i.kind !== 'task') n.append(el('span.wb-resize', { dataset: { resize: '1' }, 'aria-hidden': 'true' }));
  return n;
}
/** The size an item really has on screen (cards and notes grow with their text). */
function sizeOf(i) {
  const n = W && W.world && W.world.querySelector('.wb-item[data-id="' + i.id + '"]');
  return n && n.offsetWidth ? { w: n.offsetWidth, h: n.offsetHeight } : { w: i.w, h: Math.max(i.h, 30) };
}
function center(i) { const z = sizeOf(i); return { x: i.x + z.w / 2, y: i.y + z.h / 2 }; }
/** Arrows join the middle of the facing sides: left/right when the cards sit side by side, top/bottom when stacked. */
function anchors(a, b) {
  const A = center(a), B = center(b); const za = sizeOf(a), zb = sizeOf(b); const ha = za.h / 2, hb = zb.h / 2; const gap = 8;
  a = { ...a, w: za.w }; b = { ...b, w: zb.w };
  const sideBySide = Math.abs(B.x - A.x) - (a.w + b.w) / 2 > Math.abs(B.y - A.y) - (ha + hb);
  if (sideBySide) {
    const s = Math.sign(B.x - A.x) || 1; const p1 = { x: A.x + s * (a.w / 2 + gap), y: A.y }, p2 = { x: B.x - s * (b.w / 2 + gap), y: B.y };
    const k = Math.max(30, Math.abs(p2.x - p1.x) / 2); return [p1, p2, { x: p1.x + s * k, y: p1.y }, { x: p2.x - s * k, y: p2.y }];
  }
  const s = Math.sign(B.y - A.y) || 1; const p1 = { x: A.x, y: A.y + s * (ha + gap) }, p2 = { x: B.x, y: B.y - s * (hb + gap) };
  const k = Math.max(30, Math.abs(p2.y - p1.y) / 2); return [p1, p2, { x: p1.x, y: p1.y + s * k }, { x: p2.x, y: p2.y - s * k }];
}
function drawLinks(list) {
  [...W.svg.querySelectorAll('g.wb-link')].forEach(n => n.remove());
  [...W.world.querySelectorAll('.wb-link-label')].forEach(n => n.remove());
  const NS = 'http://www.w3.org/2000/svg';
  list.filter(i => i.kind === 'link').forEach(l => {
    const a = list.find(i => i.id === l.from), b = list.find(i => i.id === l.to); if (!a || !b) return;
    const [p1, p2, c1, c2] = anchors(a, b);
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'wb-link' + (W.sel.has(l.id) ? ' sel' : '')); g.dataset.id = l.id;
    const d = 'M' + p1.x + ',' + p1.y + ' C' + c1.x + ',' + c1.y + ' ' + c2.x + ',' + c2.y + ' ' + p2.x + ',' + p2.y;
    const hit = document.createElementNS(NS, 'path'); hit.setAttribute('d', d); hit.setAttribute('class', 'wb-link-hit');
    const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); path.setAttribute('class', 'wb-link-line'); if (l.shape !== 'none') path.setAttribute('marker-end', 'url(#wb-arrow)'); if (l.shape === 'both') path.setAttribute('marker-start', 'url(#wb-arrow)');
    g.append(hit, path); W.svg.append(g);
    if (l.text) { const m = { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 }; W.world.append(el('div.wb-link-label', { dataset: { id: l.id }, style: { left: m.x + 'px', top: m.y + 'px' } }, l.text)); }
  });
}

// ── The little toolbar above a selection (colour, make a task, arrow, delete) ─
function drawFloat() {
  const f = W.float; if (!f) return;
  const ids = [...W.sel].filter(id => itemById(id)); if (!ids.length || W.editing || !canEdit()) { f.hidden = true; return; }
  const one = ids.length === 1 ? itemById(ids[0]) : null; const btns = [];
  const b = (label, id, fn, tip) => el('button', { type: 'button', id, onclick: fn, title: tip || label }, label);
  if (one && ['note', 'shape', 'frame', 'pen'].includes(one.kind)) btns.push(swatches(one));
  if (one && one.kind === 'shape') btns.push(el('select.wb-shape-pick', { 'aria-label': 'Shape', onchange: (e) => write([put({ ...one, shape: e.target.value })]) }, WB_SHAPES.map(sh => el('option', { value: sh, selected: one.shape === sh }, SHAPE_LABEL[sh]))));
  if (one && (one.kind === 'note' || one.kind === 'shape')) btns.push(b('☑ Make it a task', 'wb-convert', () => convertToTask(one), 'Create a task from this: its first line is the name, “- ” lines become sub-tasks'));
  if (one && one.kind === 'task') btns.push(b('Open task', 'wb-open-task', () => openTask(one.taskId)));
  if (one && one.kind === 'link') btns.push(b('Label', 'wb-label', () => editLinkLabel(one)), b('⇄ Flip', 'wb-flip', () => flipLink(one), 'Point the arrow the other way'), b(one.shape === 'both' ? '→ One end' : one.shape === 'none' ? '→ Arrowhead' : '↔ Both ends', 'wb-heads', () => cycleHeads(one), 'Arrowheads: one end, both ends, or a plain line'));
  if (one && one.kind !== 'link') btns.push(b('↗ Arrow', 'wb-arrow-from', () => { W.tool = 'link'; W.linkFrom = one.id; drawTools(); drawItems(); toast('Now click the item it points to.', 2500); }));
  btns.push(b('🗑', 'wb-del', () => deleteSelection(), 'Delete (Del)'));
  f.replaceChildren(...btns); f.hidden = false;
  // place it above the selection
  const boxes = ids.map(itemById).filter(i => i.kind !== 'link');
  let x, y;
  if (boxes.length) { x = Math.min(...boxes.map(i => i.x)); y = Math.min(...boxes.map(i => i.y)); }
  else { const l = one; const a = itemById(l.from), c = itemById(l.to); if (!a || !c) { f.hidden = true; return; } x = (center(a).x + center(c).x) / 2; y = (center(a).y + center(c).y) / 2; }
  const r = W.canvas.getBoundingClientRect();
  const bottom = boxes.length ? Math.max(...boxes.map(i => i.y + i.h)) : y;
  const top = r.top + y * W.view.z + W.view.y, below = r.top + bottom * W.view.z + W.view.y; const fh = f.offsetHeight || 44;
  f.style.left = Math.max(8, Math.min(r.width - f.offsetWidth - 8, x * W.view.z + W.view.x)) + 'px';
  f.style.top = (top - fh - 12 >= r.top + 8 ? top - fh - 12 : Math.min(window.innerHeight - fh - 8, below + 12)) + 'px';
}
function swatches(one) {
  const list = one.kind === 'pen' ? [''].concat(WB_INKS.slice(1)) : one.kind === 'frame' ? [''].concat(WB_COLORS) : WB_COLORS;
  return el('span.wb-swatches', { role: 'group', 'aria-label': 'Colour' }, list.map(c => el('button.wb-swatch' + ((one.color || '') === c ? '.on' : ''), { type: 'button', 'aria-label': 'Colour ' + (c || 'none'), title: c || (one.kind === 'pen' ? 'Ink' : 'No colour'), style: { background: c || (one.kind === 'pen' ? 'var(--text-main)' : 'transparent') }, onclick: () => write([put({ ...one, color: c })]) })));
}
function openTask(taskId) {
  const id = taskId; closeWhiteboards();
  setTimeout(() => { if (window.boardOpenTask) window.boardOpenTask(id); }, 50);
}

// ── Canvas input ────────────────────────────────────────────────────────────
function wireCanvas(c) {
  c.addEventListener('wheel', (e) => {
    e.preventDefault(); const r = c.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(W.view.z * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    else { W.view.x -= e.deltaX; W.view.y -= e.deltaY; applyView(); drawFloat(); }
  }, { passive: false });
  c.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || W.editing) return;
    let itemNode = e.target.closest('.wb-item'); const linkNode = e.target.closest('g.wb-link, .wb-link-label');
    if (itemNode && itemNode.dataset.kind === 'frame' && W.tool !== 'select' && W.tool !== 'link') itemNode = null;   // draw and place inside frames
    const p = toWorld(e.clientX, e.clientY);
    // placing a new item
    if (!itemNode && W.tool === 'pen' && canEdit()) { e.preventDefault(); startDraw(e); return; }
    if (!itemNode && PLACED.includes(W.tool) && canEdit()) { e.preventDefault(); placeTool(W.tool, p); return; }
    if (W.tool === 'link' && itemNode) { e.preventDefault(); linkClick(itemNode.dataset.id); return; }
    if (linkNode) { W.sel = new Set([linkNode.dataset.id]); drawItems(); return; }
    if (!itemNode) {   // pan the background
      if (W.tool === 'link') { W.linkFrom = ''; setTool('select'); }
      if (e.shiftKey) { startMarquee(e); return; }
      W.sel.clear(); drawItems(); closeMenu();
      startPan(e); return;
    }
    const id = itemNode.dataset.id;
    if (e.shiftKey) { if (W.sel.has(id)) W.sel.delete(id); else W.sel.add(id); drawItems(); return; }
    if (!W.sel.has(id)) { W.sel = new Set([id]); drawItems(); }
    if (!canEdit()) return;
    if (e.target.dataset.resize) startResize(e, id); else startMove(e, id);
  });
  c.addEventListener('contextmenu', onContextMenu);
  c.addEventListener('dblclick', (e) => {
    const n = e.target.closest('.wb-item'); const lbl = e.target.closest('.wb-link-label, g.wb-link');
    if (n && canEdit()) { const i = itemById(n.dataset.id); if (i && i.kind === 'task') openTask(i.taskId); else if (i && i.kind !== 'pen') editText(i); return; }
    if (lbl && canEdit()) { const l = itemById(lbl.dataset.id); if (l) editLinkLabel(l); return; }
    if (!n && canEdit()) addItem('note', toWorld(e.clientX, e.clientY));
  });
}
function startPan(e) {
  const x0 = e.clientX, y0 = e.clientY, v0 = { ...W.view }; W.canvas.classList.add('panning');
  const mv = (ev) => { W.view.x = v0.x + ev.clientX - x0; W.view.y = v0.y + ev.clientY - y0; applyView(); };
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); W.canvas.classList.remove('panning'); drawFloat(); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
function startMove(e, id) {
  const x0 = e.clientX, y0 = e.clientY; const ids = [...W.sel].filter(x => { const i = itemById(x); return i && i.kind !== 'link'; });
  // Moving a frame carries what's inside it.
  ids.map(itemById).filter(f => f.kind === 'frame').forEach(f => items().forEach(i => { if (i.kind !== 'link' && i.kind !== 'frame' && !ids.includes(i.id) && i.x >= f.x && i.y >= f.y && i.x + i.w <= f.x + f.w && i.y + i.h <= f.y + f.h) ids.push(i.id); }));
  const start = new Map(ids.map(x => [x, { ...itemById(x) }])); let moved = false; W.busy = true;
  const mv = (ev) => {
    const dx = (ev.clientX - x0) / W.view.z, dy = (ev.clientY - y0) / W.view.z; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; if (!moved) return;
    start.forEach((i, x) => { const n = W.world.querySelector('.wb-item[data-id="' + x + '"]'); if (n) { n.style.left = Math.round(i.x + dx) + 'px'; n.style.top = Math.round(i.y + dy) + 'px'; } });
    const live = items().map(i => (start.has(i.id) ? { ...i, x: Math.round(start.get(i.id).x + dx), y: Math.round(start.get(i.id).y + dy) } : i)); drawLinks(live);
    W.float.hidden = true;
  };
  const up = async (ev) => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); W.busy = false;
    if (!moved) { drawItems(); return; }
    const dx = Math.round((ev.clientX - x0) / W.view.z), dy = Math.round((ev.clientY - y0) / W.view.z);
    await write([...start.values()].map(i => put({ ...i, x: i.x + dx, y: i.y + dy })));
    if (W) { W.dirty = false; drawItems(); }
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
function startResize(e, id) {
  e.preventDefault(); e.stopPropagation(); const i0 = { ...itemById(id) }; const x0 = e.clientX, y0 = e.clientY; W.busy = true;
  const n = W.world.querySelector('.wb-item[data-id="' + id + '"]');
  const fixedH = ['pen', 'shape', 'frame'].includes(i0.kind);
  const mv = (ev) => { const w = Math.max(40, Math.round(i0.w + (ev.clientX - x0) / W.view.z)), h = Math.max(24, Math.round(i0.h + (ev.clientY - y0) / W.view.z)); n.style.width = w + 'px'; n.style[fixedH ? 'height' : 'minHeight'] = h + 'px'; };
  const up = async (ev) => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); W.busy = false;
    const w = Math.max(40, Math.round(i0.w + (ev.clientX - x0) / W.view.z)), h = Math.max(24, Math.round(i0.h + (ev.clientY - y0) / W.view.z));
    await write([put({ ...i0, w, h })]); if (W) drawItems();
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
const nextZ = () => Math.max(0, ...items().map(i => i.z || 0)) + 1;
const minZ = () => Math.min(0, ...items().map(i => i.z || 0));
function placeTool(tool, p) {
  if (tool.startsWith('shape-')) return addItem('shape', p, { shape: tool.slice(6) });
  if (tool === 'frame') return addItem('frame', p, { text: 'Frame' });
  return addItem(tool, p);
}
async function addItem(kind, p, extra = {}) {
  if (items().length >= WB_MAX_ITEMS) { toast('A whiteboard can hold ' + WB_MAX_ITEMS + ' items. Start another board?'); return null; }
  const dflt = SIZES[kind]; const centred = ['note', 'shape', 'frame'].includes(kind);
  const item = cleanWbItem({ id: newId('wi'), boardId: W.boardId, kind, x: Math.round(p.x - (centred ? dflt[0] / 2 : 0)), y: Math.round(p.y - dflt[1] / 2), w: dflt[0], h: dflt[1], text: '', color: kind === 'note' ? WB_COLORS[0] : kind === 'shape' ? WB_COLORS[2] : '', z: kind === 'frame' ? minZ() - 1 : nextZ(), createdBy: me().uid, ...extra });
  W.tool = 'select'; drawTools();
  if (!(await write([put(item)])) || !W) return null;
  W.sel = new Set([item.id]); drawItems();
  if (kind !== 'task') { const fresh = itemById(item.id); if (fresh) editText(fresh); }
  return item.id;
}
function editText(i) {
  const n = W.world.querySelector('.wb-item[data-id="' + i.id + '"]'); if (!n) return;
  W.editing = i.id; W.float.hidden = true;
  const ta = el('textarea.wb-edit', { id: 'wb-edit', 'aria-label': 'Text', maxlength: 2000, rows: i.kind === 'note' ? 5 : 1, placeholder: i.kind === 'note' ? 'Type… “- ” lines become sub-tasks' : i.kind === 'title' ? 'Heading' : i.kind === 'frame' ? 'Frame name' : 'Text' });
  ta.value = i.text || '';
  const t = n.querySelector('.wb-text'); if (t) t.replaceWith(ta); else n.append(ta);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }; ta.addEventListener('input', grow); setTimeout(() => { grow(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  let done = false;
  const finish = async (saveIt) => {
    if (done) return; done = true; W.editing = '';
    const text = ta.value; const cur = itemById(i.id);
    if (saveIt && cur && text !== cur.text) {
      if (!text.trim() && (cur.kind === 'text' || cur.kind === 'title')) await write([{ type: 'delete', path: 'wbItems/' + cur.id }]);
      else await write([put({ ...cur, text })]);
    }
    if (W) { W.dirty = false; drawItems(); }
  };
  ta.addEventListener('blur', () => finish(true));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); }
    if (e.key === 'Enter' && ((i.kind !== 'note' && i.kind !== 'shape') || e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
  });
}
async function linkClick(id) {
  const target = itemById(id); if (!target || target.kind === 'link') return;
  if (!W.linkFrom) { W.linkFrom = id; drawItems(); return; }
  if (W.linkFrom === id) { W.linkFrom = ''; drawItems(); return; }
  const exists = items().some(l => l.kind === 'link' && ((l.from === W.linkFrom && l.to === id)));
  const from = W.linkFrom; W.linkFrom = ''; W.tool = 'select'; drawTools();
  if (exists) { drawItems(); toast('Those are already joined.'); return; }
  const l = cleanWbItem({ id: newId('wl'), boardId: W.boardId, kind: 'link', from, to: id, text: '', z: 0, createdBy: me().uid });
  if (await write([put(l)]) && W) { W.sel = new Set([l.id]); drawItems(); }
}
function flipLink(l) { return write([put({ ...l, from: l.to, to: l.from })]); }
function cycleHeads(l) { return write([put({ ...l, shape: !l.shape ? 'both' : l.shape === 'both' ? 'none' : '' })]); }
function editLinkLabel(l) {
  const m = modal('Arrow label', { narrow: true });
  const inp = el('input', { type: 'text', id: 'wb-link-text', maxlength: 60, value: l.text || '', placeholder: 'e.g. Testing, then, blocks…' });
  m.body.append(el('label.field', {}, el('span', {}, 'Label (optional)'), inp));
  m.foot.append(el('span.spacer'), el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Cancel'), el('button.btn.primary', { type: 'button', id: 'wb-link-save', onclick: () => { write([put({ ...l, text: inp.value.trim() })]); m.close(); } }, 'Save'));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') m.foot.querySelector('#wb-link-save').click(); });
  setTimeout(() => inp.focus(), 30);
}
async function deleteSelection() {
  const ids = new Set([...W.sel].filter(id => itemById(id))); if (!ids.size) return;
  items().filter(l => l.kind === 'link' && (ids.has(l.from) || ids.has(l.to))).forEach(l => ids.add(l.id));
  const old = [...ids].map(itemById).filter(Boolean);
  W.sel.clear();
  if (await write([...ids].map(id => ({ type: 'delete', path: 'wbItems/' + id })))) {
    toast(old.length === 1 ? 'Deleted.' : old.length + ' items deleted.', 5000, 'Undo', () => write(old.map(i => put(i))));
    if (W) drawItems();
  }
}
/** A note becomes a real task: first line = name, "- " lines = sub-tasks. The note turns into its task card. */
function convertToTask(note) {
  const T = W.ctx.TT; const { title, subtasks } = noteToTask(note.text);
  if (!note.text.trim()) { toast('Write something on the note first.'); return; }
  const people = (S().members || []).filter(m => T.canEditOwner(m.uid)).sort((a, b) => (a.uid === me().uid ? -1 : b.uid === me().uid ? 1 : (a.name || '').localeCompare(b.name || '')));
  if (!people.length) { toast('Your role can’t add tasks.'); return; }
  const items_ = people.map(m => ({ icon: '👤', title: m.name || m.email, sub: m.uid === me().uid ? 'You · this week' : 'This week', fields: [[m.name, 3], [m.email, 1]], suggest: true, run: async () => {
    const res = window.boardAddTask ? window.boardAddTask({ ownerUid: m.uid, name: title, subtasks, note: 'From whiteboard “' + ((boards().find(b => b.id === W.boardId) || {}).name || '') + '”' }) : { error: 'Open the board first.' };
    if (res.error) { toast(res.error, 5000); return; }
    const cur = itemById(note.id) || note;
    await write([put({ ...cur, kind: 'task', taskId: res.id, text: '', w: 300, h: 104 })]);
    toast('Task created in ' + (m.name || 'their') + '’s ' + res.week + (subtasks.length ? ', with ' + subtasks.length + ' sub-task' + (subtasks.length === 1 ? '' : 's') : '') + '.');
  } }));
  T.pickFrom(items_, 'Whose task is “' + title + '”?', 'No one to give it to.');
}
function addTaskCard() {
  const T = W.ctx.TT; const on = new Set(items().filter(i => i.kind === 'task').map(i => i.taskId));
  const list = (window.boardTaskList ? window.boardTaskList() : []).filter(t => !on.has(t.id));
  const r = W.canvas.getBoundingClientRect(); const p = toWorld(r.left + r.width / 2, r.top + r.height / 2);
  T.pickFrom(list.map(t => ({ group: t.person, icon: t.done ? '✅' : '☑', title: t.name || 'Untitled task', sub: [t.week, t.due && 'due ' + t.due].filter(Boolean).join(' · '), fields: [[t.name, 3], [t.person, 1]], suggest: true,
    run: () => addItem('task', { x: p.x - 150, y: p.y }, { taskId: t.id, w: 300, h: 104 }) })), 'Which task goes on the board?', 'Every task is already on this board.');
}

// ── Pen, multi-select, copy and paste, order ────────────────────────────────
function startDraw(e) {
  const NS = 'http://www.w3.org/2000/svg'; const pts = [toWorld(e.clientX, e.clientY)];
  const live = document.createElementNS(NS, 'polyline'); live.setAttribute('class', 'wb-pen-live'); W.svg.append(live);
  const drawLive = () => live.setAttribute('points', pts.map(q => q.x + ',' + q.y).join(' '));
  const mv = (ev) => { const q = toWorld(ev.clientX, ev.clientY); const last = pts[pts.length - 1]; if (Math.hypot(q.x - last.x, q.y - last.y) * W.view.z >= 3 && pts.length < 600) { pts.push(q); drawLive(); } };
  const up = async () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); live.remove();
    if (pts.length < 2) return;
    const minX = Math.min(...pts.map(q => q.x)), minY = Math.min(...pts.map(q => q.y)), maxX = Math.max(...pts.map(q => q.x)), maxY = Math.max(...pts.map(q => q.y));
    const w = Math.max(40, Math.round(maxX - minX)), h = Math.max(24, Math.round(maxY - minY));
    const ox = minX - (w - (maxX - minX)) / 2, oy = minY - (h - (maxY - minY)) / 2;
    const path = pts.map(q => Math.round((q.x - ox) / w * 1000) + ',' + Math.round((q.y - oy) / h * 1000)).join(' ');
    const item = cleanWbItem({ id: newId('wi'), boardId: W.boardId, kind: 'pen', x: Math.round(ox), y: Math.round(oy), w, h, path, color: W.ink || '', z: nextZ(), createdBy: me().uid });
    if (items().length >= WB_MAX_ITEMS) { toast('A whiteboard can hold ' + WB_MAX_ITEMS + ' items.'); return; }
    await write([put(item)]);   // the pen stays on, for the next stroke
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
/** Shift-drag on the background: select everything inside the box. */
function startMarquee(e) {
  const a = toWorld(e.clientX, e.clientY); const r = W.canvas.getBoundingClientRect(); const box = el('div.wb-marquee'); W.root.append(box);
  const x0 = e.clientX, y0 = e.clientY;
  const mv = (ev) => { Object.assign(box.style, { left: Math.min(x0, ev.clientX) + 'px', top: Math.min(y0, ev.clientY) + 'px', width: Math.abs(ev.clientX - x0) + 'px', height: Math.abs(ev.clientY - y0) + 'px' }); };
  const up = (ev) => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); box.remove();
    const b = toWorld(ev.clientX, ev.clientY); const L = Math.min(a.x, b.x), T = Math.min(a.y, b.y), Rr = Math.max(a.x, b.x), B = Math.max(a.y, b.y);
    items().filter(i => i.kind !== 'link' && i.x >= L && i.y >= T && i.x + i.w <= Rr && i.y + i.h <= B).forEach(i => W.sel.add(i.id));
    drawItems(); void r;
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
let clip = [];   // copied items (this browser only)
function copySelection() {
  const ids = new Set([...W.sel]); const list = items().filter(i => ids.has(i.id) && i.kind !== 'link');
  const inside = new Set(list.map(i => i.id));
  clip = list.concat(items().filter(l => l.kind === 'link' && inside.has(l.from) && inside.has(l.to))).map(i => ({ ...i }));
  if (clip.length) toast('Copied ' + list.length + (list.length === 1 ? ' item.' : ' items.'), 1800);
}
async function paste(at, list = clip) {
  if (!list.length || !canEdit()) return;
  if (items().length + list.length > WB_MAX_ITEMS) { toast('That would go over ' + WB_MAX_ITEMS + ' items on this board.'); return; }
  const boxes = list.filter(i => i.kind !== 'link'); const minX = Math.min(...boxes.map(i => i.x)), minY = Math.min(...boxes.map(i => i.y));
  const dx = at ? at.x - minX : 30, dy = at ? at.y - minY : 30; const ids = new Map(); let z = nextZ();
  const fresh = boxes.map(i => { const id = newId('wi'); ids.set(i.id, id); return { ...i, id, boardId: W.boardId, x: Math.round(i.x + dx), y: Math.round(i.y + dy), z: i.kind === 'frame' ? i.z : z++, createdBy: me().uid }; })
    .concat(list.filter(l => l.kind === 'link').map(l => ({ ...l, id: newId('wl'), boardId: W.boardId, from: ids.get(l.from), to: ids.get(l.to), createdBy: me().uid })));
  if (await write(fresh.map(put)) && W) { W.sel = new Set(fresh.filter(i => i.kind !== 'link').map(i => i.id)); drawItems(); }
}
function duplicateSelection() { copySelection(); paste(null); }
function reorder(front) {
  const list = [...W.sel].map(itemById).filter(i => i && i.kind !== 'link' && i.kind !== 'frame'); if (!list.length) return;
  let z = front ? nextZ() : minZ() - list.length;
  write(list.map(i => put({ ...i, z: z++ })));
}

// ── Right-click menu ────────────────────────────────────────────────────────
function closeMenu() { const m = document.getElementById('wb-menu'); if (m) m.remove(); }
function showMenu(cx, cy, entries) {
  closeMenu(); if (W.float) W.float.hidden = true;
  const m = el('div.wb-menu', { id: 'wb-menu', role: 'menu' });
  entries.filter(Boolean).forEach(it => {
    if (it === '-') { m.append(el('div.wb-menu-sep', { role: 'separator' })); return; }
    if (it.swatches) { m.append(it.swatches); return; }
    m.append(el('button.wb-menu-item' + (it.danger ? '.danger' : ''), { type: 'button', role: 'menuitem', disabled: !!it.disabled, onclick: () => { closeMenu(); it.run(); } },
      el('span.wb-menu-ico', { 'aria-hidden': 'true' }, it.icon || ''), el('span', {}, it.label), it.key ? el('kbd', {}, it.key) : ''));
  });
  W.root.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(cx, window.innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(cy, window.innerHeight - r.height - 8) + 'px';
  const first = m.querySelector('button:not(:disabled)'); if (first) first.focus();
  const away = (ev) => { if (!m.contains(ev.target)) { closeMenu(); document.removeEventListener('pointerdown', away, true); } };
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
}
function onContextMenu(e) {
  if (!W || !W.world || W.editing) return;
  e.preventDefault();
  const n = e.target.closest('.wb-item'); const lk = e.target.closest('g.wb-link, .wb-link-label'); const p = toWorld(e.clientX, e.clientY); const ed = canEdit();
  if (lk) {
    const l = itemById(lk.dataset.id); if (!l) return; W.sel = new Set([l.id]); drawItems();
    showMenu(e.clientX, e.clientY, [{ icon: '🏷', label: 'Label…', run: () => editLinkLabel(l), disabled: !ed }, { icon: '⇄', label: 'Flip direction', run: () => flipLink(l), disabled: !ed },
      { icon: '↔', label: l.shape === 'both' ? 'Arrowhead at one end' : l.shape === 'none' ? 'Add an arrowhead' : 'Arrowheads at both ends', run: () => cycleHeads(l), disabled: !ed },
      { icon: '—', label: 'Plain line', run: () => write([put({ ...l, shape: 'none' })]), disabled: !ed || l.shape === 'none' }, '-', { icon: '🗑', label: 'Delete arrow', key: 'Del', danger: true, run: deleteSelection, disabled: !ed }]);
    return;
  }
  if (n) {
    const i = itemById(n.dataset.id); if (!i) return;
    if (!W.sel.has(i.id)) { W.sel = new Set([i.id]); drawItems(); }
    const many = W.sel.size > 1;
    showMenu(e.clientX, e.clientY, [
      !many && i.kind !== 'task' && i.kind !== 'pen' ? { icon: '✏️', label: i.kind === 'frame' ? 'Rename frame' : 'Edit text', key: 'Enter', run: () => editText(itemById(i.id) || i), disabled: !ed } : null,
      !many && i.kind === 'task' ? { icon: '↗️', label: 'Open the task', run: () => openTask(i.taskId) } : null,
      !many && (i.kind === 'note' || i.kind === 'shape') ? { icon: '☑', label: 'Make it a task…', run: () => convertToTask(i), disabled: !ed } : null,
      !many && ['note', 'shape', 'frame', 'pen'].includes(i.kind) && ed ? { swatches: swatches(i) } : null,
      !many && i.kind === 'shape' && ed ? { icon: '⬡', label: 'Change shape: ' + SHAPE_LABEL[WB_SHAPES[(WB_SHAPES.indexOf(i.shape) + 1) % WB_SHAPES.length]], run: () => write([put({ ...i, shape: WB_SHAPES[(WB_SHAPES.indexOf(i.shape) + 1) % WB_SHAPES.length] })]) } : null,
      !many ? { icon: '↗', label: 'Arrow from here', key: 'A', run: () => { W.tool = 'link'; W.linkFrom = i.id; drawTools(); drawItems(); toast('Now click the item it points to.', 2500); }, disabled: !ed } : null,
      '-',
      { icon: '⧉', label: 'Duplicate', key: '⌘D', run: duplicateSelection, disabled: !ed },
      { icon: '⎘', label: 'Copy', key: '⌘C', run: copySelection },
      { icon: '⬆', label: 'Bring to front', run: () => reorder(true), disabled: !ed || i.kind === 'frame' },
      { icon: '⬇', label: 'Send to back', run: () => reorder(false), disabled: !ed || i.kind === 'frame' },
      '-',
      { icon: '🗑', label: many ? 'Delete ' + W.sel.size + ' items' : 'Delete', key: 'Del', danger: true, run: deleteSelection, disabled: !ed },
    ]);
    return;
  }
  const add = (icon, label, tool, key) => ({ icon, label, key, disabled: !ed, run: () => (tool === 'task' ? addTaskCard() : placeTool(tool, p)) });
  showMenu(e.clientX, e.clientY, [
    add('▭', 'Sticky note', 'note', 'N'), add('T', 'Text', 'text', 'T'), add('H', 'Heading', 'title', 'H'),
    add('▢', 'Rectangle', 'shape-rect', 'R'), add('◯', 'Ellipse', 'shape-ellipse', 'O'), add('◇', 'Diamond', 'shape-diamond', 'D'), add('⬚', 'Frame', 'frame', 'F'),
    add('☑', 'Task card…', 'task', 'K'),
    { icon: '✎', label: 'Draw with the pen', key: 'P', disabled: !ed, run: () => setTool('pen') },
    '-',
    { icon: '📋', label: clip.length ? 'Paste here' : 'Paste (copy something first)', key: '⌘V', disabled: !ed || !clip.length, run: () => paste({ x: p.x, y: p.y }) },
    { icon: '▦', label: 'Select all', key: '⌘A', run: () => { W.sel = new Set(items().filter(i => i.kind !== 'link').map(i => i.id)); drawItems(); } },
    { icon: '⤢', label: 'Zoom to fit', key: '0', run: fit },
  ]);
}

// ── Keyboard ────────────────────────────────────────────────────────────────
function onKey(e) {
  if (!W || document.querySelector('.modal-overlay, .cmdk-overlay')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') || W.editing;
  if (e.key === 'Escape' && document.getElementById('wb-menu')) { e.preventDefault(); closeMenu(); return; }
  if (e.key === 'Escape' && !typing) { e.preventDefault(); if (W.sel.size || W.linkFrom || W.tool !== 'select') { W.sel.clear(); W.linkFrom = ''; setTool('select'); } else closeWhiteboards(); return; }
  if (!typing && (e.ctrlKey || e.metaKey) && W.boardId) {
    const k = e.key.toLowerCase();
    if (k === 'c' && W.sel.size) { e.preventDefault(); copySelection(); return; }
    if (k === 'v' && clip.length && canEdit()) { e.preventDefault(); paste(null); return; }
    if (k === 'd' && W.sel.size && canEdit()) { e.preventDefault(); duplicateSelection(); return; }
    if (k === 'a') { e.preventDefault(); W.sel = new Set(items().filter(i => i.kind !== 'link').map(i => i.id)); drawItems(); return; }
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && W.sel.size && canEdit()) { e.preventDefault(); deleteSelection(); return; }
  if (e.key === 'Enter' && W.sel.size === 1) { const i = itemById([...W.sel][0]); if (i && i.kind !== 'link' && i.kind !== 'task' && canEdit()) { e.preventDefault(); editText(i); } return; }
  if (e.key.startsWith('Arrow') && W.sel.size && canEdit()) {
    e.preventDefault(); const d = e.shiftKey ? 50 : 10; const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    write([...W.sel].map(itemById).filter(i => i && i.kind !== 'link').map(i => put({ ...i, x: i.x + dx, y: i.y + dy }))); return;
  }
  if (e.key === '+' || e.key === '=') { zoomBy(1); return; }
  if (e.key === '-') { zoomBy(-1); return; }
  if (e.key === '0') { fit(); return; }
  const t = TOOLS.find(x => x[3] === e.key.toLowerCase()); if (t && W.boardId && (canEdit() || t[0] === 'select')) { e.preventDefault(); setTool(t[0]); }
}
// Focusing an item with Tab selects it (keyboard users).
document.addEventListener('focusin', (e) => {
  if (!W || !W.world || W.editing) return; const n = e.target.closest && e.target.closest('.wb-item'); if (!n || !W.world.contains(n)) return;
  if (!W.sel.has(n.dataset.id) || W.sel.size !== 1) { W.sel = new Set([n.dataset.id]); n.classList.add('sel'); drawFloat(); }
});
