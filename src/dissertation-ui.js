// ─────────────────────────────────────────────────────────────────────────────
//  Dissertation or thesis: the setup (level, dates, kind of research, chapters,
//  supervisor) and applying the plan to the team's board. The Dissertation tab
//  in 🧰 Tools is in dissertation-tab.js.
// ─────────────────────────────────────────────────────────────────────────────
import { el, modal, toast } from './ui.js';
import { LEVELS, KINDS, defaultChapters, buildDissertationPlan, isISO } from './dissertation.js';
import { cleanDissertation, cleanAutos, newId } from './model.js';
import { isValidEmail, normEmail } from './permissions.js';

const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const addMonths = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setMonth(d.getMonth() + n); return d.toLocaleDateString('en-CA'); };
const fmt = (iso) => (isISO(iso) ? new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** The Supervisor role: sees everything, comments, can be given tasks (for example "Read chapter 2"), can't change the plan. */
export const SUPERVISOR_ROLE = { name: 'Supervisor', builtin: false, order: 3, perms: { 'tasks.editOwn': true, 'analytics.view': true } };

/**
 * The setup form. Fills in from the team's saved dissertation record (to change the plan later)
 * or sensible defaults. `onDone(plan)` runs after the plan is applied.
 */
export function openDissertationSetup(ctx, { onDone } = {}) {
  const TT = ctx.TT; const saved = (TT.team && TT.team.dissertation) || {};
  const st = {
    level: saved.level || 'ug', kind: saved.kind || 'people',
    start: saved.start || todayISO(), handIn: saved.handIn || '',
    dates: { ...(saved.dates || {}) },
    chapters: (saved.chapters && saved.chapters.length ? saved.chapters : defaultChapters(saved.level || 'ug', saved.kind || 'people')).map(c => ({ ...c })),
    chaptersTouched: !!(saved.chapters && saved.chapters.length), supervisor: '',
  };
  if (!st.handIn) st.handIn = addMonths(st.start, LEVELS[st.level].months);
  const again = !!saved.setupAt;
  const m = modal(again ? 'Change your dissertation plan' : 'Plan your dissertation');
  m.box.classList.add('diss-setup');
  const preview = el('div.diss-preview', { 'aria-live': 'polite' });
  const body = el('div.diss-form');
  m.body.replaceChildren(
    el('p.hint', { style: { marginTop: 0 } }, 'Tell us your hand-in date and we’ll lay out the whole thing week by week: phases on the Gantt, tasks with checklists, and the milestones that matter. Everything can be changed afterwards. Trawpie helps you plan and keep going; the writing is all yours.'),
    body, preview);

  const radioCards = (name, items, value, onPick) => el('div.diss-cards', { role: 'radiogroup', 'aria-label': name },
    ...items.map(([k, title, help]) => el('button.diss-card' + (value === k ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(value === k), dataset: { [name]: k }, onclick: () => onPick(k) },
      el('b', {}, title), help ? el('span.hint', {}, help) : '')));
  const dateField = (label, key, hint) => {
    const inp = el('input.inp', { type: 'date', value: st.dates[key] || '', 'aria-label': label });
    inp.addEventListener('change', () => { if (isISO(inp.value)) st.dates[key] = inp.value; else delete st.dates[key]; drawPreview(); });
    return el('label.field.diss-date', {}, el('span', {}, label), inp, hint ? el('span.hint', {}, hint) : '');
  };

  // Redrawing removes the focused field, which can fire its change event again (blur): never redraw inside a redraw.
  let drawing = false;
  function draw() { if (drawing) return; drawing = true; try { drawForm(); } finally { drawing = false; } }
  function drawForm() {
    const L = st.level;
    const start = el('input.inp', { type: 'date', value: st.start, required: true, 'aria-label': 'Start date' });
    const hand = el('input.inp', { type: 'date', value: st.handIn, required: true, 'aria-label': 'Hand-in date' });
    start.addEventListener('change', () => { if (isISO(start.value)) { st.start = start.value; drawPreview(); } });
    hand.addEventListener('change', () => { if (isISO(hand.value)) { st.handIn = hand.value; drawPreview(); } });
    const total = el('input.inp', { type: 'number', min: 1000, max: 200000, step: 500, value: st.chapters.reduce((s, c) => s + (c.target || 0), 0), 'aria-label': 'Total word count' });
    total.addEventListener('change', () => {
      const want = Math.max(1000, Math.min(200000, Number(total.value) || 0)); const now = st.chapters.reduce((s, c) => s + (c.target || 0), 0) || 1;
      st.chapters.forEach(c => { c.target = Math.round((c.target || 0) * want / now / 100) * 100; }); st.chaptersTouched = true; draw();
    });
    const chList = el('div.diss-chapters', {}, ...st.chapters.map((c, i) => {
      const name = el('input.inp', { value: c.name, maxlength: 80, 'aria-label': 'Chapter ' + (i + 1) + ' name' });
      const words = el('input.inp.diss-words', { type: 'number', min: 0, max: 500000, step: 100, value: c.target, 'aria-label': 'Chapter ' + (i + 1) + ' words' });
      name.addEventListener('input', () => { c.name = name.value; st.chaptersTouched = true; });
      words.addEventListener('change', () => { c.target = Math.max(0, Number(words.value) || 0); st.chaptersTouched = true; draw(); });
      return el('div.diss-ch', {}, el('span.diss-ch-n', {}, String(i + 1)), name, words, el('span.hint', {}, 'words'),
        el('button.btn.small.ghost', { type: 'button', 'aria-label': 'Remove ' + c.name, title: 'Remove', onclick: () => { st.chapters.splice(i, 1); st.chaptersTouched = true; draw(); } }, '✕'));
    }));
    const sup = el('input.inp', { type: 'email', value: st.supervisor, placeholder: 'supervisor@university.ac.uk', 'aria-label': 'Supervisor’s email' });
    sup.addEventListener('input', () => { st.supervisor = sup.value.trim(); });
    body.replaceChildren(
      el('h4', {}, '1. What are you writing?'),
      radioCards('level', Object.values(LEVELS).map(x => [x.key, x.name, x.key === 'phd' ? 'Usually 3–4 years' : x.key === 'masters' ? 'Usually one summer, or a year part-time' : 'Usually your final year']), L, (k) => {
        const moveHandIn = !again && st.handIn === addMonths(st.start, LEVELS[st.level].months);
        st.level = k; if (moveHandIn) st.handIn = addMonths(st.start, LEVELS[k].months);
        if (!st.chaptersTouched) st.chapters = defaultChapters(k, st.kind);
        draw();
      }),
      el('h4', {}, '2. Dates'),
      el('div.diss-dates', {}, el('label.field.diss-date', {}, el('span', {}, 'Start'), start), el('label.field.diss-date', {}, el('span', {}, L === 'phd' ? 'Thesis submission' : 'Hand-in'), hand)),
      el('p.hint', {}, 'Your university’s own deadlines, if you know them (leave blank and we’ll suggest sensible dates):'),
      el('div.diss-dates', {},
        ...(L === 'phd'
          ? [dateField('Upgrade / confirmation review', 'upgrade', 'Usually 9–18 months in'), dateField('Full draft to supervisors', 'draft'), dateField('Viva', 'viva', 'Usually 2–3 months after submission'), st.kind === 'people' ? dateField('Ethics approval', 'ethics') : '']
          : [dateField('Proposal', 'proposal'), st.kind === 'people' ? dateField('Ethics approval', 'ethics') : '', dateField('Full draft to supervisor', 'draft'), dateField('Presentation or viva', 'viva', 'Only if you have one')])),
      el('h4', {}, '3. What kind of research?'),
      radioCards('kind', Object.values(KINDS).map(x => [x.key, x.name, x.help]), st.kind, (k) => { st.kind = k; if (!st.chaptersTouched) st.chapters = defaultChapters(st.level, k); draw(); }),
      el('h4', {}, '4. Chapters and word count'),
      el('div.diss-total', {}, el('label.field', {}, el('span', {}, 'Total words'), total), el('span.hint', {}, 'Change the total and the chapters scale with it. Rename, remove or add chapters to match your department’s structure.')),
      chList,
      st.chapters.length < 20 ? el('button.btn.small', { type: 'button', onclick: () => { st.chapters.push({ id: newId('ch'), name: 'New chapter', target: 1000, words: 0, status: 'todo' }); st.chaptersTouched = true; draw(); } }, '+ Add a chapter') : '',
      again ? '' : el('h4', {}, '5. Your supervisor (optional)'),
      again ? '' : el('label.field', {}, el('span', {}, 'Supervisor’s email'), sup, el('span.hint', {}, 'We’ll invite them as your Supervisor: they see your plan and progress and can comment, but can’t change anything. You can also do this later in Settings ▸ Members.')));
    drawPreview();
  }
  let plan = null;
  function drawPreview() {
    plan = buildDissertationPlan({ level: st.level, kind: st.kind, start: st.start, handIn: st.handIn, dates: st.dates, chapters: st.chapters });
    const s = plan.summary;
    preview.replaceChildren(
      el('div.diss-sum', {},
        el('span', {}, el('b', {}, String(s.weeks)), ' weeks on the board'), el('span', {}, el('b', {}, String(s.phases)), ' phases'),
        el('span', {}, el('b', {}, String(s.tasks)), ' tasks'), el('span', {}, el('b', {}, String(s.milestones)), ' milestones'),
        s.later ? el('span', {}, el('b', {}, String(s.later)), ' later tasks in the Backlog') : ''),
      el('div.hint', {}, (st.level === 'phd' ? 'Submission ' : 'Hand-in ') + fmt(plan.handIn) + ' · ' + plan.tasks.filter(t => t.milestone).map(t => t.name + ' ' + fmt(t.due)).slice(0, 4).join(' · ')),
      ...plan.warnings.map(w => el('div.banner.warn', {}, w)));
  }
  draw();
  const go = el('button.btn.primary', { type: 'button', onclick: async () => {
    if (!isISO(st.handIn) || st.handIn <= st.start) { toast('Choose a hand-in date after the start date.'); return; }
    if (st.supervisor && !isValidEmail(st.supervisor)) { toast('That supervisor email doesn’t look right.'); return; }
    go.disabled = true; go.textContent = 'Making your plan…';
    try {
      const n = await applyDissertationPlan(ctx, plan, { supervisor: st.supervisor, replace: !again });
      m.close(); toast('Your plan is ready: ' + n + ' tasks across ' + plan.summary.weeks + ' weeks.' + (st.supervisor ? ' ' + st.supervisor + ' is invited as your supervisor.' : ''), 7000);
      if (onDone) onDone(plan);
    } catch (e) { console.error(e); toast('Couldn’t make the plan: ' + (e.message || e), 6000); go.disabled = false; go.textContent = again ? 'Update my plan' : 'Make my plan'; }
  } }, again ? 'Update my plan' : 'Make my plan');
  m.foot.append(el('button.btn.ghost', { type: 'button', onclick: m.close }, again ? 'Cancel' : 'Skip for now'), el('span.spacer'), go);
  return m;
}

/**
 * Put the plan on the board: weeks, one row (category) per phase, the tasks with deadlines and checklists,
 * a Backlog for later tasks, phases on the Gantt, the dissertation record, auto carry-over and the Supervisor role.
 * `replace`: the team is new, so its empty starter week and row are reused.
 * Returns the number of tasks added.
 */
export async function applyDissertationPlan(ctx, plan, { supervisor = '', replace = true } = {}) {
  const TT = ctx.TT;
  if (!window.boardGetModel || !window.boardCommit) throw new Error('The board isn’t ready yet. Try again in a moment.');
  const model = window.boardGetModel();
  const me = model.db.find(p => p.id === TT.me.uid && !p.former);
  if (!me) throw new Error('You don’t have a row on this board.');
  const gid = () => window.generateId();
  const hasTasks = (w) => model.db.some(p => p.categories.some(c => (c[w.key] || []).length));
  // Weeks: reuse one with the same Monday; a new team's empty starter week makes way for the plan's numbering.
  if (replace) model.weeksData = model.weeksData.filter(w => w.key === 'backlog' || hasTasks(w) || plan.weeks.some(x => x.startDate === w.startDate));
  const weekFor = {};
  plan.weeks.forEach(w => {
    let wk = model.weeksData.find(x => x.startDate === w.startDate && x.key !== 'backlog');
    if (!wk) { wk = { key: 'wk_' + gid().slice(3), title: w.title, metric: '', collapsed: false, startDate: w.startDate }; model.weeksData.push(wk); }
    else if (replace) wk.title = w.title;
    weekFor[w.startDate] = wk;
  });
  model.weeksData.sort((a, b) => (a.key === 'backlog' ? -1 : b.key === 'backlog' ? 1 : String(a.startDate).localeCompare(String(b.startDate))));
  let backlog = model.weeksData.find(w => w.key === 'backlog');
  if (plan.summary.later && !backlog) { backlog = { key: 'backlog', title: 'Backlog', metric: '', collapsed: false, startDate: '' }; model.weeksData.unshift(backlog); }
  // One row per phase (a new team's empty starter row becomes the first).
  const rows = {};
  plan.phases.forEach((p, i) => {
    let cat = me.categories.find(c => c.name.toLowerCase() === p.name.toLowerCase());
    if (!cat && replace && i === 0) cat = me.categories.find(c => model.weeksData.every(w => !(c[w.key] || []).length));
    if (cat) cat.name = p.name; else { cat = window.newCategory(p.name); me.categories.push(cat); }
    rows[p.id] = cat;
  });
  model.db.forEach(p => p.categories.forEach(c => model.weeksData.forEach(w => { if (!Array.isArray(c[w.key])) c[w.key] = []; })));
  const mondayOf = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); };
  let added = 0;
  plan.tasks.forEach(t => {
    const wk = weekFor[mondayOf(t.due)] || backlog; if (!wk) return;
    const cat = rows[t.phaseId] || me.categories[0];
    cat[wk.key].push({
      id: gid(), type: 'task', name: t.name.slice(0, 500), priority: t.priority, status: '', jiraId: '',
      supportPersonId: null, supportPersonId2: null, flag: 'none', dueDate: t.due, completedDate: '', phaseId: t.phaseId,
      subtasks: t.subtasks.map(x => ({ id: gid(), title: x.slice(0, 300), completed: false })),
      history: [{ time: window.getTimestamp(), user: TT.me.name, field: 'Created', original: '', updated: 'Dissertation plan' }],
      custom: {}, icon: t.icon || '', attachments: [],
    });
    added++;
  });
  window.boardApplyModel(model); window.boardCommit('dissertation-' + Date.now());
  // The team record: phases on the Gantt, the dissertation itself, carry-over, and the Supervisor role.
  const T = TT.team;
  const autos = cleanAutos({ ...(T.autos || {}), carry: true, carryWarn: 2, carryMakeWeeks: plan.level === 'phd' || !!(T.autos && T.autos.carryMakeWeeks) });
  const prev = T.dissertation || {};
  const dissertation = cleanDissertation({ ...prev, level: plan.level, kind: plan.kind, start: plan.start, handIn: plan.handIn, dates: plan.dates || prev.dates || {},
    chapters: plan.chapters.map(c => { const old = (prev.chapters || []).find(x => x.id === c.id); return { ...c, words: old ? old.words : c.words || 0, status: old ? old.status : c.status || 'todo' }; }),
    setupAt: Date.now() });
  const data = { phases: plan.phases, dissertation, autos };
  if (!(T.roles || {}).supervisor) data.roles = { ...T.roles, supervisor: SUPERVISOR_ROLE };
  if (!(await ctx.writeOps([{ type: 'update', path: 'team', data }]))) throw new Error('Saving the plan didn’t work. Check your connection and try again.');
  // The invitation is a second write: the security rules check its role against the team as saved.
  const email = normEmail(supervisor || '');
  if (email && isValidEmail(email) && email !== normEmail(TT.me.email)) await ctx.writeOps([{ type: 'set', path: 'invites/' + email, data: { email, roleId: 'supervisor', teamName: T.name, invitedBy: TT.me.uid, invitedByName: TT.me.name, createdAt: Date.now() } }]);
  return added;
}
