import type { FleetState } from './fleetstate.js';

/**
 * The ONLY place ccd argv is constructed. Every route builds its call through
 * this table, and `whitelist-subset.test.ts` enumerates the table against the
 * agent's EXEC_WHITELIST in both directions. An inline array literal at a
 * runner call site is a route the enumeration cannot see, which is exactly how
 * `ws-add`/`ws-rm` shipped whitelisted-out and dead on the fleet with every
 * suite green.
 */
export const CCD_ARGV = {
  start:     (w: string, p: string, wd?: string) => ['start', w, p, ...(wd ? [wd] : [])],
  /** `enable` is `start` plus the systemd enable, and it is what
   *  `POST /api/sessions` sends unless the body says `enable: false`. It is a
   *  separate entry because the two words are separate grants in the agent's
   *  list, and because layer 3 fails if a grant nothing builds is left over. */
  enable:    (w: string, p: string, wd?: string) => ['enable', w, p, ...(wd ? [wd] : [])],
  ensure:    (id: string) => ['ensure', id],
  stopId:    (id: string) => ['stop', id],
  stopPair:  (w: string, p: string) => ['stop', w, p],
  swap:      (id: string, w: string) => ['swap', id, w],
  wsAdd:     (p: string) => ['ws-add', p],
  prStateSession: (id: string) => ['pr-state', '--session', id],
  prStateProject: (p: string)  => ['pr-state', '--project', p],
  prOpen:    (id: string, t: string, b64: string, draft: boolean) =>
               ['pr-open', '--session', id, '--title', t, '--body-b64', b64, '--draft', draft ? 'true' : 'false'],
  wsArchive: (id: string) => ['ws-archive', '--session', id],
  wsRestore: (id: string) => ['ws-restore', '--session', id],
  wsAudit:   (id: string) => ['ws-audit', '--session', id],
  wsReap:    (tok: string, id: string) => ['ws-reap', '--expect', tok, '--session', id],
  wsAttic:   (id: string) => ['ws-attic', '--session', id],
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
