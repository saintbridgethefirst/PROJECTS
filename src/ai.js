// ─────────────────────────────────────────────────────────────────────────────
//  AI summaries — two honest, free routes:
//   1. Copy for AI: build a ready-made prompt from the board; the user pastes it
//      into any chatbot they choose. No API, nothing is sent automatically.
//   2. In-app: the user's OWN free Gemini API key (kept only in their browser).
// ─────────────────────────────────────────────────────────────────────────────
import { el, toast, modal } from './ui.js';

const KEY_STORE = 'tt_gemini_key';
const CHATBOTS = [
  ['ChatGPT', 'https://chatgpt.com/'], ['Gemini', 'https://gemini.google.com/app'],
  ['Claude', 'https://claude.ai/new'], ['Copilot', 'https://copilot.microsoft.com/'],
];
const GOALS = {
  status: 'Write a concise weekly status update for the whole team: overall progress, what was completed, what is in progress, and what is next.',
  risks: 'Identify risks and blockers: overdue work, Blocker/Critical items, people who are overloaded, tasks without deadlines, and anything likely to slip. Suggest concrete next steps.',
  people: 'Write a short update for each person: what they finished, what they are working on, anything overdue, and one suggestion.',
  deadlines: 'List upcoming deadlines for the next 14 days in date order, flag anything overdue, and suggest a realistic order to tackle them.',
};

export function buildPrompt(rows, kpi, opts, teamName, phases = []) {
  const names = new Map(); let n = 0;
  const who = (name) => { if (!opts.anonymise) return name; if (!names.has(name)) names.set(name, 'Person ' + String.fromCharCode(65 + (n++ % 26)) + (n > 26 ? Math.ceil(n / 26) : '')); return names.get(name); };
  const lines = rows.map(r => {
    const bits = [`[${r.week}${r.weekStart ? ' from ' + r.weekStart : ''} | ${who(r.person)} | ${r.category}] ${r.task}`, `priority ${r.priority}`, `state ${r.flag}`];
    if (r.phase) bits.push(`phase ${r.phase}`);
    if (r.status) bits.push(`status "${r.status}"`);
    if (r.deadline) bits.push(`due ${r.deadline}` + (r.overdue ? ` (OVERDUE by ${-r.daysToDeadline}d)` : ''));
    if (r.completedOn) bits.push(`completed ${r.completedOn}`);
    if (r.subtasks.length) bits.push(`subtasks ${r.subtasks.filter(s => s.done).length}/${r.subtasks.length}` + (opts.subtasks ? ': ' + r.subtasks.map(s => (s.done ? '[x] ' : '[ ] ') + s.title).join('; ') : ''));
    if (r.supporting.length) bits.push('supported by ' + r.supporting.map(who).join(' & '));
    Object.entries(r.custom).forEach(([k, v]) => bits.push(`${k}: ${v}`));
    if (opts.files && r.files.length) bits.push('files: ' + r.files.map(f => f.name).join(', '));
    return '- ' + bits.join(' · ');
  });
  const goal = opts.goal === 'custom' ? (opts.question || 'Summarise this board.') : GOALS[opts.goal];
  return [
    `You are helping a team review its progress tracker${opts.anonymise ? '' : ` for "${teamName}"`}. Today is ${new Date().toLocaleDateString('en-CA')}.`,
    `Task: ${goal}`,
    'Use only the data below. Be specific (name tasks and people), keep it under 300 words, use short headings and bullet points, and say clearly if something important is missing from the data.',
    '',
    `Numbers: ${kpi.total} tasks, ${kpi.completed} completed (${kpi.pct}%), ${kpi.pending} pending, ${kpi.backlog} backlog, ${kpi.open} open, ${kpi.overdue} overdue, ${kpi.dueWeek} due in the next 7 days, ${kpi.risk} open Blocker/Critical.`,
    '',
    ...(phases && phases.length ? ['Project phases, in order: ' + phases.map(p => p.name + (p.start || p.end ? ` (${p.start || '?'} to ${p.end || '?'})` : '') + (p.milestone ? ` — milestone: ${p.milestone}` : '')).join('; ') + '.', ''] : []),
    'Tasks (one per line):',
    ...lines,
  ].join('\n');
}

