// The vocabulary generator (spec 2026-11-24 §5): writes core/internal/kernel/vocab/vocab_gen.go, the Go core's copy of
// the values its bash and TypeScript owners already hold, so no Go file ever spells one by hand. Each value is read
// from its OWNER, wherever the owner lives (`shared/*.ts`, `shared/*.mjs`, a named server module), never from a copy.
//
//   node core/gen/vocab.mjs           regenerate the Go file
//   server/test/vocab-gen.test.ts     fails when the committed file is not what this writes today
//
// HOW THE OWNERS ARE READ: TypeScript 7, the server's own compiler, has no in-process transpile API, and a
// repository-wide guard allows ONE importer of a TypeScript parser (server/test/scan/parse.ts; advance-switches.test.ts,
// D-5853, D-8288), so this never imports one. It runs the server's `tsc` binary as a process, by path, to emit the
// owners and everything they import into a temporary directory (no type check: the build's own typecheck owns that),
// copies `shared/*.mjs` beside them (tsc reads those through their `.d.mts` and emits nothing for them), and imports
// the result. Plain ESM with no npm import, so a bare `node` runs it.
//
// HOW A VALUE BECOMES GO (each declaration named after its export: HOOK_EVENTS is HookEvents):
//   a string, an integer, a boolean        a const
//   a RegExp (no flags)                    a const holding its source; RE2 reads every one listed here
//   an array of strings                    a []string, in the owner's order
//   an object of scalars, identifier keys  a const per key, named export + key (HOOK_CONSTANTS.CCRC_ID_MAX is
//                                          HookConstantsCcrcIdMax)
//   an object of strings, other keys       a map[string]string, keys sorted
//   anything else (nested)                 a const <Name>JSON holding its JSON text, keys in the owner's order;
//                                          its reader decodes it
// Anything the rules cannot place (a non-integer number, a flagged RegExp, an export that is undefined) fails the run:
// the generator never writes less than it was asked for.
//
// NOT GENERATED, each with its reason (wave 2 inventory §3a, §3b):
//   childDenyRules, approvalDigestBytes,   functions: behaviour, not values. The Go port re-implements each in the task
//   approvalParkDenyText                   that ports its arm, held equal by a parity test (the digest by the kernel
//                                          encoder's golden test over digest-corpus.json)
//   ROLE_SKILLS                            no shared export holds the hook's list (shared/fleetRoles.ts names roles,
//                                          not this list); a Go constant in the role-skill arm's own task
//   the hold grammar behind holdReason     no export holds the bound (run-routes derives 127); the same
//   HOOK_TIMEOUT_S (install-session-hooks) the installer's value, read where the installer reads it
//   ccd/lib/launch-profiles.json           read at run time from the installed tree, as the hook reads it (lib.mjs's
//                                          card and steer values ARE generated: Tasks 8a and 8b)
//   ccd's _reg_generation_valid, _sync_uuid  the registry's writers: REG_GENERATION_SHAPE above is their shape

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The generated file, repo-relative. */
export const OUT = 'core/internal/kernel/vocab/vocab_gen.go';

