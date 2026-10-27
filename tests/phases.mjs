// Project phases, end to end in demo mode: set up phases, give tasks a phase, filter,
// analytics and timeline, and a viewer who can see phases but not change them.
// Needs the preview server:  npx vite preview --port 4173
import { chromium, devices } from 'playwright';
import { editorAsOneList } from './editor-list.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
editorAsOneList(browser);   // the task editor as one list: these checks reach into every tab

const iso = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };
const store = (p) => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('tt_demo_store_v1')); const T = Object.values(s.teams)[0]; return { team: T.doc, tasks: Object.values(T.tasks) }; });

async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
async function dialog(p, value) { await p.waitForSelector('#dialog-overlay input'); await p.fill('#dialog-overlay input', value); await p.click('#dialog-overlay .dlg-ok'); await sleep(200); }

try {
  console.log('▸ Owner sets up phases (desktop)');
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/phases-${n}.png` }); };
  await signIn(p, 'Rushi Vibhandik', 'rushi@uni.ac.uk');
  await p.fill('#create-team-form input[name=name]', 'Robot Science and Technology'); await p.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await p.click('#create-team-form button[type=submit]');
  await p.waitForSelector('.node-cat'); await sleep(300);
  for (const n of ['Literature survey', 'Gripper CAD', 'Motor test']) { await p.click('.col-add'); await dialog(p, n); }

  // Editor hint before any phases exist
  await p.locator('.task-card', { hasText: 'Literature survey' }).click(); await sleep(250);
  ok(await p.locator('#edit-form .panel-section h4', { hasText: 'Phase' }).isVisible(), 'editor shows a Phase section');
  ok(await p.locator('#edit-form button:has-text("Set up phases")').isVisible(), 'owner is offered "Set up phases…" when there are none');
  await p.click('#edit-form button:has-text("Set up phases")'); await sleep(300);
  ok(await p.locator('.settings-nav button.on', { hasText: 'Phases' }).isVisible(), 'it opens Team settings ▸ Phases');

  await p.click('button:has-text("Start with Research")'); await sleep(200);
  ok(await p.locator('.phase-row').count() === 4, 'template adds Research, Design, Build, Test');
  const rows = p.locator('.phase-row');
  const setDate = async (i, label, v) => rows.nth(i).locator(`input[aria-label="${label}"]`).fill(v);
  await setDate(0, 'Start date', iso(-20)); await setDate(0, 'End date', iso(-2));
  await setDate(1, 'Start date', iso(-1)); await setDate(1, 'End date', iso(13));
  await rows.nth(1).locator('input[aria-label="Milestone"]').fill('Design review with supervisor');
  await setDate(2, 'Start date', iso(14)); await setDate(2, 'End date', iso(10));   // ends before it starts
  await p.click('button:has-text("Save phases")'); await sleep(300);
  ok((await store(p)).team.phases === undefined || (await store(p)).team.phases.length === 0, 'a phase that ends before it starts is refused');
  await setDate(2, 'End date', iso(40));
  await p.click('button:has-text("Save phases")'); await sleep(400);
  let st = await store(p);
  ok(st.team.phases.length === 4 && st.team.phases[1].milestone === 'Design review with supervisor', 'phases saved to the team');
  ok(st.team.phases.map(x => x.name).join('>') === 'Research>Design>Build>Test', 'in order');
  await shot('1-settings');
  await p.keyboard.press('Escape'); await sleep(200);

  // Pick a phase in the editor
  await p.locator('.task-card', { hasText: 'Literature survey' }).click(); await sleep(250);
  await p.selectOption('#edit-phase', await p.$eval('#edit-phase', s => [...s.options].find(o => o.text.startsWith('Research')).value)); await sleep(300);
  st = await store(p);
  const lit = st.tasks.find(t => t.name === 'Literature survey');
  ok(lit.phaseId === st.team.phases[0].id, 'phase chosen in the editor is saved');
  ok(lit.history[0].field === 'Phase' && lit.history[0].updated === 'Research', 'phase change recorded in the history log');
  ok(await p.locator('.task-card', { hasText: 'Literature survey' }).locator('.phase-tag', { hasText: 'Research' }).isVisible(), 'card shows a Research tag');

  // Right-click ▸ Phase ▸ Design
  await p.locator('.task-card', { hasText: 'Gripper CAD' }).click({ button: 'right' }); await sleep(200);
  await p.locator('#quick-menu .qm-btn', { hasText: 'Phase' }).click(); await sleep(200);
  await p.locator('#quick-submenu .qm-btn', { hasText: 'Design' }).click(); await sleep(300);
  st = await store(p);
  ok(st.tasks.find(t => t.name === 'Gripper CAD').phaseId === st.team.phases[1].id, 'right-click ▸ Phase ▸ Design works');
  await p.locator('.task-card', { hasText: 'Gripper CAD' }).click(); await sleep(250);
  ok(await p.locator('#edit-form', { hasText: 'Milestone: Design review with supervisor' }).isVisible(), 'editor shows the phase milestone');

  // Deadlines so the timeline has something to draw
  await p.evaluate((d) => { db.forEach(pp => pp.categories.forEach(c => weeksData.forEach(w => (c[w.key] || []).forEach(t => { if (t.name === 'Gripper CAD') t.dueDate = d; if (t.name === 'Literature survey') { t.dueDate = d; t.flag = 'completed'; } })))); saveDatabase(); render(); }, iso(5));
  await sleep(300);

  // Board filter
  if (await p.locator('#editor-panel .ed-back').isVisible()) await p.click('#editor-panel .ed-back');   // back from the task to Search & filters
  await p.click('.filter-header:has-text("Filter by Phase")'); await sleep(150);
  ok(await p.locator('#filter-phases label').count() === 5, 'phase filter lists the 4 phases + "No phase"');
  await p.locator('#filter-phases label', { hasText: 'Research' }).locator('input').uncheck(); await sleep(250);
  ok(!(await p.locator('.task-card', { hasText: 'Literature survey' }).isVisible()), 'hiding Research hides its tasks');
  ok(await p.locator('.task-card', { hasText: 'Gripper CAD' }).isVisible(), 'other phases stay visible');
  await p.locator('#filter-phases label', { hasText: 'No phase' }).locator('input').uncheck(); await sleep(250);
  ok(!(await p.locator('.task-card', { hasText: 'Motor test' }).isVisible()), 'hiding "No phase" hides unphased tasks');
  await p.click('#filter-content-phase .filter-actions span:has-text("All")'); await sleep(250);
  ok(await p.locator('.task-card', { hasText: 'Motor test' }).isVisible() && await p.locator('.task-card', { hasText: 'Literature survey' }).isVisible(), '"All" shows everything again');
  await shot('2-board');

  // Analytics ▸ Phases
  await p.click('#top-actions button:has-text("Analytics")'); await p.waitForSelector('.an-kpis');
  await p.click('.an-tab[data-tab="phases"]'); await sleep(250);
  ok(await p.locator('.ph-card').count() === 5, 'one progress card per phase + "No phase"');
  ok(await p.locator('.ph-band').count() === 3, 'dated phases drawn as bands (Test has no dates)');
  ok(await p.locator('.ph-ms').count() === 1, 'milestone marker drawn');
  ok(await p.locator('.ph-today').count() === 1, 'today line drawn');
  ok(await p.locator('.ph-card', { hasText: 'Research' }).locator('.ph-health', { hasText: 'Completed' }).isVisible(), 'Research ended with everything done = Completed');
  ok(await p.locator('.ph-card', { hasText: 'Design' }).locator('.ph-state', { hasText: 'left' }).isVisible(), 'Design shows days left');
  await shot('3-analytics-phases');
  await p.selectOption('#an-phase', { label: 'Design' }); await sleep(200);
  await p.click('.an-tab[data-tab="overview"]'); await sleep(200);
  ok((await p.locator('.an-kpi').first().locator('.an-kpi-v').textContent()).trim() === '1', 'Phase filter narrows analytics to Design (1 task)');
  await p.selectOption('#an-phase', 'all'); await sleep(200);
  await p.click('.an-tab[data-tab="timeline"]'); await sleep(300);
  ok(await p.locator('.gt-phase').count() === 3, 'timeline shows phase bands');
  ok(await p.locator('.gt-group .gt-label', { hasText: 'Phases' }).isVisible(), 'under a "Phases" heading');
  await shot('4-timeline');
  await p.keyboard.press('Escape'); await sleep(200);

  // Undo the phase change
  await p.keyboard.press('Control+z'); await sleep(300);
  console.log('▸ Viewer sees phases but cannot change them');
  // Make a viewer by editing the demo store directly
  await p.evaluate(() => {
    const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const id = Object.keys(s.teams)[0];
    s.teams[id].invites['val@uni.ac.uk'] = { email: 'val@uni.ac.uk', roleId: 'viewer', teamName: 'Robot Science and Technology', invitedBy: 'x', invitedByName: 'Rushi', createdAt: Date.now() };
    localStorage.setItem(k, JSON.stringify(s));
  });
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
  const v = await ctx2.newPage(); v.on('pageerror', e => errors.push('viewer: ' + e.message)); v.on('dialog', d => d.accept());
  await v.goto(BASE); await v.evaluate((data) => localStorage.setItem('tt_demo_store_v1', data), await p.evaluate(() => localStorage.getItem('tt_demo_store_v1')));
  await signIn(v, 'Val Viewer', 'val@uni.ac.uk');
  await v.tap('#invites-list button:has-text("Join team")'); await v.waitForSelector('.node-cat'); await sleep(400);
  ok(await v.locator('.task-card .phase-tag').count() >= 1, 'viewer sees phase tags on a phone');
  await v.locator('.task-card', { hasText: 'Gripper CAD' }).tap(); await sleep(400);
  ok(await v.locator('#edit-phase').isDisabled(), 'viewer cannot change a task’s phase');
  await v.tap('#editor-panel .ed-close'); await sleep(300);
  await v.tap('#top-actions button:has-text("Settings")'); await sleep(300);
  await v.tap('.settings-nav button:has-text("Phases")'); await sleep(200);
  ok(await v.locator('.settings-pane .read-only-note').first().isVisible() && await v.locator('button:has-text("Save phases")').count() === 0, 'viewer sees phases read-only');
  ok(await v.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phase settings fit a phone');
  if (SHOTS) await v.screenshot({ path: `${SHOTS}/phases-5-phone-settings.png` });
  await ctx2.close(); await ctx.close();
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
