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
 *   • the native mode divider just above the `❯` prompt: a run of box-horizontal
 *     `─` carrying the current mode word, e.g. `───── ultracode ─`.
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
}

// The Workflow progress line in the pane: "◉ <name> … N/M agents done · …".
const WORKFLOW_RE = /\b\d+\/\d+\s+agents?\s+done\b/i;

const ROBOT = '🤖';
const BRANCH = '⎇'; // U+2387 branch glyph in the statusline
const BOX_V = '│'; // U+2502 segment separator
const BOX_H = '─'; // ─ mode-line divider
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
// (`statuslineRow`, below — the `👤`-led row is the pane-structure fact) and
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
function statuslineRow(lines: string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const row = lines[i]!.trim();
    if (row.startsWith(`${ACCOUNT} `)) return row;
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

export function parseStatusline(pane: string): Statusline {
  const lines = pane.split('\n');
  const row = statuslineRow(lines);

  let model: string | undefined;
  let effort: string | undefined;
  const robotSeg = segmentAfter(row, ROBOT); // "Opus 4.8 (1M context) · xhigh"
  if (robotSeg) {
    const m = MODEL_EFFORT_RE.exec(robotSeg);
    if (m) { model = m[1]!.trim(); effort = m[2]!.trim(); } else { model = robotSeg; }
  }

  const branch = segmentAfter(row, BRANCH);

  // ultracode is on when the native mode divider (a box-horizontal run) carries
  // the word. Requiring the divider context avoids a false hit from chat text
  // that merely mentions "ultracode".
  const ultracode = lines.some((l) => l.includes(BOX_H) && /\bultracode\b/.test(l));

  // A running Workflow leaves the orchestrator reporting "idle" while it waits
  // on subagents — detect it so the session reads as busy, not finished.
  const workflowActive = lines.some((l) => WORKFLOW_RE.test(l));

  const ctxPct = parseCtxPct(row);

  return { model, effort, ultracode, branch, workflowActive, ctxPct };
}
