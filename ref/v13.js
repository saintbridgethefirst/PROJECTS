

        /* =====================================================================
           v13 changelog (v11 hardening; v12 right-click menus, undo, backups, Safari sync; v13 top bar, deadlines, week dates, analytics + timeline)
           - All user text is HTML-escaped before it reaches innerHTML (esc()).
           - Data is validated/sanitised on every load path (normalizeData()).
           - IDs use crypto random values; week keys are unique, never reused.
           - SheetJS bundled locally; Google Fonts dependency removed.
           ===================================================================== */
        const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c]));

        const PRIORITIES = ['Minor', 'Major', 'Critical', 'Blocker'];
        const FLAGS = ['none', 'pending', 'backlog', 'completed'];
        const BLOCKED_KEYS = ['__proto__', 'constructor', 'prototype'];
        const safeId = (v) => {
            let s = String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '_');
            return (!s || BLOCKED_KEYS.includes(s)) ? 'k_' + s : s;
        };

        // Validates and cleans a data object from ANY source (localStorage, shared Excel, import).
        // Guarantees: ids/keys contain only [A-Za-z0-9_-], enums are whitelisted, text fields are strings.
        function normalizeData(parsed) {
            if (!parsed || !Array.isArray(parsed.weeksData) || !Array.isArray(parsed.db)) throw new Error("Invalid tracker data structure.");
            const used = new Set(); const keyPairs = [];
            const weeks = parsed.weeksData.map(w => {
                let k = safeId(w.key); while (used.has(k)) k += '_2'; used.add(k);
                keyPairs.push([w.key, k]);
                return { key: k, title: String(w.title ?? ''), metric: String(w.metric ?? ''), collapsed: !!w.collapsed, startDate: cleanISO(w.startDate) };
            });
            const sid = (v) => (v ? safeId(v) : null);
            const normTask = (t) => ({
                id: safeId(t.id), type: 'task', name: String(t.name ?? ''),
                priority: PRIORITIES.includes(t.priority) ? t.priority : 'Minor',
                status: String(t.status ?? ''), jiraId: String(t.jiraId ?? ''),
                supportPersonId: sid(t.supportPersonId), supportPersonId2: sid(t.supportPersonId2),
                flag: FLAGS.includes(t.flag) ? t.flag : 'none', dueDate: cleanISO(t.dueDate), completedDate: t.flag === 'completed' ? cleanISO(t.completedDate) : '',
                subtasks: (Array.isArray(t.subtasks) ? t.subtasks : []).map(s => ({ id: safeId(s.id), title: String(s.title ?? ''), completed: !!s.completed })),
                history: (Array.isArray(t.history) ? t.history : []).map(h => ({ time: String(h.time ?? ''), user: String(h.user ?? ''), field: String(h.field ?? ''), original: String(h.original ?? ''), updated: String(h.updated ?? '') }))
            });
            const people = parsed.db.map(p => ({
                id: safeId(p.id), type: 'person', name: String(p.name ?? ''),
                categories: (Array.isArray(p.categories) ? p.categories : []).map(c => {
                    const nc = { id: safeId(c.id), type: 'category', name: String(c.name ?? '') };
                    keyPairs.forEach(([orig, k]) => { nc[k] = (Array.isArray(c[orig]) ? c[orig] : []).map(normTask); });
                    return nc;
                })
            }));
            return { weeksData: weeks, db: people };
        }

        // --- Custom Filter Toggle ---
        function toggleCustomFilter(contentId, headerElement) {
            const content = document.getElementById(contentId);
            if (content.classList.contains('closed')) {
                content.classList.remove('closed');
                headerElement.classList.remove('closed');
            } else {
                content.classList.add('closed');
                headerElement.classList.add('closed');
            }
        }

        // --- IndexedDB for File Handle Persistence ---
        const DB_NAME = 'DrillingTrackerFS';
        const STORE_NAME = 'handles';

        function initDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = (e) => { e.target.result.createObjectStore(STORE_NAME); };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        async function saveFileHandle(handle) {
            const db_conn = await initDB();
            return new Promise((resolve, reject) => {
                const tx = db_conn.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).put(handle, 'sync_file_handle');
                tx.oncomplete = resolve; tx.onerror = reject;
            });
        }
        async function getFileHandle() {
            const db_conn = await initDB();
            return new Promise((resolve, reject) => {
                const tx = db_conn.transaction(STORE_NAME, 'readonly');
                const request = tx.objectStore(STORE_NAME).get('sync_file_handle');
                request.onsuccess = () => resolve(request.result);
                request.onerror = reject;
            });
        }
        async function deleteFileHandle() {
            const db_conn = await initDB();
            return new Promise((resolve, reject) => {
                const tx = db_conn.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).delete('sync_file_handle');
                tx.oncomplete = resolve; tx.onerror = reject;
            });
        }

        const generateId = () => 'id_' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
        
        function getTimestamp() { 
            const n = new Date(); 
            const day = String(n.getDate()).padStart(2, '0');
            const month = n.toLocaleString('default', { month: 'short' });
            const year = String(n.getFullYear()).slice(-2);
            let hours = n.getHours(); const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12; hours = hours ? hours : 12;
            const minutes = String(n.getMinutes()).padStart(2, '0');
            return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`; 
        }

        function updateSyncTime(type) {
            const el = document.getElementById('last-sync-time');
            if(el) el.innerText = `Last ${type}: ` + getTimestamp();
        }

        // --- Current User Handling ---
        let currentUser = localStorage.getItem('drilling_current_user');
        if (!currentUser || currentUser === "Unknown User") {
            currentUser = prompt("Welcome! Please enter your name for the history log (e.g., John Doe):") || "User";
            localStorage.setItem('drilling_current_user', currentUser);
        }

        function updateUIUser() {
            document.querySelectorAll('.user-display').forEach(el => el.innerText = currentUser);
        }
        updateUIUser();

        function changeUser() {
            const newName = prompt("Enter your name:", currentUser);
            if(newName && newName.trim()) {
                currentUser = newName.trim();
                localStorage.setItem('drilling_current_user', currentUser);
                updateUIUser();
            }
        }

        // --- Quick Save Shortcut ---
        window.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                if (currentFileHandle || !FS_API) saveToFile();
                else alert("You must 'Connect Shared Database File' first before you can quick-save! Or use 'Export as New Offline Copy'.");
            }
        });

        // --- Search Functionality ---
        function performSearch() {
            const query = document.getElementById('search-tasks').value.toLowerCase();
            document.querySelectorAll('.task-card').forEach(card => {
                const text = card.innerText.toLowerCase();
                if(text.includes(query)) card.classList.remove('hidden-by-search');
                else card.classList.add('hidden-by-search');
            });
            drawLines(); 
        }

        // --- Core UI Toggles ---
        function toggleTheme() {
            const body = document.body; 
            const isLight = body.getAttribute('data-theme') === 'light';
            if (isLight) { body.removeAttribute('data-theme'); localStorage.setItem('themePref', 'dark'); } 
            else { body.setAttribute('data-theme', 'light'); localStorage.setItem('themePref', 'light'); }
            updateThemeButtons();
        }

        function updateThemeButtons() {
            const isLight = document.body.getAttribute('data-theme') === 'light';
            const txt = isLight ? '🌙 Dark Mode' : '☀️ Light Mode';
            const innerBtn = document.getElementById('theme-toggle-inner');
            const outerBtn = document.getElementById('theme-toggle-outer');
            if(innerBtn) innerBtn.innerHTML = txt;
            if(outerBtn) outerBtn.innerHTML = txt;
        }

        if(localStorage.getItem('themePref') === 'light') document.body.setAttribute('data-theme', 'light');
        updateThemeButtons();

        function toggleSidebar() {
            const panel = document.getElementById('editor-panel'); 
            const toggleDiv = document.getElementById('floating-toggles');
            if(panel && toggleDiv) {
                panel.classList.toggle('hidden');
                const isHidden = panel.classList.contains('hidden');
                toggleDiv.style.display = isHidden ? 'flex' : 'none'; panel.style.marginRight = isHidden ? (-panel.offsetWidth) + 'px' : '';
                setTimeout(drawLines, 350);
            }
        }

        // --- Context menus: see "v12" block near the end of this script ---

        function openEditorFromMenu(id) { 
            let node = db.find(p => p.id === id) || db.flatMap(p=>p.categories).find(c => c.id === id);
            if(node) { 
                const panel = document.getElementById('editor-panel');
                if(panel && panel.classList.contains('hidden')) toggleSidebar();
                openEditor(node); 
            }
        }

        function addCategoryToPerson(personId) {
            let p = db.find(p => p.id === personId); let newCat = { id: generateId(), type: 'category', name: 'NEW TYPE' };
            weeksData.forEach(w => newCat[w.key] = []); p.categories.push(newCat); saveDatabase(); render();
        }

        function addTaskToCategory(personId, catId, weekKey) {
            let cat = db.find(p => p.id === personId).categories.find(c => c.id === catId);
            let newTask = { id: generateId(), type: 'task', name: 'New Task', priority: 'Minor', status: 'TODO', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none', subtasks: [], history: [] };
            logHistory(newTask, "Task Status", "", "Created via quick menu");
            cat[weekKey].push(newTask); saveDatabase(); render();
        }

        // --- Database & History Logging ---
        let weeksData = []; let db = []; let hiddenPersons = new Set(); let hiddenWeeks = new Set(); 

        function logHistory(task, field, originalValue, newValue) {
            if(!task.history) task.history = [];
            task.history.unshift({ time: getTimestamp(), user: currentUser, field: field, original: originalValue, updated: newValue });
        }

        function loadDatabase() {
            const saved = localStorage.getItem('drilling_tracker_db_v10');
            let loaded = false;
            if (saved) {
                try {
                    const clean = normalizeData(JSON.parse(saved)); weeksData = clean.weeksData; db = clean.db; loaded = true;
                } catch (e) {
                    console.error("Stored data was unreadable; keeping a backup and starting fresh.", e);
                    localStorage.setItem('drilling_tracker_db_v10_corrupt_backup', saved);
                }
            }
            if (loaded) {
            } else {
                weeksData = [ { key: 'week1', title: 'WEEK 1', metric: 'Hi: 0.00', collapsed: false } ];
                let initTask = { id: generateId(), type: 'task', name: 'Initial Task', priority: 'Minor', status: 'TODO', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none', subtasks: [], history: [] };
                logHistory(initTask, "Creation", "", "Task created initially");
                db = [ { id: 'p1', type: 'person', name: 'TEAM MEMBER', categories: [ { id: generateId(), type: 'category', name: 'CATEGORY 1', week1: [initTask] } ] } ];
            }
        }

        let autoSaveTimer = null; // Holds the timer

        function saveDatabase(coalesceKey) {
            recordSnapshot(coalesceKey);
            // 1. Save locally instantly
            try { localStorage.setItem('drilling_tracker_db_v10', JSON.stringify({ weeksData, db })); }
            catch (err) { toast('⚠️ Browser storage is full or blocked. Download a backup now (right-click the board ▸ Download full backup).', 10000); }
            if (manualFileName && !FS_API) { manualDirty = true; refreshSyncUI(); }
            const badge = document.getElementById('sync-status'); 
            if(badge) { badge.style.opacity = '1'; setTimeout(() => badge.style.opacity = '0', 1500); }
            
            // 2. Auto-Save to Cloud (Wait 3 seconds after typing stops)
            if (currentFileHandle) {
                clearTimeout(autoSaveTimer); unsavedToFile = true;
                autoSaveTimer = setTimeout(() => {
                    saveToFile(true); // true = silent save without popups
                }, 3000); // 3000ms = 3 seconds delay
            }
        }

        // --- Advanced Filters ---
        function renderFilters() {
            const fp = document.getElementById('filter-persons');
            const fw = document.getElementById('filter-weeks');
            if(fp) fp.innerHTML = db.map(p => `<label><input type="checkbox" value="${p.id}" onchange="toggleFilter('person', '${p.id}', this.checked)" ${!hiddenPersons.has(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('');
            if(fw) fw.innerHTML = weeksData.map(w => `<label><input type="checkbox" value="${w.key}" onchange="toggleFilter('week', '${w.key}', this.checked)" ${!hiddenWeeks.has(w.key) ? 'checked' : ''}> ${esc(w.title)}</label>`).join('');
        }
        
        function toggleFilter(type, id, isChecked) { 
            let targetSet = type === 'person' ? hiddenPersons : hiddenWeeks; 
            if(isChecked) targetSet.delete(id); else targetSet.add(id); 
            render(); 
        }
        
        function massSelect(type, checkAll) {
            const inputs = document.querySelectorAll(`#filter-${type}s input`);
            let targetSet = type === 'person' ? hiddenPersons : hiddenWeeks;
            inputs.forEach(inp => {
                inp.checked = checkAll;
                let id = inp.value; // FIXED: Uses hidden value ID instead of text name
                if(checkAll) targetSet.delete(id); else targetSet.add(id);
            });
            render();
        }

        function selectLastNWeeks(n) {
            const inputs = document.querySelectorAll(`#filter-weeks input`);
            hiddenWeeks.clear(); 
            weeksData.forEach(w => hiddenWeeks.add(w.key));
            
            let visibleCount = 0;
            for(let i = weeksData.length - 1; i >= 0; i--) {
                if(visibleCount < n) { hiddenWeeks.delete(weeksData[i].key); visibleCount++; }
            }
            
            inputs.forEach(inp => {
                inp.checked = !hiddenWeeks.has(inp.value); // FIXED
            });
            render();
        }

        function toggleWeekCollapse(index) { weeksData[index].collapsed = !weeksData[index].collapsed; saveDatabase(); render(); }
        function getVisibleWeeks() { return weeksData.filter(w => !hiddenWeeks.has(w.key)); }
        function updateWeekField(index, field, value) { weeksData[index][field] = value; saveDatabase('week-' + index + '-' + field); renderFilters(); }

        function addWeek(customTitle) {
            const nextNum = weeksData.length + 1; const newKey = 'wk_' + generateId().slice(3);
            weeksData.push({ key: newKey, title: customTitle || ('NEW WEEK ' + nextNum), metric: 'Hi: 0.00', collapsed: false, startDate: nextWeekStart() });
            db.forEach(p => p.categories.forEach(c => c[newKey] = []));
            hiddenWeeks.clear(); if (weeksData.length > 2) { for (let i = 0; i < weeksData.length - 2; i++) hiddenWeeks.add(weeksData[i].key); }
            saveDatabase(); renderFilters(); render();
            setTimeout(() => { const canvas = document.getElementById('canvas-container'); if(canvas) canvas.scrollTo({ left: canvas.scrollWidth, behavior: 'smooth' }); }, 100);
        }

        // --- Core Rendering ---
        let activeNode = null; let connections = []; 

        function renderHeaders() {
            const container = document.getElementById('dynamic-headers'); 
            if(!container) return;
            container.innerHTML = '';
            getVisibleWeeks().forEach((w) => {
                let actualIndex = weeksData.findIndex(wk => wk.key === w.key);
                
                if (w.collapsed) {
                    let shortName = 'W' + (actualIndex + 1);
                    let match = w.title.match(/([A-Za-z])[A-Za-z]*.*?(\d+)/);
                    if(match) shortName = (match[1] + match[2]).toUpperCase();

                    container.innerHTML += `<div class="header-week collapsed-circle" data-week-key="${esc(w.key)}" onclick="toggleWeekCollapse(${actualIndex})" title="Expand ${esc(w.title)}">${esc(shortName)}</div>`;
                } else {
                    container.innerHTML += `
                        <div class="header-week${isCurrentWeek(w) ? ' current-week' : ''}" data-week-key="${esc(w.key)}">
                            <button class="collapse-toggle" onclick="toggleWeekCollapse(${actualIndex})" title="Collapse Week">◂</button>
                            <input class="week-title" value="${esc(w.title)}" onchange="updateWeekField(${actualIndex}, 'title', this.value)">
                            <div class="metric-badge" contenteditable="true" oninput="updateWeekField(${actualIndex}, 'metric', this.innerText)">${esc(w.metric)}</div>
                            ${weekDatesHtml(w)}
                            <button class="delete-week-btn" onclick="deleteWeek(${actualIndex})" title="Delete entire week">🗑️</button>
                        </div>`;
                }
            });
        }

        function render() {
            renderHeaders(); 
            const container = document.getElementById('nodes-container'); 
            if(!container) return;
            container.innerHTML = ''; connections = [];
            const visibleWeeks = getVisibleWeeks(); let supportMap = {}; 
            
            db.forEach(p => p.categories.forEach(c => { visibleWeeks.forEach(wk => { if(c[wk.key]) { c[wk.key].forEach(t => {
                [t.supportPersonId, t.supportPersonId2].forEach(sId => {
                    if(sId && !hiddenPersons.has(sId)) {
                        if(!supportMap[sId]) { supportMap[sId] = {}; visibleWeeks.forEach(wDef => supportMap[sId][wDef.key] = []); }
                        supportMap[sId][wk.key].push({ ...t, isGhost: true, originalId: t.id, sourcePersonName: p.name });
                    }
                });
            }); }}); }));

            db.forEach((person) => {
                if (hiddenPersons.has(person.id)) return;
                const pRow = document.createElement('div'); pRow.className = 'row-person';
                
                const pNode = document.createElement('div'); pNode.className = 'node node-person'; pNode.id = person.id;
                pNode.innerHTML = `<div class="avatar-circle"><svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div><span>${esc(person.name)}</span>`;
                pNode.onclick = (e) => openContextMenu(e, 'person', person);
                pRow.appendChild(pNode);

                const catContainer = document.createElement('div'); catContainer.className = 'row-categories';
                person.categories.forEach(cat => renderCategoryRow(person, cat, catContainer, visibleWeeks));

                if (supportMap[person.id]) {
                    const supportCat = { id: generateId(), name: 'SUPPORTING', isSupportRow: true };
                    visibleWeeks.forEach(w => supportCat[w.key] = supportMap[person.id][w.key] || []);
                    renderCategoryRow(person, supportCat, catContainer, visibleWeeks);
                }

                pRow.appendChild(catContainer); container.appendChild(pRow);
            });
            performSearch(); 
            setTimeout(drawLines, 50); 
        }

        function renderCategoryRow(person, cat, container, visibleWeeks) {
            connections.push({from: person.id, to: cat.id, type: 'normal'}); 
            const cRow = document.createElement('div'); cRow.className = 'row-category';
            const cNode = document.createElement('div'); cNode.className = `node node-cat ${cat.isSupportRow ? 'support-cat' : ''}`; cNode.id = cat.id; cNode.innerText = cat.name;
            if(!cat.isSupportRow) cNode.onclick = (e) => openContextMenu(e, 'category', cat, person);
            cRow.appendChild(cNode);

            const wContainer = document.createElement('div'); wContainer.className = 'row-weeks';
            visibleWeeks.forEach(wk => {
                const wCol = document.createElement('div'); wCol.className = `col-week ${wk.collapsed ? 'collapsed-col' : ''}`; wCol.dataset.weekKey = wk.key; if (!cat.isSupportRow) { wCol.dataset.catId = cat.id; wCol.dataset.personId = person.id; }
                
                wCol.ondragover = (e) => { e.preventDefault(); wCol.classList.add('drag-over'); };
                wCol.ondragleave = () => wCol.classList.remove('drag-over');
                wCol.ondrop = (e) => dropTask(e, person.id, cat.id, wk.key, wCol);

                if (cat[wk.key]) {
                    let taskCount = cat[wk.key].length;
                    if(wk.collapsed) {
                        if (taskCount > 0) wCol.innerHTML = `<div class="collapsed-indicator">${taskCount} TASKS</div>`;
                    } else {
                        cat[wk.key].forEach((task) => {
                            let domId = task.isGhost ? `ghost_${task.id}` : task.id;
                            if(cat[wk.key].indexOf(task) === 0) connections.push({from: cat.id, to: domId, type: 'normal'}); 
                            if(task.isGhost) connections.push({from: task.originalId, to: domId, type: 'support'}); 
                            wCol.appendChild(createTaskCard(task, person, cat, wk.key));
                        });
                    }
                }
                wContainer.appendChild(wCol);
            });
            cRow.appendChild(wContainer); container.appendChild(cRow);
        }

        function createTaskCard(task, person, cat, weekKey) {
            const card = document.createElement('div'); card.id = task.isGhost ? `ghost_${task.id}` : task.id;
            let flagClass = task.flag ? `flag-${task.flag}` : 'flag-none';
            card.className = `node task-card ${task.isGhost ? 'ghost-card' : ''} ${activeNode && activeNode.id === task.id ? 'active' : ''} ${flagClass}`;
            card.setAttribute('data-priority', task.priority); if (!task.isGhost && isOverdue(task)) card.classList.add('is-overdue');
            
            let icon = task.priority === 'Blocker' ? '⛔' : (task.priority === 'Critical' ? '⏫' : (task.priority === 'Major' ? '︽' : '︾'));
            let headerText = task.isGhost ? `Supporting: ${esc(task.sourcePersonName)}` : `${icon} Priority: ${esc(task.priority)}`;

            let flagBadge = ''; let jiraBadge = task.jiraId && !task.isGhost ? `<div class="jira-badge">🎫 ${esc(task.jiraId)}</div>` : '';
            if(!task.isGhost) {
                if (task.flag === 'completed') flagBadge = `<div class="flag-stamp stamp-completed">COMPLETED ✓</div>`;
                else if (task.flag === 'pending') flagBadge = `<div class="flag-stamp stamp-pending">PENDING ⏳</div>`;
                else if (task.flag === 'backlog') flagBadge = `<div class="flag-stamp stamp-backlog">BACKLOG ⚠️</div>`;
            }

            let html = `${flagBadge}<div class="card-header c-${task.priority.toLowerCase()}">${headerText}</div><div class="card-title">${esc(task.name)}</div><div class="card-status">${esc(task.status)}</div>${jiraBadge}${task.isGhost ? '' : dueChipHtml(task)}`;

            if(!task.isGhost) {
                let total = task.subtasks ? task.subtasks.length : 0; let completed = total > 0 ? task.subtasks.filter(s => s.completed).length : 0;
                let progress = total > 0 ? (completed / total) * 100 : 0;
                let subtasksHtml = task.subtasks && task.subtasks.length > 0 ? task.subtasks.map(st => `
                    <div class="subtask-item ${st.completed ? 'completed' : ''}" onclick="toggleSubtask(event, '${task.id}', '${st.id}')">
                        <input type="checkbox" ${st.completed ? 'checked' : ''} tabindex="-1"><span>${esc(st.title)}</span>
                    </div>`).join('') : '';

                html += `
                    <div class="progress-wrapper"><div class="progress-bg"><div class="progress-fill" style="width: ${progress}%;"></div></div><div class="progress-text">${Math.round(progress)}%</div></div>
                    <div class="subtask-list">${subtasksHtml}</div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 15px;">
                        <div class="btn-add-subtask" onclick="quickAddSubtask(event, '${task.id}')"><i>⊕</i> Add sub-task</div>
                        ${(function(){
                            let names = [];
                            if(task.supportPersonId) { let p1 = db.find(p=>p.id===task.supportPersonId); if(p1) names.push(p1.name); }
                            if(task.supportPersonId2) { let p2 = db.find(p=>p.id===task.supportPersonId2); if(p2) names.push(p2.name); }
                            return names.length > 0 ? `<div class="assignee-badge">Support: ${esc(names.join(' & '))}</div>` : '';
                        })()}
                    </div>`;
            }
            card.innerHTML = html;

            if(!task.isGhost) {
                card.onclick = () => { document.querySelectorAll('.task-card').forEach(c => c.classList.remove('active')); card.classList.add('active'); openEditor(task); };
                card.setAttribute('draggable', 'true');
                card.ondragstart = (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ taskId: task.id, srcPersonId: person.id, srcCatId: cat.id, srcWeek: weekKey })); };
            }
            return card;
        }

        // --- Drag, Split & Carry Forward Task ---
        function dropTask(e, tgtPersonId, tgtCatId, tgtWeek, colElement) {
            e.preventDefault(); colElement.classList.remove('drag-over');
            let tgtPerson = db.find(p => p.id === tgtPersonId);
            let tgtCat = tgtPerson?.categories.find(c => c.id === tgtCatId);
            if(!tgtCat) return; 

            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                let srcPerson = db.find(p => p.id === data.srcPersonId);
                let srcCat = srcPerson.categories.find(c => c.id === data.srcCatId);
                let taskIndex = srcCat[data.srcWeek].findIndex(t => t.id === data.taskId);
                let originalTask = srcCat[data.srcWeek][taskIndex];
                
                const logMove = (task) => {
                    let sW = weeksData.find(w=>w.key===data.srcWeek)?.title || data.srcWeek;
                    let tW = weeksData.find(w=>w.key===tgtWeek)?.title || tgtWeek;
                    
                    if (data.srcWeek !== tgtWeek) logHistory(task, "Schedule", sW, tW);
                    if (data.srcPersonId !== tgtPersonId) logHistory(task, "Assignment", srcPerson.name, tgtPerson.name);
                    if (data.srcCatId !== tgtCatId) logHistory(task, "Category", srcCat.name, tgtCat.name);
                };

                if (e.altKey || e.ctrlKey) {
                    let clonedTask = JSON.parse(JSON.stringify(originalTask)); 
                    clonedTask.id = generateId(); 
                    let tW = weeksData.find(w=>w.key===tgtWeek)?.title || tgtWeek;
                    logHistory(clonedTask, "Action", data.srcWeek, `Carried forward to ${tW}`);
                    logMove(clonedTask);
                    if(clonedTask.supportPersonId === tgtPersonId) clonedTask.supportPersonId = null;
                    if(clonedTask.supportPersonId2 === tgtPersonId) clonedTask.supportPersonId2 = null;
                    tgtCat[tgtWeek].push(clonedTask);
                } 
                else {
                    let completedSubtasks = originalTask.subtasks ? originalTask.subtasks.filter(s => s.completed) : [];
                    let pendingSubtasks = originalTask.subtasks ? originalTask.subtasks.filter(s => !s.completed) : [];

                    if (data.srcWeek !== tgtWeek && completedSubtasks.length > 0 && pendingSubtasks.length > 0) {
                        originalTask.subtasks = completedSubtasks; 
                        let tW = weeksData.find(w=>w.key===tgtWeek)?.title || tgtWeek;
                        logHistory(originalTask, "Split", "", `Pending subtasks moved to ${tW}`);
                        
                        let carriedTask = JSON.parse(JSON.stringify(originalTask)); 
                        carriedTask.id = generateId(); 
                        carriedTask.subtasks = pendingSubtasks; 
                        carriedTask.flag = 'none'; 
                        carriedTask.history = []; 
                        let sW = weeksData.find(w=>w.key===data.srcWeek)?.title || data.srcWeek;
                        logHistory(carriedTask, "Creation", "", `Split & carried forward from ${sW}`);
                        logMove(carriedTask);

                        if(carriedTask.supportPersonId === tgtPersonId) carriedTask.supportPersonId = null;
                        if(carriedTask.supportPersonId2 === tgtPersonId) carriedTask.supportPersonId2 = null;
                        tgtCat[tgtWeek].push(carriedTask);
                    } else {
                        let taskToMove = srcCat[data.srcWeek].splice(taskIndex, 1)[0];
                        logMove(taskToMove);
                        if(taskToMove.supportPersonId === tgtPersonId) taskToMove.supportPersonId = null;
                        if(taskToMove.supportPersonId2 === tgtPersonId) taskToMove.supportPersonId2 = null;
                        tgtCat[tgtWeek].push(taskToMove);
                    }
                }
                saveDatabase(); render();
            } catch (err) { console.error(err); }
        }

       
        // --- Subtask Actions ---
        function findTask(taskId) { for(let p of db) for(let c of p.categories) for(let w of weeksData) { if(c[w.key]) { let t = c[w.key].find(tk => tk.id === taskId); if(t) return t; } } return null; }
        
        function toggleSubtask(e, taskId, subtaskId) { 
            e.stopPropagation(); 
            let task = findTask(taskId); 
            if(task && task.subtasks) { 
                let st = task.subtasks.find(s => s.id === subtaskId); 
                if(st) { 
                    st.completed = !st.completed; 
                    logHistory(task, "Subtask Status", st.title, st.completed ? 'Completed' : 'Pending'); 
                    saveDatabase(); render(); 
                    if(activeNode && activeNode.id === taskId) openEditor(task); // Refresh editor panel
                } 
            } 
        }
        
        async function quickAddSubtask(e, taskId) { 
            if (e) { e.stopPropagation(); e.preventDefault(); }
            let title = await askText("New sub-task", "", "Sub-task title"); 
            if(title && title.trim()) { 
                let task = findTask(taskId); 
                if(task) { 
                    if(!task.subtasks) task.subtasks = []; 
                    task.subtasks.push({id: generateId(), title: title.trim(), completed: false}); 
                    logHistory(task, "Subtask Added", "", title.trim()); 
                    saveDatabase(); render(); 
                    if(activeNode && activeNode.id === taskId) openEditor(task);
                } 
            } 
        }

        function updateSubtaskTitle(e, taskId, subtaskId, newTitle) {
            let task = findTask(taskId);
            if(task && task.subtasks) {
                let st = task.subtasks.find(s => s.id === subtaskId);
                if(st && st.title !== newTitle) {
                    logHistory(task, "Subtask Renamed", st.title, newTitle);
                    st.title = newTitle;
                    saveDatabase(); render(); openEditor(task);
                }
            }
        }

        function deleteSubtask(e, taskId, subtaskId) {
            e.preventDefault();
            if(!confirm("Delete this subtask?")) return;
            let task = findTask(taskId);
            if(task && task.subtasks) {
                let idx = task.subtasks.findIndex(s => s.id === subtaskId);
                if(idx > -1) {
                    logHistory(task, "Subtask Deleted", task.subtasks[idx].title, "Deleted");
                    task.subtasks.splice(idx, 1);
                    saveDatabase(); render(); openEditor(task);
                }
            }
        }
        // --- UNIVERSAL DELETE & EDITOR SYSTEM ---
        // --- UNIVERSAL DELETE & EDITOR SYSTEM ---
        function openEditor(nodeData) {
            activeNode = nodeData; 
            const noSel = document.getElementById('no-selection');
            if(noSel) noSel.style.display = 'none';
            const form = document.getElementById('edit-form'); 
            if(!form) return;
            form.style.display = 'block';

            if (nodeData.type === 'person' || nodeData.type === 'category') {
                let lbl = nodeData.type === 'person' ? 'Team Member' : 'Category';
                form.innerHTML = `
                    <label>${lbl} Name</label><input type="text" id="edit-name" value="${esc(nodeData.name)}">
                    <div style="margin-top: 20px;">
                        <button class="btn-secondary btn-danger" onclick="deleteActiveNode()">🗑️ Delete ${lbl}</button>
                    </div>`;
            } else {
                let personOptions1 = db.map(p => `<option value="${p.id}" ${nodeData.supportPersonId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
                let personOptions2 = db.map(p => `<option value="${p.id}" ${nodeData.supportPersonId2 === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
                
                let historyHtml = (nodeData.history || []).map(h => `
                    <div class="hist-entry">
                        <div class="hist-header"><div class="dot"></div> <span class="author">${esc(h.user || 'User')}</span>&nbsp;made changes - ${esc(h.time)}</div>
                        <div class="hist-body">
                            <div class="hist-field">${esc(h.field)}</div>
                            <div class="hist-orig">${h.original ? 'Original: <span class="hist-val-box">' + esc(h.original) + '</span>' : ''}</div>
                            <div class="hist-new">New: <span class="hist-val-box">${esc(h.updated)}</span></div>
                        </div>
                    </div>`).join('');

                let subtasksEditorHtml = '';
                if(nodeData.subtasks && nodeData.subtasks.length > 0) {
                    subtasksEditorHtml = `
                        <label style="margin-top: 20px;">Subtasks</label>
                        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:15px;">
                            ${nodeData.subtasks.map(st => `
                                <div style="display:flex; align-items:center; gap:8px; background:var(--bg-main); padding:8px; border-radius:6px; border:1px solid var(--border-color);">
                                    <input type="checkbox" style="width:16px; height:16px; margin:0;" ${st.completed ? 'checked' : ''} onchange="toggleSubtask(event, '${nodeData.id}', '${st.id}')">
                                    <input type="text" style="margin:0; padding:4px 8px;" value="${esc(st.title)}" onchange="updateSubtaskTitle(event, '${nodeData.id}', '${st.id}', this.value)">
                                    <button class="btn-danger" style="padding:4px 8px; width:auto; border:none; background:transparent; cursor:pointer;" onclick="deleteSubtask(event, '${nodeData.id}', '${st.id}')" title="Delete Subtask">❌</button>
                                </div>
                            `).join('')}
                        </div>
                    `;
                }

                form.innerHTML = `
                    <label>Task Title</label><textarea id="edit-name">${esc(nodeData.name)}</textarea>
                    <label>Priority</label><select id="edit-priority">
                        <option value="Minor" ${nodeData.priority==='Minor'?'selected':''}>Minor</option>
                        <option value="Major" ${nodeData.priority==='Major'?'selected':''}>Major</option>
                        <option value="Critical" ${nodeData.priority==='Critical'?'selected':''}>Critical</option>
                        <option value="Blocker" ${nodeData.priority==='Blocker'?'selected':''}>Blocker</option>
                    </select>
                    <label>Status Badge</label><input type="text" id="edit-status" value="${esc(nodeData.status)}">
                    <label>Jira Case ID</label><input type="text" id="edit-jira" value="${esc(nodeData.jiraId || '')}" placeholder="e.g. NASHCPI-1944">
                    <label>Deadline</label><input type="date" id="edit-due" value="${esc(nodeData.dueDate || '')}">
                    <div class="due-quick"><button type="button" onclick="setDueQuick(0)">Today</button><button type="button" onclick="setDueQuick(1)">Tomorrow</button><button type="button" onclick="setDueQuick(7)">+1 week</button><button type="button" onclick="setDueQuick(null)">Clear</button></div>
                    <label>Supporting Person 1</label><select id="edit-support"><option value="">None</option>${personOptions1}</select>
                    <label>Supporting Person 2</label><select id="edit-support2"><option value="">None</option>${personOptions2}</select>
                    <label style="margin-top: 20px;">Task Status Flag</label>
                    <select id="edit-flag" style="margin-bottom: 20px;">
                        <option value="none" ${nodeData.flag === 'none' ? 'selected' : ''}>None (Default)</option>
                        <option value="pending" ${nodeData.flag === 'pending' ? 'selected' : ''}>Pending (Yellow)</option>
                        <option value="backlog" ${nodeData.flag === 'backlog' ? 'selected' : ''}>Backlog (Red)</option>
                        <option value="completed" ${nodeData.flag === 'completed' ? 'selected' : ''}>Completed (Green)</option>
                    </select>

                    ${subtasksEditorHtml}
                    <button class="btn-secondary" style="font-size:11px; padding:6px; margin-bottom: 30px;" onclick="quickAddSubtask(event, '${nodeData.id}')">➕ Add Subtask</button>

                    <div style="display: flex; gap: 10px; margin-bottom: 30px;">
                        <button class="btn-secondary" style="flex:1; border-color:var(--text-main); color:var(--text-main);" onclick="extendTaskUI()">📋 Carry Forward</button>
                        <button class="btn-secondary btn-danger" style="flex:1;" onclick="deleteActiveNode()">🗑️ Delete Task</button>
                    </div>

                    <label>History Log</label>
                    <div class="history-box">${historyHtml || '<div class="hist-orig" style="font-size:12px;">No history recorded yet.</div>'}</div>
                `;
            }

            // Bind live inputs
            ['edit-name', 'edit-status', 'edit-jira'].forEach(id => {
                let el = document.getElementById(id);
                if(el) {
                    el.addEventListener('focus', (e) => { e.target.dataset.original = e.target.value; });
                    el.addEventListener('input', (e) => {
                        let field = id.replace('edit-', '');
                        if(field === 'name') field = 'name'; else if (field === 'jira') field = 'jiraId';
                        activeNode[field] = e.target.value;
                        if(id === 'edit-name') {
                            const domEl = document.getElementById(activeNode.id);
                            if(domEl) {
                                if(activeNode.type === 'task') {
                                    const titleEl = domEl.querySelector('.card-title');
                                    if(titleEl) titleEl.innerText = activeNode.name;
                                }
                                else if(activeNode.type === 'person') {
                                    const spanEl = domEl.querySelector('span');
                                    if(spanEl) spanEl.innerText = activeNode.name;
                                }
                                else domEl.innerText = activeNode.name;
                            }
                        } else { render(); }
                    });
                    el.addEventListener('change', (e) => { 
                        if(e.target.dataset.original !== e.target.value) {
                            let fName = id.replace('edit-', '');
                            logHistory(activeNode, fName === 'name' ? 'Title' : fName, e.target.dataset.original, e.target.value);
                            saveDatabase(); 
                            if (activeNode.type === 'person') renderFilters(); // FIX: Refresh filters if team member name changes
                            openEditor(activeNode); 
                        }
                    });
                }
            });

            const dueEl = document.getElementById('edit-due'); if (dueEl) dueEl.addEventListener('change', (e) => setTaskDue(activeNode, e.target.value));
            ['edit-flag', 'edit-priority', 'edit-support', 'edit-support2'].forEach(id => {
                let el = document.getElementById(id);
                if(el) {
                    el.addEventListener('focus', (e) => { e.target.dataset.original = e.target.options[e.target.selectedIndex].text; });
                    el.addEventListener('change', (e) => { 
                        let field = id.replace('edit-', '');
                        if (field === 'support') field = 'supportPersonId';
                        if (field === 'support2') field = 'supportPersonId2';
                        let newText = e.target.options[e.target.selectedIndex].text;
                        logHistory(activeNode, field, e.target.dataset.original, newText);
                        activeNode[field] = e.target.value || null; if (field === 'flag') stampCompletion(activeNode); saveDatabase(); render(); openEditor(activeNode);
                    });
                }
            });
        }

        function addPersonLegacy() { let p = { id: generateId(), type: 'person', name: 'NEW PERSON', categories: [] }; db.push(p); saveDatabase(); renderFilters(); render(); openEditor(p); const panel = document.getElementById('editor-panel'); if(panel && panel.classList.contains('hidden')) toggleSidebar();}
        
        function _deleteActiveNodeCore() { 
            if(!activeNode) return; 
            
            if (activeNode.type === 'task') {
                if(!confirm("Delete this task?")) return;
                db.forEach(p => p.categories.forEach(c => weeksData.forEach(w => { if (c[w.key]) { let idx = c[w.key].findIndex(t => t.id === activeNode.id); if(idx > -1) c[w.key].splice(idx, 1); } }))); 
            } 
            else if (activeNode.type === 'category') {
                if(!confirm("⚠️ WARNING ⚠️\n\nAre you sure you want to delete this entire Category?\nAll tasks inside it will be deleted. (You can undo with Ctrl+Z until you reload the page.)")) return;
                db.forEach(p => {
                    let idx = p.categories.findIndex(c => c.id === activeNode.id);
                    if(idx > -1) p.categories.splice(idx, 1);
                });
            } 
            else if (activeNode.type === 'person') {
                if(!confirm("⚠️ WARNING ⚠️\n\nAre you sure you want to delete this Team Member?\nAll their categories and tasks will be deleted. (You can undo with Ctrl+Z until you reload the page.)")) return;
                let idx = db.findIndex(p => p.id === activeNode.id);
                if(idx > -1) db.splice(idx, 1);
            }
            
            const frm = document.getElementById('edit-form'); if(frm) frm.style.display = 'none'; 
            const noSel = document.getElementById('no-selection'); if(noSel) noSel.style.display = 'block'; 
            activeNode = null; 
            saveDatabase(); 
            renderFilters();
            render(); 
        }

        function _deleteWeekCore(index) {
            let w = weeksData[index];
            if(!confirm(`⚠️ WARNING ⚠️\n\nAre you sure you want to delete "${w.title}"?\n\nAll tasks scheduled in this week across ALL team members will be deleted. (Ctrl+Z undoes this until you reload.)`)) return;
            
            db.forEach(p => p.categories.forEach(c => { delete c[w.key]; }));
            weeksData.splice(index, 1);
            hiddenWeeks.delete(w.key); 
            
            saveDatabase();
            renderFilters();
            render();
        }
        
        function extendTaskUI() {
            if(!activeNode || activeNode.type !== 'task') return;
            
            let currentWeekIndex = -1; let tgtCat = null;
            db.forEach(p => p.categories.forEach(c => weeksData.forEach((w, idx) => { if(c[w.key] && c[w.key].find(t => t.id === activeNode.id)) { currentWeekIndex = idx; tgtCat = c; }})));
            
            if(tgtCat && currentWeekIndex > -1) {
                let nextWeekIndex = currentWeekIndex + 1;
                if (nextWeekIndex >= weeksData.length) addWeek(); 
                
                let nextWeekKey = weeksData[nextWeekIndex].key;
                let clonedTask = JSON.parse(JSON.stringify(activeNode)); 
                clonedTask.id = generateId(); 
                
                let sW = weeksData[currentWeekIndex].title;
                let tW = weeksData[nextWeekIndex].title;
                
                logHistory(clonedTask, "Action", sW, `Carried forward to ${tW}`);
                tgtCat[nextWeekKey].push(clonedTask);
                saveDatabase(); render();
            }
        }

        // --- Connection Lines ---
        function drawLines() {
            const svg = document.getElementById('lines-svg'); const canvas = document.getElementById('canvas-container');
            const nodesContainer = document.getElementById('nodes-container');
            if(!svg || !canvas || !nodesContainer) return;
            
            const canvasRect = canvas.getBoundingClientRect();
            svg.style.width = nodesContainer.scrollWidth + 100 + 'px'; 
            svg.style.height = nodesContainer.scrollHeight + 100 + 'px'; 
            svg.innerHTML = ''; 
            
            connections.forEach(conn => {
                const startEl = document.getElementById(conn.from); const endEl = document.getElementById(conn.to); if(!startEl || !endEl) return;
                if (startEl.classList.contains('hidden-by-search') || endEl.classList.contains('hidden-by-search')) return;
                const startRect = startEl.getBoundingClientRect(); const endRect = endEl.getBoundingClientRect();
                if (startRect.width === 0 || endRect.width === 0) return; 
                const scrollTop = canvas.scrollTop; const scrollLeft = canvas.scrollLeft;
                const startX = startRect.right - canvasRect.left + scrollLeft; const startY = startRect.top + (startRect.height/2) - canvasRect.top + scrollTop;
                let endX = endRect.left - canvasRect.left + scrollLeft; let endY = endRect.top + (endRect.height/2) - canvasRect.top + scrollTop;
                const controlX = startX + (endX - startX) / 2;
                let pathStr = `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`;
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', pathStr); path.setAttribute('class', conn.type === 'support' ? 'connector-support' : 'connector');
                svg.appendChild(path);
            });
        }
        window.addEventListener('resize', drawLines);
        const canvasContainer = document.getElementById('canvas-container');
        if(canvasContainer) canvasContainer.addEventListener('scroll', () => { requestAnimationFrame(drawLines); });

        // --- EXCEL FILE API ---
        let currentFileHandle = null;

        async function checkStoredHandle() {
            try {
                const handle = await getFileHandle();
                if (handle) {
                    currentFileHandle = handle;
                    const btnConnect = document.getElementById('btn-connect-db');
                    const reconBtn = document.getElementById('btn-reconnect-db');
                    const btnChange = document.getElementById('btn-change-db');
                    
                    if(btnConnect) btnConnect.style.display = 'none';
                    if(reconBtn) reconBtn.style.display = 'block';
                    if(btnChange) btnChange.style.display = 'block';
                }
            } catch (e) { console.log("No stored handle found."); }
        }

        async function disconnectDatabase() {
            if (!FS_API) { disconnectManual(); return; }
            currentFileHandle = null;
            try { await deleteFileHandle(); } catch(e) {}
            
            const btnConnect = document.getElementById('btn-connect-db');
            const reconBtn = document.getElementById('btn-reconnect-db');
            const btnChange = document.getElementById('btn-change-db');
            const activeSync = document.getElementById('active-sync-controls');
            const connStatus = document.getElementById('conn-status');
            
            if(btnConnect) btnConnect.style.display = 'block';
            if(reconBtn) reconBtn.style.display = 'none';
            if(btnChange) btnChange.style.display = 'none';
            if(activeSync) activeSync.style.display = 'none';
            if(connStatus) {
                connStatus.innerText = '🔴 Disconnected';
                connStatus.style.color = 'var(--text-muted)';
            }
        }

        async function connectSharedFile() {
            if (!FS_API) { pickFile('.xlsx', handleManualFile); return; }
            try {
                const [fileHandle] = await window.showOpenFilePicker({
                    id: 'drilling_tracker_sync_id',
                    types: [{ description: 'Excel Files', accept: {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']} }]
                });
                currentFileHandle = fileHandle;
                try { await saveFileHandle(fileHandle); } catch (err) { console.warn('Could not remember the file for next time:', err); }
                await loadFromFile();
            } catch (e) { console.log('File pick cancelled:', e); }
        }

        async function reconnectExcelDatabase() {
            if (!currentFileHandle) return;
            try {
                const options = { mode: 'readwrite' };
                if ((await currentFileHandle.queryPermission(options)) !== 'granted') {
                    if ((await currentFileHandle.requestPermission(options)) !== 'granted') {
                        throw new Error("Permission denied by user.");
                    }
                }
                await loadFromFile();
            } catch (e) {
                console.warn(e);
                alert("Failed to access file. It may have been moved or deleted by OneDrive syncing.\n\nPlease click 'Change File / Disconnect' and select it again.");
            }
        }

        function extractDataFromWorkbook(wb) {
            if(!wb.Sheets["Database_DO_NOT_EDIT"]) return null;
            const dbSheet = wb.Sheets["Database_DO_NOT_EDIT"];
            let jsonStr = ''; let rowIndex = 2; 
            while (dbSheet['A' + rowIndex]) {
                if (dbSheet['A' + rowIndex].v) {
                    jsonStr += dbSheet['A' + rowIndex].v;
                }
                rowIndex++;
            }
            if(!jsonStr) return null;
            try { return JSON.parse(jsonStr); } 
            catch (e) { throw new Error("Database corrupted. Could not parse JSON."); }
        }

        async function loadFromFile(silent = false) {
            try {
                const file = await currentFileHandle.getFile();
                if (file.size === 0) {
                    await saveToFile(true); markConnectedUI();
                    return true;
                }
                const arrayBuffer = await file.arrayBuffer();
                const wb = XLSX.read(new Uint8Array(arrayBuffer), {type: 'array'});
                const parsed = extractDataFromWorkbook(wb);
                
                if (!parsed) {
                    if(confirm("This Excel file does not contain a Tracker Database. Do you want to INITIALIZE it with your current dashboard data?")) {
                        await saveToFile(true);
                        if(!silent) alert("Database Initialized!");
                    } else {
                        throw new Error("Missing Database Sheet!");
                    }
                } else {
                    if(parsed.weeksData && parsed.db) { 
                        const clean = normalizeData(parsed); weeksData = clean.weeksData; db = clean.db; 
                        saveDatabase(); renderFilters(); render(); 
                        if(!silent) updateSyncTime('Pulled');
                    } 
                }
                
                const btnConnect = document.getElementById('btn-connect-db');
                const reconBtn = document.getElementById('btn-reconnect-db');
                const btnChange = document.getElementById('btn-change-db');
                const activeSync = document.getElementById('active-sync-controls');
                const connStatus = document.getElementById('conn-status');
                
                if(btnConnect) btnConnect.style.display = 'none';
                if(reconBtn) reconBtn.style.display = 'none';
                if(btnChange) btnChange.style.display = 'block';
                if(activeSync) activeSync.style.display = 'flex';
                if(connStatus) {
                    connStatus.innerText = '🟢 Connected';
                    connStatus.style.color = '#48bb78';
                }
                
            } catch (e) {
                if(!silent) alert("Error reading file: " + e.message);
                disconnectDatabase();
            }
        }

        async function pullLatestExcel() {
            if (!FS_API) { pickFile('.xlsx', handleManualFile); return; }
            if (!currentFileHandle) return alert("Not connected.");
            await loadFromFile();
        }

        let saveInFlight = false, savePending = false, unsavedToFile = false;
        async function saveToFile(silent = false) {
            if (!FS_API) { downloadFullWorkbook(); return; }   // Safari / Firefox: manual mode
            if (!currentFileHandle) return alert("You are working in Offline Mode. Please 'Connect Shared Database File' first.");
            if (saveInFlight) { savePending = true; return; }  // never run two writes at once
            saveInFlight = true;
            try {
                do {
                    savePending = false; unsavedToFile = false;
                    const writable = await currentFileHandle.createWritable();
                    const wb = generateWorkbook(true);
                    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                    await writable.write(buffer);
                    await writable.close();
                } while (savePending);
                updateSyncTime('Pushed');
                if (!silent) {
                    const btn = document.querySelector('#active-sync-controls button:first-child');
                    if (btn) { const origText = btn.innerHTML; btn.innerHTML = "✅ Pushed!"; setTimeout(() => btn.innerHTML = origText, 2000); }
                }
            } catch (e) {
                unsavedToFile = true; console.error("Save failed:", e);
                if (silent) toast('⚠️ Auto-save to the shared Excel file failed (is it open in desktop Excel?). Your changes are still safe in this browser.', 9000);
                else alert("Failed to save. Make sure the Excel file isn't currently open in the desktop Excel app.");
            } finally { saveInFlight = false; }
        }

        // ADD the includeDatabase toggle here
        function generateWorkbook(includeDatabase = true) {
            let exportData = []; let visibleWeeks = weeksData; 
            let headers = ["Team Member", "Category"]; visibleWeeks.forEach(w => headers.push(`${w.title} (${w.metric})${w.startDate ? ' – from ' + w.startDate : ''}`)); exportData.push(headers);
            
            db.forEach(person => {
                let personPrinted = false;
                person.categories.forEach(cat => {
                    let catPrinted = false;
                    let maxTasks = 0; visibleWeeks.forEach(w => { if(cat[w.key] && cat[w.key].length > maxTasks) maxTasks = cat[w.key].length; });
                    
                    if(maxTasks === 0) {
                        let row = [!personPrinted ? person.name : "", !catPrinted ? cat.name : ""];
                        personPrinted = true; catPrinted = true;
                        visibleWeeks.forEach(w => row.push("")); exportData.push(row);
                    } else {
                        for(let i=0; i<maxTasks; i++) {
                            let row = [!personPrinted ? person.name : "", !catPrinted ? cat.name : ""];
                            personPrinted = true; catPrinted = true;
                            visibleWeeks.forEach(w => {
                                if(cat[w.key] && cat[w.key][i]) row.push(`${cat[w.key][i].name} [${cat[w.key][i].status}]${cat[w.key][i].dueDate ? ' | due ' + cat[w.key][i].dueDate : ''}`); else row.push("");
                            });
                            exportData.push(row);
                        }
                    }
                });
            });
            
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(exportData), "Tracker View");
            
            // ONLY append the hidden database if includeDatabase is true
            if (includeDatabase) {
                const jsonStr = JSON.stringify({ weeksData, db });
                const chunkSize = 30000;
                const dbRows = [['JSON_DATABASE_PAYLOAD']];
                for (let i = 0; i < jsonStr.length; i += chunkSize) {
                    dbRows.push([jsonStr.substring(i, i + chunkSize)]);
                }
                const dbSheet = XLSX.utils.aoa_to_sheet(dbRows);
                XLSX.utils.book_append_sheet(wb, dbSheet, "Database_DO_NOT_EDIT");
            }
            
            return wb;
        }

        function exportOffline() {
            // Passing 'false' skips the Database_DO_NOT_EDIT sheet
            XLSX.writeFile(generateWorkbook(false), "Drilling_Team_Tracker_Offline_Copy.xlsx");
        }

        function importExcelFallback(event) {
            const f = event.target.files && event.target.files[0]; event.target.value = ''; if (f) handleManualFile(f);
        }


        /* ===================================================================
           v12: RIGHT-CLICK MENUS, UNDO/REDO, BACKUPS, SAFARI/FIREFOX SYNC MODE
           =================================================================== */

        // ---------- Toasts (non-blocking feedback) ----------
        function toast(message, duration = 2800, actionLabel = null, actionFn = null) {
            let box = document.getElementById('toast-container');
            if (!box) { box = document.createElement('div'); box.id = 'toast-container'; document.body.appendChild(box); }
            while (box.children.length >= 4) box.removeChild(box.firstChild);
            const t = document.createElement('div'); t.className = 'toast';
            const s = document.createElement('span'); s.textContent = message; t.appendChild(s);
            if (actionLabel) {
                const b = document.createElement('button'); b.type = 'button'; b.textContent = actionLabel;
                b.addEventListener('click', () => { t.remove(); if (actionFn) actionFn(); });
                t.appendChild(b);
            }
            box.appendChild(t); setTimeout(() => t.remove(), duration);
        }

        // ---------- Text-input dialog (replaces prompt()) ----------
        function askText(title, defaultValue = '', placeholder = '', type = 'text') {
            return new Promise(resolve => {
                const ov = document.createElement('div'); ov.id = 'dialog-overlay';
                const box = document.createElement('div'); box.className = 'dialog-box';
                const h = document.createElement('div'); h.className = 'dialog-title'; h.textContent = title;
                const inp = document.createElement('input'); inp.type = type; inp.value = defaultValue; inp.placeholder = placeholder; inp.maxLength = 200;
                const row = document.createElement('div'); row.className = 'dialog-row';
                const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'dlg-cancel'; cancel.textContent = 'Cancel';
                const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'dlg-ok'; ok.textContent = 'OK';
                const done = (v) => { ov.remove(); resolve(v); };
                ok.addEventListener('click', () => { const v = inp.value.trim(); if (v) done(v); else inp.focus(); });
                cancel.addEventListener('click', () => done(null));
                inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ok.click(); else if (e.key === 'Escape') cancel.click(); });
                ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(null); });
                row.appendChild(cancel); row.appendChild(ok);
                box.appendChild(h); box.appendChild(inp); box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov);
                inp.focus(); try { inp.select(); } catch (e) {}
            });
        }

        function pickFile(accept, handler) {
            const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
            inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) handler(f); });
            document.body.appendChild(inp); inp.click();
        }
        function readAsArrayBuffer(file) {
            return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('Could not read file')); r.readAsArrayBuffer(file); });
        }
        function readAsText(file) {
            return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('Could not read file')); r.readAsText(file); });
        }

        // ---------- Undo / Redo ----------
        let undoStack = [], redoStack = [], lastSnapshot = null, lastCoalesce = { key: null, t: 0 };
        const UNDO_LIMIT = 60;
        function currentSnapshot() { return JSON.stringify({ weeksData, db }); }
        function recordSnapshot(coalesceKey) {
            const cur = currentSnapshot();
            if (lastSnapshot === null) { lastSnapshot = cur; return; }
            if (cur === lastSnapshot) return;
            const now = Date.now();
            if (coalesceKey && lastCoalesce.key === coalesceKey && now - lastCoalesce.t < 1500) { lastSnapshot = cur; lastCoalesce.t = now; return; }
            undoStack.push(lastSnapshot); if (undoStack.length > UNDO_LIMIT) undoStack.shift();
            redoStack = []; lastSnapshot = cur; lastCoalesce = { key: coalesceKey || null, t: now };
        }
        function closeEditor() {
            activeNode = null;
            const f = document.getElementById('edit-form'); if (f) { f.style.display = 'none'; f.innerHTML = ''; }
            const n = document.getElementById('no-selection'); if (n) n.style.display = 'block';
        }
        function applySnapshot(str) {
            const clean = normalizeData(JSON.parse(str));
            weeksData = clean.weeksData; db = clean.db;
            hiddenPersons = new Set([...hiddenPersons].filter(id => db.some(p => p.id === id)));
            hiddenWeeks = new Set([...hiddenWeeks].filter(k => weeksData.some(w => w.key === k)));
            lastSnapshot = currentSnapshot(); closeEditor();
            saveDatabase(); renderFilters(); render();
        }
        function undo() {
            if (!undoStack.length) { toast('Nothing to undo.'); return; }
            redoStack.push(lastSnapshot); applySnapshot(undoStack.pop()); toast('Undone. (Ctrl+Y to redo)');
        }
        function redo() {
            if (!redoStack.length) { toast('Nothing to redo.'); return; }
            undoStack.push(lastSnapshot); applySnapshot(redoStack.pop()); toast('Redone.');
        }

        // ---------- Backup / restore (JSON) ----------
        function dateStamp() { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); }
        function downloadBackup() {
            const payload = { format: 'team-tracker-backup', version: 12, exportedAt: new Date().toISOString(), weeksData, db };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Team_Tracker_backup_' + dateStamp() + '.json';
            document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            toast('Backup downloaded.');
        }
        async function restoreBackupFile(file) {
            try {
                const clean = normalizeData(JSON.parse(await readAsText(file)));
                if (!confirm('Replace the current board with this backup?\n\n' + clean.db.length + ' team member(s), ' + clean.weeksData.length + ' week(s).\nYou can undo this with Ctrl+Z until you reload the page.')) return;
                weeksData = clean.weeksData; db = clean.db; hiddenPersons = new Set(); hiddenWeeks = new Set(); closeEditor();
                saveDatabase(); renderFilters(); render(); toast('Backup restored.', 7000, 'Undo', undo);
            } catch (e) { alert('Could not read this backup file: ' + e.message); }
        }

        // ---------- Sync for browsers WITHOUT the File System Access API (Safari, Firefox) ----------
        const FS_API = typeof window.showOpenFilePicker === 'function';
        let manualFileName = null; try { manualFileName = localStorage.getItem('drilling_tracker_manual_file'); } catch (e) {}
        let manualDirty = false;

        function setManualFile(name) {
            manualFileName = name; manualDirty = false;
            try { if (name) localStorage.setItem('drilling_tracker_manual_file', name); else localStorage.removeItem('drilling_tracker_manual_file'); } catch (e) {}
            refreshSyncUI();
        }
        function refreshSyncUI() {
            if (FS_API) return; // Chrome / Edge use the original live-sync code
            const $ = (id) => document.getElementById(id);
            const btnConnect = $('btn-connect-db'), btnChange = $('btn-change-db'), reconBtn = $('btn-reconnect-db');
            const activeSync = $('active-sync-controls'), connStatus = $('conn-status'), note = $('manual-mode-note');
            if (reconBtn) reconBtn.style.display = 'none';
            if (note) {
                note.style.display = 'block';
                note.textContent = 'ℹ️ This browser (Safari/Firefox) cannot write straight into a shared file, so the dashboard uses manual mode: open the shared Excel file to load it, then use "Save copy" to download an updated file and replace the original on OneDrive/SharePoint. For automatic live sync, use Chrome or Edge. Your work is always kept in this browser too.';
            }
            if (manualFileName) {
                if (btnConnect) btnConnect.style.display = 'none';
                if (btnChange) btnChange.style.display = 'block';
                if (activeSync) {
                    activeSync.style.display = 'flex';
                    const bs = activeSync.querySelectorAll('button');
                    if (bs[0]) bs[0].textContent = '⬇️ Save copy (Ctrl+S)';
                    if (bs[1]) bs[1].textContent = '📂 Load updates';
                }
                if (connStatus) { connStatus.textContent = (manualDirty ? '🟠 Manual · unsaved changes · ' : '🟡 Manual · ') + manualFileName; connStatus.style.color = manualDirty ? '#ed8936' : '#ecc94b'; }
            } else {
                if (btnConnect) { btnConnect.style.display = 'block'; btnConnect.textContent = '📂 Open Shared Database File (manual mode)'; }
                if (btnChange) btnChange.style.display = 'none';
                if (activeSync) activeSync.style.display = 'none';
                if (connStatus) { connStatus.textContent = '🔴 Disconnected'; connStatus.style.color = 'var(--text-muted)'; }
            }
        }
        function markConnectedUI() {
            const $ = (id) => document.getElementById(id);
            if ($('btn-connect-db')) $('btn-connect-db').style.display = 'none';
            if ($('btn-reconnect-db')) $('btn-reconnect-db').style.display = 'none';
            if ($('btn-change-db')) $('btn-change-db').style.display = 'block';
            if ($('active-sync-controls')) $('active-sync-controls').style.display = 'flex';
            if ($('conn-status')) { $('conn-status').innerText = '🟢 Connected'; $('conn-status').style.color = '#48bb78'; }
        }
        function disconnectManual() { setManualFile(null); }
        function downloadFullWorkbook() {
            if (typeof XLSX === 'undefined') { alert('The Excel library has not finished loading. Please try again in a moment.'); return; }
            const name = manualFileName || ('Team_Tracker_' + dateStamp() + '.xlsx');
            XLSX.writeFile(generateWorkbook(true), name);
            manualDirty = false; updateSyncTime('Saved copy'); refreshSyncUI();
            toast('Downloaded "' + name + '". Replace the original file on your shared drive with it so teammates get your changes.', 9000);
        }
        async function handleManualFile(file) {
            try {
                const wb = XLSX.read(new Uint8Array(await readAsArrayBuffer(file)), { type: 'array' });
                const parsed = extractDataFromWorkbook(wb);
                if (!parsed) {
                    if (!confirm('This Excel file does not contain a Tracker database yet.\n\nInitialise it with the data currently on your board? A new copy will be downloaded — save it over the original.')) return;
                    setManualFile(file.name); downloadFullWorkbook(); return;
                }
                const clean = normalizeData(parsed);
                weeksData = clean.weeksData; db = clean.db; closeEditor();
                setManualFile(file.name); saveDatabase(); manualDirty = false;
                renderFilters(); render(); updateSyncTime('Loaded'); refreshSyncUI();
                toast('Loaded "' + file.name + '".', 5000, 'Undo', undo);
            } catch (err) { alert('Could not read this file: ' + err.message); }
        }

        // ---------- Lookup helpers ----------
        function findCatById(id) { for (const p of db) { const c = p.categories.find(c => c.id === id); if (c) return { person: p, cat: c }; } return null; }
        function locateTask(taskId) {
            for (const person of db) for (const cat of person.categories) for (const w of weeksData) {
                const arr = cat[w.key]; if (!Array.isArray(arr)) continue;
                const index = arr.findIndex(t => t.id === taskId);
                if (index > -1) return { person, cat, weekKey: w.key, index, task: arr[index] };
            }
            return null;
        }
        function weekIndexByKey(k) { return weeksData.findIndex(w => w.key === k); }
        function openEditorForNode(node) {
            const panel = document.getElementById('editor-panel');
            if (panel && panel.classList.contains('hidden')) toggleSidebar();
            openEditor(node);
        }
        function flashNode(id) {
            setTimeout(() => {
                const el = document.getElementById(id); if (!el) return;
                if (el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); } catch (e) {} }
                el.classList.add('flash-hl'); setTimeout(() => el.classList.remove('flash-hl'), 1400);
            }, 80);
        }
        function newCategory(name) { const c = { id: generateId(), type: 'category', name }; weeksData.forEach(w => c[w.key] = []); return c; }

        // ---------- Actions ----------
        async function addPersonFlow() {
            const name = await askText('New team member', '', 'Name');
            if (!name) return;
            const p = { id: generateId(), type: 'person', name, categories: [newCategory('GENERAL')] };
            db.push(p); saveDatabase(); renderFilters(); render(); flashNode(p.id);
            toast('Added ' + name + '. Right-click a week column to add tasks.');
        }
        function addPerson() { addPersonFlow(); }
        async function addCategoryFlow(person) {
            const name = await askText('New category for ' + person.name, '', 'e.g. HYDRAULICS');
            if (!name) return;
            const c = newCategory(name); person.categories.push(c); saveDatabase(); render(); flashNode(c.id);
        }
        async function addTaskFlow(cat, weekKey) {
            const w = weeksData[weekIndexByKey(weekKey)];
            const name = await askText('New task' + (w ? ' – ' + w.title : ''), '', 'Task title');
            if (!name) return;
            const t = { id: generateId(), type: 'task', name, priority: 'Minor', status: 'TODO', jiraId: '', supportPersonId: null, supportPersonId2: null, flag: 'none', subtasks: [], history: [] };
            logHistory(t, 'Task Status', '', 'Created via right-click menu');
            if (!Array.isArray(cat[weekKey])) cat[weekKey] = [];
            cat[weekKey].push(t); saveDatabase(); render(); flashNode(t.id);
        }
        async function renameFlow(node, label) {
            const v = await askText('Rename ' + label, node.name);
            if (!v || v === node.name) return;
            node.name = v; saveDatabase(); renderFilters(); render();
            if (activeNode === node) openEditor(node);
        }
        async function renameWeekFlow(index) {
            const w = weeksData[index]; if (!w) return;
            const v = await askText('Rename week', w.title);
            if (!v || v === w.title) return;
            w.title = v; saveDatabase(); renderFilters(); render();
        }
        async function addWeekFlow(afterIndex) {
            const name = await askText('New week name', 'WEEK ' + (weeksData.length + 1));
            if (!name) return;
            if (afterIndex === null || afterIndex === undefined || afterIndex >= weeksData.length - 1) { addWeek(name); return; }
            const key = 'wk_' + generateId().slice(3);
            weeksData.splice(afterIndex + 1, 0, { key, title: name, metric: 'Hi: 0.00', collapsed: false, startDate: weeksData[afterIndex].startDate ? addDaysISO(weeksData[afterIndex].startDate, 7) : '' });
            db.forEach(p => p.categories.forEach(c => c[key] = []));
            hiddenWeeks.delete(key); saveDatabase(); renderFilters(); render();
        }
        function moveInArray(arr, from, to) { if (from < 0 || to < 0 || to >= arr.length) return false; const [x] = arr.splice(from, 1); arr.splice(to, 0, x); return true; }
        function movePerson(p, d) { if (moveInArray(db, db.indexOf(p), db.indexOf(p) + d)) { saveDatabase(); renderFilters(); render(); flashNode(p.id); } }
        function moveCategory(person, cat, d) { const i = person.categories.indexOf(cat); if (moveInArray(person.categories, i, i + d)) { saveDatabase(); render(); flashNode(cat.id); } }
        const FLAG_LABELS = { none: 'None (Default)', pending: 'Pending (Yellow)', backlog: 'Backlog (Red)', completed: 'Completed (Green)' };
        function setTaskPriority(task, p) {
            if (task.priority === p) return;
            logHistory(task, 'priority', task.priority, p); task.priority = p; saveDatabase(); render();
            if (activeNode && activeNode.id === task.id) openEditor(task);
        }
        function setTaskFlag(task, f) {
            if (task.flag === f) return;
            logHistory(task, 'flag', FLAG_LABELS[task.flag] || task.flag, FLAG_LABELS[f]); task.flag = f; stampCompletion(task); saveDatabase(); render();
            if (activeNode && activeNode.id === task.id) openEditor(task);
        }
        function toggleSupporter(task, person) {
            const nm = (id) => { const p = db.find(x => x.id === id); return p ? p.name : 'None'; };
            if (task.supportPersonId === person.id) { logHistory(task, 'supportPersonId', person.name, 'None'); task.supportPersonId = null; }
            else if (task.supportPersonId2 === person.id) { logHistory(task, 'supportPersonId2', person.name, 'None'); task.supportPersonId2 = null; }
            else if (!task.supportPersonId) { logHistory(task, 'supportPersonId', nm(null), person.name); task.supportPersonId = person.id; }
            else if (!task.supportPersonId2) { logHistory(task, 'supportPersonId2', nm(null), person.name); task.supportPersonId2 = person.id; }
            else { toast('A task can have up to 2 supporting people.'); return; }
            saveDatabase(); render(); if (activeNode && activeNode.id === task.id) openEditor(task);
        }
        function duplicateTask(loc) {
            const clone = JSON.parse(JSON.stringify(loc.task));
            clone.id = generateId(); clone.flag = 'none'; clone.completedDate = ''; clone.history = [];
            clone.subtasks.forEach(s => { s.id = generateId(); s.completed = false; });
            logHistory(clone, 'Action', '', 'Duplicated from "' + loc.task.name + '"');
            loc.cat[loc.weekKey].splice(loc.index + 1, 0, clone); saveDatabase(); render(); flashNode(clone.id);
        }
        function carryForwardTask(loc) {
            const srcIdx = weekIndexByKey(loc.weekKey); const nextIdx = srcIdx + 1;
            if (nextIdx >= weeksData.length) addWeek();
            const next = weeksData[nextIdx]; if (!next) return;
            hiddenWeeks.delete(next.key);
            const clone = JSON.parse(JSON.stringify(loc.task)); clone.id = generateId();
            logHistory(clone, 'Action', weeksData[srcIdx].title, 'Carried forward to ' + next.title);
            if (!Array.isArray(loc.cat[next.key])) loc.cat[next.key] = [];
            loc.cat[next.key].push(clone); saveDatabase(); renderFilters(); render(); flashNode(clone.id);
            toast('Carried forward to ' + next.title + '.');
        }
        function openOriginalTask(taskId) {
            const loc = locateTask(taskId); if (!loc) return;
            hiddenWeeks.delete(loc.weekKey); hiddenPersons.delete(loc.person.id); renderFilters(); render();
            openEditorForNode(loc.task); flashNode(loc.task.id);
        }
        function setAllWeeksCollapsed(v) { weeksData.forEach(w => w.collapsed = v); saveDatabase(); render(); }
        function showEverything() { hiddenPersons.clear(); hiddenWeeks.clear(); renderFilters(); render(); }
        function showOnlyPerson(p) { hiddenPersons = new Set(db.filter(x => x !== p).map(x => x.id)); renderFilters(); render(); }

        // Deleting: original confirm dialogs stay; a toast offers one-click Undo.
        function deleteActiveNode() { const b = lastSnapshot; _deleteActiveNodeCore(); if (lastSnapshot !== b) toast('Deleted.', 8000, 'Undo', undo); }
        function deleteWeek(i) { const b = lastSnapshot; _deleteWeekCore(i); if (lastSnapshot !== b) toast('Week deleted.', 8000, 'Undo', undo); }
        function deleteNodeViaMenu(node) { const prev = activeNode; activeNode = node; deleteActiveNode(); if (activeNode === node) activeNode = prev; }

        // ---------- Menu rendering ----------
        const quickMenu = document.getElementById('quick-menu');
        let quickSub = null, menuOpenedAt = 0;
        function getSub() {
            if (!quickSub) {
                quickSub = document.createElement('div'); quickSub.id = 'quick-submenu'; quickSub.setAttribute('role', 'menu'); quickSub.tabIndex = -1;
                quickSub.addEventListener('keydown', (e) => {
                    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); const p = quickMenu && quickMenu.querySelector('.qm-btn.open'); closeSubmenu(); if (p) p.focus(); }
                    else menuKeyNav(quickSub, e);
                });
                document.body.appendChild(quickSub);
            }
            return quickSub;
        }
        function closeSubmenu() {
            if (quickSub) { quickSub.classList.remove('active'); quickSub.innerHTML = ''; }
            if (quickMenu) quickMenu.querySelectorAll('.qm-btn.open').forEach(b => b.classList.remove('open'));
        }
        function closeContextMenu() { closeSubmenu(); if (quickMenu) { quickMenu.classList.remove('active'); quickMenu.innerHTML = ''; } }
        function cleanMenuItems(raw) {
            const items = []; raw.filter(Boolean).forEach(it => { if (it.divider && (!items.length || items[items.length - 1].divider)) return; items.push(it); });
            while (items.length && items[items.length - 1].divider) items.pop(); return items;
        }
        function placeMenu(el, x, y) {
            const w = el.offsetWidth || 240, h = el.offsetHeight || 200;
            el.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
            el.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
        }
        function menuKeyNav(container, e) {
            const btns = [...container.querySelectorAll('.qm-btn:not(:disabled)')]; if (!btns.length) return;
            const i = btns.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i <= 0 ? btns.length : i) - 1].focus(); }
            else if (e.key === 'Home') { e.preventDefault(); btns[0].focus(); }
            else if (e.key === 'End') { e.preventDefault(); btns[btns.length - 1].focus(); }
        }
        function openSubmenu(anchor, items, focusFirst) {
            closeSubmenu(); const sub = getSub(); fillMenu(sub, items, true); anchor.classList.add('open'); sub.classList.add('active');
            const r = anchor.getBoundingClientRect(); const w = sub.offsetWidth || 200;
            const cr = quickMenu.getBoundingClientRect(); let x = cr.right + 4; if (x + w > window.innerWidth - 8) x = Math.max(8, cr.left - w - 4);
            placeMenu(sub, x, r.top - 8);
            if (focusFirst) { const b = sub.querySelector('.qm-btn:not(:disabled)'); if (b) b.focus(); }
        }
        function fillMenu(container, rawItems, isSub) {
            container.innerHTML = ''; container.setAttribute('role', 'menu'); container.tabIndex = -1;
            cleanMenuItems(rawItems).forEach(it => {
                if (it.divider) { const d = document.createElement('div'); d.className = 'qm-divider'; container.appendChild(d); return; }
                if (it.header) { const h = document.createElement('div'); h.className = 'qm-header'; h.textContent = it.header; container.appendChild(h); return; }
                const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
                b.className = 'qm-btn' + (it.danger ? ' danger' : '');
                const lab = document.createElement('span'); lab.className = 'qm-label'; lab.textContent = (it.icon ? it.icon + '  ' : '') + it.label; b.appendChild(lab);
                if (it.checked) { const c = document.createElement('span'); c.className = 'qm-check'; c.textContent = '✓'; b.appendChild(c); }
                if (it.submenu) { const a = document.createElement('span'); a.className = 'qm-arrow'; a.textContent = '▸'; b.appendChild(a); b.setAttribute('aria-haspopup', 'true'); }
                if (it.disabled) b.disabled = true;
                if (it.submenu) {
                    b.addEventListener('mouseenter', () => { if (!b.disabled) openSubmenu(b, it.submenu, false); });
                    b.addEventListener('click', (ev) => { ev.stopPropagation(); openSubmenu(b, it.submenu, true); });
                    b.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); openSubmenu(b, it.submenu, true); } });
                } else {
                    if (!isSub) b.addEventListener('mouseenter', closeSubmenu);
                    b.addEventListener('click', (ev) => {
                        ev.stopPropagation(); closeContextMenu();
                        try { const r = it.action && it.action(); if (r && r.catch) r.catch(err => { console.error(err); toast('Something went wrong: ' + err.message); }); }
                        catch (err) { console.error(err); toast('Something went wrong: ' + err.message); }
                    });
                }
                container.appendChild(b);
            });
        }
        function showMenu(x, y, rawItems) {
            if (!quickMenu) return;
            closeSubmenu(); fillMenu(quickMenu, rawItems, false);
            quickMenu.classList.add('active'); menuOpenedAt = Date.now(); placeMenu(quickMenu, x, y);
            try { quickMenu.focus({ preventScroll: true }); } catch (e) {}
        }
        if (quickMenu) quickMenu.addEventListener('keydown', (e) => menuKeyNav(quickMenu, e));
        document.addEventListener('click', closeContextMenu);
        window.addEventListener('blur', closeContextMenu);
        window.addEventListener('resize', closeContextMenu);
        const _cv = document.getElementById('canvas-container');
        if (_cv) _cv.addEventListener('scroll', () => { if (Date.now() - menuOpenedAt > 400) closeContextMenu(); }, { passive: true });

        // ---------- Menu contents ----------
        function canvasMenuItems() {
            return [
                { header: 'Board' },
                { icon: '👤', label: 'Add team member…', action: addPersonFlow },
                { icon: '📅', label: 'Add week…', action: () => addWeekFlow(null) },
                { icon: '📆', label: 'Set week dates…', action: autoDateWeeksFlow },
                { divider: true },
                { icon: '📊', label: 'Analytics dashboard', action: () => openAnalytics('overview') },
                { icon: '🗓️', label: 'Deadline timeline', action: () => openAnalytics('timeline') },
                { divider: true },
                { icon: '↶', label: 'Undo', disabled: !undoStack.length, action: undo },
                { icon: '↷', label: 'Redo', disabled: !redoStack.length, action: redo },
                { divider: true },
                { icon: '👁️', label: 'View', submenu: [
                    weeksData.some(w => !w.collapsed) ? { icon: '◂', label: 'Collapse all weeks', action: () => setAllWeeksCollapsed(true) } : null,
                    weeksData.some(w => w.collapsed) ? { icon: '▸', label: 'Expand all weeks', action: () => setAllWeeksCollapsed(false) } : null,
                    (hiddenPersons.size || hiddenWeeks.size) ? { icon: '👥', label: 'Clear filters (show everything)', action: showEverything } : null,
                    { icon: '🌓', label: 'Switch light / dark theme', action: toggleTheme }
                ] },
                { icon: '💾', label: 'Backup & export', submenu: [
                    { icon: '💾', label: 'Download full backup (JSON)', action: downloadBackup },
                    { icon: '📥', label: 'Restore from backup…', action: () => pickFile('.json,application/json', restoreBackupFile) },
                    { icon: '📊', label: 'Export Excel report', action: exportOffline }
                ] }
            ];
        }
        function personMenuItems(p) {
            const i = db.indexOf(p);
            return [
                { header: 'Team member · ' + p.name },
                { icon: '✏️', label: 'Rename…', action: () => renameFlow(p, 'team member') },
                { icon: '➕', label: 'Add category…', action: () => addCategoryFlow(p) },
                { icon: '🗂️', label: 'Open in side panel', action: () => openEditorForNode(p) },
                { divider: true },
                { icon: '⬆️', label: 'Move up', disabled: i <= 0, action: () => movePerson(p, -1) },
                { icon: '⬇️', label: 'Move down', disabled: i >= db.length - 1, action: () => movePerson(p, 1) },
                db.length > 1 ? { icon: '👁️', label: 'Show only this person', action: () => showOnlyPerson(p) } : null,
                hiddenPersons.size ? { icon: '👥', label: 'Show everyone', action: showEverything } : null,
                { divider: true },
                { icon: '🗑️', label: 'Delete team member…', danger: true, action: () => deleteNodeViaMenu(p) }
            ];
        }
        function categoryMenuItems(person, cat) {
            const i = person.categories.indexOf(cat);
            const open = getVisibleWeeks().filter(w => !w.collapsed);
            return [
                { header: 'Category · ' + cat.name },
                { icon: '➕', label: 'Add task to week', disabled: !open.length, submenu: open.map(w => ({ icon: '📅', label: w.title, action: () => addTaskFlow(cat, w.key) })) },
                { icon: '✏️', label: 'Rename…', action: () => renameFlow(cat, 'category') },
                { icon: '🗂️', label: 'Open in side panel', action: () => openEditorForNode(cat) },
                { divider: true },
                { icon: '⬆️', label: 'Move up', disabled: i <= 0, action: () => moveCategory(person, cat, -1) },
                { icon: '⬇️', label: 'Move down', disabled: i >= person.categories.length - 1, action: () => moveCategory(person, cat, 1) },
                { divider: true },
                { icon: '🗑️', label: 'Delete category…', danger: true, action: () => deleteNodeViaMenu(cat) }
            ];
        }
        function taskMenuItems(loc) {
            const t = loc.task; const nextW = weeksData[weekIndexByKey(loc.weekKey) + 1];
            const prioIcon = { Minor: '🔽', Major: '🔼', Critical: '⏫', Blocker: '⛔' };
            const flagIcon = { none: '⚪', pending: '🟡', backlog: '🔴', completed: '🟢' };
            const flagShort = { none: 'None', pending: 'Pending', backlog: 'Backlog', completed: 'Completed' };
            const others = db.filter(p => p.id !== loc.person.id);
            return [
                { header: 'Task' },
                { icon: '✏️', label: 'Edit in side panel', action: () => openEditorForNode(t) },
                { icon: '⊕', label: 'Add sub-task…', action: () => quickAddSubtask(null, t.id) },
                { icon: '📄', label: 'Duplicate', action: () => duplicateTask(loc) },
                { icon: '➡️', label: 'Carry forward to ' + (nextW ? nextW.title : 'a new week'), action: () => carryForwardTask(loc) },
                { divider: true },
                { icon: '📆', label: 'Deadline' + (t.dueDate ? ' · ' + fmtShort(t.dueDate) : ''), submenu: [
                    { icon: '📆', label: 'Pick date…', action: () => pickDeadline(t) },
                    { icon: '☀️', label: 'Today', action: () => setTaskDue(t, todayISO()) },
                    { icon: '🌅', label: 'Tomorrow', action: () => setTaskDue(t, addDaysISO(todayISO(), 1)) },
                    { icon: '🗓️', label: 'In 1 week', action: () => setTaskDue(t, addDaysISO(todayISO(), 7)) },
                    t.dueDate ? { divider: true } : null,
                    t.dueDate ? { icon: '✖️', label: 'Clear deadline', action: () => setTaskDue(t, '') } : null
                ] },
                { icon: prioIcon[t.priority] || '🔽', label: 'Priority · ' + t.priority, submenu: PRIORITIES.slice().reverse().map(p => ({ icon: prioIcon[p], label: p, checked: t.priority === p, action: () => setTaskPriority(t, p) })) },
                { icon: flagIcon[t.flag] || '⚪', label: 'Status · ' + (flagShort[t.flag] || 'None'), submenu: FLAGS.map(f => ({ icon: flagIcon[f], label: FLAG_LABELS[f], checked: t.flag === f, action: () => setTaskFlag(t, f) })) },
                others.length ? { icon: '🤝', label: 'Supporting people', submenu: others.map(o => ({ icon: '🤝', label: o.name, checked: t.supportPersonId === o.id || t.supportPersonId2 === o.id, action: () => toggleSupporter(t, o) })) } : null,
                { divider: true },
                { icon: '🗑️', label: 'Delete task…', danger: true, action: () => deleteNodeViaMenu(t) }
            ];
        }
        function ghostMenuItems(taskId) {
            return [{ header: 'Supporting task' }, { icon: '🔎', label: 'Open original task', action: () => openOriginalTask(taskId) }];
        }
        function weekMenuItems(i) {
            const w = weeksData[i];
            return [
                { header: 'Week · ' + w.title },
                { icon: '✏️', label: 'Rename…', action: () => renameWeekFlow(i) },
                { icon: '📆', label: 'Set start date…', action: () => setWeekStartFlow(i) },
                { icon: '📅', label: 'Add week after this one…', action: () => addWeekFlow(i) },
                { icon: w.collapsed ? '▸' : '◂', label: w.collapsed ? 'Expand week' : 'Collapse week', action: () => toggleWeekCollapse(i) },
                { divider: true },
                { icon: '🗑️', label: 'Delete week…', danger: true, action: () => deleteWeek(i) }
            ];
        }
        function columnMenuItems(person, cat, weekKey) {
            const wi = weekIndexByKey(weekKey); const w = weeksData[wi]; const items = [{ header: person.name + ' · ' + cat.name }];
            if (w && !w.collapsed) items.push({ icon: '➕', label: 'Add task here (' + w.title + ')…', action: () => addTaskFlow(cat, weekKey) });
            else if (w) items.push({ icon: '▸', label: 'Expand ' + w.title, action: () => toggleWeekCollapse(wi) });
            items.push({ icon: '🗂️', label: 'Add category to ' + person.name + '…', action: () => addCategoryFlow(person) });
            items.push({ divider: true }); return items.concat(canvasMenuItems());
        }
        // Left-click on person / category names keeps opening the same menu as before.
        function openContextMenu(e, type, nodeData, parentPerson = null) {
            e.preventDefault(); e.stopPropagation();
            showMenu(e.clientX, e.clientY, type === 'person' ? personMenuItems(nodeData) : categoryMenuItems(parentPerson, nodeData));
        }

        function onBoardContextMenu(e) {
            const t = e.target; if (!(t instanceof Element)) return;
            if (t.closest('#quick-menu, #quick-submenu')) { e.preventDefault(); return; }
            closeContextMenu();
            if (t.closest('input, textarea, select, [contenteditable="true"], #editor-panel, #dialog-overlay, #toast-container, #top-bar, #analytics-overlay')) return; // native menu (copy / paste) there
            if (!t.closest('#main-view')) return;
            e.preventDefault();
            const x = e.clientX, y = e.clientY;
            const card = t.closest('.task-card');
            if (card) {
                if (card.id.startsWith('ghost_')) return showMenu(x, y, ghostMenuItems(card.id.slice(6)));
                const loc = locateTask(card.id); if (loc) return showMenu(x, y, taskMenuItems(loc));
            }
            const pn = t.closest('.node-person');
            if (pn) { const p = db.find(q => q.id === pn.id); if (p) return showMenu(x, y, personMenuItems(p)); }
            const cn = t.closest('.node-cat:not(.support-cat)');
            if (cn) { const f = findCatById(cn.id); if (f) return showMenu(x, y, categoryMenuItems(f.person, f.cat)); }
            const hw = t.closest('.header-week[data-week-key]');
            if (hw) { const i = weekIndexByKey(hw.dataset.weekKey); if (i > -1) return showMenu(x, y, weekMenuItems(i)); }
            const col = t.closest('.col-week[data-cat-id]');
            if (col) { const f = findCatById(col.dataset.catId); if (f) return showMenu(x, y, columnMenuItems(f.person, f.cat, col.dataset.weekKey)); }
            showMenu(x, y, canvasMenuItems());
        }
        document.addEventListener('contextmenu', onBoardContextMenu);

        // ---------- Keyboard + safety nets ----------
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { closeContextMenu(); return; }
            if (!(e.ctrlKey || e.metaKey)) return;
            const tg = e.target; const typing = tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable);
            if (typing) return;
            const k = (e.key || '').toLowerCase();
            if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
            else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
        });
        window.addEventListener('beforeunload', (e) => { if (unsavedToFile) { e.preventDefault(); e.returnValue = ''; } });
        window.addEventListener('storage', (e) => {
            if (e.key === 'drilling_tracker_db_v10' && e.newValue) toast('⚠️ This board was changed in another browser tab. Reload to see it — saving here would overwrite it.', 10000);
        });



        /* ===================================================================
           v13: TOP BAR, DEADLINES, WEEK DATES, ANALYTICS DASHBOARD + TIMELINE
           =================================================================== */

        // ---------- Date helpers (all dates are local 'YYYY-MM-DD' strings) ----------
        function pad2(n) { return String(n).padStart(2, '0'); }
        function parseISO(s) {
            if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
            const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d);
            return (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) ? dt : null;
        }
        function toISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
        function todayISO() { return toISO(new Date()); }
        function cleanISO(s) { return parseISO(s) ? s : ''; }
        function addDaysISO(iso, n) { const d = parseISO(iso) || new Date(); d.setDate(d.getDate() + n); return toISO(d); }
        function daysBetweenISO(a, b) {
            const A = parseISO(a), B = parseISO(b); if (!A || !B) return null;
            return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 86400000);
        }
        function fmtShort(iso) { const d = parseISO(iso); return d ? d.getDate() + ' ' + d.toLocaleString('default', { month: 'short' }) : ''; }
        function fmtRange(startISO) { return parseISO(startISO) ? fmtShort(startISO) + ' – ' + fmtShort(addDaysISO(startISO, 6)) : ''; }
        function isCurrentWeek(w) { const d = daysBetweenISO(w.startDate, todayISO()); return d !== null && d >= 0 && d <= 6; }
        function weekDatesHtml(w) {
            if (!w.startDate) return '';
            const now = isCurrentWeek(w);
            return '<div class="week-dates' + (now ? ' is-now' : '') + '">' + esc(fmtRange(w.startDate)) + (now ? ' · THIS WEEK' : '') + '</div>';
        }
        function nextWeekStart() { const dated = [...weeksData].reverse().find(w => w.startDate); return dated ? addDaysISO(dated.startDate, 7) : ''; }

        // ---------- Deadlines ----------
        function stampCompletion(t) { if (t.flag === 'completed') { if (!t.completedDate) t.completedDate = todayISO(); } else { t.completedDate = ''; } }
        function dueInfo(t) {
            if (!t.dueDate) return null;
            const days = daysBetweenISO(todayISO(), t.dueDate); if (days === null) return null;
            if (t.flag === 'completed') return { cls: 'due-done', label: '✓ ' + fmtShort(t.dueDate), days };
            if (days < 0) return { cls: 'due-over', label: '⏰ ' + (-days) + 'd overdue · ' + fmtShort(t.dueDate), days };
            if (days === 0) return { cls: 'due-soon', label: '⏳ Due today', days };
            if (days <= 2) return { cls: 'due-soon', label: '⏳ Due in ' + days + 'd · ' + fmtShort(t.dueDate), days };
            return { cls: 'due-ok', label: '📅 ' + fmtShort(t.dueDate), days };
        }
        function isOverdue(t) { const i = dueInfo(t); return !!i && i.cls === 'due-over'; }
        function dueChipHtml(t) { const i = dueInfo(t); return i ? '<div class="due-badge ' + i.cls + '">' + esc(i.label) + '</div>' : ''; }
        function setTaskDue(task, iso) {
            iso = cleanISO(iso); if ((task.dueDate || '') === iso) return;
            logHistory(task, 'Deadline', task.dueDate || 'None', iso || 'None');
            task.dueDate = iso; saveDatabase(); render();
            if (activeNode && activeNode.id === task.id) openEditor(task);
        }
        function setDueQuick(days) { if (activeNode && activeNode.type === 'task') setTaskDue(activeNode, days === null ? '' : addDaysISO(todayISO(), days)); }
        async function pickDeadline(task) {
            const v = await askText('Deadline for "' + String(task.name).slice(0, 40) + '"', task.dueDate || todayISO(), '', 'date');
            if (v) setTaskDue(task, v);
        }
        async function setWeekStartFlow(i) {
            const w = weeksData[i]; if (!w) return;
            const v = await askText('Start date of "' + w.title + '"', w.startDate || todayISO(), '', 'date');
            if (!v) return; w.startDate = cleanISO(v); saveDatabase(); render(); toast('Week date set.');
        }
        async function autoDateWeeksFlow() {
            const first = weeksData[0] && weeksData[0].startDate;
            const v = await askText('Start date of the FIRST week (later weeks follow 7 days apart)', first || todayISO(), '', 'date');
            if (!v) return; weeksData.forEach((w, i) => { w.startDate = addDaysISO(v, i * 7); });
            saveDatabase(); render(); toast('Week dates set.');
        }
        function scrollToToday() {
            const el = document.querySelector('.header-week.current-week');
            if (!el) { toast('No week contains today yet. Right-click the board ▸ Set week dates…', 6000); return; }
            if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }

        // ---------- Analytics: data ----------
        let anTab = 'overview', anPerson = 'all', anScope = 'all', anZoom = 22;
        const AN_STATUS = [ { k: 'completed', label: 'Completed' }, { k: 'pending', label: 'Pending' }, { k: 'backlog', label: 'Backlog' }, { k: 'open', label: 'Open (no flag)' } ];
        const PRIO_ORDER = ['Blocker', 'Critical', 'Major', 'Minor'];
        const PRIO_ICON = { Blocker: '⛔', Critical: '⏫', Major: '🔼', Minor: '🔽' };

        function collectTasks(ignorePerson) {
            const out = []; const today = todayISO();
            let allowed = new Set(weeksData.map(w => w.key));
            if (anScope === 'visible') allowed = new Set(getVisibleWeeks().map(w => w.key));
            else if (anScope === 'last4') allowed = new Set(weeksData.slice(-4).map(w => w.key));
            db.forEach(person => {
                if (!ignorePerson && anPerson !== 'all' && person.id !== anPerson) return;
                person.categories.forEach(cat => weeksData.forEach((w, wi) => {
                    if (!allowed.has(w.key)) return;
                    (Array.isArray(cat[w.key]) ? cat[w.key] : []).forEach(t => {
                        const days = t.dueDate ? daysBetweenISO(today, t.dueDate) : null; const done = t.flag === 'completed';
                        out.push({ t, person, cat, week: w, weekIndex: wi, due: t.dueDate || '', days, done,
                            overdue: !done && days !== null && days < 0,
                            status: done ? 'completed' : (t.flag === 'pending' ? 'pending' : (t.flag === 'backlog' ? 'backlog' : 'open')),
                            sup: [t.supportPersonId, t.supportPersonId2].filter(Boolean).map(id => (db.find(p => p.id === id) || {}).name).filter(Boolean) });
                    });
                }));
            });
            return out;
        }
        function kpis(rows) {
            const k = { total: rows.length, completed: 0, pending: 0, backlog: 0, open: 0, overdue: 0, dueWeek: 0, today: 0, noDeadline: 0, risk: 0, subTotal: 0, subDone: 0, withDue: 0 };
            rows.forEach(r => {
                k[r.status]++; if (r.due) k.withDue++;
                if (!r.done) {
                    if (r.overdue) k.overdue++; if (r.days === 0) k.today++;
                    if (r.days !== null && r.days >= 0 && r.days <= 7) k.dueWeek++;
                    if (!r.due) k.noDeadline++;
                    if (r.t.priority === 'Blocker' || r.t.priority === 'Critical') k.risk++;
                }
                (r.t.subtasks || []).forEach(s => { k.subTotal++; if (s.completed) k.subDone++; });
            });
            k.pct = k.total ? Math.round(k.completed / k.total * 100) : 0;
            k.subPct = k.subTotal ? Math.round(k.subDone / k.subTotal * 100) : 0;
            return k;
        }
        function countBy(rows, keyFn) { const m = new Map(); rows.forEach(r => { const key = keyFn(r); if (!m.has(key)) m.set(key, { total: 0 }); const c = m.get(key); c[r.status] = (c[r.status] || 0) + 1; c.total++; }); return m; }

        // ---------- Analytics: drawing helpers ----------
        function segBar(c, maxTotal) {
            const total = c.total || 0; const w = maxTotal ? (total / maxTotal * 100) : 0;
            return '<div class="an-bar-track"><div class="an-bar" style="width:' + w.toFixed(1) + '%">' + AN_STATUS.map(s => c[s.k] ? '<span class="seg s-' + s.k + '" style="flex:' + c[s.k] + '" title="' + s.label + ': ' + c[s.k] + '">' + c[s.k] + '</span>' : '').join('') + '</div></div>';
        }
        function legendHtml() { return '<div class="an-legend">' + AN_STATUS.map(s => '<span><i class="dot s-' + s.k + '"></i>' + s.label + '</span>').join('') + '</div>'; }
        function donutSvg(c, big, small) {
            const R = 70, C = 2 * Math.PI * R, total = c.total || 0; let off = 0, arcs = '';
            if (!total) arcs = '<circle class="an-ring-empty" cx="90" cy="90" r="' + R + '"/>';
            else AN_STATUS.forEach(s => { const v = c[s.k] || 0; if (!v) return; const len = C * v / total; arcs += '<circle class="an-arc s-' + s.k + '" cx="90" cy="90" r="' + R + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 90 90)"/>'; off += len; });
            return '<svg viewBox="0 0 180 180" class="an-donut" role="img" aria-label="Status distribution">' + arcs + '<text x="90" y="92" class="an-big" text-anchor="middle">' + esc(big) + '</text><text x="90" y="112" class="an-sub" text-anchor="middle">' + esc(small) + '</text></svg>';
        }
        function kpiCard(label, value, sub, cls) { return '<div class="an-kpi ' + (cls || '') + '"><div class="an-kpi-v">' + esc(value) + '</div><div class="an-kpi-l">' + esc(label) + '</div>' + (sub ? '<div class="an-kpi-s">' + esc(sub) + '</div>' : '') + '</div>'; }
        function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
        function taskTable(rows, cols, emptyMsg) {
            if (!rows.length) return '<div class="an-empty">' + esc(emptyMsg) + '</div>';
            const head = '<tr>' + cols.map(c => '<th>' + esc(c.h) + '</th>').join('') + '</tr>';
            const body = rows.map(r => '<tr class="an-click" data-jump="' + esc(r.t.id) + '" title="Click to open this task">' + cols.map(c => '<td>' + c.f(r) + '</td>').join('') + '</tr>').join('');
            return '<div class="an-table-wrap"><table class="an-table">' + head + body + '</table></div>';
        }
        const COL_TASK = { h: 'Task', f: r => '<b>' + esc(r.t.name) + '</b>' };
        const COL_PERSON = { h: 'Owner', f: r => esc(r.person.name) };
        const COL_WEEK = { h: 'Week', f: r => esc(r.week.title) };
        const COL_PRIO = { h: 'Priority', f: r => PRIO_ICON[r.t.priority] + ' ' + esc(r.t.priority) };
        const COL_DUE = { h: 'Deadline', f: r => esc(fmtShort(r.due)) };

        function buildInsights(rows) {
            const k = kpis(rows); const out = [];
            if (!k.total) return [{ cls: '', html: 'No tasks match the current filters.' }];
            const over = rows.filter(r => r.overdue).sort((a, b) => a.days - b.days);
            if (over.length) out.push({ cls: 'bad', html: '<b>' + plural(over.length, 'task') + '</b> overdue. The longest is <b>' + esc(over[0].t.name) + '</b> (' + esc(over[0].person.name) + '), ' + plural(-over[0].days, 'day') + ' late.' });
            else if (k.withDue) out.push({ cls: 'good', html: 'No overdue tasks. 🎉' });
            if (k.dueWeek) out.push({ cls: 'warn', html: '<b>' + plural(k.dueWeek, 'open task') + '</b> due in the next 7 days.' });
            const openBy = new Map(); rows.filter(r => !r.done).forEach(r => openBy.set(r.person.name, (openBy.get(r.person.name) || 0) + 1));
            const ranked = [...openBy.entries()].sort((a, b) => b[1] - a[1]);
            if (ranked.length > 1) out.push({ cls: '', html: 'Highest open workload: <b>' + esc(ranked[0][0]) + '</b> (' + plural(ranked[0][1], 'open task') + ').' });
            if (k.risk) out.push({ cls: 'warn', html: '<b>' + plural(k.risk, 'open Blocker/Critical task') + '</b> need attention.' });
            if (k.noDeadline) out.push({ cls: '', html: '<b>' + plural(k.noDeadline, 'open task') + '</b> without a deadline.' });
            out.push({ cls: '', html: 'Overall completion: <b>' + k.pct + '%</b> (' + k.completed + ' of ' + k.total + ' tasks)' + (k.subTotal ? ', sub-tasks ' + k.subPct + '%' : '') + '.' });
            return out;
        }

        // ---------- Analytics: tabs ----------
        function renderOverview(rows) {
            const k = kpis(rows); const all = countBy(rows, () => 'all').get('all') || { total: 0 };
            const kp = '<div class="an-kpis">' +
                kpiCard('Total tasks', k.total, k.subTotal ? k.subDone + '/' + k.subTotal + ' sub-tasks done' : '') +
                kpiCard('Completed', k.completed, k.pct + '% of all', 'good') +
                kpiCard('Pending / backlog', k.pending + k.backlog, k.pending + ' pending · ' + k.backlog + ' backlog') +
                kpiCard('Overdue', k.overdue, k.withDue ? 'of ' + k.withDue + ' with deadline' : 'no deadlines set', k.overdue ? 'bad' : '') +
                kpiCard('Due in 7 days', k.dueWeek, k.today ? k.today + ' due today' : '', k.dueWeek ? 'warn' : '') +
                kpiCard('Blocker / Critical open', k.risk, '', k.risk ? 'warn' : '') +
                kpiCard('Open, no deadline', k.noDeadline, '') + '</div>';
            const ins = '<div class="an-card an-wide"><h4>Key insights</h4><ul class="an-insights">' + buildInsights(rows).map(i => '<li class="' + i.cls + '">' + i.html + '</li>').join('') + '</ul></div>';
            const donut = '<div class="an-card"><h4>Status distribution</h4><div class="an-donut-row">' + donutSvg(all, k.pct + '%', 'completed') +
                '<div class="an-donut-legend">' + AN_STATUS.map(s => '<div><i class="dot s-' + s.k + '"></i>' + s.label + '<b>' + (all[s.k] || 0) + '</b></div>').join('') + '</div></div></div>';
            const byPrio = countBy(rows, r => r.t.priority); const maxP = Math.max(1, ...PRIO_ORDER.map(p => (byPrio.get(p) || { total: 0 }).total));
            const prio = '<div class="an-card"><h4>Priority × status</h4>' + PRIO_ORDER.map(p => '<div class="an-row"><div class="an-row-l">' + PRIO_ICON[p] + ' ' + p + '</div>' + segBar(byPrio.get(p) || { total: 0 }, maxP) + '</div>').join('') + legendHtml() + '</div>';
            const weeks = weeksData.filter(w => rows.some(r => r.week.key === w.key));
            let weekly = '<div class="an-empty">No tasks yet.</div>';
            if (weeks.length) {
                const per = weeks.map(w => { const c = countBy(rows.filter(r => r.week.key === w.key), () => 'x').get('x'); return { w, c }; }); const mx = Math.max(...per.map(p => p.c.total), 1);
                weekly = '<div class="an-cols">' + per.map(p => { const pct = Math.round((p.c.completed || 0) / p.c.total * 100); return '<div class="an-col"><div class="an-col-pct">' + pct + '%</div><div class="an-stack" style="height:' + Math.max(18, p.c.total / mx * 150) + 'px">' + AN_STATUS.map(s => p.c[s.k] ? '<span class="seg s-' + s.k + '" style="flex:' + p.c[s.k] + '" title="' + s.label + ': ' + p.c[s.k] + '">' + p.c[s.k] + '</span>' : '').join('') + '</div><div class="an-col-l" title="' + esc(p.w.title) + '">' + esc(p.w.title) + '</div>' + (p.w.startDate ? '<div class="an-col-d">' + esc(fmtShort(p.w.startDate)) + '</div>' : '') + '</div>'; }).join('') + '</div>' + legendHtml();
            }
            return kp + '<div class="an-grid">' + ins + donut + prio + '<div class="an-card an-wide"><h4>Progress by week <span class="an-hint">(% = completed share)</span></h4>' + weekly + '</div></div>';
        }

        function renderTeam(rows) {
            const everyone = collectTasks(true); const people = db.filter(p => anPerson === 'all' || p.id === anPerson);
            const stats = people.map(p => {
                const mine = rows.filter(r => r.person.id === p.id); const c = countBy(mine, () => 'x').get('x') || { total: 0 }; const k = kpis(mine);
                return { p, c, k, supporting: everyone.filter(r => r.t.supportPersonId === p.id || r.t.supportPersonId2 === p.id).length };
            });
            const mx = Math.max(1, ...stats.map(s => s.c.total));
            const tbl = '<div class="an-table-wrap"><table class="an-table"><tr><th>Team member</th><th style="width:34%">Workload (tasks)</th><th>Done</th><th>Overdue</th><th>Due 7d</th><th>Blocker/Crit. open</th><th>Supporting</th></tr>' +
                stats.map(s => '<tr><td><b>' + esc(s.p.name) + '</b></td><td>' + segBar(s.c, mx) + '</td><td>' + s.k.pct + '%</td><td class="' + (s.k.overdue ? 't-bad' : '') + '">' + s.k.overdue + '</td><td>' + s.k.dueWeek + '</td><td class="' + (s.k.risk ? 't-warn' : '') + '">' + s.k.risk + '</td><td>' + s.supporting + '</td></tr>').join('') + '</table></div>' + legendHtml();
            const byCat = [...countBy(rows, r => String(r.cat.name).toUpperCase()).entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 12); const mc = Math.max(1, ...byCat.map(e => e[1].total));
            const cats = byCat.length ? byCat.map(([n, c]) => '<div class="an-row"><div class="an-row-l" title="' + esc(n) + '">' + esc(n) + '</div>' + segBar(c, mc) + '</div>').join('') + legendHtml() : '<div class="an-empty">No tasks.</div>';
            return '<div class="an-grid"><div class="an-card an-wide"><h4>Workload per team member</h4>' + tbl + '</div><div class="an-card an-wide"><h4>Work by category</h4>' + cats + '</div></div>';
        }

        function renderDeadlines(rows) {
            const open = rows.filter(r => !r.done);
            const b = { over: open.filter(r => r.overdue), today: open.filter(r => r.days === 0), wk: open.filter(r => r.days !== null && r.days >= 1 && r.days <= 7), mo: open.filter(r => r.days !== null && r.days >= 8 && r.days <= 30), later: open.filter(r => r.days !== null && r.days > 30), none: open.filter(r => r.days === null) };
            const items = [['Overdue', b.over, 'bad'], ['Due today', b.today, 'warn'], ['Next 7 days', b.wk, 'warn'], ['8–30 days', b.mo, 'ok'], ['Later', b.later, 'ok'], ['No deadline', b.none, 'none']]; const mx = Math.max(1, ...items.map(i => i[1].length));
            const buckets = '<div class="an-card"><h4>Open tasks by deadline</h4>' + items.map(([l, a, cls]) => '<div class="an-row"><div class="an-row-l">' + l + '</div><div class="an-bar-track">' + (a.length ? '<div class="an-bar solid ' + cls + '" style="width:' + (a.length / mx * 100).toFixed(1) + '%">' + a.length + '</div>' : '<span class="an-zero">0</span>') + '</div></div>').join('') + '</div>';
            const over = taskTable([...b.over].sort((a, c) => a.days - c.days), [COL_TASK, COL_PERSON, COL_WEEK, COL_PRIO, COL_DUE, { h: 'Late by', f: r => '<span class="t-bad">' + plural(-r.days, 'day') + '</span>' }], 'Nothing is overdue. 🎉');
            const up = taskTable(open.filter(r => r.days !== null && r.days >= 0 && r.days <= 14).sort((a, c) => a.days - c.days), [COL_TASK, COL_PERSON, COL_WEEK, COL_PRIO, COL_DUE, { h: 'In', f: r => r.days === 0 ? 'today' : plural(r.days, 'day') }], 'No deadlines in the next 14 days.');
            const none = taskTable(b.none.sort((a, c) => PRIO_ORDER.indexOf(a.t.priority) - PRIO_ORDER.indexOf(c.t.priority)).slice(0, 15), [COL_TASK, COL_PERSON, COL_WEEK, COL_PRIO], 'Every open task has a deadline. 👍');
            return '<div class="an-grid">' + buckets + '<div class="an-card"><h4>How to read this</h4><p class="an-note">Only <b>open</b> tasks (not marked Completed) count here. Set deadlines by right-clicking a task ▸ Deadline, or in the side-panel editor. Click any row to jump to the task.</p></div>' +
                '<div class="an-card an-wide"><h4>⏰ Overdue</h4>' + over + '</div><div class="an-card an-wide"><h4>📅 Due in the next 14 days</h4>' + up + '</div><div class="an-card an-wide"><h4>Open tasks without a deadline' + (b.none.length > 15 ? ' <span class="an-hint">(top 15 by priority)</span>' : '') + '</h4>' + none + '</div></div>';
        }

        function renderTimeline(rows) {
            const dated = rows.filter(r => r.due); const undated = rows.filter(r => !r.done && !r.due).length; const today = todayISO(); const LABEL_W = 250;
            const toolbar = '<div class="gt-toolbar"><button class="top-btn" data-zoom="-1">−</button><button class="top-btn" data-zoom="1">+</button><button class="top-btn" data-zoom="today">🎯 Today</button>' +
                '<span class="an-legend gt-legend"><span><i class="dot s-completed"></i>Completed</span><span><i class="dot t-over"></i>Overdue</span><span><i class="dot t-soon"></i>Due ≤ 3 days</span><span><i class="dot t-ok"></i>Upcoming</span><span><i class="dot diamond"></i>No week start date</span></span></div>';
            if (!dated.length) return toolbar + '<div class="an-empty">No deadlines yet. Right-click a task ▸ Deadline (or use the side-panel editor) and it will appear here.' + (undated ? ' <b>' + plural(undated, 'open task') + '</b> currently have none.' : '') + '</div>';
            const startOf = r => { const ws = r.week.startDate; return (ws && daysBetweenISO(ws, r.due) >= 0) ? ws : r.due; };
            let minISO = today, maxISO = today;
            dated.forEach(r => { const s = startOf(r); if (daysBetweenISO(s, minISO) > 0) minISO = s; if (daysBetweenISO(maxISO, r.due) > 0) maxISO = r.due; });
            minISO = addDaysISO(minISO, -3); maxISO = addDaysISO(maxISO, 7);
            minISO = addDaysISO(minISO, -((parseISO(minISO).getDay() + 6) % 7)); // align to Monday
            let span = Math.max(28, daysBetweenISO(minISO, maxISO) + 1); const CAP = 420; const capped = span > CAP; if (capped) span = CAP;
            const dw = anZoom, trackW = span * dw; const clampX = (iso) => Math.max(0, Math.min(span - 1, daysBetweenISO(minISO, iso)));
            let ticks = ''; for (let i = 0; i * 7 < span; i++) ticks += '<div class="gt-tick" style="left:' + (i * 7 * dw) + 'px">' + esc(fmtShort(addDaysISO(minISO, i * 7))) + '</div>';
            let html = '<div class="gt-row gt-axis"><div class="gt-label gt-axis-l" style="width:' + LABEL_W + 'px">Task</div><div class="gt-track" style="width:' + trackW + 'px">' + ticks + '</div></div>';
            db.forEach(p => {
                const mine = dated.filter(r => r.person.id === p.id).sort((a, b) => daysBetweenISO(a.due, b.due));
                if (!mine.length) return;
                html += '<div class="gt-row gt-group"><div class="gt-label" style="width:' + LABEL_W + 'px">👤 ' + esc(p.name) + '</div><div class="gt-track" style="width:' + trackW + 'px"></div></div>';
                mine.forEach(r => {
                    const s = startOf(r); const x0 = clampX(s), x1 = clampX(r.due); const milestone = (s === r.due);
                    const cls = r.done ? 't-done' : (r.overdue ? 't-over' : (r.days <= 3 ? 't-soon' : 't-ok'));
                    const left = x0 * dw, width = Math.max(dw * 0.9, (x1 - x0 + 1) * dw);
                    const tip = r.t.name + ' — ' + r.person.name + ' — ' + r.week.title + ' — due ' + fmtShort(r.due) + (r.overdue ? ' (' + (-r.days) + 'd overdue)' : '');
                    const bar = milestone ? '<div class="gt-bar gt-ms ' + cls + '" style="left:' + (x1 * dw + dw / 2 - 7) + 'px" title="' + esc(tip) + '"></div>' : '<div class="gt-bar ' + cls + '" style="left:' + left + 'px;width:' + width + 'px" title="' + esc(tip) + '"></div>';
                    const lblX = milestone ? x1 * dw + dw / 2 + 12 : left + width + 6;
                    html += '<div class="gt-row"><div class="gt-label an-click" style="width:' + LABEL_W + 'px" data-jump="' + esc(r.t.id) + '" title="' + esc(tip) + '">' + PRIO_ICON[r.t.priority] + ' ' + esc(r.t.name) + '</div><div class="gt-track" style="width:' + trackW + 'px;background-size:' + (7 * dw) + 'px 100%">' + bar + '<span class="gt-due" style="left:' + lblX + 'px">' + esc(fmtShort(r.due)) + '</span></div></div>';
                });
            });
            const todayX = LABEL_W + clampX(today) * dw + dw / 2;
            const body = '<div class="gt-wrap" id="gt-wrap"><div class="gt-body" style="width:' + (LABEL_W + trackW) + 'px">' + html + '<div class="gt-today" style="left:' + todayX + 'px" title="Today"></div></div></div>';
            const notes = '<div class="an-note" style="margin-top:10px">' + (rows.some(r => r.due && !r.week.startDate) ? 'Tip: bars run from the <b>week start date</b> to the deadline. Set week dates (right-click the board ▸ <b>Set week dates…</b>) to turn the ◆ markers into bars. ' : '') + (undated ? plural(undated, 'open task') + ' without a deadline are not shown. ' : '') + (capped ? 'Range limited to ' + CAP + ' days.' : '') + '</div>';
            return toolbar + body + notes;
        }
        function centerTimelineOnToday() {
            const w = document.getElementById('gt-wrap'), t = w && w.querySelector('.gt-today'); if (!w || !t) return;
            w.scrollLeft = Math.max(0, parseFloat(t.style.left) - w.clientWidth / 2);
        }

        // ---------- Analytics: shell, events, export ----------
        function renderAnalytics() {
            const body = document.getElementById('an-body'); if (!body) return;
            document.querySelectorAll('#analytics-overlay .an-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === anTab));
            const rows = collectTasks(); let html = '';
            try { html = anTab === 'team' ? renderTeam(rows) : anTab === 'deadlines' ? renderDeadlines(rows) : anTab === 'timeline' ? renderTimeline(rows) : renderOverview(rows); }
            catch (e) { console.error(e); html = '<div class="an-empty">Could not draw this view: ' + esc(e.message) + '</div>'; }
            body.innerHTML = html; if (anTab === 'timeline') centerTimelineOnToday();
        }
        function anKeyHandler(e) { if (e.key === 'Escape' && !document.getElementById('dialog-overlay')) { e.stopPropagation(); closeAnalytics(); } }
        function closeAnalytics() { const o = document.getElementById('analytics-overlay'); if (o) o.remove(); document.removeEventListener('keydown', anKeyHandler, true); }
        function openAnalytics(tab) {
            closeAnalytics(); closeContextMenu(); if (tab) anTab = tab;
            if (anPerson !== 'all' && !db.some(p => p.id === anPerson)) anPerson = 'all';
            const ov = document.createElement('div'); ov.id = 'analytics-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Team analytics');
            ov.innerHTML = '<div class="an-modal"><div class="an-head"><div class="an-title">📊 Team Analytics</div><div class="an-filters">' +
                '<label>Person <select id="an-person"></select></label><label>Weeks <select id="an-scope"><option value="all">All weeks</option><option value="visible">Visible on board</option><option value="last4">Last 4 weeks</option></select></label>' +
                '<button class="top-btn" id="an-export" title="Download the filtered task list as Excel">⬇ Export tasks (.xlsx)</button><button class="top-btn" id="an-close" aria-label="Close analytics">✕</button></div></div>' +
                '<div class="an-tabs"><button class="an-tab" data-tab="overview">Overview</button><button class="an-tab" data-tab="team">Team</button><button class="an-tab" data-tab="deadlines">Deadlines</button><button class="an-tab" data-tab="timeline">Timeline</button></div><div id="an-body"></div></div>';
            document.body.appendChild(ov);
            const sel = ov.querySelector('#an-person'); const all = document.createElement('option'); all.value = 'all'; all.textContent = 'Everyone'; sel.appendChild(all);
            db.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); }); sel.value = anPerson;
            ov.querySelector('#an-scope').value = anScope;
            sel.addEventListener('change', () => { anPerson = sel.value; renderAnalytics(); });
            ov.querySelector('#an-scope').addEventListener('change', (e) => { anScope = e.target.value; renderAnalytics(); });
            ov.querySelector('#an-close').addEventListener('click', closeAnalytics);
            ov.querySelector('#an-export').addEventListener('click', exportTaskList);
            ov.querySelectorAll('.an-tab').forEach(b => b.addEventListener('click', () => { anTab = b.dataset.tab; renderAnalytics(); }));
            ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeAnalytics(); });
            ov.addEventListener('click', (e) => {
                const j = e.target.closest('[data-jump]'); if (j) { const id = j.dataset.jump; closeAnalytics(); openOriginalTask(id); return; }
                const z = e.target.closest('[data-zoom]'); if (z) { const v = z.dataset.zoom; if (v === 'today') { centerTimelineOnToday(); return; } anZoom = Math.max(10, Math.min(48, anZoom + (v === '1' ? 6 : -6))); renderAnalytics(); }
            });
            document.addEventListener('keydown', anKeyHandler, true); renderAnalytics();
        }
        function exportTaskList() {
            if (typeof XLSX === 'undefined') { alert('The Excel library has not finished loading. Please try again in a moment.'); return; }
            const rows = collectTasks(); const k = kpis(rows);
            const head = ['Team member', 'Category', 'Week', 'Week start', 'Task', 'Priority', 'Status badge', 'Flag', 'Jira', 'Deadline', 'Days to deadline', 'Overdue', 'Completed on', 'Sub-tasks done', 'Sub-tasks total', 'Supporting'];
            const aoa = [head].concat(rows.map(r => [r.person.name, r.cat.name, r.week.title, r.week.startDate || '', r.t.name, r.t.priority, r.t.status, r.t.flag, r.t.jiraId || '', r.due, r.days === null ? '' : r.days, r.overdue ? 'YES' : '', r.t.completedDate || '', (r.t.subtasks || []).filter(s => s.completed).length, (r.t.subtasks || []).length, r.sup.join(', ')]));
            const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [18, 16, 14, 12, 40, 10, 16, 10, 14, 12, 10, 8, 12, 10, 10, 20].map(w => ({ wch: w }));
            const sum = [['Metric', 'Value'], ['Generated', todayISO()], ['Filter: person', anPerson === 'all' ? 'Everyone' : ((db.find(p => p.id === anPerson) || {}).name || '')], ['Filter: weeks', anScope], ['Total tasks', k.total], ['Completed', k.completed], ['Completion %', k.pct], ['Pending', k.pending], ['Backlog', k.backlog], ['Open (no flag)', k.open], ['Overdue', k.overdue], ['Due in 7 days', k.dueWeek], ['Open Blocker/Critical', k.risk], ['Open without deadline', k.noDeadline], ['Sub-task completion %', k.subPct]];
            const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), 'Summary'); XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
            XLSX.writeFile(wb, 'Team_Tracker_Analytics_' + dateStamp() + '.xlsx'); toast('Task list exported.');
        }


        // Init
        loadDatabase(); 
        renderFilters(); 
        render();
        checkStoredHandle();
        lastSnapshot = currentSnapshot();
        refreshSyncUI();
    