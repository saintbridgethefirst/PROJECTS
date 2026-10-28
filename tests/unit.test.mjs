// Unit tests: sync engine + permissions + the demo's rules copy.  Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, flatten, diff, deniedChanges, changesToOps, restoreOps, mergeChanges, invert } from '../src/sync.js';
import { can, canEditOwnedBy, DEFAULT_ROLES } from '../src/permissions.js';
import { findMentions, cleanComment, cleanRepeat, cleanTemplate, stageOf, cleanEffort, cleanDeps, cleanCapacity } from '../src/model.js';
import { cleanTeam, cleanTask, cleanMember, cleanPhoto, cleanPhase, nextWeekTitle, renumberWeeks, isoWeekNumber } from '../src/model.js';
import { buildPrompt } from '../src/ai.js';
import { cleanMeeting, cleanNotebookEntry, cleanPart, cleanExpense, cleanBudget, cleanPaper, partTotal, carryRoots } from '../src/model.js';
import { parseBibtex, toBibtex, actionsFromNotes, financeSummary } from '../src/research.js';
import { buildReport, reportHtml, reportText, resolvePeriod } from '../src/report.js';
import { paidParts, cleanLogEntry, cleanSubteams, subteamsOf, cleanExtras, partItems, partExtras, planOf, hasPro, memberRoom, cleanPlan, isAcademicEmail } from '../src/model.js';

test('extra costs on a part: fixed amounts, percentages and discounts', () => {
  const p = cleanPart({ name: 'Spar', qty: 2, unitCost: 10, extras: [{ label: 'Shipping', amount: 3.99 }, { label: 'VAT / tax', amount: 20, percent: true }, { label: '', amount: 'x' }] });
  assert.equal(partItems(p), 20); assert.equal(p.extras[2].label, 'Extra'); assert.equal(p.extras[2].amount, 0);
  assert.equal(partExtras(p), 7.99); assert.equal(partTotal(p), 27.99);
  assert.equal(partTotal(cleanPart({ qty: 1, unitCost: 10, extras: [{ label: 'Discount', amount: -15 }] })), 0, 'never below zero');
  assert.equal(cleanExtras([{ amount: 500, percent: true }])[0].amount, 100, 'a percentage is capped at 100');
  assert.equal(cleanExtras(Array.from({ length: 15 }, () => ({ amount: 1 }))).length, 10);
  assert.equal(partTotal(cleanPart({ qty: 3, unitCost: 2 })), 6, 'parts without extras are unchanged');
});

test('sub-teams: cleaning, leads must be members, membership lookup', () => {
  const st = cleanSubteams([{ id: 'f', name: '  Fuselage ', members: ['a', 'b', 'b', 7], leads: ['b', 'z'] }, { id: 'f', name: 'dup' }, { name: '', color: 'red' }, null]);
  assert.equal(st.length, 2); assert.equal(st[0].name, 'Fuselage'); assert.deepEqual(st[0].members, ['a', 'b']); assert.deepEqual(st[0].leads, ['b']);
  assert.equal(st[1].name, 'Sub-team'); assert.match(st[1].color, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(subteamsOf({ subteams: st }, 'a').map(s => s.id), ['f']);
  assert.equal(cleanSubteams(Array.from({ length: 30 }, (_, i) => ({ id: 's' + i }))).length, 20);
  assert.deepEqual(cleanTeam({ name: 'T' }).subteams, []);
});

test('report for one sub-team', () => {
  const team = cleanTeam({ name: 'Drone', features: { subteams: true }, subteams: [{ id: 'f', name: 'Fuselage', members: ['a'] }, { id: 'e', name: 'Electronics', members: ['b'] }] });
  const rows = [{ id: '1', personId: 'a', person: 'Ann', task: 'Foam', flag: 'completed', completedOn: '2026-10-18', stage: 'Done', subtasks: [] }, { id: '2', personId: 'b', person: 'Bo', task: 'ESC', flag: 'none', stage: 'To do', subtasks: [] }];
  const data = { team, rows, members: [{ uid: 'a', name: 'Ann' }, { uid: 'b', name: 'Bo' }], today: '2026-10-19', author: 'X', parts: [cleanPart({ name: 'Spar', subteamId: 'f', status: 'needed' }), cleanPart({ name: 'Wire', subteamId: 'e', status: 'needed' })] };
  let r = buildReport(data, { period: '7', person: 'st:f' });
  assert.equal(r.title, 'Progress report — Fuselage');
  const txt = reportText(r); assert.ok(txt.includes('Foam') && !txt.includes('ESC'), txt);
  r = buildReport(data, { period: '7', person: 'all' });
  const s = r.sections.find(x => x.key === 'subteams'); assert.ok(s, 'whole-team report has a sub-team section');
  assert.deepEqual(s.table.rows.map(x => x[0]), ['Fuselage', 'Electronics']); assert.equal(s.table.rows[0][4], '100%');
});
import { budgetChanges, expenseChanges, partChanges, removeLinePlan } from '../src/finance-log.js';
import { cleanDissertation } from '../src/model.js';
import { cleanFeatures, NEW_TEAM_FEATURES, cleanProfile, workdaysFree, capacityFor, hasSkill, cleanTimeLog, loggedHours, cleanRisk, riskScore, cleanRequirement, nextReqRef } from '../src/model.js';
import { heatClass, crossTeamLoad, reqCoverage, timesheetRange, riskBand } from '../src/tools-extra.js';
import { checkWrite, checkRead, applyOps, checkProfileWrite } from '../src/rules-sim.js';
import { fixture, users, writeScenarios, readScenarios, TEAM, task as taskDoc } from './scenarios.mjs';

const team = cleanTeam({ name: 'T', ownerUid: 'o', roles: DEFAULT_ROLES, weeks: [{ key: 'w1', title: 'W1' }, { key: 'w2', title: 'W2' }] });
const members = [{ uid: 'o', name: 'Olivia', email: 'o@x', roleId: 'owner' }, { uid: 'm', name: 'Max', email: 'm@x', roleId: 'member' }, { uid: 'v', name: 'Val', email: 'v@x', roleId: 'viewer' }];
const categories = [{ id: 'c1', name: 'GEN', ownerUid: 'm', order: 0 }, { id: 'c2', name: 'GEN', ownerUid: 'o', order: 0 }];
const tasks = [cleanTask(taskDoc('m', 'c1', { name: 'A', order: 0 }), 'ta'), cleanTask(taskDoc('m', 'c1', { name: 'B', order: 1, weekId: 'w2' }), 'tb'), cleanTask(taskDoc('o', 'c2', { name: 'C' }), 'tc')];
const state = { team, members, categories, tasks };

test('model round-trips: flatten(buildModel(db)) reproduces the documents', () => {
  const flat = flatten(buildModel(state));
  assert.deepEqual(Object.keys(flat.tasks).sort(), ['ta', 'tb', 'tc']);
  assert.equal(flat.tasks.tb.weekId, 'w2'); assert.equal(flat.tasks.tb.ownerUid, 'm'); assert.equal(flat.tasks.ta.categoryId, 'c1');
  assert.deepEqual(flat.cats.c1, { name: 'GEN', ownerUid: 'm', order: 0 });
  assert.deepEqual(diff(flat, flatten(buildModel(state))), [], 'no spurious changes');
});

test('orphans (deleted week or category) are never shown or written', () => {
  const s2 = { ...state, tasks: [...tasks, cleanTask(taskDoc('m', 'c1', { weekId: 'gone' }), 'orphan'), cleanTask(taskDoc('m', 'nocat'), 'orphan2')] };
  const flat = flatten(buildModel(s2));
  assert.ok(!flat.tasks.orphan && !flat.tasks.orphan2);
  assert.deepEqual(diff(flat, flatten(buildModel(s2))), []);
});

test('a former member keeps their rows under a placeholder person', () => {
  const model = buildModel({ ...state, members: members.filter(m => m.uid !== 'm') });
  const ghost = model.db.find(p => p.id === 'm');
  assert.ok(ghost && ghost.former); assert.equal(ghost.categories.length, 1);
});

test('diff finds edits, moves, creates and deletes; ops only send changed fields', () => {
  const base = flatten(buildModel(state));
  const model = buildModel(state);
  const max = model.db.find(p => p.id === 'm');
  max.categories[0].w1[0].name = 'A renamed';                       // edit
  max.categories[0].w2.push(max.categories[0].w1.shift());           // move A to week 2 (B shifts order)
  max.categories[0].w1.push({ id: 'tnew', name: 'New' });            // create (sparse fields → defaults)
  model.db.find(p => p.id === 'o').categories[0].w1 = [];            // delete C
  const changes = diff(base, flatten(model));
  const ops = changesToOps(changes, { uid: 'm', name: 'Max' });
  const byPath = Object.fromEntries(ops.map(o => [o.path, o]));
  assert.equal(byPath['tasks/ta'].type, 'update');
  assert.equal(byPath['tasks/ta'].data.name, 'A renamed'); assert.equal(byPath['tasks/ta'].data.weekId, 'w2');
  assert.ok(!('priority' in byPath['tasks/ta'].data), 'unchanged fields are not sent');
  assert.equal(byPath['tasks/tnew'].type, 'set');
  assert.deepEqual(byPath['tasks/tnew'].data.custom, {}); assert.deepEqual(byPath['tasks/tnew'].data.attachments, []); assert.equal(byPath['tasks/tnew'].data.icon, '');
  assert.equal(byPath['tasks/tc'].type, 'delete');
});

test('permission check blocks edits outside your rows and role', () => {
  const base = flatten(buildModel(state));
  const model = buildModel(state); model.db.find(p => p.id === 'o').categories[0].w1[0].name = 'x';
  const ch = diff(base, flatten(model));
  assert.deepEqual(deniedChanges(ch, team, members[1]), ['edit this task'], 'member cannot edit owner task');
  assert.deepEqual(deniedChanges(ch, team, members[0]), [], 'owner can');
  const m2 = buildModel(state); m2.weeksData.push({ key: 'w3', title: 'W3', metric: '', startDate: '' });
  assert.deepEqual(deniedChanges(diff(base, flatten(m2)), team, members[2]), ['change weeks'], 'viewer cannot add weeks');
});

test('undo restores only what you changed; redo re-applies; coalescing merges', () => {
  const ch1 = [{ kind: 'task', id: 't', before: { name: 'a', ownerUid: 'm' }, after: { name: 'b', ownerUid: 'm' } }];
  const ch2 = [{ kind: 'task', id: 't', before: { name: 'b', ownerUid: 'm' }, after: { name: 'c', ownerUid: 'm' } }];
  const merged = mergeChanges(ch1, ch2);
  assert.equal(merged.length, 1); assert.equal(merged[0].before.name, 'a'); assert.equal(merged[0].after.name, 'c');
  assert.deepEqual(mergeChanges(ch1, invert(ch1)), [], 'edit + revert cancels out');
  const undo = restoreOps(merged, { uid: 'm', name: 'Max' }, 'before');
  assert.equal(undo[0].type, 'update'); assert.equal(undo[0].data.name, 'a');
  const created = [{ kind: 'task', id: 'n', before: null, after: { name: 'n', ownerUid: 'm' } }];
  assert.equal(restoreOps(created, { uid: 'm', name: 'M' }, 'before')[0].type, 'delete', 'undo create = delete');
  assert.equal(restoreOps(created, { uid: 'm', name: 'M' }, 'after')[0].type, 'set', 'redo create = recreate');
});

test('permissions: owner always, roles otherwise', () => {
  assert.ok(can(team, members[0], 'roles.manage'));
  assert.ok(can(team, members[1], 'tasks.editOwn')); assert.ok(!can(team, members[1], 'members.manage'));
  assert.ok(canEditOwnedBy(team, members[1], 'm')); assert.ok(!canEditOwnedBy(team, members[1], 'o'));
  assert.ok(!canEditOwnedBy(team, members[2], 'v'));
  assert.ok(!can(team, { uid: 'x', roleId: 'deleted-role' }, 'analytics.view'));
});

test('cleanTask strips hostile or malformed data', () => {
  const t = cleanTask({ name: 'x'.repeat(900), priority: 'Mega', flag: 'pwn', icon: 'javascript:alert(1)', attachments: [{ url: 'javascript:alert(1)', name: 'bad' }, { url: 'https://ok.com/a', name: 'ok' }], custom: { f1: 'v', nope: 'x' }, subtasks: 'nope' }, 'id1', [{ id: 'f1', type: 'text', options: [] }]);
  assert.equal(t.name.length, 500); assert.equal(t.priority, 'Minor'); assert.equal(t.flag, 'none');
  assert.equal(t.icon, 'java'); assert.equal(t.attachments.length, 1); assert.deepEqual(t.custom, { f1: 'v' }); assert.deepEqual(t.subtasks, []);
});

// ── Security scenarios against the demo's rules copy ─────────────────────────
for (const [name, who, teamId, ops, expected] of writeScenarios) {
  test('rules: ' + name, () => {
    const pre = fixture(); let ok = true; let err;
    try { const post = applyOps(pre, teamId, ops); ops.forEach(op => checkWrite(pre, post, users[who], teamId, op)); }
    catch (e) { ok = false; err = e; }
    assert.equal(ok ? 'allow' : 'deny', expected, err ? err.message : 'was allowed');
  });
}
for (const [name, who, , expected] of readScenarios) {
  test('rules (read): ' + name, () => {
    let ok = true; try { checkRead(fixture(), who ? users[who] : null, TEAM); } catch { ok = false; }
    assert.equal(ok ? 'allow' : 'deny', expected);
  });
}

test('week numbering: own numbering counts on from the highest WEEK n; calendar uses ISO weeks', () => {
  assert.equal(nextWeekTitle('sequence', [], '2026-10-12'), 'WEEK 1');
  assert.equal(nextWeekTitle('sequence', [{ title: 'WEEK 1' }, { title: 'Sprint review' }, { title: 'week 7' }], ''), 'WEEK 8');
  assert.equal(nextWeekTitle('sequence', [{ title: 'Kick-off' }, { title: 'Build' }], ''), 'WEEK 3');
  assert.equal(nextWeekTitle('calendar', [{ title: 'WEEK 1' }], '2026-10-12'), 'WEEK 42');
  assert.equal(nextWeekTitle('calendar', [], ''), 'WEEK 1', 'calendar without a date falls back to counting');
  assert.equal(isoWeekNumber('2026-01-01'), 1);
  assert.equal(isoWeekNumber('2027-01-01'), 53, '1 Jan 2027 is a Friday, so it belongs to week 53 of 2026');
  assert.equal(isoWeekNumber('2026-12-28'), 53);
  const weeks = [{ key: 'a', title: 'WEEK 40', startDate: '2026-09-28' }, { key: 'b', title: 'x', startDate: '' }, { key: 'c', title: 'WEEK 42', startDate: '2026-10-12' }];
  assert.deepEqual(renumberWeeks('sequence', weeks).map(w => w.title), ['WEEK 1', 'WEEK 2', 'WEEK 3']);
  assert.deepEqual(renumberWeeks('calendar', weeks).map(w => w.title), ['WEEK 40', 'x', 'WEEK 42'], 'undated weeks keep their name');
  assert.equal(cleanTeam({ name: 'T' }).weekNaming, 'sequence', 'teams default to own numbering');
  assert.equal(cleanTeam({ name: 'T', weekNaming: 'calendar' }).weekNaming, 'calendar');
  assert.equal(cleanTeam({ name: 'T', weekNaming: 'bogus' }).weekNaming, 'sequence');
});

test('phases: cleaned, capped, and a task keeps its phase through a board edit', () => {
  const p = cleanPhase({ id: 'ph 1', name: '<b>Research</b>'.repeat(10), color: 'red', start: '2026-10-01', end: 'soon', milestone: 'Lit review done' }, 1);
  assert.equal(p.id, 'ph_1'); assert.equal(p.name.length, 60); assert.match(p.color, /^#[0-9a-f]{6}$/, 'bad colours fall back to the palette');
  assert.equal(p.start, '2026-10-01'); assert.equal(p.end, '', 'non-dates are dropped');
  assert.equal(cleanTeam({ name: 'T' }).phases.length, 0);
  assert.equal(cleanTeam({ name: 'T', phases: Array.from({ length: 30 }, (_, i) => ({ id: 'p' + i, name: 'P' + i })) }).phases.length, 20, 'at most 20 phases');
  assert.equal(cleanTask({ name: 'x' }, 't').phaseId, '', 'no phase by default');
  assert.equal(cleanTask({ name: 'x', phaseId: 'ph1' }, 't').phaseId, 'ph1');
  const base = flatten(buildModel(state));
  const model = buildModel(state); model.db.find(p => p.id === 'm').categories[0].w1[0].phaseId = 'ph1';
  const ch = diff(base, flatten(model));
  assert.equal(ch.length, 1); assert.deepEqual(changesToOps(ch, { uid: 'm', name: 'Max' })[0].data.phaseId, 'ph1', 'only the phase is written');
  assert.equal(diff(base, flatten(buildModel(state))).length, 0, 'tasks without a phase do not cause writes');
});

test('AI prompt lists phases and each task’s phase', () => {
  const row = { week: 'WEEK 1', weekStart: '', person: 'Max', category: 'GEN', task: 'Survey', priority: 'Minor', flag: 'none', status: '', deadline: '', overdue: false, completedOn: '', phase: 'Research', subtasks: [], supporting: [], custom: {}, files: [] };
  const out = buildPrompt([row], { total: 1, completed: 0, pct: 0, pending: 0, backlog: 0, open: 1, overdue: 0, dueWeek: 0, risk: 0 }, { goal: 'status' }, 'T', [{ name: 'Research', start: '2026-10-01', end: '2026-10-31', milestone: 'Lit review' }]);
  assert.match(out, /Project phases, in order: Research \(2026-10-01 to 2026-10-31\) — milestone: Lit review/);
  assert.match(out, /phase Research/);
});

test('mentions: full names, longest first, not inside email addresses', () => {
  const ms = [{ uid: 'a', name: 'Ana', email: 'ana@x.com' }, { uid: 'b', name: 'Ana Lopez', email: 'al@x.com' }, { uid: 'c', name: 'Tom (Lab)', email: 'tom@x.com' }];
  assert.deepEqual(findMentions('hi @Ana Lopez and @tom (lab), cc @ana', ms), ['b', 'c', 'a']);
  assert.deepEqual(findMentions('@Ana Lopez only', ms), ['b'], '"@Ana Lopez" does not also mention Ana');
  assert.deepEqual(findMentions('@Anabel', ms), [], 'partial names do not match');
  assert.deepEqual(findMentions('mail me at x@ana.com', ms), [], 'email addresses are not mentions');
  assert.deepEqual(findMentions('(@al) please', ms), ['b'], 'the part of an email before @ works too');
  const c = cleanComment({ taskId: 't 1', authorUid: 'u', text: 'x'.repeat(3000), mentions: ['a', 'a', 'b'], createdAt: '5' }, 'c1');
  assert.equal(c.taskId, 't_1'); assert.equal(c.text.length, 2000); assert.deepEqual(c.mentions, ['a', 'b']); assert.equal(c.createdAt, 5);
});

test('calendar: events for deadlines and phases, valid .ics', async () => {
  globalThis.location = { origin: 'https://uni-teamtrack.web.app', pathname: '/' };
  const { teamEvents, buildIcs } = await import('../src/calendar.js');
  const session = { teamId: 't1', team: { name: 'Robotics, Group; "A"', weeks: [{ key: 'w1', title: 'WEEK 1' }], phases: [{ id: 'p1', name: 'Build', start: '2026-10-01', end: '2026-10-31', milestone: 'Demo day' }, { id: 'p2', name: 'Test', start: '', end: '' }] },
    members: [{ uid: 'u1', name: 'Max' }, { uid: 'u2', name: 'Ana' }],
    tasks: [cleanTask({ ...taskDoc('u1', 'c1'), name: 'Order servos', dueDate: '2026-10-31', phaseId: 'p1', subtasks: [{ id: 's', title: 'x', completed: true }] }, 'a'),
      cleanTask({ ...taskDoc('u2', 'c1'), name: 'Ana task', dueDate: '2026-11-02' }, 'b'),
      cleanTask({ ...taskDoc('u1', 'c1'), name: 'Done one', dueDate: '2026-10-05', flag: 'completed', completedDate: '2026-10-04' }, 'c'),
      cleanTask({ ...taskDoc('u1', 'c1'), name: 'No date' }, 'd')] };
  const mine = teamEvents(session, { scope: 'mine', uid: 'u1' });
  assert.deepEqual(mine.map(e => e.id).sort(), ['milestone-p1', 'phase-p1', 'task-a'], 'my open deadline + dated phase + milestone');
  assert.equal(mine[0].id, 'phase-p1', 'sorted by date');
  assert.equal(mine.find(e => e.id === 'task-a').end, '2026-11-01', 'all-day event ends the next day (month rollover)');
  assert.equal(mine.find(e => e.id === 'phase-p1').end, '2026-11-01', 'phase covers its last day');
  assert.match(mine.find(e => e.id === 'task-a').description, /Phase: Build[\s\S]*Sub-tasks: 1 of 1 done[\s\S]*https:\/\/uni-teamtrack.web.app\/#\/t\/t1/);
  assert.equal(teamEvents(session, { scope: 'all', uid: 'u1', includePhases: false }).length, 2, 'whole team, open only, no phases');
  assert.equal(teamEvents(session, { scope: 'all', uid: 'u1', includeDone: true, includePhases: false }).length, 3, 'completed included on request');
  const ics = buildIcs(mine, { calName: 'Trawpie – ' + session.team.name, teamId: 't1' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(ics, /UID:task-a\.t1@teamtrack/); assert.match(ics, /DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101/);
  assert.match(ics, /X-WR-CALNAME:Trawpie – Robotics\\, Group\\; "A"/, 'commas and semicolons escaped');
  assert.ok(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), 'long lines folded to 75 bytes');
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 3, 'reminders on the deadline and the milestone (the day before, and a week ahead), not the phase band');
  assert.equal((ics.match(/TRIGGER:-P6DT15H/g) || []).length, 1, 'only the milestone gets the week-ahead reminder');
  const flagged = teamEvents({ ...session, tasks: [cleanTask({ ...taskDoc('u1', 'c1'), name: 'Hand in', dueDate: '2026-11-20', icon: '🚩', priority: 'Critical' }, 'h')] }, { scope: 'mine', uid: 'u1', includePhases: false });
  assert.match(buildIcs(flagged, { calName: 'x', teamId: 't1' }), /TRIGGER:-PT15H[\s\S]*In a week: Due: Hand in[\s\S]*TRIGGER:-P6DT15H/, 'a 🚩 deadline reminds you a week ahead too');
});

test('import: Jira CSV columns, Trello board export, GitHub links', async () => {
  const { rowsFromTable, rowsFromTrello } = await import('../src/importer.js');
  const { parseGithub } = await import('../src/github.js');
  const TT = { label: (k) => ({ jiraId: { label: 'Reference ID' }, status: { label: 'Status badge' } }[k]), team: { fields: [] } };
  const jira = [['Summary', 'Issue key', 'Issue id', 'Issue Type', 'Status', 'Priority', 'Assignee', 'Due date', 'Resolved', 'Epic Link', 'Sprint'],
    ['Calibrate IMU', 'ROB-12', '10012', 'Task', 'In Progress', 'Highest', 'Ana Lopez', '21/Oct/26 12:00 AM', '', 'Sensors', 'Sprint 3'],
    ['Write report', 'ROB-13', '10013', 'Story', 'Done', 'Low', 'max@uni.ac.uk', '', '15/Oct/26 3:10 PM', '', '']];
  const r = rowsFromTable(jira, TT);
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].task, r[0].ref, r[0].status, r[0].priority, r[0].owner, r[0].deadline, r[0].category, r[0].week, r[0].flag],
    ['Calibrate IMU', 'ROB-12', 'In Progress', 'Blocker', 'Ana Lopez', '2026-10-21', 'Sensors', 'Sprint 3', 'none'], 'Jira columns mapped (Epic preferred over Issue Type)');
  assert.deepEqual([r[1].flag, r[1].completedOn, r[1].priority, r[1].category], ['completed', '2026-10-15', 'Minor', 'Story'], 'Done → completed with the resolved date');
  const board = { name: 'Robot build', lists: [{ id: 'l1', name: 'To do' }, { id: 'l2', name: 'Done' }, { id: 'l3', name: 'Old', closed: true }],
    members: [{ id: 'm1', fullName: 'Ana Lopez' }, { id: 'm2', fullName: 'Max Reed' }], labels: [{ id: 'b1', name: 'Mechanical' }, { id: 'b2', name: 'High' }],
    checklists: [{ id: 'c1', checkItems: [{ name: 'Second', state: 'incomplete', pos: 2 }, { name: 'First', state: 'complete', pos: 1 }] }],
    cards: [{ id: 'x1', idShort: 4, name: 'Design gripper', idList: 'l1', idMembers: ['m1', 'm2'], idLabels: ['b1', 'b2'], due: '2026-10-24T17:00:00.000Z', idChecklists: ['c1'], shortUrl: 'https://trello.com/c/abc' },
      { id: 'x2', idShort: 5, name: 'Order parts', idList: 'l2', idMembers: [], idLabels: [], due: null },
      { id: 'x3', idShort: 6, name: 'Archived card', idList: 'l1', closed: true },
      { id: 'x4', idShort: 7, name: 'In archived list', idList: 'l3' }] };
  const t = rowsFromTrello(board);
  assert.deepEqual(t.map(x => x.task), ['Design gripper', 'Order parts'], 'archived cards and lists are skipped');
  assert.deepEqual([t[0].owner, t[0].supporting[0], t[0].category, t[0].priority, t[0].deadline, t[0].status, t[0].ref], ['Ana Lopez', 'Max Reed', 'Mechanical', 'Critical', '2026-10-24', 'To do', 'Trello #4']);
  assert.deepEqual(t[0].subtasks, [{ title: 'First', completed: true }, { title: 'Second', completed: false }], 'checklist items become sub-tasks, in order');
  assert.equal(t[0].links[0].url, 'https://trello.com/c/abc');
  assert.deepEqual([t[1].flag, t[1].category], ['completed', 'Robot build'], 'a card in a Done list is completed');
  assert.deepEqual(parseGithub('https://github.com/acme/robot-arm/pull/42/files'), { owner: 'acme', repo: 'robot-arm', kind: 'pull', number: 42, label: 'acme/robot-arm#42' });
  assert.equal(parseGithub('https://github.com/acme/robot-arm/issues/7').kind, 'issue');
  assert.equal(parseGithub('https://github.com/acme/robot-arm'), null);
  assert.equal(parseGithub('https://evil.com/github.com/a/b/issues/1'), null);
});

