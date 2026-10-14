// tickDietCorpus.ts — the inputs the supervisor tick diet's differential suite drives (#387, tick-diet spec §9, plan
// Task 2 Step 6). W1 plants every row spec §9 and plan Task 2 Step 6 name, so W2 and W3 mostly add ASSERTIONS to
// `ccd-tick-diet-equivalence.test.ts`. A later task adds rows here only for the inputs its own guard is about (the
// plan's File Structure: Tasks 8, 9, 13, 14, 15 and 16), and never an expected answer (below). Test-only: it imports
// nothing from `server/src` and spawns nothing; the equivalence suite plants each row and runs it.
//
// A row is DATA about one path: its shape (a regular file, a FIFO, a dangling symlink, …) and, where the shape holds
// bytes, the exact bytes. NOTHING HERE STATES WHAT A HELPER ANSWERS for a row. The vendored legacy body does, at run
// time (`fixtures/tick-diet-legacy.bash`), and that is the whole point of a differential: an expected value written
// here would be a third copy of the contract, and the one most likely to be wrong.
//
// The one exception is `inLimitsDomain`, which restates spec §6.3's fast-path DOMAIN (not an answer), so a W2 row can
// assert which side of the domain a row falls on: the domain is a memory and correctness bound the answer alone cannot
// show (plan Task 8, the size-cap row).

/** Where a row puts its path, and what is there.
 *  - `regular`: a regular file holding `bytes`, mode 0644.
 *  - `absent`: nothing at the path.
 *  - `directory`: an empty directory at the path.
 *  - `fifo`: a FIFO with no writer.
 *  - `mode-000`: a regular file holding `bytes`, mode 000 (non-root only: root reads it anyway).
 *  - `symlink-regular`: a symlink to a regular file holding `bytes`, OUTSIDE the registry (D-2989's fabricated value).
 *  - `symlink-dangling`: a symlink to a path that does not exist.
 *  - `symlink-fifo`: a symlink to a FIFO with no writer.
 *  - `symlink-devzero`: a symlink to `/dev/zero`, an unbounded read.
 *  - `parent-unsearchable`: a regular file holding `bytes`, in a directory whose search bit is cleared: for a registry
 *    row that directory is `$REG` itself, for a limits row `$LIMITS_DIR` (non-root only). */
export type Shape =
  | 'regular' | 'absent' | 'directory' | 'fifo' | 'mode-000'
  | 'symlink-regular' | 'symlink-dangling' | 'symlink-fifo' | 'symlink-devzero' | 'parent-unsearchable';

export interface FileRow {
  /** Unique within its set; it names the row in every failure. */
  readonly id: string;
  readonly shape: Shape;
  /** The file's bytes for `regular`, `mode-000` and `parent-unsearchable`; the TARGET's for `symlink-regular`; empty
   *  for every other shape. */
  readonly bytes: Buffer;
}

/** A reader that opens the path by name, with no type check first, BLOCKS on these: `open(2)` on a FIFO with no writer,
 *  `read(2)` on `/dev/zero`. Legacy and new alike — `_limit_json_num`'s `grep` included, which is why `_limit_field`'s
 *  `-f` comes first. A row set that drives an UNGUARDED reader leaves these rows out; one that drives a guarded reader
 *  keeps them, and a hang is then the finding (plan Review Focus 6). */
export const blocksByName = (row: FileRow): boolean =>
  row.shape === 'fifo' || row.shape === 'symlink-fifo' || row.shape === 'symlink-devzero';

/** Rows whose meaning needs a non-root reader: root reads a mode-000 file and searches a mode-0600 directory, so under
 *  root these rows are skipped WITH that reason, never run for a different answer. */
export const needsNonRoot = (row: FileRow): boolean =>
  row.shape === 'mode-000' || row.shape === 'parent-unsearchable';

/** Spec §6.3's fast domain for the limits parse (D-4962), stated once for the tests: a regular, readable file read to
 *  EOF inside the 64 KiB cap (`read -n 65536` reaches EOF only for a file of at most 65535 bytes), with no NUL, whose
 *  every byte is printable ASCII (0x21–0x7e) or one of ` \t\n\v\f\r`. Every other row takes the legacy pipeline. */
export function inLimitsDomain(row: FileRow): boolean {
  if (row.shape !== 'regular' && row.shape !== 'symlink-regular') return false;
  if (row.bytes.length > 65535) return false;
  for (const c of row.bytes) {
    if (c >= 0x21 && c <= 0x7e) continue;
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0b || c === 0x0c || c === 0x0d) continue;
    return false;
  }
  return true;
}

