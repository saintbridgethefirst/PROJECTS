// ─────────────────────────────────────────────────────────────────────────────
//  Finance history: plain-English lines describing a change to the budget,
//  spending, income or parts. Pure functions (no DOM) so they can be tested.
//  `n` carries the lookups: { money(n), line(id), part(id), task(id), phase(id), status(s) }.
// ─────────────────────────────────────────────────────────────────────────────
import { partTotal, partExtras } from './model.js';

const q = (s) => '“' + s + '”';
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const list = (a) => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const join = (head, bits) => bits.length ? head + ': ' + bits.join('; ') : '';
const clip = (s) => s.length > 600 ? s.slice(0, 597) + '…' : s;

/** Changes between two budgets (currency, lines added, renamed, re-amounted, moved phase, removed). */
export function budgetChanges(before, after, n) {
  const out = [];
  if (before.currency !== after.currency) out.push('Currency changed from ' + before.currency + ' to ' + after.currency);
  const old = new Map(before.lines.map(l => [l.id, l]));
  after.lines.forEach(l => {
    const o = old.get(l.id);
    if (!o) { out.push('Added budget line ' + q(l.name) + (l.amount ? ' (' + n.money(l.amount) + ')' : '')); return; }
    if (o.name !== l.name) out.push('Renamed budget line ' + q(o.name) + ' to ' + q(l.name));
    if (r2(o.amount) !== r2(l.amount)) out.push(q(l.name) + ' budget ' + n.money(o.amount) + ' → ' + n.money(l.amount));
    if ((o.phaseId || '') !== (l.phaseId || '')) out.push(q(l.name) + ' phase set to ' + (l.phaseId ? n.phase(l.phaseId) : 'none'));
    if ((o.subteamId || '') !== (l.subteamId || '') && n.subteam) out.push(q(l.name) + ' sub-team set to ' + (l.subteamId ? n.subteam(l.subteamId) : 'none'));
  });
  const kept = new Set(after.lines.map(l => l.id));
  before.lines.filter(l => !kept.has(l.id)).forEach(l => out.push('Removed budget line ' + q(l.name) + (l.amount ? ' (' + n.money(l.amount) + ')' : '')));
  return clip(out.join('; '));
}

const what = (x) => x.kind === 'income' ? 'income' : 'spending';
const ids = (x) => x.partIds || (x.partId ? [x.partId] : []);

/** A payment or income added (before = null), deleted (after = null) or edited. '' when nothing worth logging changed. */
export function expenseChanges(before, after, n) {
  if (!before && !after) return '';
  if (!before) {
    const x = after; const bits = [];
    if (x.description) bits.push(x.description);
    if (x.kind !== 'income') bits.push('budget line ' + q(n.line(x.budgetId)));
    if (ids(x).length) bits.push('pays for ' + list(ids(x).map(id => q(n.part(id)))));
    return clip('Added ' + what(x) + ' ' + n.money(x.amount) + (x.date ? ' dated ' + x.date : '') + (bits.length ? ' — ' + bits.join(' · ') : ''));
  }
  if (!after) return clip('Deleted ' + what(before) + ' ' + n.money(before.amount) + (before.description ? ' — ' + before.description : '') + (before.date ? ' (dated ' + before.date + ')' : ''));
  const b = [];
  if (before.kind !== after.kind) b.push('changed from ' + what(before) + ' to ' + what(after));
  if (r2(before.amount) !== r2(after.amount)) b.push('amount ' + n.money(before.amount) + ' → ' + n.money(after.amount));
  if ((before.date || '') !== (after.date || '')) b.push('date ' + (before.date || 'none') + ' → ' + (after.date || 'none'));
  const was2 = (k, label) => { const x = before[k] || '', y = after[k] || ''; if (x !== y) b.push(!x ? label + ' set to ' + q(y) : !y ? label + ' cleared' : label + ' ' + q(x) + ' → ' + q(y)); };
  was2('description', 'description');
  if ((before.budgetId || '') !== (after.budgetId || '')) b.push('budget line ' + q(n.line(before.budgetId)) + ' → ' + q(n.line(after.budgetId)));
  was2('payer', 'paid by');
  const was = new Set(ids(before)), now = new Set(ids(after));
  const added = [...now].filter(id => !was.has(id)), gone = [...was].filter(id => !now.has(id));
  if (added.length) b.push('linked ' + list(added.map(id => q(n.part(id)))));
  if (gone.length) b.push('unlinked ' + list(gone.map(id => q(n.part(id)))));
  if ((before.receiptUrl || '') !== (after.receiptUrl || '') || (before.receiptImage || '') !== (after.receiptImage || '')) b.push((after.receiptUrl || after.receiptImage) ? 'receipt ' + ((before.receiptUrl || before.receiptImage) ? 'changed' : 'added') : 'receipt removed');
  if ((before.taskId || '') !== (after.taskId || '')) b.push(after.taskId ? 'task set to ' + q(n.task(after.taskId) || 'a task') : 'task unlinked');
  return clip(join('Edited ' + what(after) + ' ' + (before.description ? q(before.description) : n.money(before.amount)), b));
}

