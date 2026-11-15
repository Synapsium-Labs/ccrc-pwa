// The reader lab's gap window and its draw mode, held together (the take-up plan, refinement (d)): `lab-draw` draws in the
// library's `auto` mode, where `ready` waits for every figure, so the window that ends at `ready` times the whole draw.
import { describe, expect, it } from 'vitest';
import { readerMountPlan } from '../src/docs/reader/policy';
import { LAB_GAP_WINDOW } from '../src/readerLab/run';

describe('the reader lab\'s window matches its draw', () => {
  it('lab-draw draws in auto mode whatever the reading, and the window ends at ready', () => {
    for (const e17 of ['holds', 'does-not-hold', 'not-measured'] as const) {
      expect(readerMountPlan('lab-draw', 0, 'host-bar', e17).draw).toBe('auto');
    }
    expect(LAB_GAP_WINDOW).toBe('ready');
  });
});
