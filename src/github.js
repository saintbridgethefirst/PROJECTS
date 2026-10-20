// ─────────────────────────────────────────────────────────────────────────────
//  GitHub links on tasks. Paste an issue or pull-request link as a task link and
//  the task shows its live state (open, closed, merged) and title. Uses GitHub's
//  public API from the browser: no account or setup. Public repositories only;
//  links to private ones still work as plain links. Results are cached for 10
//  minutes to stay well inside GitHub's limit of 60 look-ups an hour.
// ─────────────────────────────────────────────────────────────────────────────
const RE = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)(?:[/?#].*)?$/i;
const TTL = 10 * 60 * 1000;
const KEY = 'tt_gh_cache';
const inflight = new Map();
let cache = {};
try { cache = JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch { cache = {}; }
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* */ } };

/** { owner, repo, kind: 'issue'|'pull', number, label: 'owner/repo#12' } or null */
export function parseGithub(url) {
  const m = RE.exec(String(url || '').trim()); if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, ''), kind: m[3].toLowerCase() === 'pull' ? 'pull' : 'issue', number: +m[4], label: m[1] + '/' + m[2] + '#' + m[4] };
}

/**
 * Live state of an issue or pull request:
 * { state: 'open'|'closed'|'merged'|'draft'|'unknown', title, kind, label, note }
 */
export async function githubStatus(url) {
  const g = parseGithub(url); if (!g) return null;
  const k = g.label.toLowerCase() + ':' + g.kind;
  const hit = cache[k]; if (hit && Date.now() - hit.at < TTL) return hit.v;
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    let v;
    try {
      const api = `https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/${g.kind === 'pull' ? 'pulls' : 'issues'}/${g.number}`;
      const r = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
      if (r.status === 404) v = { state: 'unknown', note: 'Private or not found', title: '' };
      else if (r.status === 403 || r.status === 429) v = { state: 'unknown', note: 'GitHub limit reached — try again later', title: '', retry: true };
      else if (!r.ok) v = { state: 'unknown', note: 'GitHub didn’t answer (' + r.status + ')', title: '', retry: true };
      else {
        const j = await r.json();
        const isPull = g.kind === 'pull' || !!j.pull_request;
        let state = j.state === 'closed' ? 'closed' : 'open';
        if (isPull && (j.merged || j.merged_at || (j.pull_request && j.pull_request.merged_at))) state = 'merged';
        else if (isPull && j.draft && state === 'open') state = 'draft';
        v = { state, title: String(j.title || '').slice(0, 200), kind: isPull ? 'pull' : 'issue', reason: j.state_reason || '' };
      }
    } catch { v = { state: 'unknown', note: 'Couldn’t reach GitHub', title: '', retry: true }; }
    v = { kind: g.kind, ...v, label: g.label, done: v.state === 'closed' || v.state === 'merged' };
    if (!v.retry) { cache[k] = { at: Date.now(), v }; save(); }
    return v;
  })();
  inflight.set(k, p);
  try { return await p; } finally { inflight.delete(k); }
}

export const GH_LABEL = { open: 'Open', closed: 'Closed', merged: 'Merged', draft: 'Draft', unknown: '' };
