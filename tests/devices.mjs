// From the sweep of every view on a phone, an iPad and a desktop (28 Oct 2026): the board opens on this
// week, Tools and the report fill a phone screen, Approvals says when nothing is waiting, emoji-only
// buttons keep an icon in the Professional look, the open settings tab stays in view on a phone, and the
// sample's @mention names the visitor.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
async function sample(viewport, kind, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'demo'); await p.waitForSelector('.demo-kind');
  if (kind === 'diss') { await p.fill('#demo-name', 'Sam'); await p.click('#demo-diss-sample'); }
  else { await p.click(`.demo-kind[data-kind="${kind}"]`); await p.fill('#demo-name', 'Sam'); await p.click('#demo-go'); }
  await p.waitForSelector('.task-card', { timeout: 20000 }); await sleep(1800);
  await p.evaluate(() => document.querySelectorAll('[class*=tour-]').forEach(e => e.remove()));
  return p;
}
const inView = (p) => p.evaluate(() => {
  const w = document.querySelector('.header-week.current-week'); const cc = document.getElementById('canvas-container'); const b = document.getElementById('brand-block');
  if (!w) return false; const r = w.getBoundingClientRect(), c = cc.getBoundingClientRect(), l = b ? b.getBoundingClientRect().right : c.left;
  return r.left >= l - 2 && r.right <= c.right + 2;
});

try {
  step('Desktop: the board opens on this week');
  const d = await sample({ width: 1440, height: 900 }, 'drone');
  ok(await inView(d), 'this week is in view (not the Backlog and first weeks)');
  ok((await d.locator('#activity-btn').count()) === 1, 'board ready');
  await d.evaluate(() => TT.openActivity()); await sleep(400);
  ok((await d.locator('.modal').textContent()).includes('@Sam'), 'the sample’s @mention names the visitor');
  await d.keyboard.press('Escape');

  step('iPad and phone: also on this week');
  const ipad = await sample({ width: 820, height: 1180 }, 'drone', { isMobile: true, hasTouch: true });
  ok(await inView(ipad), 'iPad: this week is in view');
  const ph = await sample({ width: 390, height: 844 }, 'drone', { isMobile: true, hasTouch: true });
  ok(await inView(ph), 'phone: this week is in view');

  step('Phone: Tools and the progress report fill the screen');
  await ph.evaluate(() => TT.openResearch()); await sleep(500);
  let box = await ph.locator('.modal.research-modal').boundingBox();
  ok(box && box.height >= 843 && box.y <= 1, 'Tools fills the screen (' + (box && Math.round(box.height)) + 'px)');
  await ph.keyboard.press('Escape'); await sleep(200);
  await ph.evaluate(() => TT.openReport()); await sleep(800);
  box = await ph.locator('.modal.report-modal').boundingBox();
  ok(box && box.height >= 843, 'the progress report fills the screen');
  await ph.keyboard.press('Escape'); await sleep(200);

  step('Phone: the open settings tab is in view');
  await ph.evaluate(() => TT.openSettings('phases')); await sleep(500);
  ok(await ph.evaluate(() => { const n = document.querySelector('.settings-nav'); const b = n.querySelector('button.on'); const r = b.getBoundingClientRect(), q = n.getBoundingClientRect(); return b.textContent.includes('Phases') && r.left >= q.left - 1 && r.right <= q.right + 1; }), 'Phases is scrolled into view');
  await ph.keyboard.press('Escape');

  step('Approvals with nothing waiting says so');
  const diss = await sample({ width: 1280, height: 860 }, 'diss');
  await diss.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(o => o.remove()); openApprovals(); }); await sleep(400);
  ok(await diss.locator('#approvals-modal .so-empty').isVisible(), 'an empty Approvals window explains what shows there');

  step('Professional look: emoji-only buttons keep an icon');
  const corp = await sample({ width: 1440, height: 900 }, 'corporate');
  const id = await corp.evaluate(() => { const c = [...document.querySelectorAll('.task-card')].find(x => x.querySelector('.subtask-item')); return c && c.id; });
  await corp.evaluate((tid) => { window.boardOpenTask(tid); window.boardEditorTab('task'); window.boardPanel(true); }, id); await sleep(500);
  const del = corp.locator('#edit-form .st-del').first();
  ok(await del.isVisible() && (await del.locator('svg').count()) === 1 && (await del.getAttribute('aria-label')).startsWith('Delete sub-task'), 'the sub-task delete button shows an × icon and has a name');
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
