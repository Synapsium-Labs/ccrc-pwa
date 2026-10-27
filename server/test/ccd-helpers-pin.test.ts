// ccd's refusal-helper, token and lock pins (D-7071; ARCH-45, Task C5d; plan 2026-10-27-consolidation-w5-ccd-helpers.md;
// spec K2, §5.1 rule 1): the characterization C5e, C5f and C5g move code under. Green on the old code, and kept
// byte-identical through the series except where a task names the line it changes:
//   - THE TOKEN SETS. Every set the fifteen scanner files harvest from the two refusal helpers' calls, as a literal sorted
//     list, computed twice: by the scanner's own regex over its own slice (the `BASE_HARVESTS` table, base-only), and by
//     `census-w5/ccdHelpers.ts#refuseWords` over the same scope. C5e deletes `BASE_HARVESTS` and its one use per row.
//   - THE BEHAVIOUR ROWS read their helper names from `REFUSE_HELPERS`; C5e changes that one line to `['_ws_refuse']`.
//   - "the two helper bodies are byte-identical" cannot hold at one definition, and C5e replaces it in its rename commit.
//   - THE TOKEN ROW: a literal token over fixed facts, through both minters (C5f makes them one encoding).
//   - THE LOCK ROWS: each verb's in-progress decline and its flock-unavailable refusal, byte for byte (C5g's runner).
// FIXTURE HOMEs only (`makePrHarness`): no row runs a verb against a live HOME, and every lock holder is killed.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ccdSource } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { readJournal } from './lifecycleHelpers.js';
import { itLinux } from './platformFixtures.js';
import { COL_ID, IDLE_FLOOR_SEAM, makeOrphan } from './wsCollectFixture.js';
import { functionSpan, markedSpan, refuseHelperDefs, refuseWords } from './census-w5/ccdHelpers.js';

const src = ccdSource();

/** ccd's text from `from` to the first `to` after it, each asserted, as `collect-readers.test.ts`'s `between`. */
const span = (from: string, to: string): [number, number] => {
  const a = src.indexOf(from);
  expect(a, `ccd: ${JSON.stringify(from)} is gone`).toBeGreaterThan(-1);
  const b = src.indexOf(to, a + from.length);
  expect(b, `ccd: ${JSON.stringify(to)} does not follow ${JSON.stringify(from)}`).toBeGreaterThan(a);
  return [a, b];
};
const nonComment = (t: string): string => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const marker = (m: string): number => { const i = src.indexOf(m); expect(i, `ccd: the ${m} marker`).toBeGreaterThan(0); return i; };
/** `ccd-wsaudit-nonpoison.test.ts`'s cut: the RECLAIM, MIRROR, EXPIRE and COLLECT blocks, whole lines. */
const NONPOISON_BLOCKS = (): [number, number][] =>
  ([['RECLAIM-BEGIN', 'RECLAIM-END'], ['MIRROR-BEGIN', 'MIRROR-END'], ['EXPIRE-BEGIN', 'EXPIRE-END'], ['COLLECT-BEGIN', 'COLLECT-END']] as const)
    .map(([b, e]) => markedSpan(src, b, e)!);
