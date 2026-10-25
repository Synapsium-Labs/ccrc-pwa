// ARCH-50 (#785), the characterization commit: what each reader of the live file's status word makes of every word, as
// it stands before the readers share one reading. Green on the old code; the move commit changes only what these
// import. The words are the three Claude Code writes (`idle`, `busy`, `shell`) and four it does not: `waiting`, a
// word this build has never seen, an empty string and a word ccd's extractor cannot read (`Idle`).
import { describe, it, expect } from 'vitest';
import { liveSessionStatus } from '../src/livestate.js';
import { stopVerdict } from '../src/coord/archiveDoor.js';
import { mailTurnIdle } from '../src/turnidle.js';
import { hibernateVerdict, HIBERNATE_AFTER_MS_DEFAULT, type HibernateInput } from '../src/coord/hibernate.js';
import { PRESENCE_OPEN_TTL_MS } from '../../shared/api.js';

const WORDS = ['idle', 'busy', 'shell', 'waiting', 'compacting', '', 'Idle'] as const;
const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

describe('every reader of the status word, per word', () => {
  it('liveSessionStatus (the display collapse): idle is idle, everything else is busy', () => {
    expect(WORDS.map((w) => liveSessionStatus(w))).toEqual(['idle', 'busy', 'busy', 'busy', 'busy', 'busy', 'busy']);
  });

  it('stopVerdict (the act would lose a turn): idle reads on to the row; a readable non-idle word is busy; an unextractable one is unmeasured', () => {
    const v = (status: string) => stopVerdict({
      configDir: 'present', pane: 'live', pid: 1, liveFile: { read: 'ok', status },
      row: { status: 'idle', bucket: 'idle' },
    });
    expect(WORDS.map(v)).toEqual(['idle', 'busy', 'busy', 'busy', 'busy', 'unmeasured', 'unmeasured']);
  });

  it('mailTurnIdle (default shell mode, quiet long enough): idle and shell deliver; every other word is not-idle', () => {
    const v = (status: string) => mailTurnIdle({ status, statusUpdatedAt: NOW - HOUR }, null, NOW, 60_000, 'shell');
    expect(WORDS.map((w) => { const r = v(w); return r.deliver ? r.via : r.gate; }))
      .toEqual(['idle', 'not-idle', 'shell', 'not-idle', 'not-idle', 'not-idle', 'not-idle']);
  });

  it('hibernateVerdict (sleep): only a raw idle word goes on to hibernate; every other word holds live-word', () => {
    const input = (word: string): HibernateInput => ({
      row: {
        id: 'lane-a-project-a', status: 'idle', archivedAt: null, bucket: 'idle', held: null, unmeasured: [],
        statusUnmeasured: false, dialogPending: false, background: null, subagents: null, stranded: null,
        swapBlocked: null, substrate: null,
      },
      optedOut: false, viewer: false, sinceStartMs: PRESENCE_OPEN_TTL_MS + 1,
      store: { ok: true, openWorker: false, openClaimant: false, claim: false, mail: false },
      live: {
        kind: 'read', word: { ok: true, word },
        mark: { ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - 7 * HOUR - 1, stopAt: NOW - 7 * HOUR, restartAt: null },
      },
    });
    const v = (w: string) => {
      const r = hibernateVerdict(input(w), NOW, HIBERNATE_AFTER_MS_DEFAULT);
      return r.act === 'hold' ? r.reason : r.act;
    };
    expect(WORDS.map(v)).toEqual(['hibernate', 'live-word', 'live-word', 'live-word', 'live-word', 'live-word', 'live-word']);
  });
});
