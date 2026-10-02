#!/usr/bin/env python3
"""measure-landing.py — the landing-order programme's instrument (spec 2026-09-23 §10).

READ-ONLY, and run by hand on the fleet box. It reads, and never writes, four things:
  * GitHub, through `gh api -X GET` only. `_gh` is the ONE place this file runs gh,
    and it refuses any path that tries to smuggle a method or a flag in
    (`server/test/measure-landing.test.ts` pins both, reading this file's argv
    and running a subcommand against a recording `gh` stub);
  * git objects in a local checkout (`cat-file -e`, `show --remerge-diff`), never a ref;
  * Claude Code transcripts, `$HOME/.claude*/projects/**/*.jsonl`;
  * the ccrc server, through `~/.local/bin/ccrc-api`'s two list verbs (both GET).
    `_api` is the ONE place this file runs that client, and it refuses any verb
    but `runs list` and `mail list` before the client runs (the client also
    carries POST rows — close, send, allocate — and none may be reached from here).
It writes only under --out (default ./landing-measure/): a cache of what it read,
and one JSON report per subcommand, whose summary it also prints.

WHO "THE FLEET" IS. Spec §4: one UNIX user and ONE GitHub login — but a
worktree left on a placeholder git identity committed under that identity's
login instead, so "the fleet" is a SET, and the set is RULED (spec §10): the
fleet's gh login plus the placeholder identity fleet worktrees committed under
before the 2026-09-23 identity rule. `absorptions` and `inversions` REQUIRE it
as --fleet-login L1,L2 — there is no default, so every stage-1 re-measurement
names the same pair the baseline did. No login is ever written into this file
(topology-clean), and every fleet-scoped count below is "actor in that set";
`absorptions` prints the identity census the set is chosen from.

Each subcommand ports an instrument archived beside the spec's brainstorm
transcript (`landing-baseline/`, 2026-09-22). The archive itself is NOT
committed: every one of those scripts hard-codes a scratch directory under an
operator's home, the organisations' names or the fleet's login. The logic is
ported here with those inputs made arguments; each docstring names what it ports.

usage: measure-landing.py <subcommand> [args] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--out DIR]
  required       OWNER/REPO
  main-red       OWNER/REPO [--required a,b,..]
  absorptions    OWNER/REPO --fleet-login L1,L2,..
  remerge        OWNER/REPO --clone DIR
  episodes       [--project NAME ...]
  mail-latency
  green-to-merge OWNER/REPO [--required a,b,..]
  inversions     OWNER/REPO --fleet-login L1,L2,.. [--required a,b,..]
The window defaults to the frozen baseline, 2026-09-08..2026-09-22 inclusive.
"""
import collections, glob, json, os, re, statistics, subprocess, sys, time
from datetime import datetime, timezone, timedelta

BASELINE = ('2026-09-08', '2026-09-22')
RED = ('failure', 'timed_out')


def P(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


# ── the one door to GitHub ──────────────────────────────────────────────────
# The leading lookahead refuses a `..` SEGMENT anywhere in the path (not a name that
# merely contains dots): the character class admits `.` and `/`, so without it
# `repos/a/b/../../../graphql` is a plain REST read by the grammar and `graphql` by the server.
GH_PATH = re.compile(r'^(?![^?]*(?:^|/)\.\.(?:/|\?|$))'
                     r'(user|repos/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(/[A-Za-z0-9._/-]*)?)(\?[A-Za-z0-9._=&%:+-]*)?$')


def _gh(path):
    """GET one GitHub REST path and return its JSON. GET is not a default here, it
    is the only method this file can express: the argv is fixed, and a path that
    carries anything but a REST path (no `..` segment) and a query string is refused
    before gh runs."""
    if not GH_PATH.match(path):
        raise SystemExit(f'measure-landing: refused a GitHub path that is not a plain REST read: {path!r}')
    for attempt in range(4):   # a 5xx is GitHub's, and it passes; anything else is an answer
        r = subprocess.run(['gh', 'api', '-X', 'GET', path], capture_output=True, text=True, timeout=60)
        if r.returncode == 0:
            return json.loads(r.stdout)
        if 'HTTP 5' not in r.stderr:
            break
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'gh api {path}: {r.stderr.strip()[:200]}')


def _pages(path, key=None, stop=None):
    """Every page of a list endpoint (`per_page=100`), optionally the list under
    `key`, stopping early once `stop(item)` is true for the last item of a page."""
    out, page = [], 1
    sep = '&' if '?' in path else '?'
    while True:
        d = _gh(f'{path}{sep}per_page=100&page={page}')
        items = d.get(key, []) if key else d
        out.extend(items)
        if len(items) < 100 or (stop and items and stop(items[-1])):
            return out
        page += 1