test('repeat and templates are cleaned', () => {
  assert.equal(cleanRepeat(null), null);
  assert.equal(cleanRepeat({ every: 3 }), null, 'only 1, 2 or 4 weeks');
  assert.deepEqual(cleanRepeat({ every: '2', until: '2026-12-01', through: 'wk 1', junk: 1 }), { every: 2, until: '2026-12-01', through: 'wk_1', seriesId: '' });
  assert.deepEqual(cleanRepeat({ seriesId: 'id_abc' }), { every: 0, until: '', through: '', seriesId: 'id_abc' }, 'copies keep their series');
  assert.equal(cleanTask({ name: 'x', repeat: { every: 1 } }, 't').repeat.every, 1);
  const tpl = cleanTemplate({ name: 'Experiment', task: { name: 'Run test', priority: 'Bogus', subtasks: ['Plan', { title: 'Run' }, ''], custom: { f1: 'x', nope: 'y' }, dueOffset: 4 }, createdBy: 'u1' }, 'tpl1', [{ id: 'f1' }]);
  assert.deepEqual([tpl.task.priority, tpl.task.subtasks, tpl.task.custom, tpl.task.dueOffset], ['Minor', ['Plan', 'Run'], { f1: 'x' }, 4]);
  assert.equal(cleanTemplate({ name: '', task: { dueOffset: -2 } }, 't').task.dueOffset, null);
});

test('account photos: small images and https links kept, anything else dropped', () => {
  const ok = 'data:image/png;base64,' + 'A'.repeat(1000);
  assert.equal(cleanPhoto(ok), ok);
  assert.equal(cleanPhoto('https://lh3.googleusercontent.com/a/abc'), 'https://lh3.googleusercontent.com/a/abc');
  assert.equal(cleanPhoto('http://example.com/a.png'), '', 'plain http is not shown');
  assert.equal(cleanPhoto('javascript:alert(1)'), '');
  assert.equal(cleanPhoto('data:image/svg+xml;base64,PHN2Zz4='), '', 'SVG data URLs are refused');
  assert.equal(cleanPhoto('data:image/png;base64,' + 'A'.repeat(80000)), '', 'too large');
  assert.equal(cleanMember({ name: 'x', photo: ok }, 'u1').photo, ok);
});

test('profile rules: only you can write your profile, with a small photo', () => {
  const me = { uid: 'u1', email: 'u1@x.com', emailVerified: true };
  assert.doesNotThrow(() => checkProfileWrite(me, 'u1', { photo: 'data:image/png;base64,AAAA', updatedAt: 1 }));
  assert.doesNotThrow(() => checkProfileWrite(me, 'u1', { photo: '', updatedAt: 1 }));
  assert.throws(() => checkProfileWrite(me, 'u2', { photo: '', updatedAt: 1 }), /permission/i);
  assert.throws(() => checkProfileWrite(null, 'u1', { photo: '', updatedAt: 1 }), /permission/i);
  assert.throws(() => checkProfileWrite(me, 'u1', { photo: '', admin: true }), /permission/i);
  assert.throws(() => checkProfileWrite(me, 'u1', { photo: 'x'.repeat(70000) }), /permission/i);
  assert.doesNotThrow(() => checkProfileWrite(me, 'u1', { photo: '', theme: 'sakura', updatedAt: 1 }), 'a theme can be saved');
  assert.throws(() => checkProfileWrite(me, 'u1', { photo: '', theme: 'x'.repeat(41) }), /permission/i);
  assert.throws(() => checkProfileWrite(me, 'u1', { photo: '', theme: 7 }), /permission/i);
  assert.doesNotThrow(() => checkProfileWrite(me, 'u1', { photo: '', menuStyle: 'circle', updatedAt: 1 }), 'menu style can be saved');
  assert.throws(() => checkProfileWrite(me, 'u1', { photo: '', menuStyle: 'triangle' }), /permission/i);
  assert.doesNotThrow(() => checkProfileWrite(me, 'u1', { photo: '', nav: 'side', updatedAt: 1 }), 'navigation can be saved');
  assert.throws(() => checkProfileWrite(me, 'u1', { photo: '', nav: 'bottom' }), /permission/i);
});

