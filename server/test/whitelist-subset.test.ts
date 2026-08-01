// Three layers against one failure: an argv the server emits that the agent
// refuses. That failure is invisible to every other test in this repo — the
// route returns 502 only on the live fleet — and it has already shipped once
// (ws-add/ws-rm).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExecAllowed } from '../../agent/src/whitelist.js';
import { CCD_ARGV, verbSupported } from '../src/ccdargv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..', 'src');

/** One representative call per entry. Every entry MUST appear: the exhaustive
 *  assertion below is what stops a new route hiding behind an untested one. */
const SAMPLES: Record<keyof typeof CCD_ARGV, string[]> = {
  start: ['claude', 'demo'],
  // `enable` is a SEPARATE entry, not a parameter of `start`: POST /api/sessions
  // picks between the two words (`server.ts:298`) and the agent grants them
  // separately, so layer 3 below fails outright if nothing builds `enable`.
  enable: ['claude', 'demo'],
  ensure: ['demo-quiet-basin'],
  stopId: ['demo-quiet-basin'],
  stopPair: ['claude', 'demo'],
  swap: ['demo-quiet-basin', 'claude2'],
  wsAdd: ['demo'],
  prStateSession: ['demo-quiet-basin'],
  prStateProject: ['demo'],
  prOpen: ['demo-quiet-basin', 'the work', 'Ym9keQ==', 'false'],
  wsArchive: ['demo-quiet-basin'],
  wsRestore: ['demo-quiet-basin'],
  wsAudit: ['demo-quiet-basin'],
  wsReap: ['a'.repeat(64), 'demo-quiet-basin'],
  wsAttic: ['demo-quiet-basin'],
};

describe('layer 2 — every argv the server can build passes the agent whitelist', () => {
  it('has a sample for every CCD_ARGV entry', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(CCD_ARGV).sort());
  });

  it.each(Object.keys(CCD_ARGV) as (keyof typeof CCD_ARGV)[])('%s', (key) => {
    const build = CCD_ARGV[key] as (...a: unknown[]) => string[];
    const argv = build(...(SAMPLES[key] as unknown[]));
    expect(isExecAllowed('ccd', argv), `${key} -> ccd ${argv.join(' ')}`).toBe(true);
  });
});

/**
 * Find the index of the ')' that matches the '(' at `text[openIdx]`, counting
 * nested `()`. Does NOT understand string/template literals — none of this
 * codebase's runner call sites put an unbalanced paren inside one, and that
 * limitation is why this file parses only the specific shapes it names, not
 * arbitrary TypeScript.
 */
function matchParen(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  throw new Error(`unbalanced parens from index ${openIdx}`);
}

/** Split a call's raw argument-list text on top-level (depth-0) commas. */
function splitTopLevelArgs(argsText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { parts.push(argsText.slice(start, i)); start = i + 1; }
  }
  parts.push(argsText.slice(start));
  return parts;
}

/** True iff `text`, trimmed, is EXACTLY one `CCD_ARGV.<name>(...)` call — the
 *  call's own closing paren must be the last character, so a call with a
 *  trailing operation (`CCD_ARGV.ensure(id).slice(0,1)`) does not qualify. */
