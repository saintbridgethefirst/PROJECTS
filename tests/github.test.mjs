// GitHub sync (functions/ghsync.js): references, branch names, and what each event does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { taskRef, findRefs, branchName, cleanRepo, cleanGithub, newIssueUrl, planGithubEvent, refIdOf } from '../functions/ghsync.js';

const S = { repo: 'uni/rover', issues: true, done: true, owner: 'u1' };
const repo = { full_name: 'uni/rover' };
const A = { id: 't_frame', name: 'Weld the frame', flag: 'none', attachments: [], weekIdx: 0 };
const A2 = { id: 't_frame2', name: 'Weld the frame', carryOf: 't_frame', flag: 'none', attachments: [], weekIdx: 1 };
const B = { id: 't_wheels', name: 'Fit wheels', flag: 'none', attachments: [{ url: 'https://github.com/uni/rover/issues/7' }], weekIdx: 0 };

test('task references: short, stable, distinct, found in any text', () => {
  const r = taskRef('t_frame');
  assert.match(r, /^TT-[A-Z0-9]{6}$/);
  assert.equal(taskRef('t_frame'), r);
  const many = new Set(Array.from({ length: 2000 }, (_, i) => taskRef('t_' + i)));
  assert.ok(many.size > 1990, 'hardly any clashes in 2000 tasks');
  assert.deepEqual(findRefs('Fix motor ' + r.toLowerCase(), 'see ' + r + ' and ' + r), [r]);
  assert.deepEqual(findRefs('TT-12345', 'xtt-abcdef', 'tt-abcdefg'), []);
  assert.equal(refIdOf(A2), 't_frame', 'a carried copy keeps the first copy’s reference');
});
test('branch names, repos and the new-issue link', () => {
  assert.equal(branchName('t_frame', 'Weld the frame!'), taskRef('t_frame').toLowerCase() + '-weld-the-frame');
  assert.equal(cleanRepo('https://github.com/Uni/rover.git'), 'Uni/rover');
  assert.equal(cleanRepo('uni/rover'), 'uni/rover');
  assert.equal(cleanRepo('not a repo'), '');
  assert.deepEqual(cleanGithub({ repo: 'uni/rover' }), { repo: 'uni/rover', issues: true, done: true, owner: '', connectedAt: 0, write: false, last: null });
  const u = newIssueUrl('uni/rover', { title: 'Motor stalls', body: 'At 50% throttle', ref: 'TT-ABC123' });
  assert.ok(u.startsWith('https://github.com/uni/rover/issues/new?title=Motor%20stalls&body=') && decodeURIComponent(u).includes('Penteint Projects: TT-ABC123'));
});
test('pull requests: linked by reference in title, description or branch; merged finishes the task', () => {
  const ref = taskRef('t_frame');
  const pr = (over) => ({ number: 12, title: 'Frame jig', body: '', html_url: 'https://github.com/uni/rover/pull/12', head: { ref: ref.toLowerCase() + '-jig' }, merged: false, ...over });
  let plan = planGithubEvent('pull_request', { action: 'opened', repository: repo, pull_request: pr() }, [A, A2, B], S);
  assert.deepEqual(plan.links.map(l => l.taskId), ['t_frame2'], 'the latest copy of the carried task');
  assert.equal(plan.links[0].attachment.provider, 'github');
  assert.equal(plan.finish.length, 0);
  plan = planGithubEvent('pull_request', { action: 'closed', repository: repo, pull_request: pr({ merged: true }) }, [A, { ...A2, attachments: [{ url: 'https://github.com/uni/rover/pull/12' }] }, B], S);
  assert.deepEqual(plan.links, [], 'already linked');
  assert.deepEqual(plan.finish.map(f => f.taskId), ['t_frame2']);
  plan = planGithubEvent('pull_request', { action: 'closed', repository: repo, pull_request: pr({ merged: false }) }, [A, A2], S);
  assert.equal(plan.finish.length, 0, 'closed without merging: not finished');
  plan = planGithubEvent('pull_request', { action: 'closed', repository: repo, pull_request: pr({ merged: true }) }, [A, A2], { ...S, done: false });
  assert.equal(plan.finish.length, 0, 'the team can switch finishing off');
  plan = planGithubEvent('pull_request', { action: 'opened', repository: { full_name: 'evil/repo' }, pull_request: pr() }, [A], S);
  assert.equal(plan.ok, false, 'another repository is ignored');
});
test('issues: a new one becomes a task, one naming a task is linked to it, closing finishes', () => {
  const is = (over) => ({ number: 9, title: 'Battery gets hot', body: '', html_url: 'https://github.com/uni/rover/issues/9', ...over });
  let plan = planGithubEvent('issues', { action: 'opened', repository: repo, issue: is() }, [A, B], S);
  assert.deepEqual(plan.create, { name: 'Battery gets hot', url: 'https://github.com/uni/rover/issues/9', label: 'Issue #9: Battery gets hot' });
  plan = planGithubEvent('issues', { action: 'opened', repository: repo, issue: is() }, [A, B], { ...S, issues: false });
  assert.equal(plan.create, null, 'switched off');
  plan = planGithubEvent('issues', { action: 'opened', repository: repo, issue: is({ body: 'From the app\n\nPenteint Projects: ' + taskRef('t_wheels') }) }, [A, B], S);
  assert.equal(plan.create, null); assert.deepEqual(plan.links.map(l => l.taskId), ['t_wheels'], 'raised from the app: linked, no duplicate task');
  plan = planGithubEvent('issues', { action: 'closed', repository: repo, issue: is({ number: 7, html_url: 'https://github.com/uni/rover/issues/7' }) }, [A, B], S);
  assert.deepEqual(plan.finish.map(f => f.taskId), ['t_wheels'], 'closing the linked issue finishes the task');
  plan = planGithubEvent('issues', { action: 'closed', repository: repo, issue: is({ number: 7, html_url: 'https://github.com/uni/rover/issues/7', state_reason: 'not_planned' }) }, [A, B], S);
  assert.equal(plan.finish.length, 0, '“not planned” doesn’t count as done');
  assert.equal(planGithubEvent('ping', {}, [], S).why, 'ping');
});

