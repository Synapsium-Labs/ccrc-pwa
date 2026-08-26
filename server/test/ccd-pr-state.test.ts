import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, WS_ADD, ghContainedEnv } from './ccdWsHelpers.js';
import { GH_STUB, makePrHarness, mergedRow, type PrHarness } from './ccdPrHelpers.js';
import { isFullLine, parsePrLines, phaseFor } from '../src/prstate.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-prstate-'); });
afterEach(() => { h.cleanup(); });

/** A workspace plus one commit on its branch, so `ahead` is 1 and the tip is
 *  a real oid the binding check can be pointed at.
 *
 *  `makeGhRepo`, never `makeRepo`: `_gh_repo_slug` reads `remote.origin.url`
 *  and `makeRepo`'s is a local bare PATH, so every assertion below would read
 *  `{"phase":"unknown","reason":"no-remote"}` instead of the phase it names. */
const workspaceWithCommit = (project: string, slug: string): { wt: string; main: string; tip: string } => {
  const main = h.makeGhRepo(project);
  h.sh(`${WS_ADD} CCD_WS_SLUG=${slug} cmd_ws_add ${project}`);
  const wt = path.join(h.home, 'worktrees', project, slug);
  fs.writeFileSync(path.join(wt, 'f.txt'), 'work\n');
  h.git(wt, 'add', 'f.txt');
  h.git(wt, 'commit', '-m', 'the work');
  return { wt, main, tip: h.git(wt, 'rev-parse', 'HEAD') };
};

const line = (out: string): Record<string, any> => JSON.parse(out.split('\n')[0]!);

