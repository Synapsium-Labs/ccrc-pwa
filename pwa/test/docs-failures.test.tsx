// Docs W5 part 1, Task 2: the docs words (spec 2026-10-01 4.7). Every sentence map is exhaustive over its word's
// type (the `Record<..., true>` sets below make a word missing from a set a compile error in this file, under pwa's
// tsc and server/test/typecheck-tests), the spec's own sentences are verbatim, an unknown word is never folded
// (M4.F2), the retry plan follows L0's classes and the three lock ages (M4.F3), and a pre-Docs server's 404 renders
// "predates Docs" and no docs sentence (M4.F6 = M7.1).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DOCS_FAILURE_RETRY, DOCS_FAILURES, type DocsFailure, type DocsFailureBody, type DocsNotAFileKind,
  type DocsPageParseFailure, type DocsTreeOk, type EntryBadge, type WithheldReason,
} from '../../shared/docs';
import { createApi } from '../src/lib/api';
import {
  DOCS_CAPS_UNKNOWN_RETRY_MS, DOCS_LOCK_STALE_MS, DOCS_REF_LOCKED_RETRY_MS, docsAnswerFromError, docsRetryPlan,
  type DocsClientSlot, type DocsNotOk,
} from '../src/docs/failures';
import {
  DOCS_FAILURE_SENTENCE, DOCS_PAGE_INVALID_SENTENCE, DOCS_SLOT_SENTENCE, ENTRY_BADGE_TEXT, NOT_A_FILE_KIND_TEXT,
  RELATION_SENTENCE, UNRESOLVED_TAG_HINT, VIA_SENTENCE, WITHHELD_SENTENCE, failureSentence, fillSentence, kib,
  shortCommit, unknownWordSentence,
} from '../src/docs/docsText';
import { DocsFailureView } from '../src/docs/DocsFailureView';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// Each set is exhaustive by type: a key missing or extra is a compile error here.
const PAGE_FAILURES: Record<DocsPageParseFailure, true> = {
  'not-docs': true, 'bad-project': true, 'bad-section': true, 'bad-path': true, 'bad-ref': true, 'bad-view': true,
  'bad-frame': true, 'bad-escape': true, 'encoded-slash': true, 'commit-in-page': true, 'unknown-param': true,
  'repeated-param': true, 'reserved-node': true,
};
const KINDS: Record<DocsNotAFileKind, true> = {
  'directory': true, 'section-not-a-directory': true, 'symlink': true, 'submodule': true, 'file-in-path': true,
  'special': true, 'hardlink': true, 'foreign-owner': true, 'other-device': true,
};
const VIAS: Record<DocsTreeOk['ref']['via'], true> = {
  'default:origin-head': true, 'default:origin-main': true, 'default:origin-master': true, 'default:local-main': true,
  'default:local-master': true, 'local': true, 'origin': true, 'qualified': true,
};
const RELATIONS: Record<DocsTreeOk['ref']['relation'], true> = {
  'equal': true, 'local-only': true, 'origin-only': true, 'local-ahead': true, 'local-behind': true, 'diverged': true,
  'unmeasured': true,
};
const BADGES: Record<EntryBadge, true> = {
  'modified': true, 'new': true, 'deleted': true, 'typechange': true, 'conflicted': true, 'withheld': true,
};
const WITHHELD: Record<WithheldReason, true> = { 'too-large': true, 'unreadable': true, 'not-a-file': true };
const SLOTS: Record<DocsClientSlot['s'], true> = {
  'auth': true, 'unreachable': true, 'no-docs-route': true, 'unexpected-response': true,
};
const keysOf = (o: object): string[] => Object.keys(o).sort();

/** A failure body for `word`, known or not, with any context. */
const bodyOf = (word: string, ctx: Record<string, unknown> = {}): DocsFailureBody =>
  ({ ok: false, failure: word, ...ctx }) as unknown as DocsFailureBody;
