// ─────────────────────────────────────────────────────────────────────────────
//  Progress report (Phase 8): one click turns the board into a report for a
//  supervisor, funder or the team. Pick a period, a person (or everyone) and
//  the sections; preview it, then print / save as PDF, download for Word, or
//  copy as text for an email.
//
//  buildReport() is pure (data in, report out) so it can be tested; the HTML
//  and text renderers only format what it returns.
// ─────────────────────────────────────────────────────────────────────────────
import { el, modal, toast } from './ui.js';
import { partTotal, cleanBudget, currencyOf, cleanFeatures, riskScore, carryIndexOf } from './model.js';
import { reqCoverage } from './tools-extra.js';
import { seesMoney, financeSummary } from './research.js';

const DAY = 864e5;
const localISO = (d) => d.toLocaleDateString('en-CA');
const addDays = (iso, n) => localISO(new Date(new Date(iso + 'T12:00:00').getTime() + n * DAY));
const between = (iso, from, to) => !!iso && iso >= from && iso <= to;
const fmt = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtShort = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

export const SECTIONS = [
  ['summary', 'Summary'], ['completed', 'Completed in this period'], ['progress', 'In progress'], ['upcoming', 'Coming up (next 14 days)'],
  ['risks', 'Overdue and at risk'], ['phases', 'Phases and milestones'], ['subteams', 'By sub-team'], ['people', 'By person'], ['meetings', 'Meetings and decisions'],
  ['notebook', 'Lab notebook highlights'], ['parts', 'Parts and orders'], ['finance', 'Budget and spending'], ['literature', 'Reading'],
  ['hours', 'Hours logged'], ['register', 'Risk register'], ['requirements', 'Requirements'],
];
/** Sections that belong to a feature the team can turn off. */
export const SECTION_FEATURE = { meetings: 'meetings', notebook: 'notebook', parts: 'parts', finance: 'finance', literature: 'literature', hours: 'time', register: 'risks', requirements: 'requirements', subteams: 'subteams' };
export const sectionsFor = (features) => { const f = cleanFeatures(features); return SECTIONS.filter(([k]) => !SECTION_FEATURE[k] || f[SECTION_FEATURE[k]]); };
export const PERIODS = [['7', 'Last 7 days'], ['14', 'Last 2 weeks'], ['28', 'Last 4 weeks'], ['all', 'Whole project'], ['custom', 'Custom dates']];

/** The period as { from, to, label }. phase:<id> uses that phase's dates. */
export function resolvePeriod(opts, today, team, rows) {
  const p = opts.period || '7';
  if (p.startsWith('phase:')) {
    const ph = (team.phases || []).find(x => x.id === p.slice(6));
    if (ph && ph.start) return { from: ph.start, to: ph.end && ph.end < today ? ph.end : today, label: 'Phase: ' + ph.name, phaseId: ph.id };
  }
  if (p === 'custom' && opts.from && opts.to) return { from: opts.from <= opts.to ? opts.from : opts.to, to: opts.to >= opts.from ? opts.to : opts.from, label: fmt(opts.from) + ' – ' + fmt(opts.to) };
  if (p === 'all') {
    const starts = (team.weeks || []).map(w => w.startDate).filter(Boolean).sort();
    const done = (rows || []).map(r => r.completedOn).filter(Boolean).sort();
    return { from: starts[0] || done[0] || addDays(today, -28), to: today, label: 'Whole project' };
  }
  const n = Number(p) || 7;
  return { from: addDays(today, -(n - 1)), to: today, label: 'Last ' + (n === 7 ? '7 days' : n === 14 ? '2 weeks' : n === 28 ? '4 weeks' : n + ' days') };
}

/** Section text under a "Decisions" heading in meeting notes. */
function decisionsFrom(notes) {
  const lines = String(notes || '').split('\n'); const out = []; let on = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#*\s*decisions?\s*:?\s*$/i.test(line)) { on = true; continue; }
    if (on && /^#*\s*[A-Z][\w ]{0,30}:?\s*$/.test(line) && !/^[-*•]/.test(line)) { on = false; continue; }
    if (on) { const t = line.replace(/^[-*•]\s*/, '').trim(); if (t) out.push(t); }
  }
  return out.slice(0, 10);
}

