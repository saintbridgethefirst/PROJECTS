// Browser test for the LIVE (Firebase) sign-in screen, using an injected fake backend
// so it runs without a Firebase project. Checks the email + password form, error
// messages, "Forgot password?" and which sign-in options appear.
//   npm run build && npx vite preview --port 4173   (in one terminal)
//   node tests/auth-ui.mjs                          (in another)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const step = (s) => console.log('▸ ' + s);

// Runs inside the page before the app starts.
function installFakeBackend(opts) {
  const calls = []; window.__calls = calls;
  let listener = null; let current = null;
  const userFor = (email, name) => ({ uid: 'u_' + email.replace(/\W/g, ''), email, name: name || email.split('@')[0], photo: '', emailVerified: false, provider: 'password' });
  const fail = (code) => Object.assign(new Error(code), { code });
  window.__TT_TEST_BACKEND__ = {
    isDemo: false,
    auth: {
      providers: { google: true, microsoft: false, password: true, emailLink: !!opts.emailLink, demo: false },
      onChange(fn) { listener = fn; setTimeout(() => fn(current), 0); return () => {}; },
      current: () => current,
      async signInGoogle() { calls.push(['google']); },
      async signInPassword(email, password) {
        calls.push(['signIn', email, password]);
        if (password === 'wrong-pass') throw fail('auth/invalid-credential');
        current = userFor(email); listener(current);
      },
      async signUpPassword(name, email, password) {
        calls.push(['signUp', name, email, password]);
        if (email === 'taken@x.com') throw fail('auth/email-already-in-use');
        current = userFor(email, name); listener(current); return current;
      },
      async resetPassword(email) { calls.push(['reset', email]); },
      async sendEmailLink(email) { calls.push(['link', email]); },
      async signOut() { current = null; listener(null); },
      async sendVerification() { calls.push(['verify']); },
      async reloadUser() { return current; },
      async updateName() {},
    },
    data: {
      watchMyTeams(uid, cb) { setTimeout(() => cb([]), 0); return () => {}; },
      watchMyInvites(email, cb) { setTimeout(() => cb([]), 0); return () => {}; },
    },
  };
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(installFakeBackend, opts);
  await p.goto(BASE); await p.waitForSelector('#auth-screen:not([hidden])');
  return p;
}
const calls = (p) => p.evaluate(() => window.__calls);
const note = (p) => p.textContent('#auth-note');

