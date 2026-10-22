// ─────────────────────────────────────────────────────────────────────────────
//  Data shapes + sanitising. Every document written to the database passes
//  through these functions, and so does everything read back, so a malformed
//  or hostile document can never break the board.
// ─────────────────────────────────────────────────────────────────────────────
import { DEFAULT_ROLES, PERM_KEYS } from './permissions.js';
import { LIMITS } from './config.js';
import { cleanGithub } from '../functions/ghsync.js';
export const GH_STATES = ['open', 'closed', 'merged', 'draft'];
export const GH_REASONS = ['', 'not_planned', 'duplicate'];

export const PRIORITIES = ['Minor', 'Major', 'Critical', 'Blocker'];
export const FLAGS = ['none', 'pending', 'backlog', 'completed'];
export const FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox', 'url', 'person'];
// How new weeks are named: the team's own numbering (Week 1, 2, 3…) or the calendar
// week number of the year (ISO 8601). Names can always be edited afterwards.
export const WEEK_NAMING = ['sequence', 'calendar'];
// Colours offered for project phases (any #rrggbb is accepted).
export const PHASE_COLORS = ['#4299e1', '#9f7aea', '#ed8936', '#48bb78', '#f56565', '#38b2ac', '#ecc94b', '#ed64a6'];
export const PHASE_TEMPLATE = ['Research', 'Design', 'Build', 'Test'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max = 2000) => String(v ?? '').slice(0, max);
const isoOrEmpty = (v) => (typeof v === 'string' && ISO.test(v) ? v : '');
export const safeKey = (v) => {
  const s = String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return !s || ['__proto__', 'constructor', 'prototype'].includes(s) ? 'k_' + s : s;
};
/** An id for a record that may not be saved yet: '' when there is none (so forms know it's new). */
const recordId = (v) => (v ? safeKey(v) : '');
export const newId = (prefix = 'id') =>
  prefix + '_' + Array.from(crypto.getRandomValues(new Uint8Array(10)), b => b.toString(16).padStart(2, '0')).join('');

export function isImageDataUrl(v, maxBytes) {
  return typeof v === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= maxBytes * 1.4;
}
// A task icon is either a short emoji/text (≤ 4 chars) or a small image data URL.
export function cleanIcon(v) {
  if (typeof v !== 'string' || !v) return '';
  if (v.startsWith('data:')) return isImageDataUrl(v, LIMITS.taskIconBytes) ? v : '';
  return [...v].slice(0, 4).join('');
}
export function cleanUrl(v) {
  try { const u = new URL(String(v)); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : ''; } catch { return ''; }
}

/** Account photo: an https link (e.g. from Google sign-in) or a small uploaded image. */
export function cleanPhoto(v) {
  if (typeof v !== 'string' || !v) return '';
  if (v.startsWith('data:')) return isImageDataUrl(v, LIMITS.avatarBytes) ? v : '';
  const u = cleanUrl(v); return u.startsWith('https:') ? u : '';
}

export function cleanWeek(w) {
  return { key: safeKey(w.key), title: str(w.title, 120), metric: str(w.metric, 60), startDate: isoOrEmpty(w.startDate) };
}

/** A project phase: Research, Design, Build… with optional dates and a milestone. */
export function cleanPhase(p, i = 0) {
  p = p || {};
  return {
    id: safeKey(p.id), name: str(p.name, 60) || 'Phase',
    color: /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color.toLowerCase() : PHASE_COLORS[i % PHASE_COLORS.length],
    start: isoOrEmpty(p.start), end: isoOrEmpty(p.end), milestone: str(p.milestone, 120),
  };
}

export function cleanField(f) {
  const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
  return {
    id: safeKey(f.id), name: str(f.name, 60) || 'Field', type,
    options: type === 'select' ? (Array.isArray(f.options) ? f.options : []).map(o => str(o, 60)).filter(Boolean).slice(0, 30) : [],
    showOnCard: !!f.showOnCard,
  };
}

export function cleanCustomValue(field, v) {
  if (!field) return undefined;
  switch (field.type) {
    case 'number': { const n = Number(v); return v === '' || v === null || !Number.isFinite(n) ? null : n; }
    case 'date': return isoOrEmpty(v);
    case 'checkbox': return !!v;
    case 'select': return field.options.includes(v) ? v : '';
    case 'url': return v ? cleanUrl(v) : '';
    case 'person': return typeof v === 'string' ? safeKey(v) : '';
    default: return str(v, 1000);
  }
}

export const DEFAULT_LABELS = {
  jiraId: { label: 'Reference ID', show: true },
  status: { label: 'Status badge', show: true },
  metric: { label: 'Week metric', show: true },
};

export function cleanTeam(t) {
  t = t || {};
  const roles = {};
  Object.entries(t.roles || DEFAULT_ROLES).slice(0, LIMITS.rolesPerTeam + 4).forEach(([id, r]) => {
    const key = safeKey(id);
    roles[key] = {
      name: str(r && r.name, 40) || key, builtin: !!(r && r.builtin), order: Number.isFinite(r && r.order) ? r.order : 50,
      perms: Object.fromEntries(PERM_KEYS.map(k => [k, !!(r && r.perms && r.perms[k])])),
    };
  });
  roles.owner = { ...DEFAULT_ROLES.owner };
  const labels = {};
  Object.keys(DEFAULT_LABELS).forEach(k => {
    const src = (t.labels && t.labels[k]) || {};
    labels[k] = { label: str(src.label, 40) || DEFAULT_LABELS[k].label, show: src.show !== false };
  });
  return {
    name: str(t.name, 80) || 'Untitled team',
    logo: isImageDataUrl(t.logo, LIMITS.logoBytes) ? t.logo : '',
    ownerUid: str(t.ownerUid, 128),
    createdAt: Number(t.createdAt) || 0,
    roles, labels,
    weekNaming: WEEK_NAMING.includes(t.weekNaming) ? t.weekNaming : 'sequence',
    fields: (Array.isArray(t.fields) ? t.fields : []).slice(0, LIMITS.fieldsPerTeam).map(cleanField),
    phases: (Array.isArray(t.phases) ? t.phases : []).slice(0, LIMITS.phasesPerTeam).map(cleanPhase),
    capacity: cleanCapacity(t.capacity),
    workflow: cleanWorkflow(t.workflow),
    features: cleanFeatures(t.features),
    subteams: cleanSubteams(t.subteams),
    purchase: cleanPurchase(t.purchase),
    autos: cleanAutos(t.autos),
    github: cleanGithub(t.github),
    currency: CURRENCIES.includes(t.currency) ? t.currency : '',
    former: cleanFormer(t.former),
    plan: cleanPlan(t.plan),
    weeks: (Array.isArray(t.weeks) ? t.weeks : []).map(cleanWeek),
  };
}

// ── Plans: Free, Pro, Organisation ──────────────────────────────────────────
/** What each plan allows. 0 = no limit. */
export const PLANS = {
  free: { key: 'free', name: 'Free', members: 30, ownTeams: 5, financeHistoryDays: 90, storageMB: 100, price: '£0' },
  pro: { key: 'pro', name: 'Pro', members: 100, ownTeams: 0, financeHistoryDays: 0, storageMB: 5000, price: '£3 per member a month (yearly) or £4 monthly' },
  org: { key: 'org', name: 'Organisation', members: 500, ownTeams: 0, financeHistoryDays: 0, storageMB: 50000, price: 'From £3,000 a year, invoiced' },
};
export const PLAN_TIERS = ['free', 'pro', 'org'];
/** Paid features, in the order they're being built. status: 'soon' until built, then 'live'. */
export const PRO_FEATURES = [
  { key: 'backups', tier: 'pro', icon: '🛟', name: 'Daily backups and restore', help: 'Restore the whole team to any day in the last 30.', status: 'soon' },
  { key: 'approvals', tier: 'pro', icon: '✅', name: 'Purchase approvals', help: 'Requests go to a lead or supervisor for sign-off before anything is ordered.', status: 'soon' },
  { key: 'notifications', tier: 'pro', icon: '📧', name: 'Email notifications', help: 'An email when someone @mentions you, and a Monday digest of your overdue and upcoming tasks. Each person can switch them off.', status: 'live' },
  { key: 'supervisor', tier: 'pro', icon: '👀', name: 'Supervisor and sponsor view', help: 'A read-only link for supervisors, sponsors and judges.', status: 'soon' },
  { key: 'history', tier: 'pro', icon: '🕘', name: 'Full change history', help: 'Every change to the team kept for good, not just finance; finance history beyond 90 days.', status: 'live' },
  { key: 'reviews', tier: 'pro', icon: '🧭', name: 'Design reviews and stage gates', help: 'Review dates per phase with checklists and sign-off.', status: 'soon' },
  { key: 'bom', tier: 'pro', icon: '🧱', name: 'Bill of materials and mass budget', help: 'Assemblies and parts with mass and cost rolled up.', status: 'soon' },
  { key: 'documents', tier: 'pro', icon: '📑', name: 'Document control', help: 'Drawings and documents with revisions, linked to parts and requirements.', status: 'soon' },
  { key: 'sso', tier: 'org', icon: '🔐', name: 'Single sign-on', help: 'Sign in with the university or company Microsoft or Google account.', status: 'soon' },
  { key: 'admin', tier: 'org', icon: '🏛', name: 'Admin console across teams', help: 'One place to manage every team in a department or company.', status: 'soon' },
  { key: 'dpa', tier: 'org', icon: '📜', name: 'Data agreement and UK data residency', help: 'A signed data processing agreement; data kept in the UK.', status: 'soon' },
];
/** Students and staff with a university email get Pro Education free: .ac.uk, .edu, .ac.xx, .edu.xx and a few
 *  universities without those endings. Must match the academic() check in firestore.rules. */
