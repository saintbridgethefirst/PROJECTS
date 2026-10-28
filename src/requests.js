// People asking for things only an admin may do:
//  • leaving the team (the owner or a member manager approves and hands their open tasks on)
//  • deleting a task (someone who edits everyone's tasks approves)
// Requests live in teams/{t}/requests as leave-<uid> and del-<taskId>.
import { el, modal, toast } from './ui.js';
import { can, deleteNeedsApproval } from './permissions.js';
import { handOverOps, subteamsWithout } from './model.js';

const me = (ctx) => ctx.session.me;
const myName = (ctx) => String(ctx.user.name || ctx.user.email || 'Someone').slice(0, 80);
export const leaveOf = (s, uid) => (s.requests || []).find(r => r.id === 'leave-' + uid) || null;
export const deleteOf = (s, taskId) => (s.requests || []).find(r => r.id === 'del-' + taskId) || null;

/** What's waiting, and which of it I can decide. */
export function peopleRequests(s) {
  if (!s || !s.me) return { leave: [], del: [], mine: 0 };
  const live = new Set((s.tasks || []).map(t => t.id)); const members = new Set((s.members || []).map(m => m.uid));
  const rows = (s.requests || []).filter(r => r.kind === 'leave' || r.kind === 'delete').sort((a, b) => (a.at || 0) - (b.at || 0));
  const leave = rows.filter(r => r.kind === 'leave' && members.has(r.by)).map(r => ({ ...r, mine: can(s.team, s.me, 'members.manage') && r.by !== s.me.uid }));
  const del = rows.filter(r => r.kind === 'delete' && live.has(r.taskId)).map(r => ({ ...r, mine: can(s.team, s.me, 'tasks.editAll') && r.by !== s.me.uid }));
  return { leave, del, mine: leave.filter(r => r.mine).length + del.filter(r => r.mine).length };
}
export const needsDeleteApproval = (ctx, task) => !!ctx.session && deleteNeedsApproval(ctx.session.team, me(ctx), task);

// ── Leaving ────────────────────────────────────────────────────────────────
export function askToLeave(ctx) {
  const s = ctx.session; const open = (s.tasks || []).filter(t => t.ownerUid === ctx.user.uid && t.flag !== 'completed').length;
  const m = modal('Leave ' + s.team.name + '?', { narrow: true }); m.box.id = 'leave-ask';
  const note = el('textarea.inp', { id: 'leave-note', rows: 3, maxlength: 300, placeholder: 'Anything they should know (optional): why, who could take your tasks…' });
  m.body.append(
    el('p', {}, 'The team’s owner or an admin approves it. ', open ? el('b', {}, 'Your ' + open + ' open task' + (open === 1 ? '' : 's') + ' will be handed to someone else; ') : '', 'what you finished stays on the board under your name.'),
    el('label.field', {}, el('span', {}, 'Note'), note));
  m.foot.append(el('span.spacer'), el('button.btn.danger', { type: 'button', id: 'leave-send', onclick: async () => {
    const ok = await ctx.writeOps([{ type: 'set', path: 'requests/leave-' + ctx.user.uid, data: { kind: 'leave', by: ctx.user.uid, byName: myName(ctx), at: Date.now(), note: note.value.trim().slice(0, 300) } }]);
    if (ok) { m.close(); toast('Asked to leave. You’ll stay in the team until it’s approved.', 5000); }
  } }, 'Ask to leave'));
}
export async function cancelLeave(ctx) {
  if (await ctx.writeOps([{ type: 'delete', path: 'requests/leave-' + ctx.user.uid }])) toast('Leave request withdrawn.');
}

