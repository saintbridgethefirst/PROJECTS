// ─────────────────────────────────────────────────────────────────────────────
//  GitHub sync in the app: connect a repository (Settings ▸ Integrations), the "Raise an issue"
//  form and link, and (demo only) simulated GitHub events. What events do: functions/ghsync.js.
// ─────────────────────────────────────────────────────────────────────────────
import { el, modal, toast, friendlyError } from './ui.js';
import { can } from './permissions.js';
import { cleanGithub, taskRef, refIdOf, newIssueUrl, branchName } from '../functions/ghsync.js';

export const githubOf = (s) => cleanGithub(s && s.team && s.team.github);
export const refOf = (task) => taskRef(refIdOf(task));
export { branchName, newIssueUrl };

const copyBtn = (id, value, label = 'Copy') => el('button.btn.small', { type: 'button', id, onclick: async () => {
  try { await navigator.clipboard.writeText(value); toast('Copied.'); } catch { toast('Select it and copy (Ctrl+C / ⌘C).'); }
} }, label);
/** A callable that isn't deployed yet answers "internal" with no message: say what to do. */
function serverError(e) {
  const code = String((e && e.code) || '');
  if (/internal|not-found|unimplemented/.test(code) && !/[a-z]{4,} [a-z]{4,}/i.test(String((e && e.message) || '').replace(/^internal$/i, '')))
    return 'GitHub sync isn’t switched on on the server yet. Whoever runs the site deploys the functions once: firebase deploy --only functions (SETUP.md, section 6.5).';
  return friendlyError(e);
}
const field = (label, input) => el('label.field', {}, el('span', {}, label), input);
export const raiseLink = (teamId) => location.origin + location.pathname + '#/t/' + teamId + '/raise';

