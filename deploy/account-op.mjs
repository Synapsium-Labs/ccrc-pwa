#!/usr/bin/env node
// deploy/account-op.mjs — the ONE writer of `ccrc account`'s stdout.
//
// `ccd/ccrc` has no JSON emitter (`grep -c -- --json ccd/ccrc` → 0), and spec
// §5 requires exactly one JSON object per subcommand. The established split is
// `deploy/gen-accounts.mjs`'s, stated in that file's header at :4-11: bare
// `node`, no build step, no `tsx`, no compiled `dist/`; argv in, the RESULT on
// stdout, diagnostics on stderr under this tool's own name, and the SAME
// exit-code table `ccd/ccrc:24-33` prints to the operator — 0 ok, 1 the tool ran
// and the answer was bad, 2 a usage error. Nothing translates at the seam, which
// is `cmd_adopt`'s own argument for `exec "$BASH"` (ccd/ccrc:2921-2938: "the two
// tools already share ONE exit-code table … so nothing has to be translated at
// the seam", :2929-2930).
//
// ── WHO OWNS THE EXIT CODE ────────────────────────────────────────────────
// Whoever DECIDES. Every op except `refuse` decides its own class and exits
// with it, and `cmd_account` propagates. `refuse` is the exception and the
// reason is not cosmetic: bash reached its own verdict (a bad id, a suffix
// outside the read glob) and is asking this file only to WRITE the envelope, so
// this file exits 0 — "the envelope printed" — and bash exits with the class it
// chose. An op that also chose the class would give one refusal two owners.
//
// ── NO SECRET EVER REACHES THIS FILE ──────────────────────────────────────
// Not on argv (world-readable in /proc/<pid>/cmdline), not on stdin, not in a
// file it opens. `cmd_account` writes the lane's 0600 secrets file itself,
// in `_exp_env_write`'s umask-077 subshell (ccd/ccrc:3492-3544), and hands this
// file only the roster PATH the entry will name. That is why this CLI can be
// run by hand, logged, and traced without a containment argument.
//
// LOCAL DEPENDENCIES, COUNTED, because a fixture that copies this file has to
// copy its closure too (`ccrc-doctor.test.ts`'s `installCcrc`, Task 33): beyond
// `node:*`, this module imports `shared/roster-json.mjs` and — from Task 23's
// `check-add` — `shared/base-url.mjs`. `roster-json.mjs` itself imports exactly
// one thing, `./base-url.mjs` (Task 4, which stopped it re-spelling the endpoint
// gate), and `base-url.mjs` imports nothing at all. So the closure is three
// files and stays three.

import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
// FIVE CONSTANTS, IMPORTED AND NEVER RE-SPELLED (D-2004, D-2021, D-2022). They
// are the constants `rosterFromJson` itself decides with, so `check-add`
// refusing a hue, a label, a model id or a model map the writer would then
// refuse is one rule with one home rather than a pre-pass that has its own
// opinion. They cost this file no closure: it already imports from this module,
// and `shared/roster-json.mjs` is where all five were already declared —
// `export` is the whole of the change on that side.
//
// THE THREE THAT ARRIVED IN REVIEW ROUND 1 WERE A HAND COPY BEFORE THEY WERE AN
// IMPORT. `const ALIASES = ['opus','sonnet','haiku','subagent']` sat in the
// model block below, character for character `MODEL_ALIASES`, in the one file
// that already imports its module (D-2022). No scanner saw it —
// `single-definition.test.ts` looks for provider ROWS and named holders, not for
// an arbitrary list re-typed — which is why the rule "enumerated once and
// derived" needs the import to be the easy path rather than the remembered one.
import {
  API_KEY_PROVIDERS, HUES, LABEL_UNSAFE_RE, MODEL_ALIASES, MODEL_ID_RE,
  RosterInvalid, rosterFromJson,
} from '../shared/roster-json.mjs';
import { BASE_URL_OK } from '../shared/base-url.mjs';

const SELF = 'account-op';

/** THE SIXTH MIRROR, AND IT IS FOUR COLUMNS RATHER THAN FOUR ROWS.
 *  `shared/roster-json.mjs` already carries five hand-kept copies of
 *  `shared/roster.ts` rules (`ID_RE` :104, `SUFFIX_SAFE_RE` :111,
 *  `SECRETS_SAFE_RE` :117, `LABEL_UNSAFE_RE` :122, `HUES` :157) for one reason,
 *  stated in that file's header at :11-15: a bare `node` cannot import the
 *  TypeScript. This is the same wall and the same answer, for the four columns
 *  of `PROVIDERS` the FLEET BOX needs — which of the four providers `add` may
 *  take rather than `declare`, the one env var the 0600 file exports, the
 *  endpoint `add` materialises when the operator names none, and the connect
 *  methods that provider offers.
 *
 *  WHY FOUR CONSTANTS AND NOT ONE TABLE. `server/test/providers.test.ts` walks
 *  every tracked file for a second copy of the provider ROWS — a balanced
 *  `{…}` span naming two or more provider ids as KEYS with a `ProviderRow`
 *  field name inside it — and asserts that list is EMPTY, with no exemptions
 *  (D-1860). A row-shaped mirror here is precisely that span. So the columns
 *  live one per constant, keyed by id and carrying no field names, and the
 *  per-provider view every caller reads is COMPOSED from them below: the
 *  composing literal has the field names and no ids, the columns have the ids
 *  and no field names, and the two never meet inside one brace span. That is
 *  not a way around the scan — it is the difference the scan is drawn on. A
 *  column is a projection of one thing the table already says, checked against
 *  it; a row is a second table, which drifts.
 *
 *  It is a MIRROR, not a fork, and the difference is a mechanism: the
 *  `providers` op below prints the composed view verbatim, and
 *  `server/test/ccrc-account.test.ts` compares that answer to
 *  `shared/providers.ts`'s own projection — no import, no text scrape, red in
 *  BOTH directions on a new provider, a dropped one or a changed column.
 *
 *  §4.2's sentence survives intact: no `.mjs` copy of the TABLE exists. Labels,
 *  credential wording, probe kinds and the doctor vocabulary live in
 *  `shared/providers.ts` alone, and nothing here can answer a question about
 *  them. `single-definition.test.ts` cannot see this file at all — its
 *  `sources()` filters `/\.tsx?$/` at :54 (D-1860) — so the agreement test and
 *  the tracked-file scan are the mechanisms, not that one.
 *
 *  ── THE METHOD NAMES ARE THE FLAG VALUES ─────────────────────────────────
 *  Bare, no `pane:` prefix, and the column is called `connect` on both sides.
 *  `shared/providers.ts`'s `ConnectMethod` docstring carries the argument; the
 *  short form is that the spec spells these names three times as flag values
 *  and method-table rows (§5:417, §5:423, §6:511-512) and once, in §4.2's cell
 *  (:276, :279), as prose about where a method runs — which §6:547 then says in
 *  words. `check-add` validates the operator's `--method` against this list, so
 *  a prefixed spelling here would refuse `--method setup-token`, a value the
 *  spec documents.
 *
 *  ── THE TWO NULLS IN `defaultBaseUrl` MEAN DIFFERENT THINGS ──────────────
 *  `compatible` has none because the operator MUST state the endpoint;
 *  `anthropic` has none because Claude Code's own default IS the endpoint and
 *  the lane has no endpoint of its own (§4.2, spec:281-284). Nothing in that
 *  column tells them apart — `envVar` does, and `check-add` reads it there.
 *  See the endpoint block in Task 23. */
const PROVIDER_ENV_VAR = {
  anthropic: 'CLAUDE_CODE_OAUTH_TOKEN',
  openrouter: 'ANTHROPIC_AUTH_TOKEN',
  compatible: 'ANTHROPIC_AUTH_TOKEN',
  openai: null,
};

/** The DEFAULT endpoint per provider, `null` where there is none. Read the two
 *  nulls through the header above before adding a fifth row. */
const PROVIDER_BASE_URL = {
  anthropic: null,
  openrouter: 'https://openrouter.ai/api/v1',
  compatible: null,
  openai: null,
};

/** Offer order, and the first member is the default the connect door opens on —
 *  which is also what `check-add` uses when `--method` is absent. */
const PROVIDER_CONNECT = {
  anthropic: ['login', 'paste', 'setup-token'],
  openrouter: ['pkce', 'paste'],
  compatible: ['paste'],
  openai: ['openai-login'],
};

/** The providers `add` may create a lane for. `openai` is not one: its launcher
 *  is somebody else's program and `declare` is the verb for it (§4.2, §5). */
