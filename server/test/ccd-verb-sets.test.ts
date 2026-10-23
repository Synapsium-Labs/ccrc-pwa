/**
 * D-6051 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0k; ARCH-23 (#527)). ccd's verb list
 * is spelled four times: the dispatcher's `case` arms, `cmd_caps`, the usage line, and the verbs the server builds in
 * `CCD_ARGV`. This suite holds the four equal, by RUNNING each one rather than reading its text:
 *
 * - the dispatcher: its `case … esac`, taken out of ccd once, is evaluated in a fixture HOME with every `cmd_*`
 *   replaced by a recorder, once per candidate word. A word is an arm when it reaches a `cmd_*`;
 * - `cmd_caps`: called, minus the capability tokens (`ccdCapTokens.ts`);
 * - the usage line: what ccd, run as a program with no argv, prints;
 * - `CCD_ARGV`: every entry called with its sample (`ccdArgvSamples.ts`), keeping the verb it sends.
 *
 * Read-only: nothing here edits or restamps ccd. `CCD_ARGV` is a strict subset by design, so the verbs the server
 * never sends are pinned by name, each with the reason (D-6052).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import { CCD_ARGV_SAMPLES } from './ccdArgvSamples.js';
import { CCD_CAPABILITY_TOKENS } from './ccdCapTokens.js';

/** The guard that runs the dispatcher only when ccd is a program, never when it is sourced. */
const GUARD = 'if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then';
const CASE_OPEN = 'case "${1:-}" in';

/** The dispatcher's `case … esac`, out of the text after ccd's one guard. Throws unless the guard is there once. */
function dispatcherBlock(src: string): string {
  const parts = src.split(GUARD);
  if (parts.length !== 2) throw new Error(`ccd-verb-sets: ${parts.length - 1} dispatcher guards in ccd, not one`);
  const after = parts[1]!;
  const open = after.indexOf(CASE_OPEN);
  const close = after.indexOf('\nesac\n');
  if (open < 0 || close < open) throw new Error('ccd-verb-sets: no `case … esac` after the dispatcher guard');
  return after.slice(open, close + '\nesac'.length);
}

/** The labels of the block's arms, in order, each arm's labels as written (`ls|list` gives `['ls', 'list']`). The
 *  catch-all `*` is not an arm. */
function armLabels(block: string): string[][] {
  return [...block.matchAll(/^ {2}([a-z][a-z0-9|-]*)\)/gm)].map((m) => m[1]!.split('|'));
}

/** The arm lines whose body is anything but a hand-off to one command: `[shift;] cmd_x ["$@"] ;;`. The dispatcher
 *  is evaluated only when this is empty, so inline code in a future arm is refused before it ever runs, not after. */
function unsafeArms(block: string): string[] {
  return block.split('\n').filter((l) => /^ {2}[a-z][a-z0-9|-]*\)/.test(l))
    .filter((l) => !/^ {2}[a-z][a-z0-9|-]*\)\s*(shift;\s*)?cmd_[a-z_]+(\s+"\$@")?\s*;;\s*$/.test(l));
}

/** Evaluates `block` once per word with every `cmd_*` recording its name, and returns the `cmd_*` each word reached
 *  (`null`: none, the catch-all answered). The block and the words ride the environment, never the snippet. */
function dispatchEach(h: CcdHarness, block: string, words: readonly string[]): Map<string, string | null> {
  const out = h.sh([
    'while read -r _ _ f; do',
    '  [[ $f == cmd_* ]] && eval "$f() { printf \'CALL %s\\n\' $f; }"',
    'done < <(declare -F)',
    'for v in $CCD_VERB_WORDS; do',
    '  printf \'WORD %s\\n\' "$v"',
    '  ( set -- "$v" probe-arg; eval "$CCD_DISPATCH" ) 2>/dev/null',
    'done',
    'true',
  ].join('\n'), { CCD_DISPATCH: block, CCD_VERB_WORDS: words.join(' ') });
  const reached = new Map<string, string | null>(words.map((w) => [w, null]));
  let word: string | null = null;
  for (const line of out.split('\n')) {
    const w = /^WORD (\S+)$/.exec(line);
    if (w) { word = w[1]!; continue; }
    const c = /^CALL (cmd_\S+)$/.exec(line);
    if (c && word !== null) reached.set(word, c[1]!);
  }
  return reached;
}

/** The verbs ccd's usage line names: ccd run as a program with no argv. */
function usageVerbs(h: CcdHarness): string[] {
  // A program of its own, inside the harness's contained environment: the guard runs only when ccd is not sourced.
  const out = h.sh('bash "$CCD_PROGRAM" 2>&1; echo "rc=$?"', { CCD_PROGRAM: CCD });
  expect(out, 'ccd with no argv exits 1 with its usage line').toMatch(/\nrc=1$/);
  const m = /usage: ccd \{([^}]*)\}/.exec(out);
  if (m === null) throw new Error(`ccd-verb-sets: no \`usage: ccd {…}\` line in ${JSON.stringify(out)}`);
  return m[1]!.split('|');
}

/** The verb each `CCD_ARGV` entry sends: the first token of the argv its sample builds. */
function argvHeads(): Map<string, string> {
  return new Map((Object.keys(CCD_ARGV) as (keyof typeof CCD_ARGV)[]).map((k) => {
    const build = CCD_ARGV[k] as (...a: unknown[]) => readonly string[];
    return [k, build(...CCD_ARGV_SAMPLES[k])[0]!];
  }));
}

