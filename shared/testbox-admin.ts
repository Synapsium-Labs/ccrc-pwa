// D-8166 (plan docs/superpowers/plans/2026-11-10-test-box-connect.md, Task TC1; spec 2026-11-07-test-box-connect-design.md
// §2.1, §2.6, §2.8, §2.10, §7). L0: imports only shared/ siblings (the PWA bundles this file), no `node:*`, no Buffer.
// THE ONE CONTRACT of the `ccrc testbox-admin` verb: the console's page, the server's routes, the agent's `testbox-admin`
// op and the verb itself all read their sub list, field grammars, closed codes, phases and status shape from here, so
// none can drift from another (the `account-argv.ts` precedent, D-5620).
//
// NO FREE ARGV AND NO SECRET. The caller hands typed fields; this file decides every word that reaches the verb. A field a
// sub does not name, a value off its grammar, a value that starts with `-`, a `..` path segment or any C0 byte or DEL is
// refused BEFORE any spawn. Every value rides ONE `--name=value` word, so a value can never be read as the next flag, and
// no word is a bare flag, `--force` or `--replace`. Nothing secret crosses the wire at all (spec §2.3: C1 puts no secret in
// the browser), so there is no stdin.
//
// NO ADDRESS EVER COMES BACK. The status the verb writes and the server serves says `addressSet`, never the address; the
// reader refuses any field it does not name and any value that does not fit its own grammar.
import { BOX_SETTING_REFUSAL_WORDS, isReleaseTag, type BoxSettingRow } from './api.js';
import { parseRepoRow, type Read, type TestboxRepoRow } from './testbox.js';
import { utf8Bytes } from './utf8.js';

// ---------------------------------------------------------------------------------------------------------------
// The keys: 16 on the fleet host, 28 on the box (spec M7), each with its shape class.
// ---------------------------------------------------------------------------------------------------------------

/** The sixteen fleet-host test box keys, in `_tb_host_table`'s order (`ccd/testbox-knobs`). */
export const TESTBOX_HOST_KEYS: readonly string[] = Object.freeze([
  'CCRC_TESTBOX_URL', 'CCRC_TESTBOX_TOKEN_FILE', 'CCRC_TESTBOX_GIT_URL_BASE', 'CCRC_TESTBOX_GIT_KEY',
  'CCRC_TESTBOX_UNTRACKED_FILE_MAX', 'CCRC_TESTBOX_SNAPSHOT_MAX', 'CCRC_TESTBOX_STATUS_DEADLINE',
  'CCRC_TESTBOX_RECONNECT_DEADLINE', 'CCRC_TESTBOX_LOST_RUN', 'CCRC_TESTBOX_QUEUE_LIMIT', 'CCRC_TESTBOX_QUEUE_WAIT',
  'CCRC_TESTBOX_BUDGET', 'CCRC_TESTBOX_DENY_GLOBS', 'CCRC_TESTBOX_POLL', 'CCRC_TESTBOX_FALLBACK_INSTALL',
  'CCRC_TESTBOX_TIMES',
]);

/** The twenty-eight test box keys, in `_tb_box_table`'s order. */
export const TESTBOX_BOX_KEYS: readonly string[] = Object.freeze([
  'CCRC_TESTBOX_RUNS', 'CCRC_TESTBOX_WORKERS', 'CCRC_TESTBOX_RUN_TMPDIR', 'CCRC_TESTBOX_RUN_MEMORY_MAX',
  'CCRC_TESTBOX_RUN_SWAP_MAX', 'CCRC_TESTBOX_RUN_CPU_QUOTA', 'CCRC_TESTBOX_ROOT', 'CCRC_TESTBOX_REPOS',
  'CCRC_TESTBOX_FETCH_EVERY', 'CCRC_TESTBOX_RETENTION', 'CCRC_TESTBOX_PRISTINE_KEEP', 'CCRC_TESTBOX_PRISTINE_RETRY',
  'CCRC_TESTBOX_REPORT_MAX', 'CCRC_TESTBOX_TOOLS_DIR', 'CCRC_TESTBOX_OS_MIRROR', 'CCRC_TESTBOX_EGRESS_ALLOW',
  'CCRC_TESTBOX_PUSH_USER', 'CCRC_TESTBOX_ENV_FORWARD', 'CCRC_TESTBOX_RUN_USER_PREFIX', 'CCRC_TESTBOX_REGISTRY_PROXY',
  'CCRC_TESTBOX_REGISTRY_UPSTREAM', 'CCRC_TESTBOX_TMPFS', 'CCRC_TESTBOX_LOG_TAIL', 'CCRC_TESTBOX_SESSION_RUNS',
  'CCRC_TESTBOX_SERVICE_USER', 'CCRC_TESTBOX_LISTEN', 'CCRC_TESTBOX_SERVICE_TOKEN_FILE', 'CCRC_TESTBOX_UNIT_MAX',
]);

/** The four pairing keys: written only by Connect, Replace and Disconnect (spec §2.6, M7). */
export const TESTBOX_PAIRING_KEYS: readonly string[] = Object.freeze([
  'CCRC_TESTBOX_URL', 'CCRC_TESTBOX_TOKEN_FILE', 'CCRC_TESTBOX_GIT_URL_BASE', 'CCRC_TESTBOX_GIT_KEY',
]);

/** The twelve fleet-host keys the card may edit: the sixteen less the four pairing keys. */
export const TESTBOX_FLEET_EDITABLE: readonly string[] = Object.freeze(
  TESTBOX_HOST_KEYS.filter((k) => !TESTBOX_PAIRING_KEYS.includes(k)),
);

/** The box settings that shape how runs execute: an edit to one marks parity stale (spec §2.7, §2.8). */
export const TESTBOX_RUN_SHAPING: readonly string[] = Object.freeze([
  'CCRC_TESTBOX_WORKERS', 'CCRC_TESTBOX_RUNS', 'CCRC_TESTBOX_RUN_MEMORY_MAX', 'CCRC_TESTBOX_RUN_SWAP_MAX',
  'CCRC_TESTBOX_RUN_CPU_QUOTA', 'CCRC_TESTBOX_RUN_TMPDIR', 'CCRC_TESTBOX_TMPFS',
]);

