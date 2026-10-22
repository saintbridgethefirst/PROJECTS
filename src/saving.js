// ─────────────────────────────────────────────────────────────────────────────
//  Saving, as people see it: the status in the side panel and the notice on the
//  board (offline, slow, failed), merging saves two people made at the same moment
//  (sync.merge3), and save errors in words that say what to do.
//  app = { backend, session } from main.js.
// ─────────────────────────────────────────────────────────────────────────────
import { $, el, friendlyError } from './ui.js';
import { DEMO_MODE } from './config.js';
import { merge3, deepEqual } from './sync.js';

export function setSyncStatus(app, state, why) {
  const s = app.session; const n = $('#conn-status'); if (!n || !s) return;
  if (state) { s.syncState = state; if (state === 'error') s.syncError = why || ''; }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const st = offline ? 'offline' : (s.pending > 0 ? 'saving' : (s.syncState === 'error' ? 'error' : 'saved'));
  const map = { saved: ['🟢 Saved', 'var(--ok)'], saving: ['🟡 Saving…', 'var(--warn)'], offline: ['🟠 Offline — will sync', '#ed8936'], error: ['🔴 Not saved', 'var(--bad)'] };
  n.textContent = DEMO_MODE && st === 'saved' ? '🟢 Saved in this browser' : map[st][0]; n.style.color = map[st][1];
  // Saving for a while → probably a slow or broken connection: say so after a few seconds.
  if (st === 'saving' && !s.slowTimer) s.slowTimer = setTimeout(() => { s.slowTimer = null; if (app.session === s) { s.slow = true; netPill(s, 'saving'); } }, SLOW_SAVE_MS);
  if (st !== 'saving') { clearTimeout(s.slowTimer); s.slowTimer = null; s.slow = false; }
  // A save that takes a moment shows a small "Saving…" so people know it's working, then "Saved".
  const chip = $('#save-chip');
  if (chip) {
    if (st === 'saving' && !s.chipTimer && !chip.classList.contains('on')) s.chipTimer = setTimeout(() => { s.chipTimer = null; if (app.session === s && s.pending > 0) { chip.className = 'save-chip on'; chip.textContent = 'Saving…'; } }, 600);
    if (st !== 'saving') {
      clearTimeout(s.chipTimer); s.chipTimer = null;
      if (chip.classList.contains('on') && !chip.classList.contains('done')) {
        chip.className = st === 'saved' ? 'save-chip on done' : 'save-chip'; chip.textContent = st === 'saved' ? '✓ Saved' : '';
        clearTimeout(chip._t); chip._t = setTimeout(() => { chip.className = 'save-chip'; chip.textContent = ''; }, 1400);
      }
    }
  }
  netPill(s, st);
}
const SLOW_SAVE_MS = 5000;
/** A small notice on the board while something about saving needs your attention. */
function netPill(s, st) {
  const pill = $('#net-pill'); if (!pill) return;
  const was = pill.dataset.state || 'saved';
  const btn = (label, fn) => el('button', { type: 'button', onclick: fn }, label);
  let content = null, kind = '';
  if (st === 'offline') { kind = 'warn'; content = [el('b', {}, 'You’re offline.'), ' ' + (s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting on this device — they’ll save when you reconnect.` : 'Keep working: your changes stay on this device and save when you reconnect.')]; }
  else if (st === 'saving' && s.slow) { kind = 'warn'; content = [el('b', {}, 'Still saving…'), ' the connection is slow. Keep this tab open until it says saved.']; }
  else if (st === 'error') { kind = 'bad'; content = [el('b', {}, 'Your last change wasn’t saved.'), ' ' + (s.syncError || 'Please try again.'), btn('Reload', () => location.reload()), btn('✕', () => { s.syncState = 'saved'; netPill(s, 'saved'); })]; }
  else if (st === 'saved' && (was === 'offline' || (was === 'saving' && pill.dataset.slow))) { kind = 'ok'; content = [el('b', {}, 'Back online.'), ' Everything is saved.']; clearTimeout(pill._t); pill._t = setTimeout(() => { if (pill.classList.contains('ok')) { pill.hidden = true; pill.className = 'net-pill'; } }, 3500); }
  pill.dataset.state = st; if (st === 'saving' && s.slow) pill.dataset.slow = '1'; else if (st !== 'saving') delete pill.dataset.slow;
  if (content) { pill.className = 'net-pill ' + kind; pill.replaceChildren(...content); pill.hidden = false; }
  else if (!pill.classList.contains('ok')) pill.hidden = true;   // a "Back online" note hides itself
}

// ── Two people saving the same task at once ─────────────────────────────────
// Every save of a list or object field (sub-tasks, time log, custom fields, weeks…) is remembered for
// a short while. If a teammate's save lands on top of it and wipes my change out, the next snapshot
// shows it: merge the two (sync.merge3) and save the result. Both browsers end up with both changes.
const HEAL_WINDOW = 30000;
export function rememberWrites(s, ops) {
  ops.forEach(op => {
    const fields = op.type === 'update' ? Object.keys(op.data) : null;
    // A save without a "before" (undo, a whole-document set, a delete) replaces what I remembered.
    [...s.recent.keys()].forEach(k => { const r = s.recent.get(k); if (r.path === op.path && (!fields || (fields.includes(r.field) && !(op.base && r.field in op.base)))) s.recent.delete(k); });
    if (op.type !== 'update' || !op.base) return;
    Object.keys(op.base).forEach(f => { const k = op.path + '|' + f; const r = s.recent.get(k); const open = r && r.until === Infinity; s.recent.set(k, { path: op.path, field: f, base: open ? r.base : op.base[f], mine: op.data[f], until: Infinity, heals: open ? r.heals : 0 }); /* an earlier save not yet confirmed: merge from before it */ });
  });
}
export function settleWrites(s, ops, ok) {
  ops.forEach(op => { if (!op.base) return; Object.keys(op.base).forEach(f => { const k = op.path + '|' + f; const r = s.recent.get(k); if (r && r.mine === op.data[f]) { if (ok) r.until = Date.now() + HEAL_WINDOW; else s.recent.delete(k); } }); });
}
export function healLostEdits(app, s) {
  if (!s.recent.size) return;
  const now = Date.now(); const ops = []; let byId = null;
  s.recent.forEach((r, k) => {
    if (r.until < now) { s.recent.delete(k); return; }
    if (!byId && r.path !== 'team') byId = new Map(s.rawTasks.map(t => ['tasks/' + t.id, t]));
    const cur = r.path === 'team' ? s.rawTeam : byId.get(r.path);
    if (!cur) { s.recent.delete(k); return; }            // deleted meanwhile
    const theirs = cur[r.field];
    if (deepEqual(theirs, r.mine)) return;                // still what I saved
    const merged = merge3(r.base, r.mine, theirs);
    if (deepEqual(merged, theirs) || r.heals >= 3) { s.recent.delete(k); return; } // nothing of mine was lost
    r.base = theirs; r.mine = merged; r.until = Infinity; r.heals++;
    ops.push({ type: 'update', path: r.path, data: { [r.field]: merged } });
  });
  if (!ops.length) return;
  console.info('Trawpie: merged changes saved at the same moment by you and a teammate', ops.map(o => o.path + ' ' + Object.keys(o.data)[0]));
  s.healed = (s.healed || 0) + ops.length;
  s.pending++; setSyncStatus(app);
  app.backend.data.commit(s.teamId, ops)
    .then(() => { if (app.session === s) { s.pending--; setSyncStatus(app, 'saved'); ops.forEach(o => { const r = s.recent.get(o.path + '|' + Object.keys(o.data)[0]); if (r) r.until = Date.now() + HEAL_WINDOW; }); } })
    .catch((e) => { console.warn('merge save', e); if (app.session === s) { s.pending--; setSyncStatus(app); ops.forEach(o => s.recent.delete(o.path + '|' + Object.keys(o.data)[0])); } });
}

/** Why a save failed, in words that say what to do. */
export function saveError(e) {
  const code = String((e && e.code) || ''); const msg = String((e && e.message) || '');
  if (code.includes('permission-denied')) return 'You don’t have permission to change that — your role in this team may have just changed. Reload to see your current access.';
  if (code.includes('unauthenticated')) return 'You’ve been signed out. Reload and sign in again; then redo the last change.';
  if (code.includes('resource-exhausted')) return 'Trawpie has hit its usage limit for today. Your change wasn’t saved; please try again later.';
  if (code.includes('invalid-argument') && /size|bytes|too large|exceeds/i.test(msg)) return 'This task has grown too big to save (too much history, notes or attachments). Remove some and try again.';
  if (code.includes('deadline-exceeded') || code.includes('unavailable')) return 'The connection dropped before the change was saved. Check your internet and try again.';
  return friendlyError(e);
}
