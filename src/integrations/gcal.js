// ─────────────────────────────────────────────────────────────────────────────
//  Google Calendar sync. Keeps a "Penteint Projects – <team>" calendar in the person's own
//  Google account in step with the team's deadlines and phases. Each event carries
//  hidden ids (ttTeam, ttId), so a sync updates or removes events instead of copying.
//  Scope calendar.app.created: the app can only touch calendars it created.
// ─────────────────────────────────────────────────────────────────────────────
import { gfetch, googleToken, CALENDAR_SCOPE } from './google.js';
import { APP_NAME } from '../config.js';

const API = 'https://www.googleapis.com/calendar/v3';
const call = (path, init = {}) => gfetch(API + path, init, CALENDAR_SCOPE);
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const MARK = (teamId) => '[teamtrack:' + teamId + ']';
const idKey = (uid, teamId) => 'tt_gcal_' + uid + '_' + teamId;

/** Find this team's calendar (remembered id, else by its marker), or create it. */
async function teamCalendar(teamId, teamName, uid) {
  let id = null; try { id = localStorage.getItem(idKey(uid, teamId)); } catch { /* */ }
  if (id) {
    try { await call('/calendars/' + encodeURIComponent(id)); return id; }
    catch (e) {
      if (e.status === 403) return id;   // can't look it up with this permission: keep using it
      if (e.status !== 404 && e.status !== 410) throw e;
      id = null;                         // deleted in Google Calendar: make a new one
    }
  }
  try {   // another device may have created it already
    const list = await call('/users/me/calendarList?minAccessRole=owner&maxResults=250');
    const hit = (list.items || []).find(c => (c.description || '').includes(MARK(teamId)));
    if (hit) id = hit.id;
  } catch (e) { if (e.status !== 403) throw e; }
  if (!id) {
    const cal = await call('/calendars', json('POST', { summary: APP_NAME + ' – ' + teamName, description: 'Deadlines and project phases from ' + APP_NAME + '. Updated when you press Sync. ' + MARK(teamId) }));
    id = cal.id;
  }
  try { localStorage.setItem(idKey(uid, teamId), id); } catch { /* */ }
  return id;
}

function body(e, teamId) {
  return {
    summary: e.title, description: e.description, start: { date: e.start }, end: { date: e.end },
    transparency: e.transparent ? 'transparent' : 'opaque',
    reminders: e.alarm ? { useDefault: false, overrides: [{ method: 'popup', minutes: 900 }] } : { useDefault: false, overrides: [] },
    source: { title: APP_NAME, url: e.url },
    extendedProperties: { private: { ttTeam: teamId, ttId: e.id } },
  };
}
const same = (a, b) => a.summary === b.summary && (a.description || '') === (b.description || '') && a.start && a.start.date === b.start.date && a.end && a.end.date === b.end.date
  && (a.transparency || 'opaque') === b.transparency;

/** Bring the team calendar in line with `events`. Returns counts and a link. */
export async function syncGoogleCalendar(events, { teamId, teamName, uid, loginHint }) {
  await googleToken(loginHint, CALENDAR_SCOPE);   // asks for permission the first time
  const cal = await teamCalendar(teamId, teamName, uid);
  const base = '/calendars/' + encodeURIComponent(cal) + '/events';
  // Everything we put there before, by our own id
  const existing = new Map(); let page = '';
  do {
    const r = await call(base + '?maxResults=2500&showDeleted=false&privateExtendedProperty=' + encodeURIComponent('ttTeam=' + teamId) + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    (r.items || []).forEach(ev => { const k = ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.ttId; if (k) { if (existing.has(k)) existing.get(k).dupes.push(ev); else existing.set(k, { ev, dupes: [] }); } });
    page = r.nextPageToken || '';
  } while (page);
  const res = { added: 0, updated: 0, removed: 0, unchanged: 0 };
  const wanted = new Set();
  for (const e of events) {
    wanted.add(e.id);
    const b = body(e, teamId); const have = existing.get(e.id);
    if (!have) { await call(base, json('POST', b)); res.added++; }
    else {
      if (same(have.ev, b)) res.unchanged++; else { await call(base + '/' + encodeURIComponent(have.ev.id), json('PATCH', b)); res.updated++; }
      for (const d of have.dupes) { await call(base + '/' + encodeURIComponent(d.id), { method: 'DELETE' }); res.removed++; }
    }
  }
  for (const [k, { ev, dupes }] of existing) {
    if (wanted.has(k)) continue;
    for (const x of [ev, ...dupes]) { await call(base + '/' + encodeURIComponent(x.id), { method: 'DELETE' }); res.removed++; }
  }
  return { ...res, calendarId: cal, url: 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(cal) };
}
