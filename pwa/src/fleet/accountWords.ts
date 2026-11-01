// The Accounts screen's words (spec 2026-10-18 accounts-connect §4.1–§4.4; accounts plan Task A2, D-7718).
//
// The state word itself is NOT decided here: `stateWordFor` (shared/accounts.ts) is the one derivation, the server
// answers it as `LaneWire.state`, and this file only says how the screen draws an answer it was given. The kind chip's
// words come from `KIND_CODES` through `kindCodeOf`, never a second list. What lives here is display: the lamp's glyph
// and word, which words lift as trouble cards and in what order, the roll-up subtitle, the two age lines, the identity
// line, and each trouble card's three sentences and its command.
import {
  ACCOUNT_STATE_WORDS, CREDIT_EXPIRING_FRACTION, WINDOW_LIMITED_PCT, kindCodeOf, sourceAt, stateWordFor,
  type AccountStateAnswer, type AccountStateWord,
} from '../../../shared/accounts';
import type { AccountUsage, LaneWire, RosterWire } from '../../../shared/api';
import { formatAge, formatReset } from './formatReset';

/** The lamp: a glyph and its word, never a glyph alone (spec §4.1; identity core). One row per state word, in the
 *  words' own precedence, so a new word is a compile error here before it is a lamp with no name. */
export const STATE_LAMPS: { readonly [W in AccountStateWord]: { readonly glyph: string; readonly word: string } } = {
  off: { glyph: '○', word: 'Off' },
  'signed-out': { glyph: '✕', word: 'Signed out' },
  'rate-limited': { glyph: '◐', word: 'Rate-limited' },
  expiring: { glyph: '◔', word: 'Expiring' },
  'signed-in': { glyph: '●', word: 'Signed in' },
  inconclusive: { glyph: '~', word: 'Inconclusive' },
  'not-checked': { glyph: '—', word: 'Not checked' },
};

/** The words that lift to the top of the list as trouble cards, in the order they lift (spec §4.2, and §12.2's group
 *  order): Signed out, then Rate-limited, then Expiring, then Inconclusive. Every other card keeps roster order. */
export const TROUBLE_WORDS = ['signed-out', 'rate-limited', 'expiring', 'inconclusive'] as const satisfies readonly AccountStateWord[];
export type TroubleWord = (typeof TROUBLE_WORDS)[number];

export function isTrouble(word: AccountStateWord): word is TroubleWord {
  return (TROUBLE_WORDS as readonly string[]).includes(word);
}

/** `ids` with the trouble cards first, in `TROUBLE_WORDS` order, and every other id after them in the order given.
 *  Stable: two lanes with the same trouble word keep their roster order. */