const PROVIDER_GENERATABLE = new Set(['anthropic', 'openrouter', 'compatible']);

/** The per-provider view every caller in this file reads, composed at load time
 *  from the four columns above. The keys are the UNION of all four columns'
 *  own keys, not `PROVIDER_ENV_VAR`'s alone — a stray id in any one column
 *  (a typo, a copy-paste leftover) has to surface in this composed view for
 *  the agreement test to catch it, rather than being silently dropped by
 *  whichever column iteration happened to pick. In the shipped table the four
 *  key sets agree, so the union is exactly `PROVIDER_IDS` today; a provider
 *  named in only three of the four columns would print `undefined` for the
 *  missing one here instead of vanishing, which is the visible failure this
 *  view exists to guarantee. `providers` prints this object; the agreement
 *  test rebuilds it from `shared/providers.ts` and compares. */
const PROVIDER_DEPLOY = Object.fromEntries(
  [...new Set([
    ...Object.keys(PROVIDER_ENV_VAR),
    ...Object.keys(PROVIDER_BASE_URL),
    ...Object.keys(PROVIDER_CONNECT),
    ...PROVIDER_GENERATABLE,
  ])].map((p) => [p, {
    generatable: PROVIDER_GENERATABLE.has(p),
    envVar: PROVIDER_ENV_VAR[p],
    defaultBaseUrl: PROVIDER_BASE_URL[p],
    connect: PROVIDER_CONNECT[p],
  }]),
);

/** THE ONE ROSTER READ IN THIS FILE. Every op that needs the roster calls this
 *  and returns 1 on `null`, so no op grows its own try/catch and no two ops can
 *  come to disagree about which failure is which. `check-add` (23),
 *  `add-entry` (24), `declare-entry` and `declared` (27), `lane` (28), `drop`
 *  and `removed` (32) all come through here. The ONE deliberate exception is
 *  Task 33's `doctor` op, which reads the same file LAXLY and argues why in its
 *  own task — `ccd/ccrc-doctor-checks:2253` already has a lax reader for that
 *  file, for that reason.
 *
 *  ABSENT AND UNREADABLE ARE TWO CODES. CLAUDE.md's D-114 rule: this
 *  repository's measured reads each tell those apart, and the convenience reads
 *  that fold them say so out loud. The remedies differ — `ccrc install` seeds a
 *  roster this box has never had; a permissions problem wants chmod and nothing
 *  else — and `ccd/ccd:958-965` already draws exactly this line over the same
 *  file's projection, with `-e` and `-r` as two separate refusals.
 *
 *  THE VALIDATOR IS THE GATE, NOT THE ANSWER: this returns the PARSED FILE, not
 *  `rosterFromJson`'s return literal (shared/roster-json.mjs:387-390), which
 *  carries eight fields — `id, label, configDirSuffix, homeAble, telemetry,
 *  hue, execKind, secretsFile` — and drops every other one. Measured today,
 *  that is four dropped fields the validator CHECKS: `hidden`, and
 *  `provider`/`baseUrl`/`models` from Task 3-4 on. An answer built from the
 *  return value would be a roster with four validated fields silently removed,
 *  which is the adapter-narrowing rule's exact shape. */
function readRoster(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      refuse('roster-absent',
        `${file} does not exist, so this box has no account roster yet. Run 'ccrc install' — it `
        + 'seeds one and never overwrites an existing one.');
    } else {
      refuse('roster-unreadable',
        `${file} exists and could not be read: ${e.message}. Regenerating it will not help; fix `
        + 'its permissions (it must be readable by the user this box runs as).');
    }
    return null;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    refuse('roster-invalid', `${file} is not valid JSON: ${e.message}`);
    return null;
  }
  try {
    rosterFromJson(json);
  } catch (e) {
    // The validator's own `remedy` reaches the caller VERBATIM —
    // `_inst_accounts_sh`'s rule (ccd/ccrc:4911-4915; D-2007 moved this cite).
    const remedy = e instanceof RosterInvalid && typeof e.remedy === 'string' ? ` ${e.remedy}` : '';
    refuse('roster-invalid', `${file}: ${e.message}${remedy}`);
    return null;
  }
  return json;
}

/** ── THE GATES `check-add` AND `check-declare` BOTH RUN (D-2143) ──────────
 *  ONE SPELLING, TWO CALLERS. The two verbs disagree about nearly everything —
 *  one writes a launcher, the other records somebody else's and never touches
 *  it — but they take the same `--label` and the same `--hue`, judged against
 *  the same two constants `rosterFromJson` itself decides with. A second
 *  spelling of either gate inside the new arm would be two deciders on one
 *  rule, free to drift the day a hue is added, so each gate lives here once and
 *  both arms call it.
 *
 *  THEY RETURN A CLASS, NOT A BOOLEAN (`ccd/ccrc:24-33`): 0 when they said
 *  nothing, 2 when the request was not legal on its face. The caller's own
 *  `return` is what leaves, so no gate here can decide an exit code for an arm
 *  that has more to say.
 *
 *  WHERE THE OTHER SHARED RULES LIVE, because "no second spelling" is a claim
 *  about the whole cluster and not about this file: the ID SHAPE is
 *  `ccd/ccrc`'s `_acct_id_or_refuse`, which both verbs already call; SUFFIX
 *  SAFETY is `_acct_suffix_or_refuse` in that same file, lifted out of
 *  `_acct_add_parse` when this task gave it a second caller; and the PROPOSED
 *  ENTRY is `declaredEntry` below, which `check-declare` and `declare-entry`
 *  both build from rather than each assembling their own.
 *
 *  WHAT IS DELIBERATELY *NOT* SHARED IS THE ENDPOINT BLOCK, and this is the
 *  line the sharing stops at. `check-add`'s base-url block does two things
 *  beyond judging a URL: it materialises the provider's DEFAULT endpoint, and
 *  it decides which lanes have an endpoint at all from the `envVar` column.
 *  Neither is true of a declared lane — D-2142: that endpoint belongs to
 *  somebody else's launcher, `declare` records what the operator said and
 *  defaults nothing — so sharing the URL half alone would leave the
 *  `base-url-required` half with the validator and put TWO vocabularies on one
 *  field. One field, one owner: for `declare` the owner is `rosterFromJson`,
 *  whose message reaches the operator verbatim (D-2142's "one refusal, one
 *  owner"). The rule that draws the line: a fault decidable against a CONSTANT
 *  SET this file already imports gets its own code, the same one `add` gives
 *  and from the same line; a fault about a value the validator owns end to end
 *  stays the validator's. */
function hueAndLabelClass(a) {
  // ── THE TWO IDENTITY GATES THIS PAIR USED TO ONLY CHECK FOR PRESENCE ────
  // D-2004. Until Task 24 `check-add` checked that `--hue` and `--label` were
  // GIVEN and nothing about what they said, so an unknown hue or a
  // control-character label was refused by `add-entry`'s `rosterFromJson` —
  // one step AFTER the caller had written the 0600 secrets file. Both are
  // decidable from argv alone, so they belong above the line that derives a
  // path, beside the id and provider gates rather than downstream of them.
  //
  // BOTH CONSTANTS ARE IMPORTED FROM THE VALIDATOR, not re-spelled here. The
  // writers' own `rosterFromJson(next)` calls still run and are not redundant:
  // `add-entry` and `declare-entry` are callable by hand, and each is its own
  // last gate. Two pre-passes, four callers, ONE validator.
  if (!HUES.has(a['hue'])) {
    refuse('unknown-hue',
      `"${a['hue']}" is not a hue this build knows. It knows: ${[...HUES].join(', ')}.`);
    return 2;
  }
  // A label is one line of display text and it reaches TWO renderers — the
  // PWA's DOM, where a stray newline is invisible, and
  // `ccd/statusline-command.sh`'s one-line terminal status bar, which
  // `server/src/pane/statusline.ts` then parses back out of a tmux capture. A
  // newline there splits the status line in two and the fleet view quietly
  // disagrees with the session; an escape byte is worse, because the label
  // recolours everything printed after it. `shared/roster.ts:610-627` carries
  // the argument and REFUSES rather than stripping, for the reason this file
  // refuses everywhere else: silently rewriting an operator's value is an
  // adapter narrowing a distinction it received.
  if (LABEL_UNSAFE_RE.test(a['label'])) {
    refuse('bad-label',
      `the label ${JSON.stringify(a['label'])} carries a control character. A label is one line `
      + 'of display text: it reaches a one-line terminal status bar that a tab or a newline '
      + 'splits, and an escape byte recolours everything printed after it. Give a label with no '
      + 'control characters in it.');
    return 2;
  }
  return 0;
}

