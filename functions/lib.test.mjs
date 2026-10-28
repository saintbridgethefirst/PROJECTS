import test from 'node:test';
import assert from 'node:assert/strict';
import { isAcademicEmail, hashCode, checkSend, checkConfirm, newCode, emailKey, codeEmail, MAX_SENDS_PER_HOUR, MAX_ATTEMPTS } from './lib.js';

test('university emails', () => {
  ['a@bristol.ac.uk', ' B@MIT.EDU ', 'c@unsw.edu.au', 'd@student.ethz.ch'].forEach(e => assert.ok(isAcademicEmail(e), e));
  ['a@gmail.com', 'x@ac.uk.evil.com', 'bad', 'a b@bristol.ac.uk'].forEach(e => assert.ok(!isAcademicEmail(e), e));
});
test('codes: six digits, stored hashed per account', () => {
  for (let i = 0; i < 50; i++) assert.match(newCode(), /^\d{6}$/);
  assert.notEqual(hashCode('u1', '123456'), hashCode('u2', '123456'));
  assert.equal(emailKey(' A@Bristol.ac.uk'), emailKey('a@bristol.ac.uk'));
  assert.ok(codeEmail('123456').subject.startsWith('123456'));
});
test('rate limit on sending', () => {
  const now = 10_000_000;
  assert.ok(checkSend({}, now).ok);
  const full = { sends: Array.from({ length: MAX_SENDS_PER_HOUR }, (_, i) => now - i * 60e3) };
  assert.ok(!checkSend(full, now).ok);
  assert.ok(checkSend({ sends: full.sends.map(t => t - 3600e3) }, now).ok, 'older than an hour no longer counts');
});
test('confirming a code', () => {
  const now = 1000; const state = { hash: hashCode('u', '042042'), expires: now + 60e3, attempts: 0 };
  assert.ok(checkConfirm(state, 'u', '042042', now).ok);
  assert.ok(!checkConfirm(state, 'other', '042042', now).ok, 'a code works only for the account it was sent to');
  const wrong = checkConfirm(state, 'u', '111111', now); assert.ok(!wrong.ok && wrong.attempts === 1);
  assert.match(checkConfirm(state, 'u', '042042', now + 61e3).error, /expired/);
  assert.match(checkConfirm({ ...state, attempts: MAX_ATTEMPTS }, 'u', '042042', now).error, /Too many/);
  assert.match(checkConfirm(undefined, 'u', '1', now).error, /code first/);
});

import { proActive, wants, mentionEmail, digestItems, digestEmail, esc } from './lib.js';
test('which teams get emails', () => {
  assert.ok(proActive({ tier: 'pro' }) && proActive({ tier: 'org', until: 0 }) && proActive({ tier: 'pro', edu: true, until: Date.now() + 1e6 }));
  assert.ok(!proActive({ tier: 'free' }) && !proActive(null) && !proActive({ tier: 'pro', until: Date.now() - 1 }), 'Free and expired plans get none');
  assert.ok(wants({}, 'mentions') && wants(undefined, 'digest') && !wants({ notify: { digest: false } }, 'digest'));
});
test('mention email is escaped and links to the team', () => {
  const m = mentionEmail({ appUrl: 'https://x.app', author: 'Aisha <b>', teamName: 'UAS', taskName: 'Wire ESC', text: '<script>alert(1)</script> check', teamId: 't1' });
  assert.ok(m.subject.startsWith('Aisha <b> mentioned you on “Wire ESC”'));
  assert.ok(!m.html.includes('<script>') && m.html.includes('&lt;script&gt;') && m.html.includes('https://x.app/#/t/t1'));
  assert.ok(m.text.includes('Open it: https://x.app/#/t/t1'));
  assert.equal(esc('"&\''), '&quot;&amp;&#39;');
});
test('Monday digest: overdue and next 7 days, mine only, open only', () => {
  const tasks = [
    { id: 'a', name: 'Late', ownerUid: 'u', dueDate: '2026-10-15', flag: 'none' }, { id: 'b', name: 'Soon', ownerUid: 'u', dueDate: '2026-10-22', flag: 'none' },
    { id: 'c', name: 'Far', ownerUid: 'u', dueDate: '2026-11-30', flag: 'none' }, { id: 'd', name: 'Done', ownerUid: 'u', dueDate: '2026-10-15', flag: 'completed' },
    { id: 'e', name: 'Theirs', ownerUid: 'x', dueDate: '2026-10-20', flag: 'none' }, { id: 'f', name: 'No date', ownerUid: 'u', flag: 'none' },
  ];
  const it = digestItems(tasks, 'u', '2026-10-19');
  assert.deepEqual(it.overdue.map(t => t.name), ['Late']); assert.deepEqual(it.soon.map(t => t.name), ['Soon']);
  const mail = digestEmail({ appUrl: 'https://x.app', name: 'Rushi', teams: [{ teamId: 't', teamName: 'UAS', ...it }], today: '2026-10-19' });
  assert.equal(mail.subject, 'Your week: 1 overdue, 1 due in the next 7 days');
  assert.ok(mail.html.includes('Late') && mail.html.includes('Soon') && !mail.html.includes('Far'));
  assert.equal(digestEmail({ appUrl: 'x', teams: [{ teamId: 't', teamName: 'A', overdue: [], soon: [] }], today: '2026-10-19' }), null, 'nothing to say → no email');
});
test('Monday digest: a task carried into later weeks shows once, and not at all once its newest copy is done', () => {
  const weeks = [{ key: 'w1' }, { key: 'w2' }, { key: 'w3' }];
  const copy = (id, weekId, flag = 'none', carryOf = 'a') => ({ id, carryOf: id === 'a' ? '' : carryOf, name: 'Wire ESC', ownerUid: 'u', dueDate: '2026-10-15', flag, weekId });
  assert.deepEqual(digestItems([copy('a', 'w1'), copy('b', 'w2'), copy('c', 'w3')], 'u', '2026-10-19', weeks).overdue.map(t => t.id), ['c']);
  assert.equal(digestItems([copy('a', 'w1'), copy('b', 'w2'), copy('c', 'w3', 'completed')], 'u', '2026-10-19', weeks).overdue.length, 0);
});

