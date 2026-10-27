// File health: Drive / OneDrive files linked to tasks show whether they still open; broken ones get
// a note with fixes (request access, re-link); the card's 📎 chip turns red; Settings lists them all.
// The checks themselves need a real Google / Microsoft sign-in, so results are seeded on the device.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';
import { editorAsOneList } from './editor-list.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
editorAsOneList(browser);   // the task editor as one list: these checks reach into every tab
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
// No real Google / Microsoft calls in tests
await p.route(/googleapis\.com|graph\.microsoft\.com|accounts\.google\.com|login\.microsoftonline\.com/, r => r.abort());
const GD = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view';
const OD = 'https://contoso.sharepoint.com/:w:/r/personal/leo/report.docx';
const team = () => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams).find(t => t.doc && t.doc.name === 'Files Lab'));

try {
  step('A task with a Drive file, a OneDrive file and a plain link');
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Aisha Khan'); await p.fill('#auth-actions input[type=email]', 'aisha@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.fill('#create-team-form input[name=name]', 'Files Lab');
  await p.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; });
  await p.click('#create-team-form button[type=submit]'); await p.waitForSelector('.node-cat'); await sleep(400);
  await p.evaluate(([GD, OD]) => {
    const c = db.find(x => x.id === TT.me.uid).categories[0];
    c[weeksData[0].key] = [{ id: 'tF', type: 'task', name: 'Test report', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [], attachments: [
      { id: 'a1', provider: 'gdrive', name: 'Wing CAD', url: GD, size: 0, addedBy: 'Leo Martins', addedAt: 1 },
      { id: 'a2', provider: 'onedrive', name: 'Test report', url: OD, size: 0, addedBy: 'Leo Martins', addedAt: 1 },
      { id: 'a3', provider: 'link', name: 'Supplier page', url: 'https://example.com/part', size: 0, addedBy: 'Aisha Khan', addedAt: 1 },
    ] }];
    saveDatabase(); render();
  }, [GD, OD]);
  await sleep(600);
  ok(await p.locator('.task-card .att-chip', { hasText: '3 files' }).count() === 1, 'the card shows 3 files');
  ok(!(await p.locator('.att-chip.att-broken').count()), 'nothing flagged before any check');

  step('What this device found: the Drive file is broken, the OneDrive one is in a personal drive');
  await p.evaluate(([GD, OD]) => localStorage.setItem('tt_fh_v1', JSON.stringify({
    [GD]: { state: 'broken', why: 'You don’t have access to it any more.', at: Date.now() },
    [OD]: { state: 'personal', why: 'It’s in Leo’s own OneDrive.', owner: 'Leo', at: Date.now() },
  })), [GD, OD]);
  await p.reload(); await p.waitForSelector('.task-card', { timeout: 20000 }); await sleep(800);
  ok(await p.locator('.task-card .att-chip.att-broken', { hasText: '1 can’t be opened' }).count() === 1, 'the card’s 📎 chip warns about the broken file');

  step('In the task: pills, a note with fixes');
  await p.evaluate(() => window.boardOpenTask('tF')); await p.waitForSelector('.att-item'); await sleep(400);
  const gd = p.locator('.att-item', { hasText: 'Wing CAD' });
  ok(await gd.locator('.fh-pill.fh-broken').count() === 1, 'Drive file marked “Access lost”');
  ok(await p.locator('.fh-note', { hasText: 'Ask Leo Martins to share it again' }).count() === 1, 'the note says who to ask');
  ok(await p.locator('.fh-note a', { hasText: 'Request access' }).getAttribute('href') === GD, 'Request access opens the file');
  ok(await p.locator('.att-item', { hasText: 'Test report' }).locator('.fh-pill.fh-personal').count() === 1, 'OneDrive file marked “Personal drive”');
  ok(await p.locator('.att-item', { hasText: 'Supplier page' }).locator('.fh-pill').count() === 0, 'plain links aren’t judged');
  ok(await p.locator('.fh-check').count() === 1, 'a button to check the files again');
  if (process.env.SHOTS) { await p.locator('.att-list').scrollIntoViewIfNeeded(); await p.locator('.att-list').locator('..').screenshot({ path: process.env.SHOTS + '/filehealth-editor.png' }); }

  step('Re-linking the broken file');
  await p.click('.fh-note button:has-text("Re-link")'); await p.waitForSelector('#dialog-overlay:not([hidden]) input, .dialog input');
  await p.keyboard.type('https://drive.google.com/file/d/1NewNewNewNewNewNew/view'); await p.keyboard.press('Enter'); await sleep(600);
  const att = Object.values((await team()).tasks).find(t => t.name === 'Test report').attachments.find(a => a.name === 'Wing CAD');
  ok(att.url.includes('1NewNewNewNewNewNew'), 'the new link is saved');
  ok(await p.locator('.fh-note').count() === 0, 'the warning is gone');
  ok(!(await p.locator('.att-chip.att-broken').count()), 'the card is no longer flagged');

  step('Settings ▸ Integrations lists every file and its status');
  await p.evaluate(() => TT.openSettings('integrations')); await p.waitForSelector('#fh-settings');
  ok(await p.locator('#fh-settings tr').count() === 3, 'a row per Drive / OneDrive file (header + 2)');
  ok(await p.locator('#fh-settings .fh-pill.fh-personal').count() === 1, 'the personal-drive file is flagged');
  ok((await p.locator('#fh-settings').textContent()).includes('in someone’s own drive'), 'a summary line');
  ok(await p.locator('#fh-check-all').count() === 1, 'a button to check them all');
  if (process.env.SHOTS) { await p.locator('#fh-settings').scrollIntoViewIfNeeded(); await p.locator('#fh-settings').screenshot({ path: process.env.SHOTS + '/filehealth-settings.png' }); }
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
