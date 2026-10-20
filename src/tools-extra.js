// ─────────────────────────────────────────────────────────────────────────────
//  Advanced tools in the 🧰 Tools window (each turned on in Settings ▸ Features):
//    People      – hours a week, skills, time off; workload heatmap; who could take a task
//    Timesheet   – hours logged on tasks, by person and period; Excel export
//    Risks       – risk register on a likelihood × impact grid
//    Requirements– requirement → tasks → verification, with coverage
//  Plus the workload view across all of a person's teams (from the team list).
// ─────────────────────────────────────────────────────────────────────────────
import { el, modal, toast } from './ui.js';
import { newId, cleanRisk, riskScore, RISK_STATUS, cleanRequirement, REQ_PRIORITY, REQ_STATUS, nextReqRef, cleanProfile, capacityFor, hasSkill } from './model.js';

const localISO = (d) => d.toLocaleDateString('en-CA');
const mondayOf = (iso) => { const d = new Date((iso || localISO(new Date())) + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localISO(d); };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return localISO(d); };
const hrs = (n) => (Math.round(n * 10) / 10) + 'h';
const field = (label, input) => el('label.rs-field', {}, el('span', {}, label), input);

/** Heat class for planned hours against capacity. */
export function heatClass(hours, cap) {
  if (cap === null) return 'away';
  if (!cap) return hours ? 'nocap' : 'empty';
  const r = hours / cap;
  return r === 0 ? 'empty' : r < 0.5 ? 'low' : r <= 0.9 ? 'ok' : r <= 1.1 ? 'high' : 'over';
}
function heatCell(hours, cap, extra, onClick) {
  const cls = heatClass(hours, cap);
  const label = cls === 'away' ? 'Away' : hours ? hrs(hours) + (cap ? ' / ' + hrs(cap) : '') : (cap ? '0 / ' + hrs(cap) : '·');
  return el('td.heat.h-' + cls, { title: extra || '', tabindex: onClick ? 0 : undefined, role: onClick ? 'button' : undefined, onclick: onClick, onkeydown: onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined }, label);
}
const heatLegend = () => el('div.an-legend.heat-legend', {}, [['low', 'Under 50%'], ['ok', '50–90%'], ['high', '90–110%'], ['over', 'Over capacity'], ['away', 'Away all week'], ['nocap', 'No hours set']].map(([c, t]) => el('span', {}, el('i.heat-key.h-' + c), t)));

