import { createHash } from 'node:crypto';
import type { Dialog } from '../../../shared/api.js';

const BUSY_RE = /esc to interrupt/;
const MENU_RE = /Enter to (confirm|select)/;
const SGR = /\x1b\[[0-9;]*m/g; // any ANSI colour/attr code — same idiom as inject/send.ts:76
const MULTISELECT_RE = /Space to select/;
/** A numbered menu option line, optionally carrying the ❯ selection marker. */
const OPTION_RE = /^\s*(❯)?\s*(\d+)\.\s+(.+)$/;
/** The ❯ cursor sitting on a NUMBERED option (`❯ 1. …`) — how a confirm/menu
 *  marks its selected row. Distinct from the input-box `❯ ` (space/text, no digit). */
const SELECTED_OPTION_RE = /^\s*❯\s*\d+\.\s/;
/** Any numbered option row, cursor or not. */
const NUMBERED_OPTION_RE = /^\s*(?:❯\s*)?\d+\.\s/;
/** The ❯ cursor resting on an UNNUMBERED extra row ("❯ Chat about this"). */
const SELECTED_EXTRA_RE = /^\s*❯\s*\S/;

export type PaneState = 'busy' | 'prompt' | 'menu' | 'other';

/**
 * Classify a captured pane. Order matters: busy overrides everything; menu is
 * checked before prompt because menus also use the ❯ marker on the selected row.
 */
/**
 * Is a menu on screen? Deliberately independent of the busy check, because
 * callers that must not type into a menu (sendPrompt) cannot rely on
 * `paneState`: BUSY_RE tests the WHOLE pane, so one "esc to interrupt" left in
 * scrollback classifies a menu pane as busy and the menu branch never runs.
 */
export function hasMenu(pane: string): boolean {
  if (MENU_RE.test(pane)) return true;
  const lines = pane.split('\n');
  // Confirm dialogs (e.g. the /model and /effort switch prompts) put the ❯
  // cursor on a numbered option but have NO "Enter to select" footer, so they'd
  // otherwise read as a plain prompt and never surface in the PWA. Require the
  // cursor AND a second numbered option so a stray "❯ 1. …" typed at the input
  // prompt can't trip it.
  return (
    lines.some((l) => SELECTED_OPTION_RE.test(l)) &&
    lines.filter((l) => NUMBERED_OPTION_RE.test(l)).length >= 2
  );
}

export function paneState(pane: string): PaneState {
  if (BUSY_RE.test(pane)) return 'busy';
  if (hasMenu(pane)) return 'menu';
  // The input box marker is `❯` followed by either a space or a U+00A0
  // non-breaking space (empty box), so match the marker alone. Menus are already
  // handled above, so a bare `❯` here is the prompt.
  if (pane.split('\n').some((l) => l.startsWith('❯'))) return 'prompt';
  return 'other';
}

const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex');

const unparsed = (raw: string): Dialog => ({
  id: sha1(raw), title: '', options: [], selectedIndex: 1, parsed: false, raw,
});

/**
 * A multi-select row's leading checkbox (`[ ] Bash`, `[x] Edit`) — the row's
 * STATE, never part of its label. Single-select menus don't paint one.
 *
 * ASSUMPTION, and it is worth knowing where it came from: this pattern is
 * matched against ONE 116-byte synthetic fixture
 * (`test/fixtures/panes/multiselect.txt`), not a real capture — no multi-select
 * pane has been recorded off a live session yet. A build whose marker this
 * regex does not recognise (`(•)`, `☐`, a leading glyph instead of brackets)
 * leaves the marker on every label, every label then disagrees with the hook's
 * verbatim copy, and `inject/ask.ts`'s identity gate refuses EVERY multi-select
 * answer with `menu-mismatch`.
 *
 * That failure is fail-shut and therefore safe, but from the outside it looks
 * like a refusal storm on one question shape with nothing wrong on screen — so
 * start here, not at the gate. Stripping happens BEFORE `leftCol` for the same
 * class of reason: a TUI that aligns its labels with two spaces (`1. [ ]  Bash`)
 * would otherwise have `leftCol` cut the row at the space run, leaving `"[ ]"`
 * to be stripped down to the empty string that `pairMatches` rejects outright.
 */
const CHECKBOX_RE = /^\[[^\]]?\]\s*/;