describe('pr-state argv', () => {
  it('takes exactly one --session or --project flag pair', () => {
    expect(h.run('cmd_pr_state').code).toBe(1);
    expect(h.run('cmd_pr_state --session').code).toBe(1);
    expect(h.run('cmd_pr_state --branch x').code).toBe(1);
    expect(h.run('cmd_pr_state --session a --project b').code).toBe(1);
    expect(h.run('cmd_pr_state --session "a b"').stderr).toMatch(/bad session/);
    expect(h.run('cmd_pr_state --project "a b"').stderr).toMatch(/bad project/);
  });

  it('refuses an id it does not hold, and a main checkout that has no branch', () => {
    // Both die BEFORE the gh call: a mistyped id must not spend the repo's one
    // call per sweep, and a main checkout has nothing to bind a PR to.
    h.makeGhRepo('demo');
    h.sh(`_reg_set claude-demo uuid u; _reg_set claude-demo wrapper claude
          _reg_set claude-demo workdir "${path.join(h.home, 'projects', 'demo')}"; _reg_set claude-demo project demo`);
    expect(h.run('cmd_pr_state --session nope').stderr).toMatch(/no such session/);
    expect(h.run('cmd_pr_state --session claude-demo').stderr).toMatch(/not a workspace/);
    expect(h.ghPoison()).toEqual([]);
  });

  it('names pr-state in the usage line a mistyped verb prints', () => {
    // The usage line is the only thing a mistyped verb prints, and it is not
    // covered by the caps parity test — that one compares the caps list with
    // the dispatcher and never reads this string.
    //
    // Under the harness HOME like everything else, even though this only reads:
    // ccd runs `mkdir -p "$REG"` at load, so an unisolated run writes into the
    // real ~/.cc-sessions. HOME is the boundary for RUNNING ccd, not only for
    // the verbs that change something.
    let stderr = '';
    try {
      execFileSync('bash', [CCD, 'no-such-verb'],
        { encoding: 'utf8', cwd: h.home,
          env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
      throw new Error('a verb ccd does not have must exit non-zero');
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr ?? '');
    }
    expect(stderr).toContain('usage: ccd {');
    expect(stderr).toContain('pr-state');
  });

  it('asks gh for --state all and every field the predicate reads', () => {
    // --state closed is a SUPERSET that includes MERGED, so anything but
    // `all` conflates merged with abandoned in both directions. Omitting
    // isCrossRepository hands the badge to any stranger who forks the repo.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    const call = h.ghCalls().find((c) => c.startsWith('pr list'))!;
    expect(call).toContain('--state all');
    expect(call).toContain('--limit 100');
    for (const f of ['headRefOid', 'isCrossRepository', 'baseRefName', 'mergeCommit', 'mergedAt', 'statusCheckRollup']) {
      expect(call).toContain(f);
    }
    expect(call).not.toContain('mergeStateStatus');   // literal "UNKNOWN" on merged PRs
    expect(call).not.toContain('mergeable');
    // The whole list, in order. The loop above says WHY six of these are here;
    // this says that none of the twelve may quietly leave, which the loop
    // cannot: the stub returns its rows whatever --json asks for, and `state`
    // is a substring of `--state all`, so five field names were assertable
    // only as an exact string. Task 12's prstate.ts reads every one of them.
    expect(call).toContain('--json number,state,headRefName,headRefOid,baseRefName,'
      + 'isCrossRepository,mergedAt,mergeCommit,url,title,isDraft,statusCheckRollup');
    // …and the call is WRAPPED. `gh pr list` has no timeout of its own, so a
    // blocking DNS hang is bounded by this and nothing else; without the stub
    // logging its own argv, dropping the wrapper left the suite green.
    expect(h.ghCalls().some((c) => c.startsWith(`timeout ${ccdSeconds('PR_GH_TIMEOUT')} gh pr list`))).toBe(true);
  });
});

describe('the per-session call asks about one branch', () => {
  // MEASURED, 2026-08-26, against a live fleet repo with several thousand PRs
  // of history: the unfiltered 100-PR `statusCheckRollup` window this verb sent
  // answered `HTTP 504` after 11.2 s on 3/3 attempts, and the same query with
  // `--head <the session's branch>` answered in 0.78 s. `--session` asks a
  // question about ONE branch — the same question `pr-open` asks, through the
  // same reader's same named second parameter — and the wide window was ninety-
  // nine other branches' PRs fetched so that `bound()` could drop them.
  //
  // NARROWING IS SAFE HERE AND THE PROOF IS EXHAUSTIVE, not a judgement: every
  // consumer of these rows conjoins `headRefName == branch`, so a head-filtered
  // answer is a strict SUPERSET of what anything reads. `_pr_py`'s `bound()`,
  // `is_merged()` (which conjoins `bound`) and `pick()` (which filters by it) on
  // the ccd side; `boundRow()` and `isMergedRow()` on the server's, and
  // `line.rows` has exactly ONE server-side reader — `phaseFor`'s
  // `boundRow(line.rows, …)`. Nothing iterates the rows for another branch.
  //
  // `--project` is a different question — every workspace of the repo at once,
  // from one call — and keeps the wide window; the second test is that guard.
  it('passes --head <the registry branch>, and still binds the PR', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    // Two rows, and the second is the point: it is what the WIDE call used to
    // fetch and drop. The stub answers with whatever the fixture holds however
    // the call is filtered — it cannot model gh's own filtering — so the row is
    // here to say what the flag is FOR, while the `--head` assertion is what
    // proves the flag was sent at all.
    h.ghRows([
      mergedRow({ headRefOid: tip }),
      mergedRow({ number: 77, headRefOid: tip, headRefName: 'ws/still-cove' }),
    ]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    const call = h.ghCalls().find((c) => c.startsWith('pr list'))!;
    expect(call).toContain('--head ws/quiet-basin');
    // …and the answer is unchanged. A narrowed question that also narrowed the
    // ANSWER would be the failure this whole change has to not be.
    expect(o.phase).toBe('merged');
    expect(o.number).toBe(42);
  });

  it('leaves the --project call unfiltered — one call answers every branch', () => {
    // The other direction, and it is not hypothetical: `cmd_pr_state` reads the
    // project's slug off `ids[0]`, so a `--head` built the same careless way
    // would filter the whole sweep on the FIRST session's branch and answer
    // `none` for every sibling — clearing each one's persisted `prnumber` and
    // retiring it into the append-only `.prhistory`.
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-cove cmd_ws_add demo`);
    h.ghRows([]);
    h.sh(`${GH_STUB} cmd_pr_state --project demo`);
    const call = h.ghCalls().find((c) => c.startsWith('pr list'))!;
    expect(call).not.toContain('--head');
  });

  it('binds the branch gh was ASKED about, even if the registry moves mid-call', () => {
    // THE ROWS AND THE BRANCH THEY WERE FETCHED FOR TRAVEL TOGETHER, exactly as
    // the rows and the moment they were fetched already do (`$5`, the answered-
    // at stamp). Before the filter existed the two reads of `branch` — one to
    // build the question, one to bind the answer — did not exist; now there are
    // two, separated by a network call the timeout bounds at TWELVE SECONDS,
    // which is long enough for a `ws-rename` or a hand-edited registry to land
    // between them.
    //
    // What that costs if `_pr_state_one` re-reads the field instead of being
    // handed it: gh was asked about `ws/quiet-basin` and answered about it, and
    // the binding is then attempted for `ws/still-cove` against rows that by
    // construction cannot contain it — `chosen` is None, the phase is `none`,
    // and `none` is the answer that CLEARS the persisted number and appends the
    // outgoing PR to the append-only `.prhistory`. A local fact erasing
    // GitHub's answer about a PR, which is the harm `_pr_state_one` already
    // refuses to do for drift.
    //
    // So the answer below is deliberately about the OLD branch: coherent and at
    // most one sweep stale, rather than incoherent and persisted. The next
    // sweep asks about the new name and answers it.
    //
    // The fixture is the gh stub itself rewriting the registry — the only way
    // to put a mutation INSIDE the window, and it also pins the ORDER: a
    // `cmd_pr_state` that read the branch after the call would see the rename.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    const renamingGh = `${GH_STUB}
      gh() {
        printf '%s\\n' "$*" >> "$HOME/gh-calls"
        _reg_set demo-quiet-basin branch ws/still-cove
        [[ -f "$HOME/gh-rows.json" ]] && cat "$HOME/gh-rows.json"
        return 0
      };
    `;
    const o = line(h.sh(`${renamingGh} cmd_pr_state --session demo-quiet-basin`));
    expect(h.ghCalls().find((c) => c.startsWith('pr list'))!).toContain('--head ws/quiet-basin');
    expect(o.branch).toBe('ws/quiet-basin');
    expect(o.phase).toBe('merged');
    expect(o.number).toBe(42);
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.prhistory'))).toBe(false);
  });
});
/** `mergedRow` with the merge undone — state OPEN, no merge fields. The rollup
 *  is only ever put into WORDS for `open` and `draft` (`prSentence`'s
 *  `checkText` has the clause in those two cases and nowhere else, and
 *  `PrSheet` renders `.pr-checkline` in that same branch), so `open` is the
 *  phase these tests have to be about: a fixture built on `mergedRow` would
 *  assert `checks` on a row whose checks no screen reads. */
/** The seconds ccd assigns to a bare `NAME=<n>` constant. Read rather than
 *  hardcoded: these two assertions are about WHICH timeout wraps WHICH call,
 *  never about the value — and the value moved once already (12+6 -> 8+5, when
 *  `pr-timeout-budget.test.ts` measured the pair against the 20 s bound that
 *  actually ships). A literal here re-pins the number in a third place and reds
 *  the next resize for no reason. */
const ccdSeconds = (name: string): number => {
  const src = readFileSync(CCD, 'utf8');
  const m = new RegExp(`^${name}=(\\d+)`, 'm').exec(src);
  if (!m) throw new Error(`ccd no longer defines ${name} as a bare integer assignment`);
  return Number(m[1]);
};

const openRow = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  mergedRow({ state: 'OPEN', mergedAt: null, mergeCommit: null, ...over });

/** A `gh` that can answer the TWO calls the project sweep now makes, keyed on
 *  the `--json` list because that is the only thing that tells them apart: the
 *  ROWS window (`number,state,…`) and the ROLLUP window
 *  (`number,statusCheckRollup`). `GH_STUB` holds ONE `gh-rows.json` and hands
 *  it to every call, which cannot express "these two calls came back
 *  differently" — and that the second one can come back differently, including
 *  not at all, is the whole property under test. */
const twoAnswerGh = (rollupArm: string): string => `
gh() {
  printf '%s\\n' "$*" >> "$HOME/gh-calls"
  case "$*" in
    *'--json number,statusCheckRollup'*) ${rollupArm} ;;
    *) [[ -f "$HOME/gh-rows.json" ]] && cat "$HOME/gh-rows.json" ;;
  esac
  return 0
};
timeout() { printf 'timeout %s\\n' "$*" >> "$HOME/gh-calls"; shift; "$@"; };
`;

describe('the project sweep fetches the rollup it reads, not the ninety-nine it drops', () => {
  // MEASURED, 2026-08-26, on the same live fleet repo Task 1 and Task 2 were
  // measured against. `--project` genuinely needs the WIDE window — it asks
  // about every workspace of a repo from one call, and Task 2's `--head` would
  // filter the whole sweep on the first session's branch — but it does not need
  // `statusCheckRollup` in it, and that field is the entire cost:
  //
  //   --state all --limit 100, twelve fields incl. the rollup   11.2 s, HTTP 504 (3/3)
  //   --state all --limit 100, the same eleven WITHOUT it        0.83 s, rc 0
  //   --state all --limit 100, ONLY number,statusCheckRollup    11.2 s, HTTP 504
  //   --state open --limit 100, number,statusCheckRollup         3.09 s, rc 0 (19 open)
  //
  // The third line is the one that decides the shape: narrowing the FIELD list
  // does not help at all, so the rollup has to come from a call that is narrow
  // in the ROW dimension. `--state open` is the narrowing that is CONSTANT in
  // the number of calls, and it covers every phase whose checks the product
  // ever puts into words — `prSentence` renders the checks clause for `open`
  // and `draft` only, `PrSheet`'s `.pr-checkline` in that same branch, and the
  // sweep's own active cadence conjoins `phase === 'open'`.
  //
  // A per-branch rollup call per session would be exact for merged and closed
  // rows too, and it is rejected here for a measured reason: it makes ONE
  // exec's wall clock scale with the number of workspaces, so a sick GitHub
  // turns a whole project into `agent-down` (the outer bound killed the child)
  // instead of the honest `unavailable` this same wave taught the classifier to
  // say. Two calls is two calls whatever the fleet grows to.
  it('does not put the rollup in the wide window', () => {
    workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([]);
    h.sh(`${GH_STUB} cmd_pr_state --project demo`);
    const rowCall = h.ghCalls().filter((c) => c.startsWith('pr list'))
      .find((c) => c.includes('--json number,state,'));
    expect(rowCall).toBeDefined();
    expect(rowCall).not.toContain('statusCheckRollup');
    // The other eleven stay, in order and entire: this task removes ONE field,
    // and the row window is still what every binding conjunct is read from.
    expect(rowCall).toContain('--json number,state,headRefName,headRefOid,baseRefName,'
      + 'isCrossRepository,mergedAt,mergeCommit,url,title,isDraft');
    expect(rowCall).toContain('--state all');
    expect(rowCall).toContain('--limit 100');
  });

  it('asks for the rollup in a second call, over the PRs that are still open', () => {
    workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([]);
    h.sh(`${GH_STUB} cmd_pr_state --project demo`);
    const rollupCall = h.ghCalls().filter((c) => c.startsWith('pr list'))
      .find((c) => c.includes('--json number,statusCheckRollup'));
    expect(rollupCall).toBeDefined();
    expect(rollupCall).toContain('--state open');
    expect(rollupCall).toContain('--limit 100');
    // …and on its OWN, shorter budget. It is the optional half of the answer,
    // so it may not be able to spend the whole of what the required half is
    // allowed: 12 + 12 would put the pair past the outer bound the pr-lifecycle
    // spec set for this verb (20 s), and losing the rows to a rollup is exactly
    // the poisoning this split exists to make impossible.
    expect(h.ghCalls().some((c) => c.startsWith(`timeout ${ccdSeconds('PR_GH_CHECKS_TIMEOUT')} gh pr list`))).toBe(true);
  });

  // THE JOIN IS KEYED ON `number`, AND THIS FIXTURE IS WHAT MAKES THAT TESTABLE.
  // Its first version put the one rollup entry on the row that was ALSO first in
  // `rows`, so a positional join — `zip(rows, by_number.values())` — passed the
  // whole suite. That is not a hypothetical mutant: in production the two windows
  // are different SETS in a different ORDER (rows is `--state all --limit 100`,
  // newest first, merged and closed included; rollups is `--state open --limit
  // 100`), so a positional join attaches an open PR's rollup to an unrelated
  // merged row and the keycap renders another PR's checks — including its
  // attacker-controllable `checkNames`, on any repo that takes fork PRs.
  //
  // So: the bound row is rows[1], not rows[0], and the rollups arrive in the
  // OPPOSITE order with a decoy that would look like a pass. Under the correct
  // key-join the bound row is `fail`/['e2e']; under a positional one it takes the
  // decoy and reads `pass`.
  it('a bound row carries ITS OWN checks — the join is keyed on number, not position', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([
      openRow({ number: 77, headRefOid: 'f00dcafe', headRefName: 'ws/still-cove' }),
      openRow({ headRefOid: tip }),                       // #42 — the bound row
    ]);
    fs.writeFileSync(path.join(h.home, 'gh-rollups.json'), JSON.stringify([
      { number: 42, statusCheckRollup: [{ name: 'e2e', conclusion: 'FAILURE' }] },
      { number: 77, statusCheckRollup: [{ name: 'lint', conclusion: 'SUCCESS' }] },
    ]));
    const out = h.sh(`${twoAnswerGh('cat "$HOME/gh-rollups.json"')} cmd_pr_state --project demo`);
    const l = parsePrLines(out)[0];
    expect(l).toBeDefined();
    expect(isFullLine(l!)).toBe(true);
    // Read through the SERVER's own reader, not by poking at the row: the two
    // calls are joined so that `phaseFor`'s `checksFor(boundRow(...))` finds a
    // rollup on the row it independently binds, and asserting the join any
    // other way would pass for a row nothing reads.
    const s = phaseFor(l as never);
    expect(s.phase).toBe('open');
    expect(s.checks, 'the bound row took another PR\'s rollup — the join went positional').toBe('fail');
    expect(s.checkNames).toEqual(['e2e']);

    // And the row NOTHING reads must also be correct, because a swap is
    // symmetric: asserting only the bound row would still pass if the two
    // rollups were exchanged in a way that happened to leave #42 right.
    const rows = (l as unknown as { rows: { number: number; statusCheckRollup?: { name: string }[] }[] }).rows;
    const other = rows.find((r) => r.number === 77);
    expect(other?.statusCheckRollup?.[0]?.name,
      'the decoy rollup did not land on its own row').toBe('lint');
  });

  // "AFTER THE STAMP, NEVER BEFORE" is the one invariant in the rollup block
  // that had no red behind it: hoisting the whole `if [[ $mode == --project ]]`
  // block above `answeredAt=$(date +%s%3N)` is legal bash, reads like tidying
  // two network calls together, and left every suite green (measured).
  //
  // What it costs is the property the previous wave fixed: `prcheckedat` must
  // describe WHEN GITHUB ANSWERED THE ROWS, because the compare-and-set ranks
  // runs by it (`prev_at <= checked_at`). Hoisted, the stamp also carries the
  // rollup call's wall clock — up to PR_GH_CHECKS_TIMEOUT — so a project sweep
  // whose rows GitHub answered seconds EARLIER can overwrite a fresher
  // `--session` answer.
  //
  // The mechanism is a rollup arm that takes measurable time. If the stamp is
  // taken first, `prcheckedat` predates that delay; if it is hoisted, it cannot.
  it('stamps prcheckedat from when the ROWS answered, not after the rollup call', () => {
    // A BOUND row, so a phase is actually measured and persisted — an empty
    // window writes no `prcheckedat` and the assertions below would have
    // nothing to read.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    const SLEEP_S = 2;
    // Only the ROLLUP arm sleeps — `twoAnswerGh` answers the rows at once, so
    // any delay that reaches the stamp came from the rollup call and nowhere
    // else. (Hand-rolling the stub here does not work: `timeout` is a real
    // binary and `gh` is a shell function, so the helper's `timeout()` override
    // is what lets `timeout 8 gh …` reach the stub at all.)
    const before = Date.now();
    h.sh(`${twoAnswerGh(`sleep ${SLEEP_S}; printf '[]'`)} cmd_pr_state --project demo`);
    const after = Date.now();

    const stamped = Number(h.reg('demo-quiet-basin', 'prcheckedat'));
    expect(Number.isFinite(stamped) && stamped > 0, 'no prcheckedat was written at all').toBe(true);

    // Guard the guard: if the stub did not actually sleep, this test proves
    // nothing, so assert the delay really happened before reading anything into
    // the stamp's position relative to it.
    expect(after - before,
      'the rollup arm did not sleep — this fixture cannot tell the two orderings apart')
      .toBeGreaterThanOrEqual(SLEEP_S * 1000);

    // The stamp must sit in the window BEFORE the sleep, not after it. Half the
    // sleep is the margin: generous enough for a loaded box, far short of the
    // full delay a hoist would add.
    expect(stamped - before,
      `prcheckedat is ${stamped - before}ms after the run started, which is past the rollup's `
      + `${SLEEP_S}s — the stamp was taken AFTER the rollup call, so it ranks completion times `
      + `rather than answers`)
      .toBeLessThan(SLEEP_S * 1000 / 2);
  });

  it('a rollup call that fails cannot poison the rows', () => {
    // THE ISOLATION, stated as a test rather than as an intention. The rollup
    // call is the second network call on a path that had one, and the failure
    // it must never cause is the one Task 1 just gave a name to: a `504` on the
    // OPTIONAL half turning a perfectly good phase into `unknown`. What a lost
    // rollup costs is `checks: null` — which `checksFor` already answers for an
    // absent rollup (`prstate.ts`, `Array.isArray(row.statusCheckRollup)` is
    // false for an absent key) — and nothing else.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    const out = h.sh(`${twoAnswerGh(`printf 'HTTP 504: We could not respond in time.\\n' >&2; return 1`)} `
      + 'cmd_pr_state --project demo');
    const l = parsePrLines(out)[0];
    expect(l).toBeDefined();
    // A FULL line, not the id-less failure object: a whole-repo failure backs
    // the project off and greys every sibling, and the rows were read.
    expect(isFullLine(l!)).toBe(true);
    const s = phaseFor(l as never);
    expect(s.phase).toBe('open');
    expect(s.number).toBe(42);
    expect(s.reason).toBeNull();
    // CHANGED DELIBERATELY, and this is the assertion the change is about.
    // It read `toBeNull()`, and `null` is defined by `PrChecks` as the
    // AFFIRMATIVE claim "no checks are configured" — which `PrKeycap` renders
    // in those words, under a fresh `checkedAt`, on a PR whose build may be red.
    // The rollup call 504'd here; nothing was measured. The phase, the number
    // and the absence of a `reason` are all unchanged, which is the isolation
    // this test was written for and still proves.
    expect(s.checks).toBe('unmeasured');
    expect(s.checkNames).toBeNull();
  });

  it('keeps the rows when the JOIN itself cannot run', () => {
    // The other half of the isolation, and a different fault from the one
    // above: there the second CALL failed, here the second call answered and
    // the pass that attaches its answer is what broke — a python that will not
    // start, an OSError on the write, a `rollups` arm a later edit throws in.
    // Every one of those is a fault in the OPTIONAL half of the answer, and the
    // rows are the half somebody is waiting on: a broken join that replaced
    // them would turn every session of every project on the box into
    // `unknown/error` in one sweep, off a fault in an annotation.
    //
    // `python3` is shadowed for `rollups` and for nothing else — `_pr_py`'s
    // mode is argv[2] to python (argv[1] is the program on fd 3) — so the
    // `state` pass that computes the phase runs exactly as it always does.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    fs.writeFileSync(path.join(h.home, 'gh-rollups.json'), JSON.stringify([
      { number: 42, statusCheckRollup: [{ name: 'e2e', conclusion: 'FAILURE' }] },
    ]));
    const brokenJoin = `${twoAnswerGh('cat "$HOME/gh-rollups.json"')}
      python3() { [[ "\${2:-}" == rollups ]] && return 1; command python3 "$@"; };
    `;
    const out = h.sh(`${brokenJoin} cmd_pr_state --project demo`);
    const l = parsePrLines(out)[0];
    expect(l).toBeDefined();
    expect(isFullLine(l!)).toBe(true);
    const s = phaseFor(l as never);
    expect(s.phase).toBe('open');
    expect(s.number).toBe(42);
    // Same change, same reason as the failed-CALL case above: the join broke,
    // so no row carries a rollup, and their absence proves nothing about
    // whether checks exist. The ROWS are what this test is about and they are
    // untouched — phase and number still measured.
    expect(s.checks).toBe('unmeasured');
  });

  // THE POSITIVE CONTROL for the two `unmeasured` assertions above, and the
  // reason the distinction is worth carrying at all. If a successful rollup
  // that reports NO checks also read `unmeasured`, the new arm would just be a
  // rename of `null` and the screen would say "not measured" about a perfectly
  // good measurement — the same defect, pointing the other way.
  it('a rollup that ANSWERS and reports no checks is null, not unmeasured', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    // The call succeeds and says: this PR has an empty rollup. That IS a
    // measurement, and `checksFor` has always answered `null` for it.
    const out = h.sh(`${twoAnswerGh(`printf '%s' '[{"number":42,"statusCheckRollup":[]}]'`)} `
      + 'cmd_pr_state --project demo');
    const l = parsePrLines(out)[0];
    expect(l).toBeDefined();
    const s = phaseFor(l as never);
    expect(s.phase).toBe('open');
    expect(s.checks, 'a measured "no checks" was reported as unmeasured').toBeNull();
    expect(s.checkNames).toBeNull();
  });

  it('does not let the join turn an unreadable body into an empty one', () => {
    // The refusal inside the join, and it is the SAME refusal `rows_in`'s
    // docstring is about, one hop earlier than it used to be possible to break.
    // The join re-serialises the rows, so it has to answer the question "what
    // is an unreadable body?" for itself — and the wrong answer is `[]`, which
    // is the affirmative "this repository has no pull request for you": it is
    // the phase `none`, which CLEARS the persisted `prnumber` and retires a
    // live PR into the append-only `.prhistory`.
    //
    // Only `--project` can reach it, because only `--project` joins, and that
    // is exactly the sweep that runs unattended every 120 s against every repo
    // on the box. So the join refuses — nothing on stdout, non-zero — and the
    // rows reach `_pr_py state` exactly as gh left them, where the answer is
    // the id-less failure object it has always been.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    fs.writeFileSync(path.join(h.home, 'gh-rollups.json'), JSON.stringify([
      { number: 42, statusCheckRollup: [{ name: 'e2e', conclusion: 'SUCCESS' }] },
    ]));
    const gh = twoAnswerGh('cat "$HOME/gh-rollups.json"');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${gh} cmd_pr_state --project demo`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    const before = h.reg('demo-quiet-basin', 'prcheckedat');

    // gh exits 0 with a body that is not a list of rows — while the ROLLUP call
    // answers perfectly well, which is the state the join makes newly reachable.
    h.ghRaw('gh: could not determine base repository');
    const out = h.sh(`${gh} cmd_pr_state --project demo`);
    expect(parsePrLines(out)).toEqual([{ phase: 'unknown', reason: 'error' }]);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
    expect(h.reg('demo-quiet-basin', 'prcheckedat')).toBe(before);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.prhistory'))).toBe(false);
  });

  it('leaves the per-session call whole — one call, rollup and all', () => {
    // The other direction of the split, and the reason it is drawn where it is.
    // `--session` asks about ONE branch (Task 2), and that call carries the
    // rollup for the same reason it can carry the wide window's twelve fields:
    // measured at 0.78–1.1 s with the rollup included. Splitting it too would
    // buy nothing and cost a second round trip on the path a human is waiting
    // on — the PR sheet fires this one on every open.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    const calls = h.ghCalls().filter((c) => c.startsWith('pr list'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('statusCheckRollup');
    expect(calls[0]).toContain('--head ws/quiet-basin');
  });
});

describe('_gh_repo_slug', () => {
  // Four url forms reach `remote.origin.url` in practice and all four have to
  // answer OWNER/NAME, because everything downstream — `--repo`, pr-open's
  // assertion, reap's Phase C — is keyed on it. A form that fell through would
  // answer `no-remote` for a repo that has one.
  it.each([
    ['https://github.com/o/r', 'o/r'],
    ['https://github.com/o/r.git', 'o/r'],
    ['git@github.com:o/r.git', 'o/r'],
    ['ssh://git@github.com/o/r.git', 'o/r'],
  ])('reads %s as %s', (url, slug) => {
    const main = h.makeRepo('demo');
    h.git(main, 'config', 'remote.origin.url', url);
    expect(h.sh(`_gh_repo_slug "${main}"`)).toBe(slug);
  });

  it.each([
    ['https://gitlab.com/o/r'],                  // a host we do not speak for
    ['https://github.com/o/r/tree/main'],        // not a repo root
    ['../origins/demo.git'],                     // a path, which is what makeRepo sets
  ])('refuses %s rather than inventing a slug', (url) => {
    const main = h.makeRepo('demo');
    h.git(main, 'config', 'remote.origin.url', url);
    expect(() => h.sh(`_gh_repo_slug "${main}"`)).toThrow();
  });
});

describe('binding', () => {
  it('reports merged when every conjunct holds', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('merged');
    expect(o.number).toBe(42);
    expect(o.rows[0].ours).toBe(true);
  });

  it('refuses to bind a FORK PR that claims our branch name', () => {
    // gh pr list --head matches headRefName across fork owners (verified
    // against cli/cli: ten unrelated accounts on `patch-1`). This conjunct is
    // the difference between a badge and handing a stranger the archive trigger.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, isCrossRepository: true })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('none');
  });

  it('refuses a PR whose head commit is not in this repository at all', () => {
    // The recycled-slug case: the 144-slug namespace is reused after a reap,
    // and a 100-PR window keeps an old merged PR matchable for months.
    // The second row is what a gh field that is not a string looks like — a
    // sweep that crashed on it would mark every sibling of the repo unknown.
    workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([
      mergedRow({ headRefOid: '0000000000000000000000000000000000000000' }),
      mergedRow({ number: 43, headRefOid: null }),
    ]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('none');
    expect(o.rows[0].ours).toBe(false);
    expect(o.rows[1].ours).toBe(false);
  });

  it('refuses a PR whose head commit IS here but is not reachable from our tip', () => {
    // The sharper half of the same case, and the only one that exercises the
    // ancestry proof: after a reap recycles `quiet-basin`, the old PR's head
    // commit is still in the shared object store — `cat-file -e` finds it —
    // and it is still merged into main. Only `merge-base --is-ancestor`
    // separates it from the new workspace's own work, so with the zeros
    // fixture alone that call could return a constant and stay green.
    const { main, tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.git(main, 'checkout', '-q', '-b', 'someone-else');
    fs.writeFileSync(path.join(main, 'other.txt'), 'theirs\n');
    h.git(main, 'add', 'other.txt');
    h.git(main, 'commit', '-m', 'someone else');
    const stranger = h.git(main, 'rev-parse', 'HEAD');
    expect(stranger).not.toBe(tip);
    h.ghRows([mergedRow({ headRefOid: stranger })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.rows[0].ours).toBe(false);
    expect(o.phase).toBe('none');
    expect(o.number).toBeNull();
  });

  it.each([
    ['a branch name', 'main'],
    ['a SHORT hex-looking ref, which is why the regex floor is 7', 'abc'],
  ])('never lets gh hand it %s to resolve as a revision', (_what, ref) => {
    // `headRefOid` is a GitHub-sourced string and `is_ours` concatenates it into
    // `<oid>^{commit}` for `cat-file -e` and hands it to `merge-base`. §7 is that
    // no GitHub-sourced string is ever placed in an argv, and the OID regex is
    // what enforces it here — without it gh can name ANY revision this
    // repository can resolve, and a row saying `headRefOid: "main"` would bind
    // and report merged, because main really is an ancestor of our tip. The
    // second row is why the floor is 7 and not 1: `abc` is hex, resolvable, and
    // three characters long.
    const { main, tip } = workspaceWithCommit('demo', 'quiet-basin');
    // `main` is already there and already an ancestor of our tip; `abc` is made.
    if (ref !== 'main') h.git(main, 'branch', ref, tip);
    expect(h.git(main, 'rev-parse', '--verify', ref)).toMatch(/^[0-9a-f]{40}$/);
    h.ghRows([mergedRow({ headRefOid: ref })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.rows[0].ours).toBe(false);
    expect(o.phase).toBe('none');
  });

  it('refuses a PR on a different branch, however well the rest matches', () => {
    // The `--session` call now carries `--head`, so gh itself would not send
    // this row — and the conjunct is still the thing that decides, for three
    // reasons the flag does not cover. `--project` lists the repo's last 100
    // PRs unfiltered and is the form the 120 s sweep uses; `--head` matches
    // `headRefName` across fork owners, so a filtered answer still carries rows
    // that are not ours; and the server re-runs the same predicate over
    // `line.rows` with no gh call in sight. A conjunct that only held because
    // the question was narrow would be a binding decided by the wire.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, headRefName: 'ws/still-cove' })]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('none');
  });

  it('refuses a PR merged into a different base than the one we recorded', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, baseRefName: 'release/9' })]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('none');
  });

  it('takes the highest number AFTER binding, never before', () => {
    // Three rows, and both halves of the sentence are load-bearing: the fork's
    // 99 is the highest of all and must lose, and of the two that DO bind the
    // later one must win — a reopened workspace can carry more than one.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([
      mergedRow({ number: 99, headRefOid: tip, isCrossRepository: true }),   // a fork's, higher
      mergedRow({ number: 42, headRefOid: tip }),                            // ours
      mergedRow({ number: 7, headRefOid: tip }),                             // ours, older
    ]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).number).toBe(42);
  });

  it.each([
    ['no merge commit', { mergeCommit: null }],
    ['no mergedAt timestamp', { mergedAt: null }],
    ['a merge commit oid that is not an oid', { mergeCommit: { oid: 'the-branch' } }],
  ])('never claims merged on a partial match — gh MERGED with %s is unknown', (_what, over) => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, ...(over as Record<string, unknown>) })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('unknown');
    // `merge-unproven`, not `error`: the gh read succeeded. This is the token
    // Task 12's agreement test pins prstate.ts's phaseFor equal to.
    expect(o.reason).toBe('merge-unproven');
    expect(o.number).toBe(42);   // the PR is still identified — only the merge is not proven
  });
});

describe('phases without a PR', () => {
  it('is no-commits when the branch has nothing past base', () => {
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('no-commits');
    expect(o.ahead).toBe(0);
  });

  it('is none — ready to compose — when there are commits and no PR', () => {
    workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('none');
    expect(o.ahead).toBe(1);
    expect(o.commits).toHaveLength(1);
    expect(o.commits[0].subject).toBe('the work');
  });

  it('reports open, draft and closed distinctly', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    const open = { headRefOid: tip, state: 'OPEN', mergedAt: null, mergeCommit: null };
    h.ghRows([mergedRow({ ...open, isDraft: true })]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('draft');
    h.ghRows([mergedRow(open)]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('open');
    h.ghRows([mergedRow({ headRefOid: tip, state: 'CLOSED', mergedAt: null, mergeCommit: null })]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('closed');
  });

  it('trusts gh\'s state word over the merge fields beside it', () => {
    // A CLOSED row carrying merge fields is a row that contradicts itself.
    // `state` decides, and the safe answer is the one that does not fire the
    // archive trigger: whatever else is on the row, this PR is not merged.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, state: 'CLOSED' })]);   // mergedAt + mergeCommit intact
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('closed');
  });
});

describe('a branch the registry names that no longer resolves', () => {
  // `git branch -m` inside the worktree. Deviation 7 measured this exact state
  // for `ws-archive` and calls it ORDINARY — it is what a user comparing two
  // names, or renaming outside ccd, leaves behind — and changed the manifest to
  // RECORD it (`tip: null`) rather than refuse. The same fact must not make
  // pr-state destroy a merge.
  const renameAway = (): { tip: string } => {
    const r = workspaceWithCommit('demo', 'quiet-basin');
    h.git(r.wt, 'branch', '-m', 'ws/renamed');
    return r;
  };

  it('keeps a bound MERGED answer, and every persisted field with it', () => {
    // The local tip is a LOCAL fact. It cannot demote gh's answer about a PR
    // that binds on the other three conjuncts: the phase ladder consults the
    // bound row first, and `no-commits` — a positive claim that this branch has
    // nothing past base — is the one thing an unresolvable ref may never
    // manufacture. Shipped behaviour was {phase:"no-commits", tip:""} with
    // prnumber REMOVED, which makes Task 14's auto-archive (prPhase==='merged')
    // unable to ever fire for this workspace and leaves `cmd_ws_archive` with no
    // number to file as `archivedreason merged:#42`.
    const { tip } = renameAway();
    h.ghRows([mergedRow({ headRefOid: tip })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('merged');
    expect(o.number).toBe(42);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
  });

  it('says tip null and ahead null rather than "" and 0', () => {
    // Deviation 7's precedent, verbatim: `tip` is JSON null when the ref does
    // not resolve, never "" and never a substitute oid. `""` and `0` are
    // MEASUREMENTS — "this ref is empty", "this branch is level with base" — and
    // neither was measured here.
    const { tip } = renameAway();
    h.ghRows([mergedRow({ headRefOid: tip })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.tip).toBeNull();
    expect(o.ahead).toBeNull();
  });

  it('is none, never no-commits, when nothing binds either', () => {
    renameAway();
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('none');
    expect(o.ahead).toBeNull();
  });

  it('keeps rc 1 and rc 128 apart — an unreadable repo is not an absent ref', () => {
    // `--quiet` is what makes the distinction exist at all: without it git
    // answers 128 for BOTH, so "that ref does not exist" and "I cannot read that
    // repository" collapse into one empty string. Measured on git 2.43, and it
    // is the same distinction `_ws_archive_manifest` was written to preserve one
    // task earlier in this file. An unreadable $main is not a fact about a PR:
    // it is a per-session failure that persists nothing.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    const out = h.sh(`${GH_STUB} _pr_state_one demo-quiet-basin /no/such/main o/r '[]'`);
    expect(JSON.parse(out)).toEqual({ id: 'demo-quiet-basin', phase: 'unknown', reason: 'error' });
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
  });
});

