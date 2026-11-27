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
  // The lane-failing mark (the provider-failure ladder, wave 3a): its reader, its home gate, its writer and the marker reader.
  '_provfail', '_provfail_holds_home', '_provfail_pass', '_turn_mark_read',
  // Its moves (wave 3b): what is owed, what holds one, its act gate, and the pieces that choose a target.
  '_provfail_row', '_provfail_owed', '_provider_hold_to', '_swap_provider_act_gate', '_lane_provider_to', '_provider_move_rank_to', '_provider_move_fits',
  '_watchdog_provider',
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
/** A raw tmux key sender: the pattern `ccd-typing-check.test.ts` refuses, plus the aliases `send`, `pasteb` and `loadb` where one is
 *  the subcommand (quoted or not) of tmux or of ccd's tmux wrapper (quoted or not; options may sit between), so `mail send` never matches. */
const RAW_SENDS = /send-keys|_send_keys|paste-buffer|load-buffer|send-prefix|(?<![\w$-])(?:tmux|_tmx|"?\$\{_TMX_ARGV\[@\]\}"?)(?:\s+-[A-Za-z]+(?:\s+[^\s-]\S*)?)*\s+['"]?(?:send|pasteb|loadb)\b/;
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

// REVIEW 3040 F1 (no-keys-transitive): the scans above see a sender only when a guarded body names one. This one follows calls through
// ccd's own shell sources (the body and every `ccd/lib/*.sh`), read once: an edge is a whole-word mention of a defined function in a
// body's code lines (strings kept, so `bash -c "source … && fn"` counts), or ccd run by its installed path with a verb, which calls
// `cmd_<verb>`. A key sender is any function holding a raw sender, closed over its callers; no list of callers is kept by hand.
type Fn = { file: string; line: number; code: string };
const HEADER = /^(?:function\s+([A-Za-z_][\w-]*)\s*(?:\(\))?|([A-Za-z_][\w-]*)\s*\(\))\s*(\{.*)?$/;
const LOOSE = /^\s*(?:function\s+[A-Za-z_][\w-]*\s*(?:\(\s*\))?|[A-Za-z_][\w-]*\s*\(\s*\))\s*(\{.*)?$/;
const CODE = (l: string): string => l.replace(/\s#\s.*$/, '');
const NAMES = (code: string): string[] => [...code.matchAll(/(?<![A-Za-z0-9_$-])[A-Za-z_][A-Za-z0-9_-]*(?![A-Za-z0-9_-])/g)].map((m) => m[0]);
const SELF_VERB = /(?<![A-Za-z0-9_$./-])(?:\$HOME|\$\{HOME\}|~)\/\.local\/bin\/ccd['"]?\s+([a-z][a-z0-9-]*)/g;

/** Every function of one file: a header at column 0, in either shell spelling, with its brace on its line or the next (so a Python
 *  `main()` in a heredoc is none). A one-line body ends on its line, any other at the first line opening with `}` or before the next
 *  header. A header-shaped definition anywhere else lands in `unseen`, so no function can hide from the graph. */
function cutFunctions(text: string, file: string, into: Map<string, Fn[]>, unseen: string[]): void {
  const lines = text.split('\n').map((l) => (/^\s*#/.test(l) ? '' : CODE(l)));
  const header = (i: number) => {
    const loose = LOOSE.exec(lines[i]!);
    if (!loose || (!loose[1] && !lines[i + 1]?.trim().startsWith('{'))) return null;
    return HEADER.exec(lines[i]!) ?? (unseen.push(`${file}:${i + 1}`), null);
  };
  for (let i = 0; i < lines.length; i++) {
    const m = header(i);
    if (!m) continue;
    let end = i;
    if (!/\}\s*$/.test((m[3] ?? '').slice(1).trim())) {
      for (end = i + 1; end < lines.length && !lines[end]!.startsWith('}') && !HEADER.test(lines[end]!); end++);
      if (end < lines.length && !lines[end]!.startsWith('}')) end--;
    }
    into.set(m[1] ?? m[2]!, [...(into.get(m[1] ?? m[2]!) ?? []), { file, line: i + 1, code: [m[3] ?? '', ...lines.slice(i + 1, end + 1)].join('\n') }]);
  }
}

/** The two arms that type into a FRESH session after a spawn: its startup dialogs, then the resume prompt. Each stands down on a
 *  limit banner (pinned below). An edge into a spawn is allowed only while the raw senders it reaches are exactly these. */
const ARMS = ['_accept_first_run_prompts', '_redrive_after_spawn'];
const FRESH = 'it types only the two arms into a fresh session, each standing down on a limit banner';
type Src = (name: string) => string;
/** Edges the graph cannot read, by the coordinator's rulings (calls 299 and the fix round). Each must still be an edge and meet its
 *  condition in the source; `arms` edges must also reach exactly the two arms. Every other path to a sender reds. */
const ALLOW: ReadonlyArray<{ from: string; to: string; why: string; arms: boolean; holds: (src: Src) => boolean }> = [
  { from: '_watchdog_resume_run', to: 'cmd_ensure', arms: true, why: `it kills the old session (the menu's) first; ${FRESH}`,
    holds: (src) => /kill-session/.test(src('_watchdog_resume_run')) && src('_watchdog_resume_run').search(/kill-session/) < src('_watchdog_resume_run').search(/\bcmd_ensure\b/) },
  { from: '_dispatch_swap', to: 'cmd_swap', arms: true, why: `the swap ends the session and resumes it on another account; ${FRESH}`, holds: () => true },
  { from: '_wake_ceiling_move', to: 'cmd_swap', arms: true, why: `the swap ends the session and resumes it on another account; ${FRESH}`, holds: () => true },
  { from: '_wake_ceiling_move', to: 'cmd_ensure', arms: true, why: `its fallback ensures a session that is not alive; ${FRESH}`,
    holds: (src) => {   // `if _alive "$id"; then` alone, returning before the wake move and both spawns
      const l = src('cmd_ensure').split('\n').map((x) => x.trim()), at = l.indexOf('if _alive "$id"; then'), fi = l.indexOf('fi', at);
      return at > 0 && l.slice(at, fi).some((x) => /\breturn 0\b/.test(x)) && ['_wake_ceiling_move', '_supervised_start', '_spawn_start'].every((n) => l.findIndex((x) => x.includes(n)) > fi);
    } },
  { from: '_operator_choice_promote', to: 'cmd_route', arms: false, why: 'it calls `cmd_route` without `--apply`, so nothing is typed',
    holds: (src) => !/--apply\b/.test(src('_operator_choice_promote')) },
];
/** The reviewed startup gates `_accept_first_run_prompts` answers above its limit stand-down: a branch condition and its title words.
 *  The two "Enter to confirm" gates need their title beside that footer, which the rate-limit menu carries too. */
const GATES = [
  { cond: /^if _pane_external_import_gate "\$pane"; then$/, title: 'Allow external CLAUDE.md file imports' },
  { cond: /^if echo "\$pane" \| grep -q "Enter to confirm" && echo "\$pane" \| grep -q "Resume from summary"; then$/, title: 'Resume from summary' },
  { cond: /^if echo "\$pane" \| grep -q "Enter to confirm" && echo "\$pane" \| grep -q "Try the new fullscreen renderer"; then$/, title: 'Try the new fullscreen renderer' },
  { cond: /^if echo "\$pane" \| grep -q "Bypass Permissions mode"; then$/, title: 'Bypass Permissions mode' },
  { cond: /^if echo "\$pane" \| grep -q "trust this folder"; then$/, title: 'trust this folder' },
];

describe('no key sender is reachable from the protected code (transitive, review 3040 F1)', () => {
  const libDir = path.dirname(CCD_ALIASES_LIB);
  const libs = fs.readdirSync(libDir).filter((f) => f.endsWith('.sh')).sort();
  const fns = new Map<string, Fn[]>(), unseen: string[] = [];
  cutFunctions(ccdSource(), 'ccd/ccd', fns, unseen);
  for (const f of libs) cutFunctions(fs.readFileSync(path.join(libDir, f), 'utf8'), `ccd/lib/${f}`, fns, unseen);
  const src: Src = (n) => (fns.get(n) ?? []).map((d) => d.code).join('\n');
  const calls = new Map([...fns.keys()].map((n) => {
    const code = src(n);
    const verbs = [...code.matchAll(SELF_VERB)].map((m) => `cmd_${m[1]!.replace(/-/g, '_')}`);
    return [n, new Set([...NAMES(code), ...verbs].filter((t) => t !== n && fns.has(t)))];
  }));
  const raw = [...fns.keys()].filter((n) => RAW_SENDS.test(src(n)));
  const plainCut = (a: string, b: string) => ALLOW.some((x) => !x.arms && x.from === a && x.to === b && x.holds(src));
  /** The raw senders reachable from `name`, past no arm and not through a plain cut (the promote's record-only `cmd_route`). */
  const reachRaw = (name: string): string[] => {
    const seen = new Set([name]);
    for (const q = [name]; q.length; ) {
      const at = q.shift()!;
      if (ARMS.includes(at)) continue;
      for (const to of calls.get(at)!) if (!seen.has(to) && !plainCut(at, to)) { seen.add(to); q.push(to); }
    }
    return raw.filter((n) => seen.has(n)).sort();
  };
  const allowed = new Set(ALLOW.filter((a) => calls.get(a.from)?.has(a.to) && a.holds(src) && (!a.arms || reachRaw(a.to).join() === ARMS.join()))
    .map((a) => `${a.from}>${a.to}`));
  const next = new Map<string, string | null>(raw.map((n) => [n, null]));
  for (const q = [...raw]; q.length; ) {
    const at = q.shift()!;
    for (const [by, tos] of calls) if (tos.has(at) && !next.has(by) && !allowed.has(`${by}>${at}`)) { next.set(by, at); q.push(by); }
  }
  const pathTo = (n: string): string => { const hops = [n]; for (let at = next.get(n); at; at = next.get(at)) hops.push(at); return hops.join(' -> '); };
  const isSender = (line: string): boolean => RAW_SENDS.test(line) || NAMES(line).some((t) => next.has(t));
  const library = [...fns].filter(([, defs]) => defs.some((d) => d.file === 'ccd/lib/model-aliases.sh')).map(([n]) => n);

  it('reads every source and derives the senders and the self-calls from their text (so the scan below cannot be vacuous)', () => {
    expect(libs).toContain('model-aliases.sh');
    expect(fns.size).toBeGreaterThan(500);
    expect(library.length).toBeGreaterThan(15);
    for (const t of [...TYPERS, ...ARMS]) expect(raw, `${t} holds no raw key sender`).toContain(t);
    expect(raw).not.toContain('_route_apply_now');
    expect(pathTo('_route_apply_now'), '_route_apply_now is not derived as a key sender').toContain(' -> ');
    expect(calls.get('_dispatch_swap')?.has('cmd_swap'), 'the self-call `ccd swap` is not an edge').toBe(true);
    expect(unseen, 'a function header the cutter does not parse').toEqual([]);
  });

  it.each(ALLOW)('$from -> $to is an edge, meets its condition, and (a spawn) reaches only the two arms', (a) => {
    expect(calls.get(a.from)?.has(a.to), `${a.from} no longer calls ${a.to}: drop it`).toBe(true);
    expect(a.holds(src), `${a.from} -> ${a.to} no longer meets its condition`).toBe(true);
    if (a.arms) expect(reachRaw(a.to)).toEqual(ARMS);
  });

  it('_accept_first_run_prompts stands down on a limit banner with return 5, and sends no key after it', () => {
    const lines = src('_accept_first_run_prompts').split('\n').map((l) => l.trim()).filter(Boolean);
    const at = lines.indexOf('if _pane_hard_blocked "$pane"; then');
    expect(at, 'the limit-banner stand-down is gone').toBeGreaterThan(0);
    expect(lines[at + 1], 'the stand-down no longer returns at once').toBe('return 5');
    expect(lines.slice(at).filter(isSender)).toEqual([]);
    expect(src('_pane_hard_blocked')).toMatch(/limit reached[\s\S]*rate limit/);
  });

  it('every key _accept_first_run_prompts sends above its stand-down is inside a reviewed startup gate', () => {
    const lines = src('_accept_first_run_prompts').split('\n').map((l) => l.trim()).filter(Boolean);
    const stack: string[] = [];
    const outside: string[] = [];
    let inside = 0;
    for (const l of lines.slice(1, lines.indexOf('if _pane_hard_blocked "$pane"; then'))) {
      const oneLine = /^if .*; then .*; fi$/.test(l);
      if (/^if .*; then$/.test(l)) stack.push(l);
      else if (/^(fi|fi;.*)$/.test(l)) stack.pop();
      const inGate = [...stack, ...(oneLine ? [l.slice(0, l.indexOf('; then') + 6)] : [])].some((c) => GATES.some((g) => g.cond.test(c)));
      if (isSender(l)) inGate ? inside++ : outside.push(l);
    }
    expect(outside).toEqual([]);
    expect(inside, 'no gated key was found, so the scan read nothing').toBeGreaterThanOrEqual(GATES.length);
    expect(src('_pane_external_import_gate')).toContain(`grep -q "${GATES[0]!.title}"`);
  });

  it.each(['rate-limit-dialog.ansi', 'rate-limit-dialog-mail-row.ansi'])('the rate-limit menu (%s) carries no startup gate\'s title', (f) => {
    const menu = fs.readFileSync(path.join(__dirname, 'fixtures/panes/box', f), 'utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    expect(menu).toContain('What do you want to do?');
    expect(GATES.map((g) => g.title).filter((t) => menu.includes(t))).toEqual([]);
  });

  it('_redrive_after_spawn stands down on a limit banner before the first key it sends', () => {
    const lines = src('_redrive_after_spawn').split('\n').map((l) => l.trim());
    const at = lines.findIndex((l) => /^_pane_hard_blocked "\$pane" && \{.*return 0; \}$/.test(l));
    expect(at, 'the limit-banner stand-down is gone').toBeGreaterThan(0);
    expect(at).toBeLessThan(lines.findIndex(isSender));
  });

  it.each([...GUARDED, '_dispatch_swap', ...library])('%s reaches no key sender', (name) => {
    expect(fns.has(name), `${name} was not found in ccd's sources`).toBe(true);
    expect(next.has(name) ? pathTo(name) : null).toBeNull();
  });
});