/** A key's shape class: `_tb_shape_class` in `ccd/testbox-knobs`, key for key. */
export type TestboxShapeClass =
  | 'url' | 'path' | 'size' | 'duration' | 'durations' | 'lostrun' | 'fallback' | 'onoff' | 'percent' | 'count'
  | 'hostport' | 'globs' | 'hosts' | 'envnames' | 'user';
export const TESTBOX_SHAPE_CLASS_MAP: Record<TestboxShapeClass, true> = {
  url: true, path: true, size: true, duration: true, durations: true, lostrun: true, fallback: true, onoff: true,
  percent: true, count: true, hostport: true, globs: true, hosts: true, envnames: true, user: true,
};

/** Key to class, for all 44 keys. */
export const TESTBOX_SHAPE_CLASS: Readonly<Record<string, TestboxShapeClass>> = Object.freeze({
  CCRC_TESTBOX_URL: 'url', CCRC_TESTBOX_GIT_URL_BASE: 'url', CCRC_TESTBOX_OS_MIRROR: 'url', CCRC_TESTBOX_REGISTRY_UPSTREAM: 'url',
  CCRC_TESTBOX_TOKEN_FILE: 'path', CCRC_TESTBOX_GIT_KEY: 'path', CCRC_TESTBOX_TIMES: 'path', CCRC_TESTBOX_RUN_TMPDIR: 'path',
  CCRC_TESTBOX_ROOT: 'path', CCRC_TESTBOX_REPOS: 'path', CCRC_TESTBOX_TOOLS_DIR: 'path', CCRC_TESTBOX_SERVICE_TOKEN_FILE: 'path',
  CCRC_TESTBOX_UNTRACKED_FILE_MAX: 'size', CCRC_TESTBOX_SNAPSHOT_MAX: 'size', CCRC_TESTBOX_RUN_MEMORY_MAX: 'size',
  CCRC_TESTBOX_RUN_SWAP_MAX: 'size', CCRC_TESTBOX_REPORT_MAX: 'size',
  CCRC_TESTBOX_STATUS_DEADLINE: 'duration', CCRC_TESTBOX_RECONNECT_DEADLINE: 'duration', CCRC_TESTBOX_QUEUE_WAIT: 'duration',
  CCRC_TESTBOX_BUDGET: 'duration', CCRC_TESTBOX_POLL: 'duration', CCRC_TESTBOX_FETCH_EVERY: 'duration',
  CCRC_TESTBOX_RETENTION: 'duration', CCRC_TESTBOX_PRISTINE_KEEP: 'duration', CCRC_TESTBOX_UNIT_MAX: 'duration',
  CCRC_TESTBOX_PRISTINE_RETRY: 'durations',
  CCRC_TESTBOX_LOST_RUN: 'lostrun', CCRC_TESTBOX_FALLBACK_INSTALL: 'fallback', CCRC_TESTBOX_TMPFS: 'onoff',
  CCRC_TESTBOX_RUN_CPU_QUOTA: 'percent',
  CCRC_TESTBOX_QUEUE_LIMIT: 'count', CCRC_TESTBOX_RUNS: 'count', CCRC_TESTBOX_WORKERS: 'count', CCRC_TESTBOX_LOG_TAIL: 'count',
  CCRC_TESTBOX_SESSION_RUNS: 'count',
  CCRC_TESTBOX_REGISTRY_PROXY: 'hostport', CCRC_TESTBOX_LISTEN: 'hostport',
  CCRC_TESTBOX_DENY_GLOBS: 'globs', CCRC_TESTBOX_EGRESS_ALLOW: 'hosts', CCRC_TESTBOX_ENV_FORWARD: 'envnames',
  CCRC_TESTBOX_PUSH_USER: 'user', CCRC_TESTBOX_SERVICE_USER: 'user', CCRC_TESTBOX_RUN_USER_PREFIX: 'user',
});

/** Each class in words: `_tb_shape_says`, the sentence the shape check refuses with. */
export const TESTBOX_SHAPE_SENTENCE: Readonly<Record<TestboxShapeClass, string>> = Object.freeze({
  url: 'a URL such as https://testbox.invalid',
  path: 'an absolute path, or one starting ~/, with no . or .. part',
  size: 'a whole number with a K, M or G suffix',
  duration: 'a whole number with an s, m, h or d suffix',
  durations: 'a list of whole numbers each with an s, m, h or d suffix',
  lostrun: 'local or fail',
  fallback: 'install or refuse',
  onoff: 'on or off',
  percent: 'a whole percentage such as 200%',
  count: 'a whole number from 1 to 99',
  hostport: 'host:port, the port from 1 to 65535',
  globs: 'a list of file name patterns',
  hosts: 'a list of host names',
  envnames: 'a list of environment variable names',
  user: 'a user name (lower-case letters, digits, _ and -)',
});

// The patterns are `_tb_shape`'s, spelled for JS. A class's check is the class's alone; an empty value fits none (the
// reader treats an empty value as unset before it asks the shape).
const SPACE = ' \\t\\n\\v\\f\\r';
const URL_RE = new RegExp(`^[a-z][a-z0-9+.-]*://[^${SPACE}\\x00-\\x1f\\x7f]+$`);
const PATH_RE = new RegExp(`^(/|~/)[^${SPACE}\\x00-\\x1f\\x7f]*$`);
const SIZE_RE = /^[1-9][0-9]*[KMG]$/;
const DURATION_RE = /^[1-9][0-9]*[smhd]$/;
const PERCENT_RE = /^[1-9][0-9]{0,3}%$/;
const COUNT_RE = /^[1-9][0-9]?$/;
const HOSTPORT_RE = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+):([1-9][0-9]{0,4})$/;
const HOSTNAME_WORD_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const ENV_NAME_WORD_RE = /^[A-Z_][A-Z0-9_]*$/;
const USER_WORD_RE = /^[a-z_][a-z0-9_-]*$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const BLANK_RE = new RegExp(`^[${SPACE}]*$`);
const WORD_SPLIT_RE = new RegExp(`[${SPACE}]+`);

function everyWord(v: string, ok: (w: string) => boolean): boolean {
  if (BLANK_RE.test(v)) return false;
  return v.split(WORD_SPLIT_RE).filter((w) => w !== '').every(ok);
}

