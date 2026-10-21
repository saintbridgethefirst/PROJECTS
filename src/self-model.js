// ─────────────────────────────────────────────────────────────────────────────
//  SelfTrack: one person's own space (tasks for a day or a week, habits, skills,
//  learnings, weekly reflections). Pure functions only, so they can be tested.
//
//  Storage: one document per item in the top-level collection selfItems/{id},
//  each carrying the owner's uid. Only that person can read or write it
//  (firestore.rules ▸ selfItems, and its copy in rules-sim.js).
// ─────────────────────────────────────────────────────────────────────────────

export const SELF_KINDS = ['task', 'habit', 'skill', 'learning', 'reflect', 'settings'];
export const SELF_FIELDS = ['uid', 'kind', 'title', 'area', 'scope', 'date', 'done', 'doneOn', 'order', 'createdAt', 'updatedAt',
  'note', 'log', 'goal', 'skillId', 'mood', 'well', 'hard', 'areas', 'sync', 'archived', 'color'];
export const SELF_LIMITS = { title: 300, note: 2000, well: 2000, hard: 2000, area: 40, log: 800, areas: 12, sync: 50 };

export const DEFAULT_AREAS = [
  { id: 'uni', name: 'Uni', color: '#63b3ed' },
  { id: 'health', name: 'Health', color: '#68d391' },
  { id: 'home', name: 'Home', color: '#b794f4' },
  { id: 'projects', name: 'Projects', color: '#f687b3' },
];
export const AREA_COLORS = ['#63b3ed', '#68d391', '#b794f4', '#f687b3', '#f6ad55', '#4fd1c5', '#fc8181', '#ecc94b'];
/** Orb colour sets (the swirl's three colours). */
export const ORB_PALETTES = [
  ['#34e89e', '#00c8ff', '#7a5cff'], ['#ff5ea8', '#ffb057', '#7a5cff'], ['#00c8ff', '#7a5cff', '#34e89e'],
  ['#ffb057', '#ff5ea8', '#00c8ff'], ['#7a5cff', '#00c8ff', '#ff5ea8'], ['#34e89e', '#ffb057', '#00c8ff'],
];
export const SKILL_LEVELS = ['Beginner', 'Learning', 'Confident', 'Expert'];
const LEVEL_AT = [0, 0.1, 0.5, 1];   // share of the skill's goal hours where each level starts