describe('the object the server reads', () => {
  it('carries exactly the documented keys, and the local facts in them', () => {
    // Every consumer downstream (prstate.ts, the composer, ws-audit) reads
    // this shape. Keys nothing asserts are keys that can silently leave.
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(Object.keys(o).sort()).toEqual([
      'ahead', 'base', 'baseShort', 'checkedAt', 'commits', 'dirty', 'id', 'number',
      'phase', 'project', 'repo', 'reason', 'rows', 'template', 'tip', 'branch',
    ].sort());
    expect(o.id).toBe('demo-quiet-basin');
    expect(o.project).toBe('demo');
    expect(o.repo).toBe('o/r');
    expect(o.branch).toBe('ws/quiet-basin');
    expect(o.base).toBe('origin/main');
    expect(o.baseShort).toBe('main');            // what baseRefName is compared against
    expect(o.tip).toMatch(/^[0-9a-f]{40}$/);
    expect(o.checkedAt).toBeGreaterThan(1_700_000_000_000);   // ms, and the same value it persists
    expect(o.checkedAt).toBe(Number(h.reg('demo-quiet-basin', 'prcheckedat')));
    expect(o.template).toBeNull();
    expect(o.dirty).toBe(0);
    // …and `dirty` is a COUNT of the worktree's own lines, not a flag.
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'x\n');
    fs.writeFileSync(path.join(wt, 'scratch2.txt'), 'x\n');
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).dirty).toBe(2);
  });

  it('carries each commit\'s sha, subject AND body — all three are read downstream', () => {
    // `body` was the one wire key nothing could fail: with `'body': ''`
    // hardcoded the whole suite stayed green at 561. Task 12's `draftPr` reads
    // `real[0].body.trim().split('\n\n')[0]` for the PR body whenever the repo
    // has no template, so every PR ccrc opens could have shipped with an empty
    // one and no test would have said so. Two paragraphs, because the split is
    // on the blank line and a one-paragraph fixture cannot see it.
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'g.txt'), 'more\n');
    h.git(wt, 'add', 'g.txt');
    h.git(wt, 'commit', '-m', 'the second\n\nwhy it was done\n\nand a second paragraph');
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    // Newest first — `git log base..branch` — which is why draftPr reverses.
    expect(o.commits.map((c: { subject: string }) => c.subject)).toEqual(['the second', 'the work']);
    expect(o.commits[0].body).toBe('why it was done\n\nand a second paragraph');
    expect(o.commits[1].body).toBe('');
    expect(o.commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('carries the repo\'s PR template when it has one', () => {
    // Task 4's composer prefills from this; read from $main, not the worktree,
    // so a workspace that has not merged the template still gets it.
    const { main } = workspaceWithCommit('demo', 'quiet-basin');
    fs.mkdirSync(path.join(main, '.github'), { recursive: true });
    fs.writeFileSync(path.join(main, '.github', 'pull_request_template.md'), '## Why\n\n## Risk\n');
    h.ghRows([]);
    // Interior newlines survive; the trailing one does not — `tmpl=$(cat …)`
    // is a command substitution and those strip trailing newlines. Recorded
    // because Task 4's composer prefills a body from this string.
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).template)
      .toBe('## Why\n\n## Risk');
  });

  it('falls back to origin/HEAD when the registry lost its base', () => {
    // Without the fallback `$base` is empty, the ahead count never runs and a
    // workspace with commits reports `no-commits` — the phase that tells the
    // PWA there is nothing to open a PR for.
    workspaceWithCommit('demo', 'quiet-basin');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.base'));
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.base).toBe('origin/HEAD');
    expect(o.ahead).toBe(1);
    expect(o.phase).toBe('none');
  });
});

