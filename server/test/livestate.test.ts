import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { liveSessionStatus, readLiveState, readLiveStateMeasured } from '../src/livestate.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import { degradedReadIO } from './ioDoubles.js';

/** Write `<configDir>/sessions/<pid>.json` and hand back the configDir. */
function seedLive(raw: unknown, pid = 4242): { configDir: string; pid: number } {
  const configDir = path.join(mkTmp('ccrc-live-'), '.claude');
  mkdirSync(path.join(configDir, 'sessions'), { recursive: true });
  writeFileSync(path.join(configDir, 'sessions', `${pid}.json`), JSON.stringify(raw));
  return { configDir, pid };
}

const base = {
  pid: 4242, sessionId: '3'.repeat(36), cwd: '/data/projects/demo',
  name: 'demo-1', status: 'busy', statusUpdatedAt: 1786973261696, version: '2.1.233',
};

// This file is `readLiveState`'s FIRST direct coverage. Until D-76 the only
// thing exercising it was `assembleFleet`'s own fixtures, which is why the
// `waiting` status below survived several Claude Code releases unnoticed: no
// test ever handed this parser a status word it had not been written for.
describe('liveSessionStatus', () => {
  it('reads only the literal `idle` as idle — every other word is work', () => {
    expect(liveSessionStatus('idle')).toBe('idle');
    expect(liveSessionStatus('busy')).toBe('busy');
    expect(liveSessionStatus('shell')).toBe('busy');
  });

  // FROZEN, and this test exists to keep it frozen. `waiting` gets its own
  // route to the attention bucket (D-76, below), but the collapse to `busy`
  // here must NOT change: three consumers read `SessionStatus` for "may I act
  // on this session right now" — the mail delivery gate (watch.ts), the
  // archive-safety verdict (watch.ts's `archiveSafety`) and the per-session
  // socket — and for every one of them a human-blocked session is a session
  // they must keep their hands off. Turning `waiting` into `idle` here would
  // let mail inject into an open dialog and let auto-archive kill a session
  // sitting on a permission prompt.
  it('collapses Claude Codes `waiting` to busy — never to idle', () => {
    expect(liveSessionStatus('waiting')).toBe('busy');
  });

  it('treats an unrecognised future status as work, not rest', () => {
    expect(liveSessionStatus('reticulating')).toBe('busy');
  });
});

describe('readLiveState', () => {
  it('parses the file Claude Code actually writes', async () => {
    const { configDir, pid } = seedLive(base);
    const live = await readLiveState(localIO, configDir, pid);
    expect(live?.status).toBe('busy');
    expect(live?.statusUpdatedAt).toBe(1786973261696);
    expect(live?.version).toBe('2.1.233');
  });

  it('returns null for a file that is not there', async () => {
    const { configDir } = seedLive(base);
    expect(await readLiveState(localIO, configDir, 9999)).toBeNull();
  });

  // D-76. MEASURED in the shipped bundle (2.1.229-2.1.233 on this box, all
  // four identical on this point): Claude Code writes a FOURTH status word
  // this reader had never heard of —
  //
  //     function k2h(e){let t=aTw(e);if(t!==void 0)
  //       return{status:"waiting",waitingFor:t,working:!1};…}
  //
  // — where `aTw` answers `"sandbox request"`, `"input needed"`,
  // `"dialog open"` or the top dialog's own `waitingFor`. Claude Code is
  // explicit that this is not work (`working:!1`); ccrc read it as busy and
  // filed the row under `working`, because the bucket ladder never consults
  // `status` for attention and the pane scraper is not a reliable backstop
  // (`dialog.ts`'s `BUSY_RE` tests the WHOLE pane, so one `esc to interrupt`
  // in scrollback classifies a menu pane as busy, and three of the four
  // `waitingFor` causes paint no numbered menu to match at all).
  //
  // Parsed rather than inferred: the reason string is already on disk, and
  // discarding it here would be exactly the "adapter narrowing a distinction
  // it received" the architecture doc names as the highest-yield rule.
  it('D-76: parses `waitingFor` — the reason Claude Code is blocked on the human', async () => {
    const { configDir, pid } = seedLive({ ...base, status: 'waiting', waitingFor: 'input needed' });
    const live = await readLiveState(localIO, configDir, pid);
    expect(live?.status).toBe('waiting');
    expect(live?.waitingFor).toBe('input needed');
  });

  it('D-76: `waitingFor` is null when absent — every older file, and every non-waiting one', async () => {
    const { configDir, pid } = seedLive(base);
    expect((await readLiveState(localIO, configDir, pid))?.waitingFor).toBeNull();
  });

  // D-77. `liveSessionStatus` argues at length that an unrecognised status is
  // "far likelier to be new work than new rest", and every unknown WORD does
  // fail that way. The one case that did not was the file with no `status`
  // field at all: `String(raw.status ?? 'idle')` handed the single value that
  // reads as rest to the case carrying the LEAST evidence. Same polarity
  // question, opposite answers, four lines apart.
  //
  // Not hypothetical in kind — a `<pid>.json` without `status` is what
  // Claude Code's non-interactive entrypoints write — though zero of the 20
  // interactive pane files measured on this box (2.1.226-2.1.233) lack it.
  // The direction is what makes it worth closing: it fails toward `idle`,
  // which IS the user-reported symptom.
  it('D-77: a file with no `status` field does not read as idle — no evidence is not rest', async () => {
    const { status: _omitted, ...noStatus } = base;
    const { configDir, pid } = seedLive(noStatus);
    const live = await readLiveState(localIO, configDir, pid);
    expect(live).not.toBeNull();
    expect(liveSessionStatus(live!.status)).toBe('busy');
  });

  it('D-76: a non-string `waitingFor` degrades to null rather than reaching the wire', async () => {
    const { configDir, pid } = seedLive({ ...base, status: 'waiting', waitingFor: 17 });
    const live = await readLiveState(localIO, configDir, pid);
    expect(live?.status).toBe('waiting');   // the status still stands
    expect(live?.waitingFor).toBeNull();    // only the unparseable reason is dropped
  });
});


