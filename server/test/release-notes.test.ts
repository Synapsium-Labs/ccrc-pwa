// deploy/release-notes.mjs (D-5548) — every release says what changed. The
// release body is written at release time from the first-parent commits since
// the previous release tag: one plain-English line per change, grouped New /
// Fixed / Faster / Behind the scenes, the PR number kept as a separate `#NNN`
// token, the deviation refs stripped, and the whole capped under the server's
// NOTES_CAP_BYTES so the catalogue never has to cut it.
//
// Commit text is UNTRUSTED here: a subject is whatever a PR title said. The
// script reads it through `git` with an argv (never a shell) and only ever
// treats it as a string — the fixture subjects below carry shell and markup
// metacharacters to prove neither is interpreted.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import {
  NOTE_GROUPS, NOTES_BUDGET_BYTES, noteFor, previousReleaseTag, renderReleaseNotes, releaseNotesFor,
} from '../../deploy/release-notes.mjs';
import { NOTES_CAP_BYTES, capNotes } from '../src/update/catalogue.js';
import { FOLDED_NOTE_GROUP, RELEASE_NOTE_GROUPS, parseReleaseNotes } from '../../shared/release-notes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SCRIPT = join(REPO, 'deploy', 'release-notes.mjs');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
function git(root: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', root, ...args], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}
/** A repo whose history is `subjects`, in order, with `tags` planted at the
 *  named 0-based commit indices. */
function fixture(home: string, subjects: string[], tags: Record<string, number>): string {
  const root = join(home, 'repo');
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  subjects.forEach((s, i) => {
    git(root, 'commit', '-q', '--allow-empty', '-m', s);
    for (const [t, at] of Object.entries(tags)) if (at === i) git(root, 'tag', t);
  });
  return root;
}

describe('noteFor: one subject becomes one plain-English line', () => {
  it.each([
    ['feat(ui,pwa): the command palette and shortcuts (D-5103, D-5456, D-5457) (#626)',
      { group: 'New', text: 'The command palette and shortcuts', pr: 626 }],
    ['fix(coord): a programme\'s claimant may coordinate from any project (#601, D-5523) (#630)',
      { group: 'Fixed', text: 'A programme\'s claimant may coordinate from any project (#601)', pr: 630 }],
    ['perf: the fleet list renders once per poll (#12)', { group: 'Faster', text: 'The fleet list renders once per poll', pr: 12 }],
    ['docs(spec): the release lane (#7)', { group: 'Behind the scenes', text: 'The release lane', pr: 7 }],
    ['chore(handoff): default worker (#14)', { group: 'Behind the scenes', text: 'Default worker', pr: 14 }],
    ['refactor!: one reader (D-12)', { group: 'Behind the scenes', text: 'One reader', pr: null }],
    ['FEAT: shouting prefix', { group: 'New', text: 'Shouting prefix', pr: null }],
    ['Merge pull request #13 from someone/branch', { group: 'Behind the scenes', text: 'Merge pull request #13 from someone/branch', pr: null }],
    ['an unprefixed subject (#9)', { group: 'Behind the scenes', text: 'An unprefixed subject', pr: 9 }],
  ])('%s', (subject, want) => {
    expect(noteFor(subject)).toEqual(want);
  });

  it('strips a D-ref RANGE as a D-ref, keeping what else the parenthetical says', () => {
    expect(noteFor('docs: the shells plan, reviewed (D-5466..D-5479) (#609)').text).toBe('The shells plan, reviewed');
    expect(noteFor('feat: wave 17 (D-5313..D-5330, D-12) (#566)').text).toBe('Wave 17');
    expect(noteFor('fix: a thing (wave 3, D-1–D-4) (#1)').text).toBe('A thing (wave 3)');
  });

  it('keeps a non-deviation parenthetical, and strips a bare D-ref list wherever it sits', () => {
    expect(noteFor('fix: a (small) thing (D-1, D-B4-9) works (#3)').text).toBe('A (small) thing works');
  });

  it('strips control characters and collapses whitespace; never interprets the text', () => {
    const n = noteFor('feat: $(touch /tmp/x) `id` <b>bold</b>\u0007\ttabbed   spaced (#5)');
    expect(n).toEqual({ group: 'New', text: '$(touch /tmp/x) `id` <b>bold</b> tabbed spaced', pr: 5 });
  });

  it('strips bidi overrides/isolates and zero-width characters, so a title cannot reorder or hide text', () => {
    const n = noteFor('feat: safe\u202Eevil\u202C \u2066x\u2069 zero\u200Bwidth\u200C\u200D\u200E\u200F\u2060\uFEFF end (#6)');
    expect(n.text).not.toMatch(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/);
    expect(n.text).toBe('Safe evil x zero width end');
  });

  it('a subject that is ONLY a prefix and refs still says something', () => {
    expect(noteFor('fix: (D-9) (#4)').text).toBe('fix: (D-9)');
  });

  it('caps by code point, never splitting a surrogate pair', () => {
    const n = noteFor(`feat: ${'\u{1F600}'.repeat(400)} (#1)`);
    expect(n.text.endsWith('…')).toBe(true);
    expect(Array.from(n.text).length).toBeLessThanOrEqual(240);
    expect(n.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it('caps an absurdly long line', () => {
    const n = noteFor(`feat: ${'x'.repeat(1000)} (#1)`);
    expect(n.text.length).toBeLessThanOrEqual(240);
    expect(n.text.endsWith('…')).toBe(true);
  });
});

describe('renderReleaseNotes: grouped, most important first, capped', () => {
  it('writes the header, then the non-empty groups in order, one line per change with its #NNN', () => {
    const body = renderReleaseNotes({
      prev: 'v0.0.287',
      subjects: [
        'chore: tidy (#4)', 'fix(x): the banner button works (D-1) (#3)', 'feat: notes (#2)', 'feat: sheet (#1)',
      ],
    });
    expect(body).toBe([
      'Changes since v0.0.287', '',
      'New', '- Notes #2', '- Sheet #1', '',
      'Fixed', '- The banner button works #3', '',
      'Behind the scenes', '- Tidy #4', '',
    ].join('\n'));
  });

  it('says so when the range is empty, and names a first release', () => {
    expect(renderReleaseNotes({ prev: 'v1.0.0', subjects: [] })).toBe('Changes since v1.0.0\n\nNo changes.\n');
    expect(renderReleaseNotes({ prev: null, subjects: ['feat: x'] })).toBe('First release\n\nNew\n- X\n');
  });

  it('stays under the budget, which stays under NOTES_CAP_BYTES, dropping the least important first', () => {
    expect(NOTES_BUDGET_BYTES).toBeLessThan(NOTES_CAP_BYTES);
    const subjects = [
      ...Array.from({ length: 80 }, (_, i) => `chore: behind number ${i} ${'é'.repeat(30)} (#${1000 + i})`),
      ...Array.from({ length: 40 }, (_, i) => `feat: new number ${i} ${'é'.repeat(30)} (#${i + 1})`),
    ];
    const body = renderReleaseNotes({ prev: 'v0.0.1', subjects });
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(NOTES_BUDGET_BYTES);
    // The catalogue stores it whole: no marker, no cut.
    expect(capNotes(body)).toBe(body);
    const parsed = parseReleaseNotes(body);
    expect(parsed.kind).toBe('grouped');
    if (parsed.kind !== 'grouped') return;
    const news = parsed.groups.find((g) => g.name === 'New');
    // Every New line survived; the overflow came out of Behind the scenes.
    expect(news?.items.length).toBe(40);
    expect(parsed.more).toBeGreaterThan(0);
    const behind = parsed.groups.find((g) => g.name === 'Behind the scenes')?.items.length ?? 0;
    expect(behind + (parsed.more ?? 0)).toBe(80);
    expect(body).toMatch(/\n…and \d+ more changes\n$/);
  });
});

describe('the generator and the PWA parser speak one format', () => {
  it('the group names are the same list, in the same order', () => {
    expect(NOTE_GROUPS.map((g: { name: string }) => g.name)).toEqual([...RELEASE_NOTE_GROUPS]);
    expect(FOLDED_NOTE_GROUP).toBe('Behind the scenes');
  });

  it('round-trips: what the generator writes, the parser reads back line for line', () => {
    const body = renderReleaseNotes({
      prev: 'v0.0.290', subjects: ['perf: faster (#9)', 'feat: a <tag> & "quote" (#8)', 'docs: words'],
    });
    expect(parseReleaseNotes(body)).toEqual({
      kind: 'grouped', since: 'v0.0.290', empty: false, more: null,
      groups: [
        { name: 'New', items: ['A <tag> & "quote" #8'] },
        { name: 'Faster', items: ['Faster #9'] },
        { name: 'Behind the scenes', items: ['Words'] },
      ],
    });
  });
});

describe('parseReleaseNotes: a hand-written body cannot spoof the display', () => {
  it('drops bidi overrides/isolates and zero-width characters from a plain body and a grouped one', () => {
    expect(parseReleaseNotes('safe\u202Elive\u202C \u2066x\u2069 a\u200Bb\uFEFF')).toEqual({ kind: 'plain', text: 'safelive x ab' });
    const g = parseReleaseNotes('Changes since v0.0.1\n\nNew\n- A\u202Eb #3\n');
    expect(JSON.stringify(g)).not.toMatch(/\\u202e|\u202E/i);
    expect(g.kind).toBe('grouped');
  });
});

describe('previousReleaseTag: the highest release-shaped tag below this one', () => {
  it.each([
    [['v0.0.9', 'v0.0.10', 'v0.0.11'], 'v0.0.11', 'v0.0.10'],
    [['v0.0.9', 'v0.0.10', 'v0.1.0'], 'v0.1.0', 'v0.0.10'],
    [['v0.0.1', 'vnext', 'v0.0.2-rc1', 'v0.0.3'], 'v0.0.3', 'v0.0.1'],
    [['v0.0.1'], 'v0.0.1', null],
    [['v0.0.5', 'v0.0.7'], 'v0.0.6', 'v0.0.5'],
  ])('%j below %s → %s', (tags, tag, want) => {
    expect(previousReleaseTag(tags, tag)).toBe(want);
  });
});

describe('releaseNotesFor + the CLI: real git, first-parent, argv only', () => {
  it('lists the first-parent commits between the previous tag and this one', () => {
    const home = mkTmp('ccrc-relnotes-range-');
    const root = fixture(home, [
      'feat: before (#1)', 'fix: old (#2)',
      'feat(ui): the sheet (D-5549) (#3)', 'chore: $(echo pwned) (#4)', 'perf: quick (#5)',
      'feat: after (#6)',
    ], { 'v0.0.1': 1, 'v0.0.2': 3, 'v0.0.3': 4 });
    expect(releaseNotesFor({ repo: root, tag: 'v0.0.2' })).toBe([
      'Changes since v0.0.1', '', 'New', '- The sheet #3', '', 'Behind the scenes', '- $(echo pwned) #4', '',
    ].join('\n'));
    expect(releaseNotesFor({ repo: root, tag: 'v0.0.3' })).toBe('Changes since v0.0.2\n\nFaster\n- Quick #5\n');
  });

  it('follows the first parent only: a merged branch says its merge, not each of its commits', () => {
    const home = mkTmp('ccrc-relnotes-merge-');
    const root = fixture(home, ['feat: base (#1)'], { 'v0.0.1': 0 });
    git(root, 'checkout', '-q', '-b', 'side');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'wip: side commit one');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'wip: side commit two');
    git(root, 'checkout', '-q', 'main');
    git(root, 'merge', '-q', '--no-ff', 'side', '-m', 'feat: the side branch (#2)');
    git(root, 'tag', 'v0.0.2');
    expect(releaseNotesFor({ repo: root, tag: 'v0.0.2' })).toBe('Changes since v0.0.1\n\nNew\n- The side branch #2\n');
  });

  it('the CLI writes --out and exits 0; an unknown tag exits non-zero and writes nothing', () => {
    const home = mkTmp('ccrc-relnotes-cli-');
    const root = fixture(home, ['feat: one (#1)', 'fix: two (#2)'], { 'v0.0.1': 0, 'v0.0.2': 1 });
    const out = join(home, 'notes.txt');
    const ok = spawnSync(process.execPath, [SCRIPT, '--repo', root, '--tag', 'v0.0.2', '--out', out], { encoding: 'utf8' });
    expect(ok.status, ok.stderr).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe('Changes since v0.0.1\n\nFixed\n- Two #2\n');
    const out2 = join(home, 'notes2.txt');
    const bad = spawnSync(process.execPath, [SCRIPT, '--repo', root, '--tag', 'v9.9.9', '--out', out2], { encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/release-notes: /);
    expect(existsSync(out2)).toBe(false);
    const shape = spawnSync(process.execPath, [SCRIPT, '--repo', root, '--tag', 'main', '--out', out2], { encoding: 'utf8' });
    expect(shape.status).toBe(2);
    expect(existsSync(out2)).toBe(false);
  });
});

describe('release-notes.mjs: source pins (no shell, no evaluation of commit text)', () => {
  const src = (): string => readFileSync(SCRIPT, 'utf8');
  it('runs git through execFileSync with an argv, never a shell', () => {
    expect(src()).toMatch(/execFileSync\('git'/);
    expect(src()).not.toMatch(/\bexecSync\b|\bspawn\(|shell:\s*true|\beval\(|new Function\b|child_process'\)\.exec\b/);
    expect(src()).not.toMatch(/import\s*\{[^}]*\bexec\b[^}]*\}\s*from 'node:child_process'/);
  });
  it('imports nothing but node built-ins', () => {
    const froms = [...src().matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(0);
    for (const f of froms) expect(f).toMatch(/^node:/);
  });
});