describe('dirty is a measurement of OUR tree, or it is null', () => {
  // The one class of read in this verb that must be `-C "$workdir"` — it is a
  // question about that directory's CONTENTS — so it runs only after
  // `_ws_wt_branch` and `_ws_common_dir` have both said `$main`, which is the
  // pair Global Constraints prescribe and `cmd_ws_rm` requires before it touches
  // anything. And it never counts a failure as zero: `0` is the positive claim
  // "nothing here is uncommitted".
  it('is null, not 0, when the worktree directory is gone', () => {
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    fs.rmSync(wt, { recursive: true, force: true });
    h.ghRows([]);
    const out = h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin 2>"$HOME/pr-err"`);
    expect(line(out).dirty).toBeNull();
    // A NOTE, not a refusal: pr-state is read-only and answers for every
    // workspace of the project from one gh call, so one unreadable worktree must
    // not cost the rest of them their PR state. Everything else is still here.
    expect(fs.readFileSync(path.join(h.home, 'pr-err'), 'utf8')).toContain('demo-quiet-basin');
    expect(line(out).phase).toBe('none');
    expect(line(out).repo).toBe('o/r');
  });

  it('never counts a STRANGER repository squatting the workdir as our dirt', () => {
    // The record outlives the directory, so a hand-deletion plus a `git init` at
    // the same path still answers `$branch` from `$main`'s worktree list — which
    // is why the branch rung alone cannot decide the DIRECTORY. Without the
    // common-dir rung this counts the stranger's untracked files and files them
    // under this workspace.
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(wt, { recursive: true });
    h.sh(`cd "${wt}" && git init -q -b ws/quiet-basin .`);
    fs.writeFileSync(path.join(wt, 'theirs1.txt'), 'x\n');
    fs.writeFileSync(path.join(wt, 'theirs2.txt'), 'x\n');
    h.ghRows([]);
    const r = h.run(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    expect(line(r.stdout).dirty).toBeNull();
    expect(line(r.stdout).dirty).not.toBe(2);
  });

  it('is null when the tree is entitled but cannot be READ', () => {
    // The rung the shipped one-liner had no way to reach: the pipe threw git's
    // status away, so `status --porcelain` failing read as an empty, clean tree.
    // An unreadable index is a genuine instance — `--git-common-dir` still
    // answers, so the corroboration passes and only the tree read fails.
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    const idx = path.join(h.home, 'projects', 'demo', '.git', 'worktrees', 'quiet-basin', 'index');
    expect(fs.existsSync(idx)).toBe(true);
    fs.chmodSync(idx, 0o000);
    try {
      expect(() => h.git(wt, 'status', '--porcelain')).toThrow();      // git really cannot read it
      expect(h.sh(`_ws_common_dir "${wt}"`)).toBe(h.sh(`_ws_common_dir "${path.join(h.home, 'projects', 'demo')}"`));
      h.ghRows([]);
      // Redirected to a file, not read from run().stderr: the harness's run()
      // returns stderr '' for any rc-0 command (execFileSync only surfaces
      // stderr on a throw) — same convention as the unentitled test above.
      const out = h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin 2>"$HOME/pr-err"`);
      expect(line(out).dirty).toBeNull();
      // Deviation 11's contract is "null PLUS one line on stderr" — without this
      // assertion the else-arm is deletable with the suite green, and an
      // operator's unreadable index reports dirty:null with nothing naming
      // which workspace or why (re-review N1).
      const err = fs.readFileSync(path.join(h.home, 'pr-err'), 'utf8');
      expect(err).toContain('could not read the tree');
      expect(err).toContain('demo-quiet-basin');
    } finally {
      fs.chmodSync(idx, 0o644);
    }
  });

  it('is null when the tree could only be PARTIALLY read — rc 0 is not an answer', () => {
    // Final-round verification P2, the reporting half of the same class the
    // destructive verbs carry. The test above reaches the exit-code rung (an
    // unreadable index makes git exit non-zero); this reaches the one it cannot
    // see. Measured on git 2.43: `chmod 000` on a TRACKED directory holding a
    // MODIFIED file gives rc 0, EMPTY stdout, and the diagnostic on stderr — so
    // `grep -c .` counted nothing and the wire carried `"dirty":0`, an
    // affirmative "nothing is uncommitted here" about a file nobody looked at.
    // `dirty` already had an honest unmeasured value; this branch just never
    // used it.
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    const tracked = path.join(wt, 'tracked');
    fs.mkdirSync(path.join(tracked, 'deep'), { recursive: true });
    fs.writeFileSync(path.join(tracked, 'deep', 'code.txt'), 'committed\n');
    h.git(wt, 'add', '-A');
    h.git(wt, 'commit', '-m', 'the work');
    fs.writeFileSync(path.join(tracked, 'deep', 'code.txt'), 'UNCOMMITTED\n');
    fs.chmodSync(tracked, 0o000);
    try {
      // The premise, measured in the fixture: rc 0 and empty stdout, which is
      // what makes this a DIFFERENT rung from the unreadable-index test.
      const probe = h.sh(`git -C "${wt}" status --porcelain 2>"$HOME/probe-err"; echo "rc=$?"; `
        + `echo "out=[$(git -C "${wt}" status --porcelain 2>/dev/null)]"; `
        + `echo "err=[$(cat "$HOME/probe-err")]"`);
      expect(probe, probe).toContain('rc=0');
      expect(probe, probe).toContain('out=[]');
      expect(probe, probe).toContain('Permission denied');

      h.ghRows([]);
      const out = h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin 2>"$HOME/pr-err"`);
      expect(line(out).dirty, 'a partial read is UNMEASURED, never a clean 0').toBeNull();
      const err = fs.readFileSync(path.join(h.home, 'pr-err'), 'utf8');
      expect(err).toContain('could not read the tree');
      expect(err).toContain('demo-quiet-basin');
    } finally {
      fs.chmodSync(tracked, 0o755);
    }
  });
});

describe('failure is an ANSWER, not an error', () => {
  it.each([
    [124, '', 'timeout'],
    [1, 'gh: To get started with GitHub CLI, please run: gh auth login', 'unauthenticated'],
    [1, 'HTTP 403: API rate limit exceeded', 'rate-limit'],
    [1, 'dial tcp: lookup api.github.com: no such host', 'offline'],
    // GitHub's own 5xx, VERBATIM as api.github.com/graphql sent it — measured
    // on 2026-08-26 against a live repo with several thousand PRs of history
    // (3/3 attempts, persistent, not a blip) and re-measured byte-for-byte at
    // execution time. This is the shape that produced the mail this work
    // exists for: `pr-unmeasurable: pr-state answered no full line`, with
    // nothing in it a coordinator could act on.
    [1, "HTTP 504: We couldn't respond to your request in time. Sorry about that. "
      + 'Please try resubmitting your request and contact us if the problem persists. '
      + '(https://api.github.com/graphql)', 'unavailable'],
    // The SAME query at `--limit 50` on the same repo the same day: gh got a
    // body and the body stopped mid-stream. rc 1 and an empty answer, exactly
    // like the 504 — and a different fact about the world, which is the whole
    // reason it gets a different token.
    [1, 'unexpected end of JSON input', 'truncated'],
    [1, 'something else entirely', 'error'],
  ])('rc %i maps to reason %s on stdout with exit 0', (rc, stderr, reason) => {
    workspaceWithCommit('demo', 'quiet-basin');
    h.ghFail(rc as number, stderr as string);
    const r = h.run(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ phase: 'unknown', reason });
  });

  // The arms above pin ONE spelling each, and each new arm matches four (or
  // two). An arm reduced to the single alternative its table row happens to
  // carry would leave the table green while `HTTP 502` — the other half of what
  // a GitHub outage actually emits — went back to the catch-all. So every
  // alternative is exercised, and each says out loud what it is NOT.
  //
  // `error` is not a bug; it is the honest name for a fault with no known
  // shape. What is a bug is spending it on two faults whose shape IS known: a
  // 5xx says the far side is unwell and the same query will fail again the same
  // way, and a truncated body says the far side started answering and stopped —
  // one is worth backing off, the other is worth retrying, and `error` says
  // neither.
  it.each([
    ['HTTP 500: Internal Server Error (https://api.github.com/graphql)', 'unavailable'],
    ['HTTP 502: Bad Gateway (https://api.github.com/graphql)', 'unavailable'],
    ['HTTP 503: Service Unavailable (https://api.github.com/graphql)', 'unavailable'],
    ['HTTP 504: We could not respond to your request in time.', 'unavailable'],
    ['unexpected end of JSON input', 'truncated'],
    ['unexpected EOF', 'truncated'],
  ])('%s is classified, not swept into the catch-all', (stderr, reason) => {
    workspaceWithCommit('demo', 'quiet-basin');
    h.ghFail(1, stderr);
    const o = JSON.parse(h.run(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`).stdout);
    expect(o.reason).toBe(reason);
    expect(o.reason, 'a fault with a known shape must not read as an unexplained one').not.toBe('error');
  });

  it('leaves the persisted prphase untouched when the read failed', () => {
    // A failed read must never overwrite the last good answer — that is what
    // makes "last checked 6m ago" honest rather than a fresh-looking lie.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    h.ghFail(124, '');
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    // …and the number with it. The clearing rule below must never be reachable
    // from a failed read: `_gh_pr_list` returns before `_pr_py` is called, and
    // this is what says so.
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
  });

  it.each([
    ['a body that is not JSON at all', 'MALFORMED-AFTER-GOOD'],
    ['a JSON object where a list was promised', '{"pr":"list"}'],
    ['nothing at all on stdout', ''],
  ])('an rc-0 gh answer with %s is unknown/error and writes NOTHING', (_what, body) => {
    // `gh` exiting 0 is not the same as `gh` having ANSWERED. A body that does
    // not parse as a list of rows is a read we could not understand, and the
    // one thing it must never become is `[]` — the empty list is the affirmative
    // answer "this repo has no PR for you", which clears the persisted merge and
    // then reads on the phone as "ready to open a pull request".
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    const before = h.reg('demo-quiet-basin', 'prcheckedat');

    h.ghRaw(body as string);
    const r = h.run(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ phase: 'unknown', reason: 'error' });
    // Every one of the three persisted fields is untouched — including
    // `prcheckedat`, because a reading nobody could parse is not a reading.
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
    expect(h.reg('demo-quiet-basin', 'prcheckedat')).toBe(before);
  });

  it('answers no-remote when the project has no origin', () => {
    const main = path.join(h.home, 'projects', 'bare');
    fs.mkdirSync(main, { recursive: true });
    h.sh(`cd "${main}" && git init -q -b main .`);
    h.sh(`_reg_set bare-x uuid u; _reg_set bare-x wrapper claude; _reg_set bare-x workdir "${main}"
          _reg_set bare-x project bare; _reg_set bare-x workspace x; _reg_set bare-x branch ws/x`);
    expect(JSON.parse(h.sh(`${GH_STUB} cmd_pr_state --session bare-x`)))
      .toEqual({ phase: 'unknown', reason: 'no-remote' });
  });
});