const failed = (word: string, ctx: Record<string, unknown> = {}): DocsNotOk => ({ s: 'failed', body: bodyOf(word, ctx) });
/** A template's longest run of fixed text between placeholders: what any filling of it must contain. */
const stem = (template: string): string =>
  template.split(/\{[A-Za-z]+\}/).reduce((a, b) => (b.length > a.length ? b : a), '');

describe('the sentence maps (M4.F1)', () => {
  it('every DOCS_FAILURES word has a sentence of 20+ characters, and the map holds no other key', () => {
    expect(keysOf(DOCS_FAILURE_SENTENCE)).toEqual(keysOf(DOCS_FAILURES));
    for (const [word, sentence] of Object.entries(DOCS_FAILURE_SENTENCE)) {
      expect(sentence.length, word).toBeGreaterThanOrEqual(20);
    }
  });

  it('every DocsPageParseFailure has a sentence of 20+ characters, and the map holds no other key', () => {
    expect(keysOf(DOCS_PAGE_INVALID_SENTENCE)).toEqual(keysOf(PAGE_FAILURES));
    for (const [why, sentence] of Object.entries(DOCS_PAGE_INVALID_SENTENCE)) {
      expect(sentence.length, why).toBeGreaterThanOrEqual(20);
    }
  });

  it('the seven sentences spec 4.7 gives are verbatim', () => {
    const SPEC: Partial<Record<DocsFailure, string>> = {
      'unknown-project': "There is no project by that name under the fleet box's projects folder ({root}).",
      'too-large': 'This file is {size}; Docs shows files of this kind up to {cap}.',
      'helper-unavailable': 'The fleet box has no usable python3, which Docs needs; run ccrc doctor there.',
      'unsupported': "The fleet box's ccd predates Docs; roll out a newer release.",
      'not-granted': 'The fleet agent has not loaded the Docs grants yet. If a rollout is running this clears when it finishes; otherwise update the fleet box.',
      'foreign-request': 'The server refused a request that did not come from the Docs screen.',
      'raster-mismatch': 'These bytes are not a {declared} image.',
    };
    for (const [word, sentence] of Object.entries(SPEC)) {
      expect(DOCS_FAILURE_SENTENCE[word as DocsFailure], word).toBe(sentence);
    }
  });

  it('the not-a-file kinds, the vias, the relations, the badges, the withheld reasons and the slots each have exactly their type\'s keys, every text non-empty', () => {
    const pairs: [object, object][] = [
      [NOT_A_FILE_KIND_TEXT, KINDS], [VIA_SENTENCE, VIAS], [RELATION_SENTENCE, RELATIONS], [ENTRY_BADGE_TEXT, BADGES],
      [WITHHELD_SENTENCE, WITHHELD], [DOCS_SLOT_SENTENCE, SLOTS],
    ];
    for (const [map, set] of pairs) {
      expect(keysOf(map)).toEqual(keysOf(set));
      for (const text of Object.values(map)) expect(String(text).trim()).not.toBe('');
    }
  });

  it('the truth line\'s sentences and the slots are spec 4.5\'s and 4.7\'s, verbatim once filled', () => {
    expect(fillSentence(VIA_SENTENCE.local, { requested: 'ws/a' })).toBe('you asked for ws/a, showing local');
    expect(fillSentence(VIA_SENTENCE.origin, { requested: 'main' })).toBe("you asked for main, showing origin's");
    expect(VIA_SENTENCE['default:origin-head']).toBe('default branch (origin/HEAD)');
    expect(VIA_SENTENCE['default:origin-main']).toBe('default branch (origin/main; origin/HEAD unset)');
    expect(VIA_SENTENCE['default:origin-master']).toBe('default branch (origin/master; origin/HEAD unset)');
    expect(VIA_SENTENCE['default:local-main']).toBe('default branch (local main; no origin branch)');
    expect(VIA_SENTENCE['default:local-master']).toBe('default branch (local master; no origin branch)');
    expect(VIA_SENTENCE.qualified).toBe('exactly the ref you asked for');
    expect(fillSentence(RELATION_SENTENCE.diverged, { ahead: 2, behind: 3 }))
      .toBe('local and origin have diverged (2 vs 3), showing local');
    expect(fillSentence(RELATION_SENTENCE['local-ahead'], { ahead: 4 })).toBe('local is 4 ahead of origin');
    expect(fillSentence(RELATION_SENTENCE['local-behind'], { behind: 1 })).toBe('origin is 1 ahead of local');
    expect(RELATION_SENTENCE.unmeasured).toBe('local vs origin not measured');
    expect(ENTRY_BADGE_TEXT.modified).toBe('draft · modified');
    expect(ENTRY_BADGE_TEXT.new).toBe('draft · new');
    expect(DOCS_SLOT_SENTENCE.auth).toBe('Sign in to read Docs.');
    expect(DOCS_SLOT_SENTENCE.unreachable).toBe('The server could not be reached; Docs needs a connection.');
    expect(DOCS_SLOT_SENTENCE['no-docs-route']).toBe('This server predates Docs; update the server box.');
  });
});