function isDirectCcdArgvCall(text: string): boolean {
  const t = text.trim();
  if (!/^CCD_ARGV\.\w+\(/.test(t)) return false;
  const openIdx = t.indexOf('(');
  let closeIdx: number;
  try { closeIdx = matchParen(t, openIdx); } catch { return false; }
  return closeIdx === t.length - 1;
}

/** True iff `text` is a direct `CCD_ARGV.<name>(...)` call, or a ternary
 *  (`cond ? CCD_ARGV.a(...) : CCD_ARGV.b(...)`) whose two branches both are.
 *  The `?`/`:` are located at bracket-depth 0 so a `?`/`:` inside either
 *  branch's own argument list is not mistaken for the ternary's — and a `?.`
 *  optional-chain token is never read as the ternary operator. */
function isAllowedArgvExpr(text: string): boolean {
  const t = text.trim();
  if (isDirectCcdArgvCall(t)) return true;
  let depth = 0;
  let qIdx = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '?' && depth === 0 && t[i + 1] !== '.') { qIdx = i; break; }
  }
  if (qIdx === -1) return false;
  depth = 0;
  let cIdx = -1;
  // MUTATION-SWEEP FINDING, disclosed: removing this loop's `break` (so cIdx
  // lands on the LAST depth-0 ':' instead of the first) survives every case
  // this file's own tests construct. Reasoned rather than merely unobserved:
  // whichever ':' is chosen, the candidate consequent/alternate span on the
  // "wrong" side of a two-colon input always contains a COMPLETE embedded
  // CCD_ARGV(...) call followed by more text, and `isDirectCcdArgvCall`'s own
  // trailing-content check (the `closeIdx === t.length - 1` above) rejects
  // that independently of which colon produced it — so for this checker's
  // restricted "exactly one flat ternary" shape, first-vs-last-colon cannot
  // be made to disagree without ALSO defeating that other, independently
  // exercised check (proven killable on its own, see the unit coverage
  // below). Kept as first-match for clarity of intent, not because a test
  // here depends on it.
  for (let i = qIdx + 1; i < t.length; i++) {
    const c = t[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ':' && depth === 0) { cIdx = i; break; }
  }
  if (cIdx === -1) return false;
  return isDirectCcdArgvCall(t.slice(qIdx + 1, cIdx)) && isDirectCcdArgvCall(t.slice(cIdx + 1));
}

/**
 * The RHS text of the NEAREST `const <ident> = <expr>;` occurring strictly
 * before `beforeIndex` in `src`, or null when there is none. "Nearest", not
 * "first": Task 13 gave several PR-lifecycle route handlers their own local
 * `const argv = CCD_ARGV.…(...)` — same identifier name, once per handler —
 * so binding to the CLOSEST preceding declaration is what keeps one
 * handler's `argv` from vouching for a different handler's call. Route
 * handlers in this codebase are sequential, non-nested top-level statements,
 * so for every real call site here "nearest preceding" always resolves to
 * the enclosing handler's own declaration; a hand-written case that defeats
 * that shape is out of scope the same way obfuscated member access
 * (`CCD_ARGV['ensure'](id)`) already is, per the block comment above.
 */
function lastConstDeclBefore(src: string, beforeIndex: number, ident: string): string | null {
  const declRe = new RegExp(`\\bconst\\s+${ident}\\s*=\\s*`, 'g');
  let rhsStart = -1;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(src))) {
    if (m.index >= beforeIndex) break;
    rhsStart = m.index + m[0].length;
  }
  if (rhsStart === -1) return null;
  let depth = 0;
  for (let i = rhsStart; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return src.slice(rhsStart, i);
  }
  return null;   // no top-level `;` before EOF — not a shape a real file has
}

/**
 * True iff `expr` — a `ccd(...)` call's own third-argument text — is
 * provably a CCD_ARGV construction: directly, via `isAllowedArgvExpr`, or —
 * new in Task 13, when PR-lifecycle routes stopped funnelling every
 * non-`runCcd` `ccd()` call through one shared forwarding call — as a bare
 * local identifier whose nearest preceding declaration is itself such an
 * expression.
 */
function resolvesToAllowedArgv(src: string, callIndex: number, expr: string): boolean {
  const t = expr.trim();
  if (isAllowedArgvExpr(t)) return true;
  if (!/^[A-Za-z_$][\w$]*$/.test(t)) return false;
  const rhs = lastConstDeclBefore(src, callIndex, t);
  return rhs !== null && isAllowedArgvExpr(rhs);
}

