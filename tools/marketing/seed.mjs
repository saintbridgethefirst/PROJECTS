// Builds a realistic sample team ("Skyhawk UAV") in demo mode and saves the demo store to
// tools/marketing/sample-store.json, for screenshots, clips and videos.
// Needs the dev server (it imports src/model.js in the page):  npx vite --port 5173
//   node tools/marketing/seed.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const OUT = new URL('./sample-store.json', import.meta.url);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

const PEOPLE = [
  { key: 'aisha', name: 'Aisha Khan', email: 'aisha.khan@uni.ac.uk', role: 'owner' },
  { key: 'tom', name: 'Tom Reed', email: 'tom.reed@uni.ac.uk', role: 'member' },
  { key: 'priya', name: 'Priya Nair', email: 'priya.nair@uni.ac.uk', role: 'member' },
  { key: 'leo', name: 'Leo Martins', email: 'leo.martins@uni.ac.uk', role: 'member' },
  { key: 'mei', name: 'Mei Chen', email: 'mei.chen@uni.ac.uk', role: 'member' },
  { key: 'ben', name: 'Ben Owusu', email: 'ben.owusu@uni.ac.uk', role: 'admin' },
];

async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}

try {
  // ── Accounts and the team ──
  const pages = {};
  pages.aisha = await tab('aisha');
  await signIn(pages.aisha, PEOPLE[0].name, PEOPLE[0].email);
  const A = pages.aisha;
  await A.fill('#create-team-form input[name=name]', 'Skyhawk UAV · Drone Challenge 2026'); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(400);
  await A.evaluate(() => TT.setFeatures({ planning: true, meetings: true, notebook: true, literature: true, subteams: true, parts: true, finance: true, people: true, time: true, risks: true, requirements: true }));
  await sleep(300);
  for (const p of PEOPLE.slice(1)) {
    await A.evaluate((o) => TT.writeOps([{ type: 'set', path: 'invites/' + o.email, data: { email: o.email, roleId: o.role, teamName: TT.team.name, invitedBy: TT.me.uid, invitedByName: 'Aisha Khan', createdAt: Date.now() } }]), p);
  }
  await sleep(400);
  for (const p of PEOPLE.slice(1)) {
    const pg = await tab(p.key); pages[p.key] = pg;
    await signIn(pg, p.name, p.email);
    await pg.waitForSelector('#invites-list button:has-text("Join team")'); await pg.click('#invites-list button:has-text("Join team")');
    await pg.waitForSelector('.node-cat'); await sleep(300);
  }
  await A.bringToFront(); await sleep(600);
  const uids = await A.evaluate(() => Object.fromEntries(TT.members.map(m => [m.email.split('.')[0], m.uid])));
  console.log('members', Object.keys(uids).join(', '));

  // ── Team setup: weeks, phases, sub-teams, labels, hours ──
  const setup = await A.evaluate(async (U) => {
    const M = await import('/src/model.js');
    const mon = new Date(); mon.setHours(12); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) - 21);
    const iso = (base, d) => { const x = new Date(base); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };
    const wk = (i, d = 0) => iso(mon, i * 7 + d);
    const phases = [
      M.cleanPhase({ id: 'ph_design', name: 'Design', color: '#7c5cff', start: wk(0), end: wk(1, 6), milestone: 'Preliminary design review' }, 0),
      M.cleanPhase({ id: 'ph_build', name: 'Build', color: '#0e9f8e', start: wk(2), end: wk(3, 6), milestone: 'Critical design review' }, 1),
      M.cleanPhase({ id: 'ph_test', name: 'Test', color: '#ff6b4a', start: wk(4), end: wk(5, 6), milestone: 'Competition flight day' }, 2),
    ];
    const subteams = M.cleanSubteams([
      { id: 'st_fus', name: 'Fuselage', color: '#3ba3ff', members: [U.aisha, U.mei], leads: [U.aisha] },
      { id: 'st_ele', name: 'Electronics', color: '#ffb020', members: [U.tom], leads: [U.tom] },
      { id: 'st_pay', name: 'Payload', color: '#ff5fa2', members: [U.priya], leads: [U.priya] },
      { id: 'st_sw', name: 'Software', color: '#7c5cff', members: [U.leo], leads: [U.leo] },
    ]);
    const labels = { ...TT.team.labels, metric: { label: 'Week metric', show: true }, jiraId: { label: 'Ref', show: true }, status: { label: 'Status badge', show: true } };
    await TT.writeOps([{ type: 'update', path: 'team', data: { phases, subteams, labels, capacity: 12 } }]);
    return { mon: wk(0) };
  }, uids);
  await sleep(500);

  // ── The board: categories and tasks ──
  const ids = await A.evaluate(({ U, mon }) => {
    const iso = (d) => { const x = new Date(mon + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };
    const W = (i, d = 0) => iso(i * 7 + d);
    const metrics = ['Mass est: 4.6 kg', 'Mass est: 4.4 kg', 'Flights: 0', 'Flights: 2', 'Flights: —', 'Flights: —'];
    // six dated weeks
    while (weeksData.length < 6) weeksData.push({ key: 'wk' + (weeksData.length + 1), title: '', metric: '', collapsed: false, startDate: '' });
    weeksData.forEach((w, i) => { w.title = 'WEEK ' + (i + 1); w.startDate = W(i); w.metric = metrics[i]; });
    const K = weeksData.map(w => w.key);
    let n = 0; const id = (s) => 't_' + s + '_' + (++n);
    const person = (uid) => db.find(p => p.id === uid);
    const cat = (uid, name) => { const p = person(uid); let c = p.categories.find(x => x.name === name); if (!c) { c = { id: 'c_' + uid.slice(0, 6) + '_' + name.toLowerCase().replace(/[^a-z]/g, ''), type: 'category', name }; p.categories.push(c); } K.forEach(k => { if (!Array.isArray(c[k])) c[k] = []; }); return c; };
    // rename each person's starter category instead of keeping "CATEGORY 1"
    db.forEach(p => { p.categories = p.categories.filter(c => K.some(k => (c[k] || []).length)); });
    const subs = (titles, done) => titles.map((t, i) => ({ id: 's' + (++n), title: t, completed: i < done }));
    const out = {};
    const task = (uid, catName, wi, name, o = {}) => {
      const t = { id: o.id || id(name.toLowerCase().replace(/[^a-z]+/g, '').slice(0, 10)), type: 'task', name, priority: o.priority || 'Minor', status: o.status || '', jiraId: o.ref || '',
        supportPersonId: o.support || null, supportPersonId2: null, flag: o.done ? 'completed' : 'none', dueDate: o.due === undefined ? '' : W(wi, o.due), phaseId: o.phase || '',
        repeat: null, stage: o.stage || '', effort: o.effort ?? null, dependsOn: o.deps || [], carryOf: o.carryOf || '', skill: o.skill || '', timeLog: o.log || [],
        completedDate: o.done ? W(wi, 4) : '', subtasks: o.subs ? subs(o.subs[0], o.subs[1]) : [], history: o.history || [], custom: {}, icon: o.icon || '', attachments: o.files || [] };
      cat(uid, catName)[K[wi]].push(t); if (o.key) out[o.key] = t.id; return t;
    };
    const log = (who, name, wi, d, h, note) => ({ id: 'l' + (++n), uid: who, name, date: W(wi, d), hours: h, note });
    const carried = (from) => [{ time: new Date().toISOString(), user: 'Team', field: 'Action', original: '', updated: 'Carried forward to ' + from }];

    // Aisha — captain, Fuselage lead
    task(U.aisha, 'Management', 0, 'Competition rules review', { done: true, phase: 'ph_design', priority: 'Major', due: 3, icon: '📜', subs: [['Read the rulebook', 'List scoring criteria', 'Share summary'], 3], effort: 3 });
    task(U.aisha, 'Airframe', 0, 'Concept sketches & sizing', { done: true, phase: 'ph_design', due: 4, icon: '✏️', subs: [['Three concepts', 'Trade-off matrix', 'Pick one'], 3], effort: 6, log: [log(U.aisha, 'Aisha Khan', 0, 2, 4, 'Sizing spreadsheet')] });
    task(U.aisha, 'Airframe', 1, 'Wing CAD v1', { done: true, phase: 'ph_design', priority: 'Major', due: 4, ref: 'SKY-12', icon: '📐', subs: [['Airfoil selection', 'Planform', 'Spar layout'], 3], effort: 8 });
    task(U.aisha, 'Management', 1, 'Sponsor pack', { done: true, phase: 'ph_design', due: 2, icon: '🤝', subs: [['Slides', 'Budget page'], 2] });
    task(U.aisha, 'Airframe', 2, 'Wing spar FEA', { done: true, phase: 'ph_build', priority: 'Major', due: 3, ref: 'SKY-18', icon: '🧮', subs: [['Mesh', 'Load cases', 'Report'], 3], effort: 6 });
    const wcad = task(U.aisha, 'Airframe', 2, 'Wing CAD v2', { phase: 'ph_build', priority: 'Major', due: 11, ref: 'SKY-21', icon: '📐', subs: [['Rib spacing', 'Servo bays', 'Tolerance stack (GD&T)', 'Export STEP'], 2], effort: 10, support: U.mei, key: 'wcad1', log: [log(U.aisha, 'Aisha Khan', 2, 3, 3, 'Ribs and spar caps')] });
    task(U.aisha, 'Airframe', 3, 'Wing CAD v2', { phase: 'ph_build', priority: 'Major', due: 4, ref: 'SKY-21', icon: '📐', subs: [['Rib spacing', 'Servo bays', 'Tolerance stack (GD&T)', 'Export STEP'], 3], effort: 10, support: U.mei, carryOf: wcad.id, history: carried('WEEK 4'), stage: 'doing', key: 'wcad2', log: [log(U.aisha, 'Aisha Khan', 3, 1, 2.5, 'Servo bays')] });
    task(U.aisha, 'Management', 3, 'Critical design review prep', { phase: 'ph_build', priority: 'Critical', due: 4, icon: '🧭', subs: [['Slides', 'Mass budget', 'Risk summary', 'Dry run'], 1], effort: 6, key: 'cdr' });
    task(U.aisha, 'Airframe', 4, 'Wing assembly', { phase: 'ph_test', priority: 'Major', due: 3, icon: '🛠️', subs: [['Cut ribs', 'Bond spar', 'Skin'], 0], effort: 12, key: 'wasm' });
    task(U.aisha, 'Management', 5, 'Flight test plan sign-off', { phase: 'ph_test', due: 1, icon: '✅', effort: 2 });

    // Tom — Electronics lead
    task(U.tom, 'Avionics', 0, 'Flight controller selection', { done: true, phase: 'ph_design', due: 4, icon: '🧠', subs: [['Compare 3 boards', 'Decide'], 2], effort: 4 });
    task(U.tom, 'Power', 1, 'Power budget', { done: true, phase: 'ph_design', priority: 'Major', due: 3, icon: '⚡', subs: [['Motor data', 'Battery sizing', 'Flight-time estimate'], 3], effort: 5 });
    task(U.tom, 'Power', 2, 'ESC + motor bench test', { done: true, phase: 'ph_build', priority: 'Major', due: 4, icon: '🔌', subs: [['Thrust stand', 'Run at 50/75/100%', 'Log temperatures'], 3], effort: 6, key: 'bench', log: [log(U.tom, 'Tom Reed', 2, 2, 3, 'Thrust stand runs'), log(U.tom, 'Tom Reed', 2, 3, 2, 'Temperature logging')] });
    task(U.tom, 'Avionics', 3, 'Telemetry link', { phase: 'ph_build', priority: 'Critical', due: -2, ref: 'SKY-25', icon: '📡', subs: [['Pair radios', 'Range check on campus', 'Failsafe settings'], 1], effort: 5, key: 'telem' });
    task(U.tom, 'Avionics', 3, 'Wiring harness', { phase: 'ph_build', due: 5, icon: '🧵', subs: [['Layout', 'Crimp', 'Heat-shrink', 'Continuity test', 'Label'], 2], stage: 'doing', effort: 6, skill: 'Soldering' });
    task(U.tom, 'Power', 4, 'Battery mount', { phase: 'ph_test', due: 2, icon: '🔋', effort: 3 });
    task(U.tom, 'Avionics', 5, 'Range test (1 km)', { phase: 'ph_test', priority: 'Major', due: 2, icon: '📶', effort: 4 });

    // Priya — Payload
    task(U.priya, 'Payload', 1, 'Drop mechanism concept', { done: true, phase: 'ph_design', due: 4, icon: '📦', subs: [['Sketches', 'Pick release type'], 2], effort: 4 });
    task(U.priya, 'Payload', 2, 'Servo release prototype', { done: true, phase: 'ph_build', priority: 'Major', due: 4, icon: '⚙️', subs: [['Print latch', 'Fit servo', 'Bench drop x10'], 3], effort: 6 });
    task(U.priya, 'Payload', 3, 'Drop mechanism v2', { phase: 'ph_build', priority: 'Major', due: 4, icon: '🎯', subs: [['Stronger latch', 'Weight test 500 g', 'Wire to FC', 'Bench drop x20', 'Video for review'], 3], stage: 'doing', effort: 8, key: 'drop' });
    task(U.priya, 'Payload', 4, 'Payload integration', { phase: 'ph_test', priority: 'Major', due: 3, icon: '🧩', effort: 5, key: 'pint' });
    task(U.priya, 'Payload', 5, 'Drop accuracy test', { phase: 'ph_test', priority: 'Critical', due: 3, icon: '🎯', effort: 4 });

    // Leo — Software
    task(U.leo, 'Autonomy', 0, 'PX4 simulator setup', { done: true, phase: 'ph_design', due: 3, icon: '💻', subs: [['Install', 'First SITL flight'], 2], effort: 4 });
    task(U.leo, 'Autonomy', 1, 'Mission scripts', { done: true, phase: 'ph_design', due: 4, icon: '🗺️', subs: [['Takeoff/land', 'Waypoints'], 2], effort: 6 });
    task(U.leo, 'Autonomy', 2, 'Waypoint mission in SITL', { done: true, phase: 'ph_build', due: 3, icon: '🛰️', effort: 5 });
    const det = task(U.leo, 'Autonomy', 2, 'Target detection model', { phase: 'ph_build', priority: 'Major', due: 10, icon: '🧠', subs: [['Collect 500 images', 'Label', 'Train YOLO', 'Test on Pi'], 1], effort: 12, skill: 'Python', key: 'det1' });
    task(U.leo, 'Autonomy', 3, 'Target detection model', { phase: 'ph_build', priority: 'Major', due: 3, icon: '🧠', subs: [['Collect 500 images', 'Label', 'Train YOLO', 'Test on Pi'], 2], effort: 12, skill: 'Python', carryOf: det.id, history: carried('WEEK 4'), stage: 'doing', key: 'det2', log: [log(U.leo, 'Leo Martins', 3, 1, 4, 'Training run 1')] });
    task(U.leo, 'Ground station', 4, 'Ground station UI', { phase: 'ph_test', due: 4, icon: '🖥️', effort: 6 });
    task(U.leo, 'Autonomy', 5, 'Autonomous drop logic', { phase: 'ph_test', priority: 'Critical', due: 2, icon: '🤖', effort: 8 });

    // Mei — Fuselage
    task(U.mei, 'Fuselage', 1, 'Fuselage layout', { done: true, phase: 'ph_design', due: 4, icon: '📏', subs: [['CG estimate', 'Component placement'], 2], effort: 5 });
    task(U.mei, 'Fuselage', 2, '3D print nose cone', { done: true, phase: 'ph_build', due: 4, icon: '🖨️', effort: 3 });
    task(U.mei, 'Fuselage', 3, 'Order carbon tubes', { phase: 'ph_build', priority: 'Blocker', due: -3, ref: 'PO-07', icon: '🛒', effort: 1, key: 'tubes' });
    task(U.mei, 'Fuselage', 3, 'Tail boom jig', { phase: 'ph_build', due: 5, icon: '📐', subs: [['Design', 'Print', 'Test fit'], 1], stage: 'doing', effort: 4 });
    task(U.mei, 'Fuselage', 4, 'Fuselage assembly', { phase: 'ph_test', priority: 'Major', due: 4, icon: '🛠️', effort: 10 });

    // Ben — Treasurer
    task(U.ben, 'Finance & outreach', 0, 'Budget plan', { done: true, phase: 'ph_design', due: 4, icon: '💷', effort: 3 });
    task(U.ben, 'Finance & outreach', 1, 'Sponsor emails', { done: true, phase: 'ph_design', due: 3, icon: '✉️', subs: [['10 companies', 'Follow-ups'], 2], effort: 4 });
    task(U.ben, 'Finance & outreach', 2, 'University grant form', { done: true, phase: 'ph_build', priority: 'Major', due: 2, icon: '🏛️', effort: 3 });
    task(U.ben, 'Finance & outreach', 3, 'Order tracking & receipts', { phase: 'ph_build', due: 4, icon: '🧾', subs: [['Upload receipts', 'Reconcile'], 1], effort: 2 });
    task(U.ben, 'Finance & outreach', 4, 'Social media update', { phase: 'ph_test', due: 3, icon: '📣', effort: 2 });
    task(U.ben, 'Finance & outreach', 5, 'Final cost report', { phase: 'ph_test', due: 4, icon: '📊', effort: 3 });

    // dependencies
    const find = (k) => allTaskLocs().find(l => l.task.id === out[k]).task;
    find('wasm').dependsOn = [out.tubes, out.wcad1];
    find('pint').dependsOn = [out.drop];
    // order people: captain first
    const order = [U.aisha, U.tom, U.priya, U.leo, U.mei, U.ben]; db.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    db.forEach(p => { if (!p.categories.length) cat(p.id, 'General'); });
    saveDatabase(); renderFilters(); render();
    return out;
  }, { U: uids, mon: setup.mon });
  await sleep(1500);
  console.log('tasks', Object.keys(ids).length);

  // ── Tools data (owner) ──
  await A.evaluate(async ({ U, mon, T }) => {
    const M = await import('/src/model.js');
    const iso = (d) => { const x = new Date(mon + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };
    const now = Date.now(); const me = { uid: TT.me.uid, name: 'Aisha Khan' };
    const set = (path, obj) => { const { id, ...data } = obj; return { type: 'set', path: path + '/' + id, data }; };
    const ops = [];
    const budget = M.cleanBudget({ currency: 'GBP', lines: [
      { id: 'b_air', name: 'Airframe & fuselage', amount: 650, subteamId: 'st_fus' }, { id: 'b_ele', name: 'Electronics & power', amount: 900, subteamId: 'st_ele' },
      { id: 'b_pay', name: 'Payload', amount: 250, subteamId: 'st_pay' }, { id: 'b_sw', name: 'Compute & software', amount: 150, subteamId: 'st_sw' }, { id: 'b_trv', name: 'Travel to competition', amount: 800 } ], updatedAt: now });
    ops.push({ type: 'set', path: 'finance/budget', data: budget });
    const parts = [
      ['p_fc', 'Pixhawk 6C flight controller', 'Holybro', 1, 215, 'received', 'b_ele', T.bench, 'st_ele', [{ label: 'Shipping', amount: 9.5 }]],
      ['p_mot', 'Brushless motor 3110 900KV', 'T-Motor', 4, 49, 'received', 'b_ele', T.bench, 'st_ele', [{ label: 'VAT / tax', amount: 20, percent: true }]],
      ['p_rad', 'Telemetry radio pair 433 MHz', 'Holybro', 1, 45, 'ordered', 'b_ele', T.telem, 'st_ele', []],
      ['p_bat', '6S 5000 mAh LiPo', 'Tattu', 3, 79, 'needed', 'b_ele', '', 'st_ele', [{ label: 'Shipping', amount: 12 }]],
      ['p_cf', 'Carbon fibre tube 20 mm × 1 m', 'Easy Composites', 4, 18, 'ordered', 'b_air', T.tubes, 'st_fus', [{ label: 'Shipping', amount: 6.95 }, { label: 'VAT / tax', amount: 20, percent: true }]],
      ['p_pla', 'PLA+ filament 1 kg', 'Prusament', 3, 25, 'received', 'b_air', '', 'st_fus', []],
      ['p_srv', 'Metal-gear servo MG996R', 'Pololu', 4, 9, 'received', 'b_pay', T.drop, 'st_pay', []],
      ['p_pi', 'Raspberry Pi 5 + camera', 'The Pi Hut', 1, 98, 'ordered', 'b_sw', T.det2, 'st_sw', [{ label: 'Discount', amount: -10, percent: true }]],
    ];
    parts.forEach(([id, name, supplier, qty, unitCost, status, budgetId, taskId, subteamId, extras], i) => ops.push(set('parts', M.cleanPart({ id, name, supplier, qty, unitCost, status, budgetId, taskId, subteamId, extras,
      neededBy: iso(14 + i), orderedDate: status !== 'needed' ? iso(8 + i) : '', receivedDate: status === 'received' ? iso(12 + i) : '', createdBy: me.uid, createdByName: me.name, createdAt: now, updatedAt: now }))));
    const tx = [
      ['x1', 'income', 2000, 2, 'University engineering grant', ''], ['x2', 'income', 1000, 9, 'Sponsor: AeroParts Ltd', ''],
      ['x3', 'expense', 224.5, 13, 'Flight controller', 'b_ele', ['p_fc']], ['x4', 'expense', 235.2, 13, 'Motors ×4', 'b_ele', ['p_mot']],
      ['x5', 'expense', 75, 15, 'PLA+ filament ×3', 'b_air', ['p_pla']], ['x6', 'expense', 36, 16, 'Servos ×4', 'b_pay', ['p_srv']],
      ['x7', 'expense', 94.74, 22, 'Carbon tubes ×4', 'b_air', ['p_cf']], ['x8', 'expense', 42, 18, 'Bench test consumables', 'b_ele', []],
    ];
    tx.forEach(([id, kind, amount, d, description, budgetId, partIds]) => ops.push(set('expenses', M.cleanExpense({ id, kind, amount, date: iso(d), description, budgetId, partIds: partIds || [], payer: kind === 'income' ? '' : 'Ben Owusu', createdBy: me.uid, createdByName: me.name, createdAt: now, updatedAt: now }))));
    const papers = [
      ['pp1', 'You Only Look Once: Unified, Real-Time Object Detection', 'Redmon, Divvala, Girshick, Farhadi', 2016, 'CVPR', '10.1109/CVPR.2016.91', 'read', [T.det1], ['vision', 'detection']],
      ['pp2', 'PX4: A Node-Based Multithreaded Open Source Robotics Framework', 'Meier, Honegger, Pollefeys', 2015, 'ICRA', '10.1109/ICRA.2015.7140074', 'reading', [], ['autopilot']],
      ['pp3', 'Small Unmanned Aircraft: Theory and Practice', 'Beard, McLain', 2012, 'Princeton University Press', '', 'reading', [T.wcad1], ['aero', 'textbook']],
      ['pp4', 'Precision payload delivery from small UAVs', 'Garcia, Lee', 2021, 'Journal of Intelligent & Robotic Systems', '', 'to-read', [T.drop], ['payload']],
    ];
    papers.forEach(([id, title, authors, year, venue, doi, status, taskIds, tags]) => ops.push(set('papers', M.cleanPaper({ id, title, authors, year, venue, doi, status, taskIds, tags, notes: '', addedBy: me.uid, addedByName: me.name, createdAt: now, updatedAt: now }))));
    ops.push(set('meetings', M.cleanMeeting({ id: 'm1', title: 'Weekly team meeting', date: iso(22), attendees: Object.values(U), createdBy: me.uid, createdByName: me.name, createdAt: now, updatedAt: now,
      notes: 'Agenda\n- Wing CAD status\n- Telemetry problems\n- Carbon tube order\n\nDecisions\n- Freeze the wing design on Friday\n- Move the range test to week 6\n\nActions',
      actions: [{ id: 'a1', text: 'Chase the carbon tube order', ownerUid: U.mei, dueDate: iso(23), taskId: T.tubes }, { id: 'a2', text: 'Fix telemetry failsafe settings', ownerUid: U.tom, dueDate: iso(24), taskId: T.telem }, { id: 'a3', text: 'Book the flying field for week 5', ownerUid: U.ben, dueDate: iso(26), taskId: '' }] })));
    ops.push(set('meetings', M.cleanMeeting({ id: 'm2', title: 'Supervisor check-in', date: iso(15), attendees: [U.aisha, U.leo], createdBy: me.uid, createdByName: me.name, createdAt: now, updatedAt: now,
      notes: 'Decisions\n- Use YOLO on the Pi for target detection\n- Keep MTOW under 5 kg', actions: [{ id: 'a4', text: 'Share detection accuracy numbers', ownerUid: U.leo, dueDate: iso(25), taskId: T.det2 }] })));
    const risks = [
      ['r1', 'Carbon tubes arrive late', 4, 4, U.mei, 'open', 'Second supplier quoted; aluminium fallback for test flights.', [T.tubes]],
      ['r2', 'Telemetry interference at the flying field', 3, 4, U.tom, 'mitigating', 'Switch to 868 MHz if range test fails.', [T.telem]],
      ['r3', 'LiPo fire while charging', 2, 5, U.ben, 'mitigating', 'Charge in LiPo bags, never unattended.', []],
      ['r4', 'Detection model too slow on the Pi', 3, 3, U.leo, 'open', 'Use a smaller model or lower resolution.', [T.det2]],
    ];
    risks.forEach(([id, title, likelihood, impact, ownerUid, status, mitigation, taskIds]) => ops.push(set('risks', M.cleanRisk({ id, title, likelihood, impact, ownerUid, status, mitigation, taskIds, reviewDate: iso(26), createdBy: me.uid, createdByName: me.name, createdAt: now, updatedAt: now }))));
    const reqs = [
      ['q1', 'REQ-001', 'Maximum take-off mass ≤ 5 kg', 'must', 'agreed', [T.wcad1], 'Weigh the aircraft fully loaded', false],
      ['q2', 'REQ-002', 'Drop the payload within 5 m of the target', 'must', 'agreed', [T.drop, T.det1], 'Ten test drops, measure miss distance', false],
      ['q3', 'REQ-003', 'Telemetry range ≥ 1 km', 'should', 'agreed', [T.telem], 'Range test at the flying field', false],
      ['q4', 'REQ-004', 'Motor thrust-to-weight ≥ 2:1', 'must', 'met', [T.bench], 'Thrust stand test', true],
    ];
    reqs.forEach(([id, ref, title, priority, status, taskIds, verification, verified]) => ops.push(set('requirements', M.cleanRequirement({ id, ref, title, priority, status, taskIds, verification, verified, verifiedBy: verified ? 'Tom Reed' : '', verifiedDate: verified ? iso(18) : '', createdBy: me.uid, createdByName: me.name, createdAt: now, updatedAt: now }))));
    const prof = { aisha: [12, ['CAD', 'FEA', 'Composites']], tom: [12, ['Soldering', 'Electronics', 'PX4']], priya: [10, ['CAD', '3D printing']], leo: [14, ['Python', 'ROS', 'Computer vision']], mei: [10, ['Composites', '3D printing']], ben: [8, ['Finance', 'Outreach']] };
    Object.entries(prof).forEach(([k, [capacity, skills]]) => ops.push({ type: 'set', path: 'profiles/' + U[k], data: (({ uid, ...d }) => d)(M.cleanProfile({ capacity, skills, away: k === 'priya' ? [{ from: iso(28), to: iso(30), note: 'Exam' }] : [], updatedAt: now }, U[k])) }));
    for (let i = 0; i < ops.length; i += 20) await TT.writeOps(ops.slice(i, i + 20));
  }, { U: uids, mon: setup.mon, T: ids });
  await sleep(800);

  // ── Members write their own comments and notebook entries ──
  const chartPng = async (p, title, vals) => p.evaluate(({ title, vals }) => {
    const c = document.createElement('canvas'); c.width = 480; c.height = 300; const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 480, 300); g.fillStyle = '#14213d'; g.font = 'bold 18px sans-serif'; g.fillText(title, 20, 32);
    g.strokeStyle = '#cbd5e1'; for (let y = 60; y <= 260; y += 50) { g.beginPath(); g.moveTo(40, y); g.lineTo(460, y); g.stroke(); }
    const mx = Math.max(...vals); vals.forEach((v, i) => { const h = v / mx * 190; g.fillStyle = ['#0e9f8e', '#3ba3ff', '#7c5cff', '#ff6b4a'][i % 4]; g.fillRect(60 + i * 100, 260 - h, 60, h); g.fillStyle = '#14213d'; g.font = '14px sans-serif'; g.fillText(String(v), 70 + i * 100, 252 - h); });
    return c.toDataURL('image/jpeg', 0.8);
  }, { title, vals });
  const write = async (who, ops) => { const p = pages[who]; await p.bringToFront(); await p.evaluate((o) => TT.writeOps(o), ops); await sleep(250); };
  const now = Date.now();
  const note = async (who, name, taskId, date, text, image) => ({ type: 'set', path: 'notebook/n_' + who + '_' + Math.random().toString(36).slice(2, 7), data: { taskId, authorUid: uids[who], authorName: name, date, text, images: image ? [image] : [], createdAt: now, editedAt: 0 } });
  const isoW = (wi, d) => { const x = new Date(setup.mon + 'T12:00:00'); x.setDate(x.getDate() + wi * 7 + d); return x.toLocaleDateString('en-CA'); };
  await write('tom', [await note('tom', 'Tom Reed', ids.bench, isoW(2, 3), 'Thrust stand: 2.3 kg per motor at 100% on 6S. ESC peaked at 61 °C after 3 minutes. Thrust-to-weight ≈ 2.1 — REQ-004 met.', await chartPng(pages.tom, 'Thrust per motor (kg) at 25/50/75/100%', [0.6, 1.2, 1.8, 2.3]))]);
  await write('aisha', [await note('aisha', 'Aisha Khan', ids.wcad1, isoW(2, 4), 'Moved ribs to 120 mm spacing after the FEA. Spar cap 2 mm thicker at the root. Next: servo bays.')]);
  await write('leo', [await note('leo', 'Leo Martins', ids.det2, isoW(3, 1), 'First YOLO training run: mAP 0.71 on 480 labelled images, 9 fps on the Pi 5. Need more images of the target from 30 m.', await chartPng(pages.leo, 'Detection accuracy (mAP %) by run', [52, 64, 71]))]);
  const cm = (who, name, taskId, text, mentions, ago) => ({ type: 'set', path: 'comments/c_' + who + '_' + Math.random().toString(36).slice(2, 7), data: { taskId, authorUid: uids[who], authorName: name, text, mentions, createdAt: now - ago } });
  await write('mei', [cm('mei', 'Mei Chen', ids.tubes, 'Supplier says Thursday. @Aisha Khan can we use aluminium for the first test flight if they slip?', [uids.aisha], 5 * 3600e3)]);
  await write('aisha', [cm('aisha', 'Aisha Khan', ids.tubes, 'Yes — aluminium is fine for week 5. Logged it as a risk.', [], 4 * 3600e3), cm('aisha', 'Aisha Khan', ids.telem, '@Tom Reed this is blocking the range test, can we look at it tomorrow?', [uids.tom], 3 * 3600e3)]);
  await write('tom', [cm('tom', 'Tom Reed', ids.telem, 'Found it — failsafe was set to RTL at 2 s. Fixing tonight.', [], 2 * 3600e3)]);
  await write('leo', [cm('leo', 'Leo Martins', ids.det1, '@Priya Nair I need 200 more photos of the target from above, can you help on Saturday?', [uids.priya], 26 * 3600e3)]);
  await write('priya', [cm('priya', 'Priya Nair', ids.drop, 'Latch v2 held 500 g for 20 drops. Video in the notebook tomorrow.', [], 1 * 3600e3)]);

  await A.bringToFront(); await sleep(800);
  const store = await A.evaluate(() => localStorage.getItem('tt_demo_store_v1'));
  fs.writeFileSync(OUT, store);
  const s = JSON.parse(store); const T = Object.values(s.teams)[0];
  console.log('saved', OUT.pathname, (store.length / 1024).toFixed(0) + ' KB', 'tasks', Object.keys(T.tasks).length, 'parts', Object.keys(T.parts || {}).length, 'comments', Object.keys(T.comments || {}).length, 'notebook', Object.keys(T.notebook || {}).length);
  console.log('users', Object.values(s.users).map(u => u.uid + ' ' + u.name).join(' | '));
} catch (e) { console.log('SEED CRASH:', e.message.split('\n').slice(0, 8).join('\n')); process.exitCode = 1; }
console.log('page errors:', errors);
await browser.close();
