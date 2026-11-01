// ─────────────────────────────────────────────────────────────────────────────
//  Audit trail (Penteint Projects). Pure logic shared by the server (functions/audit.js),
//  the demo backend and the Audit trail screen, so all three agree on exactly how an
//  entry is built, hashed and checked.
//
//  Every write to a team's records becomes one entry. Entries are written ONLY by the
//  server (firestore.rules: allow write: if false) and each one carries the hash of the
//  entry before it, so removing, reordering or editing any entry breaks the chain from
//  that point on — and anyone allowed to read the trail can check that in their browser.
// ─────────────────────────────────────────────────────────────────────────────

/** Collections that are never audited: live presence and cursors (noise), and the trail itself. */
export const AUDIT_SKIP = ['audit', 'private', 'presence', 'cursors'];
/** Bookkeeping fields every save touches; they never count as a change on their own. */
export const AUDIT_META = ['updatedAt', 'updatedBy'];
export const AUDIT_MAX_CHANGES = 25;
const MAX_VALUE = 160;

/** Human names for the collections, used on screen and in the CSV export. */
export const AUDIT_KINDS = {
  team: 'Team settings', members: 'Member', invites: 'Invitation', categories: 'Row', tasks: 'Task', comments: 'Comment',
  templates: 'Template', meetings: 'Meeting', notebook: 'Notebook entry', parts: 'Part', profiles: 'Profile',
  whiteboards: 'Whiteboard', wbItems: 'Whiteboard item', risks: 'Risk', requirements: 'Requirement', papers: 'Paper',
  expenses: 'Spending', financeLog: 'Finance log', finance: 'Budget', removed: 'Removed task', requests: 'Request',
  dissertation: 'Dissertation',
};
export const auditKind = (col) => AUDIT_KINDS[col] || col;
export const audited = (col) => typeof col === 'string' && !!col && !AUDIT_SKIP.includes(col);

// ── SHA-256 (synchronous, no dependencies; checked against node:crypto in tests/audit.test.mjs) ──
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

/** SHA-256 of a string (UTF-8), as lowercase hex. */
export function sha256(text) {
  const bytes = new TextEncoder().encode(String(text));
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, x => x.toString(16).padStart(8, '0')).join('');
}

// ── Canonical form: the same value always gives the same text, whatever its key order ──
function plain(v) {
  if (v === undefined) return null;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v.toMillis === 'function') return v.toMillis();                     // Firestore Timestamp
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && Object.keys(v).length <= 2) return { lat: v.latitude, lng: v.longitude };
  if (typeof v.path === 'string' && typeof v.id === 'string' && v.firestore) return '/' + v.path;  // DocumentReference
  if (v instanceof Uint8Array) return 'bytes:' + v.length;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { if (v[k] !== undefined) o[k] = plain(v[k]); }); return o; }
  return String(v);
}
/** JSON with keys sorted at every level (and Firestore types turned into plain values). */
export const canonical = (v) => JSON.stringify(plain(v));
/** The fingerprint of a whole document: shows later whether a record still says what it said then. */
export const docHash = (doc) => (doc ? sha256(canonical(doc)) : '');

// ── What changed ────────────────────────────────────────────────────────────
const isPrim = (v) => v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v);
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.toMillis !== 'function';
const short = (v) => {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(plain(v));
  return s.length > MAX_VALUE ? s.slice(0, MAX_VALUE - 1) + '…' : s;
};
/** Flatten one level: { signoff: { status: 'x' } } → { 'signoff.status': 'x' }. Deeper values and lists stay whole. */
function flat(doc) {
  const out = {};
  Object.entries(doc || {}).forEach(([k, v]) => {
    if (AUDIT_META.includes(k)) return;
    if (isMap(v) && Object.keys(v).length && Object.keys(v).length <= 20) Object.entries(v).forEach(([k2, v2]) => { out[k + '.' + k2] = v2; });
    else out[k] = v;
  });
  return out;
}
/**
 * The fields that changed between two versions of a document: [{ f, from, to }].
 * Simple values keep a short before/after; lists and deeper objects say only that they changed.
 */
