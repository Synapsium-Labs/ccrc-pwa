// The account roster — parsed, validated data that replaces the compile-time
// `ACCOUNTS` literal in `shared/api.ts` (Stage 2a,
// docs/superpowers/specs/2026-08-11-stage2a-roster-becomes-data-design.md).
//
// Pure and import-free, like every other file in `shared/`: this bundles
// into the PWA, so it imports nothing — not even `node:*`. `parseRoster`
// therefore takes already-parsed JSON (`unknown`), never a path; whoever
// reads `~/.ccrc/accounts.json` off disk (a later task) does the `readFile`
// and hands the parsed value in here.
//
// Task 2 of the stage-2a plan. Nothing in the tree calls `parseRoster` yet —
// `shared/api.ts`'s `ACCOUNTS` is untouched, and stays the live roster until
// Task 6 rewires its consumers.

/**
 * The six colors an account can render in. Replaces today's hand-picked
 * `colorVar` per account (`shared/api.ts`'s `AccountDef.colorVar`) — a
 * free-form id (the whole point of Stage 2a) cannot name a bespoke CSS
 * token the way `claude`/`claude2`/`claude-corp` could, so accounts get a
 * hue instead and `pwa/src/styles/tokens.css` supplies the `--acct-<hue>`
 * custom property. Declared as a runtime list, not just a type, because the
 * auto-assignment walk below needs an actual sequence to walk — and because
 * a later doctor/adopt tool needs the identical order, not a second copy of
 * it, to report a collision the same way this parser resolves one.
 */
export const HUES = ['cyan', 'violet', 'blue', 'magenta', 'amber', 'green'] as const;
export type Hue = (typeof HUES)[number];

/** The only way to narrow an untrusted value to a `Hue` — same shape as
 *  `shared/api.ts`'s `isPrPhase`/`isPrReason`/`isWrapper`: the CONSTANT is
 *  cast, never the input, so this is a real type guard rather than an
 *  assertion dressed up as one. */
function isHue(v: unknown): v is Hue {
  return typeof v === 'string' && (HUES as readonly string[]).includes(v);
}

/** `arr[i % arr.length]`, asserted non-null: every call site below passes a
 *  provably nonempty array, so a modulo index is always in range. One
 *  assertion here documents that once, instead of a bare `!` at each site. */
function cycleAt<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length]!;
}

/**
 * How ccrc reaches an account's binary. The disk forced this shape (design
 * spec §1, from reading a live box): `claude` itself is 304,282,632 bytes of
 * ELF ccrc must never generate, overwrite or back up; three more accounts
 * are the same generatable four-line launcher; `gpt` is a bespoke,
 * hand-written script ccrc must know about — to rank, label and color it —
 * and must never write.
 *
 *   - `upstream` — the Claude Code binary itself. Exactly one per roster.
 *   - `generated` — ccrc owns this file end to end. `secretsFile` is
 *     optional, resolved against `$HOME` by whoever writes the wrapper
 *     (never a path here — `shared/` cannot import `node:path`).
 *   - `external` — a user-provided executable ccrc records but never
 *     touches.
 */
export type ExecSpec =
  | { kind: 'upstream' }
  | { kind: 'generated'; secretsFile?: string }
  | { kind: 'external' };

/** One account, as validated by `parseRoster`. */
export interface AccountDef {
  /** A filename under `~/.local/bin/<id>`, a bash `case` pattern, and a
   *  session-id prefix — see `ID_RE` below for why the charset is narrow. */
  id: string;
  /** Jargon-free, for a human. */
  label: string;
  /** Joined to `$HOME` by whoever installs the account — never spelled as a
   *  path here, since `shared/` cannot import `node:path`. */
  configDirSuffix: string;
  exec: ExecSpec;
  /** Whether `ccd`'s least-loaded picker may land a fresh session here. */
  homeAble: boolean;
  hue: Hue;
  /** `limits.ts` must not conflate "no telemetry exists for this account"
   *  with "measured zero" (design spec §3) — `'none'` opts an account like
   *  `gpt` out of that scoring entirely, rather than letting a permanent
   *  zero win it every placement. */
  telemetry: 'anthropic' | 'none';
}

