// The digest screen (coordinator-first routing plan Task 17, spec §10, D-5300): one line per decision in the order the
// server sent, the totals, a Correct control per line whose sentence is posted for that row, and the refusals said in
// words. Layout is not measurable in jsdom: the widths below prove every line and control is rendered at each, and
// the stylesheet rules they depend on are pinned here; the Playwright measurements are in the PR body.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DigestAnswer, DigestLine } from '../../shared/api';
import { DigestScreen, asDigestAnswer, digestTotalsText, utcClock } from '../src/screens/DigestScreen';
import { ApiError } from '../src/lib/api';
import { CALL_REFUSAL_TEXT, type CallRefusal } from '../src/ledgers/callWords';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const PARENT = 'project-a-calm-mesa';
const CHILD = 'project-a-quiet-basin';
const T = Date.parse('2026-10-17T08:00:00Z');
const line = (o: Partial<DigestLine> & Pick<DigestLine, 'id' | 'kind' | 'rowKind'>): DigestLine => ({
  at: T + o.id * 60_000, coordinator: PARENT, childId: CHILD,
  text: o.rowKind === 'ask' ? 'Which colour?' : 'rm -rf build', tool: o.rowKind === 'ask' ? null : 'Bash',
  class: o.rowKind === 'ask' ? null : 'ordinary', answer: null, reason: null, corrected: false, ...o,
});
const LINES: DigestLine[] = [
  line({ rowKind: 'ask', id: 1, kind: 'answer', answer: 'Red' }),
  line({ rowKind: 'approval', id: 2, kind: 'allow', reason: 'inside the worktree' }),
  line({ rowKind: 'ask', id: 3, kind: 'answer', answer: 'Blue', coordinator: 'project-b-far-ridge' }),
  line({ rowKind: 'approval', id: 4, kind: 'deny', class: 'escalate', reason: 'outside the worktree' }),
  line({ rowKind: 'ask', id: 5, kind: 'hand-over' }),
  line({ rowKind: 'approval', id: 6, kind: 'lapse', text: `echo ${'x'.repeat(150)}` }),
];
const DIGEST: DigestAnswer = {
  v: 1, day: '2026-10-18', hourUtc: 7, fromMs: Date.parse('2026-10-17T07:00:00Z'), toMs: Date.parse('2026-10-18T07:00:00Z'),
  totals: { decisions: 6, answers: 2, allows: 1, denies: 1, handOvers: 1, lapses: 1, calls: 0, guardForbidden: 1 },
  byCoordinator: [{ coordinator: PARENT, decisions: 5 }, { coordinator: 'project-b-far-ridge', decisions: 1 }],
  lines: LINES, sentAt: Date.parse('2026-10-18T07:00:30Z'), pushed: true,
};

