// Flexible views: the List view (every task in one sortable, groupable table) and the backlog
// (a column for tasks without a week). Same tasks as the board: switching views moves nothing.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
const team = () => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams).find(t => t.doc && t.doc.name === 'List Lab'));
const names = () => p.locator('.lt-row .lt-name').allTextContents();

try {
  step('A team with a few tasks');
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Aisha Khan'); await p.fill('#auth-actions input[type=email]', 'aisha@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.fill('#create-team-form input[name=name]', 'List Lab');
  await p.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; });
  await p.click('#create-team-form button[type=submit]'); await p.waitForSelector('.node-cat'); await sleep(400);
  await p.evaluate(() => {
    const c = db.find(x => x.id === TT.me.uid).categories[0]; const k = weeksData[0].key;
    c[k] = [
      { id: 'tA', type: 'task', name: 'Bravo wiring', priority: 'Minor', status: '', flag: 'none', dueDate: '2030-03-01', subtasks: [{ id: 's1', text: 'a', completed: true }, { id: 's2', text: 'b', completed: false }], history: [] },
      { id: 'tB', type: 'task', name: 'Alpha frame', priority: 'Blocker', status: '', flag: 'none', dueDate: '2030-01-01', subtasks: [], history: [] },
      { id: 'tC', type: 'task', name: 'Charlie report', priority: 'Major', status: '', flag: 'completed', completedDate: '2026-01-01', subtasks: [], history: [] },
    ];
    saveDatabase(); render();
  });
  await sleep(500);

  step('Switching to the List view');
  await p.click('[data-view="list"]'); await p.waitForSelector('.lt-table');
  ok(await p.evaluate(() => document.body.classList.contains('view-list')), 'the list view is showing');
  ok(!(await p.locator('#canvas-container').isVisible()), 'the board grid is hidden');
  ok((await p.locator('.lt-row').count()) === 3, 'every task is a row');
  ok((await names()).join('|') === 'Alpha frame|Bravo wiring|Charlie report', 'sorted by due date by default');

  step('Sorting by a column, then reversing it');
  await p.click('.lt-sort[data-sort="name"]'); await sleep(200);
  ok((await names()).join('|') === 'Alpha frame|Bravo wiring|Charlie report', 'A → Z by task');
  await p.click('.lt-sort[data-sort="name"]'); await sleep(200);
  ok((await names()).join('|') === 'Bravo wiring|Alpha frame|Charlie report', 'Z → A on a second click (finished work stays at the bottom)');
  ok(await p.locator('th[aria-sort="descending"] .lt-sort[data-sort="name"]').count() === 1, 'the header says how it is sorted');
  await p.click('.lt-sort[data-sort="priority"]'); await sleep(200);
  ok((await names())[0] === 'Alpha frame', 'Blocker first when sorted by priority');

  step('Filters: hide done, search');
  await p.check('#lt-hide-done'); await sleep(200);
  ok((await p.locator('.lt-row').count()) === 2 && !(await names()).includes('Charlie report'), 'done tasks hidden');
  await p.uncheck('#lt-hide-done'); await sleep(200);
  await p.fill('#search-tasks', 'wiring').catch(() => {}); await p.evaluate(() => { const q = document.getElementById('search-tasks'); if (q) { q.value = 'wiring'; q.dispatchEvent(new Event('input')); } }); await sleep(300);
  ok((await p.locator('.lt-row').count()) === 1, 'the board search filters the list');
  await p.evaluate(() => { const q = document.getElementById('search-tasks'); if (q) { q.value = ''; q.dispatchEvent(new Event('input')); } }); await sleep(300);

  step('Grouping');
  await p.selectOption('#list-view .lt-group, #list-view select.lt-group', 'priority').catch(async () => p.locator('select.lt-group').selectOption('priority')); await sleep(200);
  ok((await p.locator('tr.lt-group').count()) === 3, 'one group per priority');
  await p.locator('select.lt-group').selectOption('stage'); await sleep(200);
  ok((await p.locator('tr.lt-group').count()) >= 2, 'grouped by stage');
  await p.locator('select.lt-group').selectOption('none'); await sleep(200);

  step('Editing in the list: stage and priority');
  const row = p.locator('.lt-row[data-id="tA"]');
  const stages = await row.locator('select.lt-stage option').evaluateAll(os => os.map(o => o.value));
  await row.locator('select.lt-stage').selectOption(stages[1]); await sleep(400);
  ok(Object.values((await team()).tasks).find(t => t.name === 'Bravo wiring').stage === stages[1] || await p.evaluate((s) => TT.stageId(db.flatMap(x => x.categories).flatMap(c => Object.values(c).filter(Array.isArray).flat()).find(t => t.id === 'tA')) === s, stages[1]), 'stage changed from the list');
  await p.locator('.lt-row[data-id="tA"] select.lt-prio').selectOption('Critical'); await sleep(400);
  ok(Object.values((await team()).tasks).find(t => t.name === 'Bravo wiring').priority === 'Critical', 'priority saved');
  await p.locator('.lt-row[data-id="tB"] .lt-name').click(); await sleep(300);
  ok(await p.locator('#editor-panel #edit-name').count() === 1 || await p.locator('#editor-panel').isVisible(), 'clicking a row opens the task');

  step('The backlog: a column for tasks without a week');
  await p.click('#lt-add-backlog'); await sleep(500);
  ok((await team()).doc.weeks[0].key === 'backlog' && (await team()).doc.weeks[0].startDate === '', 'backlog saved first, with no dates');
  ok(await p.locator('#lt-add-backlog').count() === 0, 'only one backlog');
  await p.click('#lt-new'); await p.waitForSelector('#dialog-overlay:not([hidden]) input, .dialog input');
  await p.keyboard.type('Pick a battery'); await p.keyboard.press('Enter'); await sleep(500);
  const nt = Object.values((await team()).tasks).find(t => t.name === 'Pick a battery');
  ok(nt && nt.weekId === 'backlog', 'a new task from the list goes into the backlog');
  ok(await p.locator('.lt-row', { hasText: 'Pick a battery' }).locator('.lt-week.is-backlog').count() === 1, 'shown as Backlog in the list');

  step('Back to the board: the backlog column is first and has no dates');
  await p.click('[data-view="board"]'); await sleep(500);
  ok(await p.evaluate(() => document.querySelector('.header-week').dataset.weekKey) === 'backlog', 'backlog is the first column');
  ok(await p.locator('.header-week[data-week-key="backlog"] .week-dates').isVisible().catch(() => false) === false, 'no dates on the backlog');
  ok(await p.locator('.task-card', { hasText: 'Pick a battery' }).count() === 1, 'its task is on the board');
  await p.evaluate(() => toggleWeekCollapse(0)); await sleep(300);
  ok((await p.locator('.header-week.collapsed-circle[data-week-key="backlog"]').textContent()).trim() === 'BL', 'collapsed, the backlog reads BL (not W1)');
  await p.evaluate(() => toggleWeekCollapse(1)); await sleep(300);
  ok(/^W\d+$/.test((await p.locator('.header-week.collapsed-circle').nth(1).textContent()).trim()), 'a collapsed week still reads W1, W2…');
  await p.evaluate(() => { toggleWeekCollapse(0); toggleWeekCollapse(1); }); await sleep(300);

  step('Setting all week dates skips the backlog');
  await p.evaluate(() => { autoDateWeeksFlow(); }); await p.waitForSelector('#dialog-overlay:not([hidden]) input, .dialog input');
  await p.keyboard.press('Enter'); await sleep(400);
  const w = (await team()).doc.weeks;
  ok(w[0].startDate === '' && /^\d{4}-\d{2}-\d{2}$/.test(w[1].startDate), 'backlog stays undated; the first real week gets the date');
  ok(w[1].title !== 'Backlog' && w[0].title === 'Backlog', 'names unchanged');

  step('The view is remembered');
  await p.click('[data-view="list"]'); await sleep(200);
  await p.reload(); await p.waitForSelector('.lt-table', { timeout: 15000 }).catch(() => {});
  ok(await p.locator('.lt-table').count() === 1, 'reopens in the list view');
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
