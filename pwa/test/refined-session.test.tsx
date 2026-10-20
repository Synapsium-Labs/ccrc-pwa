// Refined's session (W2 Task S7c, D-5471; spec §5.3, Session, phone and laptop rows): the short header with ONE chip
// rail, the reading column, and the key hints under the composer.
//
// RED FIRST, and what each case catches:
//   Refined's set without a chrome, or a chrome drawing the esc cap ....... "one chip rail from the view, no esc"
//   the hints line without the pointer query .............................. "…under a fine pointer only"
//   the column a fixed `width: var(--measure-chat)` ....................... "…reads min(var(--measure-chat), 100%)"
//   a sheet or an Escape binding moved into the chrome ..................... "the chrome holds no sheet and no Escape effect"
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { CommandLayer } from '../src/command/CommandLayer';
import { Composer } from '../src/session/Composer';
import { SessionFlows } from '../src/session/SessionFlows';
import { SessionChromeInputs, type SessionHeaderProps } from '../src/session/SessionHeader';
import { REFINED_SET } from '../src/skins/refined/parts';
import { fleetSession } from './fleetFixture';

const SRC = path.join(import.meta.dirname, '..', 'src');

/** `(min-width: 900px)` answers `wide`, `(pointer: fine)` answers `fine`; a query naming both needs both. */
function stubMedia({ wide, fine }: { wide: boolean; fine: boolean }): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: (q.includes('min-width: 900px') ? wide : true) && (q.includes('pointer: fine') ? fine : true)
      && !q.includes('max-width') && !q.includes('pointer: coarse'),
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SESSION = fleetSession({
  id: 'lane-a-project-a-quiet-basin', project: 'project-a', workspace: 'quiet-basin', status: 'busy', bucket: 'working',
  model: 'model-x', effort: 'high', branch: 'feat/a-branch',
});

function renderChrome(over: Partial<SessionHeaderProps> = {}): void {
  const Chrome = REFINED_SET.SessionChrome;
  if (Chrome === null) throw new Error("Refined's set places no SessionChrome");
  const inputs: SessionHeaderProps = {
    session: SESSION, status: 'busy', statusUpdatedAt: Date.now(), onInterrupt: vi.fn(), onBack: vi.fn(), ...over,
  };
  render(
    <>
      <CommandLayer openNewSession={() => {}} />
      <SessionFlows
        session={inputs.session}
        title="project-a"
        actions={{
          changeModel: vi.fn(), changeEffort: vi.fn(), openHistory: vi.fn(), moveAccount: vi.fn(), archive: vi.fn(),
          restore: vi.fn(), openTerminal: vi.fn(), reapWorkspace: vi.fn(),
        }}
      >
        <SessionChromeInputs value={inputs}>
          <Chrome />
        </SessionChromeInputs>
      </SessionFlows>
    </>,
  );
}

describe("Refined's session chrome", () => {
  it("Refined's chrome renders one chip rail from the view, and no esc keycap", () => {
    // A touch screen with a busy turn: exactly where the shared header draws `esc`. Refined's Stop is the send slot's.
    stubMedia({ wide: false, fine: false });
    renderChrome();
    const rails = document.querySelectorAll('.ref-chip-rail');
    expect(rails).toHaveLength(1);
    const rail = rails[0] as HTMLElement;
    // The status, the crumb, the model and the effort, in the one rail (spec §5.3's phone row).
    expect(rail.querySelector('.status-line')?.textContent).toMatch(/^working/);
    expect(within(rail).getByText('model-x')).toBeInTheDocument();
    expect(within(rail).getByText('high')).toBeInTheDocument();
    // A workspace's crumb (its branch) is a rail chip, in full, so the title row stays one line.
    expect(rail.textContent).toContain('feat/a-branch');
    expect(document.querySelector('.chat-head .chat-title')?.textContent).toBe('project-a');
    expect(document.querySelectorAll('.chat-meta')).toHaveLength(1);
    expect(document.querySelector('.keycap--esc')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    // ⋯ and the terminal stay, and Back on a phone.
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terminal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to fleet' })).toBeInTheDocument();
    // The model chip's glyph is the icon, never the emoji (D-5100's 🤖).
    expect(rail.textContent).not.toContain('\u{1F916}');
    expect(rail.querySelector('svg')).not.toBeNull();
  });
});

describe('the key hints under the composer', () => {
  const composer = (): void => { render(<Composer onSend={vi.fn()} pending={[]} id="lane-a-project-a" />); };

  it('the hints line renders at ≥900 under a fine pointer only', () => {
    for (const [wide, fine, shown] of [[true, true, true], [true, false, false], [false, true, false], [false, false, false]] as const) {
      stubMedia({ wide, fine });
      composer();
      const line = document.querySelector('.composer-hints');
      expect(line !== null, `wide ${wide}, fine ${fine}`).toBe(shown);
      if (line !== null) {
        for (const word of ['send', 'newline', 'stop', 'commands']) expect(line.textContent).toContain(word);
        // Keys, not controls: a hint is never a tab stop.
        expect(line.querySelectorAll('kbd').length).toBeGreaterThanOrEqual(4);
        expect(line.querySelectorAll('button')).toHaveLength(0);
      }
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});

describe('the reading column', () => {
  it('the transcript\'s column reads min(var(--measure-chat), 100%)', () => {
    const css = readFileSync(path.join(SRC, 'session', 'chat.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const block = /@media \(min-width: 900px\) \{\s*([^{}]*)\{([^}]*)\}\s*\}/g;
    const found = [...css.matchAll(block)].find((m) => (m[1] ?? '').split(',').map((s) => s.trim()).includes('.chat-item'));
    expect(found, 'a ≥900 rule for .chat-item').toBeDefined();
    const selectors = found?.[1] ?? '';
    const body = found?.[2] ?? '';
    const list = selectors.split(',').map((s) => s.trim());
    expect(list).toEqual(expect.arrayContaining(['.chat-item', '.composer']));
    expect(body).toMatch(/max-width:\s*min\(var\(--measure-chat\),\s*100%\)/);
    expect(body).toMatch(/margin-inline:\s*auto/);
    // A max-width, never a fixed width: at 1600 with the inspector rail the column has to yield.
    expect(body).not.toMatch(/(^|[;\s])width:\s*var\(--measure-chat\)/);
  });
});

describe('the chrome holds no flow of its own', () => {
  it('the chrome holds no sheet and no Escape effect', () => {
    const src = readFileSync(path.join(SRC, 'skins', 'refined', 'SessionChrome.tsx'), 'utf8')
      .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/\bSheet\b|Dialog|PickSheet|SwapSheet|ArchiveSheet|ReapSheet|TerminalDrawer/);
    expect(src).not.toMatch(/useEscapeInterrupt|keydown|addEventListener|['"]Escape['"]/);
    expect(src).toMatch(/useSessionFlows\(\)/);
  });
});
