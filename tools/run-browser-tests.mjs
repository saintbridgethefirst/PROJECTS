// Runs every browser test suite against a fresh build of the demo site.
//   npm run test:browser            (builds first)
//   node tools/run-browser-tests.mjs --no-build plans finance   (only some suites)
// A suite that fails is run once more: if it then passes it is reported as FLAKY (not a failure),
// so a timing hiccup on a slow machine doesn't block a deploy but still shows up in the log.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const only = args.filter(a => !a.startsWith('--'));
const SKIP = new Set(['scenarios.mjs', 'editor-list.mjs']); // shared code, not suites
// Penteint Projects switches the education parts off (src/edition.js): their suites belong to Trawpie.
const { EDUCATION } = await import('../src/edition.js');
if (!EDUCATION) ['plans.mjs', 'dissertation.mjs'].forEach(f => SKIP.add(f));
const suites = fs.readdirSync(ROOT + 'tests').filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && !SKIP.has(f))
  .filter(f => !only.length || only.some(o => f.startsWith(o))).sort();

if (!noBuild) { console.log('▸ Building the site'); execSync('npm run build', { cwd: ROOT, stdio: 'inherit' }); }

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* gone */ } };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130); });
for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:4173/'); if (r.ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 500)); }

function run(file) {
  return new Promise(resolve => {
    const t0 = Date.now(); let out = '';
    const p = spawn(process.execPath, ['tests/' + file], { cwd: ROOT, env: process.env });
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 8 * 60 * 1000);
    p.on('close', code => { clearTimeout(timer); const m = /RESULT: (\d+) passed, (\d+) failed/.exec(out); resolve({ code, out, secs: Math.round((Date.now() - t0) / 1000), pass: m ? +m[1] : 0, fail: m ? +m[2] : (code ? 1 : 0) }); });
  });
}

const rows = []; let failed = 0;
for (const f of suites) {
  process.stdout.write(`▸ ${f.padEnd(16)} `);
  let r = await run(f); let flaky = false;
  if (r.code !== 0) { const again = await run(f); if (again.code === 0) { flaky = true; r = again; } else r = again; }
  const status = r.code === 0 ? (flaky ? 'FLAKY' : 'ok') : 'FAILED';
  console.log(`${status.padEnd(7)} ${String(r.pass).padStart(3)} passed${r.fail ? ', ' + r.fail + ' failed' : ''} · ${r.secs}s`);
  r.out.split('\n').filter(l => l.startsWith('::notice')).forEach(l => console.log(l));   // a suite's note for GitHub's summary page
  if (r.code !== 0) { failed++; console.log(r.out.split('\n').filter(l => /FAIL|CRASH|Error|page errors: \[.+\]/.test(l)).slice(0, 15).map(l => '    ' + l).join('\n')); }
  rows.push({ f, status, ...r });
}
stop();
const total = rows.reduce((a, r) => a + r.pass, 0);
console.log(`\n${rows.length} suites, ${total} checks passed, ${failed} suite${failed === 1 ? '' : 's'} failed, ${rows.filter(r => r.status === 'FLAKY').length} flaky.`);
process.exit(failed ? 1 : 0);
