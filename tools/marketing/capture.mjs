// Screenshots of every feature using the sample team (run seed.mjs first).
// Needs a server:  npx vite --port 5173      Output: marketing/video-kit/*.jpg (not part of the website)
//   node tools/marketing/capture.mjs [only-this-shot]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const OUT = new URL('../../marketing/video-kit/', import.meta.url).pathname;
const RAW = '/tmp/tt-shots/'; fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(RAW, { recursive: true });
const STORE = fs.readFileSync(new URL('./sample-store.json', import.meta.url), 'utf8');
const THEME = process.env.THEME || 'mint';
const only = process.argv[2] || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

/** A page signed in as `who` (first name) on the sample team. */
export async function openAs(context, who = 'Aisha', { theme = THEME, board = true } = {}) {
  const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.dismiss());
  const s = JSON.parse(STORE); const u = Object.values(s.users).find(x => x.name.startsWith(who));
  Object.values(s.users).forEach(x => { x.theme = theme; });
  await p.goto(BASE);
  await p.evaluate(({ store, uid }) => { localStorage.clear(); localStorage.setItem('tt_demo_store_v1', store); sessionStorage.setItem('tt_demo_session_v1', JSON.stringify({ uid })); localStorage.setItem('tt_install_dismissed', '1'); }, { store: JSON.stringify(s), uid: u.uid });
  await p.reload(); await p.waitForSelector('#home-screen:not([hidden])');
  await p.addStyleTag({ content: '#demo-banner, #install-banner, #verify-banner { display: none !important; }' });
  if (board) { await p.click('.team-tile'); await p.waitForSelector('.node-cat'); await sleep(900); }
  return p;
}
const save = async (p, name, clip) => {
  const raw = RAW + name + '.png'; await p.screenshot({ path: raw, clip });
  const vw = p.viewportSize().width; const scale = vw >= 2000 ? ['-vf', 'scale=1920:-1:flags=lanczos'] : [];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, ...scale, '-q:v', '3', OUT + name + '.jpg']);
  console.log('  ✓', name);
};
const centreOn = (p, sel) => p.locator(sel).first().evaluate(e => e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
const card = (p, name, i = 0) => p.locator('.task-card', { hasText: name }).nth(i);
const esc = async (p) => { await p.keyboard.press('Escape'); await sleep(250); };
const tool = async (p, tab) => { if (!(await p.locator('.research-modal').count())) { await p.click('#research-btn'); await p.waitForSelector('.research-modal'); } await p.click(`.rs-tab[data-tab="${tab}"]`); await sleep(500); };

const SHOTS = {
  async '01-signin'(c) { const p = await c.newPage(); await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.reload(); await p.waitForSelector('#auth-screen:not([hidden])'); await p.addStyleTag({ content: '.banner { display: none !important; }' }); await sleep(600); await save(p, '01-signin'); },
  async '02-home'(c) { const p = await openAs(c, 'Aisha', { board: false }); await sleep(600); await save(p, '02-home'); },
  async '03-board'(c, w) { const p = await openAs(w); await p.evaluate(() => toggleSidebar()); await sleep(300); await p.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach(e => { if (e.scrollLeft) e.scrollLeft = 0; }); }); await sleep(900); await save(p, '03-board'); },
  async '03b-team'(c) { const big = await browser.newContext({ viewport: { width: 3200, height: 1800 } }); const p = await openAs(big); await p.evaluate(() => toggleSidebar()); await sleep(500); await p.evaluate(() => window.scrollTo(0, 0)); await sleep(400); await save(p, '03b-whole-team'); await big.close(); },
  async '04-task-editor'(c) {
    const p = await openAs(c); await p.evaluate(() => scrollToToday()); await sleep(500);
    await centreOn(p, '.task-card:has-text("Wing CAD v2") >> nth=1'); await card(p, 'Wing CAD v2', 1).click(); await sleep(900); await save(p, '04-task-editor');
    await p.locator('#edit-form .linked-section').evaluate(e => e.scrollIntoView({ block: 'start' })); await sleep(400); await save(p, '05-linked-notebook');
  },
  async '06-comments'(c) { const p = await openAs(c); await centreOn(p, '.task-card:has-text("Order carbon tubes")'); await card(p, 'Order carbon tubes').click(); await sleep(800); await p.locator('#edit-form .cm-item').last().evaluate(e => e.scrollIntoView({ block: 'center' })); await sleep(400); await save(p, '06-comments'); },
  async '07-right-click'(c) { const p = await openAs(c); await p.evaluate(() => scrollToToday()); await sleep(400); await centreOn(p, '.task-card:has-text("Drop mechanism v2")'); await card(p, 'Drop mechanism v2').click({ button: 'right' }); await sleep(600); await save(p, '07-right-click'); },
  async '08-subteams'(c, w) { const p = await openAs(w); await p.evaluate(() => toggleSidebar()); await p.locator('#subteam-bar button', { hasText: 'Electronics' }).click(); await sleep(700); await p.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach(e => { if (e.scrollLeft) e.scrollLeft = 0; }); }); await sleep(600); await save(p, '08-subteams'); },
  async '09-kanban'(c, w) { const p = await openAs(w); await p.evaluate(() => toggleSidebar()); await p.evaluate(() => boardSetView('kanban')); await sleep(900); await save(p, '09-kanban'); },
  async '10-analytics'(c) {
    const p = await openAs(c); await p.evaluate(() => openAnalytics('overview')); await sleep(1300); await save(p, '10-analytics');
    for (const [tab, name] of [['planning', '11-planning'], ['subteams', '12-analytics-subteams'], ['timeline', '13-timeline']]) { await p.click(`.an-tab[data-tab="${tab}"]`); await sleep(1200); await save(p, name); }
  },
  async '14-tools'(c) {
    const p = await openAs(c);
    for (const [tab, name] of [['meetings', '14-meetings'], ['parts', '15-parts'], ['finance', '16-finance'], ['literature', '17-literature'], ['people', '18-people'], ['time', '19-timesheet'], ['risks', '20-risks'], ['requirements', '21-requirements']]) { await tool(p, tab); await sleep(400); await save(p, name); }
  },
  async '22-search'(c) { const p = await openAs(c); await p.evaluate(() => TT.openSearch()); await sleep(400); await p.keyboard.type('carbon', { delay: 60 }); await sleep(700); await save(p, '22-search'); },
  async '23-activity'(c) { const p = await openAs(c, 'Tom'); await p.evaluate(() => TT.openActivity()); await sleep(800); await save(p, '23-activity'); },
  async '24-ai'(c) { const p = await openAs(c); await p.evaluate(() => TT.openAI()); await sleep(900); await save(p, '24-ai'); },
  async '25-invite'(c) { const p = await openAs(c); await p.evaluate(() => TT.openSettings('members')); await sleep(500); await p.fill('.settings-pane textarea', 'sam.jones@uni.ac.uk'); await p.click('.settings-pane button:has-text("Invite")'); await sleep(1200); await save(p, '25-invite'); },
  async '26-plan'(c) { const p = await openAs(c); await p.evaluate(() => TT.openSettings('plan')); await sleep(800); await save(p, '26-plan'); },
  async '27-weeks'(c, w) { const p = await openAs(w); await p.evaluate(() => toggleSidebar()); await sleep(400); await p.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach(e => { if (e.scrollLeft) e.scrollLeft = 0; }); }); await sleep(300); const bb = await p.locator('.header-week').first().boundingBox(); await p.mouse.click(bb.x + bb.width - 30, bb.y + bb.height - 12, { button: 'right' }); await sleep(600); await save(p, '27-weeks'); },
  async '28-phone'(c) { const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await openAs(ph); await p.evaluate(() => scrollToToday()); await sleep(800); await save(p, '28-phone'); await ph.close(); },
  async '29-themes'(c, w) { const p = await openAs(w, 'Aisha', { theme: 'midnight' }); await p.evaluate(() => toggleSidebar()); await p.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach(e => { if (e.scrollLeft) e.scrollLeft = 0; }); }); await sleep(900); await save(p, '29-dark-theme'); },
  async '30-guide'(c) { const p = await c.newPage(); await p.goto(BASE + 'guide.html'); await sleep(1200); await save(p, '30-guide'); },
};

try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const wide = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  for (const [name, fn] of Object.entries(SHOTS)) {
    if (only && !name.includes(only)) continue;
    try { await fn(context, wide); } catch (e) { console.log('  ✗', name, e.message.split('\n')[0]); }
    for (const pg of [...context.pages(), ...wide.pages()]) await pg.close();
  }
} catch (e) { console.log('CAPTURE CRASH:', e.message); }
console.log('page errors:', [...new Set(errors)].slice(0, 10));
await browser.close();
