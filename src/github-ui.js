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

/** The webhook address and secret from the last Connect, kept so a re-drawn page still shows them. */
let lastSetup = null;
/** Settings ▸ Integrations ▸ GitHub. */
export function githubSection(ctx, { rerender } = {}) {
  const s = ctx.session; const g = githubOf(s); const edit = can(s.team, s.me, 'team.settings');
  const box = el('section.gh-settings', { id: 'gh-settings' });
  const setup = el('div', { id: 'gh-setup' });
  async function connect(repo) {
    try {
      const r = await ctx.backend.data.callFunction('githubConnect', { teamId: s.teamId, repo });
      lastSetup = { ...r, teamId: s.teamId }; if (rerender && setup.isConnected === false) rerender(); else showSetup(r); toast('Connected to ' + r.repo + '. Now add the webhook on GitHub.', 5000);
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
  if (lastSetup && lastSetup.teamId === s.teamId && g.repo && lastSetup.repo === g.repo) showSetup(lastSetup);
  box.append(el('h4', {}, ghMark(), ' GitHub'),
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
    if (await ctx.writeOps([{ type: 'update', path: 'team', data: { github: { repo: g.repo, issues: v.issues, done: v.done, owner: v.owner, connectedAt: g.connectedAt, write: g.write, last: g.last } } }])) { toast('GitHub settings saved.'); if (rerender) rerender(); }
  } }, 'Save');
  const touch = () => { save.disabled = false; };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
  const what = (l) => ({ ping: 'GitHub said hello (webhook added)', issues: 'issue ' + l.action, pull_request: 'pull request ' + (l.action === 'closed' ? 'closed or merged' : l.action) })[l.kind] || (l.kind + ' ' + l.action);
  const status = g.last && g.last.at
    ? el('div.banner.info.gh-status', { id: 'gh-status' }, el('b', {}, '✓ GitHub is sending events. '), 'Last: ' + what(g.last) + ', ' + ago(g.last.at) + (g.last.links || g.last.finished || g.last.created ? ' (' + [g.last.links && g.last.links + ' linked', g.last.finished && g.last.finished + ' finished', g.last.created && 'a task made'].filter(Boolean).join(', ') + ')' : '') + '.')
    : el('div.banner.gh-status', { id: 'gh-status' }, el('b', {}, 'No events from GitHub yet. '), 'Add the webhook (steps below); GitHub then sends a test “ping” and this turns green.');
  const guide = el('details.gh-guide', { id: 'gh-guide', open: !(g.last && g.last.at) },
    el('summary', {}, 'How to add the webhook on GitHub'),
    el('ol', {},
      el('li', {}, 'In TeamTrack, press ', el('b', {}, 'New secret'), ' (below). It shows a ', el('b', {}, 'Payload URL'), ' and a ', el('b', {}, 'Secret'), ', each with a Copy button.'),
      el('li', {}, 'On GitHub open ', el('a', { href: 'https://github.com/' + g.repo + '/settings/hooks', target: '_blank', rel: 'noopener noreferrer' }, g.repo + ' ▸ Settings ▸ Webhooks'), ' and press ', el('b', {}, 'Add webhook'), ' (or edit the one you have).'),
      el('li', {}, 'Paste the ', el('b', {}, 'Payload URL'), '. Set ', el('b', {}, 'Content type'), ' to ', el('code', {}, 'application/json'), '. Paste the ', el('b', {}, 'Secret'), '. Leave SSL verification on.'),
      el('li', {}, 'Under “Which events”, choose ', el('b', {}, 'Let me select individual events'), ', untick ', el('b', {}, 'Pushes'), ', tick ', el('b', {}, 'Issues'), ' and ', el('b', {}, 'Pull requests'), '. Keep ', el('b', {}, 'Active'), ' ticked. Save.'),
      el('li', {}, 'Check: the webhook’s ', el('b', {}, 'Recent Deliveries'), ' tab shows a green ✓ “ping”, and the box above turns green here. From then on, every issue or pull request that mentions a task’s reference shows on its card.')));
  box.append(
    el('p', {}, 'Connected to ', el('a', { href: 'https://github.com/' + g.repo, target: '_blank', rel: 'noopener noreferrer', id: 'gh-repo-link' }, g.repo), '.'),
    status, guide,
    el('label.chk', {}, el('input', { type: 'checkbox', id: 'gh-issues', checked: g.issues, disabled: !edit, onchange: (e) => { v.issues = e.target.checked; touch(); } }), ' New issues become tasks for ',
      el('select', { id: 'gh-owner', disabled: !edit, 'aria-label': 'Who gets new issues', onchange: (e) => { v.owner = e.target.value; touch(); } }, people.map(m => el('option', { value: m.uid, selected: m.uid === (g.owner || s.team.ownerUid) }, m.name || m.email)))),
    el('label.chk', {}, el('input', { type: 'checkbox', id: 'gh-done', checked: g.done, disabled: !edit, onchange: (e) => { v.done = e.target.checked; touch(); } }), ' A merged pull request or closed issue finishes its task (not past a sign-off still to give)'),
    edit ? el('div.row', { style: { gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
      el('button.btn.small', { type: 'button', id: 'gh-reconnect', onclick: () => connect(g.repo) }, 'New secret'),
      el('button.btn.small.danger', { type: 'button', id: 'gh-disconnect', onclick: async () => {
        if (!confirm('Disconnect ' + g.repo + '? GitHub events stop arriving; links already on tasks stay.')) return;
        try { await ctx.backend.data.callFunction('githubConnect', { teamId: s.teamId, disconnect: true }); lastSetup = null; toast('Disconnected.'); if (rerender) rerender(); } catch (e) { toast(serverError(e), 9000); }
      } }, 'Disconnect'), el('span.spacer'), save) : '',
    setup,
    tokenBox(ctx, g, edit, rerender),
    el('h4', { style: { marginTop: '18px' } }, 'Raise an issue'),
    el('p.hint', {}, 'Share this link in your team chat. It opens a short form that adds a task here and opens GitHub with the issue filled in, so the two are linked from the start.'),
    el('div.row', { style: { gap: '8px', flexWrap: 'wrap' } }, el('input.inp.gh-copy', { readonly: true, value: raiseLink(s.teamId), id: 'gh-raise-link', 'aria-label': 'Raise-an-issue link' }), copyBtn('gh-raise-copy', raiseLink(s.teamId)),
      el('button.btn.small', { type: 'button', id: 'gh-raise-open', onclick: () => openRaiseIssue(ctx) }, 'Open the form')));
  if (ctx.backend.isDemo) box.append(simulateBox(ctx));
  return box;
}

/** Optional: a token so TeamTrack creates issues straight away and closes them from a task. */
function tokenBox(ctx, g, edit, rerender) {
  const s = ctx.session;
  const save = async (token) => {
    try { const r = await ctx.backend.data.callFunction('githubConnect', { teamId: s.teamId, token }); toast(r.write ? 'TeamTrack can now create and close issues in ' + g.repo + '.' : 'Token removed.', 5000); if (rerender) rerender(); }
    catch (e) { toast(serverError(e), 9000); }
  };
  const box = el('div.gh-token', { id: 'gh-token' }, el('h4', { style: { marginTop: '18px' } }, 'Create and close issues from tasks'));
  if (g.write) {
    box.append(el('p', {}, '✓ On. “+ GitHub issue” makes the issue straight away and links it, and a task’s linked issues can be closed from the task.'),
      edit ? el('button.btn.small', { type: 'button', id: 'gh-token-remove', onclick: () => { if (confirm('Remove the token? Issues can still be raised, through GitHub’s own page.')) save(''); } }, 'Remove the token') : '');
    return box;
  }
  const input = el('input.inp', { id: 'gh-token-input', type: 'password', autocomplete: 'off', placeholder: 'github_pat_…', 'aria-label': 'GitHub token', disabled: !edit });
  box.append(el('p.hint', {}, 'Optional. Without it, “+ GitHub issue” opens GitHub’s page filled in and the issue links back when it’s submitted. With it, TeamTrack makes the issue itself, links it at once, and can close it (completed, not planned or duplicate) from the task.'),
    el('ol.hint.gh-token-steps', {},
      el('li', {}, 'On GitHub: ', el('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer' }, 'Settings ▸ Developer settings ▸ Fine-grained tokens ▸ Generate'), '.'),
      el('li', {}, 'Repository access: only ', el('b', {}, g.repo), '. Permissions: ', el('b', {}, 'Issues: Read and write'), '. Nothing else.'),
      el('li', {}, 'Paste it here. It’s kept on the server with the webhook secret; nobody can read it back, you included.')),
    el('div.row', { style: { gap: '8px', flexWrap: 'wrap' } }, input, el('button.btn.small.primary', { type: 'button', id: 'gh-token-save', disabled: !edit, onclick: () => { const t = input.value.trim(); if (!t) { toast('Paste the token first.'); return; } input.value = ''; save(t); } }, 'Save token')));
  return box;
}

// ── On a task: create, link and close issues ─────────────────────────────────
const PENDING = 'tt_gh_pending';
const pendingAll = () => { try { return JSON.parse(localStorage.getItem(PENDING) || '{}'); } catch { return {}; } };
/** This browser opened GitHub's new-issue page for the task and is waiting for the issue to link back. */
export function ghPending(taskId) { const p = pendingAll()[taskId]; return p && Date.now() - p < 864e5 ? p : 0; }
function setPending(taskId, on) { const all = pendingAll(); if (on) all[taskId] = Date.now(); else delete all[taskId]; try { localStorage.setItem(PENDING, JSON.stringify(all)); } catch { /* */ } }
/** "+ GitHub issue": made straight away with the team's token, else GitHub's page, filled in. */
export function createIssue(ctx, task) {
  const g = githubOf(ctx.session); if (!g.repo) return null;
  const m = modal('New GitHub issue', { narrow: true }); m.box.id = 'gh-new';
  const title = el('input.inp', { id: 'gh-new-title', value: task.name || '', maxlength: 200, 'aria-label': 'Issue title' });
  const body = el('textarea.inp.gh-new-body', { id: 'gh-new-body', rows: 7, maxlength: 4000, placeholder: 'What’s wrong or what needs doing? Steps, what you expected, links… (Markdown works)', 'aria-label': 'Details' });
  m.body.append(
    el('div.gh-new-repo.hint', {}, ghMark(), ' ', g.repo, ' · ', el('code', {}, refOf(task))),
    el('label.field', {}, el('span', {}, 'Title'), title),
    el('label.field', {}, el('span', {}, 'Details'), body),
    el('p.hint', {}, g.write ? 'Created on GitHub straight away and linked to this task.' : 'GitHub opens with this filled in: press “Submit new issue” there and it links here by itself.'));
  const go = el('button.btn.primary', { type: 'button', id: 'gh-new-save', onclick: async () => {
    const t = title.value.trim(); if (!t) { toast('Give the issue a title.'); title.focus(); return; }
    if (g.write) {
      go.disabled = true; go.textContent = 'Creating…';
      try {
        const r = await ctx.backend.data.callFunction('githubIssue', { teamId: ctx.session.teamId, taskId: task.id, action: 'create', title: t, body: body.value.trim() });
        m.close(); toast('Created issue #' + r.number + ' and linked it.', 5000, 'Open', () => window.open(r.url, '_blank', 'noopener'));
      } catch (e) { go.disabled = false; go.textContent = 'Create issue'; toast(serverError(e), 9000); }
      return;
    }
    window.open(newIssueUrl(g.repo, { title: t, body: body.value.trim(), ref: refOf(task) }), '_blank', 'noopener');
    setPending(task.id, true); m.close();
    toast('GitHub opened with the issue filled in. Press “Submit new issue” there; it links to this task by itself.', 7000);
    if (window.boardRender) window.boardRender();
    if (window.boardRefreshEditor) window.boardRefreshEditor();
  } }, g.write ? 'Create issue' : 'Open on GitHub');
  m.foot.append(el('span.spacer'), go);
  setTimeout(() => { title.focus(); title.select(); }, 30);
  return m;
}
/** GitHub's own state for a hand-linked issue or PR (needs the team's token; the webhook keeps it current after). */
export async function refreshIssue(ctx, task, kind, number) {
  const g = githubOf(ctx.session); if (!g.write) return null;
  try { return await ctx.backend.data.callFunction('githubIssue', { teamId: ctx.session.teamId, taskId: task.id, action: 'refresh', kind, number }); } catch { return null; }
}
/** A small GitHub-style issue glyph (not GitHub's logo). */
export function ghMark() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('class', 'gh-mark'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.7" fill="currentColor"/>';
  return s;
}
/** Link an issue or pull request by pasting its address. */
export function linkIssueDialog(ctx, task) {
  const g = githubOf(ctx.session);
  const m = modal('Link a GitHub issue or pull request', { narrow: true }); m.box.id = 'gh-link';
  const url = el('input.inp', { id: 'gh-link-url', placeholder: 'https://github.com/' + (g.repo || 'owner/repo') + '/issues/12  or just 12', 'aria-label': 'Issue or pull request' });
  m.body.append(el('p.hint', {}, 'Paste its address from GitHub, or type its number (#12).'), url);
  m.foot.append(el('span.spacer'), el('button.btn.primary', { type: 'button', id: 'gh-link-save', onclick: async () => {
    let v = url.value.trim().replace(/^#/, '');
    if (/^\d+$/.test(v) && g.repo) v = 'https://github.com/' + g.repo + '/issues/' + v;
    const mm = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(issues|pull)\/(\d+)/i.exec(v);
    if (!mm) { toast('That isn’t a GitHub issue or pull request address.'); return; }
    const clean = 'https://github.com/' + mm[1] + '/' + mm[2].toLowerCase() + '/' + mm[3];
    setPending(task.id, false);
    const ok = window.boardAddAttachment ? window.boardAddAttachment(task.id, { id: 'gh_' + mm[2].toLowerCase() + '_' + mm[3], provider: 'github', name: (mm[2].toLowerCase() === 'pull' ? 'PR' : 'Issue') + ' #' + mm[3], url: clean, size: 0, addedBy: ctx.user.name || '', addedAt: Date.now() }) : false;
    if (ok) {
      m.close(); toast('Linked #' + mm[3] + '.');
      if (g.write && g.repo && mm[1].split('/')[0].toLowerCase() === g.repo.split('/')[0].toLowerCase()) setTimeout(() => refreshIssue(ctx, task, mm[2].toLowerCase() === 'pull' ? 'pull' : 'issues', Number(mm[3])), 1200);
    }
  } }, 'Link'));
  setTimeout(() => url.focus(), 30);
}
/** Close (completed / not planned / duplicate) or reopen a linked issue from the task. */
export function closeIssueDialog(ctx, task, number, preset) {
  const m = modal('Close issue #' + number, { narrow: true }); m.box.id = 'gh-close';
  let reason = ['completed', 'not_planned', 'duplicate'].includes(preset) ? preset : 'completed';
  const dup = el('input.inp', { id: 'gh-close-dup', placeholder: 'Duplicate of # (number)', inputmode: 'numeric', style: { display: reason === 'duplicate' ? '' : 'none', marginTop: '8px' } });
  const finish = el('input', { type: 'checkbox', id: 'gh-close-finish', checked: task.flag !== 'completed' });
  const opt = (v, title, sub) => el('label.gh-close-opt', {}, el('input', { type: 'radio', name: 'gh-close-reason', value: v, checked: v === reason, onchange: () => { reason = v; dup.style.display = v === 'duplicate' ? '' : 'none'; finishRow.style.display = v === 'completed' && task.flag !== 'completed' ? '' : 'none'; } }), el('span', {}, el('b', {}, title), el('span.hint', {}, ' ' + sub)));
  const finishRow = el('label.chk', { style: { marginTop: '10px', display: reason === 'completed' && task.flag !== 'completed' ? '' : 'none' } }, finish, ' Also mark this task done');
  m.body.append(opt('completed', 'Close as completed', 'Done, fixed, resolved'), opt('not_planned', 'Close as not planned', 'Won’t fix, can’t reproduce, stale'), opt('duplicate', 'Close as duplicate', 'Of another issue'), dup, finishRow);
  m.foot.append(el('span.spacer'), el('button.btn.primary', { type: 'button', id: 'gh-close-save', onclick: async () => {
    const d = Number(String(dup.value).replace('#', '').trim());
    if (reason === 'duplicate' && !(d > 0)) { toast('Which issue is it a duplicate of?'); dup.focus(); return; }
    try {
      const r = await ctx.backend.data.callFunction('githubIssue', { teamId: ctx.session.teamId, taskId: task.id, action: 'close', number, reason, duplicateOf: d || 0, finish: reason === 'completed' && finish.checked });
      m.close(); toast('Closed #' + number + (r.finished ? ', and the task is done.' : '.'), 4000);
    } catch (e) { toast(serverError(e), 9000); }
  } }, 'Close issue'));
  if (reason === 'duplicate') setTimeout(() => dup.focus(), 30);
}
export async function reopenIssue(ctx, task, number) {
  try { await ctx.backend.data.callFunction('githubIssue', { teamId: ctx.session.teamId, taskId: task.id, action: 'reopen', number }); toast('Reopened #' + number + '.'); }
  catch (e) { toast(serverError(e), 9000); }
}

/** Demo only: pretend GitHub sent an event. (State kept across re-draws of the page.) */
const sim = { taskId: '', out: '', n: 40 };
function simulateBox(ctx) {
  const s = ctx.session; const g = githubOf(s);
  const open = (s.tasks || []).filter(t => t.flag !== 'completed');
  const pick = el('select', { id: 'gh-sim-task', 'aria-label': 'Task the pull request is for', onchange: (e) => { sim.taskId = e.target.value; } }, open.slice(0, 200).map(t => el('option', { value: t.id, selected: t.id === sim.taskId }, refOf(t) + ' · ' + t.name)));
  const out = el('div.hint', { id: 'gh-sim-out' }, sim.out);
  const send = async (kind, payload) => {
    try {
      const r = await ctx.backend.data.callFunction('githubSimulate', { teamId: s.teamId, kind, payload: { repository: { full_name: g.repo }, ...payload } });
      sim.out = 'GitHub → TeamTrack: ' + [r.links ? r.links + ' linked' : '', r.finished ? r.finished + ' finished' : '', r.created ? 'a task made' : '', r.why].filter(Boolean).join(' · ');
      const o = document.getElementById('gh-sim-out'); if (o) o.textContent = sim.out;
    } catch (e) { toast(friendlyError(e), 6000); }
  };
  const pr = (merged) => { const t = open.find(x => x.id === (sim.taskId || pick.value)); if (!t) return; const n = ++sim.n;
    const url = 'https://github.com/' + g.repo + '/pull/' + n; const ref = refOf(t);
    send('pull_request', { action: 'opened', pull_request: { number: n, title: 'Work on ' + t.name, body: '', html_url: url, head: { ref: branchName(refIdOf(t), t.name) }, merged: false } })
      .then(() => merged && send('pull_request', { action: 'closed', pull_request: { number: n, title: 'Work on ' + t.name + ' (' + ref + ')', body: '', html_url: url, head: { ref: 'main' }, merged: true } }));
  };
  return el('div.banner.gh-sim', { id: 'gh-sim' }, el('b', {}, 'Try it (demo): pretend GitHub sends an event'),
    el('div.row', { style: { gap: '8px', flexWrap: 'wrap', marginTop: '8px' } },
      el('button.btn.small', { type: 'button', id: 'gh-sim-issue', onclick: () => { const n = ++sim.n; send('issues', { action: 'opened', issue: { number: n, title: 'Battery connector gets hot', body: 'Seen on the bench test.', html_url: 'https://github.com/' + g.repo + '/issues/' + n } }); } }, 'A new issue arrives'),
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
