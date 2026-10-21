// ─────────────────────────────────────────────────────────────────────────────
//  Research tools (Phase 7), opened from 🧪 Research on the board:
//    Meetings   – notes with action items that become tasks
//    Parts      – parts and orders, with costs and a link to the budget
//    Finance    – budget lines, spending, income, burn rate (finance roles only)
//    Literature – papers by DOI, reading status, notes, BibTeX in and out
//  The lab notebook lives on each task (see notebook.js).
// ─────────────────────────────────────────────────────────────────────────────
import { el, modal, toast } from './ui.js';
import { newId, cleanMeeting, cleanPart, cleanExpense, cleanBudget, cleanPaper, partTotal, PART_STATUS, PAPER_STATUS, CURRENCIES, findMentions, cleanFeatures, paidParts, cleanLogEntry, planOf, partItems, partExtras, extraValue, EXTRA_LABELS, EXTRA_LIMIT, subteamById, carryIndexOf, uniqueChains } from './model.js';
import { budgetChanges, expenseChanges, partChanges, removeLinePlan } from './finance-log.js';
import { people, timesheet, risks, requirements } from './tools-extra.js';
import { can } from './permissions.js';
import { purchaseOn, orderBlock, askApproval, decidePurchase, declineDialog } from './purchases.js';
import { needsApproval, isApproved, canApprovePurchase } from './model.js';

let R = null;   // { ctx, m, tab, sel, partEdit, paperEdit, txEdit, dirty, filters, logAll }
const today = () => new Date().toLocaleDateString('en-CA');
const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); };
// [tab, label, feature that turns it on]
const TABS = [['meetings', '📝 Meetings', 'meetings'], ['parts', '🔩 Parts', 'parts'], ['finance', '💷 Finance', 'finance'], ['literature', '📚 Literature', 'literature'],
  ['people', '👥 People', 'people'], ['time', '🕒 Timesheet', 'time'], ['risks', '⚠️ Risks', 'risks'], ['requirements', '📐 Requirements', 'requirements']];
/** The tools this team has turned on (Settings ▸ Features). */
export function toolTabs(s) { const f = cleanFeatures(s && s.team && s.team.features); return TABS.filter(t => f[t[2]]); }
const PART_LABEL = { needed: 'Needed', ordered: 'Ordered', received: 'Received', cancelled: 'Cancelled' };
const PAPER_LABEL = { 'to-read': 'To read', reading: 'Reading', read: 'Read' };

// ── Permissions and data access ─────────────────────────────────────────────
const S = () => R.ctx.session;
const me = () => R.ctx.user;
const perm = (p) => { const s = S(); return !!s && can(s.team, s.me, p); };
const canEdit = () => perm('tasks.editOwn') || perm('tasks.editAll');
export const seesMoney = (s) => !!s && (can(s.team, s.me, 'finance.view') || can(s.team, s.me, 'finance.edit'));
const editsMoney = () => perm('finance.edit');
const memberName = (uid) => (S().members.find(m => m.uid === uid) || {}).name || '';
/** A task carried forward over several weeks is one piece of work: links to any copy resolve to
 *  the latest copy (its name, done state, and the copy that opens). */
const taskById = (id) => carryIndexOf(S()).latest(id) || (S().tasks || []).find(t => t.id === id) || null;
/** Is `id` (or another copy of the same carried task) already in `list`? */
const linkedTo = (list, id) => { const ix = carryIndexOf(S()); return (list || []).some(x => ix.same(x, id)); };
/** Chips for linked task ids, one per piece of work. */
const taskChips = (ids) => uniqueChains(ids, carryIndexOf(S())).map(id => taskChip(id));
const budget = () => cleanBudget(S().budget);
const fmtMoney = (n) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: budget().currency, maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n || 0); } catch { return (n || 0).toFixed(2); } };
/** Write ops; `log` is [kind, text] or a list of them — added to the Finance history in the same batch. */
async function write(ops, log) {
  const lines = !log ? [] : Array.isArray(log[0]) ? log : [log];
  const extra = lines.filter(l => l && l[1]).map(([kind, text]) => { const { id, ...data } = cleanLogEntry({ at: Date.now(), by: me().uid, byName: me().name || '', kind, text }); return { type: 'set', path: 'financeLog/' + newId('fl'), data }; });
  return R.ctx.writeOps(ops.concat(extra));
}
const stamp = () => ({ updatedAt: Date.now() });
const financeOn = () => cleanFeatures(S().team && S().team.features).finance;
/** Sub-teams, when the feature is on and some exist. */
const subteams = () => { const t = S().team; return t && cleanFeatures(t.features).subteams ? (t.subteams || []) : []; };
const subteamChip = (id) => { const st = subteamById(S().team, id); return st && subteams().length ? el('span.st-chip', { style: { '--st': st.color }, title: 'Sub-team' }, st.name) : ''; };
const partName = (id) => ((S().parts || []).find(p => p.id === id) || {}).name || 'a deleted part';
const partLabel = (p) => p.name + (p.qty > 1 ? ' × ' + p.qty : '') + (p.supplier ? ' (' + p.supplier + ')' : '');
/** Lookups used to describe changes in the Finance history. */
const names = () => { const b = budget(); return { money: fmtMoney, line: (id) => (b.lines.find(l => l.id === id) || {}).name || 'Not assigned', part: partName, task: (id) => (taskById(id) || {}).name || '', phase: (id) => ((S().team.phases || []).find(p => p.id === id) || {}).name || 'none', status: (st) => PART_LABEL[st] || st, subteam: (id) => (subteamById(S().team, id) || {}).name || 'none' }; };

// ── Shell ───────────────────────────────────────────────────────────────────
export function openResearch(ctx, tab) {
  if (R) { R.tab = tab || R.tab; render(); return; }
  const m = modal('🧰 Tools', { onClose: () => { R = null; } });
  m.box.classList.add('research-modal');
  R = { ctx, m, tab: tab || 'meetings', sel: null, partEdit: null, paperEdit: null, txEdit: null, dirty: false, filters: { partQ: '', partStatus: 'open', paperQ: '', paperStatus: 'all', paperTag: '', txKind: 'all', logKind: 'all', partTeam: '' }, logAll: false };
  m.box.addEventListener('focusout', () => setTimeout(() => { if (R && R.dirty && !typing()) { R.dirty = false; render(); } }, 0));
  render();
}
export function refreshResearch(ctx) { if (!R) return; R.ctx = ctx; if (typing()) { R.dirty = true; return; } render(); }
export const researchOpen = () => !!R;
function typing() {
  const a = document.activeElement; if (!R || !a || !R.m.box.contains(a)) return false;
  if (a.tagName === 'TEXTAREA') return true;
  return a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file'].includes(a.type);
}