// ════════════════════════════════════════════════════════════════════════════
//  People
// ════════════════════════════════════════════════════════════════════════════
export function people(pane, kit) {
  const s = kit.S(); const TT = window.TT; const R = kit.R;
  const members = s.members; R.filters.peopleUid = R.filters.peopleUid || kit.me().uid;
  if (!members.some(m => m.uid === R.filters.peopleUid)) R.filters.peopleUid = kit.me().uid;
  const load = window.boardLoad ? window.boardLoad() : [];
  const weeks = pickWeeks(s.team.weeks || []);
  // Heatmap
  const cell = (uid, w) => {
    const list = load.filter(l => l.personId === uid && l.weekKey === w.key);
    const h = list.reduce((a, l) => a + (l.effort || 0), 0); const unest = list.filter(l => !l.done && !(l.effort > 0)).length;
    const p = TT.profileOf(uid); const base = p.capacity || TT.capacity;
    let cap = TT.capacityFor(uid, w.startDate || '');
    if (base && w.startDate && cap === 0) cap = null;   // away all week
    const tip = list.length ? list.map(l => (l.done ? '✓ ' : '• ') + l.name + (l.effort ? ' (' + hrs(l.effort) + ')' : '')).join('\n') + (unest ? '\n+' + unest + ' without an estimate' : '') : 'Nothing planned';
    return heatCell(h, cap, tip, () => { R.filters.peopleCell = uid + '|' + w.key; kit.render(); });
  };
  const heat = members.length && weeks.length ? el('div.rs-table-wrap', {}, el('table.rs-table.heat-table', {},
    el('tr', {}, el('th', {}, 'Person'), weeks.map(w => el('th', { title: w.startDate ? 'Week of ' + kit.fmtDate(w.startDate) : '' }, w.title, w.startDate ? el('div.hint', {}, kit.fmtDate(w.startDate)) : ''))),
    members.map(m => el('tr', {}, el('td', {}, el('b', {}, m.name || m.email), el('div.hint', {}, (TT.profileOf(m.uid).capacity || TT.capacity) ? (TT.profileOf(m.uid).capacity || TT.capacity) + 'h a week' : 'hours not set')), weeks.map(w => cell(m.uid, w)))))) : el('p.hint', {}, 'No weeks yet.');
  let detail = '';
  if (R.filters.peopleCell) {
    const [uid, wk] = R.filters.peopleCell.split('|'); const w = (s.team.weeks || []).find(x => x.key === wk);
    const list = load.filter(l => l.personId === uid && l.weekKey === wk);
    detail = el('div.heat-detail', {}, el('div.rs-subhead', {}, el('b', {}, kit.memberName(uid) + ' · ' + (w ? w.title : '')), el('span.spacer'), el('button.btn.small.ghost', { type: 'button', onclick: () => { R.filters.peopleCell = ''; kit.render(); } }, 'Close')),
      list.length ? el('ul', {}, list.map(l => el('li', {}, el('button.link-btn', { type: 'button', onclick: () => { R.m.close(); window.boardOpenTask(l.taskId); } }, (l.done ? '✓ ' : '') + l.name), l.effort ? ' · ' + hrs(l.effort) : ' · no estimate'))) : el('p.hint', {}, 'Nothing planned this week.'));
  }
  pane.append(el('div.rs-card', {}, el('div.rs-subhead', {}, el('h4', {}, 'Workload: estimated hours against each person’s hours'), el('span.spacer'),
    el('button.btn.small', { type: 'button', onclick: () => TT.openCrossTeam && TT.openCrossTeam() }, '🗂 Across all my teams…')),
    TT.capacity || s.profiles.some(p => p.capacity) ? '' : el('p.hint', {}, 'Tip: set hours a week below (or a team default in Analytics ▸ Planning) to see who is over or under.'),
    heat, heatLegend(), detail));
  // Tasks that need a skill
  const needs = load.filter(l => !l.done && l.skill);
  pane.append(el('div.rs-card', {}, el('h4', {}, 'Tasks that need a skill'),
    needs.length ? el('div.rs-table-wrap', {}, el('table.rs-table', {}, el('tr', {}, ['Task', 'Needs', 'With', 'Week', 'Who could take it'].map(h => el('th', {}, h))),
      needs.map(l => el('tr', {}, el('td', {}, el('button.link-btn', { type: 'button', onclick: () => { R.m.close(); window.boardOpenTask(l.taskId); } }, l.name)), el('td', {}, el('span.rs-chip', {}, l.skill)), el('td', {}, l.person), el('td', {}, l.weekTitle),
        el('td', {}, suggestions(l, load, s, kit).map(sg => el('span.sugg' + (sg.uid === l.personId ? '.current' : ''), { title: sg.cap ? hrs(sg.free) + ' free that week' : 'hours not set' }, sg.name + (sg.cap ? ' · ' + hrs(sg.free) + ' free' : ''))).concat(suggestions(l, load, s, kit).length ? [] : [el('span.hint', {}, 'Nobody lists this skill yet')]))))))
      : el('p.hint', {}, 'Set “Needs skill” in a task’s editor (e.g. CAD, ROS, soldering) and TeamTrack suggests who has the skill and the free hours.')));
  // Profiles
  const uid = R.filters.peopleUid; const p = TT.profileOf(uid); const mayEdit = TT.canEditProfile(uid);
  const pick = el('select', { id: 'pp-person', 'aria-label': 'Person', onchange: (e) => { R.filters.peopleUid = e.target.value; kit.render(); } }, members.map(m => el('option', { value: m.uid, selected: m.uid === uid }, (m.uid === kit.me().uid ? 'Me — ' : '') + (m.name || m.email))));
  const cap = el('input', { type: 'number', id: 'pp-capacity', min: 0, max: 80, step: 1, value: p.capacity || '', placeholder: TT.capacity ? String(TT.capacity) : '–', disabled: !mayEdit, onchange: (e) => TT.saveProfile(uid, { capacity: Number(e.target.value) || 0 }) });
  const skillIn = el('input', { id: 'pp-skill', placeholder: 'Add a skill, e.g. CAD', maxlength: 40, disabled: !mayEdit, list: 'pp-skill-list', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } } });
  const all = [...new Set(s.profiles.flatMap(x => x.skills))].sort();
  const addSkill = () => { const v = skillIn.value.trim(); if (!v) return; TT.saveProfile(uid, { skills: p.skills.concat(v) }); skillIn.value = ''; };
  const from = el('input', { type: 'date', id: 'pp-away-from', disabled: !mayEdit }); const to = el('input', { type: 'date', id: 'pp-away-to', disabled: !mayEdit }); const note = el('input', { id: 'pp-away-note', placeholder: 'e.g. Exams, holiday', maxlength: 80, disabled: !mayEdit });
  pane.append(el('div.rs-card', {}, el('div.rs-subhead', {}, el('h4', {}, 'Hours, skills and time off'), el('span.spacer'), pick),
    el('div.rs-grid', {}, field('Hours a week on this project', cap)),
    el('div.rs-field', {}, el('span', {}, 'Skills'), el('div.pp-skills', {}, p.skills.map(sk => el('span.rs-chip', {}, sk, mayEdit ? el('button.link-btn', { type: 'button', 'aria-label': 'Remove ' + sk, onclick: () => TT.saveProfile(uid, { skills: p.skills.filter(x => x !== sk) }) }, ' ✕') : '')),
      mayEdit ? el('span.rs-inline', {}, skillIn, el('button.btn.small', { type: 'button', id: 'pp-skill-add', onclick: addSkill }, 'Add')) : (p.skills.length ? '' : el('span.hint', {}, 'None listed.'))), el('datalist', { id: 'pp-skill-list' }, all.map(x => el('option', { value: x })))),
    el('div.rs-field', {}, el('span', {}, 'Time off'), p.away.length ? el('ul.pp-away', {}, p.away.map((a, i) => el('li', {}, kit.fmtDate(a.from) + ' – ' + kit.fmtDate(a.to) + (a.note ? ' · ' + a.note : ''), mayEdit ? el('button.link-btn', { type: 'button', 'aria-label': 'Remove', onclick: () => TT.saveProfile(uid, { away: p.away.filter((_, j) => j !== i) }) }, ' ✕') : ''))) : el('span.hint', {}, 'None.'),
      mayEdit ? el('div.rs-inline', {}, from, '–', to, note, el('button.btn.small', { type: 'button', id: 'pp-away-add', onclick: () => { if (!from.value || !to.value) { toast('Choose both dates.'); return; } TT.saveProfile(uid, { away: p.away.concat({ from: from.value, to: to.value, note: note.value }) }); } }, 'Add time off')) : ''),
    el('div.rs-field', {}, el('span', {}, 'Team skills'), all.length ? el('div.pp-skills', {}, all.map(sk => el('span.rs-chip', { title: s.profiles.filter(x => hasSkill(x, sk)).map(x => kit.memberName(x.uid)).join(', ') }, sk + ' · ' + s.profiles.filter(x => hasSkill(x, sk)).length))) : el('span.hint', {}, 'Nobody has listed skills yet.'))));
}
function pickWeeks(weeks) {
  const dated = weeks.filter(w => w.startDate);
  if (dated.length) {
    const from = addDays(mondayOf(), -7);
    const ahead = weeks.filter(w => w.startDate && w.startDate >= from).slice(0, 10);
    if (ahead.length >= 4) return ahead;
  }
  return weeks.slice(-10);
}
/** Members with the task's skill, most free hours first (the current owner included). */
export function suggestions(l, load, s, kit) {
  const TT = window.TT; const w = (s.team.weeks || []).find(x => x.key === l.weekKey) || {};
  return s.members.filter(m => hasSkill(TT.profileOf(m.uid), l.skill)).map(m => {
    const cap = TT.capacityFor(m.uid, w.startDate || ''); const used = load.filter(x => x.personId === m.uid && x.weekKey === l.weekKey && !x.done && x.taskId !== l.taskId).reduce((a, x) => a + (x.effort || 0), 0);
    return { uid: m.uid, name: m.name || m.email, cap, free: Math.max(0, cap - used) };
  }).sort((a, b) => (b.cap ? b.free : -1) - (a.cap ? a.free : -1));
}

