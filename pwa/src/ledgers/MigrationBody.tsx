// The map and report body (Linear hierarchy design §11.3 and §11.4, D-8184, D-8737): counts first, then one group per class.
// One component over `MapCounts` and `MapEntry` for both the map approval and the migration report. Width table: 360 and 390 the
// groups collapsed, 1280 and 1470 open in two columns, 1920 a table (issue, class, target). Every name is plain text that wraps.
// The table and the lists are both in the markup and CSS shows one; the `<details>` are open from the wide widths up by
// `MigrationBody`'s own matchMedia read, so no engine-less test depends on it.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { MapCounts, MapEntry } from '../../../shared/plan';
import { MAP_CLASS_WORDS, MIGRATION_BODY_TEXT as W, countWords, groupEntries, targetWords } from './migrationWords';
import './ledgers.css';

const WIDE = '(min-width: 1280px)';
const wideNow = (): boolean => typeof matchMedia === 'function' && matchMedia(WIDE).matches;

export function MigrationBody({ counts, entries, kind }: { counts: MapCounts; entries: readonly MapEntry[]; kind: 'map' | 'report' }): ReactNode {
  const [wide, setWide] = useState(wideNow);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia(WIDE);
    const on = (): void => setWide(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  const groups = groupEntries(entries);
  return (
    <section className="wm" data-migration={kind} aria-label={kind === 'map' ? W.map : W.report}>
      <ul className="wm-counts" data-migration-counts>
        {countWords(counts).map((c) => <li key={c.key} data-count={c.key}><b>{c.n}</b> {c.word}</li>)}
      </ul>
      {groups.map((g) => (
        <details key={g.class} className="wm-group" data-migration-class={g.class} open={wide}>
          <summary className="wm-sum">{MAP_CLASS_WORDS[g.class]} <span className="wm-n">{g.entries.length}</span></summary>
          <ul className="wm-list">
            {g.entries.map((e) => (
              <li key={e.issue} className="wm-issue"><span className="wm-id">{e.identifier}</span>{' '}<span className="wm-target">{targetWords(e.target)}</span></li>
            ))}
          </ul>
        </details>
      ))}
      <table className="wm-table" data-migration-table>
        <thead><tr><th scope="col">{W.issue}</th><th scope="col">{W.class}</th><th scope="col">{W.target}</th></tr></thead>
        <tbody>
          {groups.flatMap((g) => g.entries).map((e) => (
            <tr key={e.issue}><td className="wm-id">{e.identifier}</td><td>{MAP_CLASS_WORDS[e.class]}</td><td className="wm-target">{targetWords(e.target)}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
