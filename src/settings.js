// ─────────────────────────────────────────────────────────────────────────────
//  Team settings: general (name, logo), members & invitations, roles &
//  permissions, custom fields, integrations, and deleting the team.
// ─────────────────────────────────────────────────────────────────────────────
import { startFlag } from './start.js';
import { APP_NAME, GOOGLE_CLIENT_ID, MS_CLIENT_ID, DEMO_MODE, LIMITS, STUDENT_EMAIL_CHECK, SERVER_EMAILS } from './config.js';
import { PERMISSIONS, can, roleList, normEmail, isValidEmail, DEFAULT_ROLES, GUEST_HELP } from './permissions.js';
import { FIELD_TYPES, DEFAULT_LABELS, newId, cleanField, cleanPhase, renumberWeeks, PHASE_COLORS, PHASE_TEMPLATE, FEATURES, cleanFeatures, cleanSubteams, WORKFLOW_TEMPLATES, STAGE_COLORS, MAX_STAGES, workflowOf, workflowMoves, stageIdOf, isCustomWorkflow, SUBTEAM_COLORS, SUBTEAM_LIMIT, planOf, PLANS, PRO_FEATURES, memberRoom, hasPro, MAX_CHECKS, storedWorkflow, leadsIndex, cleanWorkflow, cleanPurchase, cleanAutos, currencyOf, CURRENCIES, CURRENCY_NAMES, cleanBudget } from './model.js';
import { el, avatar, teamLogo, toast, modal, friendlyError, pickFile, imageFileToDataUrl } from './ui.js';
import { githubSection } from './github-ui.js';
import { askToLeave, cancelLeave, leaveOf } from './requests.js';
import { timeAgo } from './collab.js';

const TABS = [
  ['general', 'General'], ['members', 'Members'], ['roles', 'Roles & permissions'],
  ['plan', 'Plan'], ['features', 'Features'], ['workflow', 'Workflow'], ['subteams', 'Sub-teams'], ['phases', 'Phases'], ['templates', 'Templates'], ['fields', 'Fields'], ['integrations', 'Integrations'], ['danger', 'Delete team'],
];
const FIELD_TYPE_LABEL = { text: 'Text', number: 'Number', date: 'Date', select: 'Dropdown', checkbox: 'Checkbox', url: 'Link', person: 'Team member' };

export function openSettings(ctx, tab = 'general', focusUid = null) {
  const s = ctx.session; if (!s || !s.team) return;
  let current = TABS.some(t => t[0] === tab) ? tab : 'general';
  let invites = []; let invUnsub = null;
  const m = modal('Team settings', { onClose: () => { invUnsub && invUnsub(); window.TTSettingsRefresh = null; } });
  m.box.classList.add('settings-modal');
  m.body.style.padding = '0'; m.body.style.display = 'flex'; m.foot.remove();
  const nav = el('nav.settings-nav', { 'aria-label': 'Settings sections' });
  const pane = el('div.settings-pane');
  m.body.append(el('div.settings', { style: { flex: '1', width: '100%' } }, nav, pane));

  const T = () => ctx.session.team, me = () => ctx.session.me;
  if (can(T(), me(), 'members.manage')) {
    invUnsub = ctx.backend.data.watchInvites(s.teamId, (list) => { invites = list; if ((current === 'members' || current === 'plan') && !(pane.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) render(); else { const r = pane.querySelector('#plan-room'); if (r) r.dispatchEvent(new Event('refresh')); } }, (e) => console.warn(e));
  }
  window.TTSettingsRefresh = () => { if (!ctx.session) { m.close(); return; } if (current === 'subteams' && pane.querySelector('#st-save:not([disabled])')) return; const a = document.activeElement; const typing = pane.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(a.type)));
    // Re-draw with the latest team (another device, or a server change like GitHub connect) unless someone is typing here.
    if (!typing || current === 'members') { const y = pane.scrollTop; render(); pane.scrollTop = y; } };

  function render() {
    if (current === 'subteams' && !cleanFeatures(T().features).subteams) current = 'features';
    // Members and Roles are for people who manage them; everyone else sees the team on the board itself
    const shown = TABS.filter(([k]) => (k !== 'danger' || me().roleId === 'owner') && (k !== 'subteams' || cleanFeatures(T().features).subteams)
      && (k !== 'members' || can(T(), me(), 'members.manage')) && (k !== 'roles' || can(T(), me(), 'roles.manage'))
      // switches only owners and admins can change: others just see the result on the board
      && (!['features', 'workflow', 'fields', 'integrations'].includes(k) || can(T(), me(), 'team.settings')));
    if (!shown.some(([k]) => k === current)) current = 'general';
    nav.replaceChildren(...shown
      .map(([k, label]) => el('button' + (k === current ? '.on' : ''), { type: 'button', onclick: () => { current = k; render(); } }, label)));
    pane.replaceChildren();
    const fn = { general, members, roles, plan, features, workflow, subteams, phases, templates, fields, integrations, danger }[current];
    fn(pane, ctx, { invites, getInvites: () => invites, focusUid, rerender: render });
    focusUid = null;
  }
  render();
  return m;
}

const save = async (ctx, ops, msg) => { const ok = await ctx.writeOps(ops); if (ok && msg) toast(msg); return ok; };
const readOnlyNote = (txt) => el('div.read-only-note', {}, txt || 'View only — your role can’t change this.');

// ── Features: what this team uses ───────────────────────────────────────────
function features(pane, ctx, { rerender } = {}) {
  startFlag(ctx.session.teamId, ctx.user.uid, 'tools');
  const T = ctx.session.team; const editable = can(T, ctx.session.me, 'team.settings'); const on = cleanFeatures(T.features);
  const card = (f) => el('label.feature-card' + (on[f.key] ? '.on' : ''), { dataset: { feature: f.key } },
    el('span.feature-icon', { 'aria-hidden': 'true' }, f.icon),
    el('span.feature-text', {}, el('b', {}, f.name), el('span.hint', {}, f.help)),
    el('span.switch', {}, el('input', { type: 'checkbox', role: 'switch', checked: on[f.key], disabled: !editable, 'aria-label': f.name,
      onchange: async (e) => { const ok = await ctx.TT.setFeature(f.key, e.target.checked); if (ok) toast(f.name + (e.target.checked ? ' turned on.' : ' turned off.')); if (rerender) rerender(); } }), el('i')));
  pane.append(
    el('section', {}, el('h4', {}, 'Features'), editable ? '' : readOnlyNote(),
      el('p.hint', {}, 'Turn on only what your team needs, so the board stays simple. Turning a feature off hides it; nothing is deleted, and turning it back on brings everything back.')),
    el('section', {}, el('h4', {}, 'Always on'), el('p.hint', {}, 'Board and Kanban, phases, comments and @mentions, My tasks, search, templates, repeating tasks, analytics and the progress report.')),
    el('section', {}, el('h4', {}, 'Standard'), el('div.feature-list', {}, FEATURES.filter(f => f.group === 'standard').map(card))),
    el('section', {}, el('h4', {}, 'Advanced'), el('p.hint', {}, 'For bigger projects, labs and engineering teams.'), el('div.feature-list', {}, FEATURES.filter(f => f.group === 'advanced').map(card))),
    el('section', {}, el('h4', {}, 'Pro and Organisation'), el('p.hint', {}, 'Paid features, being built now. Pilot teams get them free while they are in development — see Settings ▸ Plan.'),
      el('div.feature-list.pro-list', {}, PRO_FEATURES.map(f => el('div.feature-card.pro-card', { dataset: { pro: f.key } },
        el('span.feature-icon', { 'aria-hidden': 'true' }, f.icon), el('span.feature-text', {}, el('b', {}, f.name), el('span.hint', {}, f.help)),
        el('span.pro-badge' + (hasPro(T, f.key) && f.status === 'live' ? '.on' : ''), {}, hasPro(T, f.key) ? (f.status === 'live' ? 'Included' : 'Coming soon') : (f.tier === 'org' ? 'Organisation' : 'Pro') + (f.status === 'live' ? '' : ' · soon')))))),
  );
}

