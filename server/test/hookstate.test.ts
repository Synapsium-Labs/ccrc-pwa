import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localIO } from '../src/io.js';
import { readHookState, readHookStateMeasured, readHookStateRawMeasured, HOOKSTATE_FRESH_MS } from '../src/hookstate.js';
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
  updatedAt: NOW, ask: null, subagents: [], graphQueries: 0, graphGateDenials: 0,
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
      subagents: [{ name: 'reviewer', startedAt: NOW - 1000 }],
      graphQueries: 0,
      graphGateDenials: 0,
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
// type over (`limits.ts:310`/`commands.ts:73` are the tree's own precedent for
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

// ── graphQueries: null and 0 are two different answers ────────────────────
// An L3 adapter may not narrow a distinction it received. A session that
// reported no queries (`0`) and a session running a hook too old to report at
// all (`null`) are two facts the console shows differently — `graph 0` versus
// no chip — so folding absent to 0 would invent a measurement.
describe('graphQueries', () => {
  it('a measured zero is 0, not null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ graphQueries: 0 }));
    expect((await readHookState(localIO, reg, ID, UUID, NOW))?.graphQueries).toBe(0);
  });

  it('a count round-trips', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ graphQueries: 7 }));
    expect((await readHookState(localIO, reg, ID, UUID, NOW))?.graphQueries).toBe(7);
  });

  it('ABSENT is null — an older hook said nothing, which is not "said zero"', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    const body = base();
    delete body['graphQueries'];
    seed(reg, ID, body);
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out).not.toBeNull();
    expect(out?.graphQueries, 'an absent counter was folded to a measured zero').toBeNull();
  });

  it('explicit null is null too', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ graphQueries: null }));
    expect((await readHookState(localIO, reg, ID, UUID, NOW))?.graphQueries).toBeNull();
  });

  it('a non-integer, a negative or a non-number rejects the WHOLE read', async () => {
    // NOT `NaN`: this suite's `seed` helper `JSON.stringify`s the body, and
    // `JSON.stringify(NaN)` is the string `null` — which reads back as a
    // perfectly valid absent counter, so that element would fail the
    // assertion rather than prove it. `true` is the fifth wrong TYPE and
    // survives serialisation, which is what this loop is actually testing.
    for (const bad of [1.5, -1, '3', true, {}]) {
      const reg = mkTmp('ccrc-hookstate-');
      seed(reg, ID, base({ graphQueries: bad }));
      expect(await readHookStateMeasured(localIO, reg, ID, UUID, NOW),
        `graphQueries: ${String(bad)} was laundered into a reading`)
        .toEqual({ ok: false, reason: 'no-state' });
    }
  });
});

// ── graphGateDenials: the same field, the same discipline (D-1613) ────────
// R5's gate counts its denials beside the queries R4 counts, in the same
// hookstate write, and the two numbers answer two different questions: how
// often this session asked the graph, and how often the gate had to tell it
// to. The adapter rule does not soften for the second one — `null` is a hook
// too old to have a gate at all (every hookstate written before this build),
// `0` is a gate that armed and never had to fire, and the chip renders those
// two differently (`graph 0` alone versus `graph 0 · gated 3`).
describe('graphGateDenials', () => {
  it('a measured zero is 0, not null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ graphGateDenials: 0 }));
    expect((await readHookState(localIO, reg, ID, UUID, NOW))?.graphGateDenials).toBe(0);
  });

  it('a count round-trips', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ graphGateDenials: 3 }));
    expect((await readHookState(localIO, reg, ID, UUID, NOW))?.graphGateDenials).toBe(3);
  });

  it('ABSENT is null — a hook that predates the gate said nothing, which is not "said zero"', async () => {
    // The whole live fleet is this case on the day R5 ships: every hookstate
    // on disk was written by the pre-gate hook. Folding those to `0` would
    // paint an un-upgraded box as a box whose gate never fired.
    const reg = mkTmp('ccrc-hookstate-');
    const body = base();
    delete body['graphGateDenials'];
    seed(reg, ID, body);
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out).not.toBeNull();
    expect(out?.graphGateDenials, 'an absent denial counter was folded to a measured zero').toBeNull();
  });

  it('explicit null is null too', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ graphGateDenials: null }));
    expect((await readHookState(localIO, reg, ID, UUID, NOW))?.graphGateDenials).toBeNull();
  });

  it('a non-integer, a negative or a non-number rejects the WHOLE read', async () => {
    // `NaN` is excluded for `reviveGraphQueries`' own reason: `JSON.stringify`
    // writes it as `null`, which is a valid absent counter and would fail this
    // assertion rather than prove it.
    for (const bad of [1.5, -1, '3', true, {}]) {
      const reg = mkTmp('ccrc-hookstate-');
      seed(reg, ID, base({ graphGateDenials: bad }));
      expect(await readHookStateMeasured(localIO, reg, ID, UUID, NOW),
        `graphGateDenials: ${String(bad)} was laundered into a reading`)
        .toEqual({ ok: false, reason: 'no-state' });
    }
  });

  it('the two counters are read APART — a session that queried once and was denied three times', async () => {
    // The mutation this catches: one reviver call reused for both keys
    // (`graphGateDenials: reviveGraphQueries(raw['graphQueries'])`), which
    // typechecks, keeps every test above green, and reports the query count
    // twice. R5's next reading is denials BESIDE queries; a seam that copies
    // one onto the other makes that reading unfalsifiable.
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ graphQueries: 1, graphGateDenials: 3 }));
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out?.graphQueries).toBe(1);
    expect(out?.graphGateDenials).toBe(3);
  });
});

