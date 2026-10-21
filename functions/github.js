// ─────────────────────────────────────────────────────────────────────────────
//  GitHub sync, server side. A team connects one repository (Settings ▸ Integrations ▸ GitHub):
//  githubConnect makes a secret, kept in teams/{t}/private/github where no app user can read it,
//  and the team adds a webhook on GitHub with it. githubWebhook checks each delivery's signature
//  with that secret, then applies what ghsync.js plans (link pull requests and issues to tasks,
//  finish tasks, turn new issues into tasks). No GitHub token is needed.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import { planGithubEvent, githubOps, newTaskPlace, cleanGithub, cleanRepo } from './ghsync.js';

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
  await team.ref.update({ github: { repo, issues: old.repo ? old.issues : true, done: old.repo ? old.done : true, owner: old.owner || uid, connectedAt: now } });
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
  await batch.commit();
  return { status: plan.ok ? 200 : 202, body: summary };
}
