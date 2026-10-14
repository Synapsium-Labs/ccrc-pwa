// D-3400 (amended), D-3413 — the spawn bound's OUTCOME by attributed re-measurement (fix round 1, item 2; review run 175
// F3/F4). Item 9 (a synchronous throw from the local spawn halts) is `update-local-spawn-throw.test.ts`. The AGENT role's half is
// `agent/test/update-killed-arms.test.ts`; this file holds:
//  1. `decideKilledSpawn`, the ONE pure decision both roles call (`shared/agent-protocol.ts`), over every condition of
//     every arm, asserting the whole sentence (F4: a wrong sentence reds);
//  2. the source scans that tie the decision's premises to `ccd/ccrc`: the two stdout line prefixes are the lines the
//     script prints, on stdout; `_upd_phase queued` sits after the lock probe and before `systemd-run` (so a parent
//     stopped before it has queued nothing, arm A's premise); the report's pid is the writing process's own (arm B's);
//  3. the SERVER role's arms through `runDispatch`, against the row's OWN `updateState`/`updateDetail` and the lease;
//  3b. the FLEET role's rows, through the same `runDispatch`: the agent's arm A (`not-queued`) and arms B and D (an ok reply
//     carrying `detail`) reach the fleet row's OWN `updateState`/`updateDetail`;
//  4. the one-lease invariant across a server-role timeout followed by a fleet request;
//  5. END TO END, the real `ccd/ccrc` behind the real launcher in a fixture HOME (`updateRealBox.ts`'s containment: an env
//     from scratch, a stub `systemd-run` that only RECORDS and HANGS, a stub `curl` that SLEEPS, nothing ever starts a
//     unit) through the REAL bounded `localUpdateSpawnFor`: arm B and arm A, and the pid measurement;
//  6. the op-level half of a grandchild holding the pipes, on the server's row.
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  UPDATE_DETACHED_PREFIX, UPDATE_OP_DETAIL_MAX, UPDATE_PHASE_WARN_PREFIX, UPDATE_SPAWN_DRAIN_MS, decideKilledSpawn, type UpdateReportRead,
} from '../../shared/agent-protocol.js';
import type { RequestKind } from '../../shared/api.js';
import type { ExecResult } from '../src/exec.js';
import { AgentOpError } from '../src/remote/client.js';
import { runDispatch, localUpdateSpawnFor } from '../src/update/converge.js';
import { RELEASE_TAG_COMPONENT_MAX_DIGITS } from '../src/update/resolve.js';
import {
  ACCEPTED, FLEET_ID, SERVER_ID, T0, TAG, harness, hang, plant, ran, reportFile, seedFleet, seedServer, serverMeas, type Harness,
} from './updateKilledHarness.js';
import { CCRC_SRC, TERMINAL_REPORT, plantRealBox, type RealBoxOpts } from './updateRealBox.js';
import { itLinux } from './platformFixtures.js';
import { FAKE_SPAWN_PID } from './updateSpawnFake.js';

const BOUND = '20000 ms';
const D_HEAD = 'stopped at the bound; ';
const LONGEST_TAG = `v${Array.from({ length: 3 }, () => '9'.repeat(RELEASE_TAG_COMPONENT_MAX_DIGITS)).join('.')}`;
const dTail = (tag: string): string => ` - it could not be attributed; lease for ${tag} held until the report or deadline`;
/** The sentences, spelled out (the builder is L0's; a test that called it would agree with any wording). */
const armA = `the --detach parent was stopped at the ${BOUND} bound before it queued anything; nothing started`;
const armB = (pid: number, tag = TAG): string =>
  `the --detach parent was stopped at the ${BOUND} bound after it queued ${tag} (pid ${pid}); the run may have started, lease held`;
const armD = (seen: string, tag = TAG): string =>
  `${D_HEAD}${seen}${dTail(tag)}`;
const WARN_LINE = 'update: WARN: could not write ~/.ccrc/update.json (phase queued) — the console will not see this phase; the update continues\n';
const DETACHED_LINE = "update: detached — 'update --to v0.0.10' runs as a transient systemd --user unit; its progress is ~/.ccrc/update.json\n";

