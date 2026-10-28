// ─────────────────────────────────────────────────────────────────────────────
//  Your data (GDPR): download everything about you, delete your account, hand a
//  team over to someone else. Called from index.js; takes the Admin Firestore so
//  it can be tested against the emulator (tests/privacy.test.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { normEmail, scrubPerson, FORMER_MEMBER } from './lib.js';

/** Everything inside a team, besides members/profiles. */
export const TEAM_COLLECTIONS = ['tasks', 'categories', 'comments', 'notebook', 'meetings', 'parts', 'papers', 'risks', 'requirements', 'whiteboards', 'wbItems', 'templates', 'expenses', 'financeLog', 'finance', 'invites', 'requests', 'removed'];
/** Fields that say a record was made by, or belongs to, a person. */
const BY_FIELDS = ['createdBy', 'authorUid', 'ownerUid', 'by', 'invitedBy', 'uid', 'supportPersonId', 'supportPersonId2'];

const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === 'object' && typeof x.toDate === 'function' ? x.toDate().toISOString() : x)));
const rows = (snap) => snap.docs.map(d => ({ id: d.id, ...plain(d.data()) }));
async function getData(db, path) { const d = await db.doc(path).get(); return d.exists ? plain(d.data()) : null; }
async function memberships(db, uid) {
  const snap = await db.collectionGroup('members').where('uid', '==', uid).get();
  return snap.docs.map(d => ({ teamId: d.ref.parent.parent.id, ref: d.ref, member: d.data() }));
}

/** account = { uid, email, displayName, providers[], createdAt, lastSignInAt } from Firebase Auth. */
export async function exportUserData(db, account) {
  const uid = account.uid; const email = normEmail(account.email || '');
  const out = {
    about: 'Everything Trawpie stores about you, as of ' + new Date().toISOString() + '. Teams also hold work you shared with your teammates (tasks, comments, notes); the parts you made or that are assigned to you are listed under each team.',
    account, profile: await getData(db, 'users/' + uid),
    studentVerification: await getData(db, 'verifiedStudents/' + uid), proEducationClaims: await getData(db, 'eduClaims/' + uid),
    feedbackYouSent: rows(await db.collection('feedback').where('uid', '==', uid).get()),
    selfTrack: rows(await db.collection('selfItems').where('uid', '==', uid).get()),
    errorReportsFromYourBrowser: rows(await db.collection('clientErrors').where('uid', '==', uid).get()),
    // Invitations go to an email address: only someone who has proved it's theirs sees them (as in the app)
    invitationsToYou: email && account.emailVerified ? (await db.collectionGroup('invites').where('email', '==', email).get()).docs.map(d => ({ teamId: d.ref.parent.parent.id, ...plain(d.data()) })) : [],
    teams: [],
  };
  for (const m of await memberships(db, uid)) {
    const team = (await getData(db, 'teams/' + m.teamId)) || {};
    const t = { teamId: m.teamId, teamName: team.name || '', yourMembership: plain(m.member), yourProfileInTeam: await getData(db, `teams/${m.teamId}/profiles/${uid}`), yourStatusInTeam: await getData(db, `teams/${m.teamId}/presence/${uid}`), yours: {} };
    for (const c of TEAM_COLLECTIONS) {
      const mine = rows(await db.collection(`teams/${m.teamId}/${c}`).get()).filter(r => BY_FIELDS.some(f => r[f] === uid) || (Array.isArray(r.attendees) && r.attendees.includes(uid)) || (Array.isArray(r.mentions) && r.mentions.includes(uid)));
      if (mine.length) t.yours[c] = mine;
    }
    out.teams.push(t);
  }
  return out;
}

/** Teams you own that still have other members: hand them over before deleting your account. */
export async function teamsToHandOver(db, uid) {
  const out = [];
  for (const m of (await memberships(db, uid)).filter(x => x.member.roleId === 'owner')) {
    const n = (await db.collection(`teams/${m.teamId}/members`).count().get()).data().count;
    if (n > 1) out.push({ teamId: m.teamId, name: ((await getData(db, 'teams/' + m.teamId)) || {}).name || m.teamId, members: n });
  }
  return out;
}

async function writeAll(db, ops) {
  for (let i = 0; i < ops.length; i += 400) { const b = db.batch(); ops.slice(i, i + 400).forEach(o => (o.del ? b.delete(o.ref) : b.update(o.ref, o.data))); await b.commit(); }
}

/**
 * Delete everything about a person (their login is deleted by the caller afterwards).
 *  • Teams they own alone: deleted completely. Teams they own with others: refused (hand over first).
 *  • Other teams: their membership and team profile go; their name in shared records (comments,
 *    history, notebook, meetings…) becomes "Former member". What they wrote stays with the team.
 *  • Their SelfTrack items, profile, student verification, Pro Education claims, feedback, error reports and
 *    invitations to their email are deleted.
 */
