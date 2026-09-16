// Routing spec 2026-09-14 §3 "Escalation"/"Demotion" — the two pure ladders
// over one fixture table (`fixtures/routing-ladder.ts`), plus the parity pin
// that keeps ccd's bash `ROUTE_EFFORT_STOPS` a mirror of `EFFORT_LADDER`
// rather than a hand-copied second list.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFORT_LADDER, escalate, demote } from '../../shared/routing-ladder.js';
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
  it('imports only ./models.js and ./api.js, never node:*', () => {
    const src = readFileSync(path.join(root, 'shared/routing-ladder.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
    const specifiers = [...src.matchAll(/from\s+'([^']+)';/g)].map((m) => m[1]!);
    expect(specifiers.length, 'no import specifiers found — the scan is over nothing').toBeGreaterThan(0);
    for (const s of specifiers) {
      expect(s, `shared/routing-ladder.ts imports a node builtin — the PWA bundles this file`).not.toMatch(/^node:/);
    }
    expect(new Set(specifiers)).toEqual(new Set(['./models.js', './api.js']));
  });
});
