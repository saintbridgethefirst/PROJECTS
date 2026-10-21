// Sign-offs and checklists (workflow step 2): who signs off, gates, checklists, and the save check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanWorkflow, signersFor, canSignStage, gateOnTheWay, checklistOf, cleanSignoff, cleanChecks, isCustomWorkflow, DEFAULT_STAGES } from '../src/model.js';
import { deniedChanges } from '../src/sync.js';
import { DEFAULT_ROLES } from '../src/permissions.js';

const WF = cleanWorkflow({ stages: [
  { id: 'design', name: 'Design' },
  { id: 'review', name: 'Review', kind: 'doing', signoff: 'lead', checklist: [{ id: 'r1', text: 'CAD shared' }, { id: 'r2', text: 'Mass budget' }] },
  { id: 'build', name: 'Build', kind: 'doing' },
  { id: 'test', name: 'Test', kind: 'doing', signoff: 'person', signer: 'priya' },
  { id: 'done', name: 'Done' },
] });
const members = [
  { uid: 'aisha', name: 'Aisha Khan', roleId: 'owner' }, { uid: 'ben', name: 'Ben Owusu', roleId: 'admin' },
  { uid: 'lea', name: 'Lea Moss', roleId: 'member' }, { uid: 'tom', name: 'Tom Reed', roleId: 'member' }, { uid: 'priya', name: 'Priya Nair', roleId: 'member' },
];
const team = { ownerUid: 'aisha', roles: DEFAULT_ROLES, workflow: WF, subteams: [{ id: 'gear', name: 'Landing gear', members: ['tom', 'lea'], leads: ['lea'] }, { id: 'sw', name: 'Software', members: ['lea'], leads: ['lea'] }] };
const me = (uid) => ({ uid, roleId: members.find(m => m.uid === uid).roleId });
const review = WF.stages[1], test_ = WF.stages[3];

test('stages keep who signs off and their checklist; sign-offs make a workflow custom', () => {
  assert.equal(review.signoff, 'lead'); assert.equal(review.checklist.length, 2); assert.equal(test_.signer, 'priya');
  assert.equal(WF.stages[4].signoff, '', 'Done never needs a sign-off');
  assert.equal(cleanWorkflow({ stages: [{ id: 'a', name: 'A', signoff: 'boss' }, { id: 'b', name: 'B' }] }).stages[0].signoff, '', 'unknown kinds are dropped');
  assert.ok(isCustomWorkflow(DEFAULT_STAGES.map((s, i) => (i === 1 ? { ...s, signoff: 'admin' } : s))));
  const many = cleanWorkflow({ stages: [{ id: 'a', name: 'A', checklist: Array.from({ length: 12 }, (_, i) => ({ text: 'Item ' + i })) }, { id: 'b', name: 'B' }] });
  assert.equal(many.stages[0].checklist.length, 8, 'at most 8 checklist items');
});

test('who signs off: the sub-team lead, never yourself, the team owner always', () => {
  const s = signersFor(review, team, members, 'tom');
  assert.deepEqual(s.uids.sort(), ['aisha', 'lea']); assert.equal(s.label, 'Lea Moss (Landing gear lead)');
  // Lea leads her own sub-teams: her task goes to an admin instead
  const own = signersFor(review, team, members, 'lea');
  assert.ok(own.fallback && own.uids.includes('ben') && !own.uids.includes('lea') && own.label.includes('own sub-team'));
  // No sub-team at all: the admins
  assert.ok(signersFor(review, team, members, 'priya').label.includes('no sub-team lead'));
  assert.equal(signersFor(test_, team, members, 'tom').label, 'Priya Nair');
  assert.ok(canSignStage(review, team, me('lea'), 'tom')); assert.ok(!canSignStage(review, team, me('tom'), 'tom'), 'not your own task');
  assert.ok(!canSignStage(review, team, me('priya'), 'tom'), 'not someone else’s sub-team');
  assert.ok(canSignStage(review, team, me('aisha'), 'aisha'), 'the team owner can always sign off');
  assert.ok(canSignStage(test_, team, me('priya'), 'tom') && canSignStage(test_, team, me('ben'), 'tom') && !canSignStage(test_, team, me('lea'), 'tom'), 'the named person, or an admin stepping in');
});

