/**
 * Read a session's current model / effort / ultracode straight from the tmux
 * pane ccrc already captures for dialog detection — the only source that has
 * all three (the live-state pid.json carries none; ultracode is never written
 * to any file, it lives only on Claude Code's native mode-line).
 *
 * Two rows are parsed, both from a plain (`capture-pane -p`, ANSI-stripped)
 * capture:
 *   • the custom statusline row: `👤 <account> │ 🤖 <model> · <effort> │ …`
 *     (ccd/statusline-command.sh's format, installed as
 *      ~/.claude/statusline-command.sh; the row is the lowest line led by
 *      `👤`, its segments are delimited by the box-vertical `│`, and
 *      model/effort split on ` · `).
 *   • the prompt box's TOP border, which Claude Code titles with the current
 *     mode word, e.g. `───── ultracode ─` — found by walking UP from that row
 *     through the box, never by looking for the word anywhere.
 *
 * Both are best-effort: a dialog/permission overlay can hide the statusline for
 * a tick, so callers keep the last-known value rather than blanking on a miss.
 */
export interface Statusline {
  model?: string; // display name as the terminal shows it, e.g. "Opus 4.8 (1M context)"
  effort?: string; // effort level, e.g. "xhigh"
  ultracode: boolean;
  branch?: string; // current git branch, e.g. "fix/linear-go-live-completion"
  workflowActive: boolean; // a Workflow is running — orchestrator is idle-waiting on subagents
  /** Context-window pressure, parsed from the `▓ ctx <bar> NN%` segment
   *  (statusline-command.sh's field 4, D-2011). `undefined` when this
   *  capture carried no such segment — never fabricated as 0, which is a
   *  real, distinct reading (a session Claude Code reports as freshly
   *  compacted).
   *
   *  READ THIS BEFORE "CORRECTING" THE NUMBER: it is a percentage of what
   *  Claude Code itself BELIEVES its context window is — on the gpt lane
   *  that belief is the global default 200,000 for a model whose real
   *  usable wall measures ~196,000 (30 logged `exceeds the context window`
   *  refusals above it; see the plan this deviation was filed against). It
   *  is honest as a PRESSURE signal precisely because it is the same number
   *  the pane's own compactor and hard-block thresholds are computed
   *  against — converting it to an absolute token count here would need a
   *  per-lane window table (the account-name enumeration this project's
   *  CLAUDE.md forbids) and would stop meaning what the operator, looking
   *  at the same pane, sees. */
  ctxPct?: number;
  /** Never set by the parser: `FleetWatcher` marks an entry it KEPT across a
   *  tick that measured no identity (a hidden or cut row), so the fleet can
   *  rank that branch below a fresher measurement of it (fleet.ts). */
  retained?: boolean;
  /** The prompt box's width in columns: the length of the pure `─` rule
   *  directly above the statusline row, which is the box's bottom border.
   *  Every border in every capture measured is exactly as long as the pane
   *  is wide (Claude Code 2.1.280, both renderers, widths 20-220), and no
   *  captured row can be wider than its pane — a `─` is one column — so this
   *  is never MORE than the pane's width: a reading of N proves the pane is at
   *  least N wide, whatever else is on screen. `undefined` when there is no
   *  row, or no bare rule directly above it (a startup gate, a menu or an
   *  overlay is up, or the row is an impostor printed in chat). */
  boxCols?: number;
}

// The Workflow progress row: `◯ <name>  <desc>   …   N/M agents done · 2s`.
// The count is RIGHT-ALIGNED after a run of padding spaces (2.1.280, both
// renderers, measured at 60-220 columns), or opens a ` · ` part (the older
// fleet capture below the row in statusline.test.ts) — so a sentence that
// merely contains "2/4 agents done", one space before the number, is not it.
const WORKFLOW_RE = /(?:^|\s·\s|\s{2})\d+\/\d+\s+agents?\s+done\b/i;

