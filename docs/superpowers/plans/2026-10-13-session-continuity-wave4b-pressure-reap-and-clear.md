# Session continuity wave 4b: pressure-reap environment and outgoing operator choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close wave 4's carried residue in the first implementation commit, disable Claude Code's background-shell pressure reap in both spawn commands, preserve the operator's model and effort across a live UUID rotation, and measure the variable against the frozen baseline B.

**Architecture:** Keep command composition at `_spawn_start`, not in platform-specific placement or generated wrappers. Extract the existing operator-choice promotion body from the dead-session marker writer, so `_sync_uuid` can read the outgoing transcript before changing the registry UUID without claiming that the live session is dead. The sweep, doctor and read-only instrument keep measured, carried, stale and unreadable states distinct; no stop authority is widened.

**Tech Stack:** Bash, Python 3, TypeScript, Vitest; existing fixture process and cgroup roots, stubbed systemctl/tmux, and `makeCcdHarness`.

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md`, sections 5.6, 5.7, 6, 8 and 9. Programme: `docs/superpowers/programs/session-continuity.md`. Predecessor: `docs/superpowers/plans/2026-10-05-session-continuity-wave4-scope-sweep.md`. Public issue: #197.

## In short

Run 308 is the existing planned work run: programme wave 4b, run wave 5. Baseline B was measured independently with the reap still enabled over `2026-10-06 23:16:00 UTC` inclusive through `2026-10-13 23:17:00 UTC` exclusive: **0 reap-class OOM stops among 34 pane-scope OOM stops**, with 5 unmapped and 4 unmeasured. The scope record was shadowed, with 9 dead scopes and 2 inert scopes; both inert scopes were at least one day old. This unblocks planning, not arming the scope sweep or restarting the fleet by hand.

The original source map was checked against `main` at `f515cdfd4b748dcd474dd33c79fc662fe78c0da3`. The pre-dispatch revision is anchored at `c7776b08037dadaeee832e906f99e4221afdf8d2`: the intervening continuation work materially expanded `_sync_uuid`, so Task 3 now integrates with its existing pane-admission guards and retains both follow paths. The other changed target files keep their seam contracts, with content anchors remeasured. This is not a replay-verified prototype: new test blocks and mutations still require red-first execution by the worker. Later main changes are measured before dispatch and on a required landing merge; source integration is not permission to rebase dispatched work.

## Global Constraints

- **First commit:** all ruled wave-4 residue, including review 305 F1(a), the qualified doctor PASS, the carried-line distinction, instrument freshness, zombie child, paused log, non-zero baseline case, unchecked record write, future tick and timed-harness race. Already-landed text fixes are verified, not undone or reimplemented.
- **Child-scoped environment:** `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` belongs in each composed child `exec env` command, beside the resume variables. No global export, wrapper configuration file or platform-specific duplicate.
- **Execution kind, not provider:** an external-provider shim that execs Claude Code reads Claude Code's environment. A genuinely native executable with no Claude Code transcript is not applicable and receives no variable it does not read. Do not use `_is_anthropic_backend` as the pressure-variable gate.
- **Operator choice:** use the existing transcript parser, journal floor, typed-command filter, route-field mtime precedence, class vocabulary and one `cmd_route` operation for the combined pair. A live UUID rotation must neither create nor remove `choicekept`; the marker remains the dead-session keep's responsibility.
- **Always return 0:** unreadable, malformed, unavailable or unrecognised outgoing choice never prevents UUID synchronisation or aborts a stop. Log the existing measured refusal words; do not turn uncertainty into an operator choice.
- **Scope authority unchanged:** six hours inert, no sockets, no children elsewhere, no live handoff, no live pane, no foreign server; at most three stops per armed tick. Nothing writes `scope-sweep-live`. This programme remains SHADOWED until the operator arms it.
- **Fixture isolation:** never run ccd, the sweep or a scope stop against the live HOME or manager. Use `makeCcdHarness`, poisoned gh containment, fixture HOME/runtime/proc/cgroup roots and stubbed managers. Never touch live tmux, registry, limit files or supervised units.
- **One suite process at a time:** from `server/`, use `./node_modules/.bin/vitest run test/<file>.test.ts --maxWorkers=1`, foreground, tool timeout at least 600000 ms. Never bare `npx vitest`. Do not start a second suite while a timed-out first process still runs.
- **Generated file:** after every `ccd/ccd` edit, regenerate its marker using `shared/mark.mjs`, independently verify it, preserve executable mode, and run ownership/restamp guards. Never copy a digest or strip unrelated header lines.
- **Citation and census:** pay S6-R11 on the actual changed tree, preserve the frozen corpus, and derive the `_reg_get` census from source. Do not copy the predecessor's historical counts or lower a guard to make a number green.
- **No unrelated edits:** retain issue #317's carry amendment, tick-diet changes and other programmes' regions. Read current claims; obtain scoped co-edit consent when a shared file is held. A claim refusal is not permission to break the claim.
- **Branch discipline:** commit on the dispatched workspace branch, never a separate feature branch. One commit per task; Task 1 alone carries the full residue. End commit messages with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- **Numbers:** 4316 through 4325 were issued at run-open. Define only justified departures under those numbers in this plan, in the commit that implements each; never allocate again or invent a number. Unused numbers stay bare in prose.
- **Public text:** no private hosts, paths, projects, accounts, people, Linear links or private ticket identifiers. Durable review links use GitHub, not the chat preview server.
- **Delivery stops at PR and wave-done:** no hand rollout, update, deploy or marker creation. The supported updater moves the fleet after acceptance; the coordinator records its observed deployment and owns the subsequent measurements.

## Review Focus

1. A carried old verdict must not look like a fresh inert measurement or reach a stop; malformed lines require rewrite advice, not advice to kill a unit. Task 1 exercises both representations and mixed records.
2. A future, stale or unreadable verdict record must not count as zero dead scopes; a failed record write must leave the previous complete record intact. Task 1 pins these distinctions.
3. A retry command, plain-tmux placement or external-provider Claude Code shim must not miss the pressure variable; remote-control, UUID and permission argv order stay intact. Task 2 checks complete primary/retry commands and wrapper inheritance.
4. Two live UUID rotations followed by a restart must keep the newest operator choice, filter ccd's own commands and still perform one route write for a pair. Task 3 exercises this chain and proves `choicekept` is not written by rotation.
5. A non-zero baseline and a post-deploy class count at exactly B + 2 must not trigger removal; B + 3 must. Unknown classifications remain visible, and existing panes are not treated as newly opted out merely because deployment completed. Task 1 pins the numerical boundary in the FIRST commit; Task 4 documents the exposure and measurement procedure, and Task 5 owns its live follow-through.

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `ccd/ccd-scope-sweep` | Carried measurement representation, zombie handling, paused log and complete-record replacement | 1 |
| `ccd/ccrc-doctor-checks` | Verdict reader and state-specific remedies; no action | 1 |
| `deploy/measure-continuity.py` | Record freshness and stage-6 pressure/kill-rule measurement | 1, 4 |
| `server/test/scope-sweep.test.ts` | Fixture-contained sweep and new mutation cases | 1 |
| `server/test/ccrc-doctor.test.ts` | Scope-reader state and remedy cases only | 1 |
| `server/test/measure-continuity-stage6.test.ts` | Freshness, non-zero count and comparison boundaries, all in the FIRST commit | 1 |
| `server/test/measure-continuity-pressure-kills.test.ts` | Direct pressure-kill notifications, window, copy deduplication and incomplete-read distinctions | 4 |
| `server/test/ccdWsHelpers.ts` | Timed child process-group containment | 1 |
| `server/test/ccd-limit-banner.test.ts` | Existing timed-harness regression gate | 1 |
| `server/test/ccd-auto-compact.test.ts` | Existing timed-harness regression gate | 1 |
| `ccd/ccd` | Child spawn environment and marker-free outgoing promotion before UUID update | 2, 3 |
| `server/test/ccd-resume-flag.test.ts` | Independent composer and primary/retry presence pins | 2 |
| `server/test/ccd-spawn-split.test.ts` | Byte-exact primary/retry commands and plain-tmux fallback | 2 |
| `server/test/ccrc-codex-launcher.test.ts` | Generated wrapper to upstream Claude Code environment inheritance | 2 |
| `server/test/wrapper-generate.test.ts` | Existing generated-wrapper inheritance and exec gate | 2 |
| `server/test/ccd-route-spawn.test.ts` | Resume/route/subagent environment composition | 2 |
| `server/test/ccd-route-degrade.test.ts` | Degraded-route command compatibility | 2 |
| `server/test/ccd-lifecycle-purge.test.ts` | Existing spawn spelling guard | 2 |
| `server/test/ccd-operator-choice.test.ts` | Live rotation, marker lifecycle, admitted/refused pane controls and shared promotion behavior | 3 |
| `server/test/ccd-sync-uuid.test.ts` | Existing real pane-admission, background-worker and continuation-follow regression gate | 3 |
| `server/test/continued-in-parity.test.ts` | Existing three-reader continuation-marker parity gate | 3 |
| `server/test/continued-in-successor-parity.test.ts` | Existing continuation-successor parity gate | 3 |
| `server/test/session-hook.test.ts` | S6-R11 census only if measured movement requires it | 1-3 |
| `README.md` | Shipped behavior and named costs in the existing continuity section | 4 |
| `docs/superpowers/specs/2026-09-23-session-continuity-design.md` | As-built annotations for the deferred clear fix and carried record representation | 4 |
| `docs/superpowers/programs/session-continuity.md` | Acceptance, observed deployment and post-deploy measurements, written by the coordinator | 5 |

No new package, dependency, protocol version, ccd verb, PWA feature or coordination table is introduced.

## Execution Order

Worker main loop is Opus/high. Fresh Sonnet/high implementers and Opus/high per-task reviewers run the dependent chain sequentially, workflow off, compact 40. The final acceptance review is a separate run, with three fresh Opus/high lenses and three fresh Sonnet/high refuters per finding; a finding survives unless at least two refuters kill it. An empty/dead lens is unverified, and a finding with all refuters dead is unexamined, never clean.

Tasks 1-4 are the worker's dispatch items. Task 5 is coordinator-owned follow-through after acceptance, not a fifth item that the worker can complete before handing off.

## Verification Used By Every Task

These are execution gates, not claims that this planning branch ran a product prototype. Record the real red/green output and each mutation's owning case in the wave-done evidence. A changed case count with all cases passing is not a failure; a red case is never described as green because another run passed.

### Generated bytes, mode and registry census

From the workspace root, after each edit of `ccd/ccd`:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
node shared/mark.mjs --check ccd/ccd
bash -n ccd/ccd
```

Measure executable mode before editing and compare it after stamping; do not replace it with a guessed mode. `writeFileSync` on the existing file preserves its mode. The independent check must report `ccrc-unmodified` and exit 0.

Measure the census from the working source with this exact filter, the one `ccd-reg-get-census.test.ts` uses:

```python
import re
from pathlib import Path
src = Path('ccd/ccd').read_text().split('\n')
code = [line for line in src if not re.match(r'^\s*#', line)]
print('calls', sum(line.count('_reg_get "') for line in code))
print('lines', sum('_reg_get "' in line for line in code))
```

If it moves, update the existing `_reg_get` header sentence in place, name the actual mover in its last-move comment, then stamp again. Never add a second cardinal restatement. Run from `server/`:

```bash
./node_modules/.bin/vitest run test/ownership.test.ts test/ccd-reg-get-census.test.ts test/ccd-die-containment.test.ts --maxWorkers=1
```

### Citation tax: repair README, measure the frozen debt

The approved predecessor already carries the executable instruments in `docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md`, section `The citation tax, mechanised (S6-R11)`. Extract its two Python fences by their unique docstring headers into a private scratch directory. This extraction is not a product edit:

