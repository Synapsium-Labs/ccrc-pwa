#!/usr/bin/env node
// models-op — the node half of the `ccrc models` verb group (spec §10). It owns
// the REGISTRY FILE's read, the mutation, the RE-VALIDATION, the atomic write
// and the re-materialisation; `ccd/ccrc` above it is a dispatcher and nothing
// else.
//
// ── WHAT IT DOES NOT TOUCH ───────────────────────────────────────────────
// The roster. Ruling 280 (2026-09-08): the class registry is its own
// per-account file, `~/.ccrc/models/<id>.classes.json`, and `exec.models` is
// the account-connections spec's — a branch that is not on `main`. The roster
// is READ for exactly three facts and never written: does this id exist, what
// is its `configDirSuffix`, and is it an Anthropic lane
// (`telemetry === 'anthropic'` — `origin/main`'s `ExecSpec` has no provider
// field to ask, deviation B-3).
//
// ── THE THREE RULES EVERY OP OBEYS ───────────────────────────────────────
//  1. ONE JSON OBJECT ON STDOUT, always, including on a refusal. The caller
//     parses stdout; an exit code with an empty body is "the box said no" and
//     "this build cannot answer you" arriving as the same two bytes.
//  2. RE-VALIDATE BEFORE WRITING. Every mutation runs the MUTATED registry back
//     through `parseRegistry` before the rename and answers the validator's own
//     sentence, with its `field`. The one thing a verb must never do is leave a
//     file the server refuses to read.
//  3. MATERIALISE ON SUCCESS. `mergeSettingsEnv`, `<id>.classes.tsv` and
//     `<id>.effort.json` are rewritten after every accepted mutation, so no
//     surface can read a registry the lane's own settings do not match.
//
// `rm` (spec §4.1 Lifecycle, §10, §11) is a DELIBERATE exception to rules 2 and
// 3: it is a REAP, not a mutation, and re-validating or materialising a
// registry it is about to delete would be pointless — worse, it would refuse to
// reap a registry that no longer parses, which is exactly the file this verb
// exists to clean up. It still obeys rule 1.
//
// It borrows two idioms `main` already uses for a node helper `ccrc` shells out
// to, and cites them: `deploy/gen-accounts.mjs`'s "the remedy reaches stderr
// verbatim" contract (`ccd/ccrc:3955-3962` reads it that way), and
// `ccd/ccrc-adopt:139-146`'s argument loop, where an unknown flag is exit 2.
//
// Bare `node` — no build step, no `tsx`, no compiled `dist/` — which is why
// every import below is a `.mjs`.

import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { rosterFromJson, RosterInvalid } from '../shared/roster-json.mjs';
import {
  CLASSES, CatalogueInvalid, MODEL_ID_RE, PROBE_KINDS, RegistryInvalid, availableFor, deriveModels,
  parseCatalogue, parseRegistry,
} from '../shared/models.mjs';
import {
  MODEL_ENV_KEYS, ModelEnvInvalid, classesTsv, clearSettingsEnv, effortFile, mergeSettingsEnv, modelEnvBlock,
} from '../shared/modelenv.mjs';

const SELF = 'models-op';

/** What `init` plants per probe kind.
 *
 *  `codex`'s is TODAY'S gpt mapping (§13.1) — luna/terra/sol with `fable: null`
 *  and `subagent: 'sonnet'` — so behaviour is unchanged until the operator
 *  classifies Astra. The other two seed an UNSEEDED registry (deviation B-1):
 *  four null classes, a `discovery` scope the probe kind allows, and nothing
 *  routable — only the operator can know which of several hundred OpenRouter
 *  models belongs in which class. Such a registry is legal, materialises to a
 *  TSV and no env block, and reads as "every class unavailable". */
const SEEDS = {
  codex: {
    probe: 'codex',
    classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
    subagent: 'sonnet',
    discovery: 'catalogue',
    effort: { haiku: 'high', sonnet: 'high', opus: 'max', fable: 'max' },
  },
  openrouter: {
    probe: 'openrouter',
    classes: { haiku: null, sonnet: null, opus: null, fable: null },
    subagent: 'sonnet',
    discovery: [],
  },
  compatible: {
    probe: 'compatible',
    classes: { haiku: null, sonnet: null, opus: null, fable: null },
    subagent: 'sonnet',
    discovery: 'catalogue',
  },
};

