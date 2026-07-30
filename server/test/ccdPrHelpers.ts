// The isolated-HOME bash harness for every PR/reap ccd test, modelled on
// ccdWsHelpers.ts. `gh` is a SHELL FUNCTION, so nothing here can reach the
// network or the host's real `gho_` tokens; `timeout` is shadowed too, because
// ccd wraps every gh call in it and the stub must not be bypassed.
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
  /** Make the stubbed gh fail: rc plus the stderr it prints. 124 = timeout. */
  ghFail(rc: number, stderr: string): void;
  ghCalls(): string[];
  /** Every argv the POISONED gh on PATH saw — i.e. every call that escaped
   *  GH_STUB. Must be empty in any test that includes the stub. */
  ghPoison(): string[];
  /** Run a snippet, returning the failure instead of throwing. */
  run(snippet: string): { code: number; stdout: string; stderr: string };
}

export function makePrHarness(prefix: string): PrHarness {
  const h = makeCcdHarness(prefix);
  const at = (n: string): string => path.join(h.home, n);

  // The gh stub above is a shell FUNCTION, and bash resolves functions before
  // PATH — so it wins whenever a snippet includes GH_STUB. This is what answers
  // when a snippet does not. It is deliberately structural rather than a rule to
  // remember: /usr/bin/gh exists on this box and ~/.config/gh/hosts.yml holds a
  // real `gho_` token with repo WRITE scope, so ONE test written without the
  // stub is a live call against the real github.com/o/r — or worse, a write. The
  // isolated HOME does not close it (GH_TOKEN/GH_HOST/GH_CONFIG_DIR are inherited
  // from the parent env, and an unauthenticated call still leaves the box). HOME
  // is isolated by construction in the harness rather than by discipline at each
  // call site; so is this.
  const bin = path.join(h.home, '.local', 'bin');
  fs.writeFileSync(path.join(bin, 'gh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/gh-poison"\n'
    + 'echo "ccd tests must never reach the real gh" >&2\nexit 97\n', { mode: 0o755 });
  const withBin = (env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
    ({ ...env, PATH: `${bin}:${env['PATH'] ?? process.env['PATH'] ?? ''}` });
  const sh = (snippet: string, env: NodeJS.ProcessEnv = {}): string => h.sh(snippet, withBin(env));
  const lines = (n: string): string[] => (fs.existsSync(at(n))
    ? fs.readFileSync(at(n), 'utf8').split('\n').filter(Boolean) : []);

  return {
    ...h,
    sh,
    ghRows: (rows) => { fs.writeFileSync(at('gh-rows.json'), JSON.stringify(rows)); },
    ghFail: (rc, stderr) => {
      fs.writeFileSync(at('gh-rc'), String(rc));
      fs.writeFileSync(at('gh-err'), stderr);
    },
    ghCalls: () => lines('gh-calls'),
    ghPoison: () => lines('gh-poison'),
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
