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
 *  $HOME/gh-err to stderr, and appends its argv to $HOME/gh-calls so the exact
 *  flags are assertable. `timeout N cmd…` drops N and runs cmd, so a stubbed
 *  rc of 124 reproduces a real timeout exactly — and it LOGS its own argv
 *  first, because the wrapper is the only bound on a blocking DNS hang and a
 *  stub that silently swallowed it would let ccd drop `timeout` with the whole
 *  suite still green. */
export const GH_STUB = `
gh() {
  printf '%s\\n' "$*" >> "$HOME/gh-calls"
  [[ -f "$HOME/gh-err" ]]       && cat "$HOME/gh-err" >&2
  [[ -f "$HOME/gh-rows.json" ]] && cat "$HOME/gh-rows.json"
  local rc=0; [[ -f "$HOME/gh-rc" ]] && rc=$(cat "$HOME/gh-rc")
  return "$rc"
};
timeout() { printf 'timeout %s\\n' "$*" >> "$HOME/gh-calls"; shift; "$@"; };
`;

export interface PrHarness extends CcdHarness {
  /** What the stubbed `gh pr list` returns. */
  ghRows(rows: unknown[]): void;
  /** The stubbed `gh pr list`'s stdout, BYTE FOR BYTE — for the bodies that are
   *  not a JSON array at all. `ghRows` can only express well-formed answers, so
   *  without this the rc-0-with-an-unintelligible-body path has no fixture. */
  ghRaw(body: string): void;
  /** Make the stubbed gh fail: rc plus the stderr it prints. 124 = timeout. */
  ghFail(rc: number, stderr: string): void;
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

/** `_cfg_dir` (ccd:1116-1123) as a lookup. Which wrapper `_ws_least_loaded`
 *  happened to pick is what decides where Claude Code keeps that session's
 *  transcript, so every assertion about a transcript path reads the registry's
 *  `wrapper` field and comes through here — hardcoding `.claude` is right for
 *  exactly one of the four wrappers and silently wrong for the other three. */
export const CFG_DIR: Record<string, string> = {
  claude: '.claude', claude2: '.claude-personal',
  'claude-corp': '.claude-corp', gpt: '.claude-gpt',
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
