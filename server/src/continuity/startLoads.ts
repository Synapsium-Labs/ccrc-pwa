// L1, context C3 (Session Conversation): the loads report's two narrowings (Overlord spec §3.6 H4, Table 11.1e; W1 sandbox,
// plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`, Task 5). Pure: the body and the stored row arrive as
// arguments; nothing reads a clock or a file.
//
// `startLoadsOf` is the BODY's one narrowing, at the door: a malformed value of a known field or kind, an over-long list or
// a digest or build of the wrong shape is refused, naming the field. A kind word it does not know is IGNORED and dropped,
// never refused, so a newer hook's report reaches an older server whole for every kind both know (the start door's
// precedent, which maps an unknown `source` to `other`); a known kind the body lacks reads `unmeasured`, never empty.
// It also answers `bodySha256`, the hash of the narrowed body less `reportedAt`, so a resend of the same body (the hook
// spools it and resends the same bytes) is never a second one, and a different body for the same start is a conflict.
//
// `startLoadsRowOf` is the READ side's: a stored row narrowed again, so a kind or a value this build does not know reads
// `unmeasured` (the `startsSince` and `startsOf` precedent), and a conflicted row is flagged for every reader.
import { createHash } from 'node:crypto';
import {
  START_LOADS_MAX_LIST, START_LOAD_KINDS, UNMEASURED, type LoadedEntry, type LoadedInstruction, type LoadedKind, type StartLoadKind,
} from '../../../shared/overlord-sandbox.js';

/** The `reportId` the hook mints (the start door's shape). */
const REPORT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
/** The build, as the hook derives it from `CLAUDE_CODE_EXECPATH` (the delegation spool's shape). */
const VERSION_RE = /^[0-9][0-9A-Za-z.+-]{0,31}$/;
const ROLE_RE = /^[a-z]{1,16}$/;
/** A listed name: a skill (`plugin:skill` included), an agent type, a tool, a tool server. Printable, no space. */
const NAME_RE = /^[\x21-\x7e]{1,128}$/;
const WORD_MAX = 32;
const FILE_NAME_MAX = 255;

/** A narrowed report: what the writer stores. */
export interface StartLoadsReport {
  readonly fromId: string;
  readonly fromUuid: string;
  readonly reportId: string;
  readonly profileRole: string | null;
  readonly profileDigest: string | null;
  readonly launchRc: 'on' | 'off' | null;
  readonly claudeVersion: string | null;
  readonly permissionMode: string | null;
  readonly cwdInWorkspace: boolean | null;
  readonly loaded: Readonly<Record<StartLoadKind, LoadedKind>>;
  readonly carriedFrom: string | null;
  readonly reportedAt: number;
  /** sha256 of the narrowed body less `reportedAt`, `fromUuid` and `fromId` (the sender, not what was loaded). */
  readonly bodySha256: string;
}

export type StartLoadsVerdict = { readonly ok: true; readonly report: StartLoadsReport } | { readonly ok: false; readonly field: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nullOr = <T>(v: unknown, ok: (x: unknown) => x is T): T | null | undefined => (v === null || v === undefined ? null : ok(v) ? v : undefined);
const matches = (re: RegExp) => (x: unknown): x is string => typeof x === 'string' && re.test(x);
const isWord = (x: unknown): x is string => typeof x === 'string' && x.length >= 1 && x.length <= WORD_MAX && /^[\x21-\x7e]+$/.test(x);

function instructionOf(v: unknown): LoadedInstruction | null {
  if (!isObj(v)) return null;
  const { type, name, inWorkspace, sha256 } = v;
  if (!isWord(type) || typeof name !== 'string' || name.length < 1 || name.length > FILE_NAME_MAX || name.includes('/')
    || typeof inWorkspace !== 'boolean' || !matches(DIGEST_RE)(sha256)) return null;
  return { type, name, inWorkspace, sha256 };
}

/** One known kind's value: `unmeasured`, or a list of at most `START_LOADS_MAX_LIST` entries of the kind's shape, sorted.
 *  Undefined when the value is malformed. */
function kindOf(kind: StartLoadKind, v: unknown): LoadedKind | undefined {
  if (v === UNMEASURED) return UNMEASURED;
  if (!Array.isArray(v) || v.length > START_LOADS_MAX_LIST) return undefined;
  if (kind === 'instructions') {
    const out = v.map(instructionOf);
    return out.every((x): x is LoadedInstruction => x !== null) ? [...out].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) : undefined;
  }
  const re = kind === 'hooks' ? DIGEST_RE : NAME_RE;
  return v.every(matches(re)) ? [...(v as string[])].sort() : undefined;
}

