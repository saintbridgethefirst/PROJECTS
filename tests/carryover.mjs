// Auto carry-over: unfinished tasks from past weeks roll into the current week when the setting
// is on; completed tasks don't; it runs once (idempotent) and respects edit permissions.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const monday = () => { const x = new Date(); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toLocaleDateString('en-CA'); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
const team = () => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const tasksNamed = async (name) => Object.values((await team()).tasks || {}).filter(t => t.name === name);
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(200); } return false; };

try {
  step('A team with two past weeks and a current week');
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Aisha Khan'); await p.fill('#auth-actions input[type=email]', 'aisha@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.fill('#create-team-form input[name=name]', 'Carry Lab');
  await p.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; });
  await p.click('#create-team-form button[type=submit]'); await p.waitForSelector('.node-cat'); await sleep(400);

  // WEEK 1 two weeks ago, WEEK 2 last week, WEEK 3 this week (current). One unfinished + one done in WEEK 1.
  await p.evaluate((m) => {
    const wk = (n) => { const x = new Date(m); x.setDate(x.getDate() + 7 * n); return x.toLocaleDateString('en-CA'); };
    weeksData[0].startDate = wk(-2); weeksData[0].title = 'WEEK 1';
    weeksData.push({ key: 'wk_2', title: 'WEEK 2', metric: '', collapsed: false, startDate: wk(-1) },
      { key: 'wk_3', title: 'WEEK 3', metric: '', collapsed: false, startDate: wk(0) });
    db.forEach(pp => pp.categories.forEach(c => { c.wk_2 = c.wk_2 || []; c.wk_3 = c.wk_3 || []; }));
    const c = db.find(x => x.id === TT.me.uid).categories[0];
    c[weeksData[0].key] = [
      { id: 'tKeep', type: 'task', name: 'Carry me', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [] },
      { id: 'tDone', type: 'task', name: 'Done already', priority: 'Minor', status: '', flag: 'completed', completedDate: wk(-2), subtasks: [], history: [] },
    ];
    saveDatabase(); render();
  }, monday());
  await sleep(600);
  ok((await tasksNamed('Carry me')).length === 1 && (await tasksNamed('Done already')).length === 1, 'one of each to start');

  step('Turning on auto carry-over');
  await p.evaluate(() => TT.openSettings('workflow')); await p.waitForSelector('#auto-carry');
  ok(!(await p.locator('#auto-carry').isChecked()), 'off by default');
  await p.click('#auto-carry'); await p.click('#auto-settings button:has-text("Save")'); await sleep(400);
  ok((await team()).doc.autos.carry === true, 'the setting is saved on the team');
  await p.keyboard.press('Escape'); await sleep(300);

  step('Unfinished work is carried into the current week; finished work is not');
  ok(await until(async () => (await tasksNamed('Carry me')).length === 2), 'a copy of the unfinished task appears');
  const copies = await tasksNamed('Carry me');
  const inWeek3 = copies.filter(t => t.weekId === 'wk_3');
  ok(inWeek3.length === 1, 'the copy is in the current week (WEEK 3)');
  ok(inWeek3[0].carryOf === 'tKeep' || copies.some(t => t.carryOf), 'the copy is linked to the original (carry chain)');
  ok(inWeek3[0].flag !== 'completed' && (inWeek3[0].signoff == null), 'the copy is unfinished and carries no old sign-off');
  ok((await tasksNamed('Done already')).length === 1, 'the completed task is not carried');
  ok(JSON.stringify(inWeek3[0].history).includes('Carried forward'), 'the copy records the carry in its history');

  step('It runs only once (no duplicates on the next check)');
  await p.evaluate(() => { const c = db.find(x => x.id === TT.me.uid).categories[0]; c.wk_3 = c.wk_3 || []; saveDatabase(); }); // trigger another autos pass
  await sleep(1500);
  ok((await tasksNamed('Carry me')).length === 2, 'still exactly one carried copy');

  step('The board flags a task that has carried over too many times');
  await p.evaluate(() => TT.openSettings('workflow')); await p.waitForSelector('#auto-carry-warn');
  await p.fill('#auto-carry-warn', '1'); await p.click('#auto-settings button:has-text("Save")'); await sleep(300);
  await p.keyboard.press('Escape'); await sleep(500);
  ok(await until(() => p.locator('.carry-chip.carry-stuck').count().then(n => n > 0)), 'a “stuck” amber chip shows on the long-carried task');
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
