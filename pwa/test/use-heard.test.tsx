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

  it('the face and the Waiting screens read the two flags nowhere but there', () => {
    const src = path.resolve(__dirname, '../src');
    const owners: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /(fleetFrameSeen|runsFrameSeen)\s*\?/.test(readFileSync(p, 'utf8'))) owners.push(path.relative(src, p));
      }
    };
    for (const d of ['face', 'ledgers']) walk(path.join(src, d));
    expect(owners).toEqual([]);
  });
});
