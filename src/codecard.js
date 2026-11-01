// ─────────────────────────────────────────────────────────────────────────────
//  Waiting for a code from an email (Settings ▸ Plan ▸ your university email).
//
//  A glass card with the Penteint Projects mark, a light running round its five points
//  while the email is on its way, and a box for each digit. Typing the last
//  digit checks the code: five of the digits fly to the mark's five points and
//  the sixth to its middle, the edges draw between them and the light runs round
//  while the server checks. Right: the mark fills, sparks fly and a tick shows.
//  Wrong: it shakes, the digits come back and you can try again.
//  One real input sits over the boxes, so pasting, the phone's "code from Mail"
//  and screen readers work as with any field. src/codecard.css draws it.
// ─────────────────────────────────────────────────────────────────────────────
import { el } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const EDGE = 'M24 7.4 40.2 19.2 34 38.2H14L7.8 19.2Z';
/** The mark's five points and its middle, in its own 48 × 48 drawing. */
const POINTS = [[24, 7.4], [40.2, 19.2], [34, 38.2], [14, 38.2], [7.8, 19.2], [24, 24.4]];
const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function svg(cls, size, parts) {
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 48 48'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  if (size) { s.setAttribute('width', size); s.setAttribute('height', size); }
  parts.forEach(([tag, attrs]) => { const n = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); s.append(n); });
  return s;
}
/** The small mark at the top: the light runs round it while the email is on its way. */
const waitingMark = () => svg('tcode-mark-svg', 40, [
  ['path', { class: 'tcode-face', d: EDGE }], ['path', { class: 'tcode-spark', d: EDGE, pathLength: '100' }],
  ...POINTS.slice(0, 5).map(([cx, cy], i) => ['circle', { class: 'tcode-pt tcode-p' + (i + 1), cx, cy, r: '1.7' }])]);

/**
 * opts = { length = 6, email, inputId, status (the live line under the card),
 *          check(code) → Promise (throws with a message when it's wrong),
 *          resend() → Promise, changeEmail(), done() (after the tick) }
 */
