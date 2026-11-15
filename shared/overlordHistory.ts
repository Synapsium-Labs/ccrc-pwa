/**
 * The Overlord's history read, on the wire (Overlord W1, plan
 * `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md`, Task 3; spec 2026-11-09 §3.2, C47).
 *
 * The agent op `overlord-history` runs `ccrc history`'s three read verbs (search, describe, expand) over every project,
 * in a worker thread of the agent's process. This file is the op's L0 vocabulary: the request, its ONE reader
 * (`readOverlordHistoryRequest`, called by the agent's `validateReq` arm and, from PR B1, the server's door), the answer,
 * and its ONE reader (`readOverlordHistoryAnswer`, called by the server's adapter). It imports nothing.
 *
 * - The request names one target (question 6): `all`, one `project`, or one `session` id's family, every generation.
 *   It carries `agents` (the CLI's `--agents`) and the verb's own arguments. `regex`, and any argument spelling
 *   `--regex`, is refused (ruled F3, question 16): from the wire a regex search would be a child process.
 * - The reader ignores keys it does not know (absence permits): a newer server's extra key never makes an older agent
 *   refuse.
 * - The answer is one discriminated outcome (question 5), always on `ResOk`. A `rows` answer carries exactly
 *   `{exit, items, shown, total, scope}` (ruled R3): never `blocks`, `header`, `next` or `hint`, and every item keeps
 *   `trust: 'untrusted'`. Every other outcome carries a closed word, never a message.
 * - The history words (`HISTORY_REASON_WORDS`) are a hand copy of `ccd/history/lib.mjs`'s REASONS, which this L0 file
 *   cannot import; `server/test/overlord-read.test.ts` checks the copy against lib in both directions.
 * - It imports `shared/utf8.ts`' byte counter, the one UTF-8 counter, and nothing else.
 */
import { utf8Bytes } from './utf8.js';

/** The three read verbs the op runs. `search` is the CLI's `grep`. */
export type OverlordHistoryVerb = 'search' | 'describe' | 'expand';
const HISTORY_VERB_MAP: Record<OverlordHistoryVerb, true> = { search: true, describe: true, expand: true };
/** Every `OverlordHistoryVerb`, derived from the type. */
export const HISTORY_VERBS = Object.keys(HISTORY_VERB_MAP) as OverlordHistoryVerb[];

/** What a read covers: every project, one project, or one session id's family across its generations. */
export type OverlordHistoryTargetKind = 'all' | 'project' | 'session';
const TARGET_KIND_MAP: Record<OverlordHistoryTargetKind, true> = { all: true, project: true, session: true };
/** Every `OverlordHistoryTargetKind`, derived from the type. */
export const OVERLORD_HISTORY_TARGET_KINDS = Object.keys(TARGET_KIND_MAP) as OverlordHistoryTargetKind[];

export type OverlordHistoryTarget =
  | { readonly kind: 'all' }
  | { readonly kind: 'project'; readonly project: string }
  | { readonly kind: 'session'; readonly session: string };

/** One read, as the reader answers it: every field present, typed. */
export interface OverlordHistoryRequest {
  readonly verb: OverlordHistoryVerb;
  readonly target: OverlordHistoryTarget;
  /** The CLI's `--agents`: subagent transcripts are read too. */
  readonly agents: boolean;
  /** The verb's own arguments (search words and filters, a node id, `--cursor` …), as the CLI takes them after the verb. */
  readonly args: readonly string[];
}

/** Why the reader refused a request. A closed word, never a message. */
export type OverlordHistoryRequestRefusal =
  | 'not-object' | 'oversize' | 'bad-verb' | 'bad-target' | 'bad-project' | 'bad-session' | 'bad-agents' | 'bad-args' | 'regex';
const REQUEST_REFUSAL_MAP: Record<OverlordHistoryRequestRefusal, true> = {
  'not-object': true, oversize: true, 'bad-verb': true, 'bad-target': true, 'bad-project': true, 'bad-session': true,
  'bad-agents': true, 'bad-args': true, regex: true,
};
/** Every `OverlordHistoryRequestRefusal`, derived from the type. */
export const OVERLORD_HISTORY_REQUEST_REFUSALS = Object.keys(REQUEST_REFUSAL_MAP) as OverlordHistoryRequestRefusal[];

/** The request's bound, in UTF-8 bytes of its JSON. The server's door answers a larger body 413 before any agent is asked. */
export const OVERLORD_HISTORY_REQUEST_MAX_BYTES = 8192;
/** The most arguments a request carries, and the longest one. */
export const OVERLORD_HISTORY_ARGS_MAX = 32;
export const OVERLORD_HISTORY_ARG_MAX_CHARS = 1024;
/** A project name or session id: the registry id grammar (lib.mjs's idOk), at most this long. */
const NAME_RE = /^[A-Za-z0-9._-]{1,224}$/;
/** Arguments the target and the flags own, which the args list may not spell: the scope is the target's, `--agents`
 *  is the flag's and `--json` is the op's. `--regex` is refused with its own word. */