test('writes: links, finishing (not past a sign-off), and where a new issue’s task goes', async () => {
  const { githubOps, newTaskPlace, gateBlocks } = await import('../functions/ghsync.js');
  const stages = [{ id: 'todo' }, { id: 'review', name: 'Review', signoff: 'lead' }, { id: 'done' }];
  const env = { now: 5, today: '2026-10-21', time: '21/Oct/26 9:00 AM', stages, newTask: { categoryId: 'c1', ownerUid: 'u1', weekId: 'w2' }, newId: 't_gh1' };
  const plan = { links: [{ taskId: 'a', attachment: { provider: 'github', name: 'PR #3: x', url: 'https://github.com/u/r/pull/3' } }], finish: [{ taskId: 'a', why: 'pull request #3 merged' }, { taskId: 'b', why: 'issue #2 closed' }], create: { name: 'Bug', url: 'https://github.com/u/r/issues/9', label: 'Issue #9: Bug' } };
  const tasks = [{ id: 'a', name: 'A', flag: 'none', stage: 'todo', attachments: [], history: [] }, { id: 'b', name: 'B', flag: 'none', stage: 'review', signoff: { stage: 'review', status: 'approved' }, attachments: [], history: [] }];
  const { ops, notes } = githubOps(plan, tasks, env);
  const a = ops.find(o => o.path === 'tasks/a').data, b = ops.find(o => o.path === 'tasks/b').data;
  assert.equal(a.attachments.length, 1); assert.equal(a.flag, undefined, 'A waits for its Review sign-off');
  assert.ok(a.history[0].updated.includes('waiting for the Review sign-off')); assert.equal(notes.length, 1);
  assert.equal(b.flag, 'completed'); assert.equal(b.completedDate, '2026-10-21');
  const made = ops.find(o => o.path === 'tasks/t_gh1');
  assert.equal(made.type, 'set'); assert.equal(made.data.ownerUid, 'u1'); assert.equal(made.data.attachments[0].url, 'https://github.com/u/r/issues/9');
  assert.equal(gateBlocks({ stage: 'todo' }, []), null, 'no workflow, no gates');
  const team = { ownerUid: 'o', github: { repo: 'u/r', owner: 'u1' }, weeks: [{ key: 'w1', startDate: '2026-10-12' }, { key: 'w2', startDate: '2026-10-19' }] };
  assert.deepEqual(newTaskPlace(team, [{ id: 'c9', ownerUid: 'u1', order: 2 }, { id: 'c1', ownerUid: 'u1', order: 0 }], '2026-10-21'), { categoryId: 'c1', ownerUid: 'u1', weekId: 'w2' });
  assert.equal(newTaskPlace(team, [], '2026-10-21'), null, 'nowhere to put it');
});
test('webhook signatures', async () => {
  const { signatureOk } = await import('../functions/github.js');
  const crypto = await import('node:crypto');
  const body = Buffer.from('{"zen":"Keep it simple"}');
  const sig = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(body).digest('hex');
  assert.equal(signatureOk('s3cret', body, sig), true);
  assert.equal(signatureOk('wrong', body, sig), false);
  assert.equal(signatureOk('s3cret', body, ''), false);
  assert.equal(signatureOk('s3cret', Buffer.from('{"zen":"changed"}'), sig), false);
});
test('a team’s own reference (the Ref field) links too, as a whole word', async () => {
  const { planGithubEvent } = await import('../functions/ghsync.js');
  const T = [{ id: 't1', name: 'Gear', jiraId: 'DRN-12', flag: 'none', attachments: [] }, { id: 't2', name: 'Other', jiraId: 'DRN-1', flag: 'none', attachments: [] }];
  const plan = planGithubEvent('pull_request', { action: 'opened', repository: { full_name: 'u/r' }, pull_request: { number: 3, title: 'Fix landing gear (drn-12)', body: '', html_url: 'https://github.com/u/r/pull/3', head: { ref: 'fix' } } }, T, { repo: 'u/r' });
  assert.deepEqual(plan.links.map(l => l.taskId), ['t1'], 'DRN-12 matches, DRN-1 doesn’t');
});
test('live state: every event records the issue or PR state on the card, with a history line', async () => {
  const { planGithubEvent, githubOps, stateOf } = await import('../functions/ghsync.js');
  assert.equal(stateOf({ state: 'closed', merged: true }, true), 'merged');
  assert.equal(stateOf({ state: 'open', draft: true }, true), 'draft');
  assert.equal(stateOf({ state: 'closed' }, false), 'closed');
  const url = 'https://github.com/uni/rover/issues/7';
  const T = [{ id: 't_wheels', name: 'Fit wheels', flag: 'none', attachments: [{ provider: 'github', name: 'Issue #7', url, state: 'open' }], history: [] }];
  const plan = planGithubEvent('issues', { action: 'closed', repository: repo, issue: { number: 7, title: 'x', html_url: url, state: 'closed', state_reason: 'duplicate' } }, T, S);
  assert.deepEqual(plan.states[0], { taskId: 't_wheels', url, state: 'closed', reason: 'duplicate', label: 'issue #7' });
  assert.equal(plan.finish.length, 0, 'a duplicate isn’t done');
  const { ops } = githubOps(plan, T, { now: 1, time: 't', today: '2026-10-22', stages: [] });
  const d = ops[0].data;
  assert.equal(d.attachments[0].state, 'closed'); assert.equal(d.attachments[0].reason, 'duplicate');
  assert.equal(d.history[0].field, 'GitHub'); assert.ok(d.history[0].updated.includes('closed (duplicate)'));
  const same = githubOps({ states: [{ taskId: 't_wheels', url, state: 'open', reason: '', label: 'issue #7' }] }, T, { now: 1, time: 't' });
  assert.equal(same.ops.length, 0, 'nothing written when nothing changed');
  const { cleanTask } = await import('../src/model.js');
  const c = cleanTask({ id: 'x', name: 'x', attachments: [{ provider: 'github', url, state: 'merged', reason: 'bogus' }, { provider: 'link', url: 'https://x.y', state: 'open' }] });
  assert.equal(c.attachments[0].state, 'merged'); assert.equal(c.attachments[0].reason, ''); assert.equal(c.attachments[1].state, undefined);
});
test('a renamed repository is followed: links move to the new address, events link again', async () => {
  const { repoRenamed, planGithubEvent } = await import('../functions/ghsync.js');
  const T = [{ id: 'a', name: 'A', flag: 'none', attachments: [{ provider: 'github', url: 'https://github.com/me/TRAWPIE/issues/8', state: 'open' }] }, { id: 'b', name: 'B', attachments: [] }];
  const p = { action: 'opened', repository: { full_name: 'me/TRAWPIE-TeamTrack' }, issue: { number: 11, title: 'X', body: 'Penteint Projects: ' + (await import('../functions/ghsync.js')).taskRef('b'), html_url: 'https://github.com/me/TRAWPIE-TeamTrack/issues/11', state: 'open' } };
  assert.equal(planGithubEvent('issues', p, T, { repo: 'me/TRAWPIE' }).ok, false, 'without following, the event is ignored');
  const m = repoRenamed({ repo: 'me/TRAWPIE' }, p, T);
  assert.equal(m.repo, 'me/TRAWPIE-TeamTrack'); assert.equal(m.ops.length, 1);
  assert.equal(m.ops[0].data.attachments[0].url, 'https://github.com/me/TRAWPIE-TeamTrack/issues/8');
  assert.deepEqual(planGithubEvent('issues', p, T, { repo: m.repo }).links.map(l => l.taskId), ['b'], 'linked after following');
  assert.equal(repoRenamed({ repo: 'me/trawpie-teamtrack' }, p, T), null, 'same name in other letter case: nothing to do');
});