const T_REPORT = TERMINAL_REPORT;
const bytes = (text: string): UpdateReportRead => ({ kind: 'bytes', text });
const ABSENT: UpdateReportRead = { kind: 'absent' };
const UNREADABLE: UpdateReportRead = { kind: 'unreadable' };
const reportText = (o: Record<string, unknown> = {}): string => `${JSON.stringify({
  target: TAG, phase: 'queued', startedAt: 1790000000, updatedAt: 1790000001, detail: null, from: 'pwa', pid: FAKE_SPAWN_PID, ...o,
})}\n`;

describe('decideKilledSpawn — the arms, in order A, B, D (D-3400 amended, D-3413)', () => {
  const T = TERMINAL_REPORT;
  const decide = (i: Partial<Parameters<typeof decideKilledSpawn>[0]>): ReturnType<typeof decideKilledSpawn> =>
    decideKilledSpawn({ before: bytes(T), after: bytes(T), stdout: '', pid: FAKE_SPAWN_PID, tag: TAG, ...i });

  it('A: identical bytes, or absent at both, with stdout read to EOF carrying neither line', () => {
    expect(decide({})).toEqual({ arm: 'A', detail: armA });
    expect(decide({ before: ABSENT, after: ABSENT })).toEqual({ arm: 'A', detail: armA });
    expect(decide({ stdout: 'update: resolving\n', pid: null })).toEqual({ arm: 'A', detail: armA });
  });

  it('A never fires for two UNREADABLE reads (unreadable is not identical), nor for a readable and an unreadable one', () => {
    for (const [before, after] of [[UNREADABLE, UNREADABLE], [bytes(T), UNREADABLE], [UNREADABLE, bytes(T)], [UNREADABLE, ABSENT], [ABSENT, UNREADABLE]] as const) {
      expect(decide({ before, after }).arm, `${before.kind} -> ${after.kind}`).toBe('D');
    }
  });

  it('B: the re-read names the killed parent\'s pid and the lease\'s tag', () => {
    expect(decide({ after: bytes(reportText()) })).toEqual({ arm: 'B', detail: armB(FAKE_SPAWN_PID) });
    // Absent before is fine: the parent wrote a report where there was none.
    expect(decide({ before: ABSENT, after: bytes(reportText()) })).toEqual({ arm: 'B', detail: armB(FAKE_SPAWN_PID) });
    // Order A -> B -> D: B holds over the printed lines.
    expect(decide({ after: bytes(reportText()), stdout: DETACHED_LINE + WARN_LINE }).arm).toBe('B');
  });

  it('B needs BOTH: another pid, another tag, no pid from the spawner, an unparseable report are each D', () => {
    expect(decide({ after: bytes(reportText({ pid: 777 })) })).toEqual({
      arm: 'D', detail: armD(`update.json changed, but not by the parent (pid 777, target ${TAG})`),
    });
    expect(decide({ after: bytes(reportText({ target: 'v0.0.11' })) })).toEqual({
      arm: 'D', detail: armD("update.json changed to the parent's report for another target (v0.0.11)"),
    });
    expect(decide({ after: bytes(reportText()), pid: null }).arm).toBe('D');
    expect(decide({ after: bytes('not json\n') })).toEqual({ arm: 'D', detail: armD('update.json changed to something unparseable') });
    // A pid of 0 or a negative one is not a pid (`inFlightReport`'s rule): never a match.
    expect(decide({ after: bytes(reportText({ pid: 0 })), pid: 0 }).arm).toBe('D');
    expect(decide({ after: bytes(reportText({ target: null })) })).toEqual({
      arm: 'D', detail: armD("update.json changed to the parent's report for another target (none)"),
    });
  });

  it('D, one condition at a time, each saying what was seen', () => {
    expect(decide({ after: UNREADABLE })).toEqual({ arm: 'D', detail: armD('update.json was unreadable after the stop') });
    expect(decide({ before: UNREADABLE, after: bytes(T) })).toEqual({ arm: 'D', detail: armD('update.json was unreadable before the spawn') });
    expect(decide({ before: UNREADABLE, after: UNREADABLE })).toEqual({ arm: 'D', detail: armD('update.json was unreadable before and after') });
    expect(decide({ after: ABSENT })).toEqual({ arm: 'D', detail: armD('update.json was removed') });
    expect(decide({ stdout: WARN_LINE })).toEqual({ arm: 'D', detail: armD('the parent printed the update.json WARN') });
    expect(decide({ stdout: DETACHED_LINE })).toEqual({ arm: 'D', detail: armD("the parent printed 'detached'") });
    expect(decide({ stdout: null })).toEqual({ arm: 'D', detail: armD('its stdout did not reach EOF') });
    // Both lines, absent at both: still D (absent at both is only A's identity, not A).
    expect(decide({ before: ABSENT, after: ABSENT, stdout: WARN_LINE + DETACHED_LINE }).arm).toBe('D');
  });

  it('the two printed lines are matched as line prefixes of stdout, not as a substring anywhere', () => {
    expect(decide({ stdout: `x ${UPDATE_PHASE_WARN_PREFIX}\n` }).arm).toBe('A');
    expect(decide({ stdout: `${UPDATE_PHASE_WARN_PREFIX}` }).arm).toBe('D');
    expect(decide({ stdout: `a\n${UPDATE_DETACHED_PREFIX} — done` }).arm).toBe('D');
  });

  it('every detail is ONE printable line within UPDATE_OP_DETAIL_MAX, however much was seen — the ending survives', () => {
    const all = decide({ before: UNREADABLE, after: bytes(reportText({ pid: 123456789, target: 'v99999.99999.99999' })), stdout: WARN_LINE + DETACHED_LINE });
    expect(all.arm).toBe('D');
    expect(all.detail.length).toBeLessThanOrEqual(200);
    expect(all.detail).toMatch(/^[\x20-\x7e]+$/);
    expect(all.detail.endsWith(` - it could not be attributed; lease for ${TAG} held until the report or deadline`)).toBe(true);
    expect(all.detail).toContain('(+');
    // The lease's own tag rides the ending, whatever it is; arm B's sentence fits the longest tag the ingress admits.
    const longB = decide({ after: bytes(reportText({ pid: 4294967295, target: LONGEST_TAG })), pid: 4294967295, tag: LONGEST_TAG });
    expect(longB.arm).toBe('B');
    expect(longB.detail.length).toBeLessThanOrEqual(UPDATE_OP_DETAIL_MAX);
  });

  // Review of f7762afcc, I1: the ending names the lease's tag, so the room left for reasons shrank, and a first reason that
  // did not fit was cut mid-token with its `(+N more)` dropped — `target v0.0.12` read as a real, different tag.
  it('a reason is never cut mid-token unmarked, and never loses the count of the reasons left out (I1)', () => {
    // Measured case 1: a 3-digit tag and a 7-digit pid used to cut `target v0.0.123` to `target v0.0.12`.
    const r1 = 'update.json changed, but not by the parent (pid 1234567, target v0.0.123)';
    expect(decide({ after: bytes(reportText({ pid: 1234567, target: 'v0.0.123' })), tag: 'v0.0.100' }))
      .toEqual({ arm: 'D', detail: armD(r1, 'v0.0.100') });
    // Measured case 2: the first reason fits, the second cannot: the first is whole, the count says one more.
    const r2 = 'update.json changed, but not by the parent (pid 123456, target v0.0.40)';
    expect(decide({ after: bytes(reportText({ pid: 123456, target: 'v0.0.40' })), stdout: null, tag: 'v0.0.40' }))
      .toEqual({ arm: 'D', detail: armD(`${r2} (+1 more)`, 'v0.0.40') });
  });

  it('the longest tag the ingress admits (derived from RELEASE_TAG_COMPONENT_MAX_DIGITS): within the bound, the ending whole, every cut marked and counted (I1)', () => {
    expect(LONGEST_TAG.length).toBe(3 * RELEASE_TAG_COMPONENT_MAX_DIGITS + 3);
    const cases = [
      { after: bytes(reportText({ pid: 4294967295, target: LONGEST_TAG })), stdout: '', reasons: [`update.json changed, but not by the parent (pid 4294967295, target ${LONGEST_TAG})`] },
      { after: bytes(reportText({ pid: 4294967295, target: LONGEST_TAG })), stdout: null, reasons: [`update.json changed, but not by the parent (pid 4294967295, target ${LONGEST_TAG})`, 'its stdout did not reach EOF'] },
      { after: bytes(T_REPORT), stdout: WARN_LINE + DETACHED_LINE, reasons: ['the parent printed the update.json WARN', "the parent printed 'detached'"] },
      { after: UNREADABLE, stdout: null, reasons: ['update.json was unreadable after the stop', 'its stdout did not reach EOF'] },
    ];
    for (const c of cases) {
      const d = decideKilledSpawn({ before: bytes(T_REPORT), after: c.after, stdout: c.stdout, pid: FAKE_SPAWN_PID, tag: LONGEST_TAG });
      expect(d.arm).toBe('D');
      expect(d.detail.length).toBeLessThanOrEqual(UPDATE_OP_DETAIL_MAX);
      expect(d.detail.startsWith(D_HEAD)).toBe(true);
      expect(d.detail.endsWith(dTail(LONGEST_TAG))).toBe(true);
      const body = d.detail.slice(D_HEAD.length, d.detail.length - dTail(LONGEST_TAG).length);
      const count = /^(.*?)(?: \(\+(\d+) more\))?$/.exec(body)!;
      // Walk the reasons in order (some carry a comma of their own, so no split): each is whole and `, `-joined, until the
      // last one named, which may be cut — and then only with `...`, as a prefix of its reason.
      let rest = count[1]!;
      let named = 0;
      for (const want of c.reasons) {
        if (rest === '') break;
        named += 1;
        if (rest === want) { rest = ''; break; }
        if (rest.startsWith(`${want}, `)) { rest = rest.slice(want.length + 2); continue; }
        expect(rest.endsWith('...'), `neither whole nor marked: ${rest}`).toBe(true);
        expect(want.startsWith(rest.slice(0, -3)), `not a prefix of its reason: ${rest}`).toBe(true);
        rest = '';
        break;
      }
      expect(rest, 'text left over that names no reason').toBe('');
      expect(named + Number(count[2] ?? 0), 'named + counted = every reason').toBe(c.reasons.length);
    }
  });

  it('the prefixes are the ones L0 declares', () => {
    expect(UPDATE_PHASE_WARN_PREFIX).toBe('update: WARN: could not write ~/.ccrc/update.json');
    expect(UPDATE_DETACHED_PREFIX).toBe('update: detached');
  });
});

