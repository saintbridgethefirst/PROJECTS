// Touch-screen test: iPhone and iPad (portrait + landscape) in demo mode, using real taps
// and press-and-hold. Needs the preview server:  npx vite preview --port 4173
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];

async function run(label, device) {
  console.log('▸ ' + label);
  const ctx = await browser.newContext({ ...device });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(label + ': ' + e.message));
  p.on('dialog', d => d.accept());
  const cdp = await ctx.newCDPSession(p);
  const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label.replace(/\W+/g, '-')}-${n}.png` }); };
  const noSideScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const tasks = () => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('tt_demo_store_v1')); const T = Object.values(s.teams)[0]; return { weeks: T.doc.weeks, tasks: Object.values(T.tasks) }; });
  const panelOpen = () => p.evaluate(() => { const r = document.getElementById('editor-panel').getBoundingClientRect(); return r.left < innerWidth - 5 && r.right <= innerWidth + 1; });
  async function longPress(locator) {
    const b = await locator.boundingBox(); const x = b.x + b.width / 2, y = b.y + Math.min(30, b.height / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
  }
  async function dialog(value) { await p.waitForSelector('#dialog-overlay input'); await p.fill('#dialog-overlay input', value); await p.tap('#dialog-overlay .dlg-ok'); await sleep(200); }

  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  ok(await noSideScroll(), 'sign-in page fits the width');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Rushi Vibhandik'); await p.fill('#auth-actions input[type=email]', 'rushi@uni.ac.uk');
  await p.tap('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  ok(await noSideScroll(), 'team list fits the width');
  ok((await p.locator('#home-theme').boundingBox()).height < 50, 'theme button stays on one line');
  await p.fill('#create-team-form input[name=name]', 'Robot Science and Technology'); await p.tap('#create-team-form button[type=submit]');
  await p.waitForSelector('.node-cat'); await sleep(400);

  // Board layout
  ok(await noSideScroll(), 'board page does not scroll sideways (only the board area does)');
  ok(!(await panelOpen()), 'editor panel starts closed, board gets the whole screen');
  ok((await p.locator('#top-bar').boundingBox()).height < 64, 'top bar is a single row');
  ok(await p.evaluate(() => { const r = document.querySelector('#top-bar').getBoundingClientRect(); const c = document.querySelector('#canvas-container').getBoundingClientRect(); return c.top >= r.bottom - 1; }), 'top bar does not cover the board');

  // Add tasks by tapping
  for (const name of ['Design gripper', 'Order servos']) { await p.tap('.col-add'); await dialog(name); }
  ok((await tasks()).tasks.length === 2, 'tasks added by tapping "Add task"');
  await shot('1-board');

  // Tap a card → panel slides in; tap backdrop → closes
  await p.locator('.task-card', { hasText: 'Design gripper' }).tap(); await sleep(400);
  ok(await panelOpen(), 'tapping a task opens the editor sheet');
  ok(await p.locator('#panel-backdrop').isVisible(), 'backdrop dims the board behind the sheet');
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('edit-name')).fontSize) === '16px', 'text boxes are 16px so iPhone does not zoom in');
  await shot('2-editor');
  if (device.viewport.width < 640) {
    ok((await p.locator('#editor-panel').boundingBox()).width >= device.viewport.width - 1, 'on a phone the sheet uses the full width');
    ok(await p.locator('.panel-close .lbl-compact').isVisible(), 'a clear Close button is shown');
    await p.tap('.panel-close'); await sleep(400);
    ok(!(await panelOpen()), 'Close shuts the sheet');
  } else {
    await p.locator('#panel-backdrop').tap({ position: { x: 10, y: 300 } }); await sleep(400);
    ok(!(await panelOpen()), 'tapping outside closes the sheet');
  }

  // Sub-tasks on the card
  await p.locator('.task-card', { hasText: 'Design gripper' }).locator('.btn-add-subtask').tap(); await dialog('CAD model');
  await p.locator('.task-card .subtask-item', { hasText: 'CAD model' }).tap(); await sleep(300);
  const sub = (await tasks()).tasks.find(t => t.name === 'Design gripper').subtasks;
  ok(sub.length === 1 && sub[0].completed, 'sub-task added and ticked by tapping');

  // Second week, then press-and-hold → menu → Move to week
  await p.tap('.btn-add-week'); await sleep(900); await p.evaluate(() => showEverything()); await sleep(300);
  await p.evaluate(() => { const c = document.getElementById('canvas-container'); c.style.scrollBehavior = 'auto'; c.scrollLeft = 0; c.scrollTop = 0; }); await sleep(400);
  await longPress(p.locator('.task-card', { hasText: 'Order servos' }));
  ok(await p.locator('#quick-menu.active').isVisible(), 'press-and-hold opens the task menu');
  const labels = await p.$$eval('#quick-menu .qm-btn', bs => bs.map(b => b.textContent));
  ok(labels.some(l => l.includes('Move to week')), 'menu offers Move to week');
  await p.locator('#quick-menu .qm-btn', { hasText: 'Move to week' }).tap(); await sleep(250);
  if (device.viewport.width < 640) {
    ok(await p.locator('#quick-menu .qm-btn', { hasText: 'Back' }).isVisible() && await p.locator('#quick-submenu.active').count() === 0, 'on a phone the week list replaces the menu, with Back');
    await shot('3-menu');
    await p.locator('#quick-menu .qm-btn', { hasText: 'WEEK 2' }).tap(); await sleep(400);
  } else {
    await p.waitForSelector('#quick-submenu.active');
    await shot('3-menu');
    await p.locator('#quick-submenu .qm-btn').first().tap(); await sleep(400);
  }
  const st = await tasks(); const moved = st.tasks.find(t => t.name === 'Order servos');
  ok(moved.weekId === st.weeks[1].key, 'task moved to the other week');
  ok(moved.history[0].field === 'Moved', 'move recorded in the history log');
  ok(await p.locator('#quick-menu.active').count() === 0, 'menu closes after choosing');

  // "⋯" button
  await p.locator('.task-card', { hasText: 'Design gripper' }).locator('.card-more').tap(); await sleep(200);
  ok(await p.locator('#quick-menu.active').isVisible(), '"⋯" on a card opens the task menu');
  await p.locator('#quick-menu .qm-btn', { hasText: 'Edit in side panel' }).tap(); await sleep(400);
  ok(await panelOpen(), '"Edit in side panel" opens the sheet');
  await p.tap('.panel-close'); await sleep(400);
  ok(!(await panelOpen()), 'Hide Panel closes the sheet');

  // Dialogs fill a phone screen
  await p.tap('#top-actions button:has-text("Settings")'); await sleep(300);
  const modal = await p.locator('.modal').boundingBox(); const vw = device.viewport.width;
  if (vw < 640) ok(Math.abs(modal.width - vw) < 2, 'settings fill the phone screen');
  else ok(modal.width <= vw, 'settings fit the screen');
  ok(await noSideScroll(), 'settings do not scroll sideways');
  await p.keyboard.press('Escape'); await sleep(200);
  await p.locator('#top-bar').evaluate(el => { el.scrollLeft = 0; });
  await p.tap('#top-actions button:has-text("Analytics")'); await p.waitForSelector('.an-kpis');
  ok(await p.evaluate(() => document.querySelector('.an-modal').getBoundingClientRect().width <= innerWidth + 1), 'analytics fits the screen');
  await shot('4-analytics');
  await p.keyboard.press('Escape');
  await ctx.close();
}

try {
  await run('iPhone 13', devices['iPhone 13']);
  await run('iPad portrait', devices['iPad (gen 7)']);
  await run('iPad landscape', devices['iPad (gen 7) landscape']);
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 14).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