/** Settings ▸ Integrations ▸ GitHub. */
export function githubSection(ctx, { rerender } = {}) {
  const s = ctx.session; const g = githubOf(s); const edit = can(s.team, s.me, 'team.settings');
  const box = el('section.gh-settings', { id: 'gh-settings' });
  const setup = el('div', { id: 'gh-setup' });
  async function connect(repo) {
    try {
      const r = await ctx.backend.data.callFunction('githubConnect', { teamId: s.teamId, repo });
      showSetup(r); toast('Connected to ' + r.repo + '. Now add the webhook on GitHub.', 5000);
    } catch (e) { toast(serverError(e), 9000); }
  }
  function showSetup(r) {
    setup.replaceChildren(el('div.banner.info.gh-steps', {},
      el('b', {}, 'Last step, on GitHub (once):'),
      el('ol', {},
        el('li', {}, 'Open ', el('a', { href: 'https://github.com/' + r.repo + '/settings/hooks/new', target: '_blank', rel: 'noopener noreferrer', id: 'gh-hook-link' }, r.repo + ' ▸ Settings ▸ Webhooks ▸ Add webhook'), '.'),
        el('li', {}, 'Payload URL: ', el('input.inp.gh-copy', { readonly: true, value: r.url, id: 'gh-url', 'aria-label': 'Payload URL' }), ' ', copyBtn('gh-url-copy', r.url)),
        el('li', {}, 'Content type: ', el('code', {}, 'application/json')),
        el('li', {}, 'Secret: ', el('input.inp.gh-copy', { readonly: true, value: r.secret, id: 'gh-secret', 'aria-label': 'Secret' }), ' ', copyBtn('gh-secret-copy', r.secret), el('div.hint', {}, 'Shown only now. Lost it? Press “New secret” and update the webhook.')),
        el('li', {}, 'Which events: “Let me select individual events”, then tick ', el('b', {}, 'Issues'), ' and ', el('b', {}, 'Pull requests'), '. Add webhook.'))));
  }
  box.append(el('h4', {}, '🐙 GitHub'),
    el('p.hint', {}, 'Connect your team’s repository. A pull request or issue that mentions a task’s reference (like TT-4K2P9Q, shown on every task) is linked to that task by itself, a merged pull request finishes its task, and new issues can become tasks. Nobody pastes links. GitHub sends the events; TeamTrack never gets access to your code.'));
  if (!g.repo) {
    const repo = el('input.inp', { id: 'gh-repo', placeholder: 'owner/repository, e.g. uni-robotics/rover', 'aria-label': 'GitHub repository', disabled: !edit });
    box.append(el('div.row', { style: { gap: '8px', flexWrap: 'wrap' } }, repo, el('button.btn.primary', { type: 'button', id: 'gh-connect', disabled: !edit, onclick: () => connect(repo.value) }, 'Connect')),
      edit ? '' : el('p.hint', {}, 'Only roles that change team settings can connect GitHub.'), setup);
    return box;
  }
  const v = { ...g };
  const people = (s.members || []).slice().sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const save = el('button.btn.small.primary', { type: 'button', id: 'gh-save', disabled: true, onclick: async () => {
    if (await ctx.writeOps([{ type: 'update', path: 'team', data: { github: { repo: g.repo, issues: v.issues, done: v.done, owner: v.owner, connectedAt: g.connectedAt } } }])) { toast('GitHub settings saved.'); if (rerender) rerender(); }
  } }, 'Save');
  const touch = () => { save.disabled = false; };
  box.append(
    el('p', {}, 'Connected to ', el('a', { href: 'https://github.com/' + g.repo, target: '_blank', rel: 'noopener noreferrer', id: 'gh-repo-link' }, g.repo), '.'),
    el('label.chk', {}, el('input', { type: 'checkbox', id: 'gh-issues', checked: g.issues, disabled: !edit, onchange: (e) => { v.issues = e.target.checked; touch(); } }), ' New issues become tasks for ',
      el('select', { id: 'gh-owner', disabled: !edit, 'aria-label': 'Who gets new issues', onchange: (e) => { v.owner = e.target.value; touch(); } }, people.map(m => el('option', { value: m.uid, selected: m.uid === (g.owner || s.team.ownerUid) }, m.name || m.email)))),
    el('label.chk', {}, el('input', { type: 'checkbox', id: 'gh-done', checked: g.done, disabled: !edit, onchange: (e) => { v.done = e.target.checked; touch(); } }), ' A merged pull request or closed issue finishes its task (not past a sign-off still to give)'),
    edit ? el('div.row', { style: { gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
      el('button.btn.small', { type: 'button', id: 'gh-reconnect', onclick: () => connect(g.repo) }, 'New secret'),
      el('button.btn.small.danger', { type: 'button', id: 'gh-disconnect', onclick: async () => {
        if (!confirm('Disconnect ' + g.repo + '? GitHub events stop arriving; links already on tasks stay.')) return;
        try { await ctx.backend.data.callFunction('githubConnect', { teamId: s.teamId, disconnect: true }); toast('Disconnected.'); if (rerender) rerender(); } catch (e) { toast(serverError(e), 9000); }
      } }, 'Disconnect'), el('span.spacer'), save) : '',
    setup,
    el('h4', { style: { marginTop: '18px' } }, 'Raise an issue'),
    el('p.hint', {}, 'Share this link in your team chat. It opens a short form that adds a task here and opens GitHub with the issue filled in, so the two are linked from the start.'),
    el('div.row', { style: { gap: '8px', flexWrap: 'wrap' } }, el('input.inp.gh-copy', { readonly: true, value: raiseLink(s.teamId), id: 'gh-raise-link', 'aria-label': 'Raise-an-issue link' }), copyBtn('gh-raise-copy', raiseLink(s.teamId)),
      el('button.btn.small', { type: 'button', id: 'gh-raise-open', onclick: () => openRaiseIssue(ctx) }, 'Open the form')));
  if (ctx.backend.isDemo) box.append(simulateBox(ctx));
  return box;
}

/** Demo only: pretend GitHub sent an event. */
function simulateBox(ctx) {
  const s = ctx.session; const g = githubOf(s);
  const open = (s.tasks || []).filter(t => t.flag !== 'completed');
  const pick = el('select', { id: 'gh-sim-task', 'aria-label': 'Task the pull request is for' }, open.slice(0, 200).map(t => el('option', { value: t.id }, refOf(t) + ' · ' + t.name)));
  const out = el('div.hint', { id: 'gh-sim-out' });
  let n = 40;
  const send = async (kind, payload) => {
    try {
      const r = await ctx.backend.data.callFunction('githubSimulate', { teamId: s.teamId, kind, payload: { repository: { full_name: g.repo }, ...payload } });
      out.textContent = 'GitHub → TeamTrack: ' + [r.links ? r.links + ' linked' : '', r.finished ? r.finished + ' finished' : '', r.created ? 'a task made' : '', r.why].filter(Boolean).join(' · ');
    } catch (e) { toast(friendlyError(e), 6000); }
  };
  const pr = (merged) => { const t = open.find(x => x.id === pick.value); if (!t) return; n++;
    const url = 'https://github.com/' + g.repo + '/pull/' + n; const ref = refOf(t);
    send('pull_request', { action: 'opened', pull_request: { number: n, title: 'Work on ' + t.name, body: '', html_url: url, head: { ref: branchName(refIdOf(t), t.name) }, merged: false } })
      .then(() => merged && send('pull_request', { action: 'closed', pull_request: { number: n, title: 'Work on ' + t.name + ' (' + ref + ')', body: '', html_url: url, head: { ref: 'main' }, merged: true } }));
  };
  return el('div.banner.gh-sim', { id: 'gh-sim' }, el('b', {}, 'Try it (demo): pretend GitHub sends an event'),
    el('div.row', { style: { gap: '8px', flexWrap: 'wrap', marginTop: '8px' } },
      el('button.btn.small', { type: 'button', id: 'gh-sim-issue', onclick: () => { n++; send('issues', { action: 'opened', issue: { number: n, title: 'Battery connector gets hot', body: 'Seen on the bench test.', html_url: 'https://github.com/' + g.repo + '/issues/' + n } }); } }, 'A new issue arrives'),
      pick, el('button.btn.small', { type: 'button', id: 'gh-sim-pr', onclick: () => pr(false) }, 'A pull request opens for it'),
      el('button.btn.small', { type: 'button', id: 'gh-sim-merge', onclick: () => pr(true) }, '…and is merged')), out);
}

/** The "Raise an issue" form: adds a task (or picks one) and opens GitHub's new-issue page, filled in. */
export function openRaiseIssue(ctx) {
  const s = ctx.session; const g = githubOf(s);
  if (!g.repo) { toast('This team hasn’t connected a GitHub repository yet (Settings ▸ Integrations).', 5000); return; }
  const canAdd = can(s.team, s.me, 'tasks.editOwn') || can(s.team, s.me, 'tasks.editAll');
  const m = modal('Raise an issue on ' + g.repo, { narrow: true }); m.box.id = 'gh-raise';
  const kind = el('select', { id: 'gh-raise-kind' }, ['Bug', 'Feature', 'Question'].map(k => el('option', { value: k }, k)));
  const title = el('input.inp', { id: 'gh-raise-title', maxlength: 200, placeholder: 'e.g. Motor stalls at half throttle' });
  const body = el('textarea', { id: 'gh-raise-body', rows: 4, maxlength: 3000, placeholder: 'What happened, what you expected, how to see it.' });
  const open = (s.tasks || []).filter(t => t.flag !== 'completed');
  const forTask = el('select', { id: 'gh-raise-task', 'aria-label': 'Task' }, el('option', { value: '' }, canAdd ? 'A new task in my row' : 'Choose a task…'), open.slice(0, 300).map(t => el('option', { value: t.id }, t.name)));
  m.body.append(field('Kind', kind), field('Title', title), field('Details', body), field('Track it as', forTask),
    el('p.hint', {}, 'GitHub opens with all this filled in. Press “Submit new issue” there and it’s linked to the task here automatically.'));
  m.foot.append(el('span.spacer'), el('button.btn.primary', { type: 'button', id: 'gh-raise-go', onclick: () => {
    const t = title.value.trim(); if (!t) { toast('Give the issue a title.'); title.focus(); return; }
    let task = open.find(x => x.id === forTask.value);
    if (!task) {
      if (!canAdd) { toast('Choose a task to track it.'); return; }
      const r = window.boardAddTask ? window.boardAddTask({ ownerUid: ctx.user.uid, name: (kind.value === 'Bug' ? '🐞 ' : '') + t, note: 'Raised as a GitHub ' + kind.value.toLowerCase() + ' on ' + g.repo }) : { error: 'The board isn’t ready.' };
      if (r.error) { toast(r.error, 5000); return; }
      task = { id: r.id };
    }
    const url = newIssueUrl(g.repo, { title: (kind.value === 'Bug' ? '' : '[' + kind.value + '] ') + t, body: body.value.trim(), ref: refOf(task) });
    window.open(url, '_blank', 'noopener');
    m.close(); toast('GitHub opened with the issue filled in. Submit it there; it links to the task here.', 6000);
  } }, 'Open on GitHub'));
  setTimeout(() => title.focus(), 30);
}
