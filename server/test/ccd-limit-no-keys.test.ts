// No key ever reaches Claude Code's rate-limit menu from the limit-rescue code (D-8123, limit-swap-autofix Task 9).
//
// The menu ("What do you want to do?") is auto-opened when a limit lands, and an Enter or a digit typed into it can pick
// "Switch to usage credits". Every path this plan adds ends the session and resumes it on another account; none reads or
// writes the input box except to stand down. This is the source pin behind the keystroke assertion each behavioural test
// file ends with: the bodies of these functions, cut out of `ccd/ccd`, contain no tmux key sender at all. A function
// that is renamed or removed fails the "found" row, so the pin cannot go vacuous.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD_ALIASES_LIB, ccdSource } from './ccdWsHelpers.js';

/** The functions that decide or perform a limit rescue without a supervisor tick, or that move a session off a limit. */
const GUARDED = [
  'cmd_limit_watchdog', '_watchdog_one', '_watchdog_sign_to', '_swap_watchdog_act_gate', '_watchdog_resume_here',
  '_watchdog_resume_run', '_limitwait_open', '_limitwait_close', '_limitwait_choose', 'cmd_limit_wait', '_wake_ceiling_move',
];

/** The body of `name() { … }` at column 0, up to the closing brace at column 0. */
function body(src: string, name: string): string | null {
  const open = src.indexOf(`\n${name}() {`);
  if (open < 0) return null;
  const close = src.indexOf('\n}\n', open);
  return close < 0 ? null : src.slice(open, close + 3);
}
/** ccd's own typing helpers: each sends keys to a pane (review 3006 F2), so calling one is sending a key. */
const TYPERS = ['_route_type_model', '_route_type_effort', '_route_escape', '_answer_two_option_dialog'];
/** A raw tmux key sender (the pattern `ccd-typing-check.test.ts` refuses too, so the censuses agree on what a key is). */
const RAW_SENDS = /send-keys|_send_keys|paste-buffer|load-buffer|send-prefix/;
const SENDS = new RegExp(`${RAW_SENDS.source}|\\b(?:${TYPERS.join('|')})\\b`);

describe('the limit-rescue code sends no key', () => {
  const src = ccdSource();

  it.each(GUARDED)('%s is found and contains no key sender', (name) => {
    const b = body(src, name);
    expect(b, `${name} was not found in ccd/ccd`).not.toBeNull();
    expect(b!.length, `${name} is empty`).toBeGreaterThan(40);
    // Comments may NAME the forbidden words; only code lines count.
    const code = b!.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s#\s.*$/, '')).join('\n');
    expect(code).not.toMatch(SENDS);
  });

  it.each(TYPERS)('the typing helper %s is defined in ccd/ccd (so naming it in the scan is not vacuous)', (name) => {
    expect(body(src, name), `${name} was not found in ccd/ccd`).not.toBeNull();
  });

  it('the dispatch the watchdog uses starts a swap or a restart, never a key', () => {
    const b = body(src, '_dispatch_swap');
    expect(b).not.toBeNull();
    const code = b!.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(SENDS);
  });
});

// REVIEW 2964 F12: the model-class Anthropic arm's library observes a session on every supervise tick (`_alias_observe`) and carries a
// held id and an effort into a launch, and it types nothing: no key reaches a pane from it. The list above is a fixed set of
// limit-rescue functions, so a key sender added to the library would not be seen by it; this one scans EVERY function of the library
// (the names are read from its own text, so a new function is covered at once). Comments may name the words; only code lines count.
describe('the model-aliases library sends no key', () => {
  const lib = fs.readFileSync(CCD_ALIASES_LIB, 'utf8');
  const names = [...lib.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/gm)].map((m) => m[1]!);

  it('lists its functions (so the scan below cannot be vacuous)', () => {
    expect(names.length).toBeGreaterThan(15);
    expect(names).toContain('_alias_observe');
  });

  it.each(names)('%s contains no key sender', (name) => {
    const b = body(lib, name);
    expect(b, `${name} was not found in ccd/lib/model-aliases.sh`).not.toBeNull();
    const code = b!.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s#\s.*$/, '')).join('\n');
    expect(code).not.toMatch(SENDS);
  });
});

