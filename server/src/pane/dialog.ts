import { createHash } from 'node:crypto';
import type { Dialog } from '../../../shared/api.js';

const BUSY_RE = /esc to interrupt/;
const MENU_RE = /Enter to (confirm|select)/;
const MULTISELECT_RE = /Space to select/;
/** A numbered menu option line, optionally carrying the ❯ selection marker. */
const OPTION_RE = /^\s*(❯)?\s*(\d+)\.\s+(.+)$/;
/** The ❯ cursor sitting on a NUMBERED option (`❯ 1. …`) — how a confirm/menu
 *  marks its selected row. Distinct from the input-box `❯ ` (space/text, no digit). */
const SELECTED_OPTION_RE = /^\s*❯\s*\d+\.\s/;
/** Any numbered option row, cursor or not. */
const NUMBERED_OPTION_RE = /^\s*(?:❯\s*)?\d+\.\s/;

export type PaneState = 'busy' | 'prompt' | 'menu' | 'other';

/**
 * Classify a captured pane. Order matters: busy overrides everything; menu is
 * checked before prompt because menus also use the ❯ marker on the selected row.
 */
export function paneState(pane: string): PaneState {
  if (BUSY_RE.test(pane)) return 'busy';
  if (MENU_RE.test(pane)) return 'menu';
  const lines = pane.split('\n');
  // Confirm dialogs (e.g. the /model and /effort switch prompts) put the ❯
  // cursor on a numbered option but have NO "Enter to select" footer, so they'd
  // otherwise read as a plain prompt and never surface in the PWA. Require the
  // cursor AND a second numbered option so a stray "❯ 1. …" typed at the input
  // prompt can't trip it.
  if (
    lines.some((l) => SELECTED_OPTION_RE.test(l)) &&
    lines.filter((l) => NUMBERED_OPTION_RE.test(l)).length >= 2
  ) {
    return 'menu';
  }
  // The input box marker is `❯` followed by either a space or a U+00A0
  // non-breaking space (empty box), so match the marker alone. Menus are already
  // handled above, so a bare `❯` here is the prompt.
  if (lines.some((l) => l.startsWith('❯'))) return 'prompt';
  return 'other';
}

const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex');

const unparsed = (raw: string): Dialog => ({
  id: sha1(raw), title: '', options: [], selectedIndex: 1, parsed: false, raw,
});

/**
 * Parse a menu dialog out of a captured pane; null when no menu is present.
 * Multi-select menus and menus without ≥2 consecutive numbered options come
 * back as `{ parsed: false, raw }` — terminal-drawer territory in v1.
 */
