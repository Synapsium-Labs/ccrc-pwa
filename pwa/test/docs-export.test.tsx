// Docs W5 Export (spec 2026-10-01 4.7, 4.14, 4.17; native Docs reader W5, Export): what an export holds, pure and built.
// Task 1, the words and the name (M4.EX5's and M4.EX18's maps, M4.EX9). Task 2, the stylesheet (M4.EX10, M4.EX14 as
// refinement (b) reads it). Task 3, the provenance and the colouring (M4.T7, M4.EX5, M4.EX6, M4.EX18). Task 5, the
// builder (M4.EX1-EX4, M4.EX7, M4.EX10, M4.EX18). Placeholders only: project `demo`, branch `main`,
// `example-org/example-repo`, `/repo/...`, `https://a.example`.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { DocPin } from '../../shared/docs';
import { EXPORT_MISSING_SENTENCE, EXPORT_PLAIN_SENTENCE, EXPORT_TEXT, fillSentence } from '../src/docs/docsText';
import { exportFilename } from '../src/docs/export/filename';
import { EXPORT_FILENAME_MAX } from '../src/docs/export/policy';
import { EXPORT_CSS, exportStylesheetPart } from '../src/docs/export/stylesheet';
import { COMMIT_A, FP_1, SERVED } from './docsFixtures';

const SHORT_A = COMMIT_A.slice(0, 8);
const committedPin = (path: string, commit = COMMIT_A): DocPin =>
  ({ kind: 'committed', commit, servedRef: SERVED, section: 'specs', path });
const draftPin = (path: string): DocPin =>
  ({ kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path, fp: FP_1 });

describe('the Export words (spec 4.7, 4.17; M4.EX5, M4.EX18)', () => {
  it('EXPORT_MISSING_SENTENCE has one sentence per placeholder word, and none takes a field', () => {
    expect(Object.keys(EXPORT_MISSING_SENTENCE).sort())
      .toEqual(['deferred', 'external', 'failed', 'over-size', 'refused', 'timed-out']);
    for (const s of Object.values(EXPORT_MISSING_SENTENCE)) expect(s).not.toContain('{');
  });

  it('EXPORT_PLAIN_SENTENCE has one sentence per class of plain block, and none takes a field', () => {
    expect(Object.keys(EXPORT_PLAIN_SENTENCE).sort())
      .toEqual(['failed', 'no-worker', 'over-cap', 'page-ceiling', 'part1-bounds', 'timeout', 'too-large']);
    for (const s of Object.values(EXPORT_PLAIN_SENTENCE)) expect(s).not.toContain('{');
  });

  it("the sheet's failure and wait sentences are spec 4.17's", () => {
    expect(EXPORT_TEXT.tooLarge).toBe('Too large to export; use Download.');
    expect(fillSentence(EXPORT_TEXT.couldNotStart, { error: 'TypeError' })).toBe('Export could not start (TypeError).');
    expect(fillSentence(EXPORT_TEXT.failed, { error: 'RangeError' })).toBe('Export failed (RangeError).');
    expect(fillSentence(EXPORT_TEXT.deferred, { k: 2, s: 's' })).toBe('2 images not loaded; tap Load image first.');
  });
});

describe('exportFilename (spec 4.17 "Filename"; M4.EX9)', () => {
  const SAFE = /^[A-Za-z0-9._-]+$/;

  it("is <project>_<section>_<path with '/' as '__'>_<short8>.html", () => {
    expect(exportFilename('demo', committedPin('d/a.md'), COMMIT_A)).toBe(`demo_specs_d__a.md_${SHORT_A}.html`);
  });

  it('ends -draft.html for a draft', () => {
    expect(exportFilename('demo', draftPin('a.md'), COMMIT_A)).toBe(`demo_specs_a.md_${SHORT_A}-draft.html`);
  });

  it.each([
    ['non-ASCII letters', 'café/naïve.md', 'caf-__na-ve.md'],
    ['spaces and quotes', 'a b/"c".md', 'a-b__-c-.md'],
    ['a control byte', `a${String.fromCharCode(1)}b.md`, 'a-b.md'],
  ])('turns every character outside [A-Za-z0-9._-] into "-" (%s)', (_name, path, want) => {
    const name = exportFilename('demo', committedPin(path), COMMIT_A);
    expect(name).toMatch(SAFE);
    expect(name).toBe(`demo_specs_${want}_${SHORT_A}.html`);
  });

  it('is at most 150 characters: the path is cut first, and the tail stays whole', () => {
    const name = exportFilename('demo', draftPin(`${'x'.repeat(300)}/a.md`), COMMIT_A);
    expect(name).toHaveLength(EXPORT_FILENAME_MAX);
    expect(name.startsWith('demo_specs_xxx')).toBe(true);
    expect(name.endsWith(`_${SHORT_A}-draft.html`)).toBe(true);
  });
});

// ---- Task 2: the stylesheet ---------------------------------------------------------------------------------------

describe('the export stylesheet (spec 4.14, 4.17; M4.EX10, M4.EX14 as refinement (b) reads it)', () => {
  const read = (...parts: string[]): string => readFileSync(path.join(import.meta.dirname, '..', ...parts), 'utf8');

  it('is tokens.css, prose.css and export.css, in that order, each less its comments and @font-face blocks', () => {
    const parts = [read('..', 'ui', 'src', 'styles', 'tokens.css'), read('..', 'ui', 'src', 'components', 'prose.css'),
      read('src', 'docs', 'export', 'export.css')];
    expect(EXPORT_CSS).toBe(parts.map(exportStylesheetPart).join('\n'));
    expect(EXPORT_CSS).toContain("[data-theme='light']");
    expect(EXPORT_CSS).toContain('.msg-assist');
    expect(EXPORT_CSS).toContain('.ccrc-export-draft');
  });

  it('holds no comment, no @font-face, no @import, no url( and no </style', () => {
    expect(EXPORT_CSS).not.toMatch(/\/\*/);
    expect(EXPORT_CSS).not.toMatch(/@font-face/i);
    expect(EXPORT_CSS).not.toMatch(/@import/i);
    expect(EXPORT_CSS).not.toMatch(/url\(/i);
    expect(EXPORT_CSS).not.toMatch(/<\/style/i);
  });

  it('exportStylesheetPart drops comments and every @font-face block, and nothing else', () => {
    const css = "/* a url() */\n@font-face { font-family: X; src: url('x.woff2'); }\n.a { margin: 0; }\n@font-face{src:url(y)}";
    expect(exportStylesheetPart(css)).toBe('.a { margin: 0; }');
  });

  it('no hex colour in docs/export/*.ts or *.tsx, comments aside (M4.EX10)', () => {
    const dir = path.join(import.meta.dirname, '..', 'src', 'docs', 'export');
    const files = readdirSync(dir).filter((n) => /\.tsx?$/.test(n));
    expect(files).toEqual(expect.arrayContaining(['policy.ts', 'stylesheet.ts']));
    for (const name of files) {
      const code = readFileSync(path.join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
