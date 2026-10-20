// Download my data / delete my account / hand a team over, against the Firestore emulator.
//   npm run test:ops        (needs Java; runs in GitHub Actions)
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { exportUserData, deleteUserData, transferOwnership, teamsToHandOver } from '../functions/privacy.js';

const app = getApps()[0] || initializeApp({ projectId: 'demo-teamtrack' });
const db = getFirestore(app);
const put = (p, d) => db.doc(p).set(d);
const exists = async (p) => (await db.doc(p).get()).exists;
const tom = { uid: 'uTom', email: 'tom@uni.ac.uk', displayName: 'Tom Reed' };

const wipe = async () => { for (const c of ['teams', 'users', 'verifiedStudents', 'eduClaims', 'feedback', 'clientErrors', 'studentEmails', 'inviteQuota']) await db.recursiveDelete(db.collection(c)); };
after(wipe);
beforeEach(async () => {
  for (const c of ['teams', 'users', 'verifiedStudents', 'eduClaims', 'feedback', 'clientErrors', 'studentEmails', 'inviteQuota']) await db.recursiveDelete(db.collection(c));
  // Aisha's team, Tom is a member
  await put('teams/PV1', { name: 'Skyhawk', ownerUid: 'uAisha', roles: { owner: {}, admin: {}, member: {} } });
  await put('teams/PV1/members/uAisha', { uid: 'uAisha', email: 'aisha@uni.ac.uk', name: 'Aisha Khan', roleId: 'owner' });
  await put('teams/PV1/members/uTom', { uid: 'uTom', email: 'tom@uni.ac.uk', name: 'Tom Reed', roleId: 'member' });
  await put('teams/PV1/profiles/uTom', { capacity: 10, skills: ['CAD'] });
  await put('teams/PV1/tasks/t1', { name: 'Gearbox', ownerUid: 'uTom', createdBy: 'uTom', updatedBy: 'Tom Reed', history: [{ user: 'Tom Reed', field: 'Title' }, { user: 'Aisha Khan', field: 'Due' }] });
  await put('teams/PV1/tasks/t2', { name: 'Wing', ownerUid: 'uAisha', createdBy: 'uAisha', updatedBy: 'Aisha Khan', history: [] });
  await put('teams/PV1/comments/c1', { taskId: 't2', authorUid: 'uTom', authorName: 'Tom Reed', text: 'Torque is fine', mentions: ['uAisha'] });
  await put('teams/PV1/requests/pro', { by: 'uTom', byName: 'Tom Reed', email: 'tom@uni.ac.uk', wants: 'pro', status: 'open' });
  // Tom's own team, only him
  await put('teams/PV2', { name: 'Tom solo', ownerUid: 'uTom' });
  await put('teams/PV2/members/uTom', { uid: 'uTom', email: 'tom@uni.ac.uk', name: 'Tom Reed', roleId: 'owner' });
  await put('teams/PV2/tasks/x', { name: 'Notes', ownerUid: 'uTom' });
  // An invitation to Tom from a third team, and his private records
  await put('teams/PV3', { name: 'Other', ownerUid: 'uZed' });
  await put('teams/PV3/invites/tom@uni.ac.uk', { email: 'tom@uni.ac.uk', roleId: 'member', invitedBy: 'uZed' });
  await put('users/uTom', { photo: '', theme: 'mint' });
  await put('verifiedStudents/uTom', { email: 'tr123@bristol.ac.uk', until: 1 });
  await put('studentEmails/key1', { uid: 'uTom', at: 1 });
  await put('feedback/f1', { uid: 'uTom', text: 'Nice', email: 'tom@uni.ac.uk' });
  await put('clientErrors/e1', { uid: 'uTom', msg: 'x' });
  await put('inviteQuota/uTom_2026-10-20', { n: 1 });
  await put('feedback/f2', { uid: 'uAisha', text: 'Hers' });
});

