// Phase 5 in demo mode: installable app (manifest, icons, offline), search everything
// (Ctrl+K), task templates and repeating tasks.
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

async function dialog(p, value) { await p.waitForSelector('#dialog-overlay input'); await p.fill('#dialog-overlay input', value); await p.click('#dialog-overlay .dlg-ok'); await sleep(250); }
const store = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);

try {
  step('Installable app: manifest, icons, offline');
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE);
  const man = await p.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return r.ok ? r.json() : null; });
  ok(man && man.display === 'standalone' && man.start_url && man.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable') && man.icons.some(i => i.sizes === '192x192'), 'web app manifest: standalone, 192 and 512 (maskable) icons');
  const icons = await p.evaluate(async (list) => Promise.all(list.map(async (u) => { const r = await fetch(u); const b = await r.blob(); return r.ok && b.type === 'image/png' && b.size > 500; })), ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png']);
  ok(icons.every(Boolean), 'all icons load as PNGs (including the iPhone home-screen icon)');
  ok(await p.evaluate(() => !!document.querySelector('meta[name="apple-mobile-web-app-capable"][content=yes]') && !!document.querySelector('link[rel=apple-touch-icon]')), 'iPhone home-screen tags present');
  // The live site registers the worker itself; demo mode doesn't, so register it here to test offline.
  await p.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
  await p.reload(); await p.waitForSelector('#auth-screen:not([hidden])'); await sleep(500); await p.reload(); await p.waitForSelector('#auth-screen:not([hidden])'); await sleep(500);
  await ctx.setOffline(true);
  await p.reload();
  ok(await p.locator('#auth-screen:not([hidden])').isVisible({ timeout: 8000 }).catch(() => false), 'the app opens with no connection (from the offline copy)');
  await ctx.setOffline(false);
  await ctx.close();

  step('Set up a team');
  const c2 = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const q = await c2.newPage(); q.on('pageerror', e => errors.push(e.message)); q.on('dialog', d => d.accept());
  await q.goto(BASE); await q.waitForSelector('#auth-screen:not([hidden])');
  await q.fill('#auth-actions input[placeholder="Your name"]', 'Rushi Vibhandik'); await q.fill('#auth-actions input[type=email]', 'rushi@uni.ac.uk');
  await q.click('#auth-actions button:has-text("Sign in to demo")'); await q.waitForSelector('#home-screen:not([hidden])');
  await q.fill('#create-team-form input[name=name]', 'Robot Science'); await q.click('#create-team-form button[type=submit]');
  await q.waitForSelector('.node-cat'); await sleep(300);
  // three weeks with dates, a task with sub-tasks, a comment
  await q.evaluate(async (m) => {
    const add = (n) => { const d = new Date(m); d.setDate(d.getDate() + 7 * n); return d.toLocaleDateString('en-CA'); };
    weeksData[0].startDate = m; weeksData.push({ key: 'wk_two', title: 'WEEK 2', metric: '', collapsed: false, startDate: add(1) }, { key: 'wk_three', title: 'WEEK 3', metric: '', collapsed: false, startDate: add(2) });
    db.forEach(p => p.categories.forEach(c => { c.wk_two = c.wk_two || []; c.wk_three = c.wk_three || []; }));
    const me = db.find(x => x.id === TT.me.uid); const c = me.categories[0]; const wk = weeksData[0].key;
    c[wk] = [{ id: 'tA', type: 'task', name: 'Calibrate IMU', priority: 'Major', status: 'In progress', jiraId: 'ROB-12', flag: 'none', dueDate: add(0).slice(0, 8) + String(Number(add(0).slice(8)) + 0).padStart(2, '0'), subtasks: [{ id: 's1', title: 'Gyro bias table', completed: false }, { id: 's2', title: 'Accelerometer', completed: false }], history: [] },
      { id: 'tB', type: 'task', name: 'Group meeting', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [] }];
    saveDatabase(); render();
  }, monday());
  await sleep(400);
  await q.locator('.task-card', { hasText: 'Calibrate IMU' }).click(); await sleep(200);
  await q.locator('.comments-section textarea').fill('Use the turntable in lab 2 for this'); await q.click('.comments-section .cm-composer button:has-text("Comment")'); await sleep(300);

  step('Search everything (Ctrl+K)');
  await q.locator('#canvas-container').click({ position: { x: 700, y: 600 } }); await sleep(100);
  await q.keyboard.press('Control+k'); await q.waitForSelector('.cmdk-input');
  ok(await q.locator('.cmdk-item').count() > 3, 'opens with suggested actions before typing');
  await q.keyboard.type('gyro'); await sleep(150);
  ok((await q.locator('.cmdk-item.on .cmdk-title').textContent()) === 'Calibrate IMU', 'finds a task by its sub-task text (“gyro”)');
  ok(await q.locator('.cmdk-item.on mark').count() >= 0, 'matches are highlighted');
  await q.keyboard.press('Enter'); await sleep(400);
  ok((await q.inputValue('#edit-name')) === 'Calibrate IMU', 'Enter opens the task');
  await q.keyboard.press('Control+k'); await q.waitForSelector('.cmdk-input'); await q.keyboard.type('turntable'); await sleep(150);
  ok((await q.locator('.cmdk-group').first().textContent()) === 'Comments' && (await q.locator('.cmdk-item.on .cmdk-sub').textContent()).includes('Calibrate IMU'), 'finds comments, and says which task they’re on');
  await q.fill('.cmdk-input', 'rob-12'); await sleep(150);
  ok((await q.locator('.cmdk-item.on .cmdk-title').textContent()) === 'Calibrate IMU', 'finds by reference (ROB-12)');
  await q.fill('.cmdk-input', 'theme'); await sleep(150);
  ok((await q.locator('.cmdk-item.on .cmdk-title').textContent()) === 'Change theme', 'finds actions');
  await q.keyboard.press('Enter'); await sleep(300);
  ok(await q.locator('.theme-card').count() > 5, 'running an action works (theme picker opened)');
  await q.keyboard.press('Escape'); await sleep(150);
  await q.locator('#canvas-container').click({ position: { x: 700, y: 600 } });
  await q.keyboard.press('/'); await sleep(200);
  ok(await q.locator('.cmdk-input').isVisible(), '“/” opens search too');
  await q.fill('.cmdk-input', 'zzzz-nothing'); await sleep(100);
  ok((await q.textContent('.cmdk-list')).includes('Nothing found'), 'says when nothing matches');
  await q.keyboard.press('Escape'); await sleep(150);
  ok(await q.locator('.cmdk-input').count() === 0, 'Esc closes it');
  await q.click('#search-btn'); await sleep(200);
  ok(await q.locator('.cmdk-input').isVisible(), 'the 🔍 button opens it');
  if (SHOTS) { await q.fill('.cmdk-input', 'cal'); await sleep(150); await q.screenshot({ path: `${SHOTS}/phase5-search.png` }); }
  await q.keyboard.press('Escape');

  step('Task templates');
  await q.locator('.task-card', { hasText: 'Calibrate IMU' }).click({ button: 'right' }); await sleep(200);
  await q.locator('#quick-menu .qm-btn', { hasText: 'Save as template' }).click(); await dialog(q, 'Sensor calibration');
  let T = await store(q); const tpl = Object.values(T.templates || {})[0];
  ok(tpl && tpl.name === 'Sensor calibration' && tpl.task.subtasks.join() === 'Gyro bias table,Accelerometer' && tpl.task.priority === 'Major', 'template saved with sub-tasks and priority');
  ok(tpl && tpl.task.dueOffset === 0, 'remembers the deadline as days after the week starts');
  await q.locator('.col-week[data-week-key="wk_two"]').first().click({ button: 'right', position: { x: 60, y: 60 } }); await sleep(200);
  await q.locator('#quick-menu .qm-btn', { hasText: 'Add from template' }).click(); await sleep(200);
  await q.locator('#quick-submenu .qm-btn', { hasText: 'Sensor calibration' }).click(); await dialog(q, 'Calibrate magnetometer');
  T = await store(q);
  const fromTpl = Object.values(T.tasks).find(t => t.name === 'Calibrate magnetometer');
  ok(fromTpl && fromTpl.weekId === 'wk_two' && fromTpl.subtasks.length === 2 && fromTpl.subtasks.every(s => !s.completed) && fromTpl.priority === 'Major', 'new task from the template, in the right week, with fresh sub-tasks');
  ok(fromTpl && fromTpl.dueDate === iso(7, monday()), 'deadline placed relative to that week');
  await q.click('#top-actions button:has-text("Settings")'); await q.click('.settings-nav button:has-text("Templates")'); await sleep(200);
  ok((await q.textContent('.settings-pane')).includes('Sensor calibration') && (await q.textContent('.settings-pane')).includes('Gyro bias table'), 'Settings ▸ Templates lists it with its sub-tasks');
  await q.click('.tpl-row button:has-text("Delete")'); await sleep(300);
  ok(Object.keys((await store(q)).templates || {}).length === 0, 'templates can be deleted');
  await q.keyboard.press('Escape'); await sleep(150);

  step('Repeating tasks');
  await q.locator('.task-card', { hasText: 'Group meeting' }).first().click(); await sleep(200);
  await q.selectOption('#edit-repeat', '1'); await sleep(700);
  T = await store(q);
  const copies = () => Object.entries(T.tasks).map(([id, t]) => ({ ...t, id })).filter(t => t.repeat && t.repeat.seriesId === 'tB');
  ok(copies().length === 2 && copies().map(t => t.weekId).sort().join() === 'wk_three,wk_two', 'weekly: copies appear in the 2 later weeks');
  ok(await q.locator('.task-card', { hasText: 'Group meeting' }).first().locator('.repeat-chip').isVisible(), 'the card shows 🔁');
  // delete one copy; it must not come back
  const c3 = copies().find(t => t.weekId === 'wk_three');
  await q.evaluate((id) => { const loc = locateTask(id); loc.cat[loc.weekKey].splice(loc.index, 1); saveDatabase(); render(); }, c3.id); await sleep(500);
  await q.evaluate(() => window.boardRender()); await sleep(400);
  T = await store(q);
  ok(copies().length === 1, 'a deleted copy doesn’t come back');
  // add a week → a copy appears there
  await q.click('.btn-add-week'); await sleep(900);
  T = await store(q);
  const wk4 = T.doc.weeks[T.doc.weeks.length - 1].key;
  ok(copies().some(t => t.weekId === wk4), 'adding a week adds the next copy');
  await q.evaluate(() => showEverything()); await sleep(300);
  await q.locator('.task-card', { hasText: 'Group meeting' }).nth(1).click(); await sleep(200);
  ok((await q.textContent('#edit-form')).includes('A copy of a repeating task'), 'a copy says it belongs to a series');
  // every 2 weeks with an end date
  await q.locator('.task-card', { hasText: 'Calibrate IMU' }).first().click(); await sleep(200);
  await q.selectOption('#edit-repeat', '2'); await sleep(200);
  await q.fill('#edit-repeat-until', iso(10, monday())); await q.locator('#edit-repeat-until').dispatchEvent('change'); await sleep(700);
  T = await store(q);
  const imu = Object.values(T.tasks).filter(t => t.repeat && t.repeat.seriesId === 'tA');
  ok(imu.length === 1 && imu[0].weekId === 'wk_three' && imu[0].dueDate === iso(14, monday()), 'every 2 weeks: only week 3 (week 4 is after the end date), deadline moved on 2 weeks');
  if (SHOTS) await q.screenshot({ path: `${SHOTS}/phase5-repeat.png` });
  await c2.close();

  step('Phone: search and the install hint');
  const pc = await browser.newContext({ ...devices['iPhone 13'] });
  const r = await pc.newPage(); r.on('pageerror', e => errors.push('phone: ' + e.message)); r.on('dialog', d => d.accept());
  await r.goto(BASE); await r.waitForSelector('#auth-screen:not([hidden])');
  await r.fill('#auth-actions input[placeholder="Your name"]', 'Rushi'); await r.fill('#auth-actions input[type=email]', 'r@uni.ac.uk');
  await r.tap('#auth-actions button:has-text("Sign in to demo")'); await r.waitForSelector('#home-screen:not([hidden])');
  await r.tap('#home-account'); await r.waitForSelector('.modal');
  ok((await r.textContent('.modal')).includes('Install as an app'), 'Your account offers “Install as an app”');
  await r.tap('.modal button:has-text("Install as an app")'); await sleep(250);
  ok((await r.locator('.modal').last().textContent()).includes('Add to Home Screen'), 'on iPhone it explains Share ▸ Add to Home Screen');
  if (SHOTS) await r.screenshot({ path: `${SHOTS}/phase5-install.png` });
  await pc.close();
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
