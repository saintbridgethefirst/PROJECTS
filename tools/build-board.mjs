// Builds public/board/board.js from the tested single-user v13 board (ref/v13.js)
// plus the multi-user layer (tools/board-overrides.js).
//   node tools/build-board.mjs
// Uses a real JavaScript parser so removals/renames are exact.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as acorn from 'acorn';

let src = fs.readFileSync(new URL('../ref/v13.js', import.meta.url), 'utf8');
const overrides = fs.readFileSync(new URL('./board-overrides.js', import.meta.url), 'utf8');

// 1) Text patches inside code we keep (each must match exactly once).
const patches = [
  // Configurable labels on cards
  ["let flagBadge = ''; let jiraBadge = task.jiraId && !task.isGhost ?",
   "let flagBadge = ''; let jiraBadge = task.jiraId && !task.isGhost && TT.label('jiraId').show ?"],
  ['<div class="card-status">${esc(task.status)}</div>',
   "${TT.label('status').show && task.status ? `<div class=\"card-status\">${esc(task.status)}</div>` : ''}"],
  // Configurable labels in the editor
  ['<label>Status Badge</label><input type="text" id="edit-status" value="${esc(nodeData.status)}">',
   "${TT.label('status').show ? `<label>${esc(TT.label('status').label)}</label><input type=\"text\" id=\"edit-status\" value=\"${esc(nodeData.status)}\">` : ''}"],
  ['<label>Jira Case ID</label><input type="text" id="edit-jira" value="${esc(nodeData.jiraId || \'\')}" placeholder="e.g. NASHCPI-1944">',
   "${TT.label('jiraId').show ? `<label>${esc(TT.label('jiraId').label)}</label><input type=\"text\" id=\"edit-jira\" value=\"${esc(nodeData.jiraId || '')}\" placeholder=\"e.g. a ticket or document number\">` : ''}"],
  // Commit the typed value even if a teammate's update re-rendered the panel mid-typing
  ["logHistory(activeNode, fName === 'name' ? 'Title' : fName, e.target.dataset.original, e.target.value);",
   "activeNode[id === 'edit-jira' ? 'jiraId' : (id === 'edit-name' ? 'name' : 'status')] = e.target.value;\n                            logHistory(activeNode, fName === 'name' ? 'Title' : (fName === 'jira' ? TT.label('jiraId').label : (fName === 'status' ? TT.label('status').label : fName)), e.target.dataset.original, e.target.value);"],
  // Week metric: placeholder text, editable only with permission
  ['<div class="metric-badge" contenteditable="true" oninput="updateWeekField(${actualIndex}, \'metric\', this.innerText)">${esc(w.metric)}</div>',
   '<div class="metric-badge" ${TT.can(\'weeks.manage\') ? \'contenteditable="true"\' : \'\'} data-ph="${esc(TT.label(\'metric\').label)}" data-week="${actualIndex}" onkeydown="metricKey(event, this)" onblur="commitMetric(${actualIndex}, this)">${esc(w.metric)}</div>'],
  ['<input class="week-title" value="${esc(w.title)}" onchange=',
   '<input class="week-title" value="${esc(w.title)}" ${TT.can(\'weeks.manage\') ? \'\' : \'readonly\'} onchange='],
  ["weeksData.splice(afterIndex + 1, 0, { key, title: name, metric: 'Hi: 0.00',",
   "weeksData.splice(afterIndex + 1, 0, { key, title: name, metric: '',"],
  // Person rows show the member's account photo (falls back to the outline icon)
  ['pNode.innerHTML = `<div class="avatar-circle">',
   'pNode.innerHTML = `<div class="avatar-circle">${personPhotoHtml(person)}'],
  // Deadline: show an unambiguous date ("Wed 21 Oct 2026 · 3 days left") and open the browser's
  // calendar on click, instead of the native box whose mm/dd vs dd/mm order depends on the browser.
  ['<label>Deadline</label><input type="date" id="edit-due" value="${esc(nodeData.dueDate || \'\')}">',
   '<label>Deadline</label><div class="due-field"><button type="button" class="due-display${nodeData.dueDate ? \'\' : \' empty\'}" onclick="openDuePicker()" aria-label="Choose deadline">${dueDisplayHtml(nodeData)}</button><input type="date" id="edit-due" class="due-native" tabindex="-1" aria-hidden="true" value="${esc(nodeData.dueDate || \'\')}"></div>'],
  // Sub-task history entries that read clearly in the log
  ['logHistory(task, "Subtask Status", st.title, st.completed ? \'Completed\' : \'Pending\');',
   'logHistory(task, st.completed ? "Sub-task completed" : "Sub-task reopened", "", st.title);'],
  ['logHistory(task, "Subtask Added", "", title.trim());', 'logHistory(task, "Sub-task added", "", title.trim());'],
  ['logHistory(task, "Subtask Renamed", st.title, newTitle);', 'logHistory(task, "Sub-task renamed", st.title, newTitle);'],
  ['logHistory(task, "Subtask Deleted", task.subtasks[idx].title, "Deleted");', 'logHistory(task, "Sub-task deleted", "", task.subtasks[idx].title);'],
  // History log: one readable line per change ("Sub-task renamed: Assemble → Assemble frame")
  ['                        <div class="hist-header"><div class="dot"></div> <span class="author">${esc(h.user || \'User\')}</span>&nbsp;made changes - ${esc(h.time)}</div>\n                        <div class="hist-body">\n                            <div class="hist-field">${esc(h.field)}</div>\n                            <div class="hist-orig">${h.original ? \'Original: <span class="hist-val-box">\' + esc(h.original) + \'</span>\' : \'\'}</div>\n                            <div class="hist-new">New: <span class="hist-val-box">${esc(h.updated)}</span></div>\n                        </div>',
   '                        <div class="hist-header"><div class="dot"></div> <span class="author">${esc(h.user || \'User\')}</span>&nbsp;· ${esc(h.time)}</div>\n                        <div class="hist-body">${histLineHtml(h)}</div>'],
  // Category label in its own element so it can stay in view while scrolling a long row
  ["cNode.id = cat.id; cNode.innerText = cat.name;",
   "cNode.id = cat.id; cNode.innerHTML = '<span class=\"row-label\">' + esc(cat.name) + '</span>';"],
  // Timeline task column narrower on phones
  ["const today = todayISO(); const LABEL_W = 250;", "const today = todayISO(); const LABEL_W = window.innerWidth < 640 ? 150 : 250;"],
  // Phones: a submenu replaces the menu (with "‹ Back") instead of opening on top of it
  ["            closeSubmenu(); const sub = getSub(); fillMenu(sub, items, true); anchor.classList.add('open'); sub.classList.add('active');",
   "            if (drillDownMenus()) { if (!focusFirst) return; showDrillDown(items); return; }\n            closeSubmenu(); const sub = getSub(); fillMenu(sub, items, true); anchor.classList.add('open'); sub.classList.add('active');"],
  ["            closeSubmenu(); fillMenu(quickMenu, rawItems, false);\n            quickMenu.classList.add('active'); menuOpenedAt = Date.now(); placeMenu(quickMenu, x, y);",
   "            closeSubmenu(); fillMenu(quickMenu, rawItems, false); lastMenu = { x, y, items: rawItems };\n            quickMenu.classList.add('active'); menuOpenedAt = Date.now(); placeMenu(quickMenu, x, y);"],
  // Theme packs replace the old light/dark switch (src/themes.js)
  ["if(localStorage.getItem('themePref') === 'light') document.body.setAttribute('data-theme', 'light');", ""],
  // A duplicated or carried-forward task is a plain task, not another repeating series
  ["clone.id = generateId(); clone.flag = 'none'; clone.completedDate = ''; clone.history = [];", "clone.id = generateId(); clone.flag = 'none'; clone.completedDate = ''; clone.history = []; clone.repeat = null; clone.stage = ''; clone.dependsOn = []; clone.carryOf = ''; clone.timeLog = [];"],
  ["const clone = JSON.parse(JSON.stringify(loc.task)); clone.id = generateId();\n", "const clone = JSON.parse(JSON.stringify(loc.task)); clone.id = generateId(); clone.repeat = null; clone.stage = ''; clone.carryOf = loc.task.carryOf || loc.task.id; clone.timeLog = [];\n"],
  // Suggested name for a new week follows the team's week numbering (own numbering or calendar weeks)
  ["const name = await askText('New week name', 'WEEK ' + (weeksData.length + 1));",
   "const name = await askText('New week name', suggestWeekTitle(afterIndex));"],
  // Timeline: days remaining, as a pill in the (sticky) task column and after each bar
  ["const tip = r.t.name + ' — ' + r.person.name + ' — ' + r.week.title + ' — due ' + fmtShort(r.due) + (r.overdue ? ' (' + (-r.days) + 'd overdue)' : '');",
   "const left_ = daysLeftLabel(r); const tip = r.t.name + ' — ' + r.person.name + ' — ' + r.week.title + ' — due ' + fmtShort(r.due) + ' — ' + left_.long;"],
  ["PRIO_ICON[r.t.priority] + ' ' + esc(r.t.name) + '</div><div class=\"gt-track\"",
   "'<span class=\"gt-left ' + cls + '\">' + esc(left_.short) + '</span><span class=\"gt-name\">' + PRIO_ICON[r.t.priority] + ' ' + esc(r.t.name) + '</span></div><div class=\"gt-track\""],
  ["'<span class=\"gt-due\" style=\"left:' + lblX + 'px\">' + esc(fmtShort(r.due)) + '</span></div></div>'",
   "'<span class=\"gt-due ' + cls + '\" style=\"left:' + lblX + 'px\">' + esc(fmtShort(r.due) + ' · ' + left_.long) + '</span></div></div>'"],
  ["'<div class=\"gt-row gt-axis\"><div class=\"gt-label gt-axis-l\" style=\"width:' + LABEL_W + 'px\">Task</div>",
   "'<div class=\"gt-row gt-axis\"><div class=\"gt-label gt-axis-l\" style=\"width:' + LABEL_W + 'px\"><span class=\"gt-left gt-left-h\">Days left</span><span class=\"gt-name\">Task</span></div>"],
  // Project phases: a Phase filter + Phases tab in analytics, phase bands on the timeline
  ["let anTab = 'overview', anPerson = 'all', anScope = 'all', anZoom = 22;",
   "let anTab = 'overview', anPerson = 'all', anScope = 'all', anZoom = 22, anPhase = 'all';"],
  ["(Array.isArray(cat[w.key]) ? cat[w.key] : []).forEach(t => {\n                        const days = t.dueDate",
   "(Array.isArray(cat[w.key]) ? cat[w.key] : []).forEach(t => {\n                        if (!phaseMatches(t)) return;\n                        const days = t.dueDate"],
  ['<label>Person <select id="an-person"></select></label>',
   '<label>Person <select id="an-person"></select></label>\' + phaseAnalyticsFilterHtml() + \''],
  ["ov.querySelector('#an-scope').value = anScope;",
   "ov.querySelector('#an-scope').value = anScope; wirePhaseAnalyticsFilter(ov);"],
  ['<button class="an-tab" data-tab="timeline">Timeline</button>',
   '<button class="an-tab" data-tab="phases">Phases</button><button class="an-tab" data-tab="planning">Planning</button><button class="an-tab" data-tab="timeline">Timeline</button>'],
  ["anTab === 'timeline' ? renderTimeline(rows) : renderOverview(rows)",
   "anTab === 'timeline' ? renderTimeline(rows) : anTab === 'phases' ? renderPhases(rows) : anTab === 'planning' ? renderPlanning(rows) : renderOverview(rows)"],
  ["minISO = addDaysISO(minISO, -3); maxISO = addDaysISO(maxISO, 7);",
   "({ minISO, maxISO } = phaseExtent(minISO, maxISO)); minISO = addDaysISO(minISO, -3); maxISO = addDaysISO(maxISO, 7);"],
  ["            db.forEach(p => {\n                const mine = dated.filter(r => r.person.id === p.id)",
   "            html += phaseTimelineRows(LABEL_W, trackW, dw, clampX);\n            db.forEach(p => {\n                const mine = dated.filter(r => r.person.id === p.id)"],
  // Carried-forward copies remember their original, so edits flow forward and the chain shows as one task
  ["                    clonedTask.id = generateId(); \n                    let tW = weeksData.find(w=>w.key===tgtWeek)?.title || tgtWeek;",
   "                    clonedTask.id = generateId(); clonedTask.carryOf = originalTask.carryOf || originalTask.id; clonedTask.repeat = null; clonedTask.stage = ''; clonedTask.timeLog = [];\n                    let tW = weeksData.find(w=>w.key===tgtWeek)?.title || tgtWeek;"],
  ["                let clonedTask = JSON.parse(JSON.stringify(activeNode)); \n                clonedTask.id = generateId(); ",
   "                let clonedTask = JSON.parse(JSON.stringify(activeNode)); \n                clonedTask.id = generateId(); clonedTask.carryOf = activeNode.carryOf || activeNode.id; clonedTask.repeat = null; clonedTask.stage = ''; clonedTask.timeLog = [];"],
  ["carriedTask.id = generateId(); ", "carriedTask.id = generateId(); carriedTask.carryOf = ''; carriedTask.repeat = null; carriedTask.dependsOn = []; carriedTask.timeLog = []; "],
  // Analytics: a carried-forward chain is one task; its timeline bar starts at the first week
  ["const startOf = r => { const ws = r.week.startDate;", "const startOf = r => { const ws = (r.startWeek || r.week).startDate;"],
  ["<span class=\"gt-name\">' + PRIO_ICON[r.t.priority] + ' ' + esc(r.t.name) + '</span></div><div class=\"gt-track\"",
   "<span class=\"gt-name\">' + PRIO_ICON[r.t.priority] + ' ' + esc(r.t.name) + (r.carryCount > 1 ? ' <span class=\"gt-carry\" title=\"Carried forward across ' + r.carryCount + ' weeks\">↪ ' + r.carryCount + ' wks</span>' : '') + '</span></div><div class=\"gt-track\""],
];
// Speed (stress test): the side-panel search read every card's laid-out text on every redraw.
patches.push(["            const query = document.getElementById('search-tasks').value.toLowerCase();\n            document.querySelectorAll('.task-card').forEach(card => {\n                const text = card.innerText.toLowerCase();",
  "            const query = document.getElementById('search-tasks').value.toLowerCase();\n            if (!query) { document.querySelectorAll('.task-card.hidden-by-search').forEach(c => c.classList.remove('hidden-by-search')); drawLines(); return; }\n            document.querySelectorAll('.task-card').forEach(card => {\n                const text = card.textContent.toLowerCase();"]);
