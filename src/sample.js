// ─────────────────────────────────────────────────────────────────────────────
//  Demo only: "Explore a sample team". Loads a made-up drone team (data/sample-team.json)
//  into this browser, with its dates moved so its current week is this week, the visitor
//  as its owner, and the newer features switched on and filled in: the Engineering
//  workflow (stages), sub-teams, parts and budget, notebook, risks, comments.
//  Loaded only when someone presses the button.
// ─────────────────────────────────────────────────────────────────────────────
import { WORKFLOW_TEMPLATES, newId, storedWorkflow, cleanWorkflow, leadsIndex, histTime } from './model.js';

const SAMPLE_TODAY_MONDAY = '2026-10-19';   // the sample's "this week" (WEEK 4)
const DAY = 864e5;
const mondayOf = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

/** The sample store, shifted to now and handed to `user`. Returns { teamId, team, users }. */
export async function buildSample(user, now = Date.now()) {
  const raw = (await import('./data/sample-team.json')).default;
  const shiftDays = Math.round((mondayOf(now) - new Date(SAMPLE_TODAY_MONDAY + 'T12:00:00')) / DAY);
  const shiftMs = shiftDays * DAY;
  const [[, T]] = Object.entries(raw.teams);
  const ownerUid = T.doc.ownerUid; const owner = raw.users[ownerUid];
  // Every id-like string of the owner becomes the visitor's; dates and times move to now.
  let json = JSON.stringify(T).split(ownerUid).join(user.uid);
  if (owner && owner.name) json = json.split('"' + owner.name + '"').join(JSON.stringify(user.name || 'You'));
  if (owner && owner.email) json = json.split(owner.email).join(user.email);
  const team = JSON.parse(json, (k, v) => {
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v)) { const d = new Date(v + 'T12:00:00'); d.setDate(d.getDate() + shiftDays); return d.toLocaleDateString('en-CA'); }
    if (typeof v === 'number' && v > 1.6e12 && v < 2.2e12 && /(At|^at|Date|^time)$/.test(k)) return v + shiftMs;
    return v;
  });
  team.doc.name = 'Skyhawk UAV (sample team)';
  team.doc.createdAt = now - 40 * DAY;   // old enough not to show the "Start here" card
  // Newer features: the Engineering workflow, with open tasks spread over its stages.
  // Step 2 of workflows: Review needs the sub-team lead's sign-off, Test an admin's; both have checklists.
  const CHECKS = { review: ['CAD shared', 'Load calculations attached', 'Mass budget updated'], test: ['Risk assessment done', 'Flying field booked'] };
  const eng = WORKFLOW_TEMPLATES.find(t => t.id === 'engineering').stages.map(s => ({ ...s, limit: s.id === 'build' ? 4 : 0,
    signoff: s.id === 'review' ? 'lead' : s.id === 'test' ? 'admin' : '', signer: '', checklist: (CHECKS[s.id] || []).map((text, k) => ({ id: s.id + '_c' + k, text })) }));
  team.doc.workflow = storedWorkflow({ stages: cleanWorkflow({ stages: eng }).stages, moved: {} });
  team.doc.leads = leadsIndex(team.doc.subteams || []);
  const open = ['design', 'review', 'build', 'test'];
  Object.values(team.tasks).filter(t => t.flag !== 'completed').forEach((t, i) => {
    const named = open.find(id => id === String(t.status || '').trim().toLowerCase());   // a status like "Build" becomes that stage
    t.stage = named || open[i % open.length]; if (named) t.status = '';
  });
  Object.keys(team.doc.features || {}).forEach(k => { team.doc.features[k] = true; });
  // Sign-offs in progress: two tasks waiting in Review, one sent back with a note, one already approved.
  const nameOf = (uid) => (uid === user.uid ? (user.name || 'You') : ((raw.users[uid] || {}).name || 'Someone'));
  const leadOf = (uid) => { const st = (team.doc.subteams || []).find(x => (x.members || []).includes(uid) && (x.leads || []).length); return st ? st.leads[0] : user.uid; };
  const HOUR = 36e5;
  Object.values(team.tasks).filter(t => t.flag !== 'completed' && t.stage === 'review').forEach((t, i) => {
    t.checks = i === 0 ? { review_c0: true, review_c1: true } : i === 1 ? { review_c0: true, review_c1: true, review_c2: true } : { review_c0: true };
    const by = t.ownerUid; const base = { stage: 'review', by, byName: nameOf(by), at: now - (i + 2) * HOUR, approver: '', approverName: '', note: '', decidedAt: 0 };
    if (i < 2) t.signoff = { ...base, status: 'waiting' };
    else if (i === 2) { const a = leadOf(by) === by ? user.uid : leadOf(by); t.signoff = { ...base, status: 'changes', at: now - 30 * HOUR, approver: a, approverName: nameOf(a), note: 'Use PETG: PLA softens in the sun.', decidedAt: now - 20 * HOUR }; }
  });
  const signed = Object.values(team.tasks).filter(t => t.flag === 'completed').sort((a, b) => String(b.completedDate).localeCompare(String(a.completedDate)))[0];
  if (signed) { const a = leadOf(signed.ownerUid) === signed.ownerUid ? user.uid : leadOf(signed.ownerUid); signed.signoff = { stage: 'review', status: 'approved', by: signed.ownerUid, byName: nameOf(signed.ownerUid), at: now - 4 * 864e5, approver: a, approverName: nameOf(a), note: '', decidedAt: now - 3 * 864e5 }; }
  // The Gantt: open tasks get a planned start a few days before their deadline, and more
  // "waits on" links, so the timeline shows real bars and arrows.
  const weekStart = new Map((team.doc.weeks || []).map(w => [w.key, w.startDate]));
  const back = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
  Object.values(team.tasks).forEach((t, i) => {
    const ws = weekStart.get(t.weekId); if (!t.dueDate || !ws) return;
    const s = back(t.dueDate, t.flag === 'completed' ? 2 : 1 + (i % 4)); t.startDate = s < ws ? ws : s;
  });
  const link = (id, on) => { const t = team.tasks[id]; if (t && team.tasks[on] && !(t.dependsOn || []).includes(on)) t.dependsOn = (t.dependsOn || []).concat(on); };
  link('t_fuselageas_112', 't_tailboomji_108'); link('t_rangetestk_67', 't_telemetryl_56'); link('t_flighttest_42', 't_criticalde_33');
  link('t_dropaccura_82', 't_payloadint_81'); link('t_autonomous_102', 't_targetdete_96'); link('t_batterymou_66', 't_wiringharn_60');
  // A whiteboard: Design → Build → Test with real task cards, notes and arrows.
  const wbId = 'wb_sample'; let z = 0;
  team.whiteboards = { [wbId]: { name: 'Drone Challenge plan', createdBy: user.uid, createdByName: user.name || 'You', createdAt: now - 6 * DAY, updatedAt: now - DAY } };
  const wi = {}; const item = (id, kind, x, y, extra) => { if (kind === 'task' && !team.tasks[extra.taskId]) return; wi[id] = { boardId: wbId, kind, x, y, w: { note: 260, text: 260, title: 420, task: 300, link: 0, shape: 200, frame: 1120, pen: 180 }[kind], h: { note: 150, text: 44, title: 56, task: 104, link: 0, shape: 120, frame: 300, pen: 90 }[kind], text: '', color: '', taskId: '', from: '', to: '', shape: '', path: '', z: z++, createdBy: user.uid, updatedAt: now - DAY, ...extra }; };
  item('wi_t1', 'title', 0, 0, { text: 'Design' }); item('wi_t2', 'title', 0, 330, { text: 'Build' }); item('wi_t3', 'title', 0, 660, { text: 'Test' });
  item('wi_cdr', 'task', 0, 80, { taskId: 't_criticalde_33' }); item('wi_cad', 'task', 360, 80, { taskId: 't_wingcadv_28' });
  item('wi_n1', 'note', 740, 60, { color: '#fef08a', text: 'Landing gear ideas\n- Retract or fixed legs?\n- Carbon tube legs\n- Shock absorbers from foam' });
  item('wi_wa', 'task', 0, 410, { taskId: 't_wingassemb_38' }); item('wi_tb', 'task', 360, 410, { taskId: 't_tailboomji_108' }); item('wi_fa', 'task', 720, 410, { taskId: 't_fuselageas_112' });
  item('wi_rt', 'task', 0, 740, { taskId: 't_rangetestk_67' }); item('wi_ft', 'task', 360, 740, { taskId: 't_flighttest_42' });
  item('wi_n2', 'note', 740, 720, { color: '#fbcfe8', text: 'Book the flying field\nAsk the club about Saturday slots' });
  const arrow = (id, from, to, text = '') => { if (wi[from] && wi[to]) item(id, 'link', 0, 0, { from, to, text }); };
  // Newer tools: a frame round the build area, a decision diamond, shapes and a pen mark.
  item('wi_fr', 'frame', -30, 370, { text: 'Build sprint (this week)', color: '#bbf7d0', z: -10 });
  item('wi_dec', 'shape', 1100, 410, { shape: 'diamond', text: 'Ready to fly?', color: '#fed7aa', w: 220, h: 140 });
  item('wi_risk', 'shape', 1100, 80, { shape: 'ellipse', text: 'Risk: wind over 15 knots', color: '#fbcfe8', w: 220, h: 110 });
  item('wi_ok', 'shape', 1400, 430, { shape: 'pill', text: 'Book the field', color: '#bbf7d0', w: 200, h: 80 });
  item('wi_pen', 'pen', 708, 395, { w: 330, h: 136, color: '#e11d48', path: '40,500 80,200 200,60 400,20 600,40 800,120 940,300 980,520 900,760 700,920 450,980 220,920 80,760 40,500' });
  item('wi_n3', 'text', 1000, 560, { text: 'Fuselage is the long pole ↑', w: 280 });
  arrow('wl_7', 'wi_fa', 'wi_dec'); arrow('wl_8', 'wi_dec', 'wi_ok', 'yes'); arrow('wl_9', 'wi_dec', 'wi_ft', 'no: fix first');
  if (wi.wl_8) wi.wl_8.shape = '';
  arrow('wl_10', 'wi_risk', 'wi_dec'); if (wi.wl_10) wi.wl_10.shape = 'none';
  arrow('wl_1', 'wi_cdr', 'wi_cad'); arrow('wl_2', 'wi_cad', 'wi_wa', 'build'); arrow('wl_3', 'wi_tb', 'wi_fa'); arrow('wl_4', 'wi_wa', 'wi_rt', 'Testing'); arrow('wl_5', 'wi_fa', 'wi_ft'); arrow('wl_6', 'wi_n2', 'wi_ft');
  team.wbItems = wi;
  team.doc.features.whiteboards = true;
  // Workflow steps 3 and 4: purchase approvals over £100, and the automatic steps.
  team.doc.purchase = { on: true, over: 100 };
  team.doc.currency = 'GBP';
  team.doc.autos = { partsTo: 'build', tellWaiting: true, remindDays: 3 };
  // GitHub sync: a (made-up) repository is connected, so Settings ▸ Integrations can simulate events.
  team.doc.github = { repo: 'skyhawk-uav/flight-software', issues: true, done: true, owner: user.uid, connectedAt: now - 10 * DAY };
  team.private = { github: { secret: 'demo-only', repo: 'skyhawk-uav/flight-software', by: user.uid, at: now - 10 * DAY, last: null } };
  const asker = Object.keys(raw.users).find(u => u !== ownerUid && team.members[u]) || user.uid;
  if (team.parts && team.parts.p_bat) team.parts.p_bat.approval = { status: 'waiting', by: asker, byName: nameOf(asker), at: now - 5 * HOUR, amount: 237, approver: '', approverName: '', note: '', decidedAt: 0 };
  if (team.parts) team.parts.p_gear = { name: 'Carbon landing gear set', partNo: 'CLG-450', supplier: 'HobbyKing', url: '', qty: 1, unitCost: 140, status: 'needed', neededBy: '', orderedDate: '', receivedDate: '',
    taskId: '', budgetId: 'b_air', notes: 'Lighter than the printed legs.', extras: [], subteamId: '', createdBy: asker, createdByName: nameOf(asker), createdAt: now - 3 * DAY, updatedAt: now - DAY,
    approval: { status: 'approved', by: asker, byName: nameOf(asker), at: now - 2 * DAY, amount: 140, approver: user.uid, approverName: user.name || 'You', note: '', decidedAt: now - DAY } };
  // GitHub on cards: issues and pull requests with their live state, a token so issues can be
  // created, closed and reopened from the board (the demo pretends; nothing reaches GitHub).
  team.doc.github = { ...team.doc.github, write: true, last: { at: now - 2 * HOUR, kind: 'issues', action: 'closed', links: 0, finished: 1, created: 0, ok: true } };
  team.private.github.token = 'ghp_demoOnlyNothingIsSentToGitHub000';
  const R = 'https://github.com/skyhawk-uav/flight-software/';
  const ghOn = (id, kind, n, title, state, reason = '') => {
    const t = team.tasks[id]; if (!t) return;
    t.attachments = (t.attachments || []).concat({ id: 'gh_' + kind + '_' + n, provider: 'github', name: (kind === 'pull' ? 'PR #' : 'Issue #') + n + ': ' + title, url: R + kind + '/' + n, size: 0, addedBy: 'GitHub', addedAt: now - 3 * DAY, state, reason });
    t.history = [{ time: histTime(now - 3 * DAY), user: 'GitHub', field: 'GitHub', original: '', updated: 'Linked ' + (kind === 'pull' ? 'PR #' : 'issue #') + n }, ...(t.history || [])];
  };
  const openIds = Object.values(team.tasks).filter(t => t.flag !== 'completed').map(t => t.id);
  const doneIds = Object.values(team.tasks).filter(t => t.flag === 'completed').map(t => t.id);
  ghOn('t_telemetryl_56', 'issues', 14, 'Telemetry drops packets above 400 m', 'open');
  ghOn('t_telemetryl_56', 'pull', 15, 'Retry lost MAVLink packets', 'draft');
  ghOn('t_targetdete_96', 'pull', 21, 'Target detection with YOLOv8n', 'open');
  ghOn('t_autonomous_102', 'issues', 9, 'Waypoint mission ends early', 'closed', 'not_planned');
  if (doneIds[0]) { ghOn(doneIds[0], 'pull', 7, 'Flight log parser', 'merged'); ghOn(doneIds[0], 'issues', 6, 'Parse flight logs', 'closed'); }
  if (!team.tasks.t_telemetryl_56 && openIds[0]) ghOn(openIds[0], 'issues', 14, 'Telemetry drops packets above 400 m', 'open');
  // People: someone who left (their finished work keeps their name), a member asking to leave,
  // and a member asking for an old task to be deleted. Both wait in Approvals.
  const leftUid = 'u_left_sample'; const firstWeek = (team.doc.weeks || [])[0];
  team.doc.former = { [leftUid]: { name: 'Priya Shah', leftAt: now - 9 * DAY } };
  if (firstWeek) {
    team.categories.c_left_sample = { name: 'Avionics', ownerUid: leftUid, order: 50 };
    [['Pixhawk wiring diagram', 3], ['ESC calibration notes', 2]].forEach(([name, ago], i) => {
      team.tasks['t_left_sample_' + i] = { name, priority: 'Major', status: '', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'completed', dueDate: firstWeek.startDate || '', startDate: '', completedDate: firstWeek.startDate || '',
        subtasks: [], history: [{ time: histTime(now - ago * DAY), user: 'Priya Shah', field: 'Task Status Flag', original: 'none', updated: 'completed' }], custom: {}, icon: '', attachments: [], checks: {}, signoff: null,
        categoryId: 'c_left_sample', ownerUid: leftUid, weekId: firstWeek.key, order: i, createdBy: leftUid, createdAt: now - (ago + 20) * DAY, updatedBy: 'Priya Shah', updatedAt: now - ago * DAY };
    });
  }
  const memberUids = Object.entries(team.members).filter(([u, m]) => m.roleId === 'member' && u !== user.uid).map(([u]) => u);
  team.requests = team.requests || {};
  if (memberUids[0]) team.requests['leave-' + memberUids[0]] = { kind: 'leave', by: memberUids[0], byName: nameOf(memberUids[0]), at: now - 6 * HOUR, note: 'Moving to the rocketry society next term. Happy to hand my tasks to whoever picks up structures.' };
  const asker2 = memberUids[1] || memberUids[0];
  const oldOne = asker2 && Object.values(team.tasks).find(t => t.ownerUid === asker2 && t.flag !== 'completed');
  const oldId = oldOne && Object.keys(team.tasks).find(k => team.tasks[k] === oldOne);
  if (oldId) team.requests['del-' + oldId] = { kind: 'delete', by: asker2, byName: nameOf(asker2), at: now - 3 * HOUR, note: 'Duplicate of the wiring harness task.', taskId: oldId, taskName: oldOne.name };
  const users = {};
  Object.values(raw.users).forEach(u => { if (u.uid !== ownerUid) users[u.uid] = u; });
  return { teamId: 't_sample_' + newId('x').slice(-10), team, users };
}
