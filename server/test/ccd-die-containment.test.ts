// D-298 (was D-B8-2) — the class behind D-297 (was D-B8-1), swept and mechanised.
//
// `die` is `echo …; exit 1` (ccd:148). Inside a command substitution `exit`
// kills only the SUBSHELL, so a process-fatal error arrives at the caller as
// a return code — and rc 1 is in no ccd caller's failure set (`cmd_ws_add`,
// `cmd_start` and `cmd_ensure` all ask `[[ "$rc" -eq 3 || "$rc" -eq 4 ]]`).
// D-297 was one instance of that, found by review; nothing prevented the
// next one. This is the mechanism that does.
//
// TWO DELIBERATE DEPARTURES FROM THE PLAN'S SKETCH, both recorded in the
// commit message:
//
//   1. The plan proposed a hand-written `CAN_DIE` allow-list. That list is
//      itself the thing that goes stale: give `_reg_get` a `die` tomorrow and
//      a hard-coded list never learns it, so the guard silently stops
//      guarding. This DERIVES the can-die set from `ccd/ccd` by call-graph
//      reachability, every run. Prefer a measurement to a heuristic.
//   2. The sweep found the population EMPTY at this tip, so an assertion
//      against the real file can only ever pass today — the classic test that
//      counts as coverage while being incapable of failing. So the scanner is
//      a pure function pinned FIRST against synthetic sources carrying the
//      exact D-297 shape (and against sources that must NOT trip it), and
//      only then pointed at `ccd/ccd`. Break the scanner and the positive
//      controls go red whatever `ccd/ccd` happens to contain.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';

/** A `#` comment starts only where a `#` sits at the start of a word and
 *  outside quotes — `"$REG/$id.hold"` and `'#'` are not comments. `ccd/ccd`
 *  discusses this very hazard in ~40 comments (`fs=$(_spawn_start …)` appears
 *  verbatim at ccd:9733), so a scanner that reads comments as code answers
 *  "dozens of offenders" and is useless. */
function stripComment(line: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote !== null) {
      if (c === '\\' && quote === '"') { out += c; i++; if (i < line.length) out += line[i]; continue; }
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    if (c === '#' && (i === 0 || ' \t;&|('.includes(line[i - 1]!))) break;
    out += c;
  }
  return out;
}

/** Heredoc bodies are not shell. `_pr_py` alone is ~390 lines of embedded
 *  Python (ccd:1836); reading its parentheses as command substitutions would
 *  desynchronise the depth counter for the whole rest of the file. */
function codeLines(src: string): { line: string; n: number }[] {
  const raw = src.split('\n');
  const out: { line: string; n: number }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i]!;
    out.push({ line: l, n: i + 1 });
    const m = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(stripComment(l));
    if (m && !l.trimStart().startsWith('#')) {
      const term = m[2]!;
      i++;
      while (i < raw.length && raw[i]!.trim() !== term) i++;
    }
  }
  return out;
}

/** Per-character command-substitution depth, carried ACROSS lines because
 *  `$( )` in this file routinely spans a backslash continuation (ccd:1435,
 *  ccd:1625, ccd:1757). `$((` is arithmetic, not a substitution: it starts no
 *  subshell and swallows no `exit`. */
function depthMap(line: string, start: number): { depth: number[]; end: number } {
  const depth: number[] = new Array(line.length).fill(0);
  let d = start;
  let i = 0;
  while (i < line.length) {
    if (line.startsWith('$((', i)) { depth[i] = depth[i + 1] = depth[i + 2] = d; i += 3; continue; }
    if (line.startsWith('$(', i)) { d++; depth[i] = depth[i + 1] = d; i += 2; continue; }
    if (line[i] === ')' && d > 0) { depth[i] = d; d--; i++; continue; }
    if (line[i] === '`') { d = d === 0 ? 1 : d - 1; depth[i] = d; i++; continue; }
    depth[i] = d;
    i++;
  }
  return { depth, end: d };
}

