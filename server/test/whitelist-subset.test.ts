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

describe('layer 2b — ccdargv.ts is the ONLY place ccd argv is built', () => {
  it('no inline argv array literal sits at a runner call site outside ccdargv.ts and exec.ts', () => {
    // Style is not the point: a route that builds its own array is a route the
    // exhaustive table above cannot see.
    //
    // The FIRST pattern must match `runCcd(reply, [...])`, which is the shape
    // every real ccd argv literal in server/src has (`server.ts:300, 305, 310,
    // 327, 335, 399`). A `\brun\s*\(` alternation does NOT match `runCcd(` —
    // it requires the paren immediately after `run` — so an earlier draft of
    // this scan passed with all six literals still in place, which is the
    // whole defect it exists to catch. Verified against every real call site:
    // it flags those six and `deps.run('tmux', [...])` at server.ts:218, and
    // does NOT flag `const runCcd = async (reply, args) => {`,
    // `ccd(deps.run, deps.cfg, args)`, or `queue.run(id, () => …)`.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, name.name);
        if (name.isDirectory()) { walk(p); continue; }
        if (!name.name.endsWith('.ts')) continue;
        if (p === path.join(srcDir, 'ccdargv.ts') || p === path.join(srcDir, 'exec.ts')) continue;
        const src = readFileSync(p, 'utf8');
        for (const [i, line] of src.split('\n').entries()) {
          if (/\b(?:\w+\.)?(?:run|runCcd)\s*\(\s*[^,]+,\s*\[/.test(line)) {
            offenders.push(`${path.relative(srcDir, p)}:${i + 1}: ${line.trim()}`);
          }
          if (/\bccd\s*\(\s*[^,]+,\s*[^,]+,\s*\[/.test(line)) {
            offenders.push(`${path.relative(srcDir, p)}:${i + 1}: ${line.trim()}`);
          }
        }
      }
    };
    walk(srcDir);
    expect(offenders, `build these through CCD_ARGV instead:\n${offenders.join('\n')}`).toEqual([]);
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
    expect(verbSupported({ connected: true, downSince: null, ccdVerbs: null }, CCD_ARGV.wsReap('a'.repeat(64), 'x'))).toBe(true);
    expect(verbSupported(undefined, CCD_ARGV.wsReap('a'.repeat(64), 'x'))).toBe(true);
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
  // Audited: of the other entries with a flag beyond the granted prefix
  // (`prStateSession`, `prStateProject`, `wsArchive`, `wsRestore`, `wsAudit`,
  // `wsReap`, `wsAttic`), only `prOpen` has more than one flag+value PAIR
  // trailing the prefix — the rest have exactly one flag immediately
  // inside the prefix plus a single trailing id, which has nothing to
  // reorder against. So `prOpen` is the only entry order can silently drift
  // in; this table pins all fifteen anyway; token for token, not just
  // "the agent would let it through" — one assertion closes the class rather
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
