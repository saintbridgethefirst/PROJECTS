/* global __BUILD_ID__ */
// ─────────────────────────────────────────────────────────────────────────────
//  App entry: sign-in → team list → team board. Also defines window.TT, the
//  bridge the board script (public/board/board.js) uses to save changes, check
//  permissions and open app dialogs.
// ─────────────────────────────────────────────────────────────────────────────
import './board.css';
import './app.css';
import './themes.css';
import { THEMES, SWATCH, applyTheme, currentTheme, savedTheme, themeName, isTheme } from './themes.js';
import { APP_NAME, APP_TAGLINE, DEMO_MODE, GOOGLE_CLIENT_ID, MS_CLIENT_ID, LIMITS } from './config.js';
import { can, canEditOwnedBy, DEFAULT_ROLES, normEmail, isValidEmail } from './permissions.js';
import { cleanTeam, cleanMember, cleanCategory, cleanTask, DEFAULT_LABELS, newId, nextWeekTitle, cascadeWeekDates, carryIndexOf } from './model.js';
import { buildModel, flatten, diff, deniedChanges, changesToOps, restoreOps, mergeChanges, invert } from './sync.js';
import { loadBackend } from './backend/index.js';
import { $, el, avatar, teamLogo, toast, modal, friendlyError, pickFile, imageFileToDataUrl } from './ui.js';
import { carryRoots, cleanFeatures, NEW_TEAM_FEATURES, cleanProfile, cleanRisk, cleanRequirement, capacityFor, planOf, hasPro, cleanPlan, PLANS, isAcademicEmail, EDU_DAYS, EDU_TEAMS_PER_YEAR, cleanEduClaim } from './model.js';
import { cleanComment, cleanTemplate, cleanEffort, cleanCapacity, stageOf, MAX_DEPS, cleanMeeting, cleanNotebookEntry, cleanPart, cleanExpense, cleanBudget, cleanPaper, cleanLogEntry } from './model.js';
import { openResearch, refreshResearch, seesMoney } from './research.js';
import { notebookSection, notebookCount, linkedSection } from './notebook.js';
import { openReport } from './report.js';
import { toolTabs } from './research.js';
import { openCrossTeam } from './tools-extra.js';
let platformAdmin = false;   // can set any team's plan (admins/{uid} exists)
let studentStatus = null;    // a university email proved by code: { email, until } (verifiedStudents/{uid})
let eduClaim = cleanEduClaim(null);   // teams I switched Pro Education on for this year
let myTeamsCache = [];   // the team list from the home screen (for workload across teams)
import { DEFAULT_ROLES as BUILTIN_ROLES } from './permissions.js';
import * as collab from './collab.js';
import { parseGithub, githubStatus } from './github.js';
import { openSearch, boardSources } from './search.js';
import { startMonitor, report } from './monitor.js';
import { yourDataField } from './yourdata.js';
import * as saving from './saving.js';
import { openFeedback } from './feedback.js';

let backend = null;
/** Shared state for the feature modules (yourdata.js, feedback.js…). */
const app = { get backend() { return backend; }, get user() { return user; }, get session() { return session; }, saveError: (e) => saving.saveError(e) };
let user = null;
let homeUnsubs = [];
let session = null;          // the open team
let boardLoaded = null;      // Promise once board.js is loaded

// Theme pack: the choice saved in this browser, until your account's choice arrives.
applyTheme(savedTheme(), { save: false });
document.title = APP_NAME;
document.querySelectorAll('[data-app-name]').forEach(n => { n.textContent = APP_NAME; });
document.querySelectorAll('[data-app-tagline]').forEach(n => { n.textContent = APP_TAGLINE + '.'; });

function show(screen) {
  ['loading', 'auth-screen', 'home-screen', 'board-screen'].forEach(id => { document.getElementById(id).hidden = id !== screen; });
}

// ── Boot ────────────────────────────────────────────────────────────────────
(async function boot() {
  try { backend = await loadBackend(); }
  catch (e) { console.error(e); show('auth-screen'); $('#auth-note').textContent = 'Could not start: ' + e.message; return; }
  // Crashes are reported (signed-in users only, no personal data) for the platform admin to see.
  startMonitor((d) => (user && backend.data.reportError ? backend.data.reportError(d) : null), () => (user ? user.uid : ''));
  backend.auth.onChange(async (u) => {
    // Google Drive/Sheets/Calendar access is remembered per person on this device.
    if (GOOGLE_CLIENT_ID) import('./integrations/google.js').then(m => m.setGoogleUser(u ? { uid: u.uid, email: u.email } : null)).catch(() => {});
    user = u;
    platformAdmin = false; studentStatus = null; eduClaim = cleanEduClaim(null);
    if (!u) { closeTeam(); stopHome(); renderAuth(); return; }
    if (backend.data.isPlatformAdmin) backend.data.isPlatformAdmin(u.uid).then(v => { if (user === u) platformAdmin = !!v; }).catch(() => {});
    loadStudent(u);
    // Your account's theme follows you to every device.
    if (u.theme && isTheme(u.theme) && u.theme !== currentTheme()) applyTheme(u.theme);
    if (u.menuStyle === 'circle' || u.menuStyle === 'list') { try { localStorage.setItem('tt_menu_style', u.menuStyle); } catch { /* */ } }
    await route();
  });
  window.addEventListener('hashchange', () => { if (user) route(); });
})();