// REVIEW 3040 F1 (no-keys-transitive): the scans above see a key sender only when a guarded body names one itself, so a function
// that types by calling a CALLER of a typing helper (`_route_apply_now`, which calls `_route_type_model`) stays green. This one is
// transitive. It reads ccd's own shell sources once (the body and every `ccd/lib/*.sh`, listed from the directory, so a new
// library is covered at once), cuts every function out of them, and builds the call graph from their code: an edge is a whole-word
// mention of a defined function's name in a body's code lines, strings included (so `bash -c "source … && fn"` is a call). A key
// sender is any function whose code holds a raw tmux key sender, closed over its callers; nothing here is a hand list of callers.
// The protected code (the limit rescue above, the watchdog's dispatch, and every function of the model-aliases library, the
// passive observe path among them) must reach none.
type Fn = { file: string; line: number; code: string };
const HEADER = /^([A-Za-z_][A-Za-z0-9_-]*)\(\)\s*\{(.*)$/;
const CODE = (l: string): string => l.replace(/\s#\s.*$/, '');

/** Every function of one file: a header at column 0; a one-line body ends on its own line, any other at the first line that opens
 *  with `}` or just before the next header, whichever comes first (a few bodies close with `…; }` at the end of a code line). */
function cutFunctions(text: string, file: string, into: Map<string, Fn[]>): void {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = HEADER.exec(lines[i]!);
    if (!m) continue;
    let end = i;
    if (!/\}\s*$/.test(CODE(m[2]!).trim())) {
      end = i + 1;
      while (end < lines.length && !lines[end]!.startsWith('}') && !HEADER.test(lines[end]!)) end++;
      if (end < lines.length && HEADER.test(lines[end]!)) end--;
    }
    const code = [CODE(m[2]!), ...lines.slice(i + 1, end + 1).filter((l) => !/^\s*#/.test(l)).map(CODE)].join('\n');
    into.set(m[1]!, [...(into.get(m[1]!) ?? []), { file, line: i + 1, code }]);
  }
}

/** The graph and its key senders, from ONE read of each source. `next` names the hop toward a raw sender, for the failure text. */
function keySenderGraph(sources: ReadonlyArray<[string, string]>) {
  const fns = new Map<string, Fn[]>();
  for (const [file, text] of sources) cutFunctions(text, file, fns);
  const calls = new Map<string, Set<string>>();
  for (const [name, defs] of fns) {
    const out = new Set<string>();
    for (const d of defs) {
      for (const t of d.code.matchAll(/(?<![A-Za-z0-9_$-])[A-Za-z_][A-Za-z0-9_-]*(?![A-Za-z0-9_-])/g)) {
        if (t[0] !== name && fns.has(t[0])) out.add(t[0]);
      }
    }
    calls.set(name, out);
  }
  const callers = new Map<string, string[]>([...fns.keys()].map((n) => [n, []]));
  for (const [from, tos] of calls) for (const to of tos) if (!CUT.some((c) => c.from === from && c.to === to)) callers.get(to)!.push(from);
  const raw = [...fns].filter(([, defs]) => defs.some((d) => RAW_SENDS.test(d.code))).map(([n]) => n);
  const next = new Map<string, string | null>(raw.map((n) => [n, null]));
  for (const queue = [...raw]; queue.length; ) {
    const at = queue.shift()!;
    for (const by of callers.get(at)!) if (!next.has(by)) { next.set(by, at); queue.push(by); }
  }
  const pathTo = (name: string): string[] => {
    const hops = [name];
    for (let at = next.get(name); at; at = next.get(at)) hops.push(at);
    return hops;
  };
  return { fns, calls, raw, senders: next, pathTo };
}

/** The two edges the graph cannot read, cut by the coordinator's ruling on no-keys-transitive. Each must still be an edge and its
 *  reason must still read in the source, so a cut cannot go stale and hide a new path; every other path to a key sender reds,
 *  a new one through `cmd_ensure` or `cmd_route` included. */
const CUT: ReadonlyArray<{ from: string; to: string; why: string; holds: (code: string) => boolean }> = [
  {
    from: '_watchdog_resume_run', to: 'cmd_ensure',
    why: 'it types only into the fresh session\'s startup dialogs, after the old session is killed, and stands down on a limit banner',
    holds: (code) => /kill-session/.test(code) && code.search(/kill-session/) < code.search(/\bcmd_ensure\b/),
  },
  {
    from: '_operator_choice_promote', to: 'cmd_route',
    why: 'it calls `cmd_route` without `--apply`, so nothing is typed',
    holds: (code) => !/--apply\b/.test(code),
  },
];

describe('no key sender is reachable from the protected code (transitive, review 3040 F1)', () => {
  const libDir = path.dirname(CCD_ALIASES_LIB);
  const libs = fs.readdirSync(libDir).filter((f) => f.endsWith('.sh')).sort();
  const sources: Array<[string, string]> = [['ccd/ccd', ccdSource()], ...libs.map((f): [string, string] => [`ccd/lib/${f}`, fs.readFileSync(path.join(libDir, f), 'utf8')])];
  const g = keySenderGraph(sources);
  const library = [...g.fns].filter(([, defs]) => defs.some((d) => d.file === 'ccd/lib/model-aliases.sh')).map(([n]) => n);
  const PROTECTED = [...GUARDED, '_dispatch_swap', ...library];

  it('reads every source and derives the senders from their text (so the scan below cannot be vacuous)', () => {
    expect(libs).toContain('model-aliases.sh');
    expect(g.fns.size).toBeGreaterThan(500);
    expect(library.length).toBeGreaterThan(15);
    for (const t of TYPERS) expect(g.raw, `${t} holds no raw key sender`).toContain(t);
    // The indirect sender review 3040 measured: it types only through the helpers it calls.
    expect(g.raw).not.toContain('_route_apply_now');
    expect(g.pathTo('_route_apply_now').length, '_route_apply_now is not derived as a key sender').toBeGreaterThan(1);
  });

  it.each(CUT)('the cut edge $from -> $to is still an edge and its reason still reads in the source', ({ from, to, holds }) => {
    expect(g.calls.get(from)?.has(to), `${from} no longer calls ${to}: drop the cut`).toBe(true);
    for (const d of g.fns.get(from)!) expect(holds(d.code), `${from} (${d.file}:${d.line}) no longer meets the cut's condition`).toBe(true);
  });

  // The first cut's last clause: the fresh session's startup dialogs are answered by `_accept_first_run_prompts`, which stands down
  // on a limit banner (`_pane_hard_blocked`, rc 5). The check must stand, return at once, and be followed by no key of any kind.
  it('the first cut stands only while the startup dialogs stand down on a limit banner, before any key', () => {
    const [prompts] = g.fns.get('_accept_first_run_prompts') ?? [];
    expect(prompts, '_accept_first_run_prompts was not found').toBeDefined();
    const lines = prompts!.code.split('\n').map((l) => l.trim()).filter(Boolean);
    const at = lines.findIndex((l) => /^if _pane_hard_blocked "\$pane"; then$/.test(l));
    expect(at, 'the limit-banner stand-down is gone from _accept_first_run_prompts').toBeGreaterThan(0);
    expect(lines[at + 1], 'the stand-down no longer returns at once').toBe('return 5');
    const rest = lines.slice(at).join('\n');
    const names = [...rest.matchAll(/(?<![A-Za-z0-9_$-])[A-Za-z_][A-Za-z0-9_-]*(?![A-Za-z0-9_-])/g)].map((t) => t[0]);
    expect(RAW_SENDS.test(rest) ? 'a raw key sender' : names.find((n) => g.senders.has(n)) ?? null, 'a key follows the stand-down').toBeNull();
    const [blocked] = g.fns.get('_pane_hard_blocked') ?? [];
    expect(blocked?.code, '_pane_hard_blocked no longer reads a limit banner').toMatch(/limit reached/);
    expect(blocked!.code).toMatch(/rate limit/);
  });

  it.each(PROTECTED)('%s reaches no key sender', (name) => {
    expect(g.fns.has(name), `${name} was not found in ccd's sources`).toBe(true);
    expect(g.senders.has(name) ? g.pathTo(name).join(' -> ') : null).toBeNull();
  });
});