test('sub-tasks, custom fields and attachments edited in place are detected and saved', () => {
  const state = { team: { weeks: [{ key: 'w1', title: 'WEEK 1', metric: '', startDate: '' }] }, members: [{ uid: 'u1', name: 'A', roleId: 'owner' }],
    categories: [{ id: 'c1', name: 'GEN', ownerUid: 'u1', order: 0 }],
    tasks: [{ ...taskDoc('u1', 'c1'), id: 't1', subtasks: [{ id: 's1', title: 'One', completed: false }], custom: { f1: 'x' }, attachments: [] }] };
  const model = buildModel(state);
  const base = flatten(model);
  const t = model.db[0].categories[0].w1[0];
  t.subtasks.push({ id: 's2', title: 'Two', completed: false });   // add
  t.subtasks[0].completed = true;                                   // tick
  t.custom.f1 = 'y';                                                // edit custom field in place
  t.attachments.push({ name: 'Doc', url: 'https://example.com' });
  const changes = diff(base, flatten(model));
  assert.equal(changes.length, 1);
  const ops = changesToOps(changes, { uid: 'u1', name: 'A' });
  assert.deepEqual(ops[0].data.subtasks.map(s => [s.title, s.completed]), [['One', true], ['Two', false]]);
  assert.equal(ops[0].data.custom.f1, 'y');
  assert.equal(ops[0].data.attachments.length, 1);
  assert.equal(state.tasks[0].subtasks.length, 1, 'server state is not changed by board edits');
});

test('planning: stage, effort, dependencies and capacity are cleaned', () => {
  assert.equal(stageOf({ flag: 'completed', stage: 'doing' }), 'done', 'completed always means Done');
  assert.equal(stageOf({ flag: 'none', stage: 'doing' }), 'doing');
  assert.equal(stageOf({ flag: 'none', stage: '', status: 'In Progress' }), 'doing', 'guessed from status text');
  assert.equal(stageOf({ flag: 'none', stage: '', status: 'TODO' }), 'todo');
  assert.equal(stageOf({ flag: 'none', stage: 'todo', status: 'In progress' }), 'todo', 'an explicit stage wins over the status text');
  assert.equal(cleanEffort('2.6'), 2.5, 'rounded to quarter hours'); assert.equal(cleanEffort(''), null); assert.equal(cleanEffort(-1), null); assert.equal(cleanEffort(1e6), null); assert.equal(cleanEffort(0), 0);
  assert.deepEqual(cleanDeps(['a', 'a', 'me', 'b c', null], 'me'), ['a', 'b_c'], 'no duplicates, no self, safe ids');
  assert.equal(cleanDeps(Array.from({ length: 20 }, (_, i) => 'x' + i)).length, 10);
  assert.equal(cleanCapacity('12.4'), 12); assert.equal(cleanCapacity(0), 0); assert.equal(cleanCapacity(500), 0);
  const t = cleanTask({ name: 'x', stage: 'not a stage!', effort: 'abc', dependsOn: 'x' }, 't');
  assert.equal(t.stage, ''); assert.equal(t.effort, null); assert.deepEqual(t.dependsOn, []);
  assert.equal(cleanTeam({ name: 'T', capacity: 10 }).capacity, 10);
  assert.equal(cleanTemplate({ name: 'n', task: { name: 'x', effort: 3 } }, 'id').task.effort, 3);
});

test('planning fields survive a board edit and are saved as changes', () => {
  const t0 = cleanTask(taskDoc('m', 'c1', { name: 'A', stage: 'doing', effort: 2, dependsOn: ['tc'] }), 'ta');
  const s = { ...state, tasks: [t0, ...tasks.slice(1)] };
  const model = buildModel(s); const before = flatten(model);
  assert.equal(before.tasks.ta.stage, 'doing'); assert.equal(before.tasks.ta.effort, 2); assert.deepEqual(before.tasks.ta.dependsOn, ['tc']);
  const tk = model.db.find(p => p.id === 'm').categories[0].w1[0]; tk.effort = 5; tk.dependsOn.push('tb');
  const ch = diff(before, flatten(model));
  assert.equal(ch.length, 1); assert.equal(ch[0].after.effort, 5); assert.deepEqual(ch[0].after.dependsOn, ['tc', 'tb']);
});

test('finance: only finance roles can read money (demo rules)', () => {
  const f = fixture();
  assert.throws(() => checkRead(f, users.mem1, TEAM, 'expenses'), /permission/i);
  assert.doesNotThrow(() => checkRead(f, users.admin1, TEAM, 'expenses'));
  assert.doesNotThrow(() => checkRead(f, users.mem1, TEAM, 'parts'));
});

test('research records are cleaned', () => {
  const m = cleanMeeting({ title: 'x'.repeat(300), attendees: ['a', 'a', 'b c'], actions: [{ text: '' }, { text: 'Do it', ownerUid: 'u 1', dueDate: 'soon' }] }, 'm1');
  assert.equal(m.title.length, 120); assert.deepEqual(m.attendees, ['a', 'b_c']); assert.equal(m.actions.length, 1); assert.equal(m.actions[0].dueDate, ''); assert.equal(m.actions[0].ownerUid, 'u_1');
  const n = cleanNotebookEntry({ taskId: 't', text: 'hi', images: ['javascript:x', 'data:image/png;base64,AAAA', 'data:image/png;base64,' + 'A'.repeat(300000)] }, 'n');
  assert.deepEqual(n.images, ['data:image/png;base64,AAAA']);
  const p = cleanPart({ name: 'Servo', qty: '3', unitCost: '2.499', status: 'lost', url: 'javascript:alert(1)' }, 'p');
  assert.equal(p.qty, 3); assert.equal(p.unitCost, 2.5); assert.equal(p.status, 'needed'); assert.equal(p.url, ''); assert.equal(partTotal(p), 7.5);
  const x = cleanExpense({ kind: 'weird', amount: -5 }, 'x'); assert.equal(x.kind, 'expense'); assert.equal(x.amount, 0);
  assert.equal(cleanBudget({ currency: 'XYZ', lines: [{ name: 'Parts', amount: '100' }] }).currency, 'GBP');
  assert.equal(cleanBudget({ lines: [{ name: 'Parts', amount: '100' }] }).lines[0].amount, 100);
  const pp = cleanPaper({ title: 'T', doi: 'https://doi.org/10.1/X', year: 'nope', status: 'x', tags: ['a', 'a'] }, 'pp');
  assert.equal(pp.doi, '10.1/X'); assert.equal(pp.year, null); assert.equal(pp.status, 'to-read'); assert.deepEqual(pp.tags, ['a']);
});

test('meeting notes: action lines become action items with owners and dates', () => {
  const members = [{ uid: 'u1', name: 'Tom Reed' }, { uid: 'u2', name: 'Aisha Khan' }];
  const found = actionsFromNotes('Agenda\n- [ ] Order servos @Tom Reed by 2026-11-01\nTODO: write the report\nAction: @Aisha Khan book the lab\n- plain bullet', members);
  assert.equal(found.length, 3);
  assert.deepEqual(found[0], { text: 'Order servos', ownerUid: 'u1', dueDate: '2026-11-01' });
  assert.equal(found[1].text, 'write the report'); assert.equal(found[1].ownerUid, '');
  assert.equal(found[2].ownerUid, 'u2'); assert.equal(found[2].text, 'book the lab');
});