test('issues made before the rename (body says "TeamTrack: TT-…") still link to their task', async () => {
  const { findRefs, taskRef } = await import('../functions/ghsync.js');
  const ref = taskRef('t_old');
  assert.deepEqual([...findRefs('Old issue\n\nTeamTrack: ' + ref)], [ref]);
});

test('public repositories: outsiders can’t make, link or finish tasks', async () => {
  const { planGithubEvent, taskRef, trustedAuthor } = await import('../functions/ghsync.js');
  const pub = { full_name: 'uni/rover', private: false };
  const ref = taskRef('t_frame');
  assert.equal(trustedAuthor({ repository: { full_name: 'x/y' } }, {}), true, 'a private (or unmarked) repository trusts everyone who can post');
  assert.equal(trustedAuthor({ repository: pub }, { author_association: 'COLLABORATOR' }), true);
  assert.equal(trustedAuthor({ repository: pub }, { author_association: 'CONTRIBUTOR' }), false, 'a past contributor isn’t a collaborator');
  const open = (assoc, extra = {}) => ({ action: 'opened', repository: pub, sender: { login: 'stranger' }, issue: { number: 50, title: 'Spam ' + ref, body: '', html_url: 'https://github.com/uni/rover/issues/50', state: 'open', user: { login: 'stranger' }, author_association: assoc, ...extra } });
  let plan = planGithubEvent('issues', open('NONE'), [A], S);
  assert.equal(plan.create, null, 'no task from an outsider’s issue'); assert.equal(plan.links.length, 0, 'and no link');
  plan = planGithubEvent('issues', open('MEMBER'), [A], S);
  assert.deepEqual(plan.links.map(l => l.taskId), ['t_frame'], 'a member’s issue links');
  plan = planGithubEvent('issues', { ...open('NONE'), action: 'opened', issue: { ...open('NONE').issue, title: 'Unrelated' } }, [A], S);
  assert.equal(plan.create, null);
  assert.ok(planGithubEvent('issues', { ...open('OWNER'), issue: { ...open('OWNER').issue, title: 'Unrelated' } }, [A], S).create, 'the owner’s issue becomes a task');
  // An issue a member linked by hand, closed by the outsider who opened it: the state changes, the task isn’t finished.
  const url = 'https://github.com/uni/rover/issues/7';
  const T = [{ ...B, attachments: [{ provider: 'github', url, state: 'open' }] }];
  const closed = (who) => ({ action: 'closed', repository: pub, sender: { login: who }, issue: { number: 7, title: 'x', html_url: url, state: 'closed', state_reason: 'completed', user: { login: 'stranger' }, author_association: 'NONE' } });
  plan = planGithubEvent('issues', closed('stranger'), T, S);
  assert.equal(plan.finish.length, 0); assert.equal(plan.states[0].state, 'closed');
  assert.equal(planGithubEvent('issues', closed('maintainer'), T, S).finish.length, 1, 'closed by someone with access: finished');
  // An outsider’s pull request links only when merged.
  const pr = (action, merged) => ({ action, repository: pub, pull_request: { number: 9, title: 'Fix ' + ref, body: '', html_url: 'https://github.com/uni/rover/pull/9', head: { ref: 'fix' }, state: action === 'closed' ? 'closed' : 'open', merged, author_association: 'FIRST_TIME_CONTRIBUTOR' } });
  assert.equal(planGithubEvent('pull_request', pr('opened', false), [A], S).links.length, 0);
  plan = planGithubEvent('pull_request', pr('closed', true), [A], S);
  assert.equal(plan.links.length, 1); assert.equal(plan.finish.length, 1, 'merged by a maintainer: linked and finished');
});