export function auditChanges(before, after) {
  if (!before || !after) return [];
  const a = flat(before), b = flat(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const out = [];
  for (const k of keys) {
    if (canonical(a[k]) === canonical(b[k])) continue;
    if (out.length >= AUDIT_MAX_CHANGES) { out.push({ f: '…', from: '', to: (keys.length - out.length) + ' more' }); break; }
    out.push(isPrim(a[k]) && isPrim(b[k]) ? { f: k, from: short(a[k]), to: short(b[k]) } : { f: k });
  }
  return out;
}

/** A readable name for a record: its name, title or text, else its id. */
export function auditLabel(col, doc, id) {
  const d = doc || {};
  const v = d.name || d.title || d.text || d.email || d.description || '';
  return short(String(v || '').replace(/\s+/g, ' ').trim()) || (col === 'team' ? 'Team' : String(id || ''));
}

/** Who made the change. The server knows the signed-in account behind every write. */
export function auditActor(authType, authId, name) {
  if (authType === 'app_user' || authType === 'demo') return { type: 'person', uid: String(authId || ''), name: String(name || '').slice(0, 80) };
  if (authType === 'unauthenticated') return { type: 'unknown', uid: '', name: 'Not signed in' };
  return { type: 'server', uid: '', name: 'Penteint server' };   // service account, system, Cloud Functions (e.g. GitHub sync)
}

/**
 * The entry for one write, before it joins the chain.
 * col: 'team' for the team document itself, else the sub-collection.
 */
export function auditEntry({ col, docId, before, after, actor, at, eventId = '' }) {
  const action = !before && after ? 'create' : before && !after ? 'delete' : 'update';
  return {
    at: Math.round(Number(at) || 0), eventId: String(eventId || ''),
    actor: actor || auditActor('system'), col: String(col), docId: String(docId || ''), action,
    label: auditLabel(col, after || before, docId),
    changes: action === 'update' ? auditChanges(before, after) : [],
    docHash: docHash(after),
  };
}

/** Put an entry into the chain: give it the next number and the hashes that tie it to the one before. */
export function chainEntry(entry, head) {
  const prev = head && head.hash ? head : { seq: 0, hash: '' };
  const linked = { ...entry, seq: (Number(prev.seq) || 0) + 1, prevHash: prev.hash || '' };
  const { hash: _drop, ...body } = linked;
  return { ...linked, hash: sha256(linked.prevHash + '\n' + canonical(body)) };
}

/**
 * Check a run of entries (any order). Returns { ok, checked, from, to, problem }.
 * `problem` names the first entry that doesn't add up: { seq, why }.
 * Only entries that were read can be checked, so a run that starts after #1 trusts its first link.
 */
export function verifyChain(entries) {
  const list = [...(entries || [])].filter(e => e && Number.isFinite(e.seq)).sort((a, b) => a.seq - b.seq);
  if (!list.length) return { ok: true, checked: 0, from: 0, to: 0, problem: null };
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const { hash, id: _id, ...body } = e;
    if (sha256((e.prevHash || '') + '\n' + canonical(body)) !== hash) return fail(list, e.seq, 'This entry was changed after it was written.');
    if (i === 0) { if (e.seq === 1 && e.prevHash) return fail(list, e.seq, 'The first entry points to one before it.'); continue; }
    const p = list[i - 1];
    if (e.seq !== p.seq + 1) return fail(list, e.seq, 'Entries ' + (p.seq + 1) + (e.seq - 1 > p.seq + 1 ? '–' + (e.seq - 1) : '') + ' are missing.');
    if (e.prevHash !== p.hash) return fail(list, e.seq, 'This entry doesn’t follow on from the one before.');
  }
  return { ok: true, checked: list.length, from: list[0].seq, to: list.at(-1).seq, problem: null };
}
const fail = (list, seq, why) => ({ ok: false, checked: list.length, from: list[0].seq, to: list.at(-1).seq, problem: { seq, why } });

/** The audit trail as CSV (newest first), for auditors and spreadsheets. */
export function auditCsv(entries) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Number', 'When (UTC)', 'Who', 'Account', 'Action', 'Record type', 'Record', 'Record id', 'Changes', 'Record fingerprint', 'Entry hash', 'Previous hash']];
  [...entries].sort((a, b) => b.seq - a.seq).forEach(e => rows.push([
    e.seq, new Date(e.at).toISOString(), e.actor && e.actor.name, e.actor && (e.actor.uid || e.actor.type), e.action, auditKind(e.col), e.label, e.docId,
    (e.changes || []).map(c => c.from !== undefined ? `${c.f}: ${c.from} → ${c.to}` : c.f).join('; '), e.docHash, e.hash, e.prevHash,
  ]));
  return rows.map(r => r.map(q).join(',')).join('\r\n');
}