/** Raw bytes: every `\xNN` in the literal is one byte, never a UTF-8 sequence. */
const raw = (s: string): Buffer => Buffer.from(s, 'latin1');
/** UTF-8 text, for the rows whose non-ASCII is meant to be well-formed. */
const utf8 = (s: string): Buffer => Buffer.from(s, 'utf8');
const NONE = Buffer.alloc(0);
const reg = (id: string, bytes: Buffer): FileRow => ({ id, shape: 'regular', bytes });
const shaped = (id: string, shape: Shape, bytes: Buffer = NONE): FileRow => ({ id, shape, bytes });

/** The epoch every limits row's `ts` and reset fields are written against, so a W2 row can stub `date` on either
 *  side of a reset without re-deriving the files. */
export const LIMITS_TS = 1760000000;
/** The keys the limits parse reads (plan Task 8): the two windows, the stamp, both resets and the gpt lane's window. */
export const LIMIT_KEYS = ['five', 'seven', 'ts', 'fiveResetAt', 'sevenResetAt', 'fiveWindowMinutes'] as const;

const T = LIMITS_TS;
const COMPACT = `{"five":23,"seven":41,"ts":${T},"fiveResetAt":${T + 18000},"sevenResetAt":${T + 604800}}`;
const SPACED = `{"five": null, "seven": 0, "ts": ${T}, "fiveResetAt": null, "sevenResetAt": ${T + 604800}, "fiveWindowMinutes": 300}`;
/** Pads a compact row with spaces to exactly `n` bytes, the value kept at the front so a match is still there. */
const sized = (n: number): Buffer => {
  const head = `{"five":12,"ts":${T}}`;
  return raw(head + ' '.repeat(n - head.length));
};

/** `~/.cc-limits/<wrapper>.json` (spec §9 "limits JSON", plan Task 2 Step 6, Review Focus 1). The producers write
 *  compact `printf` output (the statusline) or Python `json.dump` output (the gpt lane), so the first rows are those
 *  two shapes; the rest are every edge the fast path's domain and per-line match must keep. */
