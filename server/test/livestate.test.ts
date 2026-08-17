import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { liveSessionStatus, readLiveState } from '../src/livestate.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';

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