patches.push(["function fmtShort(iso) { const d = parseISO(iso); return d ? d.getDate() + ' ' + d.toLocaleString('default', { month: 'short' }) : ''; }",
  "const MONTHS_SHORT = Array.from({ length: 12 }, (_, m) => new Date(2000, m, 1).toLocaleString('default', { month: 'short' }));\n        function fmtShort(iso) { const d = parseISO(iso); return d ? d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] : ''; }"]);
// Speed: measure every connector end first, then add all lines at once (adding a line between two
// measurements forced the browser to lay out the whole page again for every line).
patches.push(["            svg.innerHTML = ''; \n            \n            connections.forEach(conn => {\n                const startEl = document.getElementById(conn.from); const endEl = document.getElementById(conn.to); if(!startEl || !endEl) return;\n                if (startEl.classList.contains('hidden-by-search') || endEl.classList.contains('hidden-by-search')) return;\n                const startRect = startEl.getBoundingClientRect(); const endRect = endEl.getBoundingClientRect();",
  "            svg.innerHTML = ''; \n            const frag = document.createDocumentFragment();\n            const measured = connections.map(conn => { const startEl = document.getElementById(conn.from); const endEl = document.getElementById(conn.to); if (!startEl || !endEl || startEl.classList.contains('hidden-by-search') || endEl.classList.contains('hidden-by-search')) return null; if (startEl.checkVisibility && !(startEl.checkVisibility({ contentVisibilityAuto: true }) && endEl.checkVisibility({ contentVisibilityAuto: true }))) return null; return { conn, startRect: startEl.getBoundingClientRect(), endRect: endEl.getBoundingClientRect() }; });\n            measured.forEach(m => { if (!m) return; const { conn, startRect, endRect } = m;"]);
