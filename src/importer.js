// ─────────────────────────────────────────────────────────────────────────────
//  Import tasks from: Excel / CSV tables (incl. Asana, ClickUp, Monday.com,
//  Microsoft Planner, Notion and Google Sheets exports), Jira (CSV export), Trello (JSON
//  export), the old single-user tracker (JSON backup or its Excel file), the
//  analytics export, or a Google collection sheet. Rows are previewed first;
//  nothing changes until you confirm.
// ─────────────────────────────────────────────────────────────────────────────
import { el, toast, modal, pickFile } from './ui.js';

const PRIORITY_WORDS = { minor: 'Minor', low: 'Minor', lowest: 'Minor', trivial: 'Minor', p3: 'Minor', p4: 'Minor', p5: 'Minor', major: 'Major', medium: 'Major', normal: 'Major', p2: 'Major', critical: 'Critical', high: 'Critical', p1: 'Critical', blocker: 'Blocker', urgent: 'Blocker', highest: 'Blocker', p0: 'Blocker' };
const ALIASES = {
  owner: ['owner', 'owner email', 'owner (email or name)', 'person', 'assignee', 'assignee email', 'assigned to', 'assignees', 'team member', 'member', 'email', 'people', 'responsible'],
  task: ['task', 'title', 'task title', 'task name', 'name', 'summary', 'item', 'item name', 'card name'],
  category: ['category', 'type', 'workstream', 'area', 'group', 'epic', 'epic link', 'epic name', 'parent summary', 'component/s', 'components', 'issue type', 'list', 'section', 'section/column', 'column', 'bucket', 'bucket name', 'project', 'projects', 'folder', 'board', 'labels', 'tags'],
  week: ['week', 'sprint', 'week (title or monday date yyyy-mm-dd)'],
  weekStart: ['week start', 'week starting', 'week start date'],
  priority: ['priority'],
  deadline: ['deadline', 'due', 'due date', 'due on', 'end date', 'date', 'timeline end', 'deadline (yyyy-mm-dd)'],
  status: ['status', 'status badge', 'progress', 'stage'],
  flag: ['flag', 'state'],
  ref: ['reference', 'reference id', 'jira', 'jira id', 'jira case id', 'ref', 'ticket', 'issue key', 'key'],
  completedOn: ['completed on', 'completed at', 'completed date', 'date completed', 'done date', 'resolved', 'resolution date'],
  imported: ['imported?', 'imported', 'imported? (leave blank)'],
};

// ── Parsing ─────────────────────────────────────────────────────────────────
function excelDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && window.XLSX) { const d = window.XLSX.SSF.parse_date_code(v); if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // Jira: 18/Oct/26 2:03 PM
  m = s.match(/^(\d{1,2})[/ -]([A-Za-z]{3})[a-z]*[/ -](\d{2,4})\b/);
  if (m) { const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase()); if (mo >= 0) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; } }
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; } // UK day/month/year
  const d = new Date(s); return isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const normPriority = (v) => PRIORITY_WORDS[String(v || '').trim().toLowerCase()] || 'Minor';
function normFlag(v) {
  const s = String(v || '').toLowerCase();
  if (/complete|done|finish|closed|✓/.test(s)) return 'completed';
  if (/pending|waiting|hold/.test(s)) return 'pending';
  if (/backlog/.test(s)) return 'backlog';
  return 'none';
}