const HOME = process.env['HOME'] ?? '';
const modelsDir = () => path.join(HOME, '.ccrc', 'models');
const cataloguePath = (id) => path.join(modelsDir(), `${id}.json`);
const registryPath = (id) => path.join(modelsDir(), `${id}.classes.json`);
// `rm` names these two directly — `materialise` builds the same two paths off
// an `account`, which an ORPHAN id has none of.
const classesTsvPath = (id) => path.join(modelsDir(), `${id}.classes.tsv`);
const effortPath = (id) => path.join(modelsDir(), `${id}.effort.json`);

function out(o) { process.stdout.write(`${JSON.stringify(o)}\n`); }

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The envelope: machine-readable on stdout, the human sentence on stderr, one
 *  shape on every path. It RETURNS the exit class, so each op's
 *  `return refuse(1, …)` is the whole control flow. `field` is carried when
 *  there is one — the verbs' contract is "refuses, with the field named", and
 *  Plan 3a's PATCH route points a UI control at it. */
function refuse(code, error, detail, field) {
  out({ ok: false, error, detail, ...(field === undefined ? {} : { field }) });
  process.stderr.write(`${SELF}: ${detail} (${error})\n`);
  return code;
}

/** A `RegistryInvalid` turned into a refusal, with the ONE verb-level remedy
 *  the validator cannot know: which subcommand fixes this field. */
const FIELD_REMEDY = {
  subagent: "Run 'ccrc models <id> set-subagent <class>' to point it at a class that has a model.",
  discovery: "Run 'ccrc models <id> discovery add <modelId>' or 'discovery catalogue'.",
};
function refuseRegistry(e, id) {
  const extra = FIELD_REMEDY[e.field] ?? '';
  const remedy = extra === '' ? '' : ` ${extra.replace('<id>', id)}`;
  return refuse(1, 'registry-invalid', `${e.message}${remedy}`, e.field);
}

/** THE ONE ROSTER READ, and it is READ-ONLY. Absent and unreadable are two
 *  codes: the remedies differ. */
function readRoster(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { err: ['roster-absent',
        `${file} does not exist, so this box has no account roster yet. Run 'ccrc install' — it `
        + 'seeds one and never overwrites an existing one.'] };
    }
    return { err: ['roster-unreadable',
      `${file} exists and could not be read: ${e.message}. Regenerating it will not help; fix its `
      + 'permissions.'] };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { err: ['roster-invalid', `${file} is not valid JSON: ${e.message}`] };
  }
  try {
    rosterFromJson(json);
  } catch (e) {
    const remedy = e instanceof RosterInvalid && typeof e.remedy === 'string' ? ` ${e.remedy}` : '';
    return { err: ['roster-invalid', `${file}: ${e.message}${remedy}`] };
  }
  return { json };
}

function findAccount(json, id) {
  const accounts = Array.isArray(json.accounts) ? json.accounts : [];
  return accounts.find((a) => isObj(a) && a.id === id) ?? null;
}

/** Deviation B-3: `origin/main`'s roster has no `exec.provider`, and
 *  `telemetry: 'anthropic'` is its own declaration that an account is an
 *  Anthropic subscription lane — the field `limits.ts` scores on. `gpt` carries
 *  `telemetry: 'none'`. This is the one place the boolean is computed here. */
const isAnthropicLane = (account) => account.telemetry === 'anthropic';

/** A lane a registry can sit on at all: not upstream (that entry names the
 *  Claude Code binary and ccrc never writes its launcher) and not Anthropic. */
const canCarryRegistry = (account) =>
  isObj(account.exec) && account.exec.kind !== 'upstream' && !isAnthropicLane(account);

/** The lane's catalogue, or null when it has never been probed. A file that
 *  EXISTS and is not a catalogue is a refusal, never "never probed": the two
 *  are different states and folding them would hide a broken probe behind an
 *  empty screen. */