patches.push(["                svg.appendChild(path);\n            });\n        }\n        window.addEventListener('resize', drawLines);",
  "                frag.appendChild(path);\n            });\n            svg.appendChild(frag);\n        }\n        let linesQueued = false; const queueLines = () => { if (linesQueued) return; linesQueued = true; requestAnimationFrame(() => { linesQueued = false; drawLines(); }); };\n        window.addEventListener('resize', queueLines);\n        document.addEventListener('contentvisibilityautostatechange', queueLines, true);"]);
// Scrolling fires many events per frame: draw the connector lines at most once per frame.
patches.push(["canvasContainer.addEventListener('scroll', () => { requestAnimationFrame(drawLines); });", "canvasContainer.addEventListener('scroll', queueLines, { passive: true });"]);
for (const [a, b] of patches) {
  const n = src.split(a).length - 1;
  if (n !== 1) throw new Error(`Patch anchor found ${n} times: ${a.slice(0, 80)}`);
  src = src.replace(a, () => b);
}

// 2) Parse and find top-level statements to drop or rename.
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
const DROP_FUNCS = new Set(['initDB', 'saveFileHandle', 'getFileHandle', 'deleteFileHandle', 'updateUIUser', 'changeUser', 'loadDatabase',
  'saveDatabase', 'checkStoredHandle', 'disconnectDatabase', 'connectSharedFile', 'reconnectExcelDatabase', 'extractDataFromWorkbook',
  'loadFromFile', 'pullLatestExcel', 'saveToFile', 'importExcelFallback', 'recordSnapshot', 'applySnapshot', 'undo', 'redo', 'restoreBackupFile',
  'setManualFile', 'refreshSyncUI', 'markConnectedUI', 'disconnectManual', 'downloadFullWorkbook', 'handleManualFile', 'addPersonLegacy',
  'addPerson', 'addPersonFlow', 'renameFlow', 'movePerson', 'toggleWeekCollapse', 'setAllWeeksCollapsed', 'deleteActiveNode', 'deleteWeek',
  'deleteNodeViaMenu', 'logHistory', 'setWeekStartFlow', 'autoDateWeeksFlow', 'toggleTheme', 'updateThemeButtons', 'addWeek', 'exportOffline', 'personMenuItems', 'exportTaskList', 'updateSyncTime',
  // never called in the team version (found by npm run lint / the dead-code check)
  'addCategoryToPerson', 'addTaskToCategory', 'currentSnapshot', 'openEditorFromMenu', 'readAsArrayBuffer', 'readAsText', 'toggleSidebar']);
