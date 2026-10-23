// Phase 8 in demo mode: the progress report — opened from Analytics and Ctrl+K, period and person
// choices, sections, note, preview, Word download, copy as text, finance gating.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const preview = (p) => p.frameLocator('.rp-frame');
const previewText = (p) => preview(p).locator('body').textContent();

try {
  step('Set up a team with work done this week');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Robot Science'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(({ m, d }) => {
    weeksData[0].startDate = m;
    const c = db.find(x => x.id === TT.me.uid).categories[0];
    c[weeksData[0].key] = [
      { id: 't1', type: 'task', name: 'Order servos', priority: 'Minor', status: '', flag: 'completed', completedDate: d.today, subtasks: [], history: [] },
      { id: 't2', type: 'task', name: 'Wire the arm', priority: 'Major', status: 'In progress', flag: 'none', dueDate: d.soon, subtasks: [{ id: 's', title: 'a', completed: true }, { id: 's2', title: 'b', completed: false }], history: [] },
      { id: 't3', type: 'task', name: 'Literature review', priority: 'Critical', status: '', flag: 'none', dueDate: d.late, subtasks: [], history: [] },
    ];
    saveDatabase(); render();
  }, { m: monday(), d: { today: iso(0), soon: iso(5), late: iso(-3) } });
  await sleep(400);
  await A.evaluate(() => TT.setFeatures({ parts: true, finance: true })); await sleep(300);
  await A.evaluate(() => TT.openResearch('meetings')); await A.click('#mt-new'); await sleep(400);
  await A.fill('#mt-notes', 'Notes\n- demo\n\nDecisions\n- Use MG996R servos\n\nActions\n- [ ] Book the lab'); await A.locator('#mt-notes').blur(); await sleep(400);
  await A.keyboard.press('Escape'); await sleep(200);

  step('Open from Analytics');
  await A.click('#top-actions button:has-text("Analytics")'); await sleep(300);
  ok(await A.locator('#an-report').isVisible(), 'Analytics has a “Progress report” button');
  await A.click('#an-report'); await A.waitForSelector('.report-modal'); await sleep(600);
  let txt = await previewText(A);
  ok(txt.includes('Progress report') && txt.includes('Robot Science') && txt.includes('Last 7 days'), 'preview shows the title, team and period');
  ok(txt.includes('Completed in this period') && txt.includes('Order servos'), 'completed work listed');
  ok(txt.includes('In progress') && txt.includes('Wire the arm'), 'in-progress work listed');
  ok(txt.includes('Overdue and at risk') && txt.includes('Literature review') && txt.includes('Overdue by 3 days'), 'overdue work flagged');
  ok(txt.includes('Decision: Use MG996R servos'), 'meeting decisions included');
  ok(txt.includes('Budget and spending'), 'owner (finance access) sees the money section');
  await A.fill('#rp-message', 'Hi Dr Smith — main question for Thursday: servo torque.'); await sleep(700);
  ok((await previewText(A)).includes('main question for Thursday'), 'the note appears at the top');
  await A.locator('.rp-sec input[data-sec="meetings"]').uncheck(); await sleep(300);
  ok(!(await previewText(A)).includes('Meetings and decisions'), 'unticking a section removes it');
  await A.selectOption('#rp-period', '28'); await sleep(300);
  ok((await previewText(A)).includes('Last 4 weeks'), 'period can be changed');
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/phase8-report.png` });

  step('Outputs');
  const [doc] = await Promise.all([A.waitForEvent('download'), A.click('#rp-word')]);
  ok(/Progress_.*\.doc$/.test(doc.suggestedFilename()), 'Word download');
  const fs = await import('node:fs'); const docText = fs.readFileSync(await doc.path(), 'utf8');
  ok(docText.includes('<h2>Completed in this period</h2>') && docText.includes('Order servos'), 'Word file contains the report');
  await A.click('#rp-copy'); await sleep(300);
  const clip = await A.evaluate(() => navigator.clipboard.readText());
  ok(clip.startsWith('Progress report — Robot Science') && clip.includes('• Order servos'), 'copied as plain text for an email');
  ok(await A.locator('#rp-print').isVisible(), 'Print / PDF button');
  await A.keyboard.press('Escape'); await sleep(200);

  step('Remembers choices; opens from Ctrl+K');
  await A.keyboard.press('Control+k'); await A.fill('.cmdk-input', 'progress report'); await sleep(150); await A.keyboard.press('Enter'); await A.waitForSelector('.report-modal'); await sleep(400);
  ok(await A.locator('#rp-period').inputValue() === '28' && !(await A.locator('.rp-sec input[data-sec="meetings"]').isChecked()), 'last choices remembered');
  ok(await A.locator('#rp-message').inputValue() === '', 'the note isn’t kept (it’s per report)');
  await A.selectOption('#rp-person', { index: 1 }); await sleep(300);
  ok((await previewText(A)).includes('Progress report — Aisha Khan'), 'a report for one person');
  await A.keyboard.press('Escape'); await sleep(200);

  step('Finance hidden for people without access');
  await A.click('#top-actions button:has-text("Invite")'); await A.fill('.settings-pane textarea', 'tom@uni.ac.uk'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(200); await A.keyboard.press('Escape');
  const B = await tab('Tom'); await signIn(B, 'Tom Reed', 'tom@uni.ac.uk');
  await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat'); await sleep(500);
  await B.evaluate(() => TT.openReport()); await B.waitForSelector('.report-modal'); await sleep(500);
  ok(await B.locator('.rp-sec input[data-sec="finance"]').count() === 0 && !(await previewText(B)).includes('Budget and spending'), 'no finance section for Tom');
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
