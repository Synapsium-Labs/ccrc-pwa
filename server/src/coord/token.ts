import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

/** The header every box->server POST carries. Lowercase because Fastify
 *  normalises incoming header names, and a mixed-case constant here would read
 *  as if the case mattered. */
export const MAIL_TOKEN_HEADER = 'x-ccrc-mail-token';

/**
 * The box token, off this box's own disk.
 *
 * WHY A FILE AND NOT AN ENV VAR (plan deviation D-4). `deploy/ccrc.service` has
 * no `EnvironmentFile=` line and `deploy.sh:103` copies it over the installed
 * unit on every server deploy, so an env-var token would either be inert or
 * would require editing a unit whose live environment this repo cannot see —
 * and `ccrc.env.example` ships `CCRC_FLEET=local`, which is not what the live
 * server is running. A file needs no unit change at all.
 *
 * `readFileSync`, at the composition root, deliberately: this is local-box
 * housekeeping and never crosses `FleetIO` — the same stance `fleetstate.ts`
 * takes for the degraded-mode cache. `~/.cc-secrets/` on the FLEET host is not
 * even readable through the agent (`agent/src/whitelist.ts:82-88` lists
 * `.cc-sessions`, `.cc-limits`, `.cc-clips`, `.claude*` and the projects root —
 * `.cc-secrets` is on none of them), which is the structural reason the two
 * boxes each hold their own copy of the same secret rather than one reading the
 * other's.
 */
export function readMailToken(tokenPath: string): string | null {
  try {
    const v = readFileSync(tokenPath, 'utf8').trim();
    return v === '' ? null : v;
  } catch {
    return null;   // absent is a configuration state, not an error
  }
}

/**
 * `'ok' | 'legacy' | 'bad'`.
 *
 * `'legacy'` is the operator ruling's one-deploy-generation tolerance
 * (spec:150-155): a fleet host still running yesterday's `notify.sh` presents
 * NO token, and the hook must not go dark between the server deploy and the
 * agent deploy. A caller that presents a token and gets it WRONG has no such
 * excuse and is refused.
 *
 * REMOVE THE TOLERANCE ONE DEPLOY AFTER THIS SHIPS. It is not a permanent
 * accommodation: while it stands, the ingress is still open to anything on the
 * tailnet, which is the hole this whole task exists to close. The README's
 * coordination section names the deploy that removes it.
 *
 * `timingSafeEqual` needs equal lengths, so the length check comes first and
 * leaks only the length — which a caller can measure anyway by sending one.
 */
export function checkMailToken(expected: string | null, presented: unknown): 'ok' | 'legacy' | 'bad' {
  if (expected === null) return 'ok';                 // unconfigured: nothing to check against
  if (presented === undefined || presented === null || presented === '') return 'legacy';
  if (typeof presented !== 'string') return 'bad';
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return 'bad';
  return timingSafeEqual(a, b) ? 'ok' : 'bad';
}
