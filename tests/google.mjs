// Calendar export and the Google integrations, against a stand-in for Google's servers
// (nothing is sent to Google). Builds a copy of the site with a test Google client ID and
// serves it on port 4174, then checks: the calendar dialog, .ics downloads, Google
// Calendar sync (add / update / remove / no duplicates on a second device), Drive upload
// and Sheets export.   Run:  node tests/google.mjs
import { chromium } from 'playwright';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 4174, BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];

execSync('npx vite build --outDir dist-google --emptyOutDir', { stdio: 'ignore', env: { ...process.env, VITE_GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com' } });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-google', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch { /* starting */ } await sleep(250); }

// ── The stand-in Google ─────────────────────────────────────────────────────
const G = { calendars: {}, nextId: 1, scopes: [], sheets: [], drive: { folders: [], files: [], perms: [] }, calls: [] };
const id = (p) => p + (G.nextId++);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'Location' };
const reply = (route, status, body, headers = {}) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...headers }, body: body === null ? '' : JSON.stringify(body) });
const GIS = `window.google = { accounts: { oauth2: {
  initTokenClient: (cfg) => ({ requestAccessToken: (o) => { (window.__gisScopes = window.__gisScopes || []).push(cfg.scope); (window.__gisAsks = window.__gisAsks || []).push({ scope: cfg.scope, prompt: o && o.prompt, hint: cfg.login_hint }); setTimeout(() => cfg.callback({ access_token: 'tok-' + cfg.scope.split('/').pop(), expires_in: 3600, scope: cfg.scope }), 10); } }),
  hasGrantedAllScopes: () => true } } };`;

async function google(route) {
  const req = route.request(); const u = new URL(req.url()); const m = req.method(); const path = u.pathname;
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch { return req.postData(); } })() : null;
  G.calls.push(m + ' ' + path);
  // Calendar
  let r;
  if ((r = path.match(/^\/calendar\/v3\/calendars$/)) && m === 'POST') { const cid = id('cal') + '@group.calendar.google.com'; G.calendars[cid] = { summary: body.summary, description: body.description, events: {} }; return reply(route, 200, { id: cid, ...G.calendars[cid] }); }
  if (G.denyLookups && m === 'GET' && (path === '/calendar/v3/users/me/calendarList' || /^\/calendar\/v3\/calendars\/[^/]+$/.test(path))) return reply(route, 403, { error: { message: 'Insufficient Permission' } });
  if (path === '/calendar/v3/users/me/calendarList') return reply(route, 200, { items: Object.entries(G.calendars).map(([cid, c]) => ({ id: cid, summary: c.summary, description: c.description, accessRole: 'owner' })) });
  if ((r = path.match(/^\/calendar\/v3\/calendars\/([^/]+)$/))) { const c = G.calendars[decodeURIComponent(r[1])]; return c ? reply(route, 200, { id: decodeURIComponent(r[1]), summary: c.summary }) : reply(route, 404, { error: { message: 'Not Found' } }); }
  if ((r = path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/))) {
    const c = G.calendars[decodeURIComponent(r[1])]; if (!c) return reply(route, 404, { error: { message: 'Not Found' } });
    const eid = r[2] && decodeURIComponent(r[2]);
    if (m === 'GET') { const [k, v] = (u.searchParams.get('privateExtendedProperty') || '=').split('='); return reply(route, 200, { items: Object.values(c.events).filter(e => !k || (e.extendedProperties.private[k] === v)) }); }
    if (m === 'POST') { const e = { ...body, id: id('ev') }; c.events[e.id] = e; return reply(route, 200, e); }
    if (m === 'PATCH') { c.events[eid] = { ...c.events[eid], ...body }; return reply(route, 200, c.events[eid]); }
    if (m === 'DELETE') { delete c.events[eid]; return reply(route, 204, null); }
  }
  // Drive
  if (path === '/drive/v3/files' && m === 'GET') return reply(route, 200, { files: G.drive.folders.filter(f => (u.searchParams.get('q') || '').includes(f.appProperties.ttTeam)) });
  if (path === '/drive/v3/files' && m === 'POST') { const f = { id: id('folder'), ...body }; G.drive.folders.push(f); return reply(route, 200, { id: f.id }); }
  if (path === '/upload/drive/v3/files' && m === 'POST') { G.drive.pending = body; return reply(route, 200, {}, { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=up1' }); }
  if (path === '/upload/drive/v3/files' && m === 'PUT') { const f = { id: id('file'), name: G.drive.pending.name, parents: G.drive.pending.parents, size: String((req.postDataBuffer() || []).length) }; G.drive.files.push(f); return reply(route, 200, { ...f, webViewLink: 'https://drive.google.com/file/d/' + f.id + '/view' }); }
  if ((r = path.match(/^\/drive\/v3\/files\/([^/]+)\/permissions$/))) { G.drive.perms.push({ file: r[1], ...body }); return reply(route, 200, { id: id('perm') }); }
  // Sheets
  if (path === '/v4/spreadsheets' && m === 'POST') { const s = { id: id('sheet'), title: body.properties.title, tabs: body.sheets.map(x => x.properties.title), data: {} }; G.sheets.push(s); return reply(route, 200, { spreadsheetId: s.id, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + s.id }); }
  if ((r = path.match(/^\/v4\/spreadsheets\/([^/]+)\/values:batchUpdate$/))) { const s = G.sheets.find(x => x.id === r[1]); body.data.forEach(d => { s.data[d.range] = d.values; }); return reply(route, 200, {}); }
  if ((r = path.match(/^\/v4\/spreadsheets\/([^/:]+)\/values:batchClear$/))) return reply(route, 200, {});
  return reply(route, 404, { error: { message: 'stand-in: unhandled ' + m + ' ' + path } });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
async function newPage(ctx, label) {
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept());
  await p.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: GIS }));
  await p.route(/https:\/\/(www|sheets)\.googleapis\.com\/.*/, google);
  return p;
}
const calEvents = () => Object.values(Object.values(G.calendars)[0]?.events || {});
const iso = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };

try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true });
  const p = await newPage(ctx, 'owner');
  step('Set up a team with deadlines and phases');
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Rushi Vibhandik'); await p.fill('#auth-actions input[type=email]', 'rushi@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.fill('#create-team-form input[name=name]', 'Robot Science'); await p.click('#create-team-form button[type=submit]');
  await p.waitForSelector('.node-cat'); await sleep(300);
  await p.evaluate(async ([a, b, c, d]) => {
    await TT.writeOps([{ type: 'update', path: 'team', data: { phases: [{ id: 'ph1', name: 'Design', color: '#9f7aea', start: a, end: b, milestone: 'Design review' }, { id: 'ph2', name: 'Build', color: '#ed8936', start: '', end: '', milestone: '' }] } }]);
    const me = db.find(x => x.id === TT.me.uid); const cat = me.categories[0]; const wk = weeksData[0].key;
    cat[wk] = [{ id: 'tA', type: 'task', name: 'CAD gripper', priority: 'Major', status: '', flag: 'none', dueDate: c, phaseId: 'ph1', subtasks: [], history: [] },
      { id: 'tB', type: 'task', name: 'Order servos', priority: 'Minor', status: '', flag: 'none', dueDate: d, subtasks: [], history: [] },
      { id: 'tC', type: 'task', name: 'Old report', priority: 'Minor', status: '', flag: 'completed', dueDate: a, subtasks: [], history: [] },
      { id: 'tD', type: 'task', name: 'No deadline', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [] }];
    saveDatabase(); render();
  }, [iso(-3), iso(10), iso(5), iso(8)]);
  await sleep(400);

  step('Calendar dialog and .ics download');
  await p.click('#team-data-actions button:has-text("Add deadlines to your calendar")'); await p.waitForSelector('.cal-count');
  ok((await p.textContent('.cal-count')).includes('2 deadlines and 2 phase events'), 'counts my open deadlines + phase band + milestone: ' + await p.textContent('.cal-count'));
  await p.click('.cal-check:has-text("Include completed tasks") input'); await sleep(100);
  ok((await p.textContent('.cal-count')).includes('3 deadlines'), 'completed tasks can be included');
  await p.click('.cal-check:has-text("Include completed tasks") input'); await sleep(100);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Download calendar file")')]);
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  ok(dl.suggestedFilename().endsWith('.ics') && ics.includes('BEGIN:VCALENDAR') && (ics.match(/BEGIN:VEVENT/g) || []).length === 4, '.ics file with 4 events: ' + dl.suggestedFilename());
  ok(ics.includes('SUMMARY:Due: CAD gripper') && ics.includes('SUMMARY:Phase: Design (Robot Science)') && ics.includes('Design review'), 'deadlines, the phase and its milestone are in it');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/calendar-dialog.png` });

  step('Sync to Google Calendar');
  await p.click('button:has-text("Sync to Google Calendar")'); await p.waitForFunction(() => /Done:/.test(document.querySelector('.cal-gstatus')?.textContent || ''), null, { timeout: 8000 });
  ok((await p.textContent('.cal-gstatus')).includes('4 added'), 'first sync adds 4 events: ' + await p.textContent('.cal-gstatus'));
  ok(Object.keys(G.calendars).length === 1 && Object.values(G.calendars)[0].summary === 'TeamTrack – Robot Science', 'a separate “TeamTrack – Robot Science” calendar is created');
  ok((await p.evaluate(() => window.__gisScopes)).includes('https://www.googleapis.com/auth/calendar.app.created'), 'asks only for the app-created-calendars permission');
  const ev = calEvents().find(e => e.summary === 'Due: CAD gripper');
  ok(ev && ev.start.date === iso(5) && ev.reminders.overrides[0].minutes === 900 && ev.extendedProperties.private.ttId === 'task-tA', 'all-day event with a 9:00-the-day-before reminder and a hidden id');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/calendar-synced.png` });
  await p.click('button:has-text("Sync to Google Calendar")'); await p.waitForFunction(() => /4 already up to date/.test(document.querySelector('.cal-gstatus')?.textContent || ''), null, { timeout: 8000 });
  ok(calEvents().length === 4, 'syncing again changes nothing (no copies)');
  await p.keyboard.press('Escape');

  step('Changes are carried over on the next sync');
  await p.evaluate((d) => { const me = db.find(x => x.id === TT.me.uid); const c = me.categories[0][weeksData[0].key]; c[0].name = 'CAD gripper v2'; c[0].dueDate = d; c[1].dueDate = ''; saveDatabase(); render(); }, iso(6));
  await sleep(400);
  await p.evaluate(() => TT.openCalendar()); await p.waitForSelector('.cal-count');
  await p.click('button:has-text("Sync to Google Calendar")'); await p.waitForFunction(() => /Done:/.test(document.querySelector('.cal-gstatus')?.textContent || ''), null, { timeout: 8000 });
  const st = await p.textContent('.cal-gstatus');
  ok(st.includes('1 updated') && st.includes('1 removed') && st.includes('2 already up to date'), 'renamed task updated, cleared deadline removed: ' + st);
  ok(calEvents().some(e => e.summary === 'Due: CAD gripper v2' && e.start.date === iso(6)) && !calEvents().some(e => e.summary.includes('Order servos')), 'Google Calendar matches the board');
  await p.keyboard.press('Escape');

  step('A second device finds the same calendar');
  await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('tt_gcal_')).forEach(k => localStorage.removeItem(k)));
  await p.evaluate(() => TT.openCalendar()); await p.waitForSelector('.cal-count');
  await p.click('button:has-text("Sync to Google Calendar")'); await p.waitForFunction(() => /Done:/.test(document.querySelector('.cal-gstatus')?.textContent || ''), null, { timeout: 8000 });
  ok(Object.keys(G.calendars).length === 1 && calEvents().length === 3, 'no second calendar, no duplicate events');
  await p.keyboard.press('Escape');

  step('Google refuses calendar look-ups: still no second calendar');
  G.denyLookups = true;
  await p.evaluate(() => TT.openCalendar()); await p.waitForSelector('.cal-count');
  await p.click('button:has-text("Sync to Google Calendar")'); await p.waitForFunction(() => /Done:/.test(document.querySelector('.cal-gstatus')?.textContent || ''), null, { timeout: 8000 });
  ok(Object.keys(G.calendars).length === 1 && calEvents().length === 3, 'keeps using the remembered calendar');
  G.denyLookups = false;
  await p.keyboard.press('Escape');

  step('One task: Add deadline to my calendar');
  await p.locator('.task-card', { hasText: 'CAD gripper v2' }).click({ button: 'right' }); await sleep(200);
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.locator('#quick-menu .qm-btn', { hasText: 'Add deadline to my calendar' }).click()]);
  const one = fs.readFileSync(await dl2.path(), 'utf8');
  ok(dl2.suggestedFilename() === 'CAD-gripper-v2.ics' && (one.match(/BEGIN:VEVENT/g) || []).length === 1 && one.includes('SUMMARY:Due: CAD gripper v2'), 'single-task .ics from the right-click menu');
  await p.locator('.task-card', { hasText: 'CAD gripper v2' }).click(); await sleep(200);
  ok(await p.locator('#edit-form .cal-link').isVisible(), 'editor shows “Add to my calendar” under the deadline');

  step('Google Drive upload');
  await p.click('#edit-form button:has-text("Attach a file or link")'); await p.waitForSelector('button:has-text("Upload to my Google Drive")');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('button:has-text("Upload to my Google Drive")')]);
  await chooser.setFiles({ name: 'gripper-drawing.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test drawing') });
  await p.waitForFunction(() => !document.querySelector('.modal-overlay'), null, { timeout: 8000 });
  const att = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('tt_demo_store_v1')); return Object.values(Object.values(s.teams)[0].tasks).find(t => t.name === 'CAD gripper v2').attachments; });
  ok(att.length === 1 && att[0].provider === 'gdrive' && att[0].name === 'gripper-drawing.pdf' && att[0].url.startsWith('https://drive.google.com/file/d/'), 'file uploaded to Drive and linked on the task');
  ok(G.drive.folders.length === 1 && G.drive.folders[0].name === 'TeamTrack – Robot Science' && G.drive.files[0].parents[0] === G.drive.folders[0].id, 'it goes into a team folder');
  ok((await p.evaluate(() => window.__gisScopes)).includes('https://www.googleapis.com/auth/drive.file'), 'Drive asks only for drive.file');

  step('Export to Google Sheets');
  await p.click('#team-data-actions button:has-text("Export to Google Sheets")');
  await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Google Sheet updated')), null, { timeout: 8000 });
  const sheet = G.sheets[0];
  ok(sheet && sheet.tabs.join() === 'Summary,Tasks' && sheet.data['Tasks!A1'].length === 1 + 4, 'sheet created with a Summary tab and one row per task');
  ok(sheet.data['Tasks!A1'].some(r => r.includes('CAD gripper v2')), 'task rows are in the sheet');

  step('Google access is remembered after a reload');
  const firstAsk = (await p.evaluate(() => window.__gisAsks)).find(x => x.scope.endsWith('drive.file'));
  ok(firstAsk && firstAsk.prompt === 'consent' && firstAsk.hint, 'the first time shows Google’s consent screen, with your email as a hint');
  const reopen = async () => {
    await p.reload(); await p.waitForSelector('#home-screen:not([hidden]), .node-cat');
    if (await p.locator('#home-screen:not([hidden])').isVisible()) { await p.locator('.team-tile').first().click(); await p.waitForSelector('.node-cat'); }
    await sleep(600);
    await p.locator('.task-card', { hasText: 'CAD gripper v2' }).first().evaluate(e => e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
    await p.locator('.task-card', { hasText: 'CAD gripper v2' }).first().click(); await sleep(300);
  };
  const upload = async (name) => {
    await p.click('#edit-form button:has-text("Attach a file or link")'); await p.waitForSelector('button:has-text("Upload to my Google Drive")');
    const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('button:has-text("Upload to my Google Drive")')]);
    await ch.setFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ' + name) });
    await p.waitForFunction(() => !document.querySelector('.modal-overlay'), null, { timeout: 8000 });
  };
  await reopen(); await upload('second.pdf');
  ok(G.drive.files.some(f => f.name === 'second.pdf'), 'second upload after a reload worked');
  ok(!((await p.evaluate(() => window.__gisAsks)) || []).length, 'and didn’t ask Google again (the hour-long token was kept)');
  // when the hour is up, Google is asked quietly — no consent screen, no account picker
  await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('tt_g_') && k.endsWith('drive.file')).forEach(k => { const v = JSON.parse(localStorage.getItem(k)); v.expiry = Date.now() - 1000; localStorage.setItem(k, JSON.stringify(v)); }));
  await reopen(); await upload('third.pdf');
  const quiet = ((await p.evaluate(() => window.__gisAsks)) || []).find(x => x.scope.endsWith('drive.file'));
  ok(G.drive.files.some(f => f.name === 'third.pdf') && quiet && quiet.prompt === '' && quiet.hint, 'after the token expires: asked quietly (no consent screen), with the account hint');
  await ctx.close();
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
try { process.kill(-server.pid); } catch { /* */ }
process.exit(fail || errors.length ? 1 : 0);
