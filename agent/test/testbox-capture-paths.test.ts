// The build capture runner's two store rules (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §5
// Table 7, PR 3; review 3226 F8). THE TMUX SOCKET: the capture's private tmux server's socket lives in a short directory of
// its own under the service's temporary directory (`/tmp`, private to the unit), never under `<CCRC_TESTBOX_ROOT>`, so no
// root is too long for a unix socket path; the production path is exercised here as it is built, with no shortening.
// THE BUILDS STORE: `captures/builds/` keeps the newest builds and every build a capture still needs, and nothing else
// that names a build.
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_BUILDS_KEPT, CAPTURE_SOCKET, CAPTURE_SOCKET_PATH_MAX, buildsToPrune, captureSocketFits, captureSocketPath, captureTmuxDir,
} from '../src/testbox/capture.js';

const ID = 'f'.repeat(32);
const UID = 4294967294;
const bytes = (s: string): number => new TextEncoder().encode(s).length;

describe('the capture\'s tmux socket path (review 3226 F8)', () => {
  it('lives in a directory of its own under the given base, named by the whole capture id', () => {
    expect(captureTmuxDir('/tmp', ID)).toBe(`/tmp/ccrc-capture-${ID}`);
    expect(captureSocketPath('/tmp', ID, UID)).toBe(`/tmp/ccrc-capture-${ID}/tmux-${UID}/${CAPTURE_SOCKET}`);
  });
  it('under the production base, /tmp, fits the socket cap with the widest uid, whatever the root', () => {
    expect(bytes(captureSocketPath('/tmp', ID, UID))).toBeLessThanOrEqual(CAPTURE_SOCKET_PATH_MAX);
    expect(captureSocketFits('/tmp', UID)).toBe(true);
  });
  it('the cap leaves room for the terminating byte on Linux (108) and on macOS (104)', () => {
    expect(CAPTURE_SOCKET_PATH_MAX).toBeLessThan(104);
  });
  it('a base too long to fit is told apart, at the exact byte', () => {
    // A base `/b…b` adds its own leading slash and the slash that joins it to the rest.
    const room = CAPTURE_SOCKET_PATH_MAX - bytes(captureSocketPath('', ID, UID)) - 2;
    expect(captureSocketFits(`/${'b'.repeat(room)}`, UID)).toBe(true);
    expect(captureSocketFits(`/${'b'.repeat(room + 1)}`, UID)).toBe(false);
  });
});

describe('the builds store keeps the newest builds and those a capture still needs (review 3226 F8)', () => {
  const store = ['2.1.300', '2.1.310', '2.1.99', '2.1.320', '2.1.305', '.copy.Ab12Cd34', 'notes.txt'];
  it(`prunes every build past the ${CAPTURE_BUILDS_KEPT} newest, by version order (not by name)`, () => {
    expect(buildsToPrune(store, [], 3).sort()).toEqual(['2.1.300', '2.1.99']);
  });
  it('never a build a queued or running capture needs', () => {
    expect(buildsToPrune(store, ['2.1.99'], 3)).toEqual(['2.1.300']);
  });
  it('never a name that is not a build: the copy\'s stage, anything else', () => {
    expect(buildsToPrune(store, [], 0).sort()).toEqual(['2.1.300', '2.1.305', '2.1.310', '2.1.320', '2.1.99']);
  });
  it('keeps everything while there are no more builds than the kept count', () => {
    expect(buildsToPrune(['2.1.1', '2.1.2'], [], CAPTURE_BUILDS_KEPT)).toEqual([]);
  });
  it('the production count keeps at least one build', () => {
    expect(CAPTURE_BUILDS_KEPT).toBeGreaterThan(0);
  });
});
