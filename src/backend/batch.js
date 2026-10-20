// Writing a list of changes to Firestore. Used by firebase.js; tested against the emulator
// (tests/sync-emulator.test.mjs).
/**
 * Split ops into batches Firestore will accept: ≤ 450 writes, and ≤ 12 distinct
 * task rows (each task write makes the rules look up its row — rules allow 20
 * look-ups per request).
 */
export function chunkOps(ops) {
  const batches = []; let cur = []; let cats = new Set();
  ops.forEach(op => {
    const cat = op.data && op.data.categoryId;
    const wouldAdd = cat && !cats.has(cat) ? 1 : 0;
    if (cur.length >= 450 || cats.size + wouldAdd > 12) { batches.push(cur); cur = []; cats = new Set(); }
    cur.push(op); if (cat) cats.add(cat);
  });
  if (cur.length) batches.push(cur);
  return batches;
}
/**
 * Write ops (from sync.changesToOps etc.). fb = { writeBatch(), getDoc(ref), ref(path) }.
 * An edit to something a teammate deleted a moment ago would fail the whole batch: those edits are
 * left out (the thing is gone), the rest is saved, and their paths come back in `skipped`.
 */
export async function runOpsWith(fb, ops) {
  const skipped = [];
  for (let chunk of chunkOps(ops)) {
    const write = () => { const b = fb.writeBatch(); chunk.forEach(op => { const r = fb.ref(op.path); if (op.type === 'delete') b.delete(r); else if (op.type === 'set') b.set(r, op.data); else b.update(r, op.data); }); return b.commit(); };
    try { await write(); }
    catch (e) {
      // With security rules, an update to a deleted document usually comes back as permission-denied
      // (the rules can't read the old document), sometimes as not-found.
      const code = String((e && e.code) || '');
      if (!/not-found|permission-denied/.test(code) || !chunk.some(op => op.type === 'update')) throw e;
      const gone = new Set();
      await Promise.all(chunk.filter(op => op.type === 'update').map(async op => { if (!(await fb.getDoc(fb.ref(op.path))).exists()) gone.add(op); }));
      if (!gone.size) throw e;
      gone.forEach(op => skipped.push(op.path)); chunk = chunk.filter(op => !gone.has(op));
      if (chunk.length) await write();
    }
  }
  return { skipped };
}
