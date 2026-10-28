// ─────────────────────────────────────────────────────────────────────────────
//  DEMO backend — everything lives in this browser (localStorage). Each browser
//  tab can be signed in as a different demo account, so you can try invites and
//  roles by opening two tabs. Permissions are enforced by rules-sim.js, a copy
//  of the production security rules.
// ─────────────────────────────────────────────────────────────────────────────
import { checkWrite, checkRead, applyOps, checkProfileWrite } from '../rules-sim.js';
import { newId, isAcademicEmail, scrubPerson } from '../model.js';
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
  async setNav(nav) {
    if (!currentUser) throw new Error('Not signed in.');
    checkProfileWrite(authCtx(), currentUser.uid, { photo: currentUser.photo || '', nav, updatedAt: Date.now() });
    currentUser = { ...currentUser, nav }; store.users[currentUser.uid] = { ...currentUser }; persist();
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
  /** Live cursors: nobody else is in the demo, so nothing is stored. */
  async setCursor() {},
  watchCursors(teamId, cb) { setTimeout(() => cb([]), 0); return () => {}; },
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
  /** My SelfTrack items (selfItems where uid == me). */
  watchSelf(uid, cb, onError) {
    return subscribe(() => {
      const me = authCtx(); if (!me || me.uid !== uid) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      return Object.entries((store.root && store.root.selfItems) || {}).filter(([, d]) => d.uid === uid).map(([id, d]) => ({ ...d, id }));
    }, cb, onError);
  },
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
    // ── Your data (the server's privacy.js, on the demo store) ──
    const BY = ['createdBy', 'authorUid', 'ownerUid', 'by', 'invitedBy', 'uid', 'supportPersonId', 'supportPersonId2'];
    const myTeams = () => Object.entries(store.teams).filter(([, T]) => T.members && T.members[me.uid]);
    const owned = () => myTeams().filter(([, T]) => T.members[me.uid].roleId === 'owner' && Object.keys(T.members).length > 1).map(([id, T]) => ({ teamId: id, name: T.doc.name, members: Object.keys(T.members).length }));
    if (name === 'myOwnedTeams') return { teams: owned() };
    if (name === 'appCheckAdmin') {   // demo: nothing to measure, so the counts are zero
      if (!(store.admins && store.admins[me.uid])) fail('permission-denied', 'Platform admins only.');
      if (payload && typeof payload.enforce === 'boolean') { root.appCheckCallables = payload.enforce; persist(); }
      return { enforced: root.appCheckCallables === true, days: Array.from({ length: 7 }, (_, i) => ({ day: new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), verified: 0, unverified: 0 })) };
    }
    if (name === 'refreshTeamStats') { if (!(store.admins && store.admins[me.uid])) fail('permission-denied', 'Only platform admins can do this.'); notify(); return { teams: Object.keys(store.teams).length, removed: 0 }; }
    if (name === 'exportMyData') {
      const email = normEmail(me.email); const list = (o) => Object.entries(o || {}).map(([id, d]) => ({ id, ...clone(d) }));
      return { about: 'Everything Trawpie stores about you (demo).', account: { uid: me.uid, email: me.email, displayName: me.name, providers: ['demo'] }, profile: clone(store.users[me.uid]),
        studentVerification: clone(root.verifiedStudents[me.uid] || null), selfTrack: Object.entries(root.selfItems || {}).filter(([, d]) => d.uid === me.uid).map(([id, d]) => ({ id, ...clone(d) })), feedbackYouSent: list(root.feedback).filter(f => f.uid === me.uid), errorReportsFromYourBrowser: list(root.clientErrors).filter(f => f.uid === me.uid),
        invitationsToYou: Object.entries(store.teams).filter(([, T]) => T.invites && T.invites[email]).map(([id, T]) => ({ teamId: id, ...clone(T.invites[email]) })),
        teams: myTeams().map(([id, T]) => { const yours = {}; Object.entries(T).forEach(([c, docs]) => { if (['doc', 'members', 'profiles', 'private'].includes(c) || !docs || typeof docs !== 'object') return; const mine = list(docs).filter(r => BY.some(f => r[f] === me.uid) || (r.attendees || []).includes(me.uid) || (r.mentions || []).includes(me.uid)); if (mine.length) yours[c] = mine; });
          return { teamId: id, teamName: T.doc.name, yourMembership: clone(T.members[me.uid]), yourProfileInTeam: clone((T.profiles || {})[me.uid] || null), yours }; }) };
    }
    // ── GitHub sync (the server's github.js, on the demo store) ──
    if (name === 'githubConnect' || name === 'githubSimulate' || name === 'githubIssue') {
      const teamId = payload && payload.teamId; const T = store.teams[teamId];
      if (!T || !T.members[me.uid]) fail('permission-denied', 'You’re not in this team.');
      const role = T.members[me.uid].roleId; const ok = role === 'owner' || !!(T.doc.roles && T.doc.roles[role] && T.doc.roles[role].perms && T.doc.roles[role].perms['team.settings']);
      const gh = await import('../../functions/ghsync.js');
      if (name === 'githubConnect') {
        if (!ok) fail('permission-denied', 'Only people who manage team settings can connect GitHub.');
        if (payload.disconnect) { T.doc.github = null; if (T.private) delete T.private.github; persist(); return { ok: true }; }
        if ('token' in payload) {
          if (!T.private || !T.private.github) fail('failed-precondition', 'Connect a repository first.');
          const t = String(payload.token || '').trim();
          if (t && /^ghp_/.test(t)) fail('invalid-argument', 'Classic GitHub tokens (ghp_…) reach every repository you can, so Trawpie no longer uses them. Make a fine-grained token for just this repository (Settings ▸ Integrations ▸ GitHub shows how).');
          if (t && !/^github_pat_[A-Za-z0-9_]{20,255}$/.test(t)) fail('invalid-argument', 'That doesn’t look like a fine-grained GitHub token (they start with github_pat_).');
          T.private.github.token = t || null; T.doc.github = { ...gh.cleanGithub(T.doc.github), write: !!t }; persist();
          return { write: !!t };
        }
        const repo = gh.cleanRepo(payload.repo); if (!repo) fail('invalid-argument', 'Give the repository as owner/name, e.g. uni-robotics/rover.');
        const old = gh.cleanGithub(T.doc.github); const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
        T.private = { ...(T.private || {}), github: { secret, repo, by: me.uid, at: Date.now(), last: null } };
        T.doc.github = { repo, issues: old.repo ? old.issues : true, done: old.repo ? old.done : true, owner: old.owner || me.uid, connectedAt: Date.now(), write: false, last: null };
        persist();
        return { repo, secret, url: 'https://europe-west2-uni-teamtrack.cloudfunctions.net/githubWebhook?team=' + encodeURIComponent(teamId) + ' (demo: nothing is sent)' };
      }
      if (name === 'githubIssue') {   // the server's issueAction, on the demo store (nothing reaches GitHub)
        const g = gh.cleanGithub(T.doc.github); const P = T.private && T.private.github;
        if (!g.repo || !P || !P.token) fail('failed-precondition', 'Trawpie can’t change GitHub issues for this team yet (Settings ▸ Integrations ▸ GitHub ▸ token).');
        const t = T.tasks[payload.taskId]; if (!t) fail('not-found', 'That task doesn’t exist any more.');
        const perms = ((T.doc.roles || {})[role] || {}).perms || {};
        if (!(role === 'owner' || perms['tasks.editAll'] || (perms['tasks.editOwn'] && t.ownerUid === me.uid))) fail('permission-denied', 'You can only do this on tasks you can edit.');
        const d = new Date(); let hh = d.getHours(); const ap = hh >= 12 ? 'PM' : 'AM'; hh = hh % 12 || 12;
        const time = String(d.getDate()).padStart(2, '0') + '/' + d.toLocaleString('en-GB', { month: 'short' }) + '/' + String(d.getFullYear()).slice(-2) + ' ' + hh + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap;
        const who = (T.members[me.uid] && T.members[me.uid].name) || me.name || 'Someone';
        const hist = (u, was) => { t.history = [{ time, user: who, field: 'GitHub', original: was || '', updated: u }, ...(t.history || [])].slice(0, 100); };
        if (payload.action === 'create') {
          P.n = (P.n || 100) + 1; const url = 'https://github.com/' + g.repo + '/issues/' + P.n;
          t.attachments = [...(t.attachments || []), { id: 'gh_issues_' + P.n, provider: 'github', name: 'Issue #' + P.n + ': ' + String(payload.title || t.name).slice(0, 160), url, size: 0, addedBy: who, addedAt: Date.now(), state: 'open', reason: '' }];
          hist('Created issue #' + P.n + ' and linked it'); t.updatedAt = Date.now(); persist();
          return { number: P.n, url, state: 'open' };
        }
        const n = Math.round(Number(payload.number));
        if (payload.action === 'refresh') {   // demo: GitHub isn't reachable, so a hand-linked one is shown as open
          const k = payload.kind === 'pull' ? 'pull' : 'issues'; const at = (t.attachments || []).find(a => a.url.endsWith('/' + g.repo + '/' + k + '/' + n));
          if (!at) fail('permission-denied', 'That isn’t linked to this task.');
          if (!at.state) { at.state = 'open'; at.reason = ''; t.updatedAt = Date.now(); persist(); }
          return { number: n, state: at.state, reason: at.reason || '' };
        }
        if (!(t.attachments || []).some(a => a.url.endsWith('/' + g.repo + '/issues/' + n))) fail('permission-denied', 'That issue isn’t linked to this task.');
        const setState = (state, reason) => { t.attachments = t.attachments.map(a => (a.url.endsWith('/' + g.repo + '/issues/' + n) ? { ...a, state, reason } : a)); };
        if (payload.action === 'reopen') { setState('open', ''); hist('Reopened issue #' + n, 'closed'); t.updatedAt = Date.now(); persist(); return { number: n, state: 'open' }; }
        const reason = ['completed', 'not_planned', 'duplicate'].includes(payload.reason) ? payload.reason : 'completed';
        if (reason === 'duplicate' && !(Number(payload.duplicateOf) > 0)) fail('invalid-argument', 'Duplicate of which issue number?');
        setState('closed', reason === 'completed' ? '' : reason);
        hist('Closed issue #' + n + ' as ' + ({ completed: 'completed', not_planned: 'not planned', duplicate: 'a duplicate of #' + payload.duplicateOf })[reason], 'open');
        let finished = false;
        if (payload.finish && reason === 'completed' && t.flag !== 'completed' && !gh.gateBlocks(t, (T.doc.workflow && T.doc.workflow.stages) || [])) {
          t.history = [{ time, user: who, field: 'Task Status Flag', original: t.flag || 'none', updated: 'completed (GitHub issue #' + n + ' closed)' }, ...t.history].slice(0, 100);
          t.flag = 'completed'; t.completedDate = new Date().toLocaleDateString('en-CA'); finished = true;
        }
        t.updatedAt = Date.now(); persist();
        return { number: n, state: 'closed', reason, finished };
      }
      // Demo only: pretend GitHub sent an event, and apply it as the webhook would.
      if (!T.private || !T.private.github) fail('failed-precondition', 'Connect a repository first.');
      const weekIdx = new Map((T.doc.weeks || []).map((w, i) => [w.key, i]));
      let tasks = Object.entries(T.tasks).map(([id, t]) => ({ ...clone(t), id, weekIdx: weekIdx.has(t.weekId) ? weekIdx.get(t.weekId) : -1 }));
      const moved = gh.repoRenamed(T.doc.github, payload.payload, tasks);   // the repository was renamed on GitHub: follow it
      if (moved) {
        moved.ops.forEach(o => { const id = o.path.slice(6); if (T.tasks[id]) T.tasks[id].attachments = o.data.attachments; });
        T.doc.github = { ...T.doc.github, repo: moved.repo }; T.private.github.repo = moved.repo;
        tasks = Object.entries(T.tasks).map(([id, t]) => ({ ...clone(t), id, weekIdx: weekIdx.has(t.weekId) ? weekIdx.get(t.weekId) : -1 }));
      }
      const plan = gh.planGithubEvent(payload.kind, payload.payload, tasks, T.doc.github);
      const now = Date.now(); const today = new Date().toLocaleDateString('en-CA');
      const newTask = plan.create ? gh.newTaskPlace(T.doc, Object.entries(T.categories).map(([id, c]) => ({ ...c, id })), today) : null;
      const d = new Date(); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
      const time = String(d.getDate()).padStart(2, '0') + '/' + d.toLocaleString('en-GB', { month: 'short' }) + '/' + String(d.getFullYear()).slice(-2) + ' ' + h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap;
      const { ops, notes } = gh.githubOps(plan, tasks, { now, today, time, stages: (T.doc.workflow && T.doc.workflow.stages) || [], newTask, newId: 't_gh' + Math.random().toString(16).slice(2, 14) });
      ops.forEach(o => { const id = o.path.split('/')[1]; if (o.type === 'set') T.tasks[id] = clone(o.data); else T.tasks[id] = { ...T.tasks[id], ...clone(o.data) }; });
      const summary = { at: now, kind: payload.kind, action: (payload.payload && payload.payload.action) || '', links: plan.links.length, finished: plan.finish.length, created: plan.create && newTask ? 1 : 0, why: [plan.why, ...notes].filter(Boolean).join(' ') };
      T.private.github.last = summary; T.doc.github = { ...gh.cleanGithub(T.doc.github), last: { at: now, kind: summary.kind, action: summary.action, links: summary.links, finished: summary.finished, created: summary.created, ok: plan.ok } }; persist();
      return summary;
    }
    if (name === 'transferOwnership') {
      const T = store.teams[payload && payload.teamId]; const to = payload && payload.toUid;
      if (!to || to === me.uid) fail('invalid-argument', 'Choose another member.');
      if (!T || !T.members[me.uid] || T.members[me.uid].roleId !== 'owner') fail('permission-denied', 'Only the team owner can hand the team over.');
      if (!T.members[to]) fail('not-found', 'That person isn’t a member of this team any more.');
      const mine = T.doc.roles && T.doc.roles.admin ? 'admin' : T.members[to].roleId;
      T.members[to].roleId = 'owner'; T.members[me.uid].roleId = mine; T.doc.ownerUid = to; persist();
      return { ok: true, yourRole: mine };
    }
    if (name === 'deleteMyAccount') {
      if (!payload || payload.confirm !== 'DELETE') fail('invalid-argument', 'Type DELETE to confirm.');
      const blocking = owned(); if (blocking.length) { const e = Object.assign(new Error('Hand over these teams first: ' + blocking.map(b => b.name).join(', ')), { code: 'functions/failed-precondition', details: { teams: blocking } }); throw e; }
      const email = normEmail(me.email); const names = new Set([me.name, ...myTeams().map(([, T]) => T.members[me.uid].name)].map(n => String(n || '').trim()).filter(n => n.length >= 2));
      const emails = new Set([email]); const summary = { teamsDeleted: 0, teamsLeft: 0, recordsAnonymised: 0 };
      myTeams().forEach(([id, T]) => {
        if (T.members[me.uid].roleId === 'owner') { delete store.teams[id]; summary.teamsDeleted++; return; }
        Object.entries(T).forEach(([c, docs]) => { if (['members', 'profiles'].includes(c) || !docs || typeof docs !== 'object') return; Object.values(docs).forEach(d => { if (!d || typeof d !== 'object') return; const r = scrubPerson(d, names, emails); if (r.changed) { Object.assign(d, r.value); summary.recordsAnonymised++; } }); });
        delete T.members[me.uid]; if (T.profiles) delete T.profiles[me.uid]; summary.teamsLeft++;
      });
      Object.values(store.teams).forEach(T => { if (T.invites) delete T.invites[email]; });
      ['verifiedStudents', 'studentCodes', 'eduClaims'].forEach(c => { if (root[c]) delete root[c][me.uid]; });
      ['feedback', 'clientErrors', 'selfItems'].forEach(c => Object.entries(root[c] || {}).forEach(([id, d]) => { if (d.uid === me.uid) delete root[c][id]; }));
      delete store.users[me.uid]; persist();
      currentUser = null; sessionStorage.removeItem(SESSION_KEY); setTimeout(emitAuth, 0);
      return { deleted: true, ...summary };
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
    const me = authCtx(); if (!me) throw Object.assign(new Error('Sign in first.'), { code: 'unauthenticated' });
    const op = { type: 'set', path: '/feedback/' + newId('fb'), data: { ...d, expireAt: Date.now() + 365 * 864e5 } };
    const post = applyOps(store, null, [op]); checkWrite(store, post, me, null, op);
    store = post; persist();
  },
  /** Pilot numbers per team, computed from the demo store the way functions/stats.js does. */
  watchTeamStats(cb, onError) {
    return subscribe(() => {
      const me = authCtx(); if (!me || !(store.admins && store.admins[me.uid])) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      const now = Date.now(), week = now - 7 * 864e5;
      return Object.entries(store.teams).map(([id, T]) => {
        const members = Object.values(T.members || {}); const names = new Set(members.map(m => m.name)); const nameOf = new Map(members.map(m => [m.uid, m.name]));
        const tasks = Object.values(T.tasks || {}); const changed = tasks.filter(t => (t.updatedAt || 0) >= week); const comments = Object.values(T.comments || {}).filter(c => (c.createdAt || 0) >= week);
        const active = new Set(); changed.forEach(t => { if (names.has(t.updatedBy)) active.add(t.updatedBy); if ((t.createdAt || 0) >= week && nameOf.get(t.createdBy)) active.add(nameOf.get(t.createdBy)); }); comments.forEach(c => { if (nameOf.get(c.authorUid)) active.add(nameOf.get(c.authorUid)); });
        const d = new Date(now).toISOString().slice(0, 10);
        return { id, name: T.doc.name, plan: (T.doc.plan && T.doc.plan.tier) || 'free', edu: !!(T.doc.plan && T.doc.plan.edu), createdAt: T.doc.createdAt || 0, members: members.length, invitesPending: Object.keys(T.invites || {}).length,
          tasks: tasks.length, weeks: (T.doc.weeks || []).length, active7: active.size, tasksChanged7: changed.length, tasksCreated7: changed.filter(t => (t.createdAt || 0) >= week).length, comments7: comments.length,
          feedback7: Object.values((store.root && store.root.feedback) || {}).filter(f => f.teamId === id && f.at >= week).length, lastActivity: Math.max(0, ...tasks.map(t => t.updatedAt || 0)),
          features: Object.entries(T.doc.features || {}).filter(([, on]) => on).map(([k]) => k).sort(), at: now, history: [{ d, active7: active.size, changed7: changed.length, members: members.length }] };
      });
    }, cb, onError);
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
  /** The sample team I already have in this browser, if any. */
  findSample(uid, kind = 'drone') { return Object.keys(store.teams).find(id => id.startsWith('t_sample_') && store.teams[id].members && store.teams[id].members[uid] && (kind === 'drone' ? !/^t_sample_(corporate|satellite|formula|diss)_/.test(id) : id.startsWith('t_sample_' + kind + '_'))) || null; },
  /** Demo only: put a prepared sample team (src/sample.js) into this browser, its owner = me. */
  async loadSample({ teamId, team, users }) {
    const me = authCtx(); if (!me) throw Object.assign(new Error('Sign in first.'), { code: 'unauthenticated' });
    store.teams[teamId] = clone(team);
    Object.entries(users || {}).forEach(([uid, u]) => { if (!store.users[uid]) store.users[uid] = clone(u); });
    persist(); return teamId;
  },
  async acceptInvite(teamId, member, email) {
    applyBatch(teamId, [{ type: 'set', path: 'members/' + member.uid, data: member }, { type: 'delete', path: 'invites/' + normEmail(email) }]);
  },
  async declineInvite(teamId, email) { applyBatch(teamId, [{ type: 'delete', path: 'invites/' + normEmail(email) }]); },
  async deleteTeam(teamId) {
    const T = store.teams[teamId]; if (!T) return;
    // Same order as production: sub-documents, then the owner's membership, then the team doc.
    const ops = [];
    ['templates', 'comments', 'meetings', 'whiteboards', 'wbItems', 'notebook', 'parts', 'papers', 'expenses', 'finance', 'financeLog', 'requests', 'profiles', 'presence', 'risks', 'requirements', 'dissertation', 'tasks', 'categories', 'invites'].forEach(c => Object.keys(T[c] || {}).forEach(id => ops.push({ type: 'delete', path: c + '/' + id })));
    Object.keys(T.members).filter(u => T.members[u].roleId !== 'owner').forEach(u => ops.push({ type: 'delete', path: 'members/' + u }));
    Object.keys(T.members).filter(u => T.members[u].roleId === 'owner').forEach(u => ops.push({ type: 'delete', path: 'members/' + u }));
    ops.push({ type: 'delete', path: 'team' });
    applyBatch(teamId, ops);
  },
  /** Demo-only helper: wipe all demo data. */
  resetDemo() { store = { users: {}, teams: {} }; persist(); auth.signOut(); },
};