```python
import re
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
out = Path(sys.argv[2])
assert out.is_absolute() and out.is_dir()
blocks = re.findall(r'```python\n(#!/usr/bin/env python3\n.*?)```', text, re.S)
heads = {
    'repoint-readme.py': '"""Re-point README.md',
    'cite-remeasure.py': '"""Re-measure session-hook.test.ts',
}
for name, head in heads.items():
    matches = [block for block in blocks if block.split('\n')[1].startswith(head)]
    assert len(matches) == 1, (name, len(matches))
    (out / name).write_text(matches[0])
    print(name, len(matches[0].splitlines()), 'lines')
```

Invoke the extracted re-measurer from the workspace root, with an absolute scratch directory and the measured task-parent commit as its base argument. Run it foreground under a tool timeout of at least 600000 ms. Add `--maxWorkers=1` to its local Vitest subprocess argv before use, and retain its byte-for-byte restoration assertions. Its historical README re-pointer refuses unless README still has exactly the two anchor sentences it understands; if current README has a different shape, repair the actual anchors by their quoted content instead of weakening that refusal. No missing script under coordinator evidence is a substitute for these committed instruments.

First measure the unedited task parent. Then measure the edited tree. For each of the by-file, row and site sets, keep both counts AND the entered/left composition. If a frozen-corpus census literal changes, only the instrument's result may change it; annotate the actual movement under S6-R11 in `server/test/session-hook.test.ts`. Equal totals alone prove nothing. An unrelated census key or a base already inconsistent with its stated literals is a stop/report, not license to rewrite the whole census. Repair live README anchors by content; never move the two frozen documents' citations to make the debt disappear.

Run from `server/`:

```bash
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS FACTS|whole corpus' --maxWorkers=1
```

From the workspace root, prove the two frozen documents unchanged from the measured base:

```bash
git diff --exit-code origin/main -- docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md
```

Run this procedure after Tasks 1-3 whenever a cited source/test file changes, and again on the final committed tree. The instrument is scratch-only and restores its temporary probes; no dump probe, archived source or scratch path enters the PR.

### Task 1: Close every carried wave-4 residue in the first commit

This task is deliberately one acceptance unit: the sweep's new record cannot ship without both readers, the readers cannot claim a current measurement without freshness, and the pressure comparison must exercise a non-zero baseline before Task 2 changes spawning. The timeout harness is Perl, not a new asynchronous Node API. No source edit in Tasks 2-3 precedes this commit.

**Files:**
- Modify: `ccd/ccd-scope-sweep`, `ccd/ccrc-doctor-checks`, `deploy/measure-continuity.py`.
- Modify: `server/test/scope-sweep.test.ts`, `server/test/ccrc-doctor.test.ts`, `server/test/measure-continuity-stage6.test.ts`, `server/test/ccdWsHelpers.ts`, `server/test/ccd-limit-banner.test.ts`.
- Verify: `server/test/ccd-auto-compact.test.ts`; retain its FIFO guard and whole-group timeout regression.
- Modify only for measured citation movement: `README.md`, `server/test/session-hook.test.ts`. Do not repoint the frozen corpus.

**Interfaces:**
- Consumes: the v1 sweep header, measured `dead` rows and `old` process rows; fixture HOME/runtime/proc/cgroup roots and stubbed tmux/systemctl.
- Produces: `carry <unit> state=<dead|live|unknown> first=<number|none> cpu0=<number|none> why=<reason>`. A carry is this tick's inability to measure, never a measured dead verdict. It cannot reach a stop in this tick. Retained bounded clocks become usable only after a later tick re-measures every stop predicate.
- Clock pair: `first=none cpu0=none` means no prior trusted clock. Otherwise first is positive, at most 16 decimal digits without a leading zero; CPU is 0 or at most 20 digits without a leading zero. Half a pair is malformed.
- Supported reason/state pairs: the pre-liveness failures `unit-show`, `description`, `control-group`, `cpu`, `scope-start`, `procs`, `cgroup-dir`, `child-cgroup`, `server-stat`, `server-comm`, `tmux-unknown` are `unknown`; `parent-hop-cap` is `live`; `socket-tables`, `socket-fd`, `box-stat` are `dead`. No reader accepts a contradictory pair.
- `s6_inert()` returns current measured counts plus `carried_scopes: {dead, live, unknown}`, or ONLY `{record: 'absent'|'unreadable'|'stale'|'future'}`. None of these four is a current zero.
- New optional instrument argument `--reap-baseline <count>` supplies an already-frozen baseline, not a file or live baseline re-read. It requires stage 6 alone and an explicit seven-day `--since`/`--until` window. It adds a read-only `pressure_reap_comparison` section: baseline, exclusive withdrawal threshold B + 2, observed class and `decision: 'withdraw'|'not-triggered'|'unmeasured'`. `not-triggered` is not a health verdict: raw unknown counts stay beside it. It never changes spawning or removes a key.
- `BOUNDED` retains its synchronous shell-prefix API `<seconds> <argv...>`, timeout exit 142 and whole-child-group kill. Parent and child establish the same child-owned process group before the parent arms its alarm.

- [x] **Step 1: Add sweep failure pins and migrate the carried-row assertions.**

In `scope-sweep.test.ts`, extend the existing `proc` options with `state?: string`, replace the hard-coded `S` in its stat line, and widen `rows` to `carry`. These are fixture helpers, not product readers:

```ts
// In proc(), after `const ticks = ...`:
const state = o.state ?? 'S';
if (!/^[A-Z]$/.test(state)) throw new Error(`invalid fixture process state ${state}`);
fs.writeFileSync(path.join(d, 'stat'), `${pid} (${comm}) ${state} ${o.ppid ?? 1} ${pid} ${pid} 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 ${ticks} 1000 10 0\n`);

const rows = (kind: 'dead' | 'old' | 'carry'): Record<string, Record<string, string>> => {
  const out: Record<string, Record<string, string>> = {};
  if (!fs.existsSync(STATE())) return out;
  for (const l of fs.readFileSync(STATE(), 'utf8').split('\n')) {
    const p = l.split(' ');
    if (p[0] !== kind) continue;
    out[kind === 'old' ? `${p[1]} ${p[2]}` : p[1]!] = Object.fromEntries(p.slice(2).map((kv) => kv.split('=') as [string, string]));
  }
  return out;
};
```

Replace the existing local `carried` helper in its unmeasurable describe with:

```ts
const carried = (u: string, why: string, state: 'dead' | 'live' | 'unknown', o: { companion?: string } = {}): void => {
  arm();
  const r = run();
  expect(r.code, r.err).toBe(0);
  const text = fs.readFileSync(STATE(), 'utf8');
  expect(text.split('\n')[0]).toMatch(new RegExp(`^# ccd-scope-sweep v1 tick=\\d+ up=${UP} mode=live$`));
  expect(rows('dead')[u]).toBeUndefined();
  expect(rows('carry')[u]).toEqual({ state, first: String(UP - 7 * HOUR), cpu0: '7255660000', why });
  expect(stops()).toEqual([]);
  if (o.companion) expect(rows('dead')[o.companion]).toMatchObject({ verdict: 'report', why: 'dead-under-6h', first: String(UP) });
};
```

Keep every existing setup and companion assertion. Replace each old `carried(seenLines[0]!, ...)` call with `carried(unitName(1), '<reason>', '<state>', ...)`, using this exhaustive mapping; the optional companion object remains unchanged:

| Existing case condition | Reason | State |
|---|---|---|
| Description does not parse; Description has leading-zero server pid | description | unknown |
| show fails or no Slice | unit-show | unknown |
| empty ControlGroup; ControlGroup names another unit | control-group | unknown |
| CPUUsageNSec absent | cpu | unknown |
| monotonic start 0 | scope-start | unknown |
| unreadable or empty cgroup.procs | procs | unknown |
| unreadable cgroup directory | cgroup-dir | unknown |
| child cgroup; dotfile child cgroup | child-cgroup | unknown |
| server stat unreadable | server-stat | unknown |
| server comm unreadable | server-comm | unknown |
| tmux absent with server still running | tmux-unknown | unknown |
| live parent chain loop | parent-hop-cap | live |
| net/tcp or net/unix unreadable | socket-tables | dead |
| fd directory unreadable; another net namespace; missing proc for a listed pid; unreadable fd link | socket-fd | dead |
| stat unreadable for a scope process or another box process | box-stat | dead |

Rename the no-procs-file case's claim that a first-ever scope records nothing. Add its exact new assertion for the existing `w`:

```ts
expect(rows('carry')[w]).toEqual({ state: 'unknown', first: 'none', cpu0: 'none', why: 'procs' });
```

In the existing paused case replace the stdout `/paused/` assertion with `expect(r.out).toBe('')` and `expect(r.err).toBe('')`; retain rc, no manager call and byte-exact prior-record assertions. In the existing live-loop case retain its actual 3001/3002/3003 cyclic-parent setup and the empty `old` assertion; the migrated helper additionally proves its row is a `live` carry rather than the previous `dead` line.

Append this new describe at file scope, using only existing global fixture helpers:

```ts
describe('wave 4b residue: carries, zombies and complete record writes', () => {
  it('a retained carry clock is read back only after all predicates are measurable', () => {
    const u = inert(1);
    const child = path.join(fx.cg, cgOf(u), 'nested');
    fs.mkdirSync(child);
    arm();
    expect(run().code).toBe(0);
    expect(rows('carry')[u]).toEqual({ state: 'unknown', first: String(UP - 7 * HOUR), cpu0: '7255660000', why: 'child-cgroup' });
    expect(stops()).toEqual([]);
    fs.rmdirSync(child);
    expect(run().code).toBe(0);
    expect(rows('dead')[u]).toMatchObject({ first: String(UP - 7 * HOUR), cpu0: '7255660000', verdict: 'stopped' });
    expect(stops()).toEqual([`--user stop --no-block ${u}`]);
  });

  it('a first-ever unmeasurable scope has no invented clock', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] });
    fs.mkdirSync(path.join(fx.cg, cgOf(u), 'nested'));
    expect(run().code).toBe(0);
    expect(rows('carry')[u]).toEqual({ state: 'unknown', first: 'none', cpu0: 'none', why: 'child-cgroup' });
    expect(rows('dead')[u]).toBeUndefined();
    expect(stops()).toEqual([]);
  });

  it.each(['none cpu0=7', '08 cpu0=7', '99999999999999999 cpu0=7', '123 cpu0=none'])('a malformed carry clock %s is not trusted', (clock) => {
    const u = inert(1);
    fs.writeFileSync(STATE(), `# ccd-scope-sweep v1 tick=1 up=1 mode=shadow\ncarry ${u} state=unknown first=${clock} why=child-cgroup\n`);
    arm();
    expect(run().code).toBe(0);
    expect(rows('dead')[u]).toMatchObject({ first: String(UP), verdict: 'report', why: 'dead-under-6h' });
    expect(stops()).toEqual([]);
  });

  it.each(['Z', 'S'])('an outside child in state %s has the corresponding live-child verdict', (state) => {
    const u = inert(1);
    proc(3500, { age: 2 * 86400, ppid: 3001, state, cg: '/elsewhere.scope' });
    arm();
    expect(run().code).toBe(0);
    expect(rows('dead')[u]).toMatchObject(state === 'Z'
      ? { verdict: 'stopped', why: 'none' }
      : { verdict: 'report', why: 'parent-of-a-process-elsewhere' });
    expect(stops()).toEqual(state === 'Z' ? [`--user stop --no-block ${u}`] : []);
  });

  it('a valid empty replacement succeeds and removes an obsolete prior row', () => {
    fs.writeFileSync(STATE(), '# old complete record\n');
    const r = run();
    expect(r).toMatchObject({ code: 0, out: '', err: '' });
    expect(fs.readFileSync(STATE(), 'utf8')).toMatch(new RegExp(`^# ccd-scope-sweep v1 tick=\\d+ up=${UP} mode=shadow\\n$`));
  });

  it.each(['open', 'header', 'body', 'rename'])('a failed %s preserves the complete prior record and removes its own temporary', (where) => {
    inert(1);
    const before = fs.readFileSync(STATE(), 'utf8');
    const env: Record<string, string> = {};
    if (where === 'open') {
      // mktemp answers a file below a nonexistent fixture parent: open fails
      // even as root, creates no temporary, and never needs recursive cleanup.
      const tmp = path.join(`${STATE()}.open-failure`, 'record');
      fs.writeFileSync(path.join(fx.bin, 'mktemp'), `#!/usr/bin/env bash\nprintf '%s\\n' ${JSON.stringify(tmp)}\n`, { mode: 0o755 });
    } else if (where === 'rename') {
      fs.writeFileSync(path.join(fx.bin, 'mv'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
    } else {
      const file = path.join(fx.base, 'fail-write.bash');
      const pattern = where === 'header' ? "'# ccd-scope-sweep'*" : "'%s\\n'";
      fs.writeFileSync(file, `printf() { case "$1" in ${pattern}) return 1 ;; esac; builtin printf "$@"; }\n`);
      env.BASH_ENV = file;
    }
    const r = run(env);
    expect(r.code).toBe(1);
    expect(r.err).toContain('previous record retained');
    expect(fs.readFileSync(STATE(), 'utf8')).toBe(before);
    expect(fs.readdirSync(fx.xdg).filter((f) => f.startsWith('ccd-scope-sweep.state.'))).toEqual([]);
    expect(stops()).toEqual([]);
  });
});
```

- [x] **Step 2: Add doctor state/remedy tests using the real suite's HOME seam.**

Inside `describeLinux('ccrc doctor: scope-sweep', ...)`, use `healthy`, `record(home, lines, ago)`, `runDoctor(home).stdout`, `lineFor`, `DEAD`, `LIVE` and `DEADLINE`. Do not introduce a process-global environment seam or call `runDoctor('scope-sweep')`.

```ts
it.each([false, true])('an unreadable body uses only rewrite advice, with measured dead row present=%s', (mixed) => {
  const home = healthy('ccrc-doctor-scope-unreadable-body-');
  record(home, [...(mixed ? [DEADLINE()] : []), 'not a sweep row']);
  const out = runDoctor(home).stdout;
  expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: .*1 line\(s\) it cannot read/);
  expect(out).toContain('let the sweep rewrite it: systemctl --user start ccd-scope-sweep.service; then re-run doctor');
  expect(out).not.toContain('read each before acting');
  expect(out).not.toContain('systemctl --user stop <unit>');
  noFail(out);
});

it('a measured-live carry qualifies PASS instead of claiming every live process was read', () => {
  const home = healthy('ccrc-doctor-scope-live-carry-');
  record(home, [`carry ${LIVE} state=live first=123 cpu0=7 why=parent-hop-cap`]);
  const out = runDoctor(home).stdout;
  expect(lineFor(out, 'scope-sweep')).toMatch(/^PASS scope-sweep: /);
  expect(lineFor(out, 'scope-sweep')).toContain('excluding 1 live pane scope(s) carried unmeasured');
  expect(out).not.toContain('read each before acting');
});

it.each(['dead', 'unknown'])('a %s carry warns with measurement advice, never stop advice', (state) => {
  const home = healthy('ccrc-doctor-scope-unmeasured-carry-');
  const why = state === 'dead' ? 'socket-tables' : 'child-cgroup';
  record(home, [`carry ${DEAD} state=${state} first=none cpu0=none why=${why}`]);
  const out = runDoctor(home).stdout;
  expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: .*carried unmeasured/);
  expect(out).toContain('let the sweep rewrite the measurement');
  expect(out).not.toContain('read each before acting');
  expect(out).not.toContain('systemctl --user stop <unit>');
});

it.each([
  `carry ${DEAD} state=unknown first=none cpu0=7 why=child-cgroup`,
  `carry ${LIVE} state=live first=123 cpu0=7 why=child-cgroup`,
  `carry ${DEAD} state=unknown first=08 cpu0=7 why=child-cgroup`,
  `carry ${DEAD} state=dead first=123 cpu0=7 why=not-supported`,
  DEADLINE().replace('cpu0=7', 'cpu0=08'),
])('a malformed or contradictory carry/dead row gets rewrite advice: %s', (row) => {
  const home = healthy('ccrc-doctor-scope-bad-carry-');
  record(home, [row]);
  const out = runDoctor(home).stdout;
  expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: .*1 line\(s\) it cannot read/);
  expect(out).not.toContain('read each before acting');
  noFail(out);
});

it('a future record is neither fresh PASS nor destructive advice', () => {
  const home = healthy('ccrc-doctor-scope-future-');
  record(home, [], -3600);
  const out = runDoctor(home).stdout;
  expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: .*future/);
  expect(out).toContain('let the sweep rewrite it');
  expect(out).not.toContain('read each before acting');
  noFail(out);
});

it('mixed measured and carried rows keep measured advice explicitly scoped', () => {
  const home = healthy('ccrc-doctor-scope-mixed-carry-');
  record(home, [DEADLINE(), `carry ${LIVE} state=live first=none cpu0=none why=parent-hop-cap`]);
  const out = runDoctor(home).stdout;
  expect(lineFor(out, 'scope-sweep')).toContain('1 dead pane scope(s)');
  expect(lineFor(out, 'scope-sweep')).toContain('carried unmeasured');
  expect(out).toContain('stop advice applies only to the measured dead rows, never to a carry');
});
```

Keep existing bounded-number, stale-knob, oldest=-1, Darwin/server/paused/absent and timer cases. The malformed-body wording retains `N line(s) it cannot read`, so those existing pins need no relaxation.

- [x] **Step 3: Add instrument freshness and non-zero comparison pins in the first commit.**

In the stage-6 metric describe, replace the old `tick=1` helper with a current timestamp and optional explicit tick:

```ts
const tickNow = (): number => Math.floor(Date.now() / 1000);
const record = (lines: string[], tick = tickNow()): void => {
  const xdg = path.join(h.home, 'xdg'); fs.mkdirSync(xdg, { recursive: true });
  fs.writeFileSync(path.join(xdg, 'ccd-scope-sweep.state'), [`# ccd-scope-sweep v1 tick=${tick} up=${UP} mode=shadow`, ...lines].join('\n') + '\n');
};
const carry = (n: number, state: 'dead' | 'live' | 'unknown', first = 'none', cpu0 = 'none'): string => {
  const why = state === 'live' ? 'parent-hop-cap' : state === 'dead' ? 'socket-tables' : 'child-cgroup';
  return `carry ${unit(n)} state=${state} first=${first} cpu0=${cpu0} why=${why}`;
};

it('carries remain visible but do not inflate dead or inert counts', () => {
  record([dead(1, 2 * 86400, 'would-stop'), carry(2, 'live'), carry(3, 'unknown', String(UP - 7 * 3600), '7'), carry(4, 'dead')]);
  expect(stage().inert_scopes).toEqual({ mode: 'shadow', dead: 1, inert: 1, inert_dead_a_day_or_more: 1,
    carried_scopes: { dead: 1, live: 1, unknown: 1 } });
});
it.each(['stale', 'future'] as const)('a %s record publishes no current counts', (state) => {
  record([dead(1, 2 * 86400, 'would-stop')], tickNow() + (state === 'future' ? 3600 : -600));
  expect(stage().inert_scopes).toEqual({ record: state });
});
it.each([
  'garbage',
  carry(2, 'unknown', 'none', '7'),
  carry(2, 'live').replace('parent-hop-cap', 'child-cgroup'),
  dead(1, 2 * 86400, 'would-stop') + ' trailing',
  dead(1, 2 * 86400, 'would-stop').replace('cpu0=7', 'cpu0=08'),
])('a nonempty bad body never becomes partial current counts: %s', (bad) => {
  record([dead(1, 2 * 86400, 'would-stop'), bad]);
  expect(stage().inert_scopes).toEqual({ record: 'unreadable' });
});
it.each(['08', '99999999999999999999'])('an invalid header tick %s is unreadable', (tick) => {
  record([]);
  const file = path.join(h.home, 'xdg', 'ccd-scope-sweep.state');
  fs.writeFileSync(file, `# ccd-scope-sweep v1 tick=${tick} up=${UP} mode=shadow\n`);
  expect(stage().inert_scopes).toEqual({ record: 'unreadable' });
});
```

Widen the existing all-counts expectation with `carried_scopes: {dead: 0, live: 0, unknown: 0}`. Define `type Stage6 = { reap_class_oom: Row; inert_scopes: Row; pressure_reap_comparison?: Row }` beside `Row`; use `Stage6` for BOTH the `stage` helper's return type and its `JSON.parse` cast, `(JSON.parse(out) as { stage6: Stage6 }).stage6`. Add the following file-scope describe; the existing `journal`, `started`, `spawned`, `oom`, `session`, `rows`, `flush` and `stage` helpers are its owners:

```ts
describe('the pressure comparison is B-relative and read-only', () => {
  const windowArgs = ['--since', '2026-10-06 00:00:00', '--until', '2026-10-13 00:00:00'];
  it.each([[0, 2, 'not-triggered'], [0, 3, 'withdraw'], [5, 7, 'not-triggered'], [5, 8, 'withdraw']] as const)(
    'baseline %s with observed %s reports %s', (baseline, count, decision) => {
      fs.mkdirSync(path.join(h.home, '.cc-sessions'), { recursive: true });
      for (let n = 1; n <= count; n++) {
        const sid = `reap-${n}`;
        started(n, T - 7200 - n * 100); spawned(sid, T - 7197 - n * 100); oom(n, T + n);
        session(sid, [rows.bg(T - 6000, `b${n}`), rows.turn(T - 3600)]);
      }
      // Unknowns do not disappear merely because a comparison was requested.
      oom(99, T + 99);
      flush();
      const r = stage([...windowArgs, '--reap-baseline', String(baseline)]);
      expect(r.pressure_reap_comparison).toEqual({ baseline_reap_class: baseline, withdraw_above: baseline + 2,
        observed_reap_class: count, decision });
      expect(r.reap_class_oom.unmapped).toBe(1);
      expect(r.reap_class_oom.pane_scope_oom_stops).toBe(count + 1);
      expect(r.reap_class_oom.reap_class).toBe(count);
      expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'scope-sweep-live'))).toBe(false);
    },
  );
  it('an unreadable journal gives an unmeasured comparison, never a not-triggered zero', () => {
    const r = stage([...windowArgs, '--reap-baseline', '5']);
    expect(r.pressure_reap_comparison).toEqual({ baseline_reap_class: 5, withdraw_above: 7, decision: 'unmeasured' });
    expect(r.reap_class_oom).toEqual({ journal: 'unreadable' });
  });
  it('without a baseline the existing stage-6 output has no comparison', () => {
    expect(stage().pressure_reap_comparison).toBeUndefined();
  });
  it.each([
    ['--reap-baseline', '-1', ...windowArgs],
    ['--reap-baseline', 'abc', ...windowArgs],
    ['--reap-baseline', '08', ...windowArgs],
    ['--reap-baseline', '5'],
    ['--reap-baseline', '5', '--since', '2026-10-06', '--until', '2026-10-07'],
  ])('invalid or incomplete comparison arguments are refused: %s', (...args) => {
    expect(() => stage(args)).toThrow();
  });
});
```

The journal's fresh-record metric is a NOW reading, not a historical-week reconstruction. This distinction is retained in the documentation and evidence.

- [x] **Step 4: Pin the parent/child process-group race with a delayed child.**

Replace the existing whole-group timeout case in `ccd-limit-banner.test.ts` with this two-input version. `PERL5OPT` loads a test module before compilation of the Perl prefix. The module's pipe handshake proves the child reached the delayed branch before the parent returns from fork, and the parent records its own child's PID before the alarm can be armed. The delay is before the child's `setpgid(0, 0)` and longer than the outer bound: without parent-side group creation, the group kill misses and the outer timeout fails the case. The PID pin detects that child before it execs the FIFO command. No production timeout or suite duration is shortened.

```ts
it.each(['normal', 'delayed-child'] as const)('the timed harness kills the whole group with %s fork scheduling', (schedule) => {
  seed();
  const f = path.join(h.home, `leak-${process.pid}.fifo`);
  const pidFile = path.join(h.home, 'race-child.pid');
  execFileSync('mkfifo', [f]);
  const processes = (): { pid: number; args: string }[] =>
    execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).split('\n')
      .flatMap((l) => {
        const m = /^\s*(\d+)\s+(.*)$/.exec(l);
        return m ? [{ pid: Number(m[1]), args: m[2]! }] : [];
      });
  const child = (): number | undefined => {
    if (!fs.existsSync(pidFile)) return undefined;
    const text = fs.readFileSync(pidFile, 'utf8').trim();
    if (!/^[1-9][0-9]*$/.test(text)) throw new Error('invalid fixture child pid');
    return Number(text);
  };
  const owned = (): number[] => processes()
    .filter((p) => p.args.includes(f) && !p.args.startsWith('ps -eo'))
    .map((p) => p.pid);
  fs.writeFileSync(path.join(h.home, 'BoundedRace.pm'), `package BoundedRace;
BEGIN {
  *CORE::GLOBAL::fork = sub {
    pipe(my $r, my $w) or die "fixture pipe: $!";
    my $p = CORE::fork();
    die "fixture fork: $!" unless defined $p;
    if (!$p) {
      close $r;
      print {$w} "ready\\n" or die "fixture ready: $!";
      close $w;
      sleep 30;
      return $p;
    }
    close $w;
    my $ready = <$r>;
    close $r;
    die "fixture handshake" unless defined($ready) && $ready eq "ready\\n";
    open my $fh, '>', $ENV{BOUNDED_RACE_PID} or die "fixture pid: $!";
    print {$fh} "$p\\n" or die "fixture pid write: $!";
    close $fh or die "fixture pid close: $!";
    return $p;
  };
}
1;
`);
  try {
    const r = spawnSync('bash', ['-c', `_leaky() { tail -n 1 -- "$1"; }; ${BOUNDED} 1 bash -c "$(declare -f _leaky); _leaky \\"\\$1\\"" _ ${JSON.stringify(f)} >/dev/null 2>&1; echo "rc=$?"`],
      { encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL',
        env: ghContainedEnv(h.home, { PATH: process.env['PATH'] ?? '', HOME: h.home,
          BOUNDED_RACE_PID: pidFile,
          PERL5OPT: schedule === 'delayed-child' ? `-Mlib=${h.home} -MBoundedRace` : '' }, { systemd: true, tmux: true }) });
    if (schedule === 'delayed-child') {
      expect(child(), 'the delayed branch was actually entered').toBeDefined();
      expect(processes().some((p) => p.pid === child()), 'the recorded pre-exec child was reaped').toBe(false);
    }
    expect(r.error, 'the harness exceeded its outer bound').toBeUndefined();
    expect(r.stdout.trim()).toBe('rc=142');
    expect(owned()).toEqual([]);
  } finally {
    try { fs.closeSync(fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)); } catch { /* no reader */ }
    // Re-measure the unique fixture argv before killing: never act on a recycled PID.
    for (const pid of owned()) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
  }
});
```

The normal case still proves a grandchild blocked on a FIFO is killed; the delayed case independently proves the recorded direct child is reaped before it ever execs. Cleanup only targets processes whose measured argv still contains this test's unique FIFO path; no pattern kill, blocking FIFO writer or invented `boundedShell` API. Save the actual delayed-child red before changing `BOUNDED`.

- [x] **Step 5: Run every new residue owner red before product edits.**

From `server/`, foreground, sequentially, tool timeout at least 600000 ms:

```bash
./node_modules/.bin/vitest run test/scope-sweep.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'scope-sweep' --maxWorkers=1
./node_modules/.bin/vitest run test/measure-continuity-stage6.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-limit-banner.test.ts -t 'timed harness' --maxWorkers=1
```

Expected reds: copied dead rows instead of carries; paused stdout; unchecked write; malformed-body stop advice; future-record PASS; missing strict/fresh/comparison instrument behavior; delayed-child timeout containment. Existing bounded-arithmetic and ordinary group-kill controls may already pass. Record actual results; do not infer one guard's red from another case failing.

- [x] **Step 6: Change sweep representation, without widening stop authority.**

Replace its previous-record declaration/parser with this bounded-clock reader. The capture snapshot precedes every helper `=~`, because those regexes overwrite `BASH_REMATCH`:

```bash
declare -A FIRST=() CPU0=() PREVV=()
CARRY_RE='^carry (tmux-spawn-[^[:space:]]+\.scope) state=(dead|live|unknown) first=(none|[1-9][0-9]{0,15}) cpu0=(none|0|[1-9][0-9]{0,19}) why=(unit-show|description|control-group|cpu|scope-start|procs|cgroup-dir|child-cgroup|server-stat|server-comm|tmux-unknown|parent-hop-cap|socket-tables|socket-fd|box-stat)$'
_ss_prev_clock() {
  local unit="$1" first="$2" cpu0="$3"
  [[ "$first" == none && "$cpu0" == none ]] && return 0
  [[ "$first" =~ ^[1-9][0-9]{0,15}$ && "$cpu0" =~ ^(0|[1-9][0-9]{0,19})$ ]] || return 1
  FIRST["$unit"]="$first"; CPU0["$unit"]="$cpu0"
  return 0
}
_ss_carry_pair() {
  case "$1:$2" in
    unknown:unit-show|unknown:description|unknown:control-group|unknown:cpu|unknown:scope-start|unknown:procs|unknown:cgroup-dir|unknown:child-cgroup|unknown:server-stat|unknown:server-comm|unknown:tmux-unknown|live:parent-hop-cap|dead:socket-tables|dead:socket-fd|dead:box-stat) return 0 ;;
    *) return 1 ;;
  esac
}
if [ -r "$STATE" ]; then
  while IFS= read -r line; do
    if [[ "$line" =~ ^dead\ (tmux-spawn-[^[:space:]]+\.scope)\ first=([1-9][0-9]{0,15})\ cpu0=(0|[1-9][0-9]{0,19})\ verdict=(report|would-stop|held|stopped|stop-failed)\  ]]; then
      saved=("${BASH_REMATCH[@]}")
      _ss_prev_clock "${saved[1]}" "${saved[2]}" "${saved[3]}" || continue
      PREVV["${saved[1]}"]="${saved[4]}"
    elif [[ "$line" =~ $CARRY_RE ]]; then
      saved=("${BASH_REMATCH[@]}")
      _ss_carry_pair "${saved[2]}" "${saved[5]}" || continue
      _ss_prev_clock "${saved[1]}" "${saved[3]}" "${saved[4]}" || continue
      PREVV["${saved[1]}"]=carry
    fi
  done < "$STATE"
