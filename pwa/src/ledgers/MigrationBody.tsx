// The map and report body (Linear hierarchy design §11.3 and §11.4, D-8184, D-8186, D-8737): counts first, then (the map) each
// programme's epics and checkpoints or (the report) its lists, then one group per class.
// One component over `MapCounts` and `MapEntry` for both the map approval and the migration report. Width table: 360 and 390 the
// groups collapsed, 1280 and 1470 open in two columns, 1920 a table (issue, class, target). Every name is plain text that wraps.
// The table and the lists are both in the markup and CSS shows one; the `<details>` are open from the wide widths up by
// `MigrationBody`'s own matchMedia read, so no engine-less test depends on it.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { MapCounts, MapEntry, MigrationView } from '../../../shared/plan';
import { MAP_CLASS_WORDS, MIGRATION_BODY_TEXT as W, countWords, groupEntries, reportLists, targetWords } from './migrationWords';
import './ledgers.css';
import './migration.css';

const WIDE = '(min-width: 1280px)';
const wideNow = (): boolean => typeof matchMedia === 'function' && matchMedia(WIDE).matches;

export function MigrationBody({ counts, entries, kind, structure = [], report = null }: {
  counts: MapCounts; entries: readonly MapEntry[]; kind: 'map' | 'report';
  structure?: MigrationView['structure']; report?: MigrationView['report'];
}): ReactNode {
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
      {kind === 'map' && structure.length > 0 && (
        <section className="wm-structure" data-migration-structure aria-label={W.structure}>
          <h4 className="wm-sum">{W.structure}</h4>
          <ul className="wm-plain">
            {structure.map((p) => (
              <li key={p.programme} className="wm-prog" data-structure-programme={p.programme}>
                <span className="wm-sum">{p.title ?? p.programme}</span>
                {p.backlog && <> <span className="wm-target">{W.backlog}</span></>}
                {p.declared && <> <span className="wm-target">{W.declared}</span></>}
                {p.epics.length === 0 ? <p className="wm-target">{W.noEpics}</p> : (
                  <ul className="wm-plain">
                    {p.epics.map((e) => (
                      <li key={e.key} className="wm-epic" data-structure-epic={e.key}>
                        {e.title} <span className="wm-id">{e.key}</span>
                        {e.checkpoints.length > 0 && (
                          <ul className="wm-plain" aria-label={W.checkpoints}>
                            {e.checkpoints.map((c) => <li key={c.key} data-structure-checkpoint={c.key}>{c.title} <span className="wm-id">{c.key}</span></li>)}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {kind === 'report' && reportLists(report).map((l) => (
        <section key={l.key} className="wm-rlist" data-report-list={l.key} aria-label={l.title}>
          <h4 className="wm-sum">{l.title} <span className="wm-n">{l.items.length}</span></h4>
          <ul className="wm-plain">{l.items.map((x) => <li key={x} className="wm-id">{x}</li>)}</ul>
        </section>
      ))}
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
