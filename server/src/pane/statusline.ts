/**
 * Read a session's current model / effort / ultracode straight from the tmux
 * pane ccrc already captures for dialog detection — the only source that has
 * all three (the live-state pid.json carries none; ultracode is never written
 * to any file, it lives only on Claude Code's native mode-line).
 *
 * Two rows are parsed, both from a plain (`capture-pane -p`, ANSI-stripped)
 * capture:
 *   • the custom statusline row: `… │ 🤖 <model> · <effort> │ …`
 *     (this user's ~/.claude/statusline-command.sh format; the 🤖 segment is
 *      delimited by the box-vertical `│` and model/effort split on ` · `).
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
}

// The Workflow progress line in the pane: "◉ <name> … N/M agents done · …".
const WORKFLOW_RE = /\b\d+\/\d+\s+agents?\s+done\b/i;

const ROBOT = '🤖';
const BRANCH = '⎇'; // U+2387 branch glyph in the statusline
const BOX_V = '│'; // U+2502 segment separator
const BOX_H = '─'; // ─ mode-line divider
// U+2593 "▓ ctx <bar> NN%" (statusline-command.sh:171).
//
// CORRECTED: this used to be anchored on the GLYPH ALONE, on the argument
// that ▓ is rarer than the word "ctx" ccd's own scraper anchors on
// (`_pane_ctx_pct`, `ccd/ccd:12357`, `grep -aoiE 'ctx[^0-9]*[0-9]+%'`). That
// argument was WRONG on its own terms: `segmentAfter` scans the WHOLE pane
// top-down and returns the FIRST hit, exactly like ccd's word anchor —
// rarity of the token narrows the odds of a false hit, it does not change
// the failure mode. Measured against three shaped chat lines above a real
// statusline: a fabricated "▓▓▓▓▓▓░░ 95% done building" progress bar read as
// ctxPct 95; "▓ 88% coverage" read as 88; and inert "▓▓▓▓▓▓▓▓ block art, no
// percent here" ABOVE a statusline reading 91% returned `undefined`, which
// then (D-2012) actively CLEARED the last-known 91.
//
// The fix uses a fact neither anchor used: the statusline is the pane's
// BOTTOM row, so `parseCtxPct` below scans lines BOTTOM-UP — a fabricated
// hit higher in the scrollback cannot shadow the real segment sitting below
// it. And it requires the candidate segment to actually BE a ctx segment —
// the glyph AND the literal "ctx" token AND a TRAILING run of digits then
// `%` — so a chat line using ▓ for its own purposes, or a block-art line
// with the glyph but no "ctx"/no trailing percentage, is rejected outright
// rather than accepted because nothing else was found. `make_bar` renders
// █ (filled) and ░ (empty), never ▓, and the limits segment uses ⏳, so the
// glyph itself still narrows the search — this is defence in depth, not a
// replacement for the ▓ anchor, just no longer the ONLY defence.
//
// THE RESIDUAL, stated rather than hidden: bottom-up only protects the read
// when the REAL segment sits BELOW the impostor. A pane whose own statusline
// publishes NO ctx segment, with a line above it carrying the full
// `▓ ctx <bar> NN%` shape, still reads the impostor — measured at 95 on such
// a pane. Both halves are needed for that, and the first half is not exotic:
// measured live 2026-09-08, 1 of 6 gpt-lane panes published no ctx segment
// (`custom-tools-calm-river`, freshly compacted — Claude Code reports no
// `context_window.used_percentage` until the next turn measures one). It is
// left open deliberately: every further narrowing costs false NEGATIVES on a
// signal whose whole job is to be present when a session is in trouble, and
// ccd's own scraper — the one that actually fires `/compact` — carries the
// same exposure through a looser anchor. Close it only with a pane-structure
// fact, never by tightening the text match.
const CTX_GLYPH = '▓';
// A genuine `ctx <bar> NN%` segment body (the text after CTX_GLYPH, before
// the next │): the word "ctx", then eventually a trailing `NN%` with
// nothing but the bar's fill/empty cells (never digits) between them.
const CTX_SEGMENT_RE = /ctx\b.*\d+%$/i;

/** The context-pressure reading from the `▓ ctx <bar> NN%` segment, or
 *  `undefined` when this capture carried none — scanning BOTTOM-UP (the
 *  statusline is the pane's bottom row) and requiring the matched segment to
 *  pass `CTX_SEGMENT_RE`, so chat text or block art above the real
 *  statusline can neither impersonate it nor blind it. See CTX_GLYPH's
 *  comment above for the three measured false-reads this replaced. The
 *  percentage is the LAST run of digits in the segment — the bar's
 *  fill/empty cells between "ctx" and the number are never digits, so this
 *  survives any bar width/state. */
function parseCtxPct(lines: string[]): number | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const at = line.indexOf(CTX_GLYPH);
    if (at === -1) continue;
    const seg = line.slice(at + CTX_GLYPH.length).split(BOX_V)[0]!.trim();
    if (!seg || !CTX_SEGMENT_RE.test(seg)) continue;
    const matches = seg.match(/\d+(?=%)/g);
    if (!matches || matches.length === 0) continue;
    return parseInt(matches[matches.length - 1]!, 10);
  }
  return undefined;
}

/** Text of the `<glyph> … │` statusline segment that starts with `glyph`. */
function segmentAfter(lines: string[], glyph: string): string | undefined {
  for (const line of lines) {
    const at = line.indexOf(glyph);
    if (at === -1) continue;
    const seg = line.slice(at + glyph.length).split(BOX_V)[0]!.trim();
    if (seg) return seg;
  }
  return undefined;
}
// Model row: everything after 🤖 up to the next box-vertical, then model ` · ` effort.
const MODEL_EFFORT_RE = /^(.+?)\s+·\s+(\S+)$/; // "Opus 4.8 (1M context) · xhigh"

export function parseStatusline(pane: string): Statusline {
  const lines = pane.split('\n');

  let model: string | undefined;
  let effort: string | undefined;
  const robotSeg = segmentAfter(lines, ROBOT); // "Opus 4.8 (1M context) · xhigh"
  if (robotSeg) {
    const m = MODEL_EFFORT_RE.exec(robotSeg);
    if (m) { model = m[1]!.trim(); effort = m[2]!.trim(); } else { model = robotSeg; }
  }

  const branch = segmentAfter(lines, BRANCH);

  // ultracode is on when the native mode divider (a box-horizontal run) carries
  // the word. Requiring the divider context avoids a false hit from chat text
  // that merely mentions "ultracode".
  const ultracode = lines.some((l) => l.includes(BOX_H) && /\bultracode\b/.test(l));

  // A running Workflow leaves the orchestrator reporting "idle" while it waits
  // on subagents — detect it so the session reads as busy, not finished.
  const workflowActive = lines.some((l) => WORKFLOW_RE.test(l));

  const ctxPct = parseCtxPct(lines);

  return { model, effort, ultracode, branch, workflowActive, ctxPct };
}