describe('the decision\'s premises, read from ccd/ccrc (the two lines it declares, and the order it relies on)', () => {
  const src = readFileSync(CCRC_SRC, 'utf8');
  const fn = (name: string): string => {
    const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}$`, 'm').exec(src);
    expect(m, `${name} not found in ccd/ccrc`).not.toBeNull();
    return m![0];
  };

  it('_upd_phase prints the declared WARN line on STDOUT (no redirect), and only when it could not write', () => {
    const body = fn('_upd_phase');
    const echo = body.split('\n').find((l) => l.includes(UPDATE_PHASE_WARN_PREFIX.replace('update: ', '')));
    expect(echo, 'the WARN echo').toBeDefined();
    expect(echo!.trim().startsWith(`echo "${UPDATE_PHASE_WARN_PREFIX}`)).toBe(true);
    expect(echo!).not.toMatch(/>&2|>\s*\/dev\/null/);
  });

  it('_upd_detach prints the declared detached line on STDOUT, last, after the systemd-run succeeded', () => {
    const body = fn('_upd_detach');
    const echo = body.split('\n').find((l) => l.trim().startsWith(`echo "${UPDATE_DETACHED_PREFIX}`));
    expect(echo, 'the detached echo').toBeDefined();
    expect(echo!).not.toMatch(/>&2/);
    expect(body.indexOf(echo!)).toBeGreaterThan(body.indexOf('_svc_run_detached'));
  });

  it('_upd_detach: the lock probe, then the `queued` write, then systemd-run — a parent stopped before `queued` queued nothing (arm A)', () => {
    const body = fn('_upd_detach');
    const probe = body.indexOf('_upd_lock_probe');
    const queued = body.indexOf('_upd_phase queued');
    const run = body.indexOf('_svc_run_detached');
    expect(probe).toBeGreaterThan(-1);
    expect(queued).toBeGreaterThan(probe);
    expect(run).toBeGreaterThan(queued);
  });

  it('the report\'s pid is the writing process\'s own ($$ unless UPD_REPORT_PID overrides): the value arm B compares (D-3411\'s invariant)', () => {
    expect(fn('_upd_phase')).toContain('"${UPD_REPORT_PID:-$$}"');
    // `_upd_detach` never sets an override, so the `queued` write carries `$$`, the parent's own pid.
    expect(fn('_upd_detach')).not.toMatch(/UPD_REPORT_PID/);
  });
});

