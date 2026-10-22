import { isAcademicEmail, EDU_TEAMS_PER_YEAR } from './model.js';
// ─────────────────────────────────────────────────────────────────────────────
//  JavaScript copy of firestore.rules, used by the DEMO backend so that demo
//  mode enforces exactly the permissions production does. Keep in step with
//  firestore.rules (tests/rules.test.mjs runs the same scenarios on both).
// ─────────────────────────────────────────────────────────────────────────────
import { PRIORITIES, FLAGS } from './model.js';

const ALLOWED = {
  team: ['name', 'logo', 'ownerUid', 'createdAt', 'roles', 'fields', 'labels', 'weeks', 'weekNaming', 'phases', 'capacity', 'features', 'subteams', 'plan', 'archiveRev', 'workflow', 'leads', 'purchase', 'autos', 'github', 'currency', 'former'],
  user: ['photo', 'theme', 'menuStyle', 'nav', 'notify', 'updatedAt'],
  member: ['uid', 'email', 'name', 'photo', 'roleId', 'joinedAt'],
  invite: ['email', 'roleId', 'teamName', 'invitedBy', 'invitedByName', 'createdAt'],
  category: ['name', 'ownerUid', 'order'],
  comment: ['taskId', 'authorUid', 'authorName', 'text', 'mentions', 'createdAt', 'editedAt'],
  template: ['name', 'task', 'createdBy', 'createdByName', 'createdAt'],
  meeting: ['title', 'date', 'attendees', 'notes', 'actions', 'createdBy', 'createdByName', 'createdAt', 'updatedAt', 'updatedByName'],
  note: ['taskId', 'authorUid', 'authorName', 'date', 'text', 'images', 'createdAt', 'editedAt'],
  part: ['name', 'partNo', 'supplier', 'url', 'qty', 'unitCost', 'status', 'neededBy', 'orderedDate', 'receivedDate', 'taskId', 'budgetId', 'notes', 'extras', 'subteamId', 'createdBy', 'createdByName', 'createdAt', 'updatedAt', 'approval'],
  expense: ['kind', 'amount', 'date', 'description', 'budgetId', 'payer', 'receiptUrl', 'receiptImage', 'taskId', 'partId', 'partIds', 'createdBy', 'createdByName', 'createdAt', 'updatedAt'],
  budget: ['currency', 'lines', 'updatedAt'],
  log: ['at', 'by', 'byName', 'kind', 'text'],
  plan: ['tier', 'edu', 'until', 'by', 'at', 'note'],
  planRequest: ['teamId', 'teamName', 'members', 'wants', 'note', 'by', 'byName', 'email', 'at', 'status', 'decidedAt'],
  profile: ['capacity', 'skills', 'away', 'updatedAt'],
  risk: ['title', 'detail', 'likelihood', 'impact', 'ownerUid', 'status', 'mitigation', 'taskIds', 'reviewDate', 'createdBy', 'createdByName', 'createdAt', 'updatedAt'],
  requirement: ['ref', 'title', 'detail', 'priority', 'status', 'taskIds', 'verification', 'verified', 'verifiedBy', 'verifiedDate', 'createdBy', 'createdByName', 'createdAt', 'updatedAt'],
  paper: ['title', 'authors', 'year', 'venue', 'doi', 'url', 'notes', 'tags', 'status', 'taskIds', 'addedBy', 'addedByName', 'createdAt', 'updatedAt'],
  task: ['name', 'priority', 'status', 'jiraId', 'supportPersonId', 'supportPersonId2', 'flag', 'dueDate', 'startDate', 'checks', 'signoff', 'phaseId', 'repeat', 'stage', 'effort', 'dependsOn', 'carryOf', 'skill', 'timeLog', 'completedDate', 'subtasks', 'history', 'custom', 'icon', 'attachments', 'categoryId', 'ownerUid', 'weekId', 'order', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'],
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class Denied extends Error { constructor(msg) { super('Missing or insufficient permissions: ' + msg); this.code = 'permission-denied'; } }
const deny = (m) => { throw new Denied(m); };
const hasOnly = (obj, keys) => Object.keys(obj).every(k => keys.includes(k));
const changedKeys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter(k => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]));

