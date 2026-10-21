// Sign-offs and checklists (workflow step 2), with three people in three tabs:
// Tom (member) sends his task for sign-off, Lea (his sub-team lead, who can't otherwise edit it)
// asks for changes and then approves, Aisha (owner) signs off the last gate. Plus the settings.
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
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
async function openTeam(p) { await p.locator('.team-tile').first().click(); await p.waitForSelector('.task-card'); await sleep(400); }
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tt_demo_store_v1')));
const teamOf = async (p) => Object.values((await store(p)).teams)[0];
const task = async (p, name) => { const t = await teamOf(p); const e = Object.entries(t.tasks).find(([, x]) => x.name === name); return e ? { ...e[1], id: e[0] } : null; };
const card = (p, name) => p.locator('.task-card', { hasText: name }).first();
async function openCard(p, name) { await card(p, name).evaluate(e => e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })); await card(p, name).click(); await sleep(300); }
const lastToast = (p) => p.locator('.toast').last().textContent();

try {
  step('A team: Review needs the sub-team lead’s sign-off, Test an admin’s');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Sign Lab'); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(() => {
    const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const T = Object.values(s.teams)[0]; const wk = T.doc.weeks[0].key;
    const user = (uid, name, email) => { s.users[uid] = { uid, email, name, photo: '', emailVerified: true, provider: 'demo' }; T.members[uid] = { uid, email, name, photo: '', roleId: 'member', joinedAt: 1 }; };
    user('u_tom', 'Tom Reed', 'tom@x.com'); user('u_lea', 'Lea Moss', 'lea@x.com');
    T.categories.c_tom = { name: 'Landing gear', ownerUid: 'u_tom', order: 5 }; T.categories.c_lea = { name: 'Software', ownerUid: 'u_lea', order: 6 };
    T.doc.subteams = [{ id: 'gear', name: 'Landing gear', color: '#3ba3ff', members: ['u_tom', 'u_lea'], leads: ['u_lea'] }];
    T.doc.features = { ...(T.doc.features || {}), subteams: true };
    T.doc.workflow = { moved: {}, stages: [
      { id: 'design', name: 'Design', kind: 'todo', color: '#63b3ed', limit: 0, signoff: '', signer: '', checklist: [] },
      { id: 'review', name: 'Review', kind: 'doing', color: '#f6ad55', limit: 0, signoff: 'lead', signer: '', checklist: [{ id: 'review_c0', text: 'CAD shared' }, { id: 'review_c1', text: 'Mass budget updated' }] },
      { id: 'build', name: 'Build', kind: 'doing', color: '#b794f4', limit: 0, signoff: '', signer: '', checklist: [] },
      { id: 'test', name: 'Test', kind: 'doing', color: '#4fd1c5', limit: 0, signoff: 'admin', signer: '', checklist: [{ id: 'test_c0', text: 'Risk assessment done' }] },
      { id: 'done', name: 'Done', kind: 'done', color: '#68d391', limit: 0, signoff: '', signer: '', checklist: [] }] };
    const mk = (name, owner, cat, over) => ({ name, priority: 'Major', status: '', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none', dueDate: '', completedDate: '', subtasks: [], history: [], custom: {}, icon: '', attachments: [],
      categoryId: cat, ownerUid: owner, weekId: wk, order: 0, createdBy: owner, createdAt: 1, updatedBy: owner, updatedAt: 1, stage: 'design', ...over });
    T.tasks.t_leg = mk('Leg v2 retract', 'u_tom', 'c_tom', {}); T.tasks.t_hub = mk('Wheel hub', 'u_tom', 'c_tom', { stage: 'design' });
    localStorage.setItem(k, JSON.stringify(s));
  });
  await A.reload(); await A.waitForSelector('.task-card'); await sleep(400);
  ok(await A.locator('#approvals-btn').isVisible(), 'the Sign-offs button appears once a stage needs one');
  await sleep(300);
  const idx = (await teamOf(A)).doc;
  ok(JSON.stringify(idx.workflow.next) === '[1,1,3,3,5,5]' && idx.workflow.gates.review.k === 'lead' && JSON.stringify(idx.leads) === '{"u_tom":["u_lea"]}', 'the owner’s first load stores the index the security rules use');

  step('Tom: into Review is fine; past it is not');
  const T = await tab('Tom'); await signIn(T, 'Tom Reed', 'tom@x.com'); await openTeam(T);
  await openCard(T, 'Leg v2 retract');
  await T.click('#edit-form .stage-toggle button[data-stage="review"]'); await sleep(400);
  ok((await task(T, 'Leg v2 retract')).stage === 'review', 'moved into Review');
  ok((await T.textContent('#so-status')).includes('needs a sign-off from Lea Moss (Landing gear lead)'), 'the task says who signs it off');
  ok(await T.locator('#so-approve').count() === 0, 'Tom can’t approve his own task');
  await T.click('#edit-form .stage-toggle button[data-stage="build"]'); await sleep(400);
  ok((await task(T, 'Leg v2 retract')).stage === 'review' && (await lastToast(T)).includes('needs a sign-off from Lea'), 'moving it on to Build is stopped, with the reason');
  // Even a direct change through the board model is caught by the save check
  await T.evaluate(() => { const t = db.flatMap(p => p.categories).flatMap(c => Object.values(c).filter(Array.isArray).flat()).find(x => x.name === 'Leg v2 retract'); t.flag = 'completed'; saveDatabase(); });
  await sleep(400);
  ok((await task(T, 'Leg v2 retract')).flag === 'none', 'ticking it done some other way is refused too');

  step('Tom: checklist and sending for sign-off');
  await openCard(T, 'Leg v2 retract');
  await T.locator('#edit-form .so-check input').first().check(); await sleep(300);
  ok(JSON.stringify((await task(T, 'Leg v2 retract')).checks) === '{"review_c0":true}', 'ticked “CAD shared”');
  ok((await card(T, 'Leg v2 retract').locator('.so-cl').textContent()) === '☑ 1/2', 'the card shows the checklist 1/2');
  await T.click('#so-send'); await sleep(400);
  let t = await task(T, 'Leg v2 retract');
  ok(t.signoff && t.signoff.status === 'waiting' && t.signoff.by === 'u_tom' && t.signoff.stage === 'review', 'sent for sign-off');
  ok((await card(T, 'Leg v2 retract').locator('.so-wait').textContent()).includes('Waiting for Lea'), 'card: ⏳ Waiting for Lea');
  await T.click('#share-btn'); await T.waitForSelector('#share-text');
  ok((await T.inputValue('#share-text')).includes('Waiting for sign-off') && (await T.inputValue('#share-text')).includes('Lea Moss'), 'the weekly share lists it');
  await T.keyboard.press('Escape'); await sleep(150);

  step('Lea (the lead): asks for changes, then approves');
  const L = await tab('Lea'); await signIn(L, 'Lea Moss', 'lea@x.com'); await openTeam(L);
  ok((await L.textContent('#approvals-badge')) === '1', 'Sign-offs shows 1 waiting for her');
  await L.click('#approvals-btn'); await L.waitForSelector('#approvals-modal .so-card');
  ok((await L.locator('#approvals-modal .so-card').textContent()).includes('✗ Mass budget updated'), 'she sees what isn’t ticked');
  await L.click('#approvals-modal .so-changes'); await sleep(300);
  ok((await task(L, 'Leg v2 retract')).signoff.status === 'waiting', 'asking for changes needs a note');
  await L.fill('#approvals-modal .so-note', 'Add the mass budget, please'); await L.click('#approvals-modal .so-changes'); await sleep(400);
  t = await task(L, 'Leg v2 retract');
  ok(t.signoff.status === 'changes' && t.signoff.approver === 'u_lea' && t.signoff.note === 'Add the mass budget, please', 'changes requested, with her note');
  ok(t.history.some(h => h.field === 'Sign-off' && h.updated.includes('Changes requested by Lea Moss')), 'in the task’s history');
  await L.keyboard.press('Escape'); await sleep(150);
  await T.reload(); await T.waitForSelector('.task-card'); await sleep(300);
  ok((await card(T, 'Leg v2 retract').locator('.so-changes').count()) === 1, 'Tom’s card: ✋ Changes asked');
  await openCard(T, 'Leg v2 retract');
  ok((await T.textContent('#so-status')).includes('Lea Moss asked for changes: “Add the mass budget, please”'), 'Tom reads her note');
  await T.locator('#edit-form .so-check input').nth(1).check(); await sleep(250);
  await T.click('#so-send'); await sleep(400);
  ok((await task(T, 'Leg v2 retract')).signoff.status === 'waiting', 'sent again');
  await L.reload(); await L.waitForSelector('.task-card'); await sleep(300);
  await openCard(L, 'Leg v2 retract');
  ok(await L.locator('#edit-form .read-only-note').count() === 1 && await L.locator('#so-approve').isEnabled(), 'Lea can’t edit Tom’s task, but can approve it');
  await L.fill('#so-note', 'Looks good'); await L.click('#so-approve'); await sleep(500);
  t = await task(L, 'Leg v2 retract');
  ok(t.stage === 'build' && t.signoff.status === 'approved' && t.signoff.approver === 'u_lea' && t.signoff.note === 'Looks good', 'approved: moved on to Build');
  ok((await L.textContent('#approvals-badge').catch(() => '')) === '' || await L.locator('#approvals-badge').isHidden(), 'nothing left waiting for her');

  step('The last gate: an admin signs off Test');
  await T.reload(); await T.waitForSelector('.task-card'); await sleep(300); await openCard(T, 'Leg v2 retract');
  await T.click('#edit-form .stage-toggle button[data-stage="test"]'); await sleep(400);
  ok((await task(T, 'Leg v2 retract')).stage === 'test', 'Tom moves it on to Test (Review is signed off)');
  await T.click('#edit-form .stage-toggle button[data-stage="done"]'); await sleep(400);
  ok((await task(T, 'Leg v2 retract')).flag === 'none' && (await lastToast(T)).includes('needs a sign-off from'), 'but can’t finish it without the admin');
  await A.reload(); await A.waitForSelector('.task-card'); await sleep(300); await openCard(A, 'Leg v2 retract');
  await A.click('#edit-form .stage-toggle button[data-stage="done"]'); await sleep(400);
  t = await task(A, 'Leg v2 retract');
  ok(t.flag === 'completed' && t.signoff.stage === 'test' && t.signoff.status === 'approved' && t.signoff.approver === (await A.evaluate(() => TT.me.uid)), 'Aisha (owner) moves it to Done: that counts as her sign-off');

  step('Settings: who signs off, and checklists');
  await A.evaluate(() => TT.openSettings('workflow')); await A.waitForSelector('.wf-list');
  const row = A.locator('.wf-list .wf-stage[data-stage="design"]');
  await row.locator('.wf-signoff').selectOption('person'); await sleep(200);
  await A.locator('.wf-list .wf-stage[data-stage="design"] .wf-signer').selectOption('u_lea');
  await A.locator('.wf-list .wf-stage[data-stage="design"] .wf-cl summary').click();
  await A.fill('.wf-list .wf-stage[data-stage="design"] .wf-cl-text', 'Sketch done\nSizes checked\n\n');
  await A.click('#wf-save'); await sleep(500);
  const st = (await teamOf(A)).doc.workflow.stages[0];
  ok(st.signoff === 'person' && st.signer === 'u_lea' && st.checklist.map(c => c.text).join('|') === 'Sketch done|Sizes checked', 'Design: signed off by Lea, with a 2-item checklist');
  await A.keyboard.press('Escape');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 8).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