function readCatalogue(id) {
  let raw;
  try {
    raw = readFileSync(cataloguePath(id), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { catalogue: null };
    return { err: ['catalogue-unreadable', `${cataloguePath(id)} could not be read: ${e.message}.`] };
  }
  try {
    return { catalogue: parseCatalogue(JSON.parse(raw)) };
  } catch (e) {
    const why = e instanceof CatalogueInvalid ? e.message : `${e.message}`;
    return { err: ['catalogue-invalid',
      `${cataloguePath(id)} is not a catalogue this build understands: ${why}. Re-run `
      + `'ccrc models refresh ${id}'.`] };
  }
}

/** The lane's registry, or null when it has none. Same asymmetry as the
 *  catalogue: absent is a STATE (§13.1's "every class unavailable"), and a file
 *  that exists and does not parse is a refusal that names its field. */
function readRegistry(id, catalogue) {
  let raw;
  try {
    raw = readFileSync(registryPath(id), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { registry: null };
    return { err: ['registry-unreadable', `${registryPath(id)} could not be read: ${e.message}.`] };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { err: ['registry-invalid', `${registryPath(id)} is not valid JSON: ${e.message}`] };
  }
  try {
    return { registry: parseRegistry(json, catalogue) };
  } catch (e) {
    if (e instanceof RegistryInvalid) return { invalid: e };
    throw e;
  }
}

/** tmp + rename, 0600, this repo's rule for any file another process reads —
 *  the server's fleet poll and Plan 3a's routes read this one, and a
 *  `compatible` lane's registry names its endpoint. 2-space indent and a
 *  trailing newline, the shape every hand-editable ccrc file has. */
function writeRegistry(id, registry) {
  const p = registryPath(id);
  const tmp = `${p}.ccrc.tmp`;
  try {
    mkdirSync(modelsDir(), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, p);
    return null;
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* the tmp may never have been created */ }
    return ['registry-unwritable', `${p} could not be written: ${e.message}. Nothing was changed.`];
  }
}

/** §6.1 + §6.4 + §7's TSV, from a lane's registry and its catalogue. Returns
 *  the three paths, `settings` NULL when the registry is unseeded — such a lane
 *  has no env block to write ("a lane needs at least one class") but still gets
 *  its TSV, because ccd reads that file on every spawn and an ABSENT file is a
 *  different question from a lane with nothing assigned. `wrote` is null only
 *  when there is no registry at all. */
function materialise(account, registry, catalogue) {
  if (registry === null) return { wrote: null };
  const settings = path.join(HOME, account.configDirSuffix, 'settings.json');
  const classes = path.join(modelsDir(), `${account.id}.classes.tsv`);
  const effort = path.join(modelsDir(), `${account.id}.effort.json`);
  let block = null;
  try {
    // `catalogue` is the SAME parsed value the caller already loaded to
    // compute `derived`/`settingsDrift` (spec §6.1 amendment) — never a
    // second read of `<id>.json`, so a materialise never disagrees with the
    // `show` answer it is bundled with about whether the catalogue is stale.
    block = modelEnvBlock(registry, catalogue);
  } catch (e) {
    if (!(e instanceof ModelEnvInvalid)) throw e;
    // An UNSEEDED lane routes nowhere and gets no env block. A lane that is
    // seeded but unroutable is refused by the MUTATION path before it ever
    // reaches here, so this branch only ever means "nothing assigned yet".
    if (CLASSES.some((c) => registry.classes[c] !== null)) {
      return { err: ['unroutable-lane', e.message] };
    }
  }
  try {
    mkdirSync(modelsDir(), { recursive: true });
    if (block !== null) {
      mkdirSync(path.dirname(settings), { recursive: true });
      mergeSettingsEnv(settings, block);
    }
    // Both generated files land tmp + rename: ccd reads the TSV on every spawn
    // (Plan 2) and `ccgpt-proxy` re-reads the effort file whenever its mtime
    // moves, so a half-written one is a live wrong answer rather than a
    // transient.
    for (const [p, text] of [[classes, classesTsv(registry, catalogue)],
      [effort, `${JSON.stringify(effortFile(registry, catalogue))}\n`]]) {
      const tmp = `${p}.ccrc.tmp`;
      writeFileSync(tmp, text, { mode: 0o600 });
      renameSync(tmp, p);
    }
  } catch (e) {
    if (e instanceof ModelEnvInvalid) return { err: ['settings-unwritable', e.message] };
    return { err: ['materialise-failed', `${e.message}`] };
  }
  return { wrote: { settings: block === null ? null : settings, classes, effort } };
}

/** §11's last bullet: which of the materialiser's (up to) eight keys the
 *  lane's own settings.json no longer agrees with. A MISSING key counts as
 *  drifted — for the first seven, an unset alias falls through to Anthropic's
 *  own id and the backend 404s opaquely, which is the exact failure the
 *  sentinel exists to prevent, so "absent" and "wrong" are the same finding
 *  here. The eighth key is the one where "absent from `want`" is the CORRECT
 *  answer whenever the catalogue cannot measure it (§6.1 amendment) — `want`
 *  simply does not carry the key then, so the `Object.keys(want)` filter below
 *  never asks about it, and a settings file that also lacks it drifts on
 *  nothing.
 *
 *  Returned in `modelEnvBlock`'s own key order rather than sorted, so two boxes
 *  reporting the same drift print the same list. Read-only: `show` NAMES the
 *  drift and never repairs it, because a read verb that silently rewrote a
 *  hand-edited settings file would destroy the edit before its author saw the
 *  report. Every mutation re-materialises, so the remedy is any of them.
 *
 *  Takes the SAME `catalogue` the caller already parsed for `derived` — never
 *  a second read — because `modelEnvBlock` needs it to know whether the
 *  eighth key belongs in `want` at all. */
function settingsDrift(account, registry, catalogue) {
  if (registry === null) return [];
  let want;
  try {
    want = modelEnvBlock(registry, catalogue);
  } catch {
    // An unseeded (or unroutable) lane has no expected block to compare against.
    return [];
  }
  let env = {};
  try {
    const j = JSON.parse(readFileSync(path.join(HOME, account.configDirSuffix, 'settings.json'), 'utf8'));
    if (isObj(j) && isObj(j.env)) env = j.env;
  } catch {
    // An absent settings file means every key is missing, which the filter
    // below reports one by one — a more useful answer than a single "no file".
    env = {};
  }
  return Object.keys(want).filter((k) => env[k] !== want[k]);
}

/** The `show` answer, which every mutation also returns so a caller sees the
 *  state it produced without a second call. */
function describe(account, registry, catalogue) {
  const anthropic = isAnthropicLane(account);
  const derived = deriveModels(registry, catalogue);
  return {
    id: account.id,
    anthropic,
    registry,
    derived: { ...derived, available: availableFor(registry, catalogue, anthropic) },
    catalogue: catalogue === null
      ? null
      : { fetchedAt: catalogue.fetchedAt, stale: catalogue.stale, count: catalogue.models.length },
    settingsDrift: settingsDrift(account, registry, catalogue),
  };
}

/** §11's ORPHAN: a registry file whose id is in no roster row — typically
 *  after `ccrc account remove`, which deliberately never deletes under
 *  ~/.ccrc/models/ and names `ccrc models <id> rm` as the remedy. There is no
 *  ACCOUNT here to read a `configDirSuffix` or a `telemetry` field from, so
 *  every class reads as UNAVAILABLE regardless of what the registry itself
 *  assigns — nothing routes a session to this id — and `settingsDrift` is
 *  meaningless with no settings.json to compare the registry against. */
function orphanDescribe(id, registry, catalogue) {
  const derived = deriveModels(registry, catalogue);
  return {
    id,
    orphan: true,
    anthropic: false,
    registry,
    derived: { ...derived, available: [] },
    catalogue: catalogue === null
      ? null
      : { fetchedAt: catalogue.fetchedAt, stale: catalogue.stale, count: catalogue.models.length },
    settingsDrift: [],
  };
}

/** `--endpoints` + the ownership whitelist (§5). The whitelist holds SLUGS
 *  (`google-ai-studio`); an endpoints body holds DISPLAY NAMES
 *  (`Google AI Studio`), so the two are compared through one normalisation and
 *  not raw — raw, the check would refuse every model on the list. */
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function whitelistCheck(endpointsFile) {
  const wl = path.join(HOME, '.handoff', 'providers-whitelist.json');
  let allowed;
  try {
    const parsed = JSON.parse(readFileSync(wl, 'utf8'));
    allowed = new Set((Array.isArray(parsed.providers) ? parsed.providers : []).map(slugify));
  } catch (e) {
    return { err: ['whitelist-absent',
      `${wl} could not be read (${e.message}), so this box cannot say which providers are allowed `
      + 'to serve a model — and handoff-proxy injects that list as provider.only on every request, '
      + 'so the lane would refuse anyway. Nothing was written.'] };
  }
  let names;
  try {
    const body = JSON.parse(readFileSync(endpointsFile, 'utf8'));
    const eps = body?.data?.endpoints;
    if (!Array.isArray(eps)) throw new Error('no data.endpoints array');
    names = eps.map((e) => (isObj(e) ? e.provider_name ?? e.name : null)).filter((n) => typeof n === 'string');
  } catch (e) {
    return { err: ['endpoints-invalid',
      `${endpointsFile} is not an OpenRouter endpoints answer: ${e.message}. Nothing was written.`] };
  }
  const servedBy = [...new Set(names.map(slugify))].filter((s) => allowed.has(s));
  if (servedBy.length === 0) {
    return { err: ['no-allowed-provider',
      `no ownership-whitelisted provider serves this model. It is served by: ${names.join(', ')}. `
      + `Add one of those to ${wl} if it belongs there, or pick a different model.`] };
  }
  return { servedBy };
}

/** DATA: one row per op naming the keys it takes and which of them are
 *  required. */
const OPS = {
  lanes: { keys: ['file'], required: ['file'] },
  show: { keys: ['file', 'id'], required: ['file', 'id'] },
  init: { keys: ['file', 'id', 'probe', 'base-url'], required: ['file', 'id', 'probe'] },
  'set-class': { keys: ['file', 'id', 'class', 'model'], required: ['file', 'id', 'class', 'model'] },
  'set-subagent': { keys: ['file', 'id', 'class'], required: ['file', 'id', 'class'] },
  'set-effort': { keys: ['file', 'id', 'class', 'level'], required: ['file', 'id', 'class', 'level'] },
  discovery: { keys: ['file', 'id', 'action', 'model', 'endpoints'], required: ['file', 'id', 'action'] },
  materialise: { keys: ['file', 'id'], required: ['file', 'id'] },
  rm: { keys: ['file', 'id'], required: ['file', 'id'] },
};

/** `--key value` pairs, refused rather than ignored, with a strict `i += 2`
 *  walk: a value that itself starts with `--` is refused, because accepting it
 *  would consume the NEXT token as a key and shift every following pair by one
 *  slot silently instead of failing loudly. */
function readPairs(argv, spec) {
  const got = {};
  for (let i = 3; i < argv.length; i += 2) {
    const k = argv[i];
    if (typeof k !== 'string' || !k.startsWith('--')) {
      return { err: `${JSON.stringify(k ?? '')} is not a --key` };
    }
    const name = k.slice(2);
    if (!spec.keys.includes(name)) return { err: `unknown key --${name}` };
    const v = argv[i + 1];
    if (typeof v !== 'string') return { err: `--${name} needs a value` };
    if (v.startsWith('--')) return { err: `--${name}'s value must not start with "--" (got ${v})` };
    got[name] = v;
  }
  for (const need of spec.required) {
    if (got[need] === undefined) return { err: `--${need} is required` };
  }
  return { got };
}

function main(argv) {
  const opName = argv[2];
  const spec = OPS[opName];
  if (spec === undefined) {
    return refuse(2, 'bad-argv',
      `unknown op ${JSON.stringify(opName ?? '')}. This build has: ${Object.keys(OPS).join(', ')}.`);
  }
  const pairs = readPairs(argv, spec);
  if (pairs.err !== undefined) return refuse(2, 'bad-argv', pairs.err);
  const a = pairs.got;

  const r = readRoster(a.file);
  if (r.err !== undefined) return refuse(1, r.err[0], r.err[1]);
  const json = r.json;

  if (opName === 'lanes') {
    const lanes = [];
    for (const acc of (json.accounts ?? [])) {
      if (!isObj(acc) || !canCarryRegistry(acc)) continue;
      const cat = readCatalogue(acc.id);
      const reg = cat.err !== undefined ? { registry: null } : readRegistry(acc.id, cat.catalogue);
      const registry = reg.registry ?? null;
      lanes.push({
        id: acc.id, configDirSuffix: acc.configDirSuffix, anthropic: false,
        hasRegistry: registry !== null || reg.invalid !== undefined,
        probe: registry === null ? null : registry.probe,
        baseUrl: registry === null || registry.baseUrl === undefined ? null : registry.baseUrl,
      });
    }
    out({ ok: true, op: 'lanes', lanes });
    return 0;
  }

  const account = findAccount(json, a.id);

  if (opName === 'rm') {
    // REAP, not a mutation (spec §4.1 Lifecycle, §10, §11): deletes the four
    // generated files this design owns and clears exactly the eight settings
    // keys `modelEnvBlock` can write — nothing else in that file. It runs BEFORE
    // the no-such-account and anthropic-lane gates below, and never routes the
    // registry or catalogue through their validators: `rm -f` semantics apply
    // to each of the four files on its own, so a broken (unparseable)
    // registry or catalogue is still reaped rather than blocking the one verb
    // that exists to clean it up. `ccrc account remove` deliberately never
    // deletes under ~/.ccrc/models/ and names this verb as the remedy, so an
    // ORPHAN — no roster row for this id — is the expected case, not an
    // error: there is no configDirSuffix to find a settings.json through, so
    // the settings step is skipped, and the answer says so.
    const removed = [];
    for (const p of [registryPath(a.id), cataloguePath(a.id), classesTsvPath(a.id), effortPath(a.id)]) {
      try {
        unlinkSync(p);
        removed.push(p);
      } catch (e) {
        if (e.code !== 'ENOENT') return refuse(1, 'unwritable', `${p} could not be removed: ${e.message}.`);
      }
    }
    let settings = 'orphan';
    if (account !== null) {
      const settingsPath = path.join(HOME, account.configDirSuffix, 'settings.json');
      try {
        settings = clearSettingsEnv(settingsPath, MODEL_ENV_KEYS).changed ? 'cleared' : 'unchanged';
      } catch (e) {
        if (e instanceof ModelEnvInvalid) return refuse(1, 'settings-unwritable', e.message);
        throw e;
      }
    }
    out({ ok: true, op: 'rm', id: a.id, removed, settings });
    return 0;
  }

  if (account === null) {
    if (opName === 'show') {
      // §11's ORPHAN: a registry file exists for an id the roster has no row
      // for. Not an error — `ccrc account remove` leaves it there on purpose —
      // so `show` answers rather than refusing, with every class read as
      // unavailable: there is no account to route a session through, whatever
      // the registry itself assigns.
      const cat0 = readCatalogue(a.id);
      if (cat0.err !== undefined) return refuse(1, cat0.err[0], cat0.err[1]);
      const reg0 = readRegistry(a.id, cat0.catalogue);
      if (reg0.err !== undefined) return refuse(1, reg0.err[0], reg0.err[1]);
      if (reg0.invalid !== undefined) return refuseRegistry(reg0.invalid, a.id);
      if (reg0.registry !== null) {
        out({ ok: true, op: 'show', ...orphanDescribe(a.id, reg0.registry, cat0.catalogue) });
        return 0;
      }
    }
    return refuse(1, 'no-such-account',
      `${a.file} has no account "${a.id}". Its ids are: `
      + `${(json.accounts ?? []).map((x) => x.id).join(', ')}.`);
  }
  if (isAnthropicLane(account)) {
    // Every op but `show` is refused on such a lane. `show` answers, because
    // "this lane has all four classes and they are the client's own" is a
    // useful answer and the one every surface renders (§4.1, decision 4).
    if (opName !== 'show') {
      return refuse(1, 'anthropic-lane',
        `account "${a.id}" is an Anthropic lane (telemetry: anthropic): its four classes are Claude `
        + 'Code\'s own defaults, shown read-only, and it carries no class registry. Nothing was '
        + 'written.');
    }
  }

  const cat = readCatalogue(a.id);
  if (cat.err !== undefined) return refuse(1, cat.err[0], cat.err[1]);
  const catalogue = cat.catalogue;

  const reg = readRegistry(a.id, catalogue);
  if (reg.err !== undefined) return refuse(1, reg.err[0], reg.err[1]);
  if (reg.invalid !== undefined) return refuseRegistry(reg.invalid, a.id);
  let registry = reg.registry;

  if (opName === 'show') {
    out({ ok: true, op: 'show', ...describe(account, registry, catalogue) });
    return 0;
  }

  if (opName === 'materialise') {
    const mat = materialise(account, registry, catalogue);
    if (mat.err !== undefined) return refuse(1, mat.err[0], mat.err[1]);
    out({ ok: true, op: 'materialise', id: a.id, wrote: mat.wrote });
    return 0;
  }

  let extra = {};

  if (opName === 'init') {
    if (!PROBE_KINDS.includes(a.probe)) {
      return refuse(1, 'unknown-probe',
        `"${a.probe}" is not a probe kind: it must be one of ${PROBE_KINDS.join(', ')}. The Codex `
        + 'probe is spelled "codex".', 'probe');
    }
    if (registry !== null) {
      if (registry.probe !== a.probe) {
        return refuse(1, 'probe-declared',
          `account "${a.id}" already has a class registry whose probe is "${registry.probe}", and `
          + `this run was asked for "${a.probe}". Changing a lane's probe kind is not an init — `
          + `remove ${registryPath(a.id)} deliberately if that is what you mean.`, 'probe');
      }
      out({ ok: true, op: 'init', created: false, ...describe(account, registry, catalogue) });
      return 0;
    }
    const seed = JSON.parse(JSON.stringify(SEEDS[a.probe]));
    if (a['base-url'] !== undefined) seed.baseUrl = a['base-url'];
    try {
      registry = parseRegistry(seed, catalogue);
    } catch (e) {
      if (e instanceof RegistryInvalid) return refuseRegistry(e, a.id);
      throw e;
    }
    const w = writeRegistry(a.id, registry);
    if (w !== null) return refuse(1, w[0], w[1]);
    const mat = materialise(account, registry, catalogue);
    if (mat.err !== undefined) return refuse(1, mat.err[0], mat.err[1]);
    const answer = { ok: true, op: 'init', created: true, ...describe(account, registry, catalogue) };
    if (CLASSES.every((c) => registry.classes[c] === null)) {
      answer.remedy = `probe "${a.probe}" ships no seed mapping — only you can say which of its `
        + `models belongs in which class. Build the lane with 'ccrc models ${a.id} discovery add `
        + `<modelId>' and 'ccrc models ${a.id} set-class <class> <modelId>'.`;
    }
    out(answer);
    return 0;
  }

  // Every remaining op MUTATES an existing registry.
  if (registry === null) {
    return refuse(1, 'no-registry',
      `account "${a.id}" has no class registry yet. Run 'ccrc models ${a.id} init `
      + `<${PROBE_KINDS.join('|')}>' first — it creates ${registryPath(a.id)}.`);
  }
  const next = JSON.parse(JSON.stringify(registry));

  if (opName === 'set-class') {
    if (!CLASSES.includes(a.class)) {
      return refuse(1, 'unknown-class',
        `"${a.class}" is not a class: the four are ${CLASSES.join(', ')}. "subagent" is not one of `
        + `them — run 'ccrc models ${a.id} set-subagent <class>' to choose which class subagents `
        + 'run as.');
    }
    if (a.model === 'none') {
      next.classes[a.class] = null;
    } else {
      if (!MODEL_ID_RE.test(a.model)) {
        return refuse(1, 'bad-model-id',
          `"${a.model}" is not a model id: a letter or digit followed by up to 127 of letters, `
          + 'digits, ".", "_", ":", "/" and "-".');
      }
      if (catalogue !== null && !catalogue.models.some((m) => m.id === a.model)) {
        // Only when a catalogue EXISTS. With none, the operator is the only
        // source of truth about what this lane serves, and refusing would make
        // a never-probed lane unconfigurable.
        return refuse(1, 'not-in-catalogue',
          `"${a.model}" is not in account "${a.id}"'s catalogue. Run 'ccrc models refresh ${a.id}' `
          + 'if it is new, or check the spelling.');
      }
      // ONE MODEL, ONE CLASS — §8's radio-across-the-row rule, enforced in the
      // verb because the verb exists for scripts and for doctor's remedies.
      const moved = [];
      for (const c of CLASSES) {
        if (c !== a.class && next.classes[c] === a.model) { next.classes[c] = null; moved.push(c); }
      }
      next.classes[a.class] = a.model;
      // An explicit discovery list has to offer what a class routes to, and the
      // operator asked for this model by name — so the list GAINS it rather
      // than the assignment being refused for a reason the caller cannot act on.
      if (Array.isArray(next.discovery) && !next.discovery.includes(a.model)) {
        next.discovery = [...next.discovery, a.model];
      }
      extra = { moved };
    }
  } else if (opName === 'set-subagent') {
    if (!CLASSES.includes(a.class)) {
      return refuse(1, 'unknown-class',
        `"${a.class}" is not a class: the four are ${CLASSES.join(', ')}.`);
    }
    if (next.classes[a.class] === null) {
      // Refused HERE, with the remedy that names the class the caller asked
      // for — the validator's own sentence cannot know which class was meant.
      return refuse(1, 'class-unassigned',
        `account "${a.id}" routes ${a.class} to nothing, so subagents cannot run as it: `
        + 'CLAUDE_CODE_SUBAGENT_MODEL would be a sentinel and every subagent on this lane would '
        + `fail. Run 'ccrc models ${a.id} set-class ${a.class} <modelId>' first.`, 'subagent');
    }
    next.subagent = a.class;
  } else if (opName === 'set-effort') {
    if (!CLASSES.includes(a.class)) {
      return refuse(1, 'unknown-class',
        `"${a.class}" is not a class: the four are ${CLASSES.join(', ')}.`);
    }
    if (a.level === 'default') {
      if (isObj(next.effort)) delete next.effort[a.class];
      if (isObj(next.effort) && Object.keys(next.effort).length === 0) delete next.effort;
    } else {
      if (next.classes[a.class] === null) {
        return refuse(1, 'class-unassigned',
          `account "${a.id}" routes ${a.class} to nothing, so there is no model to set an effort `
          + `on. Run 'ccrc models ${a.id} set-class ${a.class} <modelId>' first.`);
      }
      next.effort = { ...(isObj(next.effort) ? next.effort : {}), [a.class]: a.level };
    }
  } else if (opName === 'discovery') {
    if (a.action === 'catalogue') {
      next.discovery = 'catalogue';
    } else if (a.action === 'add' || a.action === 'rm') {
      if (a.model === undefined) {
        return refuse(2, 'bad-argv', `discovery ${a.action} needs --model`);
      }
      if (!MODEL_ID_RE.test(a.model)) {
        return refuse(1, 'bad-model-id', `"${a.model}" is not a model id.`);
      }
      const current = Array.isArray(next.discovery) ? [...next.discovery] : [];
      if (a.action === 'add') {
        if (a.endpoints !== undefined) {
          const w = whitelistCheck(a.endpoints);
          if (w.err !== undefined) return refuse(1, w.err[0], w.err[1]);
          extra = { servedBy: w.servedBy };
        }
        next.discovery = current.includes(a.model) ? current : [...current, a.model];
      } else {
        next.discovery = current.filter((m) => m !== a.model);
      }
    } else {
      return refuse(2, 'bad-argv',
        `discovery takes add, rm or catalogue, and got ${JSON.stringify(a.action)}`);
    }
  }

  // RULE 2. The MUTATED registry goes back through the validator — with the
  // catalogue, so an effort level the lane cannot serve is refused here too —
  // and then through the env-block derivation, so a mutation that leaves the
  // lane routing nowhere (§11's "all four slots null") is refused with nothing
  // on disk changed.
  let validated;
  try {
    validated = parseRegistry(next, catalogue);
  } catch (e) {
    if (e instanceof RegistryInvalid) return refuseRegistry(e, a.id);
    throw e;
  }
  if (CLASSES.some((c) => validated.classes[c] !== null)) {
    try {
      // The eighth key can never throw (it is written or omitted, never
      // refused), so `catalogue` only matters here for consistency with every
      // other call — this check is purely "does the lane route anywhere".
      modelEnvBlock(validated, catalogue);
    } catch (e) {
      if (e instanceof ModelEnvInvalid) return refuse(1, 'unroutable-lane', e.message);
      throw e;
    }
  } else if (CLASSES.some((c) => registry.classes[c] !== null)) {
    // Going from seeded to unseeded is the one transition that would silently
    // un-route a live lane, so it is refused with the materialiser's own
    // sentence rather than accepted as "an unseeded registry, which is legal".
    return refuse(1, 'unroutable-lane',
      'a lane needs at least one class among opus, sonnet and haiku: clearing this one would leave '
      + `account "${a.id}" with no model at all for an unqualified request.`);
  }
  const w = writeRegistry(a.id, validated);
  if (w !== null) return refuse(1, w[0], w[1]);
  const mat = materialise(account, validated, catalogue);
  if (mat.err !== undefined) return refuse(1, mat.err[0], mat.err[1]);
  out({ ok: true, op: opName, ...extra, ...describe(account, validated, catalogue) });
  return 0;
}

process.exit(main(process.argv));
