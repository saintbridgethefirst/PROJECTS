// ─────────────────────────────────────────────────────────────────────────────
//  Automatic steps (workflow step 4), each switched on in Settings ▸ Workflow:
//    • all the parts a task needs are received → move it on to a chosen stage (never past a
//      sign-off that hasn't been given)
//    • a task is done → a comment @mentioning everyone whose tasks were waiting on it
//    • a sign-off has waited N days → a comment @mentioning whoever can give it
//  There's no server doing this: the app of someone allowed to make the change does it, so it is
//  checked by the same security rules as a change made by hand, and shows in the task's history.
// ─────────────────────────────────────────────────────────────────────────────
import { newId, cleanAutos, cleanComment, cleanFeatures, cleanTask, carryIndexOf, workflowOf, stageIdOf, partsReadyMoves, waitingOn, signersFor, nextWeekTitle, carryFields, carryCopyId, autoWeekKey, BACKLOG_KEY } from './model.js';
import { can, canEditOwnedBy } from './permissions.js';
import { toast } from './ui.js';

const localISO = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDaysISO = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return localISO(d); };

// Carry unfinished tasks forward into the current week (Settings ▸ Automatic steps).
// Done by the app of whoever can make the change, so it's checked by the same rules and shows in
// each task's history. Each person carries the tasks they're allowed to; together the board catches up.
function carryOps(ctx, a) {
  const s = ctx.session; if (!a.carry) return { ops: [], n: 0, title: '' };
  const dated = (s.team.weeks || []).filter(w => w.startDate).sort((x, y) => x.startDate.localeCompare(y.startDate));
  if (dated.length < 1) return { ops: [], n: 0, title: '' };
  const today = localISO(new Date());
  let curIdx = -1; dated.forEach((w, i) => { if (w.startDate <= today) curIdx = i; });
  if (curIdx < 0) return { ops: [], n: 0, title: '' };   // every week is still in the future
  const ops = []; let targetKey = dated[curIdx].key, targetStart = dated[curIdx].startDate, targetTitle = dated[curIdx].title;
  // The latest dated week has ended and the team lets Trawpie add weeks: catch up to this week.
  if (a.carryMakeWeeks && curIdx === dated.length - 1 && addDaysISO(targetStart, 7) <= today && can(s.team, s.me, 'weeks.manage')) {
    const add = []; let start = targetStart; let guard = 0;
    while (addDaysISO(start, 7) <= today && guard++ < 60) {
      start = addDaysISO(start, 7);
      if ((s.team.weeks || []).some(w => w.startDate === start)) continue;   // another app already added it
      add.push({ key: autoWeekKey(start), title: nextWeekTitle(s.team.weekNaming, [...(s.team.weeks || []), ...add], start), metric: '', startDate: start });
    }
    if (add.length) {
      ops.push({ type: 'update', path: 'team', data: { weeks: [...(s.team.weeks || []), ...add] } });
      const last = add[add.length - 1]; targetKey = last.key; targetStart = last.startDate; targetTitle = last.title;
    }
  }
  const ix = carryIndexOf(s); const did = seen(s); const now = Date.now(); const keys = [];
  const weekStart = new Map((s.team.weeks || []).map(w => [w.key, w.startDate || '']));
  (s.tasks || []).forEach(t => {
    if (t.flag === 'completed' || t.weekId === targetKey) return;
    const ws = weekStart.get(t.weekId); if (!ws || ws >= targetStart) return;      // only weeks before the current one
    // Work added after its week was over (a plan that starts in the past, an import) wasn't missed: it stays
    // where it was planned (showing as overdue), instead of flooding this week with copies.
    if (Number(t.createdAt) > 0 && localISO(new Date(Number(t.createdAt))) >= addDaysISO(ws, 7)) return;
    const l = ix.latest(t.id); if (l && l.id !== t.id) return;                     // only the latest copy in a chain
    if (!canEditOwnedBy(s.team, s.me, t.ownerUid) || did.has('carry:' + t.id)) return;
    did.add('carry:' + t.id); keys.push('carry:' + t.id);
    const root = t.carryOf || t.id; const nid = carryCopyId(root, targetKey);
    if ((s.tasks || []).some(x => x.id === nid)) return;                           // another app already made this copy
    const history = [{ time: stamp(), user: ctx.user.name || 'Someone', field: 'Action', original: '', updated: 'Carried forward to ' + targetTitle + ' (automatic)' }]
      .concat(Array.isArray(t.history) ? t.history : []).slice(0, 100);
    // A fresh copy for the new week: keep the work and an open sign-off request, not the hours logged or a decision (carryFields).
    // It keeps the task's age (createdAt), so weeks-old work still needs approval to delete.
    // cleanTask returns id/type too; the document itself must not carry them (the id is the path).
    const { id: _id, type: _type, ...data } = cleanTask({ ...t, ...carryFields(t), id: nid, weekId: targetKey, flag: t.flag, completedDate: '', history, createdBy: ctx.user.uid, createdAt: Number(t.createdAt) > 0 && Number(t.createdAt) < now ? Number(t.createdAt) : now, updatedBy: ctx.user.name || '', updatedAt: now }, nid);
    ops.push({ type: 'set', path: 'tasks/' + nid, data });
  });
  const n = ops.filter(o => o.path !== 'team').length;
  return { ops, n, title: targetTitle, keys };
}

