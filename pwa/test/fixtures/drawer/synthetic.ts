/**
 * Twelve hand-built, Claude-Code-shaped 220x50 screens (D-5006; plan Task 5).
 *
 * Each is the byte stream that paints it on a PINNED_WINDOW_COLS x
 * (PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS) terminal (the window plus tmux's
 * status row) and its text in `capture-pane -p`'s shape. They let the re-wrapper and the model go
 * red first before the rig records real pairs (Task 6); where the two
 * disagree, the recorded pair wins and this builder follows it. Every name and
 * path is fictional (`project-a`, `lane-a`). The only reverse-video cell on a
 * screen is its caret.
 */
import { PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS } from '../../../../shared/api';

/** One styled run: `sgr` is an SGR parameter string such as '1', '2',
 *  '38;2;215;119;87', '38;5;244', '32', '48;2;30;60;30', '1;4'.
 *  The builder emits `\x1b[<sgr>m<text>\x1b[0m`. No sgr → plain text. */
export interface Run { text: string; sgr?: string }
/** The caret: Claude Code's reverse-video caret cell (W11). Emitted as
 *  `\x1b[7m \x1b[27m`; its text is one space. */
export interface CaretRun { caret: true }
export type Row = string | readonly (Run | CaretRun)[];

export interface SyntheticScreen {
  name: string;
  /** Which later task/property this screen feeds. */
  covers: readonly string[];
  /** The bytes that paint it on a PINNED_WINDOW_COLS x
   *  (PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS) terminal. */
  stream: string;
  /** PINNED_WINDOW_ROWS (50) window rows, trailing U+0020 trimmed:
   *  capture-pane -p's shape. */
  rows: readonly string[];
  /** 0-based window row and 0-based CELL column of the one reverse-video
   *  caret cell, or null. */
  caret: { row: number; col: number } | null;
}

export const SRC_COLS = PINNED_WINDOW_COLS;
/** The column Claude Code word-wraps prose at, inside a 220-column window. A
 *  lower bound of 214 is measured on `server/test/fixtures/panes/ask-2col-chat-about.txt`
 *  (a 214-cell row whose next word would have reached 221). Task 6's recorded
 *  pairs correct this value, and the builder follows them where they differ. */
export const CC_WRAP_COLS = 216;
/** tmux's default status line, neutral: no hostname, no clock.
 *  Painted on row index PINNED_WINDOW_ROWS. */
export const STATUS_TEXT = '[cc-demo] 0:node*';