/** One numbered row read off a pane menu: the digit it printed, its label
 *  (left column only — see `leftCol`), whether the ❯ cursor rests on it, and
 *  the line it came from. */
export type OptionRow = { line: number; index: number; label: string; selected: boolean };

/**
 * The pane's numbered menu rows, in screen order — the longest run whose
 * printed indices count 1,2,3,… .
 *
 * Split out of `parseDialog` so `inject/ask.ts` can compare the rows against
 * the labels it is about to answer WITHOUT going through `parseDialog`, which
 * discards options entirely for a multi-select pane (`MULTISELECT_RE` →
 * `unparsed`). That discard is right for rendering and wrong for a keystroke
 * gate: multi-select is exactly the shape `answerAsk` must still be able to
 * verify before it presses a digit.
 *
 * Says nothing about whether a menu is on screen — a pane with stray numbered
 * lines in scrollback yields rows too. Callers pair this with `hasMenu`.
 */
export function paneOptionRows(pane: string): OptionRow[] {
  // Real AskUserQuestion menus put a description line under each option and
  // split the list across a horizontal rule, so options are NOT adjacent —
  // we can't require consecutive lines.
  const lines = pane.split('\n');
  const found: OptionRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = OPTION_RE.exec(lines[i]!);
    if (m) {
      found.push({
        line: i, index: parseInt(m[2]!, 10),
        // Checkbox first, THEN the column cut — see CHECKBOX_RE's own comment
        // for what the other order costs on a two-space-aligned menu.
        label: leftCol(m[3]!.replace(CHECKBOX_RE, '')), selected: !!m[1],
      });
    }
  }

  // Keep the longest run whose indices count 1,2,3,… — this rejects stray
  // numbered lines in scrollback and locks onto the actual menu (ties prefer the
  // later run, i.e. the one nearest the footer). Description/rule lines between
  // numbered options are simply absent from `found`, so they don't break the run.
  let best: OptionRow[] = [];
  let cur: OptionRow[] = [];
  for (const o of found) {
    if (o.index === cur.length + 1) {
      cur.push(o);
    } else {
      if (cur.length >= best.length) best = cur;
      cur = o.index === 1 ? [o] : [];
    }
  }
  if (cur.length >= best.length) best = cur;
  return best;
}

/**
 * Parse a menu dialog out of a captured pane; null when no menu is present.
 * Multi-select menus and menus without ≥2 consecutive numbered options come
 * back as `{ parsed: false, raw }` — terminal-drawer territory in v1.
 */