test('gates: moving forward past a stage that needs a sign-off, never moving back', () => {
  const t = { stage: 'review' };
  assert.equal(gateOnTheWay(t, WF.stages, 'review', 'build').id, 'review');
  assert.equal(gateOnTheWay(t, WF.stages, 'design', 'build').id, 'review', 'skipping over it counts');
  assert.equal(gateOnTheWay(t, WF.stages, 'design', 'review'), null, 'moving into it is fine');
  assert.equal(gateOnTheWay(t, WF.stages, 'build', 'design'), null, 'moving back is fine');
  assert.equal(gateOnTheWay({ signoff: { stage: 'review', status: 'approved' } }, WF.stages, 'review', 'build'), null, 'approved');
  assert.equal(gateOnTheWay({ signoff: { stage: 'review', status: 'approved' } }, WF.stages, 'review', 'done').id, 'test', 'the next gate still applies');
  assert.equal(gateOnTheWay({ signoff: { stage: 'review', status: 'waiting' } }, WF.stages, 'review', 'build').id, 'review', 'waiting isn’t approved');
});

test('checklists: progress on the current stage', () => {
  assert.deepEqual(checklistOf({ checks: { r1: true, zz: true } }, review), { done: 1, total: 2, items: [{ id: 'r1', text: 'CAD shared', done: true }, { id: 'r2', text: 'Mass budget', done: false }] });
  assert.deepEqual(cleanChecks({ r1: true, r2: false, 'bad id': true }), { r1: true });
  assert.equal(cleanSignoff({ status: 'maybe' }), null);
  assert.equal(cleanSignoff({ status: 'changes', note: 'x'.repeat(900) }).note.length, 500);
});

const task = (over) => ({ name: 'Leg v2', ownerUid: 'tom', categoryId: 'c_tom', stage: 'review', flag: 'none', ...over });
test('the save check: no moving past a sign-off without it; the approver may record a decision', () => {
  const tom = { uid: 'tom', roleId: 'member' }, lea = { uid: 'lea', roleId: 'member' };
  const move = (by, before, after) => deniedChanges([{ kind: 'task', id: 'x', before: task(before), after: task(after) }], team, by);
  assert.match(move(tom, {}, { stage: 'build' }).join(), /past “Review”/, 'Tom can’t move his task past Review');
  assert.match(move(tom, { stage: 'design' }, { flag: 'completed' }).join(), /past “Review”/, 'nor jump to Done');
  assert.deepEqual(move(tom, { stage: 'design' }, { stage: 'review' }), [], 'into Review is fine');
  assert.deepEqual(move(tom, {}, { stage: 'build', signoff: { stage: 'review', status: 'approved' } }), [], 'once approved');
  const waiting = { stage: 'review', status: 'waiting', by: 'tom' };
  assert.deepEqual(move(lea, { signoff: waiting }, { stage: 'build', signoff: { stage: 'review', status: 'approved', approver: 'lea' } }), [], 'Lea approves Tom’s task (which she can’t otherwise edit)');
  assert.match(move(lea, { signoff: waiting }, { name: 'Hacked', signoff: { stage: 'review', status: 'approved', approver: 'lea' } }).join(), /edit this task/, 'but changes nothing else');
  assert.match(move(lea, {}, { stage: 'build', signoff: { stage: 'review', status: 'approved', approver: 'lea' } }).join(), /edit this task/, 'and only when it was sent to her');
});

test('workflowIndex: next sign-off position for each stage (what the security rules read)', async () => {
  const { workflowIndex } = await import('../src/model.js');
  const st = (id, signoff = '') => ({ id, signoff });
  const w = workflowIndex([st('a'), st('b', 'lead'), st('c'), st('d', 'admin'), st('e')]);
  assert.deepEqual(w.next, [1, 1, 3, 3, 5, 5]);
  assert.deepEqual(workflowIndex([st('a'), st('b')]).next, [2, 2, 2]);
  assert.deepEqual(workflowIndex([st('a', 'person'), st('b', 'lead'), st('c')]).next, [0, 1, 3, 3]);
});
