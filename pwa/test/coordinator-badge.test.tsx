// Desktop polish C50 (D-8817): the operator's two tidying notes of 2026-11-19.
//
// 1. "We don't need to write the word "Programme" when we use the programme icon and colours and also the wave timer."
//    The programme box's header draws the icon, the hue and the waves bar, so it no longer draws the word; its accessible
//    name still says programme, on the icon.
// 2. "instead of writing the word "coordinator" let's come up with a badge to give to the workspace". A session that is
//    its project's coordinator is marked by ONE badge (`RoleBadge`, @ccrc/ui) wherever the word stood, in the fleet list
//    and in the session header: accessible name "coordinator", the role title on hover, and no visible word. The command
//    palette's entries are text the operator types to search, so they keep the word (pinned in `session-entries.test.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FleetSession, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { SessionLine } from '../src/fleet/SessionLine';
import { ProjectCard } from '../src/fleet/ProjectCard';
import { fleetTree } from '../src/fleet/fleetTree';
import { rollupFleet, NO_ROLLUP_PREFS } from '../src/fleet/rollup';
import { COORDINATOR_ROLE_TITLE, COORDINATOR_WORD } from '../src/fleet/sessionFacts';
import { sessionEntries } from '../src/command/sessionEntries';
import { setSkin } from '../src/lib/skin';
import { SessionHeaderHost, type HeaderHostProps } from './sessionHost';
import { sessionFacts } from '../src/fleet/sessionFacts';
import { NOW, run, sess } from './rollupFixture';
import { withRunBinding } from './runBindingFixture';

afterEach(cleanup);

/** The text a reader SEES in a subtree: never a `title`, never an `sr-only` span, never an `aria-label`. */
const visible = (el: Element): string => {
  const c = el.cloneNode(true) as Element;
  for (const x of c.querySelectorAll('.sr-only')) x.remove();
  return (c.textContent ?? '').replace(/\s+/g, ' ');
};

const lead = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id: 'lane-a-project-a', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: null, name: 'programme lead',
  role: 'coordinator', status: 'busy', bucket: 'working', branch: 'main', statusUpdatedAt: NOW - 120_000, ...over,
});

const headerProps = (over: Partial<HeaderHostProps>): HeaderHostProps => ({
  session: null, status: 'idle', statusUpdatedAt: null,
  onInterrupt: vi.fn(), onOpenTerminal: vi.fn(), onBack: vi.fn(), onChangeModel: vi.fn(), onChangeEffort: vi.fn(),
  onMoveAccount: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn(), onOpenHistory: vi.fn(), onReapWorkspace: vi.fn(),
  ...over,
});

describe('the programme box header (note 1)', () => {
  function drawBox(): HTMLElement {
    const coord = sess('coord', 'project-c', { role: 'coordinator', status: 'busy', bucket: 'working' });
    const kid = sess('w1', 'project-c', { role: 'child', status: 'busy', bucket: 'working' });
    const runs: RunSummary[] = [run(10, 'coord', 'w1', { wave: 3, waveOf: 6 })];
    const tree = fleetTree(withRunBinding([coord, kid], runs), [], runs);
    const g = tree.find((x) => x.project === 'project-c')!;
    const rollup = rollupFleet(tree, NO_ROLLUP_PREFS, NOW, null).cards.get('project-c');
    return render(
      <ProjectCard group={g} rollup={rollup} runs={g.runs} abroad={g.abroad} nowMs={NOW} boxNow={NOW}
        onOpen={() => {}} onActions={() => {}} onToggleChildren={() => {}} />,
    ).container;
  }

  it('draws no visible "Programme" word beside the icon, the hue and the waves bar', () => {
    const kicker = drawBox().querySelector('.pg-kicker')!;
    expect(kicker.querySelector('.pg-ico')).not.toBeNull();
    expect(kicker.querySelector('.pg-prog')).not.toBeNull();
    expect(kicker.querySelector('.pg-word')).toBeNull();
    expect(visible(kicker)).not.toMatch(/programme/i);
  });

  it('keeps the accessible name: the icon is an image named programme', () => {
    const kicker = drawBox().querySelector('.pg-kicker')!;
    const img = kicker.querySelector('.pg-ico[role="img"]');
    expect(img?.getAttribute('aria-label')).toBe('Programme');
    // The programme page's kicker has no icon beside it, so it stays the page's one cue.
    expect(readFileSync(path.join(__dirname, '../src/ledgers/ProgrammeScreen.tsx'), 'utf8')).toContain('<span className="pv-kicker">Programme</span>');
  });
});