const SCOPE_ARGS: ReadonlySet<string> = new Set(['--session', '--project', '--workspace', '--agents', '--json']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nameOk = (v: unknown): v is string => typeof v === 'string' && NAME_RE.test(v) && v !== '.' && v !== '..';

function targetOf(raw: unknown): OverlordHistoryTarget | OverlordHistoryRequestRefusal {
  if (!isObj(raw)) return 'bad-target';
  const kind = raw['kind'];
  if (kind === 'all') return { kind };
  if (kind === 'project') return nameOk(raw['project']) ? { kind, project: raw['project'] } : 'bad-project';
  if (kind === 'session') return nameOk(raw['session']) ? { kind, session: raw['session'] } : 'bad-session';
  return 'bad-target';
}

/** THE ONE READER of an Overlord history request (a wire boundary: validated, never trusted). It answers the typed
 *  request, or the word it refused with. Keys it does not know are ignored, except `regex`, which is refused. */
export function readOverlordHistoryRequest(raw: unknown):
  { readonly ok: true; readonly request: OverlordHistoryRequest } | { readonly ok: false; readonly refusal: OverlordHistoryRequestRefusal } {
  const no = (refusal: OverlordHistoryRequestRefusal) => ({ ok: false, refusal }) as const;
  if (!isObj(raw)) return no('not-object');
  let text: string;
  try { text = JSON.stringify(raw); } catch { return no('not-object'); }
  if (utf8Bytes(text) > OVERLORD_HISTORY_REQUEST_MAX_BYTES) return no('oversize');
  if (Object.prototype.hasOwnProperty.call(raw, 'regex')) return no('regex');
  const verb = raw['verb'];
  if (typeof verb !== 'string' || !Object.prototype.hasOwnProperty.call(HISTORY_VERB_MAP, verb)) return no('bad-verb');
  const target = targetOf(raw['target']);
  if (typeof target === 'string') return no(target);
  const agents = raw['agents'] ?? false;
  if (typeof agents !== 'boolean') return no('bad-agents');
  const args = raw['args'] ?? [];
  if (!Array.isArray(args) || args.length > OVERLORD_HISTORY_ARGS_MAX) return no('bad-args');
  for (const a of args) {
    if (typeof a !== 'string' || a.length > OVERLORD_HISTORY_ARG_MAX_CHARS) return no('bad-args');
    if (a === '--regex' || a.startsWith('--regex=')) return no('regex');
    if (SCOPE_ARGS.has(a)) return no('bad-args');
  }
  return { ok: true, request: { verb: verb as OverlordHistoryVerb, target, agents, args: [...(args as string[])] } };
}

/** The scope record's `id`: one canonical string per target, so two spellings of one target never read as two. */
export function overlordTargetId(t: OverlordHistoryTarget): string {
  return t.kind === 'all' ? 'all' : t.kind === 'project' ? `project:${t.project}` : `session:${t.session}`;
}

/** `ccrc history`'s reason words (lib.mjs's REASONS, D-4171), a hand copy: the parity test reads lib and checks it both
 *  ways, so a word lib gains is red here until it is copied. */
export type HistoryReasonWord =
  | 'bad-args' | 'regex-syntax' | 'regex-refused' | 'regex-timeout' | 'cross-project' | 'out-of-scope'
  | 'project-unreadable' | 'headless-unarmed' | 'headless-in-pane' | 'headless-unlisted' | 'no-identity' | 'bad-id'
  | 'apply-in-session' | 'needs-tty' | 'irreversible-in-pane' | 'history-off' | 'span-pruned' | 'older-than-floor'
  | 'reparse-too-many' | 'workspace-unreadable' | 'harness-unsupported' | 'harness-unreadable' | 'generation-unreadable'
  | 'writer-absent' | 'adopt-refused' | 'restore-refused' | 'rebuild-refused' | 'migrate-refused' | 'repair-refused'
  | 'backup-refused' | 'recovering' | 'roster-unreadable' | 'uuid-claimed' | 'generation-malformed' | 'generation-mismatch'
  | 'asof-invalid' | 'headless-malformed' | 'headless-arm-unknown' | 'writer-busy' | 'probe-failed' | 'store-zero-byte'
  | 'store-schema-missing' | 'store-root-dangling' | 'store-missing' | 'store-mismatch' | 'store-unbound'
  | 'store-unreachable' | 'store-unmeasured' | 'store-recoverable' | 'store-wal-orphaned' | 'store-not-wal'
  | 'migration-pending' | 'schema-newer' | 'store-read-failed' | 'fts5-absent' | 'fts-pending';
const HISTORY_REASON_MAP: Record<HistoryReasonWord, true> = {
  'bad-args': true, 'regex-syntax': true, 'regex-refused': true, 'regex-timeout': true, 'cross-project': true,
  'out-of-scope': true, 'project-unreadable': true, 'headless-unarmed': true, 'headless-in-pane': true,
  'headless-unlisted': true, 'no-identity': true, 'bad-id': true, 'apply-in-session': true, 'needs-tty': true,
  'irreversible-in-pane': true, 'history-off': true, 'span-pruned': true, 'older-than-floor': true,
  'reparse-too-many': true, 'workspace-unreadable': true, 'harness-unsupported': true, 'harness-unreadable': true,
  'generation-unreadable': true, 'writer-absent': true, 'adopt-refused': true, 'restore-refused': true,
  'rebuild-refused': true, 'migrate-refused': true, 'repair-refused': true, 'backup-refused': true, recovering: true,
  'roster-unreadable': true, 'uuid-claimed': true, 'generation-malformed': true, 'generation-mismatch': true,
  'asof-invalid': true, 'headless-malformed': true, 'headless-arm-unknown': true, 'writer-busy': true,
  'probe-failed': true, 'store-zero-byte': true, 'store-schema-missing': true, 'store-root-dangling': true,
  'store-missing': true, 'store-mismatch': true, 'store-unbound': true, 'store-unreachable': true,
  'store-unmeasured': true, 'store-recoverable': true, 'store-wal-orphaned': true, 'store-not-wal': true,
  'migration-pending': true, 'schema-newer': true, 'store-read-failed': true, 'fts5-absent': true, 'fts-pending': true,
};
/** Every `HistoryReasonWord`, derived from the type. */
export const HISTORY_REASON_WORDS = Object.keys(HISTORY_REASON_MAP) as HistoryReasonWord[];

/** The op's own words, for the history exits that carry none (3, 6, 8 and 9, D-4171) and for its own failure:
 *  `not-indexed` exit 6 from a verb; `recall-off` exit 8 (unreachable: the read consults no session's marker, question
 *  7); `no-store` exit 9; `store-absent` an absent store; `internal` any failure the op masks. */
export type OverlordHistoryOwnWord = 'not-indexed' | 'recall-off' | 'no-store' | 'store-absent' | 'internal';
const OWN_WORD_MAP: Record<OverlordHistoryOwnWord, true> = {
  'not-indexed': true, 'recall-off': true, 'no-store': true, 'store-absent': true, internal: true,
};
/** Every `OverlordHistoryOwnWord`, derived from the type. */
export const OVERLORD_HISTORY_OWN_WORDS = Object.keys(OWN_WORD_MAP) as OverlordHistoryOwnWord[];

/** A verb's refusal: history's word, or `not-indexed`. */
export type OverlordVerbRefusedWord = HistoryReasonWord | 'not-indexed';
/** The store's refusal: history's word, or one of the op's three store words. */
export type OverlordStoreRefusedWord = HistoryReasonWord | 'recall-off' | 'no-store' | 'store-absent';

/** The outcome's discriminant (Table 2's agent half). */
export type OverlordHistoryOutcome =
  | 'rows' | 'verb-refused' | 'store-refused' | 'request-refused' | 'busy' | 'too-large' | 'deadline' | 'failed';
const OUTCOME_MAP: Record<OverlordHistoryOutcome, true> = {
  rows: true, 'verb-refused': true, 'store-refused': true, 'request-refused': true, busy: true, 'too-large': true,
  deadline: true, failed: true,
};
/** Every `OverlordHistoryOutcome`, derived from the type. */
export const OVERLORD_HISTORY_OUTCOMES = Object.keys(OUTCOME_MAP) as OverlordHistoryOutcome[];

/** The scope record of a `rows` answer (`recall.mjs#scopeJsonOf`): kind `overlord`, the canonical target as `id`. */
export interface OverlordHistoryScope {
  readonly kind: 'overlord';
  readonly id: string;
  readonly project: string | null;
  readonly families: readonly { readonly ccrc_id: string; readonly generation: string; readonly first_seen_ms: number }[];
  readonly families_total: number;
  readonly transcripts: number;
}

/** One recalled item, as the verb built it: text a session wrote, so it always carries `trust: 'untrusted'`. */
export type OverlordHistoryItem = Readonly<Record<string, unknown>> & { readonly trust: 'untrusted' };

export type OverlordHistoryAnswer =
  | { readonly outcome: 'rows'; readonly exit: 0 | 3; readonly items: readonly OverlordHistoryItem[];
    readonly shown: number; readonly total: number; readonly scope: OverlordHistoryScope }
  | { readonly outcome: 'verb-refused'; readonly word: OverlordVerbRefusedWord }
  | { readonly outcome: 'store-refused'; readonly word: OverlordStoreRefusedWord }
  | { readonly outcome: 'request-refused'; readonly word: OverlordHistoryRequestRefusal }
  | { readonly outcome: 'busy' }
  | { readonly outcome: 'too-large'; readonly bytes: number }
  | { readonly outcome: 'deadline' }
  | { readonly outcome: 'failed'; readonly word: 'internal' };

/** The whole answer's bound, in UTF-8 bytes of its JSON, measured inside the worker before it posts. The verbs already
 *  keep their output within `lib.mjs#OUTPUT_CAP`; this is the backstop. */
export const OVERLORD_HISTORY_ANSWER_MAX_BYTES = 65_536;
/** The most items a `rows` answer reads back. */
export const OVERLORD_HISTORY_ITEMS_MAX = 1000;
const SCOPE_ID_MAX = 512;

const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const has = (map: Record<string, true>, v: unknown): boolean =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v);