/**
 * The verbs ccd dispatches that no `CCD_ARGV` entry sends (D-6052). Each is an operator's verb at a terminal or a
 * read the agent makes itself; the server has no route that asks for it. Exact, both ways: a verb the server starts
 * to send must leave this list, and a verb that leaves ccd must too.
 */
const SERVER_NEVER_SENDS: Readonly<Record<string, string>> = {
  'account-pane': 'the account-connection pane `ccrc`\'s account lanes name; no server route builds it on this tree',
  attach: 'a terminal attach to a tmux session',
  caps: 'the agent runs it itself at start and reports the list in its ready frame',
  clip: 'a terminal clipboard helper',
  list: 'the listing alias of `ls`, at a terminal',
  ls: 'the operator\'s listing at a terminal',
  menu: 'the interactive picker at a terminal',
  pick: 'the picker\'s alias, at a terminal',
  'scratch-rescue': 'the temp sweep\'s box-local act (D-6632), never a server route',
  prefer: 'the operator sets a session\'s home account at a terminal',
  'swap-self': 'run from inside the session\'s own pane, never from outside it',
  supervise: 'the systemd unit\'s own entry point, never a remote verb',
  version: 'read by the deploy and the agent from the box, not through a route',
  'ws-gc': 'ungrantable (`UNGRANTABLE_VERBS`): its `--prune` deletes, so no agent prefix may start with it',
  'ws-rm': 'ungrantable (`UNGRANTABLE_VERBS`): the unguarded legacy delete',
};

describe('ccd\'s four verb lists are one set (D-6051, ARCH-23)', () => {
  let h: CcdHarness;
  let block: string;
  let labels: string[][];
  let reached: Map<string, string | null>;
  let caps: string[];
  let usage: string[];
  let heads: Map<string, string>;
  let unsafe: string[];
  const SENTINEL = 'no-such-verb';

  beforeAll(() => {
    h = makeCcdHarness('ccrc-ccd-verb-sets-');
    block = dispatcherBlock(fs.readFileSync(CCD, 'utf8'));
    labels = armLabels(block);
    caps = h.sh('cmd_caps').split('\n').filter(Boolean);
    usage = usageVerbs(h);
    heads = argvHeads();
    const words = [...new Set([...labels.flat(), ...caps, ...usage, ...heads.values(), SENTINEL])].sort();
    unsafe = unsafeArms(block);
    reached = unsafe.length === 0 ? dispatchEach(h, block, words) : new Map(words.map((w) => [w, null]));
  });
  afterAll(() => { h.cleanup(); });

  const arms = (): string[] => [...reached].filter(([, c]) => c !== null).map(([w]) => w).sort();

  it('every arm only hands off to one command, so evaluating the block runs nothing else', () => {
    expect(unsafe, 'arms with inline code: the block was not evaluated').toEqual([]);
  });

  it('every arm label dispatches, and nothing else does', () => {
    expect(labels.length, 'too few arms read: the block extractor has gone stale').toBeGreaterThan(30);
    expect(reached.get(SENTINEL), 'a word no arm names reaches the catch-all').toBeNull();
    expect(arms()).toEqual([...new Set(labels.flat())].sort());
  });

  it('every line of the block is an arm the label reader saw, the one catch-all, a comment or blank', () => {
    // Without this row an arm the reader cannot see (other indentation, a quoted label) would never be dispatched,
    // so it could carry a verb past every set below unchecked.
    const body = block.split('\n').slice(1, -1);
    const unread = body.filter((l) => !/^ {2}[a-z][a-z0-9|-]*\)/.test(l) && !/^ {2}\*\)/.test(l)
      && !/^\s*(#.*)?$/.test(l));
    expect(unread, 'block lines that are neither a read arm nor the catch-all').toEqual([]);
    expect(body.filter((l) => /^ {2}\*\)/.test(l)), 'exactly one catch-all').toHaveLength(1);
    expect(body.filter((l) => /^ {2}[a-z][a-z0-9|-]*\)/.test(l))).toHaveLength(labels.length);
  });

  it('each arm reaches the command its first label names, and an alias reaches the same one', () => {
    const wrong = labels.flatMap((ls) => ls.map((l) => [l, reached.get(l), `cmd_${ls[0]!.replace(/-/g, '_')}`] as const))
      .filter(([, got, want]) => got !== want).map(([l, got, want]) => `${l}: reached ${got}, wants ${want}`);
    expect(wrong).toEqual([]);
  });

  it('cmd_caps advertises exactly the dispatched verbs, beside its capability tokens', () => {
    const verbs = caps.filter((c) => !CCD_CAPABILITY_TOKENS.includes(c)).sort();
    expect(verbs, 'caps verbs vs dispatcher arms').toEqual(arms());
  });

  it('the usage line names each arm once, by its first label', () => {
    expect([...usage].sort(), 'usage vs the first label of each arm').toEqual(labels.map((ls) => ls[0]!).sort());
  });

  it('every verb CCD_ARGV sends is dispatched, and the rest are pinned as never sent by the server', () => {
    const sent = [...new Set(heads.values())].sort();
    expect(sent.filter((v) => reached.get(v) === null || reached.get(v) === undefined), 'sent but not dispatched')
      .toEqual([]);
    expect(arms().filter((v) => !sent.includes(v)), 'dispatched, never sent: exactly SERVER_NEVER_SENDS')
      .toEqual(Object.keys(SERVER_NEVER_SENDS).sort());
  });
});
