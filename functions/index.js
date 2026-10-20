// ─────────────────────────────────────────────────────────────────────────────
//  TeamTrack Cloud Functions (Blaze plan). Deploy from the project folder:
//    cd functions && npm install && cd .. && firebase deploy --only functions
//  First deploy asks for:
//    RESEND_API_KEY — a SENDING-ONLY key from resend.com (paste it in the terminal, never in chat)
//    MAIL_FROM      — e.g.  TeamTrack <notifications@mail.trawpie.org>
//    APP_URL        — e.g.  https://uni-teamtrack.web.app
//  REGION must be your Firestore location's region (Firestore ▸ Settings), e.g. europe-west2 for London.
// ─────────────────────────────────────────────────────────────────────────────
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { normEmail, isAcademicEmail, newCode, hashCode, emailKey, checkSend, checkConfirm, codeEmail, CODE_MINUTES, VERIFIED_DAYS,
  proActive, wants, mentionEmail, digestItems, digestEmail, inviteChanged, inviteEmail, MAX_INVITE_EMAILS_PER_DAY,
  errorSignature, signatureId, shouldAlert, errorAlertEmail, feedbackEmail, MAX_ALERT_EMAILS_PER_DAY, MAX_FEEDBACK_EMAILS_PER_DAY } from './lib.js';

initializeApp();
const db = getFirestore();
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const MAIL_FROM = defineString('MAIL_FROM', { default: 'TeamTrack <notifications@mail.trawpie.org>' });
const APP_NAME = defineString('APP_NAME', { default: 'TeamTrack' });
const APP_URL = defineString('APP_URL', { default: 'https://uni-teamtrack.web.app' });
const REGION = 'europe-west2';

/** Send one email through Resend. idem = idempotency key, so a retried function never sends twice.
 *  Returns { ok } or { ok:false, reason } with Resend's own explanation (e.g. domain not verified). */
async function sendMail(to, { subject, text, html, replyTo }, idem) {
  let reason = 'no response';
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY.value(), 'Content-Type': 'application/json', ...(idem ? { 'Idempotency-Key': String(idem).slice(0, 256) } : {}) },
      body: JSON.stringify({ from: MAIL_FROM.value(), to: Array.isArray(to) ? to : [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (r.ok) return { ok: true };
    const body = await r.text(); let msg = body; try { msg = JSON.parse(body).message || body; } catch { /* plain text */ }
    reason = 'Resend ' + r.status + ': ' + String(msg).slice(0, 200);
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 500 * 2 ** attempt)); continue; }
    console.error('mail', reason); return { ok: false, reason };
  }
  console.error('mail', reason); return { ok: false, reason };
}

// ── Student email check ─────────────────────────────────────────────────────
/** Email a 6-digit code to a university address the signed-in person says is theirs. */
// Cost safety: no function may scale beyond a few copies, whatever happens (a bug, a loop, an attack).
setGlobalOptions({ region: REGION, maxInstances: 3, memory: '256MiB' });

export const sendStudentCode = onCall({ region: REGION, invoker: 'public', secrets: [RESEND_API_KEY], maxInstances: 3, timeoutSeconds: 30 }, (req) => explain('sendStudentCode', () => sendStudentCodeImpl(req)));
/** Log the real cause and give the person a readable reason instead of "internal". */
async function explain(name, fn) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error(name, e);
    throw new HttpsError('internal', 'Something went wrong on the server (' + String((e && (e.code || e.message)) || 'unknown').slice(0, 120) + '). Try again in a minute.');
  }
}
async function sendStudentCodeImpl(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = req.auth.uid; const email = normEmail(req.data && req.data.email);
  if (!isAcademicEmail(email)) throw new HttpsError('invalid-argument', 'Use a university email ending .ac.uk, .edu, .ac.xx or .edu.xx.');
  const owner = await db.doc('studentEmails/' + emailKey(email)).get();
  if (owner.exists && owner.data().uid !== uid) throw new HttpsError('already-exists', 'This university email is already linked to another account.');
  const ref = db.doc('studentCodes/' + uid); const now = Date.now(); const code = newCode();
  const res = await db.runTransaction(async (tx) => {
    const chk = checkSend((await tx.get(ref)).data() || {}, now);
    if (!chk.ok) return chk;
    tx.set(ref, { email, hash: hashCode(uid, code), expires: now + CODE_MINUTES * 60e3, attempts: 0, sends: chk.recent.concat(now) });
    return chk;
  });
  if (!res.ok) throw new HttpsError('resource-exhausted', res.error);
  const mail = await sendMail(email, codeEmail(code, APP_NAME.value()), 'code-' + uid + '-' + now);
  if (!mail.ok) throw new HttpsError('unavailable', 'Could not send the email: ' + mail.reason);
  return { sent: true, email };
}

