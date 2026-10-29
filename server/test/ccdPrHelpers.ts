// The stub layer for every PR/reap ccd test, on top of `ccdWsHelpers.ts`'s
// harness. `gh` here is a SHELL FUNCTION and bash resolves functions before
// PATH, so it answers whenever a snippet includes GH_STUB; when one does not,
// the base harness's poisoned `gh` answers and the host's real `gho_` token is
// still unreachable. `timeout` is shadowed too, because ccd wraps every gh call
// in it and the stub must not be bypassed.
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

/** gh prints $HOME/gh-rows.json, exits with $HOME/gh-rc (default 0), echoes
 *  $HOME/gh-err to stderr — except that `gh pr view <n>` prints
 *  $HOME/gh-view-<n>.json and a `--search` list prints $HOME/gh-search.json
 *  when that file exists (`ghView`/`ghSearch`), and `gh pr view <n>` fails
 *  with $HOME/gh-view-<n>.rc when that exists (`ghViewFail`: an issue number, a
 *  missing one, or a train GitHub would not show) and prints $HOME/gh-view-<n>.err
 *  to stderr, so one fixture can answer the
 *  PR list, a member's comments and a train PR differently — and appends its argv to $HOME/gh-calls so the exact
 *  flags are assertable. `timeout N cmd…` drops N and runs cmd, so a stubbed
 *  rc of 124 reproduces a real timeout exactly — and it LOGS its own argv
 *  first, because the wrapper is the only bound on a blocking DNS hang and a
 *  stub that silently swallowed it would let ccd drop `timeout` with the whole
 *  suite still green. */
export const GH_STUB = `
gh() {
  printf '%s\\n' "$*" >> "$HOME/gh-calls"
  [[ -f "$HOME/gh-err" ]]       && cat "$HOME/gh-err" >&2
  if [[ "$1 $2" == "pr view" && -f "$HOME/gh-view-$3.rc" ]]; then
    [[ -f "$HOME/gh-view-$3.err" ]] && cat "$HOME/gh-view-$3.err" >&2
    return "$(cat "$HOME/gh-view-$3.rc")"
  elif [[ "$1 $2" == "pr view" && -f "$HOME/gh-view-$3.json" ]]; then cat "$HOME/gh-view-$3.json"
  elif [[ " $* " == *" --search "* && -f "$HOME/gh-search.json" ]]; then cat "$HOME/gh-search.json"
  elif [[ -f "$HOME/gh-rows.json" ]]; then cat "$HOME/gh-rows.json"
  fi
  local rc=0; [[ -f "$HOME/gh-rc" ]] && rc=$(cat "$HOME/gh-rc")
  return "$rc"
};
timeout() { case "$1" in -*) return 125 ;; esac; printf 'timeout %s\\n' "$*" >> "$HOME/gh-calls"; shift; "$@"; };
`;

/** What gh prints, rc 1, for `gh pr view <n>` on an issue or a number with no PR: GitHub's definitive answer. */
export const notAPullRequest = (n: number): string =>
  `GraphQL: Could not resolve to a PullRequest with the number of ${n}. (repository.pullRequest)\n`;
/** What gh prints, rc 1, when GitHub answers 502: transient, so a train read this way is UNREAD (D-7381). */
export const GH_HTTP_502 = 'HTTP 502: Bad Gateway (https://api.github.com/graphql)\n';
/** What gh prints, rc 1, on a rate limit: transient, UNREAD. */
export const GH_RATE_LIMITED = 'GraphQL: API rate limit exceeded for user ID 1. (RATE_LIMITED)\n';

export interface PrHarness extends CcdHarness {
  /** What the stubbed `gh pr list` returns. */
  ghRows(rows: unknown[]): void;
  /** The stubbed `gh pr list`'s stdout, BYTE FOR BYTE — for the bodies that are
   *  not a JSON array at all. `ghRows` can only express well-formed answers, so
   *  without this the rc-0-with-an-unintelligible-body path has no fixture. */
  ghRaw(body: string): void;
  /** Make the stubbed gh fail: rc plus the stderr it prints. 124 = timeout. */
  ghFail(rc: number, stderr: string): void;
  /** What the stubbed `gh pr view <n>` returns, one object per PR number. */
  ghView(n: number, body: unknown): void;
  /** Make the stubbed `gh pr view <n>` fail with `rc` and `stderr`. The default is
   *  what gh answers for an issue or a missing number: rc 1 and GitHub's
   *  `Could not resolve to a PullRequest` (definitive, D-7381); any other rc
   *  defaults to no stderr. Pass `GH_HTTP_502` for a transient rc-1 failure. */
  ghViewFail(n: number, rc?: number, stderr?: string): void;
  /** What the stubbed `gh pr list … --search …` returns. */
  ghSearch(rows: unknown[]): void;
  ghCalls(): string[];
  /** Run a snippet, returning the failure instead of throwing. */
  run(snippet: string): { code: number; stdout: string; stderr: string };
}