export function codeCard(opts) {
  const n = opts.length || 6;
  const boxes = Array.from({ length: n }, (_, i) => el('span.tcode-box', { 'aria-hidden': 'true', dataset: { i: String(i) } }));
  const input = el('input.tcode-input', { id: opts.inputId || null, type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9 ]*',
    spellcheck: 'false', 'aria-label': 'The ' + n + '-digit code from the email', 'aria-describedby': 'tcode-sub' });
  const logo = svg('tcode-logo', null, [['path', { class: 'tcode-fill', d: EDGE }], ['path', { class: 'tcode-edge', d: EDGE, pathLength: '100' }], ['path', { class: 'tcode-run', d: EDGE, pathLength: '100' }]]);
  const tick = svg('tcode-tick', null, [['path', { d: 'M15.5 24.5 21.5 30.5 33 18.5' }]]);
  const burst = el('div.tcode-burst', { 'aria-hidden': 'true' });
  const stage = el('div.tcode-stage', {}, logo, tick, burst, el('div.tcode-row', {}, ...boxes, input));
  const title = el('h5.tcode-title', {}, 'Check your email');
  const sub = el('p.tcode-sub', { id: 'tcode-sub' }, 'We sent a ' + n + '-digit code to ', el('b', {}, opts.email), '. It works for 15 minutes.');
  const hint = el('p.tcode-hint', { hidden: !opts.hint }, opts.hint || '');
  const resend = el('button.tcode-link', { type: 'button', id: 'tcode-resend' }, 'Resend');
  const other = el('button.tcode-link', { type: 'button', id: 'tcode-other' }, 'Use a different email');
  const card = el('div.tcode', { role: 'group', 'aria-label': 'Code from the email' },
    el('div.tcode-card', {}, el('div.tcode-mark', {}, waitingMark()), title, sub, stage, hint,
      el('p.tcode-foot', {}, 'Not there? Check your Junk folder, or ', resend, ' · ', other)));

  let busy = false, timer = 0;
  const draw = () => {
    const v = input.value; const at = Math.min(v.length, n - 1);
    boxes.forEach((b, i) => { b.textContent = v[i] || ''; b.classList.toggle('filled', !!v[i]); b.classList.toggle('at', document.activeElement === input && i === at && !busy); });
    card.classList.toggle('typing', v.length > 0);
  };
  // Where each box goes: five to the mark's points, the last to its middle
  const place = () => {
    const sr = stage.getBoundingClientRect(), lr = logo.getBoundingClientRect(), k = lr.width / 48;
    boxes.forEach((b, i) => {
      const r = b.getBoundingClientRect(); const [px, py] = POINTS[i % POINTS.length];
      const dx = (lr.left - sr.left + px * k) - (r.left - sr.left + r.width / 2), dy = (lr.top - sr.top + py * k) - (r.top - sr.top + r.height / 2);
      b.style.setProperty('--tx', dx.toFixed(1) + 'px'); b.style.setProperty('--ty', dy.toFixed(1) + 'px'); b.style.setProperty('--d', (i * 45) + 'ms');
    });
  };
  const sparks = () => {
    if (calm()) return;
    const colours = ['#ffffff', '#7dd3fc', '#a78bfa', '#34d399', '#f472b6', '#facc15'];
    burst.replaceChildren(...Array.from({ length: 26 }, (_, i) => {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.4, d = 46 + Math.random() * 70;
      const s = el('i'); s.style.setProperty('--x', (Math.cos(a) * d).toFixed(1) + 'px'); s.style.setProperty('--y', (Math.sin(a) * d).toFixed(1) + 'px');
      s.style.setProperty('--c', colours[i % colours.length]); s.style.setProperty('--s', (3 + Math.random() * 4).toFixed(1) + 'px'); s.style.setProperty('--t', (520 + Math.random() * 380).toFixed(0) + 'ms');
      return s;
    }));
  };
  async function submit() {
    if (busy || input.value.length !== n) return;
    busy = true; input.readOnly = true; draw();
    place(); card.classList.remove('bad'); card.classList.add('morph');
    if (opts.status) opts.status.textContent = 'Checking the code…';
    const t0 = Date.now();
    try {
      await Promise.all([opts.check(input.value), wait(calm() ? 0 : 1050)]);
      card.classList.add('ok'); sparks();
      title.textContent = 'Confirmed'; sub.replaceChildren('Your university email ', el('b', {}, opts.email), ' is confirmed.');
      if (opts.status) opts.status.textContent = 'Confirmed.';
      await wait(calm() ? 300 : 1300);
      if (opts.done) opts.done();
    } catch (err) {
      await wait(calm() ? 0 : Math.max(0, 650 - (Date.now() - t0)));   // long enough to see it try
      card.classList.add('bad');
      if (opts.status) opts.status.textContent = '⚠ ' + ((err && err.message) || 'Could not check the code.');
      await wait(calm() ? 0 : 520);
      card.classList.remove('morph', 'bad');
      input.readOnly = false; input.value = ''; busy = false; draw(); input.focus();
    }
  }
  input.addEventListener('input', () => {
    const v = input.value.replace(/\D/g, '').slice(0, n);
    if (v !== input.value) input.value = v;
    draw(); if (v.length === n) submit();
  });
  ['focus', 'blur', 'keyup', 'click', 'select'].forEach(ev => input.addEventListener(ev, draw));
  const tickDown = (s) => {
    clearInterval(timer); resend.disabled = true; resend.textContent = 'Resend in ' + s + 's';
    timer = setInterval(() => { s--; if (s <= 0 || !card.isConnected) { clearInterval(timer); resend.disabled = false; resend.textContent = 'Resend'; } else resend.textContent = 'Resend in ' + s + 's'; }, 1000);
  };
  resend.addEventListener('click', async () => {
    if (!opts.resend) return; resend.disabled = true;
    try { await opts.resend(); tickDown(30); input.value = ''; draw(); input.focus(); }
    catch (err) { resend.disabled = false; if (opts.status) opts.status.textContent = '⚠ ' + ((err && err.message) || 'Could not send the code.'); }
  });
  other.addEventListener('click', () => { clearInterval(timer); if (opts.changeEmail) opts.changeEmail(); });
  tickDown(30); draw();
  card.focusCode = () => { input.focus(); draw(); };
  card.setHint = (t) => { hint.textContent = t || ''; hint.hidden = !t; };
  return card;
}
