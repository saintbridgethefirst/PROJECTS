// Collects the English words people see in the app, by opening (almost) every screen of the demo
// with the sample team, so they can be translated (src/i18n/*.json).
//   npx vite preview --port 4173 &   node tools/i18n-collect.mjs
// Writes tools/i18n-strings.json: { text: count }. Numbers become {n} (one key for "3 comments").
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const found = new Map();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage(); p.on('dialog', d => d.dismiss());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SKIP = (await import('../src/i18n-skip.js')).SKIP_SELECTOR;

async function grab(label) {
  const list = await p.evaluate((skip) => {
    const out = [];
    const ok = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; return e && !e.closest(skip) && !e.closest('script,style,svg,code,pre'); };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (t && /[A-Za-z]{2}/.test(t) && ok(n) && n.parentElement && n.parentElement.offsetParent !== null) out.push(t); }
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(e => { if (!ok(e)) return; ['placeholder', 'title', 'aria-label'].forEach(a => { const v = (e.getAttribute(a) || '').trim(); if (v && /[A-Za-z]{2}/.test(v)) out.push(v); }); });
    return out;
  }, SKIP);
  list.forEach(t => { const k = t.replace(/\s+/g, ' ').replace(/\d+([.,]\d+)?/g, '{n}'); if (k.length <= 400) found.set(k, (found.get(k) || 0) + 1); });
  console.log(label.padEnd(28), found.size);
}
const esc = async () => { await p.keyboard.press('Escape').catch(() => {}); await p.evaluate(() => document.querySelectorAll('.modal-overlay, #analytics-overlay').forEach(m => m.remove())); await sleep(100); };

await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])'); await sleep(400); await grab('sign-in');
await p.fill('#auth-actions input[placeholder="Your name"]', 'Visitor'); await p.fill('#auth-actions input[type=email]', 'v@uni.ac.uk');
await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])'); await sleep(400); await grab('home');
await p.click('#demo-sample'); await p.waitForSelector('.task-card'); await sleep(1500); await grab('board');
await p.evaluate(() => document.querySelector('.tour, #tour, .tour-pop')?.remove());
for (const v of ['kanban', 'gantt', 'board']) { await p.evaluate((v) => boardSetView(v), v); await sleep(500); await grab('view ' + v); }
for (const t of ['overview', 'team', 'deadlines', 'planning', 'timeline', 'subteams']) { await p.evaluate((t) => openAnalytics(t), t).catch(() => {}); await sleep(400); await grab('analytics ' + t); }
await esc();
await p.locator('.task-card').first().click(); await sleep(500); await grab('editor');
await p.locator('.task-card').first().click({ button: 'right' }); await sleep(300); await grab('menu');
for (const label of ['Priority', 'Stage', 'GitHub', 'Move to week', 'Status']) { const b = p.locator('#quick-menu button', { hasText: label }).first(); if (await b.count()) { await b.hover().catch(() => {}); await sleep(200); await grab('submenu ' + label); } }
await esc();
await p.locator('.node-cat').first().click({ button: 'right' }); await sleep(300); await grab('category menu'); await esc();
await p.locator('.node-person').first().click({ button: 'right' }); await sleep(300); await grab('person menu'); await esc();
await p.locator('.header-week').first().click({ button: 'right' }).catch(() => {}); await sleep(300); await grab('week menu'); await esc();
await p.evaluate(() => TT.openResearch()); await sleep(400);
for (const t of await p.$$eval('.rs-tab', b => b.map(x => x.dataset.tab))) { await p.click(`.rs-tab[data-tab="${t}"]`); await sleep(350); await grab('tool ' + t); }
await esc();
await p.evaluate(() => TT.openSettings('general')); await p.waitForSelector('.settings-nav');
const n = await p.locator('.settings-nav button').count();
for (let i = 0; i < n; i++) { await p.locator('.settings-nav button').nth(i).click(); await sleep(350); await grab('settings ' + i); }
await esc();
for (const [name, fn] of [['search', () => TT.openSearch()], ['activity', () => TT.openActivity('activity')], ['mentions', () => TT.openActivity('mentions')], ['approvals', () => openApprovals()], ['presence', () => TT.openPresence()], ['account', () => TT.openAccount()], ['themes', () => TT.openThemes()], ['share', () => TT.openShare()], ['ai', () => TT.openAI()], ['feedback', () => TT.openFeedback()], ['invite', () => TT.openSettings('members')]]) {
  await p.evaluate(fn).catch(() => {}); await sleep(450); await grab(name); await esc();
}
await p.click('#wb-btn').catch(() => {}); await sleep(800); await grab('whiteboards');
await p.locator('.wb-board-card, .wb-list button').first().click().catch(() => {}); await sleep(800); await grab('whiteboard'); await esc();
await p.goto(BASE + '#/me'); await sleep(1200); await grab('selftrack');
await p.goto(BASE + '#/'); await sleep(800); await grab('home again');
await browser.close();
const sorted = Object.fromEntries([...found.entries()].sort((a, b) => a[0].localeCompare(b[0])));
fs.writeFileSync(new URL('./i18n-strings.json', import.meta.url), JSON.stringify(sorted, null, 1));
console.log('strings:', found.size);
