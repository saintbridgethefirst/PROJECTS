// ─────────────────────────────────────────────────────────────────────────────
//  File health: can the files linked to tasks still be opened?
//  Files live in each team's own Google Drive or OneDrive. If someone stops sharing a file,
//  deletes it, or leaves the team with it in their own drive, the link in Trawpie breaks.
//  This checks each linked file with the viewer's own sign-in (so "broken" means *you* can't
//  open it) and warns when a file sits in one person's own drive rather than a team folder.
//  Results are kept on this device for a few hours. Plain web links can't be checked from a
//  browser, so they're left alone.
// ─────────────────────────────────────────────────────────────────────────────
const KEY = 'tt_fh_v1';
const TTL = 6 * 3600e3;
let cache = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } })();
const save = () => { try { const keep = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 400); cache = Object.fromEntries(keep); localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage full or blocked */ } };
const inflight = new Map();

/** The Google Drive file id in a Drive / Docs / Sheets / Slides link, or ''. */
export function driveFileId(url) {
  try {
    const u = new URL(url); if (!/(^|\.)google\.com$/.test(u.hostname)) return '';
    const m = /\/(?:file|document|spreadsheets|presentation|forms|drawings)\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname) || /\/folders\/([A-Za-z0-9_-]{10,})/.exec(u.pathname);
    return m ? m[1] : (/^[A-Za-z0-9_-]{10,}$/.test(u.searchParams.get('id') || '') ? u.searchParams.get('id') : '');
  } catch { return ''; }
}
/** Microsoft Graph's id for a sharing link: "u!" + unpadded base64url of the link. */
export function graphShareId(url) {
  const b = btoa(unescape(encodeURIComponent(url))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  return 'u!' + b;
}
export function isOneDriveUrl(url) { try { return /(^|\.)(1drv\.ms|onedrive\.live\.com|sharepoint\.com|onedrive\.com)$/.test(new URL(url).hostname); } catch { return false; } }
/** Which service can check this attachment: 'gdrive', 'onedrive' or '' (can't be checked). */
export function checkableBy(a) {
  if (!a || !a.url) return '';
  if (a.provider === 'gdrive' || driveFileId(a.url)) return driveFileId(a.url) ? 'gdrive' : '';
  if (a.provider === 'onedrive' || isOneDriveUrl(a.url)) return 'onedrive';
  return '';
}

/** What we last found for this link: { state: 'ok'|'broken'|'personal'|'unknown', why, owner, at } or null. */
export function healthOf(url) { const h = cache[url]; return h && Date.now() - h.at < TTL ? h : null; }

/** Read a Graph / Drive answer into a health result. Exported for tests. */
export function judgeDrive(status, body, { mine } = {}) {
  if (status === 200 && body) {
    if (body.trashed) return { state: 'broken', why: 'It’s in the Google Drive bin.' };
    const owner = (body.owners || [])[0];
    if (!body.driveId && owner) return { state: 'personal', why: 'It’s in ' + (owner.displayName || owner.emailAddress || 'one person') + '’s own Drive. If they leave, it goes with them: move it to a shared drive.', owner: owner.displayName || owner.emailAddress || '' };
    return { state: 'ok', why: '' };
  }
  // With the access Trawpie asks for, Google only shows files you added through Trawpie: a missing
  // file you added means it was deleted or you lost access; anyone else's can't be judged here.
  if (status === 404) return mine ? { state: 'broken', why: 'It was deleted, or you no longer have access.' } : { state: 'unknown', why: '' };
  if (status === 403) return { state: 'broken', why: 'You don’t have access to it any more.' };
  return { state: 'unknown', why: '' };
}
export function judgeGraph(status, body) {
  if (status === 200 && body) {
    if (body.deleted) return { state: 'broken', why: 'It was deleted.' };
    const type = body.parentReference && body.parentReference.driveType;
    const by = (body.createdBy && body.createdBy.user && body.createdBy.user.displayName) || '';
    if (type === 'personal' || type === 'business') return { state: 'personal', why: 'It’s in ' + (by || 'one person') + '’s own OneDrive. If they leave, it goes with them: move it to a team (SharePoint) folder.', owner: by };
    return { state: 'ok', why: '' };
  }
  if (status === 404) return { state: 'broken', why: 'It was deleted or moved, or the sharing link was turned off.' };
  if (status === 401 || status === 403) return { state: 'broken', why: 'You don’t have access to it any more.' };
  return { state: 'unknown', why: '' };
}

async function tokenFor(kind, interactive) {
  if (kind === 'gdrive') {
    const g = await import('./integrations/google.js');
    return g.googleTokenIfFresh() || (interactive ? await g.googleToken().catch(() => null) : null);
  }
  const o = await import('./integrations/onedrive.js');
  return (await o.msTokenSilent()) || (interactive ? await o.msToken().catch(() => null) : null);
}

/**
 * Check attachments. Quiet by default (only uses sign-ins already on this device); `interactive`
 * may open a Google or Microsoft window, so only pass it from a click. `me` is your name, to know
 * which Google files you added yourself. Returns { url → result }.
 */
export async function checkFiles(atts, { interactive = false, force = false, me = '' } = {}) {
  const out = {}; const tokens = {};
  for (const a of atts || []) {
    const kind = checkableBy(a); if (!kind) continue;
    const have = healthOf(a.url); if (have && !force) { out[a.url] = have; continue; }
    if (inflight.has(a.url)) { out[a.url] = await inflight.get(a.url); continue; }
    const run = (async () => {
      if (!(kind in tokens)) tokens[kind] = await tokenFor(kind, interactive);
      const t = tokens[kind]; if (!t) return null;
      let r;
      try {
        if (kind === 'gdrive') {
          const res = await fetch('https://www.googleapis.com/drive/v3/files/' + driveFileId(a.url) + '?fields=id,name,trashed,driveId,owners(displayName,emailAddress)&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + t } });
          r = judgeDrive(res.status, res.ok ? await res.json() : null, { mine: !!me && a.addedBy === me });
        } else {
          const res = await fetch('https://graph.microsoft.com/v1.0/shares/' + graphShareId(a.url) + '/driveItem?$select=id,name,deleted,parentReference,createdBy', { headers: { Authorization: 'Bearer ' + t, Prefer: 'redeemSharingLinkIfNecessary' } });
          r = judgeGraph(res.status, res.ok ? await res.json() : null);
        }
      } catch { return null; }   // offline or blocked: say nothing rather than guess
      const v = { ...r, at: Date.now() }; cache[a.url] = v; return v;
    })();
    inflight.set(a.url, run);
    try { const v = await run; if (v) out[a.url] = v; } finally { inflight.delete(a.url); }
  }
  save();
  return out;
}

/** For tests and "Check again": forget what we found. */
export function forgetHealth(url) { if (url) delete cache[url]; else cache = {}; save(); }
/** Let a test (or the demo) record a result without a real Drive. */
export function setHealth(url, state, why = '', owner = '') { cache[url] = { state, why, owner, at: Date.now() }; save(); }
