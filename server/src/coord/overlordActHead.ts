// Whether today's act journal head is signed (Overlord spec §7.6 H27; plan `docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-act-journal.md` Task A3, question 8). Ring L1, context C5: pure. The head-signing lane (L4) reads the isolation word and the
// approvals kill switch, asks this, and either signs through the signer's typed method or records the head unsigned with the
// word this answers. The head's table and its one writer are the store's (`overlordActHeadStore.ts`, L3).
//
// UNSIGNED WHERE THE KEY IS REACHABLE (slug `act-head-unsigned-where-the-key-is-reachable`). On `shared-user` a session can read
// the server's key, so a signature would vouch for nothing; an unmeasured isolation word acts as `shared-user` (the isolation
// piece's rule) and is named apart; and while the operator's `approvals-disabled` switch stands the key signs nothing at all.
// The switch is asked first: it is the operator's explicit word that the key is not to sign, whatever the isolation.
import type { IsolationRead } from '../../../shared/isolation.js';

const ACT_HEAD_UNSIGNED_MAP = {
  'approvals-disabled': "the operator's approvals-disabled switch stands, so the server's key signs nothing",
  'shared-user': "the sessions run as the server's user, so the key is within their reach and a signature would vouch for nothing",
  'isolation-unmeasured': "the isolation word could not be measured, so it acts as shared-user and the head is not signed",
} as const;
export type ActHeadUnsigned = keyof typeof ACT_HEAD_UNSIGNED_MAP;
export const ACT_HEAD_UNSIGNED_WORDS = Object.keys(ACT_HEAD_UNSIGNED_MAP) as ActHeadUnsigned[];

export type ActHeadSignVerdict = { readonly sign: true } | { readonly sign: false; readonly unsigned: ActHeadUnsigned };

/** Sign on `separate-user` and `separate-host`; otherwise record the head unsigned with the word that says why. */
export function actHeadSignVerdict(f: { readonly isolation: IsolationRead; readonly approvalsDisabled: boolean }): ActHeadSignVerdict {
  if (f.approvalsDisabled) return { sign: false, unsigned: 'approvals-disabled' };
  if (f.isolation.kind !== 'measured') return { sign: false, unsigned: 'isolation-unmeasured' };
  if (f.isolation.word === 'shared-user') return { sign: false, unsigned: 'shared-user' };
  return { sign: true };
}

/** Every word this file quotes that the coordination directory's kebab census meets. */
export const isActHeadKebab = (word: string): boolean => Object.hasOwn(ACT_HEAD_UNSIGNED_MAP, word);