function fitsClass(cls: TestboxShapeClass, v: string): boolean {
  switch (cls) {
    case 'url': return URL_RE.test(v);
    case 'path': return PATH_RE.test(v) && !`${v}/`.includes('/./') && !`${v}/`.includes('/../');
    case 'size': return SIZE_RE.test(v);
    case 'duration': return DURATION_RE.test(v);
    case 'durations': return everyWord(v, (w) => DURATION_RE.test(w));
    case 'lostrun': return v === 'local' || v === 'fail';
    case 'fallback': return v === 'install' || v === 'refuse';
    case 'onoff': return v === 'on' || v === 'off';
    case 'percent': return PERCENT_RE.test(v);
    case 'count': return COUNT_RE.test(v);
    case 'hostport': { const m = HOSTPORT_RE.exec(v); return m !== null && Number(m[2]) <= 65535; }
    case 'globs': return !BLANK_RE.test(v) && !CONTROL_RE.test(v);
    case 'hosts': return everyWord(v, (w) => HOSTNAME_WORD_RE.test(w));
    case 'envnames': return everyWord(v, (w) => ENV_NAME_WORD_RE.test(w));
    case 'user': return USER_WORD_RE.test(v);
  }
}

/** The L0 copy of `_tb_shape`: whether `value` is the shape of `key`. A key this table does not know fits nothing.
 *  `server/test/testbox-admin-contract.test.ts` runs the bash function on one corpus and holds the two equal. */
export function fitsTestboxShape(key: string, value: unknown): boolean {
  if (typeof value !== 'string' || !Object.hasOwn(TESTBOX_SHAPE_CLASS, key)) return false;
  return fitsClass(TESTBOX_SHAPE_CLASS[key]!, value);
}

// ---------------------------------------------------------------------------------------------------------------
// The grammars of the connection fields.
// ---------------------------------------------------------------------------------------------------------------

const IPV4_RE = /^(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;
const HOST_LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const HEX_GROUP_RE = /^[0-9A-Fa-f]{1,4}$/;

function isIpv6(s: string): boolean {
  if (s.length < 2 || s.length > 39 || !/^[0-9A-Fa-f:]+$/.test(s) || s.includes(':::')) return false;
  const parts = s.split('::');
  if (parts.length > 2) return false;
  const groups = (p: string): string[] | null => {
    if (p === '') return [];
    const g = p.split(':');
    return g.every((x) => HEX_GROUP_RE.test(x)) ? g : null;
  };
  if (parts.length === 1) { const g = groups(s); return g !== null && g.length === 8; }
  const left = groups(parts[0]!); const right = groups(parts[1]!);
  return left !== null && right !== null && left.length + right.length <= 7;
}

/** An IP literal (v4 dotted quad, or v6 in hex groups) or a host name, with no port, no user and no brackets. */
export function isBoxAddress(v: unknown): v is string {
  if (typeof v !== 'string' || v.length < 1 || v.length > 253) return false;
  if (IPV4_RE.test(v) || isIpv6(v)) return true;
  const labels = v.split('.');
  if (!labels.every((l) => HOST_LABEL_RE.test(l))) return false;
  return !/^[0-9]+$/.test(labels[labels.length - 1]!);   // a dotted run of numbers that is no IPv4 is no name
}

/** A port from 1 to 65535: a whole number, or the digits of one with no lead zero. */
export function isSshPort(v: unknown): boolean {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 65535;
  return typeof v === 'string' && /^[1-9][0-9]{0,4}$/.test(v) && Number(v) <= 65535;
}

/** A POSIX portable user name, as the login user the verb connects as. */
export function isLoginUser(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z_][a-z0-9_-]{0,31}$/.test(v);
}

/** An OpenSSH SHA-256 host key fingerprint: `SHA256:` and 43 base64 characters, unpadded. */
export function isHostKeyFingerprint(v: unknown): v is string {
  return typeof v === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(v);
}

/** A pull request number: a whole number from 1 to 999999, or the digits of one with no lead zero. */
export function isPrNumber(v: unknown): boolean {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 999_999;
  return typeof v === 'string' && /^[1-9][0-9]{0,5}$/.test(v);
}

// ---------------------------------------------------------------------------------------------------------------
// The vocabularies. Every literal union has its sibling `Record<X, true>` map (wire totality, D-6048).
// ---------------------------------------------------------------------------------------------------------------

export type TestboxAdminSub =
  | 'status' | 'read' | 'key' | 'probe' | 'pin' | 'preflight' | 'connect' | 'settings-fleet' | 'settings-box'
  | 'cancel' | 'parity' | 'repair' | 'apply-release' | 'disconnect';
export const TESTBOX_ADMIN_SUB_MAP: Record<TestboxAdminSub, true> = {
  status: true, read: true, key: true, probe: true, pin: true, preflight: true, connect: true, 'settings-fleet': true,
  'settings-box': true, cancel: true, parity: true, repair: true, 'apply-release': true, disconnect: true,
};

/** The acts the ledger records (spec §2.10) and the cancel that ends one. */
export type TestboxAct =
  | 'connect' | 'confirm-host-key' | 'install' | 'pair' | 'settings-fleet' | 'settings-box' | 'parity' | 'switch'
  | 'repair' | 'replace' | 'disconnect' | 'apply-release' | 'cancel';
export const TESTBOX_ACT_MAP: Record<TestboxAct, true> = {
  connect: true, 'confirm-host-key': true, install: true, pair: true, 'settings-fleet': true, 'settings-box': true,
  parity: true, switch: true, repair: true, replace: true, disconnect: true, 'apply-release': true, cancel: true,
};
export const TESTBOX_ACTS: readonly TestboxAct[] = Object.freeze(Object.keys(TESTBOX_ACT_MAP) as TestboxAct[]);

export type TestboxActOutcome = 'ok' | 'refused' | 'failed' | 'unknown';
export const TESTBOX_ACT_OUTCOME_MAP: Record<TestboxActOutcome, true> = { ok: true, refused: true, failed: true, unknown: true };
export const TESTBOX_ACT_OUTCOMES: readonly TestboxActOutcome[] = Object.freeze(Object.keys(TESTBOX_ACT_OUTCOME_MAP) as TestboxActOutcome[]);

