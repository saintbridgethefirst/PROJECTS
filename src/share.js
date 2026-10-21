// ─────────────────────────────────────────────────────────────────────────────
//  Share this week: the team's week as a short message for a group chat
//  (WhatsApp, Slack, Teams). Student teams live in group chats, not in apps, so
//  this brings the board to where they already are.
//
//  buildWeekShare() is pure (rows in, text out) so it can be tested; the window
//  only lets you choose whose work, tidy the text, and send it.
// ─────────────────────────────────────────────────────────────────────────────
import { el, modal, toast } from './ui.js';
import { cleanFeatures } from './model.js';
import { startFlag } from './start.js';

const DAY = 864e5;
const iso = (d) => d.toLocaleDateString('en-CA');
const addDays = (s, n) => iso(new Date(new Date(s + 'T12:00:00').getTime() + n * DAY));
const short = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const range = (a, b) => { const A = new Date(a + 'T12:00:00'), B = new Date(b + 'T12:00:00'); return A.getMonth() === B.getMonth() ? A.getDate() + '–' + short(b) : short(a) + ' – ' + short(b); };
export const MAX_ITEMS = 8;

/** The week to report: the team's week containing today, else the last 7 days. */
export function shareWeek(weeks, today) {
  const w = (weeks || []).find(x => x.startDate && x.startDate <= today && today <= addDays(x.startDate, 6));
  if (w) return { from: w.startDate, to: addDays(w.startDate, 6), label: (w.title || 'This week') + ' (' + range(w.startDate, addDays(w.startDate, 6)) + ')', key: w.key };
  return { from: addDays(today, -6), to: today, label: 'Last 7 days (' + range(addDays(today, -6), today) + ')', key: null };
}

/**
 * data = { team: {name, weeks}, rows (window.boardRows), today, url }
 * opts = { scopeLabel?: 'Payload', names: true }
 * Returns the message: WhatsApp formatting (*bold*), one line per task, at most MAX_ITEMS per list.
 */
export function buildWeekShare(data, opts = {}) {
  const { team, rows, today } = data; const names = opts.names !== false;
  const wk = shareWeek(team.weeks, today);
  const open = rows.filter(r => r.flag !== 'completed');
  const line = (r, extra) => '• ' + r.task + (names && r.person ? ' — ' + r.person : '') + (extra ? ' (' + extra + ')' : '');
  const list = (title, items, fmt) => {
    if (!items.length) return '';
    const shown = items.slice(0, MAX_ITEMS).map(fmt);
    if (items.length > MAX_ITEMS) shown.push('…and ' + (items.length - MAX_ITEMS) + ' more');
    return title + ' (' + items.length + ')\n' + shown.join('\n');
  };
  const done = rows.filter(r => r.flag === 'completed' && r.completedOn >= wk.from && r.completedOn <= wk.to);
  const doing = open.filter(r => r.stage === 'Doing' && !r.overdue);
  const overdue = open.filter(r => r.overdue).sort((a, b) => a.daysToDeadline - b.daysToDeadline);
  const soonTo = addDays(today, 7);
  const soon = open.filter(r => !r.overdue && r.deadline && r.deadline >= today && r.deadline <= soonTo).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const waiting = open.filter(r => (r.waitsOn || []).length && (r.waitIssues || []).length);
  const carried = open.filter(r => r.carryCount > 1);
  const total = rows.length, finished = rows.filter(r => r.flag === 'completed').length;
  const when = (r) => r.daysToDeadline === 0 ? 'today' : r.daysToDeadline === 1 ? 'tomorrow' : short(r.deadline);
  const parts = [
    '*' + team.name + (opts.scopeLabel ? ' · ' + opts.scopeLabel : '') + ' · ' + wk.label + '*',
    list('✅ *Done*', done, r => line(r)),
    list('🔄 *In progress*', doing, r => { const st = r.subtasks || []; return line(r, [r.stageName && r.stageName !== 'Doing' ? r.stageName : '', st.length ? st.filter(x => x.done).length + '/' + st.length + ' steps' : ''].filter(Boolean).join(', ')); }),
    list('⏰ *Due in the next 7 days*', soon, r => line(r, when(r))),
    list('⚠️ *Overdue*', overdue, r => line(r, -r.daysToDeadline + ' day' + (r.daysToDeadline === -1 ? '' : 's') + ' late')),
    list('⛔ *Waiting on other tasks*', waiting, r => line(r, 'waits on ' + r.waitsOn.slice(0, 2).join(', '))),
    carried.length ? '↪ ' + carried.length + ' task' + (carried.length === 1 ? '' : 's') + ' carried over from earlier weeks' : '',
  ].filter(Boolean);
  if (parts.length === 1) parts.push('A quiet week: nothing finished, due or late yet.');
  parts.push((total ? '📈 ' + finished + ' of ' + total + ' tasks done (' + Math.round(100 * finished / total) + '%)' : '') + (data.url ? (total ? '\n' : '') + '👉 ' + data.url : ''));
  return parts.filter(Boolean).join('\n\n');
}

