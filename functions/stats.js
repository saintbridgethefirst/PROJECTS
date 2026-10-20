// ─────────────────────────────────────────────────────────────────────────────
//  Pilot numbers: how much each team actually uses TeamTrack. Counts only —
//  never task names, comments or anything a team wrote. Stored at
//  teamStats/{teamId}, readable by platform admins (Settings ▸ Plan ▸ Platform
//  admin). Computed daily by dailyTeamStats and on demand by refreshTeamStats.
// ─────────────────────────────────────────────────────────────────────────────
export const DAY = 864e5;
export const HISTORY_DAYS = 56;      // 8 weeks of daily points, for the trend

const count = async (q) => (await q.count().get()).data().count;

/** Numbers for one team at time `now`. prev = the stored stats (for the history). */
export async function teamStats(db, teamId, now, prev = null) {
  const team = db.doc('teams/' + teamId);
  const t = (await team.get()).data() || {};
  const week = now - 7 * DAY;
  const members = (await team.collection('members').get()).docs.map(d => d.data());
  const names = new Set(members.map(m => String(m.name || '').trim()).filter(Boolean));
  // Tasks changed in the last 7 days: who changed them (by name, as tasks record it).
  const changed = (await team.collection('tasks').where('updatedAt', '>=', week).select('updatedBy', 'createdBy', 'createdAt').get()).docs.map(d => d.data());
  const uidToName = new Map(members.map(m => [m.uid, String(m.name || '').trim()]));
  const active = new Set();
  changed.forEach(x => { const n = String(x.updatedBy || '').trim(); if (names.has(n)) active.add(n); if (x.createdAt >= week && uidToName.get(x.createdBy)) active.add(uidToName.get(x.createdBy)); });
  const comments = (await team.collection('comments').where('createdAt', '>=', week).select('authorUid').get()).docs.map(d => d.data());
  comments.forEach(c => { if (uidToName.get(c.authorUid)) active.add(uidToName.get(c.authorUid)); });
  const last = (await team.collection('tasks').orderBy('updatedAt', 'desc').limit(1).select('updatedAt').get()).docs[0];
  const stats = {
    name: String(t.name || '').slice(0, 80),
    plan: (t.plan && t.plan.tier) || 'free', edu: !!(t.plan && t.plan.edu),
    createdAt: Number(t.createdAt) || 0,
    members: members.length,
    invitesPending: await count(team.collection('invites')),
    tasks: await count(team.collection('tasks')),
    weeks: Array.isArray(t.weeks) ? t.weeks.length : 0,
    active7: active.size,
    tasksChanged7: changed.length,
    tasksCreated7: changed.filter(x => x.createdAt >= week).length,
    comments7: comments.length,
    feedback7: (await db.collection('feedback').where('teamId', '==', teamId).select('at').get()).docs.filter(d => d.data().at >= week).length,
    lastActivity: last ? Number(last.data().updatedAt) || 0 : 0,
    features: Object.entries(t.features || {}).filter(([, on]) => on === true).map(([k]) => k).sort(),
    at: now,
  };
  const day = new Date(now).toISOString().slice(0, 10);
  const hist = ((prev && prev.history) || []).filter(h => h.d !== day && Date.parse(h.d) > now - HISTORY_DAYS * DAY);
  stats.history = [...hist, { d: day, active7: stats.active7, changed7: stats.tasksChanged7, members: stats.members }].sort((a, b) => a.d.localeCompare(b.d));
  return stats;
}

/** Every team's numbers, written to teamStats/{teamId}; stats of deleted teams are removed. */
export async function refreshAll(db, now = Date.now()) {
  const teams = (await db.collection('teams').get()).docs.map(d => d.id);
  const old = new Map((await db.collection('teamStats').get()).docs.map(d => [d.id, d.data()]));
  for (const id of teams) await db.doc('teamStats/' + id).set(await teamStats(db, id, now, old.get(id)));
  const gone = [...old.keys()].filter(id => !teams.includes(id));
  for (const id of gone) await db.doc('teamStats/' + id).delete();
  return { teams: teams.length, removed: gone.length };
}