// ── Plan ────────────────────────────────────────────────────────────────────
const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function plan(pane, ctx, { invites, rerender } = {}) {
  const s = ctx.session, T = s.team, TT = ctx.TT; const P = planOf(T);
  const settings = TT.planAdmin;   // plans are changed by the Owner and Admins only
  const room = memberRoom(T, s.members.length, (invites || []).length);
  const bar = (used, lim) => el('div.plan-bar' + (lim && used >= lim ? '.full' : ''), {}, el('i', { style: { width: (lim ? Math.min(100, used / lim * 100) : 8) + '%' } }));
  pane.append(el('section.plan-now', {},
    el('h4', {}, 'Plan'),
    el('div.plan-current', {}, el('span.plan-name.tier-' + P.tier, { id: 'plan-name' }, P.label), P.until ? el('span.hint', {}, 'until ' + fmtDay(P.until)) : '', P.expired ? el('span.hint.t-bad', {}, 'Your Pro period has ended; the team is back on Free. Nothing was deleted.') : ''),
    el('div.plan-usage', {},
      el('div', {}, el('div.plan-usage-l', {}, 'Members and pending invitations'), el('div.plan-usage-v', { id: 'plan-members' }, room.used + (room.limit ? ' of ' + room.limit : '')), bar(room.used, room.limit)),
      el('div', {}, el('div.plan-usage-l', {}, 'Finance history shown'), el('div.plan-usage-v', {}, P.financeHistoryDays ? 'Last ' + P.financeHistoryDays + ' days' : 'Everything')),
      el('div', {}, el('div.plan-usage-l', {}, 'Teams you can own'), el('div.plan-usage-v', {}, P.ownTeams ? P.ownTeams + ' on Free' : 'No limit')))));
  // The three plans side by side
  const tierCard = (key, items) => { const t = PLANS[key]; const on = P.tier === key;
    return el('div.plan-card' + (on ? '.on' : ''), { dataset: { tier: key } }, el('div.plan-card-head', {}, el('b', {}, t.name), on ? el('span.pro-badge.on', {}, 'Your plan') : ''),
      el('div.plan-price', {}, t.price), el('ul', {}, items.map(x => el('li', {}, x)))); };
  pane.append(el('section', {}, el('h4', {}, 'Compare plans'), el('div.plan-cards', {},
    tierCard('free', ['Everything Trawpie does today', 'Up to ' + PLANS.free.members + ' members a team', 'Up to ' + PLANS.free.ownTeams + ' teams of your own', 'Finance history for ' + PLANS.free.financeHistoryDays + ' days']),
    tierCard('pro', ['Everything in Free', 'Up to ' + PLANS.pro.members + ' members', ...PRO_FEATURES.filter(f => f.tier === 'pro').map(f => f.name + (f.status === 'live' ? '' : ' (soon)')), 'Pro Education: free for students and staff with a university email']),
    tierCard('org', ['Everything in Pro', ...PRO_FEATURES.filter(f => f.tier === 'org').map(f => f.name + (f.status === 'live' ? '' : ' (soon)')), 'Priority support and an uptime commitment']))));
  // Ask for Pro (pilot: no payment yet)
  const req = TT.proRequest;
  // Pro Education is only by a checked university email (above), never by request.
  const WANTS = { pro: 'Pro (lab, start-up or company team)', org: 'Organisation (department or company)' };
  // Members ask the Owner and Admins; Owner and Admins see who asked.
  const asks = TT.planAsks;
  if (settings && asks.length && P.tier === 'free') pane.append(el('section.plan-asks', {}, el('h4', {}, '🙋 Asked for Pro'),
    ...asks.map(a => el('div.adm-req', {}, el('b', {}, a.byName || 'A member'), el('span.hint', {}, ' asked on ' + fmtDay(a.at) + (a.note ? ': “' + a.note + '”' : '')), ' ',
      el('button.btn.small.ghost', { type: 'button', onclick: async () => { if (await TT.dismissAsk(a.by)) rerender && rerender(); } }, 'Dismiss')))));
  if (!settings && P.tier === 'free') {
    const mine = asks.find(a => a.by === ctx.user.uid);
    const owners = s.members.filter(m => ['owner', 'admin'].includes(m.roleId)).map(m => m.name || m.email);
    const note = el('input.inp', { id: 'plan-ask-note', maxlength: 300, placeholder: 'Why the team needs it (optional)' });
    pane.append(el('section.plan-member', {}, el('h4', {}, 'Want Pro for this team?'),
      el('p.hint', {}, 'Only the team’s owner and admins can change the plan (' + owners.join(', ') + '). An owner with a university email can switch on Pro Education free.'),
      mine ? el('p', { id: 'plan-asked' }, '🙋 You asked on ' + fmtDay(mine.at) + '. ', el('button.link-btn', { type: 'button', onclick: async () => { if (await TT.dismissAsk(ctx.user.uid)) rerender && rerender(); } }, 'Withdraw'))
        : el('div.row', { style: { gap: '8px', flexWrap: 'wrap' } }, note, el('button.btn', { type: 'button', id: 'plan-ask-admins', onclick: async () => { if (await TT.askForPro(note.value)) { toast('Asked the owner and admins.'); rerender && rerender(); } } }, 'Ask them'))));
  }
  // Students and staff: a verified university email turns on free Pro Education straight away.
  const eduSoon = P.tier === 'pro' && P.edu && P.until && P.until - Date.now() < 30 * 864e5;
  if ((P.tier === 'free' || eduSoon) && settings && s.me.roleId !== 'owner') {
    pane.append(el('section.plan-edu', {}, el('h4', {}, '🎓 Free for students and university staff'),
      el('p.hint', { id: 'plan-edu-owner' }, 'Pro Education is switched on by the team’s owner, with their university email. It stays with them: if the team is handed to someone else, it goes back to Free until the new owner turns it on.')));
  }
  if ((P.tier === 'free' || eduSoon) && settings && s.me.roleId === 'owner') {
    const claim = TT.eduClaim; const thisTeam = claim.teams.includes(s.teamId); const left = claim.limit - claim.teams.length;
    const sec = el('section.plan-edu', {}, el('h4', {}, '🎓 Free for students and university staff'));
    if (TT.academic) {
      sec.append(el('p', {}, 'Your university email ', el('b', {}, TT.studentEmail), ' is confirmed, so this team can have ', el('b', {}, 'Pro Education free'), ' for a year, renewable while you’re at university.'),
        el('p.hint', { id: 'plan-edu-count' }, 'Each person can switch it on for up to ' + claim.limit + ' teams a year. You’ve used ' + claim.teams.length + ' of ' + claim.limit + (thisTeam ? ', including this team.' : '.') + ' It’s for study, research and university projects.'),
        thisTeam || left > 0
          ? el('button.btn.primary', { type: 'button', id: 'plan-edu', onclick: async () => { if (await TT.claimEdu()) { toast('Pro Education is on for this team.'); setTimeout(() => rerender && rerender(), 300); } } }, P.tier === 'free' ? 'Turn on free Pro Education' : 'Renew Pro Education for a year')
          : el('p.hint.t-bad', { id: 'plan-edu-full' }, 'You’ve used all ' + claim.limit + ' this year. Ask for Pro below if this team needs it too.'));
    } else if (STUDENT_EMAIL_CHECK || DEMO_MODE) {
      // Signed in with a personal email: prove a university address with a 6-digit code.
      const email = el('input.inp', { id: 'stu-email', type: 'email', placeholder: 'you@university.ac.uk', autocomplete: 'email', 'aria-label': 'Your university email' });
      const code = el('input.inp', { id: 'stu-code', inputmode: 'numeric', maxlength: 6, placeholder: '6-digit code', 'aria-label': 'Code from the email', autocomplete: 'one-time-code' });
      const status = el('p.hint', { id: 'stu-status' });
      const step2 = el('div.row.stu-step2', { hidden: true }, code, el('button.btn.primary', { type: 'button', id: 'stu-verify', onclick: async (e) => {
        e.target.disabled = true;
        try { await TT.confirmStudentCode(code.value); toast('University email confirmed.'); rerender && rerender(); }
        catch (err) { status.textContent = '⚠ ' + (err.message || 'Could not check the code.'); } finally { e.target.disabled = false; }
      } }, 'Confirm'));
      sec.append(el('p.hint', {}, 'Signed in with a personal email? Add your university email (ending .ac.uk, .edu, .ac.xx or .edu.xx). We email it a 6-digit code; enter it here and Pro Education unlocks.'),
        el('div.row.stu-step1', {}, email, el('button.btn', { type: 'button', id: 'stu-send', onclick: async (e) => {
          e.target.disabled = true; status.textContent = 'Sending…';
          try {
            const r = await TT.sendStudentCode(email.value);
            status.textContent = 'We sent a code to ' + r.email + '. It works for 15 minutes. Not in your inbox? Check your Junk folder.' + (r.demoCode ? ' (Demo: your code is ' + r.demoCode + ')' : '');
            step2.hidden = false; code.focus();
          } catch (err) { status.textContent = '⚠ ' + (err.message || 'Could not send the code.'); } finally { e.target.disabled = false; }
        } }, 'Send code')), step2, status,
        el('p.hint', {}, 'Each university email can be linked to one account, and is checked again once a year.'));
    } else {
      sec.append(el('p.hint', { id: 'plan-edu-hint' }, 'Sign in with your university email (ending .ac.uk, .edu, .ac.xx or .edu.xx) to turn on Pro Education free, instantly.'));
    }
    pane.append(sec);
  }
  if ((P.tier === 'free' && settings) || req) {
    const box = el('section.plan-ask', {}, el('h4', {}, 'Get Pro'));
    if (req && req.status === 'open') box.append(el('p', { id: 'plan-request-state' }, '📨 Request sent on ' + fmtDay(req.at) + ' for ' + (WANTS[req.wants] || req.wants) + '. You’ll hear back by email.'), settings ? el('button.btn.small.ghost', { type: 'button', onclick: async () => { if (await TT.withdrawProRequest()) { toast('Request withdrawn.'); rerender && rerender(); } } }, 'Withdraw request') : '');
    else if (req && req.status === 'approved') box.append(el('p', { id: 'plan-request-state' }, '✅ Your request was approved.'));
    else if (req && req.status === 'declined') box.append(el('p', { id: 'plan-request-state' }, 'Your last request was not approved this time. You can ask again with more detail.'));
    if (P.tier === 'free' && (!req || req.status !== 'open')) {
      if (settings) {
        const wants = el('select', { id: 'plan-wants' }, Object.entries(WANTS).map(([v, t]) => el('option', { value: v }, t)));
        const note = el('textarea', { id: 'plan-note', rows: 3, maxlength: 1000, placeholder: 'Who you are and what you need Pro for, e.g. “Robotics lab, 14 people, need approvals and backups.”' });
        box.append(el('p.hint', {}, 'Pro is in its pilot: no payment yet. Pilot teams get Pro free while it is being built, in return for feedback.'),
          el('label.field', {}, el('span', {}, 'Which plan'), wants), el('label.field', {}, el('span', {}, 'About your team'), note),
          el('button.btn.primary', { type: 'button', id: 'plan-ask', onclick: async () => { if (await TT.requestPro(wants.value, note.value)) { toast('Request sent.'); rerender && rerender(); } } }, 'Ask for Pro'));
      }
    }
    pane.append(box);
  }
  // Platform admin (you): set any team's plan; answer requests
  if (TT.isPlatformAdmin) pane.append(adminPlans(ctx, rerender));
  else if (DEMO_MODE) pane.append(el('p.hint.plan-demo', {}, 'Demo: ', el('button.link-btn', { type: 'button', id: 'plan-demo-admin', onclick: async () => { await TT.demoMakeAdmin(); toast('You are now a platform admin in this demo.'); rerender && rerender(); } }, 'make me a platform admin'), ' to try giving teams Pro.'));
}
// ── Pilot numbers (Platform admin) ──────────────────────────────────────────
const ago = (t) => { if (!t) return 'never'; const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
/** A tiny line of people active in the last 7 days, one point per day (up to 8 weeks). */
function sparkline(history) {
  const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 84 22'); svg.setAttribute('class', 'adm-spark'); svg.setAttribute('aria-hidden', 'true');
  const pts = (history || []).slice(-56); if (pts.length < 2) return svg;
  const max = Math.max(1, ...pts.map(p => p.active7));
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pts.map((p, i) => (2 + i * 80 / (pts.length - 1)).toFixed(1) + ',' + (20 - p.active7 / max * 18).toFixed(1)).join(' '));
  svg.append(line); return svg;
}
export function teamStatsView(rows, TT) {
  const box = el('div');
  const list = [...rows].sort((a, b) => (b.active7 - a.active7) || (b.lastActivity - a.lastActivity));
  const people = list.reduce((n, r) => n + r.members, 0), active = list.reduce((n, r) => n + r.active7, 0);
  const updated = Math.max(0, ...list.map(r => r.at || 0));
  const refresh = el('button.btn.small.ghost', { type: 'button', id: 'adm-stats-refresh', onclick: async () => {
    refresh.disabled = true; refresh.textContent = 'Counting…';
    try { const r = await TT.refreshTeamStats(); toast('Counted ' + r.teams + ' team' + (r.teams === 1 ? '' : 's') + '.'); }
    catch (e) { toast(String((e && e.message) || e), 6000); }
    refresh.disabled = false; refresh.textContent = 'Refresh now';
  } }, 'Refresh now');
  box.append(el('p.hint', {}, el('b', {}, String(list.filter(r => r.active7 > 0).length)), ' of ' + list.length + ' teams active this week · ', el('b', {}, String(active)), ' of ' + people + ' people (' + (people ? Math.round(100 * active / people) : 0) + '%) changed something. ',
    'Counts only, never what teams wrote. Updated daily' + (updated ? ', last ' + ago(updated) : '') + '. ', refresh));
  if (!list.length) { box.append(el('p.hint', {}, 'No numbers yet: press Refresh now, or wait for tomorrow morning.')); return box; }
  const head = el('tr', {}, ...['Team', 'Plan', 'People', 'Active this week', 'Tasks changed', 'Comments', 'Last change', '8-week trend'].map(h => el('th', {}, h)));
  const body = list.map(r => el('tr' + (r.active7 === 0 ? '.adm-quiet' : ''), {},
    el('td', {}, el('b', {}, r.name || r.id), r.feedback7 ? el('span.hint', {}, ' · 💬 ' + r.feedback7) : ''),
    el('td', {}, r.plan === 'free' ? 'Free' : (r.plan === 'org' ? 'Org' : 'Pro') + (r.edu ? ' Edu' : '')),
    el('td', {}, String(r.members) + (r.invitesPending ? ' (+' + r.invitesPending + ' invited)' : '')),
    el('td', {}, r.active7 + ' of ' + r.members + (r.members ? ' (' + Math.round(100 * r.active7 / r.members) + '%)' : '')),
    el('td', {}, String(r.tasksChanged7) + (r.tasksCreated7 ? ' (' + r.tasksCreated7 + ' new)' : '')),
    el('td', {}, String(r.comments7)),
    el('td', {}, ago(r.lastActivity)),
    el('td', {}, sparkline(r.history))));
  box.append(el('div.adm-stats-scroll', {}, el('table.tbl.adm-stats-table', {}, head, ...body)),
    el('p.hint', {}, 'Active = changed a task or commented in the last 7 days. A greyed row had no changes this week.'));
  return box;
}

