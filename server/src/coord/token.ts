import { readFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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
 *
 * Exported since the box-token lifecycle (Task A3): `token/files.ts`'s measured
 * read extracts with this same rule rather than spelling it a second time.
 */
export function extractToken(raw: string): string | null {
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
 *  the identical reason — `checkMailToken(null, …)` answers `'unconfigured'`,
 *  which `/api/notify` treated as a pass-through until the box-token lifecycle
 *  removed it, so answering `null` here would have disarmed THAT gate too on a
 *  truncated `openssl rand -hex 32 > …` redirect, with nothing red anywhere.
 *  Deliberately NOT caught anywhere:
 *  `index.ts` lets it kill the process, the same stance `coord/db.ts`'s
 *  `CoordDbUnmigratable` takes for a 0-byte `coord.db` (Task 2/D-24 is the precedent this mirrors — a
 *  refusal, not a default). NOT what an un-edited `ccrc-mail.token.example`
 *  copy produces — that file ships one placeholder value line specifically
 *  so its SHAPE always extracts; see `MailTokenPlaceholderUnedited` below for
 *  the class that now catches THAT mistake instead (review finding 13 closed
 *  the "different, visible one this class does not catch" gap this comment
 *  used to leave open — it was not, in fact, visible anywhere). */
export class MailTokenFileUnusable extends Error {}

/** The exact placeholder value `deploy/ccrc-mail.token.example` ships on its
 *  one value line (see that file's own comment). Exported so
 *  `coord-token.test.ts` can pin it against the shipped example file rather
 *  than re-typing the string a second time. */
export const PLACEHOLDER_TOKEN = 'REPLACE-THIS-LINE-WITH-THE-OUTPUT-OF-openssl-rand--hex-32';

/**
 * Thrown when the token file's one extracted value is, byte for byte, the
 * placeholder `deploy/ccrc-mail.token.example` ships (review finding 13):
 * copying the example to `deploy/ccrc-mail.token` without editing it —
 * `cp deploy/ccrc-mail.token.example deploy/ccrc-mail.token`, the example's
 * own line 1 — is the ONE mistake that file's comment calls out by name
 * ("DO NOT SHIP THE PLACEHOLDER BELOW AS-IS"), and until this class existed
 * nothing in this tree checked for it: the placeholder's SHAPE is
 * deliberately a normal-looking value line (`extractToken` always resolves
 * it, by the same file comment's own design), so `readMailToken` accepted it,
 * `checkMailToken` returned `'ok'` for it, and every observable signal —
 * boot log, `/api/mail`, `/api/notify` — said the coordination ingress was
 * authenticated. It was not: that placeholder is committed to a public repo,
 * so it authenticates nobody. The polarity finding 13 named: a token file
 * that is EMPTY (`MailTokenFileUnusable` above) is the less dangerous
 * mistake and already refuses to boot; a token file that is the WRONG,
 * PUBLISHED value is strictly more dangerous and must refuse at least as
 * loudly, not more quietly. Deliberately NOT caught anywhere — the same
 * "index.ts lets it kill the process" stance `MailTokenFileUnusable` takes,
 * for the same reason: a warning an operator can miss is exactly what let
 * this ship silently in the first place. */
export class MailTokenPlaceholderUnedited extends Error {}

/**
 * The box token, off this box's own disk.
 *
 * WHY A FILE AND NOT AN ENV VAR (plan deviation D-4). When D-4 was taken,
 * `deploy/ccrc.service` had no `EnvironmentFile=` line (it has since gained two
 * optional ones, `ccrc.env` then `exposure.env`) and `deploy.sh` copied it over
 * the installed unit on every server deploy, so an env-var token would have been
 * inert or needed a unit edit this repo could not see — and `ccrc.env.example`
 * ships `CCRC_FLEET=local`. The token stayed a file: it needs no unit change.
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
    // ABSENT (`ENOENT`) is a real configuration state, not this function's
    // opinion on whether anything is entitled to ride it open — that
    // decision belongs to `checkMailToken`'s CALLERS (fix-round finding 3 /
    // D-39 corrects an earlier version of this comment that cited
    // spec:150-155 as if it settled the question here; that passage grants a
    // rollout tolerance for an ABSENT TOKEN IN A CALLER'S REQUEST to
    // `/api/notify` specifically — it says nothing about a server that was
    // never given a token file at all, and `/api/mail`/`/api/mail/:id/ack`
    // now fail SHUT on exactly this `null`, see `checkMailToken`'s
    // `'unconfigured'` verdict below). Anything else — `EACCES`, `EISDIR`,
    // `ELOOP`, `EIO` — means the token is PRESENT and this box cannot prove
    // it, which is a different state and must not collapse into the same
    // `null` as "never configured": before this fix, `checkMailToken(null,
    // …)` returned `'ok'` for every presented value on every route, so
    // silently returning `null` here would disarm the whole gate a chmod, a
    // bad `chown` after a box rebuild, or a unit that gains a `User=`
    // drop-in could trigger with nothing red anywhere. `coord/db.ts`'s
    // `CoordDbUnmigratable` is the precedent for refusing loudly rather than
    // starting in a state nobody asked for — this throws for the same
    // reason, uncaught, so `index.ts` fails to boot rather than opening the
    // tailnet ingress silently.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const token = extractToken(raw);
  if (token === null) {
    throw new MailTokenFileUnusable(
      `${tokenPath} exists but carries no usable token (0 bytes, whitespace only, or every line is ` +
      'a #-comment). This is PRESENT but unusable, not "never configured": see coord/token.ts.');
  }
  // Review finding 13: the placeholder extracts cleanly — that is the whole
  // problem — so nothing short of an explicit equality check can tell it
  // apart from a real secret.
  if (token === PLACEHOLDER_TOKEN) {
    throw new MailTokenPlaceholderUnedited(
      `${tokenPath} still carries deploy/ccrc-mail.token.example's placeholder value, verbatim — the ` +
      'ONE edit that file itself says is required ("DO NOT SHIP THE PLACEHOLDER BELOW AS-IS"). That ' +
      'placeholder is committed to this public repo, so it authenticates nobody. Refusing to start ' +
      'rather than silently opening /api/mail and /api/notify to anything on the tailnet that has ' +
      'read the source: mint a real value with `openssl rand -hex 32` and put it on this file\'s one ' +
      'value line.');
  }
  return token;
}

/** The accept-set's five slots, in the fixed order every match compares them
 *  (box-token lifecycle spec 4.3). */
export type TokenSlot = 'current' | 'pending0' | 'pending1' | 'pending2' | 'previous';
/** Five slots since D-4413: the third pending slot exists only for the pending cap's exit (a forward rotation staged
 *  while both cap values are past `confirmBy`). `token/policy.ts`'s `PENDING_HARD_CAP` is the count of the three. */
export const TOKEN_SLOTS: readonly TokenSlot[] = ['current', 'pending0', 'pending1', 'pending2', 'previous'];

const PENDING_SLOTS = TOKEN_SLOTS.filter((s) => s.startsWith('pending')).length;

/** What the driver and the boot hand the holder: the values themselves, never
 *  their digests (those are the holder's own, in memory only). */
export interface HolderSlots {
  current: string | null;
  /** At most three (`PENDING_HARD_CAP`); a fourth is a programming error and throws. */
  pending: readonly { id: string; value: string }[];
  /** `until` is the hard bound (ms since the epoch); at and after it the slot
   *  compares a dummy. The driver removes the slot at retirement. */
  previous: { value: string; until: number } | null;
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** One random 32-byte dummy per slot, per process. An empty slot compares one of
 *  these, so an empty slot costs the same compare as a filled one and matches
 *  nothing: never the digest of '' or of any value a caller can send. Never
 *  persisted, never printed. */
const SLOT_DUMMIES: readonly Buffer[] = TOKEN_SLOTS.map(() => randomBytes(32));

/** The retired-presentation warning's cap: at most one line a minute. */
const RETIRED_WARN_EVERY_MS = 60_000;

/**
 * The index of the first slot equal to `presented`, or -1. CONSTANT TIME over
 * the slots: every slot is compared on every call, and each result is folded
 * into numbers with `|=`, so neither which slot matched nor whether any did
 * changes how many compares run. The combine below carries no `||`, `&&`,
 * `||=`, `&&=`, ternary, `return`, `break`, `some` or `find`;
 * `coord-token.test.ts` scans the region between its two markers for each.
 * Every slot and `presented` must be the same length (sha256 digests, 32
 * bytes), which `timingSafeEqual` requires. `compare` is injected by tests to
 * count calls.
 */
export function matchDigestSlots(presented: Buffer, slots: readonly Buffer[],
  compare: (a: Buffer, b: Buffer) => boolean = timingSafeEqual): number {
  let index = 0;
  let found = 0;
  // combine:begin
  for (let i = 0; i < slots.length; i++) {
    const hit = Number(compare(presented, slots[i]!));
    index |= (i + 1) * (hit & (found ^ 1));
    found |= hit;
  }
  // combine:end
  return index - 1;
}

/**
 * The box token's accept-set, held in memory and mutated in place by the boot
 * and the driver, so every lane that reads `deps.mailToken ?? null` at request
 * time sees a rotation with no restart (spec 4.2). It holds the five values and
 * their sha256 digests; the digests are recomputed by {@link setSlots} and never
 * written anywhere. It records which slot matched (for the console's "previous
 * still presented" count and the grace rule); that record never promotes
 * anything. It also holds the retired digests (`box-token-retired.json`), so a
 * value the accept-set refuses can be recognised as retired and counted per lane.
 */
export class BoxTokenHolder {
  private readonly now: () => number;
  private readonly compare: (a: Buffer, b: Buffer) => boolean;
  private slots: HolderSlots = { current: null, pending: [], previous: null };
  private digests: Buffer[] = [...SLOT_DUMMIES];
  private retired: Buffer[] = [];
  private readonly matched: Record<TokenSlot, number> = { current: 0, pending0: 0, pending1: 0, pending2: 0, previous: 0 };
  private retiredTotal = 0;
  private readonly retiredLanes: Record<string, number> = {};
  private lastRetiredWarnAt: number | null = null;

  constructor(opts: { now?: () => number; compare?: (a: Buffer, b: Buffer) => boolean } = {}) {
    this.now = opts.now ?? Date.now;
    this.compare = opts.compare ?? timingSafeEqual;
  }

  setSlots(s: HolderSlots): void {
    if (s.pending.length > PENDING_SLOTS) throw new RangeError(`BoxTokenHolder: at most ${PENDING_SLOTS} pending generations`);
    this.slots = { current: s.current, pending: [...s.pending], previous: s.previous };
    const p0 = s.pending[0];
    const p1 = s.pending[1];
    const p2 = s.pending[2];
    this.digests = [
      s.current === null ? SLOT_DUMMIES[0]! : sha256(s.current),
      p0 === undefined ? SLOT_DUMMIES[1]! : sha256(p0.value),
      p1 === undefined ? SLOT_DUMMIES[2]! : sha256(p1.value),
      p2 === undefined ? SLOT_DUMMIES[3]! : sha256(p2.value),
      s.previous === null ? SLOT_DUMMIES[4]! : sha256(s.previous.value),
    ];
  }

  setRetired(digestsHex: readonly string[]): void {
    const bufs = digestsHex.map((d) => Buffer.from(d, 'hex'));
    // A round trip, not a regex: a sha256 digest is 32 bytes whose lowercase hex
    // is exactly the string given (a malformed entry decodes short or differently).
    bufs.forEach((b, i) => {
      if (b.length !== 32 || b.toString('hex') !== digestsHex[i]) {
        throw new RangeError('BoxTokenHolder: a retired digest is not a lowercase sha256 hex digest');
      }
    });
    this.retired = bufs;
  }

  hasCurrent(): boolean { return this.slots.current !== null; }

  /** The claim door's value source: memory, never the pending file. */
  pendingValue(id: string): string | null {
    return this.slots.pending.find((p) => p.id === id)?.value ?? null;
  }

  /** For the both-role writer and the retirement self-check only. */
  currentValue(): string | null { return this.slots.current; }

  /** The slot `presented` matches, or null. All five slots are compared every
   *  time; the previous slot compares its dummy at and after its hard bound. */
  match(presented: string): TokenSlot | null {
    const prev = this.slots.previous;
    const live = prev !== null && this.now() < prev.until
      ? this.digests
      : [this.digests[0]!, this.digests[1]!, this.digests[2]!, this.digests[3]!, SLOT_DUMMIES[4]!];
    const i = matchDigestSlots(sha256(presented), live, this.compare);
    if (i < 0) return null;
    const slot = TOKEN_SLOTS[i]!;
    this.matched[slot]++;
    return slot;
  }

  isRetired(presented: string): boolean {
    return matchDigestSlots(sha256(presented), this.retired, this.compare) >= 0;
  }

  /** Counts one retired presentation against `lane` and warns at most once a
   *  minute, naming the lane and the counts. The value, its digest and the
   *  caller are never printed (proxy trust is none, so every caller has the
   *  proxy's address). */
  noteRetiredPresented(lane: string): void {
    this.retiredTotal++;
    this.retiredLanes[lane] = (this.retiredLanes[lane] ?? 0) + 1;
    const now = this.now();
    if (this.lastRetiredWarnAt !== null && now - this.lastRetiredWarnAt < RETIRED_WARN_EVERY_MS) return;
    this.lastRetiredWarnAt = now;
    console.warn(`ccrc-server: box token: a retired value was presented on ${lane} ` +
      `(${this.retiredLanes[lane]} on this lane, ${this.retiredTotal} in all since boot); it was refused`);
  }

  counters(): { matched: Record<TokenSlot, number>; retired: number; retiredByLane: Readonly<Record<string, number>> } {
    return { matched: { ...this.matched }, retired: this.retiredTotal, retiredByLane: { ...this.retiredLanes } };
  }
}

/**
 * `'ok' | 'legacy' | 'bad' | 'unconfigured'`.
 *
 * `'legacy'` means "no token was presented, but the server HAS one" and is
 * deliberately its own state rather than folded into `'bad'` — but it is
 * NOT a license to proceed for ANY caller. It became a state because exactly
 * ONE caller, `/api/notify`, was once granted a tolerance for it: the
 * operator ruling's one-deploy-generation window (spec:150-155), because a
 * fleet host still running yesterday's `notify.sh` presented NO token. That
 * tolerance is removed (see REMOVED below); every caller now refuses it.
 *
 * `'unconfigured'` means "the server itself was never given a token"
 * (`expected === null`) and is ALSO its own state, split out from `'ok'`
 * (fix-round finding 3 / D-39): before this split, `expected === null`
 * returned `'ok'` unconditionally, for ANY presented value, on every route
 * that calls this function — so `/api/mail` and `/api/mail/:id/ack` (which
 * have no `'legacy'` tolerance of their own, see below) ran fully
 * unauthenticated, past their `verdict !== 'ok'` gate, the moment a
 * `deploy/ccrc-mail.token` file was never minted — reachable by omission
 * (a fresh checkout, `ship_secret`'s only guard is `[ -f "$local_file" ]`,
 * `deploy.sh` exits 0), not by an operator's active choice, and permanent
 * rather than a rollout window. `/api/notify` went on treating
 * `'unconfigured'` as pass-through after this split, for its pre-existing
 * deployed caller (`notify.sh`), until the box-token lifecycle removed that
 * arm too (REMOVED, below).
 *
 * FIX-ROUND FINDING 3/5 (Task 6) + FINDING 3 (Task 7, D-39): `/api/mail` and
 * `/api/mail/:id/ack` are NOT grantees of EITHER tolerance and must treat
 * `'legacy'` AND `'unconfigured'` the same as `'bad'`. The spec scopes the
 * rollout tolerance to `/api/notify` by name (spec:150-155), states the mail
 * ingress is "Authenticated by a box token" with no carve-out (spec:136-138),
 * and separately lists `unauthenticated` as one of `/api/mail`'s own typed,
 * total rejection codes with no tolerance carved out (spec:136-148) — and the
 * reason either tolerance exists at all ("the hook cannot go dark
 * mid-rollout / before it is ever configured") cannot apply to a route with
 * zero pre-existing deployed callers, which `/api/mail` is in this very
 * build: failing shut on it strands nobody. A caller that presents a token
 * and gets it WRONG has no rollout excuse either and is refused the same way.
 * Residual exposure while `'unconfigured'` was still fail-open was bounded by
 * the attribution gate (an off-box caller still needs a live `$REG/<id>.uuid`
 * to get past check 5/6) — DoS-and-unbounded-writes, not message forgery —
 * but that is exactly the exposure this same fix-round already judged worth
 * closing for the `'legacy'` arm; leaving `'unconfigured'` open was the other
 * half of the identical hole.
 *
 * REMOVED: `/api/notify`'s `'legacy'` tolerance AND its `'unconfigured'`
 * pass-through (box-token lifecycle, spec 4.3 and the decision row "/api/notify
 * tolerance: remove both arms"). This paragraph used to schedule the removal of
 * `'legacy'` one deploy after it shipped, and to say `'unconfigured'` had no
 * removal date because it was the honest "this box has never been told a
 * secret" state. That reason is gone: the server mints its own token at boot,
 * so a server with no current value is one whose mint FAILED, and every lane,
 * `/api/notify` included, answers 401 there until a mint succeeds. No caller
 * of this function grants either tolerance any more; the two words stay
 * distinct so a refusal can say which condition it met.
 *
 * `timingSafeEqual` needs equal lengths, so the length check comes first and
 * leaks only the length — which a caller can measure anyway by sending one.
 * That is the LITERAL-STRING arm, kept exactly as it was so the many tests that
 * inject a string keep their meaning.
 *
 * A {@link BoxTokenHolder} (box-token lifecycle, spec 4.3) answers the same four
 * words: no current value is `'unconfigured'`; an absent value is `'legacy'`; a
 * value in the accept-set (current, either pending, previous before its hard
 * bound) is `'ok'`, compared over sha256 digests so no length leaks either; any
 * other value is `'bad'`, and one whose digest is retired is also counted
 * against `lane` (the caller's route key, `'unnamed'` when absent), the only
 * signal of an outside holder.
 */
export function checkMailToken(expected: string | BoxTokenHolder | null, presented: unknown,
  lane?: string): 'ok' | 'legacy' | 'bad' | 'unconfigured' {
  if (expected === null) return 'unconfigured';        // the server was never given a token
  if (expected instanceof BoxTokenHolder) {
    if (!expected.hasCurrent()) return 'unconfigured';
    if (presented === undefined || presented === null || presented === '') return 'legacy';
    if (typeof presented !== 'string') return 'bad';
    if (expected.match(presented) !== null) return 'ok';
    if (expected.isRetired(presented)) expected.noteRetiredPresented(lane ?? 'unnamed');
    return 'bad';
  }
  if (presented === undefined || presented === null || presented === '') return 'legacy';
  if (typeof presented !== 'string') return 'bad';
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return 'bad';
  return timingSafeEqual(a, b) ? 'ok' : 'bad';
}
