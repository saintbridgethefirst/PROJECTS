// ─────────────────────────────────────────────────────────────────────────────
//  DEMO backend — everything lives in this browser (localStorage). Each browser
//  tab can be signed in as a different demo account, so you can try invites and
//  roles by opening two tabs. Permissions are enforced by rules-sim.js, a copy
//  of the production security rules.
// ─────────────────────────────────────────────────────────────────────────────
import { checkWrite, checkRead, applyOps, checkProfileWrite } from '../rules-sim.js';
import { newId, isAcademicEmail } from '../model.js';
import { normEmail } from '../permissions.js';

const STORE_KEY = 'tt_demo_store_v1';
const SESSION_KEY = 'tt_demo_session_v1';

function load() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.teams && s.users) return s; } catch { /* fresh */ }
  return { users: {}, teams: {} };
}
let store = load();
const clone = (x) => JSON.parse(JSON.stringify(x));
const listeners = new Set();
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { console.warn('Demo storage full', e); }
  notify();
}
function notify() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
// Other tabs changed the store → reload and notify.
// Tests can hold other tabs' changes back (window.__ttHold = true), like a slow network: this tab
// keeps showing the old data, while its own saves still go to the latest stored data (the "server").
let heldBack = false;
window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { if (window.__ttHold) { heldBack = true; return; } store = load(); notify(); } });
window.__ttRelease = () => { window.__ttHold = false; if (heldBack) { heldBack = false; store = load(); notify(); } };

// ── Auth ────────────────────────────────────────────────────────────────────
let currentUser = null;
try { const s = JSON.parse(sessionStorage.getItem(SESSION_KEY)); if (s && store.users[s.uid]) currentUser = store.users[s.uid]; } catch { /* none */ }
const authListeners = new Set();
const emitAuth = () => authListeners.forEach(fn => fn(currentUser ? { ...currentUser } : null));

export const isDemo = true;

export const auth = {
  onChange(fn) { authListeners.add(fn); setTimeout(() => fn(currentUser ? { ...currentUser } : null), 0); return () => authListeners.delete(fn); },
  current: () => (currentUser ? { ...currentUser } : null),
  providers: { google: false, microsoft: false, emailLink: false, demo: true },
  demoUsers: () => Object.values(store.users),
  async signInDemo(email, name) {
    email = normEmail(email);
    if (!email) throw new Error('Enter an email');
    let u = Object.values(store.users).find(x => x.email === email);
    if (!u) { u = { uid: newId('u').slice(2), email, name: name || email.split('@')[0], photo: '', emailVerified: true, provider: 'demo' }; store.users[u.uid] = u; persist(); }
    currentUser = u; sessionStorage.setItem(SESSION_KEY, JSON.stringify({ uid: u.uid })); emitAuth();
  },
  async signOut() { currentUser = null; sessionStorage.removeItem(SESSION_KEY); emitAuth(); },
  async setTheme(theme) {
    if (!currentUser) throw new Error('Not signed in.');
    checkProfileWrite(authCtx(), currentUser.uid, { photo: currentUser.photo || '', theme, updatedAt: Date.now() });
    currentUser = { ...currentUser, theme }; store.users[currentUser.uid] = { ...currentUser }; persist();
    return { ...currentUser };
  },
  async setMenuStyle(menuStyle) {
    if (!currentUser) throw new Error('Not signed in.');
    checkProfileWrite(authCtx(), currentUser.uid, { photo: currentUser.photo || '', menuStyle, updatedAt: Date.now() });
    currentUser = { ...currentUser, menuStyle }; store.users[currentUser.uid] = { ...currentUser }; persist();
    return { ...currentUser };
  },
  async setNotify(notify) {
    if (!currentUser) throw new Error('Not signed in.');
    const n = { mentions: notify.mentions !== false, digest: notify.digest !== false };
    checkProfileWrite(authCtx(), currentUser.uid, { photo: currentUser.photo || '', notify: n, updatedAt: Date.now() });
    currentUser = { ...currentUser, notify: n }; store.users[currentUser.uid] = { ...currentUser }; persist();
    return { ...currentUser };
  },
  async updateName(name) { if (!currentUser) return; currentUser.name = name; store.users[currentUser.uid] = { ...currentUser }; persist(); emitAuth(); },
  async sendVerification() { /* demo accounts are always verified */ },
  /** Save (or with '' remove) your account photo and copy it to your membership in every team. */
  async setPhoto(photo) {
    if (!currentUser) throw new Error('Not signed in.');
    checkProfileWrite(authCtx(), currentUser.uid, { photo, updatedAt: Date.now() });
    currentUser = { ...currentUser, photo }; store.users[currentUser.uid] = { ...currentUser };
    Object.entries(store.teams).filter(([, T]) => T.members[currentUser.uid]).forEach(([id]) => {
      applyBatch(id, [{ type: 'update', path: 'members/' + currentUser.uid, data: { photo } }]);
    });
    persist(); emitAuth();
    return { ...currentUser };
  },
};