/** Why the builder refused, each its own word. `bad-sub`: off `TESTBOX_ADMIN_SUBS`. `bad-field`: everything else. */
export type TestboxAdminArgvRefusal = 'bad-sub' | 'bad-field';
export const TESTBOX_ADMIN_ARGV_REFUSAL_MAP: Record<TestboxAdminArgvRefusal, true> = { 'bad-sub': true, 'bad-field': true };

export type TestboxAdminCode =
  | 'busy' | 'unsupported-os' | 'no-access-key' | 'foreign-key' | 'unreachable' | 'auth-refused' | 'host-key-unknown'
  | 'host-key-changed' | 'fingerprint-mismatch' | 'from-mismatch' | 'no-root' | 'no-sudo' | 'os-mismatch'
  | 'systemd-too-old' | 'no-nftables' | 'not-xfs-reflink' | 'address-not-ip' | 'no-egress' | 'other-release'
  | 'verify-failed' | 'copy-failed' | 'box-value-refused' | 'install-refused' | 'install-failed' | 'pair-failed'
  | 'status-not-ok' | 'pairing-keys-in-ccrc-env' | 'key-in-ccrc-env' | 'runs-in-progress' | 'idle-deadline'
  | 'cancelled' | 'gh-signed-out' | 'parity-differs' | 'not-connected' | 'box-side-skipped';
/** Each code in one line that names no value (no address, path, key or setting text), for the card. */
export const TESTBOX_ADMIN_CODE_SENTENCE: Record<TestboxAdminCode, string> = {
  'busy': 'Another test box act is already running; wait for it to end or cancel it.',
  'unsupported-os': 'This computer is not a system the test box can be connected from.',
  'no-access-key': 'ccrc has not made its access key yet; make it first.',
  'foreign-key': 'The access key file was not made by ccrc, so ccrc will not use or replace it.',
  'unreachable': 'The box did not answer on that address and port in time.',
  'auth-refused': 'The box refused the access key; check that the line was added for the login user.',
  'host-key-unknown': 'The box has no pinned host key yet; check its fingerprint and confirm it.',
  'host-key-changed': 'The box presented a different host key than the pinned one; confirm the new fingerprint to go on.',
  'fingerprint-mismatch': 'The fingerprint you confirmed is not the one the box presented.',
  'from-mismatch': 'The box sees ccrc connect from a different address than the one the access line allows.',
  'no-root': 'The login user is not root and cannot become root.',
  'no-sudo': 'The login user needs working passwordless sudo and does not have it.',
  'os-mismatch': 'The box runs a different distribution release than the fleet host.',
  'systemd-too-old': 'The box has a systemd that is too old for the test service.',
  'no-nftables': 'The box has no nftables.',
  'not-xfs-reflink': 'The test box storage is not an XFS filesystem with reflink.',
  'address-not-ip': 'The address the box saw ccrc connect to is not an IP literal.',
  'no-egress': 'The box cannot reach the release host or the package registry.',
  'other-release': 'The box already has a different release installed; rebuild the box instead.',
  'verify-failed': 'The release did not verify on the fleet host, so nothing was sent to the box.',
  'copy-failed': 'The release did not arrive on the box intact.',
  'box-value-refused': 'A box setting is not the shape its key needs.',
  'install-refused': 'The installer on the box refused to run; see its reason.',
  'install-failed': 'The installer on the box started and then failed.',
  'pair-failed': 'The pairing step did not finish.',
  'status-not-ok': 'The test service did not report a healthy state after the install.',
  'pairing-keys-in-ccrc-env': 'The settings file already names the pairing keys; remove them from it first.',
  'key-in-ccrc-env': 'The settings file already names this setting, so the card cannot change it.',
  'runs-in-progress': 'Runs are in progress on the box; apply the change when idle.',
  'idle-deadline': 'The box was never idle before the deadline, so the change was not applied.',
  'cancelled': 'The act was cancelled.',
  'gh-signed-out': 'GitHub is not signed in on the fleet host, so parity cannot choose its pull requests.',
  'parity-differs': 'The test box and the fleet host gave different results.',
  'not-connected': 'No test box is connected.',
  'box-side-skipped': 'The box could not be reached, so its side was left as it is.',
};
export const TESTBOX_ADMIN_CODE_MAP: Record<TestboxAdminCode, true> = Object.fromEntries(
  Object.keys(TESTBOX_ADMIN_CODE_SENTENCE).map((k) => [k, true]),
) as Record<TestboxAdminCode, true>;
export const TESTBOX_ADMIN_CODES: readonly TestboxAdminCode[] = Object.freeze(Object.keys(TESTBOX_ADMIN_CODE_SENTENCE) as TestboxAdminCode[]);

export type TestboxAdminPhase = 'verify' | 'copy' | 'settings' | 'install' | 'pair' | 'check' | 'wait' | 'legs' | 'record';
export const TESTBOX_ADMIN_PHASE_MAP: Record<TestboxAdminPhase, true> = {
  verify: true, copy: true, settings: true, install: true, pair: true, check: true, wait: true, legs: true, record: true,
};
/** The subs that run in phases. */
export type TestboxPhasedSub = 'connect' | 'repair' | 'apply-release' | 'settings-box' | 'parity';
export const TESTBOX_PHASED_SUB_MAP: Record<TestboxPhasedSub, true> = {
  connect: true, repair: true, 'apply-release': true, 'settings-box': true, parity: true,
};
/** A phased sub's phases, in order. */
export const TESTBOX_ADMIN_PHASES: Readonly<Record<TestboxPhasedSub, readonly TestboxAdminPhase[]>> = Object.freeze({
  'connect': Object.freeze(['verify', 'copy', 'settings', 'install', 'pair', 'check'] as const),
  'repair': Object.freeze(['verify', 'copy', 'install'] as const),
  'apply-release': Object.freeze(['verify', 'copy', 'install'] as const),
  'settings-box': Object.freeze(['wait', 'settings', 'install'] as const),
  'parity': Object.freeze(['legs', 'record'] as const),
});

// ---------------------------------------------------------------------------------------------------------------
// The sub table.
// ---------------------------------------------------------------------------------------------------------------

/** A field's grammar. `setting-fleet` and `setting-box` take a map of KEY to VALUE, written as repeated `--set=K=V`. */
export type TestboxAdminGrammar =
  | 'address' | 'port' | 'user' | 'fingerprint' | 'pr' | 'setting-fleet' | 'setting-box' | 'repo' | 'true';