export function parseDialog(pane: string): Dialog | null {
  if (paneState(pane) !== 'menu') return null;
  if (MULTISELECT_RE.test(pane)) return unparsed(pane);

  // Collect every numbered-option line. Real AskUserQuestion menus put a
  // description line under each option and split the list across a horizontal
  // rule, so options are NOT adjacent — we can't require consecutive lines.
  const lines = pane.split('\n');
  type Opt = { line: number; index: number; label: string; selected: boolean };
  const found: Opt[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = OPTION_RE.exec(lines[i]!);
    if (m) found.push({ line: i, index: parseInt(m[2]!, 10), label: leftCol(m[3]!), selected: !!m[1] });
  }

  // Keep the longest run whose indices count 1,2,3,… — this rejects stray
  // numbered lines in scrollback and locks onto the actual menu (ties prefer the
  // later run, i.e. the one nearest the footer). Description/rule lines between
  // numbered options are simply absent from `found`, so they don't break the run.
  let best: Opt[] = [];
  let cur: Opt[] = [];
  for (const o of found) {
    if (o.index === cur.length + 1) {
      cur.push(o);
    } else {
      if (cur.length >= best.length) best = cur;
      cur = o.index === 1 ? [o] : [];
    }
  }
  if (cur.length >= best.length) best = cur;
  if (best.length < 2) return unparsed(pane);

  const start = best[0]!.line;
  const bounds = best.map((o) => o.line);
  // The footer ("Enter to select") bounds the LAST option's description.
  const footer = lines.findIndex((l, i) => i > bounds[bounds.length - 1]! && MENU_RE.test(l));

  // Some AskUserQuestion layouts are TWO-column: options on the left, and the
  // SELECTED option's detail in a box on the right (│┌└ borders). There the
  // "lines between options" are that box, not per-option prose — attributing it
  // per option garbles the sheet. Detect the box and, when present, only join
  // the wrapped LEFT-column label; the full detail rides `raw` (the sheet shows
  // it verbatim). One-column menus keep their per-option description prose.
  const region = lines.slice(start, footer >= 0 ? footer : lines.length).join('\n');
  const twoColumn = /[│┃┌┐└┘├┤]/.test(region);
  const options = best.map((o, k) => {
    const from = o.line + 1;
    const to = k + 1 < bounds.length ? bounds[k + 1]! : footer >= 0 ? footer : lines.length;
    const between = lines.slice(from, to).filter((l) => !isRule(l));
    if (twoColumn) {
      const cont = between.map(leftCol).filter(Boolean).join(' ');
      const label = [o.label, cont].filter(Boolean).join(' ');
      return { index: o.index, label, description: undefined };
    }
    const description = between
      .filter((l) => l.trim() !== '')
      .map((l) => l.trim())
      .join(' ')
      .trim();
    return { index: o.index, label: o.label, description: description || undefined };
  });
  const selectedIndex = best.find((o) => o.selected)?.index ?? 1;

  // Preamble block: everything from the dialog's upper box rule down to the first
  // option (capped so we never climb into unrelated conversation). This is the
  // fix for "I don't get the full question text".
  const bodyLines: string[] = [];
  for (let i = start - 1; i >= 0 && start - i <= 20; i--) {
    if (isRule(lines[i]!)) break;
    bodyLines.push(lines[i]!.replace(/^\s*[●✻☐☑]\s*/, '').trimEnd());
  }
  while (bodyLines.length && bodyLines[bodyLines.length - 1]!.trim() === '') bodyLines.pop();
  while (bodyLines.length && bodyLines[0]!.trim() === '') bodyLines.shift();
  const block = bodyLines.reverse(); // top-to-bottom preamble

  // Title + body. For AskUserQuestion menus (footer present) the nearest line
  // above the options is the short question, and the body is the whole preamble.
  // Footer-less confirm dialogs (/model, /effort switch) put paragraphs between
  // their header and the options, so the nearest line is preamble tail — use the
  // block's TOP line as the header (e.g. "Switch model?") and the rest as body.
  let title = '';
  let body: string | undefined;
  if (footer >= 0) {
    for (let i = start - 1; i >= 0; i--) {
      const t = lines[i]!.trim();
      if (t) { title = t.replace(/^[●✻☐☑]\s*/, ''); break; }
    }
    body = block.join('\n').trim() || undefined;
  } else {
    title = (block[0] ?? '').replace(/^[●✻☐☑]\s*/, '').trim();
    body = block.slice(1).join('\n').trim() || undefined;
  }

  const id = sha1(options.map((o) => o.label).join('\n') + title);
  return { id, title, body, options, selectedIndex, parsed: true, raw: pane };
}

/** A box-horizontal rule row (a run of `─`, the AskUserQuestion separators). */
function isRule(line: string): boolean {
  const t = line.trim();
  return t.length >= 8 && [...t].every((c) => c === '─' || c === ' ');
}

/** The LEFT column of an option/continuation row — the text before the detail
 *  box some AskUserQuestion layouts render beside the options (a run of 2+ spaces
 *  or a box-drawing border starts it). One-column labels have neither, so they
 *  pass through unchanged. */
function leftCol(s: string): string {
  const t = s.replace(/^\s+/, ''); // drop the row's own indent first
  const cut = t.search(/\s{2,}|[│┃┌┐└┘├┤┬┴┼╭╮╰╯]/);
  return (cut >= 0 ? t.slice(0, cut) : t).trim();
}