class Cache:
    """Every read, keyed and kept under --out, so a re-run after a failure costs
    nothing already paid and the report can be re-derived from what was read."""
    def __init__(self, out):
        self.dir = os.path.join(out, 'cache'); os.makedirs(self.dir, exist_ok=True)

    def get(self, key, fn):
        f = os.path.join(self.dir, re.sub(r'[^A-Za-z0-9._-]', '_', key) + '.json')
        if os.path.exists(f):
            return json.load(open(f))
        v = fn()
        json.dump(v, open(f + '.tmp', 'w')); os.replace(f + '.tmp', f)
        return v


# ── pure decisions (tested directly by measure-landing.test.ts) ──────────────
def _attempt_order(c):
    """Sort key of one check-run attempt: completed ones by completion time, and
    one with no completed_at (queued or in progress) after every completed one —
    it is the newest attempt, and a newer attempt is the verdict."""
    return (c.get('completed_at') is None, c.get('completed_at') or '')


def required_state(checks, required):
    """One commit's REQUIRED verdict from its check-runs, each context judged by
    its LATEST attempt (a re-run that went green supersedes the red it re-ran;
    an attempt still in progress, with no completed_at, is the latest of all):
    'green' when every required context's latest attempt succeeded, 'red' when
    any one's failed or timed out, otherwise 'unmeasured' (missing, cancelled,
    still running). A cancelled leg is not a red: a runner cap cancels, it does
    not fail, and nothing about the tree is learned from it. An EMPTY required
    set is not a verdict either: every commit would read green against it
    (`set() <= anything`, `all([])`), so it answers 'unmeasured'."""
    if not required:
        return 'unmeasured'
    latest = {}
    for c in checks:
        n = c.get('name')
        if n in required and (n not in latest or _attempt_order(c) >= _attempt_order(latest[n])):
            latest[n] = c
    if any(c.get('conclusion') in RED for c in latest.values()):
        return 'red'
    if set(required) <= set(latest) and all(c.get('conclusion') == 'success' for c in latest.values()):
        return 'green'
    return 'unmeasured'


def red_intervals(pushes, end):
    """`pushes`: [(iso time, 'red'|'green'|'unmeasured'), ...] for main's pushes.
    An interval opens at the first red push and closes at the next GREEN push —
    an unmeasured push neither opens nor closes one (g15_main_red.py's rule,
    with its third state named). One still open at the window's end closes there."""
    out, start = [], None
    for t, st in sorted(pushes):
        if st == 'red' and start is None:
            start = t
        elif st == 'green' and start is not None:
            out.append((start, t)); start = None
    if start is not None:
        out.append((start, end))
    return out


MAINMSG = re.compile(r"Merge (remote-tracking )?branch '(origin/)?main'|Merge (origin/)?main\b|origin/main|"
                     r"Merge branch 'main' of|current main|latest main|merge: origin/main|Merge main", re.I)

# THE CLASSIFIER'S ONE SPELLING of GitHub's branch update (its Update branch
# button, the `gh pr` verb, the REST route): this label and UPD below are the
# only two lines of this file the executable-source absence pin licenses, and
# it pins them byte for byte. Every other line says GH_UPDATE. Neither
# calls anything: they classify commits and commands that already happened.
GH_UPDATE = 'update-branch'


def merge_of_main(commit, own):
    """g2/classify.py's rule: a commit with two parents whose SECOND parent is not
    one of the PR's own commits, and whose message names main or whose committer
    is GitHub (its Update branch writes `Merge branch 'main' into …` as GitHub).
    Returns GH_UPDATE, 'local' or None."""
    if len(commit['parents']) < 2 or commit['parents'][1]['sha'] in own:
        return None
    msg = (commit['commit']['message'] or '').split('\n')[0]
    github = commit['commit']['committer']['name'] == 'GitHub' or (commit.get('committer') or {}).get('login') == 'web-flow'
    if not (MAINMSG.search(msg) or github):
        return None
    return GH_UPDATE if github else 'local'


def merge_actor(commit, kind):
    """Who did it: the AUTHOR of a merge GitHub made (GitHub commits it on their
    behalf), the committer of a local merge."""
    if kind == GH_UPDATE:
        return (commit.get('author') or {}).get('login') or commit['commit']['author']['name']
    return (commit.get('committer') or {}).get('login') or commit['commit']['committer']['name']


def repeat_share(prs_of_merges):
    """[pr, ...] one entry per merge of main -> (merges, distinct PRs, excess):
    every merge past a PR's first is a repeat (the absorb-once tally)."""
    per = collections.Counter(prs_of_merges)
    return len(prs_of_merges), len(per), sum(n - 1 for n in per.values())


