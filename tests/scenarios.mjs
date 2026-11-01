// Shared security scenarios. tests/unit.test.mjs runs them against the demo's
// rules copy (src/rules-sim.js); tests/rules.test.mjs runs the SAME list against
// the real firestore.rules in the Firebase emulator. If both pass, they agree.
import { DEFAULT_ROLES } from '../src/permissions.js';
import { EDUCATION } from '../src/edition.js';
import { DEFAULT_LABELS, storedWorkflow, leadsIndex, cleanWorkflow } from '../src/model.js';

export const TEAM = 't1';
export const users = {
  owner: { uid: 'owner', email: 'owner@x.com', emailVerified: true },
  admin1: { uid: 'admin1', email: 'admin1@x.com', emailVerified: true },
  mem1: { uid: 'mem1', email: 'mem1@x.com', emailVerified: true },
  view1: { uid: 'view1', email: 'view1@x.com', emailVerified: true },
  evil: { uid: 'evil', email: 'evil@x.com', emailVerified: true },
  newbie: { uid: 'newbie', email: 'new@x.com', emailVerified: true },
  newbieUnverified: { uid: 'newbie', email: 'new@x.com', emailVerified: false },
  plat: { uid: 'plat', email: 'plat@x.com', emailVerified: true },
  ownerUni: { uid: 'owner', email: 'owner@bristol.ac.uk', emailVerified: true },
  ownerUniUnverified: { uid: 'owner', email: 'owner@bristol.ac.uk', emailVerified: false },
  mem1Uni: { uid: 'mem1', email: 'mem1@mit.edu', emailVerified: true },
};
const inDays = (d) => Date.now() + d * 864e5;
const eduPlan = (by, days = 365, over = {}) => ({ plan: { tier: 'pro', edu: true, until: inDays(days), by, at: 1, note: 'University email', ...over } });
const YEAR = new Date().getUTCFullYear();
const claim = (uid, teams, year = YEAR) => set('/eduClaims/' + uid, { year, teams });

export const teamDoc = (over = {}) => ({
  name: 'Robotics', logo: '', ownerUid: 'owner', createdAt: 1, roles: DEFAULT_ROLES, fields: [], labels: DEFAULT_LABELS,
  weeks: [{ key: 'w1', title: 'WEEK 1', metric: '', startDate: '' }], ...over,
});
const member = (uid, roleId) => ({ uid, email: uid + '@x.com', name: uid, photo: '', roleId, joinedAt: 1 });
// A task's history so far (newest first).
const H = [{ time: 'b', user: 'mem1', field: 'Sign-off', original: '', updated: 'Sent for sign-off' }, { time: 'a', user: 'mem1', field: 'Stage', original: 'Design', updated: 'Review' }];
export const task = (ownerUid, categoryId, over = {}) => ({
  name: 'Task', priority: 'Minor', status: '', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none',
  dueDate: '', completedDate: '', subtasks: [], history: [], custom: {}, icon: '', attachments: [],
  categoryId, ownerUid, weekId: 'w1', order: 0, createdBy: ownerUid, createdAt: 1, updatedBy: ownerUid, updatedAt: 1, ...over,
});

/** The starting database for every scenario. */
export const comment = (authorUid, taskId, mentions = [], over = {}) => ({ taskId, authorUid, authorName: authorUid, text: 'Looks good @' + (mentions[0] || 'all'), mentions, createdAt: 1, ...over });

export const template = (createdBy, over = {}) => ({ name: 'Experiment', task: { name: 'Experiment', priority: 'Major', subtasks: ['Plan', 'Run'] }, createdBy, createdByName: createdBy, createdAt: 1, ...over });

export const meeting = (createdBy, over = {}) => ({ title: 'Supervisor meeting', date: '2026-10-19', attendees: [createdBy], notes: 'Notes', actions: [], createdBy, createdByName: createdBy, createdAt: 1, updatedAt: 1, updatedByName: createdBy, ...over });
export const note = (authorUid, taskId, over = {}) => ({ taskId, authorUid, authorName: authorUid, date: '2026-10-19', text: 'Measured 12 mA', images: [], createdAt: 1, ...over });
export const part = (createdBy, over = {}) => ({ name: 'Servo MG996R', partNo: '', supplier: 'RS', url: '', qty: 4, unitCost: 6.5, status: 'needed', neededBy: '', orderedDate: '', receivedDate: '', taskId: '', budgetId: '', notes: '', createdBy, createdByName: createdBy, createdAt: 1, updatedAt: 1, ...over });
export const expense = (createdBy, over = {}) => ({ kind: 'expense', amount: 26, date: '2026-10-19', description: 'Servos', budgetId: '', payer: 'Tom', receiptUrl: '', receiptImage: '', taskId: '', partId: '', createdBy, createdByName: createdBy, createdAt: 1, updatedAt: 1, ...over });
export const logEntry = (by, over = {}) => ({ at: 1, by, byName: by, kind: 'budget', text: 'Added budget line “Parts”', ...over });
export const paper = (addedBy, over = {}) => ({ title: 'Robot grasping', authors: 'A. Smith', year: 2024, venue: 'ICRA', doi: '', url: '', notes: '', tags: [], status: 'to-read', taskIds: [], addedBy, addedByName: addedBy, createdAt: 1, updatedAt: 1, ...over });

export const risk = (createdBy, over = {}) => ({ title: 'Servos late', detail: '', likelihood: 3, impact: 4, ownerUid: createdBy, status: 'open', mitigation: '', taskIds: [], reviewDate: '', createdBy, createdByName: createdBy, createdAt: 1, updatedAt: 1, ...over });
export const requirement = (createdBy, over = {}) => ({ ref: 'REQ-001', title: 'Lift 500 g', detail: '', priority: 'must', status: 'draft', taskIds: [], verification: '', verified: false, verifiedBy: '', verifiedDate: '', createdBy, createdByName: createdBy, createdAt: 1, updatedAt: 1, ...over });

export const selfTask = (uid, over = {}) => ({ uid, kind: 'task', title: 'Read chapter 3', area: 'uni', scope: 'day', date: '2026-10-21', done: false, doneOn: '', order: 0, createdAt: 1, updatedAt: 1, ...over });

export const signoff = (status, over = {}) => ({ stage: 'review', status, by: 'mem1', byName: 'mem1', at: 1, approver: '', approverName: '', note: '', decidedAt: 0, ...over });

export const whiteboard = (createdBy, over = {}) => ({ name: 'Planning', createdBy, createdByName: createdBy, createdAt: 1, updatedAt: 1, ...over });
export const wbItem = (createdBy, over = {}) => ({ boardId: 'wb_owner', kind: 'note', x: 0, y: 0, w: 220, h: 140, text: 'Idea', color: '#fef08a', taskId: '', from: '', to: '', z: 1, createdBy, updatedAt: 1, ...over });

export const GATE = 't_gate';
const GATE_SUBTEAMS = [{ id: 'gear', name: 'Gear', color: '#3ba3ff', members: ['mem1', 'view1'], leads: ['view1'] }];
const GATE_WORKFLOW = storedWorkflow(cleanWorkflow({ stages: [
  { id: 'design', name: 'Design', kind: 'todo' }, { id: 'review', name: 'Review', kind: 'doing', signoff: 'lead' },
  { id: 'build', name: 'Build', kind: 'doing' }, { id: 'test', name: 'Test', kind: 'doing', signoff: 'admin' }, { id: 'done', name: 'Done' }] }));
const ask = (by) => ({ status: 'waiting', by, byName: by, at: 1, amount: 300, approver: '', approverName: '', note: '', decidedAt: 0 });
const decided = (status, approver, by = 'mem1') => ({ ...ask(by), status, approver, approverName: approver, decidedAt: 2 });
const approved = (stage, by) => signoff('approved', { stage, approver: by, approverName: by, decidedAt: 2 });

