// Phase 4 in demo mode: importing a Jira CSV export and a Trello board export, and GitHub
// issue / pull-request links with live state (against a stand-in for GitHub's API).
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const iso = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };
const jiraDate = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return String(x.getDate()).padStart(2, '0') + '/' + x.toLocaleString('en-GB', { month: 'short' }) + '/' + String(x.getFullYear()).slice(2) + ' 12:00 AM'; };

const GH = { calls: 0, items: {
  'acme/robot-arm/pulls/42': { state: 'closed', merged: true, title: 'Add gripper firmware' },
  'acme/robot-arm/issues/7': { state: 'open', title: 'Servo jitter at low speed' },
  'acme/robot-arm/issues/8': { state: 'closed', state_reason: 'completed', title: 'Calibrate encoders' },
} };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('https://api.github.com/**', async (route) => {
    GH.calls++;
    const path = new URL(route.request().url()).pathname.replace('/repos/', '');
    const item = GH.items[path];
    await route.fulfill({ status: item ? 200 : 404, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(item || { message: 'Not Found' }) });
  });
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Rushi Vibhandik'); await p.fill('#auth-actions input[type=email]', 'rushi@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.fill('#create-team-form input[name=name]', 'Robot Science'); await p.click('#create-team-form button[type=submit]');
  await p.waitForSelector('.node-cat'); await sleep(300);
  const tasks = () => p.evaluate(() => Object.values(Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0].tasks));
  const importFile = async (name, mimeType, text) => {
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#team-data-actions button:has-text("Import tasks")')]);
    await chooser.setFiles({ name, mimeType, buffer: Buffer.from(text) });
    await p.waitForSelector('.modal .btn.primary:has-text("Import")');
  };

  step('Import a Jira CSV export');
  const csv = [
    'Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Reporter,Created,Due date,Resolved,Sprint,Labels',
    `"Calibrate IMU, all axes",ROB-12,10012,Task,In Progress,Highest,Rushi Vibhandik,Ana Lopez,01/Oct/26 9:00 AM,${jiraDate(4)},,,sensors`,
    `Write test report,ROB-13,10013,Story,Done,Low,rushi@uni.ac.uk,Ana Lopez,01/Oct/26 9:00 AM,,${jiraDate(-2)},,`,
    `Mount lidar,ROB-14,10014,Bug,To Do,Medium,Ana Lopez,Ana Lopez,02/Oct/26 9:00 AM,,,,`,
  ].join('\n');
  await importFile('Jira.csv', 'text/csv', csv);
  const preview = await p.textContent('.modal');
  ok(preview.includes('Read as: Jira export') && preview.includes('3 tasks will be added'), 'recognised as a Jira export, 3 tasks');
  ok(preview.includes('Ana Lopez'), 'warns that Ana isn’t in the team yet');
  await p.click('.modal .btn.primary:has-text("Import")'); await sleep(400);
  let t = await tasks();
  const imu = t.find(x => x.name === 'Calibrate IMU, all axes');
  ok(imu && imu.jiraId === 'ROB-12' && imu.priority === 'Blocker' && imu.status === 'In Progress' && imu.dueDate === iso(4), 'key, priority, status and due date carried over');
  const rep = t.find(x => x.name === 'Write test report');
  ok(rep && rep.flag === 'completed' && rep.completedDate === iso(-2), 'Done issues come in completed, with the resolved date');
  const weeks = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0].doc.weeks.length);
  ok(weeks === 1, 'no sprint column values → tasks go into the existing week (no junk weeks)');

  step('Import a Trello board export');
  const trello = { name: 'Robot build', lists: [{ id: 'l1', name: 'Doing' }, { id: 'l2', name: 'Done' }], members: [{ id: 'm1', fullName: 'Rushi Vibhandik' }],
    labels: [{ id: 'b1', name: 'Mechanical' }], checklists: [{ id: 'c1', checkItems: [{ name: 'Sketch', state: 'complete', pos: 1 }, { name: 'CAD', state: 'incomplete', pos: 2 }] }],
    cards: [{ id: 'x1', idShort: 4, name: 'Design gripper', idList: 'l1', idMembers: ['m1'], idLabels: ['b1'], due: iso(3) + 'T17:00:00.000Z', idChecklists: ['c1'], shortUrl: 'https://trello.com/c/abc123' },
      { id: 'x2', idShort: 5, name: 'Order servos', idList: 'l2', idMembers: ['m1'], idLabels: [] },
      { id: 'x3', idShort: 6, name: 'Old idea', idList: 'l1', closed: true }] };
  await importFile('board.json', 'application/json', JSON.stringify(trello));
  ok((await p.textContent('.modal')).includes('Trello board “Robot build”') && (await p.textContent('.modal')).includes('2 tasks will be added'), 'recognised as a Trello board, archived card skipped');
  await p.click('.modal .btn.primary:has-text("Import")'); await sleep(400);
  t = await tasks();
  const grip = t.find(x => x.name === 'Design gripper');
  ok(grip && grip.subtasks.length === 2 && grip.subtasks[0].completed && grip.dueDate === iso(3) && grip.status === 'Doing', 'checklist → sub-tasks, due date and list carried over');
  ok(grip && grip.attachments[0] && grip.attachments[0].url === 'https://trello.com/c/abc123', 'link back to the Trello card');
  ok(t.find(x => x.name === 'Order servos').flag === 'completed', 'cards in Done come in completed');
  ok(await p.locator('.node-cat', { hasText: 'MECHANICAL' }).count() + await p.locator('.node-cat', { hasText: 'Mechanical' }).count() >= 1, 'Trello label becomes the category');

  step('GitHub links show live state');
  const addLink = async (taskName, url) => {
    await p.locator('.task-card', { hasText: taskName }).first().click(); await sleep(200);
    await p.click('#edit-form button:has-text("Attach a file or link")'); await p.waitForSelector('.modal input[type=url]');
    await p.fill('.modal input[type=url]', url); await p.click('.modal button:has-text("Add link")'); await sleep(500);
  };
  await addLink('Mount lidar', 'https://github.com/acme/robot-arm/issues/7');
  t = await tasks();
  ok(t.find(x => x.name === 'Mount lidar').attachments[0].provider === 'github' && t.find(x => x.name === 'Mount lidar').attachments[0].name === 'acme/robot-arm#7', 'GitHub link recognised and named owner/repo#7');
  await p.waitForSelector('.task-card .gh-chip.gh-open');
  ok((await p.locator('.task-card', { hasText: 'Mount lidar' }).locator('.gh-chip').textContent()) === '#7 · Open', 'card shows “#7 · Open”');
  ok((await p.locator('#edit-form .att-item .gh-chip').textContent()).includes('Servo jitter at low speed'), 'editor shows the issue title');
  ok(await p.locator('#edit-form .gh-done-box').count() === 0, 'no “mark completed” offer while the issue is open');
  await addLink('Calibrate IMU', 'https://github.com/acme/robot-arm/pull/42');
  await p.waitForSelector('#edit-form .gh-done-box');
  ok((await p.locator('.task-card', { hasText: 'Calibrate IMU' }).locator('.gh-chip').textContent()) === '#42 · Merged', 'merged pull request shown as Merged');
  ok((await p.textContent('#edit-form .gh-done-box')).includes('pull request is merged'), 'offers to complete the task once the PR is merged');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/phase4-github.png` });
  await p.click('#edit-form .gh-done-box button'); await sleep(400);
  t = await tasks();
  const done = t.find(x => x.name === 'Calibrate IMU, all axes');
  ok(done.flag === 'completed' && done.completedDate && done.history[0].updated.includes('GitHub'), 'one click completes it, logged in history');
  await addLink('Order servos', 'https://github.com/acme/private-repo/issues/1');
  await p.waitForSelector('.task-card .gh-chip.gh-unknown');
  ok((await p.locator('.task-card', { hasText: 'Order servos' }).locator('.gh-chip').textContent()).includes('🔒'), 'private / missing repos show a lock and stay a plain link');
  const before = GH.calls; await p.evaluate(() => { saveDatabase(); render(); }); await sleep(400);
  ok(GH.calls === before, 'redrawing the board doesn’t ask GitHub again (cached)');
  await ctx.close();
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