export const TESTBOX_ADMIN_GRAMMAR_MAP: Record<TestboxAdminGrammar, true> = {
  address: true, port: true, user: true, fingerprint: true, pr: true, 'setting-fleet': true, 'setting-box': true,
  repo: true, true: true,
};

/** What one field's value is on the wire and into the builder: a scalar (address, port, user, fingerprint, `true`), a
 *  list of scalars (`prs`), a map KEY to VALUE (`settings`) or a list of repository-row objects (`repos`). The agent
 *  frame (`TestboxAdminReq.fields`) carries exactly this type, so the frame and the builder cannot drift. */
export type TestboxAdminFieldValue =
  | string | number | boolean
  | readonly (string | number)[]
  | Readonly<Record<string, string>>
  | readonly Readonly<Record<string, unknown>>[];
export type TestboxAdminFields = Readonly<Record<string, TestboxAdminFieldValue>>;

export interface TestboxAdminField {
  readonly flag: string;
  readonly grammar: TestboxAdminGrammar;
  readonly required: boolean;
  readonly repeatable: boolean;
}
export interface TestboxAdminSubSpec {
  /** The fields it takes, by the caller's name, in the order they are written. */
  readonly fields: Readonly<Record<string, TestboxAdminField>>;
  /** Whether the act needs the passkey step-up: it puts, replaces or removes a credential or a pin (C14). */
  readonly stepUp: boolean;
  /** Whether the act detaches into a unit under the lock. `settings-box` is short unless it carries `whenIdle`
   *  (`testboxAdminIsLong`). */
  readonly long: boolean;
  /** The ledger act this sub records, or null for a read. */
  readonly act: TestboxAct | null;
}

const f = (flag: string, grammar: TestboxAdminGrammar, o: { required?: true; repeatable?: true } = {}): TestboxAdminField =>
  Object.freeze({ flag, grammar, required: o.required === true, repeatable: o.repeatable === true });

const address = f('--address', 'address', { required: true });
const port = f('--port', 'port');
const loginUser = f('--login', 'user');
const connection = { address, port, user: loginUser };

const spec = (
  fields: Record<string, TestboxAdminField>,
  o: { stepUp?: true; long?: true; act: TestboxAct | null },
): TestboxAdminSubSpec => Object.freeze({
  fields: Object.freeze(fields), stepUp: o.stepUp === true, long: o.long === true, act: o.act,
});

/** THE TABLE: every sub, the only fields it takes, and what the act is. Keyed by `TestboxAdminSub`, so a sub added to
 *  the union without a row is a compile error. */
export const TESTBOX_ADMIN_SUBS: Readonly<Record<TestboxAdminSub, TestboxAdminSubSpec>> = Object.freeze({
  'status': spec({}, { act: null }),
  'read': spec({}, { act: null }),
  // `key` records the connection (address, port, login) in the state file; every later sub reads it from there.
  'key': spec({ ...connection }, { stepUp: true, act: 'connect' }),
  'probe': spec({}, { act: null }),
  'pin': spec({ fingerprint: f('--fingerprint', 'fingerprint', { required: true }) }, { stepUp: true, act: 'confirm-host-key' }),
  'preflight': spec({}, { act: null }),
  'connect': spec({
    settings: f('--set', 'setting-box', { required: true, repeatable: true }),
    repos: f('--repo', 'repo', { required: true, repeatable: true }),
  }, { stepUp: true, long: true, act: 'connect' }),
  'settings-fleet': spec({ settings: f('--set', 'setting-fleet', { required: true, repeatable: true }) }, { act: 'settings-fleet' }),
  'settings-box': spec({
    settings: f('--set', 'setting-box', { required: true, repeatable: true }),
    repos: f('--repo', 'repo', { repeatable: true }),
    whenIdle: f('--when-idle', 'true'),
  }, { act: 'settings-box' }),
  'cancel': spec({}, { act: 'cancel' }),
  'parity': spec({ prs: f('--pr', 'pr', { repeatable: true }) }, { long: true, act: 'parity' }),
  'repair': spec({}, { long: true, act: 'repair' }),
  'apply-release': spec({}, { long: true, act: 'apply-release' }),
  'disconnect': spec({ replace: f('--replace', 'true') }, { stepUp: true, act: 'disconnect' }),
} satisfies Record<TestboxAdminSub, TestboxAdminSubSpec>);

/** Whether `v` is a sub in the union. */
export function isTestboxAdminSub(v: unknown): v is TestboxAdminSub {
  return typeof v === 'string' && Object.hasOwn(TESTBOX_ADMIN_SUB_MAP, v);
}

/** Whether this call detaches: the sub is long, or it is `settings-box` carrying `whenIdle`. `fields` are as built. */
export function testboxAdminIsLong(sub: TestboxAdminSub, fields: unknown): boolean {
  if (TESTBOX_ADMIN_SUBS[sub].long) return true;
  if (sub !== 'settings-box' || typeof fields !== 'object' || fields === null) return false;
  const w = (fields as Record<string, unknown>)['whenIdle'];
  return w === true || w === 'true';
}

// ---------------------------------------------------------------------------------------------------------------
// base64url, by hand: this file is L0 and has no Buffer.
// ---------------------------------------------------------------------------------------------------------------

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8Encode(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;   // a lone surrogate, as TextEncoder writes it
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function base64urlEncode(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += B64URL[n & 63]!;
  }
  return out;
}

/** Strict unpadded base64url to bytes, or null. */
function base64urlDecode(s: string): number[] | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const q = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64URL.indexOf(s[i + k]!) : -1));
    const n = ((q[0]!) << 18) | ((q[1]!) << 12) | (Math.max(q[2]!, 0) << 6) | Math.max(q[3]!, 0);
    out.push((n >> 16) & 255);
    if (q[2]! >= 0) out.push((n >> 8) & 255);
    if (q[3]! >= 0) out.push(n & 255);
  }
  return out;
}