async function route() {
  const m = location.hash.match(/^#\/t\/([A-Za-z0-9_-]+)/);
  if (m) { if (!session || session.teamId !== m[1]) await openTeam(m[1]); }
  else { closeTeam(); renderHome(); if (location.hash === '#/account') setTimeout(() => window.TT && window.TT.openAccount && window.TT.openAccount(), 0); }
}
const goHome = () => { location.hash = '#/'; };
const goTeam = (id) => { location.hash = '#/t/' + id; };

// ── Sign-in screen ──────────────────────────────────────────────────────────
function renderAuth() {
  show('auth-screen');
  const box = $('#auth-actions'); box.replaceChildren();
  const note = $('#auth-note'); note.textContent = '';
  const P = backend.auth.providers;
  const wrap = (fn) => async () => { note.textContent = ''; try { await fn(); } catch (e) { console.error(e); note.textContent = friendlyError(e); } };

  if (P.google) box.append(el('button.btn.block', { type: 'button', onclick: wrap(() => backend.auth.signInGoogle()) }, googleIcon(), 'Continue with Google'));
  if (P.microsoft) box.append(el('button.btn.block', { type: 'button', onclick: wrap(() => backend.auth.signInMicrosoft()) }, msIcon(), 'Continue with Microsoft'));
  if (P.password) box.append(passwordForm(note));
  if (P.emailLink) {
    box.append(el('div.auth-or', {}, P.password ? 'or get a one-time link' : 'or use your email'));
    const inp = el('input.inp', { type: 'email', placeholder: 'you@university.ac.uk', autocomplete: 'email', 'aria-label': 'Email address' });
    const send = el('button.btn.primary', { type: 'submit' }, 'Email me a sign-in link');
    const form = el('form', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, inp, send);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isValidEmail(inp.value)) { note.textContent = 'Enter a valid email address.'; return; }
      send.disabled = true;
      try { await backend.auth.sendEmailLink(inp.value); note.textContent = 'Check your inbox for a sign-in link. You can close this tab.'; }
      catch (err) { note.textContent = friendlyError(err); } finally { send.disabled = false; }
    });
    box.append(form);
  }
  if (P.demo) {
    box.append(el('div.banner.info', {}, 'Demo mode: no server is connected, so everything is stored in this browser only. Sign in as any email to try it. Open a second tab to sign in as a teammate and test invites and roles.'));
    const users = backend.auth.demoUsers();
    if (users.length) {
      const list = el('div.demo-users');
      users.forEach(u => list.append(el('button.demo-user', { type: 'button', onclick: wrap(() => backend.auth.signInDemo(u.email, u.name)) }, avatar(u), el('span', {}, el('b', {}, u.name), el('br'), el('span.muted', {}, u.email)))));
      box.append(el('div.hint', {}, 'Continue as:'), list);
    }
    const name = el('input.inp', { placeholder: 'Your name', 'aria-label': 'Your name', maxlength: 80 });
    const email = el('input.inp', { type: 'email', placeholder: 'Email', 'aria-label': 'Email' });
    const form = el('form', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, name, email, el('button.btn.primary', { type: 'submit' }, 'Sign in to demo'));
    form.addEventListener('submit', (e) => { e.preventDefault(); if (!isValidEmail(email.value)) { note.textContent = 'Enter a valid email address.'; return; } wrap(() => backend.auth.signInDemo(email.value, name.value.trim()))(); });
    box.append(el('div.auth-or', {}, users.length ? 'or a new demo account' : 'demo account'), form);
  }
}
/** Email + password: "Sign in" and "Create account" in one form, plus "Forgot password?". */
function passwordForm(note) {
  let mode = 'signin';
  const tabs = el('div.tabs.auth-tabs', { role: 'tablist' });
  const tabIn = el('button', { type: 'button', role: 'tab' }, 'Sign in');
  const tabUp = el('button', { type: 'button', role: 'tab' }, 'Create account');
  tabs.append(tabIn, tabUp);
  const name = el('input.inp', { name: 'name', placeholder: 'Your name', autocomplete: 'name', 'aria-label': 'Your name', maxlength: 80 });
  const email = el('input.inp', { name: 'email', type: 'email', placeholder: 'you@university.ac.uk', autocomplete: 'email', 'aria-label': 'Email address' });
  const pw = el('input.inp', { name: 'password', type: 'password', placeholder: 'Password', 'aria-label': 'Password' });
  const submit = el('button.btn.primary', { type: 'submit' });
  const forgot = el('button.link-btn', { type: 'button' }, 'Forgot password?');
  const form = el('form.auth-form', { style: { display: 'flex', flexDirection: 'column', gap: '8px' }, novalidate: true }, name, email, pw, submit, forgot);
  const setMode = (m) => {
    mode = m; note.textContent = '';
    tabIn.classList.toggle('on', m === 'signin'); tabUp.classList.toggle('on', m === 'signup');
    tabIn.setAttribute('aria-selected', String(m === 'signin')); tabUp.setAttribute('aria-selected', String(m === 'signup'));
    name.hidden = m !== 'signup'; forgot.hidden = m !== 'signin';
    pw.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    pw.placeholder = m === 'signup' ? 'Password (at least 8 characters)' : 'Password';
    submit.textContent = m === 'signup' ? 'Create account' : 'Sign in';
  };
  tabIn.onclick = () => setMode('signin'); tabUp.onclick = () => setMode('signup');
  setMode('signin');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isValidEmail(email.value)) { note.textContent = 'Enter a valid email address.'; email.focus(); return; }
    if (mode === 'signup' && !name.value.trim()) { note.textContent = 'Enter your name so teammates recognise you.'; name.focus(); return; }
    if (mode === 'signup' && pw.value.length < 8) { note.textContent = 'Choose a password of at least 8 characters.'; pw.focus(); return; }
    if (!pw.value) { note.textContent = 'Enter your password.'; pw.focus(); return; }
    submit.disabled = true; note.textContent = '';
    try {
      if (mode === 'signup') {
        const u = await backend.auth.signUpPassword(name.value.trim(), email.value, pw.value);
        // onAuthStateChanged fired before the name was set; refresh so the name shows straight away.
        if (u) { user = u; if (!location.hash.startsWith('#/t/')) renderHome(); }
        toast('Account created. We sent a verification email to ' + normEmail(email.value) + '.', 6000);
      } else {
        await backend.auth.signInPassword(email.value, pw.value);
      }
    } catch (err) { console.error(err); note.textContent = friendlyError(err); }
    finally { submit.disabled = false; }
  });
  forgot.addEventListener('click', async () => {
    if (!isValidEmail(email.value)) { note.textContent = 'Type your email address above first, then click “Forgot password?”.'; email.focus(); return; }
    try { await backend.auth.resetPassword(email.value); note.textContent = 'If an account uses ' + normEmail(email.value) + ', a password reset email is on its way.'; }
    catch (err) { note.textContent = friendlyError(err); }
  });
  return el('div', {}, el('div.auth-or', {}, 'or use your email'), tabs, form);
}