// The stall watch's hold 2a (spec 2026-09-29 §4.2, planning departure D-3565 `ask-hold-correlates-the-dialog`): the lane
// correlates a hookstate ask with the live `waiting` word by TIME, so it needs the ask after HOOKSTATE_FRESH_MS has
// aged it out. Wave 2's lane takes it from the RAW read, and these rows moved here from the unaged door it replaced
// (rulings Q3: a deleted door, its pins kept). The raw read keeps every parse gate and REPORTS the identity; the lane
// makes the cut (only a `current` file's ask holds 2a), pinned in stall-sweep.test.ts ("hold 2a keeps the identity cut").
describe('readHookStateRawMeasured — the read hold 2a takes: never aged, identity reported', () => {
  // The hook's question envelope, the shape both AskUserQuestion arms of ccd/session-hook.sh write
  // (shared/api.ts's HookAsk). The old {approval:{tool:'AskUserQuestion'}} shape is the bug that hook no
  // longer writes.
  const question = { questions: [{ question: 'Which lane?', options: [{ label: 'a' }, { label: 'b' }] }] };

  it('reads an ask the aged read already calls stale, and still says when it was written', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    const now = Date.now();
    const old = now - HOOKSTATE_FRESH_MS - 60_000;
    seed(reg, ID, base({ state: 'waiting', updatedAt: old, ask: question }));
    // The control: the aged read drops this very file.
    expect(await readHookStateMeasured(localIO, reg, ID, UUID, now)).toEqual({ ok: false, reason: 'no-state' });
    const out = await readHookStateRawMeasured(localIO, reg, ID, UUID);
    expect(out).toMatchObject({ ok: true, identity: 'current' });
    if (!out.ok) return;
    expect(out.state.updatedAt).toBe(old);
    expect(out.state.ask).toEqual(question);
  });

  it('reports the identity the old gate cut on: another process\'s file is foreign, no registry uuid is unregistered', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'waiting', ask: question }));
    expect(await readHookStateRawMeasured(localIO, reg, ID, '2'.repeat(36))).toMatchObject({ ok: true, identity: 'foreign' });
    expect(await readHookStateRawMeasured(localIO, reg, ID, null)).toMatchObject({ ok: true, identity: 'unregistered' });
    expect(await readHookStateRawMeasured(localIO, reg, ID, UUID)).toMatchObject({ ok: true, identity: 'current' });   // the control
  });

  it('keeps the unmeasured arm: a file this box could not read is unmeasured, never absent', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'waiting', ask: question }));
    const io = degradedReadIO((p) => p.endsWith(`${ID}.hookstate.json`));
    expect(await readHookStateRawMeasured(io, reg, ID, UUID)).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('keeps every parse rejection: a malformed ask is malformed, never a partial read', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'waiting', ask: { approval: { tool: 7 } } }));
    expect(await readHookStateRawMeasured(localIO, reg, ID, UUID)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('shares the parse: hookstate.ts holds ONE JSON.parse and ONE age comparison, comments blanked', () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/hookstate.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(src).toContain('export async function readHookStateRawMeasured(');
    expect(src.match(/JSON\.parse\(/g)).toHaveLength(1);
    expect(src.match(/>\s*HOOKSTATE_FRESH_MS/g)).toHaveLength(1);
  });
});

