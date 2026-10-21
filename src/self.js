// ─────────────────────────────────────────────────────────────────────────────
//  SelfTrack: your own space next to your teams (#/me, #/me/week, #/me/growth).
//  Today: the day's tasks, habit orbs to tick, this week's goals, and the tasks
//  your teams assigned you. Week: areas × days. Growth: habits, skills and
//  learnings as glowing orbs, a throwback and a weekly reflection.
//  Only you can read it (firestore.rules ▸ selfItems). Logic: self-model.js.
// ─────────────────────────────────────────────────────────────────────────────
import './self.css';
import { el, modal, toast } from './ui.js';
import { newId, gateOnTheWay } from './model.js';
import * as M from './self-model.js';

const VIEWS = { today: 'Today', week: 'Week', growth: 'Growth' };
let S = null;   // the open SelfTrack screen
const todayISO = () => M.iso(Date.now());
const short = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const weekday = (s, len = 'short') => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { weekday: len });
const longDay = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

// ── The orb ─────────────────────────────────────────────────────────────────
const svg = (tag, attrs = {}) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v))); return n; };
const paletteOf = (item) => { let h = 0; String(item.id || item.title || '').split('').forEach(ch => { h = (h * 31 + ch.charCodeAt(0)) >>> 0; }); return h % M.ORB_PALETTES.length; };
/**
 * A glowing, slowly swirling orb (like the old Siri orb). pct 0–1 fills the ring, and the
 * more progress, the brighter it glows and the faster it turns. Still for reduced motion.
 */