export const ACADEMIC_EMAIL = /@([a-z0-9-]+\.)+(ac\.[a-z]{2}|edu(\.[a-z]{2})?)$|@([a-z0-9-]+\.)*(ethz|epfl)\.ch$/;
export const isAcademicEmail = (email) => ACADEMIC_EMAIL.test(String(email || '').trim().toLowerCase());
/** How long a free Pro Education period lasts before it is renewed (one click, same email check). */
export const EDU_DAYS = 365;
/** Each verified student or staff member can switch on Pro Education for this many teams per calendar year. */
export const EDU_TEAMS_PER_YEAR = 3;
/** This year's Pro Education claims for one person: { year, teams: [teamId] }. */
export function cleanEduClaim(c, year = new Date().getUTCFullYear()) {
  c = c && typeof c === 'object' ? c : {};
  return Number(c.year) === year ? { year, teams: (Array.isArray(c.teams) ? c.teams : []).filter(x => typeof x === 'string' && x).slice(0, EDU_TEAMS_PER_YEAR) } : { year, teams: [] };
}
/** A team's plan as stored (only platform admins, or later the payment system, can change it). */
export function cleanPlan(p) {
  p = p && typeof p === 'object' ? p : {};
  return { tier: PLAN_TIERS.includes(p.tier) ? p.tier : 'free', edu: !!p.edu, until: Number(p.until) > 0 ? Number(p.until) : 0, by: str(p.by, 128), at: Number(p.at) || 0, note: str(p.note, 200) };
}
/** The plan in force now: a plan past its end date falls back to Free. */
export function planOf(team, now = Date.now()) {
  const p = cleanPlan(team && team.plan);
  // Pro Education belongs to the student who owns the team: it ends if the team changes hands.
  const handedOn = p.edu && p.by && team && team.ownerUid && p.by !== team.ownerUid;
  const tier = (p.tier !== 'free' && p.until && p.until < now) || handedOn ? 'free' : p.tier;
  return { ...PLANS[tier], tier, edu: tier !== 'free' && p.edu, until: tier === 'free' ? 0 : p.until, expired: tier !== p.tier, label: tier === 'free' ? 'Free' : PLANS[tier].name + (p.edu ? ' Education' : '') };
}
/** Whether a team's plan includes a paid feature. */
export function hasPro(team, key, now) {
  const f = PRO_FEATURES.find(x => x.key === key); if (!f) return false;
  const tier = planOf(team, now).tier;
  return f.tier === 'pro' ? tier !== 'free' : tier === 'org';
}
/** Room for one more member? (members + pending invites, against the plan's limit) */
export function memberRoom(team, members, invites) {
  const lim = planOf(team).members; const used = (members || 0) + (invites || 0);
  return { limit: lim, used, left: lim ? Math.max(0, lim - used) : Infinity, full: !!lim && used >= lim };
}

// ── Sub-teams ───────────────────────────────────────────────────────────────
/** Groups of people inside a project (Fuselage, Payload, Electronics…), each with leads. */
export const SUBTEAM_COLORS = ['#3182ce', '#38a169', '#d69e2e', '#e53e3e', '#805ad5', '#dd6b20', '#319795', '#d53f8c'];
export const SUBTEAM_LIMIT = 20;
export function cleanSubteams(list) {
  const uids = (a) => (Array.isArray(a) ? a : []).filter(x => typeof x === 'string' && x).map(safeKey).filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 200);
  return (Array.isArray(list) ? list : []).filter(s => s && typeof s === 'object').slice(0, SUBTEAM_LIMIT).map((s, i) => {
    const members = uids(s.members);
    return { id: safeKey(s.id || 'st' + i), name: str(s.name, 40).trim() || 'Sub-team', color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : SUBTEAM_COLORS[i % SUBTEAM_COLORS.length], members, leads: uids(s.leads).filter(u => members.includes(u)) };
  }).filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i);
}
/** The sub-teams a person belongs to. */
export const subteamsOf = (team, uid) => ((team && team.subteams) || []).filter(s => s.members.includes(uid));
export const subteamById = (team, id) => ((team && team.subteams) || []).find(s => s.id === id) || null;

export function cleanMember(m, uid) {
  return { uid: safeKey(uid || m.uid), email: str(m.email, 200).toLowerCase(), name: str(m.name, 80), photo: cleanPhoto(m.photo), roleId: safeKey(m.roleId || 'viewer'), joinedAt: Number(m.joinedAt) || 0 };
}

export function cleanCategory(c, id) {
  return { id: safeKey(id || c.id), name: str(c.name, 80), ownerUid: safeKey(c.ownerUid), order: Number(c.order) || 0 };
}

export function cleanTask(t, id, fields = []) {
  const fieldMap = Object.fromEntries(fields.map(f => [f.id, f]));
  const custom = {};
  Object.entries(t.custom || {}).forEach(([k, v]) => { if (fieldMap[k]) { const cv = cleanCustomValue(fieldMap[k], v); if (cv !== undefined) custom[k] = cv; } });
  const sup = (v) => (v ? safeKey(v) : null);
  return {
    id: safeKey(id || t.id), type: 'task',
    name: str(t.name, LIMITS.taskTitle),
    priority: PRIORITIES.includes(t.priority) ? t.priority : 'Minor',
    status: str(t.status, 60), jiraId: str(t.jiraId, 80),
    supportPersonId: sup(t.supportPersonId), supportPersonId2: sup(t.supportPersonId2),
    flag: FLAGS.includes(t.flag) ? t.flag : 'none',
    dueDate: isoOrEmpty(t.dueDate),
    startDate: isoOrEmpty(t.startDate),
    checks: cleanChecks(t.checks),
    signoff: cleanSignoff(t.signoff),
    phaseId: t.phaseId ? safeKey(t.phaseId) : '',
    repeat: cleanRepeat(t.repeat),
    stage: cleanStageId(t.stage),
    effort: cleanEffort(t.effort),
    dependsOn: cleanDeps(t.dependsOn, id || t.id),
    carryOf: t.carryOf && safeKey(t.carryOf) !== safeKey(id || t.id) ? safeKey(t.carryOf) : '',
    skill: str(t.skill, 40).trim(),
    timeLog: cleanTimeLog(t.timeLog),
    completedDate: t.flag === 'completed' ? isoOrEmpty(t.completedDate) : '',
    subtasks: (Array.isArray(t.subtasks) ? t.subtasks : []).slice(0, 100).map(s => ({ id: safeKey(s.id), title: str(s.title, 300), completed: !!s.completed })),
    history: (Array.isArray(t.history) ? t.history : []).slice(0, LIMITS.historyEntries).map(h => ({ time: str(h.time, 40), user: str(h.user, 80), field: str(h.field, 60), original: str(h.original, 300), updated: str(h.updated, 300) })),
    custom,
    icon: cleanIcon(t.icon),
    attachments: (Array.isArray(t.attachments) ? t.attachments : []).slice(0, 30).map(a => ({
      id: safeKey(a.id), provider: ['gdrive', 'onedrive', 'link', 'github'].includes(a.provider) ? a.provider : 'link',
      name: str(a.name, 200), url: cleanUrl(a.url), size: Number(a.size) || 0, addedBy: str(a.addedBy, 80), addedAt: Number(a.addedAt) || 0,
      ...(a.provider === 'github' && GH_STATES.includes(a.state) ? { state: a.state, reason: GH_REASONS.includes(a.reason) ? a.reason : '' } : {}),
    })).filter(a => a.url),
    // location
    categoryId: safeKey(t.categoryId), ownerUid: safeKey(t.ownerUid), weekId: safeKey(t.weekId), order: Number(t.order) || 0,
    // audit (not compared when diffing)
    createdBy: str(t.createdBy, 128), createdAt: Number(t.createdAt) || 0, updatedBy: str(t.updatedBy, 80), updatedAt: Number(t.updatedAt) || 0,
  };
}

/**
 * Repeating tasks. The first task of a series has `every` (1, 2 or 4 weeks) and an optional
 * `until` date; `through` is the last week already handled, so a copy someone deleted is never
 * made again. Copies carry only `seriesId` (the first task's id).
 */
/**
 * Planning. `stage` is the Kanban column for a task that isn't completed ('' = decide from
 * its status text, 'todo' or 'doing'; completed tasks are always Done). `effort` is an
 * estimate in hours. `dependsOn` lists the tasks this one waits on.
 */