// Dissertation plans keep later work in the Backlog until its week exists (a PhD board grows a term at a time).
// When the week a Backlog task is due in is on the board, move the task into it.
function backlogOps(ctx) {
  const s = ctx.session; if (!cleanFeatures(s.team.features).dissertation) return [];
  const weeks = (s.team.weeks || []).filter(w => w.startDate && w.key !== BACKLOG_KEY);
  const now = Date.now(); const did = seen(s); const ops = [];
  (s.tasks || []).forEach(t => {
    if (t.weekId !== BACKLOG_KEY || t.flag === 'completed' || !/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate || '') || did.has('bl:' + t.id) || !canEditOwnedBy(s.team, s.me, t.ownerUid)) return;
    const w = weeks.find(x => x.startDate <= t.dueDate && t.dueDate <= addDaysISO(x.startDate, 6)); if (!w) return;
    did.add('bl:' + t.id);
    const history = [{ time: stamp(), user: ctx.user.name || 'Someone', field: 'Schedule', original: 'Backlog', updated: w.title + ' (automatic: its week is on the board)' }, ...(t.history || [])].slice(0, 100);
    ops.push({ type: 'update', path: 'tasks/' + t.id, data: { weekId: w.key, history, updatedBy: ctx.user.name || '', updatedAt: now } });
  });
  return ops;
}

const DAY = 864e5;
const stamp = () => { const n = new Date(); let h = n.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return String(n.getDate()).padStart(2, '0') + '/' + n.toLocaleString('en-GB', { month: 'short' }) + '/' + String(n.getFullYear()).slice(-2) + ' ' + h + ':' + String(n.getMinutes()).padStart(2, '0') + ' ' + ap; };
const done = new WeakMap();   // session → what this app already did (so a slow snapshot doesn't repeat it)
const tries = new Map();      // carry key → refused writes so far
const seen = (s) => { let x = done.get(s); if (!x) { x = new Set(); done.set(s, x); } return x; };
const nameOf = (s, uid) => ((s.members || []).find(m => m.uid === uid) || {}).name || 'someone';
const latestOnly = (s) => { const ix = carryIndexOf(s); return (s.tasks || []).filter(t => { const l = ix.latest(t.id); return !l || l.id === t.id; }); };
const canComment = (s) => can(s.team, s.me, 'tasks.editOwn') || can(s.team, s.me, 'tasks.editAll');
function commentOp(ctx, taskId, text, mentions) {
  const { id, ...data } = cleanComment({ taskId, authorUid: ctx.user.uid, authorName: ctx.user.name || '', text, mentions, createdAt: Date.now() });
  return { type: 'set', path: 'comments/' + newId('cm'), data };
}

