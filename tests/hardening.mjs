// The 28 Oct follow-up fixes: a strict script policy (no inline script anywhere, buttons still work), undo
// brings back a signed-off task with its approval, names on records come from the team, and the platform
// admin's App Check card.
// Needs the preview server:  npx vite preview --port 4173  (it sends the site's real security headers)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
/** A page that records page errors and anything the security policy blocks. */
async function page(ctx) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && /Content Security Policy|security policy/i.test(m.text())) errors.push('CSP: ' + m.text().slice(0, 200)); });
  p.on('dialog', d => d.accept());
  return p;
}
const store = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);

try {
  step('The site sends a strict script policy');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const r = await ctx.request.get(BASE);
  const csp = r.headers()['content-security-policy'] || '';
  ok(/script-src 'self'/.test(csp) && !/unsafe-inline/.test(csp) && !/unsafe-eval/.test(csp), 'script-src without unsafe-inline or unsafe-eval: ' + csp.slice(0, 80));
  ok(/object-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp), 'no plugins, no framing');

  step('Public pages run their scripts from files (nothing blocked)');
  const pub = await page(ctx);
  for (const path of ['', 'guide.html', 'blog/', 'blog/how-to-plan-a-dissertation.html', 'dissertation', 'formula-student', 'privacy.html']) {
    await pub.goto(BASE + path, { waitUntil: 'networkidle' }); await sleep(150);
  }
  await pub.goto(BASE + 'templates/dissertation-gantt-chart', { waitUntil: 'networkidle' });
  ok(await pub.locator('#g-chart .bar').count() > 3, 'the Gantt chart template draws its chart');
  await pub.goto(BASE + 'guide.html', { waitUntil: 'networkidle' });
  await pub.locator('.step').first().click(); await sleep(100);
  ok(await pub.locator('.step.done').count() === 1, 'the guide’s checklist ticks');

  step('The loading screen: the mark with five points and the light, a fun fact, and Reload if it’s slow');
  const slowCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Hold the app back so the loading screen stays (and mark a fresh start as just done, so it doesn't reload)
  await slowCtx.addInitScript(() => { try { localStorage.setItem('tt_signed_in', '1'); sessionStorage.setItem('tt_fresh_at', String(Date.now())); } catch { /* */ } });
  await slowCtx.route(/\/assets\/index-.*\.js$/, r => r.abort());
  const ld = await slowCtx.newPage(); await ld.clock.install();
  await ld.goto(BASE); await ld.clock.runFor(1500);
  ok(await ld.locator('#loading .ld-pt').count() === 5 && await ld.locator('#loading .ld-spark').count() === 1, 'five points and the light');
  ok(await ld.locator('#ld-fact').isVisible() && (await ld.locator('#ld-fact-text').textContent()).length > 20, 'a fun fact or tip');
  const first = await ld.locator('#ld-fact-text').textContent(); await ld.clock.runFor(6500);
  ok((await ld.locator('#ld-fact-text').textContent()) !== first, 'the next one a few seconds later');
  await slowCtx.close();

  step('If the app’s own script can’t load (an old page after a release), it starts fresh once, then offers Reload');
  const oldCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await oldCtx.addInitScript(() => { try { localStorage.setItem('tt_signed_in', '1'); } catch { /* */ } });
  await oldCtx.route(/\/assets\/index-.*\.js$/, r => r.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>Not found</title>' }));
  const old = await oldCtx.newPage(); let loads = 0; old.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === old.mainFrame()) loads++; });
  await old.goto(BASE);
  for (let t = 0; t < 40 && loads < 2; t++) await sleep(200);
  await sleep(2500);   // and no third load after it
  ok(loads === 2, 'reloaded once by itself (' + loads + ' page loads), not in a loop');
  ok(await old.locator('#ld-slow').isVisible(), 'then offers Reload straight away');
  await oldCtx.close();

  step('Board buttons and fields still work (data-onclick, no inline script)');
  const p = await page(ctx);
  await p.goto(BASE + 'demo'); await p.waitForSelector('.demo-kind');
  await p.click('.demo-kind[data-kind="drone"]'); await p.fill('#demo-name', 'Sam'); await p.click('#demo-go');
  await p.waitForSelector('.task-card', { timeout: 20000 }); await sleep(1500);
  ok(await p.locator('#loading').isHidden(), 'the loading screen goes once the board is up');
  await p.evaluate(() => document.querySelectorAll('[class*=tour-]').forEach(e => e.remove()));
  await p.click('.top-btn[data-view="kanban"]'); await sleep(400);
  ok(await p.locator('.top-btn[data-view="kanban"][aria-pressed="true"]').count() === 1, 'the Kanban view button switches the view');
  await p.click('.top-btn[data-view="board"]'); await sleep(400);
  await p.evaluate(() => window.boardPanel && window.boardPanel(true)); await sleep(200);
  const before = await p.locator('.task-card:visible').count();
  await p.fill('#search-tasks', 'zzzz-nothing-matches'); await sleep(400);
  ok((await p.locator('.task-card:visible').count()) < before, 'typing in search filters the board (data-oninput)');
  await p.fill('#search-tasks', ''); await sleep(300);
  const id = await p.evaluate(() => { const c = [...document.querySelectorAll('.task-card')].find(x => x.querySelector('.subtask-item')); return c && c.id; });
  const ticked = (q) => p.evaluate((tid) => { const t = Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0].tasks[tid]; return t.subtasks.filter(s => s.completed).length; }, q);
  const n0 = await ticked(id);
  await p.locator('#' + id + ' .subtask-item').first().click(); await sleep(600);
  ok((await ticked(id)) !== n0, 'ticking a sub-task on a card saves it (data-onclick with event and ids)');

  step('Undo brings back a deleted, signed-off task with its approval');
  const T = await store(p);
  const signedId = Object.keys(T.tasks).find(k => T.tasks[k].signoff && T.tasks[k].signoff.status === 'approved');
  ok(!!signedId, 'the sample has a signed-off task');
  await p.evaluate((tid) => { window.boardOpenTask(tid); deleteActiveNode(); }, signedId); await sleep(700);
  let S = await store(p);
  ok(!S.tasks[signedId] && S.removed && S.removed[signedId] && S.removed[signedId].signoff.status === 'approved', 'deleted, with its decision kept beside it');
  await p.evaluate(() => TT.undo()); await sleep(800);
  S = await store(p);
  ok(S.tasks[signedId] && S.tasks[signedId].signoff && S.tasks[signedId].signoff.status === 'approved', 'undo: the task is back, still signed off');
  ok(!(S.removed && S.removed[signedId]), 'and the kept decision was taken back');

  step('Names on records come from the team, not from what was stored');
  const mine = await p.evaluate(() => window.boardAddTask({ ownerUid: TT.me.uid, name: 'Name check task' }).id); await sleep(400);
  await p.evaluate(async (tid) => TT.writeOps([{ type: 'set', path: 'comments/cm_fake', data: { taskId: tid, authorUid: TT.me.uid, authorName: 'Prof Fake', text: 'Quokka review note', mentions: [], createdAt: Date.now() } }]), mine); await sleep(500);
  await p.evaluate(() => TT.openSearch()); await p.waitForSelector('.cmdk-input');
  await p.keyboard.type('Quokka'); await sleep(500);
  const hit = await p.locator('.cmdk-list').textContent();
  ok(hit.includes('Sam') && !hit.includes('Prof Fake'), 'search shows the writer’s team name: ' + hit.slice(0, 120));
  await p.keyboard.press('Escape'); await sleep(200);

  step('Platform admin: App Check on server calls, with a switch');
  await p.evaluate(() => TT.demoMakeAdmin()); await sleep(300);
  await p.evaluate(() => TT.openSettings('plan')); await p.waitForSelector('#adm-appcheck input[role=switch]', { timeout: 8000 });
  ok((await p.locator('#adm-appcheck').textContent()).includes('Last 7 days'), 'it shows the last week’s counts');
  ok(!(await p.locator('#adm-appcheck-on').isChecked()), 'off to start with');
  await p.locator('label[for="adm-appcheck-on"]').click(); await sleep(500);   // the confirm (few calls verified) is accepted
  ok(await p.locator('#adm-appcheck-on').isChecked(), 'switched on');
  await p.keyboard.press('Escape');
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 8)); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
