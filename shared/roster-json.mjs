// shared/roster-json.mjs — the JSON roster validator a bare `node` can run.
// Moved out of `deploy/gen-accounts.mjs` (Task 4 of the stage-2c
// wrapper-generation plan) once a second caller needed it: Task 5's wrapper
// generator, which reads `execKind` and `secretsFile` per account under the
// same bare-`node` constraint `deploy/gen-accounts.mjs` has always had — no
// build step, no `tsx`, no compiled `dist/`. Copying the validator a third
// time was exactly the drift Stage 2a was fought to kill, so it moves instead.
// `deploy/gen-accounts.mjs` keeps only its CLI shell; see that file's header
// for the shorter pointer back here.
//
// ── WHY THIS FILE VALIDATES AT ALL, GIVEN IT CANNOT CALL `parseRoster` ──
//
// `shared/roster.ts` is TypeScript. A bare `node` cannot import it, so the
// validated `Roster` object `generateAccountsSh` expects cannot be obtained
// the way every other consumer obtains it. That leaves two jobs this file has
// to do for itself, and it is worth naming them separately because they fail
// differently:
//
//  1. DERIVATION. `generateAccountsSh` consumes a `Roster` STRUCTURALLY —
//     `accounts`, `homeAble`, `byIdLengthDesc`, `upstreamId` — and only
//     `accounts` is present in the JSON on disk. The other three are computed
//     by `parseRoster`, so they are computed again here. `byIdLengthDesc` is
//     the one that matters: id length DESCENDING with id ascending as the
//     tie-break, because bash `case` takes the FIRST matching arm and not the
//     longest (see `shared/generate.mjs`'s header for the account-wide
//     mis-attribution that ordering bug caused when the arms were hand-kept).
//
//  2. VALIDATION. Silently emitting a bash file from a roster the rest of
//     ccrc rejects is the worst outcome available here: the generated
//     `accounts.sh` would be sourced by every `ccd` invocation on the fleet
//     host while `server/src/config.ts`'s `loadConfig` REFUSED TO BOOT on the
//     same bytes — a crash-looping service behind a green deploy. So this
//     file re-implements `parseRoster`'s checks, deliberately including the
//     fields it does NOT itself consume (`label`, `telemetry`, `hue`,
//     `exec.secretsFile`): the contract it upholds is not "the generator can
//     cope with this roster", it is "every ccrc that reads this roster will
//     accept it", and the server is the strictest reader.
//
// A hand-copied validator is exactly the drift this whole stage exists to
// kill, so it is NOT left to a comment asking the next author to keep the two
// in step. `server/test/gen-accounts.test.ts` runs `deploy/gen-accounts.mjs`
// as a subprocess and compares its stdout, byte for byte, against
// `markGenerated(generateAccountsSh(parseRoster(json)))` computed through the
// TypeScript — over the two rosters this repo ships, the production-shaped
// test roster, and a roster whose ids are strict prefixes of one another —
// and asserts that every roster `parseRoster` rejects is rejected here too.
// Agreement is a red suite, not a promise.
//
// The asymmetry that agreement permits, stated on purpose: this file may be
// STRICTER than `parseRoster`, never laxer. A roster it wrongly rejects fails
// a deploy loudly, with the offending field named; a roster it wrongly
// accepts ships a box that cannot boot. Unknown FIELDS are the one thing it
// does not check at all — `parseRoster` only warns about those and never
// throws, so ignoring them cannot make this file laxer than the parser.
//
// THAT WAS AN ASPIRATION, NOT A MEASURED FACT, for as long as `hidden`
// existed. This file never learned the field, so it accepted `hidden:
// "false"` — a truthy string that removes an account from every surface that
// lists one — while `loadConfig` refused to boot on the same bytes. A
// crash-looping `ccrc.service` behind a green deploy is precisely the outcome
// the paragraph above says cannot happen, and it stood for as long as the
// claim did. The gap closed in the same act that added `pool`, and it closed
// as a MECHANISM: `server/test/gen-accounts.test.ts`'s REJECT table now
// carries a `hidden: "false"` row, measured red on the tree before this check
// landed. Read that table, not this paragraph — it is the census of what the
// two sides agree to refuse, and it is the thing that goes red when they stop
// agreeing.
//
// Nothing is returned until every check has succeeded, so a caller can never
// observe a half-validated roster.
//
// Three changes from the code's old home inside `deploy/gen-accounts.mjs`:
//  1. `checkAccount` now returns `secretsFile: exec['secretsFile']` — it used
//     to validate the field and then drop it, so the only bare-`node` reader
//     of the roster could not tell a caller which secrets file an account
//     uses (D-75). Task 5's wrapper writer needs it.
//  2. Importing this module runs nothing — no `main`, no argv, no
//     `process.exitCode` — unlike `deploy/gen-accounts.mjs`, which sets
//     `process.exitCode` on import BY DESIGN as a one-shot CLI. A shared
//     module a second caller merely imports must not inherit that exit
//     status.
//  3. `secretsFile` is validated on ALL THREE exec kinds, not only
//     `generated` — and `provider`, `baseUrl` and `models` are validated and
//     deliberately NOT returned. The two gates used to be conjoined with
//     `kind === 'generated'` while the return spread the field unconditionally,
//     which made this file LAXER than `parseRoster` on the exact direction its
//     header above says cannot be tolerated (D-1855). The new fields are not
//     returned because nothing downstream reads them: `generateAccountsSh`
//     emits ids, home-ability, `CCRC_MEASURED`, the upstream id, config dirs,
//     labels and hues, and `generateWrapperBody` reads `id`,
//     `configDirSuffix`, `execKind` and `secretsFile`.
//
// One import, and only one: `./base-url.mjs`, the endpoint gate, which
// imports nothing itself. Everything else here is a hand-kept copy, for the
// reason above; the gate is not, for the reason at its import. That is NOT a
// blanket rule for every file in `shared/`: `shared/mark.mjs` imports
// `node:crypto`, sanctioned there (see that file's header) because
// `shared/*.mjs` is deploy-side tooling the PWA never bundles, unlike
// `shared/*.ts`, where a `node:*` import would break the client bundle. This
// file simply has no need for `node:*`.

