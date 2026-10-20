// Short screen-recorded clips (MP4, 1920×1080) of the sample team, with a visible cursor.
// Needs seed.mjs run first and a server:  npx vite --port 5173
//   node tools/marketing/clips.mjs [only-this-clip]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const OUT = new URL('../../marketing/video-kit/', import.meta.url).pathname;
const TMP = '/tmp/tt-clips/'; fs.mkdirSync(OUT, { recursive: true }); fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
const STORE = fs.readFileSync(new URL('./sample-store.json', import.meta.url), 'utf8');
const only = process.argv[2] || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

// A cursor drawn in the page (screen recordings don't show the real one) with a ripple on click.
const CURSOR = `(() => { const add = () => { if (document.getElementById('fake-cursor')) return;
  const c = document.createElement('div'); c.id = 'fake-cursor';
  c.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#14213d" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  c.style.cssText = 'position:fixed;left:-50px;top:-50px;z-index:2147483647;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));transition:transform .08s';
  document.documentElement.appendChild(c);
  const st = document.createElement('style'); st.textContent = '.fc-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #ff6b4a;pointer-events:none;z-index:2147483646;animation:fcr .5s ease-out forwards}@keyframes fcr{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}';
  document.documentElement.appendChild(st);
  addEventListener('mousemove', e => { c.style.left = (e.clientX - 3) + 'px'; c.style.top = (e.clientY - 2) + 'px'; }, true);
  addEventListener('mousedown', e => { c.style.transform = 'scale(.85)'; const r = document.createElement('div'); r.className = 'fc-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
  addEventListener('mouseup', () => { c.style.transform = ''; }, true); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add(); })();`;

let mx = 960, my = 540;
async function moveTo(p, loc, { dx = 0, dy = 0 } = {}) {
  await loc.evaluate(e => e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })); await sleep(150);
  const b = await loc.boundingBox(); const x = b.x + b.width / 2 + dx, y = b.y + b.height / 2 + dy;
  const steps = Math.max(12, Math.round(Math.hypot(x - mx, y - my) / 22));
  await p.mouse.move(x, y, { steps }); mx = x; my = y; await sleep(180);
}
async function click(p, loc, opts = {}) { await moveTo(p, loc, opts); await p.mouse.down({ button: opts.button || 'left' }); await sleep(70); await p.mouse.up({ button: opts.button || 'left' }); await sleep(opts.after ?? 600); }

async function record(name, fn, { width = 1920, height = 1080 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, recordVideo: { dir: TMP + name, size: { width, height } } });
  await ctx.addInitScript(CURSOR);
  const t0 = Date.now();
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(name + ': ' + e.message)); p.on('dialog', d => d.dismiss());
  const s = JSON.parse(STORE); const u = Object.values(s.users).find(x => x.name.startsWith('Aisha')); Object.values(s.users).forEach(x => { x.theme = 'mint'; });
  await p.goto(BASE);
  await p.evaluate(({ store, uid }) => { localStorage.clear(); localStorage.setItem('tt_demo_store_v1', store); sessionStorage.setItem('tt_demo_session_v1', JSON.stringify({ uid })); }, { store: JSON.stringify(s), uid: u.uid });
  await p.reload(); await p.waitForSelector('#home-screen:not([hidden])');
  await p.addStyleTag({ content: '#demo-banner, #install-banner, #verify-banner { display: none !important; }' });
  await p.click('.team-tile'); await p.waitForSelector('.node-cat'); await sleep(1200);
  mx = 960; my = 540; await p.mouse.move(mx, my);
  const start = (Date.now() - t0) / 1000;
  await fn(p); await sleep(1200);
  const video = p.video(); await ctx.close();
  const webm = await video.path();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', start.toFixed(2), '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', OUT + name + '.mp4']);
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT + name + '.mp4']).toString().trim();
  console.log('  ✓', name, Number(dur).toFixed(1) + 's');
}

