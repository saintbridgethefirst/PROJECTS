// Who's here: two people with the team open see each other online, which task the other has open,
// and the status each sets (Available / Busy / Away, with a note).
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
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const team = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);

try {
  step('Aisha and Tom both have the team open');
  const A = await tab('Aisha'); await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Rover Lab'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(() => {
    const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const T = Object.values(s.teams)[0]; const wk = T.doc.weeks[0].key;
    s.users.u_tom = { uid: 'u_tom', email: 'tom@x.com', name: 'Tom Reed', photo: '', emailVerified: true, provider: 'demo' };
    T.members.u_tom = { uid: 'u_tom', email: 'tom@x.com', name: 'Tom Reed', photo: '', roleId: 'member', joinedAt: 1 };
    T.categories.c_tom = { name: 'Chassis', ownerUid: 'u_tom', order: 5 };
    T.tasks.t_frame = { name: 'Weld the frame', priority: 'Major', status: '', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none', dueDate: '', completedDate: '', subtasks: [], history: [], custom: {}, icon: '', attachments: [], categoryId: 'c_tom', ownerUid: 'u_tom', weekId: wk, order: 0, createdBy: 'u_tom', createdAt: 1, updatedBy: 'Tom', updatedAt: 1 };
    localStorage.setItem(k, JSON.stringify(s));
  });
  await A.reload(); await A.waitForSelector('.task-card'); await sleep(800);
  const B = await tab('Tom'); await signIn(B, 'Tom Reed', 'tom@x.com'); await B.locator('.team-tile').first().click(); await B.waitForSelector('.task-card'); await sleep(900);
  let T = await team(A);
  ok(T.presence && T.presence.u_tom && T.presence.u_tom.at > Date.now() - 60000, 'Tom’s heartbeat is saved');
  await A.waitForFunction(() => /2 online/.test(document.getElementById('online-btn').textContent), null, { timeout: 5000 }).catch(() => {});
  ok(/2 online/.test(await A.textContent('#online-btn')), 'Aisha sees “2 online”: ' + await A.textContent('#online-btn'));
  ok(await A.locator('#u_tom[data-presence="free"]').count() === 1 || await A.locator('.node-person[data-presence="free"]').count() >= 1, 'Tom’s row shows a green dot');

  step('Tom opens a task: Aisha sees him looking at it');
  await B.locator('.task-card', { hasText: 'Weld the frame' }).click(); await sleep(1200);
  await A.waitForSelector('.task-card .viewers', { timeout: 5000 }).catch(() => {});
  ok(await A.locator('.task-card', { hasText: 'Weld the frame' }).locator('.viewers').count() === 1, 'his face on the card');
  const glow = await A.locator('.task-card', { hasText: 'Weld the frame' }).evaluate(c => ({ on: c.classList.contains('peer-open'), col: c.style.getPropertyValue('--peer'), who: c.dataset.peer, shadow: getComputedStyle(c).boxShadow }));
  ok(glow.on && /^#[0-9a-f]{6}$/i.test(glow.col) && glow.who === 'Tom' && glow.shadow !== 'none', 'the card glows in Tom’s colour with “Tom is editing” ' + JSON.stringify(glow));
  ok(await A.locator('.task-card.peer-open').count() === 1, 'only that card glows');

  step('Tom sets Busy with a note');
  await B.click('#online-btn'); await B.waitForSelector('#presence-modal');
  await B.fill('#pr-note', 'In the lab till 4'); await B.locator('#pr-note').press('Tab'); await sleep(300);
  await B.click('.pr-choice[data-state="busy"]'); await sleep(800);
  T = await team(B); ok(T.presence.u_tom.state === 'busy' && T.presence.u_tom.note === 'In the lab till 4', 'saved: busy, with the note');
  await A.waitForSelector('.node-person[data-presence="busy"]', { timeout: 5000 }).catch(() => {});
  ok(await A.locator('.node-person[data-presence="busy"]').count() === 1, 'Aisha sees a red dot on Tom’s row');
  await A.click('#online-btn'); await A.waitForSelector('#presence-modal');
  const row = await A.textContent('#presence-modal .pr-row[data-uid="u_tom"]');
  ok(/Busy/.test(row) && /In the lab till 4/.test(row) && /Weld the frame/.test(row), 'the list says Busy, the note and the task: ' + row);
  await A.locator('#presence-modal .pr-task').click(); await sleep(400);
  ok(await A.locator('#edit-name').count() === 1, 'clicking the task opens it');

  step('Tom closes the tab: without his heartbeat he drops off');
  await B.close(); await sleep(300);
  await A.evaluate(() => { const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); Object.values(s.teams)[0].presence.u_tom.at = Date.now() - 6 * 60e3; localStorage.setItem(k, JSON.stringify(s)); });
  await A.reload(); await A.waitForSelector('.task-card'); await sleep(800);
  ok(/1 online/.test(await A.textContent('#online-btn')), 'back to “1 online”');
} catch (e) { for (const pg of ctx.pages()) { try { console.log('   page:', await pg.evaluate(() => location.hash + ' | ' + (document.querySelector('.toast')?.textContent || '') + ' | cards=' + document.querySelectorAll('.task-card').length)); } catch {} } fail++; console.log('  ✗ ERROR:', e.message.split('\n').slice(0, 4).join(' | ')); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