function googleIcon() { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 48 48'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.innerHTML = '<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>'; return s; }
function msIcon() { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 21 21'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.innerHTML = '<rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/>'; return s; }

// ── Team list ───────────────────────────────────────────────────────────────
function stopHome() { homeUnsubs.forEach(u => u && u()); homeUnsubs = []; }

function renderHome() {
  show('home-screen');
  stopHome();
  const acc = $('#home-account'); acc.replaceChildren(avatar(user), el('span', {}, user.name));
  acc.onclick = () => openAccount();
  $('#home-theme').onclick = () => openThemes();
  $('#home-search').onclick = () => startSearch();

  refreshInstallBanner();
  const demo = $('#demo-banner'); demo.hidden = !DEMO_MODE;
  if (DEMO_MODE) demo.replaceChildren('Demo mode: data is saved in this browser only. ', el('button.btn.small.ghost', { type: 'button', onclick: () => { if (confirm('Delete ALL demo teams and accounts in this browser?')) backend.data.resetDemo(); } }, 'Reset demo data'));

  const verify = $('#verify-banner');
  verify.hidden = !!user.emailVerified;
  if (!user.emailVerified) {
    verify.replaceChildren(el('b', {}, 'Verify your email to see invitations. '), `Team invitations are matched to ${user.email}, and only verified addresses can accept them. `,
      el('button.btn.small', { type: 'button', onclick: async () => { try { await backend.auth.sendVerification(); toast('Verification email sent to ' + user.email); } catch (e) { toast(friendlyError(e)); } } }, 'Send verification email'), ' ',
      el('button.btn.small.ghost', { type: 'button', onclick: async () => { const u = await backend.auth.reloadUser?.(); if (u && u.emailVerified) { user = u; renderHome(); } else toast('Still not verified. Open the link in the email first.'); } }, 'I’ve verified'));
  }

  const teamsBox = $('#teams-list'); teamsBox.replaceChildren(el('div.muted', {}, 'Loading teams…'));
  const mtSec = $('#mytasks-section'), mtBox = $('#mytasks');
  let teamList = [], teamIdsKey = null, mentionUnsub = null, mentionsByTeam = {}, work = [];
  let showDone = false; try { showDone = localStorage.getItem('tt_mytasks_done') === '1'; } catch { /* */ }
  const drawTiles = () => {
    teamsBox.replaceChildren();
    if (!teamList.length) { teamsBox.append(el('div.empty-state', {}, 'You’re not in any team yet. Create one below, or ask a team leader to invite ', el('b', {}, user.email), '.')); return; }
    teamList.forEach(t => {
      const n = collab.unreadMentions(user.uid, mentionsByTeam[t.id] || []).length;
      teamsBox.append(el('button.team-tile', { type: 'button', onclick: () => goTeam(t.id), 'aria-label': t.name + (n ? `, ${n} unread mention${n === 1 ? '' : 's'}` : '') }, teamLogo(t),
        el('span', {}, el('span.t-name', {}, t.name), el('br'), el('span.pill', {}, roleLabel(t.roleId))),
        n ? el('span.count-badge.tile-badge', { title: n + ' unread mention' + (n === 1 ? '' : 's') }, '@' + n) : ''));
    });
  };
  const drawMyTasks = () => {
    mtSec.hidden = !teamList.length;
    collab.renderMyTasks(mtBox, work, user.uid, { showDone, onToggle: (v) => { showDone = v; try { localStorage.setItem('tt_mytasks_done', v ? '1' : ''); } catch { /* */ } drawMyTasks(); }, onOpen: openTaskIn });
    sizeTaskPanel();
  };
  // Side by side, My tasks fills the space left below its top edge and scrolls inside,
  // so a long list never pushes the page (and your teams) down.
  const sizeTaskPanel = () => {
    if (!mtSec.isConnected) return;
    if (!window.matchMedia('(min-width: 961px)').matches) { mtSec.style.maxHeight = ''; return; }
    const top = mtSec.getBoundingClientRect().top + window.scrollY;
    mtSec.style.maxHeight = Math.max(360, window.innerHeight - top - 24) + 'px';
  };
  window.addEventListener('resize', sizeTaskPanel);
  homeUnsubs.push(() => window.removeEventListener('resize', sizeTaskPanel));
  homeMentionsRender = drawTiles;
  homeUnsubs.push(() => { homeMentionsRender = null; mentionUnsub && mentionUnsub(); });
  homeUnsubs.push(backend.data.watchMyTeams(user.uid, (teams) => {
    teamList = teams.sort((a, b) => a.name.localeCompare(b.name)); homeSearchData.teams = teamList; myTeamsCache = teamList;
    const cw = $('#crossteam-btn'); if (cw) cw.hidden = teamList.length < 2;
    const key = teamList.map(t => t.id).join(',');
    if (key !== teamIdsKey) {
      teamIdsKey = key; mentionUnsub && mentionUnsub(); mentionsByTeam = {};
      const ids = teamList.map(t => t.id);
      mentionUnsub = ids.length ? backend.data.watchMyMentions(ids, user.uid, (m) => { mentionsByTeam = m; drawTiles(); }, (e) => console.warn('mentions', e)) : null;
      if (ids.length) { mtBox.replaceChildren(el('div.muted', {}, 'Loading your tasks…')); cachedMyWork(ids, key).then(w => { if (teamIdsKey === key) { work = w; homeSearchData.work = w; drawMyTasks(); } }).catch(e => { console.warn(e); mtBox.replaceChildren(el('div.banner', {}, 'Could not load your tasks: ' + friendlyError(e))); }); }
      else { work = []; drawMyTasks(); }
    }
    drawTiles();
  }, (e) => { teamsBox.replaceChildren(el('div.banner', {}, 'Could not load teams: ' + friendlyError(e))); }));

  const invSec = $('#invites-section'); const invBox = $('#invites-list');
  if (user.emailVerified) {
    homeUnsubs.push(backend.data.watchMyInvites(user.email, (invites) => {
      invSec.hidden = !invites.length; invBox.replaceChildren();
      invites.forEach(inv => {
        const accept = el('button.btn.primary.small', { type: 'button', onclick: async () => {
          accept.disabled = true;
          try { await backend.data.acceptInvite(inv.teamId, newMemberDoc(inv.roleId), user.email); toast('You joined ' + inv.teamName + '.'); goTeam(inv.teamId); }
          catch (e) { accept.disabled = false; toast(friendlyError(e)); }
        } }, 'Join team');
        const decline = el('button.btn.small.ghost', { type: 'button', onclick: async () => { try { await backend.data.declineInvite(inv.teamId, user.email); } catch (e) { toast(friendlyError(e)); } } }, 'Decline');
        invBox.append(el('div.invite-card', {}, el('span', {}, el('b', {}, inv.invitedByName || 'Someone'), ' invited you to ', el('b', {}, inv.teamName || 'a team'), ' as ', el('span.pill.blue', {}, roleLabel(inv.roleId))), el('span.spacer'), decline, accept));
      });
    }, (e) => { console.warn('invites', e); invSec.hidden = true; }));
  } else invSec.hidden = true;

  const form = $('#create-team-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = form.name.value.trim(); if (!name) return;
    // Free plan: up to 3 teams of your own (teams on Pro don't count).
    const ownFree = teamList.filter(t => t.roleId === 'owner' && planOf(t).tier === 'free').length;
    if (ownFree >= PLANS.free.ownTeams) { toast('On the Free plan you can own up to ' + PLANS.free.ownTeams + ' teams. Delete one you no longer use, or move a team to Pro (Settings ▸ Plan).', 7000); return; }
    const btn = form.querySelector('button'); btn.disabled = true;
    try {
      const teamDoc = { name: name.slice(0, 80), logo: '', ownerUid: user.uid, createdAt: Date.now(), roles: DEFAULT_ROLES, fields: [], labels: DEFAULT_LABELS, weekNaming: 'sequence', phases: [], features: { ...NEW_TEAM_FEATURES }, weeks: [firstWeek()] };
      const id = await backend.data.createTeam(teamDoc, newMemberDoc('owner'));
      form.reset(); goTeam(id);
    } catch (err) { toast(friendlyError(err)); } finally { btn.disabled = false; }
  };
}

/** My student status and this year's Pro Education claims (both are top-level documents about me). */
async function loadStudent(u) {
  if (!backend.data.myDoc) return;
  const [v, c] = await Promise.all([backend.data.myDoc('verifiedStudents', u.uid), backend.data.myDoc('eduClaims', u.uid)]);
  if (user !== u) return;
  studentStatus = v && v.until > Date.now() ? { email: v.email, until: v.until } : null;
  eduClaim = cleanEduClaim(c);
  if (window.TTSettingsRefresh) window.TTSettingsRefresh();
}

function newMemberDoc(roleId) {
  return { uid: user.uid, email: normEmail(user.email), name: user.name || '', photo: user.photo || '', roleId, joinedAt: Date.now() };
}
function roleLabel(roleId, team) { const r = (team && team.roles && team.roles[roleId]) || DEFAULT_ROLES[roleId]; return r ? r.name : roleId; }
function mondayISO(d = new Date()) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
// New teams start at WEEK 1 (own numbering); Settings ▸ General can switch to calendar weeks.
function firstWeek() { return { key: newId('wk'), title: 'WEEK 1', metric: '', startDate: mondayISO() }; }

// ── Search everything (Ctrl+K / ⌘K) ─────────────────────────────────────────
let homeSearchData = { teams: [], work: [] };
function homeSources() {
  const items = [];
  homeSearchData.teams.forEach(t => items.push({ group: 'Teams', icon: '👥', title: t.name, sub: roleLabel(t.roleId), fields: [[t.name, 3]], run: () => goTeam(t.id), suggest: true }));
  homeSearchData.work.forEach(w => (w.tasks || []).forEach(t => items.push({ group: 'My tasks', icon: t.flag === 'completed' ? '✅' : '📌', title: t.name || 'Untitled task',
    sub: [w.team.name, t.jiraId, t.dueDate && 'due ' + t.dueDate].filter(Boolean).join(' · '), fields: [[t.name, 3], [t.jiraId, 3], [w.team.name, 1], [(t.subtasks || []).map(x => x.title).join(' '), 1]], run: () => openTaskIn(w.teamId, t.id) })));
  [['🎨', 'Change theme', () => openThemes()], ['👤', 'My account', () => openAccount()], ['➕', 'Create a team', () => { const i = $('#create-team-form input[name=name]'); if (i) i.focus(); }]]
    .forEach(([icon, title, run]) => items.push({ group: 'Actions', icon, title, fields: [[title, 2]], run, suggest: true }));
  return { items, placeholder: 'Search your teams and tasks…' };
}
function startSearch() {
  if (!user) return;
  if (session && session.booted) openSearch(() => boardSources(ctx()));
  else if (!$('#home-screen').hidden) openSearch(homeSources);
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); startSearch(); return; }
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const a = document.activeElement; if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    if (document.querySelector('.modal-overlay, #dialog-overlay, #analytics-overlay')) return;
    e.preventDefault(); startSearch();
  }
});

// ── Install as an app (home screen) ─────────────────────────────────────────
let installPrompt = null;
const isStandalone = () => { try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch { return false; } };
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isPhoneOrTablet = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; refreshInstallBanner(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('TeamTrack is installed. Open it from your home screen.'); refreshInstallBanner(); });
if ('serviceWorker' in navigator && !DEMO_MODE && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(e => console.warn('Offline support not available:', e)); });
}
/** Can this browser install the app, and how? 'prompt' (Android/Chrome/Edge), 'ios' (Share ▸ Add to Home Screen), or ''. */
function installMode() {
  if (isStandalone()) return '';
  if (installPrompt) return 'prompt';
  if (isIOS()) return 'ios';
  return '';
}
async function installApp() {
  const mode = installMode();
  if (mode === 'prompt') { installPrompt.prompt(); const r = await installPrompt.userChoice.catch(() => null); if (r && r.outcome === 'accepted') installPrompt = null; refreshInstallBanner(); return; }
  const m = modal('Install TeamTrack', { narrow: true });
  m.body.append(isIOS()
    ? el('div', {}, el('p.hint', { style: { marginTop: 0 } }, 'On iPhone and iPad, in Safari:'), el('ol.install-steps', {}, el('li', {}, 'Tap the Share button (the square with an arrow, at the bottom or top of Safari).'), el('li', {}, 'Scroll down and tap “Add to Home Screen”.'), el('li', {}, 'Tap “Add”. TeamTrack appears on your home screen and opens full-screen.')), el('p.hint', {}, 'In Chrome on iPhone, use the Share button in the address bar the same way.'))
    : el('div', {}, el('p.hint', { style: { marginTop: 0 } }, 'Your browser didn’t offer an install button just now. You can still install TeamTrack:'), el('ul.install-steps', {}, el('li', {}, 'Chrome or Edge on a computer: the install icon at the right of the address bar, or menu ▸ “Install TeamTrack”.'), el('li', {}, 'Chrome on Android: menu ⋮ ▸ “Add to Home screen” or “Install app”.'), el('li', {}, 'Safari on a Mac: File ▸ “Add to Dock”.'))));
  m.foot.append(el('span.spacer'), el('button.btn.primary', { type: 'button', onclick: () => m.close() }, 'Got it'));
}
function refreshInstallBanner() {
  const b = $('#install-banner'); if (!b) return;
  let dismissed = false; try { dismissed = localStorage.getItem('tt_install_dismissed') === '1'; } catch { /* */ }
  const mode = installMode();
  b.hidden = !mode || dismissed || !isPhoneOrTablet() || DEMO_MODE;
  if (b.hidden) return;
  b.replaceChildren(el('span', {}, '📱 ', el('b', {}, 'Install TeamTrack'), ' on this device: it opens full-screen from your home screen, like an app.'), el('span.spacer'),
    el('button.btn.small.ghost', { type: 'button', onclick: () => { try { localStorage.setItem('tt_install_dismissed', '1'); } catch { /* */ } refreshInstallBanner(); } }, 'Not now'),
    el('button.btn.small.primary', { type: 'button', onclick: installApp }, mode === 'ios' ? 'Show me how' : 'Install'));
}
function installField() {
  if (isStandalone()) return el('div.field', {}, el('span', {}, 'App'), el('div.hint', {}, '✓ You’re using the installed TeamTrack app.'));
  return el('div.field', {}, el('span', {}, 'App'), el('div.row', {}, el('span.hint', {}, 'Put TeamTrack on your home screen or dock.'), el('span.spacer'),
    el('button.btn.small', { type: 'button', onclick: installApp }, '📱 Install as an app…')));
}

