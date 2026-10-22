// Edits the 60-second captioned explainer from the screen recordings in marketing/video-kit.
// Output: marketing/Trawpie-60s.mp4 (16:9) and marketing/Trawpie-60s-vertical.mp4 (9:16). Silent; add music later.
//   node tools/marketing/make-video.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../../', import.meta.url).pathname;
const KIT = ROOT + 'marketing/video-kit/';
const OUT = ROOT + 'marketing/';
const T = '/tmp/tt-video/'; fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(T, { recursive: true });
const FPS = 30, XF = 0.4; // crossfade seconds
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an'];

// ── Scenes ────────────────────────────────────────────────────────────────
// clip: [file, start, end, speed] → output length (end-start)/speed. img: [file, seconds, focusX, focusY]
const SCENES = [
  { id: 'intro', html: 'intro', d: 4.2 },
  { id: 'board', vx: 0.5, clip: ['clip-01-board-tour.mp4', 0.3, 8.7, 1.2], n: 1, main: 'One board: people × weeks', sub: 'Live for the whole team' },
  { id: 'progress', vx: 0.36, clip: ['clip-02-tick-subtasks.mp4', 1.0, 7.5, 1.3], n: 2, main: 'Tick it off. Everyone sees it.', sub: 'Progress updates instantly' },
  { id: 'carry', vx: 0.47, clip: ['clip-03-carry-forward.mp4', 0.3, 11.5, 1.6], n: 3, main: 'Not finished? Carry it forward', sub: 'Notes, papers and comments come too' },
  { id: 'subteams', vx: 0.5, clip: ['clip-05-subteams.mp4', 0.3, 8.0, 1.5], n: 4, main: 'Split into sub-teams', sub: 'Fuselage · Payload · Electronics…' },
  { id: 'analytics', vx: 0.5, clip: ['clip-04-views.mp4', 0.3, 10.8, 1.5], n: 5, main: 'Are we on track?', sub: 'Kanban, analytics and burndown, worked out for you' },
  { id: 'tools', vx: 0.5, clip: ['clip-06-tools.mp4', 0.3, 11.5, 1.6], n: 6, main: 'Switch on the tools you need', sub: 'Parts · Budget · Papers · Risks · Requirements' },
  { id: 'invite', vx: 0.45, clip: ['clip-07-invite.mp4', 1.5, 12.5, 2.0], n: 7, main: 'Invite by email. We send it.', sub: 'They sign in and press “Join team”' },
  { id: 'students', vx: 0.5, img: ['26-plan.jpg', 5.5, 0.5, 0.45], n: 8, main: 'Free for teams up to 30', sub: '🎓 Free Pro for students with a university email' },
  { id: 'outro', html: 'outro', d: 5.2 },
];

// ── HTML for cards and captions ───────────────────────────────────────────
const FONT = `font-family: "Inter Display", Inter, sans-serif;`;
const BASE = `*{box-sizing:border-box;margin:0}html,body{width:100%;height:100%}body{${FONT}color:#14213d;-webkit-font-smoothing:antialiased}`;
const PAPER = `background:#fbf8f1;background-image:radial-gradient(#e3dccb 2px,transparent 2px);background-size:34px 34px;`;
const logo = 'data:image/png;base64,' + fs.readFileSync(ROOT + 'public/icons/logo-96.png').toString('base64');

