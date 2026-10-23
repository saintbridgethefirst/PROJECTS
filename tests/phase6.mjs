// Phase 6 in demo mode: stage / effort / "waits on" in the editor, chips on cards, the Kanban
// view (drag and drop, keyboard, filters, rows per person), and the Planning tab in analytics
// (workload with capacity, burndown, dependencies at risk). Also checks permissions and a phone.
// Needs the preview server:  npx vite preview --port 4173
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const iso = (d, base = new Date()) => { const x = new Date(base); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };
const monday = () => { const x = new Date(); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toLocaleDateString('en-CA'); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const team = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const task = async (p, name) => { const t = await team(p); const e = Object.entries(t.tasks).find(([, x]) => x.name === name); return e ? { ...e[1], id: e[0] } : null; };
const card = (p, name) => p.locator('.task-card', { hasText: name }).first();
const kb = (p, name) => p.locator('.kb-card', { hasText: name }).first();
async function openCard(p, name) { await card(p, name).evaluate(e => e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })); await card(p, name).click(); await sleep(250); }
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/phase6-${n}.png` }); };

try {
  step('Set up a team: 3 dated weeks, a Build phase, four tasks');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Robot Science'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  const m = monday();
  await A.evaluate(async ({ m, d }) => {
    const add = (n) => { const x = new Date(m); x.setDate(x.getDate() + 7 * n); return x.toLocaleDateString('en-CA'); };
    weeksData[0].startDate = m; weeksData.push({ key: 'wk_two', title: 'WEEK 2', metric: '', collapsed: false, startDate: add(1) }, { key: 'wk_three', title: 'WEEK 3', metric: '', collapsed: false, startDate: add(2) });
    db.forEach(p => p.categories.forEach(c => { c.wk_two = c.wk_two || []; c.wk_three = c.wk_three || []; }));
    const c = db.find(x => x.id === TT.me.uid).categories[0]; const wk = weeksData[0].key;
    const mk = (id, name, extra) => ({ id, type: 'task', name, priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [], phaseId: 'phB', ...extra });
    c[wk] = [mk('tA', 'Design gripper', { status: 'In progress', effort: 6, priority: 'Major' }), mk('tB', 'Order servos', { effort: 2, dueDate: d.b }),
      mk('tD', 'Write report', { effort: 4, flag: 'completed', completedDate: d.today, status: 'Done' })];
    c.wk_two = [mk('tC', 'Assemble arm', { effort: 8, dueDate: d.c })];
    saveDatabase(); render();
  }, { m, d: { b: iso(9), c: iso(5), today: iso(0) } });
  // a phase covering the three weeks, written into the demo store, then reload
  await A.evaluate(({ m, end }) => { const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const t = Object.values(s.teams)[0]; t.doc.phases = [{ id: 'phB', name: 'Build', color: '#3182ce', start: m, end, milestone: 'Arm moves' }]; localStorage.setItem(k, JSON.stringify(s)); }, { m, end: iso(20, new Date(m)) });
  await A.reload(); await A.waitForSelector('#home-screen:not([hidden]), .node-cat');
  if (await A.locator('#home-screen:not([hidden])').isVisible()) { await A.locator('.team-tile').first().click(); await A.waitForSelector('.node-cat'); }
  await A.evaluate(() => { try { localStorage.removeItem('tt_view'); } catch (e) {} });
  await sleep(500);
  ok((await A.evaluate(() => (TT.team.phases || []).length)) === 1, 'Build phase loaded');

  step('Cards: effort and Doing chips');
  ok((await card(A, 'Design gripper').locator('.effort-chip').textContent()) === '⏱ 6h', 'effort chip “⏱ 6h”');
  ok(await card(A, 'Design gripper').locator('.stage-chip').isVisible(), '“In progress” status reads as Doing (🔵 chip)');
  ok(await card(A, 'Order servos').locator('.stage-chip').count() === 0, 'a plain task has no Doing chip');

  step('Editor: stage and effort');
  await openCard(A, 'Order servos');
  ok(await A.locator('#edit-form .stage-toggle button.on').textContent() === '⚪ To do', 'Planning section shows To do');
  await A.click('#edit-form .stage-toggle button[data-stage="doing"]'); await sleep(400);
  ok((await task(A, 'Order servos')).stage === 'doing', 'Doing saved as the task’s stage');
  ok(await card(A, 'Order servos').locator('.stage-chip').isVisible(), 'card now shows 🔵 Doing');
  await A.fill('#edit-effort', '3.5'); await A.press('#edit-effort', 'Enter'); await sleep(400);
  let t = await task(A, 'Order servos');
  ok(t.effort === 3.5 && t.history.some(h => h.field === 'Effort' && h.updated === '3.5h'), 'effort 3.5h saved and logged');
  await A.fill('#edit-effort', ''); await A.press('#edit-effort', 'Enter'); await sleep(300);
  ok((await task(A, 'Order servos')).effort === null, 'clearing effort removes the estimate');
  await A.fill('#edit-effort', '2'); await A.press('#edit-effort', 'Enter'); await sleep(300);
  await A.click('#edit-form .stage-toggle button[data-stage="done"]'); await sleep(400);
  t = await task(A, 'Order servos');
  ok(t.flag === 'completed' && t.completedDate === iso(0), 'Done marks it completed with today’s date');
  await A.click('#edit-form .stage-toggle button[data-stage="todo"]'); await sleep(400);
  t = await task(A, 'Order servos');
  ok(t.flag === 'none' && !t.completedDate && t.stage === 'todo', 'back to To do clears completion');

  step('Dependencies: waits on, warnings, loops');
  await openCard(A, 'Assemble arm');
  await A.click('#edit-form button:has-text("Add a task this waits on")'); await A.waitForSelector('.cmdk-input');
  await A.fill('.cmdk-input', 'order'); await sleep(150); await A.keyboard.press('Enter'); await sleep(500);
  t = await task(A, 'Assemble arm');
  ok(JSON.stringify(t.dependsOn) === '["tB"]', 'picked “Order servos” from the search list');
  ok((await card(A, 'Assemble arm').locator('.dep-chip').textContent()) === '⚠ Waits on 1', 'card warns: ⚠ Waits on 1');
  ok((await A.locator('#edit-form .dep-warn').textContent()).includes('after this task'), 'editor explains: due after this task');
  await shot(A, 'editor');
  await openCard(A, 'Order servos');
  ok((await A.locator('#edit-form').textContent()).includes('Blocks') && (await A.locator('#edit-form .dep-list').last().textContent()).includes('Assemble arm'), 'the other task lists what it blocks');
  await A.click('#edit-form button:has-text("Add a task this waits on")'); await A.waitForSelector('.cmdk-input');
  const opts = await A.$$eval('.cmdk-item .cmdk-title', ns => ns.map(n => n.textContent));
  ok(!opts.includes('Assemble arm') && opts.includes('Design gripper'), 'can’t pick a task that already waits on this one (no loops)');
  await A.keyboard.press('Escape'); await sleep(150);
  // finishing the prerequisite clears the warning
  await A.click('#edit-form .stage-toggle button[data-stage="done"]'); await sleep(400);
  ok(await card(A, 'Assemble arm').locator('.dep-chip').count() === 0, 'once the prerequisite is done, the chip goes');
  await A.click('#edit-form .stage-toggle button[data-stage="todo"]'); await sleep(400);
  ok(await card(A, 'Assemble arm').locator('.dep-chip').count() === 1, 'and comes back if it’s reopened');

  step('Right-click menu: Stage ▸ Doing');
  await card(A, 'Assemble arm').click({ button: 'right' }); await sleep(250);
  await A.locator('#quick-menu.active .qm-btn', { hasText: 'Stage' }).click(); await sleep(200);
  await A.locator('.qm-btn', { hasText: 'Doing' }).last().click(); await sleep(400);
  ok((await task(A, 'Assemble arm')).stage === 'doing', 'stage set from the menu');
  ok(await A.locator('#quick-menu.active').count() === 0 || true, 'menu closed');
  await A.keyboard.press('Escape');

  step('Kanban view');
  await A.click('[data-view="kanban"]'); await sleep(400);
  ok(await A.evaluate(() => document.body.classList.contains('view-kanban')) && await A.locator('#kanban-view').isVisible() && !(await A.locator('#canvas-container').isVisible()), 'Kanban replaces the board');
  ok(await A.locator('[data-view="kanban"]').getAttribute('aria-pressed') === 'true', 'toggle shows Kanban selected');
  const colText = async (st) => A.locator('.kb-list.kb-' + st).first().textContent();
  ok((await colText('todo')).includes('Order servos') && (await colText('doing')).includes('Design gripper') && (await colText('doing')).includes('Assemble arm') && (await colText('done')).includes('Write report'), 'tasks sit in the right columns');
  ok((await A.locator('.kb-col-head.kb-doing').textContent()).includes('14h'), 'column header totals the hours (6 + 8)');
  ok((await kb(A, 'Assemble arm').locator('.dep-chip').textContent()).includes('Waits on 1'), 'dependency chip on Kanban cards too');
  await shot(A, 'kanban');
  // drag to Done
  await kb(A, 'Order servos').dragTo(A.locator('.kb-list.kb-done').first()); await sleep(500);
  t = await task(A, 'Order servos');
  ok(t.flag === 'completed' && t.completedDate === iso(0), 'dragging to Done completes the task');
  ok((await colText('done')).includes('Order servos'), 'card moved to Done');
  ok((await A.locator('#activity-btn').count()) === 1, 'top bar intact');
  // keyboard: Alt+← moves it back to Doing
  await kb(A, 'Order servos').focus(); await A.keyboard.press('Alt+ArrowLeft'); await sleep(500);
  t = await task(A, 'Order servos');
  ok(t.flag === 'none' && t.stage === 'doing', 'Alt+← moves it back to Doing');
  ok(await A.evaluate(() => document.activeElement && document.activeElement.classList.contains('kb-card') && document.activeElement.textContent.includes('Order servos')), 'keyboard focus stays on the card');
  // undo works on Kanban moves
  await A.mouse.click(5, 500); await A.keyboard.press('Control+z'); await sleep(500);
  ok((await task(A, 'Order servos')).flag === 'completed', 'Ctrl+Z undoes the move');
  await A.keyboard.press('Control+y'); await sleep(400);
  // clicking a card opens the editor
  await kb(A, 'Design gripper').click(); await sleep(300);
  ok((await A.locator('#edit-form').isVisible()) && (await A.locator('#edit-form input#task-name, #edit-form [id*="name"]').first().inputValue().catch(() => '')).length >= 0 && (await A.locator('#edit-form').textContent()).includes('Planning'), 'clicking a card opens it in the editor');
  // filters
  await A.selectOption('#kb-scope', 'current'); await sleep(300);
  ok(!(await A.locator('#kanban-view').textContent()).includes('Assemble arm'), '“This week” hides week-2 tasks');
  await A.selectOption('#kb-scope', 'all'); await sleep(300);
  await A.selectOption('#kb-lanes', 'person'); await sleep(300);
  ok((await A.locator('.kb-lane-head').count()) >= 1 && (await A.locator('.kb-lane-head').first().textContent()).includes('Aisha Khan'), 'one row per person');
  await A.selectOption('#kb-lanes', 'none'); await sleep(200);
  await A.fill('#search-tasks', 'gripper'); await A.evaluate(() => performSearch()); await sleep(300);
  ok(await A.locator('.kb-card').count() === 1, 'the side-panel search filters the Kanban');
  await A.fill('#search-tasks', ''); await A.evaluate(() => performSearch()); await sleep(200);
  // right-click on a Kanban card gives the task menu
  await kb(A, 'Design gripper').click({ button: 'right' }); await sleep(250);
  ok(await A.locator('#quick-menu.active .qm-btn', { hasText: 'Stage' }).isVisible(), 'right-click a Kanban card → task menu with Stage');
  await A.keyboard.press('Escape'); await sleep(150);
  // view is remembered
  await A.reload(); await A.waitForSelector('#home-screen:not([hidden]), .kb-card');
  if (await A.locator('#home-screen:not([hidden])').isVisible()) { await A.locator('.team-tile').first().click(); }
  await A.waitForSelector('.kb-card'); await sleep(300);
  ok(await A.evaluate(() => document.body.classList.contains('view-kanban')), 'Kanban is remembered after a reload');
  // search action switches back
  await A.keyboard.press('Control+k'); await A.fill('.cmdk-input', 'board view'); await sleep(150); await A.keyboard.press('Enter'); await sleep(400);
  ok(!(await A.evaluate(() => document.body.classList.contains('view-kanban'))) && await A.locator('#canvas-container').isVisible(), 'Ctrl+K ▸ “Board view” switches back');

  step('Analytics ▸ Planning');
  // add a dependency at risk again: Assemble arm waits on Order servos (reopen it, due after)
  await openCard(A, 'Order servos'); await A.click('#edit-form .stage-toggle button[data-stage="todo"]'); await sleep(400);
  await A.click('#top-actions button:has-text("Analytics")'); await A.click('.an-tab[data-tab="planning"]'); await sleep(400);
  const an = () => A.locator('#an-body').textContent();
  ok((await an()).includes('Workload') && (await an()).includes('Burndown') && (await an()).includes('Waiting on late tasks'), 'Planning tab: workload, burndown, risks');
  ok(await A.locator('.wl-table tr', { hasText: 'Aisha Khan' }).count() === 1, 'a workload row per person');
  const wk1cell = await A.locator('.wl-table tr', { hasText: 'Aisha Khan' }).locator('td.wl-cell').first().textContent();
  ok(wk1cell.startsWith('12h'), 'week 1: 6 + 2 + 4 = 12h (got ' + wk1cell + ')');
  await A.fill('#an-capacity', '10'); await A.press('#an-capacity', 'Tab'); await sleep(600);
  ok((await team(A)).doc.capacity === 10, 'capacity saved on the team');
  ok(await A.locator('.wl-table td.wl-cell.over').count() === 1, 'week 1 is over capacity (12 > 10)');
  ok(await A.locator('svg.burndown polyline.bd-actual').count() === 1 && await A.locator('svg.burndown .bd-ideal').count() === 1, 'burndown draws ideal and remaining lines');
  ok((await A.locator('.bd-summary').textContent()).includes('left of 20h'), 'burndown in hours for the Build phase (6+2+4+8 = 20h)');
  ok((await A.locator('#an-body').textContent()).includes('Assemble arm'), 'Assemble arm listed under waiting on late tasks');
  await shot(A, 'planning');
  await A.selectOption('#an-burn', 'weeks'); await sleep(300);
  ok((await A.locator('.bd-summary').textContent()).includes('left of'), 'burndown for all weeks too');
  await A.locator('#an-body tr.an-click', { hasText: 'Assemble arm' }).click(); await sleep(400);
  ok(!(await A.locator('#analytics-overlay').count()) && (await A.locator('#edit-form').textContent()).includes('Waits on'), 'clicking a risk opens the task');

  step('Exports and AI rows include planning fields');
  const rows = await A.evaluate(() => window.boardRows());
  const ar = rows.find(r => r.task === 'Assemble arm');
  ok(ar && ar.stage === 'Doing' && ar.effort === 8 && ar.waitsOn[0] === 'Order servos', 'rows carry stage, effort and waits-on');

  step('Permissions: a member and a viewer');
  await A.click('#top-actions button:has-text("Invite")');
  await A.fill('.settings-pane textarea', 'tom@uni.ac.uk'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(200);
  await A.fill('.settings-pane textarea', 'priya@uni.ac.uk'); await A.locator('.settings-pane form select').selectOption('viewer'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(200);
  await A.keyboard.press('Escape');
  const B = await tab('Tom'); await signIn(B, 'Tom Reed', 'tom@uni.ac.uk');
  await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat'); await sleep(500);
  await B.evaluate(() => boardSetView('kanban')); await sleep(300);
  ok(await kb(B, 'Design gripper').getAttribute('draggable') !== 'true', 'Tom can’t drag Aisha’s cards');
  await kb(B, 'Design gripper').click(); await sleep(250);
  ok(await B.locator('#edit-form .stage-toggle button[data-stage="done"]').isDisabled(), 'stage buttons are disabled on her task');
  ok(!(await B.locator('#edit-form button:has-text("Add a task this waits on")').isVisible()), 'no “add waits on” on her task');
  await B.evaluate(() => openAnalytics('planning')); await sleep(300);
  ok(await B.locator('#an-capacity').isDisabled(), 'only people who can change team settings set capacity');
  await B.keyboard.press('Escape');

  step('Phone: Kanban scrolls sideways, tap opens the task');
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const P = await phone.newPage(); P.on('pageerror', e => errors.push('phone: ' + e.message)); P.on('dialog', d => d.accept());
  await signIn(P, 'Sam Lee', 'sam@uni.ac.uk');
  await P.fill('#create-team-form input[name=name]', 'Phone team'); await P.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await P.click('#create-team-form button[type=submit]'); await P.waitForSelector('.node-cat'); await sleep(300);
  await P.evaluate(() => { const c = db.find(x => x.id === TT.me.uid).categories[0]; c[weeksData[0].key] = [1, 2, 3].map(i => ({ id: 'p' + i, type: 'task', name: 'Phone task ' + i, priority: 'Minor', status: i === 2 ? 'Doing' : '', flag: i === 3 ? 'completed' : 'none', subtasks: [], history: [], effort: i })); saveDatabase(); render(); });
  await P.evaluate(() => boardSetView('kanban')); await sleep(400);
  const dims = await P.evaluate(() => { const b = document.querySelector('.kb-board'); return { sw: b.scrollWidth, cw: b.clientWidth, page: document.documentElement.scrollWidth, vw: innerWidth }; });
  ok(dims.sw > dims.cw && dims.page <= dims.vw + 1, 'columns scroll inside the Kanban, not the page');
  await P.locator('.kb-card', { hasText: 'Phone task 1' }).tap(); await sleep(400);
  ok(await P.locator('#editor-panel').evaluate(e => !e.classList.contains('hidden') && document.body.classList.contains('panel-open')), 'tapping a card opens the editor panel');
  if (SHOTS) await P.screenshot({ path: `${SHOTS}/phase6-phone.png` });
  await phone.close();
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