export const STAGES = ['', 'todo', 'doing'];
export const MAX_EFFORT = 999, MAX_DEPS = 10;
export function cleanEffort(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v) * 4) / 4;
  return Number.isFinite(n) && n >= 0 && n <= MAX_EFFORT ? n : null;
}
export function cleanDeps(list, selfId) {
  const self = selfId ? safeKey(selfId) : '';
  const out = [];
  (Array.isArray(list) ? list : []).forEach(x => { if (typeof x !== 'string' || !x) return; const k = safeKey(x); if (k && k !== self && !out.includes(k) && out.length < MAX_DEPS) out.push(k); });
  return out;
}
/** Hours a person can give the project in a week (0 = not set). */
export function cleanCapacity(v) { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 && n <= 80 ? n : 0; }
// ── Workflow: a team's own stages ───────────────────────────────────────────
// A team can replace To do / Doing / Done with its own stages (Design, Review, Build,
// Test, Done…). Each stage counts as one of the three kinds, so analytics, reports,
// the weekly share and carry-forward keep working; the last stage is always "done".
// team.workflow absent = the classic three. task.stage holds a stage id ('' = guess).
export const STAGE_KINDS = ['todo', 'doing', 'done'];
export const STAGE_COLORS = ['#63b3ed', '#f6ad55', '#b794f4', '#4fd1c5', '#f687b3', '#fc8181', '#a0aec0', '#68d391'];
export const MAX_STAGES = 10;
export const DEFAULT_STAGES = [
  { id: 'todo', name: 'To do', kind: 'todo', color: '#a0aec0', limit: 0 },
  { id: 'doing', name: 'Doing', kind: 'doing', color: '#63b3ed', limit: 0 },
  { id: 'done', name: 'Done', kind: 'done', color: '#68d391', limit: 0 },
];
const st = (id, name, kind, color, limit = 0) => ({ id, name, kind, color, limit });
export const WORKFLOW_TEMPLATES = [
  { id: 'simple', name: 'Simple', help: 'To do · Doing · Done', stages: DEFAULT_STAGES },
  { id: 'engineering', name: 'Engineering build', help: 'Design · Review · Build · Test · Done', stages: [st('design', 'Design', 'todo', '#63b3ed'), st('review', 'Review', 'doing', '#f6ad55'), st('build', 'Build', 'doing', '#b794f4'), st('test', 'Test', 'doing', '#4fd1c5'), st('done', 'Done', 'done', '#68d391')] },
  { id: 'research', name: 'Lab research', help: 'Plan · Experiment · Analyse · Write-up · Done', stages: [st('plan', 'Plan', 'todo', '#63b3ed'), st('experiment', 'Experiment', 'doing', '#b794f4'), st('analyse', 'Analyse', 'doing', '#4fd1c5'), st('writeup', 'Write-up', 'doing', '#f6ad55'), st('done', 'Done', 'done', '#68d391')] },
  { id: 'software', name: 'Software', help: 'Backlog · In progress · Code review · Done', stages: [st('backlog', 'Backlog', 'todo', '#a0aec0'), st('progress', 'In progress', 'doing', '#63b3ed'), st('codereview', 'Code review', 'doing', '#f6ad55'), st('done', 'Done', 'done', '#68d391')] },
];
// ── Sign-offs and checklists (workflow step 2) ─────────────────────────────
// A stage can need a sign-off before a task leaves it (forwards), and can have a checklist.
export const SIGNOFF_KINDS = ['lead', 'admin', 'person'];
export const MAX_CHECKS = 8;
export const SIGNOFF_LABEL = { lead: 'the sub-team lead', admin: 'an admin', person: 'a named person' };
/** Who may sign off `stage` for a task owned by ownerUid: { uids, label, fallback }.
 *  Nobody signs off their own task. 'lead': the leads of the owner's sub-teams (else the admins).
 *  'person': that member (else the admins). The team owner can always sign off, so nothing gets stuck. */
export function signersFor(stage, team, members, ownerUid) {
  const list = members || []; const nameOf = (u) => ((list.find(m => m.uid === u) || {}).name || 'someone');
  const owner = team && team.ownerUid;
  const out = (uids, label, fallback = false) => ({ uids: [...new Set(uids.concat(owner ? [owner] : []))], label, fallback });
  const admins = list.filter(m => (m.roleId === 'owner' || m.roleId === 'admin') && m.uid !== ownerUid).map(m => m.uid);
  const adminLabel = (why) => (admins.length === 1 ? nameOf(admins[0]) + (why ? ' (' + why + ')' : '') : 'an admin' + (why ? ' (' + why + ')' : ''));
  if (!stage || !stage.signoff) return out([], '');
  if (stage.signoff === 'person') {
    if (stage.signer && stage.signer !== ownerUid && list.some(m => m.uid === stage.signer)) return out([stage.signer].concat(admins), nameOf(stage.signer));
    return out(admins, adminLabel(stage.signer === ownerUid ? 'it’s their own task' : ''), true);
  }
  if (stage.signoff === 'lead') {
    const subs = ((team && team.subteams) || []).filter(s => (s.members || []).includes(ownerUid));
    const leads = [...new Set(subs.flatMap(s => s.leads || []))].filter(u => u !== ownerUid && list.some(m => m.uid === u));
    if (leads.length) return out(leads, leads.map(nameOf).join(' or ') + ' (' + subs.filter(s => (s.leads || []).some(u => leads.includes(u))).map(s => s.name).join(', ') + ' lead)');
    return out(admins, adminLabel(subs.some(s => (s.leads || []).includes(ownerUid)) ? 'they lead their own sub-team' : 'no sub-team lead set'), true);
  }
  return out(admins, adminLabel(''));
}
/** Can this member (uid + roleId) sign off this stage for this owner? (Used by the save check; no member list needed.)
 *  Not on your own task, unless you're the team owner. */
export function canSignStage(stage, team, me, ownerUid) {
  if (!stage || !stage.signoff || !me) return true;
  if (team && team.ownerUid === me.uid) return true;
  if (me.uid === ownerUid) return false;
  const admin = me.roleId === 'owner' || me.roleId === 'admin';
  if (stage.signoff === 'admin') return admin;
  if (stage.signoff === 'person') return me.uid === stage.signer || admin;   // admins can step in (e.g. the person left)
  const subs = ((team && team.subteams) || []).filter(s => (s.members || []).includes(ownerUid));
  const leads = subs.flatMap(s => s.leads || []).filter(u => u !== ownerUid);
  return leads.length ? leads.includes(me.uid) : admin;
}
/** What the security rules need to check sign-offs without loops (stored with the workflow):
 *  order: stage id (and legacy 'todo'/'doing', and moved ids) → position; gates: stage id → { o, k, s };
 *  next[i]: the first position at or after i that needs a sign-off (stages.length when none); done: the last position. */
export function workflowIndex(stages, moved = {}) {
  const order = {}; stages.forEach((s, i) => { order[s.id] = i; });
  ['todo', 'doing'].forEach(k => { if (order[k] === undefined) { const i = stages.findIndex(s => s.kind === k); if (i >= 0) order[k] = i; } });
  Object.entries(moved || {}).forEach(([a, b]) => { if (order[a] === undefined && order[b] !== undefined) order[a] = order[b]; });
  const gates = {};
  stages.forEach((s, i) => { if (s.signoff) gates[s.id] = { o: i, k: s.signoff, s: s.signer || '' }; });
  const next = new Array(stages.length + 1).fill(stages.length);
  for (let i = stages.length - 1; i >= 0; i--) next[i] = stages[i].signoff ? i : next[i + 1];
  return { order, gates, next, done: stages.length - 1 };
}
/** Each member's sub-team leads (not themselves), for the security rules: { uid: [leadUid] }. */
export function leadsIndex(subteams) {
  const out = {};
  (subteams || []).forEach(s => (s.members || []).forEach(u => { const l = (s.leads || []).filter(x => x !== u); if (l.length) out[u] = [...new Set((out[u] || []).concat(l))].slice(0, 20); }));
  return out;
}
/** The workflow as stored: stages, moved, and the index the rules use. */
export const storedWorkflow = (w) => ({ stages: w.stages, moved: w.moved || {}, ...workflowIndex(w.stages, w.moved || {}) });
/** Is this task's sign-off for `stageId` approved? */
export const signedOff = (task, stageId) => !!(task && task.signoff && task.signoff.stage === stageId && task.signoff.status === 'approved');
/** Moving a task from stage `from` to stage `to` (ids): the first stage on the way that needs a
 *  sign-off it doesn't have, or null. Moving back never needs one. */