export const LIMITS_ROWS: readonly FileRow[] = [
  reg('compact', raw(COMPACT)),
  reg('compact-newline', raw(`${COMPACT}\n`)),
  reg('json-dump-spaced', raw(`${SPACED}\n`)),
  reg('spaced-values', raw(`{"five": 12, "seven": 88, "ts": ${T}}\n`)),
  reg('null-everywhere', raw('{"five": null, "seven": null, "ts": null}\n')),
  reg('missing-five', raw(`{"seven":41,"ts":${T}}`)),
  reg('empty-object', raw('{}')),
  reg('empty-file', NONE),
  reg('repeated-key', raw(`{"five":10,"five":90,"ts":${T}}`)),
  reg('repeated-key-two-lines', raw(`{"five":12,\n"five":34,"ts":${T}}\n`)),
  reg('key-in-Afive', raw('{"Afive":7}')),
  reg('key-in-Afive-then-five', raw('{"Afive":7,"five":12}')),
  reg('value-on-next-line', raw(`{"five":\n12,"ts":${T}}`)),
  reg('colon-on-next-line', raw('{"five"\n:12}')),
  reg('crlf', raw(`{"five":12,\r\n"seven":34,\r\n"ts":${T}}\r\n`)),
  reg('cr-before-colon', raw('{"five"\r:12}')),
  reg('trailing-newlines', raw('{"five":12}\n\n')),
  reg('tab-and-vt', raw('{"five"\t:\x0b12}')),
  reg('ff-and-space', raw('{"five"\x0c: \x0c12}')),
  reg('nul-at-end', raw('{"five":12}\x00')),
  reg('nul-before-value', raw('{"five":\x00 12}')),
  reg('nul-at-start', raw('\x00{"five":12}')),
  reg('nul-after-lead-byte', raw('{"note":"\xc3\x00","five":12}')),
  reg('invalid-utf8', raw('{"five":12,"x":"\xff\xfe"}')),
  reg('truncated-lead-byte', raw('{"five":12,"x":"\xc3"}')),
  reg('lead-byte-then-ascii', raw('{"x":"\xc3\x28","five":12}')),
  reg('non-ascii-elsewhere', utf8('{"five":12,"who":"café"}')),
  reg('em-space-before-colon', utf8('{"five"\u2003:12}')),
  reg('nbsp-before-colon', utf8('{"five"\u00a0:12}')),
  reg('bom', raw('\xef\xbb\xbf{"five":12}')),
  reg('del-byte', raw('{"five":12,"x":"\x7f"}')),
  reg('decimal', raw('{"five":12.5}')),
  reg('negative', raw('{"five":-3}')),
  reg('quoted-number', raw('{"five":"12"}')),
  reg('exponent', raw('{"five":1e3}')),
  reg('leading-zeros', raw('{"five":007}')),
  // W2 Task 9 (D-4962): a `ts` with a leading zero is an OCTAL constant to bash's `$(( ))`, and `08` cannot be one, so
  // `$((now - ts))` is an expansion error that aborts the shell's top-level command. `_limit_field` ran inside `$( )`,
  // so the legacy lost one subshell and answered ""; the in-shell `_limit_field_to` must contain it the same way.
  reg('ts-leading-zero-89', raw('{"five":50,"seven":10,"ts":08}')),
  reg('ts-leading-zero-octal', raw('{"five":50,"seven":10,"ts":0777}')),
  // `[[ now -ge 08 ]]` is the conditional's own error, not an expansion: it says so on stderr and answers false.
  reg('reset-leading-zero-89', raw(`{"five":50,"seven":10,"ts":${T},"fiveResetAt":08,"sevenResetAt":09}`)),
  // `_avail`'s refusal (`five` at SWAP_CEILING, 98), for W2 Task 9's caller rows.
  reg('five-at-ceiling', raw(`{"five":98,"seven":10,"ts":${T}}`)),
  reg('huge-number', raw(`{"five":${'9'.repeat(30)}}`)),
  reg('escaped-key-in-string', raw('{"note":"\\"five\\": 3","five":4}')),
  reg('key-without-value', raw('{"five":')),
  reg('size-65535', sized(65535)),
  reg('size-65536', sized(65536)),
  reg('size-64KiB-plus-1', sized(65537)),
  // Plan Task 8's printing line: over the cap, so the pipeline answers, and with so many matches (540 KB of `-o`
  // output) that `head -1` closes the pipe on grep. grep dies of SIGPIPE, and under `pipefail` the legacy prints its
  // first match WITH rc 141 (measured, macOS bash 5.3 / BSD grep and Linux bash 5.2 / GNU grep): a value and a
  // non-zero rc together, which a printing form that returns on the rc before printing would drop.
  reg('over-cap-many-matches', raw(`{${'"five":1,'.repeat(60000)}"ts":${T}}`)),
  shaped('absent', 'absent'),
  shaped('directory', 'directory'),
  shaped('fifo', 'fifo'),
  shaped('mode-000', 'mode-000', raw(COMPACT)),
  shaped('symlink-regular', 'symlink-regular', raw(COMPACT)),
  shaped('symlink-dangling', 'symlink-dangling'),
  shaped('symlink-fifo', 'symlink-fifo'),
  shaped('symlink-devzero', 'symlink-devzero'),
  shaped('dir-unsearchable', 'parent-unsearchable', raw(COMPACT)),
];

/** W2 Task 9's "rewrite between reads" row (plan Task 9, the one-read guard): `before` is fresh at T+30 with `five` 50;
 *  `after` keeps `five` but its `ts` is long stale and its `fiveResetAt` has passed, so any key read from it after the
 *  first one (the value) makes `_limit_field … five 60` answer "". Not a `FILE_ROW_SETS` set: the row plants both. */
export const LIMITS_REWRITE: { readonly before: FileRow; readonly after: FileRow } = {
  before: reg('rewrite-before', raw(`{"five":50,"seven":10,"ts":${T},"fiveResetAt":${T + 18000}}`)),
  after: reg('rewrite-after', raw(`{"five":50,"seven":10,"ts":${T - 999999},"fiveResetAt":${T - 1}}`)),
};

/** `$REG/<id>.<field>` values (spec §9 "registry values", plan Task 13's list). `_reg_set` writes `printf '%s'`, so a
 *  real field carries no trailing newline; the newline rows are the hand-edited and older-writer shapes `$(cat)`
 *  strips. */
