// The connect sheet's decisions (accounts plan Task A18, D-7740; spec §5, §6.1, §12.3). Pure: no React, no network,
// no store. `ConnectSheet` and its frames draw what these answer, and `connect-sheet.test.tsx` holds each one.
//
// WHAT IS NEVER RESTATED HERE. The method radio's order and its default are read from `PROVIDERS[provider].connect`
// (`shared/providers.ts`, whose first member is "the default the connect door opens on"): the default is the first
// member that is not narrowed. The id and label rules are the roster parser's (`newLaneIdProblem`,
// `newLaneLabelProblem`, `shared/roster.ts`), and the folder rule is the verb's (`newLaneConfigSuffix`).
import { isAccountStdin } from '../../../shared/account-argv';
import { PROVIDERS, type ConnectMethod, type ProviderRow } from '../../../shared/providers';
import { HUES, newLaneIdProblem, newLaneLabelProblem, type Hue } from '../../../shared/roster';
import type { AccountsConnect, AccountUsage, LaneWire, RosterWire } from '../../../shared/api';
import { NEEDS_FLEET_UPDATE, PROVIDER_ROWS, type OldCredential, type SignInEndKind } from '../fleet/accountWords';
import { AUTH_TERMINAL_STATES, type AuthStatusState } from '../../../shared/accounts';

/** The providers the door offers, in its order (spec §5: three rows, no "Other"; `compatible` stays CLI in v1): the
 *  keys of the rows' words, so the list and the rows cannot disagree. */
export type DoorProvider = keyof typeof PROVIDER_ROWS;
export const DOOR_PROVIDERS = Object.keys(PROVIDER_ROWS) as DoorProvider[];

/** The cap word each provider needs before the sheet offers it (N4, D-7734). Plain strings, not `AccountCap`: a word a
 *  later wave has not yet appended to `ACCOUNT_CAPS` can never be in `connect.caps`, so its row stays narrowed until
 *  that wave lands. */
export const PROVIDER_CAP: Readonly<Record<DoorProvider, string>> = {
  anthropic: 'account-v2',
  openai: 'account-codex-v1',
  openrouter: 'account-openrouter-v2',
};

/** The cap word each method needs, on top of its provider's (N4, D-7734): the sign-in and the mint ride
 *  `account-auth-v1` (A20), paste the first wave's `account-v2`. */
export const METHOD_CAP: Readonly<Record<ConnectMethod, string>> = {
  'setup-token': 'account-auth-v1',
  login: 'account-auth-v1',
  paste: 'account-v2',
  pkce: 'account-or-pkce-v1',
  'openai-login': 'account-codex-v1',
};

/** The provider and method pairs this build's sheet has steps for. Every other pair the fleet can run reads
 *  `NEEDS_APP_UPDATE` at its Continue rather than starting steps the sheet cannot finish. */
const SHEET_RUNS: ReadonlySet<string> = new Set(['anthropic:paste', 'anthropic:setup-token', 'anthropic:login']);

/** The methods this sheet runs as a sign-in (Task A22, D-7849): an attempt on the box, its URL, and a code pasted back. */
export type SignInMethod = 'setup-token' | 'login';
export const isSignInMethod = (m: string | null): m is SignInMethod => m === 'setup-token' || m === 'login';
export const sheetRuns = (provider: DoorProvider, method: ConnectMethod): boolean => SHEET_RUNS.has(`${provider}:${method}`);

/** One row of a choice: its value, and the reason it narrows in place (`null`: it may be chosen). */
export interface Choice<T> { readonly value: T; readonly narrowed: string | null }

const capsOf = (connect: AccountsConnect | null): readonly string[] => connect?.caps ?? [];

/** The provider rows, each narrowed in place when its cap word is absent. */
export function providerChoices(connect: AccountsConnect | null): Choice<DoorProvider>[] {
  const caps = capsOf(connect);
  return DOOR_PROVIDERS.map((p) => ({ value: p, narrowed: caps.includes(PROVIDER_CAP[p]) ? null : NEEDS_FLEET_UPDATE }));
}