describe('the coordinator badge (note 2)', () => {
  for (const skin of ['refined', 'instrument'] as const) {
    it(`${skin}: the fleet row draws the badge and no visible "coordinator"`, () => {
      act(() => setSkin(skin));
      const { container } = render(<SessionLine session={lead()} onOpen={() => {}} onActions={() => {}} now={NOW} />);
      const badges = container.querySelectorAll('.sess-role');
      expect(badges).toHaveLength(1);
      const badge = badges[0]!;
      expect(badge.getAttribute('role')).toBe('img');
      expect(badge.getAttribute('aria-label')).toBe(COORDINATOR_WORD);
      expect(badge.getAttribute('title')).toBe(COORDINATOR_ROLE_TITLE);
      expect(badge.querySelector('svg')).not.toBeNull();
      expect(visible(container)).not.toMatch(/coordinator/i);
      expect(screen.getByRole('img', { name: 'coordinator' })).toBe(badge);
    });

    it(`${skin}: the session header draws the badge and no visible "coordinator"`, () => {
      act(() => setSkin(skin));
      const session = lead();
      render(<SessionHeaderHost {...headerProps({ session, status: session.status, facts: sessionFacts({ session, now: NOW }) })} />);
      const head = document.querySelector('.chat-head')!;
      const toggle = screen.queryByRole('button', { name: /details/i });
      if (toggle !== null && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
      const badge = head.querySelector('.chat-facts [role="img"][aria-label="coordinator"]');
      expect(badge, 'the details draw the badge').not.toBeNull();
      expect(badge!.getAttribute('title')).toBe(COORDINATOR_ROLE_TITLE);
      expect(visible(head)).not.toMatch(/coordinator/i);
    });
  }

  it('a worker draws no badge', () => {
    const { container } = render(
      <SessionLine session={lead({ role: 'child', id: 'lane-a-project-a-still-pond', workspace: 'still-pond' })}
        onOpen={() => {}} onActions={() => {}} now={NOW} />,
    );
    expect(container.querySelector('.sess-role')).toBeNull();
    expect(screen.queryByRole('img', { name: 'coordinator' })).toBeNull();
  });

  it('the command palette still lists "coordinator" as text', () => {
    const [e] = sessionEntries([lead()], [], 'top');
    expect(e!.label).toContain(COORDINATOR_WORD);
    expect(e!.group).toBe(`${COORDINATOR_WORD} · project-a`);
  });
});

describe('the badge colour (note 2, the contrast gates)', () => {
  const read = (f: string): string => readFileSync(path.join(__dirname, '../src/fleet', f), 'utf8');
  const decl = (css: string, selector: string): string | null => {
    const esc = selector.replace(/[.[\]'()]/g, '\\$&');
    return new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{\\s*color:\\s*([^;}]+);\\s*\\}`, 'm').exec(css)?.[1] ?? null;
  };

  it('is the quiet secondary ink outside a programme box, a gated token the row gate measures', () => {
    const css = read('fleet.css');
    expect(/\.sess-role\s*\{[^}]*color:\s*var\(--ink-secondary\);/.test(css)).toBe(true);
  });

  for (const hue of ['cyan', 'violet', 'magenta', 'blue']) {
    it(`is the ${hue} programme's hue inside its box, on the surface the gates measure the hue on`, () => {
      expect(decl(read('programmeBox.css'), `.pg-box[data-hue='${hue}'] .pg-coord .sess-role`)).toBe(`var(--prog-${hue})`);
    });
  }
});
