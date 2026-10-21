// Navigation setting: top bar (default) or sidebar, folding down to icons; saved to the account; phones keep the top bar.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
const store = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('tt_demo_store_v1')));
const shot = async (n) => { if (SHOTS) await p.screenshot({ path: SHOTS + '/' + n + '.png' }); };

try {
  step('Default: the top bar');
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Nav Tester'); await p.fill('#auth-actions input[type=email]', 'nav@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.fill('#create-team-form input[name=name]', 'Nav Lab'); await p.click('#create-team-form button[type=submit]');
  await p.waitForSelector('.node-cat'); await sleep(400);
  let bar = await p.locator('#top-bar').boundingBox();
  ok(bar.width > 900 && bar.y < 5 && bar.height < 120, 'the tools run along the top');
  ok(!(await p.locator('.nav-group').first().isVisible()) && !(await p.locator('#nav-collapse').isVisible()), 'no sidebar bits in top-bar mode');

  step('Account ▸ Navigation ▸ Sidebar');
  await p.evaluate(() => TT.openAccount()); await p.waitForSelector('[data-nav="side"]');
  ok(await p.locator('[data-nav="top"][aria-checked=true]').count() === 1, 'Top bar is ticked to start with');
  await p.click('[data-nav="side"]'); await sleep(300);
  ok(await p.locator('[data-nav="side"][aria-checked=true]').count() === 1, 'Sidebar ticked');
  const me = Object.values((await store()).users).find(u => u.email === 'nav@uni.ac.uk');
  ok(me && me.nav === 'side', 'saved to the account');
  await p.keyboard.press('Escape'); await sleep(300);
  bar = await p.locator('#top-bar').boundingBox();
  ok(bar.x === 0 && bar.width > 200 && bar.width < 260 && bar.height > 800, 'the tools sit in a left sidebar');
  const canvas = await p.locator('#canvas-container').boundingBox();
  ok(canvas.x >= bar.width - 1, 'the board starts beside the sidebar, not under it');
  ok(await p.locator('.nav-group', { hasText: 'Views' }).isVisible() && await p.locator('.nav-group', { hasText: 'Team' }).isVisible(), 'group headings show');
  ok(await p.locator('#search-btn .act-lbl').isVisible() && await p.locator('[data-nav="18"] .lbl-lg').isVisible(), 'every button has its label');
  const s1 = await p.locator('#search-btn').boundingBox(), s2 = await p.locator('[data-nav="18"]').boundingBox();
  ok(s2.y > s1.y + 200 && Math.abs(s1.x - s2.x) < 2, 'buttons stack down the sidebar');
  const gr = await p.locator('.nav-group', { hasText: 'Team' }).boundingBox();
  ok(gr.y < (await p.locator('[data-nav="15"]').boundingBox()).y && gr.y > (await p.locator('[data-nav="13"]').boundingBox()).y, 'Invite sits under the Team heading, Tools above it');
  await p.click('[data-view="kanban"]'); await sleep(300);
  ok(await p.locator('body.view-kanban, body[class*="kanban"]').count() >= 0 && await p.locator('[data-view="kanban"][aria-pressed=true]').count() === 1, 'the view buttons still work');
  await p.click('[data-view="board"]'); await sleep(200);
  await shot('nav-side');

  step('Fold down to icons');
  await p.click('#nav-collapse'); await sleep(350);
  bar = await p.locator('#top-bar').boundingBox();
  ok(bar.width < 80, 'an icon rail');
  ok(!(await p.locator('#search-btn .act-lbl').isVisible()), 'labels hidden in the rail');
  ok((await p.locator('#search-btn').getAttribute('aria-label')) === 'Search', 'buttons keep their names for screen readers');
  ok((await p.locator('#nav-collapse').getAttribute('aria-expanded')) === 'false', 'collapse button says folded');
  await shot('nav-rail');

  step('Remembered after a reload');
  await p.reload(); await p.waitForSelector('.node-cat'); await sleep(400);
  ok(await p.evaluate(() => document.body.classList.contains('nav-side') && document.body.classList.contains('nav-rail')), 'still a folded sidebar');
  await p.click('#nav-collapse'); await sleep(300);
  ok((await p.locator('#top-bar').boundingBox()).width > 200, 'unfolds again');

  step('A new browser picks it up from the account');
  const p2 = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
  await p2.goto(BASE); await p2.evaluate(s => localStorage.setItem('tt_demo_store_v1', s), JSON.stringify(await store()));
  await p2.goto(BASE); await p2.waitForSelector('#auth-screen:not([hidden]), #home-screen:not([hidden])');
  if (await p2.locator('#auth-screen:not([hidden])').count()) {
    await p2.fill('#auth-actions input[placeholder="Your name"]', 'Nav Tester'); await p2.fill('#auth-actions input[type=email]', 'nav@uni.ac.uk');
    await p2.click('#auth-actions button:has-text("Sign in to demo")'); await p2.waitForSelector('#home-screen:not([hidden])');
  }
  await sleep(300);
  ok(await p2.evaluate(() => document.body.classList.contains('nav-side')), 'sidebar on in the other browser');
  await p2.close();

  step('Phone keeps the top bar');
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(400);
  bar = await p.locator('#top-bar').boundingBox();
  ok(bar.y < 5 && bar.width > 380 && bar.height < 90, 'top bar on a phone');
  ok(!(await p.locator('.nav-group').first().isVisible()), 'no headings on a phone');

  step('Back to the top bar');
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.evaluate(() => TT.openAccount()); await p.click('[data-nav="top"]'); await p.keyboard.press('Escape'); await sleep(300);
  bar = await p.locator('#top-bar').boundingBox();
  ok(bar.width > 900 && bar.height < 120, 'top bar again');
  ok(await p.evaluate(() => document.getElementById('top-bar').dataset.tight) !== undefined, 'top bar fitting still runs');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 8).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