export function orb({ size = 84, pct = 0, palette = 0, main = '', sub = '', label = '', ring = true, pop = false } = {}) {
  const [a, b, c] = M.ORB_PALETTES[((palette % 6) + 6) % 6];
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  const node = el('span.orb' + (pop ? '.pop' : '') + (p >= 1 ? '.full' : ''), {
    role: label ? 'img' : undefined, 'aria-label': label || undefined, 'aria-hidden': label ? undefined : 'true',
    style: { '--a': a, '--b': b, '--c': c, '--o': (0.4 + 0.58 * p).toFixed(2), '--spin': (11 - 6 * p).toFixed(1) + 's', '--fs': Math.max(11, Math.round(size * 0.19)) + 'px', '--blur': Math.max(5, Math.round(size * 0.1)) + 'px', width: size + 'px', height: size + 'px' },
  }, el('span.orb-l1'), el('span.orb-l2'));
  if (ring) {
    const s = svg('svg', { viewBox: '0 0 100 100', class: 'orb-ring' });
    s.append(svg('circle', { cx: 50, cy: 50, r: 47, fill: 'none', 'stroke-width': 3, class: 'orb-track' }));
    if (p > 0) s.append(svg('circle', { cx: 50, cy: 50, r: 47, fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round', pathLength: 100, 'stroke-dasharray': (p * 100).toFixed(1) + ' 100', class: 'orb-arc' }));
    node.append(s);
  }
  node.append(el('span.orb-core', {}, main !== '' ? el('b', {}, main) : '', sub ? el('small', {}, sub) : ''));
  return node;
}

// ── Open / close ────────────────────────────────────────────────────────────
/** ctx = { backend, user, goHome, openTaskIn(teamId, taskId), appName, demo, invalidateWork() } */
export function openSelf(root, ctx, view = 'today') {
  if (!VIEWS[view]) view = 'today';
  if (S && S.uid === ctx.user.uid && S.root === root) { S.view = view; document.title = 'SelfTrack'; render(); return; }
  closeSelf();
  const today = todayISO();
  S = { root, ctx, uid: ctx.user.uid, items: [], loaded: false, error: '', view, day: today, week: M.mondayOf(today), teams: [], work: [], workAt: 0, unsubs: [], adding: null, tb: 30, popId: '', redrawModal: null };
  document.title = 'SelfTrack';
  const s = S;
  s.unsubs.push(ctx.backend.data.watchSelf(s.uid, (items) => {
    if (S !== s) return;
    s.items = items; s.loaded = true; s.error = ''; render();
    if (s.redrawModal) s.redrawModal();
  }, (e) => { if (S !== s) return; console.error(e); s.loaded = true; s.error = 'Couldn’t load SelfTrack: ' + (e.message || e); render(); }));
  // Your teams, for the tasks they assign you.
  let key = '';
  s.unsubs.push(ctx.backend.data.watchMyTeams(s.uid, (teams) => {
    if (S !== s) return;
    s.teams = teams.slice().sort((a, b) => a.name.localeCompare(b.name));
    const k = s.teams.map(t => t.id).join(','); if (k !== key) { key = k; loadWork(); }
    render();
  }, (e) => console.warn('SelfTrack teams', e)));
  // Keep the synced team tasks fresh: every few minutes, and when you come back to the tab.
  const tick = setInterval(() => loadWork(), 3 * 60e3);
  const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - s.workAt > 60e3) loadWork(); };
  document.addEventListener('visibilitychange', onVis);
  // The day changes at midnight with the screen open.
  const dayTick = setInterval(() => { const t = todayISO(); if (s.lastToday && s.lastToday !== t) { if (s.day === s.lastToday) s.day = t; render(); } s.lastToday = t; }, 60e3);
  s.lastToday = today;
  s.unsubs.push(() => { clearInterval(tick); clearInterval(dayTick); document.removeEventListener('visibilitychange', onVis); });
  render();
}
export function closeSelf() {
  if (!S) return;
  S.unsubs.forEach(u => { try { u && u(); } catch { /* */ } });
  const name = S.ctx.appName; S = null;
  document.title = name || document.title;
}
export const selfOpen = () => !!S;

async function loadWork() {
  const s = S; if (!s) return;
  const ids = s.teams.map(t => t.id);
  if (!ids.length) { s.work = []; s.workAt = Date.now(); render(); return; }
  try { const w = await s.ctx.backend.data.myWork(ids, s.uid); if (S !== s) return; s.work = w; s.workAt = Date.now(); s.workError = ''; render(); }
  catch (e) { if (S !== s) return; console.warn(e); s.workError = 'Couldn’t load your team tasks.'; render(); }
}

// ── Saving ──────────────────────────────────────────────────────────────────
/** Save one item (whole document). Returns its id straight away; the screen updates when it lands. */
function save(item) {
  const id = item.id || newId('s');
  const data = M.cleanSelfItem({ ...item, updatedAt: Date.now() }, S.uid);
  S.ctx.backend.data.commit(null, [{ type: 'set', path: '/selfItems/' + id, data }])
    .catch(e => { console.error(e); toast('Couldn’t save: ' + (e.message || e), 5000); });
  return id;
}
function saveMany(items) {
  const ops = items.map(item => ({ type: 'set', path: '/selfItems/' + (item.id || newId('s')), data: M.cleanSelfItem({ ...item, updatedAt: Date.now() }, S.uid) }));
  return S.ctx.backend.data.commit(null, ops).catch(e => { console.error(e); toast('Couldn’t save: ' + (e.message || e), 5000); });
}
function removeItem(id, label = 'Deleted.') {
  const old = S.items.find(i => i.id === id);
  S.ctx.backend.data.commit(null, [{ type: 'delete', path: '/selfItems/' + id }])
    .then(() => { if (old && S) toast(label, 5000, 'Undo', () => save(old)); })
    .catch(e => { console.error(e); toast('Couldn’t delete: ' + (e.message || e), 5000); });
}
const item = (id) => S.items.find(i => i.id === id);
const settings = () => M.settingsOf(S.items, S.uid);
const areaOf = (id) => settings().areas.find(a => a.id === id);
const habits = () => S.items.filter(i => i.kind === 'habit' && !i.archived).sort((a, b) => a.createdAt - b.createdAt);
const skills = () => S.items.filter(i => i.kind === 'skill' && !i.archived).sort((a, b) => a.createdAt - b.createdAt);
function saveSettings(patch) { const cur = settings(); save({ ...cur, ...patch, id: M.settingsId(S.uid), kind: 'settings' }); }

// ── Rendering ───────────────────────────────────────────────────────────────
/** Re-render without losing what you were typing (inputs keep their value and focus). */
function render() {
  if (!S) return;
  const root = S.root; const active = document.activeElement;
  const kept = {}; root.querySelectorAll('input[id], textarea[id], select[id]').forEach(n => { if (n.type !== 'checkbox') kept[n.id] = n.value; });
  const focusId = active && root.contains(active) ? active.id : '';
  const sel = focusId && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
  const y = window.scrollY;
  root.replaceChildren(header(), el('main.sf-main', { id: 'sf-main' }, body()));
  Object.entries(kept).forEach(([id, v]) => { const n = root.querySelector('#' + CSS.escape(id)); if (n) n.value = v; });
  if (focusId) { const n = root.querySelector('#' + CSS.escape(focusId)); if (n) { n.focus({ preventScroll: true }); if (sel && n.setSelectionRange) { try { n.setSelectionRange(sel[0], sel[1]); } catch { /* */ } } } }
  window.scrollTo(0, y);
}
function header() {
  return el('header.app-header.sf-head', {},
    el('button.btn.small.ghost', { type: 'button', id: 'sf-home', onclick: () => S.ctx.goHome() }, '← Home'),
    el('span.sf-brand', {}, el('b.sf-logo', {}, 'SelfTrack'), el('span.sf-sub', {}, '· My life')),
    el('span.sf-private', { title: 'Only you can see SelfTrack. Your teams never do.' }, '🔒 Only you'),
    el('span.spacer'),
    el('nav.sf-tabs', { 'aria-label': 'SelfTrack views' }, Object.entries(VIEWS).map(([v, label]) =>
      el('a.sf-tab' + (v === S.view ? '.on' : ''), { href: '#/me/' + v, id: 'sf-tab-' + v, 'aria-current': v === S.view ? 'page' : undefined }, label))),
    el('button.btn.small.ghost', { type: 'button', id: 'sf-settings', onclick: openSettings, 'aria-label': 'SelfTrack settings', title: 'Areas and team sync' }, '⚙'));
}
function body() {
  if (S.error) return el('div.banner', {}, S.error);
  if (!S.loaded) return el('div.muted', {}, 'Loading SelfTrack…');
  if (S.view === 'week') return weekView();
  if (S.view === 'growth') return growthView();
  return todayView();
}
const chip = (areaId) => { const a = areaOf(areaId); return a ? el('span.sf-chip', { style: { '--chip': a.color } }, a.name) : ''; };
function areaSelect(id, value = '') {
  return el('select', { id, 'aria-label': 'Area' }, el('option', { value: '' }, 'No area'), settings().areas.map(a => el('option', { value: a.id, selected: a.id === value }, a.name)));
}

// ── Today ───────────────────────────────────────────────────────────────────
function todayView() {
  const today = todayISO(); const day = S.day; const isToday = day === today;
  const tasks = M.tasksForDay(S.items, day, today);
  const done = tasks.filter(t => t.done).length;
  const nav = el('div.sf-daynav', {},
    el('button.sf-iconbtn', { type: 'button', 'aria-label': 'Previous day', onclick: () => { S.day = M.addDays(S.day, -1); render(); } }, '‹'),
    el('h1', { id: 'sf-day-title' }, isToday ? 'Today · ' + longDay(day) : longDay(day)),
    el('button.sf-iconbtn', { type: 'button', 'aria-label': 'Next day', onclick: () => { S.day = M.addDays(S.day, 1); render(); } }, '›'),
    isToday ? '' : el('button.btn.small', { type: 'button', onclick: () => { S.day = today; render(); } }, 'Back to today'),
    el('span.spacer'), el('span.hint', { id: 'sf-day-count' }, tasks.length ? done + ' of ' + tasks.length + ' done' : ''));
  const main = el('div.sf-col', {}, nav, habitStrip(day), dayTasksCard(tasks, day, today));
  const aside = el('div.sf-col', {}, weekGoalsCard(M.mondayOf(day), M.mondayOf(today)), syncCard(today));
  const empty = !S.items.some(i => i.kind !== 'settings');
  return el('div', {}, empty ? welcomeCard() : '', el('div.sf-cols', {}, main, aside));
}
function welcomeCard() {
  return el('section.sf-card.sf-welcome', { id: 'sf-welcome' },
    orb({ size: 72, pct: 0.7, palette: 4, ring: false }),
    el('div', {}, el('h2', {}, 'Welcome to SelfTrack'),
      el('p.hint', {}, 'Your own space for days, weekly goals, habits and skills. Add a task below, or track a habit in Growth. Nobody else can see this, not even your teams.'),
      el('div.row', { style: { gap: '8px', flexWrap: 'wrap' } },
        el('button.btn.small.primary', { type: 'button', onclick: () => { location.hash = '#/me/growth'; setTimeout(() => openTracker('habit'), 50); } }, '+ Track a habit'),
        S.ctx.demo ? el('button.btn.small', { type: 'button', id: 'sf-fill-sample', onclick: fillSample }, 'Fill with an example') : '')));
}
function fillSample() {
  saveMany(M.sampleSelf(todayISO()).map(x => ({ ...x }))).then(() => toast('Example added: a month of habits, skills and reflections.'));
}
function habitStrip(day) {
  const list = habits();
  const sec = el('section.sf-card', { id: 'sf-habits' }, el('div.sf-card-head', {}, el('h2.sf-kicker', {}, day === todayISO() ? 'Habits today · tap to check in' : 'Habits on ' + short(day)), el('span.spacer'),
    el('button.btn.small.ghost', { type: 'button', onclick: () => openTracker('habit') }, '+ Habit')));
  if (!list.length) { sec.append(el('p.sf-empty', {}, 'No habits yet. Things you want to do regularly, like the gym three times a week or reading every day.')); return sec; }
  const row = el('div.sf-habits');
  list.forEach(h => row.append(habitOrb(h, day, 84)));
  sec.append(row); return sec;
}
function habitOrb(h, day, size) {
  const mon = M.mondayOf(day); const count = M.habitWeekCount(h, mon); const doneToday = M.habitDoneOn(h, day);
  const streak = M.habitStreak(h, todayISO()); const goal = h.goal || 7;
  const main = doneToday ? '✓' : goal < 7 ? count + '/' + goal : 'Tap';
  const sub = streak.n >= 2 ? '🔥 ' + streak.n + (streak.unit === 'day' ? '-day' : '-week') + ' streak' : goal < 7 ? count + ' of ' + goal + ' this week' : doneToday ? 'Done' : 'Not yet';
  return el('div.sf-habit', {},
    el('button.sf-orb-btn', { type: 'button', 'aria-pressed': doneToday ? 'true' : 'false', 'aria-label': h.title + (doneToday ? ', done' : ', not done') + ' on ' + short(day) + '. ' + sub, dataset: { habit: h.id },
      onclick: () => { S.popId = h.id; setTimeout(() => { if (S && S.popId === h.id) S.popId = ''; }, 900); save({ ...h, log: M.toggleHabit(h, day) }); } },
    orb({ size, pct: Math.min(1, count / goal), palette: paletteOf(h), main, pop: S.popId === h.id })),
    el('button.sf-habit-name', { type: 'button', onclick: () => openHabit(h.id), title: 'Edit, or tick past days' }, h.title),
    el('span.sf-habit-sub', {}, sub));
}
function taskRow(t, today, { compact = false } = {}) {
  const box = el('input', { type: 'checkbox', checked: !!t.done, 'aria-label': (t.done ? 'Not done: ' : 'Done: ') + t.title,
    onchange: () => save({ ...t, done: !t.done, doneOn: !t.done ? today : '', date: !t.done && t.late && t.scope === 'day' ? S.day : t.date }) });
  const late = t.late ? el('small.sf-late', { title: 'Carried over' }, t.scope === 'week' ? '↪ from ' + (t.late === 1 ? 'last week' : t.late + ' weeks ago') : '↪ from ' + (t.late === 1 ? 'yesterday' : weekday(t.date))) : '';
  return el('li.sf-task' + (t.done ? '.done' : ''), { dataset: { id: t.id } },
    el('label.sf-task-main', {}, box, el('span.sf-task-title', {}, el('span', {}, t.title), late)),
    el('span.sf-task-meta', {}, compact ? '' : chip(t.area),
      t.done || t.scope !== 'day' ? '' : el('button.sf-x', { type: 'button', title: 'Do it tomorrow', 'aria-label': 'Move to tomorrow: ' + t.title, onclick: () => save({ ...t, date: M.addDays(S.day, 1) }) }, '→'),
      el('button.sf-x', { type: 'button', 'aria-label': 'Delete: ' + t.title, onclick: () => removeItem(t.id, 'Task deleted.') }, '×')));
}
function addTaskForm(id, { scope, date, area = '', placeholder }) {
  const input = el('input', { type: 'text', id, maxlength: 300, placeholder, 'aria-label': placeholder, autocomplete: 'off' });
  const sel = areaSelect(id + '-area', area);
  const forSel = scope === 'day' ? el('select', { id: id + '-for', 'aria-label': 'For' }, el('option', { value: 'day' }, 'This day'), el('option', { value: 'week' }, 'This week')) : null;
  return el('form.sf-add', { onsubmit: (e) => {
    e.preventDefault();
    const q = M.parseQuickAdd(input.value, settings().areas); if (!q.title) { input.focus(); return; }
    const sc = forSel ? forSel.value : scope;
    input.value = '';   // before saving: the screen may redraw straight away
    save({ kind: 'task', title: q.title, area: q.area || sel.value, scope: sc, date: sc === 'week' ? M.mondayOf(date) : date, done: false, order: Date.now() / 1e3, createdAt: Date.now() });
    const again = S && S.root.querySelector('#' + id); if (again) again.focus();
  } }, input, forSel, sel, el('button.btn.primary', { type: 'submit' }, 'Add'));
}
function dayTasksCard(tasks, day, today) {
  const sec = el('section.sf-card', { id: 'sf-day-tasks' }, el('div.sf-card-head', {}, el('h2.sf-kicker', {}, day === today ? 'Today’s tasks' : 'Tasks for ' + short(day)), el('span.spacer'),
    el('span.hint', {}, 'Unfinished tasks move to the next day')));
  sec.append(tasks.length ? el('ul.sf-list', { id: 'sf-day-list' }, tasks.map(t => taskRow(t, today))) : el('p.sf-empty', {}, 'Nothing planned for this day.'));
  sec.append(addTaskForm('sf-new', { scope: 'day', date: day, placeholder: 'Add a task… (#uni picks an area)' }));
  return sec;
}
function weekGoalsCard(monday, thisMonday) {
  const goals = M.tasksForWeek(S.items, monday, thisMonday); const done = goals.filter(t => t.done).length;
  const sec = el('section.sf-card', { id: 'sf-week-goals' }, el('div.sf-card-head', {}, el('h2', {}, monday === thisMonday ? 'This week’s goals' : 'Goals, week of ' + short(monday)), el('span.spacer'), el('span.hint', {}, goals.length ? done + '/' + goals.length : '')),
    el('p.hint.sf-under', {}, 'Weekly tasks: do them any day this week.'));
  sec.append(goals.length ? el('ul.sf-list', {}, goals.map(t => taskRow(t, todayISO(), { compact: true }))) : el('p.sf-empty', {}, 'No goals for this week yet.'));
  sec.append(addTaskForm('sf-goal-new', { scope: 'week', date: monday, placeholder: 'Add a weekly goal' }));
  return sec;
}

// ── Synced from your teams ──────────────────────────────────────────────────
function syncCard(today) {
  const set = settings(); const rows = M.syncedTeamTasks(S.work, S.uid, today, set.sync);
  const sec = el('section.sf-card', { id: 'sf-sync' }, el('div.sf-card-head', {}, el('h2', {}, 'Synced from your teams'), el('span.spacer'),
    S.workAt ? el('span.sf-live', { title: 'Updated ' + new Date(S.workAt).toLocaleTimeString() }, '● Live') : ''),
  el('p.hint.sf-under', {}, 'Your team tasks for this week. Tick one here and the team board updates too.'));
  if (!S.teams.length) { sec.append(el('p.sf-empty', {}, 'You’re not in a team yet. When a team assigns you tasks, they show up here.')); return sec; }
  const toggles = el('div.sf-sync-teams');
  S.teams.forEach(t => toggles.append(el('label.sf-sync-team', {},
    el('input', { type: 'checkbox', checked: set.sync[t.id] !== false, 'aria-label': 'Show tasks from ' + t.name, onchange: (e) => saveSettings({ sync: { ...set.sync, [t.id]: e.target.checked } }) }),
    el('span', {}, t.name), el('span.hint', {}, set.sync[t.id] === false ? 'Hidden' : rows.filter(r => r.teamId === t.id).length + ' this week'))));
  sec.append(toggles);
  if (S.workError) sec.append(el('p.sf-empty', {}, S.workError));
  else if (!S.workAt) sec.append(el('p.sf-empty', {}, 'Loading your team tasks…'));
  else if (!rows.length) sec.append(el('p.sf-empty', {}, 'Nothing from your teams this week.'));
  else sec.append(el('ul.sf-list', { id: 'sf-sync-list' }, rows.map(r => el('li.sf-task.sf-team-task', { dataset: { team: r.teamId, id: r.id } },
    r.support ? el('span.sf-support', { title: 'You’re supporting this task' }, '🤝') : gateFor(r) ? el('span.sf-support.sf-gated', { title: 'Needs a ' + gateFor(r).name + ' sign-off before it can be done. Open it on the team board.' }, '🔒') : el('input', { type: 'checkbox', 'aria-label': 'Mark done in ' + r.team + ': ' + r.name, onchange: (e) => { e.target.disabled = true; completeTeamTask(r); } }),
    el('button.sf-team-open', { type: 'button', onclick: () => S.ctx.openTaskIn(r.teamId, r.id), title: 'Open in ' + r.team },
      el('span.sf-task-title', {}, r.name), el('small', {}, [r.team, r.weekTitle, r.dueDate ? (r.late ? r.late + (r.late === 1 ? ' day' : ' days') + ' late' : 'due ' + weekday(r.dueDate) + ' ' + short(r.dueDate)) : ''].filter(Boolean).join(' · ')))))));
  return sec;
}
const stamp = () => { const n = new Date(); let h = n.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return String(n.getDate()).padStart(2, '0') + '/' + n.toLocaleString('default', { month: 'short' }) + '/' + String(n.getFullYear()).slice(-2) + ' ' + h + ':' + String(n.getMinutes()).padStart(2, '0') + ' ' + ap; };
/** A sign-off stage the task still has to pass before it can be done (its team's workflow), or null. */
function gateFor(r) {
  const w = S.work.find(x => x.teamId === r.teamId); const t = w && w.tasks.find(x => x.id === r.id); if (!t) return null;
  const team = w.team || S.teams.find(x => x.id === r.teamId); const stages = (team && team.workflow && team.workflow.stages) || [];
  if (!stages.some(x => x.signoff)) return null;
  const from = stages.some(x => x.id === t.stage) ? t.stage : stages[0].id;
  return gateOnTheWay(t, stages, from, stages[stages.length - 1].id);
}
/** Tick a team task from SelfTrack: saved to the team's board, with a line in its history. */
async function completeTeamTask(r) {
  const s = S; const w = s.work.find(x => x.teamId === r.teamId); const t = w && w.tasks.find(x => x.id === r.id); if (!t) return;
  const me = s.ctx.user; const old = t.flag;
  const gate = gateFor(r); if (gate) { toast('This one needs a ' + gate.name + ' sign-off first. Open it on the team board.', 5000); render(); return; }
  const history = [{ time: stamp(), user: me.name || 'Someone', field: 'Task Status Flag', original: String(old || 'none'), updated: 'completed (from SelfTrack)' }, ...(t.history || [])].slice(0, 100);
  t.flag = 'completed'; render();
  try {
    await s.ctx.backend.data.commit(r.teamId, [{ type: 'update', path: 'tasks/' + r.id, data: { flag: 'completed', completedDate: todayISO(), history, updatedBy: me.name || '', updatedAt: Date.now() } }]);
    if (s.ctx.invalidateWork) s.ctx.invalidateWork();
    toast('Done, and ticked on the ' + r.team + ' board too.');
  } catch (e) { console.error(e); t.flag = old; if (S === s) render(); toast('Couldn’t update the team board: ' + (e.message || e), 6000); }
}

// ── Week ────────────────────────────────────────────────────────────────────
function weekView() {
  const today = todayISO(); const mon = S.week; const thisMon = M.mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => M.addDays(mon, i));
  const all = M.weekTasks(S.items, mon).filter(t => t.kind === 'task');
  const goals = M.tasksForWeek(S.items, mon, thisMon);
  const areas = settings().areas; const known = new Set(areas.map(a => a.id));
  const rows = [...areas.map(a => ({ id: a.id, name: a.name, color: a.color })), { id: '', name: 'Other', color: '#a0aec0' }]
    .filter(r => r.id !== '' || all.some(t => !known.has(t.area)) || goals.some(t => !known.has(t.area)));
  const inRow = (r) => (t) => (r.id === '' ? !known.has(t.area) : t.area === r.id);
  const done = all.filter(t => t.done).length;
  const nav = el('div.sf-daynav', {},
    el('button.sf-iconbtn', { type: 'button', 'aria-label': 'Previous week', onclick: () => { S.week = M.addDays(S.week, -7); render(); } }, '‹'),
    el('h1', { id: 'sf-week-title' }, (mon === thisMon ? 'This week · ' : 'Week of ') + short(mon) + ' – ' + short(M.addDays(mon, 6))),
    el('button.sf-iconbtn', { type: 'button', 'aria-label': 'Next week', onclick: () => { S.week = M.addDays(S.week, 7); render(); } }, '›'),
    mon === thisMon ? '' : el('button.btn.small', { type: 'button', onclick: () => { S.week = thisMon; render(); } }, 'This week'),
    el('span.spacer'), el('span.hint', {}, all.length ? done + ' of ' + all.length + ' done' : ''),
    el('button.btn.primary', { type: 'button', id: 'sf-review-btn', onclick: () => openReview(mon) }, 'Sunday review'));
  const hs = habits();
  const strip = hs.length ? el('div.sf-habit-pills', { 'aria-label': 'Habits this week' }, el('span.sf-kicker', {}, 'Habits this week'),
    hs.map(h => { const n = M.habitWeekCount(h, mon); const g = h.goal || 7; return el('button.sf-pill' + (n >= g ? '.met' : ''), { type: 'button', onclick: () => openHabit(h.id) }, h.title + ' ', el('b', {}, n + '/' + g)); })) : '';
  const grid = el('div.sf-weekgrid', { id: 'sf-weekgrid', role: 'table', 'aria-label': 'Tasks by area and day' });
  grid.append(el('div.sf-wh', { role: 'columnheader' }, ''), el('div.sf-wh', { role: 'columnheader' }, 'Week goals'),
    ...days.map(d => el('div.sf-wh' + (d === today ? '.today' : ''), { role: 'columnheader' }, weekday(d) + ' ' + new Date(d + 'T12:00:00').getDate())));
  rows.forEach(r => {
    grid.append(el('div.sf-area', { role: 'rowheader', style: { '--chip': r.color } }, el('span.sf-dot'), r.name));
    grid.append(cell(goals.filter(inRow(r)), { scope: 'week', date: mon, area: r.id, today }));
    days.forEach(d => grid.append(cell(all.filter(t => t.scope === 'day' && t.date === d).filter(inRow(r)), { scope: 'day', date: d, area: r.id, today, isToday: d === today })));
  });
  // Your team tasks this week, by due day.
  const synced = mon === thisMon ? M.syncedTeamTasks(S.work, S.uid, today, settings().sync) : [];
  if (synced.length) {
    grid.append(el('div.sf-area.sf-area-teams', { role: 'rowheader', style: { '--chip': '#f6ad55' } }, el('span.sf-dot'), 'From teams'));
    const teamChip = (r) => el('button.sf-mini.team', { type: 'button', onclick: () => S.ctx.openTaskIn(r.teamId, r.id), title: r.team }, el('span', {}, r.name), el('small', {}, r.team));
    grid.append(el('div.sf-cell', {}, synced.filter(r => !r.dueDate || r.dueDate < mon || r.dueDate > M.addDays(mon, 6)).map(teamChip)));
    days.forEach(d => grid.append(el('div.sf-cell' + (d === today ? '.today' : ''), {}, synced.filter(r => r.dueDate === d).map(teamChip))));
  }
  return el('div.sf-col', {}, nav, strip, el('div.sf-weekgrid-wrap', {}, grid));
}
function cell(tasks, { scope, date, area, today, isToday }) {
  const key = scope + '|' + date + '|' + area; const adding = S.adding === key;
  const box = el('div.sf-cell' + (isToday ? '.today' : ''), { role: 'cell' }, tasks.map(t => el('label.sf-mini' + (t.done ? '.done' : ''), { title: t.title },
    el('input', { type: 'checkbox', checked: !!t.done, 'aria-label': (t.done ? 'Not done: ' : 'Done: ') + t.title, onchange: () => save({ ...t, done: !t.done, doneOn: !t.done ? today : '', date: !t.done && t.late ? (scope === 'week' ? date : t.date) : t.date }) }),
    el('span', {}, t.title))));
  if (adding) {
    const id = 'sf-cell-input';
    const commit = (input) => { const q = M.parseQuickAdd(input.value, settings().areas); S.adding = null; if (q.title) save({ kind: 'task', title: q.title, area: q.area || area, scope, date, done: false, order: Date.now() / 1e3, createdAt: Date.now() }); render(); };
    const input = el('input.sf-cell-input', { type: 'text', id, maxlength: 300, placeholder: 'New task', 'aria-label': 'New task',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(e.target); } else if (e.key === 'Escape') { S.adding = null; render(); } },
      onblur: (e) => { if (S && S.adding === key) commit(e.target); } });
    box.append(input); setTimeout(() => input.focus(), 0);
  } else box.append(el('button.sf-cell-add', { type: 'button', 'aria-label': 'Add a task' + (scope === 'week' ? ' for the week' : ' on ' + weekday(date, 'long')), onclick: () => { S.adding = key; render(); } }, '+'));
  return box;
}