function validTeam(d) {
  return hasOnly(d, ALLOWED.team) && typeof d.name === 'string' && d.name.length > 0 && d.name.length <= 80 &&
    typeof d.logo === 'string' && d.logo.length <= 220000 && Array.isArray(d.fields) && d.fields.length <= 30 &&
    Array.isArray(d.weeks) && d.weeks.length <= 200 && d.roles && typeof d.roles === 'object' && d.labels && typeof d.labels === 'object' &&
    ['sequence', 'calendar'].includes(d.weekNaming === undefined ? 'sequence' : d.weekNaming) &&
    (d.phases === undefined || (Array.isArray(d.phases) && d.phases.length <= 20)) &&
    (d.capacity === undefined || (typeof d.capacity === 'number' && d.capacity >= 0 && d.capacity <= 80)) &&
    (d.features === undefined || (d.features && typeof d.features === 'object' && !Array.isArray(d.features) && Object.keys(d.features).length <= 30 && Object.values(d.features).every(v => typeof v === 'boolean'))) &&
    (d.subteams === undefined || (Array.isArray(d.subteams) && d.subteams.length <= 20)) &&
    (d.plan === undefined || validPlan(d.plan)) && (d.archiveRev === undefined || Number.isInteger(d.archiveRev)) &&
    (d.workflow === undefined || d.workflow === null || (d.workflow && typeof d.workflow === 'object' && hasOnly(d.workflow, ['stages', 'moved', 'order', 'gates', 'next', 'done']) && Array.isArray(d.workflow.stages) && d.workflow.stages.length >= 2 && d.workflow.stages.length <= 10)) &&
    (d.purchase === undefined || d.purchase === null || (typeof d.purchase === 'object' && hasOnly(d.purchase, ['on', 'over']) && (d.purchase.on === undefined || typeof d.purchase.on === 'boolean') && (d.purchase.over === undefined || isNum(d.purchase.over, 0, 1e8)))) &&
    (d.currency === undefined || ['GBP', 'EUR', 'USD', 'INR', 'CHF', 'JPY', 'CNY', 'AUD', 'CAD'].includes(d.currency)) &&
    (d.github === undefined || d.github === null || (typeof d.github === 'object' && hasOnly(d.github, ['repo', 'issues', 'done', 'owner', 'connectedAt', 'write', 'last']) && (d.github.repo === undefined || isStr(d.github.repo, 140)))) &&
    (d.autos === undefined || d.autos === null || (typeof d.autos === 'object' && hasOnly(d.autos, ['partsTo', 'tellWaiting', 'remindDays']) && (d.autos.partsTo === undefined || isStr(d.autos.partsTo, 40)) &&
      (d.autos.tellWaiting === undefined || typeof d.autos.tellWaiting === 'boolean') && (d.autos.remindDays === undefined || (Number.isInteger(d.autos.remindDays) && d.autos.remindDays >= 0 && d.autos.remindDays <= 60))));
}
function validPhoto(d) { const p = d.photo === undefined ? '' : d.photo; return typeof p === 'string' && p.length <= 60000; }
function validComment(d) {
  return hasOnly(d, ALLOWED.comment) && typeof d.taskId === 'string' && d.taskId.length <= 64 && typeof d.authorUid === 'string' &&
    typeof d.authorName === 'string' && d.authorName.length <= 80 && typeof d.text === 'string' && d.text.length > 0 && d.text.length <= 2000 &&
    Array.isArray(d.mentions) && d.mentions.length <= 20 && typeof d.createdAt === 'number' && (d.editedAt === undefined || typeof d.editedAt === 'number');
}
const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const isNum = (v, min, max) => typeof v === 'number' && v >= min && v <= max;
function validMeeting(d) {
  return hasOnly(d, ALLOWED.meeting) && isStr(d.title, 120) && isStr(d.date, 10) && Array.isArray(d.attendees) && d.attendees.length <= 50 &&
    isStr(d.notes, 20000) && Array.isArray(d.actions) && d.actions.length <= 50 && typeof d.createdBy === 'string' && typeof d.createdAt === 'number';
}
function validNote(d) {
  return hasOnly(d, ALLOWED.note) && isStr(d.taskId, 64) && typeof d.authorUid === 'string' && isStr(d.authorName, 80) && isStr(d.date, 10) &&
    isStr(d.text, 10000) && Array.isArray(d.images) && d.images.length <= 4 && typeof d.createdAt === 'number';
}
function validPart(d) {
  return hasOnly(d, ALLOWED.part) && isStr(d.name, 200) && d.name.length > 0 && isNum(d.qty, 0, 100000) && isNum(d.unitCost, 0, 1e8) &&
    ['needed', 'ordered', 'received', 'cancelled'].includes(d.status) && isStr(d.notes, 2000) && validApproval(d.approval) && (d.extras === undefined || (Array.isArray(d.extras) && d.extras.length <= 10)) && typeof d.createdBy === 'string' && typeof d.createdAt === 'number';
}
/** Purchase approvals (firestore.rules ▸ validApproval / partApproval / purchaseOk / costKept). */
function validApproval(v) {
  return v === undefined || v === null || (typeof v === 'object' && hasOnly(v, ['status', 'by', 'byName', 'at', 'amount', 'approver', 'approverName', 'note', 'decidedAt']) &&
    ['waiting', 'approved', 'declined'].includes(v.status) && (v.amount === undefined || typeof v.amount === 'number') && (v.note === undefined || isStr(v.note, 500)) && (v.by === undefined || typeof v.by === 'string'));
}
function partApproval(T0, auth, can, before, after) {
  const v = after.approval || null; const old = (before && before.approval) || null;
  if (v === null || JSON.stringify(v) === JSON.stringify(old)) return true;
  if (v.status === 'waiting') return v.by === auth.uid;
  return v.approver === auth.uid && (T0.doc.ownerUid === auth.uid || (can('finance.edit') && v.by !== auth.uid));
}
function purchaseOk(T0, before, after) {
  const pc = T0.doc.purchase; const out = ['ordered', 'received'].includes(after.status) && !(before && ['ordered', 'received'].includes(before.status));
  return !pc || pc.on !== true || !out || after.qty * after.unitCost <= (pc.over || 0) || !!(after.approval && after.approval.status === 'approved');
}
function costKept(can, before, after) {
  const old = before.approval || null;
  if (!old || old.status !== 'approved' || JSON.stringify(after.approval || null) !== JSON.stringify(old) || can('finance.edit')) return true;
  return after.qty === before.qty && after.unitCost === before.unitCost && JSON.stringify(after.extras || []) === JSON.stringify(before.extras || []);
}
function validExpense(d) {
  return hasOnly(d, ALLOWED.expense) && ['expense', 'income'].includes(d.kind) && isNum(d.amount, 0, 1e8) && isStr(d.date, 10) && isStr(d.description, 300) &&
    (d.receiptImage === undefined || isStr(d.receiptImage, 200000)) && (d.partIds === undefined || (Array.isArray(d.partIds) && d.partIds.length <= 30)) && typeof d.createdBy === 'string' && typeof d.createdAt === 'number';
}
function validBudget(d) { return hasOnly(d, ALLOWED.budget) && isStr(d.currency, 3) && Array.isArray(d.lines) && d.lines.length <= 50; }
function validPaper(d) {
  return hasOnly(d, ALLOWED.paper) && isStr(d.title, 500) && d.title.length > 0 && isStr(d.authors, 500) && isStr(d.notes, 5000) &&
    Array.isArray(d.tags) && d.tags.length <= 20 && ['to-read', 'reading', 'read'].includes(d.status) && Array.isArray(d.taskIds) && d.taskIds.length <= 20 &&
    typeof d.addedBy === 'string' && typeof d.createdAt === 'number';
}
function validProfile(d) {
  return hasOnly(d, ALLOWED.profile) && (d.capacity === undefined || isNum(d.capacity, 0, 80)) && (d.skills === undefined || (Array.isArray(d.skills) && d.skills.length <= 20)) &&
    (d.away === undefined || (Array.isArray(d.away) && d.away.length <= 30));
}
function validRisk(d) {
  return hasOnly(d, ALLOWED.risk) && isStr(d.title, 200) && d.title.length > 0 && isStr(d.detail, 2000) && isNum(d.likelihood, 1, 5) && isNum(d.impact, 1, 5) &&
    ['open', 'mitigating', 'closed'].includes(d.status) && isStr(d.mitigation, 2000) && Array.isArray(d.taskIds) && d.taskIds.length <= 20 && typeof d.createdBy === 'string' && typeof d.createdAt === 'number';
}
function validRequirement(d) {
  return hasOnly(d, ALLOWED.requirement) && isStr(d.ref, 20) && isStr(d.title, 300) && d.title.length > 0 && isStr(d.detail, 3000) && ['must', 'should', 'could'].includes(d.priority) &&
    ['draft', 'agreed', 'met', 'dropped'].includes(d.status) && Array.isArray(d.taskIds) && d.taskIds.length <= 30 && isStr(d.verification, 1000) && typeof d.verified === 'boolean' &&
    typeof d.createdBy === 'string' && typeof d.createdAt === 'number';
}
function validTemplate(d) {
  return hasOnly(d, ALLOWED.template) && typeof d.name === 'string' && d.name.length > 0 && d.name.length <= 80 && d.task && typeof d.task === 'object' && !Array.isArray(d.task) &&
    typeof d.createdBy === 'string' && typeof d.createdAt === 'number' && JSON.stringify(d.task).length <= 40000;
}
function validCat(d) { return hasOnly(d, ALLOWED.category) && typeof d.name === 'string' && d.name.length <= 80 && typeof d.ownerUid === 'string' && typeof d.order === 'number'; }
function validTask(d) {
  return hasOnly(d, ALLOWED.task) && typeof d.name === 'string' && d.name.length <= 500 && PRIORITIES.includes(d.priority) && FLAGS.includes(d.flag) &&
    typeof d.categoryId === 'string' && typeof d.ownerUid === 'string' && typeof d.weekId === 'string' && typeof d.order === 'number' &&
    Array.isArray(d.subtasks) && d.subtasks.length <= 100 && Array.isArray(d.history) && d.history.length <= 100 &&
    d.custom && typeof d.custom === 'object' && !Array.isArray(d.custom) && Array.isArray(d.attachments) && d.attachments.length <= 30 &&
    typeof d.icon === 'string' && d.icon.length <= 40000 &&
    (d.phaseId === undefined || (typeof d.phaseId === 'string' && d.phaseId.length <= 64)) &&
    (d.repeat === undefined || d.repeat === null || (typeof d.repeat === 'object' && !Array.isArray(d.repeat))) &&
    (d.stage === undefined || (typeof d.stage === 'string' && /^[A-Za-z0-9_-]{0,40}$/.test(d.stage))) &&
    (d.effort === undefined || d.effort === null || (typeof d.effort === 'number' && d.effort >= 0 && d.effort <= 999)) &&
    (d.dependsOn === undefined || (Array.isArray(d.dependsOn) && d.dependsOn.length <= 10 && d.dependsOn.every(x => typeof x === 'string'))) &&
    (d.carryOf === undefined || (typeof d.carryOf === 'string' && d.carryOf.length <= 64)) &&
    (d.startDate === undefined || (typeof d.startDate === 'string' && d.startDate.length <= 10)) &&
    (d.checks === undefined || (!!d.checks && typeof d.checks === 'object' && !Array.isArray(d.checks) && Object.keys(d.checks).length <= 50)) &&
    (d.skill === undefined || (typeof d.skill === 'string' && d.skill.length <= 40)) &&
    (d.timeLog === undefined || (Array.isArray(d.timeLog) && d.timeLog.length <= 200));
}

