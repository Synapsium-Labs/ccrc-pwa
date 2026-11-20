// The map and report body's new sections (Linear hierarchy design §11.3 and §11.4, D-8186, D-8737's handover): counts first, then each
// programme's epics and checkpoints, then every issue grouped by class; the report's lists, each only when it holds something.
// Neutral fixtures: `prog-a`, `AAA-12`.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { MapCounts, MapEntry, MigrationStructure } from '../../shared/plan';
import { MigrationBody } from '../src/ledgers/MigrationBody';
import { MIGRATION_BODY_TEXT as W } from '../src/ledgers/migrationWords';

afterEach(cleanup);

const COUNTS: MapCounts = { created: 4, moved: 3, closed: 2, left: 1, skipped: 5 };
const ENTRIES: MapEntry[] = [
  { issue: '00000000-0000-4000-8000-000000000001', identifier: 'AAA-1', class: 'leaf', target: { programme: 'prog-a', epic: 'e-1' } },
  { issue: '00000000-0000-4000-8000-000000000002', identifier: 'AAA-2', class: 'stale' },
];
const STRUCTURE: MigrationStructure[] = [
  { programme: 'prog-a', title: 'Programme A', backlog: false, declared: true,
    epics: [{ key: 'e-1', title: 'First epic', checkpoints: [{ key: 'c-1', title: 'First checkpoint' }, { key: 'c-2', title: 'Second checkpoint' }] }, { key: 'e-2', title: 'Second epic', checkpoints: [] }] },
  { programme: 'prog-b', title: null, backlog: true, declared: false, epics: [] },
];
const after = (a: Element, b: Element): boolean => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const q = (c: HTMLElement, sel: string): HTMLElement => c.querySelector<HTMLElement>(sel)!;

describe('the map body\'s structure section', () => {
  it('comes after the counts and before the class groups, each programme with its epics and checkpoints', () => {
    const { container } = render(<MigrationBody kind="map" counts={COUNTS} entries={ENTRIES} structure={STRUCTURE} report={null} />);
    const counts = q(container, '[data-migration-counts]');
    const structure = q(container, '[data-migration-structure]');
    const group = q(container, '[data-migration-class]');
    expect(after(counts, structure)).toBe(true);
    expect(after(structure, group)).toBe(true);
    const progs = [...structure.querySelectorAll('[data-structure-programme]')];
    expect(progs.map((p) => p.getAttribute('data-structure-programme'))).toEqual(['prog-a', 'prog-b']);
    expect(progs[0]!.textContent).toContain('Programme A');
    expect(progs[0]!.textContent).toContain(W.declared);
    expect(progs[0]!.textContent).not.toContain(W.backlog);
    expect(progs[1]!.textContent).toContain('prog-b');
    expect(progs[1]!.textContent).toContain(W.backlog);
    expect([...progs[0]!.querySelectorAll('[data-structure-epic]')].map((e) => e.getAttribute('data-structure-epic'))).toEqual(['e-1', 'e-2']);
    expect([...progs[0]!.querySelectorAll('[data-structure-checkpoint]')].map((e) => e.textContent)).toEqual(
      [expect.stringContaining('First checkpoint'), expect.stringContaining('Second checkpoint')]);
    expect(progs[0]!.textContent).toContain('First epic');
  });

  it('is drawn for no programme when the map names none, and the old props still draw the counts and groups', () => {
    const { container } = render(<MigrationBody kind="map" counts={COUNTS} entries={ENTRIES} />);
    expect(container.querySelector('[data-migration-structure]')).toBeNull();
    expect(container.querySelector('[data-migration-counts]')).not.toBeNull();
    expect(container.querySelector('[data-migration-class]')).not.toBeNull();
  });
});

describe('the report body\'s lists', () => {
  const REPORT = { skipped: ['AAA-5'], waiting: ['AAA-6', 'AAA-7'], movedSince: [], milestonesLeft: ['Milestone one'] };
  it('lists skipped, waiting and milestones left, each only when it holds something', () => {
    const { container } = render(<MigrationBody kind="report" counts={COUNTS} entries={ENTRIES} structure={[]} report={REPORT} />);
    const lists = [...container.querySelectorAll('[data-report-list]')];
    expect(lists.map((l) => l.getAttribute('data-report-list'))).toEqual(['skipped', 'waiting', 'milestonesLeft']);
    expect(lists[1]!.textContent).toContain('AAA-6');
    expect(lists[1]!.textContent).toContain('AAA-7');
    expect(lists[2]!.textContent).toContain('Milestone one');
    expect(after(q(container, '[data-migration-counts]'), lists[0]!)).toBe(true);
  });

  it('after put back, the issues moved since are listed too', () => {
    const { container } = render(<MigrationBody kind="report" counts={COUNTS} entries={ENTRIES} report={{ ...REPORT, movedSince: ['AAA-9'] }} />);
    expect([...container.querySelectorAll('[data-report-list]')].map((l) => l.getAttribute('data-report-list'))).toEqual(['skipped', 'waiting', 'movedSince', 'milestonesLeft']);
  });

  it('a report with nothing to list draws no list, and a map draws no report lists', () => {
    const empty = { skipped: [], waiting: [], movedSince: [], milestonesLeft: [] };
    const a = render(<MigrationBody kind="report" counts={COUNTS} entries={ENTRIES} report={empty} />);
    expect(a.container.querySelector('[data-report-list]')).toBeNull();
    a.unmount();
    const b = render(<MigrationBody kind="map" counts={COUNTS} entries={ENTRIES} report={REPORT} />);
    expect(b.container.querySelector('[data-report-list]')).toBeNull();
  });
});