// ════════════════════════════════════════════════════════════════════════════
//  Timesheet
// ════════════════════════════════════════════════════════════════════════════
export function timesheetRange(period, today) {
  const mon = mondayOf(today);
  if (period === 'lastweek') return { from: addDays(mon, -7), to: addDays(mon, -1) };
  if (period === 'month') return { from: today.slice(0, 8) + '01', to: today };
  if (period === 'lastmonth') { const d = new Date(today.slice(0, 8) + '01T12:00:00'); d.setMonth(d.getMonth() - 1); const f = localISO(d); const e = new Date(today.slice(0, 8) + '01T12:00:00'); e.setDate(0); return { from: f, to: localISO(e) }; }
  if (period === 'all') return { from: '0000-01-01', to: '9999-12-31' };
  return { from: mon, to: addDays(mon, 6) };
}
export function timesheet(pane, kit) {
  const s = kit.S(); const R = kit.R; const f = R.filters; f.tsPeriod = f.tsPeriod || 'week'; f.tsPerson = f.tsPerson || 'all';
  const { from, to } = timesheetRange(f.tsPeriod, kit.today());
  const all = window.boardTimeEntries ? window.boardTimeEntries() : [];
  const rows = all.filter(e => e.date >= from && e.date <= to && (f.tsPerson === 'all' || e.uid === f.tsPerson)).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const total = rows.reduce((a, e) => a + e.hours, 0);
  const byPerson = new Map(); rows.forEach(e => byPerson.set(e.name, (byPerson.get(e.name) || 0) + e.hours));
  // Hours on every carried-forward copy of a task count toward its one estimate.
  const tasks = new Map(); rows.forEach(e => { const k = e.chainId || e.taskId; const t = tasks.get(k) || { name: e.taskName, hours: 0, effort: e.effort }; t.hours += e.hours; tasks.set(k, t); });
  pane.append(el('div.rs-kpis', {}, kit.kpi('Hours logged', hrs(total)), kit.kpi('People', String(byPerson.size)), kit.kpi('Tasks', String(tasks.size)),
    kit.kpi('Over their estimate', String([...tasks.values()].filter(t => t.effort && t.hours > t.effort).length), [...tasks.values()].some(t => t.effort && t.hours > t.effort) ? 'warn' : '')));
  pane.append(el('div.rs-bar', {},
    el('select', { id: 'ts-period', 'aria-label': 'Period', onchange: (e) => { f.tsPeriod = e.target.value; kit.render(); } }, [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['all', 'All time']].map(([v, t]) => el('option', { value: v, selected: f.tsPeriod === v }, t))),
    el('select', { id: 'ts-person', 'aria-label': 'Person', onchange: (e) => { f.tsPerson = e.target.value; kit.render(); } }, el('option', { value: 'all' }, 'Everyone'), s.members.map(m => el('option', { value: m.uid, selected: f.tsPerson === m.uid }, m.name || m.email))),
    el('span.hint', {}, f.tsPeriod === 'all' ? '' : kit.fmtDate(from) + ' – ' + kit.fmtDate(to)), el('span.spacer'),
    el('button.btn.small', { type: 'button', id: 'ts-export', disabled: !rows.length, onclick: () => exportTimesheet(rows, s, from, to) }, '⬇ Timesheet (.xlsx)')));
  if (!rows.length) { pane.append(el('div.empty-state', {}, 'No hours logged in this period. Open a task and use 🕒 Time spent ▸ Log time.')); return; }
  if (byPerson.size > 1) pane.append(el('div.rs-card', {}, el('h4', {}, 'By person'), el('div.ts-people', {}, [...byPerson.entries()].sort((a, b) => b[1] - a[1]).map(([n, h]) => el('span.rs-chip', {}, n + ' · ' + hrs(h))))));
  pane.append(el('div.rs-table-wrap', {}, el('table.rs-table', {}, el('tr', {}, ['Date', 'Person', 'Task', 'Hours', 'Note'].map(h => el('th', {}, h))),
    rows.map(e => el('tr', {}, el('td', {}, kit.fmtDate(e.date)), el('td', {}, e.name), el('td', {}, el('button.link-btn', { type: 'button', onclick: () => { R.m.close(); window.boardOpenTask(e.taskId); } }, e.taskName)), el('td.num', {}, hrs(e.hours)), el('td', {}, e.note))),
    el('tr.ts-total', {}, el('td', {}, el('b', {}, 'Total')), el('td'), el('td'), el('td.num', {}, el('b', {}, hrs(total))), el('td')))));
}
function exportTimesheet(rows, s, from, to) {
  if (!window.XLSX) { toast('Export isn’t ready yet — try again in a moment.'); return; }
  const X = window.XLSX; const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Date', 'Person', 'Task', 'Hours', 'Note', 'Task estimate (h)'], ...rows.map(e => [e.date, e.name, e.taskName, e.hours, e.note, e.effort ?? ''])]), 'Timesheet');
  const by = new Map(); rows.forEach(e => by.set(e.name, (by.get(e.name) || 0) + e.hours));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Person', 'Hours'], ...[...by.entries()]]), 'By person');
  X.writeFile(wb, (s.team.name || 'Team').replace(/[^\w-]+/g, '_') + '_Timesheet_' + (from.startsWith('0000') ? 'all' : from + '_to_' + to) + '.xlsx');
}

