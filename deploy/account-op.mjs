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
// is `cmd_adopt`'s own argument for `exec "$BASH"` (ccd/ccrc:2908-2922: "the two
// tools already share ONE exit-code table … so nothing has to be translated at
// the seam", :2916-2917).
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
// in `_exp_env_write`'s umask-077 subshell (ccd/ccrc:3479-3531), and hands this
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

import { readFileSync } from 'node:fs';
import { RosterInvalid, rosterFromJson } from '../shared/roster-json.mjs';
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
    // `_inst_accounts_sh`'s rule (ccd/ccrc:4396-4399).
    const remedy = e instanceof RosterInvalid && typeof e.remedy === 'string' ? ` ${e.remedy}` : '';
    refuse('roster-invalid', `${file}: ${e.message}${remedy}`);
    return null;
  }
  return json;
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
    if (!Object.hasOwn(PROVIDER_DEPLOY, provider)) {
      refuse('unknown-provider',
        `"${provider}" is not a provider this build knows. It knows: `
        + `${Object.keys(PROVIDER_DEPLOY).join(', ')}.`);
      return 2;
    }
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
    const ALIASES = ['opus', 'sonnet', 'haiku', 'subagent'];
    let models = null;
    if (a['models'] !== undefined) {
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
        if (!ALIASES.includes(k)) {
          refuse('models-invalid',
            `--models names "${k}", which is not a routing alias. The aliases are: `
            + `${ALIASES.join(', ')}.`);
          return 2;
        }
        if (typeof v !== 'string' || v === '') {
          refuse('models-invalid', `--models maps "${k}" to something that is not a model id.`);
          return 2;
        }
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
    if (accounts.some((x) => x['configDirSuffix'] === suffix)) {
      refuse('suffix-collision',
        `config directory ${JSON.stringify(suffix)} already belongs to an account in `
        + `${a['file']}. Two accounts sharing one CLAUDE_CONFIG_DIR share one set of transcripts, `
        + 'one settings.json and one credential.');
      return 1;
    }

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

  if (op === 'candidates') {
    const names = a['name'] ?? [];
    const bytes = a['bytes'] ?? [];
    if (names.length !== bytes.length) {
      // A count mismatch is the ONLY way a size could be attached to the wrong
      // name, and a misaligned index cannot be trusted about any of them —
      // `cmd_wrappers`' witness-index rule (ccd/ccrc:2590-2593), verbatim.
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
