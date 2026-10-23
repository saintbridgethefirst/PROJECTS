// Plans in demo mode: Free limits, the Plan page, asking for Pro, and a platform admin approving it.
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
async function tab(label) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('dialog', d => d.accept()); return p; }
async function signIn(p, name, email) {
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', name); await p.fill('#auth-actions input[type=email]', email);
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
}
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tt_demo_store_v1')));
const teamNamed = async (p, name) => { const s = await store(p); const e = Object.entries(s.teams).find(([, T]) => T.doc.name === name); return e && { id: e[0], ...e[1] }; };
const openPlan = async (p) => { await p.click('#top-actions button:has-text("Settings")'); await p.click('.settings-nav button:has-text("Plan")'); await sleep(250); };
const lastToast = (p) => p.locator('.toast').last().textContent();
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/plans-${n}.png` }); };

try {
  step('A new team is on Free');
  const A = await tab('Aisha');
  await signIn(A, 'Aisha Khan', 'aisha.khan@gmail.com');
  await A.fill('#create-team-form input[name=name]', 'Drone Challenge'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]');
  await A.waitForSelector('.node-cat'); await sleep(300);
  await openPlan(A);
  ok(await A.locator('#plan-name').textContent() === 'Free', 'Plan page says Free');
  ok((await A.locator('#plan-members').textContent()) === '1 of 30', 'usage: 1 of 30 members');
  ok(!(await A.locator('#plan-edu').count()) && await A.locator('#stu-email').isVisible(), 'a Gmail account is offered the university-email check instead');
  ok(!(await A.locator('#plan-wants option[value="edu"]').count()) && !(await A.locator('.settings-pane').textContent()).includes('check it by hand'), 'Pro Education is never given by request or by hand');
  ok(await A.locator('.plan-card').count() === 3 && await A.locator('.plan-card.on[data-tier="free"]').count() === 1, 'Free, Pro and Organisation compared; Free marked as yours');
  await shot(A, 'free');
  await A.click('.settings-nav button:has-text("Features")'); await sleep(150);
  ok(await A.locator('.pro-card').count() >= 8 && (await A.locator('.pro-card[data-pro="approvals"] .pro-badge').textContent()).includes('Pro'), 'Features lists the Pro features with badges');

  step('Free limit: 30 members, counting invitations');
  await A.click('.settings-nav button:has-text("Members")'); await sleep(150);
  await A.fill('.settings-pane textarea', Array.from({ length: 30 }, (_, i) => `p${i}@uni.ac.uk`).join(', ')); await A.click('.settings-pane button:has-text("Invite")'); await sleep(300);
  ok((await lastToast(A)).includes('room for 29 more'), 'inviting 30 more is refused with how much room is left');
  ok(Object.keys((await teamNamed(A, 'Drone Challenge')).invites).length === 0, 'nothing was sent');
  await A.fill('.settings-pane textarea', Array.from({ length: 29 }, (_, i) => `p${i}@uni.ac.uk`).join(', ')); await A.click('.settings-pane button:has-text("Invite")'); await sleep(400);
  ok(Object.keys((await teamNamed(A, 'Drone Challenge')).invites).length === 29, '29 invitations fit');
  ok((await A.locator('#plan-room').textContent()).includes('Team is full: 30 of 30'), 'members page shows the team is full');
  await A.fill('.settings-pane textarea', 'extra@uni.ac.uk'); await A.click('.settings-pane button:has-text("Invite")'); await sleep(300);
  ok((await lastToast(A)).includes('The team is full on the Free plan'), 'a 31st is refused');
  await A.keyboard.press('Escape'); await sleep(200);

  step('Free limit: 5 teams of your own');
  for (const n of ['Lab two', 'Lab three', 'Lab four', 'Lab five']) { await A.evaluate(() => TT.goHome()); await A.waitForSelector('#home-screen:not([hidden])'); await A.fill('#create-team-form input[name=name]', n); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]'); await A.waitForSelector('.node-cat'); await sleep(300); }
  await A.evaluate(() => TT.goHome()); await A.waitForSelector('#home-screen:not([hidden])'); await sleep(300);
  await A.fill('#create-team-form input[name=name]', 'Lab six'); await A.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await A.click('#create-team-form button[type=submit]'); await sleep(400);
  ok(!(await teamNamed(A, 'Lab six')) && (await lastToast(A)).includes('up to 5 teams'), 'a sixth team of your own is refused on Free');
  await A.click('.team-tile:has-text("Drone Challenge")'); await A.waitForSelector('.node-cat'); await sleep(400);

  step('Free limit: finance history shows 90 days');
  await A.evaluate(() => TT.setFeatures({ parts: true, finance: true })); await sleep(300);
  await A.evaluate(() => { const k = 'tt_demo_store_v1'; const s = JSON.parse(localStorage.getItem(k)); const T = Object.values(s.teams).find(t => t.doc.name === 'Drone Challenge'); T.financeLog = { old1: { at: Date.now() - 120 * 864e5, by: 'x', byName: 'Aisha Khan', kind: 'budget', text: 'Added budget line “Old grant”' }, new1: { at: Date.now() - 864e5, by: 'x', byName: 'Aisha Khan', kind: 'budget', text: 'Added budget line “Parts”' } }; localStorage.setItem(k, JSON.stringify(s)); });
  await A.reload(); await A.waitForSelector('.node-cat'); await sleep(500);
  await A.evaluate(() => TT.openResearch('finance')); await sleep(400);
  let h = await A.locator('.fin-log-text').allTextContents();
  ok(h.length === 1 && h[0].includes('Parts') && (await A.locator('.fin-log-older').textContent()).includes('1 older entry is kept'), 'older history is hidden on Free, with a note that it is kept');
  await A.keyboard.press('Escape'); await sleep(200);

  step('Ask for Pro');
  await openPlan(A);
  await A.selectOption('#plan-wants', 'pro'); await A.fill('#plan-note', 'UAS Challenge team, 10 people'); await A.click('#plan-ask'); await sleep(400);
  ok((await A.locator('#plan-request-state').textContent()).includes('Request sent'), 'request sent and shown');
  const req = (await teamNamed(A, 'Drone Challenge')).requests.pro;
  ok(req && req.wants === 'pro' && req.status === 'open' && req.members === 1, 'request saved with team details');
  ok(!(await A.evaluate(() => TT.setTeamPlan(TT.teamId, { tier: 'pro' }))), 'the team owner cannot give themselves Pro');
  ok(!(await A.evaluate(() => TT.writeOps([{ type: 'update', path: 'team', data: { plan: { tier: 'pro', edu: false, until: 0, by: TT.me.uid, at: 1, note: '' } } }], { quiet: true }))), '…and the rules refuse it too');
  await A.keyboard.press('Escape'); await sleep(200);

  step('A platform admin approves it');
  const B = await tab('Rushi'); await signIn(B, 'Rushi Admin', 'rushi@trawpie.org');
  await B.fill('#create-team-form input[name=name]', 'TRAWPIE HQ'); await B.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await B.click('#create-team-form button[type=submit]'); await B.waitForSelector('.node-cat'); await sleep(300);
  await openPlan(B);
  ok(await B.locator('.plan-admin').count() === 0, 'no admin tools for ordinary accounts');
  await B.click('#plan-demo-admin'); await sleep(500);
  ok(await B.locator('.plan-admin').isVisible(), 'admin tools appear for a platform admin');
  await B.waitForSelector('.adm-req');
  ok((await B.locator('.adm-requests .adm-req').first().textContent()).includes('Drone Challenge') && (await B.locator('.adm-requests .adm-req').first().textContent()).includes('UAS Challenge team'), 'the request is listed');
  await shot(B, 'admin');
  await B.locator('.adm-requests .adm-req').first().locator('button:has-text("Approve")').click(); await sleep(600);
  let T = await teamNamed(B, 'Drone Challenge');
  ok(T.doc.plan.tier === 'pro' && T.doc.plan.edu === false && T.requests.pro.status === 'approved', 'team is on Pro, request approved');
  ok(await B.locator('.adm-requests .adm-req').count() === 0, 'the list empties');
  await B.keyboard.press('Escape'); await sleep(200);

  step('The team sees Pro');
  await A.bringToFront(); await sleep(600);
  await openPlan(A);
  ok(await A.locator('#plan-name').textContent() === 'Pro' && (await A.locator('#plan-members').textContent()) === '30 of 100', 'Plan page shows Pro with 100 places');
  ok((await A.locator('#plan-request-state').count()) === 0 || (await A.locator('#plan-request-state').textContent()).includes('approved'), 'request shown as approved (or hidden)');
  await shot(A, 'pro');
  await A.keyboard.press('Escape'); await sleep(200);
  await A.evaluate(() => TT.openResearch('finance')); await sleep(400);
  ok((await A.locator('.fin-log-text').count()) === 2 && !(await A.locator('.fin-log-older').count()), 'Pro shows the full finance history');
  await A.keyboard.press('Escape'); await sleep(200);

  step('A plan past its end date falls back to Free');
  await B.bringToFront();
  ok(await B.evaluate((id) => TT.setTeamPlan(id, { tier: 'pro', edu: true, until: Date.now() - 864e5, note: 'Pilot ended' }), T.id), 'admin sets an end date in the past');
  await A.bringToFront(); await sleep(600);
  await openPlan(A);
  ok(await A.locator('#plan-name').textContent() === 'Free' && (await A.locator('.plan-current').textContent()).includes('Pro period has ended'), 'team is back on Free and told why');
  await A.keyboard.press('Escape');

  step('Students with a university email get Pro Education free, instantly');
  const C = await tab('Priya'); await signIn(C, 'Priya Shah', 'priya.shah@bristol.ac.uk');
  await C.fill('#create-team-form input[name=name]', 'Bristol UAS'); await C.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await C.click('#create-team-form button[type=submit]'); await C.waitForSelector('.node-cat'); await sleep(300);
  await openPlan(C);
  ok((await C.locator('.plan-edu').textContent()).includes('priya.shah@bristol.ac.uk'), 'the Plan page recognises the university email');
  await C.click('#plan-edu'); await sleep(700);
  const U = await teamNamed(C, 'Bristol UAS');
  ok(U.doc.plan.tier === 'pro' && U.doc.plan.edu && U.doc.plan.until > Date.now() + 360 * 864e5 && U.doc.plan.until < Date.now() + 366 * 864e5, 'Pro Education on for a year, no admin needed');
  await sleep(300);
  ok(await C.locator('#plan-name').textContent() === 'Pro Education' && !(await C.locator('#plan-edu').count()), 'Plan page shows it; no button until renewal is due');
  await shot(C, 'edu');
  ok(!(await C.evaluate(() => TT.writeOps([{ type: 'update', path: 'team', data: { plan: { tier: 'org', edu: true, until: Date.now() + 864e5, by: TT.me.uid, at: 1, note: '' } } }], { quiet: true }))), 'a university email cannot give itself Organisation');

  step('At most 3 teams a year per student');
  await C.keyboard.press('Escape'); await sleep(200);
  const claimed = await C.evaluate(() => TT.eduClaim);
  ok(claimed.teams.length === 1 && claimed.limit === 3, 'the claim is counted (1 of 3)');
  for (const n of ['Rocketry', 'Rover', 'Formula']) { await C.evaluate(() => TT.goHome()); await C.waitForSelector('#home-screen:not([hidden])'); await C.fill('#create-team-form input[name=name]', n); await C.evaluate(() => { const c = document.getElementById('create-practice'); if (c) c.checked = false; }); await C.click('#create-team-form button[type=submit]'); await C.waitForSelector('.node-cat'); await sleep(300); await openPlan(C); if (n !== 'Formula') { await C.click('#plan-edu'); await sleep(600); } await C.keyboard.press('Escape'); await sleep(150); }
  await openPlan(C);
  ok(await C.locator('#plan-edu-full').isVisible() && !(await C.locator('#plan-edu').count()), 'a fourth team gets no button: all 3 used this year');
  ok((await C.locator('#plan-edu-count').textContent()).includes('3 of 3'), 'shows 3 of 3 used');
  const forced = await C.evaluate(async () => { const y = new Date().getUTCFullYear(); return TT.writeOps([{ type: 'set', path: '/eduClaims/' + TT.me.uid, data: { year: y, teams: [...TT.eduClaim.teams, TT.teamId] } }, { type: 'update', path: 'team', data: { plan: { tier: 'pro', edu: true, until: Date.now() + 300 * 864e5, by: TT.me.uid, at: 1, note: '' } } }], { quiet: true }); });
  ok(!forced, 'the rules refuse a fourth team even if the app is bypassed');
  await C.keyboard.press('Escape'); await sleep(150);

  step('Only the owner and admins change the plan; members ask them');
  await C.click('#top-actions button:has-text("Invite")'); await C.fill('.settings-pane textarea', 'tom.reed@bristol.ac.uk'); await C.click('.settings-pane button:has-text("Invite")'); await sleep(250); await C.keyboard.press('Escape'); await sleep(150);
  const D = await tab('Tom'); await signIn(D, 'Tom Reed', 'tom.reed@bristol.ac.uk'); await D.click('#invites-list button:has-text("Join team")'); await D.waitForSelector('.node-cat'); await sleep(400);
  await openPlan(D);
  ok(!(await D.locator('#plan-edu').count()) && (await D.locator('.plan-member').textContent()).includes('Only the team’s owner and admins'), 'a member with a university email still cannot switch it on');
  ok(!(await D.evaluate(() => TT.claimEdu())), '…not even through the app bridge');
  await D.fill('#plan-ask-note', 'We need approvals for sponsor money'); await D.click('#plan-ask-admins'); await sleep(400);
  ok((await D.locator('#plan-asked').textContent()).includes('You asked'), 'the member asked the owner and admins');
  await D.keyboard.press('Escape'); await D.close();
  await C.bringToFront(); await sleep(300); await openPlan(C);
  ok((await C.locator('.plan-asks').textContent()).includes('Tom Reed') && (await C.locator('.plan-asks').textContent()).includes('sponsor money'), 'the owner sees who asked and why');
  await C.locator('.plan-asks button:has-text("Dismiss")').click(); await sleep(400);
  ok(!(await C.locator('.plan-asks').count()), 'the owner can dismiss it');
  await C.keyboard.press('Escape'); await sleep(150);

  step('A personal-email account proves a university email with a code');
  await A.bringToFront();
  await A.evaluate(() => TT.goHome()); await A.waitForSelector('#home-screen:not([hidden])'); await sleep(300);
  await A.click('.team-tile:has-text("Lab two")'); await A.waitForSelector('.node-cat'); await sleep(400);
  await openPlan(A);
  await A.fill('#stu-email', 'aisha@gmail.com'); await A.click('#stu-send'); await sleep(300);
  ok((await A.locator('#stu-status').textContent()).includes('university email'), 'a non-university address is refused');
  await A.fill('#stu-email', 'aisha.khan@bristol.ac.uk'); await A.click('#stu-send'); await sleep(300);
  const st = await A.locator('#stu-status').textContent(); const code = (st.match(/code is (\d{6})/) || [])[1];
  ok(st.includes('We sent a code to aisha.khan@bristol.ac.uk') && code, 'code sent (shown on screen in the demo)');
  await A.fill('#stu-code', code === '000000' ? '111111' : '000000'); await A.click('#stu-verify'); await sleep(300);
  ok((await A.locator('#stu-status').textContent()).includes('isn’t right'), 'a wrong code is refused');
  await A.fill('#stu-code', code); await A.click('#stu-verify'); await sleep(700);
  ok(await A.locator('#plan-edu').isVisible() && (await A.locator('.plan-edu').textContent()).includes('aisha.khan@bristol.ac.uk'), 'confirmed: the Pro Education button appears');
  await shot(A, 'student-code');
  await A.click('#plan-edu'); await sleep(700);
  const L2 = await teamNamed(A, 'Lab two');
  ok(L2.doc.plan.tier === 'pro' && L2.doc.plan.edu, 'a Gmail account with a confirmed university email gets Pro Education');
  await A.keyboard.press('Escape'); await sleep(150);
  ok(await C.evaluate(async () => { try { await TT.sendStudentCode('aisha.khan@bristol.ac.uk'); return false; } catch (e) { return /already linked/.test(e.message); } }), 'the same university email cannot be used by a second account');

  step('The admin sees every Pro Education team');
  await B.bringToFront(); await openPlan(B); await B.waitForSelector('.adm-edu-teams .adm-req');
  const eduNames = await B.locator('.adm-edu-teams .adm-req b').allTextContents();
  ok(eduNames.includes('Bristol UAS') && eduNames.includes('Lab two') && eduNames.includes('Rover'), 'admin list shows Pro Education teams: ' + eduNames.join(', '));
  await B.locator('.adm-edu-teams .adm-req', { hasText: 'Rover' }).locator('button:has-text("Switch to Free")').click(); await sleep(600);
  ok(!(await teamNamed(B, 'Rover')).doc.plan.edu && (await teamNamed(B, 'Rover')).doc.plan.tier === 'free', 'admin can switch a misused team back to Free');
} catch (e) { fail++; console.log('TEST CRASH:', e.message.split('\n').slice(0, 12).join('\n')); if (SHOTS) for (const [i, p] of ctx.pages().entries()) await p.screenshot({ path: `${SHOTS}/plans-crash-${i}.png` }); }
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
