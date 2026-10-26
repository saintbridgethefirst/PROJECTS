// ─────────────────────────────────────────────────────────────────────────────
//  Demo only: "See a sample dissertation". An undergraduate dissertation five weeks in,
//  made from the real planner (src/dissertation.js) and set to this week: the proposal is
//  in, the reading has started, one task has slipped, and a literature review draft is
//  with the (made-up) supervisor, who has started commenting. Loaded only on request.
// ─────────────────────────────────────────────────────────────────────────────
import { buildDissertationPlan, defaultChapters, SUPERVISOR_ROLE } from './dissertation.js';
import { DEFAULT_ROLES } from './permissions.js';
import { DEFAULT_LABELS, startFeatures, cleanDissertation, histTime } from './model.js';

const DAY = 864e5;
const iso = (ms) => new Date(ms).toLocaleDateString('en-CA');
const mondayNoon = (ms) => { const d = new Date(ms); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const SUP = { uid: 'u_sample_supervisor', email: 'g.okafor@uni.example', name: 'Dr Grace Okafor' };

/** The sample, as a demo store team. Returns { teamId, team, users } (see backend demo loadSample). */
export function buildSampleDissertation(user, now = Date.now()) {
  const mon = mondayNoon(now);
  const start = iso(mon - 35 * DAY);                 // five weeks in
  const handIn = iso(mon - 35 * DAY + 214 * DAY);    // a Friday, about seven months after the start
  const today = iso(now);
  const plan = buildDissertationPlan({ level: 'ug', kind: 'people', start, handIn });
  const me = user.uid, myName = user.name || 'You';
  const ago = (days, hours = 0) => now - days * DAY - hours * 36e5;

  const weeks = plan.weeks.map((w, i) => ({ key: 'wk_d' + (i + 1), title: w.title, metric: '', collapsed: false, startDate: w.startDate }));
  const weekOf = (d) => { const m = iso(mondayNoon(new Date(d + 'T12:00:00').getTime())); const w = weeks.find(x => x.startDate === m); return w ? w.key : weeks[weeks.length - 1].key; };
  const thisWeek = weekOf(today);

  const categories = {};
  plan.phases.forEach((p, i) => { categories['c_d_' + p.id] = { name: p.name, ownerUid: me, order: i }; });
  categories.c_d_reviews = { name: 'Reviews', ownerUid: SUP.uid, order: 0 };

  // Tasks: everything due before this week is done, except the last ordinary task before today (it slipped).
  const tasks = {};
  const sorted = plan.tasks.slice().sort((a, b) => a.due.localeCompare(b.due));
  const slipped = sorted.filter(t => t.due < iso(mon) && !t.milestone).slice(-1)[0];
  sorted.forEach((t, i) => {
    const id = 't_d' + (i + 1);
    const done = t.due < iso(mon) && t !== slipped;
    const half = !done && (t === slipped || t.due < iso(mon + 7 * DAY));
    tasks[id] = {
      name: t.name, priority: t.priority, status: '', jiraId: '', supportPersonId: null, supportPersonId2: null,
      flag: done ? 'completed' : 'none', dueDate: t.due, startDate: '', completedDate: done ? t.due : '', phaseId: t.phaseId,
      subtasks: t.subtasks.map((title, k) => ({ id: id + '_s' + k, title, completed: done || (half && k < Math.ceil(t.subtasks.length / 2)) })),
      history: [{ time: histTime(ago(36)), user: myName, field: 'Created', original: '', updated: 'Dissertation plan' }]
        .concat(done ? [{ time: histTime(new Date(t.due + 'T17:00:00').getTime()), user: myName, field: 'Task Status Flag', original: 'none', updated: 'completed' }] : []),
      custom: {}, icon: t.icon || '', attachments: [], checks: {}, signoff: null,
      categoryId: 'c_d_' + t.phaseId, ownerUid: me, weekId: weekOf(t.due), order: i,
      createdBy: me, createdAt: ago(36), updatedBy: myName, updatedAt: done ? new Date(t.due + 'T17:00:00').getTime() : ago(36),
    };
  });
  const byName = (n) => Object.keys(tasks).find(k => tasks[k].name === n);

  // The literature review draft, with the supervisor: a review task in her row.
  const draftUrl = 'https://1drv.ms/w/s!sample-literature-review-draft-1';
  tasks.t_d_review1 = {
    name: 'Review: Literature review, draft 1', priority: 'Major', status: '', jiraId: '', supportPersonId: me, supportPersonId2: null,
    flag: 'none', dueDate: iso(ago(3) + 14 * DAY), startDate: '', completedDate: '', phaseId: '',
    subtasks: ['Read the draft', 'Leave comments on this task', 'Approve it or ask for changes'].map((title, k) => ({ id: 'rv_s' + k, title, completed: k === 0 })),
    history: [{ time: histTime(ago(3)), user: myName, field: 'Created', original: '', updated: 'Draft sent for review' }],
    custom: {}, icon: '📝', checks: {}, signoff: null,
    attachments: [{ id: 'a_draft1', provider: 'onedrive', name: 'Literature review, draft 1', url: draftUrl, size: 0, addedBy: myName, addedAt: ago(3) }],
    categoryId: 'c_d_reviews', ownerUid: SUP.uid, weekId: thisWeek, order: 0, createdBy: me, createdAt: ago(3), updatedBy: SUP.name, updatedAt: ago(1),
  };

  const comments = {
    cm_d1: { taskId: 't_d_review1', authorUid: me, authorName: myName, text: 'Here’s my first go at the literature review. Mostly the structure, please: does grouping the studies by theme work?', mentions: [SUP.uid], createdAt: ago(3) },
    cm_d2: { taskId: 't_d_review1', authorUid: SUP.uid, authorName: SUP.name, text: 'Halfway through. Grouping by theme works well. The planning fallacy section is the strongest; the one on team roles needs two or three more recent studies. Full comments by Friday.', mentions: [me], createdAt: ago(1) },
  };
  const slippedId = slipped && byName(slipped.name);
  if (slippedId) comments.cm_d3 = { taskId: slippedId, authorUid: me, authorName: myName, text: 'Library access to two of the journals only came through on Monday. Finishing this week.', mentions: [], createdAt: ago(2) };

  const proposalTask = byName('Write the proposal');
  const meetingDate = iso(ago(15));
  const meetings = {
    mt_d1: {
      title: 'Supervisor meeting', date: meetingDate, attendees: [me, SUP.uid],
      notes: 'Progress since last time\n- Topic narrowed to how first-year engineering teams plan group projects\n- Proposal drafted\n\nQuestions for my supervisor\n- Is a survey plus six interviews enough?\n- Do I need ethics approval for interviews with students?\n\nFeedback\n- Survey plus interviews is plenty for 10,000 words\n- Yes: apply for ethics approval as soon as the proposal is in\n\nAgreed next steps\n- [x] Send the final proposal\n- [ ] Start the ethics application\n- [ ] Draft the literature review by week 6\n\nNext meeting: in three weeks',
      actions: [
        { id: 'a1', text: 'Send the final proposal', ownerUid: me, dueDate: iso(ago(10)), taskId: proposalTask || '' },
        { id: 'a2', text: 'Start the ethics application', ownerUid: me, dueDate: iso(ago(-6)), taskId: byName('Prepare the ethics application') || '' },
        { id: 'a3', text: 'Draft the literature review by week 6', ownerUid: me, dueDate: iso(ago(3)), taskId: '' },
      ],
      createdBy: me, createdByName: myName, createdAt: ago(15), updatedAt: ago(15), updatedByName: myName,
    },
  };

  // A reading list: real, well-known papers for this topic.
  const litTask = byName('Read and take notes on the key sources');
  const paper = (title, authors, year, venue, doi, status, notes, tags) => ({ title, authors, year, venue, doi, url: '', notes, tags, status, taskIds: litTask ? [litTask] : [], addedBy: me, addedByName: myName, createdAt: ago(25), updatedAt: ago(5) });
  const papers = {
    p_d1: paper('Exploring the “planning fallacy”: Why people underestimate their task completion times', 'Buehler, Griffin, Ross', 1994, 'Journal of Personality and Social Psychology', '10.1037/0022-3514.67.3.366', 'read', 'People plan from the best case and ignore how long similar tasks took before. Key for my chapter 2.', ['planning']),
    p_d2: paper('The nature of procrastination: A meta-analytic and theoretical review of quintessential self-regulatory failure', 'Steel', 2007, 'Psychological Bulletin', '10.1037/0033-2909.133.1.65', 'reading', '', ['procrastination']),
    p_d3: paper('Developmental sequence in small groups', 'Tuckman', 1965, 'Psychological Bulletin', '10.1037/h0022100', 'read', 'Forming, storming, norming, performing. Useful frame for when plans change in a team.', ['teams']),
    p_d4: paper('Using thematic analysis in psychology', 'Braun, Clarke', 2006, 'Qualitative Research in Psychology', '10.1191/1478088706qp063oa', 'to-read', 'For analysing the interviews.', ['methods']),
  };

  const chapters = defaultChapters('ug', 'people').map(c => ({ ...c }));
  const set = (name, words, status, drafts) => { const c = chapters.find(x => x.name === name); if (c) Object.assign(c, { words, status }, drafts ? { drafts } : {}); };
  set('Introduction', 420, 'drafting');
  set('Literature review', 1850, 'supervisor', [{ n: 1, taskId: 't_d_review1', url: draftUrl, sentAt: ago(3) }]);
  set('Methodology', 300, 'drafting');
  const dissertation = cleanDissertation({
    level: 'ug', kind: 'people', start, handIn, dates: {}, chapters, setupAt: ago(36),
    proposal: {
      topic: 'How first-year engineering students plan group projects',
      why: 'Most first-year engineering modules include a group project, and most groups finish in a rush. Knowing where plans go wrong could help students and the staff who set the projects.',
      gap: 'Studies of the planning fallacy mostly look at individuals; there is little on how student teams make and change plans together.',
      question: 'How do first-year engineering students plan group projects, and what makes their plans slip?',
      aims: 'Aim: understand how first-year teams plan and re-plan.\nObjectives:\n- Survey first-year students about how their group planned\n- Interview six students from different groups\n- Compare planned and actual timelines',
      methods: 'An online survey of first-year engineering students, then six semi-structured interviews analysed with thematic analysis.',
      ethics: 'Interviews with students: information sheet, consent form, anonymised transcripts kept on university OneDrive.',
      sources: 'Buehler, Griffin and Ross (1994); Steel (2007); Tuckman (1965); Braun and Clarke (2006).',
    },
    checks: { eth_guidance: true, eth_info: true, eth_consent: true },
  });
  const { id: _id, ...plan_ } = dissertation; void _id;

  const team = {
    doc: {
      name: 'My dissertation (sample)', logo: '', ownerUid: me, createdAt: ago(36),
      roles: { ...DEFAULT_ROLES, supervisor: SUPERVISOR_ROLE }, fields: [], labels: DEFAULT_LABELS, weekNaming: 'sequence',
      phases: plan.phases, features: startFeatures('dissertation'), weeks, currency: 'GBP',
      autos: { partsTo: '', tellWaiting: false, remindDays: 0, carry: true, carryWarn: 2, carryMakeWeeks: false },
    },
    members: {
      [me]: { uid: me, email: user.email, name: myName, photo: '', roleId: 'owner', joinedAt: ago(36) },
      [SUP.uid]: { uid: SUP.uid, email: SUP.email, name: SUP.name, photo: '', roleId: 'supervisor', joinedAt: ago(33) },
    },
    invites: {}, categories, tasks, comments, meetings, papers,
    dissertation: { plan: plan_ },
  };
  const users = { [SUP.uid]: { uid: SUP.uid, email: SUP.email, name: SUP.name, photo: '', emailVerified: true, provider: 'demo' } };
  return { teamId: 't_sample_diss_' + Math.random().toString(16).slice(2, 12), team, users };
}
