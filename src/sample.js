// ─────────────────────────────────────────────────────────────────────────────
//  Demo only: "Explore a sample team". Loads a made-up drone team (data/sample-team.json)
//  into this browser, with its dates moved so its current week is this week, the visitor
//  as its owner, and the newer features switched on and filled in: the Engineering
//  workflow (stages), sub-teams, parts and budget, notebook, risks, comments.
//  Loaded only when someone presses the button.
// ─────────────────────────────────────────────────────────────────────────────
import { WORKFLOW_TEMPLATES, newId, storedWorkflow, cleanWorkflow, leadsIndex } from './model.js';

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
  const wi = {}; const item = (id, kind, x, y, extra) => { if (kind === 'task' && !team.tasks[extra.taskId]) return; wi[id] = { boardId: wbId, kind, x, y, w: { note: 260, text: 260, title: 420, task: 300, link: 0 }[kind], h: { note: 150, text: 44, title: 56, task: 104, link: 0 }[kind], text: '', color: '', taskId: '', from: '', to: '', z: z++, createdBy: user.uid, updatedAt: now - DAY, ...extra }; };
  item('wi_t1', 'title', 0, 0, { text: 'Design' }); item('wi_t2', 'title', 0, 330, { text: 'Build' }); item('wi_t3', 'title', 0, 660, { text: 'Test' });
  item('wi_cdr', 'task', 0, 80, { taskId: 't_criticalde_33' }); item('wi_cad', 'task', 360, 80, { taskId: 't_wingcadv_28' });
  item('wi_n1', 'note', 740, 60, { color: '#fef08a', text: 'Landing gear ideas\n- Retract or fixed legs?\n- Carbon tube legs\n- Shock absorbers from foam' });
  item('wi_wa', 'task', 0, 410, { taskId: 't_wingassemb_38' }); item('wi_tb', 'task', 360, 410, { taskId: 't_tailboomji_108' }); item('wi_fa', 'task', 720, 410, { taskId: 't_fuselageas_112' });
  item('wi_rt', 'task', 0, 740, { taskId: 't_rangetestk_67' }); item('wi_ft', 'task', 360, 740, { taskId: 't_flighttest_42' });
  item('wi_n2', 'note', 740, 720, { color: '#fbcfe8', text: 'Book the flying field\nAsk the club about Saturday slots' });
  const arrow = (id, from, to, text = '') => { if (wi[from] && wi[to]) item(id, 'link', 0, 0, { from, to, text }); };
  arrow('wl_1', 'wi_cdr', 'wi_cad'); arrow('wl_2', 'wi_cad', 'wi_wa', 'build'); arrow('wl_3', 'wi_tb', 'wi_fa'); arrow('wl_4', 'wi_wa', 'wi_rt', 'Testing'); arrow('wl_5', 'wi_fa', 'wi_ft'); arrow('wl_6', 'wi_n2', 'wi_ft');
  team.wbItems = wi;
  team.doc.features.whiteboards = true;
  // Workflow steps 3 and 4: purchase approvals over £100, and the automatic steps.
  team.doc.purchase = { on: true, over: 100 };
  team.doc.autos = { partsTo: 'build', tellWaiting: true, remindDays: 3 };
  // GitHub sync: a (made-up) repository is connected, so Settings ▸ Integrations can simulate events.
  team.doc.github = { repo: 'skyhawk-uav/flight-software', issues: true, done: true, owner: user.uid, connectedAt: now - 10 * DAY };
  team.private = { github: { secret: 'demo-only', repo: 'skyhawk-uav/flight-software', by: user.uid, at: now - 10 * DAY, last: null } };
  const asker = Object.keys(raw.users).find(u => u !== ownerUid && team.members[u]) || user.uid;
  if (team.parts && team.parts.p_bat) team.parts.p_bat.approval = { status: 'waiting', by: asker, byName: nameOf(asker), at: now - 5 * HOUR, amount: 237, approver: '', approverName: '', note: '', decidedAt: 0 };
  if (team.parts) team.parts.p_gear = { name: 'Carbon landing gear set', partNo: 'CLG-450', supplier: 'HobbyKing', url: '', qty: 1, unitCost: 140, status: 'needed', neededBy: '', orderedDate: '', receivedDate: '',
    taskId: '', budgetId: 'b_air', notes: 'Lighter than the printed legs.', extras: [], subteamId: '', createdBy: asker, createdByName: nameOf(asker), createdAt: now - 3 * DAY, updatedAt: now - DAY,
    approval: { status: 'approved', by: asker, byName: nameOf(asker), at: now - 2 * DAY, amount: 140, approver: user.uid, approverName: user.name || 'You', note: '', decidedAt: now - DAY } };
  const users = {};
  Object.values(raw.users).forEach(u => { if (u.uid !== ownerUid) users[u.uid] = u; });
  return { teamId: 't_sample_' + newId('x').slice(-10), team, users };
}
