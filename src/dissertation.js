// ─────────────────────────────────────────────────────────────────────────────
//  Dissertations and theses: turn a hand-in date into a week-by-week plan.
//  Undergraduate dissertation / final-year project, master's dissertation, PhD thesis.
//
//  buildDissertationPlan() is pure (no DOM, no board): it returns phases for the Gantt,
//  the weeks to put on the board, and tasks with deadlines, checklists and milestones.
//  The app applies the result to a new team (see applyDissertationPlan in main.js).
//
//  Trawpie helps students plan and manage the work. It never writes any of it for them.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 864e5;
const at = (iso) => new Date(iso + 'T12:00:00Z');
const iso = (d) => new Date(d).toISOString().slice(0, 10);   // date maths on UTC noon timestamps (at())
/** Today on this device's calendar (not UTC: just after midnight in summer time UTC is still yesterday). */
const localToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
export const isISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(at(v).getTime());
const addDays = (s, n) => iso(at(s).getTime() + n * DAY);
const daysBetween = (a, b) => Math.round((at(b) - at(a)) / DAY);
/** Monday of the week holding `s` (ISO date). */
export const mondayOf = (s) => { const d = at(s); return iso(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY); };

export const LEVELS = {
  ug: { key: 'ug', name: 'Undergraduate dissertation or final-year project', short: 'Undergraduate', words: 10000, months: 7 },
  masters: { key: 'masters', name: 'Master’s dissertation', short: 'Master’s', words: 15000, months: 4 },
  phd: { key: 'phd', name: 'PhD thesis', short: 'PhD', words: 80000, months: 42 },
};
export const KINDS = {
  people: { key: 'people', name: 'With people', help: 'Interviews, surveys, focus groups or observation. Needs ethics approval.' },
  lab: { key: 'lab', name: 'Lab, experiments or building something', help: 'Experiments, prototypes, hardware or software you build and test.' },
  data: { key: 'data', name: 'Data or computational', help: 'Existing datasets, simulations, modelling or code.' },
  literature: { key: 'literature', name: 'Literature only', help: 'Reading, theory and analysis of published work.' },
};

// Chapter presets: name and share of the word count (they add up to 1).
const CH = {
  standard: [['Introduction', 0.10], ['Literature review', 0.25], ['Methodology', 0.15], ['Results', 0.20], ['Discussion', 0.20], ['Conclusion', 0.10]],
  build: [['Introduction', 0.08], ['Background and literature', 0.20], ['Design', 0.17], ['Implementation', 0.17], ['Testing and results', 0.18], ['Discussion', 0.12], ['Conclusion', 0.08]],
  literature: [['Introduction', 0.10], ['Context and literature', 0.25], ['Approach', 0.10], ['Analysis', 0.30], ['Discussion', 0.15], ['Conclusion', 0.10]],
  phd: [['Introduction', 0.08], ['Literature review', 0.17], ['Methodology', 0.12], ['Study 1', 0.15], ['Study 2', 0.15], ['Study 3', 0.15], ['Discussion', 0.12], ['Conclusion', 0.06]],
};
/** The usual chapters for this level and kind of research, with word targets. */
export function defaultChapters(level = 'ug', kind = 'people', words) {
  const L = LEVELS[level] || LEVELS.ug;
  const total = Number(words) > 0 ? Math.round(Number(words)) : L.words;
  const set = level === 'phd' ? CH.phd : kind === 'lab' ? CH.build : kind === 'literature' ? CH.literature : CH.standard;
  const out = set.map(([name, share], i) => ({ id: 'ch' + (i + 1), name, target: Math.round(total * share / 100) * 100, words: 0, status: 'todo' }));
  const big = out.reduce((m, c) => (c.target > m.target ? c : m), out[0]);
  big.target += total - out.reduce((s, c) => s + c.target, 0);   // rounding: the targets add up to the total exactly
  return out;
}
/** The role a supervisor joins with: sees everything and comments; changes only their own row (draft reviews). */
export const SUPERVISOR_ROLE = { name: 'Supervisor', builtin: false, order: 3, perms: { 'tasks.editOwn': true, 'analytics.view': true } };
export const CHAPTER_STATUS = [['todo', 'Not started'], ['drafting', 'Drafting'], ['supervisor', 'With supervisor'], ['revising', 'Revising'], ['final', 'Final']];