/**
 * data: { team, rows (board rows), members, meetings, notebook, parts, papers, expenses, budget, money (bool), author, today }
 * opts: { period, from, to, person ('all' | uid | 'st:<sub-team id>'), sections: [keys], message }
 */
export function buildReport(data, opts) {
  const today = data.today; const team = data.team;
  const want = new Set(opts.sections && opts.sections.length ? opts.sections : SECTIONS.map(s => s[0]));
  if (!data.money) want.delete('finance');
  const feat = cleanFeatures(team.features); Object.entries(SECTION_FEATURE).forEach(([k, f]) => { if (!feat[f]) want.delete(k); });
  const allRows = data.rows || [];
  const sel = String(opts.person || 'all');
  const st = sel.startsWith('st:') && feat.subteams ? (team.subteams || []).find(x => 'st:' + x.id === sel) || null : null;
  const person = sel !== 'all' && !sel.startsWith('st:') ? sel : null;
  /** Whether a person's work is in this report (one person, one sub-team, or everyone). */
  const who = (uid) => person ? uid === person : st ? st.members.includes(uid) : true;
  const rows = person || st ? allRows.filter(r => who(r.personId)) : allRows;
  const period = resolvePeriod(opts, today, team, allRows);
  const inScope = period.phaseId ? rows.filter(r => r.phaseId === period.phaseId) : rows;
  const open = inScope.filter(r => r.flag !== 'completed');
  const done = inScope.filter(r => r.flag === 'completed');
  const doneIn = done.filter(r => between(r.completedOn, period.from, period.to)).sort((a, b) => a.completedOn.localeCompare(b.completedOn));
  const progress = open.filter(r => r.stage === 'Doing');
  const soonTo = addDays(today, 14);
  const upcoming = open.filter(r => r.deadline && r.deadline >= today && r.deadline <= soonTo).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const overdue = open.filter(r => r.overdue).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const atRisk = open.filter(r => !r.overdue && r.waitIssues && r.waitIssues.length);
  const critical = open.filter(r => !r.overdue && (r.priority === 'Blocker' || r.priority === 'Critical') && !(r.waitIssues && r.waitIssues.length));
  const memberName = (uid) => (data.members.find(m => m.uid === uid) || {}).name || '';
  const personName = person ? memberName(person) : st ? st.name : '';
  // Rows are one per carried chain (the latest copy); links may name an earlier copy.
  const rowOf = (id) => allRows.find(r => r.id === id) || (data.latestId ? allRows.find(r => r.id === data.latestId(id)) : null) || null;
  const taskName = (id) => (rowOf(id) || {}).task || '';
  const R = {
    team: team.name, logo: team.logo || '', author: data.author, generated: today, period, personName, message: String(opts.message || '').trim(),
    title: 'Progress report' + (personName ? ' — ' + personName : ''), sections: [],
  };
  const add = (key, body) => { if (want.has(key) && body) R.sections.push({ key, title: (SECTIONS.find(s => s[0] === key) || [key, key])[1], ...body }); };

  const pct = inScope.length ? Math.round(done.length / inScope.length * 100) : 0;
  add('summary', { kpis: [
    ['Completed this period', doneIn.length], ['In progress', progress.length], ['Overall complete', pct + '%'],
    ['Due in the next 14 days', upcoming.length], ['Overdue', overdue.length],
  ], lines: [
    doneIn.length ? doneIn.length + ' task' + (doneIn.length === 1 ? ' was' : 's were') + ' completed between ' + fmt(period.from) + ' and ' + fmt(period.to) + '.' : 'No tasks were completed in this period.',
    open.length + ' task' + (open.length === 1 ? ' is' : 's are') + ' still open' + (overdue.length ? ', of which ' + overdue.length + ' ' + (overdue.length === 1 ? 'is' : 'are') + ' overdue' : '') + '.',
    upcoming[0] ? 'Next deadline: “' + upcoming[0].task + '” on ' + fmt(upcoming[0].deadline) + '.' : '',
  ].filter(Boolean) });
  add('completed', { table: { head: person ? ['Task', 'Phase', 'Completed'] : ['Task', 'Who', 'Phase', 'Completed'], rows: doneIn.map(r => person ? [r.task, r.phase, fmtShort(r.completedOn)] : [r.task, r.person, r.phase, fmtShort(r.completedOn)]) }, empty: 'Nothing completed in this period.' });
  add('progress', { table: { head: person ? ['Task', 'Phase', 'Sub-tasks', 'Deadline'] : ['Task', 'Who', 'Phase', 'Sub-tasks', 'Deadline'], rows: progress.map(r => { const s = r.subtasks.length ? r.subtasks.filter(x => x.done).length + '/' + r.subtasks.length : ''; const due = r.deadline ? fmtShort(r.deadline) : ''; return person ? [r.task + (r.carryCount > 1 ? ' (week ' + r.carryCount + ')' : ''), r.phase, s, due] : [r.task + (r.carryCount > 1 ? ' (week ' + r.carryCount + ')' : ''), r.person, r.phase, s, due]; }) }, empty: 'Nothing is marked as in progress.' });
  add('upcoming', { table: { head: person ? ['Task', 'Deadline', 'In'] : ['Task', 'Who', 'Deadline', 'In'], rows: upcoming.map(r => { const d = r.daysToDeadline === 0 ? 'today' : r.daysToDeadline + ' day' + (r.daysToDeadline === 1 ? '' : 's'); return person ? [r.task, fmtShort(r.deadline), d] : [r.task, r.person, fmtShort(r.deadline), d]; }) }, empty: 'No deadlines in the next 14 days.' });
  const riskRows = [
    ...overdue.map(r => [r.task, r.person, 'Overdue by ' + (-r.daysToDeadline) + ' day' + (r.daysToDeadline === -1 ? '' : 's') + ' (due ' + fmtShort(r.deadline) + ')']),
    ...atRisk.map(r => [r.task, r.person, r.waitIssues.join('; ')]),
    ...critical.map(r => [r.task, r.person, r.priority + ' priority, still open']),
  ];
  add('risks', { table: { head: ['Task', 'Who', 'Why'], rows: riskRows }, empty: 'Nothing overdue or at risk. 👍', tone: riskRows.length ? 'bad' : '' });
  const phases = (team.phases || []).map(ph => {
    const list = rows.filter(r => r.phaseId === ph.id); const d = list.filter(r => r.flag === 'completed').length;
    const pctDone = list.length ? Math.round(d / list.length * 100) : 0;
    let state = '';
    if (ph.start && ph.end) {
      const span = Math.max(1, (new Date(ph.end) - new Date(ph.start)) / DAY); const gone = Math.min(1, Math.max(0, (new Date(today) - new Date(ph.start)) / DAY / span));
      state = today < ph.start ? 'Not started' : today > ph.end ? (pctDone === 100 ? 'Finished' : 'Past its end date') : (pctDone + 10 >= gone * 100 ? 'On track' : 'Behind');
    }
    return [ph.name, ph.start && ph.end ? fmtShort(ph.start) + ' – ' + fmtShort(ph.end) : '', d + '/' + list.length + ' (' + pctDone + '%)', state, ph.milestone || ''];
  });
  add('phases', phases.length ? { table: { head: ['Phase', 'Dates', 'Tasks done', 'Status', 'Milestone'], rows: phases } } : { empty: 'No phases set up.' });
  if (!person && !st && (team.subteams || []).length) {
    const groups = team.subteams.map(g => {
      const mine = rows.filter(r => g.members.includes(r.personId)); if (!mine.length) return null;
      const d = mine.filter(r => r.flag === 'completed').length;
      return [g.name, mine.filter(r => r.flag === 'completed' && between(r.completedOn, period.from, period.to)).length, mine.length - d, mine.filter(r => r.overdue).length, Math.round(d / mine.length * 100) + '%'];
    }).filter(Boolean);
    add('subteams', { table: { head: ['Sub-team', 'Completed this period', 'Open', 'Overdue', 'Overall complete'], rows: groups }, empty: 'No tasks in any sub-team yet.' });
  }
  if (!person) {
    const people = data.members.filter(m => who(m.uid)).map(m => {
      const mine = rows.filter(r => r.personId === m.uid); if (!mine.length) return null;
      return [m.name || m.email, mine.filter(r => r.flag === 'completed' && between(r.completedOn, period.from, period.to)).length, mine.filter(r => r.flag !== 'completed').length, mine.filter(r => r.overdue).length];
    }).filter(Boolean);
    add('people', { table: { head: ['Person', 'Completed this period', 'Open', 'Overdue'], rows: people }, empty: 'No tasks yet.' });
  }
  const meets = (data.meetings || []).filter(m => between(m.date, period.from, period.to)).sort((a, b) => a.date.localeCompare(b.date));
  add('meetings', { items: meets.map(m => ({ title: m.title + ' — ' + fmt(m.date), lines: [
    ...decisionsFrom(m.notes).map(d => 'Decision: ' + d),
    ...m.actions.filter(a => (!person && !st) || who(a.ownerUid)).map(a => { const t = rowOf(a.taskId); return 'Action: ' + a.text + (a.ownerUid ? ' (' + memberName(a.ownerUid) + ')' : '') + (t ? (t.flag === 'completed' ? ' — done' : ' — open') : ''); }),
  ] })), empty: 'No meetings recorded in this period.' });
  const notes = (data.notebook || []).filter(n => between(n.date, period.from, period.to) && who(n.authorUid) && taskName(n.taskId)).sort((a, b) => a.date.localeCompare(b.date));
  add('notebook', { items: notes.slice(0, 30).map(n => ({ title: fmt(n.date) + ' · ' + taskName(n.taskId) + ' · ' + n.authorName, lines: [n.text.length > 600 ? n.text.slice(0, 600) + '…' : n.text], image: n.images[0] || '' })), empty: 'No notebook entries in this period.' });
  const parts = (data.parts || []).filter(p => !st || p.subteamId === st.id);
  const ordered = parts.filter(p => between(p.orderedDate, period.from, period.to)); const received = parts.filter(p => between(p.receivedDate, period.from, period.to));
  const waiting = parts.filter(p => p.status === 'ordered'); const needed = parts.filter(p => p.status === 'needed');
  const money = (n) => data.money ? ' · ' + fmtMoney(n, data.budget, data.team) : '';
  add('parts', { lines: [
    received.length ? 'Received: ' + received.map(p => p.name + (p.qty > 1 ? ' × ' + p.qty : '')).join(', ') + '.' : '',
    ordered.length ? 'Ordered: ' + ordered.map(p => p.name + (p.qty > 1 ? ' × ' + p.qty : '')).join(', ') + '.' : '',
    waiting.length ? 'Still waiting for ' + waiting.length + ' order' + (waiting.length === 1 ? '' : 's') + money(waiting.reduce((a, p) => a + partTotal(p), 0)) + '.' : '',
    needed.length ? needed.length + ' part' + (needed.length === 1 ? '' : 's') + ' still to order' + money(needed.reduce((a, p) => a + partTotal(p), 0)) + '.' : '',
  ].filter(Boolean), empty: 'No parts activity.' });
  if (data.money) {
    const b = cleanBudget(data.budget); const ex = data.expenses || [];
    const sum = financeSummary(b, ex, data.parts || []);
    const spentIn = ex.filter(x => x.kind === 'expense' && between(x.date, period.from, period.to));
    const incomeIn = ex.filter(x => x.kind === 'income' && between(x.date, period.from, period.to));
    add('finance', { kpis: [['Budget', fmtMoney(sum.total, b, data.team)], ['Spent to date', fmtMoney(sum.spent, b, data.team)], ['Committed', fmtMoney(sum.committed, b, data.team)], ['Remaining', fmtMoney(sum.remaining, b, data.team)]],
      lines: [
        'Spent in this period: ' + fmtMoney(spentIn.reduce((a, x) => a + x.amount, 0), b, data.team) + (spentIn.length ? ' (' + spentIn.map(x => x.description || 'item').slice(0, 8).join(', ') + (spentIn.length > 8 ? '…' : '') + ')' : '') + '.',
        incomeIn.length ? 'Income received: ' + fmtMoney(incomeIn.reduce((a, x) => a + x.amount, 0), b, data.team) + '.' : '',
        sum.total && sum.remaining < 0 ? '⚠ Over budget by ' + fmtMoney(-sum.remaining, b, data.team) + '.' : '',
      ].filter(Boolean),
      table: sum.lines.length ? { head: ['Budget line', 'Budget', 'Spent', 'Committed', 'Left'], rows: sum.lines.map(l => [l.name, fmtMoney(l.amount, b, data.team), fmtMoney(l.spent, b, data.team), fmtMoney(l.committed, b, data.team), fmtMoney(l.amount - l.spent - l.committed, b, data.team)]) } : null });
  }
  const read = (data.papers || []).filter(p => p.status === 'read' && p.updatedAt && between(localISO(new Date(p.updatedAt)), period.from, period.to) && who(p.addedBy));
  const reading = (data.papers || []).filter(p => p.status === 'reading' && who(p.addedBy));
  add('literature', { items: [...read.map(p => ({ title: '✓ ' + p.title, lines: [[p.authors, p.year, p.venue].filter(Boolean).join(' · '), p.notes ? p.notes.slice(0, 300) : ''].filter(Boolean) })), ...reading.map(p => ({ title: '… ' + p.title + ' (reading)', lines: [[p.authors, p.year].filter(Boolean).join(' · ')] }))], empty: 'Nothing read in this period.' });
  // Hours logged (time logging)
  const entries = (data.timeEntries || []).filter(e => between(e.date, period.from, period.to) && who(e.uid));
  if (entries.length || want.has('hours')) {
    const by = new Map(); entries.forEach(e => by.set(e.name, (by.get(e.name) || 0) + e.hours));
    const tasksH = new Map(); entries.forEach(e => tasksH.set(e.taskName, (tasksH.get(e.taskName) || 0) + e.hours));
    const total = entries.reduce((a, e) => a + e.hours, 0); const h = (n) => (Math.round(n * 10) / 10) + 'h';
    add('hours', entries.length ? { lines: [h(total) + ' logged in this period' + (by.size > 1 ? ': ' + [...by.entries()].map(([n, v]) => n + ' ' + h(v)).join(', ') : '') + '.'],
      table: { head: ['Task', 'Hours'], rows: [...tasksH.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, v]) => [n, h(v)]) } } : { empty: 'No hours logged in this period.' });
  }
  // Risk register
  const openRisks = (data.risks || []).filter(r => r.status !== 'closed').sort((a, b) => riskScore(b) - riskScore(a));
  add('register', openRisks.length ? { lines: [openRisks.length + ' open risk' + (openRisks.length === 1 ? '' : 's') + ', ' + openRisks.filter(r => riskScore(r) >= 15).length + ' high.'],
    table: { head: ['Score', 'Risk', 'Owner', 'Status', 'Plan'], rows: openRisks.slice(0, 8).map(r => [String(riskScore(r)), r.title, memberName(r.ownerUid), r.status === 'mitigating' ? 'Being mitigated' : 'Open', r.mitigation.slice(0, 140)]) }, tone: openRisks.some(r => riskScore(r) >= 15) ? 'bad' : '' } : { empty: 'No open risks.' });
  // Requirements
  const reqs = data.requirements || [];
  if (reqs.length || want.has('requirements')) {
    const byId = (id) => { const r = allRows.find(x => x.id === id); return r ? { flag: r.flag } : null; };
    const cov = reqCoverage(reqs, byId);
    add('requirements', reqs.length ? { kpis: [['Requirements', cov.total], ['Linked to tasks', cov.coveredPct + '%'], ['Delivered', cov.delivered], ['Verified', cov.verifiedPct + '%']],
      table: { head: ['Ref', '“Must” requirement not yet verified', 'Status'], rows: reqs.filter(q => q.priority === 'must' && !q.verified && q.status !== 'dropped').map(q => [q.ref, q.title, q.status]) } } : { empty: 'No requirements recorded.' });
  }
  return R;
}
function fmtMoney(n, budget, team) {
  const cur = currencyOf(team, cleanBudget(budget));
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n || 0); } catch { return String(n); }
}