// ── The raw read (worker stall watch wave 2, spec 2026-09-29 §5.1; slug `raw-read-replaces-the-private-parse` (D-3620)) ──
// The stall watch's frozen and delegates arms need the hook's `updatedAt`, its `event` and WHOSE file it is,
// from a file the aged read has already dropped. `readHookStateRawMeasured` is now this module's one parse, and
// the aged door folds over it (the unaged door went with the wave-2 lane). The parity table holds it to its answers.
describe('readHookStateRawMeasured — the one parse, identity reported and never cut', () => {
  it('reports identity instead of cutting on it: current, foreign and unregistered', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'done', event: 'Stop' }));
    const cur = await readHookStateRawMeasured(localIO, reg, ID, UUID);
    expect(cur).toMatchObject({ ok: true, sessionId: UUID, identity: 'current' });
    expect(cur.ok && cur.state).toMatchObject({ state: 'done', event: 'Stop', updatedAt: NOW });
    expect(await readHookStateRawMeasured(localIO, reg, ID, '2'.repeat(36)))
      .toMatchObject({ ok: true, sessionId: UUID, identity: 'foreign' });
    expect(await readHookStateRawMeasured(localIO, reg, ID, null))
      .toMatchObject({ ok: true, sessionId: UUID, identity: 'unregistered' });
  });

  it('keeps the aged read\'s own identity rule: an empty registry uuid against an empty sessionId is current', async () => {
    // Today `'' === ''` passes the gate, so the raw read says `current` and the fold keeps the answer.
    // `empty-uuid-is-foreign` (D-3619) is the TURN MARKER's rule, not this file's.
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ sessionId: '' }));
    expect(await readHookStateRawMeasured(localIO, reg, ID, ''))
      .toMatchObject({ ok: true, sessionId: '', identity: 'current' });
    expect((await readHookStateMeasured(localIO, reg, ID, '', NOW)).ok, 'the fold keeps today\'s answer').toBe(true);
  });

  it('a non-string sessionId is malformed — never an identity, whatever the registry says', async () => {
    for (const bad of [7, null, { id: UUID }]) {
      const reg = mkTmp('ccrc-hookstate-');
      seed(reg, ID, base({ sessionId: bad }));
      expect(await readHookStateRawMeasured(localIO, reg, ID, UUID), `sessionId: ${JSON.stringify(bad)}`)
        .toEqual({ ok: false, reason: 'malformed' });
      expect(await readHookStateRawMeasured(localIO, reg, ID, null), `sessionId: ${JSON.stringify(bad)}, no uuid`)
        .toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('over the 64 KiB cap is malformed, and never reaches the parse', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, 'x'.repeat(70_000));   // not even JSON: the length gate runs first
    expect(await readHookStateRawMeasured(localIO, reg, ID, UUID)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('tells absent from unmeasured: a proven ENOENT is absent, a failed read is unmeasured', async () => {
    const empty = mkTmp('ccrc-hookstate-');
    expect(await readHookStateRawMeasured(localIO, empty, ID, UUID)).toEqual({ ok: false, reason: 'absent' });
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base());
    const io = degradedReadIO((p) => p.endsWith(`${ID}.hookstate.json`));
    expect(await readHookStateRawMeasured(io, reg, ID, UUID)).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('has no age cut: a two-day-old file is ok, and still says when it was written', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    const old = Date.now() - 2 * 24 * 60 * 60_000;
    seed(reg, ID, base({ state: 'working', updatedAt: old }));
    const out = await readHookStateRawMeasured(localIO, reg, ID, UUID);
    expect(out).toMatchObject({ ok: true, identity: 'current' });
    expect(out.ok && out.state.updatedAt).toBe(old);
  });

  // The parity fixtures, one table read by BOTH parity rows below. The gated-door row calls only the aged door,
  // which existed before the fold, so its `aged` column was MEASURED against the pre-fold code and re-run against
  // the fold (the unaged door and its column went with the wave-2 lane). The raw row needs the new export.
  type ParityRow = {
    body: unknown; uuid: string | null; degraded?: true;
    raw: 'current' | 'foreign' | 'unregistered' | 'absent' | 'unmeasured' | 'malformed';
    aged: 'ok' | 'no-state' | 'unmeasured';
  };
  const parityRows = (): Record<string, ParityRow> => {
    const noUpdatedAt = base();
    delete noUpdatedAt['updatedAt'];
    const bad = (body: unknown): ParityRow => ({ body, uuid: UUID, raw: 'malformed', aged: 'no-state' });
    return {
      'fresh and matching': { body: base(), uuid: UUID, raw: 'current', aged: 'ok' },
      'absent': { body: undefined, uuid: UUID, raw: 'absent', aged: 'no-state' },
      'unreadable': { body: base(), uuid: UUID, degraded: true, raw: 'unmeasured', aged: 'unmeasured' },
      'stale by 31 minutes': {
        body: base({ updatedAt: NOW - HOOKSTATE_FRESH_MS - 60_000 }), uuid: UUID, raw: 'current', aged: 'no-state' },
      'exactly at the freshness boundary': {
        body: base({ updatedAt: NOW - HOOKSTATE_FRESH_MS }), uuid: UUID, raw: 'current', aged: 'ok' },
      'a previous process': { body: base({ sessionId: '2'.repeat(36) }), uuid: UUID, raw: 'foreign', aged: 'no-state' },
      'no registry uuid, empty sessionId': { body: base({ sessionId: '' }), uuid: null, raw: 'unregistered', aged: 'no-state' },
      'version skew': bad(base({ v: 2 })),
      'an unknown state word': bad(base({ state: 'blocked' })),
      'truncated JSON': bad('{"v":1,"state":"working"'),
      'a bare string': bad('"just a string"'),
      'oversize': bad('x'.repeat(70_000)),
      'updatedAt missing': bad(noUpdatedAt),
      'updatedAt non-number': bad(base({ updatedAt: 'yesterday' })),
      'event non-string': bad(base({ event: 7 })),
      'interrupted non-boolean': bad(base({ interrupted: 'yes' })),
      'a malformed ask': bad(base({ state: 'waiting', ask: { nonsense: true } })),
      'a malformed subagents entry': bad(base({ subagents: [{ name: 'reviewer' }] })),
      'a negative graphQueries': bad(base({ graphQueries: -1 })),
      'a non-string sessionId': bad(base({ sessionId: 7 })),
    };
  };
  const seedParity = (row: ParityRow): { reg: string; io: typeof localIO } => {
    const reg = mkTmp('ccrc-hookstate-');
    if (row.body !== undefined) seed(reg, ID, row.body);
    return { reg, io: row.degraded ? degradedReadIO((p) => p.endsWith(`${ID}.hookstate.json`)) : localIO };
  };

  it('FOLD PARITY (the gated door): every fixture reads through the gated door exactly as it did before the fold', async () => {
    const word = (r: { ok: boolean; reason?: string }): string => (r.ok ? 'ok' : String(r.reason));
    for (const [name, row] of Object.entries(parityRows())) {
      const { reg, io } = seedParity(row);
      expect(word(await readHookStateMeasured(io, reg, ID, row.uuid, NOW)), `${name}: aged`).toBe(row.aged);
    }
  });

  it('FOLD PARITY (the raw read): every fixture reads through the raw door as the identity or reason it names', async () => {
    for (const [name, row] of Object.entries(parityRows())) {
      const { reg, io } = seedParity(row);
      const raw = await readHookStateRawMeasured(io, reg, ID, row.uuid);
      expect(raw.ok ? raw.identity : raw.reason, `${name}: raw`).toBe(row.raw);
    }
  });
});
