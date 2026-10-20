// Stress test: a big team in demo mode. Measures how long the things people do actually take.
//   node tools/perf/big-team.mjs [people=100] [weeks=40] [tasksPerPerson=20]
// Needs a server with a demo build:  npx vite preview --port 4173
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const [P, W, TPP] = [Number(process.argv[2] || 100), Number(process.argv[3] || 40), Number(process.argv[4] || 20)];
const sample = JSON.parse(fs.readFileSync(new URL('../marketing/sample-store.json', import.meta.url), 'utf8'));
const team0 = Object.values(sample.teams)[0];

// ── Generate the team ───────────────────────────────────────────────────────
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const FIRST = ['Aisha', 'Tom', 'Priya', 'Leo', 'Mei', 'Ben', 'Sara', 'Omar', 'Lena', 'Raj', 'Chloe', 'Ivan', 'Nora', 'Kofi', 'Yuki', 'Max', 'Ana', 'Sam', 'Zoe', 'Ali'];
const LAST = ['Khan', 'Reed', 'Nair', 'Martins', 'Chen', 'Owusu', 'Silva', 'Haddad', 'Novak', 'Patel', 'Dubois', 'Petrov', 'Berg', 'Mensah', 'Sato', 'Weber'];
const WORDS = ['Wing', 'Spar', 'Motor', 'Telemetry', 'Payload', 'Battery', 'Frame', 'Camera', 'Servo', 'Mission', 'Report', 'Test', 'CAD', 'Wiring', 'Sensor', 'Landing gear'];
const VERBS = ['design', 'review', 'build', 'test', 'order', 'calibrate', 'document', 'simulate', 'assemble', 'fix'];
const mon = new Date(); mon.setHours(12); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) - 7 * Math.floor(W / 2));
const iso = (d) => { const x = new Date(mon); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };
const users = {}, members = {}, categories = {}, tasks = {}, comments = {};
const weeks = Array.from({ length: W }, (_, i) => ({ key: 'wk' + (i + 1), title: 'WEEK ' + (i + 1), metric: '', collapsed: false, startDate: iso(i * 7) }));
const ownerUid = 'u000';
for (let p = 0; p < P; p++) {
  const uid = 'u' + String(p).padStart(3, '0'); const name = pick(FIRST) + ' ' + pick(LAST);
  users[uid] = { uid, email: `p${p}@uni.ac.uk`, name, photo: '', emailVerified: true, provider: 'demo', theme: 'mint' };
  members[uid] = { uid, email: `p${p}@uni.ac.uk`, name, photo: '', roleId: p === 0 ? 'owner' : p < 4 ? 'admin' : 'member', joinedAt: 1 };
  const cats = ['Design', 'Build'].map((c, i) => { const id = `c_${uid}_${i}`; categories[id] = { name: c, ownerUid: uid, order: i }; return id; });
  for (let t = 0; t < TPP; t++) {
    const wk = Math.floor(rnd() * W); const id = `t_${uid}_${t}`; const nsub = Math.floor(rnd() * 5); const done = wk < W / 2 && rnd() < 0.7;
    tasks[id] = { name: pick(WORDS) + ' ' + pick(VERBS) + ' ' + (t + 1), priority: pick(['Minor', 'Minor', 'Major', 'Critical']), status: '', jiraId: rnd() < 0.3 ? 'SKY-' + Math.floor(rnd() * 900) : '',
      supportPersonId: rnd() < 0.15 ? 'u' + String(Math.floor(rnd() * P)).padStart(3, '0') : null, supportPersonId2: null, flag: done ? 'completed' : 'none',
      dueDate: rnd() < 0.7 ? iso(wk * 7 + 4) : '', phaseId: '', repeat: null, stage: '', effort: rnd() < 0.5 ? Math.ceil(rnd() * 10) : null, dependsOn: [], carryOf: '', skill: '', timeLog: [],
      completedDate: done ? iso(wk * 7 + 4) : '', subtasks: Array.from({ length: nsub }, (_, s) => ({ id: `${id}_s${s}`, title: 'Step ' + (s + 1), completed: done || rnd() < 0.4 })),
      history: Array.from({ length: Math.floor(rnd() * 6) }, () => ({ time: '20 Oct', user: name, field: 'Progress', original: '', updated: 'Sub-task done' })),
      custom: {}, icon: '', attachments: [], categoryId: cats[t % 2], ownerUid: uid, weekId: weeks[wk].key, order: t, createdBy: uid, createdAt: 1, updatedBy: name, updatedAt: 1 };
    if (rnd() < 0.08) comments['c_' + id] = { taskId: id, authorUid: uid, authorName: name, text: 'Looks good — can you check the numbers?', mentions: [], createdAt: Date.now() - 3600e3 };
  }
}
const doc = { ...team0.doc, name: `Big team · ${P} people · ${W} weeks`, ownerUid, weeks, phases: [], subteams: [], features: team0.doc.features };
const store = { users, teams: { bigteam: { doc, members, invites: {}, categories, tasks, comments, profiles: {} } } };
const json = JSON.stringify(store);
const nTasks = Object.keys(tasks).length;
console.log(`Team: ${P} people, ${W} weeks, ${nTasks} tasks, ${Object.keys(categories).length} categories, ${Object.keys(comments).length} comments · store ${(json.length / 1024 / 1024).toFixed(2)} MB`);
// Firestore reads when someone opens the team (everything the board listens to):
const reads = 1 + P + Object.keys(categories).length + nTasks + Object.keys(comments).length;
console.log(`Firestore reads to open this team once: ~${reads} (free quota 50,000/day → ~${Math.floor(50000 / reads)} board loads/day for ALL teams together; then $0.06 per 100k reads ≈ $${(reads * 0.06 / 100000).toFixed(4)} per load)`);