// ── Renderers ───────────────────────────────────────────────────────────────
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function reportHtml(R, { forWord = false } = {}) {
  const sec = (s) => {
    let h = '<section class="sec' + (s.tone ? ' ' + s.tone : '') + '"><h2>' + esc(s.title) + '</h2>';
    if (s.kpis) h += '<div class="kpis">' + s.kpis.map(([l, v]) => '<div class="kpi"><div class="v">' + esc(v) + '</div><div class="l">' + esc(l) + '</div></div>').join('') + '</div>';
    if (s.lines && s.lines.length) h += '<ul class="lines">' + s.lines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>';
    if (s.table && s.table.rows.length) h += '<table><thead><tr>' + s.table.head.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + s.table.rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    if (s.items && s.items.length) h += s.items.map(it => '<div class="item"><div class="it-t">' + esc(it.title) + '</div>' + it.lines.filter(Boolean).map(l => '<div class="it-l">' + esc(l) + '</div>').join('') + (it.image && !forWord ? '<img class="it-img" src="' + esc(it.image) + '" alt="">' : '') + '</div>').join('');
    const emptyNow = !(s.kpis || (s.lines && s.lines.length) || (s.table && s.table.rows.length) || (s.items && s.items.length));
    if (emptyNow && s.empty) h += '<p class="empty">' + esc(s.empty) + '</p>';
    return h + '</section>';
  };
  const css = `
    @page { size: A4; margin: 16mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a202c; margin: 0; padding: 28px; font-size: 13px; line-height: 1.5; background: #fff; }
    header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #2b6cb0; padding-bottom: 14px; margin-bottom: 18px; }
    header img { width: 52px; height: 52px; border-radius: 10px; object-fit: cover; }
    h1 { font-size: 22px; margin: 0; } .sub { color: #4a5568; font-size: 13px; }
    .msg { background: #ebf8ff; border-left: 4px solid #2b6cb0; padding: 10px 14px; margin: 0 0 18px; white-space: pre-wrap; border-radius: 4px; }
    h2 { font-size: 15px; margin: 0 0 8px; color: #2b6cb0; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    .sec { margin: 0 0 18px; break-inside: avoid-page; } .sec.bad h2 { color: #c53030; }
    .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; min-width: 120px; } .kpi .v { font-size: 18px; font-weight: 800; } .kpi .l { font-size: 10.5px; color: #4a5568; text-transform: uppercase; letter-spacing: .03em; }
    ul.lines { margin: 4px 0 8px; padding-left: 18px; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: 12px; }
    th { text-align: left; background: #f7fafc; color: #4a5568; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 5px 8px; vertical-align: top; }
    .item { padding: 6px 0; border-bottom: 1px dashed #e2e8f0; } .it-t { font-weight: 700; } .it-l { color: #2d3748; white-space: pre-wrap; }
    .it-img { max-width: 220px; max-height: 160px; border-radius: 6px; margin-top: 4px; display: block; }
    .empty { color: #718096; font-style: italic; margin: 2px 0; }
    footer { margin-top: 22px; color: #a0aec0; font-size: 11px; border-top: 1px solid #e2e8f0; padding-top: 8px; }`;
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(R.title + ' · ' + R.team) + '</title><style>' + css + '</style></head><body>' +
    '<header>' + (R.logo && !forWord ? '<img src="' + esc(R.logo) + '" alt="">' : '') + '<div><h1>' + esc(R.title) + '</h1><div class="sub">' + esc(R.team) + ' · ' + esc(R.period.label) + ' (' + esc(fmt(R.period.from)) + ' – ' + esc(fmt(R.period.to)) + ')<br>Prepared by ' + esc(R.author) + ' on ' + esc(fmt(R.generated)) + '</div></div></header>' +
    (R.message ? '<div class="msg">' + esc(R.message) + '</div>' : '') + R.sections.map(sec).join('') +
    '<footer>' + esc(fmt(R.generated)) + ' · Made with <a href="https://trawpie.org">Trawpie</a>, free for student teams</footer></body></html>';
}
export function reportText(R) {
  const out = [R.title + ' — ' + R.team, R.period.label + ' (' + fmt(R.period.from) + ' – ' + fmt(R.period.to) + ')', 'Prepared by ' + R.author + ' on ' + fmt(R.generated), ''];
  if (R.message) out.push(R.message, '');
  R.sections.forEach(s => {
    out.push(s.title.toUpperCase());
    if (s.kpis) out.push(s.kpis.map(([l, v]) => l + ': ' + v).join(' · '));
    (s.lines || []).forEach(l => out.push('• ' + l));
    if (s.table) s.table.rows.forEach(r => out.push('• ' + r.filter(c => c !== '' && c !== undefined).join(' — ')));
    (s.items || []).forEach(it => { out.push('• ' + it.title); it.lines.filter(Boolean).forEach(l => out.push('   ' + l.replace(/\n/g, '\n   '))); });
    const emptyNow = !(s.kpis || (s.lines && s.lines.length) || (s.table && s.table.rows.length) || (s.items && s.items.length));
    if (emptyNow && s.empty) out.push(s.empty);
    out.push('');
  });
  out.push('Made with Trawpie, free for student teams: https://trawpie.org');
  return out.join('\n').trim() + '\n';
}

