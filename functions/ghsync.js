// ─────────────────────────────────────────────────────────────────────────────
//  GitHub sync: what a GitHub event means for a team's tasks. Pure (no Firebase, no network),
//  shared by the githubWebhook Cloud Function and the app (the demo simulates events with it).
//
//  • Every task has a short reference, TT-XXXXXX. Put it in a pull request's title, description or
//    branch name (tt-xxxxxx-fix-motor) and the pull request is linked to the task.
//  • A merged pull request, or a closed issue, finishes its task (if the team wants that).
//  • A new issue becomes a task (if the team wants that), unless it names a task already, in which
//    case it is linked to that task (the app's "Raise an issue" form does this).
// ─────────────────────────────────────────────────────────────────────────────

/** The id a task's reference is made from: a task carried into later weeks keeps its first copy's. */
export const refIdOf = (t) => (t && (t.carryOf || t.id)) || '';
/** One task per carried-forward chain: the copy in the latest week of the team's week order (ties: the newest).
 *  Older copies stay in their weeks as a record and must not be counted again (digest, Today).
 *  tasks: [{ id, carryOf?, weekId, createdAt? }], weeks: [{ key }]. */
export function latestCopies(tasks, weeks) {
  const order = new Map((weeks || []).map((w, i) => [w.key, i])); const at = (t) => (order.has(t.weekId) ? order.get(t.weekId) : -1);
  const best = new Map();
  (tasks || []).forEach(t => {
    if (!t || !t.id) return; const k = refIdOf(t); const cur = best.get(k);
    if (!cur || at(t) > at(cur) || (at(t) === at(cur) && (Number(t.createdAt) || 0) >= (Number(cur.createdAt) || 0))) best.set(k, t);
  });
  return [...best.values()];
}
/** open | closed | merged | draft, from an issue or pull request in a GitHub event. */
export function stateOf(item, isPull) {
  if (!item) return '';
  if (isPull && (item.merged || item.merged_at)) return 'merged';
  if (item.state === 'closed') return 'closed';
  return isPull && item.draft ? 'draft' : 'open';
}
/** A task's short reference: TT- and 6 letters/digits, the same every time for the same task id. */
export function taskRef(id) {
  let h = 0x811c9dc5;   // FNV-1a
  for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  let h2 = h ^ 0x5bd1e995;
  for (const ch of String(id).split('').reverse().join('')) { h2 ^= ch.codePointAt(0); h2 = Math.imul(h2, 0x01000193) >>> 0; }
  return 'TT-' + ((h % 46656).toString(36).padStart(3, '0') + (h2 % 46656).toString(36).padStart(3, '0')).toUpperCase();
}
const REF_RE = /\btt-([a-z0-9]{6})\b/gi;
/** The task references in some text (titles, descriptions, branch names), upper-case and unique. */
export function findRefs(...texts) {
  const out = new Set();
  texts.forEach(t => { for (const m of String(t || '').matchAll(REF_RE)) out.add('TT-' + m[1].toUpperCase()); });
  return [...out];
}
/** A branch name for a task: tt-xxxxxx-short-name. */
export function branchName(id, name) {
  const slug = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  return taskRef(id).toLowerCase() + (slug ? '-' + slug : '');
}
/** "owner/repo", checked. */
export function cleanRepo(v) {
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]{1,39})\/([\w.-]{1,100}?)(?:\.git)?\/?$/i.exec(String(v || '').trim());
  return m ? m[1] + '/' + m[2] : '';
}
/**
 * A renamed (or transferred) repository: GitHub keeps sending events to the same webhook (the
 * secret proves it's ours) under the new name. Returns the new name, and the task writes that
 * move links from the old address to the new one; null when nothing changed.
 */