/** Width of `s` in terminal cells: CJK and emoji count as 2. */
export function cellWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x115F) ||
      (code >= 0x2E80 && code <= 0x303E) ||
      (code >= 0x3041 && code <= 0x33FF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0xA000 && code <= 0xA4CF) ||
      (code >= 0xAC00 && code <= 0xD7A3) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE30 && code <= 0xFE4F) ||
      (code >= 0xFF00 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x1F300 && code <= 0x1FAFF)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function hardBreak(token: string, firstMax: number, restMax: number): string[] {
  const parts: string[] = [];
  let current = '';
  let currentW = 0;
  let limit = firstMax;
  for (const ch of token) {
    const w = cellWidth(ch);
    if (current.length > 0 && currentW + w > limit) {
      parts.push(current);
      current = ch;
      currentW = w;
      limit = restMax;
    } else {
      current += ch;
      currentW += w;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/** Greedy word wrap with a hanging indent. `first` and `cont` must have the
 *  same cell width. */
export function wrapProse(
  text: string,
  first: string,
  cont: string,
  width = CC_WRAP_COLS,
): string[] {
  const words = text.split(' ').filter((w) => w.length > 0);
  const rows: string[] = [];
  let row = first;
  let rowW = cellWidth(first);
  let hasText = false;
  const maxText = width - cellWidth(cont);

  function flush() {
    rows.push(row.replace(/ +$/, ''));
  }

  for (const word of words) {
    const ww = cellWidth(word);
    if (!hasText) {
      const avail = width - rowW;
      if (ww <= avail) {
        row += word;
        rowW += ww;
        hasText = true;
      } else {
        const parts = hardBreak(word, avail, maxText);
        const firstPart = parts[0]!;
        row += firstPart;
        rowW += cellWidth(firstPart);
        hasText = true;
        flush();
        for (let i = 1; i < parts.length; i++) {
          const p = parts[i]!;
          row = cont + p;
          rowW = cellWidth(cont) + cellWidth(p);
          if (i < parts.length - 1) {
            flush();
          }
        }
      }
      continue;
    }

    if (rowW + 1 + ww <= width) {
      row += ' ' + word;
      rowW += 1 + ww;
      continue;
    }

    flush();
    row = cont + word;
    rowW = cellWidth(cont) + ww;
    hasText = true;

    if (ww > maxText) {
      const parts = hardBreak(word, maxText, maxText);
      const firstPart = parts[0]!;
      row = cont + firstPart;
      rowW = cellWidth(cont) + cellWidth(firstPart);
      flush();
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i]!;
        row = cont + p;
        rowW = cellWidth(cont) + cellWidth(p);
        if (i < parts.length - 1) {
          flush();
        }
      }
    }
  }

  if (hasText) flush();
  return rows;
}

function isPrintable(code: number): boolean {
  return code >= 0x20 && code !== 0x1b && code !== 0x7f;
}

/** Width of one row in cells. */
function rowWidth(row: Row): number {
  if (typeof row === 'string') return cellWidth(row);
  let w = 0;
  for (const run of row) {
    if ('caret' in run) {
      w += 1;
    } else {
      w += cellWidth(run.text);
    }
  }
  return w;
}

/** Plain text of one row (CaretRun renders as one space). */
function rowText(row: Row): string {
  if (typeof row === 'string') return row;
  let t = '';
  for (const run of row) {
    if ('caret' in run) {
      t += ' ';
    } else {
      t += run.text;
    }
  }
  return t;
}

/** Emit the ANSI stream for 50 window rows plus the tmux status row. */
export function paint(rows: readonly Row[]): string {
  if (rows.length !== PINNED_WINDOW_ROWS) {
    throw new Error(
      `paint expects ${PINNED_WINDOW_ROWS} rows, got ${rows.length}`,
    );
  }

  // Validate every row before writing anything.
  for (const row of rows) {
    const w = rowWidth(row);
    if (w > SRC_COLS) {
      throw new Error(`row is ${w} cells wide, max ${SRC_COLS}`);
    }
    if (typeof row === 'string') continue;
    for (const run of row) {
      if ('caret' in run) continue;
      for (const ch of run.text) {
        const code = ch.codePointAt(0) ?? 0;
        if (!isPrintable(code)) {
          throw new Error(
            `run text contains non-printable U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
          );
        }
      }
    }
  }

  let out = '\x1b[?1049h\x1b[H\x1b[2J';
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    if (typeof row === 'string' ? row.length === 0 : row.length === 0) {
      continue;
    }
    out += `\x1b[${r + 1};1H`;
    if (typeof row === 'string') {
      out += row;
    } else {
      for (const run of row) {
        if ('caret' in run) {
          out += '\x1b[7m \x1b[27m';
        } else if (run.sgr) {
          out += `\x1b[${run.sgr}m${run.text}\x1b[0m`;
        } else {
          out += run.text;
        }
      }
    }
  }
  // tmux's status line, the TMUX_STATUS_ROWS (1) row under the window, at row
  // index PINNED_WINDOW_ROWS. The "+ 1" is CUP's 1-based row, not a row count.
  const statusPad = ' '.repeat(SRC_COLS - cellWidth(STATUS_TEXT));
  out += `\x1b[${PINNED_WINDOW_ROWS + 1};1H\x1b[30;42m${STATUS_TEXT}${statusPad}\x1b[0m`;
  return out;
}

/** Pad `rows` with blank rows at the top and paint the screen. */
export function screen(
  name: string,
  covers: readonly string[],
  rows: readonly Row[],
): SyntheticScreen {
  if (rows.length > PINNED_WINDOW_ROWS) {
    throw new Error(
      `screen "${name}" has ${rows.length} rows, max ${PINNED_WINDOW_ROWS}`,
    );
  }
  const padded: Row[] = [
    ...Array.from<Row>({ length: PINNED_WINDOW_ROWS - rows.length }).fill(''),
    ...rows,
  ];
  const stream = paint(padded);
  const textRows = padded.map((r) => rowText(r).replace(/ +$/, ''));
  let caret: { row: number; col: number } | null = null;
  for (let r = 0; r < padded.length; r++) {
    const row = padded[r]!;
    if (typeof row === 'string') continue;
    let col = 0;
    for (const run of row) {
      if ('caret' in run) {
        if (caret !== null) {
          throw new Error(`screen "${name}" has more than one caret`);
        }
        caret = { row: r, col };
      } else {
        col += cellWidth(run.text);
      }
    }
  }
  return { name, covers, stream, rows: textRows, caret };
}

/** A full-width grey horizontal rule. */
export const RULE: Row = [
  { text: '─'.repeat(SRC_COLS), sgr: '38;5;244' },
];

/** A full-width grey rule made of `╌` characters. */
const DASH_RULE: Row = [
  { text: '╌'.repeat(SRC_COLS), sgr: '38;5;244' },
];

/** The standard bottom input box: rule, prompt + caret, rule, footer, blank. */
export function box(draft = '', footer: Row = '  ? for shortcuts'): Row[] {
  return [
    RULE,
    [{ text: '❯ ' + draft }, { caret: true }],
    RULE,
    footer,
    '',
  ];
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** `n` blank rows. */
function blank(n: number): Row[] {
  return Array.from({ length: n }, (): Row => '');
}

/** One dim (SGR 2) row. */
function dim(text: string): Row {
  return [{ text, sgr: '2' }];
}

/** The selected option's colour. */
function selected(text: string): Row {
  return [{ text, sgr: '38;2;177;185;249' }];
}

/** Claude Code's full-screen layout on the alternate screen: the transcript
 *  hangs from the top, the box or dialog is pinned to the bottom, and blank
 *  rows fill the gap (`server/test/fixtures/panes/busy.txt`'s shape). */
function pinned(top: readonly Row[], bottom: readonly Row[]): Row[] {
  const gap = PINNED_WINDOW_ROWS - top.length - bottom.length;
  if (gap < 0) throw new Error(`pinned: ${top.length} + ${bottom.length} rows overflow the window`);
  return [...top, ...blank(gap), ...bottom];
}

/** `left`, then spaces, then `right` ending exactly at cell `end` (1-based). */
function rightAligned(left: string, right: string, end: number): string {
  const gap = end - cellWidth(left) - cellWidth(right);
  if (gap < 8) throw new Error(`rightAligned: only ${gap} spaces before the segment`);
  return left + ' '.repeat(gap) + right;
}

/** The code gutter: two spaces, the line number right-aligned in 3 cells, two spaces (7 cells). */
const CODE_CONT = ' '.repeat(7);
function gutter(n: number): string {
  return '  ' + String(n).padStart(3) + '  ';
}

// ---------------------------------------------------------------------------
// The twelve synthetic screens
// ---------------------------------------------------------------------------

const permissionLongLabel = screen('permission-long-label', [
  'Task 8: joins',
  'Task 8: rules',
  'Task 16: tap targets',
], pinned([
  '❯ run the build for project-a',
  '',
  [{ text: '● ', sgr: '38;2;78;186;101' }, { text: 'Bash(npm run build --workspace project-a)' }],
  dim('  ⎿  Waiting…'),
], [
  RULE,
  [{ text: ' Bash command', sgr: '1' }],
  '',
  DASH_RULE,
  ...wrapProse(
    'npm run build --workspace project-a --verbose --loglevel=info --flag-one=value-one --flag-two=value-two --flag-three=value-three --flag-four=value-four --flag-five=value-five --flag-six=value-six --flag-seven=value-seven --flag-eight=value-eight --report=build/report.json',
    '   │ ',
    '   │ ',
  ),
  DASH_RULE,
  dim('   Build project-a with verbose logs'),
  '',
  ' Permission rule Bash requires confirmation for this command.',
  '',
  ' Do you want to proceed?',
  selected(' ❯ 1. Yes'),
  '   2. Yes, and do not ask again for npm run build commands in project-a that pass verbose logging flags to the bundler and write the report to the build directory',
  '   3. Yes, allow reads from src/ during this session',
  '   4. No, and tell Claude what to do differently (esc)',
  '',
  dim(' Esc to cancel · Tab to amend'),
]));

const singleSelect = screen('single-select', [
  'Task 8: structure',
  'Task 16: descriptions are no target',
], pinned([
  '❯ add a cache to project-a',
  '',
  "● I'll pick a storage backend for project-a first.",
], [
  RULE,
  [{ text: ' ☐ Storage', sgr: '1' }],
  '',
  'Which storage backend should project-a use for its cache?',
  '',
  selected('❯ 1. SQLite'),
  dim('     A single file beside the app; no server to run.'),
  '  2. Shared server',
  dim('     Shared across lanes; needs a running service.'),
  '  3. In memory',
  dim('     Lost on restart; the fastest.'),
  '  4. Type something.',
  RULE,
  '  5. Chat about this',
  '',
  dim('Enter to select · ↑/↓ to navigate · Esc to cancel'),
]));

const multiselect = screen('multiselect', [
  'Task 16: checkbox Space',
], pinned([
  '❯ set up the merge checks for project-a',
  '',
  '● A few questions before I write the workflow.',
], [
  RULE,
  [{ text: '←  ☐ Checks  ✔ Submit  →', sgr: '1' }],
  '',
  'Which checks should run before merge in project-a?',
  '',
  '  1. [ ] Lint',
  dim('         Style rules over src/.'),
  selected('❯ 2. [ ] Unit tests'),
  dim('         Runs test/app.test.ts.'),
  '  3. [x] Type check',
  dim('         The strict compiler pass.'),
  '  4. [ ] Format',
  dim('         Rewrites files in place.'),
  '  5. [ ] Type something',
  '     Submit',
  RULE,
  '  6. Chat about this',
  '',
  dim('Enter to select · ↑/↓ to navigate · Esc to cancel'),
]));

const longPathToken =
  'src/generated/' +
  Array.from({ length: 26 }, (_, i) => `segment-${String(i + 1).padStart(2, '0')}`).join('/') +
  '/index.ts';

const toolOutput = screen('tool-output', [
  'Task 8: hanging indent',
  'Task 8: hard break',
], pinned([
  '❯ list the generated files in project-a',
  '',
  ...wrapProse(`Bash(ls -la ${longPathToken})`, '● ', '  '),
  dim('  ⎿  total 128'),
  ...wrapProse(
    '-rw-r--r-- 1 lane-a lane-a 12345 Jan 1 00:00 src/generated/segment-01/segment-02/segment-03/segment-04/segment-05/segment-06/segment-07/segment-08/segment-09/segment-10/segment-11/segment-12/segment-13/segment-14/segment-15/index.ts',
    '     ',
    '     ',
  ),
  ...wrapProse(
    'warning: the generated tree under src/generated is deeper than the configured limit, so the watcher in project-a skips it; set watch.maxDepth in the project-a config or move the generated files closer to the root to keep them under watch',
    '     ',
    '     ',
  ),
  dim('     drwxr-xr-x 3 lane-a lane-a 4096 Jan 1 00:00 src/lib'),
  dim('     -rw-r--r-- 1 lane-a lane-a  892 Jan 1 00:00 test/app.test.ts'),
  [{ text: '     + export const CACHE_TTL = 300;', sgr: '48;2;30;60;30' }],
  [{ text: '     - const cache = {};', sgr: '48;2;60;30;30' }],
  '',
], box()));

const proseLongLines = screen('prose-long-lines', [
  'Task 8: re-join',
  'Task 8: property (f)',
], pinned([
  '❯ explain the cache plan for project-a',
  '',
  ...wrapProse(
    'The cache in project-a needs a clear eviction policy. If every entry lives forever, memory pressure grows until the process is stopped by the limits of its lane. A bounded LRU keeps hot entries near the front while cold ones fall off the back, and it costs one map and one list per instance.',
    '● ',
    '  ',
  ),
  '',
  ...wrapProse(
    'Start by measuring hit rates under the current workload. Add counters to src/lib/cache.ts and run test/app.test.ts to establish a baseline. Once the baseline is stable, introduce the capacity limit and assert that evictions happen when the threshold is crossed, and not before it.',
    '  ',
    '  ',
  ),
  '',
  ...wrapProse(
    'The final design should keep reads fast, avoid lock contention across lanes, and store the new counters alongside the existing metrics so the dashboard can display them without an extra query. None of this changes the public interface that the rest of project-a calls.',
    '  ',
    '  ',
  ),
  '',
  ...wrapProse(
    'Add the LRU map to src/lib/cache.ts and expose get, set and delete methods that match the existing interface, so that no caller has to change; keep the capacity a constructor argument with a sensible default, and document why the default was chosen next to it.',
    '  1. ',
    '     ',
  ),
  ...wrapProse(
    'Write a test in test/app.test.ts that fills the cache beyond its capacity and asserts that the oldest unreferenced entry is removed first.',
    '  2. ',
    '     ',
  ),
  ...wrapProse(
    'Document the eviction policy in a comment so future readers know why the limit exists.',
    '  3. ',
    '     ',
  ),
  '',
  ...wrapProse('Keep the public API unchanged.', '  - ', '    '),
  ...wrapProse(
    'Avoid adding dependencies: the standard library already has everything the cache needs, and every new dependency is one more thing to audit, pin and upgrade across every lane that builds project-a, which is exactly the cost the cache was meant to save.',
    '  - ',
    '    ',
  ),
  ...wrapProse(
    'Log eviction events at debug level so they can be traced without flooding the default output.',
    '    - ',
    '      ',
  ),
], box()));

const markdownTableCode = screen('markdown-table-code', [
  'Task 8: table rows do not wrap',
  'Task 8: code gutter',
], pinned([
  '❯ summarise the services in project-a',
  '',
  '● Here is the current state of project-a:',
  '',
  '  ┌─────────┬──────────┬─────────┐',
  [{ text: '  │ ' }, { text: 'Service', sgr: '1' }, { text: ' │ ' }, { text: 'Status', sgr: '1' }, { text: '   │ ' }, { text: 'Tokens', sgr: '1' }, { text: '  │' }],
  '  ├─────────┼──────────┼─────────┤',
  '  │ api     │ ready    │    1234 │',
  '  ├─────────┼──────────┼─────────┤',
  '  │ worker  │ busy     │     892 │',
  '  ├─────────┼──────────┼─────────┤',
  '  │ cache   │ warming  │     445 │',
  '  └─────────┴──────────┴─────────┘',
  '',
  '  The helper, in src/lib/sum.ts:',
  '',
  [{ text: gutter(1), sgr: '2' }, { text: 'export function sum(xs: number[]): number {', sgr: '38;5;141' }],
  gutter(2) + '  let total = 0;',
  gutter(3) + '  for (const x of xs) {',
  gutter(4) + '    total += x;',
  gutter(5) + '  }',
  ...wrapProse(
    "const note = 'this constant is deliberately long, because a code line wider than the window is wrapped by the renderer under the code gutter, and the re-wrapper must keep that gutter as the hanging indent rather than re-join it as prose';",
    gutter(6),
    CODE_CONT,
  ),
  gutter(7) + '  return total;',
  gutter(8) + '}',
  '',
], box()));

const rightAlignedScreen = screen('right-aligned', [
  'Task 8: right rows',
], pinned([
  '❯ use the medium effort preset for project-a',
  '',
  '● Done: project-a now uses the medium effort preset.',
  '',
], box('', rightAligned('  ? for shortcuts', '◐ medium · /effort', SRC_COLS - 2))));

const cjkWide = screen('cjk-wide', [
  'Task 7: width 2',
  'Task 8: no split wide cell',
], pinned([
  '❯ 用中文和日文总结 project-a 的缓存计划',
  '',
  '● 世界の project-a について考えます。',
  '',
  ...wrapProse(
    'キャッシュの設定を変更する前に現在の動作を確認してテストを追加します。'.repeat(2) +
      '缓存的容量应该是构造函数的参数并且有一个合理的默认值。'.repeat(2) +
      '古いエントリから順番に削除されることを確認します。',
    '  ',
    '  ',
  ),
  '',
  '  - 缓存配置需要保留现有接口。',
  '  - 单元测试覆盖命中和未命中两种情况。',
  '  - 使用标准库，避免额外依赖。',
  dim('  - 发布 🚀 完成 ✅'),
  '',
], box('设置')));

const exitNotice = screen('exit-notice', [
  'Task 11: exit notice',
], pinned([
  '❯ thanks, that is all for project-a',
  '',
  '● Glad to help.',
  '',
], box('', dim('  Press Ctrl-C again to exit'))));

const numberedReply = screen('numbered-reply', [
  'Task 16: a false menu',
], pinned([
  '❯ the test in test/app.test.ts is flaky',
  '',
  '● Two ways to fix the flaky test in project-a:',
  '  1. Pin the clock in src/app.ts so the timeout is deterministic.',
  '  2. Raise the timeout to 5 s and keep the real clock.',
  '  Which one do you want?',
  '',
], box()));

const notClaude = screen('not-claude', [
  'Task 9: the not-Claude-Code chip',
], [
  [{ text: 'import', sgr: '35' }, { text: " { sum } from './lib/sum';" }],
  [{ text: 'import', sgr: '35' }, { text: " { Cache } from './lib/cache';" }],
  '',
  [{ text: 'export const', sgr: '33' }, { text: ' cache = new Cache(128);' }],
  '',
  [{ text: 'export function', sgr: '33' }, { text: ' total(xs: number[]): number {' }],
  [{ text: '  const', sgr: '33' }, { text: ' hit = cache.get(xs.join(","));' }],
  [{ text: '  if', sgr: '33' }, { text: ' (hit !== undefined) ' }, { text: 'return', sgr: '33' }, { text: ' hit;' }],
  [{ text: '  const', sgr: '33' }, { text: ' value = sum(xs);' }],
  '  cache.set(xs.join(","), value);',
  [{ text: '  return', sgr: '33' }, { text: ' value;' }],
  '}',
  ...Array.from({ length: 37 }, (): Row => [{ text: '~', sgr: '34' }]),
  '"src/app.ts" 12L, 240B',
]);

const busy = screen('busy', [
  'Task 8: spinner row',
  'Task 9: busy',
], pinned([
  '❯ add a cache to project-a',
  '',
  "● I'll add the cache in src/lib/cache.ts.",
  '',
  [{ text: '✽', sgr: '38;2;215;119;87' }, { text: ' Working… ', sgr: '38;2;215;119;87' }, { text: '(3s · ↓ 12 tokens)', sgr: '2' }],
  '',
], box('', dim('  esc to interrupt'))));

export const SYNTHETIC_SCREENS: readonly SyntheticScreen[] = [
  permissionLongLabel,
  singleSelect,
  multiselect,
  toolOutput,
  proseLongLines,
  markdownTableCode,
  rightAlignedScreen,
  cjkWide,
  exitNotice,
  numberedReply,
  notClaude,
  busy,
];
