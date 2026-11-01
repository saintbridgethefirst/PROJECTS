// Audit trail: hashing, change lists, the chain and tamper checks (functions/auditlib.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256, canonical, docHash, auditChanges, auditEntry, auditActor, chainEntry, verifyChain, auditCsv, audited, auditLabel } from '../functions/auditlib.js';

const nodeHash = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

test('audit: sha256 matches node:crypto, including multi-block and non-ASCII text', () => {
  const samples = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'Prüfstand — 試験 ✓ 🤖', JSON.stringify({ x: 1, y: [1, 2, 3] })];
  for (const s of samples) assert.equal(sha256(s), nodeHash(s), JSON.stringify(s.slice(0, 20)));
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('audit: canonical form ignores key order and turns Firestore types into plain values', () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), canonical({ a: { c: 3, d: 2 }, b: 1 }));
  assert.equal(canonical({ t: { toMillis: () => 42 } }), '{"t":42}');
  assert.equal(canonical({ a: undefined, b: NaN }), '{"b":null}');
  assert.equal(docHash(null), '');
  assert.equal(docHash({ a: 1, b: 2 }), docHash({ b: 2, a: 1 }));
});

test('audit: change list keeps short before/after for simple values, one level deep', () => {
  const before = { name: 'Gearbox CAD', flag: 'pending', updatedAt: 1, updatedBy: 'A', signoff: { status: 'waiting', by: 'u1' }, subtasks: [{ t: 'x' }] };
  const after = { name: 'Gearbox CAD', flag: 'completed', updatedAt: 2, updatedBy: 'B', signoff: { status: 'approved', by: 'u1' }, subtasks: [{ t: 'y' }] };
  assert.deepEqual(auditChanges(before, after), [
    { f: 'flag', from: 'pending', to: 'completed' },
    { f: 'signoff.status', from: 'waiting', to: 'approved' },
    { f: 'subtasks' },
  ]);
  // bookkeeping alone is not a change
  assert.deepEqual(auditChanges({ a: 1, updatedAt: 1 }, { a: 1, updatedAt: 2 }), []);
  // long values are cut, very long change lists are capped
  const long = auditChanges({ note: 'x' }, { note: 'y'.repeat(500) });
  assert.ok(long[0].to.length <= 160 && long[0].to.endsWith('…'));
  const many = auditChanges(Object.fromEntries([...Array(40)].map((_, i) => ['k' + i, 0])), Object.fromEntries([...Array(40)].map((_, i) => ['k' + i, 1])));
  assert.equal(many.length, 26); assert.equal(many.at(-1).f, '…');
});

test('audit: entries say what happened, to what, by whom', () => {
  const actor = auditActor('app_user', 'u1', 'Asha');
  assert.deepEqual(actor, { type: 'person', uid: 'u1', name: 'Asha' });
  assert.equal(auditActor('service_account', 'x').type, 'server');
  assert.equal(auditActor('unauthenticated').type, 'unknown');
  const c = auditEntry({ col: 'tasks', docId: 't1', before: null, after: { name: 'Mill bracket' }, actor, at: 1000 });
  assert.equal(c.action, 'create'); assert.equal(c.label, 'Mill bracket'); assert.equal(c.docHash, docHash({ name: 'Mill bracket' }));
  const d = auditEntry({ col: 'tasks', docId: 't1', before: { name: 'Mill bracket' }, after: null, actor, at: 2000 });
  assert.equal(d.action, 'delete'); assert.equal(d.label, 'Mill bracket'); assert.equal(d.docHash, '');
  assert.equal(auditLabel('team', {}, 'x'), 'Team');
  assert.ok(audited('tasks') && !audited('audit') && !audited('private') && !audited('presence') && !audited('cursors'));
});

function chainOf(n) {
  const out = []; let head = null;
  for (let i = 0; i < n; i++) {
    const e = chainEntry(auditEntry({ col: 'tasks', docId: 't' + i, before: { flag: 'none' }, after: { flag: 'completed' }, actor: auditActor('app_user', 'u1', 'Asha'), at: 1000 + i }), head);
    out.push(e); head = e;
  }
  return out;
}

test('audit: a clean chain checks out, in any order, with document ids added by the reader', () => {
  const list = chainOf(6);
  assert.deepEqual(list.map(e => e.seq), [1, 2, 3, 4, 5, 6]);
  assert.equal(list[0].prevHash, '');
  assert.equal(list[3].prevHash, list[2].hash);
  const r = verifyChain([...list].reverse().map((e, i) => ({ ...e, id: 'doc' + i })));
  assert.deepEqual(r, { ok: true, checked: 6, from: 1, to: 6, problem: null });
  // a later window (newest 3) also checks out
  assert.equal(verifyChain(list.slice(3)).ok, true);
  assert.equal(verifyChain([]).ok, true);
});

test('audit: editing, removing or re-linking an entry is caught at that entry', () => {
  const list = chainOf(6);
  const edited = list.map(e => (e.seq === 3 ? { ...e, actor: { ...e.actor, name: 'Someone else' } } : e));
  assert.deepEqual(verifyChain(edited).problem, { seq: 3, why: 'This entry was changed after it was written.' });
  const gap = list.filter(e => e.seq !== 4);
  assert.equal(verifyChain(gap).problem.seq, 5); assert.match(verifyChain(gap).problem.why, /4 are missing/);
  // a forger who rewrites entry 4 and recomputes its own hash still breaks the link to entry 5
  const { hash: _h, ...b4 } = list[3];
  const forged4 = chainEntry({ ...b4, changes: [] }, list[2]);
  const forged = list.map(e => (e.seq === 4 ? forged4 : e));
  assert.deepEqual(verifyChain(forged).problem, { seq: 5, why: 'This entry doesn’t follow on from the one before.' });
  const fakeFirst = [{ ...list[0], prevHash: 'abc' }];
  assert.equal(verifyChain(fakeFirst).ok, false);
});

test('audit: CSV export is newest first and safe to open in a spreadsheet', () => {
  const list = chainOf(2);
  list[1].label = '=HYPERLINK("http://evil")';
  const csv = auditCsv(list).split('\r\n');
  assert.equal(csv.length, 3);
  assert.match(csv[0], /^Number,When \(UTC\),Who/);
  assert.match(csv[1], /^2,/);
  assert.ok(csv[1].includes(`"'=HYPERLINK(""http://evil"")"`));
  assert.ok(csv[2].includes('flag: none → completed'));
});
