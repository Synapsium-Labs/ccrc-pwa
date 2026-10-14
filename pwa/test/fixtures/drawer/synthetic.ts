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
   *  (PINNED_WINDOW_ROWS + 1) terminal. */
  stream: string;
  /** PINNED_WINDOW_ROWS (50) window rows, trailing U+0020 trimmed:
   *  capture-pane -p's shape. */
  rows: readonly string[];
  /** 0-based window row and 0-based CELL column of the one reverse-video
   *  caret cell, or null. */
  caret: { row: number; col: number } | null;
}

export const SRC_COLS = PINNED_WINDOW_COLS;
/** The column Claude Code word-wraps prose at, inside a 220-column window. */
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
  // tmux status row: row index PINNED_WINDOW_ROWS (50) is the +1 status row.
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
// The twelve synthetic screens
// ---------------------------------------------------------------------------

const permissionLongLabel = screen('permission-long-label', [
  'Task 8: joins',
  'Task 8: rules',
  'Task 16: tap targets',
], [
  '❯ run the build for project-a',
  '',
  [{ text: '● Bash(npm run build --workspace project-a)', sgr: '38;2;78;186;101' }],
  [{ text: '  ⎿  Waiting…', sgr: '2' }],
  '',
  RULE,
  ' Bash command',
  '',
  DASH_RULE,
  ...wrapProse(
    'npm run build --workspace project-a --verbose --loglevel=info --flag-one=value-one --flag-two=value-two --flag-three=value-three --flag-four=value-four --flag-five=value-five --flag-six=value-six --flag-seven=value-seven --flag-eight=value-eight --report=build/report.json',
    '   │ ',
    '   │ ',
  ),
  DASH_RULE,
  [{ text: '   Build project-a with verbose logs', sgr: '2' }],
  '',
  ' Permission rule Bash requires confirmation for this command.',
  '',
  ' Do you want to proceed?',
  [{ text: ' ❯ 1. Yes', sgr: '38;2;177;185;249' }],
  '   2. Yes, and do not ask again for npm run build commands in project-a that pass verbose logging flags to the bundler and write the report to the build directory',
  '   3. Yes, allow reads from src/ during this session',
  '   4. No, and tell Claude what to do differently (esc)',
  '',
  [{ text: ' Esc to cancel · Tab to amend', sgr: '2' }],
]);

const singleSelect = screen('single-select', [
  'Task 8: structure',
  'Task 16: descriptions are no target',
], [
  "● I'll pick a storage backend for project-a.",
  RULE,
  [{ text: ' ☐ Storage', sgr: '1' }],
  '',
  'Which storage backend should project-a use for its cache?',
  '',
  [{ text: '❯ 1. SQLite', sgr: '38;2;177;185;249' }],
  [{ text: '     A single file beside the app; no server to run.', sgr: '2' }],
  '  2. Shared server',
  [{ text: '     Shared across lanes; needs a running service.', sgr: '2' }],
  '  3. In memory',
  [{ text: '     Lost on restart; the fastest.', sgr: '2' }],
  '  4. Type something.',
  RULE,
  '  5. Chat about this',
  '',
  [{ text: 'Enter to select · ↑/↓ to navigate · Esc to cancel', sgr: '2' }],
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ...box(),
]);

const multiselect = screen('multiselect', [
  'Task 16: checkbox Space',
], [
  RULE,
  [{ text: '←  ☐ Checks  ✔ Submit  →', sgr: '1' }],
  '',
  'Which checks should run before merge in project-a?',
  '',
  '  1. [ ] Lint',
  [{ text: '         Style rules over src/.', sgr: '2' }],
  [{ text: '❯ 2. [ ] Unit tests', sgr: '38;2;177;185;249' }],
  [{ text: '         Runs test/app.test.ts.', sgr: '2' }],
  '  3. [x] Type check',
  [{ text: '         The strict compiler pass.', sgr: '2' }],
  '  4. [ ] Format',
  [{ text: '         Rewrites files in place.', sgr: '2' }],
  '  5. [ ] Type something',
  '     Submit',
  RULE,
  '  6. Chat about this',
  '',
  [{ text: 'Enter to select · ↑/↓ to navigate · Esc to cancel', sgr: '2' }],
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ...box(),
]);