// THE ONE IMPORT THIS FILE HAS. Every other rule from `shared/roster.ts` above
// is a hand-kept copy, and the header (:49-52) explains why that is survivable:
// this file may be STRICTER than the parser, never laxer. THE ENDPOINT GATE IS
// NOT SURVIVABLE ON THOSE TERMS. A gate that drifted STRICTER here refuses a
// roster the server boots on — a deploy that fails on bytes the server accepts,
// which is D-1854's split verdict pointing the other way — so this one decision
// is imported rather than mirrored. Task 2 ships `shared/base-url.mjs` for
// exactly this caller and for `deploy/account-op.mjs`, with
// `shared/base-url.d.mts` beside it and both driven over one case table.
import { BASE_URL_OK } from './base-url.mjs';

/** Mirrors `shared/roster.ts`'s `ID_RE`. An id becomes a filename under
 *  `~/.local/bin/`, a bash `case` pattern and a session-id prefix; ccd joins
 *  ids into a space-separated string and reads it back unquoted, so anything
 *  outside `[a-z0-9-]` word-splits and corrupts account routing. */
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** Mirrors `shared/roster.ts`'s second, conservative gate on
 *  `configDirSuffix` — the value `shared/generate.mjs` embeds inside a
 *  double-quoted bash string. The generator escapes that embedding itself;
 *  this is the second lock on the same door, kept here for the same reason
 *  the parser keeps its copy. */
const SUFFIX_SAFE_RE = /^\.[A-Za-z0-9._-]+$/;

/** Mirrors `shared/roster.ts`'s `SECRETS_SAFE_RE`. Kept here rather than
 *  imported for the reason this file's header gives for every other copy: a
 *  bare `node` cannot import the TypeScript. This file may be STRICTER than
 *  `parseRoster`, never laxer. */
