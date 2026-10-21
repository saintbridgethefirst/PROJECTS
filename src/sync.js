// ─────────────────────────────────────────────────────────────────────────────
//  Sync engine: database documents  ⇄  the board's in-memory model.
//
//  The board (public/board/board.js) edits a plain nested model
//  { weeksData, db: [person → categories → week arrays → tasks] } and then calls
//  saveDatabase(). We flatten that model, diff it against the last state the
//  server is known to have, check every change against the user's permissions,
//  and write only what changed. Undo/redo work on these diffs, so undoing your
//  own edit never reverts a teammate's.
// ─────────────────────────────────────────────────────────────────────────────
import { can, canEditOwnedBy } from './permissions.js';
import { cleanTask, TASK_CONTENT_FIELDS, workflowOf, stageIdOf, gateOnTheWay, canSignStage } from './model.js';
import { LIMITS } from './config.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Deep copy. The board edits nested arrays/objects in place (sub-tasks, custom fields,
// attachments), so the board model and the last-saved state must never share them, or an
// edit changes both and the diff sees nothing to save.
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Value used when the board leaves a task field unset (matches cleanTask's output).
const TASK_DEFAULTS = {
  name: '', priority: 'Minor', status: '', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none',
  dueDate: '', startDate: '', checks: {}, signoff: null, phaseId: '', repeat: null, stage: '', effort: null, dependsOn: [], carryOf: '', skill: '', timeLog: [], completedDate: '', subtasks: [], history: [], custom: {}, icon: '', attachments: [],
};

/**
 * Build the board model from database state.
 * state = { team, members[], categories[], tasks[], personOrder[], collapsed{} }
 */
export function buildModel(state) {
  const { team, members = [], categories = [], tasks = [], personOrder = [], collapsed = {} } = state;
  const weeksData = (team?.weeks || []).map(w => ({ ...w, collapsed: !!collapsed[w.key] }));
  const weekKeys = new Set(weeksData.map(w => w.key));

  // People = members, plus a placeholder row for anyone who left but still owns rows.
  const people = members.map(m => ({ id: m.uid, type: 'person', name: m.name || m.email || 'Member', email: m.email, roleId: m.roleId, photo: m.photo, categories: [] }));
  const byId = new Map(people.map(p => [p.id, p]));
  categories.forEach(c => {
    if (!byId.has(c.ownerUid)) {
      const ghost = { id: c.ownerUid, type: 'person', name: 'Former member', email: '', roleId: '', former: true, categories: [] };
      people.push(ghost); byId.set(ghost.id, ghost);
    }
  });
  const rank = (uid) => { const i = personOrder.indexOf(uid); return i === -1 ? 1e6 : i; };
  people.sort((a, b) => (a.former - b.former) || rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));

  const catById = new Map();
  [...categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).forEach(c => {
    const cat = { id: c.id, type: 'category', name: c.name };
    weeksData.forEach(w => { cat[w.key] = []; });
    byId.get(c.ownerUid).categories.push(cat);
    catById.set(c.id, cat);
  });

  [...tasks].sort((a, b) => a.order - b.order).forEach(t => {
    const cat = catById.get(t.categoryId);
    if (!cat || !weekKeys.has(t.weekId)) return;   // orphan (category/week removed) — not shown, never written
    const { categoryId, ownerUid, weekId, order, ...content } = t;
    cat[weekId].push(clone(content));
  });
  return { weeksData, db: people };
}

/** Flatten the board model into comparable entities. */
export function flatten(model) {
  const weeks = model.weeksData.map(w => ({ key: w.key, title: w.title, metric: w.metric, startDate: w.startDate || '' }));
  const cats = {}; const tasks = {};
  model.db.forEach(person => {
    person.categories.forEach((cat, ci) => {
      cats[cat.id] = { name: cat.name, ownerUid: person.id, order: ci };
      model.weeksData.forEach(w => {
        (cat[w.key] || []).forEach((t, ti) => {
          const doc = {};
          TASK_CONTENT_FIELDS.forEach(f => { doc[f] = clone((t[f] === undefined || t[f] === null) ? TASK_DEFAULTS[f] : t[f]); });
          if (Array.isArray(doc.history)) doc.history = doc.history.slice(0, LIMITS.historyEntries);
          doc.categoryId = cat.id; doc.ownerUid = person.id; doc.weekId = w.key; doc.order = ti;
          tasks[t.id] = doc;
        });
      });
    });
  });
  return { weeks, cats, tasks };
}

