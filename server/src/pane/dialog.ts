import { createHash } from 'node:crypto';
import type { Dialog } from '../../../shared/api.js';
import { promptBoxShowing } from './statusline.js';

const BUSY_RE = /esc to interrupt/;
/** Claude Code's own limit recovery is ARMED: the status line reads "Usage limit
 *  reached · continuing automatically at HH:MM · esc or type to cancel" (or
 *  "continuing shortly"). ANY keystroke cancels it — bundle 2.1.267,
 *  `tengu_quota_auto_resume_cancelled` reason `manual_submit` — and the
 *  continuation is discarded. The literal is ccd's `_pane_auto_continue_armed`
 *  verbatim; `auto-continue-armed.test.ts` reads that line and fails on drift
 *  (D-2367). */
export const AUTO_CONTINUE_RE = /continuing automatically|continuing shortly/i;
export function autoContinueArmed(pane: string): boolean { return AUTO_CONTINUE_RE.test(pane); }
const MENU_RE = /Enter to (confirm|select)/;
const SGR = /\x1b\[[0-9;]*m/g; // any ANSI colour/attr code — same idiom as inject/send.ts:80
const MULTISELECT_RE = /Space to select/;
/** A numbered menu option line, optionally carrying the ❯ selection marker.
 *  A list taller than its window marks its edge rows with a scroll arrow where
 *  the cursor would sit (`↓ 3. Fable` on a 24-row /model picker, 2.1.280), and
 *  that row is still an option. */
const OPTION_RE = /^\s*(❯)?\s*(?:[↑↓]\s*)?(\d+)\.\s+(.+)$/;
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
 *
 * Retained as the documented pane classifier (named in two shipped specs) and
 * for its own contract suite (`dialog.test.ts`), but has NO production caller
 * as of D-102: `parseDialog` and both display-path call sites (`sessionws.ts`,
 * `watch.ts`) now gate on `hasMenu` directly, precisely because this
 * function's busy-first ordering is wrong for them — see `hasMenu`'s own
 * docstring below for which three classes of caller that ordering fails, and
 * why. The consumers this docstring's ordering is load-bearing for today are
 * tests, not production code.
 */
/**
 * Is a menu on screen? Deliberately independent of the busy check, because
 * `paneState` cannot serve any of this function's three consumer classes:
 * BUSY_RE tests the WHOLE pane, so one "esc to interrupt" left in scrollback
 * classifies a menu pane as busy, and — depending on which way the caller
 * needs that answer to be wrong — either outcome is a bug. Callers that must
 * not TYPE into a menu (`inject/send.ts`'s `sendPrompt`/`clearBox`) cannot
 * treat a false 'busy' as safe-to-type. Callers that must not MISS a menu
 * (`sessionws.ts`'s `checkDialog`, `watch.ts`'s `detectDialogs` — the display
 * path) cannot treat it as safe-to-suppress. And `parseDialog` itself
 * (`:169` below) cannot let it veto a parse of a dialog that is genuinely on
 * screen, busy marker or not (D-102).
 */
export function hasMenu(pane: string): boolean {
  // THE PROMPT BOX WITH THE STATUSLINE ROW UNDER IT MEANS NO MENU IS UP. Both
  // arms below scan every line, so text ON SCREEN outside any menu tripped
  // them: a reply quoting "Enter to select · …", an echoed `❯ 1. alpha` over a
  // numbered reply, and a draft typed as `1. one` / `2. two` in the box itself
  // — 12 false menus across 128 real 2.1.280 captures, each refusing sends as
  // `dialog-open` and raising a question push, and a tap on the bogus sheet's
  // default row pressed Enter into the box. Every real menu in the same set
  // hid the box and the row (`promptBoxShowing`), so the arms now run only
  // when they are gone; a pane without the ccrc statusline gets no veto, which
  // is the old behaviour, and the failure direction stays "menu".
  if (promptBoxShowing(pane)) return false;
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
 * MEASURED on real Claude Code 2.1.280 captures (`cc280-multiselect*.txt`):
 * `[ ]` unticked, `[✔]` ticked. Only a box's STATES match — space, x, ✔, ✓,
 * `*` — so a single-select label that merely starts with a bracketed letter
 * (`[A] Alpha`) stays a label. It is also, since 2.1.280 dropped the "Space
 * to select" footer, the only mark `parseDialog` has that a menu is
 * multi-select. So a build whose marker this regex does not recognise (`(•)`,
 * `☐`, a leading glyph instead of brackets) fails two ways at once: the marker
 * stays on every label, so `inject/ask.ts`'s identity gate refuses every
 * multi-select answer with `menu-mismatch` (fail-shut); and `parseDialog`
 * reads the menu as SINGLE-select, so the scraped sheet — the one shown before
 * a hook envelope arrives — offers its rows as one-tap answers, each of which
 * ticks a box (fail-open; the envelope sheet has its own gate, the hook's
 * `multiSelect`). Start here, not at the gate. Stripping happens BEFORE
 * `leftCol` for the same
 * class of reason: a TUI that aligns its labels with two spaces (`1. [ ]  Bash`)
 * would otherwise have `leftCol` cut the row at the space run, leaving `"[ ]"`
 * to be stripped down to the empty string that `pairMatches` rejects outright.
 */
const CHECKBOX_RE = /^\[[ xX✔✓*]\]\s*/;

/** One numbered row read off a pane menu: the digit it printed, its label
 *  (left column only — see `leftCol`), whether the ❯ cursor rests on it,
 *  whether it painted a multi-select checkbox, and the line it came from. */
export type OptionRow = { line: number; index: number; label: string; selected: boolean; checkbox: boolean };

/**
 * The pane's numbered menu rows, in screen order — the run whose printed
 * indices count 1,2,3,… that holds the menu's cursor (see the selection below
 * for why neither the longest nor the lowest run will do).
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
  const found: { col: number; row: OptionRow }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = OPTION_RE.exec(lines[i]!);
    if (m) {
      found.push({
        // The digit's column: the prefix before it holds no digit.
        col: lines[i]!.indexOf(`${m[2]}.`),
        row: {
          line: i, index: parseInt(m[2]!, 10),
          // Checkbox first, THEN the column cut — see CHECKBOX_RE's own comment
          // for what the other order costs on a two-space-aligned menu.
          label: leftCol(m[3]!.replace(CHECKBOX_RE, '')), selected: !!m[1],
          checkbox: CHECKBOX_RE.test(m[3]!),
        },
      });
    }
  }

  // Runs whose indices count 1,2,3,…, kept PER DIGIT COLUMN: a menu prints
  // every option's digit in one column, and a numbered list inside an option's
  // description sits at the label's column, deeper — so it neither extends
  // nor breaks the menu's run. Description/rule lines are absent from `found`
  // and break nothing.
  const runs: { col: number; rows: OptionRow[] }[] = [];
  const open = new Map<number, OptionRow[]>();
  for (const { col, row } of found) {
    const cur = open.get(col) ?? [];
    if (row.index === cur.length + 1) {
      cur.push(row);
      open.set(col, cur);
      continue;
    }
    if (cur.length > 0) runs.push({ col, rows: cur });
    open.set(col, row.index === 1 ? [row] : []);
  }
  for (const [col, rows] of open) if (rows.length > 0) runs.push({ col, rows });

  // Which run is the menu? Neither the longest (a three-item reply above a
  // two-option permission prompt won, and the prompt's own rows came back as
  // "extras": twelve options, cursor on the tenth — `cc280-list-above-
  // permission.txt`) nor the lowest (a description's "1. …"/"2. …" rows under
  // the menu's last option won, and a tap on its first row pressed Enter on
  // the real cursor row — `cc280-description-steps*.txt`). The menu is where
  // its CURSOR is: the lowest `❯` on screen, since a menu that is up hides the
  // prompt box and everything above it is chat (prompt echoes included). On a
  // numbered row, its run is the menu. On an unnumbered row below the list
  // (or with no cursor at all), the menu is the lowest run at the shallowest
  // digit column — a description's list sits deeper, and chat above is higher.
  const cursor = lines.reduce((at, l, i) => (/^\s*❯/.test(l) ? i : at), -1);
  const holding = runs.find((r) => r.rows.some((o) => o.line === cursor));
  if (holding) return holding.rows;
  if (runs.length === 0) return [];
  const shallowest = Math.min(...runs.map((r) => r.col));
  return runs
    .filter((r) => r.col === shallowest)
    .reduce((a, r) => (r.rows.at(-1)!.line > a.rows.at(-1)!.line ? r : a)).rows;
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
  // (:33-45 above); it's the same idiom inject/send.ts:324 uses. SGR strip
  // mirrors that idiom too — every current caller already captures pane text
  // without escape codes (tmux.capture, never captureAnsi), so this is
  // defensive idiom-consistency, not a behavior change today.
  if (!hasMenu(pane.replace(SGR, ''))) return null;

  const lines = pane.split('\n');
  const best = paneOptionRows(pane);
  // A multi-select by its rows as well as its footer: 2.1.280 dropped "Space
  // to select" (its footer reads "Enter to select", and Enter on a row TOGGLES
  // that box — measured), so the footer test alone no longer fires and the
  // menu parsed as single-select. The checkboxes on the rows are the one mark
  // both shapes share. `parsed: false` is what keeps the scraped sheet from
  // offering its rows as one-tap answers (the envelope sheet also gates on the
  // hook's own `multiSelect`).
  const multiSelect = MULTISELECT_RE.test(pane) || best.filter((o) => o.checkbox).length >= 2;
  if (best.length < 2) return unparsed(pane);
  const width = paneWidth(lines);

  const start = best[0]!.line;
  const bounds = best.map((o) => o.line);
  const lastLine = bounds[bounds.length - 1]!;
  // The footer ("Enter to select") bounds the LAST option's description.
  const footer = lines.findIndex((l, i) => i > lastLine && MENU_RE.test(l));
  const end = footer >= 0 ? footer : lines.length;

  if (multiSelect) {
    // Unparsed, but with an id from what does not change while it is being
    // answered — its labels, box stripped, and its question — and that question
    // as its title. `unparsed`'s id hashes the whole pane, so every box ticked
    // and every cursor move in the terminal read as a new question and re-sent
    // the push (and with no title, as "Claude has a question").
    const { title, body } = header(lines, start, footer >= 0);
    return { ...unparsed(pane), id: sha1(best.map((o) => o.label).join('\n') + title), title, body };
  }

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
  const drafts = best.map((o, k) => {
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
      return { index: o.index, head: label, cont: [] as { text: string; glued: boolean }[], desc: [] as string[] };
    }
    // One column: the rows under an option are its description, with three
    // exceptions the real 2.1.280 menus need.
    //  - Text to the RIGHT of the label on the option's own row (the /model
    //    picker's second column; `leftCol` cut it off) starts the description.
    //  - A row that CONTINUES the label — see `continuesLabel` — is the label,
    //    wrapped. At 100 columns a permission prompt's path fills option 2's
    //    row and breaks mid-word, and a long question label word-wraps; both
    //    read as a one-line label plus a "description".
    //  - A row indented LEFT of the label column belongs to no option: the
    //    permission footer ("Esc to cancel · Tab to amend"), /model's effort
    //    row and its "… +3 models" hint, /theme's preview box all sit there,
    //    and each used to end up as the last option's description.
    const row = lines[o.line]!;
    const col = labelColumn(row);
    const right = rightOfLabel(row);
    const cont: { text: string; glued: boolean }[] = [];
    let prev = row;
    while (cont.length < between.length && continuesLabel(prev, between[cont.length]!, col, width)) {
      const next = between[cont.length]!;
      cont.push({ text: next.trim(), glued: hardSplit(prev, next, col, width) });
      prev = next;
    }
    const desc = [right, ...between.slice(cont.length).filter((l) => l.trim() !== '' && indentOf(l) >= col).map((l) => l.trim())]
      .filter(Boolean);
    return { index: o.index, head: o.label, cont, desc };
  });
  // The wrap test's known miss (`continuesLabel`): a one-row label that ends
  // near the edge takes its description — every row of it, since each wrapped
  // description row chains the test on. Question options nearly always carry
  // a description, so an option left with NONE while another in the same menu
  // has one gives ALL its taken rows back: its label is its first row and the
  // rest is its description, exactly as before labels were joined (the real
  // 2.1.280 screens `cc280-label-near-edge-*.txt`). What that costs: an option
  // whose description is empty and whose label wraps shows its label's first
  // row only, with the rest as a description — which still prefix-matches the
  // hook's label. A menu with no descriptions at all (a permission prompt)
  // keeps every row it wrapped.
  const described = drafts.some((d) => d.desc.length > 0);
  const options = drafts.map((d) => {
    const giveBack = described && d.desc.length === 0 && d.cont.length > 0;
    const cont = giveBack ? [] : d.cont;
    const desc = giveBack ? d.cont.map((c) => c.text) : d.desc;
    const label = cont.reduce((l, c) => l + (c.glued ? '' : ' ') + c.text, d.head);
    return { index: d.index, label, description: desc.join(' ').trim() || undefined };
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

  const { title, body } = header(lines, start, footer >= 0);
  const id = sha1(options.map((o) => o.label).join('\n') + title);
  return { id, title, body, options, selectedIndex, parsed: true, raw: pane };
}

/** The dialog's title and body, read upward from its first option row. */
function header(lines: string[], start: number, hasFooter: boolean): { title: string; body: string | undefined } {
  // Preamble block: everything from the dialog's upper box rule down to the first
  // option (capped so we never climb into unrelated conversation). This is the
  // fix for "I don't get the full question text".
  const bodyLines: string[] = [];
  for (let i = start - 1; i >= 0 && start - i <= 20; i--) {
    if (isRule(lines[i]!) || isOverlayEdge(lines[i]!)) break;
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
  if (hasFooter) {
    let title = '';
    for (let i = start - 1; i >= 0; i--) {
      const t = lines[i]!.trim();
      if (t) { title = t.replace(/^[●✻☐☑]\s*/, ''); break; }
    }
    return { title, body: block.join('\n').trim() || undefined };
  }
  return {
    title: (block[0] ?? '').replace(/^[●✻☐☑]\s*/, '').trim(),
    body: block.slice(1).join('\n').trim() || undefined,
  };
}

/** A box-horizontal rule row (a run of `─`, the AskUserQuestion separators). */
function isRule(line: string): boolean {
  const t = line.trim();
  return t.length >= 8 && [...t].every((c) => c === '─' || c === ' ');
}

/** The fullscreen renderer's overlay top edge: a run of `▔` where the classic
 *  renderer draws its `─` rule. Its LAST character is what every real one
 *  shares: it may carry a badge at its right end (`▔▔…▔ ● high · /effort ▔`),
 *  and at 100 columns a tmux hint can overwrite everything but that last `▔`
 *  (` tmux detected · … wheel scroll ▔`, 2.1.280 `/effort` captures). Without
 *  it the header climb ran up past the dialog into chat, and "Change effort
 *  level?" was titled with the edge itself or with a chat line. */
function isOverlayEdge(line: string): boolean {
  return /▔\s*$/.test(line);
}

/** The pane's width, read off its widest `─` rule: on every real 2.1.280
 *  capture of a menu whose labels can wrap (question menus and permission
 *  prompts, both renderers, 100 to 220 columns) the widest rule spans the pane
 *  exactly. Widest, because chat above a menu can hold a shorter rule of its
 *  own. Infinity when none is on screen (the fullscreen /model and effort
 *  dialogs draw a `▔` edge instead, and their labels do not wrap), which turns
 *  the wrap test in `continuesLabel` off rather than guessing a width. */
function paneWidth(lines: string[]): number {
  let w = 0;
  for (const l of lines) if (isRule(l)) w = Math.max(w, l.length);
  return w > 0 ? w : Infinity;
}

/** Column where an option row's label text starts (after `❯ N. `). */
function labelColumn(row: string): number {
  const m = OPTION_RE.exec(row);
  return m ? row.length - m[3]!.length : indentOf(row);
}

/** The text an option row carries to the RIGHT of its label, past the column
 *  gap `leftCol` cuts at; '' when the row is one column. */
function rightOfLabel(row: string): string {
  const m = OPTION_RE.exec(row);
  if (!m) return '';
  const t = m[3]!.replace(CHECKBOX_RE, '');
  const cut = t.search(/\s{2,}|[│┃┌┐└┘├┤┬┴┼╭╮╰╯]/);
  return cut >= 0 ? t.slice(cut).trim() : '';
}

/** Does `row` continue the label `prev` ended? Only at the label's own column
 *  (a wrapped label resumes there), and only when `prev` could not have held
 *  `row`'s first word — the test a word wrap applies.
 *
 *  NOT exact, and the miss has a known direction. A description also starts
 *  at the label's column, and when a one-row label happens to end within a
 *  word of the edge, its description's first row passes the same test: the TUI
 *  draws a description dim, and a plain capture drops that. `parseDialog`
 *  undoes the common case (an option left with no description gives its last
 *  taken row back); where it cannot, the label carries extra text, which keeps
 *  the hook's own label a prefix of it, so `DialogSheet.tsx`'s
 *  `questionCorresponds` still lines up — and `inject/ask.ts` reads
 *  `paneOptionRows`, which never joins rows. */
function continuesLabel(prev: string, row: string, col: number, width: number): boolean {
  if (row.trim() === '' || indentOf(row) !== col) return false;
  const first = row.trim().split(/\s/)[0]!;
  return prev.length >= width || prev.length + 1 + first.length > width;
}

/** Was the break between `prev` and `row` INSIDE one token, so the two halves
 *  join with no space? Only when `prev` fills the pane AND the token it ends
 *  with, run on into `row`'s first, could not fit one wrapped row by itself —
 *  the only case a word wrap cuts a word (a path longer than the row). A row
 *  that fills the pane by ending on a whole short word is an ordinary wrap, and
 *  gluing there turned "report the" + "new build" into "thenew", a label the
 *  hook's own copy no longer prefix-matches.
 *
 *  NOT exact either: a long WHOLE token that happens to end exactly at the
 *  edge, followed by a word that together with it would not fit a row, looks
 *  the same as a cut token on plain text, and is glued. Cut paths are the
 *  common case (a permission prompt at 100 columns); the exact-fit one costs
 *  the envelope sheet its match, which fails to "answer on the terminal". */
function hardSplit(prev: string, row: string, col: number, width: number): boolean {
  if (prev.length < width) return false;
  const tail = prev.trimEnd().split(/\s/).at(-1)!;
  const head = row.trim().split(/\s/)[0]!;
  return tail.length + head.length > width - col;
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
