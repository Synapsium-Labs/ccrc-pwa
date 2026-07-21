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

  const options = best.map((o) => ({ index: o.index, label: o.label }));
  const selectedIndex = best.find((o) => o.selected)?.index ?? 1;
  const start = best[0]!.line;

  let title = '';
  for (let i = start - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    if (t) { title = t.replace(/^[●✻☐☑]\s*/, ''); break; }
  }

  const id = sha1(options.map((o) => o.label).join('\n') + title);
  return { id, title, options, selectedIndex, parsed: true, raw: pane };
}