fi
```

Replace `_ss_carry` with:

```bash
_ss_carry() {   # reason state; current loop unit, never a measured verdict
  local why="$1" state="$2" first="${FIRST[$u]:-none}" cpu0="${CPU0[$u]:-none}"
  _ss_carry_pair "$state" "$why" || _ss_die "internal invalid carry $why/$state"
  OUT+=("carry $u state=$state first=$first cpu0=$cpu0 why=$why")
  return 0
}
```

At every previous bare `_ss_carry` call, pass the reason/state in Step 1's mapping. Keep each surrounding condition, `continue`, branch order, foreign-server refusal and child-cgroup check. The live capped branch becomes:

```bash
    if (( capped )); then _ss_carry parent-hop-cap live; elif (( ${#olds[@]} )); then OUT+=("${olds[@]}"); fi
```

At the existing first/cpu0 validation, replace the assignment and check with:

```bash
  first=${FIRST[$u]:-} cpu0=${CPU0[$u]:-}; had_clock=1
  if [[ -z "$first" ]] || (( first < born || first > UP )); then first=$UP cpu0=$cpu; had_clock=0; fi
```

Replace ONLY `[[ -z "${PREV[$u]+x}" ]]` in its first-seen announcement with `(( ! had_clock ))`; its message and following PREVV verdict-change branch remain. No code reference to PREV survives; retain its history in prose, not a dead array.

Add `PSTATE=()` to the `TICKS`/`PARENT` declaration, and replace the successful stat assignment with:

```bash
  [[ "${f[0]:-}" =~ ^[A-Z]$ ]] || return 1
  PSTATE[$1]=${f[0]}; PARENT[$1]=${f[1]}; TICKS[$1]=${f[19]}
```

Before the parent-elsewhere predicate inside its box-process loop add:

```bash
    [[ "${PSTATE[$q]:-}" == Z ]] && continue
```

Only zombies stop counting as LIVE outside children; non-zombie outside children still block. Preserve the process census and all socket, age, CPU and handoff predicates.

Replace the pause line in place with `[ -e "$PAUSE" ] && exit 0`. Replace the final unchecked record write with this writer, which catches header failure separately and treats an empty body as success:

```bash
_ss_write_record() {
  printf '# ccd-scope-sweep v1 tick=%s up=%s mode=%s\n' "$NOW" "$UP" "$MODE" || return 1
  if (( ${#OUT[@]} )); then printf '%s\n' "${OUT[@]}" || return 1; fi
  return 0
}
tmp=$(mktemp "$STATE.XXXXXX") || _ss_die "cannot write beside $STATE"
if ! _ss_write_record > "$tmp"; then
  rm -f "$tmp"
  _ss_die "cannot write verdict record; previous record retained"
fi
mv -f "$tmp" "$STATE" || { rm -f "$tmp"; _ss_die "cannot replace verdict record; previous record retained"; }
```

Retain the SAID output and final rc. Complete record replacement is not transactional stop rollback: if an armed manager accepted a stop before a later write failed, that stop already happened. Nothing here arms the manager.

Update the sweep's header in its current paragraph: a carry records reason/liveness and bounded prior clocks, never a fresh dead verdict; first-ever uncertainty gets none/none; known-live hop-cap is qualified; child-cgroup liveness remains unknown because that check stays before liveness. Keep the accepted child-cgroup cost and the two-clock fail-safe explanation.

- [x] **Step 7: Make the doctor validate the whole record before choosing a remedy.**

Within `_check_scope-sweep`, add counters `nc_dead=0 nc_live=0 nc_unknown=0`, arrays `carry_detail=()` and `found=()`, and these regex fragments beside N/M/O:

```bash
  local POS='([1-9][0-9]{0,15})' CPU='(0|[1-9][0-9]{0,19})'
  local F='(none|[1-9][0-9]{0,15})' C='(none|0|[1-9][0-9]{0,19})'
  local CW='(unit-show|description|control-group|cpu|scope-start|procs|cgroup-dir|child-cgroup|server-stat|server-comm|tmux-unknown|parent-hop-cap|socket-tables|socket-fd|box-stat)'
```

After its existing bounded header parse and stale-knob validation, BEFORE the stale check add:

```bash
  if (( age < 0 )); then
    _dr_warn scope-sweep "the verdict record is dated in the future, so it is not a current measurement" \
      "check the box clock; let the sweep rewrite it: systemctl --user start ccd-scope-sweep.service; then re-run doctor"
    return 2
  fi
```

Replace the body's dead/old parser arms with the following, preserving every field in ordinary measured detail. Capture numbers are intentionally listed in the code rather than guessed after the CPU group addition:

```bash
    if [[ "$line" =~ ^dead\ (tmux-spawn-[^[:space:]]+\.scope)\ first=${POS}\ cpu0=${CPU}\ verdict=(report|would-stop|held|stopped|stop-failed)\ why=([a-z-]+(,[a-z-]+)*)\ server=(gone|ccd|reused)\ procs=${POS}\ mem=${M}\ sockets=${N}\ youngest=${O}\ oldest=${O}\ age=${N}\ pids=([1-9][0-9]*(,[1-9][0-9]*)*)$ ]]; then
      local -a m=("${BASH_REMATCH[@]}")
      # 1 unit, 2 first, 3 CPU, 4 verdict, 5 why, 6 final why suffix,
      # 7 server, 8 procs, 9 mem, 10 sockets, 11 youngest, 12 oldest,
      # 13 age, 14 pids, 15 final pid suffix. Only bounded values enter arithmetic.
      n=${m[9]}; [[ "$n" =~ ^[0-9]+$ ]] && n="$(( n / 1048576 )) MiB"
      found+=("${m[1]} dead $(( (up - m[2]) / 60 )) min, the scope $(( m[13] / 3600 )) h old, its oldest process $(( m[12] / 3600 )) h: ${m[8]} process(es) (pids ${m[14]}), $n, ${m[10]} socket(s), its server ${m[7]}, ${m[4]} (${m[5]})")
      nd=$((nd + 1))
    elif [[ "$line" =~ ^old\ (tmux-spawn-[^[:space:]]+\.scope)\ pid=${POS}\ age=${N}\ comm=([^[:space:]]*)$ ]]; then
      found+=("${BASH_REMATCH[1]} live: pid ${BASH_REMATCH[2]} (${BASH_REMATCH[4]}) running $(( BASH_REMATCH[3] / 3600 )) h")
      no=$((no + 1))
    elif [[ "$line" =~ ^carry\ (tmux-spawn-[^[:space:]]+\.scope)\ state=(dead|live|unknown)\ first=${F}\ cpu0=${C}\ why=${CW}$ ]]; then
      local -a c=("${BASH_REMATCH[@]}")
      if [[ ("${c[3]}" == none && "${c[4]}" != none) || ("${c[3]}" != none && "${c[4]}" == none) ]]; then bad=$((bad + 1)); continue; fi
      case "${c[2]}:${c[5]}" in
        unknown:unit-show|unknown:description|unknown:control-group|unknown:cpu|unknown:scope-start|unknown:procs|unknown:cgroup-dir|unknown:child-cgroup|unknown:server-stat|unknown:server-comm|unknown:tmux-unknown) nc_unknown=$((nc_unknown + 1)) ;;
        live:parent-hop-cap) nc_live=$((nc_live + 1)) ;;
        dead:socket-tables|dead:socket-fd|dead:box-stat) nc_dead=$((nc_dead + 1)) ;;
        *) bad=$((bad + 1)); continue ;;
      esac
      carry_detail+=("${c[1]} ${c[2]} (${c[5]})")
    elif [ -n "$line" ]; then
      bad=$((bad + 1))
    fi
```

Replace the entire block AFTER `done < "$rec"` through the final `return 2` with:

```bash
  if (( bad )); then
    _dr_warn scope-sweep "the verdict record at $rec has $bad line(s) it cannot read, so none of its scope verdicts is safe to interpret" \
      "let the sweep rewrite it: systemctl --user start ccd-scope-sweep.service; then re-run doctor"
    return 2
  fi
  local detail="" x carries="${carry_detail[*]}"
  if (( nd || no )); then
    for x in "${found[@]}"; do detail="${detail}${detail:+; }$x"; done
    [[ -z "$carries" ]] || detail="$detail; carried unmeasured: $carries"
    _dr_warn scope-sweep "$nd dead pane scope(s) and $no long-lived process(es) in live ones, from the sweep's record (mode $mode): $detail" \
      "read each before acting: \`systemctl --user stop <unit>\` ends EVERY process in a dead scope; stop advice applies only to the measured dead rows, never to a carry. A service a session still needs is moved into a unit of its own (systemd-run --user --unit ...); a forgotten process in a live pane is the session's to end. The sweep stops only scopes inert for six hours, and only when armed"
    return 2
  fi
  if (( nc_dead || nc_unknown )); then
    _dr_warn scope-sweep "$nc_dead dead and $nc_unknown unknown pane scope(s) were carried unmeasured: $carries" \
      "let the sweep rewrite the measurement: systemctl --user start ccd-scope-sweep.service; then re-run doctor"
    return 2
  fi
  if (( nc_live )); then
    _dr_pass scope-sweep "no dead pane scope the sweep could measure, and no process older than a day in measured live ones, excluding $nc_live live pane scope(s) carried unmeasured ($carries) (the sweep's record, ${age}s old, mode $mode)"
  else
    _dr_pass scope-sweep "no dead pane scope the sweep could measure, and no process older than a day in a live one (the sweep's record, ${age}s old, mode $mode)"
  fi
  return 0
```

Nothing in doctor stops a unit. Update its local header to describe three row kinds and the state-specific remedies; retain WARN-not-FAIL and absent/paused/server/Darwin SKIPs.

- [x] **Step 8: Make the instrument strict, fresh and baseline-relative.**

Replace S6_HDR/S6_DEAD and add the following constants beside the retained S6_IDLE/S6_DAY/S6_INERT definitions:

```python
S6_STALE_S = 300
S6_NUM = r"(?:0|[1-9][0-9]{0,15})"
S6_POS = r"(?:[1-9][0-9]{0,15})"
S6_CPU = r"(?:0|[1-9][0-9]{0,19})"
S6_UNIT = r"tmux-spawn-\S+\.scope"
S6_HDR = re.compile(rf"# ccd-scope-sweep v1 tick=({S6_NUM}) up=({S6_NUM}) mode=(shadow|live)")
S6_DEAD = re.compile(
    rf"dead {S6_UNIT} first=(?P<first>{S6_POS}) cpu0={S6_CPU} "
    rf"verdict=(?P<verdict>report|would-stop|held|stopped|stop-failed) "
    rf"why=[a-z-]+(?:,[a-z-]+)* server=(?:gone|ccd|reused) "
    rf"procs={S6_POS} mem=(?:{S6_NUM}|\?) sockets={S6_NUM} "
    rf"youngest=(?:-1|{S6_NUM}) oldest=(?:-1|{S6_NUM}) age={S6_NUM} "
    rf"pids=[1-9][0-9]*(?:,[1-9][0-9]*)*"
)
S6_OLD = re.compile(rf"old {S6_UNIT} pid={S6_POS} age={S6_NUM} comm=\S*")
S6_CARRY = re.compile(
    rf"carry {S6_UNIT} state=(?P<state>dead|live|unknown) "
    rf"first=(?P<first>none|{S6_POS}) cpu0=(?P<cpu0>none|{S6_CPU}) "
    r"why=(?P<why>unit-show|description|control-group|cpu|scope-start|procs|cgroup-dir|child-cgroup|server-stat|server-comm|tmux-unknown|parent-hop-cap|socket-tables|socket-fd|box-stat)"
)
S6_UNKNOWN_REASONS = frozenset(("unit-show", "description", "control-group", "cpu", "scope-start", "procs", "cgroup-dir", "child-cgroup", "server-stat", "server-comm", "tmux-unknown"))


def s6_carry_valid(c):
    if (c.group("first") == "none") != (c.group("cpu0") == "none"):
        return False
    state, why = c.group("state"), c.group("why")
    return ((state == "unknown" and why in S6_UNKNOWN_REASONS)
            or (state == "live" and why == "parent-hop-cap")
            or (state == "dead" and why in ("socket-tables", "socket-fd", "box-stat")))
```

Replace `s6_inert` with:

```python
def s6_inert():
    rec = os.path.join(os.environ.get("XDG_RUNTIME_DIR") or "/run/user/%d" % os.getuid(), "ccd-scope-sweep.state")
    try:
        lines = read_lines(rec)
    except FileNotFoundError:
        return {"record": "absent"}
    except OSError:
        return {"record": "unreadable"}
    m = S6_HDR.fullmatch(lines[0]) if lines else None
    if not m:
        return {"record": "unreadable"}
    tick, up, mode = int(m.group(1)), int(m.group(2)), m.group(3)
    now = int(time.time())
    if tick > now:
        return {"record": "future"}
    if now - tick > S6_STALE_S:
        return {"record": "stale"}
    dead = inert = day = 0
    carried = {"dead": 0, "live": 0, "unknown": 0}
    for line in lines[1:]:
        if not line:
            continue
        d = S6_DEAD.fullmatch(line)
        if d:
            dead += 1
            if d.group("verdict") in S6_INERT:
                inert += 1
                if up - int(d.group("first")) >= S6_DAY:
                    day += 1
            continue
        c = S6_CARRY.fullmatch(line)
        if c and s6_carry_valid(c):
            carried[c.group("state")] += 1
            continue
        if S6_OLD.fullmatch(line):
            continue
        return {"record": "unreadable"}
    return {"mode": mode, "dead": dead, "inert": inert,
            "inert_dead_a_day_or_more": day, "carried_scopes": carried}
```

Use a single comparison function and have stage6 call it only when the optional baseline is present. It deliberately does not use current inert-scope counts to decide the pressure key's fate:

```python
def s6_pressure_comparison(reading, baseline):
    out = {"baseline_reap_class": baseline, "withdraw_above": baseline + 2}
    observed = reading.get("reap_class")
    if not isinstance(observed, int) or isinstance(observed, bool) or observed < 0:
        return {**out, "decision": "unmeasured"}
    return {**out, "observed_reap_class": observed,
            "decision": "withdraw" if observed > baseline + 2 else "not-triggered"}


def stage6(ctx):
    reading = s6_reap(ctx)
    out = {"reap_class_oom": reading, "inert_scopes": s6_inert()}
    if ctx.get("reap_baseline") is not None:
        out["pressure_reap_comparison"] = s6_pressure_comparison(reading, ctx["reap_baseline"])
    return out
```

Add this argparse type beside `when`:

```python
def reap_baseline(s):
    if not re.fullmatch(r"0|[1-9][0-9]{0,15}", s):
        raise argparse.ArgumentTypeError("reap baseline must be a non-negative decimal count, without leading zeroes")
    return int(s)
```

Inside `main`, add `ap.add_argument('--reap-baseline', type=reap_baseline, help='stage 6 only: frozen reap-class count; read-only B+2 comparison for an explicit seven-day window')`. After parse and before assembling ctx:

```python
    if a.reap_baseline is not None:
        if a.stage != [6] or a.since is None or a.until is None or a.until - a.since != 7 * 86400:
            ap.error("--reap-baseline requires --stage 6 alone and an explicit seven-day --since/--until window")
```

Add `'reap_baseline': a.reap_baseline` to ctx. Preserve every old CLI argument and stage registration. This is the entire new comparison interface; no undocumented `--baseline`, removal script, restart or manager action. Add the argument and read-only distinction to the instrument's own header.

- [x] **Step 9: Close the alarm race in the existing Perl prefix.**

Replace only the BOUNDED literal with:

```ts
export const BOUNDED = `perl -e 'use POSIX qw(setpgid); use Errno qw(EACCES ESRCH); $t = shift; $p = fork; die "fork: $!" unless defined $p; if (!$p) { exit 125 unless defined setpgid(0, 0); exec @ARGV; exit 127 } $g = setpgid($p, $p); $e = 0 + $!; if (!defined($g) && $e != EACCES && $e != ESRCH) { kill "KILL", $p; waitpid($p, 0); exit 125 } $SIG{ALRM} = sub { kill "KILL", -$p; waitpid($p, 0); exit 142 }; alarm $t; waitpid($p, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)'`;
```

The parent establishes the child's group while the child may still be unscheduled. POSIX `setpgid` returns an undefined value on failure and a defined value numerically equal to zero on success; do NOT test `!= 0`. Save errno immediately after the call, before a kill/wait can change it. Both arms use the same POSIX return contract. EACCES means that child already exec'd (after its own successful group setup); ESRCH means it is already gone. Any other setup failure kills/reaps only that child and refuses 125 rather than installing an alarm against an unknown group. Retain the comment's whole-group rationale and add the parent-race explanation. No new exported helper or dependency.

- [x] **Step 10: Verify already-landed text, then run residue gates green.**

Compare the predecessor's final source, not review-305's old line numbers. Keep its landed bounded-arithmetic checks, invalid stale-knob fallback, child-cgroup/hop-cap containment, clock comment, graph-doctor fixture seam, corrected census prose and restamp instructions. Do not revive the stray blank line or the superseded source changes. Apply the shared citation-tax procedure to genuinely moved doctor/helper/test anchors.

From the workspace root:

```bash
bash -n ccd/ccd-scope-sweep ccd/ccrc-doctor-checks
python3 -I -c "import ast; from pathlib import Path; ast.parse(Path('deploy/measure-continuity.py').read_text())"
git diff --check
```

Then from `server/`, sequentially:

```bash
./node_modules/.bin/vitest run test/scope-sweep.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'scope-sweep' --maxWorkers=1
./node_modules/.bin/vitest run test/measure-continuity-stage6.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-limit-banner.test.ts test/ccd-auto-compact.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/single-definition.test.ts test/ccrc-doctor-graphify.test.ts --maxWorkers=1
```

A valid empty write is required to be green; merely checking a failed nonempty write misses the empty-record regression. Restore any permission-mutated fixture in its own cleanup; never widen a permission case to read a real proc root.

- [x] **Step 11: Measure each residue mutation, restore, and review the first commit.**

| Mutation | Must-red owner |
|---|---|
| Copy a prior dead line instead of writing carry | Migrated carry cases, including live loop |
| Drop first-ever uncertainty entirely | First-ever carry; no-procs-file `w` |
| Stop parsing retained carry clocks | Carry followed by fully measured tick |
| Accept half-pair or over-wide carry clocks | Malformed carry clock table |
| Lose the capture snapshot before regex helper | Prior carry/clock read-back |
| Treat a zombie as a live child; ignore every outside child | Z/S paired verdicts, separately |
| Restore paused stdout or move pause after manager read | Silent pause plus no-manager/unchanged-record pins |
| Ignore redirection-open, header, body or rename failure | Four independent prior-record retention pins |
| Return failure for the empty record | Valid empty replacement |
| Restore malformed-body ordinary stop remedy | Garbage-only and mixed doctor records |
| Restore unqualified carried-live PASS | Explicit live exclusion |
| Ignore future tick or stale instrument header | Future/stale cases in both readers |
| Skip malformed instrument body rows | Mixed bad body gives unreadable, not partial counts |
| Replace B + 2 with literal 2, or use >= | Non-zero B5 count7/count8 and exact-boundary pins |
| Map unreadable journal to observed 0 | Unmeasured comparison |
| Remove parent setpgid or kill only direct child | Delayed-child and normal whole-group timeout cases |

Each mutation runs against the source it owns in fixture-contained suites, produces an observed RED, then restores ONLY the task's bytes. Restore green and run the shared citation/mode guards again. A fresh Opus/high per-task reviewer must clear this entire residue unit before Task 2 starts. Commit subject: `fix(continuity): distinguish carried scope evidence and close wave-4 residue`. Define any justified issued departure alongside this commit; report unused numbers bare.

#### Execution evidence (Task 1)

Measured on the dispatched workspace branch at base `a3cebde1b`, from `server/`, foreground, `--maxWorkers=1`, fixture HOMEs only. Steps 1-10 are done. Step 11's mutation table is measured and restored below; its fresh-reviewer gate belongs to the controller and is not claimed here.

**Red, before any product edit (Step 5).**

| Owner | Red | What reddened |
|---|---|---|
| `scope-sweep.test.ts` | 32 failed, 44 passed (76) | 24 migrated carried-row cases (copied dead rows, no carry row), the no-procs `w` carry, the silent pause, the retained-clock and first-ever carries, the Z outside child, and all four record-write failures (the failed header case exited 0; the failed open and rename cases exited 1 with the old `cannot write` message). Green controls: the four malformed-clock cases, the S outside child and the valid empty record, which the old code already satisfied. |
| `ccrc-doctor.test.ts -t scope-sweep` | 12 failed, 16 passed (28) | both unreadable-body cases, live carry PASS, the dead and unknown carry cases, all five malformed or contradictory rows, the future record and the mixed record |
| `measure-continuity-stage6.test.ts` | 16 failed, 11 passed (27) | the widened all-counts case, carries, stale, future, five bad bodies, two invalid ticks, four baseline cases and the unreadable-journal comparison. The no-baseline control and the five argument-refusal cases were green already (argparse refuses an unknown option). |
| `ccd-limit-banner.test.ts -t 'timed harness'` | 1 failed, 1 passed (2) | only `delayed-child`: `the recorded pre-exec child was reaped: expected true to be false`. The `normal` control passed. |

**Green (Step 10).** `bash -n` on both shell files, the `ast.parse` of the instrument and `git diff --check` are clean. `scope-sweep.test.ts` 76 passed; `ccrc-doctor.test.ts -t scope-sweep` 28 passed (934 skipped); `measure-continuity-stage6.test.ts` 27 passed; `ccd-limit-banner.test.ts` + `ccd-auto-compact.test.ts` 190 passed; `single-definition.test.ts` + `ccrc-doctor-graphify.test.ts` 601 passed. Neighbours run green as well: `ownership`, `ccd-reg-get-census`, `ccd-die-containment`, `macos-platform`, `measure-continuity` (stage 1, 4, 7) and `ccd-bounded-reads`, 198 passed. Modes of the three shell and Python files are unchanged (775). `ccd/ccd` is untouched, so no restamp and no `_reg_get` census movement.

**Mutations (Step 11): mutation -> observed red owner case, then restored byte for byte (sha256 of all four mutated files verified identical before and after).**

| Mutation | Observed red owner |
|---|---|
| Copy a prior dead line instead of writing a carry | 26 of 76: every migrated carried-row case, including the live-loop case |
| Drop first-ever uncertainty entirely | first-ever carry; no-procs-file `w` (2) |
| Stop parsing retained carry clocks | `a retained carry clock is read back only after all predicates are measurable` (1) |
| Accept half-pair or over-wide carry clocks (`CARRY_RE` fields widened to `[^ ]+` and the bound check removed) | `08 cpu0=7` and `none cpu0=7` (2). `99999999999999999 cpu0=7` and `123 cpu0=none` stay green: the arithmetic range check (`first > UP`, `first < born`) restarts the clock anyway, so those two rows pin nothing on their own. |
| Lose the capture snapshot before the regex helper (snapshot taken after `_ss_prev_clock`) | 59 of 76: every case that reads a prior clock |
| Treat a zombie as a live child | `outside child in state Z` (1) |
| Ignore every outside child | `outside child in state S` and the `parent of a process in another cgroup` predicate case (2) |
| Restore paused stdout | the paused case (1) |
| Move the pause after the manager read | the paused case (1) |
| Ignore header failure / body failure / rename failure | each only its own `a failed <header|body|rename>` case (1 each) |
| Ignore redirection-open failure (write guard only) | the open case, ONLY with the tightened message assertion (see candidate departure 1); with the plan's original assertion this mutation measured green, 76 of 76 |
| Ignore open failure AND rename failure | the open and rename cases (2) |
| Return failure for the empty record | 6: `a valid empty replacement` and five cases whose scope leaves an empty record |
| Restore malformed-body ordinary stop remedy | 7: both `unreadable body` cases and all five malformed or contradictory row cases |
| Restore unqualified carried-live PASS | `a measured-live carry qualifies PASS` (1) |
| Doctor ignores future tick | `a future record is neither fresh PASS nor destructive advice` (1) |
| Instrument ignores future tick / stale tick | `a future record publishes no current counts` / `a stale record publishes no current counts` (1 each) |
| Instrument skips malformed body rows (`continue`) | 5: the `a nonempty bad body` table (garbage, both bad carries, trailing text, leading-zero CPU) |
| `B + 2` replaced by literal 2 | `baseline 5 with observed 7` (1) |
| `>` replaced by `>=` | `baseline 0 with observed 2` and `baseline 5 with observed 7` (2) |
| Unreadable journal maps to observed 0 | `an unreadable journal gives an unmeasured comparison` (1) |
| Remove the parent-side `setpgid` | `delayed-child` only (1) |
| Kill only the direct child | `normal` only (1): the delayed case still reaps its pre-exec child by a direct kill |

**Citation tax and census (S6-R11).** `ccd/ccd` and `README.md` are untouched. Instrument from the child-reclamation predecessor plan, base `a3cebde1b`: `byFile['ccd/ccd']` stated 147, base 147, tree 147; `total` stated 202, base 202, tree 202; other keys moved: none; byFile composition entered [] left []; row array stated 55, base 55, tree 55, entered [] left []; site array stated 35, base 35, tree 35, entered [] left []. The base is consistent with every stated literal, so no census literal or README anchor moved. `session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS FACTS|whole corpus'` 7 passed; the two frozen documents are unchanged from `origin/main`.

**Candidate departures (to be numbered by the controller, none assigned here).**

1. Open-failure pin tightened (ruled by the coordinator a test strengthening with no contract change; not numbered). The plan's `failed open` case asserted only `previous record retained`, but an open failure also fails the later `mv`, whose own message carries the same phrase, so deleting the write guard left that case green (measured: 76 of 76). The case now also asserts `cannot write verdict record` (and `cannot replace verdict record` for the rename case). Contract unchanged; cost: one assertion line pair in `scope-sweep.test.ts`.
2. Found in review and fixed in fix round 1: the plan's reader `why` class `[a-z-]` rejected the sweep's own `dead-under-6h` and `process-started-under-6h`; now D-4316 (see `## Deviations found`). The figures above for the sweep, doctor and instrument suites were measured before that fix; after it `scope-sweep.test.ts` is 78 of 78 (two round-trip pins added), the doctor scope-sweep subset 28 and the stage-6 file 27, all green.

**Concerns.** (a) `_ss_stat` now refuses a state letter outside `[A-Z]`; Linux also prints lowercase `t` (tracing stop). Such a process reads as unreadable, so a box with a traced process carries `box-stat` rather than judging: fail-safe, not unsafe, and the plan's own fixture rule. (b) The malformed-clock rows `99999999999999999 cpu0=7` and `123 cpu0=none` are not independently red under the clock-bound mutation (see table). (c) The refused-argument stage-6 cases print argparse usage to the test's stderr; the cases pass.

Independent Opus/high task review: one Critical (plan-mandated reader why-class) fixed in fix round 1 as D-4316; scoped re-review: all findings addressed.

### Task 2: Compose the pressure variable for every supported Claude Code spawn

**Files:**
- Modify: `ccd/ccd` - `_resume_env` only; both `_spawn_start` command lines already consume it.
- Modify: `server/test/ccd-resume-flag.test.ts`, `server/test/ccd-spawn-split.test.ts`, `server/test/ccd-route-spawn.test.ts`, `server/test/ccrc-codex-launcher.test.ts`.
- Verify unchanged expectations: `server/test/ccd-route-degrade.test.ts`, `server/test/ccd-lifecycle-purge.test.ts`, `server/test/wrapper-generate.test.ts`.
- Modify only for measured movement: `README.md`, `server/test/session-hook.test.ts` and the existing census sentence in `ccd/ccd`.

**Interfaces:**
- Consumes: `_resume_env()` prints one line of child `env` assignments, with an optional interrupted-turn max-age key; `_spawn_start <id> <new|resume>` uses that value in both commands.
- Produces: the same line with exactly one `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` assignment before the wrapper executable. No new argument, return shape, setting or roster field.
- Applicability: every currently supported launcher is Claude Code: upstream, generated wrappers, the `exec.kind=codex` wrapper through `ccrc-codex`, and approved external Claude Code shims. Provider/telemetry is not the execution target. A future native executable must use its own composition or discard this Claude Code key; introducing that target is not this wave.

- [x] **Step 1: Add independent composer and branch-presence tests.**

In `ccd-resume-flag.test.ts`, use its existing `seed`, `TMUX`, `RESUME_DIES` and `newSessions` helpers. These assertions do not derive the expected variable from `_resume_env`, so a disconnected or emptied composer cannot self-confirm:

```ts
describe('the pressure-reap variable is child scoped', () => {
  it.each(['', '3600000'])('the shared composer carries it once with max-age %s', (age) => {
    const out = h.sh(`RESUME_REDRIVE_MAX_AGE_MS='${age}'; _resume_env`);
    expect(out.match(/CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1/g)).toHaveLength(1);
    expect(out).toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1');
    expect(out).toContain("CLAUDE_CODE_RESUME_PROMPT='");
    if (age) expect(out).toContain(`CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS=${age}`);
    else expect(out).not.toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS');
  });

  it.each(['new', 'resume'] as const)('the %s primary command carries the variable before the wrapper', (mode) => {
    seed();
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid ${mode}`);
    const lines = newSessions();
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.match(/CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1/g)).toHaveLength(1);
    expect(line.indexOf('CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1'))
      .toBeLessThan(line.indexOf('/.local/bin/claude'));
  });

  it('the retry independently carries it, rather than relying on the failed primary', () => {
    seed();
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume 2>/dev/null`);
    const lines = newSessions();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('--resume');
    expect(lines[1]).toContain('--session-id');
    for (const line of lines) {
      expect(line.match(/CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1/g)).toHaveLength(1);
      expect(line.indexOf('CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1'))
        .toBeLessThan(line.indexOf('/.local/bin/claude'));
    }
  });

  it('composing a child command does not export the key into ccd itself', () => {
    expect(h.sh(`unset CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP;
      _resume_env >/dev/null; printf '%s' "\${CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP-unset}"`)).toBe('unset');
  });
});
```

In `ccd-route-spawn.test.ts`, append the external-provider control using its existing `gptLane`, `seed` and `spawnBoth` helpers:

```ts
it('an external Claude Code shim receives the pressure key on primary and retry without adopting Anthropic route semantics', () => {
  gptLane(); seed('myid', 'gpt');
  h.sh('_reg_set myid class opus; _reg_set myid effort high; _reg_set myid subagent sonnet; _reg_set myid workflow on');
  const [primary, retry] = spawnBoth('myid');
  for (const line of [primary, retry]) {
    expect(line.match(/CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1/g)).toHaveLength(1);
    expect(line.indexOf('CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1'))
      .toBeLessThan(line.indexOf('/.local/bin/gpt'));
    expect(line).toContain(`'${h.home}/.local/bin/gpt' --model opus `);
    expect(line).not.toContain('--remote-control');
    expect(line).not.toContain('--settings');
    expect(line).not.toContain('--effort');
    expect(line).not.toContain('CLAUDE_CODE_SUBAGENT_MODEL');
  }
  expect(h.reg('myid', 'inert')).toBe('effort,workflow,subagent');
});
```

In `ccd-spawn-split.test.ts`, retain its existing whole-command primary/retry RC-on/off assertions. Their `expectedCommand` reads `_resume_env` to avoid duplicating the long prompt, and automatically widens with the new assignment; the independent cases above pin the assignment itself. Add this slow-path/no-systemd control with the existing `seed` and `newSessions`. All binaries remain fixture-contained:

```ts
it('plain tmux placement forwards the same pressure-bearing command', () => {
  seed('myid');
  h.sh(`sleep() { :; };
    command() { [[ "$*" == '-v systemd-run' ]] && return 1; builtin command "$@"; };
    tmux() {
      printf 'tmux %s\\n' "$*" >> "$HOME/ccd-calls";
      case "$1" in
        list-sessions) return 1 ;;
        new-session) : > "$HOME/pane-up" ;;
        has-session) [[ -e "$HOME/pane-up" ]] ;;
      esac
      return 0;
    };
    _spawn_start myid new`);
  const lines = newSessions();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('exec env COLORTERM=truecolor ');
  expect(lines[0]).toContain('CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1');
  expect(lines[0]).toContain("--session-id 'deadbeef-0000-4000-8000-000000000000' --dangerously-skip-permissions");
});
```

