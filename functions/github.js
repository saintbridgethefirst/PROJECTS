// ─────────────────────────────────────────────────────────────────────────────
//  GitHub sync, server side. A team connects one repository (Settings ▸ Integrations ▸ GitHub):
//  githubConnect makes a secret, kept in teams/{t}/private/github where no app user can read it,
//  and the team adds a webhook on GitHub with it. githubWebhook checks each delivery's signature
//  with that secret, then applies what ghsync.js plans (link pull requests and issues to tasks,
//  finish tasks, turn new issues into tasks). No GitHub token is needed.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import { planGithubEvent, githubOps, newTaskPlace, cleanGithub, cleanRepo, taskRef as ref, refIdOf, gateBlocks, stateOf } from './ghsync.js';

const fail = (code, message) => Object.assign(new Error(message), { code });

async function canManage(db, uid, teamId) {
  const [team, me] = await Promise.all([db.doc('teams/' + teamId).get(), db.doc('teams/' + teamId + '/members/' + uid).get()]);
  if (!team.exists) throw fail('not-found', 'That team doesn’t exist.');
  if (!me.exists) throw fail('permission-denied', 'You’re not in this team.');
  const role = me.data().roleId; const roles = team.data().roles || {};
  if (role !== 'owner' && !(roles[role] && roles[role].perms && roles[role].perms['team.settings'] === true)) throw fail('permission-denied', 'Only people who manage team settings can connect GitHub.');
  return team;
}

/** Connect (or reconnect) a repository: a new secret every time. Returns { repo, secret }. */
export async function connectGithub(db, uid, teamId, repoIn) {
  const repo = cleanRepo(repoIn); if (!repo) throw fail('invalid-argument', 'Give the repository as owner/name, e.g. uni-robotics/rover.');
  const team = await canManage(db, uid, teamId);
  const secret = crypto.randomBytes(24).toString('hex');
  const now = Date.now(); const old = cleanGithub(team.data().github);
  await db.doc('teams/' + teamId + '/private/github').set({ secret, repo, by: uid, at: now, last: null });
  await team.ref.update({ github: { repo, issues: old.repo ? old.issues : true, done: old.repo ? old.done : true, owner: old.owner || uid, connectedAt: now, write: false, last: null } });
  return { repo, secret };
}
/** Forget the repository and its secret. */
export async function disconnectGithub(db, uid, teamId) {
  const team = await canManage(db, uid, teamId);
  await db.doc('teams/' + teamId + '/private/github').delete();
  await team.ref.update({ github: null });
  return { ok: true };
}

