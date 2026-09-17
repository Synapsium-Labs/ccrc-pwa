// Routing spec 2026-09-14 §3 "Escalation"/"Demotion" — the two pure ladders
// over one fixture table (`fixtures/routing-ladder.ts`), plus the parity pin
// that keeps ccd's bash `ROUTE_EFFORT_STOPS` a mirror of `EFFORT_LADDER`
// rather than a hand-copied second list.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAILURE_KINDS } from '../../shared/api.js';
import { CLASSES } from '../../shared/models.js';
import { EFFORT_LADDER, escalate, demote, classRungEffortReset } from '../../shared/routing-ladder.js';
import { ROUTING_LADDER_CASES } from './fixtures/routing-ladder.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('the routing ladder — one fixture table over escalate() and demote()', () => {
  for (const c of ROUTING_LADDER_CASES) {
    it(c.name, () => {
      const got = c.kind === 'demote-effort' ? demote(c.current, 'effort')
        : c.kind === 'demote-class' ? demote(c.current, 'class')
        : escalate(c.kind, c.current, c.scope ?? 'main', c.prior ?? 0, c.lastDemotion ?? null);
      expect(got).toEqual(c.want);
    });
  }

  it('covers every FailureKind at least once — the table measures the vocabulary, not just three hand-picked words', () => {
    const kindsInTable = new Set(ROUTING_LADDER_CASES.map((c) => c.kind));
    for (const kind of FAILURE_KINDS) {
      expect(kindsInTable.has(kind), `no fixture row exercises FailureKind '${kind}'`).toBe(true);
    }
  });
});

describe("classRungEffortReset — §3's \"a class rung resets effort to the new class's matrix row\"", () => {
  it('is the Anthropic default for every class with a matrix row, and auto onto haiku', () => {
    // Read off CLASSES, so a new class added to the ladder shows up here as a
    // row that must be decided rather than silently defaulting.
    expect(CLASSES.map((c) => classRungEffortReset(c))).toEqual(['auto', 'high', 'high', 'high']);
  });

  it("ccd's own class/effort pair check exempts exactly the value this function resets haiku to", () => {
    // NOT a restatement of the function: the assertion's expected value is
    // read out of the REAL binary's guard line, so returning 'high' for haiku
    // (the value every other class gets) reds this — and that value is the
    // one the door would then put in an argv `cmd_route` dies on.
    const src = readFileSync(path.join(root, 'ccd/ccd'), 'utf8');
    // The GUARD line, not the paragraph above it that explains the guard —
    // anchored on the `die` so a comment can never satisfy this pin.
    const guard = src.split('\n').find((l) => l.includes('die "class haiku takes no effort level'));
    expect(guard, "ccd/ccd's haiku/effort pair check is gone").toBeDefined();
    expect(guard).toContain(`"$eff" != ${classRungEffortReset('haiku')}`);
  });
});

describe('EFFORT_LADDER — ccd/ccd\'s ROUTE_EFFORT_STOPS is its bash mirror', () => {
  it('is the five slider stops, in slider order', () => {
    expect(EFFORT_LADDER).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('ccd/ccd names ROUTE_EFFORT_STOPS exactly once, and its words equal EFFORT_LADDER in order', () => {
    const src = readFileSync(path.join(root, 'ccd/ccd'), 'utf8');
    const matches = [...src.matchAll(/^ROUTE_EFFORT_STOPS="([^"]*)"/gm)];
    expect(matches, 'ccd/ccd must declare ROUTE_EFFORT_STOPS="..." exactly once').toHaveLength(1);
    const words = matches[0]![1]!.split(/\s+/).filter((w) => w !== '');
    expect(words).toEqual([...EFFORT_LADDER]);
  });
});

describe('shared/routing-ladder.ts is L0 — imports nothing but its two shared/ siblings', () => {
  const code = () => readFileSync(path.join(root, 'shared/routing-ladder.ts'), 'utf8');

  it('imports only ./models.js and ./api.js, never node:*', () => {
    const src = code()
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
    const specifiers = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    expect(specifiers.length, 'no import specifiers found — the scan is over nothing').toBeGreaterThan(0);
    for (const s of specifiers) {
      expect(s, `shared/routing-ladder.ts imports a node builtin — the PWA bundles this file`).not.toMatch(/^node:/);
    }
    expect(new Set(specifiers)).toEqual(new Set(['./models.js', './api.js']));
  });

  it('never names a node: specifier anywhere in the source, quoting style notwithstanding', () => {
    // Whole-source belt (the same shape as pool-rule-core.test.ts:175's poolrule.ts
    // check) — catches a double-quoted `import ... from "node:fs";` even if the
    // specifier-scan above were ever narrowed again.
    expect(code(), 'shared/routing-ladder.ts imports a node builtin — the PWA bundles this file')
      .not.toMatch(/from\s+['"]node:/);
  });
});