SYNC = re.compile(r"git\s+(?:-C\s+\S+\s+)?(merge|rebase|pull)\b((?:\s+-{1,2}[\w=-]+)*)\s+(origin/main|origin\s+main|main)(?![\w/.-])")
UPD = re.compile(r"gh\s+pr\s+update-branch|/update-branch\b")
PUSH = re.compile(r"git\s+(?:-C\s+\S+\s+)?push\b")


def sync_kind(cmd):
    """r2_scan4.py's classifier for one Bash command: GH_UPDATE, 'merge',
    'rebase', 'pull', 'probe' (merge --no-commit), 'ffonly', or None."""
    if UPD.search(cmd):
        return GH_UPDATE
    m = SYNC.search(cmd)
    if not m:
        return None
    flags = m.group(2) or ''
    if '--abort' in cmd[m.start():m.start() + 80] or '--continue' in flags:
        return None
    if m.group(1) == 'merge' and '--no-commit' in flags:
        return 'probe'
    if '--ff-only' in flags:
        return 'ffonly'
    return m.group(1)


def episode_class(e):
    """p_final.py's classes: B conflict, A pure ritual (no edit, no agent), C mixed."""
    if e['conflict']:
        return 'conflict'
    if e['edits'] == 0 and e['agents'] == 0:
        return 'ritual'
    return 'mixed'


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * q))] if xs else None


def summary(xs):
    return {'n': len(xs), 'median': statistics.median(xs) if xs else None, 'p90': pct(xs, 0.9),
            'max': max(xs) if xs else None}


# ── GitHub-side subcommands ─────────────────────────────────────────────────
def required_contexts(repo, cache):
    """The REQUIRED status contexts on main: the rulesets' and the classic branch
    protection's, unioned — a repository can carry either or both. NEVER EMPTY:
    a union that read nothing (both endpoints failed, or neither names a
    context) is refused rather than returned, because an empty set would make
    `required_state` — before its own guard — answer green for every commit,
    and a cached empty set would do it on every later run too."""
    def read():
        ctx = set()
        try:
            for rule in _gh(f'repos/{repo}/rules/branches/main'):
                if rule.get('type') == 'required_status_checks':
                    ctx |= {c['context'] for c in rule['parameters']['required_status_checks']}
        except RuntimeError:
            pass
        try:
            ctx |= set(_gh(f'repos/{repo}/branches/main/protection/required_status_checks').get('contexts', []))
        except RuntimeError:
            pass
        if not ctx:   # raised BEFORE Cache.get stores anything: a failed read is never cached
            raise SystemExit(f'measure-landing: {repo}: no required status context could be read on main; '
                             'pass --required a,b')
        return sorted(ctx)
    return cache.get(f'required-{repo}', read)


def runs(repo, event, win, cache, branch=None):
    q = f'repos/{repo}/actions/runs?event={event}&created={win[0]}..{win[1]}' + (f'&branch={branch}' if branch else '')
    return cache.get(f'runs-{repo}-{event}-{branch}-{win[0]}-{win[1]}', lambda: _pages(q, 'workflow_runs'))


def checks(repo, sha, cache):
    return cache.get(f'checks-{repo}-{sha}', lambda: _pages(f'repos/{repo}/commits/{sha}/check-runs', 'check_runs'))


def jobs(repo, run_id, cache):
    return cache.get(f'jobs-{repo}-{run_id}', lambda: _pages(f'repos/{repo}/actions/runs/{run_id}/jobs', 'jobs'))


