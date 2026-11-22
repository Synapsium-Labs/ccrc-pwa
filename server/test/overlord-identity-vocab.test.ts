// Overlord W1, gates A (plan w1-gates.md Task 1; spec §3.6 H3, Table 3.6b, §7.4, Table 11.2): the identity vocabulary's
// words, written out here so a list that drifts from its map, or a word added without this file, is a red suite; and
// `readActorColumns`' cases, which `sim/gateSets.ts` holds once and the every-run mutation floor runs against each mutant.
import { describe, it, expect } from 'vitest';
import * as identity from '../../shared/overlord-identity.js';
import { readActorColumnsCases } from './sim/gateSets.js';

describe('the identity vocabulary', () => {
  const pairs: Array<[string, object, readonly string[], string[]]> = [
    ['CALLER_STRENGTH', identity.CALLER_STRENGTH_MAP, identity.CALLER_STRENGTHS, ['attributed', 'workload', 'operator']],
    ['ACTOR_KIND', identity.ACTOR_KIND_MAP, identity.ACTOR_KINDS, ['operator', 'session', 'server']],
    ['ACTOR_ISSUER', identity.ACTOR_ISSUER_MAP, identity.ACTOR_ISSUERS, ['account-gate', 'session-cookie', 'attribution', 'server']],
    ['VERB_CLASS', identity.VERB_CLASS_MAP, identity.VERB_CLASSES, ['view', 'operate', 'admin']],
    ['DOOR_GROUP', identity.DOOR_GROUP_MAP, identity.DOOR_GROUPS, ['overlord', 'operator', 'coordinator-facing', 'hook', 'server-body']],
  ];
  for (const [name, map, list, written] of pairs) {
    it(`${name}: the map's keys are its list, and the list is the words written here`, () => {
      expect(Object.keys(map)).toEqual([...list]);
      expect([...list]).toEqual(written);
    });
  }
  it('the subject bound is 200', () => { expect(identity.ACTOR_SUBJECT_MAX).toBe(200); });
});

describe('readActorColumns', () => {
  for (const [name, fn] of Object.entries(readActorColumnsCases(identity))) it(name, fn);
});