const DROP_VARS = new Set(['DB_NAME', 'STORE_NAME', 'currentUser', 'autoSaveTimer', 'undoStack', 'FS_API', 'manualFileName', 'manualDirty',
  'currentFileHandle', 'saveInFlight']);
const RENAME = { openEditor: '_openEditorBase', createTaskCard: '_createTaskCardBase', canvasMenuItems: '_canvasMenuItemsBase',
  taskMenuItems: '_taskMenuItemsBase', renderCategoryRow: '_renderCategoryRowBase', downloadBackup: '_downloadBackupBase', openAnalytics: '_openAnalyticsBase', renderFilters: '_renderFiltersBase',
  showMenu: '_showMenuBase', closeContextMenu: '_closeContextMenuBase', onBoardContextMenu: '_onBoardContextMenuBase',
  columnMenuItems: '_columnMenuItemsBase', render: '_renderBase', collectTasks: '_collectTasksBase', renderAnalytics: '_renderAnalyticsBase', locateTask: '_locateTaskBase', openOriginalTask: '_openOriginalTaskBase' };
const DROP_EXPR = [/updateUIUser\(\)/, /e\.key === 's'/, /'beforeunload'/, /'storage'/, /^loadDatabase\(\)/, /^checkStoredHandle\(\)/,
  /^lastSnapshot = /, /^refreshSyncUI\(\)/, /^renderFilters\(\);?$/, /^render\(\);?$/];