export const REGISTRY_ROWS: readonly FileRow[] = [
  reg('plain', raw('abc')),
  reg('one-newline', raw('abc\n')),
  reg('three-newlines', raw('abc\n\n\n')),
  reg('only-newlines', raw('\n\n')),
  reg('empty', NONE),
  reg('spaces', raw('  spaced value  ')),
  reg('crlf', raw('x\r\n')),
  reg('cr', raw('x\r')),
  reg('inner-newline', raw('a\nb\n')),
  reg('nul-inside', raw('a\x00b\n')),
  reg('nul-only', raw('\x00')),
  reg('nul-at-end', raw('abc\x00')),
  reg('nul-after-lead-byte', raw('\xc3\x00x\n')),
  reg('utf8', utf8('café\n')),
  reg('invalid-utf8', raw('\xff\n')),
  reg('long', raw('v'.repeat(70000))),
  shaped('missing-field', 'absent'),
  shaped('directory', 'directory'),
  shaped('fifo', 'fifo'),
  shaped('mode-000', 'mode-000', raw('abc')),
  shaped('symlink-regular', 'symlink-regular', raw('fabricated')),
  shaped('symlink-dangling', 'symlink-dangling'),
  shaped('symlink-fifo', 'symlink-fifo'),
  shaped('symlink-devzero', 'symlink-devzero'),
  shaped('reg-unsearchable', 'parent-unsearchable', raw('abc')),
];

/** `$REG/<id>.home` (plan Task 16): absent, empty, valid, a symlink and an unsearchable `$REG`. */
export const HOME_ROWS: readonly FileRow[] = [
  shaped('absent', 'absent'),
  reg('empty', NONE),
  reg('valid', raw('claude-a')),
  reg('valid-newline', raw('claude-a\n')),
  shaped('symlink-regular', 'symlink-regular', raw('claude-b')),
  shaped('directory', 'directory'),
  shaped('reg-unsearchable', 'parent-unsearchable', raw('claude-a')),
];

/** `$REG/<wrapper>-authdead` (plan Task 16). Its writer is `printf '%s %s' "$now" rescue-401`. */
export const AUTHDEAD_ROWS: readonly FileRow[] = [
  shaped('absent', 'absent'),
  reg('well-formed', raw(`${T} rescue-401`)),
  reg('well-formed-newline', raw(`${T} rescue-401\n`)),
  reg('malformed', raw('abc rescue-401')),
  reg('empty', NONE),
  reg('nul', raw(`${T}\x00 rescue-401`)),
  shaped('symlink-regular', 'symlink-regular', raw(`${T} rescue-401`)),
  shaped('mode-000', 'mode-000', raw(`${T} rescue-401`)),
  shaped('directory', 'directory'),
];

const SID = '0b1f2c3d-4e5f-4061-8273-94a5b6c7d8e9';
const SESSION = (status: string, extra = ''): string =>
  `{"pid":4242,"sessionId":"${SID}","cwd":"/work/project-a${extra}","status":"${status}","statusUpdatedAt":${T}000}`;
/** `<config dir>/sessions/<pid>.json` (spec §9 "sessions JSON"): read for `status`, `statusUpdatedAt` and `sessionId`
 *  on the tick's swap and compact paths. W4 drives these; W1 plants them with the rest. */
export const SESSIONS_ROWS: readonly FileRow[] = [
  reg('compact-idle', raw(SESSION('idle'))),
  reg('compact-busy', raw(SESSION('busy'))),
  reg('spaced', raw(`{"pid": 4242, "sessionId": "${SID}", "status": "idle", "statusUpdatedAt": ${T}000}\n`)),
  reg('non-ascii-elsewhere', utf8(SESSION('idle', '-café'))),
  reg('nul', raw(`${SESSION('idle')}\x00`)),
  reg('nul-after-lead-byte', raw(`{"cwd":"\xc3\x00","status":"idle","sessionId":"${SID}"}`)),
  reg('invalid-utf8', raw(`{"cwd":"\xff","status":"idle","sessionId":"${SID}"}`)),
  reg('crlf', raw(`{"status":"idle",\r\n"sessionId":"${SID}"}\r\n`)),
  reg('missing-status', raw(`{"pid":4242,"sessionId":"${SID}"}`)),
  reg('repeated-status', raw(`{"status":"busy","status":"idle","sessionId":"${SID}"}`)),
  reg('empty', NONE),
  shaped('absent', 'absent'),
  shaped('directory', 'directory'),
  shaped('fifo', 'fifo'),
  shaped('mode-000', 'mode-000', raw(SESSION('idle'))),
  shaped('symlink-devzero', 'symlink-devzero'),
];

