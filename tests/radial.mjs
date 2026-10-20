// The circle (radial) right-click menu, in demo mode: turning it on in Your account, the
// same actions as the list menu, outer ring for sub-menus, keyboard, and on a phone
// (press and hold, sub-menus replace the ring, Back in the middle).
// Needs the preview server:  npx vite preview --port 4173
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

async function setup(p, tap) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Rushi Vibhandik'); await p.fill('#auth-actions input[type=email]', 'rushi@uni.ac.uk');
  await p[tap ? 'tap' : 'click']('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.fill('#create-team-form input[name=name]', 'Robot Science'); await p[tap ? 'tap' : 'click']('#create-team-form button[type=submit]');
  await p.waitForSelector('.node-cat'); await sleep(300);
  await p.evaluate(() => { const me = db.find(x => x.id === TT.me.uid); const c = me.categories[0]; const wk = weeksData[0].key;
    c[wk] = [{ id: 'tA', type: 'task', name: 'Design gripper', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [] }, { id: 'tB', type: 'task', name: 'Order servos', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [] }];
    saveDatabase(); render(); });
  await sleep(300);
}
// Does the circle (main ring, and the outer ring if open) stay clear of the card?
const clearOf = (p, name) => p.evaluate((n) => {
  const card = [...document.querySelectorAll('.task-card')].find(c => c.textContent.includes(n)).getBoundingClientRect();
  return [...document.querySelectorAll('#radial-menu .rm-seg path, #radial-menu .rm-hub circle')].every(el => {
    const r = el.getBoundingClientRect(); const ix = Math.min(r.right, card.right) - Math.max(r.left, card.left), iy = Math.min(r.bottom, card.bottom) - Math.max(r.top, card.top);
    return ix <= 1 || iy <= 1;
  }) || document.getElementById('radial-menu').dataset.side;
}, name);
const sideOf = (p) => p.evaluate(() => document.getElementById('radial-menu').dataset.side);
const tasks = (p) => p.evaluate(() => Object.values(Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0].tasks));
const segLabels = (p, sel = '#radial-menu .rm-ring .rm-seg') => p.$$eval(sel, gs => gs.map(g => g.getAttribute('aria-label')));
async function clickSeg(p, label, ring = 'rm-ring', how = 'click') {
  const g = p.locator(`#radial-menu .${ring} .rm-seg[aria-label^="${label}"]`).first();
  const b = await g.locator('path').boundingBox();
  // click the label position (centre of the wedge's text), not the bounding-box centre which may be outside the wedge
  const t = await g.locator('.rm-icon').boundingBox();
  const x = t.x + t.width / 2, y = t.y + t.height / 2;
  if (how === 'tap') await p.touchscreen.tap(x, y); else { await p.mouse.move(x, y); await sleep(80); await p.mouse.click(x, y); }
  await sleep(250);
  return b;
}