/** Check the code; on success the account is a verified student for a year. */
export const confirmStudentCode = onCall({ region: REGION, invoker: 'public', maxInstances: 3, timeoutSeconds: 30 }, (req) => explain('confirmStudentCode', () => confirmStudentCodeImpl(req)));
async function confirmStudentCodeImpl(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = req.auth.uid; const ref = db.doc('studentCodes/' + uid); const now = Date.now();
  const res = await db.runTransaction(async (tx) => {
    const state = (await tx.get(ref)).data();
    const chk = checkConfirm(state, uid, req.data && req.data.code, now);
    if (!chk.ok) { if (chk.attempts) tx.update(ref, { attempts: chk.attempts }); return chk; }
    const keyRef = db.doc('studentEmails/' + emailKey(state.email)); const key = await tx.get(keyRef);
    if (key.exists && key.data().uid !== uid) return { ok: false, error: 'This university email is already linked to another account.' };
    const until = now + VERIFIED_DAYS * 864e5;
    tx.set(db.doc('verifiedStudents/' + uid), { email: state.email, verifiedAt: now, until });
    tx.set(keyRef, { uid, at: now });
    tx.delete(ref);
    return { ok: true, email: state.email, until };
  });
  if (!res.ok) throw new HttpsError('failed-precondition', res.error);
  return res;
}

// ── Email notifications (teams on Pro / Pro Education / Organisation) ───────
/** A comment that @mentions people → one email each (not to the author; only if they want them). */
export const emailMentions = onDocumentCreated({ document: 'teams/{teamId}/comments/{commentId}', region: REGION, secrets: [RESEND_API_KEY], maxInstances: 3, timeoutSeconds: 60 }, async (event) => {
  const c = event.data && event.data.data(); if (!c) return;
  const teamId = event.params.teamId;
  const uids = [...new Set((c.mentions || []).filter(u => typeof u === 'string' && u && u !== c.authorUid))].slice(0, 20);
  if (!uids.length) return;
  const team = (await db.doc('teams/' + teamId).get()).data();
  if (!team || !proActive(team.plan)) return;
  const task = c.taskId ? (await db.doc('teams/' + teamId + '/tasks/' + c.taskId).get()).data() : null;
  await Promise.all(uids.map(async (uid) => {
    const [m, u] = await Promise.all([db.doc('teams/' + teamId + '/members/' + uid).get(), db.doc('users/' + uid).get()]);
    if (!m.exists || !m.data().email || !wants(u.data(), 'mentions')) return;
    const mail = mentionEmail({ appName: APP_NAME.value(), appUrl: APP_URL.value(), author: c.authorName || 'Someone', teamName: team.name, taskName: task && task.name, text: c.text, teamId });
    await sendMail(m.data().email, mail, 'mention-' + event.params.commentId + '-' + uid);
  }));
});

/** Every Monday 08:00 UK time: each person's overdue and upcoming tasks across their Pro teams. */
export const mondayDigest = onSchedule({ schedule: '0 8 * * 1', timeZone: 'Europe/London', region: REGION, secrets: [RESEND_API_KEY], timeoutSeconds: 540, maxInstances: 1 }, async () => {
  const now = Date.now(); const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const teams = (await db.collection('teams').where('plan.tier', 'in', ['pro', 'org']).get()).docs.filter(d => proActive(d.data().plan, now));
  const people = new Map();   // uid → { email, name, teams: [] }
  for (const t of teams) {
    const [members, tasks] = await Promise.all([db.collection('teams/' + t.id + '/members').get(), db.collection('teams/' + t.id + '/tasks').where('flag', '!=', 'completed').get()]);
    const open = tasks.docs.map(d => d.data());
    members.docs.forEach(m => {
      const md = m.data(); if (!md.email) return;
      const items = digestItems(open, m.id, today); if (!items.overdue.length && !items.soon.length) return;
      const p = people.get(m.id) || { email: md.email, name: md.name, teams: [] };
      p.teams.push({ teamId: t.id, teamName: t.data().name, ...items }); people.set(m.id, p);
    });
  }
  let sent = 0;
  for (const [uid, p] of people) {
    const u = await db.doc('users/' + uid).get(); if (!wants(u.data(), 'digest')) continue;
    const mail = digestEmail({ appName: APP_NAME.value(), appUrl: APP_URL.value(), name: p.name, teams: p.teams, today });
    if (mail && (await sendMail(p.email, mail, 'digest-' + uid + '-' + today)).ok) sent++;
  }
  console.log('Monday digest sent to', sent, 'people from', teams.length, 'Pro teams');
});

