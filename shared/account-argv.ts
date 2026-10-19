// The ONE argv builder for `ccrc account <sub>` (spec §13.2 "Input bounds"; accounts plan Task A8, D-5622). Both
// `AccountOps` arms call it: the agent's typed `account` op (`agent/src/accountop.ts`) and the server's local spawn
// (`server/src/accounts/ops.ts`), so a bound is spelled once and neither arm can drift from the other (D-5620 (4)).
//
// NO FREE ARGV. The caller hands typed fields; this file decides every flag that reaches the verb. A field this
// table does not name, a value off its field's grammar, a value that starts with `-`, a `..` path segment, or any
// C0 byte or DEL is refused BEFORE any spawn. There is no field that becomes `--force`, `--replace`, `install` or a
// ceiling raise: the management key's install and replace and every raise stay CLI-only (D-5554), and `seed` is not
// a sub (`check` runs it in-verb, D-5518). Every value rides ONE argv word, `--flag=<v>`, never two, so a value can
// never be read as the next flag.
//
// THE SECRET IS NEVER HERE. Secrets and codes ride stdin (`isAccountStdin`), never a field: `/proc/<pid>/cmdline` is
// readable by every process on the box.
//
// Pure: no `node:*`, no Buffer. It imports the sub union from `./api.js` and the roster's grammars from `./roster.js`.
import { ACCOUNT_SUBS, type AccountSub } from './api.js';
import { ACCOUNT_ID_RE, HUES, MODEL_ID_RE } from './roster.js';

/** Why the builder refused, each its own word. `bad-sub`: off `ACCOUNT_SUBS`. `bad-id`: the lane id is off the
 *  roster's grammar, or given to a sub that names no lane, or missing from one that does. `bad-field`: a field this
 *  sub does not take, a value off its grammar, a required field missing, or stdin given to a sub that reads none
 *  (or none given to one that needs it). `key-charset`: the stdin bytes are empty, over `ACCOUNT_STDIN_MAX_BYTES`, or
 *  carry a NUL, another C0 byte or DEL (spec §13.2's word). */
export const ACCOUNT_ARGV_REFUSALS = ['bad-sub', 'bad-id', 'bad-field', 'key-charset'] as const;
export type AccountArgvRefusal = (typeof ACCOUNT_ARGV_REFUSALS)[number];

/** The most stdin a sub may carry: a secret or a code (spec §13.2, "≤ 8 KiB"). */
export const ACCOUNT_STDIN_MAX_BYTES = 8 * 1024;

/** C0 controls and DEL: a newline in a field is a second line in every file the verb writes it to. The spec's
 *  `LABEL_UNSAFE_RE` (`shared/roster.ts`, module-private by design) re-spelled, one class for every field (D-5622 (2));
 *  `account-argv.test.ts` pins the two literals equal. */
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
/** A `..` path segment anywhere in a value (`../x`, `a/../b`, `..`). */
const DOT_DOT_SEGMENT_RE = /(?:^|[/\\])\.\.(?:[/\\]|$)/;
/** Whole dollars from 1 to 100000, digits only, no leading zero. */
const DOLLARS_RE = /^[1-9][0-9]{0,5}$/;
const DOLLARS_MAX = 100_000;
/** The server-generated attempt id: 32 lowercase hex characters. */
const ATTEMPT_ID_RE = /^[0-9a-f]{32}$/;
/** The most model ids one `--models` list may carry. */
const MODELS_MAX = 16;

/** A field's grammar. Each `check` sees a string that already passed the global rules (no C0/DEL, no leading `-`, no
 *  `..` segment). `flag`: the value must be exactly `true`, and the flag is written bare. */
type FieldRule =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'label' } | { kind: 'stated' } | { kind: 'dollars' } | { kind: 'attempt' } | { kind: 'models' }
  | { kind: 'flag' };

interface FieldSpec { readonly flag: string; readonly rule: FieldRule; readonly required?: true }

interface SubSpec {
  /** The CLI words after `account`: the sub's own spelling (the management subs are `openrouter-management <sub>`). */
  readonly cli: readonly string[];
  /** Whether the sub names a lane (`--id=<id>`). */
  readonly lane: boolean;
  /** What the sub reads on stdin. */
  readonly stdin: 'none' | 'optional' | 'required';
  /** Fixed words after the fields, never from a caller. */
  readonly fixed?: readonly string[];
  /** The fields it takes, in the order they are written. */
  readonly fields: Readonly<Record<string, FieldSpec>>;
}