- [x] **Step 2: Pin generated-wrapper inheritance without changing the launcher.**

In `ccrc-codex-launcher.test.ts`, extend the existing `STUB_CLAUDE` recorder's `for v in ...` line to include `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP`; record only this non-secret value, never all environment values. Keep the existing wrapper/materialiser/reverse-map integration test and add `env` to its `run` call:

```ts
const r = run(b, {
  file: path.join(b.bin, 'codex-a'), cfg: null,
  args: ['--session-id', 'fixture-uuid'],
  env: { CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP: '1' },
});
```

After its existing argv/endpoint/config assertions, add:

```ts
expect(claudeEnv(b)['CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP']).toBe('1');
expect(recText(b, 'claude.pid').trim()).toBe(String(r.pid));
```

This exercises the REAL generated wrapper and REAL launcher through their final upstream `exec`, with a stubbed upstream executable and fixture-only tier startup. No shipped edit to `shared/wrapper.mjs` or `ccd/ccrc-codex` is needed. The existing `wrapper-generate` codex-target case remains the independent grammar pin.

- [x] **Step 3: Run the new cases red before editing the composer.**

From `server/`, foreground and sequentially:

```bash
./node_modules/.bin/vitest run test/ccd-resume-flag.test.ts -t 'pressure-reap' --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-route-spawn.test.ts -t 'external Claude Code shim' --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts -t 'plain tmux placement' --maxWorkers=1
./node_modules/.bin/vitest run test/ccrc-codex-launcher.test.ts -t 'REAL wrapper' --maxWorkers=1
```