/** The method radio for a provider: in the table's order, each narrowed in place when its cap word is absent, and the
 *  default the first that is not (`null` when every one is narrowed). `table` is injectable so a test can hand it a
 *  table in another order. */
export function methodChoices(
  provider: DoorProvider,
  connect: AccountsConnect | null,
  table: Readonly<Record<DoorProvider, Pick<ProviderRow, 'connect'>>> = PROVIDERS,
): { choices: Choice<ConnectMethod>[]; selected: ConnectMethod | null } {
  const caps = capsOf(connect);
  const providerOk = caps.includes(PROVIDER_CAP[provider]);
  const choices = table[provider].connect.map((m) => ({
    value: m, narrowed: providerOk && caps.includes(METHOD_CAP[m]) ? null : NEEDS_FLEET_UPDATE,
  }));
  return { choices, selected: choices.find((c) => c.narrowed === null)?.value ?? null };
}

/** Which lanes wear each hue, in roster order. */
export function hueWearers(roster: readonly Pick<RosterWire, 'id' | 'hue'>[]): Map<Hue, string[]> {
  const m = new Map<Hue, string[]>(HUES.map((h) => [h, []]));
  for (const r of roster) m.get(r.hue)?.push(r.id);
  return m;
}

/** The default hue for a new lane: the least-used one, ties broken in `HUES` order (spec §5). Never the first free
 *  hue by position alone: a roster that wears every hue once and one twice still gets one of the five worn once. */
export function defaultHue(roster: readonly Pick<RosterWire, 'id' | 'hue'>[]): Hue {
  const worn = hueWearers(roster);
  let best: Hue = HUES[0];
  for (const h of HUES) if (worn.get(h)!.length < worn.get(best)!.length) best = h;
  return best;
}

/** The identity step's reading of an id: empty, or the roster parser's problem against the ids the server holds. */
export function idProblem(id: string, roster: readonly Pick<RosterWire, 'id'>[]): 'empty' | 'bad-id' | 'reserved-id' | 'duplicate-id' | null {
  if (id === '') return 'empty';
  return newLaneIdProblem(id, roster.map((r) => r.id));
}

export const labelProblem = newLaneLabelProblem;

/** Whether a pasted secret may be sent: the one byte rule the route and the verb apply again (spec §3.3's
 *  `key-charset`, `isAccountStdin`): 1 byte to 8 KiB of UTF-8, and no C0 byte or DEL. */
export function secretShapeOk(v: string): boolean {
  return isAccountStdin(new TextEncoder().encode(v));
}

// ── The sign-in's decisions (accounts plan Task A22, D-7849; spec §3.7, §3.8, §6.2) ─────────────────────────────────

/** Where a sign-in stands, read from one status answer or refusal: still running (`live`, with the state the helper
 *  last published), signed in (`done`), or ended, with the terminal kind that says what did not happen. */
export type SignInReading =
  | { readonly kind: 'live'; readonly state: AuthStatusState }
  | { readonly kind: 'done' }
  | { readonly kind: 'end'; readonly end: SignInEndKind; readonly failure?: string };

/** A status answer's reading (`GET …/auth`, spec §6.2). `failed` after the code went is the code refused (spec §6.2's
 *  "Code refused"); before it, the helper stopped on its own. */
export function readStatus(state: AuthStatusState, codeSent: boolean, failure: string | undefined): SignInReading {
  switch (state) {
    case 'done': return { kind: 'done' };
    case 'expired': return { kind: 'end', end: 'expired' };
    case 'cancelled': return { kind: 'end', end: 'cancelled' };
    case 'failed': return codeSent ? { kind: 'end', end: 'code-refused' } : { kind: 'end', end: 'failed', ...(failure !== undefined ? { failure } : {}) };
    default: return { kind: 'live', state };
  }
}

