// Console speed, task C1 (the link and the start): seven big screens load on demand (spec 2026-11-04 §2.3). The entry
// imports none of them statically; a route that opens one shows the loading line, then the screen; a chunk that fails
// to load throws into the detail boundary, whose fallback is drawn instead of a blank pane.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { act, cleanup, render, screen } from '@testing-library/react';

/** The lazy screens (the seven of C1, and Advanced beside Runs, D-8073), by module path as `app.tsx` names them. */
const LAZY = [
  './screens/SessionScreen',
  './screens/settings/SettingsFrame',
  './screens/AccountsScreen',
  './screens/RunsScreen',
  './screens/RunsAdvancedScreen',
  './screens/DigestScreen',
  './screens/HighlightMeasure',
  './screens/ReaderLab',
] as const;

/** The screens that stay in the entry (spec §2.3): Docs, the programme, Mail, Archive and the Waiting routes. */
const EAGER = ['./screens/DocsScreen', './ledgers/ProgrammeScreen', './screens/MailScreen', './screens/ArchiveScreen',
  './ledgers/WaitingRoutes'] as const;

vi.mock('../src/screens/RunsScreen', () => ({ RunsScreen: (): ReactNode => <h1>runs (stand-in)</h1> }));
vi.mock('../src/screens/AccountsScreen', () => {
  throw new Error('Failed to fetch dynamically imported module');
});
/** The Digest's chunk fails to load while `offline` holds, and loads once it is lifted (review 1464 F2). React retries
 *  a failed render once by itself, so the failure is a state, not a count. */
const digestLink = vi.hoisted(() => ({ offline: false, loads: 0 }));
vi.mock('../src/screens/DigestScreen', () => {
  digestLink.loads += 1;
  if (digestLink.offline) throw new Error('Failed to fetch dynamically imported module');
  return { DigestScreen: (): ReactNode => <h1>digest (stand-in)</h1> };
});

const APP = readFileSync(path.join(__dirname, '../src/app.tsx'), 'utf8');
/** Every module specifier a static statement names (review 1473 F7): `import … from`, a bare `import '…'`, and
 *  `export … from` (a re-export loads the module as surely), in either quote, with or without a trailing semicolon,
 *  however many share a line, a type-only one included (it loads nothing, but none of the seven is imported for a type
 *  either). Read from `app.tsx` alone: no other module imports the seven. */
const staticImports = (src: string): string[] =>
  [...src.matchAll(/(?:^|;)[ \t]*(?:import|export)\s+(?:type\s+)?(?:[^;'"`()]*?\bfrom\s*)?(['"])([^'"\n]+)\1/gm)]
    .map((m) => m[2] as string);
/** Every specifier a dynamic `import(…)` names, spaced or across lines, in any quote, and every `import.meta.glob`
 *  pattern, so a glob that reaches a screen shows in the list the case compares with the seven. */
const dynamicImports = (src: string): string[] => [
  ...[...src.matchAll(/\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*[,)]/g)].map((m) => m[2] as string),
  ...[...src.matchAll(/\bimport\.meta\.glob\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2] as string),
];

describe('the entry does not carry the seven screens', () => {
  it('CONTROL: the scanners read every static and dynamic form', () => {
    expect(staticImports([
      "import { A } from './a';",
      'import type {\n  B,\n} from "./b"',
      "import './c.css';",
      "export { D } from './d'; export * from './e'",
      "export * as F from './f'",
      "import G from './g'; import H from './h';",
      "export const notAnImport = 'x';",
      "export function alsoNot(): string { return 'y'; }",
    ].join('\n'))).toEqual(['./a', './b', './c.css', './d', './e', './f', './g', './h']);
    expect(dynamicImports([
      "const A = lazy(() => import('./a').then((m) => m));",
      'const B = lazy(() => import ( "./b" ));',
      'const C = lazy(() => import(\n  `./c`\n));',
      "const D = import.meta.glob('./screens/*.tsx');",
    ].join('\n'))).toEqual(['./a', './b', './c', './screens/*.tsx']);
  });

  it('app.tsx imports none of the seven screens statically, and each only by its own dynamic import', () => {
    const statics = staticImports(APP);
    expect(statics.length).toBeGreaterThan(10);
    expect(statics.filter((s) => (LAZY as readonly string[]).includes(s))).toEqual([]);
    expect(dynamicImports(APP).sort()).toEqual([...LAZY].sort());
  });

  it('the session screen is preloaded once the page is idle after its first paint (review 1464 F4)', () => {
    expect(APP).toMatch(/useEffect\(\(\) => preloadWhenIdle\(SessionScreen\), \[\]\);/);
  });

  it('the screens that stay eager are still static imports', () => {
    expect(EAGER.filter((s) => !staticImports(APP).includes(s))).toEqual([]);
  });
});