// ── Measure ─────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.dismiss());
await page.goto(BASE);
await page.evaluate(({ s, uid }) => { localStorage.clear(); localStorage.setItem('tt_demo_store_v1', s); sessionStorage.setItem('tt_demo_session_v1', JSON.stringify({ uid })); }, { s: json, uid: ownerUid });
await page.reload(); await page.waitForSelector('#home-screen:not([hidden])');
const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
const ms = (t) => Math.round(t) + ' ms';
const results = [];
async function measure(label, fn, budget) {
  const prof = process.env.PROFILE && label.startsWith(process.env.PROFILE);
  if (prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const t0 = Date.now(); await fn(); const t = Date.now() - t0;
  if (prof) {
    const { profile } = await cdp.send('Profiler.stop'); const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
    const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId.get(id); const k = (n.callFrame.functionName || '(anon)') + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    console.log('    top self time in "' + label + '":'); [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).forEach(([k, v]) => console.log('     ', (v / 1000).toFixed(0).padStart(6) + ' ms', (100 * v / total).toFixed(0).padStart(3) + '%', k));
    // also inclusive time per function name
    const parent = new Map(); profile.nodes.forEach(n => (n.children || []).forEach(c => parent.set(c, n.id)));
    const incl = new Map(); profile.samples.forEach((id, i) => { const seen = new Set(); let x = id; while (x) { const n = byId.get(x); const k = (n.callFrame.functionName || '(anon)') + ' ' + n.callFrame.url.split('/').pop(); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + (dt[i] || 0)); } x = parent.get(x); } });
    console.log('    inclusive:'); [...incl.entries()].filter(([k]) => !/^\(|^ /.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log('     ', (v / 1000).toFixed(0).padStart(6) + ' ms', k));
  }
  results.push({ label, t, budget, ok: t <= budget }); console.log(`${t <= budget ? '  ✓' : '  ✗'} ${label.padEnd(44)} ${ms(t).padStart(9)}  (target ≤ ${budget} ms)`);
}
const idle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));

await measure('Open the team (home → board drawn)', async () => { await page.click('.team-tile'); await page.waitForSelector('.task-card'); await idle(); }, 3000);
await page.waitForTimeout(800);
await measure('Redraw the whole board', async () => { await page.evaluate(() => render()); await idle(); }, 600);
const first = page.locator('.task-card').first();
await measure('Open a task in the editor', async () => { await first.click(); await page.waitForSelector('#edit-form', { state: 'visible' }); await idle(); }, 400);
await measure('Tick a sub-task (save + redraw)', async () => {
  await page.evaluate(() => { const loc = allTaskLocs().find(l => (l.task.subtasks || []).length); loc.task.subtasks[0].completed = !loc.task.subtasks[0].completed; saveDatabase(); render(); }); await idle();
}, 500);
await measure('Rename a task (one keystroke saved)', async () => { await page.evaluate(() => { const l = allTaskLocs()[5]; l.task.name += 'x'; saveDatabase('perf'); }); await idle(); }, 300);
await measure('Open Analytics', async () => { await page.evaluate(() => openAnalytics('overview')); await page.waitForSelector('#analytics-overlay'); await idle(); }, 1500);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await measure('Switch to Kanban', async () => { await page.evaluate(() => boardSetView('kanban')); await idle(); }, 1200);
await measure('Switch back to Board', async () => { await page.evaluate(() => boardSetView('board')); await idle(); }, 1500);
await measure('Search for a task (Ctrl+K, type)', async () => { await page.evaluate(() => TT.openSearch()); await page.keyboard.type('Motor', { delay: 0 }); await page.waitForTimeout(50); await idle(); }, 600);
await page.keyboard.press('Escape');
const m = await cdp.send('Performance.getMetrics'); const g = (n) => (m.metrics.find(x => x.name === n) || {}).value;
const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
console.log(`  · Memory used ${(g('JSHeapUsedSize') / 1048576).toFixed(0)} MB · DOM elements ${dom} · page errors ${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
const bad = results.filter(r => !r.ok);
console.log(bad.length ? `\n${bad.length} of ${results.length} actions are slower than the target.` : `\nAll ${results.length} actions within target.`);
fs.writeFileSync(`/tmp/perf-${P}x${W}.json`, JSON.stringify({ P, W, nTasks, reads, results, memMB: g('JSHeapUsedSize') / 1048576, dom, errors }, null, 1));
