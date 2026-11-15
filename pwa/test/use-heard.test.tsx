import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useHeard } from '../src/fleet/useHeard';
import { createFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';

describe('useHeard, the one reader of the frame-seen gate', () => {
  it('holds null for the rows and runs until their frames have landed', () => {
    const store = createFleetStore();
    store.setState({ sessions: [fleetSession({ id: 'lane-a-1' })], runs: [], fleetFrameSeen: false, runsFrameSeen: false });
    const { result } = renderHook(() => useHeard(store));
    expect(result.current).toEqual({ sessions: null, runs: null });
    act(() => store.setState({ fleetFrameSeen: true }));
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.runs).toBeNull();
    act(() => store.setState({ runsFrameSeen: true }));
    expect(result.current.runs).toEqual([]);
  });

  // The census (the Overlord face follow-up): a hand-written `fleetFrameSeen ?` / `runsFrameSeen ?` ternary is a second
  // spelling of the rule this hook owns, so one is refused anywhere in `src` but here. The screens below still carry one;
  // each is counted, and the list only shrinks: route one through `useHeard` and drop its row in the same change. Three
  // of them fall back to an empty list rather than null (MailScreen, RunsScreen, ProgrammeBox's spec link), so routing
  // them is a behaviour change of its own, not a move.
  const STILL_HAND_WRITTEN: Readonly<Record<string, number>> = {
    'fleet/ProgrammeBox.tsx': 3,
    'screens/FleetScreen.tsx': 1,
    'screens/MailScreen.tsx': 1,
    'screens/RunDetailScreen.tsx': 1,
    'screens/RunsScreen.tsx': 1,
  };
  const HEARD_TERNARY = /\b(?:fleetFrameSeen|runsFrameSeen)\)?\s*\?(?![?.])/g;

  it('refuses a hand-written heard ternary anywhere in src but the hook, and the known holders only shrink', () => {
    const src = path.resolve(__dirname, '../src');
    const found: Record<string, number> = {};
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const n = readFileSync(p, 'utf8').match(HEARD_TERNARY)?.length ?? 0;
          if (n > 0) found[path.relative(src, p).split(path.sep).join('/')] = n;
        }
      }
    };
    walk(src);
    expect(found['fleet/useHeard.ts']).toBe(2);
    delete found['fleet/useHeard.ts'];
    expect(found).toEqual(STILL_HAND_WRITTEN);
  });

  it("the census's pattern sees the spellings it refuses, and not the ones it does not", () => {
    const hits = (text: string): number => text.match(HEARD_TERNARY)?.length ?? 0;
    expect(hits('const runs = runsFrameSeen ? live : null;')).toBe(1);
    expect(hits('useStore((s) => (s.runsFrameSeen ? s.runs : null))')).toBe(1);
    expect(hits('const x = !fleetFrameSeen ? [] : rows;')).toBe(1);
    expect(hits('const x = (fleetFrameSeen) ? a : b;')).toBe(1);
    expect(hits('const x = fleetFrameSeen\n    ? a\n    : b;')).toBe(1);
    expect(hits('if (!runsFrameSeen) return;')).toBe(0);
    expect(hits('const seen = state.runsFrameSeen ?? false;')).toBe(0);
    expect(hits('const seen = obj?.runsFrameSeen?.x;')).toBe(0);
    expect(hits('coordFrameSeen ? a : b')).toBe(0);
  });
});