// D-115's third consumer, at the reader that feeds it. `readLiveState`
// answers `null` for four conditions and three of them are MEASUREMENTS —
// the file is genuinely absent, its bytes are not JSON, or the record names
// no `sessionId` — every one meaning the same actionable thing: this pane has
// published nothing about itself yet. The fourth is not a measurement at all:
// the READ failed, the file is still sitting there, and it may say `busy`.
//
// Folding the fourth into the other three is what let `assembleFleet` and the
// chat header paint `idle · 1m ago` over a session this box never managed to
// look at — a card that says "at rest" on the strength of a permission bit.
// `fleet.test.ts` pins both surfaces, and pins the ONE consumer that keeps
// reading `idle` from this same failure on purpose (`liveStatus`, where
// `idle` REFUSES an interrupt).
describe('readLiveStateMeasured — the distinction readLiveState folds', () => {
  it('a parseable file is the ok arm, carrying the state itself', async () => {
    const { configDir, pid } = seedLive(base);
    const r = await readLiveStateMeasured(localIO, configDir, pid);
    expect(r.ok).toBe(true);
    expect(r.ok && r.state.status).toBe('busy');
    expect(r.ok && r.state.version).toBe('2.1.233');
  });

  it('an ABSENT live file is no-state, not unmeasured — the ordinary shape before a pane first publishes', async () => {
    const { configDir } = seedLive(base);
    expect(await readLiveStateMeasured(localIO, configDir, 9999))
      .toEqual({ ok: false, reason: 'no-state' });
  });

  // The listed-but-its-bytes-never-came-back shape, through the tree's own
  // `FleetIO` double rather than the filesystem — so this case is REAL under
  // every runner, including the root one the chmod twin below has to skip. It
  // is also the shape the remote fleet actually produces: one dropped
  // agent-WS round trip on a file that is certainly there (`ioDoubles.ts`).
  it('an UNREADABLE live file is unmeasured — the arm the null had nowhere to put', async () => {
    const { configDir, pid } = seedLive(base);
    const io = degradedReadIO((p) => p.endsWith(path.join('sessions', `${pid}.json`)));
    expect(await readLiveStateMeasured(io, configDir, pid))
      .toEqual({ ok: false, reason: 'unmeasured' });
  });

  // …and the same thing against a real EACCES, which is what the local fleet
  // produces. Skipped as root (D-116): `chmod 000` denies root nothing, so an
  // unguarded case would quietly assert the OPPOSITE of its own name there.
  it.skipIf(process.getuid?.() === 0)(
    'a real EACCES (chmod 000) is unmeasured too — not the absent arm',
    async () => {
      const { configDir, pid } = seedLive(base);
      const file = path.join(configDir, 'sessions', `${pid}.json`);
      chmodSync(file, 0o000);
      try {
        expect(await readLiveStateMeasured(localIO, configDir, pid))
          .toEqual({ ok: false, reason: 'unmeasured' });
      } finally {
        chmodSync(file, 0o644);   // let the fixture cleanup remove it without fighting perms
      }
    },
  );

  it('a half-written file and a record with no sessionId are no-state too — the fold this type KEEPS', async () => {
    // Both are files this reader successfully looked at and rejected, and no
    // consumer branches between them: a `<pid>.json` caught mid-write is the
    // same "nothing published yet" a missing one is, one poll tick from
    // healing. Splitting them would be a wider type, not a finer measurement
    // (`limits.ts:126`/`commands.ts:73` are the tree's own precedent for
    // leaving an indifferent fold alone).
    const truncated = path.join(mkTmp('ccrc-live-'), '.claude');
    mkdirSync(path.join(truncated, 'sessions'), { recursive: true });
    writeFileSync(path.join(truncated, 'sessions', '4242.json'), '{"pid":4242,"sessionId":"3');
    expect(await readLiveStateMeasured(localIO, truncated, 4242))
      .toEqual({ ok: false, reason: 'no-state' });

    const { sessionId: _omitted, ...noSessionId } = base;
    const anon = seedLive(noSessionId);
    expect(await readLiveStateMeasured(localIO, anon.configDir, anon.pid))
      .toEqual({ ok: false, reason: 'no-state' });
  });

  it('readLiveState still folds all of them, so its four indifferent callers are untouched', async () => {
    // The derivation, measured rather than assumed: the three fixtures the
    // cases above tell apart read back as one `null` through the legacy form.
    // This is the pin that keeps this task a WIDENING and not a change —
    // `liveStatus`, `commands.ts`'s cwd lookup and both of `watch.ts`'s
    // already-fail-shut gates go on seeing exactly what they saw before.
    const absent = seedLive(base);
    expect(await readLiveState(localIO, absent.configDir, 9999)).toBeNull();

    const anon = seedLive({ ...base, sessionId: 17 });
    expect(await readLiveState(localIO, anon.configDir, anon.pid)).toBeNull();

    const degraded = seedLive(base);
    const io = degradedReadIO((p) => p.endsWith(path.join('sessions', `${degraded.pid}.json`)));
    expect(await readLiveState(io, degraded.configDir, degraded.pid)).toBeNull();
  });
});
