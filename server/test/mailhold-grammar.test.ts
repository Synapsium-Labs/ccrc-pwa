// `shared/mailHold.ts`, the `mailhold` route field's one grammar owner (mid-turn mail plan 2026-11-19, Task 3.1), over the
// corpus `fixtures/mailhold-grammar.json`, which `mailhold-parity.test.ts` also drives through ccd's bash reader.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAILHOLD_LEASE_S, MAILHOLD_MAX_PAIRS, MAILHOLD_REACH_S, MAILHOLD_RENEW_UNDER_S, MAILHOLD_RE_BODY, MAILHOLD_ROLES,
  mailHoldLive, parseMailHold, renderMailHold, type MailHoldPair,
} from '../../shared/mailHold.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface MailHoldCorpusRow {
  readonly name: string;
  readonly value: string;
  readonly ok: boolean;
  readonly until?: number;
  readonly pairs?: readonly (readonly [string, number])[];
}
const MAILHOLD_CORPUS: readonly MailHoldCorpusRow[] =
  (JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'mailhold-grammar.json'), 'utf8')) as { rows: MailHoldCorpusRow[] }).rows;

describe('the corpus', () => {
  it('is not vacuous: both answers, unique names', () => {
    expect(MAILHOLD_CORPUS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(MAILHOLD_CORPUS.map((r) => r.name)).size).toBe(MAILHOLD_CORPUS.length);
    expect(MAILHOLD_CORPUS.filter((r) => r.ok).length).toBeGreaterThanOrEqual(5);
    expect(MAILHOLD_CORPUS.filter((r) => !r.ok).length).toBeGreaterThanOrEqual(25);
  });
  it('holds no NUL, which argv cannot carry', () => {
    for (const r of MAILHOLD_CORPUS) expect(r.value.includes('\0'), r.name).toBe(false);
  });
});

describe('parseMailHold over the corpus', () => {
  it.each(MAILHOLD_CORPUS.map((r) => [r.name, r] as const))('%s', (_n, r) => {
    const got = parseMailHold(r.value);
    if (!r.ok) { expect(got).toEqual({ ok: false }); return; }
    expect(got).toEqual({
      ok: true,
      hold: { until: r.until, pairs: r.pairs!.map(([role, delivery]) => ({ role, delivery })) },
    });
  });
});

describe('renderMailHold', () => {
  const p = (role: 'coordinator' | 'overlord', delivery: number): MailHoldPair => ({ role, delivery });

  it('spells one pair and round-trips every accepted corpus row', () => {
    expect(renderMailHold(1_795_000_000, [p('coordinator', 42)])).toBe('1795000000:coordinator.42');
    for (const r of MAILHOLD_CORPUS.filter((x) => x.ok)) {
      const parsed = parseMailHold(r.value);
      expect(parsed.ok, r.name).toBe(true);
      if (parsed.ok) expect(parseMailHold(renderMailHold(parsed.hold.until, parsed.hold.pairs)), r.name).toEqual(parsed);
    }
  });

  it('keeps the eight lowest delivery ids, ascending, from any larger set', () => {
    const many = [12, 3, 40, 7, 1, 99, 15, 8, 2, 60, 5].map((d, i) => p(i % 2 === 0 ? 'coordinator' : 'overlord', d));
    const out = renderMailHold(1_795_000_000, many);
    const parsed = parseMailHold(out);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.hold.pairs.map((x) => x.delivery)).toEqual([1, 2, 3, 5, 7, 8, 12, 15]);
    expect(parsed.hold.pairs).toHaveLength(MAILHOLD_MAX_PAIRS);
    // each kept id keeps its own role
    for (const kept of parsed.hold.pairs) expect(kept.role).toBe(many.find((m) => m.delivery === kept.delivery)!.role);
  });

  it('sorts a small set ascending and keeps a repeated id once', () => {
    expect(renderMailHold(1_795_000_000, [p('overlord', 9), p('coordinator', 3), p('overlord', 9)]))
      .toBe('1795000000:coordinator.3,overlord.9');
  });

  it('nine distinct pairs render as eight, never as a value the grammar refuses', () => {
    const nine = Array.from({ length: 9 }, (_, i) => p('coordinator', i + 1));
    expect(parseMailHold(renderMailHold(1_795_000_000, nine)).ok).toBe(true);
  });

  it('throws on what the grammar cannot spell', () => {
    expect(() => renderMailHold(1_795_000_000, [])).toThrow(RangeError);
    expect(() => renderMailHold(0, [p('coordinator', 1)])).toThrow(RangeError);
    expect(() => renderMailHold(100_000_000_000, [p('coordinator', 1)])).toThrow(RangeError);
    expect(() => renderMailHold(1.5, [p('coordinator', 1)])).toThrow(RangeError);
    expect(() => renderMailHold(1_795_000_000, [p('coordinator', 0)])).toThrow(RangeError);
    expect(() => renderMailHold(1_795_000_000, [p('coordinator', 10_000_000_000)])).toThrow(RangeError);
    expect(() => renderMailHold(1_795_000_000, [{ role: 'worker' as 'coordinator', delivery: 1 }])).toThrow(RangeError);
  });
});

describe('the bounds', () => {
  it('are the spec\'s numbers', () => {
    expect(MAILHOLD_LEASE_S).toBe(300);
    expect(MAILHOLD_REACH_S).toBe(360);
    expect(MAILHOLD_RENEW_UNDER_S).toBe(120);
    expect(MAILHOLD_MAX_PAIRS).toBe(8);
    expect([...MAILHOLD_ROLES]).toEqual(['coordinator', 'overlord']);
  });

  it('mailHoldLive is now < until <= now + 360, both edges', () => {
    const now = 1_795_000_000;
    expect(mailHoldLive(now, now)).toBe(false);
    expect(mailHoldLive(now + 1, now)).toBe(true);
    expect(mailHoldLive(now + MAILHOLD_LEASE_S, now)).toBe(true);
    expect(mailHoldLive(now + 360, now)).toBe(true);
    expect(mailHoldLive(now + 361, now)).toBe(false);
    expect(mailHoldLive(now - 1, now)).toBe(false);
  });
});

describe('the regular expression the bash readers copy', () => {
  it('spells its digit classes out, never a range', () => {
    expect(MAILHOLD_RE_BODY).not.toMatch(/0-9|1-9/);
    expect(MAILHOLD_RE_BODY.startsWith('^') && MAILHOLD_RE_BODY.endsWith('$')).toBe(true);
  });
  it('is the regular expression parseMailHold judges by', () => {
    const re = new RegExp(MAILHOLD_RE_BODY);
    for (const r of MAILHOLD_CORPUS) expect(re.test(r.value), r.name).toBe(r.ok);
  });
});