// ── the server role, through runDispatch ─────────────────────────────────────────────────────────────────────────────

describe('the server role: arm A releases idle, B and D hold — each asserting the ROW\'s own words (F4)', () => {
  it('A: nothing queued (update.json absent at both reads): released idle, the request standing, not halting, and the row says so', async () => {
    const h = harness({ run: hang, boundMs: 20 });
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'released', to: 'idle', detail: `not-queued — ${armA}` });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', updateDetail: `not-queued — ${armA}`, requestedTag: TAG, requestedKind: 'update' });
    const again = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(again.plan.gate.haltedBy).toEqual([]);
    expect(h.spawned).toBe(2);
  });

  it('A: identical bytes at both reads, stdout at EOF: the same', async () => {
    const h = harness({ run: () => { plant(h, TERMINAL_REPORT); return hang(h.home, []); }, boundMs: 20 });
    // A read BEFORE the spawn already sees the terminal report, so both reads carry it.
    plant(h, TERMINAL_REPORT);
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'released', to: 'idle', detail: `not-queued — ${armA}` });
    expect(readFileSync(reportFile(h), 'utf8')).toBe(TERMINAL_REPORT);
  });

  it('B: the parent queued our tag under its own pid: the lease is HELD, the row is pending and says what happened, the inventory is asked once', async () => {
    const h = harness({ boundMs: 20, run: () => { plant(h, reportText()); return hang(h.home, []); } });
    plant(h, TERMINAL_REPORT);
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'accepted', detail: armB(FAKE_SPAWN_PID) });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'pending', updateDetail: armB(FAKE_SPAWN_PID), requestedTag: TAG, updateStartedAt: T0 + 1000 });
    expect(h.accepted()).toBe(1);
  });

  const D_CASES: readonly { name: string; before: string | null; during: string | null | 'dir'; stdout: string | null; pid?: number | null; seen: string }[] = [
    { name: 'unreadable after (a directory planted at the name)', before: TERMINAL_REPORT, during: 'dir', stdout: '', seen: 'update.json was unreadable after the stop' },
    { name: 'changed to ANOTHER pid', before: TERMINAL_REPORT, during: reportText({ pid: 777 }), stdout: '', seen: `update.json changed, but not by the parent (pid 777, target ${TAG})` },
    { name: 'changed to ANOTHER tag', before: TERMINAL_REPORT, during: reportText({ target: 'v0.0.11' }), stdout: '', seen: "update.json changed to the parent's report for another target (v0.0.11)" },
    { name: 'the WARN line on stdout, report unchanged', before: TERMINAL_REPORT, during: null, stdout: WARN_LINE, seen: 'the parent printed the update.json WARN' },
    { name: 'the detached line on stdout, report unchanged', before: TERMINAL_REPORT, during: null, stdout: DETACHED_LINE, seen: "the parent printed 'detached'" },
    { name: 'stdout never reached EOF', before: TERMINAL_REPORT, during: null, stdout: null, seen: 'its stdout did not reach EOF' },
    { name: 'our tag but no pid from the spawner', before: TERMINAL_REPORT, during: reportText(), stdout: '', pid: null, seen: `update.json changed, but not by the parent (pid ${FAKE_SPAWN_PID}, target ${TAG})` },
  ];
  for (const c of D_CASES) {
    it(`D: ${c.name} — HELD, and the row says what was seen and that it could not be attributed`, async () => {
      const h = harness({
        boundMs: 20, answer: { stdout: c.stdout, pid: c.pid === undefined ? FAKE_SPAWN_PID : c.pid },
        run: () => {
          if (c.during === 'dir') { plant(h, null); rmSync(reportFile(h)); mkdirSync(reportFile(h)); }
          else if (c.during !== null) plant(h, c.during);
          return hang(h.home, []);
        },
      });
      if (c.before !== null) plant(h, c.before);
      seedServer(h);
      const r = ran(await runDispatch(h.deps, T0 + 1000));
      expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'accepted', detail: armD(c.seen) });
      expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'pending', updateDetail: armD(c.seen), requestedTag: TAG });
    });
  }

  it('D: update.json unreadable BEFORE the spawn and after (a FIFO at the name): held', async () => {
    const h = harness({ run: hang, boundMs: 20 });
    mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    const { execFileSync } = await import('node:child_process');
    execFileSync('mkfifo', [reportFile(h)]);
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'accepted', detail: armD('update.json was unreadable before and after') });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'pending', updateDetail: armD('update.json was unreadable before and after') });
  });

  it('a report that settled the row between the kill and the note is never overwritten: the note refuses a settled row (noteLeaseDetail\'s guard)', async () => {
    const h = harness({ boundMs: 20, run: () => {
      // While the parent "runs", the inventory sweep releases the lease out of band (a `done` report settled it).
      expect(h.store.settleNode(SERVER_ID, 'met: v0.0.10', null).ok).toBe(true);
      return hang(h.home, []);
    } });
    seedServer(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', updateDetail: 'met: v0.0.10', requestedTag: null });
  });
});