const SECRETS_SAFE_RE = /^[A-Za-z0-9._/-]+$/;

/** Mirrors `shared/roster.ts`'s `LABEL_UNSAFE_RE` — C0 controls plus DEL.
 *  A label reaches a one-line terminal status bar and the tmux-capture
 *  parser that reads it back; a control byte breaks both. */
export const LABEL_UNSAFE_RE = /[\u0000-\u001f\u007f]/;

/** Mirrors `shared/providers.ts`'s `PROVIDER_IDS`, which is `Object.keys(PROVIDERS)`.
 *  A LIST, never the table: the labels, credentials, env vars, connect methods,
 *  probes and endpoints have exactly one home and a scan over `git ls-files`
 *  measures that (`server/test/providers.test.ts`). This list is here for the
 *  reason every other copy in this file is — a bare `node` cannot import the
 *  TypeScript — and its agreement with `PROVIDER_IDS` is asserted element for
 *  element by `gen-accounts.test.ts`, which is a stronger mechanism than the
 *  one `HUES` above has: hues reach bash through `_ccrc_hue` and a divergent
 *  order changes generated stdout, while `provider` reaches no bash at all
 *  (§4.3 puts it in the lane's own `settings.json`). */
const PROVIDER_IDS = new Set(['anthropic', 'openrouter', 'compatible', 'openai']);

/** The providers whose lanes may carry `exec.models` — `PROVIDERS[p].apiKeyModels`.
 *  Same rule as above; same agreement test. */
export const API_KEY_PROVIDERS = new Set(['openrouter', 'compatible']);

/** The providers that ship NO default endpoint, so an absent `exec.baseUrl` is a
 *  refusal rather than a fall-through — `PROVIDERS[p].baseUrlRequired`. */
const BASE_URL_REQUIRED = new Set(['compatible']);

/** Mirrors `shared/roster.ts`'s `MODEL_ID_RE`. Distinct from `ID_RE` above
 *  because an OpenRouter id carries `/`, `.` and `:`. Compared to its original
 *  SOURCE for source by `gen-accounts.test.ts`, not by behaviour: the last
 *  regex copied into this file had its escape text emitted as the raw control
 *  bytes it describes, behaving identically, and every suite stayed green
 *  (`server/test/source-bytes.test.ts:5-15`). */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;

/** Mirrors `shared/roster.ts`'s `MODEL_ALIASES` — the four keys ccd and Claude
 *  Code route on. All four required when `models` is present. */
export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'subagent'];

