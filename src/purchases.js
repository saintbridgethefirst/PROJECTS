// ─────────────────────────────────────────────────────────────────────────────
//  Purchase approvals (workflow step 3). With approvals on (Settings ▸ Workflow), a part costing
//  more than the team's limit can't be marked Ordered until a finance manager (or the team owner)
//  approves it. Approved parts count against their budget line straight away. The security rules
//  enforce the same thing (firestore.rules ▸ partApproval / purchaseOk / costKept).
// ─────────────────────────────────────────────────────────────────────────────
import { el, modal, toast } from './ui.js';
import { formatMoney, currencyOf, newId, cleanApproval, cleanLogEntry, cleanPurchase, partTotal, needsApproval, isApproved, canApprovePurchase } from './model.js';

const fmt = (s, n) => formatMoney(n, currencyOf(s && s.team, s && s.budget));
const q = (t) => '“' + t + '”';

export const purchaseOf = (s) => cleanPurchase(s && s.team && s.team.purchase);
export const purchaseOn = (s) => purchaseOf(s).on;
/** Parts whose approval is waiting: everyone's, and the ones `me` can decide. */
export function waitingPurchases(s) {
  const all = ((s && s.parts) || []).filter(p => p.approval && p.approval.status === 'waiting' && p.status !== 'cancelled')
    .sort((a, b) => a.approval.at - b.approval.at);
  return { all, mine: all.filter(p => canApprovePurchase(s.team, s.me, p)) };
}
/** Why this part can't be ordered yet ('' when it can). */
export function orderBlock(s, part) {
  if (!purchaseOn(s) || !needsApproval(part, s.team.purchase) || isApproved(part)) return '';
  const st = part.approval && part.approval.status;
  return st === 'waiting' ? 'It’s waiting for approval.' : st === 'declined' ? 'Its approval was declined.' : 'Orders over ' + fmt(s, purchaseOf(s).over) + ' need approving first.';
}

function logOp(ctx, text) {
  const { id, ...data } = cleanLogEntry({ at: Date.now(), by: ctx.user.uid, byName: ctx.user.name || '', kind: 'parts', text: text.slice(0, 600) });
  return { type: 'set', path: 'financeLog/' + newId('fl'), data };
}
/** Ask for approval to buy this part, in your own name. */
export async function askApproval(ctx, part, note = '') {
  const s = ctx.session; const amount = partTotal(part);
  const approval = cleanApproval({ status: 'waiting', by: ctx.user.uid, byName: ctx.user.name || '', at: Date.now(), amount, note: '' });
  const ops = [{ type: 'update', path: 'parts/' + part.id, data: { approval, updatedAt: Date.now() } }, logOp(ctx, 'Approval asked for ' + q(part.name) + ' (' + fmt(s, amount) + ')' + (note ? ': ' + note : ''))];
  return ctx.writeOps(ops);
}
/** Approve or decline a waiting request. Declining needs a note saying why. */
export async function decidePurchase(ctx, part, status, note = '') {
  const s = ctx.session; const a = part.approval;
  if (!a || !canApprovePurchase(s.team, s.me, part)) return false;
  const approval = cleanApproval({ ...a, status, approver: ctx.user.uid, approverName: ctx.user.name || '', note: String(note || '').slice(0, 500), decidedAt: Date.now() });
  const ops = [{ type: 'update', path: 'parts/' + part.id, data: { approval, updatedAt: Date.now() } },
    logOp(ctx, (status === 'approved' ? 'Approved ' : 'Declined ') + q(part.name) + ' (' + fmt(s, a.amount || partTotal(part)) + ') for ' + (a.byName || 'someone') + (note ? ': ' + note : ''))];
  return ctx.writeOps(ops);
}
/** Decline with a note (asked for in a small dialog). Resolves true when declined. */
export function declineDialog(ctx, part) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal('Decline “' + part.name + '”', { narrow: true, onClose: () => { if (!done) resolve(false); } });
    m.box.id = 'pa-decline-modal';
    const note = el('textarea', { id: 'pa-decline-note', rows: 3, maxlength: 500, placeholder: 'e.g. Too dear: try the 3D-printed version first', 'aria-label': 'Why it’s declined' });
    m.body.append(el('p.hint', {}, (part.approval && part.approval.byName ? part.approval.byName + ' sees' : 'They see') + ' this note, so they know what to change.'), note);
    m.foot.append(el('span.spacer'), el('button.btn.small.danger', { type: 'button', id: 'pa-decline-save', onclick: async () => {
      const text = note.value.trim(); if (!text) { toast('Say why it’s declined.'); note.focus(); return; }
      done = true; m.close(); resolve(await decidePurchase(ctx, part, 'declined', text));
    } }, 'Decline'));
    setTimeout(() => note.focus(), 30);
  });
}
/** One-line description for lists and the weekly share. */
export function purchaseLine(s, p) {
  return p.name + (p.qty > 1 ? ' × ' + p.qty : '') + ' · ' + fmt(s, partTotal(p)) + (p.supplier ? ' · ' + p.supplier : '');
}
export { fmt as purchaseMoney };