test('download my data: profile, private records, invitations and what is mine in each team', async () => {
  const d = await exportUserData(db, tom);
  assert.equal(d.profile.theme, 'mint');
  assert.equal(d.studentVerification.email, 'tr123@bristol.ac.uk');
  assert.equal(d.feedbackYouSent.length, 1); assert.equal(d.errorReportsFromYourBrowser.length, 1);
  assert.equal(d.invitationsToYou[0].teamId, 'PV3');
  const sky = d.teams.find(t => t.teamId === 'PV1');
  assert.equal(sky.yourMembership.roleId, 'member'); assert.equal(sky.yourProfileInTeam.capacity, 10);
  assert.deepEqual(sky.yours.tasks.map(t => t.id), ['t1']);
  assert.equal(sky.yours.comments[0].text, 'Torque is fine');
  assert.ok(!JSON.stringify(d).includes('Hers'), 'nothing of other people’s private records');
});

test('delete my account: refused while I own a team with other members', async () => {
  await put('teams/PV2/members/uAmy', { uid: 'uAmy', email: 'amy@x.com', name: 'Amy', roleId: 'member' });
  assert.deepEqual((await teamsToHandOver(db, 'uTom')).map(t => t.name), ['Tom solo']);
  await assert.rejects(deleteUserData(db, tom), (e) => e.code === 'owns-teams' && e.teams[0].teamId === 'PV2');
  assert.ok(await exists('users/uTom'), 'nothing was deleted');
});

test('delete my account: everything about me goes; shared work stays, without my name', async () => {
  const s = await deleteUserData(db, tom);
  assert.equal(s.teamsDeleted, 1); assert.equal(s.teamsLeft, 1);
  assert.ok(!(await exists('teams/PV2')) && !(await exists('teams/PV2/tasks/x')), 'my solo team is gone');
  for (const p of ['teams/PV1/members/uTom', 'teams/PV1/profiles/uTom', 'users/uTom', 'verifiedStudents/uTom', 'studentEmails/key1', 'feedback/f1', 'clientErrors/e1', 'inviteQuota/uTom_2026-10-20', 'teams/PV3/invites/tom@uni.ac.uk']) assert.ok(!(await exists(p)), p + ' deleted');
  const t1 = (await db.doc('teams/PV1/tasks/t1').get()).data();
  assert.equal(t1.updatedBy, 'Former member'); assert.deepEqual(t1.history.map(h => h.user), ['Former member', 'Aisha Khan']);
  const c1 = (await db.doc('teams/PV1/comments/c1').get()).data();
  assert.equal(c1.authorName, 'Former member'); assert.equal(c1.text, 'Torque is fine');
  const rq = (await db.doc('teams/PV1/requests/pro').get()).data();
  assert.equal(rq.byName, 'Former member'); assert.equal(rq.email, '');
  assert.equal((await db.doc('teams/PV1/tasks/t2').get()).data().updatedBy, 'Aisha Khan', 'teammates untouched');
  assert.ok(await exists('feedback/f2') && await exists('teams/PV1/members/uAisha'));
});

test('hand a team over: the new owner is owner, the old one becomes an Admin', async () => {
  await put('teams/PV2/members/uAmy', { uid: 'uAmy', email: 'amy@x.com', name: 'Amy', roleId: 'member' });
  await put('teams/PV2', { name: 'Tom solo', ownerUid: 'uTom', roles: { owner: {}, admin: {}, member: {} } });
  await assert.rejects(transferOwnership(db, 'uAmy', 'PV2', 'uAmy'), (e) => e.code === 'invalid-argument');
  await assert.rejects(transferOwnership(db, 'uAmy', 'PV2', 'uTom'), (e) => e.code === 'permission-denied', 'only the owner');
  await assert.rejects(transferOwnership(db, 'uTom', 'PV2', 'uNobody'), (e) => e.code === 'not-found');
  const r = await transferOwnership(db, 'uTom', 'PV2', 'uAmy');
  assert.equal(r.yourRole, 'admin');
  assert.equal((await db.doc('teams/PV2').get()).data().ownerUid, 'uAmy');
  assert.equal((await db.doc('teams/PV2/members/uAmy').get()).data().roleId, 'owner');
  assert.equal((await db.doc('teams/PV2/members/uTom').get()).data().roleId, 'admin');
  assert.deepEqual(await teamsToHandOver(db, 'uTom'), [], 'now Tom can delete his account');
});
