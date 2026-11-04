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
import { SWAP_REFUSALS, type AccountsConnect, type AccountUsage, type LaneNotReadyReason, type LaneWire, type RosterWire } from '../../../shared/api';
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
  /** "Move N sessions off" (spec §4.2, §4.5; Task A3): the lane the card's sessions move off, and whether it is the
   *  card's first fix (Rate-limited's, which is not a fault) or one beside the credential act (Signed out's). `null`
   *  on a card whose fix is not a move. The card counts the sessions itself, and offers nothing when there are none. */
  readonly move: { readonly from: string; readonly primary: boolean } | null;
}

/** The card body for a trouble word, or `null` for a word that is not trouble. `sessions` is how many live sessions
 *  run on the lane; `usage` is its telemetry row; `lane` its lane state, when the answer carries one. Signed out and
 *  Rate-limited offer "Move N sessions off" (spec §4.2) through `move`; the sentences never name the move, because the
 *  button is the offer and it says its own count. */
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
        move: { from: id, primary: false },
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
        move: { from: id, primary: true },
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
          move: null,
        };
      }
      if (credit !== undefined && credit.limit !== null && credit.remaining !== null && credit.limit > 0
          && credit.remaining <= credit.limit * CREDIT_EXPIRING_FRACTION) {
        return {
          wrong: `${id}'s OpenRouter key has ${money(credit.remaining)} of ${money(credit.limit)} left.`,
          effect: 'When it hits zero, requests on it fail.',
          lead: 'Top up its credit at OpenRouter, or replace the key on the fleet host:',
          commands: [fixCommands.credential(id)],
          move: null,
        };
      }
      // The minted key's expiry, whose date the wire does not carry: the source's first clause says it.
      return {
        wrong: `${id}'s ${answer.source.split(' · ')[0]}.`,
        effect: 'When it lapses, requests on it fail.',
        lead: 'Replace the key on the fleet host:',
        commands: [fixCommands.credential(id)],
        move: null,
      };
    }
    case 'inconclusive':
      return answer.source === 'lane state unreadable'
        ? {
          wrong: `${id}'s lane state could not be read.`,
          effect: 'Nothing here says whether the credential works; it may be fine.',
          lead: 'Check it again on the fleet host, which writes the lane state anew:',
          commands: [fixCommands.check(id)],
          move: null,
        }
        : {
          wrong: "The last check couldn't reach the provider.",
          effect: 'Nothing was learned about the credential; it may be fine.',
          lead: 'Check it again on the fleet host:',
          commands: [fixCommands.check(id)],
          move: null,
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

// ── The Add account door and the connect sheet (accounts plan Task A18, D-7740; spec §5, §6.3, §12.4, §12.5) ──────────
// Every sentence the door and the sheet say. A refusal is worded from its CODE only (the route's `error` word), never
// from the response's text, as `laneActRefusal` below does for the lane acts.

/** The door's word and its meta line (spec §5, D-5522). */
export const DOOR_WORD = 'Add account';
export const DOOR_META = 'Anthropic · OpenAI · OpenRouter';

/** Why the door narrows in place, other than offline (spec §5): each with its sentence and, when a command fixes it,
 *  the command. `waiting` is the screen before its first answer, which cannot yet say whether it may add. */
export type DoorNarrowing = 'waiting' | 'gate-dark' | 'insecure-origin' | 'unsupported';
export const DOOR_NARROWED: { readonly [N in DoorNarrowing]: { readonly text: string; readonly fix?: string } } = {
  waiting: { text: 'Reading the fleet host before anything can be added.' },
  'gate-dark': {
    text: "Turn on sign-in for this PWA first (ccrc auth on). Without it the server can't tell you from a session.",
    fix: 'ccrc auth on',
  },
  'insecure-origin': {
    text: "Adding accounts needs an https origin. This server's origin is plain HTTP, so your session and this page could be "
      + 'read or changed on the way. Fix: ccrc expose, which sets the https origin and sign-in together.',
    fix: 'ccrc expose',
  },
  unsupported: { text: "Needs a fleet update: the fleet host doesn't support adding accounts yet." },
};

/** Which narrowing applies to the door, from the server's own answer (spec §12.6, never inferred from `location`), or
 *  `null` when it may open. `landed` is whether an accounts answer has landed; a landed answer with no `connect` is a
 *  dark gate's (D-5511: only a session reader is sent it, and an armed gate lets no other reader in). */
export function doorNarrowing(landed: boolean, connect: AccountsConnect | null): DoorNarrowing | null {
  if (!landed) return 'waiting';
  if (connect === null || connect.gate === 'dark') return 'gate-dark';
  if (connect.origin === 'insecure') return 'insecure-origin';
  if (connect.accountOps !== 'available') return 'unsupported';
  return null;
}

/** THE OFFLINE REFUSAL (spec §12.5; the 09-05 §12.8 rules): one sentence for every act on the screen and in the sheet,
 *  with the read-line, the age of the last accounts answer this device has. `readAt` is epoch ms, or `null` when this
 *  page has had none. */
export function offlineRefusal(readAt: number | null, now: number): string {
  const read = readAt === null
    ? 'Nothing has been read from the server since this page opened.'
    : `Read ${formatAge(Math.floor((now - readAt) / 1000))}.`;
  return `You're offline: nothing was sent. ${read}`;
}

/** The provider rows (spec §5), in the door's order: each provider's name and its line. Every provider but
 *  `compatible`, which stays CLI in v1 (no "Other" row). The connect sheet's provider list is these keys. */
export const PROVIDER_ROWS: { readonly [P in Exclude<import('../../../shared/providers').ProviderId, 'compatible'>]: { readonly name: string; readonly line: string } } = {
  anthropic: { name: 'Anthropic', line: 'Claude subscription (Pro, Max, Team). Sessions run Claude Code on it.' },
  openai: { name: 'OpenAI', line: "ChatGPT subscription. Runs as a Codex lane through ccrc's own gateway." },
  openrouter: { name: 'OpenRouter', line: 'Pay per use, many models. Mint, connect or paste a key.' },
};

/** A provider, or a method, whose cap word the fleet does not advertise (N4): it narrows in place with this. */
export const NEEDS_FLEET_UPDATE = 'Needs a fleet update';
/** A method the fleet can run that this app's sheet has no steps for yet: reload once the app is updated. */
export const NEEDS_APP_UPDATE = "This app can't run it yet: reload after the next update.";

/** The Anthropic method radio (spec §6.1): each method's name and its consequence line. */
export const METHOD_LINES: { readonly [M in 'setup-token' | 'login' | 'paste']: { readonly name: string; readonly line: string } } = {
  'setup-token': {
    name: 'Mint a long-lived token',
    line: "Lasts about a year, so sessions don't keep asking you to sign in again. Inference only: Remote Control won't "
      + 'work on this lane. You sign in on claude.ai and paste back a code.',
  },
  login: {
    name: 'Sign in with Claude',
    line: 'Refreshes itself, shows which account it is, and Remote Control works. Sessions may ask you to sign in again '
      + 'when the sign-in lapses.',
  },
  paste: {
    name: 'Paste a token',
    line: 'You already ran claude setup-token somewhere. Inference only.',
  },
};

/** The identity step's problems (spec §5), each worded. */
export function idProblemText(id: string, problem: 'empty' | 'bad-id' | 'reserved-id' | 'duplicate-id'): string {
  switch (problem) {
    case 'empty': return 'Give the lane a name.';
    case 'bad-id': return 'Lowercase letters, digits and hyphens, starting with a letter, at most 32 characters.';
    case 'reserved-id': return `"${id}" is reserved on the fleet host. Pick another name.`;
    case 'duplicate-id': return `There is already a lane named ${id}. Pick another name.`;
  }
}
export function labelProblemText(problem: 'empty' | 'too-long' | 'unsafe'): string {
  switch (problem) {
    case 'empty': return 'Give the lane a label.';
    case 'too-long': return 'At most 64 characters.';
    case 'unsafe': return 'One line of text: no tabs, line breaks or control characters.';
  }
}
/** A hue another lane wears: still selectable (lanes may share a hue), marked with who has it. */
export const hueAlso = (ids: readonly string[]): string => `also ${ids.join(', ')}`;
/** The derived folder and wrapper, read-only (spec §5). */
export const derivedLine = (suffix: string, id: string): string => `Config folder ~/${suffix} · wrapper ${id}`;

/** `config-dir-exists` (G20): what the box measured in the folder it found, and the two ways on. */
export function configDirFoundText(id: string, signedIn: boolean | undefined): string {
  const state = signedIn === undefined ? '' : signedIn ? ' · signed in' : ' · signed out';
  return `A config folder for ${id} from an earlier lane is still there${state}.`;
}
export const PICK_ANOTHER_NAME = 'Pick another name';
export const USE_WHATS_THERE = "Use what's there";

/** The secret field's label and the paste method's primary. */
export const TOKEN_FIELD_LABEL = 'Paste the token';
export const ADD_LANE = 'Add lane';
/** What the live region says when the sheet moves to a frame (spec §12.4: every step change is announced). */
export const FRAME_SAID = {
  provider: 'Choose a provider',
  name: 'Name the lane',
  method: 'Choose how the lane gets its credential',
  adopt: "Using what's there: paste the token",
} as const;
/** The add was refused `step-up-required`: the stamp lapsed between the step and the act (spec §3.2). */
export const STEP_UP_AGAIN = "Confirm it's you again, then paste the token again. Nothing was added.";
/** The secret was cleared when the app went to the background before it was sent (spec §3.3). */
export const TOKEN_CLEARED = 'The token was cleared when the app went to the background. Paste it again.';

/** The Run frame's step ledger (spec §12.3): each step's line while it runs and once it is done. */
export const LEDGER = {
  adding: (id: string): string => `… checking the token and creating ${id}`,
  added: (id: string): string => `✓ ${id} created · off`,
  found: (id: string): string => `✓ ${id} found on the fleet host · off`,
  checking: (id: string): string => `… checking ${id}: one test reply`,
  checked: '✓ Checked: one test reply · first-run setup verified',
  enabling: (id: string): string => `… turning ${id} on`,
  on: '✓ On · new sessions can land here. Swap rotation includes it within a minute.',
  reading: "… reading the fleet host's accounts again",
} as const;

/** Outcome unknown (spec §6.2's terminal states): the add's answer never came. */
export const OUTCOME_UNKNOWN = "The fleet host didn't answer in time. The lane may exist; checking…";
/** The re-read found no such lane: nothing was added, and nothing is sent again on its own. */
export const notFoundAfterUnknown = (id: string): string =>
  `${id} isn't on the fleet host: nothing was added. Paste the token again to try again.`;
/** The re-read after an outcome unknown did not land either, so no roster was reconciled: the sheet claims nothing
 *  about the lane, sends nothing again, and offers only a fresh read (D-7740 (5)). */
export const stillUnknownAfterUnknown = (id: string): string =>
  `The fleet host's accounts couldn't be read either, so whether ${id} was added is still unknown. Nothing was sent again. Read again before pasting the token.`;
/** The one act that state offers: read the roster again (never the add). */
export const READ_AGAIN = 'Read again';

/** Where the sheet goes back to after a refusal: the name frame, or the method frame with its field empty. */
export type AddRefusalFrame = 'name' | 'method';
type AddRefusalWord = Extract<RouteRefusal,
  'key-rejected' | 'token-unverified' | 'key-charset' | 'duplicate-id' | 'lane-busy' | 'auth-in-progress'
  | 'unsupported' | 'insecure-origin' | 'auth-off' | 'unauthenticated' | 'unavailable' | 'bad-account-id'>;
const ADD_REFUSAL_TEXT: Readonly<Record<AddRefusalWord, { frame: AddRefusalFrame; text: (id: string) => string }>> = {
  'key-rejected': { frame: 'method', text: () => 'That token was refused (HTTP 401). Nothing was saved.' },
  'token-unverified': { frame: 'method', text: () => "Anthropic didn't answer: nothing was saved. Try again." },
  'key-charset': {
    frame: 'method',
    text: () => "That isn't a token: it holds a line break or a control character, or is too long. Nothing was saved.",
  },
  'duplicate-id': { frame: 'name', text: (id) => `The fleet host already has a lane named ${id}. Pick another name.` },
  'bad-account-id': { frame: 'name', text: () => idProblemText('', 'bad-id') },
  'lane-busy': { frame: 'method', text: (id) => `${id} is busy with another account change. Nothing was added. Try again in a moment.` },
  'auth-in-progress': { frame: 'method', text: (id) => `A sign-in for ${id} is in progress. Nothing was added.` },
  unsupported: { frame: 'method', text: () => DOOR_NARROWED.unsupported.text },
  'insecure-origin': { frame: 'method', text: () => "Accounts can't be changed over plain HTTP. Nothing was added." },
  'auth-off': { frame: 'method', text: () => DOOR_NARROWED['gate-dark'].text },
  unauthenticated: { frame: 'method', text: () => 'Sign in to this PWA again, then add the lane. Nothing was added.' },
  unavailable: { frame: 'method', text: () => "The fleet host couldn't run it: nothing was added." },
};

/** An add's refusal, from its code alone: where the sheet goes back to and what it says. `null` for the answers the
 *  sheet handles as states of their own (`config-dir-exists`, `lane-exists`, `step-up-required`, `outcome-unknown`, and
 *  a request that never completed). */
export function addRefusal(id: string, word: string | undefined): { frame: AddRefusalFrame; text: string } | null {
  if (word === undefined) return null;
  if (Object.hasOwn(ADD_REFUSAL_TEXT, word)) {
    const r = ADD_REFUSAL_TEXT[word as AddRefusalWord];
    return { frame: r.frame, text: r.text(id) };
  }
  if (['config-dir-exists', 'lane-exists', 'step-up-required', 'outcome-unknown'].includes(word)) return null;
  return { frame: 'method', text: CODE_RE.test(word) ? `The fleet host refused (${word}): nothing was added.` : ADD_REFUSED };
}
/** An add refused with no word the sheet can name. */
export const ADD_REFUSED = 'The fleet host refused: nothing was added.';

/** The Result frame (spec §12.3): a register, not a celebration. */
export const TURN_IT_ON = 'Turn it on';
export const LEAVE_IT_OFF = 'Leave it off for now';
export const resultDone = (id: string, on: boolean): string => (on ? `${id} is on.` : `${id} is added, and off.`);
/** The check's round trip, as this sheet measured it (spec §12.3's result frame). */
export const checkLatency = (ms: number): string => `Checked: one test reply in ${(ms / 1000).toFixed(1)} s`;

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

/** The trouble card's move button (spec §4.2): "Move 4 sessions off". */
export function moveOffLabel(n: number): string {
  return `Move ${plural(n, 'session')} off`;
}

/** One session's outcome in the Move sessions sheet (spec §4.5; Task A3): the kind, which the sheet styles and counts
 *  by, and its word, which is all it renders. */
export type MoveOutcome = 'moved' | 'skipped-busy' | 'refused-asleep' | 'refused-other-pool' | 'refused' | 'no-answer';

/** What one swap answered, as the sheet hands it here: `ok`; a refusal's HTTP status and its `error` code, `null` when
 *  the body carried none (a 502 with ccd's sentence, whose text is never shown); or no answer at all. */
export type SwapAnswer = { readonly kind: 'ok' } | { readonly kind: 'refused'; readonly status: number; readonly code: string | null }
  | { readonly kind: 'no-answer' };

/** Each refusal code's outcome and word (spec §4.5: "each refusal is named in the sheet, with the reason taken from its
 *  code"): the busy skip, the hibernation refusal, the pool refusal, and the reasons the route's other codes name. Short:
 *  the word sits right-aligned in the sheet's row. Typed over the route codes, so a misspelled key is a compile error
 *  rather than a reason that never shows; read with `Object.hasOwn`, so a body naming `toString` is no code here. */
const MOVE_REFUSALS: Partial<Record<RouteRefusal, { readonly outcome: MoveOutcome; readonly word: string }>> = {
  [SWAP_REFUSALS.sessionBusy]: { outcome: 'skipped-busy', word: 'skipped: busy' },
  [SWAP_REFUSALS.hibernated]: { outcome: 'refused-asleep', word: 'refused: asleep' },
  'pool-mismatch': { outcome: 'refused-other-pool', word: 'refused: other pool' },
  [SWAP_REFUSALS.statusUnknown]: { outcome: 'refused', word: 'refused: status unreadable' },
  'pool-unreadable': { outcome: 'refused', word: 'refused: pool unreadable' },
  'unknown-session': { outcome: 'refused', word: 'refused: not in the registry' },
  'registry-unmeasurable': { outcome: 'refused', word: 'refused: registry unreadable' },
  'bad-session-id': { outcome: 'refused', word: 'refused: bad session id' },
  'bad-request': { outcome: 'refused', word: 'refused: bad request' },
  unsupported: { outcome: 'refused', word: 'refused: fleet host too old to cross pools' },
};

/** Each session's one outcome word, from its answer's code and never its text (spec §4.5): moved, skipped busy, refused
 *  asleep (the hibernation refusal, `SWAP_REFUSALS.hibernated`), refused other pool (`pool-mismatch`), or refused with
 *  the reason its code names. A code this build does not know, and a failure with no code (ccd's 502), say so in words
 *  of their own; no response text reaches the row. No answer is not a refusal: the move may have happened. */
export function moveOutcomeOf(answer: SwapAnswer): { readonly outcome: MoveOutcome; readonly word: string } {
  if (answer.kind === 'ok') return { outcome: 'moved', word: 'moved' };
  if (answer.kind === 'no-answer') return { outcome: 'no-answer', word: 'no answer: it may have moved' };
  const { code, status } = answer;
  const known = code !== null && Object.hasOwn(MOVE_REFUSALS, code) ? MOVE_REFUSALS[code as RouteRefusal] : undefined;
  if (known !== undefined) return known;
  if (code === null && status >= 500) return { outcome: 'refused', word: 'refused: the fleet host could not move it' };
  return { outcome: 'refused', word: 'refused: a reason this app does not know' };
}

// ── Remove, Discard, Replace token, the revoke checklist and the compromise disclosure (accounts plan Task A19, D-7742;
// spec §9, §11, §3.11) ─────────────────────────────────────────────────────────────────────────────────────────────
// Every sentence the remove and replace sheets say. A refusal is worded from its CODE only, as above. The OA1 record
// (2026-11-01) did not measure G23, so a sign-in's row at the provider says the result is UNMEASURED: never that the
// sign-in ended at Anthropic, and never that it is still valid.

/** The fold's acts (spec §4.4): Remove opens the remove sheet, Replace token the replace sheet (token lanes only). */
export const REMOVE_ACT = 'Remove…';
export const REPLACE_TOKEN = 'Replace token';
/** A signed-out token lane's trouble card offers the paste under the spec's own word (§4.2: "Paste a token"). */
export const PASTE_A_TOKEN = 'Paste a token';

/** Remove's pre-check as the box measured it (spec §11.1), in one line: "0 live sessions · not the upstream lane · 2
 *  other lanes can take new sessions · no sign-in in progress · read just now". `at` is the box's instant, epoch ms. */
export function removeCheckLine(c: {
  live: number | null; upstream: boolean; otherHomeAble: number; authInProgress: boolean; at: number;
}, now: number): string {
  const live = c.live === null ? "live sessions couldn't be counted" : `${plural(c.live, 'live session')}`;
  const others = c.otherHomeAble === 0 ? 'no other lane can take new sessions'
    : `${c.otherHomeAble} other ${c.otherHomeAble === 1 ? 'lane' : 'lanes'} can take new sessions`;
  return [
    live,
    c.upstream ? 'the upstream lane' : 'not the upstream lane',
    others,
    c.authInProgress ? 'a sign-in in progress' : 'no sign-in in progress',
    `read ${formatAge(Math.floor((now - c.at) / 1000))}`,
  ].join(' · ');
}

/** The destructive button's words: it recounts as sessions move (spec §11.2). */
export function removeButtonLabel(id: string, still: number): string {
  return still > 0 ? `Remove ${id} · ${plural(still, 'session')} still on it` : `Remove ${id}`;
}
export const MOVE_ONE = 'Move';
export const MOVE_ALL = 'Move all';
export const WAKE_AND_MOVE = 'Wake and move';
/** Live sessions block removal (spec §11.2). */
export const liveBlockText = (id: string, n: number): string =>
  `${plural(n, 'session')} ${n === 1 ? 'runs' : 'run'} on ${id}. Move ${n === 1 ? 'it' : 'them'} off before removing the lane.`;
/** Sleeping sessions are listed apart (N3, D-7733): removing the lane would wake them elsewhere, without their place. */
export const sleepingBlockText = (id: string, n: number): string =>
  `${plural(n, 'session')} on ${id} ${n === 1 ? 'is' : 'are'} asleep. Removing the lane would wake ${n === 1 ? 'it' : 'them'} `
  + `somewhere else without ${n === 1 ? 'its' : 'their'} place in the conversation. Wake and move ${n === 1 ? 'it' : 'them'} first.`;
/** What else the pre-check can hold a removal for, each in words. */
export const removeHeld = {
  authInProgress: (id: string): string => `A sign-in for ${id} is in progress. Cancel the sign-in first.`,
  upstream: (id: string): string => `${id} is the upstream lane every generated lane runs through, so it can't be removed here.`,
  liveUncounted: (id: string): string =>
    `The fleet host couldn't count the live sessions on ${id}, so it can't be removed yet. Read it again.`,
} as const;
/** A wake that failed, before the move (the existing ensure route). */
export const wakeFailed = (sid: string): string => `${sid} couldn't be woken, so it stays asleep on this lane.`;
export const wakingProgress = (i: number, n: number): string => `Waking ${i} of ${n}…`;
/** The pre-check's own failure: nothing was measured, so the button stays off. */
export const removeCheckFailed = (id: string): string =>
  `The fleet host couldn't measure ${id} for removal, so nothing can be removed yet. Read it again.`;
export const READ_IT_AGAIN = 'Read again';
export const READING_LANE = (id: string): string => `Reading ${id} on the fleet host…`;
/** The typed-id confirm (spec §11.5): it must equal the id exactly. */
export const typedConfirmLabel = (id: string): string => `Type ${id} to confirm`;
export const removeConsequence = (id: string): string =>
  `Removing ${id} deletes its credential on the fleet host and everything that runs it. Its config folder and transcripts stay.`;
/** Discard (spec §11.5): one tap with step-up, for a never-enabled lane with no sessions. */
export const DISCARD_LANE = 'Discard this lane';
export const discardLine = (id: string): string =>
  `${id} was never turned on and no session uses it, so it can be discarded without typing its name.`;

type RemoveRefusalWord = Extract<RouteRefusal,
  'live-sessions' | 'sleeping-sessions' | 'upstream' | 'last-home-able' | 'confirm-mismatch' | 'auth-in-progress'
  | 'not-discardable' | 'lane-busy' | 'not-found' | 'unsupported' | 'insecure-origin' | 'unavailable' | 'unmeasured'>;
const REMOVE_REFUSAL_TEXT: Readonly<Record<RemoveRefusalWord, (id: string) => string>> = {
  'live-sessions': (id) => `Sessions still run on ${id}, so nothing was removed. Move them off first.`,
  'sleeping-sessions': (id) => `Sessions are asleep on ${id}, so nothing was removed. Wake and move them first.`,
  upstream: (id) => removeHeld.upstream(id),
  'last-home-able': (id) => `${id} is the only lane that can take new sessions, so nothing was removed. Turn another on first.`,
  'confirm-mismatch': (id) => `The name typed isn't ${id}, so nothing was removed.`,
  'auth-in-progress': (id) => removeHeld.authInProgress(id),
  'not-discardable': (id) => `${id} was turned on once, or a session uses it, so it can't be discarded. Remove it instead.`,
  'lane-busy': (id) => `${id} is busy with another account change. Nothing was removed. Try again in a moment.`,
  'not-found': (id) => `${id} is no longer on this box's roster.`,
  unsupported: () => 'The fleet host needs an update before lanes can be removed here.',
  'insecure-origin': () => "Accounts can't be changed over plain HTTP. Nothing was removed.",
  unavailable: (id) => `The fleet host couldn't run it, so ${id} was not removed.`,
  unmeasured: (id) => `The fleet host couldn't list the sessions on ${id}, so nothing was removed. Try again.`,
};
/** A removal's refusal, from its code alone. `null` for the answers the sheet handles as states of its own
 *  (`step-up-required`, `outcome-unknown`, and a request that never completed). */
export function removeRefusal(id: string, word: string | undefined): string | null {
  if (word === undefined || word === 'step-up-required' || word === 'outcome-unknown') return null;
  if (Object.hasOwn(REMOVE_REFUSAL_TEXT, word)) return REMOVE_REFUSAL_TEXT[word as RemoveRefusalWord](id);
  return CODE_RE.test(word) ? `The fleet host refused (${word}): nothing was removed.` : `The fleet host refused: nothing was removed.`;
}
/** The removal's answer never came: whether it happened is unknown, and the screen reads the roster again. */
export const removeUnknown = (id: string): string =>
  `The fleet host didn't answer in time, so whether ${id} was removed is unknown. Reading the roster again…`;
export const removeStillUnknown = (id: string): string =>
  `The fleet host's accounts couldn't be read either, so whether ${id} was removed is still unknown. Nothing was sent again.`;
export const removedButNoLedger = (id: string): string =>
  `${id} is no longer on the roster, so it was removed, but the fleet host's ledger never arrived. A removal keeps the `
  + "lane's config folder and transcripts on the fleet host.";
export const notRemovedAfterUnknown = (id: string): string => `${id} is still on the roster: it was not removed.`;
export const STEP_UP_AGAIN_REMOVE = "Confirm it's you again, then press it again. Nothing was removed.";

/** The ledger's headings (spec §11.3): built from the verb's answer, never guessed. */
export const LEDGER_HEADS = {
  removed: 'Removed',
  kept: 'Kept on the box',
  rehomed: 'Archived sessions moved to the upstream lane',
  atProvider: 'Still valid at the provider until you revoke it',
  /** The same section when a row's state is not measured (a sign-in, G23): it claims nothing about validity. */
  atProviderUnmeasured: 'At the provider',
} as const;
/** The provider section's heading: the spec's words only when every row is measured still valid. */
export const atProviderHead = (states: readonly string[]): string =>
  (states.every((s) => s === 'still-valid') ? LEDGER_HEADS.atProvider : LEDGER_HEADS.atProviderUnmeasured);
export const removedDone = (id: string): string => `${id} is removed.`;

/** The provider pages a revoke link opens, keyed by the box's word (`AtProviderRow.revokeAt`: the box never answers a
 *  URL). Each with the words the link reads. */
export const REVOKE_PAGES = {
  'claude-code-settings': { href: 'https://claude.ai/settings/claude-code', label: 'claude.ai/settings/claude-code ↗' },
  'claude-account-settings': { href: 'https://claude.ai/settings/account', label: 'claude.ai account settings ↗' },
  'openrouter-keys': { href: 'https://openrouter.ai/keys', label: 'openrouter.ai/keys ↗' },
  'chatgpt-settings': { href: 'https://chatgpt.com/#settings/Security', label: 'chatgpt.com ↗' },
} as const satisfies Readonly<Record<string, { href: string; label: string }>>;

/** One row of "Still valid at the provider" (spec §11.3), by credential kind and the state the box answered. `lead`
 *  comes before the link and `tail` after it. A sign-in's `unmeasured` (G23 not run, the OA1 record) claims neither that
 *  the sign-in ended at Anthropic nor that it is still valid. */
export function atProviderWords(kind: string, state: string, keyHint: string | undefined): { lead: string; tail: string } {
  switch (kind) {
    case 'anthropic-token':
      return { lead: 'The token still works at Anthropic for up to about a year. Revoke it at', tail: "; ccrc can't." };
    case 'anthropic-sign-in':
      return state === 'unmeasured'
        ? { lead: 'Signed out here. Whether that also ended the sign-in at Anthropic is unmeasured. To end it there, sign out other sessions at', tail: '.' }
        : { lead: 'Signed out here; it may still show at claude.ai until it expires. To end it, sign out other sessions at', tail: '.' };
    case 'openrouter-key':
      return {
        lead: 'The key still works at OpenRouter and can still spend credit. Delete it at',
        tail: keyHint === undefined ? '.' : ` (it's the key named after this lane, ${keyHint}).`,
      };
    case 'codex':
      return { lead: 'The ChatGPT sign-in stays authorised. Remove it at', tail: '.' };
    default:
      return { lead: "The key still works at its provider. Revoke it there; ccrc can't.", tail: '' };
  }
}

/** The revoke checklist item (spec §9, §11.3; N6): the operator ticks it; the tick is recorded with no value. */
export const REVOKED_IT = 'I revoked it';
/** The old token's revoke line and item, at the end of every sheet that replaces a token. They name the old token only
 *  when `oldCredentialOf` says `kept` (D-7872 (10)); elsewhere the app knows of no old token, so they ask about any there
 *  was. `old` is `RevokeItem`'s, for its record line. */
export const revokeOldWords = (id: string, old: OldCredential): { lead: string; tail: string; label: string; old: true | 'any' } => ({
  lead: old === 'kept' ? 'Revoke the old token at' : `If ${id} had an old token, revoke it at`,
  tail: " (ccrc can't; it stays valid for up to a year until you do).",
  label: old === 'kept' ? 'I revoked the old token' : 'I revoked any old token',
  old: old === 'kept' ? true : 'any',
});
/** What the record says about the tick (spec §9: "leaving it unticked is allowed, and the full record then says so"). */
export const revokeRecord = (ticked: boolean, old: boolean | 'any'): string => {
  const what = old === 'any' ? 'any old token' : old ? 'old token' : 'token';
  return ticked ? `Record: ${what} marked revoked.` : `Record: ${what} not marked revoked.`;
};
export const REVOKE_NOT_RECORDED = "The tick couldn't be recorded. Try again.";

/** Replace token by paste (spec §9, §6.3): validate-first on the box, the old token kept until the new one passes. That
 *  the lane keeps one is said only when `oldCredentialOf` says `kept` (D-7872 (10)): `add` writes a token lane with no key
 *  file, and a cancelled or expired mint leaves that lane, so a token lane can have no token at all. */
export const NEW_TOKEN_LABEL = 'Paste the new token';
export const replaceIntro = (id: string, old: OldCredential): string =>
  `The new token is checked with Anthropic before anything is saved. ${oldCredentialLine(id, old, `Until it passes, ${id} keeps the token it has.`, noCheckedCredential(id, 'token'))}`;
export const REPLACE_SAVE = 'Replace token';
export const replaceLedger = {
  saving: (id: string): string => `… checking the new token and saving it on ${id}`,
  saved: '✓ New token saved',
} as const;
export const STEP_UP_AGAIN_REPLACE = "Confirm it's you again, then paste the token again. Nothing was changed.";
export const TOKEN_CLEARED_REPLACE = 'The token was cleared when the app went to the background. Paste it again.';
type ReplaceRefusalWord = Extract<RouteRefusal,
  'key-rejected' | 'token-unverified' | 'key-charset' | 'lane-busy' | 'auth-in-progress' | 'not-found' | 'unsupported'
  | 'insecure-origin' | 'unavailable'>;
/** What a refused replacement leaves, by what the app may say of the old token. */
const replaceLeft = (id: string, old: OldCredential): string => oldCredentialLine(id, old, `${id} keeps its old token.`);
const REPLACE_REFUSAL_TEXT: Readonly<Record<ReplaceRefusalWord, (id: string, old: OldCredential) => string>> = {
  'key-rejected': (id, old) => `That token was refused (HTTP 401). ${replaceLeft(id, old)}`,
  'token-unverified': (id, old) =>
    `Anthropic didn't answer, so nothing was saved. ${oldCredentialLine(id, old, `${id} keeps its old token.`, `${id} is as it was.`)} Try again.`,
  'key-charset': (id, old) => `That isn't a token: it holds a line break or a control character, or is too long. ${replaceLeft(id, old)}`,
  'lane-busy': (id) => `${id} is busy with another account change. Nothing was changed. Try again in a moment.`,
  'auth-in-progress': (id) => `A sign-in for ${id} is in progress. Nothing was changed.`,
  'not-found': (id) => `${id} is no longer on this box's roster.`,
  unsupported: () => 'The fleet host needs an update before tokens can be replaced here.',
  'insecure-origin': () => "Accounts can't be changed over plain HTTP. Nothing was changed.",
  unavailable: (id, old) => `The fleet host couldn't run it. ${replaceLeft(id, old)}`,
};
/** A replacement's refusal, from its code and what the app may say of the old token; `null` for step-up and an answer
 *  that never came. */
export function replaceRefusal(id: string, word: string | undefined, old: OldCredential): string | null {
  if (word === undefined || word === 'step-up-required' || word === 'outcome-unknown') return null;
  if (Object.hasOwn(REPLACE_REFUSAL_TEXT, word)) return REPLACE_REFUSAL_TEXT[word as ReplaceRefusalWord](id, old);
  return CODE_RE.test(word) ? `The fleet host refused (${word}). ${replaceLeft(id, old)}` : `The fleet host refused. ${replaceLeft(id, old)}`;
}
export const replaceUnknown = (id: string): string =>
  `The fleet host didn't answer in time, so whether ${id}'s token was replaced is unknown. Check it to see whether the lane works.`;
/** The live sessions when a new credential went in, where the app cannot name what they run on (D-7872 (10)): true
 *  whether or not the lane held an old credential. */
const startedBefore = (n: number): string =>
  `${plural(n, 'session')} on this lane started before this change. Restart ${n === 1 ? 'it' : 'them'} to run on the new credential.`;
/** The live sessions after a replacement (spec §9: a running session keeps the token it started with). */
export const restartLead = (n: number, old: OldCredential): string => (old === 'kept'
  ? `${plural(n, 'session')} on this lane ${n === 1 ? 'keeps' : 'keep'} the old token until ${n === 1 ? 'it restarts' : 'they restart'}.`
  : startedBefore(n));
export const RESTART = 'Restart';
export const RESTARTED = 'restarted';
export const RESTART_FAILED = "couldn't restart";
export const DONE = 'Done';

/** The compromise disclosure (spec §3.11): every step from another device, naming only the providers in the roster. */
export const COMPROMISE_TITLE = 'If this fleet host is ever compromised';
export const COMPROMISE_LEAD = 'Do every step from another device: the fleet host is what is no longer trusted.';
export const compromiseSteps = {
  anthropic: (token: boolean, signIn: boolean): string => `Anthropic: ${[
    token ? "at claude.ai/settings/claude-code, revoke every long-lived token this fleet minted or was given (each lane's "
      + 'stated identity and mint date help find them)' : null,
    signIn ? "at the claude.ai account settings, sign out other sessions for every sign-in lane's account" : null,
  ].filter((x): x is string => x !== null).join('; ')}.`,
  openai: 'OpenAI: at chatgpt.com, end the sessions of every account a Codex lane signed in with.',
  openrouter: 'OpenRouter: delete the management key; then at openrouter.ai/keys disable every key named ccrc … and any '
    + "key you don't recognise; check the balance and activity, and turn off auto top-up until you're done.",
  rebuilt: (codex: boolean): string =>
    `On the rebuilt box: rotate the agent token${codex ? " and every Codex lane's gateway key" : ''}, then add each lane's `
    + 'credential again (Mint a new token, Sign in again, Mint a replacement).',
} as const;

// ── Mint a long-lived token and Sign in with Claude (accounts plan Task A22, D-7849; spec §6.1–§6.3, §12.3–§12.5) ─────
// Every sentence the sign-in says. Each terminal state says what did NOT happen, and each is chosen by a code: the
// helper's state, or a route's `error` word, never the response's text. NO DURATION IS WRITTEN HERE: every deadline,
// countdown and offline sentence reads the attempt's `expiresAt` (spec §3.7, its one source).

/** The sign-in methods' primary on the method frame: the lane is added, then the sign-in starts. */
export const ADD_AND_SIGN_IN = 'Add lane and sign in';

/** A wall-clock time as the sentences show it: 24-hour `HH:MM` on this device's clock. */
export function clockHM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The countdown beside the code field: the deadline's clock and what is left of it, both read from `expiresAt`. */
export function countdownWords(expiresAt: number, now: number): string {
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `Expires at ${clockHM(expiresAt)} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
}

/** Offline mid-attempt (spec §12.5): the time is the LAST-KNOWN `expiresAt`, never one computed from a duration. */
export const signInOffline = (expiresAt: number): string =>
  `The server isn't answering. The sign-in keeps running on the fleet host until ${clockHM(expiresAt)}. Reopen this when you're back online.`;

/** The run frame's ledger for the sign-in (spec §6.2 steps 3–8). */
export const SIGN_IN_LEDGER = {
  creating: (id: string): string => `… creating ${id}`,
  starting: '… starting the sign-in',
  waiting: '… waiting for your code',
  exchanging: '… exchanging the code',
  signedIn: '✓ Signed in on the fleet host',
  minted: '✓ Token minted and stored on the fleet host',
  startUnknown: "… the fleet host didn't answer in time; reading the sign-in",
  signedOut: (id: string, removed: boolean): string =>
    (removed ? `✓ ${id} signed out on this box` : `✓ ${id} had no sign-in on this box to remove`),
} as const;

/** The URL card (spec §6.2 step 5, §6.3, §12.4). */
export const OPEN_TO_SIGN_IN = 'Open claude.ai to sign in';
export const OPEN_LINK = 'Open';
export const COPY_LINK = 'Copy link';
export const COPIED = 'Copied';
/** Which account approves is the browser's claude.ai session (spec §6.3, §12.4): a private tab chooses another. */
export const privateTabLine = (method: 'login' | 'setup-token'): string => (method === 'login'
  ? 'Paste it into a private tab to sign in as a different account.'
  : 'Paste it into a private tab to choose the account.');
export const SIGN_IN_WITH = 'Sign in with the account this lane should use.';
export const COME_BACK = 'Come back here to paste the code.';
export const WHAT_THIS_GRANTS = 'What this grants';
/** The scope Remote Control rides, marked in the disclosure (09-05 §12.6). */
export const REMOTE_CONTROL_SCOPE = 'user:sessions:claude_code';
export const REMOTE_CONTROL_MARK = 'Remote Control';
export const CODE_FIELD_LABEL = 'Paste the code claude.ai shows you';
export const SEND_CODE = 'Send code';
export const CANCEL_SIGN_IN = 'Cancel';
export const START_AGAIN = 'Start the sign-in again';

/** What an account sheet may say about a lane's old credential: `oldCredentialOf`'s answer (connectFlow.ts; D-7872 (10)).
 *  `kept` (a passing check newer than any known sign-out), `signed-out` (certain), or `unsure` (the neutral words). */
export type OldCredential = 'kept' | 'unsure' | 'signed-out';
/** The sign-in's terminal states (spec §6.2), each saying what did not happen. */
export type SignInEndKind = 'expired' | 'code-refused' | 'untrusted' | 'cancelled' | 'unknown' | 'lost' | 'failed'
  | 'node-changed';
export const SIGN_IN_END: { readonly [K in Exclude<SignInEndKind, 'failed'>]: (id: string) => string } = {
  expired: () => 'The sign-in timed out. Nothing was signed in. The lane exists and is off.',
  'code-refused': () => "claude.ai didn't accept that code. Codes work once and expire quickly. Start the sign-in again for a fresh one.",
  untrusted: () => "The sign-in link on the fleet host didn't look like claude.ai, so it isn't shown. Nothing was signed in. Start again, or check the fleet host.",
  cancelled: () => 'Sign-in cancelled. Nothing was stored. The lane is still there, off.',
  unknown: (id) => `The fleet host didn't answer in time, so whether the sign-in for ${id} started is unknown. Nothing was signed in here. Start the sign-in again.`,
  lost: (id) => `The server no longer holds the sign-in for ${id}, so whether it finished is unknown. The lane is still there, off. Start the sign-in again.`,
  'node-changed': () => 'The fleet host answering now is not the one the sign-in started on, so it was stopped. Nothing was signed in.',
};
/** The helper ended the attempt `failed` before any code was sent: its word when it gave a plain one. */
export const signInFailed = (failure: string | undefined): string =>
  `The sign-in stopped on the fleet host before a code was sent${failure !== undefined && CODE_RE.test(failure) ? ` (${failure})` : ''}. Nothing was signed in. The lane is still there, off.`;

type SignInStartWord = Extract<RouteRefusal,
  'auth-in-progress' | 'auth-unsupported-here' | 'method-unmeasured' | 'step-up-required' | 'lane-busy' | 'unmeasured'
  | 'node-changed' | 'not-found' | 'unsupported' | 'insecure-origin' | 'auth-off' | 'unavailable'>;
const SIGN_IN_START_TEXT: Readonly<Record<SignInStartWord, (id: string, reason: string | undefined) => string>> = {
  'auth-in-progress': (id) => `A sign-in for ${id} is already running on the fleet host. Nothing new was started.`,
  'auth-unsupported-here': (_id, reason) =>
    `This fleet host can't run a sign-in${reason !== undefined ? ` (${reason})` : ''}. Nothing was started. Paste a token instead.`,
  'method-unmeasured': () => "This sign-in hasn't been measured on a fleet host yet, so nothing was started.",
  'step-up-required': () => "Confirm it's you again, then start the sign-in again. Nothing was started.",
  'lane-busy': (id) => `${id} is busy with another account change. Nothing was started. Try again in a moment.`,
  unmeasured: () => "The server can't tell which fleet host is answering right now, so nothing was started. Try again in a moment.",
  'node-changed': () => SIGN_IN_END['node-changed'](''),
  'not-found': (id) => `${id} is no longer on this box's roster.`,
  unsupported: () => DOOR_NARROWED.unsupported.text,
  'insecure-origin': () => "Accounts can't be changed over plain HTTP. Nothing was started.",
  'auth-off': () => DOOR_NARROWED['gate-dark'].text,
  unavailable: () => "The fleet host couldn't run it: nothing was started.",
};
/** A start refused with a word (spec §13.1's `auth/start` refusals), from the code alone. `reason` is the body's
 *  `reason` (`auth-unsupported-here`), printed only when it is a plain word. */
export function signInStartRefusal(id: string, word: string, reason: string | undefined): string {
  const r = reason !== undefined && CODE_RE.test(reason) ? reason : undefined;
  if (Object.hasOwn(SIGN_IN_START_TEXT, word)) return SIGN_IN_START_TEXT[word as SignInStartWord](id, r);
  return CODE_RE.test(word) ? `The fleet host refused (${word}): the sign-in was not started.` : 'The fleet host refused: the sign-in was not started.';
}

/** `auth/code`'s answers that leave the attempt standing, each a notice under the code field. */
export const CODE_NOTICE = {
  shape: "That doesn't look like the code claude.ai shows. Nothing was sent: paste it again.",
  notYours: 'This sign-in was started on another device, and only that device can send its code. Cancel it here, or finish it there.',
  unknown: "The code may have reached the fleet host; waiting for its answer. It isn't sent again.",
  unmeasured: "The server can't tell which fleet host is answering right now, so the code wasn't sent. Paste it again in a moment.",
  refused: (word: string | undefined): string => (word !== undefined && CODE_RE.test(word)
    ? `The fleet host refused (${word}): the code wasn't sent. Paste it again.`
    : "The fleet host refused: the code wasn't sent. Paste it again."),
} as const;

/** Cancel was refused and the attempt stands, so Cancel stays. */
export const cancelRefused = (word: string | undefined): string => (word !== undefined && CODE_RE.test(word)
  ? `The fleet host couldn't stop the sign-in (${word}). Press Cancel again.`
  : "The request didn't complete, so the sign-in may still be running. Press Cancel again.");

/** The result frame's wrong-account act (spec §6.2 step 10, §12.4). */
export const WRONG_ACCOUNT = 'Not the account you meant?';
export const SIGN_OUT_RESTART = 'Sign this lane out and start again';
/** A sign-out with no answer, where the box may have signed the lane out: a request that didn't complete, a word that
 *  can't be read, the route's `outcome-unknown` (a timeout, a lost answer, or an output it couldn't read), or its
 *  `lane-act-refused`. That word reaches the route once the verb has removed the credential, when only its report failed
 *  (verb code `no-answer`), and from a killed verb, which leaves no code to read. Anything else is a refusal. */
export const signOutUnknown = (word: string | undefined): boolean =>
  word === 'outcome-unknown' || word === 'lane-act-refused' || !(word !== undefined && CODE_RE.test(word));
export const signOutRefused = (id: string, word: string | undefined): string => (!signOutUnknown(word)
  ? `The fleet host refused (${word}): ${id} was not signed out, and no new sign-in was started.`
  : `The request didn't complete, so whether ${id} was signed out is unknown. No new sign-in was started.`);
export const STEP_UP_AGAIN_SIGN_OUT = "Confirm it's you again, then press it again. Nothing was signed out.";

/** The mint's stated identity (spec §6.3, Q5): optional, 1 to 120 characters, saved with `set {stated}`. */
export const STATED_LABEL = 'Which account did you just approve?';
export const STATED_NOTE = "Optional. A long-lived token can't say which account approved it, so the lane shows what you write here.";
export const SAVE_STATED = 'Save';
export const STATED_PROBLEM = 'One line of text, at most 120 characters.';
export const statedRefused = (word: string | undefined): string => (word !== undefined && CODE_RE.test(word)
  ? `The fleet host refused (${word}): nothing was saved.`
  : "The request didn't complete, so whether it was saved is unknown.");

/** Discard after a terminal state (spec §6.2): its answer. */
export const discardedDone = (id: string): string => `${id} is discarded.`;
export const STEP_UP_AGAIN_DISCARD = "Confirm it's you again, then press it again. Nothing was discarded.";
/** The add of a sign-in lane was refused `step-up-required` (spec §3.2). */
export const STEP_UP_AGAIN_ADD = "Confirm it's you again, then add the lane again. Nothing was added.";
/** What "Sign this lane out and start again" does, said before it runs (N5's sign-out, then a new attempt). On a token
 *  lane the sign-out finds no sign-in, and the new mint's token replaces the lane's once it is approved. */
export const signOutConfirm = (id: string, method: 'login' | 'setup-token'): string => (method === 'login'
  ? `${id} is signed out on the fleet host, then a new sign-in starts. Sign in with the account you meant.`
  : `A new mint starts for ${id}; its token replaces the lane's once you approve it with the account you meant.`);
export const KEEP_IT = 'Keep it';

// ── Resume on any route, and the two method switches (accounts plan Task A23, D-7871; spec §6.2, §9, §4.2, §4.4) ──────
// Every sentence the resume banner, the lane card's resume line and the method switch sheet say. As above, NO DURATION
// IS WRITTEN HERE: the banner's minutes are read from the attempt's `expiresAt`. The OA1 record (2026-11-01) did not
// measure §9 (what a live session does once its lane's sign-in is logged out), so Sign the old sign-in out stays the
// spec's danger confirm while a listed session predates the switch; nor G23, so the sign-out says nothing about the
// provider beyond "unmeasured".

/** The minutes left of an attempt, as the banner says them: whole minutes, rounded up, at least one while it is live. */
export const minutesLeft = (expiresAt: number, now: number): number => Math.max(1, Math.ceil((expiresAt - now) / 60_000));
/** The app-level resume banner (spec §6.2): on any route, for an attempt this session started that waits for its code. */
export const resumeBannerText = (id: string, minutes: number): string =>
  `A sign-in for ${id} is waiting for its code · ${minutes} min left`;
export const CONTINUE = 'Continue';
/** The lane card's line for the same attempt, beside Continue and Cancel. */
export const RESUME_CARD_LINE = 'A sign-in is waiting for its code';

/** The fold's and the trouble card's switch acts (spec §4.2, §4.4, §9; Q1). */
export const SWITCH_TO_TOKEN = 'Switch to a long-lived token';
export const SWITCH_TO_SIGN_IN = 'Switch to sign-in';
export const switchTitle = (id: string, to: 'setup-token' | 'login'): string =>
  (to === 'setup-token' ? `Switch ${id} to a long-lived token` : `Switch ${id} to sign-in`);
/** What the switch does, before it starts (spec §9): nothing changes until the new credential passes its check. It
 *  says the lane keeps the credential it has only when `oldCredentialOf` says `kept` (D-7872 (10)). */
export const switchIntro = (id: string, to: 'setup-token' | 'login', old: OldCredential): string => {
  const from = to === 'setup-token' ? 'sign-in' : 'token';
  if (old === 'kept') {
    return to === 'setup-token'
      ? `A long-lived token is minted for ${id} and checked before anything changes. Until it passes, ${id} keeps its sign-in. `
        + 'Afterwards you sign the old sign-in out here.'
      : `${id} signs in with Claude, and the sign-in is checked before anything changes. Until it passes, ${id} keeps its token.`;
  }
  const lead = to === 'setup-token'
    ? `A long-lived token is minted for ${id} and checked before it is installed.`
    : `${id} signs in with Claude, and the sign-in is checked before it is installed.`;
  return `${lead} ${old === 'signed-out' ? laneSignedOut(id) : noCheckedCredential(id, from)}`;
};
export const SWITCH_START: { readonly [M in 'setup-token' | 'login']: string } = {
  'setup-token': 'Mint the token',
  login: 'Start the sign-in',
};
export const switchLedger = {
  switched: (id: string, to: 'setup-token' | 'login'): string =>
    (to === 'setup-token' ? `✓ ${id} now runs on the long-lived token` : `✓ ${id} now runs on its sign-in`),
} as const;

/** A switch's terminal states (spec §9: "a refused, cancelled or expired attempt leaves the lane exactly as it was"),
 *  each saying what did not happen, from its kind. A lost attempt may have finished, so it claims nothing. That the
 *  lane still uses its old credential is said only when `oldCredentialOf` says `kept` (D-7872 (10)). */
export function switchEnd(id: string, to: 'setup-token' | 'login', kind: SignInEndKind, failure: string | undefined, old: OldCredential): string {
  const keeps = oldCredentialLine(id, old, `Nothing changed: ${id} still uses its ${to === 'setup-token' ? 'sign-in' : 'token'}.`);
  switch (kind) {
    case 'expired': return `The sign-in timed out. ${keeps}`;
    case 'code-refused': return `The new credential wasn't accepted: claude.ai refused the code, or the check of what it gave failed. ${keeps}`;
    case 'untrusted': return `The sign-in link on the fleet host didn't look like claude.ai, so it isn't shown. ${keeps}`;
    case 'cancelled': return `Switch cancelled. ${keeps}`;
    case 'node-changed': return `The fleet host answering now is not the one the sign-in started on, so it was stopped. ${keeps}`;
    case 'unknown': return `The fleet host didn't answer in time, so whether the sign-in started is unknown. ${keeps}`;
    case 'failed':
      return `The sign-in stopped on the fleet host before a code was sent${failure !== undefined && CODE_RE.test(failure) ? ` (${failure})` : ''}. ${keeps}`;
    case 'lost':
      return `The server no longer holds the sign-in for ${id}, so whether the switch finished is unknown. ${old === 'kept'
        ? `Check ${id} to see which credential it uses.` : `Check ${id} to see whether it has a working credential.`}`;
  }
}
export const CLOSE = 'Close';
export const START_SWITCH_AGAIN = 'Start again';

/** After a switch to the token (spec §9): the sessions still on the sign-in, and the old sign-in's sign-out. */
export const switchRestartLead = (n: number, old: OldCredential): string => (old === 'kept'
  ? `${plural(n, 'session')} on this lane ${n === 1 ? 'still uses' : 'still use'} the sign-in until ${n === 1 ? 'it restarts' : 'they restart'}.`
  : startedBefore(n));
export const SIGN_OLD_OUT = 'Sign the old sign-in out';
export const SIGN_OLD_OUT_ANYWAY = 'Sign it out anyway';
/** The danger confirm while a listed session predates the switch (spec §9's words). That it uses the sign-in is said only
 *  on `kept` (D-7872 (10)). */
export const signOldOutDanger = (n: number, id: string, old: OldCredential): string => (old === 'kept'
  ? `${plural(n, 'session')} on ${id} still ${n === 1 ? 'uses' : 'use'} the sign-in and may fail ${n === 1 ? 'its' : 'their'} next turn.`
  : `${plural(n, 'session')} on ${id} started before this change. If ${n === 1 ? 'it still uses' : 'they still use'} the old sign-in, ${n === 1 ? 'it' : 'they'} may fail ${n === 1 ? 'its' : 'their'} next turn.`);
export const STEP_UP_AGAIN_SIGN_OLD_OUT = "Confirm it's you again, then press it again. Nothing was signed out.";
/** The old sign-in's sign-out was refused, or its answer never came: the lane keeps both until it is signed out. */
export const signOldOutRefused = (id: string, word: string | undefined): string => (!signOutUnknown(word)
  ? `The fleet host refused (${word}): ${id}'s old sign-in was not signed out.`
  : `The request didn't complete, so whether ${id}'s old sign-in was signed out is unknown. Press it again.`);
/** Until the old sign-in is signed out, the lane holds both (spec §9's one stated exception to "never two"): said only
 *  when the lane was known to have it (`kept`, D-7872 (10)); otherwise the sign-out is offered for one it may have. */
export const bothHeld = (id: string, old: OldCredential): string => (old === 'kept'
  ? `${id} holds both the new token and its old sign-in until you sign the old one out.`
  : `If ${id} still has its old sign-in on the fleet host, sign it out here.`);
export const SWITCH_CLOSE_TOKEN = "Sessions on this lane won't ask you to sign in again for about a year.";

// ── Re-authenticate an existing Anthropic lane (accounts plan Task A38, D-7872; spec §9 rows 1, 2, §4.2, §4.4) ────────
// Sign in again (a sign-in lane), Mint a new token (a token lane), and the Expiring (minted token) card's Replace token.
// The lane already exists and keeps its method, so nothing here says it was created, is off, or can be discarded: a
// terminal state says the old credential is untouched, from a code, where the app knows the lane has one (D-7872 (10)). The switches' words are A23's (above). NO DURATION
// IS WRITTEN HERE either: every deadline reads `expiresAt`.

/** The acts' words, on the trouble card and the fold (spec §4.2, §4.4). */
export const SIGN_IN_AGAIN = 'Sign in again';
export const MINT_NEW_TOKEN = 'Mint a new token';
/** The re-auth sheet's way over to A19's paste arm, and the paste sheet's way back. */
export const PASTE_INSTEAD = 'Paste a token instead';
export const MINT_INSTEAD = 'Mint a new token instead';

/** What a re-auth replaces, by the method it runs: a sign-in for `login`, a token for `setup-token`. */
const credOf = (method: 'login' | 'setup-token'): 'sign-in' | 'token' => (method === 'login' ? 'sign-in' : 'token');

/** The sheet's title and eyebrow, by the method it runs. */
export const reauthTitle = (id: string, method: 'login' | 'setup-token'): { title: string; eyebrow: string } => (method === 'login'
  ? { title: `Sign ${id} in again`, eyebrow: 'sign in again' }
  : { title: `Replace ${id}'s token`, eyebrow: 'mint a new token' });

/** What happens, said before anything runs: the old credential stays until the new one passes (A20). That the lane keeps
 *  it is said only when `oldCredentialOf` says `kept` (D-7872 (10)); on a lane known to have none (`signed-out`) it says
 *  the lane is signed out, and everywhere else the neutral words, true either way. */
export const reauthIntro = (id: string, method: 'login' | 'setup-token', old: OldCredential): string => {
  if (old !== 'kept') {
    const line = old === 'signed-out' ? laneSignedOut(id) : noCheckedCredential(id, credOf(method));
    return method === 'login'
      ? `A new sign-in runs on the fleet host and is checked before it is installed. ${line}`
      : `A new long-lived token is minted on the fleet host and checked before it is installed. ${line}`;
  }
  return method === 'login'
    ? `A new sign-in runs on the fleet host and is checked before it replaces the old one. Until it passes, ${id} keeps the sign-in it has.`
    : `A new long-lived token is minted on the fleet host and checked before it replaces the old one. Until it passes, ${id} keeps the token it has.`;
};

/** The confirm frame's primary. */
export const reauthStart = (method: 'login' | 'setup-token'): string => (method === 'login' ? SWITCH_START.login : MINT_NEW_TOKEN);

/** The sentence every refused, cancelled or expired attempt ends with. */
export const credentialUntouched = (id: string, method: 'login' | 'setup-token'): string =>
  `Nothing changed: ${id} keeps its old ${credOf(method)}.`;

/** The sentence they end with instead on a lane known to have no credential (D-7872 (2), (10)): one the sheet itself
 *  just signed out with N5's sign-out, or one the box says has none. The lane runs nothing until a new one goes in. */
export const laneSignedOut = (id: string): string =>
  `${id} is signed out on the fleet host, so its sessions fail until it has a sign-in or a token again.`;

/** THE NEUTRAL WORDS (D-7872 (10), the operator's option-1 ruling of 2026-11-03): where the app cannot be sure the lane
 *  still holds a credential (no passing check on record, a 401 since, or a sign-out it knows of), a sheet says what it
 *  knows and claims nothing about the old credential. The precise signed-out words wait on the box and the server
 *  reporting a lane with no credential (a follow-up). */
export const noCheckedCredential = (id: string, cred: 'sign-in' | 'token'): string =>
  `${id} has no checked ${cred}, so whether it still has one isn't known.`;
export const NOTHING_INSTALLED = 'Nothing was installed.';

/** The closing sentence of an attempt that installed nothing, by what the app may say of the old credential: `kept`'s
 *  own sentence, the lane signed out, or the neutral one. */
export const oldCredentialLine = (id: string, old: OldCredential, kept: string, unsure: string = NOTHING_INSTALLED): string =>
  (old === 'kept' ? kept : old === 'signed-out' ? laneSignedOut(id) : unsure);

/** A re-auth's terminal states (spec §9: "A refused, cancelled or expired attempt says the old credential is
 *  untouched"), each from its code. `lost` is the one state that cannot say so: whether the attempt finished is unknown.
 *  `old` is `oldCredentialOf`'s answer (D-7872 (10)): the untouched sentence only on `kept`, the lane signed out on
 *  `signed-out`, and "Nothing was installed." otherwise. */
export function reauthEnd(id: string, method: 'login' | 'setup-token', kind: SignInEndKind, failure: string | undefined, old: OldCredential): string {
  const untouched = oldCredentialLine(id, old, credentialUntouched(id, method));
  switch (kind) {
    case 'expired': return `The sign-in timed out. ${untouched}`;
    case 'code-refused':
      return `claude.ai didn't accept that code. ${untouched} Codes work once and expire quickly. Start again for a fresh one.`;
    case 'untrusted':
      return `The sign-in link on the fleet host didn't look like claude.ai, so it isn't shown. ${untouched}`;
    case 'cancelled': return `Cancelled. ${untouched}`;
    case 'unknown':
      return `The fleet host didn't answer in time, so whether a new sign-in started for ${id} is unknown. ${oldCredentialLine(id, old, `Its old ${credOf(method)} was not replaced here.`, 'Nothing was installed here.')} Start again.`;
    case 'lost':
      return `The server no longer holds the sign-in for ${id}, so whether it finished is unknown. ${old === 'kept'
        ? 'Check the lane to see which credential works.'
        : old === 'signed-out'
          ? `${id} was signed out before it started: check the lane to see whether it has a sign-in now.`
          : 'Check the lane to see whether it has a working credential.'}`;
    case 'node-changed':
      return `The fleet host answering now is not the one the sign-in started on, so it was stopped. ${untouched}`;
    case 'failed':
      return `The sign-in stopped on the fleet host before a code was sent${failure !== undefined && CODE_RE.test(failure) ? ` (${failure})` : ''}. ${untouched}`;
  }
}

/** A start refused with a word: A22's sentence, then what `old` allows of the old credential (D-7872 (10)). `not-found`
 *  says the first alone: the lane has left the roster and a removal signs it out, so it has no old credential to speak
 *  of, as A19's `not-found` has none. */
export const reauthStartRefusal = (id: string, method: 'login' | 'setup-token', word: string, reason: string | undefined, old: OldCredential): string => {
  const refused = signInStartRefusal(id, word, reason);
  return word === 'not-found' ? refused : `${refused} ${oldCredentialLine(id, old, credentialUntouched(id, method))}`;
};

/** The run frame's line once the helper says `done` (A20 installed it after its own check of the new credential). */
export const reauthInstalled = (method: 'login' | 'setup-token'): string => (method === 'login'
  ? '✓ New sign-in checked and installed on the fleet host'
  : '✓ New token minted, checked and installed on the fleet host');

/** The live sessions after it (spec §9): a token is read at a session's start, a sign-in at its next request. */
export const reauthRestartLead = (n: number, method: 'login' | 'setup-token', old: OldCredential): string => (method === 'setup-token'
  ? (old === 'kept'
    ? `${plural(n, 'session')} on this lane ${n === 1 ? 'keeps' : 'keep'} the old credential until ${n === 1 ? 'it restarts' : 'they restart'}.`
    : startedBefore(n))
  : `${plural(n, 'session')} on this lane ${n === 1 ? 'picks' : 'pick'} up the new sign-in at ${n === 1 ? 'its' : 'their'} next request. Restart one if it's stuck on the old error.`);

/** The identity read back differs from the one the lane had (spec §9 row 1): N5's sign-out, then a new attempt. G23 is
 *  unmeasured (the OA1 record), so nothing is said about the provider. */
export const REAUTH_WRONG = 'Not the account this lane had?';
export const reauthWasLine = (old: string): string => `It had ${old}.`;
export const reauthSignOutConfirm = (id: string): string =>
  `${id} is signed out on the fleet host, then a new sign-in starts. Until you finish it, sessions on ${id} fail their next turn. Sign in with the account this lane should use.`;
