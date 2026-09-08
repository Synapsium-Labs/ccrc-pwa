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
 *  from the four columns above. Its keys are the ids, in the columns' own
 *  order, so `Object.keys` here is the deploy side's `PROVIDER_IDS` and no
 *  second id list exists. `providers` prints this object; the agreement test
 *  rebuilds it from `shared/providers.ts` and compares. */
const PROVIDER_DEPLOY = Object.fromEntries(
  Object.keys(PROVIDER_ENV_VAR).map((p) => [p, {
    generatable: PROVIDER_GENERATABLE.has(p),
    envVar: PROVIDER_ENV_VAR[p],
    defaultBaseUrl: PROVIDER_BASE_URL[p],
    connect: PROVIDER_CONNECT[p],
  }]),
);

/** DATA, in `CCRC_DOCTOR_CHECKS`'s shape (ccd/ccrc-doctor-checks:165) and
 *  `ccd/ccrc-api`'s `ROUTES` shape: one row per op, naming the keys it takes.
 *  `repeat` lists the keys that may appear more than once and arrive as an
 *  array — `candidates` (Task 21) is the first, and declaring the shape now is
 *  what keeps that task from rewriting this parser. */
const OPS = {
  refuse: { keys: ['code', 'detail'], repeat: [] },
  providers: { keys: [], repeat: [] },
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
 *  dropped `--base-url` would be an endpoint nobody notices missing. */
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

  // `refuse`
  if (a['code'] === undefined || a['detail'] === undefined) {
    refuse('bad-argv', 'refuse needs --code and --detail');
    return 2;
  }
  refuse(a['code'], a['detail']);
  return 0;
}

process.exitCode = main(process.argv);

// `rosterFromJson`, `RosterInvalid` and `readFileSync` are imported by Task 21,
// which is the first op to read the roster. They are named in the import above
// from this commit so the CLI's dependency on the validator is real — and
// visible to a reviewer — from its first line rather than arriving later as a
// surprise about which files must ship together.
void rosterFromJson; void RosterInvalid; void readFileSync;
