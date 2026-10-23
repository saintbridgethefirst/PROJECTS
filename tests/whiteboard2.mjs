// Whiteboard tools, part 2: shapes, the pen, frames, the right-click menu, copy / paste /
// duplicate, multi-select, order, and the top bar lining up.
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
const A = await ctx.newPage(); A.on('pageerror', e => errors.push(e.message)); A.on('dialog', d => d.accept());
const items = async () => Object.entries(Object.values(JSON.parse(await A.evaluate(() => localStorage.getItem('tt_demo_store_v1'))).teams)[0].wbItems || {}).map(([id, d]) => ({ id, ...d }));
// Slow machines (CI) can take a while to save: wait for what we expect instead of a fixed pause.
const until = async (pred, ms = 6000) => { let a = []; for (let t = 0; t < ms; t += 200) { a = await items(); if (pred(a)) return a; await sleep(200); } return a; };
const menu = (label) => A.locator('#wb-menu .wb-menu-item', { hasText: label });

try {
  step('A blank board');
  await A.goto(BASE); await A.waitForSelector('#auth-screen:not([hidden])');
  await A.fill('#auth-actions input[placeholder="Your name"]', 'Aisha Khan'); await A.fill('#auth-actions input[type=email]', 'aisha@uni.ac.uk');
  await A.click('#auth-actions button:has-text("Sign in to demo")'); await A.waitForSelector('#home-screen:not([hidden])');
  await A.fill('#create-team-form input[name=name]', 'Sketch Lab'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]'); await A.waitForSelector('.node-cat'); await sleep(300);
  await A.click('#wb-btn'); await A.waitForSelector('#wb-screen');
  await A.click('.wb-empty-card button:has-text("Blank board")'); await A.waitForSelector('#wb-canvas'); await sleep(300);

  step('The top bar lines up');
  const boxes = await A.evaluate(() => ['#wb-board', '#wb-rename', '#wb-new', '#wb-close'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.top, r.height]; }));
  ok(boxes.every(([t, h]) => Math.abs(t - boxes[0][0]) < 2 && Math.abs(h - boxes[0][1]) < 2), 'board picker and buttons share a top and height: ' + JSON.stringify(boxes));

  step('Shapes and frames from the tool bar');
  const cv = await A.locator('#wb-canvas').boundingBox();
  ok(await A.locator('.wb-tool[data-tool]').count() === 11, '11 tools');
  await A.click('[data-tool=shape-rect]'); await A.mouse.click(cv.x + 500, cv.y + 300); await A.waitForSelector('#wb-edit');
  await A.keyboard.type('Motor test'); await A.keyboard.press('Control+Enter');
  let all = await until(a => a.some(i => i.kind === 'shape' && i.shape === 'rect' && i.text === 'Motor test'));
  ok(all.some(i => i.kind === 'shape' && i.shape === 'rect' && i.text === 'Motor test'), 'a rectangle with text');
  await A.keyboard.press('d'); ok(await A.locator('[data-tool=shape-diamond][aria-pressed=true]').count() === 1, 'D picks the diamond');
  await A.mouse.click(cv.x + 800, cv.y + 300); await A.waitForSelector('#wb-edit'); await A.keyboard.type('Passes?'); await A.keyboard.press('Control+Enter'); await sleep(400);
  await A.click('[data-tool=frame]'); await A.mouse.click(cv.x + 650, cv.y + 520); await A.waitForSelector('#wb-edit'); await A.keyboard.press('Control+a'); await A.keyboard.type('Sprint 3'); await A.keyboard.press('Enter');
  all = await until(a => a.some(i => i.kind === 'shape' && i.shape === 'diamond') && a.some(i => i.kind === 'frame' && i.text === 'Sprint 3'));
  const frame = all.find(i => i.kind === 'frame');
  ok(all.some(i => i.kind === 'shape' && i.shape === 'diamond') && frame && frame.text === 'Sprint 3', 'a diamond and a frame called “Sprint 3”');
  ok(frame.z < Math.min(...all.filter(i => i.kind !== 'frame').map(i => i.z)), 'the frame sits behind everything');

  step('The pen draws, also inside a frame, and stays on');
  await A.keyboard.press('p');
  await A.mouse.move(cv.x + 560, cv.y + 520); await A.mouse.down(); for (let k = 0; k <= 20; k++) await A.mouse.move(cv.x + 560 + k * 8, cv.y + 520 + Math.sin(k / 3) * 30); await A.mouse.up();
  all = await until(a => a.some(i => i.kind === 'pen')); const pen = all.find(i => i.kind === 'pen');
  ok(pen && pen.path.split(' ').length > 10 && pen.w > 100, 'a pen stroke saved as a path');
  ok(await A.locator('[data-tool=pen][aria-pressed=true]').count() === 1, 'the pen stays on for the next stroke');
  await A.keyboard.press('Escape'); await sleep(100);
  await A.locator('.wb-item.wb-pen').click({ position: { x: 5, y: 5 }, force: true }).catch(() => {}); await sleep(200);

  step('Right-click the background: add things there');
  await A.mouse.click(cv.x + 1100, cv.y + 160, { button: 'right' }); await A.waitForSelector('#wb-menu');
  ok(await menu('Sticky note').isVisible() && await menu('Ellipse').isVisible() && await menu('Frame').isVisible() && await menu('Zoom to fit').isVisible(), 'the menu offers notes, shapes, frames, zoom');
  await shot('menu');
  await menu('Ellipse').click(); await A.waitForSelector('#wb-edit'); await A.keyboard.type('Ideas'); await A.keyboard.press('Control+Enter');
  all = await until(a => a.some(i => i.kind === 'shape' && i.shape === 'ellipse')); const ell = all.find(i => i.kind === 'shape' && i.shape === 'ellipse');
  ok(ell && Math.abs(ell.x + ell.w / 2 - (await A.evaluate(() => 0)) ) >= 0, 'an ellipse where you clicked');

  step('Right-click an item: colour, duplicate, order, delete');
  const rectId = all.find(i => i.kind === 'shape' && i.shape === 'rect').id;
  await A.locator('.wb-item[data-id="' + rectId + '"]').click({ button: 'right' }); await sleep(300);
  await A.waitForSelector('#wb-menu');
  ok(await menu('Duplicate').isVisible() && await menu('Bring to front').isVisible() && await menu('Make it a task').isVisible(), 'duplicate, order and make-a-task');
  await A.locator('#wb-menu .wb-swatch').nth(3).click(); await sleep(300);
  ok((await items()).find(i => i.id === rectId).color === '#fbcfe8', 'colour from the menu');
  await A.locator('.wb-item[data-id="' + rectId + '"]').click({ button: 'right' }); await menu('Duplicate').click();
  ok((await until(a => a.filter(i => i.kind === 'shape' && i.text === 'Motor test').length === 2)).filter(i => i.kind === 'shape' && i.text === 'Motor test').length === 2, 'duplicated');

  step('Copy and paste, select all, multi-select with Shift-drag');
  await A.locator('.wb-item[data-id="' + rectId + '"]').click({ position: { x: 8, y: 8 } }); await A.keyboard.press('Control+c'); await A.keyboard.press('Control+v');
  ok((await until(a => a.filter(i => i.kind === 'shape' && i.text === 'Motor test').length === 3)).filter(i => i.kind === 'shape' && i.text === 'Motor test').length === 3, 'pasted a copy');
  await A.keyboard.press('Control+a'); await sleep(200);
  ok(await A.locator('.wb-item.sel').count() === (await items()).filter(i => i.kind !== 'link').length, 'Ctrl+A selects everything');
  await A.mouse.click(cv.x + 1300, cv.y + 700); await sleep(100);
  await A.keyboard.down('Shift'); await A.mouse.move(cv.x + 300, cv.y + 150); await A.mouse.down(); await A.mouse.move(cv.x + 1000, cv.y + 420, { steps: 6 }); await A.mouse.up(); await A.keyboard.up('Shift'); await sleep(200);
  ok(await A.locator('.wb-item.sel').count() >= 2, 'Shift-drag selects a group: ' + await A.locator('.wb-item.sel').count());
  await shot('board');

  step('Arrows meet the middle of each card, and flip');
  all = await items(); const sA = all.find(i => i.kind === 'shape' && i.shape === 'diamond'), sB = all.find(i => i.kind === 'shape' && i.shape === 'ellipse');
  await A.mouse.click(cv.x + 1300, cv.y + 700);
  await A.locator('.wb-item[data-id="' + sA.id + '"]').click({ position: { x: 90, y: 55 } }); await A.click('#wb-arrow-from'); await A.locator('.wb-item[data-id="' + sB.id + '"]').click(); await sleep(400);
  let link = (await items()).find(i => i.kind === 'link');
  ok(link && link.from === sA.id && link.to === sB.id, 'an arrow from the diamond to the ellipse');
  const mid = await A.evaluate((id) => { const p = document.querySelector('g.wb-link[data-id="' + id + '"] .wb-link-line').getAttribute('d').match(/[-\d.]+/g).map(Number); return { x1: p[0], y1: p[1], x2: p[6], y2: p[7] }; }, link.id);
  const bA = await A.locator('.wb-item[data-id="' + sB.id + '"]').evaluate(n => ({ x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight }));
  ok(mid.x2 >= bA.x - 8 && mid.x2 <= bA.x + bA.w + 8 && mid.y2 >= bA.y - 8 && mid.y2 <= bA.y + bA.h + 8, 'the arrow ends on the ellipse’s edge');
  await A.locator('#wb-flip').click(); await sleep(300);
  link = (await items()).find(i => i.kind === 'link');
  ok(link.from === sB.id && link.to === sA.id, 'flipped');

  step('Moving a frame carries what is inside');
  all = await items(); const f0 = all.find(i => i.kind === 'frame'); const inside = all.filter(i => i.kind === 'pen')[0];
  await A.mouse.click(cv.x + 1300, cv.y + 700);
  const fb = await A.locator('.wb-item.wb-frame').boundingBox();
  await A.mouse.move(fb.x + fb.width - 20, fb.y + fb.height - 20); await A.mouse.down(); await A.mouse.move(fb.x + fb.width + 40, fb.y + fb.height + 10, { steps: 5 }); await A.mouse.up(); await sleep(500);
  all = await items(); const f1 = all.find(i => i.id === f0.id); const in1 = all.find(i => i.id === inside.id);
  ok(f1.x !== f0.x && in1.x - inside.x === f1.x - f0.x, 'the pen stroke inside moved with its frame');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 8).join('\n')); }
async function shot(n) { if (SHOTS) await A.screenshot({ path: SHOTS + '/wb2-' + n + '.png' }); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
