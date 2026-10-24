// D-TBD-ran-required (ARCH-10, #543, step 2): `ran` is required on both results (`ran: true` on the ran arm, `ran: false` on the not-ran arm), and the sites that read the runner's
// words read it first. Proven here, beside `ran-arm.test.ts` (the runners and the two lanes of step 1):
//   - the archive door's outcome never reads a refusal word off a call that never ran;
//   - the docs adapter reads the link's faces off the arm, and a spawn arm whose halves were measured (a local ccd that
//     is absent) is still the `ccd-fault` it always was;
//   - an old agent's frame (no `ran` key) is a ran answer, and a frame saying `ran: false` is the spawn arm.
// FIXTURE HOME ONLY: scripted runners answer; nothing here reaches a box.
import { describe, it, expect } from 'vitest';
import { archiveOutcome } from '../src/coord/archiveDoor.js';
import { ccdDocsReader } from '../src/docs/ccdsource.js';
import { UNMEASURED } from '../src/exec.js';
import { createRunner } from '../src/remote/runner.js';
import type { FleetClient } from '../src/remote/client.js';
import type { CcdResult } from '../src/lifecycle.js';
import type { FleetState } from '../src/fleetstate.js';

describe('archiveOutcome: a call that never ran has no refusal word to read', () => {
  const words = 'ccd: session-busy\n';
  it('a ran answer carrying the word is the 409 it always was', () => {
    expect(archiveOutcome(false, [], { ok: false, stderr: words, ran: true }).status).toBe(409);
  });
  it('the same words on a call that never ran are a 502 with the runner\'s stderr', () => {
    const out = archiveOutcome(false, [], { ok: false, stderr: words, ran: false });
    expect(out.status).toBe(502);
    expect(out.body).toEqual({ ok: false, stderr: words });
  });
  it('after a stop that did run, the word is no refusal either: archived:false, stopped:true, refusal null', () => {
    const out = archiveOutcome(true, [], { ok: false, stderr: words, ran: false });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ archived: false, stopped: true, refusal: null });
  });
});

describe('the docs adapter reads the link\'s faces off the ran arm', () => {
  const READY: FleetState = { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: ['caps', 'docs-tree', 'docs-v1'] };
  const SRC = { project: 'project-a' } as never;
  const tree = (res: CcdResult) => ccdDocsReader({ runCcd: async () => res, fleetState: READY }).tree(SRC, null);
  const arm = (reason: 'transport' | 'spawn' | 'timeout', detail: string): CcdResult =>
    ({ ran: false, reason, detail, ok: false, stdout: '', stderr: detail, killed: UNMEASURED, signal: UNMEASURED });

  it('a spawn arm that is not the agent\'s refusal is link-failed, carrying the words', async () => {
    expect(await tree(arm('spawn', 'bad-request'))).toEqual({ ok: false, failure: 'link-failed', cause: 'bad-request' });
  });
  it('the refusal word on a TRANSPORT arm is link-failed, not not-granted: only the spawn arm is the agent declining', async () => {
    expect(await tree(arm('transport', 'forbidden'))).toEqual({ ok: false, failure: 'link-failed', cause: 'forbidden' });
  });
  it('the timeout word on a transport arm is link-failed, not link-timeout', async () => {
    expect(await tree(arm('transport', 'timeout'))).toEqual({ ok: false, failure: 'link-failed', cause: 'timeout' });
  });
  it('a spawn arm whose halves were measured (a local ccd that is absent) is ccd-fault', async () => {
    const local: CcdResult = { ran: false, reason: 'spawn', detail: 'spawn ccd ENOENT', ok: false, stdout: '', stderr: 'x', killed: false, signal: null };
    expect(await tree(local)).toMatchObject({ ok: false, failure: 'ccd-fault' });
  });
});

describe('the remote runner reads an agent frame\'s ran', () => {
  const via = (frame: unknown) => createRunner({ request: async () => frame } as unknown as FleetClient)('ccd', ['ls']);
  it('a frame with no ran key (an older agent) is a ran answer', async () => {
    expect(await via({ code: 3, stdout: '', stderr: 'x' })).toMatchObject({ code: 3 });
  });
  it('a frame saying ran:false is the spawn arm, with its detail, and the forged code stays', async () => {
    expect(await via({ code: 1, stdout: '', stderr: 'x', ran: false, detail: 'spawn ccd ENOENT' }))
      .toMatchObject({ ran: false, reason: 'spawn', detail: 'spawn ccd ENOENT', code: 1 });
  });
  it('a frame saying anything else about ran is a ran answer (only a literal false is the arm)', async () => {
    expect(await via({ code: 0, stdout: '', stderr: '', ran: 'false' })).toMatchObject({ ran: true });
  });
});