/**
 * The parsed, validated roster.
 *
 * `byId` and `byIdLengthDesc` are computed ONCE here, not derived per call,
 * for two independent reasons:
 *
 *  1. `server/src/fleet.ts`'s `idHomeWrapper` runs once per registry row
 *     inside `assembleFleet`'s `recs.map(...)` — re-sorting per call would
 *     be O(rows × accounts log accounts) on every fleet tick.
 *  2. Today's equivalent, `BY_ID_PREFIX_LENGTH_DESC` (fleet.ts:57-58), is a
 *     MODULE-LEVEL const evaluated at import time. Runtime roster data does
 *     not exist at import time, so that shape cannot survive — putting the
 *     ordering on the parsed `Roster` object is what replaces it.
 */
export interface Roster {
  version: 1;
  /** Declaration order, preserved — the accounts strip and every ranked
   *  listing depend on it. */
  accounts: readonly AccountDef[];
  byId: ReadonlyMap<string, AccountDef>;
  /**
   * Longest-`id`-first, so a shorter id that happens to be a prefix of a
   * longer one (`claude-` inside `claude-dev0-`) never wins a prefix match
   * first. Sorted by `id.length` descending, `id` ascending as the
   * tie-break.
   *
   * The tie-break is load-bearing, not decorative: today's comparator
   * (`ACCOUNTS[b].idPrefix.length - ACCOUNTS[a].idPrefix.length`, fleet.ts)
   * has no secondary key, so equal-length ids fall back to whatever order
   * the JS engine's sort happens to leave them in. Real ids collide on
   * length today — `claude-corp` and `claude-dev0` are both 11 characters —
   * so "engine-defined" was never hypothetical. Sorting by `id` ascending
   * as the second key makes the order total and deterministic.
   */
  byIdLengthDesc: readonly AccountDef[];
  /** `homeAble` accounts, declaration order preserved. */
  homeAble: readonly AccountDef[];
  /** The id of the one account with `exec.kind === 'upstream'`. */
  upstreamId: string;
}

/**
 * Thrown by `parseRoster`. `remedy` is required and never empty — every
 * throw site below names one explicitly.
 *
 * Same posture as `agent/src/server.ts`'s `assertProjectsRootIsSafe`: a bad
 * config refuses to boot with a named fix, rather than degrading silently.
 * The failure this prevents is not hypothetical — a roster that silently
 * lost an account killed chat for six sessions, for that account's entire
 * life, before this roster existed (design spec, citing the incident that
 * motivated "refuse to boot" as the failure posture).
 */
export class RosterError extends Error {
  readonly remedy: string;
  constructor(message: string, remedy: string) {
    super(message);
    this.name = 'RosterError';
    this.remedy = remedy;
  }
}

/**
 * The id charset. An id becomes three different things downstream, and the
 * narrowness below is a safety property, not tidiness:
 *
 *  - a filename under `~/.local/bin/<id>`
 *  - a bash `case` pattern
 *  - a session-id prefix
 *
 * Critically, ccd's `_default_pool` (ccd:6558) joins ids into a
 * space-separated string via `"${VALID_WRAPPERS[*]}"`, and `_swap_target`
 * (ccd:6709) reads that back through an UNQUOTED
 * `for cand in $(_pool_for "$id")`. Whitespace in an id would word-split
 * there silently and corrupt account routing — which is why `[a-z0-9-]`
 * has no room for anything else, including whitespace. Capped at 32
 * characters (one leading letter plus up to 31 more).
 */
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

