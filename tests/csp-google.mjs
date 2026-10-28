// Google's own scripts under the site's script policy (firebase.json): the Firebase Auth popup's iframe
// library (apis.google.com), Google sign-in for Drive and Calendar (accounts.google.com/gsi) and App
// Check's reCAPTCHA Enterprise. They load from Google, so this needs the internet: GitHub runs it before
// every deploy. Without a connection (this workspace) it says so and passes.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);

const online = await fetch('https://apis.google.com/js/api.js', { signal: AbortSignal.timeout(6000) }).then(r => r.ok).catch(() => false);
if (!online) { console.log('▸ Skipped: Google can’t be reached from here (GitHub runs this before deploying).'); console.log('RESULT: 0 passed, 0 failed'); process.exit(0); }

const env = Object.fromEntries(fs.readFileSync(new URL('../.env.live', import.meta.url), 'utf8').split('\n').filter(l => /^VITE_\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const headers = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')).hosting.headers.find(h => h.source === '**').headers.map(h => [h.key, h.value]));
const harness = `
window.violations = [];
document.addEventListener('securitypolicyviolation', (e) => violations.push(e.effectiveDirective + ' ' + (e.blockedURI || 'inline') + ' ' + (e.sourceFile || '')));
const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.append(s); });
window.run = async ({ apiKey, authDomain, clientId, siteKey }) => {
  const out = {};
  // Firebase Auth's signInWithPopup: Google's iframe library, then the auth iframe on the auth domain
  await new Promise((res, rej) => { window.__gapiReady = res; load('https://apis.google.com/js/api.js?onload=__gapiReady').catch(rej); });
  await new Promise((res, rej) => gapi.load('gapi.iframes', { callback: res, onerror: rej, timeout: 20000, ontimeout: () => rej(new Error('gapi timeout')) }));
  out.gapi = typeof gapi.iframes.getContext === 'function';
  await new Promise((res) => { gapi.iframes.getContext().open({ where: document.body, url: 'https://' + authDomain + '/__/auth/iframe?apiKey=' + encodeURIComponent(apiKey) + '&appName=%5BDEFAULT%5D&v=12.0.0', messageHandlersFilter: gapi.iframes.CROSS_ORIGIN_IFRAMES_FILTER, attributes: { style: { position: 'absolute', top: '-100px', width: '1px', height: '1px' } }, dontclear: true }, () => res()); setTimeout(res, 8000); });
  // Google sign-in for Drive and Calendar
  await load('https://accounts.google.com/gsi/client');
  out.gis = !!(window.google && google.accounts && google.accounts.oauth2);
  if (out.gis && clientId) google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.file', callback: () => {} });
  // App Check: reCAPTCHA Enterprise (this address isn't on the key, so the token itself may be refused)
  if (siteKey) {
    await load('https://www.google.com/recaptcha/enterprise.js?render=' + encodeURIComponent(siteKey));
    await new Promise((res) => grecaptcha.enterprise.ready(res));
    out.recaptcha = await grecaptcha.enterprise.execute(siteKey, { action: 'csp_check' }).then(() => 'token', (e) => 'loaded (' + e + ')');
  }
  await new Promise(r => setTimeout(r, 2500));   // let anything they load after start up
  return out;
};`;
const server = http.createServer((req, res) => {
  if (req.url === '/harness.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', ...headers }); res.end(harness); return; }
  res.writeHead(200, { 'Content-Type': 'text/html', ...headers }); res.end('<!doctype html><html><head><meta charset="utf-8"><script src="/harness.js"></script></head><body><p>CSP check</p></body></html>');
});
await new Promise(r => server.listen(4199, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
// Only the policy can fail this test: Google being slow or refusing a token (this address isn't on the
// reCAPTCHA key) is reported, not counted, so it never holds up a deploy on its own.
step('Firebase sign-in, Google sign-in and App Check scripts load under the policy');
const p = await browser.newPage();
p.on('pageerror', e => console.log('    (a Google script reported: ' + e.message.slice(0, 160) + ')'));
p.on('console', m => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) errors.push('CSP: ' + m.text().slice(0, 300)); });
await p.goto('http://127.0.0.1:4199/');
try {
  const out = await p.evaluate((cfg) => window.run(cfg), { apiKey: env.VITE_FIREBASE_API_KEY || '', authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'uni-teamtrack.firebaseapp.com', clientId: env.VITE_GOOGLE_CLIENT_ID || '', siteKey: env.VITE_RECAPTCHA_SITE_KEY || '' });
  console.log('   ', JSON.stringify(out));
  ok(out.gapi, 'Firebase Auth’s iframe library (apis.google.com) runs');
  ok(out.gis, 'Google sign-in (accounts.google.com/gsi) runs');
  ok(!env.VITE_RECAPTCHA_SITE_KEY || !!out.recaptcha, 'reCAPTCHA Enterprise runs');
} catch (e) { console.log('    (couldn’t finish: ' + e.message.split('\n')[0].slice(0, 200) + ')'); }
const v = await p.evaluate(() => window.violations).catch(() => []);
ok(v.length === 0, 'nothing blocked by the policy: ' + JSON.stringify(v).slice(0, 400));
if (errors.length) { fail++; console.log('  ✗ page errors:', errors.slice(0, 6)); }
await browser.close(); server.close();
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