function render() {
  if (!R) return;
  const { m } = R;
  const on = toolTabs(S());
  if (!on.some(t => t[0] === R.tab) && on.length) R.tab = on[0][0];
  if (!on.length) { m.body.replaceChildren(el('div.empty-state', {}, 'No tools are turned on for this team. ' + (perm('team.settings') ? 'Turn some on in Settings ▸ Features.' : 'Ask a team admin to turn some on in Settings ▸ Features.'))); m.foot.replaceChildren(); return; }
  const tabs = el('div.rs-tabs', { role: 'tablist' }, on.map(([k, label]) => el('button.rs-tab' + (R.tab === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(R.tab === k), dataset: { tab: k }, onclick: () => { R.tab = k; render(); } }, label)));
  const pane = el('div.rs-pane');
  try { ({ meetings, parts, finance, literature, people, time: timesheet, risks, requirements })[R.tab](pane, kit); }
  catch (e) { console.error(e); pane.append(el('div.empty-state', {}, 'Could not show this: ' + e.message)); }
  const scroll = m.body.scrollTop;
  m.body.replaceChildren(tabs, pane); m.body.scrollTop = scroll;
  m.foot.replaceChildren(el('span.hint', {}, footHint()));
}
function footHint() {
  return { meetings: 'Action items with an owner become tasks in that person’s row, in the week of their due date.', parts: 'Mark a part Received and, if you manage finances, record what it cost in one click.',
    finance: 'Only roles with the finance permissions can see this tab (Settings ▸ Roles).', literature: 'Add papers by DOI; export BibTeX for LaTeX, Zotero or Mendeley.',
    people: 'Everyone sets their own hours, skills and time off; member managers can set anyone’s.', time: 'Log hours on a task from its editor (🕒 Time spent).',
    risks: 'Score = likelihood × impact. Review high risks every week.', requirements: 'Link each requirement to the tasks that deliver it, then record how it was verified.' }[R.tab] || '';
}
const kpi = (label, value, cls) => el('div.rs-kpi' + (cls ? '.' + cls : ''), {}, el('div.rs-kpi-v', {}, value), el('div.rs-kpi-l', {}, label));
const taskChip = (id) => {
  const t = taskById(id); if (!t) return el('span.rs-chip.gone', {}, 'Deleted task');
  return el('button.rs-chip.link', { type: 'button', title: 'Open the task', onclick: () => { R.m.close(); window.boardOpenTask && window.boardOpenTask(t.id); } }, (t.flag === 'completed' ? '✅ ' : '📌 ') + (t.name || 'Untitled task'));
};
function pickTask(title, onPick) {
  const items = (window.boardTaskList ? window.boardTaskList() : []).map(t => ({ group: t.person, icon: t.done ? '✅' : '📌', title: t.name || 'Untitled task', sub: [t.week, t.due && 'due ' + fmtDate(t.due)].filter(Boolean).join(' · '),
    fields: [[t.name, 3], [t.person, 1], [t.week, 1]], suggest: true, run: () => onPick(t.id) }));
  R.ctx.TT.pickFrom(items, title, 'No tasks yet.');
}
function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ════════════════════════════════════════════════════════════════════════════
//  Meetings
// ════════════════════════════════════════════════════════════════════════════
const MEETING_TEMPLATE = 'Agenda\n- \n\nNotes\n- \n\nDecisions\n- \n\nActions\n- [ ] ';
async function newMeeting() {
  const id = newId('mt');
  const data = { title: 'Team meeting', date: today(), attendees: S().members.map(m => m.uid).slice(0, 50), notes: MEETING_TEMPLATE, actions: [],
    createdBy: me().uid, createdByName: (me().name || me().email || '').slice(0, 80), createdAt: Date.now(), updatedAt: Date.now(), updatedByName: (me().name || '').slice(0, 80) };
  if (await write([{ type: 'set', path: 'meetings/' + id, data }])) { R.sel = id; render(); setTimeout(() => { const t = R && R.m.box.querySelector('#mt-title'); if (t) { t.focus(); t.select(); } }, 50); }
}
async function saveMeeting(mt, patch) {
  const data = cleanMeeting({ ...mt, ...patch });
  const { id, ...doc } = data; doc.updatedAt = Date.now(); doc.updatedByName = (me().name || '').slice(0, 80);
  return write([{ type: 'set', path: 'meetings/' + mt.id, data: doc }]);
}
/** Lines in the notes that look like action items: "- [ ] …", "TODO …", "Action: …". @Name sets the owner. */
export function actionsFromNotes(notes, members) {
  const out = [];
  String(notes || '').split('\n').forEach(line => {
    const m = /^\s*(?:[-*]\s*\[\s?\]\s*|todo[:\s-]+|action[:\s-]+|ai[:\s-]+)(.+)$/i.exec(line); if (!m) return;
    let text = m[1].trim(); if (!text) return;
    const ids = findMentions(text, members); const ownerUid = ids[0] || '';
    if (ownerUid) { const name = (members.find(x => x.uid === ownerUid) || {}).name || ''; text = text.replace(new RegExp('@' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/\s{2,}/g, ' ').trim(); }
    const due = /\b(?:by|due)\s+(\d{4}-\d{2}-\d{2})\b/i.exec(text); const dueDate = due ? due[1] : '';
    if (due) text = text.replace(due[0], '').trim();
    out.push({ text: text.slice(0, 300), ownerUid, dueDate });
  });
  return out;
}
function meetings(pane) {
  const list = (S().meetings || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  if (R.sel && !list.some(x => x.id === R.sel)) R.sel = null;
  if (!R.sel && list.length) R.sel = list[0].id;
  const side = el('div.mtg-side', {},
    canEdit() ? el('button.btn.primary.small', { type: 'button', id: 'mt-new', onclick: newMeeting }, '＋ New meeting') : '',
    list.length ? el('div.mtg-list', {}, list.map(x => {
      const open = x.actions.filter(a => !a.taskId || (taskById(a.taskId) && taskById(a.taskId).flag !== 'completed')).length;
      return el('button.mtg-item' + (x.id === R.sel ? '.on' : ''), { type: 'button', onclick: () => { R.sel = x.id; render(); } },
        el('span.mtg-item-t', {}, x.title), el('span.mtg-item-s', {}, [fmtDate(x.date), x.actions.length ? x.actions.length + ' action' + (x.actions.length === 1 ? '' : 's') + (open ? ' · ' + open + ' open' : ' · all done') : ''].filter(Boolean).join(' · ')));
    })) : el('p.hint', {}, 'No meetings yet. Notes from supervisor meetings, stand-ups or lab meetings go here, and their action items become tasks.'));
  const mt = list.find(x => x.id === R.sel);
  pane.append(el('div.mtg-wrap', {}, side, mt ? meetingEditor(mt) : el('div.mtg-main.empty-state', {}, canEdit() ? 'Start with “New meeting”.' : 'No meetings yet.')));
}
function meetingEditor(mt) {
  const edit = canEdit(); const members = S().members;
  const title = el('input.mtg-title', { id: 'mt-title', value: mt.title, maxlength: 120, disabled: !edit, 'aria-label': 'Meeting title', onchange: (e) => saveMeeting(mt, { title: e.target.value || 'Meeting' }) });
  const date = el('input', { type: 'date', value: mt.date, disabled: !edit, 'aria-label': 'Meeting date', onchange: (e) => saveMeeting(mt, { date: e.target.value }) });
  const who = el('div.mtg-attendees', {}, el('span.hint', {}, 'Attendees'), members.map(m => el('label.mtg-att' + (mt.attendees.includes(m.uid) ? '.on' : ''), {},
    el('input', { type: 'checkbox', checked: mt.attendees.includes(m.uid), disabled: !edit, onchange: (e) => saveMeeting(mt, { attendees: e.target.checked ? mt.attendees.concat(m.uid) : mt.attendees.filter(u => u !== m.uid) }) }), m.name || m.email)));
  let timer = null;
  const notes = el('textarea.mtg-notes', { id: 'mt-notes', rows: 12, maxlength: 20000, disabled: !edit, placeholder: 'Agenda, notes, decisions… Lines like “- [ ] Order servos @Tom by 2026-11-01” become action items.', 'aria-label': 'Meeting notes' });
  notes.value = mt.notes;
  const saveNotes = () => { clearTimeout(timer); if (notes.value !== mt.notes) { saveMeeting(mt, { notes: notes.value }); mt.notes = notes.value; } };
  notes.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(saveNotes, 1500); });
  notes.addEventListener('blur', saveNotes);
  // Action items
  const rows = el('div.mtg-actions');
  mt.actions.forEach((a, i) => rows.append(actionRow(mt, a, i, edit, members)));
  if (!mt.actions.length) rows.append(el('p.hint', {}, 'No action items yet.'));
  const addAction = () => saveMeeting(mt, { actions: mt.actions.concat({ id: newId('a'), text: 'New action', ownerUid: '', dueDate: '', taskId: '' }) }).then(() => setTimeout(() => { const ins = R && R.m.box.querySelectorAll('.mtg-act-text'); if (ins && ins.length) { ins[ins.length - 1].focus(); ins[ins.length - 1].select(); } }, 60));
  const findActions = () => {
    saveNotes();
    const found = actionsFromNotes(notes.value, members).filter(f => !mt.actions.some(a => a.text.toLowerCase() === f.text.toLowerCase()));
    if (!found.length) { toast('No new action items found. Start a line with “- [ ]”, “TODO” or “Action:”.', 5000); return; }
    saveMeeting(mt, { notes: notes.value, actions: mt.actions.concat(found.map(f => ({ id: newId('a'), taskId: '', ...f }))) }).then(ok => ok && toast('Found ' + found.length + ' action item' + (found.length === 1 ? '' : 's') + '.'));
  };
  const minutes = () => {
    const lines = ['# ' + mt.title, '', 'Date: ' + (mt.date || ''), 'Attendees: ' + mt.attendees.map(memberName).filter(Boolean).join(', '), '', mt.notes, '', '## Action items',
      ...mt.actions.map(a => '- [' + (a.taskId && taskById(a.taskId) && taskById(a.taskId).flag === 'completed' ? 'x' : ' ') + '] ' + a.text + (a.ownerUid ? ' — ' + memberName(a.ownerUid) : '') + (a.dueDate ? ' (due ' + a.dueDate + ')' : ''))];
    const text = lines.join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Minutes copied — paste them into an email or document.'), () => download((mt.title || 'meeting').replace(/[^\w-]+/g, '_') + '.md', text, 'text/markdown'));
  };
  const del = async () => {
    if (!confirm('Delete this meeting and its notes? Tasks already created stay.')) return;
    if (await write([{ type: 'delete', path: 'meetings/' + mt.id }])) { R.sel = null; toast('Meeting deleted.'); }
  };
  const mayDelete = mt.createdBy === me().uid || perm('team.settings');
  return el('div.mtg-main', {},
    el('div.mtg-head', {}, title, date),
    who,
    notes,
    el('div.mtg-subhead', {}, el('h4', {}, 'Action items'), el('span.spacer'),
      edit ? el('button.btn.small', { type: 'button', onclick: findActions, title: 'Turn “- [ ]”, “TODO” and “Action:” lines into action items' }, '🔎 Find actions in notes') : '',
      edit ? el('button.btn.small', { type: 'button', onclick: addAction }, '＋ Add action') : ''),
    rows,
    el('div.mtg-foot', {}, el('span.hint', {}, mt.updatedByName ? 'Last edited by ' + mt.updatedByName + (mt.updatedAt ? ' · ' + new Date(mt.updatedAt).toLocaleString() : '') : ''), el('span.spacer'),
      el('button.btn.small', { type: 'button', onclick: minutes }, '📋 Copy minutes'),
      mayDelete ? el('button.btn.small.danger', { type: 'button', onclick: del }, 'Delete meeting') : ''));
}
function actionRow(mt, a, i, edit, members) {
  const upd = (patch) => saveMeeting(mt, { actions: mt.actions.map((x, j) => j === i ? { ...x, ...patch } : x) });
  const text = el('input.mtg-act-text', { value: a.text, maxlength: 300, disabled: !edit || !!a.taskId, 'aria-label': 'Action', onchange: (e) => upd({ text: e.target.value }) });
  const owner = el('select', { disabled: !edit || !!a.taskId, 'aria-label': 'Owner', onchange: (e) => upd({ ownerUid: e.target.value }) },
    el('option', { value: '' }, 'Owner…'), members.map(m => el('option', { value: m.uid, selected: a.ownerUid === m.uid }, m.name || m.email)));
  const due = el('input', { type: 'date', value: a.dueDate, disabled: !edit || !!a.taskId, 'aria-label': 'Due date', onchange: (e) => upd({ dueDate: e.target.value }) });
  let state;
  if (a.taskId) state = taskChip(a.taskId);
  else if (edit) state = el('button.btn.small.primary', { type: 'button', onclick: async () => {
    const ownerUid = a.ownerUid || me().uid;
    const r = window.boardAddTask ? window.boardAddTask({ ownerUid, name: a.text, dueDate: a.dueDate, note: 'From meeting “' + mt.title + '” (' + (mt.date || '') + ')' }) : { error: 'The board isn’t ready.' };
    if (r.error) { toast(r.error, 5000); return; }
    if (await upd({ taskId: r.id, ownerUid })) toast('Task created in ' + (memberName(ownerUid) || 'your') + '’s row.');
  } }, '➜ Create task');
  const x = edit ? el('button.dep-x', { type: 'button', title: 'Remove action', 'aria-label': 'Remove action', onclick: () => saveMeeting(mt, { actions: mt.actions.filter((_, j) => j !== i) }) }, '✕') : '';
  return el('div.mtg-act' + (a.taskId ? '.linked' : ''), {}, text, owner, due, state || '', x);
}