function adminPlans(ctx, rerender) {
  const s = ctx.session, TT = ctx.TT; const cur = s.team.plan || {};
  const tier = el('select', { id: 'adm-tier' }, [['free', 'Free'], ['pro', 'Pro'], ['org', 'Organisation']].map(([v, t]) => el('option', { value: v, selected: (cur.tier || 'free') === v }, t)));
  const edu = el('input', { type: 'checkbox', id: 'adm-edu', checked: !!cur.edu });
  const until = el('input', { type: 'date', id: 'adm-until', value: cur.until ? new Date(cur.until).toLocaleDateString('en-CA') : '' });
  const note = el('input', { id: 'adm-note', maxlength: 200, value: cur.note || '', placeholder: 'e.g. Pilot, UAS Challenge 2027' });
  const list = el('div.adm-requests', {}, el('p.hint', {}, 'Loading requests…'));
  const eduList = el('div.adm-edu-teams', {}, el('p.hint', {}, 'Loading…'));
  const errList = el('div.adm-errors', {}, el('p.hint', {}, 'Loading…'));
  const fbList = el('div.adm-feedback', {}, el('p.hint', {}, 'Loading…'));
  const statsBox = el('div.adm-stats', {}, el('p.hint', {}, 'Loading…'));
  const sec = el('section.plan-admin', {}, el('h4', {}, '🛠 Platform admin'),
    el('p.hint', {}, 'Only you see this. Changes apply immediately; payments will do this automatically later.'),
    el('div.adm-row', {}, el('label.field', {}, el('span', {}, 'This team’s plan'), tier), el('label.row.adm-edu', {}, edu, ' Education'), el('label.field', {}, el('span', {}, 'Until (optional)'), until), el('label.field.adm-note', {}, el('span', {}, 'Note'), note),
      el('button.btn.primary', { type: 'button', id: 'adm-save', onclick: async () => {
        const ok = await TT.setTeamPlan(s.teamId, { tier: tier.value, edu: edu.checked, until: until.value ? new Date(until.value + 'T23:59:59').getTime() : 0, note: note.value });
        if (ok) { toast('Plan set to ' + tier.options[tier.selectedIndex].text + (edu.checked && tier.value !== 'free' ? ' Education' : '') + '.'); setTimeout(() => rerender && rerender(), 300); }
      } }, 'Set plan')),
    el('h4', {}, '📈 Teams using Trawpie'), statsBox,
    el('h4', {}, 'Pro requests from all teams'), list,
    el('h4', {}, 'Teams on Pro Education'), eduList,
    el('h4', {}, '💬 Feedback'), fbList,
    el('h4', {}, '🩺 Recent errors (last 30 days)'), errList);
  const unsub = TT.watchPlanRequests((rows) => {
    if (!sec.isConnected) { unsub && unsub(); return; }
    const open = rows.filter(r => r.status === 'open').sort((a, b) => a.at - b.at);
    list.replaceChildren(...(open.length ? open.map(r => el('div.adm-req', {},
      el('div', {}, el('b', {}, r.teamName), el('span.hint', {}, ' · ' + r.members + ' members · asks for ' + r.wants + ' · ' + (r.byName || r.email) + ' · ' + fmtDay(r.at))), r.note ? el('div.hint', {}, '“' + r.note + '”') : '',
      el('div.row', { style: { gap: '6px', marginTop: '6px' } },
        el('button.btn.small.primary', { type: 'button', onclick: async () => { if (await TT.setTeamPlan(r.teamId, { tier: r.wants === 'org' ? 'org' : 'pro', edu: r.wants === 'edu', note: 'Pilot' }) && await TT.decideRequest(r.teamId, 'approved')) toast('Approved ' + r.teamName + '.'); } }, 'Approve' + (r.wants === 'edu' ? ' (Pro Education)' : r.wants === 'org' ? ' (Organisation)' : ' (Pro)')),
        el('button.btn.small.ghost', { type: 'button', onclick: async () => { if (await TT.decideRequest(r.teamId, 'declined')) toast('Declined.'); } }, 'Decline')))) : [el('p.hint', {}, 'No open requests.')]));
  }, (e) => { list.replaceChildren(el('p.hint', {}, 'Could not load requests: ' + (e.message || e))); });
  const unsubStats = TT.watchTeamStats((rows) => {
    if (!sec.isConnected) { unsubStats && unsubStats(); return; }
    statsBox.replaceChildren(teamStatsView(rows, TT));
  }, (e) => { statsBox.replaceChildren(el('p.hint', {}, 'Could not load: ' + (e.message || e))); });
  const KINDS = { bug: '🐞', idea: '💡', question: '❓', other: '💬' };
  const unsubFb = TT.watchFeedback((rows) => {
    if (!sec.isConnected) { unsubFb && unsubFb(); return; }
    fbList.replaceChildren(...(rows.length ? rows.slice(0, 30).map(f => el('div.adm-fb', {},
      el('div', {}, KINDS[f.kind] || '💬', ' ', el('b', {}, f.name || f.email || 'Someone'), el('span.hint', {}, ' · ' + fmtDay(f.at) + (f.email ? ' · ' : '')), f.email ? el('a', { href: 'mailto:' + f.email + '?subject=' + encodeURIComponent('Re: your Trawpie feedback') }, 'Reply') : ''),
      el('p', {}, f.text), (f.errors || []).length ? el('div.hint', {}, 'Errors: ' + f.errors.join(' · ')) : '')) : [el('p.hint', {}, 'No feedback yet.')]));
  }, (e) => { fbList.replaceChildren(el('p.hint', {}, 'Could not load: ' + (e.message || e))); });
  const unsubErr = TT.watchClientErrors((rows) => {
    if (!sec.isConnected) { unsubErr && unsubErr(); return; }
    // Group by message: how often, how many people, last seen, newest stack.
    const groups = new Map();
    rows.forEach(r => { const k = r.kind + '|' + r.msg; const g = groups.get(k) || { ...r, count: 0, users: new Set() }; g.count++; g.users.add(r.uid); if (r.at > g.at) Object.assign(g, { at: r.at, stack: r.stack, where: r.where, build: r.build, ua: r.ua }); groups.set(k, g); });
    const list = [...groups.values()].sort((a, b) => b.at - a.at).slice(0, 30);
    errList.replaceChildren(...(list.length ? list.map(g => el('details.adm-err', {}, el('summary', {}, el('b', {}, g.msg), el('span.hint', {}, ' · ' + g.count + '× · ' + g.users.size + (g.users.size === 1 ? ' person' : ' people') + ' · last ' + fmtDay(g.at) + ' · ' + g.kind)),
      el('pre.adm-stack', {}, [g.where && 'Where: ' + g.where, 'Build: ' + g.build, 'Browser: ' + g.ua, '', g.stack].filter(x => x !== undefined && x !== false).join('\n')))) : [el('p.hint', {}, 'No errors reported. 🎉')]));
  }, (e) => { errList.replaceChildren(el('p.hint', {}, 'Could not load: ' + (e.message || e))); });
  const unsubEdu = TT.watchEduTeams((rows) => {
    if (!sec.isConnected) { unsubEdu && unsubEdu(); return; }
    rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    eduList.replaceChildren(...(rows.length ? rows.map(r => el('div.adm-req', {},
      el('div', {}, el('b', {}, r.name), el('span.hint', {}, ' · ' + (r.plan.note || '') + (r.plan.until ? ' · until ' + fmtDay(r.plan.until) : ''))),
      el('div.row', { style: { gap: '6px', marginTop: '6px' } }, el('button.btn.small.ghost', { type: 'button', onclick: async () => { if (confirm('Switch “' + r.name + '” back to Free?') && await TT.setTeamPlan(r.id, { tier: 'free', note: 'Pro Education removed' })) toast(r.name + ' is on Free.'); } }, 'Switch to Free')))) : [el('p.hint', {}, 'No teams on Pro Education.')]));
  }, (e) => { eduList.replaceChildren(el('p.hint', {}, 'Could not load: ' + (e.message || e))); });
  return sec;
}