// ── Email notifications (sent by the Cloud Functions for Pro teams) ─────────
function notifyField() {
  const n = (user && user.notify) || {};
  const box = (key, label) => el('label.row', { style: { gap: '8px', margin: '4px 0' } }, el('input', { type: 'checkbox', checked: n[key] !== false, dataset: { notify: key }, onchange: async (e) => {
    const next = { mentions: n.mentions !== false, digest: n.digest !== false, [key]: e.target.checked };
    try { const u = await backend.auth.setNotify(next); user = { ...user, ...(u || {}), notify: next }; Object.assign(n, next); toast(e.target.checked ? 'You’ll get these emails.' : 'Those emails are off.'); }
    catch (err) { e.target.checked = !e.target.checked; toast(friendlyError(err), 5000); }
  } }), label);
  return el('div.field', { id: 'notify-field' }, el('span', {}, 'Email notifications'),
    box('mentions', 'When someone @mentions me'), box('digest', 'Monday digest: my overdue and upcoming tasks'),
    el('div.hint', {}, 'Sent to ' + (user ? user.email : 'your email') + ' from teams on Pro or Pro Education. You can switch them off here or with the link in any email.'));
}

// ── Right-click menu style: list (default) or circle ────────────────────────
function menuStyle() { try { return localStorage.getItem('tt_menu_style') === 'circle' ? 'circle' : 'list'; } catch { return 'list'; } }
function menuStyleField() {
  const box = el('div.seg-toggle', { role: 'radiogroup', 'aria-label': 'Right-click menu style' });
  const draw = () => box.replaceChildren(...[['list', '☰ List'], ['circle', '◎ Circle']].map(([v, label]) =>
    el('button' + (menuStyle() === v ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(menuStyle() === v), dataset: { menuStyle: v }, onclick: () => chooseMenuStyle(v).then(draw) }, label)));
  draw();
  return el('div.field', {}, el('span', {}, 'Right-click menu'), box,
    el('div.hint', { style: { marginTop: '6px' } }, 'The menu you get by right-clicking, pressing and holding, or tapping ⋯ on a card. Circle shows the same actions around the pointer.'));
}
async function chooseMenuStyle(v) {
  try { localStorage.setItem('tt_menu_style', v); } catch { /* */ }
  if (window.closeContextMenu) try { window.closeContextMenu(); } catch { /* */ }
  toast(v === 'circle' ? 'Circle menu on. Right-click (or press and hold) the board to try it.' : 'List menu on.');
  if (!user || !backend.auth.setMenuStyle) return;
  try { const u = await backend.auth.setMenuStyle(v); user = { ...user, ...(u || {}), menuStyle: v }; } catch (e) { console.warn('Menu style saved in this browser only:', e); }
}

// ── Theme packs ─────────────────────────────────────────────────────────────
function themePreview(id) {
  const prev = (k) => {
    const [bg, panel, accent, text] = SWATCH[k];
    const line = (w, c = text, o = 0.55) => el('i', { style: { width: w, background: c, opacity: o } });
    return [el('span.tp-side', { style: { background: panel } }, line('80%', text, 0.8), line('60%'), line('70%'), line('50%')),
      el('span.tp-main', { style: { background: bg } }, el('span.tp-card', { style: { background: panel, border: '1px solid ' + text + '22' } }, line('75%', text, 0.85), line('50%'), el('i', { style: { width: '100%', background: accent, opacity: 1 } })), el('span.tp-btn', { style: { background: accent } }))];
  };
  if (id === 'auto') {
    const [bgD] = SWATCH.midnight, [bgL] = SWATCH.daylight;
    return el('span.theme-prev.auto', { 'aria-hidden': 'true' },
      el('span', { style: { background: bgD, display: 'grid', placeItems: 'center', color: '#e2e8f0', fontSize: '20px' } }, '🌙'),
      el('span', { style: { background: bgL, display: 'grid', placeItems: 'center', color: '#1a202c', fontSize: '20px' } }, '☀️'));
  }
  return el('span.theme-prev', { 'aria-hidden': 'true' }, ...prev(id));
}
function openThemes() {
  const m = modal('Theme'); m.foot.remove();
  const draw = () => {
    m.body.replaceChildren(el('p.hint', { style: { marginTop: 0 } }, 'Pick the colours you like. Only you see your theme, and it follows you to every device you sign in on.'));
    [['', THEMES.filter(t => t.mode === 'auto')], ['Dark', THEMES.filter(t => t.mode === 'dark')], ['Light', THEMES.filter(t => t.mode === 'light')]].forEach(([label, list]) => {
      if (label) m.body.append(el('div.theme-group', {}, label));
      m.body.append(el('div.theme-grid', { role: 'radiogroup', 'aria-label': label || 'Automatic' }, ...list.map(t => el('button.theme-card' + (t.id === currentTheme() ? '.on' : ''), {
        type: 'button', role: 'radio', 'aria-checked': String(t.id === currentTheme()), dataset: { theme: t.id }, title: t.note,
        onclick: () => chooseTheme(t.id).then(draw),
      }, themePreview(t.id), el('b', {}, t.name, t.id === currentTheme() ? el('span.theme-check', {}, '✓') : ''), el('span.hint', {}, t.note)))));
    });
  };
  draw();
}
async function chooseTheme(id) {
  applyTheme(id);
  const n = document.getElementById('account-theme-name'); if (n) n.textContent = themeName(id);
  if (window.boardThemeChanged) window.boardThemeChanged();
  if (!user || !backend.auth.setTheme) return;
  try { const u = await backend.auth.setTheme(id); user = { ...user, ...(u || {}), theme: id }; }
  catch (e) { console.warn('Theme saved in this browser only:', e); }
}

// ── Account ─────────────────────────────────────────────────────────────────
/** Your name and photo on the account buttons (team list and board). */
function refreshAccountChips() {
  if (!user) return;
  document.querySelectorAll('.user-display').forEach(n => { n.textContent = user.name; });
  document.querySelectorAll('.chip-avatar').forEach(n => n.replaceChildren(avatar(user)));
  const acc = document.getElementById('home-account'); if (acc && acc.childElementCount) acc.replaceChildren(avatar(user), el('span', {}, user.name));
}

function openAccount() {
  const m = modal('Your account', { narrow: true });
  const name = el('input', { value: user.name, maxlength: 80 });
  const photoBox = el('span.account-photo');
  const photoBtns = el('div.row', { style: { gap: '6px' } });
  const drawPhoto = () => {
    photoBox.replaceChildren(avatar(user));
    photoBtns.replaceChildren(el('button.btn.small', { type: 'button', onclick: () => changePhoto() }, user.photo ? 'Change photo…' : 'Upload photo…'));
    if (user.photo) photoBtns.append(el('button.btn.small.ghost', { type: 'button', onclick: () => changePhoto('') }, 'Remove photo'));
  };
  // Upload (file picked) or remove ('' passed) the photo; saved to your profile and all your teams.
  async function changePhoto(value) {
    let photo = value;
    if (photo === undefined) {
      const f = await pickFile('image/png,image/jpeg,image/webp,image/gif'); if (!f) return;
      try { photo = await imageFileToDataUrl(f, 160, LIMITS.avatarBytes); } catch (e) { toast(e.message, 5000); return; }
    }
    photoBtns.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const u = await backend.auth.setPhoto(photo);
      user = { ...user, ...(u || {}), photo: u ? u.photo : photo };
      drawPhoto(); refreshAccountChips();
      toast(photo ? 'Photo updated. Your teams will see it.' : 'Photo removed.');
    } catch (e) { toast(friendlyError(e), 5000); drawPhoto(); }
  }
  drawPhoto();
  m.body.append(
    el('div.row', { style: { marginBottom: '16px', alignItems: 'center' } }, photoBox,
      el('div', { style: { minWidth: 0 } }, el('b', {}, user.name), el('div.muted', {}, user.email), el('div.hint', {}, user.emailVerified ? 'Email verified' : 'Email not verified'), photoBtns)),
    el('label.field', {}, el('span', {}, 'Display name (shown to your teams)'), name),
    el('div.field', {}, el('span', {}, 'Theme'), el('div.row', {}, el('span', { id: 'account-theme-name' }, themeName(currentTheme())), el('span.spacer'),
      el('button.btn.small', { type: 'button', onclick: () => openThemes() }, '🎨 Change theme…'))),
    menuStyleField(),
    notifyField(),
    installField(),
    yourDataField(app, m));
  m.foot.append(
    el('button.btn.danger', { type: 'button', onclick: async () => { m.close(); await backend.auth.signOut(); location.hash = ''; } }, 'Sign out'),
    el('span.spacer'),
    el('button.btn.primary', { type: 'button', onclick: async () => {
      const v = name.value.trim(); if (!v) return;
      try {
        await backend.auth.updateName(v); user = { ...user, name: v };
        if (session && session.me) await backend.data.commit(session.teamId, [{ type: 'update', path: 'members/' + user.uid, data: { name: v } }]);
        toast('Name updated.'); m.close(); if (!session) renderHome();
      } catch (e) { toast(friendlyError(e)); }
    } }, 'Save'));
}