const edits = []; // [start, end, replacement]
const seen = new Set();
for (const node of ast.body) {
  const text = src.slice(node.start, node.end);
  if (node.type === 'FunctionDeclaration') {
    const name = node.id.name;
    if (DROP_FUNCS.has(name)) { edits.push([node.start, node.end, '']); seen.add(name); }
    else if (RENAME[name]) { edits.push([node.id.start, node.id.end, RENAME[name]]); seen.add(name); }
  } else if (node.type === 'VariableDeclaration') {
    const names = node.declarations.map(d => d.id.name);
    if (names.some(n => DROP_VARS.has(n))) {
      if (!names.every(n => DROP_VARS.has(n) || ['redoStack', 'lastSnapshot', 'lastCoalesce', 'savePending', 'unsavedToFile'].includes(n)))
        throw new Error('Mixed declaration, refusing to drop: ' + text.slice(0, 80));
      edits.push([node.start, node.end, '']); names.forEach(n => seen.add(n));
    }
    if (names.includes('UNDO_LIMIT')) edits.push([node.start, node.end, '']);
  } else if (node.type === 'ExpressionStatement') {
    if (DROP_EXPR.some(re => re.test(text))) edits.push([node.start, node.end, '']);
  } else if ((node.type === 'IfStatement' || node.type === 'TryStatement') && /manualFileName|currentFileHandle|currentUser/.test(text)) {
    edits.push([node.start, node.end, '']);
  }
}
const missing = [...DROP_FUNCS, ...Object.keys(RENAME)].filter(n => !seen.has(n));
if (missing.length) throw new Error('Not found in v13: ' + missing.join(', '));