/**
 * Check one write against the PRE-batch state `pre` (like get()/exists() in rules),
 * with `post` = state after the whole batch (like getAfter()).
 * auth = { uid, email, emailVerified }
 */
const validPlan = (p) => !!p && typeof p === 'object' && hasOnly(p, ALLOWED.plan) && ['free', 'pro', 'org'].includes(p.tier) &&
  (p.edu === undefined || typeof p.edu === 'boolean') && (p.until === undefined || typeof p.until === 'number') && (p.note === undefined || isStr(p.note, 200));
const validPlanRequest = (d, uid) => hasOnly(d, ALLOWED.planRequest) && ['pro', 'edu', 'org'].includes(d.wants) && d.status === 'open' && d.by === uid &&
  isStr(d.note, 1000) && isStr(d.teamName, 80);
const validLog = (d) => hasOnly(d, ALLOWED.log) && typeof d.at === 'number' && typeof d.by === 'string' && isStr(d.byName, 80) &&
  ['budget', 'spending', 'income', 'parts'].includes(d.kind) && typeof d.text === 'string' && d.text.length > 0 && d.text.length <= 600;

const validWhiteboard = (d) => hasOnly(d, ['name', 'createdBy', 'createdByName', 'createdAt', 'updatedAt']) && typeof d.name === 'string' && d.name.length > 0 && d.name.length <= 80 && typeof d.createdBy === 'string' && typeof d.createdAt === 'number';
const validWbItem = (d) => hasOnly(d, ['boardId', 'kind', 'x', 'y', 'w', 'h', 'text', 'color', 'taskId', 'from', 'to', 'z', 'createdBy', 'updatedAt', 'shape', 'path']) &&
  typeof d.boardId === 'string' && d.boardId.length > 0 && d.boardId.length <= 64 && ['note', 'text', 'title', 'task', 'link', 'shape', 'pen', 'frame'].includes(d.kind) &&
  (d.shape === undefined || isStr(d.shape, 12)) && (d.path === undefined || isStr(d.path, 6000)) &&
  ['x', 'y', 'w', 'h'].every(k => typeof d[k] === 'number') && isStr(d.text, 2000) &&
  ['color', 'taskId', 'from', 'to'].every(k => d[k] === undefined || isStr(d[k], k === 'color' ? 20 : 64)) && typeof d.createdBy === 'string';
