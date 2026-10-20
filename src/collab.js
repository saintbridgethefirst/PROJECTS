// ─────────────────────────────────────────────────────────────────────────────
//  Team collaboration: comments on tasks, @mentions (with an unread badge),
//  the Activity panel (mentions + team activity feed) and "My tasks" across teams.
//  Comments are their own documents (teams/{t}/comments/{id}), so commenting on a
//  task never needs permission to edit the task itself.
// ─────────────────────────────────────────────────────────────────────────────
import { el, avatar, modal, toast } from './ui.js';
import { newId, findMentions, cleanComment, carryRoots, carryIndexOf } from './model.js';
import { LIMITS } from './config.js';

const PRIO_ICON = { Blocker: '⛔', Critical: '🔴', Major: '🟠', Minor: '🔽' };

// ── Which mentions I have already seen (per browser) ─────────────────────────
const seenKey = (uid) => 'tt_seen_mentions_' + uid;
function readSeen(uid) { try { return new Set(JSON.parse(localStorage.getItem(seenKey(uid))) || []); } catch { return new Set(); } }
function writeSeen(uid, set) { try { localStorage.setItem(seenKey(uid), JSON.stringify([...set].slice(-1500))); } catch { /* full */ } }
export function markSeen(uid, ids) {
  const s = readSeen(uid); let changed = false;
  ids.forEach(id => { if (!s.has(id)) { s.add(id); changed = true; } });
  if (changed) { writeSeen(uid, s); window.dispatchEvent(new CustomEvent('tt-mentions-seen')); }
  return changed;
}
/** Comments that mention me, written by someone else, that I haven't seen yet. */
export function unreadMentions(uid, comments) {
  const s = readSeen(uid);
  return (comments || []).filter(c => c.authorUid !== uid && (c.mentions || []).includes(uid) && !s.has(c.id));
}

