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
    expect(img?.getAttribute('title'), 'a mouse user still gets the word on hover').toBe('Programme');
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

    it(`${skin}: the session header draws the badge on the title line, after the name, and not in the details row (C51)`, () => {
      act(() => setSkin(skin));
      const session = lead();
      render(<SessionHeaderHost {...headerProps({ session, status: session.status, facts: sessionFacts({ session, now: NOW }) })} />);
      const head = document.querySelector('.chat-head')!;
      const toggle = screen.queryByRole('button', { name: /details/i });
      if (toggle !== null && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
      const title = head.querySelector('.chat-title')!;
      const badge = title.querySelector('[role="img"][aria-label="coordinator"]');
      expect(badge, 'the title line draws the badge').not.toBeNull();
      expect(badge!.getAttribute('title')).toBe(COORDINATOR_ROLE_TITLE);
      expect(badge!.querySelector('svg')).not.toBeNull();
      // The badge is glued to the name's last character (review 2963 F1): one `nowrap` box, the character then the badge.
      const name = title.querySelector('.chat-title-text')!;
      const glue = badge!.parentElement!;
      expect(glue.classList.contains('chat-title-glue'), 'the badge is in the glue box').toBe(true);
      expect(glue.parentElement, 'the glue box ends the name').toBe(name);
      expect(glue.lastElementChild).toBe(badge);
      expect(glue.firstChild?.nodeType, 'the glue box begins with the name\'s last character').toBe(Node.TEXT_NODE);
      expect(Array.from(glue.firstChild!.textContent ?? '')).toHaveLength(1);
      expect(name.textContent, 'the name reads whole, the badge adding no text').toBe(session.project);
      expect(head.querySelectorAll('[role="img"][aria-label="coordinator"]').length, 'one badge in the whole header').toBe(1);
      expect(head.querySelector('.chat-facts [role="img"][aria-label="coordinator"]'), 'the details row no longer carries it').toBeNull();
      expect(head.querySelector('.chat-fact-role'), 'no role detail is drawn').toBeNull();
      expect(visible(head)).not.toMatch(/coordinator/i);
    });

    it(`${skin}: a worker's session header draws no badge, on the title line or anywhere (C51)`, () => {
      act(() => setSkin(skin));
      const session = lead({ role: 'child', id: 'lane-a-project-a-still-pond', workspace: 'still-pond', name: 'still-pond' });
      render(<SessionHeaderHost {...headerProps({ session, status: session.status, facts: sessionFacts({ session, now: NOW }) })} />);
      const toggle = screen.queryByRole('button', { name: /details/i });
      if (toggle !== null && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
      expect(document.querySelector('.chat-head [role="img"][aria-label="coordinator"]')).toBeNull();
      expect(document.querySelector('.chat-title-role')).toBeNull();
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

describe('the badge stylesheet rules (note 2; the contrast gates measure the pair in contrast.test.ts)', () => {
  const read = (...f: string[]): string => readFileSync(path.join(__dirname, '../src', ...f), 'utf8');
  /** Every value the stylesheet gives `prop` for a rule whose selector list holds exactly `selector`: comments are cut first,
   *  a rule is read whole, a selector is compared whole (never as a substring of a longer one) and a property by its own name
   *  (never `background-color` for `color`), so no selector becomes a pattern. */
  const values = (css: string, selector: string, prop: string): string[] => {
    const out: string[] = [];
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1]!.split(',').some((sel) => sel.trim() === selector)) continue;
      for (const decl of m[2]!.split(';')) {
        const at = decl.indexOf(':');
        if (at > 0 && decl.slice(0, at).trim() === prop) out.push(decl.slice(at + 1).trim());
      }
    }
    return out;
  };

  it('the reader reads a whole selector and a whole property (its own controls)', () => {
    const css = '/* .a .b { color: red; } */ .x .a .b { color: blue; } .a .b, .c { background-color: green; color: gold; }';
    expect(values(css, '.a .b', 'color')).toEqual(['gold']);
    expect(values(css, '.x .a .b', 'color')).toEqual(['blue']);
    expect(values(css, '.a .b', 'background-color')).toEqual(['green']);
    expect(values(css, '.c', 'color')).toEqual(['gold']);
    expect(values(css, '.missing', 'color')).toEqual([]);
  });

  it('is the quiet secondary ink outside a programme box, a gated token the row gate measures', () => {
    expect(values(read('fleet', 'fleet.css'), '.sess-role', 'color')).toEqual(['var(--ink-secondary)']);
  });

  for (const hue of ['cyan', 'violet', 'magenta', 'blue']) {
    it(`is the ${hue} programme's hue inside its box, on the surface the gates measure the hue on`, () => {
      expect(values(read('fleet', 'programmeBox.css'), `.pg-box[data-hue='${hue}'] .pg-coord .sess-role`, 'color')).toEqual([`var(--prog-${hue})`]);
    });
  }

  it('the title-line badge is the name\'s text size, 1em, on its baseline, in the line\'s own ink; the old detail\'s rules are gone (C51)', () => {
    const chat = read('session', 'chat.css');
    expect(values(chat, '.chat-title-glue', 'white-space'), 'the last character and the badge cannot break apart').toEqual(['nowrap']);
    expect(values(chat, '.chat-title-role svg', 'width')).toEqual(['1em']);
    expect(values(chat, '.chat-title-role svg', 'height')).toEqual(['1em']);
    // No font-size and no colour of its own: the glyph follows the title's text, and the line's ink is the title's.
    expect(values(chat, '.chat-title-role', 'font-size')).toEqual([]);
    expect(values(chat, '.chat-title-role', 'color')).toEqual([]);
    expect(values(chat, '.chat-title-role', 'vertical-align'), 'it shares the name\'s line box, below the baseline by the icon rule').toEqual(['-0.125em']);
    // What only the old placement used (C50's role detail and its line) is removed, whole.
    for (const sel of ['.chat-fact-role', '.chat-fact-role [role="img"]', '.chat-fact-role svg']) {
      for (const prop of ['display', 'align-items', 'min-height', 'font-size', 'width', 'height']) {
        expect(values(chat, sel, prop), `${sel} ${prop} is gone`).toEqual([]);
      }
    }
    expect(chat.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('chat-fact-role');
    // The empty details row is decided in code (`detailsHaveFacts`), never by a stylesheet reading what rendered (review 2963 F3 to F6).
    expect(chat.replace(/\/\*[\s\S]*?\*\//g, ''), 'no `:has` rule on the details row').not.toMatch(/\.chat-facts[^{]*:has\(/);
    // The header's glyph rule for the Goals door is untouched.
    expect(values(chat, '.chat-coord-goals svg', 'width')).toEqual(['1em']);
    const session = lead();
    render(<SessionHeaderHost {...headerProps({ session, status: session.status, facts: sessionFacts({ session, now: NOW }) })} />);
    const badge = document.querySelector('.chat-head .chat-title [role="img"][aria-label="coordinator"]');
    expect(badge, 'the title draws the badge').not.toBeNull();
    expect(badge!.classList.contains('chat-title-role')).toBe(true);
    expect(badge!.classList.contains('sess-role'), 'the card\'s role rule (flex-start, the quiet ink) is not on the header badge').toBe(false);
  });
});