const EXEC_KINDS: ReadonlySet<string> = new Set(['upstream', 'generated', 'external']);
const ROOT_KEYS: ReadonlySet<string> = new Set(['version', 'accounts']);
const ACCOUNT_KEYS: ReadonlySet<string> = new Set(
  ['id', 'label', 'configDirSuffix', 'exec', 'homeAble', 'hue', 'telemetry'],
);
// `upstream` and `external` carry no fields beyond the discriminator;
// `generated` is the only kind with a second, optional one. Split so a typo
// like `secretFile` (missing the `s`) — which silently drops an account's
// secrets-file reference, and the account then launches with no OAuth token
// and no diagnostic anywhere — gets caught by `warnUnknownKeys` instead of
// vanishing the way an unrecognised key on a plain object always would.
const EXEC_KEYS_BASE: ReadonlySet<string> = new Set(['kind']);
const EXEC_KEYS_GENERATED: ReadonlySet<string> = new Set(['kind', 'secretsFile']);

/** Named in every remedy below, since `parseRoster` itself never sees a
 *  path (it takes parsed JSON, not a file) — this is where the schema's
 *  one intended caller (design spec §1) puts the file. */
const ROSTER_PATH = '~/.ccrc/accounts.json';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Unknown *fields* warn, never fail — forward compatibility for a roster
 *  written by a newer ccrc (design spec §4). An unknown *version*, by
 *  contrast, fails outright (see the `version` check in `parseRoster`):
 *  guessing at a field this build does not recognise is exactly how a
 *  roster silently loses an account. */
function warnUnknownKeys(obj: Record<string, unknown>, known: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      console.warn(`ccrc: ${ROSTER_PATH} has an unknown field "${key}" ${where}; ignoring it.`);
    }
  }
}

/** An `AccountDef` mid-parse, before `assignHues` has given every account a
 *  concrete `Hue`. Kept separate from `AccountDef` rather than lying about
 *  `hue`'s type (e.g. casting `undefined as Hue`) while auto-assignment is
 *  still pending. */
type Draft = Omit<AccountDef, 'hue'> & { hue: Hue | undefined };

function parseExec(raw: unknown, id: string): ExecSpec {
  if (!isPlainObject(raw)) {
    throw new RosterError(
      `account "${id}" has a missing or invalid "exec".`,
      `Set "exec" for account "${id}" in ${ROSTER_PATH} to an object with a "kind" of ` +
        '"upstream", "generated" or "external".',
    );
  }
  const kind = raw['kind'];
  if (typeof kind !== 'string' || !EXEC_KINDS.has(kind)) {
    throw new RosterError(
      `account "${id}" has an invalid exec.kind ${JSON.stringify(kind)}: it must be ` +
        '"upstream", "generated" or "external".',
      `Set exec.kind for account "${id}" in ${ROSTER_PATH} to "upstream", "generated" or "external".`,
    );
  }
  warnUnknownKeys(raw, kind === 'generated' ? EXEC_KEYS_GENERATED : EXEC_KEYS_BASE, `on account "${id}"'s exec`);
  if (kind === 'generated') {
    const secretsFile = raw['secretsFile'];
    if (secretsFile !== undefined && typeof secretsFile !== 'string') {
      throw new RosterError(
        `account "${id}" has a non-string exec.secretsFile.`,
        `Set exec.secretsFile for account "${id}" in ${ROSTER_PATH} to a string path relative to ` +
          '$HOME, or remove the field.',
      );
    }
    return secretsFile !== undefined ? { kind: 'generated', secretsFile } : { kind: 'generated' };
  }
  if (kind === 'upstream') return { kind: 'upstream' };
  return { kind: 'external' };
}