// ── Team board ──────────────────────────────────────────────────────────────
function loadBoard() {
  if (boardLoaded) return boardLoaded;
  boardLoaded = (async () => {
    window.XLSX = await import('xlsx');
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = (import.meta.env.BASE_URL || '/') + 'board/board.js?v=' + (typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'); s.onload = res; s.onerror = () => rej(new Error('Could not load the board')); document.body.append(s); });
  })();
  return boardLoaded;
}

const prefKey = (k) => 'tt_' + k + '_' + (session ? session.teamId : '') + '_' + (user ? user.uid : '');
function readPref(k, fallback) { try { return JSON.parse(localStorage.getItem(prefKey(k))) ?? fallback; } catch { return fallback; } }
function writePref(k, v) { try { localStorage.setItem(prefKey(k), JSON.stringify(v)); } catch { /* full */ } }

async function openTeam(teamId) {
  closeTeam(); stopHome();
  show('board-screen');
  try { await loadBoard(); } catch (e) { toast(e.message); goHome(); return; }
  session = { teamId, team: null, members: null, categories: null, tasks: null, me: null, base: null, undo: [], redo: [], pending: 0, booted: false, recent: new Map() };
  const s = session;
  const handlers = {
    onTeam: (t) => { s.rawTeam = t; s.team = { id: t.id, ...cleanTeam(t) }; schedule(); },
    onMembers: (ms) => { s.members = ms.map(m => cleanMember(m, m.uid)); schedule(); },
    onCategories: (cs) => { s.categories = cs.map(c => cleanCategory(c, c.id)); schedule(); },
    onTasks: (ts) => { s.rawTasks = ts; schedule(); },
    onError: (e) => {
      if (session !== s) return;
      console.warn(e);
      toast(e.code === 'not-found' ? 'This team no longer exists.' : (String(e.code || e.message).includes('permission') ? 'You’re not a member of this team.' : friendlyError(e)), 6000);
      goHome();
    },
  };
  s.unsub = backend.data.watchTeam(teamId, handlers);
  s.templates = [];
  s.unsubTemplates = backend.data.watchCollection(teamId, 'templates', (ts) => {
    if (session !== s) return;
    s.templates = ts.map(t => cleanTemplate(t, t.id, s.team ? s.team.fields : [])).sort((a, b) => a.name.localeCompare(b.name));
    if (window.TTSettingsRefresh) window.TTSettingsRefresh();
  }, (e) => console.warn('templates', e));
  s.comments = [];
  s.unsubComments = backend.data.watchComments(teamId, (cs) => {
    if (session !== s) return;
    s.comments = cs.map(c => cleanComment(c, c.id)).filter(c => c.text); s.commentsLoaded = true;
    commentsChanged();
  }, (e) => console.warn('comments', e));
  // Research tools (Phase 7)
  s.meetings = []; s.notebook = []; s.parts = []; s.papers = []; s.expenses = []; s.budget = null; s.profiles = []; s.risks = []; s.requirements = []; s.requests = [];
  // Each tool's records are only listened to while the team has that tool switched on (syncResearch):
  // every listener costs a database read per record each time the team is opened.
  s.researchUnsubs = {};
  s.unsubResearch = [() => Object.values(s.researchUnsubs).forEach(u => u && u())];
  s.onOnline = () => setSyncStatus(); window.addEventListener('online', s.onOnline); window.addEventListener('offline', s.onOnline);
}

function closeTeam() {
  if (!session) return;
  session.unsub && session.unsub();
  session.unsubComments && session.unsubComments();
  session.unsubTemplates && session.unsubTemplates();
  (session.unsubResearch || []).forEach(u => u && u()); stopMoney(session);
  window.removeEventListener('online', session.onOnline); window.removeEventListener('offline', session.onOnline);
  session = null;
  if (window.boardReset) window.boardReset();
}

// ── Comments and mentions ───────────────────────────────────────────────────
let pendingOpen = null;   // { teamId, taskId } to open once that board has loaded
function openTaskIn(teamId, taskId) {
  if (session && session.teamId === teamId && session.booted) { window.boardOpenTask && window.boardOpenTask(taskId); return; }
  pendingOpen = { teamId, taskId }; goTeam(teamId);
}
function commentsChanged() {
  collab.refreshComments();
  updateActivityBadge();
  if (window.boardRender && session && session.booted) window.boardRender();
}
function updateActivityBadge() {
  const b = $('#activity-badge'); if (!b || !session) return;
  clearOrphanMentions();
  const n = collab.unreadMentions(user.uid, session.comments).filter(c => session.tasks && session.tasks.some(t => t.id === c.taskId)).length;
  b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n);
  $('#activity-btn') && $('#activity-btn').setAttribute('aria-label', n ? `Activity, ${n} unread mention${n === 1 ? '' : 's'}` : 'Activity');
}
// A mention on a task that has since been deleted can never be opened, so it shouldn't keep a
// badge lit (on this board or on the team list). Once the board and comments have loaded, mark
// those as read. Comments younger than two minutes are left alone, in case the task they
// belong to simply hasn't arrived yet.
function clearOrphanMentions() {
  const s = session; if (!s || !s.booted || !s.commentsLoaded || !s.tasks) return;
  const ids = new Set(s.tasks.map(t => t.id)); const old = Date.now() - 2 * 60 * 1000;
  const gone = collab.unreadMentions(user.uid, s.comments).filter(c => !ids.has(c.taskId) && (c.createdAt || 0) < old).map(c => c.id);
  if (gone.length) collab.markSeen(user.uid, gone);
}
window.addEventListener('tt-mentions-seen', () => { if (session) { updateActivityBadge(); if (window.boardRender && session.booted) window.boardRender(); } if (homeMentionsRender) homeMentionsRender(); });
let homeMentionsRender = null;

let scheduled = false;
function schedule() { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; refresh(); }); }

function stateForModel() {
  const s = session;
  return { team: s.team, members: s.members, categories: s.categories, tasks: s.tasks, personOrder: readPref('order', []), collapsed: readPref('collapsed', {}) };
}

/** Everything the board draws from: the tasks/weeks/categories plus the team settings and people. */
/** What the cards show from data outside the board (comment, mention and notebook chips, which add up over carried copies). */
function chipSignature(s) {
  const ix = carryIndexOf(s); const by = new Map();
  const add = (taskId, k) => { const r = ix.rootOf(taskId); const e = by.get(r) || by.set(r, { c: 0, n: 0, m: 0 }).get(r); e[k]++; };
  (s.comments || []).forEach(c => add(c.taskId, 'c'));
  (s.notebook || []).forEach(n => add(n.taskId, 'n'));
  if (user) collab.unreadMentions(user.uid, s.comments || []).forEach(c => add(c.taskId, 'm'));
  return [...by.entries()].map(([r, e]) => r + ':' + e.c + ',' + e.n + ',' + e.m + ':' + ix.ids(r).join(',')).sort().join(';');
}
function boardSignature(s, flat) { return JSON.stringify(flat) + '|' + chipSignature(s) + '|' + JSON.stringify(s.team) + '|' + JSON.stringify(s.members) + '|' + JSON.stringify(readPref('order', [])) + '|' + JSON.stringify(readPref('collapsed', {})); }

function refresh() {
  const s = session;
  if (!s || !s.team || !s.members || !s.categories || !s.rawTasks) return;
  s.tasks = s.rawTasks.map(t => cleanTask(t, t.id, s.team.fields));
  s.me = s.members.find(m => m.uid === user.uid) || null;
  if (!s.me) { toast('You’re no longer a member of this team.', 6000); goHome(); return; }
  healLostEdits(s);
  const model = buildModel(stateForModel());
  s.base = flatten(model);
  // When the saved data that comes back is exactly what the board already shows (the echo of your
  // own edit), don't redraw the whole board again.
  const sig = boardSignature(s, s.base);
  if (sig !== s.shownSig) { s.shownSig = sig; window.boardApplyModel(model); }
  updateChrome(); updateActivityBadge();
  if (pendingOpen && pendingOpen.teamId === s.teamId) { const id = pendingOpen.taskId; pendingOpen = null; setTimeout(() => window.boardOpenTask && window.boardOpenTask(id), 50); }
  syncMoney(s); syncResearch(s);
  refreshResearch(ctx());
  if (!s.booted) { s.booted = true; onFirstLoad(); }
  if (window.TTSettingsRefresh) window.TTSettingsRefresh();
}

