// Runs the shared scenarios against the REAL firestore.rules in the Firebase emulator.
//   npm run test:rules        (needs Java 11+; first run downloads the emulator)
import test, { before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, writeBatch, query, where, collectionGroup } from 'firebase/firestore';
import { fixture, users, writeScenarios, readScenarios, TEAM } from './scenarios.mjs';

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
    for (const c of Object.keys(T).filter(k => k !== 'doc')) for (const [id, d] of Object.entries(T[c] || {})) await setDoc(doc(db, 'teams', TEAM, c, id), d);
    for (const uid of Object.keys(fixture().admins || {})) await setDoc(doc(db, 'admins', uid), { since: 1 });
    for (const [c, docs] of Object.entries(fixture().root || {})) for (const [id, d] of Object.entries(docs)) await setDoc(doc(db, c, id), d);
  });
});
const dbFor = (who) => (who ? env.authenticatedContext(users[who].uid, { email: users[who].email, email_verified: users[who].emailVerified }) : env.unauthenticatedContext()).firestore();
const ref = (db, teamId, path) => (path === 'team' ? doc(db, 'teams', teamId) : path.startsWith('/') ? doc(db, ...path.slice(1).split('/')) : doc(db, 'teams', teamId, ...path.split('/')));

for (const [name, who, teamId, ops, expected] of writeScenarios) {
  test('rules: ' + name, async () => {
    const db = dbFor(who); const b = writeBatch(db);
    ops.forEach(op => { const r = ref(db, teamId, op.path); if (op.type === 'delete') b.delete(r); else if (op.type === 'set') b.set(r, op.data); else b.update(r, op.data); });
    await (expected === 'allow' ? assertSucceeds(b.commit()) : assertFails(b.commit()));
  });
}
for (const [name, who, what, expected] of readScenarios) {
  test('rules (read): ' + name, async () => {
    const db = dbFor(who);
    const p = what === 'team' ? getDoc(doc(db, 'teams', TEAM)) : getDocs(collection(db, 'teams', TEAM, 'tasks'));
    await (expected === 'allow' ? assertSucceeds(p) : assertFails(p));
  });
}
test('rules (read): I can list my own memberships across teams', async () => {
  await assertSucceeds(getDocs(query(collectionGroup(dbFor('mem1'), 'members'), where('uid', '==', 'mem1'))));
});
test('rules (read): I cannot list other people’s memberships', async () => {
  await assertFails(getDocs(query(collectionGroup(dbFor('mem1'), 'members'), where('uid', '==', 'owner'))));
});
test('rules (read): a verified invitee sees their invitation', async () => {
  await assertSucceeds(getDocs(query(collectionGroup(dbFor('newbie'), 'invites'), where('email', '==', 'new@x.com'))));
});
test('rules (read): an unverified account cannot see invitations', async () => {
  await assertFails(getDocs(query(collectionGroup(dbFor('newbieUnverified'), 'invites'), where('email', '==', 'new@x.com'))));
});
test('rules (read): nobody can list invitations for another address', async () => {
  await assertFails(getDocs(query(collectionGroup(dbFor('evil'), 'invites'), where('email', '==', 'new@x.com'))));
});

test('rules: I can save my own profile photo', async () => {
  await assertSucceeds(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { photo: 'data:image/png;base64,AAAA', updatedAt: 1 }));
});
test('rules: I cannot write or read someone else’s profile', async () => {
  await assertFails(setDoc(doc(dbFor('mem1'), 'users', 'owner'), { photo: '', updatedAt: 1 }));
  await assertFails(getDoc(doc(dbFor('mem1'), 'users', 'owner')));
});
test('rules: I can save my theme, and it stays short text', async () => {
  await assertSucceeds(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { theme: 'ocean', updatedAt: 1 }, { merge: true }));
  await assertFails(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { theme: 'x'.repeat(41), updatedAt: 1 }));
  await assertFails(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { theme: 3, updatedAt: 1 }));
});
test('rules: I can save my menu style, list or circle only', async () => {
  await assertSucceeds(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { menuStyle: 'circle', updatedAt: 1 }, { merge: true }));
  await assertFails(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { menuStyle: 'triangle', updatedAt: 1 }));
});
test('rules: a profile only holds a small photo', async () => {
  await assertFails(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { photo: 'x'.repeat(70000), updatedAt: 1 }));
  await assertFails(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { photo: '', isAdmin: true }));
});