/** A part added, deleted or edited. Only fields that matter for cost and progress are logged. */
export function partChanges(before, after, n) {
  if (!before && !after) return '';
  const total = (p) => partTotal(p) ? ' (' + n.money(partTotal(p)) + ')' : '';
  if (!before) return clip('Added part ' + q(after.name) + (after.qty > 1 ? ' × ' + after.qty : '') + total(after) + ' — ' + n.status(after.status));
  if (!after) return clip('Deleted part ' + q(before.name) + total(before));
  const b = [];
  if (before.name !== after.name) b.push('renamed to ' + q(after.name));
  if (before.status !== after.status) b.push(n.status(before.status) + ' → ' + n.status(after.status));
  if (Number(before.qty) !== Number(after.qty)) b.push('quantity ' + before.qty + ' → ' + after.qty);
  if (r2(before.unitCost) !== r2(after.unitCost)) b.push('cost each ' + n.money(before.unitCost) + ' → ' + n.money(after.unitCost));
  if ((before.supplier || '') !== (after.supplier || '')) b.push('supplier ' + q(before.supplier || '') + ' → ' + q(after.supplier || ''));
  if ((before.budgetId || '') !== (after.budgetId || '')) b.push('budget line ' + q(n.line(before.budgetId)) + ' → ' + q(n.line(after.budgetId)));
  if (JSON.stringify(before.extras || []) !== JSON.stringify(after.extras || [])) b.push('extra costs ' + n.money(partExtras(before)) + ' → ' + n.money(partExtras(after)) + (after.extras && after.extras.length ? ' (' + after.extras.map(x => x.label).join(', ') + ')' : ''));
  if ((before.subteamId || '') !== (after.subteamId || '') && n.subteam) b.push('sub-team ' + q(n.subteam(before.subteamId)) + ' → ' + q(n.subteam(after.subteamId)));
  return clip(join('Part ' + q(before.name), b));
}

/**
 * Removing a budget line: the new budget, the spending and parts to move to `target`
 * ('' = Not assigned), and the history line.
 */
export function removeLinePlan(b, lineId, target, expenses, parts, n) {
  const line = b.lines.find(l => l.id === lineId);
  if (!line) return null;
  const budget = { ...b, lines: b.lines.filter(l => l.id !== lineId) };
  const to = budget.lines.some(l => l.id === target) ? target : '';
  const ex = expenses.filter(x => x.budgetId === lineId), pt = parts.filter(p => p.budgetId === lineId);
  const spent = r2(ex.filter(x => x.kind !== 'income').reduce((a, x) => a + x.amount, 0));
  const moves = [...ex.map(x => ({ path: 'expenses/' + x.id, from: lineId, to })), ...pt.map(p => ({ path: 'parts/' + p.id, from: lineId, to }))];
  const what = [ex.length && ex.length + ' spending ' + (ex.length === 1 ? 'entry' : 'entries') + ' (' + n.money(spent) + ')', pt.length && pt.length + ' part' + (pt.length === 1 ? '' : 's')].filter(Boolean);
  const text = 'Deleted budget line ' + q(line.name) + (line.amount ? ' (budget ' + n.money(line.amount) + ')' : '') + (what.length ? '; moved ' + list(what) + ' to ' + q(to ? n.line(to) : 'Not assigned') : '');
  return { line, index: b.lines.indexOf(line), budget, moves, spent, expenses: ex.length, parts: pt.length, to, text: clip(text) };
}
