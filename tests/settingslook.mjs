// The tidied settings: Your account in four sections (tabs on a phone), switches for on/off
// settings (Workflow, Fields, email notifications) and the new ticks (rounded, round for sub-tasks).
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

async function signIn(viewport) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Aisha Khan'); await p.fill('#auth-actions input[type=email]', 'aisha@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  return p;
}

try {
  step('Your account: four sections down the side');
  const p = await signIn({ width: 1280, height: 860 });
  await p.click('#home-account'); await p.waitForSelector('.account-modal');
  ok(await p.locator('.account-nav [data-acct]').count() === 4, 'Profile, Appearance, Notifications, App and data');
  ok((await p.locator('.account-nav [aria-current=page]').textContent()).includes('Profile'), 'opens on Profile');
  ok(await p.locator('.account-nav [data-acct] svg').count() === 4, 'each section has a line icon');
  ok(await p.locator('#acct-name').inputValue() === 'Aisha Khan' && await p.locator('#acct-save').textContent() === 'Save', 'Profile: the display name, with Save');
  ok(await p.locator('.modal-close[aria-label="Close"] svg').count() === 1, 'a round × closes it');
  await p.click('[data-acct="appearance"]');
  ok(await p.locator('.acct-title').textContent() === 'Appearance', 'Appearance opens');
  ok(await p.locator('.seg-toggle.pill [data-nav] svg').count() === 2 && await p.locator('.seg-toggle.pill [data-menu-style] svg').count() === 2, 'Top bar/Sidebar and List/Circle have line icons, not ▭ ▯ characters');
  ok(!(await p.locator('.account-pane').textContent()).match(/[▭▯☰◎]/), 'no box characters left');
  ok(await p.locator('#acct-save').textContent() === 'Done', 'the button says Done when there’s nothing to save');
  await p.click('[data-acct="notifications"]');
  ok(await p.locator('#notify-field input[role=switch]').count() === 2, 'Notifications: two switches');
  await p.click('[data-acct="data"]');
  ok(await p.locator('#my-data-download').isVisible() && await p.locator('#my-account-delete').isVisible(), 'App and data: download and delete');
  const r = await p.evaluate(() => { const a = document.querySelector('.account-nav').getBoundingClientRect(), b = document.querySelector('.account-pane').getBoundingClientRect(); return { side: a.right <= b.left + 1, w: a.width }; });
  ok(r.side && r.w > 180, 'the sections sit down the side on a computer');
  await p.keyboard.press('Escape');

  step('Switches in Workflow and Fields');
  await p.fill('#create-team-form input[name=name]', 'Look Lab');
  await p.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; });
  await p.click('#create-team-form button[type=submit]'); await p.waitForSelector('.node-cat'); await sleep(400);
  await p.evaluate(() => TT.openSettings('workflow')); await p.waitForSelector('#auto-settings');
  ok(await p.locator('#auto-settings .set-card .switch input[role=switch]').count() === 5, 'automatic steps: five switches in one card');
  ok(await p.locator('#pa-settings .switch input#pa-on').count() === 1, 'purchase approvals: a switch');
  ok(await p.locator('#auto-save').isDisabled(), 'Save waits for a change');
  await p.click('label[for="auto-tell"]'); await sleep(100);
  ok(await p.locator('#auto-tell').isChecked() && !(await p.locator('#auto-save').isDisabled()), 'clicking the words flips the switch and enables Save');
  await p.keyboard.press('Escape'); await sleep(150);
  await p.evaluate(() => TT.openSettings('fields')); await sleep(250);
  ok(await p.locator('.label-row .switch input[role=switch]').count() === 3, 'built-in fields: Show is a switch');
  await p.click('.settings-pane button:has-text("Add field")'); await sleep(150);
  ok(await p.locator('.field-list .field-show .switch input').count() === 1 && await p.locator('.field-list .icon-btn svg').count() === 3, 'a custom field: an On card switch, and up/down/delete icon buttons');
  await p.keyboard.press('Escape'); await sleep(150);

  step('Ticks: rounded in the team colour, round and green for sub-tasks');
  await p.evaluate(() => { const c = db.find(x => x.id === TT.me.uid).categories[0]; c[weeksData[0].key] = [{ id: 'tA', type: 'task', name: 'Rig', priority: 'Minor', status: '', flag: 'none', history: [], subtasks: [{ id: 's1', title: 'One', completed: true }, { id: 's2', title: 'Two', completed: false }] }]; saveDatabase(); render(); });
  await sleep(300);
  const sub = await p.evaluate(() => { const [a, b] = document.querySelectorAll('.task-card .subtask-item input'); const s = getComputedStyle(a), t = getComputedStyle(b); return { app: s.appearance, r: s.borderTopLeftRadius, w: s.width, bg: s.backgroundColor, offBg: t.backgroundColor }; });
  ok(sub.app === 'none' && sub.r === '50%' && sub.bg !== sub.offBg, 'sub-task ticks are drawn round, and filled when done');
  await p.evaluate(() => TT.openSettings('roles')); await sleep(250);
  const perm = await p.evaluate(() => { const i = document.querySelector('.perm-grid input[type=checkbox]'); const s = getComputedStyle(i); return { app: s.appearance, r: parseFloat(s.borderTopLeftRadius) }; });
  ok(perm.app === 'none' && perm.r >= 4 && perm.r < 9, 'other ticks are rounded squares');
  await p.keyboard.press('Escape');

  step('On a phone: four tabs across the top');
  const q = await signIn({ width: 390, height: 844 });
  await q.evaluate(() => TT.openAccount()); await q.waitForSelector('.account-modal');
  const ph = await q.evaluate(() => { const n = document.querySelector('.account-nav').getBoundingClientRect(); const bs = [...document.querySelectorAll('.account-nav [data-acct]')].map(b => b.getBoundingClientRect()); return { h: n.height, row: bs.every(b => Math.abs(b.top - bs[0].top) < 2), fit: bs.every(b => b.right <= 391) }; });
  ok(ph.h < 90 && ph.row && ph.fit, 'the sections are one row of tabs that fits the screen');
  ok(!(await q.locator('.acct-who').isVisible()), 'the name card in the menu is hidden (Profile shows it)');
  await q.click('[data-acct="appearance"]');
  const seg = await q.evaluate(() => { const s = document.querySelector('.seg-toggle.pill').getBoundingClientRect(); return s.width; });
  ok(seg > 300, 'two-way pickers fill the width under their label');
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
if (errors.length) fail++;
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