// ── Dates (local, as YYYY-MM-DD) ────────────────────────────────────────────
export const iso = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const at = (s) => new Date(s + 'T12:00:00');
export const addDays = (s, n) => { const d = at(s); d.setDate(d.getDate() + n); return iso(d); };
export const mondayOf = (s) => { const d = at(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export const daysBetween = (a, b) => Math.round((at(b) - at(a)) / 864e5);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s);

// ── Cleaning (what gets saved) ──────────────────────────────────────────────
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const num = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

/** One item as stored: known fields only, lengths clipped, logs capped (oldest dropped). */
export function cleanSelfItem(d, uid) {
  d = d || {};
  const kind = SELF_KINDS.includes(d.kind) ? d.kind : 'task';
  const out = { uid, kind, title: str(d.title, SELF_LIMITS.title).trim(), createdAt: num(d.createdAt, 0, 9e15, Date.now()), updatedAt: num(d.updatedAt, 0, 9e15, Date.now()) };
  if (kind === 'task') {
    Object.assign(out, { area: str(d.area, SELF_LIMITS.area), scope: d.scope === 'week' ? 'week' : 'day', date: isDate(d.date) ? d.date : iso(Date.now()),
      done: !!d.done, doneOn: d.done && isDate(d.doneOn) ? d.doneOn : '', order: num(d.order, -1e9, 1e9, 0) });
    if (out.scope === 'week') out.date = mondayOf(out.date);
  }
  if (kind === 'habit') Object.assign(out, { area: str(d.area, SELF_LIMITS.area), goal: Math.round(num(d.goal, 1, 7, 7)), color: str(d.color, 20), archived: !!d.archived,
    log: [...new Set((Array.isArray(d.log) ? d.log : []).filter(isDate))].sort().slice(-SELF_LIMITS.log) });
  if (kind === 'skill') Object.assign(out, { area: str(d.area, SELF_LIMITS.area), goal: Math.round(num(d.goal, 1, 10000, 100)), color: str(d.color, 20), archived: !!d.archived, note: str(d.note, SELF_LIMITS.note),
    log: (Array.isArray(d.log) ? d.log : []).filter(e => e && isDate(e.d) && Number.isFinite(Number(e.m))).map(e => ({ d: e.d, m: Math.round(num(e.m, -1440, 1440, 0)) })).slice(-SELF_LIMITS.log) });
  if (kind === 'learning') Object.assign(out, { date: isDate(d.date) ? d.date : iso(Date.now()), skillId: str(d.skillId, 64), area: str(d.area, SELF_LIMITS.area), note: str(d.note, SELF_LIMITS.note) });
  if (kind === 'reflect') Object.assign(out, { date: mondayOf(isDate(d.date) ? d.date : iso(Date.now())), well: str(d.well, SELF_LIMITS.well), hard: str(d.hard, SELF_LIMITS.hard), mood: Math.round(num(d.mood, 0, 4, 0)) });
  if (kind === 'settings') {
    const areas = (Array.isArray(d.areas) ? d.areas : DEFAULT_AREAS).slice(0, SELF_LIMITS.areas)
      .map((a, i) => ({ id: str(a && a.id, 40).replace(/[^A-Za-z0-9_-]/g, '') || 'a' + i, name: str(a && a.name, 40).trim() || 'Area', color: /^#[0-9a-fA-F]{6}$/.test(a && a.color) ? a.color : AREA_COLORS[i % AREA_COLORS.length] }));
    const sync = {}; Object.entries(d.sync && typeof d.sync === 'object' ? d.sync : {}).slice(0, SELF_LIMITS.sync).forEach(([k, v]) => { if (/^[A-Za-z0-9_-]{1,64}$/.test(k)) sync[k] = !!v; });
    Object.assign(out, { areas, sync });
  }
  return out;
}
export const settingsId = (uid) => 'set_' + uid;
export const reflectId = (uid, monday) => 'ref_' + uid + '_' + monday;
export function settingsOf(items, uid) {
  const s = items.find(i => i.kind === 'settings');
  return cleanSelfItem(s || { kind: 'settings', areas: DEFAULT_AREAS, sync: {} }, uid);
}

/** "Email supervisor #uni" → { title: 'Email supervisor', area: 'uni' } when an area has that name or id. */
export function parseQuickAdd(text, areas) {
  let area = ''; const title = String(text || '').replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (m, sp, tag) => {
    const a = areas.find(x => x.id.toLowerCase() === tag.toLowerCase() || x.name.toLowerCase() === tag.toLowerCase());
    if (a && !area) { area = a.id; return ''; } return m;
  }).replace(/\s+/g, ' ').trim();
  return { title, area };
}

// ── Tasks: a day, a week, and rolling over ──────────────────────────────────
const byOrder = (a, b) => (a.done - b.done) || (a.order - b.order) || (a.createdAt - b.createdAt);
/** Tasks for one day. Viewing today also brings in unfinished tasks from earlier days (late = days ago). */
export function tasksForDay(items, day, today) {
  return items.filter(i => i.kind === 'task' && i.scope === 'day' && (i.date === day || (day === today && !i.done && i.date < today)))
    .map(i => ({ ...i, late: i.date < day ? daysBetween(i.date, day) : 0 })).sort(byOrder);
}
/** Tasks for a week (its Monday). This week also brings in unfinished ones from earlier weeks. */
export function tasksForWeek(items, monday, thisMonday) {
  return items.filter(i => i.kind === 'task' && i.scope === 'week' && (i.date === monday || (monday === thisMonday && !i.done && i.date < thisMonday)))
    .map(i => ({ ...i, late: i.date < monday ? Math.round(daysBetween(i.date, monday) / 7) : 0 })).sort(byOrder);
}
/** Every task that belongs to the week starting `monday`: week goals and each day's tasks. */
export function weekTasks(items, monday) {
  const end = addDays(monday, 6);
  return items.filter(i => i.kind === 'task' && i.date >= monday && i.date <= end);
}

// ── Habits ──────────────────────────────────────────────────────────────────
export const habitDoneOn = (h, day) => (h.log || []).includes(day);
export const habitWeekCount = (h, monday) => { const end = addDays(monday, 6); return (h.log || []).filter(d => d >= monday && d <= end).length; };
/** Daily habits (goal 7): days in a row up to today (or yesterday, if today isn't ticked yet).
 *  Weekly habits (goal < 7): weeks in a row that met the goal (this week counts once met). */
export function habitStreak(h, today) {
  const log = new Set(h.log || []);
  if ((h.goal || 7) >= 7) {
    let d = log.has(today) ? today : addDays(today, -1); let n = 0;
    while (log.has(d)) { n++; d = addDays(d, -1); }
    return { n, unit: 'day' };
  }
  let mon = mondayOf(today); let n = 0;
  if (habitWeekCount(h, mon) < h.goal) mon = addDays(mon, -7);
  while (habitWeekCount(h, mon) >= h.goal) { n++; mon = addDays(mon, -7); }
  return { n, unit: 'week' };
}
/** This week's progress towards the habit's goal, 0–1. */
export const habitProgress = (h, today) => Math.min(1, habitWeekCount(h, mondayOf(today)) / (h.goal || 7));
/** Tick or untick a day. Returns the new log. */
export function toggleHabit(h, day) {
  const log = new Set(h.log || []); if (log.has(day)) log.delete(day); else log.add(day);
  return [...log].sort().slice(-SELF_LIMITS.log);
}

// ── Skills ──────────────────────────────────────────────────────────────────
export const skillMinutes = (s, from = '', to = '9999') => (s.log || []).filter(e => e.d >= from && e.d <= to).reduce((n, e) => n + e.m, 0);
/** { level 0–3, name, hours, goal, nextAt (hours), pct towards the next level 0–1 } */
export function skillLevel(s) {
  const goal = s.goal || 100; const hours = Math.max(0, skillMinutes(s)) / 60;
  let level = 0; LEVEL_AT.forEach((f, i) => { if (hours >= f * goal) level = i; });
  if (level === 3) return { level, name: SKILL_LEVELS[3], hours, goal, nextAt: goal, pct: 1 };
  const from = LEVEL_AT[level] * goal, to = LEVEL_AT[level + 1] * goal;
  return { level, name: SKILL_LEVELS[level], hours, goal, nextAt: to, pct: Math.min(1, (hours - from) / (to - from)) };
}
/** Hours per week for the last n weeks, oldest first: [{ monday, hours }]. */
export function skillWeeks(s, today, n = 12) {
  const mon = mondayOf(today);
  return Array.from({ length: n }, (_, i) => { const m = addDays(mon, -7 * (n - 1 - i)); return { monday: m, hours: skillMinutes(s, m, addDays(m, 6)) / 60 }; });
}
/** The day each level was reached (from the log), for the skill's journey. */
export function skillMilestones(s) {
  const goal = s.goal || 100; let mins = 0; const out = [];
  [...(s.log || [])].sort((a, b) => a.d.localeCompare(b.d)).forEach(e => {
    const before = mins; mins += e.m;
    for (let l = 1; l < 4; l++) if (before / 60 < LEVEL_AT[l] * goal && mins / 60 >= LEVEL_AT[l] * goal) out.push({ d: e.d, level: l, name: SKILL_LEVELS[l] });
  });
  return out;
}

// ── The month at a glance (the big orb) ─────────────────────────────────────
export function monthSummary(items, today) {
  const first = today.slice(0, 8) + '01'; const days = daysBetween(first, today) + 1;
  const habits = items.filter(i => i.kind === 'habit' && !i.archived);
  let kept = 0, target = 0;
  habits.forEach(h => { kept += (h.log || []).filter(d => d >= first && d <= today).length; target += Math.max(1, Math.round((h.goal || 7) * days / 7)); });
  const tasks = items.filter(i => i.kind === 'task' && i.date >= first && i.date <= today);
  const done = tasks.filter(t => t.done).length;
  const skills = items.filter(i => i.kind === 'skill');
  const hours = skills.reduce((n, s) => n + skillMinutes(s, first, today), 0) / 60;
  const learned = items.filter(i => i.kind === 'learning' && i.date >= first && i.date <= today).length;
  const parts = []; if (target) parts.push(Math.min(1, kept / target)); if (tasks.length) parts.push(done / tasks.length);
  const pct = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  // Last month, same span, for "vs last month".
  const pFirst = iso(new Date(at(first).getFullYear(), at(first).getMonth() - 1, 1)); const pTo = addDays(pFirst, days - 1);
  const pHours = skills.reduce((n, s) => n + skillMinutes(s, pFirst, pTo), 0) / 60;
  return { pct, kept, target, done, tasks: tasks.length, hours, learned, hoursDelta: hours - pHours, month: at(today).toLocaleDateString('en-GB', { month: 'long' }) };
}
/** The longest current streak among habits: { title, n, unit } or null. */
export function bestStreak(items, today) {
  let best = null;
  items.filter(i => i.kind === 'habit' && !i.archived).forEach(h => { const s = habitStreak(h, today); if (s.n > 0 && (!best || s.n > best.n)) best = { title: h.title, ...s }; });
  return best;
}

// ── Throwback: what you were doing a while ago ──────────────────────────────
export const THROWBACKS = [['month', 30, 'A month ago'], ['quarter', 91, 'Three months ago'], ['year', 365, 'A year ago']];
/**
 * Something from about `daysAgo` days back (±4 days): a reflection, something learned, a skill you
 * started, or a habit you were keeping, with how it compares to now.
 * Returns { kind, when, date, text, quote?, now? } or null.
 */
export function throwback(items, today, daysAgo) {
  const target = addDays(today, -daysAgo); const lo = addDays(target, -4), hi = addDays(target, 4);
  const near = (d) => d >= lo && d <= hi; const dist = (d) => Math.abs(daysBetween(d, target));
  const label = (THROWBACKS.find(t => t[1] === daysAgo) || [0, 0, daysAgo + ' days ago'])[2];
  const skills = items.filter(i => i.kind === 'skill');
  const refl = items.filter(i => i.kind === 'reflect' && near(i.date) && (i.well || i.hard)).sort((a, b) => dist(a.date) - dist(b.date))[0];
  if (refl) return { kind: 'reflect', when: label, date: refl.date, text: 'you wrote in your weekly reflection:', quote: refl.well || refl.hard };
  const learn = items.filter(i => i.kind === 'learning' && near(i.date)).sort((a, b) => dist(a.date) - dist(b.date))[0];
  if (learn) { const sk = skills.find(s => s.id === learn.skillId); return { kind: 'learning', when: label, date: learn.date, text: 'you learned:', quote: learn.title, now: sk ? sk.title + ' is at ' + fmtHours(skillMinutes(sk) / 60) + ' now.' : '' }; }
  for (const s of skills) {
    const first = [...(s.log || [])].sort((a, b) => a.d.localeCompare(b.d))[0];
    if (first && near(first.d)) { const lv = skillLevel(s); return { kind: 'skill', when: label, date: first.d, text: 'you logged your first time on ' + s.title + '.', now: 'You’re at ' + fmtHours(lv.hours) + ' and ' + lv.name + ' now.' }; }
  }
  for (const s of skills) {
    const then = skillMinutes(s, '', target) / 60; const now = skillMinutes(s) / 60;
    if (then > 0 && now > then) return { kind: 'skill', when: label, date: target, text: 'you had ' + fmtHours(then) + ' on ' + s.title + '.', now: 'Now ' + fmtHours(now) + ': +' + fmtHours(now - then) + '.' };
  }
  const h = items.filter(i => i.kind === 'habit').map(x => ({ x, n: (x.log || []).filter(near).length })).sort((a, b) => b.n - a.n)[0];
  if (h && h.n) return { kind: 'habit', when: label, date: target, text: 'you kept “' + h.x.title + '” ' + h.n + ' time' + (h.n === 1 ? '' : 's') + ' that week.', now: 'This week: ' + habitWeekCount(h.x, mondayOf(today)) + ' so far.' };
  return null;
}
export const fmtHours = (h) => (h < 1 ? Math.round(h * 60) + ' min' : (Math.round(h * 10) / 10) + ' h');

// ── Example data (the demo's "Fill with an example") ────────────────────────
/** A few weeks of made-up SelfTrack history ending today: [{ id, ...item }] (uid added when saved). */
export function sampleSelf(today) {
  const d = (n) => addDays(today, -n); const mon = mondayOf(today); const out = []; let k = 0;
  const add = (x) => out.push({ id: 'sx' + (k++) + '_' + today.replace(/-/g, ''), createdAt: Date.now() - 40 * 864e5, updatedAt: Date.now(), ...x });
  const days = (list) => list.map(d).filter(x => x <= today);
  add({ kind: 'habit', title: 'Gym', area: 'health', goal: 3, log: days([1, 3, 6, 8, 10, 13, 15, 17, 20, 22, 24, 27, 29, 31]) });
  add({ kind: 'habit', title: 'Read 30 min', area: 'uni', goal: 7, log: days([0, 1, 2, 3, 4, 5, 8, 9, 11, 12, 15, 16, 19, 22, 26, 29, 30]) });
  add({ kind: 'habit', title: 'Breathwork', area: 'health', goal: 5, log: days([1, 2, 4, 7, 8, 9, 11, 14, 16, 21, 23]) });
  add({ kind: 'habit', title: 'Call home', area: 'home', goal: 1, log: days([6, 13, 20, 27]) });
  const ros = 'sx_ros_' + today.replace(/-/g, '');
  out.push({ id: ros, kind: 'skill', title: 'ROS 2', area: 'uni', goal: 100, createdAt: Date.now() - 31 * 864e5, updatedAt: Date.now(),
    log: [[31, 60], [29, 45], [26, 90], [24, 30], [22, 60], [19, 75], [17, 45], [15, 60], [12, 90], [10, 30], [8, 60], [5, 75], [3, 60], [1, 60], [0, 30]].map(([n, m]) => ({ d: d(n), m })) });
  add({ kind: 'skill', title: 'Python for robotics', area: 'projects', goal: 100, log: [[20, 60], [14, 45], [9, 90], [6, 60], [2, 105]].map(([n, m]) => ({ d: d(n), m })) });
  add({ kind: 'skill', title: 'CAD (Creo)', area: 'projects', goal: 60, log: [[60, 1200], [40, 900], [11, 120], [4, 90]].map(([n, m]) => ({ d: d(n), m })) });
  add({ kind: 'learning', title: 'ROS 2 nodes talk over topics; a publisher doesn’t know who listens', skillId: ros, date: d(30) });
  add({ kind: 'learning', title: 'Quaternions avoid gimbal lock in IMU sensor fusion', skillId: ros, date: d(2) });
  add({ kind: 'learning', title: 'PETG over PLA for parts left in the sun', area: 'projects', date: d(4) });
  add({ kind: 'learning', title: 'Servo jitter came from a shared ground', area: 'projects', date: d(6) });
  add({ kind: 'reflect', date: mondayOf(addDays(today, -27)), well: 'Got ROS 2 installed and ran the turtle demo. No idea what a node is yet.', hard: 'Too many tabs, not enough sleep.', mood: 2 });
  add({ kind: 'reflect', date: addDays(mon, -7), well: 'Read every day and the servo wiring is finally clean.', hard: 'Skipped gym twice.', mood: 3 });
  add({ kind: 'task', title: 'Read Siciliano ch. 3 (kinematics)', area: 'uni', scope: 'day', date: today });
  add({ kind: 'task', title: 'Buy groceries', area: 'home', scope: 'day', date: today });
  add({ kind: 'task', title: 'Pay rent', area: 'home', scope: 'day', date: today, done: true, doneOn: today });
  add({ kind: 'task', title: 'Email the module leader about coursework', area: 'uni', scope: 'day', date: d(1) });
  add({ kind: 'task', title: 'Coursework 1: report draft', area: 'uni', scope: 'week', date: mon });
  add({ kind: 'task', title: 'Robot arm: wire servos 4–6 to the ESP32', area: 'projects', scope: 'week', date: mon });
  add({ kind: 'task', title: 'Laundry', area: 'home', scope: 'week', date: mon, done: true, doneOn: today });
  add({ kind: 'task', title: 'Book a GP appointment', area: 'health', scope: 'day', date: addDays(today, 1) });
  return out;
}

// ── Synced from your teams ──────────────────────────────────────────────────
/**
 * My open team tasks for this week, from myWork() ([{ teamId, team, tasks }]): due this week or
 * overdue, or in the team's current week. Teams switched off in sync are left out.
 * Returns [{ teamId, team, id, name, dueDate, late, weekTitle }], soonest first.
 */
export function syncedTeamTasks(work, uid, today, sync = {}) {
  const mon = mondayOf(today), sun = addDays(mon, 6); const rows = [];
  (work || []).forEach(w => {
    if (sync[w.teamId] === false) return;
    const weeks = w.team.weeks || [];
    const cur = weeks.find(x => x.startDate && x.startDate <= today && today <= addDays(x.startDate, 6));
    // A task carried forward to a later week is one piece of work: only its newest copy counts.
    const carried = new Set((w.tasks || []).map(t => t.carryOf).filter(Boolean));
    (w.tasks || []).forEach(t => {
      if (carried.has(t.id)) return;
      if (t.flag === 'completed' || !(t.ownerUid === uid || t.supportPersonId === uid || t.supportPersonId2 === uid)) return;
      const due = isDate(t.dueDate) ? t.dueDate : '';
      const inWeek = cur && t.weekId === cur.key;
      if (!(inWeek || (due && due <= sun))) return;
      rows.push({ teamId: w.teamId, team: w.team.name || 'Team', id: t.id, name: t.name || 'Untitled task', dueDate: due, late: due && due < today ? daysBetween(due, today) : 0, weekTitle: inWeek ? cur.title : '', support: t.ownerUid !== uid });
    });
  });
  return rows.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.name.localeCompare(b.name));
}