describe('the digest screen (D-5300)', () => {
  it('reads the day it was opened on, and lists the six decisions in order under the totals', async () => {
    const load = vi.fn().mockResolvedValue(DIGEST);
    render(<DigestScreen day="2026-10-18" load={load} />);
    const rows = await screen.findAllByRole('listitem', { name: undefined });
    expect(load).toHaveBeenCalledWith('2026-10-18');
    const lines = rows.filter((r) => r.classList.contains('digest-row'));
    expect(lines.map((r) => r.querySelector('.digest-kind')?.textContent)).toEqual(
      ['answered', 'allowed', 'answered', 'denied', 'handed over', 'lapsed']);
    expect(lines[0]!.textContent).toContain('answer: Red');
    expect(lines[1]!.textContent).toContain('Bash · ordinary · reason: inside the worktree');
    expect(lines[0]!.querySelector('.digest-when')?.textContent).toBe('08:01 UTC');
    expect(screen.getByText('6 decisions · 2 answered · 1 allowed · 1 denied · 1 handed over · 1 lapsed · 1 refused by the guard'))
      .toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'decisions by coordinator' }).textContent).toContain(`${PARENT} · 5`);
  });

  it('a correction posts that row\'s id and the sentence as written, then reads the digest again', async () => {
    const load = vi.fn().mockResolvedValueOnce(DIGEST)
      .mockResolvedValue({ ...DIGEST, lines: LINES.map((l) => (l.id === 2 ? { ...l, corrected: true } : l)) });
    const correct = vi.fn().mockResolvedValue({ ok: true, mailId: 9, deliveryId: 11 });
    render(<DigestScreen day="2026-10-18" load={load} correct={correct} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct approval 2' }));
    const form = screen.getByRole('form', { name: 'Correction for approval 2' });
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: '  Deny anything outside build/.  ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send correction' }));
    await waitFor(() => expect(correct).toHaveBeenCalledWith({ rowKind: 'approval', id: 2, text: '  Deny anything outside build/.  ' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Correction sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct approval 2' })).toBeNull();
  });

  it('a refused correction is said in words, and the field keeps what was typed', async () => {
    const correct = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: 'not-coordinator' }));
    render(<DigestScreen day="2026-10-18" load={vi.fn().mockResolvedValue(DIGEST)} correct={correct} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct ask 1' }));
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Blue.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No coordinator decided this line, so there is no one to correct.');
    expect((box as HTMLTextAreaElement).value).toBe('Blue.');
  });

  it('an empty day says so, and a server with no coordination record says that', async () => {
    render(<DigestScreen day="2026-10-18" load={vi.fn().mockResolvedValue({ ...DIGEST, lines: [], byCoordinator: [],
      totals: { ...DIGEST.totals, decisions: 0, answers: 0, allows: 0, denies: 0, handOvers: 0, lapses: 0, calls: 0, guardForbidden: 0 } })} />);
    expect(await screen.findByText('Coordinators decided nothing in your name in this window.')).toBeInTheDocument();
    cleanup();
    render(<DigestScreen day={null} load={vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'not-configured' }))} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This server keeps no coordination record');
  });

  for (const width of [360, 390, 1280, 1920]) {
    it(`renders every line and its Correct control at ${width} px`, async () => {
      window.innerWidth = width;
      window.dispatchEvent(new Event('resize'));
      render(<DigestScreen day="2026-10-18" load={vi.fn().mockResolvedValue(DIGEST)} />);
      expect(await screen.findAllByRole('button', { name: /^Correct (ask|approval) \d+$/ })).toHaveLength(6);
      expect(document.querySelectorAll('.digest-row')).toHaveLength(6);
      expect(screen.getByRole('button', { name: 'Previous day' })).toBeInTheDocument();
    });
  }

  it('the stylesheet lets every line shrink to a phone and break a child\'s long command', () => {
    const css = readFileSync(path.join(__dirname, '..', 'src', 'screens', 'digest.css'), 'utf8');
    const rule = (sel: string): string => {
      const m = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
      if (!m) throw new Error(`no rule for ${sel}`);
      return m[1]!;
    };
    expect(rule('.digest-row')).toContain('grid-template-columns: auto minmax(0, 1fr) auto');
    for (const sel of ['.digest-row .digest-text', '.digest-row .digest-who', '.digest-row .digest-detail', '.digest-totals']) {
      expect(rule(sel), sel).toContain('overflow-wrap: anywhere');
    }
    expect(rule('.digest-days')).toContain('flex-wrap: wrap');
    expect(rule('.digest-correct-actions')).toContain('flex-wrap: wrap');
  });
});

