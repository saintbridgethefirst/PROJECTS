// ─────────────────────────────────────────────────────────────────────────────
//  Error monitoring: crashes in anyone's browser are recorded (clientErrors) so
//  the platform admin sees them in Settings ▸ Plan ▸ Platform admin. No personal
//  data: the message, where it happened, the browser, the build — never task text.
//  At most 10 reports per page load; the same message only once.
// ─────────────────────────────────────────────────────────────────────────────
/* global __BUILD_ID__ */
const BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
const MAX = 10;
let sent = 0; const seen = new Set(); let send = null; let who = () => '';

/** Strip anything that could hold personal data: query strings, hashes, emails, long numbers. */
export function scrub(s, max) {
  return String(s || '').replace(/[?#][^\s)]*/g, '').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>').replace(/\b\d{6,}\b/g, '<n>').slice(0, max);
}
/** Turn an error event into the stored shape (exported for tests). */
export function errorDoc(kind, err, extra = {}) {
  const msg = scrub((err && (err.message || err.reason || err)) || 'Unknown error', 300);
  return {
    kind, msg, stack: scrub(err && err.stack, 2000), where: scrub(extra.where || (typeof location !== 'undefined' && typeof location.hash === 'string' ? location.hash.split('/').slice(0, 2).join('/') : ''), 100),
    ua: scrub(typeof navigator !== 'undefined' ? navigator.userAgent : '', 200), build: BUILD, at: Date.now(), uid: who() || '',
  };
}
/** Ignore noise we can't act on: browser extensions, cancelled loads, ResizeObserver chatter. */
export function ignorable(msg, stack) {
  const s = (msg || '') + ' ' + (stack || '');
  return /chrome-extension:|moz-extension:|safari-extension:|ResizeObserver loop|Script error\.?$|AbortError|Load failed|Failed to fetch dynamically imported module/i.test(s);
}
export function report(kind, err, extra) {
  if (!send || sent >= MAX) return;
  const d = errorDoc(kind, err, extra);
  if (ignorable(d.msg, d.stack)) return;
  const key = kind + '|' + d.msg; if (seen.has(key)) return; seen.add(key);
  sent++; recent.push(kind + ': ' + d.msg); if (recent.length > 5) recent.shift();
  try { Promise.resolve(send(d)).catch(() => {}); } catch { /* never let reporting break the app */ }
}
const recent = [];
/** The last few errors on this page (already scrubbed), sent along with feedback. */
export const recentErrors = () => recent.slice();
export const buildId = () => BUILD;
/** Start listening. sender(doc) stores a report; uid() returns the signed-in user's id (or ''). */
export function startMonitor(sender, uid) {
  send = sender; who = uid || who;
  window.addEventListener('error', (e) => report('error', e.error || { message: e.message, stack: (e.filename || '') + ':' + e.lineno }));
  window.addEventListener('unhandledrejection', (e) => report('promise', e.reason || { message: 'Unhandled rejection' }));
}