describe('the loading line', () => {
  // Review 1464 F9: the line reuses `.shell-placeholder-copy`, which once had a rule only inside the desktop media
  // block, so a phone drew it as a bare paragraph.
  it('is styled at every width: its class has a rule outside any @media block', () => {
    const css = postcss.parse(readFileSync(path.join(__dirname, '../src/styles/shell.css'), 'utf8'));
    const top: string[] = [];
    css.walkRules((r) => { if (r.selector === '.shell-placeholder-copy' && r.parent?.type === 'root') top.push(r.toString()); });
    expect(top).toHaveLength(1);
    expect(top[0]).toContain('font-family: var(--family-mono)');
  });
});

// A fresh import of the whole app graph per case: seconds on a loaded box, so a longer limit than vitest's 5 s.
describe('a lazy route', { timeout: 30_000 }, () => {
  let warn: MockInstance<typeof console.warn>;
  let error: MockInstance<typeof console.error>;
  beforeEach(() => {
    // A fresh module graph per case, so each case is the first load of its chunk.
    vi.resetModules();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    cleanup();
    const { navigate } = await import('../src/lib/router');
    navigate('/');
    warn.mockRestore();
    error.mockRestore();
  });

  it('navigating to /runs shows the fallback, then the screen', async () => {
    const { App } = await import('../src/app');
    const { navigate } = await import('../src/lib/router');
    render(<App />);
    act(() => { navigate('/runs'); });
    const pane = document.querySelector('.shell-detail') as HTMLElement;
    expect(pane).toContainElement(screen.getByText('Loading…'));
    expect(screen.getByText('Loading…')).toHaveAttribute('role', 'status');
    expect(screen.queryByText('This screen could not be shown.')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'runs (stand-in)' })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('a chunk that fails to load shows the detail boundary’s fallback, not a blank pane', async () => {
    const { App } = await import('../src/app');
    const { navigate } = await import('../src/lib/router');
    render(<App />);
    act(() => { navigate('/accounts'); });
    const pane = document.querySelector('.shell-detail') as HTMLElement;
    expect(pane).toContainElement(await screen.findByText('This screen could not be loaded.'));
    expect(screen.getByRole('button', { name: 'Back to the fleet' })).toBeInTheDocument();
    expect(document.querySelector('.shell-nav'), 'the shell stays').not.toBeNull();
    expect(warn).toHaveBeenCalledWith('ccrc: render error in detail', expect.anything());
    expect(screen.getByRole('button', { name: 'Reload' }), 'a chunk that failed to load offers Reload').toBeInTheDocument();
  });

  // The stand-in's loader is asked again; a real engine may answer from its failed-module memory instead (Chromium
  // does), and then Reload is the recovery (review 1473 F1).
  it('a chunk that failed is asked for once more on the next navigation, where the engine fetches it again', { timeout: 30_000 }, async () => {
    digestLink.offline = true;
    digestLink.loads = 0;
    const { App } = await import('../src/app');
    const { navigate } = await import('../src/lib/router');
    render(<App />);
    act(() => { navigate('/digest'); });
    expect(await screen.findByText('This screen could not be loaded.')).toBeInTheDocument();
    const failedLoads = digestLink.loads;
    expect(failedLoads).toBeGreaterThan(0);
    digestLink.offline = false;
    act(() => { navigate('/'); });
    act(() => { navigate('/digest'); });
    expect(await screen.findByRole('heading', { name: 'digest (stand-in)' })).toBeInTheDocument();
    expect(digestLink.loads, 'the chunk was asked for again, in the same page').toBeGreaterThan(failedLoads);
  });
});
