// ─────────────────────────────────────────────────────────────────────────────
//  Click (and change, key…) handlers written in the HTML, without inline script.
//
//  The site's security policy (Content-Security-Policy, firebase.json) runs no inline script, which
//  includes onclick="…" attributes. The page and the board write data-onclick="fn('a', 3, this.value)"
//  instead, and this file runs them: a small reader that only understands calls of known functions with
//  plain values (text, numbers, true/false/null, this, this.value, event…), never arbitrary code.
//
//  Each element gets a real listener the first time one of its events passes the document (in the
//  capture phase, before the event reaches the element), so the order of handlers and stopPropagation()
//  behave as they did with onclick.
// ─────────────────────────────────────────────────────────────────────────────

/** The functions the page's data-on… attributes may call (checked by tests/unit.test.mjs). */
export const ALLOWED = new Set([
  // the page (index.html)
  'TT.openFeedback', 'TT.openJointBoard', 'TT.openCrossTeam', 'boardSetView', 'TT.openSearch', 'TT.openSettings', 'openAnalytics', 'TT.openResearch',
  'TT.openPresence', 'TT.openActivity', 'TT.openWhiteboards', 'openApprovals', 'TT.openShare', 'TT.openAI', 'scrollToToday', 'TT.toggleNavRail',
  'TT.openAccount', 'toggleTheme', 'toggleSidebar', 'addWeek', 'performSearch', 'toggleCustomFilter', 'massSelect', 'selectLastNWeeks', 'massSelectPhases',
  // the board (public/board/board.js)
  'toggleFilter', 'toggleWeekCollapse', 'updateWeekField', 'metricKey', 'commitMetric', 'deleteWeek', 'toggleSubtask', 'quickAddSubtask', 'deleteActiveNode',
  'updateSubtaskTitle', 'promoteSubtask', 'deleteSubtask', 'openDuePicker', 'setDueQuick', 'extendTaskUI',
]);
export const EVENTS = ['click', 'change', 'input', 'keydown', 'blur'];

// ── Reading a handler: calls separated by ";", optionally "return false" ────
function tokens(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\' && j + 1 < src.length) { j++; s += ({ n: '\n', t: '\t' })[src[j]] || src[j]; } else s += src[j]; j++; }
      if (j >= src.length) throw new Error('Unclosed text');
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('(),;'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error('Unexpected “' + c + '”');
  }
  return out;
}
const cache = new Map();
/** Parse "a.b(1, 'x', this.value); return false" into [{ call, args }] and a return value. Throws on anything else. */
export function parseHandler(src) {
  if (cache.has(src)) return cache.get(src);
  const tk = tokens(String(src)); let p = 0; const calls = []; let ret;
  const peek = () => tk[p]; const take = (t) => { const x = tk[p]; if (!x || (t && x.t !== t)) throw new Error('Expected ' + (t || 'more') + ' in ' + src); p++; return x; };
  const value = () => {
    const x = take();
    if (x.t === 'str' || x.t === 'num') return { lit: x.v };
    if (x.t === 'id') {
      if (x.v === 'true' || x.v === 'false') return { lit: x.v === 'true' };
      if (x.v === 'null') return { lit: null };
      if (x.v === 'undefined') return { lit: undefined };
      if (/^(this|event)(\.|$)/.test(x.v)) return { ref: x.v };
    }
    throw new Error('Only plain values, this and event can be passed: ' + src);
  };
  while (p < tk.length) {
    if (peek().t === ';') { p++; continue; }
    const head = take('id');
    if (head.v === 'return') { ret = value().lit; continue; }
    if (!ALLOWED.has(head.v)) throw new Error('Not an allowed action: ' + head.v);
    take('('); const args = [];
    if (peek() && peek().t !== ')') { args.push(value()); while (peek() && peek().t === ',') { p++; args.push(value()); } }
    take(')');
    calls.push({ call: head.v, args });
  }
  const out = { calls, ret };
  cache.set(src, out);
  return out;
}
const resolve = (path, el, e) => path.split('.').slice(1).reduce((o, k) => (o == null ? undefined : o[k]), path.startsWith('this') ? el : e);

/** Run the handler text for this element and event, as onclick would have. */
export function runHandler(src, el, e) {
  const { calls, ret } = parseHandler(src);
  calls.forEach(({ call, args }) => {
    const parts = call.split('.'); const name = parts.pop();
    const owner = parts.reduce((o, k) => (o == null ? undefined : o[k]), window);
    const fn = owner && owner[name];
    if (typeof fn !== 'function') throw new Error(call + ' isn’t available yet');
    fn.apply(owner, args.map(a => ('ref' in a ? resolve(a.ref, el, e) : a.lit)));
  });
  if (ret === false) e.preventDefault();
}

const bound = new WeakMap();   // element → Set of event types it has a listener for
function bind(e) {
  const attr = 'data-on' + e.type;
  for (const node of e.composedPath()) {
    if (!(node instanceof Element) || !node.hasAttribute(attr)) continue;
    let set = bound.get(node); if (!set) bound.set(node, set = new Set());
    if (set.has(e.type)) continue;
    set.add(e.type);
    node.addEventListener(e.type, function (ev) { const src = this.getAttribute(attr); if (src) runHandler(src, this, ev); });
  }
}
let installed = false;
/** Start listening (once). Anything the security policy blocks is reported like a crash (the admins get an
 *  email, and the browser tests fail), except what browser extensions inject. */
export function installHandlers(doc = document) {
  if (installed) return; installed = true;
  EVENTS.forEach(type => doc.addEventListener(type, bind, true));
  doc.addEventListener('securitypolicyviolation', (e) => {
    if (/^(chrome|moz|safari|ms-browser)-extension:/.test(String(e.sourceFile || '') + ' ' + String(e.blockedURI || '')) || /extension:/.test(String(e.blockedURI || ''))) return;
    const where = e.sourceFile ? ' (' + String(e.sourceFile).replace(location.origin, '') + ':' + e.lineNumber + ')' : '';
    setTimeout(() => { throw new Error('Blocked by the security policy: ' + e.effectiveDirective + ' ' + (e.blockedURI || 'inline') + where); });
  });
}
