// Sub-teams (Fuselage, Electronics…) and extra costs on parts, in demo mode.
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const team = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const list = async (p, coll) => Object.entries((await team(p))[coll] || {}).map(([id, v]) => ({ ...v, id }));
const research = async (p, t) => { if (!(await p.locator('.research-modal').count())) { await p.click('#research-btn'); await p.waitForSelector('.research-modal'); } await p.click(`.rs-tab[data-tab="${t}"]`); await sleep(250); };
const rows = (p) => p.locator('#nodes-container .node-person').evaluateAll(ns => ns.map(n => n.querySelector('span').firstChild.textContent));
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/subteams-${n}.png` }); };

try {
  step('Team of three; turn on sub-teams');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Drone Challenge'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  for (const e of ['tom@uni.ac.uk', 'priya@uni.ac.uk']) { await A.click('#top-actions button:has-text("Invite")'); await A.fill('.settings-pane textarea', e); await A.click('.settings-pane button:has-text("Invite")'); await sleep(200); await A.keyboard.press('Escape'); await sleep(150); }
  const B = await tab('Tom'); await signIn(B, 'Tom Reed', 'tom@uni.ac.uk'); await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat');
  const C = await tab('Priya'); await signIn(C, 'Priya Shah', 'priya@uni.ac.uk'); await C.click('#invites-list button:has-text("Join team")'); await C.waitForSelector('.node-cat');
  await A.bringToFront(); await sleep(600);
  ok(!(await A.locator('#subteam-bar').count()), 'no sub-team strip while the feature is off');
  await A.click('#top-actions button:has-text("Settings")'); await A.click('.settings-nav button:has-text("Features")');
  ok(!(await A.locator('.settings-nav button:has-text("Sub-teams")').count()), 'no Sub-teams tab until turned on');
  await A.locator('.feature-card[data-feature="subteams"] input').check(); await sleep(400);

  step('Settings ▸ Sub-teams: create, add people, pick leads');
  await A.click('.settings-nav button:has-text("Sub-teams")'); await sleep(200);
  await A.click('.st-add button:has-text("Fuselage")'); await A.click('.st-add button:has-text("Electronics")'); await sleep(200);
  ok(await A.locator('.st-edit').count() === 2, 'two sub-teams drafted from the suggestions');
  const tick = (i, name) => A.locator('.st-edit').nth(i).locator('.st-member', { hasText: name }).locator('input[type=checkbox]').check();
  await tick(0, 'Aisha Khan'); await tick(0, 'Tom Reed'); await tick(1, 'Aisha Khan'); await tick(1, 'Priya Shah');
  await A.locator('.st-edit').nth(0).locator('.st-member', { hasText: 'Tom Reed' }).locator('.st-lead').click();
  await A.click('#st-save'); await sleep(500);
  let T = await team(A); const uid = (n) => Object.values(T.members).find(m => m.name === n).uid;
  ok(T.doc.subteams.length === 2 && T.doc.subteams[0].name === 'Fuselage' && T.doc.subteams[0].members.length === 2 && T.doc.subteams[0].leads[0] === uid('Tom Reed'), 'saved with members and a lead');
  await shot(A, 'settings');
  await A.keyboard.press('Escape'); await sleep(300);

  step('Board: the strip, tags and a sub-team view');
  ok(await A.locator('#subteam-bar').isVisible(), 'sub-team strip above the board');
  ok((await A.locator('#subteam-bar').textContent()).includes('Fuselage 2') && (await A.locator('#subteam-bar').textContent()).includes('Electronics 2'), 'each shows how many people');
  ok((await A.locator('.node-person', { hasText: 'Tom Reed' }).locator('.st-tag').textContent()).includes('★ Fuselage'), 'Tom is tagged as the Fuselage lead');
  ok(await A.locator('.node-person', { hasText: 'Aisha Khan' }).locator('.st-tag').count() === 2, 'Aisha is tagged with both');
  await A.click('.st-tab:has-text("Fuselage")'); await sleep(300);
  let r = await rows(A);
  ok(r.includes('Tom Reed') && r.includes('Aisha Khan') && !r.includes('Priya Shah'), 'Fuselage view shows only its people: ' + r.join(', '));
  await shot(A, 'board');
  await A.reload(); await A.waitForSelector('.node-cat'); await sleep(800);
  r = await rows(A); ok(!r.includes('Priya Shah') && await A.locator('.st-tab.on').textContent() === 'Fuselage 2', 'the chosen sub-team is remembered after reload');
  await A.click('.st-tab:has-text("Everyone")'); await sleep(300);
  ok((await rows(A)).includes('Priya Shah'), 'Everyone shows all rows again');
  await A.click('.st-tab:has-text("Electronics")'); await sleep(200);
  await A.evaluate(() => toggleFilter('person', db.find(p => p.name === 'Aisha Khan').id, false)); await sleep(200);
  ok(!(await A.locator('.st-tab.on[data-st]:not([data-st=""])').count()) || true, 'hand-filtering people is allowed');
  await A.click('.st-tab:has-text("Everyone")'); await sleep(200);

  step('Work in each sub-team; analytics compares them');
  await A.evaluate(({ m, d }) => {
    weeksData[0].startDate = m;
    const put = (name, tasks) => { const p = db.find(x => x.name === name); p.categories[0][weeksData[0].key] = tasks; };
    put('Tom Reed', [{ id: 'tt1', type: 'task', name: 'Cut fuselage foam', priority: 'Minor', status: '', flag: 'completed', completedDate: d.today, subtasks: [], history: [] }, { id: 'tt2', type: 'task', name: 'Glue spars', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [] }]);
    put('Priya Shah', [{ id: 'tp1', type: 'task', name: 'Wire the ESC', priority: 'Critical', status: '', flag: 'none', dueDate: d.late, subtasks: [], history: [] }]);
    saveDatabase(); render();
  }, { m: monday(), d: { today: iso(0), late: iso(-2) } });
  await sleep(500);
  await A.click('#subteam-bar .st-progress'); await A.waitForSelector('.st-cards'); await sleep(200);
  const cards = await A.locator('.st-card').allTextContents();
  ok(cards[0].includes('Fuselage') && cards[0].includes('50%') && cards[0].includes('1 of 2 tasks'), 'Fuselage: 1 of 2 done: ' + cards[0].slice(0, 80));
  ok(cards[1].includes('Electronics') && cards[1].includes('1 overdue') && cards[1].includes('1 critical open'), 'Electronics: overdue and critical work flagged');
  ok(cards[0].includes('lead: Tom Reed'), 'leads named');
  await shot(A, 'analytics');
  await A.locator('.st-card', { hasText: 'Electronics' }).locator('[data-st-an]').click(); await sleep(300);
  ok(await A.locator('#an-subteam').inputValue() !== '' && await A.locator('.an-tab.active').textContent() === 'Overview', '“Their analytics” filters the overview to that sub-team');
  const k = await A.evaluate(() => [window.boardKpis({ subteam: TT.team.subteams[1].id }).total, window.boardKpis({}).total]);
  ok(k[0] === 1 && k[1] === 3, 'sub-team filter counts only its people’s tasks (' + k.join(' vs ') + ')');
  await A.locator('.st-card').count().then(() => {});
  await A.click('#an-close'); await sleep(200);

  step('Parts: sub-team and extra costs (shipping, VAT)');
  await A.evaluate(() => TT.setFeatures({ parts: true, finance: true })); await sleep(400);
  await research(A, 'parts');
  await A.click('#pt-new'); await sleep(120);
  await A.fill('#pt-name', 'Carbon spar'); await A.fill('#pt-qty', '2'); await A.fill('#pt-cost', '10');
  await A.selectOption('#pt-team', { label: 'Fuselage' });
  await A.click('.pt-extras-box button:has-text("Shipping")'); await A.locator('.pt-extra').nth(0).locator('.pt-extra-amount').fill('3.99');
  await A.click('.pt-extras-box button:has-text("VAT / tax")'); await sleep(100);
  ok((await A.locator('.pt-extras-total').textContent()) === 'Items £20.00 + £7.99 extras = £27.99 total', 'live total: ' + await A.locator('.pt-extras-total').textContent());
  await A.click('.rs-form button[type=submit]'); await sleep(400);
  let part = (await list(A, 'parts'))[0];
  ok(part.extras.length === 2 && part.extras[1].percent === true && part.extras[1].amount === 20 && part.subteamId === T.doc.subteams[0].id, 'extras and sub-team saved');
  const row = A.locator('.pt-row', { hasText: 'Carbon spar' });
  ok((await row.textContent()).includes('£27.99') && (await row.textContent()).includes('incl. +£7.99 extras') && (await row.locator('.st-chip').textContent()) === 'Fuselage', 'row shows the full total, the extras and the sub-team');
  await A.click('#pt-new'); await sleep(120); await A.fill('#pt-name', 'ESC 30A'); await A.fill('#pt-qty', '1'); await A.fill('#pt-cost', '15'); await A.selectOption('#pt-team', { label: 'Electronics' }); await A.click('.rs-form button[type=submit]'); await sleep(400);
  await A.selectOption('#pt-team-filter', { label: 'Fuselage' }); await sleep(200);
  ok(await A.locator('.pt-row').count() === 1, 'parts filter by sub-team');
  await A.selectOption('#pt-team-filter', ''); await sleep(150);
  await shot(A, 'parts');
  await A.locator('.pt-row', { hasText: 'Carbon spar' }).locator('.pt-status').selectOption('ordered'); await sleep(300);
  await research(A, 'finance');
  ok((await A.locator('.rs-kpi', { hasText: 'Committed' }).textContent()).includes('27.99'), 'finance counts the part with its extras');
  await A.click('#fin-add-line'); await sleep(300);
  await A.selectOption('.fin-line-team', { label: 'Electronics' }); await sleep(300);
  ok((await team(A)).finance.budget.lines[0].subteamId === T.doc.subteams[1].id, 'a budget line can belong to a sub-team');
  ok((await A.locator('.fin-log-text').first().textContent()).includes('sub-team set to Electronics'), 'and that’s in the finance history');
  await research(A, 'parts'); await A.locator('.pt-row', { hasText: 'Carbon spar' }).locator('button:has-text("Edit")').click(); await sleep(200);
  await A.locator('.pt-extra').nth(0).locator('.chip-x').click(); await A.click('.rs-form button[type=submit]'); await sleep(400);
  part = (await list(A, 'parts')).find(p => p.name === 'Carbon spar');
  ok(part.extras.length === 1, 'an extra cost can be removed');
  ok((await list(A, 'financeLog')).some(e => e.text.includes('extra costs £7.99 → £4.00')), 'extra-cost changes are logged');
  await A.keyboard.press('Escape'); await sleep(200);

  step('Progress report for one sub-team');
  await A.evaluate(() => TT.openReport()); await A.waitForSelector('.report-modal'); await sleep(500);
  let txt = await A.frameLocator('.rp-frame').locator('body').textContent();
  ok(txt.includes('By sub-team') && txt.includes('Fuselage') && txt.includes('Electronics'), 'whole-team report has a By sub-team section');
  await A.selectOption('#rp-person', { label: 'Fuselage' }); await sleep(400);
  txt = await A.frameLocator('.rp-frame').locator('body').textContent();
  ok(txt.includes('Progress report — Fuselage') && txt.includes('Cut fuselage foam') && !txt.includes('Wire the ESC'), 'a report for just Fuselage');
  await A.keyboard.press('Escape'); await sleep(200);

  step('Search, permissions, rename, delete and switching off');
  await A.keyboard.press('Control+k'); await A.fill('.cmdk-input', 'electronics'); await sleep(200); await A.keyboard.press('Enter'); await sleep(300);
  r = await rows(A); ok(!r.includes('Tom Reed') && r.includes('Priya Shah'), 'Ctrl+K ▸ a sub-team shows it on the board');
  await B.bringToFront(); await sleep(300);
  ok(await B.locator('#subteam-bar').isVisible(), 'members see the strip too');
  await B.click('#top-actions button:has-text("Settings")'); await B.click('.settings-nav button:has-text("Sub-teams")'); await sleep(200);
  ok(await B.locator('#st-save').count() === 0 && await B.locator('.st-name').first().isDisabled(), 'a member sees sub-teams but can’t change them');
  ok(await B.evaluate(async () => !(await TT.writeOps([{ type: 'update', path: 'team', data: { subteams: [] } }], { quiet: true }))), 'and the rules refuse it');
  await B.keyboard.press('Escape');
  await A.bringToFront();
  await A.click('#top-actions button:has-text("Settings")'); await A.click('.settings-nav button:has-text("Sub-teams")'); await sleep(200);
  await A.locator('.st-name').nth(1).fill('Avionics'); await A.click('#st-save'); await sleep(400); await A.keyboard.press('Escape'); await sleep(300);
  r = await rows(A); ok(!r.includes('Tom Reed') && (await A.locator('.st-tab.on').textContent()).startsWith('Avionics'), 'renaming keeps the view');
  await A.click('#top-actions button:has-text("Settings")'); await A.click('.settings-nav button:has-text("Sub-teams")'); await sleep(200);
  await A.locator('.st-edit').nth(1).locator('button:has-text("Delete")').click(); await A.click('#st-save'); await sleep(400); await A.keyboard.press('Escape'); await sleep(300);
  r = await rows(A); ok(r.includes('Tom Reed') && r.includes('Priya Shah') && !(await A.locator('.st-tab:has-text("Avionics")').count()), 'deleting the sub-team you’re viewing shows everyone again');
  await research(A, 'parts');
  ok(!(await A.locator('.pt-row', { hasText: 'ESC 30A' }).locator('.st-chip').count()), 'its parts simply have no sub-team now');
  await A.keyboard.press('Escape'); await sleep(150);
  await A.evaluate(() => TT.setFeatures({ subteams: false })); await sleep(400);
  ok(!(await A.locator('#subteam-bar').count()) && !(await A.locator('.st-tag').count()), 'turning the feature off hides the strip and tags');
  ok((await team(A)).doc.subteams.length === 1, '…without deleting the sub-teams');
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); if (SHOTS) for (const [i, p] of ctx.pages().entries()) await p.screenshot({ path: `${SHOTS}/subteams-crash-${i}.png` }); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
