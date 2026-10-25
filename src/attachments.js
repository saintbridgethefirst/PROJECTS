// Attach a file (uploaded to the user's own Google Drive / OneDrive) or a link to a task.
import { el, toast, modal, friendlyError, pickFile } from './ui.js';
import { newId, cleanUrl } from './model.js';
import { parseGithub } from './github.js';
import { linkInfo } from './filehealth.js';

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
  // Add a link. OneDrive / SharePoint and Google Drive links are recognised: the file gets the right
  // icon, a name from the link when it has one, and file-health checks. No sign-in or approval needed.
  const linkName = el('input.inp', { placeholder: 'Name (e.g. Test report v2)', maxlength: 200, 'aria-label': 'Name' });
  const linkUrl = el('input.inp', { type: 'url', placeholder: 'Paste a link: https://…', 'aria-label': 'Link' });
  const linkKind = el('div.hint.link-kind', { 'aria-live': 'polite' });
  let autoName = '';
  const readLink = () => {
    const url = cleanUrl(linkUrl.value.trim()); const info = url ? linkInfo(url) : { provider: '', name: '' };
    linkKind.textContent = info.provider === 'onedrive' ? 'OneDrive / SharePoint file' : info.provider === 'gdrive' ? 'Google Drive file' : '';
    if (info.name && (!linkName.value.trim() || linkName.value === autoName)) {
      linkName.value = autoName = info.name;
      if (!/\.[A-Za-z0-9]{2,5}$/.test(info.name)) { linkName.focus(); linkName.select(); }   // only the kind is known: invite a proper name
    }
    return { url, info };
  };
  linkUrl.addEventListener('input', readLink);
  linkUrl.addEventListener('paste', () => setTimeout(readLink, 0));
  const linkForm = el('form', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, linkUrl, linkKind, linkName, el('button.btn', { type: 'submit' }, 'Add link'));
  linkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const { url, info } = readLink(); if (!url) return toast('Enter a full web address starting with https://');
    const gh = parseGithub(url);
    const provider = gh ? 'github' : info.provider || 'link';
    const fallback = gh ? gh.label : provider === 'onedrive' ? 'OneDrive file' : provider === 'gdrive' ? 'Google Drive file' : new URL(url).hostname;
    done({ id: newId('a'), provider, name: linkName.value.trim() || fallback, url, size: 0, addedBy: TT.me.name, addedAt: Date.now() });
  });
  // From OneDrive: upload or find the file there, copy its share link, paste it here. Works with any
  // Microsoft account, including university ones that don't let students approve outside apps.
  const newTab = { target: '_blank', rel: 'noopener noreferrer' };
  const fromOneDrive = el('div.od-help', {},
    el('h4', { style: { margin: '0 0 6px' } }, 'From OneDrive or SharePoint'),
    el('p.hint', { style: { margin: '0 0 8px' } }, 'Works with any Microsoft account, including your university one. Nothing to sign in to here.'),
    el('ol.od-steps', {},
      el('li', {}, el('a.btn.small', { href: 'https://www.office.com/launch/onedrive', ...newTab }, 'Open OneDrive ↗'), ' and upload the file, or find it. ',
        el('span.hint', {}, 'Personal account? ', el('a', { href: 'https://onedrive.live.com/', ...newTab }, 'onedrive.live.com'))),
      el('li', {}, 'Click ', el('b', {}, 'Share'), ', choose who can open it (your teammates, or people in your university), then ', el('b', {}, 'Copy link'), '.'),
      el('li', {}, 'Paste the link below. The name fills itself in when the link has it.')));

  const uploads = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
  if (TT.integrations.google) uploads.append(el('button.btn.block', { type: 'button', onclick: () => upload('gdrive') }, '🟩 Upload to my Google Drive'));
  if (TT.integrations.onedrive) uploads.append(el('button.btn.block', { type: 'button', onclick: () => upload('onedrive') }, '🟦 Upload to my OneDrive'));
  if (uploads.children.length) {
    uploads.append(el('label.row', { style: { fontSize: '13px', gap: '6px' } }, share, 'Give everyone in the team view access'), bar, status);
    m.body.append(el('h4', { style: { margin: '0 0 8px' } }, 'Upload a file'), el('p.hint', {}, 'The file goes into a team folder in your own drive; the task keeps a link.'), uploads, el('hr', { style: { border: 0, borderTop: '1px solid var(--border-color)', margin: '18px 0' } }));
  } else {
    m.body.append(el('p.hint', { style: { marginTop: 0 } }, 'Keep the file in your own drive and add its share link: everyone in the team can open it from the task.'));
  }
  m.body.append(fromOneDrive, el('h4', { style: { margin: '16px 0 8px' } }, 'Add a link'), el('p.hint', {}, 'Paste a share link from OneDrive, SharePoint, Google Drive, Overleaf or anywhere else. A GitHub issue or pull-request link also shows whether it’s open, closed or merged.'), linkForm);
  m.foot.append(el('button.btn', { type: 'button', onclick: m.close }, 'Cancel'));
}
