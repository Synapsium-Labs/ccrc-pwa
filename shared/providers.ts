// The provider table — the ONE place in this tree that enumerates the model
// providers an account can be connected to. Everything else derives.
//
// L0, and import-free like every other `shared/*.ts`: the PWA bundles this file
// (`pwa/src/lib/offline.ts:10` value-imports its neighbour `shared/roster.ts`,
// which imports this one), so it imports nothing — not even `node:*`.
// `server/test/providers.test.ts` measures that, and measures the same rule for
// `shared/roster.ts`, which had gone since Stage 2a with no pin at all
// (D-1864).
//
// WHY A TABLE AND NOT A UNION. `ProviderId` is `keyof typeof PROVIDERS`, so the
// type cannot name a provider the table does not describe and the table cannot
// hold a row no type admits. That is the `PR_REASON_MAP`/`PR_REASONS` shape
// (`shared/api.ts:409`) applied here, and it is what lets `PROVIDER_IDS` and
// `GENERATABLE` be `Object.keys` and a `filter` rather than two more lists to
// keep in step.
//
// WHY `openrouter` AND `compatible` ARE BOTH HERE. Mechanically they are one
// lane: same `settings.json` env block, same secrets file, same probe, same
// removal order, same screens. They differ in exactly two things — openrouter
// carries a default endpoint and a public catalogue; compatible REQUIRES the
// endpoint and has neither — and those two differences are what its screens are
// made of (spec §4.2). A provider whose only distinguishing content was a
// constant would not have earned a row.
//
// NO `.mjs` COPY OF THIS TABLE EXISTS, and that is measured by a scan over
// `git ls-files` rather than by `single-definition.test.ts`, whose `sources()`
// (:40-57) filters `/\.tsx?$/` at :54 and has therefore never seen a `.mjs`
// (`server/test/source-bytes.test.ts:30-36` says so by name). The bare-`node`
// mirror `shared/roster-json.mjs` will carry an ID LIST — it must, to stay
// stricter than the parser rather than laxer — with its agreement against
// `PROVIDER_IDS` asserted element for element by a test `gen-accounts.test.ts`
// gains alongside it. Both are Task 4's deliverable, not this one's — neither
// exists yet. A list is not a table; the table stays here.

/** How an operator gets a credential onto a lane. These five strings are the
 *  VOCABULARY: they are the values `ccrc account add --method` and
 *  `ccd account-pane --method` take, the `case` arms of `ccd-account-auth`, and
 *  the elements the deploy mirror's own `connect` column carries.
 *
 *  BARE, WITH NO `pane:` PREFIX, and the spec is read rather than contradicted.
 *  §4.2's table cell writes `pane:setup-token` and `pane:login` (spec:276,
 *  :279); every other mention writes the bare name — §5's `add` row takes
 *  `--method login|paste|setup-token` (:417), its `auth-start` row takes
 *  `--method login|setup-token|openai-login` (:423), and §6's own method table
 *  rows are `setup-token` and `openai-login` (:511-512). §6:547 then says in
 *  words what the prefix was standing for: "Only `setup-token` and
 *  `openai-login` need a terminal". So the prefix is PROSE ABOUT WHERE a method
 *  runs, not a spelling of its name — and the `openai` row proves it, because
 *  §4.2's `pane:login` and §6's `openai-login` are two different names rather
 *  than one name with a prefix: stripping `pane:` gives `login`, which is the
 *  ANTHROPIC method. A table carrying the prefixed spelling would make
 *  `--method setup-token` — a value spec:417 documents — refuse, and would need
 *  a translation table between this column and the helper's `case`, which is
 *  the seam this file exists to remove.
 *
 *  Which of them needs a terminal is not encoded in the name and does not need
 *  to be here: the only code that branches on it is the helper itself, whose
 *  `case` has one arm per method (`ccd/ccd-account-auth`, Tasks 52-55). */
export type ConnectMethod = 'login' | 'paste' | 'setup-token' | 'pkce' | 'openai-login';

/** What `ccrc account check` can ask of a lane. `auth status` exists only for
 *  the Anthropic lanes — it is Claude Code's own subcommand — so every other
 *  provider is proved live by inference alone (spec §8). */
export type ProbeKind = 'auth-status+inference' | 'inference';

/** One provider. Every field answers a question some surface asks; nothing here
 *  is decoration.
 *
 *  `envVar` is what the lane exports into its own `settings.json` `env` block
 *  (spec §4.3) — `null` for `openai`, whose launcher owns its own credential
 *  and takes nothing from ccrc.
 *
 *  `baseUrl` is the DEFAULT endpoint, `null` when there is none, and
 *  `baseUrlRequired` says whether absence is a refusal rather than a fallback.
 *  The two are not one field: `anthropic` has no default because Claude Code's
 *  own endpoint is the answer, while `compatible` has no default because only
 *  the operator can know one — same `null`, opposite meanings, and a caller
 *  that collapsed them would either refuse every Anthropic lane or accept a
 *  compatible lane pointing nowhere. */
