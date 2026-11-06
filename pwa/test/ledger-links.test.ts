// The ledgers' links (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D26 to D28): `linkRuns` splits an item's text into
// text and link runs, and the address builders give the one Docs reader address of a document and of a programme's pinned spec.
import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../shared/api';
import type { GoalsView } from '../../shared/ledgers';
import { docHref } from '../src/docs/docsLinks';
import { homeProjectOf, linkRuns, programmeSpecHref, specHref, type LinkRun } from '../src/ledgers/ledgerLinks';

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

// Fix round 1 of PL10 (review 1466). The console draws as a link only what the server's refusal lets through: both read one
// candidate scanner, one trim and one decider (`linkCandidates`, `trimLinkTail`, `linksDocumentOutside`, shared/ledgers.ts).
describe('linkRuns: the D28 boundary, and paths the console would not open as written (review 1466 F5 to F9)', () => {
  it('F5, F6: an artifact page or an outside document server stays text, however it is spelt; a run-artifacts page stays a link', () => {
    for (const t of [
      'https://claude.ai/artifact/0f1e2d3c', 'https://claude.ai/public/artifacts/0f1e2d3c', 'https://claude.ai/%61rtifact/0f1e2d3c',
      'https://b.example/docs/project-a/specs/a-design.md', 'https://b.example/docs/p/%73pecs/x.md',
      'https://github.com/org-a/repo-a/blob/main/docs/superpowers%2Fspecs/x.md', 'https://github.com/org-a/repo-a/tree/main/docs/superpowers/plans',
      'https://claude.ai/%2561rtifact/0f1e2d3c', 'https://github.com/org-a/repo-a/blob/main/docs%5Csuperpowers%5Cspecs%5Cx.md',
    ]) {
      expect(links(linkRuns(`see ${t} now`, HOME)), t).toEqual([]);
      expect(joined(linkRuns(`see ${t} now`, HOME)), t).toBe(`see ${t} now`);
    }
    // Trimmed as the server trims: a full stop or a closing bracket after a document server's section page.
    expect(links(linkRuns('see https://b.example/docs/p/specs.', HOME))).toEqual([]);
    expect(links(linkRuns('(https://b.example/docs/p/plans)', HOME))).toEqual([]);
    expect(links(linkRuns('get https://github.com/org-a/repo-a/actions/runs/1/artifacts/2 now', HOME)).map((r) => r.href))
      .toEqual(['https://github.com/org-a/repo-a/actions/runs/1/artifacts/2']);
  });

  // Fix round 2 (review 1481 F1 to F3): a segment is decoded leniently (each valid `%XX`, a stray `%` left alone) until it is
  // stable, and the path is judged twice, as written and with empty segments and `.` dropped and `..` popped.
  it('a literal percent sign stays a link; a stray percent, an empty segment or an encoded dot-segment hides no document', () => {
    for (const t of [
      'https://en.wikipedia.org/wiki/100%25', 'https://a.example/discount-50%25-off', 'https://a.example/50%-off',
      // Four encodings deep decodes to its last spelling and is judged by it.
      'https://a.example/%25252541bc',
    ]) {
      expect(links(linkRuns(`see ${t} now`, HOME)).map((r) => r.href), t).toEqual([new URL(t).href]);
    }
    for (const t of [
      'https://h.example/%25zz%252Fartifact', 'https://github.com/o/r/blob/main/a%25zz%252Fdocs%252Fsuperpowers%252Fspecs%252Fb',
      'https://claude.ai/public//artifacts/abc', 'https://b.example/docs//p/specs/a.md', 'https://b.example//docs/p/specs/a.md',
      'https://github.com/o/r/blob/main/docs/superpowers//specs/x.md',
      'https://b.example/docs/p/x/..%2fspecs/a.md', 'https://b.example/docs/p/x/..%5cspecs/a.md', 'https://b.example/docs/p/x/%252e%252e/specs/a.md',
      'https://claude.ai/public/x/..%2fartifacts/abc',
      // Named as written and gone once `..` is popped: either reading is enough.
      'https://x.example/artifact/..%2fy', 'https://b.example/docs/p/specs/..%2fa.md',
      // Still changing after four rounds counts as outside, whatever it would decode to.
      'https://a.example/%2525252541bc', 'https://claude.ai/%2525252561rtifact/abc',
    ]) {
      expect(links(linkRuns(`see ${t} now`, HOME)), t).toEqual([]);
    }
  });

  it('F7: a console or document path inside a non-https address stays text', () => {
    for (const t of ['http://a.example/[docs/superpowers/specs/a.md]', 'http://a.example/x(/waiting)', 'ftp://a.example/x(/runs)']) {
      expect(links(linkRuns(`see ${t} now`, HOME)), t).toEqual([]);
    }
    // A path after an opening bracket at a word's start is still one.
    expect(links(linkRuns('see (/waiting) and [docs/superpowers/specs/a.md]', HOME)).map((r) => r.href))
      .toEqual(['/waiting', '/docs/project-a/specs/a.md']);
  });

  it('F8: a console path is judged as the browser resolves it, so a dot-segment or an encoded dot never leaves the table', () => {
    for (const t of ['/docs/../api/fleet', '/docs/%2e%2e/api/fleet', '/docs/..//evil.example/x', '/docs/%2E%2E/%2e%2e/api/fleet']) {
      expect(links(linkRuns(`open ${t} now`, HOME)), t).toEqual([]);
    }
    expect(links(linkRuns('open /waiting/./12 now', HOME))).toEqual([{ kind: 'link', text: '/waiting/./12', href: '/waiting/12', external: false }]);
  });

  it('F9: a run of 100,000 closing brackets after a link is trimmed in linear time', () => {
    const text = `/waiting${')'.repeat(100_000)}`;
    const t0 = performance.now();
    const runs = linkRuns(text, HOME);
    const took = performance.now() - t0;
    expect(links(runs)).toEqual([{ kind: 'link', text: '/waiting', href: '/waiting', external: false }]);
    expect(joined(runs)).toBe(text);
    expect(took, `${Math.round(took)} ms`).toBeLessThan(1000);
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

  // Chat reading Task L (D-8062, R12): chat opens a document at the session's branch, so `docHref` takes a ref.
  it('docHref with a bare ref opens the page at that ref', () => {
    expect(docHref('docs/superpowers/specs/x.md', HOME, { kind: 'bare', name: 'ws/one' }))
      .toBe('/docs/project-a/specs/x.md?ref=ws/one');
    expect(docHref('docs/conventions/c.md', HOME, { kind: 'bare', name: 'main' })).toBe('/docs/project-a/conventions/c.md?ref=main');
    expect(docHref('README.md', HOME, { kind: 'bare', name: 'main' })).toBeNull();
    expect(docHref('docs/superpowers/specs/x.md', null, { kind: 'bare', name: 'main' })).toBeNull();
  });

  it('docHref with no ref is today\'s address', () => {
    expect(docHref('docs/superpowers/specs/x.md', HOME, null)).toBe('/docs/project-a/specs/x.md');
    expect(docHref('docs/superpowers/specs/x.md', HOME, null)).toBe(docHref('docs/superpowers/specs/x.md', HOME));
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
