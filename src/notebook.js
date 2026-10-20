// ─────────────────────────────────────────────────────────────────────────────
//  Lab notebook on each task: dated entries with text and up to four photos,
//  newest first. Anyone who can edit tasks can add an entry (like comments);
//  only its author edits it. Also the "Linked" list (parts, sources, meeting
//  actions that point at a task).
// ─────────────────────────────────────────────────────────────────────────────
import { el, toast, modal, imageFileToDataUrl } from './ui.js';
import { newId, cleanNotebookEntry, RESEARCH_LIMITS, carryIndexOf } from './model.js';
import { can } from './permissions.js';

const today = () => new Date().toLocaleDateString('en-CA');
const fmtDate = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
const drafts = new Map();   // taskId → { text, date, images } while the editor is redrawn

/** Ids of every carried-forward copy of a task: entries and links on any copy belong to all of them. */
const chainIds = (s, taskId) => new Set(carryIndexOf(s).ids(taskId));
/** "WEEK 5" for an entry written on another week's copy of this task ('' for this copy). */
function otherWeek(s, entryTaskId, taskId) {
  if (entryTaskId === taskId) return '';
  const t = (s.tasks || []).find(x => x.id === entryTaskId); const w = t && (s.team.weeks || []).find(x => x.key === t.weekId);
  return w ? w.title : 'an earlier week';
}

export function notebookCount(session, taskId) { if (!session || !session.notebook) return 0; const ids = chainIds(session, taskId); return session.notebook.filter(n => ids.has(n.taskId)).length; }

export function notebookSection(ctx, taskId) {
  const { session: s, user } = ctx;
  const mayWrite = can(s.team, s.me, 'tasks.editOwn') || can(s.team, s.me, 'tasks.editAll');
  const ids = chainIds(s, taskId);
  const entries = (s.notebook || []).filter(n => ids.has(n.taskId)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  const box = el('div.panel-section.nb-section');
  box.append(el('h4', {}, '📓 Lab notebook', entries.length ? el('span.count-pill', {}, String(entries.length)) : ''));
  if (mayWrite) box.append(composer(ctx, taskId));
  if (!entries.length) box.append(el('p.hint', {}, mayWrite ? 'Record what you tried, measured and found — with photos of set-ups and results.' : 'No entries yet.'));
  entries.forEach(n => box.append(entryView(ctx, n, n.authorUid === user.uid, can(s.team, s.me, 'members.manage'), otherWeek(s, n.taskId, taskId))));
  return box;
}
function composer(ctx, taskId, existing) {
  const d = existing ? { text: existing.text, date: existing.date, images: existing.images.slice() } : (drafts.get(taskId) || { text: '', date: today(), images: [] });
  const keep = () => { if (!existing) drafts.set(taskId, d); };
  const date = el('input.nb-date', { type: 'date', value: d.date, 'aria-label': 'Entry date', onchange: (e) => { d.date = e.target.value; keep(); } });
  const ta = el('textarea.nb-text', { rows: existing ? 4 : 3, maxlength: RESEARCH_LIMITS.notebookText, placeholder: 'What did you do, measure or find?', 'aria-label': 'Notebook entry', oninput: (e) => { d.text = e.target.value; keep(); } });
  ta.value = d.text;
  const thumbs = el('div.nb-thumbs');
  const drawThumbs = () => thumbs.replaceChildren(...d.images.map((src, i) => el('span.nb-thumb', {}, el('img', { src, alt: 'Photo ' + (i + 1) }), el('button.nb-thumb-x', { type: 'button', 'aria-label': 'Remove photo', onclick: () => { d.images.splice(i, 1); keep(); drawThumbs(); } }, '✕'))));
  drawThumbs();
  const file = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async (e) => {
    for (const f of [...(e.target.files || [])]) {
      if (d.images.length >= RESEARCH_LIMITS.notebookImages) { toast('Up to ' + RESEARCH_LIMITS.notebookImages + ' photos per entry.'); break; }
      try { d.images.push(await imageFileToDataUrl(f, 1280, 140000)); } catch (err) { toast(err.message, 5000); }
    }
    e.target.value = ''; keep(); drawThumbs();
  } });
  const save = el('button.btn.small.primary', { type: 'button' }, existing ? 'Save' : 'Add entry');
  save.onclick = async () => {
    if (!d.text.trim() && !d.images.length) { toast('Write something or add a photo first.'); return; }
    const { user, session: s } = ctx;
    const id = existing ? existing.id : newId('nb');
    const data = cleanNotebookEntry({ taskId, authorUid: existing ? existing.authorUid : user.uid, authorName: existing ? existing.authorName : (user.name || user.email || '').slice(0, 80), date: d.date || today(), text: d.text, images: d.images,
      createdAt: existing ? existing.createdAt : Date.now(), editedAt: existing ? Date.now() : 0 });
    const { id: _, ...doc } = data; if (!doc.editedAt) delete doc.editedAt;
    if (JSON.stringify(doc).length > 900000) { toast('This entry is too large — remove a photo.'); return; }
    save.disabled = true;
    const ok = await ctx.writeOps([{ type: 'set', path: 'notebook/' + id, data: doc }]);
    save.disabled = false;
    if (ok) { drafts.delete(taskId); if (!existing) { d.text = ''; d.images = []; ta.value = ''; drawThumbs(); } toast(existing ? 'Entry saved.' : 'Added to the notebook.'); void s; }
  };
  return el('div.nb-composer', {}, el('div.nb-row', {}, date, el('span.spacer'), el('button.btn.small', { type: 'button', onclick: () => file.click() }, '📷 Photos'), save), ta, thumbs, file);
}
function entryView(ctx, n, mine, moderator, fromWeek = '') {
  const box = el('div.nb-entry', { dataset: { id: n.id } });
  const body = el('div.nb-body', {}, n.text);
  const imgs = n.images.length ? el('div.nb-thumbs', {}, n.images.map((src, i) => el('button.nb-thumb', { type: 'button', 'aria-label': 'Open photo ' + (i + 1), onclick: () => { const m = modal(fmtDate(n.date) + ' · ' + n.authorName); m.body.append(el('img.rs-bigimg', { src, alt: '' })); } }, el('img', { src, alt: '' })))) : '';
  const actions = el('span.nb-actions');
  if (mine) actions.append(el('button.link-btn', { type: 'button', onclick: () => box.replaceChildren(composer(ctx, n.taskId, n)) }, 'Edit'));
  if (mine || moderator) actions.append(el('button.link-btn', { type: 'button', onclick: async () => { if (confirm('Delete this notebook entry?')) await ctx.writeOps([{ type: 'delete', path: 'notebook/' + n.id }]); } }, 'Delete'));
  box.append(el('div.nb-head', {}, el('b', {}, fmtDate(n.date)), el('span.hint', {}, ' · ' + n.authorName + (n.editedAt ? ' · edited' : '')), fromWeek ? el('span.nb-from', { title: 'Written on this task’s copy in ' + fromWeek + ' (carried forward)' }, '↪ ' + fromWeek) : '', el('span.spacer'), actions), body, imgs);
  return box;
}