export async function deleteUserData(db, account) {
  const uid = account.uid; const email = normEmail(account.email || '');
  const blocking = await teamsToHandOver(db, uid);
  if (blocking.length) { const e = new Error('Hand over these teams first: ' + blocking.map(b => b.name).join(', ')); e.code = 'owns-teams'; e.teams = blocking; throw e; }
  const mine = await memberships(db, uid);
  const names = new Set([account.displayName, ...mine.map(m => m.member.name)].map(n => String(n || '').trim()).filter(n => n.length >= 2));
  const emails = new Set([email, ...mine.map(m => normEmail(m.member.email || ''))].filter(Boolean));
  const summary = { teamsDeleted: 0, teamsLeft: 0, recordsAnonymised: 0, privateRecordsDeleted: 0 };
  for (const m of mine) {
    const teamRef = db.doc('teams/' + m.teamId);
    if (m.member.roleId === 'owner') { await db.recursiveDelete(teamRef); summary.teamsDeleted++; continue; }
    const ops = [];
    // A name or email another member of this team still uses is left alone (someone may have taken a
    // teammate's name to erase their history by deleting their own account).
    const others = (await db.collection(`teams/${m.teamId}/members`).get()).docs.filter(d => d.id !== uid).map(d => d.data());
    const teamNames = new Set([...names].filter(n => !others.some(o => String(o.name || '').trim() === n)));
    const teamEmails = new Set([...emails].filter(e => !others.some(o => normEmail(o.email || '') === e)));
    for (const c of TEAM_COLLECTIONS) {
      (await db.collection(`teams/${m.teamId}/${c}`).get()).docs.forEach(d => {
        const r = scrubPerson(d.data(), teamNames, teamEmails, uid);
        if (r.changed) ops.push({ ref: d.ref, data: r.value });
      });
    }
    summary.recordsAnonymised += ops.length;
    ops.push({ ref: db.doc(`teams/${m.teamId}/profiles/${uid}`), del: true }, { ref: db.doc(`teams/${m.teamId}/presence/${uid}`), del: true }, { ref: m.ref, del: true });
    await writeAll(db, ops); summary.teamsLeft++;
  }
  const del = [];
  for (const p of ['users/', 'verifiedStudents/', 'eduClaims/', 'studentCodes/']) del.push(db.doc(p + uid));
  for (const q of [db.collection('feedback').where('uid', '==', uid), db.collection('clientErrors').where('uid', '==', uid), db.collection('studentEmails').where('uid', '==', uid), db.collection('selfItems').where('uid', '==', uid)]) (await q.get()).docs.forEach(d => del.push(d.ref));
  if (email && account.emailVerified) (await db.collectionGroup('invites').where('email', '==', email).get()).docs.forEach(d => del.push(d.ref));
  (await db.collection('inviteQuota').where('__name__', '>=', db.doc('inviteQuota/' + uid + '_')).where('__name__', '<', db.doc('inviteQuota/' + uid + '_~')).get()).docs.forEach(d => del.push(d.ref));
  await writeAll(db, del.map(ref => ({ ref, del: true })));
  summary.privateRecordsDeleted = del.length;
  return summary;
}

/** The owner makes another member the owner; the old owner becomes an Admin. */
export async function transferOwnership(db, uid, teamId, toUid) {
  if (!teamId || !toUid || toUid === uid) { const e = new Error('Choose another member.'); e.code = 'invalid-argument'; throw e; }
  return db.runTransaction(async (tx) => {
    const teamRef = db.doc('teams/' + teamId), meRef = db.doc(`teams/${teamId}/members/${uid}`), toRef = db.doc(`teams/${teamId}/members/${toUid}`);
    const [team, me, to] = await Promise.all([tx.get(teamRef), tx.get(meRef), tx.get(toRef)]);
    const fail = (code, msg) => { const e = new Error(msg); e.code = code; throw e; };
    if (!team.exists || !me.exists || me.data().roleId !== 'owner' || team.data().ownerUid !== uid) fail('permission-denied', 'Only the team owner can hand the team over.');
    if (!to.exists) fail('not-found', 'That person isn’t a member of this team any more.');
    const roles = team.data().roles || {}; const mine = roles.admin ? 'admin' : (to.data().roleId || 'member');
    tx.update(toRef, { roleId: 'owner' }); tx.update(meRef, { roleId: mine }); tx.update(teamRef, { ownerUid: toUid });
    return { ok: true, yourRole: mine };
  });
}
export { FORMER_MEMBER };
