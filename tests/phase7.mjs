// Phase 7 in demo mode: Research ▸ Meetings (actions → tasks), Parts, Finance (role-gated),
// Literature (DOI lookup, BibTeX), the lab notebook on tasks, and carried-forward chains
// (edits flow forward; analytics, timeline, Kanban and My tasks show the chain once).
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const iso = (d, base = new Date()) => { const x = new Date(base); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };
const monday = () => { const x = new Date(); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toLocaleDateString('en-CA'); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVR42mNk+M9Qz0AEYBxVSF+FDP8ZGP4zMDIyMjIwMjIyAAAk6wQB9p8iGwAAAABJRU5ErkJggg==', 'base64');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.route('https://api.crossref.org/**', (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
  body: JSON.stringify({ message: { title: ['Learning dexterous in-hand manipulation'], author: [{ given: 'Marcin', family: 'Andrychowicz' }, { given: 'Bowen', family: 'Baker' }], issued: { 'date-parts': [[2020]] }, 'container-title': ['The International Journal of Robotics Research'], URL: 'https://doi.org/10.1177/0278364919887447' } }) }));
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const team = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const list = async (p, coll) => Object.entries((await team(p))[coll] || {}).map(([id, v]) => ({ ...v, id }));
const tasksNamed = async (p, name) => (await list(p, 'tasks')).filter(t => t.name === name);
const card = (p, name, i = 0) => p.locator('.task-card', { hasText: name }).nth(i);
async function openCard(p, name, i = 0) { await card(p, name, i).evaluate(e => e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })); await card(p, name, i).click(); await sleep(300); }
const research = async (p, t) => { if (!(await p.locator('.research-modal').count())) { await p.click('#research-btn'); await p.waitForSelector('.research-modal'); } await p.click(`.rs-tab[data-tab="${t}"]`); await sleep(250); };
const closeModal = async (p) => { await p.keyboard.press('Escape'); await sleep(200); };
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/phase7-${n}.png` }); };

try {
  step('Set up: owner, member and viewer; three dated weeks');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Robot Science'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate((m) => {
    const add = (n) => { const x = new Date(m); x.setDate(x.getDate() + 7 * n); return x.toLocaleDateString('en-CA'); };
    weeksData[0].startDate = m; weeksData.push({ key: 'wk_two', title: 'WEEK 2', metric: '', collapsed: false, startDate: add(1) }, { key: 'wk_three', title: 'WEEK 3', metric: '', collapsed: false, startDate: add(2) });
    db.forEach(p => p.categories.forEach(c => { c.wk_two = c.wk_two || []; c.wk_three = c.wk_three || []; }));
    const c = db.find(x => x.id === TT.me.uid).categories[0];
    c[weeksData[0].key] = [{ id: 'tA', type: 'task', name: 'Build gripper', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [] }];
    saveDatabase(); render();
  }, monday());
  await A.evaluate(() => TT.setFeatures({ parts: true, finance: true })); await sleep(300);
  await A.click('#top-actions button:has-text("Invite")');
  await A.fill('.settings-pane textarea', 'tom@uni.ac.uk'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(200);
  await A.fill('.settings-pane textarea', 'priya@uni.ac.uk'); await A.locator('.settings-pane form select').selectOption('viewer'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(200);
  await A.keyboard.press('Escape'); await sleep(200);
  const B = await tab('Tom'); await signIn(B, 'Tom Reed', 'tom@uni.ac.uk');
  await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat'); await sleep(500);
  await A.bringToFront();

  step('Research opens with four tabs');
  await A.click('#research-btn'); await A.waitForSelector('.research-modal');
  ok((await A.locator('.rs-tab').allTextContents()).join('|') === '📝 Meetings|🔩 Parts|💷 Finance|📚 Literature', 'Meetings · Parts · Finance · Literature');

  step('Meetings: notes → action items → tasks');
  await A.click('#mt-new'); await sleep(400);
  ok((await list(A, 'meetings')).length === 1, 'new meeting saved');
  await A.fill('#mt-title', 'Supervisor meeting'); await A.press('#mt-title', 'Tab'); await sleep(300);
  await A.fill('#mt-notes', 'Agenda\n- gripper design\n\nActions\n- [ ] Order servos @Tom Reed by ' + iso(9) + '\nTODO: draft the methods section'); await A.locator('#mt-notes').blur(); await sleep(400);
  await A.click('button:has-text("Find actions in notes")'); await sleep(500);
  let mt = (await list(A, 'meetings'))[0];
  ok(mt.title === 'Supervisor meeting' && mt.notes.includes('Order servos'), 'title and notes saved');
  ok(mt.actions.length === 2 && mt.actions[0].text === 'Order servos' && mt.actions[0].dueDate === iso(9), 'two actions found, with the due date');
  const tomUid = (await team(A)).members && Object.values((await team(A)).members).find(m => m.email === 'tom@uni.ac.uk').uid;
  ok(mt.actions[0].ownerUid === tomUid, '@Tom Reed made Tom the owner');
  // Aisha (owner, edits everyone's tasks) creates Tom's task
  await A.locator('.mtg-act').nth(0).locator('button:has-text("Create task")').click(); await sleep(500);
  let t = (await tasksNamed(A, 'Order servos'))[0];
  ok(t && t.ownerUid === tomUid && t.dueDate === iso(9) && t.weekId === 'wk_two', 'task created in Tom’s row, in the week of its due date');
  ok(t && t.history.some(h => h.updated.includes('From meeting “Supervisor meeting”')), 'task remembers which meeting it came from');
  mt = (await list(A, 'meetings'))[0];
  ok(mt.actions[0].taskId === t.id, 'action linked to its task');
  ok(await A.locator('.mtg-act').nth(0).locator('.rs-chip', { hasText: 'Order servos' }).isVisible(), 'action shows the task chip');
  await A.locator('.mtg-act').nth(1).locator('button:has-text("Create task")').click(); await sleep(500);
  ok((await tasksNamed(A, 'draft the methods section'))[0].ownerUid !== tomUid, 'an action without an owner goes to the person creating it');
  await shot(A, 'meetings');

  step('Parts');
  await research(A, 'parts');
  await A.click('#pt-new'); await sleep(120); await A.fill('#pt-name', 'Servo MG996R'); await A.fill('#pt-qty', '4'); await A.fill('#pt-cost', '6.50');
  await A.click('.rs-form button[type=submit]'); await sleep(400);
  let parts = await list(A, 'parts');
  ok(parts.length === 1 && parts[0].qty === 4 && parts[0].unitCost === 6.5 && parts[0].status === 'needed', 'part saved: 4 × £6.50, needed');
  ok((await A.locator('.rs-table tr', { hasText: 'Servo MG996R' }).textContent()).includes('26'), 'row shows the £26 total');
  await A.locator('.pt-status').first().selectOption('ordered'); await sleep(400);
  ok((await list(A, 'parts'))[0].orderedDate === iso(0), 'marking it ordered stamps the date');

  step('Finance: budget, committed, spending from a received part');
  await research(A, 'finance');
  ok((await A.locator('.rs-kpi', { hasText: 'Committed' }).textContent()).includes('26'), 'an ordered part shows as committed money');
  await A.click('#fin-add-line'); await sleep(400);
  await A.locator('.fin-line-name').first().fill('Components'); await A.locator('.fin-line-name').first().press('Tab'); await sleep(300);
  await A.locator('.fin-line-amount').first().fill('500'); await A.locator('.fin-line-amount').first().press('Tab'); await sleep(400);
  let fin = (await team(A)).finance;
  ok(fin && fin.budget && fin.budget.lines[0].name === 'Components' && fin.budget.lines[0].amount === 500, 'budget line saved');
  await research(A, 'parts');
  await A.locator('.pt-status').first().selectOption('received'); await sleep(500);
  const rec = A.locator('.toast button', { hasText: 'as spending' });
  ok(await rec.isVisible(), 'receiving a part offers to record the spending');
  await rec.click(); await sleep(500);
  let ex = await list(A, 'expenses');
  ok(ex.length === 1 && ex[0].amount === 26 && ex[0].partId === parts[0].id, 'spending recorded from the part');
  await research(A, 'finance');
  ok((await A.locator('.rs-kpi', { hasText: 'Committed' }).textContent()).includes('0'), 'no longer committed once paid for');
  await A.click('#fin-add-expense'); await A.fill('#tx-amount', '40'); await A.fill('#tx-desc', '3D printing filament'); await A.selectOption('#tx-line', { label: 'Components' });
  await A.click('.rs-form button[type=submit]'); await sleep(400);
  await A.click('#fin-add-income'); await A.fill('#tx-amount', '1000'); await A.fill('#tx-desc', 'Department project grant'); await A.click('.rs-form button[type=submit]'); await sleep(400);
  ex = await list(A, 'expenses');
  ok(ex.length === 3 && ex.some(x => x.kind === 'income' && x.amount === 1000), 'spending and income recorded');
  ok((await A.locator('.rs-kpi', { hasText: 'Remaining' }).textContent()).includes('434'), 'remaining = 500 − 26 − 40 (all spending counts, even without a budget line)');
  ok(await A.locator('svg.fin-chart path.fin-spent').count() === 1 && (await A.locator('.fin-forecast').textContent()).includes('last 8 weeks'), 'spending chart and forecast');
  await shot(A, 'finance');
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('button:has-text("Export (.xlsx)")')]);
  ok(/Finance_.*\.xlsx$/.test(dl.suggestedFilename()), 'finance exports to Excel');

  step('Finance is hidden from roles without permission');
  await B.bringToFront(); await B.click('#research-btn'); await B.waitForSelector('.research-modal'); await B.click('.rs-tab[data-tab="finance"]'); await sleep(300);
  ok((await B.locator('.rs-pane').textContent()).includes('Only roles with'), 'Tom (member) sees a lock, not the money');
  ok((await B.locator('.rs-kpi').count()) === 0, 'no totals shown to Tom');
  await B.click('.rs-tab[data-tab="parts"]'); await sleep(250); await B.locator('.rs-bar select').first().selectOption('all'); await sleep(200);
  ok((await B.locator('.rs-pane').textContent()).includes('Servo MG996R'), 'Tom still sees the parts list');
  await closeModal(B);
  await A.bringToFront();

  step('Literature: DOI, BibTeX, links to tasks');
  await research(A, 'literature');
  await A.fill('#lit-doi', 'https://doi.org/10.1177/0278364919887447'); await A.click('#lit-doi-add'); await sleep(600);
  let papers = await list(A, 'papers');
  ok(papers.length === 1 && papers[0].title === 'Learning dexterous in-hand manipulation' && papers[0].year === 2020 && papers[0].authors === 'Marcin Andrychowicz, Bowen Baker', 'DOI looked up on Crossref and filled in');
  await A.click('#lit-bib-in'); await A.fill('#bib-text', '@article{lee2023, title={Soft robotic grippers}, author={Lee, Ann and Kim, Joon}, year={2023}, journal={Soft Robotics}}');
  await A.click('#bib-go'); await sleep(500);
  ok((await list(A, 'papers')).length === 2, 'BibTeX imported');
  await A.locator('.lit-item', { hasText: 'Soft robotic grippers' }).locator('.lit-status').selectOption('read'); await sleep(300);
  ok((await list(A, 'papers')).find(p => p.title === 'Soft robotic grippers').status === 'read', 'reading status saved');
  await A.locator('.lit-item', { hasText: 'Soft robotic grippers' }).locator('button:has-text("Task")').click(); await A.waitForSelector('.cmdk-input');
  await A.fill('.cmdk-input', 'gripper'); await sleep(150); await A.keyboard.press('Enter'); await sleep(400);
  ok((await list(A, 'papers')).find(p => p.title === 'Soft robotic grippers').taskIds.includes('tA'), 'source linked to the Build gripper task');
  const [bib] = await Promise.all([A.waitForEvent('download'), A.click('#lit-bib-out')]);
  ok(bib.suggestedFilename().endsWith('.bib'), 'BibTeX download');
  await shot(A, 'literature');
  await closeModal(A);

  step('Lab notebook on a task');
  await openCard(A, 'Build gripper');
  ok((await A.locator('#edit-form .linked-section').textContent()).includes('Soft robotic grippers'), 'editor lists linked sources');
  await A.fill('.nb-section .nb-text', 'Printed finger v2 — 0.2 mm layers, PLA. Grip force 4.1 N.');
  await A.locator('.nb-section .nb-composer input[type=file]').setInputFiles({ name: 'rig.png', mimeType: 'image/png', buffer: PNG }); await sleep(400);
  ok(await A.locator('.nb-section .nb-composer .nb-thumb img').count() === 1, 'photo attached');
  await A.click('.nb-section button:has-text("Add entry")'); await sleep(500);
  let nb = await list(A, 'notebook');
  ok(nb.length === 1 && nb[0].taskId === 'tA' && nb[0].images.length === 1 && nb[0].text.includes('4.1 N'), 'entry saved with its photo');
  ok((await card(A, 'Build gripper').locator('.nb-chip').textContent()) === '📓 1', 'card shows 📓 1');
  ok(await A.locator('.nb-entry .nb-body', { hasText: '4.1 N' }).isVisible(), 'entry shown in the editor');
  await A.locator('.nb-entry button:has-text("Edit")').click(); await A.locator('.nb-entry textarea').fill('Printed finger v2 — grip force 4.3 N after re-test.');
  await A.locator('.nb-entry button:has-text("Save")').click(); await sleep(400);
  nb = await list(A, 'notebook');
  ok(nb[0].text.includes('4.3 N') && nb[0].editedAt > 0, 'author can edit the entry');
  await shot(A, 'notebook');
  await B.bringToFront(); await openCard(B, 'Build gripper');
  ok(await B.locator('.nb-entry button:has-text("Edit")').count() === 0, 'Tom can’t edit Aisha’s entry');
  await B.fill('.nb-section .nb-text', 'Checked the servo horn fit — OK.'); await B.click('.nb-section button:has-text("Add entry")'); await sleep(500);
  ok((await list(B, 'notebook')).length === 2, 'Tom adds his own entry');
  await A.bringToFront();

  step('Carry forward: copies are linked, edits flow forward');
  await A.keyboard.press('Escape');
  await card(A, 'Build gripper').click({ button: 'right' }); await sleep(250);
  await A.locator('#quick-menu.active .qm-btn', { hasText: 'Carry forward' }).click(); await sleep(500);
  await card(A, 'Build gripper', 1).click({ button: 'right' }); await sleep(250);
  await A.locator('#quick-menu.active .qm-btn', { hasText: 'Carry forward' }).click(); await sleep(500);
  let chain = await tasksNamed(A, 'Build gripper');
  ok(chain.length === 3 && chain.filter(x => x.carryOf === 'tA').length === 2, 'two carried copies, both linked to the original');
  ok((await card(A, 'Build gripper', 2).locator('.carry-chip').textContent()) === '↪ week 3 of 3', 'cards show “↪ week 3 of 3”');
  await openCard(A, 'Build gripper', 0);
  ok((await A.locator('#edit-form .carry-note').textContent()).includes('week 1 of 3') && await A.locator('#edit-form .carry-step').count() === 3, 'editor shows the chain of weeks');

  step('Everything linked to a task follows it when carried forward');
  const lastCopy = chain.find(x => x.id !== 'tA' && x.weekId === 'wk_three') || chain[2];
  await A.keyboard.press('Escape'); await openCard(A, 'Build gripper', 2);
  ok((await A.locator('#edit-form .linked-section').textContent()).includes('Soft robotic grippers'), 'the week-3 copy lists the paper linked to the original');
  ok(await A.locator('#edit-form .nb-entry').count() === 2 && (await A.locator('#edit-form .nb-from').first().textContent()).startsWith('↪'), 'and both notebook entries, each marked with its week');
  ok((await card(A, 'Build gripper', 2).locator('.nb-chip').textContent()) === '📓 2', 'the copy’s card shows 📓 2');
  ok(await A.evaluate(async (id) => { await TT.writeOps([{ type: 'set', path: 'comments/cfc1', data: { taskId: 'tA', authorUid: TT.me.uid, authorName: 'Aisha', text: 'Check the servo torque first', mentions: [], createdAt: Date.now() } }]); await new Promise(r => setTimeout(r, 300)); return TT.commentCount(id); }, lastCopy.id) === 1, 'a comment on week 1 counts on the week-3 copy');
  await A.keyboard.press('Escape'); await openCard(A, 'Build gripper', 2); await sleep(200);
  ok((await A.locator('#edit-form').textContent()).includes('Check the servo torque first'), 'and shows in its comment thread');
  const dep = await A.evaluate(() => { const other = allTaskLocs().find(l => !/^Build gripper/.test(l.task.name)); const loc = locateTask('tA'); loc.task.dependsOn = [other.task.id]; saveDatabase(); render(); return other.task.id; }); await sleep(500);
  ok((await tasksNamed(A, 'Build gripper')).every(x => (x.dependsOn || []).includes(dep)), '“waits on” is carried to every later copy');
  await A.evaluate(() => { const loc = locateTask('tA'); loc.task.dependsOn = []; saveDatabase(); render(); }); await sleep(400);
  await A.keyboard.press('Escape');
  await A.evaluate(() => { const loc = locateTask('tA'); logHistory(loc.task, 'Priority', loc.task.priority, 'Critical'); loc.task.priority = 'Critical'; loc.task.name = 'Build gripper v2'; saveDatabase(); render(); }); await sleep(600);
  chain = await tasksNamed(A, 'Build gripper v2');
  ok(chain.length === 3 && chain.every(x => x.priority === 'Critical'), 'renaming and re-prioritising the original updates every later copy');
  ok(chain.filter(x => x.id !== 'tA').every(x => x.history.some(h => h.field === 'Carried update')), 'copies log where the change came from');
  // edit the middle copy: only the later one follows
  const mid = chain.find(x => x.weekId === 'wk_two');
  await A.evaluate((id) => { const loc = locateTask(id); loc.task.status = 'Testing'; saveDatabase(); render(); }, mid.id); await sleep(500);
  chain = await tasksNamed(A, 'Build gripper v2');
  ok(chain.find(x => x.weekId === 'wk_three').status === 'Testing' && chain.find(x => x.id === 'tA').status !== 'Testing', 'a change flows forward, never back');
  // completion stays per week
  await A.evaluate(() => { const loc = locateTask('tA'); loc.task.flag = 'completed'; stampCompletion(loc.task); saveDatabase(); render(); }); await sleep(500);
  chain = await tasksNamed(A, 'Build gripper v2');
  ok(chain.filter(x => x.flag === 'completed').length === 1, 'marking one week done doesn’t complete the later copies');
  await A.evaluate(() => { const loc = locateTask('tA'); loc.task.flag = 'none'; stampCompletion(loc.task); saveDatabase(); render(); }); await sleep(400);

  step('Older copies (made before linking) are recognised by their history');
  await A.evaluate(() => {
    const c = db.find(x => x.id === TT.me.uid).categories[0];
    const h = [{ time: 'x', user: 'Aisha', field: 'Action', original: 'WEEK 1', updated: 'Carried forward to WEEK 2' }];
    c[weeksData[0].key].push({ id: 'oldA', type: 'task', name: 'RRTM paper', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [], dueDate: '' });
    c.wk_two.push({ id: 'oldB', type: 'task', name: 'RRTM paper', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: h, dueDate: '' });
    c.wk_three.push({ id: 'oldC', type: 'task', name: 'RRTM paper', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: h.concat([{ ...h[0], updated: 'Carried forward to WEEK 3' }]), dueDate: '' });
    saveDatabase(); render();
  }); await sleep(500);
  await A.evaluate((d) => { const loc = locateTask('oldA'); loc.task.dueDate = d; saveDatabase(); render(); }, iso(30)); await sleep(500);
  const old = await tasksNamed(A, 'RRTM paper');
  ok(old.every(x => x.dueDate === iso(30)), 'editing the first one updates the old copies too');
  ok(old.filter(x => x.id !== 'oldA').every(x => x.carryOf === 'oldA'), 'and links them for the future');

  step('Analytics, timeline, Kanban and My tasks show a chain once');
  await A.evaluate(() => { showEverything(); openAnalytics('timeline'); }); await sleep(500);
  const rrtmRows = await A.locator('#an-body .gt-label', { hasText: 'RRTM paper' }).count();
  ok(rrtmRows === 1, 'timeline: one row for the 3-week task (got ' + rrtmRows + ')');
  ok((await A.locator('#an-body .gt-label', { hasText: 'RRTM paper' }).locator('.gt-carry').textContent()) === '↪ 3 wks', 'labelled “↪ 3 wks”');
  await shot(A, 'timeline');
  await A.click('.an-tab[data-tab="overview"]'); await sleep(300);
  const total = await A.evaluate(() => window.boardKpis().total);
  ok(total === 4, 'overview counts 4 tasks (2 chains + 2 meeting tasks), not 8 (got ' + total + ')');
  await A.keyboard.press('Escape'); await sleep(200);
  await A.evaluate(() => boardSetView('kanban')); await sleep(400);
  ok(await A.locator('.kb-card', { hasText: 'RRTM paper' }).count() === 1 && (await A.locator('.kb-card', { hasText: 'RRTM paper' }).locator('.kb-carry').textContent()).includes('3 wks'), 'Kanban shows it once, with ↪ 3 wks');
  await A.evaluate(() => boardSetView('board')); await sleep(300);
  await A.evaluate(() => TT.goHome()); await A.waitForSelector('#home-screen:not([hidden])'); await sleep(600);
  const myRows = await A.locator('#mytasks .mt-row', { hasText: 'RRTM paper' }).count().catch(() => -1);
  ok(myRows === 1, 'My tasks lists it once (got ' + myRows + ')');

  step('Permissions');
  const V = await tab('Priya'); await signIn(V, 'Priya Shah', 'priya@uni.ac.uk');
  await V.click('#invites-list button:has-text("Join team")'); await V.waitForSelector('.node-cat'); await sleep(500);
  await V.click('#research-btn'); await V.waitForSelector('.research-modal');
  ok(await V.locator('#mt-new').count() === 0 && await V.locator('#mt-title').isDisabled(), 'viewer reads meetings but can’t write');
  await V.click('.rs-tab[data-tab="parts"]'); await sleep(200);
  ok(await V.locator('#pt-new').count() === 0 && await V.locator('.pt-status').count() === 0, 'viewer can’t change parts');
  await closeModal(V);
  // owner lets members see finances
  await A.locator('.team-tile').first().click(); await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(() => { const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const t = Object.values(s.teams)[0]; t.doc.roles.member.perms['finance.view'] = true; localStorage.setItem(k, JSON.stringify(s)); });
  await B.reload(); await B.waitForSelector('#home-screen:not([hidden]), .node-cat');
  if (await B.locator('#home-screen:not([hidden])').isVisible()) { await B.locator('.team-tile').first().click(); await B.waitForSelector('.node-cat'); }
  await sleep(500);
  await B.click('#research-btn'); await B.waitForSelector('.research-modal'); await B.click('.rs-tab[data-tab="finance"]'); await sleep(400);
  ok((await B.locator('.rs-kpi', { hasText: 'Spent' }).textContent()).includes('66'), 'with “See finances”, Tom sees the money (£26 + £40 spent)');
  ok(await B.locator('#fin-add-expense').count() === 0, '…but can’t record spending without “Manage finances”');
  await closeModal(B);

  step('Existing teams get the new finance permissions for Admins');
  await A.evaluate(() => { const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const t = Object.values(s.teams)[0]; delete t.doc.roles.admin.perms['finance.view']; delete t.doc.roles.admin.perms['finance.edit']; localStorage.setItem(k, JSON.stringify(s)); });
  await A.reload(); await A.waitForSelector('#home-screen:not([hidden]), .node-cat');
  if (await A.locator('#home-screen:not([hidden])').isVisible()) { await A.locator('.team-tile').first().click(); await A.waitForSelector('.node-cat'); }
  await sleep(800);
  const adminPerms = (await team(A)).doc.roles.admin.perms;
  ok(adminPerms['finance.view'] === true && adminPerms['finance.edit'] === true, 'Admin role given See/Manage finances when the owner opens the team');
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
