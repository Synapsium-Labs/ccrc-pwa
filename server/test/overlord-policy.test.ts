// The `OverlordPolicy` port, its default adapter and the door's one ask (Overlord spec §3.6; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` Task B4, question 7, review 2271 F15). The ask's cases live
// once in `sim/mayActW2Sets.ts#askPolicyCases`, which the mutation floors also run against each mutant. Held here: the default
// allows every allow the decider can mint; the port takes only a minted allow, by its type; a throw refuses.
import { describe, expect, it } from 'vitest';
import * as ask from '../src/coord/overlordPolicyAsk.js';
import { allowAllPolicy } from '../src/coord/overlordPolicyDefault.js';
import { mayActW2 } from '../src/coord/overlordMayActW2.js';
import type { OverlordPolicy, PolicyQuestion } from '../src/coord/overlordPolicy.js';
import { OVERLORD_ACT_KIND_LIST } from '../../shared/overlord.js';
import { W2_BASE, W2_TARGET, askPolicyCases } from './sim/mayActW2Sets.js';

const ACTOR = { kind: 'session', subject: 'lane-a', issuer: 'attribution', strength: 'attributed' } as unknown as PolicyQuestion['actor'];

describe('askPolicy: the door reads the port fail closed', () => {
  for (const [name, run] of Object.entries(askPolicyCases(ask))) it(name, run);
});

describe('allowAllPolicy, named for what it is', () => {
  it('passes every allow the W2 door mints, at every cell, for every kind', () => {
    let minted = 0;
    for (const act of OVERLORD_ACT_KIND_LIST) for (const cell of ['allow', 'proposal', 'armed', 'by-grant'] as const) {
      const a = mayActW2(act, null, W2_TARGET, { ...W2_BASE, cell }, 1);
      if (a.kind !== 'allowed') continue;
      minted++;
      expect(allowAllPolicy.check({ allow: a.allow, verbClass: 'operate', actor: ACTOR }), act).toEqual({ ok: true });
      expect(ask.askPolicy(allowAllPolicy, { allow: a.allow, verbClass: 'view', actor: ACTOR }), act).toEqual({ ok: true });
    }
    expect(minted).toBeGreaterThan(20);
  });
});

describe('the port takes a minted allow only', () => {
  it('a plain object, even one with every field, does not compile as the question\'s allow', () => {
    const a = mayActW2('read', null, W2_TARGET, W2_BASE, 1);
    if (a.kind !== 'allowed') throw new Error('not minted');
    const p: OverlordPolicy = allowAllPolicy;
    const fields = { word: 'allow', mode: 'act', authority: { kind: 'none', id: null }, act: 'read', effect: null,
      target: { programme: 7, incarnation: 1 }, naturalKey: 'key-1', cell: 'allow', generation: 3 } as const;
    // @ts-expect-error a literal with every field lacks the brand: only the decider mints a MayActAllow
    p.check({ allow: fields, verbClass: 'operate', actor: ACTOR });
    // A spread copy keeps the brand's type but not its registration; the decider's suite holds that at run time.
    expect(p.check({ allow: a.allow, verbClass: 'operate', actor: ACTOR })).toEqual({ ok: true });
  });
});
