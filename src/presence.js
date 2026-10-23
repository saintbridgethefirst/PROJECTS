// ─────────────────────────────────────────────────────────────────────────────
//  Who's here: who has the team open right now (like Google Docs), which task
//  they're looking at, and a status each person sets (Available / Busy / Away,
//  with a short note and an optional end time).
//  Stored per person in teams/{t}/presence/{uid}. A heartbeat every 2 minutes
//  while the tab is visible keeps "online" fresh (cheap: one small write).
// ─────────────────────────────────────────────────────────────────────────────
import { el, modal, avatar } from './ui.js';
import { cursorsOn, setCursorsOn, colorFor } from './cursors.js';
import { cleanPresence, isOnline, statusOf, PRESENCE_STATES, PRESENCE_LABEL } from './model.js';

const BEAT_MS = 2 * 60e3;
let state = { ctx: null, timer: 0, lastTask: '', lastWrite: 0, mine: null, bound: false };

/** Start (or restart, for a new team) the heartbeat. ctx() gives the current app context. */
export function startPresence(getCtx) {
  state.getCtx = getCtx; stopTimer();
  beat(true);
  state.timer = setInterval(() => { if (document.visibilityState === 'visible') beat(); }, BEAT_MS);
  if (!state.bound) {
    state.bound = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(true); else leave(); });
    window.addEventListener('pagehide', leave);
  }
}
function stopTimer() { clearInterval(state.timer); state.timer = 0; }
export function stopPresence() { leave(); stopTimer(); }

function myDoc(ctx) { const s = ctx.session; return cleanPresence((s.presence || []).find(p => p.id === ctx.user.uid) || {}, ctx.user.uid); }
function write(ctx, data) {
  const s = ctx.session; if (!s || !s.me) return;
  const cur = myDoc(ctx);
  const doc = { at: Date.now(), state: cur.state, note: cur.note, until: cur.until, taskId: cur.taskId, ...data };
  state.lastWrite = Date.now();
  return ctx.writeOps([{ type: 'set', path: 'presence/' + ctx.user.uid, data: doc }], { quiet: true, auto: true });
}
function beat(now) {
  const ctx = state.getCtx && state.getCtx(); if (!ctx || !ctx.session || !ctx.session.booted) return;
  if (!now && Date.now() - state.lastWrite < BEAT_MS - 5000) return;
  write(ctx, { taskId: state.lastTask });
}
function leave() {
  const ctx = state.getCtx && state.getCtx(); if (!ctx || !ctx.session || !ctx.session.me) return;
  // The demo keeps everything in this browser's storage: a closing tab must not write its (older) copy back.
  if (window.TT && window.TT.isDemo) return;
  write(ctx, { at: 0, taskId: '' });
}
/** The editor opened (or closed) a task: tell the others (a few seconds at most later). */
export function lookingAt(taskId) {
  taskId = taskId || '';
  if (taskId === state.lastTask) return;
  state.lastTask = taskId;
  clearTimeout(state.lookT);
  state.lookT = setTimeout(() => { const ctx = state.getCtx && state.getCtx(); if (ctx && ctx.session) write(ctx, { taskId: state.lastTask }); }, Math.max(400, 3000 - (Date.now() - state.lastWrite)));
}

/** People with their presence, online first. */
export function whoIsHere(s, now = Date.now()) {
  if (!s) return [];
  const byId = new Map((s.presence || []).map(p => [p.id, p]));
  return (s.members || []).map(m => {
    const p = cleanPresence(byId.get(m.uid) || {}, m.uid);
    return { uid: m.uid, name: m.name || m.email || 'Member', photo: m.photo, guest: m.roleId === 'guest', online: isOnline(p, now), status: statusOf(p, now), note: p.until && p.until < now ? '' : p.note, until: p.until, taskId: isOnline(p, now) ? p.taskId : '' };
  }).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
}

