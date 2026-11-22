// The one holder of the last logged isolation reading (Overlord W1, plan `w1-isolation.md` question 20, ruled F12).
import { describe, expect, it } from 'vitest';
import type { IsolationRead } from '../../shared/isolation.js';
import { IsolationWordLog } from '../src/isolationLog.js';

describe('IsolationWordLog', () => {
  const rig = (first: IsolationRead) => {
    let now = first;
    const lines: string[] = [];
    const log = new IsolationWordLog({ read: () => now }, (l) => lines.push(l));
    return { lines, log, set: (r: IsolationRead) => { now = r; } };
  };

  it('logs at boot, by word and cause', () => {
    const r = rig({ kind: 'measured', word: 'shared-user', cause: 'local-mode' });
    r.log.note();
    expect(r.lines).toEqual(['ccrc-server: isolation: shared-user (local-mode)']);
  });

  it('logs nothing for an unchanged reading, and a change once, by reason', () => {
    const r = rig({ kind: 'unmeasured', why: 'no-agent' });
    r.log.note(); r.log.note();
    r.set({ kind: 'unmeasured', why: 'agent-older' });
    r.log.note(); r.log.note();
    r.set({ kind: 'measured', word: 'shared-user', cause: 'same-user' });
    r.log.note();
    r.set({ kind: 'measured', word: 'shared-user', cause: 'store-mode' });
    r.log.note();
    expect(r.lines).toEqual([
      'ccrc-server: isolation: unmeasured (no-agent)',
      'ccrc-server: isolation: unmeasured (agent-older)',
      'ccrc-server: isolation: shared-user (same-user)',
      'ccrc-server: isolation: shared-user (store-mode)',
    ]);
  });

  it('no line holds a uid, a digest, an id or an address', () => {
    const r = rig({ kind: 'measured', word: 'separate-user', cause: 'other-user' });
    r.log.note();
    for (const l of r.lines) {
      expect(l).not.toMatch(/[0-9a-f]{32}/);
      expect(l).not.toMatch(/\b\d{3,}\b/);
      expect(l).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    }
  });
});