describe('fillSentence, failureSentence, kib and shortCommit', () => {
  it('fills each placeholder in one pass: an absent field renders ?, never the braces, and a value holding braces is not filled again', () => {
    expect(fillSentence('a {x} b {y}.', { x: 1, y: 'two' })).toBe('a 1 b two.');
    expect(fillSentence('the {root} folder', {})).toBe('the ? folder');
    expect(fillSentence('{word}!', { word: '{word}' })).toBe('{word}!');
  });

  it('a known word is filled from its own context, sizes in KiB', () => {
    expect(failureSentence(bodyOf('too-large', { size: 3145728, cap: 2097152 })))
      .toBe('This file is 3072 KiB; Docs shows files of this kind up to 2048 KiB.');
    expect(failureSentence(bodyOf('raster-mismatch', { declared: 'png', size: 9 })))
      .toBe('These bytes are not a png image.');
    expect(failureSentence(bodyOf('unknown-project', { root: 'demo-root' })))
      .toBe("There is no project by that name under the fleet box's projects folder (demo-root).");
  });

  it('kib rounds up so a non-empty file never reads as 0; shortCommit is the first 8 hex characters', () => {
    expect([kib(0), kib(1), kib(1024), kib(1025), kib(2097152)]).toEqual(['0 KiB', '1 KiB', '1 KiB', '2 KiB', '2048 KiB']);
    expect(shortCommit('0123456789abcdef'.repeat(4).slice(0, 40))).toBe('01234567');
  });
});

describe('an unknown word is never folded (M4.F2)', () => {
  it("{failure: 'brand-new-word'} renders a sentence naming it, and no known word's sentence", () => {
    render(<DocsFailureView answer={failed('brand-new-word')} onRetry={() => undefined} />);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toContain('brand-new-word');
    expect(text).toContain(unknownWordSentence('brand-new-word'));
    expect(unknownWordSentence('brand-new-word'))
      .toBe("The server answered 'brand-new-word', which this app version does not know; reload to update.");
    for (const sentence of Object.values(DOCS_FAILURE_SENTENCE)) expect(text).not.toContain(stem(sentence));
    expect(screen.queryByRole('button', { name: 'Retry' }), 'the same server would answer the same word').toBeNull();
  });

  it('the retry plan of an unknown word is none', () => {
    expect(docsRetryPlan(bodyOf('brand-new-word', { retryAfterMs: 10 }))).toEqual({ kind: 'none' });
  });
});