describe('the digest screen\'s helpers', () => {
  it('the wire guard drops a line it cannot render, and refuses an answer of another version', () => {
    const d = asDigestAnswer({ ...DIGEST, lines: [...LINES, { rowKind: 'run', id: 7 }, null] });
    expect(d?.lines).toHaveLength(6);
    expect(asDigestAnswer({ ...DIGEST, v: 2 })).toBeNull();
    expect(asDigestAnswer('nope')).toBeNull();
  });
  it('times are UTC, and the totals leave out zeros', () => {
    expect(utcClock(Date.parse('2026-10-18T07:05:59Z'))).toBe('07:05 UTC');
    expect(digestTotalsText({ ...DIGEST, totals: { decisions: 1, answers: 0, allows: 1, denies: 0, handOvers: 0, lapses: 0, calls: 0, guardForbidden: 0 } }))
      .toBe('1 decision · 1 allowed');
  });
});
describe('call lines (D-8126)', () => {
  const callLineRow = line({ rowKind: 'call', id: 7, kind: 'big-call', childId: '', text: 'Which store?', tool: null, class: null, answer: 'Postgres', reason: 'it is already in use' });
  const withCall = { ...DIGEST, lines: [callLineRow] };
  it('the wire guard keeps a call line, and it names the call, the chosen option and the reason', async () => {
    expect(asDigestAnswer(withCall)?.lines).toHaveLength(1);
    render(<DigestScreen day="2026-10-18" load={vi.fn().mockResolvedValue(withCall)} />);
    const row = (await screen.findByText('called')).closest('li')!;
    expect(row.querySelector('.digest-what')?.textContent).toBe('call');
    expect(row.textContent).toContain('Which store?');
    expect(row.textContent).toContain('chose: Postgres · reason: it is already in use');
    expect(row.querySelector('.digest-child')).toBeNull();
  });
  it('its correction posts rowKind call', async () => {
    const correct = vi.fn().mockResolvedValue({ ok: true, mailId: 9, deliveryId: 11 });
    render(<DigestScreen day="2026-10-18" load={vi.fn().mockResolvedValue(withCall)} correct={correct} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct call 7' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Use SQLite.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send correction' }));
    await waitFor(() => expect(correct).toHaveBeenCalledWith({ rowKind: 'call', id: 7, text: 'Use SQLite.' }));
  });
});

// Fix round 1 (review 2792 F5): ONE owner of the call refusal sentences. A call line's correction says every refusal the
// correction door can answer for a call in `callWords.ts`'s words, read from the door's own result type, so a code the server
// adds without a sentence reds here instead of reaching the operator as a bare slug.
describe('a call line\'s correction refusals (D-8126)', () => {
  const src = readFileSync(path.resolve(__dirname, '../../server/src/coord/digest.ts'), 'utf8');
  const union = /export type DigestCorrectResult =[\s\S]*?why: ([^}]*)\}/.exec(src)?.[1] ?? '';
  const codes = [...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);
  /** Not a call's: the other row kinds' unknown rows, and the store's 503, which reads as the transport words. */
  const NOT_A_CALLS = ['unknown-ask', 'unknown-approval', 'digest-unreadable'];

  it('reads the door\'s codes', () => {
    expect(codes).toEqual(expect.arrayContaining(['unknown-call', 'not-coordinator', 'duplicate', ...NOT_A_CALLS]));
  });

  for (const code of ['unknown-call', 'not-coordinator', 'duplicate']) {
    it(`${code} is said in the call table's words`, async () => {
      const callRow = line({ rowKind: 'call', id: 7, kind: 'big-call', childId: '', text: 'Which store?', tool: null, class: null, answer: 'sql', reason: 'r' });
      const correct = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: code }));
      render(<DigestScreen day="2026-10-18" load={vi.fn().mockResolvedValue({ ...DIGEST, lines: [callRow] })} correct={correct} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Correct call 7' }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Use files.' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send correction' }));
      expect((await screen.findByRole('alert')).textContent).toBe(CALL_REFUSAL_TEXT[code as CallRefusal]);
    });
  }

  it('every code the door answers for a call has a sentence in the call table', () => {
    const forCalls = codes.filter((c) => !NOT_A_CALLS.includes(c));
    expect(forCalls.filter((c) => !(c in CALL_REFUSAL_TEXT))).toEqual([]);
  });
});
