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

  // First run of ≥2 consecutive option lines.
  const lines = pane.split('\n');
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!OPTION_RE.test(lines[i]!)) continue;
    let j = i + 1;
    while (j < lines.length && OPTION_RE.test(lines[j]!)) j++;
    if (j - i >= 2) { start = i; end = j; break; }
    i = j;
  }
  if (start < 0) return unparsed(pane);

  const options: { index: number; label: string }[] = [];
  let selectedIndex = 1;
  for (let i = start; i < end; i++) {
    const m = OPTION_RE.exec(lines[i]!)!;
    const index = parseInt(m[2]!, 10);
    options.push({ index, label: m[3]!.trim() });
    if (m[1]) selectedIndex = index;
  }

  let title = '';
  for (let i = start - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    if (t) { title = t.replace(/^[●✻]\s*/, ''); break; }
  }

  const id = sha1(options.map((o) => o.label).join('\n') + title);
  return { id, title, options, selectedIndex, parsed: true, raw: pane };
}
