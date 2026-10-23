// Whiteboards: create a board, notes, headings, moving, colours, a note → task (with sub-tasks),
// task cards, arrows, delete + undo, zoom, keyboard, two people drawing on the same board at once.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const teamOf = async (p) => Object.values(JSON.parse(await p.evaluate(() => localStorage.getItem('tt_demo_store_v1'))).teams)[0];
const wbItems = async (p) => Object.entries((await teamOf(p)).wbItems || {}).map(([id, d]) => ({ id, ...d }));
const item = (p, id) => p.locator('.wb-item[data-id="' + id + '"]');

try {
  step('A team with a member, and its whiteboards');
  const A = await tab('Aisha'); await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Board Lab'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(() => {
    const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const T = Object.values(s.teams)[0]; const wk = T.doc.weeks[0].key;
    s.users.u_tom = { uid: 'u_tom', email: 'tom@x.com', name: 'Tom Reed', photo: '', emailVerified: true, provider: 'demo' };
    T.members.u_tom = { uid: 'u_tom', email: 'tom@x.com', name: 'Tom Reed', photo: '', roleId: 'member', joinedAt: 1 };
    T.categories.c_tom = { name: 'Landing gear', ownerUid: 'u_tom', order: 5 };
    T.tasks.t_legs = { name: 'Carbon legs', priority: 'Major', status: '', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none', dueDate: '', completedDate: '', subtasks: [], history: [], custom: {}, icon: '', attachments: [], categoryId: 'c_tom', ownerUid: 'u_tom', weekId: wk, order: 0, createdBy: 'u_tom', createdAt: 1, updatedBy: 'Tom', updatedAt: 1 };
    localStorage.setItem(k, JSON.stringify(s));
  });
  await A.reload(); await A.waitForSelector('.task-card'); await sleep(400);
  ok(await A.locator('#wb-btn').isVisible(), 'the Whiteboards button is on the top bar');
  await A.click('#wb-btn'); await A.waitForSelector('#wb-screen');
  ok(await A.locator('#wb-first').isVisible(), 'empty: offers a planning board');
  await A.click('#wb-first'); await A.waitForSelector('.wb-item'); await sleep(300);
  ok(await A.locator('.wb-item.wb-title').count() === 4 && await A.locator('.wb-item.wb-note').count() === 1, 'a planning board: 4 headings and a note');
  ok((await A.inputValue('#wb-board')) && (await teamOf(A)).whiteboards, 'saved as a team whiteboard');

  step('Notes: add, write, move, colour');
  await A.click('[data-tool=note]'); ok(await A.locator('[data-tool=note][aria-pressed=true]').count() === 1, 'note tool on');
  const cv = await A.locator('#wb-canvas').boundingBox();
  await A.mouse.click(cv.x + 700, cv.y + 520); await A.waitForSelector('#wb-edit');
  await A.keyboard.type('Design ability icons'); await A.keyboard.press('Enter'); await A.keyboard.type('- Active abilities'); await A.keyboard.press('Enter'); await A.keyboard.type('- UI states');
  await A.keyboard.press('Escape');
  let note = null;   // a slow CI machine can take a while to save the note: wait for it rather than a fixed pause
  for (let t = 0; t < 40 && !(note && note.text.split('\n').length === 3); t++) { await sleep(250); note = (await wbItems(A)).find(i => (i.text || '').startsWith('Design ability icons')); }
  ok(note && note.kind === 'note' && note.text.split('\n').length === 3, 'a note with three lines');
  ok(await A.locator('[data-tool=select][aria-pressed=true]').count() === 1, 'back to the select tool');
  const nb = await item(A, note.id).boundingBox(); const z = await A.evaluate(() => parseFloat(document.querySelector('#wb-zoom-pct').textContent) / 100);
  await A.mouse.move(nb.x + 30, nb.y + 30); await A.mouse.down(); await A.mouse.move(nb.x + 80, nb.y + 60, { steps: 5 }); await A.mouse.move(nb.x + 130, nb.y + 80, { steps: 5 }); await A.mouse.up(); await sleep(400);
  const moved = (await wbItems(A)).find(i => i.id === note.id);
  ok(Math.abs(moved.x - note.x - 100 / z) < 3 && Math.abs(moved.y - note.y - 50 / z) < 3, 'dragged to a new place');
  await item(A, note.id).click(); await A.waitForSelector('#wb-float:not([hidden])');
  await A.locator('#wb-float .wb-swatch').nth(2).click(); await sleep(300);
  ok((await wbItems(A)).find(i => i.id === note.id).color === '#bfdbfe', 'colour changed');

  step('Two people on the same board');
  const T = await tab('Tom'); await signIn(T, 'Tom Reed', 'tom@x.com'); await T.locator('.team-tile').first().click(); await T.waitForSelector('.task-card'); await sleep(300);
  await T.click('#wb-btn'); await T.waitForSelector('.wb-item'); await sleep(300);
  ok(await T.locator('.wb-item').count() === await A.locator('.wb-item').count(), 'Tom sees the same board');
  await T.click('[data-tool=title]'); const tcv = await T.locator('#wb-canvas').boundingBox();
  await T.mouse.click(tcv.x + 300, tcv.y + 650); await T.waitForSelector('#wb-edit'); await T.keyboard.type('Tom’s section'); await T.keyboard.press('Enter'); await sleep(500);
  ok(await A.locator('.wb-item.wb-title', { hasText: 'Tom’s section' }).count() === 1, 'Aisha sees Tom’s heading appear without reloading');

  step('A note becomes a task, with sub-tasks');
  await item(A, note.id).click(); await A.waitForSelector('#wb-convert');
  await A.click('#wb-convert'); await A.waitForSelector('.cmdk-input');
  await A.fill('.cmdk-input', 'Tom'); await sleep(150); await A.keyboard.press('Enter'); await sleep(600);
  const team = await teamOf(A); const nt = Object.entries(team.tasks).find(([, t]) => t.name === 'Design ability icons');
  ok(nt && nt[1].ownerUid === 'u_tom' && nt[1].subtasks.map(s => s.title).join('|') === 'Active abilities|UI states', 'a task for Tom, its “- ” lines as sub-tasks');
  const card = (await wbItems(A)).find(i => i.id === note.id);
  ok(card.kind === 'task' && card.taskId === nt[0], 'the note turned into its task card, in the same place');
  ok((await item(A, note.id).textContent()).includes('Design ability icons') && (await item(A, note.id).textContent()).includes('Tom Reed'), 'the card shows the task and its owner, live');

  step('Task cards and arrows');
  await A.click('[data-tool=task]'); await A.waitForSelector('.cmdk-input');
  await A.fill('.cmdk-input', 'Carbon legs'); await sleep(150); await A.keyboard.press('Enter'); await sleep(500);
  const legs = (await wbItems(A)).find(i => i.kind === 'task' && i.taskId === 't_legs');
  ok(!!legs, 'an existing task added as a card');
  await item(A, note.id).click(); await A.waitForSelector('#wb-arrow-from'); await A.click('#wb-arrow-from'); await sleep(150);
  await item(A, legs.id).click(); await sleep(400);
  const link = (await wbItems(A)).find(i => i.kind === 'link');
  ok(link && link.from === note.id && link.to === legs.id && await A.locator('g.wb-link').count() === 1, 'an arrow from the new task to “Carbon legs”');
  await A.click('#wb-label'); await A.waitForSelector('#wb-link-text'); await A.fill('#wb-link-text', 'Testing'); await A.click('#wb-link-save'); await sleep(300);
  ok(await A.locator('.wb-link-label', { hasText: 'Testing' }).count() === 1, 'the arrow has a label');

  step('Delete and undo; keyboard; zoom');
  await item(A, legs.id).click(); await A.keyboard.press('Delete'); await sleep(400);
  ok(!(await wbItems(A)).some(i => i.id === legs.id || i.kind === 'link'), 'deleting a card removes its arrows too');
  ok(!!(await teamOf(A)).tasks.t_legs, 'the task itself stays');
  await A.locator('.toast button', { hasText: 'Undo' }).last().click(); await sleep(400);
  ok((await wbItems(A)).some(i => i.id === legs.id) && (await wbItems(A)).some(i => i.kind === 'link'), 'undo brings both back');
  await A.locator('#wb-canvas').click({ position: { x: 1300, y: 120 } }); await sleep(100);
  await A.keyboard.press('n'); ok(await A.locator('[data-tool=note][aria-pressed=true]').count() === 1, 'N picks the note tool');
  await A.keyboard.press('v');
  const z1 = await A.textContent('#wb-zoom-pct'); await A.click('#wb-zoom-in'); await sleep(100);
  ok((await A.textContent('#wb-zoom-pct')) !== z1, 'zoom in'); await A.click('#wb-zoom-pct'); await sleep(100);

  step('More boards');
  await A.click('#wb-new'); await A.waitForSelector('#wb-new-name'); await A.fill('#wb-new-name', 'Retro'); await A.click('#wb-new-save'); await sleep(400);
  ok((await A.locator('#wb-board option').allTextContents()).includes('Retro'), 'a second board');
  await A.click('#wb-rename'); await A.fill('#wb-rename-input', 'Retro week 7'); await A.click('#wb-rename-save'); await sleep(300);
  ok((await A.locator('#wb-board option').allTextContents()).includes('Retro week 7'), 'renamed');
  await A.click('#wb-delete'); await sleep(400);
  ok(!(await A.locator('#wb-board option').allTextContents()).includes('Retro week 7') && await A.locator('.wb-item').count() > 3, 'deleted; back on the first board');
  await A.keyboard.press('Escape'); await sleep(200);
  ok(await A.locator('#wb-screen').count() === 0, 'Esc closes the whiteboards');

  step('Phone');
  await A.setViewportSize({ width: 390, height: 844 }); await A.click('#wb-btn').catch(async () => { await A.evaluate(() => TT.openWhiteboards()); }); await A.waitForSelector('.wb-item'); await sleep(300);
  const tb = await A.locator('#wb-tools').boundingBox();
  ok(tb.y > 600 && tb.x + tb.width <= 390, 'tools sit along the bottom on a phone');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 8).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