export function gateOnTheWay(task, stages, from, to) {
  const i = stages.findIndex(s => s.id === from), j = stages.findIndex(s => s.id === to);
  if (i < 0 || j <= i) return null;
  for (let k = i; k < j; k++) { const s = stages[k]; if (s.signoff && !signedOff(task, s.id)) return s; }
  return null;
}
/** Checklist progress for the task's current stage: { done, total, items: [{ id, text, done }] }. */
export function checklistOf(task, stage) {
  const items = ((stage && stage.checklist) || []).map(c => ({ ...c, done: !!(task && task.checks && task.checks[c.id]) }));
  return { done: items.filter(c => c.done).length, total: items.length, items };
}
export function cleanSignoff(v) {
  if (!v || typeof v !== 'object' || !['waiting', 'approved', 'changes'].includes(v.status)) return null;
  const s = (x, n) => String(x == null ? '' : x).slice(0, n);
  return { stage: cleanStageId(v.stage), status: v.status, by: s(v.by, 64), byName: s(v.byName, 80), at: Number(v.at) || 0,
    approver: s(v.approver, 64), approverName: s(v.approverName, 80), note: s(v.note, 500), decidedAt: Number(v.decidedAt) || 0,
    ...(Number(v.remindedAt) > 0 ? { remindedAt: Number(v.remindedAt) } : {}) };
}
export function cleanChecks(v) {
  const out = {}; Object.entries(v && typeof v === 'object' && !Array.isArray(v) ? v : {}).slice(0, 50).forEach(([k, on]) => { if (on === true && cleanStageId(k)) out[k] = true; });
  return out;
}
export function cleanStageId(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : ''; }
/** A team's workflow as stored ({ stages }), or null for the classic three. */
export function cleanWorkflow(w) {
  if (!w || typeof w !== 'object' || !Array.isArray(w.stages)) return null;
  const seen = new Set(); const stages = [];
  w.stages.slice(0, MAX_STAGES).forEach((x, i) => {
    if (!x || typeof x !== 'object') return;
    const id = cleanStageId(x.id) || 's' + i; if (seen.has(id)) return; seen.add(id);
    const name = String(x.name || '').replace(/\s+/g, ' ').trim().slice(0, 30) || 'Stage ' + (i + 1);
    const limit = Math.round(Number(x.limit)); 
    const signoff = SIGNOFF_KINDS.includes(x.signoff) ? x.signoff : '';
    const checklist = (Array.isArray(x.checklist) ? x.checklist : []).slice(0, MAX_CHECKS).map((c, k) => ({ id: cleanStageId(c && c.id) || id + '_c' + k, text: String((c && c.text) || '').replace(/\s+/g, ' ').trim().slice(0, 80) })).filter(c => c.text);
    stages.push({ id, name, kind: x.kind === 'doing' ? 'doing' : 'todo', color: STAGE_COLORS.includes(x.color) ? x.color : STAGE_COLORS[i % STAGE_COLORS.length], limit: Number.isFinite(limit) && limit > 0 && limit <= 99 ? limit : 0,
      signoff, signer: signoff === 'person' && typeof x.signer === 'string' ? safeKey(x.signer) : '', checklist });
  });
  if (stages.length < 2) return null;
  Object.assign(stages[stages.length - 1], { kind: 'done', limit: 0, signoff: '', signer: '', checklist: [] });
  // moved: where tasks of removed stages now are { oldId: newId } (so a change never scrambles tasks)
  const moved = {}; const ids = new Set(stages.map(x => x.id));
  Object.entries(w.moved && typeof w.moved === 'object' ? w.moved : {}).slice(0, 60).forEach(([a, b]) => { const k = cleanStageId(a), v = cleanStageId(b); if (k && v && ids.has(v) && !ids.has(k)) moved[k] = v; });
  return { stages, moved };
}
/** Saving a new set of stages: where each stage that's gone sends its tasks (same kind, same place). */
export function workflowMoves(oldStages, newStages, oldMoved = {}) {
  const ids = new Set(newStages.map(s => s.id)); const moved = {};
  const target = (old) => {
    const same = oldStages.filter(s => s.kind === old.kind); const pos = same.findIndex(s => s.id === old.id);
    const cands = newStages.filter(s => s.kind === old.kind);
    return (cands[Math.min(Math.max(pos, 0), cands.length - 1)] || newStages.find(s => s.kind !== 'done') || newStages[0]).id;
  };
  oldStages.forEach(s => { if (!ids.has(s.id)) moved[s.id] = target(s); });
  Object.entries(oldMoved || {}).forEach(([a, b]) => { if (ids.has(a)) return; moved[a] = ids.has(b) ? b : (moved[b] || newStages[0].id); });
  return moved;
}
/** The stages a team uses (its own, or the classic three). */
const wfCache = new WeakMap();
const NO_WF = { stages: DEFAULT_STAGES, moved: {} };
/** The team's workflow { stages, moved }, cached per team object. */
export function workflowOf(team) {
  if (!team || typeof team !== 'object') return NO_WF;
  const hit = wfCache.get(team); if (hit && hit.src === team.workflow) return hit.wf;
  const wf = cleanWorkflow(team.workflow) || NO_WF;
  wfCache.set(team, { src: team.workflow, wf }); return wf;
}
export const workflowStages = (team) => workflowOf(team).stages;
/** Are these stages anything other than the classic To do / Doing / Done? */
export const isCustomWorkflow = (stages) => stages.length !== 3 || stages.some((s, i) => s.id !== DEFAULT_STAGES[i].id || s.name !== DEFAULT_STAGES[i].name || s.limit || s.signoff || (s.checklist && s.checklist.length));
/** Which of the team's stages a task is in. */
export function stageIdOf(t, stages = DEFAULT_STAGES, moved = {}) {
  if (t && t.flag === 'completed') return stages[stages.length - 1].id;
  let id = t && t.stage; if (id && moved[id]) id = moved[id];
  if (id && stages.some(s => s.id === id && s.kind !== 'done')) return id;
  const kind = stageOf(t);   // classic value or a guess from the status text
  return (stages.find(s => s.kind === kind) || stages[0]).id;
}
/** The kind ('todo' | 'doing' | 'done') of a task in the team's workflow. */
export function stageKindOf(t, stages = DEFAULT_STAGES, moved = {}) {
  const id = stageIdOf(t, stages, moved); return (stages.find(s => s.id === id) || stages[0]).kind;
}

/** Kanban column of a task: 'done', 'doing' or 'todo'. */
export function stageOf(t) {
  if (!t) return 'todo';
  if (t.flag === 'completed') return 'done';
  if (t.stage === 'doing' || t.stage === 'todo') return t.stage;
  return /\b(in[ -]?progress|doing|started|ongoing|wip|in review|review(ing)?|testing)\b/i.test(t.status || '') ? 'doing' : 'todo';
}
export const REPEAT_EVERY = [1, 2, 4];
export function cleanRepeat(r) {
  if (!r || typeof r !== 'object') return null;
  const every = REPEAT_EVERY.includes(Number(r.every)) ? Number(r.every) : 0;
  const seriesId = r.seriesId ? safeKey(r.seriesId) : '';
  if (!every && !seriesId) return null;
  return { every, until: isoOrEmpty(r.until), through: r.through ? safeKey(r.through) : '', seriesId };
}

/** A reusable task: name, priority, status, icon, phase, custom fields and sub-task titles. */
export function cleanTemplate(t, id, fields = []) {
  t = t || {};
  const fieldIds = new Set(fields.map(f => f.id));
  const task = t.task || {};
  return {
    id: safeKey(id || t.id), name: str(t.name, 80) || 'Template',
    task: {
      name: str(task.name, LIMITS.taskTitle), priority: PRIORITIES.includes(task.priority) ? task.priority : 'Minor', status: str(task.status, 60),
      icon: cleanIcon(task.icon), phaseId: task.phaseId ? safeKey(task.phaseId) : '',
      subtasks: (Array.isArray(task.subtasks) ? task.subtasks : []).slice(0, 100).map(s => str(typeof s === 'string' ? s : s && s.title, 300)).filter(Boolean),
      custom: Object.fromEntries(Object.entries(task.custom && typeof task.custom === 'object' ? task.custom : {}).filter(([k]) => fieldIds.has(k))),
      dueOffset: Number.isInteger(task.dueOffset) && task.dueOffset >= 0 && task.dueOffset <= 365 ? task.dueOffset : null,
      effort: cleanEffort(task.effort),
    },
    createdBy: safeKey(t.createdBy), createdByName: str(t.createdByName, 80), createdAt: Number(t.createdAt) || 0,
  };
}

/** A comment on a task. `mentions` holds the uids of the people @mentioned. */
export function cleanComment(c, id) {
  c = c || {};
  return {
    id: safeKey(id || c.id), taskId: safeKey(c.taskId), authorUid: safeKey(c.authorUid), authorName: str(c.authorName, 80),
    text: str(c.text, LIMITS.commentChars), mentions: [...new Set((Array.isArray(c.mentions) ? c.mentions : []).map(safeKey))].slice(0, LIMITS.mentionsPerComment),
    createdAt: Number(c.createdAt) || 0, editedAt: Number(c.editedAt) || 0,
  };
}

/**
 * Who is @mentioned in a comment: every member whose full name (or email name) appears
 * after an @, matched case-insensitively, longest names first so "@Ana Lopez" beats "@Ana".
 */
export function findMentions(text, members) {
  const t = String(text || '').toLowerCase(); const out = [];
  const names = [];
  (members || []).forEach(m => {
    if (m.name) names.push([m.name.toLowerCase(), m.uid]);
    if (m.email) names.push([m.email.split('@')[0].toLowerCase(), m.uid]);
  });
  names.sort((a, b) => b[0].length - a[0].length);
  let used = t;
  names.forEach(([n, uid]) => {
    if (!n) return;
    const re = new RegExp('(?<![\\p{L}\\p{N}_.])@' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'giu');
    if (re.test(used)) { if (!out.includes(uid)) out.push(uid); used = used.replace(re, ' '); }
  });
  return out.slice(0, LIMITS.mentionsPerComment);
}