// Team tools: [collection, clean, session key, what to refresh, feature switch (null = always)]
const RESEARCH = [
  ['meetings', cleanMeeting, 'meetings', null, 'meetings'], ['parts', cleanPart, 'parts', null, 'parts'], ['papers', cleanPaper, 'papers', null, 'literature'],
  ['notebook', cleanNotebookEntry, 'notebook', 'board', 'notebook'], ['profiles', (p, id) => cleanProfile(p, id), 'profiles', 'board', null],
  ['risks', cleanRisk, 'risks', null, 'risks'], ['requirements', cleanRequirement, 'requirements', null, 'requirements'],
  ['requests', (r, id) => ({ ...r, id }), 'requests', 'settings', null],
];
function syncResearch(s) {
  const on = cleanFeatures(s.team.features);
  RESEARCH.forEach(([coll, clean, key, after, feature]) => {
    const want = !feature || on[feature];
    if (want && !s.researchUnsubs[coll]) {
      s.researchUnsubs[coll] = backend.data.watchCollection(s.teamId, coll, (rows) => { if (session !== s) return; s[key] = rows.map(r => clean(r, r.id)); researchChanged(after); }, (e) => console.warn(coll, e));
    } else if (!want && s.researchUnsubs[coll]) { s.researchUnsubs[coll](); delete s.researchUnsubs[coll]; s[key] = []; }
  });
}

// Money is only read by roles allowed to see it, so its listeners follow the role.
function syncMoney(s) {
  const want = seesMoney(s) && cleanFeatures(s.team.features).finance;   // and only while Finance is switched on
  if (want && !s.unsubMoney) {
    s.unsubMoney = [
      backend.data.watchCollection(s.teamId, 'expenses', (rows) => { if (session !== s) return; s.expenses = rows.map(r => cleanExpense(r, r.id)); researchChanged(); }, (e) => console.warn('expenses', e)),
      backend.data.watchCollection(s.teamId, 'financeLog', (rows) => { if (session !== s) return; s.financeLog = rows.map(r => cleanLogEntry(r, r.id)).sort((a, b) => b.at - a.at); researchChanged(); }, (e) => console.warn('financeLog', e)),
      backend.data.watchCollection(s.teamId, 'finance', (rows) => { if (session !== s) return; const b = rows.find(r => r.id === 'budget'); s.budget = b ? cleanBudget(b) : null; researchChanged(); }, (e) => console.warn('finance', e)),
    ];
  } else if (!want && s.unsubMoney) stopMoney(s);
}
function stopMoney(s) { if (s && s.unsubMoney) { s.unsubMoney.forEach(u => u && u()); s.unsubMoney = null; s.expenses = []; s.budget = null; s.financeLog = []; } }
function researchChanged(after) {
  refreshResearch(ctx());
  if (after === 'settings' && window.TTSettingsRefresh) window.TTSettingsRefresh();
  if (after === 'board' && window.boardRender && session && session.booted) { window.boardRender(); if (window.boardRefreshEditor) window.boardRefreshEditor(); }
}
async function onFirstLoad() {
  const s = session;
  // Teams made before a permission existed: give the built-in roles that permission's default, once.
  if (can(s.team, s.me, 'roles.manage')) {
    const roles = JSON.parse(JSON.stringify(s.team.roles || {})); let changed = false;
    Object.entries(BUILTIN_ROLES).forEach(([id, def]) => {
      const r = roles[id]; if (!r || id === 'owner') return;
      Object.entries(def.perms).forEach(([k, v]) => { if (s.rawTeam && s.rawTeam.roles && s.rawTeam.roles[id] && s.rawTeam.roles[id].perms && !(k in s.rawTeam.roles[id].perms)) { r.perms[k] = v; changed = true; } });
    });
    if (changed) { try { await backend.data.commit(s.teamId, [{ type: 'update', path: 'team', data: { roles } }]); } catch (e) { console.warn('role defaults', e); } }
  }
  // A member who can edit their own tasks but has no row yet gets a starter category.
  if (can(s.team, s.me, 'tasks.editOwn') && !s.categories.some(c => c.ownerUid === user.uid)) {
    try { await backend.data.commit(s.teamId, [{ type: 'set', path: 'categories/' + newId('c'), data: { name: 'GENERAL', ownerUid: user.uid, order: 0 } }]); }
    catch (e) { console.warn('starter category', e); }
  }
}

function updateChrome() {
  const s = session; if (!s) return;
  const T = s.team;
  document.title = T.name + ' · ' + APP_NAME;
  const sw = $('#team-switch'); sw.replaceChildren(teamLogo(T), el('span', {}, T.name)); sw.onclick = goHome;
  document.querySelectorAll('[data-perm]').forEach(n => { n.style.display = can(T, s.me, n.dataset.perm) ? '' : 'none'; });
  const tools = $('#research-btn'); if (tools) tools.style.display = toolTabs(s).length ? '' : 'none';
  const brand = $('#brand-block'); brand.replaceChildren();
  if (T.logo) brand.append(el('img.brand-logo-img', { src: T.logo, alt: T.name + ' logo' }));
  else brand.append(el('div.brand-team', {}, T.name));
  brand.append(el('div.brand-title', {}, roleLabel(s.me.roleId, T) + ' · ' + s.members.length + (s.members.length === 1 ? ' member' : ' members')));
  document.body.classList.toggle('hide-metric', !T.labels.metric.show);
  refreshAccountChips();
  renderTeamDataPanel();
  updateActivityBadge();
  setSyncStatus();
}

// Saving: the status in the panel and the notice on the board, merging saves made at the same
// moment, and readable save errors live in saving.js.
const setSyncStatus = (state, why) => saving.setSyncStatus(app, state, why);
const healLostEdits = (s) => saving.healLostEdits(app, s);
const { rememberWrites, settleWrites, saveError } = saving;
function renderTeamDataPanel() {
  const s = session; const box = $('#team-data-actions'); if (!box) return;
  box.replaceChildren();
  const b = (label, fn, title) => el('button.btn-secondary', { type: 'button', onclick: fn, title, style: { fontSize: '12px', padding: '8px' } }, label);
  const T = s.team, me = s.me;
  box.append(b('📅 Add deadlines to your calendar', () => window.TT.openCalendar(), 'Calendar file for any app, or sync to Google Calendar'));
  if (can(T, me, 'data.export')) {
    box.append(b('📊 Download Excel report', () => window.exportOffline()));
    if (GOOGLE_CLIENT_ID) box.append(b('🟩 Export to Google Sheets', () => import('./integrations/sheets.js').then(m => m.exportToSheets(window.TT)), 'Creates or updates a Google Sheet with every task'));
    box.append(b('💾 Download backup (JSON)', () => window.downloadBackup()));
  }
  if (can(T, me, 'tasks.editOwn') || can(T, me, 'tasks.editAll')) {
    box.append(b('📥 Import tasks (Excel, CSV, Jira, Trello…)', () => import('./importer.js').then(m => m.importFromFile(window.TT))));
    if (GOOGLE_CLIENT_ID && can(T, me, 'tasks.editAll')) box.append(b('📝 Task collection sheet (Google Sheets)', () => import('./integrations/sheets.js').then(m => m.openCollectionSheet(window.TT))));
  }
  $('#team-data-note').textContent = DEMO_MODE ? 'Demo mode: changes are saved in this browser only.' : 'Changes save automatically for everyone in the team, and work offline.';
}