/** Turn a 2-D array (first row = headers) into import rows. */
export function rowsFromTable(table, TT) {
  const headerIdx = table.findIndex(r => (r || []).some(c => ALIASES.task.includes(String(c || '').trim().toLowerCase())));
  if (headerIdx < 0) throw new Error('No “Task” column found. The first row should have headers like Owner, Category, Week, Task, Priority, Deadline.');
  const headers = table[headerIdx].map(h => String(h || '').trim());
  const lower = headers.map(h => h.toLowerCase());
  // Labels the team renamed (e.g. "Module code" for the reference ID) count too.
  const extra = { ref: [TT.label('jiraId').label.toLowerCase()], status: [TT.label('status').label.toLowerCase()] };
  const col = {};
  // Each kind of value can come from several columns, in alias order (e.g. Jira's "Epic Link",
  // then "Issue Type"); the first one that isn't blank in a row is used.
  Object.entries(ALIASES).forEach(([k, names]) => { const idx = []; names.concat(extra[k] || []).forEach(a => lower.forEach((h, i) => { if (h === a && !idx.includes(i)) idx.push(i); })); if (idx.length) col[k] = idx; });
  if (col.owner === undefined) { const i = lower.indexOf('team member'); if (i >= 0) col.owner = [i]; }
  const fieldCols = (TT.team.fields || []).map(f => [f, lower.indexOf(f.name.toLowerCase())]).filter(([, i]) => i >= 0);
  const out = [];
  table.slice(headerIdx + 1).forEach((r, n) => {
    if (!r || r.every(c => c === null || c === undefined || String(c).trim() === '')) return;
    const get = (k) => { if (!col[k]) return ''; for (const i of col[k]) { const v = r[i]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return ''; };
    out.push({
      sourceRow: headerIdx + 2 + n,
      owner: String(get('owner') || '').trim(), task: String(get('task') || '').trim(), category: String(get('category') || '').trim(),
      week: typeof get('week') === 'number' ? excelDate(get('week')) : String(get('week') || '').trim(),
      weekStart: excelDate(get('weekStart')), priority: normPriority(get('priority')), deadline: excelDate(get('deadline')),
      status: String(get('status') || '').trim().slice(0, 60), ref: String(get('ref') || '').trim().slice(0, 80),
      flag: normFlag(get('flag') || get('status')), completedOn: excelDate(get('completedOn')),
      imported: String(get('imported') || '').trim(),
      custom: Object.fromEntries(fieldCols.map(([f, i]) => [f.name, r[i]]).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')),
    });
  });
  return out;
}

/** Rows from a Trello board export (Board menu ▸ Print, export and share ▸ Export as JSON). */
export function rowsFromTrello(board) {
  const lists = new Map((board.lists || []).map(l => [l.id, l]));
  const members = new Map((board.members || []).map(m => [m.id, m.fullName || m.username || '']));
  const checklists = new Map((board.checklists || []).map(c => [c.id, c]));
  const labels = new Map((board.labels || []).map(l => [l.id, l.name || l.color || '']));
  const rows = [];
  (board.cards || []).forEach((c, n) => {
    const list = lists.get(c.idList);
    if (c.closed || (list && list.closed)) return;   // archived
    const listName = (list && list.name) || '';
    const who = (c.idMembers || []).map(id => members.get(id)).filter(Boolean);
    const lab = (c.idLabels || []).map(id => labels.get(id)).filter(Boolean);
    const flag = c.dueComplete ? 'completed' : normFlag(listName);
    rows.push({
      sourceRow: 'card ' + (c.idShort || n + 1),
      owner: who[0] || '', supporting: who.slice(1, 3), task: String(c.name || '').trim(), category: lab[0] || board.name || 'TRELLO',
      week: '', weekStart: '', priority: normPriority(lab.find(l => PRIORITY_WORDS[String(l).toLowerCase()]) || ''),
      deadline: c.due ? excelDate(c.due) : '', status: listName.slice(0, 60), ref: c.idShort ? 'Trello #' + c.idShort : '',
      flag, completedOn: flag === 'completed' && c.dateLastActivity ? excelDate(c.dateLastActivity) : '',
      subtasks: (c.idChecklists || []).flatMap(id => ((checklists.get(id) || {}).checkItems || []).slice().sort((a, b) => (a.pos || 0) - (b.pos || 0)).map(i => ({ title: i.name, completed: i.state === 'complete' }))),
      links: c.shortUrl || c.url ? [{ name: 'Trello card', url: c.shortUrl || c.url }] : [],
      custom: {},
    });
  });
  return rows;
}

/** Rows from the old single-user tracker's data ({ weeksData, db }). Keeps sub-tasks, history and supporters. */
export function rowsFromOldTracker(parsed) {
  const clean = window.normalizeData(parsed);
  const names = new Map(clean.db.map(p => [p.id, p.name]));
  const rows = [];
  clean.db.forEach(p => p.categories.forEach(c => clean.weeksData.forEach(w => (c[w.key] || []).forEach(t => rows.push({
    owner: p.name, task: t.name, category: c.name, week: w.title, weekStart: w.startDate || '', metric: w.metric || '',
    priority: t.priority, flag: t.flag, status: t.status, ref: t.jiraId, deadline: t.dueDate, completedOn: t.completedDate,
    subtasks: t.subtasks, history: t.history, supporting: [t.supportPersonId, t.supportPersonId2].filter(Boolean).map(id => names.get(id)).filter(Boolean), custom: {},
  })))));
  return { rows, weekOrder: clean.weeksData.map(w => ({ title: w.title, startDate: w.startDate || '', metric: w.metric || '' })) };
}

async function parseFile(file, TT) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) {
    const parsed = JSON.parse(await file.text());
    if (parsed && Array.isArray(parsed.weeksData) && Array.isArray(parsed.db)) return { kind: 'old tracker backup', ...rowsFromOldTracker(parsed) };
    if (parsed && Array.isArray(parsed.cards) && Array.isArray(parsed.lists)) return { kind: 'Trello board “' + (parsed.name || 'board') + '”', rows: rowsFromTrello(parsed) };
    throw new Error('This JSON file isn’t a tracker backup or a Trello board export.');
  }
  if (file.size > 12 * 1024 * 1024) throw new Error('That file is larger than 12 MB — split it or export a smaller range first.');
  try { await window.ensureXLSX(); } catch { throw new Error('Couldn’t load the spreadsheet reader. Check your connection and try again.'); }
  // CSV: keep cells as text, so "03/04/2026" stays 3 April (our own day/month/year reading) instead of the
  // spreadsheet reader turning it into 4 March the American way (while 27/10/2026 came in right).
  const csv = /\.(csv|tsv|txt)$/i.test(file.name || '') || /^text\//.test(file.type || '');
  const wb = window.XLSX.read(new Uint8Array(await file.arrayBuffer()), csv ? { type: 'array', raw: true } : { type: 'array' });
  if (wb.Sheets['Database_DO_NOT_EDIT']) {
    const sh = wb.Sheets['Database_DO_NOT_EDIT']; let json = ''; for (let r = 2; sh['A' + r]; r++) json += sh['A' + r].v || '';
    return { kind: 'old tracker Excel file', ...rowsFromOldTracker(JSON.parse(json)) };
  }
  const sheetName = wb.SheetNames.find(n => /^tasks( to add)?$/i.test(n)) || wb.SheetNames.find(n => n !== 'Summary' && n !== 'Tracker View') || wb.SheetNames[0];
  const table = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
  const rows = rowsFromTable(table, TT);
  const head = (table.find(r => (r || []).some(c => /^(summary|task|title)$/i.test(String(c || '').trim()))) || []).map(c => String(c || '').toLowerCase());
  const jira = head.includes('issue key') && head.includes('summary');
  return { kind: jira ? 'Jira export' : 'table (' + sheetName + ')', rows };
}

