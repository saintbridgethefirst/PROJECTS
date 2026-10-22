// The pure part of the translator (shared with tools/i18n-keys.mjs and the tests).
// A shown text = [lead: emoji, arrows, bullets] core [tail: … : ! ?]. Numbers in the core become {n}.
const LEAD = /^[\s\p{Extended_Pictographic}‍️←-⇿⌀-⏿■-➿⬀-⯿＋+•·▸▾▴◂‹›«»✓✗✕×#︽︾⊕⊖☰◎⋯\-–—]+/u;
const TAIL = /[\s…:!?.✓✔→▸\p{Extended_Pictographic}\ufe0f]*(\.\.\.)?[\s…:!?.✓✔→▸\p{Extended_Pictographic}\ufe0f]*$/u;
export function coreOf(text) {
  const s = String(text);
  const lead = (s.match(LEAD) || [''])[0];
  let rest = s.slice(lead.length);
  const tail = (rest.match(TAIL) || [''])[0];
  rest = rest.slice(0, rest.length - tail.length);
  const nums = [];
  const core = rest.replace(/\s+/g, ' ').replace(/\d+(?:[.,]\d+)*/g, (m) => { nums.push(m); return '{n}'; });
  return { lead, core, tail, nums };
}
/** "3 open · 2 overdue · Review", "Done. Arrow keys…": parts (sentences, · and — pieces) translated one by one. */
const SEP = /(\s+·\s+|\s+—\s+|(?<=[a-z0-9)”])\.\s+(?=[A-Z])|;\s+)/;
export const splitParts = (s) => String(s).split(SEP).filter((x, i) => i % 2 === 0);
const splitKeep = (s) => String(s).split(SEP);
/** Translate one text with a dictionary { core: translation }; null when nothing matched. */
export function translateText(text, dict) {
  if (!text || !dict) return null;
  const parts = splitKeep(text); let changed = false;
  const out = parts.map((part, i) => {
    if (i % 2) return part;   // a separator
    const { lead, core, tail, nums } = coreOf(part);
    let t = core && dict[core];
    if (!t && core && /[a-z]/.test(core)) { const cap = core[0].toUpperCase() + core.slice(1); if (cap !== core && dict[cap]) t = dict[cap][0].toLowerCase() + dict[cap].slice(1); }
    if (!t) return part;
    changed = true; let k = 0;
    return lead + t.replace(/\{n\}/g, () => (k < nums.length ? nums[k++] : '')) + tail;
  });
  return changed ? out.join('') : null;
}
