// Attach a file (uploaded to the user's own Google Drive / OneDrive) or a link to a task.
import { el, toast, modal, friendlyError, pickFile } from './ui.js';
import { newId, cleanUrl } from './model.js';
import { parseGithub } from './github.js';

export function openAttach(ctx, taskId) {
  const TT = ctx.TT;
  const m = modal('Attach a file or link', { narrow: true });
  const shareWith = () => TT.members.filter(x => x.uid !== TT.me.uid && x.email).map(x => x.email);
  const share = el('input', { type: 'checkbox', checked: true });
  const status = el('div.hint', { style: { minHeight: '18px', marginTop: '8px' } });
  const bar = el('progress', { max: 1, value: 0, style: { width: '100%', display: 'none' } });
  const done = (att, failed) => {
    if (window.boardAddAttachment(taskId, att)) {
      toast('Attached “' + att.name + '”.' + (failed && failed.length ? ' Couldn’t share with: ' + failed.join(', ') + ' — share it from Drive/OneDrive.' : ''), failed && failed.length ? 8000 : 3500);
      m.close();
    }
  };
  async function upload(kind) {
    const file = await pickFile(''); if (!file) return;
    if (file.size > 250 * 1024 * 1024) return toast('Files over 250 MB: upload them in Drive/OneDrive directly and add a link.');
    bar.style.display = 'block'; bar.value = 0; status.textContent = 'Uploading ' + file.name + '…';
    try {
      const opts = { teamId: TT.teamId, teamName: TT.team.name, shareWith: share.checked ? shareWith() : [], onProgress: (p) => { bar.value = p; } };
      const r = kind === 'gdrive'
        ? await (await import('./integrations/google.js')).uploadToDrive(file, opts)
        : await (await import('./integrations/onedrive.js')).uploadToOneDrive(file, opts);
      done({ id: newId('a'), provider: kind, name: r.name, url: r.url, size: r.size, addedBy: TT.me.name, addedAt: Date.now() }, r.failedShares);
    } catch (e) { status.textContent = friendlyError(e); bar.style.display = 'none'; }
  }
  const linkName = el('input.inp', { placeholder: 'Name (e.g. Test report v2)', maxlength: 200 });
  const linkUrl = el('input.inp', { type: 'url', placeholder: 'https://…' });
  const linkForm = el('form', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, linkName, linkUrl, el('button.btn', { type: 'submit' }, 'Add link'));
  linkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = cleanUrl(linkUrl.value.trim()); if (!url) return toast('Enter a full web address starting with https://');
    const gh = parseGithub(url);
    done({ id: newId('a'), provider: gh ? 'github' : 'link', name: linkName.value.trim() || (gh ? gh.label : new URL(url).hostname), url, size: 0, addedBy: TT.me.name, addedAt: Date.now() });
  });

  const uploads = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
  if (TT.integrations.google) uploads.append(el('button.btn.block', { type: 'button', onclick: () => upload('gdrive') }, '🟩 Upload to my Google Drive'));
  if (TT.integrations.onedrive) uploads.append(el('button.btn.block', { type: 'button', onclick: () => upload('onedrive') }, '🟦 Upload to my OneDrive'));
  if (uploads.children.length) {
    uploads.append(el('label.row', { style: { fontSize: '13px', gap: '6px' } }, share, 'Give everyone in the team view access'), bar, status);
    m.body.append(el('h4', { style: { margin: '0 0 8px' } }, 'Upload a file'), el('p.hint', {}, 'The file goes into a team folder in your own drive; the task keeps a link.'), uploads, el('hr', { style: { border: 0, borderTop: '1px solid var(--border-color)', margin: '18px 0' } }));
  } else {
    m.body.append(el('p.hint', {}, 'Uploading to Google Drive or OneDrive isn’t set up on this site yet, but you can add a link to any file you’ve already shared.'));
  }
  m.body.append(el('h4', { style: { margin: '0 0 8px' } }, 'Add a link'), el('p.hint', {}, 'Paste a share link from Drive, OneDrive, SharePoint, Overleaf or anywhere else. A GitHub issue or pull-request link also shows whether it’s open, closed or merged.'), linkForm);
  m.foot.append(el('button.btn', { type: 'button', onclick: m.close }, 'Cancel'));
}
