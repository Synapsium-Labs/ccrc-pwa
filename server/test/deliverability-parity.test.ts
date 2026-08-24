// D9's single-definition mechanism: `sweepMail` is NOT refactored to call
// `peerDeliverable` — instead both are driven over ONE fixture table and
// held in agreement on every structural rung, the _session_state /
// sessionLifecycle two-implementations-one-fixture precedent. The harness
// is mail-sweep.test.ts's own (fake Date only, real timers under
// sendPrompt), reduced to the knobs this table needs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { peerDeliverable } from '../src/coord/peers.js';
import { localIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';
import {
  DELIVERABILITY_FIXTURE, PARITY_NOW, PARITY_PID, probeOf, type DeliverabilityRow,
} from './deliverabilityFixture.js';

const ID = 'demo-parity-mesa';
const UUID = 'a'.repeat(36);
const FROM_ID = 'demo-parity-ridge';
const FROM_UUID = 'b'.repeat(36);
// Local mirrors of watch.ts's private lane constants — mail-sweep.test.ts's
// own idiom: no import path exists, so a drift is a failing test, not a
// silently-wrong assertion.
const MAIL_QUIET_MS = 60_000;

const emptyBox = '❯ \n';
const anyEchoBox = (t: string): string => `❯ ${t}\n`;

interface Harness { home: string; calls: string[][]; run: Runner }

const harness = (row: DeliverabilityRow): Harness => {
  const home = mkTmp('ccrc-deliv-parity-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });   // empty but LISTABLE
  const calls: string[][] = [];
  let lastLiteral = '';
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'has-session') {
      if (row.tmux === 'gone') return { code: 1, stdout: '', stderr: "can't find session: cc-x\n" };
      if (row.tmux === 'unknown') return { code: 1, stdout: '', stderr: 'server exited unexpectedly\n' };
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'list-panes') {
      return row.panePid
        ? { code: 0, stdout: `${PARITY_PID}\n`, stderr: '' }
        : { code: 1, stdout: '', stderr: '' };
    }
    if (args[0] === 'capture-pane') {
      // Echo whatever sendPrompt last typed: the happy three-capture script
      // without hand-scripting pane order per row.
      return { code: 0, stdout: lastLiteral === '' ? emptyBox : anyEchoBox(lastLiteral), stderr: '' };
    }
    if (args[0] === 'send-keys') {
      if (args[3] === '-l') lastLiteral = args[4] ?? '';
      else if (args[3] === 'Enter') lastLiteral = '';
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  return { home, calls, run };
};

const seedRow = (home: string, row: DeliverabilityRow): void => {
  const reg = path.join(home, '.cc-sessions');
  if (row.registry !== 'absent') {
    const fields: Record<string, string> = {
      wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid: UUID,
    };
    if (row.started) fields['started'] = '1';
    if (row.supervisedAgoSec !== null) {
      fields['supervised'] = String(Math.floor((PARITY_NOW - row.supervisedAgoSec * 1000) / 1000));
    }
    if (row.stoppedAgoSec !== null) {
      fields['stopped'] = `${Math.floor((PARITY_NOW - row.stoppedAgoSec * 1000) / 1000)} pwa`;
    }
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    // A fresh, ask-free hookstate — the transient ask gate stays open.
    writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
      v: 1, state: 'done', sessionId: UUID, pid: PARITY_PID, event: null,
      updatedAt: PARITY_NOW - 61_000, ask: null, subagents: [],
    }));
    const live = path.join(home, '.claude', 'sessions');
    mkdirSync(live, { recursive: true });
    writeFileSync(path.join(live, `${PARITY_PID}.json`), JSON.stringify({
      pid: PARITY_PID, sessionId: UUID, cwd: '/w/demo', name: null, nameSource: null,
      status: 'idle', version: '2.1.220',
      // quiet: idle for longer than MAIL_QUIET_MS; busy: fresh activity.
      statusUpdatedAt: row.quiet ? PARITY_NOW - MAIL_QUIET_MS - 1_000 : PARITY_NOW - 1_000,
    }));
  }
};

/** Drives the REAL sweep for one row; answers "did it send". */
const sweepArm = async (row: DeliverabilityRow): Promise<boolean> => {
  const h = harness(row);
  const coord = new CoordStore(openCoordDb(path.join(h.home, '.ccrc', 'coord.db')));
  const io = row.registry === 'unmeasurable' ? unreadableField(ID, 'wrapper') : localIO;
  const deps: Deps = { ...testDeps(h.home, h.run), coord, io };
  const w = new FleetWatcher(deps, new Bus(), 2000);
  await w.tick();                                    // prime against the empty registry
  seedRow(h.home, row);
  const mail = coord.insertMail({ fromId: FROM_ID, fromUuid: FROM_UUID, toId: ID, runId: null,
    kind: 'finding', subject: 'parity', body: 'parity fixture', artifacts: [] });
  coord.queueDelivery(mail.id, ID, 'parity fixture');
  await w.sweepMail();
  return h.calls.some((a) => a[0] === 'send-keys' && a[3] === '-l');
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PARITY_NOW);
});
afterEach(() => { vi.useRealTimers(); });

describe('deliverability parity: sweepMail and peerDeliverable read one world', () => {
  it('the table covers every answer class — a scan over a thin table passes everything', () => {
    // Scanner-coverage floor, the coord-routes-single-file rule applied to a
    // fixture: parity over two rows would "agree" vacuously.
    expect(DELIVERABILITY_FIXTURE.length).toBeGreaterThanOrEqual(8);
    const verdicts = DELIVERABILITY_FIXTURE.map((r) => r.expect);
    expect(verdicts).toContain('yes');
    expect(verdicts).toContain('unknown');
    expect(verdicts.some((v) => v.startsWith('no:'))).toBe(true);
    expect(DELIVERABILITY_FIXTURE.some((r) => !r.quiet)).toBe(true);
  });

  for (const row of DELIVERABILITY_FIXTURE) {
    it(row.name, async () => {
      const verdict = peerDeliverable(probeOf(row));
      expect(verdict).toBe(row.expect);

      const sent = await sweepArm(row);
      if (row.quiet) {
        // Every transient gate open: the ladders must agree exactly.
        expect(sent).toBe(verdict === 'yes');
      } else {
        // The R2 boundary, pinned from both sides: busy is deliverable
        // ('yes' — reporting lane state would call a busy peer unreachable)
        // and busy is not sent to (the transient rung is sweepMail's own).
        expect(verdict).toBe('yes');
        expect(sent).toBe(false);
      }
    });
  }
});
