// Overlord W2, act journal plan Task A3 (PR A; the floors rule is D-8217's): the mutant sets of the signed head's two deciders,
// `actHeadSignVerdict` (L1) and `shared/actJournalHead.ts#headExtends` (L0), each run against suite cases over a module. They
// ride the act journal's set map (`overlordActJournalSets.ts`), registered in mutation-floors.test.ts, with a floor each in
// mutation-floors.json. The expected words are written out, never read from the code the cases judge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
type Verdict = typeof import('../../src/coord/overlordActHead.js');
type Head = typeof import('../../../shared/actJournalHead.js');

export const ACT_HEAD_SIGN_VERDICT_KEY = 'server/src/coord/overlordActHead.ts#actHeadSignVerdict';
export const HEAD_EXTENDS_KEY = 'shared/actJournalHead.ts#headExtends';

const D = (c: string): string => c.repeat(64);

export function actHeadSignVerdictCases(m: Pick<Verdict, 'actHeadSignVerdict'>): Record<string, SuiteCase> {
  const v = (isolation: unknown, approvalsDisabled = false): unknown => m.actHeadSignVerdict({ isolation: isolation as never, approvalsDisabled });
  return {
    'separate-user and separate-host sign': () => {
      expect(v({ kind: 'measured', word: 'separate-user', cause: 'other-user' })).toEqual({ sign: true });
      expect(v({ kind: 'measured', word: 'separate-host', cause: 'other-host' })).toEqual({ sign: true });
    },
    'shared-user records the head unsigned, with its word': () => {
      expect(v({ kind: 'measured', word: 'shared-user', cause: 'same-user' })).toEqual({ sign: false, unsigned: 'shared-user' });
    },
    'an unmeasured word records it unsigned, named apart from shared-user': () => {
      expect(v({ kind: 'unmeasured', why: 'link-down' })).toEqual({ sign: false, unsigned: 'isolation-unmeasured' });
    },
    'approvals-disabled records it unsigned, whatever the isolation': () => {
      expect(v({ kind: 'measured', word: 'separate-host', cause: 'other-host' }, true)).toEqual({ sign: false, unsigned: 'approvals-disabled' });
      expect(v({ kind: 'unmeasured', why: 'no-agent' }, true)).toEqual({ sign: false, unsigned: 'approvals-disabled' });
      expect(v({ kind: 'measured', word: 'shared-user', cause: 'same-user' }, true)).toEqual({ sign: false, unsigned: 'approvals-disabled' });
    },
  };
}

const VERDICT_SET: MutantSet<Verdict> = {
  modulePath: path.join(ROOT, 'server/src/coord/overlordActHead.ts'),
  mutants: [
    { id: 'V1 the switch ignored', old: "if (f.approvalsDisabled) return { sign: false, unsigned: 'approvals-disabled' };", new: '' },
    { id: 'V2 unmeasured signs', old: "if (f.isolation.kind !== 'measured') return { sign: false, unsigned: 'isolation-unmeasured' };", new: "if (f.isolation.kind !== 'measured') return { sign: true };" },
    { id: 'V3 unmeasured is shared-user', old: "unsigned: 'isolation-unmeasured' };", new: "unsigned: 'shared-user' };" },
    { id: 'V4 shared-user signs', old: "if (f.isolation.word === 'shared-user') return { sign: false, unsigned: 'shared-user' };", new: '' },
    { id: 'V5 only separate-host signs', old: "if (f.isolation.word === 'shared-user')", new: "if (f.isolation.word !== 'separate-host')" },
  ],
  suite: (mod) => actHeadSignVerdictCases(mod),
};

export function headExtendsCases(m: Pick<Head, 'headExtends'>): Record<string, SuiteCase> {
  const kept = { sequence: 5, digest: D('a') };
  return {
    'nothing kept is first': () => { expect(m.headExtends(null, { sequence: 9, digest: D('c') }, 'absent')).toBe('first'); },
    'a later head whose journal still holds the kept record as it was extends it': () => {
      expect(m.headExtends(kept, { sequence: 9, digest: D('c') }, D('a'))).toBe('extends');
    },
    'the same head extends itself': () => { expect(m.headExtends(kept, kept, D('a'))).toBe('extends'); },
    'an offered head behind the kept one does not extend it': () => {
      expect(m.headExtends(kept, { sequence: 4, digest: D('a') }, D('a'))).toBe('does-not-extend');
    },
    'the same sequence with another digest does not extend it': () => {
      expect(m.headExtends(kept, { sequence: 5, digest: D('b') }, D('a'))).toBe('does-not-extend');
    },
    'a kept record the journal no longer holds, or holds with another digest, does not extend it': () => {
      expect(m.headExtends(kept, { sequence: 9, digest: D('c') }, 'absent')).toBe('does-not-extend');
      expect(m.headExtends(kept, { sequence: 9, digest: D('c') }, D('b'))).toBe('does-not-extend');
    },
    'an unreadable record, or an input out of shape, is unmeasured, never a verdict either way': () => {
      expect(m.headExtends(kept, { sequence: 9, digest: D('c') }, 'unmeasured')).toBe('unmeasured');
      expect(m.headExtends(kept, { sequence: 9, digest: D('c') }, 'not hex')).toBe('unmeasured');
      expect(m.headExtends(kept, { sequence: 0, digest: D('c') }, D('a'))).toBe('unmeasured');
      expect(m.headExtends({ sequence: 5, digest: 'A'.repeat(64) }, { sequence: 9, digest: D('c') }, D('a'))).toBe('unmeasured');
      expect(m.headExtends(null, { sequence: 1.5, digest: D('c') }, 'absent')).toBe('unmeasured');
    },
  };
}

const EXTENDS_SET: MutantSet<Head> = {
  modulePath: path.join(ROOT, 'shared/actJournalHead.ts'),
  mutants: [
    { id: 'X1 nothing kept extends', old: "if (kept === null) return isPosition(offered) ? 'first' : 'unmeasured';", new: "if (kept === null) return 'extends';" },
    { id: 'X2 behind extends', old: "if (offered.sequence < kept.sequence) return 'does-not-extend';", new: '' },
    { id: 'X3 same sequence, any digest', old: "if (offered.sequence === kept.sequence && offered.digest !== kept.digest) return 'does-not-extend';", new: '' },
    { id: 'X4 absent extends', old: "if (digestAtKept === 'absent' || digestAtKept !== kept.digest)", new: "if (digestAtKept !== 'absent' && digestAtKept !== kept.digest)" },
    { id: 'X5 any digest at the kept sequence', old: " || digestAtKept !== kept.digest) return 'does-not-extend';", new: ") return 'does-not-extend';" },
    { id: 'X6 unmeasured is a verdict', old: "if (digestAtKept !== 'absent' && !HEX64_RE.test(digestAtKept)) return 'unmeasured';", new: '' },
    { id: 'X7 shape unchecked', old: "if (!isPosition(kept) || !isPosition(offered)) return 'unmeasured';", new: '' },
    { id: 'X8 first unchecked', old: "return isPosition(offered) ? 'first' : 'unmeasured';", new: "return 'first';" },
    { id: 'X9 behind by one passes', old: 'if (offered.sequence < kept.sequence)', new: 'if (offered.sequence < kept.sequence - 1)' },
  ],
  suite: (mod) => headExtendsCases(mod),
};

export const ACT_HEAD_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [ACT_HEAD_SIGN_VERDICT_KEY]: VERDICT_SET as MutantSet<never>,
  [HEAD_EXTENDS_KEY]: EXTENDS_SET as MutantSet<never>,
};