export function fixture() {
  return {
    users: {}, admins: { plat: true },
    root: { verifiedStudents: { admin1: { email: 'admin1@bristol.ac.uk', verifiedAt: 1, until: Date.now() + 200 * 864e5 } }, eduClaims: { view1: { year: new Date().getUTCFullYear(), teams: ['a', 'b'] } }, selfItems: { s_owner: selfTask('owner') } },
    teams: {
      [TEAM]: {
        doc: teamDoc(),
        members: { owner: member('owner', 'owner'), admin1: member('admin1', 'admin'), mem1: member('mem1', 'member'), view1: member('view1', 'viewer') },
        invites: { 'new@x.com': { email: 'new@x.com', roleId: 'member', teamName: 'Robotics', invitedBy: 'owner', invitedByName: 'O', createdAt: 1 } },
        categories: { c_owner: { name: 'GEN', ownerUid: 'owner', order: 0 }, c_mem1: { name: 'GEN', ownerUid: 'mem1', order: 0 }, c_admin1: { name: 'GEN', ownerUid: 'admin1', order: 0 } },
        audit: { a1: { seq: 1, at: 1, eventId: 'e1', actor: { type: 'person', uid: 'mem1', name: 'mem1' }, col: 'tasks', docId: 't_mem1', action: 'create', label: 'Task', changes: [], docHash: 'x', prevHash: '', hash: 'h1' } },
        private: { auditHead: { seq: 1, hash: 'h1', at: 1 } },
        tasks: { t_mem1: task('mem1', 'c_mem1'), t_fresh: task('mem1', 'c_mem1', { createdAt: Date.now() - 60000 }), t_owner: task('owner', 'c_owner'), t_wait: task('mem1', 'c_mem1', { stage: 'review', signoff: signoff('waiting') }) },
        comments: { cm_owner: comment('owner', 't_mem1', ['mem1']), cm_mem1: comment('mem1', 't_owner') },
        templates: { tpl_mem1: template('mem1'), tpl_owner: template('owner') },
        whiteboards: { wb_owner: whiteboard('owner') }, wbItems: { wi_owner: wbItem('owner') },
        meetings: { mt_owner: meeting('owner') }, notebook: { nb_mem1: note('mem1', 't_mem1') }, parts: { pt_mem1: part('mem1') },
        papers: { pp_owner: paper('owner') }, profiles: { mem1: { capacity: 10, skills: ['CAD'], away: [], updatedAt: 1 } }, risks: { rk_owner: risk('owner') }, requirements: { rq_owner: requirement('owner') }, expenses: { x_admin1: expense('admin1') }, finance: { budget: { currency: 'GBP', lines: [], updatedAt: 1 } }, financeLog: { fl_1: logEntry('admin1') },
      },
      // A team whose workflow needs sign-offs: Review by mem1's sub-team lead (view1), Test by an admin.
      [GATE]: {
        doc: teamDoc({ subteams: GATE_SUBTEAMS, leads: leadsIndex(GATE_SUBTEAMS), workflow: GATE_WORKFLOW, purchase: { on: true, over: 50 }, autos: { partsTo: 'build', tellWaiting: true, remindDays: 3 }, github: { repo: 'uni/rover', issues: true, done: true, owner: 'mem1', connectedAt: 1 } }),
        members: { owner: member('owner', 'owner'), admin1: member('admin1', 'admin'), mem1: member('mem1', 'member'), view1: member('view1', 'viewer') },
        invites: {}, categories: { c_mem1: { name: 'GEN', ownerUid: 'mem1', order: 0 } },
        tasks: {
          g_review: task('mem1', 'c_mem1', { stage: 'review' }), g_wait: task('mem1', 'c_mem1', { stage: 'review', signoff: signoff('waiting'), history: H }),
          g_built: task('mem1', 'c_mem1', { stage: 'build', signoff: signoff('approved', { approver: 'view1', approverName: 'view1', decidedAt: 2 }) }),
          g_test: task('mem1', 'c_mem1', { stage: 'test' }),
        },
        // A signed-off task that was deleted: its decision is kept, so undo can bring it back.
        removed: { g_gone: { signoff: approved('review', 'view1'), name: 'Gone', ownerUid: 'mem1', by: 'admin1', at: 1 } },
        // Purchase approvals over 50: a cheap part, a dear one, one waiting, one approved.
        parts: { p_cheap: part('mem1', { qty: 2, unitCost: 10 }), p_dear: part('mem1', { qty: 1, unitCost: 300 }),
          p_wait: part('mem1', { qty: 1, unitCost: 300, approval: ask('mem1') }), p_ok: part('mem1', { qty: 1, unitCost: 300, approval: decided('approved', 'admin1') }),
          p_admin_wait: part('admin1', { qty: 1, unitCost: 300, approval: ask('admin1') }), p_cheap_bought: part('mem1', { qty: 2, unitCost: 10, status: 'ordered' }),
          p_ok_bought: part('mem1', { qty: 1, unitCost: 300, status: 'ordered', approval: decided('approved', 'admin1') }) },
      },
    },
  };
}

const upd = (path, data) => ({ type: 'update', path, data });
const set = (path, data) => ({ type: 'set', path, data });
const del = (path) => ({ type: 'delete', path });