// ── Sub-teams ───────────────────────────────────────────────────────────────
const SUBTEAM_IDEAS = ['Fuselage', 'Payload', 'Landing gear', 'Electronics', 'Software', 'Propulsion', 'Design', 'Testing'];
// ── Workflow: the team's own stages ─────────────────────────────────────────
const COLOR_NAMES = { '#63b3ed': 'Blue', '#f6ad55': 'Orange', '#b794f4': 'Purple', '#4fd1c5': 'Teal', '#f687b3': 'Pink', '#fc8181': 'Red', '#a0aec0': 'Grey', '#68d391': 'Green' };
function workflow(pane, ctx, { rerender } = {}) {
  const s = ctx.session, T = s.team; const editable = can(T, s.me, 'team.settings');
  const wf = workflowOf(T);
  let draft = JSON.parse(JSON.stringify(wf.stages));
  // How many open tasks are in each current stage (shown, and used to say where they'll go).
  const counts = {}; (s.tasks || []).filter(t => t.flag !== 'completed').forEach(t => { const id = stageIdOf(t, wf.stages, wf.moved); counts[id] = (counts[id] || 0) + 1; });
  const box = el('div.wf-edit'); const note = el('p.hint', { id: 'wf-note' });
  const saveBtn = el('button.btn.primary', { type: 'button', id: 'wf-save', disabled: true, onclick: async () => {
    const stages = draft.map((x, i) => ({ ...x, name: (x.name || '').trim() || 'Stage ' + (i + 1) }));
    const lower = stages.map(x => x.name.toLowerCase()); const dup = lower.find((n, i) => lower.indexOf(n) !== i);
    if (dup) return toast('Two stages are called “' + stages[lower.indexOf(dup)].name + '”. Give each its own name.', 5000);
    const moved = workflowMoves(wf.stages, stages, wf.moved);
    const custom = isCustomWorkflow(stages);
    const w = cleanWorkflow({ stages, moved });
    const value = w && (custom || Object.keys(moved).length) ? storedWorkflow(w) : null;
    if (await save(ctx, [{ type: 'update', path: 'team', data: { workflow: value } }], 'Workflow saved.')) { if (rerender) rerender(); }
  } }, 'Save workflow');
  const touch = () => { saveBtn.disabled = false; build(); };
  const newId = (name) => { const base = String(name || 'stage').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'stage'; let id = base, n = 2; while (draft.some(x => x.id === id) || id === 'done') id = base + n++; return id; };
  function build() {
    const gone = wf.stages.filter(x => !draft.some(d => d.id === x.id) && counts[x.id]);
    const moves = workflowMoves(wf.stages, draft, {});
    note.replaceChildren(...(gone.length ? gone.map(g => el('div', {}, '↪ The ' + counts[g.id] + ' task' + (counts[g.id] === 1 ? '' : 's') + ' in “' + g.name + '” will move to “' + ((draft.find(d => d.id === moves[g.id]) || {}).name || draft[0].name) + '”.')) : []));
    const rows = draft.map((st, i) => {
      const last = i === draft.length - 1;
      const color = el('select.wf-color', { 'aria-label': 'Colour of ' + st.name, disabled: !editable, onchange: (e) => { st.color = e.target.value; touch(); } }, STAGE_COLORS.map(c => el('option', { value: c, selected: c === st.color }, COLOR_NAMES[c] || c)));
      const name = el('input.wf-name', { value: st.name, maxlength: 30, 'aria-label': 'Stage name', disabled: !editable, oninput: (e) => { st.name = e.target.value; saveBtn.disabled = false; } });
      const kind = last ? el('span.hint.wf-kind', {}, 'Done (finished)') : el('select.wf-kind', { 'aria-label': 'Counts as', disabled: !editable, onchange: (e) => { st.kind = e.target.value; touch(); } },
        el('option', { value: 'todo', selected: st.kind === 'todo' }, 'To do'), el('option', { value: 'doing', selected: st.kind === 'doing' }, 'Doing'));
      const limit = last ? el('span.hint', {}, '—') : el('input.wf-limit', { type: 'number', min: 0, max: 99, value: st.limit || '', placeholder: 'none', 'aria-label': 'Most tasks at once in ' + st.name, disabled: !editable, oninput: (e) => { st.limit = Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0))); saveBtn.disabled = false; } });
      // Who signs off before a task moves on from this stage, and its checklist (workflow step 2).
      const people = (s.members || []).slice().sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
      const so = last ? el('span.hint', {}, '—') : el('div.wf-so', {},
        el('select.wf-signoff', { 'aria-label': 'Who signs off ' + st.name, disabled: !editable, onchange: (e) => { st.signoff = e.target.value; if (st.signoff !== 'person') st.signer = ''; touch(); } },
          [['', 'Anyone on the task'], ['lead', 'Sign-off: sub-team lead'], ['admin', 'Sign-off: an admin'], ['person', 'Sign-off: a named person']].map(([v, t]) => el('option', { value: v, selected: (st.signoff || '') === v }, t))),
        st.signoff === 'person' ? el('select.wf-signer', { 'aria-label': 'Who signs off ' + st.name, disabled: !editable, onchange: (e) => { st.signer = e.target.value; saveBtn.disabled = false; } },
          el('option', { value: '' }, 'Choose who…'), people.map(m => el('option', { value: m.uid, selected: m.uid === st.signer }, m.name || m.email))) : '');
      const items = st.checklist || [];
      const clText = el('textarea.wf-cl-text', { rows: 4, 'aria-label': 'Checklist for ' + st.name + ', one item per line', placeholder: 'One item per line, e.g.\nCAD shared\nMass budget updated', disabled: !editable,
        oninput: (e) => { const lines = e.target.value.split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, MAX_CHECKS); const stamp = Date.now().toString(36); st.checklist = lines.map((text, k) => ({ id: (items[k] && items[k].id) || (st.id.slice(0, 20) + '_c' + stamp + k).slice(0, 40), text: text.slice(0, 80) })); saveBtn.disabled = false; } });
      clText.value = items.map(c => c.text).join('\n');
      const cl = last ? el('span.hint', {}, '—') : el('details.wf-cl', {}, el('summary', {}, items.length ? items.length + ' item' + (items.length === 1 ? '' : 's') : 'None'), clText, el('span.hint', {}, 'Up to ' + MAX_CHECKS + ', ticked on each task.'));
      const move = (d) => { const j = i + d; if (j < 0 || j >= draft.length - 1) return; [draft[i], draft[j]] = [draft[j], draft[i]]; touch(); };
      const acts = editable ? el('span.wf-acts', {},
        last ? '' : el('button.btn.small.ghost', { type: 'button', 'aria-label': 'Move ' + st.name + ' earlier', disabled: i === 0, onclick: () => move(-1) }, '↑'),
        last ? '' : el('button.btn.small.ghost', { type: 'button', 'aria-label': 'Move ' + st.name + ' later', disabled: i >= draft.length - 2, onclick: () => move(1) }, '↓'),
        last || draft.length <= 2 ? '' : el('button.btn.small.ghost', { type: 'button', 'aria-label': 'Remove ' + st.name, onclick: () => { draft.splice(i, 1); touch(); } }, '✕')) : '';
      // One card per stage: name and type on top; sign-off, checklist and limit underneath.
      const bit = (label, ctl) => el('label.wf-bit', {}, el('span.wf-bit-l', {}, label), ctl);
      return el('div.wf-stage' + (last ? '.wf-last' : ''), { dataset: { stage: st.id }, style: { '--wf': st.color } },
        el('div.wf-top', {}, el('span.wf-num', {}, String(i + 1)), el('span.wf-dot', { style: { background: st.color } }), name, color, kind,
          el('span.wf-open.hint', {}, counts[st.id] ? counts[st.id] + ' open' : ''), acts),
        last ? '' : el('div.wf-more', {}, bit('To move on', so), el('div.wf-bit', {}, el('span.wf-bit-l', {}, 'Checklist'), cl), bit('Limit', limit)));
    });
    const head = el('div.wf-head', { 'aria-hidden': 'true' }, el('span'), el('span'), el('span', {}, 'Stage'), el('span', {}, 'Colour'), el('span', {}, 'Counts as'), el('span', {}, 'To move on'), el('span', {}, 'Checklist'), el('span', {}, 'Limit'), el('span'), el('span'));
    box.replaceChildren(el('div.wf-list', {}, head, ...rows),
      editable && draft.length < MAX_STAGES ? el('button.btn.small', { type: 'button', id: 'wf-add', onclick: () => { const name = 'New stage'; draft.splice(draft.length - 1, 0, { id: newId(name + draft.length), name, kind: 'doing', color: STAGE_COLORS[draft.length % STAGE_COLORS.length], limit: 0 }); touch(); setTimeout(() => { const ins = box.querySelectorAll('.wf-name'); const n = ins[ins.length - 2]; if (n) { n.focus(); n.select(); } }, 30); } }, '+ Add a stage') : '');
  }
  const tpl = el('div.wf-templates', { role: 'group', 'aria-label': 'Start from a template' }, WORKFLOW_TEMPLATES.map(t => el('button.btn.small' + (JSON.stringify(t.stages.map(x => x.id)) === JSON.stringify(wf.stages.map(x => x.id)) ? '.primary' : '.ghost'), { type: 'button', dataset: { template: t.id }, disabled: !editable, title: t.help,
    onclick: () => { draft = JSON.parse(JSON.stringify(t.stages)); tpl.querySelectorAll('button').forEach(b => b.className = 'btn small ' + (b.dataset.template === t.id ? 'primary' : 'ghost')); touch(); } }, el('b', {}, t.name), el('span.hint', {}, ' ' + t.help))));
  build();
  pane.append(el('section', {}, el('h4', {}, 'Stages'),
    el('p.hint', {}, 'The steps every task goes through, on cards and as Kanban columns. Each stage counts as To do or Doing, so analytics, reports and the weekly share keep working; the last one is always Done. Set a limit to warn when too many tasks pile up in a stage. A stage can need a sign-off before tasks move on from it (the sub-team lead, an admin, or a named person; the team owner can always sign off), and can have a checklist that is ticked on each task.'),
    tpl, box, note,
    editable ? el('div.row', { style: { marginTop: '12px' } }, el('span.spacer'), saveBtn) : el('p.hint', {}, 'Only roles that can change team settings can edit the workflow.')));
  pane.append(purchaseSection(ctx, { rerender }), autosSection(ctx, wf.stages, { rerender }));
}

// Workflow step 3: purchase approvals.
function purchaseSection(ctx, { rerender } = {}) {
  const s = ctx.session, T = s.team; const editable = can(T, s.me, 'team.settings') || can(T, s.me, 'finance.edit');
  const pc = cleanPurchase(T.purchase); const v = { ...pc };
  const btn = el('button.btn.small.primary', { type: 'button', id: 'pa-save', disabled: true, onclick: async () => {
    if (await save(ctx, [{ type: 'update', path: 'team', data: { purchase: cleanPurchase(v) } }], v.on ? 'Purchase approvals on.' : 'Purchase approvals off.')) { if (rerender) rerender(); }
  } }, 'Save');
  const touch = () => { btn.disabled = false; };
  return el('section.wf-extra', { id: 'pa-settings' }, el('h4', {}, 'Purchase approvals'),
    el('p.hint', {}, 'Parts over a limit can’t be marked Ordered until someone who manages finances (or the team owner) approves them. Approved spending counts against its budget line straight away. Nobody approves their own request.'),
    el('div.row', {},
      el('label.chk', {}, el('input', { type: 'checkbox', id: 'pa-on', checked: pc.on, disabled: !editable, onchange: (e) => { v.on = e.target.checked; touch(); } }), 'Orders need approving when they cost more than'),
      el('input', { type: 'number', id: 'pa-over', min: 0, step: '1', value: pc.over, disabled: !editable, 'aria-label': 'Approval limit', oninput: (e) => { v.over = Number(e.target.value) || 0; touch(); } }),
      el('span.hint', {}, '(0 = every order)'), el('span.spacer'), editable ? btn : ''),
    editable ? '' : el('p.hint', {}, 'Only roles that manage finances or team settings change this.'));
}
// Workflow step 4: automatic steps, each switched on separately.
function autosSection(ctx, stages, { rerender } = {}) {
  const s = ctx.session, T = s.team; const editable = can(T, s.me, 'team.settings');
  const a = cleanAutos(T.autos); const v = { ...a };
  const btn = el('button.btn.small.primary', { type: 'button', id: 'auto-save', disabled: true, onclick: async () => {
    if (await save(ctx, [{ type: 'update', path: 'team', data: { autos: cleanAutos(v) } }], 'Automatic steps saved.')) { if (rerender) rerender(); }
  } }, 'Save');
  const touch = () => { btn.disabled = false; };
  const targets = stages.slice(1, -1);
  return el('section.wf-extra', { id: 'auto-settings' }, el('h4', {}, 'Automatic steps'),
    el('p.hint', {}, 'Small jobs Trawpie does for you. Each one is done by the app of someone who can make that change, and shows in the task’s history.'),
    el('div.row', {},
      el('label.chk', {}, el('input', { type: 'checkbox', id: 'auto-parts', checked: !!a.partsTo, disabled: !editable || !targets.length, onchange: (e) => { v.partsTo = e.target.checked ? (v.partsTo || (targets.find(x => x.id === 'build') || targets[0] || {}).id || '') : ''; const sel = document.getElementById('auto-parts-to'); if (sel && v.partsTo) sel.value = v.partsTo; touch(); } }),
        'When all the parts a task needs are received, move it to'),
      el('select', { id: 'auto-parts-to', disabled: !editable || !targets.length, 'aria-label': 'Stage to move to', onchange: (e) => { if ((document.getElementById('auto-parts') || {}).checked) v.partsTo = e.target.value; touch(); } },
        targets.map(x => el('option', { value: x.id, selected: (a.partsTo || 'build') === x.id }, x.name)))),
    el('p.hint', { style: { margin: '2px 0 10px 26px' } }, targets.length ? 'Not past a sign-off that hasn’t been given yet.' : 'Add a stage between the first and Done to use this.'),
    el('div.row', {}, el('label.chk', {}, el('input', { type: 'checkbox', id: 'auto-tell', checked: a.tellWaiting, disabled: !editable, onchange: (e) => { v.tellWaiting = e.target.checked; touch(); } }),
      'When a task is done, tell everyone whose tasks were waiting on it (a comment that @mentions them)')),
    el('div.row', { style: { marginTop: '10px' } }, el('label.chk', {}, el('input', { type: 'checkbox', id: 'auto-remind', checked: a.remindDays > 0, disabled: !editable, onchange: (e) => { v.remindDays = e.target.checked ? (Number((document.getElementById('auto-remind-days') || {}).value) || 3) : 0; touch(); } }),
      'Remind the sign-off person when a task has waited more than'),
      el('input', { type: 'number', id: 'auto-remind-days', min: 1, max: 60, value: a.remindDays || 3, disabled: !editable, 'aria-label': 'Days', oninput: (e) => { const n = Math.max(1, Math.min(60, Math.round(Number(e.target.value) || 1))); const box = document.getElementById('auto-remind'); if (box && box.checked) v.remindDays = n; touch(); } }), el('span.hint', {}, 'days')),
    el('div.row', { style: { marginTop: '10px' } }, el('label.chk', {}, el('input', { type: 'checkbox', id: 'auto-carry', checked: a.carry, disabled: !editable, onchange: (e) => { v.carry = e.target.checked; touch(); } }),
      'At the start of each week, carry any unfinished tasks from past weeks into the current week')),
    el('p.hint', { style: { margin: '2px 0 6px 26px' } }, 'A linked copy that keeps its history, like the manual “Carry forward”. Only tasks each person can edit are carried.'),
    el('div.row', { style: { marginLeft: '26px' } }, el('label.chk', {}, el('input', { type: 'checkbox', id: 'auto-carry-weeks', checked: a.carryMakeWeeks, disabled: !editable, onchange: (e) => { v.carryMakeWeeks = e.target.checked; touch(); } }),
      'Add the new week automatically if it doesn’t exist yet')),
    el('div.row', { style: { marginLeft: '26px', marginTop: '6px' } }, el('label.chk', {}, 'Flag a task once it has carried over more than'),
      el('input', { type: 'number', id: 'auto-carry-warn', min: 0, max: 10, value: a.carryWarn || 0, disabled: !editable, 'aria-label': 'Weeks before flagging', oninput: (e) => { v.carryWarn = Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0))); touch(); } }), el('span.hint', {}, 'weeks (0 = never)')),
    editable ? el('div.row', { style: { marginTop: '12px' } }, el('span.spacer'), btn) : el('p.hint', {}, 'Only roles that can change team settings change these.'));
}

