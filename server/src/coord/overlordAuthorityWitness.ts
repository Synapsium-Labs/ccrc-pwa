// The Overlord authority epoch and the witness verdict (Overlord spec §7.6; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md` Task 5, questions 7, 8, 10, 11 and 13). Ring L1, context C5:
// the deciders take the facts the exchange gathered and answer a word, with no fs, no clock and no randomness. The tuple's shape and its
// strict parse are L0 (`shared/authorityWitness.ts`); the privacy head is read through the consumer-declared port in
// `privacyJournalHead.ts`.
//
// The epoch is derived from the journals' heads, never stored (`epoch-derived-from-heads`): the last Confirm's `epochAtConfirm` plus the
// records after it, one term per journal, compared term by term (`epoch-compared-term-by-term`). A term that would be NEGATIVE, a journal
// shorter than its last Confirm says it was, cannot be measured as a count of records since the base, so the epoch reads `unmeasured`
// (`negative-term-reads-unmeasured`).
import type { AuthorityView } from './overlordAuthority.js';
import type { PrivacyHeadRead } from './privacyJournalHead.js';
import type { Rung } from '../../../shared/overlord-ladder.js';
import type { AgentHostRelation } from '../../../shared/isolation.js';
import {
  parseWitnessTuple, WITNESS_RUNGS, type WitnessHead, type WitnessRung, type WitnessTold, type WitnessTuple,
} from '../../../shared/authorityWitness.js';

/** Compile-time: the L0 tuple's rung list and the ladder's are the same set of words (L0 may not import the ladder). */
type SameWords<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export type WitnessRungsAgreeWithLadder = SameWords<WitnessRung, Rung>;
const rungsAgree: WitnessRungsAgreeWithLadder = true;
void rungsAgree;

// ── The epoch ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type AuthorityEpoch =
  { total: number; base: number; terms: { authority: number; privacy: number | 'absent' } } | 'unmeasured';

const isCount = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

/** The epoch: the last Confirm's `epochAtConfirm` (0 before one) plus the authority records and privacy records after it. An absent
 *  privacy journal has no term; an unreadable one, or a term below zero, makes the epoch `unmeasured`. */
export function authorityEpoch(view: AuthorityView, authoritySequence: number, privacy: PrivacyHeadRead): AuthorityEpoch {
  const confirm = view.lastConfirm;
  const base = confirm?.epochAtConfirm ?? 0;
  const authority = authoritySequence - (confirm?.sequence ?? 0);
  if (!isCount(authoritySequence) || !isCount(base) || !isCount(authority)) return 'unmeasured';
  let term: number | 'absent';
  switch (privacy.kind) {
    case 'absent': term = 'absent'; break;
    case 'unmeasured': return 'unmeasured';
    case 'empty': term = 0 - (confirm?.privacySequenceAtConfirm ?? 0); break;
    case 'head': term = privacy.sequence - (confirm?.privacySequenceAtConfirm ?? 0); break;
  }
  if (term !== 'absent' && !isCount(term)) return 'unmeasured';
  const total = base + authority + (term === 'absent' ? 0 : term);
  if (!Number.isSafeInteger(total)) return 'unmeasured';
  return { total, base, terms: { authority, privacy: term } };
}

// ── Witnessed counter maxima ─────────────────────────────────────────────────────────────────────────────────────────

/** Even at a million increments per second this takes over a century to reach. Keep more than half of the safe integer
 *  range above any witnessed raise. This is not a parsing limit or a limit on the server's own counters. */
export const WITNESS_RAISE_CEILING = Math.floor(Number.MAX_SAFE_INTEGER / 2);

/** Apply the ceiling to each already parsed counter independently. An over-ceiling counter leaves the maximum unchanged. */
export function raiseWitnessMaximum(held: number, seen: number): number;
export function raiseWitnessMaximum(held: number | null, seen: number): number | null;
export function raiseWitnessMaximum(held: number | null, seen: number): number | null {
  return seen > WITNESS_RAISE_CEILING ? held : Math.max(held ?? 0, seen);
}