def cmd_main_red(repo, required, win, cache):
    """Ports g15_main_red.py, narrowed to what spec §10 asks: red-main from the
    REQUIRED contexts only, with its PR-failure overlap — and the whole-check
    reading beside it. The whole-check reading does NOT reproduce the archived
    111.2 h / 9 intervals / 50-of-92: the archive read the one `ci` workflow's
    conclusion, and this reads EVERY check-run on the push (red when any failed or
    timed out, green when all succeeded, were skipped or neutral), so on the
    frozen window it measures 10 intervals, 120.7 h and 53 of 91 failed PR runs
    inside them. The figures differ by construction, as `cmd_inversions`'
    departure from g5 does: every baseline is this tool's, and the archived one
    is history.

    A window that reaches past main's CI test-selection change (#183,
    2026-09-23) reads push check-runs that ran no test legs, so a stage-2
    re-measure must read only full runs or refuse such a window; the frozen
    baseline window (2026-09-08..2026-09-22) predates it and is unaffected."""
    end = win[1] + 'T23:59:59Z'
    main = [r for r in runs(repo, 'push', win, cache, branch='main') if r.get('head_branch') == 'main']
    first_push = {}
    for r in main:
        first_push[r['head_sha']] = min(first_push.get(r['head_sha'], r['created_at']), r['created_at'])
    req, whole = [], []
    for sha, t in first_push.items():
        cs = checks(repo, sha, cache)
        req.append((t, required_state(cs, required)))
        concl = [c.get('conclusion') for c in cs]
        whole.append((t, 'red' if any(c in RED for c in concl) else
                      'green' if concl and all(c in ('success', 'skipped', 'neutral') for c in concl) else 'unmeasured'))
    req_iv, whole_iv = red_intervals(req, end), red_intervals(whole, end)
    prs = [r for r in runs(repo, 'pull_request', win, cache) if r.get('conclusion') == 'failure']
    inside = lambda t, ivs: any(s <= t <= e for s, e in ivs)
    req_fail = []
    for r in prs:
        failed = {j['name'] for j in jobs(repo, r['id'], cache) if j.get('conclusion') in RED}
        if failed & set(required):
            req_fail.append(r['created_at'])
    hours = lambda ivs: round(sum((P(e) - P(s)).total_seconds() for s, e in ivs) / 3600, 1)
    return {
        'repo': repo, 'window': win, 'required': required, 'mainPushes': len(first_push),
        'requiredUnmeasuredPushes': sum(1 for _, s in req if s == 'unmeasured'),
        'required_only': {'intervals': req_iv, 'hours': hours(req_iv),
                          'prRequiredFailures': len(req_fail),
                          'prRequiredFailuresInside': sum(1 for t in req_fail if inside(t, req_iv))},
        'whole_checks': {'intervals': whole_iv, 'hours': hours(whole_iv), 'prFailedRuns': len(prs),
                         'prFailedRunsInside': sum(1 for r in prs if inside(r['created_at'], whole_iv))},
    }


def pulls(repo, win, cache):
    """Every PR created, merged or closed inside the window (listed newest-updated
    first, stopping once a page's last PR was last updated before the window)."""
    lo = win[0] + 'T00:00:00Z'
    allp = cache.get(f'pulls-{repo}-{win[0]}-{win[1]}', lambda: _pages(
        f'repos/{repo}/pulls?state=all&sort=updated&direction=desc', stop=lambda p: p['updated_at'] < lo))
    hi = win[1] + 'T23:59:59Z'
    touch = lambda p: any(x and lo <= x <= hi for x in (p['created_at'], p.get('merged_at'), p.get('closed_at')))
    return [p for p in allp if touch(p)]


def merges_of_main(repo, win, cache):
    """Every merge of main committed inside the window on any window PR, once per
    sha (a stacked PR carries its base's merges too; the lowest PR number owns it)."""
    lo, hi = win[0] + 'T00:00:00Z', win[1] + 'T23:59:59Z'
    seen = {}
    for p in sorted(pulls(repo, win, cache), key=lambda p: p['number']):
        cs = cache.get(f'commits-{repo}-{p["number"]}', lambda: _pages(f'repos/{repo}/pulls/{p["number"]}/commits'))
        own = {c['sha'] for c in cs}
        for c in cs:
            kind = merge_of_main(c, own)
            when = c['commit']['committer']['date']
            if kind and lo <= when <= hi and c['sha'] not in seen:
                seen[c['sha']] = {'sha': c['sha'], 'pr': p['number'], 'kind': kind, 'at': when,
                                  'actor': merge_actor(c, kind), 'firstParent': c['parents'][0]['sha']}
    return list(seen.values())


def fleet_logins(args):
    """The fleet's identities, from --fleet-login a,b,… and from nowhere else.
    The set is an operator RULING (spec §10: the fleet's gh login plus the
    placeholder identity fleet worktrees committed under before the 2026-09-23
    identity rule), so there is no default to drift from it: a run without the
    argument is refused before anything is read."""
    got = set(filter(None, (args.get('fleet-login') or '').split(',')))
    if not got:
        raise SystemExit('measure-landing: --fleet-login L1,L2 is required: the fleet is the ruled set of '
                         'identities (spec §10), never a default')
    return got


