// server/test/ccd-refusal-v1.test.ts
//
// ARCH-14 (#560): ccd prints `ccd-refusal: <act> <token>` before the die of every `_lc_refuse`, and the three lanes that
// used to rebuild the word from English read it FIRST. The prose matchers stay as the fallback for a ccd without
// `refusal-v1`.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts`'s `/^ccd.*\.ts$/` containment scan. It reads ccd's TEXT, and
// runs `cmd_forget`/`cmd_caps` in a fixture HOME only; it spawns no real tool.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  CCD_LOCK_UNOPENABLE, CCD_REFUSAL_CAP, CCD_REFUSAL_TOKENS, readCcdRefusal, withoutCcdRefusal,
} from '../../shared/ccd-refusal.js';
import { parseChildReclaimResult } from '../src/coord/childReclaim.js';
import { parseExpireResult } from '../src/archivedExpiry.js';
import { parseCollectResult } from '../src/collectLane.js';
import { makeCcdHarness, type CcdHarness, ccdSource } from './ccdWsHelpers.js';

const src = ccdSource();
const ID = 'demo-quiet-dune';
const LOCK = `/h/.cc-sessions/.reap-${ID}.lock`;
const BASH = `/h/ccd: line 9: ${LOCK}: Is a directory`;
/** A reworded die: nothing a prose matcher was ever written for. */
const REWORDED = 'ccd: the reap lock is not available right now';
const line = (act: string, token: string): string => `ccd-refusal: ${act} ${token}`;

describe('the shared reader', () => {
  it('finds the line anywhere in stderr, after bash’s own diagnostic and before the die', () => {
    expect(readCcdRefusal(`${BASH}\n${line('reclaim', 'lock-unopenable')}\n${REWORDED}`))
      .toEqual({ act: 'reclaim', token: 'lock-unopenable' });
  });
  it('is line-anchored: a line that merely contains the head is not one', () => {
    expect(readCcdRefusal(`x ${line('reclaim', 'held')}`)).toBeNull();
    expect(readCcdRefusal(`${line('reclaim', 'held')} and more`)).toBeNull();
    expect(readCcdRefusal('')).toBeNull();
  });
  it('a word this build does not list reads as no token — the prose fallback decides', () => {
    expect(readCcdRefusal(line('reclaim', 'a-word-from-a-newer-ccd'))).toBeNull();
  });
  it('withoutCcdRefusal drops only the token lines', () => {
    expect(withoutCcdRefusal(`${line('expire', 'held')}\nccd: bad token`)).toBe('ccd: bad token');
  });
});

describe('with refusal-v1, a fixture ccd with REWORDED die prose still classifies', () => {
  it('ws-reclaim: every pre-lock token', () => {
    for (const [token, want] of [
      ['flock-unavailable', 'flock-unavailable'], ['lock-unopenable', 'lock-unopenable'],
      ['token-malformed', 'token-malformed'], ['run-id-malformed', 'run-id-malformed'],
    ] as const) {
      expect(parseChildReclaimResult(ID, '', `${line('reclaim', token)}\n${REWORDED}`), token)
        .toEqual({ kind: 'failed', resume: 'pre-lock-die', token: want, detail: 'the reap lock is not available right now' });
    }
  });
  it('ws-reclaim: bash’s diagnostic before the token line no longer matters', () => {
    expect(parseChildReclaimResult(ID, '', `${BASH}\n${line('reclaim', 'lock-unopenable')}\n${REWORDED}`))
      .toMatchObject({ kind: 'failed', resume: 'pre-lock-die', token: 'lock-unopenable' });
  });
  it('ws-expire: both box words', () => {
    for (const word of ['flock-unavailable', 'lock-unopenable'] as const) {
      expect(parseExpireResult(ID, '', `${line('expire', word)}\n${REWORDED}`), word)
        .toEqual({ kind: 'box', word, detail: 'the reap lock is not available right now' });
    }
  });
  it('ws-collect: both die words, for this id', () => {
    for (const word of ['flock-unavailable', 'lock-unopenable'] as const) {
      expect(parseCollectResult(ID, false, '', `${line('collect', word)}\n${REWORDED}`), word)
        .toEqual({ kind: 'die', word });
    }
  });
  it('a token for another act is not this lane’s: it is read as before', () => {
    expect(parseExpireResult(ID, '', `${line('reclaim', 'lock-unopenable')}\n${REWORDED}`)).toMatchObject({ kind: 'failed', resumable: true });
    expect(parseChildReclaimResult(ID, '', `${line('expire', 'lock-unopenable')}\n${REWORDED}`)).toMatchObject({ resume: 'resumable' });
    expect(parseCollectResult(ID, false, '', `${line('expire', 'lock-unopenable')}\n${REWORDED}`)).toMatchObject({ kind: 'no-document' });
  });
  it('a document on stdout still wins over a token line', () => {
    expect(parseCollectResult(ID, true, '{"collected":"x"}', line('collect', 'held'))).toMatchObject({ kind: 'failed' });
  });
});