/** The body's one narrowing (above). */
export function startLoadsOf(body: unknown): StartLoadsVerdict {
  if (!isObj(body)) return { ok: false, field: 'body' };
  const b = body;
  if (!matches(REPORT_ID_RE)(b['reportId'])) return { ok: false, field: 'reportId' };
  const profileRole = nullOr(b['profileRole'], matches(ROLE_RE));
  if (profileRole === undefined) return { ok: false, field: 'profileRole' };
  const profileDigest = nullOr(b['profileDigest'], matches(DIGEST_RE));
  if (profileDigest === undefined) return { ok: false, field: 'profileDigest' };
  const launchRc = nullOr(b['launchRc'], (x): x is 'on' | 'off' => x === 'on' || x === 'off');
  if (launchRc === undefined) return { ok: false, field: 'launchRc' };
  const claudeVersion = nullOr(b['claudeVersion'], matches(VERSION_RE));
  if (claudeVersion === undefined) return { ok: false, field: 'claudeVersion' };
  const permissionMode = nullOr(b['permissionMode'], isWord);
  if (permissionMode === undefined) return { ok: false, field: 'permissionMode' };
  const cwdInWorkspace = nullOr(b['cwdInWorkspace'], (x): x is boolean => typeof x === 'boolean');
  if (cwdInWorkspace === undefined) return { ok: false, field: 'cwdInWorkspace' };
  const carriedFrom = nullOr(b['carriedFrom'], matches(REPORT_ID_RE));
  if (carriedFrom === undefined) return { ok: false, field: 'carriedFrom' };
  const reportedAt = b['reportedAt'];
  if (typeof reportedAt !== 'number' || !Number.isSafeInteger(reportedAt) || reportedAt < 0) return { ok: false, field: 'reportedAt' };
  const raw = b['loaded'];
  if (!isObj(raw)) return { ok: false, field: 'loaded' };
  const loaded = {} as Record<StartLoadKind, LoadedKind>;
  for (const k of START_LOAD_KINDS) {
    const v = Object.hasOwn(raw, k) ? kindOf(k, raw[k]) : UNMEASURED;
    if (v === undefined) return { ok: false, field: `loaded.${k}` };
    loaded[k] = v;
  }
  const kept = { reportId: b['reportId'] as string, profileRole, profileDigest, launchRc, claudeVersion, permissionMode, cwdInWorkspace,
    loaded, carriedFrom };
  const bodySha256 = createHash('sha256').update(JSON.stringify(kept), 'utf8').digest('hex');
  return { ok: true, report: { fromId: String(b['fromId']), fromUuid: String(b['fromUuid']), ...kept, reportedAt, bodySha256 } };
}

/** A stored row, as the store reads it. */
export interface StartLoadsRaw {
  readonly startId: number;
  readonly profileRole: string | null;
  readonly profileDigest: string | null;
  readonly launchRc: string | null;
  readonly claudeVersion: string | null;
  readonly permissionMode: string | null;
  readonly cwdInWorkspace: number | null;
  readonly loaded: string;
  readonly carriedFrom: string | null;
  readonly conflicted: number;
}

/** A stored row, narrowed: what every reader takes. */
export interface StartLoadsRow {
  readonly startId: number;
  readonly profileRole: string | null;
  readonly profileDigest: string | null;
  readonly launchRc: 'on' | 'off' | null;
  readonly claudeVersion: string | null;
  readonly permissionMode: string | null;
  readonly cwdInWorkspace: boolean | null;
  readonly loaded: Readonly<Record<StartLoadKind, readonly LoadedEntry[] | typeof UNMEASURED>>;
  readonly carriedFrom: string | null;
  readonly conflicted: boolean;
}

/** The read side's narrowing (above). */
export function startLoadsRowOf(r: StartLoadsRaw): StartLoadsRow {
  let parsed: unknown = null;
  try { parsed = JSON.parse(r.loaded); } catch { parsed = null; }
  const stored = isObj(parsed) ? parsed : {};
  const loaded = {} as Record<StartLoadKind, LoadedKind>;
  for (const k of START_LOAD_KINDS) loaded[k] = (Object.hasOwn(stored, k) ? kindOf(k, stored[k]) : undefined) ?? UNMEASURED;
  return {
    startId: r.startId,
    profileRole: matches(ROLE_RE)(r.profileRole) ? r.profileRole : null,
    profileDigest: matches(DIGEST_RE)(r.profileDigest) ? r.profileDigest : null,
    launchRc: r.launchRc === 'on' || r.launchRc === 'off' ? r.launchRc : null,
    claudeVersion: matches(VERSION_RE)(r.claudeVersion) ? r.claudeVersion : null,
    permissionMode: isWord(r.permissionMode) ? r.permissionMode : null,
    cwdInWorkspace: r.cwdInWorkspace === 1 ? true : r.cwdInWorkspace === 0 ? false : null,
    loaded,
    carriedFrom: matches(REPORT_ID_RE)(r.carriedFrom) ? r.carriedFrom : null,
    conflicted: r.conflicted !== 0,
  };
}
