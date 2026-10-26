// Rows for the downloadable dissertation Gantt chart template (public/templates/dissertation-gantt-chart.xlsx).
// Takes Trawpie's own plans and turns every date into a fraction of the time between the start
// and hand-in dates, so the spreadsheet re-flows when someone types their own two dates.
// Used by tools/templates/make-gantt-template.py:  node tools/templates/gantt-rows.mjs > rows.json
import { buildDissertationPlan } from '../../src/dissertation.js';

const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
const tidy = (n) => n.replace(/ in Literature$/, '');
function rows(level, start, handIn) {
  const p = buildDissertationPlan({ level, kind: 'people', start, handIn });
  const S = day(start), span = day(handIn) - S;
  const f = (iso) => Math.round(((day(iso) - S) / span) * 10000) / 10000;
  const out = [];
  p.phases.forEach(ph => {
    out.push({ type: 'Phase', name: ph.name, start: f(ph.start), end: f(ph.end) });
    let prev = ph.start;
    p.tasks.filter(t => t.phaseId === ph.id).sort((a, b) => a.due.localeCompare(b.due)).forEach(t => {
      if (t.milestone) { out.push({ type: 'Milestone', name: tidy(t.name), start: f(t.due), end: f(t.due) }); return; }
      const s = prev < t.due ? prev : t.due;
      out.push({ type: 'Task', name: tidy(t.name), start: f(s), end: f(t.due) });
      prev = t.due;
    });
  });
  return { start, handIn, rows: out };
}
console.log(JSON.stringify({
  ug: rows('ug', '2026-09-28', '2027-04-30'),
  masters: rows('masters', '2027-05-24', '2027-09-10'),
  phd: rows('phd', '2026-10-01', '2030-03-29'),
}, null, 1));