/** Mirrors `shared/roster.ts`'s exported `POOL_NAME_RE`. Kept here as a literal
 *  rather than imported for this file's standing reason: a bare `node` cannot
 *  import the TypeScript. `ccd` carries a third copy in bash (wave 2a landed
 *  it).
 *
 *  WHAT HOLDS THE THREE EQUAL IS NOT THE SAME MECHANISM IN EACH CASE, and saying
 *  so matters more than the tidy sentence this comment used to carry
 *  (D-1742). `ccd`'s bash literal IS pinned against `POOL_NAME_RE.source` by
 *  TEXT EXTRACTION — a scan that reads the bash file
 *  (`server/test/pool-name-parity.test.ts`, wave 2a), which pins
 *  `ccd/ccrc-doctor-checks`'s own copy the same way.
 *
 *  THIS copy is pinned by text extraction too, as of D-1742's SECOND ROUND:
 *  `server/test/gen-accounts.test.ts`'s last block reads this file and
 *  `shared/roster.ts` as text, lifts the three literals this file mirrors —
 *  `POOL_NAME_RE`, `ID_RE` and `LABEL_UNSAFE_RE` — out of their
 *  `const NAME = /…/;` declarations, and requires each to equal the parser's
 *  (against the IMPORTED object for this one, since it is exported, so at least
 *  one row measures the regex the parser actually runs rather than two strings
 *  agreeing about nothing). It had to be written for these three BY NAME: no
 *  generic scan reaches a regex literal in a `.mjs` — `single-definition.test.ts`
 *  filters `/\.tsx?$/`, and `server/test/source-bytes.test.ts` does walk this
 *  file, but only for control bytes, never for grammar.
 *
 *  D-1742's first round concluded that BEHAVIOUR held the copies equal, and that
 *  conclusion was refuted: three tail-charset widenings of this literal —
 *  `[a-zA-Z0-9-]`, `[a-z0-9.-]`, `[a-z0-9+-]` — each survived every row of the
 *  REJECT table, because no row there paired a legal first character with an
 *  illegal tail one. Each of those makes this file LAXER than `parseRoster`,
 *  which is the one direction this file's header forbids. Rows are the wrong
 *  mechanism for a charset: the class of widenings is open, and a row only ever
 *  pins the character it names.
 *
 *  The REJECT table is NOT superseded and NOT redundant. Text equality proves
 *  the two files hold the same PATTERN and says nothing about whether either
 *  side APPLIES it — a `checkAccount` that dropped the `.test` call below would
 *  leave every extraction assertion green. The table is the behavioural half: it
 *  drives malformed pool names through the CLI and the parser and requires both
 *  to REFUSE, it is the only thing covering the parts of this gate that are no
 *  regex at all (the type check, the refusal of a written `null`), and its
 *  over-the-cap and shell-metacharacter rows run the literal end to end through
 *  a real subprocess. Read both; neither alone is the census. */
const POOL_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

const EXEC_KINDS = new Set(['upstream', 'generated', 'external']);
export const HUES = new Set(['cyan', 'violet', 'blue', 'magenta', 'amber', 'green']);

export class RosterInvalid extends Error {}

