// The account roster — parsed, validated data that REPLACED the compile-time
// `ACCOUNTS` literal in `shared/api.ts` (Stage 2a,
// docs/superpowers/specs/2026-08-11-stage2a-roster-becomes-data-design.md).
//
// Pure, and L0 rather than import-free: this file bundles into the PWA
// (`pwa/src/lib/offline.ts:10` is `import { HUES } from '../../../shared/roster';`
// — a VALUE import), so it imports exactly two other `shared/*.ts` modules and
// nothing else — no `node:*`, no `fs`, no path. The two are `./providers.js`
// (the provider table, §4.1's `exec.provider` gate) and `./base-url.js` (the
// endpoint gate), both themselves import-free, so the bundle gains no runtime
// dependency. `server/test/providers.test.ts` asserts the WHOLE import list, so
// a third import is a red suite and not a review comment. `parseRoster`
// therefore still takes already-parsed JSON (`unknown`), never a path; whoever
// reads `~/.ccrc/accounts.json` off disk does the `readFile` and hands the
// parsed value in here.
//
// Written in Task 2 of the stage-2a plan; live since Task 5, when `loadConfig`
// began reading `~/.ccrc/accounts.json` into `CcrcConfig.roster`, and sole
// since Task 6, which deleted `shared/api.ts`'s `ACCOUNTS` literal and moved
// its consumers (`configDirFor`, `idHomeWrapper`, `projectHome`, `readLimits`,
// `GET /api/accounts`) onto the parsed roster instead. `shared/api.ts`'s
// `Wrapper` docstring is where the concept's history is recorded; this file is
// where its data lives.

import { PROVIDERS, PROVIDER_IDS, isProviderId, type ProviderId } from './providers.js';
import { BASE_URL_OK } from './base-url.js';

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
 *  `shared/api.ts`'s `isPrPhase`/`isPrReason`: the CONSTANT is cast, never the
 *  input, so this is a real type guard rather than an assertion dressed up as
 *  one. (`isWrapper` was the third of that family until `Wrapper` widened to
 *  `string`, at which point narrowing to it meant nothing — see `inRoster`
 *  below, which replaced it as a plain boolean.) */
function isHue(v: unknown): v is Hue {
  return typeof v === 'string' && (HUES as readonly string[]).includes(v);
}

/** `arr[i % arr.length]`, asserted non-null: every call site below passes a
 *  provably nonempty array, so a modulo index is always in range. One
 *  assertion here documents that once, instead of a bare `!` at each site. */
function cycleAt<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length]!;
}

/** The four aliases ccd and Claude Code route on. NOT optional and not a
 *  suggestion: `opus`/`sonnet`/`haiku` are what `/model` selects and `subagent`
 *  is what a dispatched worker gets, so an api-key lane missing one has a
 *  routing target with nothing behind it. */
export interface ModelMap { opus: string; sonnet: string; haiku: string; subagent: string }

/** One entry of the operator's allowlist. `label` is display text; absent means
 *  the picker shows the id. */
export interface ModelChoice { id: string; label?: string }

/**
 * An api-key lane's models. The four aliases are the ROUTING map; `selectable`
 * is a different question — *which models may I choose from the picker* — and
 * without it an OpenRouter or compatible lane inherits Claude's hardcoded list,
 * which is wrong for every lane that is not Anthropic-served. Absent means "the
 * four aliases and nothing else", which is what a roster written before this
 * field already gets.
 *
 * Called `OpenRouterModels` until the base URL generalised (§15.22); the SHAPE
 * did not change, only the name's claim about who may carry it.
 */
export interface ApiKeyModels extends ModelMap { selectable?: ModelChoice[] }

/** The four alias keys, as a runtime list, so the validator walks them instead
 *  of naming them four times. `satisfies` is what keeps it honest: dropping a
 *  key from `ModelMap` without dropping it here is a compile error. */
export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'subagent'] as const satisfies
  readonly (keyof ModelMap)[];