Expected: presence cases fail because the composer has no key; wrapper inheritance is an already-green control. Record actual results, not this forecast. The inherited-key test is not proof that ccd supplied it; only the command/composer cases prove that.

- [x] **Step 4: Change the shared composition once.**

Replace `_resume_env`'s existing `local out` line, in place:

```bash
  local out="CLAUDE_CODE_RESUME_INTERRUPTED_TURN=$RESUME_INTERRUPTED_TURN CLAUDE_CODE_RESUME_PROMPT='$RESUME_PROMPT' CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1"
```

Keep optional max-age composition and `printf` unchanged. Amend its one-line function comment in place to say it composes Claude Code resume and pressure-reap assignments. Do not edit either `exec env` call, `_tmux_new_session`, generation locking, route flags, Remote Control gating or generated wrappers. This preserves `genenv` before `COLORTERM`, the resume/route environment before the wrapper, and all argv order. It adds no `_reg_get` call.

- [x] **Step 5: Stamp and run owning/neighbor gates green.**

Run the shared generated/mode/census/citation procedures, then from `server/`, one process at a time:

```bash
./node_modules/.bin/vitest run test/ccd-resume-flag.test.ts test/ccd-spawn-split.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-route-spawn.test.ts test/ccd-route-degrade.test.ts test/ccd-lifecycle-purge.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccrc-codex-launcher.test.ts test/wrapper-generate.test.ts --maxWorkers=1
```

The neighboring byte-exact expectations that read `_resume_env` need no copied prompt/key literal. Any unexpectedly hard-coded expected command is widened by its exact new assignment only, never by loosening `toBe` to a substring. The generation-environment spelling stays contiguous before `COLORTERM`, so the lifecycle purge guard must not be relaxed.

- [x] **Step 6: Measure these mutations and restore green.**

| Mutation | Must-red owner |
|---|---|
| Remove the pressure assignment from `_resume_env` | Independent composer and primary/retry presence |
| Substitute `_is_anthropic_backend` as an applicability gate | External Claude Code shim, both commands |
| Drop `$resenv` from PRIMARY only | Primary presence and whole-command shape |
| Drop `$resenv` from RETRY only | Retry presence and whole-command shape |
| Export the key globally instead of composing it | Child-scope no-export control |
| Strip the inherited key before the launcher's final `exec` | Real generated wrapper inheritance |

Mutations are fixture-only edits of this task's exact bytes; each must produce an observed RED. Restore the launcher after its mutation even though it is not a shipped task edit. Restamp ccd and rerun all affected cases green.

- [x] **Step 7: Commit Task 2 alone after the fresh reviewer gate.**

Commit subject: `fix(ccd): disable background-shell pressure reap in child spawns`. Include only composer/tests and genuinely measured citation movement, plus the in-plan evidence. Keep the first-commit residue in Task 1's commit. Do not restart sessions to make this assignment take effect.

#### Execution evidence (Task 2)

Measured on the dispatched workspace branch at base `5d2a8c8ba`, from `server/`, foreground, `--maxWorkers=1`, fixture HOMEs only. Steps 1-6 are done; Step 7 is ticked for the commit itself, and its fresh-reviewer gate belongs to the controller and is not claimed here.

**Red, before the composer edit (Step 3).**

| Owner | Red | What reddened |
|---|---|---|
| `ccd-resume-flag.test.ts -t pressure-reap` | 5 failed, 1 passed (12) | both composer cases (max-age empty and 3600000), the `new` and `resume` primary cases and the retry case (`Target cannot be null or undefined`: no assignment to match). The child-scope no-export control passed, as it should before any export exists. |
| `ccd-route-spawn.test.ts -t 'external Claude Code shim'` | 1 failed (20) | the external shim case (same null match) |
| `ccd-spawn-split.test.ts -t 'plain tmux placement'` | 1 failed (54) | `expected 'tmux new-session -d -s cc-myid -x 220...' to contain 'CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE...'` |
| `ccrc-codex-launcher.test.ts -t 'REAL wrapper'` | 1 passed (30) | already green, as forecast: the control proves only inheritance, not that ccd supplied the key |

**Edit (Step 4).** `_resume_env`'s `local out` line and its one-line comment, in place, no line added or removed; no `exec env` call, `_tmux_new_session`, route flag or wrapper touched. `shared/wrapper.mjs` and `ccd/ccrc-codex` are unchanged (sha256 verified).

**Green (Step 5).** Restamped with the shared node command; `node shared/mark.mjs --check ccd/ccd` reports `ccrc-unmodified` (exit 0), `bash -n ccd/ccd` clean, mode 775 before and after. `ccd-resume-flag` + `ccd-spawn-split` 66 passed; `ccd-route-spawn` + `ccd-route-degrade` + `ccd-lifecycle-purge` 95 passed; `ccrc-codex-launcher` + `wrapper-generate` 41 passed; `ownership` + `ccd-reg-get-census` + `ccd-die-containment` 29 passed. Neighbor byte-exact expectations read `_resume_env`, so none needed widening.

**Mutations (Step 6): mutation -> observed red owner case, then restored byte for byte (sha256 of `ccd/ccd`, `ccd/ccrc-codex` and `shared/wrapper.mjs` verified identical to the pre-mutation copies; ccd restamped for each ccd mutation).**

| Mutation | Observed red owner |
|---|---|
| Remove the assignment from `_resume_env` | 7: both composer cases, `new`/`resume` primary, the retry case, the external shim case, plain tmux placement. The whole-command cases stayed green by design: their expected line is read from `_resume_env` itself. |
| `_is_anthropic_backend` gate (assignment moved out of `_resume_env` into a gated append after `resenv=$(_resume_env)`) | the external shim case (both commands); the composer cases, because the assignment left `_resume_env`; and the byte-exact whole-command, remote-control and flag-file cases that read `_resume_env` (9 in all) |
| Drop `$resenv` from the PRIMARY only | primary presence (`new`, `resume`, plain tmux placement), the retry case's primary line, the shim case, and the whole-command shape cases (17) |
| Drop `$resenv` from the RETRY only | `the --session-id fallback line carries it as well`, the retry presence case, the shim case, and the retry-line whole-command cases (8) |
| Export the key globally as well as composing it (`export` inside `_resume_env`) | `composing a child command does not export the key into ccd itself` only (1) |
| Strip the inherited key before the launcher's final `exec` (`exec env -u ... "$cx_upbin"`, fixture-only in `ccd/ccrc-codex`) | `composes with the REAL wrapper, the REAL materialiser and the REAL reverse map` (1) |

**Census.** `_reg_get` before: 209 calls on 178 lines; after: 209 on 178 (no mover, existing header sentence untouched).

**Citation tax (S6-R11).** Instrument from the child-reclamation predecessor plan, extracted to private scratch, run with base `5d2a8c8ba` and `--maxWorkers=1`: `byFile['ccd/ccd']` stated 147, base 147, tree 147; `total` stated 202, base 202, tree 202; other keys moved: none; byFile composition entered [] left []; row array stated 55, base 55, tree 55 (entered [] left []); site array stated 35, base 35, tree 35 (entered [] left []). The edit changes no line count in `ccd/ccd`, so no cited line moved. README carries no `ccd/ccd:<line>` anchor at all, so the historical re-pointer (which insists on exactly two) was not applicable and README is untouched. The frozen documents are unchanged against `origin/main`. The citation cases are green (7 passed).

**Candidate departures (to be numbered by the controller, none assigned here).** None. Two plan-snippet adjustments, neither changing a contract: the external-shim case reads `[primary, retry]` with non-null assertions (`primary!`, `retry!`) for the strict compiler, and each new group sits in its own top-level `describe` at the end of its file.

**Concerns.** The `remove` and `_is_anthropic_backend` mutations also redden byte-exact cases that derive their expectation from `_resume_env`, so those cases are secondary owners; the independent presence cases are the primary ones.

### Task 3: Keep outgoing operator choice before a live UUID rotation

This is D-3925's deferred code fix, not a new parser or a change to non-Anthropic route vocabulary.

**Files:**
- Modify: `ccd/ccd` - `_sync_uuid`, `_operator_choice_keep`, and the nearby parser's caller comment, found by function names.
- Modify: `server/test/ccd-operator-choice.test.ts` - append the live-rotation cases beside the existing marker lifecycle cases.
- Modify only if measured citation movement requires it: `README.md`, `server/test/session-hook.test.ts` and the existing `_reg_get` census sentence in `ccd/ccd`.

**Interfaces:**
- Consumes: `_transcript_path <id>` resolves the transcript at the CURRENT registry UUID; `_operator_choice_read <transcript> <typed-journal>` returns the existing model/effort/drift lines; `cmd_route --session <id> --set <field=value> ...` is the only route writer.
- Produces: `_operator_choice_promote <id> [reason]`, always rc 0, reads/promotes without creating or removing `choicekept`; the optional reason defaults to `kept across a restart`.
- Preserves: `_operator_choice_keep <id>`, always rc 0, writes its existing marker before calling the promotion; `_operator_choice_unmark`, stop ordering, spawn journal opening and marker clearing are unchanged.
- `_sync_uuid <id>` calls promotion only when it has a non-empty pane UUID DIFFERENT from the registry UUID AND the existing `_ci_pane_parked` / `_ci_pane_refused` guards admit that rotation, BEFORE `_reg_set <id> uuid <new-uuid>`. Retain the following worker-memory clearing, `_ci_bg_follow` and `_follow_continued_in` calls. Refused or unchanged pane UUIDs do not promote; background-worker and continuation-chain writes remain outside this task's promotion seam.

- [ ] **Step 1: Append failing fixture-contained live-rotation cases.**

Add `spawnSync` to the existing `node:child_process` import, `BOUNDED` plus `ghContainedEnv` to the existing `ccdWsHelpers.js` import, and `import { inheritedEnv } from './gitEnvStrip.js';` beside them. The new direct child spawn spreads `inheritedEnv()`, not inherited repository-redirection variables. Use this helper inside a new `describe('live UUID rotation keeps the outgoing operator choice', ...)` in `ccd-operator-choice.test.ts`. It calls the real `_sync_uuid`; tmux is always a fixture shell function, never the live binary. The refusal and follow-order controls below additionally substitute only the named admission verdicts and follow observers:

```ts
const NEXT = 'deadbeef-0000-4000-8000-000000000001';
const THIRD = 'deadbeef-0000-4000-8000-000000000002';
const sync = (sid: string, controls = ''): string => {
  const dir = path.join(h.home, '.claude', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '424242.json'), JSON.stringify({ sessionId: sid }));
  return h.sh(`${controls}
    tmux() { [[ "$1" == list-panes ]] && printf '%s\\n' 424242; return 0; };
    _sync_uuid ${ID}; printf 'rc=%s' "$?"`);
};

it('reads the old transcript before changing uuid and promotes the pair once', () => {
  seed(); record({ class: 'haiku', effort: 'low' });
  const t = now() - 600;
  writeTranscript([
    cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5')),
    cmd(t + 1, 'effort', 'high'), ack(t + 1, EFFORT_ACK('high')),
  ]);
  expect(sync(NEXT)).toBe('rc=0');
  expect(h.reg(ID, 'uuid')).toBe(NEXT);
  expect(h.reg(ID, 'class')).toBe('opus');
  expect(h.reg(ID, 'effort')).toBe('high');
  expect(routeLines()).toHaveLength(1);
  expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(false);
  expect(sync(NEXT)).toBe('rc=0');
  expect(routeLines()).toHaveLength(1);
});

it('a rotation does not remove or replace an existing dead-session marker', () => {
  seed(); record({ class: 'fable' });
  const marker = regFile(`${ID}.choicekept`);
  fs.writeFileSync(marker, 'fixture-marker');
  const before = fs.statSync(marker).mtimeMs;
  const t = now() - 600;
  writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
  expect(sync(NEXT)).toBe('rc=0');
  expect(h.reg(ID, 'class')).toBe('opus');
  expect(fs.readFileSync(marker, 'utf8')).toBe('fixture-marker');
  expect(fs.statSync(marker).mtimeMs).toBe(before);
});

it('two rotations then a restart read the newest transcript, not an old marker', () => {
  seed(); record({ class: 'fable', effort: 'low' });
  const t = now() - 600;
  writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
  sync(NEXT);
  expect(h.reg(ID, 'class')).toBe('opus');
  // Align the fixture record's mtime with this historical transcript clock.
  // The real writer used wall time; the next fixture command is later than this write.
  record({ class: 'opus', effort: 'low' }, ID, 500);
  writeTranscript([
    cmd(t + 200, 'model', 'sonnet'), ack(t + 200, MODEL_ACK('Sonnet 5.5')),
    cmd(t + 201, 'effort', 'medium'), ack(t + 201, EFFORT_ACK('medium')),
  ]);
  sync(THIRD);
  expect(h.reg(ID, 'uuid')).toBe(THIRD);
  expect(h.reg(ID, 'class')).toBe('sonnet');
  expect(h.reg(ID, 'effort')).toBe('medium');
  expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(false);
  record({ class: 'sonnet', effort: 'medium' }, ID, 300);
  writeTranscript([
    cmd(t + 400, 'model', 'opus'), ack(t + 400, MODEL_ACK('Opus 5.5')),
    cmd(t + 401, 'effort', 'high'), ack(t + 401, EFFORT_ACK('high')),
  ]);
  h.sh(`tmux() { ${WIDE_PANE} return 0; }; _spawn_start ${ID} new`);
  expect(h.reg(ID, 'class')).toBe('opus');
  expect(h.reg(ID, 'effort')).toBe('high');
  expect(routeLines()).toHaveLength(3);
  expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(false);
});

it('ccd-typed commands stay excluded during rotation', () => {
  seed(); record({ class: 'fable', effort: 'low' });
  const t = now() - 600;
  fs.appendFileSync(regFile(`${ID}.typed`), `\n${t} model opus\n${t + 1} effort high`);
  writeTranscript([
    cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5')),
    cmd(t + 1, 'effort', 'high'), ack(t + 1, EFFORT_ACK('high')),
  ]);
  expect(sync(NEXT)).toBe('rc=0');
  expect(h.reg(ID, 'uuid')).toBe(NEXT);
  expect(h.reg(ID, 'class')).toBe('fable');
  expect(h.reg(ID, 'effort')).toBe('low');
  expect(routeLines()).toEqual([]);
});

it('newer route fields win, even when the outgoing transcript differs', () => {
  seed(); record({ class: 'sonnet', effort: 'medium' }, ID, 100);
  const t = now() - 600;
  writeTranscript([
    cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5')),
    cmd(t + 1, 'effort', 'high'), ack(t + 1, EFFORT_ACK('high')),
  ]);
  expect(sync(NEXT)).toBe('rc=0');
  expect(h.reg(ID, 'class')).toBe('sonnet');
  expect(h.reg(ID, 'effort')).toBe('medium');
  expect(routeLines()).toEqual([]);
});
```

Add the following cases in the same describe; the failure families are distinct, not all called an absent transcript:

```ts
it.each(['absent', 'directory', 'reader-failed', 'unknown-model', 'drift', 'malformed'] as const)(
  'outgoing %s does not block UUID synchronization or write a marker', (kind) => {
    seed(); record({ class: 'fable' });
    const t = now() - 600;
    const file = writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    if (kind === 'absent') fs.rmSync(file);
    if (kind === 'directory') { fs.rmSync(file); fs.mkdirSync(file); }
    if (kind === 'unknown-model') writeTranscript([cmd(t, 'model', 'outside-vocabulary'), ack(t, MODEL_ACK('outside-vocabulary'))]);
    if (kind === 'drift') writeTranscript([cmd(t, 'model', 'opus'), ack(t, 'an unrecognised acknowledgement')]);
    if (kind === 'malformed') writeTranscript(['{not-json']);
    if (kind === 'reader-failed') {
      const dir = path.join(h.home, '.claude', 'sessions');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '424242.json'), JSON.stringify({ sessionId: NEXT }));
      expect(h.sh(`tmux() { printf '%s\\n' 424242; }; _operator_choice_read() { return 1; };
        _sync_uuid ${ID}; printf 'rc=%s' "$?"`)).toBe('rc=0');
    } else expect(sync(NEXT)).toBe('rc=0');
    expect(h.reg(ID, 'uuid')).toBe(NEXT);
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(routeLines()).toEqual([]);
    expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(false);
    if (kind === 'directory' || kind === 'reader-failed' || kind === 'drift') expect(swapLog()).toContain('operator-choice');
    if (kind === 'unknown-model') expect(swapLog()).toContain('outside the class vocabulary');
  },
);

it('non-Anthropic choice stays not applicable, without freezing its live UUID', () => {
  seed(); record({ class: 'fable' }); h.sh(`_reg_set ${ID} wrapper gpt`);
  const t = now() - 600;
  writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
  expect(sync(NEXT)).toBe('rc=0');
  expect(h.reg(ID, 'uuid')).toBe(NEXT);
  expect(h.reg(ID, 'class')).toBe('fable');
  expect(routeLines()).toEqual([]);
  expect(swapLog()).toBe('');
});
```

Add these controls to the same describe. The refusal cases substitute only the two admission verdicts and follow-call observers; the existing UUID and parity suites below exercise the real guards and readers. A proposed UUID that the current guard refuses is not a live rotation, even when the outgoing transcript contains an eligible choice. The accepted case also observes that the existing worker-follow memory is cleared before either follow path. These controls preserve main's behavior rather than widening this task into fork/background UUID promotion. The direct-promotion cases pin the shared extraction separately from `_sync_uuid`'s final unconditional rc 0:

```ts
it.each(['parked', 'superseded'] as const)(
  '%s pane does not promote, and both follow paths still run', (kind) => {
    seed(); record({ class: 'fable' });
    const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    const controls = `
      _ci_pane_parked() { return ${kind === 'parked' ? 0 : 1}; };
      _ci_pane_refused() { return ${kind === 'superseded' ? 0 : 1}; };
      _ci_bg_follow() { printf '%s\\n' background >> "$HOME/uuid-follow"; };
      _follow_continued_in() { printf '%s\\n' chain >> "$HOME/uuid-follow"; };`;
    expect(sync(NEXT, controls)).toBe('rc=0');
    expect(h.reg(ID, 'uuid')).toBe(UUID);
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(routeLines()).toEqual([]);
    expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(false);
    expect(fs.readFileSync(path.join(h.home, 'uuid-follow'), 'utf8').trim().split('\n'))
      .toEqual(['background', 'chain']);
  },
);

it('accepted pane rotation clears old worker memory before both follow paths', () => {
  seed(); record({ class: 'fable' });
  const t = now() - 600;
  writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
  const controls = `
    _CI_BG[${ID}]=worker; _CI_BGMISS[${ID}]=1;
    _CI_BGSID[${ID}]=old; _CI_BGADDRS[${ID}]=old;
    _ci_pane_parked() { return 1; }; _ci_pane_refused() { return 1; };
    _ci_bg_follow() {
      [[ -z "\${_CI_BG[$1]+set}" && -z "\${_CI_BGMISS[$1]+set}"
         && -z "\${_CI_BGSID[$1]+set}" && -z "\${_CI_BGADDRS[$1]+set}" ]] &&
        printf '%s\\n' background-cleared >> "$HOME/uuid-follow";
    };
    _follow_continued_in() { printf '%s\\n' chain >> "$HOME/uuid-follow"; };`;
  expect(sync(NEXT, controls)).toBe('rc=0');
  expect(h.reg(ID, 'uuid')).toBe(NEXT);
  expect(h.reg(ID, 'class')).toBe('opus');
  expect(routeLines()).toHaveLength(1);
  expect(fs.readFileSync(path.join(h.home, 'uuid-follow'), 'utf8').trim().split('\n'))
    .toEqual(['background-cleared', 'chain']);
});

it('missing live session JSON neither reads choice nor changes uuid', () => {
  seed(); record({ class: 'fable' });
  const t = now() - 600;
  writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
  expect(h.sh(`tmux() { printf '%s\\n' 424242; }; _sync_uuid ${ID}; printf 'rc=%s' "$?"`)).toBe('rc=0');
  expect(h.reg(ID, 'uuid')).toBe(UUID);
  expect(h.reg(ID, 'class')).toBe('fable');
  expect(routeLines()).toEqual([]);
  expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(false);
});

it('unchanged live uuid does not promote an otherwise eligible choice', () => {
  seed(); record({ class: 'fable' });
  const t = now() - 600;
  writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
  expect(sync(UUID)).toBe('rc=0');
  expect(h.reg(ID, 'uuid')).toBe(UUID);
  expect(h.reg(ID, 'class')).toBe('fable');
  expect(routeLines()).toEqual([]);
  expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(false);
});

it.each(['_operator_choice_promote', '_operator_choice_keep'] as const)(
  '%s keeps the shared refusal/floor behavior with its own marker responsibility', (fn) => {
    seed(); record({ class: 'fable' });
    const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    fs.rmSync(regFile(`${ID}.typed`));
    expect(h.sh(`${fn} ${ID}; printf 'rc=%s' "$?"`)).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toContain('unmeasured');
    expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(fn === '_operator_choice_keep');
  },
);

it.each(['_operator_choice_promote', '_operator_choice_keep'] as const)(
  '%s refuses a whole incompatible pair, never half a choice', (fn) => {
    seed(); record({ class: 'fable', effort: 'low' });
    const t = now() - 600;
    writeTranscript([
      cmd(t, 'model', 'haiku'), ack(t, MODEL_ACK('Haiku 5.5')),
      cmd(t + 1, 'effort', 'high'), ack(t + 1, EFFORT_ACK('high')),
    ]);
    expect(h.sh(`${fn} ${ID}; printf 'rc=%s' "$?"`)).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(h.reg(ID, 'effort')).toBe('low');
    expect(routeLines()).toEqual([]);
    expect(swapLog()).toContain('refused by the route record');
    expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(fn === '_operator_choice_keep');
  },
);

it.each(['_operator_choice_promote', '_operator_choice_keep'] as const)(
  '%s never opens a FIFO transcript', (fn) => {
    seed(); record({ class: 'fable' });
    const file = h.sh(`_transcript_path ${ID}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    h.sh(`mkfifo ${JSON.stringify(file)}`);
    const snippet = `source ${JSON.stringify(CCD)}; ${fn} ${ID}; printf 'rc=%s' "$?"`;
    const r = spawnSync('bash', ['-c', `${BOUNDED} 5 bash -c "$1"`, '_', snippet], {
      encoding: 'utf8', timeout: 15_000, killSignal: 'SIGKILL',
      env: ghContainedEnv(h.home, { ...inheritedEnv(), HOME: h.home }, { systemd: true, tmux: true }),
    });
    expect(r.error, 'outer bound exceeded').toBeUndefined();
    expect(r.status, 'a removed FIFO guard must time out, never hang the suite').toBe(0);
    expect(r.stdout.trim()).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toContain('not a readable regular file');
    expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(fn === '_operator_choice_keep');
  },
);

it.each(['_operator_choice_promote', '_operator_choice_keep'] as const)(
  '%s returns zero and reports missing Python and a failed reader', (fn) => {
    seed(); record({ class: 'fable' });
    const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    expect(h.sh(`command() { [[ "$*" == '-v python3' ]] && return 1; builtin command "$@"; };
      ${fn} ${ID}; printf 'rc=%s' "$?"`)).toBe('rc=0');
    expect(h.sh(`_operator_choice_read() { return 1; }; ${fn} ${ID}; printf 'rc=%s' "$?"`)).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(routeLines()).toEqual([]);
    expect(swapLog()).toContain('unmeasured (no python3)');
    expect(swapLog()).toContain('unmeasured (the transcript reader failed)');
    expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(fn === '_operator_choice_keep');
  },
);
```

- [ ] **Step 2: Run the live-rotation describe red, before changing ccd.**

From `server/`:

```bash
./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts -t 'live UUID rotation' --maxWorkers=1
```

Expected red: UUID changes, but the outgoing class/effort are not promoted. Existing failure/skip controls may already be green. Save the actual failing case names and output; no forecast case count is an execution result.

- [ ] **Step 3: Extract the promotion body once; keep marker ownership at the existing keep.**

Replace the current `_operator_choice_keep` header/initial lines with this wrapper, then rename the existing remainder to `_operator_choice_promote`. Keep the existing promotion body and its authoritative history comments verbatim, except the route reason's suffix:

```bash
_operator_choice_keep() {   # id - a dead session's choice is read once before its next spawn. Always 0.
  local id="$1"
  [[ -f "$REG/$id.uuid" ]] || return 0
  _reg_set "$id" choicekept "$(date +%s)" 2>/dev/null || true
  _operator_choice_promote "$id" "kept across a restart"
  return 0
}

_operator_choice_promote() {   # id [reason] - read the CURRENT registry UUID's transcript; never write choicekept. Always 0.
  local id="$1" reason="${2:-kept across a restart}" f typed why="" out kind val at n field want fm shown drift=0
  local -a sets=() kinds=()
  [[ -f "$REG/$id.uuid" ]] || return 0
  _is_anthropic_backend "$(_reg_get "$id" wrapper)" || return 0
```

The existing statements from `typed=$(_reg_get "$id" typed)` through the final `return 0` remain in `_operator_choice_promote`. Change only this existing route-call line within that body:

```bash
    ( cmd_route --session "$id" "${sets[@]}" --actor operator-session --reason "its own /${kinds[0]%%:*}${kinds[1]:+ and /${kinds[1]%%:*}}, $reason" ) >/dev/null 2>&1 \
```

No second transcript parser, no per-field route calls, no new class vocabulary and no direct route-file writes. Retain the existing comment explaining why the non-Anthropic choice is skipped and the comments on the mtime-before-drift and merged-pair checks.

Current main has expanded `_sync_uuid`; its old baseline-sized conditional is no longer an edit target. Within the EXISTING pane-session-file block, retain the admission condition and add promotion to its UUID-write line, before that write. The resulting excerpt is:

```bash
    if [[ -n "$sid" && "$sid" != "$(_reg_get "$id" uuid)" ]] \
       && ! _ci_pane_parked "$id" "$cfg" "$cfg/sessions/$pid.json" \
       && ! _ci_pane_refused "$id" "$cfg" "$cfg/sessions/$pid.json" "$sid"; then
      _operator_choice_promote "$id" "kept before a uuid rotation"; _reg_set "$id" uuid "$sid"
      unset "_CI_BG[$id]" "_CI_BGMISS[$id]" "_CI_BGSID[$id]" "_CI_BGADDRS[$id]"
    fi
  fi
  _ci_bg_follow "$id" "$cfg"
  _follow_continued_in "$id" "$cfg"
  return 0
```

The outer pane-file check and sessionId read stay unchanged; this is an excerpt, not a replacement of the whole function. Promotion runs only after both current admission guards permit a genuine pane rotation. Do not move it above those guards or after the registry write. Keep worker-memory clearing and both follow calls exactly where they are; continuation/background-driven writes acquire no new promotion side effect. Correct the existing comment's `/clear, compaction` claim in place to name `/clear` only; observed compaction stays in the same transcript. Update the parser's caller comment to name shared promotion and read-back, without inventing a third parser. Above the frozen citation boundary, keep prose edits length-neutral; below it, use clear comments rather than padded line-number tricks.

- [ ] **Step 4: Stamp, pay citation/census gates, and run the whole owning suite green.**

Run the shared generated-byte and citation procedures on the task's actual parent/tree. Then from `server/`:

```bash
./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-sync-uuid.test.ts test/continued-in-parity.test.ts test/continued-in-successor-parity.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-route-apply.test.ts test/ccd-route-settle.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-swap.test.ts test/ccd-archive.test.ts test/ccd-spawn-split.test.ts --maxWorkers=1
```

If any named neighboring file has been renamed on current main, locate its source owner and update this plan with the concrete replacement before dispatch; do not silently skip the gate.

- [ ] **Step 5: Measure the mutations, restore only this task's bytes, and rerun green.**

| Mutation | Owning case that must turn red |
|---|---|
| Delete `_operator_choice_promote` from `_sync_uuid` | Old transcript pair promoted before UUID change |
| Move promotion after `_reg_set ... uuid` | Old transcript pair; new UUID has no outgoing commands |
| Call `_operator_choice_keep` rather than marker-free promotion | No-marker rotation; two rotations then restart |
| Remove `choicekept` during rotation | Existing marker's bytes/mtime unchanged |
| Split the combined pair into one `cmd_route` per field | Haiku/low to Opus/high pair, one route operation |
| Remove journal matching from shared promotion | ccd-typed commands excluded during rotation |
| Remove route-field mtime precedence | Newer route fields win during rotation |
| Return the reader's failure rather than always 0 | Failed-reader synchronization and direct promotion rc |
| Move promotion above the pane-admission guards | Parked/superseded pane leaves route unchanged |
| Remove each of `_ci_pane_parked` and `_ci_pane_refused` from admission in separate trials | Matching refusal case; existing real-guard UUID suite |
| Drop worker-follow memory clearing after accepted pane rotation | Accepted-pane case observes cleared memory before follow |
| Drop each of `_ci_bg_follow` and `_follow_continued_in` in separate trials | Both follow-call observations; existing UUID/parity gates |

Each row requires an observed RED, not a comment that a test would fail. Keep the old stop/spawn marker census and its behavior cases intact. Restore the task's original mutation bytes, restamp, and rerun the affected cases green before committing.

- [ ] **Step 6: Commit Task 3 alone after its fresh reviewer gate.**

Stage only this task's source, tests, genuinely moved census/README anchors and its measured plan evidence. Commit subject: `fix(ccd): preserve outgoing operator choice before UUID rotation`. End the commit with the mandated attribution. Do not claim the unchanged UUID or failed-reader controls prove outgoing-choice success; name the pair and two-rotation cases that actually exercise it.

### Task 4: Count direct pressure kills and document the shipped measurement contract

This task completes spec section 9's FIRST stage-6 metric, carried explicitly from wave 4. A Claude Code notification that its reaper stopped a background shell is not a kernel pane-scope OOM stop. Neither substitutes for the other. Task 1 already owns freshness and the B-relative withdrawal boundary in the FIRST commit; do not move those fixes into this task.

**Files:**
- Modify: `deploy/measure-continuity.py` (one direct-pressure section, stage-6 composition, instrument and stage-7 comments).
- Create: `server/test/measure-continuity-pressure-kills.test.ts`.
- Modify: `README.md` (the existing operator-choice and pane-scope-sweep sections).
- Modify: `docs/superpowers/specs/2026-09-23-session-continuity-design.md` (labelled wave-4b as-built annotations, not rewritten historical rulings).
- Verify: `server/test/measure-continuity-stage6.test.ts`, `server/test/measure-continuity-stage7.test.ts`; their existing output keys and gates remain.

**Interfaces:**
- Consumes: `transcripts(ctx)`, the existing main-transcript discovery and largest-copy-per-UUID selection; `--all-copies` reads every discovered copy. `iso_epoch` and `in_window` retain inclusive since/exclusive until semantics.
- Produces: `s6_pressure_kills(ctx) -> dict`, under `stage6.direct_pressure_kills`. With discovered input it returns `reading: 'measured'|'partial'`, `killed_background_tasks`, `transcript_uuids_with_kills`, `transcripts_read`, `unreadable_transcripts`, `malformed_rows` and `unmeasured_notifications`. Without discovered input it returns ONLY `{transcripts: 'absent'}`. A partial or absent read is not a clean zero.
- Count unique `(transcript UUID, task ID)` pairs across the selected copies. The same task ID in two UUIDs is two tasks; repeated notifications and copies of one UUID are one. No registry UUID lookup: historical transcripts survive a live `/clear`.
- Recognise a complete user-message task-notification envelope with one task ID, one `status=killed` and one summary whose whole value has the verified background-command prefix and low-memory suffix. Do not search assistant prose, a tool-result quotation, arbitrary user prose or a note's phrase as if each were an event. `isMeta` is not required: the inspected runtime's queue-to-transcript metadata was not proven.
- Coverage is the discovered MAIN transcripts, not every file that ever existed. The existing `transcripts` adapter silently skips stat failures and glob cannot establish a readable roster of every root; the largest-copy default can hide a divergent smaller copy, and subagent transcripts are outside its pattern. These are declared discovery limits, not a claim of exhaustive fleet health. This task preserves that adapter and all earlier stages; it does not build a new transcript inventory.

**Evidence behind the fixture.** Static inspection of Claude Code 2.1.296 on 2026-10-14 traced the pressure-reap caller to its notification formatter: internal `status: killed`, `stopCause: memory_pressure`; final `<status>killed</status>`; summary `Background command "<description>" was stopped because the system is running low on memory`; optional tool-use/output-file fields; explanatory `<note>`, not a reason element. The formatter escapes ampersands and angle brackets in summary/body, not double quotes. This proves the constructed notification string, not live eventual transcript rendering. The historical `reaper/classify_kills.py` evidence pointer is not a shipped parser and was not located in this checkout; do not pretend its historical count is replay-verified by this task.

- [ ] **Step 1: Add the complete fixture-contained scanner contract.**

Create this test file. Its factory places main transcripts under the fixture HOME, never the live registry. It asks stage 6 for a fixture journal, so even these scanner-only cases never run live journalctl. Every process has a bound and inherits a Git-clean environment.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/measure-continuity.py');
const T = Date.parse('2026-10-14T12:00:00Z') / 1000;
const U1 = 'deadbeef-0000-4000-8000-000000000001';
const U2 = 'deadbeef-0000-4000-8000-000000000002';
let h: CcdHarness;
type Reading = {
  transcripts?: 'absent'; reading?: 'measured' | 'partial';
  killed_background_tasks?: number; transcript_uuids_with_kills?: number;
  transcripts_read?: number; unreadable_transcripts?: number;
  malformed_rows?: number; unmeasured_notifications?: number;
};
beforeEach(() => {
  h = makeCcdHarness('ccrc-measure-pressure-');
  fs.writeFileSync(path.join(h.home, 'journal.json'), '');
  fs.mkdirSync(path.join(h.home, 'xdg'));
});
afterEach(() => { h.cleanup(); });
const iso = (t: number): string => new Date(t * 1000).toISOString();
const escapeText = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const note = (task: string, status = 'killed', reason = 'stopped because the system is running low on memory'): string =>
  `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>toolu_fixture</tool-use-id>\n<output-file>/tmp/fixture.output</output-file>\n<status>${status}</status>\n<summary>${escapeText(`Background command "watch <x> & y" was ${reason}`)}</summary>\n<note>Fixture explanation; the scanner does not parse this wording.</note>\n</task-notification>`;
const row = (text: string, t: number = T): string => JSON.stringify({
  type: 'user', timestamp: iso(t), message: { role: 'user', content: text },
});
const transcript = (uuid: string, lines: string[], root = '.claude', project = '-project-a'): string => {
  const dir = path.join(h.home, root, 'projects', project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${uuid}.jsonl`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  // Discovery uses mtime before row timestamps; do not depend on the runner's clock.
  fs.utimesSync(file, T + 86400, T + 86400);
  return file;
};
const read = (extra: string[] = []): Reading => {
  const out = execFileSync('python3', ['-I', TOOL, '--home', h.home, '--stage', '6',
    '--journal', path.join(h.home, 'journal.json'), '--json', ...extra], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...inheritedEnv(), HOME: h.home, TZ: 'UTC', XDG_RUNTIME_DIR: path.join(h.home, 'xdg') },
  });
  const result = JSON.parse(out) as { stage6: { direct_pressure_kills?: Reading; reap_class_oom: unknown; inert_scopes: unknown } };
  expect(result.stage6.reap_class_oom).toBeDefined();
  expect(result.stage6.inert_scopes).toBeDefined();
  expect(result.stage6.direct_pressure_kills, 'the direct metric is composed into stage 6').toBeDefined();
  return result.stage6.direct_pressure_kills!;
};
const clean = (kills: number, uuids: number, files: number): Reading => ({
  reading: 'measured', killed_background_tasks: kills, transcript_uuids_with_kills: uuids,
  transcripts_read: files, unreadable_transcripts: 0, malformed_rows: 0, unmeasured_notifications: 0,
});

