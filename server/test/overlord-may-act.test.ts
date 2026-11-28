// `overlordMayAct`, the one decider that answers whether an Overlord act may pass (Overlord W2, the act catalogue B; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` §6, Tasks B2 and B3). The cases live once in
// `sim/mayActSets.ts`, which holds an independent oracle written from the rule list (never from the decider's helpers) and
// which the mutation floors run against each textual mutant. This file runs them against the real module:
//   - `mayActCases`: every catalogue kind x effect x cell x fact set against the oracle; 2000 drawn cases over every branch
//     (grants, command, request, entry, answer facts, isolation, strength, ceiling, cell and arming); monotonicity (Table 11.7b),
//     and the named cases (carriers, the request, entry, command and grant paths, the cell, the allow's binding, frozen and
//     spent once, and the best path across covers);
//   - `grantCoversCases`: C26's grant test, check by check, unread fact by unread fact;
//   - the compile-time cases: an answer with no `evidence` does not compile, and the grant condition's fields are keyed by the
//     condition map both ways (a kind missing from the fields, and an extra one, each fail; review 4224 F5).
import { describe, expect, it } from 'vitest';
import * as mayAct from '../src/coord/overlordMayAct.js';
import type { GrantConditionFieldShape, GrantConditionKind, KeyedExactly, MayActAnswer } from '../src/coord/overlordMayAct.js';
import { grantCoversCases, mayActCases } from './sim/mayActSets.js';

// The fields as they stand compile against the map's kinds.
const exactFields: KeyedExactly<GrantConditionFieldShape, GrantConditionKind> | null = null;
void exactFields;
// @ts-expect-error A kind of the map with no fields fails the constraint: a new condition kind cannot ship without its fields.
const missingKind: KeyedExactly<Omit<GrantConditionFieldShape, 'max-per-day'>, GrantConditionKind> | null = null;
void missingKind;
// Fields for a kind the map lacks make the fields `never`, so even a value holding every key cannot be written.
type ExtraShape = GrantConditionFieldShape & { 'suspend-on-holiday': Record<never, never> };
// @ts-expect-error The keying is exact both ways: an extra kind's fields read as `never`.
const extraKind: KeyedExactly<ExtraShape, GrantConditionKind> = {} as ExtraShape;
void extraKind;

describe('overlordMayAct', () => {
  for (const [name, fn] of Object.entries(mayActCases(mayAct))) it(name, fn);
});

describe('grantCovers', () => {
  for (const [name, fn] of Object.entries(grantCoversCases(mayAct))) it(name, fn);
});

describe('the answer type', () => {
  it('a MayActAnswer literal without evidence does not compile', () => {
    // @ts-expect-error `evidence` is required on every arm of `MayActAnswer` (the coordinator's item 5: every answer carries its evidence).
    const noEvidence: MayActAnswer = { kind: 'refused', word: 'defer' };
    expect(noEvidence.kind).toBe('refused');
  });
});
