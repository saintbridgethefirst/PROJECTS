// ─────────────────────────────────────────────────────────────────────────────
//  Your account ▸ App and data: download everything about you, or delete your account.
//  The work is done by Cloud Functions (functions/privacy.js); the demo backend mirrors them.
//  app = { backend } (from main.js).
// ─────────────────────────────────────────────────────────────────────────────
import { el, toast, modal } from './ui.js';

// ── Your data: download it, or delete your account ─────────────────────────
export function yourDataRows(app, accountModal, row) {
  const dl = el('button.btn.small', { type: 'button', id: 'my-data-download', onclick: async () => {
    dl.disabled = true; dl.textContent = 'Preparing…';
    try {
      const data = await app.backend.data.callFunction('exportMyData', {});
      const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'penteint-projects-my-data-' + new Date().toISOString().slice(0, 10) + '.json' });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('Downloaded: everything Penteint Projects stores about you.');
    } catch (e) { toast(callError(e), 6000); }
    dl.disabled = false; dl.textContent = 'Download';
  } }, 'Download');
  const del = el('button.btn.small.danger', { type: 'button', id: 'my-account-delete', onclick: () => { accountModal.close(); openDeleteAccount(app); } }, 'Delete…');
  return [
    row('download', 'Download my data', el('span', {}, 'A file with everything stored about you. See the ', el('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'privacy notice'), '.'), dl),
    row('trash', 'Delete my account', 'You’ll see what happens to your teams and be asked to confirm first.', del, { danger: true }),
  ];
}
/** Message from a Cloud Function error (or the demo's), without the "functions/" prefix. */
function callError(e) { return String((e && e.message) || 'Something went wrong.').replace(/^Firebase:\s*/, ''); }

export async function openDeleteAccount(app) {
  const m = modal('Delete your account', { narrow: true });
  const status = el('div', {}, el('p.hint', {}, 'Checking your teams…'));
  const confirmIn = el('input', { id: 'delete-confirm', placeholder: 'Type DELETE', autocomplete: 'off', 'aria-label': 'Type DELETE to confirm' });
  const go = el('button.btn.danger', { type: 'button', id: 'delete-go', disabled: true }, 'Delete my account forever');
  confirmIn.addEventListener('input', () => { go.disabled = confirmIn.value.trim() !== 'DELETE' || go.dataset.blocked === '1'; });
  m.body.append(
    el('p', {}, 'This can’t be undone. When you delete your account:'),
    el('ul.del-list', {},
      el('li', {}, 'Your login, profile, photo and settings are deleted, and you’re removed from every team.'),
      el('li', {}, 'Teams where you’re the only member are deleted, with everything in them.'),
      el('li', {}, 'In other teams, the work you shared stays for your teammates (tasks, comments, notes), but your name on it becomes “Former member”.'),
      el('li', {}, 'Your student verification, feedback, error reports and invitations to your email are deleted. Backups that still hold them are deleted automatically within 14 weeks.')),
    el('p.hint', {}, 'Want a copy first? Use “Download my data” in Your account ▸ App and data.'), status, confirmIn);
  m.foot.append(el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Cancel'), go);
  try {
    const { teams } = await app.backend.data.callFunction('myOwnedTeams', {});
    if (teams.length) {
      go.dataset.blocked = '1';
      status.replaceChildren(el('div.banner', { id: 'delete-blocked' }, el('b', {}, 'First hand over the teams you own. '), 'They have other members, so they need a new owner: open each team ▸ Settings ▸ Members ▸ “Make owner”.',
        el('ul', {}, ...teams.map(t => el('li', {}, t.name + ' (' + t.members + ' members)')))));
    } else status.replaceChildren();
  } catch (e) { status.replaceChildren(el('p.hint', {}, 'Couldn’t check your teams: ' + callError(e))); }
  go.addEventListener('click', async () => {
    go.disabled = true; go.textContent = 'Deleting…';
    try {
      const r = await app.backend.data.callFunction('deleteMyAccount', { confirm: 'DELETE' });
      const bye = 'Your account was deleted' + (r && r.teamsDeleted ? ', with ' + r.teamsDeleted + ' team' + (r.teamsDeleted === 1 ? '' : 's') + ' only you were in' : '') + '. Goodbye 👋';
      try { sessionStorage.setItem('tt_flash', bye); } catch { /* private mode */ }   // signing out reloads the page
      m.close(); try { await app.backend.auth.signOut(); } catch { /* already gone */ }
      location.hash = ''; toast(bye, 8000);
    } catch (e) {
      go.textContent = 'Delete my account forever'; go.disabled = false;
      const recent = e && e.details && e.details.reason === 'recent-login';
      status.replaceChildren(el('div.banner', {}, callError(e), recent ? el('div', { style: { marginTop: '8px' } }, el('button.btn.small', { type: 'button', onclick: async () => { m.close(); await app.backend.auth.signOut(); location.hash = ''; } }, 'Sign out now')) : ''));
    }
  });
}

