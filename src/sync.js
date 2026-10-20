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
import { cleanTask, TASK_CONTENT_FIELDS } from './model.js';
import { LIMITS } from './config.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Deep copy. The board edits nested arrays/objects in place (sub-tasks, custom fields,
// attachments), so the board model and the last-saved state must never share them, or an
// edit changes both and the diff sees nothing to save.
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Value used when the board leaves a task field unset (matches cleanTask's output).
const TASK_DEFAULTS = {
  name: '', priority: 'Minor', status: '', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none',
  dueDate: '', phaseId: '', repeat: null, stage: '', effort: null, dependsOn: [], carryOf: '', skill: '', timeLog: [], completedDate: '', subtasks: [], history: [], custom: {}, icon: '', attachments: [],
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
export function deniedChanges(changes, team, member) {
  const reasons = [];
  changes.forEach(c => {
    if (c.kind === 'weeks') { if (!can(team, member, 'weeks.manage')) reasons.push('change weeks'); return; }
    const owners = [c.before?.ownerUid, c.after?.ownerUid].filter(Boolean);
    if (!owners.every(o => canEditOwnedBy(team, member, o))) reasons.push(c.kind === 'cat' ? 'edit this category' : 'edit this task');
  });
  return [...new Set(reasons)];
}

/** Convert changes into backend write operations (paths are relative to the team). */
export function changesToOps(changes, me) {
  const now = Date.now(); const ops = [];
  changes.forEach(c => {
    if (c.kind === 'weeks') { ops.push({ type: 'update', path: 'team', data: { weeks: c.after } }); return; }
    const coll = c.kind === 'cat' ? 'categories' : 'tasks';
    const path = coll + '/' + c.id;
    if (!c.after) { ops.push({ type: 'delete', path }); return; }
    if (!c.before) {
      const data = { ...c.after };
      if (coll === 'tasks') Object.assign(data, { createdBy: me.uid, createdAt: now, updatedBy: me.name, updatedAt: now });
      ops.push({ type: 'set', path, data });
      return;
    }
    const data = {};
    Object.keys(c.after).forEach(k => { if (!same(c.before[k], c.after[k])) data[k] = c.after[k]; });
    if (coll === 'tasks') Object.assign(data, { updatedBy: me.name, updatedAt: now });
    ops.push({ type: 'update', path, data });
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