export const TASK_CONTENT_FIELDS = ['name', 'priority', 'status', 'jiraId', 'supportPersonId', 'supportPersonId2', 'flag', 'dueDate', 'startDate', 'checks', 'signoff', 'phaseId', 'repeat', 'stage', 'effort', 'dependsOn', 'carryOf', 'skill', 'timeLog', 'completedDate', 'subtasks', 'history', 'custom', 'icon', 'attachments'];
export const TASK_LOCATION_FIELDS = ['categoryId', 'ownerUid', 'weekId', 'order'];

/** ISO 8601 week number of a 'YYYY-MM-DD' date (or today). */
export function isoWeekNumber(iso) {
  const m = typeof iso === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : (() => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); })();
  const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y0) / 86400000 + 1) / 7);
}

/**
 * Title for a new week. 'sequence': one more than the highest "WEEK n" so far (WEEK 1 for
 * the first). 'calendar': the ISO week number of its start date.
 */
export function nextWeekTitle(mode, weeks, startISO) {
  if (mode === 'calendar' && startISO) return 'WEEK ' + isoWeekNumber(startISO);
  const nums = (weeks || []).map(w => /^\s*week\s+(\d{1,4})\s*$/i.exec(w.title || '')).filter(Boolean).map(m => +m[1]);
  return 'WEEK ' + (nums.length ? Math.max(...nums) + 1 : (weeks || []).length + 1);
}

/** Rename every week to match a naming mode. Calendar mode leaves undated weeks as they are. */
export function renumberWeeks(mode, weeks) {
  return (weeks || []).map((w, i) => ({ ...w, title: mode === 'calendar' ? (w.startDate ? 'WEEK ' + isoWeekNumber(w.startDate) : w.title) : 'WEEK ' + (i + 1) }));
}

/**
 * Give week i a new start date; every week after it follows on, 7 days apart.
 * Earlier weeks are left alone. In calendar naming, weeks still called "WEEK n" are renamed
 * to their new calendar week number. Returns a new array.
 */
export function cascadeWeekDates(weeks, i, startISO, mode = 'sequence') {
  const list = (weeks || []).map(w => ({ ...w }));
  if (!list[i] || !/^\d{4}-\d{2}-\d{2}$/.test(startISO || '')) return list;
  const add = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
  for (let j = i; j < list.length; j++) {
    list[j].startDate = add(startISO, (j - i) * 7);
    if (mode === 'calendar' && /^\s*week\s+\d{1,4}\s*$/i.test(list[j].title || '')) list[j].title = 'WEEK ' + isoWeekNumber(list[j].startDate);
  }
  return list;
}

