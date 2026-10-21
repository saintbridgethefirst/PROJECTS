// Workflow (custom stages) in demo mode: set up from a template, cards, Kanban, editor, limits, changing stages later.
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
async function dialog(p, value) { await p.waitForSelector('#dialog-overlay input'); await p.fill('#dialog-overlay input', value); await p.click('#dialog-overlay .dlg-ok'); await sleep(200); }
const team = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const taskNamed = async (p, n) => Object.values((await team(p)).tasks).find(t => t.name === n);
const card = (p, n) => p.locator('.task-card', { hasText: n }).first();

try {
  step('A team with the classic stages is unchanged');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Drone Soc'); await A.click('#create-team-form button[type=submit]'); await A.waitForSelector('.node-cat'); await sleep(300);
  for (const n of ['Landing gear v2', 'Payload mount', 'Wiring loom']) { await A.click('.col-add'); await dialog(A, n); }
  await A.evaluate(() => { const l = allTaskLocs().find(x => x.task.name === 'Wiring loom'); setTaskStage(l.task, 'doing'); });
  ok(!(await A.locator('.stage-bar').count()) && (await card(A, 'Wiring loom').textContent()).includes('Doing'), 'no stage bars; the old “Doing” chip');

  step('Settings ▸ Workflow: pick the Engineering template');
  await A.evaluate(() => TT.openSettings('workflow')); await A.waitForSelector('.wf-list');
  ok((await A.locator('.wf-list .wf-stage[data-stage]').count()) === 3, 'starts with To do / Doing / Done');
  await A.click('.wf-templates button[data-template="engineering"]'); await sleep(150);
  ok((await A.locator('.wf-list .wf-stage[data-stage]').count()) === 5, 'Design · Review · Build · Test · Done');
  ok((await A.locator('#wf-note').textContent()).includes('will move to “Review”'), 'says where the Doing task goes: ' + (await A.locator('#wf-note').textContent()));
  await A.locator('.wf-list .wf-stage[data-stage="build"] .wf-limit').fill('1');
  await A.click('#wf-save'); await sleep(400);
  const T = await team(A);
  ok(T.doc.workflow && T.doc.workflow.stages.map(s => s.id).join(',') === 'design,review,build,test,done' && T.doc.workflow.stages[2].limit === 1, 'saved with the Build limit');
  await A.keyboard.press('Escape'); await sleep(300);

  step('Cards show their stage');
  ok((await card(A, 'Wiring loom').locator('.stage-name').textContent()) === 'Review', 'the Doing task is now in Review (first Doing-kind stage)');
  ok((await card(A, 'Payload mount').locator('.stage-name').textContent()) === 'Design', 'new tasks start in Design');
  ok((await card(A, 'Wiring loom').locator('.stage-segs i').count()) === 5, 'five segments');

  step('The editor and the right-click menu use the team’s stages');
  await card(A, 'Payload mount').click(); await A.waitForSelector('#edit-form .stage-toggle');
  ok((await A.locator('#edit-form .stage-toggle button').allTextContents()).join('|') === 'Design|Review|Build|Test|Done', 'five stage buttons');
  await A.click('#edit-form .stage-toggle button[data-stage="build"]'); await sleep(300);
  ok((await taskNamed(A, 'Payload mount')).stage === 'build', 'saved as “build”');
  ok((await card(A, 'Payload mount').locator('.stage-name').textContent()) === 'Build', 'card says Build');
  ok(((await taskNamed(A, 'Payload mount')).history || []).some(h => h.field === 'Stage' && h.original === 'Design' && h.updated === 'Build'), 'history: Design → Build');
  await A.evaluate(() => { const l = allTaskLocs().find(x => x.task.name === 'Landing gear v2'); setTaskStage(l.task, 'build'); }); await sleep(300);
  ok((await A.locator('.toast', { hasText: 'its limit is 1' }).count()) >= 1, 'a second task in Build warns about the limit');
  await A.evaluate(() => { const l = allTaskLocs().find(x => x.task.name === 'Landing gear v2'); setTaskStage(l.task, 'done'); }); await sleep(300);
  ok((await taskNamed(A, 'Landing gear v2')).flag === 'completed', 'moving to Done completes the task');

  step('Kanban: one column per stage');
  await A.evaluate(() => boardSetView('kanban')); await A.waitForSelector('.kb-board');
  ok((await A.locator('.kb-col-head .kb-col-name').allTextContents()).join('|') === 'Design|Review|Build|Test|Done', 'five columns');
  ok((await A.locator('.kb-col-head[data-stage="build"] .kb-count').textContent()) === '1 / 1', 'Build shows 1 / 1');
  ok(await A.locator('.kb-list[data-stage="review"] .kb-card', { hasText: 'Wiring loom' }).count() === 1, 'Wiring loom in Review');
  await A.locator('.kb-card', { hasText: 'Wiring loom' }).focus(); await A.keyboard.press('Alt+ArrowRight'); await sleep(300);
  ok((await taskNamed(A, 'Wiring loom')).stage === 'build', 'Alt+→ moves it to the next stage');
  ok((await A.locator('.kb-col-head[data-stage="build"] .kb-count').getAttribute('class')).includes('over'), 'Build over its limit is marked');
  await A.evaluate(() => boardSetView('board')); await sleep(200);

  step('Changing the stages later keeps tasks in sensible places');
  await A.evaluate(() => TT.openSettings('workflow')); await A.waitForSelector('.wf-list');
  await A.locator('.wf-list .wf-stage[data-stage="build"] button[aria-label^="Remove"]').click(); await sleep(100);
  ok((await A.locator('#wf-note').textContent()).includes('“Build” will move to “Test”'), 'removing Build: its tasks go to Test');
  await A.click('#wf-save'); await sleep(400); await A.keyboard.press('Escape'); await sleep(300);
  ok((await card(A, 'Payload mount').locator('.stage-name').textContent()) === 'Test', 'Payload mount (was Build) is now in Test');
  const m = await A.evaluate(() => TT.stageId(allTaskLocs().find(x => x.task.name === 'Wiring loom').task));
  ok(m === 'test', 'and so is Wiring loom');

  step('Members can’t change it; analytics and share still work');
  const share = await A.evaluate(() => { TT.openShare(); return new Promise(r => setTimeout(() => r(document.getElementById('share-text').value), 200)); });
  ok(share.includes('Payload mount — Aisha Khan (Test)'), 'the weekly share names the stage: ' + share.split('\n').find(l => l.includes('Payload')));
  await A.keyboard.press('Escape');
  const kpis = await A.evaluate(() => { const r = window.boardRows({ scope: 'all', allPhases: true }); return r.map(x => x.stage + ':' + x.stageName).sort().join(','); });
  ok(kpis.includes('Doing:Test') && kpis.includes('Done:Done'), 'rows give analytics the kind and the stage name: ' + kpis);
  ok(await A.evaluate(async () => { const id = allTaskLocs().find(x => x.task.name === 'Payload mount').task.id; return !(await TT.writeOps([{ type: 'update', path: 'tasks/' + id, data: { stage: 'bad id!' } }], { quiet: true })); }), 'a malformed stage is refused');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 6).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
