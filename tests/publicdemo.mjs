// The public demo at /demo: welcome screen, one click to the sample team, the guided tour, the ribbon.
// Nothing may reach the real database. Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [], remote = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
p.on('request', r => { if (/googleapis\.com|firebaseio|identitytoolkit|recaptcha/.test(r.url())) remote.push(r.url()); });
try {
  step('The welcome screen');
  await p.goto(BASE + 'demo'); await p.waitForSelector('#demo-go');
  ok((await p.locator('#auth-screen .auth-title').textContent()).includes('no sign-up'), 'says no sign-up');
  ok(await p.locator('#auth-screen .auth-tour').isHidden() && (await p.getAttribute('#try-demo', 'href')) === 'guide.html', 'no links back to the demo itself');
  ok(await p.locator('#demo-ribbon').isVisible(), 'the demo ribbon shows');

  step('One click: the sample team and the tour');
  await p.fill('#demo-name', 'Sam'); await p.click('#demo-go');
  await p.waitForSelector('.task-card'); await p.waitForSelector('.tour-card', { timeout: 8000 });
  ok((await p.locator('#team-switch').textContent()).includes('Skyhawk UAV'), 'opens the sample team');
  ok((await p.locator('.tour-card .tour-step').textContent()) === '1 of 16', 'tour starts at 1 of 16');
  const seen = [];
  for (let i = 0; i < 15; i++) {
    seen.push((await p.locator('.tour-card h3').textContent()) + (await p.locator('.tour-ring').isVisible() ? ' [ring]' : ''));
    if (i === 4) ok(seen[i].includes('Backlog'), 'a step shows the Backlog');
    if (i === 5) ok(seen[i].includes('Files'), 'a step shows file health');
    if (i === 7) ok(await p.locator('.kb-board').isVisible(), 'the Kanban step switches to Kanban');
    if (i === 8) ok(await p.locator('.lt-table').isVisible(), 'the List step switches to the List view');
    if (i === 10) ok(await p.locator('.gt2-scroll').isVisible(), 'the Gantt step switches to the Gantt');
    await p.click('#tour-next'); await sleep(i === 6 || i === 7 || i === 9 ? 600 : 250);
  }
  seen.push(await p.locator('.tour-card h3').textContent());
  ok(seen.filter(s => s.includes('[ring]')).length >= 8, 'most steps ring a real element: ' + seen.join(' | '));
  ok(!(await p.locator('.kb-board').isVisible()), 'back on the board after the Kanban step');
  ok((await p.getAttribute('.tour-card a.btn.primary', 'href')) === '/', 'the last step links to the real app');
  await p.click('#tour-skip'); await sleep(200);
  ok(!(await p.locator('.tour-card').count()) && !(await p.locator('.tour-ring').count()), 'the tour closes');
  await p.click('#demo-ribbon-tour'); await p.waitForSelector('.tour-card');
  ok(true, 'the ribbon’s Tour starts it again');
  await p.keyboard.press('Escape'); await sleep(200);
  ok(!(await p.locator('.tour-card').count()), 'Esc ends it');

  step('It is a sandbox');
  ok(await p.evaluate(() => TT.isDemo), 'demo backend');
  ok(remote.length === 0, 'no requests to Firebase or Google: ' + remote.slice(0, 3).join(', '));
  await p.goto(BASE + 'demo#/'); await p.waitForSelector('#home-screen:not([hidden])'); await sleep(500);
  await p.click('#demo-sample'); await p.waitForSelector('.task-card'); await sleep(500);
  ok(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams).filter(k => k.startsWith('t_sample_')).length) === 1, 'opening the sample again reuses it (no duplicates)');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 6).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
