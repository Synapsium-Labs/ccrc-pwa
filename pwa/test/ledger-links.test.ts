// The ledgers' links (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D26 to D28): `linkRuns` splits an item's text into
// text and link runs, and the address builders give the one Docs reader address of a document and of a programme's pinned spec.
import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../shared/api';
import type { GoalsView } from '../../shared/ledgers';
import { docHref, homeProjectOf, linkRuns, programmeSpecHref, specHref, type LinkRun } from '../src/ledgers/ledgerLinks';

const HOME = 'project-a';
const links = (runs: readonly LinkRun[]) => runs.filter((r) => r.kind === 'link');
const joined = (runs: readonly LinkRun[]) => runs.map((r) => r.text).join('');

describe('linkRuns: https, console paths and document paths in item text are links', () => {
  it('an https address is an outside link, its text kept as written', () => {
    const runs = linkRuns('see https://example.com/a?b=1#c for it', HOME);
    expect(runs).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'https://example.com/a?b=1#c', href: 'https://example.com/a?b=1#c', external: true },
      { kind: 'text', text: ' for it' },
    ]);
  });

  it('a link at the very start and at the very end of the text', () => {
    expect(linkRuns('https://example.com/x', HOME)).toEqual([
      { kind: 'link', text: 'https://example.com/x', href: 'https://example.com/x', external: true },
    ]);
    const end = linkRuns('open /waiting/12', HOME);
    expect(end.at(-1)).toEqual({ kind: 'link', text: '/waiting/12', href: '/waiting/12', external: false });
    const start = linkRuns('docs/superpowers/specs/a.md is the spec', HOME);
    expect(start[0]).toEqual({ kind: 'link', text: 'docs/superpowers/specs/a.md', href: '/docs/project-a/specs/a.md', external: false });
  });

  it('a mixed-case https scheme is still https; the address is the parsed one', () => {
    const [run] = links(linkRuns('HtTpS://Example.COM/Path', HOME));
    expect(run).toEqual({ kind: 'link', text: 'HtTpS://Example.COM/Path', href: 'https://example.com/Path', external: true });
  });

  it('trailing sentence punctuation and an unmatched closing bracket stay text', () => {
    const runs = linkRuns('(read https://example.com/a). Then https://example.com/b, done.', HOME);
    expect(links(runs).map((r) => r.text)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(joined(runs)).toBe('(read https://example.com/a). Then https://example.com/b, done.');
    expect(links(linkRuns('https://en.example.org/wiki/A_(b)', HOME))[0]?.text).toBe('https://en.example.org/wiki/A_(b)');
  });

  it('a console path is an in-console link; a path the console does not route stays text', () => {
    expect(links(linkRuns('go to /programmes/build-4 or /docs', HOME))).toEqual([
      { kind: 'link', text: '/programmes/build-4', href: '/programmes/build-4', external: false },
      { kind: 'link', text: '/docs', href: '/docs', external: false },
    ]);
    expect(links(linkRuns('not /etc/passwd, not / alone, not //evil.example/x', HOME))).toEqual([]);
  });

  it('a document path opens in the Docs reader of the home project', () => {
    expect(links(linkRuns('plan: docs/superpowers/plans/2026-11-01-x.md', HOME))).toEqual([
      { kind: 'link', text: 'docs/superpowers/plans/2026-11-01-x.md', href: '/docs/project-a/plans/2026-11-01-x.md', external: false },
    ]);
    expect(links(linkRuns('docs/conventions/a/b.md', HOME))[0]?.href).toBe('/docs/project-a/conventions/a/b.md');
  });

  it('a document path stays text with no home project, outside the four sections, or with a .. step', () => {
    expect(links(linkRuns('docs/superpowers/specs/a.md', null))).toEqual([]);
    expect(links(linkRuns('docs/vision/a.md docs/superpowers/specs/../../x.md docs/superpowers/specs/', HOME))).toEqual([]);
  });

  it('a javascript, data, vbscript or other address stays text, in any case', () => {
    for (const t of [
      'javascript:alert(1)', 'JavaScript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<b>x</b>', 'DATA:text/html;base64,AA==',
      'vbscript:msgbox(1)', 'VBScript:msgbox(1)', 'http://example.com/x', 'mailto:a@example.com', 'file:///etc/passwd',
      'ftp://example.com/x', 'https:/example.com', 'https://', 'xhttps://example.com/x', 'a/docs/superpowers/specs/a.md',
    ]) {
      expect(links(linkRuns(`see ${t} now`, HOME)), t).toEqual([]);
      expect(joined(linkRuns(`see ${t} now`, HOME)), t).toBe(`see ${t} now`);
    }
  });

  it('the runs put back together are the text, and no two text runs are adjacent', () => {
    for (const t of ['', 'plain', 'a https://example.com/x b /runs c docs/superpowers/specs/s.md d', '  /runs  ']) {
      const runs = linkRuns(t, HOME);
      expect(joined(runs)).toBe(t);
      runs.forEach((r, i) => { if (i > 0 && r.kind === 'text') expect(runs[i - 1]?.kind).toBe('link'); });
    }
    expect(linkRuns('', HOME)).toEqual([]);
  });
});

describe('the Docs reader address of a document and of a programme spec', () => {
  it('docHref: a repository document path in a home project, or null', () => {
    expect(docHref('docs/superpowers/specs/x.md', HOME)).toBe('/docs/project-a/specs/x.md');
    expect(docHref('docs/product-design/y.md', HOME)).toBe('/docs/project-a/product-design/y.md');
    expect(docHref('docs/superpowers/specs/x.md', null)).toBeNull();
    expect(docHref('docs/superpowers/specs/x.md', '../bad')).toBeNull();
    expect(docHref('README.md', HOME)).toBeNull();
  });

  it('specHref: only a spec path, as Goals has always drawn it', () => {
    expect(specHref('docs/superpowers/specs/2026-10-31-x-design.md', HOME)).toBe('/docs/project-a/specs/2026-10-31-x-design.md');
    expect(specHref('docs/superpowers/plans/x.md', HOME)).toBeNull();
    expect(specHref(null, HOME)).toBeNull();
    expect(specHref('docs/superpowers/specs/x.md', null)).toBeNull();
  });

  const run = (id: number, program: string, homeRepo: string | null): RunSummary =>
    ({ id, program, homeProject: homeRepo } as unknown as RunSummary);
  const goals = (program: string, specPath: string | null): GoalsView =>
    ({ program, specPath, inShort: null, inShortAt: null, modifications: [] });

  it('homeProjectOf: the newest run of the programme that names one', () => {
    expect(homeProjectOf('p', [run(1, 'p', 'old'), run(3, 'p', null), run(2, 'p', 'new'), run(9, 'q', 'other')])).toBe('new');
    expect(homeProjectOf('p', [])).toBeNull();
  });

  it('programmeSpecHref: the pin of that programme in its home project; null without a pin or a home', () => {
    const g = [goals('q', 'docs/superpowers/specs/q.md'), goals('p', 'docs/superpowers/specs/p.md'), goals('n', null)];
    const runs = [run(1, 'p', HOME), run(2, 'n', HOME)];
    expect(programmeSpecHref('p', g, runs)).toBe('/docs/project-a/specs/p.md');
    expect(programmeSpecHref('n', g, runs)).toBeNull();
    expect(programmeSpecHref('q', g, runs)).toBeNull();
    expect(programmeSpecHref('z', g, runs)).toBeNull();
  });
});