const DEF = /^([A-Za-z_][A-Za-z0-9_]*)\(\)/;
const TOKEN = /(?<![A-Za-z0-9_./-])([A-Za-z_][A-Za-z0-9_]*)\b/g;
const AFTER = ['then', 'else', 'elif', 'do', '!', '&&', '||', ';;'];

/** Is the token at `pos` in COMMAND position — i.e. would bash run it as a
 *  command rather than read it as a word/operand? `foo || die "x"`, `*) die`,
 *  `{ die; }`, `[[ … ]] && die` all qualify; `--reason die` does not. */
function isCommandPosition(line: string, pos: number): boolean {
  const pre = line.slice(0, pos).replace(/\s+$/, '');
  if (pre === '') return true;
  if (';&|({)'.includes(pre[pre.length - 1]!)) return true;
  return AFTER.some((k) => pre.endsWith(k));
}

interface Fn { name: string; from: number; to: number }

function functions(src: string): Fn[] {
  const raw = src.split('\n');
  const heads: { name: string; at: number }[] = [];
  raw.forEach((l, i) => { const m = DEF.exec(l); if (m) heads.push({ name: m[1]!, at: i }); });
  return heads.map((h, k) => {
    if (raw[h.at]!.trimEnd().endsWith('}') && raw[h.at]!.includes('{')) return { name: h.name, from: h.at, to: h.at };
    const limit = k + 1 < heads.length ? heads[k + 1]!.at : raw.length;
    let to = limit - 1;
    for (let j = h.at + 1; j < limit; j++) if (raw[j]!.trimEnd() === '}') { to = j; break; }
    return { name: h.name, from: h.at, to };
  });
}

/** Every function that reaches `die` on some path WITHOUT the `die` being
 *  swallowed on the way — i.e. calling it is process-fatal. A call that is
 *  itself already inside a `$( )` does NOT propagate fatality, which is the
 *  whole point of the defect. */
export function canDie(src: string): Set<string> {
  const fns = functions(src);
  const lines = codeLines(src);
  const code = new Map(lines.map((l) => [l.n, stripComment(l.line)]));
  const calls = new Map<string, Set<string>>();
  const fatal = new Set<string>();
  const names = new Set(fns.map((f) => f.name));

  // Depth must be accumulated over the WHOLE file in order, not per function.
  const depthAt = new Map<number, number[]>();
  let carry = 0;
  for (const { n } of lines) {
    const { depth, end } = depthMap(code.get(n)!, carry);
    depthAt.set(n, depth);
    carry = end;
  }

  for (const f of fns) {
    const cs = new Set<string>();
    for (let j = f.from; j <= f.to; j++) {
      const l = code.get(j + 1);
      if (l === undefined) continue;        // inside a heredoc body
      const d = depthAt.get(j + 1)!;
      TOKEN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TOKEN.exec(l)) !== null) {
        const t = m[1]!;
        if (t === f.name) continue;
        if (t !== 'die' && !names.has(t)) continue;
        if (!isCommandPosition(l, m.index)) continue;
        if (d[m.index]! > 0) continue;      // swallowed here — carries no fatality out
        if (t === 'die') fatal.add(f.name);
        cs.add(t);
      }
    }
    calls.set(f.name, cs);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, cs] of calls) {
      if (fatal.has(name)) continue;
      for (const t of cs) if (t === 'die' || fatal.has(t)) { fatal.add(name); changed = true; break; }
    }
  }
  fatal.delete('die');
  return fatal;
}

/** Every ccd function called from INSIDE a `$( )`, fatal or not, as
 *  `<line>: <name>: <text>`. This is the denominator: a scanner whose depth
 *  counter has desynchronised reports an empty one, and an empty denominator
 *  is how a guard silently stops guarding. The tests below pin it. */
export function capturedCalls(src: string): { at: number; name: string; text: string }[] {
  const names = new Set(functions(src).map((f) => f.name));
  const out: { at: number; name: string; text: string }[] = [];
  let carry = 0;
  for (const { line, n } of codeLines(src)) {
    const l = stripComment(line);
    const { depth, end } = depthMap(l, carry);
    TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN.exec(l)) !== null) {
      const t = m[1]!;
      if (t !== 'die' && !names.has(t)) continue;
      if (depth[m.index]! <= 0) continue;
      if (!isCommandPosition(l, m.index)) continue;
      out.push({ at: n, name: t, text: line.trim() });
    }
    carry = end;
  }
  return out;
}

