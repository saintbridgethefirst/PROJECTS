// The glass sidebar (Account ▸ Appearance ▸ Navigation ▸ Glass): a floating pane with the team as the
// workspace, search, the views in one row, your projects (every team you're in) to switch between,
// a lens that follows the pointer, names beside the icons when folded, night mode and you at the bottom.
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
const newTeam = async (name) => {
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForSelector('#home-screen:not([hidden])');
  await p.fill('#create-team-form input[name=name]', name); await p.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; });
  await p.click('#create-team-form button[type=submit]'); await p.waitForSelector('.node-cat'); await sleep(500);
};
/** Where the lens is, in the page (it sits inside the pane). */
const lensAt = () => p.evaluate(() => { const l = document.querySelector('.glass-lens'); const r = l.getBoundingClientRect(); return { y: r.top, h: r.height, shown: l.classList.contains('shown') }; });
const topOf = async (sel) => (await p.locator(sel).first().boundingBox()).y;

try {
  step('Sign in, two teams');
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Glass Tester'); await p.fill('#auth-actions input[type=email]', 'glass@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await newTeam('Rocket Club');
  await newTeam('Glass Lab');

  step('Account ▸ Appearance ▸ Navigation ▸ Glass');
  await p.evaluate(() => TT.openAccount('appearance')); await p.waitForSelector('[data-nav="glass"]');
  ok(await p.locator('.seg-toggle [data-nav]').count() === 3, 'three choices: top bar, sidebar, glass');
  await p.click('[data-nav="glass"]'); await sleep(300);
  ok(await p.locator('[data-nav="glass"][aria-checked=true]').count() === 1, 'Glass ticked');
  const me = Object.values((await store()).users).find(u => u.email === 'glass@uni.ac.uk');
  ok(me && me.nav === 'glass', 'saved to the account');
  await p.keyboard.press('Escape'); await sleep(500);
  ok(await p.evaluate(() => document.body.classList.contains('nav-glass') && document.body.classList.contains('nav-side')), 'the glass sidebar is on');

  step('A floating pane of glass, the board beside it');
  const bar = await p.locator('#top-bar').boundingBox();
  ok(bar.x >= 8 && bar.y >= 8 && bar.height > 820 && bar.width > 240 && bar.width < 290, 'floats with a gap round it: ' + JSON.stringify(bar));
  const look = await p.evaluate(() => { const s = getComputedStyle(document.getElementById('top-bar')); return { r: s.borderTopLeftRadius, f: s.backdropFilter || s.webkitBackdropFilter }; });
  ok(parseFloat(look.r) >= 20 && /blur/.test(look.f), 'rounded and frosted: ' + JSON.stringify(look));
  const canvas = await p.locator('#canvas-container').boundingBox();
  ok(canvas.x >= bar.x + bar.width, 'the board starts beside the pane, not under it');

  step('The workspace at the top, then search, the views and your projects');
  ok((await p.locator('#team-switch .ws-name').textContent()) === 'Glass Lab', 'the team’s name');
  ok((await p.locator('#team-switch .ws-sub').textContent()) === 'Workspace · 1 member', 'and “Workspace · 1 member” under it');
  const head = await p.locator('#team-switch').boundingBox();
  ok(head.y > bar.y && head.y + head.height < bar.y + 80, 'right at the top, not clipped: ' + JSON.stringify(head));
  ok(await p.locator('#search-btn .glass-kbd').isVisible(), 'search shows its keyboard shortcut');
  ok(await topOf('#search-btn') < await topOf('.view-toggle'), 'search above the views');
  const views = await p.locator('.view-toggle .top-btn').evaluateAll(b => b.map(x => Math.round(x.getBoundingClientRect().top)));
  ok(views.length === 4 && new Set(views).size === 1, 'the four views in one row');
  ok(await topOf('#glass-projects') < await topOf('.nav-group:has-text("Work")'), 'Projects next, above Work');
  const projs = p.locator('.glass-proj:not(.new)');
  ok(await projs.count() === 2, 'Projects lists both teams');
  ok(await p.locator('.glass-proj.current').count() === 1 && (await p.locator('.glass-proj.current').textContent()).includes('Glass Lab'), 'the open one is marked');
  ok((await p.locator('.glass-proj.current').getAttribute('aria-current')) === 'page', 'for screen readers too');
  ok(await p.locator('.glass-proj .glass-dot').first().evaluate(d => getComputedStyle(d).backgroundColor !== 'rgba(0, 0, 0, 0)'), 'each has a coloured dot');
  const proj = await p.locator('.glass-proj.new').boundingBox();
  ok(proj && proj.y + proj.height < 900, 'Projects in view without scrolling');
  await shot('glass');

  step('The lens: follows the pointer, settles on the open view');
  await sleep(500);
  let L = await lensAt();
  ok(L.shown && Math.abs(L.y - await topOf('.view-toggle .top-btn.on')) < 3, 'rests on Board');
  await p.hover('#activity-btn'); await sleep(750);
  L = await lensAt();
  ok(Math.abs(L.y - await topOf('#activity-btn')) < 3, 'slides to Activity under the pointer');
  await p.mouse.move(900, 500); await sleep(750);
  L = await lensAt();
  ok(Math.abs(L.y - await topOf('.view-toggle .top-btn.on')) < 3, 'and back to Board when the pointer leaves');
  await p.click('.view-toggle [data-view="kanban"]'); await p.mouse.move(900, 500); await sleep(750);
  L = await lensAt();
  ok(Math.abs(L.y - await topOf('.view-toggle [data-view="kanban"]')) < 3, 'Kanban open: it rests there');
  await p.click('.view-toggle [data-view="board"]'); await sleep(300);

  step('Night mode, and you at the bottom');
  ok(await p.locator('.user-mail').first().isVisible() && (await p.locator('#floating-toggles .user-mail').textContent()) === 'glass@uni.ac.uk', 'your name and email');
  const night = p.locator('#glass-night');
  const dark0 = await p.evaluate(() => document.documentElement.getAttribute('data-theme') !== 'light');
  ok((await night.getAttribute('aria-checked')) === String(dark0), 'the switch shows the theme');
  await night.click(); await sleep(400);
  ok(await p.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light') === dark0, 'switched');
  ok((await night.getAttribute('aria-checked')) === String(!dark0), 'the switch follows');
  // A dark theme of your own comes back after a spell in the light
  await p.evaluate(() => TT.openThemes()); await p.click('.theme-card[data-theme="ocean"]'); await sleep(300); await p.keyboard.press('Escape'); await sleep(200);
  ok((await night.getAttribute('aria-checked')) === 'true', 'Ocean: night mode on');
  await night.click(); await sleep(300);
  ok(await p.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light'), 'off: a light theme');
  await night.click(); await sleep(300);
  ok(await p.evaluate(() => document.documentElement.getAttribute('data-pack') === 'ocean'), 'on again: back to Ocean, not Midnight');

  step('Switch project');
  await projs.filter({ hasText: 'Rocket Club' }).click();
  await p.waitForFunction(() => (document.querySelector('#team-switch .ws-name') || {}).textContent === 'Rocket Club', null, { timeout: 8000 }); await sleep(500);
  ok((await p.locator('.glass-proj.current').textContent()).includes('Rocket Club'), 'Rocket Club open and marked');
  ok(await p.evaluate(() => document.body.classList.contains('nav-glass')), 'still glass');

  step('Fold down to icons: names in a glass label');
  await p.click('#nav-collapse'); await sleep(500);
  const rail = await p.locator('#top-bar').boundingBox();
  ok(rail.width < 90, 'an icon rail: ' + rail.width);
  const btn = await p.locator('#nav-collapse').boundingBox();
  ok(btn.x > rail.x + rail.width - 20 && btn.width < 32, 'the round button sits on the pane’s edge');
  ok((await p.locator('#nav-collapse').getAttribute('aria-expanded')) === 'false', 'and says folded');
  ok(await p.locator('.glass-proj:not(.new) .team-logo').first().isVisible(), 'projects as their logos');
  await p.hover('#activity-btn'); await sleep(600);
  ok(await p.locator('.glass-tip.shown').count() === 1 && (await p.locator('.glass-tip').textContent()).startsWith('Activity'), 'hover: the name beside the icon');
  const tip = await p.locator('.glass-tip').boundingBox();
  ok(tip.x > rail.x + rail.width, 'outside the pane');
  ok(await p.locator('.tt-tip.on').count() === 0, 'and not a second label on top');
  await shot('glass-rail');
  await p.mouse.move(900, 500); await sleep(300);
  ok(await p.locator('.glass-tip.shown').count() === 0, 'gone when the pointer leaves');

  step('Remembered after a reload');
  await p.reload(); await p.waitForSelector('.node-cat'); await sleep(600);
  ok(await p.evaluate(() => document.body.classList.contains('nav-glass') && document.body.classList.contains('nav-rail')), 'still a folded glass sidebar');
  await p.click('#nav-collapse'); await sleep(500);
  ok((await p.locator('#top-bar').boundingBox()).width > 240, 'unfolds again');

  step('Phone keeps the top bar');
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(500);
  const phone = await p.locator('#top-bar').boundingBox();
  ok(phone.y < 5 && phone.width > 380 && phone.height < 90, 'top bar on a phone');
  ok(!(await p.locator('#glass-projects').isVisible()) && !(await p.locator('.glass-lens').isVisible()), 'no glass bits on a phone');
  await p.setViewportSize({ width: 1440, height: 900 }); await sleep(300);
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 8).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