/** @param {string} message @param {string} remedy */
function bad(message, remedy) {
  const e = new RosterInvalid(message);
  e.remedy = remedy;
  throw e;
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validates one raw account and returns the fields the emitter reads. The
 * fields it does NOT return are still checked — see the header: this file's
 * job is to reject anything the SERVER would reject, not merely anything the
 * generator would trip over.
 *
 * @param {unknown} raw
 * @param {number} index
 */
function checkAccount(raw, index) {
  const where = `accounts[${index}]`;
  if (!isPlainObject(raw)) {
    bad(`${where} is not a JSON object.`,
      `Rewrite ${where} as an object with "id", "label", "configDirSuffix", "exec", "homeAble" and "telemetry".`);
  }

  const id = raw['id'];
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    bad(`${where} has an invalid id ${JSON.stringify(id)}.`,
      `Rename it to match ^[a-z][a-z0-9-]{0,31}$ — lowercase letters, digits and hyphens only.`);
  }

  const label = raw['label'];
  if (typeof label !== 'string' || label.length === 0) {
    bad(`account "${id}" has no label.`, `Add a non-empty "label" for account "${id}".`);
  }
  // Mirrors `parseRoster`'s `LABEL_UNSAFE_RE`. The label is now emitted into
  // `_ccrc_label`, which `ccd/statusline-command.sh` prints into a one-line
  // status bar that `server/src/pane/statusline.ts` parses back out of a tmux
  // capture — an embedded newline splits that line and the parser reads the
  // wrong branch off the remainder.
  if (LABEL_UNSAFE_RE.test(label)) {
    bad(`account "${id}" has a label containing a control character.`,
      `Remove the tab, newline or escape character from "label" for account "${id}" — `
      + 'a label is one line of display text.');
  }

  // `"."` passes "starts with a dot, holds no slash and no ..", and then
  // resolves to $HOME itself — one account's config dir swallowing every
  // dotfile in the home directory, `~/.ssh` included. It is banned by name
  // in `parseRoster` and by name here.
  const suffix = raw['configDirSuffix'];
  if (
    typeof suffix !== 'string' || !suffix.startsWith('.') || suffix === '.'
    || suffix.includes('/') || suffix.includes('..') || !SUFFIX_SAFE_RE.test(suffix)
  ) {
    bad(`account "${id}" has an invalid configDirSuffix ${JSON.stringify(suffix)}.`,
      `Set it to a dot-prefixed directory name directly under $HOME (e.g. ".${id}") using only `
      + 'letters, digits, ".", "-" and "_" — never "." itself.');
  }

  const exec = raw['exec'];
  if (!isPlainObject(exec) || typeof exec['kind'] !== 'string' || !EXEC_KINDS.has(exec['kind'])) {
    bad(`account "${id}" has a missing or invalid exec.kind.`,
      `Set exec.kind for account "${id}" to "upstream", "generated" or "external".`);
  }
  // HOISTED (D-1855). These two gates were conjoined with
  // `exec['kind'] === 'generated'` while the return below spread
  // `secretsFile` with no kind predicate at all, so an `upstream` or `external`
  // entry carrying `'/etc/shadow'` or `'../.ssh/id_ed25519'` passed validation
  // untouched and reached `deploy/gen-wrappers.mjs`'s manifest. Latent while no
  // roster put the field on a non-generated entry; `parseRoster` now makes it
  // legal on all three kinds, which is what created the callers.
  if (exec['secretsFile'] !== undefined && typeof exec['secretsFile'] !== 'string') {
    bad(`account "${id}" has a non-string exec.secretsFile.`,
      `Set exec.secretsFile for account "${id}" to a string path relative to $HOME, or remove it.`);
  }
  // Mirrors `parseRoster`'s conservative gate: a path, not merely a string.
  // `""` and a trailing "/" both resolve to a directory rather than a file;
  // ".." escapes $HOME; a leading "/" ignores it entirely.
  if (
    exec['secretsFile'] !== undefined
    && (exec['secretsFile'] === '' || exec['secretsFile'].startsWith('/') || exec['secretsFile'].endsWith('/')
      || exec['secretsFile'].includes('..') || !SECRETS_SAFE_RE.test(exec['secretsFile']))
  ) {
    bad(`account "${id}" has an invalid exec.secretsFile ${JSON.stringify(exec['secretsFile'])}.`,
      `Set exec.secretsFile for account "${id}" to a path relative to $HOME (e.g. ".cc-secrets/${id}-oauth.env") `
      + 'using only letters, digits, ".", "-", "_" and "/" — never absolute, never containing "..", never ending in "/".');
  }

  // `provider`, `baseUrl` and `models` — validated here, returned by nothing.
  // The emitter reads none of them (`shared/generate.mjs:206-238`) and neither
  // does the wrapper writer, so returning them would be dead code in the one
  // file in this tree no typechecker checks (`server/tsconfig.json` sets no
  // `checkJs`). They are validated because the SERVER refuses to boot on them,
  // and that is this file's whole job.
  //
  // These three gates are INVISIBLE to `gen-accounts.test.ts`'s byte-agreement
  // direction, because none of the fields reaches `accounts.sh`. The REJECT
  // table is the only half of that harness that covers them (D-1861), and it
  // carries a row for each.
  if (exec['kind'] !== 'upstream') {
    if (exec['provider'] !== undefined && !PROVIDER_IDS.has(exec['provider'])) {
      bad(`account "${id}" has an unknown exec.provider ${JSON.stringify(exec['provider'])}.`,
        `Set exec.provider for account "${id}" to one of ${[...PROVIDER_IDS].join(', ')}, or remove it.`);
    }
    // `parseRoster` defaults an absent provider on a `generated` entry to
    // "anthropic" and WARNS; the mirror does not warn (it emits nothing an
    // operator reads at deploy time except refusals) but must agree about what
    // is legal, so it defaults silently for the purpose of the two gates below.
    const provider = exec['provider'] !== undefined
      ? exec['provider']
      : (exec['kind'] === 'generated' ? 'anthropic' : undefined);

    if (exec['baseUrl'] !== undefined) {
      // The IMPORTED gate, and the verdict is an OBJECT: `{ ok: true, url }` or
      // `{ ok: false, reason }`, whose `reason` is already the refusal code
      // every other surface prints. This file never needs `url` — the emitter
      // and the wrapper writer read neither the endpoint nor anything derived
      // from it — so it takes the reason and drops the rest.
      const v = BASE_URL_OK(exec['baseUrl']);
      if (!v.ok) {
        const why = v.reason;
        bad(`account "${id}" has an invalid exec.baseUrl ${JSON.stringify(exec['baseUrl'])}: ${why}.`,
          `Set exec.baseUrl for account "${id}" to an https:// endpoint, or an http:// one on `
          + '127.0.0.1, [::1] or localhost — with no user:password, no query string and no fragment.');
      }
    } else if (provider !== undefined && BASE_URL_REQUIRED.has(provider)) {
      bad(`account "${id}" has provider "${provider}" and no exec.baseUrl: base-url-required.`,
        `Set exec.baseUrl for account "${id}" — provider "${provider}" ships no default endpoint.`);
    }

    if (exec['kind'] === 'generated' && exec['models'] !== undefined) {
      if (!API_KEY_PROVIDERS.has(provider)) {
        bad(`account "${id}" declares exec.models on provider "${provider}", which carries no model map.`,
          `Remove "models" from account "${id}"'s exec, or set exec.provider to one of `
          + `${[...API_KEY_PROVIDERS].join(', ')}.`);
      }
      if (!isPlainObject(exec['models'])) {
        bad(`account "${id}" has a non-object exec.models.`,
          `Set exec.models for account "${id}" to an object with ${MODEL_ALIASES.join(', ')}, or remove it.`);
      }
      for (const alias of MODEL_ALIASES) {
        const v = exec['models'][alias];
        if (typeof v !== 'string' || !MODEL_ID_RE.test(v)) {
          bad(`account "${id}" has a missing or invalid exec.models.${alias} ${JSON.stringify(v)}.`,
            `Set exec.models.${alias} for account "${id}" to a model id: a letter or digit followed by `
            + 'up to 127 of letters, digits, ".", "_", ":", "/" and "-".');
        }
      }
      const sel = exec['models']['selectable'];
      if (sel !== undefined) {
        if (!Array.isArray(sel) || sel.length === 0) {
          bad(`account "${id}" has an empty or non-array exec.models.selectable.`,
            `Set exec.models.selectable for account "${id}" to a non-empty array of { "id": … } objects, `
            + 'or remove it — absent means the four aliases and nothing else.');
        }
        sel.forEach((entry, i) => {
          if (!isPlainObject(entry) || typeof entry['id'] !== 'string' || !MODEL_ID_RE.test(entry['id'])) {
            bad(`account "${id}" has an invalid exec.models.selectable[${i}].`,
              `Each entry must be an object with a model-id "id" and an optional string "label".`);
          }
          if (entry['label'] !== undefined && (typeof entry['label'] !== 'string' || entry['label'].length === 0)) {
            bad(`account "${id}" has a non-string exec.models.selectable[${i}].label.`,
              `Set that entry's "label" to display text, or remove it.`);
          }
        });
        const offered = new Set(sel.map((c) => c['id']));
        for (const alias of MODEL_ALIASES) {
          if (!offered.has(exec['models'][alias])) {
            bad(`account "${id}" routes ${alias} to ${JSON.stringify(exec['models'][alias])}, which its `
              + 'exec.models.selectable does not offer.',
              `Add it to exec.models.selectable for account "${id}", or point exec.models.${alias} at a `
              + 'model the list already offers.');
          }
        }
      }
    }
  }

  const homeAble = raw['homeAble'];
  if (typeof homeAble !== 'boolean') {
    bad(`account "${id}" has a non-boolean homeAble.`,
      `Set "homeAble" to true or false for account "${id}".`);
  }

  // Mirrors `parseRoster`'s `hidden` gate — the one this file never had (spec
  // §12 P-1, D-1663). The field is OPTIONAL, so absence is legal; a PRESENT non-boolean
  // is not. `"false"` is a truthy string, and truthiness on this field removes
  // an account from every surface that lists one, which the server refuses at
  // boot while this validator waved it through.
  //
  // FOUND TWICE, INDEPENDENTLY, AND THAT IS THE INTERESTING PART (D-2593):
  // account
  // pools booked it as D-1663 and the account wave as D-1854, off different
  // specs, weeks apart — a mirror gap wide enough for two unrelated waves to
  // trip over is not an oversight, it is what an unpinned duplicate costs.
  // Their two gates were byte-identical in behaviour and the merge kept BOTH,
  // which is a `const` redeclaration and does not parse; the second copy was
  // deleted there rather than here.
  const hidden = raw['hidden'];
  if (hidden !== undefined && typeof hidden !== 'boolean') {
    bad(`account "${id}" has a non-boolean hidden.`,
      `Set "hidden" to true or false for account "${id}", or remove the key.`);
  }

  // Mirrors `parseRoster`'s `pool` gate, including its refusal of an explicit
  // `null`: absence is the file saying "untagged", a written `null` is a
  // half-finished edit, and this file may not be laxer than the parser about
  // which one it is looking at.
  const pool = raw['pool'];
  if (pool !== undefined && (typeof pool !== 'string' || !POOL_NAME_RE.test(pool))) {
    bad(`account "${id}" has an invalid pool ${JSON.stringify(pool)}.`,
      `Set "pool" for account "${id}" to a name matching ^[a-z][a-z0-9-]{0,31}$ — lowercase `
      + 'letters, digits and hyphens only — or remove the key to leave the account untagged.');
  }

  const telemetry = raw['telemetry'];
  if (telemetry !== 'anthropic' && telemetry !== 'codex' && telemetry !== 'none') {
    bad(`account "${id}" has an invalid telemetry ${JSON.stringify(telemetry)}.`,
      `Set "telemetry" for account "${id}" to "anthropic", "codex" or "none".`);
  }

  // Optional — `parseRoster` auto-assigns one when it is absent, and the
  // emitter never reads it. An UNKNOWN hue still fails, because the server
  // would fail on it.
  const hue = raw['hue'];
  if (hue !== undefined && (typeof hue !== 'string' || !HUES.has(hue))) {
    bad(`account "${id}" has an unknown hue ${JSON.stringify(hue)}.`,
      `Set "hue" for account "${id}" to one of ${[...HUES].join(', ')}, or remove the field.`);
  }

  // `hue` comes back UNDEFINED when the roster omits it — `assignHues` below
  // fills it in, exactly as `parseRoster` does, and for the same reason: the
  // emitter now writes `_ccrc_hue`, so an auto-assigned hue is generated
  // output and has to match the server's byte for byte.
  //
  // `secretsFile` comes back UNDEFINED the same way whenever the roster
  // omits it (D-75, closed here): the field was validated above and then
  // dropped, and Task 5's wrapper writer needs the value that survived
  // validation, not merely proof that it was legal.
  //
  // `hidden` is checked above and deliberately NOT returned: the emitter has no
  // use for it (it stays outside `accounts.sh`, so outside `bodyDigest` and
  // outside `rosterAgreement`'s reach — the doctor's D-72 note is where that
  // asymmetry is explained). `pool` IS returned, because `_ccrc_pool` is
  // generated from it — which is the whole reason the field is emitted at all:
  // a roster field that never reaches `accounts.sh` is a field whose cross-box
  // drift nobody can see.
  return {
    id, label, configDirSuffix: suffix, homeAble, telemetry, hue,
    execKind: exec['kind'], secretsFile: exec['secretsFile'],
    pool: pool === undefined ? null : pool,
  };
}

