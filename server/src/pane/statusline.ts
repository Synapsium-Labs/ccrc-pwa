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
}

const ROBOT = '🤖';
const BRANCH = '⎇'; // U+2387 branch glyph in the statusline
const BOX_V = '│'; // U+2502 segment separator
const BOX_H = '─'; // ─ mode-line divider

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

  return { model, effort, ultracode, branch };
}
