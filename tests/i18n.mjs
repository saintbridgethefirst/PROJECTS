// Languages: the interface follows the chosen language (Spanish, French, German, Chinese) while
// what people wrote stays as written; switching back to English in Your account.
// Needs the preview server: npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

try {
  step('Sign in in English, then pick Français in the footer');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  ok(await p.evaluate(() => document.documentElement.lang) === 'en-GB', 'English by default for an English browser');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Visitor Vee'); await p.fill('#auth-actions input[type=email]', 'vee@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.click('#demo-sample'); await p.waitForSelector('.task-card'); await sleep(800);
  await p.evaluate(() => localStorage.setItem('tt_lang', 'fr')); await p.reload(); await p.waitForSelector('.task-card'); await sleep(1200);
  ok(await p.evaluate(() => document.documentElement.lang) === 'fr', 'page language is fr');
  const body = await p.evaluate(() => document.body.innerText);
  ok(/Ajouter une tâche/.test(body), 'board buttons in French');
  ok(/Filtrer par personne/i.test(body), 'side panel in French');
  ok(/Weld the frame|Target detection model|Wing CAD/.test(body), 'task names stay as written');
  ok((await p.getAttribute('#search-tasks', 'placeholder')).includes('Rechercher des tâches par titre, ID ou badge'), 'placeholders too');

  step('New things drawn later are translated too (menus, dialogs)');
  await p.locator('.task-card').nth(3).click({ button: 'right' }); await sleep(300);
  const menu = await p.evaluate(() => document.getElementById('quick-menu').innerText);
  ok(/Dupliquer/.test(menu) && /Supprimer la tâche/.test(menu), 'right-click menu: ' + menu.slice(0, 80).replace(/\n/g, ' | '));
  await p.keyboard.press('Escape');
  await p.evaluate(() => TT.openSettings('general')); await p.waitForSelector('.settings-nav'); await sleep(300);
  const nav = await p.evaluate(() => document.querySelector('.settings-nav').innerText);
  ok(/Général/.test(nav) && /Membres/.test(nav), 'settings: ' + nav.replace(/\n/g, ', '));
  await p.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(m => m.remove()));

  step('Back to English from Your account');
  await p.evaluate(() => TT.openAccount('appearance')); await p.waitForSelector('#acct-lang');
  await Promise.all([p.waitForEvent('load'), p.selectOption('#acct-lang', 'en')]);
  await p.waitForSelector('.task-card'); await sleep(800);
  ok(/Add task/.test(await p.evaluate(() => document.body.innerText)), 'English again');

  step('A Chinese browser starts in Chinese');
  const zh = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'zh-CN' });
  const q = await zh.newPage(); q.on('pageerror', e => errors.push('zh: ' + e.message));
  await q.goto(BASE); await q.waitForSelector('#auth-screen:not([hidden])'); await sleep(600);
  ok(await q.evaluate(() => document.documentElement.lang) === 'zh-CN', 'zh-CN from the browser');
  ok(/登录演示|试用在线演示/.test(await q.evaluate(() => document.body.innerText)), 'sign-in screen in Chinese');
  for (const l of ['es', 'de']) {
    await q.evaluate((l) => localStorage.setItem('tt_lang', l), l); await q.reload(); await q.waitForSelector('#auth-screen:not([hidden])'); await sleep(500);
    const t = await q.evaluate(() => document.body.innerText);
    ok(l === 'es' ? /Prueba la demo en vivo|Entrar en la demo/.test(t) : /Probier die Live-Demo|In der Demo anmelden/.test(t), l + ' sign-in screen');
  }
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