// ── Applying rows to the board model ────────────────────────────────────────
/**
 * Add rows to `model` (the board's { weeksData, db }). Pass a copy for a dry run.
 * Returns { added, createdWeeks, createdCats, skipped: [{row, reason}], unmatched: Set }.
 */
export function applyRows(model, rows, TT, { weekOrder } = {}) {
  const res = { added: 0, createdWeeks: 0, createdCats: 0, skipped: [], unmatched: new Set(), addedRows: [] };
  const people = model.db.filter(p => !p.former);
  const me = people.find(p => p.id === TT.me.uid);
  const byEmail = new Map(TT.members.map(mm => [mm.email, mm.uid]));
  const findPerson = (owner) => {
    const o = String(owner || '').trim().toLowerCase(); if (!o) return null;
    const uid = byEmail.get(o); if (uid) return people.find(p => p.id === uid) || null;
    return people.find(p => p.name.toLowerCase() === o) || null;
  };
  const gid = () => window.generateId();
  const makeWeek = (title, startDate, metric) => {
    const key = 'wk_' + gid().slice(3);
    model.weeksData.push({ key, title: (title || 'IMPORTED').slice(0, 120), metric: metric || '', collapsed: false, startDate: startDate || '' });
    model.db.forEach(p => p.categories.forEach(c => { c[key] = []; }));
    res.createdWeeks++; return model.weeksData[model.weeksData.length - 1];
  };
  const findWeek = (title, start) => {
    const t = String(title || '').trim().toLowerCase();
    let w = model.weeksData.find(x => t && x.title.toLowerCase() === t);
    if (!w && start) w = model.weeksData.find(x => x.startDate === start);
    if (!w && /^\d{4}-\d{2}-\d{2}$/.test(title)) w = model.weeksData.find(x => x.startDate && window.daysBetweenISO(x.startDate, title) >= 0 && window.daysBetweenISO(x.startDate, title) <= 6);
    return w;
  };
  // Old tracker: create its weeks in their original order first.
  (weekOrder || []).forEach(w => { if (!findWeek(w.title, w.startDate) && TT.can('weeks.manage')) makeWeek(w.title, w.startDate, w.metric); });
  const fieldByName = new Map((TT.team.fields || []).map(f => [f.name.toLowerCase(), f]));

  rows.forEach(row => {
    if (!row.task) { res.skipped.push({ row, reason: 'no task title' }); return; }
    let person = findPerson(row.owner); let catName = (row.category || 'GENERAL').slice(0, 80);
    if (!person) {
      if (row.owner) res.unmatched.add(row.owner);
      person = me; if (row.owner) catName = (row.owner + ' – ' + catName).slice(0, 80);
    }
    if (!person) { res.skipped.push({ row, reason: 'you have no row on this board' }); return; }
    if (!TT.canEditOwner(person.id)) { res.skipped.push({ row, reason: 'your role can’t add tasks for ' + person.name }); return; }
    let week = findWeek(row.week, row.weekStart);
    // No week given (Trello, Jira without sprints): the week that holds the deadline, else this week, else the latest.
    if (!week && !row.week && !row.weekStart) {
      const today = new Date(); const iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      const holding = (d) => d && model.weeksData.find(x => x.startDate && window.daysBetweenISO(x.startDate, d) >= 0 && window.daysBetweenISO(x.startDate, d) <= 6);
      week = holding(row.deadline) || holding(iso) || model.weeksData[model.weeksData.length - 1];
    }
    if (!week) {
      if (!TT.can('weeks.manage')) { res.skipped.push({ row, reason: 'week “' + (row.week || '?') + '” doesn’t exist' }); return; }
      const start = row.weekStart || (/^\d{4}-\d{2}-\d{2}$/.test(row.week) ? row.week : '');
      week = makeWeek(row.week && !/^\d{4}-\d{2}-\d{2}$/.test(row.week) ? row.week : (start ? 'WEEK ' + window.isoWeekOf(start) : 'IMPORTED'), start, row.metric);
    }
    let cat = person.categories.find(c => c.name.toLowerCase() === catName.toLowerCase());
    if (!cat) { cat = window.newCategory(catName); model.weeksData.forEach(w => { if (!cat[w.key]) cat[w.key] = []; }); person.categories.push(cat); res.createdCats++; }
    const support = (row.supporting || []).map(n => findPerson(n)).filter(p => p && p.id !== person.id).map(p => p.id);
    const custom = {};
    Object.entries(row.custom || {}).forEach(([k, v]) => { const f = fieldByName.get(k.toLowerCase()); if (f) { const val = window.cleanCustomInput(f, f.type === 'date' ? excelDate(v) : (f.type === 'checkbox' ? /^(true|yes|y|1|✓|x)$/i.test(String(v)) : String(v))); if (val !== '' && val !== null) custom[f.id] = val; } });
    const flag = row.flag || 'none';
    const task = {
      id: gid(), type: 'task', name: row.task.slice(0, 500), priority: row.priority || 'Minor', status: row.status || '', jiraId: row.ref || '',
      supportPersonId: support[0] || null, supportPersonId2: support[1] || null, flag,
      dueDate: row.deadline || '', completedDate: flag === 'completed' ? (row.completedOn || '') : '',
      subtasks: (row.subtasks || []).map(s => ({ id: gid(), title: String(s.title || '').slice(0, 300), completed: !!s.completed })),
      history: [{ time: window.getTimestamp(), user: TT.me.name, field: 'Imported', original: '', updated: row.sourceRow ? 'row ' + row.sourceRow : 'from file' }].concat((row.history || []).slice(0, 98)),
      custom, icon: '',
      attachments: (row.links || []).map(l => ({ id: gid(), provider: /github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(l.url) ? 'github' : 'link', name: String(l.name || l.url).slice(0, 200), url: l.url, size: 0, addedBy: TT.me.name, addedAt: Date.now() })),
    };
    cat[week.key].push(task); res.added++; res.addedRows.push(row);
  });
  return res;
}