/** SelfTrack items (firestore.rules ▸ validSelf). */
const SELF_KEYS = ['uid', 'kind', 'title', 'area', 'scope', 'date', 'done', 'doneOn', 'order', 'createdAt', 'updatedAt', 'note', 'log', 'goal', 'skillId', 'mood', 'well', 'hard', 'areas', 'sync', 'archived', 'color'];
const optStr = (d, k, n) => d[k] === undefined || isStr(d[k], n);
const optNum = (d, k) => d[k] === undefined || typeof d[k] === 'number';
const optBool = (d, k) => d[k] === undefined || typeof d[k] === 'boolean';
export const validSelf = (d, uid) => !!d && hasOnly(d, SELF_KEYS) && d.uid === uid && ['task', 'habit', 'skill', 'learning', 'reflect', 'settings'].includes(d.kind) &&
  optStr(d, 'title', 300) && optStr(d, 'area', 40) && optStr(d, 'note', 2000) && optStr(d, 'well', 2000) && optStr(d, 'hard', 2000) &&
  optStr(d, 'date', 10) && optStr(d, 'doneOn', 10) && optStr(d, 'skillId', 64) && optStr(d, 'color', 20) &&
  (d.scope === undefined || ['day', 'week'].includes(d.scope)) && optBool(d, 'done') && optBool(d, 'archived') &&
  optNum(d, 'goal') && optNum(d, 'mood') && optNum(d, 'order') &&
  (d.log === undefined || (Array.isArray(d.log) && d.log.length <= 800)) && (d.areas === undefined || (Array.isArray(d.areas) && d.areas.length <= 12)) &&
  (d.sync === undefined || (!!d.sync && typeof d.sync === 'object' && !Array.isArray(d.sync) && Object.keys(d.sync).length <= 50));

/** Sign-off gates (firestore.rules ▸ signoffGates), using the index stored with the workflow. */
function signoffGates(T0, auth, meMember, before, after) {
  const wf = T0 && T0.doc.workflow; if (!wf || !wf.next) return true;
  const ord = (d) => (d.flag === 'completed' ? wf.done : (wf.order[d.stage || ''] ?? 0));
  const v = after.signoff || null;
  const a = v && v.status === 'approved' ? (wf.order[v.stage || ''] ?? -1) : -1;
  const from = ord(before), to = ord(after);
  const nx = (i) => (wf.next[i] ?? Infinity);
  if (!(to <= from || nx(from) >= to || (a >= 0 && nx(from) === a && nx(a + 1) >= to))) return false;
  if (!v || v.status === 'waiting' || JSON.stringify(before.signoff || null) === JSON.stringify(v)) return true;
  const g = wf.gates[v.stage || '']; if (!g) return false;
  const owner = after.ownerUid; const admin = !!meMember && ['owner', 'admin'].includes(meMember.roleId);
  if (T0.doc.ownerUid === auth.uid) return true;
  if (auth.uid === owner) return false;
  if (g.k === 'admin') return admin;
  if (g.k === 'person') return auth.uid === g.s || admin;
  const leads = (T0.doc.leads || {})[owner] || [];
  return leads.length ? leads.includes(auth.uid) : admin;
}
/** A task's sign-off (firestore.rules ▸ validSignoff): shape, and a decision only by the approver it names. */
function validSignoff(after, before, auth) {
  const v = after.signoff; if (v === undefined || v === null) return true;
  if (!(typeof v === 'object' && hasOnly(v, ['stage', 'status', 'by', 'byName', 'at', 'approver', 'approverName', 'note', 'decidedAt', 'remindedAt']) && ['waiting', 'approved', 'changes'].includes(v.status)
    && (v.note === undefined || isStr(v.note, 500)) && (v.stage === undefined || isStr(v.stage, 40)))) return false;
  return v.status === 'waiting' || (before && JSON.stringify(before.signoff) === JSON.stringify(v)) || v.approver === auth.uid;
}