describe('layer 2b\'s parsing helpers — direct unit coverage for shapes the codebase doesn\'t contain yet', () => {
  // These pin isDirectCcdArgvCall/isAllowedArgvExpr against adversarial or
  // edge-case input the shipped codebase doesn't currently exercise, so a
  // regression in the PARSING LOGIC ITSELF is caught here — a mutation sweep
  // over this file found each of these survived against real content alone.
  it('rejects a CCD_ARGV call with trailing content — a logical-OR fallback to a dangerous literal', () => {
    // isExecAllowed only ever sees CCD_ARGV.ensure(id)'s own grant; it never
    // evaluates the trailing `|| [...]`, so requiring the call's own closing
    // paren to be the LAST character is load-bearing, not decorative.
    expect(isAllowedArgvExpr("CCD_ARGV.ensure(id) || ['ws-rm', id]")).toBe(false);
  });

  it('rejects CCD_ARGV appearing mid-expression rather than at the very start', () => {
    expect(isAllowedArgvExpr('wrap(CCD_ARGV.ensure(id))')).toBe(false);
  });

  it('does not mistake a `?.` optional-chain token for the ternary operator', () => {
    expect(isAllowedArgvExpr('body?.enable ? CCD_ARGV.start(a, b) : CCD_ARGV.enable(a, b)')).toBe(true);
  });

  it('rejects a NESTED ternary — only a flat two-way CCD_ARGV/CCD_ARGV split is allowed', () => {
    expect(isAllowedArgvExpr('a ? CCD_ARGV.start(x) : b ? CCD_ARGV.enable(x) : CCD_ARGV.ensure(x)')).toBe(false);
  });

  it('requires BOTH ternary branches to be CCD_ARGV calls, not just one', () => {
    expect(isAllowedArgvExpr('a ? notCcdArgv() : CCD_ARGV.ensure(x)')).toBe(false);
  });

  // resolvesToAllowedArgv / lastConstDeclBefore (Task 13): the tracer that
  // lets a `ccd(...)` call site outside `runCcd` pass a bare local `argv`
  // identifier rather than the (already covered) direct CCD_ARGV call.
  it('traces a bare identifier back to its nearest preceding CCD_ARGV declaration', () => {
    const src = "async () => {\n  const argv = CCD_ARGV.ensure(id);\n  return ccd(a, b, argv);\n}\n";
    expect(resolvesToAllowedArgv(src, src.indexOf('ccd(a'), 'argv')).toBe(true);
  });

  it('rejects a bare identifier whose nearest preceding declaration is NOT a CCD_ARGV construction', () => {
    const src = "async () => {\n  const argv = ['ws-rm', id];\n  return ccd(a, b, argv);\n}\n";
    expect(resolvesToAllowedArgv(src, src.indexOf('ccd(a'), 'argv')).toBe(false);
  });

  it('rejects a bare identifier with no preceding declaration in the file at all', () => {
    const src = 'return ccd(a, b, argv);\n';
    expect(resolvesToAllowedArgv(src, src.indexOf('ccd(a'), 'argv')).toBe(false);
  });

  it('binds each call to the NEAREST preceding declaration, not the first, when the name repeats per-handler', () => {
    // Exactly the shape Task 13 introduced: several handlers each declare
    // their OWN `const argv = CCD_ARGV....(...)`. The second call must not be
    // allowed to slide past on the FIRST declaration if that one is later
    // reassigned to something unsafe — nor should the first call see the
    // second (later) declaration at all, since `lastConstDeclBefore` only
    // looks strictly BEFORE its own call's index.
    const src =
      "h1: { const argv = CCD_ARGV.ensure(id); ccd(a, b, argv); }\n" +
      "h2: { const argv = ['ws-rm', id];       ccd(a, b, argv); }\n";
    const first = src.indexOf('ccd(a, b, argv)');
    const second = src.indexOf('ccd(a, b, argv)', first + 1);
    expect(resolvesToAllowedArgv(src, first, 'argv')).toBe(true);
    expect(resolvesToAllowedArgv(src, second, 'argv')).toBe(false);
  });

  it('does not fall for a same-shaped declaration under a DIFFERENT identifier name', () => {
    const src = "const argv2 = CCD_ARGV.ensure(id);\nreturn ccd(a, b, argv);\n";
    expect(resolvesToAllowedArgv(src, src.indexOf('ccd(a'), 'argv')).toBe(false);
  });
});