// ── Sunday review ───────────────────────────────────────────────────────────
function openReview(mon) {
  const next = M.addDays(mon, 7);
  const all = M.weekTasks(S.items, mon); const open = all.filter(t => !t.done);
  const ref = S.items.find(i => i.id === M.reflectId(S.uid, mon)) || { kind: 'reflect', date: mon, well: '', hard: '', mood: 0 };
  const m = modal('Sunday review · ' + short(mon) + ' – ' + short(M.addDays(mon, 6))); m.box.classList.add('sf-modal');
  const areas = settings().areas;
  const counts = el('div.sf-review-areas', {}, [...areas, { id: '', name: 'Other', color: '#a0aec0' }].map(a => {
    const list = all.filter(t => (a.id === '' ? !areas.some(x => x.id === t.area) : t.area === a.id)); if (!list.length) return '';
    const d = list.filter(t => t.done).length;
    return el('div.sf-review-area', { style: { '--chip': a.color } }, el('b', {}, a.name), el('span.sf-review-n', {}, d + '/' + list.length), el('span.sf-bar', {}, el('span', { style: { width: Math.round(100 * d / list.length) + '%' } })));
  }));
  const hs = habits().map(h => el('span.sf-pill', {}, h.title + ' ', el('b', {}, M.habitWeekCount(h, mon) + '/' + (h.goal || 7))));
  const decisions = new Map(open.map(t => [t.id, 'next']));
  const openList = el('ul.sf-list', { id: 'sf-review-open' }, open.map(t => {
    const seg = el('div.sf-seg', { role: 'group', 'aria-label': 'What happens to ' + t.title });
    const opts = [['next', 'Next week'], ['keep', 'Leave it'], ['drop', 'Drop']];
    const draw = () => { seg.replaceChildren(...opts.map(([v, l]) => el('button.btn.small', { type: 'button', 'aria-pressed': decisions.get(t.id) === v ? 'true' : 'false', onclick: () => { decisions.set(t.id, v); draw(); } }, l))); };
    draw();
    return el('li.sf-task', {}, el('span.sf-task-title', {}, t.title), chip(t.area), seg);
  }));
  const well = el('textarea', { id: 'sf-rev-well', rows: 2, maxlength: 2000, placeholder: 'A win, big or small' }); well.value = ref.well || '';
  const hard = el('textarea', { id: 'sf-rev-hard', rows: 2, maxlength: 2000, placeholder: 'So next week can be easier' }); hard.value = ref.hard || '';
  let mood = ref.mood || 0; const moodBox = el('div.sf-seg', { role: 'group', 'aria-label': 'How was the week?' });
  const MOODS = ['😣 Rough', '😐 OK', '🙂 Good', '🤩 Great'];
  const drawMood = () => moodBox.replaceChildren(...MOODS.map((l, i) => el('button.btn.small', { type: 'button', 'aria-pressed': mood === i + 1 ? 'true' : 'false', onclick: () => { mood = mood === i + 1 ? 0 : i + 1; drawMood(); } }, l)));
  drawMood();
  const tops = [1, 2, 3].map(n => el('input', { type: 'text', id: 'sf-top-' + n, maxlength: 300, placeholder: n === 3 ? 'One thing just for you' : 'Priority ' + n, 'aria-label': 'Priority ' + n + ' for next week' }));
  m.body.append(
    el('h4', {}, '1. What you got done'), all.length ? counts : el('p.hint', {}, 'No tasks this week.'), hs.length ? el('div.sf-habit-pills', {}, hs) : '',
    el('h4', {}, '2. Not finished: what happens to them?'), open.length ? openList : el('p.hint', {}, 'Everything’s done. 🎉'),
    el('h4', {}, '3. Reflect'), el('label.field', {}, el('span', {}, 'What went well?'), well), el('label.field', {}, el('span', {}, 'What got in the way?'), hard), el('div.field', {}, el('span', {}, 'How was the week?'), moodBox),
    el('h4', {}, '4. Next week: your top 3'), el('div.sf-tops', {}, tops));
  m.foot.append(el('span.hint', {}, 'Only you see this.'), el('span.spacer'), el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Later'),
    el('button.btn.primary', { type: 'button', id: 'sf-review-done', onclick: () => {
      const out = [];
      open.forEach(t => { const d = decisions.get(t.id); if (d === 'next') out.push({ ...t, scope: 'week', date: next, late: undefined }); });
      out.push({ ...ref, id: M.reflectId(S.uid, mon), kind: 'reflect', date: mon, well: well.value, hard: hard.value, mood });
      tops.forEach((inp, i) => { const q = M.parseQuickAdd(inp.value, settings().areas); if (q.title) out.push({ kind: 'task', title: q.title, area: q.area, scope: 'week', date: next, order: i, createdAt: Date.now() }); });
      const drops = open.filter(t => decisions.get(t.id) === 'drop').map(t => ({ type: 'delete', path: '/selfItems/' + t.id }));
      const ops = out.map(x => ({ type: 'set', path: '/selfItems/' + (x.id || newId('s')), data: M.cleanSelfItem({ ...x, updatedAt: Date.now() }, S.uid) })).concat(drops);
      S.ctx.backend.data.commit(null, ops).catch(e => toast('Couldn’t save the review: ' + (e.message || e), 6000));
      m.close(); if (S.week === mon) { S.week = next; render(); }
      toast('Review saved. Here’s next week.');
    } }, 'Save and plan next week'));
}

