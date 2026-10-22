// Turns the collected strings into translation keys (tools/i18n-keys.json): emoji and arrows at the
// start, "…" and ":" at the end, and " · " joins are handled by the translator, so keys are the bare
// phrases. Sample-team content (task names, people…) is left out: it's not interface text.
import fs from 'node:fs';
import { coreOf, splitParts } from '../src/i18n-core.js';
const raw = JSON.parse(fs.readFileSync(new URL('./i18n-strings.json', import.meta.url), 'utf8'));
const sample = JSON.stringify(JSON.parse(fs.readFileSync(new URL('../src/data/sample-team.json', import.meta.url), 'utf8')));
const names = new Set();
const walk = (v, k) => { if (typeof v === 'string') { if (['name', 'title', 'text', 'notes', 'note', 'summary', 'supplier', 'decision', 'mitigation', 'statement', 'authors', 'venue'].includes(k) && v.length > 2) names.add(v.trim()); } else if (v && typeof v === 'object') Object.entries(v).forEach(([kk, vv]) => walk(vv, Array.isArray(v) ? k : kk)); };
walk(JSON.parse(sample));
['Telemetry link', 'Weld the frame', 'Pixhawk wiring diagram', 'ESC calibration notes', 'Carbon landing gear set', 'Drone Challenge plan', 'Book the flying field', 'Ready to fly?', 'Landing gear ideas'].forEach(n => names.add(n));
const people = /(Visitor|Tom Reed|Leo Martins|Mei Chen|Priya (Nair|Shah)|Ben Owusu|Rushi|Aisha)/;
const keys = new Set();
Object.keys(raw).forEach(s => splitParts(s).forEach(part => {
  const { core } = coreOf(part); if (!core || !/[A-Za-z]{2}/.test(core)) return;
  if (names.has(core) || [...names].some(n => n.length > 5 && core.includes(n)) || people.test(core)) return;
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \{n\}/.test(core) || /^\{n\} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(core) || /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \{n\}/.test(core)) return;
  if (/^[A-Z]{2,5}-[A-Z0-9]{3,}$/.test(core) || /@/.test(core) || /^https?:/.test(core)) return;
  keys.add(core);
}));
const out = [...keys].sort();
fs.writeFileSync(new URL('./i18n-keys.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('keys:', out.length);