/** Changes from flat state a → b. */
export function diff(a, b) {
  const out = [];
  if (!same(a.weeks, b.weeks)) out.push({ kind: 'weeks', before: a.weeks, after: b.weeks });
  for (const kind of ['cats', 'tasks']) {
    const ids = new Set([...Object.keys(a[kind]), ...Object.keys(b[kind])]);
    ids.forEach(id => {
      const x = a[kind][id] || null, y = b[kind][id] || null;
      if (!same(x, y)) out.push({ kind: kind === 'cats' ? 'cat' : 'task', id, before: x, after: y });
    });
  }
  return out;
}

/** Which changes is this member NOT allowed to make? Returns human-readable reasons. */
const DECISION_FIELDS = ['signoff', 'stage', 'flag', 'completedDate', 'history', 'updatedBy', 'updatedAt'];
/** Someone asked to sign off a task records their decision (firestore.rules ▸ signoffDecision). */
function isSignoffDecision(c, member) {
  if (c.kind !== 'task' || !c.before || !c.after || !member) return false;
  const b = c.before.signoff, a = c.after.signoff;
  if (!b || b.status !== 'waiting' || !a || !['approved', 'changes'].includes(a.status) || a.approver !== member.uid) return false;
  return Object.keys({ ...c.before, ...c.after }).every(k => DECISION_FIELDS.includes(k) || same(c.before[k], c.after[k]));
}
export function deniedChanges(changes, team, member) {
  const reasons = [];
  changes.forEach(c => {
    if (c.kind === 'weeks') { if (!can(team, member, 'weeks.manage')) reasons.push('change weeks'); return; }
    const owners = [c.before?.ownerUid, c.after?.ownerUid].filter(Boolean);
    if (!owners.every(o => canEditOwnedBy(team, member, o)) && !isSignoffDecision(c, member)) reasons.push(c.kind === 'cat' ? 'edit this category' : 'edit this task');
    // Sign-offs: a task can't move forward past a stage that needs one, unless you're allowed to give it.
    if (c.kind === 'task' && c.before && c.after) {
      const wf = workflowOf(team);
      const gate = gateOnTheWay(c.after, wf.stages, stageIdOf(c.before, wf.stages, wf.moved), stageIdOf(c.after, wf.stages, wf.moved));
      if (gate && !canSignStage(gate, team, member, c.after.ownerUid)) reasons.push('move a task past “' + gate.name + '” without its sign-off');
    }
  });
  return [...new Set(reasons)];
}

/** Convert changes into backend write operations (paths are relative to the team). */
export function changesToOps(changes, me) {
  const now = Date.now(); const ops = [];
  changes.forEach(c => {
    if (c.kind === 'weeks') { ops.push({ type: 'update', path: 'team', data: { weeks: c.after }, base: { weeks: clone(c.before) } }); return; }
    const coll = c.kind === 'cat' ? 'categories' : 'tasks';
    const path = coll + '/' + c.id;
    if (!c.after) { ops.push({ type: 'delete', path }); return; }
    if (!c.before) {
      const data = { ...c.after };
      if (coll === 'tasks') Object.assign(data, { createdBy: me.uid, createdAt: now, updatedBy: me.name, updatedAt: now });
      ops.push({ type: 'set', path, data });
      return;
    }
    const data = {}; const base = {};
    Object.keys(c.after).forEach(k => {
      if (same(c.before[k], c.after[k])) return;
      data[k] = c.after[k];
      // Lists and objects (sub-tasks, time log, custom fields…) are written whole. Keep what they were,
      // so a teammate's save of the same field at the same moment can be merged back in (healLostEdits).
      if (c.after[k] && typeof c.after[k] === 'object') base[k] = clone(c.before[k]);
    });
    if (coll === 'tasks') Object.assign(data, { updatedBy: me.name, updatedAt: now });
    ops.push(Object.keys(base).length ? { type: 'update', path, data, base } : { type: 'update', path, data });
  });
  return ops;
}

/** Ops that force entities to the given values (used by undo/redo). */
export function restoreOps(changes, me, which) {
  const now = Date.now(); const other = which === 'before' ? 'after' : 'before';
  return changes.map(c => {
    const target = c[which];
    if (c.kind === 'weeks') return { type: 'update', path: 'team', data: { weeks: target } };
    const path = (c.kind === 'cat' ? 'categories/' : 'tasks/') + c.id;
    if (!target) return { type: 'delete', path };
    const data = { ...target };
    if (c.kind === 'task') Object.assign(data, { updatedBy: me.name, updatedAt: now });
    // Entity still exists → update (keeps createdBy etc.); it was deleted → recreate.
    if (c[other]) return { type: 'update', path, data };
    if (c.kind === 'task') Object.assign(data, { createdBy: me.uid, createdAt: now });
    return { type: 'set', path, data };
  });
}