const longPathToken =
  'src/generated/' +
  [
    'segment-01',
    'segment-02',
    'segment-03',
    'segment-04',
    'segment-05',
    'segment-06',
    'segment-07',
    'segment-08',
    'segment-09',
    'segment-10',
    'segment-11',
    'segment-12',
    'segment-13',
    'segment-14',
    'segment-15',
    'segment-16',
    'segment-17',
    'segment-18',
    'segment-19',
    'segment-20',
    'segment-21',
    'segment-22',
    'segment-23',
    'segment-24',
    'segment-25',
    'segment-26',
  ].join('/') +
  '/index.ts';

const toolOutput = screen('tool-output', [
  'Task 8: hanging indent',
  'Task 8: hard break',
], [
  ...wrapProse(`Bash(ls -la ${longPathToken})`, '● ', '  '),
  [{ text: '  ⎿  total 128', sgr: '2' }],
  ...wrapProse(
    '-rw-r--r-- 1 user user 12345 Oct 14 12:00 src/generated/segment-01/segment-02/segment-03/segment-04/segment-05/segment-06/segment-07/segment-08/segment-09/segment-10/segment-11/segment-12/segment-13/segment-14/segment-15/index.ts',
    '  ⎿  ',
    '     ',
  ),
  [{ text: '     drwxr-xr-x 3 user user 4096 Oct 14 11:30 src/lib', sgr: '2' }],
  [{ text: '     -rw-r--r-- 1 user user  892 Oct 14 11:25 test/app.test.ts', sgr: '2' }],
  [{ text: '     + export const CACHE_TTL = 300;', sgr: '48;2;30;60;30' }],
  [{ text: '     - const cache = {};', sgr: '48;2;60;30;30' }],
  [{ text: '     + export const ttl = 300;', sgr: '48;2;30;60;30' }],
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ...box(),
]);

const proseLongLines = screen('prose-long-lines', [
  'Task 8: re-join',
  'Task 8: property (f)',
], [
  ...wrapProse(
    'The cache in project-a needs a clear eviction policy. If every entry lives forever, memory pressure grows until the process is killed by the lane limits. A bounded LRU keeps hot entries near the front while cold ones fall off the back.',
    '● ',
    '  ',
  ),
  '',
  ...wrapProse(
    'Start by measuring hit rates under the current workload. Add counters to src/lib/cache.ts and run test/app.test.ts to establish a baseline. Once the baseline is stable, introduce the capacity limit and assert that evictions happen when the threshold is crossed.',
    '  ',
    '  ',
  ),
  '',
  ...wrapProse(
    'The final design should keep reads fast, avoid lock contention across lanes, and store the new counters alongside the existing metrics so the dashboard can display them without an extra query.',
    '  ',
    '  ',
  ),
  '',
  ...wrapProse(
    '1. Add the LRU map to src/lib/cache.ts and expose get, set, and delete methods that match the existing interface so callers do not need to change.',
    '  ',
    '     ',
  ),
  ...wrapProse(
    '2. Write a test in test/app.test.ts that fills the cache beyond its capacity and asserts that the oldest unreferenced entry is removed first.',
    '  ',
    '     ',
  ),
  ...wrapProse(
    '3. Document the eviction policy in a comment and update the project-a README so future lanes know why the limit exists.',
    '  ',
    '     ',
  ),
  ...wrapProse(
    '- Keep the public API unchanged.',
    '  ',
    '    ',
  ),
  ...wrapProse(
    '- Avoid adding dependencies; use the standard library only.',
    '  ',
    '    ',
  ),
  ...wrapProse(
    '- Instrument cache hits and misses for observability.',
    '  ',
    '    ',
  ),
  ...wrapProse(
    '- Nested: log eviction events at debug level so they can be traced without flooding the default output.',
    '    - ',
    '      ',
  ),
  '',
  ...box(),
]);