/** IS THIS A PROVIDER AT ALL — the half of `check-add`'s provider block that
 *  both verbs mean. The OTHER half is `check-add`'s alone and must stay there:
 *  `!P.generatable` sends an `openai` request to `declare`, and `declare` is
 *  where it was sent. */
function providerKnownClass(provider) {
  if (!Object.hasOwn(PROVIDER_DEPLOY, provider)) {
    refuse('unknown-provider',
      `"${provider}" is not a provider this build knows. It knows: `
      + `${Object.keys(PROVIDER_DEPLOY).join(', ')}.`);
    return 2;
  }
  return 0;
}

/** THE ROSTER FACT BOTH VERBS NAME IDENTICALLY. Class 1, not 2: the request was
 *  legal on its face and the BOX said no (`ccd/ccrc:24-33`). */
function suffixFreeClass(accounts, suffix, file) {
  if (accounts.some((x) => x['configDirSuffix'] === suffix)) {
    refuse('suffix-collision',
      `config directory ${JSON.stringify(suffix)} already belongs to an account in `
      + `${file}. Two accounts sharing one CLAUDE_CONFIG_DIR share one set of transcripts, `
      + 'one settings.json and one credential.');
    return 1;
  }
  return 0;
}

/** THE PROPOSED `external` ENTRY, ASSEMBLED ONCE. `check-declare` judges this
 *  object and `declare-entry` writes it, and they must be the same object or
 *  the pre-pass is judging something other than what lands — the defect a
 *  second spelling here would produce silently, since both would still parse.
 *
 *  `external` IS THE DECLARED KIND: ccrc records where somebody else's launcher
 *  points and never writes that launcher (decision 22(c)). `provider` is
 *  optional on it — an entry with none is `undeclared` on the wire and offers
 *  no provider operation but enable/disable and remove (§4.1) — and `baseUrl`
 *  is declarative for exactly the reason `secretsFile` is.
 *
 *  `homeAble: false` and `telemetry: 'none'`, and neither is a placeholder. A
 *  declared launcher is not a lane ccd may LAND a session on unasked: its
 *  config dir is its own business, which is the same sentence
 *  `ccd/ccrc-doctor-checks` uses to explain why doctor asks only whether the
 *  file exists. `telemetry: 'none'` is what keeps a metered lane out of
 *  `CCRC_MEASURED`, which is what §4.6's `_ws_least_loaded` fix reads. The
 *  operator turns either on by editing the roster; the verb does not guess.
 *
 *  AND THE SUFFIX DEFAULT IS `.<id>`, NOT `add`'s `.claude-<id>` (D-2142),
 *  spelled HERE AND ONLY HERE — unlike `add`'s, which `_acct_add_parse` must
 *  also materialise before its own two suffix gates can measure it. `declare`
 *  needs no bash copy because its gate (`_acct_suffix_or_refuse`) runs only on
 *  a suffix the operator GAVE: the default is derived from an id
 *  `_acct_id_or_refuse` has already measured against `WRAPPER_ID_RE`, so
 *  `.<id>` is a safe one-segment name by construction and there is nothing for
 *  a gate to find. It is deliberately NOT gated against $HOME/.claude* the way
 *  `add`'s is: `add` creates and provisions that directory, so a suffix the
 *  agent could never read is a lane this box could roster and never show; a
 *  declared launcher's config dir is somebody else's, may not hold Claude Code
 *  transcripts at all, and an operator who wants it readable passes
 *  `--suffix .claude-<id>`. */
function declaredEntry(a) {
  const exec = { kind: 'external' };
  if (a['provider'] !== undefined) exec.provider = a['provider'];
  if (a['base-url'] !== undefined) exec.baseUrl = a['base-url'];
  return {
    id: a['id'], label: a['label'], hue: a['hue'],
    configDirSuffix: a['suffix'] ?? `.${a['id']}`,
    homeAble: false, telemetry: 'none', exec,
  };
}

/** DATA, in `CCRC_DOCTOR_CHECKS`'s shape (ccd/ccrc-doctor-checks:166) and
 *  `ccd/ccrc-api`'s `ROUTES` shape: one row per op, naming the keys it takes.
 *  `repeat` lists the keys that may appear more than once and arrive as an
 *  array — `candidates` (Task 21) is the first, and declaring the shape now is
 *  what keeps that task from rewriting this parser. */
const OPS = {
  refuse: { keys: ['code', 'detail'], repeat: [] },
  providers: { keys: [], repeat: [] },
  roster: { keys: ['file'], repeat: [] },
  // `name` and `bytes` arrive as PARALLEL ARRAYS, one pair per candidate, from
  // a bash loop that already ran doctor's candidate rule. They are repeatable
  // because the alternative — one JSON blob on argv — would put a value bash
  // built with `printf` back into the JSON-shaped position this file exists to
  // own.
  candidates: { keys: ['name', 'bytes'], repeat: ['name', 'bytes'] },
  'check-add': {
    keys: ['file', 'id', 'provider', 'label', 'hue', 'suffix', 'base-url', 'models', 'method'],
    repeat: [],
  },
  // ONE key carries the whole request, because `check-add` already resolved it:
  // `--plan` is that op's ANSWER, verbatim, and the arm below takes the `plan`
  // object out of it. Re-flattening it into nine keys would put this arm in the
  // business of re-deciding what the pre-pass decided, which is the seam Task 23
  // exists to remove.
  'add-entry': { keys: ['file', 'plan'], repeat: [] },
  // THE WHOLE ANSWER OF `ccrc account add`, COMPOSED HERE rather than in bash,
  // for the reason this file exists: `ccd/ccrc` has no JSON emitter, and a step
  // sentence with a quote in it assembled by `printf` would be the one place
  // this verb's contract could be broken by punctuation. `provisioned` and
  // `operator-step` REPEAT — parallel to `candidates`' pair, and for the same
  // argument: one JSON blob on argv would put a value bash built with `printf`
  // back into the JSON-shaped position this file owns.
  added: {
    keys: ['file', 'id', 'disabled', 'provisioned', 'operator-step'],
    repeat: ['provisioned', 'operator-step'],
  },
  // `declare` HAS A PRE-PASS, AND THIS COMMENT USED TO ARGUE IT DID NOT
  // (D-2143). What it said was that `add` needs `check-add` because `add`
  // writes a 0600 credential BEFORE the roster entry, while "`declare` writes
  // no secret and creates no launcher, so its only writer can also be its only
  // judge." That was sound when it was written and FALSE for the code shipped
  // beside it: D-2134's ordering, applied to `declare` at D-2140, puts the
  // kill-switch marker on disk BEFORE the roster entry. Something IS written
  // when the writer judges, so the writer cannot be the only judge — and the
  // measured consequence was an operator-visible split between two verbs typed
  // interchangeably (`add --hue puce` → `unknown-hue`, exit 2, nothing written;
  // `declare --hue puce` → `roster-invalid`, exit 1, marker on disk), against
  // the invariant the whole cluster is named for.
  //
  // So `check-declare` exists for `check-add`'s reason at a second address: a
  // request has to be judged while nothing is on disk, and the only way to do
  // that is a separate, side-effect-free op. NOT a `--dry-run` flag on
  // `declare-entry` — that would put a does-it-write switch on a write op, when
  // this architecture already answers that question with a separate op.
  //
  // The two rows take the SAME KEYS, deliberately: `_acct_declare` builds one
  // argv and passes it to both, so a key the judge cannot see is a key nobody
  // judged. `suffix` is optional and `provider`/`base-url` are the two
  // declarative fields §5 names.
  'check-declare': {
    keys: ['file', 'id', 'label', 'hue', 'suffix', 'provider', 'base-url'], repeat: [],
  },
  'declare-entry': {
    keys: ['file', 'id', 'label', 'hue', 'suffix', 'provider', 'base-url'], repeat: [],
  },
  declared: { keys: ['file', 'id', 'disabled'], repeat: [] },
};

function out(o) {
  process.stdout.write(`${JSON.stringify(o)}\n`);
}

/** The envelope `ccd/ccrc-api:122-126` established: machine-readable on stdout,
 *  the human sentence on stderr, one shape on every path so a caller never
 *  parses two. Unlike that one it does NOT exit — see the header. */
function refuse(code, detail) {
  out({ ok: false, error: code, detail });
  process.stderr.write(`${SELF}: ${detail} (${code})\n`);
}