/** Parts, sources and meeting actions linked to a task (read-only, each opens Research). */
export function linkedSection(ctx, taskId) {
  const s = ctx.session; const TT = ctx.TT;
  const on = (k) => TT.feature(k);
  // Anything linked to ANY carried-forward copy of this task shows on every copy.
  const ids = chainIds(s, taskId); const hit = (list) => (list || []).some(id => ids.has(id));
  const parts = on('parts') ? (s.parts || []).filter(p => ids.has(p.taskId)) : [];
  const papers = on('literature') ? (s.papers || []).filter(p => hit(p.taskIds)) : [];
  const meets = on('meetings') ? (s.meetings || []).filter(m => m.actions.some(a => ids.has(a.taskId))) : [];
  const risks = on('risks') ? (s.risks || []).filter(r => hit(r.taskIds)) : [];
  const reqs = on('requirements') ? (s.requirements || []).filter(q => hit(q.taskIds)) : [];
  const spend = on('finance') && TT.can('finance.view') ? (s.expenses || []).filter(x => ids.has(x.taskId)) : [];
  if (!parts.length && !papers.length && !meets.length && !risks.length && !reqs.length && !spend.length) return null;
  const box = el('div.panel-section.linked-section', {}, el('h4', {}, '🔗 Linked'));
  const row = (icon, text, sub, tab) => el('button.linked-item', { type: 'button', onclick: () => TT.openResearch(tab) }, el('span', {}, icon + ' ' + text), sub ? el('span.hint', {}, sub) : '');
  parts.forEach(p => box.append(row('🔩', p.name + (p.qty > 1 ? ' × ' + p.qty : ''), { needed: 'Needed', ordered: 'Ordered', received: 'Received', cancelled: 'Cancelled' }[p.status], 'parts')));
  papers.forEach(p => box.append(row('📚', p.title, [p.authors.split(',')[0], p.year].filter(Boolean).join(' · '), 'literature')));
  meets.forEach(m => box.append(row('📝', m.title, 'action from ' + (m.date || 'a meeting'), 'meetings')));
  reqs.forEach(q => box.append(row('📐', q.ref + ' ' + q.title, (q.verified ? '✓ verified' : 'not yet verified'), 'requirements')));
  risks.forEach(r => box.append(row('⚠️', r.title, 'risk score ' + (r.likelihood * r.impact) + ' · ' + r.status, 'risks')));
  spend.forEach(x => box.append(row(x.kind === 'income' ? '💰' : '💷', x.description || (x.kind === 'income' ? 'Income' : 'Spending'), (x.date || '') + ' · £' + Number(x.amount || 0).toFixed(2), 'finance')));
  return box;
}