/** Approve: hand each open task to someone, remember the person's name, then remove them. */
export function approveLeave(ctx, req) {
  const s = ctx.session; const who = s.members.find(m => m.uid === req.by); if (!who) return;
  const others = s.members.filter(m => m.uid !== req.by && m.roleId !== 'viewer');
  const open = (s.tasks || []).filter(t => t.ownerUid === req.by && t.flag !== 'completed');
  const done = (s.tasks || []).filter(t => t.ownerUid === req.by && t.flag === 'completed').length;
  const m = modal('Approve: ' + (who.name || who.email) + ' leaves', { narrow: true }); m.box.id = 'leave-approve';
  const pick = (id, value) => el('select', { 'data-task': id, 'aria-label': 'New owner' }, ...others.map(o => el('option', { value: o.uid, selected: o.uid === value }, o.name || o.email)));
  const first = (others.find(o => o.uid === s.me.uid) || others[0] || {}).uid;
  const all = pick('', first);
  const rows = open.map(t => el('div.lv-row', {}, el('span.lv-name', {}, t.name || 'Untitled task'), pick(t.id, first)));
  all.addEventListener('change', () => rows.forEach(r => { r.querySelector('select').value = all.value; }));
  m.body.append(
    req.note ? el('blockquote.lv-note', {}, '“' + req.note + '”') : '',
    open.length
      ? el('div', {}, el('label.field', {}, el('span', {}, 'Hand all ' + open.length + ' open task' + (open.length === 1 ? '' : 's') + ' to'), all), el('details.lv-each', { open: open.length <= 6 }, el('summary', {}, 'Or choose for each task'), el('div.lv-list', {}, ...rows)))
      : el('p.hint', {}, 'They have no open tasks.'),
    el('p.hint', {}, (done ? done + ' finished task' + (done === 1 ? '' : 's') + ' and all' : 'All') + ' of their history stay on the board, shown as “' + (who.name || who.email) + ' (left)”.'));
  m.foot.append(el('button.btn.ghost', { type: 'button', onclick: () => { m.close(); declineRequest(ctx, req); } }, 'Decline'), el('span.spacer'),
    el('button.btn.primary', { type: 'button', id: 'leave-approve-go', onclick: async () => {
      if (open.length && !others.length) { toast('There’s nobody to hand their tasks to.'); return; }
      const plan = {}; open.forEach(t => { const sel = m.body.querySelector('select[data-task="' + t.id + '"]'); plan[t.id] = sel ? sel.value : all.value; });
      const names = Object.fromEntries(s.members.map(x => [x.uid, x.name || x.email]));
      const ops = handOverOps(s.tasks, s.categories || [], { uid: who.uid, name: who.name || who.email }, plan, { name: myName(ctx), names });
      ops.push({ type: 'update', path: 'team', data: { former: { ...(s.team.former || {}), [who.uid]: { name: (who.name || who.email || '').slice(0, 80), leftAt: Date.now() } }, ...(subteamsWithout(s.team, who.uid) || {}) } },
        { type: 'delete', path: 'members/' + who.uid }, { type: 'delete', path: 'presence/' + who.uid }, { type: 'delete', path: 'requests/' + req.id });
      if (await ctx.writeOps(ops)) { m.close(); toast((who.name || who.email) + ' has left' + (open.length ? '; their tasks were handed on.' : '.'), 5000); }
    } }, 'Approve and remove'));
}

// ── Deleting a task ───────────────────────────────────────────────────────
export function askToDelete(ctx, task) {
  const s = ctx.session; const had = deleteOf(s, task.id);
  if (had) { toast('Already asked: waiting for an admin to approve deleting it.', 5000, 'Withdraw', () => ctx.writeOps([{ type: 'delete', path: 'requests/' + had.id }])); return; }
  const m = modal('Ask to delete this task', { narrow: true }); m.box.id = 'del-ask';
  const note = el('textarea.inp', { id: 'del-note', rows: 3, maxlength: 300, placeholder: 'Why it should go (optional)' });
  m.body.append(el('p', {}, el('b', {}, task.name || 'Untitled task')),
    el('p.hint', {}, 'Tasks older than a day are deleted by the owner or an admin, so nobody’s work disappears by accident. They’ll see this in Approvals.'),
    el('label.field', {}, el('span', {}, 'Reason'), note));
  m.foot.append(el('span.spacer'), el('button.btn.danger', { type: 'button', id: 'del-send', onclick: async () => {
    const ok = await ctx.writeOps([{ type: 'set', path: 'requests/del-' + task.id, data: { kind: 'delete', by: ctx.user.uid, byName: myName(ctx), at: Date.now(), note: note.value.trim().slice(0, 300), taskId: task.id, taskName: String(task.name || '').slice(0, 200) } }]);
    if (ok) { m.close(); toast('Asked an admin to delete it.'); }
  } }, 'Ask to delete'));
}
export async function approveDelete(ctx, req) {
  if (!confirm('Delete “' + (req.taskName || 'this task') + '”? It can’t be undone.')) return;
  if (await ctx.writeOps([{ type: 'delete', path: 'tasks/' + req.taskId }, { type: 'delete', path: 'requests/' + req.id }])) toast('Deleted.');
}
export async function declineRequest(ctx, req) {
  if (await ctx.writeOps([{ type: 'delete', path: 'requests/' + req.id }])) toast(req.kind === 'leave' ? 'Leave request declined.' : 'Kept the task.');
}