export function openAI(ctx) {
  const TT = ctx.TT;
  if (!TT.can('data.export')) { toast('Your role can’t export board data for AI.'); return; }
  const m = modal('AI summary');
  const opts = { scope: 'all', person: 'all', goal: 'status', question: '', anonymise: false, subtasks: true, files: false };
  const sel = (label, options, value, on) => { const s = el('select.inp'); options.forEach(([v, t]) => s.append(el('option', { value: v, selected: v === value }, t))); s.addEventListener('change', () => on(s.value)); return el('label.field', { style: { margin: 0, minWidth: '160px', flex: '1' } }, el('span', {}, label), s); };
  const chk = (label, key) => el('label.row', { style: { fontSize: '13px', gap: '6px' } }, el('input', { type: 'checkbox', checked: opts[key], onchange: (e) => { opts[key] = e.target.checked; update(); } }), label);
  const question = el('textarea.inp', { rows: 2, placeholder: 'e.g. Which tasks should we drop to hit the demo on Friday?', hidden: true });
  question.addEventListener('input', () => { opts.question = question.value; update(); });
  const controls = el('div', {},
    el('div.row', { style: { alignItems: 'flex-end' } },
      sel('What do you want?', [['status', 'Weekly status update'], ['risks', 'Risks & blockers'], ['people', 'Update per person'], ['deadlines', 'Upcoming deadlines'], ['custom', 'Ask my own question']], opts.goal, (v) => { opts.goal = v; question.hidden = v !== 'custom'; update(); }),
      sel('People', [['all', 'Everyone'], ...TT.members.map(p => [p.uid, p.name || p.email])], 'all', (v) => { opts.person = v; update(); }),
      sel('Weeks', [['all', 'All weeks'], ['last4', 'Last 4 weeks'], ['visible', 'Visible on board']], 'all', (v) => { opts.scope = v; update(); })),
    question,
    el('div.row', { style: { margin: '10px 0 4px' } }, chk('Include sub-task details', 'subtasks'), chk('Include file names', 'files'), chk('Hide people’s names (Person A, B…)', 'anonymise')));

  const tabs = el('div.tabs'); const paneCopy = el('div'); const paneApp = el('div', { hidden: true });
  const tabBtn = (label, on) => el('button' + (on ? '.on' : ''), { type: 'button' }, label);
  const t1 = tabBtn('Copy to any AI chatbot (free)', true), t2 = tabBtn('Answer here (your Gemini key)');
  t1.onclick = () => { t1.classList.add('on'); t2.classList.remove('on'); paneCopy.hidden = false; paneApp.hidden = true; };
  t2.onclick = () => { t2.classList.add('on'); t1.classList.remove('on'); paneCopy.hidden = true; paneApp.hidden = false; };
  tabs.append(t1, t2);

  // Route 1: copy
  const promptBox = el('textarea.ai-prompt', { 'aria-label': 'Prompt to copy' });
  const size = el('div.hint');
  const copy = async () => { try { await navigator.clipboard.writeText(promptBox.value); } catch { promptBox.select(); document.execCommand('copy'); } toast('Prompt copied — paste it into the chatbot.'); };
  paneCopy.append(
    el('p.hint', {}, 'Copy this prompt, open any chatbot below, and paste it in. Nothing is sent until you paste it yourself. To ask about a file, attach it in the chatbot alongside the prompt.'),
    promptBox, size,
    el('div.row', { style: { marginTop: '10px' } }, el('button.btn.primary', { type: 'button', onclick: copy }, 'Copy prompt'),
      el('span.hint', {}, 'then open:'),
      el('div.chatbots', {}, ...CHATBOTS.map(([name, url]) => el('a.btn.small', { href: url, target: '_blank', rel: 'noopener noreferrer', onclick: () => { copy(); } }, name)))));

  // Route 2: Gemini key
  let key = ''; try { key = localStorage.getItem(KEY_STORE) || ''; } catch { /* blocked */ }
  const keyIn = el('input.inp', { type: 'password', value: key, placeholder: 'Paste your Gemini API key', autocomplete: 'off', 'aria-label': 'Gemini API key' });
  const fileIn = el('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.md' });
  const out = el('div.ai-out', {}, 'The answer will appear here.');
  const run = el('button.btn.primary', { type: 'button' }, 'Summarise');
  run.addEventListener('click', async () => {
    const k = keyIn.value.trim(); if (!k) { toast('Add your Gemini API key first.'); return; }
    try { localStorage.setItem(KEY_STORE, k); } catch { /* blocked */ }
    run.disabled = true; out.textContent = 'Thinking…';
    try { out.textContent = await askGemini(k, promptBox.value, fileIn.files[0]); }
    catch (e) { out.textContent = 'Could not get an answer: ' + e.message; }
    finally { run.disabled = false; }
  });
  paneApp.append(
    el('div.banner', { style: { marginBottom: '12px' } }, 'Uses ', el('b', {}, 'your own'), ' free Gemini API key, stored only in this browser. Get one at ',
      el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer' }, 'aistudio.google.com/apikey'),
      '. The board data in the prompt is sent to Google. On the free tier Google may use it to improve its products, so turn on “Hide people’s names” for anything sensitive, and check your organisation’s rules.'),
    el('label.field', {}, el('span', {}, 'Gemini API key'), keyIn),
    el('label.field', {}, el('span', {}, 'Optional: a file for the AI to read with the board (PDF, image, text or CSV, up to 15 MB)'), fileIn),
    el('div.row', { style: { marginBottom: '12px' } }, run, el('button.btn.ghost', { type: 'button', onclick: () => { keyIn.value = ''; try { localStorage.removeItem(KEY_STORE); } catch { /* */ } toast('Key removed from this browser.'); } }, 'Forget key'),
      el('span.spacer'), el('button.btn.small', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(out.textContent); toast('Answer copied.'); } catch { toast('Select the text to copy it.'); } } }, 'Copy answer')),
    out);

  function update() {
    const rows = window.boardRows({ scope: opts.scope, person: opts.person });
    const kpi = window.boardKpis({ scope: opts.scope, person: opts.person });
    promptBox.value = buildPrompt(rows, kpi, opts, TT.team.name, TT.team.phases);
    const chars = promptBox.value.length;
    size.textContent = `${rows.length} tasks · ${chars.toLocaleString()} characters` + (chars > 12000 ? ' — long: some free chatbots cut off very long messages; narrow it to one person or the last 4 weeks.' : '');
  }
  m.body.append(controls, tabs, paneCopy, paneApp);
  m.foot.append(el('button.btn', { type: 'button', onclick: m.close }, 'Close'));
  update();
}

