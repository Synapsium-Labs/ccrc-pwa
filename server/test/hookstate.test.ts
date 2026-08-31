import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { readHookState, readHookStateMeasured, HOOKSTATE_FRESH_MS } from '../src/hookstate.js';
import { mkTmp } from './tmpHelpers.js';
import { degradedReadIO } from './ioDoubles.js';

const ID = 'claude2-MekWarLive';
const UUID = '1'.repeat(36);
const NOW = 1_800_000_000_000; // arbitrary fixed epoch ms, no relation to real time

const seed = (dir: string, id: string, body: unknown): void => {
  mkdirSync(dir, { recursive: true });
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  writeFileSync(path.join(dir, `${id}.hookstate.json`), text);
};

/** A complete, valid hookstate body — the writer's own shape. */
const base = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, state: 'working', event: 'UserPromptSubmit', sessionId: UUID, pid: 1234,
  updatedAt: NOW, ask: null, subagents: [],
  ...overrides,
});

describe('readHookState', () => {
  it('missing file → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('fresh + matching round-trips every field, including subagents', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({
      state: 'waiting',
      ask: {
        questions: [{
          question: 'Which?', header: 'Pick', multiSelect: true,
          options: [{ label: 'A', description: 'a' }, { label: 'B' }],
        }],
      },
      subagents: [{ name: 'reviewer', startedAt: NOW - 1000 }],
      interrupted: true,
    }));
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out).toEqual({
      state: 'waiting',
      updatedAt: NOW,
      event: 'UserPromptSubmit',
      ask: {
        questions: [{
          question: 'Which?', header: 'Pick', multiSelect: true,
          options: [{ label: 'A', description: 'a' }, { label: 'B' }],
        }],
      },
      // `id` is null (this fixture's file carries none — an older hook) and
      // `description` is ALWAYS null out of the reader: the hookstate file
      // never carries one, the watcher fills it from the launch record.
      subagents: [{ name: 'reviewer', startedAt: NOW - 1000, id: null, description: null }],
      interrupted: true,
    });
  });

  it('the approval ask variant round-trips too', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'waiting', ask: { approval: { tool: 'Bash', summary: 'ls -la' } } }));
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out?.ask).toEqual({ approval: { tool: 'Bash', summary: 'ls -la' } });
  });

  it('a real Claude questions shape — extra fields on both the option and the question — still round-trips', async () => {
    // Pins tolerance: `session-hook.sh` copies `tool_input.questions` VERBATIM
    // off the AskUserQuestion tool call (see server/test/fixtures/
    // transcript-ask-2col.jsonl for the real shape), which carries fields
    // `HookAskQuestion` does not declare — `preview` on the option here, plus
    // an unrecognised top-level key on the question itself. Neither may null
    // the read: only known fields are picked, unknown ones are dropped, and
    // a future strict-schema refactor that started rejecting them instead
    // would silently null every real hookstate file. Extra top-level keys on
    // the record are never spread into the revived object regardless.
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({
      state: 'waiting',
      ask: {
        questions: [{
          question: 'Which approach?', header: 'Pick', multiSelect: false,
          futureField: 'something a newer Claude Code build might add',
          options: [
            { label: 'A', description: 'first', preview: 'a preview blob\nwith lines\nof its own' },
            { label: 'B' },
          ],
        }],
      },
    }));
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out?.ask).toEqual({
      questions: [{
        question: 'Which approach?', header: 'Pick', multiSelect: false,
        options: [{ label: 'A', description: 'first' }, { label: 'B' }],
      }],
    });
  });

  it('subagents absent (e.g. a file from before the field existed) defaults to []', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    const body = base();
    delete body['subagents'];
    seed(reg, ID, body);
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out?.subagents).toEqual([]);
  });

  it('interrupted absent → false', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'done' }));
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out?.interrupted).toBe(false);
  });

  it('reads the event the hook wrote', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ event: 'Stop' }));
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out?.event).toBe('Stop');
  });

  it('event absent (a file written before this field existed) reads null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    const body = base();
    delete body['event'];
    seed(reg, ID, body);
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out?.event).toBeNull();
  });

  it('event empty string reads null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ event: '' }));
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out?.event).toBeNull();
  });

  it('event non-string (e.g. a number) rejects the WHOLE read, not just the field', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ event: 7 }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('stale by 31 minutes → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ updatedAt: NOW - HOOKSTATE_FRESH_MS - 60_000 }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('exactly at the freshness boundary is still fresh (not stale)', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ updatedAt: NOW - HOOKSTATE_FRESH_MS }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).not.toBeNull();
  });

  it('sessionId !== currentUuid → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ sessionId: '2'.repeat(36) }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('currentUuid null (registry has no uuid on record) → null, even against an empty sessionId', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ sessionId: '' }));
    expect(await readHookState(localIO, reg, ID, null, NOW)).toBeNull();
  });

  it("v:2 → null", async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ v: 2 }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it("state:'blocked' (a state this build does not know) → null", async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'blocked' }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('truncated JSON → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, '{"v":1,"state":"working"');
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('valid JSON that is not an object (e.g. a bare string) → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, '"just a string"');
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('oversize payload (> 65536 bytes) → null, and never reaches JSON.parse', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    // Not even valid JSON — proves the length gate runs BEFORE parsing.
    seed(reg, ID, 'x'.repeat(70_000));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('updatedAt missing → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    const body = base();
    delete body['updatedAt'];
    seed(reg, ID, body);
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('updatedAt non-number → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ updatedAt: 'yesterday' }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('a malformed ask (neither questions nor approval shape) fails the WHOLE read, not just ask', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'waiting', ask: { nonsense: true } }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('a malformed subagents entry fails the whole read, not a partial list', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ subagents: [{ name: 'reviewer' }] })); // missing startedAt
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });
});


// D-115's first consumer, at the reader that feeds it. `readHookState` answers
// `null` for NINE conditions and eight of them are MEASUREMENTS — oversize,
// malformed, version skew, an unknown state word, stale, no registry uuid to
// gate identity against, a sessionId mismatch, absent — every one meaning the
// same actionable thing: this file does not describe the current session's
// turn. The ninth is not a measurement at all: the read itself failed, and the
// file may say anything, including `working`. Folding the ninth into the other
// eight is what let `dispatch.ts`'s busy gate read "I could not look" as "I
// looked, and nobody is home", and then `/clear` a possibly mid-turn session.
//
// The suite above stays exactly as it was, deliberately: `readHookState` keeps
// its signature and its fold, because four of its five call sites branch on
// nothing else and splitting an arm no caller reads is the same defect one
// type over (`limits.ts:126`/`commands.ts:73` are the tree's own precedent for
// leaving an indifferent fold alone).
describe('readHookStateMeasured — the distinction readHookState folds', () => {
  it('a fresh, matching file is the ok arm, carrying the state itself', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'working' }));
    const r = await readHookStateMeasured(localIO, reg, ID, UUID, NOW);
    expect(r.ok).toBe(true);
    expect(r.ok && r.state.state).toBe('working');
  });

  it('an ABSENT hookstate is no-state, not unmeasured', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    expect(await readHookStateMeasured(localIO, reg, ID, UUID, NOW))
      .toEqual({ ok: false, reason: 'no-state' });
  });

  // The listed-but-its-bytes-never-came-back shape, through the tree's own
  // `FleetIO` double rather than the filesystem — so this case is REAL under
  // every runner, including the root one the chmod twin below has to skip.
  // It is also the shape the remote fleet actually produces: a dropped
  // agent-WS round trip on a file that is certainly there (`ioDoubles.ts`).
  it('an UNREADABLE hookstate is unmeasured — the arm the null had nowhere to put', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'working' }));
    const io = degradedReadIO((p) => p.endsWith(`${ID}.hookstate.json`));
    expect(await readHookStateMeasured(io, reg, ID, UUID, NOW))
      .toEqual({ ok: false, reason: 'unmeasured' });
  });

  // …and the same thing against a real EACCES, which is what the local fleet
  // produces. Skipped as root (D-116): `chmod 000` denies root nothing, so an
  // unguarded case would quietly assert the OPPOSITE of its own name there.
  it.skipIf(process.getuid?.() === 0)(
    'a real EACCES (chmod 000) is unmeasured too — not the absent arm',
    async () => {
      const reg = mkTmp('ccrc-hookstate-');
      seed(reg, ID, base({ state: 'working' }));
      const file = path.join(reg, `${ID}.hookstate.json`);
      chmodSync(file, 0o000);
      try {
        expect(await readHookStateMeasured(localIO, reg, ID, UUID, NOW))
          .toEqual({ ok: false, reason: 'unmeasured' });
      } finally {
        chmodSync(file, 0o644);   // let the fixture cleanup remove it without fighting perms
      }
    },
  );

  it('a STALE hookstate is no-state — a measurement, not a failure to measure', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ updatedAt: NOW - HOOKSTATE_FRESH_MS - 1 }));
    expect(await readHookStateMeasured(localIO, reg, ID, UUID, NOW))
      .toEqual({ ok: false, reason: 'no-state' });
  });

  it('every other gate is no-state too: skew, an unknown state word, a mismatched identity, garbage', async () => {
    // The eight-into-one fold this type KEEPS, pinned so a later reader does
    // not "finish the job" by splitting arms nothing branches on. Each of
    // these is a file the reader successfully looked at and rejected.
    const cases: Record<string, unknown> = {
      'version skew': base({ v: 2 }),
      'an unknown state word': base({ state: 'blocked' }),
      'a sessionId from a previous process': base({ sessionId: '2'.repeat(36) }),
      'a malformed ask': base({ state: 'waiting', ask: { nonsense: true } }),
      'truncated JSON': '{"v":1,"state":"working"',
      'oversize': 'x'.repeat(70_000),
    };
    for (const [name, body] of Object.entries(cases)) {
      const reg = mkTmp('ccrc-hookstate-');
      seed(reg, ID, body);
      expect(await readHookStateMeasured(localIO, reg, ID, UUID, NOW), name)
        .toEqual({ ok: false, reason: 'no-state' });
    }
    // …and the ninth gate, which takes no file at all: the registry has no
    // uuid on record, so there is nothing to gate identity against.
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base());
    expect(await readHookStateMeasured(localIO, reg, ID, null, NOW))
      .toEqual({ ok: false, reason: 'no-state' });
  });

  it('readHookState still folds all three answers, so its callers are untouched', async () => {
    // The derivation, measured rather than assumed: the same three fixtures
    // the cases above tell apart read back as one `null` through the legacy
    // form. This is the pin that keeps Task 1 a WIDENING and not a change.
    const absent = mkTmp('ccrc-hookstate-');
    expect(await readHookState(localIO, absent, ID, UUID, NOW)).toBeNull();

    const stale = mkTmp('ccrc-hookstate-');
    seed(stale, ID, base({ updatedAt: NOW - HOOKSTATE_FRESH_MS - 1 }));
    expect(await readHookState(localIO, stale, ID, UUID, NOW)).toBeNull();

    const degraded = mkTmp('ccrc-hookstate-');
    seed(degraded, ID, base({ state: 'working' }));
    const io = degradedReadIO((p) => p.endsWith(`${ID}.hookstate.json`));
    expect(await readHookState(io, degraded, ID, UUID, NOW)).toBeNull();
  });
});
