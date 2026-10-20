// ─────────────────────────────────────────────────────────────────────────────
//  Pure helpers for the student-email check (no Firebase here, so they can be
//  tested on their own: npm test in this folder).
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';

/** Same list as ACADEMIC_EMAIL in src/model.js and academic() in firestore.rules. */
export const ACADEMIC_EMAIL = /@([a-z0-9-]+\.)+(ac\.[a-z]{2}|edu(\.[a-z]{2})?)$|@([a-z0-9-]+\.)*(ethz|epfl)\.ch$/;
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const isAcademicEmail = (e) => { const x = normEmail(e); return x.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(x) && ACADEMIC_EMAIL.test(x); };

export const CODE_MINUTES = 15;          // a code works for 15 minutes
export const MAX_ATTEMPTS = 5;           // wrong guesses before a new code is needed
export const MAX_SENDS_PER_HOUR = 5;     // emails per account per hour
export const VERIFIED_DAYS = 365;        // re-check once a year (graduates drop off)

export const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
/** Codes are stored hashed with the account id, never in plain text. */
export const hashCode = (uid, code) => crypto.createHash('sha256').update(uid + ':' + String(code)).digest('hex');
/** One university email can be linked to one account; the key hides the address. */
export const emailKey = (email) => crypto.createHash('sha256').update(normEmail(email)).digest('hex');

/** May this account be sent another code now? state = the stored code document (or {}). */
export function checkSend(state, now) {
  const recent = (Array.isArray(state && state.sends) ? state.sends : []).filter(t => now - t < 3600e3);
  if (recent.length >= MAX_SENDS_PER_HOUR) return { ok: false, error: 'Too many codes sent in the last hour. Try again later.', recent };
  return { ok: true, recent };
}

/** Does this code prove the email? Returns { ok } or { ok:false, error, attempts }. */
export function checkConfirm(state, uid, code, now) {
  if (!state || !state.hash) return { ok: false, error: 'Ask for a code first.' };
  if (now > state.expires) return { ok: false, error: 'That code has expired. Ask for a new one.' };
  const attempts = (state.attempts || 0) + 1;
  if (attempts > MAX_ATTEMPTS) return { ok: false, error: 'Too many wrong codes. Ask for a new one.', attempts };
  if (!/^\d{6}$/.test(String(code || '').trim())) return { ok: false, error: 'Enter the 6-digit code from the email.', attempts };
  const a = Buffer.from(hashCode(uid, String(code).trim())), b = Buffer.from(state.hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'That code isn’t right. Check the email and try again.', attempts };
  return { ok: true };
}

/** The email a student receives. */
export function codeEmail(code, appName = 'TeamTrack') {
  const subject = code + ' is your ' + appName + ' student code';
  const text = 'Your code to confirm your university email on ' + appName + ' is ' + code + '.\n\nIt works for ' + CODE_MINUTES + ' minutes. If you didn’t ask for it, ignore this email.';
  const html = '<p>Your code to confirm your university email on <b>' + appName + '</b> is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">' + code + '</p><p>It works for ' + CODE_MINUTES + ' minutes. If you didn’t ask for it, ignore this email.</p>';
  return { subject, text, html };
}

