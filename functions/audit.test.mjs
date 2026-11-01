// The audit trail Cloud Function (functions/audit.js) against a small in-memory Firestore:
// numbering, the hash chain, who did it, repeated deliveries, and what is never audited.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordWrite } from './audit.js';
import { verifyChain } from './auditlib.js';

function fakeDb() {
  const docs = new Map();
  const ref = (path) => ({
    path,
    collection: (c) => ({ doc: (id) => ref(path + '/' + c + '/' + (id || 'auto' + docs.size)) }),
  });
  const snap = (path) => { const d = docs.get(path); return { exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined), get: (f) => (d ? d[f] : undefined) }; };
  let running = Promise.resolve();
  return {
    docs,
    collection: (c) => ({ doc: (id) => ref(c + '/' + (id || 'auto' + docs.size)) }),
    // one transaction at a time, like Firestore's retries would end up
    runTransaction(fn) {
      const run = running.then(async () => {
        const writes = [];
        const out = await fn({ get: async (r) => snap(r.path), set: (r, d) => writes.push([r.path, structuredClone(d)]) });
        writes.forEach(([p, d]) => docs.set(p, d));
        return out;
      });
      running = run.catch(() => {});
      return run;
    },
  };
}
const change = (before, after) => ({ before: { exists: !!before, data: () => before }, after: { exists: !!after, data: () => after } });
const ev = (id, before, after, authType = 'app_user', authId = 'u1', time = '2026-11-01T10:00:00Z') => ({ id, time, authType, authId, data: change(before, after) });
const entries = (db, team = 't1') => [...db.docs].filter(([p]) => p.startsWith('teams/' + team + '/audit/')).map(([, d]) => d);

test('audit function: entries are numbered, chained and name the person', async () => {
  const db = fakeDb();
  db.docs.set('teams/t1/members/u1', { name: 'Asha Patel', roleId: 'owner' });
  await recordWrite(db, ev('e1', null, { name: 'Gearbox CAD', flag: 'none' }), 't1', 'tasks', 'k1');
  await recordWrite(db, ev('e2', { name: 'Gearbox CAD', flag: 'none' }, { name: 'Gearbox CAD', flag: 'completed' }), 't1', 'tasks', 'k1');
  await recordWrite(db, ev('e3', { name: 'Gearbox CAD' }, null), 't1', 'tasks', 'k1');
  const list = entries(db).sort((a, b) => a.seq - b.seq);
  assert.deepEqual(list.map(e => [e.seq, e.action]), [[1, 'create'], [2, 'update'], [3, 'delete']]);
  assert.equal(list[1].actor.name, 'Asha Patel');
  assert.deepEqual(list[1].changes, [{ f: 'flag', from: 'none', to: 'completed' }]);
  assert.equal(list[0].at, Date.parse('2026-11-01T10:00:00Z'));
  assert.deepEqual(db.docs.get('teams/t1/private/auditHead'), { seq: 3, hash: list[2].hash, at: list[2].at });
  assert.equal(verifyChain(list).ok, true);
});

test('audit function: a repeated delivery of the same event is recorded once', async () => {
  const db = fakeDb();
  const e = ev('same', null, { name: 'Bracket' });
  await recordWrite(db, e, 't1', 'parts', 'p1');
  await recordWrite(db, e, 't1', 'parts', 'p1');
  assert.equal(entries(db).length, 1);
});

test('audit function: many writes at once still give one unbroken chain', async () => {
  const db = fakeDb();
  await Promise.all([...Array(30)].map((_, i) => recordWrite(db, ev('c' + i, null, { name: 'Task ' + i }), 't1', 'tasks', 'k' + i)));
  const list = entries(db);
  assert.equal(list.length, 30);
  assert.deepEqual(list.map(e => e.seq).sort((a, b) => a - b), [...Array(30)].map((_, i) => i + 1));
  assert.equal(verifyChain(list).ok, true);
});

test('audit function: server writes are marked as the server, and the trail never audits itself', async () => {
  const db = fakeDb();
  await recordWrite(db, ev('s1', { flag: 'none' }, { flag: 'completed' }, 'service_account', 'sa@x'), 't1', 'tasks', 'k1');
  assert.equal(entries(db)[0].actor.type, 'server');
  for (const col of ['audit', 'private', 'presence', 'cursors']) assert.equal(await recordWrite(db, ev('x' + col, null, { a: 1 }), 't1', col, 'd'), null);
  assert.equal(entries(db).length, 1);
  // teams keep separate chains
  await recordWrite(db, ev('o1', null, { name: 'Other' }), 't2', 'tasks', 'k1');
  assert.equal(entries(db, 't2')[0].seq, 1);
});

test('audit function: a member who joins is named from their own new membership', async () => {
  const db = fakeDb();
  await recordWrite(db, ev('j1', null, { name: 'Ben Ode', roleId: 'member', uid: 'u2' }, 'app_user', 'u2'), 't1', 'members', 'u2');
  assert.equal(entries(db)[0].actor.name, 'Ben Ode');
});
