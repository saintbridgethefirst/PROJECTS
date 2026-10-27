// Small DOM helpers shared by the app modules. All text goes in via textContent,
// never innerHTML, so user-entered names can't inject markup.

export const $ = (sel, root = document) => root.querySelector(sel);

// A link's href only when it's a plain web (or mail) address — never javascript:, data:, etc.
// Used wherever a user-supplied URL (attachment, part, receipt, paper) becomes a clickable link.
export function safeUrl(u) {
  const s = String(u ?? '').trim();
  return /^(https?:\/\/|mailto:)/i.test(s) ? s : '';
}

/** el('button.btn.primary', { onclick, type: 'button' }, 'Save') */
import { lineIcon } from './line-icons.js';

export function el(spec, props = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  Object.entries(props || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.entries(v).forEach(([sk, sv]) => { if (sk.startsWith('--')) node.style.setProperty(sk, sv); else node.style[sk] = sv; });
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  });
  children.flat().forEach(c => { if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return node;
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function avatar(user) {
  const a = el('span.avatar');
  if (user && user.photo) a.append(el('img', { src: user.photo, alt: '', referrerpolicy: 'no-referrer' }));
  else a.textContent = initials(user && (user.name || user.email));
  return a;
}

export function teamLogo(team) {
  const box = el('span.team-logo');
  if (team && team.logo) box.append(el('img', { src: team.logo, alt: '' }));
  else box.textContent = initials(team && team.name);
  return box;
}

export function toast(msg, ms = 3500, actionLabel, action) {
  if (typeof window.toast === 'function') return window.toast(msg, ms, actionLabel, action);
  let box = document.getElementById('toast-container');
  if (!box) { box = el('div', { id: 'toast-container' }); document.body.append(box); }
  const t = el('div.toast', {}, el('span', {}, msg));
  if (actionLabel) t.append(el('button', { type: 'button', onclick: () => { t.remove(); action && action(); } }, actionLabel));
  box.append(t); setTimeout(() => t.remove(), ms);
}

/** A modal shell. Returns { overlay, body, foot, close }. */
export function modal(title, { narrow = false, onClose } = {}) {
  const body = el('div.modal-body');
  const foot = el('div.modal-foot');
  const closeBtn = el('button.modal-close', { type: 'button', 'aria-label': 'Close', title: 'Close' }, lineIcon('x', 16));
  const box = el('div.modal' + (narrow ? '.narrow' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div.modal-head', {}, el('h3', {}, title), el('span.spacer'), closeBtn), body, foot);
  const overlay = el('div.modal-overlay', {}, box);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape' && !document.getElementById('dialog-overlay')) { e.stopPropagation(); close(); } };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  return { overlay, box, body, foot, close };
}

/** Resize an image file to fit maxPx and return a data URL under maxBytes (or throw). */
export async function imageFileToDataUrl(file, maxPx, maxBytes) {
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) throw new Error('Please choose a PNG, JPG, WebP, GIF or SVG image.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read this image.')); i.src = url; });
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || maxPx, img.naturalHeight || maxPx));
    const w = Math.max(1, Math.round((img.naturalWidth || maxPx) * scale)), h = Math.max(1, Math.round((img.naturalHeight || maxPx) * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    for (const [type, q] of [['image/png'], ['image/webp', 0.9], ['image/webp', 0.75], ['image/jpeg', 0.8], ['image/jpeg', 0.6]]) {
      const d = c.toDataURL(type, q);
      if (d.startsWith('data:' + type) && d.length <= maxBytes * 1.33) return d;
    }
    throw new Error('This image is too detailed. Try a simpler or smaller one.');
  } finally { URL.revokeObjectURL(url); }
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const inp = el('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); resolve(f || null); });
    document.body.append(inp); inp.click();
  });
}

export function friendlyError(e) {
  const code = e && (e.code || '');
  if (String(code).startsWith('tt/')) return e.message;   // our own messages, already written for people
  // Microsoft: the university hasn't let students approve the app (or the file permission)
  if (/AADSTS(65001|90094|90095)|admin approval|admin consent|consent_required/i.test((e && (e.errorCode || '') + ' ' + (e.message || '')) || '')) return 'Your university hasn’t approved Trawpie for Microsoft yet. You don’t need it: sign in with your university email and a password, and add OneDrive files by their share link (Attach a file ▸ Open OneDrive ▸ Share ▸ Copy link).';
  if (String(code).includes('permission-denied') || /insufficient permissions/i.test(e && e.message)) return 'You don’t have permission to do that in this team.';
  if (String(code).includes('popup-closed')) return 'Sign-in window was closed before finishing.';
  if (String(code).includes('popup-blocked')) return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  if (String(code).includes('account-exists-with-different-credential')) return 'This email already has an account with a different sign-in method. Use that method instead.';
  if (String(code).includes('unavailable') || String(code).includes('network')) return 'You appear to be offline. Changes will sync when you reconnect.';
  // Microsoft sign-in errors carry an AADSTS code from Microsoft. Most mean the site's Microsoft setup needs
  // fixing, so say that plainly (with the code) instead of "Email or password is incorrect".
  const aad = /AADSTS(\d+)/.exec((e && e.message) || '');
  if (aad || (String(code).includes('invalid-credential') && /microsoft\.com/i.test((e && e.message) || ''))) {
    const n = aad ? aad[1] : '';
    const owner = {
      7000215: 'the app secret saved in Firebase isn’t accepted. Paste the secret’s Value (not its Secret ID) in Firebase ▸ Authentication ▸ Microsoft.',
      7000222: 'the app secret has expired. Make a new one in Entra ▸ Certificates & secrets and paste its Value into Firebase.',
      700016: 'the Application ID saved in Firebase isn’t the Microsoft app’s client ID.',
      50011: 'the redirect address isn’t on the Microsoft app. Add https://uni-teamtrack.firebaseapp.com/__/auth/handler under Authentication ▸ Web.',
      50020: 'the Microsoft app only accepts one organisation. Set Supported account types to any organisation and personal accounts.',
      50194: 'the Microsoft app only accepts one organisation. Set Supported account types to any organisation and personal accounts.',
    }[n];
    return 'Microsoft sign-in didn’t work' + (n ? ' (code AADSTS' + n + ')' : '') + '. Use Google or your email and a password for now.' + (owner ? ' Site owner: ' + owner : '');
  }
  const AUTH = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'No account uses this email. Choose “Create account” instead.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead, or use “Forgot password?”.',
    'auth/weak-password': 'Choose a password of at least 8 characters.',
    'auth/missing-password': 'Enter your password.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/quota-exceeded': 'The site has reached today’s limit for sign-in emails. Use a password or Google sign-in instead.',
    'auth/operation-not-allowed': 'This sign-in method isn’t switched on for this site yet (Firebase console ▸ Authentication ▸ Sign-in method).',
  };
  if (AUTH[code]) return AUTH[code];
  return (e && e.message) || 'Something went wrong.';
}
