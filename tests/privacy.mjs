// Your data (GDPR) in demo mode: download my data, hand a team over, delete my account.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
async function dialog(p, value) { await p.waitForSelector('#dialog-overlay input'); await p.fill('#dialog-overlay input', value); await p.click('#dialog-overlay .dlg-ok'); await sleep(200); }
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tt_demo_store_v1')));
const teamNamed = async (p, n) => Object.entries((await store(p)).teams).find(([, T]) => T.doc.name === n);

try {
  step('Set up: Aisha owns “Skyhawk” (with Tom) and “Aisha notes” (alone)');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Aisha notes'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]'); await A.waitForSelector('.node-cat'); await sleep(300);
  await A.goto(BASE + '#/'); await A.waitForSelector('#home-screen:not([hidden])');
  await A.fill('#create-team-form input[name=name]', 'Skyhawk'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]'); await A.waitForSelector('.node-cat'); await sleep(300);
  await A.click('.col-add'); await dialog(A, 'Wing CAD');
  await A.evaluate(async () => { const t = allTaskLocs()[0].task; await TT.writeOps([{ type: 'set', path: 'comments/cm1', data: { taskId: t.id, authorUid: TT.me.uid, authorName: 'Aisha Khan', text: 'Spar first, then ribs', mentions: [], createdAt: Date.now() } }]); });
  await A.click('#top-actions button:has-text("Invite")');
  await A.fill('.settings-pane textarea', 'tom@uni.ac.uk'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(200); await A.keyboard.press('Escape');
  const B = await tab('Tom');
  await signIn(B, 'Tom Reed', 'tom@uni.ac.uk');
  await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat'); await sleep(400);

  step('Download my data');
  await A.evaluate(() => TT.openAccount('data')); await A.waitForSelector('#your-data-field');
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('#my-data-download')]);
  ok(/^penteint-projects-my-data-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), 'a dated JSON file: ' + dl.suggestedFilename());
  const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(data.account.email === 'aisha@uni.ac.uk' && data.teams.length === 2, 'my account and both my teams');
  const sky = data.teams.find(t => t.teamName === 'Skyhawk');
  ok(sky.yourMembership.roleId === 'owner' && sky.yours.tasks?.length === 1 && sky.yours.comments?.[0].text === 'Spar first, then ribs', 'my membership, my task and my comment');

  step('Deleting is blocked while I own a team with other members');
  await A.click('#my-account-delete'); await A.waitForSelector('#delete-confirm'); await sleep(300);
  ok((await A.locator('#delete-blocked').textContent()).includes('Skyhawk') && !(await A.locator('#delete-blocked').textContent()).includes('Aisha notes'), 'it lists Skyhawk (not my solo team)');
  await A.fill('#delete-confirm', 'DELETE');
  ok(await A.locator('#delete-go').isDisabled(), 'the delete button stays off');
  await A.keyboard.press('Escape');

  step('Hand Skyhawk over to Tom');
  await A.click('#top-actions button:has-text("Settings")'); await A.click('.settings-nav button:has-text("Members")'); await sleep(250);
  ok(await A.locator('.make-owner').count() === 1, 'the owner sees “Make owner” next to Tom');
  await A.click('.make-owner'); await sleep(500);
  const [skyId, T] = await teamNamed(A, 'Skyhawk');
  const aUid = Object.values(T.members).find(m => m.email === 'aisha@uni.ac.uk').uid, bUid = Object.values(T.members).find(m => m.email === 'tom@uni.ac.uk').uid;
  ok(T.doc.ownerUid === bUid && T.members[bUid].roleId === 'owner' && T.members[aUid].roleId === 'admin', 'Tom is owner, Aisha is Admin');
  await B.evaluate(() => TT.openSettings && TT.openSettings('members')).catch(() => {});
  ok(!(await A.locator('.make-owner').count()), 'Aisha no longer sees “Make owner”');
  await A.keyboard.press('Escape');

  step('Delete my account');
  await A.evaluate(() => TT.openAccount('data')); await A.click('#my-account-delete'); await A.waitForSelector('#delete-confirm'); await sleep(300);
  ok(!(await A.locator('#delete-blocked').count()), 'no longer blocked');
  ok(await A.locator('#delete-go').isDisabled(), 'needs DELETE typed first');
  await A.fill('#delete-confirm', 'delete'); ok(await A.locator('#delete-go').isDisabled(), '(exactly DELETE)');
  await A.fill('#delete-confirm', 'DELETE'); await A.click('#delete-go'); await sleep(800);
  ok(await A.locator('#auth-screen:not([hidden])').isVisible(), 'signed out, back to the sign-in screen');
  ok((await A.locator('.toast', { hasText: 'account was deleted' }).count()) === 1, '“Your account was deleted…”');
  const S = await store(A);
  ok(!Object.values(S.users).some(u => u.email === 'aisha@uni.ac.uk'), 'my login is gone');
  ok(!Object.values(S.teams).some(t => t.doc.name === 'Aisha notes'), 'my solo team is gone');
  const T2 = S.teams[skyId];
  ok(T2 && !T2.members[aUid] && T2.members[bUid], 'Skyhawk stays, without me');
  ok(T2.comments.cm1.text === 'Spar first, then ribs' && T2.comments.cm1.authorName === 'Former member', 'my comment stays, signed “Former member”');
  // Penteint Projects: the audit trail is a sealed legal record, so it keeps who did what (the privacy
  // policy must say so; retention is a phase 5 decision). Everywhere else, the name and email are gone.
  const { audit: _audit, private: _private, ...T2rest } = T2;
  ok(!JSON.stringify(T2rest).includes('Aisha Khan') && !JSON.stringify(T2rest).includes('aisha@uni.ac.uk'), 'my name and email appear nowhere in the team except its audit trail');
  await B.reload(); await B.waitForSelector('.node-cat'); await sleep(400);
  ok(await B.locator('.task-card', { hasText: 'Wing CAD' }).count() === 1, 'Tom still has the task');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 6).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
