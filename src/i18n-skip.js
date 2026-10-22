// What the translator never touches: things people typed (task names, comments, notes…), names,
// code, and anything marked translate="no" or data-no-i18n. Shared by i18n.js and the collector.
export const SKIP_SELECTOR = [
  '[translate="no"]', '[data-no-i18n]', '[contenteditable="true"]', 'code', 'pre', 'kbd',
  // the board: what people wrote and who they are
  '.card-title', '.card-status', '.jira-badge', '.cat-name', '.node-cat > span', '.node-person > span', '.node-person .p-name', '.user-display', '.team-switch', '.week-title', '.metric-badge',
  '.kb-title', '.kb-card .kb-name', '.gantt-label', '.gt-name', '.so-name', '.pa-card .so-name', '.rq-card .so-name', '.subtask-title', '.st-title', '.cf-chip b',
  // comments, activity, notebook, meetings, research tables, whiteboards
  '.cm-text', '.comment-body', '.act-quote', '.act-main b', '.nb-text', '.nb-entry-text', '.mt-notes', '.rs-table td', '.wb-text', '.wb-item .wb-title',
  // people and teams
  '.avatar', '.pr-who b', '.team-tile b', '.team-name', '.brand-name', '.ftr-logo', '.mt-title', '.mytasks .mt-name', '.home-task-name',
  // GitHub and links
  '.gh-chip-txt', '.gh-ref', '.att-item a', '.ftr-lang select',
].join(',');