def cmd_absorptions(repo, win, cache, logins):
    """Ports g2/classify.py (merges of main by kind and actor) and the
    absorb-once tally behind spec §1's 185-of-336, adding the prerequisite
    spec §10 names: the repeat share restricted to fleet committer identities.
    `identities` is the census the fleet set is chosen from: every actor, how
    many merges of main it made, and whether this run counted it as fleet."""
    ms = merges_of_main(repo, win, cache)
    local = [m for m in ms if m['kind'] == 'local']
    fleet_local = [m for m in local if m['actor'] in logins]
    t_all, t_fleet = repeat_share([m['pr'] for m in local]), repeat_share([m['pr'] for m in fleet_local])
    return {
        'repo': repo, 'window': win, 'mergesOfMain': len(ms),
        'byKindAndActor': dict(collections.Counter(
            f"{m['kind']}:{'fleet' if m['actor'] in logins else 'other'}" for m in ms)),
        'identities': {a: {'merges': n, 'fleet': a in logins}
                       for a, n in collections.Counter(m['actor'] for m in ms).most_common()},
        'fleetUpdateBranch': sum(1 for m in ms if m['kind'] == GH_UPDATE and m['actor'] in logins),
        'localAllCommitters': dict(zip(('merges', 'prs', 'repeats'), t_all)),
        'localFleet': dict(zip(('merges', 'prs', 'repeats'), t_fleet)),
        'fleetRepeatShare': round(t_fleet[2] / t_fleet[0], 3) if t_fleet[0] else None,
    }


def cmd_remerge(repo, win, cache, clone):
    """Ports g8/run_remerge.sh + classify.py and r2d_shape.py: a merge of main
    whose `--remerge-diff` is empty is one git made with no hand edit; one with a
    diff was hand-resolved, and each resolved file is a stamp, a union or a
    rewrite. A merge whose objects are not in the clone is unmeasured — this
    tool never fetches."""
    res, shapes = collections.Counter(), collections.Counter()
    for m in merges_of_main(repo, win, cache):
        if subprocess.run(['git', '-C', clone, 'cat-file', '-e', m['sha']], capture_output=True).returncode != 0:
            res['unmeasured'] += 1
            continue
        out = subprocess.run(['git', '-C', clone, 'show', '--remerge-diff', '--format=', m['sha']],
                             capture_output=True, text=True, errors='replace', timeout=120).stdout
        files, cur = {}, None
        for line in out.splitlines():
            mm = re.match(r'^diff --git a/(.*) b/', line)
            if mm:
                cur = mm.group(1); files[cur] = []
            elif cur and line[:1] in '+-' and not line.startswith(('+++', '---')):
                files[cur].append(line)
        if not files:
            res['clean'] += 1
            continue
        res['hand-resolved'] += 1
        for f, ls in files.items():
            body = [l for l in ls if not re.match(r'^[-+](<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)', l)]
            shapes['stamp' if body and all('sha256=' in l for l in body) else
                   'union' if not any(l.startswith('-') for l in body) else 'rewrite'] += 1
    return {'repo': repo, 'window': win, 'merges': dict(res), 'resolvedFileShapes': dict(shapes)}


def cmd_green_to_merge(repo, required, win, cache):
    """The wait from a merged PR's final head going green on every REQUIRED
    context to its merge (spec §10, stage 2's metric). A PR merged before its
    head was green is counted apart, never as a negative wait."""
    waits, early, unmeasured = [], 0, 0
    for p in pulls(repo, win, cache):
        if not p.get('merged_at'):
            continue
        cs = [c for c in checks(repo, p['head']['sha'], cache) if c.get('name') in required]
        if required_state(cs, required) != 'green':
            unmeasured += 1
            continue
        green = max(c['completed_at'] for c in cs if c.get('conclusion') == 'success')
        w = (P(p['merged_at']) - P(green)).total_seconds() / 60
        if w < 0:
            early += 1
        else:
            waits.append(round(w, 1))
    return {'repo': repo, 'window': win, 'minutes': summary(waits), 'mergedBeforeGreen': early,
            'headNotGreen': unmeasured}


def cmd_inversions(repo, required, win, cache, logins):
    """Ports g5_inversions.py. A is READY when its FIRST merge of main in the
    window found its head (the merge's first parent) already green on every
    required context — the sync was ritual, and A could have landed then; B is
    an inversion over A when B was open at that moment and merged after it but
    before A. Only the first merge is asked, as g5 asked only the earliest
    event: a later sync's pre-head being green says nothing about when A was
    first ready. (g5 also read force-pushes from the PR timeline; this tool
    reads commits only, so a PR whose first sync was a force-push is not
    counted — never counted wrongly. Spec §10 retires g5's figures on that
    ground: every inversion baseline is this scan's.) Reported for all actors
    and fleet-on-fleet."""
    prs = {p['number']: p for p in pulls(repo, win, cache) if p.get('merged_at')}
    first = {}
    for m in sorted(merges_of_main(repo, win, cache), key=lambda m: m['at']):
        first.setdefault(m['pr'], m)
    ready = {n: m['at'] for n, m in first.items() if n in prs
             and required_state(checks(repo, m['firstParent'], cache), required) == 'green'}
    pairs = []
    for a, t in ready.items():
        for b, pb in prs.items():
            if b != a and pb['created_at'] <= t < pb['merged_at'] <= prs[a]['merged_at']:
                pairs.append({'A': a, 'B': b, 'fleetOnFleet': prs[a]['user']['login'] in logins and pb['user']['login'] in logins})
    return {'repo': repo, 'window': win, 'readyPrs': len(ready), 'inversions': len(pairs),
            'fleetOnFleet': sum(1 for p in pairs if p['fleetOnFleet']), 'pairs': pairs}


