// The gates piece's oracles and mutant sets (Overlord W1, `docs/superpowers/plans/2026-11-14-overlord-w1/w1-gates.md`, Task 1
// and, in PR B, the gate order's deciders). Each reader's cases are written ONCE here, as suite cases over a module:
// `overlord-identity-vocab.test.ts` runs them against the real module, and `mutation-floors.test.ts` runs them against each
// named mutant (D-8217's every-run floors, `GATE_MUTANT_SETS`). The expected words are written out, not read from the code
// the cases judge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const IDENTITY_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/overlord-identity.ts');
export const READ_ACTOR_COLUMNS_KEY = 'shared/overlord-identity.ts#readActorColumns';

export type OverlordIdentityModule = typeof import('../../../shared/overlord-identity.js');

const KINDS = ['operator', 'session', 'server'];
const ISSUERS = ['account-gate', 'session-cookie', 'attribution', 'server'];
const STRENGTHS = ['attributed', 'workload', 'operator'];
const unreadable = (column: string) => ({ kind: 'unreadable', column });

/** `readActorColumns`' cases: the good row, each column's bad values, the order of the answer, the subject's bounds. */
export function readActorColumnsCases(m: OverlordIdentityModule): Record<string, SuiteCase> {
  const read = (s: unknown, k: unknown, i: unknown, st: unknown) => m.readActorColumns(s, k, i, st);
  return {
    'every kind, issuer and strength word reads, and the actor carries the columns as given': () => {
      for (const k of KINDS) for (const i of ISSUERS) for (const st of STRENGTHS) {
        expect(read('device:lane-a', k, i, st), `${k} ${i} ${st}`).toEqual({ kind: 'read', actor: { kind: k, subject: 'device:lane-a', issuer: i, strength: st } });
      }
    },
    'a subject that is not a string, or is empty, is unreadable': () => {
      for (const s of [undefined, null, 42, true, ['a'], { a: 1 }, '']) expect(read(s, 'session', 'attribution', 'attributed'), String(s)).toEqual(unreadable('subject'));
    },
    'a subject of exactly 200 characters reads and one of 201 does not': () => {
      expect(read('a'.repeat(200), 'session', 'attribution', 'attributed').kind).toBe('read');
      expect(read('a'.repeat(201), 'session', 'attribution', 'attributed')).toEqual(unreadable('subject'));
    },
    'a subject with a control character is unreadable, wherever it sits': () => {
      for (const s of ['a\nb', '\u0000a', 'a\u007f', 'a\tb', '\u009fa', 'a\rb']) expect(read(s, 'session', 'attribution', 'attributed'), JSON.stringify(s)).toEqual(unreadable('subject'));
    },
    'a kind outside the words, an inherited name or a non-string is unreadable': () => {
      for (const k of ['', 'Operator', 'admin', 'constructor', 'toString', '__proto__', null, undefined, 1, {}, ['operator']]) expect(read('s', k, 'server', 'operator'), String(k)).toEqual(unreadable('kind'));
    },
    'an issuer outside the words, an inherited name or a non-string is unreadable': () => {
      for (const i of ['', 'Server', 'cookie', 'constructor', 'hasOwnProperty', null, undefined, 1, {}, ['server']]) expect(read('s', 'server', i, 'operator'), String(i)).toEqual(unreadable('issuer'));
    },
    'a strength outside the words, an inherited name or a non-string is unreadable': () => {
      for (const st of ['', 'Operator', 'strong', 'constructor', 'valueOf', null, undefined, 1, {}, ['operator']]) expect(read('s', 'server', 'server', st), String(st)).toEqual(unreadable('strength'));
    },
    'the first unreadable column is named, in the order subject, kind, issuer, strength': () => {
      expect(read('', 'x', 'x', 'x')).toEqual(unreadable('subject'));
      expect(read('s', 'x', 'x', 'x')).toEqual(unreadable('kind'));
      expect(read('s', 'session', 'x', 'x')).toEqual(unreadable('issuer'));
      expect(read('s', 'session', 'attribution', 'x')).toEqual(unreadable('strength'));
      expect(read('s', 'session', 'x', 'attributed')).toEqual(unreadable('issuer'));
      expect(read('s', 'x', 'attribution', 'attributed')).toEqual(unreadable('kind'));
    },
  };
}

const suite = (m: OverlordIdentityModule): Record<string, SuiteCase> => readActorColumnsCases(m);

export const READ_ACTOR_COLUMNS_SET: MutantSet<OverlordIdentityModule> = {
  modulePath: IDENTITY_TS,
  suite,
  mutants: [
    // The plan's red check: the strength column is not read.
    { id: 'G-1', old: "  if (!isWord(CALLER_STRENGTH_MAP, strength)) return { kind: 'unreadable', column: 'strength' };\n", new: '' },
    { id: 'G-2', old: "  if (!isWord(ACTOR_ISSUER_MAP, issuer)) return { kind: 'unreadable', column: 'issuer' };\n", new: '' },
    { id: 'G-3', old: "  if (!isWord(ACTOR_KIND_MAP, kind)) return { kind: 'unreadable', column: 'kind' };\n", new: '' },
    { id: 'G-4', old: "typeof subject !== 'string' || subject === '' ||", new: "typeof subject !== 'string' ||" },
    { id: 'G-5', old: 'subject.length > ACTOR_SUBJECT_MAX', new: 'subject.length >= ACTOR_SUBJECT_MAX' },
    { id: 'G-6', old: 'subject.length > ACTOR_SUBJECT_MAX', new: 'subject.length > ACTOR_SUBJECT_MAX + 1' },
    { id: 'G-7', old: ' || /\\p{Cc}/u.test(subject)', new: '' },
    { id: 'G-8', old: "typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v)", new: "typeof v === 'string' && v in map" },
    { id: 'G-9', old: "typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v)", new: 'Object.prototype.hasOwnProperty.call(map, v as string)' },
    { id: 'G-10', old: "return { kind: 'unreadable', column: 'kind' };", new: "return { kind: 'unreadable', column: 'subject' };" },
    { id: 'G-11', old: "return { kind: 'read', actor: { kind, subject, issuer, strength } };", new: "return { kind: 'read', actor: { kind, subject, issuer: kind as never, strength } };" },
  ],
};

export const GATE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [READ_ACTOR_COLUMNS_KEY]: READ_ACTOR_COLUMNS_SET as MutantSet<never>,
};