// A small stand-in for Firestore: enough for the webhook and the token calls.
function memDb(init) {
  const docs = new Map(Object.entries(init).map(([k, v]) => [k, structuredClone(v)]));
  const snap = (path) => ({ exists: docs.has(path), id: path.split('/').pop(), ref: ref(path), data: () => structuredClone(docs.get(path)) });
  const setAt = (o, k, v) => { const ks = k.split('.'); let c = o; ks.slice(0, -1).forEach(x => { c[x] = c[x] && typeof c[x] === 'object' ? c[x] : {}; c = c[x]; }); c[ks.at(-1)] = v; };
  const apply = { set: (p, d, o) => docs.set(p, o && o.merge ? { ...(docs.get(p) || {}), ...structuredClone(d) } : structuredClone(d)),
    update: (p, d) => { if (!docs.has(p)) throw new Error('No document to update: ' + p); const cur = docs.get(p); Object.entries(d).forEach(([k, v]) => setAt(cur, k, structuredClone(v))); },
    delete: (p) => docs.delete(p) };
  function ref(path) { return { path, id: path.split('/').pop(), get: async () => snap(path), set: async (d, o) => apply.set(path, d, o), update: async (d) => apply.update(path, d), delete: async () => apply.delete(path) }; }
  const writer = () => { const q = []; return { set: (r, d, o) => q.push(() => apply.set(r.path, d, o)), update: (r, d) => q.push(() => apply.update(r.path, d)), delete: (r) => q.push(() => apply.delete(r.path)), run: () => q.forEach(f => f()) }; };
  return {
    docs,
    doc: ref,
    collection: (p) => ({ get: async () => ({ docs: [...docs.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(snap) }) }),
    batch: () => { const w = writer(); return { ...w, commit: async () => w.run() }; },
    runTransaction: async (fn) => { const w = writer(); const r = await fn({ get: async (r0) => snap(r0.path), ...w }); w.run(); return r; },
  };
}

test('webhook: a delivery is applied once, even if GitHub sends it again', async () => {
  const { handleWebhook } = await import('../functions/github.js');
  const crypto = await import('node:crypto');
  const db = memDb({
    'teams/T': { github: { repo: 'uni/rover', issues: true, done: true, owner: 'u1' }, ownerUid: 'u1', weeks: [{ key: 'w1', startDate: '2026-10-26' }] },
    'teams/T/private/github': { secret: 's3cret', repo: 'uni/rover' },
    'teams/T/categories/c1': { ownerUid: 'u1', order: 0 },
  });
  const body = Buffer.from(JSON.stringify({ action: 'opened', repository: { full_name: 'uni/rover', private: true, id: 5 }, issue: { number: 3, title: 'Motor stalls', body: '', html_url: 'https://github.com/uni/rover/issues/3', state: 'open', author_association: 'OWNER' } }));
  const sig = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(body).digest('hex');
  const call = () => handleWebhook(db, { teamId: 'T', kind: 'issues', signature: sig, rawBody: body, delivery: '72d3162e-cc78-11e3-81ab-4c9367dc0958' });
  const first = await call();
  assert.equal(first.status, 200); assert.equal(first.body.created, 1);
  const again = await call();
  assert.equal(again.body.duplicate, true, 'the same delivery id is skipped');
  assert.equal([...db.docs.keys()].filter(k => k.startsWith('teams/T/tasks/')).length, 1, 'one task, not two');
  assert.deepEqual(db.docs.get('teams/T/private/github').seen, ['72d3162e-cc78-11e3-81ab-4c9367dc0958']);
});

test('GitHub tokens: only fine-grained ones; a stored classic token is refused', async () => {
  const { setGithubToken, issueAction, isClassicToken } = await import('../functions/github.js');
  assert.equal(isClassicToken('ghp_' + 'a'.repeat(36)), true); assert.equal(isClassicToken('github_pat_' + 'a'.repeat(40)), false);
  const db = memDb({
    'teams/T': { github: { repo: 'uni/rover' }, roles: {}, ownerUid: 'u1' },
    'teams/T/members/u1': { roleId: 'owner', name: 'Owner' },
    'teams/T/private/github': { secret: 's', repo: 'uni/rover', token: 'ghp_' + 'b'.repeat(36) },
    'teams/T/tasks/t1': { name: 'X', ownerUid: 'u1', attachments: [], history: [] },
  });
  await assert.rejects(setGithubToken(db, 'u1', 'T', 'ghp_' + 'c'.repeat(36)), (e) => e.code === 'invalid-argument' && /fine-grained/.test(e.message));
  await assert.rejects(issueAction(db, 'u1', 'T', { taskId: 't1', action: 'create' }), (e) => e.code === 'failed-precondition' && /Classic/.test(e.message), 'never used, even if saved before');
});