const markdownTableCode = screen('markdown-table-code', [
  'Task 8: table rows do not wrap',
  'Task 8: code gutter',
], [
  '● Here is the current state of project-a:',
  '',
  [{ text: '┌─────────┬──────────┬─────────┐', sgr: '1' }],
  [{ text: '│ Service │ Status   │ Tokens  │', sgr: '1' }],
  [{ text: '├─────────┼──────────┼─────────┤', sgr: '1' }],
  '│ api     │ ready    │    1234 │',
  '│ worker  │ busy     │     892 │',
  '│ cache   │ warming  │     445 │',
  [{ text: '└─────────┴──────────┴─────────┘', sgr: '1' }],
  '',
  '  1  export function sum(xs: number[]): number {',
  '  2    let total = 0;',
  '  3    for (const x of xs) {',
  '  4      total += x;',
  '  5    }',
  '  6    return total;',
  ...wrapProse(
    '  7  // This line is intentionally long: it demonstrates a code row that exceeds the normal prose wrap column because code gutters are not supposed to be rewrapped by the prose reader.',
    '       ',
    '       ',
  ),
  '  8  }',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ...box(),
]);

const rightAligned = screen('right-aligned', [
  'Task 8: right rows',
], [
  '● I will use the medium effort preset for project-a.',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ...box('', '  ? for shortcuts' + ' '.repeat(178) + '◐ medium · /effort'),
]);

const cjkWide = screen('cjk-wide', [
  'Task 7: width 2',
  'Task 8: no split wide cell',
], [
  '● 世界の project-a について考えます。',
  '',
  ...wrapProse(
    'これは日本語の長い段落です。project-a のキャッシュ設定を変更する前に、現在の動作を確認し、テストを追加してから実装を進めるべきです。',
    '● ',
    '  ',
  ),
  '',
  ...wrapProse(
    '- 缓存配置需要保留现有 API。',
    '  ',
    '    ',
  ),
  ...wrapProse(
    '- 单元测试覆盖命中和未命中两种情况。',
    '  ',
    '    ',
  ),
  ...wrapProse(
    '- 使用标准库避免额外依赖。',
    '  ',
    '    ',
  ),
  [{ text: '  -  emoji only: 🚀 ✅', sgr: '2' }],
  '',
  ...box('设置'),
]);

const exitNotice = screen('exit-notice', [
  'Task 11: exit notice',
], [
  '❯ exit',
  '',
  '● Goodbye.',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ...box('', [{ text: '  Press Ctrl-C again to exit', sgr: '2' }]),
]);

const numberedReply = screen('numbered-reply', [
  'Task 16: a false menu',
], [
  '● Two ways to fix the flaky test in project-a:',
  '  1. Pin the clock in src/app.ts so the timeout is deterministic.',
  '  2. Raise the timeout to 5 s and keep the real clock.',
  '  Which one do you want?',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ...box(),
]);

const notClaude = screen('not-claude', [
  'Task 9: the not-Claude-Code chip',
], [
  [{ text: '  1', sgr: '2' }],
  [{ text: '  import { useState } from \'react\';', sgr: '35' }],
  [{ text: '  import { sum } from \'./lib\';', sgr: '35' }],
  '',
  [{ text: '  export function App() {', sgr: '31' }],
  [{ text: '    const [count, setCount] = useState(0);', sgr: '33' }],
  [{ text: '    return (', sgr: '31' }],
  [{ text: '      <div>', sgr: '90' }],
  [{ text: '        <p>Count: {count}</p>', sgr: '90' }],
  [{ text: '        <button onClick={() => setCount(c => c + 1)}>', sgr: '90' }],
  [{ text: '          Increment', sgr: '90' }],
  [{ text: '        </button>', sgr: '90' }],
  [{ text: '      </div>', sgr: '90' }],
  [{ text: '    );', sgr: '31' }],
  [{ text: '  }', sgr: '31' }],
  '',
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '~', sgr: '34' }],
  [{ text: '"src/app.ts" 12L, 240B', sgr: '2' }],
]);

const busy = screen('busy', [
  'Task 8: spinner row',
  'Task 9: busy',
], [
  '❯ add a cache to project-a',
  '',
  "● I'll add the cache in src/lib/cache.ts.",
  '',
  [{ text: '✽ Working… (3s · ↓ 12 tokens)', sgr: '38;2;215;119;87' }],
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ...box('', [{ text: '  esc to interrupt', sgr: '2' }]),
]);

export const SYNTHETIC_SCREENS: readonly SyntheticScreen[] = [
  permissionLongLabel,
  singleSelect,
  multiselect,
  toolOutput,
  proseLongLines,
  markdownTableCode,
  rightAligned,
  cjkWide,
  exitNotice,
  numberedReply,
  notClaude,
  busy,
];
