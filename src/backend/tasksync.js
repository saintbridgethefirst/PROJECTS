// ─────────────────────────────────────────────────────────────────────────────
//  A team's tasks, cheaply. Firestore charges a read for every document a
//  listener sends, and a team keeps every week since it started. So:
//   • tasks in recent and future weeks are listened to live, as before;
//   • tasks in weeks that ended more than ARCHIVE_AFTER_DAYS ago ("archived
//     weeks") come from this device's own saved copy, which costs nothing, and
//     are fetched from the server only the first time, or when someone changed
//     an archived week since (the team's `archiveRev` changes on every such save).
//  A save that touches an archived week sets the team's archiveRev (see archiveBump).
//  Used by firebase.js; tested against the emulator (tests/sync-emulator.test.mjs).
// ─────────────────────────────────────────────────────────────────────────────
export const ARCHIVE_AFTER_DAYS = 35;        // readers: weeks that ended more than 5 weeks ago
export const WRITER_MARGIN_DAYS = 7;         // writers mark a week archived a week earlier, so clocks never disagree
const MAX_IN = 30;                           // Firestore's limit for an "in" query

const dayMs = 864e5;
const ended = (w) => (w && /^\d{4}-\d\d-\d\d$/.test(w.startDate || '') ? Date.parse(w.startDate + 'T00:00:00Z') + 7 * dayMs : null);
/** Week keys split into live and archived. Undated weeks are always live. */
export function splitWeeks(weeks, now = Date.now(), afterDays = ARCHIVE_AFTER_DAYS) {
  const live = [], archived = [];
  (weeks || []).forEach(w => { const e = ended(w); (e !== null && e < now - afterDays * dayMs ? archived : live).push(w.key); });
  return { live, archived };
}
/** Does a save to a task in these weeks need to tell other devices (archiveRev)? */
export function touchesArchive(weeks, weekIds, now = Date.now()) {
  const old = new Set(splitWeeks(weeks, now, ARCHIVE_AFTER_DAYS - WRITER_MARGIN_DAYS).archived);
  return weekIds.some(k => k && old.has(k));
}
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

/**
 * fs = { tasksQuery(weekIdsOrNull), onSnapshot, getDocs, getDocsFromCache }, store = { get(), set(v) } (per team, this device).
 * Returns { setTeam(teamDoc), known: Map(id → task), stop() }. onTasks(all tasks) is called on every change.
 */
export function watchTasks(fs, store, onTasks, onError) {
  let liveKey = null, unsubLive = null, live = new Map(), archived = new Map(), stopped = false, loading = Promise.resolve();
  const known = new Map();
  const emit = () => {
    if (stopped) return;
    known.clear(); archived.forEach((t, id) => known.set(id, t)); live.forEach((t, id) => known.set(id, t));
    onTasks([...known.values()]);
  };
  const rowsOf = (snap) => snap.docs.map(d => ({ ...d.data(), id: d.id }));
  async function fetchWeeks(keys, fromCache) {
    const out = [];
    for (const c of chunks(keys, MAX_IN)) out.push(...rowsOf(await (fromCache ? fs.getDocsFromCache : fs.getDocs)(fs.tasksQuery(c))));
    return out;
  }
  /** Archived weeks: this device's copy when it's known to be complete and current, else the server. */
  async function loadArchive(keys, rev) {
    const rec = store.get() || {}; const counts = rec.rev === rev ? (rec.weeks || {}) : {};
    const have = keys.filter(k => k in counts), need = keys.filter(k => !(k in counts));
    let rows = [];
    if (have.length) {
      try {
        const cached = await fetchWeeks(have, true);
        const n = {}; cached.forEach(t => { n[t.weekId] = (n[t.weekId] || 0) + 1; });
        const bad = have.filter(k => (n[k] || 0) !== counts[k]);   // the device's copy is missing something
        rows = cached.filter(t => !bad.includes(t.weekId)); need.push(...bad);
      } catch { need.push(...have); }
    }
    if (need.length) rows.push(...await fetchWeeks(need, false));
    const weeksCount = {}; keys.forEach(k => { weeksCount[k] = 0; }); rows.forEach(t => { if (t.weekId in weeksCount) weeksCount[t.weekId]++; });
    store.set({ rev, weeks: weeksCount, at: Date.now() });
    return { rows, fromServer: need.length };
  }
  let archiveKey = null;
  function setTeam(team) {
    if (stopped || !team) return;
    const { live: liveKeys, archived: archKeys } = splitWeeks(team.weeks);
    const rev = team.archiveRev || 0;
    // Live part: too many live weeks for one query → just listen to everything (old behaviour).
    const lk = liveKeys.length > MAX_IN ? '*' : liveKeys.join('|');
    if (lk !== liveKey) {
      liveKey = lk; unsubLive && unsubLive(); live = new Map();
      const q = lk === '*' ? fs.tasksQuery(null) : liveKeys.length ? fs.tasksQuery(liveKeys) : null;
      if (q) unsubLive = fs.onSnapshot(q, (s) => { live = new Map(rowsOf(s).map(t => [t.id, t])); emit(); }, onError);
      else { unsubLive = null; emit(); }
    }
    const ak = lk === '*' ? '' : archKeys.join('|') + '#' + rev;
    if (ak !== archiveKey) {
      archiveKey = ak;
      if (!ak || !archKeys.length) { archived = new Map(); emit(); return; }
      loading = loading.then(() => loadArchive(archKeys, rev)).then(({ rows }) => {
        if (stopped || archiveKey !== ak) return;
        archived = new Map(rows.map(t => [t.id, t])); emit();
      }).catch(e => { if (!stopped) onError && onError(e); });
    }
  }
  return { setTeam, known, stop: () => { stopped = true; unsubLive && unsubLive(); }, get ready() { return loading; } };
}