describe('direct background-shell pressure kills, not pane-scope OOM stops', () => {
  it('recognises the verified killed-summary shape, not ordinary completion or an operator stop', () => {
    transcript(U1, [row(note('b1')), row(note('b2', 'completed', 'completed')),
      row(note('b3', 'killed', 'stopped'))]);
    expect(read()).toEqual(clean(1, 1, 1));
  });

  it.each([false, true])('deduplicates UUID/task pairs across repeated notifications and copies (all=%s)', (all) => {
    transcript(U1, [row(note('same')), row(note('same')), row(note('other'))]);
    transcript(U1, [row(note('same'))], '.claude-copy', '-project-b');
    transcript(U2, [row(note('same'))]);
    expect(read(all ? ['--all-copies'] : [])).toEqual(clean(3, 2, all ? 3 : 2));
  });

  it('the existing largest-copy trade is visible; all-copies recovers a divergent shorter copy', () => {
    transcript(U1, [row('x'.repeat(2000))]);
    transcript(U1, [row(note('only-shorter'))], '.claude-copy', '-project-b');
    expect(read()).toEqual(clean(0, 0, 1));
    expect(read(['--all-copies'])).toEqual(clean(1, 1, 2));
  });

  it('since is inclusive, until exclusive; a task started earlier can be killed in the window', () => {
    transcript(U1, [row(note('before'), T - 1), row(note('edge'), T),
      row(note('inside'), T + 1), row(note('until'), T + 86400)]);
    expect(read(['--since', '2026-10-14 12:00:00', '--until', '2026-10-15 12:00:00']))
      .toEqual(clean(2, 1, 1));
  });

  it('ignores quoted prose, assistant text and tool-result text; string/text user content both work', () => {
    const text = note('quoted');
    transcript(U1, [row(`An example, not a notification: ${text}`),
      JSON.stringify({ type: 'assistant', timestamp: iso(T), message: { role: 'assistant', content: [{ type: 'text', text }] } }),
      JSON.stringify({ type: 'user', timestamp: iso(T), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: text }] } }),
      JSON.stringify({ type: 'user', timestamp: iso(T), message: { role: 'user', content: [{ type: 'text', text: note('real') }] } })]);
    expect(read()).toEqual(clean(1, 1, 1));
  });

  it('JSON escaping is decoded before classification; metadata is not a guessed applicability gate', () => {
    const json = row(note('escaped')).replaceAll('<', '\\u003c');
    transcript(U1, [json, JSON.stringify({ type: 'user', isMeta: true, timestamp: iso(T),
      message: { role: 'user', content: note('meta') } })]);
    expect(read()).toEqual(clean(2, 1, 1));
  });

  it('a low-memory phrase in a note or description is not the verified summary suffix', () => {
    transcript(U1, [row(note('not-pressure', 'killed', 'stopped')
      .replace('Fixture explanation;', 'stopped because the system is running low on memory;')),
      row(note('not-killed', 'completed')),
      row(note('described', 'killed', 'stopped').replace('watch &lt;x&gt; &amp; y',
        'stopped because the system is running low on memory'))]);
    expect(read()).toEqual(clean(0, 0, 1));
  });

  it('no discovered transcripts is absent, not a clean zero', () => {
    expect(read()).toEqual({ transcripts: 'absent' });
  });

  it('a discovered file that cannot be opened is partial, with the readable count still explicit', () => {
    transcript(U1, [row(note('good'))]);
    const dir = path.join(h.home, '.claude', 'projects', '-project-a', `${U2}.jsonl`);
    fs.mkdirSync(dir); // EISDIR is deterministic even as root; chmod is not.
    expect(read()).toEqual({ ...clean(1, 1, 1), reading: 'partial', unreadable_transcripts: 1 });
  });

  it('malformed JSON, missing timestamp and ambiguous notification fields remain unmeasured', () => {
    const noTime = JSON.stringify({ type: 'user', message: { role: 'user', content: note('no-time') } });
    transcript(U1, ['not-json', noTime, row(note('duplicate').replace('<status>killed</status>',
      '<status>killed</status>\n<status>completed</status>')), row(note('good'))]);
    expect(read()).toEqual({ ...clean(1, 1, 1), reading: 'partial', malformed_rows: 1, unmeasured_notifications: 2 });
  });
});
```

The ordinary notification fixture has optional fields, escaped description text, and a note deliberately different from the real explanatory wording. Only the verified status/summary contract decides a pressure kill. A hand-typed user message that EXACTLY imitates a complete runtime envelope is indistinguishable here; this is a read-only observational counter, not authenticated proof that a process died. Do not add an unverified `isMeta` requirement to hide that limitation.

- [ ] **Step 2: Run the new suite red before adding the scanner.**

From `server/`, foreground:

```bash
./node_modules/.bin/vitest run test/measure-continuity-pressure-kills.test.ts --maxWorkers=1
```

Expected: the direct metric is absent from stage 6. Capture the actual failures. No installed Claude Code process is spawned by this suite, and no pressure condition is induced on the box.

- [ ] **Step 3: Add the direct scanner without changing earlier discovery semantics.**

Place these constants/functions beside stage 6. No XML dependency is needed: match the complete envelope and its required field cardinalities after JSON decoding. The summary is matched as escaped text; its quoted description may contain escaped markup, quotes or newlines. The low-memory suffix must be the reason, not merely text somewhere inside it.

```python
S6_NOTIFICATION = re.compile(r"<task-notification>\s*(.*?)\s*</task-notification>", re.S)
S6_TASK_ID = re.compile(r"<task-id>([A-Za-z0-9_-]+)</task-id>")
S6_STATUS = re.compile(r"<status>([^<>]*)</status>")
S6_SUMMARY = re.compile(r"<summary>([^<>]*)</summary>", re.S)
S6_PRESSURE_SUMMARY = re.compile(
    r'Background command ".*" was stopped because the system is running low on memory', re.S
)


def s6_notification_texts(row):
    if not isinstance(row, dict) or row.get("type") != "user":
        return []
    msg = row.get("message")
    if not isinstance(msg, dict) or msg.get("role") != "user":
        return []
    content = msg.get("content")
    if isinstance(content, str):
        return [content]
    if isinstance(content, list):
        return [part["text"] for part in content
                if isinstance(part, dict) and part.get("type") == "text"
                and isinstance(part.get("text"), str)]
    return []


def s6_pressure_kills(ctx):
    paths = transcripts(ctx)
    if not paths:
        return {"transcripts": "absent"}
    hits = set()
    read = unreadable = malformed = unmeasured = 0
    for path in paths:
        uuid = os.path.basename(path)[:-len(".jsonl")]
        file_hits = set()
        file_malformed = file_unmeasured = 0
        try:
            with open(path, "rb") as fh:
                for raw in fh:
                    try:
                        row = json.loads(raw)
                    except (ValueError, UnicodeError):
                        file_malformed += 1
                        continue
                    for text in s6_notification_texts(row):
                        text = text.strip()
                        if not text.startswith("<task-notification>"):
                            continue
                        at = iso_epoch(row.get("timestamp"))
                        # A readable timestamp outside the requested window is no event in it.
                        if at is not None and not in_window(at, ctx):
                            continue
                        envelope = S6_NOTIFICATION.fullmatch(text)
                        if not envelope:
                            file_unmeasured += 1
                            continue
                        body = envelope.group(1)
                        ids = S6_TASK_ID.findall(body)
                        statuses = S6_STATUS.findall(body)
                        if at is None or len(ids) != 1 or len(statuses) != 1:
                            file_unmeasured += 1
                            continue
                        status = statuses[0]
                        if status not in ("completed", "failed", "killed"):
                            file_unmeasured += 1
                            continue
                        if status != "killed":
                            continue
                        summaries = S6_SUMMARY.findall(body)
                        if len(summaries) != 1:
                            file_unmeasured += 1
                            continue
                        if S6_PRESSURE_SUMMARY.fullmatch(summaries[0]):
                            file_hits.add((uuid, ids[0]))
            read += 1
        except OSError:
            unreadable += 1
            continue
        hits.update(file_hits)
        malformed += file_malformed
        unmeasured += file_unmeasured
    return {
        "reading": "partial" if unreadable or malformed or unmeasured else "measured",
        "killed_background_tasks": len(hits),
        "transcript_uuids_with_kills": len({uuid for uuid, _ in hits}),
        "transcripts_read": read,
        "unreadable_transcripts": unreadable,
        "malformed_rows": malformed,
        "unmeasured_notifications": unmeasured,
    }
```

The file's hits are admitted only after its read reaches EOF. A read failure drops that file's partial hits and increments `unreadable_transcripts`; readable files' counts remain. Malformed JSON rows are counted even when their time cannot be placed, so any such row makes the reading partial rather than silently deciding it was outside the interval. There is no guessed background-start requirement: the kill is in the window by its notification timestamp even when its shell started earlier. Historical notification timestamps are delivery observations, not a measured kernel kill instant.

In Task 1's `stage6`, widen the existing `out` literal only:

```python
    out = {
        "reap_class_oom": reading,
        "inert_scopes": s6_inert(),
        "direct_pressure_kills": s6_pressure_kills(ctx),
    }
```

Keep the optional `pressure_reap_comparison` block as it is; it consumes `reading` from `s6_reap`, never `killed_background_tasks`. Keep STAGES, earlier CLI options, issue #317's copy counters and existing stage outputs unchanged. No marker, environment assignment or process action is written by the scanner.

- [ ] **Step 4: Document the new behavior in its existing README sections.**

Make these focused edits by content, after re-reading the task-parent README:

1. After the paragraph ending `revival reads.`, add this operator-choice paragraph; do not delete the stop/spawn marker description:

```markdown
Before a live UUID change, `_sync_uuid` promotes the outgoing transcript's acknowledged operator `/model`
and `/effort` through the same parser and one combined route operation, BEFORE replacing the registry UUID.
This includes `/clear`, which starts a new transcript; compaction keeps the existing transcript. The live
promotion neither creates nor removes `choicekept`: that marker still means a dead session was read before
its next spawn. A command ccd journalled is excluded, a newer route-field write wins, and unavailable or
unrecognised input is logged without blocking UUID synchronisation. Non-Anthropic operator-choice semantics
remain skipped; this is not the applicability rule for the pressure-reap environment variable.
```

2. Remove ONLY the two-line `/clear` item from `Known silent costs`, replacing its historical deferral with the paragraph above. Keep every other cost, including the interrupted-stop marker and unrostered source.
3. Replace the stage-7 explanation beginning `counts the writes, the stops` through its `over-count by design` with:

```markdown
counts promotion writes and logged model refusals, not measured restarts. The existing
`restarts_that_reverted_an_operator_model` key is retained: it sums outside-vocabulary and route-refused
`/model` lines from dead-session keeps AND live UUID promotions. A refusal may repeat on a later promotion,
and a live rotation need not be followed by a stop or restart. `stops_that_could_not_read_the_transcript`
likewise retains its name but counts `unmeasured` lines from both paths. These are conservative observation
counters, not distinct commands, sessions, stops or restarts; non-Anthropic choices still produce no line.
```

4. In `Pane-scope sweep`, replace the claim that uncertainty copies the previous verdict with:

```markdown
An unmeasurable predicate writes a `carry` row with its reason and `state=dead|live|unknown`, plus a bounded
prior `first`/`cpu0` pair if there is one (`none`/`none` otherwise). It is not a newly measured dead verdict
and cannot authorize a stop this tick. A clock carried through uncertainty is reusable only after a later
tick measures EVERY predicate again; an implausible clock starts again. Child-cgroup uncertainty is
`unknown` because it is checked before liveness; a known-live parent-walk cap is `live`. Measured live
scopes otherwise reset the dead clock. A zombie outside child does not block; a live outside child does.
```

5. Widen its record/doctor paragraph to three row kinds, and add:

```markdown
Doctor validates the whole body before giving ordinary scope advice. Malformed, future or stale records
warn and ask for a new measurement, not a stop. Dead/unknown carries warn without destructive advice;
a carry-only live record has a qualified PASS excluding the unmeasured scopes. Mixed records limit stop
advice to measured dead rows. A paused sweep is silent. The sweep checks temporary open, header, body and
rename results, preserving the previous complete record if replacement fails; that is not rollback of a
stop already accepted by an armed manager. The stop remains shadowed until the operator arms it.
```

6. Replace its short stage-6 paragraph with:

```markdown
`deploy/measure-continuity.py --stage 6` reports three DIFFERENT measurements: direct background-shell
pressure-kill notifications in `direct_pressure_kills` (target 0 after the spawn variable), kernel
pane-scope OOM stops in `reap_class_oom`, and NOW's fresh sweep record in `inert_scopes`. Direct kills are
unique transcript-UUID/task-ID pairs, deduplicated across selected copies. The default reads the largest
discovered main transcript per UUID; `--all-copies` includes divergent smaller copies but still counts
one task once. Discovery can miss unreadable roots/stat failures and excludes subagent transcripts;
partial reads and absent input are reported, never claimed as a clean zero. Notification times are
observations at delivery, not exact kill instants.

