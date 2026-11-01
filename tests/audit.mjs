// Audit trail (Penteint Projects) in demo mode: every save becomes a server-style entry, the owner
// reads it in Settings ▸ Audit trail, filters and exports it, members can't see it, and an entry
// edited behind the app's back is caught by the chain check.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const monday = () => { const x = new Date(); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toLocaleDateString('en-CA'); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tt_demo_store_v1')));
const teamNamed = async (p, name) => Object.values((await store(p)).teams).find(t => t.doc.name === name);
const openAudit = async (p) => {
  await p.click('#top-actions button:has-text("Settings")'); await p.waitForSelector('.settings-nav');
  await p.click('.settings-nav button:has-text("Audit trail")'); await p.waitForSelector('.audit-check'); await sleep(300);
};
const rows = (p) => p.locator('.audit-table tr[data-seq]');

try {
  step('Every save is recorded');
  const A = await tab('Asha');
  await signIn(A, 'Asha Patel', 'asha@penteint-demo.com');
  await A.fill('#create-team-form input[name=name]', 'Rover Programme'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate((m) => {
    weeksData[0].startDate = m;
    const c = db.find(x => x.id === TT.me.uid).categories[0]; const wk = weeksData[0].key;
    c[wk] = [{ id: 't1', type: 'task', name: 'Gearbox housing CAD', priority: 'Major', status: '', flag: 'none', subtasks: [], history: [] }];
    saveDatabase(); render();
  }, monday());
  await sleep(500);
  await A.evaluate(() => { const c = db.find(x => x.id === TT.me.uid).categories[0]; c[weeksData[0].key][0].flag = 'completed'; saveDatabase(); render(); });
  await sleep(500);
  let T = await teamNamed(A, 'Rover Programme');
  const trail = Object.values(T.audit || {}).sort((a, b) => a.seq - b.seq);
  ok(trail.length >= 4, 'entries written for the team, the owner, the row and the task: ' + trail.length);
  ok(trail[0].col === 'team' && trail[0].action === 'create' && trail[0].prevHash === '', 'entry 1 is the team being made');
  ok(trail.every(e => e.actor && e.actor.name === 'Asha Patel'), 'every entry names Asha');
  ok(trail.some(e => e.col === 'tasks' && e.action === 'update' && (e.changes || []).some(c => c.f === 'flag' && c.from === 'none' && c.to === 'completed')), 'the task being finished shows flag none → completed');
  ok(T.private && T.private.auditHead && T.private.auditHead.seq === trail.at(-1).seq, 'the chain head follows the newest entry');

  step('The owner reads it in Settings ▸ Audit trail');
  await openAudit(A);
  ok(await A.locator('.audit-check.ok').count() === 1, 'the chain checks out: ' + await A.textContent('.audit-check'));
  ok((await A.textContent('.audit-check')).includes('Entries 1–'), 'says which entries were checked');
  ok(await rows(A).count() === trail.length, 'one row per entry');
  ok((await rows(A).first().getAttribute('data-seq')) === String(trail.at(-1).seq), 'newest first');
  ok((await A.textContent('.audit-table')).includes('flag: none → completed'), 'the change is shown');
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/audit-trail.png` });
  await A.fill('.audit-tools input[type=search]', 'gearbox'); await sleep(200);
  ok(await rows(A).count() >= 1 && await rows(A).count() < trail.length, 'search narrows the list');
  await A.fill('.audit-tools input[type=search]', ''); await sleep(150);
  await A.selectOption('.audit-tools select[aria-label="Record type"]', 'tasks'); await sleep(150);
  ok((await rows(A).count()) === trail.filter(e => e.col === 'tasks').length, 'filter by record type');
  await A.selectOption('.audit-tools select[aria-label="Record type"]', ''); await sleep(150);
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('.audit-tools button:has-text("Export CSV")')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(dl.suggestedFilename().startsWith('audit-trail-Rover-Programme-') && dl.suggestedFilename().endsWith('.csv'), 'CSV file name: ' + dl.suggestedFilename());
  ok(csv.startsWith('﻿Number,When (UTC),Who') && csv.split('\r\n').length === trail.length + 1, 'CSV has a header and one line per entry');
  await A.keyboard.press('Escape'); await sleep(200);

  step('A member joins; members cannot see the trail');
  await A.click('#top-actions button:has-text("Invite")');
  await A.fill('.settings-pane textarea', 'ben@penteint-demo.com');
  await A.click('.settings-pane button:has-text("Invite")'); await sleep(400);
  await A.keyboard.press('Escape'); await sleep(200);
  const B = await tab('Ben');
  await signIn(B, 'Ben Ode', 'ben@penteint-demo.com');
  await B.waitForSelector('#invites-section:not([hidden])');
  await B.click('#invites-list button:has-text("Join team")');
  await B.waitForSelector('#board-screen:not([hidden])'); await sleep(500);
  await B.click('#top-actions button:has-text("Settings")'); await B.waitForSelector('.settings-nav'); await sleep(200);
  ok(await B.locator('.settings-nav button:has-text("Audit trail")').count() === 0, 'a member has no Audit trail tab');
  await B.keyboard.press('Escape');
  T = await teamNamed(B, 'Rover Programme');
  const joined = Object.values(T.audit).find(e => e.col === 'members' && e.action === 'create' && e.actor.name === 'Ben Ode');
  ok(!!joined, 'Ben joining is recorded in his own name');
  ok(Object.values(T.audit).some(e => e.col === 'invites' && e.action === 'delete' && e.actor.name === 'Ben Ode'), 'his invitation being used up is recorded too');

  step('Penteint Projects plans: no student offers');
  await A.click('#top-actions button:has-text("Settings")'); await A.waitForSelector('.settings-nav');
  await A.click('.settings-nav button:has-text("Plan")'); await sleep(300);
  ok(await A.locator('#plan-name').textContent() === 'Starter', 'the plan is called Starter');
  ok(await A.locator('.plan-edu').count() === 0 && !(await A.textContent('.settings-pane')).includes('Pro Education'), 'no Pro Education offer');
  ok((await A.textContent('.plan-cards')).includes('Enterprise') && (await A.textContent('.plan-cards')).includes('Server-written audit trail'), 'plan cards: Starter, Team, Enterprise');
  await A.keyboard.press('Escape'); await sleep(200);

  step('Editing an entry behind the app’s back is caught');
  await A.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('tt_demo_store_v1'));
    const T = Object.values(s.teams).find(t => t.doc.name === 'Rover Programme');
    const e = Object.values(T.audit).find(x => x.seq === 2); e.actor.name = 'Someone else';
    localStorage.setItem('tt_demo_store_v1', JSON.stringify(s));
  });
  await A.reload(); await A.waitForSelector('#board-screen:not([hidden])'); await sleep(400);
  await openAudit(A);
  ok(await A.locator('.audit-check.bad').count() === 1 && (await A.textContent('.audit-check')).includes('Entry 2'), 'the check names entry 2: ' + await A.textContent('.audit-check'));
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/audit-tampered.png` });
  await A.keyboard.press('Escape');

  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
} catch (e) {
  fail++; console.log('  ✗ CRASH:', e.message);
} finally {
  await browser.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
