// delegation-census.mjs — a READ-ONLY, path-free census of one repository's leftover Claude Code
// worktrees and their subagent metadata (delegation broker wave 1, spec 2026-10-04 §8.1 questions
// 3, 6 and 9). It reads `<repo>/.git/worktrees/*` and, in each config home given, only the
// `projects/<project>/<uuid>/subagents/` entries that name a record it found. It prints classes,
// booleans and counts — never a path, a record name, an id, a session uuid or a metadata VALUE
// (a description can carry user text); metadata KEY names are printed only from an allow-list of the
// known Claude Code meta key names — any other key (an id-shaped one included) prints as '(unprintable)'.
// An unparsable or path-less meta, and an unreadable home or projects directory, each carry their own
// marker (`meta.malformed`, `totals.metaMalformed`, `totals.homesUnreadable`) so they never read as
// "no metadata" or "nothing there".
// Usage: node deploy/delegation-census.mjs --repo <main checkout> [--ccd-root <dir>] --home <dir> [--home <dir>]...
import fs from 'node:fs';
import path from 'node:path';

const usage = () => { process.stderr.write('usage: node deploy/delegation-census.mjs --repo <main checkout> [--ccd-root <dir>] --home <dir> [--home <dir>]...\n'); process.exit(2); };
let repo = null;
let ccdRoot = null;
const homes = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const v = argv[i + 1];
  if (typeof v !== 'string' || v === '') usage();
  if (argv[i] === '--repo' && repo === null) repo = path.resolve(v);
  else if (argv[i] === '--ccd-root' && ccdRoot === null) ccdRoot = path.resolve(v);
  else if (argv[i] === '--home') homes.push(v);
  else usage();
}
if (repo === null || homes.length === 0) usage();

const SHA = /^[0-9a-f]{40}$/;
// The meta key names Claude Code writes (measured on the fleet box, delegation broker wave 1). A name
// outside this set is never printed: a key can be id-shaped (a toolu_ id, a 40-char hex string).
const KNOWN_KEYS = new Set(['agentType', 'description', 'isFork', 'model', 'parentAgentId', 'requestNonInteractive',
  'requestShape', 'spawnDepth', 'spawnedWithWorktree', 'toolUseId', 'workflowPhase', 'worktreeBranch', 'worktreePath']);
const MALFORMED = Symbol('malformed');
const unreadableHomes = new Set();
const munge = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
// ENOENT / ENOTDIR mean "nothing there"; any other failure marks the home unreadable (never folded).
const ls = (d, home = null) => {
  try { return fs.readdirSync(d); } catch (e) {
    if (home !== null && e.code !== 'ENOENT' && e.code !== 'ENOTDIR') unreadableHomes.add(home);
    return [];
  }
};
const text = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const json = (f) => {
  try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : MALFORMED; } catch { return MALFORMED; }
};
const exists = (f) => { try { fs.statSync(f); return true; } catch { return false; } };

const admin = path.join(repo, '.git', 'worktrees');
let adminRead = 'ok';
let names = [];
let dotGitIsFile = false;
try { dotGitIsFile = fs.statSync(path.join(repo, '.git')).isFile(); } catch { /* absent or unreadable: the admin read below says which */ }
if (dotGitIsFile) adminRead = 'not-main';
else try { names = fs.readdirSync(admin).sort(); } catch (e) { adminRead = e.code === 'ENOENT' ? 'absent' : 'unreadable'; }

const wantAgent = new Set(names.filter((n) => /^agent-[A-Za-z0-9]+$/.test(n)).map((n) => n.slice('agent-'.length)));
const wantRun = new Set(names.map((n) => /^(wf_[A-Za-z0-9-]+)-[0-9]+$/.exec(n)).filter(Boolean).map((m) => m[1]));
const agentMetas = new Map();
const wfMetas = new Map();
const wfMalformedRuns = new Set();
const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
if (wantAgent.size + wantRun.size > 0) {
  for (const home of homes) {
    const projects = path.join(home, 'projects');
    for (const proj of ls(projects, home)) {
      for (const uuid of ls(path.join(projects, proj), home)) {
        const sub = path.join(projects, proj, uuid, 'subagents');
        const entries = ls(sub, home);
        for (const e of entries) {
          const m = /^agent-([A-Za-z0-9]+)\.meta\.json$/.exec(e);
          if (m && wantAgent.has(m[1])) push(agentMetas, m[1], { home, proj, uuid, meta: json(path.join(sub, e)) });
        }
        if (!entries.includes('workflows')) continue;
        for (const run of ls(path.join(sub, 'workflows'), home)) {
          if (!wantRun.has(run)) continue;
          for (const e of ls(path.join(sub, 'workflows', run), home)) {
            if (!e.endsWith('.meta.json')) continue;
            const meta = json(path.join(sub, 'workflows', run, e));
            // An unparsable or path-less workflow meta names no record; it marks its whole run instead.
            if (meta !== MALFORMED && typeof meta.worktreePath === 'string') push(wfMetas, meta.worktreePath, { home, proj, uuid, meta });
            else wfMalformedRuns.add(run);
          }
        }
      }
    }
  }
}

