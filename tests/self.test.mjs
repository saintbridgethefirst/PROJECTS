// SelfTrack logic (src/self-model.js) and its security rule copy (rules-sim validSelf).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/self-model.js';
import { validSelf } from '../src/rules-sim.js';

const T = '2026-10-21';   // a Wednesday
const MON = '2026-10-19';

test('dates: Monday of a week, adding days', () => {
  assert.equal(M.mondayOf(T), MON); assert.equal(M.mondayOf(MON), MON); assert.equal(M.mondayOf('2026-10-25'), MON);
  assert.equal(M.addDays(T, 11), '2026-11-01'); assert.equal(M.daysBetween(MON, T), 2);
});

test('cleanSelfItem keeps known fields, clips text, snaps weekly tasks to Monday, and passes the rules', () => {
  const t = M.cleanSelfItem({ kind: 'task', title: '  Read  ', scope: 'week', date: T, hack: 1, done: true, doneOn: T }, 'u1');
  assert.equal(t.title, 'Read'); assert.equal(t.date, MON); assert.equal(t.hack, undefined); assert.equal(t.uid, 'u1');
  assert.ok(validSelf(t, 'u1')); assert.ok(!validSelf(t, 'u2'), 'someone else’s uid fails');
  assert.equal(M.cleanSelfItem({ kind: 'nope', title: 'x'.repeat(400) }, 'u1').title.length, 300);
  const h = M.cleanSelfItem({ kind: 'habit', title: 'Gym', goal: 12, log: [T, T, '2026-10-01', 'bad'] }, 'u1');
  assert.equal(h.goal, 7); assert.deepEqual(h.log, ['2026-10-01', T]); assert.ok(validSelf(h, 'u1'));
  const s = M.cleanSelfItem({ kind: 'settings', areas: [{ id: 'uni!', name: 'Uni', color: 'red' }], sync: { t1: false, 'bad id!': true } }, 'u1');
  assert.equal(s.areas[0].id, 'uni'); assert.match(s.areas[0].color, /^#/); assert.deepEqual(s.sync, { t1: false }); assert.ok(validSelf(s, 'u1'));
  ['skill', 'learning', 'reflect'].forEach(kind => assert.ok(validSelf(M.cleanSelfItem({ kind, title: 'x' }, 'u1'), 'u1'), kind));
});

test('every example item is valid', () => {
  const items = M.sampleSelf(T);
  assert.ok(items.length > 15);
  items.forEach(i => assert.ok(validSelf(M.cleanSelfItem(i, 'u1'), 'u1'), i.title));
});

test('quick add: #area picks an area by name or id', () => {
  const areas = M.DEFAULT_AREAS;
  assert.deepEqual(M.parseQuickAdd('Email supervisor #uni', areas), { title: 'Email supervisor', area: 'uni' });
  assert.deepEqual(M.parseQuickAdd('Fix #3 bug #Health', areas), { title: 'Fix #3 bug', area: 'health' });
  assert.deepEqual(M.parseQuickAdd('Nothing here', areas), { title: 'Nothing here', area: '' });
});

const task = (over) => ({ id: Math.random().toString(36).slice(2), kind: 'task', title: 't', area: '', scope: 'day', date: T, done: false, order: 0, createdAt: 1, ...over });
test('daily tasks: unfinished ones from earlier days roll into today, not into other days', () => {
  const items = [task({ id: 'a' }), task({ id: 'b', date: '2026-10-20' }), task({ id: 'c', date: '2026-10-20', done: true }), task({ id: 'd', date: '2026-10-22' })];
  assert.deepEqual(M.tasksForDay(items, T, T).map(t => t.id + ':' + t.late), ['a:0', 'b:1']);
  assert.deepEqual(M.tasksForDay(items, '2026-10-20', T).map(t => t.id), ['b', 'c'], 'a past day shows what was planned for it');
  assert.deepEqual(M.tasksForDay(items, '2026-10-22', T).map(t => t.id), ['d']);
});
test('weekly goals: unfinished ones from earlier weeks roll into this week', () => {
  const items = [task({ id: 'w', scope: 'week', date: MON }), task({ id: 'old', scope: 'week', date: '2026-10-05' }), task({ id: 'olddone', scope: 'week', date: '2026-10-05', done: true })];
  assert.deepEqual(M.tasksForWeek(items, MON, MON).map(t => t.id + ':' + t.late), ['w:0', 'old:2']);
  assert.deepEqual(M.tasksForWeek(items, '2026-10-26', MON).map(t => t.id), []);
});

test('habits: weekly count, streaks and ticking', () => {
  const daily = { goal: 7, log: ['2026-10-18', '2026-10-19', '2026-10-20'] };
  assert.deepEqual(M.habitStreak(daily, T), { n: 3, unit: 'day' }, 'not yet ticked today: the streak up to yesterday still counts');
  assert.deepEqual(M.habitStreak({ goal: 7, log: M.toggleHabit(daily, T) }, T), { n: 4, unit: 'day' });
  assert.deepEqual(M.toggleHabit({ log: [T] }, T), []);
  const weekly = { goal: 2, log: ['2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20'] };
  assert.equal(M.habitWeekCount(weekly, MON), 1);
  assert.deepEqual(M.habitStreak(weekly, T), { n: 2, unit: 'week' }, 'this week isn’t met yet, the two before are');
  assert.equal(M.habitProgress(weekly, T), 0.5);
});

test('skills: levels by share of the goal hours, and when each level was reached', () => {
  const s = (mins) => ({ goal: 100, log: [{ d: '2026-10-01', m: mins }] });
  assert.equal(M.skillLevel(s(0)).name, 'Beginner');
  assert.equal(M.skillLevel(s(9.9 * 60)).name, 'Beginner');
  assert.equal(M.skillLevel(s(10 * 60)).name, 'Learning');
  assert.equal(M.skillLevel(s(50 * 60)).name, 'Confident');
  const ex = M.skillLevel(s(100 * 60)); assert.equal(ex.name, 'Expert'); assert.equal(ex.pct, 1);
  const mid = M.skillLevel(s(30 * 60)); assert.equal(mid.nextAt, 50); assert.ok(Math.abs(mid.pct - 0.5) < 1e-9);
  const m = M.skillMilestones({ goal: 10, log: [{ d: '2026-10-01', m: 30 }, { d: '2026-10-05', m: 60 }, { d: '2026-10-09', m: 300 }] });
  assert.deepEqual(m.map(x => x.d + ' ' + x.name), ['2026-10-05 Learning', '2026-10-09 Confident']);
  const w = M.skillWeeks({ log: [{ d: T, m: 90 }, { d: '2026-10-12', m: 30 }] }, T, 3);
  assert.deepEqual(w.map(x => x.hours), [0, 0.5, 1.5]);
});

test('the month orb: habits kept against their goal, and tasks done', () => {
  const items = [{ kind: 'habit', goal: 7, log: ['2026-10-01', '2026-10-02'] }, task({ date: '2026-10-05', done: true }), task({ date: '2026-10-06' })];
  const sum = M.monthSummary(items, '2026-10-07');
  assert.equal(sum.kept, 2); assert.equal(sum.target, 7); assert.equal(sum.done, 1); assert.equal(sum.tasks, 2);
  assert.ok(Math.abs(sum.pct - ((2 / 7 + 0.5) / 2)) < 1e-9); assert.equal(sum.month, 'October');
  assert.equal(M.monthSummary([], T).pct, 0);
});

test('throwback: a reflection, else a learning, else a skill, from about that long ago', () => {
  assert.equal(M.throwback([], T, 30), null);
  const tb = M.throwback(M.sampleSelf(T), T, 30);
  assert.equal(tb.kind, 'reflect'); assert.equal(tb.when, 'A month ago'); assert.match(tb.quote, /ROS 2/);
  const learn = M.throwback([{ kind: 'learning', title: 'Topics', date: M.addDays(T, -29), skillId: '' }], T, 30);
  assert.equal(learn.kind, 'learning'); assert.equal(learn.quote, 'Topics');
  assert.equal(M.throwback([{ kind: 'learning', title: 'x', date: M.addDays(T, -60) }], T, 30), null, 'too far from a month ago');
});

test('synced team tasks: mine, open, this week, newest carried copy, teams switched off left out', () => {
  const work = [{ teamId: 't1', team: { name: 'Drone', weeks: [{ key: 'w4', title: 'WEEK 4', startDate: MON }] }, tasks: [
    { id: 'a', name: 'In this week', ownerUid: 'me', weekId: 'w4', flag: 'none' },
    { id: 'b', name: 'Due Friday', ownerUid: 'me', weekId: 'w3', dueDate: '2026-10-23', flag: 'none' },
    { id: 'c', name: 'Late', ownerUid: 'me', weekId: 'w2', dueDate: '2026-10-14', flag: 'none' },
    { id: 'd', name: 'Done', ownerUid: 'me', weekId: 'w4', flag: 'completed' },
    { id: 'e', name: 'Not mine', ownerUid: 'x', weekId: 'w4', flag: 'none' },
    { id: 'f', name: 'Supporting', ownerUid: 'x', supportPersonId: 'me', weekId: 'w4', flag: 'none' },
    { id: 'g', name: 'Next month', ownerUid: 'me', weekId: 'w9', dueDate: '2026-11-20', flag: 'none' },
    { id: 'old', name: 'Carried', ownerUid: 'me', weekId: 'w3', dueDate: '2026-10-22', flag: 'none' },
    { id: 'new', name: 'Carried', ownerUid: 'me', weekId: 'w4', dueDate: '2026-10-22', flag: 'none', carryOf: 'old' },
  ] }, { teamId: 't2', team: { name: 'Off', weeks: [] }, tasks: [{ id: 'z', name: 'Hidden', ownerUid: 'me', dueDate: T, flag: 'none' }] }];
  const rows = M.syncedTeamTasks(work, 'me', T, { t2: false });
  assert.deepEqual(rows.map(r => r.id), ['c', 'new', 'b', 'a', 'f']);
  assert.equal(rows[0].late, 7); assert.ok(rows.find(r => r.id === 'f').support); assert.equal(rows.find(r => r.id === 'a').weekTitle, 'WEEK 4');
  assert.equal(M.syncedTeamTasks(work, 'me', T, {}).filter(r => r.teamId === 't2').length, 1, 'teams are on unless switched off');
});