// [name, user, teamId, ops, expected]
const fb = (uid, over = {}) => ({ kind: 'bug', text: 'The export button does nothing', where: '#/t', teamId: TEAM, ua: 'test', build: 'dev', at: 1, uid, email: uid + '@x.com', name: uid, errors: [], expireAt: new Date(Date.now() + 365 * 864e5), ...over });
export const writeScenarios = [
  ['founder creates a new team with themselves as owner', 'evil', 't2', [set('team', teamDoc({ ownerUid: 'evil' })), set('members/evil', member('evil', 'owner'))], 'allow'],
  ['nobody can make themselves owner of an existing team', 'evil', TEAM, [set('members/evil', member('evil', 'owner'))], 'deny'],
  ['a stranger cannot join without an invitation', 'evil', TEAM, [set('members/evil', member('evil', 'member'))], 'deny'],
  ['an unverified email cannot accept an invitation', 'newbieUnverified', TEAM, [set('members/newbie', { ...member('newbie', 'member'), email: 'new@x.com' }), del('invites/new@x.com')], 'deny'],
  ['a verified invitee joins with the invited role', 'newbie', TEAM, [set('members/newbie', { ...member('newbie', 'member'), email: 'new@x.com' }), del('invites/new@x.com')], 'allow'],
  ['an invitee cannot pick a higher role than invited', 'newbie', TEAM, [set('members/newbie', { ...member('newbie', 'admin'), email: 'new@x.com' })], 'deny'],
  ['a viewer cannot create tasks', 'view1', TEAM, [set('tasks/x', task('mem1', 'c_mem1'))], 'deny'],
  ['a member creates a task in their own row', 'mem1', TEAM, [set('tasks/x', task('mem1', 'c_mem1'))], 'allow'],
  ['a member cannot edit someone else’s task', 'mem1', TEAM, [upd('tasks/t_owner', { name: 'hacked' })], 'deny'],
  ['a member cannot move their task into someone else’s row', 'mem1', TEAM, [upd('tasks/t_mem1', { categoryId: 'c_owner', ownerUid: 'owner' })], 'deny'],
  ['an admin edits anyone’s task', 'admin1', TEAM, [upd('tasks/t_mem1', { name: 'Renamed by admin' })], 'allow'],
  ['a task must sit in a row owned by its owner', 'mem1', TEAM, [set('tasks/x', task('mem1', 'c_owner'))], 'deny'],
  ['tasks cannot carry unexpected fields', 'mem1', TEAM, [set('tasks/x', { ...task('mem1', 'c_mem1'), hack: true })], 'deny'],
  ['tasks need a valid priority', 'mem1', TEAM, [set('tasks/x', task('mem1', 'c_mem1', { priority: 'Mega' }))], 'deny'],
  ['a member cannot change roles', 'mem1', TEAM, [upd('team', { roles: { ...DEFAULT_ROLES, member: { ...DEFAULT_ROLES.member, perms: { ...DEFAULT_ROLES.member.perms, 'tasks.editAll': true } } } })], 'deny'],
  ['a member manages weeks (default member permission)', 'mem1', TEAM, [upd('team', { weeks: [{ key: 'w1', title: 'WEEK 1', metric: '', startDate: '' }, { key: 'w2', title: 'WEEK 2', metric: '', startDate: '' }] })], 'allow'],
  ['a viewer cannot change weeks', 'view1', TEAM, [upd('team', { weeks: [] })], 'deny'],
  ['a member cannot rename the team', 'mem1', TEAM, [upd('team', { name: 'Mine now' })], 'deny'],
  ['an admin renames the team', 'admin1', TEAM, [upd('team', { name: 'Robotics 2' })], 'allow'],
  ['an admin changes a member’s role', 'admin1', TEAM, [upd('members/mem1', { roleId: 'viewer' })], 'allow'],
  ['nobody changes their own role', 'admin1', TEAM, [upd('members/admin1', { roleId: 'member' })], 'deny'],
  ['nobody can be promoted to owner', 'admin1', TEAM, [upd('members/mem1', { roleId: 'owner' })], 'deny'],
  ['the owner’s role cannot be changed', 'admin1', TEAM, [upd('members/owner', { roleId: 'member' })], 'deny'],
  ['roles must exist', 'admin1', TEAM, [upd('members/mem1', { roleId: 'ghost' })], 'deny'],
  ['an admin invites by email', 'admin1', TEAM, [set('invites/x@y.com', { email: 'x@y.com', roleId: 'member', teamName: 'Robotics', invitedBy: 'admin1', invitedByName: 'A', createdAt: 2 })], 'allow'],
  ['nobody can invite someone as owner', 'admin1', TEAM, [set('invites/x@y.com', { email: 'x@y.com', roleId: 'owner', teamName: 'Robotics', invitedBy: 'admin1', invitedByName: 'A', createdAt: 2 })], 'deny'],
  ['an invite id must match its email', 'admin1', TEAM, [set('invites/x@y.com', { email: 'other@y.com', roleId: 'member', teamName: 'Robotics', invitedBy: 'admin1', invitedByName: 'A', createdAt: 2 })], 'deny'],
  ['an invitation is in your own name', 'admin1', TEAM, [set('invites/x@y.com', { email: 'x@y.com', roleId: 'member', teamName: 'Robotics', invitedBy: 'someone-else', invitedByName: 'A', createdAt: 2 })], 'deny'],
  ['an invitation can’t carry a long message in the inviter’s name', 'admin1', TEAM, [set('invites/x@y.com', { email: 'x@y.com', roleId: 'member', teamName: 'Robotics', invitedBy: 'admin1', invitedByName: 'A'.repeat(200), createdAt: 2 })], 'deny'],
  ['a member cannot invite', 'mem1', TEAM, [set('invites/x@y.com', { email: 'x@y.com', roleId: 'member', teamName: 'Robotics', invitedBy: 'mem1', invitedByName: 'M', createdAt: 2 })], 'deny'],
  ['a member can’t just leave: it needs approval', 'mem1', TEAM, [del('members/mem1')], 'deny'],
  ['I set my own status (who’s here)', 'mem1', TEAM, [set('presence/mem1', { at: Date.now(), state: 'busy', note: 'In the lab', until: 0, taskId: 't_mem1' })], 'allow'],
  ['…a viewer too', 'view1', TEAM, [set('presence/view1', { at: Date.now(), state: '', note: '', until: 0, taskId: '' })], 'allow'],
  ['nobody sets someone else’s status', 'mem1', TEAM, [set('presence/view1', { at: Date.now(), state: 'away', note: '', until: 0, taskId: '' })], 'deny'],
  ['a status is one of the known ones', 'mem1', TEAM, [set('presence/mem1', { at: Date.now(), state: 'hacking', note: '', until: 0, taskId: '' })], 'deny'],
  ['a status note is short', 'mem1', TEAM, [set('presence/mem1', { at: Date.now(), state: '', note: 'x'.repeat(81), until: 0, taskId: '' })], 'deny'],
  ['a stranger can’t appear online in a team', 'evil', TEAM, [set('presence/evil', { at: Date.now(), state: '', note: '', until: 0, taskId: '' })], 'deny'],
  ['an admin can leave straight away', 'admin1', TEAM, [del('members/admin1')], 'allow'],
  ['a member asks to leave', 'mem1', TEAM, [set('requests/leave-mem1', { kind: 'leave', by: 'mem1', byName: 'M', at: 1, note: 'Moving to the rover team' })], 'allow'],
  ['…only for themselves', 'mem1', TEAM, [set('requests/leave-view1', { kind: 'leave', by: 'view1', byName: 'V', at: 1, note: '' })], 'deny'],
  ['…and the owner can’t ask to leave (they hand over ownership)', 'owner', TEAM, [set('requests/leave-owner', { kind: 'leave', by: 'owner', byName: 'O', at: 1, note: '' })], 'deny'],
  ['a leave request has nothing extra', 'mem1', TEAM, [set('requests/leave-mem1', { kind: 'leave', by: 'mem1', byName: 'M', at: 1, note: '', roleId: 'admin' })], 'deny'],
  ['a member withdraws their own leave request', 'mem1', TEAM, [del('requests/leave-mem1')], 'allow'],
  ['an admin approves: hands the tasks on, keeps the name, removes the member', 'admin1', TEAM, [upd('tasks/t_mem1', { ownerUid: 'owner', categoryId: 'c_owner' }), upd('team', { former: { mem1: { name: 'mem1', leftAt: 5 } } }), del('members/mem1'), del('requests/leave-mem1')], 'allow'],
  ['a member can’t approve someone else leaving', 'mem1', TEAM, [del('members/view1')], 'deny'],
  ['only member managers record former members', 'mem1', TEAM, [upd('team', { former: { view1: { name: 'V', leftAt: 5 } } })], 'deny'],
  // Deleting tasks: older than a day needs someone who edits everyone's tasks
  ['a member can’t delete their own older task', 'mem1', TEAM, [del('tasks/t_mem1')], 'deny'],
  ['…but can delete one they made in the last day', 'mem1', TEAM, [del('tasks/t_fresh')], 'allow'],
  ['an admin deletes any task', 'admin1', TEAM, [del('tasks/t_mem1')], 'allow'],
  ['nobody makes an old task look new to delete it without approval', 'mem1', TEAM, [upd('tasks/t_mem1', { createdAt: Date.now() })], 'deny'],
  ['…or changes who made it', 'mem1', TEAM, [upd('tasks/t_mem1', { createdBy: 'admin1' })], 'deny'],
  ['a new task is made in my own name', 'mem1', TEAM, [set('tasks/t_x', task('mem1', 'c_mem1', { createdBy: 'admin1', createdAt: Date.now() }))], 'deny'],
  ['…and not dated in the future', 'mem1', TEAM, [set('tasks/t_x', task('mem1', 'c_mem1', { createdBy: 'mem1', createdAt: Date.now() + 864e5 }))], 'deny'],
  ['…an ordinary new task is fine', 'mem1', TEAM, [set('tasks/t_x', task('mem1', 'c_mem1', { createdBy: 'mem1', createdAt: Date.now() }))], 'allow'],
  ['a member asks for their task to be deleted', 'mem1', TEAM, [set('requests/del-t_mem1', { kind: 'delete', by: 'mem1', byName: 'M', at: 1, note: 'Duplicate', taskId: 't_mem1', taskName: 'Task' })], 'allow'],
  ['…not for a task they can’t edit', 'mem1', TEAM, [set('requests/del-t_owner', { kind: 'delete', by: 'mem1', byName: 'M', at: 1, note: '', taskId: 't_owner', taskName: 'Task' })], 'deny'],
  ['…and the request names the task it’s for', 'mem1', TEAM, [set('requests/del-t_owner', { kind: 'delete', by: 'mem1', byName: 'M', at: 1, note: '', taskId: 't_mem1', taskName: 'Task' })], 'deny'],
  ['a viewer can’t ask to delete', 'view1', TEAM, [set('requests/del-t_mem1', { kind: 'delete', by: 'view1', byName: 'V', at: 1, note: '', taskId: 't_mem1', taskName: 'Task' })], 'deny'],
  ['an admin approves a delete request', 'admin1', TEAM, [del('tasks/t_mem1'), del('requests/del-t_mem1')], 'allow'],
  ['nobody removes the owner', 'admin1', TEAM, [del('members/owner')], 'deny'],
  ['the owner deletes the team together with their membership', 'owner', TEAM, [del('members/owner'), del('team')], 'allow'],
  ['an admin cannot delete the team', 'admin1', TEAM, [del('team')], 'deny'],
  ['the owner cannot drop their membership and keep the team', 'owner', TEAM, [del('members/owner')], 'deny'],
  ['an admin cannot edit roles by default', 'admin1', TEAM, [upd('team', { roles: { ...DEFAULT_ROLES, viewer: { ...DEFAULT_ROLES.viewer, name: 'Guest' } } })], 'deny'],
  ['the owner edits roles', 'owner', TEAM, [upd('team', { roles: { ...DEFAULT_ROLES, viewer: { ...DEFAULT_ROLES.viewer, name: 'Guest' } } })], 'allow'],
  ['a member updates their own display name', 'mem1', TEAM, [upd('members/mem1', { name: 'Mem One' })], 'allow'],
  ['a member cannot edit their role through their profile', 'mem1', TEAM, [upd('members/mem1', { name: 'x', roleId: 'admin' })], 'deny'],
  ['team ownership cannot be reassigned by editing the team', 'owner', TEAM, [upd('team', { ownerUid: 'mem1' })], 'deny'],
  ['a member deletes their own category', 'mem1', TEAM, [del('categories/c_mem1')], 'allow'],
  ['a member cannot delete someone else’s category', 'mem1', TEAM, [del('categories/c_owner')], 'deny'],
  ['a non-member cannot write tasks, even into a valid row', 'evil', TEAM, [set('tasks/x', task('mem1', 'c_mem1'))], 'deny'],
  // Week numbering (team settings permission)
  ['an admin switches the team to calendar week numbers', 'admin1', TEAM, [upd('team', { weekNaming: 'calendar' })], 'allow'],
  ['a member cannot change week numbering', 'mem1', TEAM, [upd('team', { weekNaming: 'calendar' })], 'deny'],
  ['week numbering only accepts the two known values', 'owner', TEAM, [upd('team', { weekNaming: 'fortnightly' })], 'deny'],
  ['a new team can be created with own week numbering', 'evil', 't3', [set('team', teamDoc({ ownerUid: 'evil', weekNaming: 'sequence' })), set('members/evil', member('evil', 'owner'))], 'allow'],
  // Project phases (team settings permission) and a task's phase
  ['an admin sets the project phases', 'admin1', TEAM, [upd('team', { phases: [{ id: 'ph1', name: 'Research', color: '#4299e1', start: '2026-10-01', end: '2026-10-31', milestone: '' }] })], 'allow'],
  ['a member cannot change the project phases', 'mem1', TEAM, [upd('team', { phases: [] })], 'deny'],
  ['phases must be a list', 'owner', TEAM, [upd('team', { phases: 'Research' })], 'deny'],
  ['a member puts their own task in a phase', 'mem1', TEAM, [upd('tasks/t_mem1', { phaseId: 'ph1' })], 'allow'],
  ['a member cannot change the phase of someone else’s task', 'mem1', TEAM, [upd('tasks/t_owner', { phaseId: 'ph1' })], 'deny'],
  ['a task phase must be text', 'mem1', TEAM, [upd('tasks/t_mem1', { phaseId: 7 })], 'deny'],
  // Comments and @mentions
  ['a member comments on someone else’s task', 'mem1', TEAM, [set('comments/new', comment('mem1', 't_owner', ['owner']))], 'allow'],
  ['a viewer cannot comment', 'view1', TEAM, [set('comments/new', comment('view1', 't_owner'))], 'deny'],
  ['a non-member cannot comment', 'evil', TEAM, [set('comments/new', comment('evil', 't_owner'))], 'deny'],
  ['nobody can comment as someone else', 'mem1', TEAM, [set('comments/new', comment('owner', 't_owner'))], 'deny'],
  ['an empty comment is refused', 'mem1', TEAM, [set('comments/new', comment('mem1', 't_owner', [], { text: '' }))], 'deny'],
  ['a very long comment is refused', 'mem1', TEAM, [set('comments/new', comment('mem1', 't_owner', [], { text: 'x'.repeat(2001) }))], 'deny'],
  ['comments cannot carry extra fields', 'mem1', TEAM, [set('comments/new', comment('mem1', 't_owner', [], { pinned: true }))], 'deny'],
  ['an author edits their comment', 'mem1', TEAM, [upd('comments/cm_mem1', { text: 'Fixed typo', mentions: [], editedAt: 2 })], 'allow'],
  ['nobody edits someone else’s comment', 'admin1', TEAM, [upd('comments/cm_mem1', { text: 'Changed', editedAt: 2 })], 'deny'],
  ['an author cannot move their comment to another task', 'mem1', TEAM, [upd('comments/cm_mem1', { taskId: 't_mem1' })], 'deny'],
  ['an author deletes their comment', 'mem1', TEAM, [del('comments/cm_mem1')], 'allow'],
  ['an admin removes someone’s comment', 'admin1', TEAM, [del('comments/cm_mem1')], 'allow'],
  ['a member cannot delete someone else’s comment', 'mem1', TEAM, [del('comments/cm_owner')], 'deny'],
  // Task templates
  ['a member saves a template', 'mem1', TEAM, [set('templates/new', template('mem1'))], 'allow'],
  ['a viewer cannot save templates', 'view1', TEAM, [set('templates/new', template('view1'))], 'deny'],
  ['nobody saves a template as someone else', 'mem1', TEAM, [set('templates/new', template('owner'))], 'deny'],
  ['a template needs a name', 'mem1', TEAM, [set('templates/new', template('mem1', { name: '' }))], 'deny'],
  ['the author renames their template', 'mem1', TEAM, [upd('templates/tpl_mem1', { name: 'Lab run' })], 'allow'],
  ['an admin (team settings) tidies anyone’s templates', 'admin1', TEAM, [del('templates/tpl_mem1')], 'allow'],
  ['a member cannot delete someone else’s template', 'mem1', TEAM, [del('templates/tpl_owner')], 'deny'],
  ['a template’s author cannot be changed', 'admin1', TEAM, [upd('templates/tpl_mem1', { createdBy: 'admin1' })], 'deny'],
  // Repeating tasks
  ['a member makes their task repeat weekly', 'mem1', TEAM, [upd('tasks/t_mem1', { repeat: { every: 1, until: '', through: '', seriesId: '' } })], 'allow'],
  ['repeat must be a map', 'mem1', TEAM, [upd('tasks/t_mem1', { repeat: 'weekly' })], 'deny'],
  // Planning: stage, effort, dependencies, team capacity
  ['a member moves their task to Doing with an estimate', 'mem1', TEAM, [upd('tasks/t_mem1', { stage: 'doing', effort: 3.5 })], 'allow'],
  ['a member makes their task wait on someone else’s', 'mem1', TEAM, [upd('tasks/t_mem1', { dependsOn: ['t_owner'] })], 'allow'],
  ['a stage must be a plain id', 'mem1', TEAM, [upd('tasks/t_mem1', { stage: 'blocked!' })], 'deny'],
  ['effort can’t be negative', 'mem1', TEAM, [upd('tasks/t_mem1', { effort: -2 })], 'deny'],
  ['effort can’t be huge', 'mem1', TEAM, [upd('tasks/t_mem1', { effort: 5000 })], 'deny'],
  ['a task waits on at most 10 others', 'mem1', TEAM, [upd('tasks/t_mem1', { dependsOn: Array.from({ length: 11 }, (_, i) => 't' + i) })], 'deny'],
  ['a member cannot change someone else’s stage', 'mem1', TEAM, [upd('tasks/t_owner', { stage: 'doing' })], 'deny'],
  ['an admin sets the team’s weekly capacity', 'admin1', TEAM, [upd('team', { capacity: 12 })], 'allow'],
  ['a member cannot set the team’s capacity', 'mem1', TEAM, [upd('team', { capacity: 12 })], 'deny'],
  ['capacity is at most 80 hours', 'admin1', TEAM, [upd('team', { capacity: 200 })], 'deny'],
  // Research tools
  ['a member writes meeting notes', 'mem1', TEAM, [set('meetings/new', meeting('mem1'))], 'allow'],
  ['a member adds an action to someone else’s meeting', 'mem1', TEAM, [upd('meetings/mt_owner', { actions: [{ id: 'a1', text: 'Order parts', ownerUid: 'mem1', dueDate: '', taskId: '' }] })], 'allow'],
  ['a viewer cannot write meeting notes', 'view1', TEAM, [set('meetings/new', meeting('view1'))], 'deny'],
  ['a member cannot delete someone else’s meeting', 'mem1', TEAM, [del('meetings/mt_owner')], 'deny'],
  ['a member adds a notebook entry to any task', 'mem1', TEAM, [set('notebook/new', note('mem1', 't_owner'))], 'allow'],
  ['nobody writes a notebook entry as someone else', 'mem1', TEAM, [set('notebook/new', note('owner', 't_owner'))], 'deny'],
  ['only the author edits a notebook entry', 'owner', TEAM, [upd('notebook/nb_mem1', { text: 'changed' })], 'deny'],
  ['a notebook entry holds at most 4 photos', 'mem1', TEAM, [set('notebook/new', note('mem1', 't_mem1', { images: ['a', 'b', 'c', 'd', 'e'] }))], 'deny'],
  ['a member adds a part', 'mem1', TEAM, [set('parts/new', part('mem1'))], 'allow'],
  ['a member marks a part ordered', 'mem1', TEAM, [upd('parts/pt_mem1', { status: 'ordered' })], 'allow'],
  ['a member without finance access cannot put a part on a budget line', 'mem1', TEAM, [upd('parts/pt_mem1', { budgetId: 'b1' })], 'deny'],
  ['an admin (finance) puts a part on a budget line', 'admin1', TEAM, [upd('parts/pt_mem1', { budgetId: 'b1' })], 'allow'],
  ['a part status must be known', 'mem1', TEAM, [upd('parts/pt_mem1', { status: 'lost' })], 'deny'],
  ['a member adds a paper', 'mem1', TEAM, [set('papers/new', paper('mem1'))], 'allow'],
  ['a viewer cannot add papers', 'view1', TEAM, [set('papers/new', paper('view1'))], 'deny'],
  ['an admin records spending', 'admin1', TEAM, [set('expenses/new', expense('admin1'))], 'allow'],
  ['a member (no finance access) cannot record spending', 'mem1', TEAM, [set('expenses/new', expense('mem1'))], 'deny'],
  ['an admin sets the budget', 'admin1', TEAM, [set('finance/budget', { currency: 'GBP', lines: [{ id: 'b1', name: 'Parts', amount: 500, phaseId: '' }], updatedAt: 2 })], 'allow'],
  ['a member cannot set the budget', 'mem1', TEAM, [set('finance/budget', { currency: 'GBP', lines: [], updatedAt: 2 })], 'deny'],
  // Plans: only a platform admin changes them; teams ask for Pro
  ['a platform admin gives a team Pro', 'plat', TEAM, [upd('team', { plan: { tier: 'pro', edu: true, until: 0, by: 'plat', at: 1, note: 'Pilot' } })], 'allow'],
  ['the plan must name the admin who set it', 'plat', TEAM, [upd('team', { plan: { tier: 'pro', edu: false, until: 0, by: 'owner', at: 1, note: '' } })], 'deny'],
  ['a platform admin cannot change anything else', 'plat', TEAM, [upd('team', { name: 'Mine now' })], 'deny'],
  ['the owner cannot give their own team Pro', 'owner', TEAM, [upd('team', { plan: { tier: 'pro', edu: false, until: 0, by: 'owner', at: 1, note: '' } })], 'deny'],
  ['an admin of the team cannot change its plan', 'admin1', TEAM, [upd('team', { plan: { tier: 'org', edu: false, until: 0, by: 'admin1', at: 1, note: '' } })], 'deny'],
  ['a new team cannot start on Pro', 'newbie', 'brand-new', [set('team', teamDoc({ ownerUid: 'newbie', plan: { tier: 'pro', edu: false, until: 0, by: 'newbie', at: 1, note: '' } })), set('members/newbie', { uid: 'newbie', email: 'new@x.com', name: 'N', photo: '', roleId: 'owner', joinedAt: 1 })], 'deny'],
  ['a team settings manager asks for Pro', 'admin1', TEAM, [set('requests/pro', { teamId: TEAM, teamName: 'Robotics', members: 4, wants: 'edu', note: 'UAS team', by: 'admin1', byName: 'A', email: 'admin1@x.com', at: 1, status: 'open' })], 'allow'],
  ['a member without settings cannot ask for Pro', 'mem1', TEAM, [set('requests/pro', { teamId: TEAM, teamName: 'Robotics', members: 4, wants: 'pro', note: '', by: 'mem1', byName: 'M', email: 'mem1@x.com', at: 1, status: 'open' })], 'deny'],
  ['a team cannot approve its own request', 'admin1', TEAM, [set('requests/pro', { teamId: TEAM, teamName: 'Robotics', members: 4, wants: 'pro', note: '', by: 'admin1', byName: 'A', email: 'admin1@x.com', at: 1, status: 'approved' })], 'deny'],
  ['a member asks the owner and admins for Pro', 'mem1', TEAM, [set('requests/ask-mem1', { by: 'mem1', byName: 'M', at: 1, note: 'Need approvals' })], 'allow'],
  ['…only in their own name', 'mem1', TEAM, [set('requests/ask-admin1', { by: 'admin1', byName: 'A', at: 1, note: '' })], 'deny'],
  ['a non-member cannot ask', 'evil', TEAM, [set('requests/ask-evil', { by: 'evil', byName: 'E', at: 1, note: '' })], 'deny'],
  // Free Pro Education with a verified university email
  ['a university-email owner turns on Pro Education' + (EDUCATION ? '' : ' (not in Penteint Projects)'), 'ownerUni', TEAM, [claim('owner', [TEAM]), upd('team', eduPlan('owner'))], EDUCATION ? 'allow' : 'deny'],
  ['…only with this team in their claims for the year', 'ownerUni', TEAM, [upd('team', eduPlan('owner'))], 'deny'],
  ['…on several teams a year (no small quota)', 'ownerUni', TEAM, [claim('owner', ['x', 'y', 'z', TEAM]), upd('team', eduPlan('owner'))], EDUCATION ? 'allow' : 'deny'],
  ['…up to the fair-use cap of 25 teams a year', 'ownerUni', TEAM, [claim('owner', [...Array.from({ length: 25 }, (_, i) => 'x' + i), TEAM]), upd('team', eduPlan('owner'))], 'deny'],
  ['…claims are for this year only', 'ownerUni', TEAM, [claim('owner', [TEAM], YEAR - 1), upd('team', eduPlan('owner'))], 'deny'],
  ['an admin sets the team’s workflow', 'admin1', TEAM, [{ type: 'update', path: 'team', data: { workflow: { stages: [{ id: 'design', name: 'Design', kind: 'todo', color: '#63b3ed', limit: 0 }, { id: 'done', name: 'Done', kind: 'done', color: '#68d391', limit: 0 }] } } }], 'allow'],
  ['a member can’t change the workflow', 'mem1', TEAM, [{ type: 'update', path: 'team', data: { workflow: null } }], 'deny'],
  ['a workflow has at most 10 stages', 'owner', TEAM, [{ type: 'update', path: 'team', data: { workflow: { stages: Array.from({ length: 11 }, (_, i) => ({ id: 's' + i })) } } }], 'deny'],
  ['a task can be in a custom stage', 'mem1', TEAM, [{ type: 'update', path: 'tasks/t_mem1', data: { stage: 'review', updatedBy: 'mem1', updatedAt: 2 } }], 'allow'],
  ['a stage id is a short plain word', 'mem1', TEAM, [{ type: 'update', path: 'tasks/t_mem1', data: { stage: 'no spaces allowed!', updatedBy: 'mem1', updatedAt: 2 } }], 'deny'],
  ['a member marks old weeks changed (archiveRev)', 'mem1', TEAM, [{ type: 'update', path: 'team', data: { archiveRev: 1729400000000 } }], 'allow'],
  ['a viewer can’t (they can’t edit tasks)', 'view1', TEAM, [{ type: 'update', path: 'team', data: { archiveRev: 1729400000000 } }], 'deny'],
  ['archiveRev must be a whole number', 'mem1', TEAM, [{ type: 'update', path: 'team', data: { archiveRev: 'x' } }], 'deny'],
  ['anyone signed in can send feedback', 'mem1', TEAM, [set('/feedback/f1', fb('mem1'))], 'allow'],
  ['feedback can’t be sent in someone else’s name', 'mem1', TEAM, [set('/feedback/f1', fb('mem1', { uid: 'owner' }))], 'deny'],
  ['feedback can’t use someone else’s email', 'mem1', TEAM, [set('/feedback/f1', fb('mem1', { email: 'owner@x.com' }))], 'deny'],
  ['feedback is limited to 2,000 characters', 'mem1', TEAM, [set('/feedback/f1', fb('mem1', { text: 'x'.repeat(2001) }))], 'deny'],
  ['feedback has no extra fields', 'mem1', TEAM, [set('/feedback/f1', fb('mem1', { admin: true }))], 'deny'],
  ['nobody writes claims for someone else', 'ownerUni', TEAM, [set('/eduClaims/mem1', { year: YEAR, teams: [TEAM] })], 'deny'],
  ['an admin can’t turn it on, even a verified student: only the owner (no inviting a student to unlock Pro)', 'admin1', TEAM, [claim('admin1', [TEAM]), upd('team', eduPlan('admin1'))], 'deny'],
  ['…but not with an unverified email', 'ownerUniUnverified', TEAM, [claim('owner', [TEAM]), upd('team', eduPlan('owner'))], 'deny'],
  ['…not with an ordinary email', 'owner', TEAM, [claim('owner', [TEAM]), upd('team', eduPlan('owner'))], 'deny'],
  ['…not for longer than about a year at a time', 'ownerUni', TEAM, [claim('owner', [TEAM]), upd('team', eduPlan('owner', 500))], 'deny'],
  ['…not full Pro, only Pro Education', 'ownerUni', TEAM, [claim('owner', [TEAM]), upd('team', eduPlan('owner', 365, { edu: false }))], 'deny'],
  ['…not an Organisation plan', 'ownerUni', TEAM, [claim('owner', [TEAM]), upd('team', eduPlan('owner', 365, { tier: 'org' }))], 'deny'],
  ['a member without settings cannot, even with a university email', 'mem1Uni', TEAM, [claim('mem1', [TEAM]), upd('team', eduPlan('mem1'))], 'deny'],
  // Sub-teams and extra costs
  ['an admin sets up sub-teams', 'admin1', TEAM, [upd('team', { subteams: [{ id: 'f', name: 'Fuselage', color: '#3182ce', members: ['mem1'], leads: ['mem1'] }] })], 'allow'],
  ['a member cannot change sub-teams', 'mem1', TEAM, [upd('team', { subteams: [] })], 'deny'],
  ['at most 20 sub-teams', 'admin1', TEAM, [upd('team', { subteams: Array.from({ length: 21 }, (_, i) => ({ id: 's' + i, name: 'S', color: '#3182ce', members: [], leads: [] })) })], 'deny'],
  ['a part can carry extra costs and a sub-team', 'mem1', TEAM, [upd('parts/pt_mem1', { extras: [{ label: 'Shipping', amount: 3.99, percent: false }], subteamId: 'f' })], 'allow'],
  ['a part has at most 10 extra costs', 'mem1', TEAM, [upd('parts/pt_mem1', { extras: Array.from({ length: 11 }, () => ({ label: 'x', amount: 1, percent: false })) })], 'deny'],
  // Parts linked to payments, and the finance history
  ['a payment can cover several parts', 'admin1', TEAM, [set('expenses/new', expense('admin1', { partIds: ['pt_mem1', 'pt_2'] }))], 'allow'],
  ['a payment covers at most 30 parts', 'admin1', TEAM, [set('expenses/new', expense('admin1', { partIds: Array.from({ length: 31 }, (_, i) => 'p' + i) }))], 'deny'],
  ['an admin moves spending to another budget line', 'admin1', TEAM, [upd('expenses/x_admin1', { budgetId: 'b2', updatedAt: 5 })], 'allow'],
  ['an admin adds a history line with a change', 'admin1', TEAM, [set('finance/budget', { currency: 'GBP', lines: [], updatedAt: 2 }), set('financeLog/fl_new', logEntry('admin1'))], 'allow'],
  ['a member adds a history line for a part change', 'mem1', TEAM, [set('financeLog/fl_new', logEntry('mem1', { kind: 'parts', text: 'Added part “Servo”' }))], 'allow'],
  ['nobody writes a history line in someone else’s name', 'mem1', TEAM, [set('financeLog/fl_new', logEntry('admin1'))], 'deny'],
  ['a viewer cannot add history lines', 'view1', TEAM, [set('financeLog/fl_new', logEntry('view1'))], 'deny'],
  ['a history line needs a known kind', 'admin1', TEAM, [set('financeLog/fl_new', logEntry('admin1', { kind: 'other' }))], 'deny'],
  ['a history line cannot be edited', 'admin1', TEAM, [upd('financeLog/fl_1', { text: 'Nothing happened' })], 'deny'],
  ['even an admin cannot delete a history line', 'admin1', TEAM, [del('financeLog/fl_1')], 'deny'],
  ['the owner can delete history (when deleting the team)', 'owner', TEAM, [del('financeLog/fl_1')], 'allow'],
  ['a carried-forward copy names its original', 'mem1', TEAM, [upd('tasks/t_mem1', { carryOf: 't_old' })], 'allow'],
  // Feature switches, people, time, risks, requirements
  ['an admin turns features on', 'admin1', TEAM, [upd('team', { features: { people: true, time: true } })], 'allow'],
  ['a member cannot change the team’s features', 'mem1', TEAM, [upd('team', { features: { people: true } })], 'deny'],
  ['a member sets their own hours and skills', 'mem1', TEAM, [set('profiles/mem1', { capacity: 12, skills: ['CAD', 'ROS'], away: [{ from: '2026-12-20', to: '2027-01-02', note: 'Holiday' }], updatedAt: 2 })], 'allow'],
  ['a member cannot set someone else’s hours', 'mem1', TEAM, [set('profiles/admin1', { capacity: 1, skills: [], away: [], updatedAt: 2 })], 'deny'],
  ['a member manager sets anyone’s hours', 'admin1', TEAM, [set('profiles/mem1', { capacity: 8, skills: [], away: [], updatedAt: 2 })], 'allow'],
  ['hours a week are at most 80', 'mem1', TEAM, [set('profiles/mem1', { capacity: 200, skills: [], away: [], updatedAt: 2 })], 'deny'],
  ['a member logs time on their task', 'mem1', TEAM, [upd('tasks/t_mem1', { timeLog: [{ id: 'l1', uid: 'mem1', name: 'mem1', date: '2026-10-19', hours: 2, note: '' }], skill: 'CAD' })], 'allow'],
  ['a member cannot log time on someone else’s task', 'mem1', TEAM, [upd('tasks/t_owner', { timeLog: [{ id: 'l1', uid: 'mem1', name: 'mem1', date: '2026-10-19', hours: 2, note: '' }] })], 'deny'],
  ['a member adds a risk', 'mem1', TEAM, [set('risks/new', risk('mem1'))], 'allow'],
  ['risk scores run 1–5', 'mem1', TEAM, [set('risks/new', risk('mem1', { impact: 9 }))], 'deny'],
  ['a viewer cannot add risks', 'view1', TEAM, [set('risks/new', risk('view1'))], 'deny'],
  ['a member updates the owner’s risk', 'mem1', TEAM, [upd('risks/rk_owner', { status: 'mitigating' })], 'allow'],
  ['a member cannot delete the owner’s risk', 'mem1', TEAM, [del('risks/rk_owner')], 'deny'],
  ['a member adds a requirement', 'mem1', TEAM, [set('requirements/new', requirement('mem1', { ref: 'REQ-002' }))], 'allow'],
  ['a member marks a requirement verified', 'mem1', TEAM, [upd('requirements/rq_owner', { verified: true, verifiedBy: 'mem1', verifiedDate: '2026-10-19' })], 'allow'],
  ['requirement priority must be must/should/could', 'mem1', TEAM, [set('requirements/new', requirement('mem1', { priority: 'urgent' }))], 'deny'],
  // Account photos on memberships
  ['a member sets their own uploaded photo', 'mem1', TEAM, [upd('members/mem1', { photo: 'data:image/png;base64,' + 'A'.repeat(2000) })], 'allow'],
  ['a member cannot set someone else’s photo', 'mem1', TEAM, [upd('members/owner', { photo: 'data:image/png;base64,' + 'A'.repeat(2000) })], 'deny'],
  ['an oversized photo is refused', 'mem1', TEAM, [upd('members/mem1', { photo: 'data:image/png;base64,' + 'A'.repeat(70000) })], 'deny'],
  // Whiteboards: shared drawing for anyone who can edit tasks
  ['a member starts a whiteboard', 'mem1', TEAM, [set('whiteboards/wb_new', whiteboard('mem1'))], 'allow'],
  ['a viewer can’t start a whiteboard', 'view1', TEAM, [set('whiteboards/wb_new', whiteboard('view1'))], 'deny'],
  ['a member adds a note to someone else’s board', 'mem1', TEAM, [set('wbItems/wi_new', wbItem('mem1'))], 'allow'],
  ['a member moves someone else’s note (it’s shared)', 'mem1', TEAM, [upd('wbItems/wi_owner', { x: 300, y: 40 })], 'allow'],
  ['nobody claims someone else’s note', 'mem1', TEAM, [upd('wbItems/wi_owner', { createdBy: 'mem1' })], 'deny'],
  ['a viewer can’t draw', 'view1', TEAM, [upd('wbItems/wi_owner', { x: 1 })], 'deny'],
  ['whiteboard items can’t carry unexpected fields', 'mem1', TEAM, [set('wbItems/wi_new', { ...wbItem('mem1'), script: 'x' })], 'deny'],
  ['a note is at most 2000 characters', 'mem1', TEAM, [set('wbItems/wi_new', wbItem('mem1', { text: 'x'.repeat(2001) }))], 'deny'],
  ['an item needs a known kind', 'mem1', TEAM, [set('wbItems/wi_new', wbItem('mem1', { kind: 'iframe' }))], 'deny'],
  ['a member can’t delete someone else’s board', 'mem1', TEAM, [del('whiteboards/wb_owner')], 'deny'],
  ['the board’s creator deletes it', 'owner', TEAM, [del('whiteboards/wb_owner')], 'allow'],
  ['a stranger can’t draw on the team’s board', 'evil', TEAM, [set('wbItems/wi_new', wbItem('evil'))], 'deny'],
  // Sign-off gates, enforced by the rules themselves (not just the app)
  ['gate: a task’s owner can’t move it past a stage that needs a sign-off', 'mem1', GATE, [upd('tasks/g_review', { stage: 'build' })], 'deny'],
  ['gate: …nor tick it done', 'mem1', GATE, [upd('tasks/g_review', { flag: 'completed', completedDate: '2026-10-21' })], 'deny'],
  ['gate: …nor approve it themselves', 'mem1', GATE, [upd('tasks/g_wait', { stage: 'build', signoff: approved('review', 'mem1') })], 'deny'],
  ['gate: …nor forge the lead’s approval', 'mem1', GATE, [upd('tasks/g_wait', { stage: 'build', signoff: approved('review', 'view1') })], 'deny'],
  ['gate: moving back is fine', 'mem1', GATE, [upd('tasks/g_review', { stage: 'design' })], 'allow'],
  ['gate: the sub-team lead approves and moves it on', 'view1', GATE, [upd('tasks/g_wait', { stage: 'build', signoff: approved('review', 'view1') })], 'allow'],
  ['gate: an admin who isn’t the lead can’t give a lead’s sign-off', 'admin1', GATE, [upd('tasks/g_wait', { stage: 'build', signoff: approved('review', 'admin1') })], 'deny'],
  ['gate: the team owner can always sign off', 'owner', GATE, [upd('tasks/g_review', { stage: 'build', signoff: approved('review', 'owner') })], 'allow'],
  ['gate: once approved, the owner moves it on to Test', 'mem1', GATE, [upd('tasks/g_built', { stage: 'test' })], 'allow'],
  ['gate: …but the Review approval doesn’t pass Test', 'mem1', GATE, [upd('tasks/g_built', { flag: 'completed', completedDate: '2026-10-21' })], 'deny'],
  ['gate: an admin signs off Test', 'admin1', GATE, [upd('tasks/g_test', { flag: 'completed', completedDate: '2026-10-21', signoff: approved('test', 'admin1') })], 'allow'],
  ['gate: only sign-off leads can change the leads index', 'mem1', GATE, [upd('team', { leads: { mem1: ['mem1'] } })], 'deny'],
  // Purchase approvals (workflow step 3)
  ['purchase: a cheap part is ordered without approval', 'mem1', GATE, [upd('parts/p_cheap', { status: 'ordered' })], 'allow'],
  ['purchase: a dear part can’t be marked ordered unapproved', 'mem1', GATE, [upd('parts/p_dear', { status: 'ordered' })], 'deny'],
  ['purchase: …nor received', 'mem1', GATE, [upd('parts/p_dear', { status: 'received' })], 'deny'],
  ['purchase: …nor added as already ordered', 'mem1', GATE, [set('parts/p_new', part('mem1', { qty: 1, unitCost: 300, status: 'ordered' }))], 'deny'],
  ['purchase: anyone asks for approval in their own name', 'mem1', GATE, [upd('parts/p_dear', { approval: ask('mem1') })], 'allow'],
  ['purchase: …not in someone else’s', 'mem1', GATE, [upd('parts/p_dear', { approval: ask('admin1') })], 'deny'],
  ['purchase: nobody approves their own request', 'mem1', GATE, [upd('parts/p_wait', { approval: decided('approved', 'mem1') })], 'deny'],
  ['purchase: a member can’t approve', 'view1', GATE, [upd('parts/p_wait', { approval: decided('approved', 'view1') })], 'deny'],
  ['purchase: nobody forges a finance manager’s approval', 'mem1', GATE, [upd('parts/p_wait', { status: 'ordered', approval: decided('approved', 'admin1') })], 'deny'],
  ['purchase: a finance manager approves', 'admin1', GATE, [upd('parts/p_wait', { approval: decided('approved', 'admin1') })], 'allow'],
  ['purchase: …or declines with a note', 'admin1', GATE, [upd('parts/p_wait', { approval: { ...decided('declined', 'admin1'), note: 'Too dear; find another supplier' } })], 'allow'],
  ['purchase: the team owner approves anything', 'owner', GATE, [upd('parts/p_wait', { approval: decided('approved', 'owner') })], 'allow'],
  ['purchase: once approved, it is ordered', 'mem1', GATE, [upd('parts/p_ok', { status: 'ordered', orderedDate: '2026-10-21' })], 'allow'],
  ['purchase: an approved cost can’t quietly go up', 'mem1', GATE, [upd('parts/p_ok', { unitCost: 900 })], 'deny'],
  ['purchase: …but changing it and asking again is fine', 'mem1', GATE, [upd('parts/p_ok', { unitCost: 900, approval: { ...ask('mem1'), amount: 900 } })], 'allow'],
  ['purchase: a finance manager can’t approve their own request by changing who asked', 'admin1', GATE, [upd('parts/p_admin_wait', { approval: decided('approved', 'admin1', 'mem1') })], 'deny'],
  ['purchase: nobody adds a part that is already approved', 'admin1', GATE, [set('parts/p_new2', part('admin1', { qty: 1, unitCost: 300, approval: decided('approved', 'admin1', 'mem1') }))], 'deny'],
  ['purchase: a bought part’s price can’t go over the limit without approval', 'mem1', GATE, [upd('parts/p_cheap_bought', { unitCost: 300 })], 'deny'],
  ['purchase: …within the limit it can', 'mem1', GATE, [upd('parts/p_cheap_bought', { unitCost: 20 })], 'allow'],
  ['purchase: clearing an approval doesn’t let a bought part’s price go up', 'mem1', GATE, [upd('parts/p_ok_bought', { approval: null, unitCost: 900 })], 'deny'],
  ['undo: deleting a signed-off task keeps its decision beside the deletion', 'admin1', GATE, [del('tasks/g_built'), set('removed/g_built', { signoff: approved('review', 'view1'), name: 'Task', ownerUid: 'mem1', by: 'admin1', at: 5 })], 'allow'],
  ['undo: …but a decision can’t be kept without deleting the task', 'admin1', GATE, [set('removed/g_built', { signoff: approved('review', 'view1'), name: 'Task', ownerUid: 'mem1', by: 'admin1', at: 5 })], 'deny'],
  ['undo: …nor a different one than the task carried', 'admin1', GATE, [del('tasks/g_built'), set('removed/g_built', { signoff: approved('review', 'admin1'), name: 'Task', ownerUid: 'mem1', by: 'admin1', at: 5 })], 'deny'],
  ['undo: the deleted task comes back signed off, taking the kept decision back', 'admin1', GATE, [set('tasks/g_gone', task('mem1', 'c_mem1', { name: 'Gone', stage: 'build', signoff: approved('review', 'view1'), createdBy: 'admin1', createdAt: Date.now() })), del('removed/g_gone')], 'allow'],
  ['undo: …only by taking it back', 'admin1', GATE, [set('tasks/g_gone', task('mem1', 'c_mem1', { name: 'Gone', stage: 'build', signoff: approved('review', 'view1'), createdBy: 'admin1', createdAt: Date.now() }))], 'deny'],
  ['undo: …and only with the same decision', 'admin1', GATE, [set('tasks/g_gone', task('mem1', 'c_mem1', { name: 'Gone', stage: 'build', signoff: approved('review', 'admin1'), createdBy: 'admin1', createdAt: Date.now() })), del('removed/g_gone')], 'deny'],
  ['undo: …on the same task (name and owner)', 'admin1', GATE, [set('tasks/g_gone', task('mem1', 'c_mem1', { name: 'Something else', stage: 'build', signoff: approved('review', 'view1'), createdBy: 'admin1', createdAt: Date.now() })), del('removed/g_gone')], 'deny'],
  ['tasks: a new task can’t arrive already signed off', 'mem1', GATE, [set('tasks/g_fresh', task('mem1', 'c_mem1', { stage: 'review', signoff: approved('review', 'mem1') }))], 'deny'],
  ['tasks: …but it may carry a sign-off request that is waiting', 'mem1', GATE, [set('tasks/g_fresh2', task('mem1', 'c_mem1', { stage: 'review', signoff: signoff('waiting', { stage: 'review', by: 'mem1', byName: 'mem1', at: 1 }) }))], 'allow'],
  ['purchase: only settings or finance managers change the approval limit', 'mem1', GATE, [upd('team', { purchase: { on: true, over: 100000 } })], 'deny'],
  ['purchase: a finance manager changes the approval limit', 'admin1', GATE, [upd('team', { purchase: { on: true, over: 100 } })], 'allow'],
  ['autos: only settings managers change the automatic steps', 'mem1', GATE, [upd('team', { autos: { partsTo: '', tellWaiting: false, remindDays: 0 } })], 'deny'],
  ['autos: an admin changes them', 'admin1', GATE, [upd('team', { autos: { partsTo: 'build', tellWaiting: false, remindDays: 5 } })], 'allow'],
  ['autos: shaped settings only', 'admin1', GATE, [upd('team', { autos: { partsTo: 'build', run: 'anything' } })], 'deny'],
  ['dissertation: a settings manager saves the plan, chapters and proposal', 'admin1', GATE, [set('dissertation/plan', { level: 'phd', kind: 'data', start: '2026-10-01', handIn: '2030-03-31', dates: { upgrade: '2027-09-15' }, chapters: [{ id: 'ch1', name: 'Introduction', target: 6000, words: 120, status: 'drafting' }], proposal: { question: 'How…?' }, checks: { sub_format: true }, setupAt: 1 })], 'allow'],
  ['dissertation: a member (or supervisor) can’t change it', 'mem1', GATE, [set('dissertation/plan', { level: 'ug', chapters: [] })], 'deny'],
  ['dissertation: only one document, “plan”', 'admin1', GATE, [set('dissertation/other', { level: 'ug' })], 'deny'],
  ['dissertation: only known levels', 'admin1', GATE, [set('dissertation/plan', { level: 'postdoc' })], 'deny'],
  ['dissertation: shaped record only', 'admin1', GATE, [set('dissertation/plan', { level: 'ug', grade: 'A*' })], 'deny'],
  ['dissertation: at most 20 chapters', 'admin1', GATE, [set('dissertation/plan', { level: 'ug', chapters: Array.from({ length: 21 }, (_, i) => ({ id: 'c' + i })) })], 'deny'],
  ['dissertation: the team document can’t carry it', 'admin1', GATE, [upd('team', { dissertation: { level: 'ug' } })], 'deny'],
  ['currency: a finance manager sets the team’s currency', 'admin1', GATE, [upd('team', { currency: 'EUR' })], 'allow'],
  ['currency: a member can’t', 'mem1', GATE, [upd('team', { currency: 'EUR' })], 'deny'],
  ['currency: only known currencies', 'admin1', GATE, [upd('team', { currency: 'BTC' })], 'deny'],
  ['whiteboards: a member draws shapes, pen strokes and frames', 'mem1', TEAM, [set('wbItems/wi_s', wbItem('mem1', { kind: 'shape', shape: 'ellipse', text: 'Idea' })), set('wbItems/wi_p', wbItem('mem1', { kind: 'pen', path: '0,0 500,500 1000,0', color: '#e11d48' })), set('wbItems/wi_f', wbItem('mem1', { kind: 'frame', text: 'Sprint 3', w: 600, h: 400 }))], 'allow'],
  ['whiteboards: a pen stroke can’t be huge', 'mem1', TEAM, [set('wbItems/wi_big', wbItem('mem1', { kind: 'pen', path: '1,1 '.repeat(2000) }))], 'deny'],
  ['github: a settings manager changes the options', 'admin1', GATE, [upd('team', { github: { repo: 'uni/rover', issues: false, done: true, owner: 'admin1', connectedAt: 1 } })], 'allow'],
  ['github: …but not the repository (only the server sets it, with its secret)', 'admin1', GATE, [upd('team', { github: { repo: 'evil/repo', issues: true, done: true, owner: 'admin1', connectedAt: 1 } })], 'deny'],
  ['github: …nor claim a token the server doesn’t have', 'admin1', GATE, [upd('team', { github: { repo: 'uni/rover', issues: true, done: true, owner: 'mem1', connectedAt: 1, write: true } })], 'deny'],
  ['github: a member can’t change the options', 'mem1', GATE, [upd('team', { github: { repo: 'uni/rover', issues: false, done: false, owner: 'mem1', connectedAt: 1 } })], 'deny'],
  ['github: only shaped settings', 'admin1', GATE, [upd('team', { github: { repo: 'uni/rover', token: 'ghp_x' } })], 'deny'],
  ['a task’s owner records when they reminded the sign-off person', 'mem1', GATE, [upd('tasks/g_wait', { signoff: { ...signoff('waiting'), remindedAt: 5 } })], 'allow'],
  // Sign-offs and checklists (workflow step 2)
  ['a member ticks checklist items on their task', 'mem1', TEAM, [upd('tasks/t_mem1', { checks: { review_c0: true } })], 'allow'],
  ['a member sends their task for sign-off', 'mem1', TEAM, [upd('tasks/t_mem1', { stage: 'review', signoff: signoff('waiting') })], 'allow'],
  ['nobody records an approval in someone else’s name', 'mem1', TEAM, [upd('tasks/t_wait', { signoff: signoff('approved', { approver: 'owner', approverName: 'owner', decidedAt: 2 }) })], 'deny'],
  ['no gates: a viewer can’t decide a sign-off nobody asked them for', 'view1', TEAM, [upd('tasks/t_wait', { stage: 'build', signoff: signoff('approved', { approver: 'view1', approverName: 'view1', decidedAt: 2 }) })], 'deny'],
  ['no gates: the team owner decides it', 'owner', TEAM, [upd('tasks/t_wait', { stage: 'build', signoff: signoff('approved', { approver: 'owner', approverName: 'owner', decidedAt: 2 }) })], 'allow'],
  ['gate: the sign-off person (a viewer lead) approves a task they can’t otherwise edit, with a history line', 'view1', GATE, [upd('tasks/g_wait', { stage: 'build', history: [{ time: 't', user: 'view1', field: 'Sign-off', original: 'Review', updated: 'Approved' }, ...H], signoff: approved('review', 'view1') })], 'allow'],
  ['…or asks for changes, with a note', 'view1', GATE, [upd('tasks/g_wait', { signoff: signoff('changes', { approver: 'view1', approverName: 'view1', note: 'Add the mass budget', decidedAt: 2 }) })], 'allow'],
  ['…but can’t change anything else at the same time', 'view1', GATE, [upd('tasks/g_wait', { name: 'Renamed', signoff: approved('review', 'view1') })], 'deny'],
  ['…nor rewrite the task’s history', 'view1', GATE, [upd('tasks/g_wait', { stage: 'build', history: [{ time: 't', user: 'view1', field: 'Sign-off', original: 'Review', updated: 'Approved' }], signoff: approved('review', 'view1') })], 'deny'],
  ['a decision needs a waiting request', 'view1', GATE, [upd('tasks/t_mem1', { signoff: signoff('approved', { approver: 'view1', approverName: 'view1', decidedAt: 2 }) })], 'deny'],
  ['a stranger can’t record a decision', 'evil', TEAM, [upd('tasks/t_wait', { signoff: signoff('approved', { approver: 'evil', approverName: 'evil', decidedAt: 2 }) })], 'deny'],
  ['a sign-off note is at most 500 characters', 'view1', TEAM, [upd('tasks/t_wait', { signoff: signoff('changes', { approver: 'view1', note: 'x'.repeat(501), decidedAt: 2 }) })], 'deny'],
  // SelfTrack: private to its owner
  ['I save a SelfTrack task of my own', 'mem1', TEAM, [set('/selfItems/s_new', selfTask('mem1'))], 'allow'],
  ['I save a habit with its check-ins', 'mem1', TEAM, [set('/selfItems/s_h', { uid: 'mem1', kind: 'habit', title: 'Gym', area: '', goal: 3, color: '', archived: false, log: ['2026-10-20', '2026-10-21'], createdAt: 1, updatedAt: 1 })], 'allow'],
  ['nobody saves a SelfTrack item for someone else', 'evil', TEAM, [set('/selfItems/s_x', selfTask('owner'))], 'deny'],
  ['nobody overwrites someone else’s SelfTrack item', 'evil', TEAM, [set('/selfItems/s_owner', selfTask('evil'))], 'deny'],
  ['nobody deletes someone else’s SelfTrack item', 'evil', TEAM, [del('/selfItems/s_owner')], 'deny'],
  ['I delete my own SelfTrack item', 'owner', TEAM, [del('/selfItems/s_owner')], 'allow'],
  ['SelfTrack items cannot carry unexpected fields', 'mem1', TEAM, [set('/selfItems/s_new', { ...selfTask('mem1'), hack: true })], 'deny'],
  ['a SelfTrack title is at most 300 characters', 'mem1', TEAM, [set('/selfItems/s_new', selfTask('mem1', { title: 'x'.repeat(301) }))], 'deny'],
  ['a SelfTrack item has a known kind', 'mem1', TEAM, [set('/selfItems/s_new', selfTask('mem1', { kind: 'secret' }))], 'deny'],
  // Audit trail (Penteint Projects): only the server writes it — not even the owner can add, change or remove an entry
  ['the owner cannot add an audit entry', 'owner', TEAM, [set('audit/a2', { seq: 2, at: 2, hash: 'h2', prevHash: 'h1' })], 'deny'],
  ['the owner cannot change an audit entry', 'owner', TEAM, [upd('audit/a1', { actor: { type: 'person', uid: 'owner', name: 'owner' } })], 'deny'],
  ['an admin cannot delete an audit entry', 'admin1', TEAM, [del('audit/a1')], 'deny'],
  ['nobody moves the audit chain head', 'owner', TEAM, [set('private/auditHead', { seq: 0, hash: '', at: 0 })], 'deny'],
];

// [name, user, what, expected] — what: 'team' | 'tasks' (read of the team doc / tasks)
export const readScenarios = [
  ['a non-member cannot read the team', 'evil', 'team', 'deny'],
  ['a member reads the team', 'view1', 'team', 'allow'],
  ['a member reads the tasks', 'view1', 'tasks', 'allow'],
  ['a signed-out visitor cannot read anything', null, 'team', 'deny'],
  ['the owner reads the audit trail', 'owner', 'audit', 'allow'],
  ['an admin reads the audit trail', 'admin1', 'audit', 'allow'],
  ['a member cannot read the audit trail', 'mem1', 'audit', 'deny'],
  ['a viewer cannot read the audit trail', 'view1', 'audit', 'deny'],
  ['a non-member cannot read the audit trail', 'evil', 'audit', 'deny'],
];
