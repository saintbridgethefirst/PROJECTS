// Your own look for the home page: Friendly (emoji) or Professional (line icons), picked in the
// Theme panel and remembered on this device. Teams keep the look their owner chose.
// Needs the preview server:  npx vite preview --port 4173
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
p.on('pageerror', e => errors.push(e.message));
const pro = () => p.evaluate(() => document.body.classList.contains('look-pro'));
try {
  step('Home page, Friendly by default');
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  await p.fill('#auth-actions input[placeholder="Your name"]', 'Aisha Khan'); await p.fill('#auth-actions input[type=email]', 'aisha@uni.ac.uk');
  await p.click('#auth-actions button:has-text("Sign in to demo")'); await p.waitForSelector('#home-screen:not([hidden])');
  await p.click('#demo-sample'); await p.waitForSelector('.task-card', { timeout: 20000 }); await sleep(800);
  await p.evaluate(() => document.querySelectorAll('[class*=tour-]').forEach(e => e.remove()));
  await p.evaluate(() => TT.goHome()); await p.waitForSelector('#home-screen:not([hidden])'); await sleep(800);
  ok(!(await pro()), 'Friendly to start');

  step('Theme ▸ Home page look ▸ Professional');
  await p.click('#home-theme'); await p.waitForSelector('.look-opt');
  ok(await p.locator('.look-opt.on').getAttribute('data-look') === 'friendly', 'Friendly is selected');
  await p.click('.look-opt[data-look="professional"]'); await sleep(300);
  ok(await pro(), 'the home page switches straight away');
  await p.keyboard.press('Escape'); await sleep(400);
  ok(await p.locator('#home-guide .look-ico, #home-theme .look-ico').count() === 2, 'header buttons get line icons');
  ok(await p.locator('.mt-row .mt-prio .emo-ico').count() > 0, 'My tasks show priority as line icons');

  step('Remembered, and teams keep their own look');
  await p.reload(); await p.waitForSelector('#home-screen:not([hidden])'); await sleep(800);
  ok(await pro(), 'still Professional after a reload');
  await p.locator('.team-tile').first().click(); await p.waitForSelector('.task-card', { timeout: 20000 }).catch(() => {}); await sleep(800);
  ok(!(await pro()), 'the drone team keeps its Friendly look');
  await p.evaluate(() => TT.goHome()); await p.waitForSelector('#home-screen:not([hidden])'); await sleep(600);
  ok(await pro(), 'back home: Professional again');
} catch (e) { fail++; console.log('  ✗ ERROR:', e.message.split('\n')[0]); }
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 5)); }
await browser.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