/** A status read's refusal word (or `undefined` for a request that did not complete). `null`: the attempt stands and the
 *  next poll asks again (`unmeasured`: the read failed, or the node is not known for a moment; no answer at all). An
 *  attempt the server no longer holds ended at its deadline (`expired`) or somewhere else (`lost`): which, is read from
 *  the LAST-KNOWN `expiresAt`, never from a duration. */
export function readStatusRefusal(word: string | undefined, now: number, expiresAt: number): SignInReading | null {
  if (word === 'auth-url-untrusted') return { kind: 'end', end: 'untrusted' };
  if (word === 'node-changed') return { kind: 'end', end: 'node-changed' };
  if (word === 'no-auth-attempt') return { kind: 'end', end: now >= expiresAt ? 'expired' : 'lost' };
  return null;
}

/** The scopes the sign-in asks for, read from the URL the SERVER parsed and accepted (spec §6.2 step 5's "What this
 *  grants"): the `scope` parameter's words, in its order, or none when it carries none. */
export function grantScopes(url: string): string[] {
  let scope: string | null = null;
  try { scope = new URL(url).searchParams.get('scope'); } catch { scope = null; }
  return scope === null ? [] : scope.split(/\s+/).filter((w) => w !== '');
}

// ── Resume and the method switches (accounts plan Task A23, D-7871; spec §6.2, §9) ──────────────────────────────────

/** An attempt this session started that the resume banner offers to continue (spec §6.2): `mine`, waiting for its code,
 *  before its deadline, of a method this build's sheets run. The one soonest to expire first, ties by lane id, so the
 *  banner and the screen name the same one. Read from `GET /api/accounts` alone, never from storage or the URL. */
export function resumableAttempt(
  lanes: Readonly<Record<string, LaneWire>> | null, now: number,
): { readonly id: string; readonly held: { attemptId: string; method: SignInMethod; expiresAt: number } } | null {
  let best: { id: string; held: { attemptId: string; method: SignInMethod; expiresAt: number } } | null = null;
  for (const [id, lane] of Object.entries(lanes ?? {})) {
    const a = heldAttemptOf(lane, now);
    if (a === null || lane.authAttempt?.state !== 'waiting-code') continue;
    if (best === null || a.expiresAt < best.held.expiresAt || (a.expiresAt === best.held.expiresAt && id < best.id)) best = { id, held: a };
  }
  return best;
}

/** The attempt the server holds for THIS session on a lane, still before its deadline, in any live state, of a method
 *  this build's sheets run; `null` otherwise (another session's, ended, or none). */
export function heldAttemptOf(
  lane: LaneWire | undefined, now: number,
): { attemptId: string; method: SignInMethod; expiresAt: number } | null {
  const a = lane?.authAttempt;
  if (a === undefined || !a.mine || a.expiresAt <= now || AUTH_TERMINAL_STATES.includes(a.state)) return null;
  const m: string = a.method;
  return isSignInMethod(m) ? { attemptId: a.attemptId, method: m, expiresAt: a.expiresAt } : null;
}

/** Which sheet continues an attempt (spec §9): `setup-token` on a sign-in lane and `login` on a token lane are the two
 *  method switches. The same method as the lane's is a re-auth (Task A38, D-7872) on a lane past its adding
 *  (`pastAdding`, {@link isPastAdding}), and otherwise the connect sheet's sign-in of a lane it added. */
export function resumeSheetFor(
  kind: RosterWire['kind'] | undefined, method: SignInMethod, pastAdding = false,
): 'switch' | 'reauth' | 'connect' {
  if ((method === 'setup-token' && kind === 'sign-in') || (method === 'login' && kind === 'token')) return 'switch';
  return pastAdding ? 'reauth' : 'connect';
}

