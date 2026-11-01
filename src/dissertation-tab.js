// ─────────────────────────────────────────────────────────────────────────────
//  🧰 Tools ▸ 🎓 Dissertation: overview (countdown, phases, next milestone), chapters and
//  word counts, the proposal helper, checklists, and supervisor meetings.
//  Everything here is the student's own words: Penteint Projects lays out, checks and reminds.
// ─────────────────────────────────────────────────────────────────────────────
import { el, toast, modal } from './ui.js';
import { cleanDissertation, newId, DISS_PROPOSAL, dissertationOf, cleanUrl, carryIndexOf } from './model.js';
import { LEVELS, KINDS, CHAPTER_STATUS, daysLeft, isISO, scheduleStatus, draftState, supervisorDecision } from './dissertation.js';
import { linkInfo } from './filehealth.js';

let view = 'overview'; let shownFor = null;   // the sub-view; a freshly opened Tools window starts on the overview
let showOutline = false;
const VIEWS = [['overview', 'Overview'], ['chapters', 'Chapters'], ['proposal', 'Proposal'], ['checks', 'Checklists'], ['supervisor', 'Supervisor']];
const fmt = (iso) => (isISO(iso) ? new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round(100 * a / b))) : 0);
const bar = (p, label) => el('div.diss-bar', { role: 'progressbar', 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label }, el('span', { style: { width: p + '%' } }));

/** Draw the tab into `pane`. `kit` is the Tools kit (research.js); `openSetup()` opens the plan setup. */
export function dissertationPane(pane, kit, openSetup) {
  if (shownFor !== kit.R) { shownFor = kit.R; view = 'overview'; showOutline = false; }
  const S = kit.S(); const T = S.team; const D = dissertationOf(S);
  const edit = kit.perm('team.settings');
  if (!D || !D.setupAt) {
    pane.append(el('div.empty-state.diss-empty', {},
      el('h3', {}, 'Plan your dissertation'),
      el('p', {}, 'Tell us your hand-in date and we’ll lay out the whole thing week by week: phases on the Gantt, tasks with checklists, chapters with word targets, and the milestones that matter. Works for undergraduate, master’s and PhD.'),
      edit ? el('button.btn.primary', { type: 'button', id: 'diss-setup', onclick: openSetup }, 'Set up my plan') : el('p.hint', {}, 'The owner of this workspace hasn’t set up the plan yet.')));
    return;
  }
  const save = async (patch, msg) => { const { id: _id, ...cur } = dissertationOf(kit.S()) || {}; void _id; const ok = await kit.write([{ type: 'set', path: 'dissertation/plan', data: cleanDissertation({ ...cur, ...patch }) }]); if (ok && msg) toast(msg); return ok; };
  const nav = el('div.diss-nav', { role: 'tablist', 'aria-label': 'Dissertation' }, VIEWS.map(([k, label]) => el('button' + (view === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(view === k), dataset: { dview: k }, onclick: () => { view = k; kit.render(); } }, label)));
  const body = el('div.diss-body');
  pane.append(nav, body);
  ({ overview, chapters, proposal, checks, supervisor })[view](body, { kit, S, T, D, edit, save, openSetup });
}