function parseAccount(raw: unknown, index: number): Draft {
  const where = `account at accounts[${index}]`;
  if (!isPlainObject(raw)) {
    throw new RosterError(
      `${where} is not a JSON object.`,
      `Fix accounts[${index}] in ${ROSTER_PATH} to be a JSON object with "id", "label", ` +
        '"configDirSuffix", "exec", "homeAble" and "telemetry".',
    );
  }
  warnUnknownKeys(raw, ACCOUNT_KEYS, `on ${where}`);

  const id = raw['id'];
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new RosterError(
      `${where} has an invalid id ${JSON.stringify(id)}: an id must start with a lowercase ` +
        'letter and contain only lowercase letters, digits and hyphens (max 32 characters).',
      `Rename the "id" of ${where} in ${ROSTER_PATH} to match ^[a-z][a-z0-9-]{0,31}$ — ` +
        'no spaces, no uppercase letters.',
    );
  }

  const label = raw['label'];
  if (typeof label !== 'string' || label.length === 0) {
    throw new RosterError(
      `account "${id}" has no label.`,
      `Add a non-empty "label" for account "${id}" in ${ROSTER_PATH}.`,
    );
  }

  // `configDirSuffix` is joined to `$HOME` by whoever installs the account
  // (never here — `shared/` cannot import `node:path`), so this is the
  // ONE place that join is validated safe. `"."` passes every check above
  // it (starts with `.`, no `/`, no `..`) and then resolves to `$HOME`
  // itself — the exact failure class `agent/src/server.ts`'s
  // `assertProjectsRootIsSafe` exists for: a config dir that IS $HOME folds
  // every dotfile, `~/.ssh` included, into a scope meant for one account.
  // With `/` already banned, `"."` is the only string that can normalise to
  // `$HOME` itself — any other value starting with `.` and containing
  // neither `/` nor `..` names a real, distinct one-segment subdirectory.
  const configDirSuffix = raw['configDirSuffix'];
  if (
    typeof configDirSuffix !== 'string' ||
    !configDirSuffix.startsWith('.') ||
    configDirSuffix === '.' ||
    configDirSuffix.includes('/') ||
    configDirSuffix.includes('..')
  ) {
    throw new RosterError(
      `account "${id}" has an invalid configDirSuffix ${JSON.stringify(configDirSuffix)}: it ` +
        'must start with "." and contain neither "/" nor "..", and must not be "." itself ' +
        '(which resolves to $HOME).',
      `Set "configDirSuffix" for account "${id}" in ${ROSTER_PATH} to a dot-prefixed directory ` +
        `name directly under $HOME (e.g. ".${id}") — never "." itself.`,
    );
  }

  // Second, independent gate on the same field: every configDirSuffix that
  // passes this parser reaches `shared/generate.mjs`'s emitter, which embeds
  // it inside a double-quoted bash string (`"$HOME/<suffix>"`) in
  // `_ccrc_cfg_dir`'s case bodies. The generator already defends that
  // embedding itself (`dqEscape`, backslash-escaping `\`, `"`, `$` and the
  // backtick) — the check below is deliberately NOT a replacement for that,
  // it is a second lock on the same door. A roster this permissive check
  // rejects never reaches disk at all, with a remedy naming the exact fix;
  // the generator's escaping is what protects every OTHER path that can
  // produce a `Roster`-shaped value without going through `parseRoster`
  // first (`generate.mjs` consumes a `Roster` structurally, so nothing
  // stops a future caller from building one by hand the way
  // `server/test/roster-generate.test.ts`'s hostile-payload case
  // deliberately does, on purpose, to prove the generator's own defense
  // holds on its own). Keep both — a single point of failure in an
  // injection path is worth doubling up, and removing either one on the
  // grounds that the other already covers it reopens exactly the gap this
  // comment exists to prevent someone from reopening.
  //
  // The safe set is deliberately conservative rather than "everything that
  // isn't a metacharacter": letters, digits, `.`, `-` and `_` cover every
  // production suffix today (`.claude`, `.claude-personal`, `.claude-corp`,
  // `.claude-gpt`, `.claude-dev0`) with room to spare, and a legitimate new
  // account name has no reason to need anything outside it.
  if (!/^\.[A-Za-z0-9._-]+$/.test(configDirSuffix)) {
    throw new RosterError(
      `account "${id}" has a configDirSuffix ${JSON.stringify(configDirSuffix)} containing a ` +
        'character outside the safe set: only letters, digits, ".", "-" and "_" are allowed ' +
        'after the leading ".".',
      `Set "configDirSuffix" for account "${id}" in ${ROSTER_PATH} to only letters, digits, ` +
        `".", "-" and "_" (e.g. ".${id}") — remove any other character.`,
    );
  }

  const exec = parseExec(raw['exec'], id);

  const homeAble = raw['homeAble'];
  if (typeof homeAble !== 'boolean') {
    throw new RosterError(
      `account "${id}" has a non-boolean homeAble.`,
      `Set "homeAble" to true or false for account "${id}" in ${ROSTER_PATH}.`,
    );
  }

  const telemetry = raw['telemetry'];
  if (telemetry !== 'anthropic' && telemetry !== 'none') {
    throw new RosterError(
      `account "${id}" has an invalid telemetry ${JSON.stringify(telemetry)}: it must be ` +
        '"anthropic" or "none".',
      `Set "telemetry" for account "${id}" in ${ROSTER_PATH} to "anthropic" or "none".`,
    );
  }

  // Validated but not defaulted here: `assignHues` (below) walks the whole
  // roster afterward, so auto-assignment can see every explicit claim
  // first, regardless of which account declaration order puts it after.
  const hueRaw = raw['hue'];
  let hue: Hue | undefined;
  if (hueRaw !== undefined) {
    if (!isHue(hueRaw)) {
      throw new RosterError(
        `account "${id}" has an unknown hue ${JSON.stringify(hueRaw)}.`,
        `Set "hue" for account "${id}" in ${ROSTER_PATH} to one of ${HUES.join(', ')}, or ` +
          'remove the field to auto-assign one.',
      );
    }
    hue = hueRaw;
  }

  return { id, label, configDirSuffix, exec, homeAble, telemetry, hue };
}