/** Whether a lane is past its adding (D-7872 (9)): it shows a fact that a lane the connect sheet is still adding never
 *  has. Every new lane starts off (spec: `add` writes the off marker, and only Turn it on, after the sign-in, lifts it),
 *  so such a lane's word is Off, with no check and no 401 marker. Any one of these three says the lane exists already:
 *  - a check in its lane state;
 *  - the 401 marker (`authDead`), which ccd's rescue path writes with no check, so a Signed-out sign-in lane often has
 *    no check at all, and which still holds under Off's precedence;
 *  - a word other than Off: the marker that holds an added lane off is gone, so the lane was turned on.
 *  An Off lane with neither a check nor the 401 marker reads as one being added, unless the box signed it out (D-7992) and
 *  it has been on before: the connect sheet's own Sign this lane out and start again signs out a lane still `adding`, and
 *  that lane stays the connect sheet's, with its Turn it on and its Discard. */
export function isPastAdding(lane: LaneWire | undefined, usage: Pick<AccountUsage, 'authDead'> | null | undefined): boolean {
  if (lane?.check !== undefined || usage?.authDead === true) return true;
  if (lane?.signedOutAt !== undefined && lane.adding !== true) return true;
  return lane !== undefined && lane.state.word !== 'off';
}

/**
 * WHAT A SHEET MAY SAY ABOUT A LANE'S OLD CREDENTIAL (D-7872 (10), the operator's option-1 ruling of 2026-11-03): the
 * one rule, read through `useOldCredential` by every account sheet that speaks of it (the re-auth sheet's intro, endings,
 * refused starts, restart lead and revoke item; the method switch sheet's intro, endings, both-held line, restart leads,
 * danger confirm and revoke item; the paste sheet's intro, refusals, restart lead and revoke item). The box reports both
 * facts on the lane (D-7992): a sign-out it ran, and whether the lane holds a credential, measured there.
 *  - `signed-out`: the lane says so (`signedOutAt`, `no-credential`, or `credential: 'none'`), on any device and after a
 *    reload. A sheet whose sign-out just removed the sign-in knows before the lane is read again (`useOldCredential`).
 *    `none` stands ahead of a passing check: the box writes it only for a file that is the lane's credential
 *    (`laneCredentialOf`), so a lane whose credential ccrc does not read never carries it, and a logout outside ccrc
 *    leaves a check behind.
 *  - `unsure`, whose words are true whether or not the lane holds a credential, on two kinds of lane whose measure cannot
 *    be trusted. A lane a sign-out may have changed, not read since (`unread`, the store's `lanesUnread`): it still shows
 *    what it showed before. And a lane the provider refused (`usage.authDead`, or a check of `auth-dead`): the 401 marker
 *    is written with no lane-state write, so `held` may be from before a logout that caused it, and a token just refused
 *    is not known to stand.
 *  - `kept`: otherwise, the lane holds a credential (`credential: 'held'`), or it has no word (a box too old to measure
 *    it, a lane whose credential ccrc does not read, a sign-in on macOS) and a passing check stands in.
 *  - `unsure` everywhere else.
 */
export function oldCredentialOf(
  lane: LaneWire | undefined,
  usage: Pick<AccountUsage, 'authDead'> | null | undefined,
  unread = false,
): OldCredential {
  if (lane?.signedOutAt !== undefined || lane?.notReadyReason === 'no-credential' || lane?.credential === 'none') return 'signed-out';
  if (unread || usage?.authDead === true || lane?.check?.verdict === 'auth-dead') return 'unsure';
  return lane?.credential === 'held' || lane?.check?.verdict === 'ok' ? 'kept' : 'unsure';
}

/** The method a lane switches TO from its fold (spec §4.4, §9; Q1): a sign-in lane to the long-lived token, a token lane
 *  to the sign-in; `null` for any lane that is not an Anthropic sign-in or token lane. */
export function switchTargetOf(entry: Pick<RosterWire, 'provider' | 'kind'> | undefined): SignInMethod | null {
  if (entry?.provider !== 'anthropic') return null;
  return entry.kind === 'sign-in' ? 'setup-token' : entry.kind === 'token' ? 'login' : null;
}
