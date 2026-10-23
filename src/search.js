// ─────────────────────────────────────────────────────────────────────────────
//  Search everything (Ctrl+K / ⌘K, or the 🔍 button). On a board it finds tasks
//  (title, reference, status, sub-tasks, custom fields), comments, people, phases
//  and weeks, plus actions ("Open settings", "Change theme"…). On the team list it
//  finds your teams and your tasks across them. Keyboard: ↑ ↓ to move, Enter to open.
// ─────────────────────────────────────────────────────────────────────────────
import { el } from './ui.js';
import { icon } from './icons.js';
import { taskRef, refIdOf } from '../functions/ghsync.js';
const refOf = (t) => taskRef(refIdOf(t));

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
/** 0 = no match; higher is better. Every word of the query must appear somewhere. */
function score(query, fields) {
  const words = norm(query).split(/\s+/).filter(Boolean); if (!words.length) return 0;
  let total = 0;
  for (const w of words) {
    let best = 0;
    for (const [text, weight] of fields) {
      const t = norm(text); if (!t) continue;
      const i = t.indexOf(w); if (i < 0) continue;
      const s = (t === w ? 6 : i === 0 ? 4 : /[\s\-_/#(·.]/.test(t[i - 1]) ? 3 : 1) * weight;
      if (s > best) best = s;
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}
/** Wrap the matched words in <mark> (as DOM nodes, never HTML). */
function highlight(text, query) {
  const out = el('span'); const s = String(text || '');
  const words = norm(query).split(/\s+/).filter(Boolean); if (!words.length) { out.textContent = s; return out; }
  const n = norm(s); const marks = new Array(s.length).fill(false);
  words.forEach(w => { let i = n.indexOf(w); while (i >= 0) { for (let k = i; k < i + w.length && k < s.length; k++) marks[k] = true; i = n.indexOf(w, i + w.length); } });
  let i = 0; while (i < s.length) { const m = marks[i]; let j = i; while (j < s.length && marks[j] === m) j++; out.append(m ? el('mark', {}, s.slice(i, j)) : s.slice(i, j)); i = j; }
  return out;
}

let open = null;
/**
 * sources(): { items: [{ group, icon, title, sub, fields: [[text, weight]], run }], placeholder }
 */
export function openSearch(sources) {
  if (open) { open.input.focus(); open.input.select(); return; }
  const { items, placeholder, empty } = sources();
  const overlay = el('div.cmdk-overlay', { role: 'presentation' });
  const input = el('input.cmdk-input', { type: 'search', placeholder: placeholder || 'Search…', 'aria-label': 'Search', autocomplete: 'off', spellcheck: false, role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'cmdk-list' });
  const list = el('div.cmdk-list', { id: 'cmdk-list', role: 'listbox' });
  const foot = el('div.cmdk-foot', {}, el('span', {}, el('kbd', {}, '↑'), el('kbd', {}, '↓'), ' move'), el('span', {}, el('kbd', {}, 'Enter'), ' open'), el('span', {}, el('kbd', {}, 'Esc'), ' close'));
  const box = el('div.cmdk', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search' }, el('div.cmdk-head', {}, el('span.cmdk-glass', { 'aria-hidden': 'true' }, '🔍'), input), list, foot);
  overlay.append(box); document.body.append(overlay);
  let results = [], active = 0;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); open = null; };
  const choose = (r) => { close(); try { r.run(); } catch (e) { console.error(e); } };
  function render() {
    const q = input.value.trim();
    if (!q) results = items.filter(i => i.suggest).slice(0, 12).map(i => ({ ...i, s: 1 }));
    else results = items.map(i => ({ ...i, s: score(q, i.fields) })).filter(i => i.s > 0).sort((a, b) => b.s - a.s || a.title.localeCompare(b.title)).slice(0, 40);
    // keep groups together, in order of their best hit
    const order = []; results.forEach(r => { if (!order.includes(r.group)) order.push(r.group); });
    results = order.flatMap(g => results.filter(r => r.group === g));
    active = Math.min(active, Math.max(0, results.length - 1));
    list.replaceChildren();
    if (!results.length) { list.append(el('div.cmdk-empty', {}, q ? 'Nothing found for “' + q + '”.' : (empty || 'Start typing to search.'))); return; }
    let last = '';
    results.forEach((r, i) => {
      if (r.group !== last) { last = r.group; list.append(el('div.cmdk-group', {}, q ? r.group : (r.group === 'Actions' ? 'Actions' : r.group))); }
      list.append(el('button.cmdk-item' + (i === active ? '.on' : ''), { type: 'button', role: 'option', id: 'cmdk-opt-' + i, 'aria-selected': String(i === active), onclick: () => choose(r), onmousemove: () => { if (active !== i) { active = i; paint(); } } },
        el('span.cmdk-icon', { 'aria-hidden': 'true' }, lineIcon(r), el('span.cmdk-emoji', {}, r.icon || '•')),
        el('span.cmdk-text', {}, el('span.cmdk-title', {}, highlight(r.title, q)), r.sub ? el('span.cmdk-sub', {}, highlight(r.sub, q)) : ''),
        r.hint ? el('span.cmdk-hint', {}, r.hint) : ''));
    });
    paint();
  }
  function paint() {
    list.querySelectorAll('.cmdk-item').forEach((b, i) => { b.classList.toggle('on', i === active); b.setAttribute('aria-selected', String(i === active)); });
    const cur = list.querySelector('.cmdk-item.on'); if (cur) { input.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); }
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) { active = (active + 1) % results.length; paint(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) { active = (active - 1 + results.length) % results.length; paint(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) choose(results[active]); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  input.addEventListener('input', () => { active = 0; render(); });
  render(); input.focus();
  open = { input, close };
}
export const searchOpen = () => !!open;

// Line icons for the Professional look, matching the board toolbar.
const EMOJI_ICON = { '⚙': 'settings', '🧭': 'compass', '👥': 'users', '📊': 'chart-column', '📅': 'calendar', '🗂': 'square-kanban', '▦': 'layout-grid',
  '⏱': 'timer', '🔔': 'bell', '🗓': 'calendar-range', '📄': 'file-text', '📝': 'notebook-pen', '🔩': 'package', '💷': 'wallet', '📚': 'book-open',
  '🕒': 'clock', '⚠': 'triangle-alert', '📐': 'ruler', '🧩': 'puzzle', '🎨': 'palette', '👤': 'user', '🎯': 'crosshair', '✨': 'sparkles',
  '📥': 'download', '🏠': 'house', '💬': 'message-square', '📌': 'pin', '✅': 'square-check' };
const ACTION_ICON = { 'Invite people': 'user-plus', 'Timeline': 'calendar-range', 'Add deadlines to my calendar': 'calendar', 'Turn features on or off': 'toggle-right', 'Joint board: all my teams': 'layers', 'People: workload, skills, time off': 'users' };
function lineIcon(r) {
  const name = r.lico || EMOJI_ICON[String(r.icon || '').replace(/\uFE0F/g, '')] || (r.group === 'Tasks' ? 'pin' : '');
  return (name && icon(name, 'ico cmdk-lico')) || '';
}

// ── What a board offers ─────────────────────────────────────────────────────
export function boardSources(ctx) {
  const s = ctx.session, TT = ctx.TT; const items = [];
  const weeks = new Map((s.team.weeks || []).map(w => [w.key, w]));
  const phases = new Map((s.team.phases || []).map(p => [p.id, p]));
  const fields = s.team.fields || [];
  const who = (uid) => (s.members.find(m => m.uid === uid) || {}).name || ((s.team.former || {})[uid] ? s.team.former[uid].name + ' (left)' : 'Former member');
  const fieldText = (t) => fields.map(f => { const v = t.custom && t.custom[f.id]; return v === undefined || v === null || v === '' ? '' : String(f.type === 'person' ? who(v) : v); }).join(' ');
  (s.tasks || []).filter(t => weeks.has(t.weekId)).forEach(t => {
    const w = weeks.get(t.weekId), ph = phases.get(t.phaseId);
    items.push({ group: 'Tasks', icon: t.flag === 'completed' ? '✅' : (t.icon && !t.icon.startsWith('data:') ? t.icon : '📌'), title: t.name || 'Untitled task',
      sub: [who(t.ownerUid), w.title, ph && ph.name, t.jiraId || refOf(t), t.status, t.dueDate && 'due ' + t.dueDate].filter(Boolean).join(' · '),
      fields: [[t.name, 3], [t.jiraId, 3], [refOf(t), 3], [t.status, 1.5], [who(t.ownerUid), 1], [w.title, 1], [ph && ph.name, 1], [(t.subtasks || []).map(x => x.title).join(' · '), 1.2], [fieldText(t), 1], [(t.attachments || []).map(a => a.name).join(' '), 1]],
      run: () => window.boardOpenTask(t.id) });
  });
  const tasks = new Map((s.tasks || []).map(t => [t.id, t]));
  (s.comments || []).forEach(c => {
    const t = tasks.get(c.taskId); if (!t || !weeks.has(t.weekId)) return;
    items.push({ group: 'Comments', icon: '💬', title: c.text.length > 90 ? c.text.slice(0, 90) + '…' : c.text, sub: c.authorName + ' on ' + t.name, fields: [[c.text, 1.5], [c.authorName, 1]], run: () => window.boardOpenTask(t.id) });
  });
  s.members.forEach(m => items.push({ group: 'People', icon: '👤', title: m.name || m.email, sub: TT.roleName(m.roleId) + (m.email ? ' · ' + m.email : ''), fields: [[m.name, 3], [m.email, 2]], run: () => window.boardFocusPerson && window.boardFocusPerson(m.uid) }));
  (s.team.phases || []).forEach(p => items.push({ group: 'Phases', icon: '🧭', title: p.name, sub: [p.start && p.end ? p.start + ' → ' + p.end : '', p.milestone && '🏁 ' + p.milestone].filter(Boolean).join(' · '), fields: [[p.name, 3], [p.milestone, 1.5]], run: () => window.boardShowPhase && window.boardShowPhase(p.id) }));
  if (TT.feature && TT.feature('subteams')) (s.team.subteams || []).forEach(g => items.push({ group: 'Sub-teams', icon: '🧩', title: g.name, sub: g.members.length + (g.members.length === 1 ? ' person' : ' people') + ' — show on the board', fields: [[g.name, 3]], run: () => { if (window.boardSetView && window.boardView && window.boardView() !== 'board') window.boardSetView('board'); window.boardShowSubteam && window.boardShowSubteam(g.id); } }));
  (s.team.weeks || []).forEach(w => items.push({ group: 'Weeks', icon: '📅', title: w.title, sub: w.startDate ? 'from ' + w.startDate : '', fields: [[w.title, 3], [w.startDate, 1]], run: () => window.boardShowWeek && window.boardShowWeek(w.key) }));
  const act = (icon, title, run, extra = '', perm) => { if (!perm || TT.can(perm)) items.push({ group: 'Actions', icon, lico: ACTION_ICON[title], title, fields: [[title, 2], [extra, 1]], run, suggest: true }); };
  act('⚙️', 'Team settings', () => TT.openSettings(), 'options configure');
  act('🧭', 'Project phases', () => TT.openSettings('phases'), 'settings stages milestones');
  const on = (k) => TT.feature && TT.feature(k);
  act('👥', 'Invite people', () => TT.openSettings('members'), 'members add email', 'members.manage');
  act('📊', 'Analytics', () => window.openAnalytics('overview'), 'charts kpi report', 'analytics.view');
  act('📅', 'Timeline', () => window.openAnalytics('timeline'), 'gantt deadlines', 'analytics.view');
  act('🗂️', 'Kanban view', () => window.boardSetView('kanban'), 'todo doing done columns stages board');
  act('▦', 'Board view (people × weeks)', () => window.boardSetView('board'), 'grid weeks');
  if (on('planning')) act('⏱', 'Planning: workload and burndown', () => window.openAnalytics('planning'), 'effort hours capacity burndown dependencies', 'analytics.view');
  act('🔔', 'Activity and mentions', () => TT.openActivity(), 'feed notifications comments');
  act('🗓️', 'Add deadlines to my calendar', () => TT.openCalendar(), 'ics google outlook sync');
  act('📄', 'Progress report for my supervisor', () => TT.openReport(), 'report pdf word print weekly update summary email', 'analytics.view');
  if (on('meetings')) act('📝', 'Meeting notes', () => TT.openResearch('meetings'), 'minutes actions supervisor research');
  if (on('parts')) act('🔩', 'Parts and orders', () => TT.openResearch('parts'), 'components buy order supplier research');
  if (on('finance') && TT.seesMoney && TT.seesMoney()) act('💷', 'Finance: budget and spending', () => TT.openResearch('finance'), 'money budget expenses grant receipts');
  if (on('literature')) act('📚', 'Literature list', () => TT.openResearch('literature'), 'papers doi bibtex references reading');
  if (on('people')) act('👥', 'People: workload, skills, time off', () => TT.openResearch('people'), 'capacity heatmap holiday availability skills');
  if (on('time')) act('🕒', 'Timesheet', () => TT.openResearch('time'), 'hours logged time tracking contractor');
  if (on('risks')) act('⚠️', 'Risk register', () => TT.openResearch('risks'), 'risks likelihood impact mitigation');
  if (on('requirements')) act('📐', 'Requirements and traceability', () => TT.openResearch('requirements'), 'requirements verification tests coverage');
  if (on('subteams')) { act('🧩', 'Sub-teams: who is in which', () => TT.openSettings('subteams'), 'groups squads workstreams fuselage payload electronics leads', 'team.settings'); act('📊', 'Sub-team progress', () => window.openAnalytics('subteams'), 'groups squads workstreams compare', 'analytics.view'); }
  act('🧩', 'Turn features on or off', () => TT.openSettings('features'), 'settings features advanced modules simple', 'team.settings');
  act('🎨', 'Change theme', () => TT.openThemes(), 'dark light colours appearance');
  act('👤', 'My account', () => TT.openAccount(), 'profile photo name sign out menu');
  act('🎯', 'Jump to this week', () => window.scrollToToday(), 'today current');
  act('✨', 'AI summary', () => TT.openAI(), 'chatgpt gemini claude summarise', 'data.export');
  act('📥', 'Import tasks', () => TT.importFromPicker(), 'excel csv jira trello');
  act('🧩', 'Joint board: all my teams', () => TT.openJointBoard(), 'shared board across teams combined partner other team');
  act('🏠', 'All teams', () => TT.goHome(), 'home switch team list');
  return { items, placeholder: 'Search tasks, people, comments, phases… or type an action', empty: 'Type to search this team.' };
}
