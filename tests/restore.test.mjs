// Restoring one team from a backup database, against the Firestore emulator (needs Java).
//   npm run test:ops
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readTeam, planRestore, applyRestore } from '../tools/ops/restore-team.mjs';

const PROJECT = 'demo-teamtrack';
const app = initializeApp({ projectId: PROJECT });
const live = getFirestore(app), backup = getFirestore(app, 'restore-test');
const put = (db, path, data) => db.doc(path).set(data);

test('restores one team from a backup database and leaves other teams alone', async () => {
  // Backup: the team as it was yesterday
  await put(backup, 'teams/T1', { name: 'Skyhawk', weeks: [{ key: 'w1', title: 'WEEK 1' }] });
  await put(backup, 'teams/T1/tasks/a', { name: 'Wing CAD', flag: 'none', at: Timestamp.fromMillis(1700000000000) });
  await put(backup, 'teams/T1/tasks/b', { name: 'Telemetry', flag: 'none' });
  await put(backup, 'teams/T1/members/u1', { uid: 'u1', roleId: 'owner' });
  // Live: someone deleted a task, broke another and added junk; another team must not change
  await put(live, 'teams/T1', { name: 'Skyhawk', weeks: [] });
  await put(live, 'teams/T1/tasks/a', { name: 'oops', flag: 'none', at: Timestamp.fromMillis(1700000000000) });
  await put(live, 'teams/T1/tasks/junk', { name: 'junk' });
  await put(live, 'teams/T1/members/u1', { uid: 'u1', roleId: 'owner' });
  await put(live, 'teams/T2', { name: 'Other team' });
  await put(live, 'teams/T2/tasks/x', { name: 'Keep me' });

  const plan = planRestore(await readTeam(live, 'T1'), await readTeam(backup, 'T1'));
  assert.deepEqual(plan.write.sort(), ['teams/T1', 'teams/T1/tasks/a', 'teams/T1/tasks/b']);
  assert.deepEqual(plan.del, ['teams/T1/tasks/junk']);
  assert.equal(plan.unchanged, 1, 'the unchanged member is left alone');

  await applyRestore(live, await readTeam(backup, 'T1'), plan);
  const after = await readTeam(live, 'T1');
  assert.equal(after['teams/T1/tasks/a'].name, 'Wing CAD');
  assert.ok(after['teams/T1/tasks/b'] && !after['teams/T1/tasks/junk']);
  assert.equal(after['teams/T1/tasks/a'].at.toMillis(), 1700000000000, 'timestamps survive');
  assert.equal((await live.doc('teams/T2/tasks/x').get()).data().name, 'Keep me', 'other teams untouched');
  const again = planRestore(after, await readTeam(backup, 'T1'));
  assert.equal(again.write.length + again.del.length, 0, 'running it twice changes nothing');
});

test('the command line previews, saves a snapshot, applies, and can undo from the snapshot', async () => {
  await put(backup, 'teams/T3', { name: 'Robot arm' });
  await put(backup, 'teams/T3/tasks/t', { name: 'Servo test' });
  await put(live, 'teams/T3', { name: 'Robot arm (broken)' });
  const dir = fs.mkdtempSync(os.tmpdir() + '/restore-'); const snap = dir + '/before.json';
  const run = (...a) => execFileSync(process.execPath, ['tools/ops/restore-team.mjs', '--project', PROJECT, '--team', 'T3', ...a], { encoding: 'utf8', env: process.env });
  const preview = run('--from', 'restore-test', '--out', snap);
  assert.match(preview, /Would write 2 \(new or changed\), delete 0/);
  assert.match(preview, /Preview only/);
  assert.equal((await live.doc('teams/T3').get()).data().name, 'Robot arm (broken)', 'preview changes nothing');
  assert.ok(fs.existsSync(snap));
  assert.match(run('--from', 'restore-test', '--out', dir + '/b2.json', '--apply'), /✓ Restored/);
  assert.equal((await live.doc('teams/T3').get()).data().name, 'Robot arm');
  assert.match(run('--from-file', snap, '--out', dir + '/b3.json', '--apply'), /✓ Restored/);
  assert.equal((await live.doc('teams/T3').get()).data().name, 'Robot arm (broken)', 'the snapshot undoes the restore');
  assert.ok(!(await live.doc('teams/T3/tasks/t').get()).exists);
});