// ── Dialog ──────────────────────────────────────────────────────────────────
const PREF = 'tt_report_opts';
function loadOpts() { try { return JSON.parse(localStorage.getItem(PREF) || 'null') || null; } catch { return null; } }
function saveOpts(o) { try { localStorage.setItem(PREF, JSON.stringify({ ...o, message: '' })); } catch { /* */ } }

export function openReport(ctx) {
  const s = ctx.session; if (!s || !s.booted) return;
  const money = seesMoney(s);
  const saved = loadOpts();
  const available = sectionsFor(s.team.features).filter(([k]) => k !== 'finance' || money);
  const opts = { period: '7', from: '', to: '', person: 'all', sections: available.map(x => x[0]), message: '', ...(saved || {}) };
  if (saved) available.forEach(([k]) => { if (!(saved.known || []).includes(k) && !opts.sections.includes(k)) opts.sections.push(k); });
  opts.known = available.map(x => x[0]);
  if (!money) opts.sections = opts.sections.filter(k => k !== 'finance');
  const m = modal('📄 Progress report'); m.box.classList.add('report-modal');
  const frame = el('iframe.rp-frame', { title: 'Report preview' });
  const data = () => ({
    team: s.team, rows: window.boardRows ? window.boardRows({ scope: 'all', allPhases: true }) : [], latestId: (id) => (carryIndexOf(s).latest(id) || {}).id || id, members: s.members, meetings: s.meetings, notebook: s.notebook, parts: s.parts,
    papers: s.papers, expenses: s.expenses, budget: s.budget, risks: s.risks, requirements: s.requirements, timeEntries: window.boardTimeEntries ? window.boardTimeEntries() : [], money, author: ctx.user.name || ctx.user.email || 'Trawpie', today: localISO(new Date()),
  });
  let current = null;
  const refresh = () => { current = buildReport(data(), opts); frame.srcdoc = reportHtml(current); saveOpts(opts); };
  // Controls
  const periodSel = el('select', { id: 'rp-period', 'aria-label': 'Period', onchange: (e) => { opts.period = e.target.value; custom.hidden = opts.period !== 'custom'; refresh(); } },
    PERIODS.map(([v, t]) => el('option', { value: v, selected: opts.period === v }, t)),
    (s.team.phases || []).filter(p => p.start).length ? el('optgroup', { label: 'Phase' }, (s.team.phases || []).filter(p => p.start).map(p => el('option', { value: 'phase:' + p.id, selected: opts.period === 'phase:' + p.id }, p.name))) : '');
  const custom = el('div.rp-custom', { hidden: opts.period !== 'custom' },
    el('input', { type: 'date', value: opts.from, 'aria-label': 'From', onchange: (e) => { opts.from = e.target.value; refresh(); } }), ' – ',
    el('input', { type: 'date', value: opts.to, 'aria-label': 'To', onchange: (e) => { opts.to = e.target.value; refresh(); } }));
  const personSel = el('select', { id: 'rp-person', 'aria-label': 'Whose work', onchange: (e) => { opts.person = e.target.value; refresh(); } },
    el('option', { value: 'all' }, 'Everyone'),
    cleanFeatures(s.team.features).subteams && (s.team.subteams || []).length ? el('optgroup', { label: 'Sub-team' }, s.team.subteams.map(g => el('option', { value: 'st:' + g.id, selected: opts.person === 'st:' + g.id }, g.name))) : '',
    s.members.map(mm => el('option', { value: mm.uid, selected: opts.person === mm.uid }, (mm.uid === ctx.user.uid ? 'Just me — ' : '') + (mm.name || mm.email))));
  const secs = el('div.rp-secs', {}, available.map(([k, label]) => el('label.rp-sec', {},
    el('input', { type: 'checkbox', checked: opts.sections.includes(k), dataset: { sec: k }, onchange: (e) => { opts.sections = e.target.checked ? opts.sections.concat(k) : opts.sections.filter(x => x !== k); refresh(); } }), label)));
  let t = null;
  const msg = el('textarea', { id: 'rp-message', rows: 3, maxlength: 2000, placeholder: 'A note at the top, e.g. “Hi Dr Smith — main question for Thursday: …”', oninput: (e) => { opts.message = e.target.value; clearTimeout(t); t = setTimeout(refresh, 400); } });
  const side = el('div.rp-side', {},
    el('label.rs-field', {}, el('span', {}, 'Period'), periodSel), custom,
    el('label.rs-field', {}, el('span', {}, 'Whose work'), personSel),
    el('div.rs-field', {}, el('span', {}, 'Sections'), secs),
    el('label.rs-field', {}, el('span', {}, 'Note to include'), msg));
  m.body.append(el('div.rp-wrap', {}, side, el('div.rp-preview', {}, frame)));
  const fileBase = () => (s.team.name || 'Team').replace(/[^\w-]+/g, '_') + '_Progress_' + localISO(new Date());
  const download = (name, text, type) => { const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };
  m.foot.append(
    el('span.hint', {}, 'Tip: in the print window choose “Save as PDF”.'), el('span.spacer'),
    el('button.btn.small', { type: 'button', id: 'rp-copy', onclick: async () => { const text = reportText(current); try { await navigator.clipboard.writeText(text); toast('Report copied — paste it into an email.'); } catch { download(fileBase() + '.txt', text, 'text/plain'); } } }, '📋 Copy as text'),
    el('button.btn.small', { type: 'button', id: 'rp-word', onclick: () => download(fileBase() + '.doc', reportHtml(current, { forWord: true }), 'application/msword') }, '⬇ Word'),
    el('button.btn.small.primary', { type: 'button', id: 'rp-print', onclick: () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { toast('Printing isn’t available here — use Word or Copy instead.'); } } }, '🖨 Print / PDF'));
  refresh();
  return { refresh, get report() { return current; }, opts };
}