const e = (...values: string[]): FieldRule => ({ kind: 'enum', values: Object.freeze(values) });

/** The providers a session may add a lane for. `compatible` is CLI-only (spec §13.2: its base URL is the CLI's). */
const ADD_PROVIDERS = e('anthropic', 'openai', 'openrouter');
/** `add`'s methods: Anthropic's three, OpenRouter's three (spec §13.1). */
const ADD_METHODS = e('login', 'paste', 'setup-token', 'mint', 'pkce');
/** `auth-start`'s methods (spec §13.1). */
const AUTH_METHODS = e('login', 'setup-token', 'openai-login', 'openrouter-pkce');
const PLACEMENTS = e('overflow', 'full');
/** OpenRouter's `limit_reset`, with `never` for no reset (spec §8.8). */
const LIMIT_RESETS = e('daily', 'weekly', 'monthly', 'never');
const EXPIRES_IN = e('90d', '365d', 'never');

const label: FieldSpec = { flag: '--label', rule: { kind: 'label' } };
const placement: FieldSpec = { flag: '--placement', rule: PLACEMENTS };
const limit: FieldSpec = { flag: '--limit', rule: { kind: 'dollars' } };
const limitReset: FieldSpec = { flag: '--limit-reset', rule: LIMIT_RESETS };
const attempt: FieldSpec = { flag: '--attempt', rule: { kind: 'attempt' }, required: true };

/** THE TABLE: every sub, its CLI spelling and the only fields it takes. Keyed by `AccountSub`, so a sub added to
 *  `ACCOUNT_SUBS` without a row here is a compile error. */
export const ACCOUNT_SUB_ARGV: Readonly<Record<AccountSub, SubSpec>> = Object.freeze({
  'add': {
    cli: ['add'], lane: true, stdin: 'optional',
    fields: {
      provider: { flag: '--provider', rule: ADD_PROVIDERS, required: true }, method: { flag: '--method', rule: ADD_METHODS },
      label, hue: { flag: '--hue', rule: e(...HUES) }, placement, models: { flag: '--models', rule: { kind: 'models' } },
      limit, limitReset, expiresIn: { flag: '--expires-in', rule: EXPIRES_IN }, adopt: { flag: '--adopt', rule: { kind: 'flag' } },
    },
  },
  'auth-start': { cli: ['auth-start'], lane: true, stdin: 'none', fields: { method: { flag: '--method', rule: AUTH_METHODS, required: true }, attemptId: attempt } },
  'auth-code': { cli: ['auth-code'], lane: true, stdin: 'required', fields: { attemptId: attempt } },
  'auth-cancel': { cli: ['auth-cancel'], lane: true, stdin: 'none', fields: { attemptId: attempt } },
  'set': {
    cli: ['set'], lane: true, stdin: 'none',
    fields: { stated: { flag: '--stated', rule: { kind: 'stated' } }, placement, limit, limitReset },
  },
  'check': { cli: ['check'], lane: true, stdin: 'none', fields: {} },
  'enable': { cli: ['enable'], lane: true, stdin: 'none', fields: {} },
  'disable': { cli: ['disable'], lane: true, stdin: 'none', fields: {} },
  'credential': {
    cli: ['credential'], lane: true, stdin: 'optional',
    fields: {
      method: { flag: '--method', rule: e('mint') }, retire: { flag: '--retire', rule: { kind: 'flag' } },
      liveAck: { flag: '--live-ack', rule: { kind: 'flag' } },
    },
  },
  'remove': {
    cli: ['remove'], lane: true, stdin: 'none',
    fields: { mode: { flag: '--mode', rule: e('remove', 'discard') }, deleteCodexAuth: { flag: '--delete-codex-auth', rule: { kind: 'flag' } } },
  },
  'roster': { cli: ['roster'], lane: false, stdin: 'none', fields: {} },
  'or-management-remove': { cli: ['openrouter-management', 'remove'], lane: false, stdin: 'none', fields: {} },
  // `--lower-only` is FIXED: the agent's sub can never raise the ceiling, whatever figure it carries (D-5554; the
  // verb refuses a figure above the current ceiling under that flag, A30).
  'or-management-lower': {
    cli: ['openrouter-management', 'ceiling'], lane: false, stdin: 'none', fixed: ['--lower-only'],
    fields: { ceiling: { flag: '--usd', rule: { kind: 'dollars' }, required: true } },
  },
} satisfies Record<AccountSub, SubSpec>);