function utf8Decode(bytes: readonly number[]): string | null {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!;
    const len = b < 0x80 ? 1 : b >= 0xc2 && b < 0xe0 ? 2 : b >= 0xe0 && b < 0xf0 ? 3 : b >= 0xf0 && b < 0xf5 ? 4 : 0;
    if (len === 0 || i + len > bytes.length) return null;
    let c = len === 1 ? b : b & (0xff >> (len + 1));
    for (let k = 1; k < len; k++) {
      const nb = bytes[i + k]!;
      if ((nb & 0xc0) !== 0x80) return null;
      c = (c << 6) | (nb & 63);
    }
    if ((len === 3 && c < 0x800) || (len === 4 && (c < 0x10000 || c > 0x10ffff)) || (c >= 0xd800 && c <= 0xdfff)) return null;
    out += String.fromCodePoint(c);
    i += len;
  }
  return out;
}

/** The most a repository row may be once decoded. */
export const TESTBOX_REPO_ROW_MAX_BYTES = 8 * 1024;
/** The most repository rows one call may carry. */
export const TESTBOX_REPO_ROWS_MAX = 4;
/** The most pull requests one parity call may name. */
export const TESTBOX_PARITY_PRS_MAX = 20;

/** Decode one `--repo=` word's value: base64url of the row's JSON, at most 8 KiB, a row `parseRepoRow` takes. For the
 *  verb's own reader (the shell side re-checks it again). */
export function readTestboxRepoArg(word: unknown): Read<TestboxRepoRow> {
  if (typeof word !== 'string') return { ok: false, reason: 'not a string' };
  const bytes = base64urlDecode(word);
  if (bytes === null) return { ok: false, reason: 'not base64url' };
  if (bytes.length > TESTBOX_REPO_ROW_MAX_BYTES) return { ok: false, reason: 'over 8 KiB' };
  const json = utf8Decode(bytes);
  if (json === null) return { ok: false, reason: 'not UTF-8' };
  return parseRepoRow(json);
}

// ---------------------------------------------------------------------------------------------------------------
// The builder.
// ---------------------------------------------------------------------------------------------------------------

const DOT_DOT_SEGMENT_RE = /(?:^|[/\\])\.\.(?:[/\\]|$)/;

/** A value that rides one word: a non-empty string with no C0 byte or DEL, never `-`-led, no `..` path segment. */
function wordOk(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && !CONTROL_RE.test(v) && !v.startsWith('-') && !DOT_DOT_SEGMENT_RE.test(v);
}

export type TestboxAdminArgvBuilt =
  | { readonly ok: true; readonly argv: string[] }
  | { readonly ok: false; readonly why: TestboxAdminArgvRefusal };

const BAD: TestboxAdminArgvBuilt = { ok: false, why: 'bad-field' };

function plainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v) as unknown;
  return p === Object.prototype || p === null;
}

function scalarText(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return null;
}

/** The words one field writes, or null when the value is off its grammar. */
function fieldWords(fd: TestboxAdminField, value: unknown): string[] | null {
  switch (fd.grammar) {
    case 'address': return wordOk(value) && isBoxAddress(value) ? [`${fd.flag}=${value}`] : null;
    case 'user': return wordOk(value) && isLoginUser(value) ? [`${fd.flag}=${value}`] : null;
    case 'fingerprint': return wordOk(value) && isHostKeyFingerprint(value) ? [`${fd.flag}=${value}`] : null;
    case 'port': { const t = scalarText(value); return t !== null && wordOk(t) && isSshPort(t) ? [`${fd.flag}=${t}`] : null; }
    case 'true': return value === true || value === 'true' ? [`${fd.flag}=true`] : null;
    case 'pr': {
      if (!Array.isArray(value) || value.length < 1 || value.length > TESTBOX_PARITY_PRS_MAX) return null;
      const out: string[] = [];
      for (const n of value as unknown[]) {
        const t = scalarText(n);
        if (t === null || !isPrNumber(t) || out.includes(`${fd.flag}=${t}`)) return null;
        out.push(`${fd.flag}=${t}`);
      }
      return out;
    }
    case 'setting-fleet':
    case 'setting-box': {
      if (!plainObject(value)) return null;
      const keys = fd.grammar === 'setting-fleet' ? TESTBOX_FLEET_EDITABLE : TESTBOX_BOX_KEYS;
      const given = Object.keys(value);
      if (given.length < 1 || given.some((k) => !keys.includes(k))) return null;
      const out: string[] = [];
      for (const k of keys) {
        if (!Object.hasOwn(value, k)) continue;
        const v = value[k];
        if (!wordOk(v) || !fitsTestboxShape(k, v)) return null;
        out.push(`${fd.flag}=${k}=${v}`);
      }
      return out;
    }
    case 'repo': {
      if (!Array.isArray(value) || value.length < 1 || value.length > TESTBOX_REPO_ROWS_MAX) return null;
      const out: string[] = [];
      for (const row of value as unknown[]) {
        if (!plainObject(row)) return null;
        let json: string;
        try { json = JSON.stringify(row); } catch { return null; }
        if (utf8Bytes(json) > TESTBOX_REPO_ROW_MAX_BYTES || !parseRepoRow(json).ok) return null;
        out.push(`${fd.flag}=${base64urlEncode(utf8Encode(json))}`);
      }
      return out;
    }
  }
}

/**
 * THE BUILDER. `sub` and `fields` are untrusted (a frame off the wire, a route's body). Answers the argv AFTER the
 * launcher (`testbox-admin <sub> [--name=value…]`) or the first refusal. The agent's template appends `--from agent`
 * itself; no caller field can. Never throws.
 */
export function buildTestboxAdminArgv(sub: unknown, fields: unknown): TestboxAdminArgvBuilt {
  if (!isTestboxAdminSub(sub)) return { ok: false, why: 'bad-sub' };
  const s = TESTBOX_ADMIN_SUBS[sub];
  if (!plainObject(fields)) return BAD;
  for (const key of Object.keys(fields)) if (!Object.hasOwn(s.fields, key)) return BAD;
  const argv: string[] = ['testbox-admin', sub];
  for (const [key, fd] of Object.entries(s.fields)) {
    if (!Object.hasOwn(fields, key)) {
      if (fd.required) return BAD;
      continue;
    }
    const words = fieldWords(fd, fields[key]);
    if (words === null) return BAD;
    argv.push(...words);
  }
  return { ok: true, argv };
}

// ---------------------------------------------------------------------------------------------------------------
// The status and the parity record.
// ---------------------------------------------------------------------------------------------------------------

