// End-to-end test in a real browser (demo mode). Three tabs = three teammates.
//   npm run build && npx vite preview --port 4173   (in one terminal)
//   npm run test:e2e                                (in another)
import { chromium } from 'playwright';
import { editorAsOneList } from './editor-list.mjs';
import fs from 'node:fs';
import { isoWeekNumber } from '../src/model.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0; const failures = [];
const ok = (c, m) => { if (c) pass++; else { fail++; failures.push(m); console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
editorAsOneList(browser);   // the task editor as one list: these checks reach into every tab
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true });
const errors = [];
async function tab(label) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(label + ': ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(label + ': ' + m.text()); });
  p.on('dialog', d => d.accept());
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden]), #home-screen:not([hidden])');
  return p;
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tt_demo_store_v1')));
const theTeam = async (p) => Object.values((await store(p)).teams)[0];
const tasksOf = async (p) => Object.values((await theTeam(p))?.tasks || {});
async function signIn(p, name, email) {
  await p.fill('#auth-actions input[placeholder="Your name"]', name);
  await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")');
  await p.waitForSelector('#home-screen:not([hidden])');
}
async function dialog(p, value) { await p.waitForSelector('#dialog-overlay input'); await p.fill('#dialog-overlay input', value); await p.click('#dialog-overlay .dlg-ok'); await sleep(150); }
const card = (p, name) => p.locator('.task-card:not(.ghost-card)', { hasText: name }).first();
// Click a card after centring it, so the pinned week header can never cover it.
const clickCard = async (P, name, opts) => {
  await P.evaluate((n) => { const c = [...document.querySelectorAll('.task-card')].find(x => x.textContent.includes(n)); if (c) c.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); }, name);
  await P.waitForTimeout(50);
  await card(P, name).click(opts);
};
const menu = (p, t) => p.locator('#quick-menu .qm-btn, #quick-submenu .qm-btn', { hasText: t }).first();
async function rcEmpty(loc) { await loc.locator('.col-add').click({ button: 'right' }); }
const toastText = (p) => p.evaluate(() => [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent).join(' | '));