export function repoRenamed(settings, payload, tasks) {
  const s = cleanGithub(settings); const full = cleanRepo(payload && payload.repository && payload.repository.full_name);
  if (!s.repo || !full || full.toLowerCase() === s.repo.toLowerCase()) return null;
  const from = 'https://github.com/' + s.repo.toLowerCase() + '/'; const to = 'https://github.com/' + full + '/';
  const ops = [];
  (tasks || []).forEach(t => {
    const atts = t.attachments || [];
    if (!atts.some(a => String(a.url || '').toLowerCase().startsWith(from))) return;
    ops.push({ type: 'update', path: 'tasks/' + t.id, data: { attachments: atts.map(a => (String(a.url || '').toLowerCase().startsWith(from) ? { ...a, url: to + a.url.slice(from.length) } : a)) } });
  });
  return { repo: full, from: s.repo, ops };
}
/** The team's GitHub settings (team doc ▸ github). */
export function cleanGithub(g) {
  g = g && typeof g === 'object' ? g : {};
  const repo = cleanRepo(g.repo);
  return { repo, issues: g.issues !== false, done: g.done !== false, owner: typeof g.owner === 'string' ? g.owner.slice(0, 128) : '', connectedAt: Number(g.connectedAt) || 0, write: g.write === true,
    last: g.last && typeof g.last === 'object' ? { at: Number(g.last.at) || 0, kind: String(g.last.kind || '').slice(0, 40), action: String(g.last.action || '').slice(0, 40), links: Number(g.last.links) || 0, finished: Number(g.last.finished) || 0, created: Number(g.last.created) || 0, ok: g.last.ok !== false } : null };
}
/** A link to GitHub's own "new issue" page, filled in, naming the task so the webhook links them. */
export function newIssueUrl(repo, { title = '', body = '', ref = '' } = {}) {
  const r = cleanRepo(repo); if (!r) return '';
  const text = (body ? body + '\n\n' : '') + (ref ? 'Trawpie: ' + ref : '');
  return 'https://github.com/' + r + '/issues/new?title=' + encodeURIComponent(String(title).slice(0, 200)) + '&body=' + encodeURIComponent(text.slice(0, 4000));
}

/**
 * What to do with one GitHub event.
 *   kind: the X-GitHub-Event header ('pull_request', 'issues', 'ping', …); payload: its JSON.
 *   tasks: [{ id, name, flag, attachments: [{ url }], carryOf?, weekIdx? }] (the team's tasks; a reference
 *          names a whole carried chain, and the copy in the latest week is the one changed)
 *   settings: cleanGithub(team.github)
 * Returns { ok, why, links: [{ taskId, attachment }], finish: [{ taskId, why }], create: null | { name, url, label } }
 */