// ── The verdict ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a witness lives against the server's volume (question 10); `console` is a signed-in console, which counts. */
export type HostRelation = AgentHostRelation | 'console';

export interface ServerWitnessFacts {
  epoch: AuthorityEpoch;
  boot: string;
  /** The authority journal's head, and the digest of the record at a sequence (`null`: no record there). */
  authority: { head: WitnessHead | null; digestAt(sequence: number): string | null } | 'unmeasured';
  privacy: PrivacyHeadRead;
}

/** What the witness answered: a tuple that parsed, nothing (or an older agent), or something that did not parse. */
export type WitnessHeld = { kind: 'tuple'; tuple: WitnessTuple } | { kind: 'nothing' } | { kind: 'malformed' };

export type WitnessVerdict =
  | { kind: 'consistent'; counts: boolean }     // counts: off the volume, and from an earlier boot (question 8)
  | { kind: 'stale' }                           // epoch below the last Confirm's: offered the current tuple
  | { kind: 'rolled-back'; cause: 'witness-epoch' | 'witness-heads' }
  | { kind: 'no-witness' }                      // holds nothing, or an older agent
  | { kind: 'unmeasured'; why: 'malformed' | 'privacy-head' | 'journal' };

/** Table of §7.6's witness verdict, first match: (1) a malformed tuple is `unmeasured: malformed`; (2) nothing held is `no-witness`;
 *  (3) the server's own facts unmeasured is `unmeasured` (`privacy-head` when the privacy read is the cause, else `journal`);
 *  (4) a base below the server's is `stale`; (5) a base above, or an equal base and a higher term this build reads, is
 *  `witness-epoch`; (6) a head the server does not hold at that sequence with that digest is `witness-heads`; (7) otherwise
 *  `consistent`, which counts only from `other-host` or `console` under a boot other than this one. */
export function witnessVerdict(server: ServerWitnessFacts, held: WitnessHeld, host: HostRelation): WitnessVerdict {
  if (held.kind === 'malformed') return { kind: 'unmeasured', why: 'malformed' };
  if (held.kind === 'nothing') return { kind: 'no-witness' };
  const tuple = held.tuple;
  const facts = measuredWitnessFacts(server);
  if (facts.kind !== 'measured') return facts;
  const { epoch } = facts;
  if (tuple.base < epoch.base) return { kind: 'stale' };
  if (tuple.base > epoch.base || termHigher(tuple, epoch)) return { kind: 'rolled-back', cause: 'witness-epoch' };
  const heads = headsHeld(facts.authority, server.privacy, tuple);
  if (heads === 'unmeasured') return { kind: 'unmeasured', why: 'privacy-head' };
  if (heads === 'mismatch') return { kind: 'rolled-back', cause: 'witness-heads' };
  const counting = host === 'other-host' || host === 'console';
  return { kind: 'consistent', counts: counting && tuple.boot !== server.boot };
}

/** Row 3's check, also read independently by delivery: a source holding nothing or malformed data does not certify the server's facts. */
export function measuredWitnessFacts(server: ServerWitnessFacts):
  | { kind: 'measured'; epoch: Exclude<AuthorityEpoch, 'unmeasured'>; authority: Exclude<ServerWitnessFacts['authority'], 'unmeasured'> }
  | { kind: 'unmeasured'; why: 'journal' | 'privacy-head' } {
  const epoch = server.epoch;
  if (server.authority === 'unmeasured') return { kind: 'unmeasured', why: 'journal' };
  if (server.privacy.kind === 'unmeasured') return { kind: 'unmeasured', why: 'privacy-head' };
  if (epoch === 'unmeasured') return { kind: 'unmeasured', why: 'journal' };
  return { kind: 'measured', epoch, authority: server.authority };
}

/** A term this build reads is higher on the witness. A term the server does not read, or the witness does not hold, is skipped,
 *  never compared as zero. */
