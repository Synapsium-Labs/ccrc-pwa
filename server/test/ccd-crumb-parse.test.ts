// server/test/ccd-crumb-parse.test.ts
//
// The reaping breadcrumb (`$REG/<id>.reaping`) has ONE grammar and ONE parser in
// ccd, `_crumb_parse` (ARCH-25, #531). A bare phase is `ws-reap`'s spelling;
// `reclaim:<phase>` and `expire:<phase>` are the two other verbs'. A defect once
// read an unrecognised crumb loosely, skipped the worktree removal, deleted the
// branch and the registry row, and reported success (see `_ws_reap_locked`'s
// "LOOSE reading" note); the parser fails closed so no caller can repeat it.
//
// Three checks. (1) A table of the grammar, run through the real function.
// (2) A round-trip: every token a writer in ccd writes parses to a known
// (act, phase) — the writers are READ FROM the source, so a new writer with a
// new token reds here. (3) A scanner: the prefix and phase vocabulary is spelled
// only inside `_crumb_parse`, so no second parse site can grow beside it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { CCD, ghContainedEnv, seedAccountsSh, ccdSource } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';
import { REAP_ACTS, REAP_PHASE_NAMES, REAP_PHASES } from '../../shared/reapcrumb.js';

const src = ccdSource();

let home: string;
beforeEach(() => { home = mkTmp('ccrc-ccd-home-'); seedAccountsSh(home); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

/** `_crumb_parse <crumb>` in a fixture HOME -> `rc|act|phase`. */
const parse = (crumb: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; _crumb_parse "$1"; printf '%s|%s|%s' "$?" "$_CRUMB_ACT" "$_CRUMB_PHASE"`, 'x', crumb],
    { encoding: 'utf8', env: ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true }) });

/** The body of `_crumb_parse`, from its opening line to the closing brace at column 0. */
const parserBody = (): string => {
  const from = src.indexOf('_crumb_parse() {');
  const to = from < 0 ? -1 : src.indexOf('\n}\n', from);
  return from > -1 && to > from ? src.slice(from, to) : '';
};

describe('_crumb_parse', () => {
  it('reads ws-reap bare phases as the reap act', () => {
    for (const p of ['children', 'worktree', 'branch', 'clips']) expect(parse(p)).toBe(`0|reap|${p}`);
  });
  it('reads reclaim: and expire: phases as their own acts', () => {
    for (const a of ['reclaim', 'expire']) {
      for (const p of ['children', 'worktree', 'branch', 'artifacts']) expect(parse(`${a}:${p}`)).toBe(`0|${a}|${p}`);
    }
  });
  it('fails closed on a crumb ccd never writes, still naming the act so a caller can refuse by verb', () => {
    expect(parse('sometime-else')).toBe('1|reap|sometime-else');
    expect(parse('reclaim:clips')).toBe('1|reclaim|clips');
    expect(parse('expire:sometime-else')).toBe('1|expire|sometime-else');
    expect(parse('reclaim:')).toBe('1|reclaim|');
    expect(parse('wat:branch')).toBe('1|reap|wat:branch');
    expect(parse('Branch')).toBe('1|reap|Branch');
    expect(parse('branch ')).toBe('1|reap|branch ');
  });
  it('answers 2, not "unknown", for no crumb at all', () => {
    expect(parse('')).toBe('2||');
  });
});

describe('the wire vocabulary and ccd agree', () => {
  const every = REAP_PHASE_NAMES;
  it.each(REAP_ACTS)('%s: the same phases are known on both sides', (act) => {
    for (const p of every) {
      const tok = act === 'reap' ? p : `${act}:${p}`;
      const known = REAP_PHASES[act].includes(p);
      expect(parse(tok).startsWith('0|'), tok).toBe(known);
    }
  });
});

describe('round trip: every writer\'s token parses to a known (act, phase)', () => {
  // `_reg_set "$id" reaping <token>`, the token written verbatim.
  const written = [...src.matchAll(/^\s*_reg_set "\$id" reaping (\S+)\s*(?:#.*)?$/gm)].map((m) => m[1].replace(/^"|"$/g, ''));
  // `_reg_set "$id" reaping "<token>"` inside a condition chain.
  const quoted = [...src.matchAll(/_reg_set "\$id" reaping "([^"]+)"/g)].map((m) => m[1]);
  const tokens = [...new Set([...written, ...quoted])];

  it('finds the writers (a coverage floor: a scan over nothing passes everything)', () => {
    expect(tokens.length).toBeGreaterThanOrEqual(9);
  });
  it.each(tokens)('%s', (tok) => {
    const concrete = tok.replace(/^\$_WS_RCL_ACT/, '@ACT@').replace(/\$start/g, 'children');
    const acts = concrete.includes('@ACT@') ? ['reclaim', 'expire'] : [''];
    for (const a of acts) {
      const t = concrete.replace('@ACT@', a);
      const out = parse(t);
      expect(out, t).toMatch(/^0\|(reap|reclaim|expire)\|(children|worktree|branch|clips|artifacts)$/);
    }
  });
});

describe('one parse site', () => {
  it('defines the parser once and has a body to scan', () => {
    expect(src.match(/^_crumb_parse\(\) \{/gm)?.length).toBe(1);
    expect(parserBody().length).toBeGreaterThan(200);
  });
  it('spells the crumb grammar nowhere outside the parser', () => {
    const body = parserBody();
    const outside = src.replace(body, '');
    const grammar = [
      /\breclaim:\*/, /\bexpire:\*/,                    // a prefix test
      /#(?:reclaim|expire):/,                           // a prefix strip
      /\bchildren\|worktree\|branch/,                   // a phase alternation
      /\breclaim:branch\b/, /\breclaim:artifacts\b/,    // a spelled-out phase
    ];
    const hits = outside.split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .filter((l) => grammar.some((g) => g.test(l)));
    expect(hits).toEqual([]);
    for (const g of grammar.slice(0, 3)) expect(g.test(body)).toBe(true);
  });
});