/** A model id, and a DISTINCT gate from `ID_RE` (`:289`) rather than a reuse of
 *  it: an account id becomes a filename, a bash `case` pattern and a session-id
 *  prefix, so it cannot hold `/`, `.` or `:` — and an OpenRouter id is
 *  `anthropic/claude-opus-4.5:beta`, which holds all three. Capped at 128
 *  characters. Task 4 adds a copy to `shared/roster-json.mjs` and a test
 *  asserting the two equal source-for-source in `gen-accounts.test.ts`, because
 *  the last time a regex was hand-copied into that file the escape text was
 *  emitted as raw control bytes, twice in one task, with every suite green
 *  (`server/test/source-bytes.test.ts:5-15`). */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;

/**
 * How ccrc reaches an account's binary. The disk forced this shape (design
 * spec §1, from reading a live box): `claude` itself is 304,282,632 bytes of
 * ELF ccrc must never generate, overwrite or back up; three more accounts
 * are the same generatable four-line launcher; `gpt` is a bespoke,
 * hand-written script ccrc must know about — to rank, label and color it —
 * and must never write.
 *
 *   - `upstream` — the Claude Code binary itself. Exactly one per roster.
 *   - `generated` — ccrc owns this file end to end.
 *   - `external` — a user-provided executable ccrc records but never
 *     touches.
 *
 * `secretsFile` is legal on ALL THREE and validated by one gate. On
 * `generated` it is the file ccrc writes and the wrapper sources. On the other
 * two it is DECLARATIVE — it names the file somebody else's launcher sources,
 * so doctor and the UI can point at it and say whether it exists. That is the
 * only way `§1.7`'s hole closes: the upstream account has a credential and
 * nothing in the tree could see it, and ccrc is never going to write the
 * upstream launcher. Never a path here — `shared/` cannot import `node:path`;
 * it is resolved against `$HOME` by whoever reads it.
 *
 * `provider` is REQUIRED on `generated` (absent parses as `anthropic`, with one
 * warning per parse) and OPTIONAL on `external`, where absent means UNDECLARED
 * — a real third answer, not a default: the card shows the lane and offers no
 * provider operation. On `upstream` it is not spelled at all; the Claude Code
 * binary is `anthropic` by construction and a roster claiming otherwise would
 * be asserting something false about a file ccrc does not own.
 *
 * `baseUrl` and `models` are the api-key lane's two settings, and they live
 * here rather than in the wrapper because §4.3 measured that Claude Code's own
 * `settings.json` routes the lane on its own — so the wrapper shape does not
 * change and `_wrap_parse_shape`, the equivalence triple and `cmd_wrappers`
 * are all untouched.
 */
