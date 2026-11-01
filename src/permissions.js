// ─────────────────────────────────────────────────────────────────────────────
//  Roles & permissions. This file is the single source of truth for the UI and
//  the demo backend. firestore.rules implements the SAME logic for production —
//  if you change something here, change it there too (tests/rules.test.mjs
//  checks the two agree).
// ─────────────────────────────────────────────────────────────────────────────

export const PERMISSIONS = [
  { key: 'tasks.editOwn',   label: 'Edit own tasks',        help: 'Create, edit and delete tasks in their own rows' },
  { key: 'tasks.editAll',   label: 'Edit everyone’s tasks', help: 'Create, edit, move and delete any task' },
  { key: 'weeks.manage',    label: 'Manage weeks',          help: 'Add, rename, date and delete weeks' },
  { key: 'analytics.view',  label: 'View analytics',        help: 'Open the analytics dashboard and timeline' },
  { key: 'data.export',     label: 'Export & AI summary',   help: 'Excel / Google Sheets export, backups, Copy-for-AI' },
  { key: 'members.manage',  label: 'Manage members',        help: 'Invite, remove and change members’ roles' },
  { key: 'team.settings',   label: 'Team settings',         help: 'Team name, logo, custom fields and labels' },
  { key: 'roles.manage',    label: 'Manage roles',          help: 'Create and edit roles and their permissions' },
  { key: 'finance.view',    label: 'See finances',          help: 'See the budget, spending and income' },
  { key: 'finance.edit',    label: 'Manage finances',       help: 'Set the budget and record spending and income' },
  { key: 'audit.view',      label: 'See the audit trail',   help: 'Read and export the server’s record of every change, and check it hasn’t been tampered with' },
];
export const PERM_KEYS = PERMISSIONS.map(p => p.key);

const all = Object.fromEntries(PERM_KEYS.map(k => [k, true]));
const only = (...keys) => Object.fromEntries(PERM_KEYS.map(k => [k, keys.includes(k)]));

export const DEFAULT_ROLES = {
  owner:  { name: 'Owner',  builtin: true, order: 0, perms: all },
  admin:  { name: 'Admin',  builtin: true, order: 1, perms: only('tasks.editOwn', 'tasks.editAll', 'weeks.manage', 'analytics.view', 'data.export', 'members.manage', 'team.settings', 'finance.view', 'finance.edit', 'audit.view') },
  member: { name: 'Member', builtin: true, order: 2, perms: only('tasks.editOwn', 'weeks.manage', 'analytics.view', 'data.export') },
  viewer: { name: 'Viewer', builtin: true, order: 3, perms: only('analytics.view') },
  // Someone from outside the team (a supplier, supervisor, another team): works on the tasks
  // given to them and comments, but sees no analytics, money or exports.
  guest:  { name: 'Guest',  builtin: true, order: 4, perms: only('tasks.editOwn') },
};
export const GUEST_HELP = 'Guests see the board, work on the tasks given to them and comment. They can’t see analytics or money, export data, or change the team.';

/** Does this member have permission `perm` in `team`? The owner role always does. */
export function can(team, member, perm) {
  if (!team || !member) return false;
  if (member.roleId === 'owner') return true;
  const role = team.roles && team.roles[member.roleId];
  return !!(role && role.perms && role.perms[perm] === true);
}

/** May this member create/edit/delete an entity (task or category) owned by `ownerUid`? */
export function canEditOwnedBy(team, member, ownerUid) {
  if (can(team, member, 'tasks.editAll')) return true;
  return can(team, member, 'tasks.editOwn') && !!member && ownerUid === member.uid;
}

export function roleList(team) {
  return Object.entries((team && team.roles) || {})
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
}

export function normEmail(e) { return String(e || '').trim().toLowerCase(); }
export function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normEmail(e)); }

/** Deleting a task needs someone who edits everyone's tasks to approve it, unless you could
 *  edit everyone's anyway, or it's your own task made in the last day (an undo for mistakes). */
export function deleteNeedsApproval(team, member, task, now = Date.now()) {
  if (!member || can(team, member, 'tasks.editAll')) return false;
  if (!task || !task.createdAt) return false;   // not saved yet
  return !(task.createdBy === member.uid && task.createdAt > now - 86400000);
}
