// The one holder of the last logged isolation reading (Overlord W1, plan `w1-isolation.md` question 20, ruled F12).
import { describe, expect, it } from 'vitest';
import type { IsolationRead } from '../../shared/isolation.js';
import { hostDigest } from '../../shared/host-identity.mjs';
import type { FleetState } from '../src/fleetstate.js';
import type { MeasuredServer } from '../src/isolationFacts.js';
import { IsolationWordLog, wireIsolation, type IsolationLink } from '../src/isolationLog.js';

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

// Review F5: the composition root's wiring, pinned at its one seam. A fake link stands in for the `FleetClient`: its state
// object is changed in place, as the client changes its own, and each listener is fired on its own.
describe('wireIsolation', () => {
  const MACHINE = 'a'.repeat(32);
  const BOOT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const BEARER = 'link-bearer';
  const server: MeasuredServer = { facts: { uid: 1000, initialNamespace: true, overflowUid: 65534, holdings: [] }, ids: { machine: MACHINE, boot: BOOT } };
  const fakeLink = () => {
    const state: FleetState = { connected: false, downSince: null, ccdVerbs: null, rosterFp: null, build: null };
    const onState: (() => void)[] = [];
    const onReady: (() => void)[] = [];
    const link: IsolationLink = { state, onStateChange: (fn) => onState.push(fn), onConnected: (fn) => onReady.push(fn) };
    return { state, link, stateChanged: () => { for (const fn of onState) fn(); }, ready: () => { for (const fn of onReady) fn(); } };
  };

  it('local mode: one line at boot, and the reader it hands back', () => {
    const lines: string[] = [];
    const reader = wireIsolation('local', server, null, null, (l) => lines.push(l));
    expect(lines).toEqual(['ccrc-server: isolation: shared-user (local-mode)']);
    expect(reader.read()).toEqual({ kind: 'measured', word: 'shared-user', cause: 'local-mode' });
  });

  it("remote mode reads the link's live state, and both a ready and a state change log a new reading", () => {
    const lines: string[] = [];
    const l = fakeLink();
    const reader = wireIsolation('remote', server, BEARER, l.link, (line) => lines.push(line));
    expect(lines).toEqual(['ccrc-server: isolation: unmeasured (no-agent)']);
    // A ready from an older agent: only the ready listener fires.
    Object.assign(l.state, { connected: true, hostReport: 'absent', peer: { locality: 'local', uid: 3000 }, readySerial: 1 });
    l.ready();
    expect(lines.at(-1)).toBe('ccrc-server: isolation: unmeasured (agent-older)');
    // A ready re-sent on the same socket changes neither connected nor downSince: the ready listener alone carries it.
    Object.assign(l.state, { hostReport: { uid: 1000, machine: hostDigest(BEARER, 'machine', MACHINE), boot: hostDigest(BEARER, 'boot', BOOT) }, peer: { locality: 'local', uid: 1000 }, readySerial: 2 });
    l.ready();
    expect(lines.at(-1)).toBe('ccrc-server: isolation: shared-user (same-user)');
    // A close: only the state listener fires.
    Object.assign(l.state, { connected: false });
    l.stateChanged();
    expect(lines.at(-1)).toBe('ccrc-server: isolation: unmeasured (link-down)');
    expect(reader.read()).toEqual({ kind: 'unmeasured', why: 'link-down' });
    expect(lines).toHaveLength(4);
  });
});