export function parseDialog(pane: string): Dialog | null {
  // hasMenu, not paneState(pane) !== 'menu': the busy check must not veto a
  // menu parse (D-102). paneState tests BUSY_RE across the WHOLE pane, and an
  // RC-off pane renders the busy marker WHILE a dialog is painted alongside
  // it — a real, expected combined screen — so the old gate answered 'busy'
  // and refused to parse a dialog that was genuinely on screen. hasMenu is
  // deliberately independent of the busy check for exactly this reason
  // (:23-28 above); it's the same idiom inject/send.ts:320 uses. SGR strip
  // mirrors that idiom too — every current caller already captures pane text
  // without escape codes (tmux.capture, never captureAnsi), so this is
  // defensive idiom-consistency, not a behavior change today.
  if (!hasMenu(pane.replace(SGR, ''))) return null;
  if (MULTISELECT_RE.test(pane)) return unparsed(pane);

  const lines = pane.split('\n');
  const best = paneOptionRows(pane);
  if (best.length < 2) return unparsed(pane);

  const start = best[0]!.line;
  const bounds = best.map((o) => o.line);
  const lastLine = bounds[bounds.length - 1]!;
  // The footer ("Enter to select") bounds the LAST option's description.
  const footer = lines.findIndex((l, i) => i > lastLine && MENU_RE.test(l));
  const end = footer >= 0 ? footer : lines.length;

  // Newer AskUserQuestion layouts put extra selectable rows BELOW a horizontal
  // rule under the numbered list — "Chat about this" is the one that matters,
  // since it is how you answer in your own words. Everything from that rule to
  // the footer is therefore NOT the last option's description; treating it as
  // such appended "Notes: press n to add notes Chat about this" to the final
  // label. Split the region there: options above, extra rows below.
  let tail = lines.findIndex((l, i) => i > lastLine && i < end && isRule(l));
  if (tail < 0) tail = end;

  // Some AskUserQuestion layouts are TWO-column: options on the left, and the
  // SELECTED option's detail in a box on the right (│┌└ borders). There the
  // "lines between options" are that box, not per-option prose — attributing it
  // per option garbles the sheet. Detect the box and, when present, only join
  // the wrapped LEFT-column label; the full detail rides `raw` (the sheet shows
  // it verbatim). One-column menus keep their per-option description prose.
  const region = lines.slice(start, tail).join('\n');
  const twoColumn = /[│┃┌┐└┘├┤]/.test(region);
  // Where the right-hand detail box begins. Continuation text at or past it is
  // that box's content (or chrome aligned to it, like "Notes: press n to add
  // notes"), never a wrapped label — column position is the only thing that
  // tells them apart once the box borders are stripped.
  const gutter = twoColumn ? boxColumn(lines.slice(start, tail)) : Infinity;
  const options = best.map((o, k) => {
    const from = o.line + 1;
    const to = k + 1 < bounds.length ? bounds[k + 1]! : tail;
    const between = lines.slice(from, to).filter((l) => !isRule(l));
    if (twoColumn) {
      const cont = between
        .filter((l) => indentOf(l) < gutter)
        .map(leftCol)
        .filter(Boolean)
        .join(' ');
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

  // Unnumbered selectable rows between that rule and the footer, numbered on
  // after the real options so the arrow-walk reaches them the same way the TUI
  // does (they sit in its ↑/↓ order). "Chat about this" is the important one:
  // without it the sheet can only offer the canned answers, and answering in
  // your own words has to go through the terminal.
  let selectedExtra: number | null = null;
  for (let i = tail; i < end; i++) {
    const line = lines[i]!;
    if (isRule(line) || line.trim() === '') continue;
    const text = leftCol(line.replace(/^\s*❯\s*/, ''));
    if (text === '' || indentOf(line) >= gutter) continue;
    const index = options.length + 1;
    if (SELECTED_EXTRA_RE.test(line)) selectedExtra = index;
    options.push({ index, label: text, description: undefined });
  }

  const selectedIndex = selectedExtra ?? best.find((o) => o.selected)?.index ?? 1;

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
/** Column of a row's first non-space character; Infinity for a blank row. */
function indentOf(line: string): number {
  const i = line.search(/\S/);
  return i < 0 ? Infinity : i;
}

/** Column where the right-hand detail box starts, taken as the leftmost box
 *  border seen anywhere in the option region. Infinity when there is none. */
function boxColumn(region: string[]): number {
  let col = Infinity;
  for (const line of region) {
    const i = line.search(/[│┃┌┐└┘├┤┬┴┼╭╮╰╯]/);
    if (i >= 0 && i < col) col = i;
  }
  return col;
}

function leftCol(s: string): string {
  const t = s.replace(/^\s+/, ''); // drop the row's own indent first
  const cut = t.search(/\s{2,}|[│┃┌┐└┘├┤┬┴┼╭╮╰╯]/);
  return (cut >= 0 ? t.slice(0, cut) : t).trim();
}