const COLORS = ['#7c5cff', '#0e9f8e', '#e8590c', '#1c7ed6', '#c2255c', '#2f9e44', '#f08c00', '#5f3dc4', '#0b7285', '#868e96', '#d6336c', '#495057'];

/** Which part of a chapter's work belongs to which phase, so its draft is due when that phase ends. */
function chapterPhase(name, level) {
  const n = name.toLowerCase();
  if (/literature|background|context/.test(n)) return 'lit';
  if (/method|approach|design/.test(n)) return 'method';
  if (/implementation/.test(n)) return 'data';
  if (/result|analysis|testing|study/.test(n)) return level === 'phd' ? 'studies' : 'analysis';
  return 'writing';   // introduction, discussion, conclusion: written near the end
}

/**
 * Build the plan.
 * @param {object} o
 *   level: 'ug' | 'masters' | 'phd'
 *   kind: 'people' | 'lab' | 'data' | 'literature'
 *   start, handIn: ISO dates (hand-in is the submission date; for a PhD, thesis submission)
 *   dates: optional ISO dates { proposal, ethics, review, draft, upgrade, viva }
 *   chapters: [{ id, name, target }] (defaults by level and kind)
 *   today: ISO date (for tests)
 * @returns {{ phases, weeks, tasks, chapters, laterFrom, warnings, summary }}
 *   weeks: [{ title, startDate }] to show on the board; tasks due after the last week go to the Backlog.
 */
