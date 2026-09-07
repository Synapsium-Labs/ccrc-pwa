/**
 * The `swap` time budget, pinned across the two files that own its halves.
 *
 * `cmd_swap` stops the supervisor unit and kills the tmux pane BEFORE it flips
 * the registry's `wrapper` field. Between those two points the session is not
 * running and the registry still names the old account, and nothing in the tree
 * can tell that state from "never swapped": no `swapblocked`, no `lastswap`, no
 * success line in `swap.log`.
 *
 * What kills the verb inside that window lives in TypeScript, one process and
 * one box away — `CCD_VERB_TIMEOUT_MS['swap']` applied by `timeoutMsFor` — and
 * what CAPS that number lives in a third file, the agent's own
 * `MAX_EXEC_TIMEOUT_MS`. Neither file can import the other's constant, so this
 * reads both from their real sources and asserts the relationship.
 *
 * It is deliberately an EQUALITY against the agent ceiling rather than a bare
 * literal: the carry has no bash-side bound below that ceiling, so the correct
 * budget is "as much as the agent will ever allow", and if the ceiling moves
 * this row should move with it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');

/** `CCD_VERB_TIMEOUT_MS['<verb>']` in ms, read from the TS source. Keys are
 *  written unquoted when the verb is a valid identifier (`ensure`, `start`,
 *  `enable`) and quoted when it is not (`'ws-add'`), so accept both. */
function verbTimeoutMs(verb: string): number | null {
  const src = readFileSync(path.join(ROOT, 'server', 'src', 'remote', 'runner.ts'), 'utf8');
  const m = new RegExp(`^\\s*'?${verb}'?:\\s*([\\d_]+),`, 'm').exec(src);
  return m ? Number(m[1].replace(/_/g, '')) : null;
}

/** The agent's hard clamp on any exec timeout, read from its real source. */
function agentCeilingMs(): number {
  const src = readFileSync(path.join(ROOT, 'agent', 'src', 'server.ts'), 'utf8');
  const m = /^const MAX_EXEC_TIMEOUT_MS = ([\d_]+);/m.exec(src);
  expect(m, 'agent/src/server.ts no longer defines MAX_EXEC_TIMEOUT_MS as a bare literal — '
    + 'this gate went blind').not.toBeNull();
  return Number(m![1].replace(/_/g, ''));
}

/** The flat default every keyless verb inherits. */
function flatDefaultMs(): number {
  const src = readFileSync(path.join(ROOT, 'server', 'src', 'remote', 'runner.ts'), 'utf8');
  const m = /^const CCD_TIMEOUT_MS = ([\d_]+);/m.exec(src);
  expect(m, 'runner.ts no longer defines CCD_TIMEOUT_MS as a bare literal').not.toBeNull();
  return Number(m![1].replace(/_/g, ''));
}

describe('swap is not killed mid-carry', () => {
  it('CCD_VERB_TIMEOUT_MS carries a swap row', () => {
    expect(
      verbTimeoutMs('swap'),
      'swap has no entry, so it inherits the flat CCD_TIMEOUT_MS and can be SIGTERM-ed after the '
      + 'unit is stopped and the pane killed but before `wrapper` flips',
    ).not.toBeNull();
  });

  it('the swap row equals the agent ceiling — the carry has no bash-side bound below it', () => {
    expect(verbTimeoutMs('swap')).toBe(agentCeilingMs());
  });

  it('and that is strictly more than the flat default it would otherwise inherit', () => {
    expect(verbTimeoutMs('swap')!).toBeGreaterThan(flatDefaultMs());
  });
});
