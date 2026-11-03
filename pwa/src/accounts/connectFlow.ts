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
import type { AccountsConnect, RosterWire } from '../../../shared/api';
import { NEEDS_FLEET_UPDATE, PROVIDER_ROWS } from '../fleet/accountWords';

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
const SHEET_RUNS: ReadonlySet<string> = new Set(['anthropic:paste']);
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