function subteams(pane, ctx, { rerender } = {}) {
  const s = ctx.session, T = s.team; const editable = can(T, s.me, 'team.settings') || can(T, s.me, 'members.manage');
  const people = s.members.slice().sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  let draft = JSON.parse(JSON.stringify(T.subteams || []));
  const listBox = el('div.st-edit-list');
  const saveBtn = el('button.btn.primary', { type: 'button', id: 'st-save', disabled: true, onclick: async () => {
    const live = new Set(ctx.session.members.map(m => m.uid));
    const cleaned = cleanSubteams(draft.map((x, i) => ({ ...x, name: (x.name || '').trim() || 'Sub-team ' + (i + 1), members: x.members.filter(u => live.has(u)) })));
    const names = cleaned.map(x => x.name.toLowerCase()); const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) return toast('Two sub-teams are called “' + cleaned[names.indexOf(dup)].name + '”. Give each a different name.', 5000);
    if (await save(ctx, [{ type: 'update', path: 'team', data: { subteams: cleaned, leads: leadsIndex(cleaned) } }], 'Sub-teams saved.')) { if (rerender) rerender(); }
  } }, 'Save sub-teams');
  const touch = () => { saveBtn.disabled = false; };
  const add = (name) => {
    if (draft.length >= SUBTEAM_LIMIT) return toast('Up to ' + SUBTEAM_LIMIT + ' sub-teams.');
    if (name && draft.some(x => x.name.toLowerCase() === name.toLowerCase())) return;
    draft.push({ id: newId('st'), name, color: SUBTEAM_COLORS[draft.length % SUBTEAM_COLORS.length], members: [], leads: [] }); touch(); build();
    setTimeout(() => { const n = listBox.querySelectorAll('.st-name'); const last = n[n.length - 1]; if (last && !name) last.focus(); }, 30);
  };
  function build() {
    listBox.replaceChildren();
    if (!draft.length) listBox.append(el('p.hint', {}, 'No sub-teams yet.'));
    draft.forEach((st, i) => {
      const memberRow = (m) => {
        const inIt = st.members.includes(m.uid), lead = st.leads.includes(m.uid);
        return el('div.st-member' + (inIt ? '.on' : ''), {},
          el('label.row', {}, el('input', { type: 'checkbox', checked: inIt, disabled: !editable, 'aria-label': (m.name || m.email) + ' in ' + st.name,
            onchange: (e) => { st.members = e.target.checked ? st.members.concat(m.uid) : st.members.filter(u => u !== m.uid); if (!e.target.checked) st.leads = st.leads.filter(u => u !== m.uid); touch(); build(); } }),
            avatar(m), el('span', {}, m.name || m.email)),
          inIt ? el('button.st-lead' + (lead ? '.on' : ''), { type: 'button', disabled: !editable, 'aria-pressed': String(lead), title: lead ? 'Lead — click to remove' : 'Make lead', onclick: () => { st.leads = lead ? st.leads.filter(u => u !== m.uid) : st.leads.concat(m.uid); touch(); build(); } }, lead ? '★ Lead' : '☆ Lead') : '');
      };
      listBox.append(el('div.st-edit', { style: { '--st': st.color } },
        el('div.st-edit-top', {},
          el('input.st-color', { type: 'color', value: st.color, disabled: !editable, 'aria-label': 'Colour', oninput: (e) => { st.color = e.target.value; e.target.closest('.st-edit').style.setProperty('--st', st.color); touch(); } }),
          el('input.inp.st-name', { value: st.name, maxlength: 40, disabled: !editable, placeholder: 'Sub-team name', 'aria-label': 'Sub-team name', oninput: (e) => { st.name = e.target.value; touch(); } }),
          el('span.hint', {}, st.members.length + (st.members.length === 1 ? ' person' : ' people')),
          editable ? el('button.btn.small.danger', { type: 'button', onclick: () => { if (st.members.length && !confirm('Delete the sub-team “' + st.name + '”? Its people stay in the project; parts and budget lines that belonged to it will have no sub-team.')) return; draft.splice(i, 1); touch(); build(); } }, 'Delete') : ''),
        el('div.st-members', {}, people.map(memberRow))));
    });
  }
  build();
  pane.append(el('section', {}, el('h4', {}, 'Sub-teams'),
    el('p.hint', {}, 'Split the project into groups of people — for example Fuselage, Payload, Landing gear and Electronics. Someone can be in more than one. Each sub-team gets its own view of the board (the strip above it), its own progress in Analytics, and can own parts and budget lines. Leads are marked ★.'),
    editable ? '' : readOnlyNote('View only — managing sub-teams needs “Team settings” or “Manage members”.'), listBox,
    editable ? el('div.row.st-add', { style: { marginTop: '10px', flexWrap: 'wrap', gap: '6px' } },
      el('button.btn', { type: 'button', id: 'st-add', onclick: () => add('') }, '➕ Add sub-team'),
      ...SUBTEAM_IDEAS.filter(n => !draft.some(x => x.name.toLowerCase() === n.toLowerCase())).slice(0, 5).map(n => el('button.btn.small.ghost', { type: 'button', onclick: () => add(n) }, '＋ ' + n))) : ''));
  if (editable) pane.append(el('div.row', { style: { marginTop: '18px' } }, el('span.spacer'), saveBtn));
}

// ── General ─────────────────────────────────────────────────────────────────
function general(pane, ctx, { rerender } = {}) {
  const T = ctx.session.team; const editable = can(T, ctx.session.me, 'team.settings');
  const name = el('input', { value: T.name, maxlength: 80, disabled: !editable });
  const logoBox = el('div.logo-drop', {}, teamLogo(T));
  const logoBtns = el('div.row');
  if (editable) {
    logoBtns.append(el('button.btn.small', { type: 'button', onclick: async () => {
      const f = await pickFile('image/png,image/jpeg,image/webp,image/gif,image/svg+xml'); if (!f) return;
      try { const d = await imageFileToDataUrl(f, 256, LIMITS.logoBytes); await save(ctx, [{ type: 'update', path: 'team', data: { logo: d } }], 'Logo updated.'); }
      catch (e) { toast(e.message, 5000); }
    } }, 'Upload logo…'));
    if (T.logo) logoBtns.append(el('button.btn.small.ghost', { type: 'button', onclick: () => save(ctx, [{ type: 'update', path: 'team', data: { logo: '' } }], 'Logo removed.') }, 'Remove'));
  }
  logoBox.append(el('div', {}, el('div.hint', {}, 'Shown on the board and the team list. PNG, JPG, WebP, GIF or SVG — it’s resized automatically.'), logoBtns));
  pane.append(
    el('section', {}, el('h4', {}, 'Team'), editable ? '' : readOnlyNote(),
      el('label.field', {}, el('span', {}, 'Team name'), name),
      editable ? el('button.btn.primary', { type: 'button', onclick: () => { const v = name.value.trim(); if (!v) return toast('Enter a team name.'); save(ctx, [{ type: 'update', path: 'team', data: { name: v.slice(0, 80) } }], 'Team renamed.'); } }, 'Save name') : ''),
    el('section', {}, el('h4', {}, 'Logo'), logoBox),
    weekNamingSection(ctx, editable, rerender),
    currencySection(ctx),
    lookSection(ctx),
    el('section', {}, el('h4', {}, 'Your role'), el('p.hint', {}, 'You are ', el('b', {}, ctx.TT.roleName(ctx.session.me.roleId)), ' in this team. ',
      ...PERMISSIONS.filter(p => can(T, ctx.session.me, p.key)).length ? ['You can: ', PERMISSIONS.filter(p => can(T, ctx.session.me, p.key)).map(p => p.label.toLowerCase()).join(', '), '.'] : ['You can view the board.']),
      leaveBox(ctx)),
  );
}

/** The team's look: Friendly (emoji) or Professional (clean line icons, no emoji), for the whole team. */
function lookSection(ctx) {
  const s = ctx.session, T = s.team; const editable = can(T, s.me, 'team.settings');
  const cur = T.look === 'professional' ? 'professional' : 'friendly';
  const opt = (key, title, text) => el('label.look-opt' + (key === cur ? '.on' : ''), {},
    el('input', { type: 'radio', name: 'team-look', value: key, checked: key === cur, disabled: !editable, onchange: async () => {
      await save(ctx, [{ type: 'update', path: 'team', data: { look: key } }], key === 'professional' ? 'Professional look on for everyone in the team.' : 'Friendly look on for everyone in the team.');
    } }), el('span', {}, el('b', {}, title), el('span.hint', {}, text)));
  return el('section', {}, el('h4', {}, 'Look'),
    el('p.hint', {}, 'How the app looks for everyone in this team. Nothing anyone wrote changes.'),
    el('div.look-opts', {}, opt('friendly', 'Friendly', 'Emoji on buttons, badges and tasks. Good for student and community teams.'),
      opt('professional', 'Professional', 'Clean line icons and no emoji. Suited to companies and clients.')),
    editable ? '' : el('p.hint', {}, 'Only roles that change team settings choose this.'));
}
/** The team's currency: parts, purchases, budget and reports all use it. */
function currencySection(ctx) {
  const s = ctx.session, T = s.team; const editable = can(T, s.me, 'team.settings') || can(T, s.me, 'finance.edit');
  const cur = currencyOf(T, s.budget);
  const sel = el('select', { id: 'team-currency', disabled: !editable, 'aria-label': 'Currency', onchange: async (e) => {
    const c = e.target.value; const ops = [{ type: 'update', path: 'team', data: { currency: c } }];
    if (s.budget && s.budget.currency !== c && can(T, s.me, 'finance.edit')) ops.push({ type: 'set', path: 'finance/budget', data: { ...cleanBudget({ ...s.budget, currency: c }), updatedAt: Date.now() } });
    await save(ctx, ops, 'Prices now show in ' + (CURRENCY_NAMES[c] || c) + '.');
  } }, CURRENCIES.map(c => el('option', { value: c, selected: c === cur }, CURRENCY_NAMES[c] || c)));
  return el('section', {}, el('h4', {}, 'Currency'),
    el('p.hint', {}, 'The money this project works in: part prices, purchase approvals, the budget and reports. It only changes the symbol, not the amounts.'),
    el('label.field', { style: { maxWidth: '320px' } }, el('span', {}, 'Currency'), sel),
    editable ? '' : el('p.hint', {}, 'Only roles that manage finances or team settings change this.'));
}
/** How new weeks are named: own numbering (WEEK 1, 2, 3…) or calendar week numbers. */
function weekNamingSection(ctx, editable, rerender = () => {}) {
  const T = ctx.session.team; const mode = T.weekNaming || 'sequence';
  const canWeeks = can(T, ctx.session.me, 'weeks.manage');
  const option = (value, title, help) => el('label.radio-card' + (mode === value ? '.on' : ''), {},
    el('input', { type: 'radio', name: 'week-naming', value, checked: mode === value, disabled: !editable,
      onchange: async () => { await save(ctx, [{ type: 'update', path: 'team', data: { weekNaming: value } }], value === 'calendar' ? 'New weeks will use calendar week numbers.' : 'New weeks will be numbered WEEK 1, 2, 3…'); rerender(); } }),
    el('span', {}, el('b', {}, title), el('br'), el('span.hint', {}, help)));
  const sec = el('section', {}, el('h4', {}, 'Week numbering'),
    el('div.radio-cards', {},
      option('sequence', 'Own numbering', 'WEEK 1, WEEK 2, WEEK 3… counted from your first week.'),
      option('calendar', 'Calendar weeks', 'The week number of the year, e.g. WEEK 42 for the week of 12 October.')),
    el('p.hint', {}, 'New weeks follow this choice. You can still rename any week by clicking its name or right-clicking it.'));
  if (canWeeks && (T.weeks || []).length) {
    const after = renumberWeeks(mode, T.weeks);
    const changes = after.filter((w, i) => w.title !== T.weeks[i].title).length;
    sec.append(el('button.btn.small', { type: 'button', disabled: !changes, title: changes ? '' : 'Every week already matches',
      onclick: () => {
        if (!confirm(`Rename ${changes} week${changes === 1 ? '' : 's'} to match "${mode === 'calendar' ? 'Calendar weeks' : 'Own numbering'}"?\n\nFirst: ${after[0].title}   Last: ${after[after.length - 1].title}`)) return;
        save(ctx, [{ type: 'update', path: 'team', data: { weeks: after } }], 'Weeks renamed.').then(() => rerender());
      } }, changes ? `Rename existing weeks to match (${changes})` : 'Existing weeks already match'));
  }
  return sec;
}