const parentClass = (proj) => {
  if (proj === munge(repo)) return 'main-checkout';
  if (ccdRoot !== null && proj.startsWith(`${munge(ccdRoot)}-`)) return 'ccd-workspace';
  return 'other';
};
function metaSummary(list, wt, runMalformed) {
  if (list === undefined || list.length === 0) return { found: false, malformed: runMalformed, homes: 0, uuids: 0, worktreePathEquals: null, keys: [], parentCwdClass: null };
  const valid = list.filter((x) => x.meta !== MALFORMED);
  const keys = new Set();
  for (const x of valid) for (const k of Object.keys(x.meta)) keys.add(KNOWN_KEYS.has(k) ? k : '(unprintable)');
  const classes = new Set(list.map((x) => parentClass(x.proj)));
  return {
    found: true, malformed: runMalformed || valid.length < list.length,
    homes: new Set(list.map((x) => x.home)).size, uuids: new Set(list.map((x) => x.uuid)).size,
    worktreePathEquals: wt === null || valid.length === 0 ? null : valid.every((x) => x.meta.worktreePath === wt),
    keys: [...keys].sort(), parentCwdClass: classes.size === 1 ? [...classes][0] : 'mixed',
  };
}
const ageBucket = (dir) => {
  let ms;
  try { ms = fs.statSync(dir).mtimeMs; } catch { return 'unmeasured'; }
  const h = (Date.now() - ms) / 3_600_000;
  return h < 1 ? '<1h' : h < 24 ? '<1d' : h < 168 ? '<7d' : '>=7d';
};

const records = [];
for (const n of names) {
  const a = path.join(admin, n);
  const kind = /^agent-[A-Za-z0-9]+$/.test(n) ? 'agent' : /^wf_[A-Za-z0-9-]+-[0-9]+$/.test(n) ? 'wf' : 'other';
  const gd = text(path.join(a, 'gitdir'));
  const wt = gd === null ? null : path.dirname(path.resolve(a, gd.trim()));   // a relative gitdir is relative to the record dir
  const runId = /^(wf_[A-Za-z0-9-]+)-[0-9]+$/.exec(n)?.[1];
  const headTxt = text(path.join(a, 'HEAD'));
  const head = headTxt === null ? 'unreadable' : /^ref: /.test(headTxt) ? 'ref' : SHA.test(headTxt.trim()) ? 'detached' : 'malformed';
  const baseTxt = text(path.join(a, 'CLAUDE_BASE'));
  const base = baseTxt !== null && SHA.test(baseTxt.trim()) ? baseTxt.trim() : null;
  const firstLine = (text(path.join(a, 'logs', 'HEAD')) ?? '').split('\n')[0];
  const firstLog = firstLine.split(' ')[1] ?? null;
  records.push({
    kind, head,
    claudeBase: baseTxt === null ? 'absent' : base === null ? 'malformed' : 'ok',
    baseAgreesFirstLog: base !== null && firstLog !== null && SHA.test(firstLog) ? base === firstLog : null,
    movedFromBase: base !== null && head === 'detached' ? headTxt.trim() !== base : null,
    locked: exists(path.join(a, 'locked')),
    worktreeDir: wt === null ? 'unmeasured' : exists(wt) ? 'present' : 'absent',
    ageBucket: ageBucket(a),
    meta: kind === 'agent' ? metaSummary(agentMetas.get(n.slice('agent-'.length)), wt, false)
      : kind === 'wf' ? metaSummary(wt === null ? undefined : wfMetas.get(wt), wt, wfMalformedRuns.has(runId)) : null,
  });
}
const count = (pred) => records.filter(pred).length;
const tally = (f) => { const t = {}; for (const r of records) { const k = f(r); if (k !== null) t[k] = (t[k] ?? 0) + 1; } return t; };
const out = {
  v: 1, adminRead, records,
  totals: {
    records: records.length, agent: count((r) => r.kind === 'agent'), wf: count((r) => r.kind === 'wf'), other: count((r) => r.kind === 'other'),
    metaFound: count((r) => r.meta?.found === true), metaMissing: count((r) => r.meta !== null && !r.meta.found),
    metaMalformed: count((r) => r.meta?.malformed === true), homesUnreadable: unreadableHomes.size,
    multiHome: count((r) => (r.meta?.homes ?? 0) > 1), worktreeAbsent: count((r) => r.worktreeDir === 'absent'),
    byAge: tally((r) => r.ageBucket), byParent: tally((r) => r.meta?.parentCwdClass ?? null),
  },
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