/** A verified university email on the account, or one proved by code (verifiedStudents, server-written). */
function academicOf(store, auth) {
  if (auth.emailVerified && isAcademicEmail(auth.email)) return true;
  const v = store.root && store.root.verifiedStudents && store.root.verifiedStudents[auth.uid];
  return !!v && v.until > Date.now();
}
/** Documents outside teams (path '/coll/id'). */
function checkRootWrite(pre, post, auth, op) {
  const [coll, id] = op.path.slice(1).split('/');
  const before = pre.root?.[coll]?.[id]; const after = post.root?.[coll]?.[id];
  if (coll === 'clientErrors') {
    if (!after || before) deny('error reports are create-only');
    if (!(hasOnly(after, ['kind', 'msg', 'stack', 'where', 'ua', 'build', 'at', 'uid', 'expireAt']) && after.uid === auth.uid && ['error', 'promise', 'write'].includes(after.kind) &&
      isStr(after.msg, 300) && isStr(after.stack, 2000) && isStr(after.ua, 200) && after.expireAt !== undefined)) deny('error report');
    return;
  }
  if (coll === 'feedback') {
    if (!after || before) deny('feedback is create-only');
    if (!(hasOnly(after, ['kind', 'text', 'where', 'teamId', 'ua', 'build', 'at', 'uid', 'email', 'name', 'errors', 'expireAt']) && after.uid === auth.uid &&
      ['bug', 'idea', 'question', 'other'].includes(after.kind) && typeof after.text === 'string' && after.text.length >= 1 && after.text.length <= 2000 &&
      isStr(after.where, 100) && isStr(after.teamId, 64) && isStr(after.ua, 200) && isStr(after.build, 40) && isStr(after.name, 80) &&
      (after.email === '' || after.email === auth.email) && Array.isArray(after.errors) && after.errors.length <= 5 && after.expireAt !== undefined)) deny('feedback');
    return;
  }
  if (coll === 'selfItems') {
    if (before && before.uid !== auth.uid) deny('not your SelfTrack item');
    if (!after) return;
    if (!validSelf(after, auth.uid)) deny('SelfTrack item');
    return;
  }
  if (coll === 'eduClaims') {
    const year = new Date().getUTCFullYear();
    if (!after || id !== auth.uid || !academicOf(pre, auth)) deny('edu claim');
    if (!(hasOnly(after, ['year', 'teams']) && after.year === year && Array.isArray(after.teams) && after.teams.length <= EDU_TEAMS_PER_YEAR)) deny('edu claim shape');
    if (before && before.year === year && !before.teams.every(t => after.teams.includes(t))) deny('edu claims are only added to');
    return;
  }
  deny('not writable');
}

