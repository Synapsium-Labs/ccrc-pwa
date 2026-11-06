// The arrival at a row (ring L4: a hook). Extracted unchanged from `AccountsScreen`'s lane arrival (T2c, D-6329, Q14) so the
// runs board's `?run=` (chat reading Task L, D-8062) and the accounts screen's `?lane=` share one mechanism, not two copies.
import { useEffect, useRef, useState } from 'react';

/** Arrive at the row keyed `key`: scroll it into view at `block: 'start'`, focus it without scrolling, and answer its key, which
 *  the screen draws as `data-arrived`. A PASSIVE effect, never a layout one: the shell's pane reset to the top (app.tsx) is a
 *  layout effect that runs on every path or search change, and layout effects run child before parent, so an arrival made in a
 *  layout effect would be undone by it. It is keyed on the key AND on whether its row exists (`rowExists`), because a screen
 *  draws its rows only once its read lands: an arrival at mount finds no row, and the same effect finishes the job when the
 *  read brings it. The last key arrived at is held, so each value arrives once and a re-render never moves focus again; a
 *  second value on the same mount arrives once. No key, or a key with no row, clears the mark and the record, so a later
 *  return to the key that was arrived at arrives again (the shell's reset will have put the pane back at the top). `rows` is
 *  the screen's own map of its mounted rows, read when the effect runs. `hold` (the runs board's, review 1586 F4): while the
 *  row arrived at is missing only because it is moving (a run that closed, between its active row and its Finished one), the
 *  mark and the record stay, so the row it comes back as is marked and never arrived at twice. Accounts passes none. */
export function useArrival<K>(key: K | null, rowExists: boolean, rows: ReadonlyMap<K, HTMLElement>, hold = false): K | null {
  const arrivedAt = useRef<K | null>(null);
  const [arrived, setArrived] = useState<K | null>(null);
  useEffect(() => {
    if (!rowExists && hold && key !== null && arrivedAt.current === key) return;
    if (!rowExists || key === null) { arrivedAt.current = null; setArrived(null); return; }
    if (arrivedAt.current === key) return;
    const row = rows.get(key);
    if (row === undefined) return;
    arrivedAt.current = key;
    row.scrollIntoView({ block: 'start' });
    row.focus({ preventScroll: true });
    setArrived(key);
  }, [key, rowExists, hold]);
  return arrived;
}
