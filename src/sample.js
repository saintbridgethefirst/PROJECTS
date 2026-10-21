// ─────────────────────────────────────────────────────────────────────────────
//  Demo only: "Explore a sample team". Loads a made-up drone team (data/sample-team.json)
//  into this browser, with its dates moved so its current week is this week, the visitor
//  as its owner, and the newer features switched on and filled in: the Engineering
//  workflow (stages), sub-teams, parts and budget, notebook, risks, comments.
//  Loaded only when someone presses the button.
// ─────────────────────────────────────────────────────────────────────────────
import { WORKFLOW_TEMPLATES, newId } from './model.js';

const SAMPLE_TODAY_MONDAY = '2026-10-19';   // the sample's "this week" (WEEK 4)
const DAY = 864e5;
const mondayOf = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

/** The sample store, shifted to now and handed to `user`. Returns { teamId, team, users }. */
export async function buildSample(user, now = Date.now()) {
  const raw = (await import('./data/sample-team.json')).default;
  const shiftDays = Math.round((mondayOf(now) - new Date(SAMPLE_TODAY_MONDAY + 'T12:00:00')) / DAY);
  const shiftMs = shiftDays * DAY;
  const [[, T]] = Object.entries(raw.teams);
  const ownerUid = T.doc.ownerUid; const owner = raw.users[ownerUid];
  // Every id-like string of the owner becomes the visitor's; dates and times move to now.
  let json = JSON.stringify(T).split(ownerUid).join(user.uid);
  if (owner && owner.name) json = json.split('"' + owner.name + '"').join(JSON.stringify(user.name || 'You'));
  if (owner && owner.email) json = json.split(owner.email).join(user.email);
  const team = JSON.parse(json, (k, v) => {
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v)) { const d = new Date(v + 'T12:00:00'); d.setDate(d.getDate() + shiftDays); return d.toLocaleDateString('en-CA'); }
    if (typeof v === 'number' && v > 1.6e12 && v < 2.2e12 && /(At|^at|Date|^time)$/.test(k)) return v + shiftMs;
    return v;
  });
  team.doc.name = 'Skyhawk UAV (sample team)';
  team.doc.createdAt = now - 40 * DAY;   // old enough not to show the "Start here" card
  // Newer features: the Engineering workflow, with open tasks spread over its stages.
  const eng = WORKFLOW_TEMPLATES.find(t => t.id === 'engineering').stages.map(s => ({ ...s, limit: s.id === 'build' ? 4 : 0 }));
  team.doc.workflow = { stages: eng, moved: {} };
  const open = ['design', 'review', 'build', 'test'];
  Object.values(team.tasks).filter(t => t.flag !== 'completed').forEach((t, i) => {
    const named = open.find(id => id === String(t.status || '').trim().toLowerCase());   // a status like "Build" becomes that stage
    t.stage = named || open[i % open.length]; if (named) t.status = '';
  });
  Object.keys(team.doc.features || {}).forEach(k => { team.doc.features[k] = true; });
  // The Gantt: open tasks get a planned start a few days before their deadline, and more
  // "waits on" links, so the timeline shows real bars and arrows.
  const weekStart = new Map((team.doc.weeks || []).map(w => [w.key, w.startDate]));
  const back = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
  Object.values(team.tasks).forEach((t, i) => {
    const ws = weekStart.get(t.weekId); if (!t.dueDate || !ws) return;
    const s = back(t.dueDate, t.flag === 'completed' ? 2 : 1 + (i % 4)); t.startDate = s < ws ? ws : s;
  });
  const link = (id, on) => { const t = team.tasks[id]; if (t && team.tasks[on] && !(t.dependsOn || []).includes(on)) t.dependsOn = (t.dependsOn || []).concat(on); };
  link('t_fuselageas_112', 't_tailboomji_108'); link('t_rangetestk_67', 't_telemetryl_56'); link('t_flighttest_42', 't_criticalde_33');
  link('t_dropaccura_82', 't_payloadint_81'); link('t_autonomous_102', 't_targetdete_96'); link('t_batterymou_66', 't_wiringharn_60');
  const users = {};
  Object.values(raw.users).forEach(u => { if (u.uid !== ownerUid) users[u.uid] = u; });
  return { teamId: 't_sample_' + newId('x').slice(-10), team, users };
}
