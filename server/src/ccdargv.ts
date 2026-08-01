import type { FleetState } from './fleetstate.js';

declare const CcdArgvBrand: unique symbol;

/**
 * A ccd argv that provably came from `CCD_ARGV`. The brand is phantom — it
 * exists only in the type system — so this costs nothing at runtime, and an
 * ordinary `string[]` (however it was built or named) is not assignable to it.
 * That is the whole mechanism: layer 2b of `whitelist-subset.test.ts` used to
 * police this by scanning source text and was defeated in four consecutive
 * rounds by four different ways of naming a value (inline literal, extracted
 * const, aliased runner, renamed identifier). A text scan over a
 * Turing-complete language cannot enumerate the ways to name a value; a type
 * does not have to. See task 13S.
 */
export type CcdArgv = readonly string[] & { readonly [CcdArgvBrand]: true };

/**
 * The ONLY place a `string[]` becomes a `CcdArgv`, and it lives in the file
 * whose entire job is building them. Every entry in `CCD_ARGV` returns through
 * here, and nothing outside this file can mint one — which is what makes
 * `Deps.runCcd`'s parameter type a proof of origin rather than a hint.
 */
const argv = (parts: readonly string[]): CcdArgv => parts as CcdArgv;

/**
 * The ONLY place ccd argv is constructed. Every route builds its call through
 * this table, and `whitelist-subset.test.ts` enumerates the table against the
 * agent's EXEC_WHITELIST in both directions. An argv the enumeration cannot see
 * is exactly how `ws-add`/`ws-rm` shipped whitelisted-out and dead on the fleet
 * with every suite green — so there is deliberately no other way to obtain the
 * `CcdArgv` that `Deps.runCcd` demands.
 */
export const CCD_ARGV = {
  start:     (w: string, p: string, wd?: string) => argv(['start', w, p, ...(wd ? [wd] : [])]),
  /** `enable` is `start` plus the systemd enable, and it is what
   *  `POST /api/sessions` sends unless the body says `enable: false`. It is a
   *  separate entry because the two words are separate grants in the agent's
   *  list, and because layer 3 fails if a grant nothing builds is left over. */
  enable:    (w: string, p: string, wd?: string) => argv(['enable', w, p, ...(wd ? [wd] : [])]),
  ensure:    (id: string) => argv(['ensure', id]),
  stopId:    (id: string) => argv(['stop', id]),
  stopPair:  (w: string, p: string) => argv(['stop', w, p]),
  swap:      (id: string, w: string) => argv(['swap', id, w]),
  wsAdd:     (p: string) => argv(['ws-add', p]),
  prStateSession: (id: string) => argv(['pr-state', '--session', id]),
  prStateProject: (p: string)  => argv(['pr-state', '--project', p]),
  prOpen:    (id: string, t: string, b64: string, draft: boolean) =>
               argv(['pr-open', '--session', id, '--title', t, '--body-b64', b64, '--draft', draft ? 'true' : 'false']),
  wsArchive: (id: string) => argv(['ws-archive', '--session', id]),
  wsRestore: (id: string) => argv(['ws-restore', '--session', id]),
  wsAudit:   (id: string) => argv(['ws-audit', '--session', id]),
  wsReap:    (tok: string, id: string) => argv(['ws-reap', '--expect', tok, '--session', id]),
  wsAttic:   (id: string) => argv(['ws-attic', '--session', id]),
} as const;

/**
 * Whether the DEPLOYED ccd on the fleet host implements this argv's verb, per
 * the `ccd caps` list the agent advertised at handshake. `ccdVerbs === null`
 * means we have no evidence (local mode, or an agent old enough not to send
 * it) and permits everything — an absent list must never grey out the fleet.
 */
export function verbSupported(
  state: Pick<FleetState, 'ccdVerbs'> | undefined,
  argv: readonly string[],
): boolean {
  const verbs = state?.ccdVerbs ?? null;
  if (verbs === null) return true;
  return verbs.includes(argv[0] ?? '');
}