// ════════════════════════════════════════════════════════════════════════════
//  Risk register
// ════════════════════════════════════════════════════════════════════════════
const RISK_LABEL = { open: 'Open', mitigating: 'Being mitigated', closed: 'Closed' };
const LEVEL = ['', 'Very low', 'Low', 'Medium', 'High', 'Very high'];
export const riskBand = (score) => score >= 15 ? 'high' : score >= 8 ? 'med' : 'low';
async function saveRisk(kit, id, fields) {
  const rid = id || newId('rk'); const before = (kit.S().risks || []).find(r => r.id === rid) || {};
  const d = cleanRisk({ ...before, ...fields, createdBy: before.createdBy || kit.me().uid, createdByName: before.createdByName || (kit.me().name || '').slice(0, 80), createdAt: before.createdAt || Date.now(), updatedAt: Date.now() });
  if (!d.title) { toast('Give the risk a title.'); return false; }
  const { id: _, ...doc } = d; return kit.write([{ type: 'set', path: 'risks/' + rid, data: doc }]);
}
export function risks(pane, kit) {
  const s = kit.S(); const R = kit.R; const f = R.filters; const edit = kit.canEdit();
  const all = s.risks || []; const open = all.filter(r => r.status !== 'closed');
  pane.append(el('div.rs-kpis', {}, kit.kpi('Open risks', String(open.length)), kit.kpi('High (score 15+)', String(open.filter(r => riskScore(r) >= 15).length), open.some(r => riskScore(r) >= 15) ? 'bad' : ''),
    kit.kpi('Being mitigated', String(all.filter(r => r.status === 'mitigating').length)), kit.kpi('Due for review', String(open.filter(r => r.reviewDate && r.reviewDate <= kit.today()).length), open.some(r => r.reviewDate && r.reviewDate <= kit.today()) ? 'warn' : ''), kit.kpi('Closed', String(all.filter(r => r.status === 'closed').length), 'good')));
  // 5 × 5 grid
  const grid = el('div.risk-grid', { role: 'grid', 'aria-label': 'Risks by likelihood and impact' });
  grid.append(el('div.rg-axis.rg-y', {}, 'Likelihood ↑'));
  for (let li = 5; li >= 1; li--) {
    grid.append(el('div.rg-lab', {}, String(li)));
    for (let im = 1; im <= 5; im++) {
      const here = open.filter(r => r.likelihood === li && r.impact === im); const on = f.riskCell === li + '|' + im;
      grid.append(el('button.rg-cell.b-' + riskBand(li * im) + (on ? '.on' : ''), { type: 'button', title: LEVEL[li] + ' likelihood × ' + LEVEL[im] + ' impact = ' + (li * im) + (here.length ? '\n' + here.map(r => '• ' + r.title).join('\n') : ''), onclick: () => { f.riskCell = on ? '' : li + '|' + im; kit.render(); } }, here.length ? String(here.length) : ''));
    }
  }
  grid.append(el('div'), el('div'), ...[1, 2, 3, 4, 5].map(n => el('div.rg-lab', {}, String(n))), el('div.rg-axis.rg-x', {}, 'Impact →'));
  const show = all.filter(r => !f.riskCell || (r.status !== 'closed' && r.likelihood + '|' + r.impact === f.riskCell)).sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || riskScore(b) - riskScore(a));
  pane.append(el('div.risk-top', {}, el('div.rs-card.risk-grid-card', {}, el('h4', {}, 'Open risks'), grid, f.riskCell ? el('button.btn.small.ghost', { type: 'button', onclick: () => { f.riskCell = ''; kit.render(); } }, 'Show all') : el('p.hint', {}, 'Click a square to filter.')),
    el('div.rs-card.risk-help', {}, el('h4', {}, 'How to score'), el('p.hint', {}, 'Likelihood and impact from 1 (very low) to 5 (very high). Score = likelihood × impact: 15+ high, 8–14 medium, below 8 low. Give each risk an owner, a plan to reduce it, and a date to look at it again.'),
      edit ? el('button.btn.small.primary', { type: 'button', id: 'rk-new', onclick: () => { R.riskEdit = 'new'; kit.render(); } }, '＋ Add risk') : '')));
  if (R.riskEdit) pane.append(riskForm(kit, R.riskEdit === 'new' ? null : all.find(r => r.id === R.riskEdit)));
  if (!show.length) { pane.append(el('div.empty-state', {}, all.length ? 'No risks in that square.' : 'No risks recorded yet. Think: what could stop the project — parts arriving late, a key person away, a test failing?')); return; }
  pane.append(el('div.lit-list', {}, show.map(r => el('div.lit-item.risk-item.b-' + riskBand(riskScore(r)) + (r.status === 'closed' ? '.closed' : ''), { dataset: { id: r.id } },
    el('div.risk-score', { title: 'Likelihood ' + r.likelihood + ' × impact ' + r.impact }, String(riskScore(r))),
    el('div.lit-main', {}, el('div.lit-title', {}, r.title), el('div.lit-meta', {}, ['Owner: ' + (kit.memberName(r.ownerUid) || '—'), LEVEL[r.likelihood] + ' likelihood', LEVEL[r.impact] + ' impact', r.reviewDate ? 'review ' + kit.fmtDate(r.reviewDate) + (r.reviewDate <= kit.today() && r.status !== 'closed' ? ' ⚠' : '') : ''].filter(Boolean).join(' · ')),
      r.detail ? el('div.lit-notes', {}, r.detail) : '', r.mitigation ? el('div.lit-notes', {}, el('b', {}, 'Plan: '), r.mitigation) : '', r.taskIds.length ? el('div.lit-tasks', {}, kit.taskChips(r.taskIds)) : ''),
    el('div.lit-side', {}, edit ? el('select.rk-status', { 'aria-label': 'Status', onchange: (e) => saveRisk(kit, r.id, { status: e.target.value }) }, RISK_STATUS.map(st => el('option', { value: st, selected: r.status === st }, RISK_LABEL[st]))) : el('span.rs-chip', {}, RISK_LABEL[r.status]),
      edit ? el('button.btn.small.ghost', { type: 'button', onclick: () => { R.riskEdit = r.id; kit.render(); } }, 'Edit') : '')))));
}
function riskForm(kit, r) {
  const R = kit.R; r = r || cleanRisk({ ownerUid: kit.me().uid }); const v = { ...r };
  const inp = (k, attrs = {}) => el('input', { value: v[k] ?? '', ...attrs, oninput: (e) => { v[k] = e.target.value; } });
  const lvl = (k) => el('select', { id: 'rk-' + k, onchange: (e) => { v[k] = Number(e.target.value); } }, [1, 2, 3, 4, 5].map(n => el('option', { value: n, selected: v[k] === n }, n + ' — ' + LEVEL[n])));
  return el('form.rs-form', { onsubmit: async (e) => { e.preventDefault(); if (await saveRisk(kit, r.id || null, v)) { R.riskEdit = null; kit.render(); } } },
    el('h4', {}, r.id ? 'Edit risk' : 'New risk'),
    el('div.rs-grid', {}, field('Risk', inp('title', { required: true, maxlength: 200, id: 'rk-title', placeholder: 'e.g. Servos arrive late' })), field('Likelihood', lvl('likelihood')), field('Impact', lvl('impact')),
      field('Owner', el('select', { onchange: (e) => { v.ownerUid = e.target.value; } }, el('option', { value: '' }, '—'), kit.S().members.map(m => el('option', { value: m.uid, selected: v.ownerUid === m.uid }, m.name || m.email)))),
      field('Review on', inp('reviewDate', { type: 'date' }))),
    field('What could happen', el('textarea', { rows: 2, maxlength: 2000, oninput: (e) => { v.detail = e.target.value; } }, v.detail)),
    field('Plan to reduce it', el('textarea', { rows: 2, maxlength: 2000, id: 'rk-plan', oninput: (e) => { v.mitigation = e.target.value; } }, v.mitigation)),
    el('div.rs-inline', {}, el('span.hint', {}, 'Tasks:'), kit.taskChips(v.taskIds), el('button.btn.small', { type: 'button', onclick: () => kit.pickTask('Which task deals with this risk?', (id) => { if (!kit.linkedTo(v.taskIds, id)) v.taskIds = v.taskIds.concat(id); Object.assign(r, v); R.riskEdit = r.id || 'new'; kit.render(); }) }, '🔗 Link a task')),
    el('div.rs-form-foot', {},
      r.id && (r.createdBy === kit.me().uid || kit.perm('team.settings')) ? el('button.btn.small.danger', { type: 'button', onclick: async () => { if (!confirm('Delete this risk?')) return; if (await kit.write([{ type: 'delete', path: 'risks/' + r.id }])) { R.riskEdit = null; kit.render(); } } }, 'Delete') : '',
      el('span.spacer'), el('button.btn.small.ghost', { type: 'button', onclick: () => { R.riskEdit = null; kit.render(); } }, 'Cancel'), el('button.btn.small.primary', { type: 'submit' }, 'Save')));
}

