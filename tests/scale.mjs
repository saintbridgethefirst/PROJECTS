// A big society: 80 people, 16 weeks, ~2,500 tasks, sub-teams, comments. Times the things people
// do all day and fails if any is far too slow. (Generous limits: CI machines are slower than laptops.)
// Needs the preview server: npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
const times = {};
const timed = async (name, fn) => { const t = Date.now(); await fn(); times[name] = Date.now() - t; return times[name]; };

try {
  step('Seed a society of 80 people with ~2,500 tasks');
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Chair Person'); await p.fill('#auth-actions input[type=email]', 'chair@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.fill('#create-team-form input[name=name]', 'SEDS'); await p.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await p.click('#create-team-form button[type=submit]');
  await p.waitForSelector('.node-cat'); await sleep(300);
  const counts = await p.evaluate(() => {
    const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const T = Object.values(s.teams)[0];
    const start = new Date(); start.setDate(start.getDate() - 7 * 10 - ((start.getDay() + 6) % 7));
    T.doc.weeks = Array.from({ length: 16 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + 7 * i); return { key: 'w' + i, title: 'WEEK ' + (i + 1), metric: '', startDate: d.toLocaleDateString('en-CA') }; });
    T.doc.features = { ...(T.doc.features || {}), planning: true, people: true, subteams: true, notebook: true };
    const subs = ['Propulsion', 'Avionics', 'Structures', 'Payload', 'Outreach'];
    T.doc.subteams = subs.map((n, i) => ({ id: 'st' + i, name: n, color: '', members: [], leads: [] }));
    let n = 0; const names = ['CAD', 'Test', 'Order', 'Wire', 'Report', 'Review', 'Build', 'Simulate'];
    for (let u = 0; u < 79; u++) {
      const uid = 'u' + u; s.users[uid] = { uid, email: uid + '@x.com', name: 'Person ' + u, photo: '', emailVerified: true, provider: 'demo' };
      T.members[uid] = { uid, email: uid + '@x.com', name: 'Person ' + u, photo: '', roleId: u < 5 ? 'admin' : 'member', joinedAt: 1 };
      T.doc.subteams[u % 5].members.push(uid);
      for (let c = 0; c < 3; c++) {
        const cid = 'c' + u + '_' + c; T.categories[cid] = { name: subs[u % 5] + ' ' + (c + 1), ownerUid: uid, order: c };
        for (let w = 0; w < 16; w++) {
          if ((u + c + w) % 3 === 0) continue;
          const id = 't' + (n++);
          T.tasks[id] = { name: names[n % 8] + ' item ' + n, priority: ['Minor', 'Major', 'Critical', 'Blocker'][n % 4], status: '', jiraId: '', supportPersonId: null, supportPersonId2: null,
            flag: w < 10 ? 'completed' : 'none', dueDate: T.doc.weeks[w].startDate, completedDate: w < 10 ? T.doc.weeks[w].startDate : '', subtasks: [{ id: 's1', title: 'Step one', done: true }, { id: 's2', title: 'Step two', done: false }],
            history: [], custom: {}, icon: '', attachments: [], categoryId: cid, ownerUid: uid, weekId: 'w' + w, order: 0, createdBy: uid, createdAt: 1, updatedBy: 'x', updatedAt: 1, effort: 3 };
        }
      }
    }
    for (let i = 0; i < 300; i++) T.comments['cm' + i] = { taskId: 't' + (i * 7), authorUid: 'u' + (i % 79), authorName: 'Person', text: 'Looks good', mentions: [], createdAt: Date.now() - i * 1000 };
    localStorage.setItem(k, JSON.stringify(s));
    return { tasks: Object.keys(T.tasks).length, people: Object.keys(T.members).length, kb: Math.round(JSON.stringify(s).length / 1024) };
  });
  console.log('   ', counts);
  ok(counts.tasks > 2000 && counts.people === 80, 'seeded');

  step('Open the board');
  const open = await timed('open board', async () => { await p.reload(); await p.waitForSelector('.task-card'); });
  ok(open < 15000, 'board opens in ' + open + ' ms');
  const rendered = await p.evaluate(() => document.querySelectorAll('.task-card').length);
  ok(rendered > 0, rendered + ' cards drawn');

  step('Everyday actions');
  const redraw = await p.evaluate(() => { const t = performance.now(); render(); return Math.round(performance.now() - t); }); times.redraw = redraw;
  ok(redraw < 2500, 'a full redraw takes ' + redraw + ' ms');
  const card = p.locator('.task-card').first();
  await card.click(); await p.waitForSelector('#edit-name');
  const typing = await timed('type 20 characters in a title', async () => { await p.locator('#edit-name').pressSequentially('Updated title text..', { delay: 0 }); });
  ok(typing < 3000, 'typing 20 characters: ' + typing + ' ms');
  await p.locator('#edit-name').blur(); await sleep(400);
  const save = await timed('save a change', async () => { await p.evaluate(() => { const l = allTaskLocs().find(x => x.task.flag !== 'completed'); l.task.priority = 'Blocker'; saveDatabase(); }); await sleep(50); });
  ok(save < 2500, 'saving a change: ' + save + ' ms');
  const search = await timed('search', async () => { await p.fill('#search-tasks', 'review'); await sleep(50); });
  ok(search < 3000, 'search across the board: ' + search + ' ms');
  await p.fill('#search-tasks', ''); await sleep(300);
  const kb = await timed('switch to Kanban', async () => { await p.evaluate(() => boardSetView('kanban')); await p.waitForSelector('.kb-card, .kb-col'); });
  ok(kb < 5000, 'Kanban: ' + kb + ' ms');
  const gantt = await timed('switch to Gantt', async () => { await p.evaluate(() => boardSetView('gantt')); await sleep(100); });
  ok(gantt < 6000, 'Gantt: ' + gantt + ' ms');
  await p.evaluate(() => boardSetView('board')); await sleep(300);
  const an = await timed('analytics', async () => { await p.evaluate(() => openAnalytics('overview')); await p.waitForSelector('#analytics-overlay'); });
  ok(an < 6000, 'Analytics: ' + an + ' ms');
  await p.keyboard.press('Escape'); await sleep(200);
  const k = await timed('Ctrl+K search', async () => { await p.evaluate(() => TT.openSearch()); await p.waitForSelector('.search-modal input, #search-input, .cmdk input'); await p.keyboard.type('item 1200'); await sleep(150); });
  ok(k < 4000, 'Ctrl+K search: ' + k + ' ms');
  const heap = await p.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0)); times['memory MB'] = heap;
  ok(!heap || heap < 600, 'memory in use: ' + heap + ' MB');
  console.log('   times:', JSON.stringify(times));
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