/** WhatsApp's share link: opens the app (or WhatsApp Web) with the text ready to send to any chat. */
export const whatsappLink = (text) => 'https://wa.me/?text=' + encodeURIComponent(text);

export function openShareWeek(ctx) {
  const s = ctx.session; if (!s || !s.booted || !window.boardRows) return;
  const subteams = cleanFeatures(s.team.features).subteams ? (s.team.subteams || []) : [];
  const opts = { scope: 'all', names: true };
  const url = location.origin + location.pathname + '#/t/' + s.teamId;
  const m = modal('📣 Share this week', { narrow: true }); m.box.classList.add('share-modal');
  const text = el('textarea.share-text', { id: 'share-text', rows: 14, 'aria-label': 'Message to share' });
  const build = () => {
    const sub = opts.scope.startsWith('st:') ? subteams.find(g => 'st:' + g.id === opts.scope) : null;
    const rows = window.boardRows({ scope: 'all', allPhases: true });
    const mine = opts.scope === 'me' ? rows.filter(r => r.personId === ctx.user.uid) : sub ? rows.filter(r => sub.members.includes(r.personId)) : rows;
    text.value = buildWeekShare({ team: s.team, rows: mine, today: iso(new Date()), url }, { names: opts.names, scopeLabel: sub ? sub.name : opts.scope === 'me' ? (ctx.user.name || 'Me') : '' });
  };
  const scope = el('select', { id: 'share-scope', 'aria-label': 'Whose work', onchange: (e) => { opts.scope = e.target.value; build(); } },
    el('option', { value: 'all' }, 'The whole team'),
    subteams.length ? el('optgroup', { label: 'Sub-team' }, subteams.map(g => el('option', { value: 'st:' + g.id }, g.name))) : '',
    el('option', { value: 'me' }, 'Just my tasks'));
  const names = el('input', { type: 'checkbox', id: 'share-names', checked: true, onchange: (e) => { opts.names = e.target.checked; build(); } });
  const wa = el('a.btn.primary.share-wa', { id: 'share-whatsapp', href: '#', target: '_blank', rel: 'noopener', onclick: (e) => { e.currentTarget.href = whatsappLink(text.value); markShared(ctx); } }, 'Send to WhatsApp');
  const copy = el('button.btn', { type: 'button', id: 'share-copy', onclick: async () => {
    try { await navigator.clipboard.writeText(text.value); toast('Copied — paste it into your group chat.'); markShared(ctx); }
    catch { text.select(); toast('Select all and copy (Ctrl+C / ⌘C).'); }
  } }, 'Copy');
  const native = navigator.share ? el('button.btn', { type: 'button', id: 'share-native', onclick: async () => { try { await navigator.share({ text: text.value }); markShared(ctx); } catch { /* cancelled */ } } }, 'Share…') : '';
  m.body.append(
    el('p.hint', {}, 'Post the week in your team’s group chat: what got done, what’s due and what’s stuck. Edit the text before sending if you like.'),
    el('div.share-controls', {}, el('label.rs-field', {}, el('span', {}, 'Whose work'), scope), el('label.share-names', {}, names, ' Show names')),
    text);
  m.foot.append(el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Close'), el('span.spacer'), native, copy, wa);
  build();
  return { rebuild: build };
}
/** Remember that this person shared (ticks the start-here step). */
const markShared = (ctx) => startFlag(ctx.session.teamId, ctx.user.uid, 'shared');