describe('a ccd WITHOUT refusal-v1 still classifies through the prose fallback', () => {
  it('ws-reclaim', () => {
    expect(parseChildReclaimResult(ID, '', `${BASH}\nccd: cannot open the reap lock at ${LOCK}`))
      .toMatchObject({ kind: 'failed', resume: 'pre-lock-die', token: 'lock-unopenable' });
    expect(parseChildReclaimResult(ID, '', 'ccd: bad token')).toMatchObject({ resume: 'pre-lock-die', token: 'token-malformed' });
  });
  it('ws-expire', () => {
    expect(parseExpireResult(ID, '', `${BASH}\nccd: cannot open the reap lock at ${LOCK}`)).toMatchObject({ kind: 'box', word: 'lock-unopenable' });
  });
  it('ws-collect', () => {
    expect(parseCollectResult(ID, false, '', `${BASH}\nccd: cannot open the reap lock at ${LOCK}`)).toEqual({ kind: 'die', word: 'lock-unopenable' });
  });
  it('a ccd WITH the line but a word this build does not list falls back to the prose, whole-output', () => {
    const err = `${line('reclaim', 'a-word-from-a-newer-ccd')}\nccd: bad token`;
    expect(parseChildReclaimResult(ID, '', err)).toMatchObject({ resume: 'pre-lock-die', token: 'token-malformed' });
  });
  it('ws-expire and ws-collect read their prose box dies through an unlisted word’s line, token lines dropped', () => {
    const flock = 'ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised';
    expect(parseExpireResult(ID, '', `${line('expire', 'a-word-from-a-newer-ccd')}\n${flock}`)).toMatchObject({ kind: 'box', word: 'flock-unavailable' });
    expect(parseCollectResult(ID, false, '', `${line('collect', 'a-word-from-a-newer-ccd')}\n${flock}`)).toEqual({ kind: 'die', word: 'flock-unavailable' });
  });
});

describe('the token set is one set', () => {
  /** Every literal token at a `_lc_refuse` call site: `_lc_refuse <act> <id> <token> …`, comments excluded. */
  const callSiteTokens = (): string[] => {
    const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const out = new Set<string>();
    for (const m of code.matchAll(/_lc_refuse\s+[a-z]+\s+("[^"]*"|'[^']*'|\S+)\s+([a-z][a-z0-9-]*)(?=\s|\\|$)/g)) out.add(m[2]!);
    return [...out].sort();
  };
  it('tokens reachable from _lc_refuse call sites == CCD_REFUSAL_TOKENS, in both directions', () => {
    const sites = callSiteTokens();
    expect(sites.length, 'the scan found the call sites').toBeGreaterThan(15);
    expect.soft(sites.filter((t) => !(CCD_REFUSAL_TOKENS as readonly string[]).includes(t)), 'a token ccd can print that the union lacks').toEqual([]);
    expect.soft((CCD_REFUSAL_TOKENS as readonly string[]).filter((t) => !sites.includes(t)), 'a union member no call site prints').toEqual([]);
  });
  it('every call site names its token as a literal — none is computed', () => {
    const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const all = [...code.matchAll(/(?<![\w_])_lc_refuse\s+[a-z]+\s/g)].length;
    const literal = [...code.matchAll(/(?<![\w_])_lc_refuse\s+[a-z]+\s+("[^"]*"|\S+)\s+[a-z][a-z0-9-]*(?=\s|\\|$)/g)].length;
    expect(literal).toBe(all);
  });
  it('the reap-lock word is spelled once in TypeScript outside tests', () => {
    const roots = [path.resolve(__dirname, '../src'), path.resolve(__dirname, '../../shared'), path.resolve(__dirname, '../../agent/src'),
      path.resolve(__dirname, '../../pwa/src')];
    const hits: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        if (n === 'node_modules' || n === 'dist') continue;
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx|mjs)$/.test(n)) continue;
        readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
          // `shared/api.ts` declares the journal vocabulary (`LcRefusalToken` and its word table) in literals;
          // `CCD_LOCK_UNOPENABLE` is tied to it by `satisfies`, so the vocabulary is the one place it may repeat.
          if (p.endsWith(path.join('shared', 'api.ts'))) return;
          if (!/^\s*(\/\/|\*|\/\*)/.test(l) && /'lock-unopenable'/.test(l)) hits.push(`${path.relative(process.cwd(), p)}:${i + 1}`);
        });
      }
    };
    roots.forEach(walk);
    expect(hits).toHaveLength(1);
    expect(CCD_LOCK_UNOPENABLE).toBe('lock-unopenable');
  });
});

describe('ccd itself, in a fixture HOME', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-ccd-refusal-v1-'); });
  afterEach(() => { h.cleanup(); });

  /** As `ccd-forget.test.ts` runs a refused verb: `die` exits non-zero, so the harness throws and carries stderr. */
  const DEAD = `_ws_unsupervise() { :; }; tmux() { return 1; }; _session_verdict() { echo gone; };`;
  const stderrOf = (snippet: string): string => {
    try { h.sh(`${DEAD} ${snippet}`); return ''; } catch (e) { return String((e as { stderr?: Buffer }).stderr ?? ''); }
  };

  it('_lc_refuse prints the anchored line BEFORE the die, on stderr', () => {
    const err = stderrOf('cmd_forget nope-never');
    const lines = err.split('\n').filter(Boolean);
    expect(lines).toContain('ccd-refusal: forget no-such-session');
    expect(lines.indexOf('ccd-refusal: forget no-such-session')).toBeLessThan(lines.findIndex((l) => l.includes('no such session')));
    expect(readCcdRefusal(err)).toEqual({ act: 'forget', token: 'no-such-session' });
  });
  it('advertises refusal-v1 on the capability channel', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain(CCD_REFUSAL_CAP);
  });
});
