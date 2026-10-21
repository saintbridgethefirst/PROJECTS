// A new team's first minutes, in demo mode: the "Start here" checklist, Share this week, the import window.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, acceptDownloads: true });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
async function dialog(p, value) { await p.waitForSelector('#dialog-overlay input'); await p.fill('#dialog-overlay input', value); await p.click('#dialog-overlay .dlg-ok'); await sleep(200); }
const steps = (p) => p.evaluate(() => [...document.querySelectorAll('#start-card li')].map(li => li.dataset.step + (li.classList.contains('done') ? ':done' : '')));

try {
  step('A new team shows the Start here checklist to its owner');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Bristol Drone Society'); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await A.waitForSelector('#start-card'); await sleep(300);
  ok((await steps(A)).join(',') === 'tasks,invite,tools,share', 'four steps, none done: ' + (await steps(A)).join(','));
  ok((await A.locator('#start-card .start-count').textContent()) === '0 of 4', 'counter 0 of 4');

  step('Steps tick themselves as they get done');
  for (const n of ['Landing gear CAD', 'Payload bay mount', 'Order ESCs']) { await A.click('.col-add'); await dialog(A, n); }
  await sleep(300);
  ok((await steps(A)).includes('tasks:done'), 'three tasks → “Add your first tasks” done');
  await A.locator('#start-card li[data-step="tools"] button').click(); await A.waitForSelector('.feature-card'); await A.keyboard.press('Escape'); await sleep(250);
  ok((await steps(A)).includes('tools:done'), 'opening Features → “Pick the tools” done');
  await A.locator('#start-card li[data-step="invite"] button').click(); await sleep(250);
  await A.fill('.settings-pane textarea', 'tom@uni.ac.uk'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(300); await A.keyboard.press('Escape'); await sleep(200);
  ok((await steps(A)).includes('invite:done'), 'sending an invitation → “Invite your team” done');

  step('Share this week');
  await A.evaluate(() => { const l = allTaskLocs().find(x => x.task.name === 'Landing gear CAD'); l.task.flag = 'completed'; l.task.completedDate = new Date().toLocaleDateString('en-CA'); saveDatabase(); render(); });
  await A.click('#share-btn'); await A.waitForSelector('#share-text');
  let text = await A.inputValue('#share-text');
  ok(text.startsWith('*Bristol Drone Society · ') && text.includes('✅ *Done* (1)\n• Landing gear CAD — Aisha Khan'), 'the week’s summary, WhatsApp-formatted');
  ok(text.includes('1 of 3 tasks done') && /👉 http.*#\/t\//.test(text), 'progress and a link to the board');
  await A.locator('#share-names').uncheck(); text = await A.inputValue('#share-text');
  ok(!text.includes('Aisha Khan'), '“Show names” off leaves names out');
  await A.selectOption('#share-scope', 'me'); text = await A.inputValue('#share-text');
  ok(text.startsWith('*Bristol Drone Society · Aisha Khan · '), '“Just my tasks”');
  await A.fill('#share-text', 'Edited message ✈️');
  const href = await A.locator('#share-whatsapp').evaluate(a => { a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); return a.href; });
  ok(href === 'https://wa.me/?text=' + encodeURIComponent('Edited message ✈️'), 'Send to WhatsApp opens wa.me with the (edited) text');
  await A.keyboard.press('Escape'); await sleep(250);
  ok((await steps(A)).includes('share:done') && (await A.locator('#start-card .start-count').textContent()) === '4 of 4', 'all four done');
  ok((await A.locator('#start-card').textContent()).includes('Your team is set up'), '🎉 Your team is set up');

  step('Fold, hide, and other people');
  await A.locator('#start-card button[aria-label="Fold"]').click(); await sleep(150);
  ok(await A.locator('#start-open').isVisible(), 'folds to a small pill');
  await A.click('#start-open'); await A.click('#start-hide'); await sleep(150);
  ok(!(await A.locator('#start-card').count()), 'hidden for good…');
  await A.reload(); await A.waitForSelector('.node-cat'); await sleep(500);
  ok(!(await A.locator('#start-card').count()), '…also after a reload');
  const B = await tab('Tom');
  await signIn(B, 'Tom Reed', 'tom@uni.ac.uk');
  await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat'); await sleep(500);
  ok(!(await B.locator('#start-card').count()), 'a member (not managing the team) never sees it');
  ok(await B.locator('#share-btn').isVisible(), 'but anyone can share the week');

  step('Import window: what works, a template, then a file');
  await A.click('#team-data-actions button:has-text("Import tasks")'); await A.waitForSelector('#imp-drop');
  ok((await A.locator('.modal').textContent()).includes('Trello') && (await A.locator('.modal').textContent()).includes('Jira'), 'explains spreadsheets, Trello and Jira');
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('#imp-template')]);
  ok(dl.suggestedFilename() === 'TeamTrack-import-template.xlsx', 'downloads an Excel template');
  const file = await dl.path();
  const [chooser] = await Promise.all([A.waitForEvent('filechooser'), A.click('#imp-choose')]);
  await chooser.setFiles(file); await A.waitForSelector('.modal-foot button:has-text("Import 2 tasks")');
  ok(true, 'the template itself imports: “Import 2 tasks”');
  await A.click('.modal-foot button:has-text("Import 2 tasks")'); await sleep(400);
  ok(await A.locator('.task-card', { hasText: 'Design the landing gear mount' }).count() === 1, 'and the example tasks land on the board');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 6).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
