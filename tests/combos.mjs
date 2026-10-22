// Features switched on and off in many combinations: every view, tool and settings page must still
// open without an error, as the owner and as a member. (Seeded pseudo-random, so failures repeat.)
// Needs the preview server: npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

try {
  step('A team with tasks, parts, a budget, a workflow and a member');
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Owner O'); await p.fill('#auth-actions input[type=email]', 'o@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.click('#demo-sample'); await p.waitForSelector('.task-card'); await sleep(600);
  const keys = await p.evaluate(() => Object.keys(Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0].doc.features || {}));
  ok(keys.length >= 8, 'features: ' + keys.join(', '));
  const combos = [Object.fromEntries(keys.map(k => [k, true])), Object.fromEntries(keys.map(k => [k, false]))];
  for (let i = 0; i < 10; i++) combos.push(Object.fromEntries(keys.map(k => [k, rnd() < 0.5])));
  const setFeatures = (f) => p.evaluate((f) => { const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); Object.values(s.teams)[0].doc.features = f; localStorage.setItem(k, JSON.stringify(s)); }, f);
  const visit = async (label) => {
    const where = [];
    const tryIt = async (name, fn) => { const before = errors.length; try { await fn(); } catch (e) { errors.push(name + ': ' + e.message.split('\n')[0]); } if (errors.length > before) where.push(name); await p.keyboard.press('Escape').catch(() => {}); await p.evaluate(() => document.querySelectorAll('.modal-overlay, #analytics-overlay').forEach(m => m.remove())); await sleep(80); };
    await tryIt('kanban', async () => { await p.evaluate(() => boardSetView('kanban')); await sleep(250); });
    await tryIt('gantt', async () => { await p.evaluate(() => boardSetView('gantt')); await sleep(250); });
    await tryIt('board', async () => { await p.evaluate(() => boardSetView('board')); await sleep(250); });
    for (const tab of ['overview', 'team', 'deadlines', 'planning', 'timeline']) await tryIt('analytics ' + tab, async () => { await p.evaluate((t) => openAnalytics(t), tab); await sleep(200); });
    await tryIt('editor', async () => { await p.locator('.task-card').first().click(); await sleep(250); });
    await tryIt('right-click', async () => { await p.locator('.task-card').first().click({ button: 'right' }); await sleep(150); });
    await tryIt('tools', async () => {
      await p.evaluate(() => TT.openResearch()); await sleep(250);
      const tabs = await p.$$eval('.rs-tab', b => b.map(x => x.dataset.tab)); for (const t of tabs) { await p.click(`.rs-tab[data-tab="${t}"]`); await sleep(150); }
    });
    await tryIt('settings', async () => {
      await p.evaluate(() => TT.openSettings('general')); await p.waitForSelector('.settings-nav');
      const n = await p.locator('.settings-nav button').count(); for (let i = 0; i < n; i++) { await p.locator('.settings-nav button').nth(i).click(); await sleep(120); }
    });
    await tryIt('search', async () => { await p.evaluate(() => TT.openSearch()); await sleep(150); await p.keyboard.type('a'); await sleep(150); });
    await tryIt('activity', async () => { await p.evaluate(() => TT.openActivity('activity')); await sleep(150); });
    await tryIt('approvals', async () => { await p.evaluate(() => window.openApprovals && openApprovals()); await sleep(150); });
    if (await p.locator('#wb-btn:not([hidden])').count()) await tryIt('whiteboards', async () => { await p.click('#wb-btn'); await sleep(400); });
    ok(!where.length, label + ': no errors' + (where.length ? ' (in ' + where.join(', ') + '): ' + errors.slice(-3).join(' | ') : ''));
  };
  step(combos.length + ' combinations as the owner');
  for (let i = 0; i < combos.length; i++) {
    await setFeatures(combos[i]); await p.reload(); await p.waitForSelector('.task-card'); await sleep(300);
    await visit('owner, combination ' + (i + 1) + ' [' + keys.filter(k => combos[i][k]).join(',') + ']');
  }
  step('The same as a member (fewer permissions)');
  await p.evaluate(() => { const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const T = Object.values(s.teams)[0]; const me = Object.keys(T.members).find(u => T.members[u].roleId === 'owner'); const other = Object.keys(T.members).find(u => u !== me); T.members[me].roleId = 'member'; T.members[other].roleId = 'owner'; T.doc.ownerUid = other; localStorage.setItem(k, JSON.stringify(s)); });
  for (let i = 0; i < combos.length; i += 2) {
    await setFeatures(combos[i]); await p.reload(); await p.waitForSelector('.task-card'); await sleep(300);
    await visit('member, combination ' + (i + 1));
  }
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
