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
import type { AccountsConnect, AccountUsage, LaneNotReadyReason, LaneWire, RosterWire } from '../../../shared/api';
import type { RouteRefusal } from '../../../shared/refusal';
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
  /** The fix includes a check, so the card offers **Check again**, which calls the Check route when the screen can run
   *  it (accounts plan Task A14, D-7732). The command stays beside it for a screen that cannot. */
  readonly checkAgain: boolean;
}

/** The card body for a trouble word, or `null` for a word that is not trouble. `sessions` is how many live sessions
 *  run on the lane; `usage` is its telemetry row; `lane` its lane state, when the answer carries one. Moving sessions
 *  off is Task A3's sheet, so no sentence here offers it. */
export function troubleCopy(o: TroubleFacts): TroubleCopy | null {
  const body = troubleBody(o);
  // Check again is offered exactly where the fix names a check (D-7732).
  return body === null ? null : { ...body, checkAgain: body.commands.includes(fixCommands.check(o.id)) };
}

interface TroubleFacts {
  id: string;
  answer: AccountStateAnswer;
  entry: Pick<RosterWire, 'provider' | 'kind'> | undefined;
  lane: LaneWire | undefined;
  usage: AccountUsage | null;
  sessions: number;
  now: number;
}

function troubleBody(o: TroubleFacts): Omit<TroubleCopy, 'checkAgain'> | null {
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

// ── Check, and the kill switch (spec §10; accounts plan Task A14, D-7732) ─────────────────────────────────────────

/** The Check button's words: it spends one request, and says so (spec §13.1). */
export const CHECK_LABEL = 'Check · one test reply';
/** The trouble card's Check, the same route under the card's own word (spec §4.2). */
export const CHECK_AGAIN_LABEL = 'Check again · one test reply';

/** The kill switch row's sentence (spec §10): on, or off with the sessions that keep running here. */
export function switchRow(on: boolean, running: number): string {
  if (on) return 'On: new sessions can land here';
  if (running === 0) return 'Off: no new sessions.';
  return `Off: no new sessions; the ${running} running here ${running === 1 ? 'keeps' : 'keep'} running.`;
}

/** Why the knob cannot turn the lane on (spec §10): the box's reason, worded. A lane with no check recorded (a legacy
 *  lane the backfill wrote, or one with no lane state) reads "Check it once to turn it on". */
export function notReadyWords(reason: LaneNotReadyReason | undefined): string {
  switch (reason) {
    case 'check-failed': return "Not ready: the last check didn't pass. Check it first.";
    case 'no-credential': return 'Not ready: no credential is recorded for it. Give it one on the fleet host, then check it.';
    case 'seed-unverified': return "Not ready: its first-run setup isn't verified since its last run. Check it again.";
    default: return 'Check it once to turn it on';
  }
}

/** Why the screen cannot run a lane act at all, from the server's own `connect` (spec §12.6), or `null` when it can. */
export function connectBlock(connect: AccountsConnect): string | null {
  if (connect.origin === 'insecure') {
    return "Accounts can't be changed over plain HTTP: your session and this page could be read or changed on the way.";
  }
  if (connect.accountOps !== 'available') return 'The fleet host needs an update before lanes can be switched or checked here.';
  return null;
}

/** The words the lane routes refuse with that the screen names, each with its sentence (D-7732). Keyed by the route
 *  words themselves (`RouteRefusal`), so a typo is a compile error, and read by `Object.hasOwn` (ARCH-13b's rule: no
 *  literal branch on a code). `field` reads one more word off the body (`reason`, `verbCode`), already held to a word. */
type LaneRefusalWord = Extract<RouteRefusal,
  'not-ready' | 'last-enabled-home' | 'lane-busy' | 'outcome-unknown' | 'not-found' | 'unsupported' | 'insecure-origin'
  | 'unavailable' | 'lane-act-refused'>;
const LANE_REFUSAL_TEXT: Readonly<Record<LaneRefusalWord, (id: string, what: string, field: (k: string) => string | undefined) => string>> = {
  'not-ready': (_id, _what, field) => notReadyWords(field('reason') as LaneNotReadyReason | undefined),
  'last-enabled-home': (id) => `${id} is the only lane that can take new sessions. Turn another on first.`,
  'lane-busy': (id) => `${id} is busy with another account change. Try again in a moment.`,
  'outcome-unknown': (id, what) => `The fleet host didn't answer in time, so whether ${id} was ${what} is unknown. The screen reads it again.`,
  'not-found': (id) => `${id} is no longer on this box's roster.`,
  'unsupported': () => 'The fleet host needs an update before lanes can be switched or checked here.',
  'insecure-origin': () => "Accounts can't be changed over plain HTTP.",
  'unavailable': (id, what) => `The fleet host couldn't run it, so ${id} was not ${what}.`,
  'lane-act-refused': (id, what, field) => {
    const verb = field('verbCode');
    return verb === undefined ? `The fleet host refused: ${id} was not ${what}.` : `The fleet host refused (${verb}): ${id} was not ${what}.`;
  },
};

/** A refusal's words for a lane act, built from its CODE only (the server's `error` word, its `reason`, its
 *  `verbCode`), never from the response's text (D-7732). `failure` is what the call rejected with: an `ApiError`'s
 *  body, or anything else for a request that did not complete. */
export function laneActRefusal(act: 'check' | 'switch', id: string, failure: unknown): string {
  const body = typeof failure === 'object' && failure !== null && 'body' in failure ? (failure as { body: unknown }).body : undefined;
  const field = (k: string): string | undefined => {
    const v = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[k] : undefined;
    return typeof v === 'string' && CODE_RE.test(v) ? v : undefined;
  };
  const what = act === 'check' ? 'checked' : 'switched';
  const word = field('error');
  if (word === undefined) {
    return body === undefined
      ? `The request didn't complete, so whether ${id} was ${what} is unknown. The screen reads it again.`
      : `${id} couldn't be ${what}.`;
  }
  return Object.hasOwn(LANE_REFUSAL_TEXT, word)
    ? LANE_REFUSAL_TEXT[word as LaneRefusalWord](id, what, field)
    : `${id} couldn't be ${what} (${word}).`;
}

/** A refusal code as a screen may print it: a kebab word, never a sentence. */
const CODE_RE = /^[a-z][a-z0-9-]{0,47}$/;