// ── Members & invitations ───────────────────────────────────────────────────
let lastInviteNotice = null; // kept across re-renders so the confirmation stays visible
function members(pane, ctx, { invites, getInvites, focusUid, rerender }) {
  const pending = () => (getInvites ? getInvites() : invites) || [];
  const s = ctx.session, T = s.team, me = s.me;
  const manage = can(T, me, 'members.manage');
  const roles = roleList(T).filter(r => r.id !== 'owner');
  // Teams made before guests existed don't have the Guest role yet: offer it, and add it on the first guest invite.
  const guestMissing = !(T.roles && T.roles.guest);
  const inviteRoles = guestMissing ? roles.concat([{ id: 'guest', name: 'Guest', missing: true }]) : roles;
  const roleSelect = (value, onchange, list = roles) => {
    const sel = el('select', { 'aria-label': 'Role' }); list.forEach(r => sel.append(el('option', { value: r.id, selected: r.id === value }, r.name + (r.id === 'guest' ? ' (from outside the team)' : ''))));
    if (onchange) sel.addEventListener('change', () => onchange(sel.value)); return sel;
  };

  if (manage) {
    const emails = el('textarea', { rows: 3, placeholder: 'name@uni.ac.uk, another@gmail.com', style: { resize: 'vertical' } });
    const role = roleSelect('member', null, inviteRoles); role.id = 'invite-role';
    const guestNote = el('p.hint.guest-note', { hidden: true }, GUEST_HELP);
    role.addEventListener('change', () => { guestNote.hidden = role.value !== 'guest'; });
    const result = el('div');
    if (lastInviteNotice && lastInviteNotice.teamId === s.teamId && Date.now() - lastInviteNotice.at < 120000) result.append(lastInviteNotice.node);
    const form = el('form', {}, el('label.field', {}, el('span', {}, 'Email addresses (separate with commas or new lines)'), emails),
      el('div.row', {}, el('label.field', { style: { margin: 0 } }, el('span', {}, 'Role'), role), el('span.spacer'), el('button.btn.primary', { type: 'submit' }, SERVER_EMAILS ? 'Invite & email' : 'Invite')), guestNote, result);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const list = [...new Set(emails.value.split(/[\s,;]+/).map(normEmail).filter(Boolean))];
      const bad = list.filter(x => !isValidEmail(x));
      if (!list.length) return toast('Enter at least one email address.');
      if (bad.length) return toast('Check these addresses: ' + bad.join(', '), 6000);
      const already = list.filter(x => s.members.some(mm => mm.email === x));
      const todo = list.filter(x => !already.includes(x));
      if (!todo.length) return toast('Everyone listed is already in the team.');
      const room = memberRoom(T, s.members.length, pending().filter(i => !todo.includes(i.email)).length);
      if (todo.length > room.left) return toast(room.left ? 'The ' + planOf(T).label + ' plan has room for ' + room.left + ' more ' + (room.left === 1 ? 'person' : 'people') + ' (members and pending invitations count). See Settings ▸ Plan.' : 'The team is full on the ' + planOf(T).label + ' plan (' + room.limit + ' members, counting pending invitations). See Settings ▸ Plan to move to Pro.', 7000);
      if (role.value === 'guest' && guestMissing) {
        if (!can(T, me, 'roles.manage')) return toast('Guests need the Guest role, which the team owner adds. Ask the owner to send the first guest invitation.', 7000);
        if (!(await save(ctx, [{ type: 'update', path: 'team', data: { roles: { ...T.roles, guest: { ...DEFAULT_ROLES.guest } } } }]))) return;
      }
      const ops = todo.map(x => ({ type: 'set', path: 'invites/' + x, data: { email: x, roleId: role.value, teamName: T.name, invitedBy: ctx.user.uid, invitedByName: ctx.user.name, createdAt: Date.now() } }));
      if (!(await save(ctx, ops))) return;
      emails.value = '';
      const notice = SERVER_EMAILS
        ? el('div.banner.info', { style: { marginTop: '12px' } }, el('b', {}, '📧 Invitation emailed to ' + todo.join(', ') + '. '), 'They sign in with that address and press “Join team”. You can see delivery under Pending invitations.',
            el('details', { style: { marginTop: '8px' } }, el('summary', {}, 'Send it yourself as well'), shareBox(ctx, todo, T.name, role.value)))
        : shareBox(ctx, todo, T.name, role.value);
      lastInviteNotice = { teamId: s.teamId, node: notice, at: Date.now() };
      startFlag(s.teamId, ctx.user.uid, 'invited');
      result.replaceChildren(notice);
      if (already.length) toast('Skipped (already members): ' + already.join(', '), 6000);
    });
    const room = memberRoom(T, s.members.length, pending().length);
    const roomText = (r) => (r.full ? '⚠ Team is full: ' : '') + r.used + ' of ' + r.limit + ' places used on the ' + planOf(T).label + ' plan (members and pending invitations).';
    pane.append(el('section', {}, el('h4', {}, 'Invite people'),
      el('p.hint', {}, SERVER_EMAILS
        ? 'We email each person an invitation for you — nothing to send yourself. They sign in with that exact address and press “Join team”. Invitations never expire until you revoke them.'
        : 'Each person signs in with that exact email address and accepts the invitation on their team list. Invitations never expire until you revoke them.'),
      room.limit ? el('p.hint.plan-room' + (room.full ? '.full' : ''), { id: 'plan-room', onrefresh: (e) => { const r = memberRoom(T, s.members.length, pending().length); e.target.textContent = roomText(r); e.target.classList.toggle('full', r.full); } }, roomText(room)) : '', form));
  }

  // Members table
  const table = el('table.tbl', {}, el('tr', {}, el('th', {}, 'Member'), el('th', {}, 'Role'), el('th', {}, '')));
  [...s.members].sort((a, b) => (a.roleId === 'owner' ? -1 : b.roleId === 'owner' ? 1 : a.name.localeCompare(b.name))).forEach(mm => {
    const isMe = mm.uid === ctx.user.uid;
    let roleCell;
    if (manage && mm.roleId !== 'owner' && !isMe) {
      roleCell = roleSelect(mm.roleId, (v) => save(ctx, [{ type: 'update', path: 'members/' + mm.uid, data: { roleId: v } }], (mm.name || mm.email) + ' is now ' + ctx.TT.roleName(v) + '.'));
      if (focusUid === mm.uid) setTimeout(() => roleCell.focus(), 50);
    } else roleCell = el('span.pill' + (mm.roleId === 'owner' ? '.blue' : ''), {}, ctx.TT.roleName(mm.roleId));
    const actions = el('td', { style: { textAlign: 'right' } });
    if (isMe && mm.roleId !== 'owner') actions.append(el('button.btn.small.danger', { type: 'button', onclick: () => leaveTeam(ctx) }, 'Leave team'));
    else if (manage && mm.roleId !== 'owner' && !isMe) actions.append(el('button.btn.small.danger', { type: 'button', onclick: () => removeMember(ctx, mm.uid) }, 'Remove'));
    if (s.me.roleId === 'owner' && !isMe) actions.prepend(el('button.btn.small.ghost.make-owner', { type: 'button', onclick: () => makeOwner(ctx, mm) }, 'Make owner'), ' ');
    table.append(el('tr', {}, el('td', {}, el('div.row', {}, avatar(mm), el('div', {}, el('b', {}, mm.name || mm.email, isMe ? ' (you)' : ''), el('div.hint', {}, mm.email)))), el('td', {}, roleCell), actions));
  });
  pane.append(el('section', {}, el('h4', {}, `Members (${s.members.length})`), table));

  if (manage) {
    const sec = el('section', {}, el('h4', {}, `Pending invitations (${invites.length})`));
    if (!invites.length) sec.append(el('p.hint', {}, 'No pending invitations.'));
    else {
      const t = el('table.tbl', {}, el('tr', {}, el('th', {}, 'Email'), el('th', {}, 'Role'), el('th', {}, 'Invited by'), SERVER_EMAILS ? el('th', {}, 'Email') : '', el('th', {}, '')));
      const delivery = (inv) => inv.emailedAt ? el('td.hint.inv-sent', { title: new Date(inv.emailedAt).toLocaleString() }, '✓ Emailed') : inv.emailError ? el('td.inv-failed', { title: inv.emailError }, '⚠ Not sent') : el('td.hint', {}, 'Sending…');
      invites.sort((a, b) => b.createdAt - a.createdAt).forEach(inv => {
        t.append(el('tr', {}, el('td', {}, inv.email), el('td', {}, ctx.TT.roleName(inv.roleId)), el('td.hint', {}, inv.invitedByName || ''), SERVER_EMAILS ? delivery(inv) : '',
          el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
            SERVER_EMAILS ? el('button.btn.small.ghost.inv-resend', { type: 'button', title: 'Email the invitation again', onclick: async () => { const { emailedAt, emailError, ...rest } = inv; if (await save(ctx, [{ type: 'set', path: 'invites/' + inv.email, data: { ...rest, createdAt: Date.now() } }], 'Invitation emailed again to ' + inv.email + '.')) rerender(); } }, 'Resend') : '',
            el('button.btn.small.ghost', { type: 'button', onclick: () => { const box = shareBox(ctx, [inv.email], T.name, inv.roleId); const mm = modal('Let them know', { narrow: true }); mm.body.append(box); mm.foot.append(el('button.btn', { type: 'button', onclick: mm.close }, 'Done')); } }, SERVER_EMAILS ? 'Copy link' : 'Share'),
            el('button.btn.small.danger', { type: 'button', onclick: async () => { if (confirm('Revoke the invitation for ' + inv.email + '?')) await save(ctx, [{ type: 'delete', path: 'invites/' + inv.email }], 'Invitation revoked.'); rerender(); } }, 'Revoke'))));
      });
      sec.append(t);
    }
    pane.append(sec);
  }
}

/** "Let them know" box: invite message to copy, mailto link, and (only when sign-in links are enabled) a Firebase sign-in-link email. */
function shareBox(ctx, emails, teamName, roleId) {
  const link = location.origin + location.pathname;
  const msg = `Hi! I've invited you to "${teamName}" on ${APP_NAME} as ${ctx.TT.roleName(roleId)}.\n\n1. Open ${link}\n2. Sign in, or create an account, with this email address\n3. Verify your email if asked, then click "Join team" under Invitations\n\nSee you there,\n${ctx.user.name}`;
  const ta = el('textarea.inp', { rows: 7, readonly: true }); ta.value = msg;
  const box = el('div.banner.info', { style: { marginTop: '12px' } },
    el('b', {}, 'Invitation saved for ' + emails.join(', ') + '. '), 'Now let them know — send this message any way you like:', ta);
  // Every email option opens in a NEW tab, so this page (and the invite dialog) stays open behind it.
  const subject = 'Join ' + teamName + ' on ' + APP_NAME;
  const to = emails.join(',');
  const q = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const newTab = { target: '_blank', rel: 'noopener noreferrer' };
  const row = el('div.row', { style: { marginTop: '8px', flexWrap: 'wrap' } },
    el('button.btn.small', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(msg); toast('Message copied.'); } catch { ta.select(); document.execCommand('copy'); toast('Message copied.'); } } }, 'Copy message'),
    el('a.btn.small', { href: 'https://mail.google.com/mail/?' + q({ view: 'cm', fs: '1', to, su: subject, body: msg }), ...newTab, title: 'Opens a new Gmail message in a new tab' }, 'Gmail'),
    el('a.btn.small', { href: 'https://outlook.office.com/mail/deeplink/compose?' + q({ to, subject, body: msg }), ...newTab, title: 'Opens a new Outlook (Microsoft 365) message in a new tab' }, 'Outlook'),
    el('a.btn.small', { href: 'mailto:' + emails.map(encodeURIComponent).join(',') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(msg), ...newTab, title: 'Uses your computer’s default email app' }, 'Other email app'));
  box.append(el('div.hint', { style: { marginTop: '8px' } }, 'Email opens in a new tab, so this page stays open. Close that tab to come back here.'));
  if (ctx.backend.auth.sendInviteEmail) {
    row.append(el('button.btn.small', { type: 'button', onclick: async (e) => {
      e.target.disabled = true;
      try { for (const x of emails) await ctx.backend.auth.sendInviteEmail(x); toast('Sign-in link emailed to ' + emails.join(', ') + '.'); }
      catch (err) { e.target.disabled = false; toast(friendlyError(err), 6000); }
    } }, 'Email them a sign-in link'));
  }
  if (DEMO_MODE) box.append(el('div.hint', { style: { marginTop: '8px' } }, 'Demo tip: open this site in a second tab and sign in as ' + emails[0] + ' to accept.'));
  box.append(row);
  return box;
}