export function troubleFirst(ids: readonly string[], wordOf: (id: string) => AccountStateWord): string[] {
  const rank = (id: string): number => {
    const w = wordOf(id);
    return isTrouble(w) ? TROUBLE_WORDS.indexOf(w) : TROUBLE_WORDS.length;
  };
  return ids.map((id, i) => ({ id, i, r: rank(id) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.id);
}

/** The roll-up's clauses, in their order (spec §4.3: `5 accounts · 1 signed out · 1 off`): the trouble words and Off.
 *  Signed in and Not checked are the quiet remainder the total already counts. */
const ROLL_UP: readonly AccountStateWord[] = [...TROUBLE_WORDS, 'off'];

/** The header's measured roll-up: the count of lanes, then one clause per word that has a lane in it, zero clauses
 *  omitted. Each lane is counted once, under its one word. */
export function rollUp(words: readonly AccountStateWord[]): string {
  const n = words.length;
  const clauses = [`${n} ${n === 1 ? 'account' : 'accounts'}`];
  for (const w of ROLL_UP) {
    const k = words.filter((x) => x === w).length;
    if (k > 0) clauses.push(`${k} ${STATE_LAMPS[w].word.toLowerCase()}`);
  }
  return clauses.join(' · ');
}

/** The kind chip's words (`claude · sign-in`, …), from `KIND_CODES`; `null` when the roster does not say. */
export function kindChipWords(entry: Pick<RosterWire, 'provider' | 'kind'> | undefined): string | null {
  return kindCodeOf(entry?.provider, entry?.kind)?.words ?? null;
}

/** What the screen says when the answer carries no lane state for a lane (a dark gate's reader, an older server):
 *  the one function's word over today's facts, and never the claim that no check is recorded, which only the file
 *  could say. */
export const NO_LANE_STATE_SOURCE = 'no lane state on this answer';

/** The lane's one word and its source: the server's (`LaneWire.state`) whenever the answer carries one; otherwise
 *  `stateWordFor` over the telemetry row alone, its "no check recorded" read as "no lane state on this answer".
 *
 *  The server's source is spoken again at the screen's `now` (`sourceAt`, D-7718 (10)): the server wrote its age at
 *  request time, and a held answer (the link down, the store keeping its last good read) would otherwise say
 *  "checked 2h ago" beside a trouble line that, from the same `now`, says 3h. The word and `at` are the server's. */
export function laneAnswerOf(
  lane: LaneWire | undefined,
  usage: AccountUsage | null,
  entry: Pick<RosterWire, 'provider' | 'kind'> | undefined,
  now: number,
): AccountStateAnswer {
  if (lane?.state !== undefined && (ACCOUNT_STATE_WORDS as readonly string[]).includes(lane.state.word)) {
    const source = sourceAt(lane.state, now, usage ?? undefined);
    return source === lane.state.source ? lane.state : { ...lane.state, source };
  }
  const a = stateWordFor({
    disabled: usage?.disabled === true, authDead: usage?.authDead === true,
    five: usage?.five ?? null, seven: usage?.seven ?? null,
    fiveResetAt: usage?.fiveResetAt ?? null, sevenResetAt: usage?.sevenResetAt ?? null,
    ...(entry?.provider !== undefined ? { provider: entry.provider } : {}),
    ...(entry?.kind !== undefined ? { kind: entry.kind } : {}),
    now,
  });
  return a.word === 'not-checked' ? { word: a.word, source: NO_LANE_STATE_SOURCE } : a;
}

/** The card's two age lines, kept apart (09-05; spec §4.1 "The two ages stay apart"): the state's source with the
 *  instant the state was measured, and the usage reading with the instant telemetry last landed. Two measurements,
 *  two fields: neither is ever read off the other. */
export function cardLines(answer: AccountStateAnswer, usageTs: number | null, nowSec: number): {
  state: string; stateAt: number | null; usage: string; usageAt: number | null;
} {
  return {
    state: answer.source,
    stateAt: answer.at ?? null,
    usage: `last reported ${formatAge(usageTs === null ? null : nowSec - usageTs)}`,
    usageAt: usageTs === null ? null : usageTs * 1000,
  };
}

/** What Off's precedence would otherwise hide (spec §4.1: "the others still show in the full record"): a lane switched
 *  off whose credential the probe also measured dead says both, since the two are cleared by different acts. */
export function offAlso(answer: AccountStateAnswer, usage: AccountUsage | null): string | null {
  return answer.word === 'off' && usage?.authDead === true ? 'also signed out (HTTP 401)' : null;
}

/** The head's identity line (spec §3.4, §4.4): a key's hint and when it was validated, or the account the credential
 *  belongs to and how that was learned. Only what the lane state recorded; `null` when it recorded nothing (and on a
 *  dark gate's answer, which carries no lane state at all). */
export function identityLine(lane: LaneWire | undefined, word: AccountStateWord, nowSec: number): string | null {
  if (lane === undefined) return null;
  if (lane.keyHint !== undefined) {
    const validated = lane.validatedAt === undefined ? '' : ` · validated ${formatAge(nowSec - Math.floor(lane.validatedAt / 1000))}`;
    return `Key ${lane.keyHint}${validated}`;
  }
  if (lane.identity === undefined) return null;
  if (lane.identitySource === 'stated') return `Approved as ${lane.identity} · stated by you`;
  return word === 'signed-in' ? `Signed in as ${lane.identity}` : `Last signed in as ${lane.identity}`;
}

const sessionsOn = (n: number): string => `${n} ${n === 1 ? 'session' : 'sessions'} on it`;
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
const MONTH_MS = 86_400_000 * 365.25 / 12;
const money = (n: number): string => {
  const v = Math.max(0, n);
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
};

/** The fleet-host commands a trouble card offers until the screen can run the act itself (spec §12.4's copy rule).
 *  A credential only ever arrives on a pipe (README, "A credential only ever arrives on a pipe"). */
export const fixCommands = {
  check: (id: string): string => `ccrc account check --id ${id}`,
  credential: (id: string): string => `ccrc account credential --id ${id} --credential - < /path/to/credential-file`,
  disable: (id: string): string => `ccrc account disable --id ${id}`,
} as const;

/** A trouble card's body (spec §4.2): what is wrong, its effect, and its fix as a lead sentence and the commands to
 *  run on the fleet host, all in sans except the commands. */
export interface TroubleCopy {
  readonly wrong: string;
  readonly effect: string;
  readonly lead: string;
  readonly commands: readonly string[];
}

/** The card body for a trouble word, or `null` for a word that is not trouble. `sessions` is how many live sessions
 *  run on the lane; `usage` is its telemetry row; `lane` its lane state, when the answer carries one. Moving sessions
 *  off is Task A3's sheet, so no sentence here offers it. */
export function troubleCopy(o: {
  id: string;
  answer: AccountStateAnswer;
  entry: Pick<RosterWire, 'provider' | 'kind'> | undefined;
  lane: LaneWire | undefined;
  usage: AccountUsage | null;
  sessions: number;
  now: number;
}): TroubleCopy | null {
  const { id, answer, entry, lane, usage, sessions, now } = o;
  const nowSec = Math.floor(now / 1000);
  const keyLane = entry?.kind === 'key';
  const credentialLane = keyLane || entry?.kind === 'token';
  switch (answer.word) {
    case 'signed-out': {
      const ago = answer.at === undefined ? '' : ` ${formatAge(nowSec - Math.floor(answer.at / 1000))}`;
      const what = entry?.kind === 'token' ? 'token was refused'
        : keyLane ? `key was refused by ${entry?.provider === 'openrouter' ? 'OpenRouter' : 'its provider'}`
          : 'sign-in was refused';
      return {
        wrong: `${id}'s ${what} (HTTP 401)${ago}.`,
        effect: `New sessions are not placed here.${sessions > 0 ? ` ${sessionsOn(sessions)} will fail their next turn.` : ''}`,
        lead: credentialLane
          ? 'Replace its credential on the fleet host, then check it again:'
          : 'Sign it in again on the fleet host, then check it again:',
        commands: credentialLane ? [fixCommands.credential(id), fixCommands.check(id)] : [fixCommands.check(id)],
      };
    }
    case 'rate-limited': {
      const five = usage?.five ?? null;
      const seven = usage?.seven ?? null;
      const which = five !== null && five >= WINDOW_LIMITED_PCT ? 'five'
        : seven !== null && seven >= WINDOW_LIMITED_PCT ? 'seven' : 'credit';
      const resetAt = which === 'five' ? usage?.fiveResetAt ?? null : which === 'seven' ? usage?.sevenResetAt ?? null : null;
      const resets = resetAt !== null && resetAt > nowSec ? `Resets in ${formatReset(resetAt, nowSec)}. ` : '';
      return {
        wrong: which === 'credit' ? `${id}'s OpenRouter key has used up its credit.`
          : `${id} reached its ${which === 'five' ? '5-hour' : '7-day'} limit.`,
        effect: `${resets}${sessions > 0 ? `${sessionsOn(sessions)} ${sessions === 1 ? 'is' : 'are'} waiting.` : 'No sessions are on it.'}`.trim(),
        lead: 'To keep new sessions off it until then, switch it off on the fleet host:',
        commands: [fixCommands.disable(id)],
      };
    }
    case 'expiring': {
      const credit = lane?.credit;
      if (entry?.kind === 'token' && lane?.mintedAt !== undefined) {
        const months = Math.max(0, Math.floor((now - lane.mintedAt) / MONTH_MS));
        return {
          wrong: `${id}'s token was minted about ${plural(months, 'month')} ago.`,
          effect: 'Long-lived tokens last about a year. When it lapses the lane signs out.',
          lead: 'Replace the token on the fleet host:',
          commands: [fixCommands.credential(id)],
        };
      }
      if (credit !== undefined && credit.limit !== null && credit.remaining !== null && credit.limit > 0
          && credit.remaining <= credit.limit * CREDIT_EXPIRING_FRACTION) {
        return {
          wrong: `${id}'s OpenRouter key has ${money(credit.remaining)} of ${money(credit.limit)} left.`,
          effect: 'When it hits zero, requests on it fail.',
          lead: 'Top up its credit at OpenRouter, or replace the key on the fleet host:',
          commands: [fixCommands.credential(id)],
        };
      }
      // The minted key's expiry, whose date the wire does not carry: the source's first clause says it.
      return {
        wrong: `${id}'s ${answer.source.split(' · ')[0]}.`,
        effect: 'When it lapses, requests on it fail.',
        lead: 'Replace the key on the fleet host:',
        commands: [fixCommands.credential(id)],
      };
    }
    case 'inconclusive':
      return answer.source === 'lane state unreadable'
        ? {
          wrong: `${id}'s lane state could not be read.`,
          effect: 'Nothing here says whether the credential works; it may be fine.',
          lead: 'Check it again on the fleet host, which writes the lane state anew:',
          commands: [fixCommands.check(id)],
        }
        : {
          wrong: "The last check couldn't reach the provider.",
          effect: 'Nothing was learned about the credential; it may be fine.',
          lead: 'Check it again on the fleet host:',
          commands: [fixCommands.check(id)],
        };
    default:
      return null;
  }
}

/** A Codex lane has no 5-hour window: its absent 5h reads this, never "—" (spec §4.1). */
export const WEEKLY_ONLY = 'weekly window only';