try {
  step('Turn the circle menu on in Your account');
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await setup(p);
  // list menu first, to compare
  await p.locator('.task-card', { hasText: 'Design gripper' }).click({ button: 'right' }); await sleep(200);
  const listLabels = await p.$$eval('#quick-menu .qm-btn', bs => bs.map(b => b.textContent.replace(/[▸✓]/g, '').trim()));
  await p.keyboard.press('Escape'); await p.mouse.click(5, 300); await sleep(150);
  await p.click('#editor-panel .account-chip'); await p.waitForSelector('.seg-toggle');
  ok(await p.locator('.seg-toggle button.on[data-menu-style="list"]').count() === 1, 'List is the default');
  await p.click('.seg-toggle button[data-menu-style="circle"]'); await sleep(200);
  ok(await p.locator('.seg-toggle button.on[data-menu-style="circle"]').count() === 1, 'Circle selected');
  const user = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).users)[0]);
  ok(user.menuStyle === 'circle', 'saved on the account');
  await p.keyboard.press('Escape'); await sleep(150);

  step('Right-click a task: same actions, in a circle');
  await p.locator('.task-card', { hasText: 'Design gripper' }).click({ button: 'right', position: { x: 120, y: 40 } }); await sleep(300);
  ok(await p.locator('#radial-menu').isVisible() && await p.locator('#quick-menu.active').count() === 0, 'circle menu opens instead of the list');
  const ring = await segLabels(p);
  ok(ring.length === listLabels.length, `same number of actions as the list (${ring.length} vs ${listLabels.length})`);
  ok(listLabels.every(l => ring.some(r => r.includes(l.replace(/^\W+\s*/, '').split(' · ')[0].trim()))), 'every list action is in the circle');
  ok((await p.textContent('#radial-menu .rm-hub-title')).toUpperCase().includes('TASK'), 'the middle names what was clicked');
  ok(await sideOf(p) === 'right' && (await clearOf(p, 'Design gripper')) === true, 'the circle opens beside the card, not over it: ' + await sideOf(p));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/radial-desktop.png` });
  await clickSeg(p, 'Priority');
  ok(await p.locator('#radial-menu .rm-outer .rm-seg').count() === 4, 'Priority opens an outer ring with 4 choices');
  ok((await clearOf(p, 'Design gripper')) === true, 'the outer ring doesn’t cover the card either');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/radial-outer.png` });
  await clickSeg(p, 'Critical', 'rm-outer');
  ok((await tasks(p)).find(t => t.name === 'Design gripper').priority === 'Critical', 'choosing Critical changes the priority');
  ok(await p.locator('#radial-menu').count() === 0, 'the menu closes after choosing');

  step('No room on the right → it opens on the left');
  await p.evaluate(() => { const c = document.getElementById('canvas-container'); c.style.scrollBehavior = 'auto'; c.scrollLeft = 0; });
  await p.setViewportSize({ width: 1000, height: 860 }); await sleep(300);
  await p.click('#editor-panel .panel-close').catch(() => {}); await sleep(300);
  await p.locator('.task-card', { hasText: 'Order servos' }).click({ button: 'right', position: { x: 120, y: 40 } }); await sleep(300);
  const side = await sideOf(p);
  ok(side !== 'pointer' && (await clearOf(p, 'Order servos')) === true, 'still beside the card at a smaller window size: ' + side);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/radial-side.png` });
  await p.keyboard.press('Escape'); await p.setViewportSize({ width: 1360, height: 860 }); await sleep(300);

  step('Plain actions work: Duplicate');
  await p.locator('.task-card', { hasText: 'Order servos' }).click({ button: 'right', position: { x: 120, y: 40 } }); await sleep(300);
  await clickSeg(p, 'Duplicate');
  ok((await tasks(p)).filter(t => t.name.startsWith('Order servos')).length === 2, 'Duplicate made a copy');

  step('Keyboard and closing');
  await p.locator('.task-card', { hasText: 'Design gripper' }).first().click({ button: 'right', position: { x: 120, y: 40 } }); await sleep(300);
  const first = await p.evaluate(() => document.activeElement.getAttribute('aria-label'));
  await p.keyboard.press('ArrowRight'); const second = await p.evaluate(() => document.activeElement.getAttribute('aria-label'));
  ok(first && second && first !== second, 'arrow keys move around the ring');
  ok((await p.textContent('#radial-menu .rm-hub-text')).replace(/\s+/g, '').length > 0, 'the middle shows the full name of the focused action');
  await p.keyboard.press('Escape'); await sleep(150);
  ok(await p.locator('#radial-menu').count() === 0, 'Escape closes it');
  await p.mouse.click(700, 200, { button: 'right' }); await sleep(300);
  ok(await p.locator('#radial-menu').isVisible() && (await p.textContent('#radial-menu .rm-hub-title')).toUpperCase().includes('BOARD'), 'right-clicking the board opens the board menu as a circle');
  await p.mouse.click(30, 820); await sleep(200);
  ok(await p.locator('#radial-menu').count() === 0, 'clicking elsewhere closes it');
  await p.locator('.task-card', { hasText: 'Design gripper' }).first().locator('.card-more').click(); await sleep(300);
  ok(await p.locator('#radial-menu').isVisible(), 'the ⋯ button opens the circle too');
  await p.keyboard.press('Escape');

  step('Switch back to the list');
  await p.click('#editor-panel .account-chip'); await p.waitForSelector('.seg-toggle'); await p.click('.seg-toggle button[data-menu-style="list"]'); await p.keyboard.press('Escape'); await sleep(150);
  await p.locator('.task-card', { hasText: 'Design gripper' }).first().click({ button: 'right' }); await sleep(200);
  ok(await p.locator('#quick-menu.active').isVisible() && await p.locator('#radial-menu').count() === 0, 'list menu is back');
  await ctx.close();

  step('Phone: press and hold, sub-menus replace the ring');
  const pc = await browser.newContext({ ...devices['iPhone 13'] });
  const q = await pc.newPage(); q.on('pageerror', e => errors.push('phone: ' + e.message)); q.on('dialog', d => d.accept());
  await q.goto(BASE); await q.evaluate(() => localStorage.setItem('tt_menu_style', 'circle'));
  await setup(q, true);
  const cdp = await pc.newCDPSession(q);
  await q.evaluate(() => { const c = document.getElementById('canvas-container'); c.style.scrollBehavior = 'auto'; c.scrollLeft = 0; c.scrollTop = 0; }); await sleep(200);
  const b = await q.locator('.task-card', { hasText: 'Design gripper' }).boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + 30 }] }); await sleep(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
  ok(await q.locator('#radial-menu').isVisible(), 'press and hold opens the circle');
  ok(await q.evaluate(() => { const r = document.querySelector('#radial-menu .rm-ring').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), 'the whole circle fits on the phone screen');
  ok(['below', 'above'].includes(await sideOf(q)), 'on the phone it sits below or above the card: ' + await sideOf(q));
  ok(await q.evaluate(() => { const t = [...document.querySelectorAll('.task-card')].find(c => c.textContent.includes('Design gripper')).querySelector('.card-title').getBoundingClientRect();
    return [...document.querySelectorAll('#radial-menu .rm-seg path, #radial-menu .rm-hub circle')].every(el => { const r = el.getBoundingClientRect(); return Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top) <= 1 || Math.min(r.right, t.right) - Math.max(r.left, t.left) <= 1; }); }), 'the task’s title stays visible');
  if (SHOTS) await q.screenshot({ path: `${SHOTS}/radial-phone.png` });
  await clickSeg(q, 'Status', 'rm-ring', 'tap');
  ok((await segLabels(q)).some(l => l.startsWith('Pending')) && (await q.textContent('#radial-menu .rm-hub-title')).includes('Back'), 'Status replaces the ring, with Back in the middle');
  if (SHOTS) await q.screenshot({ path: `${SHOTS}/radial-phone-sub.png` });
  await q.locator('#radial-menu .rm-hub').tap(); await sleep(250);
  ok((await segLabels(q)).some(l => l.startsWith('Duplicate')), 'Back returns to the main ring');
  await clickSeg(q, 'Status', 'rm-ring', 'tap'); await clickSeg(q, 'Pending', 'rm-ring', 'tap');
  ok((await tasks(q)).find(t => t.name === 'Design gripper').flag === 'pending', 'choosing Pending on the phone works');
  await pc.close();
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