export function buildDissertationPlan(o = {}) {
  const level = LEVELS[o.level] ? o.level : 'ug';
  const kind = KINDS[o.kind] ? o.kind : 'people';
  const warnings = [];
  const start = isISO(o.start) ? o.start : (isISO(o.today) ? o.today : localToday());
  let handIn = isISO(o.handIn) ? o.handIn : addDays(start, Math.round(LEVELS[level].months * 30.4));
  if (daysBetween(start, handIn) < 21) { warnings.push('The hand-in date is less than three weeks away, so the plan is very tight.'); if (daysBetween(start, handIn) < 7) { handIn = addDays(start, 7); warnings.push('A plan needs at least a week, so it runs to ' + handIn + '. Check your real hand-in date.'); } }
  const total = daysBetween(start, handIn);
  const D = o.dates || {};
  const inRange = (v) => isISO(v) && daysBetween(start, v) >= 0 && daysBetween(v, handIn) >= 0;
  const when = (f) => addDays(start, Math.round(total * f));
  const dateOr = (v, f) => (inRange(v) ? v : when(f));
  const chapters = (Array.isArray(o.chapters) && o.chapters.length ? o.chapters : defaultChapters(level, kind)).slice(0, 20)
    .map((c, i) => ({ id: String(c.id || 'ch' + (i + 1)), name: String(c.name || 'Chapter ' + (i + 1)).slice(0, 80), target: Math.max(0, Math.round(Number(c.target) || 0)), words: Math.max(0, Math.round(Number(c.words) || 0)), status: c.status || 'todo' }));

  const phases = []; const tasks = [];
  const phase = (id, name, s, e, milestone = '') => {
    const p = { id: 'ph_' + id, name, color: COLORS[phases.length % COLORS.length], start: s, end: e < s ? s : e, milestone };
    phases.push(p); return p;
  };
  // A task inside a phase, due at `f` (0..1) through the phase, or on a fixed date.
  const task = (p, name, f, extra = {}) => {
    const due = extra.due || addDays(p.start, Math.round(daysBetween(p.start, p.end) * f));
    tasks.push({ name, due, phaseId: p.id, priority: extra.priority || 'Minor', subtasks: extra.subtasks || [], milestone: !!extra.milestone, icon: extra.icon || '', note: extra.note || '' });
  };
  const milestone = (p, name, due, subtasks = []) => task(p, name, 1, { due, priority: 'Critical', milestone: true, icon: '🚩', subtasks });
  const needsEthics = kind === 'people';

  if (level === 'phd') {
    // ── PhD: the whole thesis in phases; weeks for the first term, the rest waits in the Backlog with dates.
    const upgrade = dateOr(D.upgrade, 0.3);
    const draft = dateOr(D.draft, 0.88);
    const year = (n) => addDays(start, 365 * n);
    const p1 = phase('lit', 'Literature review and research questions', start, when(0.25));
    task(p1, 'Set up your reading list in Literature', 0.02, { icon: '📚', subtasks: ['Add the key papers your supervisors suggested', 'Choose tags for your main themes'] });
    task(p1, 'Systematic search of the literature', 0.3, { icon: '🔎', subtasks: ['Agree search terms with your supervisors', 'Search the main databases', 'Keep a log of searches and results'] });
    task(p1, 'Write your research questions', 0.6, { icon: '❓', subtasks: ['Draft 2–4 research questions', 'Check each one is answerable in the time', 'Agree them with your supervisors'] });
    task(p1, 'First draft of the literature review', 1, { icon: '📝' });
    const p2 = phase('plan', 'Research plan and training', start, when(0.15));
    task(p2, 'Agree a research plan with your supervisors', 0.25, { icon: '🗺', subtasks: ['Aims and objectives', 'Studies and methods', 'Timeline to submission', 'How often you will meet'] });
    task(p2, 'Training: methods courses and research integrity', 0.7, { icon: '🎓', subtasks: ['List the skills you need', 'Book the courses', 'Research integrity training'] });
    if (needsEthics) {
      const pe = phase('ethics', 'Ethics approval', when(0.08), dateOr(D.ethics, 0.18), 'Ethics approved');
      task(pe, 'Prepare the ethics application', 0.6, { icon: '📋', subtasks: ['Participant information sheet', 'Consent form', 'Data management plan', 'Risk assessment'] });
      milestone(pe, 'Ethics approved', pe.end);
    }
    const pp = phase('pilot', kind === 'literature' ? 'First analysis' : 'Pilot study', when(0.15), addDays(upgrade, -14));
    task(pp, kind === 'literature' ? 'Try your analysis on a small set of sources' : 'Run a small pilot study', 0.6, { icon: '🧪', subtasks: ['Plan it', 'Run it', 'Write down what to change'] });
    task(pp, 'Write up the pilot (it becomes part of your upgrade report)', 1, { icon: '📝' });
    const pu = phase('upgrade', 'Upgrade / confirmation review', addDays(upgrade, -42), upgrade, 'Upgrade / confirmation review');
    task(pu, 'Write the upgrade report', 0.7, { icon: '📝', priority: 'Major', subtasks: ['Literature review chapter', 'Pilot results', 'Plan for the remaining studies', 'Timeline to submission'] });
    milestone(pu, 'Upgrade / confirmation review', upgrade, ['Send the report to the panel', 'Prepare a short presentation', 'Agree changes afterwards']);
    const studies = chapters.filter(c => /study/i.test(c.name));
    const n = Math.max(1, studies.length || 3);
    const ps = phase('studies', 'Main studies', upgrade, when(0.7));
    for (let i = 0; i < n; i++) {
      const name = studies[i] ? studies[i].name : 'Study ' + (i + 1);
      const s0 = (i / n), s1 = ((i + 1) / n);
      task(ps, name + ': plan and set up', s0 + (s1 - s0) * 0.2, { icon: '🗺' });
      task(ps, name + ': collect the data', s0 + (s1 - s0) * 0.65, { icon: kind === 'lab' ? '🧪' : kind === 'data' ? '💻' : '📊' });
      task(ps, name + ': analyse and write up', s1, { icon: '📝', subtasks: ['Analysis', 'Figures and tables', 'Chapter draft'] });
    }
    const pc = phase('papers', 'Papers and conferences', when(0.45), when(0.85));
    task(pc, 'Write a paper from your first study', 0.35, { icon: '📄', subtasks: ['Choose a journal', 'Draft', 'Supervisors’ comments', 'Submit'] });
    task(pc, 'Present at a conference', 0.65, { icon: '🎤', subtasks: ['Choose a conference', 'Submit an abstract', 'Prepare the talk or poster'] });
    // Annual reviews (most UK universities): every year except the one the upgrade covers.
    for (let y = 1; y * 365 < total; y++) {
      const d = year(y); if (Math.abs(daysBetween(d, upgrade)) < 120) continue;
      const pr = phases.find(p => p.start <= d && p.end >= d && p.id !== 'ph_upgrade') || ps;
      milestone(pr, 'Annual progress review (year ' + y + ')', d, ['Progress report', 'Updated timeline', 'Meeting with the review panel']);
    }
    const pw = phase('writing', 'Writing up', when(0.62), draft, 'Full thesis draft to supervisors');
    chapters.filter(c => !/study/i.test(c.name)).forEach((c, i, list) => {
      const f = /intro/i.test(c.name) ? 0.95 : /conclu/i.test(c.name) ? 0.9 : /discuss/i.test(c.name) ? 0.8 : 0.15 + 0.5 * (i / Math.max(1, list.length));
      task(pw, 'Write: ' + c.name, f, { icon: '✍️', subtasks: ['Outline', 'First draft', 'Edit after supervisor comments'] });
    });
    milestone(pw, 'Full thesis draft to supervisors', draft);
    const pv = phase('revise', 'Revisions', draft, addDays(handIn, -7));
    task(pv, 'Work through your supervisors’ comments', 0.5, { icon: '✏️' });
    task(pv, 'Check references, figures and formatting', 0.9, { icon: '🔍', subtasks: ['Every citation is in the reference list', 'Figure and table numbers', 'Your university’s thesis format'] });
    const pf = phase('submit', 'Submission', addDays(handIn, -7), handIn, 'Thesis submitted');
    milestone(pf, 'Submit your thesis', handIn, ['Declaration and abstract', 'Upload or print as your university asks', 'Tell your supervisors and the graduate school']);
    const viva = isISO(D.viva) && daysBetween(handIn, D.viva) > 0 ? D.viva : addDays(handIn, 84);
    const pvv = phase('viva', 'Viva and corrections', handIn, addDays(viva, 90), 'Viva');
    task(pvv, 'Prepare for your viva', 0, { due: addDays(viva, -10), icon: '🎓', subtasks: ['Re-read your thesis', 'List likely questions', 'Mock viva with a supervisor', 'Note any errors you’ve found'] });
    milestone(pvv, 'Viva', viva);
    task(pvv, 'Corrections', 1, { icon: '✏️', subtasks: ['List every correction asked for', 'Make them', 'Send to the examiners'] });
  } else {
    // ── Undergraduate and master's: one phase per stage of the work, every week on the board.
    const proposal = dateOr(D.proposal, 0.12);
    const draft = dateOr(D.draft, 0.8);
    let ethicsEnd = '';   // working with people: nothing is recruited or piloted before ethics approval
    const p1 = phase('topic', 'Topic and proposal', start, proposal, 'Proposal submitted');
    task(p1, 'First meeting with your supervisor', 0.25, { icon: '👥', subtasks: ['Send your topic ideas beforehand', 'Agree how often you will meet', 'Ask how the dissertation is marked'] });
    task(p1, 'Choose a topic and a working question', 0.45, { icon: '💡', subtasks: ['List three topics you could enjoy for months', 'Check each has enough to read', 'Write your favourite as a question'] });
    task(p1, 'Write the proposal', 0.9, { icon: '📝', subtasks: ['Research question and aims', 'A short summary of the literature', 'Methods and timeline', 'Ethics', 'References'] });
    milestone(p1, 'Proposal submitted', proposal);
    if (needsEthics) {
      const ethics = dateOr(D.ethics, 0.2);
      const pe = phase('ethics', 'Ethics approval', addDays(proposal, -7), ethics < proposal ? proposal : ethics, 'Ethics approved');
      task(pe, 'Check what ethics approval you need', 0.1, { icon: '📋', subtasks: ['Read your department’s ethics guidance', 'Ask your supervisor'] });
      task(pe, 'Prepare the ethics application', 0.6, { icon: '📋', subtasks: ['Participant information sheet', 'Consent form', 'Data management plan', 'Risk assessment'] });
      milestone(pe, 'Ethics approved', pe.end);
      ethicsEnd = pe.end;
    }
    const pl = phase('lit', kind === 'literature' ? 'Reading and sources' : 'Literature review', when(0.05), when(0.35));
    task(pl, 'Set up your reading list in Literature', 0.05, { icon: '📚' });
    task(pl, 'Search for sources', 0.3, { icon: '🔎', subtasks: ['Google Scholar', 'Your library’s databases', 'Note the search terms you used'] });
    task(pl, 'Read and take notes on the key sources', 0.7, { icon: '📖' });
    const pm = phase('method', kind === 'lab' ? 'Design' : kind === 'literature' ? 'Approach' : 'Methodology', when(0.2), when(0.35));
    task(pm, kind === 'lab' ? 'Choose the design and how you will test it' : 'Choose your methods and say why', 0.5, { icon: '🧭' });
    if (kind === 'lab') task(pm, 'Lab induction and risk assessment', 0.3, { icon: '🦺', subtasks: ['Book the induction', 'Risk assessment signed off'] });
    if (kind === 'data') task(pm, 'Check you may use the data', 0.3, { icon: '🔐', subtasks: ['Licence or permission', 'Personal data? Ask about ethics'] });
    const DATA = {
      people: ['Data collection', [['Recruit participants', 0.2, '📣'], ['Pilot your interview or survey', 0.3, '🧪'], ['Collect the data', 0.75, '📊'], ['Transcribe and store the data securely', 1, '🔐']]],
      lab: ['Building and experiments', [['Order parts and book lab time', 0.1, '🛒'], ['Build or set up', 0.45, '🔧'], ['Run the experiments (log them in the lab notebook)', 0.85, '🧪'], ['Back up the raw data', 1, '💾']]],
      data: ['Data and code', [['Get and clean the data', 0.3, '🧹'], ['Write and test your code', 0.6, '💻'], ['Run the main analysis', 1, '📊']]],
      literature: ['Deep reading', [['Gather your primary sources', 0.3, '📚'], ['Build a table of themes across sources', 0.7, '🧩'], ['Decide your argument', 1, '💡']]],
    }[kind];
    const dataStart = ethicsEnd && ethicsEnd > when(0.3) ? ethicsEnd : when(0.3);
    if (ethicsEnd && ethicsEnd > when(0.45)) warnings.push('Ethics approval comes late in your plan (' + ethicsEnd + '), so there is little time to collect data. Ask your supervisor whether you can apply sooner.');
    const pd = phase('data', DATA[0], dataStart, dataStart >= when(0.55) ? addDays(dataStart, 21) : when(0.6));
    DATA[1].forEach(([n, f, ic]) => task(pd, n, f, { icon: ic }));
    const pa = phase('analysis', kind === 'lab' ? 'Testing and results' : 'Analysis', when(0.55), when(0.72));
    task(pa, kind === 'lab' ? 'Test and measure against your aims' : 'Analyse your results', 0.5, { icon: '📊' });
    task(pa, 'Make the figures and tables', 0.85, { icon: '📈' });
    const pw = phase('writing', 'Writing', when(0.35), draft, 'Full draft to supervisor');
    chapters.forEach(c => {
      const home = chapterPhase(c.name, level);
      const p = phases.find(x => x.id === 'ph_' + home) || pw;
      const f = home !== 'writing' ? 1 : /intro/i.test(c.name) ? 0.97 : /conclu/i.test(c.name) ? 0.93 : /discuss/i.test(c.name) ? 0.85 : 0.7;
      task(p, 'Write: ' + c.name, f, { icon: '✍️', subtasks: ['Outline', 'First draft', 'Edit'] });
    });
    milestone(pw, 'Full draft to supervisor', draft);
    const pv = phase('revise', 'Revisions and proofreading', draft, when(0.95));
    task(pv, 'Work through your supervisor’s feedback', 0.4, { icon: '✏️' });
    task(pv, 'Check references and citations', 0.7, { icon: '🔍' });
    task(pv, 'Proofread (read it aloud)', 0.95, { icon: '👀', subtasks: ['Spelling and grammar', 'Figure and table numbers', 'Abstract last'] });
    const pf = phase('submit', 'Formatting and hand-in', when(0.95), handIn, 'Hand-in');
    task(pf, 'Format to your department’s guidelines', 0.4, { icon: '📐', subtasks: ['Title page and declaration', 'Contents and lists of figures', 'Page numbers and margins', 'Word count within the limit'] });
    milestone(pf, 'Hand in your dissertation', handIn, ['Similarity check if your university asks', 'Upload or print as required', 'Keep a copy']);
    if (isISO(D.viva) && daysBetween(handIn, D.viva) > 0) {
      const pvv = phase('viva', 'Presentation or viva', handIn, D.viva, 'Presentation or viva');
      task(pvv, 'Prepare your presentation', 0.6, { icon: '🎤', subtasks: ['Slides', 'Practise with a friend', 'Likely questions'] });
      milestone(pvv, 'Presentation or viva', D.viva);
    }
  }

  // Never before the start; tidy order.
  tasks.forEach(t => { if (t.due < start) t.due = start; });
  tasks.sort((a, b) => a.due.localeCompare(b.due) || Number(b.milestone) - Number(a.milestone));
  if (phases.length > 20) phases.length = 20;

  // Weeks on the board: every week to hand-in (to the viva, if there is one) for undergraduate and
  // master's (up to a year); a PhD shows its first 13 weeks and keeps the rest in the Backlog.
  const lastDue = tasks.reduce((m, t) => (t.due > m ? t.due : m), handIn);
  const firstMon = mondayOf(start), lastMon = mondayOf(level === 'phd' ? addDays(start, 7 * 12) : lastDue);
  const weeks = [];
  for (let d = firstMon, i = 1; d <= lastMon && weeks.length < 60; d = addDays(d, 7), i++) weeks.push({ title: 'WEEK ' + i, startDate: d });
  const laterFrom = addDays(weeks[weeks.length - 1].startDate, 7);
  const later = tasks.filter(t => t.due >= laterFrom).length;
  return {
    level, kind, start, handIn, phases, weeks, tasks, chapters, laterFrom, warnings,
    dates: Object.fromEntries(Object.entries(D).filter(([k, v]) => ['proposal', 'ethics', 'review', 'draft', 'upgrade', 'viva'].includes(k) && isISO(v))),
    summary: { weeks: weeks.length, phases: phases.length, tasks: tasks.length, milestones: tasks.filter(t => t.milestone).length, later, totalWords: chapters.reduce((s, c) => s + c.target, 0) },
  };
}