// ── Time helpers ─────────────────────────────────────────────────────────────
export function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24); if (d < 7) return d === 1 ? 'yesterday' : d + ' days ago';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}
// History lines are stamped like "18/Oct/26 2:03 PM" (month name in the browser's language).
const MONTHS = (() => {
  const m = new Map(); ['en-GB', undefined].forEach(loc => { for (let i = 0; i < 12; i++) { try { m.set(new Date(2000, i, 1).toLocaleString(loc || 'default', { month: 'short' }).toLowerCase().replace('.', ''), i); } catch { /* */ } } });
  return m;
})();
export function parseStamp(s) {
  const r = /^(\d{1,2})\/([^/]+)\/(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/i.exec(String(s || '').trim()); if (!r) return 0;
  const mon = MONTHS.get(r[2].toLowerCase().replace('.', '')); if (mon === undefined) return 0;
  let h = +r[4] % 12; if (/pm/i.test(r[6])) h += 12;
  return new Date(2000 + +r[3], mon, +r[1], h, +r[5]).getTime();
}
function dayLabel(ms) {
  const d = new Date(ms); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

// ── Comment text: @mentions highlighted, links clickable, never raw HTML ─────
function commentBody(text, mentionNames) {
  const box = el('div.cm-text');
  const names = [...mentionNames].filter(Boolean).sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp('(https?://[^\\s<>"]+)' + (names.length ? '|(@(?:' + names.join('|') + '))' : ''), 'giu');
  let last = 0; let m; const s = String(text || '');
  while ((m = re.exec(s))) {
    if (m.index > last) box.append(s.slice(last, m.index));
    if (m[1]) box.append(el('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer' }, m[1]));
    else box.append(el('span.mention', {}, m[2]));
    last = m.index + m[0].length;
  }
  if (last < s.length) box.append(s.slice(last));
  return box;
}

// ── The composer with @-autocomplete ─────────────────────────────────────────
function composer({ members, placeholder, initial = '', submitLabel = 'Comment', onSubmit, onCancel, onDraft }) {
  const ta = el('textarea.cm-input', { rows: 2, maxlength: LIMITS.commentChars, placeholder, 'aria-label': placeholder });
  ta.value = initial;
  const pop = el('div.mention-pop', { role: 'listbox', hidden: true });
  const send = el('button.btn.small.primary', { type: 'button' }, submitLabel);
  const row = el('div.cm-actions', {}, el('span.hint', {}, 'Type @ to mention someone'), el('span.spacer'));
  if (onCancel) row.append(el('button.btn.small.ghost', { type: 'button', onclick: onCancel }, 'Cancel'));
  row.append(send);
  const wrap = el('div.cm-composer', {}, el('div.cm-field', {}, ta, pop), row);
  let matches = [], active = 0, tokenStart = -1;
  const close = () => { pop.hidden = true; matches = []; tokenStart = -1; };
  function update() {
    const caret = ta.selectionStart; const before = ta.value.slice(0, caret);
    const m = /(^|[\s(])@([^\s@]{0,30})$/.exec(before);
    if (!m) return close();
    const q = m[2].toLowerCase(); tokenStart = caret - m[2].length - 1;
    matches = members.filter(p => (p.name || '').toLowerCase().split(/\s+/).some(w => w.startsWith(q)) || (p.name || '').toLowerCase().startsWith(q) || (p.email || '').toLowerCase().startsWith(q)).slice(0, 6);
    if (!matches.length) return close();
    active = Math.min(active, matches.length - 1);
    pop.replaceChildren(...matches.map((p, i) => el('button.mention-opt' + (i === active ? '.on' : ''), { type: 'button', role: 'option', onmousedown: (e) => { e.preventDefault(); pick(i); } },
      avatar(p), el('span', {}, el('b', {}, p.name || p.email), el('span.hint', {}, ' ' + (p.email || ''))))));
    pop.hidden = false;
  }
  function pick(i) {
    const p = matches[i]; if (!p || tokenStart < 0) return;
    const caret = ta.selectionStart; const ins = '@' + (p.name || p.email.split('@')[0]) + ' ';
    ta.value = ta.value.slice(0, tokenStart) + ins + ta.value.slice(caret);
    const pos = tokenStart + ins.length; ta.setSelectionRange(pos, pos); close(); ta.focus();
  }
  async function submit() {
    const text = ta.value.trim(); if (!text) { ta.focus(); return; }
    send.disabled = true;
    try { if (await onSubmit(text) !== false) { ta.value = ''; close(); onDraft && onDraft(''); } } finally { send.disabled = false; }
  }
  ta.addEventListener('input', () => { active = 0; update(); onDraft && onDraft(ta.value); });
  ta.addEventListener('click', update);
  ta.addEventListener('blur', () => setTimeout(close, 150));
  ta.addEventListener('keydown', (e) => {
    if (!pop.hidden && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % matches.length; update(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; update(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(active); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    e.stopPropagation();   // keep board shortcuts (Delete, Ctrl+Z…) out of the text box
  });
  send.addEventListener('click', submit);
  return { wrap, ta };
}

// ── Comments section in the task editor ──────────────────────────────────────
let mounted = null;   // { taskId, list, ctx }
const drafts = new Map();   // unsent text per task, so a refresh of the panel never loses it
export function commentSection(ctx, taskId) {
  const { session } = ctx;
  const sec = el('div.panel-section.comments-section', {}, el('h4', {}, 'Comments'));
  const list = el('div.cm-list');
  sec.append(list);
  mounted = { taskId, list, ctx };
  const members = session.members.map(m => ({ uid: m.uid, name: m.name, email: m.email, photo: m.photo }));
  if (ctx.TT.canComment()) {
    const c = composer({ members, placeholder: 'Write a comment…', initial: drafts.get(taskId) || '', onDraft: (v) => { if (v) drafts.set(taskId, v); else drafts.delete(taskId); }, onSubmit: (text) => addComment(ctx, taskId, text) });
    sec.append(c.wrap);
  } else sec.append(el('div.hint', {}, 'Your role can read comments but not add them.'));
  fillList();
  return sec;
}
/** Re-draw the open task's comments after a change from anyone. */
export function refreshComments() { if (mounted && mounted.list.isConnected) fillList(); else mounted = null; }
function fillList() {
  const { taskId, list, ctx } = mounted; const { session, user } = ctx;
  // Comments on any carried-forward copy of this task belong to the whole thread.
  const ids = new Set(carryIndexOf(session).ids(taskId));
  const comments = (session.comments || []).filter(c => ids.has(c.taskId)).sort((a, b) => a.createdAt - b.createdAt);
  list.replaceChildren();
  if (!comments.length) { list.append(el('div.hint', {}, 'No comments yet. Ask a question, share an update, or @mention a teammate.')); return; }
  const unread = new Set(unreadMentions(user.uid, comments).map(c => c.id));
  comments.forEach(c => list.append(commentItem(ctx, c, unread.has(c.id), c.taskId === taskId ? '' : weekOfTask(session, c.taskId))));
  if (unread.size) markSeen(user.uid, [...unread]);
}
function weekOfTask(s, id) { const t = (s.tasks || []).find(x => x.id === id); const w = t && (s.team.weeks || []).find(x => x.key === t.weekId); return w ? w.title : 'an earlier week'; }
function commentItem(ctx, c, isNew, fromWeek = '') {
  const { session, user } = ctx;
  const author = session.members.find(m => m.uid === c.authorUid) || { name: c.authorName || 'Former member' };
  const names = c.mentions.map(uid => { const m = session.members.find(x => x.uid === uid); return m && (m.name || (m.email || '').split('@')[0]); });
  const item = el('div.cm-item' + (isNew ? '.cm-new' : '') + (c.mentions.includes(user.uid) ? '.cm-me' : ''), { dataset: { commentId: c.id } });
  const head = el('div.cm-head', {}, avatar(author), el('b', {}, author.name || c.authorName), el('span.cm-time', { title: new Date(c.createdAt).toLocaleString() }, timeAgo(c.createdAt) + (c.editedAt ? ' · edited' : '')), fromWeek ? el('span.cmt-from', { title: 'Written on this task’s copy in ' + fromWeek }, '↪ ' + fromWeek) : '');
  const body = commentBody(c.text, names);
  item.append(head, body);
  const mine = c.authorUid === user.uid;
  if (mine || ctx.TT.can('members.manage')) {
    const acts = el('div.cm-tools');
    if (mine) acts.append(el('button.link-btn', { type: 'button', onclick: () => {
      const members = session.members.map(m => ({ uid: m.uid, name: m.name, email: m.email, photo: m.photo }));
      const ed = composer({ members, placeholder: 'Edit comment', initial: c.text, submitLabel: 'Save', onCancel: () => fillList(),
        onSubmit: async (text) => { const ok = await editComment(ctx, c, text); if (ok) fillList(); return ok; } });
      body.replaceWith(ed.wrap); acts.remove(); ed.ta.focus();
    } }, 'Edit'));
    acts.append(el('button.link-btn.danger', { type: 'button', onclick: () => { if (confirm('Delete this comment?')) ctx.writeOps([{ type: 'delete', path: 'comments/' + c.id }]); } }, 'Delete'));
    head.append(acts);
  }
  return item;
}
async function addComment(ctx, taskId, text) {
  const { session, user } = ctx;
  const mentions = findMentions(text, session.members);
  const data = { taskId, authorUid: user.uid, authorName: (user.name || user.email || '').slice(0, 80), text: text.slice(0, LIMITS.commentChars), mentions, createdAt: Date.now() };
  const ok = await ctx.writeOps([{ type: 'set', path: 'comments/' + newId('cm'), data }]);
  if (ok && mentions.filter(u => u !== user.uid).length) {
    const who = mentions.filter(u => u !== user.uid).map(u => (session.members.find(m => m.uid === u) || {}).name).filter(Boolean);
    toast('Comment posted. ' + who.join(', ') + ' will see it in their mentions.');
  }
  return ok;
}
async function editComment(ctx, c, text) {
  const mentions = findMentions(text, ctx.session.members);
  return ctx.writeOps([{ type: 'update', path: 'comments/' + c.id, data: { text: text.slice(0, LIMITS.commentChars), mentions, editedAt: Date.now() } }]);
}

// ── Activity panel: my mentions + what the team has been doing ───────────────
export function buildFeed(session) {
  const tasks = new Map((session.tasks || []).map(t => [t.id, t]));
  const weeks = new Map((session.team.weeks || []).map(w => [w.key, w.title]));
  const out = [];
  (session.tasks || []).forEach(t => {
    const n = t.history.length;
    t.history.forEach((h, i) => {
      // Newest entries come first; entries we can't date fall back to the task's last update.
      const at = parseStamp(h.time) || (i === 0 ? t.updatedAt : 0) || (t.createdAt + (n - i));
      out.push({ kind: /^created\b/i.test(h.updated || '') ? 'created' : 'change', at, who: h.user || 'Someone', taskId: t.id, task: t.name, week: weeks.get(t.weekId) || '', field: h.field, from: h.original, to: h.updated });
    });
    if (t.createdAt && !t.history.some(h => /created|duplicated|imported/i.test(h.updated || ''))) {
      const author = (session.members.find(m => m.uid === t.createdBy) || {}).name || '';
      if (author) out.push({ kind: 'created', at: t.createdAt, who: author, taskId: t.id, task: t.name, week: weeks.get(t.weekId) || '' });
    }
  });
  (session.comments || []).forEach(c => {
    const t = tasks.get(c.taskId); if (!t) return;
    out.push({ kind: 'comment', at: c.createdAt, who: c.authorName, whoUid: c.authorUid, taskId: c.taskId, task: t.name, week: weeks.get(t.weekId) || '', text: c.text, comment: c });
  });
  return out.filter(e => e.at).sort((a, b) => b.at - a.at);
}

export function openActivity(ctx, tab = 'mentions') {
  const { session, user } = ctx; if (!session) return;
  let current = tab, person = 'all';
  const m = modal('Activity'); m.foot.remove();
  const tabs = el('div.act-tabs', { role: 'tablist' });
  const pane = el('div.act-pane');
  m.body.append(tabs, pane);
  const go = (taskId) => { m.close(); window.boardOpenTask && window.boardOpenTask(taskId); };

  function render() {
    const live = new Set(session.tasks.map(t => t.id));
    const unread = unreadMentions(user.uid, session.comments).filter(c => live.has(c.taskId));
    tabs.replaceChildren(
      el('button.act-tab' + (current === 'mentions' ? '.on' : ''), { type: 'button', role: 'tab', onclick: () => { current = 'mentions'; render(); } }, '@ Mentions', unread.length ? el('span.count-badge', {}, String(unread.length)) : ''),
      el('button.act-tab' + (current === 'activity' ? '.on' : ''), { type: 'button', role: 'tab', onclick: () => { current = 'activity'; render(); } }, 'Team activity'));
    pane.replaceChildren();
    if (current === 'mentions') renderMentions(unread); else renderFeed();
  }
  function renderMentions(unread) {
    const tasks = new Map(session.tasks.map(t => [t.id, t]));
    const mine = (session.comments || []).filter(c => c.mentions.includes(user.uid) && c.authorUid !== user.uid && tasks.has(c.taskId));
    const isNew = new Set(unread.map(c => c.id));
    if (isNew.size) pane.append(el('div.row', { style: { marginBottom: '10px' } }, el('span.hint', {}, isNew.size + ' unread'), el('span.spacer'),
      el('button.btn.small', { type: 'button', onclick: () => { markSeen(user.uid, [...isNew]); render(); } }, 'Mark all as read')));
    if (!mine.length) { pane.append(el('div.empty-state', {}, 'Nobody has mentioned you yet. When a teammate writes @' + (user.name || 'your name') + ' in a comment, it shows up here.')); return; }
    mine.forEach(c => {
      const t = tasks.get(c.taskId);
      pane.append(el('button.act-item' + (isNew.has(c.id) ? '.unread' : ''), { type: 'button', onclick: () => { markSeen(user.uid, [c.id]); go(c.taskId); } },
        avatar(session.members.find(x => x.uid === c.authorUid) || { name: c.authorName }),
        el('span.act-main', {}, el('span', {}, el('b', {}, c.authorName), ' mentioned you on ', el('b', {}, t.name)),
          el('span.act-quote', {}, c.text.length > 220 ? c.text.slice(0, 220) + '…' : c.text),
          el('span.act-time', {}, timeAgo(c.createdAt)))));
    });
  }
  function renderFeed() {
    const feed = buildFeed(session);
    const people = [...new Set(feed.map(e => e.who))].sort();
    const sel = el('select', { 'aria-label': 'Filter by person', onchange: (e) => { person = e.target.value; renderFeed(); } },
      el('option', { value: 'all' }, 'Everyone'), ...people.map(p => el('option', { value: p, selected: p === person }, p)));
    pane.replaceChildren(el('div.row', { style: { marginBottom: '10px' } }, el('span.hint', {}, 'Changes to tasks and new comments, newest first.'), el('span.spacer'), sel));
    const rows = feed.filter(e => person === 'all' || e.who === person).slice(0, 200);
    if (!rows.length) { pane.append(el('div.empty-state', {}, 'Nothing has happened yet.')); return; }
    let day = '';
    rows.forEach(e => {
      const d = dayLabel(e.at); if (d !== day) { day = d; pane.append(el('div.act-day', {}, d)); }
      let what; let quote = '';
      if (e.kind === 'comment') { what = [' commented on ', el('b', {}, e.task)]; quote = el('span.act-quote', {}, e.text.length > 160 ? e.text.slice(0, 160) + '…' : e.text); }
      else if (e.kind === 'created') what = [' added ', el('b', {}, e.task)];
      else what = [' ', describeChange(e), ' · ', el('b', {}, e.task)];
      pane.append(el('button.act-item.compact', { type: 'button', onclick: () => go(e.taskId) },
        el('span.act-clock', {}, new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })),
        el('span.act-main', {}, el('span', {}, el('b', {}, e.who), ...what), quote, e.week ? el('span.act-time', {}, e.week) : '')));
    });
  }
  render();
  if (tab === 'mentions') { /* opening the list counts as seeing it once the user picks or marks read */ }
  return m;
}
function describeChange(e) {
  const f = String(e.field || 'Change'); const lf = f.toLowerCase();
  if (lf.startsWith('sub-task')) return f.toLowerCase() + ' “' + (e.to || e.from) + '”';
  if (lf === 'action' || lf === 'moved') return lf === 'moved' ? 'moved it from ' + (e.from || '?') + ' to ' + (e.to || '?') : (e.to || 'changed');
  if (e.from && e.to) return 'changed ' + lf + ' from “' + e.from + '” to “' + e.to + '”';
  if (e.to) return 'set ' + lf + ' to “' + e.to + '”';
  return 'cleared ' + lf;
}

// ── Home: "My tasks" across every team ──────────────────────────────────────
function daysTo(iso) {
  if (!iso) return null; const [y, mo, d] = iso.split('-').map(Number);
  const t = new Date(); const a = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()); return Math.round((Date.UTC(y, mo - 1, d) - a) / 86400000);
}
function dueText(days) {
  if (days === null) return 'No deadline';
  if (days < 0) return (-days) + (days === -1 ? ' day' : ' days') + ' overdue';
  if (days === 0) return 'Due today'; if (days === 1) return 'Due tomorrow';
  return 'Due in ' + days + ' days';
}
export function renderMyTasks(box, work, uid, { showDone = false, onToggle, onOpen }) {
  const rows = [];
  work.forEach(w => {
    const weeks = new Map((w.team.weeks || []).map(x => [x.key, x.title]));
    const phases = new Map((w.team.phases || []).map(p => [p.id, p]));
    // A task carried forward across weeks is one piece of work: show only its latest copy.
    const order = new Map((w.team.weeks || []).map((x, i) => [x.key, i]));
    const roots = carryRoots(w.tasks.map(t => ({ id: t.id, carryOf: t.carryOf || '', name: t.name, cat: t.categoryId, weekIdx: order.has(t.weekId) ? order.get(t.weekId) : -1, history: t.history })));
    const latest = new Map(); w.tasks.forEach(t => { const r = roots.get(t.id) || t.id; const b = latest.get(r); if (!b || (order.get(t.weekId) ?? -1) > (order.get(b.weekId) ?? -1)) latest.set(r, t); });
    const chainLen = new Map(); w.tasks.forEach(t => { const r = roots.get(t.id) || t.id; chainLen.set(r, (chainLen.get(r) || 0) + 1); });
    w.tasks.filter(t => latest.get(roots.get(t.id) || t.id) === t).forEach(t => rows.push({ carry: chainLen.get(roots.get(t.id) || t.id), t, teamId: w.teamId, team: w.team.name || 'Team', week: weeks.get(t.weekId), phase: phases.get(t.phaseId), days: daysTo(t.dueDate), done: t.flag === 'completed', support: t.ownerUid !== uid }));
  });
  const live = rows.filter(r => r.week !== undefined);
  const open = live.filter(r => !r.done); const done = live.filter(r => r.done);
  box.replaceChildren();
  const head = el('div.row.mt-head', {}, el('span.hint', {}, open.length ? open.length + ' open across ' + new Set(open.map(r => r.teamId)).size + (new Set(open.map(r => r.teamId)).size === 1 ? ' team' : ' teams') : 'Nothing open — nice.'), el('span.spacer'));
  if (done.length) head.append(el('label.row.hint', { style: { gap: '6px' } }, el('input', { type: 'checkbox', checked: showDone, onchange: (e) => onToggle(e.target.checked) }), 'Show completed (' + done.length + ')'));
  box.append(head);
  const groups = [
    ['Overdue', open.filter(r => r.days !== null && r.days < 0), 'bad'],
    ['Due in the next 7 days', open.filter(r => r.days !== null && r.days >= 0 && r.days <= 7), 'warn'],
    ['Later', open.filter(r => r.days !== null && r.days > 7), ''],
    ['No deadline', open.filter(r => r.days === null), ''],
  ];
  if (showDone) groups.push(['Completed', done, 'good']);
  if (!live.length) { box.append(el('div.empty-state', {}, 'No tasks are assigned to you yet. Tasks in your rows on any board, and tasks where you’re the supporting person, show up here.')); return; }
  groups.forEach(([label, list, cls]) => {
    if (!list.length) return;
    list.sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9) || a.t.name.localeCompare(b.t.name));
    box.append(el('div.mt-group' + (cls ? '.' + cls : ''), {}, label + ' · ' + list.length));
    list.forEach(r => {
      const sub = (r.t.subtasks || []); const subDone = sub.filter(s => s.completed).length;
      box.append(el('button.mt-row' + (r.done ? '.done' : ''), { type: 'button', onclick: () => onOpen(r.teamId, r.t.id) },
        el('span.mt-prio', { title: r.t.priority }, PRIO_ICON[r.t.priority] || ''),
        el('span.mt-main', {}, el('span.mt-name', {}, r.t.name || 'Untitled task'),
          el('span.mt-meta', {}, el('span.pill', {}, r.team), r.week ? el('span', {}, r.week) : '', r.carry > 1 ? el('span.gt-carry', { title: 'Carried forward across ' + r.carry + ' weeks' }, '↪ ' + r.carry + ' wks') : '',
            r.phase ? el('span.phase-tag', { style: { '--phase': r.phase.color } }, r.phase.name) : '',
            r.support ? el('span.pill.blue', {}, 'Supporting') : '', sub.length ? el('span', {}, '☑ ' + subDone + '/' + sub.length) : '')),
        el('span.mt-due' + (r.done ? '' : (r.days !== null && r.days < 0 ? '.bad' : (r.days !== null && r.days <= 2 ? '.warn' : ''))), {}, r.done ? 'Done' : dueText(r.days))));
    });
  });
}

export { cleanComment };