async function pickModel(key) {
  const cached = sessionStorage.getItem('tt_gemini_model'); if (cached) return cached;
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': key } });
  if (!r.ok) throw new Error(r.status === 400 || r.status === 403 ? 'the API key was rejected' : 'model list failed (' + r.status + ')');
  const models = ((await r.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'));
  const pick = models.find(m => /flash/.test(m.name) && !/thinking|image|tts|live|exp/.test(m.name)) || models[0];
  if (!pick) throw new Error('no suitable model is available for this key');
  sessionStorage.setItem('tt_gemini_model', pick.name);
  return pick.name;
}

async function askGemini(key, prompt, file) {
  const parts = [{ text: prompt }];
  if (file) {
    if (file.size > 15 * 1024 * 1024) throw new Error('the file is larger than 15 MB');
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = () => rej(new Error('could not read the file')); fr.readAsDataURL(file); });
    const mime = file.type || (/\.md$/i.test(file.name) ? 'text/markdown' : /\.csv$/i.test(file.name) ? 'text/csv' : 'text/plain');
    parts.push({ text: `\nAlso use the attached file "${file.name}".` }, { inline_data: { mime_type: mime, data: b64 } });
  }
  const model = await pickModel(key);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { sessionStorage.removeItem('tt_gemini_model'); throw new Error((j.error && j.error.message) || ('request failed (' + r.status + ')')); }
  const text = (j.candidates || []).flatMap(c => (c.content && c.content.parts) || []).map(p => p.text || '').join('').trim();
  if (!text) throw new Error('the model returned no text' + (j.promptFeedback && j.promptFeedback.blockReason ? ' (' + j.promptFeedback.blockReason + ')' : ''));
  return text;
}