// ── UI ──────────────────────────────────────────────────────────────────────
/** Import window: what files work, a ready-made template, then pick or drop a file. */
export function importFromFile(TT) {
  const m = modal('📥 Import tasks', { narrow: true });
  const go = async (file) => { if (!file) return; m.close(); await importFile(TT, file); };
  const choose = el('button.btn.primary', { type: 'button', id: 'imp-choose', onclick: async () => go(await pickFile('.xlsx,.xls,.csv,.json')) }, 'Choose a file…');
  const drop = el('div.imp-drop', { id: 'imp-drop' }, el('div', {}, el('b', {}, 'Drop a file here'), ' or ', choose), el('div.hint', {}, 'Excel (.xlsx), CSV or JSON. You see a preview first; nothing changes until you confirm, and Ctrl+Z undoes it.'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); go(e.dataTransfer.files && e.dataTransfer.files[0]); });
  m.body.append(drop,
    el('h4', {}, 'What you can bring in'),
    el('ul.imp-list', {},
      el('li', {}, el('b', {}, 'A spreadsheet'), ' (Excel or CSV): one row per task. Columns it understands: Task, Owner (email or name), Category, Week, Deadline, Priority, Status. Other column names like “Assignee”, “Due date” or “Summary” work too. ',
        el('button.link-btn', { type: 'button', id: 'imp-template', onclick: () => downloadTemplate(TT) }, 'Download a template')),
      el('li', {}, el('b', {}, 'Trello'), ': open the board ▸ Menu ▸ Print, export and share ▸ Export as JSON. Lists become categories.'),
      el('li', {}, el('b', {}, 'Jira'), ': Filters ▸ Export ▸ CSV (all fields).'),
      el('li', {}, el('b', {}, 'Asana, ClickUp, Monday.com, Microsoft Planner or Notion'), ': export the project or board as CSV or Excel and drop it here. Sections, columns, buckets or tags become categories; assignees become owners (matched by email or name).'),
      el('li', {}, el('b', {}, 'A Trawpie backup'), ' (.json) or the old single-user tracker’s Excel file.')));
  m.foot.append(el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Cancel'));
}

