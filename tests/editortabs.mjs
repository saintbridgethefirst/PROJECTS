// The task editor: the task's header stays at the top, four tabs (Task · Plan · Files · Activity) hold the
// rest, search and filters come back when no task is open, "one list" shows every part in turn, and on a
// phone the editor slides up from the bottom. Friendly and Professional looks both draw the header icon.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

async function openSample(viewport, sample = 'drone') {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Robin'); await p.fill('#auth-actions input[type=email]', 'robin@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.click(sample === 'drone' ? '#demo-sample' : '#demo-sample-' + sample); await p.waitForSelector('.task-card', { timeout: 20000 }); await sleep(800);
  return { ctx, p };
}
const visible = (p, sel) => p.locator(sel).first().isVisible().catch(() => false);

try {
  const { ctx, p } = await openSample({ width: 1440, height: 900 });

  step('No task open: search and filters');
  ok(await visible(p, '#search-tasks') && await visible(p, '.filter-container'), 'search and filters show');
  ok(await p.locator('#editor-panel.ed-task').count() === 0, 'not in task mode');

  step('Open a task: its header and the Task tab');
  const withFiles = p.locator('.task-card:has(.att-chip)').first();
  const filesOnCard = Number(((await withFiles.locator('.att-chip').textContent()) || '').match(/\d+/)[0]);
  await withFiles.click(); await sleep(500);
  ok(await p.locator('#editor-panel.ed-task').count() === 1, 'task mode');
  ok(!(await visible(p, '#search-tasks')) && !(await visible(p, '.filter-container')), 'search and filters step aside');
  ok(await visible(p, '.ed-head #edit-name') && await visible(p, '.ed-head .ed-ref') && (await p.textContent('.ed-meta')).includes('·'), 'title, reference and owner · week · row at the top');
  ok(await p.locator('.ed-tab').count() === 4 && (await p.getAttribute('#ed-tab-task', 'aria-selected')) === 'true', 'four tabs, Task first');
  ok(await visible(p, '#edit-flag') && await visible(p, '#edit-priority') && await visible(p, '#edit-support'), 'status, priority and people on the Task tab');
  ok(!(await visible(p, '#edit-effort')) && !(await visible(p, '.comments-section')), 'plan and comments wait in their tabs');
  const filesCount = await p.locator('#ed-tab-files .ed-count').textContent().catch(() => '');
  ok(Number(filesCount) >= filesOnCard, 'the Files tab counts the files: ' + filesCount);
  ok(await p.evaluate(() => { const h = document.querySelector('.ed-head'); return getComputedStyle(h).position === 'sticky'; }), 'the header stays put while the panel scrolls');

  step('Plan: change the effort, stay on Plan');
  await p.click('#ed-tab-plan'); await sleep(200);
  ok((await p.getAttribute('#ed-tab-plan', 'aria-selected')) === 'true' && await visible(p, '#edit-effort'), 'the Plan tab shows effort');
  ok(!(await visible(p, '#edit-flag')), 'and hides the Task tab');
  await p.fill('#edit-effort', '7'); await p.dispatchEvent('#edit-effort', 'change'); await sleep(500);
  ok((await p.getAttribute('#ed-tab-plan', 'aria-selected')) === 'true' && (await p.inputValue('#edit-effort')) === '7', 'still on Plan after the editor redraws');

  step('Keyboard: arrows move between tabs');
  await p.focus('#ed-tab-plan'); await p.keyboard.press('ArrowRight'); await sleep(150);
  ok((await p.getAttribute('#ed-tab-files', 'aria-selected')) === 'true' && await p.evaluate(() => document.activeElement.id === 'ed-tab-files'), 'ArrowRight → Files');
  ok(await visible(p, '#editor-panel .att-list, #editor-panel .att-item'), 'the Files tab shows the files');
  await p.keyboard.press('ArrowRight'); await sleep(150);
  ok((await p.getAttribute('#ed-tab-activity', 'aria-selected')) === 'true' && await visible(p, '.comments-section'), 'ArrowRight → Activity, with comments');
  ok(await visible(p, '.ed-history .history-box'), 'and the history');

  step('Another task starts on the Task tab');
  await p.locator('.task-card:not(:has(.att-chip))').nth(1).click(); await sleep(400);
  ok((await p.getAttribute('#ed-tab-task', 'aria-selected')) === 'true', 'Task tab again');

  step('Back to search and filters');
  await p.click('.ed-back'); await sleep(300);
  ok(await p.locator('#editor-panel.ed-task').count() === 0 && await visible(p, '#search-tasks'), 'search and filters are back');

  step('One list, and back to tabs');
  await p.locator('.task-card').nth(3).click(); await sleep(400);
  await p.click('.ed-layout button'); await sleep(400);
  ok(await p.locator('.ed-tabs').count() === 0 && await visible(p, '#edit-flag') && await visible(p, '#edit-effort') && await visible(p, '.comments-section'), 'every part shows in turn');
  ok(await p.locator('.ed-pane-title').count() === 3, 'with a heading for Plan, Files and Activity');
  ok(await p.evaluate(() => localStorage.getItem('tt_editor_layout')) === 'list', 'remembered on this device');
  await p.click('.ed-layout button'); await sleep(400);
  ok(await p.locator('.ed-tabs').count() === 1 && !(await visible(p, '#edit-effort')), 'tabs again');

  step('Hide the panel from the header, open a task to bring it back');
  await p.click('.ed-close'); await sleep(450);
  ok(await p.locator('#editor-panel.hidden').count() === 1, 'the panel hides');
  await p.locator('.task-card').nth(2).click(); await sleep(450);
  ok(await p.locator('#editor-panel.hidden').count() === 0 && await visible(p, '.ed-tabs'), 'opening a task shows it again');

  step('Friendly look: the header icon');
  const withIcon = p.locator('.task-card:has(.task-icon)').first(); await withIcon.click(); await sleep(400);
  const box = await p.locator('.ed-title-row .ed-icon').boundingBox();
  ok(box && Math.round(box.width) === 40 && Math.round(box.height) === 40, 'a 40 px square: ' + JSON.stringify(box && [box.width, box.height]));
  await ctx.close();

  step('Professional look (the company sample)');
  const pro = await openSample({ width: 1440, height: 900 }, 'corporate');
  ok(await pro.p.evaluate(() => document.body.classList.contains('look-pro')), 'Professional look');
  await pro.p.locator('.task-card:has(.task-icon.has-line)').first().click(); await sleep(500);
  const ib = await pro.p.locator('.ed-title-row .ed-icon').boundingBox();
  ok(ib && Math.round(ib.width) === 40 && Math.round(ib.height) === 40 && await pro.p.locator('.ed-title-row .ed-icon svg').count() === 1, 'a line icon in the same 40 px square');
  const tabsY = await pro.p.evaluate(() => [...document.querySelectorAll('.ed-tab')].map(t => Math.round(t.getBoundingClientRect().top)));
  ok(new Set(tabsY).size === 1, 'the tabs sit on one line');
  await pro.ctx.close();

  step('Phone: the editor slides up from the bottom');
  const ph = await openSample({ width: 390, height: 844 });
  ok(await ph.p.locator('#editor-panel.hidden').count() === 1, 'no panel until a task is opened');
  await ph.p.locator('.task-card').nth(1).click(); await sleep(600);
  const sheet = await ph.p.locator('#editor-panel').boundingBox();
  ok(sheet && sheet.y > 30 && Math.round(sheet.y + sheet.height) === 844 && Math.round(sheet.width) === 390, 'a sheet from the bottom: ' + JSON.stringify(sheet));
  ok(await visible(ph.p, '.ed-grip') && await visible(ph.p, '.ed-tabs'), 'with a grip and the tabs');
  const tabH = await ph.p.locator('#ed-tab-plan').boundingBox();
  ok(tabH && tabH.height >= 40, 'tabs big enough for a thumb');
  await ph.p.click('#ed-tab-activity'); await sleep(200);
  ok(await visible(ph.p, '.comments-section'), 'Activity on a phone');
  await ph.p.click('.ed-close'); await sleep(450);
  ok(await ph.p.locator('#editor-panel.hidden').count() === 1, 'the cross closes the sheet');
  await ph.ctx.close();
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