const DOT = { free: 'pr-free', busy: 'pr-busy', away: 'pr-away', '': '' };
/** Top bar: faces of who's online now, and dots on people's rows and on cards being looked at. */
export function paintPresence(ctx) {
  const s = ctx && ctx.session; if (!s || !s.me) return;
  const people = whoIsHere(s); const me = ctx.user.uid;
  const btn = document.getElementById('online-btn');
  if (btn) {
    const on = people.filter(p => p.online);
    const faces = el('span.online-faces', {}, ...on.slice(0, 4).map(p => { const a = avatar(p); a.classList.add('online-face'); if (DOT[p.status]) a.classList.add(DOT[p.status]); a.title = p.name + (p.guest ? ' (guest)' : '') + (p.status ? ' · ' + PRESENCE_LABEL[p.status] : ''); return a; }));
    const mine = people.find(p => p.uid === me) || {};
    btn.replaceChildren(faces, el('span.online-count', {}, on.length > 4 ? '+' + (on.length - 4) : ''), el('span.lbl-md', {}, ' ' + on.length + ' online'));
    btn.title = on.length + ' online now' + (mine.status ? ' · you: ' + PRESENCE_LABEL[mine.status] : '') + ' · click to set your status';
    btn.setAttribute('aria-label', btn.title);
  }
  // People's rows on the board
  people.forEach(p => {
    const row = document.getElementById(p.uid); if (!row || !row.classList.contains('node-person')) return;
    row.dataset.presence = p.online ? (p.status || 'free') : (p.status === 'away' ? 'away' : 'off');
    // Guests (people from outside the team) carry a small tag so everyone knows who can see the board.
    const tag = row.querySelector('.guest-tag');
    if (p.guest && !tag) (row.querySelector(':scope > span') || row).append(el('span.guest-tag', { title: 'Guest: from outside the team' }, 'Guest'));
    else if (!p.guest && tag) tag.remove();
    row.title = p.name + ': ' + (p.online ? 'online' : 'offline') + (p.status ? ' · ' + PRESENCE_LABEL[p.status] : '') + (p.note ? ' · ' + p.note : '');
  });
  // Cards someone else has open right now
  document.querySelectorAll('.task-card .viewers').forEach(n => n.remove());
  document.querySelectorAll('.peer-open').forEach(n => { n.classList.remove('peer-open'); n.style.removeProperty('--peer'); n.removeAttribute('data-peer'); });
  const looking = new Map();
  people.filter(p => p.online && p.taskId && p.uid !== me).forEach(p => { const l = looking.get(p.taskId) || []; l.push(p); looking.set(p.taskId, l); });
  looking.forEach((list, taskId) => {
    // A soft glow in that person's colour, on the board and in Kanban, so nobody edits it at the same time by accident.
    const col = colorFor(list[0].uid);
    [document.getElementById(taskId), document.getElementById('kb-' + taskId)].forEach(c => { if (!c) return; c.classList.add('peer-open'); c.style.setProperty('--peer', col); c.dataset.peer = list.map(p => p.name.split(' ')[0]).join(', '); });
    const card = document.getElementById(taskId); if (!card) return;
    const v = el('span.viewers', { title: list.map(p => p.name).join(', ') + (list.length === 1 ? ' has' : ' have') + ' this open' }, ...list.slice(0, 3).map(p => { const a = avatar(p); a.style.borderColor = colorFor(p.uid); return a; }));
    card.appendChild(v);
  });
}

/** The list of everyone, and setting my own status. */
export function openPresence(ctx) {
  const s = ctx.session; if (!s) return;
  const m = modal('Who’s here', { narrow: true }); m.box.id = 'presence-modal';
  const draw = () => {
    const people = whoIsHere(s); const mine = myDoc(ctx);
    const choose = (st) => el('button.pr-choice' + (mine.state === st ? '.on' : ''), { type: 'button', 'data-state': st, onclick: async () => { await write(ctx, { state: st, until: st ? untilSel.value === 'today' ? endOfDay() : untilSel.value === '1h' ? Date.now() + 36e5 : untilSel.value === '2h' ? Date.now() + 72e5 : 0 : 0 }); setTimeout(draw, 50); } },
      el('i.pr-dot.' + (DOT[st] || 'pr-auto')), st ? PRESENCE_LABEL[st] : 'Automatic');
    const untilSel = el('select', { id: 'pr-until', 'aria-label': 'For how long' }, ...[['', 'until I change it'], ['1h', 'for 1 hour'], ['2h', 'for 2 hours'], ['today', 'until the end of today']].map(([v, l]) => el('option', { value: v }, l)));
    const note = el('input.inp', { id: 'pr-note', maxlength: 80, value: mine.note || '', placeholder: 'What are you up to? (optional) e.g. In the lab till 4' });
    note.addEventListener('change', () => write(ctx, { note: note.value.trim().slice(0, 80) }));
    const list = el('div.pr-list', {}, ...people.map(p => {
      const t = p.taskId && (s.tasks || []).find(x => x.id === p.taskId);
      return el('div.pr-row', { 'data-uid': p.uid }, (() => { const a = avatar(p); a.classList.add('online-face'); if (p.online) a.classList.add(DOT[p.status] || 'pr-free'); return a; })(),
        el('span.pr-who', {}, el('b', {}, p.name + (p.uid === ctx.user.uid ? ' (you)' : ''), p.guest ? el('span.guest-tag', {}, 'Guest') : ''),
          el('span.hint', {}, (p.online ? 'Online' : 'Offline') + (p.status ? ' · ' + PRESENCE_LABEL[p.status] : '') + (p.until && p.status ? ' until ' + new Date(p.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '') + (p.note ? ' · “' + p.note + '”' : '')),
          t ? el('button.link-btn.pr-task', { type: 'button', onclick: () => { m.close(); window.boardOpenTask && window.boardOpenTask(t.id); } }, '👀 ' + (t.name || 'a task')) : ''));
    }));
    m.body.replaceChildren(el('h4', {}, 'My status'), el('div.pr-choices', {}, ...['', ...PRESENCE_STATES].map(choose)), el('div.row', { style: { gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, untilSel, note),
      el('label.pr-cursors', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' } },
        el('input', { type: 'checkbox', id: 'pr-cursors', checked: cursorsOn(), onchange: (e) => setCursorsOn(e.target.checked) }),
        el('span', {}, 'Live cursors: see where teammates are pointing, and show mine')),
      el('h4', { style: { marginTop: '16px' } }, 'Team'), list);
  };
  m.box.__draw = draw; draw();
  return m;
}
function endOfDay() { const d = new Date(); d.setHours(23, 59, 0, 0); return d.getTime(); }
export function refreshPresenceModal() { const m = document.getElementById('presence-modal'); const a = document.activeElement; if (m && m.__draw && !(a && m.contains(a) && a.tagName === 'INPUT')) m.__draw(); }
