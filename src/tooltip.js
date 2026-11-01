// Quick hover labels for buttons on computers with a mouse.
// Any button or link with a title (or an aria-label and no visible text) shows a
// small dark label after a short pause, instead of the browser's slow grey one.
// Touch screens are left alone.

const SEL = 'button, a, [role="button"], [data-tip]';
const DELAY = 300;
let tip = null, cur = null, timer = 0;

function labelOf(elm) {
  const t = elm.getAttribute('data-tip') || elm.getAttribute('title') || elm.dataset.ttTitle;
  if (t) return t.trim();
  // Icon-only buttons often carry just an aria-label.
  const visible = (elm.textContent || '').replace(/\s+/g, '').length;
  const aria = elm.getAttribute('aria-label');
  return aria && visible <= 2 ? aria.trim() : '';
}

function hide() {
  clearTimeout(timer);
  if (cur && cur.dataset.ttTitle !== undefined) { cur.setAttribute('title', cur.dataset.ttTitle); delete cur.dataset.ttTitle; }
  cur = null;
  if (tip) tip.classList.remove('on');
}

function place(elm) {
  const r = elm.getBoundingClientRect();
  tip.style.left = '0px'; tip.style.top = '0px';
  const w = tip.offsetWidth, h = tip.offsetHeight, pad = 8;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(pad, Math.min(x, window.innerWidth - w - pad));
  let y = r.bottom + 8;
  if (y + h > window.innerHeight - pad) y = r.top - h - 8;
  tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y) + 'px';
}

function show(elm) {
  const text = labelOf(elm); if (!text || !elm.isConnected) return;
  // Stop the browser's own tooltip appearing on top of ours.
  if (elm.hasAttribute('title')) { elm.dataset.ttTitle = elm.getAttribute('title'); elm.removeAttribute('title'); }
  if (!tip) { tip = document.createElement('div'); tip.className = 'tt-tip'; tip.setAttribute('role', 'tooltip'); document.body.append(tip); }
  tip.textContent = text;
  place(elm);
  tip.classList.add('on');
}

export function initTooltips() {
  if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const elm = e.target.closest && e.target.closest(SEL);
    if (elm === cur) return;
    hide();
    if (!elm || elm.disabled || !labelOf(elm)) return;
    // The glass sidebar, folded to icons, shows names in its own glass label (src/glass.js)
    if (elm.closest('#top-bar') && document.body.classList.contains('nav-glass') && document.body.classList.contains('nav-rail')) return;
    cur = elm;
    timer = setTimeout(() => { if (cur === elm) show(elm); }, DELAY);
  }, true);
  document.addEventListener('pointerout', (e) => {
    if (!cur) return;
    const to = e.relatedTarget;
    if (to && cur.contains(to)) return;
    hide();
  }, true);
  ['pointerdown', 'keydown', 'scroll', 'blur'].forEach(ev => window.addEventListener(ev, hide, true));
}