export function planGithubEvent(kind, payload, tasks, settings) {
  const out = { ok: true, why: '', links: [], finish: [], create: null, states: [] };
  const s = cleanGithub(settings); const p = payload || {};
  const repo = p.repository && p.repository.full_name;
  if (kind === 'ping') { out.why = 'ping'; return out; }
  if (!s.repo || !repo || repo.toLowerCase() !== s.repo.toLowerCase()) return { ...out, ok: false, why: 'This repository isn’t the one connected to the team.' };
  const chains = new Map();
  (tasks || []).forEach(t => { const k = refIdOf(t); if (!chains.has(k)) chains.set(k, []); chains.get(k).push(t); });
  const latest = (k) => (chains.get(k) || []).reduce((a, t) => (!a || (t.weekIdx || 0) >= (a.weekIdx || 0) ? t : a), null);
  const byRef = new Map([...chains.keys()].map(k => [taskRef(k), latest(k)]));
  // A team's own reference on a task (Ref field, e.g. DRN-12) works too, as a whole word.
  const custom = [...chains.keys()].map(k => latest(k)).filter(t => t && /^[A-Za-z0-9][A-Za-z0-9._/-]{2,39}$/.test(String(t.jiraId || '').trim()));
  const customHits = (...texts) => { const all = texts.map(x => String(x || '')).join('\n').toLowerCase(); return custom.filter(t => { const r = t.jiraId.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp('(^|[^a-z0-9])' + r + '($|[^a-z0-9])').test(all); }); };
  const linked = (url) => { const seen = new Set(); return (tasks || []).filter(t => (t.attachments || []).some(a => a.url === url)).map(t => latest(refIdOf(t))).filter(t => t && !seen.has(t.id) && seen.add(t.id)); };
  const attach = (t, item, isPull) => {
    const url = item.html_url; if (!url || (t.attachments || []).some(a => a.url === url)) return;
    out.links.push({ taskId: t.id, attachment: { provider: 'github', name: (isPull ? 'PR' : 'Issue') + ' #' + item.number + ': ' + String(item.title || '').slice(0, 160), url, state: stateOf(item, isPull), reason: item.state_reason === 'not_planned' ? 'not_planned' : '' } });
  };
  const finish = (t, why) => { if (t.flag !== 'completed' && !out.finish.some(f => f.taskId === t.id)) out.finish.push({ taskId: t.id, why }); };
  if (kind === 'pull_request') {
    const pr = p.pull_request || {};
    const refs = findRefs(pr.title, pr.body, pr.head && pr.head.ref);
    const hits = refs.map(r => byRef.get(r)).filter(Boolean);
    customHits(pr.title, pr.body, pr.head && pr.head.ref).forEach(t => { if (!hits.includes(t)) hits.push(t); });
    hits.forEach(t => attach(t, pr, true));
    linked(pr.html_url).forEach(t => { if (!hits.includes(t)) hits.push(t); });
    hits.forEach(t => out.states.push({ taskId: t.id, url: pr.html_url, state: stateOf(pr, true), reason: '', label: 'PR #' + pr.number }));
    if (p.action === 'closed' && pr.merged && s.done) hits.forEach(t => finish(t, 'pull request #' + pr.number + ' merged'));
    if (!hits.length) out.why = refs.length ? 'No task has ' + refs.join(', ') + '.' : 'No TT- reference in the pull request.';
    return out;
  }
  if (kind === 'issues') {
    const is = p.issue || {};
    if (is.pull_request) { out.why = 'A pull request’s issue event.'; return out; }
    const refs = findRefs(is.title, is.body);
    const hits = refs.map(r => byRef.get(r)).filter(Boolean);
    customHits(is.title, is.body).forEach(t => { if (!hits.includes(t)) hits.push(t); });
    linked(is.html_url).forEach(t => { if (!hits.includes(t)) hits.push(t); });
    if (p.action === 'opened' || p.action === 'reopened' || p.action === 'edited') hits.forEach(t => attach(t, is, false));
    if (p.action === 'opened' && !hits.length && s.issues) out.create = { name: String(is.title || 'GitHub issue').slice(0, 200), url: is.html_url, label: 'Issue #' + is.number + ': ' + String(is.title || '').slice(0, 160) };
    hits.forEach(t => out.states.push({ taskId: t.id, url: is.html_url, state: stateOf(is, false), reason: is.state_reason === 'not_planned' ? 'not_planned' : is.state_reason === 'duplicate' ? 'duplicate' : '', label: 'issue #' + is.number }));
    if (p.action === 'closed' && s.done && is.state_reason !== 'not_planned' && is.state_reason !== 'duplicate') hits.forEach(t => finish(t, 'issue #' + is.number + ' closed'));
    if (!hits.length && !out.create) out.why = 'Nothing to do for this issue.';
    return out;
  }
  out.why = 'Event not used: ' + kind;
  return out;
}

/** A sign-off still to give between the task's stage and Done (so GitHub can't finish it), or null. */
export function gateBlocks(task, stages) {
  const list = Array.isArray(stages) ? stages : []; if (!list.length) return null;
  const i = Math.max(0, list.findIndex(s => s.id === task.stage));
  for (let k = i; k < list.length - 1; k++) {
    const s = list[k]; if (!s.signoff) continue;
    const so = task.signoff; if (!(so && so.status === 'approved' && so.stage === s.id)) return s;
  }
  return null;
}
const hist = (time, field, original, updated) => ({ time, user: 'GitHub', field, original: String(original).slice(0, 300), updated: String(updated).slice(0, 300) });
/**
 * The writes for a plan: [{ type: 'update'|'set', path, data }] (paths relative to the team), plus notes.
 * env = { now, today: 'YYYY-MM-DD', time: history timestamp text, stages, newTask: { categoryId, ownerUid, weekId } | null, newId }
 */
