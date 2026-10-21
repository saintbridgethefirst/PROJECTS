// SelfTrack: your own space (#/me): daily and weekly tasks, habits, skills, learnings, reflection,
// team tasks synced in, and privacy from other accounts. Needs the preview server:  npx vite preview --port 4173
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
const signIn = async (page, name, email) => {
  await page.goto(BASE); await page.waitForSelector('#auth-screen:not([hidden])');
  await page.fill('#auth-actions input[placeholder="Your name"]', name); await page.fill('#auth-actions input[type=email]', email);
  await page.click('#auth-actions button:has-text("Sign in to demo")'); await page.waitForSelector('#home-screen:not([hidden])');
};
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tt_demo_store_v1')));
const mine = async (page, uid) => Object.values((await store(page)).root?.selfItems || {}).filter(i => i.uid === uid);
try {
  step('Open SelfTrack from the home screen');
  await signIn(p, 'Rushi', 'rushi@uni.ac.uk');
  const uid = await p.evaluate(() => TT.me ? TT.me.uid : JSON.parse(sessionStorage.getItem('tt_demo_session_v1')).uid);
  ok(await p.locator('#open-self').isVisible() && (await p.locator('#self-section').textContent()).includes('Private'), 'home shows the SelfTrack tile, marked private');
  await p.click('#open-self'); await p.waitForSelector('#sf-day-tasks');
  ok(await p.title() === 'SelfTrack', 'the title says SelfTrack');
  ok((await p.locator('.sf-logo').first().textContent()) === 'SelfTrack' && (await p.locator('.sf-sub').textContent()).includes('My life'), 'header: SelfTrack · My life');
  ok(await p.locator('#sf-welcome').isVisible(), 'a welcome card while empty');
  ok((await p.locator('#sf-day-title').textContent()).startsWith('Today'), 'opens on today');

  step('Daily tasks');
  await p.fill('#sf-new', 'Read chapter 3 #uni'); await p.press('#sf-new', 'Enter'); await sleep(250);
  await p.fill('#sf-new', 'Buy groceries'); await p.selectOption('#sf-new-area', 'home'); await p.click('#sf-day-tasks button[type=submit]'); await sleep(250);
  const rows = p.locator('#sf-day-list .sf-task');
  ok(await rows.count() === 2, 'two tasks today');
  ok((await rows.nth(0).textContent()).includes('Read chapter 3') && (await rows.nth(0).locator('.sf-chip').textContent()) === 'Uni', '#uni picked the Uni area and left the title clean');
  ok((await p.inputValue('#sf-new')) === '', 'the box empties after adding');
  await p.click('input[aria-label="Done: Read chapter 3"]'); await sleep(250);
  const cnt = await p.locator('#sf-day-count').textContent(); ok(cnt === '1 of 2 done', 'ticking counts it done (' + cnt + ', ' + (await p.locator('#sf-day-list').textContent()) + ')');
  ok(await p.locator('#sf-day-list .sf-task.done').count() === 1, 'done tasks are struck through');
  await p.click('#sf-day-list .sf-task:not(.done) button[aria-label^="Move to tomorrow"]'); await sleep(250);
  ok(await p.locator('#sf-day-list .sf-task').count() === 1, 'moved to tomorrow');
  await p.click('button[aria-label="Next day"]'); await sleep(150);
  ok((await p.locator('#sf-day-list').textContent()).includes('Buy groceries'), 'it is on tomorrow');
  await p.click('button[aria-label="Previous day"]'); await sleep(150);
  // A task from yesterday that wasn't done rolls into today.
  await p.evaluate(async (u) => {
    const d = new Date(); d.setDate(d.getDate() - 1); const y = d.toLocaleDateString('en-CA');
    const s = JSON.parse(localStorage.getItem('tt_demo_store_v1')); s.root.selfItems.s_late = { uid: u, kind: 'task', title: 'Left from yesterday', area: '', scope: 'day', date: y, done: false, doneOn: '', order: 0, createdAt: 1, updatedAt: 1 };
    localStorage.setItem('tt_demo_store_v1', JSON.stringify(s));
  }, uid);
  await p.reload(); await p.waitForSelector('#sf-day-list');
  ok((await p.locator('#sf-day-list').textContent()).includes('Left from yesterday') && (await p.locator('#sf-day-list .sf-late').textContent()).includes('yesterday'), 'unfinished tasks from yesterday roll into today, marked');

  step('Weekly goals');
  await p.fill('#sf-goal-new', 'Coursework draft'); await p.press('#sf-goal-new', 'Enter'); await sleep(250);
  ok((await p.locator('#sf-week-goals').textContent()).includes('Coursework draft'), 'a weekly goal');
  ok((await mine(p, uid)).find(i => i.title === 'Coursework draft').scope === 'week', 'saved as a weekly task');
  await p.click('#sf-week-goals .sf-task button[aria-label^="Delete"]'); await sleep(250);
  ok(!(await p.locator('#sf-week-goals').textContent()).includes('Coursework draft'), 'deleted');
  await p.click('#toast-container button:has-text("Undo"), .toast button:has-text("Undo")'); await sleep(300);
  ok((await p.locator('#sf-week-goals').textContent()).includes('Coursework draft'), 'undo brings it back');

  step('Habits: track, tick, streak calendar');
  await p.click('#sf-tab-growth'); await p.waitForSelector('#sf-hero');
  await p.click('#sf-track'); await p.waitForSelector('#sf-tracker');
  await p.fill('#sf-tr-title', 'Gym'); await p.selectOption('#sf-tr-goal', '3'); await p.click('#sf-tr-save'); await sleep(300);
  const gym = p.locator('#sf-g-habits .sf-orb-btn').first();
  ok(await gym.getAttribute('aria-pressed') === 'false' && await p.locator('#sf-g-habits .orb').count() === 1, 'a habit orb');
  await gym.click(); await sleep(250);
  ok(await p.locator('#sf-g-habits .sf-orb-btn').first().getAttribute('aria-pressed') === 'true', 'tapping the orb checks in for today');
  ok((await p.locator('#sf-g-habits .orb-core').first().textContent()).includes('✓'), 'the orb shows a tick');
  ok(await p.locator('#sf-g-habits .orb-arc').count() === 1, 'its ring fills');
  await p.click('#sf-g-habits .sf-habit-name'); await p.waitForSelector('#sf-habit-modal .sf-cal');
  const past = p.locator('#sf-habit-modal .sf-cal button:not(.on):not([disabled])').first();
  await past.click(); await sleep(250);
  ok(await p.locator('#sf-habit-modal .sf-cal button.on').count() === 2, 'tick a past day you forgot');
  await p.keyboard.press('Escape'); await sleep(150);

  step('Skills: log practice, level, journey');
  await p.click('#sf-g-skills .btn'); await p.waitForSelector('#sf-tracker');
  ok(await p.locator('#sf-tracker [data-kind=skill][aria-pressed=true]').count() === 1, 'the + on Skills starts a skill');
  await p.fill('#sf-tr-title', 'ROS 2'); await p.fill('#sf-tr-goal', '10'); await p.click('#sf-tr-save'); await sleep(300);
  await p.click('#sf-g-skills .sf-skill'); await p.waitForSelector('#sf-skill-modal');
  await p.click('#sf-skill-modal [data-mins="30"]'); await sleep(250);
  ok((await p.locator('#sf-skill-modal .sf-skill-hero .orb-core b').textContent()) === '30 min', '+30 min logged');
  await p.fill('#sf-sk-mins', '45'); await p.press('#sf-sk-mins', 'Enter'); await sleep(250);
  ok((await p.locator('#sf-skill-modal .sf-level.on').textContent()) === 'Learning', '75 min of a 10 h goal: Learning');
  await p.fill('#sf-sk-note', 'Nodes talk over topics'); await p.press('#sf-sk-note', 'Enter'); await sleep(250);
  const journey = await p.locator('#sf-skill-modal .sf-journey').textContent();
  ok(journey.includes('Reached Learning') && journey.includes('Nodes talk over topics') && journey.includes('Started'), 'the journey: started, learned, reached a level');
  await p.keyboard.press('Escape'); await sleep(150);
  ok((await p.locator('#sf-g-learn').textContent()).includes('Nodes talk over topics'), 'the note is in Learnings too');

  step('Reflect');
  await p.fill('#sf-ref-well', 'Kept the gym going'); await p.locator('#sf-ref-well').blur(); await sleep(250);
  await p.click('#sf-reflect .sf-mood-btn[aria-label="Good"]'); await sleep(250);
  await p.reload(); await p.waitForSelector('#sf-reflect');
  ok((await p.inputValue('#sf-ref-well')) === 'Kept the gym going' && await p.locator('#sf-reflect .sf-mood-btn[aria-pressed=true]').getAttribute('aria-label') === 'Good', 'the reflection is saved');

  step('Week view and Sunday review');
  await p.click('#sf-tab-week'); await p.waitForSelector('#sf-weekgrid');
  const heads = await p.locator('#sf-weekgrid .sf-wh').allTextContents();
  ok(heads.length === 9 && heads[1] === 'Week goals' && /^Mon \d+$/.test(heads[2]) && /^Sun \d+$/.test(heads[8]), 'columns: week goals, then Monday to Sunday');
  ok(!(await p.locator('#sf-weekgrid').textContent()).includes('[object'), 'headers render as text');
  ok((await p.locator('#sf-weekgrid .sf-area').allTextContents()).slice(0, 4).join(',') === 'Uni,Health,Home,Projects', 'rows are your areas');
  const healthMon = p.locator('#sf-weekgrid .sf-cell').nth(9);   // Health row (2nd), Monday: Uni's 8 cells, Health's week goals, then Monday
  await healthMon.locator('.sf-cell-add').click(); await p.fill('#sf-cell-input', 'Stretch'); await p.press('#sf-cell-input', 'Enter'); await sleep(250);
  ok((await p.locator('#sf-weekgrid .sf-cell').nth(9).textContent()).includes('Stretch'), 'add straight into a day and area');
  ok((await mine(p, uid)).find(i => i.title === 'Stretch').area === 'health', 'saved in that area');
  await p.click('#sf-review-btn'); await p.waitForSelector('#sf-review-open');
  await p.fill('#sf-rev-hard', 'Too many deadlines'); await p.fill('#sf-top-1', 'Submit coursework #uni');
  await p.click('#sf-review-done'); await sleep(400);
  ok((await p.locator('#sf-week-title').textContent()).startsWith('Week of'), 'the review moves you on to next week');
  ok((await p.locator('#sf-weekgrid').textContent()).includes('Submit coursework') && (await p.locator('#sf-weekgrid').textContent()).includes('Coursework draft'), 'next week has your top 3 and the unfinished goal');

  step('Team tasks synced in');
  await p.goto(BASE + '#/'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.click('#demo-sample'); await p.waitForSelector('.task-card'); await sleep(600);
  await p.goto(BASE + '#/me'); await p.waitForSelector('#sf-sync'); await p.waitForSelector('#sf-sync-list', { timeout: 8000 });
  const n = await p.locator('#sf-sync-list li').count();
  ok(n >= 1 && (await p.locator('#sf-sync').textContent()).includes('Skyhawk UAV'), n + ' task(s) from the sample team this week');
  const gated = p.locator('#sf-sync-list li:has(.sf-gated)');
  ok(await gated.count() >= 1 && await gated.first().locator('input[type=checkbox]').count() === 0, 'tasks waiting in Review show a lock, not a tick box (they need a sign-off first)');
  // Its Test sign-off given: now it can be ticked off from here.
  const gId = await gated.first().getAttribute('data-id');
  await p.evaluate((id) => { const k = 'tt_demo_store_v1'; const st = JSON.parse(localStorage.getItem(k)); const T = Object.values(st.teams).find(x => x.tasks && x.tasks[id]);
    T.tasks[id].stage = 'test'; T.tasks[id].signoff = { stage: 'test', status: 'approved', by: 'x', byName: 'x', at: 1, approver: T.doc.ownerUid, approverName: 'Owner', note: '', decidedAt: 2 }; localStorage.setItem(k, JSON.stringify(st)); }, gId);
  await p.reload(); await p.waitForSelector('#sf-sync-list', { timeout: 8000 }); await sleep(300);
  const first = p.locator('#sf-sync-list li[data-id="' + gId + '"]');
  ok(await first.locator('input[type=checkbox]').count() === 1, 'once signed off, it gets a tick box'); const tId = await first.getAttribute('data-id'); const teamId = await first.getAttribute('data-team');
  await first.locator('input[type=checkbox]').click(); await sleep(500);
  const t = (await store(p)).teams[teamId].tasks[tId];
  ok(t.flag === 'completed' && t.history[0].updated.includes('SelfTrack'), 'ticking it completes it on the team board, with a history line');
  ok(await p.locator('#sf-sync-list li[data-id="' + tId + '"]').count() === 0, 'and it leaves the list');
  await p.locator('#sf-sync .sf-sync-team input').first().uncheck(); await sleep(300);
  ok(await p.locator('#sf-sync-list').count() === 0 && (await p.locator('#sf-sync').textContent()).includes('Hidden'), 'switch a team off');
  await p.locator('#sf-sync .sf-sync-team input').first().check(); await sleep(300);
  await p.locator('#sf-sync-list .sf-team-open').first().click(); await p.waitForSelector('#board-screen:not([hidden])');
  ok((await p.evaluate(() => location.hash)).startsWith('#/t/'), 'a synced task opens in its team');

  step('Private: another account sees none of it');
  const p2 = await ctx.newPage(); p2.on('pageerror', e => errors.push('p2: ' + e.message));
  await signIn(p2, 'Other', 'other@x.com'); await p2.goto(BASE + '#/me'); await p2.waitForSelector('#sf-day-tasks');
  ok(await p2.locator('#sf-welcome').isVisible() && !(await p2.locator('#sf-main').textContent()).includes('Read chapter 3'), 'their SelfTrack is empty');
  await p2.close();

  step('Example data, throwback, the big orb');
  await p.goto(BASE + '#/me/growth'); await p.waitForSelector('#sf-hero');
  const before = await p.locator('#sf-hero .orb-core b').textContent();
  ok(/^\d+%$/.test(before), 'the month orb shows a percentage (' + before + ')');
  await p.evaluate(() => { location.hash = '#/me/today'; }); await p.waitForSelector('#sf-day-tasks');
  ok(await p.locator('#sf-fill-sample').count() === 0, 'the example button only shows while SelfTrack is empty');

  step('Phone width and reduced motion');
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(300);
  ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), 'Today fits a phone without sideways scrolling');
  await p.click('#sf-tab-growth'); await sleep(300);
  ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), 'Growth fits a phone too');
  await p.emulateMedia({ reducedMotion: 'reduce' }); await sleep(100);
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.orb-l1')).animationName === 'none'), 'orbs hold still with reduced motion');
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.orb-l1')).animationName === 'sf-spin'), 'and swirl otherwise');

  step('Back home');
  await p.click('#sf-home'); await p.waitForSelector('#home-screen:not([hidden])');
  ok(await p.title() !== 'SelfTrack', 'the title goes back');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 6).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