// Write ops on behalf of the board/settings with consistent status + errors.
// My tasks on the home screen: kept for a few minutes, so going back and forth between teams
// doesn't re-read every task you own in every team. Any save of yours refreshes it.
const MY_WORK_MS = 5 * 60e3; let myWorkCache = null;
function cachedMyWork(ids, key) {
  const c = myWorkCache;
  if (c && c.key === key && c.uid === user.uid && Date.now() - c.at < MY_WORK_MS) return c.promise;
  const promise = backend.data.myWork(ids, user.uid);
  myWorkCache = { key, uid: user.uid, at: Date.now(), promise };
  promise.catch(() => { if (myWorkCache && myWorkCache.promise === promise) myWorkCache = null; });
  return promise;
}
async function writeOps(ops, { quiet = false } = {}) {
  const s = session; if (!s || !ops.length) return true;
  myWorkCache = null;
  s.pending++; setSyncStatus(); rememberWrites(s, ops);
  try {
    const res = await backend.data.commit(s.teamId, ops);
    settleWrites(s, ops, true);
    if (session === s) { s.pending--; setSyncStatus('saved'); }
    if (res && res.skipped && res.skipped.length && !quiet) toast(res.skipped.length === 1 ? 'Someone else just deleted something you changed, so that change wasn’t saved.' : `Someone else just deleted ${res.skipped.length} things you changed, so those changes weren’t saved.`, 6000);
    return true;
  }
  catch (e) {
    console.error(e); settleWrites(s, ops, false);
    if (session === s) { s.pending--; setSyncStatus('error', saveError(e)); revert(); }  /* the board's notice says why */
    if (!quiet) report('write', { message: String((e && e.code) || 'error') + ': ' + String((e && e.message) || ''), stack: ops.map(o => o.type + ' ' + String(o.path).split('/')[0]).join(', ') });
    return false;
  }
}
function revert() { if (session && session.team) { const model = buildModel(stateForModel()); session.base = flatten(model); session.shownSig = boardSignature(session, session.base); window.boardApplyModel(model); } }