/**
 * Mirrors `shared/roster.ts`'s `assignHues`: accounts that named a hue keep
 * it, and the rest are dealt the hues nobody claimed, in `HUES` order,
 * cycling. Falls back to the full list when every hue is already spoken for,
 * so a roster of seven accounts still terminates with a hue each.
 *
 * `HUES` is a Set above (membership is all the validator needed); the walk
 * needs a SEQUENCE, and it must be the same sequence `parseRoster` walks —
 * Set iteration preserves insertion order, so `[...HUES]` is that literal
 * order and not a re-typed copy of it.
 *
 * @param {{hue: string|undefined}[]} accounts
 */
function assignHues(accounts) {
  const order = [...HUES];
  const explicit = new Set(accounts.map((a) => a.hue).filter((h) => h !== undefined));
  const pool = order.filter((h) => !explicit.has(h));
  const available = pool.length > 0 ? pool : order;
  let i = 0;
  for (const a of accounts) {
    if (a.hue !== undefined) continue;
    a.hue = available[i % available.length];
    i++;
  }
}

/**
 * The `Roster`-shaped object `generateAccountsSh` consumes structurally —
 * validated and derived here because `parseRoster` is out of reach (header).
 *
 * @param {unknown} json
 * @throws {RosterInvalid}
 */
