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
  assert.ok(u.startsWith('https://github.com/uni/rover/issues/new?title=Motor%20stalls&body=') && decodeURIComponent(u).includes('TeamTrack: TT-ABC123'));
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
  plan = planGithubEvent('issues', { action: 'opened', repository: repo, issue: is({ body: 'From the app\n\nTeamTrack: ' + taskRef('t_wheels') }) }, [A, B], S);
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
