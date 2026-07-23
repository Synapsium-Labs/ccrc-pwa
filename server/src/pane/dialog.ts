import { createHash } from 'node:crypto';
import type { Dialog } from '../../../shared/api.js';

const BUSY_RE = /esc to interrupt/;
const MENU_RE = /Enter to (confirm|select)/;
const MULTISELECT_RE = /Space to select/;
/** A numbered menu option line, optionally carrying the ❯ selection marker. */
const OPTION_RE = /^\s*(❯)?\s*(\d+)\.\s+(.+)$/;

export type PaneState = 'busy' | 'prompt' | 'menu' | 'other';

/**
 * Classify a captured pane. Order matters: busy overrides everything; menu is
 * checked before prompt because menus also use the ❯ marker on the selected row.
 */
export function paneState(pane: string): PaneState {
  if (BUSY_RE.test(pane)) return 'busy';
  if (MENU_RE.test(pane)) return 'menu';
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
    if (m) found.push({ line: i, index: parseInt(m[2]!, 10), label: m[3]!.trim(), selected: !!m[1] });
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

  // Each option's description = the (usually wrapped) sub-text between its
  // numbered line and the next option's (or the footer for the last), with the
  // box-rule separators dropped. Real AskUserQuestion menus put a paragraph
  // under every option — without it the reader is choosing labels blind.
  const options = best.map((o, k) => {
    const from = o.line + 1;
    const to = k + 1 < bounds.length ? bounds[k + 1]! : footer >= 0 ? footer : lines.length;
    const description = lines
      .slice(from, to)
      .filter((l) => l.trim() !== '' && !isRule(l))
      .map((l) => l.trim())
      .join(' ')
      .trim();
    return { index: o.index, label: o.label, description: description || undefined };
  });
  const selectedIndex = best.find((o) => o.selected)?.index ?? 1;

  // Title: nearest non-empty line above the options (kept compact for chips).
  let title = '';
  for (let i = start - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    if (t) { title = t.replace(/^[●✻☐☑]\s*/, ''); break; }
  }

  // Body: the FULL question/preamble — everything from the dialog's upper box
  // rule down to the first option (capped so we never climb into unrelated
  // conversation). This is the fix for "I don't get the full question text".
  const bodyLines: string[] = [];
  for (let i = start - 1; i >= 0 && start - i <= 20; i--) {
    if (isRule(lines[i]!)) break;
    bodyLines.push(lines[i]!.replace(/^\s*[●✻☐☑]\s*/, '').trimEnd());
  }
  while (bodyLines.length && bodyLines[bodyLines.length - 1]!.trim() === '') bodyLines.pop();
  const body = bodyLines.reverse().join('\n').trim() || undefined;

  const id = sha1(options.map((o) => o.label).join('\n') + title);
  return { id, title, body, options, selectedIndex, parsed: true, raw: pane };
}

/** A box-horizontal rule row (a run of `─`, the AskUserQuestion separators). */
function isRule(line: string): boolean {
  const t = line.trim();
  return t.length >= 8 && [...t].every((c) => c === '─' || c === ' ');
}