export interface TestboxParityRecord {
  v: 1;
  result: 'pass' | 'fail';
  prs: { repo: string; number: number; rev: string }[];
  fixtures: { name: 'git-state' | 'socket' | 'workers'; result: 'pass' | 'fail' }[];
  release: string;
  toolsKey: string;
  fingerprint: string;
  boxFileSha256: string;
  at: number;
}

export interface TestboxActState {
  id: string;
  sub: TestboxAdminSub;
  phase: TestboxAdminPhase | null;
  phases: { name: TestboxAdminPhase; ms: number }[];
  outcome: 'running' | 'ok' | 'failed';
  code: TestboxAdminCode | null;
  startedAt: number;
  endedAt: number | null;
}

export interface TestboxAdminStatus {
  v: 1;
  connected: boolean;
  addressSet: boolean;
  login: 'root' | 'sudo' | null;
  fingerprint: string | null;
  hostKey: 'pinned' | 'changed' | 'none';
  boxFileSha256: string | null;
  act: TestboxActState | null;
  boxSettings: BoxSettingRow[] | null;
  boxSettingsAt: number | null;
  parity: TestboxParityRecord | null;
}

/** What the gate compares the record with: the pin, the box file and the stale mark, as the status reports them. */
export interface TestboxParityCurrent { fingerprint: string | null; boxFileSha256: string | null; stale: boolean }

/** Whether a parity record lets the switch arm: it passed and still matches the pin and the box file, and no run-shaping
 *  edit has marked it stale (spec §2.8). */
export function parityArmable(record: TestboxParityRecord | null, current: TestboxParityCurrent): boolean {
  if (record === null || record.result !== 'pass' || current.stale) return false;
  if (current.fingerprint === null || current.fingerprint !== record.fingerprint) return false;
  if (current.boxFileSha256 === null || current.boxFileSha256 !== record.boxFileSha256) return false;
  return true;
}

// A declared field, not a parameter property: the PWA compiles this file under `erasableSyntaxOnly`.
class Refusal {
  readonly reason: string;
  constructor(reason: string) { this.reason = reason; }
}
const refuse = (at: string, why: string): never => { throw new Refusal(`${at}: ${why}`); };

type Obj = Record<string, unknown>;

function exact(v: unknown, at: string, keys: readonly string[]): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return refuse(at, 'not an object');
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k)) refuse(at, `extra field ${k}`);
  for (const k of keys) if (!Object.hasOwn(o, k)) refuse(at, `missing field ${k}`);
  return o;
}
function int(v: unknown, at: string, min = 0): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) return refuse(at, 'not a whole number');
  return v;
}
function bool(v: unknown, at: string): boolean {
  return typeof v === 'boolean' ? v : refuse(at, 'not a boolean');
}
function pick<K extends string>(map: Record<K, true>, v: unknown, at: string): K {
  return typeof v === 'string' && Object.hasOwn(map, v) ? (v as K) : refuse(at, 'not a known word');
}
function orNull<T>(v: unknown, each: (x: unknown) => T): T | null { return v === null ? null : each(v); }

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const ACT_ID_RE = /^[0-9a-f]{32}$/;
const REPO_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const REV_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TOOLS_KEY_RE = /^[A-Za-z0-9._:+-]{1,128}$/;
const FIXTURES = { 'git-state': true, socket: true, workers: true } as const;
const RESULTS = { pass: true, fail: true } as const;

function parityRecord(v: unknown, at: string): TestboxParityRecord {
  const o = exact(v, at, ['v', 'result', 'prs', 'fixtures', 'release', 'toolsKey', 'fingerprint', 'boxFileSha256', 'at']);
  if (o['v'] !== 1) refuse(`${at}.v`, 'not 1');
  if (!Array.isArray(o['prs']) || o['prs'].length > 4096) refuse(`${at}.prs`, 'not a list');
  if (!Array.isArray(o['fixtures']) || o['fixtures'].length > 3) refuse(`${at}.fixtures`, 'not a list of at most three');
  const rel = o['release'];
  const tk = o['toolsKey'];
  const fp = o['fingerprint'];
  const sha = o['boxFileSha256'];
  return {
    v: 1,
    result: pick(RESULTS, o['result'], `${at}.result`),
    prs: (o['prs'] as unknown[]).map((p, i) => {
      const e = exact(p, `${at}.prs[${i}]`, ['repo', 'number', 'rev']);
      if (typeof e['repo'] !== 'string' || !REPO_NAME_RE.test(e['repo'])) refuse(`${at}.prs[${i}].repo`, 'not a repository name');
      if (!isPrNumber(e['number'])) refuse(`${at}.prs[${i}].number`, 'not a pull request number');
      if (typeof e['rev'] !== 'string' || !REV_RE.test(e['rev'])) refuse(`${at}.prs[${i}].rev`, 'not a revision');
      return { repo: e['repo'] as string, number: e['number'] as number, rev: e['rev'] as string };
    }),
    fixtures: (o['fixtures'] as unknown[]).map((p, i) => {
      const e = exact(p, `${at}.fixtures[${i}]`, ['name', 'result']);
      return { name: pick(FIXTURES, e['name'], `${at}.fixtures[${i}].name`), result: pick(RESULTS, e['result'], `${at}.fixtures[${i}].result`) };
    }),
    release: isReleaseTag(rel) && rel.length <= 64 ? rel : refuse(`${at}.release`, 'not a release tag'),
    toolsKey: typeof tk === 'string' && TOOLS_KEY_RE.test(tk) ? tk : refuse(`${at}.toolsKey`, 'not a tools key'),
    fingerprint: isHostKeyFingerprint(fp) ? fp : refuse(`${at}.fingerprint`, 'not a host key fingerprint'),
    boxFileSha256: typeof sha === 'string' && SHA256_HEX_RE.test(sha) ? sha : refuse(`${at}.boxFileSha256`, 'not a sha256'),
    at: int(o['at'], `${at}.at`),
  };
}

