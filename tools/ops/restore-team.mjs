// Restore ONE team from a Firestore backup.
//
// Google restores a backup into a separate database (e.g. "restore-2026-10-20"); this copies a
// single team from that database back into the live one, without touching other teams.
//
//   node tools/ops/restore-team.mjs --from <backup-database-id> --team <teamId>            (preview)
//   node tools/ops/restore-team.mjs --from <backup-database-id> --team <teamId> --apply    (do it)
//
// Before changing anything it saves the team's CURRENT state to a JSON file (--out), so a restore
// can itself be undone with:  --from-file <that file> --team <teamId> --apply
// Usually run from GitHub ▸ Actions ▸ "Restore a team" (see RUNBOOK.md).
import fs from 'node:fs';

/** Every document of a team: { 'teams/T': data, 'teams/T/tasks/x': data, … } */
export async function readTeam(db, teamId) {
  const out = {};
  const ref = db.collection('teams').doc(teamId);
  const snap = await ref.get();
  if (snap.exists) out[ref.path] = snap.data();
  for (const col of await ref.listCollections()) {
    const docs = await col.get();
    docs.forEach(d => { out[d.ref.path] = d.data(); });
  }
  return out;
}

/** What a restore would do: documents to write (new or changed) and to delete. */
export function planRestore(live, backup) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const write = Object.keys(backup).filter(p => !(p in live) || !same(live[p], backup[p]));
  const del = Object.keys(live).filter(p => !(p in backup));
  const byCollection = (paths) => paths.reduce((m, p) => { const k = p.split('/').length > 2 ? p.split('/')[2] : 'team'; m[k] = (m[k] || 0) + 1; return m; }, {});
  return { write, del, unchanged: Object.keys(backup).length - write.length, summary: { write: byCollection(write), delete: byCollection(del) } };
}

/** Apply a plan in batches. Deletes run first, then writes; the team document is written last. */
export async function applyRestore(db, backup, plan) {
  const ops = [...plan.del.map(p => ({ del: true, p })), ...plan.write.filter(p => p.split('/').length > 2).map(p => ({ p })), ...plan.write.filter(p => p.split('/').length === 2).map(p => ({ p }))];
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    ops.slice(i, i + 400).forEach(o => (o.del ? b.delete(db.doc(o.p)) : b.set(db.doc(o.p), backup[o.p])));
    await b.commit();
  }
  return ops.length;
}

// Firestore Timestamps etc. → JSON and back (for the safety snapshot)
const toJSON = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === 'object' && typeof x.toDate === 'function' && 'seconds' in x ? { __ts: x.toMillis() } : x)));
export function fromJSON(obj, Timestamp) {
  const walk = (x) => (Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? ('__ts' in x && Object.keys(x).length === 1 ? Timestamp.fromMillis(x.__ts) : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))) : x);
  return walk(obj);
}

async function main() {
  const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : ''; };
  const has = (n) => process.argv.includes('--' + n);
  const teamId = arg('team'), from = arg('from'), fromFile = arg('from-file'), project = arg('project') || process.env.GCLOUD_PROJECT || 'uni-teamtrack';
  const out = arg('out') || `team-${teamId}-before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  if (!teamId || !/^[A-Za-z0-9_-]{1,64}$/.test(teamId) || (!from && !fromFile)) {
    console.error('Usage: --team <teamId> (--from <backup-database-id> | --from-file <snapshot.json>) [--apply]'); process.exit(2);
  }
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const app = initializeApp({ projectId: project });
  const live = getFirestore(app);
  let backup;
  if (fromFile) backup = fromJSON(JSON.parse(fs.readFileSync(fromFile, 'utf8')).docs, Timestamp);
  else backup = await readTeam(getFirestore(app, from), teamId);
  if (!backup['teams/' + teamId]) { console.error(`Team ${teamId} is not in ${from || fromFile}. Check the team ID (it's in the address bar: #/t/<teamId>).`); process.exit(1); }
  const current = await readTeam(live, teamId);
  const plan = planRestore(current, backup);
  console.log(`Team ${teamId} — "${backup['teams/' + teamId].name || ''}"`);
  console.log(`From: ${from ? 'backup database ' + from : 'snapshot file ' + fromFile}`);
  console.log(`Documents now: ${Object.keys(current).length} · in backup: ${Object.keys(backup).length}`);
  console.log(`Would write ${plan.write.length} (new or changed), delete ${plan.del.length}, leave ${plan.unchanged} unchanged.`);
  console.log('By collection:', JSON.stringify(plan.summary));
  fs.writeFileSync(out, JSON.stringify({ teamId, project, takenAt: new Date().toISOString(), docs: toJSON(current) }, null, 1));
  console.log(`Saved the current state to ${out} (keep it: it undoes this restore).`);
  if (!has('apply')) { console.log('\nPreview only. Run again with --apply to restore.'); return; }
  const n = await applyRestore(live, backup, plan);
  const after = planRestore(await readTeam(live, teamId), backup);
  if (after.write.length || after.del.length) { console.error(`Restore incomplete: ${after.write.length + after.del.length} documents still differ.`); process.exit(1); }
  console.log(`\n✓ Restored: ${n} changes applied. The team now matches the backup.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message || e); process.exit(1); });