/** An Excel file with the columns the importer reads, and two example rows from this team. */
async function downloadTemplate(TT) {
  try { await window.ensureXLSX(); } catch { return toast('Couldn’t load the spreadsheet tools. Check your connection and try again.'); }
  const X = window.XLSX;
  const people = (TT.members || []).slice(0, 2).map(m => m.email || m.name);
  const today = new Date(); const iso = (d) => d.toLocaleDateString('en-CA'); const inDays = (n) => iso(new Date(today.getTime() + n * 864e5));
  const rows = [
    ['Task', 'Owner (email or name)', 'Category', 'Week', 'Deadline (YYYY-MM-DD)', 'Priority', 'Status'],
    ['Design the landing gear mount', people[0] || 'name@uni.ac.uk', 'Design', '', inDays(5), 'Major', 'In progress'],
    ['Order four ESCs', people[1] || people[0] || 'name@uni.ac.uk', 'Parts', '', inDays(10), 'Minor', ''],
  ];
  const ws = X.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 34 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 14 }];
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Tasks');
  X.writeFile(wb, 'Trawpie-import-template.xlsx');
  toast('Template downloaded: fill it in, then drop it here. Leave Week empty and each task goes into the week of its deadline (or this week).', 7000);
}

export async function importFile(TT, file) {
  let parsed;
  try { parsed = await parseFile(file, TT); } catch (e) { toast('Couldn’t read “' + file.name + '”: ' + e.message, 7000); return; }
  return previewAndApply(TT, parsed.rows, { title: 'Import from ' + file.name, kind: parsed.kind, weekOrder: parsed.weekOrder });
}

