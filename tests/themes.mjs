// Theme packs in demo mode: the picker, every pack applied, saved in the browser and on
// the account (follows you to another device), "Match my device", and the old light/dark
// setting carried over. Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';
import { editorAsOneList } from './editor-list.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
editorAsOneList(browser);   // the task editor as one list: these checks reach into every tab
const PACKS = ['midnight', 'ocean', 'forest', 'grape', 'graphite', 'contrast-dark', 'daylight', 'paper', 'sakura', 'mint', 'contrast-light'];
const LIGHT = ['daylight', 'paper', 'sakura', 'mint', 'contrast-light'];

async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const state = (p) => p.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), pack: document.documentElement.getAttribute('data-pack'),
  bodyTheme: document.body.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--line-color').trim(), saved: localStorage.getItem('tt_theme') }));
const pick = async (p, id) => { await p.click(`.theme-card[data-theme="${id}"]`); await sleep(550); };

try {
  step('Picker opens from the team list and applies a pack');
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await signIn(p, 'Rushi Vibhandik', 'rushi@uni.ac.uk');
  ok((await state(p)).pack === null && (await state(p)).theme === null, 'starts on Midnight');
  await p.click('#home-theme'); await p.waitForSelector('.theme-card');
  ok(await p.locator('.theme-card').count() === 12, '12 choices: Match my device + 6 dark + 5 light');
  ok(await p.locator('.theme-card.on[data-theme="midnight"]').count() === 1, 'current theme is marked');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/themes-picker.png` });
  await pick(p, 'ocean');
  let s = await state(p);
  ok(s.pack === 'ocean' && s.theme === null && s.bg === 'rgb(7, 26, 36)' && s.accent === '#38bdf8', 'Ocean applied (background and accent)');
  ok(s.saved === 'ocean', 'saved in this browser');
  ok(await p.locator('.theme-card.on[data-theme="ocean"]').count() === 1, 'tick moves to the new choice');
  await pick(p, 'paper');
  s = await state(p);
  ok(s.pack === 'paper' && s.theme === 'light' && s.bg === 'rgb(245, 240, 230)', 'Paper applied as a light theme');
  const user = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).users)[0]);
  ok(user.theme === 'paper', 'saved on the account');
  await p.keyboard.press('Escape');

  step('Survives a reload, from the first paint');
  await p.reload();
  s = await state(p);
  ok(s.pack === 'paper' && s.theme === 'light', 'theme is on the page before the app starts');
  await p.waitForSelector('#home-screen:not([hidden])');

  step('Every pack on the board');
  await p.fill('#create-team-form input[name=name]', 'Robot Science and Technology'); await p.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await p.click('#create-team-form button[type=submit]');
  await p.waitForSelector('.node-cat'); await sleep(300);
  await p.evaluate(() => { const me = db.find(x => x.id === TT.me.uid); const c = me.categories[0]; const wk = weeksData[0].key; const d = new Date(); d.setDate(d.getDate() + 3);
    c[wk] = [{ id: 'ta', type: 'task', name: 'Design gripper', priority: 'Critical', status: 'CAD', flag: 'none', dueDate: d.toLocaleDateString('en-CA'), subtasks: [{ id: 's1', title: 'Sketch', completed: true }, { id: 's2', title: 'Model', completed: false }], history: [] },
      { id: 'tb', type: 'task', name: 'Order servos', priority: 'Minor', status: '', flag: 'completed', subtasks: [], history: [] },
      { id: 'tc', type: 'task', name: 'Wire harness', priority: 'Major', status: '', flag: 'pending', subtasks: [], history: [] }];
    saveDatabase(); render(); });
  await sleep(300);
  await p.locator('.task-card', { hasText: 'Design gripper' }).click(); await sleep(200);
  if (await p.locator('#editor-panel .ed-back').isVisible()) await p.click('#editor-panel .ed-back');   // the theme button sits in Search & filters
  ok((await p.locator('#theme-toggle-inner').textContent()).includes('Theme'), 'board button says Theme');
  for (const id of PACKS) {
    await p.click('#theme-toggle-inner'); await p.waitForSelector('.theme-card'); await pick(p, id); await p.keyboard.press('Escape'); await sleep(150);
    s = await state(p);
    ok((LIGHT.includes(id) ? s.theme === 'light' : s.theme === null) && (['midnight', 'daylight'].includes(id) ? s.pack === null : s.pack === id) && !s.bodyTheme, id + ' applied on the board');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/theme-${id}.png` });
  }
  // Readable buttons: text on accent buttons contrasts with the accent
  const contrast = await p.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const out = {};
    for (const id of ['midnight', 'ocean', 'forest', 'grape', 'graphite', 'contrast-dark', 'daylight', 'paper', 'sakura', 'mint', 'contrast-light']) {
      const r = document.documentElement; r.removeAttribute('data-theme'); r.removeAttribute('data-pack');
      if (['daylight', 'paper', 'sakura', 'mint', 'contrast-light'].includes(id)) r.setAttribute('data-theme', 'light');
      if (!['midnight', 'daylight'].includes(id)) r.setAttribute('data-pack', id);
      const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = 'x'; document.body.append(b);
      const cs = getComputedStyle(b); const a = lum(cs.backgroundColor), t = lum(cs.color); b.remove();
      const txt = getComputedStyle(document.body); const bg = lum(txt.backgroundColor), fg = lum(txt.color);
      out[id] = [(Math.max(a, t) + 0.05) / (Math.min(a, t) + 0.05), (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)];
    }
    return out;
  });
  Object.entries(contrast).forEach(([id, [btn, body]]) => { ok(btn >= 3, `${id}: button text readable (${btn.toFixed(1)}:1)`); ok(body >= 7, `${id}: body text readable (${body.toFixed(1)}:1)`); });
  await p.evaluate(() => TT.openThemes()); await pick(p, 'grape'); await p.keyboard.press('Escape');

  step('Your theme follows you to another device');
  const store = await p.evaluate(() => localStorage.getItem('tt_demo_store_v1'));
  const ctx2 = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const q = await ctx2.newPage(); q.on('pageerror', e => errors.push('device2: ' + e.message));
  await q.goto(BASE); await q.evaluate((d) => { localStorage.setItem('tt_demo_store_v1', d); localStorage.setItem('tt_theme', 'daylight'); }, store);
  await signIn(q, 'Rushi Vibhandik', 'rushi@uni.ac.uk'); await sleep(200);
  s = await state(q);
  ok(s.pack === 'grape' && s.theme === null && s.saved === 'grape', 'the other device switches to Grape on sign-in');
  await ctx2.close();

  step('Match my device');
  await p.goto(BASE + '#/'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.emulateMedia({ colorScheme: 'light' });
  await p.click('#home-theme'); await pick(p, 'auto');
  ok((await state(p)).theme === 'light' && (await state(p)).pack === null, 'light device → Daylight');
  await p.emulateMedia({ colorScheme: 'dark' }); await sleep(200);
  ok((await state(p)).theme === null && (await state(p)).pack === null, 'switching the device to dark → Midnight, live');
  ok((await state(p)).saved === 'auto', 'the saved choice stays "Match my device"');
  await p.keyboard.press('Escape');

  step('Old light/dark setting carries over');
  const ctx3 = await browser.newContext(); const r = await ctx3.newPage(); r.on('pageerror', e => errors.push('legacy: ' + e.message));
  await r.goto(BASE); await r.evaluate(() => { localStorage.clear(); localStorage.setItem('themePref', 'light'); }); await r.reload(); await sleep(300);
  ok((await state(r)).theme === 'light' && (await state(r)).pack === null, 'a light-mode user opens in Daylight');
  await ctx3.close(); await ctx.close();
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