// ════════════════════════════════════════════════════════════════════════════
//  Parts and orders
// ════════════════════════════════════════════════════════════════════════════
async function savePart(id, fields) {
  const isNew = !id; const pid = id || newId('pt');
  const before = (S().parts || []).find(p => p.id === pid) || {};
  const data = cleanPart({ ...before, ...fields, createdBy: before.createdBy || me().uid, createdByName: before.createdByName || (me().name || '').slice(0, 80), createdAt: before.createdAt || Date.now(), ...stamp() });
  if (data.status === 'ordered' && !data.orderedDate) data.orderedDate = today();
  if (data.status === 'received' && !data.receivedDate) data.receivedDate = today();
  if (!data.name) { toast('Give the part a name.'); return false; }
  // Purchase approvals: an approved cost that changes needs approving again (finance managers excepted),
  // and a part over the limit can't be marked Ordered or Received until it's approved.
  const costChanged = !isNew && (partTotal(before) !== partTotal(data) || before.qty !== data.qty || before.unitCost !== data.unitCost || JSON.stringify(before.extras || []) !== JSON.stringify(data.extras || []));
  if (isApproved(before) && costChanged && !editsMoney()) { data.approval = null; toast('The cost changed, so “' + data.name + '” needs approving again.', 5000); }
  const buying = ['ordered', 'received'].includes(data.status) && !['ordered', 'received'].includes(before.status);
  if (buying && purchaseOn(S())) {
    const block = orderBlock(S(), { ...data, status: 'needed' });
    if (block) {
      const ask = !data.approval || data.approval.status === 'declined';
      toast('“' + data.name + '” can’t be marked ' + PART_LABEL[data.status] + ' yet. ' + block, 7000, ask && !isNew ? 'Ask for approval' : null, ask && !isNew ? () => requestApproval({ ...before, ...data, id: pid, status: before.status }) : null);
      if (!isNew) { render(); return false; }
      data.status = 'needed'; data.orderedDate = ''; data.receivedDate = '';
    }
  }
  const { id: _, ...doc } = data;
  const ok = await write([{ type: 'set', path: 'parts/' + pid, data: doc }], ['parts', partChanges(isNew ? null : before, data, names())]);
  if (ok && data.status === 'received' && before.status !== 'received') offerExpense({ ...data, id: pid });
  return ok && (isNew ? pid : true);
}
async function requestApproval(p) {
  if (await askApproval(R.ctx, p)) toast('Sent for approval. Finance managers see it under ✅ Approvals.', 4500);
}
async function decide(p, status, note) {
  if (await decidePurchase(R.ctx, p, status, note)) toast(status === 'approved' ? 'Approved. It counts against its budget line now.' : 'Declined.', 3000);
}
/** The approval state of a part, and its buttons. */
function approvalCell(p) {
  const s = S(); const a = p.approval; const on = purchaseOn(s);
  if (!on && !a) return '';
  const box = el('div.pt-approval');
  if (a && a.status === 'approved') box.append(el('span.rs-chip.pa-ok', { title: 'Approved ' + fmtMoney(a.amount) + ' by ' + a.approverName + (a.note ? ': ' + a.note : '') }, '✓ Approved · ' + (a.approverName || '').split(' ')[0]));
  else if (a && a.status === 'waiting') box.append(el('span.rs-chip.pa-wait', { title: 'Asked by ' + a.byName }, '⏳ Waiting for approval'));
  else if (a && a.status === 'declined') box.append(el('span.rs-chip.pa-no', { title: a.note || '' }, '✕ Declined' + (a.note ? ': ' + a.note : '')));
  if (a && a.status === 'waiting' && canApprovePurchase(s.team, s.me, p)) {
    box.append(el('button.btn.small.primary.pa-approve', { type: 'button', onclick: () => decide(p, 'approved', '') }, 'Approve'),
      el('button.btn.small.pa-decline', { type: 'button', onclick: () => declineDialog(R.ctx, p).then(ok => { if (ok) toast('Declined.', 2500); }) }, 'Decline'));
  } else if (on && canEdit() && needsApproval(p, s.team.purchase) && (!a || a.status === 'declined')) {
    box.append(el('button.btn.small.pa-ask', { type: 'button', onclick: () => requestApproval(p) }, a ? 'Ask again' : 'Ask for approval'));
  }
  return box;
}
function offerExpense(p) {
  if (!editsMoney() || !financeOn() || !partTotal(p)) return;
  if (paidParts(S().expenses).has(p.id)) return;
  toast('“' + p.name + '” received.', 9000, 'Record ' + fmtMoney(partTotal(p)) + ' as spending', () => recordPartExpense(p));
}
async function recordPartExpense(p) {
  const id = newId('x');
  const data = cleanExpense({ kind: 'expense', amount: partTotal(p), date: p.receivedDate || today(), description: partLabel(p), budgetId: p.budgetId, payer: '', taskId: p.taskId, partIds: [p.id], createdBy: me().uid, createdByName: (me().name || '').slice(0, 80), createdAt: Date.now(), updatedAt: Date.now() });
  const { id: _, ...doc } = data;
  if (await write([{ type: 'set', path: 'expenses/' + id, data: doc }], ['spending', expenseChanges(null, data, names())])) toast('Recorded in Finance.');
}
/** Open Finance on an existing payment. */
function openPayment(x) {
  R.tab = 'finance'; R.txEdit = editsMoney() ? x : null; render(); showForm();
}
/** Open Finance with a new payment already filled in from this part. */
function payForPart(p) {
  R.tab = 'finance'; R.txEdit = withParts({ kind: 'expense', date: p.orderedDate || p.receivedDate || today() }, [p.id]); render(); showForm();
}
function showForm() {
  setTimeout(() => { const f = R && R.m.box.querySelector('.rs-form'); if (!f) return; f.scrollIntoView({ block: 'center', behavior: 'smooth' }); const a = f.querySelector('#tx-amount'); if (a) a.focus({ preventScroll: true }); }, 60);
}
/**
 * Link parts to a payment. Amount, description, budget line and task are filled in from the
 * parts unless you've typed your own (what was filled in automatically is remembered in _auto).
 */