/** `--key value` pairs, refused rather than ignored. An unknown key is a
 *  refusal because this file's whole caller is another program: a silently
 *  dropped `--base-url` would be an endpoint nobody notices missing.
 *
 *  THE WALK IS STRICT `i += 2` — every even slot from argv[3] on is read as a
 *  key, every odd slot as that key's value, no exceptions. A value that
 *  itself starts with `--` is refused rather than accepted: were it accepted,
 *  it would be consumed here as the PRECEDING key's value, and the token
 *  after it would then be read as the NEXT key instead of the value it
 *  actually is — silently shifting every pair that follows by one slot rather
 *  than failing loudly. `refuse --code --detail --detail z` is the
 *  reproduction: without this guard `--detail` (meant as the VALUE of
 *  `--code`) is swallowed as that value, and `z` is misread as `--detail`'s
 *  own key. No caller needs a literal value beginning with `--` today (every
 *  `--code`/`--detail` this file receives is an id, a class name or human
 *  prose), so refusing the shape is strictly safer than guessing which token
 *  was meant. */
function readPairs(argv, spec) {
  const got = {};
  for (let i = 3; i < argv.length; i += 2) {
    const k = argv[i];
    if (typeof k !== 'string' || !k.startsWith('--')) {
      refuse('bad-argv', `${JSON.stringify(k ?? '')} is not a --key`);
      return null;
    }
    const name = k.slice(2);
    if (!spec.keys.includes(name)) {
      refuse('bad-argv', `--${name} is not a key this op takes`);
      return null;
    }
    const v = argv[i + 1];
    if (v === undefined) {
      refuse('bad-argv', `--${name} has no value`);
      return null;
    }
    if (v.startsWith('--')) {
      refuse('bad-argv',
        `--${name}'s value ${JSON.stringify(v)} starts with "--" — that looks `
        + 'like the next --key, not a value, so it is refused rather than '
        + 'silently consumed and shifting every pair that follows');
      return null;
    }
    if (spec.repeat.includes(name)) {
      if (got[name] === undefined) got[name] = [];
      got[name].push(v);
    } else if (got[name] !== undefined) {
      refuse('bad-argv', `--${name} was given twice`);
      return null;
    } else {
      got[name] = v;
    }
  }
  return got;
}