/**
 * Fills in `hue` for every account that did not declare one, mutating the
 * drafts in place.
 *
 * The pool auto-assignment draws from is `HUES`, in order, minus any hue an
 * account claimed EXPLICITLY — an explicit claim is always honoured and
 * never handed to a different account. Accounts needing auto-assignment
 * then take one pool entry each, in declaration order, `i % pool.length` —
 * true round-robin, not "first free slot": for six or fewer such accounts
 * this is indistinguishable from "next free hue by position" (`pool.length`
 * is at least that many), but past six it means the 7th auto-assigned
 * account gets the pool's 1st hue again, the 8th its 2nd, and so on.
 *
 * That distinction is the fix for a real bug: an earlier version searched
 * for "the next hue nobody has claimed yet" per account and fell back to
 * "whichever hue this search happened to land on last" once the pool was
 * exhausted — which is deterministic, but happened to be the SAME hue every
 * time (the search always ran the same number of steps per account), so
 * accounts 7, 8, 9, … all clumped onto the pool's last entry instead of
 * spreading out. Design spec §3 says the palette "cycles" past six accounts;
 * clumping is not cycling. `i % pool.length` cycles for real.
 *
 * If every hue in `HUES` was claimed explicitly (pool empty) and an account
 * still needs one, auto-assignment falls back to cycling the full `HUES`
 * list — there is no hue left that avoids colliding with some explicit
 * choice, so this at least still spreads collisions round-robin rather than
 * concentrating them.
 *
 * A resulting collision is not reported here — design spec §3 puts that on
 * a later `doctor` task, which sees the finished roster and can name both
 * colliding accounts; this function's only job is to never leave a `hue`
 * unset.
 */
function assignHues(accounts: Draft[]): void {
  const explicit = new Set<Hue>();
  for (const a of accounts) if (a.hue !== undefined) explicit.add(a.hue);

  const pool = HUES.filter((h) => !explicit.has(h));
  const available = pool.length > 0 ? pool : HUES;

  let i = 0;
  for (const a of accounts) {
    if (a.hue !== undefined) continue;
    a.hue = cycleAt(available, i);
    i++;
  }
}