/** Shows a preview; resolves with the rows actually imported (or null if cancelled). */
export function previewAndApply(TT, rows, { title, kind, weekOrder } = {}) {
  return new Promise(resolve => {
    const dry = applyRows(structuredClone(window.boardGetModel()), rows, TT, { weekOrder });
    const m = modal(title || 'Import tasks', { narrow: true, onClose: () => resolve(null) });
    const list = el('ul', { style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '13px', lineHeight: '1.6' } });
    list.append(el('li', {}, el('b', {}, dry.added), ` task${dry.added === 1 ? '' : 's'} will be added`));
    if (dry.createdWeeks) list.append(el('li', {}, `${dry.createdWeeks} new week${dry.createdWeeks === 1 ? '' : 's'}`));
    if (dry.createdCats) list.append(el('li', {}, `${dry.createdCats} new categor${dry.createdCats === 1 ? 'y' : 'ies'}`));
    if (dry.unmatched.size) list.append(el('li', {}, 'Not in this team (their tasks go into your rows, named after them): ', [...dry.unmatched].slice(0, 8).join(', '), dry.unmatched.size > 8 ? '…' : ''));
    if (dry.skipped.length) {
      const reasons = {}; dry.skipped.forEach(s => { reasons[s.reason] = (reasons[s.reason] || 0) + 1; });
      list.append(el('li', {}, `${dry.skipped.length} skipped: `, Object.entries(reasons).map(([r, n]) => `${n} × ${r}`).join('; ')));
    }
    m.body.append(el('p.hint', {}, 'Read as: ' + (kind || 'table') + '. Nothing changes until you click Import. You can undo it afterwards with Ctrl+Z.'), list);
    const go = el('button.btn.primary', { type: 'button', disabled: !dry.added }, 'Import ' + dry.added + ' task' + (dry.added === 1 ? '' : 's'));
    go.addEventListener('click', () => {
      const model = window.boardGetModel();
      const res = applyRows(model, rows, TT, { weekOrder });
      window.boardCommit('import-' + Date.now());
      toast(`Imported ${res.added} task${res.added === 1 ? '' : 's'}.`, 5000, 'Undo', () => TT.undo());
      m.close(); resolve(res.addedRows);
    });
    m.foot.append(el('button.btn', { type: 'button', onclick: m.close }, 'Cancel'), go);
  });
}