/** Every planted file-row set, by name, for the suite's plant check. */
export const FILE_ROW_SETS: Readonly<Record<string, readonly FileRow[]>> = {
  LIMITS_ROWS, REGISTRY_ROWS, HOME_ROWS, AUTHDEAD_ROWS, SESSIONS_ROWS,
};

/** One route record: each field's registry value, or `undefined` for an absent field. */
export interface RouteRow {
  readonly id: string;
  readonly class?: string;
  readonly degraded?: string;
  readonly effort?: string;
  readonly inert?: string;
  readonly routeapplied?: string;
}

/** The value each named case writes (plan Task 15). `degraded`'s invalid case is `default`: `degraded` names a class
 *  RUNG, and `_route_valid`'s degraded arm refuses the word `class` accepts. */
export const ROUTE_VALUES = {
  class: { absent: undefined, valid: 'opus', default: 'default', invalid: 'gpt9' },
  degraded: { absent: undefined, valid: 'sonnet', invalid: 'default' },
  effort: { absent: undefined, valid: 'high', auto: 'auto', invalid: 'turbo' },
  inert: { absent: undefined, effort: 'effort', junk: 'bogus' },
  routeapplied: { absent: undefined, both: 'class=opus effort=high', 'class-only': 'class=opus', junk: 'zz' },
} as const;

/** Every combination of the five fields' cases (4 × 3 × 4 × 3 × 4 = 576), plus haiku with each effort case. The id
 *  names each field's CASE, so a failure reads as the record it was. */
export const ROUTE_ROWS: readonly RouteRow[] = (() => {
  const rows: RouteRow[] = [];
  const V = ROUTE_VALUES;
  for (const [c, cv] of Object.entries(V.class)) {
    for (const [d, dv] of Object.entries(V.degraded)) {
      for (const [e, ev] of Object.entries(V.effort)) {
        for (const [i, iv] of Object.entries(V.inert)) {
          for (const [r, rv] of Object.entries(V.routeapplied)) {
            rows.push({ id: `class=${c},degraded=${d},effort=${e},inert=${i},routeapplied=${r}`,
              class: cv, degraded: dv, effort: ev, inert: iv, routeapplied: rv });
          }
        }
      }
    }
  }
  for (const [e, ev] of Object.entries(V.effort)) rows.push({ id: `class=haiku,effort=${e}`, class: 'haiku', effort: ev });
  return rows;
})();

/** The random corpus's alphabet (plan Task 2 Step 6): JSON punctuation, the digits, the limits keys, the five
 *  whitespace controls the fast path's class names (` \t\v\f\r`), the newline it must not cross, `.`, a NUL, a UTF-8
 *  lead byte and continuation byte (`é` when adjacent), and DEL. */
export const RANDOM_ALPHABET: readonly string[] = [
  '{', '}', '"', ':', ...'0123456789', ...LIMIT_KEYS,
  ' ', '\t', '\x0b', '\x0c', '\r', '\n', '.', '\x00', '\xc3', '\xa9', '\x7f',
];

/** mulberry32: small, seedable, and the same on every platform, so a failing random row is reproduced by its seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` regular-file rows drawn from `RANDOM_ALPHABET`, deterministic in `seed`. Uniform draws almost never spell a
 *  match, so about two steps in five lay down a key-shaped run instead — `"`, a key, `"`, whitespace, `:`, whitespace,
 *  digits — each piece still drawn from the alphabet and each one dropped or swapped now and then. That puts most rows
 *  near the match boundary, where a fast path and grep can disagree. Ids are `random-<seed>-<i>`. */
export function randomRows(seed: number, n: number): FileRow[] {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const WS = [' ', '\t', '\x0b', '\x0c', '\r', '\n'];
  const DIGITS = [...'0123456789'];
  const rows: FileRow[] = [];
  for (let i = 0; i < n; i++) {
    let s = '';
    const steps = Math.floor(r() * 24);
    for (let k = 0; k < steps; k++) {
      if (r() < 0.4) {
        const piece = (p: string): string => (r() < 0.08 ? pick(RANDOM_ALPHABET) : p);
        s += piece('"') + piece(pick(LIMIT_KEYS)) + piece('"');
        while (r() < 0.3) s += pick(WS);
        s += piece(':');
        while (r() < 0.3) s += pick(WS);
        do s += pick(DIGITS); while (r() < 0.5);
      } else {
        s += pick(RANDOM_ALPHABET);
      }
    }
    rows.push({ id: `random-${seed}-${i}`, shape: 'regular', bytes: raw(s) });
  }
  return rows;
}
