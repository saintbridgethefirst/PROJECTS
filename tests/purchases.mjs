// Purchase approvals and automatic steps (workflow steps 3 and 4), with three people:
// Aisha (owner), Tom (member, buys parts) and Priya (admin, manages finances).
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const team = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const partBy = async (p, name) => Object.entries((await team(p)).parts || {}).map(([id, v]) => ({ ...v, id })).find(x => x.name === name);
const research = async (p, t) => { if (!(await p.locator('.research-modal').count())) { await p.click('#research-btn'); await p.waitForSelector('.research-modal'); } await p.click(`.rs-tab[data-tab="${t}"]`); await sleep(250); };
const row = (p, name) => p.locator('.pt-row', { hasText: name });
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: SHOTS + '/purchases-' + n + '.png' }); };
const openTeam = async (p) => { await p.locator('.team-tile').first().click(); await p.waitForSelector('.task-card'); await sleep(400); };
const addPart = async (p, name, qty, cost) => {
  await p.click('#pt-new'); await sleep(120); await p.fill('#pt-name', name); await p.fill('#pt-qty', String(qty)); await p.fill('#pt-cost', String(cost));
  await p.click('.rs-form button[type=submit]'); await sleep(400);
};

try {
  step('A team with parts and finance, a member who buys and an admin who manages money');
  const A = await tab('Aisha'); await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Rover Lab'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(() => {
    const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const T = Object.values(s.teams)[0]; const wk = T.doc.weeks[0].key;
    T.doc.features = { ...(T.doc.features || {}), parts: true, finance: true, planning: true };
    for (const [uid, name, email, roleId] of [['u_tom', 'Tom Reed', 'tom@x.com', 'member'], ['u_pri', 'Priya Shah', 'priya@x.com', 'admin']]) {
      s.users[uid] = { uid, email, name, photo: '', emailVerified: true, provider: 'demo' };
      T.members[uid] = { uid, email, name, photo: '', roleId, joinedAt: 1 };
    }
    T.categories.c_tom = { name: 'Chassis', ownerUid: 'u_tom', order: 5 };
    const task = (name, over) => ({ name, priority: 'Major', status: '', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none', dueDate: '', completedDate: '', subtasks: [], history: [], custom: {}, icon: '', attachments: [], categoryId: 'c_tom', ownerUid: 'u_tom', weekId: wk, order: 0, createdBy: 'u_tom', createdAt: 1, updatedBy: 'Tom', updatedAt: 1, ...over });
    T.tasks.t_frame = task('Weld the frame'); T.tasks.t_wheels = task('Fit the wheels', { order: 1, dependsOn: ['t_frame'] });
    const owner = Object.keys(T.members).find(u => T.members[u].roleId === 'owner');
    T.categories.c_own = { name: 'Electronics', ownerUid: owner, order: 6 };
    T.tasks.t_wire = task('Wire the motors', { categoryId: 'c_own', ownerUid: owner, createdBy: owner, order: 2, dependsOn: ['t_frame'] });
    T.finance = { budget: { currency: 'GBP', lines: [{ id: 'b_mech', name: 'Mechanical', amount: 500, phaseId: '', subteamId: '' }], updatedAt: 1 } };
    localStorage.setItem(k, JSON.stringify(s));
  });
  await A.reload(); await A.waitForSelector('.task-card'); await sleep(400);
  ok(await A.locator('#approvals-btn').isHidden(), 'no Approvals button until something needs approving');

  step('Settings ▸ Workflow: approvals over £50, and the automatic steps');
  await A.evaluate(() => TT.openSettings('workflow')); await A.waitForSelector('#pa-settings');
  await A.check('#pa-on'); await A.fill('#pa-over', '50'); await A.click('#pa-save'); await sleep(300);
  await A.check('#auto-parts'); await A.check('#auto-tell'); await A.click('#auto-save'); await sleep(300);
  let T = await team(A);
  ok(T.doc.purchase && T.doc.purchase.on === true && T.doc.purchase.over === 50, 'purchase approvals saved');
  ok(T.doc.autos && T.doc.autos.partsTo === 'doing' && T.doc.autos.tellWaiting === true && T.doc.autos.remindDays === 0, 'automatic steps saved: parts → Doing, tell waiting');
  await shot(A, 'settings');
  await A.keyboard.press('Escape'); await sleep(200);
  ok(await A.locator('#approvals-btn').isVisible(), 'the Approvals button appears');

  step('Tom: a cheap part is ordered straight away; a dear one needs approving');
  const B = await tab('Tom'); await signIn(B, 'Tom Reed', 'tom@x.com'); await openTeam(B);
  await research(B, 'parts');
  await addPart(B, 'Cable ties', 2, 5);
  await row(B, 'Cable ties').locator('.pt-status').selectOption('ordered'); await sleep(400);
  ok((await partBy(B, 'Cable ties')).status === 'ordered', 'under the limit: ordered');
  await addPart(B, 'Lidar sensor', 1, 120);
  ok(await row(B, 'Lidar sensor').locator('.pa-ask').count() === 1, 'over the limit: an Ask for approval button');
  await row(B, 'Lidar sensor').locator('.pt-status').selectOption('ordered'); await sleep(500);
  ok((await partBy(B, 'Lidar sensor')).status === 'needed', 'can’t be marked Ordered before it’s approved');
  ok(await B.locator('.toast', { hasText: 'need approving first' }).count() >= 1, 'and says why');
  await B.locator('.toast button', { hasText: 'Ask for approval' }).last().click(); await sleep(500);
  let lidar = await partBy(B, 'Lidar sensor');
  ok(lidar.approval && lidar.approval.status === 'waiting' && lidar.approval.by === 'u_tom' && lidar.approval.amount === 120, 'asked for approval from the message');
  ok(await row(B, 'Lidar sensor').locator('.pa-wait').count() === 1, 'shows Waiting for approval');
  ok(await row(B, 'Lidar sensor').locator('.pa-approve').count() === 0, 'Tom can’t approve his own');
  ok(await B.locator('#approvals-btn').isVisible() && await B.locator('#approvals-badge').isHidden(), 'nothing waits for Tom');
  await shot(B, 'parts-waiting');

  step('Priya declines it with a note, from Approvals');
  const C = await tab('Priya'); await signIn(C, 'Priya Shah', 'priya@x.com'); await openTeam(C);
  ok((await C.textContent('#approvals-badge')) === '1', 'Priya’s Approvals shows 1');
  await C.click('#approvals-btn'); await C.waitForSelector('.pa-card');
  ok((await C.locator('.pa-card').textContent()).includes('Lidar sensor') && (await C.locator('.pa-card').textContent()).includes('Tom Reed'), 'the request: part, price and who asked');
  await shot(C, 'approvals');
  await C.click('.pa-card .pa-decline'); await C.waitForSelector('#pa-decline-note');
  await C.click('#pa-decline-save'); await sleep(200);
  ok((await partBy(C, 'Lidar sensor')).approval.status === 'waiting', 'declining needs a note');
  await C.fill('#pa-decline-note', 'Try the cheaper ToF sensor first'); await C.click('#pa-decline-save'); await sleep(500);
  lidar = await partBy(C, 'Lidar sensor');
  ok(lidar.approval.status === 'declined' && lidar.approval.approver === 'u_pri' && lidar.approval.note.includes('ToF'), 'declined, with her note');
  ok(await C.locator('.pa-card').count() === 0, 'gone from her list');
  await C.keyboard.press('Escape');
  await sleep(300);
  ok(await row(B, 'Lidar sensor').locator('.pa-no', { hasText: 'ToF' }).count() === 1, 'Tom sees it declined and why, live');

  step('Tom asks again; Priya approves in the Parts tool; it counts against the budget');
  await row(B, 'Lidar sensor').locator('.pa-ask').click(); await sleep(400);
  ok((await partBy(B, 'Lidar sensor')).approval.status === 'waiting', 'asked again');
  await research(C, 'parts');
  await row(C, 'Lidar sensor').locator('.pa-approve').click(); await sleep(500);
  lidar = await partBy(C, 'Lidar sensor');
  ok(lidar.approval.status === 'approved' && lidar.approval.approverName === 'Priya Shah', 'approved by Priya');
  await C.evaluate(() => { /* link it to the budget line */ });
  await research(C, 'finance');
  const committed = await C.locator('.rs-kpi', { hasText: 'Committed' }).textContent();
  ok(committed.includes('130'), 'approved spending counts as committed straight away (£120 approved + £10 ordered): ' + committed);
  ok((await C.locator('.fin-log-text').allTextContents()).some(t => t.startsWith('Approved “Lidar sensor”')), 'in the finance history');
  await B.waitForTimeout(300);
  ok(await row(B, 'Lidar sensor').locator('.pa-ok').count() === 1, 'Tom sees Approved');
  await row(B, 'Lidar sensor').locator('.pt-status').selectOption('ordered'); await sleep(500);
  ok((await partBy(B, 'Lidar sensor')).status === 'ordered', 'and now orders it');

  step('Changing an approved cost needs approving again');
  await addPart(B, 'Motor driver', 1, 60);
  await row(B, 'Motor driver').locator('.pa-ask').click(); await sleep(300);
  await research(C, 'parts'); await row(C, 'Motor driver').locator('.pa-approve').click(); await sleep(400);
  await row(B, 'Motor driver').getByRole('button', { name: 'Edit' }).click(); await B.fill('#pt-cost', '90'); await B.click('.rs-form button[type=submit]'); await sleep(500);
  const md = await partBy(B, 'Motor driver');
  ok(md.unitCost === 90 && !md.approval, 'the approval is cleared when Tom changes the cost');
  ok(await row(B, 'Motor driver').locator('.pa-ask').count() === 1, 'so he asks again');

  step('The weekly share lists purchases waiting');
  await row(B, 'Motor driver').locator('.pa-ask').click(); await sleep(400);
  await B.keyboard.press('Escape'); await sleep(200);
  await B.evaluate(() => TT.openShare()); await B.waitForSelector('#share-scope'); await sleep(200);
  const text = await B.inputValue('.modal textarea');
  ok(text.includes('Waiting for purchase approval* (1)') && text.includes('Motor driver') && text.includes('£90'), 'share: ' + text.split('\n').filter(l => l.includes('purchase') || l.includes('Motor')).join(' / '));
  await B.keyboard.press('Escape'); await sleep(200);

  step('Automatic: all its parts received → the task moves to Doing');
  await research(B, 'parts');
  await addPart(B, 'Steel box section', 2, 12);
  await addPart(B, 'Welding rods', 1, 8);
  await B.evaluate(() => {   // link both to "Weld the frame"
    const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const T = Object.values(s.teams)[0];
    Object.values(T.parts).filter(p => ['Steel box section', 'Welding rods'].includes(p.name)).forEach(p => { p.taskId = 't_frame'; });
    localStorage.setItem(k, JSON.stringify(s));
  });
  await B.reload(); await B.waitForSelector('.task-card'); await sleep(500); await research(B, 'parts');
  await row(B, 'Steel box section').locator('.pt-status').selectOption('received'); await sleep(1500);
  ok(!(await team(B)).tasks.t_frame.stage, 'one part still to come: the task stays');
  await row(B, 'Welding rods').locator('.pt-status').selectOption('received'); await sleep(2000);
  const fr = (await team(B)).tasks.t_frame;
  ok(fr.stage === 'doing', 'both received: “Weld the frame” moved to Doing');
  ok(fr.history.filter(h => h.updated.includes('automatic')).length === 1, 'one history line saying so (whichever app saw it first): ' + JSON.stringify(fr.history[0]));
  await B.keyboard.press('Escape'); await sleep(200);

  step('Automatic: a task is done → the people waiting on it are told');
  await B.evaluate(() => { const l = window.boardLocate('t_frame'); l.task.flag = 'completed'; l.task.completedDate = new Date().toLocaleDateString('en-CA'); TT.commit(); });
  await sleep(1200);
  const cms = Object.values((await team(B)).comments || {});
  const toAisha = cms.find(c => c.taskId === 't_wire');
  ok(toAisha && toAisha.mentions.length === 1 && toAisha.text.includes('“Weld the frame” is done') && toAisha.authorUid === 'u_tom', 'a comment on Aisha’s waiting task, @mentioning her');
  const own = cms.find(c => c.taskId === 't_wheels');
  ok(own && own.mentions.length === 0, 'Tom’s own waiting task gets a note without a mention');
  await sleep(500);
  ok(Number(await A.textContent('#activity-badge').catch(() => '0')) >= 1, 'Aisha’s Activity shows the mention');

  step('Automatic: a sign-off waiting too long → a reminder');
  await A.evaluate(() => {
    const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const T = Object.values(s.teams)[0];
    T.doc.workflow = { stages: [{ id: 'todo', name: 'To do', kind: 'todo' }, { id: 'review', name: 'Review', kind: 'doing', signoff: 'admin' }, { id: 'done', name: 'Done', kind: 'done' }], moved: {} };
    T.doc.autos = { partsTo: '', tellWaiting: true, remindDays: 3 };
    T.tasks.t_wheels.stage = 'review';
    T.tasks.t_wheels.signoff = { stage: 'review', status: 'waiting', by: 'u_tom', byName: 'Tom Reed', at: Date.now() - 5 * 864e5, approver: '', approverName: '', note: '', decidedAt: 0 };
    localStorage.setItem(k, JSON.stringify(s));
  });
  await B.reload(); await B.waitForSelector('.task-card'); await sleep(2500);
  T = await team(B);
  const rem = Object.values(T.comments).find(c => c.taskId === 't_wheels' && c.text.startsWith('⏰'));
  ok(rem && rem.mentions.includes('u_pri') && rem.text.includes('5 days'), 'Tom’s app reminds Priya (an admin): ' + (rem ? rem.text : 'none'));
  ok(T.tasks.t_wheels.signoff.remindedAt > Date.now() - 60e3, 'and notes when');
  await B.reload(); await B.waitForSelector('.task-card'); await sleep(2000);
  ok(Object.values((await team(B)).comments).filter(c => c.taskId === 't_wheels' && c.text.startsWith('⏰')).length === 1, 'only once, not on every load');

  step('Rules: Tom can’t approve, even by writing directly');
  const denied = await B.evaluate(async () => {
    const T = Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]; const id = Object.entries(T.parts).find(([, p]) => p.name === 'Motor driver')[0];
    const before = T.parts[id];
    try { await TT.writeOps([{ type: 'update', path: 'parts/' + id, data: { status: 'ordered', approval: { ...before.approval, status: 'approved', approver: 'u_tom', approverName: 'Tom', decidedAt: Date.now() } } }]); } catch (e) { return 'threw'; }
    return Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0].parts[id].status;
  }).catch(() => 'n/a');
  ok(denied !== 'ordered', 'not saved (' + denied + ')');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 8).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