const SUBS: ReadonlySet<string> = new Set(ACCOUNT_SUBS);

/** Whether `v` is a sub in the union. */
export function isAccountSub(v: unknown): v is AccountSub {
  return typeof v === 'string' && SUBS.has(v);
}

/** Whether `v` is a lane id the verb may be handed as `--id=<v>`: the roster's grammar, never `-`-led, never a
 *  `.`/`..` path name. */
export function isAccountLaneId(v: unknown): v is string {
  return typeof v === 'string' && ACCOUNT_ID_RE.test(v) && !v.startsWith('-') && v !== '.' && v !== '..';
}

function codePoints(v: string): number {
  let n = 0;
  for (const _ of v) n += 1;
  return n;
}

function valueOk(rule: FieldRule, v: string): boolean {
  switch (rule.kind) {
    case 'enum': return rule.values.includes(v);
    case 'label': { const n = codePoints(v); return n >= 1 && n <= 64; }
    case 'stated': { const n = codePoints(v); return n >= 1 && n <= 120; }
    case 'dollars': return DOLLARS_RE.test(v) && Number(v) <= DOLLARS_MAX;
    case 'attempt': return ATTEMPT_ID_RE.test(v);
    case 'models': {
      const ids = v.split(',');
      return ids.length <= MODELS_MAX && ids.every((m) => MODEL_ID_RE.test(m)) && new Set(ids).size === ids.length;
    }
    case 'flag': return v === 'true';
  }
}

/** Every value, whatever its field: a string, no C0 byte or DEL, never `-`-led, no `..` path segment. */
function globallyOk(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && !CONTROL_RE.test(v) && !v.startsWith('-') && !DOT_DOT_SEGMENT_RE.test(v);
}

export type AccountArgvBuilt = { readonly ok: true; readonly argv: readonly string[] } | { readonly ok: false; readonly why: AccountArgvRefusal };

/**
 * THE BUILDER. `sub`, `laneId` and `fields` are untrusted (a frame off the wire, a route's body); `hasStdin` says
 * whether the caller carries stdin bytes, which `isAccountStdin` judges separately. Answers the argv AFTER the
 * launcher (`account <cli…> [--id=<id>] [--flag=<v>…] [fixed…]`), frozen, or the first refusal. Never throws.
 */
export function buildAccountArgv(sub: unknown, laneId: unknown, fields: unknown, hasStdin: boolean): AccountArgvBuilt {
  if (!isAccountSub(sub)) return { ok: false, why: 'bad-sub' };
  const spec = ACCOUNT_SUB_ARGV[sub];
  if (spec.lane ? !isAccountLaneId(laneId) : laneId !== null) return { ok: false, why: 'bad-id' };
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return { ok: false, why: 'bad-field' };
  const proto = Object.getPrototypeOf(fields) as unknown;
  if (proto !== Object.prototype && proto !== null) return { ok: false, why: 'bad-field' };
  const given = fields as Record<string, unknown>;
  for (const key of Object.keys(given)) if (!Object.hasOwn(spec.fields, key)) return { ok: false, why: 'bad-field' };
  if (spec.stdin === 'none' && hasStdin) return { ok: false, why: 'bad-field' };
  if (spec.stdin === 'required' && !hasStdin) return { ok: false, why: 'bad-field' };
  const argv: string[] = ['account', ...spec.cli];
  if (spec.lane) argv.push(`--id=${laneId as string}`);
  for (const [key, f] of Object.entries(spec.fields)) {
    if (!Object.hasOwn(given, key)) {
      if (f.required) return { ok: false, why: 'bad-field' };
      continue;
    }
    const v = given[key];
    if (!globallyOk(v) || !valueOk(f.rule, v)) return { ok: false, why: 'bad-field' };
    argv.push(f.rule.kind === 'flag' ? f.flag : `${f.flag}=${v}`);
  }
  if (spec.fixed) argv.push(...spec.fixed);
  return { ok: true, argv: Object.freeze(argv) };
}

/** Whether `bytes` may be a sub's stdin: 1 to `ACCOUNT_STDIN_MAX_BYTES` bytes, no NUL, other C0 byte or DEL (spec
 *  §13.2's `key-charset`). A secret carries no trailing newline: the verb reads its stdin to EOF. */
export function isAccountStdin(bytes: Uint8Array): boolean {
  if (bytes.length < 1 || bytes.length > ACCOUNT_STDIN_MAX_BYTES) return false;
  for (const b of bytes) if (b < 0x20 || b === 0x7f) return false;
  return true;
}
