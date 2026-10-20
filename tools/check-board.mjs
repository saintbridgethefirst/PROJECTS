// Static check: every function the board calls must be defined (or be a known global).
import fs from 'node:fs';
import * as acorn from 'acorn';
const src = fs.readFileSync(new URL('../public/board/board.js', import.meta.url), 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
const defined = new Set(); const called = new Map();
(function walk(n, depth) {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'FunctionDeclaration' && n.id) defined.add(n.id.name);
  if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') defined.add(n.id.name);
  if ((n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration')) n.params.forEach(p => { const q = p.type === 'AssignmentPattern' ? p.left : p; if (q.type === 'Identifier') defined.add(q.name); });
  if (n.type === 'CatchClause' && n.param && n.param.type === 'Identifier') defined.add(n.param.name);
  if (n.type === 'CallExpression' && n.callee.type === 'Identifier') called.set(n.callee.name, (called.get(n.callee.name) || 0) + 1);
  for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(c => walk(c)); else if (v && typeof v.type === 'string') walk(v); }
})(ast);
// Inline handlers in HTML strings: onclick="fn(...)"
for (const m of src.matchAll(/on(?:click|change|input)="([A-Za-z_$][\w$]*)\(/g)) called.set(m[1], (called.get(m[1]) || 0) + 1);
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
for (const m of html.matchAll(/on(?:click|change|input)="([A-Za-z_$][\w$]*)\(/g)) called.set(m[1], (called.get(m[1]) || 0) + 1);
const GLOBALS = new Set(['String', 'Number', 'Math', 'Date', 'JSON', 'Array', 'Object', 'Set', 'Map', 'Promise', 'Error', 'Blob', 'URL', 'Image', 'confirm', 'alert', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'Boolean', 'isNaN', 'parseFloat', 'parseInt', 'encodeURIComponent', 'FileReader', 'Uint8Array', 'structuredClone']);
const missing = [...called.keys()].filter(n => !defined.has(n) && !GLOBALS.has(n));
console.log(missing.length ? 'UNDEFINED CALLS: ' + missing.join(', ') : 'All called functions are defined.');
process.exit(missing.length ? 1 : 0);
