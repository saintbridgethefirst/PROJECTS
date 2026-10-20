// Google Sheets: export the board, and a shared "task collection" sheet that
// teammates fill in and the leader imports.
import { el, toast, modal, friendlyError } from '../ui.js';
import { APP_NAME } from '../config.js';
import { createSpreadsheet, writeSheets, readSheet, spreadsheetUrl, shareDriveFile } from './google.js';

const key = (TT, kind) => `tt_sheet_${kind}_${TT.teamId}_${TT.me.uid}`;
const getId = (TT, kind) => { try { return localStorage.getItem(key(TT, kind)); } catch { return null; } };
const setId = (TT, kind, v) => { try { v ? localStorage.setItem(key(TT, kind), v) : localStorage.removeItem(key(TT, kind)); } catch { /* */ } };

function taskTable(TT) {
  const fields = TT.team.fields || [];
  const head = ['Team member', 'Category', 'Week', 'Week start', 'Task', 'Priority', TT.label('status').label, 'Flag', TT.label('jiraId').label, 'Deadline', 'Days to deadline', 'Overdue', 'Completed on', 'Sub-tasks done', 'Sub-tasks total', 'Supporting', 'Files', ...fields.map(f => f.name)];
  const rows = window.boardRows({}).map(r => [r.person, r.category, r.week, r.weekStart, r.task, r.priority, r.status, r.flag, r.ref, r.deadline, r.daysToDeadline ?? '', r.overdue ? 'YES' : '', r.completedOn,
    r.subtasks.filter(s => s.done).length, r.subtasks.length, r.supporting.join(', '), r.files.map(f => f.url).join('\n'), ...fields.map(f => r.custom[f.name] ?? '')]);
  return [head, ...rows];
}

export async function exportToSheets(TT) {
  if (!TT.can('data.export')) return toast('Your role can’t export data.');
  toast('Exporting to Google Sheets…', 2500);
  try {
    const k = window.boardKpis({});
    const summary = [['Metric', 'Value'], ['Team', TT.team.name], ['Exported', new Date().toLocaleString()], ['Total tasks', k.total], ['Completed', k.completed], ['Completion %', k.pct], ['Overdue', k.overdue], ['Due in 7 days', k.dueWeek], ['Open Blocker/Critical', k.risk]];
    let id = getId(TT, 'export'); let url;
    if (id) {
      try { await writeSheets(id, [['Summary!A1', summary], ['Tasks!A1', taskTable(TT)]], ['Summary', 'Tasks']); url = await spreadsheetUrl(id); }
      catch (e) { if (e.status === 404 || e.status === 403 || e.status === 400) id = null; else throw e; }
    }
    if (!id) {
      const s = await createSpreadsheet(`${TT.team.name} – ${APP_NAME} export`, ['Summary', 'Tasks']);
      id = s.id; url = s.url; setId(TT, 'export', id);
      await writeSheets(id, [['Summary!A1', summary], ['Tasks!A1', taskTable(TT)]]);
    }
    toast('Google Sheet updated.', 9000, 'Open sheet', () => window.open(url, '_blank', 'noopener'));
  } catch (e) { toast(friendlyError(e), 7000); }
}

/** Shared sheet: the leader creates it, teammates add rows, the leader imports new rows. */
export function openCollectionSheet(TT) {
  const m = modal('Task collection sheet', { narrow: true });
  const render = () => {
    m.body.replaceChildren(); m.foot.replaceChildren();
    const id = getId(TT, 'collect');
    m.body.append(el('p.hint', {}, 'Create a Google Sheet that everyone in the team can edit. People add one row per task (owner, week, task, deadline…). When you’re ready, import the new rows here — each imported row is marked so it’s never added twice.'));
    if (!id) {
      m.foot.append(el('button.btn', { type: 'button', onclick: m.close }, 'Close'), el('button.btn.primary', { type: 'button', onclick: create }, 'Create sheet'));
    } else {
      m.body.append(el('div.banner.info', {}, 'Your collection sheet is ready.'));
      m.foot.append(
        el('button.btn.ghost', { type: 'button', onclick: () => { if (confirm('Stop using this sheet here? The sheet itself stays in your Drive.')) { setId(TT, 'collect', null); render(); } } }, 'Forget sheet'),
        el('span.spacer'),
        el('button.btn', { type: 'button', onclick: async () => { try { window.open(await spreadsheetUrl(id), '_blank', 'noopener'); } catch (e) { toast(friendlyError(e)); } } }, 'Open sheet'),
        el('button.btn.primary', { type: 'button', onclick: () => importNew(id) }, 'Import new rows'));
    }
  };
  async function create() {
    try {
      const fields = TT.team.fields || [];
      const head = ['Owner (email or name)', 'Category', 'Week (title or Monday date YYYY-MM-DD)', 'Task', 'Priority', 'Deadline (YYYY-MM-DD)', TT.label('status').label, TT.label('jiraId').label, ...fields.map(f => f.name), 'Imported? (leave blank)'];
      const s = await createSpreadsheet(`${TT.team.name} – tasks to add`, ['Tasks to add', 'How to use']);
      const help = [['How to use this sheet'], ['Add one row per task on “Tasks to add”. Leave the last column blank — it is filled in when the task is imported.'], [''],
        ['Owner: use a team member’s email (best) or their name as shown below.'], ['Priority: Minor, Major, Critical or Blocker.'], ['Week: a week title from the board, or the Monday date of the week.'], [''],
        ['Team members', 'Email'], ...TT.members.map(x => [x.name, x.email]), [''], ['Weeks on the board', 'Starts'], ...window.boardGetModel().weeksData.map(w => [w.title, w.startDate || ''])];
      await writeSheets(s.id, [['Tasks to add!A1', [head]], ['How to use!A1', help]]);
      const failed = await shareDriveFile(s.id, TT.members.filter(x => x.uid !== TT.me.uid).map(x => x.email), 'writer');
      setId(TT, 'collect', s.id);
      toast('Sheet created and shared with the team.' + (failed.length ? ' Couldn’t share with: ' + failed.join(', ') : ''), 8000, 'Open sheet', () => window.open(s.url, '_blank', 'noopener'));
      render();
    } catch (e) { toast(friendlyError(e), 7000); }
  }
  async function importNew(id) {
    try {
      const { rowsFromTable, previewAndApply } = await import('../importer.js');
      const table = await readSheet(id, 'Tasks to add!A1:AZ2000');
      const fresh = rowsFromTable(table, TT).filter(r => !r.imported && r.task);
      if (!fresh.length) return toast('No new rows to import.');
      const done = await previewAndApply(TT, fresh, { title: 'Import from collection sheet', kind: 'Google Sheet' });
      if (!done || !done.length) return;
      const lastCol = colName(table[0].length - 1);
      const stamp = 'Imported ' + new Date().toISOString().slice(0, 10) + ' by ' + TT.me.name;
      await writeSheets(id, done.map(r => [`Tasks to add!${lastCol}${r.sourceRow}`, [[stamp]]]));
      m.close();
    } catch (e) { toast(friendlyError(e), 7000); }
  }
  render();
}
function colName(i) { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