// ── Bridge used by board.js ─────────────────────────────────────────────────
const UNDO_LIMIT = 60;
window.TT = {
  get me() { return session && session.me ? { uid: user.uid, name: user.name, email: user.email, roleId: session.me.roleId } : null; },
  get team() { return session && session.team; },
  get members() { return (session && session.members) || []; },
  get teamId() { return session && session.teamId; },
  get user() { return user; },
  get isDemo() { return DEMO_MODE; },
  integrations: { google: !!GOOGLE_CLIENT_ID, onedrive: !!MS_CLIENT_ID },
  can: (perm) => !!session && can(session.team, session.me, perm),
  canEditOwner: (uid) => !!session && canEditOwnedBy(session.team, session.me, uid),
  label: (k) => (session && session.team && session.team.labels[k]) || DEFAULT_LABELS[k],
  roleName: (roleId) => roleLabel(roleId, session && session.team),
  /** Title for a new week starting on startISO, following the team's week-numbering choice. */
  weekTitle: (startISO, weeks) => nextWeekTitle(session && session.team ? session.team.weekNaming : 'sequence', weeks, startISO),
  /** New dates (and calendar titles) for week i and every week after it. */
  cascadeWeeks: (weeks, i, startISO) => cascadeWeekDates(weeks, i, startISO, session && session.team ? session.team.weekNaming : 'sequence'),

  /** Board edited its model → diff, check permissions, write. */
  commit(coalesceKey, opts = {}) {
    const s = session; if (!s || !s.base) return;
    const model = window.boardGetModel();
    writePref('order', model.db.filter(p => !p.former).map(p => p.id));
    const flat = flatten(model);
    const changes = diff(s.base, flat);
    if (!changes.length) return;
    const denied = deniedChanges(changes, s.team, s.me);
    if (denied.length) { toast('You don’t have permission to ' + denied.join(' or ') + '.', 4500); revert(); return; }
    s.base = flat; s.shownSig = boardSignature(s, flat);
    // Automatic changes (repeating-task copies) are saved but not put on your undo list.
    if (!opts.noUndo) {
      const now = Date.now(); const last = s.undo[s.undo.length - 1];
      if (coalesceKey && last && last.key === coalesceKey && now - last.at < 1500) { last.changes = mergeChanges(last.changes, changes); last.at = now; }
      else { s.undo.push({ changes, key: coalesceKey || null, at: now }); if (s.undo.length > UNDO_LIMIT) s.undo.shift(); }
      s.redo = [];
    }
    writeOps(changesToOps(changes, user));
  },
  async undo() { return this._step('undo'); },
  async redo() { return this._step('redo'); },
  get templates() { return (session && session.templates) || []; },
  async saveTemplate(name, task) {
    const s = session; if (!s) return false;
    const fieldIds = new Set((s.team.fields || []).map(f => f.id));
    const data = { name: String(name).slice(0, 80), createdBy: user.uid, createdByName: (user.name || user.email || '').slice(0, 80), createdAt: Date.now(),
      task: { name: String(task.name || '').slice(0, 500), priority: task.priority || 'Minor', status: String(task.status || '').slice(0, 60), icon: task.icon || '', phaseId: task.phaseId || '',
        subtasks: (task.subtasks || []).map(x => String(x.title || '').slice(0, 300)).filter(Boolean).slice(0, 100),
        custom: Object.fromEntries(Object.entries(task.custom || {}).filter(([k]) => fieldIds.has(k))), dueOffset: Number.isInteger(task.dueOffset) ? task.dueOffset : null, effort: cleanEffort(task.effort) } };
    return writeOps([{ type: 'set', path: 'templates/' + newId('tpl'), data }]);
  },
  canEditTemplate: (tpl) => !!session && (tpl.createdBy === user.uid || can(session.team, session.me, 'team.settings')),
  canComment: () => !!session && (can(session.team, session.me, 'tasks.editOwn') || can(session.team, session.me, 'tasks.editAll')),
  commentCount: (taskId) => { if (!session || !session.comments) return 0; const ids = new Set(carryIndexOf(session).ids(taskId)); return session.comments.filter(c => ids.has(c.taskId)).length; },
  hasUnreadMention: (taskId) => { if (!session) return false; const ids = new Set(carryIndexOf(session).ids(taskId)); return collab.unreadMentions(user.uid, session.comments).some(c => ids.has(c.taskId)); },
  /** Ids of every carried-forward copy of a task (always includes taskId). */
  chainIds: (taskId) => (session ? carryIndexOf(session).ids(taskId) : [taskId]),
  commentSection: (taskId) => collab.commentSection(ctx(), taskId),
  openResearch: (tab) => { if (session && session.booted) openResearch(ctx(), tab); },
  openReport: () => { if (session && session.booted) return openReport(ctx()); },
  notebookSection: (taskId) => notebookSection(ctx(), taskId),
  notebookCount: (taskId) => notebookCount(session, taskId),
  linkedSection: (taskId) => (session ? linkedSection(ctx(), taskId) : null),
  seesMoney: () => seesMoney(session),
  // Feature switches (Settings ▸ Features)
  feature: (k) => !!session && !!session.team && cleanFeatures(session.team.features)[k] === true,
  get features() { return session && session.team ? cleanFeatures(session.team.features) : cleanFeatures({}); },
  async setFeature(k, on) { return window.TT.setFeatures({ [k]: !!on }); },
  async setFeatures(patch) {
    if (!session || !can(session.team, session.me, 'team.settings')) return false;
    const next = { ...cleanFeatures(session.team.features), ...patch };
    session.team = { ...session.team, features: next };   // so a quick second change builds on this one
    return writeOps([{ type: 'update', path: 'team', data: { features: next } }]);
  },
  // People and capacity
  get profiles() { return (session && session.profiles) || []; },
  profileOf: (uid) => (session && (session.profiles || []).find(p => p.uid === uid)) || cleanProfile({}, uid),
  capacityFor: (uid, monday) => session ? capacityFor((session.profiles || []).find(p => p.uid === uid), cleanCapacity(session.team.capacity), monday) : 0,
  canEditProfile: (uid) => !!session && (uid === user.uid || can(session.team, session.me, 'members.manage')),
  async saveProfile(uid, data) {
    if (!session) return false;
    const p = cleanProfile({ ...((session.profiles || []).find(x => x.uid === uid) || {}), ...data, updatedAt: Date.now() }, uid);
    const { uid: _, ...doc } = p;
    return writeOps([{ type: 'set', path: 'profiles/' + uid, data: doc }]);
  },
  teamSnapshot: (teamId) => backend.data.teamSnapshot(teamId),
  openCrossTeam: () => openCrossTeam({ teams: myTeamsCache.length ? myTeamsCache : (session ? [{ id: session.teamId, name: session.team.name }] : []), load: (id) => backend.data.teamSnapshot(id), meUid: user.uid }),
  openActivity: (tab) => collab.openActivity(ctx(), tab),
  parseGithub,
  githubStatus,
  openCalendar: () => import('./calendar.js').then(m => m.openCalendar(ctx())),
  taskIcs: (taskId) => import('./calendar.js').then(m => m.downloadTaskIcs(ctx(), taskId)),
  canUndo: () => !!session && session.undo.length > 0,
  canRedo: () => !!session && session.redo.length > 0,
  async _step(dir) {
    const s = session; if (!s) return;
    const from = dir === 'undo' ? s.undo : s.redo, to = dir === 'undo' ? s.redo : s.undo;
    const entry = from.pop(); if (!entry) { toast(dir === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.'); return; }
    const applied = dir === 'undo' ? invert(entry.changes) : entry.changes;
    const denied = deniedChanges(applied, s.team, s.me);
    if (denied.length) { toast('Can’t ' + dir + ': your role no longer allows it.'); return; }
    const ok = await writeOps(restoreOps(entry.changes, user, dir === 'undo' ? 'before' : 'after'), { quiet: true });
    if (ok) { to.push({ ...entry, key: null }); toast(dir === 'undo' ? 'Undone. (Ctrl+Y to redo)' : 'Redone.'); }
    else toast('Couldn’t ' + dir + ' — a teammate changed this in the meantime.', 5000);
  },
  setCollapsed(key, val) { const c = readPref('collapsed', {}); if (val) c[key] = true; else delete c[key]; writePref('collapsed', c); },
  savePersonOrder(ids) { writePref('order', ids); },
  writeOps,
  openSettings: (tab) => import('./settings.js').then(m => m.openSettings(ctx(), tab)),
  openInvite: () => import('./settings.js').then(m => m.openSettings(ctx(), 'members')),
  openMemberRole: (uid) => import('./settings.js').then(m => m.openSettings(ctx(), 'members', uid)),
  removeMember: (uid) => import('./settings.js').then(m => m.removeMember(ctx(), uid)),
  openAI: () => import('./ai.js').then(m => m.openAI(ctx())),
  openAttach: (taskId) => import('./attachments.js').then(m => m.openAttach(ctx(), taskId)),
  importFile: (file) => import('./importer.js').then(m => m.importFile(window.TT, file)),
  importFromPicker: () => import('./importer.js').then(m => m.importFromFile(window.TT)),
  async pickImage(maxPx, maxBytes) {
    const { pickFile, imageFileToDataUrl } = await import('./ui.js');
    const f = await pickFile('image/png,image/jpeg,image/webp,image/gif,image/svg+xml');
    return f ? imageFileToDataUrl(f, maxPx, maxBytes) : null;
  },
  openAccount,
  openThemes,
  menuStyle,
  openSearch: () => startSearch(),
  /** A searchable list to pick one item from: items = [{ group, icon, title, sub, fields, run }]. */
  pickFrom: (items, placeholder, empty) => openSearch(() => ({ items, placeholder, empty })),
  // Planning (Phase 6)
  stageOf, cleanEffort, MAX_DEPS, carryRoots,
  get capacity() { return session && session.team ? cleanCapacity(session.team.capacity) : 0; },
  canSetCapacity: () => !!session && can(session.team, session.me, 'team.settings'),
  async setCapacity(n) {
    if (!session || !can(session.team, session.me, 'team.settings')) return false;
    return writeOps([{ type: 'update', path: 'team', data: { capacity: cleanCapacity(n) } }]);
  },
  themeName: () => themeName(currentTheme()),
  // Plans (Free, Pro, Organisation)
  get plan() { return planOf(session && session.team); },
  hasPro: (k) => !!session && hasPro(session.team, k),
  get isPlatformAdmin() { return platformAdmin; },
  get proRequest() { return session && (session.requests || []).find(r => r.id === 'pro') || null; },
  async refreshAdmin() { platformAdmin = !!user && !!backend.data.isPlatformAdmin && !!(await backend.data.isPlatformAdmin(user.uid)); return platformAdmin; },
  async demoMakeAdmin() { if (!DEMO_MODE || !backend.data.demoMakeAdmin) return false; await backend.data.demoMakeAdmin(); return window.TT.refreshAdmin(); },
  /** Platform admins only: change a team's plan. */
  async setTeamPlan(teamId, plan) {
    if (!platformAdmin) return false;
    const p = cleanPlan({ ...plan, by: user.uid, at: Date.now() });
    try { await backend.data.commit(teamId, [{ type: 'update', path: 'team', data: { plan: p } }]); return true; } catch (e) { toast(friendlyError(e), 6000); return false; }
  },
  /** Plans are changed by the team's Owner and Admins only. */
  get planAdmin() { return !!session && !!session.me && ['owner', 'admin'].includes(session.me.roleId); },
  /** Members ask the Owner and Admins to switch on Pro (Education). */
  get planAsks() { return session ? (session.requests || []).filter(r => r.id.startsWith('ask-')).sort((a, b) => a.at - b.at) : []; },
  async askForPro(note) { return writeOps([{ type: 'set', path: 'requests/ask-' + user.uid, data: { by: user.uid, byName: (user.name || user.email || '').slice(0, 80), at: Date.now(), note: String(note || '').slice(0, 300) } }]); },
  async dismissAsk(uid) { return writeOps([{ type: 'delete', path: 'requests/ask-' + uid }]); },
  /** Signed in with a verified university email? Then free Pro Education is one click away. */
  get academic() { return !!user && ((user.emailVerified !== false && isAcademicEmail(user.email)) || (!!studentStatus && studentStatus.until > Date.now())); },
  /** The university email that makes me a student here (sign-in email, or one proved by code). */
  get studentEmail() { return !user ? '' : (user.emailVerified !== false && isAcademicEmail(user.email)) ? user.email : (studentStatus ? studentStatus.email : ''); },
  get studentUntil() { return studentStatus ? studentStatus.until : 0; },
  /** Teams I switched Pro Education on for this calendar year (at most EDU_TEAMS_PER_YEAR). */
  get eduClaim() { return { ...eduClaim, limit: EDU_TEAMS_PER_YEAR }; },
  /** Email a code to a university address (Cloud Function; in the demo the code is shown on screen). */
  async sendStudentCode(email) { return backend.data.callFunction('sendStudentCode', { email: String(email || '').trim() }); },
  async confirmStudentCode(code) { const r = await backend.data.callFunction('confirmStudentCode', { code: String(code || '').trim() }); await loadStudent(user); return r; },
  /** Turn on (or renew) free Pro Education for this team with a university email. */
  async claimEdu() {
    if (!session || !window.TT.academic || !window.TT.planAdmin) return false;
    if (planOf(session.team).tier === 'org') return false;
    // At most EDU_TEAMS_PER_YEAR teams a year per person: the claim list is saved with the plan, and the rules check both.
    const claim = cleanEduClaim(await backend.data.myDoc('eduClaims', user.uid));
    if (!claim.teams.includes(session.teamId) && claim.teams.length >= EDU_TEAMS_PER_YEAR) { toast('You’ve already used free Pro Education on ' + EDU_TEAMS_PER_YEAR + ' teams this year. Ask for Pro below if this team needs it too.', 7000); return false; }
    const teams = claim.teams.includes(session.teamId) ? claim.teams : claim.teams.concat(session.teamId);
    const plan = cleanPlan({ tier: 'pro', edu: true, until: Date.now() + EDU_DAYS * 864e5, by: user.uid, at: Date.now(), note: 'University email: ' + String(window.TT.studentEmail).split('@')[1] });
    const ok = await writeOps([{ type: 'set', path: '/eduClaims/' + user.uid, data: { year: claim.year, teams } }, { type: 'update', path: 'team', data: { plan } }]);
    if (ok) eduClaim = { year: claim.year, teams };
    if (ok && (session.requests || []).some(r => r.id === 'pro' && r.status === 'open')) writeOps([{ type: 'delete', path: 'requests/pro' }], { quiet: true });
    return ok;
  },
  /** Ask for Pro for this team (someone with Team settings). */
  async requestPro(wants, note) {
    if (!session || !window.TT.planAdmin) return false;
    const data = { teamId: session.teamId, teamName: session.team.name, members: session.members.length, wants, note: String(note || '').slice(0, 1000), by: user.uid, byName: (user.name || '').slice(0, 80), email: user.email || '', at: Date.now(), status: 'open' };
    return writeOps([{ type: 'set', path: 'requests/pro', data }]);
  },
  async withdrawProRequest() { return writeOps([{ type: 'delete', path: 'requests/pro' }]); },
  watchPlanRequests: (cb, onError) => backend.data.watchPlanRequests(cb, onError),
  watchFeedback: (cb, onError) => (backend.data.watchFeedback ? backend.data.watchFeedback(cb, onError) : () => {}),
  openFeedback: (kind) => openFeedback(app, kind),
  watchClientErrors: (cb, onError) => backend.data.watchClientErrors ? backend.data.watchClientErrors(cb, onError) : () => {},
  watchEduTeams: (cb, onError) => backend.data.watchEduTeams ? backend.data.watchEduTeams(cb, onError) : () => {},
  async decideRequest(teamId, status) {
    try { await backend.data.commit(teamId, [{ type: 'update', path: 'requests/pro', data: { status, decidedAt: Date.now() } }]); return true; } catch (e) { toast(friendlyError(e), 6000); return false; }
  },
  goHome,
};
function ctx() { return { backend, user, session, TT: window.TT, writeOps, goHome, refresh: () => { if (session) session.shownSig = null; schedule(); } }; }