describe('docsRetryPlan (M4.F3)', () => {
  it('the three PWA waits are the spec\'s', () => {
    expect([DOCS_REF_LOCKED_RETRY_MS, DOCS_LOCK_STALE_MS, DOCS_CAPS_UNKNOWN_RETRY_MS]).toEqual([3000, 60000, 5000]);
  });

  it.each(Object.entries(DOCS_FAILURE_RETRY))('%s (class %s) with no context follows its class', (word, cls) => {
    const plan = docsRetryPlan(bodyOf(word));
    if (cls === 'none') expect(plan).toEqual({ kind: 'none' });
    else if (cls === 'manual') expect(plan).toEqual({ kind: 'manual' });
    else if (cls === 'auto-while-young') expect(plan, 'lockAgeMs absent: unmeasured').toEqual({ kind: 'manual' });
    else expect(plan).toEqual({ kind: 'auto', afterMs: word === 'caps-unknown' ? DOCS_CAPS_UNKNOWN_RETRY_MS : 0 });
  });

  it.each(Object.entries(DOCS_FAILURE_RETRY))('%s (class %s) with retryAfterMs 1234 waits it only when auto', (word, cls) => {
    const plan = docsRetryPlan(bodyOf(word, { retryAfterMs: 1234 }));
    if (cls === 'auto') expect(plan).toEqual({ kind: 'auto', afterMs: 1234 });
    else expect(plan.kind).not.toBe('auto');
  });

  it('a negative retryAfterMs is not a wait: the word\'s own fallback applies', () => {
    expect(docsRetryPlan(bodyOf('docs-busy', { retryAfterMs: -5 }))).toEqual({ kind: 'auto', afterMs: 0 });
    expect(docsRetryPlan(bodyOf('caps-unknown', { retryAfterMs: -5 }))).toEqual({ kind: 'auto', afterMs: 5000 });
  });

  it('ref-locked: a young lock and a lock already gone wait 3 s; at or past 60 s it is stale (none); an unmeasured age is manual', () => {
    const plan = (lockAgeMs?: number | null) =>
      docsRetryPlan(bodyOf('ref-locked', lockAgeMs === undefined ? {} : { lockAgeMs }));
    expect(plan(5000)).toEqual({ kind: 'auto', afterMs: 3000 });
    expect(plan(0)).toEqual({ kind: 'auto', afterMs: 3000 });
    expect(plan(59999)).toEqual({ kind: 'auto', afterMs: 3000 });
    expect(plan(null)).toEqual({ kind: 'auto', afterMs: 3000 });
    expect(plan(60000)).toEqual({ kind: 'none' });
    expect(plan(120000)).toEqual({ kind: 'none' });
    expect(plan()).toEqual({ kind: 'manual' });
  });
});

describe('docsAnswerFromError', () => {
  it('rethrows an abort and a defect; a TypeError is unreachable', () => {
    const abort = new DOMException('aborted', 'AbortError');
    expect(() => docsAnswerFromError(abort)).toThrow(abort);
    const defect = new RangeError('a bug');
    expect(() => docsAnswerFromError(defect)).toThrow(defect);
    expect(docsAnswerFromError(new TypeError('Failed to fetch'))).toEqual({ s: 'unreachable' });
  });
});