// ── the fleet role, through runDispatch (the agent's answers, in the words its own L0 decision builds) ───────────────
// The harness's fleet link always answers a bare ACCEPTED, so these replace `send`. The sentences come from
// `decideKilledSpawn` (the ONE decision the agent calls), not a copy; each case pins the verdict's arm first, so a
// sentence built for the wrong arm cannot stand in for the right one.

describe('the fleet role: the agent\'s arm A releases idle, arms B and D hold — each asserting the FLEET row\'s own words (I1)', () => {
  const verdict = (i: Partial<Parameters<typeof decideKilledSpawn>[0]>): ReturnType<typeof decideKilledSpawn> =>
    decideKilledSpawn({ before: bytes(TERMINAL_REPORT), after: bytes(TERMINAL_REPORT), stdout: '', pid: FAKE_SPAWN_PID, tag: TAG, ...i });
  /** A fleet request through `runDispatch` with the link answering `answer`; a server request is queued behind it so a
   *  held lease shows as a server move that did not happen. */
  function fleetRun(answer: () => Promise<{ t: 'res'; id: number; ok: true; accepted: true; detail?: string }>): { h: Harness; sends: number[] } {
    const h = harness({ run: hang });
    const sends: number[] = [];
    h.deps.fleet = { ...h.deps.fleet!, send: async () => { sends.push(sends.length); return answer(); } };
    seedFleet(h);
    seedServer(h);
    return { h, sends };
  }

  it('B: an ok reply carrying the arm-B sentence: the fleet row is pending with EXACTLY that updateDetail, and the lease holds the server back', async () => {
    const v = verdict({ after: bytes(reportText()) });
    expect(v.arm).toBe('B');
    const { h, sends } = fleetRun(async () => ({ ...ACCEPTED, detail: v.detail }));
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: FLEET_ID, result: 'accepted', detail: v.detail });
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateDetail: v.detail, requestedTag: TAG, updateStartedAt: T0 + 1000 });
    expect(h.accepted()).toBe(1);
    const next = ran(await runDispatch(h.deps, T0 + 2000));
    expect(next.plan.gate.leaseHeldBy).toBe(FLEET_ID);
    expect(next.outcome).toBeNull();
    expect(sends).toHaveLength(1);
    expect(h.spawned, 'the server moved while the fleet row holds the lease').toBe(0);
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: TAG });
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateDetail: v.detail });
  });

  it('D: an ok reply carrying the arm-D sentence: the same, with the sentence that says it could not be attributed', async () => {
    const v = verdict({ stdout: null });
    expect(v.arm).toBe('D');
    expect(v.detail).toBe(armD('its stdout did not reach EOF'));
    const { h, sends } = fleetRun(async () => ({ ...ACCEPTED, detail: v.detail }));
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: FLEET_ID, result: 'accepted', detail: v.detail });
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateDetail: v.detail, requestedTag: TAG });
    const next = ran(await runDispatch(h.deps, T0 + 2000));
    expect(next.plan.gate.leaseHeldBy).toBe(FLEET_ID);
    expect(next.outcome).toBeNull();
    expect(sends).toHaveLength(1);
    expect(h.spawned).toBe(0);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateDetail: v.detail });
  });

  it('A: a `not-queued` AgentOpError carrying the arm-A sentence: the fleet row is released idle, says `not-queued — <sentence>`, and the request stands', async () => {
    const v = verdict({});
    expect(v.arm).toBe('A');
    const { h } = fleetRun(async () => { throw new AgentOpError('not-queued', v.detail); });
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: FLEET_ID, result: 'released', to: 'idle', detail: `not-queued — ${v.detail}` });
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateDetail: `not-queued — ${v.detail}`, requestedTag: TAG, requestedKind: 'update',
    });
    expect(h.accepted()).toBe(0);
  });
});

