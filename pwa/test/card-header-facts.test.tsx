// D-5545: a session CARD is a glance and its HEADER shows everything the card does.
// One pure model (`sessionFacts.ts`) decides both; these cases pin the rule both
// ways — the model's card facts are a subset of its header facts, and the
// rendered card's facts are all in the rendered header, in both skins.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { fleetSession, DEAD_LIFECYCLE } from './fleetFixture';
import { SessionLine } from '../src/fleet/SessionLine';
import { RunRow } from '../src/screens/RunRow';
import { RunDetailScreen } from '../src/screens/RunDetailScreen';
import { api } from '../src/lib/api';
import { createFleetStore } from '../src/stores/fleet';
import { backgroundWords, type RunSummary } from '../../shared/api';
import { SessionHeaderHost, type HeaderHostProps } from './sessionHost';
import {
  COORDINATOR_WORD, HEADER_COUNT_ALLOWANCES, MARKER_ORDER, NAME_BUDGET, ROLE_CELL_CHARS, cardFacts, cardWithinHeader, headerFacts, headerStatusWord, markers,
  sessionFacts, shortenByToken, type FactInput,
} from '../src/fleet/sessionFacts';
import type { ChildRunContext } from '../src/fleet/runWords';
import { setSkin } from '../src/lib/skin';
import { activity } from './delegationFixture';

afterEach(cleanup);

const NOW = 1_800_000_000_000;
const s = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id: 'lane-a-project-a-still-pond', wrapper: 'lane-a', home: 'lane-a', project: 'project-a',
  workspace: 'still-pond', statusUpdatedAt: NOW - 120_000, ...over,
});
const RUN = { program: 'port-api', programTitle: 'Port the API', wave: 5, waveOf: 7, kind: 'work' as const };
const REVIEW = { ...RUN, kind: 'review' as const };
const child = (run: ChildRunContext['run'], coordinator: string | null = 'programme coordinator'): ChildRunContext =>
  ({ run, coordinator });

/** The realistic fixtures the measurement used: every kind of row the card must glance at. */
const CASES: Record<string, FactInput> = {
  'a held dispatched child': {
    session: s({ role: 'child', child: { kind: 'child', runId: 40 }, held: 'program:port-api wave:5/7 run:40',
      status: 'busy', bucket: 'working', branch: 'ws/still-pond', tasks: { done: 2, total: 5, running: 1, active: null },
      subagents: [{ name: 'code-reviewer', startedAt: NOW - 60_000 }] }),
    now: NOW, childRun: child(RUN),
  },
  'a coordinator': {
    session: s({ id: 'lane-a-project-a', workspace: null, name: 'programme coordinator', role: 'coordinator',
      status: 'busy', bucket: 'working', branch: 'main', tasks: { done: 3, total: 7, running: 1, active: null } }),
    now: NOW,
  },
  'a cross-project review child': {
    session: s({ id: 'lane-b-project-b-amber-field', project: 'project-b', workspace: 'amber-field', role: 'child',
      child: { kind: 'child', runId: 42 }, held: 'program:port-api wave:5/7 run:42', boardProject: 'project-a' }),
    now: NOW, childRun: child(REVIEW), workingOn: 'project-b',
  },
  'an orphan whose coordinator is gone': {
    session: s({ workspace: 'lone-reed', role: 'child', child: { kind: 'child', runId: 44 },
      held: 'program:terminal-drawer-fit wave:3/5 run:44' }),
    now: NOW, childRun: child({ ...RUN, program: 'terminal-drawer-fit', wave: 3, waveOf: 5 }, 'gone'), coordinator: 'dead',
  },
  'a hold whose run left the board': {
    session: s({ workspace: 'gray-moss', role: 'child', child: { kind: 'child', runId: 504 },
      held: 'program:terminal-drawer-fit wave:3/5 run:504' }),
    now: NOW,
  },
  'a plain operator workspace with a PR': {
    session: s({ workspace: 'bright-lake', role: 'coordinator', branch: 'feat/a-long-descriptive-branch-name-for-the-sidebar',
      pr: { phase: 'open', number: 123, url: null, title: null, checks: 'pass', checkNames: null, ahead: 1, reason: null,
        checkedAt: NOW, mergedAt: null, retryAt: null } }),
    now: NOW,
  },
  'a busy session under context pressure': {
    session: s({ status: 'busy', bucket: 'working', ctxPct: 86 }), now: NOW,
  },
  'a limit-hit session whose swap was refused': {
    session: s({ wrapper: 'lane-c', home: 'lane-c', limits: { five: 97, seven: 64 },
      swapBlocked: { at: NOW - 600_000, reason: 'no eligible account has headroom under the spend cap right now' } }),
    now: NOW,
  },
  'a long name waiting on the operator': {
    session: s({ name: 'an-exceptionally-long-session-name-that-will-not-fit-on-a-phone-screen', bucket: 'attention',
      hookState: 'waiting', askSummary: 'Keep the old migration path?' }),
    now: NOW,
  },
  // Verifier round 1: the rows the first suite lacked.
  'a dead session that is not hibernated': {
    session: s({ workspace: 'still-pond', status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'dead' }), now: NOW,
  },
  'a hand-held workspace (held, no child mark)': {
    session: s({ workspace: 'calm-bay', held: 'waiting on the schema decision' }), now: NOW,
  },
  'a working row whose coordinator holds its question': {
    session: s({ workspace: 'dry-creek', status: 'busy', bucket: 'working', role: 'child',
      withCoordinator: { kind: 'question', parentId: 'lane-a-project-a', since: NOW - 30_000, notifyAt: NOW + 150_000 },
      ask: { state: 'held', parentId: 'lane-a-project-a' } } as Partial<FleetSession>),
    now: NOW,
  },
  'a cleanup row with its merged PR': {
    session: s({ workspace: 'wide-delta', bucket: 'cleanup', archivedBytes: 4_200_000,
      pr: { phase: 'merged', number: 77, url: null, title: null, checks: 'pass', checkNames: null, ahead: 0, reason: null,
        checkedAt: NOW, mergedAt: NOW - 60_000, retryAt: null } }),
    now: NOW,
  },
  'a working row with work in the background': {
    session: s({ workspace: 'soft-dune', status: 'idle', bucket: 'working', background: { count: 2, kinds: ['bash', 'agent'] } }),
    now: NOW,
  },
  // D-8276: an older Claude Code build than the fleet's newest: the quietest marker, and the header names the pair.
  'a session behind the fleet\'s newest Claude Code build': {
    session: s({ workspace: 'quiet-fen', version: '2.1.296' }), now: NOW, claudeLatest: '2.1.302', claudeLaneLatest: '2.1.302',
  },
  'an unreachable pane with every other marker too': {
    session: s({ substrate: { at: NOW - 60_000, text: 'tmux socket gone' }, limits: { five: 99, seven: null },
      swapBlocked: { at: NOW, reason: 'no headroom' }, unmeasured: ['uuid'] }),
    now: NOW,
  },
};

