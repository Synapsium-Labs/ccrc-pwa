// The agent link's readout (W2 Task S9, D-5472): every row of `agentLink`, and the one it must never be —
// no health answer yet reads "checking", never an all-clear.
import { describe, expect, it } from 'vitest';
import type { FleetHealth } from '../../shared/api';
import { agentDown, agentLink } from '../src/fleet/agentLink';

const health = (over: Partial<FleetHealth>): FleetHealth => ({ mode: 'remote', connected: true, downSince: null, ...over } as FleetHealth);

describe('agentLink', () => {
  it.each([
    ['no answer yet', null, 'idle', 'agent: checking'],
    ['local mode', health({ mode: 'local' }), 'done', 'local'],
    ['connected', health({ connected: true }), 'done', 'agent connected'],
    ['down', health({ connected: false, downSince: 1 }), 'dead', 'agent down'],
  ] as const)('%s reads its own dot and word', (_name, h, dot, word) => {
    expect(agentLink(h)).toEqual({ dot, word });
  });

  it('no answer yet is never an all-clear', () => {
    expect(agentLink(null).dot).not.toBe('done');
    expect(agentLink(null).word).not.toMatch(/connected/);
  });
});

describe('agentDown', () => {
  it.each([
    ['no answer yet', null, false],
    ['local mode, even unconnected', health({ mode: 'local', connected: false }), false],
    ['remote and connected', health({ connected: true }), false],
    ['remote and not connected', health({ connected: false, downSince: 1 }), true],
  ] as const)('%s', (_name, h, down) => {
    expect(agentDown(h)).toBe(down);
  });
});
