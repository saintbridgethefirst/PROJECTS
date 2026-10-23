// The Gantt view (planned dates on a timeline, "waits on" links, drag / keyboard to reschedule,
// tasks that wait on it pushed later, quick add) and turning sub-tasks into tasks and back.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const monday = () => { const x = new Date(); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toLocaleDateString('en-CA'); };
const add = (iso, n) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
const M = monday();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const A = await ctx.newPage(); A.on('pageerror', e => errors.push(e.message)); A.on('dialog', d => d.accept());
const team = () => A.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const task = async (name) => { const t = await team(); const e = Object.entries(t.tasks).find(([, x]) => x.name === name); return e ? { ...e[1], id: e[0] } : null; };
const bar = (id) => A.locator('.gt2-bar[data-id="' + id + '"]');
const card = (name) => A.locator('.task-card', { hasText: name }).first();
try {
  step('A team with dated weeks, tasks with dates, sub-tasks and links');
  await A.goto(BASE); await A.waitForSelector('#auth-screen:not([hidden])');
  await A.fill('#auth-actions input[placeholder="Your name"]', 'Aisha'); await A.fill('#auth-actions input[type=email]', 'aisha@uni.ac.uk');
  await A.click('#auth-actions button:has-text("Sign in to demo")'); await A.waitForSelector('#home-screen:not([hidden])');
  await A.fill('#create-team-form input[name=name]', 'Gantt Lab'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(({ M, d }) => {
    weeksData[0].startDate = M;
    weeksData.push({ key: 'wk_two', title: 'WEEK 2', metric: '', collapsed: false, startDate: d.w2 }, { key: 'wk_nodate', title: 'LATER', metric: '', collapsed: false, startDate: '' });
    db.forEach(p => p.categories.forEach(c => { c.wk_two = c.wk_two || []; c.wk_nodate = c.wk_nodate || []; }));
    const c = db.find(x => x.id === TT.me.uid).categories[0]; const wk = weeksData[0].key;
    const mk = (id, name, extra) => ({ id, type: 'task', name, priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [], ...extra });
    c[wk] = [
      mk('tA', 'Design frame', { startDate: M, dueDate: d.a, subtasks: [{ id: 's1', title: 'Pick motors', completed: false }, { id: 's2', title: 'Order bolts', completed: true }] }),
      mk('tB', 'Build frame', { startDate: d.b0, dueDate: d.b1, dependsOn: ['tA'], effort: 3 }),
      mk('tD', 'Write notes', { dueDate: d.d, effort: 2, attachments: [{ id: 'a1', provider: 'link', name: 'Spec', url: 'https://example.com/spec' }] }),
      mk('tE', 'Old task', { dueDate: M, flag: 'completed', completedDate: M }),
      mk('tG', 'Paint frame', { startDate: d.a, dueDate: d.b1, dependsOn: ['tD'] }),
      mk('tH', 'Carried thing', { dueDate: d.a }),
    ];
    c.wk_two = [mk('tC', 'Test flight', { dependsOn: ['tB'] }), mk('tH2', 'Carried thing', { dueDate: d.a, carryOf: 'tH' })];
    c.wk_nodate = [mk('tF', 'Someday task', {})];
    saveDatabase(); render();
  }, { M, d: { w2: add(M, 7), a: add(M, 2), b0: add(M, 3), b1: add(M, 4), d: add(M, 1) } });
  await A.evaluate(() => { const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const t = Object.values(s.teams)[0]; t.doc.features = { ...(t.doc.features || {}), planning: true }; localStorage.setItem(k, JSON.stringify(s)); localStorage.removeItem('tt_gt_scale'); localStorage.removeItem('tt_gt_rows'); });
  await A.reload(); await A.waitForSelector('.node-cat'); await sleep(400);
  ok((await task('Build frame')).startDate === add(M, 3), 'a task’s start date is saved (new field)');

  step('Switch to the Gantt');
  await A.click('[data-view=gantt]'); await A.waitForSelector('.gt2-bar');
  ok(await A.evaluate(() => document.body.classList.contains('view-gantt')) && await A.locator('[data-view=gantt]').getAttribute('aria-pressed') === 'true', 'Gantt view on');
  ok(await A.locator('.gt2-day').count() === 35 && await A.locator('[data-scale=month][aria-pressed=true]').count() === 1, 'month zoom: 35 days');
  ok(await A.locator('.gt2-day.today').count() === 1 && await A.locator('.gt2-todaycol').count() === 1, 'today is highlighted');
  // 7 dated tasks (the carried chain shows once), 1 without dates
  ok(await A.locator('.gt2-bar').count() === 7, '7 bars (a carried task shows once): ' + await A.locator('.gt2-bar').count());
  ok((await A.locator('.gt2-toolbar').textContent()).includes('1 without dates'), 'tasks without dates are counted');
  ok(await A.locator('.gt2-link').count() === 3 && await A.locator('.gt2-link.bad').count() === 0, '3 “waits on” links, none in conflict');
  ok(await A.locator('.gt2-bar[data-id="tC"]').evaluate(b => b.classList.contains('soft-start') && b.classList.contains('soft-end')), 'a task with no dates of its own spans its week, drawn with soft ends');
  const tipC = await bar('tC').getAttribute('title');
  ok(tipC.includes('week start') && tipC.includes('no deadline yet'), 'its tooltip says why');
  ok(await A.locator('.gt2-bar[data-id="tE"]').evaluate(b => b.classList.contains('done')), 'done tasks look done');
  const aW = await bar('tA').evaluate(b => parseFloat(b.style.width)); const dw = await A.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.gt2-grid')).getPropertyValue('--gt-dw')));
  ok(Math.abs(aW - (3 * dw - 4)) < 1, 'a 3-day task is 3 days wide');

  step('Zoom and move around');
  await A.click('[data-scale=week]'); await sleep(200);
  ok(await A.locator('.gt2-day').count() === 7, 'week zoom: 7 days');
  const r1 = await A.textContent('#gt-range'); await A.click('#gt-next'); await sleep(150);
  ok((await A.textContent('#gt-range')) !== r1, '→ moves to the next week');
  await A.click('#gt-today'); await sleep(150);
  ok((await A.textContent('#gt-range')) === r1, 'Today comes back');
  await A.click('[data-scale=quarter]'); await sleep(200);
  ok(await A.locator('.gt2-day').count() >= 13 && await A.locator('.gt2-bar').count() === 7, 'quarter zoom: weeks across the top');
  await A.click('[data-scale=month]'); await sleep(200);

  step('Drag a bar to move it');
  const bb = await bar('tB').boundingBox();
  await A.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await A.mouse.down();
  await A.mouse.move(bb.x + bb.width / 2 + dw * 0.6, bb.y + bb.height / 2, { steps: 4 }); await A.mouse.move(bb.x + bb.width / 2 + dw * 1.1, bb.y + bb.height / 2, { steps: 4 });
  ok(await A.locator('.gt2-tip').count() === 1, 'dates show while dragging');
  await A.mouse.up(); await sleep(400);
  let tB = await task('Build frame');
  ok(tB.startDate === add(M, 4) && tB.dueDate === add(M, 5), 'moved a day later, start and deadline together');
  ok(tB.history.some(h => h.field === 'Planned dates'), 'the change is in its history');
  ok(!(await task('Test flight')).startDate, 'the task waiting on it starts later anyway, so it stays put');

  step('Keyboard: change the end; tasks that wait on it move along');
  await bar('tB').focus();
  for (let i = 0; i < 3; i++) { await A.keyboard.press('Shift+ArrowRight'); await sleep(250); }
  tB = await task('Build frame'); const tC = await task('Test flight');
  ok(tB.startDate === add(M, 4) && tB.dueDate === add(M, 8), 'Shift + → three times: deadline 3 days later');
  ok(tC.startDate === add(M, 9) && tC.dueDate === add(M, 13), '“Test flight” waits on it, so it moved to start the day after, same length');
  ok(await A.locator('.gt2-link.bad').count() === 0, 'still no conflicts');
  await bar('tC').focus();
  for (let i = 0; i < 6; i++) { await A.keyboard.press('ArrowLeft'); await sleep(200); }
  ok((await task('Test flight')).startDate === add(M, 3), '← moves a day at a time');
  ok(await A.locator('.gt2-link.bad').count() === 1 && (await A.textContent('#gt-conflicts')).includes('starts before'), 'starting before what it waits on is flagged');
  await A.evaluate(() => TT.undo()); await sleep(400);
  ok((await task('Test flight')).startDate === add(M, 4), 'undo takes back the last move');

  step('Click an empty day to add a task there');
  const track = A.locator('.gt2-row').first().locator('.gt2-track'); const tb = await track.boundingBox();
  const idx = 20;   // 13 days after this Monday (the view starts a week before)
  await A.mouse.click(tb.x + idx * dw + dw / 2, tb.y + 3); await A.waitForSelector('#gt-add-input');
  await A.fill('#gt-add-input', 'Buy props'); await A.press('#gt-add-input', 'Enter'); await sleep(400);
  const nt = await task('Buy props');
  ok(nt && nt.startDate === add(M, 13) && nt.dueDate === add(M, 13), 'added, starting and due that day');
  ok(await A.locator('.gt2-bar', { hasText: 'Buy props' }).count() === 1, 'its bar appears');

  step('Rows, filters, opening a task');
  await A.selectOption('#gt-rows', 'task'); await sleep(200);
  ok(await A.locator('.gt2-row').count() === await A.locator('.gt2-bar').count(), 'one row per task');
  await A.selectOption('#gt-rows', 'person'); await sleep(200);
  const before = await A.locator('.gt2-bar').count(); await A.check('#gt-hide-done'); await sleep(200);
  ok(await A.locator('.gt2-bar').count() === before - 1, 'hide done');
  await A.uncheck('#gt-hide-done'); await sleep(200);
  await bar('tD').click(); await sleep(300);
  ok(await A.locator('#edit-start').count() === 1 && (await A.inputValue('#edit-start')) === '', 'clicking a bar opens the task, with its Starts date');
  await A.fill('#edit-start', add(M, 3)); await A.locator('#edit-start').dispatchEvent('change'); await sleep(300);
  ok(!(await task('Write notes')).startDate, 'a start after the deadline is refused');
  await A.fill('#edit-start', M); await A.locator('#edit-start').dispatchEvent('change'); await sleep(300);
  ok((await task('Write notes')).startDate === M, 'a start date set in the editor');

  step('Sub-task → task');
  await A.click('[data-view=board]'); await A.waitForSelector('.task-card'); await sleep(300);
  await card('Design frame').click(); await sleep(300);
  ok(await A.locator('#edit-form .st-promote').count() === 2, 'each sub-task has “↥ Task”');
  await A.locator('#edit-form .st-promote').first().click(); await sleep(500);
  const pm = await task('Pick motors'); let tA = await task('Design frame');
  ok(pm && pm.weekId === tA.weekId && pm.categoryId === tA.categoryId && pm.ownerUid === tA.ownerUid, 'it’s a task in the same row and week');
  ok(pm.dueDate === tA.dueDate && pm.startDate === tA.startDate && pm.flag === 'none', 'with the parent’s dates');
  ok(tA.subtasks.length === 1 && tA.subtasks[0].title === 'Order bolts', 'gone from the parent’s sub-tasks');
  ok((tA.dependsOn || []).includes(pm.id), 'the parent now waits on it (it was part of it)');
  ok(tA.history.some(h => h.field === 'Sub-task → task') && pm.history.some(h => h.updated.includes('Design frame')), 'both histories say so');
  await A.evaluate(() => TT.undo()); await sleep(500);
  tA = await task('Design frame');
  ok(!(await task('Pick motors')) && tA.subtasks.length === 2, 'undo puts it back as a sub-task');

  step('Task → sub-task');
  await card('Write notes').click({ button: 'right' }); await A.waitForSelector('#quick-menu.active');
  await A.locator('#quick-menu.active .qm-btn', { hasText: 'Make it a sub-task of' }).click(); await A.waitForSelector('.cmdk-input');
  await A.fill('.cmdk-input', 'Build frame'); await sleep(150); await A.keyboard.press('Enter'); await sleep(600);
  ok(!(await task('Write notes')), '“Write notes” is no longer a task');
  tB = await task('Build frame');
  const sub = tB.subtasks.find(s => s.title === 'Write notes');
  ok(sub && !sub.completed, 'it’s a sub-task of “Build frame”');
  ok(tB.effort === 5, 'its estimate is added (3 h + 2 h)');
  ok(tB.attachments.some(a => a.url === 'https://example.com/spec'), 'its link moved over');
  ok(JSON.stringify((await task('Paint frame')).dependsOn) === '["tB"]', 'a task that waited on it now waits on “Build frame”');
  ok(tB.history.some(h => h.field === 'Task → sub-task' && h.updated === 'Write notes'), 'history on the parent');

  step('A task carried across weeks can’t fold in');
  await card('Carried thing').click({ button: 'right' }); await A.waitForSelector('#quick-menu.active');
  await A.locator('#quick-menu.active .qm-btn', { hasText: 'Make it a sub-task of' }).click(); await sleep(300);
  ok(await A.locator('.cmdk-input').count() === 0 && (await A.locator('.toast').last().textContent()).includes('carried across'), 'explains why not');

  step('Phone width');
  await A.click('[data-view=gantt]'); await A.setViewportSize({ width: 390, height: 844 }); await sleep(400);
  ok(await A.locator('.gt2-bar').count() > 0 && await A.evaluate(() => document.querySelector('#gantt-view').scrollWidth <= innerWidth + 1), 'the Gantt scrolls inside its box on a phone');
  await A.evaluate(() => { try { localStorage.removeItem('tt_view'); } catch (e) { /* */ } });
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 8).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
