// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md): Settings › Automation › Test box's Claude Code builds in
// jsdom. The list is read at the fetch (`GET /api/testbox/builds`), each row says its verdict in words, a failure carries its
// replay output and Capture again, and the write is held at the fetch: `{build}` and nothing else, the answer installed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ClaudeBuildRecord } from '../../../shared/claudeBuildTrust';
import { TESTBOX_BUILDS_TEXT, TestBoxBuilds, buildVerdict } from './TestBoxBuilds';

const T = TESTBOX_BUILDS_TEXT;
const rec = (build: string, over: Partial<ClaudeBuildRecord> = {}): ClaudeBuildRecord => ({
  build, source: 'fleet', capture: 'queued', cwd: false, seenAt: Date.now() - 3_600_000, attempts: 0, lastAttemptAt: null,
  notSent: null, verdictAt: null, output: null, ...over,
});
const BUILDS: ClaudeBuildRecord[] = [
  rec('2.1.321', { capture: 'fail', attempts: 1, verdictAt: 1, output: 'replay: 1 failed\nStop: the field background is missing' }),
  rec('2.1.320', { attempts: 2 }),
  rec('2.1.310', { capture: 'pass', cwd: false, attempts: 1 }),
  rec('2.1.302', { source: 'rig', capture: 'pass', cwd: true, seenAt: 0, verdictAt: 0 }),
];

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const rowOf = (build: string): HTMLElement => document.querySelector<HTMLElement>(`[data-build="${build}"]`)!;

function stub(answer: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => { calls.push({ url: String(url), init }); return answer(String(url), init); }));
  return calls;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the build list (D-8289)', () => {
  it('every build in its row, newest first, with its verdict and where it came from', async () => {
    stub(() => json({ ok: true, claudeBuilds: BUILDS }));
    render(<TestBoxBuilds band="laptop" />);
    await settle();
    const list = screen.getByRole('list', { name: T.title });
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-build'))).toEqual(['2.1.321', '2.1.320', '2.1.310', '2.1.302']);
    expect(rowOf('2.1.302')).toHaveTextContent(T.trusted);
    expect(rowOf('2.1.302')).toHaveTextContent(T.rig);
    expect(rowOf('2.1.310')).toHaveTextContent(T.trustedNoCwd);
    expect(rowOf('2.1.320')).toHaveTextContent(T.queuedSent(2));
    expect(rowOf('2.1.320')).toHaveTextContent(/First seen on the fleet .* ago/);
    expect(rowOf('2.1.321')).toHaveTextContent(T.failed);
  });

  it('only a failed build carries its output and Capture again', async () => {
    stub(() => json({ ok: true, claudeBuilds: BUILDS }));
    render(<TestBoxBuilds band="laptop" />);
    await settle();
    expect(within(rowOf('2.1.321')).getByText(T.output)).toBeInTheDocument();
    expect(rowOf('2.1.321').querySelector('pre')?.textContent).toBe('replay: 1 failed\nStop: the field background is missing');
    expect(within(rowOf('2.1.321')).getByRole('button', { name: T.again })).toBeEnabled();
    for (const b of ['2.1.320', '2.1.310', '2.1.302']) expect(within(rowOf(b)).queryByRole('button')).toBeNull();
  });

  it('Capture again posts {build} and nothing else, and installs the answer', async () => {
    const calls = stub((url) => (url.endsWith('/capture')
      ? json({ ok: true, claudeBuilds: [rec('2.1.321', { attempts: 1 }), ...BUILDS.slice(1)] })
      : json({ ok: true, claudeBuilds: BUILDS })));
    render(<TestBoxBuilds band="phone" />);
    await settle();
    fireEvent.click(within(rowOf('2.1.321')).getByRole('button', { name: T.again }));
    await settle();
    const sent = calls.filter((c) => c.url.endsWith('/api/testbox/builds/capture'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(sent[0]!.init?.body))).toEqual({ build: '2.1.321' });
    expect(rowOf('2.1.321')).toHaveTextContent(T.queuedSent(1));
    expect(screen.getByText(T.queuedAgain)).toBeInTheDocument();
  });

  it('a refusal says the server\'s detail, and the list stays as it was', async () => {
    stub((url) => (url.endsWith('/capture')
      ? json({ ok: false, error: 'conflict', detail: 'build 2.1.321 has not failed its capture' }, 409)
      : json({ ok: true, claudeBuilds: BUILDS })));
    render(<TestBoxBuilds band="wide" />);
    await settle();
    fireEvent.click(within(rowOf('2.1.321')).getByRole('button', { name: T.again }));
    await settle();
    expect(screen.getByText('build 2.1.321 has not failed its capture')).toBeInTheDocument();
    expect(rowOf('2.1.321')).toHaveTextContent(T.failed);
  });

  it('a read the wire reader refuses says so, never an empty list', async () => {
    stub(() => json({ ok: true, claudeBuilds: [{ build: '2.1.321', capture: 'maybe' }] }));
    render(<TestBoxBuilds band="laptop" />);
    await settle();
    expect(screen.getByText(T.unread)).toBeInTheDocument();
    expect(screen.queryByText(T.empty)).toBeNull();
  });

  it('buildVerdict: amber only for a failure', () => {
    expect(BUILDS.map((b) => buildVerdict(b).amber)).toEqual([true, false, false, false]);
    expect(buildVerdict(rec('2.1.330')).text).toBe(T.queued);
  });

  it('a build the queue could not send says so, never "sent N times", and the card says no build can be captured', async () => {
    const blocked = [rec('2.1.330', { lastAttemptAt: 9, notSent: 'no-runner' }), rec('2.1.329', { lastAttemptAt: 5, notSent: 'no-runner' }), ...BUILDS.slice(2)];
    stub(() => json({ ok: true, claudeBuilds: blocked }));
    render(<TestBoxBuilds band="phone" />);
    await settle();
    for (const b of ['2.1.330', '2.1.329']) {
      expect(rowOf(b)).toHaveTextContent(T.notSent['no-runner']);
      expect(rowOf(b)).not.toHaveTextContent(/sent \d+ time/);
    }
    expect(buildVerdict(blocked[0]!)).toEqual({ text: T.notSent['no-runner'], amber: true });
    expect(document.querySelector('[data-testbox="builds-blocked"]')).toHaveTextContent(T.blocked['no-runner']);
  });

  it('no test box answering is said the same way; a queue that sends its jobs shows no such note', async () => {
    stub(() => json({ ok: true, claudeBuilds: [rec('2.1.330', { lastAttemptAt: 9, notSent: 'no-test-box' })] }));
    render(<TestBoxBuilds band="laptop" />);
    await settle();
    expect(rowOf('2.1.330')).toHaveTextContent(T.notSent['no-test-box']);
    expect(document.querySelector('[data-testbox="builds-blocked"]')).toHaveTextContent(T.blocked['no-test-box']);
    cleanup();
    stub(() => json({ ok: true, claudeBuilds: BUILDS }));
    render(<TestBoxBuilds band="laptop" />);
    await settle();
    expect(document.querySelector('[data-testbox="builds-blocked"]')).toBeNull();
  });
});