const withoutBlocks = (): string => {
  let out = src;
  for (const [a, b] of NONPOISON_BLOCKS()) out = out.replace(src.slice(a, b), '');
  return out;
};
/** The three shapes `ccd-wsaudit-nonpoison.test.ts`'s scan harvests besides a refusal helper's call: not base-only. */
const otherShapes = (t: string): string[] => [
  ...[...t.matchAll(/"refused":"([a-zA-Z0-9-]+)"/g)].map((m) => m[1]!),
  ...[...t.matchAll(/'!([a-zA-Z0-9-]+)/g)].map((m) => m[1]!),
  ...[...t.matchAll(/"verdict":"([a-zA-Z0-9-]+)"/g)].map((m) => m[1]!).filter((w) => w !== 'reapable'),
];
const sorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

// BASE-ONLY: C5e (D-7072) deletes this table and its one use in each set row; the literal lists stay byte-identical.
const BASE_HARVESTS: Record<string, { file: string; re: RegExp; slice: () => string }> = {
  reapWhole: { file: 'wsaudit.test.ts', re: /_reap_refuse\s+([a-zA-Z][a-zA-Z0-9_-]*)\b/g, slice: () => src },
  reapEval: { file: 'workspace-refusal-census.test.ts', re: /_reap_refuse ([a-z][a-z-]*)/g, slice: () => nonComment(src.slice(...functionSpan(src, '_ws_reap_eval'))) },
  reclaim: { file: 'child-reclaim.test.ts', re: /_reap_refuse ([a-z][a-z-]*)/g, slice: () => nonComment(src.slice(marker('RECLAIM-BEGIN'), marker('RECLAIM-END'))) },
  expire: { file: 'archived-expiry-policy.test.ts', re: /_reap_refuse ([a-z][a-z-]*)/g, slice: () => nonComment(src.slice(marker('EXPIRE-BEGIN'), marker('EXPIRE-END'))) },
  ladder: { file: 'archived-expiry-policy.test.ts', re: /_reap_refuse ([a-z][a-z-]*)/g, slice: () => nonComment(src.slice(...functionSpan(src, '_ws_reclaim_ladder'))) },
  collectWhole: { file: 'collect-pacing.test.ts', re: /\b_ws_collect_refuse ([a-z-]+) /g, slice: () => src },
  collectMarked: { file: 'ccd-refusal-scan.test.ts', re: /_ws_collect_refuse\s+([a-z][a-z0-9-]*)/g, slice: () => src.slice(marker('COLLECT-BEGIN'), marker('COLLECT-END')) },
  collectRegion: { file: 'collect-readers.test.ts', re: /_ws_collect_refuse ([a-z][a-z-]*)/g, slice: () => nonComment(src.slice(...span('\n_ws_collect_enc() {', '\n# COLLECT-V1.'))) },
  nonpoison: { file: 'ccd-wsaudit-nonpoison.test.ts', re: /_reap_refuse\s+([a-zA-Z][a-zA-Z0-9_-]*)\b/g, slice: withoutBlocks },
};
const harvest = (key: string): string[] => {
  const h = BASE_HARVESTS[key]!;
  return sorted([...h.slice().matchAll(h.re)].map((m) => m[1]!));
};

describe('the token sets each scanner builds from the refusal helpers\' calls (D-7071): literal, both ways', () => {
  it('wsaudit.test.ts, ccd-swap-refuse.test.ts and ccd-actor-flags.test.ts: the reap family over the whole source, 49 words', () => {
    const WORDS = ['attached', 'base-missing', 'branch-elsewhere', 'branch-missing', 'child', 'child-branch-elsewhere', 'child-busy',
      'child-dirty', 'child-record-stale', 'child-unpushed', 'clips-unreadable', 'containment-unproven', 'detached-head', 'dirty-tree',
      'fetch-failed', 'foreign-worktree', 'gh-unreadable', 'held', 'in-use', 'incomplete-registry', 'live', 'merge-commit-missing',
      'nested-checkouts-present', 'no-bound-pr', 'no-remote', 'no-such-session', 'no-upstream', 'no-worktree-record', 'not-a-child',
      'not-a-workspace', 'not-archived', 'not-expired', 'not-idle', 'paused', 'pr-fields-malformed', 'pr-head-not-ours',
      'reap-in-progress', 'reclaim-in-progress', 'sensitive-ignored', 'session-busy', 'stash-unreadable', 'stashes-present',
      'state-changed', 'status-unknown', 'tree-busy', 'tree-differs', 'tree-unreadable', 'unpushed-commits', 'worktree-missing'];
    expect(WORDS).toHaveLength(49);
    expect(harvest('reapWhole')).toEqual(WORDS);
    expect(refuseWords('reap')).toEqual(WORDS);
  });

  it('workspace-refusal-census.test.ts: the reap family in `_ws_reap_eval`, 35 words', () => {
    const WORDS = ['base-missing', 'branch-elsewhere', 'branch-missing', 'child-branch-elsewhere', 'child-busy', 'child-dirty',
      'child-record-stale', 'child-unpushed', 'clips-unreadable', 'detached-head', 'dirty-tree', 'fetch-failed', 'foreign-worktree',
      'gh-unreadable', 'incomplete-registry', 'merge-commit-missing', 'nested-checkouts-present', 'no-bound-pr', 'no-remote',
      'no-such-session', 'no-upstream', 'no-worktree-record', 'not-a-workspace', 'not-archived', 'pr-fields-malformed',
      'pr-head-not-ours', 'sensitive-ignored', 'session-busy', 'stash-unreadable', 'stashes-present', 'status-unknown', 'tree-differs',
      'tree-unreadable', 'unpushed-commits', 'worktree-missing'];
    expect(WORDS).toHaveLength(35);
    expect(harvest('reapEval')).toEqual(WORDS);
    const [from, to] = functionSpan(src, '_ws_reap_eval');
    expect(refuseWords('reap', { from, to, codeOnly: true })).toEqual(WORDS);
  });

  it('child-reclaim.test.ts: the reap family in the RECLAIM region, comment lines dropped, 14 words', () => {
    const WORDS = ['attached', 'branch-elsewhere', 'containment-unproven', 'held', 'no-such-session', 'no-worktree-record', 'not-a-child',
      'not-a-workspace', 'not-idle', 'paused', 'reap-in-progress', 'state-changed', 'tree-busy', 'tree-unreadable'];
    expect(WORDS).toHaveLength(14);
    expect(harvest('reclaim')).toEqual(WORDS);
    expect(refuseWords('reap', { from: marker('RECLAIM-BEGIN'), to: marker('RECLAIM-END'), codeOnly: true })).toEqual(WORDS);
  });

  it('archived-expiry-policy.test.ts: the reap family in the EXPIRE region, comment lines dropped, 12 words', () => {
    const WORDS = ['child', 'held', 'in-use', 'live', 'no-such-session', 'not-a-workspace', 'not-archived', 'not-expired', 'paused',
      'reap-in-progress', 'reclaim-in-progress', 'state-changed'];
    expect(WORDS).toHaveLength(12);
    expect(harvest('expire')).toEqual(WORDS);
    expect(refuseWords('reap', { from: marker('EXPIRE-BEGIN'), to: marker('EXPIRE-END'), codeOnly: true })).toEqual(WORDS);
  });

  it('archived-expiry-policy.test.ts: the reap family in `_ws_reclaim_ladder`, comment lines dropped, 9 words', () => {
    const WORDS = ['attached', 'branch-elsewhere', 'containment-unproven', 'held', 'no-worktree-record', 'not-a-workspace', 'paused',
      'tree-busy', 'tree-unreadable'];
    expect(WORDS).toHaveLength(9);
    expect(harvest('ladder')).toEqual(WORDS);
    const [from, to] = functionSpan(src, '_ws_reclaim_ladder');
    expect(refuseWords('reap', { from, to, codeOnly: true })).toEqual(WORDS);
  });

  it('collect-pacing.test.ts: the collector family over the whole source, 10 words', () => {
    const WORDS = ['changed-recently', 'containment-unproven', 'in-progress', 'in-use', 'not-loose', 'not-witnessed', 'paused',
      'quarantine-kept', 'registered', 'witness-mismatch'];
    expect(WORDS).toHaveLength(10);
    expect(harvest('collectWhole')).toEqual(WORDS);
    expect(refuseWords('collect')).toEqual(WORDS);
  });

  it('ccd-refusal-scan.test.ts: the collector family in the COLLECT region, 9 words', () => {
    const WORDS = ['changed-recently', 'containment-unproven', 'in-progress', 'in-use', 'not-witnessed', 'paused', 'quarantine-kept',
      'registered', 'witness-mismatch'];
    expect(WORDS).toHaveLength(9);
    expect(harvest('collectMarked')).toEqual(WORDS);
    expect(refuseWords('collect', { from: marker('COLLECT-BEGIN'), to: marker('COLLECT-END') })).toEqual(WORDS);
  });

  it('collect-readers.test.ts: the collector family between `_ws_collect_enc` and `# COLLECT-V1.`, comment lines dropped, 9 words', () => {
    const WORDS = ['changed-recently', 'containment-unproven', 'in-progress', 'in-use', 'not-witnessed', 'paused', 'quarantine-kept',
      'registered', 'witness-mismatch'];
    expect(WORDS).toHaveLength(9);
    expect(harvest('collectRegion')).toEqual(WORDS);
    const [from, to] = span('\n_ws_collect_enc() {', '\n# COLLECT-V1.');
    expect(refuseWords('collect', { from, to, codeOnly: true })).toEqual(WORDS);
  });

  it('ccd-wsaudit-nonpoison.test.ts: the four-shape set outside the reclaim, mirror, expire and collect blocks, 55 words', () => {
    const WORDS = ['bad-args', 'bad-branch', 'base-missing', 'branch-elsewhere', 'branch-missing', 'branch-moved', 'child-branch-elsewhere',
      'child-branch-unmerged-locally', 'child-busy', 'child-dirty', 'child-record-stale', 'child-unpushed', 'clips-unreadable', 'detached',
      'detached-head', 'dirty-tree', 'fetch-failed', 'foreign-worktree', 'gh-unreadable', 'has-upstream', 'held', 'in-progress',
      'incomplete-registry', 'merge-commit-missing', 'name-taken-local', 'name-taken-origin', 'nested-checkouts-present', 'no-bound-pr',
      'no-remote', 'no-such-session', 'no-upstream', 'no-worktree-record', 'not-a-workspace', 'not-archived', 'not-merged',
      'pr-fields-malformed', 'pr-head-not-ours', 'reap-interrupted', 'reaping-phase-unknown', 'registry-branch-drift',
      'sensitive-ignored', 'session-busy', 'stash-unreadable', 'stashes-present', 'state-changed', 'status-unknown',
      'tombstone-unwritable', 'tree-differs', 'tree-unreadable', 'unchanged', 'unpushed-commits', 'worktree-foreign', 'worktree-missing',
      'worktree-remove-failed', 'worktree-unregistered'];
    expect(WORDS).toHaveLength(55);
    const others = otherShapes(withoutBlocks());
    expect(sorted([...harvest('nonpoison'), ...others])).toEqual(WORDS);
    expect(sorted([...refuseWords('reap', { exclude: NONPOISON_BLOCKS() }), ...others])).toEqual(WORDS);
  });
});

// The helpers' names, read by every behaviour row. C5e changes this one line to `['_ws_refuse']`.
const REFUSE_HELPERS = ['_reap_refuse', '_ws_collect_refuse'];

let h: PrHarness | undefined;
afterEach(() => { h?.cleanup(); h = undefined; });
const harness = (): PrHarness => (h = makePrHarness('c5d-helpers-'));

describe('the refusal helpers\' behaviour (D-7071): set the verdict, return 1, print nothing', () => {
  for (const name of REFUSE_HELPERS) {
    it(`${name} w 'a detail': rc 1, REAP_VERDICT and REAP_DETAIL set to its two arguments, nothing on stdout or stderr`, () => {
      const x = harness();
      const out = x.sh(`REAP_VERDICT=before REAP_DETAIL=before; ${name} w 'a detail' >"$HOME/out" 2>"$HOME/err"; rc=$?;`
        + ` printf '%s|%s|%s' "$rc" "$REAP_VERDICT" "$REAP_DETAIL"`);
      expect(out).toBe('1|w|a detail');
      expect(fs.readFileSync(path.join(x.home, 'out'), 'utf8'), 'prints nothing on stdout').toBe('');
      expect(fs.readFileSync(path.join(x.home, 'err'), 'utf8'), 'prints nothing on stderr').toBe('');
    });

    it(`\`false || ${name} w d; echo $?\` prints 1 (the \`_ws_reap_leaf_ok\` shape: its status is the helper's)`, () => {
      expect(harness().sh(`false || ${name} w d; echo $?`)).toBe('1');
    });
  }
});

describe('the refusal helpers\' definitions (D-7071)', () => {
  // C5e replaces this row in its rename commit: it cannot hold at one definition.
  it('the two helper bodies are byte-identical', () => {
    const defs = refuseHelperDefs();
    expect(defs.map((d) => d.name)).toEqual(['_reap_refuse', '_ws_collect_refuse']);
    expect(defs[0]!.body).toBe('REAP_VERDICT="$1"; REAP_DETAIL="$2"; return 1;');
    expect(defs[1]!.body).toBe(defs[0]!.body);
  });
});

describe('the token encoding (D-7071): one literal token over fixed facts, through both minters', () => {
  // The fourteen facts of `ccd-ws-audit.test.ts`'s "fingerprints fourteen DISTINCT facts" row, in their order, and the
  // names `_ws_fingerprint` writes them under.
  const FACTS = ['id', 'branch', 'tip', 'head', 'merge', 'proof', '0', 'igndigest', 'sensdigest', '0', 'wthead', 'baseoid', 'clipsdigest', 'childdigest'];
  const NAMES = ['id', 'branch', 'tip', 'headRefOid', 'mergeCommit', 'proof', 'dirtyCount', 'ignoredDigest', 'sensitiveDigest', 'stashCount',
    'worktreeHead', 'baseOid', 'clipsDigest', 'childrenDigest'];
  const TOKEN = '16e172dccd75d76b39dddb8974089882da8de662a24c365ab991ab4e6b8bf8b5';

  it('`_ws_fingerprint` over the fourteen facts is a literal token, and `_ws_reclaim_fingerprint` over the same name=value words is the same token', () => {
    const x = harness();
    const fp = x.sh(`_ws_fingerprint ${FACTS.map((f) => `'${f}'`).join(' ')}`);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).toBe(TOKEN);
    expect(x.sh(`_ws_reclaim_fingerprint ${NAMES.map((n, i) => `'${n}=${FACTS[i]}'`).join(' ')}`)).toBe(TOKEN);
  });
});

describe('the reap lock\'s decline and its refusal, byte for byte (D-7071)', () => {
  const ID = 'project-a-quiet-lock';
  const TOK = 'a'.repeat(64);
  const NOFLOCK = 'command() { [[ "${1-}" == -v && "${2-}" == flock ]] && return 1; builtin command "$@"; };';
  const ROWS: ReadonlyArray<{ act: string; verb: string; call: (id: string) => string; detail: (id: string) => string; linux: boolean; pre: string }> = [
    { act: 'reap', verb: 'ws-reap', call: (id) => `cmd_ws_reap --expect ${TOK} --session ${id}`,
      detail: (id) => `another ccd process is already reaping ${id} and still holds the lock`, linux: false, pre: '' },
    { act: 'reclaim', verb: 'ws-reclaim', call: (id) => `cmd_ws_reclaim --expect ${TOK} --child-of 7 --session ${id}`,
      detail: (id) => `another ccd process is already reaping or reclaiming ${id} and still holds the lock`, linux: false, pre: '' },
    { act: 'expire', verb: 'ws-expire', call: (id) => `cmd_ws_expire --expect ${TOK} --session ${id}`,
      detail: (id) => `another ccd process is already reaping, reclaiming, expiring or restoring ${id} and still holds the lock`, linux: false, pre: '' },
    // The collector reaches its lock only past its witness and pre-lock probes, which are Linux's (`ccd-ws-collect-verb.test.ts`).
    { act: 'collect', verb: 'ws-collect', call: (id) => `cmd_ws_collect --expect ${TOK} --session ${id}`,
      detail: (id) => `another ccd process is already reaping, reclaiming, expiring, restoring or collecting ${id} and still holds the lock`,
      linux: true, pre: IDLE_FLOOR_SEAM },
  ];
  /** A REAL second holder of the reap lock: a subshell that opens it, takes it, and execs `sleep`, so killing `$!` frees it. */
  const holding = (lock: string, body: string): string => `: > "${lock}"
    ( exec {fd}>>"${lock}"; flock -n "$fd" || exit 1; touch "$HOME/held"; exec sleep 25 ) >/dev/null 2>&1 &
    hp=$!
    for _ in $(seq 200); do [[ -f "$HOME/held" ]] && break; sleep 0.05; done
    [[ -f "$HOME/held" ]] || { kill -9 "$hp" 2>/dev/null; echo "the holder never took the lock"; exit 1; }
    ${body}
    kill -9 "$hp" 2>/dev/null; wait "$hp" 2>/dev/null || true`;

  for (const r of ROWS) {
    const row = r.linux ? itLinux : it;
    row(`${r.verb}: a held reap lock answers exactly its in-progress document at rc 0, with one journal row`, () => {
      const x = harness();
      const id = r.act === 'collect' ? COL_ID : ID;
      if (r.act === 'collect') makeOrphan(x);
      const lock = path.join(x.home, '.cc-sessions', `.reap-${id}.lock`);
      const out = x.sh(holding(lock, `${r.pre} ${r.call(id)} >"$HOME/out" 2>"$HOME/err"; echo "rc=$?"`));
      expect(out).toBe('rc=0');
      expect(fs.readFileSync(path.join(x.home, 'out'), 'utf8'))
        .toBe(`{"refused":"in-progress","detail":${JSON.stringify(r.detail(id))},"paths":[]}\n`);
      expect(fs.readFileSync(path.join(x.home, 'err'), 'utf8')).toBe('');
      const rows = readJournal(x.home).filter((e) => e['act'] === r.act);
      expect(rows.map((e) => [e['outcome'], e['verb'], e['refusal'], e['detail'], e['id']]))
        .toEqual([['refused', r.verb, 'in-progress', r.detail(id), id]]);
    }, 30000);

    row(`${r.verb}: with flock absent, stderr is exactly the refusal line and the die sentence, rc 1, nothing on stdout`, () => {
      const x = harness();
      const id = r.act === 'collect' ? COL_ID : ID;
      if (r.act === 'collect') makeOrphan(x);
      expect(x.sh(`${r.pre} ${NOFLOCK} ( ${r.call(id)} ) >"$HOME/out" 2>"$HOME/err"; echo "rc=$?"`)).toBe('rc=1');
      expect(fs.readFileSync(path.join(x.home, 'out'), 'utf8')).toBe('');
      expect(fs.readFileSync(path.join(x.home, 'err'), 'utf8')).toBe(
        `ccd-refusal: ${r.act} flock-unavailable\nccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised\n`);
    }, 30000);
  }
});