const ROBOT = '🤖';
const BRANCH = '⎇'; // U+2387 branch glyph in the statusline
const BOX_V = '│'; // U+2502 segment separator
// The prompt box's top border when Claude Code titles it: a `─` run, the
// title, one closing `─` (`GX`/`QX` in 2.1.280 build it right-aligned, tags
// joined by two spaces — source-reading; the shape is a real fleet capture's).
const TITLED_RULE_RE = /^─{2,} (.+?) ─+$/;
// U+2593 "▓ ctx <bar> NN%" (statusline-command.sh:171).
//
// CORRECTED TWICE. This was first anchored on the GLYPH ALONE, on the argument
// that ▓ is rarer than the word "ctx" ccd's own scraper anchors on
// (`ccd/ccd`'s `_pane_ctx_pct`, `grep -aoiE 'ctx[^0-9]*[0-9]+%'`). That
// argument was WRONG on its own terms: the scan then took the FIRST hit in the
// WHOLE pane, top-down, exactly like ccd's word anchor — rarity of the token
// narrows the odds of a false hit, it does not change the failure mode.
// Measured against three shaped chat lines above a real statusline: a
// fabricated "▓▓▓▓▓▓░░ 95% done building" progress bar read as ctxPct 95;
// "▓ 88% coverage" read as 88; and inert "▓▓▓▓▓▓▓▓ block art, no percent
// here" ABOVE a statusline reading 91% returned `undefined`, which then
// (D-2012) actively CLEARED the last-known 91.
//
// The second version scanned every line BOTTOM-UP and required the candidate
// to BE a ctx segment (CTX_SEGMENT_RE below). It left one residual it named: a
// statusline publishing NO ctx segment, with a `▓ ctx <bar> NN%`-shaped line
// in chat above it, read the impostor — and asked that it be closed "only with
// a pane-structure fact". A NARROW pane is that residual's common case: the
// ctx segment is the row's fifth, so a pane that cuts the row loses it every
// tick, and the scan climbed into chat — one Statusline built from two rows.
//
// Now the reading comes from the statusline row's own `▓` segment
// (`statuslineRowAt`, below — the `👤`-led row is the pane-structure fact) and
// nowhere else. `make_bar` renders █ (filled) and ░ (empty), never ▓, and the
// limits segment uses ⏳, so no other segment of that row can carry the glyph.
const CTX_GLYPH = '▓';
// A genuine `ctx <bar> NN%` segment body (the text after CTX_GLYPH, before
// the next │): the word "ctx", then eventually a trailing `NN%` with
// nothing but the bar's fill/empty cells (never digits) between them.
const CTX_SEGMENT_RE = /ctx\b.*\d+%$/i;

/** The context-pressure reading from the statusline row's `▓ ctx <bar> NN%`
 *  segment, or `undefined` when that row carried none (or is not on screen).
 *  The segment must pass `CTX_SEGMENT_RE`, so a cut segment (`▓ ctx ██…`) or
 *  one without a trailing percentage reads as nothing rather than as a
 *  number. The percentage is the LAST run of digits in the segment — the
 *  bar's fill/empty cells between "ctx" and the number are never digits, so
 *  this survives any bar width/state. */
function parseCtxPct(row: string | undefined): number | undefined {
  const seg = segmentAfter(row, CTX_GLYPH);
  if (seg === undefined || !CTX_SEGMENT_RE.test(seg)) return undefined;
  const matches = seg.match(/\d+(?=%)/g);
  if (!matches || matches.length === 0) return undefined;
  return parseInt(matches[matches.length - 1]!, 10);
}

// statusline-command.sh's FIRST segment, written unconditionally once `jq` is
// present (ccd/statusline-command.sh: `segments+=("👤 ${acct}")`, present
// since the repository's first commit; without `jq` the script prints a bare
// `claude-code`, which carries no identity and reads as no row). It is what
// makes a line THE statusline row.
const ACCOUNT = '👤';

