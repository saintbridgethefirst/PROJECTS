// ─────────────────────────────────────────────────────────────────────────────
//  The Feedback button: stored in feedback/{id} and emailed to the platform admins
//  (functions: emailFeedback). app = { backend, user, session, saveError } from main.js.
// ─────────────────────────────────────────────────────────────────────────────
import { el, toast, modal } from './ui.js';
import { recentErrors, buildId } from './monitor.js';

const FEEDBACK_KINDS = [['bug', '🐞 Something’s broken'], ['idea', '💡 An idea'], ['question', '❓ A question'], ['other', '💬 Something else']];
export function openFeedback(app, kind = 'bug') {
  if (!app.user) { location.href = 'mailto:?subject=TeamTrack'; return; }
  const m = modal('Send feedback', { narrow: true });
  let chosen = FEEDBACK_KINDS.some(k => k[0] === kind) ? kind : 'bug';
  const kinds = el('div.fb-kinds', { role: 'radiogroup', 'aria-label': 'What is it about?' });
  const drawKinds = () => kinds.replaceChildren(...FEEDBACK_KINDS.map(([k, label]) => el('button.fb-kind' + (k === chosen ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(k === chosen), onclick: () => { chosen = k; drawKinds(); text.placeholder = HINTS[k]; } }, label)));
  const HINTS = { bug: 'What did you do, what did you expect, and what happened instead?', idea: 'What would make TeamTrack better for your team?', question: 'What would you like to know?', other: 'Tell us anything.' };
  const text = el('textarea.fb-text', { rows: 6, maxlength: 2000, placeholder: HINTS[chosen], 'aria-label': 'Your message' });
  const count = el('span.hint', {}, '0 / 2000'); text.addEventListener('input', () => { count.textContent = text.value.length + ' / 2000'; });
  const errs = recentErrors();
  const tech = el('input', { type: 'checkbox', checked: true, id: 'fb-tech' });
  const send = el('button.btn.primary', { type: 'button', onclick: async () => {
    const t = text.value.trim(); if (!t) { text.focus(); return toast('Write a few words first.'); }
    send.disabled = true; send.textContent = 'Sending…';
    const where = String(location.hash || '#').split('/').slice(0, 2).join('/').slice(0, 100);
    const d = { kind: chosen, text: t.slice(0, 2000), where: tech.checked ? where : '', teamId: tech.checked && app.session ? String(app.session.teamId).slice(0, 64) : '', ua: tech.checked ? navigator.userAgent.slice(0, 200) : '', build: String(buildId()).slice(0, 40),
      at: Date.now(), uid: app.user.uid, email: (app.user.email || '').slice(0, 200), name: (app.user.name || '').slice(0, 80), errors: tech.checked ? errs.map(e => e.slice(0, 300)) : [] };
    try { await app.backend.data.sendFeedback(d); m.close(); toast('Thanks! Your feedback was sent' + (app.user.email ? ' — we may reply to ' + app.user.email + '.' : '.'), 5000); }
    catch (e) { console.error(e); send.disabled = false; send.textContent = 'Send'; toast(app.saveError(e), 6000); }
  } }, 'Send');
  drawKinds();
  m.body.append(el('p.hint', {}, 'Goes straight to the people who build TeamTrack.'), kinds, text, el('div.row', {}, count),
    el('label.fb-tech', { for: 'fb-tech' }, tech, ' Include technical details: page, browser, app version' + (errs.length ? ' and ' + errs.length + ' recent error' + (errs.length === 1 ? '' : 's') : '') + '. Never your task contents.'));
  m.foot.append(el('button.btn.ghost', { type: 'button', onclick: m.close }, 'Cancel'), send);
  setTimeout(() => text.focus(), 30);
}
