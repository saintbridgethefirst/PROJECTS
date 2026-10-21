// ─────────────────────────────────────────────────────────────────────────────
//  "Start here": a small checklist on a new team's board for whoever set the team
//  up (anyone who can change its settings). Steps tick themselves as they get done;
//  the card folds to a pill, and goes away when everything is done or it's hidden.
//  Shown for teams made in the last 30 days only, so existing teams never see it.
// ─────────────────────────────────────────────────────────────────────────────
import { el } from './ui.js';
import { can } from './permissions.js';

const key = (teamId, uid, what) => 'tt_start_' + what + '_' + teamId + '_' + uid;
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };
/** Note that a step was done somewhere else in the app (invited, tools, shared). */
export function startFlag(teamId, uid, what) { set(key(teamId, uid, what), '1'); if (window.TTStartRefresh) window.TTStartRefresh(); }
export const NEW_TEAM_DAYS = 30;

/** The steps and whether each is done. s = the open team (session), uid = me. Pure apart from localStorage. */
export function startSteps(s, uid) {
  const flag = (w) => get(key(s.teamId, uid, w)) === '1';
  return [
    { id: 'tasks', title: 'Add your first tasks', help: 'Click “+ Add task” on the board, or bring in a spreadsheet, Trello or Jira export.', done: (s.tasks || []).length >= 3, action: 'Import a file' },
    { id: 'invite', title: 'Invite your team', help: 'Paste everyone’s emails; we email each person an invitation.', done: s.members.length > 1 || flag('invited'), action: 'Invite' },
    { id: 'tools', title: 'Pick the tools you need', help: 'Parts, finance, risks, notebook… switch on only what you’ll use.', done: flag('tools'), action: 'Choose tools' },
    { id: 'share', title: 'Share the week in your group chat', help: 'A summary of what’s done, due and stuck, ready for WhatsApp.', done: flag('shared'), action: 'Share' },
  ];
}
export function showStart(s, uid, now = Date.now()) {
  if (!s || !s.team || !s.me || !can(s.team, s.me, 'team.settings')) return false;
  const created = Number((s.rawTeam && s.rawTeam.createdAt) || s.team.createdAt || 0);
  if (!created || now - created > NEW_TEAM_DAYS * 864e5) return false;
  if (get(key(s.teamId, uid, 'hidden')) === '1') return false;
  return true;
}

/** Draw (or remove) the card. actions = { tasks(), invite(), tools(), share() } */
export function renderStart(s, uid, actions) {
  let card = document.getElementById('start-card');
  if (!showStart(s, uid)) { if (card) card.remove(); return; }
  const steps = startSteps(s, uid); const n = steps.filter(x => x.done).length;
  // Phones: start folded (a small pill), so the card never sits on top of the board.
  const pref = get(key(s.teamId, uid, 'folded'));
  const folded = pref === null ? window.matchMedia('(max-width: 700px)').matches : pref === '1';
  if (!card) { card = el('aside.start-card', { id: 'start-card', 'aria-label': 'Start here' }); (document.getElementById('board-screen') || document.body).append(card); }
  const hide = () => { set(key(s.teamId, uid, 'hidden'), '1'); card.remove(); };
  const fold = (v) => { set(key(s.teamId, uid, 'folded'), v ? '1' : '0'); renderStart(s, uid, actions); };
  card.classList.toggle('folded', folded);
  if (folded) {
    card.replaceChildren(el('button.start-pill', { type: 'button', id: 'start-open', onclick: () => fold(false) }, '🚀 Start here · ' + n + ' of ' + steps.length));
    return;
  }
  const all = n === steps.length;
  card.replaceChildren(
    el('div.start-head', {}, el('b', {}, all ? '🎉 Your team is set up' : '🚀 Start here'), el('span.start-count', {}, n + ' of ' + steps.length), el('span.spacer'),
      el('button.start-x', { type: 'button', title: 'Fold', 'aria-label': 'Fold', onclick: () => fold(true) }, '–'),
      el('button.start-x', { type: 'button', id: 'start-hide', title: 'Hide for good', 'aria-label': 'Hide for good', onclick: hide }, '✕')),
    el('div.start-bar', {}, el('i', { style: { width: Math.round(100 * n / steps.length) + '%' } })),
    el('ol.start-steps', {}, ...steps.map(st => el('li' + (st.done ? '.done' : ''), { dataset: { step: st.id } },
      el('span.start-tick', { 'aria-hidden': 'true' }, st.done ? '✓' : ''),
      el('div', {}, el('div.start-title', {}, st.title), st.done ? '' : el('div.start-help', {}, st.help)),
      st.done ? '' : el('button.btn.small', { type: 'button', onclick: () => actions[st.id] && actions[st.id]() }, st.action)))),
    all ? el('div.start-foot', {}, el('button.btn.small.primary', { type: 'button', onclick: hide }, 'Done — hide this')) : el('div.start-foot.hint', {}, 'Stuck? 💬 Send feedback from the side panel.'));
}
