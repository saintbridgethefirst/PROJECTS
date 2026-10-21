// Demo: "Explore a sample team" loads a made-up team with every newer feature in use, set to this week.
// Needs the preview server:  npx vite preview --port 4173
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
try {
  step('Load the sample team from the home screen');
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Visitor Vee'); await p.fill('#auth-actions input[type=email]', 'vee@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  ok(await p.locator('#demo-sample').isVisible(), 'the demo offers “Explore a sample team”');
  await p.click('#demo-sample'); await p.waitForSelector('.task-card'); await sleep(800);
  ok((await p.locator('#team-switch').textContent()).includes('Skyhawk UAV (sample team)'), 'opens Skyhawk UAV (sample team)');
  ok(await p.evaluate(() => TT.me.roleId === 'owner' && TT.members.length === 6), 'I am its owner, with 5 made-up teammates');
  ok(!(await p.locator('#start-card').count()), 'no “Start here” card (it isn’t a new team)');

  step('Set to this week, with the newer features in use');
  const thisWeek = await p.evaluate(() => { const t = new Date().toLocaleDateString('en-CA'); return weeksData.some(w => w.startDate && w.startDate <= t && t <= new Date(new Date(w.startDate + 'T12:00:00').getTime() + 6 * 864e5).toLocaleDateString('en-CA')); });
  ok(thisWeek, 'one of its weeks is this week');
  ok(await p.locator('.task-card .stage-bar').count() >= 5, 'cards show workflow stages');
  ok((await p.evaluate(() => TT.workflow.map(s => s.name).join(','))) === 'Design,Review,Build,Test,Done', 'Engineering workflow');
  await p.evaluate(() => boardSetView('kanban')); await p.waitForSelector('.kb-board');
  ok((await p.locator('.kb-col-head').count()) === 5 && (await p.locator('.kb-col-head[data-stage="build"] .kb-count').textContent()).includes('/ 4'), 'Kanban: five stage columns, Build limit 4');
  await p.evaluate(() => boardSetView('gantt')); await p.waitForSelector('.gt2-bar');
  ok(await p.locator('.gt2-bar').count() >= 20 && await p.locator('.gt2-link').count() >= 6, 'Gantt: bars with planned dates and “waits on” arrows (' + await p.locator('.gt2-bar').count() + ' bars, ' + await p.locator('.gt2-link').count() + ' links)');
  ok(await p.locator('.gt2-bar.soft-start').count() < await p.locator('.gt2-bar').count() / 2, 'most bars have real start dates');
  await p.evaluate(() => boardSetView('board')); await sleep(200);
  ok(await p.evaluate(() => TT.feature('subteams') && TT.feature('parts') && TT.feature('finance') && TT.feature('notebook') && TT.feature('risks')), 'tools switched on');
  await p.click('#share-btn'); await p.waitForSelector('#share-text');
  const text = await p.inputValue('#share-text');
  ok(text.startsWith('*Skyhawk UAV (sample team) · ') && /In progress|Done|Due/.test(text), 'the weekly share has this week in it');
  await p.keyboard.press('Escape');
  await p.goto(BASE + '#/'); await p.waitForSelector('#home-screen:not([hidden])'); await sleep(800);
  ok((await p.locator('#mytasks-section').textContent()).length > 40, 'My tasks on the home screen lists my sample tasks');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 6).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