import { inviteChanged, inviteEmail } from './lib.js';
test('invitation emails: new or re-sent only, escaped', () => {
  assert.ok(inviteChanged(undefined, { email: 'a@x', createdAt: 1 }) && inviteChanged({ email: 'a@x', createdAt: 1 }, { email: 'a@x', createdAt: 2 }));
  assert.ok(!inviteChanged({ email: 'a@x', createdAt: 1 }, { email: 'a@x', createdAt: 1, emailedAt: 5 }), 'recording delivery does not send again');
  assert.ok(!inviteChanged({ email: 'a@x', createdAt: 1 }, undefined), 'revoked: nothing to send');
  const m = inviteEmail({ appUrl: 'https://x.app', inviter: 'Aisha <i>', teamName: 'UAS', roleName: 'Member', email: 'tom@bristol.ac.uk' });
  assert.equal(m.subject, 'Aisha <i> invited you to UAS on Trawpie');
  assert.ok(m.html.includes('Aisha &lt;i&gt;') && m.text.includes('tom@bristol.ac.uk') && m.html.includes('https://x.app'));
});

test('every Cloud Function has a small instance cap (cost safety)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const defs = src.split('\n').filter(l => /^export const \w+ = on\w+\(\{/.test(l));
  assert.ok(defs.length >= 5, 'found the functions');
  defs.forEach(d => { const m = /maxInstances: (\d+)/.exec(d); assert.ok(m && +m[1] <= 5, 'cap missing or too high in: ' + d.slice(0, 60)); });
  assert.match(src, /setGlobalOptions\(\{[^}]*maxInstances: 3/);
});

import { errorSignature, signatureId, shouldAlert, errorAlertEmail, feedbackEmail, ALERT_REPEAT_HOURS } from './lib.js';
test('error alerts: the same error with different ids/numbers is one error', () => {
  assert.equal(errorSignature('write', 'permission-denied: tasks/t_8f3a9c21b7 at 1729412345'), errorSignature('write', 'permission-denied: tasks/t_0011aabbcc at 99'));
  assert.notEqual(errorSignature('error', 'x is undefined'), errorSignature('promise', 'x is undefined'));
  assert.match(signatureId('a'), /^[0-9a-f]{32}$/);
});
test('error alerts: once a day per kind of error', () => {
  const now = 1e12;
  assert.ok(shouldAlert(undefined, now));
  assert.ok(!shouldAlert({ lastEmailedAt: now - 3600e3 }, now));
  assert.ok(shouldAlert({ lastEmailedAt: now - ALERT_REPEAT_HOURS * 3600e3 }, now));
});
test('alert and feedback emails escape what users typed', () => {
  const a = errorAlertEmail({ appUrl: 'https://x.app', err: { kind: 'error', msg: '<img src=x onerror=alert(1)>', stack: 'at <b>', where: '#/t', build: 'b1', ua: 'UA' } });
  assert.ok(!a.html.includes('<img') && a.html.includes('&lt;img'));
  const f = feedbackEmail({ appUrl: 'https://x.app', fb: { kind: 'idea', text: 'Dark <script>', name: 'Aisha', email: 'a@uni.ac.uk', errors: ['boom'] } });
  assert.ok(f.subject.startsWith('💡 Idea from Aisha') && !f.html.includes('<script') && f.html.includes('boom') && f.text.includes('Reply to this email'));
});

import { scrubPerson, FORMER_MEMBER } from './lib.js';
test('your data: a deleted person’s name and email are removed from shared records', () => {
  const names = new Set(['Tom Reed']), emails = new Set(['tom@uni.ac.uk']);
  const task = { name: 'Tom Reed’s gearbox', updatedBy: 'Tom Reed', createdBy: 'uTom', history: [{ user: 'Tom Reed', field: 'Title' }, { user: 'Aisha Khan', field: 'Due' }] };
  const r = scrubPerson(task, names, emails);
  assert.deepEqual(Object.keys(r.value).sort(), ['history', 'updatedBy']);
  assert.equal(r.value.updatedBy, FORMER_MEMBER);
  assert.deepEqual(r.value.history.map(h => h.user), [FORMER_MEMBER, 'Aisha Khan']);
  assert.equal(scrubPerson({ authorName: 'Tom Reed', text: 'Ask Tom Reed' }, names, emails).value.text, undefined, 'what they wrote stays');
  assert.equal(scrubPerson({ email: 'TOM@uni.ac.uk', byName: 'Tom Reed' }, names, emails).value.email, '');
  assert.equal(scrubPerson({ authorName: 'Aisha Khan', createdBy: 'Tom Reed' }, names, emails).changed, false, 'ids and other people untouched');
  assert.equal(scrubPerson({ authorUid: 'u-aisha', authorName: 'Tom Reed', text: 'x' }, names, emails, 'u-tom').changed, false, 'a record that names someone else by id keeps its name');
  assert.equal(scrubPerson({ authorUid: 'u-tom', authorName: 'Tom Reed' }, names, emails, 'u-tom').value.authorName, FORMER_MEMBER, 'their own record loses the name');
});