describe('DocsFailureView: the context each word renders (spec 4.7)', () => {
  it('unresolved-ref shows what was tried, the suggestion as a link, the tag hint and Fetch from origin', () => {
    const onFetch = vi.fn();
    render(
      <DocsFailureView
        answer={failed('unresolved-ref', {
          tried: [{ ref: 'refs/heads/ws/a', result: 'absent' }, { ref: 'refs/remotes/origin/ws/a', result: 'absent' }],
          suggest: 'main', hint: 'tag',
        })}
        suggestHref={(name) => `/docs/demo?ref=${name}`}
        onFetchFromOrigin={onFetch}
      />,
    );
    expect(screen.getByText('refs/heads/ws/a')).toBeInTheDocument();
    expect(screen.getByText('refs/remotes/origin/ws/a')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'main' })).toHaveAttribute('href', '/docs/demo?ref=main');
    expect(screen.getByText(UNRESOLVED_TAG_HINT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch from origin' }));
    expect(onFetch).toHaveBeenCalledTimes(1);
  });

  it("a tried result that is an Object.prototype key renders as the literal word, never a function", () => {
    render(<DocsFailureView answer={failed('unresolved-ref', { tried: [{ ref: 'refs/heads/x', result: 'constructor' }] })} />);
    expect(screen.getByText('refs/heads/x').closest('li')).toHaveTextContent('refs/heads/x constructor');
  });

  it('with no suggestHref the suggestion is text, not a link; with no handler there is no Fetch from origin', () => {
    render(<DocsFailureView answer={failed('unresolved-ref', { suggest: 'main' })} />);
    expect(screen.getByText('main').tagName).toBe('CODE');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Fetch from origin is unresolved-ref\'s alone', () => {
    render(<DocsFailureView answer={failed('absent-path')} onFetchFromOrigin={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Fetch from origin' })).toBeNull();
  });

  it('ambiguous-worktree lists its candidates', () => {
    render(<DocsFailureView answer={failed('ambiguous-worktree', { candidates: ['ws/a', 'ws/b'] })} />);
    expect(screen.getByText('ws/a')).toBeInTheDocument();
    expect(screen.getByText('ws/b')).toBeInTheDocument();
  });

  it('git-failed and ccd-fault show their stderrHead in pre.docs-fail-detail', () => {
    const { container, unmount } = render(
      <DocsFailureView answer={failed('git-failed', { step: 'cat-file', rc: 128, stderrHead: 'fatal: bad object' })} />,
    );
    expect(container.querySelector('pre.docs-fail-detail')?.textContent).toBe('fatal: bad object');
    expect(screen.getByRole('alert')).toHaveTextContent('A git command failed on the fleet box (cat-file).');
    unmount();
    // The server sends ccd-fault with no `code` (absent means unmeasured); the sentence's present-code form is pinned
    // separately, in 'Review 439 F7'.
    render(<DocsFailureView answer={failed('ccd-fault', { stderrHead: 'Traceback: x' })} />);
    expect(document.querySelector('pre.docs-fail-detail')?.textContent).toBe('Traceback: x');
  });

  it('a partial clone\'s git-failed {step: cat-file} and unknown-commit each render their own word', () => {
    const { unmount } = render(<DocsFailureView answer={failed('git-failed', { step: 'cat-file' })} />);
    expect(screen.getByRole('alert')).toHaveAttribute('data-failure', 'git-failed');
    const gitText = screen.getByRole('alert').textContent;
    unmount();
    render(<DocsFailureView answer={failed('unknown-commit')} />);
    expect(screen.getByRole('alert')).toHaveAttribute('data-failure', 'unknown-commit');
    expect(screen.getByRole('alert')).toHaveTextContent(DOCS_FAILURE_SENTENCE['unknown-commit']);
    expect(screen.getByRole('alert').textContent).not.toBe(gitText);
  });

  it('not-a-file renders the kind\'s text', () => {
    render(<DocsFailureView answer={failed('not-a-file', { kind: 'symlink' })} />);
    expect(screen.getByText(NOT_A_FILE_KIND_TEXT.symlink)).toBeInTheDocument();
  });

  it('too-large shows both sizes in KiB, and unknown-project its root', () => {
    const { unmount } = render(<DocsFailureView answer={failed('too-large', { size: 4096, cap: 2048 })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This file is 4 KiB; Docs shows files of this kind up to 2 KiB.');
    unmount();
    render(<DocsFailureView answer={failed('unknown-project', { root: 'demo-root' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('(demo-root)');
  });
});

describe('DocsFailureView: Retry follows the answer, and only a passed handler is offered', () => {
  const retryFor = (answer: DocsNotOk, withHandler = true): HTMLElement | null => {
    const { unmount } = render(<DocsFailureView answer={answer} onRetry={withHandler ? () => undefined : undefined} />);
    const button = screen.queryByRole('button', { name: 'Retry' });
    unmount();
    return button;
  };

  it('a manual word and an auto word offer Retry; a none word, a stale lock and a missing handler do not', () => {
    expect(retryFor(failed('repo-unreadable'))).not.toBeNull();
    expect(retryFor(failed('docs-busy', { retryAfterMs: 2000 }))).not.toBeNull();
    expect(retryFor(failed('bad-path'))).toBeNull();
    expect(retryFor(failed('ref-locked', { lockAgeMs: 120000 }))).toBeNull();
    expect(retryFor(failed('repo-unreadable'), false)).toBeNull();
  });

  it('a click calls the handler once', () => {
    const onRetry = vi.fn();
    render(<DocsFailureView answer={failed('fetch-failed')} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('the slots: unreachable and unexpected-response offer Retry; auth and no-docs-route never do', () => {
    expect(retryFor({ s: 'unreachable' })).not.toBeNull();
    expect(retryFor({ s: 'unexpected-response', status: 502, contentType: 'text/html' })).not.toBeNull();
    expect(retryFor({ s: 'auth' })).toBeNull();
    expect(retryFor({ s: 'no-docs-route' })).toBeNull();
  });

  it('each slot renders its sentence; an unexpected-response with no content type says so', () => {
    const textOf = (answer: DocsNotOk): string | null => {
      const { unmount } = render(<DocsFailureView answer={answer} />);
      const text = screen.getByRole('alert').textContent;
      unmount();
      return text;
    };
    expect(textOf({ s: 'auth' })).toBe('Sign in to read Docs.');
    expect(textOf({ s: 'unreachable' })).toBe('The server could not be reached; Docs needs a connection.');
    expect(textOf({ s: 'unexpected-response', status: 502, contentType: 'text/html' }))
      .toBe('The server answered 502 (text/html).');
    expect(textOf({ s: 'unexpected-response', status: 500, contentType: '' }))
      .toBe('The server answered 500 (no content type).');
  });
});

describe('a pre-Docs server (M4.F6 = M7.1)', () => {
  it('a 404 {error: not-found} with no failure, through createApi, renders "predates Docs" and no docs sentence', async () => {
    const api = createApi((async () => new Response(JSON.stringify({ ok: false, error: 'not-found' }),
      { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } })) as typeof fetch);
    const answer = await api.docs.tree('demo', null);
    expect(answer.s).toBe('no-docs-route');
    if (answer.s === 'ok') return;
    render(<DocsFailureView answer={answer} onRetry={() => undefined} />);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toBe('This server predates Docs; update the server box.');
    for (const sentence of Object.values(DOCS_FAILURE_SENTENCE)) expect(text).not.toContain(stem(sentence));
  });
});

describe('T13 review 4-7: unresolved-ref names no side it did not search', () => {
  // A qualified ref (`refs/remotes/origin/feat`) is looked up on that one ref only, so the sentence cannot say
  // "locally or on origin"; the tried list beneath it carries which refs were searched.
  it('the sentence claims neither side, stays a sentence, and the one tried ref is listed under it', () => {
    const sentence = failureSentence(bodyOf('unresolved-ref', { tried: [{ ref: 'refs/remotes/origin/feat', result: 'absent' }] }));
    expect(sentence).not.toMatch(/locally|origin/);
    expect(sentence.length).toBeGreaterThanOrEqual(20);
    render(<DocsFailureView answer={failed('unresolved-ref', { tried: [{ ref: 'refs/remotes/origin/feat', result: 'absent' }] })} />);
    expect(screen.getByText(sentence)).toBeInTheDocument();
    expect(screen.getByText('refs/remotes/origin/feat').closest('li')).toHaveTextContent('refs/remotes/origin/feat not found');
    expect(document.querySelectorAll('li')).toHaveLength(1);
  });
});

describe('Review 439 F7, F8: no ? ever reaches a page', () => {
  /** The `{names}` a word's present-field sentence fills. */
  const fieldsOf = (template: string): string[] => [...template.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1] ?? '');
  const SAMPLE: Record<string, unknown> = { size: 4096, cap: 2048, count: 90000 };
  /** Every subset of `names`, the empty one and the full one included. */
  const subsets = (names: readonly string[]): string[][] =>
    names.reduce<string[][]>((acc, n) => [...acc, ...acc.map((s) => [...s, n])], [[]]);

  it('every failure word reads without a ? whichever of its optional fields the answer omits', () => {
    const words = Object.keys(DOCS_FAILURE_SENTENCE);
    expect(words.length).toBeGreaterThan(50);
    let cases = 0;
    for (const word of words) {
      const names = fieldsOf(DOCS_FAILURE_SENTENCE[word as DocsFailure]);
      for (const present of subsets(names)) {
        const ctx: Record<string, unknown> = {};
        for (const n of present) ctx[n] = SAMPLE[n] ?? 'x';
        const { unmount } = render(<DocsFailureView answer={failed(word, ctx)} />);
        const text = document.querySelector('.docs-fail-sentence')?.textContent ?? '';
        expect(text, `${word} with ${JSON.stringify(present)}`).not.toContain('?');
        expect(text, `${word} with ${JSON.stringify(present)}`).not.toMatch(/[{}]/);
        expect(text.length).toBeGreaterThanOrEqual(20);
        unmount();
        cases += 1;
      }
    }
    expect(cases).toBeGreaterThan(words.length);
  });

  it('ccd-fault names its exit code when it is measured, and says nothing about a number when it is not', () => {
    expect(failureSentence(bodyOf('ccd-fault', { code: 3 }))).toBe("The fleet box's ccd failed with exit code 3.");
    expect(failureSentence(bodyOf('ccd-fault'))).toBe("The fleet box's ccd failed; its exit code was not measured.");
  });

  it('too-many-entries, too-large and the other omitted-field sentences', () => {
    expect(failureSentence(bodyOf('too-many-entries', { count: 70000 })))
      .toBe('This repository has 70000 entries, more than Docs lists at once.');
    expect(failureSentence(bodyOf('too-many-entries', { bytes: 9 })))
      .toBe('This repository has more entries than Docs lists at once.');
    expect(failureSentence(bodyOf('too-large', { cap: 2048, bytes: 3000000 })))
      .toBe('This file is larger than Docs shows; Docs shows files of this kind up to 2 KiB.');
    expect(failureSentence(bodyOf('too-large', { size: 4096 })))
      .toBe('This file is 4 KiB, over the limit for files of this kind.');
    expect(failureSentence(bodyOf('too-large'))).toBe('This file is larger than Docs shows files of this kind.');
  });
});

describe('Review 439 F10: the "Did you mean" link navigates in the app', () => {
  it('a plain click is prevented and moves the location in place, with no document load', () => {
    history.pushState(null, '', '/docs/demo?ref=mian');
    render(<DocsFailureView answer={failed('unresolved-ref', { suggest: 'main' })} suggestHref={() => '/docs/demo?ref=main'} />);
    const link = screen.getByRole('link', { name: 'main' });
    expect(link).toHaveAttribute('href', '/docs/demo?ref=main');
    // fireEvent.click answers false when a handler called preventDefault: the browser then loads nothing.
    expect(fireEvent.click(link)).toBe(false);
    expect(location.pathname + location.search).toBe('/docs/demo?ref=main');
  });

  it('a modified click is left to the browser (a new tab)', () => {
    history.pushState(null, '', '/docs/demo?ref=mian');
    render(<DocsFailureView answer={failed('unresolved-ref', { suggest: 'main' })} suggestHref={() => '/docs/demo?ref=main'} />);
    // The app's handler must leave a modified click alone; this listener (it runs after React's) records that and then
    // stops jsdom from trying a real navigation.
    let leftToBrowser: boolean | null = null;
    const stop = (e: Event): void => { leftToBrowser = !e.defaultPrevented; e.preventDefault(); };
    document.addEventListener('click', stop);
    fireEvent.click(screen.getByRole('link', { name: 'main' }), { ctrlKey: true });
    document.removeEventListener('click', stop);
    expect(leftToBrowser).toBe(true);
    expect(location.pathname + location.search).toBe('/docs/demo?ref=mian');
  });
});
