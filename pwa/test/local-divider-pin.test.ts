import { describe, expect, it } from 'vitest';
import type { ChatEvent, SessionStreamMsg } from '../../shared/api';
import { applySessionMsg, type SessionSnapshot } from '../src/stores/session';
import { isLocalDivider } from '../src/session/localDivider';

// D-7572 (ARCH-05): the local-divider predicate's inputs and outputs, held
// across its move inward. Only the `isLocalDivider` import line may change.

const TS = '2026-07-20T10:00:00.000Z';

const emptySnap = (): SessionSnapshot => ({
  events: [],
  offset: 0,
  uuid: null,
  status: null,
  statusUpdatedAt: null,
  dialog: null,
  ask: null,
  tasks: [],
  mail: [],
  missingFile: null,
  strandedAccount: null,
  searchComplete: true,
  fileMeasured: true,
  file: null,
});

describe('isLocalDivider', () => {
  it("is true for a system event whose uuid starts 'local-'", () => {
    expect(isLocalDivider({ kind: 'system', uuid: 'local-1', ts: TS, text: 'x' })).toBe(true);
  });

  it('is false for a system event with another uuid', () => {
    expect(isLocalDivider({ kind: 'system', uuid: 'abc-1', ts: TS, text: 'x' })).toBe(false);
  });

  it("is false for a system event whose uuid starts 'local' without the hyphen", () => {
    expect(isLocalDivider({ kind: 'system', uuid: 'localx-1', ts: TS, text: 'x' })).toBe(false);
  });

  it("is false for a user or assistant event whose uuid starts 'local-'", () => {
    const u: ChatEvent = { kind: 'user', uuid: 'local-1', ts: TS, text: 'x' };
    const a: ChatEvent = { kind: 'assistant', uuid: 'local-2', ts: TS, text: 'x' };
    expect(isLocalDivider(u)).toBe(false);
    expect(isLocalDivider(a)).toBe(false);
  });

  it('holds for a divider the store mints on a rotation', () => {
    const rotated: SessionStreamMsg = { type: 'rotated', uuid: 'u2' };
    const s = applySessionMsg(emptySnap(), rotated);
    expect(s.events).toHaveLength(1);
    const divider = s.events[0];
    expect(divider).toBeDefined();
    expect(isLocalDivider(divider as ChatEvent)).toBe(true);
  });

  it('holds for a divider the store mints on a notice', () => {
    const notice: SessionStreamMsg = { type: 'notice', message: 'a notice' };
    const s = applySessionMsg(emptySnap(), notice);
    const divider = s.events[s.events.length - 1];
    expect(divider).toBeDefined();
    expect(isLocalDivider(divider as ChatEvent)).toBe(true);
  });
});
