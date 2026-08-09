import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

/** The header every box->server POST carries. Lowercase because Fastify
 *  normalises incoming header names, and a mixed-case constant here would read
 *  as if the case mattered. */
export const MAIL_TOKEN_HEADER = 'x-ccrc-mail-token';

/**
 * Pulls the token VALUE out of raw file content: the first line that is
 * neither blank nor a `#`-comment, with ALL whitespace stripped from it (not
 * just the edges).
 *
 * THIS RULE, AND ONLY THIS RULE, IS ALSO WHAT `deploy/notify.sh` RUNS OVER
 * ITS OWN COPY OF THE SAME FILE. Fix-round finding 1: before this, the server
 * normalised with `.trim()` (edges only) while `notify.sh` normalised with
 * `tr -d '[:space:]'` (everywhere) — the character CLASS matched but the
 * SCOPE did not, so any file content with INTERIOR whitespace produced two
 * different secrets from one committed file. That content is the likely one:
 * `deploy/ccrc-mail.token.example` ships as a multi-line `#`-comment block
 * (interior newlines and spaces throughout) above its one value line, and its
 * own first line teaches `cp deploy/ccrc-mail.token.example
 * deploy/ccrc-mail.token && edit` — the exact flow that a scope mismatch
 * turns into a silent, total ingress outage (`checkMailToken` calls the
 * resulting length mismatch `'bad'`, and both `notify.sh` and the fleet-side
 * curl swallow the failure).
 *
 * Skipping `#`-comment lines is what lets `ccrc-mail.token.example` carry
 * that comment preamble and still resolve to exactly one value — the line
 * below it — on both boxes, rather than the whole blob.
 */
function extractToken(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const v = t.replace(/\s+/g, '');
    return v === '' ? null : v;
  }
  return null;
}

/** Thrown when the token file EXISTS but carries no extractable value: 0
 *  bytes, whitespace only, or every line a `#`-comment (the value line
 *  deleted, or the whole file truncated mid-rotation). Fix-round finding 4:
 *  this is PRESENT-but-unusable, the same class of state the non-`ENOENT`
 *  arm below already refuses to collapse into "never configured", and for
 *  the identical reason — `checkMailToken(null, …)` returns `'ok'` for every
 *  presented value, so answering `null` here would disarm the whole gate a
 *  truncated `openssl rand -hex 32 > …` redirect could trigger with nothing
 *  red anywhere. Deliberately NOT caught anywhere: `index.ts` lets it kill
 *  the process, the same stance `coord/db.ts`'s `CoordDbUnmigratable` takes
 *  for a 0-byte `coord.db` (Task 2/D-24 is the precedent this mirrors — a
 *  refusal, not a default). NOT what an un-edited `ccrc-mail.token.example`
 *  copy produces — that file ships one placeholder value line specifically
 *  so its SHAPE always extracts (see the file's own comment for why shipping
 *  the placeholder ITSELF is still an operator mistake, just a different,
 *  visible one this class does not catch). */
export class MailTokenFileUnusable extends Error {}

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
  let raw: string;
  try {
    raw = readFileSync(tokenPath, 'utf8');
  } catch (err) {
    // ABSENT (`ENOENT`) is the one fail-open the spec actually grants
    // (spec:150-155: a box that has never been given a token keeps working,
    // unauthenticated, and `index.ts` says so once at boot). Anything else —
    // `EACCES`, `EISDIR`, `ELOOP`, `EIO` — means the token is PRESENT and this
    // box cannot prove it, which is a different state and must not collapse
    // into the same `null` a caller cannot distinguish from "never
    // configured": `checkMailToken(null, …)` returns `'ok'` for every
    // presented value, so silently returning `null` here would disarm the
    // whole gate a chmod, a bad `chown` after a box rebuild, or a unit that
    // gains a `User=` drop-in could trigger with nothing red anywhere (fix-
    // round finding: readMailToken fails open on an unreadable token file).
    // `coord/db.ts`'s `CoordDbUnmigratable` is the precedent for refusing
    // loudly rather than starting in a state nobody asked for — this throws
    // for the same reason, uncaught, so `index.ts` fails to boot rather than
    // opening the tailnet ingress silently.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const token = extractToken(raw);
  if (token === null) {
    throw new MailTokenFileUnusable(
      `${tokenPath} exists but carries no usable token (0 bytes, whitespace only, or every line is ` +
      'a #-comment). This is PRESENT but unusable, not "never configured": see coord/token.ts.');
  }
  return token;
}

/**
 * `'ok' | 'legacy' | 'bad'`.
 *
 * `'legacy'` means "no token was presented" and is deliberately its OWN
 * state rather than folded into `'bad'` — but it is NOT, by itself, a
 * license to proceed. It is a tri-state precisely because exactly ONE
 * caller, `/api/notify`, is granted a tolerance for it: the operator
 * ruling's one-deploy-generation window (spec:150-155), because a fleet host
 * still running yesterday's `notify.sh` presents NO token and the hook must
 * not go dark between the server deploy and the agent deploy.
 *
 * FIX-ROUND FINDING 3/5: `/api/mail` and `/api/mail/:id/ack` are NOT
 * grantees of that tolerance and must treat `'legacy'` the same as `'bad'`.
 * The spec scopes the rollout tolerance to `/api/notify` by name
 * (spec:150-155) and separately lists `unauthenticated` as one of
 * `/api/mail`'s own typed, total rejection codes with no tolerance carved
 * out (spec:136-148) — and the reason the tolerance exists at all ("the hook
 * cannot go dark mid-rollout") cannot apply to a route with zero pre-existing
 * deployed callers, which `/api/mail` is in this very build. A caller that
 * presents a token and gets it WRONG has no rollout excuse either and is
 * refused the same way.
 *
 * REMOVE `/api/notify`'S TOLERANCE ONE DEPLOY AFTER THIS SHIPS. It is not a
 * permanent accommodation: while it stands, that one ingress is still open to
 * anything on the tailnet, which is the hole this whole task exists to close.
 * The README's coordination section names the deploy that removes it.
 * `/api/mail` never had the hole open, so it has nothing to remove.
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
