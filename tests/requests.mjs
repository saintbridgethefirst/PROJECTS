// Leaving the team and deleting tasks need approval; GitHub state on cards (live, with a close
// menu); search by reference; chips that wrap; the circle menu fitting its labels.
// Aisha (owner), Tom (member), Priya (admin). Needs the preview server: npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const team = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const openTeam = async (p) => { await p.locator('.team-tile').first().click(); await p.waitForSelector('.task-card'); await sleep(400); };
const card = (p, name) => p.locator('.task-card', { has: p.locator('.card-title', { hasText: name }) }).first();
const closeModals = (p) => p.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(m => m.remove()));

try {
  step('A team: Tom (member) has an old task, a new one, a finished one and a GitHub-linked one');
  const A = await tab('Aisha'); await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Rover Lab'); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(() => {
    const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const T = Object.values(s.teams)[0]; const wk = T.doc.weeks[0].key;
    for (const [uid, name, email, roleId] of [['u_tom', 'Tom Reed', 'tom@x.com', 'member'], ['u_pri', 'Priya Shah', 'priya@x.com', 'admin']]) {
      s.users[uid] = { uid, email, name, photo: '', emailVerified: true, provider: 'demo' };
      T.members[uid] = { uid, email, name, photo: '', roleId, joinedAt: 1 };
    }
    T.categories.c_tom = { name: 'Chassis', ownerUid: 'u_tom', order: 5 };
    const task = (name, over) => ({ name, priority: 'Major', status: '', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none', dueDate: '', completedDate: '', subtasks: [], history: [], custom: {}, icon: '', attachments: [], categoryId: 'c_tom', ownerUid: 'u_tom', weekId: wk, order: 0, createdBy: 'u_tom', createdAt: 1, updatedBy: 'Tom', updatedAt: 1, ...over });
    T.tasks.t_old = task('Old bracket task');
    T.tasks.t_new = task('Typo task', { order: 1, createdAt: Date.now() - 60000 });
    T.tasks.t_done = task('Weld the frame', { order: 2, flag: 'completed', completedDate: '2026-10-01' });
    T.tasks.t_gh = task('Telemetry link', { order: 3, attachments: [{ id: 'gh_issues_14', provider: 'github', name: 'Issue #14: Packets drop', url: 'https://github.com/uni/rover/issues/14', size: 0, addedBy: 'GitHub', addedAt: 1, state: 'open', reason: '' }],
      status: 'A long status that should wrap neatly inside the card rather than run off its edge' });
    const owner = Object.keys(T.members).find(u => T.members[u].roleId === 'owner');
    T.doc.github = { repo: 'uni/rover', issues: true, done: true, owner, connectedAt: 1, write: true, last: null };
    T.private = { github: { secret: 's', repo: 'uni/rover', by: owner, at: 1, last: null, token: 'ghp_demo0000000000000000000000' } };
    localStorage.setItem(k, JSON.stringify(s));
  });
  await A.reload(); await A.waitForSelector('.task-card'); await sleep(500);

  step('GitHub: the chip sits right under the task name, with a glyph instead of the octopus');
  const gh = card(A, 'Telemetry link');
  const placed = await gh.evaluate(c => { const t = c.querySelector('.card-title'); const r = t && t.nextElementSibling; return r && r.classList.contains('gh-under-title') ? r.textContent : ''; });
  ok(placed.includes('#14') && placed.includes('Open'), 'chip right after the title (' + placed + ')');
  ok(await gh.locator('.gh-chips svg.gh-mark').count() === 1 && !placed.includes('🐙'), 'GitHub glyph, no octopus');
  const right = await gh.evaluate(c => getComputedStyle(c.querySelector('.gh-under-title')).justifyContent);
  ok(right === 'flex-end', 'aligned to the right');

  step('Close it from the card: the chip menu offers the GitHub closing reasons');
  await gh.locator('.gh-chip').click(); await sleep(250);
  const menu = await A.evaluate(() => [...document.querySelectorAll('#quick-menu .qm-btn, #quick-menu button')].map(b => b.textContent.trim()).join('|'));
  ok(/Close as completed/.test(menu) && /Close as not planned/.test(menu) && /Close as duplicate/.test(menu) && /Open on GitHub/.test(menu), 'menu: ' + menu);
  await A.locator('#quick-menu button', { hasText: 'Close as not planned' }).click(); await A.waitForSelector('#gh-close');
  ok(await A.locator('#gh-close input[value=not_planned]').isChecked(), 'the chosen reason is preselected');
  await A.click('#gh-close-save'); await sleep(700);
  let chip = await card(A, 'Telemetry link').locator('.gh-chip').textContent();
  ok(/Closed/.test(chip) && /not planned/.test(chip), 'the card updates by itself: ' + chip);
  let T = await team(A);
  ok(T.tasks.t_gh.attachments[0].state === 'closed' && T.tasks.t_gh.attachments[0].reason === 'not_planned', 'state saved on the link');
  ok(T.tasks.t_gh.history[0].field === 'GitHub' && /Closed issue #14/.test(T.tasks.t_gh.history[0].updated), 'logged in the task history');
  await card(A, 'Telemetry link').locator('.gh-chip').click(); await sleep(200);
  ok(await A.locator('#quick-menu button', { hasText: 'Reopen issue' }).count() === 1, 'a closed issue offers Reopen');
  await A.locator('#quick-menu button', { hasText: 'Reopen issue' }).click(); await sleep(600);
  chip = await card(A, 'Telemetry link').locator('.gh-chip').textContent(); ok(/Open/.test(chip), 'reopened: ' + chip);

  step('Marking the task done offers to close its open issue');
  await A.evaluate(() => { const l = allTaskLocs().find(x => x.task.name === 'Telemetry link'); l.task.flag = 'completed'; l.task.completedDate = new Date().toLocaleDateString('en-CA'); saveDatabase(); render(); });
  await A.waitForSelector('#gh-done-close', { timeout: 5000 });
  ok((await A.textContent('#gh-done-close')).includes('#14'), 'asks about #14');
  await A.click('#gh-done-go'); await sleep(700);
  T = await team(A); ok(T.tasks.t_gh.flag === 'completed' && T.tasks.t_gh.attachments[0].state === 'closed', 'task done and issue closed');
  ok(/Closed/.test(await card(A, 'Telemetry link').locator('.gh-chip').textContent()), 'card shows Closed');
  await A.evaluate(() => { const l = allTaskLocs().find(x => x.task.name === 'Telemetry link'); l.task.flag = 'none'; l.task.completedDate = ''; saveDatabase(); render(); }); await sleep(400);
  ok(await A.locator('#gh-done-close').count() === 0, 'reopening the task doesn’t ask');
  step('Create an issue with a title and details');
  await card(A, 'Weld the frame').click({ button: 'right' }); await sleep(200);
  await A.locator('#quick-menu button', { hasText: 'GitHub' }).first().hover(); await sleep(200);
  await A.locator('#quick-submenu button', { hasText: 'Create GitHub issue' }).click(); await A.waitForSelector('#gh-new');
  ok(await A.inputValue('#gh-new-title') === 'Weld the frame', 'title starts as the task name');
  await A.fill('#gh-new-body', 'The frame welds crack under load.\n\nSteps: drop test from 30 cm.'); await A.click('#gh-new-save'); await sleep(700);
  T = await team(A); const made = (T.tasks.t_done.attachments || []).find(a => a.provider === 'github');
  ok(made && made.state === 'open', 'issue created and linked, open');
  ok(T.tasks.t_done.history.some(h => h.field === 'GitHub' && /Created issue/.test(h.updated)), 'creation logged');
  await A.evaluate(() => TT.openActivity && TT.openActivity('activity')); await sleep(300);
  const feed = await A.evaluate(() => document.querySelector('.act-pane') ? document.querySelector('.act-pane').textContent : '');
  if (feed) ok(/GitHub: created issue/i.test(feed), 'team activity reads “GitHub: created issue…”: ' + feed.slice(0, 300));
  await closeModals(A);

  step('Search finds a card by its automatic reference');
  const ref = await A.evaluate(() => TT.taskRef({ id: 't_old' }));
  await A.fill('#search-tasks', ref.toLowerCase()); await sleep(400);
  ok(!(await card(A, 'Old bracket task').evaluate(c => c.classList.contains('hidden-by-search'))), 'found by ' + ref);
  ok(await card(A, 'Weld the frame').evaluate(c => c.classList.contains('hidden-by-search')), 'others hidden');
  await A.fill('#search-tasks', '#14'); await sleep(400);
  ok(!(await card(A, 'Telemetry link').evaluate(c => c.classList.contains('hidden-by-search'))), 'found by its GitHub issue number');
  await A.fill('#search-tasks', ''); await sleep(300);

  step('Long chips wrap inside the card');
  const spill = await A.evaluate(() => [...document.querySelectorAll('.task-card')].filter(c => c.offsetParent).some(c => { const r = c.getBoundingClientRect(); return [...c.querySelectorAll('.so-chip, .effort-chip, .stage-bar, .gh-chip, .card-status')].some(x => x.getBoundingClientRect().right > r.right + 1); }));
  ok(!spill, 'nothing runs past a card edge');

  step('Tom (member): no Members or Roles settings, and leaving asks for approval');
  const B = await tab('Tom'); await signIn(B, 'Tom Reed', 'tom@x.com'); await openTeam(B);
  await B.evaluate(() => TT.openSettings('members')); await B.waitForSelector('.settings-nav'); await sleep(200);
  const tabs = await B.evaluate(() => [...document.querySelectorAll('.settings-nav button')].map(b => b.textContent));
  ok(!tabs.includes('Members') && !tabs.includes('Roles & permissions'), 'tabs: ' + tabs.join(', '));
  ok(await B.locator('.settings-nav button.on').textContent() === 'General', 'asking for Members opens General');
  await B.click('#leave-team'); await B.waitForSelector('#leave-ask');
  await B.fill('#leave-note', 'Joining the rocketry team.'); await B.click('#leave-send'); await sleep(500);
  T = await team(B); ok(T.members.u_tom && T.requests && T.requests['leave-u_tom'], 'still a member, with a request waiting');
  await B.waitForSelector('#leave-pending'); ok(true, 'pending banner');
  await closeModals(B);

  step('Tom deletes a task he made a minute ago, but must ask to delete an older one');
  await card(B, 'Typo task').click({ button: 'right' }); await sleep(200);
  await B.locator('#quick-menu button', { hasText: 'Delete task' }).click(); await sleep(600);
  T = await team(B); ok(!T.tasks.t_new, 'new task deleted straight away');
  await card(B, 'Old bracket task').click({ button: 'right' }); await sleep(200);
  await B.locator('#quick-menu button', { hasText: 'Delete task' }).click(); await B.waitForSelector('#del-ask');
  await B.fill('#del-note', 'Duplicate'); await B.click('#del-send'); await sleep(500);
  T = await team(B); ok(T.tasks.t_old && T.requests['del-t_old'] && T.requests['del-t_old'].note === 'Duplicate', 'old task kept, request sent');

  step('Aisha approves both in Approvals');
  await sleep(600);
  ok(await A.locator('#approvals-btn').isVisible(), 'Approvals button shows');
  ok((await A.locator('#approvals-badge').textContent()) === '2', 'badge counts both');
  await A.click('#approvals-btn'); await A.waitForSelector('#approvals-modal');
  ok(await A.locator('.rq-card').count() === 2, 'two request cards');
  await A.locator('.rq-card[data-request="del-t_old"] .rq-approve').click(); await sleep(600);
  T = await team(A); ok(!T.tasks.t_old && !T.requests['del-t_old'], 'task deleted, request cleared');
  await A.locator('.rq-card[data-request="leave-u_tom"] .rq-approve').click(); await A.waitForSelector('#leave-approve');
  const opts = await A.evaluate(() => [...document.querySelectorAll('#leave-approve select')[0].options].map(o => o.textContent));
  ok(opts.includes('Priya Shah') && !opts.includes('Tom Reed'), 'hand over to: ' + opts.join(', '));
  await A.selectOption('#leave-approve select >> nth=0', { label: 'Priya Shah' }); await sleep(100);
  await A.click('#leave-approve-go'); await sleep(900);
  T = await team(A);
  ok(!T.members.u_tom, 'Tom removed');
  ok(T.tasks.t_gh.ownerUid === 'u_pri' && T.categories[T.tasks.t_gh.categoryId].ownerUid === 'u_pri', 'his open task went to Priya, in a row of hers');
  ok(T.tasks.t_gh.history[0].field === 'Owner' && T.tasks.t_gh.history[0].original === 'Tom Reed', 'hand-over logged');
  ok(T.tasks.t_done.ownerUid === 'u_tom', 'finished work stays his');
  ok(T.doc.former && T.doc.former.u_tom && T.doc.former.u_tom.name === 'Tom Reed', 'his name is remembered');
  await closeModals(A); await sleep(400);
  ok(await A.locator('.node-person', { hasText: 'Tom Reed (left)' }).count() >= 1 || await A.getByText('Tom Reed (left)').count() >= 1, 'his row reads “Tom Reed (left)”');

  step('The circle menu: at most ten wedges, labels that fit');
  await A.evaluate(() => localStorage.setItem('tt_menu_style', 'circle'));
  await card(A, 'Telemetry link').click({ button: 'right' }); await A.waitForSelector('#radial-menu'); await sleep(300);
  const ring = await A.evaluate(() => [...document.querySelectorAll('#radial-menu .rm-ring .rm-seg')].map(g => g.querySelector('.rm-label').textContent));
  ok(ring.length <= 10 && ring.length >= 6, ring.length + ' wedges: ' + ring.join(' | '));
  ok(!ring.some(l => l.includes('…')), 'no cut-off labels: ' + ring.join(' | '));
  ok(ring.includes('More'), 'the rest under More');
  await A.keyboard.press('Escape');
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