// ── Phase 7: research tools ──────────────────────────────────────────────────
const num = (v, min, max, dflt = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
const money = (v) => Math.round(num(v, 0, 1e8) * 100) / 100;
const keyList = (list, max) => (Array.isArray(list) ? list : []).filter(x => typeof x === 'string' && x).map(safeKey).filter((x, i, a) => a.indexOf(x) === i).slice(0, max);
const dataImage = (v, max) => (typeof v === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= max ? v : '');
export const RESEARCH_LIMITS = { meetingNotes: 20000, meetingActions: 50, notebookText: 10000, notebookImages: 4, imageChars: 200000, budgetLines: 50 };

/** Meeting notes with action items that can become tasks. */
export function cleanMeeting(m, id) {
  m = m || {};
  return {
    id: recordId(id || m.id), title: str(m.title, 120) || 'Meeting', date: isoOrEmpty(m.date),
    attendees: keyList(m.attendees, 50), notes: str(m.notes, RESEARCH_LIMITS.meetingNotes),
    actions: (Array.isArray(m.actions) ? m.actions : []).slice(0, RESEARCH_LIMITS.meetingActions).map(a => ({
      id: safeKey(a && a.id), text: str(a && a.text, 300), ownerUid: a && a.ownerUid ? safeKey(a.ownerUid) : '', dueDate: isoOrEmpty(a && a.dueDate), taskId: a && a.taskId ? safeKey(a.taskId) : '',
    })).filter(a => a.text),
    createdBy: str(m.createdBy, 128), createdByName: str(m.createdByName, 80), createdAt: Number(m.createdAt) || 0, updatedAt: Number(m.updatedAt) || 0, updatedByName: str(m.updatedByName, 80),
  };
}
/** A dated lab-notebook entry on a task, with up to four small photos. */
export function cleanNotebookEntry(e, id) {
  e = e || {};
  return {
    id: recordId(id || e.id), taskId: safeKey(e.taskId), authorUid: str(e.authorUid, 128), authorName: str(e.authorName, 80), date: isoOrEmpty(e.date),
    text: str(e.text, RESEARCH_LIMITS.notebookText),
    images: (Array.isArray(e.images) ? e.images : []).map(x => dataImage(x, RESEARCH_LIMITS.imageChars)).filter(Boolean).slice(0, RESEARCH_LIMITS.notebookImages),
    createdAt: Number(e.createdAt) || 0, editedAt: Number(e.editedAt) || 0,
  };
}
export const PART_STATUS = ['needed', 'ordered', 'received', 'cancelled'];
/** A part or component the project needs to buy. */
export function cleanPart(p, id) {
  p = p || {};
  return {
    id: recordId(id || p.id), name: str(p.name, 200), partNo: str(p.partNo, 80), supplier: str(p.supplier, 120), url: cleanUrl(p.url),
    qty: Math.round(num(p.qty, 0, 100000, 1)), unitCost: money(p.unitCost), status: PART_STATUS.includes(p.status) ? p.status : 'needed',
    neededBy: isoOrEmpty(p.neededBy), orderedDate: isoOrEmpty(p.orderedDate), receivedDate: isoOrEmpty(p.receivedDate),
    taskId: p.taskId ? safeKey(p.taskId) : '', budgetId: p.budgetId ? safeKey(p.budgetId) : '', notes: str(p.notes, 2000),
    extras: cleanExtras(p.extras), subteamId: p.subteamId ? safeKey(p.subteamId) : '', approval: cleanApproval(p.approval),
    createdBy: str(p.createdBy, 128), createdByName: str(p.createdByName, 80), createdAt: Number(p.createdAt) || 0, updatedAt: Number(p.updatedAt) || 0,
  };
}
// ── Purchase approvals (workflow step 3) ─────────────────────────────────────
/** Team setting: { on, over } — with approvals on, an order costing more than `over` needs approving before it's Ordered. */
export function cleanPurchase(p) { p = p && typeof p === 'object' ? p : {}; return { on: p.on === true, over: money(p.over) }; }
export function cleanApproval(v) {
  if (!v || typeof v !== 'object' || !['waiting', 'approved', 'declined'].includes(v.status)) return null;
  const s = (x, n) => String(x == null ? '' : x).slice(0, n);
  return { status: v.status, by: s(v.by, 128), byName: s(v.byName, 80), at: Number(v.at) || 0, amount: money(v.amount),
    approver: s(v.approver, 128), approverName: s(v.approverName, 80), note: s(v.note, 500), decidedAt: Number(v.decidedAt) || 0 };
}
/** Does buying this part need an approval first? (Cost over the team's limit, approvals on, not bought yet.) */
export function needsApproval(part, purchase) {
  const pc = cleanPurchase(purchase);
  return pc.on && !!part && !['ordered', 'received', 'cancelled'].includes(part.status) && partTotal(part) > pc.over;
}
export const isApproved = (part) => !!(part && part.approval && part.approval.status === 'approved');
/** Can `member` approve or decline this part's request? The team owner always; finance managers, not their own. */
export function canApprovePurchase(team, member, part) {
  if (!team || !member) return false;
  if (team.ownerUid === member.uid) return true;
  const role = member.roleId === 'owner' ? null : team.roles && team.roles[member.roleId];
  const fin = member.roleId === 'owner' || !!(role && role.perms && role.perms['finance.edit']);
  return fin && !!part && !!part.approval && part.approval.by !== member.uid;
}

// ── Automatic steps (workflow step 4) ────────────────────────────────────────
/** { partsTo: stage a task moves to once all its parts are received ('' = off), tellWaiting, remindDays (0 = off) } */
export function cleanAutos(a) {
  a = a && typeof a === 'object' ? a : {};
  return { partsTo: a.partsTo ? cleanStageId(a.partsTo) : '', tellWaiting: a.tellWaiting === true, remindDays: Math.max(0, Math.min(60, Math.round(Number(a.remindDays) || 0))) };
}
/** Tasks whose parts are all in and that should move on to `to`: [{ task, from }]. Never past a sign-off still to give. */
export function partsReadyMoves(tasks, parts, stages, to, stageOf) {
  const j = stages.findIndex(s => s.id === to); if (j < 0) return [];
  const byTask = new Map();
  (parts || []).filter(p => p.taskId && p.status !== 'cancelled').forEach(p => { const l = byTask.get(p.taskId) || []; l.push(p); byTask.set(p.taskId, l); });
  const out = [];
  (tasks || []).forEach(t => {
    const list = byTask.get(t.id); if (!list || !list.length || t.flag === 'completed') return;
    if (!list.every(p => p.status === 'received')) return;
    const from = stageOf(t); const i = stages.findIndex(s => s.id === from); if (i < 0 || i >= j) return;
    if (gateOnTheWay(t, stages, from, to)) return;
    out.push({ task: t, from });
  });
  return out;
}
/** Open tasks that wait on `doneId` (through "waits on"), so their owners can be told. */
export function waitingOn(tasks, doneIds) {
  const ids = new Set(doneIds);
  return (tasks || []).filter(t => t.flag !== 'completed' && (t.dependsOn || []).some(d => ids.has(d)));
}

/** Extra costs on a part: shipping, VAT, duty, fees, a discount… each a fixed amount or a % of the items. */
export const EXTRA_LABELS = ['Shipping', 'VAT / tax', 'Import duty', 'Fees', 'Discount', 'Other'];
export const EXTRA_LIMIT = 10;
export function cleanExtras(list) {
  return (Array.isArray(list) ? list : []).filter(x => x && typeof x === 'object').slice(0, EXTRA_LIMIT).map(x => {
    const percent = !!x.percent; const n = Number(x.amount);
    const amount = Number.isFinite(n) ? Math.round(Math.min(percent ? 100 : 1e7, Math.max(percent ? -100 : -1e7, n)) * 100) / 100 : 0;
    return { label: str(x.label, 40).trim() || 'Extra', amount, percent };
  });
}
const r2 = (n) => Math.round(n * 100) / 100;
/** Items only: quantity × cost each. */
export const partItems = (p) => r2((p.qty || 0) * (p.unitCost || 0));
/** One extra cost in money. */
export const extraValue = (p, x) => r2(x.percent ? partItems(p) * x.amount / 100 : x.amount);
/** All extra costs together (can be negative with a discount). */
export const partExtras = (p) => r2((p.extras || []).reduce((a, x) => a + extraValue(p, x), 0));
/** What the part costs in total: items plus extras, never below zero. */
export const partTotal = (p) => Math.max(0, r2(partItems(p) + partExtras(p)));
/** Money in (income, grants) or out (spending). */
export function cleanExpense(x, id) {
  x = x || {};
  return {
    id: recordId(id || x.id), kind: x.kind === 'income' ? 'income' : 'expense', amount: money(x.amount), date: isoOrEmpty(x.date),
    description: str(x.description, 300), budgetId: x.budgetId ? safeKey(x.budgetId) : '', payer: str(x.payer, 80),
    receiptUrl: cleanUrl(x.receiptUrl), receiptImage: dataImage(x.receiptImage, RESEARCH_LIMITS.imageChars),
    taskId: x.taskId ? safeKey(x.taskId) : '', ...expenseParts(x),
    createdBy: str(x.createdBy, 128), createdByName: str(x.createdByName, 80), createdAt: Number(x.createdAt) || 0, updatedAt: Number(x.updatedAt) || 0,
  };
}
/** The parts a payment covers: `partIds` (several) plus the older single `partId`. */
function expenseParts(x) {
  const ids = [...new Set([...keyList(x.partIds, 30), ...(typeof x.partId === 'string' && x.partId ? [safeKey(x.partId)] : [])])].slice(0, 30);
  return { partIds: ids, partId: ids[0] || '' };
}
/** partId → the payment that covers it. */
export function paidParts(expenses) {
  const m = new Map();
  (expenses || []).filter(x => x.kind !== 'income').forEach(x => (x.partIds || (x.partId ? [x.partId] : [])).forEach(id => { const b = m.get(id); if (!b || (x.date || '') > (b.date || '')) m.set(id, x); }));
  return m;
}
/** Finance history: one line per change, written alongside the change and never edited. */
export const LOG_KINDS = ['budget', 'spending', 'income', 'parts'];
export function cleanLogEntry(x, id) {
  x = x || {};
  return { id: id ? safeKey(id) : '', at: Number(x.at) || 0, by: str(x.by, 128), byName: str(x.byName, 80), kind: LOG_KINDS.includes(x.kind) ? x.kind : 'budget', text: str(x.text, 600) };
}
export const CURRENCIES = ['GBP', 'EUR', 'USD', 'INR', 'CHF', 'JPY', 'CNY', 'AUD', 'CAD'];
export const CURRENCY_NAMES = { GBP: 'British pound (£)', EUR: 'Euro (€)', USD: 'US dollar ($)', INR: 'Indian rupee (₹)', CHF: 'Swiss franc (CHF)', JPY: 'Japanese yen (¥)', CNY: 'Chinese yuan (¥)', AUD: 'Australian dollar (A$)', CAD: 'Canadian dollar (C$)' };
/** The team's money: its own currency setting (everyone can see it), else the budget's (older teams), else pounds. */
export function currencyOf(team, budget) {
  if (team && CURRENCIES.includes(team.currency)) return team.currency;
  if (budget && CURRENCIES.includes(budget.currency)) return budget.currency;
  return 'GBP';
}
/** A sensible first currency from the browser's language and region (en-GB → GBP, de-DE → EUR, hi-IN → INR…). */
export function guessCurrency(locale) {
  const l = String(locale || '').replace('_', '-'); const region = (l.split('-')[1] || '').toUpperCase();
  const EURO = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];
  const BY = { GB: 'GBP', UK: 'GBP', US: 'USD', IN: 'INR', CH: 'CHF', LI: 'CHF', JP: 'JPY', CN: 'CNY', AU: 'AUD', CA: 'CAD' };
  if (BY[region]) return BY[region];
  if (EURO.includes(region)) return 'EUR';
  return 'GBP';
}
/** Money in the team's currency, e.g. £1,250 or ₹4,500.00. */
export function formatMoney(n, currency, locale) {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n || 0); } catch { return (n || 0).toFixed(2); }
}
/** The project budget: a currency and budget lines (optionally tied to a phase). */
export function cleanBudget(b) {
  b = b || {};
  return {
    currency: CURRENCIES.includes(b.currency) ? b.currency : 'GBP',
    lines: (Array.isArray(b.lines) ? b.lines : []).slice(0, RESEARCH_LIMITS.budgetLines).map((l, i) => ({
      id: safeKey((l && l.id) || 'b' + i), name: str(l && l.name, 80) || 'Budget line', amount: money(l && l.amount), phaseId: l && l.phaseId ? safeKey(l.phaseId) : '', subteamId: l && l.subteamId ? safeKey(l.subteamId) : '',
    })),
    updatedAt: Number(b.updatedAt) || 0,
  };
}
export const PAPER_STATUS = ['to-read', 'reading', 'read'];
/** A paper, book or web source in the team's literature list. */
export function cleanPaper(p, id) {
  p = p || {};
  const y = Math.round(Number(p.year));
  return {
    id: recordId(id || p.id), title: str(p.title, 500), authors: str(p.authors, 500), year: y >= 1000 && y <= 2200 ? y : null,
    venue: str(p.venue, 200), doi: str(p.doi, 200).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim(), url: cleanUrl(p.url),
    notes: str(p.notes, 5000), tags: (Array.isArray(p.tags) ? p.tags : []).map(t => str(t, 30).trim()).filter(Boolean).filter((t, i, a) => a.indexOf(t) === i).slice(0, 20),
    status: PAPER_STATUS.includes(p.status) ? p.status : 'to-read', taskIds: keyList(p.taskIds, 20),
    addedBy: str(p.addedBy, 128), addedByName: str(p.addedByName, 80), createdAt: Number(p.createdAt) || 0, updatedAt: Number(p.updatedAt) || 0,
  };
}

/**
 * Carried-forward chains. A task carried into the next week is the same piece of work, so the
 * copies form one chain: { id → id of the first task in its chain }. A copy names its original in
 * `carryOf`; copies made before that existed are matched by their "Carried forward" history line
 * plus the same name in the same row in an earlier week.
 * items: [{ id, carryOf, name, cat, weekIdx, history }]
 */
export function carryRoots(items) {
  const byId = new Map(items.map(t => [t.id, t])); const root = new Map();
  const norm = (s) => String(s || '').trim().toLowerCase();
  const carried = (t) => (t.history || []).some(h => h && /^carried forward to/i.test(String(h.updated || '')));
  const sorted = items.slice().sort((a, b) => a.weekIdx - b.weekIdx);
  const find = (t, depth = 0) => {
    if (root.has(t.id)) return root.get(t.id);
    let r = t.id;
    if (depth < 200) {
      if (t.carryOf && byId.has(t.carryOf) && byId.get(t.carryOf).weekIdx < t.weekIdx) r = find(byId.get(t.carryOf), depth + 1);
      else if (carried(t)) {
        let best = null;
        for (const o of sorted) { if (o.weekIdx >= t.weekIdx) break; if (o.id !== t.id && o.cat === t.cat && norm(o.name) === norm(t.name)) best = o; }
        if (best) r = find(best, depth + 1);
      }
    }
    root.set(t.id, r); return r;
  };
  sorted.forEach(t => find(t));
  return root;
}

/**
 * Lookup over carried-forward chains for app-level features (literature, notebook, comments,
 * parts, risks, requirements, meetings…). Records link to ONE copy's id; these helpers let any
 * copy find everything linked to any other copy of the same work.
 * tasks: [{ id, carryOf, name, categoryId, weekId, history, flag }], weeks: [{ key }]
 */