/** Merge two consecutive change lists (for coalescing rapid edits into one undo step). */
export function mergeChanges(older, newer) {
  const key = (c) => c.kind + ':' + (c.id || '');
  const map = new Map(older.map(c => [key(c), { ...c }]));
  newer.forEach(c => {
    const k = key(c);
    if (map.has(k)) map.get(k).after = c.after; else map.set(k, { ...c });
  });
  return [...map.values()].filter(c => !same(c.before, c.after));
}

export function invert(changes) { return changes.map(c => ({ ...c, before: c.after, after: c.before })); }

/** Turn raw task docs into clean tasks (exported for tests/backends). */
export function cleanTasks(raw, fields) { return raw.map(t => cleanTask(t, t.id, fields)); }

// ── Two people saving the same thing at once ────────────────────────────────
// Lists and objects are saved whole, so when two people save the same task within a moment of each
// other, the later save can wipe out the earlier one's change (two sub-tasks ticked, two weeks added).
// merge3 combines both: base = the value before my edit, mine = what I saved, theirs = what is saved
// now. Changes to different items/keys are all kept; when both changed the very same value, the saved
// one (theirs) stays, so two browsers never fight over it.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Equal content, ignoring the order of object keys (the database may return keys sorted). */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) { const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined); return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k])); }
  return false;
}
const itemKey = (x) => (isObj(x) ? (x.id != null ? 'id:' + x.id : x.key != null ? 'key:' + x.key : null) : null);
const canon = (v) => (Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : isObj(v) ? '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v));

export function merge3(base, mine, theirs) {
  if (deepEqual(mine, theirs) || deepEqual(base, mine)) return theirs;
  if (deepEqual(base, theirs)) return mine;
  if (isObj(base) && isObj(mine) && isObj(theirs)) {
    const out = { ...theirs };
    new Set([...Object.keys(base), ...Object.keys(mine)]).forEach(k => { const v = merge3(base[k], mine[k], theirs[k]); if (v === undefined) delete out[k]; else out[k] = v; });
    return out;
  }
  if (Array.isArray(base) && Array.isArray(mine) && Array.isArray(theirs)) return mergeList(base, mine, theirs);
  return theirs;
}

function mergeList(base, mine, theirs) {
  const keyed = [base, mine, theirs].every(l => l.every(x => itemKey(x) !== null));
  const k = keyed ? itemKey : canon;
  const inBase = new Map(base.map(x => [k(x), x])), inMine = new Map(mine.map(x => [k(x), x]));
  // Their list, minus what I removed, with my edits to items we both still have.
  let out = theirs.filter(x => !(inBase.has(k(x)) && !inMine.has(k(x))))
    .map(x => (keyed && inBase.has(k(x)) && inMine.has(k(x)) ? merge3(inBase.get(k(x)), inMine.get(k(x)), x) : x));
  // If I reordered the list and they didn't, use my order.
  const order = (l, keys) => l.map(k).filter(x => keys.has(x));
  const common = new Set(base.map(k).filter(x => inMine.has(x) && theirs.some(t => k(t) === x)));
  if (keyed && order(base, common).join('|') !== order(mine, common).join('|') && order(base, common).join('|') === order(theirs, common).join('|')) {
    const pos = new Map(mine.map((x, i) => [k(x), i])); const theirsOnly = out.filter(x => !pos.has(k(x)));
    out = out.filter(x => pos.has(k(x))).sort((a, b) => pos.get(k(a)) - pos.get(k(b)));
    theirsOnly.forEach(x => { const prev = theirs[theirs.findIndex(t => k(t) === k(x)) - 1]; const at = prev ? out.findIndex(o => k(o) === k(prev)) + 1 : 0; out.splice(at, 0, x); });
  }
  // What I added goes after the item it followed in my list.
  mine.forEach((x, i) => {
    if (inBase.has(k(x)) || out.some(o => k(o) === k(x))) return;
    let at = 0; for (let j = i - 1; j >= 0; j--) { const p = out.findIndex(o => k(o) === k(mine[j])); if (p > -1) { at = p + 1; break; } }
    out.splice(at, 0, x);
  });
  return out;
}