// What Claude Code ends its statusline row with when the pane is narrower
// than the row (U+2026).
const CUT = '…';

/** The statusline row: the LOWEST line whose first segment is `👤`.
 *
 *  Not "the first line containing the glyph", which is what the reads below
 *  used to take — chat scrollback sits ABOVE the statusline and outranked it.
 *  Measured 2026-09-23: a session whose own diff put `` `⎇ ws/ccr…` became the
 *  session's branch, `` on screen had that sentence shipped as its branch and
 *  shown as its workspace name. Bottom-up is what puts the real row first;
 *  the `👤` START (not merely a `👤` somewhere in the line) is what stops a
 *  sentence that mentions the glyphs from qualifying at all.
 *
 *  TWO RESIDUALS, stated:
 *   - when an overlay hides the real row (the /model picker does, in both
 *     renderers; the slash menu in the inline one), a statusline-shaped row
 *     printed in chat — a test fixture, a
 *     raw run of the script, whose continuation lines Claude Code indents — is
 *     the lowest one left, and it reads until the overlay closes;
 *   - on a NARROWING resize, tmux reflows the old row onto two lines before
 *     Claude Code repaints (17-36 ms in the fix's measurement), so for that
 *     window the `👤` line holds an unmarked prefix of the row, which reads. */
function statuslineRowAt(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim().startsWith(`${ACCOUNT} `)) return i;
  }
  return -1;
}

// The prompt box's borders: a bare run of `─` from column 0 — never indented,
// which is how tool output Claude Code prints under `⎿` would carry one.
const RULE_RE = /^─+$/;

/** The one line Claude Code draws BETWEEN the box's bottom border and the
 *  statusline row: the auto-continue footer (`  ⚠ Usage limit reached ·
 *  continuing automatically at … · esc to cancel`), the only such line in 492
 *  real 2.1.280 captures. Both walks up from the row step over it. */
const isBoxFooterNotice = (l: string): boolean => l.trim().startsWith('⚠ ');

/** The title on the prompt box's TOP border, walking up from the statusline
 *  row at `at`: past blank lines to the box's bottom border, then past
 *  whatever the box holds — a draft can be any text — to the next border.
 *  `undefined` when that border carries no title, when anything but a blank
 *  line sits between the row and the box, or when no border is found above
 *  it (the box is not on screen). The walk is what keeps a line that
 *  merely LOOKS like a titled border — a diff of a test fixture, a quoted
 *  capture — out: chat sits above the box, and the walk stops at the box. */
function topBorderTitle(lines: string[], at: number): string | undefined {
  let inBox = false;
  // UNBOUNDED, and a bound bought nothing: the walk ends at the first border
  // either way, and Claude Code grows the box with every draft line — a
  // 20-line draft put the titled border 23 rows above the row (2.1.280,
  // measured), past the 16-row bound this first shipped with.
  for (let i = at - 1; i >= 0; i--) {
    const l = lines[i]!.trimEnd();
    const titled = TITLED_RULE_RE.exec(l);
    if (titled) return titled[1];
    if (RULE_RE.test(l)) {
      if (inBox) return undefined; // the top border, untitled
      inBox = true;
      continue;
    }
    if (inBox || l.trim() === '' || isBoxFooterNotice(l)) continue;
    return undefined;
  }
  return undefined;
}

/** Text of the row's `<glyph> …` segment, the glyph opening the segment.
 *
 *  `undefined`, not the visible text, when the terminal CUT the segment: on a
 *  pane narrower than the row, Claude Code clips it at the pane's width and
 *  ends it with `…`, so the row's last segment is a prefix wearing a
 *  truncation mark. Read as a value, `⎇ ws/ccr…` became the session's branch,
 *  and the fleet card showed `ws/ccr…` as the workspace's name (measured
 *  2026-09-23 on four rows whose spawns ccd had stood down on as under
 *  READER_MIN_COLS, rc 6). Only the row's last segment can be the cut one; a
 *  `…` followed by `│` was drawn by the statusline itself. `includes`, not
 *  `endsWith`: none of the script's own segments carries a `…`, so a last
 *  segment holding one is cut whatever sits after the mark. */
