// Deleting tasks in demo mode, every way in: the editor button, the right-click menu, the
// circle menu, press-and-hold on a phone. Checks undo, that a deletion survives a reload,
// repeating tasks, comments on a deleted task, and who is allowed to delete.
// Needs the preview server:  npx vite preview --port 4173
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const monday = () => { const x = new Date(); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toLocaleDateString('en-CA'); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const dialogs = [];
async function tab(label) {
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => { dialogs.push(d.message()); d.accept(); }); return p;
}
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const team = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const names = async (p) => Object.values((await team(p)).tasks).map(t => t.name);
const card = (p, name) => p.locator('.task-card', { hasText: name }).first();
const cards = (p, name) => p.locator('.task-card', { hasText: name }).count();
async function clickCard(p, name) { await card(p, name).evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' })); await card(p, name).click(); await sleep(250); }
const menuItem = (p, label) => p.locator('#quick-menu.active .qm-btn', { hasText: label });

try {
  step('Set up: owner, a member and a viewer; tasks in three dated weeks');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Robot Science'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(async (m) => {
    const add = (n) => { const d = new Date(m); d.setDate(d.getDate() + 7 * n); return d.toLocaleDateString('en-CA'); };
    weeksData[0].startDate = m; weeksData.push({ key: 'wk_two', title: 'WEEK 2', metric: '', collapsed: false, startDate: add(1) }, { key: 'wk_three', title: 'WEEK 3', metric: '', collapsed: false, startDate: add(2) });
    db.forEach(p => p.categories.forEach(c => { c.wk_two = c.wk_two || []; c.wk_three = c.wk_three || []; }));
    const c = db.find(x => x.id === TT.me.uid).categories[0]; const wk = weeksData[0].key;
    const mk = (id, name) => ({ id, type: 'task', name, priority: 'Minor', status: '', flag: 'none', subtasks: [{ id: id + 's', title: 'step one', completed: false }], history: [] });
    c[wk] = [mk('t1', 'Order servos'), mk('t2', 'Write report'), mk('t3', 'Mount lidar'), mk('t4', 'Group meeting'), mk('t5', 'Phone task')];
    saveDatabase(); render();
  }, monday());
  await sleep(500);
  await A.click('#top-actions button:has-text("Invite")');
  await A.fill('.settings-pane textarea', 'tom@uni.ac.uk'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(200);
  await A.fill('.settings-pane textarea', 'priya@uni.ac.uk'); await A.locator('.settings-pane form select').selectOption('viewer');
  await A.click('.settings-pane button:has-text("Invite")'); await sleep(200);
  await A.keyboard.press('Escape'); await sleep(200);
  ok((await names(A)).length === 5, '5 tasks to start with');

  step('Delete from the task editor, then Undo');
  await clickCard(A, 'Order servos');
  dialogs.length = 0;
  await A.click('#edit-form button:has-text("Delete Task")'); await sleep(500);
  ok(dialogs.some(d => d.includes('Delete this task')), 'asks “Delete this task?” first');
  ok(!(await names(A)).includes('Order servos'), 'gone from the saved data');
  ok(await cards(A, 'Order servos') === 0, 'gone from the board');
  ok(!(await A.locator('#edit-form').isVisible()), 'editor closes');
  const toast = A.locator('.toast, #toast').filter({ hasText: 'Deleted' }).first();
  ok(await toast.isVisible(), '“Deleted.” message with Undo');
  await toast.locator('button', { hasText: 'Undo' }).click(); await sleep(500);
  ok((await names(A)).includes('Order servos') && await cards(A, 'Order servos') === 1, 'Undo brings it back');
  const back = Object.values((await team(A)).tasks).find(t => t.name === 'Order servos');
  ok(back && back.subtasks.length === 1, '…with its sub-tasks');

  step('Cancel keeps the task');
  A.removeAllListeners('dialog'); A.once('dialog', d => d.dismiss());
  await clickCard(A, 'Order servos');
  await A.click('#edit-form button:has-text("Delete Task")'); await sleep(400);
  ok((await names(A)).includes('Order servos'), 'pressing Cancel deletes nothing');
  A.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await A.keyboard.press('Escape'); await sleep(200);

  step('Delete from the right-click menu; Ctrl+Z also undoes');
  await card(A, 'Write report').evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await card(A, 'Write report').click({ button: 'right' }); await sleep(250);
  ok(await menuItem(A, 'Delete task').isVisible(), 'menu has “Delete task…”');
  await menuItem(A, 'Delete task').click(); await sleep(500);
  ok(!(await names(A)).includes('Write report') && await cards(A, 'Write report') === 0, 'deleted from the menu');
  await A.mouse.click(5, 300); await A.keyboard.press('Control+z'); await sleep(500);
  ok((await names(A)).includes('Write report'), 'Ctrl+Z brings it back');

  step('A deletion survives a reload');
  await clickCard(A, 'Mount lidar');
  await A.click('#edit-form button:has-text("Delete Task")'); await sleep(600);
  await A.reload(); await A.waitForSelector('#home-screen:not([hidden]), .node-cat');
  if (await A.locator('#home-screen:not([hidden])').isVisible()) { await A.locator('.team-card, .team-row').first().click(); await A.waitForSelector('.node-cat'); }
  await sleep(500);
  ok(await cards(A, 'Mount lidar') === 0 && !(await names(A)).includes('Mount lidar'), 'still gone after reloading');

  step('Comments on a deleted task don’t break anything');
  await clickCard(A, 'Write report');
  await A.locator('.comments-section textarea').fill('Draft is in the shared drive'); await A.click('.comments-section .cm-composer button:has-text("Comment")'); await sleep(300);
  await A.click('#edit-form button:has-text("Delete Task")'); await sleep(500);
  await A.click('#activity-btn'); await sleep(400);
  ok(await A.locator('.modal').isVisible(), 'activity feed still opens');
  await A.keyboard.press('Escape'); await sleep(200);
  await A.keyboard.press('Control+k'); await A.fill('.cmdk-input', 'shared drive'); await sleep(200);
  ok((await A.locator('.cmdk-list').textContent()).includes('Nothing found'), 'search doesn’t offer the deleted task’s comment');
  await A.keyboard.press('Escape'); await sleep(150);
  await A.locator('.toast, #toast').filter({ hasText: 'Deleted' }).first().locator('button', { hasText: 'Undo' }).click().catch(async () => { await A.mouse.click(5, 300); await A.keyboard.press('Control+z'); });
  await sleep(500);
  await clickCard(A, 'Write report');
  ok((await A.locator('.comments-section .cm-list').textContent()).includes('shared drive'), 'Undo brings the task back with its comments');
  await A.click('#edit-form button:has-text("Delete Task")'); await sleep(500);

  step('Repeating tasks');
  await clickCard(A, 'Group meeting');
  await A.selectOption('#edit-repeat', '1'); await sleep(800);
  await A.keyboard.press('Escape'); await sleep(200);
  const series = async () => Object.entries((await team(A)).tasks).map(([id, t]) => ({ ...t, id })).filter(t => t.name === 'Group meeting');
  ok((await series()).length === 3, 'weekly: 1 + 2 copies');
  await A.evaluate(() => showEverything()); await sleep(300);
  // delete the copy in week 3 through the menu
  const wk3 = A.locator('.task-card', { hasText: 'Group meeting' }).nth(2);
  await wk3.evaluate(e => e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  await wk3.click({ button: 'right' }); await sleep(250);
  await menuItem(A, 'Delete task').click(); await sleep(800);
  ok((await series()).length === 2, 'a copy can be deleted');
  await A.evaluate(() => window.boardRender()); await sleep(500);
  ok((await series()).length === 2, '…and it doesn’t come back');
  // delete the first task of the series
  const origin = (await series()).find(t => !t.repeat.seriesId);
  await A.evaluate((id) => window.boardOpenTask(id), origin.id); await sleep(300);
  await A.click('#edit-form button:has-text("Delete Task")'); await sleep(800);
  await A.evaluate(() => window.boardRender()); await sleep(500);
  const rest = await series();
  ok(rest.length === 1 && rest[0].repeat.seriesId, 'deleting the first task keeps the copy already made, and makes no new ones');
  await A.evaluate((id) => window.boardOpenTask(id), rest[0].id); await sleep(300);
  const repTxt = await A.locator('#edit-form').textContent();
  ok(!repTxt.includes('Open the first task'), 'the copy no longer offers a link to the deleted first task');
  await A.keyboard.press('Escape'); await sleep(200);

  step('Circle menu: Delete works there too');
  await A.evaluate(() => localStorage.setItem('tt_menu_style', 'circle')); await A.reload();
  await A.waitForSelector('#home-screen:not([hidden]), .node-cat');
  if (await A.locator('#home-screen:not([hidden])').isVisible()) { await A.locator('.team-card, .team-row').first().click(); await A.waitForSelector('.node-cat'); }
  await sleep(500);
  await card(A, 'Order servos').evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await card(A, 'Order servos').click({ button: 'right' }); await sleep(300);
  const seg = A.locator('#radial-menu .rm-seg[aria-label^="Delete"]').first();
  ok(await seg.count() === 1, 'circle has a Delete wedge');
  const t = await seg.locator('.rm-icon').boundingBox();
  await A.mouse.move(t.x + t.width / 2, t.y + t.height / 2); await sleep(80); await A.mouse.click(t.x + t.width / 2, t.y + t.height / 2); await sleep(700);
  ok(!(await names(A)).includes('Order servos'), 'deleted from the circle menu');
  await A.evaluate(() => localStorage.setItem('tt_menu_style', 'list'));

  step('A mention on a deleted task doesn’t leave a badge stuck on');
  await A.evaluate((m) => { const k = 'tt_demo_store_v1'; const st = JSON.parse(localStorage.getItem(k)); const t = Object.values(st.teams)[0];
    t.comments = t.comments || {}; t.comments.cmGhost = { taskId: 'deleted-task', authorUid: 'someone-else', authorName: 'Tom Reed', text: '@Aisha Khan look at this', mentions: [m], createdAt: Date.now() - 10 * 60 * 1000 };
    localStorage.setItem(k, JSON.stringify(st)); }, await A.evaluate(() => TT.me.uid));
  await A.evaluate(() => { location.hash = ''; }); await A.reload(); await A.waitForSelector('#home-screen:not([hidden]), .node-cat');
  if (await A.locator('.node-cat').count()) { await A.evaluate(() => TT.goHome()); await A.waitForSelector('#home-screen:not([hidden])'); }
  await sleep(400);
  ok(await A.locator('.tile-badge').count() === 1, '(before) the team tile shows the stray mention');
  await A.locator('.team-tile').first().click(); await A.waitForSelector('.node-cat'); await sleep(700);
  ok(await A.locator('#activity-badge').isHidden(), 'no badge on the board');
  await A.evaluate(() => TT.goHome()); await A.waitForSelector('#home-screen:not([hidden])'); await sleep(400);
  ok(await A.locator('.tile-badge').count() === 0, 'and the team tile badge has cleared');
  await A.locator('.team-tile').first().click(); await A.waitForSelector('.node-cat'); await sleep(400);

  step('A member can delete their own task, not someone else’s');
  const B = await tab('Tom');
  await signIn(B, 'Tom Reed', 'tom@uni.ac.uk');
  await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat'); await sleep(500);
  await clickCard(B, 'Phone task');
  ok(!(await B.locator('#edit-form button:has-text("Delete Task")').isVisible()), 'no Delete button on Aisha’s task');
  await B.keyboard.press('Escape');
  await card(B, 'Phone task').click({ button: 'right' }); await sleep(250);
  ok(await menuItem(B, 'Delete task').count() === 0, 'no “Delete task…” in the menu either');
  await B.keyboard.press('Escape'); await sleep(150);
  await B.evaluate(() => {
    const me = db.find(x => x.id === TT.me.uid); const c = me.categories[0] || (me.categories.push({ id: 'cTom', type: 'category', name: 'Tom work' }), me.categories[0]);
    c[weeksData[0].key] = c[weeksData[0].key] || []; c[weeksData[0].key].push({ id: 'tTom', type: 'task', name: 'Tom’s own task', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [] }); saveDatabase(); render();
  }); await sleep(500);
  ok((await names(B)).includes('Tom’s own task'), 'Tom adds his own task');
  await clickCard(B, 'Tom’s own task');
  await B.click('#edit-form button:has-text("Delete Task")'); await sleep(600);
  ok(!(await names(B)).includes('Tom’s own task'), 'Tom can delete his own task');
  await B.evaluate(() => { const loc = locateTask('t5'); if (loc) { loc.cat[loc.weekKey].splice(loc.index, 1); saveDatabase(); render(); } }); await sleep(800);
  ok((await names(B)).includes('Phone task'), 'forcing a delete of Aisha’s task is refused by the rules (task kept)');

  step('A viewer can’t delete');
  const V = await tab('Priya');
  await signIn(V, 'Priya Shah', 'priya@uni.ac.uk');
  await V.click('#invites-list button:has-text("Join team")'); await V.waitForSelector('.node-cat'); await sleep(500);
  await clickCard(V, 'Phone task');
  ok(!(await V.locator('#edit-form button:has-text("Delete Task")').isVisible()), 'no Delete button for a viewer');

  step('Phone: press-and-hold → Delete task…');
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const P = await phone.newPage(); P.on('pageerror', e => errors.push('phone: ' + e.message)); P.on('dialog', d => d.accept());
  await signIn(P, 'Sam Lee', 'sam@uni.ac.uk');
  await P.fill('#create-team-form input[name=name]', 'Phone team'); await P.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await P.click('#create-team-form button[type=submit]');
  await P.waitForSelector('.node-cat'); await sleep(300);
  await P.evaluate(() => { const c = db.find(x => x.id === TT.me.uid).categories[0]; c[weeksData[0].key] = [{ id: 'p1', type: 'task', name: 'Tap to delete', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [] }]; saveDatabase(); render(); });
  await sleep(400);
  const cdp = await phone.newCDPSession(P);
  const loc = P.locator('.task-card', { hasText: 'Tap to delete' });
  await loc.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const b = await loc.boundingBox(); const x = b.x + b.width / 2, y = b.y + Math.min(30, b.height / 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
  ok(await menuItem(P, 'Delete task').isVisible(), 'press-and-hold menu has “Delete task…”');
  await menuItem(P, 'Delete task').tap(); await sleep(600);
  const pt = await P.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams).map(t => Object.values(t.tasks).map(x => x.name)).flat());
  ok(!pt.includes('Tap to delete'), 'deleted on the phone');
  await phone.close();
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