export function carryIndex(tasks, weeks) {
  tasks = tasks || [];
  const order = new Map((weeks || []).map((w, i) => [w.key, i]));
  const wi = (t) => (order.has(t.weekId) ? order.get(t.weekId) : -1);
  const roots = carryRoots(tasks.map(t => ({ id: t.id, carryOf: t.carryOf || '', name: t.name, cat: t.categoryId, weekIdx: wi(t), history: t.history })));
  const groups = new Map();
  tasks.forEach(t => { const r = roots.get(t.id) || t.id; if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); });
  groups.forEach(l => l.sort((a, b) => wi(a) - wi(b)));
  // A deleted first copy is still named in its later copies' carryOf.
  const viaCarryOf = new Map(); tasks.forEach(t => { if (t.carryOf && !roots.has(t.carryOf)) viaCarryOf.set(t.carryOf, roots.get(t.id) || t.id); });
  const rootOf = (id) => roots.get(id) || viaCarryOf.get(id) || id;
  const chain = (id) => groups.get(rootOf(id)) || [];
  return {
    rootOf,
    /** Every copy, oldest week first ([] for an unknown id). */
    chain,
    /** Ids of every copy (always includes id itself). */
    ids: (id) => { const c = chain(id).map(t => t.id); return c.includes(id) ? c : c.concat(id); },
    /** The copy in the latest week (null if the task is gone). */
    latest: (id) => { const c = chain(id); return c.length ? c[c.length - 1] : null; },
    same: (a, b) => rootOf(a) === rootOf(b),
  };
}
const carryCache = new WeakMap();
/** carryIndex for a session's tasks and weeks, rebuilt only when either changes. */
export function carryIndexOf(session) {
  const tasks = (session && session.tasks) || []; const weeks = (session && session.team && session.team.weeks) || [];
  const hit = carryCache.get(tasks);
  if (hit && hit.weeks === weeks) return hit.ix;
  const ix = carryIndex(tasks, weeks); carryCache.set(tasks, { weeks, ix }); return ix;
}
/** Keep one id per carried chain in a list of linked task ids (first wins). */
export function uniqueChains(ids, ix) {
  const seen = new Set(); return (ids || []).filter(id => { const r = ix.rootOf(id); if (seen.has(r)) return false; seen.add(r); return true; });
}

// ── Feature switches: each team turns on what it needs ───────────────────────
export const FEATURES = [
  { key: 'planning', group: 'standard', icon: '⏱', name: 'Planning', help: 'Effort estimates, “waits on” links between tasks, and the Planning tab in analytics (workload and burndown).' },
  { key: 'meetings', group: 'standard', icon: '📝', name: 'Meetings', help: 'Meeting notes whose action items become tasks.' },
  { key: 'notebook', group: 'standard', icon: '📓', name: 'Lab notebook', help: 'Dated entries with photos on every task.' },
  { key: 'literature', group: 'standard', icon: '📚', name: 'Literature', help: 'Papers by DOI, reading status, notes and BibTeX.' },
  { key: 'whiteboards', group: 'standard', icon: '🧭', name: 'Whiteboards', help: 'An endless canvas for planning together: sticky notes, headings, real task cards and arrows. Turn a note into a task in one click.' },
  { key: 'subteams', group: 'advanced', icon: '🧩', name: 'Sub-teams', help: 'Split a project into groups of people — Fuselage, Payload, Electronics… Each sub-team has leads, its own view of the board, its own progress, and can own parts and budget lines.' },
  { key: 'parts', group: 'advanced', icon: '🔩', name: 'Parts and orders', help: 'Components to buy, with suppliers, costs and order status.' },
  { key: 'finance', group: 'advanced', icon: '💷', name: 'Finance', help: 'Budget lines, spending with receipts, income and a burn-rate forecast. Only roles with the finance permissions see the money.' },
  { key: 'people', group: 'advanced', icon: '👥', name: 'People and capacity', help: 'Each person’s hours a week, time off and skills; a workload heatmap; who could take a task; workload across all your teams.' },
  { key: 'time', group: 'advanced', icon: '🕒', name: 'Time logging', help: 'Log hours actually spent on tasks, compare with estimates, export timesheets (handy for contractors).' },
  { key: 'risks', group: 'advanced', icon: '⚠️', name: 'Risk register', help: 'Risks scored by likelihood × impact, with owners, mitigation and review dates.' },
  { key: 'requirements', group: 'advanced', icon: '📐', name: 'Requirements', help: 'Requirements linked to the tasks that deliver them and how they’re verified; coverage and a traceability export.' },
];
export const FEATURE_KEYS = FEATURES.map(f => f.key);
/** What a brand-new team starts with: the standard set on, advanced off. */
export const NEW_TEAM_FEATURES = Object.fromEntries(FEATURES.map(f => [f.key, f.group === 'standard']));
/** Teams made before feature switches keep everything they could already use. */
const LEGACY_FEATURES = { ...NEW_TEAM_FEATURES, parts: true, finance: true };
export function cleanFeatures(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...LEGACY_FEATURES };
  return Object.fromEntries(FEATURE_KEYS.map(k => [k, typeof f[k] === 'boolean' ? f[k] : NEW_TEAM_FEATURES[k]]));
}

// ── Whiteboards ───────────────────────────────────────────────────────────────
// A board (whiteboards/{id}) and its items (wbItems/{id}, one document each, so people can edit
// the same board at once): sticky notes, text, headings, task cards and arrows between items.
export const WB_KINDS = ['note', 'text', 'title', 'task', 'link', 'shape', 'pen', 'frame'];
export const WB_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#e9d5ff', '#e5e7eb'];
/** Ink for pen strokes and arrows. */
export const WB_INKS = ['#1f2937', '#e11d48', '#2563eb', '#16a34a', '#ea580c', '#7c3aed'];
export const WB_SHAPES = ['rect', 'ellipse', 'diamond', 'triangle', 'pill'];
/** A pen stroke: points in a 0–1000 box, "x,y x,y …" (scaled to the item's size when drawn). */
export function cleanWbPath(v) {
  const pts = String(v || '').trim().split(/\s+/).map(p => p.split(',').map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite)).slice(0, 600);
  return pts.map(([x, y]) => Math.round(Math.min(1000, Math.max(0, x))) + ',' + Math.round(Math.min(1000, Math.max(0, y)))).join(' ');
}
export const WB_MAX_ITEMS = 500;
const wbNum = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n))) : dflt; };
export function cleanWhiteboard(b, id) {
  b = b || {};
  return { id: safeKey(id || b.id), name: str(b.name, 80).trim() || 'Untitled board', createdBy: str(b.createdBy, 64), createdByName: str(b.createdByName, 80), createdAt: Number(b.createdAt) || 0, updatedAt: Number(b.updatedAt) || 0 };
}
export function cleanWbItem(d, id) {
  d = d || {}; const kind = WB_KINDS.includes(d.kind) ? d.kind : 'note';
  const dflt = { note: [220, 140], text: [260, 44], title: [420, 56], task: [300, 104], link: [0, 0], shape: [180, 110], pen: [120, 80], frame: [640, 420] }[kind];
  const key = (v) => (v ? safeKey(v) : '');
  return { id: safeKey(id || d.id), boardId: key(d.boardId), kind, x: wbNum(d.x, -50000, 50000, 0), y: wbNum(d.y, -50000, 50000, 0),
    w: kind === 'link' ? 0 : wbNum(d.w, 40, 2400, dflt[0]), h: kind === 'link' ? 0 : wbNum(d.h, 24, 2400, dflt[1]),
    text: str(d.text, 2000), color: (WB_COLORS.includes(d.color) || WB_INKS.includes(d.color)) ? d.color : (kind === 'note' ? WB_COLORS[0] : ''),
    shape: kind === 'shape' ? (WB_SHAPES.includes(d.shape) ? d.shape : 'rect') : kind === 'link' ? (['both', 'none'].includes(d.shape) ? d.shape : '') : '', path: kind === 'pen' ? cleanWbPath(d.path) : '',
    taskId: kind === 'task' ? key(d.taskId) : '', from: kind === 'link' ? key(d.from) : '', to: kind === 'link' ? key(d.to) : '',
    z: wbNum(d.z, -1e6, 1e6, 0), createdBy: str(d.createdBy, 64), updatedAt: Number(d.updatedAt) || 0 };
}
/** "Design ability icons\n- Active abilities\n- UI states" → { title, subtasks: ['Active abilities', 'UI states'] } */
export function noteToTask(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const isItem = (l) => /^([-*•]|\d+[.)]|\[ ?\])\s+/.test(l);
  const title = (lines.find(l => !isItem(l)) || (lines[0] || '').replace(/^([-*•]|\d+[.)]|\[ ?\])\s+/, '') || 'New task').slice(0, 200);
  const subtasks = lines.filter(isItem).map(l => l.replace(/^([-*•]|\d+[.)]|\[ ?\])\s+/, '').slice(0, 300)).filter(Boolean).slice(0, 30);
  return { title, subtasks };
}