function withParts(v, ids) {
  const linked = ids.map(id => (S().parts || []).find(p => p.id === id)).filter(Boolean);
  const auto = v._auto || {};
  const amount = Math.round(linked.reduce((a, p) => a + partTotal(p), 0) * 100) / 100;
  const description = linked.map(partLabel).join(', ').slice(0, 300);
  const next = { ...v, partIds: ids };
  if (amount && (!Number(v.amount) || Number(v.amount) === auto.amount)) next.amount = amount;
  if (!v.description || v.description === auto.description) next.description = description;
  if (!v.budgetId) next.budgetId = (linked.find(p => p.budgetId) || {}).budgetId || '';
  if (!v.taskId) next.taskId = (linked.find(p => p.taskId) || {}).taskId || '';
  next._auto = { amount: Number(next.amount) === amount ? amount : auto.amount, description: next.description === description ? description : auto.description };
  return next;
}
function pickPart(v, onPick) {
  const paid = paidParts(S().expenses);
  const taken = (p) => { const x = paid.get(p.id); return !!x && x.id !== v.id; };
  const items = (S().parts || []).filter(p => p.status !== 'cancelled' && !(v.partIds || []).includes(p.id))
    .sort((a, b) => taken(a) - taken(b) || PART_STATUS.indexOf(a.status) - PART_STATUS.indexOf(b.status) || a.name.localeCompare(b.name))
    .map(p => ({ group: taken(p) ? 'Already paid' : 'Not paid yet', icon: '🔩', title: p.name + (p.qty > 1 ? ' × ' + p.qty : ''), sub: [p.supplier, partTotal(p) ? fmtMoney(partTotal(p)) : '', PART_LABEL[p.status]].filter(Boolean).join(' · '),
      fields: [[p.name, 3], [p.supplier || '', 1], [p.partNo || '', 1]], suggest: true, run: () => onPick(p) }));
  R.ctx.TT.pickFrom(items, 'Which part did this pay for?', 'No parts to link — add them in the Parts tab.');
}
function parts(pane) {
  const all = S().parts || []; const f = R.filters;
  // Payments: finance roles see which parts are paid for and can record a payment from here.
  const pay = seesMoney(S()) && financeOn(); const paid = pay ? paidParts(S().expenses) : new Map();
  const unpaid = (p) => ['ordered', 'received'].includes(p.status) && !paid.has(p.id);
  if (f.partStatus === 'unpaid' && !pay) f.partStatus = 'open';
  const q = f.partQ.trim().toLowerCase();
  if (f.partTeam && !subteams().some(st => st.id === f.partTeam)) f.partTeam = '';
  const rows = all.filter(p => (!f.partTeam || (f.partTeam === '-' ? !subteamById(S().team, p.subteamId) : p.subteamId === f.partTeam)) && (f.partStatus === 'all' || (f.partStatus === 'open' ? ['needed', 'ordered'].includes(p.status) : f.partStatus === 'unpaid' ? unpaid(p) : p.status === f.partStatus)) && (!q || [p.name, p.partNo, p.supplier, p.notes].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => PART_STATUS.indexOf(a.status) - PART_STATUS.indexOf(b.status) || (a.neededBy || '9999').localeCompare(b.neededBy || '9999') || a.name.localeCompare(b.name));
  const live = all.filter(p => p.status !== 'cancelled');
  const sum = (list) => list.reduce((a, p) => a + partTotal(p), 0);
  const late = all.filter(p => p.status === 'needed' && p.neededBy && p.neededBy < today()).length;
  pane.append(el('div.rs-kpis', {}, kpi('Needed', String(all.filter(p => p.status === 'needed').length), late ? 'warn' : ''), kpi('On order', String(all.filter(p => p.status === 'ordered').length)), kpi('Received', String(all.filter(p => p.status === 'received').length)),
    kpi('Total cost', fmtMoney(sum(live))), kpi('Still to buy', fmtMoney(sum(all.filter(p => p.status === 'needed')))),
    pay ? kpi('Bought, not paid', fmtMoney(sum(all.filter(unpaid))), all.some(unpaid) ? 'warn' : '') : '',
    purchaseOn(S()) ? kpi('Waiting for approval', String(all.filter(p => p.approval && p.approval.status === 'waiting' && p.status !== 'cancelled').length)) : ''));
  const bar = el('div.rs-bar', {},
    el('input.rs-search', { type: 'search', placeholder: 'Search parts…', value: f.partQ, 'aria-label': 'Search parts', oninput: (e) => { f.partQ = e.target.value; const pos = e.target.selectionStart; render(); const n = R.m.box.querySelector('.rs-search'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } } }),
    el('select', { 'aria-label': 'Status', onchange: (e) => { f.partStatus = e.target.value; render(); } }, [['open', 'Needed or on order'], ['all', 'All'], ...PART_STATUS.map(s => [s, PART_LABEL[s]]), ...(pay ? [['unpaid', 'Bought, not paid']] : [])].map(([v, t]) => el('option', { value: v, selected: f.partStatus === v }, t))),
    subteams().length ? el('select', { 'aria-label': 'Sub-team', id: 'pt-team-filter', onchange: (e) => { f.partTeam = e.target.value; render(); } }, [['', 'All sub-teams'], ...subteams().map(st => [st.id, st.name]), ['-', 'No sub-team']].map(([v, t]) => el('option', { value: v, selected: f.partTeam === v }, t))) : '',
    el('span.spacer'),
    el('button.btn.small', { type: 'button', onclick: () => exportParts(all) }, '⬇ Export'),
    canEdit() ? el('button.btn.small.primary', { type: 'button', id: 'pt-new', onclick: () => { R.partEdit = 'new'; render(); } }, '＋ Add part') : '');
  pane.append(bar);
  if (R.partEdit) pane.append(partForm(R.partEdit === 'new' ? null : all.find(p => p.id === R.partEdit)));
  if (!rows.length) { pane.append(el('div.empty-state', {}, all.length ? 'Nothing matches.' : 'No parts yet. Add the components, materials and tools the project needs to buy.')); return; }
  const edit = canEdit();
  const payCell = (p) => {
    const x = paid.get(p.id);
    if (x) return el('td', {}, el('button.rs-chip.pay-ok', { type: 'button', title: 'Paid ' + fmtMoney(x.amount) + (x.date ? ' on ' + fmtDate(x.date) : '') + (x.description ? ' — ' + x.description : '') + '. Open in Finance.', onclick: () => openPayment(x) }, '✓ Paid' + (x.date ? ' · ' + fmtDate(x.date) : '')));
    if (p.status === 'cancelled') return el('td');
    return el('td', {}, editsMoney() ? el('button.btn.small.pay-btn', { type: 'button', title: 'Record what was paid for this part', onclick: () => payForPart(p) }, '💷 Record payment') : el('span.hint', {}, 'Not paid'));
  };
  const table = el('table.rs-table', {}, el('tr', {}, ['Part', 'Supplier', 'Qty', 'Each', 'Total', 'Status', ...(pay ? ['Payment'] : []), 'Dates', 'Task', ''].map(h => el('th', {}, h))),
    rows.map(p => el('tr.pt-row.st-' + p.status, { dataset: { id: p.id } },
      el('td', {}, el('b', {}, p.name), ' ', subteamChip(p.subteamId), p.partNo ? el('div.hint', {}, p.partNo) : '', p.notes ? el('div.hint.pt-notes', {}, p.notes) : ''),
      el('td', {}, p.url ? el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.supplier || 'Link ↗') : p.supplier),
      el('td.num', {}, String(p.qty)), el('td.num', {}, p.unitCost ? fmtMoney(p.unitCost) : '–'), el('td.num', {}, el('b', {}, partTotal(p) ? fmtMoney(partTotal(p)) : '–'), p.extras.length ? el('div.hint.pt-extras', { title: p.extras.map(x => x.label + ' ' + (x.percent ? x.amount + '% = ' : '') + fmtMoney(extraValue(p, x))).join('\n') }, (partExtras(p) < 0 ? 'incl. ' : 'incl. +') + fmtMoney(partExtras(p)) + ' extras') : ''),
      el('td', {}, edit ? el('select.pt-status', { 'aria-label': 'Status of ' + p.name, onchange: (e) => savePart(p.id, { status: e.target.value }) }, PART_STATUS.map(s => el('option', { value: s, selected: p.status === s }, PART_LABEL[s]))) : el('span.rs-chip', {}, PART_LABEL[p.status]), approvalCell(p)),
      pay ? payCell(p) : '',
      el('td.hint', {}, [p.neededBy && (p.status === 'needed' && p.neededBy < today() ? '⚠ ' : '') + 'needed ' + fmtDate(p.neededBy), p.orderedDate && 'ordered ' + fmtDate(p.orderedDate), p.receivedDate && 'received ' + fmtDate(p.receivedDate)].filter(Boolean).join(' · ')),
      el('td', {}, p.taskId ? taskChip(p.taskId) : ''),
      el('td', {}, edit ? el('button.btn.small.ghost', { type: 'button', onclick: () => { R.partEdit = p.id; render(); } }, 'Edit') : ''))));
  pane.append(el('div.rs-table-wrap', {}, table));
}
function partForm(p) {
  p = p || cleanPart({ qty: 1, status: 'needed' });
  const v = { ...p }; const money = seesMoney(S());
  const field = (label, input) => el('label.rs-field', {}, el('span', {}, label), input);
  const inp = (k, attrs = {}) => { const n = el('input', { value: v[k] ?? '', ...attrs, oninput: (e) => { v[k] = e.target.value; } }); return n; };
  const lines = budget().lines;
  const form = el('form.rs-form', { onsubmit: async (e) => { e.preventDefault(); const r = await savePart(p.id || null, { ...v, qty: Number(v.qty), unitCost: Number(v.unitCost) }); if (r) { R.partEdit = null; render(); } } },
    el('h4', {}, p.id ? 'Edit part' : 'New part'),
    el('div.rs-grid', {},
      field('Name', inp('name', { required: true, maxlength: 200, id: 'pt-name' })), field('Part number', inp('partNo', { maxlength: 80 })),
      field('Supplier', inp('supplier', { maxlength: 120 })), field('Link', inp('url', { type: 'url', placeholder: 'https://…' })),
      field('Quantity', inp('qty', { type: 'number', min: 0, step: 1, id: 'pt-qty' })), field('Cost each', inp('unitCost', { type: 'number', min: 0, step: '0.01', id: 'pt-cost' })),
      field('Status', el('select', { onchange: (e) => { v.status = e.target.value; } }, PART_STATUS.map(s => el('option', { value: s, selected: v.status === s }, PART_LABEL[s])))),
      field('Needed by', inp('neededBy', { type: 'date' })),
      money && lines.length ? field('Budget line', el('select', { onchange: (e) => { v.budgetId = e.target.value; } }, el('option', { value: '' }, '—'), lines.map(l => el('option', { value: l.id, selected: v.budgetId === l.id }, l.name)))) : '',
      field('Task', el('div.rs-inline', {}, v.taskId ? taskChip(v.taskId) : el('span.hint', {}, 'None'), el('button.btn.small', { type: 'button', onclick: () => pickTask('Which task is this part for?', (id) => { v.taskId = id; R.partEdit = p.id || 'new'; Object.assign(p, v); render(); }) }, v.taskId ? 'Change' : 'Link a task')))),
    subteams().length ? el('div.rs-grid', {}, field('Sub-team', el('select', { id: 'pt-team', onchange: (e) => { v.subteamId = e.target.value; } }, el('option', { value: '' }, '—'), subteams().map(st => el('option', { value: st.id, selected: v.subteamId === st.id }, st.name))))) : '',
    extrasEditor(v),
    field('Notes', el('textarea', { rows: 2, maxlength: 2000, oninput: (e) => { v.notes = e.target.value; } }, v.notes || '')),
    el('div.rs-form-foot', {},
      p.id && (p.createdBy === me().uid || perm('team.settings')) ? el('button.btn.small.danger', { type: 'button', onclick: async () => { if (!confirm('Delete “' + p.name + '”?')) return; if (await write([{ type: 'delete', path: 'parts/' + p.id }], ['parts', partChanges(p, null, names())])) { R.partEdit = null; render(); } } }, 'Delete') : '',
      el('span.spacer'), el('button.btn.small.ghost', { type: 'button', onclick: () => { R.partEdit = null; render(); } }, 'Cancel'), el('button.btn.small.primary', { type: 'submit' }, p.id ? 'Save' : 'Add part')));
  setTimeout(() => { const n = form.querySelector('#pt-name'); if (n && !p.id) n.focus(); }, 30);
  return form;
}
/** Extra costs on a part (shipping, VAT, duty, fees, discount) — each a fixed amount or a % of the items. */
function extrasEditor(v) {
  v.extras = (v.extras || []).map(x => ({ ...x }));
  const box = el('div.pt-extras-box');
  const num = (x) => Number(x) || 0;
  const live = () => { const p = { qty: num(v.qty), unitCost: num(v.unitCost), extras: v.extras.map(x => ({ ...x, amount: num(x.amount) })) }; return { items: partItems(p), extras: partExtras(p), total: partTotal(p) }; };
  const totalLine = el('div.pt-extras-total.hint');
  const sumUp = () => { const t = live(); totalLine.textContent = v.extras.length ? 'Items ' + fmtMoney(t.items) + (t.extras < 0 ? ' − ' : ' + ') + fmtMoney(Math.abs(t.extras)) + ' extras = ' + fmtMoney(t.total) + ' total' : ''; };
  const draw = () => {
    box.replaceChildren(el('div.pt-extras-head', {}, el('span', {}, 'Extra costs'), el('span.hint', {}, ' shipping, VAT, import duty, fees, discounts (use a minus amount)')),
      ...v.extras.map((x, i) => el('div.pt-extra', {},
        el('input.pt-extra-label', { value: x.label || '', list: 'pt-extra-labels', maxlength: 40, placeholder: 'e.g. Shipping', 'aria-label': 'What the extra cost is', oninput: (e) => { x.label = e.target.value; } }),
        el('input.pt-extra-amount', { type: 'number', step: '0.01', value: x.amount ?? '', 'aria-label': 'Amount', oninput: (e) => { x.amount = e.target.value; sumUp(); } }),
        el('select.pt-extra-unit', { 'aria-label': 'Fixed amount or percent', onchange: (e) => { x.percent = e.target.value === '%'; sumUp(); } }, el('option', { value: 'money', selected: !x.percent }, budget().currency), el('option', { value: '%', selected: !!x.percent }, '% of items')),
        el('button.chip-x', { type: 'button', title: 'Remove', 'aria-label': 'Remove extra cost', onclick: () => { v.extras.splice(i, 1); draw(); } }, '✕'))),
      v.extras.length < EXTRA_LIMIT ? el('div.rs-inline', {}, ...['Shipping', 'VAT / tax'].filter(l => !v.extras.some(x => x.label === l)).map(l => el('button.btn.small', { type: 'button', onclick: () => { v.extras.push(l === 'VAT / tax' ? { label: l, amount: 20, percent: true } : { label: l, amount: '', percent: false }); draw(); } }, '＋ ' + l)),
        el('button.btn.small', { type: 'button', id: 'pt-extra-add', onclick: () => { v.extras.push({ label: '', amount: '', percent: false }); draw(); } }, '＋ Other cost')) : '',
      totalLine, el('datalist', { id: 'pt-extra-labels' }, EXTRA_LABELS.map(l => el('option', { value: l }))));
    sumUp();
  };
  draw();
  // keep the total line in step with quantity and cost each
  setTimeout(() => { const f = box.closest('form'); if (f) f.addEventListener('input', (e) => { if (e.target.id === 'pt-qty' || e.target.id === 'pt-cost') sumUp(); }); }, 0);
  return box;
}
function exportParts(all) {
  if (!window.XLSX) { toast('Export isn’t ready yet — try again in a moment.'); return; }
  const money = seesMoney(S()); const lines = new Map(budget().lines.map(l => [l.id, l.name]));
  const head = ['Part', 'Part number', 'Supplier', 'Link', 'Quantity', 'Cost each', 'Items', 'Extra costs', 'Extras detail', 'Total', 'Status', 'Needed by', 'Ordered', 'Received', 'Task', ...(money ? ['Budget line'] : []), 'Notes', 'Added by'];
  const aoa = [head, ...all.map(p => [p.name, p.partNo, p.supplier, p.url, p.qty, p.unitCost, partItems(p), partExtras(p), p.extras.map(x => x.label + ' ' + (x.percent ? x.amount + '%' : x.amount)).join('; '), partTotal(p), PART_LABEL[p.status], p.neededBy, p.orderedDate, p.receivedDate, (taskById(p.taskId) || {}).name || '', ...(money ? [lines.get(p.budgetId) || ''] : []), p.notes, p.createdByName])];
  const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(aoa), 'Parts');
  window.XLSX.writeFile(wb, (S().team.name || 'Team').replace(/[^\w-]+/g, '_') + '_Parts.xlsx');
}