export function rosterFromJson(json) {
  if (!isPlainObject(json)) {
    bad('the roster file must contain a single JSON object with "version" and "accounts".',
      'Rewrite it as a JSON object, or copy deploy/accounts.default.json and edit that.');
  }
  if (json['version'] !== 1) {
    bad(`unsupported roster version ${JSON.stringify(json['version'])}: ccrc understands version 1.`,
      'Set "version": 1, or upgrade ccrc to a build that understands this roster.');
  }
  const rawAccounts = json['accounts'];
  if (!Array.isArray(rawAccounts)) {
    bad('the roster\'s "accounts" field must be an array.', 'Add an "accounts" array to the roster.');
  }
  if (rawAccounts.length === 0) {
    bad('the roster must contain at least one account.',
      'Add at least one account, or copy deploy/accounts.default.json and edit that.');
  }

  const accounts = rawAccounts.map(checkAccount);

  const seen = new Set();
  for (const a of accounts) {
    if (seen.has(a.id)) bad(`duplicate account id "${a.id}".`, 'Give every account a unique "id".');
    seen.add(a.id);
  }

  // Mirrors `parseRoster`'s duplicate-configDirSuffix check. `_ccrc_dir_id`
  // maps a config dir back to ONE account; two accounts on one dir makes that
  // answer an artifact of emitter order (see `shared/generate.mjs`).
  const seenDirs = new Map();
  for (const a of accounts) {
    const owner = seenDirs.get(a.configDirSuffix);
    if (owner !== undefined) {
      bad(`accounts "${owner}" and "${a.id}" share the configDirSuffix ${JSON.stringify(a.configDirSuffix)}.`,
        `Give each account its own "configDirSuffix" (e.g. ".${a.id}"), or delete the duplicate account.`);
    }
    seenDirs.set(a.configDirSuffix, a.id);
  }

  const upstreams = accounts.filter((a) => a.execKind === 'upstream');
  if (upstreams.length !== 1) {
    bad(`the roster has ${upstreams.length} upstream accounts: exactly one account must have exec.kind "upstream".`,
      'Set exec.kind to "upstream" on the one account that runs the Claude Code binary directly '
      + '(usually "claude"), and "generated" or "external" on the rest.');
  }

  // Last, exactly where `parseRoster` runs it — after every check that can
  // throw. Nothing here depends on the ordering, but keeping the two
  // sequences aligned is what makes the mirror readable as a mirror.
  assignHues(accounts);

  return {
    version: 1,
    accounts,
    homeAble: accounts.filter((a) => a.homeAble),
    // Longest id first, id ascending as the tie-break — `parseRoster`'s
    // comparator, restated. `claude-corp` and `claude-dev0` tie at 11
    // characters today, so the second key is not decorative: without it the
    // arm order is whatever the engine's sort happened to leave behind.
    byIdLengthDesc: accounts.slice()
      .sort((a, b) => b.id.length - a.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    upstreamId: upstreams[0].id,
  };
}
