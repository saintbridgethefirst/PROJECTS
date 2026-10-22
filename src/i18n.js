// ─────────────────────────────────────────────────────────────────────────────
//  Languages. The app is written in English; for another language this module
//  translates what's on screen as it appears (text and tooltips), using the
//  dictionaries in src/i18n/ (English phrase → translation). Things people typed
//  (task names, comments…) are never touched: see i18n-skip.js.
//  The choice is per browser (localStorage tt_lang), set in Your account or the footer.
// ─────────────────────────────────────────────────────────────────────────────
import { translateText } from './i18n-core.js';
import { SKIP_SELECTOR } from './i18n-skip.js';

export const LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['zh', '中文（简体）']];
const IDX = { es: 0, fr: 1, de: 2, zh: 3 };
const HTML_LANG = { en: 'en-GB', es: 'es', fr: 'fr', de: 'de', zh: 'zh-CN' };
const ATTRS = ['title', 'placeholder', 'aria-label'];

export function currentLang() {
  let l = '';
  try { l = localStorage.getItem('tt_lang') || ''; } catch { /* private window */ }
  if (!l) l = String((typeof navigator !== 'undefined' && navigator.language) || 'en').slice(0, 2).toLowerCase();
  return LANGS.some(([k]) => k === l) ? l : 'en';
}
export function setLang(l) {
  try { localStorage.setItem('tt_lang', l); } catch { /* */ }
  location.reload();
}

let dict = null; let observer = null; let queued = new Set();
const done = new WeakMap();   // text node → { orig, shown }
const attrDone = new WeakMap(); // element → { attr: { orig, shown } }

/** Load the language and translate the page from now on. Resolves when the first pass is done. */
export async function startI18n(lang = currentLang()) {
  document.documentElement.lang = HTML_LANG[lang] || 'en';
  if (lang === 'en' || !(lang in IDX)) return false;
  const parts = await Promise.all([import('./i18n/t1.js'), import('./i18n/t2.js'), import('./i18n/t3.js'), import('./i18n/t4.js'), import('./i18n/t5.js')]);
  const i = IDX[lang]; dict = Object.create(null);
  parts.forEach(m => Object.entries(m.default).forEach(([k, v]) => { if (v && v[i]) dict[k.trim()] = v[i]; }));
  translateTree(document.body);
  observer = new MutationObserver(onMutations);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return true;
}
export const translate = (s) => (dict ? translateText(s, dict) || s : s);

function skipEl(el) { return !el || (el.nodeType === 1 && (el.matches(SKIP_SELECTOR) || el.tagName === 'SCRIPT' || el.tagName === 'STYLE')); }
function translateTree(root) {
  if (!dict || !root) return;
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1 || skipEl(root) || (root.parentElement && root.parentElement.closest(SKIP_SELECTOR))) return;
  doAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 ? (skipEl(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) : NodeFilter.FILTER_ACCEPT),
  });
  let n; while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
}
function doText(n) {
  const v = n.nodeValue; if (!v || !/[A-Za-z]{2}/.test(v)) return;
  const d = done.get(n); if (d && d.shown === v) return;
  const t = translateText(v, dict);
  if (t && t !== v) { done.set(n, { orig: v, shown: t }); n.nodeValue = t; }
}
function doAttrs(el) {
  if (!el.hasAttribute) return;
  let rec = attrDone.get(el);
  ATTRS.forEach(a => {
    const v = el.getAttribute(a); if (!v || !/[A-Za-z]{2}/.test(v)) return;
    if (rec && rec[a] && rec[a].shown === v) return;
    const t = translateText(v, dict);
    if (t && t !== v) { rec = rec || {}; rec[a] = { orig: v, shown: t }; attrDone.set(el, rec); el.setAttribute(a, t); }
  });
}
function onMutations(list) {
  list.forEach(m => {
    if (m.type === 'childList') m.addedNodes.forEach(n => queued.add(n));
    else if (m.type === 'characterData') queued.add(m.target);
    else if (m.type === 'attributes') queued.add(m.target);
  });
  flush();   // a mutation callback runs before the browser paints, so nobody sees the English flash
}
function flush() {
  const nodes = queued; queued = new Set();
  nodes.forEach(n => {
    if (!n.isConnected) return;
    if (n.nodeType === 3) { const p = n.parentElement; if (p && !p.closest(SKIP_SELECTOR)) doText(n); }
    else if (n.nodeType === 1) translateTree(n);
  });
}