# ── transcript-side subcommands ─────────────────────────────────────────────
def transcripts(since):
    cut = datetime.fromisoformat(since).replace(tzinfo=timezone.utc).timestamp()
    for f in glob.glob(os.path.expanduser('~/.claude*/projects/*/**/*.jsonl'), recursive=True):
        try:
            if os.stat(f).st_mtime >= cut:
                yield f
        except OSError:
            continue


def _records(path):
    with open(path, errors='replace') as fh:
        for line in fh:
            try:
                yield json.loads(line)
            except ValueError:
                continue


def scan_episodes(path, lo, hi):
    """r2_scan4.py's episode scan for one transcript: a run of sync commands opens
    an episode, the next `git push` (or the file's end) closes it, and what
    happened in between classifies it. Keyed by the FIRST sync's tool-use id."""
    uses, results, times = [], {}, []
    for d in _records(path):
        ts = d.get('timestamp'); m = d.get('message') if isinstance(d.get('message'), dict) else None
        if not ts or not m:
            continue
        t = P(ts).timestamp(); times.append(t)
        for c in (m.get('content') if isinstance(m.get('content'), list) else []):
            if not isinstance(c, dict):
                continue
            if d.get('type') == 'assistant' and c.get('type') == 'tool_use':
                inp = c.get('input') if isinstance(c.get('input'), dict) else {}
                cmd = inp.get('command') if isinstance(inp.get('command'), str) else ''
                uses.append((t, c.get('id'), c.get('name'), cmd))
            elif d.get('type') == 'user' and c.get('type') == 'tool_result':
                body = c.get('content')
                body = body if isinstance(body, str) else json.dumps(body)
                results.setdefault(c.get('tool_use_id'), (t, 'CONFLICT' in body))
    eps, cur = [], None
    for t, uid, name, cmd in sorted(uses, key=lambda u: u[0]):
        kind = sync_kind(cmd) if name == 'Bash' and cmd else None
        if kind and lo <= t <= hi:
            if cur is None:
                cur = {'key': uid, 'start': t, 'syncs': [], 'conflict': False, 'edits': 0, 'agents': 0}
            cur['syncs'].append(kind)
            cur['conflict'] |= results.get(uid, (0, False))[1]
            continue
        if cur is None:
            continue
        if name in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit'):
            cur['edits'] += 1
        if name in ('Agent', 'Task', 'Workflow'):
            cur['agents'] += 1
        if name == 'Bash' and PUSH.search(cmd) and not cmd.strip().startswith('#'):
            cur['end'] = t; eps.append(cur); cur = None
    if cur is not None:
        cur['end'] = max(times) if times else cur['start']; eps.append(cur)
    for e in eps:
        pts = sorted(x for x in times if e['start'] <= x <= e['end'])
        e['active_s'] = sum(min(b - a, 300.0) for a, b in zip(pts, pts[1:]))
        e['path'] = path
    return eps


def cmd_episodes(projects, win):
    """Ports r2_scan4.py + the dedup step + p_final.py's classes. Stage 1's
    third metric is the ritual episodes per ISO week."""
    lo = datetime.fromisoformat(win[0]).replace(tzinfo=timezone.utc).timestamp()
    hi = (datetime.fromisoformat(win[1]).replace(tzinfo=timezone.utc) + timedelta(days=1)).timestamp()
    seen, by = set(), collections.defaultdict(collections.Counter)
    hours = collections.Counter()
    for f in transcripts(win[0]):
        slug = f.split('/projects/', 1)[1].split('/')[0].lower()
        proj = next((p for p in projects if p.lower() in slug), None) if projects else slug
        if projects and proj is None:
            continue
        for e in scan_episodes(f, lo, hi):
            if e['key'] in seen:
                continue
            seen.add(e['key'])
            wk = datetime.fromtimestamp(e['start'], timezone.utc).strftime('%G-W%V')
            cls = episode_class(e)
            by[wk][cls] += 1
            hours[cls] += e['active_s'] / 3600
    return {'window': win, 'projects': projects or 'all', 'byWeek': {k: dict(v) for k, v in sorted(by.items())},
            'activeHours': {k: round(v, 1) for k, v in hours.items()}}


NUDGE = 'ccrc-mail: you have new mail.'
MAIL_PAGE = 500   # the server's own clamp (`clampMailLimit`): no read can ask for more
CLOSED_RUNS_CAP = 500   # `runs list --closed 1` answers every active run and only the newest 500 closed ones