edits.sort((a, b) => b[0] - a[0]).forEach(([s, e, r]) => { src = src.slice(0, s) + r + src.slice(e); });

// 3) Header + overrides.
const header = `/* ─────────────────────────────────────────────────────────────────────────────
   Team board — generated by tools/build-board.mjs from the single-user v13
   tracker (ref/v13.js) + the multi-user layer (tools/board-overrides.js).
   Edit those two files, then run:  npm run build:board
   ───────────────────────────────────────────────────────────────────────────── */
'use strict';
`;
src = header + src.replace(/\n{3,}/g, '\n\n') + overrides;

// 4) Sanity: names that must no longer appear.
for (const bad of ['localStorage.getItem(\'drilling_tracker_db', 'currentFileHandle', 'showOpenFilePicker', 'manualFileName', 'Epiroc', 'prompt("']) {
  if (src.includes(bad)) throw new Error('Leftover reference: ' + bad);
}
if (process.env.DEBUG_BOARD) fs.writeFileSync(path.join(os.tmpdir(), 'board-debug.js'), src);
new acorn.Parser({ ecmaVersion: 'latest', sourceType: 'script' }, src).parse();
fs.mkdirSync(new URL('../public/board/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../public/board/board.js', import.meta.url), src);
console.log('board.js written:', src.length, 'chars');

// 5) Dead code: board functions nothing calls (not the board, the page, the app nor the tests).
{
  const read = (dir, re) => fs.readdirSync(new URL(dir, import.meta.url), { recursive: true }).filter(f => re.test(f)).map(f => fs.readFileSync(new URL(dir + f, import.meta.url), 'utf8')).join('\n');
  const elsewhere = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8') + read('../src/', /\.js$/) + read('../tests/', /\.mjs$/);
  const names = [...src.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
  const uses = (n, text) => (text.match(new RegExp('(?<![\\w$])' + n.replace(/\$/g, '\\$') + '(?![\\w$])', 'g')) || []).length;
  const dead = [...new Set(names)].filter(n => uses(n, src) + uses(n, elsewhere) <= 1);
  if (dead.length) console.warn('⚠ Board functions nothing calls (drop them in DROP_FUNCS or delete them):', dead.join(', '));
  else console.log('No unused board functions.');
}
