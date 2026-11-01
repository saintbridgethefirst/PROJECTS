// Feature switches and the advanced tools in demo mode: Settings ▸ Features (what's on for a new
// team, hiding things when off, only admins can change it, older teams keep what they had), People
// (hours, skills, time off, heatmap, who could take a task), time logging and timesheets, the risk
// register, requirements, the progress report's new sections, and workload across teams.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';
import { editorAsOneList } from './editor-list.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const iso = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };
const monday = () => { const x = new Date(); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toLocaleDateString('en-CA'); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
editorAsOneList(browser);   // the task editor as one list: these checks reach into every tab
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tt_demo_store_v1')));
const teamNamed = async (p, name) => Object.values((await store(p)).teams).find(t => t.doc.name === name);
const card = (p, name) => p.locator('.task-card', { hasText: name }).first();
async function openCard(p, name) { await card(p, name).evaluate(e => e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })); await card(p, name).click(); await sleep(300); }
const toggle = async (p, key, on) => { const cb = p.locator(`.feature-card[data-feature="${key}"] input`); if ((await cb.isChecked()) !== on) { await cb.click({ force: true }); await sleep(400); } };
const openFeatures = async (p) => { await p.click('#top-actions button:has-text("Settings")'); await p.click('.settings-nav button:has-text("Features")'); await sleep(200); };
const toolTabs = (p) => p.locator('.rs-tab').allTextContents();

