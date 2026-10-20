// Pilot numbers (functions/stats.js) against the Firestore emulator.
//   npm run test:ops        (needs Java; runs in GitHub Actions)
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { teamStats, refreshAll, DAY } from '../functions/stats.js';

const app = getApps()[0] || initializeApp({ projectId: 'demo-teamtrack' });
const db = getFirestore(app);
const put = (p, d) => db.doc(p).set(d);
const NOW = Date.parse('2026-11-20T06:00:00Z');
const wipe = async () => { for (const c of ['teams', 'teamStats', 'feedback']) await db.recursiveDelete(db.collection(c)); };
after(wipe);

test('team stats: who changed something this week, counts only', async () => {
  await wipe();
  await put('teams/ST1', { name: 'Skyhawk', createdAt: 1, weeks: [{ key: 'w1' }, { key: 'w2' }], plan: { tier: 'pro', edu: true }, features: { parts: true, finance: false } });
  for (const [uid, name] of [['a', 'Aisha Khan'], ['b', 'Tom Reed'], ['c', 'Priya Nair']]) await put('teams/ST1/members/' + uid, { uid, name, roleId: 'member' });
  await put('teams/ST1/invites/x@uni.ac.uk', { email: 'x@uni.ac.uk' });
  await put('teams/ST1/tasks/t1', { name: 'Secret wing design', updatedBy: 'Aisha Khan', createdBy: 'a', createdAt: 1, updatedAt: NOW - 2 * DAY });
  await put('teams/ST1/tasks/t2', { name: 'Motor', updatedBy: 'Aisha Khan', createdBy: 'b', createdAt: NOW - DAY, updatedAt: NOW - DAY });
  await put('teams/ST1/tasks/t3', { name: 'Old', updatedBy: 'Priya Nair', createdBy: 'c', createdAt: 1, updatedAt: NOW - 30 * DAY });
  await put('teams/ST1/comments/c1', { authorUid: 'c', text: 'private words', createdAt: NOW - 3 * DAY });
  await put('feedback/f1', { teamId: 'ST1', at: NOW - DAY, text: 'x' });
  const s = await teamStats(db, 'ST1', NOW);
  assert.equal(s.name, 'Skyhawk'); assert.equal(s.plan, 'pro'); assert.equal(s.edu, true);
  assert.equal(s.members, 3); assert.equal(s.invitesPending, 1); assert.equal(s.tasks, 3); assert.equal(s.weeks, 2);
  assert.equal(s.active7, 3, 'Aisha edited, Tom created a task, Priya commented');
  assert.equal(s.tasksChanged7, 2); assert.equal(s.tasksCreated7, 1); assert.equal(s.comments7, 1); assert.equal(s.feedback7, 1);
  assert.equal(s.lastActivity, NOW - DAY); assert.deepEqual(s.features, ['parts']);
  assert.ok(!JSON.stringify(s).includes('Secret') && !JSON.stringify(s).includes('private'), 'nothing a team wrote');
});

test('team stats: daily history kept for 8 weeks; deleted teams dropped', async () => {
  await refreshAll(db, NOW - DAY);
  await refreshAll(db, NOW);
  const s = (await db.doc('teamStats/ST1').get()).data();
  assert.deepEqual(s.history.map(h => h.d), ['2026-11-19', '2026-11-20']);
  await refreshAll(db, NOW);
  assert.equal((await db.doc('teamStats/ST1').get()).data().history.length, 2, 'one point per day');
  await put('teamStats/GONE', { name: 'Deleted team' });
  const r = await refreshAll(db, NOW);
  assert.equal(r.removed, 1); assert.ok(!(await db.doc('teamStats/GONE').get()).exists);
});