describe('the model (D-5545)', () => {
  for (const [name, input] of Object.entries(CASES)) {
    it(`${name}: every card fact is a header fact, with its full text`, () => {
      const f = sessionFacts(input);
      expect(cardWithinHeader(cardFacts(f), headerFacts(f))).toEqual([]);
    });

    it(`${name}: the card carries no bookkeeping id and at most one marker`, () => {
      const c = cardFacts(sessionFacts(input));
      const shown = [c.name.short ?? c.name.text, c.status.text, c.context?.short ?? c.context?.text,
        c.marker?.short ?? c.marker?.text].filter(Boolean).join(' | ');
      expect(shown).not.toMatch(/run #\d|run:\d|program:|wave:\d/);
    });
  }

  it('a coordinator\'s card names its role; a child\'s never does (D-8142)', () => {
    for (const [name, input] of Object.entries(CASES)) {
      const role = cardFacts(sessionFacts(input)).role;
      if (input.session.role === 'coordinator') {
        expect(role, name).toMatchObject({ key: 'role', text: 'coordinator' });
      } else {
        expect(role, name).toBeNull();
      }
    }
    expect(cardFacts(sessionFacts(CASES['a coordinator']!)).role).toEqual(
      { key: 'role', text: COORDINATOR_WORD, title: 'this session is its project\'s coordinator' });
    expect(cardFacts(sessionFacts(CASES['a coordinator']!)).role).not.toBeNull();
    expect(cardFacts(sessionFacts(CASES['a plain operator workspace with a PR']!)).role).not.toBeNull();
    for (const c of ['a held dispatched child', 'a hold whose run left the board']) {
      expect(cardFacts(sessionFacts(CASES[c]!)).role, c).toBeNull();
    }
    // An older server sends no role: a worker, so no role fact.
    const older = s({ workspace: 'old-pond' }) as unknown as Record<string, unknown>;
    delete older.role;
    expect(cardFacts(sessionFacts({ session: older as unknown as FleetSession, now: NOW })).role).toBeNull();
    expect(cardFacts(sessionFacts({ session: s({ role: null as never }), now: NOW })).role).toBeNull();
  });

  it('a coordinator with a long branch keeps both whole on the card (D-8142, D-8817)', () => {
    const branch = 'feat/a-long-descriptive-branch-name-for-the-sidebar';
    const f = sessionFacts({ session: s({ workspace: 'bright-lake', name: 'bright-lake', role: 'coordinator', branch }), now: NOW });
    const c = cardFacts(f);
    expect(c.role?.text).toBe('coordinator');
    // As at main, the shortened branch spelt out; the budget is the badge's cell (`ROLE_CELL_CHARS`), no longer the word's.
    expect(c.context).toMatchObject({ key: 'branch', text: branch, short: 'feat/a-long…' });
    expect(c.context!.short!.length + ROLE_CELL_CHARS).toBeLessThanOrEqual(NAME_BUDGET);
    // A child, and a coordinator with no role cell to make room for, keep the full budget.
    const kid = cardFacts(sessionFacts({ session: s({ workspace: 'bright-lake', name: 'bright-lake', role: 'child', branch }), now: NOW }));
    expect(kid.context?.short).toBe(shortenByToken(branch, NAME_BUDGET));
  });

  it('the role cell is the badge\'s width: a branch the word\'s 14 characters cut shorter is kept longer beside the badge (D-8817)', () => {
    // At main (budget 28 - 14 = 14) this branch shortened to `feat/garden…`; at the badge's cell (28 - 6 = 22) it keeps
    // another token, and the child's full budget (28) keeps one more still. Each is spelt out, so a wrong cell width reds here.
    const branch = 'feat/garden-stone-silver-harbor-morning-cedars-quiet-river-run';
    const lead = cardFacts(sessionFacts({ session: s({ workspace: 'bright-lake', name: 'bright-lake', role: 'coordinator', branch }), now: NOW }));
    expect(lead.context).toMatchObject({ key: 'branch', short: 'feat/garden-stone…' });
    expect(lead.context!.short!.length + ROLE_CELL_CHARS).toBeLessThanOrEqual(NAME_BUDGET);
    const kid = cardFacts(sessionFacts({ session: s({ workspace: 'bright-lake', name: 'bright-lake', role: 'child', branch }), now: NOW }));
    expect(kid.context?.short).toBe('feat/garden-stone-silver…');
    expect(lead.context!.short).not.toBe(kid.context!.short);
  });

  it('a child names its programme and wave on the card; the header keeps the verbatim hold and the coordinator', () => {
    const f = sessionFacts(CASES['a held dispatched child']!);
    expect(cardFacts(f).context).toMatchObject({ key: 'programme', text: 'port-api · wave 5 of 7' });
    const h = headerFacts(f);
    expect(h).toContainEqual(expect.objectContaining({ key: 'hold', text: 'held: program:port-api wave:5/7 run:40' }));
    expect(h).toContainEqual(expect.objectContaining({ key: 'coordinator', text: 'programme coordinator' }));
    expect(h).toContainEqual(expect.objectContaining({ key: 'tasks', text: '2/5 tasks' }));
    // H3 (D-8875): its subagent is the Helpers section's row, so the header carries no count of it.
    expect(h.map((x) => x.key)).not.toContain('subagents');
  });

  it('a review child reads "review of wave N"', () => {
    expect(cardFacts(sessionFacts(CASES['a cross-project review child']!)).context?.text).toBe('port-api · review of wave 5');
  });

  it('the orphan marker is "coordinator gone", once, on the card', () => {
    const c = cardFacts(sessionFacts(CASES['an orphan whose coordinator is gone']!));
    expect(c.marker).toMatchObject({ key: 'coordinator-gone', text: 'coordinator gone' });
  });

  it('a hold whose run left the board says so in words, never the run number', () => {
    const c = cardFacts(sessionFacts(CASES['a hold whose run left the board']!));
    expect(c.context?.text).toBe('run not on the board');
  });

  it('a plain workspace shows its PR as its one context fact', () => {
    expect(cardFacts(sessionFacts(CASES['a plain operator workspace with a PR']!)).context?.text).toBe('PR #123');
  });

  it('the marker is the FIRST present in MARKER_ORDER, and the header lists every one', () => {
    const f = sessionFacts(CASES['an unreachable pane with every other marker too']!);
    expect(cardFacts(f).marker?.key).toBe('unreachable');
    expect(markers(f).map((m) => m.key)).toEqual(['unreachable', 'swap-blocked', 'limit', 'unreadable']);
    const keys = headerFacts(f).map((h) => h.key);
    for (const k of ['unreachable', 'swap-blocked', 'limit', 'unreadable'] as const) expect(keys).toContain(k);
  });

  it('a long refusal reads as its short word on the card and in full in the header', () => {
    const f = sessionFacts(CASES['a limit-hit session whose swap was refused']!);
    const m = markers(f).find((x) => x.key === 'swap-blocked')!;
    expect(m.short).toBe('swap blocked');
    expect(headerFacts(f)).toContainEqual(expect.objectContaining({ key: 'swap-blocked', text: m.text }));
    expect(m.text).toContain('no eligible account');
  });

  it('a waiting row "needs you"; a question its coordinator holds is "with coordinator"', () => {
    expect(cardFacts(sessionFacts(CASES['a long name waiting on the operator']!)).marker?.key).toBe('needs-you');
    expect(MARKER_ORDER.indexOf('needs-you')).toBeLessThan(MARKER_ORDER.indexOf('with-coordinator'));
  });
});

describe('shortenByToken — long names shorten by rule, never mid-token', () => {
  it('keeps a text that fits', () => {
    expect(shortenByToken('port-api', 16)).toBe('port-api');
  });

  it('cuts at a token boundary and marks the cut', () => {
    expect(shortenByToken('an-exceptionally-long-session-name-that-will-not-fit', 30)).toBe('an-exceptionally-long-session…');
    expect(shortenByToken('feat/a-long-descriptive-branch-name', 20)).toBe('feat/a-long…');
  });

  it('never splits a token, even one longer than the budget', () => {
    expect(shortenByToken('supercalifragilistic-x', 8)).toBe('supercalifragilistic…');
    for (const text of ['terminal-drawer-fit-and-finish', 'a/b/c/defghij', 'one two three four', 'x_y.z-w']) {
      for (let max = 1; max <= text.length; max += 1) {
        const out = shortenByToken(text, max);
        if (out === text) continue;
        const kept = out.slice(0, -1);
        expect(out.endsWith('…')).toBe(true);
        expect(text.startsWith(kept)).toBe(true);
        expect(/[-/_. ]/.test(text[kept.length] ?? '-')).toBe(true);
      }
    }
  });
});

const headerProps = (over: Partial<HeaderHostProps>): HeaderHostProps => ({
  session: null, status: 'idle', statusUpdatedAt: null,
  onInterrupt: vi.fn(), onOpenTerminal: vi.fn(), onBack: vi.fn(), onChangeModel: vi.fn(), onChangeEffort: vi.fn(),
  onMoveAccount: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn(), onOpenHistory: vi.fn(), onReapWorkspace: vi.fn(),
  ...over,
});

/** The text a reader SEES in a subtree — never a `title`, which a phone cannot show, nor an `sr-only` span
 *  (verifier round 1). `aria-hidden` text IS seen (TypedLabel's settled value is drawn that way). */
const visible = (el: Element): string => {
  const c = el.cloneNode(true) as Element;
  for (const x of c.querySelectorAll('.sr-only')) x.remove();
  return (c.textContent ?? '').replace(/\s+/g, ' ');
};

describe('the rendered card is a glance, and the rendered header holds all of it (both skins)', () => {
  for (const skin of ['refined', 'instrument'] as const) {
    for (const [name, input] of Object.entries(CASES)) {
      it(`${skin} · ${name}`, () => {
        act(() => setSkin(skin));
        const { container: card } = render(
          <SessionLine session={input.session} onOpen={() => {}} onActions={() => {}} now={input.now}
            childRun={input.childRun} workingOn={input.workingOn ?? null} coordinator={input.coordinator ?? null}
            claudeLatest={input.claudeLatest ?? null} claudeLaneLatest={input.claudeLaneLatest ?? null} />,
        );
        const meta = card.querySelector('.sess-meta')!;
        // The glance: a status, at most one context, at most one marker — nothing else on the meta line.
        expect(meta.children.length).toBeLessThanOrEqual(3);
        // …and across the whole card: one marker at most, one context line at most.
        expect(card.querySelectorAll('[data-marker], .sess-spawn').length).toBeLessThanOrEqual(1);
        expect(card.querySelectorAll('.sess-meta').length).toBeLessThanOrEqual(2);
        expect(card.querySelector('.sess-acct')).toBeNull();
        expect(card.querySelector('.sess-ask')).toBeNull();
        expect(card.textContent).not.toMatch(/run #\d|run:\d|program:|wave:\d/);

        const facts = sessionFacts(input);
        const c = cardFacts(facts);
        render(<SessionHeaderHost {...headerProps({ session: input.session, status: input.session.status, facts, })} />);
        const head = document.querySelector('.chat-head')!;
        const toggle = screen.queryByRole('button', { name: /details/i });
        if (toggle !== null && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
        const text = visible(head);
        // The card's status word as the CARD renders it, in the header's visible text.
        const cardWord = visible(card.querySelector('.sess-state')!);
        // D-8771's one allowance, read from its table row (`HEADER_COUNT_ALLOWANCES`, never a copy of its regex) and applied
        // to the STATUS check only, on the header's own status element, where the row's anchor means something: the card
        // says `in background` and the header keeps its count, so the count is set aside for the card's words, and the
        // header is asserted to still carry it. Every other fact is looked for in the header's text as it is.
        const allow = HEADER_COUNT_ALLOWANCES.find((a) => a.key === 'status')!;
        const headerStatus = (head.querySelector('.status-line')?.textContent ?? '').replace(/\s+/g, ' ').trim();
        expect(headerStatus, 'the header draws a status word').not.toBe('');
        const uncounted = allow.card.replace(/^ · /, '');
        if (cardWord.includes(uncounted)) expect(headerStatus, 'the header keeps the background count').toMatch(allow.count);
        // Both forms, as the rule has them (L1-1): the header's status as it is, or with the count set aside.
        expect([headerStatus, headerStatus.replace(allow.count, allow.card)].some((t) => t.includes(cardWord)),
          'the card\'s status word is missing from the header').toBe(true);
        for (const fact of [c.name, c.context, c.marker, c.workingOn]) {
          if (fact !== null) expect(text, `${fact.key} missing from the header`).toContain(fact.text);
        }
        // D-8142, D-8817: a coordinator's context line begins with the one role badge, which draws no word; the header
        // draws the same badge in its details, by its accessible name. A child has none.
        const roles = card.querySelectorAll('.sess-role');
        if (input.session.role === 'coordinator') {
          expect(roles.length).toBe(1);
          const ctxLine = card.querySelector('.sess-meta--context')!;
          expect(ctxLine.firstElementChild).toBe(roles[0]);
          expect(roles[0]!.getAttribute('aria-label')).toBe(c.role!.text);
          expect(visible(ctxLine)).not.toMatch(/coordinator/i);
          expect(head.querySelector(`[role="img"][aria-label="${c.role!.text}"]`), 'the header draws the role badge').not.toBeNull();
        } else {
          expect(roles.length).toBe(0);
        }
        // The verbatim hold — the card's `held` or programme names it, the header spells it.
        if (input.session.held !== null) expect(text, 'the verbatim hold').toContain(`held: ${input.session.held}`);
        cleanup();
      });
    }
  }
});

describe('verifier round 1 — the gaps the first suite left open', () => {
  it('the header status word comes from the model and begins with the card\'s word, for every bucket', () => {
    for (const bucket of ['attention', 'working', 'done', 'idle', 'cleanup', 'archived', 'dead'] as const) {
      const f = sessionFacts({ session: s({ bucket, status: bucket === 'dead' ? 'dead' : 'idle' }), now: NOW });
      const head = headerStatusWord({ bucket, asleepAt: null, background: null, at: NOW - 120_000, now: NOW });
      expect(head.startsWith(f.statusText), `${bucket}: "${head}" vs card "${f.statusText}"`).toBe(true);
    }
  });

  it('a dead row reads `exited` on the card AND in the rendered header (the lamp still speaks "not running")', () => {
    const input = CASES['a dead session that is not hibernated']!;
    render(<SessionHeaderHost {...headerProps({ session: input.session, status: 'dead', facts: sessionFacts(input) })} />);
    expect(document.querySelector('.chat-head .status-line')?.textContent).toBe('exited');
    expect(screen.getByRole('img', { name: 'not running' })).toBeInTheDocument();
  });

  it('shortenByToken never returns a bare ellipsis, even for a separator-led text', () => {
    for (const text of ['.acb-', '-x-yyyy', '/_abc/def', '..hidden-file-name', '_a']) {
      for (let max = 1; max <= text.length; max += 1) {
        const out = shortenByToken(text, max);
        expect(out, `${text} @${max}`).not.toBe('…');
        if (out === text) continue;
        expect(text.startsWith(out.slice(0, -1))).toBe(true);
        expect(/[^-/_. ]/.test(out.slice(0, -1))).toBe(true);
      }
    }
  });

  it('the lifecycle qualifier reads the model\'s clock, never Date.now()', () => {
    const f = sessionFacts({
      session: s({ lifecycle: 'stopped', stoppedBy: { at: NOW - 5 * 60_000, surface: 'cli' } }), now: NOW,
    });
    expect(f.lifecycle).toBe('stopped by cli, 5m ago');
  });

  it('the orphan guidance rides the model, so the header\'s marker carries it as the card\'s does', () => {
    const input = { ...CASES['an orphan whose coordinator is gone']!, coordinatorTitle: 'coordinator x is gone — reclaim this programme from the run board' };
    const m = markers(sessionFacts(input)).find((x) => x.key === 'coordinator-gone')!;
    expect(m.title).toContain('reclaim');
    render(<SessionHeaderHost {...headerProps({ session: input.session, status: 'idle', facts: sessionFacts(input) })} />);
    const toggle = screen.queryByRole('button', { name: /details/i });
    if (toggle !== null) fireEvent.click(toggle);
    expect(document.querySelector('.chat-head [data-marker="coordinator-gone"]')?.getAttribute('title')).toContain('reclaim');
  });

  it('a cleanup row names its PR once in the header, not three times', () => {
    const input = CASES['a cleanup row with its merged PR']!;
    render(<SessionHeaderHost {...headerProps({ session: input.session, status: 'idle', facts: sessionFacts(input) })} />);
    const toggle = screen.queryByRole('button', { name: /details/i });
    if (toggle !== null) fireEvent.click(toggle);
    const facts = document.querySelector('.chat-facts')!;
    expect(visible(facts).match(/#77/g)?.length ?? 0).toBe(1);
  });

  it('the card button\'s accessible name is the FULL name, never the shortened one', () => {
    const input = CASES['a long name waiting on the operator']!;
    render(<SessionLine session={input.session} onOpen={() => {}} onActions={() => {}} now={NOW} />);
    const btn = screen.getByRole('button', { name: /^an-exceptionally-long-session-name-that-will-not-fit-on-a-phone-screen/ });
    expect(btn.getAttribute('aria-current')).toBeNull();
    expect(screen.queryByRole('button', { name: /…/ })).toBeNull();
    // From its CONTENT, not the `title` fallback (a description, and absent where the name fits).
    btn.removeAttribute('title');
    expect(screen.getByRole('button', { name: /^an-exceptionally-long-session-name-that-will-not-fit-on-a-phone-screen/ })).toBe(btn);
  });

  it('a wide card can show a long name and a 31-character programme whole: both forms render, CSS picks by width', () => {
    const long = { ...RUN, program: 'a-very-long-programme-slug-name' };
    const input = { ...CASES['a held dispatched child']!, session: s({ name: 'an-exceptionally-long-session-name-that-will-not-fit',
      role: 'child', child: { kind: 'child', runId: 40 }, held: 'program:a-very-long-programme-slug-name wave:4/9 run:40' }),
      childRun: child({ ...long, wave: 4, waveOf: 9 }) };
    const { container } = render(<SessionLine session={input.session} onOpen={() => {}} onActions={() => {}} now={NOW}
      childRun={input.childRun} />);
    const fulls = [...container.querySelectorAll('.fit-full')].map((x) => x.textContent);
    expect(fulls).toContain('an-exceptionally-long-session-name-that-will-not-fit');
    expect(fulls).toContain('a-very-long-programme-slug-name');
    const shorts = [...container.querySelectorAll('.fit-short')].map((x) => x.textContent);
    expect(shorts.every((x) => x?.endsWith('…'))).toBe(true);
    // Both visual forms are hidden from the accessibility tree; the full text is spoken once.
    for (const el of container.querySelectorAll('.fit-full, .fit-short')) expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('on a phone the card\'s marker and its non-programme context sit in the header before the details door is opened', () => {
    for (const name of ['a limit-hit session whose swap was refused', 'a hold whose run left the board',
      'a busy session under context pressure'] as const) {
      const input = CASES[name]!;
      const c = cardFacts(sessionFacts(input));
      render(<SessionHeaderHost {...headerProps({ session: input.session, status: input.session.status, facts: sessionFacts(input) })} />);
      const head = visible(document.querySelector('.chat-head')!);
      if (c.marker !== null) expect(head, `${name}: marker`).toContain(c.marker.short ?? c.marker.text);
      if (c.context !== null && c.context.key !== 'programme') expect(head, `${name}: context`).toContain(c.context.text);
      cleanup();
    }
  });
});

// Delegation visibility once listed every delegation entry a session started in its header (D-7781), and the row's chip went
// with D-8771. Since H3 (D-8875) neither the row nor the header counts or lists them (the header's case is H3-H1 below); the
// background work's count is the header's one allowance.
describe('a session\'s delegated work on the row and in the header (D-8771, H3)', () => {
  const worker = s({ role: 'child', child: { kind: 'child', runId: 40 }, status: 'busy', bucket: 'working' });

  // A GUARD, not a pin that was red at `main`: the card already drew no subagent count there (they moved to the header in
  // D-5545), and the row is handed no delegated entries any more. The chip's absence is pinned by project-card's C46 case.
  it('C46 guard: a session row with subagents draws no count of subagents or delegated entries, in its text, titles or accessible names', () => {
    const busy = s({ ...worker, subagents: [{ name: 'code-reviewer', startedAt: NOW - 60_000 }, { name: 'explorer', startedAt: NOW - 30_000 }] });
    expect(busy.subagents).toHaveLength(2);
    // L2-6 (review 2708): the dead half below cannot fail for subagents, which it never reads (`sessionFacts` hands a dead row
    // `subagents: null`, so the `toHaveLength(2)` control above checks the input, not what reaches the row). It stays for the
    // row's other words and titles; the live half is the one that can go red for a subagent count.
    for (const session of [busy, s({ ...busy, status: 'dead', bucket: 'dead' })]) {
      const { container } = render(<SessionLine session={session} onOpen={() => {}} onActions={() => {}} now={NOW} />);
      // Positive control: the row was drawn, with its name and some titled or named element to scan.
      expect(container.textContent).toContain(session.workspace!);
      const named = [...container.querySelectorAll('*')].flatMap((el) => [el.getAttribute('aria-label'), el.getAttribute('title')])
        .filter((x): x is string => x !== null);
      expect(named.length).toBeGreaterThan(0);
      expect(`${container.textContent} ${named.join(' ')}`).not.toMatch(/subagent|delegated|⑂/i);
      expect(container.querySelector('.sess-meta-chip')).toBeNull();
      expect(container.querySelector('.sess-subagents')).toBeNull();
      // L2-1 (review 2708): a count drawn as a bare number (` · 2`) has none of those words, so the row is also the same
      // markup with and without its subagents. The same row with `subagents: null` is the control (it must be drawn).
      const bare = render(<SessionLine session={{ ...session, subagents: null }} onOpen={() => {}} onActions={() => {}} now={NOW} />);
      expect(bare.container.innerHTML.length).toBeGreaterThan(0);
      expect(container.innerHTML, `${session.status}: the row is the same markup with and without subagents`).toBe(bare.container.innerHTML);
      cleanup();
    }
  });

  it('C46 (D-8771): a working row with background work reads `working · in background`, and the header still holds it with its count', () => {
    const bg = s({ ...worker, background: { count: 2, kinds: ['workflow', 'agent'] } });
    const f = sessionFacts({ session: bg, now: NOW, childRun: child(RUN) });
    const card = cardFacts(f);
    expect(card.status).toMatchObject({ text: 'working · in background', title: '2 in background: workflow, agent' });
    const head = headerFacts(f);
    expect(head.find((h) => h.key === 'status')?.text).toBe('working · 2 in background');
    // L1-2 (review 2708): the header's status fact carries the HEADER's own title (`backgroundWords`: the kinds, no count),
    // the same one the rendered header puts on its status word; the card's title (with the count) is the card's.
    expect(head.find((h) => h.key === 'status')?.title).toBe('in background: workflow, agent');
    expect(head.find((h) => h.key === 'status')?.title).toBe(backgroundWords({ count: 2, kinds: ['workflow', 'agent'] }).title);
    // D-5545's prefix rule holds for the status key with the one documented allowance: the header's count digits.
    expect(cardWithinHeader(card, head)).toEqual([]);
    expect(cardWithinHeader(card, head.filter((h) => h.key !== 'status'))).toEqual([card.status]);
    expect(cardWithinHeader(card, head.map((h) => (h.key === 'status' ? { ...h, text: 'idle · 2 in background' } : h)))).toEqual([card.status]);
    // Without background work the card says plain `working` and nothing about a count.
    expect(cardFacts(sessionFacts({ session: s({ ...worker, background: null }), now: NOW })).status.text).toBe('working');
  });

  it('D-8771: the one allowance to the subset rule is one data row, for the status key and the background words only', () => {
    // The table itself: dropping the row or widening it (another key, another words) reds here.
    expect(HEADER_COUNT_ALLOWANCES).toHaveLength(1);
    expect(HEADER_COUNT_ALLOWANCES[0]).toMatchObject({ key: 'status', card: ' · in background' });
    expect(HEADER_COUNT_ALLOWANCES[0]!.count.source).toBe(/ · \d+ in background$/.source);
    // L2-2 (review 2708): the regex's flags are pinned too (an `i` or `m` flag widens what it matches), as its whole text.
    expect(HEADER_COUNT_ALLOWANCES[0]!.count.flags).toBe('');
    expect(String(HEADER_COUNT_ALLOWANCES[0]!.count)).toBe('/ · \\d+ in background$/');
    // L1-3: the words are `backgroundWords`' own, spelt once: the header's counted form, run through the row, is the card's
    // uncounted form, for any count and any kinds, and a reword of `backgroundWords` would move both together.
    for (const b of [{ count: 1, kinds: [] }, { count: 7, kinds: ['workflow'] }, { count: 12, kinds: ['a', 'b'] }]) {
      const counted = `working · ${backgroundWords(b).text}`;
      expect(counted.replace(HEADER_COUNT_ALLOWANCES[0]!.count, HEADER_COUNT_ALLOWANCES[0]!.card)).not.toBe(counted);
      const bg = s({ bucket: 'working', status: 'busy', background: b });
      expect(cardFacts(sessionFacts({ session: bg, now: NOW })).status.text)
        .toBe(counted.replace(HEADER_COUNT_ALLOWANCES[0]!.count, HEADER_COUNT_ALLOWANCES[0]!.card));
    }
    const name = { key: 'name' as const, text: 'row' };
    const status = (text: string) => ({ key: 'status' as const, text });
    const branch = (text: string) => ({ key: 'branch' as const, text });
    // A card of one fact under `key`, against a header with the name and that one fact; the number of card facts refused.
    const within = (key: 'status' | 'branch', cardText: string, headerText: string): number => {
      const base = { name, status: status('working'), context: null, role: null, marker: null, workingOn: null };
      const shown = key === 'status' ? { ...base, status: status(cardText) } : { ...base, context: branch(cardText) };
      const header = key === 'status' ? [name, status(headerText)] : [name, status('working'), branch(headerText)];
      return cardWithinHeader(shown, header).length;
    };
    // It holds for the status key and its words…
    expect(within('status', 'working · in background', 'working · 2 in background')).toBe(0);
    // …and for nothing else: another key with the same words, other words with a count, trailing words, no allowance without it.
    expect(within('branch', 'working · in background', 'working · 2 in background')).toBe(1);
    expect(within('status', 'working · in foreground', 'working · 2 in foreground')).toBe(1);
    expect(within('status', 'working · in background', 'working · 2 in background · now')).toBe(1);
    expect(within('status', 'working · in background', 'idle · 2 in background')).toBe(1);
    expect(within('status', 'working · in background', 'working · in background')).toBe(0);
    // L1-1 (review 2708): a card status equal to the header word for word holds too, in the same one comparison: the rule
    // allows both forms of the header's status, its own text and the text with the count set aside.
    expect(within('status', 'working · 2 in background', 'working · 2 in background')).toBe(0);
    expect(within('status', 'working · 2 in background', 'working · 3 in background')).toBe(1);
    expect(within('branch', 'working · 2 in background', 'working · 2 in background')).toBe(0);
  });

});

// Session helpers H3 (D-8875; spec 2026-11-19 §4.5): the Helpers section is the one list and the one count of a session's
// helpers, so the header's facts carry neither the subagent count nor the recorded entries' count, and the card still sits
// within the header. RED FIRST: at `main` the header draws both.
describe('the new header: no subagent and no delegated fact (H3, D-8875)', () => {
  const busy = s({ role: 'child', child: { kind: 'child', runId: 40 }, status: 'busy', bucket: 'working',
    subagents: [{ name: 'code-reviewer', startedAt: NOW - 60_000 }, { name: 'explorer', startedAt: NOW - 30_000 }] });
  const entries = [activity({ activityId: 'a1', parentId: busy.id }), activity({ activityId: 'a2', parentId: busy.id, liveness: 'stale' })];
  // Handed on as it is, so a field the model no longer takes is simply not read.
  const input: Record<string, unknown> = { session: busy, now: NOW, childRun: child(RUN), delegated: entries };

  it('H3-H1: headerFacts holds no `subagents` and no `delegated` key, and the card is within it', () => {
    const f = sessionFacts(input as unknown as FactInput);
    const head = headerFacts(f);
    expect(head.map((h) => h.key)).not.toContain('subagents');
    expect(head.map((h) => h.key)).not.toContain('delegated');
    expect(head.filter((h) => /subagent|delegated|⑂/i.test(`${h.text} ${h.title ?? ''}`))).toEqual([]);
    // The rest of the header is as before: the name, the status with its words, the programme and the coordinator.
    expect(head.map((h) => h.key)).toEqual(expect.arrayContaining(['name', 'status', 'lane', 'programme', 'coordinator']));
    expect(cardWithinHeader(cardFacts(f), head)).toEqual([]);
  });

  it('H3-H2: the rendered header draws neither disclosure, in either skin', () => {
    for (const skin of ['instrument', 'refined'] as const) {
      act(() => setSkin(skin));
      const f = sessionFacts(input as unknown as FactInput);
      render(<SessionHeaderHost {...headerProps({ session: busy, status: busy.status, facts: f })} />);
      const toggle = screen.queryByRole('button', { name: /details/i });
      if (toggle !== null && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
      const head = document.querySelector('.chat-head')!;
      expect(head, `${skin}: the header is drawn`).not.toBeNull();
      expect(visible(head), `${skin}: its name is drawn`).toContain(busy.workspace!);
      const named = [...head.querySelectorAll('*')].flatMap((el) => [el.getAttribute('aria-label'), el.getAttribute('title')])
        .filter((x): x is string => x !== null);
      expect(`${head.textContent} ${named.join(' ')}`, skin).not.toMatch(/subagent|delegated|⑂/i);
      cleanup();
    }
  });

  // Review 3123 F12 (HF2, D-8877): a count drawn in other words (`2 helpers`, a bare `2`) has none of the three the case above
  // looks for, so the header is also the same markup with and without its subagents (C46's technique, the row's guard above),
  // in both skins, on a phone with its door opened and at a desk. The same header with `subagents: null` is the control.
  it('HF2-H3: the rendered header is the same markup with and without subagents, in either skin, phone and desk', () => {
    // React's ids differ between two roots; nothing else may.
    const markup = (): string => document.querySelector('.chat-head')!.outerHTML.replace(/«[^»]*»|:r[0-9a-z]+:/g, 'ID');
    for (const skin of ['instrument', 'refined'] as const) {
      for (const desk of [false, true]) {
        vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
          matches: desk && q.includes('min-width: 900px'), media: q, onchange: null,
          addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
        }) as unknown as MediaQueryList);
        act(() => setSkin(skin));
        const drawn = (session: FleetSession): string => {
          const f = sessionFacts({ ...input, session } as unknown as FactInput);
          render(<SessionHeaderHost {...headerProps({ session, status: session.status, facts: f })} />);
          const toggle = screen.queryByRole('button', { name: /details/i });
          if (toggle !== null && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
          const out = markup();
          cleanup();
          return out;
        };
        const bare = drawn({ ...busy, subagents: null });
        expect(bare, `${skin}: the control header is drawn`).toContain(busy.workspace!);
        expect(drawn(busy), `${skin}, ${desk ? 'desk' : 'phone'}: the same with and without subagents`).toBe(bare);
        vi.restoreAllMocks();
      }
    }
  });
});

// The run page's header is a superset of the run row (the runs rebuild, Task 7, D-8072; spec 2026-11-04 §8.4; D-5545): every
// element the row draws is drawn again, word for word, from the same readers.
describe('a run row and its page header', () => {
  it('every row element appears verbatim in the header', async () => {
    const run = {
      id: 410, program: 'programme-a', programTitle: 'Programme A', runTitle: null, wave: 2, waveOf: 4, project: 'project-b',
      homeProject: 'project-a', kind: 'review', reviews: 409, state: 'working', sessionId: null, claimedBy: null, workspace: null,
      branch: null, resumed: true, clearedAt: null, dispatchStartedAt: null, dispatchedAt: null, openedAt: NOW - 60_000,
      closedAt: null, items: { done: 1, total: 3 }, unreadMail: 0, handoffCommit: null,
      stuck: { reason: 'owner-gone', cause: null, since: NOW - 60_000, closes: null }, waitsOn: 'coordinator', blockedBy: null,
      health: { mailParked: 2, mailOutstanding: 1, mailParkedLive: 1, mailReplayMax: 0, briefQueued: null, clearError: null, coordKickoffPendingSince: null },
      workerLastSeen: NOW - 300_000, workerLastTurn: { state: 'done', startedAt: NOW - 900_000, endedAt: NOW - 300_000 },
    } as unknown as RunSummary;
    const row = render(<ul><RunRow run={run} nowMs={NOW} session={null} /></ul>);
    const rowTexts = [...row.container.querySelectorAll('.run-state, .run-name, .run-project, .run-crossing, .run-kind, .run-tally, .run-commits, .run-when, .run-seen, .run-resumed, .run-warn-item, .run-wait')]
      .map((e) => e.textContent ?? '');
    row.unmount();
    // Neither the lamp's word nor a marker is optional in this case: the row draws them, so the header must.
    expect(rowTexts).toEqual(expect.arrayContaining(['stuck', 'resumed, not cleared', 'last seen 5m ago']));
    expect(rowTexts.length).toBeGreaterThanOrEqual(8);
    vi.spyOn(api, 'runRecord').mockResolvedValue({ ok: true, run, events: [], reviewedBy: [], olderEvents: 0 });
    vi.spyOn(api, 'run').mockRejectedValue(new Error('offline'));
    vi.spyOn(api, 'runItems').mockRejectedValue(new Error('offline'));
    vi.spyOn(api, 'runSignals').mockRejectedValue(new Error('offline'));
    vi.spyOn(api, 'goals').mockRejectedValue(new Error('offline'));
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    try {
      render(<RunDetailScreen id={410} store={createFleetStore({ makeSocket: () => ({ close() {} }) as unknown as WebSocket })} />);
    } finally { vi.useRealTimers(); }
    const header = (await waitFor(() => { const h = document.querySelector('.rd-head'); if (h === null) throw new Error('no header'); return h; })).textContent ?? '';
    for (const t of rowTexts) expect(header, t).toContain(t);
  });
});