export interface ProviderRow {
  /** Jargon-free, for a human — the string a card renders. */
  readonly label: string;
  /** What the operator is being asked for, in words, on the connect screen. */
  readonly credential: string;
  /** The environment variable the lane exports, or `null` if it exports none. */
  readonly envVar: string | null;
  /** In offer order; the first is the default the connect door opens on. */
  readonly connect: readonly ConnectMethod[];
  readonly probe: ProbeKind;
  /** The default endpoint, or `null` when this provider has none. */
  readonly baseUrl: string | null;
  /** Whether an absent endpoint is a REFUSAL (`base-url-required`, spec §5)
   *  rather than a fall-through to `baseUrl`. */
  readonly baseUrlRequired: boolean;
  /** Whether `ccrc account add` may create a lane for this provider at all.
   *  `openai` is `declare`-only: the launcher is somebody else's program. */
  readonly generatable: boolean;
  /** Whether `exec.models` is legal on a lane of this provider. The two
   *  api-key lanes carry a routing map and an allowlist; the two subscription
   *  lanes route on Claude Code's own aliases and would have nothing to put in
   *  one (spec §4.1). */
  readonly apiKeyModels: boolean;
  /** Whose public model catalogue the picker may fetch, or `null` for the lanes
   *  that have none — which is every lane but OpenRouter's, and the reason the
   *  `MODEL_ID_RE`-validated text field is a real arm and not a fallback
   *  nobody reaches (spec §4.3). */
  readonly catalogue: 'openrouter' | null;
}

/**
 * The table. Order is offer order: it is what `PROVIDER_IDS` inherits and what
 * the add sheet lists.
 */
export const PROVIDERS = {
  anthropic: {
    label: 'Claude subscription',
    credential: 'a signed-in config dir, or a long-lived OAuth token',
    envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    connect: ['login', 'paste', 'setup-token'],
    probe: 'auth-status+inference',
    baseUrl: null,
    baseUrlRequired: false,
    generatable: true,
    apiKeyModels: false,
    catalogue: null,
  },
  openrouter: {
    label: 'OpenRouter',
    credential: 'API key',
    envVar: 'ANTHROPIC_AUTH_TOKEN',
    connect: ['pkce', 'paste'],
    probe: 'inference',
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlRequired: false,
    generatable: true,
    apiKeyModels: true,
    catalogue: 'openrouter',
  },
  compatible: {
    label: 'Anthropic-compatible endpoint',
    credential: 'API key',
    envVar: 'ANTHROPIC_AUTH_TOKEN',
    connect: ['paste'],
    probe: 'inference',
    baseUrl: null,
    baseUrlRequired: true,
    generatable: true,
    apiKeyModels: true,
    catalogue: null,
  },
  openai: {
    label: 'ChatGPT subscription (external launcher)',
    credential: 'held by the launcher, never by ccrc',
    envVar: null,
    // §5:423 and §6:512's name for this method. §4.2's cell spells it
    // `pane:login`, which is not this name with a prefix — see `ConnectMethod`.
    connect: ['openai-login'],
    probe: 'inference',
    baseUrl: null,
    baseUrlRequired: false,
    generatable: false,
    apiKeyModels: false,
    catalogue: null,
  },
} as const satisfies Record<string, ProviderRow>;

/** The union, DERIVED from the table so the two can never name different sets. */
export type ProviderId = keyof typeof PROVIDERS;

/** The runtime list, in table order. `Object.keys`, exactly as
 *  `shared/api.ts:409`'s `PR_REASONS` is — a hand-written second list is the
 *  drift this file exists to prevent. */
export const PROVIDER_IDS: readonly ProviderId[] = Object.keys(PROVIDERS) as ProviderId[];

/** The providers `ccrc account add` may create a lane for. `openai` is not one:
 *  its launcher is a program ccrc records and never writes (spec §5, `declare`). */
export const GENERATABLE: readonly ProviderId[] =
  PROVIDER_IDS.filter((p) => PROVIDERS[p].generatable);

/** The only way to narrow an untrusted value to a `ProviderId` — the CONSTANT
 *  is cast, never the input, so this is a real type guard rather than an
 *  assertion dressed as one. Same shape as `isHue` (`shared/roster.ts:39`) and
 *  `isPrReason` (`shared/api.ts:426`). */
export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);
}

/** What `ccrc doctor`'s `accounts` check and the PWA's account fold can say
 *  about a lane, spelled once so the two render the same words (spec §14).
 *
 *  Each is an EXISTENCE claim, never a content one: `credential-declared-absent`
 *  is a roster `secretsFile` whose file is not there — measured by `ls`, never
 *  by opening it. */
export const ACCOUNT_FINDINGS = [
  'credential-declared-absent',
  'settings-env-drift',
  'launcher-absent',
] as const;
export type AccountFinding = (typeof ACCOUNT_FINDINGS)[number];
