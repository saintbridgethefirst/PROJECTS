// Error monitoring and email-notification settings, in demo mode.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => { if (!/Test crash/.test(e.message)) errors.push(label + ': ' + e.message); }); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tt_demo_store_v1')));
const reports = async (p) => Object.values(((await store(p)).root || {}).clientErrors || {});

try {
  step('A crash is reported, without personal data');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@gmail.com');
  await A.fill('#create-team-form input[name=name]', 'Drone Challenge'); await A.click('#create-team-form button[type=submit]'); await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(() => { setTimeout(() => { throw new Error('Test crash for aisha@gmail.com in task 12345678'); }, 0); });
  await sleep(500);
  let r = await reports(A);
  ok(r.length === 1 && r[0].msg === 'Test crash for <email> in task <n>' && r[0].kind === 'error' && r[0].uid && r[0].build, 'stored, with the email and long number removed: ' + (r[0] && r[0].msg));
  await A.evaluate(() => { setTimeout(() => { throw new Error('Test crash for aisha@gmail.com in task 12345678'); }, 0); }); await sleep(400);
  ok((await reports(A)).length === 1, 'the same message is reported once per page load');
  await A.evaluate(() => { Promise.reject(new Error('Test crash: promise')); }); await sleep(400);
  ok((await reports(A)).some(x => x.kind === 'promise'), 'unhandled promise errors are reported too');
  await A.evaluate(() => TT.writeOps([{ type: 'update', path: 'team', data: { plan: { tier: 'org', edu: false, until: 0, by: TT.me.uid, at: 1, note: '' } } }])); await sleep(400);
  ok((await reports(A)).some(x => x.kind === 'write' && /permission/i.test(x.msg)), 'a refused save is reported (it means the app and rules disagree)');
  ok(await A.evaluate(() => new Promise(res => { const u = TT.watchClientErrors(() => res(false), () => res(true)); setTimeout(() => { if (typeof u === 'function') u(); res(false); }, 1500); })), 'ordinary users cannot read reports');

  step('The platform admin sees them, grouped');
  await A.click('#top-actions button:has-text("Settings")'); await A.click('.settings-nav button:has-text("Plan")'); await sleep(250);
  await A.click('#plan-demo-admin'); await sleep(600);
  await A.waitForSelector('.adm-errors .adm-err');
  const errText = await A.locator('.adm-errors').textContent();
  ok(errText.includes('Test crash for <email> in task <n>') && errText.includes('1×'), 'listed with how often');
  ok(await A.locator('.adm-errors .adm-err').count() >= 3, 'crash, promise and refused save all listed');
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/monitor-admin.png` });
  await A.keyboard.press('Escape'); await sleep(200);

  step('Email notification choices in your account');
  await A.evaluate(() => TT.openAccount()); await A.waitForSelector('#notify-field');
  ok(await A.locator('#notify-field input[data-notify="mentions"]').isChecked() && await A.locator('#notify-field input[data-notify="digest"]').isChecked(), 'both on by default');
  ok((await A.locator('#notify-field').textContent()).includes('aisha@gmail.com'), 'says which address they go to');
  await A.locator('#notify-field input[data-notify="digest"]').uncheck(); await sleep(400);
  let u = Object.values((await store(A)).users).find(x => x.email === 'aisha@gmail.com');
  ok(u.notify && u.notify.digest === false && u.notify.mentions === true, 'turning off the digest is saved to the account');
  await A.keyboard.press('Escape'); await A.reload(); await A.waitForSelector('.node-cat'); await sleep(400);
  await A.evaluate(() => TT.openAccount()); await A.waitForSelector('#notify-field');
  ok(!(await A.locator('#notify-field input[data-notify="digest"]').isChecked()), 'and remembered after reload');
  await A.keyboard.press('Escape');
  await A.goto(BASE + '#/account'); await sleep(800);
  ok(await A.locator('#notify-field').isVisible(), 'the link in emails (#/account) opens these settings');

  step('Pro feature list');
  ok(await A.evaluate(() => TT.hasPro('notifications') === false), 'Free team: email notifications are a Pro feature');
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