describe('one lease, fleet-wide, across a server-role timeout followed by a fleet request', () => {
  it('arm B: the server row\'s lease stays held, and the run moves NOTHING else', async () => {
    const h = harness({ boundMs: 20, run: () => { plant(h, reportText()); return hang(h.home, []); } });
    plant(h, TERMINAL_REPORT);
    seedServer(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    seedFleet(h);
    const r = ran(await runDispatch(h.deps, T0 + 2000));
    expect(r.plan.gate.leaseHeldBy).toBe(SERVER_ID);
    expect(r.outcome).toBeNull();
    expect(h.sent).toEqual([]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', requestedTag: TAG });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'pending' });
    expect(h.spawned).toBe(1);
  });

  it('arm D: the same', async () => {
    const h = harness({ run: hang, boundMs: 20, answer: { stdout: null } });
    plant(h, TERMINAL_REPORT);
    seedServer(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    seedFleet(h);
    const r = ran(await runDispatch(h.deps, T0 + 2000));
    expect(r.plan.gate.leaseHeldBy).toBe(SERVER_ID);
    expect(r.outcome).toBeNull();
    expect(h.sent).toEqual([]);
  });

  it('arm A: the lease is released, so the fleet request MAY then move (and the server\'s request stands behind it)', async () => {
    const h = harness({ run: hang, boundMs: 20 });
    seedServer(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: TAG });
    seedFleet(h);
    const r = ran(await runDispatch(h.deps, T0 + 2000));
    expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(h.sent).toEqual([{ tag: TAG, kind: 'update' }]);
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: TAG });
  });
});