export async function removeMember(ctx, uid) {
  const s = ctx.session; const mm = s && s.members.find(x => x.uid === uid); if (!mm) return;
  if (!can(s.team, s.me, 'members.manage')) return toast('Your role can’t remove members.');
  if (mm.roleId === 'owner') return toast('The owner can’t be removed.');
  if (!confirm(`Remove ${mm.name || mm.email} from ${s.team.name}?\n\nTheir tasks stay on the board under “Former member” until someone moves or deletes them. You can invite them again later.`)) return;
  await save(ctx, [{ type: 'delete', path: 'members/' + uid }], (mm.name || mm.email) + ' was removed.');
}

async function makeOwner(ctx, mm) {
  const s = ctx.session; const who = mm.name || mm.email;
  if (!confirm(`Make ${who} the owner of ${s.team.name}?\n\nThey’ll have full control, including deleting the team. You’ll become an Admin. Only they can hand it back.`)) return;
  try { await ctx.backend.data.callFunction('transferOwnership', { teamId: s.teamId, toUid: mm.uid }); toast(who + ' is now the owner. You’re an Admin.', 5000); document.querySelector('.modal-overlay')?.remove(); }
  catch (e) { toast(String((e && e.message) || e), 6000); }
}

/** Leaving: member managers leave straight away; everyone else asks (requests.js). */
function leaveBox(ctx) {
  const s = ctx.session; if (s.me.roleId === 'owner') return '';
  const asked = leaveOf(s, ctx.user.uid);
  if (asked) return el('div.banner.leave-pending', { id: 'leave-pending' }, el('span', {}, '⏳ You asked to leave ', timeAgo(asked.at), '. The owner or an admin will approve it.'), el('span.spacer'), el('button.btn.small', { type: 'button', onclick: () => cancelLeave(ctx) }, 'Withdraw'));
  return el('div.row', { style: { marginTop: '10px' } }, el('button.btn.small.danger', { type: 'button', id: 'leave-team', onclick: () => leaveTeam(ctx) }, 'Leave team…'));
}
async function leaveTeam(ctx) {
  const s = ctx.session;
  if (!can(s.team, s.me, 'members.manage')) { askToLeave(ctx); return; }
  if (!confirm(`Leave ${s.team.name}? You’ll lose access until someone invites you again.`)) return;
  if (await save(ctx, [{ type: 'delete', path: 'members/' + ctx.user.uid }])) { document.querySelector('.modal-overlay')?.remove(); toast('You left ' + s.team.name + '.'); ctx.goHome(); }
}

// ── Roles & permissions ─────────────────────────────────────────────────────
function roles(pane, ctx) {
  const s = ctx.session, T = s.team; const editable = can(T, s.me, 'roles.manage');
  const draft = JSON.parse(JSON.stringify(T.roles));
  const usage = (rid) => s.members.filter(m => m.roleId === rid).length;
  const head = el('tr', {}, el('th', {}, 'Permission'));
  const body = [];
  const list = () => Object.entries(draft).map(([id, r]) => ({ id, ...r })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  function build() {
    head.replaceChildren(el('th', {}, 'Permission'));
    list().forEach(r => {
      const nameIn = el('input.role-name', { value: r.name, maxlength: 40, disabled: !editable || r.id === 'owner', 'aria-label': 'Role name' });
      nameIn.addEventListener('change', () => { draft[r.id].name = nameIn.value.trim() || draft[r.id].name; });
      const th = el('th', {}, nameIn, el('div.hint', {}, usage(r.id) + (usage(r.id) === 1 ? ' member' : ' members')));
      if (editable && !r.builtin) th.append(el('button.btn.small.ghost', { type: 'button', onclick: () => {
        if (usage(r.id)) return toast('Move its members to another role first.');
        delete draft[r.id]; build();
      } }, 'Delete'));
      head.append(th);
    });
    body.forEach(n => n.remove()); body.length = 0;
    PERMISSIONS.forEach(p => {
      const tr = el('tr', {}, el('td', {}, el('b', {}, p.label), el('div.hint', {}, p.help)));
      list().forEach(r => {
        const cb = el('input', { type: 'checkbox', checked: r.id === 'owner' || !!r.perms[p.key], disabled: !editable || r.id === 'owner', 'aria-label': p.label + ' for ' + r.name });
        cb.addEventListener('change', () => { draft[r.id].perms[p.key] = cb.checked; });
        tr.append(el('td', {}, cb));
      });
      body.push(tr); table.append(tr);
    });
  }
  const table = el('table', {}, head);
  build();
  pane.append(el('section', {}, el('h4', {}, 'Roles & permissions'),
    el('p.hint', {}, 'Each member has one role. The owner can always do everything. Changes apply to everyone with that role as soon as you save.'),
    editable ? '' : readOnlyNote(), el('div.perm-grid', {}, table)));
  if (editable) {
    pane.append(el('div.row', { style: { marginTop: '14px' } },
      el('button.btn', { type: 'button', onclick: () => {
        if (Object.keys(draft).length >= LIMITS.rolesPerTeam) return toast('That’s the maximum number of roles.');
        const name = prompt('Name for the new role (e.g. Mentor, Lab lead):'); if (!name || !name.trim()) return;
        const id = newId('r'); draft[id] = { name: name.trim().slice(0, 40), builtin: false, order: 10 + Object.keys(draft).length, perms: { ...draft.member.perms } }; build();
      } }, '➕ Add role'),
      el('span.spacer'),
      el('button.btn.primary', { type: 'button', onclick: () => save(ctx, [{ type: 'update', path: 'team', data: { roles: draft } }], 'Roles saved.') }, 'Save roles')));
  }
}

// ── Custom fields ───────────────────────────────────────────────────────────
function fields(pane, ctx) {
  const s = ctx.session, T = s.team; const editable = can(T, s.me, 'team.settings');
  let draft = T.fields.map(f => ({ ...f, options: [...f.options] }));
  const labels = JSON.parse(JSON.stringify(T.labels));
  const listBox = el('div');
  function build() {
    listBox.replaceChildren();
    if (!draft.length) listBox.append(el('p.hint', {}, 'No custom fields yet. Add fields like “Budget (£)”, “Supervisor”, “Lab booked?”, “Module code” or “Report link”.'));
    draft.forEach((f, i) => {
      const name = el('input.inp', { value: f.name, maxlength: 60, disabled: !editable, 'aria-label': 'Field name' }); name.addEventListener('input', () => { f.name = name.value; });
      const type = el('select.inp', { disabled: !editable, 'aria-label': 'Field type' }); FIELD_TYPES.forEach(t => type.append(el('option', { value: t, selected: t === f.type }, FIELD_TYPE_LABEL[t])));
      type.addEventListener('change', () => { f.type = type.value; build(); });
      const opts = f.type === 'select' ? el('input.inp', { value: f.options.join(', '), placeholder: 'Options, comma separated', disabled: !editable, 'aria-label': 'Dropdown options' }) : el('span.hint', {}, f.type === 'person' ? 'Pick from team members' : '');
      if (f.type === 'select') opts.addEventListener('input', () => { f.options = opts.value.split(',').map(x => x.trim()).filter(Boolean); });
      const card = el('label.row', { style: { fontSize: '13px', whiteSpace: 'nowrap' } }, el('input', { type: 'checkbox', checked: f.showOnCard, disabled: !editable, onchange: (e) => { f.showOnCard = e.target.checked; } }), 'Show on card');
      const ctl = el('div.row', { style: { gap: '4px' } });
      if (editable) ctl.append(
        el('button.btn.small.ghost', { type: 'button', title: 'Move up', disabled: i === 0, onclick: () => { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; build(); } }, '↑'),
        el('button.btn.small.ghost', { type: 'button', title: 'Move down', disabled: i === draft.length - 1, onclick: () => { [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]]; build(); } }, '↓'),
        el('button.btn.small.danger', { type: 'button', onclick: () => { if (confirm('Delete the field “' + f.name + '”? Values stored in tasks are hidden and removed the next time each task is edited.')) { draft.splice(i, 1); build(); } } }, 'Delete'));
      listBox.append(el('div.field-row', {}, name, type, opts, card, ctl));
    });
  }
  build();
  const labelRows = Object.keys(DEFAULT_LABELS).map(k => {
    const inp = el('input.inp', { value: labels[k].label, maxlength: 40, disabled: !editable, 'aria-label': 'Label' }); inp.addEventListener('input', () => { labels[k].label = inp.value; });
    const show = el('input', { type: 'checkbox', checked: labels[k].show, disabled: !editable }); show.addEventListener('change', () => { labels[k].show = show.checked; });
    const what = { jiraId: 'Reference ID on tasks (ticket, document or module code)', status: 'Short status badge on task cards', metric: 'Small badge on each week header' }[k];
    return el('div.field-row', { style: { gridTemplateColumns: '1fr 1fr auto' } }, el('span', {}, el('b', {}, DEFAULT_LABELS[k].label), el('div.hint', {}, what)), inp, el('label.row', { style: { fontSize: '13px' } }, show, 'Show'));
  });
  pane.append(
    el('section', {}, el('h4', {}, 'Custom fields'), el('p.hint', {}, 'Extra details every task can have. They appear in the task editor, on cards (if you choose), in exports and in AI summaries.'),
      editable ? '' : readOnlyNote(), listBox,
      editable ? el('button.btn', { type: 'button', style: { marginTop: '10px' }, onclick: () => { if (draft.length >= LIMITS.fieldsPerTeam) return toast('That’s the maximum number of fields.'); draft.push({ id: newId('f'), name: 'New field', type: 'text', options: [], showOnCard: false }); build(); } }, '➕ Add field') : ''),
    el('section', {}, el('h4', {}, 'Built-in fields'), el('p.hint', {}, 'Rename or hide the standard fields to match how your team works.'), ...labelRows));
  if (editable) pane.append(el('div.row', { style: { marginTop: '18px' } }, el('span.spacer'), el('button.btn.primary', { type: 'button', onclick: () => {
    const cleaned = draft.map(f => cleanField({ ...f, name: (f.name || '').trim() || 'Field' }));
    if (cleaned.some(f => f.type === 'select' && !f.options.length)) return toast('Give every dropdown at least one option.');
    Object.keys(labels).forEach(k => { labels[k].label = (labels[k].label || '').trim() || DEFAULT_LABELS[k].label; });
    save(ctx, [{ type: 'update', path: 'team', data: { fields: cleaned, labels } }], 'Fields saved.');
  } }, 'Save fields')));
}

