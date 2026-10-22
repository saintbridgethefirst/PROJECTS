// The team's currency: chosen when the team is made, changed in Settings ▸ General or Finance,
// and used for everyone's prices (members who can't see the budget too).
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
await ctx.addInitScript(() => { try { if (!localStorage.getItem('tt_lang')) localStorage.setItem('tt_lang', 'en'); } catch (e) { /* */ } });   // a German browser, but the test reads English words
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const team = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const research = async (p, t) => { if (!(await p.locator('.research-modal').count())) { await p.click('#research-btn'); await p.waitForSelector('.research-modal'); } await p.click(`.rs-tab[data-tab="${t}"]`); await sleep(250); };

try {
  step('Making a team: the currency starts from the browser’s region and can be chosen');
  const A = await tab('Aisha'); await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  ok(await A.inputValue('#create-currency') === 'EUR', 'a German browser starts on euros');
  await A.selectOption('#create-currency', 'USD');
  await A.fill('#create-team-form input[name=name]', 'Rover Lab'); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  ok((await team(A)).doc.currency === 'USD', 'saved on the team');

  step('Everyone’s prices use it, including members who can’t see the budget');
  await A.evaluate(() => {
    const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const T = Object.values(s.teams)[0];
    T.doc.features = { ...(T.doc.features || {}), parts: true, finance: true };
    s.users.u_tom = { uid: 'u_tom', email: 'tom@x.com', name: 'Tom Reed', photo: '', emailVerified: true, provider: 'demo' };
    T.members.u_tom = { uid: 'u_tom', email: 'tom@x.com', name: 'Tom Reed', photo: '', roleId: 'member', joinedAt: 1 };
    T.parts = { p1: { name: 'Lidar', partNo: '', supplier: '', url: '', qty: 1, unitCost: 120, status: 'needed', neededBy: '', orderedDate: '', receivedDate: '', taskId: '', budgetId: '', notes: '', extras: [], subteamId: '', createdBy: 'u_tom', createdByName: 'Tom', createdAt: 1, updatedAt: 1 } };
    localStorage.setItem(k, JSON.stringify(s));
  });
  const B = await tab('Tom'); await signIn(B, 'Tom Reed', 'tom@x.com'); await B.locator('.team-tile').first().click(); await B.waitForSelector('.node-cat'); await sleep(400);
  await research(B, 'parts');
  ok((await B.locator('.pt-row').first().textContent()).includes('$'), 'Tom sees dollars: ' + (await B.locator('.pt-row td.num').nth(2).textContent()));
  ok(await B.evaluate(() => TT.can('finance.view')) === false, '(he can’t see the budget)');

  step('Settings ▸ General: change it');
  await A.reload(); await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(() => TT.openSettings('general')); await A.waitForSelector('#team-currency');
  ok(await A.inputValue('#team-currency') === 'USD', 'shown in General');
  await A.selectOption('#team-currency', 'INR'); await sleep(500);
  ok((await team(A)).doc.currency === 'INR', 'changed to rupees');
  await sleep(300);
  ok((await B.locator('.pt-row').first().textContent()).includes('₹'), 'Tom’s prices follow, live');

  step('Finance uses the same setting');
  await A.keyboard.press('Escape'); await research(A, 'finance');
  ok(await A.inputValue('#fin-currency') === 'INR', 'Finance shows the team’s currency');
  await A.selectOption('#fin-currency', 'CHF'); await sleep(500);
  const T = await team(A);
  ok(T.doc.currency === 'CHF' && T.finance.budget.currency === 'CHF', 'changing it there changes the team’s too');
  ok(await B.evaluate(async () => { try { return await TT.writeOps([{ type: 'update', path: 'team', data: { currency: 'EUR' } }], { quiet: true }); } catch { return false; } }) === false, 'a member can’t change it');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 8).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