export function checkWrite(pre, post, auth, teamId, op) {
  if (!auth) deny('signed out');
  if (op.path.startsWith('/')) return checkRootWrite(pre, post, auth, op);
  const T0 = pre.teams[teamId]; const T1 = post.teams[teamId];
  const meMember = T0 && T0.members[auth.uid];
  const roleId = meMember && meMember.roleId;
  const can = (p) => !!meMember && (roleId === 'owner' || !!(T0.doc.roles?.[roleId]?.perms?.[p]));
  const canEditOwned = (owner) => can('tasks.editAll') || (can('tasks.editOwn') && owner === auth.uid);
  const myEmail = (auth.email || '').toLowerCase();
  const isAdmin = !!(pre.admins && pre.admins[auth.uid]);
  const [coll, id] = op.path === 'team' ? ['team', null] : op.path.split('/');
  const before = coll === 'team' ? T0?.doc : T0?.[coll]?.[id];
  const after = op.type === 'delete' ? null : (op.type === 'update' ? { ...(before || {}), ...op.data } : op.data);
  if (op.type === 'update' && !before) deny('no document to update');
  const isCreate = !before && after; const isDelete = !after;

  switch (coll) {
    case 'team': {
      if (isCreate) { if (!(after.ownerUid === auth.uid && validTeam(after) && (after.plan === undefined || after.plan.tier === 'free'))) deny('create team'); return; }
      if (isDelete) { if (!(meMember && roleId === 'owner')) deny('delete team'); return; }
      { const ch0 = changedKeys(before, after);
        if (ch0.length && ch0.every(k => k === 'plan')) {
          if (isAdmin) { if (!(validPlan(after.plan) && after.plan.by === auth.uid)) deny('plan'); return; }
          // Verified university email: free Pro Education, up to 400 days at a time, never over an Organisation plan.
          const now = Date.now(), p = after.plan;
          const claim = post.root && post.root.eduClaims && post.root.eduClaims[auth.uid];
          if (academicOf(pre, auth) && ['owner', 'admin'].includes(roleId) && validPlan(p) && p.tier === 'pro' && p.edu === true && p.by === auth.uid &&
            p.until > now && p.until <= now + 400 * 864e5 && ((before.plan || {}).tier || 'free') !== 'org' &&
            claim && claim.year === new Date().getUTCFullYear() && claim.teams.includes(teamId)) return;
          deny('plan');
        } }
      if (!meMember) deny('not a member');
      if (!validTeam(after) || after.ownerUid !== before.ownerUid || after.createdAt !== before.createdAt) deny('invalid team update');
      const ch = changedKeys(before, after);
      if (!ch.every(k => ['weeks', 'name', 'logo', 'fields', 'labels', 'roles', 'weekNaming', 'phases', 'capacity', 'features', 'subteams', 'archiveRev', 'workflow', 'leads', 'purchase', 'autos', 'github', 'currency', 'former'].includes(k))) deny('field not editable');
      if (ch.includes('archiveRev') && !(can('tasks.editOwn') || can('tasks.editAll'))) deny('archiveRev');
      if ((ch.includes('subteams') || ch.includes('leads')) && !(can('team.settings') || can('members.manage'))) deny('sub-teams');
      if (ch.includes('weeks') && !can('weeks.manage')) deny('weeks');
      if (ch.some(k => ['name', 'logo', 'fields', 'labels', 'weekNaming', 'phases', 'capacity', 'features', 'workflow'].includes(k)) && !can('team.settings')) deny('settings');
      if (ch.includes('roles') && !can('roles.manage')) deny('roles');
      if ((ch.includes('autos') || ch.includes('github')) && !can('team.settings')) deny('automatic steps');
      if (ch.includes('github') && after.github && ((after.github.repo || '') !== ((before.github || {}).repo || '') || !!after.github.write !== !!(before.github || {}).write)) deny('github repo and token are set by the server');
      if ((ch.includes('purchase') || ch.includes('currency')) && !(can('team.settings') || can('finance.edit'))) deny('purchase approvals / currency');
      if (ch.includes('former') && !can('members.manage')) deny('former members');
      return;
    }
    case 'members': {
      if (isCreate) {
        if (id !== auth.uid || after.uid !== auth.uid || !hasOnly(after, ALLOWED.member) || !validPhoto(after)) deny('member create');
        const founder = after.roleId === 'owner' && !T0 && T1 && T1.doc.ownerUid === auth.uid;
        const inv = T0 && auth.emailVerified && T0.invites[myEmail];
        const invited = !!inv && after.roleId === inv.roleId && after.roleId !== 'owner' && after.email === myEmail;
        if (!founder && !invited) deny('join team');
        return;
      }
      if (!meMember) deny('not a member');
      if (isDelete) {
        const ownerClosingTeam = before.roleId === 'owner' && id === auth.uid && !T1;   // team deleted in the same batch
        if (!(ownerClosingTeam || (before.roleId !== 'owner' && can('members.manage')))) deny('remove member');
        return;
      }
      const ch = changedKeys(before, after);
      const roleChange = can('members.manage') && id !== auth.uid && ch.every(k => k === 'roleId') && before.roleId !== 'owner' && after.roleId !== 'owner' && !!T0.doc.roles?.[after.roleId];
      const selfEdit = id === auth.uid && ch.every(k => ['name', 'photo'].includes(k)) && validPhoto(after);
      if (!roleChange && !selfEdit) deny('edit member');
      return;
    }
    case 'invites': {
      const invitee = auth.emailVerified && id === myEmail;
      if (isDelete) { if (!(can('members.manage') || invitee)) deny('delete invite'); return; }
      if (!(can('members.manage') && after.email === id && EMAIL_RE.test(id) && after.roleId !== 'owner' && !!T0.doc.roles?.[after.roleId] && hasOnly(after, ALLOWED.invite))) deny('invite');
      return;
    }
    case 'categories': {
      if (isCreate) { if (!(canEditOwned(after.ownerUid) && validCat(after))) deny('create category'); return; }
      if (isDelete) { if (!canEditOwned(before.ownerUid)) deny('delete category'); return; }
      if (!(canEditOwned(before.ownerUid) && canEditOwned(after.ownerUid) && validCat(after))) deny('edit category');
      return;
    }
    case 'tasks': {
      if (isDelete) { if (!(can('tasks.editAll') || (canEditOwned(before.ownerUid) && before.createdBy === auth.uid && (before.createdAt || 0) > Date.now() - 86400000))) deny('delete task'); return; }
      const catAfter = T1 && T1.categories[after.categoryId];
      if (!catAfter || catAfter.ownerUid !== after.ownerUid) deny('task row mismatch');
      if (isCreate) { if (!(canEditOwned(after.ownerUid) && validTask(after) && validSignoff(after, null, auth))) deny('create task'); return; }
      if (canEditOwned(before.ownerUid) && canEditOwned(after.ownerUid) && validTask(after) && validSignoff(after, before, auth)) { if (!signoffGates(T0, auth, meMember, before, after)) deny('sign-off gate'); return; }
      // Recording a sign-off decision (firestore.rules ▸ signoffDecision)
      const ch = changedKeys(before, after);
      if (meMember && before.signoff && before.signoff.status === 'waiting' && ch.every(k => ['signoff', 'stage', 'flag', 'completedDate', 'history', 'updatedBy', 'updatedAt'].includes(k))
        && after.signoff && ['approved', 'changes'].includes(after.signoff.status) && after.signoff.approver === auth.uid && validTask(after) && validSignoff(after, before, auth)) { if (!signoffGates(T0, auth, meMember, before, after)) deny('sign-off gate'); return; }
      deny('edit task');
    }
    case 'comments': {
      if (!meMember) deny('not a member');
      // Anyone who can edit tasks (their own or everyone's) can comment; viewers read only.
      if (isCreate) { if (!((can('tasks.editOwn') || can('tasks.editAll')) && after.authorUid === auth.uid && validComment(after))) deny('comment'); return; }
      if (isDelete) { if (!(before.authorUid === auth.uid || can('members.manage'))) deny('delete comment'); return; }
      const ch = changedKeys(before, after);
      if (!(before.authorUid === auth.uid && ch.every(k => ['text', 'mentions', 'editedAt'].includes(k)) && validComment(after))) deny('edit comment');
      return;
    }
    case 'templates': {
      if (!meMember) deny('not a member');
      // Anyone who can add tasks can save a template; its author or a settings manager can change or delete it.
      if (isCreate) { if (!((can('tasks.editOwn') || can('tasks.editAll')) && after.createdBy === auth.uid && validTemplate(after))) deny('template'); return; }
      if (isDelete) { if (!(before.createdBy === auth.uid || can('team.settings'))) deny('delete template'); return; }
      if (!((before.createdBy === auth.uid || can('team.settings')) && after.createdBy === before.createdBy && validTemplate(after))) deny('edit template');
      return;
    }
    case 'meetings': {
      if (!meMember) deny('not a member');
      const editor = can('tasks.editOwn') || can('tasks.editAll');
      if (isCreate) { if (!(editor && after.createdBy === auth.uid && validMeeting(after))) deny('meeting'); return; }
      if (isDelete) { if (!(before.createdBy === auth.uid || can('team.settings'))) deny('delete meeting'); return; }
      if (!(editor && after.createdBy === before.createdBy && validMeeting(after))) deny('edit meeting');
      return;
    }
    case 'notebook': {
      if (!meMember) deny('not a member');
      if (isCreate) { if (!((can('tasks.editOwn') || can('tasks.editAll')) && after.authorUid === auth.uid && validNote(after))) deny('notebook'); return; }
      if (isDelete) { if (!(before.authorUid === auth.uid || can('members.manage'))) deny('delete note'); return; }
      if (!(before.authorUid === auth.uid && after.authorUid === before.authorUid && validNote(after))) deny('edit note');
      return;
    }
    case 'parts': {
      if (!meMember) deny('not a member');
      const editor = can('tasks.editOwn') || can('tasks.editAll');
      if (isCreate) { if (!(editor && after.createdBy === auth.uid && validPart(after) && partApproval(T0, auth, can, null, after) && purchaseOk(T0, null, after))) deny('part'); return; }
      if (isDelete) { if (!(before.createdBy === auth.uid || can('team.settings'))) deny('delete part'); return; }
      const money = can('finance.view') || can('finance.edit');
      if (!((editor || can('finance.edit')) && after.createdBy === before.createdBy && validPart(after) && ((after.budgetId || '') === (before.budgetId || '') || money))) deny('edit part');
      if (!partApproval(T0, auth, can, before, after)) deny('purchase approval');
      if (!purchaseOk(T0, before, after)) deny('needs purchase approval');
      if (!costKept(can, before, after)) deny('approved cost');
      return;
    }
    case 'profiles': {
      if (!meMember) deny('not a member');
      if (isDelete) { if (!(id === auth.uid || can('members.manage'))) deny('delete profile'); return; }
      if (!((id === auth.uid || can('members.manage')) && validProfile(after))) deny('profile');
      return;
    }
    case 'whiteboards':
    case 'wbItems': {
      if (!meMember) deny('not a member');
      const editor = can('tasks.editOwn') || can('tasks.editAll'); const valid = coll === 'whiteboards' ? validWhiteboard : validWbItem;
      if (isCreate) { if (!(editor && after.createdBy === auth.uid && valid(after))) deny(coll); return; }
      if (isDelete) { if (!(coll === 'wbItems' ? editor : (before.createdBy === auth.uid || can('team.settings')))) deny('delete ' + coll); return; }
      if (!(editor && after.createdBy === before.createdBy && valid(after))) deny('edit ' + coll);
      return;
    }
    case 'risks':
    case 'requirements': {
      if (!meMember) deny('not a member');
      const editor = can('tasks.editOwn') || can('tasks.editAll'); const valid = coll === 'risks' ? validRisk : validRequirement;
      if (isCreate) { if (!(editor && after.createdBy === auth.uid && valid(after))) deny(coll); return; }
      if (isDelete) { if (!(before.createdBy === auth.uid || can('team.settings'))) deny('delete ' + coll); return; }
      if (!(editor && after.createdBy === before.createdBy && valid(after))) deny('edit ' + coll);
      return;
    }
    case 'papers': {
      if (!meMember) deny('not a member');
      const editor = can('tasks.editOwn') || can('tasks.editAll');
      if (isCreate) { if (!(editor && after.addedBy === auth.uid && validPaper(after))) deny('paper'); return; }
      if (isDelete) { if (!(before.addedBy === auth.uid || can('team.settings'))) deny('delete paper'); return; }
      if (!(editor && after.addedBy === before.addedBy && validPaper(after))) deny('edit paper');
      return;
    }
    case 'expenses': {
      if (!can('finance.edit')) deny('finance');
      if (isCreate) { if (!(after.createdBy === auth.uid && validExpense(after))) deny('expense'); return; }
      if (isDelete) return;
      if (!(after.createdBy === before.createdBy && validExpense(after))) deny('edit expense');
      return;
    }
    case 'requests': {
      if (isAdmin && !isCreate && !isDelete) {
        const ch = changedKeys(before, after);
        if (ch.every(k => ['status', 'decidedAt'].includes(k)) && ['approved', 'declined'].includes(after.status)) return;
      }
      const planAdmin = !!meMember && ['owner', 'admin'].includes(roleId);
      if (isDelete) {
        const ok = planAdmin || isAdmin || id === 'ask-' + auth.uid || id === 'leave-' + auth.uid
          || (meMember && id.startsWith('leave-') && can('members.manage'))
          || (meMember && id.startsWith('del-') && (before.by === auth.uid || can('tasks.editAll')));
        if (!ok) deny('delete request'); return;
      }
      if (isCreate && meMember && id === 'leave-' + auth.uid) {
        if (!(roleId !== 'owner' && hasOnly(after, ['kind', 'by', 'byName', 'at', 'note']) && after.kind === 'leave' && after.by === auth.uid && isStr(after.byName, 80) && isStr(after.note, 300))) deny('leave request');
        return;
      }
      if (isCreate && meMember && id.startsWith('del-')) {
        const task = T0 && T0.tasks && T0.tasks[after.taskId];
        if (!(id === 'del-' + after.taskId && hasOnly(after, ['kind', 'by', 'byName', 'at', 'note', 'taskId', 'taskName']) && after.kind === 'delete' && after.by === auth.uid
          && isStr(after.byName, 80) && isStr(after.note, 300) && isStr(after.taskName, 200) && task && canEditOwned(task.ownerUid))) deny('delete request');
        return;
      }
      if (id === 'ask-' + auth.uid && isCreate && meMember) {
        if (!(hasOnly(after, ['by', 'byName', 'at', 'note']) && after.by === auth.uid && isStr(after.note, 300))) deny('ask');
        return;
      }
      if (!(id === 'pro' && planAdmin && validPlanRequest(after, auth.uid) && after.teamId === teamId)) deny('request');
      return;
    }
    case 'financeLog': {
      if (!meMember) deny('not a member');
      if (isCreate) { if (!((can('tasks.editOwn') || can('tasks.editAll') || can('finance.edit')) && after.by === auth.uid && validLog(after))) deny('history entry'); return; }
      if (isDelete) { if (roleId !== 'owner') deny('delete history'); return; }
      deny('history entries can’t be changed');
      return;
    }
    case 'finance': {
      if (!can('finance.edit')) deny('finance');
      if (isDelete) return;
      if (!(id === 'budget' && validBudget(after))) deny('budget');
      return;
    }
    default: deny('unknown collection');
  }
}

