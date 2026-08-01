// Three layers against one failure: an argv the server emits that the agent
// refuses. That failure is invisible to every other test in this repo — the
// route returns 502 only on the live fleet — and it has already shipped once
// (ws-add/ws-rm).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExecAllowed } from '../../agent/src/whitelist.js';
import { CCD_ARGV, verbSupported } from '../src/ccdargv.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** One representative call per entry. Every entry MUST appear: the exhaustive
 *  assertion below is what stops a new route hiding behind an untested one. */
const SAMPLES: Record<keyof typeof CCD_ARGV, string[]> = {
  start: ['claude', 'demo'],
  // `enable` is a SEPARATE entry, not a parameter of `start`: POST /api/sessions
  // picks between the two words (`POST /api/sessions` in `server.ts`) and the agent grants them
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
    // `readonly string[]`, not `string[]`: entries return the branded `CcdArgv`
    // (task 13S), which is readonly, so the old cast target is no longer a
    // comparable type. `isExecAllowed` takes a mutable array, hence the copy.
    const build = CCD_ARGV[key] as (...a: unknown[]) => readonly string[];
    const argv = build(...(SAMPLES[key] as unknown[]));
    expect(isExecAllowed('ccd', [...argv]), `${key} -> ccd ${argv.join(' ')}`).toBe(true);
  });
});

// Layer 2b — DELETED in task 13S, and deliberately not replaced with a fifth
// regex. It asserted "every ccd argv is built in ccdargv.ts and nowhere else"
// by scanning the source TEXT of `src/`, and was defeated in four consecutive
// rounds by four different ways of naming a value: an inline array literal at
// the call site; a `const argv = [...]` extracted before the call; a
// `const runner = deps.run` aliasing the runner; and a one-identifier rename
// (`args`) that walked straight through the untraced parameter-name exemption.
// A text scan over a Turing-complete language cannot enumerate the ways to
// name a value.
//
// The property is now unexpressible-to-violate rather than policed:
//   * `CCD_ARGV`'s entries return `CcdArgv`, a nominally branded
//     `readonly string[]`, and the single cast that mints one lives in
//     `ccdargv.ts` — so no `string[]`, however built or named, is assignable;
//   * `Deps` carries no raw `run`, only `runCcd: (argv: CcdArgv) => …`, so
//     there is no runner to reach and no value of the right type to invent.
// `ccdargv-brand.test.ts` pins both halves as COMPILE failures, replaying all
// four historical bypasses. What that mechanism does NOT cover, disclosed
// rather than implied, is written up there.

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
      .map((k) => (CCD_ARGV[k] as (...a: unknown[]) => readonly string[])(...(SAMPLES[k] as unknown[])));
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
    const build = CCD_ARGV[key] as (...a: unknown[]) => readonly string[];
    expect(build(...(SAMPLES[key] as unknown[]))).toEqual(EXPECTED[key]);
  });

  it('prOpen maps a real boolean draft to --draft true/false unambiguously', () => {
    expect(CCD_ARGV.prOpen('demo-quiet-basin', 'the work', 'Ym9keQ==', true))
      .toEqual(['pr-open', '--session', 'demo-quiet-basin', '--title', 'the work', '--body-b64', 'Ym9keQ==', '--draft', 'true']);
    expect(CCD_ARGV.prOpen('demo-quiet-basin', 'the work', 'Ym9keQ==', false))
      .toEqual(['pr-open', '--session', 'demo-quiet-basin', '--title', 'the work', '--body-b64', 'Ym9keQ==', '--draft', 'false']);
  });
});
