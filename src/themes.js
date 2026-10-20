// ─────────────────────────────────────────────────────────────────────────────
//  Theme packs. Each pack is a dark or light base plus its own colours. The choice
//  is kept in this browser (so the page opens in the right colours straight away)
//  and on your account (so it follows you to other devices).
// ─────────────────────────────────────────────────────────────────────────────
export const THEMES = [
  { id: 'auto', name: 'Match my device', mode: 'auto', note: 'Midnight or Daylight, following your device’s dark-mode setting' },
  { id: 'midnight', name: 'Midnight', mode: 'dark', note: 'The original dark theme' },
  { id: 'ocean', name: 'Ocean', mode: 'dark', note: 'Deep blue-green with a sky-blue accent' },
  { id: 'forest', name: 'Forest', mode: 'dark', note: 'Dark green with a fresh green accent' },
  { id: 'grape', name: 'Grape', mode: 'dark', note: 'Dark purple with a lavender accent' },
  { id: 'graphite', name: 'Graphite', mode: 'dark', note: 'Neutral grey with an amber accent' },
  { id: 'contrast-dark', name: 'High contrast (dark)', mode: 'dark', note: 'Pure black, bright text, strong borders' },
  { id: 'daylight', name: 'Daylight', mode: 'light', note: 'The original light theme' },
  { id: 'paper', name: 'Paper', mode: 'light', note: 'Warm cream, easy on the eyes' },
  { id: 'sakura', name: 'Sakura', mode: 'light', note: 'Soft pink with a rose accent' },
  { id: 'mint', name: 'Mint', mode: 'light', note: 'Cool mint with a teal accent' },
  { id: 'contrast-light', name: 'High contrast (light)', mode: 'light', note: 'Pure white, black text, strong borders' },
];
// Swatch colours for the picker: [background, panel, accent, text]
export const SWATCH = {
  midnight: ['#0b0f19', '#131722', '#4299e1', '#e2e8f0'], ocean: ['#071a24', '#0c2532', '#38bdf8', '#e0f2f7'],
  forest: ['#0b1510', '#122019', '#4ade80', '#e3f1e7'], grape: ['#140f1f', '#1c1530', '#a78bfa', '#ece6fa'],
  graphite: ['#121212', '#1c1c1c', '#f59e0b', '#e8e8e8'], 'contrast-dark': ['#000000', '#0a0a0a', '#ffd60a', '#ffffff'],
  daylight: ['#f7fafc', '#ffffff', '#3182ce', '#1a202c'], paper: ['#f5f0e6', '#fffaf0', '#b45309', '#2b2418'],
  sakura: ['#fdf2f6', '#ffffff', '#db2777', '#2d1a24'], mint: ['#effaf6', '#ffffff', '#0d9488', '#12302a'],
  'contrast-light': ['#ffffff', '#ffffff', '#0040c0', '#000000'],
};
const KEY = 'tt_theme';
const byId = new Map(THEMES.map(t => [t.id, t]));
export const isTheme = (id) => byId.has(id);

/** The saved choice in this browser (old light/dark setting carried over). */
export function savedTheme() {
  try {
    const t = localStorage.getItem(KEY); if (t && byId.has(t)) return t;
    const old = localStorage.getItem('themePref'); if (old === 'light') return 'daylight'; if (old === 'dark') return 'midnight';
  } catch { /* storage blocked */ }
  return 'midnight';
}
const prefersDark = () => { try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return true; } };
/** The pack actually shown (auto → midnight/daylight). */
export function resolveTheme(id) { return id === 'auto' ? (prefersDark() ? 'midnight' : 'daylight') : (byId.has(id) ? id : 'midnight'); }

/** Apply a pack to the page. Light packs set data-theme="light" so all light-mode rules apply too. */
export function applyTheme(id, { save = true } = {}) {
  if (!byId.has(id)) id = 'midnight';
  const shown = resolveTheme(id); const t = byId.get(shown);
  const root = document.documentElement;
  if (t.mode === 'light') root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
  if (shown === 'midnight' || shown === 'daylight') root.removeAttribute('data-pack'); else root.setAttribute('data-pack', shown);
  root.style.colorScheme = t.mode;
  document.body && document.body.removeAttribute('data-theme');   // older code put it on <body>
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = SWATCH[shown][0];
  if (save) { try { localStorage.setItem(KEY, id); localStorage.setItem('themePref', t.mode); } catch { /* */ } }
  current = id;
  window.dispatchEvent(new CustomEvent('tt-theme', { detail: { id, shown, mode: t.mode } }));
}
let current = savedTheme();
export const currentTheme = () => current;
export const themeName = (id) => (byId.get(id) || byId.get('midnight')).name;
export const isLight = () => document.documentElement.getAttribute('data-theme') === 'light';

// "Match my device" follows the system setting live.
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (current === 'auto') applyTheme('auto', { save: false }); }); } catch { /* old browsers */ }