function segmentAfter(row: string | undefined, glyph: string): string | undefined {
  if (row === undefined) return undefined;
  const parts = row.split(BOX_V);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.trim();
    if (!part.startsWith(glyph)) continue;
    const seg = part.slice(glyph.length).trim();
    if (!seg) return undefined;
    return i === parts.length - 1 && seg.includes(CUT) ? undefined : seg;
  }
  return undefined;
}
// Model row: everything after 🤖 up to the next box-vertical, then model ` · ` effort.
const MODEL_EFFORT_RE = /^(.+?)\s+·\s+(\S+)$/; // "Opus 4.8 (1M context) · xhigh"

/** The width of the prompt box whose bottom border sits directly above the
 *  statusline row at `at` — past an auto-continue footer between them — or
 *  `undefined` when no bare rule is there. */
function boxColsAbove(lines: string[], at: number): number | undefined {
  let i = at - 1;
  while (i >= 0 && isBoxFooterNotice(lines[i]!)) i--;
  const bottomRule = i >= 0 ? lines[i]!.trimEnd() : '';
  return RULE_RE.test(bottomRule) ? bottomRule.length : undefined;
}

/** True when the pane shows Claude Code's prompt box with the statusline row
 *  directly under its bottom border — the idle/working TUI, and never a menu:
 *  on 128 real 2.1.280 captures (both renderers, 100x24 to 220x50) every
 *  menu — permission, question, /model, /effort, trust — hid BOTH, and every
 *  idle pane showed both. `hasMenu` (dialog.ts) vetoes on it. */
export function promptBoxShowing(pane: string): boolean {
  const lines = pane.split('\n');
  return boxColsAbove(lines, statuslineRowAt(lines)) !== undefined;
}

export function parseStatusline(pane: string): Statusline {
  const lines = pane.split('\n');
  const at = statuslineRowAt(lines);
  const row = at === -1 ? undefined : lines[at]!.trim();
  const boxCols = boxColsAbove(lines, at);

  let model: string | undefined;
  let effort: string | undefined;
  const robotSeg = segmentAfter(row, ROBOT); // "Opus 4.8 (1M context) · xhigh"
  if (robotSeg) {
    const m = MODEL_EFFORT_RE.exec(robotSeg);
    if (m) { model = m[1]!.trim(); effort = m[2]!.trim(); } else { model = robotSeg; }
  }

  const branch = segmentAfter(row, BRANCH);

  // ultracode is on when the prompt box's TOP border carries the word. It used
  // to be any line holding a `─` and the word — so a diff or Read of this
  // repo's own statusline test fixture (`'──── … ultracode ─'`) set it, in any
  // fleet session editing that file. Now only the border the walk reaches
  // counts; no row, no reading (FleetWatcher keeps the last one, D-2012).
  const title = at === -1 ? undefined : topBorderTitle(lines, at);
  const ultracode = title !== undefined && /\bultracode\b/.test(title);

  // A running Workflow leaves the orchestrator reporting "idle" while it waits
  // on subagents — detect it so the session reads as busy, not finished.
  //
  // Read BELOW the statusline row only: Claude Code mounts the workflow row
  // after the footer (a real fleet capture has it under the `👤` row), and
  // nothing but footer chrome is ever drawn there — chat sits above the box.
  // A sentence quoting "2/4 agents done" used to hold an idle session `busy`.
  const workflowActive = at !== -1 && lines.slice(at + 1).some((l) => WORKFLOW_RE.test(l.trim()));

  const ctxPct = parseCtxPct(row);

  return { model, effort, ultracode, branch, workflowActive, ctxPct, boxCols };
}