// ── Notifications ───────────────────────────────────────────────────────────
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Is a team's plan Pro (or Organisation) right now? Mirrors planOf() in src/model.js. */
export function proActive(plan, now = Date.now()) {
  const p = plan && typeof plan === 'object' ? plan : {};
  if (p.tier !== 'pro' && p.tier !== 'org') return false;
  return !(Number(p.until) > 0 && Number(p.until) < now);
}
/** Email choices on users/{uid}.notify — on unless switched off. */
export const wants = (userDoc, key) => !(userDoc && userDoc.notify && userDoc.notify[key] === false);
const day = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }); };
const shell = (appName, body, appUrl, why) => '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#1a202c">' + body +
  '<p style="margin-top:28px;font-size:12px;color:#718096">' + esc(why) + ' Change this in ' + esc(appName) + ' ▸ your account ▸ Email notifications: <a href="' + esc(appUrl) + '/#/account">' + esc(appUrl.replace(/^https?:\/\//, '')) + '</a></p></div>';

/** "Aisha mentioned you" — one email per mention. */
export function mentionEmail({ appName = 'TeamTrack', appUrl, author, teamName, taskName, text, teamId }) {
  const link = appUrl + '/#/t/' + encodeURIComponent(teamId);
  const subject = author + ' mentioned you' + (taskName ? ' on “' + taskName.slice(0, 60) + '”' : '') + ' · ' + teamName;
  const quote = String(text || '').slice(0, 600);
  const textBody = author + ' mentioned you in ' + teamName + (taskName ? ', on the task “' + taskName + '”' : '') + ':\n\n' + quote + '\n\nOpen it: ' + link;
  const html = shell(appName, '<p><b>' + esc(author) + '</b> mentioned you in <b>' + esc(teamName) + '</b>' + (taskName ? ', on <b>' + esc(taskName) + '</b>' : '') + ':</p>' +
    '<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #3182ce;background:#f7fafc;white-space:pre-wrap">' + esc(quote) + '</blockquote>' +
    '<p><a href="' + esc(link) + '" style="display:inline-block;background:#3182ce;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">Open in ' + esc(appName) + '</a></p>', appUrl, 'You get this because someone @mentioned you.');
  return { subject, text: textBody, html };
}

/** A person's open tasks in one team, split into overdue and due in the next 7 days. today = 'YYYY-MM-DD'. */
export function digestItems(tasks, uid, today) {
  const plus7 = new Date(Date.parse(today + 'T12:00:00Z') + 7 * 864e5).toISOString().slice(0, 10);
  const mine = (tasks || []).filter(t => t && t.ownerUid === uid && t.flag !== 'completed' && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate || ''));
  const byDue = (a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.name).localeCompare(String(b.name));
  return { overdue: mine.filter(t => t.dueDate < today).sort(byDue), soon: mine.filter(t => t.dueDate >= today && t.dueDate <= plus7).sort(byDue) };
}
/** The Monday digest for one person across their Pro teams: [{ teamName, teamId, overdue, soon }]. null when nothing to say. */
export function digestEmail({ appName = 'TeamTrack', appUrl, name, teams, today }) {
  const withWork = (teams || []).filter(t => t.overdue.length || t.soon.length);
  if (!withWork.length) return null;
  const over = withWork.reduce((a, t) => a + t.overdue.length, 0), soon = withWork.reduce((a, t) => a + t.soon.length, 0);
  const subject = 'Your week: ' + (over ? over + ' overdue, ' : '') + soon + ' due in the next 7 days';
  const line = (t) => '• ' + t.name + ' — ' + (t.dueDate < today ? 'was due ' : 'due ') + day(t.dueDate);
  const text = 'Hi ' + (name || 'there') + ',\n\n' + withWork.map(tm => tm.teamName + '\n' + [...tm.overdue.slice(0, 20), ...tm.soon.slice(0, 20)].map(line).join('\n') + '\nOpen: ' + appUrl + '/#/t/' + tm.teamId).join('\n\n') + '\n';
  const li = (t, late) => '<li style="margin:3px 0">' + esc(t.name) + ' <span style="color:' + (late ? '#c53030' : '#718096') + '">— ' + (late ? 'was due ' : 'due ') + esc(day(t.dueDate)) + '</span></li>';
  const html = shell(appName, '<p>Hi ' + esc(name || 'there') + ', here is your week.</p>' + withWork.map(tm =>
    '<h3 style="margin:20px 0 6px;font-size:16px">' + esc(tm.teamName) + '</h3>' +
    (tm.overdue.length ? '<p style="margin:6px 0 2px;color:#c53030"><b>Overdue (' + tm.overdue.length + ')</b></p><ul style="margin:0;padding-left:20px">' + tm.overdue.slice(0, 20).map(t => li(t, true)).join('') + '</ul>' : '') +
    (tm.soon.length ? '<p style="margin:10px 0 2px"><b>Due in the next 7 days (' + tm.soon.length + ')</b></p><ul style="margin:0;padding-left:20px">' + tm.soon.slice(0, 20).map(t => li(t, false)).join('') + '</ul>' : '') +
    '<p><a href="' + esc(appUrl + '/#/t/' + encodeURIComponent(tm.teamId)) + '">Open ' + esc(tm.teamName) + ' →</a></p>').join(''), appUrl, 'You get this Monday digest from teams on Pro.');
  return { subject, text, html };
}

// ── Invitations ─────────────────────────────────────────────────────────────
export const MAX_INVITE_EMAILS_PER_DAY = 60;   // per person inviting, to stop the app being used to spam
/** Send an invitation email for this write? Only for a new invitation or one re-sent (new createdAt). */
export const inviteChanged = (before, after) => !!after && !!after.email && (!before || before.createdAt !== after.createdAt);
export function inviteEmail({ appName = 'TeamTrack', appUrl, inviter, teamName, roleName, email }) {
  const subject = inviter + ' invited you to ' + teamName + ' on ' + appName;
  const text = inviter + ' invited you to join "' + teamName + '" on ' + appName + ' as ' + roleName + '.\n\n' +
    '1. Open ' + appUrl + '\n2. Sign in, or create an account, with this email address: ' + email + '\n3. Press "Join team" under Invitations.\n\nIf you weren\'t expecting this, ignore this email.';
  const html = '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#1a202c">' +
    '<p><b>' + esc(inviter) + '</b> invited you to join <b>' + esc(teamName) + '</b> on ' + esc(appName) + ' as ' + esc(roleName) + '.</p>' +
    '<p><a href="' + esc(appUrl) + '" style="display:inline-block;background:#3182ce;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open ' + esc(appName) + '</a></p>' +
    '<p>Sign in, or create an account, with <b>' + esc(email) + '</b>, then press <b>Join team</b> under Invitations.</p>' +
    '<p style="margin-top:24px;font-size:12px;color:#718096">If you weren’t expecting this, you can ignore this email.</p></div>';
  return { subject, text, html };
}

// ── Feedback and error alerts to the platform admins ────────────────────────
export const MAX_ALERT_EMAILS_PER_DAY = 10;      // new kinds of error
export const MAX_FEEDBACK_EMAILS_PER_DAY = 40;
export const ALERT_REPEAT_HOURS = 24;            // the same error is emailed again at most once a day

/** Errors that differ only in ids or numbers count as the same error. */
export function errorSignature(kind, msg) {
  return String(kind || '') + ':' + String(msg || '').replace(/[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*/g, '#').replace(/\s+/g, ' ').trim().slice(0, 200);
}
export const signatureId = (sig) => crypto.createHash('sha256').update(sig).digest('hex').slice(0, 32);
/** state = the stored alert for this signature (or undefined). Email now? */
export function shouldAlert(state, now) { return !state || !state.lastEmailedAt || now - state.lastEmailedAt >= ALERT_REPEAT_HOURS * 3600e3; }

const box = (rows) => '<table style="font-size:13px;border-collapse:collapse">' + rows.filter(r => r[1]).map(([k, v]) => '<tr><td style="padding:2px 12px 2px 0;color:#718096;vertical-align:top">' + esc(k) + '</td><td style="padding:2px 0">' + esc(v) + '</td></tr>').join('') + '</table>';
const wrap = (inner) => '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;color:#1a202c">' + inner + '</div>';

export function errorAlertEmail({ appName = 'TeamTrack', appUrl, err, seenBefore = 0 }) {
  const subject = '⚠️ ' + appName + ' error: ' + String(err.msg || 'Unknown error').slice(0, 90);
  const rows = [['Kind', err.kind], ['Where', err.where], ['Build', err.build], ['Browser', err.ua], ['Times since last email', seenBefore ? String(seenBefore) : '']];
  const text = subject + '\n\n' + rows.filter(r => r[1]).map(r => r[0] + ': ' + r[1]).join('\n') + '\n\n' + (err.stack || '') + '\n\nAll errors: ' + appUrl + ' → Settings ▸ Plan ▸ Platform admin.\nYou get one email per kind of error per day, at most ' + MAX_ALERT_EMAILS_PER_DAY + ' a day.';
  const html = wrap('<p><b>A new error in someone’s browser.</b></p><p style="font-size:15px"><b>' + esc(err.msg) + '</b></p>' + box(rows) +
    (err.stack ? '<pre style="font-size:12px;background:#f7fafc;padding:10px;border-radius:6px;white-space:pre-wrap">' + esc(err.stack) + '</pre>' : '') +
    '<p><a href="' + esc(appUrl) + '">Open ' + esc(appName) + '</a> → Settings ▸ Plan ▸ Platform admin to see all errors.</p>' +
    '<p style="font-size:12px;color:#718096">One email per kind of error per day, at most ' + MAX_ALERT_EMAILS_PER_DAY + ' a day.</p>');
  return { subject, text, html };
}

const KIND = { bug: '🐞 Something’s broken', idea: '💡 Idea', question: '❓ Question', other: '💬 Feedback' };
export function feedbackEmail({ appName = 'TeamTrack', appUrl, fb }) {
  const subject = (KIND[fb.kind] || KIND.other) + ' from ' + (fb.name || fb.email || 'a user') + ': ' + String(fb.text || '').replace(/\s+/g, ' ').slice(0, 60);
  const rows = [['From', [fb.name, fb.email].filter(Boolean).join(' · ')], ['Team', fb.teamId], ['Where', fb.where], ['Build', fb.build], ['Browser', fb.ua]];
  const errs = (fb.errors || []).filter(Boolean);
  const text = subject + '\n\n' + fb.text + '\n\n' + rows.filter(r => r[1]).map(r => r[0] + ': ' + r[1]).join('\n') + (errs.length ? '\n\nRecent errors on their screen:\n- ' + errs.join('\n- ') : '') + (fb.email ? '\n\nReply to this email to answer them.' : '');
  const html = wrap('<p style="font-size:15px;white-space:pre-wrap">' + esc(fb.text) + '</p>' + box(rows) +
    (errs.length ? '<p style="margin-bottom:4px"><b>Recent errors on their screen</b></p><ul style="font-size:12px;margin-top:0">' + errs.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>' : '') +
    (fb.email ? '<p style="font-size:12px;color:#718096">Reply to this email to answer them.</p>' : ''));
  return { subject, text, html };
}
