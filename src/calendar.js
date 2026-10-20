// ─────────────────────────────────────────────────────────────────────────────
//  Calendars: task deadlines and project phases as calendar events.
//   • "Add to calendar": an .ics file — opens in Google Calendar, Outlook, Apple
//     Calendar and others. No accounts or setup needed.
//   • "Sync to Google Calendar": keeps a "TeamTrack – <team>" calendar in your own
//     Google account up to date (needs the site's Google client ID, SETUP.md part 3).
// ─────────────────────────────────────────────────────────────────────────────
import { el, toast, modal, friendlyError } from './ui.js';
import { APP_NAME, GOOGLE_CLIENT_ID } from './config.js';
import { carryIndexOf } from './model.js';

const pad = (n) => String(n).padStart(2, '0');
const isoNext = (iso) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + 1)); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); };
const icsDate = (iso) => iso.replace(/-/g, '');
const stamp = () => { const d = new Date(); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'; };
/** RFC 5545 text escaping. */
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Fold lines longer than 75 bytes (continuation lines start with a space). */
function fold(line) {
  const bytes = new TextEncoder().encode(line); if (bytes.length <= 75) return line;
  const out = []; let cur = ''; let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export const appLink = (teamId) => location.origin + location.pathname + '#/t/' + teamId;

/**
 * The events for a team: open (or all) task deadlines, and each dated phase with its
 * milestone. Each event has a stable id, so re-importing or re-syncing updates it.
 */
export function teamEvents(session, { scope = 'mine', uid, includeDone = false, includePhases = true } = {}) {
  const T = session.team; const weeks = new Map((T.weeks || []).map(w => [w.key, w.title]));
  const phases = new Map((T.phases || []).map(p => [p.id, p]));
  const name = (u) => (session.members.find(m => m.uid === u) || {}).name || 'Former member';
  const link = appLink(session.teamId);
  const out = [];
  // A task carried forward over several weeks is one deadline: use its latest copy, and keep the
  // event id of the first copy so calendars update the same event instead of adding another.
  const ix = carryIndexOf(session);
  (session.tasks || []).forEach(t => {
    if (!t.dueDate || !weeks.has(t.weekId)) return;
    const latest = ix.latest(t.id); if (latest && latest.id !== t.id) return;
    if (!includeDone && t.flag === 'completed') return;
    const mine = t.ownerUid === uid || t.supportPersonId === uid || t.supportPersonId2 === uid;
    if (scope === 'mine' && !mine) return;
    const ph = phases.get(t.phaseId);
    const sub = t.subtasks || [];
    const desc = [
      'Team: ' + T.name, 'Owner: ' + name(t.ownerUid), 'Week: ' + weeks.get(t.weekId), 'Priority: ' + t.priority,
      ph ? 'Phase: ' + ph.name : '', t.status ? 'Status: ' + t.status : '',
      sub.length ? 'Sub-tasks: ' + sub.filter(s => s.completed).length + ' of ' + sub.length + ' done' : '',
      t.flag === 'completed' ? 'Completed' : '', '', 'Open in ' + APP_NAME + ': ' + link,
    ].filter((x, i, a) => x || (i === a.length - 2)).join('\n');
    out.push({ id: 'task-' + ix.rootOf(t.id), kind: 'task', title: (t.flag === 'completed' ? '✓ ' : '') + 'Due: ' + t.name + (scope === 'all' ? ' (' + name(t.ownerUid) + ')' : ''),
      start: t.dueDate, end: isoNext(t.dueDate), description: desc, url: link, alarm: t.flag !== 'completed' });
  });
  if (includePhases) (T.phases || []).forEach(p => {
    if (p.start && p.end) out.push({ id: 'phase-' + p.id, kind: 'phase', title: 'Phase: ' + p.name + ' (' + T.name + ')', start: p.start, end: isoNext(p.end),
      description: 'Project phase in ' + T.name + (p.milestone ? '\nMilestone at the end: ' + p.milestone : '') + '\n\nOpen in ' + APP_NAME + ': ' + link, url: link, alarm: false, transparent: true });
    if (p.end && p.milestone) out.push({ id: 'milestone-' + p.id, kind: 'milestone', title: '🏁 ' + p.milestone + ' (' + p.name + ')', start: p.end, end: isoNext(p.end),
      description: 'Milestone that ends the ' + p.name + ' phase of ' + T.name + '\n\nOpen in ' + APP_NAME + ': ' + link, url: link, alarm: true });
  });
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** An .ics calendar file with all-day events (reminder at 9:00 the day before). */
export function buildIcs(events, { calName, teamId }) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//' + APP_NAME + '//Team tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + esc(calName)];
  const now = stamp();
  events.forEach(e => {
    L.push('BEGIN:VEVENT', 'UID:' + e.id + '.' + teamId + '@teamtrack', 'DTSTAMP:' + now, 'DTSTART;VALUE=DATE:' + icsDate(e.start), 'DTEND;VALUE=DATE:' + icsDate(e.end),
      'SUMMARY:' + esc(e.title), 'DESCRIPTION:' + esc(e.description), 'URL:' + e.url, 'TRANSP:' + (e.transparent ? 'TRANSPARENT' : 'OPAQUE'));
    if (e.alarm) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.title), 'TRIGGER:-PT15H', 'END:VALARM');
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

function download(name, text) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const fileName = (s) => String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'calendar';

/** One task's deadline as an .ics file. */
export function downloadTaskIcs(ctx, taskId) {
  const s = ctx.session; const t = s && s.tasks.find(x => x.id === taskId); if (!t) return;
  if (!t.dueDate) { toast('Give the task a deadline first.'); return; }
  const ev = teamEvents(s, { scope: 'all', includeDone: true, includePhases: false }).filter(e => e.id === 'task-' + carryIndexOf(s).rootOf(taskId))
    .map(e => ({ ...e, title: e.title.replace(/ \([^)]*\)$/, '') }));
  download(fileName(t.name) + '.ics', buildIcs(ev, { calName: s.team.name, teamId: s.teamId }));
  toast('Calendar file downloaded. Open it to add the deadline to your calendar.');
}

// ── The "Calendar" dialog ────────────────────────────────────────────────────
const prefKey = (ctx) => 'tt_cal_opts_' + ctx.user.uid;
function readOpts(ctx) { try { return { scope: 'mine', includeDone: false, includePhases: true, ...JSON.parse(localStorage.getItem(prefKey(ctx)) || '{}') }; } catch { return { scope: 'mine', includeDone: false, includePhases: true }; } }
function saveOpts(ctx, o) { try { localStorage.setItem(prefKey(ctx), JSON.stringify(o)); } catch { /* */ } }

export function openCalendar(ctx) {
  const s = ctx.session; if (!s) return;
  const opts = readOpts(ctx);
  const m = modal('Add to calendar', { narrow: true });
  const count = el('div.cal-count');
  const radio = (value, label, help) => el('label.radio-card' + (opts.scope === value ? '.on' : ''), {},
    el('input', { type: 'radio', name: 'cal-scope', value, checked: opts.scope === value, onchange: () => { opts.scope = value; m.body.querySelectorAll('.radio-card').forEach(c => c.classList.toggle('on', c.contains(m.body.querySelector('input[name=cal-scope]:checked')))); update(); } }),
    el('span', {}, el('b', {}, label), el('br'), el('span.hint', {}, help)));
  const check = (key, label) => el('label.row.cal-check', {}, el('input', { type: 'checkbox', checked: opts[key], onchange: (e) => { opts[key] = e.target.checked; update(); } }), label);
  const events = () => teamEvents(s, { ...opts, uid: ctx.user.uid });
  function update() {
    saveOpts(ctx, opts);
    const ev = events(); const tasks = ev.filter(e => e.kind === 'task').length, ph = ev.filter(e => e.kind !== 'task').length;
    count.textContent = ev.length ? `${tasks} deadline${tasks === 1 ? '' : 's'}${ph ? ` and ${ph} phase event${ph === 1 ? '' : 's'}` : ''} will be added.` : 'Nothing to add: no ' + (opts.scope === 'mine' ? 'tasks of yours' : 'tasks') + ' have a deadline yet.';
    dl.disabled = !ev.length; if (gbtn) gbtn.disabled = !ev.length;
  }
  const dl = el('button.btn.primary', { type: 'button', onclick: () => {
    const ev = events(); if (!ev.length) return;
    download(fileName(APP_NAME + ' ' + s.team.name + (opts.scope === 'mine' ? ' my deadlines' : ' deadlines')) + '.ics', buildIcs(ev, { calName: APP_NAME + ' – ' + s.team.name, teamId: s.teamId }));
    toast('Calendar file downloaded. Open it to add the events to your calendar.', 5000);
  } }, '⬇ Download calendar file (.ics)');
  let gbtn = null; const gstatus = el('div.hint.cal-gstatus');
  if (GOOGLE_CLIENT_ID) {
    gbtn = el('button.btn', { type: 'button', onclick: async () => {
      gbtn.disabled = true; gstatus.textContent = 'Syncing with Google Calendar…';
      try {
        const { syncGoogleCalendar } = await import('./integrations/gcal.js');
        const r = await syncGoogleCalendar(events(), { teamId: s.teamId, teamName: s.team.name, uid: ctx.user.uid, loginHint: ctx.user.email });
        gstatus.replaceChildren(`Done: ${r.added} added, ${r.updated} updated, ${r.removed} removed, ${r.unchanged} already up to date. `, el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open Google Calendar'));
        toast('Google Calendar is up to date.');
      } catch (e) { gstatus.textContent = friendlyError(e); }
      finally { gbtn.disabled = false; }
    } }, '🔄 Sync to Google Calendar');
  }
  m.body.append(
    el('p.hint', { style: { marginTop: 0 } }, 'Put deadlines and project phases in the calendar you already use. Each deadline gets a reminder at 9:00 the day before.'),
    el('div.radio-cards', {}, radio('mine', 'My deadlines', 'Tasks you own or support'), radio('all', 'Whole team', 'Every task with a deadline')),
    el('div.cal-checks', {}, check('includePhases', 'Include project phases and milestones'), check('includeDone', 'Include completed tasks')),
    count,
    el('section.cal-sec', {}, el('h4', {}, 'Any calendar app'), el('p.hint', {}, 'Download a file and open it: Google Calendar, Outlook, Apple Calendar and others will add the events. Importing the file again later updates the same events instead of copying them.'), dl),
    el('section.cal-sec', {}, el('h4', {}, 'Google Calendar, kept up to date'),
      GOOGLE_CLIENT_ID ? [el('p.hint', {}, 'Creates a separate “' + APP_NAME + ' – ' + s.team.name + '” calendar in your Google account and keeps it in step: press Sync again after deadlines change. ' + APP_NAME + ' can only touch calendars it created, never your others.'), gbtn, gstatus]
        : el('p.hint', {}, 'Not set up on this site yet. The site owner adds a Google client ID (SETUP.md, part 3). Until then, use the calendar file above.')));
  m.foot.append(el('span.spacer'), el('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Close'));
  update();
  return m;
}