try {
  step('Sign-in options for a live site');
  let p = await page();
  ok(await p.locator('button:has-text("Continue with Google")').isVisible(), 'Google button shown');
  ok(!(await p.locator('button:has-text("Continue with Microsoft")').count()), 'Microsoft hidden when not configured');
  ok(await p.locator('.auth-tabs button:has-text("Sign in")').isVisible() && await p.locator('.auth-tabs button:has-text("Create account")').isVisible(), 'Sign in / Create account tabs');
  ok(!(await p.locator('button:has-text("Email me a sign-in link")').count()), 'sign-in link hidden by default (free-plan quota)');
  ok(!(await p.locator('button:has-text("Sign in to demo")').count()), 'no demo form on a live site');
  ok(await p.locator('.auth-form input[name=name]').isHidden(), 'name field hidden when signing in');

  step('Validation before anything is sent');
  await p.fill('.auth-form input[name=email]', 'not-an-email'); await p.fill('.auth-form input[name=password]', 'whatever1');
  await p.click('.auth-form button[type=submit]');
  ok((await note(p)).includes('valid email'), 'bad email rejected');
  await p.fill('.auth-form input[name=email]', 'aisha@uni.ac.uk'); await p.fill('.auth-form input[name=password]', '');
  await p.click('.auth-form button[type=submit]');
  ok((await note(p)).includes('Enter your password'), 'empty password rejected');
  ok((await calls(p)).length === 0, 'nothing sent to the server yet');

  step('Wrong password shows a clear message');
  await p.fill('.auth-form input[name=password]', 'wrong-pass'); await p.click('.auth-form button[type=submit]');
  await p.waitForFunction(() => document.querySelector('#auth-note').textContent.length > 0);
  ok((await note(p)) === 'Email or password is incorrect.', 'friendly error: ' + await note(p));

  step('Forgot password');
  await p.fill('.auth-form input[name=email]', ''); await p.click('button:has-text("Forgot password?")');
  ok((await note(p)).includes('Type your email'), 'asks for the email first');
  await p.fill('.auth-form input[name=email]', 'Aisha@Uni.ac.uk'); await p.click('button:has-text("Forgot password?")');
  await p.waitForFunction(() => document.querySelector('#auth-note').textContent.includes('reset email'));
  ok(JSON.stringify((await calls(p)).at(-1)) === JSON.stringify(['reset', 'Aisha@Uni.ac.uk']), 'reset requested for the typed address');
  ok((await note(p)).includes('aisha@uni.ac.uk'), 'confirmation names the (normalised) address');

  step('Successful sign-in opens the home screen');
  await p.fill('.auth-form input[name=password]', 'correct-horse'); await p.click('.auth-form button[type=submit]');
  await p.waitForSelector('#home-screen:not([hidden])');
  ok(JSON.stringify((await calls(p)).at(-1)) === JSON.stringify(['signIn', 'Aisha@Uni.ac.uk', 'correct-horse']), 'signInPassword called with the form values');
  ok(await p.locator('#verify-banner').isVisible(), 'unverified account sees the verify-email banner');

  step('Create account');
  p = await page();
  await p.click('.auth-tabs button:has-text("Create account")');
  ok(await p.locator('.auth-form input[name=name]').isVisible() && !(await p.locator('button:has-text("Forgot password?")').isVisible()), 'name shown, forgot hidden');
  ok((await p.getAttribute('.auth-form input[name=password]', 'autocomplete')) === 'new-password', 'password manager offers a new password');
  await p.fill('.auth-form input[name=email]', 'ben@uni.ac.uk'); await p.fill('.auth-form input[name=password]', 'longenough');
  await p.click('.auth-form button[type=submit]');
  ok((await note(p)).includes('Enter your name'), 'name required');
  await p.fill('.auth-form input[name=name]', 'Ben Okafor'); await p.fill('.auth-form input[name=password]', 'short');
  await p.click('.auth-form button[type=submit]');
  ok((await note(p)).includes('at least 8'), 'short password rejected');
  await p.fill('.auth-form input[name=email]', 'taken@x.com'); await p.fill('.auth-form input[name=password]', 'longenough');
  await p.click('.auth-form button[type=submit]');
  await p.waitForFunction(() => document.querySelector('#auth-note').textContent.includes('already exists'));
  ok(true, 'email-in-use message');
  await p.fill('.auth-form input[name=email]', 'ben@uni.ac.uk'); await p.click('.auth-form button[type=submit]');
  await p.waitForSelector('#home-screen:not([hidden])');
  ok(JSON.stringify((await calls(p)).at(-1)) === JSON.stringify(['signUp', 'Ben Okafor', 'ben@uni.ac.uk', 'longenough']), 'signUpPassword called with name, email, password');
  ok((await p.textContent('#home-account')).includes('Ben Okafor'), 'home shows the new name straight away');
  ok((await p.evaluate(() => [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent).join(' '))).includes('verification email'), 'toast mentions the verification email');

  step('Sign-in link appears only when switched on');
  p = await page({ emailLink: true });
  ok(await p.locator('button:has-text("Email me a sign-in link")').isVisible(), 'link form shown when enabled');
  ok(await p.locator('.auth-tabs').isVisible(), 'password form still shown');

  step('Phone width');
  await p.setViewportSize({ width: 380, height: 760 });
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scrolling at 380px');
} catch (e) {
  fail++; console.log('TEST CRASH:', e.message);
}
console.log('\npage errors:', errors);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
