// Runs the shared scenarios against the REAL firestore.rules in the Firebase emulator.
//   npm run test:rules        (needs Java 11+; first run downloads the emulator)
import test, { before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, writeBatch, query, where, collectionGroup, updateDoc } from 'firebase/firestore';
import { fixture, users, writeScenarios, readScenarios, TEAM } from './scenarios.mjs';

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-teamtrack', firestore: { rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [tid, T] of Object.entries(fixture().teams)) {
      await setDoc(doc(db, 'teams', tid), T.doc);
      for (const c of Object.keys(T).filter(k => k !== 'doc')) for (const [id, d] of Object.entries(T[c] || {})) await setDoc(doc(db, 'teams', tid, c, id), d);
    }
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

test('rules (read): I can list my own SelfTrack items', async () => {
  await assertSucceeds(getDocs(query(collection(dbFor('owner'), 'selfItems'), where('uid', '==', 'owner'))));
});
test('rules (read): nobody can list or read someone else’s SelfTrack items', async () => {
  await assertFails(getDocs(query(collection(dbFor('evil'), 'selfItems'), where('uid', '==', 'owner'))));
  await assertFails(getDoc(doc(dbFor('evil'), 'selfItems', 's_owner')));
  await assertFails(getDocs(collection(dbFor('evil'), 'selfItems')));
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
test('rules: I can save my navigation, top or side only', async () => {
  await assertSucceeds(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { nav: 'side', updatedAt: 1 }, { merge: true }));
  await assertFails(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { nav: 'bottom', updatedAt: 1 }));
  await assertFails(setDoc(doc(dbFor('admin1'), 'users', 'mem1'), { nav: 'side', updatedAt: 1 }, { merge: true }));
});
test('rules: a profile only holds a small photo', async () => {
  await assertFails(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { photo: 'x'.repeat(70000), updatedAt: 1 }));
  await assertFails(setDoc(doc(dbFor('mem1'), 'users', 'mem1'), { photo: '', isAdmin: true }));
});
test('rules: nobody in the app reads or writes the GitHub webhook secret', async () => {
  await assertFails(getDoc(doc(dbFor('owner'), 'teams', TEAM, 'private', 'github')));
  await assertFails(setDoc(doc(dbFor('owner'), 'teams', TEAM, 'private', 'github'), { secret: 'mine' }));
});

// Live cursors: each member writes only their own small cursor document.
const cursor = (extra = {}) => ({ at: Date.now(), a: 't:task1', fx: 0.5, fy: 0.5, view: 'board', name: 'Mem One', ...extra });
test('rules: a member writes their own live cursor', async () => {
  await assertSucceeds(setDoc(doc(dbFor('mem1'), 'teams', TEAM, 'cursors', users.mem1.uid), cursor()));
});
test('rules: a member cannot write someone else’s cursor', async () => {
  await assertFails(setDoc(doc(dbFor('mem1'), 'teams', TEAM, 'cursors', users.owner.uid), cursor()));
});
test('rules: a cursor with extra fields is refused', async () => {
  await assertFails(setDoc(doc(dbFor('mem1'), 'teams', TEAM, 'cursors', users.mem1.uid), cursor({ email: 'x@y.com' })));
});
test('rules: someone outside the team cannot write a cursor', async () => {
  await assertFails(setDoc(doc(dbFor('evil'), 'teams', TEAM, 'cursors', users.evil.uid), cursor()));
});
test('rules (read): members see cursors, outsiders do not', async () => {
  await assertSucceeds(getDocs(collection(dbFor('mem1'), 'teams', TEAM, 'cursors')));
  await assertFails(getDocs(collection(dbFor('evil'), 'teams', TEAM, 'cursors')));
});

