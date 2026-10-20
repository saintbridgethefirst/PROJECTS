// Two people editing the same things at the same moment, on a slow network.
// Each tab can hold back the other's changes (window.__ttHold), so both edit from out-of-date data
// and save on top of each other — what happens when two teammates click within a second.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });

async function tab(label) {
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p;
}
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
async function dialog(p, value) { await p.waitForSelector('#dialog-overlay input'); await p.fill('#dialog-overlay input', value); await p.click('#dialog-overlay .dlg-ok'); await sleep(200); }
const stored = (p) => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('tt_demo_store_v1')); return Object.values(s.teams)[0]; });
const storedTask = async (p, name) => Object.values((await stored(p)).tasks).find(t => t.name === name);
/** The task as this tab's board shows it. */
const shown = (p, name) => p.evaluate((n) => { const l = allTaskLocs().find(x => x.task.name === n); return l ? JSON.parse(JSON.stringify(l.task)) : null; }, name);
/** Edit a task on this tab's board, the way the editor does, and save. */
const edit = (p, name, fn) => p.evaluate(({ n, f }) => { const l = allTaskLocs().find(x => x.task.name === n); (0, eval)('(' + f + ')')(l.task); saveDatabase(); render(); }, { n: name, f: fn.toString() });
const hold = (...ps) => Promise.all(ps.map(p => p.evaluate(() => { window.__ttHold = true; })));
const release = async (...ps) => { for (const p of ps) await p.evaluate(() => window.__ttRelease()); await sleep(900); };
const status = (p) => p.evaluate(() => (document.getElementById('sync-status') || {}).textContent || '');

