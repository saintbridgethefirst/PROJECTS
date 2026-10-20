// ─────────────────────────────────────────────────────────────────────────────
//  Google Drive + Sheets via Google Identity Services (browser-only, no server).
//  Scope: drive.file — the app can only see files it created or the user picked,
//  never the rest of their Drive. This scope only needs basic app verification.
// ─────────────────────────────────────────────────────────────────────────────
import { GOOGLE_CLIENT_ID, APP_NAME } from '../config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
// Calendar sync asks separately, only when used. calendar.app.created lets the app make its
// own calendars and manage events in those — it can't see or change any other calendar.
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const tokens = new Map();   // scope → { token, expiry }
let gisLoading = null;
// Who is signed in to TeamTrack: used to remember Google access per person on this device,
// and as a hint so Google skips the "choose an account" step.
let who = { uid: '', email: '' };
const KEY = (scope) => 'tt_g_' + (who.uid || 'anon') + '_' + scope.split('/').pop();
const store = {
  get(scope) { try { const v = JSON.parse(localStorage.getItem(KEY(scope)) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } },
  set(scope, v) { try { localStorage.setItem(KEY(scope), JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(scope) { try { const v = this.get(scope); if (v) this.set(scope, { granted: !!v.granted }); } catch { /* */ } },
};
/** Tell this module who is signed in (call on sign-in; pass nothing on sign-out). */
export function setGoogleUser(user) {
  if (!user) {   // signing out: forget tokens for the person leaving, but keep the "already allowed" note
    [SCOPE, CALENDAR_SCOPE].forEach(sc => store.del(sc)); tokens.clear(); who = { uid: '', email: '' }; return;
  }
  who = { uid: String(user.uid || ''), email: String(user.email || '') };
  tokens.clear();
  [SCOPE, CALENDAR_SCOPE].forEach(sc => { const v = store.get(sc); if (v && v.token && Date.now() < v.expiry - 60_000) tokens.set(sc, { token: v.token, expiry: v.expiry }); });
}
/** Has this person allowed this Google access on this device before? */
export const googleAllowed = (scope = SCOPE) => !!(store.get(scope) || {}).granted;

function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => { gisLoading = null; rej(new Error('Could not reach Google. Check your connection or ad-blocker.')); };
    document.head.append(s);
  });
  return gisLoading;
}

/**
 * Get an access token for a scope. Google access tokens last an hour; we keep the current one on
 * this device, so reloading the page doesn't ask again. When it runs out, Google is asked quietly
 * (no consent screen, no account picker) — at most a window that opens and closes by itself.
 * Only the first time ever shows Google's "allow" screen. Call from a click.
 */
export async function googleToken(loginHint, scope = SCOPE) {
  if (!GOOGLE_CLIENT_ID) throw new Error('Google isn’t set up on this site yet.');
  const have = tokens.get(scope);
  if (have && Date.now() < have.expiry - 60_000) return have.token;
  const saved = store.get(scope);
  if (saved && saved.token && Date.now() < saved.expiry - 60_000) { tokens.set(scope, { token: saved.token, expiry: saved.expiry }); return saved.token; }
  await loadGis();
  const hint = loginHint || who.email || undefined;
  const granted = !!(saved && saved.granted);
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope, login_hint: hint, hint,
      callback: (r) => {
        if (r.error) { reject(new Error(r.error === 'access_denied' ? 'Google access was not allowed.' : 'Google sign-in failed: ' + r.error)); return; }
        if (window.google.accounts.oauth2.hasGrantedAllScopes && !window.google.accounts.oauth2.hasGrantedAllScopes(r, scope)) { reject(new Error('Google access was not allowed. Tick the box to allow it and try again.')); return; }
        const t = { token: r.access_token, expiry: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
        tokens.set(scope, t); store.set(scope, { ...t, granted: true }); resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e && e.type === 'popup_closed' ? 'The Google window was closed.' : 'Google sign-in failed.')),
    });
    // First time on this device: show the consent screen. After that: ask quietly.
    client.requestAccessToken({ prompt: granted ? '' : 'consent' });
  });
}

export async function gfetch(url, init = {}, scope = SCOPE) {
  const t = await googleToken(undefined, scope);
  const r = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + t, ...(init.headers || {}) } });
  if (r.status === 401) { tokens.delete(scope); store.del(scope); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error((j.error && j.error.message) || ('Google request failed (' + r.status + ')')); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}

/** Find (or create) this team's folder in the user's Drive. */
async function teamFolder(teamId, teamName) {
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='ttTeam' and value='${teamId}' }`);
  const found = await gfetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`);
  if (found.files && found.files.length) return found.files[0].id;
  const f = await gfetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${APP_NAME} – ${teamName}`, mimeType: 'application/vnd.google-apps.folder', appProperties: { ttTeam: teamId } }),
  });
  return f.id;
}

/** Share a Drive file with team members. Returns addresses that could not be shared with. */
export async function shareDriveFile(fileId, emails, role = 'reader') {
  const failed = [];
  for (const email of emails) {
    try {
      await gfetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role, emailAddress: email }),
      });
    } catch { failed.push(email); }
  }
  return failed;
}

/** Upload a file to Drive with progress; returns { id, name, url, size, failedShares }. */
export async function uploadToDrive(file, { teamId, teamName, shareWith = [], onProgress }) {
  const t = await googleToken(undefined, SCOPE);
  const folder = await teamFolder(teamId, teamName);
  const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.type || 'application/octet-stream', 'X-Upload-Content-Length': String(file.size) },
    body: JSON.stringify({ name: file.name, parents: [folder] }),
  });
  if (!init.ok) throw new Error('Google Drive refused the upload (' + init.status + ').');
  const uploadUrl = init.headers.get('Location');
  const meta = await new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('PUT', uploadUrl);
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => { if (x.status >= 200 && x.status < 300) { try { resolve(JSON.parse(x.responseText)); } catch { reject(new Error('Unexpected reply from Google Drive.')); } } else reject(new Error('Upload failed (' + x.status + ').')); };
    x.onerror = () => reject(new Error('Upload failed — check your connection.'));
    x.send(file);
  });
  const failedShares = shareWith.length ? await shareDriveFile(meta.id, shareWith) : [];
  return { id: meta.id, name: meta.name, url: meta.webViewLink, size: Number(meta.size) || file.size, failedShares };
}

// ── Sheets ──────────────────────────────────────────────────────────────────
export async function createSpreadsheet(title, sheetTitles) {
  const j = await gfetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title }, sheets: sheetTitles.map(t => ({ properties: { title: t } })) }),
  });
  return { id: j.spreadsheetId, url: j.spreadsheetUrl };
}
export async function writeSheets(id, data, clearRanges = []) {
  if (clearRanges.length) await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchClear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ranges: clearRanges }) });
  await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data.map(([range, values]) => ({ range, values })) }),
  });
}
export async function readSheet(id, range) {
  const j = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`);
  return j.values || [];
}
export async function spreadsheetUrl(id) {
  const j = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=spreadsheetUrl`);
  return j.spreadsheetUrl;
}
