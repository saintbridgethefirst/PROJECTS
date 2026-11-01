// ─────────────────────────────────────────────────────────────────────────────
//  Settings ▸ Audit trail (Penteint Projects). Shows the server's record of every change
//  to the team (functions/audit.js), checks the hash chain in the browser, and exports CSV.
//  Only roles with 'See the audit trail' get here; the rules refuse everyone else.
// ─────────────────────────────────────────────────────────────────────────────
import { el, toast } from './ui.js';
import { auditKind, verifyChain, auditCsv } from '../functions/auditlib.js';

const PAGE = 100;
let watch = null;   // { teamId, unsub, entries, error, listeners:Set }

/** Stop listening (Settings closed or the team changed). */
export function stopAuditWatch() { if (watch) { watch.unsub(); watch = null; } }

function ensureWatch(ctx) {
  const teamId = ctx.session.teamId;
  if (watch && watch.teamId === teamId) return watch;
  stopAuditWatch();
  const w = { teamId, entries: null, error: null, listeners: new Set(), unsub: () => {} };
  watch = w;
  w.unsub = ctx.backend.data.watchAudit(teamId, (list) => { w.entries = list; w.error = null; w.listeners.forEach(fn => fn()); },
    (e) => { w.error = e; w.listeners.forEach(fn => fn()); });
  return w;
}

const ACTION = { create: 'Created', update: 'Changed', delete: 'Deleted' };
const when = (at) => new Date(at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const changeText = (c) => (c.from !== undefined ? `${c.f}: ${c.from || '—'} → ${c.to || '—'}` : `${c.f} changed`);

export function auditPane(pane, ctx) {
  const w = ensureWatch(ctx);
  const state = { q: '', kind: '', who: '', shown: PAGE };
  const status = el('div.audit-check', { role: 'status' });
  const list = el('div.audit-list');
  const kindSel = el('select', { 'aria-label': 'Record type', onchange: (e) => { state.kind = e.target.value; state.shown = PAGE; draw(); } });
  const whoSel = el('select', { 'aria-label': 'Person', onchange: (e) => { state.who = e.target.value; state.shown = PAGE; draw(); } });
  const search = el('input', { type: 'search', placeholder: 'Search records and changes', 'aria-label': 'Search the audit trail', oninput: (e) => { state.q = e.target.value.trim().toLowerCase(); state.shown = PAGE; draw(); } });
  const exportBtn = el('button.btn.small', { type: 'button', onclick: () => {
    const rows = filtered(); if (!rows.length) { toast('Nothing to export.'); return; }
    const name = (ctx.session.team.name || 'team').replace(/[^\w-]+/g, '-').slice(0, 40);
    const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + auditCsv(rows)], { type: 'text/csv;charset=utf-8' })), download: `audit-trail-${name}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Exported ' + rows.length + ' entries.');
  } }, 'Export CSV');

  pane.append(el('section.audit', {},
    el('h4', {}, 'Audit trail'),
    el('p.hint', {}, 'Every change to this team, recorded by the server as it is saved. Nobody can edit or delete an entry, including the owner, and each entry is sealed with the one before it, so a gap or an edit shows up below.'),
    status,
    el('div.audit-tools', {}, search, kindSel, whoSel, exportBtn),
    list));

  function filtered() {
    return (w.entries || []).filter(e => (!state.kind || e.col === state.kind) && (!state.who || (e.actor && (e.actor.uid || e.actor.type)) === state.who)
      && (!state.q || [e.label, e.docId, auditKind(e.col), e.actor && e.actor.name, ...(e.changes || []).map(changeText)].join(' ').toLowerCase().includes(state.q)));
  }

  function options() {
    const entries = w.entries || [];
    const kinds = [...new Set(entries.map(e => e.col))].sort((a, b) => auditKind(a).localeCompare(auditKind(b)));
    kindSel.replaceChildren(el('option', { value: '' }, 'All records'), ...kinds.map(k => el('option', { value: k, selected: k === state.kind }, auditKind(k))));
    const people = new Map(); entries.forEach(e => { const k = e.actor && (e.actor.uid || e.actor.type); if (k && !people.has(k)) people.set(k, (e.actor.name || k)); });
    whoSel.replaceChildren(el('option', { value: '' }, 'Everyone'), ...[...people].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => el('option', { value: k, selected: k === state.who }, n)));
  }

  function check() {
    if (w.error) { status.className = 'audit-check bad'; status.textContent = 'The audit trail couldn’t be read: ' + (w.error.code === 'permission-denied' ? 'your role can’t see it.' : (w.error.message || 'unknown error')); return; }
    if (!w.entries) { status.className = 'audit-check'; status.textContent = 'Loading…'; return; }
    if (!w.entries.length) { status.className = 'audit-check'; status.textContent = 'No entries yet. Changes appear here a moment after they’re saved.'; return; }
    const r = verifyChain(w.entries);
    status.className = 'audit-check ' + (r.ok ? 'ok' : 'bad');
    status.dataset.ok = String(r.ok);
    status.textContent = r.ok
      ? `✓ Entries ${r.from}–${r.to} check out: nothing in them has been changed, removed or reordered.`
      : `⚠ Entry ${r.problem.seq}: ${r.problem.why} Entries after it can’t be trusted until this is explained.`;
  }

  function draw() {
    check();
    const rows = filtered();
    if (!w.entries || !w.entries.length) { list.replaceChildren(); return; }
    if (!rows.length) { list.replaceChildren(el('p.hint', {}, 'No entries match.')); return; }
    const head = el('tr', {}, ['#', 'When', 'Who', 'What', 'Record', 'Changes'].map(h => el('th', {}, h)));
    const body = rows.slice(0, state.shown).map(e => {
      const ch = e.changes || []; const shownCh = ch.slice(0, 4);
      return el('tr', { dataset: { seq: e.seq } },
        el('td.audit-seq', {}, String(e.seq)),
        el('td.audit-when', {}, when(e.at)),
        el('td', {}, e.actor ? (e.actor.name || (e.actor.type === 'person' ? 'Former member' : e.actor.type)) : ''),
        el('td', {}, el('span.pill' + (e.action === 'delete' ? '.audit-del' : ''), {}, ACTION[e.action] || e.action), ' ', auditKind(e.col)),
        el('td.audit-rec', { title: e.docId }, e.label || e.docId),
        el('td.audit-changes', { title: ch.map(changeText).join('\n') },
          ch.length ? el('ul', {}, shownCh.map(c => el('li', {}, changeText(c))), ch.length > shownCh.length ? el('li.hint', {}, '+' + (ch.length - shownCh.length) + ' more') : '')
            : el('span.hint', {}, e.action === 'update' ? 'Saved again, no field changed' : '')));
    });
    list.replaceChildren(el('div.tbl-scroll', {}, el('table.tbl.audit-table', {}, head, ...body)),
      rows.length > state.shown ? el('button.btn.small', { type: 'button', onclick: () => { state.shown += PAGE; draw(); } }, 'Show ' + Math.min(PAGE, rows.length - state.shown) + ' more') : '',
      el('p.hint', {}, `Showing ${Math.min(rows.length, state.shown)} of ${rows.length}` + (w.entries.length >= 1000 ? ' (the newest 1,000 entries; export or ask the server for older ones)' : '') + '.'));
  }

  const redraw = () => { if (!list.isConnected) { w.listeners.delete(redraw); return; } options(); draw(); };
  w.listeners.add(redraw);
  redraw();
}