function main(argv) {
  const op = argv[2];
  if (op === undefined || !Object.hasOwn(OPS, op)) {
    process.stderr.write(
      `usage: node deploy/account-op.mjs <${Object.keys(OPS).join('|')}> [--<key> <value>]…\n`);
    return 2;
  }
  const a = readPairs(argv, OPS[op]);
  if (a === null) return 2;

  if (op === 'providers') {
    out({ ok: true, providers: PROVIDER_DEPLOY });
    return 0;
  }

  if (op === 'roster') {
    const file = a['file'];
    if (file === undefined) { refuse('bad-argv', 'roster needs --file'); return 2; }
    const json = readRoster(file);
    if (json === null) return 1;
    out({ ok: true, roster: json });
    return 0;
  }

  if (op === 'check-add') {
    // EVERY REFUSAL IN THIS ARM FIRES BEFORE ANY CALLER HAS WRITTEN A BYTE, and
    // that is the whole reason `check-add` is a separate, side-effect-free op
    // rather than a paragraph inside Task 24's `add-entry`. Nothing below opens
    // a file for writing, and nothing may.
    const need = ['file', 'id', 'provider', 'label', 'hue'];
    for (const k of need) {
      if (a[k] === undefined) { refuse('bad-argv', `check-add needs --${k}`); return 2; }
    }
    const id = a['id'];
    const provider = a['provider'];

    // ── THE TWO IDENTITY GATES, SHARED WITH `check-declare` (D-2004, D-2143) ─
    // The gates and their sentences moved to `hueAndLabelClass` above when
    // `declare` grew a pre-pass that needs exactly these two; the arguments for
    // both live there. Nothing about this arm's order changed: they are still
    // decided from argv alone, above the line that derives a path.
    const identity = hueAndLabelClass(a);
    if (identity !== 0) return identity;

    // ── THE CONFIG DIRECTORY ────────────────────────────────────────────────
    // §4.4's default. `--suffix` is OPTIONAL here, unlike the five above, and
    // that is a DEVIATION FROM THE PLAN's own Step 3, which listed `suffix`
    // among the required keys while its Step 1 test asserted this arm defaults
    // it (`--suffix defaults to .claude-<id>`, the `'--suffix': null` sentinel)
    // — two halves of one plan that could not both be true. The test won,
    // because a `check-add` that refused a request `add` accepts would be a
    // pre-pass that does not pre-check the request actually made.
    //
    // IT IS SPELLED TWICE, AND THAT IS THE COST, said out loud rather than
    // hidden: `_acct_add_parse` (ccd/ccrc) also materialises `.claude-$ACCT_ID`,
    // because it must have a value before it can run its own two suffix gates
    // (`suffix-outside-read-root`, `bad-suffix`) — a gate cannot measure a
    // value that does not exist yet. So bash always passes `--suffix`, and this
    // branch is reachable only by a hand call to this file. Two spellings of one
    // rule is exactly what this repository forbids, so the agreement is a
    // MECHANISM rather than this paragraph: `ccrc-account.test.ts`'s
    // "`_acct_add_parse` and `check-add` default the config dir to the same
    // string" drives both and compares them, and reds if either moves.
    const suffix = a['suffix'] ?? `.claude-${id}`;

    // ── THE PROVIDER, AND WHICH VERB OWNS IT ────────────────────────────────
    // The "is it a provider at all" half is `providerKnownClass` above, shared
    // with `check-declare`; the half below is this arm's alone.
    const known = providerKnownClass(provider);
    if (known !== 0) return known;
    const P = PROVIDER_DEPLOY[provider];
    if (!P.generatable) {
      // §4.2: this lane is somebody else's launcher. `add` WRITES a wrapper;
      // `declare` records one it must never touch. Two verbs, because the two
      // acts differ in what ccrc is allowed to overwrite.
      refuse('external-provider-use-declare',
        `provider "${provider}" is an external launcher: ccrc records it and never writes it. `
        + `Use 'ccrc account declare --id ${id} --provider ${provider} …' once its executable is `
        + 'in ~/.local/bin.');
      return 2;
    }

    // ── THE METHOD ──────────────────────────────────────────────────────────
    const method = a['method'] ?? P.connect[0];
    if (!P.connect.includes(method)) {
      refuse('method-not-supported',
        `provider "${provider}" has no connect method "${method}". It has: ${P.connect.join(', ')}.`);
      return 2;
    }

    // ── THE MODEL MAP ───────────────────────────────────────────────────────
    // VALIDATED HERE, so nothing downstream parses it under a `set -u` shell or
    // inside a jq program. The four aliases are §4.3's, and an unknown one is a
    // REFUSAL rather than a silent drop: a key the operator typed and this box
    // discarded is a routing decision nobody made and nobody can see.
    //
    // ── D-2021: THE THREE CONDITIONS THAT USED TO REACH THE WRITER ──────────
    // Task 23 shipped this block checking the SHAPE of `--models` and nothing
    // the roster's own validator checks, so three requests passed the pre-pass,
    // took the credential, wrote the 0600 secrets file and only then met
    // `rosterFromJson` inside `add-entry`. MEASURED at c87819e4, each answering
    // `roster-invalid` at exit 1 with `~/.cc-secrets/<id>-<tag>.env` already on
    // disk:
    //
    //   1. `--models '{"opus":"x"}'` — `rosterFromJson` requires ALL FOUR
    //      aliases (shared/roster-json.mjs:305-312) and this block required
    //      none of them.
    //   2. `--models '{"opus":"a b", …}'` — every value must match
    //      `MODEL_ID_RE` (:150) and this block asked only for a non-empty
    //      string.
    //   3. `--provider anthropic --method paste --models '{…}'` —
    //      `exec.models` is refused outside `API_KEY_PROVIDERS` (:296-300) and
    //      this block accepted `--models` on any provider.
    //
    // FOUR CODES, NOT ONE, and none of them folded into `models-invalid`: the
    // three above are three different mistakes with three different fixes
    // (complete the map, correct a value, drop the flag or change the
    // provider), and a caller that rendered one sentence for all of them would
    // be the overloaded seam this arm's own base-url block refuses to be.
    //
    // ── AND `selectable`, WHICH IS THE OPPOSITE DISAGREEMENT ────────────────
    // `check-add` was STRICTER than the roster here, not laxer: the alias loop
    // below refused `models.selectable` as "not a routing alias" — and
    // `rosterFromJson` ACCEPTS that key and validates it (:313-339). Refusing it
    // at `add` is right and stays: wave 1's `add` offers the four aliases, the
    // `selectable` list is a per-entry catalogue with its own cross-check
    // against what the four route to, and a flag that silently half-carried it
    // would be worse than one that says no. But it must be a refusal that SAYS
    // SO. "not a routing alias" is a sentence about a key the roster format does
    // not have, and the roster format has this one — so it gets its own code and
    // its own sentence naming what it is and where it does belong. A refusal
    // that misnames the operator's key sends them to fix the wrong thing.
    let models = null;
    if (a['models'] !== undefined) {
      // THE LANE FIRST, before anything judges the value — `base-url-not-supported`
      // above is the same shape and the same order: a flag that cannot mean
      // anything on this provider is answered as a flag, not as a bad value.
      if (!API_KEY_PROVIDERS.has(provider)) {
        refuse('models-not-supported',
          `provider "${provider}" carries no model map, so --models cannot mean anything on this `
          + 'lane: it would be written into the roster and then refused by every reader of it. '
          + `Drop the flag, or add this account with one of: ${[...API_KEY_PROVIDERS].join(', ')}.`);
        return 2;
      }
      let parsed;
      try {
        parsed = JSON.parse(a['models']);
      } catch (e) {
        refuse('models-invalid', `--models is not valid JSON: ${e.message}`);
        return 2;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        refuse('models-invalid',
          '--models must be an object mapping the routing aliases to model ids, e.g. '
          + '{"opus":"<id>","sonnet":"<id>","haiku":"<id>","subagent":"<id>"}.');
        return 2;
      }
      for (const [k, v] of Object.entries(parsed)) {
        if (k === 'selectable') {
          refuse('selectable-not-supported',
            '--models carries "selectable". That IS a field of the roster\'s model map, and it is '
            + `not one this verb writes: 'ccrc account add' takes the four routing aliases `
            + `(${MODEL_ALIASES.join(', ')}) and nothing else. Add the account with those four, `
            + `then put "selectable" on its exec.models in ${a['file']} and run 'ccrc install'.`);
          return 2;
        }
        if (!MODEL_ALIASES.includes(k)) {
          refuse('models-invalid',
            `--models names "${k}", which is not a routing alias. The aliases are: `
            + `${MODEL_ALIASES.join(', ')}.`);
          return 2;
        }
        // THE VALUE, against the validator's own regex rather than against
        // "a non-empty string" — the old test admitted `a b`, which the writer
        // then refused one step after the secret was written. The sentence is
        // `rosterFromJson`'s own remedy (:307-310), because the operator is
        // fixing the same field either way and should not read two descriptions
        // of one rule.
        if (typeof v !== 'string' || !MODEL_ID_RE.test(v)) {
          refuse('bad-model-id',
            `--models maps "${k}" to ${JSON.stringify(v)}, which is not a model id: a letter or `
            + 'digit followed by up to 127 of letters, digits, ".", "_", ":", "/" and "-".');
          return 2;
        }
      }
      // ALL FOUR OR NONE. Last, so a map that is both incomplete and wrong is
      // answered about the value the operator actually typed before it is
      // answered about the ones they did not.
      const missing = MODEL_ALIASES.filter((k) => !Object.hasOwn(parsed, k));
      if (missing.length > 0) {
        refuse('models-incomplete',
          `--models is missing ${missing.join(', ')}. All four routing aliases are required when `
          + `--models is given — ${MODEL_ALIASES.join(', ')} — because a roster carrying a partial `
          + 'map is one no reader will parse. Give all four, or drop the flag.');
        return 2;
      }
      models = parsed;
    }

    // ── THE ENDPOINT ────────────────────────────────────────────────────────
    // FIRST, WHICH LANES HAVE ONE AT ALL. `defaultBaseUrl: null` appears twice
    // in the table and means two different things: `compatible` has no default
    // because the operator must state the endpoint, `anthropic` has none
    // because Claude Code's own default IS the endpoint (§4.2, spec:281-284).
    // A gate written as "no default and no flag → refuse" collapses those two
    // and refuses `ccrc account add --provider anthropic`, which spec:417
    // documents as legal and which three cases in this file assert. Spec:417
    // scopes the class in its own words: "`base-url-required` (provider
    // `compatible` with no `--base-url`)".
    //
    // The table tells the two apart WITHOUT a provider-name literal, and this
    // is the column that does it: an endpoint-bearing lane is one that exports
    // `ANTHROPIC_AUTH_TOKEN`, because §4.3's env block for exactly those lanes
    // is `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_API_KEY=""`
    // — the three keys the spec MEASURED on the fleet box (spec:310-311) — and
    // Task 25 writes that block from `plan.baseUrl`. A lane exporting
    // `CLAUDE_CODE_OAUTH_TOKEN` writes no `ANTHROPIC_BASE_URL` at all, and one
    // exporting nothing (`openai`) never got here — `!P.generatable` refused it
    // above. Read the predicate as "this lane names its own endpoint", not as
    // "this string equals that string": the day a fifth provider needs a
    // different answer, the honest fix is a column in `PROVIDERS` and its
    // mirror here, not a second clause bolted on below.
    const endpointBearing = P.envVar === 'ANTHROPIC_AUTH_TOKEN';
    const given = a['base-url'];
    if (!endpointBearing) {
      // NOT SILENTLY DROPPED. An earlier draft resolved the plan with
      // `baseUrl: provider === 'anthropic' ? null : baseUrl`, which validated
      // the operator's URL and then threw it away — a routing decision nobody
      // made and nobody can see, the same class of quiet discard the `--models`
      // block above refuses an unknown alias for. If the flag cannot mean
      // anything for this provider, saying so is the answer.
      if (given !== undefined) {
        refuse('base-url-not-supported',
          `provider "${provider}" has no endpoint of its own: its lane talks to Claude Code's own `
          + 'default, so --base-url would be recorded in the roster and never used by anything. '
          + 'Drop the flag, or use --provider compatible with that endpoint.');
        return 2;
      }
    }
    // MATERIALISED, not left absent, for the lanes that have one (§4.1 permits
    // absence and `add` never leans on it — the argument is at Task 24). One
    // gate, `BASE_URL_OK`, because a second spelling of it would be a second
    // decider on the one check standing between a lane's key and a clear-text
    // hop.
    const baseUrl = endpointBearing ? (given ?? P.defaultBaseUrl) : null;
    if (endpointBearing && baseUrl === null) {
      refuse('base-url-required',
        `provider "${provider}" has no default endpoint, so --base-url is required. Give the `
        + 'Anthropic-compatible endpoint this lane talks to, e.g. https://<host>/v1 or '
        + 'http://127.0.0.1:<port> for a loopback proxy.');
      return 2;
    }
    // ONE SENTENCE PER REASON, AND NO CODE TABLE BETWEEN THEM. `BASE_URL_OK`
    // answers `{ ok: false, reason }` where `reason` is ALREADY the refusal
    // code — `base-url-insecure`, not `insecure` — so this map is keyed on the
    // codes themselves and adds words, never names. A translation table here
    // (`{ insecure: 'base-url-insecure', … }`) would make the gate and the verb
    // two naming authorities for one decision, which is the seam the prefixed
    // spelling in `shared/base-url.mjs` exists to remove (§12.5 renders these
    // sentences; the codes travel on the wire in wave 2).
    const BASE_URL_SAYS = {
      'base-url-unparseable': 'it does not parse as a URL at all — give a full one, scheme included.',
      'base-url-insecure': 'it is plain http: and the host is not a loopback literal, so the key '
        + 'would cross the network in clear.',
      'base-url-credentials': 'it carries user:pass@ — a URL is not a place to keep a key.',
      'base-url-query': 'it carries a query string, which this box would send on every request '
        + 'without ever showing it to you.',
      'base-url-fragment': 'it carries a #fragment, which no HTTP client ever sends — so the '
        + 'endpoint you meant is not the one this would use.',
    };
    // A lane with no endpoint has nothing for the gate to judge, and calling it
    // on `null` would be asking a URL question about the absence of a URL. The
    // only way to reach here with `null` is the not-endpoint-bearing arm above,
    // which has already refused a flag if one was given. `null` is therefore
    // "no question asked", distinct from a verdict, and it is what the plan
    // stores for such a lane.
    const verdict = baseUrl === null ? null : BASE_URL_OK(baseUrl);
    if (verdict !== null && !verdict.ok) {
      if (!Object.hasOwn(BASE_URL_SAYS, verdict.reason)) {
        // A reason this build has no sentence for is a BUG, and it says so
        // rather than inventing a class. `BASE_URL_OK` and this table ship
        // together; the day they do not, this is the line that says which one
        // moved.
        refuse('base-url-unknown-verdict',
          `BASE_URL_OK answered ${JSON.stringify(verdict.reason)}, which this build has no refusal `
          + 'for — this is a bug in ccrc, not a fact about your endpoint, and nothing was written.');
        return 1;
      }
      refuse(verdict.reason,
        `--base-url ${JSON.stringify(baseUrl)} is not usable: ${BASE_URL_SAYS[verdict.reason]}`);
      return 2;
    }
    // THE NORMALISED VALUE IS WHAT GETS STORED, never the operator's bytes.
    // `URL` lower-cases the scheme and the host and leaves the path alone, and
    // it supplies a root path where the input had none — so `http://127.0.0.1:8642`
    // resolves as `http://127.0.0.1:8642/` and `HTTPS://Orchard-API/V1` as
    // `https://orchard-api/V1`. §4.1 shows the endpoint on the card, doctor
    // compares it against `settings.json` and Task 25 writes it there, so a
    // stored value that differs from the resolved one is two answers to one
    // question (`shared/base-url.ts`'s header makes the argument). It also
    // ends the embedded-newline hazard on this field for free: `new URL()`
    // strips a raw LF while parsing, so `https://orchard-api/v1<LF>x` is stored
    // as `https://orchard-api/v1x` — measured 2026-09-07, node 22.
    const resolvedBaseUrl = verdict === null ? null : verdict.url;

    // ── THE ROSTER: THE TWO REFUSALS THAT PROTECT AN EXISTING LANE ──────────
    const json = readRoster(a['file']);
    if (json === null) return 1;
    const accounts = json['accounts'];
    if (accounts.some((x) => x['id'] === id)) {
      // THE ONE REFUSAL THAT MUST COME BEFORE THE SECRET WRITE, and the reason
      // `check-add` is a separate op at all: `~/.cc-secrets/<id>-<tag>.env`
      // for an id already in the roster is ANOTHER LANE'S credential file. A run
      // that wrote first and refused second would have destroyed a working
      // lane's token in order to say no.
      refuse('duplicate-id',
        `account "${id}" is already in ${a['file']}. Use 'ccrc account credential --id ${id} `
        + "--credential -' to replace its key, or pick another id.");
      return 1;
    }
    // THE SECOND, shared with `check-declare` — one config directory, one
    // account, whichever verb is asking.
    const free = suffixFreeClass(accounts, suffix, a['file']);
    if (free !== 0) return free;

    // ── WHAT TASKS 24 AND 25 WRITE FROM ─────────────────────────────────────
    // The RESOLVED plan, computed once, here, so no later step re-derives a
    // decision this one already made. `login` lanes carry no secrets file: the
    // credential is the config dir's own .credentials.json.
    //
    // `baseUrl` is whatever the endpoint block above resolved — null for a lane
    // with no endpoint of its own, the gate's NORMALISED `url` otherwise. It is
    // NOT re-decided here: a second `provider === 'anthropic' ? null : …`
    // ternary at this line (the shape an earlier draft had) would be a second
    // decider on the same question, and the two disagreed — the block above
    // refused the request the ternary was written to soften.
    const isToken = method !== 'login';
    // THE SECRETS FILE IS NAMED FOR WHAT IT CARRIES, not for who issued it, and
    // the spec says both things in different sections: §5:417 writes the general
    // shape `~/.cc-secrets/X-P.env`, §4.3:322 writes the api-key lane's real
    // name `~/.cc-secrets/<id>-openrouter.env`, and §6:511, §7:476, §11 and
    // §12.5 write the OAuth lane's real name `~/.cc-secrets/<id>-oauth.env`.
    // Only the second and third are names of files that exist: every anthropic
    // lane on this fleet carries the `-oauth` spelling today
    // (`server/test/helpers.ts:69` is `.cc-secrets/claude-a-oauth.env`), and the
    // two illustrative remedies in the tree — `shared/roster.ts:499` and
    // `shared/wrapper.mjs:132-133` — spell it that way too.
    //
    // It has to be ONE rule, because three writers derive this path and a
    // disagreement between them is a lane whose wrapper sources a file nothing
    // wrote: this line, `_acct_write_secret` (Task 22/24), and
    // `ccd-account-auth`'s `setup-token` capture (Task 54), which mints an OAuth
    // token into `~/.cc-secrets/<id>-oauth.env` on a lane that already exists.
    // The rule is the `envVar` column, the same derivation the endpoint block
    // above uses: a lane exporting `CLAUDE_CODE_OAUTH_TOKEN` holds an OAuth
    // token and its file is `<id>-oauth.env`; an api-key lane's file is
    // `<id>-<provider>.env`, which is §4.3's own spelling.
    const secretTag = P.envVar === 'CLAUDE_CODE_OAUTH_TOKEN' ? 'oauth' : provider;
    out({
      ok: true,
      plan: {
        id,
        provider,
        label: a['label'],
        hue: a['hue'],
        configDirSuffix: suffix,
        method,
        baseUrl: resolvedBaseUrl,
        secretsFile: isToken && P.envVar !== null ? `.cc-secrets/${id}-${secretTag}.env` : null,
        envVar: isToken ? P.envVar : null,
        // The PARSED object, not the string bash handed over — `add-entry`
        // writes it into the roster and Task 25 hands it to jq with
        // `--argjson`, and neither should be the place a parse failure lands.
        models,
      },
    });
    return 0;
  }

  if (op === 'add-entry') {
    // THE WRITER. Everything it needs was DECIDED by `check-add` and travels in
    // `--plan`; this arm re-derives nothing. `configDirSuffix` in particular is
    // taken off the plan and never rebuilt from the id (D-2003): `.claude-<id>`
    // is already spelled twice on purpose — `_acct_add_parse`, which must
    // materialise it before its own two suffix gates can measure it, and
    // `check-add`, which must resolve a complete plan for a hand caller — and a
    // third spelling here would be one this repository forbids outright, with
    // no test standing over it.
    if (a['file'] === undefined || a['plan'] === undefined) {
      refuse('bad-argv', 'add-entry needs --file and --plan'); return 2;
    }
    let answer;
    try {
      answer = JSON.parse(a['plan']);
    } catch (e) {
      refuse('bad-argv', `the value of --plan is not valid JSON: ${e.message}`); return 2;
    }
    // `--plan` IS `check-add`'s WHOLE ANSWER, not its `plan` field alone, and
    // the seam is that way round on purpose: `_acct_add` captured that op's
    // stdout and hands the same bytes back — the very bytes it re-emits
    // verbatim when `check-add` REFUSED — so nothing in bash reshapes an answer
    // node wrote. This arm takes the one field it needs out of it and REFUSES
    // when that field is not there, because the alternative is what the first
    // draft of this task actually did: write an entry whose every field is
    // `undefined` and let `rosterFromJson` report it as `an invalid id
    // undefined`, which names neither the caller's mistake nor its fix.
    //
    // THE OBJECT TEST IS SPELLED THE WAY THE `--models` BLOCK ABOVE SPELLS IT
    // (`parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)`)
    // rather than borrowed from `shared/roster-json.mjs`'s `isPlainObject`: that
    // helper is not exported, and exporting a JS type test to save one line here
    // would put a validator-internal name on this file's import list for no
    // decision it makes.
    const plan = answer !== null && typeof answer === 'object' && !Array.isArray(answer)
      ? answer['plan'] : undefined;
    if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
      refuse('bad-argv',
        'the value of --plan is not a check-add answer: it carries no "plan" object. Pass that '
        + "op's stdout through unchanged rather than unwrapping it.");
      return 2;
    }
    const json = readRoster(a['file']);
    if (json === null) return 1;

    // THE ENTRY. `exec` carries every provider field and NOTHING else — §4.1's
    // shape, where the account-level keys (ACCOUNT_KEYS, shared/roster.ts:310)
    // do not change and every new field lives on exec. Absent values are
    // OMITTED rather than written null: `parseRoster` is absence-permitting and
    // a null would be a value it must then have an opinion about. `plan.models`
    // arrives PARSED — `check-add` validated it (Task 23) so that no JSON parse
    // lands here, where a throw would exit with a stack trace and an empty
    // stdout.
    const exec = { kind: 'generated', provider: plan.provider };
    if (plan.baseUrl !== null) exec.baseUrl = plan.baseUrl;
    if (plan.secretsFile !== null) exec.secretsFile = plan.secretsFile;
    if (plan.models !== null) exec.models = plan.models;
    const entry = {
      id: plan.id, label: plan.label, configDirSuffix: plan.configDirSuffix, exec,
      // A NEW LANE IS HOME-ABLE AND CARRIES ANTHROPIC-SHAPED TELEMETRY. Both are
      // facts about a generated wrapper: it sets CLAUDE_CONFIG_DIR, so ccd can
      // land a session on it, and the statusline writes ~/.cc-limits/<id>.json
      // for it (statusline-command.sh:244-251). `homeAble` is what
      // `_ws_least_loaded` reads and `$REG/<id>-disabled` is what holds it back
      // until the lane has been measured (Task 26) — two different questions,
      // and collapsing them into `homeAble: false` would make a working lane
      // permanently unplaceable rather than merely switched off.
      homeAble: true, hue: plan.hue, telemetry: 'anthropic',
    };

    const next = { ...json, accounts: [...json['accounts'], entry] };

    // VALIDATED BEFORE IT IS WRITTEN, through the same validator every other
    // reader uses. `_inst_roster`'s rule (ccd/ccrc:4882-4887): seeding a roster
    // a box cannot parse poisons that box, because the rule that makes the file
    // safe to own — never overwritten — is what stops the next run fixing it.
    try {
      rosterFromJson(next);
    } catch (e) {
      const remedy = e instanceof RosterInvalid && typeof e.remedy === 'string' ? ` ${e.remedy}` : '';
      refuse('roster-invalid',
        `the entry for "${plan.id}" would make ${a['file']} unparseable: ${e.message}${remedy}`);
      return 1;
    }

    // tmp + rename in the same directory, `_inst_accounts_sh`'s discipline
    // (:4926-4928). The file is USER-OWNED and this verb is its first writer in
    // this CLI — a deliberate, argued exception to the seed-once class
    // (`_inst_roster`), and the reason the write is atomic rather than an
    // in-place edit: an operator's roster must never be observable half-written.
    //
    // AND THE MODE IS THE FILE'S OWN, NOT A LITERAL (D-2052). `renameSync`
    // replaces the inode, so whatever mode the tmp carries BECOMES the roster's
    // mode — a hard-coded `0o644` here silently discarded an operator's
    // `chmod 600 ~/.ccrc/accounts.json` on every `add` (measured: 600 before,
    // 644 after). A file's mode is a distinction this verb RECEIVED from the
    // operator, on the one file this CLI otherwise treats as theirs, and the
    // same premise the atomic write is argued from forbids widening it.
    // `_inst_roster`'s `cp` + `mv` leaves the mode to umask and imposes
    // nothing, so this verb is no longer the one writer of that file that
    // overrides the operator. THE TREE HAS ALREADY RULED ON THIS EXACT SHAPE:
    // `_inst_graph_always_on_off` reads the file's own mode before rewriting it
    // (`ccd/ccrc:6358-6364`, D-1244 — "forcing 644 would widen a CLAUDE.md an
    // operator had restricted"). This is that ruling at a second address.
    //
    // `& 0o777` DROPS THE SPECIAL NIBBLE (setuid/setgid/sticky), unlike
    // `_plat_mode`'s `%Mp%Lp`, and that is right for this file: a roster is
    // JSON that nothing executes, so there is no setuid bit worth carrying and
    // propagating one through a rename would be a widening of its own.
    //
    // `statSync` IS UNGUARDED ON PURPOSE: `readRoster` above read this same
    // path and returned non-null, so the file provably exists — there is no
    // absent case to fold. A throw here is a real fault and the `catch` below
    // reports it as `roster-write`, which is what it is.
    //
    // ONE THING THIS DOES NOT CHANGE, said rather than left to be discovered:
    // `writeFileSync`'s `mode` is masked by the process umask at CREATE, so a
    // 0664 roster under umask 022 still lands 0644 — exactly as the `0o644`
    // literal did. Carrying the mode on the create rather than chmod-ing the
    // tmp afterwards is deliberate: the tmp is never WIDER than the file it
    // replaces for an instant, which is `_acct_write_secret`'s umask argument
    // (ccd/ccrc:4144-4147) at this address.
    const tmp = `${a['file']}.tmp.${process.pid}`;
    try {
      writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`,
        { mode: statSync(a['file']).mode & 0o777 });
      renameSync(tmp, a['file']);
    } catch (e) {
      try { unlinkSync(tmp); } catch { /* the failure above is the one to report */ }
      refuse('roster-write', `writing ${a['file']} failed: ${e.message} — nothing was changed`);
      return 1;
    }
    out({ ok: true, roster: next });
    return 0;
  }

  if (op === 'candidates') {
    const names = a['name'] ?? [];
    const bytes = a['bytes'] ?? [];
    if (names.length !== bytes.length) {
      // A count mismatch is the ONLY way a size could be attached to the wrong
      // name, and a misaligned index cannot be trusted about any of them —
      // `cmd_wrappers`' witness-index rule (ccd/ccrc:2596-2599), verbatim.
      refuse('bad-argv', `candidates got ${names.length} --name and ${bytes.length} --bytes`);
      return 2;
    }
    const list = [];
    for (let i = 0; i < names.length; i++) {
      if (!/^[0-9]+$/.test(bytes[i])) {
        refuse('bad-argv', `--bytes for "${names[i]}" is not a number`);
        return 2;
      }
      list.push({ name: names[i], bytes: Number(bytes[i]) });
    }
    out({ ok: true, candidates: list });
    return 0;
  }

  if (op === 'added') {
    // `--file` and `--id` are the request; `--provisioned` and `--operator-step`
    // are lists that may legitimately be empty, so their absence is not a fault.
    for (const k of ['file', 'id']) {
      if (a[k] === undefined) { refuse('bad-argv', `added needs --${k}`); return 2; }
    }
    // A BOOLEAN ON THE WIRE, not the string bash handed over: the caller renders
    // a switch from it, and `"false"` is truthy in every language that will read
    // this.
    //
    // AND THE CONVERSION IS TOTAL, which is a DEVIATION from this task's plan
    // snippet (`disabled: a['disabled'] === 'true'`) and is the same argument
    // carried one step further. That expression maps every value that is not the
    // exact word `true` — a typo, a missing flag, `False`, `1` — to `false`,
    // which publishes "this lane is ON" about a lane that is off: an overloaded
    // seam of exactly the class this cluster keeps closing, in the one field an
    // operator acts on. There is one caller and it always passes one of the two
    // words, so the shape is refusable rather than guessable.
    if (a['disabled'] !== 'true' && a['disabled'] !== 'false') {
      refuse('bad-argv',
        `added needs --disabled true or --disabled false, and got ${JSON.stringify(a['disabled'] ?? null)}`
        + ' — this field says whether the new lane is switched off, so a value this file '
        + 'would have to guess at is refused rather than read as "on"');
      return 2;
    }
    const json = readRoster(a['file']);
    if (json === null) return 1;
    out({
      ok: true,
      id: a['id'],
      disabled: a['disabled'] === 'true',
      provisioned: a['provisioned'] ?? [],
      'operator-steps': a['operator-step'] ?? [],
      roster: json,
    });
    return 0;
  }

  if (op === 'check-declare') {
    // EVERY REFUSAL IN THIS ARM FIRES BEFORE ITS CALLER HAS WRITTEN A BYTE —
    // `check-add`'s opening sentence at this arm's own address, and the whole
    // reason the op exists (D-2143). `_acct_declare` calls it BEFORE the
    // kill-switch marker, which is the first thing that verb puts on disk.
    // Nothing below opens a file for writing, and nothing may.
    for (const k of ['file', 'id', 'label', 'hue']) {
      if (a[k] === undefined) { refuse('bad-argv', `check-declare needs --${k}`); return 2; }
    }
    const identity = hueAndLabelClass(a);
    if (identity !== 0) return identity;
    // OPTIONAL, SO THE GATE IS CONDITIONAL AND THE ABSENCE IS NOT A FAULT: an
    // entry with no provider is `undeclared` on the wire (§4.1). What is a
    // fault is a provider nothing knows, and it is decidable from argv against
    // a constant set — class 2, the same code and the same line `add` uses.
    if (a['provider'] !== undefined) {
      const known = providerKnownClass(a['provider']);
      if (known !== 0) return known;
    }
    const json = readRoster(a['file']);
    if (json === null) return 1;
    const entry = declaredEntry(a);
    const free = suffixFreeClass(json['accounts'], entry.configDirSuffix, a['file']);
    if (free !== 0) return free;
    // THE SAME VALIDATOR THE WRITER RUNS, ON THE SAME OBJECT THE WRITER BUILDS.
    // This is the gate that makes the op worth having rather than a list of
    // three checks: it catches every field-validity fault the constants above
    // do not name — a bad endpoint, a `compatible` lane with none, a
    // configDirSuffix the validator refuses — and it catches them with NOTHING
    // on disk. It also closes a window the bash side cannot: `_acct_declare`'s
    // `duplicate-id` gate reads `~/.ccrc/accounts.sh`, the PROJECTION, while
    // this reads `~/.ccrc/accounts.json` itself, so an id already in the roster
    // and not yet in a stale projection is refused HERE — before the marker,
    // which is D-2137's hazard measured rather than argued.
    //
    // THE CLASS IS 1 AND THE MESSAGE IS THE VALIDATOR'S, VERBATIM (D-2142).
    // Not translated into a table of this file's own codes: for a declared lane
    // the endpoint and the config directory belong to somebody else's launcher,
    // `declare` defaults neither, and one field with two vocabularies is the
    // seam this cluster keeps closing. One refusal, one owner.
    try {
      rosterFromJson({ ...json, accounts: [...json['accounts'], entry] });
    } catch (e) {
      const remedy = e instanceof RosterInvalid && typeof e.remedy === 'string' ? ` ${e.remedy}` : '';
      refuse('roster-invalid',
        `declaring "${a['id']}" would make ${a['file']} unparseable: ${e.message}${remedy}`);
      return 1;
    }
    // THE ENTRY IT JUDGED, so a hand caller can read what would be written and
    // `_acct_read_op` has a body to measure. `declare-entry` does NOT take it
    // back as a `--plan` the way `add-entry` does, and that is not an
    // inconsistency: `add`'s plan carries decisions `check-add` RESOLVED (a
    // materialised endpoint, a secrets-file name, a method default) which no
    // later step may re-derive, while this arm resolves nothing — every field
    // here is the operator's own value or `declaredEntry`'s constant, and both
    // ops build it from that one function.
    out({ ok: true, entry });
    return 0;
  }

  if (op === 'declare-entry') {
    for (const k of ['file', 'id', 'label', 'hue']) {
      if (a[k] === undefined) { refuse('bad-argv', `declare-entry needs --${k}`); return 2; }
    }
    // THROUGH `readRoster`, THE MODULE'S ONE READER. It is not a convenience: it
    // is the only place that tells this file's three read conditions apart —
    // `roster-absent` (ENOENT), `roster-unreadable` (there and unopenable, a
    // permissions fix rather than a regeneration) and `roster-invalid` (there and
    // not a roster, carrying the validator's own remedy verbatim) — and a second
    // reader here would collapse them into one code that tells the operator to do
    // the wrong thing twice out of three times. It also validates, which is the
    // FIRST of the two refusals below.
    const json = readRoster(a['file']);
    if (json === null) return 1;
    // TWO REFUSALS, NOT ONE, and the difference is the operator's next move:
    // "the roster you already had does not validate" is a file to fix — that is
    // `readRoster`'s `roster-invalid`, above — and "the entry you asked for would
    // break it" is a flag to change, which is the check after the append.
    //
    // THE ENTRY IS `declaredEntry`'S, NOT ASSEMBLED HERE (D-2143). `check-declare`
    // judges the same object this writes, and a second spelling of the assembly
    // would be a pre-pass judging something other than what lands — a
    // disagreement no parser could see, since both shapes would still validate.
    // Every argument about the three fields this verb DECIDES rather than takes
    // (`homeAble`, `telemetry`, the `.<id>` suffix default) lives on that
    // function.
    //
    // AND THE `rosterFromJson` BELOW IS STILL NOT REDUNDANT, for `add-entry`'s
    // reason: this op is callable by hand without the pre-pass, and it is the
    // writer's own last gate. Two gates, two callers, ONE validator.
    const entry = declaredEntry(a);
    const next = { ...json, accounts: [...json['accounts'], entry] };
    try {
      rosterFromJson(next);
    } catch (e) {
      const remedy = e instanceof RosterInvalid && typeof e.remedy === 'string' ? ` ${e.remedy}` : '';
      refuse('roster-invalid',
        `declaring "${a['id']}" would make ${a['file']} unparseable: ${e.message}${remedy}`);
      return 1;
    }
    // tmp + rename in the same directory, `_inst_accounts_sh`'s discipline: an
    // operator's roster must never be observable half-written. AND THE MODE IS
    // THE FILE'S OWN, NOT A LITERAL (D-2052, a DEVIATION from this task's plan
    // snippet, which spelled `0o644`): `renameSync` replaces the inode, so a
    // literal would silently widen a roster its operator had chmod-ed 0600.
    // `statSync` is unguarded for `add-entry`'s reason — `readRoster` above read
    // this same path a few lines ago.
    const tmp = `${a['file']}.tmp.${process.pid}`;
    try {
      writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`,
        { mode: statSync(a['file']).mode & 0o777 });
      renameSync(tmp, a['file']);
    } catch (e) {
      try { unlinkSync(tmp); } catch { /* the failure above is the one to report */ }
      refuse('roster-write', `writing ${a['file']} failed: ${e.message} — nothing was changed`);
      return 1;
    }
    // SILENT ON SUCCESS, which is a CONTRACT and not a shrug: `_acct_write_op`
    // refuses `helper-noisy` if this path ever prints, because the answer is
    // `declared`'s and two JSON objects on one stdout is the seam bash closes.
    return 0;
  }

  if (op === 'declared') {
    for (const k of ['file', 'id']) {
      if (a[k] === undefined) { refuse('bad-argv', `declared needs --${k}`); return 2; }
    }
    // A BOOLEAN ON THE WIRE, not the string bash handed over, and the conversion
    // is TOTAL — `added`'s rule (D-2131) at a second address. `=== 'true'` alone
    // maps every other value, a typo included, to `false`, which publishes "this
    // lane is ON" about a lane that is off.
    if (a['disabled'] !== 'true' && a['disabled'] !== 'false') {
      refuse('bad-argv',
        `declared needs --disabled true or --disabled false, and got ${JSON.stringify(a['disabled'] ?? null)}`
        + ' — this field says whether the new lane is switched off, so a value this file '
        + 'would have to guess at is refused rather than read as "on"');
      return 2;
    }
    // `readRoster` again, for the reason above: one reader, three conditions,
    // and the validator's remedy reaching the operator verbatim.
    const json = readRoster(a['file']);
    if (json === null) return 1;
    // THE KIND IS MEASURED OFF THE ENTRY, NOT SPELLED AS A CONSTANT — a
    // DEVIATION from this task's plan snippet (`kind: 'external'`). The same
    // answer carries the whole roster, so a literal beside it would be two
    // spellings of one value, free to disagree the day this op answers for an
    // entry it did not write. That leaves exactly one condition to name rather
    // than guess, and it is a bug in ccrc rather than a fact about the box:
    // `_acct_declare` calls this immediately after `declare-entry` landed the
    // entry, so an id the roster does not carry means the two disagree.
    const entry = json['accounts'].find((x) => x !== null && typeof x === 'object' && x['id'] === a['id']);
    if (entry === undefined) {
      refuse('internal-no-entry',
        `${a['file']} carries no account "${a['id']}", so this run cannot report what was `
        + 'declared — this is a bug in ccrc, not a fact about your box. Read the roster back '
        + "with 'ccrc account roster'.");
      return 1;
    }
    out({
      ok: true,
      id: a['id'],
      kind: entry['exec']['kind'],
      disabled: a['disabled'] === 'true',
      roster: json,
    });
    return 0;
  }

  // `refuse` — SEAM HAZARD, DOCUMENTED RATHER THAN CLOSED (review round 1,
  // M7). Every bad-argv exit from this file (a `readPairs` refusal above, or
  // the one below) ALREADY wrote a JSON envelope to stdout via `refuse()` —
  // this op's own contract is "exit 0, envelope printed" only for a
  // WELL-FORMED call, and exit 2 here still means an envelope reached
  // stdout, just the "bad-argv" one rather than the caller's intended
  // "$2"/"$3". `ccd/ccrc`'s `_acct_refuse` (its own header carries the other
  // half of this note) treats ANY non-zero exit from `_acct_node refuse …`
  // as "no envelope was printed", which is only true when node itself never
  // ran main() to completion — not when main() ran and refused the CALL.
  // Unreachable via `_acct_refuse` today (its argv shape is fixed), but a
  // future caller of `refuse` with variable argv would hit it. Left as a
  // trap rather than fixed here: the fix is a seam change (the caller would
  // need to tell "no envelope" from "wrong envelope" apart), not a comment.
  if (a['code'] === undefined || a['detail'] === undefined) {
    refuse('bad-argv', 'refuse needs --code and --detail');
    return 2;
  }
  refuse(a['code'], a['detail']);
  return 0;
}

process.exitCode = main(process.argv);