// ════════════════════════════════════════════════════════════════════════════
//  Finance
// ════════════════════════════════════════════════════════════════════════════
/** Totals per budget line and overall. Exported for tests. */
export function financeSummary(b, expenses, parts) {
  const lines = b.lines.map(l => ({ ...l, spent: 0, committed: 0 }));
  const byId = new Map(lines.map(l => [l.id, l])); const other = { id: '', name: 'Not assigned', amount: 0, spent: 0, committed: 0 };
  let spent = 0, income = 0;
  expenses.forEach(x => { if (x.kind === 'income') { income += x.amount; return; } spent += x.amount; (byId.get(x.budgetId) || other).spent += x.amount; });
  // Committed: parts ordered or received (or approved to buy) that no payment covers yet.
  const paid = paidParts(expenses);
  let committed = 0;
  parts.filter(p => (p.status === 'ordered' || p.status === 'received' || (p.status === 'needed' && isApproved(p))) && !paid.has(p.id)).forEach(p => { const v = partTotal(p); committed += v; (byId.get(p.budgetId) || other).committed += v; });
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const r2 = (n) => Math.round(n * 100) / 100;
  return { lines, other, total: r2(total), spent: r2(spent), income: r2(income), committed: r2(committed), remaining: r2(total - spent - committed), balance: r2(income - spent) };
}
async function saveBudget(b) {
  const next = cleanBudget(b);
  return write([{ type: 'set', path: 'finance/budget', data: { ...next, updatedAt: Date.now() } }], ['budget', budgetChanges(budget(), next, names())]);
}
function finance(pane) {
  const s = S();
  if (!seesMoney(s)) { pane.append(el('div.empty-state', {}, '🔒 Only roles with the “See finances” permission can see the budget and spending. Ask the team owner (Settings ▸ Roles).')); return; }
  const b = budget(); const exp = (s.expenses || []); const sum = financeSummary(b, exp, s.parts || []); const edit = editsMoney();
  pane.append(el('div.rs-kpis', {},
    kpi('Budget', fmtMoney(sum.total)), kpi('Spent', fmtMoney(sum.spent)), kpi('Committed (not paid yet)', fmtMoney(sum.committed)),
    kpi('Remaining', fmtMoney(sum.remaining), sum.total && sum.remaining < 0 ? 'bad' : sum.total && sum.remaining < sum.total * 0.1 ? 'warn' : 'good'),
    kpi('Income received', fmtMoney(sum.income))));
  const paid = paidParts(exp);
  const owed = (s.parts || []).filter(p => (p.status === 'ordered' || p.status === 'received') && !paid.has(p.id));
  if (owed.length && cleanFeatures(s.team.features).parts) pane.append(el('div.fin-owed', {},
    el('span', {}, '🔩 ' + owed.length + (owed.length === 1 ? ' part has' : ' parts have') + ' been bought but no payment is recorded (' + fmtMoney(owed.reduce((a, p) => a + partTotal(p), 0)) + '). ' + (owed.length === 1 ? 'It counts' : 'They count') + ' as committed until you record or link a payment.'),
    el('button.btn.small', { type: 'button', id: 'fin-owed-show', onclick: () => { R.tab = 'parts'; R.filters.partStatus = 'unpaid'; render(); } }, 'Show ' + (owed.length === 1 ? 'it' : 'them'))));
  // Budget lines
  const phases = s.team.phases || []; const sts = subteams();
  const lineRow = (l, i) => {
    const used = l.spent + l.committed; const pct = l.amount ? Math.min(100, used / l.amount * 100) : (used ? 100 : 0); const over = l.amount ? used > l.amount : used > 0;
    const setLine = (patch) => saveBudget({ ...b, lines: b.lines.map((x, j) => j === i ? { ...x, ...patch } : x) });
    return el('tr', {},
      el('td', {}, edit ? el('input.fin-line-name', { value: l.name, maxlength: 80, 'aria-label': 'Budget line name', onchange: (e) => setLine({ name: e.target.value }) }) : el('b', {}, l.name)),
      el('td', {}, edit ? el('select', { 'aria-label': 'Phase', onchange: (e) => setLine({ phaseId: e.target.value }) }, el('option', { value: '' }, '—'), phases.map(p => el('option', { value: p.id, selected: l.phaseId === p.id }, p.name))) : ((phases.find(p => p.id === l.phaseId) || {}).name || '')),
      sts.length ? el('td', {}, edit ? el('select.fin-line-team', { 'aria-label': 'Sub-team', onchange: (e) => setLine({ subteamId: e.target.value }) }, el('option', { value: '' }, '—'), sts.map(st => el('option', { value: st.id, selected: l.subteamId === st.id }, st.name))) : subteamChip(l.subteamId)) : '',
      el('td.num', {}, edit ? el('input.fin-line-amount', { type: 'number', min: 0, step: '0.01', value: l.amount, 'aria-label': 'Budget amount', onchange: (e) => setLine({ amount: Number(e.target.value) }) }) : fmtMoney(l.amount)),
      el('td.num', {}, fmtMoney(l.spent)), el('td.num', {}, l.committed ? fmtMoney(l.committed) : '–'),
      el('td.num' + (over ? '.t-bad' : ''), {}, fmtMoney(l.amount - used)),
      el('td.fin-bar-cell', {}, el('div.fin-bar' + (over ? '.over' : ''), {}, el('i', { style: { width: pct.toFixed(1) + '%' } }))),
      el('td', {}, edit ? el('button.btn.small.ghost.fin-del', { type: 'button', title: 'Delete this budget line', 'aria-label': 'Delete budget line ' + l.name, onclick: () => deleteLine(l.id) }, '🗑') : ''));
  };
  const tbl = el('table.rs-table.fin-table', {}, el('tr', {}, ['Budget line', 'Phase', ...(sts.length ? ['Sub-team'] : []), 'Budget', 'Spent', 'Committed', 'Left', '', ''].map(h => el('th', {}, h))), sum.lines.map(lineRow),
    (sum.other.spent || sum.other.committed) ? el('tr.fin-other', {}, el('td', {}, el('i', {}, 'Not assigned')), el('td'), sts.length ? el('td') : '', el('td'), el('td.num', {}, fmtMoney(sum.other.spent)), el('td.num', {}, sum.other.committed ? fmtMoney(sum.other.committed) : '–'), el('td'), el('td'), el('td')) : '');
  pane.append(el('div.rs-card', {},
    el('div.rs-subhead', {}, el('h4', {}, 'Budget'), el('span.spacer'),
      el('label.rs-inline', {}, 'Currency ', el('select', { id: 'fin-currency', disabled: !edit, onchange: (e) => saveBudget({ ...b, currency: e.target.value }) }, CURRENCIES.map(c => el('option', { value: c, selected: b.currency === c }, c)))),
      edit ? el('button.btn.small', { type: 'button', id: 'fin-add-line', onclick: () => saveBudget({ ...b, lines: b.lines.concat({ id: newId('b'), name: 'New budget line', amount: 0, phaseId: '' }) }) }, '＋ Budget line') : ''),
    b.lines.length || sum.other.spent ? el('div.rs-table-wrap', {}, tbl) : el('p.hint', {}, edit ? 'Add budget lines, for example Components, Travel, Printing — optionally one per phase.' : 'No budget set yet.')));
  // Chart + forecast
  pane.append(el('div.rs-card', {}, el('h4', {}, 'Spending over time'), spendChart(sum, exp)));
  // Transactions
  const f = R.filters;
  const list = exp.filter(x => f.txKind === 'all' || x.kind === f.txKind).sort((a, c) => (c.date || '').localeCompare(a.date || '') || c.createdAt - a.createdAt);
  const lineName = new Map(b.lines.map(l => [l.id, l.name]));
  pane.append(el('div.rs-card', {},
    el('div.rs-subhead', {}, el('h4', {}, 'Spending and income'), el('span.spacer'),
      el('select', { 'aria-label': 'Show', onchange: (e) => { f.txKind = e.target.value; render(); } }, [['all', 'All'], ['expense', 'Spending'], ['income', 'Income']].map(([v, t]) => el('option', { value: v, selected: f.txKind === v }, t))),
      el('button.btn.small', { type: 'button', onclick: exportFinance }, '⬇ Export (.xlsx)'),
      edit ? el('button.btn.small', { type: 'button', id: 'fin-add-income', onclick: () => { R.txEdit = { kind: 'income' }; render(); } }, '＋ Income') : '',
      edit ? el('button.btn.small.primary', { type: 'button', id: 'fin-add-expense', onclick: () => { R.txEdit = { kind: 'expense' }; render(); } }, '＋ Spending') : ''),
    R.txEdit ? txForm(R.txEdit) : '',
    list.length ? el('div.rs-table-wrap', {}, el('table.rs-table', {}, el('tr', {}, ['Date', 'What', 'Budget line', 'Paid by', 'Amount', 'Receipt', 'Task', ''].map(h => el('th', {}, h))),
      list.map(x => el('tr.tx-' + x.kind, {},
        el('td', {}, fmtDate(x.date)), el('td', {}, x.description || (x.partIds.length ? '' : '—'), x.partIds.length ? el('div.tx-parts', {}, x.partIds.map(id => el('button.rs-chip.tx-part', { type: 'button', title: 'Paid for this part — show it in Parts', onclick: () => { R.tab = 'parts'; R.filters.partStatus = 'all'; R.filters.partQ = partName(id); render(); } }, '🔩 ' + partName(id)))) : ''),
        el('td', {}, x.kind === 'income' ? el('span.rs-chip.income', {}, 'Income') : (lineName.get(x.budgetId) || el('i.hint', {}, 'Not assigned'))),
        el('td', {}, x.payer), el('td.num' + (x.kind === 'income' ? '.t-good' : ''), {}, (x.kind === 'income' ? '+' : '') + fmtMoney(x.amount)),
        el('td', {}, x.receiptUrl ? el('a', { href: x.receiptUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Link ↗') : x.receiptImage ? el('button.link-btn', { type: 'button', onclick: () => showImage(x.receiptImage, x.description) }, '🧾 View') : ''),
        el('td', {}, x.taskId ? taskChip(x.taskId) : ''),
        el('td', {}, edit ? el('button.btn.small.ghost', { type: 'button', onclick: () => { R.txEdit = x; render(); } }, 'Edit') : ''))))) : el('p.hint', {}, 'Nothing recorded yet.')));
  pane.append(historyCard());
}

// ── Finance history ─────────────────────────────────────────────────────────
const LOG_ICON = { budget: '💷', spending: '🧾', income: '💰', parts: '🔩' };
const LOG_SHOWN = 12;
const when = (at) => { const d = new Date(at); return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' }); };
function historyCard() {
  const f = R.filters; const P = planOf(S().team);
  // Free plan: the last 90 days are shown; older entries are kept (and exported) for when the team moves to Pro.
  const since = P.financeHistoryDays ? Date.now() - P.financeHistoryDays * 864e5 : 0;
  const every = S().financeLog || []; const all = every.filter(e => e.at >= since); const hidden = every.length - all.length;
  const list = all.filter(e => f.logKind === 'all' || e.kind === f.logKind);
  const shown = R.logAll ? list : list.slice(0, LOG_SHOWN);
  return el('div.rs-card.fin-log', {},
    el('div.rs-subhead', {}, el('h4', {}, '🕘 History'), el('span.spacer'),
      el('select', { 'aria-label': 'Show', id: 'fin-log-kind', onchange: (e) => { f.logKind = e.target.value; render(); } }, [['all', 'Everything'], ['budget', 'Budget'], ['spending', 'Spending'], ['income', 'Income'], ['parts', 'Parts']].map(([v, t]) => el('option', { value: v, selected: f.logKind === v }, t)))),
    el('p.hint', {}, 'Every change to the budget, spending, income and parts, with who made it and when. Entries can’t be edited or deleted.'),
    list.length ? el('ul.fin-log-list', {}, shown.map(e => el('li', {}, el('span.fin-log-ic', { 'aria-hidden': 'true' }, LOG_ICON[e.kind] || '•'),
      el('div.fin-log-body', {}, el('div.fin-log-text', {}, e.text), el('div.hint', {}, (e.byName || 'Someone') + ' · ' + when(e.at)))))) :
      el('p.hint', {}, all.length ? 'Nothing of this kind yet.' : 'Changes will be listed here from now on.'),
    hidden ? el('p.hint.fin-log-older', {}, '🔒 ' + hidden + ' older ' + (hidden === 1 ? 'entry is' : 'entries are') + ' kept and included in the Excel export. The Free plan shows the last ' + P.financeHistoryDays + ' days here; Pro shows everything (Settings ▸ Plan).') : '',
    list.length > LOG_SHOWN ? el('button.link-btn', { type: 'button', id: 'fin-log-more', onclick: () => { R.logAll = !R.logAll; render(); } }, R.logAll ? 'Show fewer' : 'Show all ' + list.length) : '');
}

/** Delete a budget line — you type its name to confirm and choose where its spending goes. */
function deleteLine(lineId) {
  const b = budget(); const line = b.lines.find(l => l.id === lineId); if (!line || !editsMoney()) return;
  const plan0 = removeLinePlan(b, lineId, '', S().expenses || [], S().parts || [], names());
  const others = b.lines.filter(l => l.id !== lineId);
  const phrase = line.name.trim();
  const norm = (t) => t.trim().replace(/\s+/g, ' ').toLowerCase();
  let target = '';
  const m = modal('Delete budget line', { narrow: true });
  m.box.classList.add('fin-del-modal');
  const go = el('button.btn.danger', { type: 'button', id: 'fin-del-go', disabled: true }, 'Delete budget line');
  const input = el('input', { id: 'fin-del-confirm', autocomplete: 'off', spellcheck: false, placeholder: phrase, 'aria-label': 'Type the budget line’s name to confirm',
    oninput: () => { go.disabled = norm(input.value) !== norm(phrase); },
    onkeydown: (e) => { if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); go.click(); } } });
  const uses = [plan0.expenses && plan0.expenses + ' spending ' + (plan0.expenses === 1 ? 'entry' : 'entries') + ' (' + fmtMoney(plan0.spent) + ')', plan0.parts && plan0.parts + ' part' + (plan0.parts === 1 ? '' : 's')].filter(Boolean);
  m.body.append(
    el('p', {}, 'You’re about to delete ', el('b', {}, line.name), line.amount ? ' — budget ' + fmtMoney(line.amount) : '', '.'),
    uses.length ? el('label.rs-field', {}, el('span', {}, uses.join(' and ') + (plan0.expenses + plan0.parts === 1 ? ' uses' : ' use') + ' this line. Move to:'),
      el('select', { id: 'fin-del-target', onchange: (e) => { target = e.target.value; } }, el('option', { value: '' }, 'Not assigned'), others.map(l => el('option', { value: l.id }, l.name)))) :
      el('p.hint', {}, 'No spending or parts use this line.'),
    el('label.rs-field', {}, el('span', {}, 'To confirm, type ', el('b.fin-del-phrase', {}, phrase)), input),
    el('p.hint', {}, '🕘 This is recorded in the Finance history. You can undo it straight after.'));
  m.foot.append(el('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Cancel'), go);
  go.addEventListener('click', async () => {
    if (go.disabled) return;
    if (!R) { m.close(); return; }
    const plan = removeLinePlan(budget(), lineId, target, S().expenses || [], S().parts || [], names()); if (!plan) { m.close(); return; }
    go.disabled = true;
    const now = Date.now();
    const ops = [{ type: 'set', path: 'finance/budget', data: { ...cleanBudget(plan.budget), updatedAt: now } }, ...plan.moves.map(mv => ({ type: 'update', path: mv.path, data: { budgetId: mv.to, updatedAt: now } }))];
    if (await write(ops, ['budget', plan.text])) { m.close(); toast('Deleted “' + line.name + '”.', 10000, 'Undo', () => restoreLine(plan)); }
    else go.disabled = false;
  });
  setTimeout(() => input.focus(), 30);
}
async function restoreLine(plan) {
  const b = budget(); if (b.lines.some(l => l.id === plan.line.id)) return;
  const lines = b.lines.slice(); lines.splice(Math.min(plan.index, lines.length), 0, plan.line);
  const now = Date.now();
  const exists = (path) => { const [c, id] = path.split('/'); return ((c === 'expenses' ? S().expenses : S().parts) || []).some(x => x.id === id); };
  const ops = [{ type: 'set', path: 'finance/budget', data: { ...cleanBudget({ ...b, lines }), updatedAt: now } }, ...plan.moves.filter(mv => exists(mv.path)).map(mv => ({ type: 'update', path: mv.path, data: { budgetId: mv.from, updatedAt: now } }))];
  if (await write(ops, ['budget', 'Restored budget line “' + plan.line.name + '”' + (plan.moves.length ? ' and moved its spending and parts back' : '')])) toast('Restored “' + plan.line.name + '”.');
}
function txForm(x) {
  const v = { kind: 'expense', date: today(), amount: '', description: '', budgetId: '', payer: me().name || '', receiptUrl: '', receiptImage: '', taskId: '', partIds: [], ...x };
  const field = (label, input) => el('label.rs-field', {}, el('span', {}, label), input);
  const inp = (k, attrs = {}) => el('input', { value: v[k] ?? '', ...attrs, oninput: (e) => { v[k] = e.target.value; } });
  const lines = budget().lines;
  const photo = el('span.hint', {}, v.receiptImage ? '🧾 Photo attached' : '');
  const pick = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    try { const { imageFileToDataUrl } = await import('./ui.js'); v.receiptImage = await imageFileToDataUrl(file, 1400, 140000); photo.textContent = '🧾 Photo attached'; } catch (err) { toast(err.message, 5000); }
  } });
  const save = async (e) => {
    e.preventDefault();
    const id = x.id || newId('x');
    const before = x.id ? (S().expenses || []).find(e => e.id === x.id) || null : null;
    const data = cleanExpense({ ...v, partIds: v.kind === 'expense' ? v.partIds : [], amount: Number(v.amount), createdBy: x.createdBy || me().uid, createdByName: x.createdByName || (me().name || '').slice(0, 80), createdAt: x.createdAt || Date.now(), updatedAt: Date.now() });
    if (!data.amount) { toast('Enter an amount.'); return; }
    const { id: _, ...doc } = data;
    const n = names(); const ops = [{ type: 'set', path: 'expenses/' + id, data: doc }];
    const logs = [[data.kind === 'income' ? 'income' : 'spending', expenseChanges(before, { ...data, id }, n)]];
    // Parts this pays for: a part still “needed” has clearly been ordered, and a part with no
    // budget line takes this payment's line.
    if (canEdit()) (S().parts || []).filter(p => data.partIds.includes(p.id)).forEach(p => {
      const patch = {};
      if (p.status === 'needed') { patch.status = 'ordered'; if (!p.orderedDate) patch.orderedDate = data.date || today(); }
      if (!p.budgetId && data.budgetId) patch.budgetId = data.budgetId;
      if (!Object.keys(patch).length) return;
      ops.push({ type: 'update', path: 'parts/' + p.id, data: { ...patch, updatedAt: Date.now() } });
      logs.push(['parts', partChanges(p, { ...p, ...patch }, n)]);
    });
    if (await write(ops, logs)) { R.txEdit = null; render(); }
  };
  const linked = (v.partIds || []).filter(id => (S().parts || []).some(p => p.id === id) || x.id);
  const relink = (ids) => { R.txEdit = withParts(v, ids); render(); };
  return el('form.rs-form', { onsubmit: save },
    el('h4', {}, (x.id ? 'Edit ' : 'New ') + (v.kind === 'income' ? 'income' : 'spending')),
    el('div.rs-grid', {},
      field('Amount', inp('amount', { type: 'number', min: 0, step: '0.01', required: true, id: 'tx-amount' })), field('Date', inp('date', { type: 'date' })),
      field(v.kind === 'income' ? 'Source (e.g. grant)' : 'What was bought', inp('description', { maxlength: 300, id: 'tx-desc' })),
      v.kind === 'expense' ? field('Budget line', el('select', { id: 'tx-line', onchange: (e) => { v.budgetId = e.target.value; } }, el('option', { value: '' }, 'Not assigned'), lines.map(l => el('option', { value: l.id, selected: v.budgetId === l.id }, l.name)))) : '',
      v.kind === 'expense' ? field('Paid by', inp('payer', { maxlength: 80 })) : '',
      field('Receipt link', inp('receiptUrl', { type: 'url', placeholder: 'https://…' })),
      field('Receipt photo', el('div.rs-inline', {}, el('button.btn.small', { type: 'button', onclick: () => pick.click() }, '📷 Add photo'), photo, pick)),
      field('Task', el('div.rs-inline', {}, v.taskId ? taskChip(v.taskId) : el('span.hint', {}, 'None'), el('button.btn.small', { type: 'button', onclick: () => pickTask('Which task was this for?', (id) => { R.txEdit = { ...v, taskId: id }; render(); }) }, v.taskId ? 'Change' : 'Link a task'))),
      v.kind === 'expense' && cleanFeatures(S().team.features).parts ? el('div.rs-field.tx-parts-field', {}, el('span', {}, 'Parts this paid for'),
        el('div.rs-inline.tx-parts', {}, linked.map(id => el('span.rs-chip.tx-part', {}, '🔩 ' + partName(id),
          el('button.chip-x', { type: 'button', title: 'Unlink', 'aria-label': 'Unlink ' + partName(id), onclick: () => relink(linked.filter(k => k !== id)) }, '✕'))),
          linked.length < 30 ? el('button.btn.small', { type: 'button', id: 'tx-link-part', onclick: () => pickPart(v, (p) => relink([...linked, p.id])) }, linked.length ? '＋ Another part' : '🔩 Link parts') : '',
          !linked.length ? el('span.hint', {}, 'Link the parts this bought so they show as paid.') : '')) : ''),
    el('div.rs-form-foot', {},
      x.id ? el('button.btn.small.danger', { type: 'button', onclick: async () => { if (!confirm('Delete this entry?')) return; const before = (S().expenses || []).find(e => e.id === x.id) || x; if (await write([{ type: 'delete', path: 'expenses/' + x.id }], [before.kind === 'income' ? 'income' : 'spending', expenseChanges(before, null, names())])) { R.txEdit = null; render(); } } }, 'Delete') : '',
      el('span.spacer'), el('button.btn.small.ghost', { type: 'button', onclick: () => { R.txEdit = null; render(); } }, 'Cancel'), el('button.btn.small.primary', { type: 'submit' }, 'Save')));
}
function showImage(src, title) {
  const m = modal(title || 'Image'); m.body.append(el('img.rs-bigimg', { src, alt: title || '' }));
}
/** Cumulative spending against the budget, with a burn-rate forecast. */
function spendChart(sum, exp) {
  const out = exp.filter(x => x.kind === 'expense' && x.date).sort((a, b) => a.date.localeCompare(b.date));
  if (!out.length) return el('p.hint', {}, 'The chart appears once spending is recorded.');
  const weeks = (S().team.weeks || []).filter(w => w.startDate);
  const start = [out[0].date, weeks[0] && weeks[0].startDate].filter(Boolean).sort()[0];
  const projEnd = weeks.length ? new Date(new Date(weeks[weeks.length - 1].startDate + 'T12:00:00').getTime() + 6 * 864e5).toLocaleDateString('en-CA') : '';
  const end = [today(), out[out.length - 1].date, projEnd].filter(Boolean).sort().pop();
  const day = (iso) => Math.round((new Date(iso + 'T12:00:00') - new Date(start + 'T12:00:00')) / 864e5);
  const span = Math.max(7, day(end));
  let run = 0; const pts = [[0, 0]]; out.forEach(x => { run += x.amount; pts.push([day(x.date), run]); });
  const top = Math.max(sum.total, run) * 1.1 || 1;
  const W = 640, H = 210, L = 64, Rr = 12, T = 12, B = 30, iw = W - L - Rr, ih = H - T - B;
  const X = (d) => L + d / span * iw, Y = (v) => T + ih - v / top * ih;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'fin-chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Spending over time');
  const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); if (text) n.textContent = text; svg.appendChild(n); return n; };
  [0, 0.5, 1].forEach(f => { add('line', { x1: L, x2: W - Rr, y1: Y(top * f / 1.1), y2: Y(top * f / 1.1), class: 'bd-grid' }); add('text', { x: L - 6, y: Y(top * f / 1.1) + 4, 'text-anchor': 'end', class: 'bd-tick' }, fmtMoney(top * f / 1.1)); });
  if (sum.total) { add('line', { x1: L, x2: W - Rr, y1: Y(sum.total), y2: Y(sum.total), class: 'fin-budget' }); add('text', { x: W - Rr, y: Y(sum.total) - 5, 'text-anchor': 'end', class: 'bd-tick' }, 'Budget ' + fmtMoney(sum.total)); }
  let d = ''; pts.forEach(([dd, v], i) => { d += (i ? ' L' : 'M') + X(dd).toFixed(1) + ' ' + Y(i ? pts[i - 1][1] : 0).toFixed(1) + (i ? ' L' + X(dd).toFixed(1) + ' ' + Y(v).toFixed(1) : ''); });
  d += ' L' + X(Math.min(span, day(today()))).toFixed(1) + ' ' + Y(run).toFixed(1);
  add('path', { d, class: 'fin-spent' });
  add('text', { x: L, y: H - 8, class: 'bd-tick' }, fmtDate(start)); add('text', { x: W - Rr, y: H - 8, 'text-anchor': 'end', class: 'bd-tick' }, fmtDate(end));
  // Forecast from the last 8 weeks of spending
  const since = new Date(Date.now() - 56 * 864e5).toLocaleDateString('en-CA');
  const recent = out.filter(x => x.date >= since).reduce((a, x) => a + x.amount, 0); const perWeek = recent / 8;
  let fc = 'Spending in the last 8 weeks: ' + fmtMoney(recent) + ' (about ' + fmtMoney(perWeek) + ' a week).';
  if (sum.total && perWeek > 0) {
    const left = sum.total - sum.spent - sum.committed; const weeksLeft = left / perWeek;
    const runsOut = new Date(Date.now() + weeksLeft * 7 * 864e5).toLocaleDateString('en-CA');
    fc += left <= 0 ? ' ⚠ The budget is already used up.' : ' At this rate the budget lasts until about ' + fmtDate(runsOut) + (projEnd ? (runsOut < projEnd ? ' — ⚠ before the last week ends (' + fmtDate(projEnd) + ').' : ' — 👍 past the last week (' + fmtDate(projEnd) + ').') : '.');
  }
  return el('div', {}, svg, el('p.fin-forecast', {}, fc), el('div.an-legend', {}, el('span', {}, el('i.bd-key.actual'), 'Spent so far'), sum.total ? el('span', {}, el('i.bd-key.ideal'), 'Budget') : ''));
}
function exportFinance() {
  if (!window.XLSX) { toast('Export isn’t ready yet — try again in a moment.'); return; }
  const s = S(); const b = budget(); const sum = financeSummary(b, s.expenses || [], s.parts || []); const X = window.XLSX;
  const lineName = new Map(b.lines.map(l => [l.id, l.name]));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Team', s.team.name], ['Currency', b.currency], ['Generated', today()], [], ['Budget', sum.total], ['Spent', sum.spent], ['Committed (not paid yet)', sum.committed], ['Remaining', sum.remaining], ['Income received', sum.income], ['Balance (income − spent)', sum.balance]]), 'Summary');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Budget line', 'Phase', 'Budget', 'Spent', 'Committed', 'Left'], ...sum.lines.map(l => [l.name, ((s.team.phases || []).find(p => p.id === l.phaseId) || {}).name || '', l.amount, l.spent, l.committed, l.amount - l.spent - l.committed]), ['Not assigned', '', 0, sum.other.spent, sum.other.committed, '']]), 'Budget');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Date', 'Type', 'What', 'Parts', 'Budget line', 'Paid by', 'Amount', 'Receipt link', 'Task', 'Recorded by'], ...(s.expenses || []).slice().sort((a, c) => (a.date || '').localeCompare(c.date || '')).map(x => [x.date, x.kind === 'income' ? 'Income' : 'Spending', x.description, x.partIds.map(partName).join(', '), lineName.get(x.budgetId) || '', x.payer, x.kind === 'income' ? x.amount : -x.amount, x.receiptUrl, (taskById(x.taskId) || {}).name || '', x.createdByName])]), 'Transactions');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['When', 'Who', 'Area', 'What changed'], ...(s.financeLog || []).slice().sort((a, c) => a.at - c.at).map(e => [new Date(e.at).toLocaleString('en-GB'), e.byName, e.kind, e.text])]), 'History');
  X.writeFile(wb, (s.team.name || 'Team').replace(/[^\w-]+/g, '_') + '_Finance_' + today() + '.xlsx');
}