export type ExecSpec =
  | { kind: 'upstream'; secretsFile?: string }
  | {
    kind: 'generated'; secretsFile?: string; provider: ProviderId;
    baseUrl?: string; models?: ApiKeyModels;
  }
  | { kind: 'external'; secretsFile?: string; provider?: ProviderId; baseUrl?: string };

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
  /** The operator's declaration that this entry is roster PLUMBING rather than
   *  one of their accounts.
   *
   *  It exists because `parseRoster` requires EXACTLY ONE `upstream` entry (see
   *  the refusal below) whose only job is to name the Claude Code binary every
   *  generated wrapper execs (`shared/wrapper.mjs`) — and an `upstream` account
   *  runs with no `CLAUDE_CONFIG_DIR`, so its config dir is always Claude
   *  Code's default. On a box where that default dir is driven by another tool,
   *  ccrc places no work there and the entry names no account the operator
   *  holds; it is a filename, and every surface that presents it as an account
   *  is stating something false.
   *
   *  DECLARED, NEVER DERIVED. The tempting derivation — `homeAble: false` plus
   *  `telemetry: 'none'` — is exactly `gpt`: a REAL opt-in account a session
   *  reaches on purpose with `ccd prefer`, which
   *  `pwa/test/accounts-screen.test.tsx`'s "every account, never hidden"
   *  invariant requires a row for. No predicate over the other fields can tell
   *  the two apart, so only the operator can say which this is.
   *
   *  Optional in the FILE and defaulted false here, so every roster written
   *  before the field existed parses and renders exactly as it did. */
  hidden: boolean;
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
 *  2. Its predecessor, `BY_ID_PREFIX_LENGTH_DESC` (fleet.ts), was a
 *     MODULE-LEVEL const evaluated at import time. Runtime roster data does
 *     not exist at import time, so that shape could not survive — putting the
 *     ordering on the parsed `Roster` object is what replaced it (Task 6).
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
   * The tie-break is load-bearing, not decorative: the comparator this
   * replaced (`ACCOUNTS[b].idPrefix.length - ACCOUNTS[a].idPrefix.length`,
   * fleet.ts's deleted `BY_ID_PREFIX_LENGTH_DESC`) had no secondary key, so
   * equal-length ids fell back to whatever order the JS engine's sort
   * happened to leave them in. Real ids collide on
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
 * Is `v` an account this roster has? The membership test `shared/api.ts`'s
 * `isWrapper` used to be, and deliberately NOT a type guard: once `Wrapper`
 * became `string` (Stage 2a, Task 6), a `v is Wrapper` predicate narrowed
 * nothing while still reading like a guard — a signature that promises the
 * compiler is checking something it is not.
 *
 * `unknown` rather than `string` for the same reason `isPrReason` takes one:
 * every caller's input arrives off disk or off the wire, and a parameter typed
 * `string` invites `as string` at the call site, which is the assertion this
 * check exists to replace.
 *
 * The one consumer that matters is `readLimits` (`server/src/limits.ts`): the
 * registry directory holds `<name>-disabled` markers that name no account at
 * all — `autocompact-disabled` is a fleet-wide proactive-/compact kill switch,
 * not a lane — and this is what stops one of those from being backfilled into
 * a phantom `autocompact` row on `GET /api/accounts`, which the accounts
 * screen would then render as a real account. `configDirFor`
 * (`server/src/config.ts`) answers the same question by doing the lookup it
 * already needs (`roster.byId.get(...)` → `undefined`), so it stays as it is
 * rather than asking twice.
 */
export function inRoster(roster: Roster, v: unknown): boolean {
  return typeof v === 'string' && roster.byId.has(v);
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
 * Critically, ccd's `_default_pool` (ccd:9019) joins ids into a
 * space-separated string via `"${CCRC_HOME_ABLE[*]}"`, and `_swap_target`
 * (ccd:9201) reads that back through an UNQUOTED
 * `for cand in $(_pool_for "$id")`. Whitespace in an id would word-split
 * there silently and corrupt account routing — which is why `[a-z0-9-]`
 * has no room for anything else, including whitespace. Capped at 32
 * characters (one leading letter plus up to 31 more).
 */
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** C0 controls plus DEL — everything a one-line status bar cannot survive.
 *  Deliberately NOT a whitelist of "printable" characters: real labels are
 *  `team·max` and `team·alt`, so anything narrower than "no control bytes"
 *  would reject the roster this repo actually ships. */
const LABEL_UNSAFE_RE = /[\u0000-\u001f\u007f]/;

/** The conservative gate on `exec.secretsFile`, mirroring the one
 *  `configDirSuffix` carries and for the same reason: the value is embedded
 *  inside a double-quoted bash string in the wrapper `shared/wrapper.mjs`
 *  writes (`[ -r "$HOME/<path>" ] && . "$HOME/<path>"`), where `$`, `` ` ``,
 *  `"` and `\` are all still live to the shell. Letters, digits, `.`, `-`,
 *  `_` and `/` only. Copies of this rule live in `shared/roster-json.mjs`
 *  (which may be stricter than this file, never laxer — see its header) and
 *  in `shared/wrapper.mjs` (the writer's own lock, which protects it against
 *  a caller that never went through this parser). */
const SECRETS_SAFE_RE = /^[A-Za-z0-9._/-]+$/;

const EXEC_KINDS: ReadonlySet<string> = new Set(['upstream', 'generated', 'external']);
const ROOT_KEYS: ReadonlySet<string> = new Set(['version', 'accounts']);
const ACCOUNT_KEYS: ReadonlySet<string> = new Set(
  ['id', 'label', 'configDirSuffix', 'exec', 'homeAble', 'hue', 'telemetry', 'hidden'],
);
// THREE sets, not two, and written as a containment chain so the shared members
// are never retyped. `upstream` and `external` used to share `EXEC_KEYS_BASE`
// because neither carried a field beyond the discriminator; §4.1 gives each arm
// a different set, and the two-way ternary `parseExec` used could not express
// three of them.
//
// The reason the sets exist at all is unchanged: a typo like `secretFile`
// (missing the `s`) silently drops an account's secrets-file reference, the
// account then launches with no OAuth token, and nothing anywhere says so.
// `warnUnknownKeys` catches it. Note what it does NOT do — it never removes the
// key and never fails; adding a name here stops a warning, it does not enable a
// field.
const EXEC_KEYS_UPSTREAM: ReadonlySet<string> = new Set(['kind', 'secretsFile']);
const EXEC_KEYS_EXTERNAL: ReadonlySet<string> =
  new Set([...EXEC_KEYS_UPSTREAM, 'provider', 'baseUrl']);
const EXEC_KEYS_GENERATED: ReadonlySet<string> =
  new Set([...EXEC_KEYS_EXTERNAL, 'models']);
/** Keyed so the call site is a lookup rather than a chain of ternaries, and so
 *  a fourth `ExecSpec` kind would be a compile error here before it was a
 *  silent fall-through to the wrong set. */
const EXEC_KEYS: Readonly<Record<ExecSpec['kind'], ReadonlySet<string>>> = {
  upstream: EXEC_KEYS_UPSTREAM,
  external: EXEC_KEYS_EXTERNAL,
  generated: EXEC_KEYS_GENERATED,
};

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

/** Validates `exec.models`. Returns the value, so the caller cannot forget to
 *  keep it; throws with the offending key NAMED, because "invalid models" over
 *  a five-key object is a message that costs a second read of the file. */
function parseModels(raw: unknown, id: string, provider: ProviderId): ApiKeyModels {
  if (!PROVIDERS[provider].apiKeyModels) {
    throw new RosterError(
      `account "${id}" declares exec.models on provider "${provider}", which carries no model map.`,
      `Remove "models" from account "${id}"'s exec in ${ROSTER_PATH}, or set exec.provider to a `
        + `provider that takes one (${PROVIDER_IDS.filter((p) => PROVIDERS[p].apiKeyModels).join(', ')}).`,
    );
  }
  if (!isPlainObject(raw)) {
    throw new RosterError(
      `account "${id}" has a non-object exec.models.`,
      `Set exec.models for account "${id}" in ${ROSTER_PATH} to an object with `
        + `${MODEL_ALIASES.join(', ')}, or remove it.`,
    );
  }
  const map: Record<string, string> = {};
  for (const alias of MODEL_ALIASES) {
    const v = raw[alias];
    if (typeof v !== 'string' || !MODEL_ID_RE.test(v)) {
      throw new RosterError(
        `account "${id}" has a missing or invalid exec.models.${alias} ${JSON.stringify(v)}.`,
        `Set exec.models.${alias} for account "${id}" in ${ROSTER_PATH} to a model id: a letter or `
          + 'digit followed by up to 127 of letters, digits, ".", "_", ":", "/" and "-".',
      );
    }
    map[alias] = v;
  }
  const selectableRaw = raw['selectable'];
  if (selectableRaw === undefined) {
    return { opus: map['opus']!, sonnet: map['sonnet']!, haiku: map['haiku']!, subagent: map['subagent']! };
  }
  if (!Array.isArray(selectableRaw) || selectableRaw.length === 0) {
    throw new RosterError(
      `account "${id}" has an empty or non-array exec.models.selectable.`,
      `Set exec.models.selectable for account "${id}" in ${ROSTER_PATH} to a non-empty array of `
        + '{ "id": … } objects, or remove it — absent means the four aliases and nothing else.',
    );
  }
  const selectable: ModelChoice[] = selectableRaw.map((entry, i) => {
    if (!isPlainObject(entry) || typeof entry['id'] !== 'string' || !MODEL_ID_RE.test(entry['id'])) {
      throw new RosterError(
        `account "${id}" has an invalid exec.models.selectable[${i}].`,
        `Each entry of exec.models.selectable for account "${id}" in ${ROSTER_PATH} must be an `
          + 'object with a model-id "id" and an optional string "label".',
      );
    }
    const label = entry['label'];
    if (label !== undefined && (typeof label !== 'string' || label.length === 0)) {
      throw new RosterError(
        `account "${id}" has a non-string exec.models.selectable[${i}].label.`,
        `Set that entry's "label" to display text, or remove it — absent shows the id.`,
      );
    }
    return label !== undefined ? { id: entry['id'], label } : { id: entry['id'] };
  });
  // Every alias must be selectable. A routing target the operator cannot pick
  // is a lane that answers `/model opus` with a model the picker never showed
  // (§4.1) — and the operator would have no way to find out which.
  const offered = new Set(selectable.map((c) => c.id));
  for (const alias of MODEL_ALIASES) {
    if (!offered.has(map[alias]!)) {
      throw new RosterError(
        `account "${id}" routes ${alias} to ${JSON.stringify(map[alias])}, which its `
          + 'exec.models.selectable does not offer.',
        `Add ${JSON.stringify(map[alias])} to exec.models.selectable for account "${id}" in `
          + `${ROSTER_PATH}, or point exec.models.${alias} at a model the list already offers.`,
      );
    }
  }
  return {
    opus: map['opus']!, sonnet: map['sonnet']!, haiku: map['haiku']!, subagent: map['subagent']!,
    selectable,
  };
}

/**
 * @param assumedProvider collects the ids of `generated` accounts that named no
 *   provider, so `parseRoster` can warn ONCE for the whole file instead of once
 *   per account. `ccd/ccrc-adopt` writes `{"kind":"generated"}` with no provider
 *   (`:496-503`; the bare `'{"kind":"generated"}'` literal is `:500` and the
 *   jq-composed `secretsFile` form is `:498`), so an adopted roster has one
 *   such account per generated
 *   wrapper and a per-account warning would print a paragraph on every boot.
 */
function parseExec(raw: unknown, id: string, assumedProvider: string[]): ExecSpec {
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
  warnUnknownKeys(raw, EXEC_KEYS[kind as ExecSpec['kind']], `on account "${id}"'s exec`);

  // HOISTED out of the `generated` arm (D-1857). This is the one change in this
  // wave that is not absence-permitting: `{kind:'upstream', secretsFile:'../x'}`
  // parsed with a warning before and throws now. The field is legal on all
  // three kinds because the upstream launcher has a credential nothing could
  // see (§1.7) and a declaration is the only way that closes; the gate applies
  // on all three because the value reaches a double-quoted bash string in
  // `shared/wrapper.mjs` on the generated path and a doctor `ls` on the other
  // two, and a path that escapes $HOME is wrong in both.
  const secretsFile = raw['secretsFile'];
  if (secretsFile !== undefined && typeof secretsFile !== 'string') {
    throw new RosterError(
      `account "${id}" has a non-string exec.secretsFile.`,
      `Set exec.secretsFile for account "${id}" in ${ROSTER_PATH} to a string path relative to ` +
        '$HOME, or remove it.',
    );
  }
  // A path, not merely a string. `""` and a trailing "/" both resolve to a
  // directory rather than a file; ".." escapes $HOME; a leading "/" ignores
  // it. Each is rejected by name so the remedy can say which one happened.
  if (
    secretsFile !== undefined
    && (secretsFile === '' || secretsFile.startsWith('/') || secretsFile.endsWith('/')
      || secretsFile.includes('..') || !SECRETS_SAFE_RE.test(secretsFile))
  ) {
    throw new RosterError(
      `account "${id}" has an invalid exec.secretsFile ${JSON.stringify(secretsFile)}.`,
      `Set exec.secretsFile for account "${id}" in ${ROSTER_PATH} to a path relative to $HOME ` +
        '(e.g. ".cc-secrets/' + id + '-oauth.env") using only letters, digits, ".", "-", "_" and ' +
        '"/" — never absolute, never containing "..", never ending in "/".',
    );
  }
  const withSecrets = secretsFile !== undefined ? { secretsFile } : {};

  if (kind === 'upstream') return { kind: 'upstream', ...withSecrets };

  // `provider`. Refused if present and unknown, on both remaining kinds; the
  // DEFAULT applies to `generated` only, because absent on `external` is the
  // third answer (`undeclared`) rather than a missing one.
  const providerRaw = raw['provider'];
  // Written as a nested `if` rather than as one compound condition, and not for
  // taste: `isProviderId` is a type guard over `unknown`, and only this shape
  // narrows `providerRaw` to `ProviderId` on the path after the throw without a
  // cast. A cast here would be the assertion this repo's guards exist to avoid.
  let provider: ProviderId | undefined;
  if (providerRaw !== undefined) {
    if (!isProviderId(providerRaw)) {
      throw new RosterError(
        `account "${id}" has an unknown exec.provider ${JSON.stringify(providerRaw)}.`,
        `Set exec.provider for account "${id}" in ${ROSTER_PATH} to one of ` +
          `${PROVIDER_IDS.join(', ')}, or remove it.`,
      );
    }
    provider = providerRaw;
  }
  if (kind === 'generated' && provider === undefined) assumedProvider.push(id);
  const effective: ProviderId | undefined = kind === 'generated' ? provider ?? 'anthropic' : provider;

  // `baseUrl`. One gate (`BASE_URL_OK`), five named refusals, and the value
  // stored is the NORMALISED one — see that file's header for why. Required
  // when the provider says so and the roster names no default to fall back on.
  const baseUrlRaw = raw['baseUrl'];
  let baseUrl: string | undefined;
  if (baseUrlRaw !== undefined) {
    const verdict = BASE_URL_OK(baseUrlRaw);
    if (!verdict.ok) {
      throw new RosterError(
        `account "${id}" has an invalid exec.baseUrl ${JSON.stringify(baseUrlRaw)}: ${verdict.reason}.`,
        `Set exec.baseUrl for account "${id}" in ${ROSTER_PATH} to an https:// endpoint, or an ` +
          'http:// one on 127.0.0.1, [::1] or localhost — with no user:password, no query string ' +
          'and no fragment.',
      );
    }
    baseUrl = verdict.url;
  } else if (effective !== undefined && PROVIDERS[effective].baseUrlRequired) {
    throw new RosterError(
      `account "${id}" has provider "${effective}" and no exec.baseUrl: base-url-required.`,
      `Set exec.baseUrl for account "${id}" in ${ROSTER_PATH} — provider "${effective}" ships no ` +
        'default endpoint, so only you can say where the lane talks to.',
    );
  }
  const withBaseUrl = baseUrl !== undefined ? { baseUrl } : {};

  if (kind === 'external') {
    return {
      kind: 'external', ...withSecrets, ...withBaseUrl,
      ...(provider !== undefined ? { provider } : {}),
    };
  }

  // `models` — generated only. It is not in `EXEC_KEYS_EXTERNAL`, so an
  // `external` entry carrying one warns and drops it, which is right: ccrc does
  // not write that lane's `settings.json` and a model map it cannot apply would
  // be a roster asserting a configuration that is not on the box.
  // `effective` is provably a `ProviderId` here — `kind` is `'generated'`, so
  // the `??` above supplied one — and the assertion says that once rather than
  // twice. `ExecSpec`'s `generated` arm declares `provider` NON-optional, so a
  // future path that forgot to compute it would not compile; that is the
  // property the old literal-per-arm return bought, kept.
  const generatedProvider = effective!;
  const modelsRaw = raw['models'];
  const models = modelsRaw !== undefined
    ? parseModels(modelsRaw, id, generatedProvider)
    : undefined;

  return {
    kind: 'generated', provider: generatedProvider, ...withSecrets, ...withBaseUrl,
    ...(models !== undefined ? { models } : {}),
  };
}

function parseAccount(raw: unknown, index: number, assumedProvider: string[]): Draft {
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
  // A label is display text for a human, and it now reaches TWO renderers
  // that a control character breaks differently. `pwa/` puts it in a DOM
  // node, where a stray `\n` is invisible; `ccd/statusline-command.sh`
  // prints it into a ONE-LINE terminal status bar, and `server/src/pane/
  // statusline.ts` parses that line back out of a tmux capture. A newline
  // there does not corrupt the label — it splits the status line in two, so
  // the parser reads a truncated model/branch from what is left and the
  // fleet view quietly disagrees with the session. Escape/CSI bytes are
  // worse: the label would recolour everything printed after it.
  //
  // Rejected rather than stripped, deliberately: silently rewriting an
  // operator's label is an adapter narrowing a distinction it received.
  // The roster refuses to load and names the fix instead.
  if (LABEL_UNSAFE_RE.test(label)) {
    throw new RosterError(
      `account "${id}" has a label containing a control character.`,
      `Remove the tab, newline or escape character from "label" for account "${id}" in ` +
        `${ROSTER_PATH} — a label is one line of display text.`,
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

  const exec = parseExec(raw['exec'], id, assumedProvider);

  const homeAble = raw['homeAble'];
  if (typeof homeAble !== 'boolean') {
    throw new RosterError(
      `account "${id}" has a non-boolean homeAble.`,
      `Set "homeAble" to true or false for account "${id}" in ${ROSTER_PATH}.`,
    );
  }

  // OPTIONAL, unlike every field around it: absent means false, which is what
  // makes this additive to rosters that predate it. But a PRESENT value must
  // still be a boolean — a typo'd `"false"` is a truthy string, and truthiness
  // here would silently erase an account from every surface that lists one,
  // which is the loudest possible failure to have chosen leniency for.
  const hiddenRaw = raw['hidden'];
  if (hiddenRaw !== undefined && typeof hiddenRaw !== 'boolean') {
    throw new RosterError(
      `account "${id}" has a non-boolean hidden.`,
      `Set "hidden" to true or false for account "${id}" in ${ROSTER_PATH}, or remove the key.`,
    );
  }
  const hidden = hiddenRaw === true;

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

  return { id, label, configDirSuffix, exec, homeAble, telemetry, hue, hidden };
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

  // Collected across the whole file so the migration warning is said ONCE,
  // naming every account it applied to, rather than once per account. Declared
  // here and read after every check that can throw, so a roster that fails to
  // parse never warns about a field on an account nobody is going to keep.
  const assumedProvider: string[] = [];
  const drafts: Draft[] = rawAccounts.map((raw, i) => parseAccount(raw, i, assumedProvider));

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

  // Two accounts may not share one config dir. Until `_ccrc_dir_id` existed
  // (`shared/generate.mjs`) the map only ever ran id → dir, where a shared
  // dir was merely odd; the REVERSE direction makes it ambiguous, and the
  // ambiguity is resolved somewhere no one would look for it — a bash `case`
  // arm order. Concretely: `ccd/statusline-command.sh` is handed a config dir
  // and nothing else, and turns it into the account whose `~/.cc-limits`
  // row it writes. Two accounts on one dir means both accounts' sessions
  // publish their rate limits to whichever id the generator emitted first,
  // and the other account is measured by nothing forever — the same silent
  // never-placed failure `telemetry`/`projectHome` already guard the other
  // approach to. A config dir is also a Claude Code identity (one
  // credentials file, one set of limits), so two accounts sharing one is a
  // roster that is lying about having two accounts.
  const seenDirs = new Map<string, string>();
  for (const a of drafts) {
    const owner = seenDirs.get(a.configDirSuffix);
    if (owner !== undefined) {
      throw new RosterError(
        `accounts "${owner}" and "${a.id}" share the configDirSuffix ` +
          `${JSON.stringify(a.configDirSuffix)}.`,
        `Give each account its own "configDirSuffix" in ${ROSTER_PATH} (e.g. ".${a.id}"), or ` +
          'delete the duplicate account.',
      );
    }
    seenDirs.set(a.configDirSuffix, a.id);
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

  if (assumedProvider.length > 0) {
    console.warn(
      `ccrc: ${ROSTER_PATH} names no exec.provider on ${assumedProvider.join(', ')}; assuming ` +
      '"anthropic". Set exec.provider on each to silence this.',
    );
  }

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