const card = (p, name, i = 0) => p.locator('.task-card', { hasText: name }).nth(i);
const CLIPS = {
  async 'clip-01-board-tour'(p) {
    await p.evaluate(() => toggleSidebar()); await sleep(600);
    await p.evaluate(() => window.scrollTo({ left: 0, top: 0 })); await sleep(500);
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 260); await sleep(380); }
    await sleep(500); await click(p, p.locator('button', { hasText: 'Today' }).first(), { after: 1500 });
  },
  async 'clip-02-tick-subtasks'(p) {
    await p.evaluate(() => scrollToToday()); await sleep(500);
    const c = card(p, 'Critical design review prep');
    for (const t of ['Mass budget', 'Risk summary']) { await click(p, c.locator('.subtask-item', { hasText: t }).first(), { after: 900 }); }
    await sleep(800);
  },
  async 'clip-03-carry-forward'(p) {
    await p.evaluate(() => scrollToToday()); await sleep(500);
    await click(p, card(p, 'Drop mechanism v2'), { button: 'right', after: 900 });
    await click(p, p.locator('#quick-menu.active .qm-btn', { hasText: 'Carry forward' }), { after: 1600 });
    await click(p, card(p, 'Drop mechanism v2', 1), { after: 1200 });
    await p.locator('#edit-form .linked-section').evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'smooth' })); await sleep(1500);
  },
  async 'clip-04-views'(p) {
    await click(p, p.locator('[data-view="kanban"]'), { after: 1800 });
    await p.mouse.wheel(0, 300); await sleep(700);
    await click(p, p.locator('#top-actions button', { hasText: 'Analytics' }), { after: 1800 });
    for (const t of ['planning', 'subteams', 'timeline']) await click(p, p.locator(`.an-tab[data-tab="${t}"]`), { after: 1700 });
  },
  async 'clip-05-subteams'(p) {
    await p.evaluate(() => toggleSidebar()); await sleep(500);
    for (const t of ['Fuselage', 'Electronics', 'Payload', 'Software', 'Everyone']) await click(p, p.locator('#subteam-bar button', { hasText: t }), { after: 1300 });
  },
  async 'clip-06-tools'(p) {
    await click(p, p.locator('#research-btn'), { after: 1000 });
    for (const t of ['parts', 'finance', 'literature', 'risks', 'requirements', 'people']) await click(p, p.locator(`.rs-tab[data-tab="${t}"]`), { after: 1500 });
  },
  async 'clip-07-invite'(p) {
    await click(p, p.locator('#top-actions button', { hasText: 'Invite' }), { after: 900 });
    await click(p, p.locator('.settings-pane textarea'), { after: 300 });
    await p.keyboard.type('sam.jones@uni.ac.uk', { delay: 55 }); await sleep(400);
    await click(p, p.locator('.settings-pane button', { hasText: 'Invite' }), { after: 2000 });
    await p.locator('.settings-pane .inv-sent').first().evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'smooth' })); await sleep(1500);
  },
  async 'clip-08-week-dates'(p) {
    await p.evaluate(() => toggleSidebar()); await sleep(500);
    await p.evaluate(() => window.scrollTo({ left: 0, top: 0 })); await sleep(300);
    { const hw = p.locator('.header-week').first(); const bb = await hw.boundingBox(); await click(p, hw, { button: 'right', after: 900, dx: bb.width / 2 - 30, dy: bb.height / 2 - 12 }); }
    await click(p, p.locator('#quick-menu.active .qm-btn', { hasText: 'Set start date' }), { after: 800 });
    const inp = p.locator('#dialog-overlay input');
    const d = await inp.inputValue(); const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + 7);
    await inp.fill(x.toLocaleDateString('en-CA')); await sleep(700);
    await click(p, p.locator('#dialog-overlay .dlg-ok'), { after: 2200 });
  },
  async 'clip-09-search'(p) {
    await click(p, p.locator('#search-btn'), { after: 600 });
    await p.keyboard.type('carbon', { delay: 110 }); await sleep(1400);
    await p.keyboard.press('ArrowDown'); await sleep(500); await p.keyboard.press('Enter'); await sleep(1600);
  },
};

for (const [name, fn] of Object.entries(CLIPS)) {
  if (only && !name.includes(only)) continue;
  try { await record(name, fn); } catch (e) { console.log('  ✗', name, e.message.split('\n')[0]); }
}
console.log('page errors:', [...new Set(errors)].slice(0, 8));
await browser.close();