function termHigher(tuple: WitnessTuple, epoch: Exclude<AuthorityEpoch, 'unmeasured'>): boolean {
  if (tuple.terms.authority > epoch.terms.authority) return true;
  const mine = epoch.terms.privacy;
  const theirs = tuple.terms.privacy;
  return mine !== 'absent' && theirs !== 'absent' && theirs > mine;
}

/** Whether every head the witness holds is held by the server at that sequence with that digest. */
function headsHeld(
  authority: Exclude<ServerWitnessFacts['authority'], 'unmeasured'>, privacy: PrivacyHeadRead, tuple: WitnessTuple,
): 'held' | 'mismatch' | 'unmeasured' {
  const theirs = tuple.authority;
  if (theirs !== null) {
    const head = authority.head;
    if (head === null || theirs.sequence > head.sequence || authority.digestAt(theirs.sequence) !== theirs.digest) return 'mismatch';
  }
  const held = tuple.privacy;
  if (held === 'absent' || privacy.kind === 'absent') return 'held';
  if (held === 'empty') return 'held';
  if (privacy.kind !== 'head') return 'mismatch';        // the witness holds a head, the wired journal holds no record
  if (held.sequence > privacy.sequence) return 'mismatch';
  const at = privacy.digestAt(held.sequence);
  if (at === 'unmeasured') return 'unmeasured';
  return at === held.digest ? 'held' : 'mismatch';
}

// ── The narrowing held off the volume ────────────────────────────────────────────────────────────────────────────────

/** A witness's last answer since this boot. */
export interface HeldByWitness { host: HostRelation; boot: string; epoch: number }

/** Whether a narrowing at `epoch` is held off the volume: some witness on another host, or a signed-in console, holds an epoch at or
 *  above it. A same-host or unmeasured witness never counts. A holder whose boot is this boot DOES count: the question is whether the
 *  record is held off the volume, not whether a restore is ruled out (that is `witnessVerdict`'s `counts`). Answers `unmeasured` only
 *  when `epoch` itself is not a count. */
export function offVolumeHeld(epoch: number, holders: readonly HeldByWitness[]): 'held' | 'not-yet' | 'unmeasured' {
  if (!isCount(epoch)) return 'unmeasured';
  const held = holders.some((h) => (h.host === 'other-host' || h.host === 'console') && Number.isSafeInteger(h.epoch) && h.epoch >= epoch);
  return held ? 'held' : 'not-yet';
}

/** A source's last answer since boot, as the exchange keeps it: where it lives, the verdict's word, and the tuple when one parsed. */
export interface WitnessSourceAnswer { host: HostRelation; verdict: WitnessVerdict['kind']; tuple: WitnessTuple | null }

/** The holders `offVolumeHeld` reads (`held-for-compares-authority-sequence`): a source whose last verdict was `consistent` and whose
 *  tuple's base is the server's current base, with `epoch` replaced by that tuple's AUTHORITY head sequence (0 with none). A record's
 *  own epoch also counts privacy records appended before it, which the server cannot recover; the authority sequence is exact, and
 *  the digest check that made the verdict `consistent` already proved the same chain. */
export function offVolumeHolders(sources: readonly WitnessSourceAnswer[], serverBase: number): HeldByWitness[] {
  const out: HeldByWitness[] = [];
  for (const s of sources) {
    if (s.verdict !== 'consistent' || s.tuple === null || s.tuple.base !== serverBase) continue;
    out.push({ host: s.host, boot: s.tuple.boot, epoch: s.tuple.authority?.sequence ?? 0 });
  }
  return out;
}

/** The narrowest `told` from off-volume sources, including the ones that detected rollback and may hold the only surviving
 *  narrowing. This is not a holding receipt. Take the lowest non-null rung and lowest cap per cause, in cause order. */