// ── Growth ──────────────────────────────────────────────────────────────────
function growthView() {
  const today = todayISO(); const sum = M.monthSummary(S.items, today); const best = M.bestStreak(S.items, today);
  const pct = Math.round(sum.pct * 100);
  const headline = !sum.target && !sum.tasks && !sum.hours ? 'Track something to light this up' : pct >= 80 ? 'You’re on fire this month' : pct >= 50 ? 'You’re growing steadily' : pct > 0 ? 'A good start. Keep going' : 'A quiet month so far';
  const facts = [sum.target ? 'Habits kept ' + sum.kept + ' of ' + sum.target + ' times' : '', sum.tasks ? sum.done + ' of ' + sum.tasks + ' tasks done' : '', sum.hours ? M.fmtHours(sum.hours) + ' on skills' : '', sum.learned ? sum.learned + ' thing' + (sum.learned === 1 ? '' : 's') + ' learned' : ''].filter(Boolean).join(' · ');
  const hero = el('section.sf-card.sf-hero', { id: 'sf-hero' },
    orb({ size: 190, pct: sum.pct, palette: 4, main: pct + '%', sub: sum.month, label: 'This month: ' + pct + ' percent' }),
    el('div.sf-hero-text', {}, el('h1', {}, headline), el('p.hint', {}, facts || 'Habits, tasks and practice time this month all feed this orb. It glows brighter and turns faster the more you keep up.'),
      el('div.sf-habit-pills', {}, best ? el('span.sf-pill', {}, '🔥 Longest streak: ' + best.title + ', ' + best.n + ' ' + best.unit + (best.n === 1 ? '' : 's')) : '',
        sum.hours && sum.hoursDelta ? el('span.sf-pill', {}, (sum.hoursDelta > 0 ? '+' : '−') + M.fmtHours(Math.abs(sum.hoursDelta)) + ' practice vs last month') : ''),
      el('div.row', { style: { gap: '8px', marginTop: '10px', flexWrap: 'wrap' } }, el('button.btn.primary', { type: 'button', id: 'sf-track', onclick: () => openTracker('habit') }, '+ Track something'),
        S.ctx.demo && !S.items.some(i => i.kind === 'habit' || i.kind === 'skill') ? el('button.btn', { type: 'button', id: 'sf-fill-sample', onclick: fillSample }, 'Fill with an example') : '')));
  const hs = habits(); const sk = skills();
  const habitsCard = el('section.sf-card', { id: 'sf-g-habits' }, el('div.sf-card-head', {}, el('h2', {}, 'Habits'), el('span.hint', {}, 'things you repeat'), el('span.spacer'), el('button.btn.small.ghost', { type: 'button', onclick: () => openTracker('habit') }, '+')),
    hs.length ? el('div.sf-orbgrid', {}, hs.map(h => habitOrb(h, today, 92))) : suggestions('habit'));
  const skillsCard = el('section.sf-card', { id: 'sf-g-skills' }, el('div.sf-card-head', {}, el('h2', {}, 'Skills'), el('span.hint', {}, 'hours and levels'), el('span.spacer'), el('button.btn.small.ghost', { type: 'button', onclick: () => openTracker('skill') }, '+')),
    sk.length ? el('div.sf-col.sf-tight', {}, sk.map(s => { const lv = M.skillLevel(s); return el('button.sf-skill', { type: 'button', dataset: { skill: s.id }, onclick: () => openSkill(s.id) },
      orb({ size: 68, pct: lv.pct, palette: paletteOf(s), main: 'L' + (lv.level + 1) }),
      el('span', {}, el('b', {}, s.title), el('small', {}, M.fmtHours(lv.hours) + ' · ' + lv.name + (lv.level < 3 ? ' · next at ' + M.fmtHours(lv.nextAt) : '')))); })) : suggestions('skill'));
  const learned = S.items.filter(i => i.kind === 'learning').sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const learnInput = el('input', { type: 'text', id: 'sf-learn-new', maxlength: 300, placeholder: 'I learned that…', 'aria-label': 'Something you learned' });
  const learnSkill = el('select', { id: 'sf-learn-skill', 'aria-label': 'Which skill' }, el('option', { value: '' }, 'No skill'), sk.map(s => el('option', { value: s.id }, s.title)));
  const learnCard = el('section.sf-card', { id: 'sf-g-learn' }, el('div.sf-card-head', {}, el('h2', {}, 'Learnings'), el('span.hint', {}, 'what you picked up')),
    learned.length ? el('ul.sf-list', {}, learned.slice(0, 6).map(l => el('li.sf-learn', {}, el('span', {}, l.title), el('small', {}, [short(l.date), (item(l.skillId) || {}).title].filter(Boolean).join(' · ')),
      el('button.sf-x', { type: 'button', 'aria-label': 'Delete: ' + l.title, onclick: () => removeItem(l.id, 'Learning deleted.') }, '×')))) : el('p.sf-empty', {}, 'Write down things you figure out. You’ll love reading them back.'),
    el('form.sf-add', { onsubmit: (e) => { e.preventDefault(); const text = learnInput.value; if (!text.trim()) return; learnInput.value = ''; save({ kind: 'learning', title: text, skillId: learnSkill.value, date: today, createdAt: Date.now() }); } },
      learnInput, sk.length ? learnSkill : '', el('button.btn', { type: 'submit' }, 'Add')),
    learned.length > 6 ? el('button.btn.small.ghost', { type: 'button', onclick: openAllLearnings }, 'See all ' + learned.length) : '');
  return el('div.sf-col', {}, hero, el('div.sf-grid3', {}, habitsCard, skillsCard, learnCard), el('div.sf-grid2', {}, throwbackCard(today), reflectCard(today)));
}
function suggestions(kind) {
  const list = kind === 'habit'
    ? [['Gym', 3, 'health'], ['Read 30 min', 7, 'uni'], ['Drink 2 L water', 7, 'health'], ['Call home', 1, 'home']]
    : [['ROS 2', 100, 'uni'], ['Python', 100, 'projects'], ['Public speaking', 50, '']];
  return el('div', {}, el('p.sf-empty', {}, kind === 'habit' ? 'Try one:' : 'Practice something and watch it level up. Try one:'),
    el('div.sf-habit-pills', {}, list.map(([title, goal, area]) => el('button.sf-pill', { type: 'button', onclick: () => save({ kind, title, goal, area: areaOf(area) ? area : '', log: [], createdAt: Date.now() }) },
      '+ ' + title + (kind === 'habit' ? ' · ' + (goal === 7 ? 'daily' : goal + '× a week') : '')))));
}
function throwbackCard(today) {
  const tb = M.throwback(S.items, today, S.tb);
  return el('section.sf-card', { id: 'sf-throwback' }, el('div.sf-card-head', {}, el('h2', {}, 'Throwback'), el('span.spacer'),
    el('div.sf-seg', { role: 'group', 'aria-label': 'How far back' }, M.THROWBACKS.map(([k, n, l]) => el('button.btn.small', { type: 'button', 'aria-pressed': S.tb === n ? 'true' : 'false', dataset: { tb: k }, onclick: () => { S.tb = n; render(); } }, l.replace(' ago', ''))))),
    tb ? el('div.sf-tb', {}, orb({ size: 64, pct: 0.3, palette: 2, main: new Date(tb.date + 'T12:00:00').toLocaleDateString('en-GB', { month: 'short' }), ring: false }),
      el('p', {}, el('b', {}, tb.when + ' '), '(' + short(tb.date) + ') ' + tb.text + ' ', tb.quote ? el('q', {}, tb.quote) : '', tb.now ? el('span.sf-tb-now', {}, ' ' + tb.now) : ''))
      : el('p.sf-empty', {}, 'Nothing from then yet. Keep tracking: in a few weeks this shows how far you’ve come.'));
}
function reflectCard(today) {
  const mon = M.mondayOf(today); const id = M.reflectId(S.uid, mon);
  const ref = item(id) || { id, kind: 'reflect', date: mon, well: '', hard: '', mood: 0 };
  const put = (patch) => save({ ...ref, ...patch, id, kind: 'reflect', date: mon });
  const well = el('textarea', { id: 'sf-ref-well', rows: 2, maxlength: 2000, placeholder: 'A win, big or small', onchange: (e) => put({ well: e.target.value }) }); well.value = ref.well || '';
  const hard = el('textarea', { id: 'sf-ref-hard', rows: 2, maxlength: 2000, placeholder: 'So next week can be easier', onchange: (e) => put({ hard: e.target.value }) }); hard.value = ref.hard || '';
  const MOODS = ['😣', '😐', '🙂', '🤩']; const NAMES = ['Rough', 'OK', 'Good', 'Great'];
  return el('section.sf-card', { id: 'sf-reflect' }, el('div.sf-card-head', {}, el('h2', {}, 'Reflect'), el('span.hint', {}, 'this week')),
    el('label.field', {}, el('span', {}, 'What went well?'), well), el('label.field', {}, el('span', {}, 'What got in the way?'), hard),
    el('div.sf-mood', { role: 'group', 'aria-label': 'Mood this week' }, el('span.hint', {}, 'Mood'), MOODS.map((e, i) => el('button.sf-mood-btn', { type: 'button', 'aria-pressed': ref.mood === i + 1 ? 'true' : 'false', 'aria-label': NAMES[i], title: NAMES[i], onclick: () => put({ mood: ref.mood === i + 1 ? 0 : i + 1 }) }, e))));
}
function openAllLearnings() {
  const m = modal('Everything you’ve learned'); m.box.classList.add('sf-modal');
  const list = S.items.filter(i => i.kind === 'learning').sort((a, b) => b.date.localeCompare(a.date));
  m.body.append(el('ul.sf-list', {}, list.map(l => el('li.sf-learn', {}, el('span', {}, l.title), el('small', {}, [short(l.date), (item(l.skillId) || {}).title].filter(Boolean).join(' · '))))));
}