// ════════════════════════════════════════════════════════════════════════════
//  Requirements
// ════════════════════════════════════════════════════════════════════════════
const PRIO_LABEL = { must: 'Must', should: 'Should', could: 'Could' };
const REQ_LABEL = { draft: 'Draft', agreed: 'Agreed', met: 'Met', dropped: 'Dropped' };
/** Coverage numbers for a list of requirements, given a task lookup. */
export function reqCoverage(list, taskById) {
  const live = list.filter(q => q.status !== 'dropped');
  const covered = live.filter(q => q.taskIds.some(id => taskById(id)));
  const delivered = live.filter(q => q.taskIds.length && q.taskIds.every(id => { const t = taskById(id); return !t || t.flag === 'completed'; }) && q.taskIds.some(id => taskById(id)));
  const verified = live.filter(q => q.verified);
  const pct = (n) => live.length ? Math.round(n / live.length * 100) : 0;
  return { total: live.length, covered: covered.length, delivered: delivered.length, verified: verified.length, coveredPct: pct(covered.length), verifiedPct: pct(verified.length), mustOpen: live.filter(q => q.priority === 'must' && !q.verified).length };
}
async function saveReq(kit, id, fields) {
  const all = kit.S().requirements || []; const qid = id || newId('rq'); const before = all.find(q => q.id === qid) || {};
  const d = cleanRequirement({ ...before, ...fields, ref: fields.ref || before.ref || nextReqRef(all), createdBy: before.createdBy || kit.me().uid, createdByName: before.createdByName || (kit.me().name || '').slice(0, 80), createdAt: before.createdAt || Date.now(), updatedAt: Date.now() });
  if (!d.title) { toast('Describe the requirement.'); return false; }
  const { id: _, ...doc } = d; return kit.write([{ type: 'set', path: 'requirements/' + qid, data: doc }]);
}
export function requirements(pane, kit) {
  const s = kit.S(); const R = kit.R; const edit = kit.canEdit(); const all = (s.requirements || []).slice().sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  const cov = reqCoverage(all, kit.taskById);
  pane.append(el('div.rs-kpis', {}, kit.kpi('Requirements', String(cov.total)), kit.kpi('Linked to tasks', cov.coveredPct + '%', cov.total && cov.coveredPct < 100 ? 'warn' : ''), kit.kpi('Delivered', String(cov.delivered)), kit.kpi('Verified', cov.verifiedPct + '%', cov.total && cov.verifiedPct === 100 ? 'good' : ''), kit.kpi('“Must” not yet verified', String(cov.mustOpen), cov.mustOpen ? 'bad' : '')));
  pane.append(el('div.rs-bar', {}, el('span.hint', {}, 'Requirement → tasks that deliver it → how it’s verified.'), el('span.spacer'),
    el('button.btn.small', { type: 'button', id: 'rq-export', disabled: !all.length, onclick: () => exportTrace(all, s, kit) }, '⬇ Traceability (.xlsx)'),
    edit ? el('button.btn.small.primary', { type: 'button', id: 'rq-new', onclick: () => { R.reqEdit = 'new'; kit.render(); } }, '＋ Add requirement') : ''));
  if (R.reqEdit) pane.append(reqForm(kit, R.reqEdit === 'new' ? null : all.find(q => q.id === R.reqEdit)));
  if (!all.length) { pane.append(el('div.empty-state', {}, 'No requirements yet. Write what the project must achieve — e.g. “The arm lifts 500 g” — then link the tasks that deliver it.')); return; }
  pane.append(el('div.rs-table-wrap', {}, el('table.rs-table.req-table', {}, el('tr', {}, ['Ref', 'Requirement', 'Priority', 'Status', 'Delivered by', 'Verification', ''].map(h => el('th', {}, h))),
    all.map(q => el('tr.req-' + q.status, { dataset: { id: q.id } },
      el('td', {}, el('b', {}, q.ref)), el('td', {}, q.title, q.detail ? el('div.hint', {}, q.detail) : ''),
      el('td', {}, el('span.rs-chip.pr-' + q.priority, {}, PRIO_LABEL[q.priority])),
      el('td', {}, edit ? el('select.rq-status', { 'aria-label': 'Status', onchange: (e) => saveReq(kit, q.id, { status: e.target.value }) }, REQ_STATUS.map(st => el('option', { value: st, selected: q.status === st }, REQ_LABEL[st]))) : REQ_LABEL[q.status]),
      el('td', {}, q.taskIds.length ? kit.taskChips(q.taskIds) : el('span.t-warn', {}, '⚠ no task'), edit ? el('button.link-btn', { type: 'button', title: 'Link a task', onclick: () => kit.pickTask('Which task delivers ' + q.ref + '?', (id) => saveReq(kit, q.id, { taskIds: kit.linkedTo(q.taskIds, id) ? q.taskIds : q.taskIds.concat(id) })) }, ' ＋') : ''),
      el('td', {}, q.verification ? el('div', {}, q.verification) : el('span.hint', {}, '—'),
        edit ? el('label.rq-verified', {}, el('input', { type: 'checkbox', checked: q.verified, onchange: (e) => saveReq(kit, q.id, { verified: e.target.checked, verifiedBy: e.target.checked ? (kit.me().name || '') : '', verifiedDate: e.target.checked ? kit.today() : '' }) }), ' Verified') : (q.verified ? '✓ Verified' : ''),
        q.verified && q.verifiedBy ? el('div.hint', {}, q.verifiedBy + (q.verifiedDate ? ' · ' + kit.fmtDate(q.verifiedDate) : '')) : ''),
      el('td', {}, edit ? el('button.btn.small.ghost', { type: 'button', onclick: () => { R.reqEdit = q.id; kit.render(); } }, 'Edit') : ''))))));
}
function reqForm(kit, q) {
  const R = kit.R; const all = kit.S().requirements || []; q = q || cleanRequirement({ ref: nextReqRef(all) }); const v = { ...q };
  const inp = (k, attrs = {}) => el('input', { value: v[k] ?? '', ...attrs, oninput: (e) => { v[k] = e.target.value; } });
  return el('form.rs-form', { onsubmit: async (e) => { e.preventDefault(); if (await saveReq(kit, q.id || null, v)) { R.reqEdit = null; kit.render(); } } },
    el('h4', {}, q.id ? 'Edit ' + q.ref : 'New requirement'),
    el('div.rs-grid', {}, field('Ref', inp('ref', { maxlength: 20 })), field('Requirement', inp('title', { required: true, maxlength: 300, id: 'rq-title', placeholder: 'e.g. The arm lifts a 500 g load' })),
      field('Priority', el('select', { id: 'rq-priority', onchange: (e) => { v.priority = e.target.value; } }, REQ_PRIORITY.map(p => el('option', { value: p, selected: v.priority === p }, PRIO_LABEL[p])))),
      field('Status', el('select', { onchange: (e) => { v.status = e.target.value; } }, REQ_STATUS.map(st => el('option', { value: st, selected: v.status === st }, REQ_LABEL[st]))))),
    field('Details', el('textarea', { rows: 2, maxlength: 3000, oninput: (e) => { v.detail = e.target.value; } }, v.detail)),
    field('How it will be verified', el('textarea', { rows: 2, maxlength: 1000, id: 'rq-verify', placeholder: 'e.g. Lift test with a 500 g mass, 10 repeats', oninput: (e) => { v.verification = e.target.value; } }, v.verification)),
    el('div.rs-inline', {}, el('span.hint', {}, 'Delivered by:'), kit.taskChips(v.taskIds), el('button.btn.small', { type: 'button', onclick: () => kit.pickTask('Which task delivers this?', (id) => { if (!kit.linkedTo(v.taskIds, id)) v.taskIds = v.taskIds.concat(id); Object.assign(q, v); R.reqEdit = q.id || 'new'; kit.render(); }) }, '🔗 Link a task')),
    el('div.rs-form-foot', {},
      q.id && (q.createdBy === kit.me().uid || kit.perm('team.settings')) ? el('button.btn.small.danger', { type: 'button', onclick: async () => { if (!confirm('Delete ' + q.ref + '?')) return; if (await kit.write([{ type: 'delete', path: 'requirements/' + q.id }])) { R.reqEdit = null; kit.render(); } } }, 'Delete') : '',
      el('span.spacer'), el('button.btn.small.ghost', { type: 'button', onclick: () => { R.reqEdit = null; kit.render(); } }, 'Cancel'), el('button.btn.small.primary', { type: 'submit' }, 'Save')));
}
function exportTrace(all, s, kit) {
  if (!window.XLSX) { toast('Export isn’t ready yet — try again in a moment.'); return; }
  const X = window.XLSX; const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Ref', 'Requirement', 'Details', 'Priority', 'Status', 'Delivered by (tasks)', 'Task status', 'Verification', 'Verified', 'Verified by', 'Verified on'],
    ...all.map(q => [q.ref, q.title, q.detail, PRIO_LABEL[q.priority], REQ_LABEL[q.status], q.taskIds.map(id => (kit.taskById(id) || {}).name || 'deleted task').join('; '),
      q.taskIds.map(id => { const t = kit.taskById(id); return !t ? 'deleted' : t.flag === 'completed' ? 'done' : 'open'; }).join('; '), q.verification, q.verified ? 'Yes' : 'No', q.verifiedBy, q.verifiedDate])]), 'Traceability');
  X.writeFile(wb, (s.team.name || 'Team').replace(/[^\w-]+/g, '_') + '_Requirements.xlsx');
}

