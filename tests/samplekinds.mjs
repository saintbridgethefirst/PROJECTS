// The demo's four sample teams: a student drone team, an engineering company, a satellite mission and a Formula Student team.
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
const WANT = { drone: ['Skyhawk UAV', 'Welcome to Skyhawk UAV'], corporate: ['Harbourline AGV-200', 'Welcome to Harbourline Robotics'], satellite: ['Aurora-1 CubeSat', 'Welcome to Aurora-1'], formula: ['Apex Racing FS26', 'Welcome to Apex Racing'] };
try {
  for (const kind of ['corporate', 'satellite', 'formula', 'drone']) {
    step('Demo: open the ' + kind + ' sample');
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', e => errors.push(kind + ': ' + e.message));
    await p.goto(BASE + 'demo'); await p.waitForSelector('.demo-kind');
    ok(await p.locator('.demo-kind').count() === 4, 'four teams to choose from');
    await p.click(`.demo-kind[data-kind="${kind}"]`); await p.fill('#demo-name', 'Vee');
    await p.click('#demo-go'); await p.waitForSelector('.task-card', { timeout: 20000 }); await sleep(2000);
    const teams = await p.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams).filter(([id]) => id.startsWith('t_sample_')).map(([id, t]) => ({ id, name: t.doc.name, json: JSON.stringify(t) })));
    ok(teams.length === 1 && teams[0].name.startsWith(WANT[kind][0]), 'team name: ' + (teams[0] && teams[0].name));
    if (kind !== 'drone') ok(!/Skyhawk|drone|Pixhawk|LiPo|flying field|Wing CAD|carbon tube/i.test(teams[0].json.replace(/"(c|t|wi)_[a-z0-9_]+"/g, '')), 'no drone words left');
    ok((await p.textContent('body')).includes(WANT[kind][1]), 'the tour greets: ' + WANT[kind][1]);
    ok(await p.locator('.task-card').count() > 10, 'the board is full of tasks');
    const pro = await p.evaluate(() => document.body.classList.contains('look-pro'));
    ok(pro === (kind === 'corporate'), 'Professional look ' + (kind === 'corporate' ? 'on for the company' : 'off for ' + kind));
    if (kind === 'corporate') {
      ok(!/\p{Extended_Pictographic}/u.test(await p.evaluate(() => document.getElementById('top-bar').innerText)), 'no emoji in the menu');
      ok(await p.locator('#top-bar .look-ico').count() >= 10, 'line icons in the menu');
      await p.evaluate(() => document.querySelectorAll('[class*=tour-]').forEach(e => e.remove()));
      step('Professional look: search shows line icons, buttons show hover labels');
      await p.click('#search-btn'); await p.waitForSelector('.cmdk-item');
      const rows = await p.locator('.cmdk-item').count(), withIcon = await p.locator('.cmdk-item .cmdk-lico').count();
      ok(rows > 5 && withIcon === rows, 'every action in search has a line icon (' + withIcon + '/' + rows + ')');
      ok(await p.evaluate(() => [...document.querySelectorAll('.cmdk-emoji')].every(e => getComputedStyle(e).display === 'none')), 'no emoji next to search actions');
      await p.keyboard.press('Escape'); await sleep(300);
      await p.hover('#activity-btn'); await sleep(700);
      ok(await p.evaluate(() => { const t = document.querySelector('.tt-tip.on'); return !!t && /activity/i.test(t.textContent); }), 'hovering a menu button shows its label');
      ok(!(await p.evaluate(() => document.getElementById('activity-btn').hasAttribute('title'))), 'the browser tooltip is held back while ours shows');
      await p.mouse.move(700, 600); await sleep(300);
      ok(await p.evaluate(() => !document.querySelector('.tt-tip.on') && document.getElementById('activity-btn').hasAttribute('title')), 'the label goes away and the title comes back');
      const face = await p.evaluate(() => { const a = document.querySelector('#online-btn .avatar'); if (!a) return null; a.textContent = ''; const i = document.createElement('img'); i.src = '/og-image.jpg'; a.append(i); return new Promise(r => i.onload = () => { const b = i.getBoundingClientRect(), btn = document.getElementById('online-btn').getBoundingClientRect(); r({ w: b.width, h: b.height, inside: b.top >= btn.top && b.bottom <= btn.bottom, round: getComputedStyle(i).borderRadius }); }); });
      ok(face && face.w <= 24 && face.h <= 24 && face.inside && face.round === '50%', 'a profile photo stays a small circle inside the online button ' + JSON.stringify(face));
      await p.evaluate(() => TT.openSettings('general')); await p.waitForSelector('.look-opts');
      await p.click('.look-opt:has-text("Friendly") input'); await sleep(1000);
      ok(!(await p.evaluate(() => document.body.classList.contains('look-pro'))) && /\p{Extended_Pictographic}/u.test(await p.evaluate(() => document.getElementById('top-bar').innerText)), 'switching to Friendly brings the emoji back');
    }
    await ctx.close();
  }
  step('A guide can link straight to its team: /demo?team=formula');
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', e => errors.push('link: ' + e.message));
    await p.goto(BASE + 'demo?team=formula'); await p.waitForSelector('.demo-kind.on');
    ok(await p.locator('.demo-kind.on').getAttribute('data-kind') === 'formula', 'the Formula Student team is picked');
    ok((await p.textContent('#demo-go')).includes('Formula Student team'), 'the button opens it');
    await ctx.close(); }
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