/** users/{uid}: only the owner may read or write their profile (mirrors firestore.rules). */
export function checkProfileWrite(auth, uid, data) {
  if (!auth || auth.uid !== uid) deny('profile');
  if (data !== null && !(hasOnly(data, ALLOWED.user) && validPhoto(data) && (data.theme === undefined || (typeof data.theme === 'string' && data.theme.length <= 40)) && (data.menuStyle === undefined || ['list', 'circle'].includes(data.menuStyle)) && (data.nav === undefined || ['top', 'side'].includes(data.nav)) && (data.notify === undefined || (data.notify && typeof data.notify === 'object' && !Array.isArray(data.notify) && Object.keys(data.notify).length <= 5)))) deny('invalid profile');
}

export function checkRead(store, auth, teamId, coll) {
  if (!auth) deny('signed out');
  const T = store.teams[teamId];
  const admin = !!(store.admins && store.admins[auth.uid]);
  if (T && !T.members[auth.uid] && admin && (coll === undefined || coll === 'requests')) return;
  if (!T || !T.members[auth.uid]) deny('not a member');
  if (coll === 'expenses' || coll === 'finance' || coll === 'financeLog') {
    const roleId = T.members[auth.uid].roleId; const perms = T.doc.roles?.[roleId]?.perms || {};
    if (!(roleId === 'owner' || perms['finance.view'] || perms['finance.edit'])) deny('finance');
  }
}