function scopeOf(v: unknown): OverlordHistoryScope | null {
  if (!isObj(v) || v['kind'] !== 'overlord') return null;
  const id = v['id'];
  const project = v['project'];
  const families = v['families'];
  if (typeof id !== 'string' || id.length === 0 || id.length > SCOPE_ID_MAX) return null;
  if (project !== null && typeof project !== 'string') return null;
  if (!Array.isArray(families) || !count(v['families_total']) || !count(v['transcripts'])) return null;
  const fams: { ccrc_id: string; generation: string; first_seen_ms: number }[] = [];
  for (const f of families) {
    if (!isObj(f) || typeof f['ccrc_id'] !== 'string' || typeof f['generation'] !== 'string' || !count(f['first_seen_ms'])) return null;
    fams.push({ ccrc_id: f['ccrc_id'], generation: f['generation'], first_seen_ms: f['first_seen_ms'] });
  }
  return { kind: 'overlord', id, project, families: fams, families_total: v['families_total'] as number, transcripts: v['transcripts'] as number };
}

function rowsOf(x: Record<string, unknown>): OverlordHistoryAnswer | null {
  const exit = x['exit'];
  const items = x['items'];
  const scope = scopeOf(x['scope']);
  if ((exit !== 0 && exit !== 3) || !Array.isArray(items) || items.length > OVERLORD_HISTORY_ITEMS_MAX || scope === null) return null;
  if (!count(x['shown']) || !count(x['total'])) return null;
  for (const it of items) if (!isObj(it) || it['trust'] !== 'untrusted') return null;
  let text: string;
  try { text = JSON.stringify(items); } catch { return null; }
  if (utf8Bytes(text) > OVERLORD_HISTORY_ANSWER_MAX_BYTES) return null;
  return {
    outcome: 'rows', exit, items: items as OverlordHistoryItem[], shown: x['shown'] as number, total: x['total'] as number, scope,
  };
}