/** Days from `today` to the hand-in (negative once it has passed). */
export const daysLeft = (handIn, today = localToday()) => (isISO(handIn) ? daysBetween(today, handIn) : null);

/**
 * Where you are against the plan, from the plan's tasks: on track when every task due before today is done.
 * Behind: how long ago the oldest unfinished task was due ("about N days behind").
 * @returns {{ state: 'ok'|'behind'|'late'|'none', days: number, ahead: number, done: number, due: number }}
 */
export function scheduleStatus(tasks, today = localToday()) {
  const list = (tasks || []).filter(t => isISO(t.dueDate)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (!list.length) return { state: 'none', days: 0, ahead: 0, done: 0, due: 0 };
  const isDone = (t) => t.flag === 'completed';
  const due = list.filter(t => t.dueDate < today).length;
  const done = list.filter(isDone).length;
  // On track only when everything due before today is done: finishing later tasks early doesn't make up for
  // an overdue one (it is still waiting, e.g. ethics approval before recruiting).
  const overdue = list.filter(t => t.dueDate < today && !isDone(t));
  if (!overdue.length) return { state: 'ok', days: 0, ahead: list.filter(t => t.dueDate >= today && isDone(t)).length, done, due };
  const days = Math.max(1, daysBetween(overdue[0].dueDate, today));
  return { state: days > 21 ? 'late' : 'behind', days, ahead: 0, done, due };
}

/** The supervisor's own decision on a review task: the newest "✅ Approved" / "✏️ Changes needed" comment on it
 *  written by a member with the Supervisor role (who wrote a comment is checked by the security rules; a task's
 *  status is not, as the student owns the team and can edit any task). 'approved' | 'changes' | ''. */
export function supervisorDecision(comments, members, taskId) {
  const sup = new Set((members || []).filter(m => m.roleId === 'supervisor').map(m => m.uid));
  const c = (comments || []).filter(x => x.taskId === taskId && sup.has(x.authorUid) && /^(✅ Approved|✏️ Changes needed)/u.test(x.text || ''))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  return c ? (c.text.startsWith('✅') ? 'approved' : 'changes') : '';
}
/** A chapter draft's state, read from its review task (owned by the supervisor). `decision`: supervisorDecision(),
 *  when known: "Approved" is shown only when the supervisor recorded it. */
export function draftState(task, today = localToday(), decision) {
  if (!task) return { state: 'gone', label: 'Review task deleted' };
  const st = String(task.status || '').toLowerCase();
  if (task.flag === 'completed' && st.startsWith('approved')) return decision === undefined || decision === 'approved' ? { state: 'approved', label: 'Approved' } : { state: 'unconfirmed', label: 'Marked approved, not by the supervisor' };
  if (st.startsWith('changes')) return { state: 'changes', label: 'Changes asked' };
  if (task.flag === 'completed') return { state: 'reviewed', label: 'Reviewed' };
  if (isISO(task.dueDate) && task.dueDate < today) return { state: 'late', label: 'Feedback overdue' };
  return { state: 'waiting', label: 'Waiting for feedback' };
}