// ── Dialogs: track something, a habit, a skill, settings ────────────────────
function openTracker(kind = 'habit') {
  const m = modal('Track something', { narrow: true }); m.box.classList.add('sf-modal'); m.box.id = 'sf-tracker';
  let k = kind;
  const draw = () => {
    const seg = el('div.sf-seg', { role: 'group', 'aria-label': 'What to track' }, [['habit', 'Habit'], ['skill', 'Skill'], ['learning', 'Learning']].map(([v, l]) =>
      el('button.btn.small', { type: 'button', 'aria-pressed': k === v ? 'true' : 'false', dataset: { kind: v }, onclick: () => { k = v; draw(); } }, l)));
    const title = el('input', { type: 'text', id: 'sf-tr-title', maxlength: 300, required: true, placeholder: k === 'habit' ? 'e.g. Gym' : k === 'skill' ? 'e.g. ROS 2' : 'I learned that…' });
    const area = areaSelect('sf-tr-area');
    const goal = k === 'habit' ? el('select', { id: 'sf-tr-goal' }, [7, 6, 5, 4, 3, 2, 1].map(n => el('option', { value: n, selected: n === 7 }, n === 7 ? 'Every day' : n + '× a week')))
      : k === 'skill' ? el('input', { type: 'number', id: 'sf-tr-goal', min: 1, max: 10000, value: 100 }) : null;
    const hint = { habit: 'Something you repeat. Tick it off each time; the orb fills up over the week.', skill: 'Something you practise. Log time; it levels up from Beginner to Expert as you near your goal hours.', learning: 'Something you figured out, to look back on later.' }[k];
    m.body.replaceChildren(seg, el('p.hint', {}, hint),
      el('label.field', {}, el('span', {}, k === 'learning' ? 'What did you learn?' : 'Name'), title),
      goal ? el('label.field', {}, el('span', {}, k === 'habit' ? 'How often' : 'Hours to reach Expert'), goal) : '',
      el('label.field', {}, el('span', {}, 'Area'), area));
    m.foot.replaceChildren(el('span.spacer'), el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Cancel'), el('button.btn.primary', { type: 'button', id: 'sf-tr-save', onclick: () => {
      if (!title.value.trim()) { title.focus(); return; }
      save({ kind: k, title: title.value, area: area.value, goal: goal ? Number(goal.value) : undefined, log: [], date: todayISO(), createdAt: Date.now() });
      m.close(); toast(k === 'learning' ? 'Saved.' : 'Now tracking ' + title.value.trim() + '.');
    } }, 'Start tracking'));
    setTimeout(() => title.focus(), 0);
  };
  draw();
}
function openHabit(id) {
  const m = modal('Habit', { narrow: true, onClose: () => { if (S) S.redrawModal = null; } }); m.box.classList.add('sf-modal'); m.box.id = 'sf-habit-modal';
  const draw = () => {
    const h = item(id); if (!h) { m.close(); return; }
    if (m.body.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const today = todayISO(); const start = M.addDays(M.mondayOf(today), -28); const streak = M.habitStreak(h, today);
    const cal = el('div.sf-cal', { role: 'group', 'aria-label': 'Check-ins, last five weeks' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => el('span.sf-cal-h', { 'aria-hidden': 'true' }, d)),
      Array.from({ length: 35 }, (_, i) => { const d = M.addDays(start, i); const on = M.habitDoneOn(h, d); const fut = d > today;
        return el('button' + (on ? '.on' : '') + (fut ? '.future' : '') + (d === today ? '.today' : ''), { type: 'button', disabled: fut, 'aria-pressed': on ? 'true' : 'false', 'aria-label': longDay(d), title: longDay(d), onclick: () => save({ ...h, log: M.toggleHabit(h, d) }) }, String(new Date(d + 'T12:00:00').getDate())); }));
    const name = el('input', { type: 'text', id: 'sf-h-name', maxlength: 300, value: h.title });
    const goal = el('select', { id: 'sf-h-goal' }, [7, 6, 5, 4, 3, 2, 1].map(n => el('option', { value: n, selected: n === (h.goal || 7) }, n === 7 ? 'Every day' : n + '× a week')));
    const area = areaSelect('sf-h-area', h.area);
    m.body.replaceChildren(el('div.sf-modal-hero', {}, orb({ size: 120, pct: M.habitProgress(h, today), palette: paletteOf(h), main: M.habitWeekCount(h, M.mondayOf(today)) + '/' + (h.goal || 7), sub: 'this week' }),
      el('div', {}, el('b', {}, streak.n ? '🔥 ' + streak.n + ' ' + streak.unit + (streak.n === 1 ? '' : 's') + ' in a row' : 'No streak yet'), el('p.hint', {}, 'Tap a day below to tick it, including days you forgot.'))),
    cal, el('label.field', {}, el('span', {}, 'Name'), name), el('div.row', { style: { gap: '10px' } }, el('label.field', { style: { flex: 1 } }, el('span', {}, 'How often'), goal), el('label.field', { style: { flex: 1 } }, el('span', {}, 'Area'), area)));
    m.foot.replaceChildren(el('button.btn.danger.small', { type: 'button', onclick: () => { m.close(); removeItem(id, 'Habit deleted.'); } }, 'Delete'), el('span.spacer'),
      el('button.btn.primary', { type: 'button', onclick: () => { save({ ...item(id), title: name.value || h.title, goal: Number(goal.value), area: area.value }); m.close(); } }, 'Save'));
  };
  draw(); S.redrawModal = draw;
}
function openSkill(id) {
  const s0 = item(id); if (!s0) return;
  const m = modal(s0.title, { onClose: () => { if (S) S.redrawModal = null; } }); m.box.classList.add('sf-modal'); m.box.id = 'sf-skill-modal';
  const draw = () => {
    const s = item(id); if (!s) { m.close(); return; }
    if (m.body.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const today = todayISO(); const lv = M.skillLevel(s); const weeks = M.skillWeeks(s, today, 12); const maxH = Math.max(1, ...weeks.map(w => w.hours));
    const log = (mins) => { S.popId = id; save({ ...s, log: [...(s.log || []), { d: today, m: mins }] }); toast('Logged ' + M.fmtHours(mins / 60) + ' of ' + s.title + '.', 4000, 'Undo', () => { const cur = item(id); if (cur) save({ ...cur, log: (cur.log || []).slice(0, -1) }); }); };
    const custom = el('input', { type: 'number', id: 'sf-sk-mins', min: 1, max: 1440, placeholder: 'min', 'aria-label': 'Minutes practised' });
    const first = [...(s.log || [])].sort((a, b) => a.d.localeCompare(b.d))[0];
    const journey = [
      ...M.skillMilestones(s).map(x => ({ d: x.d, t: 'Reached ' + x.name, c: '#00c8ff' })),
      ...S.items.filter(i => i.kind === 'learning' && i.skillId === id).map(l => ({ d: l.date, t: 'Learned', q: l.title, c: '#7a5cff' })),
      ...(first ? [{ d: first.d, t: 'Started', c: '#a0aec0' }] : []),
    ].sort((a, b) => b.d.localeCompare(a.d));
    const note = el('input', { type: 'text', id: 'sf-sk-note', maxlength: 300, placeholder: 'What did you figure out?', 'aria-label': 'Add to the journey' });
    const goal = el('input', { type: 'number', id: 'sf-sk-goal', min: 1, max: 10000, value: s.goal || 100, 'aria-label': 'Hours to reach Expert' });
    m.body.replaceChildren(
      el('div.sf-skill-hero', {}, orb({ size: 200, pct: lv.pct, palette: paletteOf(s), main: M.fmtHours(lv.hours), sub: lv.level < 3 ? M.fmtHours(lv.nextAt - lv.hours) + ' to ' + M.SKILL_LEVELS[lv.level + 1] : 'Expert', pop: S.popId === id, label: s.title + ': ' + M.fmtHours(lv.hours) + ', ' + lv.name }),
        el('div.sf-levels', { 'aria-label': 'Level: ' + lv.name }, M.SKILL_LEVELS.map((n, i) => el('span.sf-level' + (i === lv.level ? '.on' : i < lv.level ? '.past' : ''), {}, n))),
        el('div.sf-log', {}, el('span.hint', {}, 'Log practice:'), [15, 30, 60].map(n => el('button.btn.small' + (n === 60 ? '.primary' : ''), { type: 'button', dataset: { mins: n }, onclick: () => log(n) }, '+' + (n === 60 ? '1 hour' : n + ' min'))),
          el('form.sf-inline', { onsubmit: (e) => { e.preventDefault(); const n = Math.round(Number(custom.value)); if (n > 0 && n <= 1440) { custom.value = ''; custom.blur(); log(n); } } }, custom, el('button.btn.small', { type: 'submit' }, 'Log')))),
      el('h4', {}, 'Last 12 weeks'),
      el('div.sf-bars', { role: 'img', 'aria-label': 'Hours per week for the last 12 weeks: ' + weeks.map(w => (Math.round(w.hours * 10) / 10)).join(', ') }, weeks.map(w => el('span', { title: 'Week of ' + short(w.monday) + ': ' + M.fmtHours(w.hours), style: { height: Math.max(3, Math.round(100 * w.hours / maxH)) + '%' } }))),
      el('div.sf-bars-x', { 'aria-hidden': 'true' }, el('span', {}, short(weeks[0].monday)), el('span', {}, 'This week · ' + M.fmtHours(weeks[11].hours))),
      el('h4', {}, 'Journey'),
      journey.length ? el('ul.sf-journey', {}, journey.map(j => el('li', {}, el('i', { style: { background: j.c } }), el('div', {}, el('b', {}, short(j.d) + ' · ' + j.t), j.q ? el('div.hint', {}, j.q) : '')))) : el('p.hint', {}, 'Log some practice to start the journey.'),
      el('form.sf-add', { onsubmit: (e) => { e.preventDefault(); const text = note.value; if (!text.trim()) return; note.value = ''; note.blur(); save({ kind: 'learning', title: text, skillId: id, date: today, createdAt: Date.now() }); } }, note, el('button.btn', { type: 'submit' }, 'Add note')),
      el('details.sf-more', {}, el('summary', {}, 'Settings'), el('div.row', { style: { gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '10px' } },
        el('label.field', { style: { margin: 0 } }, el('span', {}, 'Hours to reach Expert'), goal),
        el('button.btn.small', { type: 'button', onclick: () => { const g = Math.round(Number(goal.value)); if (g > 0) save({ ...item(id), goal: g }); } }, 'Save goal'),
        el('button.btn.small.danger', { type: 'button', onclick: () => { m.close(); removeItem(id, 'Skill deleted.'); } }, 'Delete skill'))));
  };
  draw(); S.redrawModal = draw;
}
function openSettings() {
  const m = modal('SelfTrack settings', { narrow: true }); m.box.classList.add('sf-modal'); m.box.id = 'sf-settings-modal';
  const cur = settings(); let areas = cur.areas.map(a => ({ ...a }));
  const list = el('div.sf-areas');
  const draw = () => list.replaceChildren(...areas.map((a, i) => el('div.sf-area-edit', {},
    el('select', { 'aria-label': 'Colour for ' + a.name, style: { color: a.color }, onchange: (e) => { a.color = e.target.value; draw(); } }, M.AREA_COLORS.map(c => el('option', { value: c, selected: c === a.color, style: { color: c } }, '●'))),
    el('input', { type: 'text', maxlength: 40, value: a.name, 'aria-label': 'Area name', oninput: (e) => { a.name = e.target.value; } }),
    el('button.sf-x', { type: 'button', 'aria-label': 'Remove ' + a.name, onclick: () => { areas.splice(i, 1); draw(); } }, '×'))));
  draw();
  m.body.append(el('h4', {}, 'Areas of your life'), el('p.hint', {}, 'They group your tasks: the rows of the Week view, and the chips on Today. Removing one keeps its tasks (they move to Other).'), list,
    el('button.btn.small', { type: 'button', onclick: () => { if (areas.length >= 12) return; areas.push({ id: 'a' + Date.now().toString(36), name: 'New area', color: M.AREA_COLORS[areas.length % M.AREA_COLORS.length] }); draw(); } }, '+ Add an area'),
    el('h4', {}, 'Team tasks'), S.teams.length ? el('div.sf-sync-teams', {}, S.teams.map(t => el('label.sf-sync-team', {}, el('input', { type: 'checkbox', checked: cur.sync[t.id] !== false, dataset: { team: t.id } }), el('span', {}, t.name))))
      : el('p.hint', {}, 'You’re not in a team yet.'),
    el('p.hint', {}, '🔒 SelfTrack is private. Your teams never see it, and it’s not part of any team’s data. It’s included when you download or delete your data (Account).'));
  m.foot.append(el('span.spacer'), el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Cancel'), el('button.btn.primary', { type: 'button', id: 'sf-settings-save', onclick: () => {
    const sync = { ...cur.sync }; m.body.querySelectorAll('input[data-team]').forEach(c => { sync[c.dataset.team] = c.checked; });
    saveSettings({ areas: areas.filter(a => a.name.trim()), sync }); m.close(); toast('Settings saved.');
  } }, 'Save'));
}