try {
  // ── 1. Owner signs in and creates a team ─────────────────────────────────
  step('Owner signs in and creates a team');
  const A = await tab('Aisha');
  ok(await A.locator('.pnt-hero-mark img').isVisible(), 'sign-in page shows the Penteint figure');
  ok((await A.textContent('#auth-actions')).includes('Demo mode'), 'demo mode is explained');
  await shot(A, '01-sign-in');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  ok((await A.textContent('#teams-list')).includes('not in any team'), 'empty state for a new user');
  await A.fill('#create-team-form input[name=name]', 'Robotics Group Project');
  await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('#board-screen:not([hidden])');
  await A.waitForSelector('.node-cat', { timeout: 5000 });
  let T = await theTeam(A);
  ok(T.doc.name === 'Robotics Group Project' && T.members[Object.keys(T.members)[0]].roleId === 'owner', 'team + owner membership created');
  ok(Object.values(T.categories).length === 1 && Object.values(T.categories)[0].name === 'GENERAL', 'starter GENERAL row created');
  ok((await A.textContent('#brand-block')).includes('Robotics Group Project'), 'team name shown on board');
  ok(T.doc.weeks.length === 1 && T.doc.weeks[0].title === 'WEEK 1' && T.doc.weeks[0].startDate, 'first week is WEEK 1 and dated');
  ok(T.doc.weekNaming === 'sequence', 'new teams use their own week numbering');

  // ── 2. Tasks via right-click ─────────────────────────────────────────────
  step('Owner adds tasks with right-click');
  await rcEmpty(A.locator('.col-week[data-cat-id]').first());
  await menu(A, 'Add task here').click(); await dialog(A, 'Literature review');
  await rcEmpty(A.locator('.col-week[data-cat-id]').first());
  await menu(A, 'Add task here').click(); await dialog(A, 'Sensor calibration');
  await A.waitForTimeout(200);
  ok((await tasksOf(A)).map(t => t.name).sort().join() === 'Literature review,Sensor calibration', 'two tasks saved to the database');
  await clickCard(A, 'Sensor calibration', { button: 'right' });
  await A.locator('#quick-menu .qm-btn', { hasText: 'Priority' }).hover(); await menu(A, 'Critical').click(); await A.waitForTimeout(150);
  ok((await tasksOf(A)).find(t => t.name === 'Sensor calibration').priority === 'Critical', 'priority set from submenu');

  // ── 3. Custom fields ─────────────────────────────────────────────────────
  step('Owner adds custom fields');
  await A.click('#top-actions button:has-text("Settings")');
  await A.click('.settings-nav button:has-text("Fields")');
  await A.click('.settings-pane button:has-text("Add field")');
  await A.fill('.field-row >> nth=0 >> input[aria-label="Field name"]', 'Supervisor');
  await A.locator('.field-row').nth(0).locator('input[type=checkbox]').check();
  await A.click('.settings-pane button:has-text("Add field")');
  await A.fill('.field-row >> nth=1 >> input[aria-label="Field name"]', 'Budget (£)');
  await A.selectOption('.field-row >> nth=1 >> select', 'number');
  await A.locator('.field-row').filter({ hasText: 'Reference ID' }).locator('input.inp').fill('Module code');
  await A.click('.settings-pane button:has-text("Save fields")'); await A.waitForTimeout(200);
  T = await theTeam(A);
  ok(T.doc.fields.length === 2 && T.doc.fields[0].showOnCard && T.doc.fields[1].type === 'number', 'fields saved with type + card setting');
  ok(T.doc.labels.jiraId.label === 'Module code', 'built-in label renamed');
  await shot(A, '02-settings-fields');
  await A.keyboard.press('Escape');
  await clickCard(A, 'Literature review');
  await A.waitForSelector('#edit-form [data-field-id]');
  const sup = A.locator('#edit-form input[data-field-id]').first();
  await sup.fill('Dr. Lee'); await sup.press('Tab'); await A.waitForTimeout(200);
  ok((await tasksOf(A)).find(t => t.name === 'Literature review').custom[T.doc.fields[0].id] === 'Dr. Lee', 'custom field value saved');
  ok((await card(A, 'Literature review').textContent()).includes('Supervisor: Dr. Lee'), 'custom field shown on the card');
  ok((await A.textContent('#edit-form')).includes('Module code'), 'renamed label used in the editor');
  await A.click('#edit-form .icon-pick:has-text("🤖")'); await A.waitForTimeout(150);
  ok((await tasksOf(A)).find(t => t.name === 'Literature review').icon === '🤖', 'task icon saved');

  // ── 4. Invite two people ─────────────────────────────────────────────────
  step('Owner invites a member and a viewer');
  await A.click('#top-actions button:has-text("Invite")');
  await A.fill('.settings-pane textarea', 'tom@uni.ac.uk');
  await A.click('.settings-pane button:has-text("Invite")'); await A.waitForTimeout(200);
  await A.waitForTimeout(300); const sp = await A.textContent('.settings-pane'); ok(sp.includes('Invitation emailed to tom@uni.ac.uk'), 'the server emails the invitation: ' + sp.slice(0, 400));
  await A.waitForSelector('.settings-pane .inv-sent'); ok(true, 'delivery shown as Emailed');
  await A.click('.settings-pane summary:has-text("Send it yourself")'); await A.waitForTimeout(150);
  ok((await A.textContent('.settings-pane')).includes('Invitation saved for tom@uni.ac.uk'), 'share box still available (folded away)');
  // Every email option must open in a NEW tab so the app (and this dialog) stays open.
  const mailLinks = await A.$$eval('.settings-pane a.btn', as => as.map(a => ({ text: a.textContent, href: a.href, target: a.target, rel: a.rel })));
  ok(['Gmail', 'Outlook', 'Other email app'].every(t => mailLinks.some(l => l.text === t)), 'Gmail, Outlook and other-app buttons shown');
  ok(mailLinks.every(l => l.target === '_blank' && l.rel.includes('noopener')), 'all email links open in a new tab');
  const gmail = new URL(mailLinks.find(l => l.text === 'Gmail').href);
  ok(gmail.hostname === 'mail.google.com' && gmail.searchParams.get('to') === 'tom@uni.ac.uk' && gmail.searchParams.get('su').startsWith('Join Robotics Group Project') && gmail.searchParams.get('body').includes('Join team'), 'Gmail link pre-fills recipient, subject and message');
  const [gtab] = await Promise.all([ctx.waitForEvent('page'), A.click('.settings-pane a.btn:has-text("Gmail")')]);
  await gtab.close();
  ok(await A.locator('.settings-pane').isVisible() && (await A.textContent('.settings-pane')).includes('Invitation saved'), 'after Gmail opens, the invite dialog is still open');
  await A.fill('.settings-pane textarea', 'priya@uni.ac.uk, not-an-email');
  await A.click('.settings-pane button:has-text("Invite")'); await A.waitForTimeout(150);
  ok((await toastText(A)).includes('Check these addresses'), 'invalid email rejected');
  await A.fill('.settings-pane textarea', 'priya@uni.ac.uk');
  await A.locator('.settings-pane form select').selectOption('viewer');
  await A.click('.settings-pane button:has-text("Invite")'); await A.waitForTimeout(200);
  T = await theTeam(A);
  ok(T.invites['tom@uni.ac.uk']?.roleId === 'member' && T.invites['priya@uni.ac.uk']?.roleId === 'viewer', 'invitations stored with roles');
  await shot(A, '03-members');
  await A.keyboard.press('Escape');

  // ── 5. Member joins in a second tab ──────────────────────────────────────
  step('Member joins from a second tab');
  const B = await tab('Tom');
  await signIn(B, 'Tom Reed', 'tom@uni.ac.uk');
  await B.waitForSelector('#invites-section:not([hidden])');
  ok((await B.textContent('#invites-list')).includes('Aisha Khan invited you to Robotics Group Project'), 'invitation visible to invitee');
  await shot(B, '04-invitation');
  await B.click('#invites-list button:has-text("Join team")');
  await B.waitForSelector('#board-screen:not([hidden])'); await B.waitForTimeout(500);
  T = await theTeam(B);
  const tomUid = Object.values(T.members).find(m => m.email === 'tom@uni.ac.uk').uid;
  ok(T.members[tomUid].roleId === 'member' && !T.invites['tom@uni.ac.uk'], 'joined as member; invitation consumed');
  ok(Object.values(T.categories).some(c => c.ownerUid === tomUid), 'member gets a starter row');
  ok(await card(B, 'Literature review').isVisible(), 'member sees the owner’s tasks');

  step('Member cannot edit the owner’s task, can edit their own');
  await clickCard(B, 'Literature review');
  ok((await B.textContent('#edit-form')).includes('View only'), 'editor is read-only for someone else’s task');
  ok(await B.locator('#edit-form textarea#edit-name').isDisabled(), 'title field disabled');
  await clickCard(B, 'Literature review', { button: 'right' });
  ok((await B.textContent('#quick-menu')).includes('view only'), 'right-click menu is view-only');
  await B.keyboard.press('Escape');
  const tomCol = B.locator(`.col-week[data-person-id="${tomUid}"]`).first();
  await rcEmpty(tomCol);
  await menu(B, 'Add task here').click(); await dialog(B, 'Motor driver test');
  await B.waitForTimeout(250);
  ok((await tasksOf(B)).some(t => t.name === 'Motor driver test' && t.ownerUid === tomUid), 'member created a task in their own row');

  step('Live update reaches the owner’s tab without reloading');
  await A.waitForTimeout(400);
  ok(await card(A, 'Motor driver test').isVisible(), 'owner sees the member’s new task live');

  step('Member drags their task into the owner’s row → refused and reverted');
  const ownerCol = B.locator('.col-week[data-cat-id]').filter({ has: B.locator('.task-card', { hasText: 'Literature review' }) }).first();
  await card(B, 'Motor driver test').dragTo(ownerCol); await B.waitForTimeout(300);
  ok((await toastText(B)).includes('don’t have permission'), 'permission toast shown');
  ok((await tasksOf(B)).find(t => t.name === 'Motor driver test').ownerUid === tomUid, 'task stayed in the member’s row (database)');
  ok(await B.locator(`.col-week[data-person-id="${tomUid}"] .task-card`, { hasText: 'Motor driver test' }).count() === 1, 'board reverted to the member’s row');

  step('Undo only reverts your own change');
  await clickCard(A, 'Sensor calibration');
  await A.fill('#edit-form textarea#edit-name', 'Sensor calibration v2'); await A.locator('#edit-form textarea#edit-name').press('Tab'); await A.waitForTimeout(200);
  ok((await tasksOf(A)).some(t => t.name === 'Sensor calibration v2'), 'owner renamed a task');
  await A.click('#nodes-container', { position: { x: 5, y: 5 } }).catch(() => {});
  await A.keyboard.press('Control+z'); await A.waitForTimeout(250);
  const names = (await tasksOf(A)).map(t => t.name);
  ok(names.includes('Sensor calibration') && !names.includes('Sensor calibration v2'), 'undo reverted the rename');
  ok(names.includes('Motor driver test'), 'undo did not touch the teammate’s task');

  // ── 6. Viewer ────────────────────────────────────────────────────────────
  step('Viewer joins and can only look');
  const C = await tab('Priya');
  await signIn(C, 'Priya Shah', 'priya@uni.ac.uk');
  await C.waitForSelector('#invites-list button:has-text("Join team")'); await C.click('#invites-list button:has-text("Join team")');
  await C.waitForSelector('#board-screen:not([hidden])'); await C.waitForTimeout(400);
  T = await theTeam(C);
  const priyaUid = Object.values(T.members).find(m => m.email === 'priya@uni.ac.uk').uid;
  ok(!Object.values(T.categories).some(c => c.ownerUid === priyaUid), 'viewer gets no row');
  ok(!(await C.locator('.btn-add-week').isVisible()), 'viewer cannot see Add Week');
  ok(!(await C.locator('#top-actions button:has-text("AI summary")').isVisible()), 'viewer cannot export / AI');
  ok(await C.locator('#top-actions button:has-text("Analytics")').isVisible(), 'viewer can open analytics');
  await clickCard(C, 'Motor driver test', { button: 'right' });
  ok((await C.textContent('#quick-menu')).includes('view only'), 'viewer gets view-only menu');
  await C.keyboard.press('Escape');

  // ── 7. Role change takes effect live ─────────────────────────────────────
  step('Owner changes the member to viewer → their editing stops');
  await A.click('#top-actions button:has-text("Settings")'); await A.click('.settings-nav button:has-text("Members")');
  const tomRow = A.locator('.settings-pane tr', { hasText: 'tom@uni.ac.uk' });
  await tomRow.locator('select').selectOption('viewer'); await A.waitForTimeout(300);
  ok((await theTeam(A)).members[tomUid].roleId === 'viewer', 'role changed in the database');
  await A.keyboard.press('Escape'); await B.waitForTimeout(400);
  await clickCard(B, 'Motor driver test', { button: 'right' });
  ok((await B.textContent('#quick-menu')).includes('view only'), 'demoted member now gets view-only menu');
  await B.keyboard.press('Escape');

  // ── 8. AI summary prompt ─────────────────────────────────────────────────
  step('AI summary builds a prompt from the board');
  await A.click('#top-actions button:has-text("AI summary")');
  const prompt = await A.inputValue('.ai-prompt');
  ok(prompt.includes('Literature review') && prompt.includes('Motor driver test') && prompt.includes('Supervisor: Dr. Lee'), 'prompt includes tasks + custom fields');
  ok(prompt.includes('Aisha Khan'), 'prompt names people by default');
  await A.locator('label:has-text("Hide people’s names") input').check();
  const anon = await A.inputValue('.ai-prompt');
  ok(!anon.includes('Aisha Khan') && !anon.includes('Tom Reed') && anon.includes('Person A'), 'anonymise replaces names');
  ok(await A.locator('.chatbots a:has-text("ChatGPT")').count() === 1, 'chatbot links offered');
  await shot(A, '05-ai');
  await A.keyboard.press('Escape');

  // ── 9. Import from Excel ─────────────────────────────────────────────────
  step('Import tasks from an Excel sheet');
  const xlsxB64 = await A.evaluate(async () => {
    await window.ensureXLSX();   // SheetJS now loads on demand, not at board load
    const rows = [['Owner', 'Category', 'Week', 'Task', 'Priority', 'Deadline', 'Supervisor'],
      ['tom@uni.ac.uk', 'HARDWARE', 'WEEK 99', 'Solder encoder board', 'high', '20/11/2026', 'Dr. Lee'],
      ['Aisha Khan', 'GENERAL', '', 'Write intro', 'low', '', ''],
      ['ghost@nowhere.com', 'MISC', '', 'Unknown person task', 'Major', '', ''],
      ['', '', '', '', '', '', '']];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Tasks');
    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  });
  fs.writeFileSync('/tmp/tt-import.xlsx', Buffer.from(xlsxB64, 'base64'));
  if (await A.locator('#editor-panel .ed-back').isVisible()) await A.click('#editor-panel .ed-back');   // back from the task to Search & filters
  const [chooser] = await Promise.all([A.waitForEvent('filechooser'), A.click('#team-data-actions button:has-text("Import tasks")').then(() => A.click('#imp-choose'))]);
  await chooser.setFiles('/tmp/tt-import.xlsx');
  await A.waitForSelector('.modal:has-text("Import from")');
  const preview = await A.textContent('.modal');
  ok(/3\s*tasks will be added/.test(preview) && preview.includes('ghost@nowhere.com'), 'preview counts rows and flags unknown owners');
  await A.click('.modal button:has-text("Import 3 tasks")'); await A.waitForTimeout(300);
  const imp = await tasksOf(A); T = await theTeam(A);
  const solder = imp.find(t => t.name === 'Solder encoder board');
  ok(solder && solder.ownerUid === tomUid && solder.priority === 'Critical' && solder.dueDate === '2026-11-20', 'row mapped: owner by email, priority word, UK date');
  ok(solder && solder.custom[T.doc.fields[0].id] === 'Dr. Lee', 'custom field imported by column name');
  ok(T.doc.weeks.some(w => w.title === 'WEEK 99'), 'missing week created');
  ok(Object.values(T.categories).some(c => c.name === 'ghost@nowhere.com – MISC'), 'unknown owner’s task kept in importer’s rows');

  // ── 10. Exports ──────────────────────────────────────────────────────────
  step('Excel report and analytics');
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('#team-data-actions button:has-text("Download Excel report")')]);
  ok(/^Robotics_Group_Project_Tracker_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), 'Excel report downloaded: ' + dl.suggestedFilename());
  await A.click('#top-actions button:has-text("Analytics")'); await A.waitForSelector('.an-kpis');
  const total = await A.locator('.an-kpi').first().locator('.an-kpi-v').textContent();
  ok(Number(total) === (await tasksOf(A)).length, 'analytics total matches database (' + total + ')');
  await shot(A, '06-analytics');
  await A.keyboard.press('Escape');

  // ── 11. Logo ─────────────────────────────────────────────────────────────
  step('Team logo upload');
  const png = await A.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 300; const g = c.getContext('2d'); g.fillStyle = '#4299e1'; g.fillRect(0, 0, 600, 300); g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.fillText('RGP', 120, 200); return c.toDataURL('image/png').split(',')[1]; });
  fs.writeFileSync('/tmp/tt-logo.png', Buffer.from(png, 'base64'));
  await A.click('#top-actions button:has-text("Settings")');
  const [lc] = await Promise.all([A.waitForEvent('filechooser'), A.click('.settings-pane button:has-text("Upload logo")')]);
  await lc.setFiles('/tmp/tt-logo.png'); await A.waitForTimeout(500);
  T = await theTeam(A);
  ok(T.doc.logo.startsWith('data:image/') && T.doc.logo.length < 200000, 'logo resized and stored (' + T.doc.logo.length + ' chars)');
  await A.keyboard.press('Escape'); await A.waitForTimeout(200);
  ok(await A.locator('#brand-block img.brand-logo-img').count() === 1, 'logo shown on the board');
  await shot(A, '07-board');

  // ── 11b. Week numbering ──────────────────────────────────────────────────
  step('Week numbering: own numbering by default, switch to calendar weeks and back');
  const weekNums = (ws) => ws.map(w => /^WEEK (\d+)$/.exec(w.title)).filter(Boolean).map(m => +m[1]);
  let before = (await theTeam(A)).doc.weeks;
  await A.click('.btn-add-week'); await A.waitForTimeout(300);
  await A.evaluate(() => showEverything()); await A.waitForTimeout(200);   // adding a week hides older ones; show all again
  let W = (await theTeam(A)).doc.weeks;
  ok(W.length === before.length + 1 && W.at(-1).title === 'WEEK ' + (Math.max(0, ...weekNums(before)) + 1), 'new week continues own numbering: ' + W.at(-1).title);
  await A.click('#top-actions button:has-text("Settings")');
  ok(await A.locator('.settings-pane input[name=week-naming][value=sequence]').isChecked(), 'settings show own numbering selected');
  await A.click('.settings-pane label.radio-card:has-text("Calendar weeks")'); await A.waitForTimeout(300);
  ok((await theTeam(A)).doc.weekNaming === 'calendar', 'switched to calendar weeks');
  await A.click('.settings-pane button:has-text("Rename existing weeks")'); await A.waitForTimeout(300);
  W = (await theTeam(A)).doc.weeks;
  ok(W.every(w => !w.startDate || w.title === 'WEEK ' + isoWeekNumber(w.startDate)), 'existing weeks renamed to calendar week numbers: ' + W.map(w => w.title).join(', '));
  await A.click('.settings-pane label.radio-card:has-text("Own numbering")'); await A.waitForTimeout(300);
  await A.click('.settings-pane button:has-text("Rename existing weeks")'); await A.waitForTimeout(300);
  W = (await theTeam(A)).doc.weeks;
  ok(W.every((w, i) => w.title === 'WEEK ' + (i + 1)), 'renamed back to WEEK 1…' + W.length);
  await A.keyboard.press('Escape'); await A.waitForTimeout(200);

  // ── 11c. Account photo ───────────────────────────────────────────────────
  step('Account photo shows on your account and on teammates’ boards');
  const aishaUid = Object.values((await theTeam(A)).members).find(m => m.email === 'aisha@uni.ac.uk').uid;
  await A.locator('.account-chip:visible').first().click();
  await A.waitForSelector('.modal[aria-label="Your account"]');
  const [pc] = await Promise.all([A.waitForEvent('filechooser'), A.click('button:has-text("Upload photo")')]);
  await pc.setFiles('/tmp/tt-logo.png'); await A.waitForTimeout(500);
  const photo = (await theTeam(A)).members[aishaUid].photo;
  ok(photo.startsWith('data:image/') && photo.length <= 56000, 'photo resized and saved on the membership (' + photo.length + ' chars)');
  ok((await store(A)).users[aishaUid].photo === photo, 'photo saved on the account');
  ok(await A.locator('.account-photo img').count() === 1 && await A.locator('button:has-text("Remove photo")').isVisible(), 'account dialog shows the photo and a Remove button');
  await A.keyboard.press('Escape'); await A.waitForTimeout(200);
  ok(await A.locator('.account-chip:visible .chip-avatar img').count() >= 1, 'top-bar account button shows the photo');
  await B.waitForTimeout(600);
  ok(await B.locator('.node-person img.person-photo').count() >= 1, 'teammate sees the photo on the board');
  await A.locator('.account-chip:visible').first().click(); await A.click('button:has-text("Remove photo")'); await A.waitForTimeout(400);
  ok((await theTeam(A)).members[aishaUid].photo === '', 'photo removed');
  await A.keyboard.press('Escape'); await A.waitForTimeout(200);

  // ── 11d. Timeline shows days remaining ───────────────────────────────────
  step('Timeline shows days remaining');
  const isoIn = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  await clickCard(A, 'Write intro'); await A.waitForSelector('#edit-due');
  await A.fill('#edit-due', isoIn(3)); await A.locator('#edit-due').dispatchEvent('change'); await A.waitForTimeout(300);
  const dueText = await A.textContent('#edit-form .due-display');
  ok(/^📅\w{3} \d{1,2} \w{3} \d{4}3 days left$/.test(dueText.replace(/\s+/g, '')) || (dueText.includes('3 days left') && /\d{4}/.test(dueText)), 'deadline shown as a readable date with days left: ' + dueText.trim());
  ok(await A.evaluate(() => [...document.querySelectorAll('.editor-toggles .top-btn')].every(b => b.getBoundingClientRect().height < 40)), 'editor header buttons stay on one line');
  await A.click('#top-actions button:has-text("Analytics")'); await A.click('.an-tab[data-tab="timeline"]'); await A.waitForTimeout(300);
  const row = A.locator('.gt-row', { has: A.locator('.gt-label', { hasText: 'Write intro' }) }).first();
  ok((await row.locator('.gt-left').textContent()) === '3d', 'task column pill says 3d');
  ok((await row.locator('.gt-due').textContent()).includes('3 days left'), 'label after the bar says 3 days left');
  ok(await A.locator('.gt-axis .gt-left-h:has-text("Days left")').count() === 1, 'timeline header has a Days left column');
  await shot(A, '06b-timeline');
  await A.keyboard.press('Escape'); await A.waitForTimeout(200);

  // ── 11e. Sub-tasks and their history log ─────────────────────────────────
  step('Sub-tasks: add, tick, rename, delete — saved and logged');
  const subTask = async () => (await tasksOf(A)).find(t => t.name === 'Write intro');
  await clickCard(A, 'Write intro'); await A.waitForSelector('#edit-form');
  for (const n of ['Outline', 'Draft']) { await A.click('#edit-form button:has-text("Add Subtask")'); await dialog(A, n); }
  let st = await subTask();
  ok(st.subtasks.map(x => x.title).join() === 'Outline,Draft', 'sub-tasks saved: ' + st.subtasks.map(x => x.title).join());
  await card(A, 'Write intro').locator('.subtask-item', { hasText: 'Outline' }).click(); await A.waitForTimeout(300);
  st = await subTask(); ok(st.subtasks[0].completed === true, 'ticking on the card is saved');
  ok((await card(A, 'Write intro').locator('.progress-text').textContent()) === '50%', 'card progress updates to 50%');
  await clickCard(A, 'Write intro'); await A.waitForSelector('#edit-form');
  const draftBox = A.locator('#edit-form input[type=text][value="Draft"]'); await draftBox.fill('First draft'); await draftBox.press('Tab'); await A.waitForTimeout(300);
  await A.locator('#edit-form button.st-del').first().click(); await A.waitForTimeout(300);
  st = await subTask();
  ok(st.subtasks.map(x => x.title).join() === 'First draft', 'rename and delete saved');
  const fields = st.history.slice(0, 5).map(h => h.field);
  ok(['Sub-task deleted', 'Sub-task renamed', 'Sub-task completed', 'Sub-task added'].every(f => fields.includes(f)), 'each change is in the history log: ' + fields.join(', '));
  ok((await A.textContent('.history-box')).includes('Draft → First draft') || (await A.textContent('.history-box')).replace(/\s+/g, ' ').includes('Draft → First draft'), 'log reads "Sub-task renamed: Draft → First draft"');
  await A.keyboard.press('Escape');

  // ── 12. Hostile text stays text ──────────────────────────────────────────
  step('Hostile names and titles are rendered as text');
  await clickCard(A, 'Write intro');
  await A.fill('#edit-form textarea#edit-name', '<img src=x onerror="window.__pwned=1">'); await A.locator('#edit-form textarea#edit-name').press('Tab'); await A.waitForTimeout(250);
  ok(await A.evaluate(() => !window.__pwned && !document.querySelector('#nodes-container img[src="x"]')), 'no injected markup ran');

  // ── 13. Remove a member, delete the team ─────────────────────────────────
  step('Owner removes the viewer → viewer is sent home');
  await A.click('#top-actions button:has-text("Settings")'); await A.click('.settings-nav button:has-text("Members")');
  await A.locator('.settings-pane tr', { hasText: 'priya@uni.ac.uk' }).locator('button:has-text("Remove")').click(); await A.waitForTimeout(400);
  ok(!(await theTeam(A)).members[priyaUid], 'member removed');
  await C.waitForSelector('#home-screen:not([hidden])', { timeout: 4000 }).catch(() => {});
  ok(await C.locator('#home-screen').isVisible(), 'removed member’s tab returned to the team list');

  step('Owner deletes the team');
  await A.click('.settings-nav button:has-text("Delete team")');
  await A.fill('.settings-pane input[aria-label="Type the team name to confirm"]', 'Robotics Group Project');
  await A.click('.settings-pane button:has-text("Delete this team forever")'); await A.waitForTimeout(400);
  ok(Object.keys((await store(A)).teams).length === 0, 'team and all its data deleted');
  ok(await A.locator('#home-screen').isVisible(), 'owner back on team list');
  await B.waitForSelector('#home-screen:not([hidden])', { timeout: 4000 }).catch(() => {});
  ok(await B.locator('#home-screen').isVisible(), 'other member’s tab returned home too');

  // ── 14. Layout ───────────────────────────────────────────────────────────
  step('Layout: no overlaps, phone width');
  for (const w of [1360, 900, 390]) {
    await A.setViewportSize({ width: w, height: 800 }); await A.waitForTimeout(150);
    const over = await A.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `no horizontal scroll on team list at ${w}px (overflow ${over})`);
  }
} catch (e) {
  fail++; failures.push('CRASH: ' + e.message); console.log('CRASH', e);
} finally {
  const real = errors.filter(e => !/accounts\.google\.com|favicon/.test(e));
  ok(real.length === 0, 'no page errors: ' + real.join(' || '));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log('Failures:\n - ' + failures.join('\n - '));
  await browser.close();
  process.exit(fail ? 1 : 0);
}