/** Parts in → move on, and sign-off reminders. Safe to call often. */
export async function runAutos(ctx) {
  const s = ctx.session; if (!s || !s.booted || !s.team || !s.me) return 0;
  const a = cleanAutos(s.team.autos); const wf = workflowOf(s.team); const did = seen(s); const ops = [];
  const now = Date.now(); const me = ctx.user;
  // 1. All parts received → next stage
  if (a.partsTo && cleanFeatures(s.team.features).parts && wf.stages.some(x => x.id === a.partsTo)) {
    const ix = carryIndexOf(s);
    const parts = (s.parts || []).map(p => { const l = p.taskId && ix.latest(p.taskId); return l ? { ...p, taskId: l.id } : p; });
    const to = wf.stages.find(x => x.id === a.partsTo);
    partsReadyMoves(latestOnly(s), parts, wf.stages, a.partsTo, (t) => stageIdOf(t, wf.stages, wf.moved))
      .filter(m => canEditOwnedBy(s.team, s.me, m.task.ownerUid) && !did.has('p:' + m.task.id + ':' + a.partsTo))
      .forEach(({ task, from }) => {
        did.add('p:' + task.id + ':' + a.partsTo);
        const was = (wf.stages.find(x => x.id === from) || {}).name || from;
        const history = [{ time: stamp(), user: me.name || 'Someone', field: 'Stage', original: was, updated: to.name + ' (automatic: all its parts are received)' }, ...(task.history || [])].slice(0, 100);
        ops.push({ type: 'update', path: 'tasks/' + task.id, data: { stage: to.id, history, updatedBy: me.name || '', updatedAt: now } });
      });
  }
  // 3. Sign-offs waiting too long → remind whoever can give them (done by the person who asked)
  if (a.remindDays && canComment(s)) {
    latestOnly(s).forEach(t => {
      const so = t.signoff; if (!so || so.status !== 'waiting' || so.by !== me.uid || t.flag === 'completed') return;
      const st = wf.stages.find(x => x.id === so.stage); if (!st || !st.signoff || stageIdOf(t, wf.stages, wf.moved) !== st.id) return;
      const last = Math.max(so.at || 0, so.remindedAt || 0);
      if (now - last < a.remindDays * DAY || did.has('r:' + t.id + ':' + last) || !canEditOwnedBy(s.team, s.me, t.ownerUid)) return;
      did.add('r:' + t.id + ':' + last);
      const who = signersFor(st, s.team, s.members || [], t.ownerUid).uids.filter(u => u !== me.uid).slice(0, 5);
      if (!who.length) return;
      const days = Math.floor((now - (so.at || now)) / DAY);
      ops.push(commentOp(ctx, t.id, '⏰ Reminder: this has waited ' + days + (days === 1 ? ' day' : ' days') + ' for a ' + st.name + ' sign-off. ' + who.map(u => '@' + nameOf(s, u)).join(' '), who));
      ops.push({ type: 'update', path: 'tasks/' + t.id, data: { signoff: { ...so, remindedAt: now } } });
    });
  }
  // 5. Dissertation: Backlog tasks whose week is now on the board move into it
  ops.push(...backlogOps(ctx));
  if (ops.length) await ctx.writeOps(ops, { quiet: true, auto: true });
  // 4. Carry unfinished tasks into the current week. Its own write: the copies have fixed ids, so if another
  //    app open at the same moment made them first, this write is refused and nothing is duplicated.
  const carry = carryOps(ctx, a);
  if (carry.ops.length) {
    const ok = await ctx.writeOps(carry.ops, { quiet: true, auto: true });
    if (ok !== false && carry.n) toast(carry.n + (carry.n === 1 ? ' task' : ' tasks') + ' carried into ' + carry.title + '.', 5000);
    // Refused (usually: another app carried some of them a moment earlier): try the rest again after the next
    // update arrives, when the copies already made are skipped. At most a few times, so a real refusal doesn't loop.
    if (ok === false) carry.keys.forEach(k => { const n = (tries.get(k) || 0) + 1; tries.set(k, n); if (n < 3) did.delete(k); });
  }
  return ops.length + carry.ops.length;
}

/** After this app saved board changes: tasks just done → tell the owners of tasks waiting on them. */
export async function afterCommit(ctx, changes) {
  const s = ctx.session; if (!s || !s.team || !cleanAutos(s.team.autos).tellWaiting || !canComment(s)) return 0;
  const finished = (changes || []).filter(c => c.kind === 'task' && c.after && c.after.flag === 'completed' && (!c.before || c.before.flag !== 'completed'));
  if (!finished.length) return 0;
  const ix = carryIndexOf(s); const did = seen(s); const ops = [];
  const nameOfTask = (id) => ((s.tasks || []).find(t => t.id === id) || (finished.find(c => c.id === id) || {}).after || {}).name || 'A task';
  finished.forEach(c => {
    const ids = ix.ids(c.id);
    waitingOn(latestOnly(s), ids).forEach(t => {
      const key = 'w:' + ix.rootOf(c.id) + ':' + t.id; if (did.has(key)) return; did.add(key);
      const owner = t.ownerUid; const mention = owner && owner !== ctx.user.uid ? [owner] : [];
      ops.push(commentOp(ctx, t.id, '✅ “' + nameOfTask(c.id) + '” is done, so this can go ahead.' + (mention.length ? ' @' + nameOf(s, owner) : '') + ' (automatic)', mention));
    });
  });
  if (!ops.length) return 0;
  await ctx.writeOps(ops, { quiet: true, auto: true });
  return ops.length;
}