// ── Data ────────────────────────────────────────────────────────────────────
function authCtx() { return currentUser ? { uid: currentUser.uid, email: currentUser.email, emailVerified: !!currentUser.emailVerified } : null; }

/** Apply a batch atomically after checking every op against the rules. */
function applyBatch(teamId, ops) {
  if (window.__ttHold) { store = load(); }
  // An edit to something deleted meanwhile: leave it out, like the Firebase backend.
  const T = store.teams[teamId]; const skipped = [];
  if (T) ops = ops.filter(op => { const [c, id] = op.path.split('/'); if (op.type === 'update' && id && !op.path.startsWith('/') && !(T[c] && T[c][id])) { skipped.push(op.path); return false; } return true; });
  const pre = store; const post = applyOps(store, teamId, ops);
  ops.forEach(op => checkWrite(pre, post, authCtx(), teamId, op));
  store = post; persist();
  // Simulates the emailInvites Cloud Function: the server emails each new invitation.
  ops.filter(op => op.type === 'set' && /^invites\//.test(op.path)).forEach(op => setTimeout(() => {
    const inv = store.teams[teamId]?.invites?.[op.path.slice(8)];
    if (inv && inv.createdAt === op.data.createdAt) { inv.emailedAt = Date.now(); inv.emailError = ''; persist(); }
  }, 300));
  return { skipped };
}

function subscribe(compute, cb, onError) {
  let last = null;
  const run = () => {
    let v; try { v = compute(); } catch (e) { if (onError) onError(e); return; }
    const s = JSON.stringify(v); if (s !== last) { last = s; cb(clone(v)); }
  };
  listeners.add(run); setTimeout(run, 0);
  return () => listeners.delete(run);
}