// ── end to end, the real ccrc ────────────────────────────────────────────────────────────────────────────────────────

describe('the bound against the REAL ccrc, through the real bounded localUpdateSpawnFor (server role)', () => {
  const stubs: { home: string; file: string }[] = [];
  afterEach(() => {
    // A stub that failed to die is killed by the pid it recorded, never by name.
    for (const { home, file } of stubs.splice(0)) {
      try { process.kill(Number(readFileSync(path.join(home, file), 'utf8').trim()), 'SIGKILL'); } catch { /* gone, as intended */ }
    }
  });
  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  async function untilDead(pid: number): Promise<boolean> {
    for (let i = 0; i < 60 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
    return !alive(pid);
  }
  function real(opts: RealBoxOpts, boundMs: number, kind: RequestKind = 'update', tag = TAG): Harness {
    const h = harness({});
    h.deps.runLocal = plantRealBox(h.home, opts).spawn(boundMs);
    expect(h.store.upsertNodeMeasurement(serverMeas()).ok).toBe(true);
    expect(h.store.requestNode(SERVER_ID, tag, kind, T0).ok).toBe(true);
    return h;
  }

  // PLATFORM-ONLY: `--detach` is Linux-only (design decision 17: `_upd_detach_os_check` refuses it on darwin before any lock probe or systemd-run), so a darwin arm has nothing to assert.
  itLinux('arm B: the real parent queued and blocks in a hanging systemd-run; the row holds the lease and names the report\'s own pid (the spawner\'s pid IS the report\'s)', async () => {
    const h = real({ systemdRun: 'hang' }, 6000);
    stubs.push({ home: h.home, file: 'systemd-run-pid' });
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    const report = JSON.parse(readFileSync(reportFile(h), 'utf8')) as { pid: number; target: string; phase: string };
    expect(report).toMatchObject({ phase: 'queued', target: TAG });
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'accepted', detail: armB(report.pid) });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'pending', updateDetail: armB(report.pid), requestedTag: TAG });
    const runArgv = readFileSync(path.join(h.home, 'systemd-run-argv'), 'utf8').trim().split('\n');
    expect(runArgv).toHaveLength(1);
    // The unit the killed parent asked for is OUR tag under the pwa's name (the agent twin asserts the same words).
    expect(runArgv[0]).toContain(`ccrc-detach update --to ${TAG} --from pwa`);
    expect(existsSync(path.join(h.home, 'systemctl-argv'))).toBe(false);
    expect(await untilDead(Number(readFileSync(path.join(h.home, 'systemd-run-pid'), 'utf8').trim())), 'the hanging systemd-run stub survived').toBe(true);
    expect(await untilDead(report.pid), 'the killed parent survived').toBe(true);
  }, 30_000);

  itLinux('arm A: a rollback parent stopped inside its release-host question, before `queued`: released idle, update.json byte-identical', async () => {
    const h = real({ curl: 'sleep' }, 3000, 'rollback', 'v0.0.8');
    stubs.push({ home: h.home, file: 'curl-pid' });
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'released', to: 'idle', detail: `not-queued — ${armA}` });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', updateDetail: `not-queued — ${armA}`, requestedTag: 'v0.0.8', requestedKind: 'rollback' });
    expect(readFileSync(reportFile(h), 'utf8')).toBe(TERMINAL_REPORT);
    expect(readFileSync(path.join(h.home, 'curl-argv'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(existsSync(path.join(h.home, 'systemd-run-argv'))).toBe(false);
    expect(await untilDead(Number(readFileSync(path.join(h.home, 'curl-pid'), 'utf8').trim())), 'the sleeping curl stub survived').toBe(true);
  }, 30_000);

  itLinux('a grandchild that left the group still holds the pipes: the row is answered within bound + drain, held, and says stdout never reached EOF', async () => {
    const h = harness({});
    const bin = path.join(h.home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    const launcher = path.join(bin, 'ccrc');
    writeFileSync(launcher, `#!/bin/sh\nsetsid sh -c 'echo $$ > "$HOME/gc-pid"; exec sleep 300' &\nexec sleep 300\n`);
    chmodSync(launcher, 0o755);
    stubs.push({ home: h.home, file: 'gc-pid' });
    h.deps.runLocal = localUpdateSpawnFor(h.home, { env: { HOME: h.home, PATH: '/usr/bin:/bin' }, timeoutMs: 300 });
    seedServer(h);
    const started = Date.now();
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(300 + UPDATE_SPAWN_DRAIN_MS + 4000);
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'accepted', detail: armD('its stdout did not reach EOF') });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'pending', updateDetail: armD('its stdout did not reach EOF') });
  }, 30_000);
});