const card = (v) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
body{${PAPER}display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${v ? 54 : 34}px;text-align:center;overflow:hidden}
.brand{display:flex;align-items:center;gap:18px;font-weight:900;font-size:${v ? 64 : 48}px;opacity:0;animation:pop .6s .1s cubic-bezier(.2,1.4,.4,1) forwards}
.brand img{width:${v ? 92 : 72}px;height:${v ? 92 : 72}px;border-radius:20px;box-shadow:5px 5px 0 #14213d;border:3px solid #14213d}
h1{font-weight:900;font-size:${v ? 112 : 124}px;line-height:1.02;letter-spacing:-.035em;max-width:${v ? 940 : 1500}px}
h1 span{display:inline-block;opacity:0;transform:translateY(40px);animation:up .55s cubic-bezier(.2,1,.3,1) forwards}
.hl{position:relative;z-index:0}.hl::after{content:"";position:absolute;left:-10px;right:-10px;bottom:6px;height:.36em;background:#0e9f8e;opacity:.4;border-radius:10px;z-index:-1;transform:scaleX(0);transform-origin:left;animation:sweep .6s 1.5s ease-out forwards}
.row{display:flex;gap:18px;flex-wrap:wrap;justify-content:center;max-width:${v ? 900 : 1500}px}
.chip{font-weight:800;font-size:${v ? 38 : 34}px;padding:14px 26px;border:3px solid #14213d;border-radius:18px;background:#fff;box-shadow:5px 5px 0 #14213d;opacity:0;transform:translateY(30px) rotate(-2deg);animation:up .5s cubic-bezier(.2,1.3,.4,1) forwards}
.chip.y{background:#ffc53d}.chip.t{background:#0e9f8e;color:#fff}.chip.p{background:#ff5fa2;color:#fff}
.url{font-weight:900;font-size:${v ? 60 : 64}px;padding:22px 40px;border:4px solid #14213d;border-radius:24px;background:#0e9f8e;color:#fff;box-shadow:8px 8px 0 #14213d;opacity:0;animation:pop .6s cubic-bezier(.2,1.4,.4,1) forwards}
.mini{display:grid;grid-template-columns:repeat(3,${v ? 250 : 230}px);gap:16px}
.tk{background:#fff;border:3px solid #14213d;border-left:12px solid var(--c);border-radius:14px;padding:14px 16px;text-align:left;font-weight:800;font-size:${v ? 27 : 25}px;box-shadow:4px 4px 0 #14213d;opacity:0;transform:translateY(40px) scale(.9);animation:up .5s cubic-bezier(.2,1.3,.4,1) forwards}
.tk i{display:block;height:9px;border-radius:9px;background:#eee7d8;margin-top:10px;overflow:hidden}.tk i b{display:block;height:100%;width:0;background:var(--c);animation:grow 1.4s 2.2s ease-out forwards}
@keyframes up{to{opacity:1;transform:none}}@keyframes pop{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:none}}@keyframes sweep{to{transform:scaleX(1)}}@keyframes grow{to{width:var(--p)}}
</style></head><body>`;

const INTRO = (v) => card(v) + `<div class="brand"><img src="${logo}">Trawpie</div>
<h1><span style="animation-delay:.35s">Your</span> <span style="animation-delay:.5s">team’s</span> <span style="animation-delay:.65s">whole</span> <span style="animation-delay:.8s">week.</span><br><span class="hl" style="animation-delay:1.1s">One picture.</span></h1>
<div class="mini">${[['Wing CAD v2', '#0e9f8e', '75%'], ['Telemetry link', '#3ba3ff', '35%'], ['Drop test', '#ffc53d', '60%']].map(([t, c, p], i) => `<div class="tk" style="--c:${c};--p:${p};animation-delay:${1.7 + i * .15}s">${t}<i><b></b></i></div>`).join('')}</div></body></html>`;

const OUTRO = (v) => card(v) + `<div class="brand"><img src="${logo}">Trawpie</div>
<h1 style="font-size:${v ? 96 : 104}px"><span style="animation-delay:.3s">Make</span> <span style="animation-delay:.42s">your</span> <span style="animation-delay:.54s">team’s</span> <span style="animation-delay:.66s">week</span> <span class="hl" style="animation-delay:.8s">visible.</span></h1>
<div class="row"><span class="chip y" style="animation-delay:1.3s">Free for teams up to 30</span><span class="chip p" style="animation-delay:1.45s">🎓 Free Pro for students</span></div>
<div class="url" style="animation-delay:1.9s">uni-teamtrack.web.app</div></body></html>`;

// Caption: 16:9 = lower-third card; 9:16 = big block for the top of the frame
const CAP = (s, v) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
body{background:transparent;display:flex;align-items:${v ? 'center' : 'flex-end'};justify-content:center;padding:${v ? '0 56px' : '0 0 54px'}}
.c{display:flex;align-items:center;gap:${v ? 26 : 22}px;background:#fff;border:4px solid #14213d;border-radius:${v ? 30 : 24}px;box-shadow:8px 8px 0 #14213d;padding:${v ? '30px 36px' : '20px 32px 20px 22px'};max-width:${v ? 968 : 1500}px}
.n{flex:none;width:${v ? 78 : 64}px;height:${v ? 78 : 64}px;border-radius:50%;background:#ffc53d;border:4px solid #14213d;display:grid;place-items:center;font-weight:900;font-size:${v ? 40 : 32}px}
.m{font-weight:900;font-size:${v ? 60 : 50}px;line-height:1.08;letter-spacing:-.02em}
.s{font-weight:600;font-size:${v ? 36 : 30}px;color:#44506b;margin-top:${v ? 10 : 6}px;line-height:1.25}
</style></head><body><div class="c"><div class="n">${s.n}</div><div><div class="m">${s.main}</div><div class="s">${s.sub}</div></div></div></body></html>`;

// Vertical background: big caption on top, a tall window onto the app, logo and link at the bottom
const VW = 1032, VH = 1240, VY = 520;
const VBG = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
body{${PAPER}position:relative}
.frame{position:absolute;left:${24 - 6}px;top:${VY - 6}px;width:${VW + 12}px;height:${VH + 12}px;border:6px solid #14213d;border-radius:26px;background:#14213d;box-shadow:12px 12px 0 #14213d}
.bot{position:absolute;bottom:44px;left:40px;right:40px;display:flex;align-items:center;justify-content:space-between;font-weight:900;font-size:40px}
.bot .b{display:flex;align-items:center;gap:14px}.bot img{width:58px;height:58px;border-radius:15px;border:3px solid #14213d;box-shadow:3px 3px 0 #14213d}
.bot span.u{padding:10px 22px;border:4px solid #14213d;border-radius:16px;background:#0e9f8e;color:#fff;box-shadow:5px 5px 0 #14213d;font-size:34px}
</style></head><body><div class="frame"></div><div class="bot"><span class="b"><img src="${logo}">Trawpie</span><span class="u">uni-teamtrack.web.app</span></div></body></html>`;

// ── Render HTML assets ─────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
async function still(html, file, w, h, transparent = false) {
  const p = await browser.newPage({ viewport: { width: w, height: h } }); await p.setContent(html); await p.waitForTimeout(150);
  await p.screenshot({ path: file, omitBackground: transparent }); await p.close();
}
async function anim(html, file, w, h, seconds) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, recordVideo: { dir: T + 'rec-' + file, size: { width: w, height: h } } });
  const p = await ctx.newPage(); const t0 = Date.now();
  await p.setContent(html); // animations start as the content loads
  const lead = (Date.now() - t0) / 1000; await p.waitForTimeout(seconds * 1000 + 300);
  const v = p.video(); await ctx.close(); const webm = await v.path();
  ff(['-ss', lead.toFixed(2), '-i', webm, '-t', String(seconds), '-vf', `fps=${FPS},scale=${w}:${h}`, ...ENC, T + file + '.mp4']);
}
for (const v of [false, true]) {
  const [w, h] = v ? [1080, 1920] : [1920, 1080]; const sfx = v ? '-v' : '';
  await anim(INTRO(v), 'intro' + sfx, w, h, SCENES[0].d);
  await anim(OUTRO(v), 'outro' + sfx, w, h, SCENES.at(-1).d);
  for (const s of SCENES.filter(x => x.main)) await still(CAP(s, v), T + 'cap-' + s.id + sfx + '.png', v ? 1080 : 1920, v ? 560 : 1080, true);
}
await still(VBG, T + 'vbg.png', 1080, 1920);
await browser.close();
console.log('  ✓ cards and captions');

// ── Clean scene footage (1920×1080, no captions) ───────────────────────────
for (const s of SCENES) {
  if (s.html) { s.d16 = T + s.html + '.mp4'; s.d9 = T + s.html + '-v.mp4'; continue; }
  const out = T + 'clean-' + s.id + '.mp4';
  if (s.clip) {
    const [f, a, b, sp] = s.clip; s.d = +((b - a) / sp).toFixed(2);
    ff(['-ss', String(a), '-t', String(b - a), '-i', KIT + f, '-vf', `setpts=PTS/${sp},fps=${FPS},scale=1920:1080:flags=lanczos`, ...ENC, out]);
  } else {
    const [f, secs, fx, fy] = s.img; s.d = secs; const frames = Math.round(secs * FPS);
    ff(['-loop', '1', '-i', KIT + f, '-vf', `scale=3840:-1,zoompan=z='1+0.10*on/${frames}':x='iw*${fx}-iw/zoom/2':y='ih*${fy}-ih/zoom/2':d=${frames}:s=1920x1080:fps=${FPS}`, '-t', String(secs), ...ENC, out]);
  }
  s.clean = out;
}
console.log('  ✓ footage');

// ── Compose each scene in both formats ────────────────────────────────────
for (const s of SCENES.filter(x => x.clean)) {
  const capFade = `format=rgba,fade=t=in:st=0.25:d=0.35:alpha=1`;
  // 16:9: caption over the bottom of the footage
  ff(['-i', s.clean, '-loop', '1', '-t', String(s.d), '-i', T + 'cap-' + s.id + '.png',
    '-filter_complex', `[1:v]${capFade}[c];[0:v][c]overlay=0:0:shortest=1`, ...ENC, (s.d16 = T + 's16-' + s.id + '.mp4')]);
  // 9:16: background, footage in the frame, big caption above
  const cw = Math.round(1080 * VW / VH / 2) * 2; const cx = Math.max(0, Math.min(1920 - cw, Math.round((s.vx ?? 0.5) * 1920 - cw / 2)));
  ff(['-loop', '1', '-t', String(s.d), '-i', T + 'vbg.png', '-i', s.clean, '-loop', '1', '-t', String(s.d), '-i', T + 'cap-' + s.id + '-v.png',
    '-filter_complex', `[1:v]crop=${cw}:1080:${cx}:0,scale=${VW}:${VH}:flags=lanczos[f];[0:v][f]overlay=24:${VY}[b];[2:v]${capFade}[c];[b][c]overlay=0:-30:shortest=1`, ...ENC, (s.d9 = T + 's9-' + s.id + '.mp4')]);
}
console.log('  ✓ scenes composed');

// ── Join with crossfades ───────────────────────────────────────────────────
function join(files, out) {
  const lens = files.map(dur); const inputs = files.flatMap(f => ['-i', f]);
  let chain = '', prev = '[0:v]', t = lens[0];
  for (let i = 1; i < files.length; i++) {
    const off = (t - XF).toFixed(3); const lab = i === files.length - 1 ? '[out]' : `[x${i}]`;
    chain += `${prev}[${i}:v]xfade=transition=fade:duration=${XF}:offset=${off}${lab};`; prev = lab; t = t - XF + lens[i];
  }
  ff([...inputs, '-filter_complex', chain.replace(/;$/, ''), '-map', '[out]', ...ENC, '-movflags', '+faststart', out]);
  return dur(out);
}
const d16 = join(SCENES.map(s => s.d16), OUT + 'Trawpie-60s.mp4');
const d9 = join(SCENES.map(s => s.d9), OUT + 'Trawpie-60s-vertical.mp4');
console.log('  ✓ Trawpie-60s.mp4', d16.toFixed(1) + 's', '· Trawpie-60s-vertical.mp4', d9.toFixed(1) + 's');