try {
  step('Set up: Aisha (owner) and Tom (admin) on one team');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Wing Team'); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  for (const n of ['Wing build', 'Motor test', 'Spar order']) { await A.click('.col-add'); await dialog(A, n); }
  await edit(A, 'Wing build', (t) => { t.subtasks = ['Cut ribs', 'Glue spar', 'Cover'].map((title, i) => ({ id: 'st' + i, title, completed: false })); });
  await A.click('#top-actions button:has-text("Invite")');
  await A.fill('.settings-pane textarea', 'tom@uni.ac.uk'); await A.locator('.settings-pane form select').selectOption('admin');
  await A.click('.settings-pane button:has-text("Invite")'); await sleep(200); await A.keyboard.press('Escape');
  const B = await tab('Tom');
  await signIn(B, 'Tom Reed', 'tom@uni.ac.uk');
  await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat'); await sleep(600);
  ok((await shown(B, 'Wing build'))?.subtasks.length === 3, 'Tom sees the task with its 3 sub-tasks');

  step('Both tick a different sub-task of the same task at the same moment');
  await hold(A, B);
  await edit(A, 'Wing build', (t) => { t.subtasks[0].completed = true; });
  await edit(B, 'Wing build', (t) => { t.subtasks[1].completed = true; });
  let T = await storedTask(A, 'Wing build');
  ok(T.subtasks[0].completed === false && T.subtasks[1].completed === true, '(Tom’s later save overwrote Aisha’s tick at first)');
  await release(A, B);
  T = await storedTask(A, 'Wing build');
  ok(T.subtasks[0].completed && T.subtasks[1].completed && !T.subtasks[2].completed, 'both ticks are saved');
  ok((await shown(A, 'Wing build')).subtasks.filter(x => x.completed).length === 2 && (await shown(B, 'Wing build')).subtasks.filter(x => x.completed).length === 2, 'both boards show 2 of 3 done');

  step('Both add a sub-task at the same moment');
  await hold(A, B);
  await edit(A, 'Wing build', (t) => { t.subtasks.push({ id: 'stA', title: 'Sand edges', completed: false }); });
  await edit(B, 'Wing build', (t) => { t.subtasks.push({ id: 'stB', title: 'Weigh wing', completed: false }); });
  await release(A, B);
  T = await storedTask(A, 'Wing build');
  ok(T.subtasks.length === 5 && T.subtasks.some(x => x.title === 'Sand edges') && T.subtasks.some(x => x.title === 'Weigh wing'), 'both new sub-tasks are kept');

  step('One ticks a sub-task while the other deletes another one');
  await hold(A, B);
  await edit(A, 'Wing build', (t) => { t.subtasks.find(x => x.id === 'st2').completed = true; });
  await edit(B, 'Wing build', (t) => { t.subtasks = t.subtasks.filter(x => x.id !== 'stA'); });
  await release(A, B);
  T = await storedTask(A, 'Wing build');
  ok(T.subtasks.length === 4 && !T.subtasks.some(x => x.id === 'stA') && T.subtasks.find(x => x.id === 'st2').completed, 'the deletion and the tick both stick');

  step('Both rename the same sub-task differently: they settle on one name');
  await hold(A, B);
  await edit(A, 'Wing build', (t) => { t.subtasks.find(x => x.id === 'stB').title = 'Weigh wing (A)'; });
  await edit(B, 'Wing build', (t) => { t.subtasks.find(x => x.id === 'stB').title = 'Weigh wing (B)'; });
  await release(A, B); await sleep(600);
  const ta = (await shown(A, 'Wing build')).subtasks.find(x => x.id === 'stB').title, tb = (await shown(B, 'Wing build')).subtasks.find(x => x.id === 'stB').title;
  T = await storedTask(A, 'Wing build');
  ok(ta === tb && T.subtasks.find(x => x.id === 'stB').title === ta, `both boards and the saved data agree (“${ta}”)`);
  const at1 = T.updatedAt; await sleep(1200);
  ok((await storedTask(A, 'Wing build')).updatedAt === at1, 'and nobody keeps re-saving it');

  step('Different fields of the same task');
  await hold(A, B);
  await edit(A, 'Spar order', (t) => { t.priority = 'Critical'; });
  await edit(B, 'Spar order', (t) => { t.jiraId = 'SKY-42'; });
  await release(A, B);
  T = await storedTask(A, 'Spar order');
  ok(T.priority === 'Critical' && T.jiraId === 'SKY-42', 'both changes are saved');

  step('Both add a week at the same moment');
  const weeks0 = (await stored(A)).doc.weeks.length;
  await hold(A, B);
  await A.evaluate(() => addWeek('WEEK A')); await B.evaluate(() => addWeek('WEEK B'));
  await release(A, B);
  const W = (await stored(A)).doc.weeks;
  ok(W.length === weeks0 + 2 && W.some(w => w.title === 'WEEK A') && W.some(w => w.title === 'WEEK B'), 'both new weeks are kept');
  ok((await A.evaluate(() => weeksData.length)) === weeks0 + 2 && (await B.evaluate(() => weeksData.length)) === weeks0 + 2, 'both boards show them');

  step('Editing a task someone else has just deleted');
  await hold(A, B);
  await B.evaluate(() => { const l = allTaskLocs().find(x => x.task.name === 'Motor test'); activeNode = { type: 'task', id: l.task.id }; _deleteActiveNodeCore(); });
  await A.evaluate(() => { allTaskLocs().find(x => x.task.name === 'Motor test').task.priority = 'Major'; allTaskLocs().find(x => x.task.name === 'Spar order').task.status = 'Ordered'; saveDatabase(); render(); });
  await sleep(300);
  ok(!(await A.locator('.toast', { hasText: 'Not saved' }).count()) && !/Not saved/.test(await status(A)), 'Aisha’s save doesn’t fail');
  ok((await A.locator('.toast', { hasText: 'just deleted' }).count()) === 1, 'she is told the task was deleted by someone else');
  await release(A, B);
  ok(!(await storedTask(A, 'Motor test')), 'the deleted task stays deleted');
  ok((await storedTask(A, 'Spar order')).status === 'Ordered', 'her other change in the same save is kept');
  ok(!(await shown(A, 'Motor test')), 'and it disappears from her board');

  step('A teammate’s change arrives while the editor is open');
  await A.locator('.task-card', { hasText: 'Spar order' }).first().click(); await A.waitForSelector('#edit-form', { state: 'visible' });
  const nameBox = A.locator('#edit-name'); await nameBox.click(); await nameBox.press('End'); await nameBox.type(' v2');
  await edit(B, 'Wing build', (t) => { t.priority = 'Major'; }); await sleep(700);
  ok((await nameBox.inputValue()).endsWith(' v2'), 'what Aisha is typing isn’t wiped');
  ok((await A.locator('.task-card', { hasText: 'Spar order v2' }).count()) === 1, 'the card shows it too');
  await nameBox.press('Tab'); await sleep(300);
  ok(!!(await storedTask(A, 'Spar order v2')), 'and it is saved when she leaves the box');
  ok((await storedTask(A, 'Wing build')).priority === 'Major', 'Tom’s change is saved too');

  ok(!/Not saved/.test(await status(A)) && !/Not saved/.test(await status(B)), 'no “Not saved” anywhere');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 4).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