# verb -> the key its SUCCESS body carries a list under. `runs list` answers
# `{"runs":[...]}` with no `ok` field at all; `mail list` answers `{"ok":true,"mail":[...]}`.
API_READS = {('runs', 'list'): 'runs', ('mail', 'list'): 'mail'}


def _api(*args):
    """The ONE door to the ccrc server: `~/.local/bin/ccrc-api`, whose table also
    carries POST rows (runs close, mail send, ledger allocate). Only the two list
    verbs pass; anything else is refused before the client runs."""
    if tuple(args[:2]) not in API_READS:
        raise SystemExit(f'measure-landing: refused a ccrc-api verb that is not a list read: {" ".join(args[:2])!r}')
    r = subprocess.run([os.path.expanduser('~/.local/bin/ccrc-api'), *args], capture_output=True, text=True, timeout=60)
    # The client exits 0 on EVERY HTTP answer (a 4xx/5xx `{"ok":false}` body too)
    # and exits 3 on a transport failure while still printing `{"ok":false}`. An
    # answer is data only when it exited 0, parsed to an object, did not say
    # ok:false (every error body does; a success body may carry no `ok` at all)
    # and carries its list under the verb's own key — so a refused read, or a
    # body of some other shape, is never read as an empty list (a coordinator
    # counted with n 0).
    try:
        body = json.loads(r.stdout)
    except ValueError:
        body = None
    key = API_READS[tuple(args[:2])]
    if r.returncode != 0 or not isinstance(body, dict) or body.get('ok') is False or not isinstance(body.get(key), list):
        why = body.get('error') if isinstance(body, dict) else None
        raise SystemExit(f'measure-landing: ccrc-api answered no data for {" ".join(args[:2])!r}: '
                         f'{why or r.stderr.strip()[:200] or "exit " + str(r.returncode)}')
    return body


def nudge_turns(session_id):
    """The timestamps of every turn a mail nudge started in this session's
    transcripts, found through the registry's `workdir` (read only), else by the
    `-<id>` suffix Claude Code gives a worktree's project directory."""
    dirs = []
    wd = os.path.expanduser(f'~/.cc-sessions/{session_id}.workdir')
    if os.path.exists(wd):
        dirs += glob.glob(os.path.expanduser('~/.claude*/projects/') + re.sub(r'[^A-Za-z0-9]', '-', open(wd).read().strip()))
    dirs += glob.glob(os.path.expanduser(f'~/.claude*/projects/*-{session_id}'))
    out = []
    for d in set(dirs):
        for f in glob.glob(os.path.join(d, '*.jsonl')):
            for r in _records(f):
                m = r.get('message') if isinstance(r.get('message'), dict) else None
                if r.get('type') == 'user' and m and isinstance(m.get('content'), str) \
                        and m['content'].startswith(NUDGE) and r.get('timestamp'):
                    out.append(P(r['timestamp']).timestamp() * 1000)
    return sorted(out)