/** THE ONE READER of the agent's `overlord-history` answer (a wire boundary: validated, never trusted): the typed
 *  outcome, or `'off-shape'` when it is in no shape this file knows. The server's adapter reads `off-shape` as `lost`. */
export function readOverlordHistoryAnswer(raw: unknown): OverlordHistoryAnswer | 'off-shape' {
  if (!isObj(raw)) return 'off-shape';
  const outcome = raw['outcome'];
  const word = raw['word'];
  switch (outcome) {
    case 'rows': return rowsOf(raw) ?? 'off-shape';
    case 'verb-refused':
      return has(HISTORY_REASON_MAP, word) || word === 'not-indexed' ? { outcome, word: word as OverlordVerbRefusedWord } : 'off-shape';
    case 'store-refused':
      return has(HISTORY_REASON_MAP, word) || word === 'recall-off' || word === 'no-store' || word === 'store-absent'
        ? { outcome, word: word as OverlordStoreRefusedWord } : 'off-shape';
    case 'request-refused':
      return has(REQUEST_REFUSAL_MAP, word) ? { outcome, word: word as OverlordHistoryRequestRefusal } : 'off-shape';
    case 'busy': return { outcome };
    case 'deadline': return { outcome };
    case 'too-large': return count(raw['bytes']) ? { outcome, bytes: raw['bytes'] as number } : 'off-shape';
    case 'failed': return word === 'internal' ? { outcome, word } : 'off-shape';
    default: return 'off-shape';
  }
}