/** Each owner (repo-relative) and the exports taken from it: inventory §3a, plus §3b's two owners outside shared/*.ts. */
export const OWNERS = {
  'shared/hook-events.ts': ['HOOK_EVENTS'],
  'shared/claudeBuildCapture.ts': ['HOOK_COMMON_RULES', 'HOOK_EVENT_RULES', 'CAPTURE_EVENTS'],
  'shared/api.ts': ['CHILD_DENY_RULES', 'CHILD_DENY_SETTINGS_FILE', 'CHILD_DENY_PATH_QUALIFIED',
    'ACCOUNT_DENY_RULES', 'ACCOUNT_DENY_SUBS', 'ACCOUNT_SUBS', 'ACCOUNT_OP_RUNS', 'ACCOUNT_SECRET_PATHS',
    'ACCOUNT_WRITE_DIRS', 'ACCOUNT_ROSTER_FILES', 'ACCOUNT_READ_SUBS', 'ACCOUNT_CLI_ONLY_VERBS', 'LINEAR_MCP_DENY',
    'NON_DELEGATING_TASK_KINDS', 'TERMINAL_TASK_STATUSES', 'APPROVAL_HOOK_WAIT_S', 'APPROVAL_HOOK_STOP_STATES', 'APPROVAL_REQUEST_MAX_BYTES',
    'SERVER_CAPS', 'SERVER_CAPS_FILE', 'SERVER_CAPS_LEASE_S', 'SUPERVISED_FRESH_MS', 'REG_GENERATION_SHAPE',
    'DELEGATION_SPOOL_BOUNDS', 'IDLE_COMPACT_NOTICE_PREFIXES', 'IDLE_COMPACT_NUDGE_PROMPT'],
  'shared/account-argv.ts': ['ACCOUNT_SUB_ARGV'],
  'shared/ledgers.ts': ['OPERATOR_SECRETS_DIR'],
  'shared/approval-census.ts': ['APPROVAL_ROUTE_SKIP_WORDS'],
  'shared/mailHold.ts': ['MAILHOLD_RE_BODY', 'MAILHOLD_REACH_S', 'MAILHOLD_ROLES'],
  'shared/continuity-reports.ts': ['REPORT_TIMEOUT_S', 'DOOR_TOOL_PREFIX', 'AGENT_ID_RE', 'MODEL_SWITCH_HOWS',
    'REPORT_MODEL_MAX'],
  'shared/continuity-card.ts': ['ANCHOR_CARD_MAX_CHARS'],
  'shared/continuity-door.ts': ['DELTA_MAX_BYTES'],
  'shared/lane-arm.ts': ['RUNS_ROSTER_CARD_FIELD', 'ROSTER_CARD_SHADOW_LOG'],
  'shared/switches.ts': ['GRAPH_GATE_OFF_FILE', 'CCRC_CARD_OFF_FILE', 'COMPACT_CARD_OFF_FILE', 'SWITCHES'],
  'shared/agent-protocol.ts': ['HISTORY_STEER_ON_DIR'],
  'shared/tmux-target.ts': ['TMUX_SOCKET_FILE', 'TMUX_SOCKET_NAME_RE', 'TMUX_REFUSE_SH'],
  'shared/hook-helpers.mjs': ['HOOK_CONSTANTS'],
  'server/src/coord/approvalguard.ts': ['FORBIDDEN_CCD_VERBS'],
  'ccd/history/lib.mjs': ['HISTORY_ROOT_REL', 'CARD_DIR', 'SCOPE_DIR', 'RECALL_OFF_DIR', 'CARD_LINE_MAX', 'CARD_LINE_PATTERN', 'SWITCHES',
    'SPOOL_ID_MAX', 'SCOPE_MARKER_MAX_AGE_MS', 'STEER_FIRST_LINE', 'STEER_GENERIC_TEXT'],
};

/** HOOK_EVENTS -> HookEvents, lineBytesBelow -> LineBytesBelow. */
const goName = (s) => s.split('_').filter(Boolean)
  .map((p) => (/[a-z]/.test(p) && /[A-Z]/.test(p) ? p[0].toUpperCase() + p.slice(1) : p[0].toUpperCase() + p.slice(1).toLowerCase()))
  .join('');
const goString = (s) => JSON.stringify(s); // every JSON string escape is a Go one, and JSON.stringify writes no \/
const isScalar = (v) => ['string', 'number', 'boolean'].includes(typeof v);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function goScalar(where, v) {
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error(`${where}: ${v} is not an integer`);
  return typeof v === 'string' ? goString(v) : String(v);
}

