// ─────────────────────────────────────────────────────────────────────────────
//  Joint board: several of your teams on one board (for example Mechanical and
//  Software, or a company team and a university partner). Each team is a lane,
//  each column a week, and every card keeps its team's colour. Clicking a card
//  opens it in its own team, where it's edited as normal.
//
//  You see the teams you belong to. To work inside another team's board, its
//  owner invites you (as a member or a guest).
// ─────────────────────────────────────────────────────────────────────────────
import { el, modal } from './ui.js';

const LANE_COLORS = ['#2557d6', '#e8590c', '#2f9e44', '#ae3ec9', '#0c8599', '#d6336c', '#f08c00', '#5f3dc4'];
const localISO = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const mondayOf = (iso) => { const d = new Date((iso || localISO(new Date())) + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localISO(d); };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return localISO(d); };
const fmt = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Cards for the joint board: { teamId, teamName, color, monday, task fields } for weeks with start dates. */
export function jointCards(snaps, mondays) {
  const out = [];
  snaps.forEach((sn, i) => {
    const color = LANE_COLORS[i % LANE_COLORS.length];
    const weekMon = new Map((sn.team.weeks || []).filter(w => w.startDate).map(w => [w.key, mondayOf(w.startDate)]));
    const who = new Map(sn.members.map(m => [m.uid, m.name || m.email || 'Member']));
    sn.tasks.forEach(t => {
      const mon = weekMon.get(t.weekId); if (!mon || !mondays.includes(mon)) return;
      out.push({ teamId: sn.teamId, teamName: sn.team.name || 'Team', color, monday: mon, id: t.id, name: t.name || 'Untitled task',
        owner: who.get(t.ownerUid) || 'Former member', ownerUid: t.ownerUid, done: t.flag === 'completed', status: t.status || '', due: t.dueDate || '', priority: t.priority || '' });
    });
  });
  return out;
}

/** People who are in more than one of the shown teams: the ones who link the work together. */
export function sharedPeople(snaps) {
  const seen = new Map();
  snaps.forEach(sn => sn.members.forEach(m => { const p = seen.get(m.uid) || { uid: m.uid, name: m.name || m.email, teams: [] }; p.teams.push(sn.team.name); seen.set(m.uid, p); }));
  return [...seen.values()].filter(p => p.teams.length > 1);
}

/** Open the joint board. teams: [{id, name}] I belong to. load(id) → snapshot. openTask(teamId, taskId). */
export async function openJointBoard({ teams, load, openTask, currentTeamId }) {
  const m = modal('Joint board'); m.box.classList.add('joint-modal');
  m.body.append(el('p.hint', {}, 'Loading ' + teams.length + ' team' + (teams.length === 1 ? '' : 's') + '…'));
  let snaps = [];
  try { snaps = (await Promise.all(teams.map(t => load(t.id).then(sn => ({ ...sn, teamId: sn.teamId || t.id })).catch(() => null)))).filter(Boolean); }
  catch (e) { m.body.replaceChildren(el('div.empty-state', {}, 'Couldn’t load your teams: ' + e.message)); return m; }
  const picked = new Set(snaps.map(s => s.teamId));
  let groupBy = 'team', start = addDays(mondayOf(), -7);

  const draw = () => {
    const mondays = Array.from({ length: 6 }, (_, i) => addDays(start, i * 7));
    const shown = snaps.filter(s => picked.has(s.teamId));
    const cards = jointCards(snaps, mondays).filter(c => picked.has(c.teamId));
    const colorOf = new Map(snaps.map((s, i) => [s.teamId, LANE_COLORS[i % LANE_COLORS.length]]));
    const chips = el('div.jb-teams', {}, snaps.map(s => el('label.jb-team', { style: { '--c': colorOf.get(s.teamId) } },
      el('input', { type: 'checkbox', checked: picked.has(s.teamId), onchange: (e) => { if (e.target.checked) picked.add(s.teamId); else picked.delete(s.teamId); draw(); } }),
      el('i.jb-dot'), s.team.name || 'Team')));
    const by = el('select', { id: 'jb-group', 'aria-label': 'Group by', onchange: (e) => { groupBy = e.target.value; draw(); } },
      el('option', { value: 'team', selected: groupBy === 'team' }, 'Lanes: teams'), el('option', { value: 'person', selected: groupBy === 'person' }, 'Lanes: people'));
    const nav = el('span.jb-nav', {}, el('button.btn.small.ghost', { type: 'button', 'aria-label': 'Earlier weeks', onclick: () => { start = addDays(start, -7); draw(); } }, '‹'),
      el('button.btn.small.ghost', { type: 'button', onclick: () => { start = addDays(mondayOf(), -7); draw(); } }, 'This week'),
      el('button.btn.small.ghost', { type: 'button', 'aria-label': 'Later weeks', onclick: () => { start = addDays(start, 7); draw(); } }, '›'));
    const lanes = groupBy === 'team'
      ? shown.map(s => ({ key: s.teamId, title: s.team.name || 'Team', sub: s.members.length + (s.members.length === 1 ? ' person' : ' people'), color: colorOf.get(s.teamId), cards: cards.filter(c => c.teamId === s.teamId) }))
      : [...new Map(cards.map(c => [c.ownerUid, c.owner])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
        .map(([uid, name]) => { const mine = cards.filter(c => c.ownerUid === uid); return { key: uid, title: name, sub: [...new Set(mine.map(c => c.teamName))].join(' · '), color: '', cards: mine }; });
    const now = mondayOf();
    const grid = el('div.jb-grid', { style: { '--cols': mondays.length } },
      el('div.jb-corner'), mondays.map(mon => el('div.jb-head' + (mon === now ? '.now' : ''), {}, 'w/c ' + fmt(mon))),
      lanes.flatMap(l => [
        el('div.jb-lane', { style: l.color ? { '--c': l.color } : {} }, el('b', {}, l.title), el('span.hint', {}, l.sub)),
        ...mondays.map(mon => el('div.jb-cell' + (mon === now ? '.now' : ''), {}, l.cards.filter(c => c.monday === mon).map(c =>
          el('button.jb-card' + (c.done ? '.done' : ''), { type: 'button', style: { '--c': c.color }, 'data-team': c.teamId, 'data-task': c.id,
            title: 'Open in ' + c.teamName, onclick: () => { m.close(); openTask(c.teamId, c.id); } },
            el('span.jb-card-name', {}, (c.done ? '✓ ' : '') + c.name),
            el('span.jb-card-meta', {}, groupBy === 'team' ? c.owner : c.teamName, c.due ? ' · due ' + fmt(c.due) : ''))))),
      ]));
    const shared = sharedPeople(shown);
    m.body.replaceChildren(
      el('p.hint', {}, 'Every team you’re in, side by side. Click a card to open it in its own team. Only weeks with start dates are shown.'),
      el('div.jb-bar', {}, chips, el('span.spacer'), by, nav),
      lanes.length && cards.length ? el('div.jb-wrap', {}, grid) : el('div.empty-state', {}, 'Nothing planned in these weeks for the teams you picked.'),
      shared.length ? el('p.hint.jb-shared', {}, 'In more than one of these teams: ' + shared.map(p => p.name + ' (' + p.teams.join(', ') + ')').join('; ')) : '',
      el('p.hint', {}, 'Want another team to work on one of your boards? Invite its people from Settings ▸ Members, as members or as guests.' + (currentTeamId ? '' : '')));
  };
  draw();
  return m;
}