/** The `$( )` nesting still open at end of file. Anything but 0 means the
 *  scanner lost its place — every answer after the desync is fiction, in
 *  EITHER direction (silent pass, or noise). Asserted, not assumed. */
export function substitutionBalance(src: string): number {
  let carry = 0;
  for (const { line } of codeLines(src)) carry = depthMap(stripComment(line), carry).end;
  return carry;
}

/** Every place a fatal thing is wrapped in `$( )` — the demotion. Reported as
 *  `<line>: <name>: <text>` so a red suite names the site, not just a count. */
export function demotionSites(src: string): string[] {
  const fatal = canDie(src);
  return capturedCalls(src)
    .filter((c) => c.name === 'die' || fatal.has(c.name))
    .map((c) => `${c.at}: ${c.name}: ${c.text}`);
}

// ---------------------------------------------------------------------------
// The scanner is pinned before it is trusted. Every case below is a whole
// synthetic shell source — nothing here reads or writes the real fleet.
// ---------------------------------------------------------------------------
describe('the scanner itself', () => {
  const PRELUDE = 'die() { echo "ccd: $*" >&2; exit 1; }\n';

  it('finds the exact D-297 shape', () => {
    // Verbatim reconstruction of the demotion at ad6396d: `_spawn_start`
    // dies, `_spawn` reads it through a substitution, so the fatal becomes
    // rc 1 and the caller sails past it.
    const src = `${PRELUDE}
_spawn_start() {
  [[ -n "$wrapper" ]] || die "incomplete registry for '$id'"
  echo "$fromswap"
}
_spawn() {
  local fs; fs=$(_spawn_start "$1" "$2")
}
`;
    expect(canDie(src).has('_spawn_start')).toBe(true);
    expect(demotionSites(src).map((s) => s.split(':')[1]!.trim())).toEqual(['_spawn_start']);
  });

  it('finds a demotion that arrives TRANSITIVELY, two hops from the die', () => {
    const src = `${PRELUDE}
_leaf()   { die "no"; }
_middle() { _leaf "$1"; echo ok; }
_top()    { local v; v=$(_middle "$1"); }
`;
    expect([...canDie(src)].sort()).toEqual(['_leaf', '_middle']);
    expect(demotionSites(src).length).toBe(1);
  });

  it('finds a bare `die` written directly inside a substitution', () => {
    const src = `${PRELUDE}\n_f() { local v; v=$(cat x || die "unreadable"); }\n`;
    expect(demotionSites(src).map((s) => s.split(':')[1]!.trim())).toEqual(['die']);
  });

  it('finds one that spans a backslash continuation', () => {
    const src = `${PRELUDE}
_v() { die "bad"; }
_c() { local x; x=$(printf '%s' \\
        "$(_v "$1")"); }
`;
    expect(demotionSites(src).length).toBe(1);
  });

  it('does NOT trip on the fixed shape — a plain call, fatality intact', () => {
    const src = `${PRELUDE}
_spawn_start() { [[ -n "$w" ]] || die "incomplete registry"; SPAWN_FROMSWAP=0; }
_spawn()       { _spawn_start "$1" "$2" || return $?; }
`;
    expect(canDie(src).has('_spawn_start')).toBe(true);
    expect(demotionSites(src)).toEqual([]);
  });

  it('does NOT trip on a helper that cannot die, however it is captured', () => {
    const src = `${PRELUDE}\n_reg_get() { cat "$REG/$1.$2" 2>/dev/null; }\n_f() { local v; v=$(_reg_get "$1" wrapper); }\n`;
    expect(canDie(src).has('_reg_get')).toBe(false);
    expect(demotionSites(src)).toEqual([]);
  });

  it('does NOT read a COMMENT about the hazard as the hazard', () => {
    // ccd:9733 says, in prose, `fs=$(_spawn_start …)`. A scanner that counts
    // that answers dozens of false offenders and gets deleted.
    const src = `${PRELUDE}
_spawn_start() { die "incomplete registry"; }
# the old shape was \`fs=$(_spawn_start "$1" "$2")\` and its die was swallowed
_spawn() { _spawn_start "$1" "$2"; }   # no $(_spawn_start …) here either
`;
    expect(demotionSites(src)).toEqual([]);
  });

  it('does NOT read arithmetic `$(( ))` as a command substitution', () => {
    const src = `${PRELUDE}\n_f() { die "x"; }\n_g() { local n=$((1 + 2)); _f "$n"; }\n`;
    expect(demotionSites(src)).toEqual([]);
  });

  it('does NOT read a heredoc body as shell', () => {
    const src = `${PRELUDE}
_f() { die "x"; }
_g() {
  python3 - <<'PY'
print("$(_f)")
PY
  _f
}
`;
    expect(demotionSites(src)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Only now, the real file.
// ---------------------------------------------------------------------------
describe('ccd/ccd', () => {
  const src = readFileSync(CCD, 'utf8');

  it('kept its place — the substitution nesting balances at end of file', () => {
    // `_pr_py` alone is ~390 lines of embedded Python; read as shell it
    // desynchronises the depth counter for everything after it, which would
    // make the assertion below answer from fiction rather than from ccd.
    expect(substitutionBalance(src)).toBe(0);
  });

  it('was actually parsed — the scan is looking at something', () => {
    // A scan over an empty list passes everything (single-definition.test.ts's
    // own rule). These are the anchors that say the parse worked at all.
    const fatal = canDie(src);
    expect(src.split('\n').length).toBeGreaterThan(8000);
    expect(functions(src).length).toBeGreaterThan(100);
    // `_spawn_start` is the D-297 function and still carries its `die`
    // (ccd:9756). `_spawn` and `_supervised_start` inherit it by call. Every
    // `cmd_*` verb that validates its argv dies directly. `_lc_refuse`
    // (task 16) is the lifecycle journal's own direct `die` caller — its own
    // docstring names this exact set as the reason it must never be wrapped
    // in `$( )`.
    expect([...fatal].filter((f) => f.startsWith('_')).sort())
      .toEqual(['_lc_refuse', '_spawn', '_spawn_start', '_supervised_start', '_swap_refuse']);
    expect(fatal.has('cmd_ws_add')).toBe(true);
    expect(fatal.has('cmd_start')).toBe(true);
    expect(fatal.has('cmd_ensure')).toBe(true);
    // …and a pure reader is NOT in the set, or "everything can die" would make
    // the assertion below unfalsifiable in the other direction.
    expect(fatal.has('_reg_get')).toBe(false);
    expect(fatal.has('_json_str')).toBe(false);
    // And the DENOMINATOR: ccd captures ~364 helper calls in `$( )` across 49
    // distinct helpers. If this collapsed toward zero the assertion below
    // would pass because it found nothing to look at, not because the file is
    // clean — the exact "test that cannot fail" this build kept finding.
    const captured = capturedCalls(src);
    expect(captured.length).toBeGreaterThan(300);
    expect(new Set(captured.map((c) => c.name)).size).toBeGreaterThan(40);
    for (const n of ['_reg_get', '_json_str', '_tmux', '_ws_common_dir']) {
      expect(captured.map((c) => c.name)).toContain(n);
    }
  });

  it('never wraps a fatal thing in a command substitution', () => {
    expect(demotionSites(src),
      'a `die` inside $( ) kills only the subshell, so a process-fatal error becomes a return ' +
      'code — and rc 1 is in no ccd caller\'s failure set (they test rc 3 and rc 4). Fix it the ' +
      'way D-297 was fixed: return the value through a documented global and drop the ' +
      'substitution, so the hazard is unrepresentable. `|| exit $?` at each call site is a rule ' +
      'every future caller must remember, which is what this guard exists to replace.')
      .toEqual([]);
  });
});
