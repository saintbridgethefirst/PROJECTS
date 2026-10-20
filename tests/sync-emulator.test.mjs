// Saving with the real Firestore (emulator) and real security rules, two people at once, one offline.
//   npm run test:ops        (needs Java 11+; runs in GitHub Actions)
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, writeBatch, deleteDoc, disableNetwork, enableNetwork } from 'firebase/firestore';
import { fixture, users, TEAM } from './scenarios.mjs';
import { runOpsWith } from '../src/backend/batch.js';
import { merge3, deepEqual } from '../src/sync.js';

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-teamtrack', firestore: { rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore(); const T = fixture().teams[TEAM];
    await setDoc(doc(db, 'teams', TEAM), T.doc);
    for (const c of ['members', 'categories', 'tasks']) for (const [id, d] of Object.entries(T[c] || {})) await setDoc(doc(db, 'teams', TEAM, c, id), d);
  });
});
const dbFor = (who) => env.authenticatedContext(users[who].uid, { email: users[who].email, email_verified: true }).firestore();
const fbFor = (db) => ({ writeBatch: () => writeBatch(db), getDoc, ref: (p) => (p === 'team' ? doc(db, 'teams', TEAM) : doc(db, 'teams', TEAM, ...p.split('/'))) });
const task = async (db, id) => (await getDoc(doc(db, 'teams', TEAM, 'tasks', id))).data();

test('an edit to a task someone deleted is left out; the rest of the save goes through', async () => {
  const owner = dbFor('owner');
  await deleteDoc(doc(owner, 'teams', TEAM, 'tasks', 't_mem1'));
  const res = await runOpsWith(fbFor(owner), [
    { type: 'update', path: 'tasks/t_mem1', data: { priority: 'Major', updatedBy: 'owner', updatedAt: 2 } },
    { type: 'update', path: 'tasks/t_owner', data: { status: 'Ordered', updatedBy: 'owner', updatedAt: 2 } },
  ]);
  assert.deepEqual(res.skipped, ['tasks/t_mem1']);
  assert.equal((await task(owner, 't_owner')).status, 'Ordered');
  assert.equal(await task(owner, 't_mem1'), undefined, 'not brought back');
});

test('other errors still fail the save (e.g. no permission)', async () => {
  const viewer = dbFor('view1');
  await assert.rejects(runOpsWith(fbFor(viewer), [{ type: 'update', path: 'tasks/t_owner', data: { status: 'x', updatedBy: 'view1', updatedAt: 2 } }]));
});

test('offline: a queued edit to a task deleted meanwhile doesn’t break the other queued edits', async () => {
  const owner = dbFor('owner'), admin = dbFor('admin1');
  await disableNetwork(owner);
  const saving = runOpsWith(fbFor(owner), [
    { type: 'update', path: 'tasks/t_mem1', data: { priority: 'Critical', updatedBy: 'owner', updatedAt: 3 } },
    { type: 'update', path: 'tasks/t_owner', data: { jiraId: 'SKY-7', updatedBy: 'owner', updatedAt: 3 } },
  ]);
  await deleteDoc(doc(admin, 'teams', TEAM, 'tasks', 't_mem1'));
  await enableNetwork(owner);
  const res = await saving;
  assert.deepEqual(res.skipped, ['tasks/t_mem1']);
  assert.equal((await task(admin, 't_owner')).jiraId, 'SKY-7');
});

test('two people tick different sub-tasks at once: the merge puts both back', async () => {
  const owner = dbFor('owner'), admin = dbFor('admin1');
  const st = (a, b) => [{ id: 's1', title: 'Cut', completed: a }, { id: 's2', title: 'Glue', completed: b }];
  await runOpsWith(fbFor(owner), [{ type: 'update', path: 'tasks/t_owner', data: { subtasks: st(false, false), updatedBy: 'owner', updatedAt: 4 } }]);
  const base = st(false, false), mine = st(true, false);
  await runOpsWith(fbFor(owner), [{ type: 'update', path: 'tasks/t_owner', data: { subtasks: mine, updatedBy: 'owner', updatedAt: 5 } }]);
  await runOpsWith(fbFor(admin), [{ type: 'update', path: 'tasks/t_owner', data: { subtasks: st(false, true), updatedBy: 'admin1', updatedAt: 5 } }]);
  const theirs = (await task(owner, 't_owner')).subtasks;           // as Firestore returns it
  assert.ok(!deepEqual(theirs, mine), 'the later save overwrote the first tick');
  const merged = merge3(base, mine, theirs);
  await runOpsWith(fbFor(owner), [{ type: 'update', path: 'tasks/t_owner', data: { subtasks: merged, updatedBy: 'owner', updatedAt: 6 } }]);
  const final = (await task(admin, 't_owner')).subtasks;
  assert.ok(deepEqual(final, st(true, true)), 'both ticks saved');
  assert.ok(deepEqual(merge3(st(false, false), st(false, true), final), final), 'the other browser sees nothing left to merge');
});