// ── Invitations: the server emails the invited person ───────────────────────
/** A new (or re-sent) invitation → an email to that address. Delivery is recorded on the invitation. */
export const emailInvites = onDocumentWritten({ document: 'teams/{teamId}/invites/{email}', region: REGION, secrets: [RESEND_API_KEY], maxInstances: 3, timeoutSeconds: 60 }, async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : undefined;
  const after = event.data.after.exists ? event.data.after.data() : undefined;
  if (!inviteChanged(before, after)) return;
  const ref = event.data.after.ref; const today = new Date().toISOString().slice(0, 10);
  // At most MAX_INVITE_EMAILS_PER_DAY invitation emails a day per person inviting.
  const quota = db.doc('inviteQuota/' + (after.invitedBy || 'unknown') + '_' + today);
  const allowed = await db.runTransaction(async (tx) => { const n = ((await tx.get(quota)).data() || {}).n || 0; if (n >= MAX_INVITE_EMAILS_PER_DAY) return false; tx.set(quota, { n: n + 1, at: Date.now() }); return true; });
  if (!allowed) { await ref.update({ emailError: 'Daily invitation email limit reached — share the link yourself.' }); return; }
  const team = (await db.doc('teams/' + event.params.teamId).get()).data() || {};
  const role = (team.roles && team.roles[after.roleId] && team.roles[after.roleId].name) || after.roleId || 'Member';
  const mail = inviteEmail({ appName: APP_NAME.value(), appUrl: APP_URL.value(), inviter: after.invitedByName || 'A teammate', teamName: team.name || after.teamName || 'a team', roleName: role, email: after.email });
  const res = await sendMail(after.email, mail, 'invite-' + event.params.teamId + '-' + after.email + '-' + after.createdAt);
  await ref.update(res.ok ? { emailedAt: Date.now(), emailError: '' } : { emailError: res.reason });
});

// ── Feedback and error alerts → email to the platform admins ────────────────
// Platform admins are the people with a document at admins/{uid} (made by hand in the console).
async function adminEmails() {
  const ids = (await db.collection('admins').get()).docs.map(d => d.id);
  const users = await Promise.all(ids.map(uid => getAuth().getUser(uid).then(u => u.email).catch(() => null)));
  return [...new Set(users.filter(Boolean))];
}
/** Count one more email today under `name`; false once `max` is reached. */
async function underDailyLimit(name, max) {
  const ref = db.doc('alertQuota/' + name + '_' + new Date().toISOString().slice(0, 10));
  return db.runTransaction(async (tx) => { const n = ((await tx.get(ref)).data() || {}).n || 0; if (n >= max) return false; tx.set(ref, { n: n + 1, at: Date.now() }); return true; });
}

/** Someone pressed Feedback → email it to the platform admins (reply goes to the sender). */
export const emailFeedback = onDocumentCreated({ document: 'feedback/{id}', region: REGION, secrets: [RESEND_API_KEY], maxInstances: 2, timeoutSeconds: 60 }, async (event) => {
  const fb = event.data.data();
  if (!(await underDailyLimit('feedback', MAX_FEEDBACK_EMAILS_PER_DAY))) { console.warn('feedback email limit reached'); return; }
  const to = await adminEmails(); if (!to.length) { console.warn('no platform admins to email'); return; }
  const mail = feedbackEmail({ appName: APP_NAME.value(), appUrl: APP_URL.value(), fb });
  const res = await sendMail(to, { ...mail, replyTo: fb.email || undefined }, 'feedback-' + event.params.id);
  await event.data.ref.update({ emailedAt: res.ok ? Date.now() : 0 }).catch(() => {});
});

/** A new kind of error in someone's browser → one email to the platform admins (then at most daily). */
export const alertErrors = onDocumentCreated({ document: 'clientErrors/{id}', region: REGION, secrets: [RESEND_API_KEY], maxInstances: 2, timeoutSeconds: 60 }, async (event) => {
  const err = event.data.data();
  const ref = db.doc('errorAlerts/' + signatureId(errorSignature(err.kind, err.msg)));
  const now = Date.now();
  const seenBefore = await db.runTransaction(async (tx) => {
    const st = (await tx.get(ref)).data();
    if (!shouldAlert(st, now)) { tx.set(ref, { count: ((st && st.count) || 0) + 1, lastSeenAt: now }, { merge: true }); return -1; }
    tx.set(ref, { count: 0, lastSeenAt: now, lastEmailedAt: now, msg: String(err.msg || '').slice(0, 300), kind: err.kind || '' }, { merge: true });
    return (st && st.count) || 0;
  });
  if (seenBefore < 0) return;
  if (!(await underDailyLimit('errors', MAX_ALERT_EMAILS_PER_DAY))) { console.warn('error alert limit reached'); return; }
  const to = await adminEmails(); if (!to.length) return;
  await sendMail(to, errorAlertEmail({ appName: APP_NAME.value(), appUrl: APP_URL.value(), err, seenBefore }), 'err-' + event.params.id);
});