try {
  step('A new team starts with the standard features');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Robot Science'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate((m) => {
    const add = (n) => { const x = new Date(m); x.setDate(x.getDate() + 7 * n); return x.toLocaleDateString('en-CA'); };
    weeksData[0].startDate = m; weeksData.push({ key: 'wk_two', title: 'WEEK 2', metric: '', collapsed: false, startDate: add(1) });
    db.forEach(p => p.categories.forEach(c => { c.wk_two = c.wk_two || []; }));
    const c = db.find(x => x.id === TT.me.uid).categories[0]; const wk = weeksData[0].key;
    c[wk] = [{ id: 't1', type: 'task', name: 'Design gripper', priority: 'Major', status: '', flag: 'none', subtasks: [], history: [], effort: 6 },
      { id: 't2', type: 'task', name: 'CAD the base plate', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [], effort: 8 }];
    saveDatabase(); render();
  }, monday());
  await sleep(400);
  const T0 = await teamNamed(A, 'Robot Science');
  ok(T0.doc.features && T0.doc.features.planning === true && T0.doc.features.parts === false && T0.doc.features.people === false, 'new team: standard on, advanced off');
  await openFeatures(A);
  ok(await A.locator('.feature-card:not(.pro-card)').count() === 12, 'Features page lists 12 features (Penteint Projects: no Dissertation)');
  ok(await A.locator('.feature-card.on').count() === 4, 'four standard ones on (incl. Whiteboards; Literature is advanced in Penteint Projects)');
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/features-settings.png` });
  await A.keyboard.press('Escape'); await sleep(200);
  await A.click('#research-btn'); await A.waitForSelector('.research-modal');
  ok((await toolTabs(A)).join('|') === '📝 Meetings', 'Tools shows only Meetings');
  ok((await A.locator('.modal-head h3').last().textContent()).includes('Tools'), 'the window is called Tools');
  await A.keyboard.press('Escape'); await sleep(200);
  await openCard(A, 'Design gripper');
  ok(await A.locator('#edit-form #time-hours').count() === 0 && await A.locator('#edit-form #edit-skill').count() === 0, 'no time or skill sections yet');

  step('Turning features off hides them');
  await A.keyboard.press('Escape');
  await openFeatures(A); await toggle(A, 'planning', false); await toggle(A, 'notebook', false); await A.keyboard.press('Escape'); await sleep(300);
  await openCard(A, 'Design gripper');
  ok(await A.locator('#edit-effort').count() === 0 && (await A.locator('#edit-form').textContent()).includes('Stage'), 'Planning off: stage stays, effort and waits-on go');
  ok(await A.locator('#edit-form .nb-section').count() === 0, 'Notebook off: no notebook section');
  ok(await card(A, 'Design gripper').locator('.effort-chip').count() === 0, 'no effort badge on cards');
  await card(A, 'Design gripper').click({ button: 'right' }); await sleep(250);
  ok(await A.locator('#quick-menu.active .qm-btn', { hasText: 'Waits on' }).count() === 0, 'no “Waits on” in the menu');
  await A.keyboard.press('Escape');
  await A.evaluate(() => openAnalytics('overview')); await sleep(300);
  ok(await A.locator('.an-tab[data-tab="planning"]').count() === 0, 'no Planning tab in analytics');
  await A.keyboard.press('Escape'); await sleep(200);
  await openFeatures(A); await toggle(A, 'meetings', false); await toggle(A, 'literature', false); await A.keyboard.press('Escape'); await sleep(300);
  ok(!(await A.locator('#research-btn').isVisible()), 'with no tools on, the Tools button disappears');
  await openFeatures(A);
  for (const k of ['planning', 'notebook', 'meetings', 'literature', 'people', 'time', 'risks', 'requirements']) await toggle(A, k, true);
  await A.keyboard.press('Escape'); await sleep(300);
  const F = (await teamNamed(A, 'Robot Science')).doc.features;
  ok(F.planning && F.notebook && F.people && F.time && F.risks && F.requirements && !F.parts, 'features saved on the team');
  ok(await card(A, 'Design gripper').locator('.effort-chip').count() === 1, 'turning Planning back on brings the badges back');

  step('Only team admins can change features');
  await A.click('#top-actions button:has-text("Invite")'); await A.fill('.settings-pane textarea', 'tom@uni.ac.uk'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(200); await A.keyboard.press('Escape');
  const B = await tab('Tom'); await signIn(B, 'Tom Reed', 'tom@uni.ac.uk');
  await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat'); await sleep(500);
  await B.evaluate(() => TT.openSettings('features')); await B.waitForSelector('.settings-nav'); await sleep(200);
  const tabs = await B.evaluate(() => [...document.querySelectorAll('.settings-nav button')].map(b => b.textContent));
  ok(!tabs.includes('Features') && !tabs.includes('Workflow') && !tabs.includes('Integrations'), 'a member doesn’t see the Features, Workflow or Integrations settings: ' + tabs.join(', '));
  await B.keyboard.press('Escape'); await sleep(200);

  step('People: hours, skills, time off, heatmap');
  await B.click('#research-btn'); await B.waitForSelector('.research-modal'); await B.click('.rs-tab[data-tab="people"]'); await sleep(300);
  await B.fill('#pp-capacity', '10'); await B.press('#pp-capacity', 'Tab'); await sleep(300);
  await B.fill('#pp-skill', 'CAD'); await B.click('#pp-skill-add'); await sleep(300);
  await B.fill('#pp-away-from', iso(14)); await B.fill('#pp-away-to', iso(20)); await B.fill('#pp-away-note', 'Conference'); await B.click('#pp-away-add'); await sleep(300);
  const T1 = await teamNamed(B, 'Robot Science'); const tomUid = Object.values(T1.members).find(m => m.email === 'tom@uni.ac.uk').uid;
  const prof = T1.profiles[tomUid];
  ok(prof && prof.capacity === 10 && prof.skills[0] === 'CAD' && prof.away[0].note === 'Conference', 'Tom’s hours, skill and time off saved');
  await B.keyboard.press('Escape');
  await A.bringToFront();
  await A.click('#research-btn'); await A.waitForSelector('.research-modal'); await A.click('.rs-tab[data-tab="people"]'); await sleep(300);
  await A.fill('#pp-capacity', '10'); await A.press('#pp-capacity', 'Tab'); await sleep(400);
  const aCell = A.locator('.heat-table tr', { hasText: 'Aisha Khan' }).locator('td.heat').first();
  ok((await aCell.textContent()).startsWith('14h / 10h') && (await aCell.getAttribute('class')).includes('h-over'), 'Aisha’s week: 14h planned against 10h → over capacity');
  const tCell = A.locator('.heat-table tr', { hasText: 'Tom Reed' }).locator('td.heat').first();
  ok((await tCell.getAttribute('class')).includes('h-empty'), 'Tom’s week is free');
  await aCell.click(); await sleep(300);
  ok((await A.locator('.heat-detail').textContent()).includes('CAD the base plate'), 'clicking a cell lists that week’s tasks');
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/features-people.png` });
  await A.keyboard.press('Escape'); await sleep(200);

  step('A task that needs a skill suggests who could take it');
  await openCard(A, 'CAD the base plate');
  const skillOpts = await A.locator('#edit-skill option').allTextContents();
  ok(skillOpts.includes('CAD · 1 person') && skillOpts.includes('Other skill…'), 'the dropdown lists the team’s skills: ' + skillOpts.join(' | '));
  await A.selectOption('#edit-skill', '__other'); await A.fill('#edit-skill-other', 'Welding'); await A.press('#edit-skill-other', 'Enter'); await sleep(500);
  ok(await A.inputValue('#edit-skill') === 'Welding' && /nobody yet/.test(await A.locator('#edit-skill option:checked').textContent()), 'a skill nobody has yet can be typed in');
  await A.selectOption('#edit-skill', 'CAD'); await sleep(500);
  const t2 = Object.values((await teamNamed(A, 'Robot Science')).tasks).find(t => t.name === 'CAD the base plate');
  ok(t2.skill === 'CAD', 'skill saved on the task');
  ok(await card(A, 'CAD the base plate').locator('.skill-chip').count() === 1, 'card shows 🎯 CAD');
  ok((await A.locator('#edit-form .dep-item', { hasText: 'Tom Reed' }).textContent()).includes('10h free'), 'suggests Tom, with 10h free');
  await A.locator('#edit-form .sugg-assign').click(); await sleep(500);
  ok(Object.values((await teamNamed(A, 'Robot Science')).tasks).find(t => t.name === 'CAD the base plate').ownerUid === tomUid, '“Give to Tom” moves the task to Tom');
  await A.click('#research-btn'); await A.waitForSelector('.research-modal'); await A.click('.rs-tab:has-text("People")'); await sleep(300);
  const give = A.locator('.sugg-give'); ok(await give.count() === 0 || (await give.allTextContents()).every(t => !t.includes('Tom Reed')), 'People tool: Tom is shown as the current owner, not offered');
  await A.keyboard.press('Escape'); await sleep(200);

  step('Time logging and the timesheet');
  await openCard(A, 'Design gripper');
  await A.fill('#time-hours', '2.5'); await A.fill('#time-note', 'First sketches'); await A.click('#time-log'); await sleep(500);
  const t1 = Object.values((await teamNamed(A, 'Robot Science')).tasks).find(t => t.name === 'Design gripper');
  ok(t1.timeLog.length === 1 && t1.timeLog[0].hours === 2.5 && t1.timeLog[0].note === 'First sketches', 'time logged on the task');
  ok((await card(A, 'Design gripper').locator('.time-chip').textContent()).includes('2.5 / 6h'), 'card shows 2.5 of 6h');
  ok((await A.locator('#edit-form .time-head').textContent()).includes('2.5h of 6h estimated'), 'editor shows logged vs estimate');
  await A.click('#research-btn'); await A.waitForSelector('.research-modal'); await A.click('.rs-tab[data-tab="time"]'); await sleep(300);
  ok((await A.locator('.rs-kpi', { hasText: 'Hours logged' }).textContent()).includes('2.5h') && (await A.locator('.rs-table').textContent()).includes('First sketches'), 'timesheet lists the entry');
  const [ts] = await Promise.all([A.waitForEvent('download'), A.click('#ts-export')]);
  ok(/Timesheet_.*\.xlsx$/.test(ts.suggestedFilename()), 'timesheet exports to Excel');

  step('Risk register');
  await A.click('.rs-tab[data-tab="risks"]'); await sleep(200);
  await A.click('#rk-new'); await A.fill('#rk-title', 'Servos arrive late'); await A.selectOption('#rk-likelihood', '4'); await A.selectOption('#rk-impact', '4'); await A.fill('#rk-plan', 'Order a spare set from a UK supplier');
  await A.click('.rs-form button[type=submit]'); await sleep(400);
  const rk = Object.values((await teamNamed(A, 'Robot Science')).risks || {});
  ok(rk.length === 1 && rk[0].likelihood === 4 && rk[0].impact === 4, 'risk saved');
  ok((await A.locator('.risk-score').first().textContent()) === '16' && (await A.locator('.rs-kpi', { hasText: 'High' }).textContent()).includes('1'), 'score 16 = high');
  ok((await A.locator('.rg-cell.b-high', { hasText: '1' }).count()) === 1, 'shown on the 5 × 5 grid');
  await A.locator('.rk-status').first().selectOption('mitigating'); await sleep(300);
  ok(Object.values((await teamNamed(A, 'Robot Science')).risks)[0].status === 'mitigating', 'status changed');
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/features-risks.png` });

  step('Requirements and traceability');
  await A.click('.rs-tab[data-tab="requirements"]'); await sleep(200);
  await A.click('#rq-new'); await A.fill('#rq-title', 'The arm lifts a 500 g load'); await A.selectOption('#rq-priority', 'must'); await A.fill('#rq-verify', 'Lift test, 10 repeats');
  await A.click('.rs-form button[type=submit]'); await sleep(400);
  let rq = Object.values((await teamNamed(A, 'Robot Science')).requirements || {});
  ok(rq.length === 1 && rq[0].ref === 'REQ-001' && rq[0].priority === 'must', 'requirement REQ-001 saved');
  ok((await A.locator('.rs-kpi', { hasText: 'Must' }).textContent()).includes('1'), 'one “must” not yet verified');
  await A.locator('.req-table tr', { hasText: 'REQ-001' }).locator('.rq-link').click(); await A.waitForSelector('.cmdk-input');
  await A.fill('.cmdk-input', 'gripper'); await sleep(150); await A.keyboard.press('Enter'); await sleep(400);
  await A.locator('.req-table tr', { hasText: 'REQ-001' }).locator('.rq-verified input').check(); await sleep(400);
  rq = Object.values((await teamNamed(A, 'Robot Science')).requirements);
  ok(rq[0].taskIds.includes('t1') && rq[0].verified && rq[0].verifiedBy === 'Aisha Khan', 'linked to a task and verified');
  const kpiV = async (label) => A.locator('.rs-kpi').filter({ has: A.locator('.rs-kpi-l', { hasText: new RegExp('^' + label + '$') }) }).locator('.rs-kpi-v').textContent();
  ok((await kpiV('Linked to tasks')) === '100%' && (await kpiV('Verified')) === '100%' && (await kpiV('“Must” not yet verified')) === '0', 'coverage and verified at 100%, no open musts');
  const [tr] = await Promise.all([A.waitForEvent('download'), A.click('#rq-export')]);
  ok(/Requirements\.xlsx$/.test(tr.suggestedFilename()), 'traceability exports to Excel');
  await A.keyboard.press('Escape'); await sleep(200);
  await openCard(A, 'Design gripper');
  ok((await A.locator('#edit-form .linked-section').textContent()).includes('REQ-001'), 'the task shows the requirement it delivers');

  step('The progress report follows the features');
  await A.evaluate(() => TT.openReport()); await A.waitForSelector('.report-modal'); await sleep(500);
  const secs = await A.locator('.rp-sec').allTextContents();
  ok(secs.includes('Hours logged') && secs.includes('Risk register') && secs.includes('Requirements') && !secs.includes('Parts and orders'), 'sections offered match the features');
  const rp = await A.frameLocator('.rp-frame').locator('body').textContent();
  ok(rp.includes('Servos arrive late') && rp.includes('2.5h logged'), 'report includes the risk and the hours');
  await A.keyboard.press('Escape'); await sleep(200);

  step('Workload across teams');
  await A.evaluate(() => TT.goHome()); await A.waitForSelector('#home-screen:not([hidden])');
  await A.fill('#create-team-form input[name=name]', 'Thesis'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]'); await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate((m) => { weeksData[0].startDate = m; const c = db.find(x => x.id === TT.me.uid).categories[0]; c[weeksData[0].key] = [{ id: 'th1', type: 'task', name: 'Write chapter 2', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [], effort: 5 }]; saveDatabase(); render(); }, monday());
  await sleep(400);
  await A.evaluate(() => TT.goHome()); await A.waitForSelector('#home-screen:not([hidden])'); await sleep(400);
  ok(await A.locator('#crossteam-btn').isVisible(), 'home shows 👥 Workload when you’re in two teams');
  await A.click('#crossteam-btn'); await A.waitForSelector('.heat-table'); await sleep(300);
  const now = A.locator('.heat-table tr', { hasText: 'Aisha Khan' }).locator('td.heat').nth(1);
  ok((await now.textContent()).startsWith('11h'), 'this week: 6h (Robot Science) + 5h (Thesis) = 11h (got ' + (await now.textContent()) + ')');
  ok((await now.getAttribute('title')).includes('Thesis: 5h'), 'hover shows hours per team');
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/features-crossteam.png` });
  await A.keyboard.press('Escape'); await sleep(200);

  step('Teams made before feature switches keep what they had');
  await A.evaluate(() => { const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const t = Object.values(s.teams).find(x => x.doc.name === 'Thesis'); delete t.doc.features; localStorage.setItem(k, JSON.stringify(s)); });
  await A.reload(); await A.waitForSelector('#home-screen:not([hidden]), .node-cat');
  if (!(await A.locator('#home-screen:not([hidden])').isVisible())) { await A.evaluate(() => TT.goHome()); await A.waitForSelector('#home-screen:not([hidden])'); }
  await A.locator('.team-tile', { hasText: 'Thesis' }).click(); await A.waitForSelector('.node-cat'); await sleep(400);
  await A.click('#research-btn'); await A.waitForSelector('.research-modal');
  ok((await toolTabs(A)).join('|') === '📝 Meetings|🔩 Parts|💷 Finance', 'an older team still has Parts and Finance');

  step('Choosing how a new team starts: Simple or Everything');
  for (const [start, name] of [['simple', 'Tiny Team'], ['full', 'Big Company']]) {
    await A.click('#brand-home, .brand').catch(() => {}); await A.goto(BASE); await A.waitForSelector('#home-screen:not([hidden])');
    await A.selectOption('#create-start', start); await sleep(100);
    const hint = await A.textContent('#create-start-hint');
    ok(start === 'simple' ? /Just the board/.test(hint) : /Every feature on/.test(hint), start + ': the hint explains the choice');
    ok(await A.isChecked('#create-practice'), 'practice tasks are ticked by default');
    if (start === 'full') await A.uncheck('#create-practice');
    await A.fill('#create-team-form input[name=name]', name); await A.click('#create-team-form button[type=submit]');
    await A.waitForSelector('.node-cat'); await sleep(start === 'simple' ? 1400 : 400);
    const practice = Object.values((await teamNamed(A, name)).tasks || {}).map(t => t.name);
    ok(start === 'simple' ? practice.length === 3 && practice.some(n => n.includes('⋮')) && (await A.locator('.task-card').count()) === 3 : practice.length === 0, start + ': practice tasks ' + practice.length);
    if (start === 'simple') {
      const c = A.locator('.task-card').first(); await c.hover(); await c.locator('.card-more').click(); await sleep(300);
      ok(await A.evaluate(() => !!document.querySelector('#quick-menu.active, .radial-menu')), '⋮ opens the quick-actions menu');
      await A.keyboard.press('Escape'); await sleep(200);
    }
    const f = (await teamNamed(A, name)).doc.features;
    ok(Object.entries(f).every(([k, v]) => v === (start === 'full' && k !== 'dissertation')), start + ': features saved (Everything leaves out the Dissertation workspace) ' + JSON.stringify(f));
    await openFeatures(A);
    const on = await A.locator('.feature-card.on:not(.pro-card)').count();
    ok(on === (start === 'simple' ? 0 : 12), start + ': Settings ▸ Features shows ' + on + ' on');
    await A.keyboard.press('Escape'); await sleep(200);
  }
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