// ── Phases ──────────────────────────────────────────────────────────────────
/** Project phases (Research → Design → Build → Test…), each with dates and a milestone. */
function phases(pane, ctx, { rerender } = {}) {
  const s = ctx.session, T = s.team; const editable = can(T, s.me, 'team.settings');
  let draft = (T.phases || []).map(p => ({ ...p }));
  const listBox = el('div.phase-list');
  const countTasks = (id) => (s.tasks || []).filter(t => t.phaseId === id).length;
  const addPhase = (name) => {
    if (draft.length >= LIMITS.phasesPerTeam) { toast('That’s the maximum number of phases.'); return false; }
    const prev = draft[draft.length - 1];
    draft.push({ id: newId('ph'), name, color: PHASE_COLORS[draft.length % PHASE_COLORS.length], start: prev && prev.end ? prev.end : '', end: '', milestone: '' });
    return true;
  };
  function build() {
    listBox.replaceChildren();
    if (!draft.length) {
      listBox.append(el('p.hint', {}, 'No phases yet. Phases split the project into stages, for example Research → Design → Build → Test. Each task can then belong to a phase, and analytics shows progress per phase.'));
      if (editable) listBox.append(el('button.btn', { type: 'button', onclick: () => { PHASE_TEMPLATE.forEach(addPhase); build(); } }, '✨ Start with Research → Design → Build → Test'));
    }
    draft.forEach((p, i) => {
      const inp = (attrs, key) => { const n = el('input.inp', { ...attrs, value: p[key] || '', disabled: !editable }); n.addEventListener('input', () => { p[key] = n.value; }); return n; };
      const ctl = el('div.row', { style: { gap: '4px' } });
      if (editable) ctl.append(
        el('button.btn.small.ghost', { type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; build(); } }, '↑'),
        el('button.btn.small.ghost', { type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === draft.length - 1, onclick: () => { [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]]; build(); } }, '↓'),
        el('button.btn.small.danger', { type: 'button', onclick: () => {
          const n = countTasks(p.id);
          if (!confirm('Delete the phase “' + p.name + '”?' + (n ? `\n\n${n} task${n === 1 ? '' : 's'} in it will have no phase. The tasks themselves are kept.` : ''))) return;
          draft.splice(i, 1); build();
        } }, 'Delete'));
      const n = countTasks(p.id);
      listBox.append(el('div.phase-row', { style: { '--phase': p.color } },
        el('div.phase-row-top', {},
          el('input.phase-color', { type: 'color', value: p.color, disabled: !editable, 'aria-label': 'Phase colour', oninput: (e) => { p.color = e.target.value; e.target.closest('.phase-row').style.setProperty('--phase', p.color); } }),
          inp({ maxlength: 60, 'aria-label': 'Phase name', placeholder: 'Phase name' }, 'name'),
          el('span.hint.phase-count', {}, n ? n + (n === 1 ? ' task' : ' tasks') : ''), ctl),
        el('div.phase-row-dates', {},
          el('label.field', {}, el('span', {}, 'Starts'), inp({ type: 'date', 'aria-label': 'Start date' }, 'start')),
          el('label.field', {}, el('span', {}, 'Ends'), inp({ type: 'date', 'aria-label': 'End date' }, 'end')),
          el('label.field.phase-ms', {}, el('span', {}, 'Milestone at the end (optional)'), inp({ maxlength: 120, placeholder: 'e.g. Prototype demo to supervisor', 'aria-label': 'Milestone' }, 'milestone')))));
    });
  }
  build();
  pane.append(el('section', {}, el('h4', {}, 'Project phases'),
    el('p.hint', {}, 'Stages of the project, in order. Give each one dates to see it on the timeline and to know whether it is on time. Pick a task’s phase in the task editor or by right-clicking it.'),
    editable ? '' : readOnlyNote(), listBox,
    editable && draft.length ? el('button.btn', { type: 'button', style: { marginTop: '10px' }, onclick: () => { if (addPhase('New phase')) build(); } }, '➕ Add phase') : ''));
  if (editable) pane.append(el('div.row', { style: { marginTop: '18px' } }, el('span.spacer'), el('button.btn.primary', { type: 'button', onclick: async () => {
    const cleaned = draft.map((p, i) => cleanPhase({ ...p, name: (p.name || '').trim() || 'Phase ' + (i + 1) }, i));
    const bad = cleaned.find(p => p.start && p.end && p.end < p.start);
    if (bad) return toast('“' + bad.name + '” ends before it starts. Check its dates.', 5000);
    if (await save(ctx, [{ type: 'update', path: 'team', data: { phases: cleaned } }], 'Phases saved.') && rerender) rerender();
  } }, 'Save phases')));
}

// ── Templates ───────────────────────────────────────────────────────────────
function templates(pane, ctx) {
  const s = ctx.session, TT = ctx.TT; const list = s.templates || [];
  const phases = new Map((s.team.phases || []).map(p => [p.id, p.name]));
  pane.append(el('section', {}, el('h4', {}, 'Task templates'),
    el('p.hint', {}, 'Reusable tasks, for example “Experiment” with its sub-tasks plan, run, analyse, write up. Save one by right-clicking a task ▸ Save as template; use it by right-clicking a column ▸ Add from template.'),
    !list.length ? el('div.empty-state', {}, 'No templates yet.') : el('div.tpl-list', {}, ...list.map(t => {
      const editable = TT.canEditTemplate(t);
      const meta = [t.task.priority, t.task.status, phases.get(t.task.phaseId) && 'phase ' + phases.get(t.task.phaseId), t.task.dueOffset !== null ? 'due ' + t.task.dueOffset + ' day' + (t.task.dueOffset === 1 ? '' : 's') + ' after the week starts' : '', t.createdByName && 'by ' + t.createdByName].filter(Boolean).join(' · ');
      const ctl = el('div.row', { style: { gap: '6px' } });
      if (editable) ctl.append(
        el('button.btn.small.ghost', { type: 'button', onclick: async () => {
          const v = prompt('Template name', t.name); if (v === null || !v.trim()) return;
          save(ctx, [{ type: 'update', path: 'templates/' + t.id, data: { name: v.trim().slice(0, 80) } }], 'Template renamed.');
        } }, 'Rename'),
        el('button.btn.small.danger', { type: 'button', onclick: () => { if (confirm('Delete the template “' + t.name + '”? Tasks made from it stay as they are.')) save(ctx, [{ type: 'delete', path: 'templates/' + t.id }], 'Template deleted.'); } }, 'Delete'));
      return el('div.tpl-row', {},
        el('div.tpl-head', {}, el('span.tpl-icon', {}, t.task.icon && !t.task.icon.startsWith('data:') ? t.task.icon : '📋'), el('b', {}, t.name), el('span.spacer'), ctl),
        el('div.hint', {}, meta),
        t.task.subtasks.length ? el('ul.tpl-subs', {}, ...t.task.subtasks.map(x => el('li', {}, x))) : el('div.hint', {}, 'No sub-tasks.'));
    }))));
}

// ── Integrations ────────────────────────────────────────────────────────────
function integrations(pane, ctx, { rerender } = {}) {
  const row = (title, ok, text) => el('div.banner' + (ok ? '.info' : ''), { style: { marginBottom: '10px' } }, el('b', {}, title + (ok ? ' — connected' : ' — not set up')), el('div', {}, text));
  pane.append(el('section', {}, el('h4', {}, 'Integrations'),
    el('p.hint', {}, 'Files stay in each person’s own Google Drive or OneDrive; tasks keep a link. Nothing is stored on the tracker’s server except the link.'),
    row('Google Drive & Sheets', !!GOOGLE_CLIENT_ID, GOOGLE_CLIENT_ID ? 'Attach files to tasks, export tasks to Google Sheets, and collect tasks with a shared sheet.' : 'The site administrator adds a Google OAuth client ID (see SETUP.md, step 6).'),
    row('OneDrive', !!MS_CLIENT_ID, MS_CLIENT_ID ? 'Attach files from OneDrive to tasks.' : 'The site administrator registers a Microsoft app (see SETUP.md, step 7).'),
    row('AI summaries', true, 'Copy-for-AI works with any chatbot, free. Each person can also add their own free Gemini API key in ✨ AI summary to get summaries inside the app.')));
  pane.append(fileHealthSection(ctx));
  pane.append(githubSection(ctx, { rerender }));
}

// File health: every Drive / OneDrive file linked to a task, whether it still opens, and the ones
// sitting in one person's own drive (or added by someone who has left), so they can be moved in time.
function fileHealthSection(ctx) {
  const s = ctx.session; const T = s.team;
  const formerNames = new Set(Object.values(T.former || {}).map(f => f.name).filter(Boolean));
  const items = []; (s.tasks || []).forEach(t => (t.attachments || []).forEach(a => { if (window.TT.fileCheckable(a)) items.push({ t, a }); }));
  const box = el('div.fh-list');
  const label = { broken: 'Access lost', personal: 'Personal drive', ok: '✓ Opens' };
  const draw = () => {
    if (!items.length) { box.replaceChildren(el('p.hint', {}, 'No Google Drive or OneDrive files are linked to tasks yet.')); return; }
    const rank = (x) => { const h = window.TT.fileHealth(x.a.url); return h ? ({ broken: 0, personal: 1, unknown: 3, ok: 4 })[h.state] : (formerNames.has(x.a.addedBy) ? 2 : 3); };
    const rows = items.slice().sort((x, y) => rank(x) - rank(y) || (x.a.name || '').localeCompare(y.a.name || ''));
    const counts = { broken: 0, personal: 0, left: 0 };
    const trs = rows.map(({ t, a }) => {
      const h = window.TT.fileHealth(a.url); const left = formerNames.has(a.addedBy);
      if (h && h.state === 'broken') counts.broken++; else if (h && h.state === 'personal') counts.personal++; if (left) counts.left++;
      return el('tr', {},
        el('td', {}, el('a', { href: /^https:\/\//.test(a.url) ? a.url : undefined, target: '_blank', rel: 'noopener noreferrer' }, a.name || 'File'), el('div.hint', {}, a.provider === 'onedrive' ? 'OneDrive' : 'Google Drive')),
        el('td', {}, el('button.link-btn', { type: 'button', onclick: () => { document.querySelector('.modal-overlay .modal-head button[aria-label="Close"]')?.click(); window.boardOpenTask && window.boardOpenTask(t.id); } }, t.name || 'Task')),
        el('td', {}, a.addedBy || '—', left ? el('span.fh-pill.fh-personal', { style: { marginLeft: '6px' }, title: 'They’ve left the team. If the file is in their own drive, move it to a team folder.' }, 'Left') : ''),
        el('td', {}, h && h.state !== 'unknown' ? el('span.fh-pill.fh-' + h.state, { title: h.why || '' }, label[h.state]) : el('span.hint', {}, 'Not checked')));
    });
    box.replaceChildren(
      el('p.hint', {}, items.length + (items.length === 1 ? ' file' : ' files') + (counts.broken ? ' · ' + counts.broken + ' can’t be opened' : '') + (counts.personal ? ' · ' + counts.personal + ' in someone’s own drive' : '') + (counts.left ? ' · ' + counts.left + ' added by people who’ve left' : '')),
      el('div.rs-table-wrap', {}, el('table.rs-table.fh-table', {}, el('tr', {}, ['File', 'Task', 'Added by', 'Status'].map(x => el('th', {}, x))), ...trs)));
  };
  const btn = el('button.btn.small', { type: 'button', id: 'fh-check-all', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Checking…';
    const r = await window.TT.checkFiles(items.map(x => x.a), { interactive: true, force: true }).catch(() => ({}));
    btn.disabled = false; btn.textContent = 'Check all files'; draw();
    if (!Object.keys(r).length) toast('Couldn’t check: sign in to Google Drive or OneDrive when asked.', 5000);
  } }, 'Check all files');
  draw();
  return el('section', { id: 'fh-settings' }, el('h4', {}, 'File health'),
    el('p.hint', {}, 'Checks that each Google Drive and OneDrive file linked to a task can still be opened, using your own sign-in. Files kept in one person’s own drive break when they leave: keep team files in a shared drive or a team (SharePoint) folder instead.'),
    el('div.row', { style: { margin: '6px 0 10px' } }, btn), box);
}

// ── Delete team (owner only) ────────────────────────────────────────────────
function danger(pane, ctx) {
  const T = ctx.session.team;
  const confirmIn = el('input.inp', { placeholder: T.name, 'aria-label': 'Type the team name to confirm' });
  const btn = el('button.btn.danger', { type: 'button', disabled: true }, 'Delete this team forever');
  confirmIn.addEventListener('input', () => { btn.disabled = confirmIn.value.trim() !== T.name; });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await ctx.backend.data.deleteTeam(ctx.session.teamId); document.querySelector('.modal-overlay')?.remove(); toast('Team deleted.'); ctx.goHome(); }
    catch (e) { btn.disabled = false; toast(friendlyError(e), 6000); }
  });
  pane.append(el('section', {}, el('h4', {}, 'Delete team'),
    el('p.hint', {}, 'This permanently deletes every task, category, week, invitation and membership in “', T.name, '”. Files in Google Drive or OneDrive are not touched. Download a backup first (Team data ▸ Download backup).'),
    el('label.field', {}, el('span', {}, 'Type the team name to confirm'), confirmIn), btn));
}
