// ─────────────────────────────────────────────────────────────────────────────
//  PRODUCTION backend — Firebase Authentication + Cloud Firestore.
//  Free "Spark" plan is enough: login, database and hosting. No Cloud Storage
//  or Cloud Functions are used (both need the paid plan).
// ─────────────────────────────────────────────────────────────────────────────
import { runOpsWith } from './batch.js';
import { watchTasks, touchesArchive } from './tasksync.js';
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, OAuthProvider, signOut,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, sendEmailVerification,
  updateProfile, connectAuthEmulator, linkWithCredential,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, collectionGroup, doc, query, where, onSnapshot, writeBatch, getDocs, getDocsFromCache, getDoc, getDocFromCache, setDoc, orderBy, limit,
  terminate, clearIndexedDbPersistence,
} from 'firebase/firestore';
import { firebaseConfig, USE_EMULATORS, ENABLE_MS_SIGNIN, ENABLE_EMAIL_LINK, APPCHECK_SITE_KEY } from '../config.js';
import { newId } from '../model.js';
import { normEmail } from '../permissions.js';

const app = initializeApp(firebaseConfig);
// App Check runs before anything talks to the database or functions. On localhost it uses a debug
// token (printed in the console the first time; add it in Firebase ▸ App Check ▸ Manage debug tokens).
if (APPCHECK_SITE_KEY && !USE_EMULATORS) {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  try { initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true }); }
  catch (e) { console.warn('App Check not started', e); }
}
const fbAuth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (USE_EMULATORS) {
  connectAuthEmulator(fbAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export const isDemo = false;
const EMAIL_KEY = 'tt_email_for_signin';

// Uploaded account photo from users/{uid}; undefined = not loaded / none saved (then the
// Google or Microsoft picture is used).
let profilePhoto; let profileUid = null; let profileTheme = ''; let profileMenu = ''; let profileNav = ''; let profileNotify = null;
async function loadProfile(u) {
  profileUid = u ? u.uid : null; profilePhoto = undefined; profileTheme = ''; profileMenu = ''; profileNav = ''; profileNotify = null;
  if (!u) return;
  const ref = doc(db, 'users', u.uid);
  const apply = (s) => {
    if (profileUid !== u.uid || !s.exists()) return; const d = s.data();
    if (typeof d.photo === 'string') profilePhoto = d.photo; if (typeof d.theme === 'string') profileTheme = d.theme;
    if (typeof d.menuStyle === 'string') profileMenu = d.menuStyle; if (typeof d.nav === 'string') profileNav = d.nav;
    if (d.notify && typeof d.notify === 'object') profileNotify = d.notify;
  };
  // The copy saved on this device first, at once; the server's copy if it comes quickly. Never wait long
  // for it: a slow connection, or another tab of the app holding the database (another tab opened from the
  // guide or the blog), used to leave the app on its loading screen.
  try { apply(await getDocFromCache(ref)); } catch { /* not saved on this device yet */ }
  const fresh = getDoc(ref).then(apply).catch(e => console.warn('Could not load profile:', e));
  await Promise.race([fresh, new Promise(r => setTimeout(r, 2500))]);
}

function toUser(u) {
  if (!u) return null;
  const photo = (profileUid === u.uid && profilePhoto !== undefined) ? profilePhoto : (u.photoURL || '');
  return {
    uid: u.uid, email: normEmail(u.email), name: u.displayName || (u.email || '').split('@')[0] || 'User',
    photo, theme: profileUid === u.uid ? profileTheme : '', menuStyle: profileUid === u.uid ? profileMenu : '', nav: profileUid === u.uid ? profileNav : '', notify: profileUid === u.uid ? profileNotify : null, emailVerified: !!u.emailVerified,
    provider: (u.providerData[0] && u.providerData[0].providerId) || 'password',
  };
}

// Finish an email-link sign-in if this page load came from one.
async function completeEmailLinkIfAny() {
  if (!isSignInWithEmailLink(fbAuth, location.href)) return;
  let email = localStorage.getItem(EMAIL_KEY);
  if (!email) email = window.prompt('Please confirm your email address to finish signing in');
  if (!email) return;
  await signInWithEmailLink(fbAuth, email, location.href);
  localStorage.removeItem(EMAIL_KEY);
  history.replaceState(null, '', location.pathname);
}
const linkDone = completeEmailLinkIfAny().catch(e => { console.error(e); alert('Sign-in link failed: ' + e.message); });

let pendingMicrosoft = null;   // a Microsoft sign-in waiting to be linked to an existing account
async function linkPendingMicrosoft() {
  const cred = pendingMicrosoft; pendingMicrosoft = null;
  if (!cred || !fbAuth.currentUser) return;
  try { await linkWithCredential(fbAuth.currentUser, cred); } catch (e) { console.warn('Couldn’t link Microsoft sign-in:', e && e.code); }
}
export const auth = {
  onChange(fn) { return onAuthStateChanged(fbAuth, async (u) => { await linkDone; await loadProfile(u); fn(toUser(u)); }); },
  current: () => toUser(fbAuth.currentUser),
  // Email + password is the default email option: Firebase's free plan allows only
  // 5 sign-in-link emails per day for the whole site, but 1,000 verification emails.
  providers: { google: true, microsoft: ENABLE_MS_SIGNIN, password: true, emailLink: ENABLE_EMAIL_LINK, demo: false },
  async signInGoogle() { await signInWithPopup(fbAuth, new GoogleAuthProvider()); await linkPendingMicrosoft(); },
  async signInPassword(email, password) { await signInWithEmailAndPassword(fbAuth, normEmail(email), password); await linkPendingMicrosoft(); },
  /** Creates the account, sets the display name and sends the verification email. Returns the updated user. */
  async signUpPassword(name, email, password) {
    const cred = await createUserWithEmailAndPassword(fbAuth, normEmail(email), password);
    if (name) await updateProfile(cred.user, { displayName: name });
    try { await sendEmailVerification(cred.user, { url: location.origin + location.pathname }); } catch (e) { console.warn('Verification email not sent:', e); }
    return toUser(fbAuth.currentUser);
  },
  async resetPassword(email) { await sendPasswordResetEmail(fbAuth, normEmail(email), { url: location.origin + location.pathname }); },
  // Basic sign-in only (name and email): no file access, so students can approve it without IT.
  // If the email already has a Trawpie account (password or Google), we keep the Microsoft sign-in
  // and link it the moment they sign in the usual way once; after that both work.
  async signInMicrosoft() {
    const p = new OAuthProvider('microsoft.com');
    p.setCustomParameters({ prompt: 'select_account' });
    try { await signInWithPopup(fbAuth, p); pendingMicrosoft = null; }
    catch (e) {
      if (e && e.code === 'auth/account-exists-with-different-credential') {
        pendingMicrosoft = OAuthProvider.credentialFromError(e);
        const email = (e.customData && e.customData.email) || '';
        const err = new Error('You already have a Trawpie account' + (email ? ' with ' + email : '') + '. Sign in the way you did before (password or Google) just this once, and Microsoft will be linked to it. Next time, Continue with Microsoft works on its own.');
        err.code = 'tt/link-microsoft'; err.email = email; throw err;
      }
      throw e;
    }
  },
  async sendEmailLink(email) {
    email = normEmail(email);
    await sendSignInLinkToEmail(fbAuth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
    localStorage.setItem(EMAIL_KEY, email);
  },
  /** Sends a passwordless sign-in link to an invited teammate. Uses the same small daily
   *  email quota as sign-in links, so it is only offered when ENABLE_EMAIL_LINK is on. */
  sendInviteEmail: ENABLE_EMAIL_LINK ? async (email) => {
    await sendSignInLinkToEmail(fbAuth, normEmail(email), { url: location.origin + location.pathname, handleCodeInApp: true });
  } : undefined,
  /** Sign out and forget this account's copy of team data on this device (a shared lab computer keeps
   *  nothing readable), then start afresh. */
  async signOut() {
    await signOut(fbAuth);
    try { await terminate(db); await clearIndexedDbPersistence(db); } catch (e) { console.warn('Couldn’t clear the offline copy', e); }
    setTimeout(() => { location.hash = ''; location.reload(); }, 0);
  },
  /** Save (or with '' remove) your account photo, and copy it to your membership in every team. */
  async setPhoto(photo) {
    const u = fbAuth.currentUser; if (!u) throw new Error('Not signed in.');
    await setDoc(doc(db, 'users', u.uid), { photo, updatedAt: Date.now() }, { merge: true });
    profileUid = u.uid; profilePhoto = photo;
    const mine = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', u.uid)));
    for (let i = 0; i < mine.docs.length; i += 400) {
      const b = writeBatch(db);
      mine.docs.slice(i, i + 400).forEach(d => b.update(d.ref, { photo: photo || u.photoURL || '' }));
      await b.commit();
    }
    return toUser(u);
  },
  /** Save your theme pack to your profile so it follows you to other devices. */
  async setTheme(theme) {
    const u = fbAuth.currentUser; if (!u) throw new Error('Not signed in.');
    await setDoc(doc(db, 'users', u.uid), { theme: String(theme).slice(0, 40), updatedAt: Date.now() }, { merge: true });
    profileUid = u.uid; profileTheme = theme;
    return toUser(u);
  },
  /** Save the right-click menu style ('list' or 'circle') to your profile. */
  async setMenuStyle(style) {
    const u = fbAuth.currentUser; if (!u) throw new Error('Not signed in.');
    await setDoc(doc(db, 'users', u.uid), { menuStyle: style === 'circle' ? 'circle' : 'list', updatedAt: Date.now() }, { merge: true });
    profileUid = u.uid; profileMenu = style;
    return toUser(u);
  },
  /** Where the team's tools sit: 'top' bar or 'side' bar (follows you to every device). */
  async setNav(nav) {
    const u = fbAuth.currentUser; if (!u) throw new Error('Not signed in.');
    await setDoc(doc(db, 'users', u.uid), { nav: nav === 'side' ? 'side' : 'top', updatedAt: Date.now() }, { merge: true });
    profileUid = u.uid; profileNav = nav;
    return toUser(u);
  },
  /** Email notification choices: { mentions, digest } (true unless switched off). */
  async setNotify(notify) {
    const u = fbAuth.currentUser; if (!u) throw new Error('Not signed in.');
    const n = { mentions: notify.mentions !== false, digest: notify.digest !== false };
    await setDoc(doc(db, 'users', u.uid), { notify: n, updatedAt: Date.now() }, { merge: true });
    profileUid = u.uid; profileNotify = n;
    return toUser(u);
  },
  async updateName(name) { if (fbAuth.currentUser) await updateProfile(fbAuth.currentUser, { displayName: name }); },
  async sendVerification() { if (fbAuth.currentUser) await sendEmailVerification(fbAuth.currentUser, { url: location.origin + location.pathname }); },
  async reloadUser() { if (fbAuth.currentUser) { await fbAuth.currentUser.reload(); await fbAuth.currentUser.getIdToken(true); return toUser(fbAuth.currentUser); } return null; },
};

// ── Data ────────────────────────────────────────────────────────────────────
const teamRef = (t) => doc(db, 'teams', t);
// 'team', a path inside the team ('tasks/x'), or a top-level document ('/eduClaims/uid').
const refFor = (t, path) => (path === 'team' ? teamRef(t) : path.startsWith('/') ? doc(db, ...path.slice(1).split('/')) : doc(db, 'teams', t, ...path.split('/')));
const rows = (snap) => snap.docs.map(d => ({ ...d.data(), id: d.id }));

// Saving a list of changes (in batches) lives in batch.js, so it can be tested against the emulator.
const runOps = (teamId, ops) => runOpsWith({ writeBatch: () => writeBatch(db), getDoc, ref: (path) => refFor(teamId, path) }, withArchiveRev(teamId, ops));

// Teams open on this device: their weeks and known tasks, so a save to an old week can say so.
const openTeams = new Map();
/** A save that touches a task in an old week also changes the team's archiveRev (see tasksync.js). */
function withArchiveRev(teamId, ops) {
  const t = openTeams.get(teamId); if (!t || !t.weeks) return ops;
  const weekIds = [];
  ops.forEach(op => { const m = /^tasks\/(.+)$/.exec(op.path); if (!m) return; weekIds.push(op.data && op.data.weekId, (t.tasks.known.get(m[1]) || {}).weekId); });
  if (!touchesArchive(t.weeks, weekIds)) return ops;
  const rev = Date.now(); const teamOp = ops.find(o => o.path === 'team' && o.type === 'update');
  return teamOp ? ops.map(o => (o === teamOp ? { ...o, data: { ...o.data, archiveRev: rev } } : o)) : [{ type: 'update', path: 'team', data: { archiveRev: rev } }, ...ops];
}
/** This device's note of which old weeks it has a complete copy of (per team and person). */
const archiveStore = (teamId) => {
  const key = 'tt_archive_' + teamId + '_' + ((fbAuth.currentUser && fbAuth.currentUser.uid) || '');
  return { get: () => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }, set: (v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* full */ } } };
};

export const data = {
  watchMyTeams(uid, cb, onError) {
    const teamUnsubs = new Map(); const teams = new Map(); let roles = new Map();
    const emit = () => cb([...roles.keys()].filter(id => teams.has(id)).map(id => ({ id, ...teams.get(id), roleId: roles.get(id) })));
    const unsub = onSnapshot(query(collectionGroup(db, 'members'), where('uid', '==', uid)), (snap) => {
      roles = new Map(snap.docs.map(d => [d.ref.parent.parent.id, d.data().roleId]));
      // subscribe to newly joined teams, drop teams we left
      roles.forEach((_, id) => {
        if (teamUnsubs.has(id)) return;
        teamUnsubs.set(id, onSnapshot(teamRef(id), (s) => { if (s.exists()) teams.set(id, { name: s.data().name, logo: s.data().logo }); else teams.delete(id); emit(); },
          () => { teams.delete(id); emit(); }));
      });
      [...teamUnsubs.keys()].filter(id => !roles.has(id)).forEach(id => { teamUnsubs.get(id)(); teamUnsubs.delete(id); teams.delete(id); });
      emit();
    }, onError);
    return () => { unsub(); teamUnsubs.forEach(u => u()); };
  },
  watchMyInvites(email, cb, onError) {
    return onSnapshot(query(collectionGroup(db, 'invites'), where('email', '==', normEmail(email))),
      (snap) => cb(snap.docs.map(d => ({ ...d.data(), teamId: d.ref.parent.parent.id }))), onError);
  },
  watchTeam(teamId, h) {
    const err = (e) => h.onError && h.onError(e);
    // Tasks: recent weeks live, old weeks from this device's copy (backend/tasksync.js).
    const tasksCol = collection(db, 'teams', teamId, 'tasks');
    const tasks = watchTasks({ tasksQuery: (weekIds) => (weekIds ? query(tasksCol, where('weekId', 'in', weekIds)) : tasksCol), onSnapshot, getDocs, getDocsFromCache },
      archiveStore(teamId), (ts) => h.onTasks(ts), err);
    const open = { weeks: null, tasks }; openTeams.set(teamId, open);
    const unsubs = [
      onSnapshot(teamRef(teamId), (s) => {
        if (!s.exists()) { err(Object.assign(new Error('This team no longer exists.'), { code: 'not-found' })); return; }
        const t = { ...s.data(), id: s.id }; open.weeks = t.weeks || []; tasks.setTeam(t); h.onTeam(t);
      }, err),
      onSnapshot(collection(db, 'teams', teamId, 'members'), (s) => h.onMembers(s.docs.map(d => ({ ...d.data(), uid: d.id }))), err),
      onSnapshot(collection(db, 'teams', teamId, 'categories'), (s) => h.onCategories(rows(s)), err),
    ];
    return () => { unsubs.forEach(u => u()); tasks.stop(); if (openTeams.get(teamId) === open) openTeams.delete(teamId); };
  },
  /** Live cursors: my pointer position on the board (one small document per person). */
  setCursor(teamId, uid, data) { return setDoc(doc(db, 'teams', teamId, 'cursors', uid), data); },
  watchCursors(teamId, cb, onError) {
    return onSnapshot(collection(db, 'teams', teamId, 'cursors'), (s) => cb(s.docs.map(d => ({ ...d.data(), id: d.id }))), onError);
  },
  watchInvites(teamId, cb, onError) {
    return onSnapshot(collection(db, 'teams', teamId, 'invites'), (s) => cb(s.docs.map(d => d.data())), onError);
  },
  /** Every document in one of the team's collections (templates, …). */
  watchCollection(teamId, coll, cb, onError) {
    return onSnapshot(collection(db, 'teams', teamId, coll), (s) => cb(rows(s)), onError);
  },
  /** The team's comments, newest first (at most 500). */
  watchComments(teamId, cb, onError) {
    return onSnapshot(query(collection(db, 'teams', teamId, 'comments'), orderBy('createdAt', 'desc'), limit(500)), (s) => cb(rows(s)), onError);
  },
  /** Comments that @mention me, in each of the given teams: { teamId: [comment] }. One small query per team. */
  watchMyMentions(teamIds, uid, cb, onError) {
    const out = {}; const emit = () => cb({ ...out });
    const unsubs = teamIds.map(id => onSnapshot(query(collection(db, 'teams', id, 'comments'), where('mentions', 'array-contains', uid)),
      (s) => { out[id] = rows(s); emit(); }, (e) => { delete out[id]; emit(); if (onError) onError(e); }));
    return () => unsubs.forEach(u => u());
  },
  /** Tasks I own or support, across the given teams, with each team's weeks and phases. */
  async myWork(teamIds, uid) {
    return Promise.all(teamIds.map(async (id) => {
      const tasksCol = collection(db, 'teams', id, 'tasks');
      const [teamSnap, ...snaps] = await Promise.all([getDoc(teamRef(id)),
        ...['ownerUid', 'supportPersonId', 'supportPersonId2'].map(f => getDocs(query(tasksCol, where(f, '==', uid))))]);
      const byId = new Map(); snaps.forEach(s => rows(s).forEach(t => byId.set(t.id, t)));
      return { teamId: id, team: teamSnap.exists() ? teamSnap.data() : { name: '' }, tasks: [...byId.values()] };
    }));
  },
  /** One-off copy of a team's people, tasks and working profiles (for workload across teams). */
  async teamSnapshot(teamId) {
    const [t, m, tk, p] = await Promise.all([getDoc(teamRef(teamId)), getDocs(collection(db, 'teams', teamId, 'members')), getDocs(collection(db, 'teams', teamId, 'tasks')), getDocs(collection(db, 'teams', teamId, 'profiles'))]);
    return { teamId, team: t.exists() ? t.data() : { name: '' }, members: m.docs.map(d => ({ ...d.data(), uid: d.id })), tasks: rows(tk), profiles: p.docs.map(d => ({ ...d.data(), uid: d.id })) };
  },
  commit: runOps,
  /** My SelfTrack items (selfItems where uid == me), live. */
  watchSelf(uid, cb, onError) {
    return onSnapshot(query(collection(db, 'selfItems'), where('uid', '==', uid)), (s) => cb(rows(s)), onError);
  },
  /** Call one of the Cloud Functions in functions/ (loaded only when needed). */
  async callFunction(name, payload) {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    return (await httpsCallable(getFunctions(app, 'europe-west2'), name)(payload)).data;
  },
  /** Store a browser error report (deleted automatically after 30 days). */
  async reportError(d) {
    const { addDoc, Timestamp } = await import('firebase/firestore');
    await addDoc(collection(db, 'clientErrors'), { ...d, expireAt: Timestamp.fromMillis(Date.now() + 30 * 864e5) });
  },
  /** Feedback from the in-app button (emailed to the platform admins by the emailFeedback function; kept a year). */
  async sendFeedback(d) {
    const { addDoc, Timestamp } = await import('firebase/firestore');
    await addDoc(collection(db, 'feedback'), { ...d, expireAt: Timestamp.fromMillis(Date.now() + 365 * 864e5) });
  },
  /** Pilot numbers per team (counts only; written daily by the dailyTeamStats function). */
  watchTeamStats(cb, onError) {
    return onSnapshot(collection(db, 'teamStats'), (s) => cb(s.docs.map(d => ({ ...d.data(), id: d.id }))), onError);
  },
  watchFeedback(cb, onError) {
    return onSnapshot(query(collection(db, 'feedback'), orderBy('at', 'desc'), limit(100)), (s) => cb(s.docs.map(d => ({ ...d.data(), id: d.id }))), onError);
  },
  watchClientErrors(cb, onError) {
    return onSnapshot(query(collection(db, 'clientErrors'), orderBy('at', 'desc'), limit(200)), (s) => cb(s.docs.map(d => ({ ...d.data(), id: d.id }))), onError);
  },
  /** Top-level documents about me: verifiedStudents/{uid}, eduClaims/{uid}. */
  async myDoc(coll, uid) { try { const d = await getDoc(doc(db, coll, uid)); return d.exists() ? d.data() : null; } catch { return null; } },
  /** Teams on Pro Education (platform admins only). */
  watchEduTeams(cb, onError) {
    return onSnapshot(query(collection(db, 'teams'), where('plan.edu', '==', true)), (s) => cb(s.docs.map(d => ({ id: d.id, name: d.data().name, plan: d.data().plan }))), onError);
  },
  /** A platform admin has a document at admins/{uid} (made by hand in the Firebase console). */
  async isPlatformAdmin(uid) { try { return (await getDoc(doc(db, 'admins', uid))).exists(); } catch { return false; } },
  /** Every team's request for Pro (platform admins only). */
  watchPlanRequests(cb, onError) {
    return onSnapshot(collectionGroup(db, 'requests'), (s) => cb(s.docs.map(d => ({ ...d.data(), id: d.id, path: d.ref.path }))), onError);
  },
  async createTeam(teamDoc, ownerMember) {
    const id = newId('t');
    const b = writeBatch(db);
    b.set(teamRef(id), teamDoc);
    b.set(doc(db, 'teams', id, 'members', ownerMember.uid), ownerMember);
    await b.commit();
    return id;
  },
  async acceptInvite(teamId, member, email) {
    const b = writeBatch(db);
    b.set(doc(db, 'teams', teamId, 'members', member.uid), member);
    b.delete(doc(db, 'teams', teamId, 'invites', normEmail(email)));
    await b.commit();
  },
  async declineInvite(teamId, email) {
    const b = writeBatch(db); b.delete(doc(db, 'teams', teamId, 'invites', normEmail(email))); await b.commit();
  },
  async deleteTeam(teamId) {
    const ops = [];
    for (const c of ['templates', 'comments', 'meetings', 'whiteboards', 'wbItems', 'notebook', 'parts', 'papers', 'expenses', 'finance', 'financeLog', 'requests', 'profiles', 'presence', 'cursors', 'risks', 'requirements', 'dissertation', 'removed', 'tasks', 'categories', 'invites']) {
      (await getDocs(collection(db, 'teams', teamId, c))).docs.forEach(d => ops.push({ type: 'delete', path: c + '/' + d.id }));
    }
    const members = (await getDocs(collection(db, 'teams', teamId, 'members'))).docs;
    members.filter(d => d.data().roleId !== 'owner').forEach(d => ops.push({ type: 'delete', path: 'members/' + d.id }));
    ops.push({ type: 'delete', path: 'private/github' });   // the GitHub webhook secret (the owner may delete it, never read it)
    await runOps(teamId, ops);
    // Final batch: the owner's membership + the team itself (the rules allow this pair together).
    const b = writeBatch(db);
    members.filter(d => d.data().roleId === 'owner').forEach(d => b.delete(d.ref));
    b.delete(teamRef(teamId));
    await b.commit();
  },
  async teamExists(teamId) { return (await getDoc(teamRef(teamId))).exists(); },
};