// Security hardening: stored-XSS and bloat defences (added in the security-fixes pass).
const wbItem = (extra = {}) => ({ boardId: 'b1', kind: 'pen', x: 0, y: 0, w: 100, h: 80, text: '', path: '0,0 1,1', createdBy: 'owner', ...extra });
test('rules: a whiteboard pen path of real coordinates is allowed', async () => {
  await assertSucceeds(setDoc(doc(dbFor('owner'), 'teams', TEAM, 'wbItems', 'w_ok'), wbItem()));
});
test('rules: a whiteboard pen path carrying markup is refused', async () => {
  await assertFails(setDoc(doc(dbFor('owner'), 'teams', TEAM, 'wbItems', 'w_evil'), wbItem({ path: '0,0"><image href=x onerror=alert(1)>' })));
});

const part = (extra = {}) => ({ name: 'Bolt', qty: 1, unitCost: 1, status: 'needed', notes: '', createdBy: 'owner', createdAt: Date.now(), ...extra });
test('rules: a part with an https supplier link is allowed; javascript: is refused', async () => {
  await assertSucceeds(setDoc(doc(dbFor('owner'), 'teams', TEAM, 'parts', 'p_ok'), part({ url: 'https://supplier.example/x' })));
  await assertFails(setDoc(doc(dbFor('owner'), 'teams', TEAM, 'parts', 'p_evil'), part({ url: 'javascript:alert(1)' })));
});

const paper = (extra = {}) => ({ title: 'P', authors: '', notes: '', tags: [], status: 'to-read', taskIds: [], addedBy: 'owner', createdAt: Date.now(), ...extra });
test('rules: a paper link must be http(s)', async () => {
  await assertSucceeds(setDoc(doc(dbFor('owner'), 'teams', TEAM, 'papers', 'r_ok'), paper({ url: 'https://doi.org/x' })));
  await assertFails(setDoc(doc(dbFor('owner'), 'teams', TEAM, 'papers', 'r_evil'), paper({ url: 'javascript:alert(1)' })));
});

const expense = (extra = {}) => ({ kind: 'expense', amount: 1, date: '2026-01-01', description: 'x', createdBy: 'owner', createdAt: Date.now(), ...extra });
test('rules: an expense receipt link must be http(s)', async () => {
  await assertSucceeds(setDoc(doc(dbFor('owner'), 'teams', TEAM, 'expenses', 'e_ok'), expense({ receiptUrl: 'https://r.example/x' })));
  await assertFails(setDoc(doc(dbFor('owner'), 'teams', TEAM, 'expenses', 'e_evil'), expense({ receiptUrl: 'data:text/html,<script>' })));
});

test('rules: a member display name over 80 characters is refused', async () => {
  const base = { uid: 'owner', email: 'owner@x.com', name: 'owner', photo: '', roleId: 'owner', joinedAt: 1 };
  await assertSucceeds(setDoc(doc(dbFor('owner'), 'teams', TEAM, 'members', 'owner'), { ...base, name: 'A reasonable name' }));
  await assertFails(setDoc(doc(dbFor('owner'), 'teams', TEAM, 'members', 'owner'), { ...base, name: 'x'.repeat(200) }));
});

// Auto carry-over settings on the team doc (added in the carry-over feature).
test('rules: the owner can turn on auto carry-over', async () => {
  await assertSucceeds(updateDoc(doc(dbFor('owner'), 'teams', TEAM), { autos: { partsTo: '', tellWaiting: false, remindDays: 0, carry: true, carryWarn: 3, carryMakeWeeks: true } }));
});
test('rules: a carryWarn out of range is refused', async () => {
  await assertFails(updateDoc(doc(dbFor('owner'), 'teams', TEAM), { autos: { partsTo: '', tellWaiting: false, remindDays: 0, carry: true, carryWarn: 99, carryMakeWeeks: false } }));
});
test('rules: a member without team.settings cannot change autos', async () => {
  await assertFails(updateDoc(doc(dbFor('mem1'), 'teams', TEAM), { autos: { partsTo: '', tellWaiting: false, remindDays: 0, carry: true, carryWarn: 3, carryMakeWeeks: false } }));
});