/** GitHub signs each delivery: X-Hub-Signature-256 = sha256=HMAC(secret, raw body). */
export function signatureOk(secret, rawBody, header) {
  if (!secret || !rawBody || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const want = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex'));
  const got = Buffer.from(header);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const londonDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const stamp = (ms) => {
  const d = new Date(ms); const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', year: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d).map(x => [x.type, x.value]));
  return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute + ' ' + String(p.dayPeriod || '').toUpperCase();
};

/** One webhook delivery. Returns { status, body } for the HTTP reply. */
export async function handleWebhook(db, { teamId, kind, signature, rawBody, delivery }) {
  if (!/^[\w-]{1,128}$/.test(String(teamId || ''))) return { status: 400, body: 'Missing ?team=' };
  const priv = await db.doc('teams/' + teamId + '/private/github').get();
  if (!priv.exists) return { status: 404, body: 'GitHub isn’t connected to this team.' };
  if (!signatureOk(priv.data().secret, rawBody, signature)) return { status: 401, body: 'Bad signature: check the webhook secret.' };
  let payload; try { payload = JSON.parse(rawBody.toString('utf8')); } catch { return { status: 400, body: 'Send the webhook as application/json.' }; }
  const teamSnap = await db.doc('teams/' + teamId).get(); const team = teamSnap.data() || {};
  const weekIdx = new Map((team.weeks || []).map((w, i) => [w.key, i]));
  const taskSnap = await db.collection('teams/' + teamId + '/tasks').get();
  const tasks = taskSnap.docs.map(d => ({ ...d.data(), id: d.id, weekIdx: weekIdx.has(d.data().weekId) ? weekIdx.get(d.data().weekId) : -1 }));
  const plan = planGithubEvent(kind, payload, tasks, team.github);
  const now = Date.now();
  let newTask = null;
  if (plan.create) {
    const cats = (await db.collection('teams/' + teamId + '/categories').get()).docs.map(d => ({ ...d.data(), id: d.id }));
    newTask = newTaskPlace(team, cats, londonDay(now));
  }
  const { ops, notes } = githubOps(plan, tasks, { now, today: londonDay(now), time: stamp(now), stages: (team.workflow && team.workflow.stages) || [], newTask, newId: 't_gh' + crypto.randomBytes(9).toString('hex') });
  const batch = db.batch();
  ops.forEach(o => { const ref = db.doc('teams/' + teamId + '/' + o.path); if (o.type === 'set') batch.set(ref, o.data); else batch.update(ref, o.data); });
  const summary = { at: now, kind: String(kind).slice(0, 40), action: String((payload && payload.action) || '').slice(0, 40), delivery: String(delivery || '').slice(0, 80),
    links: plan.links.length, finished: plan.finish.length, created: plan.create && newTask ? 1 : 0, why: [plan.why, ...notes].filter(Boolean).join(' ').slice(0, 300) };
  batch.set(priv.ref, { last: summary }, { merge: true });
  // What the app shows (Settings ▸ Integrations ▸ GitHub): proof that events arrive.
  batch.update(teamSnap.ref, { 'github.last': { at: now, kind: summary.kind, action: summary.action, links: summary.links, finished: summary.finished, created: summary.created, ok: plan.ok } });
  await batch.commit();
  return { status: plan.ok ? 200 : 202, body: summary };
}

// ── Optional: let TeamTrack create and close issues (a fine-grained token, kept with the secret) ──
const GH_API = 'https://api.github.com';
async function gh(token, method, path, body) {
  const r = await fetch(GH_API + path, { method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'TeamTrack', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!r.ok) {
    const msg = (j && j.message) || text.slice(0, 200);
    if (r.status === 401) throw fail('permission-denied', 'GitHub didn’t accept the token (it may have expired). Add a new one in Settings ▸ Integrations.');
    if (r.status === 403 || r.status === 404) throw fail('permission-denied', 'The token can’t change issues in this repository. Give it “Issues: Read and write” for this repository.');
    throw fail('failed-precondition', 'GitHub said: ' + msg);
  }
  return j;
}
/** The task's attachments with one linked issue's state changed. */
function withState(atts, repo, n, state, reason) {
  const re = new RegExp('/' + repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/issues/' + n + '$', 'i');
  return (atts || []).map(x => (re.test(x.url) ? { ...x, state, reason } : x));
}
/** Save (or remove, with token '') the token that lets TeamTrack create and close issues. */
export async function setGithubToken(db, uid, teamId, token) {
  const team = await canManage(db, uid, teamId);
  const priv = db.doc('teams/' + teamId + '/private/github'); const snap = await priv.get();
  if (!snap.exists) throw fail('failed-precondition', 'Connect a repository first.');
  const g = cleanGithub(team.data().github);
  if (!token) { await priv.set({ token: null }, { merge: true }); await team.ref.update({ github: { ...g, write: false } }); return { write: false }; }
  const t = String(token).trim();
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,255}$/.test(t)) throw fail('invalid-argument', 'That doesn’t look like a GitHub token (they start with github_pat_ or ghp_).');
  const repo = await gh(t, 'GET', '/repos/' + g.repo);
  if (repo && repo.has_issues === false) throw fail('failed-precondition', 'Issues are switched off in ' + g.repo + ' (GitHub ▸ Settings ▸ Features).');
  await priv.set({ token: t }, { merge: true });
  await team.ref.update({ github: { ...g, write: true } });
  return { write: true };
}
/**
 * Create, close or reopen an issue for a task, by someone who may edit that task.
 * a = { taskId, action: 'create'|'close'|'reopen', number?, reason?: 'completed'|'not_planned'|'duplicate', duplicateOf?, title?, body?, finish? }
 */
export async function issueAction(db, uid, teamId, a) {
  const [teamSnap, meSnap, priv] = await Promise.all([db.doc('teams/' + teamId).get(), db.doc('teams/' + teamId + '/members/' + uid).get(), db.doc('teams/' + teamId + '/private/github').get()]);
  if (!teamSnap.exists || !meSnap.exists) throw fail('permission-denied', 'You’re not in this team.');
  const team = teamSnap.data(); const g = cleanGithub(team.github); const token = priv.exists && priv.data().token;
  if (!g.repo || !token) throw fail('failed-precondition', 'TeamTrack can’t change GitHub issues for this team yet (Settings ▸ Integrations ▸ GitHub ▸ token).');
  const taskRefDoc = db.doc('teams/' + teamId + '/tasks/' + String(a.taskId || '')); const taskSnap = await taskRefDoc.get();
  if (!taskSnap.exists) throw fail('not-found', 'That task doesn’t exist any more.');
  const task = taskSnap.data(); const role = meSnap.data().roleId; const perms = ((team.roles || {})[role] || {}).perms || {};
  const may = role === 'owner' || perms['tasks.editAll'] === true || (perms['tasks.editOwn'] === true && task.ownerUid === uid);
  if (!may) throw fail('permission-denied', 'You can only do this on tasks you can edit.');
  const now = Date.now(); const who = String((meSnap.data().name || 'Someone')).slice(0, 80);
  const history = (task.history || []).slice();
  if (a.action === 'create') {
    const title = String(a.title || task.name || 'Issue').slice(0, 200);
    const body = (String(a.body || '').slice(0, 4000) + '\n\nTeamTrack: ' + ref(refIdOf({ ...task, id: taskSnap.id }))).trim();
    const is = await gh(token, 'POST', '/repos/' + g.repo + '/issues', { title, body });
    const att = (task.attachments || []).slice();
    if (!att.some(x => x.url === is.html_url) && att.length < 30) att.push({ id: 'gh_issues_' + is.number, provider: 'github', name: 'Issue #' + is.number + ': ' + title.slice(0, 160), url: is.html_url, size: 0, addedBy: who, addedAt: now, state: 'open', reason: '' });
    history.unshift({ time: stamp(now), user: who, field: 'GitHub', original: '', updated: 'Created issue #' + is.number + ' and linked it' });
    await taskRefDoc.update({ attachments: att, history: history.slice(0, 100), updatedBy: who, updatedAt: now });
    return { number: is.number, url: is.html_url, state: 'open' };
  }
  const n = Math.round(Number(a.number)); if (!(n > 0)) throw fail('invalid-argument', 'Which issue?');
  if (a.action === 'refresh') {   // read the current state from GitHub (after linking one by hand)
    const kind = a.kind === 'pull' ? 'pull' : 'issues';
    const url = (task.attachments || []).map(x => x.url).find(u => new RegExp('/' + g.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/' + kind + '/' + n + '$', 'i').test(u));
    if (!url) throw fail('permission-denied', 'That isn’t linked to this task.');
    const it = await gh(token, 'GET', '/repos/' + g.repo + '/' + (kind === 'pull' ? 'pulls' : 'issues') + '/' + n);
    const state = stateOf(it, kind === 'pull'); const reason = it.state_reason === 'not_planned' || it.state_reason === 'duplicate' ? it.state_reason : '';
    const name = (kind === 'pull' ? 'PR #' : 'Issue #') + n + ': ' + String(it.title || '').slice(0, 160);
    await taskRefDoc.update({ attachments: (task.attachments || []).map(x => (x.url === url ? { ...x, state, reason, name } : x)), updatedBy: who, updatedAt: now });
    return { number: n, state, reason };
  }
  if (!(task.attachments || []).some(x => new RegExp('/' + g.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/issues/' + n + '$', 'i').test(x.url))) throw fail('permission-denied', 'That issue isn’t linked to this task.');
  if (a.action === 'reopen') {
    await gh(token, 'PATCH', '/repos/' + g.repo + '/issues/' + n, { state: 'open' });
    history.unshift({ time: stamp(now), user: who, field: 'GitHub', original: 'closed', updated: 'Reopened issue #' + n });
    await taskRefDoc.update({ attachments: withState(task.attachments, g.repo, n, 'open', ''), history: history.slice(0, 100), updatedBy: who, updatedAt: now });
    return { number: n, state: 'open' };
  }
  const reason = ['completed', 'not_planned', 'duplicate'].includes(a.reason) ? a.reason : 'completed';
  const dup = Math.round(Number(a.duplicateOf));
  if (reason === 'duplicate') {
    if (!(dup > 0)) throw fail('invalid-argument', 'Duplicate of which issue number?');
    await gh(token, 'POST', '/repos/' + g.repo + '/issues/' + n + '/comments', { body: 'Duplicate of #' + dup });
  }
  await gh(token, 'PATCH', '/repos/' + g.repo + '/issues/' + n, { state: 'closed', state_reason: reason });
  const label = { completed: 'completed', not_planned: 'not planned', duplicate: 'a duplicate of #' + dup }[reason];
  const patch = { updatedBy: who, updatedAt: now };
  history.unshift({ time: stamp(now), user: who, field: 'GitHub', original: 'open', updated: 'Closed issue #' + n + ' as ' + label });
  patch.attachments = withState(task.attachments, g.repo, n, 'closed', reason === 'completed' ? '' : reason);
  let finished = false;
  if (a.finish && reason === 'completed' && task.flag !== 'completed' && !gateBlocks({ ...task, id: taskSnap.id }, (team.workflow && team.workflow.stages) || [])) {
    history.unshift({ time: stamp(now), user: who, field: 'Task Status Flag', original: task.flag || 'none', updated: 'completed (GitHub issue #' + n + ' closed)' });
    patch.flag = 'completed'; patch.completedDate = londonDay(now); finished = true;
  }
  await taskRefDoc.update({ ...patch, history: history.slice(0, 100) });
  return { number: n, state: 'closed', reason, finished };
}