export function githubOps(plan, tasks, env) {
  const byId = new Map((tasks || []).map(t => [t.id, t])); const ops = []; const notes = [];
  const touched = new Map();   // taskId → data being written
  const get = (id) => { const t = byId.get(id); const d = touched.get(id) || { attachments: (t.attachments || []).slice(), history: (t.history || []).slice() }; touched.set(id, d); return { t, d }; };
  (plan.links || []).forEach(({ taskId, attachment }) => {
    const { d } = get(taskId); if (d.attachments.some(a => a.url === attachment.url) || d.attachments.length >= 30) return;
    d.attachments.push({ id: 'gh_' + attachment.url.split('/').slice(-2).join('_').replace(/[^\w]/g, '_').slice(0, 40), ...attachment, size: 0, addedBy: 'GitHub', addedAt: env.now });
    d.history.unshift(hist(env.time, 'Attachment', '', 'Linked ' + attachment.name));
  });
  (plan.states || []).forEach(({ taskId, url, state, reason, label }) => {
    const cur = touched.get(taskId) || byId.get(taskId); const a = cur && (cur.attachments || []).find(x => x.url === url);
    if (!a || !state || (a.state === state && (a.reason || '') === (reason || ''))) return;
    const { d } = get(taskId);
    const was = a.state || ''; d.attachments = d.attachments.map(x => (x.url === url ? { ...x, state, reason: reason || '' } : x));
    if (was) d.history.unshift(hist(env.time, 'GitHub', was, label + ' ' + state + (reason ? ' (' + reason.replace('_', ' ') + ')' : '')));
  });
  (plan.finish || []).forEach(({ taskId, why }) => {
    const { t, d } = get(taskId);
    const gate = gateBlocks(t, env.stages);
    if (gate) { d.history.unshift(hist(env.time, 'Task Status Flag', t.flag || 'none', 'GitHub: ' + why + '; waiting for the ' + gate.name + ' sign-off before it’s done')); notes.push('“' + t.name + '” waits for a sign-off'); return; }
    d.flag = 'completed'; d.completedDate = env.today;
    d.history.unshift(hist(env.time, 'Task Status Flag', t.flag || 'none', 'completed (' + why + ')'));
  });
  touched.forEach((d, id) => { d.history = d.history.slice(0, 100); ops.push({ type: 'update', path: 'tasks/' + id, data: { ...d, updatedBy: 'GitHub', updatedAt: env.now } }); });
  if (plan.create) {
    if (!env.newTask) notes.push('No row to put the new task in.');
    else ops.push({ type: 'set', path: 'tasks/' + env.newId, data: {
      name: plan.create.name, priority: 'Minor', status: '', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none', dueDate: '', completedDate: '',
      subtasks: [], history: [hist(env.time, 'Created', '', 'From GitHub: ' + plan.create.label)], custom: {}, icon: '🐙',
      attachments: [{ id: 'gh_new', provider: 'github', name: plan.create.label, url: plan.create.url, size: 0, addedBy: 'GitHub', addedAt: env.now, state: 'open', reason: '' }],
      categoryId: env.newTask.categoryId, ownerUid: env.newTask.ownerUid, weekId: env.newTask.weekId, order: -1,
      createdBy: env.newTask.ownerUid, createdAt: env.now, updatedBy: 'GitHub', updatedAt: env.now } });
  }
  return { ops, notes };
}
/** Where a task made from a new issue goes: the chosen person's first row, in this week (else the last week). */
export function newTaskPlace(team, categories, today) {
  const g = cleanGithub(team && team.github); const owner = g.owner || (team && team.ownerUid) || '';
  const cats = (categories || []).filter(c => c.ownerUid === owner).sort((a, b) => (a.order || 0) - (b.order || 0));
  const weeks = (team && team.weeks) || [];
  const add = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const wk = weeks.find(w => w.startDate && w.startDate <= today && today <= add(w.startDate, 6)) || weeks[weeks.length - 1];
  if (!owner || !cats.length || !wk) return null;
  return { categoryId: cats[0].id, ownerUid: owner, weekId: wk.key };
}