The frozen baseline B is the pane-OOM reap-class count with the reap still enabled. A read-only
`--reap-baseline B` comparison requires stage 6 alone and an explicit seven-day interval: observed
reap-class OOMs ABOVE B + 2 means withdraw the spawn assignment through a follow-up release. At B + 2 it
is `not-triggered`, not a health verdict; raw pane stops, unmapped and unmeasured classifications remain
beside it. Direct pressure kills do not feed that comparison. The variable is
`CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` in ccd's child spawn environment, primary AND resume-retry,
including an external-provider wrapper that execs Claude Code. Deploying it does not retrofit existing
panes. Assignment and any subsequent removal take effect at each session's NEXT ordinary start; no
forced fleet restart is part of this change. An aggregate slice `MemoryHigh` must never return.
```

Use generic examples only. Existing live line citations are repaired by the shared citation procedure, not by padding the new prose.

- [ ] **Step 5: Add labelled as-built spec annotations, preserving the approved decisions.**

Append a dated wave-4b annotation to section 5.6 after its existing named trade, with these facts: child-scoped primary/retry assignment; all currently supported spawn targets exec Claude Code; report/shadow remains; carry grammar and freshness distinctions; direct notification metric separate from kernel OOM; exclusive B + 2 comparison; next-start deployment/removal effect; discovery limits. Do not amend the historical 186/44 measurement into a claim that this scanner reproduced it.

In section 5.7, replace ONLY the `/clear` deferred-cost clause with `D-3925 is closed by wave 4b: _sync_uuid promotes the outgoing transcript before replacing its UUID, with no choicekept mutation; compaction does not change the transcript.` Preserve the remaining clauses. Follow the historical wave-3 paragraph with a labelled wave-4b annotation explaining that both live promotions and dead keeps use the same parser/floor/filter/mtime/pair writer and stage-7 log stream, so the existing keys now include live promotions rather than actual restart counts. In section 9, annotate stage 6's direct metric and the broadened stage-7 observation interpretation; preserve target 0 and the historical baseline cells. Update only the document's revision note to identify this as an as-built amendment, not a new operator ruling.

In the instrument's stage-6 comments, state each of its three sections, their time bases, known discovery limits and the fact that comparison makes no mutation. In stage-7's comment, replace its stops-only claim with the same live-promotion overcount explanation. Do not rename old output keys or rewrite the stage-7 scanner in this task.

- [ ] **Step 6: Run owning and earlier-stage compatibility gates green.**

From `server/`, one foreground process at a time:

```bash
./node_modules/.bin/vitest run test/measure-continuity-pressure-kills.test.ts test/measure-continuity-stage6.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/measure-continuity-stage7.test.ts test/measure-continuity-stage4.test.ts --maxWorkers=1
```

Run the existing stage-1 suite, `./node_modules/.bin/vitest run test/measure-continuity.test.ts --maxWorkers=1`, too before committing. All previous keys, issue #317 counters and window semantics remain. Parse the Python with `python3 -I -c "import ast; from pathlib import Path; ast.parse(Path('deploy/measure-continuity.py').read_text())"` from the workspace root. Run `git diff --check`.

- [ ] **Step 7: Mutate the direct scanner's guards, restore green, and commit after the fresh reviewer.**

| Mutation | Required red fixture |
|---|---|
| Remove direct metric from stage6 composition | Direct section assertion |
| Drop UUID from the dedupe pair | Same task ID in two UUIDs |
| Count rows/copies rather than unique task pairs | Repeated notification and all-copies |
| Remove status=killed requirement | Completed notification with low-memory summary |
| Search the phrase anywhere instead of the summary's whole reason | Note and description controls |
| Parse raw JSON bytes rather than decoded user content | Escaped JSON and assistant/tool-result controls |
| Require `isMeta` on every notification | Verified-shaped row without guessed metadata |
| Make until inclusive or since exclusive | Exact endpoint cases |
| Fold absent or read failure into a measured zero | Absent and deterministic EISDIR cases |
| Silently drop malformed JSON/missing time/duplicate status | Partial-reading case |

Record each actual red and restored green. No runtime kill is needed or permitted for these mutations. Commit subject: `feat(continuity): count direct pressure-kill notifications and document wave 4b`. Include only the scanner/test/docs and measured evidence; no copied runtime bundle, private evidence path or historical script enters the PR.

### Task 5: Coordinator acceptance, updater observation and the post-variable week

**Owner: the coordinator, after the worker hands off Tasks 1-4.** This is not a worker dispatch item and is not permission to deploy, restart, arm a marker or change updater intent. The worker stops at its PR and one wave-done. The coordinator records each pending observation and its due instant in the programme ledger; a healthy source tree is not evidence about a running pane.

**Files:**
- Modify: `docs/superpowers/programs/session-continuity.md` (verified acceptance, observed update/exposure, dated readings and follow-up ownership).
- Read: the accepted plan, work/review run records, the accepted GitHub PR/checks, and updater inventory.
- Execute read-only: the INSTALLED `deploy/measure-continuity.py`, after verifying its release contains this wave.

**Interfaces:**
- Worker handoff: its exact `{branchTip, prNumber, prPhase, handoffCommit}`; branchTip and handoffCommit are the SAME measured 40-hex tip. `runs advance` carries both `to` and `fingerprint`; the server's answer decides the transition.
- Review: a new `kind:'review'` run naming work run 308. Its accepted `{reviewedTip, report}` is the review-close evidence; worker fingerprint is not substituted for it.
- Updater: authenticated PWA `GET /api/updates`, session-only, not the box token. The closed `ccrc-api` has NO updates verb. Observe the existing PWA session or its same-origin authenticated browser fetch; a 401 is an unmeasured protected projection, not permission to bypass auth.
- Exposure: `ccrc-api lifecycle list --session <id>` returns `{events, gaps}`. An `act:'spawn'`, `outcome:'done'`, non-null `at` (epoch milliseconds) after the fleet node converged is evidence of an ordinary post-install spawn, subject to gaps and clock precision. It is NOT a direct environment read. No current public API proves every live child's environment.
- Measurement: `TZ=UTC python3 -I "$HOME/ccrc/deploy/measure-continuity.py" --stage 6 --since "$since" --until "$until" --reap-baseline 0 --all-copies --json`. Both endpoints are explicit, exactly seven days apart; use the observed fleet deployment instant, never release publication or merge time.

- [ ] **Step 1: Verify the worker handoff and dispatch the separate acceptance review.**

Re-derive identity with `"$HOME/.local/bin/ccrc-api" whoami`, list outstanding mail, fetch and ack by delivery ID, and re-read run 308. Re-measure the claimed workspace branch tip and PR phase without reading the worker diff as your own acceptance review. Submit the SAME fingerprint the worker claimed to `runs advance 308`, with `to:'awaiting-review'`. A mismatching tip or a refusal is not patched by combining old handoffCommit with a fresh branchTip.

Open a separate review run with `kind:'review'`, `reviews:308`, programme `session-continuity`, and fresh identity. Its brief names the measured worker branch, this plan, Tasks 1-4, exact suite commands from the final branch gates, the issued block, and the held-out panel: three fresh Opus/high correctness, spec-conformance and does-it-reproduce lenses, with three fresh Sonnet/high refuters per finding. A finding survives unless two refuters kill it. Dead/empty lenses remain unverified; all-dead refuters remain unexamined. The whole-branch pass checks carry authority/readers, the complete FIRST residue, primary/retry applicability, outgoing-UUID ordering and marker lifecycle, direct kills versus OOM, generated/citation debt and public text. End the turn after dispatch; do not poll the reviewer.

On review-done, close the review run with its own `{reviewedTip, report}` and rule on the report the server accepted. A stale-review refusal requires a new review at the live tip. Fixes return to the worker through recorded mail; a changed tip is reviewed again. Read the selected CI summary too: a green PR proves only the files it actually ran, not the entire suite. Independent acceptance does not grant authority to merge; use the programme's standing merge authority only if it is still in force, otherwise report the accepted PR for the operator's merge. No settings, branch protection, automatic merge or bypass change is part of this plan.

- [ ] **Step 2: Observe the existing updater, without driving it by hand.**

After the accepted commit merges and a release exists, inspect the PWA's current updater inventory once. If an authenticated browser is available, this same-origin function projects only the fields needed for convergence; it does not read or print cookies, tokens, the optional box-token view or whole node details:

```js
async () => {
  const response = await fetch('/api/updates', { credentials: 'same-origin' });
  if (!response.ok) return { measured: false, status: response.status };
  const view = await response.json();
  if (!Array.isArray(view.nodes)) return { measured: false, reason: 'nodes-unreadable' };
  return {
    measured: true,
    nodes: view.nodes.map((node) => ({
      nodeId: node.nodeId, role: node.role, reachable: node.reachable,
      measuredAt: node.measuredAt, stampRead: node.stampRead,
      current: node.current, desiredTag: node.desiredTag,
      installState: node.installState, provenance: node.provenance,
      report: node.report && {
        phase: node.report.phase, target: node.report.target,
        startedAt: node.report.startedAt, updatedAt: node.report.updatedAt,
      },
      update: node.update && {
        state: node.update.state, target: node.update.target, startedAt: node.update.startedAt,
      },
    })),
  };
}
```

Check every required node, fleet first: reachable, a fresh inventory measurement, stamp read `ok`, current build carrying the accepted commit, complete install, verified provenance, and no unresolved failed/reverted report. A desired tag, release catalogue entry or completed updater report alone proves none of these. Use `ccrc version` read-only on the box already available to this session as a second check of the installed stamp and install record; do not pretend it measures the other box. Record only neutral node roles/tags/commit identifiers publicly, not private labels, coordinates or node identity mappings.

A projection that is unavailable, stale, unsigned, incomplete, unreachable, failed or reverted is recorded as exactly that and reported to the updater programme/operator. Do not invoke `update`, `rollout`, `rollback`, fallback deploy, POST refresh/apply/intent/ack, a service restart or an agent update operation to make it green. Later notifications or the next operator-requested observation can remeasure; no sleep-poll loop. The fleet deployment instant is the measured first successful convergence observation, with its precision stated; record the report's times separately rather than claiming they are the exact point every pane inherited the variable.

- [ ] **Step 3: Record exposure separately from convergence.**

Record the baseline B unchanged: the frozen inclusive/exclusive interval in `In short`, B=0, 34 pane stops, 5 unmapped and 4 unmeasured. Do not rerun it against today's UUIDs, shorten its extra minute to fit the new comparison CLI, or replace it with the direct-kill count.

For a session whose ordinary next start is observed through the lifecycle client, record the non-null spawn time, accepted installed build and whether lifecycle gaps affect it. Existing panes that have no observed ordinary start after convergence remain pre-variable/unknown exposure; a live `/clear` is a transcript rotation, not a process start. A post-install spawn with a gap or undecidable time is unmeasured. The executable code and lifecycle event establish expected applicability, not directly measured process environment. If no safe read surface proves the live variable, say `environment unmeasured`; never dump `/proc/*/environ`, a process command line, credential files or tmux state to replace that missing proof.

Deployment and the target-0 reading must always carry this exposure qualification. Do not delay the fleet-level first post-deploy week indefinitely until all sessions restart, and do not force them to restart to obtain a cleaner experiment. Long-lived pre-variable panes are a named confound, not a defect to erase by changing fleet state.

- [ ] **Step 4: Measure the first complete post-deploy week once it is due.**

At observed fleet convergence, calculate and record the UTC endpoints and due time from that measured instant. The following calculation takes a measured epoch in SECONDS as its positional argument; it introduces no example deployment date as an assertion:

```python
import datetime
import sys
start = int(sys.argv[1])
for name, at in (("since", start), ("until", start + 7 * 86400)):
    value = datetime.datetime.fromtimestamp(at, datetime.timezone.utc)
    print(name, value.strftime("%Y-%m-%d %H:%M:%S"))
```

Assign the coordinator as owner and retain the due time in the committed ledger. A one-shot scheduled follow-up may wake that owner when due; it is not a repeated poll and must not be scheduled before deployment is actually measured. If the session ends, the next coordinator reads the ledger and performs an overdue observation, not a new baseline.

On the fleet box, use the installed tool with the explicit endpoints above, `--reap-baseline 0`, `--all-copies` and `TZ=UTC`. This is the read-only instrument, not a live sweep or stop. Keep the raw JSON in private evidence and put only the neutral aggregate in the ledger. Record:

| Section | Evidence that must remain visible |
|---|---|
| `direct_pressure_kills` | measured/partial/absent; unique killed tasks and UUID count when present; selected files read, read failures, malformed rows, unmeasured notifications; discovery and exposure limits |
| `reap_class_oom` | ALL pane stops, observed reap-class count, busy, idle/no-live-shell, unmapped reasons, unmeasured; never only the favorable class |
| `pressure_reap_comparison` | B=0, threshold 2, observed count or unmeasured, exclusive decision |
| `inert_scopes` | NOW's fresh record or absent/unreadable/stale/future; mode, measured dead/inert/day-old counts and carries; it is not the week's reconstructed sweep history |

The variable's direct target is 0; only a measured zero among discovered transcripts can be called zero, and even that carries the discovery/exposure qualifications. Nonzero, partial or absent input is reported, not concealed as success. Kernel classification uses current registry UUID/transcript and may lose pre-rotation history; raw unmapped/unmeasured remain material. A `not-triggered` B comparison means the observed class is at most 2, not that the fleet is healthy or the unknown stops were harmless.

- [ ] **Step 5: Apply the approved withdrawal rule through a follow-up release, or retain the observation obligation.**

For B=0, an observed reap-class count of 3 or more in ANY measured post-variable seven-day interval triggers withdrawal; 2 does not. `unmeasured` cannot be silently treated as not-triggered. Report an unmeasured reading for further measurement, without inventing a new automatic removal rule. Direct pressure-kill counts NEVER feed the B + 2 comparison.

On `withdraw`, open the next work run BEFORE closing the current one, preserving programme continuity. Its brief removes only the child-spawn assignment, updates the owning independent presence pins to prove the key absent in primary/retry composition, and documents the withdrawal. It does not revert Task 1's safety fixes, Task 3's choice fix or the read-only instrument. Follow the same red-first, generated/citation and independent-review gates; merge under current authority and observe the supported updater again. The removal reaches each session's next ordinary start, never a forced fleet restart. An aggregate slice `MemoryHigh` does not return.

On `not-triggered`, retain the key and record the qualified reading. Keep an owned weekly observation obligation in the ledger; the approved rule says ANY later week, not only this first one. At two weeks after rollout, compare the direct-pressure metric to its target and report unchanged/non-measurable results for retirement or redesign under spec section 9; changing a product decision remains the operator's. The shadow collector's inert-survivor target is not declared failed simply because it remains unarmed. No acceptance outcome authorizes writing `scope-sweep-live`.

## Final Branch And Handoff Gates

These belong to the worker after Tasks 1-4, before its final PR and wave-done. They are planned gates, not results from this documentation branch.

- [ ] Re-measure current main and the owned claims before the final gate. Absorb main only for a conflict, a branch-red/main-passes failure, or a NAMED landing condition under clause 16, not merely because main advanced. A required merge is ordinary `git merge`, never a rebase of dispatched work; resolve generated stamps by regeneration and pay the census/citation tax again.
- [ ] Run the complete owning set from `server/`, foreground with timeout at least 600000 ms and one process at a time:

```bash
./node_modules/.bin/vitest run test/scope-sweep.test.ts test/ccrc-doctor.test.ts test/measure-continuity-stage6.test.ts test/measure-continuity-pressure-kills.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-limit-banner.test.ts test/ccd-auto-compact.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-resume-flag.test.ts test/ccd-spawn-split.test.ts test/ccd-route-spawn.test.ts test/ccd-route-degrade.test.ts test/ccd-lifecycle-purge.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts test/ccd-route-apply.test.ts test/ccd-route-settle.test.ts test/ccd-swap.test.ts test/ccd-archive.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-sync-uuid.test.ts test/continued-in-parity.test.ts test/continued-in-successor-parity.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccrc-codex-launcher.test.ts test/wrapper-generate.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/measure-continuity.test.ts test/measure-continuity-stage4.test.ts test/measure-continuity-stage7.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ownership.test.ts test/ccd-reg-get-census.test.ts test/ccd-die-containment.test.ts test/single-definition.test.ts test/ccrc-doctor-graphify.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/typecheck-tests.test.ts test/topology-clean.test.ts test/deviation-refs.test.ts --maxWorkers=1
npm run build
```

- [ ] Run the complete server suite ONCE, foreground: `./node_modules/.bin/vitest run --maxWorkers=1`. Report actual red files and distinguish reproduced base-red, load flakes and new regressions with isolated reruns only when evidence warrants it; never call an unrun file green. A timed-out process is still owned until its exit is proved; no overlapping retry and no pattern kill.
- [ ] Run the package-local agent and PWA suites, foreground, sequentially; `agent/node_modules/.bin/vitest run --maxWorkers=1` from `agent/` and `pwa/node_modules/.bin/vitest run --maxWorkers=1` from `pwa/`, each actually invoked as `./node_modules/.bin/vitest` in that package. Run PWA's existing `npm run build`. No root runner or bare npx. If dependencies are unavailable, report the unrun leg rather than resolving a global runner.
- [ ] Parse all edited shells with `bash -n`, Python with `python3 -I`/`ast.parse`, regenerate/check `ccd/ccd`, compare executable modes, repair live README anchors and measure the frozen citation composition. Prove the two frozen documents unchanged. Run `git diff --check`.
- [ ] Scan EVERY changed file and every introduced commit for private material. Stage a new file before the tracked-corpus privacy guard so it is not invisible. Measure the real guard exit code separately before committing or pushing. Preserve issue #317's shipped copy/source behavior; no historical count is a substitute for today's measured census.
- [ ] Include each task's red-first result, restored green, independent task review and actual mutation table in committed evidence. Do not invent completed ticks, sample counts, helper signatures or a live notification fixture. Explain every used issued deviation; leave unused numbers unused.
- [ ] Open the worker PR with durable GitHub links to the spec/plan and explicit verification gaps, including protected updater observation and next-start exposure. End its description with the mandated attribution. List mail before sending one wave-done at the exact final tip; report Tasks 1-4 done and Task 5 pending/coordinator-owned. Include the unchanged fingerprint, `suite:` and `failure:` signals and evidence paths. Do not wait indefinitely for CI instead of handing off: the coordinator reads its actual checks.

## Deviations found

The planning commit itself defined no numbered deviation; D-4316 below was defined during Task 1's implementation. The issued block is 4316 through 4325; it is not an instruction to consume all ten. Task 1 discharges the carried review/worker residue and Task 3 closes the already-defined D-3925 without redefining it. During implementation, define any genuine departure here with the issued number, exact changed contract, why it was necessary, named cost and measured red/green evidence IN THE SAME COMMIT as its implementation. A plan adjustment that changes an operator ruling is not a worker's deviation to self-authorize; stop and report it for a ruling.

**D-4316 (Task 1, fix round 1).** *Contract changed:* the reason class of the sweep's `dead` row, in both readers, is widened from `[a-z-]` to `[a-z0-9-]`: the doctor's `why=([a-z0-9-]+(,[a-z0-9-]+)*)` inside `_check_scope-sweep` (capture numbering unchanged) and the instrument's `why=[a-z0-9-]+(?:,[a-z0-9-]+)*` in `S6_DEAD`; nothing else in either regex moves. Two round-trip pins are added to `scope-sweep.test.ts`: each feeds one reader the record the REAL sweep wrote in its fixture, with the reasons `dead-under-6h` and `cpu-moved,process-started-under-6h`. *Why:* the plan's literal regex rejects the sweep's own most common reasons, `dead-under-6h` and `process-started-under-6h`, which contain a digit, so every scope seen dead in its first six hours made the doctor call the whole record unsafe to read and made the instrument publish `{record: 'unreadable'}`; the spec requires the readers to interpret the sweep's record. Every earlier reader fixture used `why=none`, which is why no case caught it. *Cost:* none known; it accepts digits in reason tokens, which only the sweep writes, and no reader does arithmetic on them. *Evidence:* both new pins red under the old class (doctor: `has 2 line(s) it cannot read`; instrument: `{record: 'unreadable'}` instead of `dead: 2` counts), green after (`scope-sweep.test.ts` 78/78, `ccrc-doctor.test.ts -t scope-sweep` 28 passed, `measure-continuity-stage6.test.ts` 27/27).

## Where Things Stand

**Agreed:** frozen B=0 with raw unknowns retained; all carried residue in the FIRST implementation commit; child-scoped primary/retry key; marker-free outgoing choice; direct notifications and pane-OOM remain separate; Tasks 1-4 worker-owned, Task 5 coordinator-owned; the existing sequential subagent-driven execution method.

**Waiting on you:** written-plan review before implementation or dispatch. The draft snippets and mutations have not been replayed as a product prototype; their execution is the worker's red-first obligation, not a claimed planning result.

**Later:** independent acceptance, observation of the existing updater, next-start exposure, the first complete post-variable week and any later B + 2 withdrawal; later continuity waves remain under their own prerequisites. Scope-sweep arming, fleet restarts, updater intent changes and task-7 repository settings are not authorized here.
