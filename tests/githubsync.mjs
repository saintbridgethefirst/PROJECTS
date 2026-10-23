// GitHub sync in the demo: connect a repository, the webhook steps, simulated events (a new issue
// becomes a task; a pull request naming a task is linked, and finishes it when merged), the task's
// reference and branch name, the "Raise an issue" form and link, and disconnecting.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
const team = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0]);
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: SHOTS + '/github-' + n + '.png' }); };

try {
  step('Connect a repository (Settings ▸ Integrations)');
  const A = await tab('Aisha');
  await A.goto(BASE); await A.waitForSelector('#auth-screen:not([hidden])');
  await A.fill('#auth-actions input[placeholder="Your name"]', 'Aisha Khan'); await A.fill('#auth-actions input[type=email]', 'aisha@uni.ac.uk');
  await A.click('#auth-actions button:has-text("Sign in to demo")'); await A.waitForSelector('#home-screen:not([hidden])');
  await A.fill('#create-team-form input[name=name]', 'Rover Lab'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await A.evaluate(() => window.boardAddTask({ ownerUid: TT.me.uid, name: 'Fix the motor driver' })); await sleep(400);
  await A.evaluate(() => TT.openSettings('integrations')); await A.waitForSelector('#gh-settings');
  await A.fill('#gh-repo', 'not a repo'); await A.click('#gh-connect'); await sleep(300);
  ok(!(await team(A)).doc.github, 'a bad repository name is refused');
  await A.fill('#gh-repo', 'https://github.com/uni-robotics/rover'); await A.click('#gh-connect'); await A.waitForSelector('#gh-secret');
  const T = await team(A);
  ok(T.doc.github && T.doc.github.repo === 'uni-robotics/rover' && T.doc.github.issues && T.doc.github.done, 'connected: ' + JSON.stringify(T.doc.github));
  const secret = await A.inputValue('#gh-secret');
  ok(/^[0-9a-f]{48}$/.test(secret) && T.private.github.secret === secret, 'a secret to paste into GitHub, kept apart from the team');
  ok((await A.inputValue('#gh-url')).includes('githubWebhook?team='), 'and the payload URL');
  ok((await A.getAttribute('#gh-hook-link', 'href')) === 'https://github.com/uni-robotics/rover/settings/hooks/new', 'a link straight to GitHub’s new-webhook page');
  await shot(A, 'connect');

  step('Nobody can point the team at another repository by writing the team directly');
  const res = await A.evaluate(async () => { try { return await TT.writeOps([{ type: 'update', path: 'team', data: { github: { repo: 'evil/repo', issues: true, done: true, owner: '', connectedAt: 1 } } }], { quiet: true }); } catch { return false; } });
  ok(res === false && (await team(A)).doc.github.repo === 'uni-robotics/rover', 'the repository is only set by the server');

  step('Settings reopen on the connected view; simulate a new issue');
  await A.keyboard.press('Escape'); await sleep(200);
  await A.evaluate(() => TT.openSettings('integrations')); await A.waitForSelector('#gh-repo-link');
  ok(await A.locator('#gh-raise-link').inputValue() === await A.evaluate(() => location.origin + location.pathname + '#/t/' + Object.keys(JSON.parse(localStorage.getItem('tt_demo_store_v1')).teams)[0] + '/raise'), 'a shareable Raise-an-issue link');
  await A.click('#gh-sim-issue'); await sleep(600);
  let t = Object.values((await team(A)).tasks).find(x => x.name === 'Battery connector gets hot');
  ok(t && t.icon === '🐙' && t.attachments[0].provider === 'github' && t.attachments[0].url.endsWith('/issues/41'), 'the issue became a task, linked to it');
  ok(t && t.history[0].user === 'GitHub', 'its history says GitHub made it');
  ok((await A.textContent('#gh-sim-out')).length > 10, 'and the demo says what happened');

  step('A pull request for a task: linked, then finished when merged');
  const fix = Object.entries((await team(A)).tasks).find(([, x]) => x.name === 'Fix the motor driver');
  await A.locator('#gh-sim-task').selectOption(fix[0]);
  await A.click('#gh-sim-pr'); await sleep(600);
  let f = (await team(A)).tasks[fix[0]];
  ok(f.attachments.some(a => a.url.endsWith('/pull/42')) && f.flag !== 'completed', 'opened: linked by the branch name, not finished');
  await A.click('#gh-sim-merge'); await sleep(900);
  f = (await team(A)).tasks[fix[0]];
  ok(f.attachments.some(a => a.url.endsWith('/pull/43')) && f.flag === 'completed' && f.history[0].updated.includes('merged'), 'merged: finished, and the history says why');
  await shot(A, 'settings');
  await A.keyboard.press('Escape'); await sleep(300);

  step('Every task shows its reference, a branch name and a new-issue link');
  const other = await A.evaluate(() => window.boardAddTask({ ownerUid: TT.me.uid, name: 'Tune the PID loop' })); await sleep(400);
  await A.evaluate((id) => window.boardOpenTask(id), other.id); await A.waitForSelector('.gh-ref');
  const ref = await A.textContent('.gh-ref');
  ok(/^TT-[A-Z0-9]{6}$/.test(ref), 'reference ' + ref);
  await A.click('.gh-branch'); await sleep(200);
  ok(await A.evaluate(() => navigator.clipboard.readText()) === ref.toLowerCase() + '-tune-the-pid-loop', 'branch name copied');
  await A.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await A.click('.gh-new-issue'); await A.waitForSelector('#gh-new');
  ok(await A.inputValue('#gh-new-title') === 'Tune the PID loop', 'the issue form starts with the task name');
  await A.fill('#gh-new-body', 'Overshoots by 20%.'); await A.click('#gh-new-save'); await sleep(300);
  const href = await A.evaluate(() => window.__opened[0] || '');
  ok(href.startsWith('https://github.com/uni-robotics/rover/issues/new?') && decodeURIComponent(href).includes('Trawpie: ' + ref), 'new issue on GitHub names the task');
  await shot(A, 'editor');

  step('The Raise-an-issue link opens the form; it adds a task and opens GitHub filled in');
  const teamId = Object.keys(JSON.parse(await A.evaluate(() => localStorage.getItem('tt_demo_store_v1'))).teams)[0];
  await A.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await A.goto(BASE + '#/t/' + teamId + '/raise'); await A.waitForSelector('#gh-raise', { timeout: 10000 });
  ok(!(await A.evaluate(() => location.hash)).includes('raise'), 'the link opens the form (and tidies the address)');
  await A.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await A.click('#gh-raise-go'); await sleep(200);
  ok(await A.locator('#gh-raise').count() === 1, 'needs a title');
  await A.fill('#gh-raise-title', 'Wheel encoder drops counts'); await A.fill('#gh-raise-body', 'Above 2 m/s.');
  await A.click('#gh-raise-go'); await sleep(600);
  const made = Object.entries((await team(A)).tasks).find(([, x]) => x.name === '🐞 Wheel encoder drops counts');
  const opened = await A.evaluate(() => window.__opened);
  ok(!!made, 'a task in my row');
  const madeRef = made && await A.evaluate((id) => TT.taskRef({ id }), made[0]);
  ok(opened.length === 1 && decodeURIComponent(opened[0]).includes('title=Wheel encoder drops counts') && decodeURIComponent(opened[0]).includes('Trawpie: ' + madeRef), 'GitHub opened with the issue and the task’s reference');
  // …and when GitHub sends that issue, it's linked to this task rather than making another.
  await A.evaluate(async (ref) => TT.githubSimulate('issues', { action: 'opened', repository: { full_name: 'uni-robotics/rover' }, issue: { number: 50, title: 'Wheel encoder drops counts', body: 'Above 2 m/s.\n\nTrawpie: ' + ref, html_url: 'https://github.com/uni-robotics/rover/issues/50' } }), madeRef);
  await sleep(500);
  const tasks = Object.values((await team(A)).tasks);
  ok(tasks.filter(x => /Wheel encoder/.test(x.name)).length === 1 && tasks.find(x => x.name === '🐞 Wheel encoder drops counts').attachments.some(a => a.url.endsWith('/issues/50')), 'the submitted issue links to that task, no duplicate');

  step('Without a token: + GitHub issue opens GitHub and the task waits; linking by number');
  await A.keyboard.press('Escape'); await sleep(200);
  const pid = (await A.evaluate(() => window.boardAddTask({ ownerUid: TT.me.uid, name: 'Calibrate the IMU' }))).id; await sleep(400);
  await A.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await A.evaluate((id) => window.boardOpenTask(id), pid); await A.waitForSelector('.gh-new-issue');
  await A.click('.gh-new-issue'); await A.waitForSelector('#gh-new'); await A.click('#gh-new-save'); await sleep(400);
  ok((await A.evaluate(() => window.__opened.length)) === 1, 'GitHub’s new-issue page opened');
  ok(await A.locator('.gh-pending').isVisible(), 'the task says it’s waiting for GitHub');
  const cardOf = (name) => A.locator('.task-card', { hasText: name });
  ok((await cardOf('Calibrate the IMU').first().textContent()).toLowerCase().includes('issue being created'), 'and so does its card');
  await A.click('.gh-link-issue'); await A.waitForSelector('#gh-link-url'); await A.fill('#gh-link-url', '#77'); await A.click('#gh-link-save'); await sleep(500);
  let imu = (await team(A)).tasks[pid];
  ok(imu.attachments.some(a => a.url === 'https://github.com/uni-robotics/rover/issues/77'), 'linked by typing #77');
  const imuText = await cardOf('Calibrate the IMU').first().textContent();
  ok(imuText.includes('#77') && !(await A.locator('.gh-pending').count()), 'the card shows #77; no longer waiting: ' + imuText.slice(0, 120));

  step('With a token: issues made at once, and closed from the task');
  await A.evaluate(() => TT.openSettings('integrations')); await A.waitForSelector('#gh-token-input');
  await A.fill('#gh-token-input', 'not-a-token'); await A.click('#gh-token-save'); await sleep(300);
  ok(!(await team(A)).doc.github.write, 'a wrong token is refused');
  await A.fill('#gh-token-input', 'github_pat_' + 'a'.repeat(40)); await A.click('#gh-token-save'); await sleep(500);
  ok((await team(A)).doc.github.write === true && !JSON.stringify((await team(A)).doc).includes('github_pat_'), 'saved on the server side only');
  await A.keyboard.press('Escape'); await sleep(200);
  await A.evaluate((id) => window.boardOpenTask(id), pid); await A.waitForSelector('.gh-new-issue');
  await A.click('.gh-new-issue'); await A.waitForSelector('#gh-new'); await A.fill('#gh-new-body', 'Drifts 2° a minute.'); await A.click('#gh-new-save'); await sleep(600);
  imu = (await team(A)).tasks[pid];
  const made101 = imu.attachments.find(a => /issues\/101$/.test(a.url));
  ok(made101 && imu.history.some(h => h.updated === 'Created issue #101 and linked it'), 'issue #101 made and linked at once');
  ok((await cardOf('Calibrate the IMU').first().textContent()).includes('#101'), 'shown on the card');
  await A.waitForSelector('.gh-close-btn');
  await A.locator('.gh-close-btn').last().click(); await A.waitForSelector('#gh-close');
  await A.check('input[name=gh-close-reason][value=duplicate]'); await A.click('#gh-close-save'); await sleep(200);
  ok(await A.locator('#gh-close').count() === 1, 'a duplicate needs the other issue’s number');
  await A.fill('#gh-close-dup', '77'); await A.click('#gh-close-save'); await sleep(500);
  imu = (await team(A)).tasks[pid];
  ok(imu.history[0].updated === 'Closed issue #101 as a duplicate of #77' && imu.flag !== 'completed', 'closed as a duplicate; the task stays open');
  await A.locator('.gh-close-btn').first().click(); await A.waitForSelector('#gh-close');
  ok(await A.isChecked('#gh-close-finish'), '“also mark this task done” is offered');
  await A.click('#gh-close-save'); await sleep(600);
  imu = (await team(A)).tasks[pid];
  ok(imu.flag === 'completed' && imu.history.some(h => h.updated === 'Closed issue #77 as completed'), 'closed as completed, and the task is done');

  step('Right-click a card: GitHub actions');
  await A.keyboard.press('Escape'); await sleep(200);
  await cardOf('Tune the PID loop').evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await cardOf('Tune the PID loop').click({ button: 'right' }); await sleep(300);
  const qm = (label) => A.locator('#quick-menu.active .qm-btn', { hasText: label });
  const qs = (label) => A.locator('#quick-submenu .qm-btn', { hasText: label });
  ok(await qm('GitHub').isVisible(), 'the menu has GitHub');
  await qm('GitHub').click(); await sleep(250);
  ok(await qs('Create GitHub issue').isVisible() && await qs('Link an existing issue').isVisible() && await qs('Copy branch name').isVisible(), 'create, link and copy the branch name');
  await qs('Create GitHub issue').click(); await A.waitForSelector('#gh-new'); await A.click('#gh-new-save'); await sleep(600);
  const pidTask = Object.values((await team(A)).tasks).find(t => t.name === 'Tune the PID loop');
  ok(pidTask.attachments.some(a => /issues\/102$/.test(a.url)), 'created #102 from the menu');
  step('Disconnect');
  await A.keyboard.press('Escape');
  await A.evaluate(() => TT.openSettings('integrations')); await A.waitForSelector('#gh-disconnect');
  await A.click('#gh-disconnect'); await sleep(500);
  const T2 = await team(A);
  ok(!T2.doc.github && !(T2.private && T2.private.github), 'repository and secret forgotten');
  ok(await A.locator('#gh-repo').count() === 1, 'back to Connect');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 8).join('\n')); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
