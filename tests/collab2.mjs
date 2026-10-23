// Working together: guests from outside the team, live cursors, and the joint board across teams.
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
const store = () => p.evaluate(() => JSON.parse(localStorage.getItem('tt_demo_store_v1')));
const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; };
async function createTeam(name) {
  await p.waitForSelector('#home-screen:not([hidden])');
  await p.fill('#create-team-form input[name=name]', name);
  await p.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; });
  await p.click('#create-team-form button[type=submit]'); await p.waitForSelector('.node-cat'); await sleep(600);
}
const shot = (n) => process.env.SHOTS ? p.screenshot({ path: process.env.SHOTS + '/' + n + '.png' }) : null;
const closeModals = () => p.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(o => o.remove()));

try {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Aisha Khan'); await p.fill('#auth-actions input[type=email]', 'aisha@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")');

  step('A new team has a Guest role');
  await createTeam('Rover Lab');
  let T = Object.values((await store()).teams).find(t => t.doc.name === 'Rover Lab');
  ok(T.doc.roles.guest && T.doc.roles.guest.name === 'Guest', 'Guest role exists');
  ok(T.doc.roles.guest.perms['tasks.editOwn'] === true && !T.doc.roles.guest.perms['analytics.view'] && !T.doc.roles.guest.perms['finance.view'] && !T.doc.roles.guest.perms['data.export'], 'guests edit their own tasks only: no analytics, money or exports');

  step('An older team without the role gets it when the owner opens it');
  await p.evaluate(() => { const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const t = Object.values(s.teams).find(x => x.doc.name === 'Rover Lab'); delete t.doc.roles.guest; localStorage.setItem(k, JSON.stringify(s)); });
  await p.reload(); await p.waitForSelector('#home-screen:not([hidden]), .node-cat');
  if (await p.locator('#home-screen:not([hidden])').count()) { await p.click('.team-card:has-text("Rover Lab"), [data-team]:has-text("Rover Lab")'); await p.waitForSelector('.node-cat'); }
  ok(await until(async () => { const t = Object.values((await store()).teams).find(x => x.doc.name === 'Rover Lab'); return !!t.doc.roles.guest; }), 'Guest role added back for the older team');

  step('Inviting a guest');
  await p.evaluate(() => TT.openSettings('members')); await p.waitForSelector('#invite-role');
  ok(await p.locator('#invite-role option[value="guest"]').count() === 1, 'Guest is offered when inviting');
  ok(await p.locator('.guest-note').isHidden(), 'guest explanation hidden until chosen');
  await p.selectOption('#invite-role', 'guest');
  ok(await p.locator('.guest-note').isVisible(), 'choosing Guest explains what guests can do');
  await p.fill('form:has(#invite-role) textarea', 'sam@supplier.com'); await p.click('form:has(#invite-role) button[type=submit]'); await sleep(800);
  T = Object.values((await store()).teams).find(x => x.doc.name === 'Rover Lab');
  ok(T.invites && T.invites['sam@supplier.com'] && T.invites['sam@supplier.com'].roleId === 'guest', 'the invitation is for a guest');
  await closeModals();

  step('A guest is tagged for everyone to see');
  await p.evaluate(() => { const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const t = Object.values(s.teams).find(x => x.doc.name === 'Rover Lab');
    s.users.u_sam = { uid: 'u_sam', email: 'sam@supplier.com', name: 'Sam Lee', photo: '', emailVerified: true, provider: 'demo' };
    t.members.u_sam = { uid: 'u_sam', email: 'sam@supplier.com', name: 'Sam Lee', photo: '', roleId: 'guest', joinedAt: 2 }; localStorage.setItem(k, JSON.stringify(s)); });
  await p.reload(); await p.waitForSelector('.node-cat'); await sleep(800);
  await p.evaluate(() => TT.openPresence()); await p.waitForSelector('#presence-modal');
  ok(await p.locator('#presence-modal .pr-row[data-uid="u_sam"] .guest-tag').count() === 1, 'Who’s here shows Sam as a guest');
  ok(await p.locator('#presence-modal .pr-row:not([data-uid="u_sam"]) .guest-tag').count() === 0, 'members are not tagged');

  step('Live cursors');
  ok(await p.locator('#pr-cursors').isChecked(), 'live cursors on by default');
  await closeModals();
  const showCursor = (at) => p.evaluate((at) => window.TTLiveCursors.receive([{ id: 'u_sam', name: 'Sam Lee', at, a: 'v:', fx: 0.5, fy: 0.5, view: 'board' }]), at);
  await showCursor(Date.now()); await sleep(500);
  ok(await p.evaluate(() => window.TTLiveCursors.count()) === 1, 'a teammate’s cursor appears');
  ok((await p.textContent('.live-cursor-name')) === 'Sam', 'with their first name');
  const pos = await p.evaluate(() => { const r = document.querySelector('.live-cursor').getBoundingClientRect(), v = document.getElementById('main-view').getBoundingClientRect(); return { dx: Math.abs(r.left - (v.left + v.width / 2)), dy: Math.abs(r.top - (v.top + v.height / 2)) }; });
  ok(pos.dx < 4 && pos.dy < 4, 'placed where they are pointing ' + JSON.stringify(pos));
  const ownUid = await p.evaluate(() => TT.me && TT.me().uid).catch(() => null);
  await p.evaluate(() => { const row = document.querySelector('.node-person'); window.__row = row.id; });
  const rowId = await p.evaluate(() => window.__row);
  await p.evaluate((id) => window.TTLiveCursors.receive([{ id: 'u_sam', name: 'Sam Lee', at: Date.now(), a: 'p:' + id, fx: 0.1, fy: 0.5, view: 'board' }]), rowId); await sleep(500);
  const onRow = await p.evaluate((id) => { const c = document.querySelector('.live-cursor').getBoundingClientRect(), r = document.getElementById(id).getBoundingClientRect(); return c.left >= r.left - 2 && c.left <= r.right && c.top >= r.top - 2 && c.top <= r.bottom; }, rowId);
  ok(onRow, 'a cursor over a person’s row lands on that row'); await shot('cursor');
  await showCursor(Date.now() - 60000); await sleep(600);
  ok(await p.evaluate(() => window.TTLiveCursors.count()) === 0, 'an old cursor disappears');
  await showCursor(Date.now());
  await p.evaluate(() => TT.openPresence()); await p.waitForSelector('#pr-cursors'); await p.click('#pr-cursors'); await closeModals(); await sleep(500);
  ok(await p.evaluate(() => window.TTLiveCursors.count()) === 0, 'turning live cursors off hides them');
  await p.evaluate(() => TT.openPresence()); await p.waitForSelector('#pr-cursors'); await p.click('#pr-cursors'); await closeModals();
  void ownUid;

  step('Joint board across two teams');
  await p.evaluate(() => window.boardAddTask({ ownerUid: Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams).find(x => x.doc.name === 'Rover Lab').doc.ownerUid, name: 'Chassis CAD' })); await sleep(800);
  await p.evaluate(() => TT.goHome());
  await createTeam('Software Team');
  await p.evaluate(() => window.boardAddTask({ ownerUid: Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams).find(x => x.doc.name === 'Software Team').doc.ownerUid, name: 'ROS driver' })); await sleep(800);
  await p.evaluate(() => TT.openJointBoard()); await p.waitForSelector('.joint-modal .jb-card');
  ok(await p.locator('.jb-lane').count() === 2, 'one lane per team'); await shot('joint');
  ok(await p.locator('.jb-card:has-text("Chassis CAD")').count() === 1 && await p.locator('.jb-card:has-text("ROS driver")').count() === 1, 'cards from both teams');
  await p.locator('.jb-team:has-text("Rover Lab") input').uncheck(); await sleep(200);
  ok(await p.locator('.jb-card:has-text("Chassis CAD")').count() === 0 && await p.locator('.jb-lane').count() === 1, 'a team can be hidden');
  await p.locator('.jb-team:has-text("Rover Lab") input').check();
  await p.selectOption('#jb-group', 'person'); await sleep(200);
  ok(await p.locator('.jb-lane:has-text("Aisha")').count() === 1, 'lanes by person');
  await p.selectOption('#jb-group', 'team');
  await p.click('.jb-card:has-text("Chassis CAD")');
  ok(await until(async () => (await p.evaluate(() => document.querySelector('.editor-panel.open, #editor-panel:not([hidden]), .task-editor') !== null)) && (await p.textContent('body')).includes('Rover Lab'), 8000), 'clicking a card opens it in its own team');

  step('Joint board is in search and on the team list');
  await p.evaluate(() => TT.goHome()); await p.waitForSelector('#home-screen:not([hidden])');
  ok(await until(() => p.locator('#joint-btn').isVisible()), 'Joint board button on the team list');
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