def cmd_mail_latency(win):
    """Spec §10's second prerequisite: for mail addressed to a coordinator, the
    time from the mail's creation to the first turn a delivery nudge started in
    that coordinator's session at or after it. Idle-gated delivery is the point:
    the wait includes the coordinator's own busy turn. A mail with no later
    nudge turn is counted as unmatched, never as zero.

    THE MAIL READ IS A PAGE, NEWEST FIRST: `mail list --to <id> --all 1` answers
    the recipient's newest deliveries (`ORDER BY d.id DESC`), 100 by default and
    MAIL_PAGE at most. A page that came back FULL may have dropped exactly the
    window's oldest mail, so that coordinator is reported `truncated` and counted
    in neither `minutes` nor `unmatched` — never as data. A page with room to
    spare is the recipient's whole history.

    THE RUNS READ IS CAPPED TOO: `runs list --closed 1` answers every ACTIVE run
    and only the newest CLOSED_RUNS_CAP closed ones, so a closed count at the cap
    is `runsTruncated` — coordinators of older runs may be missing, and the
    coordinator count is not the whole history.

    EVERY INPUT LEFT OUT IS COUNTED BY NAME, never dropped silently: a run with no
    claimant is `runsWithoutClaimant`, and a window mail whose delivery is neither
    `delivered` nor `acked` (queued, rejected, or a state this file does not know)
    is `undelivered` — in neither `minutes` nor `unmatched`, which count only mail
    a coordinator was handed (a mail outside the window is not an input of it)."""
    lo = datetime.fromisoformat(win[0]).replace(tzinfo=timezone.utc).timestamp() * 1000
    hi = (datetime.fromisoformat(win[1]).replace(tzinfo=timezone.utc) + timedelta(days=1)).timestamp() * 1000
    # CLOSED read first, OPEN read second: a run that closes between the two reads is
    # then in the closed read and absent from the open one, so it counts as closed —
    # any skew OVERcounts toward `runsTruncated` (conservative). The other order would
    # drop it from the closed count and could read 500 - k as under the cap.
    closed_read, open_rows = [_api('runs', 'list', *flag)['runs'] for flag in (['--closed', '1'], [])]
    open_ids = {r.get('id') for r in open_rows}
    closed_rows = [r for r in closed_read if r.get('id') not in open_ids]   # the closed read also carries every active run
    runs_truncated = len(closed_rows) >= CLOSED_RUNS_CAP
    all_runs = open_rows + closed_rows
    coords = sorted({r['claimedBy'] for r in all_runs if r.get('claimedBy')})
    no_claimant = sum(1 for r in all_runs if not r.get('claimedBy'))
    lat, unmatched, truncated, undelivered, per = [], 0, 0, 0, {}
    for c in coords:
        rows = _api('mail', 'list', '--to', c, '--all', '1', '--limit', str(MAIL_PAGE)).get('mail', [])
        if len(rows) >= MAIL_PAGE:
            truncated += 1; per[c] = {'truncated': True, 'rows': len(rows)}
            continue
        turns = nudge_turns(c)
        mine, miss, undel = [], 0, 0
        for m in rows:
            if not (lo <= m['at'] < hi):
                continue
            if m['state'] not in ('delivered', 'acked'):
                undel += 1
                continue
            t = next((x for x in turns if x >= m['at']), None)
            if t is None:
                miss += 1
            else:
                mine.append((t - m['at']) / 60000)
        lat += mine; unmatched += miss; undelivered += undel
        per[c] = dict(summary([round(x, 1) for x in mine]), unmatched=miss, undelivered=undel, transcriptTurns=len(turns))
    return {'window': win, 'coordinators': len(coords), 'minutes': summary([round(x, 1) for x in lat]),
            'unmatched': unmatched, 'undelivered': undelivered, 'truncatedCoordinators': truncated,
            'closedRuns': len(closed_rows), 'runsTruncated': runs_truncated,
            'runsWithoutClaimant': no_claimant, 'perCoordinator': per}


# ── the command line ────────────────────────────────────────────────────────
def main(argv):
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__); return 0
    sub, rest = argv[0], argv[1:]
    args, pos, i = {}, [], 0
    while i < len(rest):
        if rest[i].startswith('--'):
            k = rest[i][2:]
            if k == 'project':
                args.setdefault('project', []).append(rest[i + 1])
            else:
                args[k] = rest[i + 1]
            i += 2
        else:
            pos.append(rest[i]); i += 1
    win = (args.get('since', BASELINE[0]), args.get('until', BASELINE[1]))
    out = args.get('out', 'landing-measure')
    os.makedirs(out, exist_ok=True)
    cache = Cache(out)
    need_repo = sub not in ('episodes', 'mail-latency')
    if need_repo and (len(pos) != 1 or not re.match(r'^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$', pos[0])):
        print(f'usage: measure-landing.py {sub} OWNER/REPO …', file=sys.stderr); return 2
    repo = pos[0] if need_repo else None
    req = lambda: args['required'].split(',') if 'required' in args else required_contexts(repo, cache)
    if sub == 'required':
        rep = {'repo': repo, 'required': required_contexts(repo, cache)}
    elif sub == 'main-red':
        rep = cmd_main_red(repo, req(), win, cache)
    elif sub == 'absorptions':
        rep = cmd_absorptions(repo, win, cache, fleet_logins(args))
    elif sub == 'remerge':
        if 'clone' not in args:
            print('usage: measure-landing.py remerge OWNER/REPO --clone DIR', file=sys.stderr); return 2
        rep = cmd_remerge(repo, win, cache, args['clone'])
    elif sub == 'green-to-merge':
        rep = cmd_green_to_merge(repo, req(), win, cache)
    elif sub == 'inversions':
        logins = fleet_logins(args)   # BEFORE req(): the refusal precedes every GET and every cache write
        rep = cmd_inversions(repo, req(), win, cache, logins)
    elif sub == 'episodes':
        rep = cmd_episodes(args.get('project', []), win)
    elif sub == 'mail-latency':
        rep = cmd_mail_latency(win)
    else:
        print(f'measure-landing.py: unknown subcommand {sub!r}', file=sys.stderr); return 2
    name = f"{sub}{'-' + repo.replace('/', '_') if repo else ''}-{win[0]}-{win[1]}.json"
    json.dump(rep, open(os.path.join(out, name), 'w'), indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k not in ('pairs', 'perCoordinator')}, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
