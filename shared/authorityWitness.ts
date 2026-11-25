// The Overlord authority witness tuple (Overlord spec §7.6; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md`
// Task 5, questions 7, 8 and 13): L0, one concern. What a witness (the console, an agent) keeps of the server's journals, so that a
// restore of the server's volume shows as a witness holding more than the server. It imports NOTHING, not even `node:*`, because the
// PWA bundles this file and keeps the tuple in its own storage. The rung list is spelled here and not imported from
// `shared/overlord-ladder.ts`: L0 files stay free of each other's imports, and the server's L1 witness file holds a compile-time check
// that the two lists are the same set of words.
//
// The epoch is a count of records, carried as a base plus one term per journal (`epoch-compared-term-by-term`), so a build that does not
// read a term can skip it and never compare it as zero. `told` carries the narrowing state as of the tuple's epoch
// (`witness-carries-told-narrowings`), so a later Confirm can keep a narrowing the operator was told took effect. Privacy `empty` is its
// own word (`privacy-empty-is-its-own-word`): a wired privacy journal with no record is not an unwired one.

const WITNESS_RUNG_MAP = { off: true, chat: true, advise: true, full: true } as const;
/** The ladder's rungs, lowest first, spelled again for L0 (the server's L1 file checks the two lists agree). */
export type WitnessRung = keyof typeof WITNESS_RUNG_MAP;
export const WITNESS_RUNGS = Object.keys(WITNESS_RUNG_MAP) as WitnessRung[];

/** A journal's head as a witness holds it: the sequence of its last record (a positive integer) and that record's digest. */
export interface WitnessHead { sequence: number; digest: string }
/** The narrowings in force as of a tuple's epoch: the operator's rung and each standing latch, sorted by cause. */
export interface WitnessTold { operatorRung: WitnessRung | null; latches: readonly { cause: string; cap: WitnessRung }[] }
export interface WitnessTuple {
  v: 1;
  epoch: number;                      // base + every term below: what witnessKeep orders by
  base: number;                       // the last Confirm's epochAtConfirm, 0 before the first
  terms: { authority: number; privacy: number | 'absent'; act: 'absent' };  // records since the base (question 7)
  boot: string;                       // the server's boot nonce when it sent this tuple
  authority: WitnessHead | null;      // null: no record yet
  privacy: WitnessHead | 'absent' | 'empty';   // 'absent': not wired; 'empty': wired, holds no record
  act: 'absent';                      // W2 widens it
  highestIds: { restoreGeneration: number; message?: number };  // W2 and W4 add kinds (question 13)
  told: WitnessTold;
}

const CAUSE_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CAUSE_MAX = 64;
const BOOT_RE = /^[\x21-\x7e]{1,128}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isRung = (v: unknown): v is WitnessRung => typeof v === 'string' && Object.prototype.hasOwnProperty.call(WITNESS_RUNG_MAP, v);
/** The object holds every required key and no key outside the required and optional ones. */
function exactKeys(o: Obj, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(o);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}

function parseHead(raw: unknown): WitnessHead | null {
  if (!isObj(raw) || !exactKeys(raw, ['sequence', 'digest'])) return null;
  const { sequence, digest } = raw;
  if (!isCount(sequence) || sequence < 1 || typeof digest !== 'string' || !DIGEST_RE.test(digest)) return null;
  return { sequence, digest };
}

function parseTold(raw: unknown): WitnessTold | null {
  if (!isObj(raw) || !exactKeys(raw, ['operatorRung', 'latches'])) return null;
  const { operatorRung, latches } = raw;
  if (operatorRung !== null && !isRung(operatorRung)) return null;
  if (!Array.isArray(latches)) return null;
  const out: { cause: string; cap: WitnessRung }[] = [];
  for (const l of latches) {
    if (!isObj(l) || !exactKeys(l, ['cause', 'cap'])) return null;
    const { cause, cap } = l;
    if (typeof cause !== 'string' || cause.length > CAUSE_MAX || !CAUSE_RE.test(cause) || !isRung(cap)) return null;
    const prev = out.at(-1);
    if (prev !== undefined && !(prev.cause < cause)) return null;      // sorted by cause, each cause once
    out.push({ cause, cap });
  }
  return { operatorRung, latches: out };
}

/** Strict: an unknown key, a missing required key, a wrong type or v != 1 answers `malformed`, never a partial tuple. */
export function parseWitnessTuple(raw: unknown): { ok: true; tuple: WitnessTuple } | { ok: false; why: 'malformed' } {
  const bad = { ok: false, why: 'malformed' } as const;
  if (!isObj(raw) || !exactKeys(raw, ['v', 'epoch', 'base', 'terms', 'boot', 'authority', 'privacy', 'act', 'highestIds', 'told'])) return bad;
  if (raw.v !== 1 || !isCount(raw.epoch) || !isCount(raw.base) || raw.act !== 'absent') return bad;
  if (typeof raw.boot !== 'string' || !BOOT_RE.test(raw.boot)) return bad;
  const terms = raw.terms;
  if (!isObj(terms) || !exactKeys(terms, ['authority', 'privacy', 'act'])) return bad;
  if (!isCount(terms.authority) || terms.act !== 'absent') return bad;
  if (terms.privacy !== 'absent' && !isCount(terms.privacy)) return bad;
  const privacyTerm: number | 'absent' = terms.privacy;
  if (raw.base + terms.authority + (privacyTerm === 'absent' ? 0 : privacyTerm) !== raw.epoch) return bad;
  let authority: WitnessHead | null = null;
  if (raw.authority !== null) {
    authority = parseHead(raw.authority);
    if (authority === null) return bad;
  }
  let privacy: WitnessHead | 'absent' | 'empty';
  if (raw.privacy === 'absent' || raw.privacy === 'empty') privacy = raw.privacy;
  else {
    const head = parseHead(raw.privacy);
    if (head === null) return bad;
    privacy = head;
  }
  const ids = raw.highestIds;
  if (!isObj(ids) || !exactKeys(ids, ['restoreGeneration'], ['message']) || !isCount(ids.restoreGeneration)) return bad;
  if (Object.prototype.hasOwnProperty.call(ids, 'message') && !isCount(ids.message)) return bad;
  const told = parseTold(raw.told);
  if (told === null) return bad;
  const highestIds: WitnessTuple['highestIds'] = { restoreGeneration: ids.restoreGeneration };
  if (isCount(ids.message)) highestIds.message = ids.message;
  return {
    ok: true,
    tuple: {
      v: 1, epoch: raw.epoch, base: raw.base, terms: { authority: terms.authority, privacy: privacyTerm, act: 'absent' },
      boot: raw.boot, authority, privacy, act: 'absent', highestIds, told,
    },
  };
}

/** A new base supersedes the old one. At the same base, an advance must preserve every term the holder measures
 *  (an absent offer term does not prove that a measured term survived). Equal epochs keep the existing witness. */
export function witnessKeep(held: WitnessTuple | null, offered: WitnessTuple): WitnessTuple {
  if (held === null) return offered;
  if (offered.base !== held.base) return offered.base > held.base ? offered : held;
  if (offered.terms.authority < held.terms.authority) return held;
  const privacy = held.terms.privacy;
  const offeredPrivacy = offered.terms.privacy;
  if (privacy !== 'absent' && (offeredPrivacy === 'absent' || offeredPrivacy < privacy)) return held;
  return offered.epoch > held.epoch ? offered : held;
}
