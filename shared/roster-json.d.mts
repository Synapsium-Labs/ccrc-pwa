import type { Hue, ExecSpec } from './roster.js';

/**
 * One account as validated by `rosterFromJson` — the flattened shape Task
 * 5's wrapper writer and `deploy/gen-accounts.mjs`'s emitter both consume
 * structurally. `execKind` and `secretsFile` are `checkAccount`'s own
 * projection of `shared/roster.ts`'s nested `exec: ExecSpec` (D-75, closed
 * by the move to this file); every other field matches `AccountDef`
 * one-for-one.
 */
export interface RosterJsonAccount {
  id: string;
  label: string;
  configDirSuffix: string;
  homeAble: boolean;
  telemetry: 'anthropic' | 'none';
  hue: Hue;
  execKind: ExecSpec['kind'];
  /** Present only when the roster declared one; `undefined` otherwise —
   *  including whenever `execKind` is not `'generated'`. */
  secretsFile: string | undefined;
}

/**
 * The `Roster`-shaped object `shared/generate.mjs`'s `generateAccountsSh`
 * consumes structurally, computed from already-`JSON.parse`d roster data by
 * a bare `node` that cannot import `shared/roster.ts`'s `parseRoster`. See
 * `shared/roster-json.mjs`'s header for why this validates independently,
 * and the asymmetry — stricter than `parseRoster`, never laxer — that keeps
 * the two in agreement.
 */
export interface RosterJson {
  version: 1;
  /** Declaration order, preserved. */
  accounts: RosterJsonAccount[];
  /** `homeAble` accounts, declaration order preserved. */
  homeAble: RosterJsonAccount[];
  /** Longest-`id`-first, `id` ascending as the tie-break — see
   *  `shared/roster.ts`'s `Roster.byIdLengthDesc` for why the tie-break is
   *  load-bearing rather than decorative. */
  byIdLengthDesc: RosterJsonAccount[];
  /** The id of the one account with `execKind === 'upstream'`. */
  upstreamId: string;
}

/**
 * Thrown by `rosterFromJson`. `remedy` is set on every throw — the same
 * contract `shared/roster.ts`'s `RosterError` carries on the TypeScript
 * side.
 */
export class RosterInvalid extends Error {
  remedy: string;
}

/**
 * Validates and derives a `Roster`-shaped object from already-parsed JSON —
 * the bare-`node` mirror of `shared/roster.ts`'s `parseRoster`, for callers
 * that cannot import TypeScript (`deploy/gen-accounts.mjs`, and Task 5's
 * wrapper generator). May be STRICTER than `parseRoster`, never laxer — see
 * `shared/roster-json.mjs`'s header.
 *
 * @throws {RosterInvalid}
 */
export function rosterFromJson(json: unknown): RosterJson;