/** Return a NEW store with the ops applied (no permission checks). */
export function applyOps(store, teamId, ops) {
  const s = JSON.parse(JSON.stringify(store));
  ops.forEach(op => {
    if (op.path.startsWith('/')) {
      const [c, id] = op.path.slice(1).split('/'); s.root = s.root || {}; s.root[c] = s.root[c] || {};
      if (op.type === 'delete') delete s.root[c][id]; else s.root[c][id] = op.type === 'set' ? JSON.parse(JSON.stringify(op.data)) : { ...(s.root[c][id] || {}), ...JSON.parse(JSON.stringify(op.data)) };
      return;
    }
    if (op.path === 'team') {
      if (op.type === 'delete') { delete s.teams[teamId]; return; }
      if (!s.teams[teamId]) s.teams[teamId] = { doc: {}, members: {}, invites: {}, categories: {}, tasks: {}, comments: {} };
      const T = s.teams[teamId];
      T.doc = op.type === 'set' ? JSON.parse(JSON.stringify(op.data)) : { ...T.doc, ...JSON.parse(JSON.stringify(op.data)) };
      return;
    }
    const [coll, id] = op.path.split('/');
    const T = s.teams[teamId];
    if (!T) throw Object.assign(new Error('Team not found'), { code: 'not-found' });
    if (!T[coll]) T[coll] = {};
    if (op.type === 'delete') { delete T[coll][id]; return; }
    if (op.type === 'update' && !T[coll][id]) throw Object.assign(new Error('No document to update: ' + op.path), { code: 'not-found' });
    T[coll][id] = op.type === 'set' ? JSON.parse(JSON.stringify(op.data)) : { ...T[coll][id], ...JSON.parse(JSON.stringify(op.data)) };
  });
  return s;
}