// ════════════════════════════════════════════════════════════════════════════
//  Workload across all my teams
// ════════════════════════════════════════════════════════════════════════════
/** Planned hours per person per calendar week, summed over teams. Pure, for tests. */
export function crossTeamLoad(snapshots, mondays) {
  const people = new Map();   // uid → { name, cells: {monday: {hours, byTeam}}, profiles: [], teamCaps: [] }
  snapshots.forEach(sn => {
    const weekMon = new Map((sn.team.weeks || []).filter(w => w.startDate).map(w => [w.key, mondayOf(w.startDate)]));
    const teamCap = Math.round(Number(sn.team.capacity)) || 0;
    sn.members.forEach(m => { const p = people.get(m.uid) || { uid: m.uid, name: m.name || m.email, cells: {}, profiles: [], teamCaps: [], teams: [] }; p.teams.push(sn.team.name); if (teamCap) p.teamCaps.push(teamCap); const pr = sn.profiles.find(x => x.uid === m.uid); if (pr) p.profiles.push(cleanProfile(pr, m.uid)); people.set(m.uid, p); });
    sn.tasks.forEach(t => {
      const mon = weekMon.get(t.weekId); if (!mon || !mondays.includes(mon)) return;
      const p = people.get(t.ownerUid); if (!p) return;
      const c = p.cells[mon] || (p.cells[mon] = { hours: 0, byTeam: {}, tasks: [] });
      const h = Number(t.effort) || 0; c.hours += h; c.byTeam[sn.team.name] = (c.byTeam[sn.team.name] || 0) + h; c.tasks.push({ team: sn.team.name, name: t.name, effort: h, done: t.flag === 'completed' });
    });
  });
  people.forEach(p => {
    const cap = Math.max(0, ...p.profiles.map(x => x.capacity)) || Math.max(0, ...p.teamCaps) || 0;
    const away = p.profiles.flatMap(x => x.away);
    p.capacity = cap; p.capFor = (mon) => capacityFor({ capacity: cap, away }, 0, mon);
  });
  return [...people.values()];
}
export async function openCrossTeam({ teams, load, meUid }) {
  const m = modal('🗂 Workload across my teams'); m.box.classList.add('crossteam-modal');
  m.body.append(el('p.hint', {}, 'Loading ' + teams.length + ' team' + (teams.length === 1 ? '' : 's') + '…'));
  let snaps = [];
  try { snaps = (await Promise.all(teams.map(t => load(t.id).catch(() => null)))).filter(Boolean); }
  catch (e) { m.body.replaceChildren(el('div.empty-state', {}, 'Couldn’t load your teams: ' + e.message)); return; }
  const start = addDays(mondayOf(), -7); const mondays = Array.from({ length: 9 }, (_, i) => addDays(start, i * 7));
  const ppl = crossTeamLoad(snaps, mondays).sort((a, b) => (b.uid === meUid) - (a.uid === meUid) || a.name.localeCompare(b.name));
  const fmt = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const detail = el('div.heat-detail', { hidden: true });
  const table = el('table.rs-table.heat-table', {}, el('tr', {}, el('th', {}, 'Person'), mondays.map(mon => el('th' + (mon === mondayOf() ? '.now' : ''), {}, 'w/c ' + fmt(mon)))),
    ppl.map(p => el('tr', {}, el('td', {}, el('b', {}, p.name + (p.uid === meUid ? ' (you)' : '')), el('div.hint', {}, p.teams.length + ' team' + (p.teams.length === 1 ? '' : 's') + (p.capacity ? ' · ' + p.capacity + 'h a week' : ''))),
      mondays.map(mon => {
        const c = p.cells[mon] || { hours: 0, byTeam: {}, tasks: [] }; let cap = p.capFor(mon); if (p.capacity && cap === 0) cap = null;
        const tip = Object.entries(c.byTeam).map(([t, h]) => t + ': ' + hrs(h)).join('\n') || 'Nothing planned';
        return heatCell(c.hours, cap, tip, () => { detail.hidden = false; detail.replaceChildren(el('b', {}, p.name + ' · week of ' + fmt(mon)), c.tasks.length ? el('ul', {}, c.tasks.map(t => el('li', {}, (t.done ? '✓ ' : '') + t.name + ' — ' + t.team + (t.effort ? ' · ' + hrs(t.effort) : ' · no estimate')))) : el('p.hint', {}, 'Nothing planned.')); });
      }))));
  m.body.replaceChildren(el('p.hint', {}, 'Estimated hours from every team you’re in, against each person’s hours a week (minus time off). Only weeks with start dates are counted.'), el('div.rs-table-wrap', {}, table), heatLegend(), detail);
}
