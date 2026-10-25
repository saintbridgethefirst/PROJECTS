// ─────────────────────────────────────────────────────────────────────────────
//  OneDrive via Microsoft Graph + MSAL (browser-only, no server).
//  Works with personal Microsoft accounts and work/school (Microsoft 365) ones.
// ─────────────────────────────────────────────────────────────────────────────
import { MS_CLIENT_ID, APP_NAME } from '../config.js';

const SCOPES = ['Files.ReadWrite'];
let msal = null;

async function client() {
  if (!MS_CLIENT_ID) throw new Error('OneDrive isn’t set up on this site yet.');
  if (msal) return msal;
  const { PublicClientApplication } = await import('@azure/msal-browser');
  msal = new PublicClientApplication({
    auth: { clientId: MS_CLIENT_ID, authority: 'https://login.microsoftonline.com/common', redirectUri: location.origin + '/blank.html' },
    cache: { cacheLocation: 'localStorage' },
  });
  await msal.initialize();
  return msal;
}

async function msToken(loginHint) {
  const app = await client();
  const account = app.getAllAccounts()[0];
  if (account) {
    try { return (await app.acquireTokenSilent({ scopes: SCOPES, account })).accessToken; } catch { /* fall through to popup */ }
  }
  const r = await app.acquireTokenPopup({ scopes: SCOPES, loginHint, prompt: 'select_account' });
  return r.accessToken;
}

/** A Microsoft token without any window: null when this device isn't signed in to OneDrive. */
export async function msTokenSilent() {
  if (!MS_CLIENT_ID) return null;
  try { const app = await client(); const account = app.getAllAccounts()[0]; if (!account) return null; return (await app.acquireTokenSilent({ scopes: SCOPES, account })).accessToken; } catch { return null; }
}
export { msToken };

async function graph(path, init = {}) {
  const t = await msToken();
  const r = await fetch('https://graph.microsoft.com/v1.0' + path, { ...init, headers: { Authorization: 'Bearer ' + t, ...(init.headers || {}) } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j.error && j.error.message) || ('OneDrive request failed (' + r.status + ')')); }
  return r.status === 204 ? null : r.json();
}

const safe = (s) => String(s).replace(/[\\/:*?"<>|#%]/g, '_').trim().slice(0, 120) || 'file';

/** Upload to the signed-in user's OneDrive, in a folder named "<App> – <Team>"; returns { id, name, url, size, failedShares }. */
export async function uploadToOneDrive(file, { teamName, shareWith = [], onProgress }) {
  const folder = `${safe(APP_NAME + ' – ' + teamName)}`;
  const path = `/me/drive/root:/${encodeURIComponent(folder)}/${encodeURIComponent(safe(file.name))}`;
  let item;
  if (file.size <= 4 * 1024 * 1024) {
    item = await graph(path + ':/content?@microsoft.graph.conflictBehavior=rename', { method: 'PUT', body: file });
    onProgress && onProgress(1);
  } else {
    const session = await graph(path + ':/createUploadSession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }) });
    const CHUNK = 320 * 1024 * 16; // 5 MiB, a multiple of 320 KiB as Graph requires
    for (let start = 0; start < file.size; start += CHUNK) {
      const end = Math.min(start + CHUNK, file.size);
      const r = await fetch(session.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${file.size}` }, body: file.slice(start, end) });
      if (!r.ok && r.status !== 202) throw new Error('Upload failed (' + r.status + ').');
      onProgress && onProgress(end / file.size);
      if (r.status === 200 || r.status === 201) item = await r.json();
    }
  }
  const failedShares = [];
  if (shareWith.length) {
    try {
      await graph(`/me/drive/items/${item.id}/invite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireSignIn: true, sendInvitation: false, roles: ['read'], recipients: shareWith.map(email => ({ email })) }),
      });
    } catch { failedShares.push(...shareWith); }
  }
  return { id: item.id, name: item.name, url: item.webUrl, size: item.size || file.size, failedShares };
}
