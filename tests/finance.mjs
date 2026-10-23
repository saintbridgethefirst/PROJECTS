// Parts ↔ payments, protected budget-line delete and the finance history, in demo mode.
// Mirrors the real case: a £12.99 fuselage ordered from TEMU and a separate £12.99 payment.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const team = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const list = async (p, coll) => Object.entries((await team(p))[coll] || {}).map(([id, v]) => ({ ...v, id }));
const research = async (p, t) => { if (!(await p.locator('.research-modal').count())) { await p.click('#research-btn'); await p.waitForSelector('.research-modal'); } await p.click(`.rs-tab[data-tab="${t}"]`); await sleep(250); };
const kpi = (p, label) => p.locator('.rs-kpi', { hasText: label }).locator('.rs-kpi-v').textContent();
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/finance-${n}.png` }); };
const history = async (p) => (await p.locator('.fin-log-text').allTextContents());

try {
  step('Set up: owner with parts and finance on, and a member');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'BUDS Drone'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(() => TT.setFeatures({ parts: true, finance: true })); await sleep(300);
  await A.click('#top-actions button:has-text("Invite")'); await A.fill('.settings-pane textarea', 'tom@uni.ac.uk'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(200); await A.keyboard.press('Escape');
  const B = await tab('Tom'); await signIn(B, 'Tom Reed', 'tom@uni.ac.uk');
  await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat'); await sleep(400);
  await A.bringToFront();

  step('Budget lines (each change goes in the history)');
  await research(A, 'finance');
  await A.click('#fin-add-line'); await sleep(300);
  await A.locator('.fin-line-name').nth(0).fill('BUDS DRONE BUDGET 2026'); await A.locator('.fin-line-name').nth(0).press('Tab'); await sleep(300);
  await A.locator('.fin-line-amount').nth(0).fill('1313'); await A.locator('.fin-line-amount').nth(0).press('Tab'); await sleep(300);
  await A.click('#fin-add-line'); await sleep(300); await A.click('#fin-add-line'); await sleep(300);
  ok(await A.locator('.fin-line-name').count() === 3, 'three budget lines');
  let h = await history(A);
  ok(h.some(t => t === 'Renamed budget line “New budget line” to “BUDS DRONE BUDGET 2026”') && h.some(t => t === '“BUDS DRONE BUDGET 2026” budget £0.00 → £1,313'), 'rename and amount are in the history: ' + h.slice(0, 4).join(' | '));
  ok((await A.locator('.fin-log-list li').first().textContent()).includes('Aisha Khan'), 'history says who');
  const del = A.locator('.fin-del').first();
  const box = await del.boundingBox(); const card = await A.locator('.rs-card', { has: A.locator('.fin-table') }).boundingBox();
  ok(box && card && box.x > card.x && box.x + box.width <= card.x + card.width + 1 && box.y > card.y + 40, 'the delete button sits in its row (it used to float to the corner)');

  step('A part ordered, and a payment recorded on its own (the double count)');
  await research(A, 'parts');
  await A.click('#pt-new'); await sleep(120); await A.fill('#pt-name', 'FUSELAGE'); await A.fill('.rs-form input[maxlength="120"]', 'TEMU'); await A.fill('#pt-qty', '1'); await A.fill('#pt-cost', '12.99');
  await A.click('.rs-form button[type=submit]'); await sleep(400);
  await A.locator('.pt-row', { hasText: 'FUSELAGE' }).locator('.pt-status').selectOption('ordered'); await sleep(400);
  await research(A, 'finance');
  await A.click('#fin-add-expense'); await A.fill('#tx-amount', '12.99'); await A.click('.rs-form button[type=submit]'); await sleep(400);
  ok((await kpi(A, 'Committed')).includes('12.99') && (await kpi(A, 'Spent')).includes('12.99'), 'before linking: £12.99 spent AND £12.99 committed');
  ok(await A.locator('.fin-owed').isVisible() && (await A.locator('.fin-owed').textContent()).includes('1 part has been bought but no payment is recorded'), 'Finance points out the unpaid part');
  await A.click('#fin-owed-show'); await sleep(300);
  ok(await A.locator('.pt-row').count() === 1 && (await A.locator('.rs-tab.active, .rs-tab[aria-selected="true"]').first().textContent()).includes('Parts'), '“Show it” opens Parts filtered to bought-not-paid');
  ok((await kpi(A, 'Bought, not paid')).includes('12.99'), 'Parts: bought, not paid £12.99');
  ok(await A.locator('.pt-row', { hasText: 'FUSELAGE' }).locator('.pay-btn').isVisible(), 'the part offers “Record payment”');

  step('Link the existing payment to the part');
  await research(A, 'finance');
  await A.locator('.rs-table tr.tx-expense').first().locator('button:has-text("Edit")').click(); await sleep(300);
  await A.click('#tx-link-part'); await A.waitForSelector('.cmdk-input');
  ok((await A.locator('.cmdk-modal, .cmdk').first().textContent()).includes('Not paid yet'), 'the picker groups parts that aren’t paid yet');
  await A.fill('.cmdk-input', 'fuse'); await sleep(250); await A.keyboard.press('Enter'); await sleep(400);
  ok(await A.locator('#tx-desc').inputValue() === 'FUSELAGE (TEMU)' && await A.locator('#tx-amount').inputValue() === '12.99', 'description filled from the part; amount kept');
  ok((await A.locator('.tx-parts-field').textContent()).includes('FUSELAGE'), 'part chip shown in the form');
  await A.selectOption('#tx-line', { label: 'BUDS DRONE BUDGET 2026' });
  await A.click('.rs-form button[type=submit]'); await sleep(400);
  let ex = await list(A, 'expenses'); const fus = (await list(A, 'parts')).find(p => p.name === 'FUSELAGE');
  ok(ex.length === 1 && ex[0].partIds.length === 1 && ex[0].partIds[0] === fus.id, 'the payment now covers the part');
  ok(fus.budgetId === ex[0].budgetId && fus.budgetId, 'the part takes the payment’s budget line (it had none)');
  ok((await kpi(A, 'Committed')).includes('0.00') && !(await A.locator('.fin-owed').count()), 'after linking: nothing committed, no warning — counted once');
  ok((await A.locator('tr.tx-expense').first().locator('.tx-part').textContent()).includes('FUSELAGE'), 'the transaction shows the part it paid for');
  h = await history(A);
  ok(h.some(t => t.startsWith('Edited spending £12.99: ') && t.includes('linked “FUSELAGE”') && t.includes('description set to “FUSELAGE (TEMU)”') && t.includes('budget line “Not assigned” → “BUDS DRONE BUDGET 2026”')), 'the link is in the history: ' + h[0]);
  await research(A, 'parts'); await A.selectOption('.rs-bar select', 'all'); await sleep(200);
  ok((await A.locator('.pt-row', { hasText: 'FUSELAGE' }).locator('.pay-ok').textContent()).includes('Paid'), 'Parts shows the fuselage as paid');
  ok((await kpi(A, 'Bought, not paid')).includes('0.00'), 'nothing left unpaid');
  await shot(A, 'parts');

  step('Record a payment straight from a part');
  await A.click('#pt-new'); await sleep(120); await A.fill('#pt-name', 'Motor'); await A.fill('.rs-form input[maxlength="120"]', 'HobbyKing'); await A.fill('#pt-qty', '2'); await A.fill('#pt-cost', '10');
  await A.click('.rs-form button[type=submit]'); await sleep(400);
  await A.locator('.pt-row', { hasText: 'Motor' }).locator('.pay-btn').click(); await sleep(400);
  ok(await A.locator('#tx-amount').inputValue() === '20' && await A.locator('#tx-desc').inputValue() === 'Motor × 2 (HobbyKing)', 'Finance opens with the payment filled in');
  await A.click('.rs-form button[type=submit]'); await sleep(400);
  ok((await list(A, 'parts')).length === 2, 'adding a second part keeps the first (new parts used to share one id and replace each other)');
  const motor = (await list(A, 'parts')).find(p => p.name === 'Motor');
  ok(motor.status === 'ordered' && motor.orderedDate, 'a “needed” part that’s been paid for becomes “ordered”');
  ok((await list(A, 'expenses')).some(x => x.partIds && x.partIds[0] === motor.id && x.amount === 20), 'payment linked to the motor');
  await research(A, 'parts');
  ok(await A.locator('.pt-row', { hasText: 'Motor' }).locator('.pay-ok').count() === 1, 'and Parts shows it paid');
  await A.locator('.pt-row', { hasText: 'Motor' }).locator('.pay-ok').click(); await sleep(300);
  ok(await A.locator('#tx-amount').inputValue() === '20', 'clicking “Paid” opens that payment in Finance');
  await A.click('.rs-form button:has-text("Cancel")'); await sleep(200);

  step('Delete a budget line — type its name to confirm');
  await research(A, 'finance');
  await A.locator('.fin-del').nth(2).click(); await A.waitForSelector('.fin-del-modal');
  ok(await A.locator('#fin-del-go').isDisabled(), 'Delete is locked until the name is typed');
  await A.fill('#fin-del-confirm', 'New budget'); ok(await A.locator('#fin-del-go').isDisabled(), 'a partial name doesn’t unlock it');
  await A.fill('#fin-del-confirm', 'new budget line'); ok(!(await A.locator('#fin-del-go').isDisabled()), 'the full name unlocks it (any case)');
  await shot(A, 'delete');
  await A.click('#fin-del-go'); await sleep(400);
  ok(await A.locator('.fin-line-name').count() === 2, 'line deleted');
  ok((await history(A))[0] === 'Deleted budget line “New budget line”', 'deletion is in the history');
  await A.locator('.toast button', { hasText: 'Undo' }).click(); await sleep(400);
  ok(await A.locator('.fin-line-name').count() === 3 && (await history(A))[0].startsWith('Restored budget line'), 'Undo brings it back (and that’s logged too)');

  step('Delete a line with spending — move its spending elsewhere');
  await A.locator('.fin-line-name').nth(1).fill('Spare parts'); await A.locator('.fin-line-name').nth(1).press('Tab'); await sleep(300);
  await A.locator('.fin-del').nth(0).click(); await A.waitForSelector('.fin-del-modal');
  ok((await A.locator('.fin-del-modal').textContent()).includes('1 spending entry (£12.99) and 1 part use this line'), 'the dialog says what uses the line: ' + (await A.locator('.fin-del-modal .rs-field span').first().textContent()));
  await A.selectOption('#fin-del-target', { label: 'Spare parts' });
  await A.fill('#fin-del-confirm', 'BUDS DRONE BUDGET 2026'); await A.click('#fin-del-go'); await sleep(500);
  const b = (await team(A)).finance.budget; const spare = b.lines.find(l => l.name === 'Spare parts');
  ex = await list(A, 'expenses'); const parts = await list(A, 'parts');
  ok(!b.lines.some(l => l.name === 'BUDS DRONE BUDGET 2026') && ex.find(x => x.amount === 12.99).budgetId === spare.id && parts.find(p => p.name === 'FUSELAGE').budgetId === spare.id, 'its spending and part moved to “Spare parts”');
  ok(ex.find(x => x.amount === 20).budgetId === '' && parts.find(p => p.name === 'Motor').budgetId === '', 'other spending left alone');
  ok((await history(A))[0] === 'Deleted budget line “BUDS DRONE BUDGET 2026” (budget £1,313); moved 1 spending entry (£12.99) and 1 part to “Spare parts”', 'logged with what moved: ' + (await history(A))[0]);
  ok((await A.evaluate(() => [...document.querySelectorAll('.fin-table tr')].find(r => (r.querySelector('.fin-line-name') || {}).value === 'Spare parts')?.textContent || '')).includes('12.99'), '“Spare parts” now shows the £12.99');

  step('Members’ part changes are logged; only finance roles read the history');
  await B.bringToFront(); await research(B, 'parts');
  ok(await B.locator('.pay-btn, .pay-ok').count() === 0 && !(await B.locator('.rs-kpi', { hasText: 'Bought, not paid' }).count()), 'Tom (no finance access) sees no payment details');
  await B.click('#pt-new'); await sleep(120); await B.fill('#pt-name', 'Propellers'); await B.fill('#pt-qty', '4'); await B.fill('#pt-cost', '1.5'); await B.click('.rs-form button[type=submit]'); await sleep(500);
  const log = await list(A, 'financeLog');
  ok(log.some(e => e.text === 'Added part “Propellers” × 4 (£6.00) — Needed' && e.byName === 'Tom Reed'), 'Tom’s new part is logged under his name');
  ok(await B.evaluate(() => (window.TT && TT.team) ? true : false) && !(await B.locator('.fin-log').count()), 'Tom has no history view');
  await A.bringToFront(); await sleep(300);
  await A.selectOption('#fin-log-kind', 'parts'); await sleep(200);
  h = await history(A);
  ok(h.length && h.every(t => /part/i.test(t)) && h[0].includes('Propellers'), 'history filters to parts: ' + h.slice(0, 3).join(' | '));
  await A.selectOption('#fin-log-kind', 'all'); await sleep(200);
  ok(await A.locator('.fin-log-list li').count() === 12 && await A.locator('#fin-log-more').isVisible(), 'shows the latest 12 with “Show all”');
  await A.click('#fin-log-more'); await sleep(200);
  ok(await A.locator('.fin-log-list li').count() === log.length, 'Show all lists every entry (' + log.length + ')');
  await shot(A, 'history');
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('button:has-text("Export (.xlsx)")')]);
  ok(/Finance_.*\.xlsx$/.test(dl.suggestedFilename()), 'finance export still works (now with a History sheet)');
  ok(await A.evaluate(async () => { const r = await TT.isDemo; return r; }), 'demo mode');
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); if (SHOTS) for (const [i, p] of ctx.pages().entries()) await p.screenshot({ path: `${SHOTS}/finance-crash-${i}.png` }); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