// ── Overview ────────────────────────────────────────────────────────────────
function overview(body, { kit, S, T, D, edit, openSetup }) {
  const left = daysLeft(D.handIn);
  // A task carried into later weeks is one piece of work: count only its latest copy.
  const ix = carryIndexOf(S);
  const tasks = (S.tasks || []).filter(t => !t.ghost && (ix.latest(t.id) || t).id === t.id);
  const done = (t) => t.flag === 'completed';
  const phases = (T.phases || []).filter(p => tasks.some(t => t.phaseId === p.id) || p.milestone);
  const today = new Date().toLocaleDateString('en-CA');
  const milestones = tasks.filter(t => t.icon === '🚩' && t.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const next = milestones.find(t => !done(t));
  const words = D.chapters.reduce((s, c) => s + c.words, 0), target = D.chapters.reduce((s, c) => s + c.target, 0);
  const planTasks = tasks.filter(t => phases.some(p => p.id === t.phaseId));
  const overdue = planTasks.filter(t => !done(t) && t.dueDate && t.dueDate < today).length;
  const L = LEVELS[D.level] || LEVELS.ug;
  body.append(
    el('div.diss-hero', {},
      el('div.diss-count', {}, el('b', {}, left === null ? '–' : left < 0 ? 'Handed in' : String(left)), el('span', {}, left === null || left < 0 ? '' : left === 1 ? 'day to go' : 'days to go')),
      el('div.diss-hero-txt', {},
        el('div.diss-level', {}, L.short + ' · ' + (KINDS[D.kind] || KINDS.people).name),
        el('div', {}, (D.level === 'phd' ? 'Thesis submission ' : 'Hand-in ') + fmt(D.handIn)),
        next ? el('div.diss-next', {}, 'Next milestone: ', el('b', {}, next.name), ' · ' + fmt(next.dueDate) + (daysLeft(next.dueDate) >= 0 ? ' (' + daysLeft(next.dueDate) + ' days)' : ' (overdue)')) : '',
        trackPill(scheduleStatus(planTasks, today)),
        overdue ? el('div.diss-warn', {}, (overdue === 1 ? '1 planned task is past its date. Carry-over moves it into this week; re-plan if it keeps slipping.' : overdue + ' planned tasks are past their date. Carry-over moves them into this week; re-plan if they keep slipping.')) : ''),
      el('div.diss-hero-act', {},
        edit ? el('button.btn.small', { type: 'button', onclick: openSetup }, 'Change the plan') : '',
        el('button.btn.small', { type: 'button', onclick: () => { kit.R.m.close(); if (window.openAnalytics) window.openAnalytics('timeline'); } }, 'See the timeline'),
        el('button.btn.small', { type: 'button', title: 'Your deadlines in Google Calendar, Outlook or Apple Calendar, with reminders', onclick: () => { kit.R.m.close(); window.TT.openCalendar(); } }, '📅 Reminders in my calendar'))),
    dueSoon(kit, tasks, today),
    el('div.diss-stats', {},
      stat('Tasks done', planTasks.filter(done).length + ' of ' + planTasks.length, pct(planTasks.filter(done).length, planTasks.length)),
      stat('Words written', words.toLocaleString() + ' of ' + target.toLocaleString(), pct(words, target)),
      stat('Time used', '', pct((Date.now() - new Date(D.start + 'T00:00:00')) / 864e5, (new Date(D.handIn + 'T00:00:00') - new Date(D.start + 'T00:00:00')) / 864e5))),
    el('h4', {}, 'Phases'),
    el('div.diss-phases', {}, phases.map(p => {
      const pts = planTasks.filter(t => t.phaseId === p.id); const d = pts.filter(done).length;
      const now = p.start <= today && today <= p.end;
      return el('div.diss-phase' + (now ? '.now' : '') + (pts.length && d === pts.length ? '.done' : ''), {},
        el('span.diss-dot', { style: { background: p.color } }),
        el('span.diss-ph-name', {}, p.name, now ? el('span.pill.blue', {}, 'Now') : ''),
        el('span.diss-ph-dates', {}, fmtShort(p.start) + ' – ' + fmtShort(p.end)),
        el('span.diss-ph-bar', {}, bar(pct(d, pts.length), p.name + ' progress')),
        el('span.diss-ph-n', {}, d + '/' + pts.length));
    })),
    milestones.length ? el('h4', {}, 'Milestones') : '',
    milestones.length ? el('ul.diss-ms', {}, milestones.map(t => el('li' + (done(t) ? '.done' : ''), {}, el('span', {}, done(t) ? '✓ ' : ''), el('b', {}, t.name), ' · ' + fmt(t.dueDate)))) : '');
}
const fmtShort = (iso) => (isISO(iso) ? new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const stat = (label, value, p) => el('div.diss-stat', {}, el('span.hint', {}, label), el('b', {}, value || p + '%'), bar(p, label));
/** "On track", or roughly how far behind the plan you are (from the plan's tasks and their dates). */
function trackPill(st) {
  if (st.state === 'none') return '';
  const text = st.state === 'ok' ? (st.ahead > 0 ? 'On track, ' + st.ahead + (st.ahead === 1 ? ' task' : ' tasks') + ' ahead' : 'On track')
    : st.days < 14 ? 'About ' + st.days + (st.days === 1 ? ' day' : ' days') + ' behind'
    : 'About ' + Math.round(st.days / 7) + ' weeks behind';
  const hint = st.state === 'ok' ? 'Every task due so far is done.' : st.state === 'late' ? 'Worth re-planning with your supervisor: move dates, drop or shrink tasks, and protect the buffer before hand-in.' : 'Catch up on the oldest open task first.';
  return el('div.diss-track.' + st.state, { title: hint, dataset: { track: st.state } }, el('b', {}, text), el('span', {}, ' · ' + hint));
}
/** What's due in the next 7 days (and anything already late), each opening its task. */
function dueSoon(kit, tasks, today) {
  const week = new Date(new Date(today + 'T12:00:00').getTime() + 7 * 864e5).toLocaleDateString('en-CA');
  const me = kit.me().uid;
  const list = tasks.filter(t => t.flag !== 'completed' && t.dueDate && t.dueDate <= week && (t.ownerUid === me || t.supportPersonId === me))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8);
  if (!list.length) return '';
  return el('div.diss-soon', {}, el('h4', {}, list.some(t => t.dueDate < today) ? 'Late, or due this week' : 'Due this week'),
    el('ul.diss-due', {}, list.map(t => el('li' + (t.dueDate < today ? '.late' : ''), {},
      el('button.link-btn', { type: 'button', onclick: () => { kit.R.m.close(); if (window.boardOpenTask) window.boardOpenTask(t.id); } }, t.name),
      ' · ' + (t.dueDate < today ? 'was due ' : '') + fmtShort(t.dueDate)))));
}

// ── Chapters, word counts and drafts ────────────────────────────────────────
function chapters(body, { kit, S, D, edit, save }) {
  const list = D.chapters.map(c => ({ ...c, drafts: (c.drafts || []).slice() }));
  const commit = (msg) => save({ chapters: list }, msg);
  const total = list.reduce((s, c) => s + c.words, 0), target = list.reduce((s, c) => s + c.target, 0);
  const sups = (S.members || []).filter(m => m.roleId === 'supervisor');
  const me = kit.me().uid;
  body.append(
    el('p.hint', {}, edit ? 'Update your word counts as you write. A rough number is fine: it’s about seeing where you are, not counting every word. Send a chapter to your supervisor when you want feedback on it.' : 'Chapters and word counts so far. Drafts sent for feedback are listed under their chapter.'),
    el('div.diss-ch-table', {},
      el('div.diss-ch-row.head', {}, el('span', {}, 'Chapter'), el('span', {}, 'Status'), el('span', {}, 'Words'), el('span', {}, 'Target'), el('span', {}, ''), el('span', {}, '')),
      ...list.flatMap((c, i) => {
        const status = el('select', { disabled: !edit, 'aria-label': c.name + ' status', onchange: (e) => { list[i].status = e.target.value; commit(); } }, CHAPTER_STATUS.map(([k, label]) => el('option', { value: k, selected: c.status === k }, label)));
        const words = el('input.inp', { type: 'number', min: 0, max: 500000, step: 50, value: c.words, disabled: !edit, 'aria-label': c.name + ' words written', dataset: { ch: c.id }, onchange: (e) => { list[i].words = Math.max(0, Number(e.target.value) || 0); commit(); } });
        const send = edit && sups.length ? el('button.btn.small.ghost', { type: 'button', dataset: { send: c.id }, title: 'Send this chapter to your supervisor for feedback', onclick: () => sendDraftDialog(kit, list, i, sups, commit) }, 'Send draft') : el('span');
        const row = el('div.diss-ch-row' + (c.status === 'final' ? '.final' : ''), {}, el('span.diss-ch-name', {}, c.name), status, words, el('span.diss-ch-target', {}, c.target.toLocaleString()), bar(pct(c.words, c.target), c.name), send);
        const drafts = c.drafts.length ? el('div.diss-drafts', {}, c.drafts.slice().reverse().map(d => draftChip(kit, c, d, me))) : null;
        return drafts ? [row, drafts] : [row];
      }),
      el('div.diss-ch-row.total', {}, el('b', {}, 'Total'), el('span', {}, ''), el('b', {}, total.toLocaleString()), el('b', {}, target.toLocaleString()), bar(pct(total, target), 'Total'), el('span'))),
    edit && !sups.length ? el('p.hint', {}, 'To send drafts for feedback, invite your supervisor first (Supervisor tab).') : '',
    edit ? el('p.hint', {}, 'To rename, add or remove chapters, or change the targets: Overview ▸ Change the plan.') : '');
}
/** One sent draft: its state from the supervisor's review task, the file, and (for the supervisor) the decision buttons. */
function draftChip(kit, c, d, me) {
  const task = kit.taskById(d.taskId); const ss = kit.S();
  const st = draftState(task, undefined, task ? supervisorDecision(ss.comments, ss.members, task.id) : '');
  const mine = task && task.ownerUid === me && (st.state === 'waiting' || st.state === 'late');
  const open = () => { kit.R.m.close(); if (task && window.boardOpenTask) window.boardOpenTask(task.id); };
  return el('div.diss-draft', { dataset: { draft: d.taskId, state: st.state } },
    el('b', {}, 'Draft ' + d.n), el('span.hint', {}, ' sent ' + fmtShort(new Date(d.sentAt).toLocaleDateString('en-CA'))),
    el('span.diss-dstate.' + st.state, {}, st.label),
    d.url ? el('a', { href: /^https:\/\//.test(d.url) ? d.url : undefined, target: '_blank', rel: 'noopener noreferrer' }, 'Open the draft ↗') : '',
    task ? el('button.link-btn', { type: 'button', onclick: open }, 'Comments and feedback') : '',
    mine ? el('span.diss-decide', {},
      el('button.btn.small.primary', { type: 'button', dataset: { decide: 'approve' }, onclick: () => decideDialog(kit, c, d, task, true) }, 'Approve'),
      el('button.btn.small', { type: 'button', dataset: { decide: 'changes' }, onclick: () => decideDialog(kit, c, d, task, false) }, 'Ask for changes')) : '');
}
const todayISO = () => new Date().toLocaleDateString('en-CA');
const plusDays = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA');
/** Find a task on the board model by id: { task, cat, week } or null. */
function findInModel(model, id) {
  for (const p of model.db) for (const c of p.categories) for (const w of model.weeksData) { const t = (c[w.key] || []).find(x => x.id === id); if (t) return { task: t, cat: c, week: w, person: p }; }
  return null;
}
/** Send a chapter draft: a review task in the supervisor's row (due in two weeks), with the file and a note. */
function sendDraftDialog(kit, list, i, sups, commit) {
  const c = list[i]; const n = (c.drafts.length ? Math.max(...c.drafts.map(d => d.n)) : 0) + 1;
  const m = modal('Send “' + c.name + '”, draft ' + n, { narrow: true });
  const who = el('select.inp', { 'aria-label': 'Supervisor' }, sups.map(x => el('option', { value: x.uid }, x.name || x.email)));
  const url = el('input.inp', { type: 'url', placeholder: 'https://… share link from OneDrive, Google Drive or SharePoint', 'aria-label': 'Link to the draft' });
  const due = el('input.inp', { type: 'date', value: plusDays(14), 'aria-label': 'Feedback by' });
  const note = el('textarea.inp', { rows: 3, maxlength: 2000, placeholder: 'Anything you’d like them to focus on? (optional)', 'aria-label': 'Note to your supervisor' });
  m.body.append(
    sups.length > 1 ? el('label.field', {}, el('span', {}, 'Send to'), who) : el('p', { style: { marginTop: 0 } }, 'To ', el('b', {}, sups[0].name || sups[0].email), '.'),
    el('label.field', {}, el('span', {}, 'Link to the draft'), url, el('span.hint', {}, 'Share the file with your supervisor in OneDrive or Google Drive first, then paste its link.')),
    el('label.field', {}, el('span', {}, 'Feedback by'), due),
    el('label.field', {}, el('span', {}, 'Note'), note),
    el('p.hint', {}, 'Your supervisor gets a review task with your note. They approve it or ask for changes, and their feedback appears here and on the task.'));
  const go = el('button.btn.primary', { type: 'button', id: 'diss-send', onclick: async () => {
    const link = url.value.trim() ? cleanUrl(url.value.trim()) : '';
    if (url.value.trim() && !link) { toast('Paste a full link starting with https://'); return; }
    go.disabled = true;
    try {
      const supUid = sups.length > 1 ? who.value : sups[0].uid;
      const model = window.boardGetModel(); const sup = model.db.find(p => p.id === supUid && !p.former);
      if (!sup) throw new Error('Your supervisor doesn’t have a row on the board yet. Ask them to open the team once.');
      if (window.TT && window.TT.canEditOwner && !window.TT.canEditOwner(sup.id)) throw new Error('Your role can’t add tasks to your supervisor’s row.');
      let cat = sup.categories[0];
      if (!cat) { cat = window.newCategory('Reviews'); model.weeksData.forEach(w => { cat[w.key] = []; }); sup.categories.push(cat); }
      const t0 = todayISO();
      const wk = model.weeksData.find(w => w.startDate && w.key !== 'backlog' && window.daysBetweenISO(w.startDate, t0) >= 0 && window.daysBetweenISO(w.startDate, t0) <= 6)
        || model.weeksData.filter(w => w.key !== 'backlog').slice(-1)[0] || model.weeksData[0];
      if (!wk) throw new Error('Add a week to the board first.');
      const me = kit.me(); const id = window.generateId();
      const info = link ? linkInfo(link) : null;
      cat[wk.key] = cat[wk.key] || [];
      cat[wk.key].push({ id, type: 'task', name: ('Review: ' + c.name + ', draft ' + n).slice(0, 500), priority: 'Major', status: '', jiraId: '',
        supportPersonId: me.uid, supportPersonId2: null, flag: 'none', dueDate: due.value || plusDays(14), completedDate: '',
        subtasks: ['Read the draft', 'Leave comments on this task', 'Approve it or ask for changes'].map(title => ({ id: window.generateId(), title, completed: false })),
        history: [{ time: window.getTimestamp(), user: me.name, field: 'Created', original: '', updated: 'Draft sent for review' }], custom: {}, icon: '📝',
        attachments: link ? [{ id: newId('a'), provider: (info && info.provider) || 'link', name: c.name + ', draft ' + n, url: link, size: 0, addedBy: me.name, addedAt: Date.now() }] : [] });
      window.boardApplyModel(model); window.boardCommit('draft-' + Date.now());
      c.drafts.push({ n, taskId: id, url: link, sentAt: Date.now() }); c.status = 'supervisor';
      await commit();
      if (note.value.trim()) await kit.write([{ type: 'set', path: 'comments/' + newId('cm'), data: { taskId: id, authorUid: me.uid, authorName: (me.name || '').slice(0, 80), text: note.value.trim().slice(0, 2000), mentions: [supUid], createdAt: Date.now() } }]);
      m.close(); toast('Draft ' + n + ' of ' + c.name + ' sent for feedback.');
    } catch (e) { toast(e.message || String(e), 6000); go.disabled = false; }
  } }, 'Send for feedback');
  m.foot.append(el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Cancel'), el('span.spacer'), go);
}
/** The supervisor's decision: approve, or ask for changes, with feedback that becomes a comment on the review task. */
function decideDialog(kit, c, d, task, approve) {
  const m = modal((approve ? 'Approve ' : 'Ask for changes: ') + c.name + ', draft ' + d.n, { narrow: true });
  const fb = el('textarea.inp', { rows: 5, maxlength: 2000, placeholder: approve ? 'Anything to add? (optional)' : 'What should change? Be as specific as you can.', 'aria-label': 'Feedback' });
  m.body.append(el('label.field', {}, el('span', {}, 'Feedback'), fb));
  const go = el('button.btn.primary', { type: 'button', id: 'diss-decide-go', onclick: async () => {
    if (!approve && !fb.value.trim()) { toast('Say what should change, so the student knows what to do.'); return; }
    go.disabled = true;
    const model = window.boardGetModel(); const hit = findInModel(model, task.id);
    if (!hit) { toast('That review task isn’t on the board any more.'); go.disabled = false; return; }
    const me = kit.me();
    Object.assign(hit.task, { status: approve ? 'Approved' : 'Changes needed', flag: 'completed', completedDate: todayISO() });
    (hit.task.subtasks || []).forEach(x => { x.completed = true; });
    hit.task.history = [{ time: window.getTimestamp(), user: me.name, field: 'Review', original: '', updated: approve ? 'Approved' : 'Changes needed' }, ...(hit.task.history || [])].slice(0, 100);   // newest first, like every task's history
    window.boardApplyModel(model); window.boardCommit('review-' + Date.now());
    const student = task.supportPersonId;
    const text = (approve ? '✅ Approved.' : '✏️ Changes needed.') + (fb.value.trim() ? ' ' + fb.value.trim() : '');
    await kit.write([{ type: 'set', path: 'comments/' + newId('cm'), data: { taskId: task.id, authorUid: me.uid, authorName: (me.name || '').slice(0, 80), text: text.slice(0, 2000), mentions: student ? [student] : [], createdAt: Date.now() } }]);
    m.close(); toast(approve ? 'Approved. The student will see it straight away.' : 'Sent back with your feedback.');
  } }, approve ? 'Approve' : 'Send feedback');
  m.foot.append(el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Cancel'), el('span.spacer'), go);
}

// ── Proposal helper ─────────────────────────────────────────────────────────
const PROMPTS = {
  topic: ['Topic', 'What is it about, in one sentence?', 2],
  why: ['Why it matters', 'Who would care about the answer, and why? One short paragraph.', 4],
  gap: ['The gap', 'What don’t we know yet? Name the two or three sources that come closest, and what they leave open.', 5],
  question: ['Research question', 'The one question your dissertation answers.', 2],
  aims: ['Aim and objectives', 'One aim, then 3–5 objectives, one per line, each starting with a verb (identify, compare, design, test, evaluate…).', 6],
  methods: ['Methods', 'How will you answer it? What data, from whom or where, with what tools, analysed how?', 6],
  ethics: ['Ethics and risks', 'People, personal data, safety or other risks, and what you’ll do about them.', 4],
  sources: ['Key sources', 'The main books and papers you’ll build on, one per line.', 5],
  notes: ['Notes', 'Anything else: questions for your supervisor, ideas to try, things to drop.', 3],
};
const VERBS = /^(identify|compare|design|develop|test|evaluate|analyse|analyze|assess|examine|explore|investigate|measure|build|review|determine|establish|model|map|propose|describe|explain|implement|validate|quantify|critically)/i;
/** Gentle checks on the research question and objectives: hints, never a grade. */
export function proposalChecks(p) {
  const q = (p.question || '').trim(); const words = q ? q.split(/\s+/).length : 0;
  const objectives = (p.aims || '').split('\n').map(s => s.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
  return {
    question: q ? [
      [q.endsWith('?'), 'It’s written as a question'],
      [!/[.?!].+[?]/.test(q.slice(0, -1)), 'It’s one question, not several'],
      [words >= 8 && words <= 30, 'It’s focused (8–30 words; yours has ' + words + ')'],
      [!/^(is|are|does|do|can|will|should|was|were|has|have)\b/i.test(q), 'It can’t be answered with just yes or no'],
    ] : [],
    aims: objectives.length ? [
      [objectives.length >= 3 && objectives.length <= 6, '3–6 objectives (you have ' + objectives.length + ')'],
      [objectives.slice(1).every(o => VERBS.test(o)) || objectives.every(o => VERBS.test(o)), 'Each objective starts with an action verb'],
    ] : [],
  };
}
function proposal(body, { kit, S, D, edit, save }) {
  const p = { ...D.proposal };
  const fields = DISS_PROPOSAL.map(k => {
    const [label, prompt, rows] = PROMPTS[k];
    const ta = el('textarea.inp', { rows, maxlength: 4000, disabled: !edit, placeholder: prompt, 'aria-label': label, dataset: { prop: k } });
    ta.value = p[k] || '';
    const checksBox = el('ul.diss-checks-live');
    const drawChecks = () => { const c = proposalChecks({ ...p, [k]: ta.value })[k]; checksBox.replaceChildren(...(c || []).map(([ok, text]) => el('li' + (ok ? '.ok' : ''), {}, (ok ? '✓ ' : '○ ') + text))); };
    if (k === 'question' || k === 'aims') { ta.addEventListener('input', drawChecks); drawChecks(); }
    ta.addEventListener('change', () => { p[k] = ta.value; save({ proposal: p }); });
    const extra = k === 'sources' && edit && (S.papers || []).length ? el('button.btn.small.ghost', { type: 'button', onclick: () => {
      const have = new Set(ta.value.split('\n').map(s => s.trim()));
      const lines = (S.papers || []).map(x => [x.authors && x.authors.split(/[,;]| and /)[0].trim(), x.year ? '(' + x.year + ')' : '', x.title].filter(Boolean).join(' ')).filter(l => !have.has(l));
      ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + lines.join('\n'); p.sources = ta.value; save({ proposal: p }, lines.length + ' from your Literature list.');
    } }, '＋ Add from my Literature list') : '';
    return el('label.field.diss-prop', {}, el('span', {}, label), el('span.hint', {}, prompt), ta, checksBox, extra);
  });
  const outline = () => {
    const plan = (kit.S().tasks || []).filter(t => t.icon === '🚩' && t.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(t => '- ' + t.name + ': ' + fmt(t.dueDate));
    const sec = (title, text) => (text && text.trim() ? '## ' + title + '\n' + text.trim() + '\n' : '');
    return ['# ' + (p.topic || 'Dissertation proposal').trim(), '', sec('Rationale', p.why), sec('Gap in the literature', p.gap), sec('Research question', p.question), sec('Aim and objectives', p.aims),
      sec('Methodology', p.methods), sec('Ethics and risks', p.ethics), plan.length ? '## Timeline\n' + plan.join('\n') + '\n' : '', sec('Key sources', p.sources)].filter(Boolean).join('\n');
  };
  body.append(
    el('div.diss-prop-intro', {},
      el('p', {}, 'A proposal answers the same few questions in every subject. Work through them here in your own words; the checks are hints, not marks. When you’re ready, copy the outline into your university’s proposal form or template.'),
      el('div.row', {},
        el('button.btn.small', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(outline()); toast('Outline copied. Paste it into your proposal document.'); } catch { toast('Couldn’t copy. Select the outline below and copy it instead.'); } } }, 'Copy the outline'),
        el('button.btn.small.ghost', { type: 'button', onclick: () => { showOutline = !showOutline; kit.render(); } }, showOutline ? 'Hide the outline' : 'Show the outline')),
      showOutline ? el('pre.diss-outline', {}, outline()) : ''),
    el('div.diss-prop-fields', {}, fields));
}

// ── Checklists ──────────────────────────────────────────────────────────────
const LISTS = {
  ethics: ['Ethics', [['eth_guidance', 'Read your department’s ethics guidance'], ['eth_info', 'Participant information sheet'], ['eth_consent', 'Consent form'], ['eth_data', 'Data management plan: where data is kept, for how long, and who sees it'], ['eth_risk', 'Risk assessment'], ['eth_submit', 'Application submitted'], ['eth_approved', 'Approval letter saved with your files']]],
  submit: ['Before you hand in', [['sub_guidelines', 'Read your department’s submission guidelines'], ['sub_words', 'Word count within the limit (check what counts)'], ['sub_front', 'Title page, abstract, declaration and acknowledgements'], ['sub_contents', 'Contents, lists of figures and tables, appendices'], ['sub_refs', 'Every citation is in the reference list, in one referencing style'], ['sub_figs', 'Figures and tables numbered and captioned'], ['sub_proof', 'Proofread from start to finish'], ['sub_similarity', 'Similarity check (for example Turnitin), if your university asks'], ['sub_format', 'Margins, fonts and page numbers as required'], ['sub_backup', 'Backed up in two places'], ['sub_upload', 'Uploaded (or printed and bound) and the receipt kept']]],
  viva: ['Viva or presentation', [['viva_reread', 'Re-read it and note any typos'], ['viva_summary', 'A one-page summary of each chapter'], ['viva_contrib', 'Say your contribution in two minutes'], ['viva_questions', 'List likely questions and your answers'], ['viva_mock', 'A mock viva or practice run'], ['viva_recent', 'Check for new papers since you submitted'], ['viva_logistics', 'Date, room or link, and what to bring']]],
};
function checks(body, { D, edit, save }) {
  const ticked = { ...D.checks };
  const lists = [D.kind === 'people' ? 'ethics' : '', 'submit', (D.level === 'phd' || D.dates.viva) ? 'viva' : ''].filter(Boolean);
  lists.forEach(k => {
    const [title, items] = LISTS[k];
    const n = items.filter(([id]) => ticked[id]).length;
    body.append(el('h4', {}, title + ' ', el('span.hint', {}, n + ' of ' + items.length)),
      el('ul.diss-checklist', {}, items.map(([id, text]) => el('li', {}, el('label', {}, el('input', { type: 'checkbox', checked: !!ticked[id], disabled: !edit, dataset: { check: id }, onchange: (e) => { if (e.target.checked) ticked[id] = true; else delete ticked[id]; save({ checks: ticked }); } }), ' ', text)))));
  });
}

// ── Supervisor ──────────────────────────────────────────────────────────────
export const SUPERVISOR_MEETING = 'Progress since last time\n- \n\nQuestions for my supervisor\n- \n\nFeedback\n- \n\nAgreed next steps (lines like “- [ ] Send chapter 2 by 2026-11-20” become action items)\n- [ ] \n\nNext meeting: ';
function supervisor(body, { kit, S }) {
  const sups = (S.members || []).filter(m => m.roleId === 'supervisor');
  const meetings = (S.meetings || []).filter(x => /supervis/i.test(x.title)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const newMeeting = async () => {
    const id = newId('mt'); const me = kit.me();
    const data = { title: 'Supervisor meeting', date: kit.today(), attendees: [me.uid, ...sups.map(m => m.uid)].slice(0, 50), notes: SUPERVISOR_MEETING, actions: [],
      createdBy: me.uid, createdByName: (me.name || '').slice(0, 80), createdAt: Date.now(), updatedAt: Date.now(), updatedByName: (me.name || '').slice(0, 80) };
    if (await kit.write([{ type: 'set', path: 'meetings/' + id, data }])) { kit.R.tab = 'meetings'; kit.R.sel = id; kit.render(); }
  };
  body.append(
    el('p.hint', {}, 'Your supervisor sees your plan, chapters and progress and can comment on tasks, but can’t change anything. You can give them tasks too, like “Read chapter 2”.'),
    el('div.diss-sups', {}, sups.length ? sups.map(m => el('span.pill', {}, '👤 ' + (m.name || m.email))) : el('span.hint', {}, 'No supervisor has joined yet.'),
      kit.perm('members.manage') ? el('button.btn.small', { type: 'button', onclick: () => { kit.R.m.close(); window.TT.openSettings('members'); } }, sups.length ? 'Members' : 'Invite your supervisor') : ''),
    el('h4', {}, 'Meetings'),
    el('p.hint', {}, 'Before each meeting, note your progress and questions; afterwards, the agreed next steps become tasks with dates.'),
    kit.canEdit() ? el('button.btn.primary.small', { type: 'button', id: 'diss-new-meeting', onclick: newMeeting }, '＋ New supervisor meeting') : '',
    meetings.length ? el('ul.diss-ms', {}, meetings.slice(0, 8).map(x => el('li', {}, el('button.link-btn', { type: 'button', onclick: () => { kit.R.tab = 'meetings'; kit.R.sel = x.id; kit.render(); } }, x.title + ' · ' + kit.fmtDate(x.date)), x.actions.length ? ' · ' + x.actions.length + ' action' + (x.actions.length === 1 ? '' : 's') : ''))) : el('p.hint', {}, 'No supervisor meetings yet.'));
}