describe('layer 2b — every runner call site\'s argv is a direct CCD_ARGV call', () => {
  // Finding (review round 1, Task 11): the original rule was a BLACKLIST — "no
  // inline array literal sits at a runCcd(...)/ccd(...) call site" — which a
  // trivial refactor defeats twice over: `const argv = ['ensure', id]; return
  // runCcd(reply, argv);` has no array literal AT the call site, and neither
  // does moving the construction into a same-file helper function. Both leave
  // this file fully green while reproducing the exact ws-add/ws-rm failure
  // class this task exists to prevent. Same lesson the exec whitelist itself
  // teaches: enumerate what IS allowed, not what is forbidden.
  //
  // So this is now a WHITELIST over two known argv-sink call shapes:
  //   (A) every `runCcd(` call site — its argv argument must be a direct
  //       `CCD_ARGV.<name>(...)` call, or a ternary of exactly two such calls
  //       (the `enable`/`start` picker in `server.ts` is that shape).
  //   (B) every `ccd(` call (the `lifecycle.ts` helper `runCcd` wraps,
  //       matched with a word boundary so it does not also match `runCcd(`)
  //       that is a CALL rather than `ccd`'s own `function ccd(...)`
  //       declaration. Shipped originally (Task 11) as "at most one such call
  //       outside `ccdargv.ts`/`exec.ts`, and it must be `runCcd`'s own
  //       internal forwarding call" — the simplest statement of the
  //       invariant while `runCcd`'s fixed `{ok:true}`/502 shape was the only
  //       response shape anything needed. Task 13's PR-lifecycle routes need
  //       OTHER shapes `runCcd` cannot express (a 200 carrying
  //       `phase:unknown`, a parsed `WsAudit`/`ReapResult`, a 501 hoisted out
  //       of a queued fn) and so call `ccd()` directly, more than once — so
  //       "at most one" stopped being the property that matters. What still
  //       matters, unchanged, is that EVERY argv reaching `ccd()` is provably
  //       a `CCD_ARGV.<name>(...)` construction: each call site is now
  //       individually held to that proof — `runCcd`'s own forwarding call by
  //       its declared parameter name exactly as before, every other site by
  //       `resolvesToAllowedArgv`, which accepts a direct call (or two-way
  //       ternary of them, reusing `isAllowedArgvExpr`) OR a bare local
  //       identifier whose NEAREST preceding `const <name> = …` declaration
  //       is one of those — the shape Task 13's routes use when the same
  //       argv is read once for `verbSupported` and again for the call.
  //   (C) zero occurrences of `deps.run(`/`this.run(` outside `exec.ts` — a
  //       direct bypass of both `runCcd` and `ccd()`.
  //
  // What this does NOT catch, disclosed rather than implied: deliberately
  // obfuscated call syntax (`(0, CCD_ARGV.ensure)(id)`, dynamic member access
  // `CCD_ARGV['ensure'](id)`, or a local shadowing `const CCD_ARGV = …`) —
  // out of scope the same way the type system itself does not defend against
  // deliberate obfuscation. It also does not parse string/template literals
  // (see `matchParen`'s own comment), which is not a shape any real call site
  // here uses. It also does not strip comments before scanning for `ccd(` —
  // confirmed empirically (Task 11 fix-round M10 reproduction) when a test
  // comment's own English prose happened to contain the literal substring
  // `ccd()` and was counted as a third call site. No shipped comment in this
  // tree currently contains that substring (checked by hand, not by this
  // file), so it is not a false positive today — but it means the phrase
  // "ccd(" is slightly radioactive to use in a comment anywhere in `src/`
  // outside `ccdargv.ts`/`exec.ts` until this scan learns to skip comments.
  const offenders: string[] = [];
  const runCcdCallSites: { file: string; argv: string }[] = [];
  const ccdCallSites: { file: string; args: string[]; src: string; callIndex: number }[] = [];
  let runCcdArgvParam: string | null = null;

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, name.name);
      if (name.isDirectory()) { walk(p); continue; }
      if (!name.name.endsWith('.ts')) continue;
      if (p === path.join(srcDir, 'ccdargv.ts') || p === path.join(srcDir, 'exec.ts')) continue;
      const rel = path.relative(srcDir, p);
      const src = readFileSync(p, 'utf8');

      // Capture runCcd's own declared argv-parameter name, wherever it's
      // defined, so check (B) verifies against the REAL name rather than a
      // hardcoded guess that could silently stop matching after a rename.
      const def = /\brunCcd\s*=\s*async\s*\(\s*\w+(?:\s*:\s*[^,)]+)?\s*,\s*(\w+)(?:\s*:\s*[^,)]+)?\s*\)\s*=>/.exec(src);
      if (def) runCcdArgvParam = def[1]!;

      // (A) runCcd( call sites.
      const runCcdRe = /\brunCcd\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = runCcdRe.exec(src))) {
        const openIdx = m.index + m[0].length - 1;
        const closeIdx = matchParen(src, openIdx);
        const parts = splitTopLevelArgs(src.slice(openIdx + 1, closeIdx));
        if (parts.length !== 2) {
          offenders.push(`${rel}: runCcd(...) called with ${parts.length} args, expected 2`);
          continue;
        }
        runCcdCallSites.push({ file: rel, argv: parts[1]! });
      }

      // (B) ccd( CALLS — word-boundary so `runCcd(` never matches — excluding
      // `function ccd(`/`async function ccd(`, which is the DECLARATION, not
      // a call.
      const ccdRe = /\bccd\s*\(/g;
      while ((m = ccdRe.exec(src))) {
        const before = src.slice(Math.max(0, m.index - 10), m.index);
        if (/function\s*$/.test(before)) continue;
        const openIdx = m.index + m[0].length - 1;
        const closeIdx = matchParen(src, openIdx);
        const parts = splitTopLevelArgs(src.slice(openIdx + 1, closeIdx)).map((s) => s.trim());
        ccdCallSites.push({ file: rel, args: parts, src, callIndex: m.index });
      }

      // (C) direct runner bypass.
      for (const [i, line] of src.split('\n').entries()) {
        if (/\bdeps\.run\s*\(|\bthis\.run\s*\(/.test(line)) {
          offenders.push(`${rel}:${i + 1}: direct runner call bypassing runCcd/ccd(): ${line.trim()}`);
        }
      }
    }
  };
  walk(srcDir);

  it('every runCcd(...) call\'s argv is a direct CCD_ARGV call (or a two-way ternary of them)', () => {
    for (const site of runCcdCallSites) {
      if (!isAllowedArgvExpr(site.argv)) {
        offenders.push(`${site.file}: runCcd(reply, ${site.argv.trim()}) — argv must be a direct CCD_ARGV.<name>(...) call`);
      }
    }
    expect(offenders, `build these through CCD_ARGV instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('every ccd() call outside ccdargv.ts/exec.ts is runCcd\'s own forwarding call, or has a provably CCD_ARGV-built argv', () => {
    expect(runCcdArgvParam, 'could not find runCcd\'s own definition to learn its argv parameter name').not.toBeNull();
    // Sanity floor on the scan itself: Task 13 is known to add several direct
    // ccd() call sites (GET/POST pr, GET workspace/audit, POST
    // workspace/reap), so a regression that made the `ccdRe` walk above find
    // NOTHING would make every check below vacuously true.
    expect(ccdCallSites.length).toBeGreaterThan(1);
    const bad: string[] = [];
    for (const site of ccdCallSites) {
      const argv = site.args[2] ?? '';
      if (argv === runCcdArgvParam) continue;   // runCcd's own forwarding call
      if (!resolvesToAllowedArgv(site.src, site.callIndex, argv)) {
        bad.push(`${site.file}: ccd(${site.args.join(', ')}) — third argument must be runCcd's own argv parameter ('${runCcdArgvParam}'), or a CCD_ARGV.<name>(...) construction (direct, a two-way ternary of them, or a local const assigned from one)`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});

describe('layer 3 — the list never drifts wider than the code', () => {
  it('every ccd prefix the agent grants is reachable from some CCD_ARGV entry', () => {
    // The reverse direction. This is what catches a dead grant like `clip`.
    //
    // The slice starts AFTER `ccd: [`, not at it. Starting at it makes the
    // OUTER bracket the first match, `[^\]]*` swallows the first entry, and
    // `granted[0]` comes back as the single token `['start` — unreachable by
    // construction, so the test fails on a grant that is perfectly fine.
    // (Measured on the real block: old parse gives ["['start"], new gives
    // ["start"], every later entry identical.) Line comments are stripped so a
    // `[` inside one — `['ws-gc'] would permit --prune` sits two lines above —
    // can never be read as a grant.
    const wl = readFileSync(path.resolve(here, '..', '..', 'agent', 'src', 'whitelist.ts'), 'utf8');
    const open = wl.indexOf('ccd: [') + 'ccd: ['.length;
    const block = wl.slice(open, wl.indexOf('};', open))
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const granted = [...block.matchAll(/\[([^\]]*)\]/g)]
      .map((m) => m[1]!.split(',').map((t) => t.trim().replace(/^'|'$/g, '')).filter(Boolean))
      .filter((p) => p.length > 0);
    const built = (Object.keys(CCD_ARGV) as (keyof typeof CCD_ARGV)[])
      .map((k) => (CCD_ARGV[k] as (...a: unknown[]) => string[])(...(SAMPLES[k] as unknown[])));
    for (const prefix of granted) {
      const reachable = built.some((argv) => prefix.every((tok, i) => argv[i] === tok));
      expect(reachable, `ccd ${prefix.join(' ')} is granted but no route builds it`).toBe(true);
    }
  });

  it('refuses to emit a verb the agent did not advertise, and permits everything when it said nothing', () => {
    const state = { connected: true, downSince: null, ccdVerbs: ['start', 'pr-state'] };
    expect(verbSupported(state, CCD_ARGV.prStateSession('x'))).toBe(true);
    expect(verbSupported(state, CCD_ARGV.wsReap('a'.repeat(64), 'x'))).toBe(false);
    // Null is "no evidence", not "no verbs": local mode and an older agent
    // must not have every control greyed out.
    // A NAMED const, not an inline literal, same as `state` above: an inline
    // object literal passed directly as an argument is excess-property-
    // checked against the narrower `Pick<FleetState, 'ccdVerbs'>` parameter
    // type, and `connected`/`downSince` aren't in it — a pre-existing type
    // error invisible to every gate because server's tsconfig excludes
    // test/. Same runtime value either way; only the shape TS checks it
    // against changes.
    const nullState = { connected: true, downSince: null, ccdVerbs: null };
    expect(verbSupported(nullState, CCD_ARGV.wsReap('a'.repeat(64), 'x'))).toBe(true);
    expect(verbSupported(undefined, CCD_ARGV.wsReap('a'.repeat(64), 'x'))).toBe(true);
  });

  // Review finding (round 1, Task 11): mutating `if (verbs === null)` to
  // `if (verbs === null || verbs.length === 0)` left the whole suite green —
  // nothing above exercises `ccdVerbs: []` against `verbSupported`, only
  // `null` and a populated array. The distinction is load-bearing: `null`
  // means "no evidence yet" (a reconnect is in flight — permit, per the test
  // above); `[]` means the fleet ACTIVELY reported zero verbs (a real answer,
  // however sparse) — refuse. Conflating them would silently re-permit
  // everything for the duration of a state that ought to grey the whole
  // feature out.
  it('an EMPTY ccdVerbs is not the same as null — the fleet reported no verbs, so refuse', () => {
    const empty = { connected: true, downSince: null, ccdVerbs: [] };
    expect(verbSupported(empty, CCD_ARGV.wsReap('a'.repeat(64), 'x'))).toBe(false);
    expect(verbSupported(empty, CCD_ARGV.ensure('x'))).toBe(false);
  });
});

describe('layer 2c — exact argv, not just prefix compliance (mutation-sweep finding)', () => {
  // MUTATION-SWEEP FINDING (Task 11, M10): swapping `--title`/t and
  // `--body-b64`/b64 in `CCD_ARGV.prOpen` left the whole suite green. Layer 2's
  // `isExecAllowed` and layer 3's reachability check both stop at the GRANTED
  // PREFIX (`['pr-open', '--session']` — two tokens for `prOpen`; similarly
  // short prefixes for every `--session`/`--project`-flavoured entry), so
  // nothing before this test ever looked past it. `ccd` itself enforces fixed
  // arity and flag order on every one of these seven new verbs (Task 9
  // review), so a reordered argv is green in this repo and FORBIDDEN — or
  // silently wrong — on the fleet: "route added, whitelist not updated, all
  // suites green, dead on the fleet" wearing a different hat.
  //
  // Audited (corrected — an earlier draft of this comment wrongly lumped
  // `wsReap` in with the single-trailing-id group below; the fix already
  // covered it correctly, only the prose was wrong): of the other entries
  // with a flag beyond the granted prefix, `prStateSession`, `prStateProject`,
  // `wsArchive`, `wsRestore`, `wsAudit`, and `wsAttic` have exactly one flag
  // immediately inside the prefix plus a single trailing id, which has
  // nothing to reorder against. `wsReap` does NOT belong in that group: its
  // prefix (`['ws-reap', '--expect']`) is followed by `tok`, and THEN a
  // second flag+value pair (`--session`, id) — the same shape as `prOpen`
  // (a bare value immediately after the prefix, then more flag pairs), just
  // with one pair instead of three. So `prOpen` and `wsReap` both have order
  // that can silently drift; this table pins all fifteen regardless — token
  // for token, not just "the agent would let it through" — one assertion
  // closes the class rather
  // than one instance of it.
  const EXPECTED: Record<keyof typeof CCD_ARGV, string[]> = {
    start: ['start', 'claude', 'demo'],
    enable: ['enable', 'claude', 'demo'],
    ensure: ['ensure', 'demo-quiet-basin'],
    stopId: ['stop', 'demo-quiet-basin'],
    stopPair: ['stop', 'claude', 'demo'],
    swap: ['swap', 'demo-quiet-basin', 'claude2'],
    wsAdd: ['ws-add', 'demo'],
    prStateSession: ['pr-state', '--session', 'demo-quiet-basin'],
    prStateProject: ['pr-state', '--project', 'demo'],
    // SAMPLES.prOpen's fourth element is the STRING 'false' (SAMPLES is typed
    // string[] and the call site casts through `unknown[]`), which is truthy
    // at runtime — so this sample actually exercises the `draft: true` arm.
    // The real boolean-vs-boolean mapping is pinned unambiguously below.
    prOpen: ['pr-open', '--session', 'demo-quiet-basin', '--title', 'the work', '--body-b64', 'Ym9keQ==', '--draft', 'true'],
    wsArchive: ['ws-archive', '--session', 'demo-quiet-basin'],
    wsRestore: ['ws-restore', '--session', 'demo-quiet-basin'],
    wsAudit: ['ws-audit', '--session', 'demo-quiet-basin'],
    wsReap: ['ws-reap', '--expect', 'a'.repeat(64), '--session', 'demo-quiet-basin'],
    wsAttic: ['ws-attic', '--session', 'demo-quiet-basin'],
  };

  it.each(Object.keys(CCD_ARGV) as (keyof typeof CCD_ARGV)[])('%s builds the exact argv, token for token', (key) => {
    const build = CCD_ARGV[key] as (...a: unknown[]) => string[];
    expect(build(...(SAMPLES[key] as unknown[]))).toEqual(EXPECTED[key]);
  });

  it('prOpen maps a real boolean draft to --draft true/false unambiguously', () => {
    expect(CCD_ARGV.prOpen('demo-quiet-basin', 'the work', 'Ym9keQ==', true))
      .toEqual(['pr-open', '--session', 'demo-quiet-basin', '--title', 'the work', '--body-b64', 'Ym9keQ==', '--draft', 'true']);
    expect(CCD_ARGV.prOpen('demo-quiet-basin', 'the work', 'Ym9keQ==', false))
      .toEqual(['pr-open', '--session', 'demo-quiet-basin', '--title', 'the work', '--body-b64', 'Ym9keQ==', '--draft', 'false']);
  });
});