function actState(v: unknown, at: string): TestboxActState {
  const o = exact(v, at, ['id', 'sub', 'phase', 'phases', 'outcome', 'code', 'startedAt', 'endedAt']);
  if (typeof o['id'] !== 'string' || !ACT_ID_RE.test(o['id'])) refuse(`${at}.id`, 'not 32 lowercase hex characters');
  if (!Array.isArray(o['phases']) || o['phases'].length > 16) refuse(`${at}.phases`, 'not a short list');
  return {
    id: o['id'] as string,
    sub: pick(TESTBOX_ADMIN_SUB_MAP, o['sub'], `${at}.sub`),
    phase: orNull(o['phase'], (x) => pick(TESTBOX_ADMIN_PHASE_MAP, x, `${at}.phase`)),
    phases: (o['phases'] as unknown[]).map((p, i) => {
      const e = exact(p, `${at}.phases[${i}]`, ['name', 'ms']);
      return { name: pick(TESTBOX_ADMIN_PHASE_MAP, e['name'], `${at}.phases[${i}].name`), ms: int(e['ms'], `${at}.phases[${i}].ms`) };
    }),
    outcome: pick({ running: true, ok: true, failed: true }, o['outcome'], `${at}.outcome`),
    code: orNull(o['code'], (x) => pick(TESTBOX_ADMIN_CODE_MAP, x, `${at}.code`)),
    startedAt: int(o['startedAt'], `${at}.startedAt`),
    endedAt: orNull(o['endedAt'], (x) => int(x, `${at}.endedAt`)),
  };
}

/** The classes whose value shows as set or not set only: a path, an address or a list (box-settings display classes;
 *  spec §2.7). */
const IS_SET_CLASSES: ReadonlySet<TestboxShapeClass> = new Set<TestboxShapeClass>(
  ['url', 'path', 'hostport', 'globs', 'hosts', 'envnames', 'durations'],
);
const SOURCES = { environment: true, file: true, empty: true, default: true } as const;
const REFUSAL_SENTENCES: ReadonlySet<string> = new Set<string>([...Object.values(TESTBOX_SHAPE_SENTENCE), ...BOX_SETTING_REFUSAL_WORDS]);
const UNMEASURED_WHY_RE = /^[A-Za-z][A-Za-z ,.-]{0,159}$/;

function settingRow(v: unknown, at: string): BoxSettingRow {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return refuse(at, 'not an object');
  const o = v as Obj;
  const key = o['key'];
  if (typeof key !== 'string' || !TESTBOX_BOX_KEYS.includes(key)) refuse(`${at}.key`, 'not a box setting');
  const k = key as string;
  const cls = TESTBOX_SHAPE_CLASS[k]!;
  const state = o['state'];
  if (state === 'ok') {
    if (IS_SET_CLASSES.has(cls)) {
      exact(o, at, ['key', 'state', 'from']);
    } else {
      exact(o, at, ['key', 'state', 'value', 'from']);
      if (!fitsTestboxShape(k, o['value'])) refuse(`${at}.value`, 'not its key\'s shape');
    }
    pick(SOURCES, o['from'], `${at}.from`);
    return o as unknown as BoxSettingRow;
  }
  if (state === 'refused') {
    exact(o, at, ['key', 'state', 'from', 'why']);
    pick(SOURCES, o['from'], `${at}.from`);
    if (typeof o['why'] !== 'string' || !REFUSAL_SENTENCES.has(o['why'])) refuse(`${at}.why`, 'not a closed refusal sentence');
    return o as unknown as BoxSettingRow;
  }
  if (state === 'unmeasured') {
    exact(o, at, ['key', 'state', 'why']);
    if (typeof o['why'] !== 'string' || !UNMEASURED_WHY_RE.test(o['why'])) refuse(`${at}.why`, 'not a plain sentence');
    return o as unknown as BoxSettingRow;
  }
  return refuse(`${at}.state`, 'not ok, refused or unmeasured');
}

/** The one reader of the status document `ccrc testbox-admin status` prints and the server serves. It refuses a field it
 *  does not name, so no address, path or secret can ride along; the address is `addressSet` only. */
export function readTestboxAdminStatus(json: string): Read<TestboxAdminStatus> {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return { ok: false, reason: 'not JSON' }; }
  try {
    const o = exact(raw, 'status', [
      'v', 'connected', 'addressSet', 'login', 'fingerprint', 'hostKey', 'boxFileSha256', 'act', 'boxSettings',
      'boxSettingsAt', 'parity',
    ]);
    if (o['v'] !== 1) refuse('v', 'not 1');
    const login = o['login'];
    if (login !== null && login !== 'root' && login !== 'sudo') refuse('login', 'not root, sudo or null');
    let rows: BoxSettingRow[] | null = null;
    if (o['boxSettings'] !== null) {
      if (!Array.isArray(o['boxSettings']) || o['boxSettings'].length > TESTBOX_BOX_KEYS.length) refuse('boxSettings', 'not a list of at most 28');
      rows = (o['boxSettings'] as unknown[]).map((r, i) => settingRow(r, `boxSettings[${i}]`));
      const seen = new Set(rows.map((r) => r.key as string));
      if (seen.size !== rows.length) refuse('boxSettings', 'a key twice');
    }
    return {
      ok: true,
      value: {
        v: 1,
        connected: bool(o['connected'], 'connected'),
        addressSet: bool(o['addressSet'], 'addressSet'),
        login: login as 'root' | 'sudo' | null,
        fingerprint: orNull(o['fingerprint'], (x) => (isHostKeyFingerprint(x) ? x : refuse('fingerprint', 'not a host key fingerprint'))),
        hostKey: pick({ pinned: true, changed: true, none: true }, o['hostKey'], 'hostKey'),
        boxFileSha256: orNull(o['boxFileSha256'], (x) => (typeof x === 'string' && SHA256_HEX_RE.test(x) ? x : refuse('boxFileSha256', 'not a sha256'))),
        act: orNull(o['act'], (x) => actState(x, 'act')),
        boxSettings: rows,
        boxSettingsAt: orNull(o['boxSettingsAt'], (x) => int(x, 'boxSettingsAt')),
        parity: orNull(o['parity'], (x) => parityRecord(x, 'parity')),
      },
    };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, reason: e.reason };
    throw e;
  }
}

/** The one reader of `~/.ccrc/testbox-parity.json`. */
export function readTestboxParityRecord(json: string): Read<TestboxParityRecord> {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return { ok: false, reason: 'not JSON' }; }
  try {
    return { ok: true, value: parityRecord(raw, 'parity') };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, reason: e.reason };
    throw e;
  }
}