// ── People and capacity ──────────────────────────────────────────────────────
/** A member's working profile in one team: hours a week (0 = team default), skills, time off. */
export function cleanProfile(p, uid) {
  p = p || {};
  const cap = Math.round(Number(p.capacity));
  return {
    uid: safeKey(uid || p.uid), capacity: Number.isFinite(cap) && cap > 0 && cap <= 80 ? cap : 0,
    skills: (Array.isArray(p.skills) ? p.skills : []).map(s => str(s, 40).trim()).filter(Boolean).filter((s, i, a) => a.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i).slice(0, 20),
    away: (Array.isArray(p.away) ? p.away : []).map(a => ({ from: isoOrEmpty(a && a.from), to: isoOrEmpty(a && a.to), note: str(a && a.note, 80) }))
      .filter(a => a.from && a.to).map(a => a.from <= a.to ? a : { ...a, from: a.to, to: a.from }).sort((x, y) => x.from.localeCompare(y.from)).slice(0, 30),
    updatedAt: Number(p.updatedAt) || 0,
  };
}
/** Working days (Mon–Fri) in the week starting `monday` that aren't covered by time off. */
export function workdaysFree(monday, away) {
  if (!ISO.test(monday || '')) return 5;
  let free = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday + 'T12:00:00'); d.setDate(d.getDate() + i);
    const day = d.getDay(); if (day === 0 || day === 6) continue;
    const iso = d.toLocaleDateString('en-CA');
    if (!(away || []).some(a => iso >= a.from && iso <= a.to)) free++;
  }
  return free;
}
/** Hours someone can give in a week: their own (or the team's) weekly hours, less time off. 0 = unknown. */
export function capacityFor(profile, teamCapacity, monday) {
  const base = (profile && profile.capacity) || teamCapacity || 0;
  if (!base) return 0;
  return Math.round(base * workdaysFree(monday, profile && profile.away) / 5 * 10) / 10;
}
export const hasSkill = (profile, skill) => !!skill && !!profile && profile.skills.some(s => s.toLowerCase() === String(skill).trim().toLowerCase());

// ── Time logging ─────────────────────────────────────────────────────────────
export function cleanTimeLog(list) {
  return (Array.isArray(list) ? list : []).slice(0, 200).map(e => ({
    id: safeKey(e && e.id), uid: str(e && e.uid, 128), name: str(e && e.name, 80), date: isoOrEmpty(e && e.date),
    hours: Math.round(Math.min(24, Math.max(0, Number(e && e.hours) || 0)) * 4) / 4, note: str(e && e.note, 200),
  })).filter(e => e.hours > 0 && e.date);
}
export const loggedHours = (t) => Math.round((t && Array.isArray(t.timeLog) ? t.timeLog : []).reduce((a, e) => a + (Number(e.hours) || 0), 0) * 100) / 100;

// ── Engineering: risk register and requirements ──────────────────────────────
export const RISK_STATUS = ['open', 'mitigating', 'closed'];
export function cleanRisk(r, id) {
  r = r || {};
  const lvl = (v) => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : 3; };
  return {
    id: recordId(id || r.id), title: str(r.title, 200), detail: str(r.detail, 2000), likelihood: lvl(r.likelihood), impact: lvl(r.impact),
    ownerUid: r.ownerUid ? safeKey(r.ownerUid) : '', status: RISK_STATUS.includes(r.status) ? r.status : 'open', mitigation: str(r.mitigation, 2000),
    taskIds: keyList(r.taskIds, 20), reviewDate: isoOrEmpty(r.reviewDate),
    createdBy: str(r.createdBy, 128), createdByName: str(r.createdByName, 80), createdAt: Number(r.createdAt) || 0, updatedAt: Number(r.updatedAt) || 0,
  };
}
export const riskScore = (r) => (r.likelihood || 0) * (r.impact || 0);
export const REQ_PRIORITY = ['must', 'should', 'could'];
export const REQ_STATUS = ['draft', 'agreed', 'met', 'dropped'];
export function cleanRequirement(q, id) {
  q = q || {};
  return {
    id: recordId(id || q.id), ref: str(q.ref, 20), title: str(q.title, 300), detail: str(q.detail, 3000),
    priority: REQ_PRIORITY.includes(q.priority) ? q.priority : 'should', status: REQ_STATUS.includes(q.status) ? q.status : 'draft',
    taskIds: keyList(q.taskIds, 30), verification: str(q.verification, 1000), verified: !!q.verified, verifiedBy: str(q.verifiedBy, 80), verifiedDate: isoOrEmpty(q.verifiedDate),
    createdBy: str(q.createdBy, 128), createdByName: str(q.createdByName, 80), createdAt: Number(q.createdAt) || 0, updatedAt: Number(q.updatedAt) || 0,
  };
}
/** Next free reference like REQ-007. */
export function nextReqRef(list) {
  const n = Math.max(0, ...list.map(q => { const m = /(\d+)\s*$/.exec(q.ref || ''); return m ? Number(m[1]) : 0; }));
  return 'REQ-' + String(n + 1).padStart(3, '0');
}

// ── Your data: a deleted person's name in shared records ────────────────────
// Same as functions/lib.js scrubPerson (the server does the real deletion; the demo uses this).
// ── Who's here (presence.js) ────────────────────────────────────────────────
export const PRESENCE_STATES = ['free', 'busy', 'away'];
export const PRESENCE_LABEL = { free: 'Available', busy: 'Busy', away: 'Away' };
export const ONLINE_MS = 5 * 60e3;   // a heartbeat every 2 minutes; 5 without one = gone
export function cleanPresence(p, id) {
  p = p && typeof p === 'object' ? p : {};
  return { id: safeKey(id || p.id), at: Number(p.at) || 0, state: PRESENCE_STATES.includes(p.state) ? p.state : '', note: str(p.note, 80), until: Number(p.until) > 0 ? Number(p.until) : 0, taskId: safeKey(p.taskId) };
}
export const isOnline = (p, now = Date.now()) => !!p && p.at > now - ONLINE_MS && p.at <= now + 60e3;
/** The status in force: a status with an end time that has passed goes back to automatic. */
export const statusOf = (p, now = Date.now()) => (p && p.state && !(p.until && p.until < now) ? p.state : '');
export const FORMER_MEMBER = 'Former member';
/** People who left: { uid: { name, leftAt } }, so their past work keeps their name. */
export const histTime = (ms = Date.now()) => { const n = new Date(ms); let h = n.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return String(n.getDate()).padStart(2, '0') + '/' + n.toLocaleString('en-GB', { month: 'short' }) + '/' + String(n.getFullYear()).slice(-2) + ' ' + h + ':' + String(n.getMinutes()).padStart(2, '0') + ' ' + ap; };
export function cleanFormer(f) {
  const out = {}; if (!f || typeof f !== 'object' || Array.isArray(f)) return out;
  Object.entries(f).slice(0, 300).forEach(([uid, v]) => { const k = safeKey(uid); if (k && v && typeof v === 'object') out[k] = { name: String(v.name || '').slice(0, 80), leftAt: Number(v.leftAt) || 0 }; });
  return out;
}
/** A leaving member's open tasks, handed to someone else: the task writes (into a row they have, or a new one). */
export function handOverOps(tasks, categories, from, plan, me, now = Date.now()) {
  // plan: { taskId: toUid }; categories: all team categories
  const ops = []; const made = new Map();
  const rowFor = (to, name) => {
    const k = to + '|' + name; if (made.has(k)) return made.get(k);
    const have = categories.find(c => c.ownerUid === to && c.name === name) || categories.filter(c => c.ownerUid === to).sort((a, b) => a.order - b.order)[0];
    let id = have && have.id;
    if (!id) { id = 'c_' + Math.random().toString(36).slice(2, 12); ops.push({ type: 'set', path: 'categories/' + id, data: { name: name || 'Handed over', ownerUid: to, order: 99 } }); }
    made.set(k, id); return id;
  };
  tasks.filter(t => t.ownerUid === from.uid && plan[t.id]).forEach(t => {
    const to = plan[t.id]; const cat = categories.find(c => c.id === t.categoryId);
    const categoryId = rowFor(to, cat ? cat.name : 'Handed over');
    const history = [{ time: histTime(now), user: me.name || 'Someone', field: 'Owner', original: from.name || 'Former member', updated: (me.names && me.names[to]) || 'new owner' }, ...(t.history || [])].slice(0, 100);
    ops.push({ type: 'update', path: 'tasks/' + t.id, data: { ownerUid: to, categoryId, history, updatedBy: me.name || '', updatedAt: now } });
  });
  return ops;
}
const PERSON_NAME_KEYS = new Set(['authorName', 'createdByName', 'updatedByName', 'byName', 'invitedByName', 'updatedBy', 'user', 'userName']);
export function scrubPerson(doc, names, emails) {
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (PERSON_NAME_KEYS.has(key) && names.has(v.trim())) return FORMER_MEMBER;
      if (key === 'email' && emails.has(v.trim().toLowerCase())) return '';
      return v;
    }
    if (Array.isArray(v)) { let ch = false; const out = v.map(x => { const y = walk(x, key); if (y !== x) ch = true; return y; }); return ch ? out : v; }
    if (v && typeof v === 'object' && v.constructor === Object) { let ch = false; const out = {}; for (const [k, x] of Object.entries(v)) { out[k] = walk(x, k); if (out[k] !== x) ch = true; } return ch ? out : v; }
    return v;
  };
  const value = {};
  for (const [k, x] of Object.entries(doc || {})) { const y = walk(x, k); if (y !== x) value[k] = y; }
  return { value, changed: Object.keys(value).length > 0 };
}