export const data = {
  watchMyTeams(uid, cb) {
    return subscribe(() => Object.entries(store.teams).filter(([, T]) => T.members[uid]).map(([id, T]) => ({ id, name: T.doc.name, logo: T.doc.logo, roleId: T.members[uid].roleId, memberCount: Object.keys(T.members).length, plan: T.doc.plan })), cb);
  },
  watchMyInvites(email, cb) {
    email = normEmail(email);
    return subscribe(() => Object.entries(store.teams).filter(([, T]) => T.invites[email]).map(([id, T]) => ({ teamId: id, ...T.invites[email] })), cb);
  },
  watchTeam(teamId, h) {
    const unsubs = [
      subscribe(() => { checkRead(store, authCtx(), teamId); return { id: teamId, ...store.teams[teamId].doc }; }, h.onTeam, h.onError),
      subscribe(() => { checkRead(store, authCtx(), teamId); return Object.entries(store.teams[teamId].members).map(([uid, m]) => ({ ...m, uid })); }, h.onMembers, h.onError),
      subscribe(() => { checkRead(store, authCtx(), teamId); return Object.entries(store.teams[teamId].categories).map(([id, c]) => ({ ...c, id })); }, h.onCategories, h.onError),
      subscribe(() => { checkRead(store, authCtx(), teamId); return Object.entries(store.teams[teamId].tasks).map(([id, t]) => ({ ...t, id })); }, h.onTasks, h.onError),
    ];
    return () => unsubs.forEach(u => u());
  },
  watchInvites(teamId, cb, onError) {
    return subscribe(() => { checkRead(store, authCtx(), teamId); return Object.values(store.teams[teamId].invites); }, cb, onError);
  },
  /** Every document in one of the team's collections (templates, …). */
  watchCollection(teamId, coll, cb, onError) {
    return subscribe(() => { checkRead(store, authCtx(), teamId, coll); return Object.entries(store.teams[teamId][coll] || {}).map(([id, d]) => ({ ...d, id })); }, cb, onError);
  },
  /** The team's comments, newest first (at most 500). */
  watchComments(teamId, cb, onError) {
    return subscribe(() => { checkRead(store, authCtx(), teamId); return Object.entries(store.teams[teamId].comments || {}).map(([id, c]) => ({ ...c, id })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 500); }, cb, onError);
  },
  /** Comments that @mention me, in each of the given teams: { teamId: [comment] }. */
  watchMyMentions(teamIds, uid, cb, onError) {
    return subscribe(() => Object.fromEntries(teamIds.filter(id => store.teams[id] && store.teams[id].members[uid]).map(id =>
      [id, Object.entries(store.teams[id].comments || {}).filter(([, c]) => (c.mentions || []).includes(uid)).map(([cid, c]) => ({ ...c, id: cid }))])), cb, onError);
  },
  /** Tasks I own or support, across the given teams, with each team's weeks and phases. */
  async myWork(teamIds, uid) {
    return teamIds.filter(id => store.teams[id] && store.teams[id].members[uid]).map(id => {
      const T = store.teams[id];
      const tasks = Object.entries(T.tasks).map(([tid, t]) => ({ ...clone(t), id: tid })).filter(t => t.ownerUid === uid || t.supportPersonId === uid || t.supportPersonId2 === uid);
      return { teamId: id, team: clone(T.doc), tasks };
    });
  },
  async teamSnapshot(teamId) {
    checkRead(store, authCtx(), teamId); const T = store.teams[teamId];
    return clone({ teamId, team: T.doc, members: Object.entries(T.members).map(([uid, m]) => ({ ...m, uid })), tasks: Object.entries(T.tasks).map(([id, t]) => ({ ...t, id })), profiles: Object.entries(T.profiles || {}).map(([uid, p]) => ({ ...p, uid })) });
  },
  async commit(teamId, ops) { return applyBatch(teamId, ops); },
  /** Demo stand-in for the Cloud Functions: the code is shown on screen instead of emailed. */
  async callFunction(name, payload) {
    const me = currentUser; if (!me) throw Object.assign(new Error('Sign in first.'), { code: 'unauthenticated' });
    const root = store.root = store.root || {}; root.studentCodes = root.studentCodes || {}; root.verifiedStudents = root.verifiedStudents || {};
    const fail = (code, message) => { throw Object.assign(new Error(message), { code: 'functions/' + code }); };
    if (name === 'sendStudentCode') {
      const email = normEmail(payload && payload.email);
      if (!isAcademicEmail(email)) fail('invalid-argument', 'Use a university email ending .ac.uk, .edu, .ac.xx or .edu.xx.');
      const taken = Object.entries(root.verifiedStudents).find(([uid, v]) => v.email === email && uid !== me.uid);
      if (taken) fail('already-exists', 'This university email is already linked to another account.');
      const code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
      root.studentCodes[me.uid] = { email, code, expires: Date.now() + 15 * 60e3, attempts: 0 }; persist();
      return { sent: true, email, demoCode: code };
    }
    if (name === 'confirmStudentCode') {
      const st = root.studentCodes[me.uid];
      if (!st) fail('failed-precondition', 'Ask for a code first.');
      if (String(payload && payload.code).trim() !== st.code) { st.attempts++; persist(); fail('failed-precondition', 'That code isn’t right. Check the email and try again.'); }
      const until = Date.now() + 365 * 864e5;
      root.verifiedStudents[me.uid] = { email: st.email, verifiedAt: Date.now(), until }; delete root.studentCodes[me.uid]; persist();
      return { ok: true, email: st.email, until };
    }
    fail('not-found', 'No such function.');
  },
  async reportError(d) {
    const me = authCtx(); if (!me) return;
    const op = { type: 'set', path: '/clientErrors/' + newId('err'), data: { ...d, expireAt: Date.now() + 30 * 864e5 } };
    const post = applyOps(store, null, [op]); checkWrite(store, post, me, null, op);
    const list = post.root.clientErrors; const ids = Object.keys(list); if (ids.length > 200) delete list[ids[0]];
    store = post; persist();
  },
  async sendFeedback(d) {
    const me = authCtx(); if (!me) fail('unauthenticated', 'Sign in first.');
    const op = { type: 'set', path: '/feedback/' + newId('fb'), data: { ...d, expireAt: Date.now() + 365 * 864e5 } };
    const post = applyOps(store, null, [op]); checkWrite(store, post, me, null, op);
    store = post; persist();
  },
  watchFeedback(cb, onError) {
    return subscribe(() => {
      const me = authCtx(); if (!me || !(store.admins && store.admins[me.uid])) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      return Object.entries((store.root && store.root.feedback) || {}).map(([id, e]) => ({ ...e, id })).sort((a, b) => b.at - a.at);
    }, cb, onError);
  },
  watchClientErrors(cb, onError) {
    return subscribe(() => {
      const me = authCtx(); if (!me || !(store.admins && store.admins[me.uid])) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      return Object.entries((store.root && store.root.clientErrors) || {}).map(([id, e]) => ({ ...e, id })).sort((a, b) => b.at - a.at);
    }, cb, onError);
  },
  async myDoc(coll, uid) { return clone((store.root && store.root[coll] && store.root[coll][uid]) || null); },
  watchEduTeams(cb, onError) {
    return subscribe(() => {
      const me = authCtx(); if (!me || !(store.admins && store.admins[me.uid])) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      return Object.entries(store.teams).filter(([, T]) => T.doc.plan && T.doc.plan.edu).map(([id, T]) => ({ id, name: T.doc.name, plan: T.doc.plan }));
    }, cb, onError);
  },
  async isPlatformAdmin(uid) { return !!(store.admins && store.admins[uid]); },
  /** Demo only: make the signed-in account a platform admin, to try plans and Pro requests. */
  async demoMakeAdmin() { if (!currentUser) return; store.admins = { ...(store.admins || {}), [currentUser.uid]: true }; persist(); },
  watchPlanRequests(cb, onError) {
    return subscribe(() => {
      const me = authCtx(); if (!me || !(store.admins && store.admins[me.uid])) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      return Object.entries(store.teams).flatMap(([id, T]) => Object.entries(T.requests || {}).map(([rid, r]) => ({ ...r, id: rid, path: 'teams/' + id + '/requests/' + rid })));
    }, cb, onError);
  },
  async createTeam(teamDoc, ownerMember) {
    const id = newId('t');
    applyBatch(id, [{ type: 'set', path: 'team', data: teamDoc }, { type: 'set', path: 'members/' + ownerMember.uid, data: ownerMember }]);
    return id;
  },
  async acceptInvite(teamId, member, email) {
    applyBatch(teamId, [{ type: 'set', path: 'members/' + member.uid, data: member }, { type: 'delete', path: 'invites/' + normEmail(email) }]);
  },
  async declineInvite(teamId, email) { applyBatch(teamId, [{ type: 'delete', path: 'invites/' + normEmail(email) }]); },
  async deleteTeam(teamId) {
    const T = store.teams[teamId]; if (!T) return;
    // Same order as production: sub-documents, then the owner's membership, then the team doc.
    const ops = [];
    ['templates', 'comments', 'meetings', 'notebook', 'parts', 'papers', 'expenses', 'finance', 'financeLog', 'requests', 'profiles', 'risks', 'requirements', 'tasks', 'categories', 'invites'].forEach(c => Object.keys(T[c] || {}).forEach(id => ops.push({ type: 'delete', path: c + '/' + id })));
    Object.keys(T.members).filter(u => T.members[u].roleId !== 'owner').forEach(u => ops.push({ type: 'delete', path: 'members/' + u }));
    Object.keys(T.members).filter(u => T.members[u].roleId === 'owner').forEach(u => ops.push({ type: 'delete', path: 'members/' + u }));
    ops.push({ type: 'delete', path: 'team' });
    applyBatch(teamId, ops);
  },
  /** Demo-only helper: wipe all demo data. */
  resetDemo() { store = { users: {}, teams: {} }; persist(); auth.signOut(); },
};