/**
 * Parses and validates `~/.ccrc/accounts.json`'s already-`JSON.parse`d
 * contents. Never reads a file itself (see the file header) — `json` is
 * `unknown` on purpose, since it may be attacker- or typo-controlled disk
 * content, not a value this module can trust structurally.
 *
 * Throws `RosterError` — always with a non-empty `remedy` — on any
 * malformed roster; never returns a partial or silently-degraded result.
 * See design spec §4 for the validation rules this enforces.
 */
export function parseRoster(json: unknown): Roster {
  if (!isPlainObject(json)) {
    throw new RosterError(
      `${ROSTER_PATH} must contain a single JSON object with "version" and "accounts" fields.`,
      `Rewrite ${ROSTER_PATH} as a JSON object, or reinstall ccrc to restore the shipped default.`,
    );
  }
  warnUnknownKeys(json, ROOT_KEYS, 'at the roster root');

  // An unrecognised version FAILS, unlike an unrecognised field: a roster
  // written by a newer ccrc may mean something different by a field this
  // build thinks it understands, and guessing is exactly how a roster
  // silently loses an account.
  const version = json['version'];
  if (version !== 1) {
    throw new RosterError(
      `unsupported roster version ${JSON.stringify(version)}: ccrc understands version 1.`,
      `Upgrade ccrc to a build that understands this roster's version, or set "version": 1 in ` +
        `${ROSTER_PATH} if the file was hand-edited by mistake.`,
    );
  }

  const rawAccounts = json['accounts'];
  if (!Array.isArray(rawAccounts)) {
    throw new RosterError(
      'roster "accounts" field must be an array.',
      `Add an "accounts" array to ${ROSTER_PATH}.`,
    );
  }
  if (rawAccounts.length === 0) {
    throw new RosterError(
      'roster must contain at least one account.',
      `Add at least one account to ${ROSTER_PATH}, or reinstall ccrc to restore the shipped default.`,
    );
  }

  const drafts: Draft[] = rawAccounts.map((raw, i) => parseAccount(raw, i));

  const seenIds = new Set<string>();
  for (const a of drafts) {
    if (seenIds.has(a.id)) {
      throw new RosterError(
        `duplicate account id "${a.id}".`,
        `Give every account in ${ROSTER_PATH} a unique "id".`,
      );
    }
    seenIds.add(a.id);
  }

  const upstreams = drafts.filter((a) => a.exec.kind === 'upstream');
  if (upstreams.length === 0) {
    throw new RosterError(
      'roster has no upstream account: exactly one account must have exec.kind "upstream".',
      `Set exec.kind to "upstream" in ${ROSTER_PATH} on the account that runs the Claude Code ` +
        'binary directly (usually "claude").',
    );
  }
  if (upstreams.length > 1) {
    throw new RosterError(
      `roster has ${upstreams.length} upstream accounts ` +
        `(${upstreams.map((a) => `"${a.id}"`).join(', ')}): exactly one account may have ` +
        'exec.kind "upstream".',
      `Change exec.kind on all but one upstream account in ${ROSTER_PATH} to "generated" or ` +
        '"external".',
    );
  }
  // Exactly one element, just proven by the two checks above.
  const upstreamId = upstreams[0]!.id;

  assignHues(drafts);
  // `assignHues` has just given every draft a concrete hue; this cast
  // documents that guarantee rather than re-deriving it structurally.
  const accounts: AccountDef[] = drafts.map((a) => ({ ...a, hue: a.hue as Hue }));

  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const byIdLengthDesc = accounts
    .slice()
    .sort((a, b) => b.id.length - a.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const homeAble = accounts.filter((a) => a.homeAble);

  return { version: 1, accounts, byId, byIdLengthDesc, homeAble, upstreamId };
}
