// OneDrive / SharePoint files attached by share link: no Microsoft sign-in or approval needed.
// Attach a file shows the "From OneDrive" steps; a pasted link is recognised, named from the link
// when it can be, and saved as a OneDrive file. Needs the preview server:  npx vite preview --port 4173
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
p.on('pageerror', e => errors.push(e.message));
const allTasks = () => p.evaluate(() => Object.values(Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0].tasks));
const atts = async (name) => ((await allTasks()).find(t => t.name === name) || {}).attachments || [];
try {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  ok(await p.locator('#auth-actions button:has-text("Continue with Microsoft")').count() === 0, 'no Microsoft button while it is switched off');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Aisha Khan'); await p.fill('#auth-actions input[type=email]', 'aisha@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.click('#demo-sample'); await p.waitForSelector('.task-card', { timeout: 20000 }); await sleep(800);
  await p.evaluate(() => document.querySelectorAll('[class*=tour-]').forEach(e => e.remove()));
  const name = (await allTasks()).find(t => !(t.attachments || []).length && t.weekId !== 'backlog' && t.flag !== 'completed').name;
  const open = async () => {
    await p.locator('.task-card', { hasText: name }).first().click(); await sleep(250);
    await p.click('#edit-form button:has-text("Attach a file or link")'); await p.waitForSelector('.modal .od-help');
  };

  step('The OneDrive steps');
  await open();
  const help = await p.textContent('.modal .od-help');
  ok(/From OneDrive or SharePoint/.test(help) && /Share/.test(help) && /Copy link/.test(help), 'steps: open, Share, Copy link, paste');
  ok(await p.locator('.modal .od-help a[href="https://www.office.com/launch/onedrive"][target=_blank]').count() === 1, 'Open OneDrive opens in a new tab');
  ok(await p.locator('.modal .od-help a[href="https://onedrive.live.com/"]').count() === 1, 'link for personal accounts');
  ok(await p.locator('.modal button:has-text("Upload to my OneDrive")').count() === 0, 'no upload button without the Microsoft app');

  step('A SharePoint link with the file name');
  await p.fill('.modal input[type=url]', 'https://uob-my.sharepoint.com/:w:/r/personal/ab_bristol_ac_uk/Documents/Drone/Test%20report%20v2.docx?d=w1&csf=1&web=1');
  await sleep(150);
  ok(await p.inputValue('.modal input[aria-label="Name"]') === 'Test report v2.docx', 'name filled in from the link');
  ok((await p.textContent('.modal .link-kind')).includes('OneDrive'), 'shown as a OneDrive / SharePoint file');
  await p.click('.modal button:has-text("Add link")'); await sleep(500);
  let a = await atts(name);
  ok(a.length === 1 && a[0].provider === 'onedrive' && a[0].name === 'Test report v2.docx', 'saved as a OneDrive file with its name');

  step('A short link: only the kind is known, and a typed name wins');
  await p.click('#edit-form button:has-text("Attach a file or link")'); await p.waitForSelector('.modal .od-help');
  await p.fill('.modal input[type=url]', 'https://1drv.ms/x/s!AbCdEfGh'); await sleep(150);
  ok(await p.inputValue('.modal input[aria-label="Name"]') === 'Excel workbook', 'kind used as a starting name');
  await p.fill('.modal input[aria-label="Name"]', 'Parts budget'); await p.click('.modal button:has-text("Add link")'); await sleep(500);
  a = await atts(name);
  ok(a.length === 2 && a[1].provider === 'onedrive' && a[1].name === 'Parts budget', 'typed name kept');

  step('Other links are unchanged');
  await p.click('#edit-form button:has-text("Attach a file or link")'); await p.waitForSelector('.modal .od-help');
  await p.fill('.modal input[type=url]', 'https://www.overleaf.com/project/abc'); await sleep(150);
  ok(await p.inputValue('.modal input[aria-label="Name"]') === '', 'no name guessed for other sites');
  await p.click('.modal button:has-text("Add link")'); await sleep(500);
  a = await atts(name);
  ok(a.length === 3 && a[2].provider === 'link' && a[2].name === 'www.overleaf.com', 'plain link named by its site');
  ok(await p.locator('#edit-form .att-item').count() === 3, 'all three listed on the task');
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