describe('--project', () => {
  it('emits one JSON line per workspace, from a call count that does not move with them', () => {
    // 8 projects x 1 call / 120 s is ~5% of the GraphQL budget. Per session it
    // would be several times that for no extra information — and THAT, not the
    // literal number, is what this has always been about. It used to say it as
    // `toHaveLength(1)`, which stopped being true when Task 3 split the rollups
    // into their own call: a 100-PR window carrying `statusCheckRollup` is
    // answered `HTTP 504`, so `--project` now asks twice, once for the rows and
    // once for the rollups of the PRs that are open.
    //
    // Two is still a CONSTANT, and the constant is what the budget argument
    // rests on, so the assertion is re-stated as the property rather than
    // re-pointed at the new number: count the calls, add a workspace, count
    // again, and require the two counts to be EQUAL. A per-session regression —
    // the shape the comment was written to forbid — fails that at one call, at
    // two, and at any number a later wave arrives at.
    h.makeGhRepo('demo');
    h.makeGhRepo('other', 'o/other');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-cove cmd_ws_add demo`);
    h.sh(`${WS_ADD} CCD_WS_SLUG=amber-ridge cmd_ws_add other`);   // a different repo's
    h.ghRows([]);
    const prListCalls = (): string[] => h.ghCalls().filter((c) => c.startsWith('pr list'));
    const out = h.sh(`${GH_STUB} cmd_pr_state --project demo`).split('\n').filter(Boolean);
    expect(out).toHaveLength(2);
    expect(out.map((l) => JSON.parse(l).id).sort()).toEqual(['demo-quiet-basin', 'demo-still-cove']);
    const forTwo = prListCalls().length;
    // One repo per call, and it is THIS repo: a second project's workspaces are
    // neither listed nor asked about. `every`, not `find`: both calls of the
    // pair have to be about this repo, and reading only the first would let a
    // rollup window aimed anywhere at all through.
    expect(prListCalls().every((c) => c.includes('--repo o/r'))).toBe(true);

    const before = prListCalls().length;
    h.sh(`${WS_ADD} CCD_WS_SLUG=bright-delta cmd_ws_add demo`);
    const out3 = h.sh(`${GH_STUB} cmd_pr_state --project demo`).split('\n').filter(Boolean);
    expect(out3).toHaveLength(3);                          // the third workspace really is in the sweep
    expect(prListCalls().length - before).toBe(forTwo);    // …and it cost no extra call
  });

  it('says nothing, at exit 0, about a project with no workspaces', () => {
    // The unexpanded-glob path: with an empty registry `"$REG"/*.workspace`
    // stays literal, and a sweep lane calling this every 120 s must get silence
    // rather than a line about a file named `*.workspace`.
    const r = h.run('cmd_pr_state --project demo');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(h.ghPoison()).toEqual([]);            // and it never reached gh at all
  });

  it('skips a half-written registry entry rather than reporting it', () => {
    // `.workspace` lands before `.uuid` does. A row for a session that does not
    // exist yet would appear in the fleet and then vanish.
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.sh('_reg_set demo-half workspace half; _reg_set demo-half project demo');
    h.ghRows([]);
    const out = h.sh(`${GH_STUB} cmd_pr_state --project demo`).split('\n').filter(Boolean);
    expect(out.map((l) => JSON.parse(l).id)).toEqual(['demo-quiet-basin']);
  });

  it('ignores main checkouts of that project — they have no branch to bind', () => {
    h.makeGhRepo('demo');
    h.sh(`_reg_set claude-demo uuid u; _reg_set claude-demo wrapper claude
          _reg_set claude-demo workdir "${path.join(h.home, 'projects', 'demo')}"; _reg_set claude-demo project demo`);
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.ghRows([]);
    const out = h.sh(`${GH_STUB} cmd_pr_state --project demo`).split('\n').filter(Boolean);
    expect(out).toHaveLength(1);
  });

  it('applies the id regex to what it read off the directory, not only to argv', () => {
    // `--session` validates its argv and `--project` validates its own, but the
    // ids on THIS path come from a directory listing and had every `$REG/$id.*`
    // path built from them unchecked. The plan's rule is "before any path is
    // built from an id", with no exception for ids ccd wrote itself: a
    // filename cannot hold a `/`, so nothing traversable is reachable and every
    // read here is read-only — this is the rule, applied where it was skipped.
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const reg = path.join(h.home, '.cc-sessions');
    for (const f of ['workspace', 'uuid', 'project']) {
      fs.writeFileSync(path.join(reg, `de mo.${f}`), f === 'project' ? 'demo' : 'x');
    }
    h.ghRows([]);
    const out = h.sh(`${GH_STUB} cmd_pr_state --project demo`).split('\n').filter(Boolean);
    expect(out.map((l) => JSON.parse(l).id)).toEqual(['demo-quiet-basin']);
  });

  it('refuses a registry project it cannot build a path from', () => {
    // `--session` validates the id it was handed; `$main` is then built from a
    // registry VALUE that nothing checked. Same class as the id, same regex,
    // and it `die`s rather than answering, because that is what this verb
    // already does for every other registry-identity error (`no such session`,
    // `not a workspace`).
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.project'), '../../etc');
    const r = h.run(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/bad project/);
    expect(h.ghPoison()).toEqual([]);            // and it died before any gh call
  });

  it('names the SESSION in a per-session failure, so it cannot poison its siblings', () => {
    // A workspace whose registry lost its `branch` is one broken session, not
    // a broken repo. The server backs a whole PROJECT off on the id-LESS
    // failure shape, so if this object omitted the id, one incomplete registry
    // entry would mark every sibling `unknown` and silence the project's sweep
    // lane — §6's "Partial sweep" row promises the opposite.
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-cove cmd_ws_add demo`);
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-still-cove.branch'));
    h.ghRows([]);
    const out = h.sh(`${GH_STUB} cmd_pr_state --project demo`).split('\n').filter(Boolean);
    expect(out).toHaveLength(2);
    const byId = Object.fromEntries(out.map((l) => [JSON.parse(l).id, JSON.parse(l)]));
    expect(byId['demo-still-cove']).toEqual({ id: 'demo-still-cove', phase: 'unknown', reason: 'error' });
    expect(byId['demo-quiet-basin'].phase).toBe('no-commits');   // its sibling is untouched
  });
});

describe('persistence', () => {
  it('writes prphase, prnumber and prcheckedat into the registry', () => {
    // The server cannot write the registry (the agent's write whitelist is
    // .cc-clips only), so the box that reads GitHub is the box that persists.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
    expect(Number(h.reg('demo-quiet-basin', 'prcheckedat'))).toBeGreaterThan(1_700_000_000_000);
  });

  it('CLEARS prnumber when the answer no longer carries one', () => {
    // phase and number are one answer, so a writer that updates half of it
    // lies. A PR that is deleted, force-pushed out of reachability, or whose
    // slug has been recycled leaves {phase:'none', number:42} on disk, and
    // fleet.ts hands that pair straight to the wire — the cap renders `#42`
    // under a phase whose own copy is "no pull request yet". ws-archive reads
    // the same field and would file `archivedreason merged:#42` for a PR that
    // no longer binds to this workspace.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
    h.ghRows([]);                                  // the PR is gone
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('none');
    expect(o.number).toBeNull();
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('none');
  });

  it('never advances prphase past a prnumber write that did not happen', () => {
    // Final-round integration New Finding 9. `prphase` and `prnumber` are two
    // FILES, so no ordering makes the pair atomic — but the order decides which
    // half-written pairs a kill can leave behind, and the shipped one
    // (`put('prphase')` nineteen lines ahead of the number) left exactly
    // {'none', 42}: the pair docket 1 proved otherwise unconstructible, the one
    // fleet.ts renders as `#42` under "no pull request yet", and the one
    // ws-archive files as `merged:#42`. `clear('prnumber')` now runs FIRST, so
    // the intermediates are {old phase, absent} and {new phase, absent} — a
    // degraded reading, never a false one.
    //
    // The interruption is injected where the test can see it: a DIRECTORY at
    // the `prnumber` path makes `os.remove` raise `IsADirectoryError`, which
    // `clear`'s `except FileNotFoundError` does not catch, so the write of the
    // pair aborts at exactly the step the ordering is about. What is asserted
    // is the ordering property itself — the phase must not have moved.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');

    const numberPath = path.join(h.home, '.cc-sessions', 'demo-quiet-basin.prnumber');
    fs.rmSync(numberPath);
    fs.mkdirSync(numberPath);
    h.ghRows([]);                                  // the new answer is {none, no number}
    h.run(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase'),
      'the phase moved to a value whose number never landed').toBe('merged');
    expect(fs.statSync(numberPath).isDirectory(), 'the fixture must survive the run').toBe(true);
  });
});

describe('gh isolation', () => {
  // Both halves of the boundary, because only one of them is a shell function
  // and functions are only shadowing what is on PATH while someone remembers to
  // include them.
  it('reaches the STUB, never the poisoned gh, when the stub is included', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.ghCalls().some((c) => c.startsWith('pr list'))).toBe(true);
    expect(h.ghPoison()).toEqual([]);              // the function won, as bash promises
  });

  it('cannot reach the host gh even when a snippet forgets the stub', () => {
    // /usr/bin/gh is installed here and ~/.config/gh/hosts.yml holds a real
    // token with repo WRITE scope. Without the harness's poisoned gh first on
    // PATH this snippet is a live call to the real github.com/o/r, and every
    // future PR test is one forgotten `${GH_STUB}` away from being one too.
    // What ccd sees is a gh that fails, which is an ANSWER — reason `error`.
    workspaceWithCommit('demo', 'quiet-basin');
    const r = h.run('cmd_pr_state --session demo-quiet-basin');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ phase: 'unknown', reason: 'error' });
    expect(h.ghPoison()).toHaveLength(1);
    expect(h.ghPoison()[0]).toContain('pr list');
    expect(h.ghCalls()).toEqual([]);
  });
});

describe('ccd and prstate.ts agree about phase, always', () => {
  // The predicate exists twice by necessity: ccd persists it (the server
  // cannot write the registry) and prstate.ts puts it on the wire. Drift means
  // the fleet card and the registry disagree about the same PR, silently.
  // This is the device that stops it, and it is the same precedent as
  // _ws_least_loaded vs limits.ts projectHome.
  //
  // EVERY ROW CARRIES ITS EXPECTED PHASE **AND REASON**, and both
  // implementations are asserted against THAT, not against each other.
  // `expect(phaseFor(l).phase).toBe(l.phase)` alone is satisfied by any SHARED
  // misreading — including both sides answering `unknown` because the fixture's
  // origin was unresolvable, which is exactly how this test would have passed
  // while proving nothing. The third and fourth elements are the anchor; if a
  // row's expectation is wrong, one of the four assertions fails and says which
  // side.
  //
  // `reason` is pinned because phase agreement alone let the two drift on it:
  // ccd wrote no reason for the merged-but-unproven row while phaseFor answered
  // `error`, i.e. "GitHub could not be read" about a read that worked.
  type Reason = string | null;
  const matrix: [string, Record<string, unknown>, string, Reason][] = [
    ['merged',          {}, 'merged', null],
    // A fork PR does not bind, and with commits past base an unbound workspace
    // is `none` — ready to compose — never `no-commits`.
    ['fork',            { isCrossRepository: true }, 'none', null],
    ['other base',      { baseRefName: 'release/9' }, 'none', null],
    // THE TWO CONJUNCTS THE MATRIX USED TO HOLD CONSTANT — final-round
    // integration New Finding 8. `bound()` (ccd) and `boundRow()`
    // (prstate.ts:113) are each four conjuncts, and every row above varies one
    // of only two of them: `isCrossRepository` and `baseRefName`. Both
    // `headRefName === branch` and `ours === true` were the same on all seven
    // rows, so DELETING either conjunct from either implementation left all
    // nine agreement cases green — the exact drift this device exists to catch.
    // Measured: with `&& row.headRefName === registryBranch` removed from
    // prstate.ts, the matrix passed.
    //
    // The head-NAME rung: same head commit, same base, same repository, a
    // different branch name. `gh pr list --head` matches the name across fork
    // owners (prstate.ts:102), which is why the name is a conjunct and not a
    // shorthand for the others.
    ['other head name', { headRefName: 'ws/still-cove' }, 'none', null],
    // The `ours` rung, i.e. proof 0: a well-formed head oid this repository
    // has never seen. `is_ours`'s `cat-file -e` rung answers False, ccd
    // annotates `ours: false`, and both sides must then refuse to bind — this
    // is the row a recycled slug and a stranger's fork both produce.
    ['head commit we do not have', { headRefOid: 'b'.repeat(40) }, 'none', null],
    // Binds, but the merge predicate fails a conjunct while gh still says
    // MERGED: `unknown`, never `merged`. The archive trigger hangs off this.
    // The reason is `merge-unproven` and NOT any read-failure token — the gh
    // call succeeded, and this row is the only one in the matrix with a reason.
    ['no merge commit', { mergeCommit: null }, 'unknown', 'merge-unproven'],
    ['open',            { state: 'OPEN', mergedAt: null, mergeCommit: null }, 'open', null],
    ['draft',           { state: 'OPEN', mergedAt: null, mergeCommit: null, isDraft: true }, 'draft', null],
    ['closed',          { state: 'CLOSED', mergedAt: null, mergeCommit: null }, 'closed', null],
  ];

  it.each(matrix)('%s', async (_name, over, expected, expectedReason) => {
    const { phaseFor } = await import('../src/prstate.js');
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, ...over })]);
    const l = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    // A read-failure reason here — `no-remote` is the classic — means the read
    // never got as far as the predicate, and both sides would then agree on
    // `unknown` for a reason that has nothing to do with agreement. Pinning the
    // expected reason per row catches that too: `no-remote` matches no row.
    expect(l.reason, 'ccd disagrees with the matrix about reason').toBe(expectedReason);
    expect(l.phase, 'ccd disagrees with the matrix').toBe(expected);
    const s = phaseFor(l as never);
    expect(s.phase, 'prstate.ts disagrees with the matrix').toBe(expected);
    expect(s.reason, 'prstate.ts disagrees with the matrix about reason').toBe(expectedReason);
  });

  it('agrees that ahead === 0 with no PR is no-commits — and that a bound merge still wins', () => {
    // The third variable New Finding 8 names, and the one the matrix above
    // cannot carry: `ahead` is not a field of the gh row, it is a property of
    // the FIXTURE, and every row above is built on `workspaceWithCommit`, so
    // every one of them has `ahead === 1`. ccd chooses between the two with
    // `('no-commits' if ahead == 0 else 'none')` and `phaseFor` with
    // `line.ahead === 0 ? 'no-commits' : 'none'` (prstate.ts:166) — a whole
    // branch of both implementations that no agreement case ever entered.
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.ghRows([]);
    const l = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(l.ahead, 'the fixture must actually be level with base').toBe(0);
    expect(l.phase, 'ccd').toBe('no-commits');
    const s = phaseFor(l as never);
    expect(s.phase, 'prstate.ts').toBe('no-commits');
    expect(s.reason, 'and neither side invents a reason for it').toBeNull();

    // …and `ahead === 0` never overrides a binding: a level branch whose PR
    // merged is `merged` on both sides. Without this half, an implementation
    // that answered `no-commits` for every ahead-0 line — before consulting
    // `boundRow` at all — would still agree with the first half.
    const tip = h.git(path.join(h.home, 'worktrees', 'demo', 'quiet-basin'), 'rev-parse', 'HEAD');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    const l2 = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(l2.ahead).toBe(0);
    expect(l2.phase, 'ccd').toBe('merged');
    expect(phaseFor(l2 as never).phase, 'prstate.ts').toBe('merged');
  });

  // TWO MORE ROWS THE MATRIX ABOVE CANNOT EXPRESS, because what varies is not a
  // field of the gh row. Task 3's fix round (findings 1 and 2) created both
  // states, and neither had anything for `phaseFor` to agree about before it.
  it('agrees when the registry\'s branch no longer resolves — a bound merge still wins', () => {
    // `git branch -m` inside the worktree. ccd sends `tip: null` and
    // `ahead: null`, the ancestry rung of proof 0 is skipped (there is no tip to
    // reach from) and the row still binds on its other three conjuncts, so BOTH
    // sides must answer `merged`. The trap this pins is `no-commits`: ccd used
    // to compute it from a fabricated `ahead: 0`, and a `phaseFor` written
    // against `(line.ahead ?? 0) === 0` would reproduce the same lie on the wire.
    const { wt, tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.git(wt, 'branch', '-m', 'ws/renamed');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    const l = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(l.tip).toBeNull();
    expect(l.ahead).toBeNull();
    expect(l.phase).toBe('merged');
    expect(phaseFor(l as never).phase).toBe('merged');
    // …and with no PR at all in the same state, `none`, never `no-commits`.
    h.ghRows([]);
    const l2 = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(l2.phase).toBe('none');
    expect(phaseFor(l2 as never).phase).toBe('none');
  });

  it('agrees that an unreadable gh body is a WHOLE-REPO failure, not a line', () => {
    // rc 0 with a body that is not a list of rows. ccd emits the id-less failure
    // object and persists nothing; `parsePrLines` must classify it as
    // `CcdPrFailure` so the sweep backs the project off — reading it as a full
    // line would send it to `phaseFor` with no `rows` and throw inside a
    // void-dispatched sweep.
    workspaceWithCommit('demo', 'quiet-basin');
    h.ghRaw('MALFORMED');
    const out = h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(parsePrLines(out)).toEqual([{ phase: 'unknown', reason: 'error' }]);
    expect(isFullLine(parsePrLines(out)[0]!)).toBe(false);
  });
});

describe('pr-state persists its fields atomically (registry-durability wave 2)', () => {
  it('put() renames rather than truncating, with the same invisible tmp shape as _reg_set', () => {
    const src = readFileSync(CCD, 'utf8');
    const put = /def put\(field, value\):([\s\S]*?)\n\n/.exec(src)?.[1] ?? '';
    expect(put, 'put() must no longer open the destination for writing').not.toMatch(/open\(os\.path\.join\(reg, id_ \+ '\.' \+ field\), 'w'\)/);
    expect(put).toMatch(/os\.replace\(/);
    expect(put, "the tmp must be hidden (leading dot) and not end in the field name").toMatch(/'\.' \+ id_ \+ '\.' \+ field \+/);
    expect(put).toMatch(/\.tmp'/);
  });

  it('the compare-and-set lock is a DEDICATED file, never the .uuid that _reg_set now replaces', () => {
    // `flock` attaches to an INODE. `_reg_set "$id" uuid` renames a new inode
    // over `.uuid` (wave 2), so two `ccd pr-state` runs straddling a uuid
    // rewrite would lock two different inodes and BOTH enter the
    // compare-and-set — the duplicate prhistory append and the lost update
    // this lock exists to prevent. A dedicated file is never replaced.
    const src = readFileSync(CCD, 'utf8');
    expect(src).not.toMatch(/lock_f = open\(os\.path\.join\(reg, id_ \+ '\.uuid'\)\)/);
    expect(src).toMatch(/\.prstate-'/);
  });

  it('still persists phase and number, and creates the lock file on first use', () => {
    // The exact idiom of `describe('binding')`'s "reports merged when every
    // conjunct holds": `GH_STUB` is a shell-function STRING prefixed to the
    // snippet, and the rows go in through `h.ghRows`.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.prstate-demo-quiet-basin.lock'))).toBe(true);
    // And the tmp is gone, and nothing it left behind can mint a session id.
    const names = fs.readdirSync(path.join(h.home, '.cc-sessions'));
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(names.filter((n) => n.endsWith('.uuid'))).toEqual(['demo-quiet-basin.uuid']);
  });
});

/**
 * THE DEFECT THE REAP WAVE SURFACED (D-178). `swift-delta`'s `.prphase` read
 * `no-commits` while its worktree held 27 commits — on a branch the registry
 * had never heard of. Both halves were true and neither was about the same
 * branch: the poller measured the REGISTRY's `branch`, which still resolved and
 * was still level with its base, so `ahead=0` was a fact about a branch nobody
 * was working in, and `no-commits` is the claim built from it.
 *
 * What it costs downstream is not cosmetic: `no-commits` hard-disables the
 * PWA's "Open pull request" composer (only `none` renders it), it is in
 * `verifyDone`'s regressed set, and the first poll of the mismatch retires the
 * live `prnumber` into the append-only `.prhistory`.
 */
describe('a workspace whose worktree is parked on another branch', () => {
  /** The shape that lies: the registry's branch resolves AND is level with its
   *  base (so the old answer was `no-commits`, confidently), while git has the
   *  worktree on another branch carrying real work. */
  const parked = (): { id: string; main: string; wt: string } => {
    const main = h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
    h.sh(`cd "${wt}" && git checkout -q -b feat/x`);
    fs.writeFileSync(path.join(wt, 'later.txt'), 'work the registry cannot see\n');
    h.git(wt, 'add', 'later.txt');
    h.git(wt, 'commit', '-m', 'work on the other branch');
    return { id: 'demo-quiet-basin', main, wt };
  };

  it('says unknown/branch-drift rather than no-commits about a branch nobody is in', () => {
    const { id, main } = parked();
    // The precondition that made the old answer confident: the registry's
    // branch is real and level with base.
    expect(h.git(main, 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin')).toMatch(/^[0-9a-f]{40}$/);
    expect(h.git(main, 'rev-list', '--count', 'origin/main..refs/heads/ws/quiet-basin')).toBe('0');
    const l = line(h.sh(`${GH_STUB} _pr_state_one ${id} "${main}" o/r '[]'`));
    expect(l.id).toBe(id);
    expect(l.phase).toBe('unknown');
    expect(l.reason).toBe('branch-drift');
  });

  it('persists NOTHING on that answer — the last honest values stand', () => {
    // The reason this is not "just switch the source". `_pr_state_one` writes
    // three registry fields and appends to an irreversible lineage ledger; a
    // poller that re-bound every drifted workspace to git's branch would clear
    // `prnumber` and write one `.prhistory` line per workspace on the first
    // sweep after deploy. Saying `unknown` writes nothing at all.
    const { id, main } = parked();
    h.sh(`_reg_set ${id} prphase merged; _reg_set ${id} prnumber 577; _reg_set ${id} prcheckedat 1786000000`);
    const before = ['prphase', 'prnumber', 'prcheckedat'].map((f) => h.reg(id, f));
    h.sh(`${GH_STUB} _pr_state_one ${id} "${main}" o/r '[]'`);
    expect(['prphase', 'prnumber', 'prcheckedat'].map((f) => h.reg(id, f))).toEqual(before);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.prhistory`))).toBe(false);
  });

  it('leaves the RENAME shape alone — it was already saying it had not measured', () => {
    // The negative control, and the reason the rung tests `tip` as well as the
    // two names. `git branch -m` inside the worktree drifts the two records
    // too, but there the registry's branch stops RESOLVING, so `tip` and
    // `ahead` are already null and this function already says "unmeasured"
    // rather than inventing a phase. Four cases in this file pin that shape;
    // this asserts the new rung did not swallow them.
    const { main, wt } = workspaceWithCommit('demo', 'quiet-basin');
    h.sh(`cd "${wt}" && git branch -q -m ws/renamed`);
    const l = line(h.sh(`${GH_STUB} _pr_state_one demo-quiet-basin "${main}" o/r '[]'`));
    expect(l.reason).not.toBe('branch-drift');
    expect(l.tip).toBeNull();
    expect(l.ahead).toBeNull();
  });
});
