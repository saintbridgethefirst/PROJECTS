// Dissertation or thesis: a new team that starts as "Dissertation or thesis" opens the setup; the plan
// lands on the board (weeks, one row per phase, tasks with checklists, Backlog for a PhD's later work),
// on the timeline (phases), and in 🧰 Tools ▸ 🎓 Dissertation (overview, chapters, proposal helper,
// checklists, supervisor meetings). The supervisor joins with a role that sees and comments, not edits.
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
const tab = async (label) => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message + (process.env.STACK ? '\n' + e.stack : ''))); p.on('dialog', d => d.accept()); return p; };
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tt_demo_store_v1')));
const team = async (p, name) => Object.values((await store(p)).teams).find(t => t.doc.name === name);
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const setDate = async (p, label, v) => { await p.fill(`input[aria-label="${label}"]`, v); await p.dispatchEvent(`input[aria-label="${label}"]`, 'change'); };

try {
  const A = await tab('student');
  await signIn(A, 'Maya Patel', 'maya@uni.ac.uk');

  step('Start with "Dissertation or thesis" opens the setup');
  await A.fill('#create-team-form input[name=name]', 'My dissertation'); await A.selectOption('#create-start', 'dissertation');
  ok((await A.textContent('#create-start-hint')).includes('hand-in date'), 'the start option explains itself');
  await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.modal.diss-setup', { timeout: 15000 }); await sleep(300);
  ok(await A.locator('.diss-card[data-level]').count() === 3, 'undergraduate, master’s and PhD');
  ok(await A.locator('.diss-card[data-kind]').count() === 4, 'four kinds of research');
  let T = await team(A, 'My dissertation');
  ok(T.doc.features.dissertation && T.doc.features.literature && T.doc.features.meetings && !T.doc.features.parts, 'the right tools are on');

  step('Undergraduate, with people: the preview follows the choices');
  await setDate(A, 'Start date', '2026-10-05'); await setDate(A, 'Hand-in date', '2027-04-30'); await sleep(200);
  ok(/30 weeks on the board/.test(await A.textContent('.diss-preview')), 'the preview counts the weeks ' + (await A.textContent('.diss-preview')).slice(0, 60));
  ok(await A.locator('input[aria-label="Ethics approval"]').count() === 1, 'research with people asks for the ethics date');
  await A.click('[data-kind="lab"]'); await sleep(150);
  ok(await A.locator('input[aria-label="Ethics approval"]').count() === 0, 'a build project doesn’t');
  ok(await A.inputValue('input[aria-label="Chapter 3 name"]') === 'Design', 'chapters follow the kind of research (Design for a build project)');
  await A.click('[data-kind="people"]'); await sleep(150);
  await A.fill('input[aria-label="Total word count"]', '12000'); await A.dispatchEvent('input[aria-label="Total word count"]', 'change'); await sleep(150);
  ok(Number(await A.inputValue('input[aria-label="Chapter 2 words"]')) === 3000, 'changing the total scales the chapters');
  await setDate(A, 'Proposal', '2026-11-06');
  await A.fill('input[aria-label="Supervisor’s email"]', 'dr.smith@uni.ac.uk');
  await A.click('.modal.diss-setup button:has-text("Make my plan")');
  await A.waitForSelector('.research-modal .diss-nav', { timeout: 8000 }); await sleep(500);
  ok(await A.locator('.modal.diss-setup').count() === 0, 'setup closes and the Dissertation overview opens');

  step('The plan is on the board, the timeline and the team');
  T = await team(A, 'My dissertation');
  const tasks = Object.values(T.tasks);
  ok(T.doc.weeks.length === 30 && T.doc.weeks[0].startDate === '2026-10-05' && T.doc.weeks[0].title === 'WEEK 1', 'weeks from the start date ' + T.doc.weeks.length);
  ok(T.doc.phases.length === 9 && T.doc.phases.some(p => p.id === 'ph_ethics'), 'nine phases, ethics included');
  ok(Object.values(T.categories).map(c => c.name).includes('Literature review'), 'a row for each phase');
  ok(tasks.length >= 25 && tasks.every(t => t.dueDate && t.phaseId), tasks.length + ' tasks, each with a deadline and a phase');
  const prop = tasks.find(t => t.name === 'Proposal submitted');
  ok(prop && prop.dueDate === '2026-11-06' && prop.priority === 'Critical', 'the proposal milestone on the university’s date');
  ok(tasks.find(t => t.name === 'Write the proposal').subtasks.length === 5, 'tasks come with checklists');
  ok((T.dissertation || {}).plan.level === 'ug' && (T.dissertation || {}).plan.handIn === '2027-04-30' && (T.dissertation || {}).plan.chapters.reduce((s, c) => s + c.target, 0) === 12000, 'the dissertation record is saved');
  ok(T.doc.autos.carry === true, 'carry-over is on, so late tasks follow you into this week');
  ok(T.doc.roles.supervisor && T.doc.roles.supervisor.perms['tasks.editOwn'] && !T.doc.roles.supervisor.perms['team.settings'], 'a Supervisor role that comments but doesn’t change the plan');
  ok(T.invites && T.invites['dr.smith@uni.ac.uk'] && T.invites['dr.smith@uni.ac.uk'].roleId === 'supervisor', 'the supervisor is invited');

  step('Overview: countdown, phases and milestones');
  ok(/days to go/.test(await A.textContent('.diss-hero')) && /Undergraduate/.test(await A.textContent('.diss-level')), 'countdown and level');
  ok(await A.locator('.diss-phase').count() === 9, 'every phase listed');
  ok(/Proposal submitted/.test(await A.textContent('.diss-ms')), 'milestones listed');
  ok(['ok', 'behind', 'late'].includes(await A.getAttribute('.diss-track', 'data-track')), 'an on-track signal from the plan’s dates');
  ok(await A.locator('.diss-hero-act button:has-text("Reminders in my calendar")').count() === 1, 'deadlines into your calendar, with reminders');

  step('Chapters: word counts');
  await A.click('[data-dview="chapters"]'); await sleep(200);
  await A.fill('input[data-ch="ch2"]', '1500'); await A.dispatchEvent('input[data-ch="ch2"]', 'change'); await sleep(500);
  await A.selectOption('select[aria-label="Literature review status"]', 'drafting'); await A.click('.diss-ch-row.head'); await sleep(600);
  T = await team(A, 'My dissertation');
  ok((T.dissertation || {}).plan.chapters[1].words === 1500 && (T.dissertation || {}).plan.chapters[1].status === 'drafting', 'words and status saved');
  ok(/1,500/.test(await A.textContent('.diss-ch-row.total')), 'the total updates');

  step('Proposal helper: hints, not marks, and an outline to copy');
  await A.click('[data-dview="proposal"]'); await sleep(200);
  await A.fill('textarea[data-prop="question"]', 'Is planning useful?'); await A.dispatchEvent('textarea[data-prop="question"]', 'input');
  ok(/○ It can’t be answered with just yes or no/.test(await A.textContent('.diss-prop:has(textarea[data-prop="question"])')), 'a yes/no question gets a hint');
  await A.fill('textarea[data-prop="question"]', 'How do first-year engineering students plan group projects, and what makes their plans slip?');
  await A.dispatchEvent('textarea[data-prop="question"]', 'input'); await A.dispatchEvent('textarea[data-prop="question"]', 'change'); await sleep(400);
  ok(await A.locator('.diss-prop:has(textarea[data-prop="question"]) .diss-checks-live li.ok').count() === 4, 'a good question passes every check');
  await A.fill('textarea[data-prop="topic"]', 'How student teams plan'); await A.dispatchEvent('textarea[data-prop="topic"]', 'change'); await sleep(400);
  await A.click('button:has-text("Show the outline")'); await sleep(200);
  const outline = await A.textContent('.diss-outline');
  ok(outline.startsWith('# How student teams plan') && /## Research question/.test(outline) && /## Timeline[\s\S]*Proposal submitted/.test(outline), 'the outline has the student’s words and the timeline');
  T = await team(A, 'My dissertation');
  ok(/plans slip/.test((T.dissertation || {}).plan.proposal.question), 'the proposal is saved');

  step('Checklists');
  await A.click('[data-dview="checks"]'); await sleep(200);
  ok(await A.locator('input[data-check^="eth_"]').count() === 7 && await A.locator('input[data-check^="sub_"]').count() === 11, 'ethics and hand-in checklists');
  await A.click('input[data-check="sub_backup"]'); await sleep(400);
  ok(((await team(A, 'My dissertation')).dissertation || {}).plan.checks.sub_backup === true, 'a tick is saved');

  step('Supervisor meetings use the template');
  await A.click('[data-dview="supervisor"]'); await sleep(200);
  await A.click('#diss-new-meeting'); await sleep(600);
  const mt = Object.values((await team(A, 'My dissertation')).meetings || {})[0];
  ok(mt && mt.title === 'Supervisor meeting' && /Questions for my supervisor/.test(mt.notes), 'a supervisor meeting with the template');
  ok(await A.locator('.rs-tab.on[data-tab="meetings"]').count() === 1, 'and it opens in Meetings');
  await A.keyboard.press('Escape'); await sleep(300);

  step('The supervisor sees it, read-only');
  const B = await tab('supervisor');
  await signIn(B, 'Dr Sam Smith', 'dr.smith@uni.ac.uk');
  await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat'); await sleep(600);
  await B.evaluate(() => TT.openResearch('dissertation')); await B.waitForSelector('.research-modal .diss-nav'); await sleep(300);
  ok(/days to go/.test(await B.textContent('.diss-hero')), 'the supervisor sees the overview');
  ok(await B.locator('button:has-text("Change the plan")').count() === 0, 'but can’t change the plan');
  await B.click('[data-dview="chapters"]'); await sleep(200);
  ok(await B.locator('input[data-ch="ch2"]').isDisabled(), 'or the word counts');
  ok(await B.locator('[data-send]').count() === 0, 'or send drafts');
  await B.keyboard.press('Escape'); await sleep(200);

  step('Send a chapter draft for feedback: a review task for the supervisor');
  await A.bringToFront();
  await A.evaluate(() => TT.openResearch('dissertation')); await A.waitForSelector('.diss-nav'); await sleep(200);
  await A.click('[data-dview="chapters"]'); await sleep(300);
  await A.click('[data-send="ch2"]'); await A.waitForSelector('#diss-send');
  ok(/Dr Sam Smith/.test(await A.textContent('.modal:has(#diss-send)')), 'it goes to the supervisor');
  await A.fill('input[aria-label="Link to the draft"]', 'not a link'); await A.click('#diss-send'); await sleep(300);
  ok(await A.locator('#diss-send').count() === 1, 'a bad link is caught');
  await A.fill('input[aria-label="Link to the draft"]', 'https://1drv.ms/w/s!lit-review-draft');
  await A.fill('textarea[aria-label="Note to your supervisor"]', 'Mostly the structure, please.');
  await A.click('#diss-send'); await sleep(1000);
  T = await team(A, 'My dissertation');
  const supUid = Object.entries(T.members).find(([, m]) => m.email === 'dr.smith@uni.ac.uk')[0];
  const meUid = Object.entries(T.members).find(([, m]) => m.email === 'maya@uni.ac.uk')[0];
  const [reviewId, review] = Object.entries(T.tasks).find(([, t]) => t.name === 'Review: Literature review, draft 1') || [];
  ok(review && review.ownerUid === supUid && review.supportPersonId === meUid && review.subtasks.length === 3, 'a review task in the supervisor’s row, with the student supporting');
  ok(review && review.attachments[0] && /1drv\.ms/.test(review.attachments[0].url), 'with the draft attached');
  const ch2 = (T.dissertation || {}).plan.chapters[1];
  ok(ch2.status === 'supervisor' && ch2.drafts.length === 1 && ch2.drafts[0].taskId === reviewId, 'the chapter is with the supervisor, and the draft is listed');
  ok(Object.values(T.comments || {}).some(c => c.taskId === reviewId && /structure/.test(c.text) && c.mentions.includes(supUid)), 'the note is a comment that mentions the supervisor');
  ok(await A.locator('.diss-draft[data-state="waiting"]').count() === 1 && await A.locator('.diss-draft [data-decide]').count() === 0, 'waiting for feedback; only the supervisor decides');

  step('The supervisor asks for changes');
  await B.bringToFront();
  await B.evaluate(() => TT.openResearch('dissertation')); await B.waitForSelector('.diss-nav'); await sleep(200);
  await B.click('[data-dview="chapters"]'); await sleep(300);
  await B.click('.diss-draft [data-decide="changes"]'); await B.waitForSelector('#diss-decide-go');
  await B.click('#diss-decide-go'); await sleep(300);
  ok(await B.locator('#diss-decide-go').count() === 1, 'asking for changes needs feedback');
  await B.fill('textarea[aria-label="Feedback"]', 'Group the studies by method.');
  await B.click('#diss-decide-go'); await sleep(1000);
  T = await team(B, 'My dissertation');
  const rv = T.tasks[reviewId] || {};
  ok(rv.status === 'Changes needed' && rv.flag === 'completed', 'the review task is done, with the decision');
  ok(Object.values(T.comments || {}).some(c => c.taskId === reviewId && /^✏️ Changes needed\. Group the studies/.test(c.text) && c.mentions.includes(meUid)), 'the feedback is a comment that mentions the student');
  await B.close();
  await A.bringToFront();
  await A.evaluate(() => TT.openResearch('dissertation')); await A.waitForSelector('.diss-nav'); await sleep(200);
  await A.click('[data-dview="chapters"]'); await sleep(300);
  ok(await A.locator('.diss-draft[data-state="changes"]').count() === 1, 'the student sees “Changes asked”');
  await A.keyboard.press('Escape'); await sleep(200);

  step('Change the plan later: word counts are kept');
  await A.bringToFront();
  await A.evaluate(() => TT.openResearch('dissertation')); await A.waitForSelector('.diss-hero'); await sleep(200);
  await A.click('button:has-text("Change the plan")'); await A.waitForSelector('.modal.diss-setup'); await sleep(200);
  ok(await A.locator('.modal.diss-setup h3').textContent() === 'Change your dissertation plan', 'the setup opens with the saved choices');
  ok(await A.inputValue('input[aria-label="Hand-in date"]') === '2027-04-30', 'saved hand-in date');
  await setDate(A, 'Hand-in date', '2027-05-14');
  await A.click('.modal.diss-setup button:has-text("Update my plan")'); await sleep(1200);
  T = await team(A, 'My dissertation');
  ok((T.dissertation || {}).plan.handIn === '2027-05-14' && (T.dissertation || {}).plan.chapters[1].words === 1500, 'new date, word counts kept');

  step('PhD: the first term on the board, the rest in the Backlog');
  while (await A.locator('.modal-overlay').count()) { await A.keyboard.press('Escape'); await sleep(200); }
  await A.evaluate(() => TT.goHome()); await A.waitForSelector('#home-screen:not([hidden])');
  await A.fill('#create-team-form input[name=name]', 'My PhD'); await A.selectOption('#create-start', 'dissertation');
  await A.click('#create-team-form button[type=submit]'); await A.waitForSelector('.modal.diss-setup', { timeout: 15000 }); await sleep(300);
  await A.click('[data-level="phd"]'); await sleep(150);
  ok(await A.locator('input[aria-label="Upgrade / confirmation review"]').count() === 1 && await A.locator('input[aria-label="Viva"]').count() === 1, 'PhD dates: upgrade and viva');
  await setDate(A, 'Start date', '2026-10-05'); await setDate(A, 'Hand-in date', '2030-03-29');
  await A.click('.modal.diss-setup button:has-text("Make my plan")'); await A.waitForSelector('.research-modal .diss-nav', { timeout: 8000 }); await sleep(400);
  T = await team(A, 'My PhD');
  ok(T.doc.weeks[0].key === 'backlog' && T.doc.weeks.length === 14, 'Backlog plus 13 weeks');
  ok(T.doc.autos.carryMakeWeeks === true, 'new weeks are added as time goes on');
  const names = Object.values(T.tasks).map(t => t.name);
  ['Upgrade / confirmation review', 'Submit your thesis', 'Viva', 'Annual progress review (year 2)'].forEach(n => ok(names.includes(n), 'PhD milestone: ' + n));
  ok((T.dissertation || {}).plan.chapters.reduce((s, c) => s + c.target, 0) === 80000, '80,000 words across the chapters');

  step('trawpie.org/dissertation ▸ "Try it without signing up" goes straight to the setup');
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const D = await ctx2.newPage(); D.on('pageerror', e => errors.push('demo: ' + e.message));
  await D.goto(BASE + 'demo?plan=dissertation'); await D.waitForSelector('#demo-diss');
  ok(await D.locator('#demo-diss.primary').count() === 1, 'Plan a dissertation is the main button');
  await D.click('#demo-diss'); await D.waitForSelector('.modal.diss-setup', { timeout: 15000 });
  ok(Object.values((await store(D)).teams).some(t => t.doc.name === 'My dissertation' && t.doc.features.dissertation), 'the setup opens in a new dissertation workspace');
  await ctx2.close();

  step('The Gantt chart template page: a live chart from your dates, the download, and a plan with the same dates');
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const G = await ctx3.newPage(); G.on('pageerror', e => errors.push('template: ' + e.message));
  await G.goto(BASE + 'templates/dissertation-gantt-chart.html'); await G.waitForSelector('#g-chart .tr');
  ok(await G.locator('#g-chart .tr').count() === 13 && await G.locator('#g-chart .dia').count() === 4, 'undergraduate: 9 phases and 4 milestones');
  const xlsx = await G.evaluate(async () => { const r = await fetch('/templates/dissertation-gantt-chart.xlsx'); return { ok: r.ok, size: (await r.arrayBuffer()).byteLength }; });
  ok(xlsx.ok && xlsx.size > 20000, 'the spreadsheet downloads');
  await G.click('.seg button[data-level="phd"]'); await sleep(100);
  await G.fill('#g-start', '2026-10-05'); await G.dispatchEvent('#g-start', 'change');
  await G.fill('#g-end', '2030-03-29'); await G.dispatchEvent('#g-end', 'change'); await sleep(100);
  ok(await G.locator('#g-chart .tr').count() === 18 && /Thesis submission/.test(await G.textContent('#g-end-l')), 'PhD: its own phases and milestones');
  ok(/^\/demo\?plan=dissertation&level=phd&start=2026-10-05&handin=2030-03-29$/.test(await G.getAttribute('#g-make', 'href')), 'the button carries the level and dates');
  await G.fill('#g-end', '2026-09-01'); await G.dispatchEvent('#g-end', 'change'); await sleep(100);
  ok(/after your start date/.test(await G.textContent('#g-sum')), 'a hand-in before the start is caught');
  await G.goto(BASE + 'demo?plan=dissertation&level=phd&start=2026-10-05&handin=2030-03-29'); await G.waitForSelector('#demo-diss');
  await G.click('#demo-diss'); await G.waitForSelector('.modal.diss-setup', { timeout: 15000 }); await sleep(300);
  ok(await G.locator('.diss-card[data-level="phd"].on').count() === 1, 'the setup starts as a PhD');
  ok(await G.inputValue('input[aria-label="Start date"]') === '2026-10-05' && await G.inputValue('input[aria-label="Hand-in date"]') === '2030-03-29', 'with the same dates');
  await ctx3.close();
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