// ════════════════════════════════════════════════════════════════════════════
//  Literature
// ════════════════════════════════════════════════════════════════════════════
/** Look up a DOI on Crossref (free, no key). Returns paper fields or throws. */
export async function lookupDoi(raw) {
  const doi = String(raw || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) throw new Error('That doesn’t look like a DOI (they start with 10.…).');
  const r = await fetch('https://api.crossref.org/works/' + encodeURIComponent(doi), { headers: { Accept: 'application/json' } });
  if (r.status === 404) throw new Error('No paper found for that DOI.');
  if (!r.ok) throw new Error('Crossref didn’t answer (' + r.status + '). Try again or add it by hand.');
  const w = (await r.json()).message || {};
  const year = ((w.issued || w.published || w['published-print'] || w['published-online'] || {})['date-parts'] || [[null]])[0][0];
  return { title: (w.title || [''])[0], authors: (w.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ') || a.name).filter(Boolean).join(', '), year, venue: (w['container-title'] || [''])[0] || w.publisher || '', doi, url: w.URL || 'https://doi.org/' + doi };
}
/** Parse BibTeX text into paper fields (handles {braces} and "quotes"). */
export function parseBibtex(text) {
  const out = []; const src = String(text || '');
  const re = /@(\w+)\s*\{/g; let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 1; while (i < src.length && depth > 0) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
    const whole = src.slice(re.lastIndex, i - 1); re.lastIndex = i;
    if (/^(comment|preamble|string)$/i.test(m[1])) continue;
    const comma = whole.indexOf(','); if (comma < 0) continue;
    const body = whole.slice(comma + 1); m[2] = whole.slice(0, comma);
    const f = {}; const fr = /(\w+)\s*=\s*/g; let g;
    while ((g = fr.exec(body))) {
      let j = fr.lastIndex, val = '';
      if (body[j] === '{') { let d = 1; j++; const st = j; while (j < body.length && d > 0) { if (body[j] === '{') d++; else if (body[j] === '}') d--; j++; } val = body.slice(st, j - 1); }
      else if (body[j] === '"') { j++; const st = j; while (j < body.length && body[j] !== '"') j++; val = body.slice(st, j); j++; }
      else { const st = j; while (j < body.length && body[j] !== ',') j++; val = body.slice(st, j).trim(); }
      f[g[1].toLowerCase()] = val.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim(); fr.lastIndex = j;
    }
    if (!f.title) continue;
    out.push({ title: f.title, authors: (f.author || '').split(/\s+and\s+/i).map(a => a.includes(',') ? a.split(',').reverse().map(x => x.trim()).join(' ') : a).join(', '), year: f.year, venue: f.journal || f.booktitle || f.publisher || '', doi: f.doi || '', url: f.url || '', key: m[2].trim() });
  }
  return out;
}
/** BibTeX for a list of papers. */
export function toBibtex(papers) {
  const used = new Set();
  const esc = (s) => String(s || '').replace(/[{}]/g, '');
  return papers.map(p => {
    const first = (p.authors.split(',')[0] || 'anon').trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, '') || 'anon';
    let key = first + (p.year || '') + (p.title.split(/\s+/).find(w => w.length > 3) || '').toLowerCase().replace(/[^a-z]/g, ''); let k = key, n = 2; while (used.has(k)) k = key + n++; used.add(k);
    const fields = [['title', p.title], ['author', p.authors.split(',').map(a => a.trim()).filter(Boolean).join(' and ')], ['year', p.year], [p.venue ? 'journal' : '', p.venue], ['doi', p.doi], ['url', p.url]].filter(([f, v]) => f && v);
    return '@article{' + k + ',\n' + fields.map(([f, v]) => '  ' + f + ' = {' + esc(v) + '}').join(',\n') + '\n}';
  }).join('\n\n') + '\n';
}
async function savePaper(id, fields) {
  const pid = id || newId('pp'); const before = (S().papers || []).find(p => p.id === pid) || {};
  const data = cleanPaper({ ...before, ...fields, addedBy: before.addedBy || me().uid, addedByName: before.addedByName || (me().name || '').slice(0, 80), createdAt: before.createdAt || Date.now(), updatedAt: Date.now() });
  if (!data.title) { toast('A title is needed.'); return false; }
  const { id: _, ...doc } = data;
  return write([{ type: 'set', path: 'papers/' + pid, data: doc }]);
}
function literature(pane) {
  const all = S().papers || []; const f = R.filters; const edit = canEdit();
  const tags = [...new Set(all.flatMap(p => p.tags))].sort();
  const q = f.paperQ.trim().toLowerCase();
  const rows = all.filter(p => (f.paperStatus === 'all' || p.status === f.paperStatus) && (!f.paperTag || p.tags.includes(f.paperTag)) && (!q || [p.title, p.authors, p.venue, p.notes, p.doi, p.tags.join(' ')].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => PAPER_STATUS.indexOf(a.status) - PAPER_STATUS.indexOf(b.status) || (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title));
  pane.append(el('div.rs-kpis', {}, kpi('Sources', String(all.length)), kpi('To read', String(all.filter(p => p.status === 'to-read').length)), kpi('Reading', String(all.filter(p => p.status === 'reading').length)), kpi('Read', String(all.filter(p => p.status === 'read').length), 'good')));
  if (edit) {
    const doi = el('input.rs-doi', { id: 'lit-doi', placeholder: 'Paste a DOI or doi.org link, e.g. 10.1038/s41586-021-03819-2', 'aria-label': 'DOI' });
    const go = el('button.btn.small.primary', { type: 'button', id: 'lit-doi-add' }, 'Add by DOI');
    const run = async () => {
      if (!doi.value.trim()) return; go.disabled = true; go.textContent = 'Looking up…';
      try { const p = await lookupDoi(doi.value); if (all.some(x => x.doi && x.doi.toLowerCase() === p.doi.toLowerCase())) { toast('That paper is already in the list.'); } else if (await savePaper(null, p)) { toast('Added “' + p.title.slice(0, 60) + '”.'); doi.value = ''; } }
      catch (e) { toast(e.message, 6000); } finally { go.disabled = false; go.textContent = 'Add by DOI'; }
    };
    go.onclick = run; doi.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    pane.append(el('div.rs-bar', {}, doi, go, el('button.btn.small', { type: 'button', onclick: () => { R.paperEdit = 'new'; render(); } }, '＋ Add by hand'), el('button.btn.small', { type: 'button', id: 'lit-bib-in', onclick: importBib }, '⬆ Import BibTeX')));
  }
  pane.append(el('div.rs-bar', {},
    el('input.rs-search', { type: 'search', placeholder: 'Search titles, authors, notes, tags…', value: f.paperQ, 'aria-label': 'Search literature', oninput: (e) => { f.paperQ = e.target.value; const pos = e.target.selectionStart; render(); const n = R.m.box.querySelector('.rs-search'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } } }),
    el('select', { 'aria-label': 'Reading status', onchange: (e) => { f.paperStatus = e.target.value; render(); } }, [['all', 'All'], ...PAPER_STATUS.map(s => [s, PAPER_LABEL[s]])].map(([v, t]) => el('option', { value: v, selected: f.paperStatus === v }, t))),
    tags.length ? el('select', { 'aria-label': 'Tag', onchange: (e) => { f.paperTag = e.target.value; render(); } }, el('option', { value: '' }, 'Any tag'), tags.map(t => el('option', { value: t, selected: f.paperTag === t }, '#' + t))) : '',
    el('span.spacer'),
    el('button.btn.small', { type: 'button', id: 'lit-bib-out', disabled: !rows.length, onclick: () => exportBib(rows) }, '⬇ BibTeX (' + rows.length + ')')));
  if (R.paperEdit) pane.append(paperForm(R.paperEdit === 'new' ? null : all.find(p => p.id === R.paperEdit)));
  if (!rows.length) { pane.append(el('div.empty-state', {}, all.length ? 'Nothing matches.' : 'No papers yet. Paste a DOI above, add one by hand, or import a BibTeX file from Zotero, Mendeley or Google Scholar.')); return; }
  pane.append(el('div.lit-list', {}, rows.map(p => el('div.lit-item.st-' + p.status, { dataset: { id: p.id } },
    el('div.lit-main', {},
      el('div.lit-title', {}, p.url || p.doi ? el('a', { href: p.url || 'https://doi.org/' + p.doi, target: '_blank', rel: 'noopener noreferrer' }, p.title) : p.title),
      el('div.lit-meta', {}, [p.authors, p.year, p.venue].filter(Boolean).join(' · ')),
      p.tags.length ? el('div.lit-tags', {}, p.tags.map(t => el('button.rs-chip.link', { type: 'button', onclick: () => { f.paperTag = t; render(); } }, '#' + t))) : '',
      p.notes ? el('div.lit-notes', {}, p.notes) : '',
      p.taskIds.length ? el('div.lit-tasks', {}, taskChips(p.taskIds)) : ''),
    el('div.lit-side', {},
      edit ? el('select.lit-status', { 'aria-label': 'Reading status', onchange: (e) => savePaper(p.id, { status: e.target.value }) }, PAPER_STATUS.map(s => el('option', { value: s, selected: p.status === s }, PAPER_LABEL[s]))) : el('span.rs-chip', {}, PAPER_LABEL[p.status]),
      edit ? el('button.btn.small.ghost', { type: 'button', onclick: () => { R.paperEdit = p.id; render(); } }, 'Edit') : '',
      edit ? el('button.btn.small.ghost', { type: 'button', title: 'Link this source to a task', onclick: () => pickTask('Which task does this source support?', (id) => savePaper(p.id, { taskIds: linkedTo(p.taskIds, id) ? p.taskIds : p.taskIds.concat(id) })) }, '🔗 Task') : '')))));
}
function paperForm(p) {
  p = p || cleanPaper({}); const v = { ...p, tags: p.tags.join(', ') };
  const field = (label, input) => el('label.rs-field', {}, el('span', {}, label), input);
  const inp = (k, attrs = {}) => el('input', { value: v[k] ?? '', ...attrs, oninput: (e) => { v[k] = e.target.value; } });
  return el('form.rs-form', { onsubmit: async (e) => { e.preventDefault(); if (await savePaper(p.id || null, { ...v, tags: String(v.tags).split(',') })) { R.paperEdit = null; render(); } } },
    el('h4', {}, p.id ? 'Edit source' : 'New source'),
    el('div.rs-grid', {}, field('Title', inp('title', { required: true, maxlength: 500, id: 'pp-title' })), field('Authors', inp('authors', { maxlength: 500, placeholder: 'Ada Lovelace, Alan Turing' })),
      field('Year', inp('year', { type: 'number', min: 1000, max: 2200 })), field('Journal / venue', inp('venue', { maxlength: 200 })),
      field('DOI', inp('doi', { maxlength: 200 })), field('Link', inp('url', { type: 'url' })), field('Tags (comma separated)', inp('tags', { placeholder: 'control, grasping' }))),
    field('Notes', el('textarea', { rows: 3, maxlength: 5000, oninput: (e) => { v.notes = e.target.value; } }, v.notes || '')),
    p.taskIds.length ? el('div.rs-inline', {}, el('span.hint', {}, 'Linked tasks:'), uniqueChains(p.taskIds, carryIndexOf(S())).map(id => el('span.rs-chip', {}, ((taskById(id) || {}).name || 'Deleted task') + ' ', el('button.link-btn', { type: 'button', 'aria-label': 'Unlink', onclick: () => { const ix = carryIndexOf(S()); p.taskIds = p.taskIds.filter(x => !ix.same(x, id)); savePaper(p.id, { taskIds: p.taskIds }); } }, '✕')))) : '',
    el('div.rs-form-foot', {},
      p.id && (p.addedBy === me().uid || perm('team.settings')) ? el('button.btn.small.danger', { type: 'button', onclick: async () => { if (!confirm('Remove this source?')) return; if (await write([{ type: 'delete', path: 'papers/' + p.id }])) { R.paperEdit = null; render(); } } }, 'Delete') : '',
      el('span.spacer'), el('button.btn.small.ghost', { type: 'button', onclick: () => { R.paperEdit = null; render(); } }, 'Cancel'), el('button.btn.small.primary', { type: 'submit' }, 'Save')));
}
function importBib() {
  const m = modal('Import BibTeX', { narrow: true });
  const ta = el('textarea', { rows: 10, id: 'bib-text', placeholder: '@article{key,\n  title = {…},\n  author = {…},\n  year = {2024}\n}', style: { width: '100%' } });
  const file = el('input', { type: 'file', accept: '.bib,.txt,text/plain', onchange: async (e) => { const f = e.target.files && e.target.files[0]; if (f) ta.value = await f.text(); } });
  m.body.append(el('p.hint', {}, 'Paste BibTeX, or choose a .bib file exported from Zotero, Mendeley or Google Scholar.'), file, ta);
  m.foot.append(el('span.spacer'), el('button.btn.primary', { type: 'button', id: 'bib-go', onclick: async () => {
    const items = parseBibtex(ta.value); if (!items.length) { toast('No BibTeX entries found.'); return; }
    const have = new Set((S().papers || []).map(p => (p.doi || p.title).toLowerCase()));
    const fresh = items.filter(p => !have.has((p.doi || p.title).toLowerCase())).slice(0, 200);
    const ops = fresh.map(p => { const d = cleanPaper({ ...p, addedBy: me().uid, addedByName: (me().name || '').slice(0, 80), createdAt: Date.now(), updatedAt: Date.now() }); const { id, ...doc } = d; return { type: 'set', path: 'papers/' + newId('pp'), data: doc }; });
    if (ops.length && !(await write(ops))) return;
    m.close(); toast('Imported ' + fresh.length + ' source' + (fresh.length === 1 ? '' : 's') + (items.length > fresh.length ? ' (' + (items.length - fresh.length) + ' already in the list)' : '') + '.');
  } }, 'Import'));
}
function exportBib(rows) { download((S().team.name || 'team').replace(/[^\w-]+/g, '_') + '_references.bib', toBibtex(rows), 'application/x-bibtex'); }

// Shared helpers for the extra tools (tools-extra.js)
export const kit = {
  get R() { return R; }, S: () => S(), me: () => me(), perm, canEdit, write, kpi, taskChip, pickTask, download, today, fmtDate, render: () => render(), memberName, taskById, taskChips, linkedTo,
};
