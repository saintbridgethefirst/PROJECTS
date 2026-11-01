// ─────────────────────────────────────────────────────────────────────────────
//  Audit trail (Penteint Projects): every write to a team or its records becomes one
//  entry in teams/{teamId}/audit, written here and nowhere else (firestore.rules lets
//  nobody write that collection). Each entry is numbered and hash-chained to the one
//  before (functions/auditlib.js), so a gap or an edit shows up when the trail is checked.
//
//  The chain head lives in teams/{teamId}/private/auditHead and moves in a transaction,
//  so entries are numbered one after another even when many people save at once.
//  Firestore may deliver an event twice: the entry's id is the event id, so the second
//  delivery finds it and stops.
// ─────────────────────────────────────────────────────────────────────────────
import { onDocumentWrittenWithAuthContext } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { audited, auditActor, auditEntry, chainEntry } from './auditlib.js';

const REGION = 'europe-west2';
const opts = (document) => ({ document, region: REGION, maxInstances: 5, timeoutSeconds: 60, retry: true });

/** Append one entry for this write. Exported for the emulator tests. */
export async function recordWrite(db, event, teamId, col, docId) {
  if (!audited(col)) return null;
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!before && !after) return null;
  const teamRef = db.collection('teams').doc(teamId);
  const headRef = teamRef.collection('private').doc('auditHead');
  const entryRef = teamRef.collection('audit').doc(String(event.id || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || db.collection('x').doc().id);
  const uid = event.authType === 'app_user' ? String(event.authId || '') : '';
  return db.runTransaction(async (tx) => {
    const [seen, head, member] = await Promise.all([tx.get(entryRef), tx.get(headRef), uid ? tx.get(teamRef.collection('members').doc(uid)) : null]);
    if (seen.exists) return null;   // a repeated delivery of an event already recorded
    const name = (member && member.exists && member.get('name')) || (col === 'members' && docId === uid && ((after && after.name) || (before && before.name))) || '';
    const at = Date.parse(event.time) || Date.now();
    const entry = chainEntry(auditEntry({ col, docId, before, after, actor: auditActor(event.authType, event.authId, name), at, eventId: event.id }),
      head.exists ? head.data() : null);
    tx.set(entryRef, entry);
    tx.set(headRef, { seq: entry.seq, hash: entry.hash, at: entry.at });
    return entry;
  });
}

export const auditTeam = onDocumentWrittenWithAuthContext(opts('teams/{teamId}'), (event) =>
  recordWrite(getFirestore(), event, event.params.teamId, 'team', event.params.teamId));

export const auditRecords = onDocumentWrittenWithAuthContext(opts('teams/{teamId}/{col}/{docId}'), (event) =>
  recordWrite(getFirestore(), event, event.params.teamId, event.params.col, event.params.docId));
