// One command-target slot, shared (C12 item 14, T3e's `t3e-target-slot-helper`): `SessionFlows`' session target and
// the inspector rail's target each had their own copy of the same publish-and-subscribe slot.
//
// RED FIRST, and what each case catches:
//   a clear that empties the slot whoever published last ............ "a stale clear leaves a newer value published"
//   a publish that tells no reader .................................. "every reader is told of each publish"
//   either owner keeping a slot of its own ........................... "SessionFlows and the inspector publish through it"
// A reader that is never removed on unmount survives these cases (it is called and changes nothing); measured, not
// guarded.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createTargetSlot } from '../src/command/targetSlot';

describe('createTargetSlot', () => {
  it('a stale clear leaves a newer value published', () => {
    const slot = createTargetSlot<{ n: number }>();
    const a = { n: 1 };
    const b = { n: 2 };
    expect(slot.current()).toBeNull();
    slot.publish(a);
    slot.publish(b);
    slot.clear(a);
    expect(slot.current(), 'a newer part published after a').toBe(b);
    slot.clear(b);
    expect(slot.current()).toBeNull();
  });

  it('every reader is told of each publish', () => {
    const slot = createTargetSlot<string>();
    const one = renderHook(() => slot.useValue());
    const two = renderHook(() => slot.useValue());
    act(() => slot.publish('x'));
    expect([one.result.current, two.result.current]).toEqual(['x', 'x']);
    two.unmount();
    act(() => slot.publish('y'));
    expect(one.result.current).toBe('y');
    act(() => slot.clear('y'));
    expect(one.result.current).toBeNull();
  });

  it('SessionFlows and the inspector publish through it, with no slot of their own', () => {
    const src = path.join(import.meta.dirname, '..', 'src');
    for (const file of ['session/SessionFlows.tsx', 'inspector/inspectorShown.ts']) {
      const code = readFileSync(path.join(src, file), 'utf8');
      expect(code, file).toMatch(/\bcreateTargetSlot</);
      expect(code, `${file}: no target variable of its own`).not.toMatch(/^let target\b/m);
      expect(code, `${file}: no listener set for a target`).not.toMatch(/\b(?:targetListeners|listeners)\s*=\s*new Set/);
    }
  });
});
