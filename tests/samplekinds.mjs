// The demo's three sample teams: a student drone team, an engineering company and a satellite mission.
// Each opens from the demo card with its own name, words and tour, and keeps no drone text.
// Needs the preview server: npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const WANT = { drone: ['Skyhawk UAV', 'Welcome to Skyhawk UAV'], corporate: ['Harbourline AGV-200', 'Welcome to Harbourline Robotics'], satellite: ['Aurora-1 CubeSat', 'Welcome to Aurora-1'] };
try {
  for (const kind of ['corporate', 'satellite', 'drone']) {
    step('Demo: open the ' + kind + ' sample');
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', e => errors.push(kind + ': ' + e.message));
    await p.goto(BASE + 'demo'); await p.waitForSelector('.demo-kind');
    ok(await p.locator('.demo-kind').count() === 3, 'three teams to choose from');
    await p.click(`.demo-kind[data-kind="${kind}"]`); await p.fill('#demo-name', 'Vee');
    await p.click('#demo-go'); await p.waitForSelector('.task-card', { timeout: 20000 }); await sleep(2000);
    const teams = await p.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams).filter(([id]) => id.startsWith('t_sample_')).map(([id, t]) => ({ id, name: t.doc.name, json: JSON.stringify(t) })));
    ok(teams.length === 1 && teams[0].name.startsWith(WANT[kind][0]), 'team name: ' + (teams[0] && teams[0].name));
    if (kind !== 'drone') ok(!/Skyhawk|drone|Pixhawk|LiPo|flying field|Wing CAD|carbon tube/i.test(teams[0].json.replace(/"(c|t|wi)_[a-z0-9_]+"/g, '')), 'no drone words left');
    ok((await p.textContent('body')).includes(WANT[kind][1]), 'the tour greets: ' + WANT[kind][1]);
    ok(await p.locator('.task-card').count() > 10, 'the board is full of tasks');
    await ctx.close();
  }
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
