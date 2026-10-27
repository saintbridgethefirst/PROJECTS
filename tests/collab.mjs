// Team collaboration in demo mode, three teammates in three tabs: comments, @mentions
// with badges, the Activity panel, a viewer who can read but not comment, and My tasks.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';
import { editorAsOneList } from './editor-list.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
editorAsOneList(browser);   // the task editor as one list: these checks reach into every tab
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });

async function tab(label) {
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p;
}
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
async function dialog(p, value) { await p.waitForSelector('#dialog-overlay input'); await p.fill('#dialog-overlay input', value); await p.click('#dialog-overlay .dlg-ok'); await sleep(200); }
const team = (p) => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('tt_demo_store_v1')); return Object.values(s.teams)[0]; });
const card = (p, name) => p.locator('.task-card', { hasText: name }).first();
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/collab-${n}.png` }); };
const badge = (p) => p.evaluate(() => { const b = document.getElementById('activity-badge'); return b && !b.hidden ? b.textContent : ''; });

try {
  step('Owner sets up a team and invites two people');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha@uni.ac.uk');
  await A.fill('#create-team-form input[name=name]', 'Robotics Group Project'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  for (const n of ['Literature review', 'Motor test']) { await A.click('.col-add'); await dialog(A, n); }
  ok(await A.locator('#activity-btn').isVisible() && (await badge(A)) === '', 'Activity button on the top bar, no badge yet');
  await A.click('#top-actions button:has-text("Invite")');
  await A.fill('.settings-pane textarea', 'tom@uni.ac.uk'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(200);
  await A.fill('.settings-pane textarea', 'priya@uni.ac.uk'); await A.locator('.settings-pane form select').selectOption('viewer');
  await A.click('.settings-pane button:has-text("Invite")'); await sleep(200);
  await A.keyboard.press('Escape');

  step('A member comments on the owner’s task and @mentions her');
  const B = await tab('Tom');
  await signIn(B, 'Tom Reed', 'tom@uni.ac.uk');
  await B.click('#invites-list button:has-text("Join team")'); await B.waitForSelector('.node-cat'); await sleep(500);
  await card(B, 'Literature review').click(); await sleep(300);
  ok(await B.locator('#edit-form .read-only-note').isVisible(), 'Tom can’t edit Aisha’s task…');
  ok(await B.locator('.comments-section textarea').isEnabled(), '…but he can still comment on it');
  ok((await B.locator('.comments-section .cm-list').textContent()).includes('No comments yet'), 'empty comments message');
  const ta = B.locator('.comments-section textarea');
  await ta.click(); await ta.type('@Ai');
  await B.waitForSelector('.mention-pop:not([hidden]) .mention-opt');
  ok((await B.locator('.mention-pop .mention-opt').first().textContent()).includes('Aisha Khan'), 'typing @Ai suggests Aisha Khan');
  await B.keyboard.press('Enter');
  ok((await ta.inputValue()) === '@Aisha Khan ', 'Enter inserts the full name');
  await ta.type('can you check the references? https://example.org/paper');
  await B.keyboard.press('Control+Enter'); await sleep(400);
  let T = await team(B);
  const aishaUid = Object.values(T.members).find(m => m.email === 'aisha@uni.ac.uk').uid;
  const tomUid = Object.values(T.members).find(m => m.email === 'tom@uni.ac.uk').uid;
  let comments = Object.values(T.comments || {});
  ok(comments.length === 1 && comments[0].mentions.length === 1 && comments[0].mentions[0] === aishaUid, 'comment saved with Aisha as the mention');
  ok((await ta.inputValue()) === '', 'composer clears after posting');
  ok(await B.locator('.cm-item .mention', { hasText: '@Aisha Khan' }).isVisible(), 'mention is highlighted in the comment');
  ok(await B.locator('.cm-item a[href="https://example.org/paper"][target=_blank]').isVisible(), 'links in comments are clickable and open in a new tab');
  ok((await card(B, 'Literature review').textContent()).includes('1 comment'), 'card shows the comment count');
  await shot(B, '1-comment');

  step('Aisha sees the mention badge and opens it');
  await A.bringToFront(); await sleep(600);
  ok((await badge(A)) === '1', 'Activity badge shows 1 unread mention');
  ok(await card(A, 'Literature review').locator('.mention-dot').isVisible(), 'the task card is marked with @');
  await shot(A, '2-badge');
  await A.click('#activity-btn'); await sleep(250);
  ok(await A.locator('.act-item.unread', { hasText: 'Tom Reed mentioned you on Literature review' }).isVisible(), 'Mentions tab lists it as unread');
  await shot(A, '3-mentions');
  await A.locator('.act-item.unread').first().click(); await sleep(500);
  ok(await A.locator('.comments-section .cm-item', { hasText: 'can you check the references' }).isVisible(), 'clicking the mention opens the task with the comment');
  ok((await badge(A)) === '', 'badge clears once seen');
  ok(await card(A, 'Literature review').locator('.mention-dot').count() === 0, 'card @ marker clears');

  step('Aisha replies with a mention, edits it');
  const taA = A.locator('.comments-section textarea');
  await taA.click(); await taA.type('Done! @Tom Reed please order the servos');
  await A.click('.comments-section .cm-composer button:has-text("Comment")'); await sleep(400);
  await A.locator('.cm-item', { hasText: 'Done!' }).locator('button:has-text("Edit")').click();
  const ed = A.locator('.cm-item .cm-composer textarea');
  await ed.fill('Done! @Tom Reed please order the servos today'); await A.click('.cm-item .cm-composer button:has-text("Save")'); await sleep(400);
  T = await team(A); comments = Object.values(T.comments);
  const reply = comments.find(c => c.authorUid === aishaUid);
  ok(reply && reply.text.endsWith('today') && reply.editedAt > 0 && reply.mentions[0] === tomUid, 'edit saved, marked edited, mention kept');
  ok(await A.locator('.cm-item', { hasText: 'today' }).locator('.cm-time', { hasText: 'edited' }).isVisible(), 'shows "edited"');
  ok(await A.locator('.cm-item', { hasText: 'can you check' }).locator('button:has-text("Delete")').isVisible() && await A.locator('.cm-item', { hasText: 'can you check' }).locator('button:has-text("Edit")').count() === 0, 'owner may delete Tom’s comment but not edit it');

  step('Draft survives a teammate’s change');
  await taA.click(); await taA.type('half-written note');
  await A.locator('#edit-name').click();   // focus leaves the comment box
  await B.bringToFront(); await card(B, 'Motor test').click(); await sleep(200);
  await A.bringToFront(); await sleep(600);
  ok((await A.locator('.comments-section textarea').inputValue()) === 'half-written note', 'unsent comment is kept');
  await A.locator('.comments-section textarea').fill('');
  await A.locator('.comments-section textarea').type('x'); await A.locator('.comments-section textarea').fill('');

  step('Viewer reads comments but cannot add them');
  const C = await tab('Priya');
  await signIn(C, 'Priya Shah', 'priya@uni.ac.uk');
  await C.click('#invites-list button:has-text("Join team")'); await C.waitForSelector('.node-cat'); await sleep(500);
  await card(C, 'Literature review').click(); await sleep(300);
  ok(await C.locator('.comments-section .cm-item').count() === 2, 'viewer sees both comments');
  ok(await C.locator('.comments-section textarea').count() === 0 && (await C.locator('.comments-section').textContent()).includes('can read comments but not add them'), 'viewer has no comment box');
  const denied = await C.evaluate(async () => { try { await TT.writeOps([{ type: 'set', path: 'comments/hack', data: { taskId: 'x', authorUid: 'x', authorName: 'x', text: 'x', mentions: [], createdAt: 1 } }], { quiet: true }); return JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams && !Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0].comments.hack; } catch (e) { return true; } });
  ok(denied, 'writing a comment directly is refused by the rules');

  step('Team activity feed');
  await A.bringToFront(); await A.click('#activity-btn'); await sleep(250);
  await A.click('.act-tab:has-text("Team activity")'); await sleep(200);
  const feed = await A.locator('.act-pane').textContent();
  ok(feed.includes('Today'), 'grouped by day');
  ok(feed.includes('Tom Reed commented on Literature review') && feed.includes('Aisha Khan commented on Literature review'), 'comments appear in the feed');
  ok(feed.includes('Aisha Khan added Motor test') || feed.includes('added Motor test'), 'new tasks appear in the feed');
  await A.locator('.act-pane select').selectOption('Tom Reed'); await sleep(150);
  ok(!(await A.locator('.act-pane').textContent()).includes('Aisha Khan commented'), 'filter by person');
  await shot(A, '4-activity');
  await A.keyboard.press('Escape');

  step('Typing a week metric is not interrupted (regression)');
  await A.bringToFront();
  const metric = A.locator('.metric-badge').first();
  await metric.click();
  await A.keyboard.type('Hi: 0', { delay: 60 });
  // a teammate's change and a new comment arrive while typing
  await B.evaluate(() => { const me = db.find(p => p.id === TT.me.uid); const c = me.categories[0]; const wk = weeksData[0].key; c[wk] = c[wk] || []; c[wk].push({ id: 'task_cal', type: 'task', name: 'Calibrate IMU', priority: 'Minor', status: '', flag: 'none', subtasks: [], history: [] }); saveDatabase(); render(); });
  await sleep(500);
  await A.keyboard.type('.85 target', { delay: 60 });
  ok(await A.evaluate(() => document.activeElement && document.activeElement.classList.contains('metric-badge')), 'cursor stays in the metric box while typing');
  ok((await metric.innerText()) === 'Hi: 0.85 target', 'every letter typed is kept: ' + await metric.innerText());
  ok(((await team(A)).doc.weeks[0].metric || '') === '', 'nothing saved until you finish');
  await A.keyboard.press('Enter'); await sleep(400);
  ok((await team(A)).doc.weeks[0].metric === 'Hi: 0.85 target', 'Enter saves the metric');
  ok((await A.locator('.task-card', { hasText: 'Calibrate IMU' }).count()) === 1, 'the teammate’s change shows once typing is done');
  await metric.click(); await A.keyboard.press('End'); await A.keyboard.type(' x'); await A.keyboard.press('Escape'); await sleep(300);
  ok((await team(A)).doc.weeks[0].metric === 'Hi: 0.85 target' && (await metric.innerText()) === 'Hi: 0.85 target', 'Escape cancels an edit');

  step('My tasks across teams, and a mention badge on the team tile');
  await B.bringToFront();
  await B.locator('.task-card.ghost-add, .col-add').first().waitFor();
  // Tom adds his own task with a deadline (in his own row)
  await B.evaluate(() => {
    const me = db.find(p => p.id === TT.me.uid); const cat = me.categories[0]; const wk = weeksData[0].key;
    const d = new Date(); d.setDate(d.getDate() + 2); const iso = d.toLocaleDateString('en-CA');
    cat[wk] = cat[wk] || []; cat[wk].push({ id: 'task_servo', type: 'task', name: 'Order servos', priority: 'Major', status: '', flag: 'none', dueDate: iso, subtasks: [{ id: 's1', title: 'Get quote', completed: true }, { id: 's2', title: 'Pay', completed: false }], history: [] });
    saveDatabase(); render();
  });
  await sleep(400);
  // A second team that Tom owns, with an overdue task
  await B.click('#team-switch'); await B.waitForSelector('#home-screen:not([hidden])');
  await B.fill('#create-team-form input[name=name]', 'Lab Admin'); await B.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await B.click('#create-team-form button[type=submit]');
  await B.waitForSelector('.node-cat'); await sleep(300);
  await B.click('.col-add'); await dialog(B, 'Book wind tunnel');
  await B.evaluate(() => { const me = db.find(p => p.id === TT.me.uid); const t = me.categories[0][weeksData[0].key][0]; const d = new Date(); d.setDate(d.getDate() - 3); t.dueDate = d.toLocaleDateString('en-CA'); saveDatabase(); render(); });
  await sleep(300);
  // Meanwhile Aisha mentions Tom on another task
  await A.bringToFront(); await card(A, 'Motor test').click(); await sleep(300);
  await A.locator('.comments-section textarea').fill('@Tom Reed can you run this on Friday?');
  await A.click('.comments-section .cm-composer button:has-text("Comment")'); await sleep(400);
  await B.bringToFront(); await sleep(300);
  await B.click('#team-switch'); await B.waitForSelector('#mytasks-section:not([hidden])'); await sleep(600);
  const mt = await B.locator('#mytasks').textContent();
  ok(mt.includes('Order servos') && mt.includes('Book wind tunnel'), 'My tasks lists Tom’s tasks from both teams');
  ok(mt.indexOf('Book wind tunnel') < mt.indexOf('Order servos') && mt.includes('Overdue · 1') && mt.includes('3 days overdue'), 'overdue first, with how late it is: ' + mt.slice(0, 300));
  ok(mt.includes('Due in 2 days') && mt.includes('☑ 1/2'), 'shows the deadline and sub-task progress');
  ok(await B.locator('.team-tile', { hasText: 'Robotics Group Project' }).locator('.tile-badge', { hasText: '@1' }).isVisible(), 'team tile shows Tom’s unread mention');
  ok(await B.locator('.team-tile', { hasText: 'Lab Admin' }).locator('.tile-badge').count() === 0, 'no badge on the other team');
  await shot(B, '5-mytasks');
  await B.setViewportSize({ width: 390, height: 844 }); await sleep(300);
  ok(await B.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'My tasks fits a phone screen');
  await shot(B, '6-mytasks-phone');
  await B.setViewportSize({ width: 1360, height: 860 });
  await B.locator('.mt-row', { hasText: 'Order servos' }).click();
  await B.waitForSelector('#board-screen:not([hidden])'); await sleep(900);
  ok((await B.inputValue('#edit-name').catch(() => '')) === 'Order servos', 'clicking a task opens its team with the task in the editor');
  ok((await badge(B)) === '1', 'Tom’s board shows his unread mention');
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
