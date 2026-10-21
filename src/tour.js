// ─────────────────────────────────────────────────────────────────────────────
//  A guided tour over the real screens (used by the public demo): each step rings
//  one element and explains it in a small card with Back / Next. Esc or Skip ends it.
//  step = { target: '<selector>' | () => Element | null, title, text, before?(), after?(), action? }
// ─────────────────────────────────────────────────────────────────────────────
import { el } from './ui.js';

let active = null;
export const tourRunning = () => !!active;

export function startTour(steps, { onEnd } = {}) {
  endTour();
  const ring = el('div.tour-ring', { 'aria-hidden': 'true' });
  const card = el('div.tour-card', { role: 'dialog', 'aria-live': 'polite', 'aria-label': 'Guided tour' });
  document.body.append(ring, card);
  let i = 0;
  const state = { ring, card, onEnd, steps, cleanup: [] };
  active = state;
  const find = (s) => { try { return typeof s.target === 'function' ? s.target() : s.target ? document.querySelector(s.target) : null; } catch { return null; } };
  const place = () => {
    const s = steps[i]; const t = find(s);
    card.classList.toggle('centre', !t);
    if (!t) { ring.style.display = 'none'; card.style.left = ''; card.style.top = ''; return; }
    const r = t.getBoundingClientRect(); const pad = 6;
    Object.assign(ring.style, { display: 'block', left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + 2 * pad) + 'px', height: (r.height + 2 * pad) + 'px' });
    if (window.matchMedia('(max-width: 640px)').matches) { card.style.left = ''; card.style.top = ''; card.classList.add('docked'); return; }
    card.classList.remove('docked');
    const cw = card.offsetWidth, ch = card.offsetHeight, vw = innerWidth, vh = innerHeight;
    let top = r.bottom + 14; if (top + ch > vh - 12) top = r.top - ch - 14; if (top < 12) top = Math.min(vh - ch - 12, Math.max(12, r.top + 12));
    let left = r.left + r.width / 2 - cw / 2; left = Math.max(12, Math.min(vw - cw - 12, left));
    card.style.left = left + 'px'; card.style.top = top + 'px';
  };
  const show = async (n) => {
    const prev = steps[i]; if (prev && n !== i && prev.after) { try { prev.after(); } catch { /* */ } }
    i = n; const s = steps[i];
    if (s.before) { try { await s.before(); } catch { /* */ } }
    await new Promise(r => setTimeout(r, s.before ? 350 : 60));
    const t = find(s); if (t && t.scrollIntoView) { try { t.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch { t.scrollIntoView(); } }
    const last = i === steps.length - 1;
    card.replaceChildren(
      el('div.tour-step', {}, (i + 1) + ' of ' + steps.length),
      el('h3', {}, s.title), el('p', {}, s.text),
      s.action ? el('div.tour-extra', {}, s.action()) : '',
      el('div.tour-btns', {},
        el('button.btn.small.ghost', { type: 'button', id: 'tour-skip', onclick: () => endTour() }, last ? 'Close' : 'Skip tour'),
        el('span.spacer'),
        i ? el('button.btn.small', { type: 'button', id: 'tour-back', onclick: () => show(i - 1) }, 'Back') : '',
        last ? '' : el('button.btn.small.primary', { type: 'button', id: 'tour-next', onclick: () => show(i + 1) }, 'Next')));
    requestAnimationFrame(place);
    const nb = card.querySelector('#tour-next') || card.querySelector('#tour-skip'); if (nb) nb.focus({ preventScroll: true });
  };
  const onKey = (e) => { if (e.key === 'Escape') endTour(); else if (e.key === 'ArrowRight' && i < steps.length - 1) show(i + 1); else if (e.key === 'ArrowLeft' && i) show(i - 1); };
  const onMove = () => requestAnimationFrame(place);
  document.addEventListener('keydown', onKey, true); window.addEventListener('resize', onMove); window.addEventListener('scroll', onMove, true);
  state.cleanup.push(() => { document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true); });
  state.current = () => steps[i];
  show(0);
}

export function endTour() {
  if (!active) return;
  const s = active; active = null;
  const cur = s.current && s.current(); if (cur && cur.after) { try { cur.after(); } catch { /* */ } }
  s.cleanup.forEach(f => f()); s.ring.remove(); s.card.remove();
  if (s.onEnd) s.onEnd();
}