test('literature: BibTeX in and out', () => {
  const bib = '@article{smith2024,\n  title = {Robust {Grasping} of Objects},\n  author = {Smith, Anna and Lee, Bo},\n  year = {2024},\n  journal = "IEEE RA-L",\n  doi = {10.1109/LRA.2024.1}\n}\n@comment{skip}\n@inproceedings{x, title={Second}, author={Ng, Al}, booktitle={ICRA}, year=2023}';
  const items = parseBibtex(bib);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Robust Grasping of Objects'); assert.equal(items[0].authors, 'Anna Smith, Bo Lee'); assert.equal(items[0].venue, 'IEEE RA-L'); assert.equal(items[0].doi, '10.1109/LRA.2024.1');
  assert.equal(items[1].venue, 'ICRA'); assert.equal(items[1].year, '2023');
  const out = toBibtex(items.map(i => cleanPaper(i, 'p')));
  assert.match(out, /@article\{smith2024robust,/); assert.match(out, /author = \{Anna Smith and Bo Lee\}/);
  assert.equal(parseBibtex(out).length, 2, 'round trip');
});

test('finance: budget lines, spending, income and committed parts', () => {
  const b = cleanBudget({ currency: 'GBP', lines: [{ id: 'b1', name: 'Parts', amount: 500 }, { id: 'b2', name: 'Travel', amount: 200 }] });
  const ex = [cleanExpense({ kind: 'expense', amount: 120, budgetId: 'b1', partId: 'p2' }), cleanExpense({ kind: 'expense', amount: 30 }), cleanExpense({ kind: 'income', amount: 1000 })];
  const parts = [cleanPart({ name: 'a', qty: 2, unitCost: 50, status: 'ordered', budgetId: 'b1' }, 'p1'), cleanPart({ name: 'b', qty: 1, unitCost: 120, status: 'ordered', budgetId: 'b1' }, 'p2'), cleanPart({ name: 'c', qty: 1, unitCost: 9, status: 'needed' }, 'p3')];
  const s = financeSummary(b, ex, parts);
  assert.equal(s.total, 700); assert.equal(s.spent, 150); assert.equal(s.income, 1000);
  assert.equal(s.committed, 100, 'ordered but not yet paid for (p2 already has an expense)');
  assert.equal(s.remaining, 450); assert.equal(s.balance, 850);
  assert.equal(s.lines[0].spent, 120); assert.equal(s.lines[0].committed, 100); assert.equal(s.other.spent, 30);
});

test('carried-forward chains: explicit links and older copies matched by history', () => {
  const carried = [{ field: 'Action', original: 'WEEK 1', updated: 'Carried forward to WEEK 2' }];
  const items = [
    { id: 'a1', name: 'Paper', cat: 'c', weekIdx: 0, history: [] },
    { id: 'a2', name: 'Paper', cat: 'c', weekIdx: 1, history: carried },
    { id: 'a3', name: 'Paper', cat: 'c', weekIdx: 2, history: carried, carryOf: 'a2' },
    { id: 'b1', name: 'Paper', cat: 'other', weekIdx: 1, history: carried },
    { id: 'c1', name: 'Paper', cat: 'c', weekIdx: 3, history: [] },
  ];
  const r = carryRoots(items);
  assert.equal(r.get('a2'), 'a1'); assert.equal(r.get('a3'), 'a1');
  assert.equal(r.get('b1'), 'b1', 'different row: not the same task');
  assert.equal(r.get('c1'), 'c1', 'same name but never carried: a separate task');
  assert.equal(cleanTask({ name: 'x', carryOf: 'x' }, 'x').carryOf, '', 'a task is never its own original');
});

test('progress report: period, sections, person filter and finance gating', () => {
  const today = '2026-10-19';
  const row = (o) => ({ id: o.id, task: o.task, person: o.person || 'Tom', personId: o.personId || 'u1', phase: o.phase || '', phaseId: o.phaseId || '', priority: o.priority || 'Minor', flag: o.flag || 'none', stage: o.stage || 'To do',
    deadline: o.deadline || '', daysToDeadline: o.days ?? null, overdue: !!o.overdue, completedOn: o.completedOn || '', subtasks: o.subtasks || [], waitIssues: o.waitIssues || [], carryCount: o.carry || 1 });
  const rows = [
    row({ id: 't1', task: 'Order servos', flag: 'completed', completedOn: '2026-10-16', phaseId: 'ph1', phase: 'Build' }),
    row({ id: 't2', task: 'Old thing', flag: 'completed', completedOn: '2026-09-01' }),
    row({ id: 't3', task: 'Wire the arm', stage: 'Doing', deadline: '2026-10-25', days: 6, phaseId: 'ph1', phase: 'Build', subtasks: [{ done: true }, { done: false }], carry: 3 }),
    row({ id: 't4', task: 'Write report', deadline: '2026-10-12', days: -7, overdue: true, person: 'Aisha', personId: 'u2' }),
    row({ id: 't5', task: 'Assemble', waitIssues: ['“Order frame” is overdue'] }),
  ];
  const team = { name: 'Robot Science', phases: [{ id: 'ph1', name: 'Build', start: '2026-10-01', end: '2026-11-30', milestone: 'Arm moves' }], weeks: [{ key: 'w1', startDate: '2026-09-28' }] };
  const data = { team, rows, today, author: 'Aisha', money: false, members: [{ uid: 'u1', name: 'Tom' }, { uid: 'u2', name: 'Aisha' }],
    meetings: [{ title: 'Supervisor', date: '2026-10-15', notes: 'Notes\n- x\n\nDecisions\n- Use MG996R servos\n- Meet weekly\n\nActions\n- [ ] a', actions: [{ text: 'Order servos', ownerUid: 'u1', taskId: 't1' }] }],
    notebook: [{ taskId: 't3', authorUid: 'u1', authorName: 'Tom', date: '2026-10-17', text: 'Torque 1.2 Nm', images: [] }], parts: [{ name: 'Servo', qty: 4, unitCost: 6.5, status: 'ordered', orderedDate: '2026-10-14' }],
    papers: [], expenses: [{ kind: 'expense', amount: 26, date: '2026-10-16', budgetId: '' }], budget: { currency: 'GBP', lines: [] } };
  assert.deepEqual(resolvePeriod({ period: '7' }, today, team, rows), { from: '2026-10-13', to: '2026-10-19', label: 'Last 7 days' });
  assert.equal(resolvePeriod({ period: 'phase:ph1' }, today, team, rows).from, '2026-10-01');
  const R = buildReport(data, { period: '7', person: 'all', message: 'Hi Dr Smith' });
  const sec = (k) => R.sections.find(s => s.key === k);
  assert.ok(!sec('finance'), 'no finance section without the permission');
  assert.equal(sec('summary').kpis[0][1], 1, 'one task completed in the last 7 days');
  assert.deepEqual(sec('completed').table.rows.map(r => r[0]), ['Order servos']);
  assert.equal(sec('progress').table.rows[0][0], 'Wire the arm (week 3)');
  assert.equal(sec('upcoming').table.rows.length, 1);
  assert.equal(sec('risks').table.rows.length, 2, 'overdue + waiting on a late task');
  assert.equal(sec('phases').table.rows[0][2], '1/2 (50%)');
  assert.deepEqual(sec('meetings').items[0].lines.slice(0, 2), ['Decision: Use MG996R servos', 'Decision: Meet weekly']);
  assert.ok(sec('meetings').items[0].lines.some(l => l === 'Action: Order servos (Tom) — done'));
  assert.equal(sec('notebook').items.length, 1);
  assert.ok(sec('parts').lines.some(l => l.startsWith('Ordered: Servo × 4')) && !sec('parts').lines.join(' ').includes('£'), 'no money shown to non-finance roles');
  const withMoney = buildReport({ ...data, money: true }, { period: '7' });
  assert.ok(withMoney.sections.find(s => s.key === 'finance').lines[0].includes('£26'), 'finance roles see spending');
  const mine = buildReport(data, { period: '7', person: 'u2', sections: ['summary', 'risks', 'people'] });
  assert.equal(mine.title, 'Progress report — Aisha');
  assert.deepEqual(mine.sections.map(s => s.key), ['summary', 'risks'], 'only chosen sections; no by-person table for one person');
  assert.equal(mine.sections[1].table.rows.length, 1);
  const html = reportHtml(R); assert.match(html, /Hi Dr Smith/); assert.match(html, /<h2>Completed in this period<\/h2>/);
  assert.ok(!reportHtml({ ...R, team: '<script>x</script>' }).includes('<script>x'), 'escaped');
  const text = reportText(R); assert.match(text, /COMPLETED IN THIS PERIOD\n• Order servos — Tom — Build — 16 Oct/);
});

test('feature switches: new teams start simple, older teams keep what they had', () => {
  assert.equal(NEW_TEAM_FEATURES.planning, true); assert.equal(NEW_TEAM_FEATURES.parts, false); assert.equal(NEW_TEAM_FEATURES.people, false);
  const legacy = cleanFeatures(undefined); assert.equal(legacy.parts, true); assert.equal(legacy.finance, true); assert.equal(legacy.risks, false);
  const f = cleanFeatures({ people: true, nonsense: true, parts: 'yes' }); assert.equal(f.people, true); assert.equal(f.parts, false, 'non-boolean → the new-team default'); assert.ok(!('nonsense' in f));
  assert.equal(cleanTeam({ name: 'T', features: { risks: true } }).features.risks, true);
});

test('people: profiles, time off and capacity', () => {
  const p = cleanProfile({ capacity: '12.4', skills: ['CAD', 'cad', ' ROS ', ''], away: [{ from: '2026-10-23', to: '2026-10-21', note: 'Conference' }, { from: 'x', to: 'y' }] }, 'u1');
  assert.equal(p.capacity, 12); assert.deepEqual(p.skills, ['CAD', 'ROS']); assert.deepEqual(p.away, [{ from: '2026-10-21', to: '2026-10-23', note: 'Conference' }]);
  assert.equal(workdaysFree('2026-10-19', p.away), 2, 'Mon–Fri minus Wed, Thu, Fri');
  assert.equal(capacityFor(p, 0, '2026-10-19'), 4.8);
  assert.equal(capacityFor(cleanProfile({}, 'u2'), 10, '2026-10-19'), 10, 'falls back to the team’s hours');
  assert.equal(capacityFor(cleanProfile({}, 'u2'), 0, '2026-10-19'), 0, 'unknown');
  assert.ok(hasSkill(p, 'cad')); assert.ok(!hasSkill(p, 'Python'));
  assert.equal(heatClass(0, 10), 'empty'); assert.equal(heatClass(3, 10), 'low'); assert.equal(heatClass(8, 10), 'ok'); assert.equal(heatClass(10.5, 10), 'high'); assert.equal(heatClass(15, 10), 'over'); assert.equal(heatClass(2, null), 'away'); assert.equal(heatClass(4, 0), 'nocap');
});

test('workload across teams adds up each person’s hours per calendar week', () => {
  const sn = (name, weeks, tasks, members, profiles = [], capacity = 0) => ({ team: { name, weeks, capacity }, tasks, members, profiles });
  const a = sn('Robotics', [{ key: 'w1', startDate: '2026-10-19' }, { key: 'w2', startDate: '2026-10-26' }], [{ ownerUid: 'u1', weekId: 'w1', effort: 6, name: 'Gripper' }, { ownerUid: 'u1', weekId: 'w2', effort: 2, name: 'Test' }], [{ uid: 'u1', name: 'Tom' }], [{ uid: 'u1', capacity: 10, away: [] }]);
  const b = sn('Thesis', [{ key: 'x1', startDate: '2026-10-21' }], [{ ownerUid: 'u1', weekId: 'x1', effort: 7, name: 'Write ch.2' }, { ownerUid: 'u2', weekId: 'x1', effort: 3, name: 'Read' }], [{ uid: 'u1', name: 'Tom' }, { uid: 'u2', name: 'Ana' }], [], 8);
  const ppl = crossTeamLoad([a, b], ['2026-10-19', '2026-10-26']);
  const tom = ppl.find(p => p.uid === 'u1');
  assert.equal(tom.cells['2026-10-19'].hours, 13, '6 in Robotics + 7 in Thesis (a Wednesday start counts as that week)');
  assert.deepEqual(tom.cells['2026-10-19'].byTeam, { Robotics: 6, Thesis: 7 });
  assert.equal(tom.capacity, 10); assert.equal(tom.teams.length, 2);
  assert.equal(ppl.find(p => p.uid === 'u2').capacity, 8, 'team default when no profile');
});

test('time logging, risks and requirements', () => {
  const log = cleanTimeLog([{ id: 'a', uid: 'u', name: 'Tom', date: '2026-10-19', hours: '1.3', note: 'x' }, { hours: 2 }, { date: '2026-10-19', hours: 30 }]);
  assert.equal(log.length, 2); assert.equal(log[0].hours, 1.25); assert.equal(log[1].hours, 24);
  assert.equal(loggedHours({ timeLog: log }), 25.25);
  assert.equal(cleanTask({ name: 'x', timeLog: log, skill: '  CAD  ' }, 't').skill, 'CAD');
  const r = cleanRisk({ title: 'Late parts', likelihood: 9, impact: '4', status: 'weird' }, 'r'); assert.equal(r.likelihood, 3); assert.equal(r.impact, 4); assert.equal(r.status, 'open'); assert.equal(riskScore(r), 12);
  assert.equal(riskBand(15), 'high'); assert.equal(riskBand(8), 'med'); assert.equal(riskBand(4), 'low');
  assert.equal(nextReqRef([{ ref: 'REQ-001' }, { ref: 'REQ-009' }, { ref: 'custom' }]), 'REQ-010'); assert.equal(nextReqRef([]), 'REQ-001');
  const reqs = [cleanRequirement({ title: 'a', taskIds: ['t1'], verified: true, priority: 'must' }, 'q1'), cleanRequirement({ title: 'b', taskIds: ['t2'], priority: 'must' }, 'q2'), cleanRequirement({ title: 'c' }, 'q3'), cleanRequirement({ title: 'd', status: 'dropped' }, 'q4')];
  const tasks = { t1: { flag: 'completed' }, t2: { flag: 'none' } };
  const cov = reqCoverage(reqs, (id) => tasks[id] || null);
  assert.deepEqual([cov.total, cov.covered, cov.delivered, cov.verified, cov.coveredPct, cov.mustOpen], [3, 2, 1, 1, 67, 1]);
  assert.deepEqual(timesheetRange('week', '2026-10-21'), { from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(timesheetRange('lastmonth', '2026-10-21'), { from: '2026-09-01', to: '2026-09-30' });
});

// ── Parts ↔ payments and the finance history ────────────────────────────────
const N = { money: (v) => '£' + Number(v || 0).toFixed(2), line: (id) => ({ b1: 'Parts', b2: 'Travel' })[id] || 'Not assigned', part: (id) => ({ p1: 'Fuselage', p2: 'Servo' })[id] || 'a deleted part', task: () => 'Build', phase: () => 'Phase 1', status: (s) => s };

test('records not yet saved have no id (so each new part, risk or paper gets its own)', () => {
  assert.equal(cleanPart({ name: 'a' }).id, ''); assert.equal(cleanPaper({}).id, ''); assert.equal(cleanRisk({}).id, ''); assert.equal(cleanRequirement({}).id, '');
  assert.equal(cleanExpense({}).id, ''); assert.equal(cleanMeeting({}).id, ''); assert.equal(cleanPart({}, 'pt_1').id, 'pt_1'); assert.equal(cleanPart({ id: 'a b' }).id, 'a_b');
});

test('payments: partIds, the old partId and paidParts', () => {
  const a = cleanExpense({ kind: 'expense', amount: 10, partId: 'p1', partIds: ['p2', 'p2', 7, ''] });
  assert.deepEqual(a.partIds, ['p2', 'p1']); assert.equal(a.partId, 'p2');
  assert.deepEqual(cleanExpense({ amount: 1 }).partIds, []);
  assert.equal(cleanExpense({ partIds: Array.from({ length: 40 }, (_, i) => 'x' + i) }).partIds.length, 30);
  const m = paidParts([cleanExpense({ kind: 'expense', amount: 5, partIds: ['p1', 'p2'], date: '2026-10-01' }, 'e1'), cleanExpense({ kind: 'income', amount: 5, partIds: ['p3'] }, 'e2')]);
  assert.equal(m.get('p1').id, 'e1'); assert.equal(m.get('p2').id, 'e1'); assert.ok(!m.has('p3'), 'income never pays for a part');
});

test('finance: committed counts bought parts that no payment covers', () => {
  const b = cleanBudget({ currency: 'GBP', lines: [{ id: 'b1', name: 'Parts', amount: 100 }] });
  const parts = [cleanPart({ name: 'Fuselage', qty: 1, unitCost: 12.99, status: 'ordered' }, 'p1'), cleanPart({ name: 'Servo', qty: 2, unitCost: 5, status: 'received', budgetId: 'b1' }, 'p2'), cleanPart({ name: 'Wing', qty: 1, unitCost: 3, status: 'needed' }, 'p3')];
  let s = financeSummary(b, [cleanExpense({ kind: 'expense', amount: 12.99 })], parts);
  assert.equal(s.committed, 22.99, 'unlinked: both bought parts are still committed');
  s = financeSummary(b, [cleanExpense({ kind: 'expense', amount: 12.99, partIds: ['p1'] })], parts);
  assert.equal(s.committed, 10, 'linked: the fuselage is no longer counted twice');
  assert.equal(s.spent, 12.99); assert.equal(s.lines[0].committed, 10); assert.equal(s.other.committed, 0);
  s = financeSummary(b, [cleanExpense({ kind: 'expense', amount: 22.99, partIds: ['p1', 'p2'] })], parts);
  assert.equal(s.committed, 0, 'one payment can cover several parts');
});

test('finance history: budget changes in plain English', () => {
  const before = cleanBudget({ currency: 'GBP', lines: [{ id: 'b1', name: 'Parts', amount: 100 }, { id: 'b2', name: 'Travel', amount: 50 }] });
  const after = cleanBudget({ currency: 'EUR', lines: [{ id: 'b1', name: 'Components', amount: 120, phaseId: 'ph1' }, { id: 'b3', name: 'Printing', amount: 0 }] });
  const t = budgetChanges(before, after, N);
  ['Currency changed from GBP to EUR', 'Renamed budget line “Parts” to “Components”', '“Components” budget £100.00 → £120.00', '“Components” phase set to Phase 1', 'Added budget line “Printing”', 'Removed budget line “Travel” (£50.00)'].forEach(x => assert.ok(t.includes(x), x + ' in: ' + t));
  assert.equal(budgetChanges(before, before, N), '');
});

test('finance history: spending, income and parts', () => {
  const x = cleanExpense({ kind: 'expense', amount: 12.99, date: '2026-10-18', description: 'Fuselage (TEMU)', budgetId: 'b1', partIds: ['p1'] }, 'e1');
  assert.equal(expenseChanges(null, x, N), 'Added spending £12.99 dated 2026-10-18 — Fuselage (TEMU) · budget line “Parts” · pays for “Fuselage”');
  assert.equal(expenseChanges(x, null, N), 'Deleted spending £12.99 — Fuselage (TEMU) (dated 2026-10-18)');
  const y = { ...x, amount: 14, budgetId: 'b2', partIds: ['p1', 'p2'], receiptUrl: 'https://r' };
  const t = expenseChanges(x, y, N);
  assert.ok(t.startsWith('Edited spending “Fuselage (TEMU)”: ') && t.includes('amount £12.99 → £14.00') && t.includes('budget line “Parts” → “Travel”') && t.includes('linked “Servo”') && t.includes('receipt added'), t);
  assert.equal(expenseChanges(x, { ...x }, N), '', 'no change, no history line');
  assert.ok(expenseChanges(null, cleanExpense({ kind: 'income', amount: 500, description: 'Grant' }), N).startsWith('Added income £500.00'));
  const p = cleanPart({ name: 'Fuselage', qty: 1, unitCost: 12.99, status: 'needed' }, 'p1');
  assert.equal(partChanges(null, p, N), 'Added part “Fuselage” (£12.99) — needed');
  assert.equal(partChanges(p, { ...p, status: 'ordered', unitCost: 11 }, N), 'Part “Fuselage”: needed → ordered; cost each £12.99 → £11.00');
  assert.equal(partChanges(p, { ...p, notes: 'blue' }, N), '', 'notes are not money');
  assert.equal(partChanges(p, null, N), 'Deleted part “Fuselage” (£12.99)');
  assert.ok(cleanLogEntry({ text: 'x'.repeat(900), kind: 'nope' }).text.length === 600 && cleanLogEntry({ kind: 'nope' }).kind === 'budget');
});

test('deleting a budget line moves its spending and parts', () => {
  const b = cleanBudget({ currency: 'GBP', lines: [{ id: 'b1', name: 'Parts', amount: 100 }, { id: 'b2', name: 'Travel', amount: 50 }] });
  const ex = [cleanExpense({ kind: 'expense', amount: 10, budgetId: 'b1' }, 'e1'), cleanExpense({ kind: 'expense', amount: 5.5, budgetId: 'b1' }, 'e2'), cleanExpense({ kind: 'expense', amount: 3, budgetId: 'b2' }, 'e3')];
  const parts = [cleanPart({ name: 'Servo', budgetId: 'b1' }, 'p1'), cleanPart({ name: 'Bolt' }, 'p2')];
  let plan = removeLinePlan(b, 'b1', 'b2', ex, parts, N);
  assert.deepEqual(plan.budget.lines.map(l => l.id), ['b2']); assert.equal(plan.index, 0);
  assert.deepEqual(plan.moves, [{ path: 'expenses/e1', from: 'b1', to: 'b2' }, { path: 'expenses/e2', from: 'b1', to: 'b2' }, { path: 'parts/p1', from: 'b1', to: 'b2' }]);
  assert.equal(plan.text, 'Deleted budget line “Parts” (budget £100.00); moved 2 spending entries (£15.50) and 1 part to “Travel”');
  plan = removeLinePlan(b, 'b1', 'b1', ex, parts, N);
  assert.equal(plan.to, '', 'a line can’t be moved into itself — falls back to Not assigned');
  assert.equal(removeLinePlan(b, 'b2', '', [], [], N).text, 'Deleted budget line “Travel” (budget £50.00)');
  assert.equal(removeLinePlan(b, 'zz', '', ex, parts, N), null);
});

test('rules (read): finance history only for finance roles', () => {
  const st = fixture();
  assert.throws(() => checkRead(st, users.mem1, TEAM, 'financeLog'));
  assert.doesNotThrow(() => checkRead(st, users.admin1, TEAM, 'financeLog'));
  assert.doesNotThrow(() => checkRead(st, users.owner, TEAM, 'financeLog'));
});

test('plans: what is in force, expiry, Pro features and member room', () => {
  assert.equal(planOf({}).tier, 'free'); assert.equal(planOf({}).members, 30); assert.equal(planOf({}).ownTeams, 0); assert.equal(planOf({}).label, 'Free');
  assert.equal(cleanPlan({ tier: 'gold' }).tier, 'free');
  const pro = { plan: { tier: 'pro', edu: true, until: Date.parse('2027-09-01') } };
  assert.equal(planOf(pro, Date.parse('2027-01-01')).label, 'Pro Education'); assert.equal(planOf(pro, Date.parse('2027-01-01')).members, 100);
  const later = planOf(pro, Date.parse('2027-10-01')); assert.equal(later.tier, 'free'); assert.ok(later.expired, 'past its end date the team is back on Free');
  assert.ok(hasPro(pro, 'approvals', Date.parse('2027-01-01')) && !hasPro(pro, 'sso', Date.parse('2027-01-01')), 'Pro has Pro features, not Organisation ones');
  assert.ok(hasPro({ plan: { tier: 'org' } }, 'sso') && !hasPro({}, 'history'));
  assert.deepEqual(memberRoom({}, 28, 1), { limit: 30, used: 29, left: 1, full: false });
  assert.ok(memberRoom({}, 29, 1).full); assert.equal(memberRoom({ plan: { tier: 'pro' } }, 29, 1).left, 70);
});

test('rules (read): a platform admin sees teams and requests, not their work', () => {
  const st = fixture();
  assert.doesNotThrow(() => checkRead(st, users.plat, TEAM)); assert.doesNotThrow(() => checkRead(st, users.plat, TEAM, 'requests'));
  assert.throws(() => checkRead(st, users.plat, TEAM, 'tasks')); assert.throws(() => checkRead(st, users.evil, TEAM, 'requests'));
});

test('university emails that get free Pro Education', () => {
  ['a@bristol.ac.uk', 'B@MIT.EDU', 'c@unsw.edu.au', 'd@iitb.ac.in', 'e@student.ethz.ch', 'f@epfl.ch'].forEach(e => assert.ok(isAcademicEmail(e), e));
  ['a@gmail.com', 'b@ac.uk.evil.com', 'c@education.com', 'd@edu', ''].forEach(e => assert.ok(!isAcademicEmail(e), e));
});

import { scrub, errorDoc, ignorable } from '../src/monitor.js';
test('error reports carry no personal data', () => {
  assert.equal(scrub('Failed for aisha@uni.ac.uk at https://x.app/#/t/abc?token=123 id 12345678', 200), 'Failed for <email> at https://x.app/ id <n>');
  const d = errorDoc('error', { message: 'x'.repeat(500), stack: 'at f (https://app/x.js?v=1:1:2)' });
  assert.equal(d.msg.length, 300); assert.ok(!d.stack.includes('?v=1') && d.kind === 'error' && typeof d.at === 'number');
  assert.ok(ignorable('ResizeObserver loop limit exceeded') && ignorable('boom', 'at chrome-extension://abc/x.js') && !ignorable('TypeError: x is undefined', 'at board.js'));
});
test('rules: error reports and email choices', () => {
  const st = fixture();
  const rep = (who, data) => { const op = { type: 'set', path: '/clientErrors/e1', data }; const post = applyOps(st, TEAM, [op]); checkWrite(st, post, users[who], TEAM, op); };
  const good = { kind: 'error', msg: 'boom', stack: '', where: '#/t', ua: 'x', build: 'b', at: 1, uid: 'mem1', expireAt: 1 };
  assert.doesNotThrow(() => rep('mem1', good));
  assert.throws(() => rep('mem1', { ...good, uid: 'owner' }), /error report/, 'only in your own name');
  assert.throws(() => rep('mem1', { ...good, taskText: 'secret' }), /error report/, 'no extra fields');
  assert.doesNotThrow(() => checkProfileWrite(users.mem1, 'mem1', { notify: { mentions: false, digest: true }, updatedAt: 1 }));
  assert.throws(() => checkProfileWrite(users.mem1, 'owner', { notify: { mentions: false }, updatedAt: 1 }));
});

test('changing a week start date moves every later week to follow on', async () => {
  const { cascadeWeekDates } = await import('../src/model.js');
  const weeks = [{ title: 'WEEK 1', startDate: '2026-08-11' }, { title: 'WEEK 2', startDate: '2026-10-26' }, { title: 'Exam break', startDate: '' }, { title: 'WEEK 4', startDate: '2027-01-04' }];
  const a = cascadeWeekDates(weeks, 0, '2026-10-19');
  assert.deepEqual(a.map(w => w.startDate), ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
  assert.deepEqual(a.map(w => w.title), ['WEEK 1', 'WEEK 2', 'Exam break', 'WEEK 4'], 'own numbering keeps titles');
  const b = cascadeWeekDates(weeks, 1, '2026-12-28');
  assert.equal(b[0].startDate, '2026-08-11', 'earlier weeks untouched');
  assert.deepEqual(b.slice(1).map(w => w.startDate), ['2026-12-28', '2027-01-04', '2027-01-11'], 'crosses the year end');
  const c = cascadeWeekDates(weeks, 0, '2026-10-19', 'calendar');
  assert.deepEqual(c.map(w => w.title), ['WEEK 43', 'WEEK 44', 'Exam break', 'WEEK 46'], 'calendar naming renames numbered weeks, keeps custom names');
  assert.equal(weeks[0].startDate, '2026-08-11', 'input not changed');
  assert.deepEqual(cascadeWeekDates(weeks, 0, 'nope').map(w => w.startDate), weeks.map(w => w.startDate), 'bad date ignored');
});

test('carried-forward copies share their links (carryIndex)', async () => {
  const { carryIndex, uniqueChains } = await import('../src/model.js');
  const weeks = [{ key: 'w1' }, { key: 'w2' }, { key: 'w3' }];
  const tasks = [
    { id: 'a', name: 'Read paper', categoryId: 'c', weekId: 'w1', carryOf: '' },
    { id: 'b', name: 'Read paper', categoryId: 'c', weekId: 'w2', carryOf: 'a' },
    { id: 'c3', name: 'Read paper', categoryId: 'c', weekId: 'w3', carryOf: 'a' },
    { id: 'x', name: 'Other', categoryId: 'c', weekId: 'w2', carryOf: '' },
  ];
  const ix = carryIndex(tasks, weeks);
  assert.deepEqual(ix.ids('c3'), ['a', 'b', 'c3']);
  assert.equal(ix.latest('a').id, 'c3', 'links to the first copy resolve to the latest');
  assert.ok(ix.same('a', 'b') && !ix.same('a', 'x'));
  assert.deepEqual(ix.ids('x'), ['x']); assert.deepEqual(ix.ids('gone'), ['gone']);
  assert.deepEqual(uniqueChains(['a', 'x', 'c3', 'b'], ix), ['a', 'x'], 'one chip per piece of work');
  // the first copy was deleted: later copies still find each other and old links still resolve
  const ix2 = carryIndex(tasks.slice(1), weeks);
  assert.equal(ix2.latest('a').id, 'c3', 'a link to the deleted first copy still finds the latest');
});

test('restore plan: writes changed/new docs, deletes extras, keeps the rest', async () => {
  const { planRestore, fromJSON } = await import('../tools/ops/restore-team.mjs');
  const live = { 'teams/T': { name: 'A' }, 'teams/T/tasks/a': { n: 1 }, 'teams/T/tasks/x': { n: 9 }, 'teams/T/members/u': { r: 'owner' } };
  const backup = { 'teams/T': { name: 'A' }, 'teams/T/tasks/a': { n: 2 }, 'teams/T/tasks/b': { n: 3 }, 'teams/T/members/u': { r: 'owner' } };
  const p = planRestore(live, backup);
  assert.deepEqual(p.write.sort(), ['teams/T/tasks/a', 'teams/T/tasks/b']);
  assert.deepEqual(p.del, ['teams/T/tasks/x']);
  assert.equal(p.unchanged, 2);
  assert.deepEqual(p.summary, { write: { tasks: 2 }, delete: { tasks: 1 } });
  const T = { fromMillis: (m) => ({ ms: m }) };
  assert.deepEqual(fromJSON({ a: { __ts: 5 }, b: [{ __ts: 6 }], c: { __ts: 1, x: 2 } }, T), { a: { ms: 5 }, b: [{ ms: 6 }], c: { __ts: 1, x: 2 } });
});

// ── Saves at the same moment: merge3 ───────────────────────────────────────
import { merge3, deepEqual } from '../src/sync.js';
const sts = (...xs) => xs.map(([id, done, title]) => ({ id, title: title || id, completed: !!done }));
test('merge3: different sub-tasks ticked by two people are both kept', () => {
  assert.deepEqual(merge3(sts(['a'], ['b']), sts(['a', 1], ['b']), sts(['a'], ['b', 1])), sts(['a', 1], ['b', 1]));
});
test('merge3: both add items; mine goes after the item it followed', () => {
  const r = merge3(sts(['a'], ['b']), sts(['a'], ['x'], ['b']), sts(['a'], ['b'], ['y']));
  assert.deepEqual(r.map(x => x.id), ['a', 'x', 'b', 'y']);
});
test('merge3: my delete and their edit of another item', () => {
  assert.deepEqual(merge3(sts(['a'], ['b']), sts(['b']), sts(['a'], ['b', 1])), sts(['b', 1]));
});
test('merge3: they deleted an item I edited → it stays deleted', () => {
  assert.deepEqual(merge3(sts(['a'], ['b']), sts(['a', 1], ['b']), sts(['b'])), sts(['b']));
});
test('merge3: same value changed by both → the saved one (theirs) wins, so browsers agree', () => {
  assert.equal(merge3('a', 'b', 'c'), 'c');
  assert.deepEqual(merge3(sts(['a']), sts(['a', 0, 'A1']), sts(['a', 0, 'A2'])), sts(['a', 0, 'A2']));
});
test('merge3: my reorder is kept, their new item stays where they put it', () => {
  const r = merge3(sts(['a'], ['b'], ['c']), sts(['c'], ['a'], ['b']), sts(['a'], ['b'], ['n'], ['c']));
  assert.deepEqual(r.map(x => x.id), ['c', 'a', 'b', 'n']);
});
test('merge3: lists of ids and plain objects (dependsOn, custom fields)', () => {
  assert.deepEqual(merge3(['t1'], ['t1', 't2'], ['t1', 't3']), ['t1', 't2', 't3']);
  assert.deepEqual(merge3({ f1: 'a', f2: 'b' }, { f1: 'A', f2: 'b' }, { f1: 'a', f2: 'B' }), { f1: 'A', f2: 'B' });
});
test('merge3: weeks added by two admins (items keyed by "key")', () => {
  const w = (...ks) => ks.map(key => ({ key, title: key }));
  assert.deepEqual(merge3(w('w1'), w('w1', 'wA'), w('w1', 'wB')).map(x => x.key), ['w1', 'wA', 'wB']);
});
test('merge3: merging again gives the same answer (no ping-pong between browsers)', () => {
  const base = sts(['a'], ['b']), mine = sts(['a', 1], ['b']), theirs = sts(['a'], ['b', 1]);
  const m = merge3(base, mine, theirs);
  assert.ok(deepEqual(merge3(theirs, m, m), m) && deepEqual(merge3(base, theirs, m), m));
});
test('deepEqual ignores object key order', () => {
  assert.ok(deepEqual({ a: 1, b: [{ x: 1, y: 2 }] }, { b: [{ y: 2, x: 1 }], a: 1 }));
  assert.ok(!deepEqual([1, 2], [2, 1]));
});

// ── Old weeks from this device's copy (backend/tasksync.js) ─────────────────
import { splitWeeks, touchesArchive, watchTasks } from '../src/backend/tasksync.js';
const NOW = Date.parse('2026-10-20T12:00:00Z');
const wk = (key, start) => ({ key, title: key, startDate: start });
const WEEKS = [wk('w1', '2026-08-03'), wk('w2', '2026-09-07'), wk('w3', '2026-09-14'), wk('w4', '2026-10-12'), wk('w5', '2026-10-19'), wk('w6', '2026-11-30'), { key: 'w7', title: 'Undated' }];
test('tasksync: weeks that ended more than 5 weeks ago are archived; undated and future ones live', () => {
  assert.deepEqual(splitWeeks(WEEKS, NOW), { archived: ['w1', 'w2'], live: ['w3', 'w4', 'w5', 'w6', 'w7'] });
});
test('tasksync: writers count a week as archived a week earlier than readers', () => {
  assert.ok(touchesArchive(WEEKS, ['w3'], NOW), 'w3 ended 4.5 weeks ago: a save there tells others');
  assert.ok(!touchesArchive(WEEKS, ['w4', undefined], NOW));
  assert.ok(touchesArchive(WEEKS, ['w4', 'w1'], NOW), 'moving a task out of an old week');
});

/** A pretend Firestore: tasks on the "server", what this device has saved, and how many reads it cost. */
function fakeFs(serverTasks, cachedIds = null) {
  const f = { reads: 0, listeners: [], cache: new Map() };
  const match = (q, t) => !q.weekIds || q.weekIds.includes(t.weekId);
  const snap = (list) => ({ docs: list.map(t => ({ id: t.id, data: () => { const { id, ...d } = t; return d; } })) });
  (cachedIds ? serverTasks.filter(t => cachedIds.includes(t.id)) : []).forEach(t => f.cache.set(t.id, t));
  f.fs = {
    tasksQuery: (weekIds) => ({ weekIds }),
    onSnapshot: (q, cb) => { const res = serverTasks.filter(t => match(q, t)); f.reads += res.length; res.forEach(t => f.cache.set(t.id, t)); const l = { q, cb }; f.listeners.push(l); cb(snap(res)); return () => { f.listeners = f.listeners.filter(x => x !== l); }; },
    getDocs: async (q) => { const res = serverTasks.filter(t => match(q, t)); f.reads += res.length; res.forEach(t => f.cache.set(t.id, t)); return snap(res); },
    getDocsFromCache: async (q) => snap([...f.cache.values()].filter(t => match(q, t))),
  };
  return f;
}
const memStore = () => { let v = null; return { get: () => v, set: (x) => { v = JSON.parse(JSON.stringify(x)); } }; };
const tasksIn = (weeks, n) => weeks.flatMap(w => Array.from({ length: n }, (_, i) => ({ id: w + '_' + i, weekId: w, name: 'T' + i })));
async function open(f, store, team) { let got = []; const w = watchTasks(f.fs, store, (ts) => { got = ts; }, (e) => { throw e; }); w.setTeam(team); await w.ready; return { w, all: () => got }; }

test('tasksync: first open reads everything; the next open reads only recent weeks', async () => {
  const realNow = Date.now; Date.now = () => NOW;
  try {
    const server = tasksIn(['w1', 'w2', 'w3', 'w4', 'w5'], 10); const store = memStore(); const team = { weeks: WEEKS, archiveRev: 0 };
    const f1 = fakeFs(server); const a = await open(f1, store, team);
    assert.equal(a.all().length, 50); assert.equal(f1.reads, 50, 'first time on this device: all 50 tasks');
    a.w.stop();
    const f2 = fakeFs(server, server.map(t => t.id)); const b = await open(f2, store, team);
    assert.equal(b.all().length, 50, 'still every task on the board');
    assert.equal(f2.reads, 30, 'only the 3 recent weeks are read (20 old tasks come from the device)');
  } finally { Date.now = realNow; }
});
test('tasksync: someone changed an old week → it is read again; a device copy missing tasks is noticed', async () => {
  const realNow = Date.now; Date.now = () => NOW;
  try {
    const server = tasksIn(['w1', 'w2', 'w3'], 10); const store = memStore();
    await open(fakeFs(server), store, { weeks: WEEKS, archiveRev: 0 });
    const f2 = fakeFs(server, server.map(t => t.id)); await open(f2, store, { weeks: WEEKS, archiveRev: 1729400000000 });
    assert.equal(f2.reads, 30, 'archiveRev changed: old weeks read again (20) plus live (10)');
    const partial = server.filter(t => t.id !== 'w1_3').map(t => t.id);   // the browser threw one away
    const f3 = fakeFs(server, partial); const c = await open(f3, store, { weeks: WEEKS, archiveRev: 1729400000000 });
    assert.equal(c.all().length, 30, 'nothing missing on the board');
    assert.equal(f3.reads, 20, 'only week 1 (incomplete copy) is re-read, plus live');
  } finally { Date.now = realNow; }
});
test('tasksync: a week becoming old is read once; too many live weeks → listen to everything', async () => {
  const realNow = Date.now; Date.now = () => NOW;
  try {
    const server = tasksIn(['w1', 'w2', 'w3'], 5); const store = memStore();
    await open(fakeFs(server), store, { weeks: WEEKS, archiveRev: 0 });
    Date.now = () => NOW + 7 * 864e5;   // a week later w3 is archived too
    const f2 = fakeFs(server, server.map(t => t.id)); const b = await open(f2, store, { weeks: WEEKS, archiveRev: 0 });
    assert.equal(b.all().length, 15); assert.equal(f2.reads, 5, 'w3 (newly old) read once from the server; w1, w2 from the device');
    const many = Array.from({ length: 40 }, (_, i) => wk('x' + i, '2027-0' + (1 + (i % 9)) + '-0' + (1 + (i % 9))));
    const f3 = fakeFs(server); await open(f3, memStore(), { weeks: many });
    assert.equal(f3.listeners[0].q.weekIds, null, 'over 30 live weeks: one listener for all tasks');
  } finally { Date.now = realNow; }
});

// ── Share this week (src/share.js) ──────────────────────────────────────────
import { buildWeekShare, shareWeek, whatsappLink, MAX_ITEMS } from '../src/share.js';
const SW = [{ key: 'w1', title: 'WEEK 1', startDate: '2026-10-12' }, { key: 'w2', title: 'WEEK 2', startDate: '2026-10-19' }];
const row = (task, over = {}) => ({ task, person: 'Tom Reed', personId: 'u1', flag: 'none', stage: 'To do', completedOn: '', deadline: '', daysToDeadline: null, overdue: false, waitsOn: [], waitIssues: [], carryCount: 1, subtasks: [], ...over });
test('share: the team week containing today, else the last 7 days', () => {
  assert.equal(shareWeek(SW, '2026-10-21').label, 'WEEK 2 (19–25 Oct)');
  assert.equal(shareWeek(SW, '2026-12-01').label, 'Last 7 days (25 Nov – 1 Dec)');
});
test('share: done, in progress, due, overdue, waiting and carried, WhatsApp-formatted', () => {
  const rows = [
    row('Landing gear CAD', { flag: 'completed', completedOn: '2026-10-20' }),
    row('Old thing', { flag: 'completed', completedOn: '2026-10-01' }),
    row('Payload mount', { stage: 'Doing', subtasks: [{ done: true }, { done: false }] }),
    row('Order ESCs', { deadline: '2026-10-23', daysToDeadline: 2 }),
    row('Wiring loom', { deadline: '2026-10-18', daysToDeadline: -3, overdue: true, stage: 'Doing' }),
    row('Flight test', { waitsOn: ['Wiring loom'], waitIssues: ['Wiring loom is late'], carryCount: 2 }),
  ];
  const t = buildWeekShare({ team: { name: 'Drone Soc', weeks: SW }, rows, today: '2026-10-21', url: 'https://x.app/#/t/T' });
  assert.ok(t.startsWith('*Drone Soc · WEEK 2 (19–25 Oct)*'));
  assert.ok(t.includes('✅ *Done* (1)\n• Landing gear CAD — Tom Reed') && !t.includes('Old thing'), 'only this week’s completions');
  assert.ok(t.includes('• Payload mount — Tom Reed (1/2 steps)'));
  assert.ok(t.includes('• Order ESCs — Tom Reed (23 Oct)'));
  assert.ok(t.includes('⚠️ *Overdue* (1)\n• Wiring loom — Tom Reed (3 days late)') && !t.match(/In progress[^]*Wiring loom[^]*Due/), 'overdue shown once, not also as in progress');
  assert.ok(t.includes('(waits on Wiring loom)') && t.includes('↪ 1 task carried over'));
  assert.ok(t.includes('📈 2 of 6 tasks done (33%)') && t.includes('👉 https://x.app/#/t/T'));
  assert.ok(t.endsWith('_Made with Trawpie · free for student teams · https://trawpie.org_'), 'ends with a small credit');
  assert.ok(!buildWeekShare({ team: { name: 'D', weeks: SW }, rows, today: '2026-10-21' }, { names: false }).includes('Tom Reed'), 'names can be left out');
});
test('share: long lists are cut; a quiet week says so; the WhatsApp link carries the text', () => {
  const many = Array.from({ length: MAX_ITEMS + 3 }, (_, i) => row('T' + i, { flag: 'completed', completedOn: '2026-10-20' }));
  assert.ok(buildWeekShare({ team: { name: 'D', weeks: SW }, rows: many, today: '2026-10-21' }).includes('…and 3 more'));
  assert.ok(buildWeekShare({ team: { name: 'D', weeks: SW }, rows: [row('Idle')], today: '2026-10-21' }).includes('A quiet week'));
  assert.equal(whatsappLink('a & b'), 'https://wa.me/?text=a%20%26%20b');
});

// ── Workflow: a team's own stages ───────────────────────────────────────────
import { cleanWorkflow, workflowStages, stageIdOf, stageKindOf, WORKFLOW_TEMPLATES, DEFAULT_STAGES } from '../src/model.js';
const ENG = WORKFLOW_TEMPLATES.find(t => t.id === 'engineering').stages;
test('workflow: cleaned; the last stage is always Done; 2–10 stages', () => {
  const w = cleanWorkflow({ stages: [{ id: 'a', name: '  Design  ', kind: 'done', color: 'red', limit: 500 }, { id: 'a', name: 'dup' }, { id: 'bad id!', name: 'B', kind: 'doing', limit: 4 }, { id: 'z', name: 'Z', kind: 'todo', limit: 3 }] });
  assert.deepEqual(w.stages.map(s => [s.id, s.name, s.kind, s.limit]), [['a', 'Design', 'todo', 0], ['s2', 'B', 'doing', 4], ['z', 'Z', 'done', 0]]);
  assert.ok(w.stages.every(s => s.color.startsWith('#')));
  assert.equal(cleanWorkflow({ stages: [{ id: 'only' }] }), null, 'one stage is not a workflow');
  assert.equal(cleanWorkflow({ stages: Array.from({ length: 15 }, (_, i) => ({ id: 's' + i })) }).stages.length, 10);
  assert.equal(workflowStages({}), DEFAULT_STAGES); assert.equal(workflowStages({ workflow: { stages: ENG } }).length, 5);
});
test('workflow: which stage a task is in; old tasks map onto the new stages', () => {
  assert.equal(stageIdOf({ flag: 'completed', stage: 'review' }, ENG), 'done', 'completed = the last stage');
  assert.equal(stageIdOf({ flag: 'none', stage: 'build' }, ENG), 'build');
  assert.equal(stageIdOf({ flag: 'none', stage: 'doing' }, ENG), 'review', 'classic Doing → the first Doing-kind stage');
  assert.equal(stageIdOf({ flag: 'none', stage: '' }, ENG), 'design', 'nothing set → the first To do stage');
  assert.equal(stageIdOf({ flag: 'none', stage: 'gone' }, ENG), 'design', 'a deleted stage falls back');
  assert.equal(stageIdOf({ flag: 'none', stage: 'done' }, ENG), 'design', 'never Done without being completed');
  assert.equal(stageKindOf({ flag: 'none', stage: 'test' }, ENG), 'doing', 'analytics still see Doing');
  assert.equal(stageIdOf({ flag: 'none', stage: 'doing' }), 'doing', 'no workflow: classic behaviour');
});

test('currency: the team’s own, else the budget’s, else pounds; a first guess from the browser', async () => {
  const { currencyOf, guessCurrency, formatMoney } = await import('../src/model.js');
  assert.equal(currencyOf({ currency: 'INR' }, { currency: 'GBP' }), 'INR');
  assert.equal(currencyOf({}, { currency: 'EUR' }), 'EUR', 'older teams keep their budget’s currency');
  assert.equal(currencyOf({}, null), 'GBP');
  assert.equal(guessCurrency('en-GB'), 'GBP'); assert.equal(guessCurrency('de-DE'), 'EUR'); assert.equal(guessCurrency('hi-IN'), 'INR'); assert.equal(guessCurrency('de-CH'), 'CHF'); assert.equal(guessCurrency('en'), 'GBP');
  assert.ok(formatMoney(12.5, 'EUR', 'en-GB').includes('€'));
});

test('Pro Education stays with the student owner; deleting old tasks and leaving need approval', async () => {
  const { planOf } = await import('../src/model.js');
  const { deleteNeedsApproval } = await import('../src/permissions.js');
  const { proActive } = await import('../functions/lib.js');
  const plan = { tier: 'pro', edu: true, until: Date.now() + 864e5, by: 'stu' };
  assert.equal(planOf({ ownerUid: 'stu', plan }).tier, 'pro');
  assert.equal(planOf({ ownerUid: 'boss', plan }).tier, 'free', 'handed to someone else: back to Free');
  assert.equal(planOf({ ownerUid: 'boss', plan: { ...plan, edu: false } }).tier, 'pro', 'a paid plan stays');
  assert.equal(proActive(plan, Date.now(), 'boss'), false); assert.equal(proActive(plan, Date.now(), 'stu'), true);
  const team = { roles: DEFAULT_ROLES };
  const mem = { uid: 'm', roleId: 'member' }, adm = { uid: 'a', roleId: 'admin' };
  assert.equal(deleteNeedsApproval(team, mem, { createdBy: 'm', createdAt: Date.now() - 1000 }), false, 'my own, made just now');
  assert.equal(deleteNeedsApproval(team, mem, { createdBy: 'm', createdAt: Date.now() - 2 * 864e5 }), true, 'older: ask');
  assert.equal(deleteNeedsApproval(team, mem, { createdBy: 'x', createdAt: Date.now() - 1000 }), true, 'someone else’s: ask');
  assert.equal(deleteNeedsApproval(team, adm, { createdBy: 'x', createdAt: 1 }), false, 'admins delete');
  assert.equal(deleteNeedsApproval(team, mem, { name: 'unsaved' }), false, 'not saved yet');
});

test('importer reads other apps’ exports (Asana, Planner, ClickUp column names)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/importer.js', import.meta.url), 'utf8');
  for (const name of ['section/column', 'bucket name', 'assignee email', 'completed at', 'due on']) assert.ok(src.includes("'" + name + "'"), name);
});

test('translator: icons, numbers, pieces and things people typed', async () => {
  const { translateText } = await import('../src/i18n-core.js');
  const d = { 'Add task': 'Añadir tarea', '{n} comments': '{n} comentarios', 'Due today': 'Vence hoy', 'Priority: Minor': 'Prioridad: Menor', 'COMPLETED': 'COMPLETADA' };
  assert.equal(translateText('＋ Add task', d), '＋ Añadir tarea');
  assert.equal(translateText('💬 12 comments', d), '💬 12 comentarios');
  assert.equal(translateText('Due today · 12 comments', d), 'Vence hoy · 12 comentarios');
  assert.equal(translateText('︾ Priority: Minor', d), '︾ Prioridad: Menor');
  assert.equal(translateText('COMPLETED ✓', d), 'COMPLETADA ✓');
  assert.equal(translateText('add task', d), 'añadir tarea', 'lower-case start follows');
  assert.equal(translateText('Weld the frame', d), null, 'unknown text (what people typed) is left alone');
  for (const f of ['t1', 't2', 't3', 't4', 't5']) {
    const m = (await import('../src/i18n/' + f + '.js')).default;
    for (const [k, v] of Object.entries(m)) {
      assert.equal(v.length, 4, f + ': four languages for ' + k);
      const n = (k.match(/\{n\}/g) || []).length;
      v.forEach((t, i) => assert.equal((t.match(/\{n\}/g) || []).length, n, f + ' [' + i + '] keeps every number in “' + k + '”'));
    }
  }
});

test('a new team can start Simple, as a Research team or with Everything', async () => {
  const { startFeatures, FEATURE_KEYS, NEW_TEAM_FEATURES, TEAM_STARTS } = await import('../src/model.js');
  assert.ok(FEATURE_KEYS.every(k => startFeatures('simple')[k] === false), 'simple: all off');
  assert.ok(FEATURE_KEYS.every(k => startFeatures('full')[k] === (k !== 'dissertation')), 'everything: all on (the dissertation workspace is its own start)');
  assert.deepEqual(Object.keys(startFeatures('dissertation')).filter(k => startFeatures('dissertation')[k]).sort(), ['dissertation', 'literature', 'meetings', 'notebook', 'planning'], 'dissertation: planning, meetings, notebook, literature and the Dissertation tab');
  assert.deepEqual(startFeatures('standard'), NEW_TEAM_FEATURES);
  assert.deepEqual(startFeatures('nonsense'), NEW_TEAM_FEATURES, 'unknown choice falls back to the usual set');
  assert.deepEqual(TEAM_STARTS.map(s => s.key), ['simple', 'standard', 'full', 'dissertation']);
});

// ── Security: input sanitizers (XSS defences) ───────────────────────────────
import { cleanWbItem, cleanWbPath } from '../src/model.js';
import { safeUrl } from '../src/ui.js';

test('security: a whiteboard pen path keeps only coordinate characters', () => {
  const evil = '0,0"><image href=x onerror=alert(1)>';
  assert.equal(cleanWbPath(evil), '', 'a markup payload is dropped, not stored');
  assert.match(cleanWbPath('12,34 56,78'), /^[0-9 .,-]*$/, 'real coordinates survive');
  const item = cleanWbItem({ kind: 'pen', path: evil, x: 0, y: 0, w: 100, h: 80 }, 'i1');
  assert.ok(!/[<>"]/.test(item.path), 'cleanWbItem never stores markup in a path');
});

test('security: safeUrl allows only web and mail links', () => {
  assert.equal(safeUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(safeUrl('http://example.com'), 'http://example.com');
  assert.equal(safeUrl('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(safeUrl('javascript:alert(1)'), '', 'javascript: is refused');
  assert.equal(safeUrl('data:text/html,<script>'), '', 'data: is refused');
  assert.equal(safeUrl(' JavaScript:alert(1)'), '', 'case and whitespace tricks are refused');
  assert.equal(safeUrl(undefined), '');
});

test('backlog: no dates, no number, skipped when weeks are renumbered or re-dated', async () => {
  const { cascadeWeekDates, nextWeekTitle, renumberWeeks, isBacklogWeek } = await import('../src/model.js');
  const weeks = [{ key: 'backlog', title: 'Backlog', startDate: '' }, { key: 'a', title: 'WEEK 1', startDate: '' }, { key: 'b', title: 'WEEK 2', startDate: '' }];
  assert.equal(isBacklogWeek(weeks[0]), true); assert.equal(isBacklogWeek(weeks[1]), false);
  const d = cascadeWeekDates(weeks, 1, '2026-10-19');
  assert.deepEqual(d.map(w => w.startDate), ['', '2026-10-19', '2026-10-26']);
  assert.deepEqual(cascadeWeekDates(weeks, 0, '2026-10-19').map(w => w.startDate), ['', '', ''], 'dating the backlog does nothing');
  assert.deepEqual(renumberWeeks('sequence', weeks).map(w => w.title), ['Backlog', 'WEEK 1', 'WEEK 2']);
  assert.equal(nextWeekTitle('sequence', [{ key: 'backlog', title: 'Backlog' }]), 'WEEK 1');
});

test('file health: reading links and judging Drive / OneDrive answers', async () => {
  const { driveFileId, graphShareId, checkableBy, judgeDrive, judgeGraph } = await import('../src/filehealth.js');
  assert.equal(driveFileId('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit'), '1AbCdEfGhIjKlMnOp');
  assert.equal(driveFileId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp'), '1AbCdEfGhIjKlMnOp');
  assert.equal(driveFileId('https://evil.example/file/d/1AbCdEfGhIjKlMnOp'), '', 'only Google hosts');
  assert.equal(graphShareId('https://1drv.ms/w/s!abc'), 'u!aHR0cHM6Ly8xZHJ2Lm1zL3cvcyFhYmM');
  assert.equal(checkableBy({ provider: 'link', url: 'https://example.com/x' }), '', 'plain links are not checked');
  assert.equal(checkableBy({ provider: 'link', url: 'https://contoso.sharepoint.com/:w:/r/x' }), 'onedrive');
  assert.equal(checkableBy({ provider: 'gdrive', url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view' }), 'gdrive');
  assert.equal(judgeDrive(200, { trashed: true }).state, 'broken');
  assert.equal(judgeDrive(200, { owners: [{ displayName: 'Priya' }] }).state, 'personal');
  assert.equal(judgeDrive(200, { driveId: 'shared', owners: [] }).state, 'ok');
  assert.equal(judgeDrive(404, null, { mine: true }).state, 'broken');
  assert.equal(judgeDrive(404, null, { mine: false }).state, 'unknown', 'someone else’s Google file can’t be judged with drive.file');
  assert.equal(judgeGraph(404, null).state, 'broken');
  assert.equal(judgeGraph(403, null).state, 'broken');
  assert.equal(judgeGraph(200, { parentReference: { driveType: 'business' }, createdBy: { user: { displayName: 'Leo' } } }).state, 'personal');
  assert.equal(judgeGraph(200, { parentReference: { driveType: 'documentLibrary' } }).state, 'ok');
  assert.equal(judgeGraph(500, null).state, 'unknown');
});

test('share links: OneDrive / SharePoint / Google Drive recognised and named', async () => {
  const { linkInfo, checkableBy } = await import('../src/filehealth.js');
  const r = (u) => linkInfo(u);
  assert.deepEqual(r('https://uob-my.sharepoint.com/:w:/r/personal/ab_bristol_ac_uk/Documents/Team/Test%20report%20v2.docx?d=w1&csf=1&web=1'), { provider: 'onedrive', name: 'Test report v2.docx' });
  assert.deepEqual(r('https://uob-my.sharepoint.com/:x:/g/personal/ab_bristol_ac_uk/EaBcDeF?e=xyz'), { provider: 'onedrive', name: 'Excel workbook' });
  assert.deepEqual(r('https://1drv.ms/b/s!AbCdEf'), { provider: 'onedrive', name: 'PDF' });
  assert.deepEqual(r('https://uob.sharepoint.com/:f:/r/sites/Drone/Shared%20Documents/CAD?csf=1'), { provider: 'onedrive', name: 'CAD' });
  assert.equal(r('https://uob.sharepoint.com/sites/Drone/_layouts/15/Doc.aspx?sourcedoc=%7Babc%7D&file=Budget.xlsx&action=default').name, 'Budget.xlsx');
  assert.equal(r('https://uob-my.sharepoint.com/personal/ab/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fab%2FDocuments%2FWing%20CAD.step').name, 'Wing CAD.step');
  assert.equal(r('https://uob.sharepoint.com/sites/Drone/Shared%20Documents/Plan.pdf').name, 'Plan.pdf');
  assert.deepEqual(r('https://onedrive.live.com/?cid=ABC&id=ABC%21123'), { provider: 'onedrive', name: '' });
  assert.deepEqual(r('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit'), { provider: 'gdrive', name: 'Google Sheet' });
  assert.deepEqual(r('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp'), { provider: 'gdrive', name: 'Drive folder' });
  assert.deepEqual(r('https://example.com/a.pdf'), { provider: '', name: '' });
  assert.deepEqual(r('not a link'), { provider: '', name: '' });
  assert.equal(checkableBy({ provider: 'onedrive', url: 'https://1drv.ms/b/s!AbCdEf' }), 'onedrive', 'pasted OneDrive links can be health-checked');
});

test('friendly errors: our own messages and Microsoft approval blocks', async () => {
  const { friendlyError } = await import('../src/ui.js');
  const e = new Error('Custom text'); e.code = 'tt/link-microsoft';
  assert.equal(friendlyError(e), 'Custom text');
  assert.match(friendlyError(new Error('AADSTS65001: The user or administrator has not consented')), /hasn’t approved Trawpie/);
  assert.match(friendlyError(Object.assign(new Error('x'), { errorCode: 'consent_required' })), /share link/);
});

test('friendly errors: Microsoft AADSTS codes explain the setup problem', async () => {
  const { friendlyError } = await import('../src/ui.js');
  const fb = (m) => Object.assign(new Error(m), { code: 'auth/invalid-credential' });
  const secret = friendlyError(fb('Firebase: Error getting access token from microsoft.com, OAuth2 redirect uri is: https://uni-teamtrack.firebaseapp.com/__/auth/handler, response: OAuth2TokenResponse{params: error=invalid_client&error_description=AADSTS7000215: Invalid client secret provided.} (auth/invalid-credential).'));
  assert.match(secret, /AADSTS7000215/); assert.match(secret, /Value \(not its Secret ID\)/); assert.doesNotMatch(secret, /password is incorrect/);
  assert.match(friendlyError(fb('... AADSTS700016: Application not found ...')), /Application ID/);
  assert.match(friendlyError(fb('Error getting access token from microsoft.com, response: unknown')), /Microsoft sign-in didn’t work\. Use Google/);
  assert.equal(friendlyError(Object.assign(new Error('x'), { code: 'auth/invalid-credential' })), 'Email or password is incorrect.', 'password errors unchanged');
});

test('Microsoft publisher domain: trawpie.org serves the app association file', async () => {
  const fs = await import('node:fs');
  const assoc = JSON.parse(fs.readFileSync(new URL('../public/microsoft-identity-association.json', import.meta.url)));
  assert.match(assoc.associatedApplications[0].applicationId, /^[0-9a-f-]{36}$/);
  const fb = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url)));
  const rw = (Array.isArray(fb.hosting) ? fb.hosting[0] : fb.hosting).rewrites;
  const i = rw.findIndex(r => r.source === '/.well-known/microsoft-identity-association.json');
  assert.ok(i >= 0 && rw[i].destination === '/microsoft-identity-association.json', 'rewrite to the file');
  assert.ok(i < rw.findIndex(r => r.destination === '/index.html'), 'before the catch-all, or the app page would be served instead');
});

test('SEO: the demo page gets its own title, description and canonical; the home page keeps its own', async () => {
  const fs = await import('node:fs');
  const { demoHtml } = await import('../vite.config.js');
  const home = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(home, /<title>Trawpie: project tracker for engineering and research teams<\/title>/);
  assert.match(home, /<link rel="canonical" href="https:\/\/trawpie\.org\/">/);
  const demo = demoHtml(home);
  assert.match(demo, /<title>Trawpie live demo: try it with a sample team<\/title>/);
  assert.match(demo, /<link rel="canonical" href="https:\/\/trawpie\.org\/demo">/);
  assert.match(demo, /<meta property="og:url" content="https:\/\/trawpie\.org\/demo">/);
  assert.doesNotMatch(demo, /href="https:\/\/trawpie\.org\/">/, 'no home canonical left in the demo page');
  const fb = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url)));
  const rw = (Array.isArray(fb.hosting) ? fb.hosting[0] : fb.hosting).rewrites;
  assert.ok(rw.findIndex(r => r.source === '/demo' && r.destination === '/demo.html') < rw.findIndex(r => r.destination === '/index.html'), '/demo served from demo.html');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /^document\.title = APP_NAME;/m, 'the landing title is not overwritten on load');
  const sm = fs.readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  assert.equal((sm.match(/<url>/g) || []).length, (sm.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || []).length, 'every sitemap URL has a lastmod');
});

test('SEO: the dissertation Gantt chart template page, its download and its links', async () => {
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const page = read('public/templates/dissertation-gantt-chart.html');
  assert.match(page, /<link rel="canonical" href="https:\/\/trawpie\.org\/templates\/dissertation-gantt-chart">/);
  assert.match(page, /<h1>Dissertation Gantt chart template<\/h1>/);
  assert.ok(fs.statSync(new URL('../public/templates/dissertation-gantt-chart.xlsx', import.meta.url)).size > 20000, 'the spreadsheet is there');
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  assert.ok(ld['@graph'].some(x => x['@type'] === 'BreadcrumbList') && ld['@graph'].some(x => x['@type'] === 'DigitalDocument'));
  const fb = JSON.parse(read('firebase.json'));
  const rw = (Array.isArray(fb.hosting) ? fb.hosting[0] : fb.hosting).rewrites;
  assert.ok(rw.findIndex(r => r.source === '/templates/dissertation-gantt-chart' && r.destination === '/templates/dissertation-gantt-chart.html') < rw.findIndex(r => r.destination === '/index.html'));
  assert.match(read('public/sitemap.xml'), /<loc>https:\/\/trawpie\.org\/templates\/dissertation-gantt-chart<\/loc>/);
  ['public/dissertation.html', 'public/blog/gantt-chart-for-a-dissertation-or-final-year-project.html', 'index.html'].forEach(p => assert.match(read(p), /href="\/templates\/dissertation-gantt-chart"/, p + ' links to it'));
});

test('blog: every post is listed, in the sitemap, and its images exist', async () => {
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const index = read('public/blog/index.html'), sitemap = read('public/sitemap.xml');
  const posts = fs.readdirSync(new URL('../public/blog/', import.meta.url)).filter(f => f.endsWith('.html') && f !== 'index.html');
  assert.ok(posts.includes('how-to-plan-a-dissertation.html'));
  posts.forEach(f => {
    assert.ok(index.includes('href="/blog/' + f + '"'), f + ' is on the blog page');
    assert.ok(sitemap.includes('<loc>https://trawpie.org/blog/' + f + '</loc>'), f + ' is in the sitemap');
    const html = read('public/blog/' + f);
    assert.match(html, new RegExp('<link rel="canonical" href="https://trawpie\\.org/blog/' + f.replace(/\./g, '\\.') + '">'), f + ' canonical');
    (html.match(/<img src="\/[^"]+"/g) || []).forEach(m => { const src = m.slice(10, -1); assert.ok(fs.existsSync(new URL('../public' + src, import.meta.url)), f + ': ' + src); });
    const og = (html.match(/<meta property="og:image" content="https:\/\/trawpie\.org(\/[^"]+)">/) || [])[1];
    assert.ok(og && fs.existsSync(new URL('../public' + og, import.meta.url)), f + ': share image ' + og);
    JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  });
});

test('guide: who it’s for, and the dissertation section, are on the page and in its contents', async () => {
  const fs = await import('node:fs');
  const g = fs.readFileSync(new URL('../public/guide.html', import.meta.url), 'utf8');
  ['who', 'dissertation'].forEach(id => { assert.match(g, new RegExp('<section class="block"[^>]* id="' + id + '"'), id + ' section'); assert.match(g, new RegExp('<nav class="toc"[^]*?href="#' + id + '"'), id + ' in the contents'); });
  assert.match(g, /Universities and research[\s\S]*Teams and organisations/);
  assert.match(g, /<article class="fc" data-g="study">/, 'a Dissertation card in the toolbox');
  assert.doesNotMatch(g.split('id="feat-cards"')[0], /class="fc"/, 'the toolbox search only filters its own cards');
});

test('SEO: the Formula Student page is served, listed and linked', async () => {
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const page = read('public/formula-student.html');
  assert.match(page, /<link rel="canonical" href="https:\/\/trawpie\.org\/formula-student">/);
  assert.match(page, /href="\/demo\?team=formula"/, 'it opens the Formula Student demo team');
  page.match(/<img src="([^"]+)"/g).forEach(m => { const src = m.slice(10, -1); assert.ok(fs.existsSync(new URL('../public' + src, import.meta.url)), src); });
  JSON.parse(page.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  const fb = JSON.parse(read('firebase.json'));
  const rw = (Array.isArray(fb.hosting) ? fb.hosting[0] : fb.hosting).rewrites;
  assert.ok(rw.findIndex(r => r.source === '/formula-student' && r.destination === '/formula-student.html') < rw.findIndex(r => r.destination === '/index.html'));
  assert.match(read('public/sitemap.xml'), /<loc>https:\/\/trawpie\.org\/formula-student<\/loc>/);
  ['index.html', 'public/blog/how-to-run-a-formula-student-season.html'].forEach(p => assert.match(read(p), /href="\/formula-student"/, p + ' links to it'));
});

test('index.html: the landing footer stays right after the landing page (its CSS uses the + selector)', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const end = html.indexOf('</main>', html.indexOf('<main id="auth-screen"'));
  assert.match(html.slice(end, end + 120), /^<\/main>\s*<footer data-site-footer class="auth-footer">/);
});

test('dissertation plan: undergraduate with people (ethics, chapters, milestones, every week)', async () => {
  const { buildDissertationPlan, defaultChapters } = await import('../src/dissertation.js');
  const p = buildDissertationPlan({ level: 'ug', kind: 'people', start: '2026-10-01', handIn: '2027-04-30', dates: { proposal: '2026-11-06' } });
  assert.deepEqual(p.warnings, []);
  assert.ok(p.phases.some(x => x.id === 'ph_ethics'), 'research with people gets an ethics phase');
  const ms = p.tasks.filter(t => t.milestone).map(t => t.name + '@' + t.due);
  assert.ok(ms.includes('Proposal submitted@2026-11-06'), 'proposal on the university’s date');
  assert.ok(ms.includes('Hand in your dissertation@2027-04-30'), 'hand-in on the hand-in date');
  assert.ok(ms.some(m => m.startsWith('Full draft to supervisor@')));
  assert.equal(p.weeks[0].startDate, '2026-09-28', 'weeks start on the Monday of the start date');
  assert.ok(p.weeks.at(-1).startDate <= '2027-04-30' && p.summary.later === 0, 'every task sits in a week on the board');
  assert.ok(p.tasks.every(t => t.due >= '2026-10-01' && t.due <= '2027-04-30'), 'everything between start and hand-in');
  defaultChapters('ug', 'people').forEach(c => assert.ok(p.tasks.some(t => t.name === 'Write: ' + c.name), 'a writing task for ' + c.name));
  assert.equal(defaultChapters('ug', 'people').reduce((s, c) => s + c.target, 0), 10000);
  assert.equal(defaultChapters('masters', 'lab', 15000).reduce((s, c) => s + c.target, 0), 15000, 'targets add up exactly');
  assert.ok(p.phases.length <= 20 && p.phases.every(x => x.start <= x.end));
});

test('dissertation plan: master’s build project and PhD', async () => {
  const { buildDissertationPlan, defaultChapters } = await import('../src/dissertation.js');
  const m = buildDissertationPlan({ level: 'masters', kind: 'lab', start: '2027-06-01', handIn: '2027-09-10' });
  assert.ok(!m.phases.some(x => x.id === 'ph_ethics'), 'no ethics phase for a build project');
  assert.ok(m.tasks.some(t => /risk assessment/i.test(t.name)), 'lab safety instead');
  assert.deepEqual(defaultChapters('masters', 'lab').map(c => c.name).slice(2, 5), ['Design', 'Implementation', 'Testing and results']);
  const d = buildDissertationPlan({ level: 'phd', kind: 'data', start: '2026-10-01', handIn: '2030-03-31', dates: { upgrade: '2027-09-15', viva: '2030-06-01' } });
  assert.equal(d.weeks.length, 13, 'a PhD shows its first term of weeks');
  assert.ok(d.summary.later > 20 && d.laterFrom === '2026-12-28', 'the rest waits in the Backlog with dates');
  const ms = d.tasks.filter(t => t.milestone).map(t => t.name);
  ['Upgrade / confirmation review', 'Full thesis draft to supervisors', 'Submit your thesis', 'Viva'].forEach(n => assert.ok(ms.includes(n), n));
  assert.ok(ms.includes('Annual progress review (year 2)') && !ms.includes('Annual progress review (year 1)'), 'the upgrade stands in for the first annual review');
  assert.equal(d.tasks.find(t => t.name === 'Viva').due, '2030-06-01');
  assert.equal(defaultChapters('phd').reduce((s, c) => s + c.target, 0), 80000);
  const tight = buildDissertationPlan({ level: 'ug', start: '2026-10-01', handIn: '2026-10-10' });
  assert.match(tight.warnings[0], /less than three weeks/);
});

test('dissertation: the demo’s sample dissertation (five weeks in, one slip, a draft with the supervisor)', async () => {
  const { buildSampleDissertation } = await import('../src/sample-diss.js');
  const { scheduleStatus, draftState } = await import('../src/dissertation.js');
  const now = new Date('2026-10-28T10:00:00').getTime();
  const { teamId, team, users } = buildSampleDissertation({ uid: 'me1', name: 'Maya', email: 'maya@uni.ac.uk' }, now);
  assert.match(teamId, /^t_sample_diss_/);
  assert.equal(team.doc.weeks[0].startDate, '2026-09-21', 'started five weeks before this Monday');
  assert.ok(team.doc.features.dissertation && team.doc.roles.supervisor && team.members.u_sample_supervisor.roleId === 'supervisor' && users.u_sample_supervisor);
  const tasks = Object.entries(team.tasks).map(([id, t]) => cleanTask(t, id));
  const mine = tasks.filter(t => t.ownerUid === 'me1');
  const late = mine.filter(t => t.flag !== 'completed' && t.dueDate < '2026-10-26');
  assert.equal(late.length, 1, 'exactly one task slipped');
  assert.equal(scheduleStatus(mine, '2026-10-28').state, 'behind');
  const plan = cleanDissertation(team.dissertation.plan);
  const lit = plan.chapters.find(c => c.name === 'Literature review');
  assert.ok(lit.status === 'supervisor' && lit.drafts.length === 1 && team.tasks[lit.drafts[0].taskId].ownerUid === 'u_sample_supervisor', 'the draft is a review task in the supervisor’s row');
  assert.equal(draftState(cleanTask(team.tasks[lit.drafts[0].taskId], lit.drafts[0].taskId), '2026-10-28').state, 'waiting');
  assert.ok(plan.proposal.question.endsWith('?') && plan.chapters.reduce((s, c) => s + c.target, 0) === 10000);
  assert.ok(Object.values(team.comments).every(c => team.tasks[c.taskId]), 'comments sit on real tasks');
  assert.ok(Object.values(team.meetings)[0].actions.every(a => !a.taskId || team.tasks[a.taskId]), 'meeting actions link to real tasks');
  assert.equal(Object.keys(team.papers).length, 4);
});

test('dissertation: on-track signal and chapter draft states', async () => {
  const { scheduleStatus, draftState } = await import('../src/dissertation.js');
  const T = (due, done) => ({ dueDate: due, flag: done ? 'completed' : 'none' });
  assert.equal(scheduleStatus([], '2027-01-10').state, 'none');
  assert.deepEqual(scheduleStatus([T('2027-01-01', true), T('2027-01-08', true), T('2027-01-20', true)], '2027-01-10'), { state: 'ok', days: 0, ahead: 1, done: 3, due: 2 }, 'everything due is done, one ahead');
  const b = scheduleStatus([T('2027-01-01', true), T('2027-01-04'), T('2027-01-08')], '2027-01-10');
  assert.equal(b.state, 'behind'); assert.equal(b.days, 6, 'measured from the oldest open task');
  assert.equal(scheduleStatus([T('2026-12-01'), T('2027-01-08')], '2027-01-10').state, 'late', 'over three weeks behind');
  assert.equal(scheduleStatus([T('2027-01-10')], '2027-01-10').state, 'ok', 'due today is not late yet');
  assert.equal(scheduleStatus([T(''), T('2027-02-01')], '2027-01-10').state, 'ok', 'undated tasks are ignored');
  assert.equal(draftState(null).state, 'gone');
  assert.equal(draftState({ flag: 'none', status: '', dueDate: '2027-01-20' }, '2027-01-10').state, 'waiting');
  assert.equal(draftState({ flag: 'none', status: '', dueDate: '2027-01-05' }, '2027-01-10').state, 'late');
  assert.equal(draftState({ flag: 'completed', status: 'Approved', dueDate: '2027-01-05' }, '2027-01-10').state, 'approved');
  assert.equal(draftState({ flag: 'completed', status: 'Changes needed' }, '2027-01-10').state, 'changes');
  assert.equal(draftState({ flag: 'completed', status: 'Done' }, '2027-01-10').state, 'reviewed');
});

// ── Sweep of 28 Oct 2026: carry-over, undo, dissertation and sub-team fixes ─────
import { carryFields, carryCopyId, uniqueTimeEntries, subteamsWithout, needsApproval } from '../src/model.js';
import { latestCopies } from '../functions/ghsync.js';
import { scheduleStatus, supervisorDecision, buildDissertationPlan, draftState } from '../src/dissertation.js';
test('a carried copy: points to the first copy, no hours, no new repeat series, only a waiting sign-off', () => {
  const t = { id: 't1', timeLog: [{ id: 'l1', hours: 3 }], repeat: { every: 1 }, signoff: { stage: 'review', status: 'approved', by: 'a', approver: 'b' } };
  const f = carryFields(t);
  assert.equal(f.carryOf, 't1'); assert.deepEqual(f.timeLog, []); assert.equal(f.repeat.every, 0); assert.equal(f.repeat.seriesId, 't1'); assert.equal(f.signoff, null);
  assert.equal(carryFields({ id: 't2', carryOf: 't1', signoff: { stage: 'review', status: 'waiting', by: 'a' } }).signoff.status, 'waiting');
  assert.equal(carryFields({ id: 't2', carryOf: 't1' }).carryOf, 't1', 'a copy of a copy points to the first');
  assert.equal(carryCopyId('t1', 'wk_2'), carryCopyId('t1', 'wk_2'), 'two apps make the same copy id');
  assert.notEqual(carryCopyId('t1', 'wk_2'), carryCopyId('t1', 'wk_3'));
  assert.match(carryCopyId('t1', 'wk_2'), /^[A-Za-z0-9_-]{1,64}$/);
});
test('hours on a chain of carried copies are counted once', () => {
  const e = { id: 'l1', hours: 3, date: '2026-10-01' };
  assert.equal(uniqueTimeEntries([{ timeLog: [e] }, { timeLog: [e] }, { timeLog: [e, { id: 'l2', hours: 1, date: '2026-10-08' }] }]).reduce((a, x) => a + x.e.hours, 0), 4);
});
test('only the newest copy of a carried task counts (Today, digest)', () => {
  const weeks = [{ key: 'w1' }, { key: 'w2' }, { key: 'w3' }];
  const got = latestCopies([{ id: 'a', weekId: 'w1' }, { id: 'b', carryOf: 'a', weekId: 'w3' }, { id: 'c', carryOf: 'a', weekId: 'w2' }, { id: 'x', weekId: 'w1' }], weeks).map(t => t.id).sort();
  assert.deepEqual(got, ['b', 'x']);
});
test('dissertation: on track only when everything due is done', () => {
  const t = (dueDate, flag = 'none') => ({ dueDate, flag });
  assert.equal(scheduleStatus([t('2026-10-01'), t('2026-12-01', 'completed'), t('2026-12-08', 'completed')], '2026-10-20').state, 'behind', 'finishing later work early doesn’t cover an overdue task');
  assert.equal(scheduleStatus([t('2026-10-01', 'completed'), t('2026-12-01', 'completed')], '2026-10-20').ahead, 1);
});
test('dissertation: nothing is recruited before ethics approval', () => {
  const p = buildDissertationPlan({ level: 'masters', kind: 'people', start: '2026-01-05', handIn: '2026-09-04', dates: { ethics: '2026-07-01' } });
  const due = (n) => p.tasks.find(x => x.name.startsWith(n)).due;
  assert.ok(due('Recruit') >= due('Ethics approved') && due('Pilot') >= due('Ethics approved'));
  assert.ok(p.warnings.some(w => /Ethics approval comes late/.test(w)));
});
test('dissertation: a draft counts as approved only when the supervisor recorded it', () => {
  const members = [{ uid: 'sup', roleId: 'supervisor' }, { uid: 'stu', roleId: 'owner' }];
  assert.equal(supervisorDecision([{ taskId: 'r', authorUid: 'stu', text: '✅ Approved.', createdAt: 2 }], members, 'r'), '', 'the student’s own comment doesn’t count');
  assert.equal(supervisorDecision([{ taskId: 'r', authorUid: 'sup', text: '✏️ Changes needed. More sources', createdAt: 1 }, { taskId: 'r', authorUid: 'sup', text: '✅ Approved.', createdAt: 3 }], members, 'r'), 'approved');
  assert.equal(draftState({ flag: 'completed', status: 'Approved' }, '2027-01-10', '').state, 'unconfirmed');
});
test('someone who leaves is taken out of their sub-teams (and the leads index)', () => {
  const team = { subteams: [{ id: 'st1', name: 'Fuselage', members: ['a', 'b'], leads: ['b'] }] };
  const u = subteamsWithout(team, 'b');
  assert.deepEqual(u.subteams[0].members, ['a']); assert.deepEqual(u.subteams[0].leads, []); assert.deepEqual(u.leads, {});
  assert.equal(subteamsWithout(team, 'zz'), null);
});
test('purchase approval: the items’ price before a discount counts (as in the security rules)', () => {
  assert.equal(needsApproval({ status: 'needed', qty: 1, unitCost: 120, extras: [{ label: 'Student discount', amount: -25, percent: true }] }, { on: true, over: 100 }), true);
});
test('undo puts back only my change, keeping a teammate’s later edits', () => {
  const before = { id: 't', name: 'A', subtasks: [{ id: 's1', title: 'x', completed: false }, { id: 's2', title: 'y', completed: false }] };
  const after = { ...before, subtasks: [{ id: 's1', title: 'x', completed: true }, before.subtasks[1]] };
  const now = { ...after, name: 'Renamed by Bob', subtasks: [after.subtasks[0], { id: 's2', title: 'y', completed: true }] };
  const [op] = restoreOps([{ kind: 'task', id: 't', before, after }], { name: 'Ann', uid: 'ann' }, 'before', () => now);
  assert.equal(op.data.name, undefined, 'Bob’s rename stays');
  assert.deepEqual(op.data.subtasks.map(s => s.completed), [false, true], 'my tick is undone, Bob’s stays');
  const w0 = [{ key: 'w9', title: 'WEEK 9' }], w1 = [{ key: 'w9', title: 'Exam week' }], cur = [...w1, { key: 'w10', title: 'WEEK 10' }];
  const [wop] = restoreOps([{ kind: 'weeks', before: w0, after: w1 }], { name: 'Ann' }, 'before', () => cur);
  assert.deepEqual(wop.data.weeks.map(w => w.title), ['WEEK 9', 'WEEK 10'], 'Bob’s new week stays');
});

test('undo of a deleted signed-off task: the decision is kept beside the deletion and taken back on undo', () => {
  const so = { stage: 'review', status: 'approved', by: 'a', byName: 'A', at: 1, approver: 'b', approverName: 'B', note: '', decidedAt: 2 };
  const before = { id: 't1', name: 'Frame', ownerUid: 'a', signoff: so, weekId: 'w1', categoryId: 'c1' };
  const changes = [{ kind: 'task', id: 't1', before, after: null }];
  const ops = changesToOps(changes, { uid: 'm', name: 'Max' });
  assert.deepEqual(ops.map(o => o.type + ' ' + o.path), ['delete tasks/t1', 'set removed/t1']);
  assert.deepEqual(ops[1].data.signoff, so); assert.equal(ops[1].data.name, 'Frame'); assert.equal(ops[1].data.by, 'm');
  const undo = restoreOps(changes, { uid: 'm', name: 'Max' }, 'before');
  assert.deepEqual(undo.map(o => o.type + ' ' + o.path), ['set tasks/t1', 'delete removed/t1']);
  const redo = restoreOps(changes, { uid: 'm', name: 'Max' }, 'after', () => before);
  assert.deepEqual(redo.map(o => o.type + ' ' + o.path), ['delete tasks/t1', 'set removed/t1'], 'redo deletes it again, keeping the decision');
  const waiting = changesToOps([{ kind: 'task', id: 't2', before: { ...before, id: 't2', signoff: { ...so, status: 'waiting' } }, after: null }], { uid: 'm', name: 'Max' });
  assert.equal(waiting.length, 1, 'a waiting request needs nothing kept');
});

test('no inline script: every data-on… handler in the page and the board is a plain call of an allowed function', async () => {
  const fs = await import('node:fs');
  const { parseHandler, ALLOWED, EVENTS } = await import('../src/handlers.js');
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../public/board/board.js', import.meta.url), 'utf8');
  assert.equal(/\son[a-z]+=["']/.test(page), false, 'index.html has no onclick="…"');
  assert.equal(/[\s'"`]on(click|change|keydown|blur|input)=["']/.test(board), false, 'the board writes no onclick="…"');
  assert.equal(/<script>/.test(page), false, 'index.html has no inline <script>');
  const found = [...(page + board).matchAll(/data-on([a-z]+)="([^"]*)"/g)];
  assert.ok(found.length > 50, 'found the handlers (' + found.length + ')');
  const used = new Set();
  for (const [, ev, src] of found) {
    assert.ok(EVENTS.includes(ev), 'listened for: ' + ev);
    const code = src.replace(/\$\{[^}]*\}/g, '0');   // the board's template values (ids, indexes)
    const { calls } = parseHandler(code); calls.forEach(c => used.add(c.call));
  }
  for (const name of ALLOWED) assert.ok(used.has(name), 'allowed but unused: ' + name);
  assert.throws(() => parseHandler('alert(1)'), /Not an allowed action/);
  assert.throws(() => parseHandler('toggleTheme(window.x)'), /plain values/);
  assert.throws(() => parseHandler('toggleTheme(); fetch("//x")'), /Not an allowed action/);
  assert.throws(() => parseHandler('toggleTheme`x`'), /Unexpected/);
  assert.deepEqual(parseHandler("TT.openSettings('members'); return false;"), { calls: [{ call: 'TT.openSettings', args: [{ lit: 'members' }] }], ret: false });
});

test('hosting: pages are always checked with the server, and a missing file is a 404, not the app', async () => {
  const fs = await import('node:fs');
  const h = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')).hosting;
  const cc = (src) => ((h.headers.find(x => x.source === src) || {}).headers || []).find(x => x.key === 'Cache-Control');
  for (const src of ['/', '**/*.html', '/index.html', '/sw.js', '/boot/**', '/*.js']) assert.equal((cc(src) || {}).value, 'no-cache', src + ' is no-cache');
  assert.match(cc('/assets/**').value, /immutable/);
  const fallback = h.rewrites.find(r => r.destination === '/index.html');
  assert.equal(fallback.source, '**/!(*.*)', 'only paths without a file extension fall back to the app');
});
