// ─────────────────────────────────────────────────────────────────────────────
//  🧰 Tools ▸ 🎓 Dissertation: overview (countdown, phases, next milestone), chapters and
//  word counts, the proposal helper, checklists, and supervisor meetings.
//  Everything here is the student's own words: Trawpie lays out, checks and reminds.
// ─────────────────────────────────────────────────────────────────────────────
import { el, toast } from './ui.js';
import { cleanDissertation, newId, DISS_PROPOSAL } from './model.js';
import { LEVELS, KINDS, CHAPTER_STATUS, daysLeft, isISO } from './dissertation.js';

let view = 'overview'; let shownFor = null;   // the sub-view; a freshly opened Tools window starts on the overview
let showOutline = false;
const VIEWS = [['overview', 'Overview'], ['chapters', 'Chapters'], ['proposal', 'Proposal'], ['checks', 'Checklists'], ['supervisor', 'Supervisor']];
const fmt = (iso) => (isISO(iso) ? new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round(100 * a / b))) : 0);
const bar = (p, label) => el('div.diss-bar', { role: 'progressbar', 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label }, el('span', { style: { width: p + '%' } }));

/** Draw the tab into `pane`. `kit` is the Tools kit (research.js); `openSetup()` opens the plan setup. */
export function dissertationPane(pane, kit, openSetup) {
  if (shownFor !== kit.R) { shownFor = kit.R; view = 'overview'; showOutline = false; }
  const S = kit.S(); const T = S.team; const D = T.dissertation;
  const edit = kit.perm('team.settings');
  if (!D || !D.setupAt) {
    pane.append(el('div.empty-state.diss-empty', {},
      el('h3', {}, 'Plan your dissertation'),
      el('p', {}, 'Tell us your hand-in date and we’ll lay out the whole thing week by week: phases on the Gantt, tasks with checklists, chapters with word targets, and the milestones that matter. Works for undergraduate, master’s and PhD.'),
      edit ? el('button.btn.primary', { type: 'button', id: 'diss-setup', onclick: openSetup }, 'Set up my plan') : el('p.hint', {}, 'The owner of this workspace hasn’t set up the plan yet.')));
    return;
  }
  const save = async (patch, msg) => { const cur = kit.S().team.dissertation || {}; const ok = await kit.write([{ type: 'update', path: 'team', data: { dissertation: cleanDissertation({ ...cur, ...patch }) } }]); if (ok && msg) toast(msg); return ok; };
  const nav = el('div.diss-nav', { role: 'tablist', 'aria-label': 'Dissertation' }, VIEWS.map(([k, label]) => el('button' + (view === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(view === k), dataset: { dview: k }, onclick: () => { view = k; kit.render(); } }, label)));
  const body = el('div.diss-body');
  pane.append(nav, body);
  ({ overview, chapters, proposal, checks, supervisor })[view](body, { kit, S, T, D, edit, save, openSetup });
}

// ── Overview ────────────────────────────────────────────────────────────────
function overview(body, { kit, S, T, D, edit, openSetup }) {
  const left = daysLeft(D.handIn);
  const tasks = (S.tasks || []).filter(t => !t.ghost);
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
        overdue ? el('div.diss-warn', {}, overdue + (overdue === 1 ? ' planned task is' : ' planned tasks are') + ' past their date. Carry-over moves them into this week; re-plan if they keep slipping.') : ''),
      el('div.diss-hero-act', {},
        edit ? el('button.btn.small', { type: 'button', onclick: openSetup }, 'Change the plan') : '',
        el('button.btn.small', { type: 'button', onclick: () => { kit.R.m.close(); if (window.openAnalytics) window.openAnalytics('timeline'); } }, 'See the timeline'))),
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

// ── Chapters and word counts ────────────────────────────────────────────────
function chapters(body, { D, edit, save }) {
  const list = D.chapters.map(c => ({ ...c }));
  const commit = (msg) => save({ chapters: list }, msg);
  const total = list.reduce((s, c) => s + c.words, 0), target = list.reduce((s, c) => s + c.target, 0);
  body.append(
    el('p.hint', {}, 'Update your word counts as you write. A rough number is fine: it’s about seeing where you are, not counting every word.'),
    el('div.diss-ch-table', {},
      el('div.diss-ch-row.head', {}, el('span', {}, 'Chapter'), el('span', {}, 'Status'), el('span', {}, 'Words'), el('span', {}, 'Target'), el('span', {}, '')),
      ...list.map((c, i) => {
        const status = el('select', { disabled: !edit, 'aria-label': c.name + ' status', onchange: (e) => { list[i].status = e.target.value; commit(); } }, CHAPTER_STATUS.map(([k, label]) => el('option', { value: k, selected: c.status === k }, label)));
        const words = el('input.inp', { type: 'number', min: 0, max: 500000, step: 50, value: c.words, disabled: !edit, 'aria-label': c.name + ' words written', dataset: { ch: c.id }, onchange: (e) => { list[i].words = Math.max(0, Number(e.target.value) || 0); commit(); } });
        return el('div.diss-ch-row' + (c.status === 'final' ? '.final' : ''), {}, el('span.diss-ch-name', {}, c.name), status, words, el('span.diss-ch-target', {}, c.target.toLocaleString()), bar(pct(c.words, c.target), c.name));
      }),
      el('div.diss-ch-row.total', {}, el('b', {}, 'Total'), el('span', {}, ''), el('b', {}, total.toLocaleString()), el('b', {}, target.toLocaleString()), bar(pct(total, target), 'Total'))),
    edit ? el('p.hint', {}, 'To rename, add or remove chapters, or change the targets: Overview ▸ Change the plan.') : '');
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