export function narrowestTold(sources: readonly WitnessSourceAnswer[]): WitnessTold | null {
  let any = false;
  let rung: WitnessRung | null = null;
  const caps = new Map<string, WitnessRung>();
  const rank = (r: WitnessRung): number => WITNESS_RUNGS.indexOf(r);
  for (const s of sources) {
    if ((s.host !== 'other-host' && s.host !== 'console') || (s.verdict !== 'consistent' && s.verdict !== 'rolled-back') || s.tuple === null) continue;
    any = true;
    const t = s.tuple.told;
    if (t.operatorRung !== null && (rung === null || rank(t.operatorRung) < rank(rung))) rung = t.operatorRung;
    for (const l of t.latches) {
      const had = caps.get(l.cause);
      if (had === undefined || rank(l.cap) < rank(had)) caps.set(l.cause, l.cap);
    }
  }
  if (!any) return null;
  const latches = [...caps].map(([cause, cap]) => ({ cause, cap })).sort((a, b) => (a.cause < b.cause ? -1 : a.cause > b.cause ? 1 : 0));
  return { operatorRung: rung, latches };
}

// ── The tuple the server offers ──────────────────────────────────────────────────────────────────────────────────────

export type OfferedWitness =
  | { kind: 'tuple'; tuple: WitnessTuple }
  | { kind: 'unmeasured'; why: 'epoch' | 'privacy-head' | 'tuple' };

/** The tuple the server offers a witness, from the facts it holds: `told` is the fold's operator rung and its latches, sorted by
 *  cause. An unmeasured epoch or privacy read offers nothing, and a tuple that would not parse back is never offered. */
export function currentWitnessTuple(
  view: AuthorityView, authority: WitnessHead | null, epoch: AuthorityEpoch, privacy: PrivacyHeadRead,
  boot: string, restoreGeneration: number, highestMessageId: number | null,
): OfferedWitness {
  if (epoch === 'unmeasured') return { kind: 'unmeasured', why: 'epoch' };
  if (privacy.kind === 'unmeasured') return { kind: 'unmeasured', why: 'privacy-head' };
  const word = privacy.kind === 'head' ? { sequence: privacy.sequence, digest: privacy.digest } : privacy.kind;
  const latches = [...view.latches].map(([cause, cap]) => ({ cause, cap })).sort((a, b) => (a.cause < b.cause ? -1 : a.cause > b.cause ? 1 : 0));
  const highestIds: WitnessTuple['highestIds'] = { restoreGeneration };
  if (highestMessageId !== null) highestIds.message = highestMessageId;
  const parsed = parseWitnessTuple({
    v: 1, epoch: epoch.total, base: epoch.base, terms: { authority: epoch.terms.authority, privacy: epoch.terms.privacy, act: 'absent' },
    boot, authority, privacy: word, act: 'absent', highestIds, told: { operatorRung: view.operatorRung, latches },
  });
  return parsed.ok ? { kind: 'tuple', tuple: parsed.tuple } : { kind: 'unmeasured', why: 'tuple' };
}

// ── The witness's words ──────────────────────────────────────────────────────────────────────────────────────────────

const HOST_RELATIONS: Readonly<Record<HostRelation, true>> = { 'other-host': true, 'same-host': true, unmeasured: true, console: true };
const HELD_KINDS: Readonly<Record<WitnessHeld['kind'], true>> = { tuple: true, nothing: true, malformed: true };
const VERDICT_KINDS: Readonly<Record<WitnessVerdict['kind'], true>> = {
  consistent: true, stale: true, 'rolled-back': true, 'no-witness': true, unmeasured: true,
};
const OFF_VOLUME_WORDS: Readonly<Record<ReturnType<typeof offVolumeHeld>, true>> = { held: true, 'not-yet': true, unmeasured: true };

/** Whether `w` is one of this file's own kebab words: where a witness lives, what it answered, its verdict, and whether a narrowing
 *  is held off the volume. Derived from the tables above, so a word added to a union is admitted and a typo is not. None is a mail
 *  rejection or a run refusal (the coordination code census admits them through here). */
export function isWitnessKebab(w: string): boolean {
  const own = (o: object): boolean => Object.hasOwn(o, w);
  return own(HOST_RELATIONS) || own(HELD_KINDS) || own(VERDICT_KINDS) || own(OFF_VOLUME_WORDS);
}