/** The Go declarations of one export, as [goName, text] pairs. */
function declarations(owner, name, v) {
  const where = `${owner}#${name}`;
  const doc = (n, what = where) => `// ${n} is ${what}.\n`;
  const n = goName(name);
  if (v === undefined) throw new Error(`${where} is undefined: the owner has no such export`);
  if (v instanceof RegExp) {
    if (v.flags !== '') throw new Error(`${where} has flags /${v.flags}: a Go regexp source cannot carry them`);
    return [[n, `${doc(n, `${where}'s source`)}const ${n} = ${goString(v.source)}\n`]];
  }
  if (isScalar(v)) return [[n, `${doc(n)}const ${n} = ${goScalar(where, v)}\n`]];
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
    return [[n, `${doc(n)}var ${n} = []string{\n${v.map((x) => `\t${goString(x)},\n`).join('')}}\n`]];
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const entries = Object.entries(v);
    if (entries.length && entries.every(([k, x]) => IDENT.test(k) && isScalar(x))) {
      return entries.map(([k, x]) => [n + goName(k), `${doc(n + goName(k), `${where}.${k}`)}const ${n + goName(k)} = ${goScalar(`${where}.${k}`, x)}\n`]);
    }
    if (entries.length && entries.every(([, x]) => typeof x === 'string')) {
      const body = entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => `${goString(k)}: ${goString(x)}`).join(', ');
      return [[n, `${doc(n)}var ${n} = map[string]string{${body}}\n`]];
    }
  }
  const text = JSON.stringify(v, (k, x) => { if (x instanceof RegExp || typeof x === 'function' || x === undefined) throw new Error(`${where}${k ? `.${k}` : ''} has no JSON form`); return x; });
  return [[`${n}JSON`, `${doc(`${n}JSON`, `${where} as JSON text`)}const ${n}JSON = ${goString(text)}\n`]];
}

/** The owners, emitted by the server's tsc into a temporary directory and imported from there: { owner: module }. */
async function loadOwners() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-vocab-')));
  try {
    const ts = Object.keys(OWNERS).filter((f) => f.endsWith('.ts'));
    const tsc = path.join(REPO, 'server', 'node_modules', 'typescript', 'bin', 'tsc');
    try {
      execFileSync(process.execPath, [tsc, '--noCheck', '--skipLibCheck', '--declaration', 'false', '--module', 'nodenext',
        '--moduleResolution', 'nodenext', '--target', 'es2022', '--rootDir', '.', '--outDir', tmp, ...ts],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      throw new Error(`tsc could not emit the owners: ${String(e.stdout ?? '')}${String(e.stderr ?? e)}`);
    }
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}\n');
    fs.mkdirSync(path.join(tmp, 'shared'), { recursive: true });
    for (const f of fs.readdirSync(path.join(REPO, 'shared')).filter((f) => f.endsWith('.mjs'))) {
      fs.copyFileSync(path.join(REPO, 'shared', f), path.join(tmp, 'shared', f));
    }
    const mods = {};
    for (const owner of Object.keys(OWNERS)) {
      // an .mjs owner outside shared/ is plain ESM tsc never sees: imported where it stands
      const base = owner.endsWith('.mjs') && !owner.startsWith('shared/') ? REPO : tmp;
      mods[owner] = await import(pathToFileURL(path.join(base, owner.replace(/\.ts$/, '.js'))).href);
    }
    return mods;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The Go file's text, from the owners as they are now. */
export async function generate() {
  const mods = await loadOwners();
  const decls = new Map();
  for (const [owner, names] of Object.entries(OWNERS)) {
    for (const name of names) {
      for (const [n, text] of declarations(owner, name, mods[owner][name])) {
        if (decls.has(n)) throw new Error(`two declarations would be named ${n}`);
        decls.set(n, text);
      }
    }
  }
  const body = [...decls.keys()].sort().map((n) => decls.get(n)).join('\n');
  return '// Code generated by core/gen/vocab.mjs from the owners it names; DO NOT EDIT.\n'
    + '// Regenerate with `node core/gen/vocab.mjs`; server/test/vocab-gen.test.ts fails when this file is stale.\n\n'
    + '// Package vocab is ring L0: the values the Go core shares with its bash and TypeScript owners (spec 2026-11-24 §5).\n'
    + `package vocab\n\n${body}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const text = await generate();
  fs.mkdirSync(path.dirname(path.join(REPO, OUT)), { recursive: true });
  fs.writeFileSync(path.join(REPO, OUT), text);
  console.log(`wrote ${OUT}`);
}
