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
// Nothing is returned until every check has succeeded, so a caller can never
// observe a half-validated roster.
//
// Two changes from the code's old home inside `deploy/gen-accounts.mjs`:
//  1. `checkAccount` now returns `secretsFile: exec['secretsFile']` — it used
//     to validate the field and then drop it, so the only bare-`node` reader
//     of the roster could not tell a caller which secrets file an account
//     uses (D-75). Task 5's wrapper writer needs it.
//  2. Importing this module runs nothing — no `main`, no argv, no
//     `process.exitCode` — unlike `deploy/gen-accounts.mjs`, which sets
//     `process.exitCode` on import BY DESIGN as a one-shot CLI. A shared
//     module a second caller merely imports must not inherit that exit
//     status.
//
// Dependency-free on purpose: this file imports nothing, not even `node:*` —
// bare-`node` runnable, no build step. That is NOT a blanket rule for every
// file in `shared/`: `shared/mark.mjs` imports `node:crypto`, sanctioned
// there (see that file's header) because `shared/*.mjs` is deploy-side
// tooling the PWA never bundles, unlike `shared/*.ts`, where a `node:*`
// import would break the client bundle. This file simply has no need for one.

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
const LABEL_UNSAFE_RE = /[\u0000-\u001f\u007f]/;

const EXEC_KINDS = new Set(['upstream', 'generated', 'external']);
const HUES = new Set(['cyan', 'violet', 'blue', 'magenta', 'amber', 'green']);

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
  if (exec['kind'] === 'generated' && exec['secretsFile'] !== undefined
      && typeof exec['secretsFile'] !== 'string') {
    bad(`account "${id}" has a non-string exec.secretsFile.`,
      `Set exec.secretsFile for account "${id}" to a string path relative to $HOME, or remove it.`);
  }
  // Mirrors `parseRoster`'s conservative gate: a path, not merely a string.
  // `""` and a trailing "/" both resolve to a directory rather than a file;
  // ".." escapes $HOME; a leading "/" ignores it entirely.
  if (
    exec['kind'] === 'generated' && exec['secretsFile'] !== undefined
    && (exec['secretsFile'] === '' || exec['secretsFile'].startsWith('/') || exec['secretsFile'].endsWith('/')
      || exec['secretsFile'].includes('..') || !SECRETS_SAFE_RE.test(exec['secretsFile']))
  ) {
    bad(`account "${id}" has an invalid exec.secretsFile ${JSON.stringify(exec['secretsFile'])}.`,
      `Set exec.secretsFile for account "${id}" to a path relative to $HOME (e.g. ".cc-secrets/${id}-oauth.env") `
      + 'using only letters, digits, ".", "-", "_" and "/" — never absolute, never containing "..", never ending in "/".');
  }

  const homeAble = raw['homeAble'];
  if (typeof homeAble !== 'boolean') {
    bad(`account "${id}" has a non-boolean homeAble.`,
      `Set "homeAble" to true or false for account "${id}".`);
  }

  const telemetry = raw['telemetry'];
  if (telemetry !== 'anthropic' && telemetry !== 'none') {
    bad(`account "${id}" has an invalid telemetry ${JSON.stringify(telemetry)}.`,
      `Set "telemetry" for account "${id}" to "anthropic" or "none".`);
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
  return {
    id, label, configDirSuffix: suffix, homeAble, telemetry, hue,
    execKind: exec['kind'], secretsFile: exec['secretsFile'],
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