export function makePrHarness(prefix: string): PrHarness {
  // The poisoned `gh` and the PATH that puts it first are the BASE harness's
  // (`ccdWsHelpers.ts`), not this file's: `makeGhRepo` — the fixture that makes
  // every PR verb functional — lives there too, so containment has to live
  // wherever a gh call can be written, which is all six ccd test files. What
  // this harness adds on top is the STUB and its logging: GH_STUB is a shell
  // function, and bash resolves functions before PATH, so it wins whenever a
  // snippet includes it and the poison answers whenever one forgets.
  const h = makeCcdHarness(prefix);
  const at = (n: string): string => path.join(h.home, n);
  const sh = h.sh;
  const lines = (n: string): string[] => (fs.existsSync(at(n))
    ? fs.readFileSync(at(n), 'utf8').split('\n').filter(Boolean) : []);

  return {
    ...h,
    ghRows: (rows) => { fs.writeFileSync(at('gh-rows.json'), JSON.stringify(rows)); },
    ghRaw: (body) => { fs.writeFileSync(at('gh-rows.json'), body); },
    ghFail: (rc, stderr) => {
      fs.writeFileSync(at('gh-rc'), String(rc));
      fs.writeFileSync(at('gh-err'), stderr);
    },
    ghView: (n, body) => { fs.writeFileSync(at(`gh-view-${n}.json`), JSON.stringify(body)); },
    ghViewFail: (n, rc = 1, stderr = rc === 1 ? notAPullRequest(n) : '') => {
      fs.writeFileSync(at(`gh-view-${n}.rc`), String(rc));
      fs.writeFileSync(at(`gh-view-${n}.err`), stderr);
    },
    ghSearch: (rows) => { fs.writeFileSync(at('gh-search.json'), JSON.stringify(rows)); },
    ghCalls: () => lines('gh-calls'),
    run: (snippet) => {
      try { return { code: 0, stdout: sh(snippet), stderr: '' }; }
      catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
      }
    },
  };
}

/** `_cfg_dir` (ccd:10366-10375) as a lookup. Which wrapper `_ws_least_loaded`
 *  happened to pick is what decides where Claude Code keeps that session's
 *  transcript, so every assertion about a transcript path reads the registry's
 *  `wrapper` field and comes through here — hardcoding `.claude` is right for
 *  exactly one of the four wrappers and silently wrong for the other three. */
export const CFG_DIR: Record<string, string> = {
  claude: '.claude', 'claude-a': '.claude-a',
  'claude-b': '.claude-b', gpt: '.claude-gpt',
  'claude-d': '.claude-d',
};

/** A gh row for a PR on `head`, merged into `base` by `mergeOid`, whose head
 *  commit is `headOid`. Every field the merge predicate reads is explicit — a
 *  fixture that omits one would pass for the wrong reason. */
export const mergedRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  number: 42, state: 'MERGED', headRefName: 'ws/quiet-basin', headRefOid: 'deadbee',
  baseRefName: 'main', isCrossRepository: false, mergedAt: '2026-07-20T10:00:00Z',
  mergeCommit: { oid: '7a68ca0' }, url: 'https://github.com/o/r/pull/42',
  title: 'the work', isDraft: false, statusCheckRollup: null, ...over,
});

/** A member PR a merge train landed and closed: CLOSED with the train label,
 *  no merge commit, head `headOid`. */
export const landedRow = (headOid: string, over: Record<string, unknown> = {}): Record<string, unknown> =>
  mergedRow({ headRefOid: headOid, state: 'CLOSED', mergedAt: null, mergeCommit: null,
    closedAt: '2026-07-21T09:00:00Z', labels: [{ name: 'landed-in-train' }], ...over });

/** The comment a train leaves on a member it closes, naming its train PR. */
export const trainComment = (train: number): Record<string, unknown> =>
  ({ comments: [{ body: `Landed in train #${train}.` }] });

/** The human half of a train PR body: the table a reader sees, and a plain
 *  `- #<n> <head sha>` list. Never parsed — a body with only this proves nothing. */
export const trainTable = (members: Array<[number, string]>): string =>
  `| PR | head |\n| --- | --- |\n${members.map(([n, sha]) => `| #${n} | ${sha} |`).join('\n')}\n\n`
  + `Members:\n${members.map(([n, sha]) => `- #${n} ${sha}`).join('\n')}\n`;

/** The ONE machine-readable train record (D-7335): an HTML comment on its own
 *  lines, `<!-- ccrc-train v1`, one `member #<n> <40-hex head sha>` line per
 *  member, then `-->`. */
export const trainBlock = (members: Array<[number, string]>): string =>
  `<!-- ccrc-train v1\n${members.map(([n, sha]) => `member #${n} ${sha}`).join('\n')}\n-->\n`;

/** A train PR `number`, MERGED as `mergeOid`, whose body carries the human
 *  table and the `ccrc-train v1` block listing each member at its head sha. */
export const trainRow = (number: number, mergeOid: string, members: Array<[number, string]>,
  over: Record<string, unknown> = {}): Record<string, unknown> => ({
  number, state: 'MERGED', mergedAt: '2026-07-21T08:59:00Z', mergeCommit: { oid: mergeOid },
  baseRefName: 'main', isCrossRepository: false,
  body: `Merge train.\n\n${trainTable(members)}\n${trainBlock(members)}`,
  ...over,
});
